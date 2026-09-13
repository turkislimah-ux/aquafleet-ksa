// COST STATEMENT VIEW-MODEL — what the printed cost sheet says, in what order,
// and in which words.
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING may
//   not.
//
// The source of truth is app/reports/StatementViews.tsx, CostStatement. Every
// label below resolves through `t()` from the SAME KEY that component passes,
// so a reword lands on both surfaces or on neither.
//
// IT TAKES THE COMPONENT'S OWN DERIVATIONS, NOT THE RAW VIEWS. The per-truck
// rollup, the two fill groupings and the month slices are all `useMemo`s or
// hoisted consts inside the component, no file in lib/ may import from @/app/,
// and re-deriving any of them here would be a SECOND expression of a money
// figure. Every number in `CostDocInput` is a const the component has already
// named — `trucks`, `partsTotal`, `earned`, `byType`, `byStation` — handed over
// verbatim. The three sums this file does perform (the fill foot, the
// maintenance foot) are sums of rows it already holds, which is the same shape
// receivables' band foot has.
//
// TWO THINGS THIS FILE WORDS THAT THE SCREEN WORDS AT RENDER, and for the same
// reason the screen does it there: the removed-station label and the water-type
// label are translated strings, so composing them inside a data-keyed memo
// would leave the table in the previous language. The screen builds both in
// JSX; this file builds both here, which is that same position.
//
// THE HEADLINE FIGURE AND THE CHART ARE ADDITIONS, and the only two. The screen
// states no single total for this statement and draws nothing. Turki's ruling:
// the sheet gets `operating_cost_sar` as its masthead figure and the P&L's own
// five-bucket decomposition of it as a ranked bar. Both come from the SAME P&L
// row, so the chart is exactly the masthead taken apart — see the note on
// `chart` below for what that does and does not reconcile with.
//
// Purity: no React, no fs, no Supabase, no `process`, no `new Date()` —
// `generatedAt` is passed in, so the same input always renders the same sheet.

import { WATER_TYPE_LABELS, type WaterType } from "../db-types";
import { DASH, num2, numPlain } from "../docPrimitives";
import { fill, plural, t, type Lang } from "../i18n";
import { formatDateLang } from "../utils";
import { DOC_COMPANY, DOC_SAR, docGeneratedMeta } from "./reportDoc";

// ---------------------------------------------------------------------------
// Input — every figure already named by the component
// ---------------------------------------------------------------------------

/** One water type's fill cost, exactly as `byType` assembled it. */
export type CostDocTypeGroup = {
  /** The raw `water_type` enum value. Labelled HERE, see the header. */
  waterType: string;
  sar: number;
  costed: number;
  uncosted: number;
};

/** One station's fill cost, exactly as `byStation` assembled it. */
export type CostDocStationGroup = {
  /** The immutable station_key (0014) — the fallback label's `{k}`. */
  key: string;
  /** Null when the key no longer resolves to a station. */
  name: string | null;
  sar: number;
  costed: number;
  uncosted: number;
};

/** One truck's maintenance, already summed across the period and sorted
 *  total-descending by the component. */
export type CostDocTruck = {
  plate: string;
  parts: number;
  os: number;
  total: number;
};

export type CostDocInput = {
  lang: Lang;
  generatedAt: Date;
  /** The period picker's own label — the masthead's subtitle. */
  label: string;

  /**
   * The P&L row for the period, in this file's own camelCase.
   *
   * NOT the `PnlPeriodRow` and NOT `costBuckets()`. That helper takes a
   * `PnlRow`, which carries a `month` and a settled-revenue column a PERIOD row
   * does not have, so it cannot be called with what this statement is given
   * without fabricating two fields. The five buckets are rebuilt below from the
   * same five `dashboard.costType.*` keys instead.
   */
  pnl: {
    operatingCost: number;
    parts: number;
    os: number;
    payroll: number;
    commissions: number;
    filling: number;
  };

  /** The period's fill totals — `fillTotal` / `fillCosted` / `fillUncosted`. */
  fills: { total: number; costed: number; uncosted: number };
  byType: readonly CostDocTypeGroup[];
  byStation: readonly CostDocStationGroup[];

  /** `trucks`, plus the two column totals the component hoisted off it. */
  maintenance: {
    trucks: readonly CostDocTruck[];
    parts: number;
    os: number;
  };

  payroll: {
    staff: number;
    driver: number;
    total: number;
    /** PEAK across the period's months, never a sum — see the component. */
    missingSalary: number;
  };

  commissions: {
    trip: number;
    specials: number;
    adjustments: number;
    bonuses: number;
    earned: number;
    payoutCount: number;
    paid: number;
  };

  purchasing: { stockReceived: number; receipts: number };
};

// ---------------------------------------------------------------------------
// Output — one worded object per ATLAS block
// ---------------------------------------------------------------------------

/** Mirrors lib/atlas/blocks.ts's `Stat`. */
export type DocStat = { label: string; value?: string; unit?: string; absent?: string };

/** One row of either fill table. Both have the same four columns, which is why
 *  they can sit as a pair at all. */
export type CostDocFillRow = {
  label: string;
  fills: string;
  uncosted: string;
  cost: string;
};

/** One label/amount line — payroll, both commission panels, purchasing. */
export type CostDocLine = { label: string; value: string };

export type CostDocVm = {
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

  /**
   * THE RANKED COST BUCKETS — the masthead figure taken apart, and nothing else.
   *
   * Every bar is a column of the SAME P&L row the headline comes from, so the
   * five add to it exactly. What they do NOT necessarily add up to is the
   * tables further down: the P&L's parts figure is priced at consumption while
   * the maintenance table sums parts ATTRIBUTABLE TO A TRUCK, and where a work
   * order reached no truck the two diverge. Measured 2026-09-13 across the live
   * months: identical in June, July and September; 240.00 SAR apart in August.
   * The chart states the P&L's answer because the headline above it does; the
   * table states the per-truck view's, because that is what it is a table OF.
   *
   * KEPT IN GRAYSCALE, unlike the receivables split bar that was dropped. This
   * is `rankedBars`, which gives every bucket its own row, its own name at the
   * leading edge and its own figure at the trailing one — no label can collide
   * with a neighbour's and none can be squeezed out, which were the two failures
   * that made a four-way split bar unreadable. One tint, five bars, no hatch:
   * nothing here needs to be told apart by fill, only by length.
   */
  chart: {
    bars: readonly { label: string; value: number; display: string }[];
    aria: string;
  };

  fills: {
    head: string;
    /** The severity word, or undefined where the screen colours nothing. */
    flag?: string;
    /** The screen's single middot-separated line above the two tables. */
    lead: string;
    /** Printed INSTEAD of both tables when no fill fell in the period. */
    empty: string;
    has: boolean;
    /** The two `.pair` labels — the screen's two h4s. */
    byTypeLabel: string;
    byStationLabel: string;
    typeCols: { group: string; fills: string; uncosted: string; cost: string };
    stationCols: { group: string; fills: string; uncosted: string; cost: string };
    byType: readonly CostDocFillRow[];
    byStation: readonly CostDocFillRow[];
    /** One foot, printed under BOTH tables — the screen repeats it too, because
     *  each table is a complete partition of the same total. */
    foot: CostDocFillRow;
  };

  maint: {
    head: string;
    empty: string;
    has: boolean;
    cols: { truck: string; parts: string; outsourced: string; total: string };
    rows: readonly { plate: string; parts: string; os: string; total: string }[];
    foot: { label: string; parts: string; os: string; total: string };
    note: string;
  };

  payroll: {
    head: string;
    cols: { component: string; amount: string };
    rows: readonly CostDocLine[];
    foot: CostDocLine;
    note: string;
  };

  commissions: {
    head: string;
    /** The FIRST column head of each panel, which is also its pair label — the
     *  two are one string on screen, and splitting them here would invent a
     *  heading. The renderer prints it once, as the pair label. */
    earnedLabel: string;
    paidLabel: string;
    amount: string;
    earnedRows: readonly CostDocLine[];
    earnedFoot: CostDocLine;
    paidRows: readonly CostDocLine[];
    paidFoot: CostDocLine;
    note: string;
  };

  purchasing: {
    head: string;
    cols: { measure: string; value: string };
    rows: readonly CostDocLine[];
    note: string;
  };

  footer: readonly string[];
};

export function buildCostVm(input: CostDocInput): CostDocVm {
  const { lang } = input;
  const money = (n: number) => num2(n);
  const count = (n: number) => numPlain(n);
  const generated = formatDateLang(input.generatedAt, lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const totalLabel = t("reports.th.total", lang);
  const amountLabel = t("reports.th.amount", lang);
  const fillsLabel = t("reports.th.fills", lang);
  const uncostedLabel = t("reports.th.uncosted", lang);
  const costLabel = t("common.cost", lang);

  const maintTotal = input.maintenance.parts + input.maintenance.os;

  // A COUNT CELL IS A DASH AT ZERO, exactly as the screen writes `v.uncosted ||
  // "—"`. A 0 in that column would be a measured zero; the claim is that this
  // group has nothing unpriced at all.
  const uncostedCell = (n: number) => (n === 0 ? DASH : count(n));

  // THE LEAD LINE, joined from the three spans the screen separates with an
  // explicit middot. The separator is in the source for the reason its own
  // comment gives — two adjacent spans have no whitespace between them, so a
  // gap that fails to apply runs them together — and a printed sheet has no
  // flex gap at all, which makes it load-bearing here rather than defensive.
  //
  // `{n}` GOES IN RAW on both phrases, never through `count()`. The dictionary
  // pins that: these counts were interpolated directly and adding a thousands
  // separator now would change a figure rather than translate it. The TABLE
  // columns below are grouped like every other figure on the sheet — the phrase
  // and the column are two different registers, and the dictionary owns one.
  const leadParts = [
    `${money(input.fills.total)} ${DOC_SAR}`,
    fill(t(`reports.costs.fillsCosted.${plural(input.fills.costed)}`, lang), {
      n: input.fills.costed,
    }),
  ];
  if (input.fills.uncosted > 0) {
    leadParts.push(
      fill(t(`reports.costs.uncosted.${plural(input.fills.uncosted)}`, lang), {
        n: input.fills.uncosted,
      }),
    );
  }

  // THE SEVERITY WORD SITS ON THE SECTION, NOT ON A ROW. On screen the finding
  // is amber in two places at once — the uncosted cell of every affected row AND
  // the sentence above both tables — and it qualifies the whole fill total,
  // which is short by an unknown amount whenever the count is above zero. On
  // paper the hue is gone, so the claim is made in the one encoding a monochrome
  // sheet can carry.
  //
  // NOT a `Row.flag`: these two tables print side by side at half measure, and a
  // gutter word column there would take room from four real columns — worse in
  // Arabic, where `.gw` is set larger. The count column still carries the data
  // row by row; the word carries the judgement, once, where the screen's
  // sentence carries it.
  //
  // REUSING `reports.th.uncosted` rather than minting a doc-only word. Unlike
  // receivables' overdue/ageing, the screen already has this exact word for this
  // exact condition, one column away.
  const fillFlag = input.fills.uncosted > 0 ? uncostedLabel : undefined;

  const fillRow = (
    label: string,
    g: { sar: number; costed: number; uncosted: number },
  ): CostDocFillRow => ({
    label,
    fills: count(g.costed),
    uncosted: uncostedCell(g.uncosted),
    // UNCONDITIONALLY the money, never a dash. A station that priced its water
    // type at zero measured a zero; the screen prints 0.00 there and so does
    // this. Live case: Furaian, July, 31 costed potable trips at 0.00.
    cost: money(g.sar),
  });

  return {
    lang,
    rtl: lang === "ar",
    docTitle: fill(t("reports.doc.costs.docTitle", lang), { p: input.label }),

    masthead: {
      eyebrow: DOC_COMPANY,
      title: t("reports.costs.title", lang),
      subtitle: input.label,
      meta: [[docGeneratedMeta(lang, generated)]],
      figure: {
        // THE P&L'S OWN OPERATING COST, which is the one figure that covers
        // every section below. Summing the sheet's own tables instead would be a
        // second definition of operating cost living on a printable.
        // The SAME key the narrative sheet's P&L ledger names this figure with
        // — one number must not carry two names across two printables.
        caption: t("reports.metric.operatingCost", lang),
        value: money(input.pnl.operatingCost),
        unit: t("reports.doc.figureUnit", lang),
      },
    },

    // FIVE CELLS, ONE PER SECTION, in the order the sections run. Each is the
    // figure that section's table foots to, under that section's own label —
    // the screen's CSV builder names these exact five, which is the closest
    // thing the source has to a statement of which figures are the headline
    // ones.
    stats: [
      {
        label: t("reports.costs.fillHead", lang),
        value: money(input.fills.total),
        unit: DOC_SAR,
      },
      {
        label: t("reports.costs.maintHead", lang),
        value: money(maintTotal),
        unit: DOC_SAR,
      },
      {
        label: t("reports.costs.totalPayroll", lang),
        value: money(input.payroll.total),
        unit: DOC_SAR,
      },
      {
        label: t("reports.costs.totalEarned", lang),
        value: money(input.commissions.earned),
        unit: DOC_SAR,
      },
      {
        label: t("reports.costs.stockReceived", lang),
        value: money(input.purchasing.stockReceived),
        unit: DOC_SAR,
      },
    ],

    chart: {
      // THE SAME FIVE KEYS `costBuckets()` USES, in value order rather than its
      // fixed order — a ranked bar that is not ranked is a bar chart pretending.
      // `other` is NOT among them: costBuckets does not emit it for a P&L row
      // and inventing a sixth bucket here would put a figure on the sheet that
      // no column measures.
      // `as const` so the five keys stay LITERALS through the sort — widened to
      // `string` they no longer satisfy `TKey`, which is the dictionary's own
      // guarantee that a key printed here exists in both languages.
      bars: ([
        { key: "dashboard.costType.parts", value: input.pnl.parts },
        { key: "dashboard.costType.outsourced", value: input.pnl.os },
        { key: "dashboard.costType.payroll", value: input.pnl.payroll },
        { key: "dashboard.costType.commissions", value: input.pnl.commissions },
        { key: "dashboard.costType.filling", value: input.pnl.filling },
      ] as const)
        .slice()
        .sort((a, b) => b.value - a.value)
        .map((b) => ({
          label: t(b.key, lang),
          value: b.value,
          // The currency rides on the figure because this block has no column
          // head to carry it, unlike every table on the sheet.
          display: `${money(b.value)} ${DOC_SAR}`,
        })),
      aria: t("reports.doc.costs.chartAria", lang),
    },

    fills: {
      head: t("reports.costs.fillHead", lang),
      ...(fillFlag ? { flag: fillFlag } : {}),
      lead: leadParts.join(" · "),
      empty: t("reports.costs.noFills", lang),
      has: input.byType.length > 0,
      byTypeLabel: t("reports.costs.byWaterType", lang),
      byStationLabel: t("reports.costs.byStation", lang),
      typeCols: {
        group: t("reports.th.waterType", lang),
        fills: fillsLabel,
        uncosted: uncostedLabel,
        cost: costLabel,
      },
      stationCols: {
        group: t("reports.th.station", lang),
        fills: fillsLabel,
        uncosted: uncostedLabel,
        cost: costLabel,
      },
      // STILL ENGLISH IN BOTH LANGUAGES, exactly as the screen renders it. The
      // map is shared with Trips; translating it is that batch's job, and a
      // reports-local second copy is how the two surfaces start disagreeing.
      byType: input.byType.map((g) =>
        fillRow(WATER_TYPE_LABELS[g.waterType as WaterType] ?? g.waterType, g),
      ),
      byStation: input.byStation.map((g) =>
        fillRow(g.name ?? fill(t("reports.costs.stationRemoved", lang), { k: g.key }), g),
      ),
      foot: {
        label: totalLabel,
        fills: count(input.fills.costed),
        uncosted: uncostedCell(input.fills.uncosted),
        cost: money(input.fills.total),
      },
    },

    maint: {
      head: t("reports.costs.maintHead", lang),
      empty: t("reports.costs.noMaint", lang),
      has: input.maintenance.trucks.length > 0,
      cols: {
        truck: t("reports.th.truck", lang),
        parts: t("reports.th.parts", lang),
        outsourced: t("reports.th.outsourced", lang),
        total: totalLabel,
      },
      rows: input.maintenance.trucks.map((tr) => ({
        plate: tr.plate,
        // A dash where the screen writes one. Nothing of this kind reached this
        // truck — a 0.00 would claim it was priced at nothing.
        parts: tr.parts === 0 ? DASH : money(tr.parts),
        os: tr.os === 0 ? DASH : money(tr.os),
        total: money(tr.total),
      })),
      foot: {
        label: totalLabel,
        // The FOOT prints its zeros. A column total of 0.00 across a table with
        // rows in it IS a measurement; the per-row dash is the absence of one.
        parts: money(input.maintenance.parts),
        os: money(input.maintenance.os),
        total: money(maintTotal),
      },
      note: t("reports.costs.maintNote", lang),
    },

    payroll: {
      head: t("reports.metric.payroll", lang),
      cols: { component: t("common.component", lang), amount: amountLabel },
      rows: [
        { label: t("reports.costs.staffSalaries", lang), value: money(input.payroll.staff) },
        { label: t("reports.costs.driverSalaries", lang), value: money(input.payroll.driver) },
      ],
      foot: { label: t("reports.costs.totalPayroll", lang), value: money(input.payroll.total) },
      // THE THREE-PART NOTE, JOINED. `note()` escapes, and the kit has no
      // <strong> primitive — emphasis inside a sentence is a screen device, and
      // the sheet's register carries no bold body text at all. The WORDS are
      // every word the screen prints, in the screen's order, with the screen's
      // own JSX spacing: a space before the emphasis and a space after it,
      // because neither dictionary value carries edge whitespace.
      note: joinNote(
        [
          t("reports.costs.payrollNoteBefore", lang),
          t("reports.costs.payrollNoteStrong", lang),
          t("reports.costs.payrollNoteAfter", lang),
        ],
        input.payroll.missingSalary > 0
          ? fill(
              t(`reports.costs.missingSalary.${plural(input.payroll.missingSalary)}`, lang),
              { n: input.payroll.missingSalary },
            )
          : undefined,
      ),
    },

    commissions: {
      head: t("reports.costs.commissionsHead", lang),
      earnedLabel: t("reports.costs.earnedAccrual", lang),
      paidLabel: t("reports.costs.paidCash", lang),
      amount: amountLabel,
      earnedRows: [
        { label: t("reports.costs.tripCommission", lang), value: money(input.commissions.trip) },
        { label: t("reports.costs.specials", lang), value: money(input.commissions.specials) },
        {
          label: t("reports.costs.adjustments", lang),
          value: money(input.commissions.adjustments),
        },
        { label: t("reports.costs.bonuses", lang), value: money(input.commissions.bonuses) },
      ],
      earnedFoot: {
        label: t("reports.costs.totalEarned", lang),
        value: money(input.commissions.earned),
      },
      paidRows: [
        // A COUNT, not money — the screen routes this one through formatNum and
        // the next through formatSar, in the same column. The unit rides the
        // row, which is the shape the CSV uses for the same reason.
        { label: t("reports.costs.payouts", lang), value: count(input.commissions.payoutCount) },
      ],
      paidFoot: {
        label: t("reports.costs.totalPaid", lang),
        value: money(input.commissions.paid),
      },
      // NO SPACE AFTER THE EMPHASIS here: the AFTER value opens with the full
      // stop that closes the emphasised clause, and the screen's JSX omits the
      // separator for exactly that reason. `joinNote` reads the punctuation
      // rather than being told, so the two sides cannot drift apart.
      note: joinNote([
        t("reports.costs.commissionsNoteBefore", lang),
        t("reports.costs.commissionsNoteStrong", lang),
        t("reports.costs.commissionsNoteAfter", lang),
      ]),
    },

    purchasing: {
      head: t("reports.costs.purchasingHead", lang),
      cols: { measure: t("reports.th.measure", lang), value: t("reports.th.value", lang) },
      rows: [
        {
          label: t("reports.costs.stockReceived", lang),
          value: money(input.purchasing.stockReceived),
        },
        { label: t("reports.costs.receipts", lang), value: count(input.purchasing.receipts) },
      ],
      note: joinNote([
        t("reports.costs.purchasingNoteBefore", lang),
        t("reports.costs.purchasingNoteStrong", lang),
        t("reports.costs.purchasingNoteAfter", lang),
      ]),
    },

    footer: [fill(t("reports.print.generated", lang), { d: generated }), DOC_COMPANY],
  };
}

/**
 * Join the parts of a note that the screen splits at a `<strong>`.
 *
 * A part that OPENS with punctuation is a continuation of the part before it,
 * not a new word after it: ". A payout's base is…" closes the clause the
 * emphasis started, and an unconditional space sets the full stop adrift — the
 * same rule `metaPair` applies to a meta tail, and for the same reason. Decided
 * from the string rather than passed in, so a future reword that moves the stop
 * to the other side does not need this call site changed too.
 *
 * `tail` is the conditional sentence some notes append, always preceded by a
 * space in the JSX and always a whole sentence of its own.
 */
function joinNote(parts: readonly string[], tail?: string): string {
  const joined = parts.reduce((acc, p) =>
    acc + (/^[,.;:!?)\]]/.test(p) ? "" : " ") + p,
  );
  return tail ? `${joined} ${tail}` : joined;
}
