"use client";

// useRecordFocus — open THE record a search hit points at, not just its page.
//
// The convention is one URL param, `?focus=<entity>:<id>`, produced by
// lib/search-routes.ts and consumed here. One param for every entity rather
// than a bespoke one per page: `?wo=`, `?os=` and `?highlightTrip=` already
// existed before this and are deliberately LEFT ALONE (search reuses them
// as-is via hrefForHit) — the goal was to stop inventing a new channel per
// entity, not to churn the three that already work.
//
// WHY THE PARAM IS CONSUMED ONCE AND THEN STRIPPED:
// if it survived in the URL, a refresh would re-open the record after the
// user closed it, and the back button would land on a page that immediately
// re-opens a modal. Same reasoning as lib/tripHighlight.ts, which already
// strips its own param on clear.
//
// This hook does NOT open anything itself. It hands the id to the page,
// which calls whatever opener it already has (setDetail, setViewPart,
// setDetailDocId, a tab switch, a row expansion). Pages differ too much for
// a shared opener to be honest about what "open" means on each.

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FOCUS_PARAM, parseFocus } from "@/lib/search-routes";

/**
 * @param entities entity keys this page can open (e.g. ["driver"], or
 *                 ["part","purchase_order","warehouse"] for Inventory)
 * @param onFocus  called ONCE per arrival with (entity, id). Safe to call
 *                 setState from — it runs in an effect, not during render.
 *
 * `onFocus` is held in a ref, so a caller passing an inline arrow function
 * (which every caller does) cannot re-trigger the effect on every render and
 * re-open the record in a loop.
 */
export function useRecordFocus(
  entities: readonly string[],
  onFocus: (entity: string, id: string) => void
) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const cbRef = useRef(onFocus);
  cbRef.current = onFocus;

  const raw = searchParams.get(FOCUS_PARAM);
  const consumedRef = useRef<string | null>(null);

  // Entity list is read through a ref-ish join so an inline array literal in
  // the caller does not change identity every render and re-run this.
  const key = entities.join(",");

  useEffect(() => {
    if (!raw || consumedRef.current === raw) return;

    const parsed = parseFocus(raw);
    if (!parsed) return;
    if (!key.split(",").includes(parsed.entity)) return;

    consumedRef.current = raw;
    cbRef.current(parsed.entity, parsed.id);

    // Strip the param so a refresh or a Back does not re-open the record.
    const next = new URLSearchParams(searchParams.toString());
    next.delete(FOCUS_PARAM);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [raw, key, pathname, router, searchParams]);
}
