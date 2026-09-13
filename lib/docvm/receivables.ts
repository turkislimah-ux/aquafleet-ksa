// RECEIVABLES STATEMENT VIEW-MODEL — what the printed receivables sheet says,
// in what order, and in which words.
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING may
//   not.
//
// The source of truth is app/reports/StatementViews.tsx, ReceivablesStatement.
// Every label below resolves through `t()` from the SAME KEY that component
// passes, so a reword lands on both surfaces or on neither.
//
// A POSITION, NOT A PERIOD. Every other statement in the pack measures a range;
// this one states what is outstanding right now. That is why the line under the
// title reads "As of today" where the others print a month, and why the sheet
// carries no period anywhere else.
//
// IT TAKES ROWS, NOT RAW INVOICES — the band summary and the days-descending
// order are both `useMemo`s inside the component, no file in lib/ may import
// from @/app/, and re-implementing either here would be a SECOND expression of
// it. `bands`, `total` and `rows` arrive exactly as the tables render them.
//
// THE ONE THING IT DOES COMPUTE is each band's share of the total, and only
// because the screen computes it inline in JSX where nothing can be handed over.
// Both sides divide the same two figures this file already receives and both
// print the result through `formatShare` — the screen's own helper, imported
// here rather than restated, so the FORMAT (where a drift would actually show)
// has one expression.
//
// Purity: no React, no fs, no Supabase, no `process`, no `new Date()` —
// `generatedAt` is passed in, so the same input always renders the same sheet.

import { DASH, num2, numPlain } from "../docPrimitives";
import { fill, t, type Lang } from "../i18n";
import { formatShare } from "../reports";
import { formatDateLang } from "../utils";
import { DOC_COMPANY, DOC_SAR, docGeneratedMeta } from "./reportDoc";

// ---------------------------------------------------------------------------
// Input — the rows the statement already summarised and sorted
// ---------------------------------------------------------------------------

/** One aging band, in AGING_ORDER, exactly as the component assembled it. */
export type ReceivablesDocBand = {
  /** The view's own label — "0-30", "90+". Digits and punctuation only. */
  bucket: string;
  outstanding: number;
  count: number;
};

/** One open invoice, already sorted days-descending by the component. */
export type ReceivablesDocInvoice = {
  invoiceNumber: string | null;
  customer: string;
  /** `confirmed_at` already sliced to its date — the time of day is not what
   *  this column reports, and the screen does not print it. */
  confirmed: string;
  days: number;
  outstanding: number;
};

export type ReceivablesDocInput = {
  lang: Lang;
  generatedAt: Date;
  bands: readonly ReceivablesDocBand[];
  /** Sum of `bands[].outstanding`, as the screen computed it. */
  total: number;
  rows: readonly ReceivablesDocInvoice[];
};

// ---------------------------------------------------------------------------
// Output — one worded object per ATLAS block
// ---------------------------------------------------------------------------

/** Mirrors lib/atlas/blocks.ts's `Stat`. */
export type DocStat = { label: string; value?: string; unit?: string; absent?: string };

export type ReceivablesDocVm = {
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

  aging: {
    cols: { band: string; invoices: string; outstanding: string; share: string };
    rows: readonly { band: string; count: string; outstanding: string; share: string }[];
    foot: { label: string; count: string; outstanding: string; share: string };
  };

  open: {
    head: string;
    cols: { invoice: string; customer: string; confirmed: string; days: string; outstanding: string };
    rows: readonly {
      invoice: string;
      customer: string;
      confirmed: string;
      days: string;
      outstanding: string;
      /** The severity word, or undefined where the screen colours nothing. */
      flag?: string;
    }[];
  };

  // NO BAR ON THIS SHEET. There was one — a four-band split bar under the aging
  // table — and it was removed rather than repaired.
  //
  // THE KIT'S SPLIT BAR IS A TWO-PART DEVICE and does not survive being asked
  // for four. It carries one ink, so four bands butt against each other with no
  // visible boundary and a clipped band name runs straight into the next band's
  // figure; and a block too narrow to hold its own label can only float above
  // the bar, which two adjacent narrow bands cannot both do without printing
  // through each other. The kit's answer to that collision is to print NO label,
  // so on a real aging profile the two smallest bands went unnamed.
  //
  // A bar whose small bands are unlabelled and whose large ones run their names
  // into their neighbours is not a weaker version of the aging table above it —
  // it is a second, worse statement of the same four numbers. The TABLE already
  // gives every band its name, count, amount and share, exactly. Turki's ruling,
  // 2026-09-13: drop the bar, keep the table.
  //
  // `splitBar` itself stays — revenue's clean two-way split and the breakdown's
  // delivered/scheduled bar are what it was built for, and both still read.
  // Four-way grayscale is the shape it cannot do.

  /** Printed INSTEAD of everything above when nothing is outstanding — the
   *  screen drops both tables, so the renderer must too. */
  empty: string;
  has: boolean;

  note: string;
  footer: readonly string[];
};

export function buildReceivablesVm(input: ReceivablesDocInput): ReceivablesDocVm {
  const { lang, total } = input;
  const money = (n: number) => num2(n);
  const count = (n: number) => numPlain(n);
  const generated = formatDateLang(input.generatedAt, lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const outstandingLabel = t("reports.th.outstanding", lang);
  const bandLabel = (bucket: string) =>
    fill(t("reports.receivables.bandDays", lang), { b: bucket });
  const share = (n: number) => formatShare(total > 0 ? (n / total) * 100 : null);

  // THE SEVERITY WORDS. On screen the day count turns amber past 60 and rose
  // past 90 and says nothing else — the number alone carries no marker, which
  // lib/atlas/shell.ts names as one of the five reports encoding meaning in hue
  // alone. On paper the hue is gone, so the claim is made in the one encoding a
  // monochrome sheet can carry. Two levels, two words: the kit does not rank
  // severities and must not start.
  const flagFor = (days: number): string | undefined =>
    days > 90
      ? t("reports.doc.receivables.overdue", lang)
      : days > 60
        ? t("reports.doc.receivables.ageing", lang)
        : undefined;

  return {
    lang,
    rtl: lang === "ar",
    docTitle: t("reports.doc.receivables.docTitle", lang),

    masthead: {
      eyebrow: DOC_COMPANY,
      title: t("reports.receivables.title", lang),
      // Where every other sheet prints its period. NOT in the figure's unit
      // slot: that slot spells out the CURRENCY, and a money total printed with
      // no currency beside it to make room for a date is a worse sheet.
      subtitle: t("reports.receivables.asOfToday", lang),
      meta: [[docGeneratedMeta(lang, generated)]],
      figure: {
        caption: outstandingLabel,
        value: money(total),
        unit: t("reports.doc.figureUnit", lang),
      },
    },

    // THE FOUR BANDS, not four invented metrics. This sheet's headline figure is
    // one number and its own summary table is the breakdown of it, so the strip
    // states the same four figures the reader is about to see ranked.
    //
    // A STAT STRIP RATHER THAN THE WINDOWS BLOCK, which is what an earlier
    // sketch called for: `windows()` has no unit slot, so "12,400.00" under
    // "0-30 days" reads as a COUNT OF INVOICES — the very number sitting in the
    // next column of the table below. Same hairline grammar either way; only
    // this one can say SAR.
    stats: input.bands.map((b) => ({
      label: bandLabel(b.bucket),
      // An em dash where the screen shows one. A 0.00 here is a measured zero;
      // the screen is saying the opposite — that this band holds nothing at all.
      ...(b.outstanding === 0
        ? { absent: DASH }
        : { value: money(b.outstanding), unit: DOC_SAR }),
    })),

    aging: {
      cols: {
        band: t("reports.th.band", lang),
        invoices: t("reports.th.invoices", lang),
        outstanding: outstandingLabel,
        share: t("reports.th.share", lang),
      },
      rows: input.bands.map((b) => ({
        band: bandLabel(b.bucket),
        count: count(b.count),
        outstanding: b.outstanding === 0 ? DASH : money(b.outstanding),
        share: share(b.outstanding),
      })),
      foot: {
        label: t("reports.th.total", lang),
        count: count(input.bands.reduce((a, b) => a + b.count, 0)),
        outstanding: money(total),
        // NOT KEYED, and not computed either — the screen writes this constant
        // for the reason its own comment gives: band shares always total 100%,
        // so this is a figure written as a literal, not a sentence. It matches
        // formatShare()'s output and stays Latin in both languages like every
        // other number on the sheet.
        share: "100.0%",
      },
    },

    open: {
      head: t("reports.receivables.openInvoices", lang),
      cols: {
        invoice: t("reports.th.invoice", lang),
        customer: t("reports.th.customer", lang),
        confirmed: t("reports.th.confirmed", lang),
        days: t("reports.th.days", lang),
        outstanding: outstandingLabel,
      },
      rows: input.rows.map((r) => ({
        invoice: r.invoiceNumber ?? DASH,
        customer: r.customer,
        confirmed: r.confirmed,
        days: count(r.days),
        outstanding: money(r.outstanding),
        flag: flagFor(r.days),
      })),
    },

    empty: t("reports.nothingOutstanding", lang),
    has: total > 0,

    note: t("reports.receivables.note", lang),
    footer: [fill(t("reports.print.generated", lang), { d: generated }), DOC_COMPANY],
  };
}
