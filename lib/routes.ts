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

/** Where an unset, unknown or stale preference lands. The dashboard. */
export const DEFAULT_LANDING_ROUTE: NavHref = "/";

/**
 * Is this string one of the sidebar routes, exactly?
 *
 * Exact match, deliberately — no prefix matching and no query strings.
 * `/fleet/abc` is a truck's detail page, not a landing page, and accepting it
 * would let a stored preference point at a record that has since been archived.
 * The `?tab=` destinations are excluded for a related reason: their valid values
 * live inside each page's own union type, so checking them here would mean
 * duplicating five of those unions.
 */
export function isNavRoute(href: string | null | undefined): href is NavHref {
  if (!href) return false;
  return (NAV_HREFS as readonly string[]).includes(href);
}

/**
 * The route to actually land on, given whatever is stored.
 *
 * TOTAL BY CONSTRUCTION: null, undefined, "", whitespace, a removed route and a
 * hand-edited value all resolve to the dashboard. Callers never decide what a
 * bad value means, which is what keeps the three of them agreeing — and it means
 * a failed read is not a failure, just a default.
 */
export function resolveLandingRoute(stored: string | null | undefined): NavHref {
  const t = stored?.trim();
  return isNavRoute(t) ? t : DEFAULT_LANDING_ROUTE;
}
