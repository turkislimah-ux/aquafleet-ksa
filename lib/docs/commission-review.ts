// COMMISSION-REVIEW DOCUMENT RENDERER — the LOOK of the printed review, and
// only the look.
//
// The other half of lib/docvm/commission-review.ts:
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// TOP TITLE, like the register it sits under. The sheet is one wide table and
// two paragraphs; the hanging gutter would spend 130px of the measure on a
// heading the masthead has already said.
//
// THE STANDFIRST IS A PLAIN NOTE DIRECTLY UNDER THE MASTHEAD. On screen the
// distinction is a brand-tinted panel, which in one colour is a grey wash
// around text that reads the same without it. Set as a note it keeps the
// position the screen gives it — above everything the sheet measures — and
// spends no rule and no fill saying so.
//
// PROJECTS SERVED IS THE ONE RAW CELL. `runs()` composes it inside the kit,
// which is where composition belongs: the labels are project names, user text,
// and a renderer building that markup itself would be the first file in
// lib/docs/ to need `esc`. It escapes the name and isolates the count. Both
// halves are set in full ink — the count is the measurement, not a footnote to
// the name beside it; see the RUNS block in lib/atlas/shell.ts.
//
// THE DRIVER COLUMN IS `iso` AND CARRIES NO WIDTH. Isolated because an
// ambiguous name arrives with `#abcd` appended and that Latin run has to be
// pinned inside an Arabic name; unwidthed so it absorbs what the three fixed
// columns leave, because a review that paginates is read column by column and a
// name column that changes width between pages reads as a different table.
//
// THE TOTAL ROW IS `foot`, WHICH IS WHERE IT WAS ALWAYS GOING. On screen it is
// the last <tr> of the tbody, ruled off by hand. The kit's tfoot is
// display: table-row-group precisely so a paginating table prints its total
// ONCE, at the end — grep the table CSS in lib/atlas/shell.ts for why
// table-footer-group is the wrong answer. The trailing cell keeps Projects
// served empty: a total serves no project.

import {
  atlasDocShell,
  block,
  masthead,
  note,
  runs,
  sheetFooter,
  statStrip,
  table,
  type Row,
} from "../atlas";
import type {
  CommissionReviewDocRow,
  CommissionReviewDocVm,
} from "../docvm/commission-review";

export function buildCommissionReviewHtml(vm: CommissionReviewDocVm): string {
  const m = vm.masthead;

  const row = (r: CommissionReviewDocRow): Row => ({
    cells: [
      { v: r.driver, cls: "name" },
      r.trips,
      { v: runs(r.projects), raw: true },
      r.commission,
    ],
  });

  const body = [
    masthead({
      eyebrow: m.eyebrow,
      title: m.title,
      subtitle: m.subtitle,
      meta: m.meta,
    }),

    block(note(vm.caveat)),

    ...(vm.stats.length ? [block(statStrip(vm.stats))] : []),

    block(
      vm.empty
        ? note(vm.empty)
        : table({
            // TRIPS CARRIES THE GAP, and it is the only column that needs one.
            // It is ranged to its own trailing edge and a td pays no horizontal
            // padding, so its figure landed on the first letter of the first
            // project name with nothing in between — two columns reading as one.
            // Paid here rather than on Projects because .col-gap is
            // padding-inline-END: on Projects it would open air between the runs
            // and Commission and leave the collision untouched.
            //
            // PROJECTS IS THE WIDEST COLUMN BY A LONG WAY, and that is the shape
            // of the data rather than a preference: every other cell on the row
            // is one short value and this one is a stacked list of project names
            // with their counts. The three fixed columns are cut to what they
            // actually hold so the measure they leave goes here.
            cols: [
              { head: vm.cols.driver, iso: true },
              { head: vm.cols.trips, num: true, gap: true, width: "11%" },
              { head: vm.cols.projects, width: "44%" },
              { head: vm.cols.commission, num: true, width: "17%" },
            ],
            rows: vm.rows.map(row),
            ...(vm.foot
              ? { foot: [vm.foot.label, vm.foot.trips, "", vm.foot.commission] }
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
