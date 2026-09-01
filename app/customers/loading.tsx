/**
 * Customers route skeleton.
 *
 * Mirrors CustomerForm (the client island page.tsx delegates to): PageHeader,
 * then a RIGHT-ALIGNED action row of its own, then the table card.
 *
 * THE ACTION IS NOT IN THE HEADER. CustomerForm calls PageHeader with title and
 * subtitle only, and PageHeader renders its actions slot conditionally
 * (components/ui.tsx:13), so the header here is a single flex child. "New
 * customer" sits below it in `flex justify-end mb-4`. Putting the button block
 * in the header would leave a ~3.6rem row unaccounted for and collapse the
 * header's own right side on arrival.
 *
 * No `space-y-*` on the wrapper: page.tsx wraps in a bare `<div>` and spacing
 * comes from each block's `mb-*`.
 *
 * Table is `card p-0 overflow-hidden` with padding inside the rows, matching
 * TH (`py-2 px-3`) and TD (`py-2.5 px-3 border-t`) — a `p-4` card would inset
 * every row by 1rem the real table does not have. Rows are single-line here
 * (unlike Drivers, whose cell stacks two names beside an Avatar).
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

      {/* New customer — its own right-aligned row */}
      <div className="flex justify-end mb-4">
        <div
          className="skel"
          style={{ height: "2.35rem", width: "10rem", borderRadius: "var(--r-3)" }}
        />
      </div>

      {/* customers table — 7 columns */}
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
