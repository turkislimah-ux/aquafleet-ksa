// PAYSLIP-REGISTER DOCUMENT RENDERER — the LOOK of the printed register, and
// only the look.
//
// The other half of lib/docvm/payslip-register.ts:
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// TOP TITLE. The sheet is ONE table seven columns wide and nothing else; the
// hanging gutter would spend 130px of that measure on a heading the masthead
// has already said. The revenue sheet takes the stacked head for the same
// reason, and the receivables sheet takes the gutter for the opposite one.
//
// THE TWO GREY PILLS BECOME THE KIT'S TWO MARKS — a tracked-caps word on a
// rule, solid or dashed, never a box. Basis is solid when the commission was
// actually paid out and dashed when it was only earned; Status is dashed on all
// four of its unissued words, because dashed is the kit's word for "this did not
// happen". Both are `raw` cells: the kit escapes a cell's text, and these two
// carry markup the view-model deliberately does not.
//
// THE PAYSLIP NUMBER IS ISOLATED BY HAND, not by `iso` on the column. A raw cell
// skips the column's own isolate — that is what raw means — and the same column
// carries a mark on every other row, which must NOT be run through iso(). So the
// column stays plain and the two branches each say what they are.
//
// NO WIDTH ON THE DRIVER COLUMN, so it absorbs what the six fixed ones leave. A
// register that paginates is read column by column down the page, and a name
// column that changes width between pages reads as a different table.

import {
  atlasDocShell,
  block,
  iso,
  mark,
  masthead,
  note,
  sheetFooter,
  table,
  type Row,
} from "../atlas";
import type { PayslipRegisterDocRow, PayslipRegisterDocVm } from "../docvm/payslip-register";

export function buildPayslipRegisterHtml(vm: PayslipRegisterDocVm): string {
  const m = vm.masthead;

  const row = (r: PayslipRegisterDocRow): Row => ({
    cells: [
      { v: r.driver, cls: "name" },
      { v: r.month, cls: "quiet" },
      r.salary,
      r.commission,
      { v: mark(r.basis.word, r.basis.paid), raw: true },
      // NO EXTRA WEIGHT ON NET, though the screen semibolds it. The kit has no
      // cell-level emphasis for a figure on purpose: its device for "the number
      // this sheet is about" is the masthead figure, and that slot is already
      // this column's own total. Bolding it here would rank it twice.
      r.net,
      {
        v: r.status.issued ? iso(r.status.value) : mark(r.status.value, false),
        raw: true,
      },
    ],
  });

  const body = [
    masthead({
      eyebrow: m.eyebrow,
      title: m.title,
      subtitle: m.subtitle,
      meta: m.meta,
      ...(m.figure ? { figure: m.figure } : {}),
    }),

    // THE LEAD LINE, isolated: it is two count phrases whose numerals are Latin
    // runs inside an Arabic sentence. Directly under the masthead, where the
    // screen puts it, and headless because the screen heads it with nothing.
    ...(vm.lead ? [block(note(vm.lead, { iso: true }))] : []),

    // THE EMPTY CASE DROPS THE HEAD ROW TOO, rather than passing `empty` to
    // table(). On screen there is no table at all when no driver falls in the
    // period — seven ruled column heads over one sentence would be a shape the
    // source never has.
    block(
      vm.empty
        ? note(vm.empty)
        : table({
            // THE TWO WORD COLUMNS EACH FOLLOW A FIGURE, so the two figures
            // carry the gap. A td pays no horizontal padding at all, and a `num`
            // cell is ranged to its own trailing edge, so Commission's last
            // digit and Basis's first letter met on the column boundary with
            // nothing between them — and so did Net's and Status's. Read at
            // arm's length that is not a figure beside a word, it is one object,
            // which is the whole of what was wrong with this table.
            //
            // Paid on the FIGURE's column rather than the word's, because
            // .col-gap is padding-inline-END: put on Basis it would open air on
            // the far side, between Basis and Net, and leave the collision
            // exactly where it was. And paid on the COLUMN rather than inside
            // the mark, so the head and the totals row — neither of which
            // carries a mark — move with the body instead of drifting off it.
            cols: [
              { head: vm.cols.driver },
              { head: vm.cols.month, iso: true, width: "10%" },
              { head: vm.cols.salary, num: true, width: "12%" },
              { head: vm.cols.commission, num: true, gap: true, width: "15%" },
              { head: vm.cols.basis, width: "11%" },
              { head: vm.cols.net, num: true, gap: true, width: "13%" },
              // THE WIDEST OF THE SIX FIXED COLUMNS, for one string: the mark is
              // nowrap and "Month in progress" is the longest status the ladder
              // can produce. Sized to hold it rather than letting a last column
              // push the table wider than its measure.
              { head: vm.cols.status, width: "17%" },
            ],
            rows: vm.rows.map(row),
            // The label spans the five columns this row does not total, so the
            // figure lands under the column it foots and nowhere else. The
            // trailing cell keeps Status empty: a total has no status.
            ...(vm.foot
              ? {
                  foot: [
                    { v: vm.foot.label, colSpan: 5 },
                    vm.foot.net,
                    "",
                  ],
                }
              : {}),
          }),
    ),

    ...(vm.note ? [block(note(vm.note))] : []),

    sheetFooter(vm.footer),
  ].join("\n");

  return atlasDocShell({
    lang: vm.lang,
    dir: vm.rtl ? "rtl" : "ltr",
    title: vm.docTitle,
    body,
  });
}
