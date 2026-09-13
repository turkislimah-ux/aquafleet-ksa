// P&L DOCUMENT RENDERER — the LOOK of the printed Profit & Loss, and only the
// look.
//
// The other half of lib/docvm/pnl.ts:
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// TOP TITLES, and the statement's own table has no heading at all. The masthead
// IS the first card's header on screen — title, period, comparison tail — so a
// section head over the table beneath it would be that title said twice. The
// table takes `block()`, which is the kit's answer to exactly this: a heading is
// WORDING, and inventing one here would put a word on the sheet nobody wrote.
//
// THE ONE RULE THAT CARRIES AN ARGUMENT. The VAT list is a separate section with
// `divider: true`, and that rule is the sheet's whole claim about the
// relationship between its two halves. On screen the claim is made with two
// cards and 10mm of air; on paper a gap of any size is just a gap once the card
// edge is gone, and at a page boundary it disappears and the two run together.
// The kit's divider spends `--rule-heavy` — the weight a closing total gets — so
// the break outranks every rule inside either table, which is the correct
// ranking: nothing below that line may be added to anything above it.
//
// FIVE COLUMNS, FOUR OF THEM `num`. That flag does three things at once and
// they must not disagree: trailing alignment, tabular figures, and iso() on
// every cell. The variance column needs all three and needs iso() most — it
// carries "+1,234.00 SAR" on most rows and "+2.1 نقطة" on the margin row, and
// only run-by-run isolation keeps the sign, the figure and the Arabic unit in
// their right places on an RTL sheet.
//
// THE VAT TABLE IS NOT `compact`. Six rows, each carrying a hint on a second
// line inside its own cell — without the row rules the hint of one line and the
// label of the next close up, and the pairs stop reading as pairs. The
// statement's table IS compact for the opposite reason: eighteen rows whose
// grouping is already carried by section heads, indents and four deliberate
// rules, where a hairline between every pair would bury all four.

import {
  atlasDocShell,
  block,
  ledgerTable,
  masthead,
  note,
  section,
  sheetFooter,
  statStrip,
  table,
  type Cell,
  type Col,
  type LedgerRow,
  type Row,
} from "../atlas";
import type { PnlDocVatRow, PnlDocVm } from "../docvm/pnl";

export function buildPnlHtml(vm: PnlDocVm): string {
  const m = vm.masthead;

  // The label column takes no width so it absorbs the measure the four figure
  // columns leave; those are fixed so the two period columns cannot end up
  // different widths on a sheet whose whole job is comparing them.
  const cols: readonly Col[] = [
    { head: vm.statement.cols[0] ?? "" },
    { head: vm.statement.cols[1] ?? "", num: true, width: "21%" },
    { head: vm.statement.cols[2] ?? "", num: true, width: "21%" },
    { head: vm.statement.cols[3] ?? "", num: true, width: "18%" },
    { head: vm.statement.cols[4] ?? "", num: true, width: "9%" },
  ];

  const lines: readonly LedgerRow[] = vm.statement.lines.map((l): LedgerRow => {
    if (l.kind === "head") return { head: l.text };
    if (l.kind === "note") return l.flag ? { note: l.text, flag: l.flag } : { note: l.text };
    return {
      label: l.label,
      values: l.values as readonly Cell[],
      ...(l.indent ? { indent: l.indent } : {}),
      ...(l.rule ? { rule: l.rule } : {}),
      ...(l.strong ? { strong: l.strong } : {}),
      ...(l.flag ? { flag: l.flag } : {}),
    };
  });

  // The hint rides in the label cell as a quieter second line, which is where
  // the screen puts it — same cell, lower rank. A column of its own would need a
  // head nobody wrote and would claim the count ranks beside the source.
  const vatRows = (rows: readonly PnlDocVatRow[]): Row[] =>
    rows.map((r) => ({
      cells: [
        { v: r.label, sub: r.hint, ...(r.indent ? { cls: "indent" } : {}) },
        r.value,
      ],
    }));

  const vatBody: Row[] = [
    ...vatRows(vm.vat.rows),
    ...(vm.vat.rejectedHead
      ? [{ cells: [{ v: vm.vat.rejectedHead, cls: "sechead", colSpan: 2 }] }]
      : []),
    ...vatRows(vm.vat.rejected),
  ];

  const body = [
    masthead({
      eyebrow: m.eyebrow,
      title: m.title,
      subtitle: m.subtitle,
      meta: m.meta,
      figure: m.figure,
    }),

    // Directly under the masthead, where the screen puts it: this caveat
    // qualifies every figure below it, so it cannot wait for the foot.
    ...(vm.warn ? [block(note(vm.warn))] : []),

    // ABOVE the table, unlike the narrative sheet's strip. There the four
    // figures are the evidence an argument was made from and belong under it;
    // here they are the statement's headline read at a glance, and the table is
    // that headline taken apart.
    block(statStrip(vm.stats)),

    block(ledgerTable({ cols, rows: lines, compact: true })),

    block(note(vm.statement.footer)),

    section({
      layout: "top",
      divider: true,
      head: vm.vat.head,
      sub: vm.vat.sub,
      body: [
        note(vm.vat.intro),
        table({
          cols: [
            { head: vm.vat.cols.source },
            { head: vm.vat.cols.value, num: true, width: "26%" },
          ],
          rows: vatBody,
        }),
        // One paragraph each, in the screen's order. `note()` escapes, so the
        // emphasis the screen carries is gone and every word of it is not.
        ...vm.vat.notes.map((n) => note(n)),
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
