"use client";

// HOW THE ONE EXPORT BUTTON REACHES NINE DIFFERENT REPORTS.
//
// The button lives in the page header (ReportsClient), where the deleted
// decorative "Export PDF" used to sit. The DATA it exports lives one or two
// levels down, in whichever report is currently on screen — and so does the
// period that scopes it.
//
// THERE IS NO SHARED PERIOD STATE ON THIS PAGE, and that is not an oversight to
// fix here. Three independent period controls exist by design: the Overview's
// month picker (ReportsClient), the statements' month/quarter/year + period
// select (StatementsTab), and Daily Trips' own day/week/month/quarter/year
// anchor (DailyTripsTab). ReportsClient.tsx says why the first one cannot
// express the second. So the export cannot read "the" period from the top —
// it has to be built where the period already is.
//
// Hence registration rather than lifting: the report that is mounted hands the
// header a CLOSURE that builds its table, and the closure captures that
// report's own rows and its own period. The state never leaves the component
// that owns it, which is the same conclusion CommissionsTab reached when it
// portalled its month lens instead of lifting it (see its `controlsHost` note).
//
// Exactly one report is mounted at a time, so exactly one source is registered
// at a time. The cleanup below is what makes that true on a tab switch: without
// it, the outgoing report's closure would stay registered and the header would
// export the screen the user just left.

import { useEffect } from "react";
import type { CsvSource } from "@/lib/csv";
import { t, fill, type Lang } from "@/lib/i18n";

/** Passed down from ReportsClient. Null clears the registration. */
export type RegisterCsv = (source: CsvSource | null) => void;

/**
 * Register this report as the export source while it is mounted.
 *
 * `build` MUST be a useCallback whose deps cover the rows and the period it
 * closes over — that is what re-registers the closure when the user changes
 * period, and a missing dep is an export that quietly keeps serving the
 * previous period's numbers.
 *
 * Returning null from `build` means "nothing to export right now"; the header
 * button disables itself rather than emitting a file with only headings.
 */
export function useCsvSource(register: RegisterCsv | undefined, build: CsvSource): void {
  useEffect(() => {
    if (!register) return;
    register(build);
    return () => register(null);
  }, [register, build]);
}

// COLUMN HEADINGS CARRY THE UNIT, because the cell below them is a raw number
// with nothing attached (see CsvTable in lib/csv.ts). Both helpers take an
// ALREADY TRANSLATED heading — `t("common.revenue", lang)` — and wrap it, so the
// spreadsheet says the same word the screen does and there is no second Arabic
// spelling to drift.

/** "Revenue" -> "Revenue (SAR)" / "الإيرادات (ر.س)". */
export function withSar(heading: string, lang: Lang): string {
  return fill(t("reports.export.sarCol", lang), { c: heading });
}

/** "Completion rate" -> "Completion rate (%)". */
export function withPct(heading: string, lang: Lang): string {
  return fill(t("reports.export.pctCol", lang), { c: heading });
}
