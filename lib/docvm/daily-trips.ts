// DAILY-TRIPS VIEW-MODEL — what the printed daily record says, in what order,
// and in which words.
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING may
//   not.
//
// The source of truth is app/reports/DailyTripsTab.tsx: the `#daily-trips-print`
// wrapper, its per-project tables, its `TotalsFoot` / `UnpricedFlag` row
// components, and the manual side-log beneath them.
//
// ONE SHEET, TWO HALVES THAT MAY NEVER BE ADDED. The project tables reconcile
// against `trips`; the side-log (deferred_deliveries, 0166) is hand-typed and
// carries none of that provenance, so it is totalled separately and never
// folded in. The screen states this three ways — a heading, a note under the
// heading, and a closing sentence — and all three print. The renderer adds the
// rule that makes the claim structural; see lib/docs/daily-trips.ts.
//
// ==========================================================================
// NO GRAND TOTAL, AND THE SHEET SAYS SO
// ==========================================================================
// Every other sheet in the pack leads with one figure in the masthead. This one
// has none, because there is no number that totals it: each project totals on
// its own and the side-log totals apart. A masthead figure would be exactly the
// addition 0166 forbids, and an empty figure slot reads as a figure that failed
// to render. So the absence is WORDED — `reports.doc.daily.noTotal`, a doc-only
// leaf, because the screen makes the same statement structurally (there is no
// grand-total row anywhere on it) and a structure cannot be read off paper the
// way a missing number can.
//
// ==========================================================================
// NO CURRENCY IS NAMED ON THIS SHEET, AND THAT IS THE MIRROR WORKING
// ==========================================================================
// The screen's `money()` is a bare two-decimal format with no " SAR" suffix,
// and neither figure column heads itself with the unit. lib/docvm/cost.ts does
// the same and puts DOC_SAR only on its stat strip; this sheet has no strip, so
// the unit has nowhere honest to go. Adding one would be an ADDITION to the
// wording, which the law above forbids as squarely as dropping one. If the
// screen ever names the currency, this file follows it — not before.
//
// ==========================================================================
// WHAT THE SCREEN CARRIES IN HUE, AND WHAT BECOMES OF IT
// ==========================================================================
//   * THE UNPRICED CHIP is amber, and in grayscale it is a grey pill saying
//     nothing. It becomes the severity gutter word `reports.doc.daily.unpriced`
//     on the row, and the chip's OWN sentence still prints beside the figure it
//     qualifies — the count is data and does not become a colour.
//   * THE `title` TOOLTIP on that chip does not print. A tooltip is not printed
//     wording; the P&L settled this for `reports.th.uncosted` and this follows.
//   * AN IDLE DRIVER'S NAME is muted on screen and carries "(no trips)" beside
//     it. The WORD prints, in the same cell, one rank quieter. The name is NOT
//     greyed to match: the pack's rule is that the word replaces the hue, and
//     spending both on one fact marks it twice.
//
// Purity: no React, no fs, no Supabase, no `process`, no `new Date()` —
// `generatedAt` is passed in, so the same input always renders the same sheet.

import {
  buildProjectTables,
  deferredTotals,
  type DeferredRow,
  type ReportAssignment,
  type ReportDriver,
  type ReportProject,
  type ReportTrip,
  type ReportTruck,
} from "../daily-trips";
import { DASH, num2 } from "../docPrimitives";
import { fill, plural, t, type Lang } from "../i18n";
import { formatDateLang, formatDayKeyLang } from "../utils";
import { DOC_COMPANY, docGeneratedMeta } from "./reportDoc";

// ---------------------------------------------------------------------------
// Input — the rows the screen fetched, not a second query
// ---------------------------------------------------------------------------

/**
 * Structurally `DailyTripsData`, declared here rather than imported.
 *
 * lib/actions/daily-trips.ts is a "use server" module; importing its type would
 * put a server boundary in the dependency graph of a file whose whole claim is
 * that it touches nothing. The six arrays are the same six, and the compiler
 * checks that at the call site.
 */
export type DailyDocInput = {
  lang: Lang;
  generatedAt: Date;
  /** The screen's own period line: one day, or `from — to`. Passed through. */
  periodLabel: string;
  /**
   * `range.from !== range.to` — the screen's exact test for whether each
   * side-log row shows its own date. A widened period mixes several days into
   * one table and the date is the only thing telling them apart; on a single
   * day it would repeat the masthead on every row.
   */
  widened: boolean;
  data: {
    projects: ReportProject[];
    assignments: ReportAssignment[];
    drivers: ReportDriver[];
    trucks: ReportTruck[];
    trips: ReportTrip[];
    deferred: DeferredRow[];
  };
};

// ---------------------------------------------------------------------------
// Output — one worded object per ATLAS block, and no ATLAS types in it
// ---------------------------------------------------------------------------

export type DailyDocTruckRow = {
  /** Already DASH where the driver drove nothing — the zero row keeps its line. */
  plate: string;
  /** The raw integer the screen prints. Never run through a thousands format:
   *  it is interpolated directly there and a separator would be a new glyph. */
  trips: string;
  /** The chip's own sentence, or null. Its presence also raises the row's flag. */
  unpriced: string | null;
  commission: string;
  revenue: string;
};

export type DailyDocDriverGroup = {
  driver: string;
  /** `(no trips)` when this driver drove nothing in the period, else null. */
  idleNote: string | null;
  /** ALWAYS at least one — lib/daily-trips.ts guarantees the zero row. */
  rows: readonly DailyDocTruckRow[];
};

export type DailyDocProject = {
  head: string;
  /** "{n} assigned drivers", inflected per count bucket. */
  sub: string;
  groups: readonly DailyDocDriverGroup[];
  foot: {
    label: string;
    trips: string;
    unpriced: string | null;
    commission: string;
    revenue: string;
  };
};

export type DailyDocSideRow = {
  driver: string;
  plate: string;
  description: string;
  /** Only when the period was widened; null otherwise. */
  date: string | null;
  trips: string;
  commission: string;
  revenue: string;
};

export type DailyDocVm = {
  lang: Lang;
  rtl: boolean;
  /** The print dialog's name for the sheet. Never printed on it. */
  docTitle: string;
  /**
   * NO `figure`, and the kit's `Masthead` makes it optional for exactly this
   * case. The absence is worded in `noTotal` rather than left silent.
   *
   * The meta pair is spelled structurally rather than imported from the kit —
   * a view-model that names an ATLAS type has started deciding a look.
   */
  masthead: {
    eyebrow: string;
    title: string;
    subtitle: string;
    meta: { label: string; value: string; num?: boolean }[][];
  };
  noTotal: string;
  /** The severity word every unpriced row carries in the gutter. */
  unpricedWord: string;
  cols: {
    driver: string;
    truck: string;
    trips: string;
    commission: string;
    revenue: string;
  };
  /** The screen's empty state, or null when there are projects. */
  projectsEmpty: string | null;
  /**
   * What a project table prints when the project has NO assigned drivers.
   *
   * NOT LIVE TODAY — measured 2026-09-13, all eight active projects carry two
   * or more — but reachable the moment a project is created before anyone is
   * assigned to it, so it cannot be left to the kit's English fallback.
   *
   * `trips.board.noDriversAssigned` is the app's OWN sentence for exactly this
   * condition, reached for rather than minting a doc-only leaf — the same move
   * the P&L makes with `reports.th.uncosted`. It is the one place this sheet
   * says something its own screen does not: there the empty body carries a
   * zeros totals row instead, which the kit refuses to print because a total
   * under no rows asserts a measurement nobody made. The count that row would
   * have carried is already on the section's sub line, in the screen's words.
   */
  projectEmpty: string;
  projects: readonly DailyDocProject[];
  side: {
    head: string;
    intro: string;
    cols: {
      driver: string;
      truck: string;
      description: string;
      trips: string;
      commission: string;
      revenue: string;
    };
    empty: string;
    rows: readonly DailyDocSideRow[];
    foot: { label: string; trips: string; commission: string; revenue: string };
    note: string;
  };
  footer: readonly string[];
};

// ---------------------------------------------------------------------------

export function buildDailyDocVm(input: DailyDocInput): DailyDocVm {
  const { lang, data } = input;

  /** Byte-identical to the screen's `money()`. No unit — see the header. */
  const money = (n: number) => num2(n);

  /** The chip's sentence, or null. One place, so row and foot cannot diverge. */
  const chip = (n: number): string | null =>
    n > 0 ? fill(t("reports.daily.unpricedChip", lang), { n }) : null;

  const generated = formatDateLang(input.generatedAt, lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // THE GROUPING IS NOT REDERIVED HERE. buildProjectTables owns who appears,
  // in what order, and what a zero row means; a second pass over the same rows
  // would be a second definition of the report.
  const tables = buildProjectTables(data);

  // THE JOINS MOVE HERE, OFF THE COMPONENT. The side-log rows carry only
  // `driver_id` / `truck_id`, and the screen resolves them through two `useMemo`
  // Maps. A printable that re-built those Maps client-side would leave the
  // document's wording half-decided in a React hook — the names ARE the wording.
  const driverName = new Map(data.drivers.map((d) => [d.id, d.name]));
  // `tr`, not `t`: the translator is in scope and a map parameter named `t`
  // would shadow it. The screen renamed it for the same reason.
  const truckPlate = new Map(data.trucks.map((tr) => [tr.id, tr.plate]));

  const defTotals = deferredTotals(data.deferred);

  return {
    lang,
    rtl: lang === "ar",
    docTitle: fill(t("reports.doc.daily.docTitle", lang), { p: input.periodLabel }),

    masthead: {
      eyebrow: DOC_COMPANY,
      // The PRINT band's words, not the tab's. The screen keeps two headings on
      // purpose — `reports.statements.tab.daily` names a tab and is `no-print`,
      // this one names a report — and the sheet takes the one meant for paper.
      title: t("reports.daily.printTitle", lang),
      subtitle: input.periodLabel,
      meta: [[docGeneratedMeta(lang, generated)]],
    },

    noTotal: t("reports.doc.daily.noTotal", lang),
    unpricedWord: t("reports.doc.daily.unpriced", lang),

    // The five headings the screen reads — common.driver / common.revenue and
    // three reports.th.*, not five new spellings of words this app has keyed.
    cols: {
      driver: t("common.driver", lang),
      truck: t("reports.th.truck", lang),
      trips: t("reports.th.trips", lang),
      commission: t("reports.th.commission", lang),
      revenue: t("common.revenue", lang),
    },

    projectsEmpty: tables.length === 0 ? t("reports.daily.noActiveProjects", lang) : null,
    projectEmpty: t("trips.board.noDriversAssigned", lang),

    projects: tables.map((tbl): DailyDocProject => ({
      head: tbl.projectName,
      // `{n}` RAW, whole sentence per count bucket — the screen interpolates it
      // directly and formatNum would add a separator the line never had.
      sub: fill(t(`reports.daily.assignedDrivers.${plural(tbl.drivers.length)}`, lang), {
        n: tbl.drivers.length,
      }),
      groups: tbl.drivers.map((g): DailyDocDriverGroup => ({
        driver: g.driverName,
        // IDLE IS A PROPERTY OF THE DRIVER, NOT OF A ROW — the screen tests
        // `g.totals.trips === 0`, so a driver with two trucks and no trips is
        // idle once, not twice.
        idleNote: g.totals.trips === 0 ? t("reports.daily.noTrips", lang) : null,
        rows: g.rows.map((r): DailyDocTruckRow => ({
          plate: r.plate ?? DASH,
          trips: String(r.trips),
          unpriced: chip(r.unpriced),
          commission: money(r.commission),
          revenue: money(r.revenue),
        })),
      })),
      foot: {
        label: t("reports.daily.projectTotal", lang),
        trips: String(tbl.totals.trips),
        unpriced: chip(tbl.totals.unpriced),
        commission: money(tbl.totals.commission),
        revenue: money(tbl.totals.revenue),
      },
    })),

    side: {
      head: t("reports.daily.deferredTitle", lang),
      intro: t("reports.daily.deferredNote", lang),
      // SIX COLUMNS, NOT SEVEN. The screen's seventh holds the edit and delete
      // controls and is already `no-print`; a document has no controls, so it
      // is not a column that was dropped, it is a column that was never printed.
      cols: {
        driver: t("common.driver", lang),
        truck: t("reports.th.truck", lang),
        description: t("reports.daily.description", lang),
        trips: t("reports.th.trips", lang),
        commission: t("reports.th.commission", lang),
        revenue: t("common.revenue", lang),
      },
      empty: t("reports.daily.noManualEntries", lang),
      rows: data.deferred.map((r): DailyDocSideRow => ({
        driver: driverName.get(r.driver_id) ?? DASH,
        plate: truckPlate.get(r.truck_id) ?? DASH,
        description: r.description ?? DASH,
        date: input.widened ? formatDayKeyLang(r.delivery_date, lang) : null,
        // `trip_count` is an integer column and prints raw, like the project
        // side's `trips`. The two money columns arrive as numeric(12,2) and are
        // coerced exactly where the screen coerces them.
        trips: String(r.trip_count),
        commission: money(Number(r.commission_sar)),
        revenue: money(Number(r.revenue_sar)),
      })),
      // NO UNPRICED COUNT HERE, and it is not an omission: `deferredTotals`
      // hard-codes `unpriced: 0` because these rows are hand-entered and never
      // priced from a rate. A flag would report a measurement nobody made.
      foot: {
        label: t("reports.daily.manualTotal", lang),
        trips: String(defTotals.trips),
        commission: money(defTotals.commission),
        revenue: money(defTotals.revenue),
      },
      note: t("reports.daily.separateNote", lang),
    },

    footer: [fill(t("reports.print.generated", lang), { d: generated }), DOC_COMPANY],
  };
}
