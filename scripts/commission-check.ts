// Math confidence harness for the commission engine. No DB, no test framework.
// Run:  npx tsx scripts/commission-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).

import {
  commissionForNthTrip,
  commissionForDelivery,
  monthlyDriverProjectCommission,
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

// --- monthKeyOf -------------------------------------------------------------
check("monthKeyOf", monthKeyOf("2026-06-30T20:00:00.000Z"), "2026-06");

// --- Monthly rollup: fixed, 3 delivered in June -> 150 ----------------------
const fixedJune = monthlyDriverProjectCommission(
  [
    { delivered_at: "2026-06-03T08:00:00.000Z" },
    { delivered_at: "2026-06-10T08:00:00.000Z" },
    { delivered_at: "2026-06-21T08:00:00.000Z" },
  ],
  50,
  "fixed",
  0,
  "2026-06"
);
check("fixed June count = 3", fixedJune.count, 3);
check("fixed June total = 150", fixedJune.total, 150);

// --- Monthly rollup: scalable base 60 pct 5, 3 in June -> 60+63+66 = 189 ----
// Provided out of order to prove it sorts by delivered_at before numbering.
const scalJune = monthlyDriverProjectCommission(
  [
    { delivered_at: "2026-06-21T08:00:00.000Z" }, // 3rd chronologically
    { delivered_at: "2026-06-03T08:00:00.000Z" }, // 1st
    { delivered_at: "2026-06-10T08:00:00.000Z" }, // 2nd
  ],
  60,
  "scalable",
  5,
  "2026-06"
);
check("scalable June total = 189", scalJune.total, 189);
check("scalable June n-order = [1,2,3]", scalJune.perTrip.map((p) => p.n), [1, 2, 3]);
check("scalable June pay-order = [60,63,66]", scalJune.perTrip.map((p) => p.commission), [60, 63, 66]);

// --- Reset next month: same driver/project, July numbering restarts at 1 ----
const allTrips = [
  { delivered_at: "2026-06-03T08:00:00.000Z" },
  { delivered_at: "2026-06-10T08:00:00.000Z" },
  { delivered_at: "2026-06-21T08:00:00.000Z" },
  { delivered_at: "2026-07-02T08:00:00.000Z" }, // July #1
  { delivered_at: "2026-07-09T08:00:00.000Z" }, // July #2
];
const jul = monthlyDriverProjectCommission(allTrips, 60, "scalable", 5, "2026-07");
check("July resets: count = 2", jul.count, 2);
check("July resets: pay-order = [60,63]", jul.perTrip.map((p) => p.commission), [60, 63]);
check("July resets: total = 123", jul.total, 123);

// Trips not delivered (null) contribute nothing.
const withNull = monthlyDriverProjectCommission(
  [{ delivered_at: null }, { delivered_at: "2026-06-05T08:00:00.000Z" }],
  50,
  "fixed",
  0,
  "2026-06"
);
check("null delivered_at ignored: count = 1", withNull.count, 1);

console.log("");
if (failures === 0) {
  console.log("All commission checks PASSED ✓");
  process.exit(0);
} else {
  console.log(`${failures} commission check(s) FAILED ✗`);
  process.exit(1);
}
