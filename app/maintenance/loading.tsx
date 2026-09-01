/**
 * Maintenance route skeleton.
 *
 * Mirrors MaintenanceClient: `space-y-5`, PageHeader with one action, the
 * in-house/outsourced track tabs, the 5-up KPI row, the week calendar, then the
 * work-order card. The default track is `in_house` (MaintenanceClient.tsx:252),
 * so that is the branch worth reserving space for — the outsourced track only
 * ever mounts from client state, after hydration, and never sees this skeleton.
 *
 * THE CALENDAR CELLS ARE `h-44` — FIXED, NOT `min-h`. The real component pins
 * them deliberately so a busy day cannot stretch the row, which means the
 * calendar's height is knowable exactly here: 11rem plus the header. Getting it
 * wrong would shift everything below it, and everything below it is the whole
 * work-order table.
 *
 * The 5th KPI tile is MonthTrendStat, which carries a third line (the
 * month-over-month trend) that the four PhaseStats do not. The grid row
 * stretches to the tallest tile, so the skeleton renders that line too — on the
 * fifth only.
 *
 * Grid classes are the page's own (`md:grid-cols-5`), not preview's fixed 4-up
 * `.skel-grid`; only the `.skel*` primitives are preview's.
 *
 * aria-hidden: decorative. Next announces the route change itself.
 */
const BORDER = { borderColor: "rgb(var(--border))" };

function PhaseStatSkeleton({ trend = false }: { trend?: boolean }) {
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
      {trend && (
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
    <div className="space-y-5 skel-page" aria-hidden>
      {/* PageHeader — title + subtitle, one action (New WO) */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div className="min-w-[280px] flex-1">
          <div className="skel skel-h1" />
          <div className="skel skel-line short" />
        </div>
        <div className="flex items-center gap-2">
          <div
            className="skel"
            style={{ height: "2.35rem", width: "8rem", borderRadius: "var(--r-3)" }}
          />
        </div>
      </div>

      {/* track tabs — In-house / Outsourced. The real buttons are
          `px-4 py-2.5 text-sm`, so a 1.25rem bar with `.625rem 1rem` of margin
          reproduces the same 2.5rem outer box. */}
      <div className="flex items-center gap-1 border-b mb-4 flex-wrap" style={BORDER}>
        {["7rem", "8rem"].map((w) => (
          <div
            key={w}
            className="skel skel-line"
            style={{ height: "1.25rem", width: w, margin: ".625rem 1rem" }}
          />
        ))}
      </div>

      {/* KPI row — 4 phase counts + the month trend tile */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <PhaseStatSkeleton />
        <PhaseStatSkeleton />
        <PhaseStatSkeleton />
        <PhaseStatSkeleton />
        <PhaseStatSkeleton trend />
      </div>

      {/* week calendar */}
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div className="skel skel-line" style={{ height: "1.1rem", width: "8rem", marginBottom: 0 }} />
          <div className="flex items-center gap-1">
            <div className="skel" style={{ height: "2rem", width: "2rem", borderRadius: "var(--r-3)" }} />
            <div className="skel" style={{ height: "2rem", width: "11.25rem", borderRadius: "var(--r-3)" }} />
            <div className="skel" style={{ height: "2rem", width: "2rem", borderRadius: "var(--r-3)" }} />
          </div>
          {/* legend: three inline counts */}
          <div className="flex items-center gap-3 flex-wrap">
            {["5rem", "5.5rem", "5rem"].map((w) => (
              <div key={w} className="skel skel-line" style={{ height: ".95rem", width: w, marginBottom: 0 }} />
            ))}
          </div>
        </div>
        {/* Sun→Sat cells, h-44 fixed. Outlined rather than filled: the real
            cells are bordered boxes holding job chips, so solid slabs here
            would read as seven grey blocks where the page has seven frames. */}
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-2.5 h-44 flex flex-col gap-1.5" style={BORDER}>
              <div className="skel skel-line" style={{ height: "1rem", width: "70%", marginBottom: 0 }} />
              <div className="skel skel-line full" style={{ height: ".75rem", marginBottom: 0 }} />
              <div className="skel skel-line full" style={{ height: ".75rem", marginBottom: 0 }} />
            </div>
          ))}
        </div>
      </div>

      {/* work orders — filter header attached to the table, one card */}
      <div className="card !p-0 overflow-hidden">
        <div
          className="flex items-center justify-between gap-3 flex-wrap p-3 border-b"
          style={BORDER}
        >
          {/* section chips: h-9 */}
          <div className="flex items-center gap-1 flex-wrap">
            {["4rem", "6rem", "6.5rem", "5rem", "6rem"].map((w) => (
              <div
                key={w}
                className="skel"
                style={{ height: "2.25rem", width: w, borderRadius: "var(--r-3)" }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="skel" style={{ height: "2.25rem", width: "7rem", borderRadius: "var(--r-3)" }} />
            <div className="skel" style={{ height: "2.25rem", width: "11rem", borderRadius: "var(--r-3)" }} />
          </div>
        </div>

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
