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
// SCOPE — TRUCKS ONLY, ON PURPOSE. This renders the unit LOCKED. Operation
// vehicles may be stated in either unit, and the switch that lets them is not
// here yet because there is no screen to verify it on until the Operation
// Vehicles tab exists. A branch nobody can open in a browser is not a feature,
// it is unreviewed code. It arrives with its tab.

import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";

export default function CapacityField({ defaultValue }: { defaultValue: number | null }) {
  const { lang } = useApp();

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="muted">{t("common.capacity", lang)}</span>
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
          required
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
        {/* THIS `dir="ltr"` STAYS, and is not the one that was wrong. It
            isolates a two-character unit SYMBOL so "m³" cannot be re-ordered by
            the surrounding Arabic paragraph — the bidi failure lib/i18n.ts
            documents at length. It does not decide which side of the box the
            token sits on; flex does that, from `html[dir]`. Removing it by
            symmetry with the input above would be undoing a different fix. */}
        <span className="shrink-0 text-xs font-medium muted select-none" dir="ltr">
          {t("common.capacityUnit.m3", lang)}
        </span>
      </div>
      {/* The unit is a real posted value, not an assumption the server makes.
          It is ALSO overridden server-side for a truck (lib/capacity.ts forces
          m³ regardless of what arrives) — the input states the fact, the helper
          enforces it, and neither one trusts the other. */}
      <input type="hidden" name="capacity_unit" value="m3" />
    </label>
  );
}
