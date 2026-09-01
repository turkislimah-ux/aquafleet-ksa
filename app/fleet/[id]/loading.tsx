/**
 * Truck detail route skeleton.
 *
 * Mirrors FleetDetailClient: `space-y-5`, PageHeader, a 4-up stat grid
 * (`grid-cols-2 md:grid-cols-4 gap-3`), the spec card whose inner grid is
 * `md:grid-cols-3 lg:grid-cols-4`, then the `lg:grid-cols-3` body split.
 *
 * Grid classes are copied from the real component rather than from preview's
 * fixed 4-up `.skel-grid`, so the columns break at the same widths and nothing
 * reflows when data lands. Primitives are preview's `.skel*`.
 *
 * This segment has its own loading.tsx because /fleet/[id] is a separate route
 * segment — /fleet's skeleton does NOT cover it, and its layout is different
 * enough (no filter bar, a spec card, a 2/1 body split) that reusing one would
 * shift on arrival.
 */
function StatSkeleton() {
  return (
    <div className="card p-4">
      <div
        className="skel skel-line"
        style={{ height: ".7rem", width: "60%", marginBottom: ".55rem" }}
      />
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
      {/* PageHeader: title + subtitle, two actions */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div className="min-w-[280px] flex-1">
          <div className="skel skel-h1" />
          <div className="skel skel-line short" />
        </div>
        <div className="flex items-center gap-2">
          <div className="skel" style={{ height: "2.35rem", width: "7rem", borderRadius: "var(--r-3)" }} />
          <div className="skel" style={{ height: "2.35rem", width: "9rem", borderRadius: "var(--r-3)" }} />
        </div>
      </div>

      {/* 4-up stat grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
        <StatSkeleton />
      </div>

      {/* spec card — inner grid matches the real one */}
      <div className="card">
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i}>
              <div
                className="skel skel-line"
                style={{ height: ".7rem", width: "70%", marginBottom: ".5rem" }}
              />
              <div
                className="skel skel-line"
                style={{ height: "1rem", width: "50%", marginBottom: 0 }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* body split: 2/3 + 1/3 on lg */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 skel skel-card" />
        <div className="skel skel-card" />
      </div>
    </div>
  );
}
