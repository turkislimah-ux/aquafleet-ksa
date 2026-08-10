// Where a search hit goes when you click it.
//
// THIS MAPPING LIVES IN THE APP, NOT THE DATABASE — deliberately.
// `search_everything` (migration 0102) returns entity + id and no URL, so a
// change to a page's query-param convention is a TypeScript edit, never a
// migration. The DB knows what a record IS; the app knows where it LIVES.
//
// THE RULE THIS FILE ENFORCES: every result must arrive somewhere.
// A link that navigates and then quietly lands on a default view is worse
// than no link — that exact failure was caught in review once already, when
// five sub-page destinations were offered before their pages could read
// `?tab=` (see lib/nav.ts's own note).
//
// So each entity declares its `precision`, honestly:
//   "record" — lands ON the record (detail route, or a page that opens it)
//   "tab"    — lands on the right page AND the right tab, record not opened
//   "page"   — lands on the page only
// Nothing here may claim a precision it cannot deliver. `precision` is not
// decoration: the results panel renders "tab"/"page" hits with a quieter
// affordance so a click's outcome matches its promise.

import { TRIP_HIGHLIGHT_PARAM } from "@/lib/tripHighlight";

/** Entity keys exactly as `public.search_everything` emits them. */
export type SearchEntity =
  | "truck" | "driver" | "staff" | "customer" | "project" | "invoice"
  | "trip" | "part" | "work_order" | "outsourced_job" | "exit_permit"
  | "purchase_order" | "archive_document" | "expense" | "supplier"
  | "warehouse" | "repairer";

export type HitPrecision = "record" | "tab" | "page";

/**
 * The shared focus convention for record-level deep links (phase C).
 * One param, `?focus=<entity>:<id>`, read by a small hook on each page —
 * riding the existing router.replace/searchParams pattern rather than
 * inventing a second navigation channel, same reasoning as tripHighlight.
 */
export const FOCUS_PARAM = "focus";

export function focusValue(entity: SearchEntity, id: string): string {
  return `${entity}:${id}`;
}

/** Parse a `?focus=` value. Returns null on anything malformed. */
export function parseFocus(raw: string | null): { entity: string; id: string } | null {
  if (!raw) return null;
  const at = raw.indexOf(":");
  if (at <= 0 || at === raw.length - 1) return null;
  return { entity: raw.slice(0, at), id: raw.slice(at + 1) };
}

function withFocus(base: string, entity: SearchEntity, id: string): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${FOCUS_PARAM}=${encodeURIComponent(focusValue(entity, id))}`;
}

type RouteSpec = {
  /** Page + tab the record lives on, before any record-level focus. */
  base: string;
  precision: HitPrecision;
  /** Set when the entity has its own detail route or an existing opener. */
  href?: (id: string) => string;
};

// PHASE B STATE. Four entities are record-precise today because they already
// had a detail route or an existing opener. The other thirteen are honestly
// declared "tab"/"page" and emit NO `?focus=` param yet — there is nothing
// reading it, and emitting it early would produce precisely the
// navigates-but-does-not-arrive link this file exists to prevent.
//
// Phase C adds a `?focus=` consumer to each of those pages and flips them to
// "record" in the same commit, so the claim and the capability land together.
const ROUTES: Record<SearchEntity, RouteSpec> = {
  // --- pre-existing record-level targets, reused rather than duplicated ---
  truck: {
    base: "/fleet",
    precision: "record",
    href: (id) => `/fleet/${id}`, // real dynamic route
  },
  work_order: {
    base: "/maintenance",
    precision: "record",
    href: (id) => `/maintenance?wo=${encodeURIComponent(id)}`, // existing opener
  },
  outsourced_job: {
    base: "/maintenance",
    precision: "record",
    href: (id) => `/maintenance?os=${encodeURIComponent(id)}`, // existing opener
  },
  trip: {
    base: "/trips?tab=projects",
    precision: "record",
    // Reuses the Kanban highlight mechanism verbatim (lib/tripHighlight.ts)
    // instead of adding a second way to point at a trip.
    href: (id) =>
      `/trips?tab=projects&${TRIP_HIGHLIGHT_PARAM}=${encodeURIComponent(id)}`,
  },

  // --- record precision via ?focus=, wired in phase C -------------------
  // Each of these has a real opener on its page, called by useRecordFocus:
  //   driver / staff     -> their own detail modal (setDetail)
  //   part               -> the part drawer, after switching to its warehouse
  //   purchase_order     -> the PO detail modal
  //   warehouse          -> its per-warehouse tab, which IS the warehouse view
  //   archive_document   -> the document detail modal
  //   exit_permit        -> its row expansion, which IS the permit detail
  driver: { base: "/drivers", precision: "record" },
  staff: { base: "/drivers?tab=staff", precision: "record" },
  part: { base: "/inventory", precision: "record" },
  purchase_order: { base: "/inventory", precision: "record" },
  warehouse: { base: "/inventory", precision: "record" },
  archive_document: { base: "/archive", precision: "record" },
  exit_permit: { base: "/consumption?tab=permits", precision: "record" },

  // --- still tab/page precision, each for a concrete reason -------------
  // These are NOT oversights and NOT a "todo later" left to rot. Each one
  // lacks something specific, and claiming record precision without it would
  // reintroduce the navigates-but-does-not-arrive link this file exists to
  // prevent. They still land on the right page and tab, and their rows say
  // "opens page" so the click's outcome matches its promise.
  //
  //   customer / project — Trips has no per-record modal reachable from
  //     outside; the openers are bound to row state inside the tab.
  //   invoice — the blocker is data, not UI: InvoicesModal is keyed by
  //     CUSTOMER, and search_everything returns only the invoice id. Opening
  //     one invoice needs its customer_id, which means amending 0102's
  //     invoice block — a migration, not an app edit.
  //   expense — the Reports expenses modal is a list with no per-row target.
  //   supplier / repairer — neither has a detail view anywhere in the app.
  customer: { base: "/trips?tab=customers", precision: "tab" },
  project: { base: "/trips?tab=projects", precision: "tab" },
  invoice: { base: "/trips?tab=finance", precision: "tab" },
  expense: { base: "/reports?tab=statements", precision: "tab" },
  supplier: { base: "/inventory", precision: "page" },
  repairer: { base: "/maintenance", precision: "page" },
};

/** Canonical group order in the results panel. Pages always lead. */
export const ENTITY_ORDER: SearchEntity[] = [
  "truck", "driver", "staff", "customer", "project", "invoice", "trip",
  "part", "purchase_order", "work_order", "outsourced_job", "exit_permit",
  "archive_document", "expense", "supplier", "warehouse", "repairer",
];

export function isSearchEntity(x: string): x is SearchEntity {
  return x in ROUTES;
}

export function hrefForHit(entity: SearchEntity, id: string): string {
  const spec = ROUTES[entity];
  if (spec.href) return spec.href(id);
  // Only attach ?focus= once the entity actually claims record precision —
  // i.e. once phase C has given its page a consumer for the param.
  if (spec.precision === "record") return withFocus(spec.base, entity, id);
  return spec.base;
}

export function precisionForEntity(entity: SearchEntity): HitPrecision {
  return ROUTES[entity].precision;
}
