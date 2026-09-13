// RECEIVABLES DOCUMENT RENDERER — the LOOK of the printed receivables sheet,
// and only the look.
//
// The other half of lib/docvm/receivables.ts. That file decides WHAT the sheet
// says; this one decides WHERE it sits:
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// THE HANGING GUTTER, unlike the other three statements in this batch. The open-
// invoices list is unbounded — every confirmed unpaid invoice in the business,
// which paginates — and the gutter is what gives a reader who turns to page two
// a rail to find the heading on. A stacked head scrolls away with the first
// page; a gutter head sits on the same vertical the whole run is built against.
//
// THE SEVERITY WORDS ARE THE TABLE'S OWN. `Row.flag` is what creates the gutter
// column inside a table, and it only appears when some row carries one — an
// always-present empty column is a column of nothing. So a run of invoices all
// inside 60 days prints no marker column at all, which is exactly what the
// screen does with its colour.

import {
  atlasDocShell,
  block,
  masthead,
  note,
  section,
  sheetFooter,
  statStrip,
  table,
} from "../atlas";
import type { ReceivablesDocVm } from "../docvm/receivables";

export function buildReceivablesHtml(vm: ReceivablesDocVm): string {
  const m = vm.masthead;

  // NOTHING OUTSTANDING DROPS EVERYTHING. The screen prints one sentence in
  // place of both tables — no heads and no totals row of zeros. A total of 0.00
  // under an empty table asserts a measurement that was never made.
  const content = vm.has
    ? [
        block(statStrip(vm.stats)),

        block(
          table({
            cols: [
              { head: vm.aging.cols.band },
              { head: vm.aging.cols.invoices, num: true },
              { head: vm.aging.cols.outstanding, num: true },
              { head: vm.aging.cols.share, num: true },
            ],
            rows: vm.aging.rows.map((r) => ({
              cells: [r.band, r.count, r.outstanding, { v: r.share, cls: "quiet" }],
            })),
            foot: [
              vm.aging.foot.label,
              vm.aging.foot.count,
              vm.aging.foot.outstanding,
              vm.aging.foot.share,
            ],
            compact: true,
          }),
        ),

        // NO CHART BETWEEN THE TWO TABLES. A four-band split bar sat here and
        // was removed — lib/docvm/receivables.ts carries the reasoning, because
        // the decision is about what the sheet SAYS, not how it looks. In short:
        // the kit's bar is a two-part device, and at four bands it printed some
        // names into their neighbours' figures and left the narrow bands with no
        // name at all. The aging table immediately above states all four exactly.
        //
        // This file no longer imports splitBar or the chart style, and that is
        // the whole of the change here.

        section({
          head: vm.open.head,
          body: table({
            cols: [
              { head: vm.open.cols.invoice, iso: true, gap: true },
              { head: vm.open.cols.customer },
              { head: vm.open.cols.confirmed, iso: true, gap: true },
              { head: vm.open.cols.days, num: true },
              { head: vm.open.cols.outstanding, num: true },
            ],
            rows: vm.open.rows.map((r) => ({
              cells: [
                { v: r.invoice, cls: "name" },
                r.customer,
                { v: r.confirmed, cls: "quiet" },
                r.days,
                r.outstanding,
              ],
              // undefined on a row the screen leaves un-coloured, which is what
              // keeps the marker column off a sheet that needs no markers.
              ...(r.flag ? { flag: r.flag } : {}),
            })),
          }),
        }),
      ].join("\n")
    : block(note(vm.empty));

  const body = [
    masthead({
      eyebrow: m.eyebrow,
      title: m.title,
      subtitle: m.subtitle,
      meta: m.meta,
      figure: m.figure,
    }),
    content,
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
