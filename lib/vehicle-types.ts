// `vehicle_types` — the pure read side. No Supabase, no React.
//
// Three surfaces resolve a vehicle's type name: the picker inside the vehicle
// form (components/VehicleTypeField.tsx), the Operation Vehicles table, and the
// vehicle detail page. One function so they cannot answer differently — the
// same arrangement `violationTypeLabel` has in lib/violations.ts for the same
// reason.
//
// `vehicleLabel` below is the SECOND such function, for every surface OUTSIDE
// the Fleet page: off that page a bare plate does not say what the vehicle is,
// because the page around it is about work orders or permits, not about the
// fleet's shape.
//
// THE NAMES ARE NOT IN lib/i18n.ts AND MUST NOT BE. Both languages live on the
// row; scripts/i18n-lookup-single-source-check.mjs fails the test gate if a
// lookup label is copied into the dictionary. The write side is
// lib/actions/vehicle-types.ts.

import { arText, type Lang } from "@/lib/i18n";
import type { VehicleClass, VehicleType } from "@/lib/db-types";

/**
 * The type's name in the current language, or an em dash when there is no type.
 *
 * NO TYPE IS A REAL STATE, not a missing row: every water truck carries a NULL
 * `vehicle_type_id` by constraint (trucks_vehicle_class_shape_check), so a
 * caller that renders a truck through here gets the dash rather than a blank.
 *
 * `label_ar` is NOT NULL on every row — 0201's CHECK refuses a blank one and the
 * add form demands both — so arText's fallback is here for the empty-string case
 * a future writer could still produce, not for missing data.
 */
export function vehicleTypeLabel(vt: VehicleType | undefined | null, lang: Lang): string {
  if (!vt) return "—";
  return arText(vt.label, vt.label_ar, lang);
}

/**
 * How a vehicle is NAMED away from the Fleet page: the plate, plus the type for
 * an operation vehicle.
 *
 * On the Fleet page a plate is enough — the tab it sits under already said
 * which class it is, and the Operation Vehicles table carries a Type column of
 * its own. Everywhere else (the Maintenance pickers and job tables, the
 * Consumption exit-permit destination, the Archive Truck tab, the daily-trips
 * side-log) the two classes share one list and a bare `4312 ABC` leaves the
 * reader to remember which of the forty vehicles is the crane.
 *
 * A TRUCK IS RETURNED UNCHANGED, deliberately: a truck's type is always NULL by
 * `trucks_vehicle_class_shape_check`, and appending the em dash
 * `vehicleTypeLabel` returns for a missing type would put `4312 ABC · —` on
 * every water truck in the app. Callers pass mixed lists through here without
 * branching, and that only works because the truck path is the identity.
 *
 * An operation vehicle whose type cannot be resolved — a row whose
 * `vehicle_type_id` is not in `types`, which happens when a caller fetched the
 * active types only — also falls back to the bare plate rather than to a dash.
 * The plate is never wrong; a dash claims the vehicle has no type, which the
 * constraint says it cannot be.
 */
export function vehicleLabel(
  vehicle: VehicleNameRow,
  typeById: ReadonlyMap<string, VehicleType>,
  lang: Lang,
): string {
  const type = operationTypeName(vehicle, typeById, lang);
  return type ? `${vehicle.plate} · ${type}` : vehicle.plate;
}

export type VehicleNameRow = {
  plate: string;
  vehicle_class: VehicleClass;
  vehicle_type_id: string | null;
};

/**
 * The same answer as `vehicleLabel`, minus the plate — for the surfaces that
 * render the two as separate elements rather than as one string.
 *
 * A table cell does: the plate is a mono, `dir="ltr"` identifier and the type
 * is prose that follows the language, so joining them into one span would put
 * «ونش» inside an LTR mono run. An `<option>`, which can hold no markup, takes
 * the joined string instead. Both read this, so the two cannot disagree about
 * which vehicles get a type shown.
 *
 * NULL means "nothing to add" — a water truck, or an operation vehicle whose
 * type row was not in `typeById`.
 */
export function operationTypeName(
  vehicle: VehicleNameRow,
  typeById: ReadonlyMap<string, VehicleType>,
  lang: Lang,
): string | null {
  if (vehicle.vehicle_class !== "operation") return null;
  const vt = vehicle.vehicle_type_id ? typeById.get(vehicle.vehicle_type_id) : null;
  return vt ? vehicleTypeLabel(vt, lang) : null;
}

/**
 * The options a picker offers, in the order it offers them.
 *
 * ACTIVE ROWS, PLUS whichever one is already selected even if it has since been
 * retired. That second clause is not politeness. Without it, editing a vehicle
 * whose type was retired renders a `<select>` with no matching option, the
 * browser silently displays the first one, and pressing Save re-files the
 * vehicle as a type nobody chose. Retired-but-selected is shown so it can be
 * kept; it just cannot be picked fresh.
 *
 * Ordered by `sort_order` then label, which is what the add action's max+1
 * assumes — a tie between two rows added at the same moment falls back to the
 * name rather than to insertion luck.
 */
export function vehicleTypeOptions(
  types: VehicleType[],
  selectedId: string | null,
  lang: Lang,
): VehicleType[] {
  return types
    .filter((vt) => vt.active || (selectedId != null && vt.id === selectedId))
    .sort((a, b) =>
      a.sort_order === b.sort_order
        ? vehicleTypeLabel(a, lang).localeCompare(vehicleTypeLabel(b, lang))
        : a.sort_order - b.sort_order,
    );
}
