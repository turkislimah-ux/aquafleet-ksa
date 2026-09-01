/**
 * Consumption route skeleton.
 *
 * Mirrors ConsumptionClient: `space-y-5`, PageHeader with one action, the
 * underline tab bar, then the DEFAULT tab (permits — ConsumptionClient.tsx:118)
 * with its 4-up KPI row, status-filter chips, and the permit table.
 *
 * Usage and Approvals mount from client state after hydration and never see
 * this skeleton, so the permits body is the one worth reserving space for.
 *
 * NO `mb-4` ON THE TAB BAR: the wrapper is `space-y-5`, which already owns the
 * gap between children. Copying Drivers' `border-b mb-4` here would double it.
 *
 * The FOURTH KPI carries a `hint` line (`Kpi`'s third row, ConsumptionClient
 * .tsx:817) that the first three do not. The grid row stretches to the tallest
 * tile, so the skeleton renders that line — on the fourth only.
 *
 * aria-hidden: decorative. Next announces the route change itself.
 */
const BORDER = { borderColor: "rgb(var(--border))" };

function KpiSkeleton({ hint = false }: { hint?: boolean }) {
  return (
    <div className="card p-4">
      <div className="skel skel-line" style={{ height: ".7rem", width: "60%", marginBottom: ".55rem" }} />
      <div className="skel" style={{ height: "1.6rem", width: "45%", borderRadius: "var(--r-3)" }} />
      {hint && (
        <div
          className="skel skel-line"
          style={{ height: ".6rem", width: "75%", marginTop: ".35rem", marginBottom: 0 }}
        />
      )}
    </div>
  );
}

export default function Loading() {
  return (
    <div className="space-y-5 skel-page" aria-hidden>
      {/* PageHeader — title + subtitle, one action (New permit) */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div className="min-w-[280px] flex-1">
          <div className="skel skel-h1" />
          <div className="skel skel-line short" />
        </div>
        <div className="flex items-center gap-2">
          <div className="skel" style={{ height: "2.35rem", width: "9rem", borderRadius: "var(--r-3)" }} />
        </div>
      </div>

      {/* tab bar — Permits / Usage / Approvals */}
      <div className="flex items-center gap-1 border-b flex-wrap" style={BORDER}>
        {["6rem", "7rem", "7.5rem"].map((w) => (
          <div key={w} className="skel skel-line" style={{ height: "1.25rem", width: w, margin: ".625rem 1rem" }} />
        ))}
      </div>

      {/* KPI row — 4 across, the last one a line taller */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton hint />
      </div>

      {/* status filter chips — px-3 py-1.5 text-sm */}
      <div className="flex items-center gap-1 flex-wrap">
        {["3.5rem", "5rem", "4.5rem", "5.5rem", "5rem"].map((w) => (
          <div key={w} className="skel" style={{ height: "2.1rem", width: w, borderRadius: "var(--r-3)" }} />
        ))}
      </div>

      {/* permit table — 10 columns */}
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
