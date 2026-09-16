// Capacity that carries its own unit — and THE ONE WRITER of trucks.capacity_m3.
//
// WHY THIS FILE EXISTS
// -----------------------------------------------------------------------------
// Migration 0201 split a capacity that hid its unit inside a column NAME
// (`capacity_m3`) into a value and a unit (`capacity_value` + `capacity_unit`).
// The old column did not go away: ten live read sites — Dashboard, Trips,
// Archive, Fleet list, Fleet detail, the maintenance pickers and the
// utilization views — still read it, and rewriting all of them in the same
// batch as the write path was the change most likely to move money. So the
// column STAYS, and the database ties it to the new pair with a CHECK:
//
//   capacity_m3 is not distinct from
//     (case when capacity_unit = 'm3' then capacity_value end)
//
// `is not distinct from`, not `=`. A CHECK constraint PASSES on NULL, so `=`
// would happily let a litre-rated vehicle keep whatever stale m³ figure it was
// carrying — the exact drift the constraint is there to prevent.
//
// The consequence for application code is absolute: any write that sets one
// side of that pair without the other is refused by Postgres with 23514. That
// is what this file makes impossible — every write builds ALL THREE columns
// together, here, in one object, from one input.
//
// GUARDED, NOT MERELY DOCUMENTED. `scripts/capacity-single-writer-check.mjs`
// walks app/ and lib/ through the TypeScript AST and fails `npm test` if
// `capacity_m3` appears as an object key anywhere but this file. A convention
// that is only written down gets a second writer added by habit; a convention
// with a guard in the test gate does not. The guard has a negative-control mode
// — see its header — because an absence check that cannot be made to fail is
// not a check.
//
// AND NOW ALSO THE ONE FORMATTER — added deliberately, against this file's
// earlier rule
// -----------------------------------------------------------------------------
// This header used to end "reading does not belong here", on the reasoning that
// every m³ reader stayed on `capacity_m3` untouched. That reasoning held only
// while EVERY vehicle was a water truck and therefore m³. Operation vehicles
// may be stated in litres, and a litre figure rendered by the old
// `` `${capacity_m3} m³` `` literal is wrong by a factor of a thousand while
// looking entirely plausible.
//
// So the unit now has to travel with the number to every screen, and the
// question is only WHERE that join is expressed. Four render sites spelling it
// out themselves is four chances to drop the unit. It lives here, next to the
// write, because the writer and the reader are then obliged to agree about what
// the pair MEANS: `capacity_unit` is never null (0201 gives it a default and a
// CHECK), and `capacity_value` null means "not stated" — the same two facts
// capacityColumns() below produces.
//
// Still not here: `capacity_m3`. Nothing reads it through this file. The ten
// existing m³ readers are untouched, and they stay correct because a litre-rated
// vehicle carries NULL there by construction.

import type { CapacityUnit, VehicleClass } from "@/lib/db-types";
import { t, type Lang } from "@/lib/i18n";

/**
 * The three columns that must always move together. Any Supabase insert/update
 * touching capacity spreads this object — never a hand-built subset.
 */
export type CapacityColumns = {
  capacity_value: number | null;
  capacity_unit: CapacityUnit;
  capacity_m3: number | null;
};

/**
 * The units a vehicle's capacity may be stated in, in the order they are
 * offered. Mirrors `trucks_capacity_unit_check` in 0201 — adding a third unit
 * means a migration first, this array second.
 */
export const CAPACITY_UNITS = ["m3", "l"] as const;

/** What an unstated unit means. Matches the column DEFAULT in 0201. */
export const DEFAULT_CAPACITY_UNIT: CapacityUnit = "m3";

export function isCapacityUnit(value: unknown): value is CapacityUnit {
  return typeof value === "string" && (CAPACITY_UNITS as readonly string[]).includes(value);
}

/**
 * Parse a posted capacity magnitude. Blank and unparseable both mean "not
 * stated" — NULL — rather than 0, because a tank of zero cubic metres is not a
 * thing anyone means to record, and 0 would satisfy the `capacity_value is not
 * null` half of `trucks_vehicle_class_shape_check` while being nonsense.
 *
 * Negative is refused for the same reason.
 */
function parseCapacityValue(raw: unknown): number | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Build the capacity triple for a write.
 *
 * THE UNIT IS NOT TAKEN ON TRUST FOR A TRUCK. A water truck is m³ by rule —
 * `trucks_vehicle_class_shape_check` refuses anything else — so the posted unit
 * is IGNORED for `vehicleClass === "truck"` rather than validated. The form
 * renders that unit locked, but a form is a courtesy and this is the boundary;
 * same reasoning, and the same shape, as `idText` in app/fleet/actions.ts.
 *
 * An operation vehicle may be stated in either unit, and defaults to m³.
 *
 * `capacity_m3` is derived, never accepted: it is the value when the unit is m³
 * and NULL otherwise. A litre-rated vehicle therefore carries no m³ figure at
 * all, which is what keeps it out of every existing m³ reader — including the
 * Dashboard's capacity-dispatched proxy, where a litre figure read as cubic
 * metres would be wrong by a factor of a thousand and look plausible.
 */
export function capacityColumns(input: {
  vehicleClass: VehicleClass;
  rawValue: unknown;
  rawUnit: unknown;
}): CapacityColumns {
  const unit: CapacityUnit =
    input.vehicleClass === "truck"
      ? "m3"
      : isCapacityUnit(input.rawUnit)
        ? input.rawUnit
        : DEFAULT_CAPACITY_UNIT;

  const value = parseCapacityValue(input.rawValue);

  return {
    capacity_value: value,
    capacity_unit: unit,
    capacity_m3: unit === "m3" ? value : null,
  };
}

/**
 * A capacity as it is spoken: the magnitude and the unit it was stated in.
 *
 * RETURNS NULL, NOT "—", when the capacity is unstated. The four render sites
 * disagree about what an absent capacity should look like — the Fleet detail
 * subtitle drops the segment entirely (it joins the non-empty parts), the stat,
 * the info field and the list cell each print an em dash. A helper that decided
 * for them would force the subtitle to filter the dash back out, which is how a
 * literal "—" ends up inside a comma-joined sentence. Callers append `?? "—"`
 * where a dash is what they want.
 *
 * THE UNIT SYMBOL COMES FROM THE DICTIONARY, not from a literal here. It is
 * Latin in both languages (see the note on `common.capacityUnit` in
 * lib/i18n.ts), so today `lang` changes nothing — but that ruling is written
 * down in ONE place, and this reads it rather than re-deciding it.
 *
 * The number is NOT digit-folded. Every existing capacity render site prints
 * Latin digits in Arabic, and so does every other quantity on these screens.
 */
export function formatCapacity(
  row: { capacity_value: number | null; capacity_unit: CapacityUnit },
  lang: Lang,
): string | null {
  if (row.capacity_value == null) return null;
  return `${row.capacity_value} ${t(`common.capacityUnit.${row.capacity_unit}`, lang)}`;
}
