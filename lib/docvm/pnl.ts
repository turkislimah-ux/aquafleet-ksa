// P&L VIEW-MODEL — what the printed Profit & Loss says, in what order, and in
// which words.
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING may
//   not.
//
// The source of truth is app/reports/StatementsTab.tsx: the `#pnl-print`
// wrapper, its `Line` / `SectionHead` / `MarginLine` / `VatRow` row components,
// and the six VAT figures computed above them.
//
// ONE SHEET, TWO DOCUMENTS. The wrapper holds two cards and the second is not a
// continuation of the first: the VAT list has no total, no net and no column in
// common with the statement, and its own panel comment says so at length —
// "if a figure here ever reaches the P&L table, the P&L is wrong". Both travel
// on one sheet because the VAT a period touched is the page an accountant wants
// attached to the P&L, which is exactly why the screen keeps them in one print
// wrapper. The renderer separates them with a rule; see lib/docs/pnl.ts.
//
// WHAT THE SCREEN CARRIES IN HUE, AND WHAT BECOMES OF IT.
//
//   * THE TWO ZAKAT ROWS are italic + unbolded on screen, a real distinction on
//     a backlit screen and the first thing a photocopier loses. They take the
//     severity gutter word `reports.doc.pnl.estimate`.
//   * THE UNCOSTED-FILLS SENTENCE is amber. It takes `reports.th.uncosted` as
//     its word — the screen's own word for this exact condition, which
//     lib/docvm/cost.ts already reuses the same way rather than minting a
//     doc-only one.
//   * A NEGATIVE FIGURE is rose on the `signed` rows. NO MARK: the minus sign
//     is one glyph to its left, and a second encoding of a fact the figure
//     already carries is noise, not redundancy. lib/docvm/narrative.ts settles
//     this for the whole pack.
//   * THE VARIANCE TONE — emerald where a move is good for that metric, rose
//     where it is bad — IS THE ONE THING GRAYSCALE LOSES, and it is left lost.
//     The SIZE and the DIRECTION of every move still print: the sign is in the
//     figure and the arithmetic is in the two columns beside it. Only the
//     JUDGEMENT is hue-only, and it is per-metric (`higherIsBetter`), so the
//     alternative is a gutter word on twelve of eighteen rows — one on every
//     line that moved at all. That marks nothing, because the kit does not rank
//     severities and a word on every row is a column, not a finding. A reader
//     who knows that payroll rising is not good does not need to be told on the
//     paper; a reader who does not is not helped by "bad" either.
//
// Purity: no React, no fs, no Supabase, no `process`, no `new Date()` —
// `generatedAt` is passed in, so the same input always renders the same sheet.

import { DASH, num2 } from "../docPrimitives";
import { fill, plural, t, type Lang, type TKey } from "../i18n";
import {
  delta,
  formatPct,
  formatShare,
  indicativeZakat,
  type ExpenseCategoryPeriodRow,
  type PnlPeriodRow,
} from "../reports";
import { formatDateLang } from "../utils";
import { DOC_COMPANY, DOC_SAR, docGeneratedMeta } from "./reportDoc";

// ---------------------------------------------------------------------------
// Input — the rows the screen holds, not a second query
// ---------------------------------------------------------------------------

/**
 * One VAT source, as the screen's own `vatLine` returns it.
 *
 * PASSED IN, NEVER RECOMPUTED. The six figures are four independent passes over
 * rows this component already has in hand, filtered on period; re-deriving them
 * here would put a second definition of "VAT in the period" in the tree, and the
 * panel's whole claim is that any line can be taken back to the screen it came
 * from and found there.
 */
export type PnlVatLine = { total: number; count: number };

export type PnlDocInput = {
  lang: Lang;
  generatedAt: Date;
  /** `periodLabel(current, lang)`, composed by the screen and passed through. */
  label: string;
  /** `periodLabel(prior, lang)`, or null when there is nothing to compare. */
  priorLabel: string | null;
  /** `isPeriodInProgress(current.period_end, today)`. */
  inProgress: boolean;
  current: PnlPeriodRow;
  /** Null where no earlier period exists — three of the five columns go blank. */
  prior: PnlPeriodRow | null;
  /** USER DATA. Free text typed into ExpensesModal; no enum, no `_ar` column. */
  categories: readonly ExpenseCategoryPeriodRow[];
  vat: {
    sales: PnlVatLine;
    ordered: PnlVatLine;
    received: PnlVatLine;
    repairs: PnlVatLine;
    orderedRejected: PnlVatLine;
    receivedRejected: PnlVatLine;
  };
};

// ---------------------------------------------------------------------------
// Output — one worded object per ATLAS block
// ---------------------------------------------------------------------------

/** Mirrors lib/atlas/blocks.ts's `Stat`. */
export type DocStat = { label: string; value?: string; unit?: string; absent?: string };

/**
 * A row of the statement, in the screen's three shapes and no fourth.
 *
 * `head` is `SectionHead`, `note` is a full-width sentence row, `line` is
 * `Line` and `MarginLine` both — a margin line is a label and four cells like
 * any other, and the only thing special about it is that two of its cells are
 * not money, which is a matter of what strings arrive here rather than of shape.
 */
export type PnlDocLine =
  | { kind: "head"; text: string }
  | { kind: "note"; text: string; flag?: string }
  | {
      kind: "line";
      label: string;
      /** Current, prior, variance, percent — already worded and formatted. */
      values: readonly string[];
      indent?: boolean;
      rule?: boolean;
      strong?: boolean;
      flag?: string;
    };

/** One line of the VAT list. Two columns, and the hint that makes it auditable. */
export type PnlDocVatRow = {
  label: string;
  /** Document count and date basis — `{n} invoices · by invoice month`. */
  hint: string;
  value: string;
  indent?: boolean;
};

export type PnlDocVm = {
  lang: Lang;
  rtl: boolean;
  /** The print dialog's name for the sheet. Never printed on it. */
  docTitle: string;

  masthead: {
    eyebrow: string;
    title: string;
    subtitle: string;
    meta: { label: string; value: string; num?: boolean }[][];
    figure: { caption: string; value: string; unit: string };
  };

  /**
   * The in-progress caveat, or null.
   *
   * NO GUTTER WORD, deliberately. The sentence opens "This period is still in
   * progress" — the warning IS the wording, and a word beside it repeating that
   * says nothing the eye has not already read. Same argument
   * `reports.doc.pnl.estimate` makes against spelling itself "indicative".
   */
  warn: string | null;

  stats: readonly DocStat[];

  statement: {
    /** Five heads: blank, current period, prior period (or a dash), variance, %. */
    cols: readonly string[];
    lines: readonly PnlDocLine[];
    /** The card's closing paragraph — how each figure was arrived at. */
    footer: string;
  };

  vat: {
    head: string;
    /** The period, beside the heading exactly as on screen. */
    sub: string;
    intro: string;
    cols: { source: string; value: string };
    rows: readonly PnlDocVatRow[];
    /** The sub-head over the rejected lines, or null when there are none. */
    rejectedHead: string | null;
    rejected: readonly PnlDocVatRow[];
    notes: readonly string[];
  };

  footer: readonly string[];
};

/**
 * Join the parts of a note that the screen splits at a `<strong>`.
 *
 * The kit has no `<strong>` primitive and must not grow one: emphasis inside a
 * sentence is a screen device, and the sheet's register carries no bold body
 * text anywhere. The WORDS are every word the screen prints, in the screen's
 * order, with the screen's own JSX spacing.
 *
 * A part that OPENS with punctuation is a continuation of the part before it,
 * not a new word after it, so the separator is read off the string rather than
 * assumed — the same rule `metaPair` applies to a meta tail.
 *
 * A SECOND COPY, and lib/docvm/cost.ts holds the first. Left as two on purpose:
 * that sheet is signed off and rendering, and hoisting a private helper out of
 * it is a refactor of a verified printable — same bytes if done right, a silent
 * change to a live document if done wrong. lib/docs/reportSheet.ts declines the
 * identical hoist for lib/docs/breakdown.ts's measures, for the identical
 * reason. If a third sheet needs it, that is the change that earns the move.
 */
function joinNote(parts: readonly string[]): string {
  return parts.reduce((acc, p) => acc + (/^[,.;:!?)\]]/.test(p) ? "" : " ") + p);
}

export function buildPnlVm(input: PnlDocInput): PnlDocVm {
  const { lang, current, prior } = input;

  /**
   * MONEY CARRIES ITS UNIT ON EVERY CELL HERE, WHICH NO OTHER SHEET IN THE PACK
   * DOES, AND THE COLUMN IS WHY.
   *
   * Elsewhere a figure column is entirely one currency, so the unit is hoisted
   * to the column head and repeating "SAR" on each cell is noise — that is
   * `num2`'s own reasoning in lib/docPrimitives.ts. This table cannot hoist it.
   * Its heads are PERIOD LABELS ("Jun 2026"), which have no room for a unit that
   * would then be false for two of their rows anyway: operating margin prints a
   * percentage and its variance prints points, in the same columns as the money.
   * A "SAR" over a column containing "12.3%" states a wrong unit over a figure,
   * which is worse than stating the right one eighteen times.
   *
   * So the unit rides the cell, which is also exactly what the screen does —
   * every money figure on it goes through `formatSar`, whose " SAR" is
   * hard-coded in both languages (see DOC_SAR for why it is not translated).
   *
   * TWO DECIMALS WHERE THE SCREEN SHOWS NONE. `formatSar` rounds to whole
   * riyals; `num2` is the pack's convention and every shipped sheet already
   * diverges from its screen this way. Kept for consistency across the pack
   * rather than matched to this one screen: it is the same quantity at finer
   * precision, not a different one, and a statement that foots to the halala is
   * the more defensible artefact to file.
   */
  const money = (n: number) => `${num2(n)} ${DOC_SAR}`;

  const generated = formatDateLang(input.generatedAt, lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // Same single expression the screen uses — the indicative figure has exactly
  // one definition and this is not a second one. Both sides come from the same
  // function, so the variance column compares like with like.
  const zakat = indicativeZakat(current.net_profit_sar);
  const priorZakat = prior ? indicativeZakat(prior.net_profit_sar) : null;

  /**
   * One statement line and its variance, mirroring `Line`.
   *
   * `delta` is the same helper the screen's cells call, so this file cannot
   * disagree with the screen about a movement. `higherIsBetter` is absent and
   * that is not an omission — it decides a COLOUR and nothing else, and the
   * header of this file says what becomes of it.
   */
  const line = (
    label: string,
    cur: number,
    pri: number | undefined,
    opts?: { indent?: boolean; rule?: boolean; strong?: boolean; flag?: string },
  ): PnlDocLine => {
    const hasPrior = pri !== undefined;
    const d = hasPrior ? delta(cur, pri) : null;
    return {
      kind: "line",
      label,
      values: [
        money(cur),
        hasPrior ? money(pri) : DASH,
        // The sign is written for a RISE only; a fall carries its own minus.
        // `formatPct` already answers an incomputable percentage with a dash.
        d ? `${d.abs > 0 ? "+" : ""}${money(d.abs)}` : DASH,
        d ? formatPct(d.pct) : DASH,
      ],
      ...opts,
    };
  };

  // MARGIN IS THE ONE NON-SAR LINE and its variance is POINTS, not a percentage
  // of a percentage. The last cell is a dash for the reason the screen gives:
  // a percent change on a percentage would not mean anything.
  const marginPoints =
    current.operating_margin_pct !== null && prior?.operating_margin_pct != null
      ? current.operating_margin_pct - prior.operating_margin_pct
      : null;

  const vatRow = (
    labelKey: TKey,
    family: "hintSales" | "hintOrders" | "hintReceipts" | "hintRepairs",
    v: PnlVatLine,
    indent?: boolean,
  ): PnlDocVatRow => ({
    label: t(labelKey, lang),
    // FOUR FAMILIES FOR SIX ROWS: the two rejected lines count the same document
    // kinds as the two they sit under, so they read the same family rather than
    // minting a duplicate that could drift. `n` stays RAW — these counts were
    // never run through formatNum, and routing them through one now would put a
    // thousands separator into a sentence that never had one.
    hint: fill(t(`reports.vat.${family}.${plural(v.count)}`, lang), { n: v.count }),
    value: money(v.total),
    ...(indent ? { indent } : {}),
  });

  const hasRejected = input.vat.orderedRejected.count > 0 || input.vat.receivedRejected.count > 0;

  return {
    lang,
    rtl: lang === "ar",
    docTitle: fill(t("reports.doc.pnl.docTitle", lang), { p: input.label }),

    masthead: {
      eyebrow: DOC_COMPANY,
      title: t("reports.pnl.title", lang),
      // The screen's own subtitle line: the period, then the comparison tail
      // when there is one. The space before the tail is the separator JSX keeps
      // on the same line as the fragment tag; it is not part of either value.
      subtitle: input.priorLabel
        ? `${input.label} ${fill(t("reports.pnl.comparedWith", lang), { p: input.priorLabel })}`
        : input.label,
      meta: [[docGeneratedMeta(lang, generated)]],
      // NET PROFIT, SIGNED, and not operating profit: this statement runs past
      // the operating line to expenses and arrives here. Everything below it on
      // the sheet is an estimate, which is what its own label says.
      figure: {
        caption: t("reports.metric.netProfit", lang),
        value: num2(current.net_profit_sar),
        unit: t("reports.doc.figureUnit", lang),
      },
    },

    warn: input.inProgress ? t("reports.pnl.inProgress", lang) : null,

    // THE SAME FOUR THE NARRATIVE SHEET CARRIES, off the same P&L row and the
    // same dictionary leaves. A second spelling of "Operating profit" is exactly
    // the drift the metric namespace exists to stop, and two sheets built from
    // one row must not disagree about what that row is called.
    stats: [
      { label: t("reports.metric.revenue", lang), value: money(current.revenue_sar) },
      { label: t("reports.metric.operatingCost", lang), value: money(current.operating_cost_sar) },
      {
        label: t("reports.metric.operatingProfit", lang),
        value: money(current.operating_profit_sar),
      },
      // An em dash where the ratio is incomputable, in the slot meant for that
      // claim: a faint 0.0% would read as a measured zero margin, which is the
      // opposite of "there was no revenue to take a margin of".
      current.operating_margin_pct === null
        ? { label: t("common.margin", lang), absent: DASH }
        : {
            label: t("common.margin", lang),
            value: formatShare(current.operating_margin_pct),
          },
    ],

    statement: {
      cols: [
        "",
        input.label,
        // The em dash the screen's `<th>` renders when there is no prior period,
        // kept rather than blanked: an empty heading over three empty columns
        // reads as a broken sheet, a dash reads as "there was nothing to
        // compare".
        input.priorLabel ?? DASH,
        t("reports.th.variance", lang),
        // A bare symbol, left as one. "%" is not English.
        "%",
      ],

      lines: [
        // Five of these labels come from reports.metric.* rather than a pnl.*
        // leaf of their own — Revenue, Payroll, Commissions, Operating profit
        // and Operating margin say exactly what the dictionary already says.
        line(t("reports.metric.revenue", lang), current.revenue_sar, prior?.revenue_sar, {
          strong: true,
        }),

        { kind: "head", text: t("reports.pnl.headCostOfOps", lang) },
        line(t("reports.pnl.lineParts", lang), current.parts_cost_sar, prior?.parts_cost_sar, {
          indent: true,
        }),
        line(t("reports.pnl.lineOs", lang), current.os_cost_sar, prior?.os_cost_sar, {
          indent: true,
        }),
        line(t("reports.metric.payroll", lang), current.payroll_sar, prior?.payroll_sar, {
          indent: true,
        }),
        line(t("reports.metric.commissions", lang), current.commissions_sar, prior?.commissions_sar, {
          indent: true,
        }),
        // The FIFTH bucket (0112/0113). Without it the four above do not add up
        // to the total below — the gap was exactly this.
        line(t("reports.pnl.lineFilling", lang), current.filling_cost_sar, prior?.filling_cost_sar, {
          indent: true,
        }),
        line(
          t("reports.pnl.lineOperatingCost", lang),
          current.operating_cost_sar,
          prior?.operating_cost_sar,
          { strong: true, rule: true },
        ),

        // ATTACHED TO THE TOTAL IT QUALIFIES, not moved to the foot of the
        // sheet: this sentence is the reason that total is not the whole cost,
        // and a caveat that loses its line stops being a caveat.
        ...(current.filling_uncosted_trips > 0
          ? [
              {
                kind: "note" as const,
                text: fill(
                  t(`reports.pnl.uncosted.${plural(current.filling_uncosted_trips)}`, lang),
                  { n: current.filling_uncosted_trips },
                ),
                flag: t("reports.th.uncosted", lang),
              },
            ]
          : []),

        line(
          t("reports.metric.operatingProfit", lang),
          current.operating_profit_sar,
          prior?.operating_profit_sar,
          { strong: true, rule: true },
        ),
        {
          kind: "line",
          label: t("reports.metric.operatingMargin", lang),
          values: [
            formatShare(current.operating_margin_pct),
            formatShare(prior?.operating_margin_pct ?? null),
            // The SIGN and the FIGURE stay Latin — `{v}` carries both, and only
            // the unit word is translated.
            marginPoints === null
              ? DASH
              : fill(t("reports.pnl.pts", lang), {
                  v: `${marginPoints > 0 ? "+" : ""}${marginPoints.toFixed(1)}`,
                }),
            DASH,
          ],
          indent: true,
        },

        // Expenses are their OWN section, never folded into the operational
        // buckets. That separation is a rule from 0098, not a layout preference.
        { kind: "head", text: t("reports.pnl.headOtherExpenses", lang) },
        ...(input.categories.length === 0
          ? [{ kind: "note" as const, text: t("reports.pnl.noExpenses", lang) }]
          : input.categories.map(
              (c): PnlDocLine => ({
                kind: "line",
                // USER DATA, rendered in whatever language it was typed in.
                label: c.category,
                // No prior column: the category breakdown is only ever fetched
                // for the selected period, so the screen prints three dashes
                // rather than a comparison it does not have.
                values: [money(c.expenses_sar), DASH, DASH, DASH],
                indent: true,
              }),
            )),
        line(t("reports.pnl.lineExpenses", lang), current.expenses_sar, prior?.expenses_sar, {
          strong: true,
          rule: true,
        }),

        line(t("reports.pnl.lineNetProfit", lang), current.net_profit_sar, prior?.net_profit_sar, {
          strong: true,
          rule: true,
        }),

        // ZAKAT. NO INCOME-TAX LINE BELONGS HERE OR ANYWHERE ON THIS SHEET:
        // Saudi corporate income tax applies to foreign or mixed ownership, and
        // Bin Slimah Group is 100% Saudi-owned.
        { kind: "head", text: t("reports.pnl.headZakat", lang) },
        line(t("reports.pnl.lineZakat", lang), zakat.estimate, priorZakat?.estimate, {
          indent: true,
          flag: t("reports.doc.pnl.estimate", lang),
        }),
        // NOT `strong`, matching the screen: `estimate` beats `bold` there
        // through twMerge, so this line is ruled but never weighted.
        line(
          t("reports.pnl.lineAfterZakat", lang),
          zakat.profitAfterZakat,
          priorZakat?.profitAfterZakat,
          { rule: true, flag: t("reports.doc.pnl.estimate", lang) },
        ),
        {
          kind: "note",
          // THE CAVEAT IS PART OF THE FIGURE — the space between the two
          // sentences is the separator JSX keeps, not part of either value.
          text: zakat.applies
            ? t("reports.pnl.zakatNote", lang)
            : joinNote([t("reports.pnl.zakatNote", lang), t("reports.pnl.zakatLoss", lang)]),
        },
      ],

      footer: t("reports.pnl.footer", lang),
    },

    vat: {
      head: t("reports.vat.title", lang),
      sub: input.label,
      intro: t("reports.vat.intro", lang),
      cols: {
        source: t("reports.th.source", lang),
        // `mt.vat` — the money vocabulary was already keyed, so this heading
        // reads it rather than minting a second spelling of one word.
        value: t("mt.vat", lang),
      },
      // Flat and unweighted on purpose — no bold line, no grouping head. Any of
      // those would rank one source above another, and the point of the list is
      // that they are four separate facts, not a hierarchy resolving to a
      // figure. There is no total row and there must not be.
      rows: [
        vatRow("reports.vat.rowSales", "hintSales", input.vat.sales),
        vatRow("reports.vat.rowOrdered", "hintOrders", input.vat.ordered),
        vatRow("reports.vat.rowReceived", "hintReceipts", input.vat.received),
        vatRow("reports.vat.rowRepairs", "hintRepairs", input.vat.repairs),
      ],
      // Hidden entirely when there are none: an empty "Rejected" heading reads
      // as a fault. Rejected documents are never subtracted from the lines
      // above — this list nets nothing, including against itself.
      rejectedHead: hasRejected ? t("reports.vat.rejectedHead", lang) : null,
      rejected: [
        ...(input.vat.orderedRejected.count > 0
          ? [vatRow("reports.vat.rowOrderedRejected", "hintOrders", input.vat.orderedRejected, true)]
          : []),
        ...(input.vat.receivedRejected.count > 0
          ? [
              vatRow(
                "reports.vat.rowReceivedRejected",
                "hintReceipts",
                input.vat.receivedRejected,
                true,
              ),
            ]
          : []),
      ],
      // FOUR FOOTNOTES, THREE SHAPES OF SPLIT — two opening with a bolded
      // complete sentence, one whole, one emphasised mid-sentence. Every one of
      // them keeps every word in the screen's order; only the bold is dropped.
      notes: [
        joinNote([t("reports.vat.note1Bold", lang), t("reports.vat.note1", lang)]),
        joinNote([t("reports.vat.note2Bold", lang), t("reports.vat.note2", lang)]),
        t("reports.vat.note3", lang),
        joinNote([
          t("reports.vat.note4Before", lang),
          t("reports.vat.note4Strong", lang),
          t("reports.vat.note4After", lang),
        ]),
      ],
    },

    footer: [fill(t("reports.print.generated", lang), { d: generated }), DOC_COMPANY],
  };
}
