// BREAKDOWN DOCUMENT VIEW-MODEL — the one place that decides WHAT the printed
// project breakdown says, in WHAT order, and in WHICH words.
//
// Same law as lib/invoiceViewModel.ts and lib/statementViewModel.ts, applied to
// the third document:
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING may
//   not.
//
// The on-screen report (app/trips/BreakdownReport.tsx) is the SOURCE OF TRUTH.
// Every figure below is the expression that component already had, and every
// label is resolved through `t()` from the SAME KEY the component passes. A
// wording change lands on both surfaces or on neither. lib/docs/breakdown.ts —
// the renderer — writes no word and formats no number.
//
// TWO DELIBERATE DEVIATIONS FROM THE OTHER TWO VIEW-MODELS. Both are stated
// here because each looks like a mistake against those files:
//
// 1. IT TAKES FIGURES, NOT ROWS. invoiceViewModel and statementViewModel are
//    handed the raw payload and call the money engine themselves. This one is
//    handed numbers the component has ALREADY computed, because two of those
//    computations — computeAmountPayable() and buildDeliveriesReport() — live
//    under app/trips/, and no file in lib/ imports from @/app/ anywhere in this
//    tree. Re-implementing either here would create a SECOND expression of a
//    money rule, which is the exact failure the money-core boundary exists to
//    prevent; lifting them into lib/ is a refactor of a 1000-line component
//    that this document does not need. So: one computation (the screen's), zero
//    drift by construction. The cost is that this file cannot be tested without
//    a caller supplying figures — accepted, because the alternative is two
//    answers to "what is payable".
//
// 2. IT PRE-FORMATS ITS MONEY, and the other two forbid that. They forbid it
//    because they feed TWO renderers each (a screen and a document, or a PDF
//    and a print sheet) whose media round differently. This one feeds EXACTLY
//    ONE renderer, of exactly one medium, in one language at a time — ATLAS is
//    one document, one language (lib/atlas/shell.ts) — so "format once per
//    medium" and "format here" are the same instruction. Formatting here is
//    what keeps every number-to-string decision out of the renderer, which is
//    the boundary the kit is built on.
//
//    EXCEPT WHAT A CHART PLOTS. `trend`, `daily` and the split-bar values stay
//    NUMERIC: a chart maps a measured value to a geometry, so handing it a
//    formatted string would mean parsing it back. The figures a chart PRINTS
//    (its total, its part displays) are pre-formatted like everything else.
//
// Purity: no React, no fs, no Supabase, no `process`, and no `new Date()` —
// `generatedAt` is passed in, so this function is a pure mapping and the same
// input always renders the same sheet.

import { type InvoicePaymentMethod, type PaymentMode, type WaterType } from "../db-types";
import { DASH, num2, numPlain } from "../docPrimitives";
import { paymentMethodLabel, paymentModeLabel, waterTypeLabel } from "../enum-labels";
import { fill, t, type Lang } from "../i18n";
import { formatDateLang, formatDayKeyLang, monthLabel } from "../utils";

// ---------------------------------------------------------------------------
// Input — the figures the report already computed
// ---------------------------------------------------------------------------

/** Rolling-window key. Declared here rather than imported from
 *  app/trips/DeliveriesReportBand so nothing in lib/ points at app/ — the four
 *  keys are also the four `trips.deliveries.*` dictionary leaves, so a drift
 *  between the two lists fails at the `t()` call rather than silently. */
export type BreakdownWindowKey = "today" | "d7" | "d30" | "d90";

/** One row of either driver table. `name` arrives RESOLVED, including the
 *  "Unassigned" / "Unknown driver" fallbacks: the component resolves them for
 *  the screen through the very keys this document would use, so taking its
 *  string is what makes the two identical. `unassigned` drives the LOOK only. */
export type BreakdownDriverRow = {
  key: string;
  name: string;
  unassigned: boolean;
  tripsDelivered: number;
  /** Commission or revenue, depending on which table this row is in. */
  amount: number;
};

export type BreakdownPaymentRow = {
  /** The plain date the screen prints — `payment_date ?? paid_at.slice(0,10)`,
   *  unformatted, exactly as the on-screen cell renders it. */
  date: string;
  invoiceNumber: string;
  method: InvoicePaymentMethod | null;
  reference: string | null;
  amount: number;
};

export type BreakdownDocInput = {
  lang: Lang;
  /** The "generated on" instant. PASSED IN, never read here — see the purity
   *  note in this file's header. */
  generatedAt: Date;

  project: { id: string; name: string; ratePerTripSar: number };
  paymentMode: PaymentMode | null;
  customerName: string;
  contactName: string | null;
  phone: string | null;

  /** "2026-08". Every {month} token on the sheet resolves from this one key. */
  monthKey: string;
  monthInProgress: boolean;

  /** Terms IN FORCE TODAY (v_project_commission_now), not a report figure.
   *  `typeLabel` is the composed display string the screen shows — "Fixed" or
   *  "Scalable +10%" — because the percentage is spliced into it there. */
  commission: {
    value: number | null;
    typeLabel: string | null;
    nextEffectiveFrom: string | null;
  };

  financial: {
    deliveredCount: number;
    revenue: number;
    commission: number;
    netMargin: number;
    /** null when no trip was delivered — a rate over zero trips is not zero. */
    avgRevenue: number | null;
  };

  operational: {
    totalCount: number;
    deliveredCount: number;
    notDelivered: number;
    /** 0..1, or null when nothing was scheduled. */
    completion: number | null;
  };

  payments: readonly BreakdownPaymentRow[];
  paymentsTotal: number;

  /** Sign IS the meaning: negative = owed to us, 0 = settled, positive =
   *  credit the customer holds, null = no payment mode set. */
  amountPayable: number | null;

  /** Six months ending at `monthKey`. `label` is the component's own compact
   *  axis tick ("Jun 26"); the two series stay numeric for the chart. */
  trend: readonly { label: string; revenue: number; trips: number }[];

  /** Trips per day, day 1 first. Capped at today for the current month. */
  daily: readonly number[];

  deliveries: readonly { key: BreakdownWindowKey; count: number; sar: number }[];

  /** Station NAMES (already resolved off the immutable key) — data, not
   *  wording. Water types arrive as ENUM VALUES and are labelled here. */
  stations: readonly string[];
  waterTypes: readonly WaterType[];

  commissionByDriver: readonly BreakdownDriverRow[];
  revenueByDriver: readonly BreakdownDriverRow[];
};

// ---------------------------------------------------------------------------
// Output — one worded object per ATLAS section
// ---------------------------------------------------------------------------
// Structurally assignable to the kit's own types where the shape matches
// (`DocStat` to blocks.ts's `Stat`), so the renderer hands them straight over
// instead of re-mapping field names.

/** Mirrors lib/atlas/blocks.ts's `Stat`. `absent` is set INSTEAD of `value`
 *  when the metric genuinely cannot be computed. */
export type DocStat = { label: string; value?: string; unit?: string; absent?: string };

export type DocMasthead = {
  eyebrow: string;
  referenceLabel: string;
  reference: string;
  title: string;
  customer: string;
  /** The month, carrying the in-progress qualifier the screen sets as a pill. */
  month: string;
  contactLabel: string;
  contact: string | null;
  phone: string | null;
  rateLabel: string;
  rate: string;
  ratePer: string;
  commissionLabel: string;
  commission: string;
  /** ", Fixed" — leading punctuation included; null when no mode is in force. */
  commissionTail: string | null;
  /** "Changes 1 Sep 2026", or null when no change is pending. */
  changes: string | null;
  termsLabel: string;
  terms: string | null;
  issuedLabel: string;
  issued: string;
  figureCaption: string;
  figure: string;
  figureUnit: string;
};

export type DocPaymentsTable = {
  head: string;
  sub: string;
  cols: { date: string; invoice: string; method: string; reference: string; amount: string };
  rows: readonly {
    date: string;
    invoice: string;
    method: string;
    reference: string;
    amount: string;
  }[];
  footLabel: string;
  footTotal: string;
  empty: string;
};

export type DocDriverTable = {
  label: string;
  cols: { driver: string; delivered: string; amount: string };
  rows: readonly { key: string; name: string; unassigned: boolean; delivered: string; amount: string }[];
  footLabel: string;
  footDelivered: string;
  footAmount: string;
  empty: string;
};

export type BreakdownDocVm = {
  lang: Lang;
  /** The charts mirror off this and the shell off its `dir`. One answer, two
   *  mechanisms, because an SVG has no logical properties to lean on. */
  rtl: boolean;
  /** The print dialog's name for the sheet. Never printed on it. */
  docTitle: string;

  masthead: DocMasthead;

  financial: { head: string; sub: string; stats: readonly DocStat[]; note: string };
  payments: DocPaymentsTable;
  payable: { head: string; sub: string; value: string; unit: string; note: string };
  trend: {
    head: string;
    sub: string;
    points: readonly { label: string; primary: number; secondary: number }[];
    seriesRevenue: string;
    seriesTrips: string;
    aria: string;
    note: string;
  };
  operational: {
    head: string;
    sub: string;
    stats: readonly DocStat[];
    /** The split bar. `value` is plotted, `display` is printed. */
    parts: readonly { label: string; value: number; display: string; hatch?: boolean }[];
    barTotal: string;
    barFootnote: string;
    barAria: string;
    /** Printed INSTEAD of the bar when nothing was scheduled — the same
     *  sentence the screen prints instead of its donut. A proportional bar over
     *  a total of zero is not an empty chart, it is a division by zero. */
    barEmpty: string;
    /** true when there is a proportion to draw at all. */
    hasBar: boolean;
  };
  deliveries: {
    head: string;
    sub: string;
    windows: readonly { label: string; count: string; sub: string }[];
    note: string;
  };
  daily: { head: string; sub: string; counts: readonly number[]; aria: string };
  sources: { head: string; sub: string; items: readonly { term: string; value: string }[] };
  byDriver: { head: string; sub: string; commission: DocDriverTable; revenue: DocDriverTable };
  /** Generated stamp + the company's own name. The name is a proper noun, not a
   *  dictionary leaf — the screen fences it with translate="no" for the same
   *  reason. */
  footer: readonly string[];
};

// The one literal in this file, and it is a NAME. Same string the on-screen
// footer prints inside its translate="no" span, and the same one the invoice
// footer carries.
const COMPANY = "Bin Slimah Group · Bousla";

export function buildBreakdownVm(input: BreakdownDocInput): BreakdownDocVm {
  const { lang } = input;
  const month = monthLabel(input.monthKey, lang, "short");
  const sarUnit = t("trips.breakdown.doc.sarUnit", lang);
  const listSep = t("trips.breakdown.doc.listSep", lang);
  // The same stamp the on-screen footer shows, from the same expression: a
  // DISPLAY render of the instant the sheet was produced. It appears three
  // times — the masthead's Issued pair, the payable note's "as at", and the
  // deliveries note's anchor — and all three read this one string, so no two
  // of them can disagree about when the sheet was made.
  const generated = formatDateLang(input.generatedAt, lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const money = (n: number) => num2(n);
  const count = (n: number) => numPlain(n);
  const withUnit = (n: number) => `${num2(n)} ${sarUnit}`;

  // --- Masthead ----------------------------------------------------------
  const hasCommissionMode = input.commission.typeLabel != null;

  const masthead: DocMasthead = {
    eyebrow: t("trips.breakdown.doc.eyebrow", lang),
    referenceLabel: t("trips.breakdown.colReference", lang),
    // The short id the screen prints beside the project name, hash included.
    reference: `#${input.project.id.slice(0, 8)}`,
    title: input.project.name,
    customer: input.customerName,
    month: input.monthInProgress
      ? `${month} · ${t("trips.breakdown.monthInProgress", lang)}`
      : month,
    contactLabel: t("trips.breakdown.doc.contact", lang),
    contact: input.contactName,
    phone: input.phone,
    rateLabel: t("common.rate", lang),
    rate: withUnit(input.project.ratePerTripSar),
    ratePer: t("trips.breakdown.doc.ratePer", lang),
    commissionLabel: t("trips.customers.colCommission", lang),
    // An em dash, never a zero: "0 SAR fixed" is a claim about the contract,
    // "—" is an admission we do not have it. Same call the screen makes.
    commission: hasCommissionMode ? withUnit(input.commission.value ?? 0) : DASH,
    commissionTail: hasCommissionMode
      ? fill(t("trips.breakdown.doc.commissionTail", lang), {
          type: input.commission.typeLabel ?? "",
        })
      : null,
    changes: input.commission.nextEffectiveFrom
      ? fill(t("trips.customers.changes", lang), {
          date: formatDayKeyLang(input.commission.nextEffectiveFrom, lang),
        })
      : null,
    termsLabel: t("trips.breakdown.doc.terms", lang),
    terms: input.paymentMode ? paymentModeLabel(input.paymentMode, lang) : null,
    issuedLabel: t("trips.breakdown.doc.issued", lang),
    issued: generated,
    figureCaption: fill(t("trips.breakdown.doc.figureCaption", lang), { month }),
    figure: money(input.financial.revenue),
    figureUnit: t("trips.breakdown.doc.figureUnit", lang),
  };

  // --- Financial ---------------------------------------------------------
  const financial = {
    head: t("trips.breakdown.doc.financialHead", lang),
    sub: month,
    stats: [
      {
        label: t("trips.breakdown.kTripsDelivered", lang),
        value: count(input.financial.deliveredCount),
      },
      { label: t("common.revenue", lang), value: money(input.financial.revenue), unit: sarUnit },
      {
        label: t("trips.breakdown.kCommissionPaid", lang),
        value: money(input.financial.commission),
        unit: sarUnit,
      },
      {
        label: t("trips.breakdown.kNetMargin", lang),
        value: money(input.financial.netMargin),
        unit: sarUnit,
      },
      // An average over zero delivered trips is NOT zero. The screen prints an
      // em dash; `absent` is the kit's slot for exactly that, and it renders
      // the dash where a faint 0.00 would have read as a measurement.
      input.financial.avgRevenue == null
        ? { label: t("trips.breakdown.kAvgRevenue", lang), absent: DASH }
        : {
            label: t("trips.breakdown.kAvgRevenue", lang),
            value: money(input.financial.avgRevenue),
            unit: sarUnit,
          },
    ] as const satisfies readonly DocStat[],
    note: t("trips.breakdown.doc.financialNote", lang),
  };

  // --- Payments received -------------------------------------------------
  const payments: DocPaymentsTable = {
    head: t("trips.breakdown.doc.paymentsHead", lang),
    sub: t("trips.breakdown.doc.paymentsSub", lang),
    cols: {
      date: t("common.date", lang),
      invoice: t("trips.breakdown.colInvoice", lang),
      method: t("trips.finance.colMethod", lang),
      reference: t("trips.breakdown.colReference", lang),
      amount: t("trips.breakdown.doc.colAmountSar", lang),
    },
    rows: input.payments.map((p) => ({
      date: p.date,
      invoice: p.invoiceNumber,
      // Both are NULLABLE on the row — a legacy paid invoice predates 0039's
      // method capture — and the screen prints an em dash for each.
      method: p.method ? paymentMethodLabel(p.method, lang) : DASH,
      reference: p.reference || DASH,
      amount: money(p.amount),
    })),
    footLabel: fill(t("trips.breakdown.doc.receivedIn", lang), { month }),
    footTotal: money(input.paymentsTotal),
    empty: t("trips.breakdown.noPayments", lang),
  };

  // --- Amount payable ----------------------------------------------------
  // Discriminates on the SIGN of the number, never on a label — the same three
  // readings the screen prints under its figure, ahead of the scope sentence
  // that says why this box is not a figure for the month above it.
  const payableSign =
    input.amountPayable == null
      ? t("trips.breakdown.payableNoMode", lang)
      : input.amountPayable < 0
        ? t("trips.breakdown.payableOwed", lang)
        : input.amountPayable > 0
          ? t("trips.breakdown.payableCredit", lang)
          : t("trips.breakdown.payableSettled", lang);
  const payable = {
    head: t("trips.breakdown.payable", lang),
    sub: t("trips.breakdown.doc.payableSub", lang),
    value: input.amountPayable == null ? DASH : money(input.amountPayable),
    unit: input.amountPayable == null ? "" : sarUnit,
    note:
      input.amountPayable == null
        ? // No mode = nothing can be claimed, so the scope sentence has nothing
          // to scope. The refusal is the whole note.
          payableSign
        : `${payableSign}. ` +
          fill(t("trips.breakdown.doc.payableNote", lang), { generated, month }),
  };

  // --- Six-month trend ---------------------------------------------------
  const seriesRevenue = t("trips.breakdown.doc.seriesRevenue", lang);
  const seriesTrips = t("trips.breakdown.kTripsDelivered", lang);
  const trend = {
    head: t("trips.breakdown.doc.trendHead", lang),
    sub: fill(t("trips.breakdown.doc.trendSub", lang), { month }),
    points: input.trend.map((p) => ({ label: p.label, primary: p.revenue, secondary: p.trips })),
    seriesRevenue,
    seriesTrips,
    aria: fill(t("trips.breakdown.doc.trendAria", lang), { month }),
    note: t("trips.breakdown.trendNote", lang),
  };

  // --- Operational -------------------------------------------------------
  const deliveredLabel = t("trips.customers.colDelivered", lang);
  const notDeliveredLabel = t("trips.breakdown.kNotDelivered", lang);
  const operational = {
    head: t("trips.breakdown.doc.operationalHead", lang),
    sub: month,
    stats: [
      { label: t("trips.breakdown.kTotalTrips", lang), value: count(input.operational.totalCount) },
      { label: deliveredLabel, value: count(input.operational.deliveredCount) },
      { label: notDeliveredLabel, value: count(input.operational.notDelivered) },
      // A completion rate over zero scheduled trips is not 0% — same em dash
      // and the same rounding the screen uses.
      input.operational.completion == null
        ? { label: t("trips.breakdown.kCompletion", lang), absent: DASH }
        : {
            label: t("trips.breakdown.kCompletion", lang),
            value: `${Math.round(input.operational.completion * 100)}%`,
          },
    ] as const satisfies readonly DocStat[],
    parts: [
      {
        label: deliveredLabel,
        value: input.operational.deliveredCount,
        display: count(input.operational.deliveredCount),
      },
      {
        label: notDeliveredLabel,
        value: input.operational.notDelivered,
        display: count(input.operational.notDelivered),
        hatch: true,
      },
    ],
    barTotal: fill(t("trips.breakdown.doc.barTotal", lang), {
      n: count(input.operational.totalCount),
    }),
    barFootnote: t("trips.breakdown.doc.barFootnote", lang),
    barAria: t("trips.breakdown.doc.barAria", lang),
    barEmpty: t("trips.breakdown.noTripsMonth", lang),
    hasBar: input.operational.totalCount > 0,
  };

  // --- Deliveries (rolling, anchored to today) ---------------------------
  const deliveries = {
    head: t("trips.deliveries.heading", lang),
    sub: t("trips.breakdown.doc.deliveriesSub", lang),
    windows: input.deliveries.map((w) => ({
      label: t(`trips.deliveries.${w.key}`, lang),
      count: count(w.count),
      sub: `${money(w.sar)} ${sarUnit}`,
    })),
    note: fill(t("trips.breakdown.doc.deliveriesNote", lang), { generated, month }),
  };

  // --- Trips per day -----------------------------------------------------
  const daily = {
    head: t("trips.breakdown.doc.dailyHead", lang),
    sub: month,
    counts: input.daily,
    aria: fill(t("trips.breakdown.doc.dailyAria", lang), { month }),
  };

  // --- Sources -----------------------------------------------------------
  const sources = {
    head: t("trips.breakdown.doc.sourcesHead", lang),
    sub: month,
    items: [
      {
        term: t("trips.breakdown.stationsUsed", lang),
        value: input.stations.length ? input.stations.join(listSep) : DASH,
      },
      {
        term: t("trips.breakdown.typesSeen", lang),
        // Labelled HERE, off the enum value, exactly as the screen labels them.
        value: input.waterTypes.length
          ? input.waterTypes.map((k) => waterTypeLabel(k, lang) || k).join(listSep)
          : DASH,
      },
    ],
  };

  // --- By driver ---------------------------------------------------------
  const driverTable = (
    label: string,
    amountHead: string,
    rows: readonly BreakdownDriverRow[],
    total: number,
  ): DocDriverTable => ({
    label,
    cols: { driver: t("common.driver", lang), delivered: deliveredLabel, amount: amountHead },
    rows: rows.map((r) => ({
      key: r.key,
      name: r.name,
      unassigned: r.unassigned,
      delivered: count(r.tripsDelivered),
      amount: money(r.amount),
    })),
    footLabel: t("common.total", lang),
    // The month's delivered count, which is what both tables sum to by
    // construction — every delivered trip lands in exactly one driver bucket.
    footDelivered: count(input.financial.deliveredCount),
    footAmount: money(total),
    empty: t("trips.breakdown.noDelivered", lang),
  });

  const byDriver = {
    head: t("trips.breakdown.doc.byDriverHead", lang),
    sub: month,
    commission: driverTable(
      t("trips.breakdown.tblCommission", lang),
      t("trips.breakdown.doc.colCommissionSar", lang),
      input.commissionByDriver,
      input.financial.commission,
    ),
    revenue: driverTable(
      t("trips.breakdown.tblRevenue", lang),
      t("trips.breakdown.doc.colRevenueSar", lang),
      input.revenueByDriver,
      input.financial.revenue,
    ),
  };

  return {
    lang,
    rtl: lang === "ar",
    docTitle: fill(t("trips.breakdown.doc.docTitle", lang), { project: input.project.name }),
    masthead,
    financial,
    payments,
    payable,
    trend,
    operational,
    deliveries,
    daily,
    sources,
    byDriver,
    footer: [fill(t("trips.breakdown.generated", lang), { date: generated }), COMPANY],
  };
}
