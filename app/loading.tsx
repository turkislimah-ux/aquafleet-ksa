/**
 * Dashboard route skeleton.
 *
 * Mirrors DashboardClient's own wrapper so the shell does not jump when the
 * real tree arrives: `space-y-6`, the title block with its `pb-4` and hairline
 * rule, then the hero spacer.
 *
 * THE HERO IS A SPACER, NOT DECORATION. DashboardClient reserves `h-[34vh]`
 * for it (the header's search bar rests there), so omitting it here would drop
 * a third of a viewport out of the skeleton and shove everything up the moment
 * real data lands.
 *
 * The body is two generic cards rather than a stat grid, because the dashboard
 * is WIDGET-DRIVEN (lib/dashboard-widgets) — how many cards render depends on
 * the viewer's saved selection, which is not knowable here.
 *
 * aria-hidden: this is decorative. Next announces the route change itself, and
 * a screen reader gains nothing from a description of grey boxes.
 */
export default function Loading() {
  return (
    <div className="space-y-6 skel-page" aria-hidden>
      {/* title + action, matching the real header's pb-4 and hairline */}
      <div>
        <div className="flex items-start justify-between gap-4 flex-wrap pb-4">
          <div className="min-w-[280px] flex-1">
            <div className="skel skel-h1" />
            <div className="skel skel-line short" />
          </div>
          <div
            className="skel"
            style={{ height: "2.35rem", width: "9rem", borderRadius: "var(--r-3)" }}
          />
        </div>
        <div className="h-px w-full" style={{ background: "rgb(var(--border))" }} />
      </div>

      {/* Hero spacer — reserves the same height the real hero holds.
          `motion-reduce:h-0` mirrors DashboardClient, which collapses the hero
          to h-0 under prefers-reduced-motion. Without it a reduced-motion
          viewer gets a 34vh gap here that vanishes when the real tree mounts —
          a third of a viewport of layout shift, for exactly the users least
          able to tolerate it. Done as a media query (Tailwind's motion-reduce
          variant) and not in JS because loading.tsx is server-rendered and
          cannot read matchMedia. */}
      <div className="relative h-[34vh] motion-reduce:h-0" />

      <div className="skel skel-card" />
      <div className="skel skel-card" />
    </div>
  );
}
