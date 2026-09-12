// PURCHASE ORDER DOCUMENT RENDERER — the LOOK of the printed purchase order,
// and only the look.
//
// The other half of lib/docvm/purchaseOrder.ts. That file decides WHAT the
// sheet says; this one decides WHERE it sits. The boundary is the kit's own
// (lib/atlas/blocks.ts):
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// So there is NO string literal in this file that a reader will see, and no
// number is formatted here. The only literals are geometry (four column widths
// and one grid arity) and the class name of a rule the shell already declares.
//
// WHERE IT DIFFERS FROM lib/docs/breakdown.ts, and why. The breakdown is a
// REPORT: it opens with a masthead carrying a meta block and a headline figure,
// then argues its case in charts. This is a DOCUMENT. It states an instruction
// to a supplier, so:
//
//   - The masthead carries a LETTERHEAD and no figure. A report is read by the
//     people who commissioned it and needs no return address; a purchase order
//     leaves the building, and the identity on its face is what makes it
//     actionable. `Masthead.figure` is deliberately absent on a document — the
//     money is a foot callout under the lines it totals, where it can be
//     checked, not a headline to be read before the reader knows what it is for.
//   - The identity is an identGrid in the first section rather than masthead
//     meta, because it is EIGHT fields. Two of them are dates that arrive after
//     issue, so the grid is a form with blanks, and a form belongs in the body.
//   - There is no chart on this sheet at all. Nothing here is a trend.
//   - EVERY SECTION TAKES layout: "top". The kit's hanging gutter is a report
//     device: it turns the titles into a rail down the edge of a page somebody
//     skims for a finding. Nobody skims a purchase order — it is read once,
//     top to bottom, and acted on. What it needs instead is WIDTH, because its
//     line table places six columns and the gutter costs 130px of the measure
//     they share. The gutter is a per-report choice now (lib/atlas/blocks.ts,
//     SectionLayout) and this document makes the other one.
//
// NO defList IMPORT, AND NOTHING CALLS IT HERE. It rendered a Transfer Details
// block that has been removed — the reason is a mirror-law argument and it is
// written where the data was built, in lib/docvm/purchaseOrder.ts above the
// return.

import {
  atlasDocShell,
  identGrid,
  ledger,
  masthead,
  note,
  section,
  sheetFooter,
  table,
  type Col,
  type Row,
} from "../atlas";
import type { PurchaseOrderDocVm } from "../docvm/purchaseOrder";

/** The Part column takes the measure the five figure columns leave, stated so a
 *  long part name wraps instead of squeezing the figures it is priced against.
 *  Geometry, which is this file's to decide. */
const PART_W = "34%";
const QTY_W = "10%";
const MONEY_W = "14%";

/** Four across for the order grid: eight fields in two clean rows of four. The
 *  kit's default of three would leave a widowed field on a third row. */
const IDENT_COLS = 4;

export function buildPurchaseOrderHtml(vm: PurchaseOrderDocVm): string {
  const m = vm.masthead;

  // THE QUANTITY COLUMN EXISTS OR IT DOES NOT — the view-model decided that,
  // once, for the whole document. This file only lays out the answer: a null
  // head means no column, so the spec and every row are built from the same
  // condition and cannot disagree about how many cells a row has.
  const split = vm.lines.cols.received != null;

  const cols: Col[] = [
    // iso, not num: a part name is prose and ranges with the text, but it can
    // carry a Latin run (a brand, a size, the SKU beneath it) that would
    // reorder against Arabic around it. iso isolates the run without pulling
    // the whole cell to the trailing edge — which is exactly what `num` would
    // do, and a name is not a figure.
    { head: vm.lines.cols.part, iso: true, width: PART_W },
    { head: vm.lines.cols.ordered, num: true, width: QTY_W },
    ...(split ? [{ head: vm.lines.cols.received as string, num: true, width: QTY_W }] : []),
    { head: vm.lines.cols.unitCost, num: true, width: MONEY_W },
    { head: vm.lines.cols.vat, num: true, width: MONEY_W },
    { head: vm.lines.cols.subtotal, num: true, width: MONEY_W },
  ];

  const rows: Row[] = vm.lines.rows.map((r) => ({
    cells: [
      // The SKU hangs under the name rather than beside it. On screen it is a
      // muted mono line ABOVE the name; the stacking is the same fact in the
      // same cell, and which of the two is uppermost is a look.
      { v: r.part, cls: "name", sub: r.sku },
      r.ordered,
      ...(split ? [r.received as string] : []),
      { v: r.unitCost, ...(r.unitCostSub ? { sub: r.unitCostSub } : {}) },
      { v: r.vat, cls: "quiet" },
      r.subtotal,
    ],
  }));

  const body = [
    masthead({
      eyebrow: m.eyebrow,
      title: m.title,
      ...(m.supplierName ? { subtitleLead: m.supplierName } : {}),
      ...(m.warehouseName ? { subtitle: m.warehouseName } : {}),
      marks: m.marks,
      letterhead: { name: m.letterheadName, lines: m.letterheadLines },
      // Empty by design, and the kit omits the footing rather than printing an
      // empty strip for it. Everything a report would put here is either in the
      // letterhead above or the order grid below.
      meta: [],
    }),

    section({
      layout: "top",
      head: vm.order.head,
      body: identGrid(vm.order.items, IDENT_COLS),
    }),

    ...(vm.supplier
      ? [
          section({
            layout: "top",
            head: vm.supplier.head,
            body: identGrid(vm.supplier.items, IDENT_COLS),
          }),
        ]
      : []),

    section({
      layout: "top",
      head: vm.lines.head,
      // The money sits INSIDE the line-items section, under the table it totals
      // and under the same head, so nothing has to name it twice. A section of
      // its own would put a heading on three figures that the table above
      // already names.
      body:
        table({
          cols,
          rows,
          // Passed EXPLICITLY: table()'s own default is an English literal,
          // which would print English prose on the Arabic sheet.
          empty: vm.lines.empty,
        }) +
        (vm.lines.rows.length ? ledger(vm.lines.money) : ""),
    }),

    ...(vm.note
      ? [section({ layout: "top", head: vm.note.head, body: note(vm.note.body) })]
      : []),

    ...(vm.approvals
      ? [
          section({
            layout: "top",
            head: vm.approvals.head,
            sub: vm.approvals.sub,
            ...(vm.approvals.flag ? { flag: vm.approvals.flag } : {}),
            body:
              table({
                cols: [{ head: "" }],
                rows: vm.approvals.rows.map((a) => ({
                  cells: [{ v: a.approver, cls: "name", sub: a.approvedAt }],
                })),
                compact: true,
                headless: true,
                empty: vm.approvals.empty,
              }) +
              // The rejection hangs under the approvals it overrides, ruled off
              // so it cannot be read as one more of them. note() and not a
              // table row: it is a sentence about the order, not an entry in
              // the list.
              (vm.approvals.rejected
                ? `<div class="rule"></div>` + note(vm.approvals.rejected)
                : ""),
          }),
        ]
      : []),

    sheetFooter(vm.footer),
  ].join("\n");

  return atlasDocShell({
    lang: vm.lang,
    dir: vm.rtl ? "rtl" : "ltr",
    title: vm.docTitle,
    body,
  });
}
