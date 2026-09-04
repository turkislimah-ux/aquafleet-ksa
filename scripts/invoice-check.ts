// Math confidence harness for the invoice assembly engine (Finance Commit
// 5a, spec §6/§7/§8). No DB, no test framework. Mirrors prepaid-check.ts /
// covered-unpaid-check.ts / vat-check.ts discipline. Run:
//   npx tsx scripts/invoice-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).

import { assembleInvoice, canEditSpecialCharges, type InvoiceAssembly, type SpecialChargeInput } from "../lib/invoice";
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

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ============================================================================
// THE TWO MONEY INVARIANTS. Asserted on EVERY assembled case in this file,
// both payment modes, by calling reconciles() at the end of each block.
//
//   1. covered + amountDue === grand, on subtotal AND vat AND total.
//   2. every line on the document is inside grand.subtotal — the sum of
//      coveredLines + unpaidLines + chargeLines pre-VAT amounts IS grand's
//      subtotal, exactly. Nothing can be displayed and un-totalled.
//
// These exist because both were violated in production and neither was caught:
// grand was built from covered lines only, so 8 of 24 live invoices did not
// add up and 38,709.00 SAR of delivered work sat on invoices whose grand total
// excluded it. A per-case expected-value assertion cannot catch that class of
// fault — it only proves the engine still does what it did. An identity can.
// Never assert a total in this file without also calling reconciles().
// ============================================================================
function reconciles(name: string, r: InvoiceAssembly) {
  check(
    `${name}: covered + amountDue === grand (subtotal/vat/total)`,
    {
      subtotal: r2(r.covered.subtotal + r.amountDue.subtotal),
      vat: r2(r.covered.vat + r.amountDue.vat),
      total: r2(r.covered.total + r.amountDue.total),
    },
    r.grand,
  );
  const everyLine = r2(
    [...r.coveredLines, ...r.unpaidLines, ...r.chargeLines].reduce((s, l) => s + l.amount_sar, 0),
  );
  check(`${name}: every line is inside grand.subtotal (nothing dropped)`, everyLine, r.grand.subtotal);
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
  reconciles("postpaid", r);
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
  reconciles("postpaid charge", r);
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
  reconciles("global-then-filter", r);
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
  // grand is scoped to what the DOCUMENT shows, not to what the pool consumed:
  // 'before' and 'after' drained the pool but are not on this invoice, so they
  // are outside grand too. reconciles() is what pins that down.
  reconciles("period boundary", r);
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
  reconciles("reconciliation", r);
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
// IT IS ALSO THE ROUNDING-RESIDUE PROOF, and this is where the two rounding
// conventions are furthest apart at the smallest scale:
//   grand:     ALL THREE trips, one document-level pass — subtotal 0.15,
//              vat round2(0.0225) = 0.02, total 0.17
//   amountDue: subtotal 0.10 (t2+t3), total = ledger.unpaid.subtotal 0.12
//              (per-item VAT-inclusive consumedAmount, 0.06+0.06), vat 0.02
//   covered:   grand - amountDue = 0.05 / 0.00 / 0.05
//
// A STANDALONE calculateVat() pass over covered's own line would say
// 0.05/0.01/0.06 — a halala more. THAT HALALA IS THE POINT: the two
// conventions genuinely differ, and the derived form is what puts the
// difference somewhere harmless (a settled figure) instead of leaving the
// invoice not adding up. covered.total is deliberately 0.05, not 0.06.
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
  check("divergence proof: grand = ALL THREE trips, one document pass = 0.15/0.02/0.17", r.grand, { subtotal: 0.15, vat: 0.02, total: 0.17 });
  check("divergence proof: amountDue table = 0.10/0.02/0.12 (per-item, pool-exact)", r.amountDue, { subtotal: 0.1, vat: 0.02, total: 0.12 });
  check("divergence proof: covered = grand - amountDue = 0.05/0.00/0.05", r.covered, { subtotal: 0.05, vat: 0, total: 0.05 });
  // THE RESIDUE, NAMED. A standalone calculateVat() over covered's own single
  // 0.05 line returns vat 0.01 / total 0.06 — one halala MORE than the derived
  // covered above. Both are defensible roundings; they cannot both be used at
  // once without the invoice failing to add up. This asserts the halala landed
  // in covered.vat (settled, display-only) and NOT in amountDue (what the
  // customer is actually asked to pay, which stays pool-exact).
  check("divergence proof: a standalone pass over covered's line would say 0.06", r2(0.05 * 1.15), 0.06);
  checkTrue("divergence proof: the residue is absorbed by covered.vat, not amountDue", r.covered.total !== r2(0.05 * 1.15) && r.amountDue.total === 0.12);
  reconciles("divergence proof", r);
}

// --- THE STRANDED-CHARGE FIX: an uncovered charge reaches Amount Due --------
// This is invoice 026-000009's exact shape, in miniature, and it is the case
// that used to lose money. Pool 1,000. One trip of 500 consumes
// round2(500*1.15) = 575 -> covered, 425 left. One charge of 450 needs
// round2(450*1.15) = 517.50 -> does NOT fit -> uncovered.
//
// BEFORE THE FIX: grand = covered trip only (575). amountDue = unpaid TRIPS
// only = 0, because there are no unpaid trips and charges were excluded by
// rule. So the 450 charge appeared in NO document total at all, while
// lib/prepaid.ts had already deducted its 517.50 from the balance — and
// because a charge is FK-bound to one invoice at creation and hidden from
// every other by reservedElsewhereIds, it could never be billed later either.
// AFTER: it lands in amountDue AND in grand. Two fixes stacked here — the
// earlier one widened Amount Due to carry uncovered charges; this one widened
// grand to carry every line, so the charge is no longer asked for in one figure
// and absent from the document's own total. covered falls out as the remainder.
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-07-17", delivered_at: "2026-07-17T10:00:00Z", rate_sar: 500 },
  ];
  const topups: TopupLite[] = [{ id: "top1", amount_sar: 1000, topup_date: "2026-07-01" }];
  const r = assembleInvoice({
    customerId: "c1",
    paymentMode: "prepaid",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    trips,
    topups,
    specialCharges: [{ id: "ch1", label: "emergency hours", amount_sar: 450, charge_date: "2026-07-18" }],
  });
  check("stranded-charge: the charge is tagged uncovered (517.50 did not fit in 425)", r.chargeLines.find((l) => l.id === "ch1")?.covered, false);
  check("stranded-charge: covered trip still covered", r.coveredLines.map((l) => l.id), ["t1"]);
  check("stranded-charge: no unpaid TRIPS at all", r.unpaidLines, []);
  check("stranded-charge: amountDue = the uncovered charge, VAT-inclusive (was 0/0/0 and lost)", r.amountDue, {
    subtotal: 450,
    vat: 67.5,
    total: 517.5,
  });
  check("stranded-charge: grand = covered trip 500 + the uncovered charge 450, one VAT pass", r.grand, {
    subtotal: 950,
    vat: 142.5,
    total: 1092.5,
  });
  check("stranded-charge: covered = grand - amountDue = the trip alone", r.covered, {
    subtotal: 500,
    vat: 75,
    total: 575,
  });
  // The ledger is the Unpaid TRIPS table's own footer and must keep describing
  // that table's rows — it stays at zero here even though Amount Due is 517.50.
  // This inequality is the fix, not a bug: see lib/invoice.ts's AMOUNT DUE note.
  check("stranded-charge: ledger.unpaid stays TRIPS-only (0), not widened", r.ledger?.unpaid.subtotal, 0);
  checkTrue(
    "stranded-charge: amountDue.total is NO LONGER equal to ledger.unpaid.subtotal",
    r.amountDue.total !== r.ledger?.unpaid.subtotal,
  );
  check(
    "stranded-charge: amountDue.total - ledger.unpaid.subtotal = the uncovered charge exactly",
    Math.round((r.amountDue.total - (r.ledger?.unpaid.subtotal ?? 0)) * 100) / 100,
    517.5,
  );
  reconciles("stranded-charge", r);
}

// --- Unpaid TRIPS and an uncovered charge TOGETHER (the two halves add) -----
// Pool 600. Trip A 500 -> consumes 575, covered, 25 left. Trip B 200 ->
// consumes 230, does not fit -> unpaid (and hitWall, so everything after is
// unpaid too). Charge 100 -> consumes 115, uncovered.
// amountDue = ledger.unpaid.subtotal (230, trips) + 115 (charge) = 345.
// Pre-VAT subtotal = 200 + 100 = 300. VAT = 345 - 300 = 45.
{
  const trips: ConsumingTrip[] = [
    { id: "tA", trip_date: "2026-07-01", delivered_at: "2026-07-01T10:00:00Z", rate_sar: 500 },
    { id: "tB", trip_date: "2026-07-02", delivered_at: "2026-07-02T10:00:00Z", rate_sar: 200 },
  ];
  const topups: TopupLite[] = [{ id: "top1", amount_sar: 600, topup_date: "2026-07-01" }];
  const r = assembleInvoice({
    customerId: "c1",
    paymentMode: "prepaid",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    trips,
    topups,
    specialCharges: [{ id: "ch1", label: "uncovered charge", amount_sar: 100, charge_date: "2026-07-03" }],
  });
  check("both halves: tA covered, tB unpaid", [r.coveredLines.map((l) => l.id), r.unpaidLines.map((l) => l.id)], [["tA"], ["tB"]]);
  check("both halves: charge uncovered", r.chargeLines.find((l) => l.id === "ch1")?.covered, false);
  check("both halves: ledger.unpaid.subtotal is the TRIP half only (230)", r.ledger?.unpaid.subtotal, 230);
  check("both halves: amountDue = 230 (trips) + 115 (charge)", r.amountDue, { subtotal: 300, vat: 45, total: 345 });
  check("both halves: grand = tA 500 + tB 200 + charge 100, one VAT pass", r.grand, { subtotal: 800, vat: 120, total: 920 });
  check("both halves: covered = grand - amountDue = tA alone", r.covered, { subtotal: 500, vat: 75, total: 575 });
  reconciles("both halves", r);
}

// --- A COVERED charge must NOT leak into Amount Due (the complement) --------
// Pool 2,000 covers the trip (575) and the charge (115) both. The charge
// belongs in grand, and Amount Due must stay at zero — the fix widens Amount
// Due for UNCOVERED charges only, and this is what proves it did not widen it
// for all of them.
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-07-01", delivered_at: "2026-07-01T10:00:00Z", rate_sar: 500 },
  ];
  const topups: TopupLite[] = [{ id: "top1", amount_sar: 2000, topup_date: "2026-07-01" }];
  const r = assembleInvoice({
    customerId: "c1",
    paymentMode: "prepaid",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    trips,
    topups,
    specialCharges: [{ id: "ch1", label: "covered charge", amount_sar: 100, charge_date: "2026-07-02" }],
  });
  check("covered charge: tagged covered", r.chargeLines.find((l) => l.id === "ch1")?.covered, true);
  check("covered charge: amountDue stays ZERO", r.amountDue, { subtotal: 0, vat: 0, total: 0 });
  check("covered charge: grand = trip 500 + charge 100, one VAT pass", r.grand, { subtotal: 600, vat: 90, total: 690 });
  check("covered charge: covered = the whole invoice (nothing due)", r.covered, { subtotal: 600, vat: 90, total: 690 });
  reconciles("covered charge", r);
}

// --- A FUTURE-DATED charge is covered when the pool suffices ----------------
// THE INVERTED REGRESSION GUARD. This case FAILS LOUDLY if the charge_date
// gate ever returns to consumingItems().
//
// The charge is dated 2026-08-15, AFTER periodEnd 2026-07-31. Under the old
// `charge_date <= asOfDate` filter it never reached the FIFO walk, so it could
// not be covered no matter how large the pool — while chargeLines listed it and
// v_customer_prepaid_balance (no date predicate, ever) had already deducted its
// 115.00. Live invoice 026-000017 is exactly this: a 1,000.00 charge dated
// after its period, shown, deducted, and billed to nobody.
//
// Note the old filter was ONE-SIDED (`<=`), so only FUTURE-dated charges were
// stranded — a past-dated charge always passed, which is why this went unseen.
// A charge is scoped by its invoice FK, never by date; periodEnd scopes TRIPS.
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-07-10", delivered_at: "2026-07-10T10:00:00Z", rate_sar: 500 },
  ];
  const topups: TopupLite[] = [{ id: "top1", amount_sar: 2000, topup_date: "2026-07-01" }];
  const r = assembleInvoice({
    customerId: "c1",
    paymentMode: "prepaid",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    trips,
    topups,
    specialCharges: [{ id: "ch1", label: "charge dated after periodEnd", amount_sar: 100, charge_date: "2026-08-15" }],
  });
  check("future-dated charge: still listed on the invoice (was already true — 0181)", r.chargeLines.map((l) => l.id), ["ch1"]);
  check("future-dated charge: COVERED — pool 2000 easily holds 575 + 115", r.chargeLines.find((l) => l.id === "ch1")?.covered, true);
  check("future-dated charge: amountDue stays ZERO (was 115 due on a settled charge)", r.amountDue, { subtotal: 0, vat: 0, total: 0 });
  check("future-dated charge: inside grand = trip 500 + charge 100", r.grand, { subtotal: 600, vat: 90, total: 690 });
  reconciles("future-dated charge", r);
}

// --- A FUTURE-DATED charge is UNCOVERED when the pool does not suffice ------
// The complement of the case above, and the half that proves the gate's removal
// did not simply flip every charge to covered. Pool 600: the trip consumes 575,
// leaving 25, so the charge's 115 does not fit. It reaches the FIFO walk (no
// date gate) and is refused there on the MERITS, which is the difference.
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-07-10", delivered_at: "2026-07-10T10:00:00Z", rate_sar: 500 },
  ];
  const topups: TopupLite[] = [{ id: "top1", amount_sar: 600, topup_date: "2026-07-01" }];
  const r = assembleInvoice({
    customerId: "c1",
    paymentMode: "prepaid",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    trips,
    topups,
    specialCharges: [{ id: "ch1", label: "charge dated after periodEnd", amount_sar: 100, charge_date: "2026-08-15" }],
  });
  check("future-dated charge (poor pool): uncovered on the merits, not by date", r.chargeLines.find((l) => l.id === "ch1")?.covered, false);
  check("future-dated charge (poor pool): amountDue = the charge alone", r.amountDue, { subtotal: 100, vat: 15, total: 115 });
  check("future-dated charge (poor pool): inside grand all the same", r.grand, { subtotal: 600, vat: 90, total: 690 });
  reconciles("future-dated charge (poor pool)", r);
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
  reconciles("empty", r);
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
  // grand drops t2 with the tables. A line reserved by ANOTHER invoice is that
  // invoice's to total; carrying it here would bill the same trip on two
  // documents. reconciles() proves the exclusion reached all three figures.
  check("reserve-exclusion: grand = t1 + t3 only, t2 excluded from the total too", r.grand, { subtotal: 200, vat: 30, total: 230 });
  reconciles("reserve-exclusion", r);
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
  reconciles("postpaid reserve-exclusion", r);
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
  reconciles("no exclusion", r);
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
