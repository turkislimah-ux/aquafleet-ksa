// The app's navigation model, in ONE place.
//
// This used to be a private `NAV` const inside components/AppShell.tsx. It
// moved here because global search needs to offer the pages themselves as
// results, and AppShell imports the search component — so a search component
// importing NAV back out of AppShell would be a genuine import cycle. That
// exact failure is on the record (CLAUDE.md §7, Phase 4 lesson: tsc and
// next build do NOT catch it; Next's dev module system resolves it to
// `undefined` at request time and the page renders blank).
//
// So: this is a leaf module. It imports nothing from app/ or components/,
// and both AppShell and the search index import it one-way.
//
// Nav mirrors the demo's routes exactly (preview/app.js NAV). Fleet Detail
// (/fleet/:id) is a sub-route reached via "View", not a nav entry.

import {
  LayoutDashboard, Truck as TruckIcon, Users, Route, Wrench, Brain,
  Boxes, FileBarChart, Activity, MapPin, Archive, PackageMinus,
  type LucideIcon,
} from "lucide-react";
import { NAV_HREFS, type NavHref } from "@/lib/routes";

/**
 * Which block of the sidebar an entry renders in. "soon" is the deferred trio
 * (Route Optimization, Predictive AI, IoT Monitoring) — the three pages listed
 * as deliberately deferred in CLAUDE.md's Deferred line. They stay routable and
 * stay in NAV_HREFS: the pages render, they are just grouped under a heading
 * that says so, rather than sitting in the main list implying parity with
 * Trips or Reports.
 */
export type NavGroup = "main" | "soon";

export type NavItem = {
  /**
   * Typed NavHref, not string — so a nav entry pointing at a route missing from
   * lib/routes.ts is a compile error rather than a landing preference that
   * validates today and 404s after the page is renamed.
   */
  href: NavHref;
  /** i18n key under `nav.` — every key below exists in lib/i18n.ts. */
  key?: string;
  /** Overrides the i18n lookup when set. */
  label?: string;
  icon: LucideIcon;
  group: NavGroup;
};

// ARRAY ORDER IS RENDER ORDER, including across the group split — the deferred
// trio sits at the end here because it sits at the end on screen. `group` is
// not a sort key: the sidebar filters into two blocks and each keeps this
// order, so moving a line here is the whole edit.
export const NAV: NavItem[] = [
  { href: "/", key: "dashboard", icon: LayoutDashboard, group: "main" },
  { href: "/fleet", key: "fleet", icon: TruckIcon, group: "main" },
  { href: "/drivers", key: "drivers", icon: Users, group: "main" },
  { href: "/trips", key: "trips", icon: Route, group: "main" },
  { href: "/maintenance", key: "maintenance", icon: Wrench, group: "main" },
  { href: "/inventory", key: "inventory", icon: Boxes, group: "main" },
  { href: "/consumption", key: "consumption", icon: PackageMinus, group: "main" },
  { href: "/reports", key: "reports", icon: FileBarChart, group: "main" },
  { href: "/archive", key: "archive", icon: Archive, group: "main" },

  { href: "/routes", key: "routes", icon: MapPin, group: "soon" },
  { href: "/predictive", key: "predictive", icon: Brain, group: "soon" },
  { href: "/iot", key: "iot", icon: Activity, group: "soon" },
];

// ---------------------------------------------------------------------------
// ROUTE STRINGS AND THE LANDING RESOLVER LIVE IN lib/routes.ts, NOT HERE.
//
// The resolver has three callers: the Profile editor (validates before writing),
// app/login/page.tsx (redirects after sign-in) and lib/supabase/middleware.ts
// (redirects an already-signed-in user off /login). That third one runs on the
// EDGE RUNTIME, and this module imports lucide-react — NAV holds live references
// to the icon components, so nothing tree-shakes them away. Importing the
// resolver from here would drag an icon library into the middleware bundle to
// answer a question about strings.
//
// So the strings live in a leaf module with no imports, and this file depends on
// IT. Re-exported below so UI code still has a single nav import.
// ---------------------------------------------------------------------------
export { NAV_HREFS, type NavHref };
export { DEFAULT_LANDING_ROUTE, isNavRoute, resolveLandingRoute } from "@/lib/routes";

// BOTH DIRECTIONS OF THE NAV / NAV_HREFS AGREEMENT ARE CHECKED.
//
// NAV cannot hold a route missing from NAV_HREFS: NavItem types `href` as
// NavHref, so that is a compile error.
//
// The reverse is not expressible while NAV stays a mutable NavItem[], so it is
// asserted at module load in development instead. It is the direction that
// matters: an orphan in NAV_HREFS passes isNavRoute for a page that no longer
// renders, which would defeat the read-side fallback and 404 someone at login —
// the one failure with no way out, since it happens before they can reach
// Settings to change the preference.
if (process.env.NODE_ENV !== "production") {
  const orphans = NAV_HREFS.filter((h) => !NAV.some((n) => n.href === h));
  if (orphans.length) {
    console.error(
      `[nav] NAV_HREFS lists ${orphans.join(", ")} but NAV does not render them. ` +
        `A stored landing preference could resolve to a page that no longer exists.`,
    );
  }
}

/**
 * Named destinations INSIDE a page — the tabs a person actually thinks of
 * as places ("Finance", "Approvals", "Statements"). Search offers these
 * alongside the top-level pages, because "where do I add a customer's
 * balance" is a navigation question, not a record lookup.
 *
 * ONLY conventions that ACTUALLY WORK are listed here. That is a hard rule,
 * not caution. A first draft offered these same sub-page links while Trips
 * was the only page in the app that read its tab out of the URL — Drivers,
 * Inventory, Consumption, Archive and Reports all held tab in local useState
 * with no param reader — so every one of them would have navigated and then
 * silently landed on the page's DEFAULT tab. They were withheld until the
 * param was real.
 *
 * It is real now: all five pages read `?tab=` through lib/useTabParam.ts,
 * which follows TripsTabs.tsx's existing convention exactly (default tab
 * omits the param, unknown value falls back, router.replace so tab switches
 * don't stack history). Every href below has a live reader behind it.
 *
 * Tab VALUES are the ones the components actually accept, read off each
 * client's own union type — not guessed from the visible label. Notably
 * Reports uses `statements`, not `reports`, and Inventory uses `analysis`,
 * not `finance`.
 */
export type NavDestination = {
  href: string;
  en: string;
  ar: string;
  /** Parent page label, shown as the result's subtitle. */
  parentKey: string;
  icon: LucideIcon;
};

export const NAV_DESTINATIONS: NavDestination[] = [
  // Trips
  { href: "/trips?tab=projects", en: "Projects board", ar: "لوحة المشاريع", parentKey: "trips", icon: Route },
  { href: "/trips?tab=customers", en: "Customers", ar: "العملاء", parentKey: "trips", icon: Users },
  { href: "/trips?tab=finance", en: "Finance / Invoice", ar: "المالية / الفواتير", parentKey: "trips", icon: FileBarChart },

  // Staff (the page is /drivers; the nav label is "Staff")
  { href: "/drivers?tab=staff", en: "Staff", ar: "الموظفون", parentKey: "drivers", icon: Users },
  { href: "/drivers?tab=commissions", en: "Commissions", ar: "العمولات", parentKey: "drivers", icon: FileBarChart },
  { href: "/drivers?tab=history", en: "Driver history", ar: "سجل السائقين", parentKey: "drivers", icon: Users },

  // Inventory
  { href: "/inventory?tab=approvals", en: "Inventory approvals", ar: "موافقات المخزون", parentKey: "inventory", icon: Boxes },
  { href: "/inventory?tab=analysis", en: "Financial analysis", ar: "التحليل المالي", parentKey: "inventory", icon: FileBarChart },

  // Consumption
  { href: "/consumption?tab=permits", en: "Exit permits", ar: "تصاريح الخروج", parentKey: "consumption", icon: PackageMinus },
  { href: "/consumption?tab=usage", en: "Parts usage", ar: "استهلاك القطع", parentKey: "consumption", icon: PackageMinus },
  { href: "/consumption?tab=approvals", en: "Consumption approvals", ar: "موافقات الاستهلاك", parentKey: "consumption", icon: PackageMinus },

  // Reports
  { href: "/reports?tab=statements", en: "Statements", ar: "كشوف الحساب", parentKey: "reports", icon: FileBarChart },

  // Archive
  { href: "/archive?tab=staff", en: "Staff documents", ar: "وثائق الموظفين", parentKey: "archive", icon: Archive },
  { href: "/archive?tab=truck", en: "Truck documents", ar: "وثائق الشاحنات", parentKey: "archive", icon: Archive },
  { href: "/archive?tab=customer", en: "Customer documents", ar: "وثائق العملاء", parentKey: "archive", icon: Archive },
  { href: "/archive?tab=ledger", en: "Approvals ledger", ar: "سجل الموافقات", parentKey: "archive", icon: Archive },

  // --- REPORT TYPES ------------------------------------------------------
  // Each statement in the Reports pack is its own destination: "P&L" or
  // "الأرباح والخسائر" opens that statement directly, not the Reports page
  // with P&L merely selected by default.
  //
  // They ride `?statement=` (StatementsTab's own reader), NOT `?tab=` —
  // `?tab=statements` already means "the Reports pack" one level up in
  // ReportsClient, so reusing it here would collide. Two levels, two params.
  //
  // Arabic labels are NEW here: STATEMENTS in StatementsTab.tsx is
  // English-only, and adding an `ar` there would have meant restyling that
  // tab strip mid-batch. The search index carries both languages; the tab
  // strip's own labels are untouched.
  { href: "/reports?tab=statements&statement=pnl", en: "P&L statement", ar: "قائمة الأرباح والخسائر", parentKey: "reports", icon: FileBarChart },
  { href: "/reports?tab=statements&statement=revenue", en: "Revenue statement", ar: "قائمة الإيرادات", parentKey: "reports", icon: FileBarChart },
  { href: "/reports?tab=statements&statement=receivables", en: "Receivables statement", ar: "قائمة الذمم المدينة", parentKey: "reports", icon: FileBarChart },
  { href: "/reports?tab=statements&statement=cost", en: "Costs statement", ar: "قائمة التكاليف", parentKey: "reports", icon: FileBarChart },
  { href: "/reports?tab=statements&statement=operations", en: "Operations statement", ar: "قائمة العمليات", parentKey: "reports", icon: FileBarChart },
  // Daily Trips indexes like any other statement, because it is one. The Arabic
  // here matches the report's own print-band title rather than being coined
  // separately — a search for "تقرير الرحلات اليومي" should land on the page
  // that prints those exact words at the top.
  { href: "/reports?tab=statements&statement=daily", en: "Daily Trips report", ar: "تقرير الرحلات اليومي", parentKey: "reports", icon: FileBarChart },
  // Payslips was the ONE statement in the pack that was never indexed, while
  // every sibling was — the destination has been live since 0115, just
  // unreachable from search.
  //
  // Its Arabic is COINED, not reused, and that is a real difference from the
  // Daily Trips line above. There was nothing to reuse: PayslipsStatement
  // carries no Arabic at all, which is the English-only situation the note at
  // the top of this block already describes. "قسائم الرواتب" is the plain term
  // for the documents themselves.
  //
  // It is not "قائمة …" like the four accounting statements above it, on
  // purpose: those are financial STATEMENTS, this is a register of issued
  // documents — the same reason Daily Trips is a "تقرير". The block already
  // varies the noun by what the thing actually is.
  { href: "/reports?tab=statements&statement=payslips", en: "Payslips register", ar: "قسائم الرواتب", parentKey: "reports", icon: FileBarChart },
  { href: "/reports?tab=statements&statement=narrative", en: "Narrative statement", ar: "التقرير السردي", parentKey: "reports", icon: FileBarChart },
  // A custom report is not a stored object — there is nothing to deep-link
  // TO — so the builder itself is the destination, per Turki's own framing.
  { href: "/reports?tab=statements&statement=custom", en: "Custom report builder", ar: "منشئ التقارير المخصصة", parentKey: "reports", icon: FileBarChart },
];
