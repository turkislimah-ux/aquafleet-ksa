"use client";

// Capacity entry — a magnitude and the unit it is stated in, read as ONE fact.
//
// WHY ONE CELL AND NOT TWO
// -----------------------------------------------------------------------------
// 0201 made capacity two columns. The obvious thing is two form fields side by
// side, and it is wrong: as peers in this grid, "Capacity" and "Unit" would
// read as two independent choices, which for a water truck is a lie — the unit
// is m³ by rule (trucks_vehicle_class_shape_check) and no operator decision
// changes it. So the control is one bordered box that reads the way the value
// is spoken, "33 m³", with the unit sitting inside it as a trailing token
// rather than beside it as a second answer.
//
// WHAT REPLACED WHAT. This field replaces a `<select>` of exactly three sizes
// (33 / 18 / 6 m³). That list described the water fleet accurately and
// described nothing else: an operation vehicle's tank is whatever it is, in m³
// or in litres. A fixed list would have had to grow an "other" option, which is
// a free-text field wearing a dropdown's clothes.
//
// PULLED VALUES, not eyeballed ones:
//   · box        preview/app.css:197  `.input` — 1px rgb(var(--border)) on
//                rgb(var(--card)), var(--r-3) radius, .875rem. Expressed here in
//                the same Tailwind translation the sibling fields already use,
//                so the box model matches them exactly and the row lines up.
//   · focus      preview/app.css:209  brand glow — `focus-within` on the SHELL,
//                not `focus` on the input, because the border being lit belongs
//                to the box and the caret is only in one half of it.
//   · unit token preview/app.css:671  `.stock-unit` — muted, medium weight, set
//                smaller than the number it annotates.
//
// TWO DELIBERATE DEVIATIONS FROM `.stock-unit`, both because the context is a
// form field and not a stock cell:
//   1. No `text-transform: uppercase`. It is right for "PCS" and "BOX"; it is
//      wrong for a unit SYMBOL, where case is meaning — uppercasing m³ gives M³.
//   2. `.65rem` becomes `text-xs`. That figure is tuned against a 1.05rem
//      `.stock-qty`; the number here is .875rem, so the pull is the RATIO and
//      the muted role, not the absolute size. At .65rem beside .875rem the
//      token stops reading as part of the value and starts reading as debris.
//
// SCOPE — BOTH CLASSES NOW, AND THE CLASS DECIDES TWO THINGS
// -----------------------------------------------------------------------------
// This file used to end "TRUCKS ONLY, ON PURPOSE … it arrives with its tab."
// The tab is here, so it has arrived. What the class decides:
//
// A TRUCK: capacity is REQUIRED, and the unit is a static m³ token. Not a
// disabled `<select>` — a control you may not use is worse than no control, and
// the unit is not a truck decision at all (trucks_vehicle_class_shape_check
// refuses anything else, and lib/capacity.ts forces m³ server-side whatever
// this form sends).
//
// AN OPERATION VEHICLE: capacity is OPTIONAL — a crane has no tank, and 0201
// lets that column be NULL for this class alone — and the unit is a real choice,
// so the token becomes a `<select>` wearing the token's own typography. It stays
// INSIDE the same bordered shell rather than moving beside it, because changing
// "33 m³" to "33 L" is a change to one fact, not the answering of a second
// question. That was this file's founding argument and it did not weaken when
// the unit became editable.
//
// The option list is CAPACITY_UNITS, never two literals: lib/capacity.ts owns
// which units exist (it mirrors trucks_capacity_unit_check), so a third unit
// reaches this control by a migration and an array entry, not by editing JSX.

import { useState } from "react";
import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";
import { CAPACITY_UNITS, DEFAULT_CAPACITY_UNIT } from "@/lib/capacity";
import type { CapacityUnit, VehicleClass } from "@/lib/db-types";

export default function CapacityField({
  vehicleClass,
  defaultValue,
  defaultUnit,
}: {
  vehicleClass: VehicleClass;
  defaultValue: number | null;
  // Absent when adding, and on every truck. Its absence is not "no unit" — the
  // column has a DEFAULT and a CHECK so a row always has one; this only means
  // the caller has no stored row to read it from.
  defaultUnit?: CapacityUnit | null;
}) {
  const { lang } = useApp();
  const isTruck = vehicleClass === "truck";
  // Controlled, so the posted value and the visible token can never disagree.
  // A truck never reads it: its unit is the literal below.
  const [unit, setUnit] = useState<CapacityUnit>(defaultUnit ?? DEFAULT_CAPACITY_UNIT);

  return (
    <label className="flex flex-col gap-1 text-sm">
      {/* The label carries the "(optional)" rather than a separate hint line —
          it is the field's own name for this class, and a hint under a
          single-row grid cell would push this box out of level with Model and
          Year beside it. */}
      <span className="muted">{t(isTruck ? "common.capacity" : "fleet.form.capacityOptional", lang)}</span>
      <div
        // `px-3 py-2` — the sibling inputs' own padding, not a new number, so
        // this box is the same height as Model and Year beside it and the grid
        // row stays level. Symmetric, so it needs no logical-property pair.
        //
        // NOTHING HERE PINS A DIRECTION, and that is what makes Arabic work.
        // A plain flex row reverses with `html[dir]`: the number takes the
        // reading edge and the unit token the trailing edge, in both languages,
        // with no `[dir="rtl"]` override and no mirrored class. Same composed
        // shape the Commissions month lens already uses
        // (app/drivers/CommissionsTab.tsx:348) — bordered shell, transparent
        // inner control, one half annotating the other.
        className="flex items-center gap-2 w-full rounded-lg border px-3 py-2 focus-within:ring-2 focus-within:ring-brand-500/30"
        style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
      >
        <input
          name="capacity_value"
          type="number"
          // Same numeric-entry convention as Year and Odometer on this very
          // form. `step="any"` rather than a whole number: the three water
          // trucks are integers, but a tank is not obliged to be.
          min="0"
          step="any"
          // REQUIRED FOR A TRUCK ONLY. Not taste — 0201's shape check makes a
          // truck's capacity mandatory and an operation vehicle's optional, and
          // lib/capacity.ts reads a blank as NULL rather than 0 for exactly the
          // vehicles allowed to leave it blank.
          required={isTruck}
          defaultValue={defaultValue ?? ""}
          // NO `dir` ATTRIBUTE, AND ITS ABSENCE IS THE POINT. An earlier draft
          // pinned this to `dir="ltr"` on the reasoning that a quantity is
          // left-to-right. In Arabic it then typed from the LEFT edge while
          // Year and Odometer — two boxes away in the same grid row — started
          // from the right, which is the one thing a number field on this form
          // must not do.
          //
          // The pull says INHERIT, in three places that agree:
          //   · Year and Odometer on this form carry no `dir` at all.
          //   · preview/app.css has no `[dir="rtl"]` rule for `.input` or
          //     `.select` — fourteen RTL overrides in that file and not one
          //     touches a text field.
          //   · app/globals.css has none either.
          // Direction comes from `html[dir]` and nothing below it argues.
          //
          // VIN and the registration fields DO pin `dir="ltr"` and are not a
          // counter-example: those are IDENTIFIERS, which lib/digits.ts rules
          // are stored and read in Latin digits only. A capacity is a quantity.
          // Different rule, different attribute.
          //
          // `text-align` is deliberately unset for the same reason — the
          // default is `start`, which already means "the reading edge" in both
          // directions. Naming `text-right` here would break English.
          //
          // SPINNERS OFF. preview/app.css:525 kills them on `.qty-input` for
          // exactly this situation — a number input that is one half of a
          // composed control. Left on, the stepper arrows land against the unit
          // token and the trailing edge grows two competing affordances. Year
          // and Odometer keep theirs: they are plain inputs with nothing beside
          // them, so there is nothing to compete with.
          className="flex-1 min-w-0 bg-transparent outline-none border-0 p-0 text-sm tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        {/* THE `dir="ltr"` ON BOTH BRANCHES STAYS, and is not the one that was
            wrong. It isolates a unit SYMBOL so "m³" cannot be re-ordered by the
            surrounding Arabic paragraph — the bidi failure lib/i18n.ts
            documents at length. It does not decide which side of the box the
            token sits on; flex does that, from `html[dir]`. Removing it by
            symmetry with the input above would be undoing a different fix. */}
        {isTruck ? (
          <span className="shrink-0 text-xs font-medium muted select-none" dir="ltr">
            {t("common.capacityUnit.m3", lang)}
          </span>
        ) : (
          <select
            // The TOKEN'S typography verbatim — `text-xs font-medium muted` —
            // so the unit still reads as an annotation of the number rather
            // than as a second field that happens to be adjacent. What it adds
            // over the span is the native disclosure arrow, which is the whole
            // signal that this one is changeable; nothing else in the box says
            // so, and inventing a caret would be inventing an affordance the
            // platform already draws.
            //
            // `ps-0 pe-1` rather than symmetric padding: the arrow needs room
            // on the trailing side and none on the leading one, and the LOGICAL
            // properties keep that true when Arabic flips the box.
            name="capacity_unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value as CapacityUnit)}
            aria-label={t("fleet.form.capacityUnitAria", lang)}
            dir="ltr"
            className="shrink-0 bg-transparent outline-none border-0 ps-0 pe-1 text-xs font-medium muted cursor-pointer focus:ring-2 focus:ring-brand-500/30 rounded"
          >
            {CAPACITY_UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`common.capacityUnit.${u}`, lang)}
              </option>
            ))}
          </select>
        )}
      </div>
      {/* A TRUCK'S UNIT IS A REAL POSTED VALUE, not an assumption the server
          makes — and it is ALSO overridden server-side (lib/capacity.ts forces
          m³ regardless of what arrives). The input states the fact, the helper
          enforces it, and neither one trusts the other.

          The operation branch does NOT render this: its `<select>` above
          already carries `name="capacity_unit"`, and a second control with the
          same name would post two values for one column. */}
      {isTruck && <input type="hidden" name="capacity_unit" value="m3" />}
    </label>
  );
}
