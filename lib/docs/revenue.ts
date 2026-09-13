// REVENUE DOCUMENT RENDERER — the LOOK of the printed revenue statement, and
// only the look.
//
// The other half of lib/docvm/revenue.ts. That file decides WHAT the sheet says;
// this one decides WHERE it sits. The boundary is the kit's own:
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// So there is NO string literal in this file that a reader will see, and no
// number is formatted here. The only literals are geometry.
//
// TOP TITLES, NOT THE HANGING GUTTER. This sheet is one wide table after
// another — five money columns by customer, three by returned invoice — and the
// gutter costs 130px of measure to hold two short headings. A report whose
// content is tabular takes the stacked head; the receivables sheet, whose open-
// invoices list runs for pages and needs a rail the eye can find a heading on
// mid-run, takes the gutter. Both modes are the kit's; neither is a default.

import {
  atlasDocShell,
  block,
  masthead,
  note,
  section,
  sheetFooter,
  splitBar,
  statStrip,
  table,
} from "../atlas";
import type { RevenueDocVm } from "../docvm/revenue";
import { SHEET_W, chartStyle } from "./reportSheet";

export function buildRevenueHtml(vm: RevenueDocVm): string {
  const S = chartStyle(vm.rtl);
  const m = vm.masthead;

  const body = [
    masthead({
      eyebrow: m.eyebrow,
      title: m.title,
      subtitle: m.subtitle,
      meta: m.meta,
      figure: m.figure,
    }),

    block(statStrip(vm.stats)),

    // NO HEAD ON THE MAIN TABLE, because the screen writes none: it follows the
    // title directly, and a heading invented here would be a word on the paper
    // nobody wrote. block() is the kit's headless section — not section() with
    // an empty head, which reserves the gutter and hangs the table beside a
    // blank.
    //
    // THE EMPTY CASE DROPS THE HEAD ROW TOO, rather than passing `empty` to
    // table(). On screen there is no table at all when no invoice was confirmed
    // — five ruled column heads over one sentence would be a shape the source
    // never has.
    block(
      vm.byCustomer.rows.length
        ? table({
            cols: [
              { head: vm.byCustomer.cols.customer },
              { head: vm.byCustomer.cols.invoices, num: true },
              { head: vm.byCustomer.cols.revenue, num: true },
              { head: vm.byCustomer.cols.paid, num: true },
              { head: vm.byCustomer.cols.outstanding, num: true },
            ],
            rows: vm.byCustomer.rows.map((r) => ({
              cells: [{ v: r.name, cls: "name" }, r.count, r.revenue, r.paid, r.outstanding],
            })),
            foot: [
              vm.byCustomer.foot.label,
              vm.byCustomer.foot.count,
              vm.byCustomer.foot.revenue,
              vm.byCustomer.foot.paid,
              vm.byCustomer.foot.outstanding,
            ],
          })
        : note(vm.byCustomer.empty),
    ),

    // THE SPLIT BAR, headless for the same reason the table above is: it plots
    // two figures the table has just printed and needs no third name for them.
    // `has` is not tidiness — splitBar normalises by the sum of its parts, so a
    // period with nothing paid and nothing outstanding is a division by zero.
    // The view-model carries the sentence that prints instead.
    block(
      vm.bar.has
        ? `<div class="chart">` +
          splitBar(S, vm.bar.parts, SHEET_W, 74, {
            total: vm.bar.total,
            footnote: vm.bar.footnote,
            aria: vm.bar.aria,
          }) +
          `</div>`
        : note(vm.bar.empty),
    ),

    section({
      head: vm.returns.head,
      layout: "top",
      body: vm.returns.rows.length
        ? table({
            cols: [
              { head: vm.returns.cols.invoice, iso: true },
              { head: vm.returns.cols.reason },
              { head: vm.returns.cols.reversed, num: true },
            ],
            rows: vm.returns.rows.map((r) => ({
              cells: [{ v: r.invoice, cls: "name" }, { v: r.reason, cls: "quiet" }, r.reversed],
            })),
            // The label spans the two descriptive columns so the total lands
            // under the figures it totals — the screen leaves the middle cell
            // blank to the same end. table() walks the span to pick each foot
            // cell's column spec; dropping it puts the total out of line.
            foot: [{ v: vm.returns.foot.label, colSpan: 2 }, vm.returns.foot.total],
          })
        : note(vm.returns.empty),
    }),

    block(note(vm.note)),

    sheetFooter(vm.footer),
  ].join("\n");

  return atlasDocShell({
    lang: vm.lang,
    dir: vm.rtl ? "rtl" : "ltr",
    title: vm.docTitle,
    body,
  });
}
