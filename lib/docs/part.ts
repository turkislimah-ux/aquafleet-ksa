// ITEM RECORD RENDERER — the LOOK of one part's record, and only the look.
//
// The other half of lib/docvm/part.ts:
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// So there is no string literal in this file that a reader will see, and no
// number is formatted here. The only literals are column widths and one chart
// height.
//
// TOP TITLE throughout. Every block on this sheet wants the full measure: the
// batches table has seven columns, the movement table six with a wrapping note,
// and the usage figure is a chart. The hanging gutter would spend 130px of the
// measure on five headings the sheet says once each, and a chart authored
// inside it prints its labels below the 8px register the rest of the page is
// set in. Stacked heads, full measure, chart at SHEET_W.
//
// ==========================================================================
// THE SHEET HAS NO SIGNATURE BLOCK, AND THAT IS THE DIFFERENCE BETWEEN A
// RECORD AND A DOCUMENT
// ==========================================================================
// A purchase order instructs a supplier and a payout voucher hands money over,
// so both close with a rule somebody signs. An item record instructs nobody. It
// states what the drawer states, and a signature line under it would invent an
// approval step the screen has no counterpart for.
//
// ==========================================================================
// THE STAT STRIP IS ABOVE THE SECTIONS, WHICH IS THE SCREEN'S OWN ORDER
// ==========================================================================
// Unlike the payout voucher — where the strip had to be MOVED forward off the
// foot of the panel — the drawer already opens with its pricing card, directly
// under the identity grid. So the four headline figures sit where they sit on
// screen, and only the identity facts move: the SKU to the eyebrow's trailing
// edge, the other three to the masthead meta line, both of which are position
// and therefore this file's.
//
// ==========================================================================
// THE PRICING SECTION IS THREE STACKED LINES, NOT A CARD
// ==========================================================================
// On screen the price delta and the stock-health line are SUB-LINES inside two
// of the four boxes, and a stat cell has no second line. They are re-placed
// here as a callout and a note rather than dropped: the delta is a figure the
// reader acts on, so it takes the callout's weight and the severity word in the
// gutter; health and the FIFO caveat are sentences, so they are notes. Same
// words, same order, same section — only the container changes.
//
// A part with fewer than two batches has no delta at all, and then the
// view-model's `singleTier` sentence prints in the callout's place. It is a
// note because it is a sentence: there is no figure to carry.
//
// ==========================================================================
// THE CHART SITS ABOVE THE MOVEMENT TABLE, INSIDE THE SAME SECTION
// ==========================================================================
// Same construction lib/docs/operations.ts uses and for the same reasons: the
// `.chart` wrapper is the CHART's, not the section's — as a bodyClass it would
// weld the table below to the figure above it on a sheet that paginates — and
// the legend goes inside that wrapper WITHOUT being wrapped again, because
// trendLegend emits its own `.legend` and nesting one stacks two margin-tops.
//
// SHEET_W, not GUTTER_W, because these sections are `layout: "top"` and the
// chart therefore occupies the whole measure. Author at the width it will
// actually get; the shell scales anything else and takes the type down with it.
//
// The `>= 2` gate is the view-model's (`chart.has`) and is load-bearing:
// trendChart maps x by `i / (n - 1)`, which is NaN at a single point.
//
// ==========================================================================
// EVERY TRAILING-ALIGNED COLUMN WHOSE NEIGHBOUR IS LEADING-ALIGNED TAKES A GAP
// ==========================================================================
// A `td` pays no horizontal padding, so two adjacent columns meet at a shared
// edge and `col-gap` is the ONLY thing that opens air between them. Where both
// sides are trailing-aligned the values drift apart on their own and the gap is
// decoration. Where one side ranges to that shared edge and the other starts
// from it, they meet with certainty, and the gap is structure.
//
// That is not a cosmetic distinction on this sheet. Measured on an A4 proof of
// OIL-5W30 in both languages: the movement table's Change-after value landed
// flush against the note beside it and `EP-26-0005` + `59` printed as
// `EP-26-000559` — a permit number that does not exist, manufactured by two
// correct cells touching. Total + Status fused the same way (`258.75 SARold
// batch`), as did By + Date (`turkias.co@hotmail.com8/6/2026`).
//
// So the rule is declared per column, not discovered per part: a gap wherever
// the NEXT column is leading-aligned. Both tables end in a leading-aligned
// column, so both carry it on their last figure.

import {
  atlasDocShell,
  block,
  callout,
  identGrid,
  ledgerTable,
  masthead,
  mark,
  note,
  section,
  sheetFooter,
  statStrip,
  table,
  trendChart,
  trendLegend,
  type LedgerRow,
  type Row,
} from "../atlas";
import type { PartDocVm } from "../docvm/part";
import { SHEET_W, chartStyle } from "./reportSheet";

/** Status is the only column here that is a word rather than a figure or a
 *  date, so it is left unwidthed and absorbs the remainder; every column before
 *  it is fixed. Geometry, which is this file's to decide. */
const LOT_RECEIVED_W = "14%";
const LOT_QTY_W = "15%";
const LOT_COST_W = "13%";
const LOT_VAT_W = "13%";
const LOT_TOTAL_W = "18%";

/** Note is the one user-length string in the movement table, so it is the one
 *  column left to wrap. */
const MOV_TYPE_W = "14%";
const MOV_CHANGE_W = "10%";
const MOV_AFTER_W = "10%";
const MOV_BY_W = "14%";
const MOV_DATE_W = "18%";

/** The register every ATLAS trend figure is drawn at. */
const CHART_H = 212;

/** SIX SECTIONS AND A CHART, WHICH IS ONE MORE SECTION THAN ANY OTHER ATLAS
 *  SHEET CARRIES. At the kit's 26px section rhythm the Arabic record measures
 *  17px past two A4 pages — not from any single block, but from the rhythm
 *  paid six times over plus the slack an unbreakable table row leaves at the
 *  page-1 break. The overflow is the FOOTER, so the sheet prints a third page
 *  holding nothing but the provenance line.
 *
 *  These two overrides buy 44px, which clears the 17px overflow with enough
 *  headroom to absorb the worst break position a 36px Arabic row can land in.
 *  20px sits between the kit's default 26 and the 17 its own compact variant
 *  already uses, so this tightens the rhythm without inventing a new register.
 *
 *  SCOPED HERE, NOT IN THE KIT, DELIBERATELY: `section` and `.sheet-foot` are
 *  ATLAS-wide, and nine committed documents are laid out against the 26px
 *  rhythm. A kit edit would reflow every one of them to fix a sheet none of
 *  them share. `extraCss` is the shell's per-document hook for exactly this. */
const PART_SPACING_CSS = `
  section { margin-top: 20px; }
  .sheet-foot { margin-top: 14px; }
`;

export function buildPartHtml(vm: PartDocVm): string {
  const S = chartStyle(vm.rtl);
  const m = vm.masthead;

  const lotsTable = table({
    cols: [
      // A bare YYYY-MM-DD: an identifier, isolated, but set flush to the
      // reading edge rather than ranged right beside the money.
      { head: vm.lots.cols.receivedOn, iso: true, width: LOT_RECEIVED_W },
      // The two quantity heads are the longest on the sheet and each ranges to
      // its own trailing edge, so they meet head-to-head before any value does.
      { head: vm.lots.cols.qtyPurchased, num: true, gap: true, width: LOT_QTY_W },
      { head: vm.lots.cols.qtyRemaining, num: true, gap: true, width: LOT_QTY_W },
      { head: vm.lots.cols.unitCost, num: true, width: LOT_COST_W },
      { head: vm.lots.cols.vat, num: true, width: LOT_VAT_W },
      // Status is a WORD set from the leading edge; the total ranges to it.
      { head: vm.lots.cols.total, num: true, gap: true, width: LOT_TOTAL_W },
      { head: vm.lots.cols.status },
    ],
    rows: vm.lots.rows.map(
      (r): Row => ({
        cells: [
          r.receivedOn,
          r.qtyPurchased,
          r.qtyRemaining,
          r.unitCost,
          r.vat,
          r.total,
          // The one `raw` cell on the sheet. Everything else is text and the kit
          // escapes it.
          { v: mark(r.status, r.isCurrent), raw: true },
        ],
      }),
    ),
    empty: vm.lots.empty,
  });

  const movementsTable = table({
    cols: [
      { head: vm.movements.cols.type, width: MOV_TYPE_W },
      // `gap` on Change, because a signed delta is ranged to its own trailing
      // edge and a td pays no horizontal padding: without it the delta meets the
      // running total beside it and the two read as one figure.
      { head: vm.movements.cols.change, num: true, gap: true, width: MOV_CHANGE_W },
      // And on the running total, which meets the NOTE the same way — the pair
      // that printed `EP-26-000559`.
      { head: vm.movements.cols.after, num: true, gap: true, width: MOV_AFTER_W },
      { head: vm.movements.cols.note, gap: true },
      { head: vm.movements.cols.by, gap: true, width: MOV_BY_W },
      { head: vm.movements.cols.date, iso: true, width: MOV_DATE_W },
    ],
    rows: vm.movements.rows.map(
      (r): Row => ({
        cells: [r.type, r.change, r.after, { v: r.note, cls: "wrap" }, r.by, r.date],
      }),
    ),
    empty: vm.movements.empty,
  });

  // Two columns, no heads: the left side is the measure's name and the right
  // side is the figure that name states. Compact, because five short rows ruled
  // individually would put the loudest hairlines on the page under the quietest
  // block.
  const financeLedger = ledgerTable({
    cols: [{ head: "" }, { head: "", num: true }],
    rows: [
      ...vm.finance.rows.map(
        (r): LedgerRow => ({
          label: r.label,
          sub: r.sub,
          values: [r.value],
          ...(r.flag ? { flag: r.flag } : {}),
        }),
      ),
      // LAST, and a `note` row rather than a labelled one: the tip is a sentence
      // ABOUT the four figures above it, not a fifth figure. Only ledgerTable
      // carries this row, which is why the summary is a ledgerTable and not a
      // ledger.
      { note: vm.finance.tip.text, flag: vm.finance.tip.flag },
    ],
    compact: true,
    headless: true,
  });

  const body = [
    masthead({
      eyebrow: m.eyebrow,
      eyebrowEnd: m.eyebrowEnd,
      title: m.title,
      meta: m.meta,
      figure: m.figure,
    }),

    block(statStrip(vm.stats)),

    section({
      layout: "top",
      head: vm.pricing.head,
      body:
        (vm.pricing.delta
          ? callout({ value: vm.pricing.delta.value, flag: vm.pricing.delta.flag })
          : note(vm.pricing.singleTier)) +
        note(vm.pricing.health) +
        note(vm.pricing.fifoNote),
    }),

    section({ layout: "top", head: vm.lots.head, body: lotsTable }),

    section({
      layout: "top",
      head: vm.movements.head,
      body:
        (vm.movements.chart.has
          ? `<div class="chart">` +
            trendChart(S, vm.movements.chart.points, SHEET_W, CHART_H, {
              primaryLabel: vm.movements.chart.primaryLabel,
              secondaryLabel: vm.movements.chart.secondaryLabel,
              aria: vm.movements.chart.aria,
            }) +
            trendLegend(
              S,
              vm.movements.chart.primaryLabel,
              vm.movements.chart.secondaryLabel,
              SHEET_W,
            ) +
            `</div>`
          : "") + movementsTable,
    }),

    section({ layout: "top", head: vm.finance.head, body: financeLedger }),

    section({ layout: "top", head: vm.reorder.head, body: identGrid(vm.reorder.items, 4) }),

    sheetFooter(vm.footer),
  ].join("\n");

  return atlasDocShell({
    lang: vm.lang,
    dir: vm.rtl ? "rtl" : "ltr",
    title: vm.docTitle,
    body,
    extraCss: PART_SPACING_CSS,
  });
}
