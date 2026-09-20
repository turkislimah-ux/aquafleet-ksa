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

  // 3. LEDGER ERA (0203). The whole document is billable, in BOTH modes:
  //    covered is zero, amountDue === grand, and no line carries a coverage
  //    verdict. The prepaid draw is min(Available, grand_total), decided by
  //    confirm_invoice() and frozen onto the invoice row — it is not a property
  //    of any line, so this engine cannot express it and must not pretend to.
  //    Asserted on EVERY case, so a re-introduced split fails everywhere at
  //    once rather than in the one case someone remembered to write.
  check(`${name}: covered is zero (the draw is a ledger fact, not a line split)`, r.covered, {
    subtotal: 0,
    vat: 0,
    total: 0,
  });
  checkTrue(
    `${name}: amountDue === grand EXACTLY (the whole invoice is billable)`,
    JSON.stringify(r.amountDue) === JSON.stringify(r.grand),
  );
  check(`${name}: coveredLines is empty in both modes`, r.coveredLines, []);
  checkTrue(
    `${name}: no line carries a coverage verdict`,
    [...r.coveredLines, ...r.unpaidLines, ...r.chargeLines].every((l) => l.covered === undefined),
  );
  check(`${name}: no tripTotals — one trips table, document-level foot`, r.tripTotals, undefined);
}

// THE POOL CANNOT MOVE THE DOCUMENT. Asserts that an assembly is byte-identical
// under any topup/refund history whatsoever — the single sharpest statement of
// the 0203 cutover, and the one that fails loudest if a FIFO walk ever returns
// to this engine. Call it with the case's own input.
function poolCannotMove(name: string, input: Parameters<typeof assembleInvoice>[0]) {
  const baseline = JSON.stringify(assembleInvoice({ ...input, topups: [], returns: [] }));
  const drowning = JSON.stringify(
    assembleInvoice({
      ...input,
      topups: [{ id: "flood", amount_sar: 9_999_999, topup_date: "2000-01-01" }],
      returns: [],
    }),
  );
  const broke = JSON.stringify(
    assembleInvoice({
      ...input,
      topups: [{ id: "tiny", amount_sar: 0.01, topup_date: "2000-01-01" }],
      returns: [{ id: "ref", amount_sar: 5_000, returned_on: "2000-01-02" }],
    }),
  );
  checkTrue(
    `${name}: identical assembly with an empty pool, a flooded pool, and a refunded pool`,
    baseline === drowning && baseline === broke,
  );
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

// --- Prepaid: the period window is the ONLY scope. An out-of-period trip is --
// --- absent from the document and cannot influence it. ----------------------
// WAS THE "global-then-filter" CASE. Under the pre-0203 law this fixture proved
// something subtler: May's trip had to be PASSED IN (full history) because it
// drained the pool BEFORE June's trip was evaluated, which is what made June's
// trip Unpaid. That coupling is gone — no pool is walked here — so what this
// fixture now proves is the plainer rule that replaced it: the period window
// scopes the document, full stop. Passing extra history changes nothing.
{
  const trips: ConsumingTrip[] = [
    { id: "tA-prior-period", trip_date: "2026-05-15", delivered_at: "2026-05-15T10:00:00Z", rate_sar: 300 },
    { id: "tB-this-period", trip_date: "2026-06-15", delivered_at: "2026-06-15T10:00:00Z", rate_sar: 300 },
  ];
  // A pool that EXACTLY covers one trip — the amount that used to flip the
  // verdict. It is now inert, which poolCannotMove() states outright.
  const topups: TopupLite[] = [{ id: "top1", amount_sar: 300, topup_date: "2026-05-01" }];
  const input = {
    customerId: "c1",
    paymentMode: "prepaid" as const,
    periodStart: "2026-06-01", // THIS period only covers June
    periodEnd: "2026-06-30",
    trips, // full history passed, including May's trip
    topups,
    specialCharges: [],
  };
  const r = assembleInvoice(input);
  check("period scope: June's trip is billed on this invoice", r.unpaidLines.map((l) => l.id), ["tB-this-period"]);
  check("period scope: May's trip does not appear at all (outside period)", r.grand, { subtotal: 300, vat: 45, total: 345 });
  poolCannotMove("period scope", input);
  reconciles("period scope", r);
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

// --- THE ROUNDING-CONVERGENCE PROOF — the halala the old engine argued over --
// --- no longer exists, because there is only ONE rounding convention left. ---
// WAS THE "boundary flip / divergence proof" CASE, kept at the same fixture
// (pool 0.10, three trips of 0.05) because this is where the two old
// conventions were furthest apart at the smallest scale. Under the pre-0203 law
// the pool covered t1 only, and the document carried TWO roundings at once:
//   grand:     one document-level pass over all three — 0.15 / 0.02 / 0.17
//   amountDue: per-item VAT-inclusive, pool-exact — 0.10 / 0.02 / 0.12
//   covered:   grand - amountDue = 0.05 / 0.00 / 0.05, and a standalone pass
//              over that same single line would have said 0.06 instead. That
//              halala had to be parked in a settled figure to keep the invoice
//              adding up.
//
// There is now ONE pass over ONE line set, so there is nothing for a second
// convention to disagree with: 0.15 / 0.02 / 0.17, billed in full. The halala
// is not resolved, it is UNREACHABLE. If a per-item pool-exact total ever
// returns to this engine, amountDue drops to 0.12 here and this fails.
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-01", delivered_at: "2026-06-01T10:00:00Z", rate_sar: 0.05 },
    { id: "t2", trip_date: "2026-06-02", delivered_at: "2026-06-02T10:00:00Z", rate_sar: 0.05 },
    { id: "t3", trip_date: "2026-06-03", delivered_at: "2026-06-03T10:00:00Z", rate_sar: 0.05 },
  ];
  const topups: TopupLite[] = [{ id: "top1", amount_sar: 0.1, topup_date: "2026-06-01" }];
  const input = {
    customerId: "c1",
    paymentMode: "prepaid" as const,
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    trips,
    topups,
    specialCharges: [],
  };
  const r = assembleInvoice(input);
  check("convergence: all three trips billed (the pool covers none of them here)", r.unpaidLines.map((l) => l.id), ["t1", "t2", "t3"]);
  check("convergence: grand = one document pass over all three = 0.15/0.02/0.17", r.grand, { subtotal: 0.15, vat: 0.02, total: 0.17 });
  check("convergence: amountDue is the SAME figure, not the per-item 0.12", r.amountDue, { subtotal: 0.15, vat: 0.02, total: 0.17 });
  // THE DEAD RESIDUE, NAMED. Per-item VAT-inclusive consumption of two of these
  // lines is 0.12 and of one is 0.06 — the figures the old covered/unpaid split
  // produced. Neither appears anywhere on the document now.
  checkTrue(
    "convergence: neither old per-item figure (0.12 / 0.06) survives on any total",
    [r.grand, r.amountDue, r.covered].every((t) => t.total !== 0.12 && t.total !== 0.06),
  );
  check("convergence: per-item rounding of one line would still say 0.06 — nothing reads it", r2(0.05 * 1.15), 0.06);
  poolCannotMove("convergence", input);
  reconciles("convergence", r);
}

// --- THE STRANDED CHARGE CANNOT RECUR: every charge is billed, always -------
// This is invoice 026-000009's exact shape, in miniature, and it is the case
// that used to lose money. Under the pre-0203 law the 450 charge did not fit in
// what the pool had left after the trip (425 < 517.50), so it was tagged
// UNCOVERED — and in the version before that it then appeared in NO document
// total at all, while v_customer_prepaid_balance had already deducted its
// 517.50. A charge is FK-bound to one invoice at creation and hidden from every
// other by reservedElsewhereIds, so it could never be billed later either.
//
// The fit question is gone: there is no per-line coverage verdict to get wrong.
// Every charge on the document is in amountDue AND in grand, whatever the pool
// held. THE POOL SIZE IS THE INVERTED PART — 1,000 is deliberately the amount
// that used to strand this charge, and poolCannotMove() proves no pool strands
// it now.
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-07-17", delivered_at: "2026-07-17T10:00:00Z", rate_sar: 500 },
  ];
  const topups: TopupLite[] = [{ id: "top1", amount_sar: 1000, topup_date: "2026-07-01" }];
  const input = {
    customerId: "c1",
    paymentMode: "prepaid" as const,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    trips,
    topups,
    specialCharges: [{ id: "ch1", label: "emergency hours", amount_sar: 450, charge_date: "2026-07-18" }],
  };
  const r = assembleInvoice(input);
  check("stranded-charge: the charge carries NO coverage verdict", r.chargeLines.find((l) => l.id === "ch1")?.covered, undefined);
  check("stranded-charge: the trip is billed like any other", r.unpaidLines.map((l) => l.id), ["t1"]);
  check("stranded-charge: amountDue = trip 500 + charge 450, one VAT pass (was 0/0/0 and lost)", r.amountDue, {
    subtotal: 950,
    vat: 142.5,
    total: 1092.5,
  });
  check("stranded-charge: grand is the same figure", r.grand, { subtotal: 950, vat: 142.5, total: 1092.5 });
  poolCannotMove("stranded-charge", input);
  reconciles("stranded-charge", r);
}

// --- Trips and charges TOGETHER, one document-level VAT pass ----------------
// WAS "both halves" — under the old law the pool (600) covered trip A, stranded
// trip B behind the FIFO wall, and left the charge uncovered, so the document
// carried a 575 covered half and a 345 due half. Both halves are now one
// number: 500 + 200 + 100 = 800 pre-VAT, one pass, 920.
{
  const trips: ConsumingTrip[] = [
    { id: "tA", trip_date: "2026-07-01", delivered_at: "2026-07-01T10:00:00Z", rate_sar: 500 },
    { id: "tB", trip_date: "2026-07-02", delivered_at: "2026-07-02T10:00:00Z", rate_sar: 200 },
  ];
  const topups: TopupLite[] = [{ id: "top1", amount_sar: 600, topup_date: "2026-07-01" }];
  const input = {
    customerId: "c1",
    paymentMode: "prepaid" as const,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    trips,
    topups,
    specialCharges: [{ id: "ch1", label: "a charge", amount_sar: 100, charge_date: "2026-07-03" }],
  };
  const r = assembleInvoice(input);
  check("one table: both trips billed together, no wall between them", r.unpaidLines.map((l) => l.id), ["tA", "tB"]);
  check("one table: the charge sits in its own table, untagged", [r.chargeLines.map((l) => l.id), r.chargeLines[0]?.covered], [["ch1"], undefined]);
  check("one table: amountDue = tA 500 + tB 200 + charge 100, one VAT pass", r.amountDue, { subtotal: 800, vat: 120, total: 920 });
  // 575 was the old covered half and 345 the old due half. Their absence from
  // every total is what says the split is gone, not merely unused.
  checkTrue(
    "one table: the old 575 / 345 halves appear nowhere",
    [r.grand, r.amountDue, r.covered].every((t) => t.total !== 575 && t.total !== 345),
  );
  poolCannotMove("one table", input);
  reconciles("one table", r);
}

// --- A FULLY-FUNDED customer is still billed the full amount ----------------
// WAS "covered charge" — pool 2,000 against a 690 invoice, i.e. the customer
// can pay for all of it out of credit. Under the old law that made Amount Due
// ZERO and the whole document "settled" before confirm. Now the document says
// 690 due, and the draw against the 2,000 happens at confirm_invoice() and is
// reported as prepaid_applied / amount_payable — NOT by zeroing the invoice.
// This is the case most likely to be "fixed" back by someone who reads a
// funded prepaid invoice as paid.
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-07-01", delivered_at: "2026-07-01T10:00:00Z", rate_sar: 500 },
  ];
  const topups: TopupLite[] = [{ id: "top1", amount_sar: 2000, topup_date: "2026-07-01" }];
  const input = {
    customerId: "c1",
    paymentMode: "prepaid" as const,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    trips,
    topups,
    specialCharges: [{ id: "ch1", label: "a charge", amount_sar: 100, charge_date: "2026-07-02" }],
  };
  const r = assembleInvoice(input);
  check("fully funded: the charge carries NO coverage verdict", r.chargeLines.find((l) => l.id === "ch1")?.covered, undefined);
  check("fully funded: amountDue is the FULL invoice, not zero", r.amountDue, { subtotal: 600, vat: 90, total: 690 });
  check("fully funded: grand is the same figure", r.grand, { subtotal: 600, vat: 90, total: 690 });
  poolCannotMove("fully funded", input);
  reconciles("fully funded", r);
}

// --- A FUTURE-DATED charge is LISTED AND BILLED. STILL THE LIVE GUARD. ------
// THE ONE CASE IN THIS GROUP THAT 0203 DID NOT WEAKEN. It fails loudly if a
// charge_date gate ever returns — to consumingItems(), or to the charge filter
// in lib/invoice.ts's prepaid arm, which is still deliberately un-period-
// filtered and is the easier of the two to "tidy up" by mistake.
//
// The charge is dated 2026-08-15, AFTER periodEnd 2026-07-31. Under the old
// `charge_date <= asOfDate` filter it never reached the money at all, while
// chargeLines listed it and v_customer_prepaid_balance (no date predicate,
// ever) had already deducted it. Live invoice 026-000017 is exactly this: a
// 1,000.00 charge dated after its period, shown, deducted, billed to nobody.
//
// The old filter was ONE-SIDED (`<=`), so only FUTURE-dated charges were
// stranded — a past-dated charge always passed, which is why this went unseen.
// A charge is scoped by its invoice FK, never by date; periodEnd scopes TRIPS.
//
// Run over both a rich and a poor pool. Under the old law these two fixtures
// produced DIFFERENT documents (covered vs uncovered); identical output is now
// the assertion.
for (const [poolName, pool] of [
  ["rich pool", 2000],
  ["poor pool", 600],
] as const) {
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-07-10", delivered_at: "2026-07-10T10:00:00Z", rate_sar: 500 },
  ];
  const topups: TopupLite[] = [{ id: "top1", amount_sar: pool, topup_date: "2026-07-01" }];
  const input = {
    customerId: "c1",
    paymentMode: "prepaid" as const,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    trips,
    topups,
    specialCharges: [{ id: "ch1", label: "charge dated after periodEnd", amount_sar: 100, charge_date: "2026-08-15" }],
  };
  const r = assembleInvoice(input);
  const label = `future-dated charge (${poolName})`;
  check(`${label}: still listed on the invoice (0181)`, r.chargeLines.map((l) => l.id), ["ch1"]);
  check(`${label}: BILLED — inside amountDue = trip 500 + charge 100`, r.amountDue, { subtotal: 600, vat: 90, total: 690 });
  check(`${label}: grand is the same figure`, r.grand, { subtotal: 600, vat: 90, total: 690 });
  poolCannotMove(label, input);
  reconciles(label, r);
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
// --- is excluded from THIS invoice's output, and from its totals. ----------
// STILL LIVE, and the half that matters most survived 0203 intact: a trip
// claimed by another non-void invoice must appear in NO table and in NO total
// here, or the same trip is billed on two documents.
//
// What the fixture used to ALSO prove is gone. Pool 230 = exactly 2 x 115, and
// the old question was whether excluding t2 "un-spent" the pool and flipped t3
// to covered (it must not — exclusion was a POST-split display filter). There
// is no split and no pool walk left to order wrongly, so the pool is kept at
// 230 only to show it no longer decides anything.
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-01", delivered_at: "2026-06-01T10:00:00Z", rate_sar: 100 },
    { id: "t2", trip_date: "2026-06-02", delivered_at: "2026-06-02T10:00:00Z", rate_sar: 100 },
    { id: "t3", trip_date: "2026-06-03", delivered_at: "2026-06-03T10:00:00Z", rate_sar: 100 },
  ];
  const topups: TopupLite[] = [{ id: "top1", amount_sar: 230, topup_date: "2026-06-01" }];
  const input = {
    customerId: "c1",
    paymentMode: "prepaid" as const,
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    trips,
    topups,
    specialCharges: [],
    reservedElsewhereIds: ["t2"],
  };
  const r = assembleInvoice(input);
  check("reserve-exclusion: t1 + t3 billed, t2 (reserved elsewhere) absent", r.unpaidLines.map((l) => l.id), ["t1", "t3"]);
  // grand drops t2 with the tables. A line reserved by ANOTHER invoice is that
  // invoice's to total; carrying it here would bill the same trip on two
  // documents. reconciles() proves the exclusion reached all three figures.
  check("reserve-exclusion: grand = t1 + t3 only, t2 excluded from the total too", r.grand, { subtotal: 200, vat: 30, total: 230 });
  poolCannotMove("reserve-exclusion", input);
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
