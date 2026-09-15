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

/** THE SHEET'S OWN SPACING, tightened, because at the kit's 26px rhythm the
 *  fullest Arabic purchase order misses one page BY 26px.
 *
 *  MEASURED, NOT GUESSED. PO-2026-0012 in Arabic flows 1024px into a 997.8px
 *  content box (A4 less the kit's own 17mm/16mm margins). What sits in the
 *  26.2px past the break is the FOOTER and nothing else — it starts at 1007px,
 *  nine pixels over — so the order prints a second sheet of paper carrying one
 *  provenance line. The English twin of the same order fits at 920px, and that
 *  gap is the tell: this is Arabic line height on a sheet already at the edge,
 *  not a fixture that is simply too long. A sheet with a real second page of
 *  content is a different thing and is left alone (see below).
 *
 *  WHY NOT `compact: true`, which is the kit's own answer to this and which
 *  lib/atlas/shell.ts argues for by name ("a body class rather than an extraCss
 *  string passed per document, so the SECOND compact document inherits the same
 *  decisions"). Because that register is not only spacing — it drops the title
 *  27px -> 21px — and this document has already refused it on the record:
 *  lib/docs/exitPermit.ts states that the permit is compact and the purchase
 *  order is not, a permit being a gate pass read in one hand while "a purchase
 *  order is filed, read at a desk and may run to several pages by nature." That
 *  distinction is about the sheet's identity, and an orphaned footer is not a
 *  reason to give it up. So: the compact register's SPACING values, none of its
 *  type changes.
 *
 *  TWO LEVERS, AND ONLY TWO — AND THE ARITHMETIC IS NOT THE ARITHMETIC. The
 *  masthead gap looks like a third lever and is not: `.mast` margin-bottom
 *  COLLAPSES against the first section's margin-top, so the gap is max(20, 17)
 *  and dropping the masthead to 14 moves the page by exactly zero. That rule
 *  was written, measured, and deleted. The same collapse is why the section
 *  rhythm is not paid five times either — the first section's margin is the
 *  masthead's 20, not 17, so four gaps move and not five.
 *
 *  So the saving is MEASURED rather than multiplied: 1024px -> 977px, 47px, and
 *  the sheet clears its 997.8px box by 20.8px.
 *
 *  WHY 17 AND NOT 20. The target is the 26.2px overflow PLUS one full Arabic
 *  body line (10.6px at 1.72 = 18.2px), about 45px. A fix with half a line of
 *  slack is one that a supplier name wrapping, or a rejection reason running a
 *  line longer, puts straight back onto two pages — and the orders that will do
 *  that are real ones, not the six in this corpus. 20/14 was tried first, for
 *  consistency with part.ts, and buys 36px: it clears by 9.8px, half a line,
 *  which is not a margin worth committing. 17/14 buys 47px and clears by a full
 *  line with a little over.
 *
 *  NEITHER NUMBER IS NEW: 17 is the section rhythm the kit's own compact
 *  register already sets, and 14 is the footer gap part.ts already prints.
 *  Borrowing compact's SPACING while declining its type change is the whole
 *  position above, stated in values.
 *
 *  SCOPED TO THIS DOCUMENT, NOT THE KIT. `section` and `.sheet-foot` are
 *  ATLAS-wide, and every other committed sheet is laid out against the 26px
 *  rhythm — a kit edit would reflow all of them to fix an orphan none of them
 *  has. `extraCss` is the shell's per-document hook for exactly this.
 *
 *  UNCONDITIONAL, not applied only to the sheet that overflows. Two purchase
 *  orders read side by side at two different rhythms is a worse sheet than a
 *  marginally tighter one, and the tightening costs the short orders nothing:
 *  shrinking cannot push a one-page sheet onto a second. The long pagination
 *  fixture stays at two pages for the same reason — it carries 897px on its
 *  Arabic second page, so 47px comes nowhere near closing it, which is the
 *  point: this nudge removes orphans and does not remove pages. */
const PO_SPACING_CSS = `
  section { margin-top: 17px; }
  .sheet-foot { margin-top: 14px; }
`;

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
    extraCss: PO_SPACING_CSS,
  });
}
