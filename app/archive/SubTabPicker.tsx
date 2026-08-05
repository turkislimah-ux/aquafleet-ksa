"use client";

// The Archive's SECONDARY navigation — the sub-tab picker inside Staff, Truck
// and Customer.
//
// ===========================================================================
// WHY THIS IS NOT MORE TABS
// ===========================================================================
// The page already has primary tabs (Company / Staff / Truck / Customer) in
// this app's underline style. The sub-tabs used to be a row of bordered
// pills, which put two tab-shaped controls of near-equal weight directly
// above each other: nothing in the visual language said which one was the
// parent, so the eye had to read the labels to work out the hierarchy.
//
// This is a SEGMENTED CONTROL instead — a single inset track with one raised
// active segment. That is a deliberately different shape from an underline
// tab, so the two levels never compete: underline = "which section", segment
// = "which view of this section". The hierarchy is carried by the form, not
// by size or colour alone.
//
// Details that are doing real work:
//  - The track is inset (a recessed well) and the ACTIVE segment is a raised
//    card surface with a shadow. Depth, not just colour, marks the selection,
//    so it survives greyscale and reads at a glance in both themes.
//  - Segments carry NO border of their own. A border that appears only when
//    active would shift every neighbour by a pixel on each click; the raised
//    surface changes nothing about the box model.
//  - Optional counts sit in the segment as a subdued badge, so "Soft-deleted
//    3" is legible without a second row of chips.
//  - Real <button>s with aria-pressed, wrapped in a group role. Arrow-key
//    roving focus is deliberately NOT added: these are buttons in a toolbar,
//    not a WAI-ARIA tablist (the panels are not linked by aria-controls), and
//    a half-implemented tablist is worse for a screen reader than an honest
//    group of buttons.

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SubTabItem<K extends string> = {
  key: K;
  label: string;
  icon?: LucideIcon;
  // Rendered as a subdued badge. Omit (or 0) to show nothing — a "0" badge
  // is noise, not information.
  count?: number;
};

export default function SubTabPicker<K extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: SubTabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 p-1 rounded-xl border bg-black/[0.035] dark:bg-white/[0.05] max-w-full overflow-x-auto scrollbar-thin"
      style={{ borderColor: "rgb(var(--border))" }}
    >
      {items.map((t) => {
        const active = t.key === value;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
              active
                ? "bg-[rgb(var(--card))] shadow-sm font-semibold text-[rgb(var(--fg))]"
                : "muted hover:text-[rgb(var(--fg))]",
            )}
          >
            {Icon && <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "" : "opacity-70")} />}
            {t.label}
            {t.count ? (
              <span
                className={cn(
                  "ms-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                  active
                    ? "bg-brand-500/15 text-brand-700 dark:text-brand-300"
                    : "bg-black/[0.06] dark:bg-white/[0.08]",
                )}
              >
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
