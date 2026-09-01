/**
 * Projects route skeleton.
 *
 * Mirrors ProjectForm (the client island page.tsx delegates to), which has the
 * same shape as Customers: PageHeader with NO actions slot, then a right-aligned
 * "New project" row of its own (`flex justify-end mb-4`), then the table card.
 * See app/customers/loading.tsx for why the button is not in the header.
 *
 * The table is 5 columns here against Customers' 7 — the skeleton draws one bar
 * per row rather than per cell, so the column count changes nothing, but the
 * ROW HEIGHT does matter and it is single-line in both.
 *
 * ProjectForm can also render a "needs a customer first" line under the button
 * (`text-sm muted mb-4`), but only when the customer list comes back empty. It
 * is not reserved for here: on a stocked account it never appears, and holding
 * a permanent gap for the rarer case trades a real shift for a guaranteed one.
 *
 * aria-hidden: decorative. Next announces the route change itself.
 */
const BORDER = { borderColor: "rgb(var(--border))" };

export default function Loading() {
  return (
    <div className="skel-page" aria-hidden>
      {/* PageHeader — title + subtitle, no actions slot */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div className="min-w-[280px] flex-1">
          <div className="skel skel-h1" />
          <div className="skel skel-line short" />
        </div>
      </div>

      {/* New project — its own right-aligned row */}
      <div className="flex justify-end mb-4">
        <div
          className="skel"
          style={{ height: "2.35rem", width: "9rem", borderRadius: "var(--r-3)" }}
        />
      </div>

      {/* projects table — 5 columns */}
      <div className="card p-0 overflow-hidden">
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
