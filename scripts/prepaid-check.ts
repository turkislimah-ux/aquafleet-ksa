// Math confidence harness for the prepaid balance ledger. No DB, no test framework.
// Run:  npx tsx scripts/prepaid-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).

import { consumingTrips, derivedBalance, buildStatement, type ConsumingTrip, type TopupLite } from "../lib/prepaid";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}` + (ok ? "" : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`));
}

// --- Top-ups only (no trips) -------------------------------------------------
check(
  "top-ups only: balance = sum(top-ups)",
  derivedBalance(
    [
      { id: "u1", amount_sar: 1000, topup_date: "2026-06-01" },
      { id: "u2", amount_sar: 500, topup_date: "2026-06-10" },
    ],
    [],
  ),
  1500,
);

// --- Top-ups minus trips -----------------------------------------------------
const baseTrips: ConsumingTrip[] = [
  { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 200 },
  { id: "t2", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 200 },
  { id: "t3", trip_date: "2026-06-05", delivered_at: "2026-06-05T08:00:00.000Z", rate_sar: 200 },
];
const baseTopups: TopupLite[] = [{ id: "u1", amount_sar: 1000, topup_date: "2026-06-01" }];
check("top-ups minus trips: 1000 - 600 = 400", derivedBalance(baseTopups, baseTrips), 400);

// --- Reversed trip restores balance (delivered_at nulled -> drops out) ------
const afterReversal: ConsumingTrip[] = [
  baseTrips[0],
  { ...baseTrips[1], delivered_at: null }, // reversed
  baseTrips[2],
];
check("reversed trip restores balance: 1000 - 400 = 600", derivedBalance(baseTopups, afterReversal), 600);

// --- Not-yet-delivered trips (delivered_at null from the start) don't consume
check(
  "undelivered trip never consumes",
  derivedBalance(baseTopups, [{ id: "t9", trip_date: "2026-06-06", delivered_at: null, rate_sar: 999 }]),
  1000,
);

// --- Ordering by trip_date (input scrambled + delivered out of order) -------
const scrambled: ConsumingTrip[] = [
  { id: "c", trip_date: "2026-06-05", delivered_at: "2026-06-05T14:00:00.000Z", rate_sar: 60 }, // 3rd
  { id: "a", trip_date: "2026-06-03", delivered_at: "2026-06-06T09:00:00.000Z", rate_sar: 60 }, // 1st by trip_date despite LATEST delivered_at
  { id: "b", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 60 }, // 2nd
];
check(
  "consumingTrips orders by trip_date, not delivered_at or input order",
  consumingTrips(scrambled).map((e) => e.id),
  ["a", "b", "c"],
);

// --- Same trip_date: tiebreak by delivered_at, then id -----------------------
const sameDayTiebreak: ConsumingTrip[] = [
  { id: "z", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 10 },
  { id: "a", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 10 }, // same instant as z -> id tiebreak
  { id: "m", trip_date: "2026-06-03", delivered_at: "2026-06-03T06:00:00.000Z", rate_sar: 10 }, // earlier delivered_at -> first
];
check(
  "same trip_date: tiebreak delivered_at then id",
  consumingTrips(sameDayTiebreak).map((e) => e.id),
  ["m", "a", "z"],
);

// --- A paid-invoice-locked trip still counts as consumed ---------------------
// Extra lock fields (invoice_id/payout_id) are present on the fixture but the
// ConsumingTrip type doesn't even declare them — proving structurally that
// consumption never looks at lock state, only (trip_date, delivered_at, rate).
type LockedFixture = ConsumingTrip & { invoice_id: string | null; payout_id: string | null };
const lockedTrip: LockedFixture[] = [
  { id: "locked1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 300, invoice_id: "inv-1", payout_id: "payout-1" },
];
check("paid-invoice-locked trip still consumes balance", derivedBalance([{ id: "u1", amount_sar: 1000, topup_date: "2026-06-01" }], lockedTrip), 700);

// --- asOfDate cutoff: future top-ups/trips excluded ---------------------------
const futureTopups: TopupLite[] = [
  { id: "u1", amount_sar: 500, topup_date: "2026-06-01" },
  { id: "u2", amount_sar: 500, topup_date: "2026-07-15" }, // after cutoff
];
const futureTrips: ConsumingTrip[] = [
  { id: "t1", trip_date: "2026-06-05", delivered_at: "2026-06-05T08:00:00.000Z", rate_sar: 100 },
  { id: "t2", trip_date: "2026-07-20", delivered_at: "2026-07-20T08:00:00.000Z", rate_sar: 100 }, // after cutoff
];
check("asOfDate cutoff excludes later top-ups and trips: 500 - 100 = 400", derivedBalance(futureTopups, futureTrips, "2026-06-30"), 400);

// --- Statement: running balance correctness, matches derivedBalance ---------
const stmt = buildStatement(
  [
    { id: "u1", amount_sar: 1000, topup_date: "2026-06-01", note: "Opening top-up", reference: "TRF-1" },
    { id: "u2", amount_sar: 300, topup_date: "2026-06-04", note: null, reference: null },
  ],
  baseTrips, // t1 06-03/200, t2 06-04/200, t3 06-05/200
);
check("statement entry count = 5 (2 topups + 3 trips)", stmt.length, 5);
check(
  "statement chronological order (same-day credit-before-debit n/a here, distinct days)",
  stmt.map((e) => e.id),
  ["u1", "t1", "u2", "t2", "t3"],
);
check(
  "statement running balances step correctly",
  stmt.map((e) => e.runningBalance),
  [1000, 800, 1100, 900, 700],
);
check("statement final running balance matches derivedBalance", stmt[stmt.length - 1].runningBalance, derivedBalance(
  [
    { id: "u1", amount_sar: 1000, topup_date: "2026-06-01" },
    { id: "u2", amount_sar: 300, topup_date: "2026-06-04" },
  ],
  baseTrips,
));

// --- Statement same-day tiebreak: credit before debit ------------------------
const sameDayStmt = buildStatement(
  [{ id: "u1", amount_sar: 500, topup_date: "2026-06-03", note: null, reference: null }],
  [{ id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 200 }],
);
check("statement same-day: credit (topup) before debit (trip)", sameDayStmt.map((e) => e.kind), ["topup", "trip"]);
check("statement same-day running balances", sameDayStmt.map((e) => e.runningBalance), [500, 300]);

// --- Money rounding (no float drift) -----------------------------------------
check(
  "rounding: fractional rates sum cleanly",
  derivedBalance([{ id: "u1", amount_sar: 100.1, topup_date: "2026-06-01" }], [
    { id: "t1", trip_date: "2026-06-02", delivered_at: "2026-06-02T08:00:00.000Z", rate_sar: 33.33 },
    { id: "t2", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 33.33 },
  ]),
  33.44,
);

console.log("");
if (failures === 0) {
  console.log("All prepaid checks PASSED ✓");
  process.exit(0);
} else {
  console.log(`${failures} prepaid check(s) FAILED ✗`);
  process.exit(1);
}
