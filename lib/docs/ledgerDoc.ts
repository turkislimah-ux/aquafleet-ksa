// LEDGER DOCUMENT RENDERER — the LOOK of the top-up receipt and the credit
// note, and only the look.
//
// The other half of lib/docvm/ledgerDoc.ts. Same boundary as every pair in
// this directory: DATA, GROUPING and WORDING come from the view-model; the
// LOOK is this file's, and only the look. No string literal here ever reaches
// a reader; the only literal is one grid arity.
//
// WHERE IT SITS BETWEEN THE OTHER TWO DOCUMENTS, and why:
//
//   - COMPACT, like the exit permit. A receipt is handed across a desk and
//     kept in a pocket or a file; it is one sheet by nature and its content
//     cannot grow — there is no line table at all, so pagination has nothing
//     to paginate.
//   - LETTERHEAD, like the purchase order. This paper leaves the building in
//     a customer's hand and certifies money moved; it states who is
//     certifying on its face.
//   - HEADLESS BLOCKS, like the exit permit. There are no sections to name —
//     the sheet is one continuous statement: who, how much, how, signed.
//   - A MASTHEAD FIGURE, like no other document. The receipt exists to state
//     one sum; the view-model's header argues why the report-grammar figure
//     is the honest slot for it.

import { atlasDocShell, block, identGrid, masthead, note, sheetFooter, signatures } from "../atlas";
import type { LedgerDocVm } from "../docvm/ledgerDoc";

/** Four across: the row's four fields (date, method, reference, recorded-by)
 *  in one clean line, exactly the exit permit's reasoning — three would wrap
 *  the fourth onto its own row as an afterthought. */
const IDENT_COLS = 4;

export function buildLedgerDocHtml(vm: LedgerDocVm): string {
  const m = vm.masthead;

  const body = [
    masthead({
      eyebrow: m.eyebrow,
      title: m.title,
      subtitleLead: m.subtitleLead,
      ...(m.letterhead
        ? { letterhead: { name: m.letterhead.name, lines: m.letterhead.lines } }
        : {}),
      figure: m.figure,
      meta: m.meta.map((line) => [...line]),
    }),

    block(identGrid(vm.ident, IDENT_COLS)),

    // The one fixed sentence saying which way the money moved — a statement
    // ABOUT the figure, which is note()'s grammar.
    block(note(vm.line)),

    ...(vm.note ? [block(note(vm.note))] : []),

    signatures(vm.signatures.map((label) => ({ label }))),

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
