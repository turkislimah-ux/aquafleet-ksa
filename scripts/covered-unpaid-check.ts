// Math confidence harness for the covered/unpaid engine (spec §5, prepaid-only,
// HIGHEST-RISK LOGIC). No DB, no test framework. Mirrors prepaid-check.ts's
// discipline — dedicated script per the spec's "test harness before UI" rule.
// Run:  npx tsx scripts/covered-unpaid-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).
//
// v3 CUTOVER: the legacy pre-VAT splitCoveredUnpaid/consumingTrips/
// derivedBalance trio is deleted from lib/prepaid.ts (finance-invoice-spec.md
// v3 §2/§5 — VAT-inclusive consumption, ONE combined trips+charges FIFO
// queue). Every case below targets splitCoveredUnpaidItems/consumingItems/
// derivedBalanceItems. Cases ported from the old v2 harness keep their
// original narrative/intent but use recalculated VAT-inclusive expected
// values — some topup magnitudes were adjusted (documented inline) so the
// intended narrative (exact-fit boundary, off-by-one leftover-freeze, a
// later top-up flipping a trip to covered, etc.) still holds once every
// trip/charge cost 1.15x its pre-VAT rate.

import {
  splitCoveredUnpaidItems,
  consumingItems,
  derivedBalanceItems,
  type ConsumingTrip,
  type TopupLite,
  type ConsumingCharge,
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
// allocation, this is purely a presentation split of one number), spanning
// trips + charges via consumingItems()/derivedBalanceItems():
//   1) coveredTotal + unpaidTotal === sum of every consumingItems() consumedAmount
//   2) remainingBalance - unpaidTotal === derivedBalanceItems(same inputs)
//   3) covered ∪ unpaid ids === consumingItems() ids
function checkInvariant(
  name: string,
  topups: TopupLite[],
  trips: ConsumingTrip[],
  charges: ConsumingCharge[] = [],
  asOfDate?: string,
) {
  const r = splitCoveredUnpaidItems(topups, trips, charges, asOfDate);
  const allItemsTotal = Math.round(
    consumingItems(trips, charges, asOfDate).reduce((s, e) => s + e.consumedAmount, 0) * 100,
  ) / 100;
  const sumTotals = Math.round((r.coveredTotal + r.unpaidTotal) * 100) / 100;
  check(`${name} — invariant: coveredTotal + unpaidTotal = sum(all consumedAmount)`, sumTotals, allItemsTotal);

  const reconciled = Math.round((r.remainingBalance - r.unpaidTotal) * 100) / 100;
  const balance = derivedBalanceItems(topups, trips, charges, asOfDate);
  check(`${name} — invariant: remainingBalance - unpaidTotal = derivedBalanceItems`, reconciled, balance);

  const splitIds = [...r.covered.map((e) => e.id), ...r.unpaid.map((e) => e.id)].sort();
  const allIds = consumingItems(trips, charges, asOfDate).map((e) => e.id).sort();
  check(`${name} — invariant: covered ∪ unpaid ids = consumingItems ids`, splitIds, allIds);

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

// --- Balance covers all trips exactly (VAT-inclusive boundary) ---------------
// topup bumped to 3x460 (was 3x400 pre-VAT) — exact-fit still holds once each
// 400 trip actually consumes 460 (400*1.15).
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 1380, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 400 },
    { id: "t2", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 400 },
    { id: "t3", trip_date: "2026-06-05", delivered_at: "2026-06-05T08:00:00.000Z", rate_sar: 400 },
  ];
  const r = checkInvariant("balance exactly equal to N trips' consumedAmount (1380 = 3x460)", topups, trips);
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
  // 1500 - (2 x 460 consumedAmount) = 580 (was 700 under old pre-VAT math).
  const r = checkInvariant("balance covers all with leftover", topups, trips);
  check("leftover: all covered, remainingBalance = 580", [r.covered.map((e) => e.id), r.remainingBalance], [["t1", "t2"], 580]);
}

// --- Off-by-one: leftover not enough for the next whole item (PRD canonical) -
// topup bumped to 1430 (3x460 + 50 leftover) so the "3 covered, 1 unpaid,
// leftover freezes" narrative still holds under VAT-inclusive consumedAmount.
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 1430, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 400 },
    { id: "t2", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 400 },
    { id: "t3", trip_date: "2026-06-05", delivered_at: "2026-06-05T08:00:00.000Z", rate_sar: 400 },
    { id: "t4", trip_date: "2026-06-06", delivered_at: "2026-06-06T08:00:00.000Z", rate_sar: 400 },
  ];
  // 1430 covers t1,t2,t3 (3x460=1380), leftover 50 can't cover t4 (460) ->
  // t4 unpaid, leftover freezes at 50 (never partially pays t4).
  const r = checkInvariant("off-by-one: 1430 vs 4x460", topups, trips);
  check("off-by-one: t1-t3 covered, t4 unpaid", [r.covered.map((e) => e.id), r.unpaid.map((e) => e.id)], [["t1", "t2", "t3"], ["t4"]]);
  check("off-by-one: remainingBalance freezes at leftover (50), not partially spent", r.remainingBalance, 50);
  check("off-by-one: coveredTotal=1380, unpaidTotal=460", [r.coveredTotal, r.unpaidTotal], [1380, 460]);
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
// topup amounts bumped to 460/460 (was 400/400 pre-VAT) so the narrative
// (first top-up covers t1 only, second flips t2 to covered too) still holds
// once each 400-rate trip consumes 460.
{
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 400 },
    { id: "t2", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 400 },
  ];
  const before = checkInvariant("later top-up — BEFORE", [{ id: "u1", amount_sar: 460, topup_date: "2026-06-01" }], trips);
  check("later top-up before: only t1 covered, t2 unpaid", [before.covered.map((e) => e.id), before.unpaid.map((e) => e.id)], [["t1"], ["t2"]]);

  // A second top-up arrives (dated AFTER both trips — order among top-ups
  // doesn't matter, it's a pool, not a chronological walk against trips).
  const after = checkInvariant(
    "later top-up — AFTER",
    [{ id: "u1", amount_sar: 460, topup_date: "2026-06-01" }, { id: "u2", amount_sar: 460, topup_date: "2026-06-10" }],
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
  const a = splitCoveredUnpaidItems(topups, trips, []);
  const b = splitCoveredUnpaidItems([...topups].reverse(), [...trips].reverse(), []);
  check("shuffled top-ups/trips input order: identical result", b, a);
}

// --- Reversed trip: disappears from both lists, downstream re-walks ----------
// topup bumped to 920 (2x460, was 800 pre-VAT) so the narrative (reversal
// frees enough balance for the previously-unpaid trip) still holds.
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 920, topup_date: "2026-06-01" }];
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
// topup bumped to 500 (was 400 pre-VAT) so "a,b covered, c unpaid" still
// holds once each 200-rate trip consumes 230.
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 500, topup_date: "2026-06-01" }];
  const scrambled: ConsumingTrip[] = [
    { id: "c", trip_date: "2026-06-05", delivered_at: "2026-06-05T14:00:00.000Z", rate_sar: 200 }, // 3rd
    { id: "a", trip_date: "2026-06-03", delivered_at: "2026-06-06T09:00:00.000Z", rate_sar: 200 }, // 1st by trip_date
    { id: "b", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 200 }, // 2nd
  ];
  const r = checkInvariant("FIFO by trip_date regardless of input order", topups, scrambled);
  check("FIFO: a then b covered (460), c unpaid", [r.covered.map((e) => e.id), r.unpaid.map((e) => e.id)], [["a", "b"], ["c"]]);
  check("FIFO: remainingBalance = 40", r.remainingBalance, 40);
}

// --- Same trip_date tiebreak: delivered_at then id ----------------------------
// topup bumped to 25 (was 20 pre-VAT) so "m,a covered, z unpaid" still holds
// once each 10-rate trip consumes 11.5.
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 25, topup_date: "2026-06-01" }];
  const sameDayTiebreak: ConsumingTrip[] = [
    { id: "z", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 10 },
    { id: "a", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 10 }, // same instant -> id tiebreak
    { id: "m", trip_date: "2026-06-03", delivered_at: "2026-06-03T06:00:00.000Z", rate_sar: 10 }, // earlier delivered_at -> first
  ];
  const r = checkInvariant("same trip_date tiebreak", topups, sameDayTiebreak);
  check("tiebreak: m,a covered (23), z unpaid", [r.covered.map((e) => e.id), r.unpaid.map((e) => e.id)], [["m", "a"], ["z"]]);
  check("tiebreak: remainingBalance = 2", r.remainingBalance, 2);
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
  // Only u1 (500) and t1 (consumedAmount 460) in scope -> remainingBalance = 40
  // (was 100 under old pre-VAT math).
  const r = checkInvariant("asOfDate cutoff", topups, trips, [], "2026-06-30");
  check("asOfDate cutoff: only t1 in scope, covered", [r.covered.map((e) => e.id), r.unpaid, r.remainingBalance], [["t1"], [], 40]);
}

// --- Money rounding (no float drift) -------------------------------------------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 100.1, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-02", delivered_at: "2026-06-02T08:00:00.000Z", rate_sar: 33.33 },
    { id: "t2", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 33.33 },
    { id: "t3", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z", rate_sar: 33.33 },
  ];
  // Each trip consumes round2(33.33 * 1.15) = 38.33. 100.10 covers t1,t2
  // (76.66), leftover 23.44 can't cover t3 (38.33) -> t3 unpaid, leftover
  // freezes at 23.44 (was "all 3 fit, 0.11 leftover" under old pre-VAT math).
  const r = checkInvariant("rounding: fractional rates", topups, trips);
  check("rounding: t1,t2 covered, t3 unpaid, remainingBalance = 23.44 (no drift)", [r.covered.map((e) => e.id), r.unpaid.map((e) => e.id), r.remainingBalance], [["t1", "t2"], ["t3"], 23.44]);
}

// --- VAT-inclusive boundary: pool exactly covers one 400 trip's 460 ----------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 460, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 400 },
  ];
  const r = checkInvariant("VAT-inclusive boundary: pool=460 exactly covers 400-trip's 460", topups, trips);
  check("VAT-inclusive boundary: t1 covered, remainingBalance = 0", [r.covered.map((e) => e.id), r.remainingBalance], [["t1"], 0]);
  // Same pool would have (wrongly) left 60 leftover under the old pre-VAT
  // (400-only) threshold — proves the boundary itself moved, not just amount.
}

// --- Balance covers the trip but not the next charge --------------------------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 460, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 400 },
  ];
  const charges: ConsumingCharge[] = [{ id: "ch1", charge_date: "2026-06-05", amount_sar: 100, label: "Fee" }];
  const r = checkInvariant("balance covers trip but not next charge", topups, trips, charges);
  check(
    "trip covered (pool exhausted), charge unpaid and rolls forward",
    [r.covered.map((e) => e.id), r.unpaid.map((e) => e.id), r.remainingBalance],
    [["t1"], ["ch1"], 0],
  );
}

// --- Charge-only queue (no trips at all) --------------------------------------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 300, topup_date: "2026-06-01" }];
  const charges: ConsumingCharge[] = [
    { id: "c1", charge_date: "2026-06-01", amount_sar: 100 },
    { id: "c2", charge_date: "2026-06-02", amount_sar: 100 },
    { id: "c3", charge_date: "2026-06-03", amount_sar: 100 },
  ];
  // consumedAmount = 115 each. 300 covers c1 (185 left), c2 (70 left), not c3.
  const r = checkInvariant("charge-only queue", topups, [], charges);
  check("charge-only: c1,c2 covered, c3 unpaid, remainingBalance = 70", [r.covered.map((e) => e.id), r.unpaid.map((e) => e.id), r.remainingBalance], [["c1", "c2"], ["c3"], 70]);
}

// --- Over-balance from charges alone (small pool, no trips) -------------------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 50, topup_date: "2026-06-01" }];
  const charges: ConsumingCharge[] = [{ id: "ch1", charge_date: "2026-06-05", amount_sar: 100 }];
  const r = checkInvariant("over-balance from charges alone", topups, [], charges);
  check(
    "over-balance from charges alone: all unpaid, leftover untouched at 50",
    [r.covered, r.unpaid.map((e) => e.id), r.remainingBalance],
    [[], ["ch1"], 50],
  );
}

// --- Void invoice's charges released: excluded from the array, split flips ---
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 460, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 400 },
  ];
  const chargeOnLiveInvoice: ConsumingCharge[] = [{ id: "ch-live", charge_date: "2026-06-05", amount_sar: 50 }];
  const withCharge = checkInvariant("void-release — WITH charge (non-void invoice)", topups, trips, chargeOnLiveInvoice);
  check("with charge: t1 covered, charge unpaid (pool exhausted)", [withCharge.covered.map((e) => e.id), withCharge.unpaid.map((e) => e.id)], [["t1"], ["ch-live"]]);

  // Invoice voided -> caller simply omits it from the charges array next call.
  const afterVoid = checkInvariant("void-release — AFTER (charge's invoice voided, excluded)", topups, trips, []);
  check("after void: charge gone entirely, only t1 in the queue", [afterVoid.covered.map((e) => e.id), afterVoid.unpaid], [["t1"], []]);
}

// --- Reversed trip restores balance and re-walks the combined queue ----------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 460, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 400 },
  ];
  const charges: ConsumingCharge[] = [{ id: "ch1", charge_date: "2026-06-05", amount_sar: 50 }];
  const before = checkInvariant("v3 reversal — BEFORE", topups, trips, charges);
  check("before: t1 covered, ch1 unpaid", [before.covered.map((e) => e.id), before.unpaid.map((e) => e.id)], [["t1"], ["ch1"]]);

  const afterReversal: ConsumingTrip[] = [{ ...trips[0], delivered_at: null }];
  const after = checkInvariant("v3 reversal — AFTER (t1 reversed)", topups, afterReversal, charges);
  check("after: t1 gone, ch1 (57.5 consumed) now covered by the freed pool", [after.covered.map((e) => e.id), after.unpaid], [["ch1"], []]);
}

// --- Trip + charge interleaved by date, FIFO across kinds ---------------------
{
  const topups: TopupLite[] = [{ id: "u1", amount_sar: 200, topup_date: "2026-06-01" }];
  const trips: ConsumingTrip[] = [
    { id: "t1", trip_date: "2026-06-01", delivered_at: "2026-06-01T08:00:00.000Z", rate_sar: 100 }, // consumedAmount 115
  ];
  const charges: ConsumingCharge[] = [
    { id: "ch1", charge_date: "2026-06-02", amount_sar: 50 }, // consumedAmount 57.5
    { id: "ch2", charge_date: "2026-06-10", amount_sar: 50 }, // consumedAmount 57.5
  ];
  // 200: t1(115) -> 85 left; ch1(57.5) -> 27.5 left; ch2(57.5) doesn't fit -> unpaid.
  const r = checkInvariant("interleaved trip+charge FIFO", topups, trips, charges);
  check(
    "interleaved: t1,ch1 covered (date order), ch2 unpaid, remainingBalance = 27.5",
    [r.covered.map((e) => e.id), r.unpaid.map((e) => e.id), r.remainingBalance],
    [["t1", "ch1"], ["ch2"], 27.5],
  );
}

console.log("");
if (failures === 0) {
  console.log("All covered/unpaid checks PASSED ✓");
  process.exit(0);
} else {
  console.log(`${failures} covered/unpaid check(s) FAILED ✗`);
  process.exit(1);
}
