"use client";

// Polish item 3 — mechanic on-leave in maintenance (UI + read only, NO DB
// change). A mechanic (staff row, role='mechanic') is "on leave today" iff
// a leave_periods row for them spans today (lib/leave.ts's canonical
// onLeaveTodaySet — same read used across Fleet/Dashboard for drivers,
// same table the Staff tab's "Leave & Absence" writes to). This file is
// display + a UI-level picker guard ONLY — create_work_order/
// edit_work_order/edit_outsourced_job are never touched; an on-leave
// mechanic already assigned to an existing job is left exactly as-is.
//
// MechanicPicker replaces the plain <select> mechanic dropdowns in
// NewWorkOrderModal/NewOutsourcedJobModal — same "native <option> can't
// carry a colored pill" reasoning Inventory's own PartPicker documents
// (app/inventory/SharedCreateModals.tsx), same button+popover-listbox
// shape. On-leave mechanics render grayed with an "On Leave" pill and are
// not clickable — can't be newly selected/assigned — but the currently
// selected value (e.g. editing a job whose assigned mechanic went on
// leave afterward) still displays normally in the closed button, pill
// included, purely informational.
//
// A leaf module, no imports back into either modal — imported one-way by
// both, same pattern as Inventory's SharedCreateModals.tsx.

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { t, arText, type Lang } from "@/lib/i18n";
import type { Staff } from "@/lib/db-types";
import MtStatusPill from "./MtStatusPill";

export function MechanicPicker({
  value,
  onChange,
  mechanics,
  onLeaveMechanicIds,
  lang,
  disabled,
  inputClassName,
  inputStyle,
}: {
  value: string;
  onChange: (v: string) => void;
  mechanics: Staff[];
  onLeaveMechanicIds: Set<string>;
  lang: Lang;
  disabled?: boolean;
  inputClassName: string;
  inputStyle: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selected = mechanics.find((m) => m.id === value) ?? null;
  const selectedOnLeave = selected ? onLeaveMechanicIds.has(selected.id) : false;

  function mechName(m: Staff) {
    return arText(m.name, m.name_ar, lang);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(inputClassName, "flex items-center justify-between gap-2 text-start disabled:opacity-50 disabled:pointer-events-none")}
        style={inputStyle}
      >
        <span className={cn("truncate flex items-center gap-1.5", !selected && "muted")}>
          {selected ? mechName(selected) : t("mt.selectMechanic", lang)}
          {selectedOnLeave && <MtStatusPill kind="on_leave" label={t("status.leave", lang)} />}
        </span>
        <ChevronDown className="h-4 w-4 muted shrink-0" />
      </button>
      {open && (
        <div
          className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border shadow-lg scrollbar-thin"
          style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
        >
          {mechanics.length === 0 ? (
            <div className="px-3 py-2 text-sm muted">{t("mt.noMechanics", lang)}</div>
          ) : (
            mechanics.map((m) => {
              const onLeave = onLeaveMechanicIds.has(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={onLeave}
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full text-start px-3 py-2.5 text-sm flex items-center justify-between gap-3",
                    onLeave ? "muted opacity-60 cursor-not-allowed" : "hover:bg-black/5 dark:hover:bg-white/5",
                  )}
                >
                  <span className="truncate">{mechName(m)}</span>
                  {onLeave && <MtStatusPill kind="on_leave" label={t("status.leave", lang)} />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
