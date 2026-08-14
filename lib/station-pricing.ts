// Water-station per-type fill pricing (migration 0110).
//
// LEAF MODULE — imports nothing from app/ or components/, so the server page,
// the client forms and the trip actions can all read it one-way (the Phase-4
// import-cycle lesson in CLAUDE.md §7).
//
// ===========================================================================
// NULL IS NOT ZERO, AND THAT DISTINCTION IS THE WHOLE MODEL
// ===========================================================================
//   price SET (including 0)  ->  the station OFFERS that water type
//   price NULL               ->  the station does NOT offer it
//
// 0 is a real price — company-owned stations fill free — so it can never be
// collapsed into "no price". Every helper here preserves that, and anything
// that coerces one into the other (`?? 0`, `Number(x) || 0`, a truthiness
// check) reintroduces the bug the schema was shaped to prevent.

import type { WaterType } from "@/lib/db-types";

/** The two priced columns, as they exist on water_stations. */
export type StationPricing = {
  fill_cost_potable_sar: number | null;
  fill_cost_non_potable_sar: number | null;
};

/**
 * A station as every trip-creation surface needs it: enough to name it, and
 * enough to know what it offers. The prices travel WITH the option because a
 * picker that cannot see them cannot block an unoffered type — the previous
 * shape was `{ key, name }` and stopped exactly there.
 */
export type StationOption = StationPricing & {
  key: string;
  name: string;
};

/**
 * The station's price for one water type, or null when it does not offer it.
 * The ONLY place the water_type -> column mapping is written down.
 */
export function stationPriceFor(
  station: StationPricing | null | undefined,
  waterType: WaterType,
): number | null {
  if (!station) return null;
  const v = waterType === "potable"
    ? station.fill_cost_potable_sar
    : station.fill_cost_non_potable_sar;
  // Explicit null check rather than `?? null` or a falsy test: 0 must survive.
  return v === null || v === undefined ? null : Number(v);
}

/** Does this station offer that type at all? */
export function stationOffers(
  station: StationPricing | null | undefined,
  waterType: WaterType,
): boolean {
  return stationPriceFor(station, waterType) !== null;
}

/**
 * A station is UNPRICED when neither type has a price.
 *
 * THIS IS A MIGRATION-WINDOW STATE, NOT A LASTING ONE. Every station saved
 * through the new form must offer at least one type (the form requires it, and
 * 0110's CHECK backs it), so only rows that predate the form can be unpriced.
 * Live, that is all four of them until Turki enters prices.
 *
 * It exists so the trip-add blocking can degrade gracefully instead of making
 * trip creation impossible the moment the rule ships — see selectableWaterTypes.
 */
export function stationIsUnpriced(station: StationPricing | null | undefined): boolean {
  return !stationOffers(station, "potable") && !stationOffers(station, "non_potable");
}

/**
 * Which water types the user may pick for a trip at this station.
 *
 * THE GATE, AND WHY IT IS NOT A LOOPHOLE. If a station has no prices at all it
 * is a legacy row, and blocking on it would freeze trip creation entirely —
 * every station is unpriced today. So an unpriced station allows both types,
 * exactly as it did before this feature existed, and a station with ANY price
 * blocks the type it does not offer.
 *
 * The gate closes by itself: the first price Turki saves on a station switches
 * that station from "allow anything" to "allow only what it offers", with no
 * flag to flip and nothing to remember to remove. A station that is unpriced
 * simply produces trips with a NULL filling_cost_sar, which is the honest
 * record of "we do not know what this fill cost" rather than a fabricated 0.
 */
export function selectableWaterTypes(
  station: StationPricing | null | undefined,
): WaterType[] {
  if (!station || stationIsUnpriced(station)) return ["potable", "non_potable"];
  const out: WaterType[] = [];
  if (stationOffers(station, "potable")) out.push("potable");
  if (stationOffers(station, "non_potable")) out.push("non_potable");
  return out;
}
