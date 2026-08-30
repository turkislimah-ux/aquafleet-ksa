// Math confidence harness for payslip violation deductions (0177). No DB, no
// test framework.
// Run:  npx tsx scripts/payslip-deduction-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).
//
// ---------------------------------------------------------------------------
// WHAT THIS PROVES, AND WHAT IT DOES NOT
//
// The deduction arithmetic lives in SQL — v_driver_payslip_basis computes it
// and issue_driver_payslip freezes it. There is no lib/ function to import, and
// deliberately so: a second implementation in TypeScript would be a second
// source of truth that could drift from the money the database actually pays.
//
// So this file MIRRORS the SQL. `payslipMonth` below is a line-for-line
// transcription of the view's expressions, quoted verbatim in each comment. It
// proves the ALGEBRA is right — that the clamp cannot go negative, that
// unabsorbed is exactly the shortfall, that voiding removes a fine and
// payment_status does not.
//
// It cannot prove the deployed SQL matches this transcription. That proof is
// 0177's VERIFY block §9, which runs the same fixtures through the live view
// inside a transaction and rolls back. Run both.
// ---------------------------------------------------------------------------

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  const tag = ok ? "PASS" : "FAIL";
  console.log(
    `[${tag}] ${name}` +
      (ok ? "" : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`),
  );
}

/** A row of driver_violations, as 0176 defines it. */
type Violation = {
  id: string;
  ref_no: string;
  amount_sar: number;
  /** Plain date, 'YYYY-MM-DD'. No timezone — violation_date is a `date`. */
  violation_date: string;
  /** 0176 soft-delete. Non-null = voided = invisible to payroll. */
  voided_at: string | null;
  /** Whether the FINE was settled with the authority. NOT a payroll filter. */
  payment_status: "paid" | "not_paid";
};

type MonthResult = {
  violation_deduction_sar: number;
  deductions_sar: number;
  unabsorbed_sar: number;
  net_sar: number;
  /** The ids frozen into driver_payslip_violations by the RPC. */
  frozen: string[];
};

/** First day of the month after `monthStart` ('YYYY-MM-01'). Half-open bound. */
function nextMonth(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

/**
 * The whole model, mirroring 0177.
 *
 * View, basis CTE:
 *   coalesce((select sum(dv.amount_sar) from driver_violations dv
 *              where dv.driver_id = d.id
 *                and dv.voided_at is null
 *                and dv.violation_date >= m.month
 *                and dv.violation_date <  (m.month + interval '1 month')::date), 0)
 *     as violation_sum_sar
 *
 * View, outer SELECT:
 *   gross_sar - absorbed_sar          as net_sar
 *   violation_sum_sar                 as violation_deduction_sar
 *   absorbed_sar                      as deductions_sar
 *     -- absorbed CTE: least(violation_sum_sar, greatest(gross_sar, 0::numeric))
 *   violation_sum_sar - absorbed_sar  as unabsorbed_sar
 *
 * RPC freeze: the SAME predicate as the sum, so the itemised set and the total
 * are the same set by construction.
 */
function payslipMonth(gross: number, monthStart: string, all: Violation[]): MonthResult {
  const end = nextMonth(monthStart);

  // voided_at is null is the ONLY live-filter. payment_status is not consulted.
  const live = all.filter(
    (v) => v.voided_at === null && v.violation_date >= monthStart && v.violation_date < end,
  );

  const violation_deduction_sar = live.reduce((sum, v) => sum + v.amount_sar, 0);
  // least(sum, greatest(gross, 0)). The inner clamp only bites when gross is
  // negative, where pay that does not exist absorbs nothing.
  const deductions_sar = Math.min(violation_deduction_sar, Math.max(gross, 0));
  const unabsorbed_sar = violation_deduction_sar - deductions_sar;
  const net_sar = gross - deductions_sar;

  return {
    violation_deduction_sar,
    deductions_sar,
    unabsorbed_sar,
    net_sar,
    frozen: live.map((v) => v.id).sort(),
  };
}

function v(
  id: string,
  amount_sar: number,
  violation_date: string,
  opts: Partial<Pick<Violation, "voided_at" | "payment_status">> = {},
): Violation {
  return {
    id,
    ref_no: `REF-${id}`,
    amount_sar,
    violation_date,
    voided_at: opts.voided_at ?? null,
    payment_status: opts.payment_status ?? "not_paid",
  };
}

const MONTH = "2026-06-01";

// --- REGRESSION: no fines changes nothing ----------------------------------
// This is the case that covers all 43 live basis rows and both issued payslips
// on the day 0177 is applied. If this breaks, the migration is not a no-op.
{
  const r = payslipMonth(1504, MONTH, []);
  check("no fines: net = gross", r.net_sar, 1504);
  check("no fines: deduction 0", r.deductions_sar, 0);
  check("no fines: claim 0", r.violation_deduction_sar, 0);
  check("no fines: unabsorbed 0", r.unabsorbed_sar, 0);
  check("no fines: nothing frozen", r.frozen, []);
}

// --- Fines BELOW pay: full deduct, nothing left over ------------------------
{
  const r = payslipMonth(1504, MONTH, [v("a", 300, "2026-06-15")]);
  check("fines<pay: net = gross - fines", r.net_sar, 1204);
  check("fines<pay: deduct all of it", r.deductions_sar, 300);
  check("fines<pay: claim = 300", r.violation_deduction_sar, 300);
  check("fines<pay: unabsorbed 0", r.unabsorbed_sar, 0);
  check("fines<pay: frozen = the one row", r.frozen, ["a"]);
}

// --- Several fines in the month add up -------------------------------------
{
  const r = payslipMonth(1504, MONTH, [
    v("a", 300, "2026-06-01"), // first day of the month, inclusive
    v("b", 150, "2026-06-15"),
    v("c", 54, "2026-06-30"), // last day of the month
  ]);
  check("multi: claim = 504", r.violation_deduction_sar, 504);
  check("multi: net = 1000", r.net_sar, 1000);
  check("multi: all three frozen", r.frozen, ["a", "b", "c"]);
}

// --- Fines ABOVE pay: clamp at 0, record the shortfall ----------------------
{
  const r = payslipMonth(1504, MONTH, [v("a", 2000, "2026-06-10")]);
  check("fines>pay: net CLAMPS at 0", r.net_sar, 0);
  check("fines>pay: deduct = gross, no more", r.deductions_sar, 1504);
  check("fines>pay: claim is the full fine", r.violation_deduction_sar, 2000);
  check("fines>pay: unabsorbed = fines - gross", r.unabsorbed_sar, 496);
  check("fines>pay: the row is still frozen", r.frozen, ["a"]);
}

// --- Fines EXACTLY pay: net 0, nothing unabsorbed ---------------------------
{
  const r = payslipMonth(1504, MONTH, [v("a", 1504, "2026-06-10")]);
  check("fines=pay: net 0", r.net_sar, 0);
  check("fines=pay: deduct = gross", r.deductions_sar, 1504);
  check("fines=pay: unabsorbed 0", r.unabsorbed_sar, 0);
}

// --- Zero pay: nothing to take, everything unabsorbed -----------------------
{
  const r = payslipMonth(0, MONTH, [v("a", 500, "2026-06-10")]);
  check("zero pay: net 0", r.net_sar, 0);
  check("zero pay: deduct 0", r.deductions_sar, 0);
  check("zero pay: unabsorbed = the whole fine", r.unabsorbed_sar, 500);
}

// --- NEGATIVE gross: greatest(gross, 0) --------------------------------------
// Reachable, not theoretical: commission_adjustments.amount_sar carries no
// non-negative check and 7 negative rows exist live. Without the inner clamp
// this month would compute least(300, -100) = -100 — a NEGATIVE deduction,
// which is nonsense as a number and aborts on driver_payslips_deduction_nonneg.
// With it, pay that does not exist absorbs nothing: deduct 0, the whole fine is
// unabsorbed, and net stays the negative gross it already was.
//
// DELIBERATELY OUTSIDE the invariant block below: this row does NOT satisfy
// net_sar >= 0, and it is not meant to. driver_payslips_net_nonneg rejects it at
// issue time on the FROZEN row. What is being proved here is that the PREVIEW
// reports it honestly instead of manufacturing a negative deduction on the way.
{
  const r = payslipMonth(-100, MONTH, [v("a", 300, "2026-06-15")]);
  check("negative gross: deducts 0", r.deductions_sar, 0);
  check("negative gross: net = the gross, untouched", r.net_sar, -100);
  check("negative gross: whole fine unabsorbed", r.unabsorbed_sar, 300);
  check("negative gross: claim still recorded in full", r.violation_deduction_sar, 300);
  check("negative gross: violation still frozen", r.frozen, ["a"]);

  // The three constraints this row DOES satisfy, and the one it does not.
  check("negative gross: deductions_sar >= 0 holds", r.deductions_sar >= 0, true);
  check("negative gross: unabsorbed_sar >= 0 holds", r.unabsorbed_sar >= 0, true);
  check(
    "negative gross: deductions_sar <= violation_deduction_sar holds",
    r.deductions_sar <= r.violation_deduction_sar,
    true,
  );
  check("negative gross: net_nonneg would REJECT this at issue time", r.net_sar >= 0, false);
}

// --- VOIDED violations are invisible ---------------------------------------
{
  const r = payslipMonth(1504, MONTH, [
    v("a", 300, "2026-06-15"),
    v("b", 900, "2026-06-16", { voided_at: "2026-06-20T09:00:00Z" }),
  ]);
  check("voided: excluded from the claim", r.violation_deduction_sar, 300);
  check("voided: excluded from the deduction", r.deductions_sar, 300);
  check("voided: net unaffected by it", r.net_sar, 1204);
  check("voided: NOT frozen onto the payslip", r.frozen, ["a"]);
}
{
  const r = payslipMonth(1504, MONTH, [
    v("a", 300, "2026-06-15", { voided_at: "2026-06-20T09:00:00Z" }),
  ]);
  check("all voided: identical to no fines at all", r, {
    violation_deduction_sar: 0,
    deductions_sar: 0,
    unabsorbed_sar: 0,
    net_sar: 1504,
    frozen: [],
  });
}

// --- payment_status does NOT move the deduction -----------------------------
// Whether the company settled the ticket with the authority is a separate fact
// from whether the driver was charged. Same numbers either way.
{
  const notPaid = payslipMonth(1504, MONTH, [v("a", 300, "2026-06-15", { payment_status: "not_paid" })]);
  const paid = payslipMonth(1504, MONTH, [v("a", 300, "2026-06-15", { payment_status: "paid" })]);
  check("payment_status: 'paid' deducts the same", paid, notPaid);
  check("payment_status: still 300", paid.deductions_sar, 300);
}

// --- MONTH BOUNDARY: half-open [month, month+1) -----------------------------
{
  const r = payslipMonth(1504, MONTH, [
    v("prev", 100, "2026-05-31"), // day before — out
    v("in1", 200, "2026-06-01"), // first day — in
    v("in2", 200, "2026-06-30"), // last day — in
    v("next", 100, "2026-07-01"), // first day of next month — out
  ]);
  check("boundary: only June counted", r.violation_deduction_sar, 400);
  check("boundary: only June frozen", r.frozen, ["in1", "in2"]);
}
{
  // December rollover — nextMonth() must cross the year.
  const r = payslipMonth(1000, "2026-12-01", [
    v("dec", 100, "2026-12-31"),
    v("jan", 100, "2027-01-01"),
  ]);
  check("boundary: Dec->Jan rollover", r.frozen, ["dec"]);
  check("boundary: Dec claim = 100", r.violation_deduction_sar, 100);
}

// --- THE INVARIANTS 0177 ENFORCES AS CHECK CONSTRAINTS ----------------------
// Every case below must satisfy the constraints the migration adds, or the RPC
// will abort at insert time instead of writing a wrong document.
{
  const cases: Array<[number, Violation[]]> = [
    [1504, []],
    [1504, [v("a", 300, "2026-06-15")]],
    [1504, [v("a", 2000, "2026-06-15")]],
    [1504, [v("a", 1504, "2026-06-15")]],
    [0, [v("a", 500, "2026-06-15")]],
    [1504, [v("a", 300, "2026-06-15"), v("b", 900, "2026-06-16", { voided_at: "x" })]],
    [1517.02, [v("a", 17.02, "2026-06-15")]],
  ];
  const rows = cases.map(([g, vs]) => payslipMonth(g, MONTH, vs));

  check("invariant net_sar >= 0", rows.every((r) => r.net_sar >= 0), true);
  check("invariant deductions_sar >= 0", rows.every((r) => r.deductions_sar >= 0), true);
  check("invariant violation_deduction_sar >= 0", rows.every((r) => r.violation_deduction_sar >= 0), true);
  check("invariant unabsorbed_sar >= 0", rows.every((r) => r.unabsorbed_sar >= 0), true);
  check(
    "invariant deductions_sar <= violation_deduction_sar",
    rows.every((r) => r.deductions_sar <= r.violation_deduction_sar),
    true,
  );
  check(
    "identity unabsorbed = claim - deduction",
    rows.every((r) => Math.abs(r.unabsorbed_sar - (r.violation_deduction_sar - r.deductions_sar)) < 1e-9),
    true,
  );
}

// --- THE DOUBLE-SUBTRACT, the trap 0177 exists to close ---------------------
// The view's net_sar is ALREADY net of the deduction. The old RPC wrote
// `v_basis.net_sar - v_deductions`. Applying that to the new view charges the
// fine twice. This case is what a regression back to the old expression would
// look like, so the number is written down and named.
{
  const r = payslipMonth(1504, MONTH, [v("a", 300, "2026-06-15")]);
  const correct = r.net_sar; // what 0177 writes
  const doubleSubtracted = r.net_sar - r.deductions_sar; // what the OLD line would write
  check("correct net is 1204", correct, 1204);
  check("the double-subtract bug would write 904", doubleSubtracted, 904);
  check("they differ by exactly the deduction", correct - doubleSubtracted, 300);
}

console.log("");
if (failures === 0) {
  console.log("All payslip deduction checks PASSED ✓");
  process.exit(0);
} else {
  console.log(`${failures} payslip deduction check(s) FAILED ✗`);
  process.exit(1);
}
