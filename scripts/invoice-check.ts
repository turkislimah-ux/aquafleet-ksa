// Math confidence harness for the invoice assembly engine (Finance Commit
// 5a, spec §6/§7/§8). No DB, no test framework. Mirrors prepaid-check.ts /
// covered-unpaid-check.ts / vat-check.ts discipline. Run:
//   npx tsx scripts/invoice-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).

import { assembleInvoice, canEditSpecialCharges, type SpecialChargeInput } from "../lib/invoice";
import type { ConsumingTrip, TopupLite } from "../lib/prepaid";
import type { InvoiceStatus } from "../lib/db-types";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}` + (ok ? "" : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`));
}
function checkTrue(name: string, cond: boolean) {
  check(name, cond, true);
}

// --- Postpaid: no covered table, Amount Due === Grand exactly (same input) ---
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-05", delivered_at: "2026-06-05T10:00:00Z", rate_sar: 300 },
    { id: "t2", trip_date: "2026-06-10", delivered_at: "2026-06-10T10:00:00Z", rate_sar: 300 },
  ];
  const r = assembleInvoice({
    customerId: "c1",
    paymentMode: "postpaid",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    trips,
    topups: [],
    specialCharges: [],
  });
  check("postpaid: coveredLines always empty", r.coveredLines, []);
  check("postpaid: covered totals all zero", r.covered, { subtotal: 0, vat: 0, total: 0 });
  check("postpaid: unpaidLines = both trips", r.unpaidLines.map((l) => l.id).sort(), ["t1", "t2"]);
  check("postpaid: amountDue totals", r.amountDue, { subtotal: 600, vat: 90, total: 690 });
  checkTrue("postpaid: amountDue === grand EXACTLY (same input line set)", JSON.stringify(r.amountDue) === JSON.stringify(r.grand));
}

// --- Postpaid + special charge: charge lands in Unpaid/Amount Due table ------
{
  const trips: ConsumingTrip[] = [{ id: "t1", trip_date: "2026-06-05", delivered_at: "2026-06-05T10:00:00Z", rate_sar: 300 }];
  const charges: SpecialChargeInput[] = [{ id: "ch1", label: "Extra hose fee", amount_sar: 150 }];
  const r = assembleInvoice({
    customerId: "c1",
    paymentMode: "postpaid",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    trips,
    topups: [],
    specialCharges: charges,
  });
  check("charge: appears in unpaidLines with kind=charge", r.unpaidLines.find((l) => l.id === "ch1")?.kind, "charge");
  check("charge: NOT in coveredLines", r.coveredLines.length, 0);
  check("charge: amountDue = 300+150 -> subtotal 450, vat 67.5, total 517.5", r.amountDue, { subtotal: 450, vat: 67.5, total: 517.5 });
}

// --- Prepaid: global-then-filter rule — an EARLIER period's trip drains the --
// --- pool before THIS period's trips are evaluated, even though only this ---
// --- period's trips are passed to the caller's period window. ---------------
{
  // Pool = 300 (one topup). Trip A (earlier period, already consumed 300 of
  // the pool) + Trip B (THIS period, 300) — caller must pass Trip A too
  // (full history), even though only Trip B's period is being invoiced.
  const trips: ConsumingTrip[] = [
    { id: "tA-prior-period", trip_date: "2026-05-15", delivered_at: "2026-05-15T10:00:00Z", rate_sar: 300 },
    { id: "tB-this-period", trip_date: "2026-06-15", delivered_at: "2026-06-15T10:00:00Z", rate_sar: 300 },
  ];
  const topups: TopupLite[] = [{ id: "top1", amount_sar: 300, topup_date: "2026-05-01" }];
  const r = assembleInvoice({
    customerId: "c1",
    paymentMode: "prepaid",
    periodStart: "2026-06-01", // THIS period only covers June
    periodEnd: "2026-06-30",
    trips, // full history passed, including May's trip
    topups,
    specialCharges: [],
  });
  checkTrue(
    "global-then-filter: June trip is Unpaid (May's trip already drained the pool), not falsely Covered",
    r.unpaidLines.some((l) => l.id === "tB-this-period") && !r.coveredLines.some((l) => l.id === "tB-this-period"),
  );
  checkTrue("global-then-filter: May's trip does not appear in this invoice at all (outside period)", !r.unpaidLines.some((l) => l.id === "tA-prior-period") && !r.coveredLines.some((l) => l.id === "tA-prior-period"));
}

// --- Prepaid: period boundary excludes trips just outside it -----------------
{
  const trips: ConsumingTrip[] = [
    { id: "before", trip_date: "2026-05-31", delivered_at: "2026-05-31T10:00:00Z", rate_sar: 100 },
    { id: "inside", trip_date: "2026-06-15", delivered_at: "2026-06-15T10:00:00Z", rate_sar: 100 },
    { id: "after", trip_date: "2026-07-01", delivered_at: "2026-07-01T10:00:00Z", rate_sar: 100 },
  ];
  const topups: TopupLite[] = [{ id: "top1", amount_sar: 1000, topup_date: "2026-01-01" }];
  const r = assembleInvoice({
    customerId: "c1",
    paymentMode: "prepaid",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    trips,
    topups,
    specialCharges: [],
  });
  const allIds = [...r.coveredLines, ...r.unpaidLines].map((l) => l.id);
  check("period boundary: only 'inside' trip appears", allIds, ["inside"]);
}

// --- Reconciliation: covered ∪ unpaid (period-filtered) === every delivered --
// --- trip in the period, no trip dropped or duplicated. ----------------------
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-01", delivered_at: "2026-06-01T10:00:00Z", rate_sar: 100 },
    { id: "t2", trip_date: "2026-06-02", delivered_at: "2026-06-02T10:00:00Z", rate_sar: 100 },
    { id: "t3", trip_date: "2026-06-03", delivered_at: "2026-06-03T10:00:00Z", rate_sar: 100 },
    { id: "t4", trip_date: "2026-06-04", delivered_at: null, rate_sar: 100 }, // not delivered — excluded entirely
  ];
  const topups: TopupLite[] = [{ id: "top1", amount_sar: 150, topup_date: "2026-06-01" }];
  const r = assembleInvoice({
    customerId: "c1",
    paymentMode: "prepaid",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    trips,
    topups,
    specialCharges: [],
  });
  const ids = [...r.coveredLines, ...r.unpaidLines].map((l) => l.id).sort();
  check("reconciliation: t1/t2/t3 covered+unpaid (t4 undelivered excluded)", ids, ["t1", "t2", "t3"]);
  checkTrue("reconciliation: no id duplicated across the two tables", new Set(ids).size === ids.length);
}

// --- THE covered/unpaid boundary-flip + two-table rounding-divergence proof -
// --- (v3 CUTOVER — the boundary itself moved, not just the rounding). --------
// Pool = 0.10. Three trips of 0.05 each now consume round2(0.05*1.15) = 0.06
// apiece (VAT-INCLUSIVE consumption, PRD v3 §2/§5), not 0.05 as under the old
// pre-VAT engine. Old v2 math: 0.10 exactly covered t1+t2 (2 covered/1
// unpaid). New v3 math: 0.10 covers only t1 (0.10-0.06=0.04 left, t2 needs
// 0.06 -> doesn't fit -> hitWall -> t2 AND t3 both unpaid) — the boundary
// flips to 1 covered/2 unpaid. This is the exact divergence the user flagged
// when specifying the v3 cutover.
//   covered:   subtotal 0.05 (t1 only)  -> vat round(0.0075) = 0.01 -> total 0.06
//   amountDue: subtotal 0.10 (t2+t3)    -> = ledger.unpaid.subtotal (0.12,
//              VAT-inclusive consumedAmount sum) -> vat = 0.12-0.10 = 0.02
//   grand: covered trips + covered charges (none) — same single line as
//     covered table (no covered charges here) -> identical to covered: 0.06
// naive sum of the two shown tables' totals: 0.06 + 0.12 = 0.18, vs
// grand.total = 0.06 — v3's grand deliberately EXCLUDES unpaid trips (spec
// §9, reversed from v2), so this is now a structural divergence (different
// line sets), not merely a rounding one — still proves "don't sum the
// tables to get the grand total."
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-01", delivered_at: "2026-06-01T10:00:00Z", rate_sar: 0.05 },
    { id: "t2", trip_date: "2026-06-02", delivered_at: "2026-06-02T10:00:00Z", rate_sar: 0.05 },
    { id: "t3", trip_date: "2026-06-03", delivered_at: "2026-06-03T10:00:00Z", rate_sar: 0.05 },
  ];
  const topups: TopupLite[] = [{ id: "top1", amount_sar: 0.1, topup_date: "2026-06-01" }];
  const r = assembleInvoice({
    customerId: "c1",
    paymentMode: "prepaid",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    trips,
    topups,
    specialCharges: [],
  });
  check("boundary flip: only t1 covered (was t1+t2 under old pre-VAT math)", r.coveredLines.map((l) => l.id), ["t1"]);
  check("boundary flip: t2+t3 unpaid (was just t3 under old pre-VAT math)", r.unpaidLines.map((l) => l.id), ["t2", "t3"]);
  check("divergence proof: covered table = 0.05/0.01/0.06", r.covered, { subtotal: 0.05, vat: 0.01, total: 0.06 });
  check("divergence proof: amountDue table = 0.10/0.02/0.12", r.amountDue, { subtotal: 0.1, vat: 0.02, total: 0.12 });
  check("divergence proof: grand = 0.05/0.01/0.06 (covered-only, unpaid trips excluded per v3 §9)", r.grand, { subtotal: 0.05, vat: 0.01, total: 0.06 });
  const naiveSum = Math.round((r.covered.total + r.amountDue.total) * 100) / 100;
  checkTrue("divergence proof: naive sum of table totals (0.18) != grand.total (0.06)", naiveSum !== r.grand.total);
  check("divergence proof: naive sum actually is 0.18", naiveSum, 0.18);
}

// --- Empty period / no trips --------------------------------------------------
{
  const r = assembleInvoice({
    customerId: "c1",
    paymentMode: "prepaid",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    trips: [],
    topups: [],
    specialCharges: [],
  });
  check("empty: everything zero", [r.covered, r.amountDue, r.grand], [
    { subtotal: 0, vat: 0, total: 0 },
    { subtotal: 0, vat: 0, total: 0 },
    { subtotal: 0, vat: 0, total: 0 },
  ]);
  check("empty: no lines", [r.coveredLines, r.unpaidLines], [[], []]);
}

// --- paymentMode unset throws (never silently defaults) ----------------------
{
  let threw = false;
  try {
    assembleInvoice({
      customerId: "c1",
      paymentMode: null,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      trips: [],
      topups: [],
      specialCharges: [],
    });
  } catch {
    threw = true;
  }
  checkTrue("paymentMode null: throws instead of silently defaulting", threw);
}

// --- Passthrough fields carried straight through, untouched ------------------
{
  const r = assembleInvoice({
    customerId: "c1",
    paymentMode: "postpaid",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    trips: [],
    topups: [],
    specialCharges: [],
    sellerSnapshot: { legal_name: "Bin Slimah Group" },
    buyerSnapshot: { name: "Acme Co" },
    customerEmail: "acme@example.com",
  });
  check("passthrough: sellerSnapshot", r.sellerSnapshot, { legal_name: "Bin Slimah Group" });
  check("passthrough: buyerSnapshot", r.buyerSnapshot, { name: "Acme Co" });
  check("passthrough: customerEmail", r.customerEmail, "acme@example.com");
}

// --- Reserve-at-draft exclusion (0030): a trip reserved by ANOTHER invoice --
// --- is excluded from THIS invoice's output — proof that exclusion is a ----
// --- POST-split display filter, not a pool-math re-drain. ------------------
// Pool = 230 (was 200 pre-VAT) — 2 x 115 (100 * 1.15, VAT-inclusive
// consumedAmount), so it still covers t1+t2 exactly with 0 leftover under
// v3's VAT-inclusive consumption. FIFO t1(115)/t2(115)/t3(115): t1 covered
// (pool->115), t2 covered (pool->0), t3 doesn't fit -> unpaid. t2 is
// reserved by another invoice. If exclusion were (wrongly) applied BEFORE
// the FIFO walk, t3 would flip to covered once t2 "disappears" (115 fits in
// the freed pool). The correct behavior: t3 stays unpaid — the pool was
// already spent on t2 when it was walked, exclusion only hides t2 from this
// invoice's tables afterward, it doesn't un-spend the pool.
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-01", delivered_at: "2026-06-01T10:00:00Z", rate_sar: 100 },
    { id: "t2", trip_date: "2026-06-02", delivered_at: "2026-06-02T10:00:00Z", rate_sar: 100 },
    { id: "t3", trip_date: "2026-06-03", delivered_at: "2026-06-03T10:00:00Z", rate_sar: 100 },
  ];
  const topups: TopupLite[] = [{ id: "top1", amount_sar: 230, topup_date: "2026-06-01" }];
  const r = assembleInvoice({
    customerId: "c1",
    paymentMode: "prepaid",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    trips,
    topups,
    specialCharges: [],
    reservedElsewhereIds: ["t2"],
  });
  check("reserve-exclusion: t2 (reserved elsewhere) absent from coveredLines", r.coveredLines.map((l) => l.id), ["t1"]);
  checkTrue("reserve-exclusion: t3 stays Unpaid (pool already spent on t2, not un-drained by exclusion)", r.unpaidLines.some((l) => l.id === "t3"));
  check("reserve-exclusion: t2 absent from unpaidLines too (never appears anywhere on this invoice)", r.unpaidLines.some((l) => l.id === "t2"), false);
  check("reserve-exclusion: covered totals recomputed over remaining line only", r.covered, { subtotal: 100, vat: 15, total: 115 });
}

// --- Reserve-at-draft exclusion — postpaid: reserved-elsewhere trip simply -
// --- drops out of the single billable table. --------------------------------
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-05", delivered_at: "2026-06-05T10:00:00Z", rate_sar: 300 },
    { id: "t2", trip_date: "2026-06-10", delivered_at: "2026-06-10T10:00:00Z", rate_sar: 300 },
  ];
  const r = assembleInvoice({
    customerId: "c1",
    paymentMode: "postpaid",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    trips,
    topups: [],
    specialCharges: [],
    reservedElsewhereIds: ["t2"],
  });
  check("postpaid reserve-exclusion: only t1 billable", r.unpaidLines.map((l) => l.id), ["t1"]);
  check("postpaid reserve-exclusion: amountDue = just t1", r.amountDue, { subtotal: 300, vat: 45, total: 345 });
}

// --- No exclusion given (default) — existing callers/behavior unaffected ---
{
  const trips: ConsumingTrip[] = [{ id: "t1", trip_date: "2026-06-05", delivered_at: "2026-06-05T10:00:00Z", rate_sar: 300 }];
  const r = assembleInvoice({
    customerId: "c1",
    paymentMode: "postpaid",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    trips,
    topups: [],
    specialCharges: [],
  });
  check("no reservedElsewhereTripIds param: nothing excluded, t1 present", r.unpaidLines.map((l) => l.id), ["t1"]);
}

// --- Special-charge lock: editable Draft/Review only, frozen from Confirm --
// --- onward (mirrors the actions' guard — see app/trips/invoiceActions.ts) --
{
  const editable: InvoiceStatus[] = ["draft", "review"];
  const locked: InvoiceStatus[] = ["confirmed", "paid", "void"];
  checkTrue("charge lock: draft/review editable", editable.every((s) => canEditSpecialCharges(s)));
  checkTrue("charge lock: confirmed/paid/void frozen", locked.every((s) => !canEditSpecialCharges(s)));
}

console.log("");
if (failures === 0) {
  console.log("All invoice assembly checks PASSED ✓");
  process.exit(0);
} else {
  console.log(`${failures} invoice assembly check(s) FAILED ✗`);
  process.exit(1);
}
