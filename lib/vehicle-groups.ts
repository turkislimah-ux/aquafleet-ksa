// Splitting a mixed vehicle list into its two classes — ONE mechanism, four
// call sites (0201).
//
// `trucks` holds water trucks AND operation vehicles since 0201, so every
// surface that lists the table unfiltered now lists two different kinds of
// thing in one column. Four of them do: the Maintenance truck filter and its
// two job forms, the Consumption exit-permit destination picker, the Archive
// Truck tab, and the Daily Trips deferred-location picker. Each wants a
// heading between the classes; none of them should decide on its own what the
// order or the wording is, because a picker that says "Other" on one screen
// and "Operation Vehicles" on the next describes the same rows twice.
//
// THE ORDER IS A CONTENT DECISION, NOT A DEFAULT. Trucks lead everywhere,
// because everywhere but one the question being asked is about the water
// fleet and an operation vehicle is the unusual answer. The exception is the
// deferred-location picker in the daily-trips side-log, where the question is
// "where did this water go" and a yard machine IS the expected answer — there
// operation leads, under `other`, and that is why the order is a parameter and
// not a constant.
//
// The LABELS travel with the call site for the same reason: in a location
// picker an operation vehicle is a destination ("Other"), in a vehicle picker
// it is a vehicle ("Operation Vehicles"). Both label sets are here so the
// choice is made from a list of two rather than invented per file.
//
// Rendering lives elsewhere — components/VehicleOptGroups.tsx for the three
// `<select>`s, and the Archive tab draws its own row separator, because a
// table separator and an `<optgroup>` are not the same element and pretending
// they are would put markup decisions in a data module.

import type { VehicleClass } from "@/lib/db-types";
import type { TKey } from "@/lib/i18n";

export type VehicleClassRow = { vehicle_class: VehicleClass };

export type VehicleGroupOrder = "trucks-first" | "operation-first";

/** Which heading each class carries. Pick one of the two sets below. */
export type VehicleGroupLabels = Record<VehicleClass, TKey>;

/** Default wording: the rows are vehicles, so they are named as vehicles. */
export const VEHICLE_GROUP_LABELS: VehicleGroupLabels = {
  truck: "common.vehicleGroup.trucks",
  operation: "common.vehicleGroup.operation",
};

/**
 * The deferred-location picker's wording: there the rows are PLACES the water
 * went, and "Other" is what the side-log has always called the non-truck
 * answers. Verified in-browser under that name; renaming it would be a
 * behaviour change dressed as a refactor.
 */
export const LOCATION_GROUP_LABELS: VehicleGroupLabels = {
  truck: "common.vehicleGroup.trucks",
  operation: "common.vehicleGroup.other",
};

export type VehicleGroup<T> = {
  cls: VehicleClass;
  labelKey: TKey;
  rows: T[];
};

/**
 * Split `rows` into at most two groups, in the requested order.
 *
 * EMPTY GROUPS ARE DROPPED, and callers may also check for `length === 1` to
 * skip the heading entirely: a fleet with no operation vehicles must render
 * exactly the flat list it rendered before 0201, not a lone "Trucks" header
 * separating nothing from nothing.
 *
 * Row order WITHIN a group is the caller's — every caller feeds this an
 * already-sorted array (plate ascending, from the query) and a stable
 * partition keeps it that way.
 */
export function groupVehiclesByClass<T extends VehicleClassRow>(
  rows: readonly T[],
  order: VehicleGroupOrder = "trucks-first",
  labels: VehicleGroupLabels = VEHICLE_GROUP_LABELS,
): VehicleGroup<T>[] {
  const trucks: T[] = [];
  const operation: T[] = [];
  for (const row of rows) (row.vehicle_class === "operation" ? operation : trucks).push(row);

  const sequence: VehicleClass[] =
    order === "operation-first" ? ["operation", "truck"] : ["truck", "operation"];

  return sequence
    .map((cls) => ({
      cls,
      labelKey: labels[cls],
      rows: cls === "operation" ? operation : trucks,
    }))
    .filter((g) => g.rows.length > 0);
}
