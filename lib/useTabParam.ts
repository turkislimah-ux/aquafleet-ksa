"use client";

// useTabParam — put a page's active tab in the URL.
//
// WHY THIS EXISTS: global search offers sub-pages as results ("Financial
// analysis", "Exit permits", "Approvals ledger"). Those are real destinations
// in a person's head, but before this hook only Trips could actually be
// linked to a tab — Drivers, Inventory, Consumption, Archive and Reports each
// held their tab in local useState with no URL reader, so `?tab=approvals`
// navigated and then silently landed on the page's default tab. A link that
// navigates but doesn't arrive is worse than no link, so those destinations
// were withheld from search until the param was real. This makes it real.
//
// The convention is lifted verbatim from TripsTabs.tsx (the one page that
// already did this), so there is one behaviour across the app rather than a
// second competing scheme:
//   · `?tab=<value>` selects the tab
//   · the DEFAULT tab omits the param entirely, keeping the bare URL clean
//   · an unknown or missing value falls back to the default rather than
//     rendering an empty page
//   · switching tabs uses router.replace, so tab changes do not stack up
//     back-history entries between the page you came from and the page you
//     are on
//
// Deliberately NOT React state: the URL IS the state. Mirroring it into
// useState as well gives two sources of truth that drift the moment the user
// hits Back — the tab would change in the address bar and not on screen.

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useTabParam<T extends string>(
  valid: readonly T[],
  fallback: T,
  param = "tab"
): [T, (next: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const raw = searchParams.get(param);
  const active = (valid as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;

  const setTab = useCallback(
    (next: T) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === fallback) params.delete(param);
      else params.set(param, next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [fallback, param, pathname, router, searchParams]
  );

  return [active, setTab];
}
