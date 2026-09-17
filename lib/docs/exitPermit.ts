// EXIT PERMIT DOCUMENT RENDERER — the LOOK of the printed gate pass, and only
// the look.
//
// The other half of lib/docvm/exitPermit.ts. That file decides WHAT the sheet
// says; this one decides WHERE it sits. The boundary is the kit's own
// (lib/atlas/blocks.ts):
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// So there is NO string literal in this file that a reader will see, and no
// number is formatted here. The only literals are five column widths and one
// grid arity.
//
// WHERE IT DIFFERS FROM lib/docs/purchaseOrder.ts, and why. Both are DOCUMENTS
// and both open with a masthead carrying an identity rather than a figure. But:
//
//   - IT IS COMPACT. A purchase order is filed, read at a desk and may run to
//     several pages by nature. A permit is a GATE PASS: it is carried in a cab,
//     signed on a bonnet, and handed over. `compact` tightens the spacing and
//     the title so the ordinary permit is one sheet in one hand.
//   - EVERY BLOCK IS HEADLESS, WHICH IS WHY THIS FILE HAS NO section() CALL AND
//     NEEDS NO LAYOUT MODE. The purchase order's modal is written in headed
//     parts and its sheet mirrors them, one section per part. This screen has no
//     heading anywhere, so its sheet has none either: block() is the kit's
//     headless full-measure section and it is all this document uses.
//
//     STATED HERE BECAUSE IT IS THE OBVIOUS THING TO GET WRONG. When the kit
//     grew a top-title mode (lib/atlas/blocks.ts, SectionLayout) the permit was
//     assigned it along with the purchase order — and there is nothing to
//     assign. The gutter this file never had cannot be moved to the top, and
//     "switching" it would mean INVENTING five headings to place, which is
//     wording, which is the view-model's, and which nobody wrote on the screen
//     this mirrors. A heading that exists only on the printout is the same
//     defect as a figure that does: the sheet saying something its source does
//     not. So: no change, by argument, not by oversight.
//
//     A gutter with nothing in it is also not neutral — it reads as a heading
//     that failed to render, which is the original reason block() exists.
//   - THERE IS NO LETTERHEAD AND NO LEDGER. Nobody outside the company reads
//     this, and its one money figure is an internal note at the foot, not a
//     total anyone is being asked to pay.
//
// PAGINATION IS HONEST, AND THAT IS THE POINT OF THE REWRITE. The screen it
// replaces was pinned with `position: absolute; inset: 0` under a print
// stylesheet, which does not paginate: a permit with more lines than one sheet
// holds had the overflow CLIPPED, silently, with no mark on the paper to say so
// — a gate pass that lists nine of its eleven items and looks complete. Here the
// table simply FLOWS. `thead { display: table-header-group }` repeats the column
// heads on page two, `tr { break-inside: avoid }` keeps a line whole, and the
// signature block carries its own break-inside so it can never be split from
// itself. Nothing is positioned, so nothing can be cut off.
//
// What it does NOT do is stamp "page 1 of 2". Chromium supports no @page margin
// boxes and no counter(page) in content, so that string cannot be rendered from
// inside the document at all; the only honest options are the print dialog's own
// header and displayHeaderFooter on a generated PDF. A hand-written "1 of 2"
// would be a literal that is wrong the moment a line is added.

import {
  atlasDocShell,
  block,
  identGrid,
  masthead,
  note,
  sheetFooter,
  signatures,
  table,
  type Col,
  type Row,
} from "../atlas";
import type { ExitPermitDocVm } from "../docvm/exitPermit";

/** The Part column takes the measure the other four leave, stated so a long part
 *  name wraps instead of squeezing the figures beside it. Geometry, which is
 *  this file's to decide. */
const INDEX_W = "5%";
const SKU_W = "18%";
const QTY_W = "16%";
const VALUE_W = "18%";

/** Four across for the identity grid: the screen's own four fields in one clean
 *  row. The kit's default of three would wrap the carrier onto a second row on
 *  its own, which reads as an afterthought rather than as one of four. */
const IDENT_COLS = 4;

export function buildExitPermitHtml(vm: ExitPermitDocVm): string {
  const m = vm.masthead;

  const cols: Col[] = [
    // iso, not num: the ordinal is a figure and must not reorder inside an
    // Arabic line, but ranging it right would push it away from the part it
    // numbers and leave a gap down the leading edge of the table.
    { head: vm.lines.cols.index, iso: true, width: INDEX_W },
    // iso, not num: a part name is prose and ranges with the text, but it can
    // carry a Latin run (a brand, a size) that would reorder against Arabic
    // around it. iso isolates the run without pulling the whole cell to the
    // trailing edge — which is what `num` would do, and a name is not a figure.
    { head: vm.lines.cols.part, iso: true },
    // A SKU is an identifier: isolated, but set flush to the reading edge beside
    // the name it belongs to rather than ranged right beside the money.
    { head: vm.lines.cols.sku, iso: true, width: SKU_W },
    { head: vm.lines.cols.qty, num: true, width: QTY_W },
    { head: vm.lines.cols.value, num: true, width: VALUE_W },
  ];

  const rows: Row[] = vm.lines.rows.map((r) => ({
    cells: [r.index, { v: r.part, cls: "name" }, r.sku, r.qty, r.value],
  }));

  const body = [
    masthead({
      eyebrow: m.eyebrow,
      title: m.title,
      subtitle: m.subtitle,
      marks: m.marks,
      // Issued-at and issued-by, the screen's own top-corner block. The only
      // masthead footing on this sheet — `figure` is absent, as on every
      // document: a permit has no number that deserves 72px.
      meta: m.meta.map((line) => [...line]),
    }),

    block(identGrid(vm.ident, IDENT_COLS)),

    block(
      table({
        cols,
        rows,
        // Passed EXPLICITLY: table()'s own default is an English literal, which
        // would print English prose on the Arabic sheet.
        empty: vm.lines.empty,
      }),
    ),

    ...(vm.note ? [block(note(vm.note))] : []),

    // Between the note and the money, as on screen. It belongs on the note()
    // rail rather than in the table because it is a statement ABOUT the table:
    // it tells the reader which part of the qty column's shrinkage is stock
    // nobody is chasing any more.
    ...(vm.writtenOff ? [block(note(vm.writtenOff))] : []),

    // Small and last, as on screen: the gate copy is about WHAT left, not what
    // it was worth. note() and not a ledger — a ledger line is a step in an
    // argument the reader is meant to follow, and this is a caveat nobody at the
    // gate is being asked to act on.
    block(note(vm.internalValue)),

    // The declaration rides the signature section — the sheet's one print-only
    // addition (Turki, 2026-09-18). The kit's wrapper keeps the paragraph and
    // the rules on one page; passing it here rather than as its own block is
    // what makes it PART of the section instead of a neighbour to it.
    signatures(
      vm.signatures.map((label) => ({ label })),
      vm.declaration,
    ),

    sheetFooter(vm.footer),
  ].join("\n");

  return atlasDocShell({
    lang: vm.lang,
    dir: vm.rtl ? "rtl" : "ltr",
    title: vm.docTitle,
    compact: true,
    body,
  });
}
