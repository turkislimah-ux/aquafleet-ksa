// The app's route STRINGS, and the landing-route resolver.
//
// ==========================================================================
// THIS FILE IMPORTS NOTHING, AND THAT IS THE ENTIRE REASON IT EXISTS
// ==========================================================================
// The obvious home for this is lib/nav.ts, next to NAV itself. It cannot live
// there: lib/nav.ts imports lucide-react for the sidebar icons, and one of the
// three callers is lib/supabase/middleware.ts, which runs on the EDGE RUNTIME.
// Importing the resolver from nav.ts would drag an icon library into the
// middleware bundle — NAV holds live references to the icon components, so
// nothing tree-shakes them away — to answer a question about strings.
//
// So: strings and logic here, with zero imports. Icons and labels stay in
// nav.ts, which imports THIS one-way.
//
// ==========================================================================
// WHY VALIDATE A ROUTE AT ALL
// ==========================================================================
// user_profiles.default_route (0159) stores a plain string. There is nothing for
// it to reference — routes are an array, not a table, and inventing a routes
// table to satisfy a foreign key would create a schema object to describe a
// constant.
//
// THE CHECK THEREFORE RUNS AT BOTH ENDS, and neither substitutes for the other.
// Write-time validation stops a bad value going in. Read-time fallback handles
// the value that was VALID WHEN IT WAS WRITTEN and stopped being valid later,
// when a release renamed or removed that page. A landing page that 404s on login
// is the one broken state with no way out: it happens before the user can reach
// Settings to change it.

/**
 * Every route the sidebar offers. Must stay in step with NAV in lib/nav.ts.
 *
 * BOTH DIRECTIONS ARE CHECKED, in different ways:
 *  - NAV cannot contain a route missing from here, because NavItem types `href`
 *    as NavHref. That is a compile error.
 *  - This cannot contain a route missing from NAV, because nav.ts asserts it at
 *    module load in development. That is a console error on first render.
 *
 * The second direction is the one that matters for safety: an orphan here would
 * be treated as a valid landing page after the actual page was deleted, which is
 * precisely the 404 the fallback exists to prevent.
 */
export const NAV_HREFS = [
  "/",
  "/fleet",
  "/drivers",
  "/trips",
  "/routes",
  "/maintenance",
  "/predictive",
  "/iot",
  "/inventory",
  "/consumption",
  "/reports",
  "/archive",
] as const;

export type NavHref = (typeof NAV_HREFS)[number];

/**
 * The DEFERRED pages — routable, in the sidebar under its "Coming Soon"
 * heading, and rendering components/ComingSoon.tsx rather than a feature.
 *
 * THEY ARE NOT REMOVED FROM NAV_HREFS ABOVE, and must not be: NavItem types
 * `href` as NavHref, so dropping one here would stop lib/nav.ts compiling
 * while the page still exists and still needs a sidebar row. NAV_HREFS answers
 * "does the sidebar offer this", which for all three is yes.
 *
 * What they are excluded from is LANDING ELIGIBILITY — see below.
 */
// `satisfies` is load-bearing, not decoration. Without it a typo — "/predictiv"
// — still compiles, the filter below simply fails to match, and /predictive
// stays landing-eligible with nothing anywhere reporting it. Nothing renders
// this array, so the mistake would surface only as someone booting into a
// coming-soon page. With it, a typo is a compile error, and `as const` still
// gives DeferredHref its literal union rather than widening to NavHref.
export const DEFERRED_HREFS = ["/routes", "/predictive", "/iot"] as const satisfies readonly NavHref[];

export type DeferredHref = (typeof DEFERRED_HREFS)[number];

/**
 * The routes a user may choose to LAND ON at login.
 *
 * ==========================================================================
 * WHY THIS IS NOT JUST NAV_HREFS
 * ==========================================================================
 * A landing page is where someone arrives having just signed in, before they
 * have asked for anything. Arriving on a page whose entire content is "this is
 * not built yet" is a bad first frame of the working day — worse than a 404,
 * which at least announces itself as a mistake. It reads as the app being
 * broken or empty, every morning, silently.
 *
 * The three deferred pages stay perfectly reachable: they keep their sidebar
 * rows and they still surface in global search, which is right for a labelled
 * roadmap item somebody went looking for. The distinction is DELIBERATE CHOICE
 * versus DEFAULT DESTINATION — click through to one and you asked for it; boot
 * into one and it was chosen for you.
 *
 * DERIVED, NOT HAND-LISTED. A fourth nav route added to NAV_HREFS becomes
 * landing-eligible automatically, which is the safe default; a fourth DEFERRED
 * page is excluded by adding it to DEFERRED_HREFS alone. Two hand-kept lists
 * would drift, and the drift would be invisible — nothing renders this array.
 */
export const LANDING_HREFS = NAV_HREFS.filter(
  (h): h is Exclude<NavHref, DeferredHref> =>
    !(DEFERRED_HREFS as readonly string[]).includes(h),
);

export type LandingHref = Exclude<NavHref, DeferredHref>;

/** Where an unset, unknown or stale preference lands. The dashboard. */
export const DEFAULT_LANDING_ROUTE: LandingHref = "/";

/**
 * Is this string a route a user is allowed to LAND on, exactly?
 *
 * Exact match, deliberately — no prefix matching and no query strings.
 * `/fleet/abc` is a truck's detail page, not a landing page, and accepting it
 * would let a stored preference point at a record that has since been archived.
 * The `?tab=` destinations are excluded for a related reason: their valid values
 * live inside each page's own union type, so checking them here would mean
 * duplicating five of those unions.
 *
 * NAMED FOR THE QUESTION IT ANSWERS. This was `isNavRoute` and checked
 * NAV_HREFS, but both of its callers — the write-time check in
 * lib/actions/profile.ts and the read-time fallback below — have only ever
 * asked about the landing preference. Under the old name a third caller could
 * reasonably reach for it to ask "is this a sidebar route" and silently get an
 * answer of no for /predictive, which IS one. Renaming it means the compiler
 * finds every caller, and there is no lingering symbol that answers a question
 * it no longer answers.
 */
export function isLandingRoute(href: string | null | undefined): href is LandingHref {
  if (!href) return false;
  return (LANDING_HREFS as readonly string[]).includes(href);
}

/**
 * The route to actually land on, given whatever is stored.
 *
 * TOTAL BY CONSTRUCTION: null, undefined, "", whitespace, a removed route, a
 * route since DEFERRED and a hand-edited value all resolve to the dashboard.
 * Callers never decide what a bad value means, which is what keeps the three of
 * them agreeing — and it means a failed read is not a failure, just a default.
 *
 * The "since deferred" case is the read-side half of the rule above, and it is
 * the one that matters for anyone who set their landing page BEFORE this
 * change: their stored "/predictive" is still sitting in user_profiles, and it
 * now resolves to the dashboard without anyone having to migrate the column.
 */
export function resolveLandingRoute(stored: string | null | undefined): LandingHref {
  const t = stored?.trim();
  return isLandingRoute(t) ? t : DEFAULT_LANDING_ROUTE;
}
