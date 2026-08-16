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
 * THE ARRAY THAT FLOWS TO EVERY PICKER — an option plus the default flag.
 *
 * `app/trips/page.tsx` reads active stations as
 * `key, name, is_default, fill_cost_potable_sar, fill_cost_non_potable_sar` and
 * hands that ONE array to New Project, Add Trip, the phase picker, the loading
 * chip and the project edit form. This is that shape, named once.
 *
 * It was hand-declared four times: an inline cast in page.tsx, `StationOption &
 * { is_default?: boolean }` in CustomersTab, and — the part that mattered — a
 * bare `{ key, name, is_default? }` in NewProjectModal and ProjectModal, which
 * **dropped the price columns entirely**. Those two were the pre-0110 shape this
 * module's header calls out: "a picker that cannot see them cannot block an
 * unoffered type". The prices were there at runtime and invisible to the type,
 * so nothing would have stopped either form from growing a station rule it had
 * no data to enforce.
 *
 * `is_default` is OPTIONAL on purpose. The sub-pickers inside ProjectsBoard take
 * `StationOption[]` — they genuinely need only name + prices — and an optional
 * flag keeps those arrays assignable here without widening every prop in the
 * chain to carry a field most of them ignore.
 */
export type SelectableStation = StationOption & {
  is_default?: boolean;
};

/**
 * A FULL water_stations row — an option plus the administrative fields, and the
 * exact column list the "every station" select reads:
 *
 *   id, key, name, city, latitude, longitude,
 *   fill_cost_potable_sar, fill_cost_non_potable_sar, is_default, active
 *
 * ONE DEFINITION, THREE READERS. This shape was hand-declared byte-identically
 * in app/trips/page.tsx (function-locally), app/trips/ProjectsBoard.tsx and
 * app/trips/WaterStationsModal.tsx — the last two even agreeing on the field
 * ORDER. Three copies of a row shape that includes two PRICE columns is how a
 * "just add `?? 0`" fix lands in one of them and not the others, which is the
 * precise failure the NULL-is-not-zero note above exists to prevent.
 *
 * Expressed as `StationOption & {...}` rather than a flat list on purpose: it
 * says a full row IS a pickable option plus admin fields, so anything that
 * takes a StationOption accepts a row without a cast.
 *
 * NOT the write shape. `WaterStationInput` (app/trips/actions.ts) is separate
 * and must stay separate: it deliberately carries NO `key` — that column is the
 * immutable FK target for trips.water_station, generated once on create and
 * never present in an update payload — and no `id`/`active`. Folding the two
 * together would put `key` in reach of an edit.
 */
export type WaterStationRow = StationOption & {
  id: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
  active: boolean;
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

/**
 * Does this station offer that type at all?
 *
 * MODULE-PRIVATE. It was exported through the 0110 capture phase and no file
 * outside this one ever imported it — the callers that needed the rule all
 * ended up wanting the two composed predicates below instead
 * (`stationBlockedForType`, `selectableWaterTypes`), which is the better shape:
 * a caller asking "does this station offer X" is one `!` away from
 * reimplementing the legacy-unpriced allowance and getting it wrong.
 */
function stationOffers(
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
 *
 * MODULE-PRIVATE, same reason as stationOffers above: exported through the
 * capture phase, never imported anywhere. The legacy allowance it encodes is
 * only ever correct as part of one of the two composed predicates below; a
 * caller checking it on its own would be rebuilding the gate by hand.
 */
function stationIsUnpriced(station: StationPricing | null | undefined): boolean {
  return !stationOffers(station, "potable") && !stationOffers(station, "non_potable");
}

/**
 * THE SAME GATE, READ FROM THE OTHER DIRECTION — may a trip of this water type
 * MOVE to this station?
 *
 * `selectableWaterTypes` narrows the TYPE for a fixed station (trip creation,
 * where the station is picked first). This narrows the STATION for a fixed type
 * (changing an existing trip's fill station, where the water type is already set
 * and is not what is being edited). Both are the one rule — a station may only
 * take a trip whose water type it actually fills — so both live here rather than
 * being spelled out separately in a form and in a server action, which is how
 * the two surfaces came to disagree in the first place: trip-add blocked, the
 * station change did not, and KI-026-0062 ended up potable at a non-potable
 * station.
 *
 * An unpriced (pre-0110) station blocks nothing, matching
 * `selectableWaterTypes`'s own legacy allowance exactly.
 */
export function stationBlockedForType(
  station: StationPricing | null | undefined,
  waterType: WaterType | null | undefined,
): boolean {
  if (!station || !waterType) return false;
  if (stationIsUnpriced(station)) return false;
  return !stationOffers(station, waterType);
}

/**
 * THE WHOLE STATION-CHANGE RULE, as one pure decision.
 *
 * Both halves of it live here — may the trip move at all, and what happens to
 * its frozen cost if it does — because they are one rule and splitting them
 * across a server action and a form is how they came apart last time.
 *
 * `costPatch: null` means DO NOT TOUCH the cost, which is not the same as
 * setting it to null. A CLOSED trip's fill already happened and its cost has
 * been reported, so re-taking it would silently restate a period.
 * `{ filling_cost_sar: null }` is the opposite claim — the trip DID move and
 * the new station does not price this type, so the honest record is "not
 * costed" rather than a stale carry-over from a station it never visited.
 *
 * `closedHistory` IS NOT "IS DELIVERED", and the difference cost a real figure.
 * The caller must pass delivered-at-BOTH-ENDS of the write. A trip BECOMING
 * delivered is still live — the fill has just been asserted to have happened at
 * a different station — and reading that as closed wrote the new station while
 * keeping the old station's price. See stationChangePatch in
 * app/trips/actions.ts for the table of cases.
 *
 * Pure and IO-free on purpose: the caller does the two reads, this makes the
 * call, and the rule stays testable without a session (the harness has none).
 */
export type StationChangeDecision =
  | { blocked: true; costPatch?: undefined }
  | { blocked: false; costPatch: { filling_cost_sar: number | null } | null };

export function decideStationChange(
  station: StationPricing | null | undefined,
  waterType: WaterType | null | undefined,
  closedHistory: boolean,
): StationChangeDecision {
  if (stationBlockedForType(station, waterType)) return { blocked: true };
  if (closedHistory) return { blocked: false, costPatch: null };
  // A trip with no readable water type cannot be repriced against a per-type
  // price list — leave the frozen figure alone rather than guessing at one.
  if (!waterType) return { blocked: false, costPatch: null };
  return { blocked: false, costPatch: { filling_cost_sar: stationPriceFor(station, waterType) } };
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
