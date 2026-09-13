// DAILY-TRIPS DOCUMENT RENDERER — the LOOK of the printed daily record, and
// only the look.
//
// The other half of lib/docvm/daily-trips.ts:
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// TOP TITLES. Every project is a section with its name above its own table at
// full measure. The gutter mode would hang eight project names down a 104px
// rail and lend the rail width the five columns need; this sheet is a record to
// be filed, and the table is the record.
//
// THE FIRST CALL SITE OF THE ROWSPAN PATH. `Col.group` on the driver column,
// `Cell.rowSpan` on the name, `Row.colOffset: 1` on every row beneath it. That
// is one device, not three: the spanned name needs the rail that ties it to its
// rows, and the rows under it carry one fewer cell, so without the offset every
// figure column below the first row of a group would be matched against the
// wrong column spec and lose its alignment and its isolate halfway down the
// table. The screen groups the same way and for the same reason — nothing
// collapses on a sheet that gets printed and signed.
//
// NOT `compact`, and the reason is twice over. The screen rules every row, so
// the hairlines are the mirror; and `table.compact td` sets the padding
// SHORTHAND at (0,1,2), which would outscore `.group`'s longhands at (0,1,0)
// and silently take away the 14px of air that separates the grouping rail from
// the plate beside it. A compact daily sheet would lose the grouping it exists
// to show.
//
// THE ONE RULE THAT CARRIES AN ARGUMENT. The side-log is a separate section
// with `divider: true`. 0166's isolation rule is that its hand-typed figures
// are totalled apart and may NEVER be added to the project totals; on screen
// that claim is made with a gap and three sentences, and on paper a gap of any
// size is just a gap once the card edge is gone — at a page boundary it
// disappears entirely and a reader meets the manual total as if it continued
// the sheet. The kit's divider spends `--rule-heavy`, the weight a closing
// total gets, so the break outranks every rule inside either table. Nothing
// below that line may be added to anything above it.
//
// NO MASTHEAD FIGURE, and no substitute for one. The view-model's `noTotal`
// sentence sits directly beneath the masthead because it qualifies the whole
// sheet; putting it at the foot would let a reader total the projects in their
// head first and be corrected afterwards.
//
// PLATES TAKE `iso`, NOT `num`. A plate is an identifier, not a figure: it must
// read left-to-right in Arabic, which `iso` does, but it must NOT be pushed to
// the trailing edge under a leading-aligned head, which `num` would do. That is
// the exact split the screen documents at its own plate cell — direction on the
// glyphs, alignment left to the column.

import {
  atlasDocShell,
  block,
  masthead,
  note,
  section,
  sheetFooter,
  table,
  type Cell,
  type Col,
  type Row,
} from "../atlas";
import type { DailyDocProject, DailyDocSideRow, DailyDocVm } from "../docvm/daily-trips";

export function buildDailyTripsHtml(vm: DailyDocVm): string {
  const m = vm.masthead;

  // The driver column takes no width so it absorbs the measure the four others
  // leave; those are fixed so every project table on the sheet rules its
  // columns at the same positions. Eight tables whose Revenue columns start in
  // eight different places read as eight unrelated documents.
  const cols: readonly Col[] = [
    { head: vm.cols.driver, group: true },
    { head: vm.cols.truck, iso: true, width: "16%" },
    { head: vm.cols.trips, num: true, width: "12%" },
    { head: vm.cols.commission, num: true, width: "19%" },
    { head: vm.cols.revenue, num: true, width: "19%" },
  ];

  const projectTable = (p: DailyDocProject): string => {
    const rows: Row[] = [];

    for (const g of p.groups) {
      g.rows.forEach((r, i) => {
        const cells: Cell[] = [];

        // The name is written ONCE, spanning this driver's truck rows. The idle
        // note rides in the same cell as a quieter second line — same cell,
        // lower rank, which is where the screen puts it. A column of its own
        // would need a head nobody wrote.
        if (i === 0) {
          cells.push({
            v: g.driver,
            rowSpan: g.rows.length,
            ...(g.idleNote ? { sub: g.idleNote } : {}),
          });
        }

        cells.push(
          r.plate,
          // The chip's count under the figure it qualifies, exactly as the
          // screen sets it beside that figure. The gutter word below is the
          // severity; this is the measurement.
          { v: r.trips, ...(r.unpriced ? { sub: r.unpriced } : {}) },
          r.commission,
          r.revenue,
        );

        rows.push({
          cells,
          ...(i === 0 ? {} : { colOffset: 1 }),
          ...(r.unpriced ? { flag: vm.unpricedWord } : {}),
        });
      });
    }

    return table({
      cols,
      rows,
      foot: [
        { v: p.foot.label, colSpan: 2 },
        { v: p.foot.trips, ...(p.foot.unpriced ? { sub: p.foot.unpriced } : {}) },
        p.foot.commission,
        p.foot.revenue,
      ],
      empty: vm.projectEmpty,
    });
  };

  // SIX COLUMNS. The screen's seventh holds the edit and delete controls and is
  // already `no-print` — not a column dropped here, a column that was never
  // printed. `iso` on Description because when the period is widened that cell
  // carries a DATE on its second line and the description itself is user text
  // of unknown direction; iso() isolates LTR RUNS, so it is right for prose in
  // either language and is exactly the case that flag exists for.
  const sideCols: readonly Col[] = [
    { head: vm.side.cols.driver },
    { head: vm.side.cols.truck, iso: true, width: "15%" },
    { head: vm.side.cols.description, iso: true, width: "26%" },
    { head: vm.side.cols.trips, num: true, width: "10%" },
    { head: vm.side.cols.commission, num: true, width: "16%" },
    { head: vm.side.cols.revenue, num: true, width: "16%" },
  ];

  const sideRow = (r: DailyDocSideRow): Row => ({
    cells: [
      r.driver,
      r.plate,
      { v: r.description, ...(r.date ? { sub: r.date } : {}) },
      r.trips,
      r.commission,
      r.revenue,
    ],
  });

  const body = [
    masthead({
      eyebrow: m.eyebrow,
      title: m.title,
      subtitle: m.subtitle,
      meta: m.meta,
    }),

    // Directly under the masthead, in the slot a figure would have taken. It
    // qualifies every total below it, so it cannot wait for the foot.
    block(note(vm.noTotal)),

    ...(vm.projectsEmpty
      ? [block(note(vm.projectsEmpty))]
      : vm.projects.map((p) =>
          section({ layout: "top", head: p.head, sub: p.sub, body: projectTable(p) }),
        )),

    section({
      layout: "top",
      divider: true,
      head: vm.side.head,
      body: [
        note(vm.side.intro),
        table({
          cols: sideCols,
          rows: vm.side.rows.map(sideRow),
          empty: vm.side.empty,
          foot: [
            { v: vm.side.foot.label, colSpan: 3 },
            vm.side.foot.trips,
            vm.side.foot.commission,
            vm.side.foot.revenue,
          ],
        }),
        // The closing sentence, in the screen's order: the rule above states the
        // separation, this states it in words. `note()` escapes, so the muting
        // the screen carries is gone and every word of it is not.
        note(vm.side.note),
      ].join("\n"),
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
