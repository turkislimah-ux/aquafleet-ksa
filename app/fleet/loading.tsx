/**
 * Fleet list route skeleton.
 *
 * Mirrors FleetClient: `space-y-5`, PageHeader, the TAB BAR, the 5-up KPI
 * strip, the filter bar, then the table card.
 *
 * THE TAB BAR IS PART OF THE SKELETON, not scenery. 0201 split this page into
 * Trucks and Operation Vehicles, and a skeleton that omits the bar lets the
 * real page push the KPI strip, the filters and the whole table down by the
 * bar's height the instant it arrives — a shift on every single Fleet load,
 * which is the one thing a skeleton exists to prevent.
 *
 * IT DRAWS THE *TRUCKS* TAB'S BODY, unconditionally. `loading.tsx` is rendered
 * by the router with no searchParams, so it cannot know whether the reader is
 * heading for `?tab=operation`. Trucks is the fallback tab
 * (lib/fleet-tabs.ts), so it is the right guess — and the two bodies share
 * their shape anyway: header, strip, filter bar, table.
 *
 * NO ACTIVE-TAB UNDERLINE. The real bar paints the selected tab in
 * `border-brand-600`, and a skeleton that guesses WHICH tab is selected is
 * wrong half the time in a colour the eye reads as content. The container's
 * own `border-b` is what holds the vertical space; the two blocks inside are
 * grey like every other `.skel`.
 *
 * THE GRID CLASSES ARE THE PAGE'S OWN, NOT preview's `.skel-grid`. preview
 * ships a fixed 4-column skeleton grid because the demo used ONE skeleton for
 * every route; this strip is `lg:grid-cols-5`, so borrowing the 4-up grid
 * would reflow the whole strip the instant real data arrived — the exact shift
 * this is meant to prevent. The `.skel*` PRIMITIVES are preview's; the layout
 * is the page's.
 *
 * Each stat is a real `card p-4`, so padding, border, radius and background
 * come from the app's own class rather than a guessed height.
 */
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
    <div className="space-y-5 skel-page" aria-hidden>
      {/* PageHeader: mb-5, title + subtitle, one action button */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div className="min-w-[280px] flex-1">
          <div className="skel skel-h1" />
          <div className="skel skel-line short" />
        </div>
        <div
          className="skel"
          style={{ height: "2.35rem", width: "7rem", borderRadius: "var(--r-3)" }}
        />
      </div>

      {/* Tab bar — the container is FleetClient's own line for line, so the
          rule under it lands at the same y the real one will. Each block is
          the size of a tab's label inside its `px-4 py-2.5` button. */}
      <div className="flex items-center gap-1 border-b flex-wrap" style={{ borderColor: "rgb(var(--border))" }}>
        <div className="px-4 py-2.5">
          <div className="skel skel-line" style={{ height: "1.25rem", width: "3.5rem", marginBottom: 0 }} />
        </div>
        <div className="px-4 py-2.5">
          <div className="skel skel-line" style={{ height: "1.25rem", width: "7rem", marginBottom: 0 }} />
        </div>
      </div>

      {/* KPI strip — 5, matching FleetClient exactly */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
      </div>

      {/* filter bar — Card !p-3 with h-9 controls */}
      <div className="card !p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="skel flex-1 min-w-[200px]"
            style={{ height: "2.25rem", borderRadius: "var(--r-3)" }}
          />
          <div className="skel" style={{ height: "2.25rem", width: "4rem", borderRadius: "var(--r-3)" }} />
          <div className="skel" style={{ height: "2.25rem", width: "4rem", borderRadius: "var(--r-3)" }} />
          <div className="skel" style={{ height: "2.25rem", width: "4rem", borderRadius: "var(--r-3)" }} />
          <div className="skel" style={{ height: "2.25rem", width: "9rem", borderRadius: "var(--r-3)" }} />
        </div>
      </div>

      {/* truck table */}
      <div className="card p-4">
        <div className="skel skel-line lg" style={{ width: "100%", marginBottom: "1rem" }} />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skel skel-line full" style={{ height: "1.15rem", marginBottom: ".85rem" }} />
        ))}
      </div>
    </div>
  );
}
