// Math confidence harness for the commission engine. No DB, no test framework.
// Run:  npx tsx scripts/commission-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).

import {
  commissionForNthTrip,
  commissionForDelivery,
  dailyDriverProjectCommission,
  monthKeyOf,
} from "../lib/commission";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}` + (ok ? "" : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`));
}

// --- Fixed: flat base every trip --------------------------------------------
check("fixed t1 = 50", commissionForNthTrip(50, "fixed", 0, 1), 50);
check("fixed t2 = 50", commissionForNthTrip(50, "fixed", 0, 2), 50);
check("fixed t3 = 50", commissionForNthTrip(50, "fixed", 0, 3), 50);
check("fixed ignores bump% entirely", commissionForNthTrip(50, "fixed", 25, 9), 50);

// --- Scalable: base 60, bump 5% — climbs each trip --------------------------
check("scalable t1 = 60", commissionForNthTrip(60, "scalable", 5, 1), 60);
check("scalable t2 = 63", commissionForNthTrip(60, "scalable", 5, 2), 63);
check("scalable t3 = 66", commissionForNthTrip(60, "scalable", 5, 3), 66);
check("scalable t10 = 87", commissionForNthTrip(60, "scalable", 5, 10), 87);

// --- Delivery helper: prior count maps to the right n -----------------------
check("delivery prior=0 -> t1", commissionForDelivery(60, "scalable", 5, 0), 60);
check("delivery prior=2 -> t3", commissionForDelivery(60, "scalable", 5, 2), 66);

// --- Guards -----------------------------------------------------------------
check("zero base -> 0", commissionForNthTrip(0, "scalable", 5, 3), 0);
check("n<1 clamps to 1", commissionForNthTrip(60, "scalable", 5, 0), 60);

// --- monthKeyOf (reporting/payroll-period grouping only — NOT scaling) ------
check("monthKeyOf", monthKeyOf("2026-06-30T20:00:00.000Z"), "2026-06");

// --- Daily rollup: fixed, 3 delivered same SCHEDULED day -> 150 -------------
const fixedDay = dailyDriverProjectCommission(
  [
    { id: "a", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z" },
    { id: "b", trip_date: "2026-06-03", delivered_at: "2026-06-03T10:00:00.000Z" },
    { id: "c", trip_date: "2026-06-03", delivered_at: "2026-06-03T14:00:00.000Z" },
  ],
  50,
  "fixed",
  0,
  "2026-06-03"
);
check("fixed same-day count = 3", fixedDay.count, 3);
check("fixed same-day total = 150", fixedDay.total, 150);

// --- Daily rollup: scalable base 60 pct 5, 3 same SCHEDULED day -> 60+63+66=189
// Provided out of order to prove it sorts by delivered_at before numbering.
const scalDay = dailyDriverProjectCommission(
  [
    { id: "c", trip_date: "2026-06-03", delivered_at: "2026-06-03T14:00:00.000Z" }, // 3rd chronologically
    { id: "a", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z" }, // 1st
    { id: "b", trip_date: "2026-06-03", delivered_at: "2026-06-03T10:00:00.000Z" }, // 2nd
  ],
  60,
  "scalable",
  5,
  "2026-06-03"
);
check("scalable same-day total = 189", scalDay.total, 189);
check("scalable same-day n-order = [1,2,3]", scalDay.perTrip.map((p) => p.n), [1, 2, 3]);
check("scalable same-day pay-order = [60,63,66]", scalDay.perTrip.map((p) => p.commission), [60, 63, 66]);

// --- Reset next SCHEDULED day (trip_date), not click day: 3 trips day1,
// 2 trips day2 -> day2 restarts at position 1, not 4. ------------------------
const twoDays = [
  { id: "a", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z" }, // day1 #1
  { id: "b", trip_date: "2026-06-03", delivered_at: "2026-06-03T10:00:00.000Z" }, // day1 #2
  { id: "c", trip_date: "2026-06-03", delivered_at: "2026-06-03T14:00:00.000Z" }, // day1 #3
  { id: "d", trip_date: "2026-06-04", delivered_at: "2026-06-04T08:00:00.000Z" }, // day2 #1 (must be position 1, not 4)
  { id: "e", trip_date: "2026-06-04", delivered_at: "2026-06-04T10:00:00.000Z" }, // day2 #2
];
const day2 = dailyDriverProjectCommission(twoDays, 60, "scalable", 5, "2026-06-04");
check("next-day resets: count = 2", day2.count, 2);
check("next-day resets: n-order = [1,2] (not [4,5])", day2.perTrip.map((p) => p.n), [1, 2]);
check("next-day resets: pay-order = [60,63]", day2.perTrip.map((p) => p.commission), [60, 63]);
check("next-day resets: total = 123", day2.total, 123);

// Same check for day1 itself, unaffected by day2 existing in the input set.
const day1 = dailyDriverProjectCommission(twoDays, 60, "scalable", 5, "2026-06-03");
check("day1 unaffected by day2 data: total = 189", day1.total, 189);

// Same MONTH, different day, would have kept climbing under the old monthly
// window (day2 #1 would have been position 4 -> 73.5) — pin the delta so a
// regression back to monthly scoping fails loudly.
check("month-window regression guard: day2 #1 is NOT the old month-position-4 price", day2.perTrip[0].commission !== commissionForNthTrip(60, "scalable", 5, 4), true);

// Trips not delivered (null) contribute nothing.
const withNull = dailyDriverProjectCommission(
  [
    { id: "x", trip_date: "2026-06-05", delivered_at: null },
    { id: "y", trip_date: "2026-06-05", delivered_at: "2026-06-05T08:00:00.000Z" },
  ],
  50,
  "fixed",
  0,
  "2026-06-05"
);
check("null delivered_at ignored: count = 1", withNull.count, 1);

// --- SCHEDULED-DAY regression guard: late delivery + same-session clicks ---
// Trip A: trip_date=06-03, delivered ON TIME same day.
// Trip B: trip_date=06-03, delivered 2 days LATE (06-05) — must still scale
//         as position 2 of the 06-03 bucket, NOT reset into a 06-05 bucket.
// Trip C: trip_date=06-05, delivered in the SAME CLICK SESSION as B (same
//         instant) — must land in a SEPARATE 06-05 bucket at position 1, not
//         collapse into B's click-day bucket. This is the exact real-data bug:
//         several different-trip_date trips clicked delivered together must
//         NOT share one bucket just because they were clicked together.
const lateAndSession = [
  { id: "A", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z" },
  { id: "B", trip_date: "2026-06-03", delivered_at: "2026-06-05T09:00:00.000Z" },
  { id: "C", trip_date: "2026-06-05", delivered_at: "2026-06-05T09:00:00.000Z" },
];
const bucket0603 = dailyDriverProjectCommission(lateAndSession, 60, "scalable", 5, "2026-06-03");
check("late delivery still buckets by trip_date: 06-03 count = 2", bucket0603.count, 2);
check("late delivery still buckets by trip_date: 06-03 n-order = [1,2] (A,B)", bucket0603.perTrip.map((p) => p.n), [1, 2]);
check("late delivery still buckets by trip_date: 06-03 pay-order = [60,63]", bucket0603.perTrip.map((p) => p.commission), [60, 63]);

const bucket0605 = dailyDriverProjectCommission(lateAndSession, 60, "scalable", 5, "2026-06-05");
check("same-session click does not collapse buckets: 06-05 count = 1 (C only)", bucket0605.count, 1);
check("same-session click does not collapse buckets: 06-05 is position 1 (fresh ramp)", bucket0605.perTrip.map((p) => p.commission), [60]);

// --- Pushback recompute: deliver 4 SAME SCHEDULED DAY, undeliver a MIDDLE
// one, reprice the rest. Mirrors app/trips/actions.ts's recomputeDailyCommission:
// sort the remaining delivered trips by delivered_at (tiebreak id), price by
// position (n = 1-based index), and only WRITE unpaid trips — but a PAID
// trip still occupies a slot and still counts toward later trips' n (position
// semantics), matching the existing priceDelivery() behavior which never
// filters "prior" by payout_id.
type LiteTrip = { id: string; trip_date: string; delivered_at: string | null; payout_id: string | null };
const deliveredFour: LiteTrip[] = [
  { id: "t1", trip_date: "2026-06-03", delivered_at: "2026-06-03T06:00:00.000Z", payout_id: "payout-1" }, // already paid
  { id: "t2", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", payout_id: null },
  { id: "t3", trip_date: "2026-06-03", delivered_at: "2026-06-03T10:00:00.000Z", payout_id: null },
  { id: "t4", trip_date: "2026-06-03", delivered_at: "2026-06-03T14:00:00.000Z", payout_id: null },
];

// Push t2 (a MIDDLE trip) back out of delivered.
const afterPushback = deliveredFour.filter((t) => t.id !== "t2");

const sorted = [...afterPushback].sort((a, b) =>
  (a.delivered_at ?? "") !== (b.delivered_at ?? "")
    ? (a.delivered_at ?? "") < (b.delivered_at ?? "") ? -1 : 1
    : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
);
const priced = sorted.map((t, i) => ({
  id: t.id,
  commission: commissionForNthTrip(60, "scalable", 5, i + 1),
  payout_id: t.payout_id,
}));
const writes = priced.filter((p) => p.payout_id == null);

check("pushback: remaining order = [t1,t3,t4]", sorted.map((t) => t.id), ["t1", "t3", "t4"]);
check("pushback: repriced = [60,63,66] (t3,t4 reprice DOWN)", priced.map((p) => p.commission), [60, 63, 66]);
check("pushback: paid t1 excluded from writes", writes.map((w) => w.id), ["t3", "t4"]);

// Cross-check against dailyDriverProjectCommission over the SAME smaller
// set — the recompute algorithm must agree with the rollup engine.
const pushbackRollup = dailyDriverProjectCommission(
  afterPushback.map((t) => ({ id: t.id, trip_date: t.trip_date, delivered_at: t.delivered_at })),
  60,
  "scalable",
  5,
  "2026-06-03",
);
check("pushback matches daily rollup total = 189", pushbackRollup.total, 189);
check(
  "pushback matches daily rollup per-trip",
  pushbackRollup.perTrip.map((p) => p.commission),
  priced.map((p) => p.commission),
);

// --- DELIVERY-MOMENT RATE FREEZE (0152): each trip prices at ITS OWN stamped
// base, at its LIVE position. Mirrors the rewired recomputeDailyCommission,
// which no longer resolves one config for the bucket — it reads the
// commission_mode / commission_base_sar / commission_bump_pct frozen onto each
// trip at delivery and feeds them to commissionForNthTrip individually.
//
// This is the reported bug, as a test: two trips are delivered at base 60, the
// project's commission is changed the SAME DAY to 100, then two more are
// delivered. Under the old bucket-wide resolve, all four repriced at 100. The
// first two must now hold 60.
type StampedTrip = LiteTrip & { base: number; mode: "fixed" | "scalable"; bump: number };

const sameDayChange: StampedTrip[] = [
  { id: "s1", trip_date: "2026-06-03", delivered_at: "2026-06-03T06:00:00.000Z", payout_id: null, base: 60,  mode: "scalable", bump: 5 },
  { id: "s2", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", payout_id: null, base: 60,  mode: "scalable", bump: 5 },
  // --- commission changed to 100 here, mid-day ---
  { id: "s3", trip_date: "2026-06-03", delivered_at: "2026-06-03T10:00:00.000Z", payout_id: null, base: 100, mode: "scalable", bump: 5 },
  { id: "s4", trip_date: "2026-06-03", delivered_at: "2026-06-03T14:00:00.000Z", payout_id: null, base: 100, mode: "scalable", bump: 5 },
];

// The recompute's exact loop: sort, then price each at its own frozen terms.
function repriceOwnTerms(trips: StampedTrip[]): { id: string; commission: number }[] {
  return [...trips]
    .sort((a, b) =>
      (a.delivered_at ?? "") !== (b.delivered_at ?? "")
        ? (a.delivered_at ?? "") < (b.delivered_at ?? "") ? -1 : 1
        : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    )
    .map((t, i) => ({ id: t.id, commission: commissionForNthTrip(t.base, t.mode, t.bump, i + 1) }));
}

// n = 1,2,3,4 — but the base is per trip: 60, 60*1.05, 100*1.10, 100*1.15.
check(
  "own-terms: same-day change reaches only trips stamped after it = [60,63,110,115]",
  repriceOwnTerms(sameDayChange).map((p) => p.commission),
  [60, 63, 110, 115],
);

// The freeze must NOT freeze position. Push s2 out and everyone after it moves
// down a slot — still priced at their own rates. This is the "re-ranks, does not
// re-rate" property in one assertion: s3 goes 110 -> 105 (position 3 -> 2, base
// still 100) while s1 stays 60 (position unchanged, base unchanged).
check(
  "own-terms: pushback re-ranks but does not re-rate = [60,105,110]",
  repriceOwnTerms(sameDayChange.filter((t) => t.id !== "s2")).map((p) => p.commission),
  [60, 105, 110],
);

// A bucket-wide resolve would have produced this instead. Pin the delta so a
// regression back to one-config-per-bucket fails loudly rather than quietly
// paying the new rate for old work.
check(
  "own-terms regression guard: NOT the bucket-wide-at-100 answer [100,105,110,115]",
  repriceOwnTerms(sameDayChange).map((p) => p.commission).join(",") !==
    [1, 2, 3, 4].map((n) => commissionForNthTrip(100, "scalable", 5, n)).join(","),
  true,
);

// --- FIXED IS POSITION-INDEPENDENT. commissionForNthTrip returns the base
// before it reads n or bumpPct, so re-ranking a fixed bucket cannot move a
// figure — which is why the freeze is inert for fixed projects. Measured on
// live data too: King Saud University, fixed 20.00, 149 delivered trips,
// stored total 2,980.00 = 149 x 20 exactly.
const fixedBucket: StampedTrip[] = [
  { id: "f1", trip_date: "2026-06-03", delivered_at: "2026-06-03T06:00:00.000Z", payout_id: null, base: 45, mode: "fixed", bump: 10 },
  { id: "f2", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", payout_id: null, base: 45, mode: "fixed", bump: 10 },
  { id: "f3", trip_date: "2026-06-03", delivered_at: "2026-06-03T10:00:00.000Z", payout_id: null, base: 45, mode: "fixed", bump: 10 },
  { id: "f4", trip_date: "2026-06-03", delivered_at: "2026-06-03T14:00:00.000Z", payout_id: null, base: 45, mode: "fixed", bump: 10 },
];
check(
  "fixed: same at every position = [45,45,45,45]",
  repriceOwnTerms(fixedBucket).map((p) => p.commission),
  [45, 45, 45, 45],
);
check(
  "fixed: pushback moves positions and changes nothing = [45,45,45]",
  repriceOwnTerms(fixedBucket.filter((t) => t.id !== "f2")).map((p) => p.commission),
  [45, 45, 45],
);
check(
  "fixed: a bump stamped on the trip is still ignored at every n",
  [1, 2, 3, 4, 5].map((n) => commissionForNthTrip(45, "fixed", 10, n)),
  [45, 45, 45, 45, 45],
);

console.log("");
if (failures === 0) {
  console.log("All commission checks PASSED ✓");
  process.exit(0);
} else {
  console.log(`${failures} commission check(s) FAILED ✗`);
  process.exit(1);
}
