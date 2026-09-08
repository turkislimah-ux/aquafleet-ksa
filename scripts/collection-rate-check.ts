// Math confidence harness for the WITHIN-MONTH NET COLLECTION RATE (0185).
// No DB, no test framework. Same discipline as prepaid-check.ts.
// Run:  npx tsx scripts/collection-rate-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).
//
// WHAT THIS PROTECTS, and what it deliberately does NOT
// ----------------------------------------------------
// The ratio replaced cashCoverage(), which read 215% in August 2026 because it
// divided one population by another. The fix is structural, not arithmetic: the
// numerator is a `filter (...)` over the very rows the denominator sums, so
// `numerator <= denominator` holds by construction inside v_revenue_monthly.
//
// This file therefore tests TWO different things with two different methods:
//
//   1. THE TS FUNCTION — pure, exhaustively checkable here. Guard cases, the
//      zero-denominator null, and the boundary at exactly 100%.
//   2. THE SQL INVARIANT — NOT checkable here, because the guarantee lives in
//      the view, not in the function. `withinMonthCollectionRate` will happily
//      return 215% if handed the old operands; that is the point of case set B
//      below, which asserts the function does NOT self-defend. A harness that
//      "proved" boundedness by testing the function would be proving nothing
//      and would go green after a regression that re-pointed the call site at
//      v_collections_monthly. Verification block C in
//      supabase/migrations/0185_within_month_collection_rate.sql is where the
//      real invariant is checked, against the view, in the database.
//
// The LIVE FIGURES quoted below were measured 2026-09-08 against project
// ceqzmztewbborwgxnrqh and are pinned here so a future reader can re-measure
// rather than trust. They are a dated measurement, not a law — the durable
// claims are the structural ones.

import { withinMonthCollectionRate } from "../lib/reports";

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

/** One decimal, matching what formatShare renders, so the cases read as UI. */
const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

console.log("\n=== A. The live months, as the Reports Overview will print them ===");
// Measured 2026-09-08. Numerator = sum(revenue_sar) over v_revenue_invoices
// rows whose Riyadh-local paid month equals their Riyadh-local confirmed
// month; denominator = the existing, unchanged sum(revenue_sar).
const LIVE: { month: string; settled: number; revenue: number; want: number | null }[] = [
  // No revenue at all. A rate on nothing is NOT zero — zero would read as
  // "billed and collected none of it", which is a different and false claim.
  { month: "2026-06", settled: 0, revenue: 0, want: null },
  // The only month with a real gap: 44,100.00 of July's billing was still
  // unsettled at July's close.
  { month: "2026-07", settled: 26550.0, revenue: 70650.0, want: 37.6 },
  // Everything billed in August was settled inside August. Contrast the old
  // cashCoverage on the same month: 109,020.00 / 50,700.00 = 215.0%.
  { month: "2026-08", settled: 50700.0, revenue: 50700.0, want: 100.0 },
  { month: "2026-09", settled: 8470.0, revenue: 8470.0, want: 100.0 },
];
for (const m of LIVE) {
  check(`${m.month} rate`, r1(withinMonthCollectionRate(m.settled, m.revenue)), m.want);
}
// The subset property, asserted on the live numbers themselves rather than
// assumed from the SQL. Cheap, and it is the whole reason the column exists.
for (const m of LIVE) {
  check(`${m.month} numerator <= denominator`, m.settled <= m.revenue, true);
}

console.log("\n=== B. INVERTED: the function does NOT bound its own result ===");
// These cases exist to FAIL LOUDLY if someone "hardens" the function with a
// Math.min(100, …) or a same-population assertion. That would look like a
// safety improvement and would be the opposite: it would silently paper over a
// call site re-pointed at the wrong view, which is exactly the defect 0185
// fixed. The boundedness guarantee belongs to the view. If these two cases
// start failing, do not fix the cases — find out who clamped the function.
check(
  "old cashCoverage operands still reproduce August's 215%",
  r1(withinMonthCollectionRate(109020.0, 50700.0)),
  215.0,
);
check(
  "a negative numerator is passed through, not floored",
  r1(withinMonthCollectionRate(-1000, 10000)),
  -10,
);

console.log("\n=== C. Guards and boundaries ===");
// Zero denominator is the ONLY null. Note it is `revenue > 0`, not
// `revenue !== 0`: a negative denominator would produce a signed nonsense
// percentage, so it takes the null branch too.
check("zero revenue -> null", withinMonthCollectionRate(0, 0), null);
check("zero revenue, non-zero numerator -> null", withinMonthCollectionRate(500, 0), null);
check("negative revenue -> null", withinMonthCollectionRate(500, -100), null);
// Exactly at the ceiling — the common case in a month with no carry-over, and
// the one that must not round to 100.1 or 99.9.
check("exact 100%", r1(withinMonthCollectionRate(12345.67, 12345.67)), 100.0);
// Nothing settled in-month is a real, meaningful zero, unlike the null above.
check("nothing settled in-month -> 0, not null", r1(withinMonthCollectionRate(0, 70650.0)), 0);
// Rounding lands where formatShare will put it: 1/3 is 33.3, not 33.
check("one third", r1(withinMonthCollectionRate(1000, 3000)), 33.3);
// Halfway cases round the way Math.round does — pinned so a future switch to
// toFixed or Intl is a visible change rather than a silent one.
check("2/3 rounds up", r1(withinMonthCollectionRate(2000, 3000)), 66.7);

console.log(
  failures === 0
    ? "\nAll collection-rate cases passed.\n"
    : `\n${failures} case(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
