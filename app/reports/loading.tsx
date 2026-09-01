/**
 * Reports route skeleton.
 *
 * Mirrors ReportsClient (`space-y-5`, PageHeader, underline tab bar) plus its
 * DEFAULT tab, OverviewTab (ReportsClient.tsx:147) — which brings its own
 * `space-y-5` and two stat bands of very different shapes.
 *
 * THE TWO BANDS ARE NOT THE SAME GRID AND NOT THE SAME TILE. The north-star row
 * is `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4` of `Card p-4` with a `text-3xl`
 * value; the supporting band is `grid-cols-2 md:grid-cols-3 xl:grid-cols-6` of
 * `Card p-3` with a `text-lg` value. Drawing one generic stat grid for both —
 * which is exactly what preview's fixed 4-up `.skel-grid` would do — would
 * reflow both bands at once the moment data landed.
 *
 * The header actions are Overview-scoped and include a `<select>` period picker
 * plus two buttons, so three blocks are reserved rather than one.
 *
 * The in-progress banner OverviewTab renders above the bands is NOT reserved:
 * it appears only when the selected period is the current month. Holding a
 * permanent gap for a conditional block trades a sometimes-shift for an
 * always-shift.
 *
 * aria-hidden: decorative. Next announces the route change itself.
 */
const BORDER = { borderColor: "rgb(var(--border))" };

function BigStatSkeleton() {
  return (
    <div className="card p-4">
      {/* label: text-xs uppercase */}
      <div className="skel skel-line" style={{ height: ".7rem", width: "65%", marginBottom: ".6rem" }} />
      {/* value: text-3xl */}
      <div className="skel" style={{ height: "2rem", width: "55%", borderRadius: "var(--r-3)" }} />
      {/* delta line */}
      <div
        className="skel skel-line"
        style={{ height: ".7rem", width: "45%", marginTop: ".6rem", marginBottom: 0 }}
      />
    </div>
  );
}

function MiniStatSkeleton() {
  return (
    <div className="card p-3">
      {/* label: text-[11px] uppercase */}
      <div className="skel skel-line" style={{ height: ".65rem", width: "70%", marginBottom: ".4rem" }} />
      {/* value: text-lg */}
      <div className="skel" style={{ height: "1.15rem", width: "55%", borderRadius: "var(--r-3)" }} />
      {/* delta: text-[11px] mt-0.5 */}
      <div
        className="skel skel-line"
        style={{ height: ".6rem", width: "40%", marginTop: ".35rem", marginBottom: 0 }}
      />
    </div>
  );
}

export default function Loading() {
  return (
    <div className="space-y-5 skel-page" aria-hidden>
      {/* PageHeader — title + subtitle, period picker + dictionary + export */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div className="min-w-[280px] flex-1">
          <div className="skel skel-h1" />
          <div className="skel skel-line short" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="skel" style={{ height: "2.35rem", width: "11rem", borderRadius: "var(--r-3)" }} />
          <div className="skel" style={{ height: "2.35rem", width: "10rem", borderRadius: "var(--r-3)" }} />
          <div className="skel" style={{ height: "2.35rem", width: "7rem", borderRadius: "var(--r-3)" }} />
        </div>
      </div>

      {/* tab bar — Overview / Statements */}
      <div className="flex items-center gap-1 border-b flex-wrap" style={BORDER}>
        {["6rem", "8rem"].map((w) => (
          <div key={w} className="skel skel-line" style={{ height: "1.25rem", width: w, margin: ".625rem 1rem" }} />
        ))}
      </div>

      {/* OverviewTab brings its own space-y-5 */}
      <div className="space-y-5">
        {/* north-star KPIs — 4 up at xl */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <BigStatSkeleton />
          <BigStatSkeleton />
          <BigStatSkeleton />
          <BigStatSkeleton />
        </div>

        {/* supporting band — 6 up at xl, smaller tiles */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <MiniStatSkeleton key={i} />
          ))}
        </div>

        {/* paired report blocks */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="skel skel-card" />
          <div className="skel skel-card" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="skel skel-card" />
          <div className="skel skel-card" />
        </div>
      </div>
    </div>
  );
}
