// Math confidence harness for the covered/unpaid engine (spec §5, prepaid-only,
// HIGHEST-RISK LOGIC). No DB, no test framework. Mirrors prepaid-check.ts's
// discipline — dedicated script per the spec's "test harness before UI" rule.
// Run:  npx tsx scripts/covered-unpaid-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).

import {
  splitCoveredUnpaid,
  consumingTrips,
  derivedBalance,
  type ConsumingTrip,
  type TopupLite,
} from "../lib/prepaid";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}` + (ok ? "" : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`));
}

// Runs on EVERY case below: proves the split can never disagree with the
// single derived balance (locked total-balance model — no per-top-up
// allocation, this is purely a presentation split of one number).
//   1) coveredTotal + unpaidTotal === sum of every consumingTrips() amount
//   2) remainingBalance - unpaidTotal === derivedBalance(same inputs)
function checkInvariant(name: string, topups: TopupLite[], trips: ConsumingTrip[], asOfDate?: string) {
  const r = splitCoveredUnpaid(topups, trips, asOfDate);
  const allTripsTotal = Math.round(
    consumingTrips(trips, asOfDate).reduce((s, e) => s + e.amount, 0) * 100,
  ) / 100;
  const sumTotals = Math.round((r.coveredTotal + r.unpaidTotal) * 100) / 100;
  check(`${name} — invariant: coveredTotal + unpaidTotal = sum(all trip rates)`, sumTotals, allTripsTotal);

  const reconciled = Math.round((r.remainingBalance - r.unpaidTotal) * 100) / 100;
  const balance = derivedBalance(topups, trips, asOfDate);
  check(`${name} — invariant: remainingBalance - unpaidTotal = derivedBalance`, reconciled, balance);

  // covered ∪ unpaid ids must equal consumingTrips() ids exactly — no trip
  // lost, duplicated, or double-counted between the two buckets.
  const splitIds = [...r.covered.map((e) => e.id), ...r.unpaid.map((e) => e.id)].sort();
  const allIds = consumingTrips(trips, asOfDate).map((e) => e.id).sort();
  check(`${name} — invariant: covered ∪ unpaid ids = consumingTrips ids`, splitIds, allIds);

  return r;
}

// --- No trips, no top-ups -----------------------------------------------------
{
  const r = checkInvariant("no trips, no top-ups", [], []);
  check("no trips, no top-ups: empty split, zero balance", r, {
    covered: [], unpaid: [], coveredTotal: 0, unpaidTotal: 0, remainingBalance: 0,
  });
}

// --- Top-ups only, no trips ---------------------------------------------------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 1000, topup_date: "2026-06-01" }];
  const r = checkInvariant("top-ups only, no trips", topups, []);
  check("top-ups only, no trips: remainingBalance = sum(top-ups)", r.remainingBalance, 1000);
  check("top-ups only, no trips: nothing covered/unpaid", [r.covered, r.unpaid], [[], []]);
}

// --- Balance covers all trips exactly (boundary) ------------------------------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 1200, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 400 },
    { id: "t2", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 400 },
    { id: "t3", trip_date: "2026-06-05", delivered_at: "2026-06-05T08:00:00.000Z", rate_sar: 400 },
  ];
  const r = checkInvariant("balance exactly equal to N trips (1200 = 3x400)", topups, trips);
  check("exact-fit: all 3 covered, none unpaid", [r.covered.map((e) => e.id), r.unpaid.map((e) => e.id)], [["t1", "t2", "t3"], []]);
  check("exact-fit: remainingBalance = 0", r.remainingBalance, 0);
}

// --- Balance covers all trips with leftover -----------------------------------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 1500, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 400 },
    { id: "t2", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 400 },
  ];
  const r = checkInvariant("balance covers all with leftover", topups, trips);
  check("leftover: all covered, remainingBalance = 700", [r.covered.map((e) => e.id), r.remainingBalance], [["t1", "t2"], 700]);
}

// --- Off-by-one: leftover not enough for the next whole trip (PRD canonical) --
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 1300, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 400 },
    { id: "t2", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 400 },
    { id: "t3", trip_date: "2026-06-05", delivered_at: "2026-06-05T08:00:00.000Z", rate_sar: 400 },
    { id: "t4", trip_date: "2026-06-06", delivered_at: "2026-06-06T08:00:00.000Z", rate_sar: 400 },
  ];
  // 1300 covers t1,t2,t3 (1200), leftover 100 can't cover t4 (400) -> t4 unpaid,
  // leftover freezes at 100 (never partially pays t4).
  const r = checkInvariant("off-by-one: 1300 vs 4x400", topups, trips);
  check("off-by-one: t1-t3 covered, t4 unpaid", [r.covered.map((e) => e.id), r.unpaid.map((e) => e.id)], [["t1", "t2", "t3"], ["t4"]]);
  check("off-by-one: remainingBalance freezes at leftover (100), not partially spent", r.remainingBalance, 100);
  check("off-by-one: coveredTotal=1200, unpaidTotal=400", [r.coveredTotal, r.unpaidTotal], [1200, 400]);
}

// --- Zero balance, trips present ----------------------------------------------
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 200 },
  ];
  const r = checkInvariant("zero balance, trips present", [], trips);
  check("zero balance: all unpaid, none covered", [r.covered, r.unpaid.map((e) => e.id)], [[], ["t1"]]);
}

// --- Over-balance from the start (first trip already too big) ----------------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 100, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 400 },
    { id: "t2", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 400 },
  ];
  const r = checkInvariant("over-balance from the start", topups, trips);
  check("over-balance from start: all unpaid, leftover untouched at 100", [r.covered, r.unpaid.map((e) => e.id), r.remainingBalance], [[], ["t1", "t2"], 100]);
}

// --- Later top-up covers a previously-unpaid trip -----------------------------
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 400 },
    { id: "t2", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 400 },
  ];
  const before = checkInvariant("later top-up — BEFORE", [{ id: "u1", amount_sar: 400, topup_date: "2026-06-01" }], trips);
  check("later top-up before: only t1 covered, t2 unpaid", [before.covered.map((e) => e.id), before.unpaid.map((e) => e.id)], [["t1"], ["t2"]]);

  // A second top-up arrives (dated AFTER both trips — order among top-ups
  // doesn't matter, it's a pool, not a chronological walk against trips).
  const after = checkInvariant(
    "later top-up — AFTER",
    [{ id: "u1", amount_sar: 400, topup_date: "2026-06-01" }, { id: "u2", amount_sar: 400, topup_date: "2026-06-10" }],
    trips,
  );
  check("later top-up after: t2 flips to covered", [after.covered.map((e) => e.id), after.unpaid], [["t1", "t2"], []]);
}

// --- Backdated / shuffled top-ups: order among top-ups doesn't matter --------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 1000, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 300 },
    { id: "t2", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 300 },
  ];
  const a = splitCoveredUnpaid(topups, trips);
  const b = splitCoveredUnpaid([...topups].reverse(), [...trips].reverse());
  check("shuffled top-ups/trips input order: identical result", b, a);
}

// --- Reversed trip: disappears from both lists, downstream re-walks ----------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 800, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 400 },
    { id: "t2", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 400 },
    { id: "t3", trip_date: "2026-06-05", delivered_at: "2026-06-05T08:00:00.000Z", rate_sar: 400 },
  ];
  const before = checkInvariant("reversal — BEFORE", topups, trips);
  check("reversal before: t1,t2 covered, t3 unpaid", [before.covered.map((e) => e.id), before.unpaid.map((e) => e.id)], [["t1", "t2"], ["t3"]]);

  const afterReversal: ConsumingTrip[] = [trips[0], { ...trips[1], delivered_at: null }, trips[2]];
  const after = checkInvariant("reversal — AFTER (t2 reversed)", topups, afterReversal);
  check("reversal after: t2 gone entirely, t1+t3 both covered now", [after.covered.map((e) => e.id), after.unpaid], [["t1", "t3"], []]);
}

// --- Undelivered trip excluded from both lists --------------------------------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 1000, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 300 },
    { id: "t2", trip_date: "2026-06-04", delivered_at: null, rate_sar: 300 }, // not delivered
  ];
  const r = checkInvariant("undelivered trip excluded", topups, trips);
  check("undelivered: only t1 appears, covered", [r.covered.map((e) => e.id), r.unpaid], [["t1"], []]);
}

// --- FIFO respected regardless of input order ---------------------------------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 400, topup_date: "2026-06-01" }];
  const scrambled: ConsumingTrip[] = [
    { id: "c", trip_date: "2026-06-05", delivered_at: "2026-06-05T14:00:00.000Z", rate_sar: 200 }, // 3rd
    { id: "a", trip_date: "2026-06-03", delivered_at: "2026-06-06T09:00:00.000Z", rate_sar: 200 }, // 1st by trip_date
    { id: "b", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 200 }, // 2nd
  ];
  const r = checkInvariant("FIFO by trip_date regardless of input order", topups, scrambled);
  check("FIFO: a then b covered (400), c unpaid", [r.covered.map((e) => e.id), r.unpaid.map((e) => e.id)], [["a", "b"], ["c"]]);
}

// --- Same trip_date tiebreak: delivered_at then id ----------------------------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 20, topup_date: "2026-06-01" }];
  const sameDayTiebreak: ConsumingTrip[] = [
    { id: "z", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 10 },
    { id: "a", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 10 }, // same instant -> id tiebreak
    { id: "m", trip_date: "2026-06-03", delivered_at: "2026-06-03T06:00:00.000Z", rate_sar: 10 }, // earlier delivered_at -> first
  ];
  const r = checkInvariant("same trip_date tiebreak", topups, sameDayTiebreak);
  check("tiebreak: m,a covered (20), z unpaid", [r.covered.map((e) => e.id), r.unpaid.map((e) => e.id)], [["m", "a"], ["z"]]);
}

// --- asOfDate cutoff -----------------------------------------------------------
{
  const topups: TopupLite[] = [
    { id: "u1", amount_sar: 500, topup_date: "2026-06-01" },
    { id: "u2", amount_sar: 500, topup_date: "2026-07-15" }, // after cutoff
  ];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-05", delivered_at: "2026-06-05T08:00:00.000Z", rate_sar: 400 },
    { id: "t2", trip_date: "2026-07-20", delivered_at: "2026-07-20T08:00:00.000Z", rate_sar: 400 }, // after cutoff
  ];
  const r = checkInvariant("asOfDate cutoff", topups, trips, "2026-06-30");
  check("asOfDate cutoff: only t1 in scope, covered", [r.covered.map((e) => e.id), r.unpaid, r.remainingBalance], [["t1"], [], 100]);
}

// --- Money rounding (no float drift) -------------------------------------------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 100.1, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-02", delivered_at: "2026-06-02T08:00:00.000Z", rate_sar: 33.33 },
    { id: "t2", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 33.33 },
    { id: "t3", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 33.33 },
  ];
  // 100.1 covers t1,t2 (66.66), leftover 33.44 covers t3 (33.33) exactly too ->
  // all 3 fit; use this instead to also exercise a real leftover-freeze case.
  const r = checkInvariant("rounding: fractional rates", topups, trips);
  check("rounding: all 3 covered, remainingBalance = 0.11 clean (no drift)", [r.covered.map((e) => e.id), r.remainingBalance], [["t1", "t2", "t3"], 0.11]);
}

console.log("");
if (failures === 0) {
  console.log("All covered/unpaid checks PASSED ✓");
  process.exit(0);
} else {
  console.log(`${failures} covered/unpaid check(s) FAILED ✗`);
  process.exit(1);
}
