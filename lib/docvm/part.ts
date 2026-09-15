// ITEM RECORD VIEW-MODEL — ONE PART: what the printed item record says, in what
// order, and in which words.
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING may
//   not.
//
// The source of truth is `ViewPartModal` in app/inventory/InventoryClient.tsx:
// its identity grid, its pricing-snapshot card, its stock-batches table, its
// movement history, its financial summary and its reorder card, in that order.
//
// ==========================================================================
// EVERY DERIVATION BELOW IS THE DRAWER'S OWN, RESTATED CHARACTER FOR CHARACTER
// ==========================================================================
// currentLot / previousLot / priceDeltaPct / activeLots / avgCost / totalValue
// / low / reorderValue are copied from the component, not re-invented from the
// same inputs. Where the drawer delegates — computePartFinanceStats, partAiTip,
// lineVat, categoryLabel, movementLabel, lotStatusLabel — this file calls the
// SAME function rather than restating it, which is why lib/inventory-labels.ts
// and lib/part-finance.ts exist: no file in lib/docvm/ may import from app/,
// and a second copy of a figure is the drift this split was made to prevent.
//
// ==========================================================================
// QUANTITIES PRINT RAW. NO SEPARATORS, NO ROUNDING.
// ==========================================================================
// The drawer prints `{part.qty_on_hand} {unit}` — the bare number. qty_on_hand,
// qty_purchased, qty_remaining, qty_delta, qty_after and totalConsumed are all
// `numeric`, so a fractional stock figure is representable and 11.5 is a
// legitimate value. Routing any of them through formatNum's default 0 digits
// would print 12 — a RESTATED quantity, which is a data deviation, not a
// formatting one. lib/docvm/payout-history.ts does format its trip counts, and
// that is safe there because a trip count is an integer by construction. Here
// it is not. Money still formats; quantities do not.
//
// ==========================================================================
// WHAT THE SCREEN CARRIES IN HUE AND GLYPH, AND WHAT BECOMES OF IT
// ==========================================================================
//   * THE PRICE-DELTA ARROW becomes a SIGN plus the severity gutter WORD. The
//     screen sets `Math.abs(pct)` beside a ▲/▼ icon tinted rose/emerald; an
//     icon is not a print device and a tint is the first thing a photocopier
//     loses. The sheet prints the signed figure and flies Rise or Drop.
//   * MIRRORED ODDITY: the drawer's test is `priceDeltaPct > 0`, so a delta of
//     exactly 0 renders the DOWN arrow. The sheet therefore flags 0 as a Drop.
//     That is the screen's own branch, not a rounding artefact here — do not
//     "fix" it on one side only.
//   * THE FINANCIAL SUMMARY'S price trend is a DIFFERENT figure with a THREE-way
//     arrow (↑ / ↓ / →), so its zero case flies NO flag. Two stats, two
//     branches, both mirrored as written.
//   * A DEPLETED LOT is dropped to 60% opacity. The opacity does not survive —
//     a grey row photocopies as ink that ran — and it does not need to: the
//     Status cell already says "Depleted" in words. No gutter flag either; the
//     word is the device, and flying it twice on one row is emphasis the screen
//     does not have.
//   * THE STATUS PILL becomes a `mark`, whose binary is "is this the batch we
//     sell from" — the one fact the three words cannot all carry, since a
//     current lot can also be depleted.
//   * THE STRIKE ON "PREVIOUS PRICE" does not survive, and is the one screen
//     device deliberately dropped rather than mapped. A stat cell takes no
//     class, and widening the kit for one sheet is worse than trusting the
//     label: the figure is set under the word "Previous price", which says the
//     same thing the rule said.
//
// ==========================================================================
// THE USAGE CHART HAS NO ON-SCREEN COUNTERPART, AND IS BUILT FROM THE TABLE
// BENEATH IT
// ==========================================================================
// BATCH 7 asked for a usage-over-time figure; the drawer draws none. So the
// chart is bucketed from `movements` and from nothing else — the very rows the
// movement table below it lists, monthly, in with stock in as the primary
// series and stock out as the secondary. It states no fact the sheet does not
// already print line by line, which is the only shape a new figure can take
// under the law above.
//
// lib/parts-usage.ts DOES hold real per-part consumption analytics over
// exit_permit_line_consumptions and work_order_part_consumptions, and is
// deliberately NOT used: it feeds app/consumption/PartsUsageTab.tsx, a
// different screen. Plotting it here would put data on the item record that the
// item record does not show.
//
// The bucket key is riyadhDayKey(...).slice(0, 7), not created_at.slice(0, 7):
// the column is a timestamptz and the business day is Riyadh's, so a UTC slice
// files a 01:00-Riyadh movement under the previous month.
//
// `has` needs TWO buckets, not one. trendChart maps x by `i / (n - 1)`, which
// is NaN at a single point — the same gate lib/docvm/operations.ts states.
//
// ==========================================================================
// THE MOVEMENT LIST IS CAPPED AT 50 BY THE SCREEN, AND THE SHEET KEEPS THE CAP
// ==========================================================================
// getPartMovements takes 50; getPartDocument takes the same 50 for the same
// reason. The cap is a MIRROR, not a document decision, and the chart buckets
// exactly those rows — so the figure and the table can never describe different
// sets of movements.
//
// ==========================================================================
// TWO SOURCE-SIDE ODDITIES THE SHEET REPEATS RATHER THAN PAPERS OVER
// ==========================================================================
//   * `spentByConsumption` is a hard 0 while `totalConsumed` is not — see
//     lib/part-finance.ts's header. A part can honestly report units consumed
//     beside 0 SAR spent. It reads oddly and it is what the drawer says.
//   * `spentByConsumption` above is the only one of these left. The movement
//     DATE column used to be the second: it was `formatDateTime`, en-US in both
//     languages, mirrored from the drawer on the grounds that a reader comparing
//     the two side by side should not see one value written two ways.
//
//     THAT MIRROR IS NOW BROKEN ON PURPOSE, and the old note here was wrong
//     about it twice over. It claimed the Arabic sheet carried "Latin month
//     abbreviations" in that column; it carried no month NAME at all —
//     `formatDateTime` with no options renders `8/5/2026, 10:37:55 PM`, which
//     is pure digits. And the comparability it was protecting was already gone,
//     because the sheet's own footer has always been language-aware: the Arabic
//     page printed `سبتمبر 14, 2026` at the bottom and `8/5/2026` in the table.
//     The mirror it kept was with the DRAWER; the disagreement it caused was
//     with the rest of its own page.
//
//     So the column now takes the sheet's language like every other date on it.
//     The sheet and the drawer write the same instant differently, which is the
//     accepted cost — a printed page is read on its own, away from the screen
//     it came from.

import type {
  Part,
  PriceLot,
  PurchaseOrder,
  PurchaseOrderLine,
  StockMovement,
} from "../db-types";
import { DASH } from "../docPrimitives";
import { arText, fill, plural, t, type Lang } from "../i18n";
import { categoryLabel, lotStatusLabel, movementLabel } from "../inventory-labels";
import { formatSarVat, lineVat } from "../inventory-vat";
import { computePartFinanceStats, partAiTip } from "../part-finance";
import {
  formatDateLang,
  formatDateTimeLang,
  formatNum,
  formatSar,
  monthLabel,
  riyadhDayKey,
} from "../utils";

// One sheet, one date language — reasoning in lib/docvm/exitPermit.ts's DATE
// SHAPE header. Seconds are spelled out rather than defaulted so the movement
// stamp keeps the precision it had.
const PART_DATETIME = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
} as const;

/** Not DOC_COMPANY. lib/docvm/reportDoc.ts is the REPORTS pack's shared
 *  identity; this sheet mirrors an unrelated screen that happens to print the
 *  same company name, so it declares its own — the same call
 *  lib/docvm/{payout-history,purchaseOrder,exitPermit}.ts already made. */
const COMPANY = "Bin Slimah Group · Bousla";

export type PartDocInput = {
  lang: Lang;
  /** The "generated on" instant. PASSED IN, never read here. */
  generatedAt: Date;
  part: Part;
  /** Already resolved by the server action. The drawer's `?? "—"` is applied here. */
  warehouseName: string | null;
  /** OLDEST FIRST — getPriceLots' own ordering, so the LAST element is the
   *  current FIFO batch. The whole pricing snapshot depends on it. */
  lots: PriceLot[];
  /** NEWEST FIRST, capped at 50 — getPartMovements' ordering and its limit. */
  movements: StockMovement[];
  purchaseOrders: PurchaseOrder[];
  purchaseOrderLines: PurchaseOrderLine[];
};

type Pair = { label: string; value: string; num?: boolean };

type StatCell = { label: string; value?: string; unit?: string; absent?: string };

export type PartDocLotRow = {
  receivedOn: string;
  qtyPurchased: string;
  qtyRemaining: string;
  unitCost: string;
  vat: string;
  total: string;
  status: string;
  /** The mark's binary: is this the batch stock is drawn from right now. */
  isCurrent: boolean;
};

export type PartDocMovementRow = {
  type: string;
  change: string;
  after: string;
  note: string;
  by: string;
  date: string;
};

export type PartDocFinanceRow = {
  label: string;
  value: string;
  sub: string;
  /** The severity word, set only where the screen's own branch sets a direction. */
  flag?: string;
};

export type PartDocVm = {
  lang: Lang;
  rtl: boolean;
  docTitle: string;
  masthead: {
    eyebrow: string;
    eyebrowEnd: Pair;
    title: string;
    meta: Pair[][];
    figure: { caption: string; value: string; unit: string };
  };
  /** The pricing card's four HEADLINE figures, in the screen's order. */
  stats: StatCell[];
  pricing: {
    head: string;
    /** Null on a part with fewer than two lots — then `singleTier` prints. */
    delta: { value: string; flag: string } | null;
    singleTier: string;
    /** The stock-health line the screen sets under the on-hand figure. */
    health: string;
    /** The card's own closing sentence. */
    fifoNote: string;
  };
  lots: {
    head: string;
    cols: {
      receivedOn: string;
      qtyPurchased: string;
      qtyRemaining: string;
      unitCost: string;
      vat: string;
      total: string;
      status: string;
    };
    rows: PartDocLotRow[];
    empty: string;
  };
  movements: {
    head: string;
    chart: {
      has: boolean;
      points: { label: string; primary: number; secondary: number }[];
      primaryLabel: string;
      secondaryLabel: string;
      aria: string;
    };
    cols: {
      type: string;
      change: string;
      after: string;
      note: string;
      by: string;
      date: string;
    };
    rows: PartDocMovementRow[];
    empty: string;
  };
  finance: {
    head: string;
    rows: PartDocFinanceRow[];
    /** The drawer's AI tip, and the badge word it wears. */
    tip: { text: string; flag: string };
  };
  reorder: {
    head: string;
    items: { label: string; value: string; num?: boolean }[];
  };
  footer: string[];
};

export function buildPartVm(input: PartDocInput): PartDocVm {
  const { lang, part, lots, movements } = input;
  const unit = part.unit ?? "";

  // NO sarUnit LOCAL FOR THE BODY. Every money figure below is written by
  // formatSar or formatSarVat, both of which append their own hard-coded
  // " SAR" in either language — exactly as the drawer does. The masthead
  // figure is the one exception and carries the literal itself, because a
  // masthead figure has a unit SLOT and printing the suffix twice would read
  // as part of the number.
  const sarUnit = "SAR";

  const generated = formatDateLang(input.generatedAt, lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // --- The drawer's own derivations, restated -----------------------------
  const currentLot = lots.length > 0 ? lots[lots.length - 1] : null;
  const previousLot = lots.length > 1 ? lots[lots.length - 2] : null;
  const priceDeltaPct =
    currentLot != null && previousLot != null && previousLot.price_sar > 0
      ? +(((currentLot.price_sar - previousLot.price_sar) / previousLot.price_sar) * 100).toFixed(1)
      : null;
  const activeLots = lots.filter((l) => l.qty_remaining > 0);
  const activeQty = activeLots.reduce((s, l) => s + l.qty_remaining, 0);
  const avgCost =
    activeQty > 0
      ? activeLots.reduce((s, l) => s + l.qty_remaining * l.price_sar, 0) / activeQty
      : currentLot?.price_sar ?? part.unit_cost_sar ?? null;
  const totalValue = lots.reduce((s, l) => s + l.qty_remaining * l.price_sar, 0);
  const low = part.reorder_level != null && part.qty_on_hand <= part.reorder_level;
  const reorderValue =
    part.reorder_qty != null && part.unit_cost_sar != null
      ? part.reorder_qty * part.unit_cost_sar
      : null;

  const stats = computePartFinanceStats(
    part,
    lots,
    input.purchaseOrders,
    input.purchaseOrderLines,
    movements,
  );
  const tip = partAiTip(part, stats, lang);

  const riseWord = t("inventory.stock.doc.priceRise", lang);
  const dropWord = t("inventory.stock.doc.priceDrop", lang);
  /** The screen never prints a sign — the arrow carries the direction. On paper
   *  the sign does, so it is written back in. The magnitude is untouched. */
  const signed = (pct: number) => `${pct > 0 ? "+" : ""}${pct}%`;

  // --- The chart's monthly buckets ---------------------------------------
  // IN and OUT read off qty_delta's sign, which is the same split the movement
  // table's own +/- prefix makes one column over.
  const byMonth = new Map<string, { primary: number; secondary: number }>();
  for (const m of movements) {
    const key = riyadhDayKey(new Date(m.created_at)).slice(0, 7);
    const b = byMonth.get(key) ?? { primary: 0, secondary: 0 };
    if (m.qty_delta > 0) b.primary += m.qty_delta;
    else b.secondary += Math.abs(m.qty_delta);
    byMonth.set(key, b);
  }
  // ASCENDING. The query hands movements back newest-first, which is right for
  // a list a reader scans from the top and wrong for a time axis.
  const monthKeys = [...byMonth.keys()].sort();

  return {
    lang,
    rtl: lang === "ar",
    docTitle: fill(t("inventory.stock.doc.docTitle", lang), { sku: part.sku }),

    masthead: {
      eyebrow: t("inventory.stock.doc.eyebrow", lang),
      // The SKU, which the drawer's identity grid leads with. It moves to the
      // eyebrow's trailing edge because that is where a document's reference
      // belongs; the remaining three facts keep the screen's order below.
      eyebrowEnd: { label: t("inventory.shared.sku", lang), value: part.sku, num: true },
      title: arText(part.name, part.name_ar, lang),
      meta: [
        [
          { label: t("inventory.stock.thCategory", lang), value: categoryLabel(part.category, lang) },
          { label: t("inventory.shared.warehouse", lang), value: input.warehouseName ?? DASH },
          { label: t("inventory.shared.supplier", lang), value: part.supplier ?? DASH },
        ],
      ],
      // THE AVG-COST BOX'S OWN SUB-LINE, promoted. Same caption, same figure,
      // same source — `totalValue`, the lots-derived one the drawer prints
      // there, NOT computePartFinanceStats' unit_cost-derived `stockValue`,
      // which is a different question and appears in the financial summary
      // under its own heading. Only the position moves, and position is LOOK.
      figure: {
        caption: t("inventory.stock.stockValue", lang),
        // formatSar's separator and rounding without its suffix; the unit has
        // its own slot here.
        value: formatNum(totalValue),
        unit: sarUnit,
      },
    },

    stats: [
      {
        label: t("inventory.stock.currentPrice", lang),
        ...(currentLot != null
          ? {
              value: formatSar(currentLot.price_sar),
              // The box's own second line, in the chip. Not a unit of the
              // figure so much as the basis of it, which is what the screen
              // says there too.
              unit: `${t("inventory.stock.perUnit", lang)} ${unit}`.trim(),
            }
          : { absent: DASH }),
      },
      {
        label: t("inventory.stock.previousPrice", lang),
        ...(previousLot != null ? { value: formatSar(previousLot.price_sar) } : { absent: DASH }),
      },
      {
        label: t("inventory.stock.avgCost", lang),
        // TWO DECIMALS, the drawer's one deliberate exception to whole-riyal
        // money (Turki's call, stated at the render site). Every other SAR
        // figure on this sheet is whole.
        ...(avgCost != null ? { value: `${formatNum(avgCost, 2)} ${sarUnit}` } : { absent: DASH }),
      },
      {
        label: t("inventory.stock.thStock", lang),
        value: String(part.qty_on_hand),
        ...(unit ? { unit } : {}),
      },
    ],

    pricing: {
      head: t("inventory.stock.pricingSnapshot", lang),
      delta:
        priceDeltaPct != null
          ? {
              value: signed(priceDeltaPct),
              // `> 0` IS THE SCREEN'S TEST, so exactly 0 flies Drop. See header.
              flag: priceDeltaPct > 0 ? riseWord : dropWord,
            }
          : null,
      singleTier: t("inventory.stock.singleTier", lang),
      health:
        (low ? t("inventory.stock.belowReorderLevel", lang) : t("inventory.stock.inStock", lang)) +
        " · " +
        `${t("inventory.stock.reorderAt", lang)} ${part.reorder_level ?? DASH}`,
      fifoNote: t("inventory.stock.olderStockPrevious", lang),
    },

    lots: {
      head: t("inventory.stock.stockBatches", lang),
      cols: {
        receivedOn: t("inventory.shared.receivedOn", lang),
        qtyPurchased: t("inventory.stock.qtyPurchased", lang),
        qtyRemaining: t("inventory.stock.qtyRemaining", lang),
        unitCost: t("inventory.shared.unitCost", lang),
        // A BARE LITERAL ON THE SCREEN TOO, in both languages — this column has
        // no leaf. Inventing one here would put a word on paper the drawer does
        // not say.
        vat: "VAT (15%)",
        total: t("inventory.shared.totalInclVat", lang),
        status: t("common.status", lang),
      },
      rows: lots.map((lot, i) => {
        const isCurrent = i === lots.length - 1;
        const depleted = lot.qty_remaining <= 0;
        // qty_remaining IS THE BASIS FOR BOTH, which is what makes the row
        // foot: VAT + pre-VAT subtotal = Total. The drawer's own fix, and its
        // comment there says so.
        const subtotal = lot.qty_remaining * lot.price_sar;
        const vat = lineVat(lot.qty_remaining, lot.price_sar);
        return {
          // RAW. received_on is a date column the drawer prints unformatted.
          receivedOn: lot.received_on,
          qtyPurchased: `${lot.qty_purchased} ${unit}`.trim(),
          qtyRemaining: `${lot.qty_remaining} ${unit}`.trim(),
          unitCost: formatSar(lot.price_sar),
          vat: formatSarVat(vat),
          total: formatSarVat(subtotal + vat),
          status: lotStatusLabel({ depleted, isCurrent }, lang),
          // DEPLETED WINS in the word; the mark asks the narrower question, so
          // a depleted current lot is marked off. Same precedence the label
          // helper states.
          isCurrent: isCurrent && !depleted,
        };
      }),
      empty: t("inventory.stock.noPriceBatches", lang),
    },

    movements: {
      head: t("inventory.stock.movementHistory", lang),
      chart: {
        has: monthKeys.length >= 2,
        points:
          monthKeys.length >= 2
            ? monthKeys.map((k) => ({
                label: monthLabel(k, lang),
                primary: byMonth.get(k)!.primary,
                secondary: byMonth.get(k)!.secondary,
              }))
            : [],
        primaryLabel: t("inventory.stock.doc.stockIn", lang),
        secondaryLabel: t("inventory.stock.doc.stockOut", lang),
        aria: t("inventory.stock.doc.chartAria", lang),
      },
      cols: {
        type: t("common.type", lang),
        change: t("inventory.stock.thChange", lang),
        after: t("inventory.stock.thAfter", lang),
        note: t("common.note", lang),
        by: t("inventory.stock.thBy", lang),
        date: t("common.date", lang),
      },
      rows: movements.map((m) => ({
        type: movementLabel(m.movement_type, lang),
        // The drawer's own explicit + on a gain; a loss carries its own minus.
        change: `${m.qty_delta > 0 ? "+" : ""}${m.qty_delta}`,
        after: String(m.qty_after),
        note: m.note ?? DASH,
        by: m.created_by ?? DASH,
        // Follows the SHEET's language, not the drawer's. See header.
        date: formatDateTimeLang(m.created_at, lang, PART_DATETIME),
      })),
      empty: t("inventory.stock.noMovementsYet", lang),
    },

    finance: {
      head: t("inventory.stock.financialSummary", lang),
      rows: [
        {
          label: t("inventory.po.purchases", lang),
          value: formatSarVat(stats.purchasesTotal),
          // THE CARD'S TWO QUIET LINES, JOINED. Same figures, same order, same
          // words — a ledger row carries one sub-line, and splitting these into
          // two rows would rank the PO count beside the money. "VAT" is a bare
          // literal on the screen as well.
          sub:
            `${formatSarVat(stats.totalPurchased)} + ${formatSarVat(stats.purchasesVat)} VAT` +
            ` · ${fill(t(`inventory.po.poLines.${plural(stats.purchaseCount)}`, lang), { n: stats.purchaseCount })}`,
        },
        {
          label: `${t("inventory.po.consumption", lang)} (${t("inventory.po.allTime", lang)})`,
          // A HARD ZERO beside a non-zero quantity. Not a bug on this sheet —
          // see lib/part-finance.ts.
          value: formatSar(stats.spentByConsumption),
          sub: `${stats.totalConsumed} ${unit}`.trim(),
        },
        {
          label: t("inventory.stock.doc.stockAtCurrentPrice", lang),
          // unit_cost x qty_on_hand, NOT the masthead's lots-derived figure.
          // Both land on one filed sheet, so the captions must not collide.
          value: formatSar(stats.stockValue),
          sub: `${part.qty_on_hand} ${unit} ${t("inventory.po.inStock", lang)}`.replace("  ", " "),
        },
        {
          label: t("inventory.po.priceTrend", lang),
          value: signed(stats.priceTrendPct),
          sub: t("inventory.po.vsHistoricalBatches", lang),
          // THREE-WAY ON THE SCREEN (↑ / ↓ / →), so zero flies nothing. The
          // pricing snapshot's delta above is a two-way branch and does. Both
          // mirrored as written.
          ...(stats.priceTrendPct !== 0
            ? { flag: stats.priceTrendPct > 0 ? riseWord : dropWord }
            : {}),
        },
      ],
      tip: {
        text: tip.text,
        // The gradient badge's own word, which is a bare literal in both
        // languages on the screen. The TONE stays behind — it is colour.
        flag: "AI",
      },
    },

    reorder: {
      head: t("inventory.stock.reorderInfo", lang),
      items: [
        {
          label: t("inventory.stock.suggestedQty", lang),
          value: `${part.reorder_qty ?? DASH} ${unit}`.trim(),
          num: true,
        },
        // REPEATED FROM THE MASTHEAD DELIBERATELY, because the drawer repeats
        // it: the supplier is both an identity fact and a reorder fact there.
        { label: t("inventory.shared.supplier", lang), value: part.supplier ?? DASH },
        {
          label: t("inventory.stock.leadTime", lang),
          value:
            part.lead_time_days != null
              ? fill(t(`common.days.${plural(part.lead_time_days)}`, lang), {
                  n: part.lead_time_days,
                })
              : DASH,
          num: true,
        },
        {
          label: t("inventory.stock.totalValue", lang),
          value: reorderValue != null ? formatSar(reorderValue) : DASH,
          num: true,
        },
      ],
    },

    footer: [fill(t("inventory.stock.doc.generated", lang), { date: generated }), COMPANY],
  };
}
