// PAYSLIP DOCUMENT RENDERER — the LOOK of one driver's month, and only the look.
//
// The other half of lib/docvm/payslip.ts:
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// TOP TITLE, like the register this sheet is one row of. Everything below the
// masthead is either a ledger or a table, and both want the full measure; the
// hanging gutter would spend 130px of it on a heading the masthead has already
// said.
//
// THE EARNINGS LEDGER IS HEADLESS, because the screen heads it with nothing.
// Seven rows of label-and-figure need no "Item" and "Amount" over them — the
// labels ARE the description and the figures are all one currency. `headless`
// on ledgerTable() exists for exactly this; the P&L, whose four measure columns
// cannot be told apart without their heads, is why it is an option rather than
// the default.
//
// THE CAVEAT IS THE LEDGER'S LAST ROW, NOT A NOTE UNDER IT. On screen it is an
// amber panel after the table, and its own source comment insists it must not
// read as another figure in the arithmetic. A spanning `note` row carries no
// value cell, so it cannot: it sits inside the block it qualifies, after the
// line it qualifies, and it earns the severity GUTTER WORD — which is the whole
// of what the amber was saying and the only part of it a photocopier keeps. A
// detached note() would be true, unattached, and unranked.
//
// THE TWO CHIP COLUMNS ARE `raw`, the rest of the fines table is not. Payment
// and Settlement carry marks, which are markup; every other cell is text and the
// kit escapes it. Payment's third state is the ABSENCE of a record and prints
// the screen's own em dash rather than a third mark — a mark is a binary, and
// "we were never told" is not one of its two values.
//
// THE TYPE COLUMN IS UNWIDTHED AND WRAPS; the five after it are fixed. A fine's
// type is the only user-length string in the table, so it takes what the others
// leave. Ref and Date are `iso` and not `num`: both are Latin runs that must be
// pinned inside an Arabic row, and neither is money, so neither ranges right
// beside the amount. The kit defines no monospace class on purpose — one
// typeface throughout — so `iso` is the whole of a reference's treatment.
//
// THE PAYOUTS TABLE IS HEADLESS AND COMPACT, because on screen it is a list of
// middot-joined sentences and not a table at all. Three short columns keep the
// dates under the dates and the money under the money, which is the only thing
// the table shape is buying; heading them would rule off three words over three
// facts a reader already has from the section head above.

import {
  atlasDocShell,
  block,
  ledgerTable,
  mark,
  masthead,
  note,
  section,
  sheetFooter,
  table,
  type LedgerRow,
  type Row,
} from "../atlas";
import type { PayslipDocFine, PayslipDocVm } from "../docvm/payslip";

export function buildPayslipHtml(vm: PayslipDocVm): string {
  const m = vm.masthead;

  const lines: LedgerRow[] = [
    ...vm.lines.map(
      (l): LedgerRow => ({
        label: l.label,
        // ONE CELL, because the ledger is two columns. The value is already
        // written — minus sign, separators and unit — and the column's `num`
        // isolates it.
        values: [l.value],
        ...(l.mark ? { mark: l.mark } : {}),
        ...(l.sub ? { sub: l.sub } : {}),
        ...(l.rule ? { rule: true } : {}),
        ...(l.strong ? { strong: true } : {}),
      }),
    ),
    // LAST, after Net pay. See the header.
    ...(vm.caveat
      ? [{ note: vm.caveat.text, flag: vm.caveat.flag } as LedgerRow]
      : []),
  ];

  const fineRow = (r: PayslipDocFine): Row => ({
    cells: [
      { v: r.label, cls: "wrap" },
      r.ref,
      r.amount,
      { v: r.date, cls: "quiet" },
      { v: r.payment ? mark(r.payment.word, r.payment.paid) : "—", raw: true },
      { v: mark(r.settlement.word, r.settlement.deducted), raw: true },
    ],
  });

  const finesBody = vm.fines.rows.length
    ? table({
        // TWO GAPS, AND THE SECOND ONE IS NEW BECAUSE THE MARK CHANGED. Amount
        // is ranged to its own trailing edge and a td pays no horizontal
        // padding, so its figure met the date beside it — the same collision the
        // register had. And Payment and Settlement are now two ruled words
        // rather than two boxes: a box carried 8px of its own padding and kept
        // them apart by accident, where two underlined caps runs meeting on a
        // column boundary read as one underlined phrase. The mark gave that
        // padding up on purpose; this is where it is paid back, on the column,
        // so the head and the totals row move with the body.
        cols: [
          { head: vm.fines.cols.type },
          { head: vm.fines.cols.ref, iso: true, width: "16%" },
          { head: vm.fines.cols.amount, num: true, gap: true, width: "14%" },
          { head: vm.fines.cols.date, iso: true, width: "15%" },
          { head: vm.fines.cols.payment, gap: true, width: "14%" },
          { head: vm.fines.cols.settlement, width: "15%" },
        ],
        rows: vm.fines.rows.map(fineRow),
        // The label spans Type and Ref so the figure lands under Amount and
        // nowhere else. The three trailing cells stay empty: a total was neither
        // dated, nor paid to an authority, nor deducted — those are facts about
        // a fine, and this row is not one.
        ...(vm.fines.foot
          ? {
              foot: [
                { v: vm.fines.foot.label, colSpan: 2 },
                vm.fines.foot.total,
                "",
                "",
                "",
              ],
            }
          : {}),
      })
    : note(vm.fines.none ?? "");

  const body = [
    masthead({
      eyebrow: m.eyebrow,
      title: m.title,
      subtitle: m.subtitle,
      meta: m.meta,
      ...(m.marks ? { marks: m.marks } : {}),
      figure: m.figure,
    }),

    // DIRECTLY UNDER THE MASTHEAD, where the screen puts both of the callouts
    // this stands in for. Headless, because the screen heads it with nothing.
    ...(vm.standfirst ? [block(note(vm.standfirst))] : []),

    block(
      ledgerTable({
        cols: [{ head: "" }, { head: "", num: true, width: "26%" }],
        rows: lines,
        compact: true,
        headless: true,
      }),
    ),

    section({
      layout: "top",
      head: vm.fines.head,
      ...(vm.fines.source ? { sub: vm.fines.source } : {}),
      body: finesBody,
    }),

    ...(vm.payouts
      ? [
          section({
            layout: "top",
            head: vm.payouts.head,
            body: [
              table({
                cols: [
                  { head: "", iso: true, width: "22%" },
                  { head: "" },
                  { head: "", num: true, width: "22%" },
                ],
                rows: vm.payouts.rows.map(
                  (p): Row => ({ cells: [p.date, p.period, p.total] }),
                ),
                compact: true,
                headless: true,
              }),
              // ISOLATED: the sentence quotes two ISO dates inside prose, which
              // is the one shape note() was given the flag for.
              ...(vm.payouts.covers
                ? [note(vm.payouts.covers, { iso: true })]
                : []),
            ].join("\n"),
          }),
        ]
      : []),

    ...vm.notes.map((n) => block(note(n))),

    sheetFooter(vm.footer),
  ].join("\n");

  return atlasDocShell({
    lang: vm.lang,
    dir: vm.rtl ? "rtl" : "ltr",
    title: vm.docTitle,
    body,
  });
}
