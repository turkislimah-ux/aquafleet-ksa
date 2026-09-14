// COST DOCUMENT RENDERER — the LOOK of the printed cost sheet, and only the
// look.
//
// The other half of lib/docvm/cost.ts. That file decides WHAT the sheet says;
// this one decides WHERE it sits:
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// So there is NO string literal here that a reader will see, and no number is
// formatted here. The only literals are geometry.
//
// THE HANGING GUTTER, Turki's split for this sheet. Five named sections run
// down it — fill, maintenance, payroll, commissions, purchasing — and the
// maintenance table alone can carry forty trucks, so the run paginates. A
// stacked head scrolls away with the page it opened; a gutter head sits on the
// same vertical the whole run is built against, which is the rail a reader who
// turns to page two finds the heading on.
//
// TWO PAIRS, BOTH THE SCREEN'S OWN. The fill tables are a `lg:grid-cols-2` and
// the commission panels a `sm:grid-cols-2` — side by side is the GROUPING, not
// a look this file chose, and stacking them would be a deviation. Everything
// else on the sheet runs full measure.
//
// THE CHART SITS BEFORE THE FIRST SECTION, headless, at the FULL measure. It
// decomposes the masthead figure and names no section, so a heading over it
// would be a word on the paper nobody wrote; and being outside the gutter grid
// it gets the whole 657 rather than the 527 a section's content column has.

import {
  atlasDocShell,
  block,
  masthead,
  note,
  pair,
  rankedBars,
  section,
  sheetFooter,
  statStrip,
  table,
} from "../atlas";
import type { CostDocFillRow, CostDocLine, CostDocVm } from "../docvm/cost";
import { SHEET_W, chartStyle } from "./reportSheet";

export function buildCostHtml(vm: CostDocVm): string {
  const S = chartStyle(vm.rtl);
  const m = vm.masthead;

  // The four-column fill table, built twice against two different heads. The
  // two tables are the same SHAPE by construction — each is a complete
  // partition of one total — so they are one function, and the pair cannot end
  // up with its columns out of step.
  const fillTable = (
    cols: { group: string; fills: string; uncosted: string; cost: string },
    rows: readonly CostDocFillRow[],
  ) =>
    table({
      cols: [
        { head: cols.group },
        { head: cols.fills, num: true },
        { head: cols.uncosted, num: true },
        { head: cols.cost, num: true },
      ],
      rows: rows.map((r) => ({ cells: [r.label, r.fills, r.uncosted, r.cost] })),
      foot: [vm.fills.foot.label, vm.fills.foot.fills, vm.fills.foot.uncosted, vm.fills.foot.cost],
      // Short tables, and at half measure the row rules would be the loudest
      // thing in the block. Leading separates them.
      compact: true,
    });

  // The label/amount ledger shape shared by payroll, both commission panels and
  // purchasing. table() rather than ledger() because each of these carries its
  // own two column HEADS on screen, and ledger() is the headless form.
  const lines = (
    headLabel: string,
    headValue: string,
    rows: readonly CostDocLine[],
    foot?: CostDocLine,
  ) =>
    table({
      cols: [{ head: headLabel }, { head: headValue, num: true }],
      rows: rows.map((r) => ({ cells: [r.label, r.value] })),
      ...(foot ? { foot: [foot.label, foot.value] } : {}),
      compact: true,
    });

  const body = [
    masthead({
      eyebrow: m.eyebrow,
      title: m.title,
      subtitle: m.subtitle,
      meta: m.meta,
      figure: m.figure,
    }),

    block(statStrip(vm.stats)),

    // NO `has` GATE on the chart, unlike the split bars on the other two sheets.
    // rankedBars divides by `Math.max(...values, 1)`, so an all-zero period
    // cannot divide by zero; it prints five labelled rows with no bars against
    // a common baseline, which is the honest picture of a period that cost
    // nothing. (This comment used to justify the missing gate by those rows
    // drawing five HAIRLINES. They no longer do — a zero bucket draws no rect
    // at all, because a 1.2px mark next to "0.00 SAR" contradicted its own
    // number. See `rankedBars` for the Jun 2026 case that showed it.)
    block(
      `<div class="chart">` +
        rankedBars(S, vm.chart.bars, SHEET_W, { aria: vm.chart.aria }) +
        `</div>`,
    ),

    section({
      head: vm.fills.head,
      ...(vm.fills.flag ? { flag: vm.fills.flag } : {}),
      // NO bodyClass: pair() emits its own .pair grid, and setting one as well
      // nests a two-column grid inside one cell of another — the trailing table
      // collapses to half of a half.
      body:
        // THE ONE ISOLATED NOTE ON THE SHEET. This lead quotes the fill total
        // WITH its unit and then two counts, separated by middots, so on the
        // Arabic sheet it is a mixed-direction line and the browser moves the
        // unit: measured, it printed the amount, then the costed count, then
        // SAR. Every other note here is prose or prose plus a single figure,
        // where isolation is inert - see `note`.
        note(vm.fills.lead, { iso: true }) +
        (vm.fills.has
          ? pair(
              {
                label: vm.fills.byTypeLabel,
                body: fillTable(vm.fills.typeCols, vm.fills.byType),
              },
              {
                label: vm.fills.byStationLabel,
                body: fillTable(vm.fills.stationCols, vm.fills.byStation),
              },
            )
          : // The screen drops BOTH tables and their two sub-heads for one
            // sentence. Passing `empty` to table() instead would keep eight
            // ruled column heads over nothing.
            note(vm.fills.empty)),
    }),

    section({
      head: vm.maint.head,
      body:
        (vm.maint.has
          ? table({
              cols: [
                // The plate is an identifier — a Latin run inside an Arabic
                // column — so it is isolated without being ranged right beside
                // the money.
                { head: vm.maint.cols.truck, iso: true, gap: true },
                { head: vm.maint.cols.parts, num: true },
                { head: vm.maint.cols.outsourced, num: true },
                { head: vm.maint.cols.total, num: true },
              ],
              rows: vm.maint.rows.map((r) => ({
                cells: [
                  { v: r.plate, cls: "name" },
                  { v: r.parts, cls: "quiet" },
                  { v: r.os, cls: "quiet" },
                  r.total,
                ],
              })),
              foot: [
                vm.maint.foot.label,
                vm.maint.foot.parts,
                vm.maint.foot.os,
                vm.maint.foot.total,
              ],
              // NOT compact. This is the one table on the sheet that can run to
              // forty rows and across a page break, and there the row rules are
              // what let the eye track a plate across four columns.
            })
          : note(vm.maint.empty)) + note(vm.maint.note),
    }),

    section({
      head: vm.payroll.head,
      body:
        lines(
          vm.payroll.cols.component,
          vm.payroll.cols.amount,
          vm.payroll.rows,
          vm.payroll.foot,
        ) + note(vm.payroll.note),
    }),

    section({
      head: vm.commissions.head,
      body:
        pair(
          {
            // The panel's first column head IS its label on screen. Printed
            // once, as the pair's ruled label — the kit's `.pairlabel + table
            // th` rule drops the head row's rule underneath it, so the two read
            // as one heading rather than two stacked ones.
            label: vm.commissions.earnedLabel,
            body: lines(
              "",
              vm.commissions.earnedAmount,
              vm.commissions.earnedRows,
              vm.commissions.earnedFoot,
            ),
          },
          {
            // Value, not Amount: the panel's first row is a payout count. The
            // two panels sit side by side with different numeric heads on
            // purpose — one is money throughout, the other is not.
            label: vm.commissions.paidLabel,
            body: lines(
              "",
              vm.commissions.paidValue,
              vm.commissions.paidRows,
              vm.commissions.paidFoot,
            ),
          },
        ) + note(vm.commissions.note),
    }),

    section({
      head: vm.purchasing.head,
      body:
        lines(vm.purchasing.cols.measure, vm.purchasing.cols.value, vm.purchasing.rows) +
        note(vm.purchasing.note),
    }),

    sheetFooter(vm.footer),
  ].join("\n");

  return atlasDocShell({
    lang: vm.lang,
    dir: vm.rtl ? "rtl" : "ltr",
    title: vm.docTitle,
    body,
  });
}
