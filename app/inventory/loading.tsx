/**
 * Inventory route skeleton.
 *
 * Mirrors InventoryClient: `space-y-5`, PageHeader with THREE actions (New PO /
 * Add Parts / AI Suggest), the per-warehouse underline tabs, the 5-up KPI row,
 * the sub-tab pill bar, the procurement strip, the filter card, then the parts
 * table.
 *
 * THE TAB BARS HAVE NO `mb-4` HERE, unlike Drivers and Trips. The wrapper is
 * `space-y-5`, which already owns the gap between every child — adding a margin
 * would double it and drop the whole page 1rem on arrival. Two different pages,
 * two different spacing mechanisms; the skeleton has to copy whichever one the
 * page actually uses.
 *
 * THE SUB-TAB BAR IS PILLS, NOT UNDERLINES: `inline-flex p-1 gap-1 rounded-xl
 * border` holding `px-3.5 py-2 rounded-lg text-[13px]` buttons — deliberately a
 * different shape from the warehouse tabs above it so the two stacked strips
 * read as a hierarchy. Drawing both as underline bars would misstate the page.
 *
 * The KPI row is `sm:grid-cols-5`, the parts table is `Card !p-0 overflow-hidden`
 * — the page's own classes, not preview's fixed 4-up `.skel-grid`. Only the
 * `.skel*` primitives are preview's.
 *
 * aria-hidden: decorative. Next announces the route change itself.
 */
const BORDER = { borderColor: "rgb(var(--border))" };

function StatSkeleton() {
  return (
    <div className="card p-4">
      <div className="skel skel-line" style={{ height: ".7rem", width: "60%", marginBottom: ".55rem" }} />
      <div className="skel" style={{ height: "1.6rem", width: "45%", borderRadius: "var(--r-3)" }} />
    </div>
  );
}

export default function Loading() {
  return (
    <div className="space-y-5 skel-page" aria-hidden>
      {/* PageHeader — title + subtitle, three actions */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div className="min-w-[280px] flex-1">
          <div className="skel skel-h1" />
          <div className="skel skel-line short" />
        </div>
        <div className="flex items-center gap-2">
          {["12rem", "8rem", "9rem"].map((w) => (
            <div key={w} className="skel" style={{ height: "2.35rem", width: w, borderRadius: "var(--r-3)" }} />
          ))}
        </div>
      </div>

      {/* per-warehouse underline tabs */}
      <div className="flex items-center gap-1 border-b flex-wrap" style={BORDER}>
        {["7rem", "8rem", "6rem"].map((w) => (
          <div key={w} className="skel skel-line" style={{ height: "1.25rem", width: w, margin: ".625rem 1rem" }} />
        ))}
      </div>

      {/* KPI row — 5 across */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
      </div>

      {/* sub-tab pills — Inventory levels / Approvals / Financial analysis */}
      <div className="inline-flex p-1 gap-1 rounded-xl border flex-wrap" style={BORDER}>
        {["8rem", "6rem", "9rem"].map((w) => (
          <div key={w} className="skel" style={{ height: "2.15rem", width: w, borderRadius: "var(--r-3)" }} />
        ))}
      </div>

      {/* procurement strip */}
      <div className="flex items-center gap-2 flex-wrap px-3.5 py-2.5 rounded-xl border" style={BORDER}>
        <div className="skel skel-line" style={{ height: ".8rem", width: "9rem", marginBottom: 0 }} />
        {["6rem", "8rem", "7rem"].map((w) => (
          <div key={w} className="skel" style={{ height: "1.6rem", width: w, borderRadius: "var(--r-3)" }} />
        ))}
      </div>

      {/* filter card — search + category chips, h-9 controls */}
      <div className="card !p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="skel flex-1 min-w-[200px]" style={{ height: "2.25rem", borderRadius: "var(--r-3)" }} />
          <div className="flex items-center gap-1 flex-wrap">
            {["3rem", "4.5rem", "4.5rem", "4rem", "5rem"].map((w) => (
              <div key={w} className="skel" style={{ height: "2.25rem", width: w, borderRadius: "var(--r-3)" }} />
            ))}
          </div>
        </div>
      </div>

      {/* parts table — 8 columns */}
      <div className="card !p-0 overflow-hidden">
        <div className="px-3 py-2">
          <div className="skel skel-line" style={{ height: ".75rem", width: "100%", marginBottom: 0 }} />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-3 py-2.5 border-t" style={BORDER}>
            <div className="skel skel-line full" style={{ height: "1.25rem", marginBottom: 0 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
