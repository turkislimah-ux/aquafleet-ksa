// OPERATIONS STATEMENT VIEW-MODEL — what the printed operations sheet says, in
// what order, and in which words.
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING may
//   not.
//
// The source of truth is app/reports/StatementViews.tsx, OperationsStatement.
// Every label below resolves through `t()` from the SAME KEY that component
// passes, so a reword lands on both surfaces or on neither.
//
// IT TAKES THE COMPONENT'S OWN ROLLUP, NOT THE RAW VIEW. The driver columns are
// a `useMemo` — grouped by `driver_id`, plate picked as the most-frequent one
// weighted by scheduled trips, completion RECOMPUTED per driver from that
// driver's own totals — and the period scalars are consts hoisted beside it. No
// file in lib/ may import from @/app/, so re-deriving any of that here would be
// a SECOND expression of figures the screen already states. Every number in
// `OpsDocInput` is one the component has already named.
//
// TWO THINGS THIS FILE WORDS THAT THE SCREEN WORDS AT RENDER, for the reason the
// screen gives at each: the no-driver bucket's name (the memo deliberately keeps
// `name` null so a translated string never sits inside a data-keyed memo) and
// the "drove N trucks" qualifier. Both resolve from the screen's own leaves.
//
// THE HEADLINE FIGURE, THE STAT STRIP AND THE CHART ARE THE ADDITIONS, and the
// only three. The screen states no single total and draws nothing. Turki's
// ruling: the sheet leads on the completion rate, and the by-month table gets
// the dual-axis line the project breakdown already uses. Each is named below
// with the figure it is taken from.
//
// Purity: no React, no fs, no Supabase, no `process`, no `new Date()` —
// `generatedAt` is passed in, so the same input always renders the same sheet.

import { DASH, numPlain } from "../docPrimitives";
import { fill, plural, t, type Lang } from "../i18n";
import { formatShare } from "../reports";
import { formatDateLang } from "../utils";
import { DOC_COMPANY, docGeneratedMeta } from "./reportDoc";

// ---------------------------------------------------------------------------
// Input — every figure already named by the component
// ---------------------------------------------------------------------------

/** One driver column, exactly as the `drivers` memo produced it — including its
 *  sort, which is scheduled-descending with the no-driver bucket last. */
export type OpsDocDriver = {
  /**
   * NULL is a driver whose record carries no name. It stays null all the way to
   * here for the reason the memo keeps it null: resolving it there would put a
   * translated string inside a data-keyed memo.
   */
  name: string | null;
  /**
   * TRUE for the no-driver-recorded bucket. The caller computes it from the
   * memo's KEY (`__unassigned__`), never from the label — that is what makes the
   * footnote fire on the same row in both languages, and it is the test the
   * screen's own footnote applies.
   */
  unassigned: boolean;
  plate: string | null;
  trucksUsed: number;
  scheduled: number;
  delivered: number;
  notDelivered: number;
  /** Recomputed by the memo from this driver's own totals, never averaged. */
  completion: number | null;
};

/** One month of `v_operations_monthly`, already sliced to the period. */
export type OpsDocMonth = {
  /** The raw month key. Cut to `YYYY-MM` here, where the screen cuts it. */
  month: string;
  trips: number;
  delivered: number;
  trucks: number;
  workOrders: number;
  osJobs: number;
  permits: number;
};

export type OpsDocInput = {
  lang: Lang;
  generatedAt: Date;
  /** The period picker's own label — the masthead's subtitle. */
  label: string;
  /**
   * The picker's multi-month flag, NOT `months.length > 1`.
   *
   * The screen tests these two separately and so does this file: the qualifier
   * on "Trucks that moved" is gated on the PERIOD spanning months, while the
   * by-month table is gated on there being more than one ROW. A two-month period
   * in which only one month has data is exactly where they part.
   */
  multiMonth: boolean;

  /** The period scalars, every one hoisted beside the component's render. */
  totals: {
    trips: number;
    delivered: number;
    workOrders: number;
    osJobs: number;
    maintenanceEvents: number;
    permits: number;
    /** PEAK across the period's months, never a sum — see countsNote. */
    peakTrucks: number;
    /** From PERIOD TOTALS, never an average of monthly rates. Null when nothing
     *  was scheduled: a completion rate over zero trips is not 0%. */
    completion: number | null;
  };

  months: readonly OpsDocMonth[];
  drivers: readonly OpsDocDriver[];
  /** The two share denominators, summed off `drivers` by the component. */
  driverScheduled: number;
  driverDelivered: number;
};

// ---------------------------------------------------------------------------
// Output — one worded object per ATLAS block
// ---------------------------------------------------------------------------

/** Mirrors lib/atlas/blocks.ts's `Stat`. */
export type DocStat = { label: string; value?: string; unit?: string; absent?: string };

/**
 * The leading cell of a driver row, in BOTH driver tables.
 *
 * The screen renders three stacked lines there — name, plate, and the
 * multi-truck note when there was more than one — and the kit's cell carries one
 * quieter line under its value. So lines two and three join into `sub`, middot-
 * separated, which is the same joint the cost sheet's fill lead carries between
 * two facts about one thing. Nothing is dropped and no word is added.
 */
export type OpsDocDriverCell = { name: string; sub: string };

export type OpsDocDeliveryRow = {
  driver: OpsDocDriverCell;
  scheduled: string;
  delivered: string;
  notDelivered: string;
  completion: string;
};

export type OpsDocUtilisationRow = {
  driver: OpsDocDriverCell;
  shareScheduled: string;
  shareDelivered: string;
};

/** One line of the period summary. `emphasis` mirrors the screen's ruled,
 *  semibold completion row — WHICH row is emphasised is the screen's grouping;
 *  how the emphasis is drawn is the renderer's. */
export type OpsDocSummaryRow = {
  label: string;
  /** The quieter qualifier in the same cell — the screen's muted span. */
  sub?: string;
  value: string;
  emphasis?: boolean;
};

export type OpsDocMonthRow = {
  month: string;
  trips: string;
  delivered: string;
  completion: string;
  trucks: string;
  workOrders: string;
  osJobs: string;
  permits: string;
};

export type OpsDocVm = {
  lang: Lang;
  rtl: boolean;
  /** The print dialog's name for the sheet. Never printed on it. */
  docTitle: string;

  masthead: {
    eyebrow: string;
    title: string;
    subtitle: string;
    meta: { label: string; value: string; num?: boolean }[][];
    /**
     * ABSENT when nothing was scheduled, rather than printing 0.0%.
     *
     * `Masthead.figure` is optional precisely for this. A 72px "0.0%" over a
     * period that scheduled no trips states a measured failure to deliver; the
     * truth is that there was nothing to deliver, and the strip below says so in
     * the slot meant for it.
     */
    figure?: { caption: string; value: string; unit: string };
  };

  stats: readonly DocStat[];

  drivers: {
    /** False when no driver row fell in the period. The screen drops BOTH tables
     *  AND both their heads for one sentence, so the renderer must too. */
    has: boolean;
    empty: string;
    delivery: {
      head: string;
      cols: {
        driver: string;
        scheduled: string;
        delivered: string;
        notDelivered: string;
        completion: string;
      };
      rows: readonly OpsDocDeliveryRow[];
      note: string;
    };
    utilisation: {
      head: string;
      cols: { driver: string; shareScheduled: string; shareDelivered: string };
      rows: readonly OpsDocUtilisationRow[];
      /** The screen's note, with the no-driver footnote already appended when
       *  one of the rows is that bucket. */
      note: string;
    };
  };

  summary: {
    head: string;
    cols: { measure: string; value: string };
    rows: readonly OpsDocSummaryRow[];
  };

  byMonth: {
    /** The screen prints this whole block only above one row. */
    has: boolean;
    head: string;
    /**
     * THE DUAL-AXIS LINE — trips on the primary axis, completion on the
     * secondary, which is the by-month table's first three columns drawn.
     *
     * `has` is a HONESTY gate, not tidiness. A month that scheduled nothing has
     * no completion rate — the table prints an em dash there — and a line chart
     * cannot draw an em dash. Plotting the gap as 0 would state a total delivery
     * failure in a month that asked for nothing, so the chart is dropped whole
     * rather than half-invented; the table below still prints every figure. The
     * second condition is the kit's: `trendChart` maps x by `i / (n - 1)`, which
     * is NaN at one point.
     */
    chart: {
      has: boolean;
      points: readonly { label: string; primary: number; secondary: number }[];
      primaryLabel: string;
      secondaryLabel: string;
      aria: string;
    };
    cols: {
      month: string;
      trips: string;
      delivered: string;
      completion: string;
      trucks: string;
      workOrders: string;
      osJobs: string;
      permits: string;
    };
    rows: readonly OpsDocMonthRow[];
  };

  /** The two sentences the screen closes with, each already joined. */
  notes: { counts: string; absent: string };

  footer: readonly string[];
};

export function buildOpsVm(input: OpsDocInput): OpsDocVm {
  const { lang } = input;
  const count = (n: number) => numPlain(n);
  const generated = formatDateLang(input.generatedAt, lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const driverLabel = t("common.driver", lang);
  const scheduledLabel = t("reports.th.tripsScheduled", lang);
  const deliveredLabel = t("reports.metric.tripsDelivered", lang);
  const completionRateLabel = t("reports.ops.deliveryCompletionRate", lang);
  const unassignedLabel = t("reports.ops.unassigned", lang);

  /**
   * The leading cell of a driver row, built once for both tables.
   *
   * `{n}` GOES IN RAW, never through `count()`. The dictionary pins that: the
   * screen interpolates this count directly, and adding a thousands separator
   * now would change a figure rather than translate it.
   */
  const driverCell = (d: OpsDocDriver): OpsDocDriverCell => {
    const parts = [d.plate ?? DASH];
    if (d.trucksUsed > 1) {
      parts.push(
        fill(t(`reports.ops.droveTrucks.${plural(d.trucksUsed)}`, lang), { n: d.trucksUsed }),
      );
    }
    return { name: d.name ?? unassignedLabel, sub: parts.join(" · ") };
  };

  // The two shares, over the PERIOD denominators the component computed. Same
  // expressions the utilisation cells hold on screen, guard included.
  const shareScheduled = (n: number) =>
    formatShare(input.driverScheduled > 0 ? (n / input.driverScheduled) * 100 : null);
  const shareDelivered = (n: number) =>
    formatShare(input.driverDelivered > 0 ? (n / input.driverDelivered) * 100 : null);

  // A month's completion, recomputed per row exactly as the screen's cell does.
  const monthCompletion = (m: OpsDocMonth) => (m.trips > 0 ? (m.delivered / m.trips) * 100 : null);

  const hasDrivers = input.drivers.length > 0;
  const hasByMonth = input.months.length > 1;
  const hasChart = hasByMonth && input.months.every((m) => m.trips > 0);

  return {
    lang,
    rtl: lang === "ar",
    docTitle: fill(t("reports.doc.ops.docTitle", lang), { p: input.label }),

    masthead: {
      eyebrow: DOC_COMPANY,
      title: t("reports.ops.title", lang),
      subtitle: input.label,
      meta: [[docGeneratedMeta(lang, generated)]],
      ...(input.totals.completion === null
        ? {}
        : {
            figure: {
              // THE SAME NAME THE PERIOD SUMMARY GIVES THIS FIGURE, one table
              // down. One number must not carry two names on one sheet.
              caption: completionRateLabel,
              value: formatShare(input.totals.completion),
              // NOT the SAR caption every other sheet's masthead carries — this
              // figure is a ratio, and its unit slot has to say what it is a
              // ratio OF or the percentage names no denominator.
              unit: t("reports.doc.ops.figureUnit", lang),
            },
          }),
    },

    // FIVE CELLS: the two counts the period is measured in, the gap between
    // them, the ratio that gap implies, and the fleet that did the work.
    //
    // NOT DELIVERED is the one DERIVED figure on the strip — `trips − delivered`
    // — and it is derivation, not new data: both operands are printed two cells
    // to its left and the driver table carries the same subtraction per row,
    // under this exact label.
    //
    // TRUCKS is the PEAK, which on a multi-month period means the highest single
    // month. The strip has no room for that qualifier; the summary row below
    // carries it and the closing note explains why the measure is not additive.
    stats: [
      { label: t("reports.th.trips", lang), value: count(input.totals.trips) },
      { label: t("reports.th.delivered", lang), value: count(input.totals.delivered) },
      {
        label: t("reports.th.notDelivered", lang),
        value: count(input.totals.trips - input.totals.delivered),
      },
      // An em dash where the ratio is incomputable, in the slot meant for
      // exactly that claim — a faint 0.0% would read as a measured total
      // failure, which is the opposite of "nothing was scheduled".
      input.totals.completion === null
        ? { label: t("reports.th.completion", lang), absent: DASH }
        : {
            label: t("reports.th.completion", lang),
            value: formatShare(input.totals.completion),
          },
      { label: t("reports.th.trucks", lang), value: count(input.totals.peakTrucks) },
    ],

    drivers: {
      has: hasDrivers,
      empty: t("reports.ops.noTrips", lang),

      delivery: {
        head: t("reports.ops.deliveryByDriver", lang),
        cols: {
          driver: driverLabel,
          scheduled: scheduledLabel,
          delivered: deliveredLabel,
          notDelivered: t("reports.th.notDelivered", lang),
          completion: t("reports.th.completionRate", lang),
        },
        rows: input.drivers.map((d) => ({
          driver: driverCell(d),
          scheduled: count(d.scheduled),
          delivered: count(d.delivered),
          // A dash where the screen shows one. A 0 in this column would be a
          // measured zero; the claim is that this driver missed nothing at all.
          notDelivered: d.notDelivered === 0 ? DASH : count(d.notDelivered),
          completion: formatShare(d.completion),
        })),
        note: t("reports.ops.deliveryNote", lang),
      },

      utilisation: {
        head: t("reports.ops.utilisationHead", lang),
        cols: {
          driver: driverLabel,
          shareScheduled: t("reports.th.shareScheduled", lang),
          shareDelivered: t("reports.th.shareDelivered", lang),
        },
        rows: input.drivers.map((d) => ({
          driver: driverCell(d),
          shareScheduled: shareScheduled(d.scheduled),
          shareDelivered: shareDelivered(d.delivered),
        })),
        // THE FOOTNOTE IS APPENDED, not printed separately, because the screen
        // appends it to the same paragraph. It fires on the BUCKET, not on the
        // label — see `OpsDocDriver.unassigned`. The joined tail opens with a
        // colon, and `joinNote` reads that rather than being told, so the
        // Arabic colon cannot drift from the English one.
        note: input.drivers.some((d) => d.unassigned)
          ? joinNote([
              t("reports.ops.utilisationNote", lang),
              t("reports.ops.unassignedNoteBefore", lang),
              unassignedLabel,
              t("reports.ops.unassignedNoteAfter", lang),
            ])
          : t("reports.ops.utilisationNote", lang),
      },
    },

    summary: {
      head: t("reports.ops.periodSummary", lang),
      cols: { measure: t("reports.th.measure", lang), value: t("reports.th.value", lang) },
      rows: [
        { label: scheduledLabel, value: count(input.totals.trips) },
        { label: deliveredLabel, value: count(input.totals.delivered) },
        {
          // THE ONE EMPHASISED ROW, and it sits mid-table on screen too: the
          // rate is the reading of the two counts above it, not another count.
          label: completionRateLabel,
          value: formatShare(input.totals.completion),
          emphasis: true,
        },
        {
          label: t("reports.ops.trucksThatMoved", lang),
          // THE QUALIFIER THAT KEEPS A NON-ADDITIVE MEASURE HONEST, and it is
          // conditional on the PERIOD spanning months rather than on the rows.
          ...(input.multiMonth ? { sub: t("reports.ops.mostInAnyMonth", lang) } : {}),
          value: count(input.totals.peakTrucks),
        },
        { label: t("reports.ops.workOrders", lang), value: count(input.totals.workOrders) },
        { label: t("reports.ops.outsourcedJobs", lang), value: count(input.totals.osJobs) },
        {
          label: t("reports.ops.maintenanceEvents", lang),
          value: count(input.totals.maintenanceEvents),
        },
        { label: t("reports.ops.exitPermits", lang), value: count(input.totals.permits) },
      ],
    },

    byMonth: {
      has: hasByMonth,
      head: t("reports.ops.byMonth", lang),
      chart: {
        has: hasChart,
        points: hasChart
          ? input.months.map((m) => ({
              label: m.month.slice(0, 7),
              primary: m.trips,
              // NOT NULL BY CONSTRUCTION under `hasChart`, which is what that
              // gate is for. `?? 0` is the type's floor, never a fallback the
              // sheet can actually print.
              secondary: monthCompletion(m) ?? 0,
            }))
          : [],
        // THE COLUMN HEADS OF THE TABLE THE CHART SITS ON, verbatim. The kit
        // prints each at the end of its own line, so the two series name
        // themselves from the same two words the rows below are headed with.
        primaryLabel: t("reports.th.trips", lang),
        secondaryLabel: t("reports.th.completion", lang),
        aria: t("reports.doc.ops.chartAria", lang),
      },
      cols: {
        month: t("reports.th.month", lang),
        trips: t("reports.th.trips", lang),
        delivered: t("reports.th.delivered", lang),
        completion: t("reports.th.completion", lang),
        trucks: t("reports.th.trucks", lang),
        workOrders: t("reports.th.wos", lang),
        osJobs: t("reports.th.osJobs", lang),
        permits: t("reports.th.permits", lang),
      },
      rows: input.months.map((m) => ({
        month: m.month.slice(0, 7),
        trips: count(m.trips),
        delivered: count(m.delivered),
        completion: formatShare(monthCompletion(m)),
        trucks: count(m.trucks),
        workOrders: count(m.workOrders),
        osJobs: count(m.osJobs),
        permits: count(m.permits),
      })),
    },

    // THE TWO CLOSING NOTES, JOINED. `note()` escapes, and the kit has no
    // <strong> primitive — emphasis inside a sentence is a screen device, and
    // this sheet's register carries no bold body text at all. The WORDS are
    // every word the screen prints, in the screen's order, with the screen's own
    // JSX spacing.
    notes: {
      counts: joinNote([
        t("reports.ops.countsNoteBefore", lang),
        t("reports.ops.countsNoteStrong", lang),
        t("reports.ops.countsNoteAfter", lang),
      ]),
      absent: joinNote([
        t("reports.ops.absentNote1", lang),
        t("reports.ops.absentStrong1", lang),
        t("reports.ops.absentNote2", lang),
        t("reports.ops.absentStrong2", lang),
        t("reports.ops.absentNote3", lang),
      ]),
    },

    footer: [fill(t("reports.print.generated", lang), { d: generated }), DOC_COMPANY],
  };
}

/**
 * Join the parts of a note that the screen splits at a `<strong>`.
 *
 * A part that OPENS with punctuation is a continuation of the part before it,
 * not a new word after it: ": trips recorded with no driver" closes the clause
 * the emphasis started, and an unconditional space sets the colon adrift — the
 * same rule `metaPair` applies to a meta tail, and for the same reason. Decided
 * from the string rather than passed in, so a future reword that moves the
 * punctuation to the other side does not need this call site changed too.
 *
 * A SECOND COPY of lib/docvm/cost.ts's helper, deliberately. It is six lines of
 * punctuation policy, both copies carry the reason, and a shared module for it
 * would claim the two sheets' notes are one thing when they are two screens that
 * happen to split their sentences the same way. Hoist it when a third sheet
 * needs it and the relationship is real.
 */
function joinNote(parts: readonly string[]): string {
  return parts.reduce((acc, p) => acc + (/^[,.;:!?)\]]/.test(p) ? "" : " ") + p);
}
