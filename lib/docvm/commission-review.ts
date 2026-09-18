// COMMISSION-REVIEW VIEW-MODEL — what the printed review says, in what order,
// and in which words.
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING may
//   not.
//
// The source of truth is `CommissionReviewTable` in
// app/reports/StatementViews.tsx: its heading, its subtitle sentence, its
// distinction paragraph, its four-column table, its total row and its footnote.
//
// ==========================================================================
// THE GROUPING IS THE COMPONENT'S, COPIED, NOT RE-DERIVED
// ==========================================================================
// The screen's memo filters the view's driver x month x project rows to the
// period, sums them into one row per driver, keeps a per-project trip count
// under each, and sorts by commission descending. That is a GROUPING, and the
// law names grouping alongside data and wording. It is reproduced here line for
// line rather than re-expressed, including the NULL project bucket keyed
// `__direct__` and named only at render — a translated string inside a memo
// keyed on data is how a table keeps the old language after the toggle moves,
// and the screen's own comment says so.
//
// ==========================================================================
// THE MASTHEAD CARRIES NO FIGURE
// ==========================================================================
// Every other report sheet in the pack puts its one covering number at 72px
// under the title. This one has no such number to put there: commission earned
// is a COLUMN, and its total is the foot of that column. Lifting it to the
// masthead would rank it above the trips it is earned on, and would state the
// same figure in two places at two sizes with nothing to say which is the
// answer. So the masthead ends at its meta line and the strip below carries the
// two totals instead.
//
// ==========================================================================
// TWO STAT CELLS, NOT THREE — THERE IS NO DRIVER COUNT TO PRINT
// ==========================================================================
// The strip states Trips and Commission earned: both are figures the screen's
// own total row prints, under the screen's own column heads. A third cell
// counting DRIVERS would be a figure this screen has never stated — the table
// has one row per driver and never says how many — and it would need a label
// borrowed from somewhere that is not this table. One invention is a deviation;
// two for one cell is not a close call.
//
// The strip and the foot therefore say the same two numbers, and that is the
// point rather than a duplication: a review with forty drivers paginates, a
// foot only prints on the last sheet, and the reader who picks up page one is
// entitled to the answer. The register solves the same problem with its
// masthead figure, which this sheet cannot use.
//
// ==========================================================================
// THE DISTINCTION PARAGRAPH KEEPS ITS PLACE AND LOSES ITS BOX
// ==========================================================================
// On screen it is a brand-tinted panel of five emphasised fragments. On paper
// the tint is a grey wash and the emphasis is gone in one colour, so the box
// stops doing anything and starts costing a rule and a fill. It prints as the
// standfirst — the paragraph directly under the masthead, before anything the
// sheet measures — which is where the screen has it and what it is for. Every
// fragment is joined in the screen's order, in the screen's words; only the
// bolding goes, which is the same call the daily sheet made.
//
// It prints even when no driver qualified. The screen renders it ABOVE the
// empty state, not inside the table branch, because the distinction it draws is
// about what the table MEANS and is not less true for being empty.
//
// ==========================================================================
// THE DUPLICATE-NAME SUFFIX IS AN IDENTIFIER AND TRAVELS WITH THE NAME
// ==========================================================================
// Two drivers share the name "Fahad 4", different ids, different money. The
// screen appends `#abcd` to the AMBIGUOUS names only, and this sheet does the
// same in the same condition — a discriminator on every row would be noise, and
// dropping it on the two rows that need it is how a manager reads two people as
// one.
//
// It is appended to the name STRING, not carried beside it: the kit has no
// inline device for a muted identifier inside a table cell, and the muting is
// exactly the part a printable is allowed to lose. What it must not lose is the
// direction — the driver column is declared `iso` so the Latin run is pinned
// inside an Arabic name, and `iso()` isolates RUNS rather than strings, so on a
// name with no Latin in it the isolate is inert rather than harmful.
//
// Purity: no React, no fs, no Supabase, no `process`, no `new Date()` —
// `generatedAt` is passed in, so the same input always renders the same sheet.

import { fill, personNameById, t, type Lang } from "../i18n";
import type { DriverCommissionByProjectRow } from "../reports";
import { formatDateLang, formatNum, formatSar } from "../utils";
import { DOC_COMPANY, DOC_SAR, docGeneratedMeta } from "./reportDoc";

// ---------------------------------------------------------------------------
// Input — the view's rows, unfiltered, exactly as the component receives them
// ---------------------------------------------------------------------------

export type CommissionReviewDocInput = {
  lang: Lang;
  generatedAt: Date;
  /** The period picker's own label, opening the subtitle sentence. */
  label: string;
  /**
   * The period bounds the component filters on. Passed rather than pre-applied
   * because the component filters INSIDE its memo, and a caller filtering first
   * would be a second definition of which months the review covers.
   */
  periodStart: string;
  periodEnd: string;
  rows: readonly DriverCommissionByProjectRow[];
  /**
   * The drivers the PAGE already fetched (id, name, name_ar) — threaded in so
   * the sheet resolves each name in ITS OWN language through personNameById.
   * The view's prejoined `driver_name` stays the fallback: a terminated driver
   * absent from this list still prints, under the base name.
   */
  driverNames: readonly { id: string; name: string; name_ar?: string | null }[];
};

// ---------------------------------------------------------------------------
// Output — one worded object per ATLAS block, and no ATLAS types in it
// ---------------------------------------------------------------------------

/** One project a driver served, with that project's trip count. */
export type CommissionReviewDocProject = { label: string; count: string };

export type CommissionReviewDocRow = {
  /** The name, carrying `#abcd` only when the name is ambiguous. */
  driver: string;
  trips: string;
  projects: readonly CommissionReviewDocProject[];
  commission: string;
};

export type CommissionReviewDocVm = {
  lang: Lang;
  rtl: boolean;
  /** The print dialog's name for the sheet. Never printed on it. */
  docTitle: string;

  masthead: {
    eyebrow: string;
    title: string;
    subtitle: string;
    meta: { label: string; value: string; num?: boolean }[][];
  };

  /** The distinction paragraph, joined. Always present — see the header. */
  caveat: string;

  /** Trips and Commission earned. Empty when no driver qualified. */
  stats: readonly { label: string; value: string; unit?: string }[];

  /**
   * The one sentence that replaces the table when no driver qualified. Null
   * whenever there are rows. The screen drops the table, the total and the
   * footnote together, so the sheet does too.
   */
  empty: string | null;

  cols: { driver: string; trips: string; projects: string; commission: string };

  rows: readonly CommissionReviewDocRow[];

  /** The total row, moved out of the body. Null when empty. */
  foot: { label: string; trips: string; commission: string } | null;

  /** The closing footnote. Empty string when the table did not print. */
  note: string;

  footer: readonly string[];
};

export function buildCommissionReviewVm(
  input: CommissionReviewDocInput,
): CommissionReviewDocVm {
  const { lang } = input;
  const generated = formatDateLang(input.generatedAt, lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // THE COMPONENT'S MEMO, VERBATIM. Filter to the period, sum the view's rows
  // into one row per driver, keep each project's trip count beneath, sort by
  // commission descending.
  const inPeriod = input.rows.filter(
    (r) => r.month >= input.periodStart && r.month <= input.periodEnd,
  );

  const byDriver = new Map<
    string,
    {
      driverId: string;
      name: string;
      trips: number;
      commission: number;
      // NULL stays NULL to the point of render, exactly as on screen: naming
      // the bucket during the grouping would freeze one language into it.
      projects: Map<string, { name: string | null; trips: number }>;
    }
  >();

  // THE SHEET'S LANGUAGE PICKS THE NAME — resolved here, at the grouping's
  // door, so the duplicate-name test below runs on what the reader will see:
  // two drivers whose ARABIC names collide are ambiguous on the Arabic sheet
  // even when their English names differ, and vice versa.
  const displayName = personNameById(input.driverNames, lang);

  for (const r of inPeriod) {
    const e = byDriver.get(r.driver_id) ?? {
      driverId: r.driver_id,
      name: displayName.get(r.driver_id) ?? r.driver_name,
      trips: 0,
      commission: 0,
      projects: new Map<string, { name: string | null; trips: number }>(),
    };
    e.trips += r.trips_delivered;
    e.commission += r.commission_sar;
    // A NULL project is a direct-customer trip — real work with real
    // commission, kept by the view rather than dropped, and named at render.
    const key = r.project_id ?? "__direct__";
    const p = e.projects.get(key) ?? { name: r.project_name, trips: 0 };
    p.trips += r.trips_delivered;
    e.projects.set(key, p);
    byDriver.set(r.driver_id, e);
  }

  const drivers = [...byDriver.values()].sort((a, b) => b.commission - a.commission);

  const seen = new Map<string, number>();
  for (const d of drivers) seen.set(d.name, (seen.get(d.name) ?? 0) + 1);
  const duplicateNames = new Set(
    [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k),
  );

  const totals = drivers.reduce(
    (a, d) => ({ trips: a.trips + d.trips, commission: a.commission + d.commission }),
    { trips: 0, commission: 0 },
  );

  const has = drivers.length > 0;
  const directCustomer = t("reports.commissionReview.directCustomer", lang);

  // FIVE EMPHASISED FRAGMENTS AND SIX PLAIN ONES, in the screen's order and
  // with the screen's seams: a space between every pair except the last, whose
  // value opens with its own comma. The bolding is the only thing dropped.
  //
  // WRITTEN OUT, not built from a key fragment in a loop. `t()` is typed on the
  // dictionary's literal keys, which is what guarantees every key printed here
  // exists in BOTH languages; a template string widens to `string` and hands
  // that guarantee back. The same rule lib/docvm/cost.ts keeps with its `as
  // const` bucket keys.
  const caveat =
    [
      t("reports.commissionReview.distinct1", lang),
      t("reports.commissionReview.distinctNot", lang),
      t("reports.commissionReview.distinct2", lang),
      t("reports.commissionReview.distinctSettled", lang),
      t("reports.commissionReview.distinct3", lang),
      t("reports.commissionReview.distinctEarned", lang),
      t("reports.commissionReview.distinct4", lang),
      t("reports.commissionReview.distinctJune", lang),
      t("reports.commissionReview.distinct5", lang),
      t("reports.commissionReview.distinctJuly", lang),
    ].join(" ") + t("reports.commissionReview.distinct6", lang);

  const docRow = (d: (typeof drivers)[number]): CommissionReviewDocRow => ({
    driver: duplicateNames.has(d.name)
      ? `${d.name} #${d.driverId.slice(0, 4)}`
      : d.name,
    trips: formatNum(d.trips),
    // SORTED BY TRIPS DESCENDING, as the chips are. The order is the only
    // ranking this cell states, and reversing it would rank the projects a
    // driver barely touched above the one he worked all month.
    projects: [...d.projects.entries()]
      .sort((a, b) => b[1].trips - a[1].trips)
      .map(([, p]) => ({
        label: p.name ?? directCustomer,
        count: formatNum(p.trips),
      })),
    commission: formatSar(d.commission),
  });

  return {
    lang,
    rtl: lang === "ar",
    docTitle: fill(t("reports.doc.commissionReview.docTitle", lang), {
      p: input.label,
    }),

    masthead: {
      eyebrow: DOC_COMPANY,
      title: t("reports.commissionReview.title", lang),
      // THE SCREEN'S OWN SUBTITLE SENTENCE, whole. One leaf says "work month"
      // for the band, the subtitle and the footnote on screen — the phrase is
      // the point of the table — and this sheet reads that same leaf for the
      // same reason.
      subtitle:
        `${input.label} · ${t("reports.commissionReview.workMonth", lang)} ` +
        `${t("reports.commissionReview.subtitleAfterMonth", lang)} ` +
        `${t("reports.commissionReview.subtitleStrong", lang)}.`,
      meta: [[docGeneratedMeta(lang, generated)]],
    },

    caveat,

    stats: has
      ? [
          {
            label: t("reports.th.trips", lang),
            value: formatNum(totals.trips),
          },
          {
            label: t("reports.th.commissionEarned", lang),
            // The separator and rounding `formatSar` gives, without its suffix:
            // a stat cell has its own unit slot, and printing the unit twice
            // reads as part of the number.
            value: formatNum(totals.commission),
            unit: DOC_SAR,
          },
        ]
      : [],

    empty: has ? null : t("reports.commissionReview.noDeliveredTrips", lang),

    cols: {
      driver: t("common.driver", lang),
      trips: t("reports.th.trips", lang),
      projects: t("reports.th.projectsServed", lang),
      commission: t("reports.th.commissionEarned", lang),
    },

    rows: drivers.map(docRow),

    foot: has
      ? {
          label: t("reports.th.total", lang),
          trips: formatNum(totals.trips),
          commission: formatSar(totals.commission),
        }
      : null,

    // The footnote names the direct-customer bucket with the SAME leaf the
    // projects cells render, so the note cannot name a bucket the table spells
    // differently. The full stop is the screen's, written in JSX.
    note: has
      ? `${t("reports.commissionReview.reviewNote", lang)} ${directCustomer}.`
      : "",

    footer: [
      fill(t("reports.print.generated", lang), { d: generated }),
      DOC_COMPANY,
    ],
  };
}
