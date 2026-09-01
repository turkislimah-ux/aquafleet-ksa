/**
 * Drivers route skeleton.
 *
 * Mirrors DriversClient's own return: a bare `<div>` (spacing comes from each
 * block's own `mb-*`, NOT from a `space-y-*` on the wrapper — adding one here
 * would push everything down the moment the real tree replaced it), the header
 * with `mb-5`, the underline tab bar with `border-b mb-4`, then the drivers
 * tab's 6-column KPI row and the roster table.
 *
 * THE KPI ROW IS 6 COLUMNS, NOT 4 — and it is not six equal cells. OnDutyBar
 * takes `col-span-2 md:col-span-3`, i.e. HALF the row, with three Stats in the
 * remaining three columns. preview's fixed 4-up `.skel-grid` would reflow the
 * whole row on arrival, so the grid classes are the page's own and only the
 * `.skel*` primitives come from preview.
 *
 * The tab bar reproduces TabBtn's box as margin rather than padding: TabBtn is
 * `px-4 py-2.5 text-sm`, so a 1.25rem bar with `.625rem 1rem` of margin has the
 * same 2.5rem outer height and the bar does not jump when the real buttons land.
 *
 * The table card is `p-0 overflow-hidden` like the real one, with the padding
 * moved inside each row (TH is `py-2 px-3`, TD `py-2.5 px-3 border-t`), because
 * a `p-4` card here would inset every row by 1rem the real table does not have.
 *
 * aria-hidden: decorative. Next announces the route change itself.
 */
const BORDER = { borderColor: "rgb(var(--border))" };

function StatSkeleton({ sub = false }: { sub?: boolean }) {
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
      {/* Two of the three Stats carry a `sub` (KpiNames); the first does not.
          Rendering the sub unconditionally would make the whole row a line
          taller than it ends up. */}
      {sub && (
        <div
          className="skel skel-line"
          style={{ height: ".65rem", width: "70%", marginTop: ".5rem", marginBottom: 0 }}
        />
      )}
    </div>
  );
}

export default function Loading() {
  return (
    <div className="skel-page" aria-hidden>
      {/* header — title + subtitle, one action (New driver) */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div className="min-w-[280px] flex-1">
          <div className="skel skel-h1" />
          <div className="skel skel-line short" />
        </div>
        <div className="flex items-center gap-2">
          <div
            className="skel"
            style={{ height: "2.35rem", width: "9rem", borderRadius: "var(--r-3)" }}
          />
        </div>
      </div>

      {/* tab bar — Drivers / Commissions / People */}
      <div className="flex items-center gap-1 border-b mb-4 flex-wrap" style={BORDER}>
        {["7rem", "9rem", "6rem"].map((w) => (
          <div
            key={w}
            className="skel skel-line"
            style={{ height: "1.25rem", width: w, margin: ".625rem 1rem" }}
          />
        ))}
      </div>

      {/* KPI row — OnDutyBar at half width, then three Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
        <div className="col-span-2 md:col-span-3">
          {/* OnDutyBar: header line, then one row per driver state (4) */}
          <div className="card p-4 h-full flex flex-col">
            <div className="flex items-baseline justify-between gap-3 mb-1.5">
              <div className="skel skel-line" style={{ height: ".7rem", width: "8rem", marginBottom: 0 }} />
              <div className="skel skel-line" style={{ height: ".7rem", width: "4rem", marginBottom: 0 }} />
            </div>
            <div className="flex-1 flex flex-col justify-center gap-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="skel skel-line full"
                  style={{ height: "1.1rem", marginBottom: 0 }}
                />
              ))}
            </div>
          </div>
        </div>
        <StatSkeleton />
        <StatSkeleton sub />
        <StatSkeleton sub />
      </div>

      {/* roster table */}
      <div className="card p-0 overflow-hidden">
        {/* thead: TH py-2 px-3 text-xs */}
        <div className="px-3 py-2">
          <div className="skel skel-line" style={{ height: ".75rem", width: "100%", marginBottom: 0 }} />
        </div>
        {/* rows: TD py-2.5 px-3 border-t; the driver cell stacks a name over an
            Arabic name beside an Avatar, so the row body is ~2.25rem, not one
            line. */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-3 py-2.5 border-t" style={BORDER}>
            <div className="skel skel-line full" style={{ height: "2.25rem", marginBottom: 0 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
