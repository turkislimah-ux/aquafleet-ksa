"use client";

// The `<option>` list for any `<select>` that offers BOTH vehicle classes.
//
// Three selects do — the Maintenance truck filter and its two job forms' truck
// pickers, the Consumption exit-permit destination, and the daily-trips
// deferred-location picker. Before 0201 each of them was one flat
// `trucks.map(...)`; after it, each would have needed the same partition, the
// same two headings and the same "name the operation vehicle's type" rule
// written out again. This is that, once. The partition itself is
// lib/vehicle-groups.ts, which the Archive tab also uses to draw a separator
// that is not an `<optgroup>`.
//
// WHY `<optgroup>` AND NOT A DISABLED "─── Other ───" ROW: the browser renders
// the label as a heading rather than as a choice, a screen reader announces the
// group name with each option inside it, and it cannot be selected by accident.
// A disabled divider option is a lookalike that fails all three.

import { t, type Lang } from "@/lib/i18n";
import type { VehicleClass, VehicleType } from "@/lib/db-types";
import {
  groupVehiclesByClass,
  VEHICLE_GROUP_LABELS,
  type VehicleGroupLabels,
  type VehicleGroupOrder,
} from "@/lib/vehicle-groups";
import { vehicleLabel } from "@/lib/vehicle-types";

export type VehicleOption = {
  id: string;
  plate: string;
  vehicle_class: VehicleClass;
  vehicle_type_id: string | null;
};

type Props<T extends VehicleOption> = {
  rows: readonly T[];
  /** All types, active and retired — a vehicle filed under a retired type still needs its name. */
  typeById: ReadonlyMap<string, VehicleType>;
  lang: Lang;
  order?: VehicleGroupOrder;
  labels?: VehicleGroupLabels;
  /**
   * Extra text after the vehicle's own name, e.g. the model on the Maintenance
   * job forms. Returns null to append nothing — a truck with no model must not
   * render a trailing separator.
   */
  suffix?: (row: T) => string | null;
};

export default function VehicleOptGroups<T extends VehicleOption>({
  rows,
  typeById,
  lang,
  order = "trucks-first",
  labels = VEHICLE_GROUP_LABELS,
  suffix,
}: Props<T>) {
  const groups = groupVehiclesByClass(rows, order, labels);

  const option = (row: T) => {
    const extra = suffix?.(row);
    return (
      <option key={row.id} value={row.id}>
        {vehicleLabel(row, typeById, lang)}
        {extra ? ` · ${extra}` : ""}
      </option>
    );
  };

  // ONE CLASS PRESENT — NO HEADINGS. A heading separates two things; with a
  // single group it labels the whole list, which is what the field's own label
  // already does. A fleet with no operation vehicles therefore sees exactly the
  // flat list it saw before 0201.
  if (groups.length < 2) return <>{rows.map(option)}</>;

  return (
    <>
      {groups.map((g) => (
        <optgroup key={g.cls} label={t(g.labelKey, lang)}>
          {g.rows.map(option)}
        </optgroup>
      ))}
    </>
  );
}
