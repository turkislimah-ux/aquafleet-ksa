// ONE colour per cost bucket, for every surface that breaks operating cost down.
//
// ===========================================================================
// WHY THIS FILE EXISTS
// ===========================================================================
// Two doughnuts show the same five buckets: Reports Overview (lib/reports.ts's
// `costBuckets`) and the Dashboard's Cost mix (lib/dashboard.ts's `COST_TYPE`).
// They were written months apart and each hardcoded its own hexes, which drifted
// in the worst possible way — not a shade apart, but SWAPPED:
//
//     bucket        Reports     Dashboard
//     Payroll       #f59e0b     #8b5cf6
//     Outsourced    #8b5cf6     #f59e0b
//
// So a user moving between the two pages saw the amber wedge mean payroll on one
// and outsourced work on the other. That is worse than two arbitrary palettes,
// because the colours look consistent while meaning opposite things. Station
// fill was the only bucket that already matched, and only because it was added
// to both from a single source.
//
// A LEAF MODULE, importing nothing. lib/reports.ts and lib/dashboard.ts are
// siblings — neither is the other's parent, and having one import the other
// would have made Reports depend on the Dashboard's module for no reason. This
// is the same fix the Phase-4 import-cycle lesson in CLAUDE.md prescribes:
// genuinely shared pieces get their own leaf that both sides import one-way.
//
// ===========================================================================
// NO NEW COLOURS WERE INVENTED
// ===========================================================================
// Every hex below is lifted verbatim from the DASHBOARD's COST_TYPE, which was
// picked as canonical because it already covers all six buckets (Reports' five
// plus "other"), already carries the bilingual labels, and already had three
// consumers. Reports' Payroll and Outsourced therefore swap to match — that is
// the whole point of the change, not a side effect.
//
// Adding a bucket: add it here first, then read it from both mappings. Never
// hardcode a bucket hex at a call site again.
// ===========================================================================

export type CostBucketKey =
  | "parts"
  | "outsourced"
  | "payroll"
  | "commissions"
  | "filling"
  | "other";

export const COST_COLOR: Record<CostBucketKey, string> = {
  parts: "#0b7eea",
  outsourced: "#f59e0b",
  payroll: "#8b5cf6",
  commissions: "#10b981",
  /** Station fill (0112). Cyan on both surfaces already — kept exactly. */
  filling: "#06b6d4",
  /**
   * Manual expenses. Dashboard-only today: the Cost mix doughnut and the
   * Reports cost statement both scope themselves to OPERATING cost, and 0098
   * keeps manual expenses as their own P&L section. The monthly Cost
   * composition bar is the one surface that includes it, against its own
   * `total_cost_sar` denominator.
   */
  other: "#64748b",
};
