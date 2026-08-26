// Truck utilization — presentation rules for the 0130 views.
//
// LEAF MODULE. Imports nothing from app/ or components/, so the Fleet list, the
// Dashboard and the truck detail page can all read it one-way (the Phase-4
// import-cycle lesson in CLAUDE.md §7).
//
// ===========================================================================
// NOTHING HERE COMPUTES A UTILIZATION FIGURE
// ===========================================================================
// Every percentage comes from a view (0098): v_truck_utilization_monthly,
// v_fleet_utilization_monthly, v_truck_utilization_rolling30. This file decides
// only how a number that already exists is WORN — its band, its label, its
// colour, and how the absence of one is written.
//
// In particular the fleet-wide figure is READ, never assembled: 0130 ships
// v_fleet_utilization_monthly precisely so a page cannot average per-truck
// percentages, which weights a truck available 2 days the same as one available
// 31. Live August: 45.86% blended against 38.40% averaged. If you ever find
// yourself averaging `utilization_pct` across trucks here, the view you want
// already exists.
//
// ===========================================================================
// NULL IS "N/A", AND IT IS NOT 0%
// ===========================================================================
// A truck with zero available days has NO utilization — the denominator is
// zero, so the question has no answer. That is a different claim from 0%, which
// says the truck could have worked and did not. Live right now: 1112 BBB and
// 1113 BBB are out of service all month (0 available, 17 out-of-service) and
// return NULL, while seven trucks genuinely read 0.00% having been available
// and idle. Rendering the first group as 0% would put two trucks into the
// under-used alarm that no one can act on, and would hide the seven that
// someone can.
//
// This is the same rule the Dashboard's compliance pills follow — `not_recorded`
// never collapses into `ok`, grey never becomes green.

// lib/i18n.ts imports NOTHING, so depending on it cannot create a cycle however
// this module is reached. `TKey` buys the compile-time check on
// UTILIZATION_NA_KEY at the bottom; `t` is what lets formatUtilization stay the
// SINGLE writer of the N/A token now that the token has two languages.
import { t, type Lang, type TKey } from "./i18n";

/** One row of v_truck_utilization_monthly. */
export type TruckUtilizationRow = {
  truck_id: string;
  plate: string;
  month: string;
  worked_days: number;
  available_days: number;
  maintenance_days: number;
  out_of_service_days: number;
  /** NULL when available_days = 0 — no denominator, no answer. Never 0. */
  utilization_pct: number | null;
};

/** One row of v_fleet_utilization_monthly — pre-blended, never averaged here. */
export type FleetUtilizationRow = {
  month: string;
  trucks_with_availability: number;
  worked_days: number;
  available_days: number;
  maintenance_days: number;
  utilization_pct: number | null;
};

/** One row of v_truck_utilization_rolling30. */
export type TruckUtilizationRolling30Row = {
  truck_id: string;
  plate: string;
  from_day: string;
  to_day: string;
  worked_days: number;
  available_days: number;
  maintenance_days: number;
  utilization_pct: number | null;
};

export type UtilizationBand = "na" | "under" | "below" | "optimal" | "above";

/**
 * THE BAND RULE, written once.
 *
 * ~60-80% is the optimal window: below it the fleet is carrying trucks it is
 * not using, above it there is no slack for a breakdown or a surge. Both ends
 * are worth seeing, so both are coloured — but only the low end is coloured
 * like a problem, because a busy truck is not a fault.
 *
 * The thresholds are inclusive at both ends of optimal (60 and 80 both count as
 * optimal) so a figure never falls between two bands.
 */
export function utilizationBand(pct: number | null | undefined): UtilizationBand {
  if (pct == null) return "na";
  if (pct > 80) return "above";
  if (pct >= 60) return "optimal";
  if (pct >= 40) return "below";
  return "under";
}

export const UTILIZATION_BAND: Record<
  UtilizationBand,
  { en: string; ar: string; dot: string; text: string; bar: string; pill: string }
> = {
  // Slate, never green and never red: a figure we do not have earns no verdict.
  na: {
    en: "Not applicable", ar: "لا ينطبق",
    dot: "bg-slate-400",
    text: "muted",
    bar: "bg-slate-300 dark:bg-slate-600",
    pill: "bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300",
  },
  under: {
    en: "Under-used", ar: "استخدام منخفض",
    dot: "bg-rose-500",
    text: "text-rose-700 dark:text-rose-300",
    bar: "bg-rose-500",
    pill: "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300",
  },
  below: {
    en: "Below optimal", ar: "دون الأمثل",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-300",
    bar: "bg-amber-500",
    pill: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300",
  },
  optimal: {
    en: "Optimal", ar: "الأمثل",
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
    bar: "bg-emerald-500",
    pill: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
  },
  // Brand blue, deliberately NOT amber or red. Above 80% is a fleet with no
  // slack, which is worth knowing, but a truck working hard is not a fault and
  // must not read as one.
  above: {
    en: "Above optimal", ar: "فوق الأمثل",
    dot: "bg-brand-500",
    text: "text-brand-700 dark:text-brand-300",
    bar: "bg-brand-500",
    pill: "bg-brand-500/10 text-brand-700 ring-brand-500/20 dark:text-brand-300",
  },
};

/**
 * The percentage as text. **The only place the N/A token is written**, so no
 * caller can accidentally render a missing figure as 0%.
 *
 * `lang` is REQUIRED rather than defaulted. A default would let a caller forget
 * it and silently print English into an Arabic page — exactly the failure this
 * function centralises the token to prevent — and the compiler cannot warn about
 * an argument that is optional. The percentage branch is language-independent:
 * digits stay Latin here as everywhere else in the app.
 */
export function formatUtilization(pct: number | null | undefined, lang: Lang): string {
  if (pct == null) return t("common.na", lang);
  return `${pct.toFixed(1)}%`;
}

/**
 * Bar width. A NULL is 0 width — the bar is absent, not empty-at-zero, and the
 * label beside it says N/A. Clamped at 100 so an unexpected over-100 figure
 * cannot paint outside its track (0130's ruling 3 makes that impossible today;
 * the clamp is for the day someone changes the view).
 */
export function utilizationBarWidth(pct: number | null | undefined): number {
  if (pct == null) return 0;
  return Math.max(0, Math.min(100, pct));
}

/** Which of the four "no utilization" explanations applies. */
export type UtilizationNaKind = "both" | "out_of_service" | "maintenance" | "none";

/**
 * Why a truck has no utilization. Only ever called for the `na` band, where
 * `available_days` is 0 by definition.
 *
 * Returns the KIND, not the sentence: the four sentences live in the dictionary
 * (`fleet.util.na*`) because they are page copy and have to change language.
 * Callers render them through UTILIZATION_NA_KEY below, so the branch logic
 * stays here — in the module that owns the band rules — and is written once.
 */
export function utilizationNaReason(row: {
  out_of_service_days: number;
  maintenance_days: number;
}): UtilizationNaKind {
  if (row.out_of_service_days > 0 && row.maintenance_days > 0) return "both";
  if (row.out_of_service_days > 0) return "out_of_service";
  if (row.maintenance_days > 0) return "maintenance";
  return "none";
}

/**
 * Kind → dictionary key. TKey-typed, so a renamed dictionary leaf is a compile
 * error here rather than a `fleet.util.naBoth` string printed on the page.
 */
export const UTILIZATION_NA_KEY: Record<UtilizationNaKind, TKey> = {
  both: "fleet.util.naBoth",
  out_of_service: "fleet.util.naOutOfService",
  maintenance: "fleet.util.naMaintenance",
  none: "fleet.util.naNone",
};
