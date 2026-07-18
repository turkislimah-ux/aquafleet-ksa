// Math confidence harness for the prepaid balance ledger. No DB, no test framework.
// Run:  npx tsx scripts/prepaid-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).
//
// v3 cutover (finance-invoice-spec.md v3 §2/§4.2/§5): the legacy v2 cases
// (consumingTrips/derivedBalance/buildStatement — pre-VAT, trips-only) are
// RETIRED along with the functions themselves (deleted from lib/prepaid.ts —
// see its header). Every case below now targets the v3 functions
// (consumingItems/derivedBalanceItems/buildStatementItems) — VAT-inclusive
// consumption, one combined trips+charges FIFO queue — the ONLY consumption
// engine left in the tree.

import {
  consumingItems,
  derivedBalanceItems,
  buildStatementItems,
  type ConsumingTrip,
  type TopupLite,
  type ConsumingCharge,
  type TopupStatementInput,
} from "../lib/prepaid";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}` + (ok ? "" : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`));
}

// --- Top-ups only (no trips/charges) -----------------------------------------
check(
  "top-ups only: balance = sum(top-ups)",
  derivedBalanceItems(
    [
      { id: "u1", amount_sar: 1000, topup_date: "2026-06-01" },
      { id: "u2", amount_sar: 500, topup_date: "2026-06-10" },
    ],
    [],
  ),
  1500,
);

// --- Ordering by trip_date (input scrambled + delivered out of order) -------
{
  const scrambled: ConsumingTrip[] = [
    { id: "c", trip_date: "2026-06-05", delivered_at: "2026-06-05T14:00:00.000Z", rate_sar: 60 }, // 3rd
    { id: "a", trip_date: "2026-06-03", delivered_at: "2026-06-06T09:00:00.000Z", rate_sar: 60 }, // 1st by trip_date despite LATEST delivered_at
    { id: "b", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 60 }, // 2nd
  ];
  check(
    "consumingItems orders trips by trip_date, not delivered_at or input order",
    consumingItems(scrambled, []).map((e) => e.id),
    ["a", "b", "c"],
  );
}

// --- Same trip_date: tiebreak by delivered_at, then id -----------------------
{
  const sameDayTiebreak: ConsumingTrip[] = [
    { id: "z", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 10 },
    { id: "a", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 10 }, // same instant as z -> id tiebreak
    { id: "m", trip_date: "2026-06-03", delivered_at: "2026-06-03T06:00:00.000Z", rate_sar: 10 }, // earlier delivered_at -> first
  ];
  check(
    "same trip_date: tiebreak delivered_at then id",
    consumingItems(sameDayTiebreak, []).map((e) => e.id),
    ["m", "a", "z"],
  );
}

// --- A paid-invoice-locked trip still counts as consumed ---------------------
// Extra lock fields (invoice_id/payout_id) are present on the fixture but the
// ConsumingTrip type doesn't even declare them — proving structurally that
// consumption never looks at lock state, only (trip_date, delivered_at, rate).
{
  type LockedFixture = ConsumingTrip & { invoice_id: string | null; payout_id: string | null };
  const lockedTrip: LockedFixture[] = [
    { id: "locked1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 300, invoice_id: "inv-1", payout_id: "payout-1" },
  ];
  // 300 * 1.15 = 345 consumed (VAT-inclusive), 1000 - 345 = 655.
  check(
    "paid-invoice-locked trip still consumes balance (VAT-inclusive)",
    derivedBalanceItems([{ id: "u1", amount_sar: 1000, topup_date: "2026-06-01" }], lockedTrip),
    655,
  );
}

// --- asOfDate cutoff: future top-ups/trips excluded ---------------------------
{
  const futureTopups: TopupLite[] = [
    { id: "u1", amount_sar: 500, topup_date: "2026-06-01" },
    { id: "u2", amount_sar: 500, topup_date: "2026-07-15" }, // after cutoff
  ];
  const futureTrips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-05", delivered_at: "2026-06-05T08:00:00.000Z", rate_sar: 100 },
    { id: "t2", trip_date: "2026-07-20", delivered_at: "2026-07-20T08:00:00.000Z", rate_sar: 100 }, // after cutoff
  ];
  // 100 * 1.15 = 115 consumed, 500 - 115 = 385.
  check(
    "asOfDate cutoff excludes later top-ups and trips: 500 - 115 = 385",
    derivedBalanceItems(futureTopups, futureTrips, [], "2026-06-30"),
    385,
  );
}

// --- Money rounding (no float drift) -----------------------------------------
{
  // consumedAmount per trip = round2(33.33 * 1.15) = 38.33 (x2 = 76.66).
  check(
    "rounding: fractional rates sum cleanly (VAT-inclusive)",
    derivedBalanceItems([{ id: "u1", amount_sar: 100.1, topup_date: "2026-06-01" }], [
      { id: "t1", trip_date: "2026-06-02", delivered_at: "2026-06-02T08:00:00.000Z", rate_sar: 33.33 },
      { id: "t2", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 33.33 },
    ]),
    23.44,
  );
}

// --- VAT-inclusive consumption: a 400 trip consumes 460 (400 * 1.15) --------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 1000, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 400 },
  ];
  const items = consumingItems(trips, [], undefined);
  check("VAT-inclusive: 400 trip -> amount stays 400 (pre-VAT, display)", items[0].amount, 400);
  check("VAT-inclusive: 400 trip -> consumedAmount = 460 (400 * 1.15)", items[0].consumedAmount, 460);
  check("VAT-inclusive: balance = 1000 - 460 = 540", derivedBalanceItems(topups, trips), 540);
}

// --- Charge consumes VAT-inclusive too: 200 charge consumes 230 -------------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 500, topup_date: "2026-06-01" }];
  const charges: ConsumingCharge[] = [{ id: "ch1", charge_date: "2026-06-05", amount_sar: 200, label: "Extra hose fee" }];
  const items = consumingItems([], charges);
  check("charge-only: 1 item, kind=charge", items.map((i) => i.kind), ["charge"]);
  check("charge-only: amount stays 200 (pre-VAT, display)", items[0].amount, 200);
  check("charge-only: consumedAmount = 230 (200 * 1.15)", items[0].consumedAmount, 230);
  check("charge-only: balance = 500 - 230 = 270", derivedBalanceItems(topups, [], charges), 270);
}

// --- Trip + charge interleaved by date, one combined queue -------------------
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-01", delivered_at: "2026-06-01T08:00:00.000Z", rate_sar: 100 },
    { id: "t3", trip_date: "2026-06-10", delivered_at: "2026-06-10T08:00:00.000Z", rate_sar: 100 },
  ];
  const charges: ConsumingCharge[] = [{ id: "ch2", charge_date: "2026-06-05", amount_sar: 50, label: "Fee" }];
  const items = consumingItems(trips, charges);
  check(
    "interleaved queue: date-ordered across kinds (t1, ch2, t3)",
    items.map((i) => i.id),
    ["t1", "ch2", "t3"],
  );
}

// --- Same-date tiebreak: trip before charge (deterministic) ------------------
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-05", delivered_at: "2026-06-05T08:00:00.000Z", rate_sar: 100 },
  ];
  const charges: ConsumingCharge[] = [{ id: "ch1", charge_date: "2026-06-05", amount_sar: 50 }];
  const items = consumingItems(trips, charges);
  check("same-date tiebreak: trip sorts before charge", items.map((i) => i.id), ["t1", "ch1"]);
}

// --- Over-balance from charges alone (no trips at all) ------------------------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 100, topup_date: "2026-06-01" }];
  const charges: ConsumingCharge[] = [{ id: "ch1", charge_date: "2026-06-05", amount_sar: 100 }];
  // consumedAmount = 115 > pool 100 -> balance goes negative from charges alone.
  check("over-balance from charges alone: 100 - 115 = -15", derivedBalanceItems(topups, [], charges), -15);
}

// --- Void invoice's charges released: simply excluded from the array --------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 500, topup_date: "2026-06-01" }];
  const chargeOnVoidInvoice: ConsumingCharge[] = [{ id: "ch-void", charge_date: "2026-06-05", amount_sar: 500 }];
  const included = derivedBalanceItems(topups, [], chargeOnVoidInvoice);
  check("charge included (non-void invoice): balance = 500 - 575 = -75", included, -75);
  // "Released" = the caller simply omits a void invoice's charges when
  // building the ConsumingCharge[] array — no flag/state here.
  const released = derivedBalanceItems(topups, [], []);
  check("charge released (invoice voided -> excluded from array): balance restored to 500", released, 500);
}

// --- Reversed trip restores balance -------------------------------------------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 1000, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 400 },
  ];
  check("reversal — before: 1000 - 460 = 540", derivedBalanceItems(topups, trips), 540);
  const afterReversal: ConsumingTrip[] = [{ ...trips[0], delivered_at: null }];
  check("reversal — after: trip drops out, balance restored to 1000", derivedBalanceItems(topups, afterReversal), 1000);
}

// --- Undelivered trips never consume ------------------------------------------
check(
  "undelivered trip never consumes",
  derivedBalanceItems([{ id: "u1", amount_sar: 1000, topup_date: "2026-06-01" }], [
    { id: "t9", trip_date: "2026-06-06", delivered_at: null, rate_sar: 999 },
  ]),
  1000,
);

// --- buildStatementItems: VAT-inclusive debits, three kinds, running balance -
{
  const topups: TopupStatementInput[] = [{ id: "u1", amount_sar: 1000, topup_date: "2026-06-01", note: null, reference: null }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 400 },
  ];
  const charges: ConsumingCharge[] = [{ id: "ch1", charge_date: "2026-06-05", amount_sar: 100, label: "Fee" }];
  const stmt = buildStatementItems(topups, trips, charges);
  check("statement: 3 entries (topup, trip, charge)", stmt.map((e) => e.kind), ["topup", "trip", "charge"]);
  check("statement: VAT-inclusive debits (-460, -115)", stmt.map((e) => e.amount), [1000, -460, -115]);
  check("statement: running balances", stmt.map((e) => e.runningBalance), [1000, 540, 425]);
  check(
    "statement final balance matches derivedBalanceItems",
    stmt[stmt.length - 1].runningBalance,
    derivedBalanceItems(topups, trips, charges),
  );
}

// --- Statement same-day tiebreak: credit before debit ------------------------
{
  const sameDayStmt = buildStatementItems(
    [{ id: "u1", amount_sar: 500, topup_date: "2026-06-03", note: null, reference: null }],
    [{ id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 200 }],
    [],
  );
  check("statement same-day: credit (topup) before debit (trip)", sameDayStmt.map((e) => e.kind), ["topup", "trip"]);
  // 200 * 1.15 = 230 consumed -> 500 - 230 = 270.
  check("statement same-day running balances", sameDayStmt.map((e) => e.runningBalance), [500, 270]);
}

console.log("");
if (failures === 0) {
  console.log("All prepaid checks PASSED ✓");
  process.exit(0);
} else {
  console.log(`${failures} prepaid check(s) FAILED ✗`);
  process.exit(1);
}
