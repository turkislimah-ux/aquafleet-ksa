"use client";

// Reusable "jump to and highlight a trip card on the Kanban board" mechanism.
// Used by: invoice/statement clickable trip refs (this batch). A later batch
// reuses this same URL param + hook for an undelivered-trips list — keep this
// generic (trip id in, highlighted-id + clear-fn out), not invoice-specific.
//
// How the target trip is passed to the board: a URL query param on the
// existing /trips route, alongside the existing `?tab=` param (see
// TripsTabs.tsx). Example: /trips?tab=projects&highlightTrip=<uuid>.
// This rides the existing router.replace/searchParams pattern rather than
// inventing a second navigation channel (React context, global state, etc.).

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const TRIP_HIGHLIGHT_PARAM = "highlightTrip";

/** Build an href that navigates to the Kanban board and highlights one trip. */
export function tripHighlightHref(tripId: string): string {
  return `/trips?tab=projects&${TRIP_HIGHLIGHT_PARAM}=${encodeURIComponent(tripId)}`;
}

type MinimalTrip = { id: string; trip_date: string };

/**
 * Board-side hook. Call from ProjectsBoard with the full (already-loaded)
 * trips list. On mount, if `?highlightTrip=<id>` is present and resolves to
 * a known trip, returns its id as `highlightedTripId` and exposes
 * `correctedDay` (the trip's own trip_date) so the board can jump its
 * selectedDay/weekStart to a day that actually contains the card — the board
 * is day-scoped, so a plain id isn't enough to make the card render.
 * `clearHighlight()` is called on card hover (per spec: highlight clears on
 * hover) and also strips the param from the URL so a refresh doesn't re-highlight.
 */
export function useIncomingTripHighlight(trips: MinimalTrip[]) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramTripId = searchParams.get(TRIP_HIGHLIGHT_PARAM);

  const [highlightedTripId, setHighlightedTripId] = useState<string | null>(null);
  const [consumedParam, setConsumedParam] = useState<string | null>(null);
  // `armed` gates clearHighlight so a stray mouseenter fired by the arrival
  // scrollIntoView (browsers re-run :hover hit-testing on scroll, no real
  // mouse movement needed) can't clear the highlight before the user sees
  // it. Independent of the ring-paint bug (globals.css) — still needed.
  const [armed, setArmed] = useState(false);

  const target = useMemo(() => {
    if (!paramTripId) return null;
    return trips.find((t) => t.id === paramTripId) ?? null;
  }, [paramTripId, trips]);

  useEffect(() => {
    if (paramTripId && paramTripId !== consumedParam && target) {
      setHighlightedTripId(target.id);
      setConsumedParam(paramTripId);
      setArmed(false);
    }
  }, [paramTripId, consumedParam, target]);

  // Arms hover-to-clear only after the arrival scroll has had time to settle
  // (smooth scrollIntoView typically finishes well under 500ms).
  useEffect(() => {
    if (!highlightedTripId) return;
    const t = setTimeout(() => setArmed(true), 700);
    return () => clearTimeout(t);
  }, [highlightedTripId]);

  function clearHighlight() {
    if (!highlightedTripId || !armed) return;
    setHighlightedTripId(null);
    const next = new URLSearchParams(searchParams.toString());
    next.delete(TRIP_HIGHLIGHT_PARAM);
    const qs = next.toString();
    router.replace(qs ? `/trips?${qs}` : "/trips", { scroll: false });
  }

  return {
    highlightedTripId,
    correctedDay: target?.trip_date ?? null,
    clearHighlight,
  };
}
