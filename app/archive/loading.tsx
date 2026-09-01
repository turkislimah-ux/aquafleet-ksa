/**
 * Archive route skeleton.
 *
 * Mirrors ArchiveClient: `space-y-5`, PageHeader with one action, the underline
 * tab bar, the 3-up expiring-documents roll-up, then the DEFAULT tab's body
 * (company — ArchiveClient.tsx:190), which is a `space-y-3` stack of group
 * cards. Truck / Staff / Commission-history mount from client state after
 * hydration and never see this skeleton.
 *
 * THE ROLL-UP SITS ABOVE THE TAB CONTENT, NOT INSIDE IT — it is a page-level
 * summary of every document, so it stays put while tabs switch beneath it. A
 * skeleton that put it below the tab bar's content would move it on arrival.
 *
 * NO `mb-4` on the tab bar: the wrapper is `space-y-5` and already owns that gap.
 *
 * Group cards are `!p-0 overflow-hidden border-s-4` — the accent rail is a
 * LOGICAL start-side border, so it mirrors to the right under RTL on its own,
 * which is why it is `border-s-4` here too and not a hardcoded left edge.
 *
 * aria-hidden: decorative. Next announces the route change itself.
 */
const BORDER = { borderColor: "rgb(var(--border))" };

function SummarySkeleton() {
  return (
    <div className="card p-4">
      <div className="skel skel-line" style={{ height: ".7rem", width: "60%", marginBottom: ".55rem" }} />
      <div className="skel" style={{ height: "1.6rem", width: "35%", borderRadius: "var(--r-3)" }} />
    </div>
  );
}

export default function Loading() {
  return (
    <div className="space-y-5 skel-page" aria-hidden>
      {/* PageHeader — title + subtitle, one action (Create group) */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div className="min-w-[280px] flex-1">
          <div className="skel skel-h1" />
          <div className="skel skel-line short" />
        </div>
        <div className="flex items-center gap-2">
          <div className="skel" style={{ height: "2.35rem", width: "9rem", borderRadius: "var(--r-3)" }} />
        </div>
      </div>

      {/* tab bar — Company / Truck / Staff / Commission history */}
      <div className="flex items-center gap-1 border-b flex-wrap" style={BORDER}>
        {["6rem", "5rem", "5.5rem", "9rem"].map((w) => (
          <div key={w} className="skel skel-line" style={{ height: "1.25rem", width: w, margin: ".625rem 1rem" }} />
        ))}
      </div>

      {/* expiring-documents roll-up — page level, above the tab content */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <SummarySkeleton />
        <SummarySkeleton />
        <SummarySkeleton />
      </div>

      {/* company groups — collapsible cards with a start-side accent rail */}
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card !p-0 overflow-hidden border-s-4" style={BORDER}>
            <div
              className="flex items-start justify-between gap-3 p-3 flex-wrap border-b"
              style={BORDER}
            >
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <div className="skel" style={{ height: "1rem", width: "1rem", borderRadius: "var(--r-3)" }} />
                <div className="min-w-0 flex-1">
                  <div className="skel skel-line" style={{ height: "1rem", width: "40%", marginBottom: ".35rem" }} />
                  <div className="skel skel-line" style={{ height: ".65rem", width: "25%", marginBottom: 0 }} />
                </div>
              </div>
              <div className="skel" style={{ height: "2rem", width: "5rem", borderRadius: "var(--r-3)" }} />
            </div>
            {/* document rows */}
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="px-3 py-2.5 border-t" style={BORDER}>
                <div className="skel skel-line full" style={{ height: "1.25rem", marginBottom: 0 }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
