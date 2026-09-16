// The Fleet page's two tabs, and the ONE mapping from a vehicle to the tab it
// lives on. PLAIN MODULE: no React, no data access.
//
// ==========================================================================
// WHY THIS IS NOT JUST A CONST INSIDE FleetClient
// ==========================================================================
// `/fleet/[id]` has to send the reader back to the tab the vehicle came from.
// The obvious fix — read the tab the visitor arrived with and hand it back —
// is wrong twice over: the detail page is a real destination (global search
// links straight to it, so does a bookmark and so does a refresh), and there
// is no arrival tab to read in either case. The fix that was actually asked
// for is to fix the ORIGIN of the return: the tab a vehicle belongs to is a
// fact about the vehicle, so derive it from `vehicle_class` and the answer is
// right no matter how the reader got there.
//
// That derivation has to name a tab, and a tab name typed into a link is a
// hardcode that FleetClient's own list can drift away from. So the list and
// the mapping live here, and FleetClient renders from the same array the
// detail page links into.
//
// `fleetHref` MIRRORS useTabParam's rule that the fallback tab carries NO
// param (lib/useTabParam.ts:47). Without that, a back link would land on
// `/fleet?tab=trucks` while the tab bar itself produces `/fleet` — the same
// page under two URLs, which is how a Back button starts repeating itself.

import type { VehicleClass } from "@/lib/db-types";

/** Reading order: trucks are the fleet's default population, 0201's second class follows. */
export const FLEET_TABS = ["trucks", "operation"] as const;
export type FleetTab = (typeof FLEET_TABS)[number];

/** The tab shown when the URL names none — and the one that carries no param. */
export const FLEET_TAB_FALLBACK: FleetTab = "trucks";

/**
 * Which tab holds a vehicle of this class.
 *
 * Branches on "operation" rather than on "truck" so a future third class
 * defaults to the Trucks tab — visible in the wrong group beats invisible.
 */
export function fleetTabForClass(cls: VehicleClass): FleetTab {
  return cls === "operation" ? "operation" : "trucks";
}

/** The Fleet URL for a tab. */
export function fleetHref(tab: FleetTab): string {
  return tab === FLEET_TAB_FALLBACK ? "/fleet" : `/fleet?tab=${tab}`;
}

/** The Fleet URL a vehicle of this class came from — the back link. */
export function fleetHrefForClass(cls: VehicleClass): string {
  return fleetHref(fleetTabForClass(cls));
}
