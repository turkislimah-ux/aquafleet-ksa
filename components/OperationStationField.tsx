"use client";

// Reusable operation-station picker — rendered as its own labeled SECTION (icon
// + title + hint + select + manage action), not a cramped select+icon row. Used
// inside three separate forms in two route dirs (DriversClient's driver form,
// StaffTab's staff form, TruckFormModal's truck form) — built once here instead
// of copied three times.
//
// IMPORTANT — place this as a DIRECT grid child of the enclosing
// `grid grid-cols-1 sm:grid-cols-2` form (do NOT wrap it in <Field>/<label>):
// its own root carries `sm:col-span-2` so the section spans the full form width;
// that class only takes effect on an immediate grid child.
//
// `stations` must be ALL rows (active + inactive): the select's options are
// every ACTIVE station, PLUS the current value's own station if it has since
// been deactivated (shown distinctly, "(deactivated)" + a badge in the header)
// — so a driver/truck/staff member already based at a deactivated station never
// renders blank. Emits "" (not selected) when cleared; the surrounding action's
// generic nullable() FormData parser already turns that into a real NULL FK
// write.
//
// The management modal (OperationStationsModal) portals to document.body — see
// that file's comment for why: this field sits inside the entity's own <form>,
// and the modal's own inner <form> (StationForm) must never be a DOM descendant
// of it (nested <form> elements silently broke saving — diagnosed via zero
// insert requests ever reaching Supabase for this table).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Settings } from "lucide-react";
import { Btn } from "@/components/ui";
import type { OperationStation } from "@/lib/db-types";
import OperationStationsModal from "./OperationStationsModal";
import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export default function OperationStationField({
  name,
  stations,
  defaultValue,
  label,
  hint,
}: {
  name: string;
  stations: OperationStation[]; // ALL rows (active + inactive)
  defaultValue: string | null;
  // The defaults for these two MOVED OUT of the destructuring pattern and into
  // the body below (`label ?? t(...)`). A parameter default is evaluated before
  // the component body runs, so it cannot call a hook — and the fallback text
  // has to come from the dictionary now.
  //
  // A caller that passes its own still wins, unchanged: those overrides live in
  // ROUTE files (StaffTab, DriversClient, TruckFormModal) and stay English
  // until each route's own batch.
  label?: string; // e.g. "Station" (driver/truck) vs "Branch of operation" (staff)
  hint?: string;
}) {
  const router = useRouter();
  const { lang } = useApp();
  const [value, setValue] = useState(defaultValue ?? "");
  const [managing, setManaging] = useState(false);

  // Active stations, plus the current value's station if it's inactive (so an
  // already-assigned-but-deactivated station shows up instead of going blank).
  const options = useMemo(() => {
    const active = stations.filter((s) => s.active);
    if (!value || active.some((s) => s.id === value)) return active;
    const current = stations.find((s) => s.id === value);
    return current ? [...active, current] : active;
  }, [stations, value]);

  const selected = value ? stations.find((s) => s.id === value) ?? null : null;

  return (
    <div
      className="sm:col-span-2 rounded-xl border p-3.5 flex flex-col gap-2.5"
      style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--bg))" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="h-7 w-7 shrink-0 grid place-items-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300"
          >
            <MapPin className="h-3.5 w-3.5" />
          </span>
          <span className="text-sm font-medium">{label ?? t("shared.stations.fieldLabel", lang)}</span>
          {selected && !selected.active && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
              {t("shared.stations.deactivated", lang)}
            </span>
          )}
        </div>
        <Btn variant="ghost" onClick={() => setManaging(true)} className="h-7 px-2 text-xs shrink-0">
          {/* The space before the label is on THIS line, so JSX keeps it —
              a newline here would have collapsed it away. */}
          <Settings className="h-3.5 w-3.5" /> {t("shared.stations.manage", lang)}
        </Btn>
      </div>

      <p className="text-xs muted">{hint ?? t("shared.stations.fieldHint", lang)}</p>

      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={INPUT}
        style={INPUT_STYLE}
      >
        <option value="">—</option>
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}{!s.active ? ` ${t("shared.stations.deactivatedParen", lang)}` : ""}
          </option>
        ))}
      </select>
      <input type="hidden" name={name} value={value} />

      {managing && (
        <OperationStationsModal
          open
          stations={stations}
          onClose={() => setManaging(false)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}
