// REVENUE STATEMENT VIEW-MODEL — the one place that decides WHAT the printed
// revenue statement says, in WHAT order, and in WHICH words.
//
// Same law as the three documents before it:
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING may
//   not.
//
// The on-screen statement (app/reports/StatementViews.tsx, RevenueStatement) is
// the SOURCE OF TRUTH. Every label below is resolved through `t()` from the SAME
// KEY that component passes, so a reword lands on both surfaces or on neither.
// lib/docs/revenue.ts — the renderer — writes no word and formats no number.
//
// IT TAKES ROWS, NOT RAW INVOICES, for the reason lib/docvm/breakdown.ts gives
// at length: the by-customer grouping is a `useMemo` inside the component, no
// file in lib/ may import from @/app/, and re-implementing the grouping here
// would be a SECOND expression of it. One computation, zero drift by
// construction. `rows` and `totals` arrive exactly as the table renders them.
//
// IT PRE-FORMATS ITS MONEY, and for the same reason: it feeds exactly one
// renderer of exactly one medium in one language at a time. What a CHART PLOTS
// stays numeric — a chart maps a measured value to a geometry, so handing it a
// formatted string would mean parsing it back.
//
// Purity: no React, no fs, no Supabase, no `process`, no `new Date()` —
// `generatedAt` is passed in, so the same input always renders the same sheet.

import { DASH, num2, numPlain } from "../docPrimitives";
import { fill, t, type Lang } from "../i18n";
import { formatDateLang } from "../utils";
import { DOC_COMPANY, DOC_SAR, docGeneratedMeta } from "./reportDoc";

// ---------------------------------------------------------------------------
// Input — the rows the statement already grouped
// ---------------------------------------------------------------------------

/** One customer's line, exactly as the on-screen memo produced it. */
export type RevenueDocCustomerRow = {
  name: string;
  count: number;
  revenue: number;
  paid: number;
  outstanding: number;
};

/** One sales return, already filtered to the period by the component. */
export type RevenueDocReturnRow = {
  invoiceNumber: string | null;
  reason: string | null;
  reversed: number;
};

export type RevenueDocInput = {
  lang: Lang;
  generatedAt: Date;
  /** The period label the screen prints under the title, already composed. */
  label: string;
  rows: readonly RevenueDocCustomerRow[];
  totals: { revenue: number; paid: number; outstanding: number };
  /** Sum of `rows[].count` — the figure the screen's totals row prints, not a
   *  re-count of the source invoices. */
  invoiceCount: number;
  returns: readonly RevenueDocReturnRow[];
  returnedTotal: number;
};

// ---------------------------------------------------------------------------
// Output — one worded object per ATLAS block
// ---------------------------------------------------------------------------

/** Mirrors lib/atlas/blocks.ts's `Stat`. */
export type DocStat = { label: string; value?: string; unit?: string; absent?: string };

export type RevenueDocVm = {
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

  stats: readonly DocStat[];

  byCustomer: {
    cols: { customer: string; invoices: string; revenue: string; paid: string; outstanding: string };
    rows: readonly {
      name: string;
      count: string;
      revenue: string;
      paid: string;
      outstanding: string;
    }[];
    foot: { label: string; count: string; revenue: string; paid: string; outstanding: string };
    /** Printed INSTEAD of the table when no invoice was confirmed — the screen
     *  drops the head too, so the renderer must not keep one. */
    empty: string;
  };

  /** The split bar. `value` is plotted, `display` is printed. */
  bar: {
    parts: readonly { label: string; value: number; display: string; hatch?: boolean }[];
    total: string;
    footnote: string;
    aria: string;
    empty: string;
    has: boolean;
  };

  returns: {
    head: string;
    cols: { invoice: string; reason: string; reversed: string };
    rows: readonly { invoice: string; reason: string; reversed: string }[];
    foot: { label: string; total: string };
    empty: string;
  };

  note: string;
  footer: readonly string[];
};

export function buildRevenueVm(input: RevenueDocInput): RevenueDocVm {
  const { lang } = input;
  const money = (n: number) => num2(n);
  const count = (n: number) => numPlain(n);
  const generated = formatDateLang(input.generatedAt, lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const paidLabel = t("reports.th.paid", lang);
  const outstandingLabel = t("reports.th.outstanding", lang);
  // The bar's whole. NOT revenue — see reports.doc.revenue.barTotal, where the
  // reason is written out. The screen's own note (reports.revenue.note, printed
  // at the foot of this sheet unchanged) says the same thing in prose.
  const barWhole = input.totals.paid + input.totals.outstanding;

  return {
    lang,
    rtl: lang === "ar",
    docTitle: fill(t("reports.doc.revenue.docTitle", lang), { p: input.label }),

    masthead: {
      eyebrow: DOC_COMPANY,
      title: t("reports.revenue.title", lang),
      subtitle: input.label,
      meta: [[docGeneratedMeta(lang, generated)]],
      figure: {
        caption: t("reports.metric.revenue", lang),
        value: money(input.totals.revenue),
        unit: t("reports.doc.figureUnit", lang),
      },
    },

    stats: [
      { label: t("reports.metric.revenue", lang), value: money(input.totals.revenue), unit: DOC_SAR },
      { label: t("reports.th.invoices", lang), value: count(input.invoiceCount) },
      { label: paidLabel, value: money(input.totals.paid), unit: DOC_SAR },
      { label: outstandingLabel, value: money(input.totals.outstanding), unit: DOC_SAR },
    ],

    byCustomer: {
      cols: {
        customer: t("reports.th.customer", lang),
        invoices: t("reports.th.invoices", lang),
        revenue: t("reports.metric.revenue", lang),
        paid: paidLabel,
        outstanding: outstandingLabel,
      },
      rows: input.rows.map((r) => ({
        name: r.name,
        count: count(r.count),
        revenue: money(r.revenue),
        // An em dash where the screen shows one. A 0.00 in a money column is a
        // measured zero; the screen is saying the opposite — that this customer
        // has nothing on that side at all.
        paid: r.paid === 0 ? DASH : money(r.paid),
        outstanding: r.outstanding === 0 ? DASH : money(r.outstanding),
      })),
      foot: {
        label: t("reports.th.total", lang),
        count: count(input.invoiceCount),
        revenue: money(input.totals.revenue),
        paid: money(input.totals.paid),
        outstanding: money(input.totals.outstanding),
      },
      empty: t("reports.revenue.empty", lang),
    },

    bar: {
      parts: [
        { label: paidLabel, value: input.totals.paid, display: money(input.totals.paid) },
        {
          label: outstandingLabel,
          value: input.totals.outstanding,
          display: money(input.totals.outstanding),
          // Hatched, by the kit's own grammar: solid is what HAPPENED, hatched
          // is what has not. Money still owed has not been collected.
          hatch: true,
        },
      ],
      total: fill(t("reports.doc.revenue.barTotal", lang), { n: `${money(barWhole)} ${DOC_SAR}` }),
      footnote: t("reports.doc.revenue.barFootnote", lang),
      aria: t("reports.doc.revenue.barAria", lang),
      empty: t("reports.doc.revenue.barEmpty", lang),
      has: barWhole > 0,
    },

    returns: {
      head: t("reports.revenue.returnsHead", lang),
      cols: {
        invoice: t("reports.th.invoice", lang),
        reason: t("reports.th.reason", lang),
        reversed: t("reports.th.reversed", lang),
      },
      rows: input.returns.map((r) => ({
        invoice: r.invoiceNumber ?? DASH,
        reason: r.reason ?? DASH,
        reversed: money(r.reversed),
      })),
      foot: {
        label: t("reports.revenue.totalReversed", lang),
        total: money(input.returnedTotal),
      },
      empty: t("reports.revenue.noneInPeriod", lang),
    },

    note: t("reports.revenue.note", lang),
    footer: [fill(t("reports.print.generated", lang), { d: generated }), DOC_COMPANY],
  };
}
