/**
 * Trips route skeleton.
 *
 * Mirrors TripsTabs (bare `<div>`, PageHeader, underline tab bar) plus its
 * DEFAULT tab, ProjectsBoard — the week calendar strip, the 4-up KPI row, then
 * the stacked project cards. Projects is the tab that renders on a cold load,
 * so it is the one worth reserving space for; Customers and Finance mount from
 * client state after hydration and never see this skeleton.
 *
 * THE CALENDAR STRIP IS THE TALLEST THING ON THE PAGE and it is above the
 * fold. Its day cells are `min-h-[9rem]` inside `grid grid-cols-7 gap-2` —
 * omitting it, or standing in a generic card, would drop ~11rem out of the
 * skeleton and shove the KPI row and every project card upward the instant
 * data arrived. The grid classes are the page's own, not preview's fixed 4-up
 * `.skel-grid`; only the `.skel*` primitives are preview's.
 *
 * Tab bar: TabBtn is `px-4 py-2.5 text-sm`, so a 1.25rem bar with `.625rem 1rem`
 * of margin reproduces the same 2.5rem outer box.
 *
 * aria-hidden: decorative. Next announces the route change itself.
 */
const BORDER = { borderColor: "rgb(var(--border))" };

function StatSkeleton() {
  return (
    <div className="card p-4">
      {/* label: text-xs uppercase */}
      <div
        className="skel skel-line"
        style={{ height: ".7rem", width: "60%", marginBottom: ".55rem" }}
      />
      {/* value: text-2xl */}
      <div
        className="skel"
        style={{ height: "1.6rem", width: "45%", borderRadius: "var(--r-3)" }}
      />
    </div>
  );
}

export default function Loading() {
  return (
    <div className="skel-page" aria-hidden>
      {/* PageHeader: title + subtitle, two actions (Manage stations, New project) */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div className="min-w-[280px] flex-1">
          <div className="skel skel-h1" />
          <div className="skel skel-line short" />
        </div>
        <div className="flex items-center gap-2">
          <div className="skel" style={{ height: "2.35rem", width: "11rem", borderRadius: "var(--r-3)" }} />
          <div className="skel" style={{ height: "2.35rem", width: "9rem", borderRadius: "var(--r-3)" }} />
        </div>
      </div>

      {/* tab bar — Projects / Customers / Finance */}
      <div className="flex items-center gap-1 border-b mb-4 flex-wrap" style={BORDER}>
        {["6rem", "7rem", "6rem"].map((w) => (
          <div
            key={w}
            className="skel skel-line"
            style={{ height: "1.25rem", width: w, margin: ".625rem 1rem" }}
          />
        ))}
      </div>

      {/* week calendar strip */}
      <div className="card p-4 mb-4">
        {/* three-part header: title · week-of pill + nav · selected day */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="skel skel-line" style={{ height: "1rem", width: "8rem", marginBottom: 0 }} />
          <div className="flex-1 flex items-center justify-center gap-1.5">
            <div className="skel" style={{ height: "2.35rem", width: "2.35rem", borderRadius: "var(--r-3)" }} />
            <div className="skel skel-line" style={{ height: "1.5rem", width: "11rem", marginBottom: 0 }} />
            <div className="skel" style={{ height: "2.35rem", width: "2.35rem", borderRadius: "var(--r-3)" }} />
          </div>
          <div className="skel skel-line" style={{ height: "1rem", width: "6rem", marginBottom: 0 }} />
        </div>
        {/* Sun→Sat day cells. Bordered rather than filled: the real cells are
            outlined boxes holding project pills, so a solid `.skel` block per
            day would read as seven grey slabs where the page has seven frames. */}
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-2.5 min-h-[9rem] flex flex-col" style={BORDER}>
              <div className="flex items-baseline justify-between gap-1">
                <div className="skel skel-line" style={{ height: "1.1rem", width: "60%", marginBottom: 0 }} />
              </div>
              <div className="mt-2 flex flex-col gap-1">
                <div className="skel skel-line full" style={{ height: ".6rem", marginBottom: 0 }} />
                <div className="skel skel-line full" style={{ height: ".6rem", marginBottom: 0 }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* KPI row — scoped to the selected day */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
      </div>

      {/* project-stacked board */}
      <div className="space-y-5">
        <div className="skel skel-card" />
        <div className="skel skel-card" />
      </div>
    </div>
  );
}
