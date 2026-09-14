// PAYOUT VOUCHER RENDERER — the LOOK of one frozen commission payout, and only
// the look.
//
// The other half of lib/docvm/payout-history.ts:
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// So there is no string literal in this file that a reader will see, and no
// number is formatted here. The only literals are six column widths.
//
// TOP TITLE. Both tables want the full measure — the items table has four
// columns and a wrapping first one — and the hanging gutter would spend 130px
// of it on two headings the sheet only says once each.
//
// ==========================================================================
// PAGINATION IS HONEST, AND IT IS THE WHOLE POINT OF THE REWRITE
// ==========================================================================
// The screen this replaces printed through a scoped `@media print` block that
// pinned `#history-print` at `position: absolute; inset: 0`. An absolutely
// positioned box does not paginate: a payout with more items than one sheet
// holds had the overflow CLIPPED — silently, with no mark on the paper — and
// the FIVE TOTALS sit at the bottom of that box, so they were the first thing
// to go. A voucher that lists nine of eleven fines and shows no total at all,
// looking complete.
//
// Here nothing is positioned, so nothing can be cut. The tables FLOW:
// `thead { display: table-header-group }` repeats the column heads on page two,
// `tr { break-inside: avoid }` keeps a line whole, and the signature block
// carries its own break-inside so it can never be split from itself.
//
// THE STAT STRIP IS ABOVE THE TABLES, not below them, and that is a deliberate
// reversal of the screen's order. On screen the five boxes are last because a
// scrolling panel has no page two; on paper "last" means "wherever the items
// happen to end", which on a long payout is the foot of sheet two, after the
// reader has already turned the page looking for it. The figure the voucher
// exists to state belongs on the sheet the voucher opens with. GROUPING is
// unchanged — the same five figures in the same order, under the same words —
// only their position moves, and position is this file's.
//
// ==========================================================================
// NEITHER TABLE HAS A FOOT
// ==========================================================================
// Not an omission and not a `foot: []` that got lost: the view-model's header
// gives the reason. The item list includes DENIED lines, which were not paid,
// so a column total would either contradict the stat strip or quietly exclude
// rows the reader can see. The strip is the total.
//
// ==========================================================================
// THE DENIED ROW WEARS THREE DEVICES, REPLACING THREE
// ==========================================================================
// `flag` puts the severity word in the gutter (replacing the 60% opacity),
// `.strike` rules the label and the amount (the screen's own line-through,
// which is a rule and therefore survives a photocopier), and the Status cell
// carries a dashed `mark` (replacing the pill's hue). The deny REASON rides as
// the label cell's `sub`, unruled — the excuse is not itself struck out.
//
// The gutter column exists ONLY when some row flies a flag: `Row.flag`'s
// presence anywhere in the table is what creates it, so a payout with no denied
// items pays no width for a column of nothing.

import {
  atlasDocShell,
  block,
  masthead,
  mark,
  section,
  sheetFooter,
  signatures,
  statStrip,
  table,
  type Row,
} from "../atlas";
import type { PayoutDocVm } from "../docvm/payout-history";

/** Project and Item are the only user-length strings on the sheet, so both are
 *  left unwidthed and wrap; every column after them is fixed. Geometry, which
 *  is this file's to decide. */
const TRIPS_W = "14%";
const AMOUNT_W = "20%";
const TYPE_W = "18%";
const STATUS_W = "18%";
const ITEM_AMOUNT_W = "20%";

export function buildPayoutHistoryHtml(vm: PayoutDocVm): string {
  const m = vm.masthead;

  const baseTable = table({
    cols: [
      { head: vm.base.cols.project },
      { head: vm.base.cols.trips, num: true, gap: true, width: TRIPS_W },
      { head: vm.base.cols.amount, num: true, width: AMOUNT_W },
    ],
    rows: vm.base.rows.map(
      (l): Row => ({ cells: [{ v: l.label, cls: "wrap" }, l.trips, l.amount] }),
    ),
    empty: vm.base.empty,
  });

  // `gap` on Trips, because a trip count is ranged to its own trailing edge and
  // a td pays no horizontal padding: without it the count meets the riyals
  // beside it and the two read as one figure.
  const itemsTable = table({
    cols: [
      { head: vm.items.cols.item },
      { head: vm.items.cols.type, width: TYPE_W },
      { head: vm.items.cols.status, width: STATUS_W },
      { head: vm.items.cols.amount, num: true, gap: true, width: ITEM_AMOUNT_W },
    ],
    rows: vm.items.rows.map(
      (it): Row => ({
        ...(it.denied ? { flag: vm.items.deniedFlag } : {}),
        cells: [
          {
            v: it.label,
            cls: it.denied ? "wrap strike" : "wrap",
            ...(it.reason ? { sub: it.reason } : {}),
          },
          // `.cap` because the SCREEN capitalises this column in CSS and the
          // leaf behind it is genuinely lowercase — see the class's note in
          // lib/atlas/shell.ts. Without it the sheet printed "special" under a
          // head reading TYPE while the screen said "Special".
          { v: it.kind, cls: "cap" },
          // The one `raw` cell in either table. Everything else is text and the
          // kit escapes it.
          { v: mark(it.status, !it.denied), raw: true },
          { v: it.amount, ...(it.denied ? { cls: "strike" } : {}) },
        ],
      }),
    ),
    empty: vm.items.empty,
  });

  const body = [
    masthead({
      eyebrow: m.eyebrow,
      ...(m.eyebrowEnd ? { eyebrowEnd: m.eyebrowEnd } : {}),
      title: m.title,
      ...(m.subtitle ? { subtitle: m.subtitle } : {}),
      meta: m.meta,
      figure: m.figure,
    }),

    block(statStrip(vm.stats)),

    section({ layout: "top", head: vm.base.head, body: baseTable }),
    section({ layout: "top", head: vm.items.head, body: itemsTable }),

    signatures([{ label: vm.signature }]),

    sheetFooter(vm.footer),
  ].join("\n");

  return atlasDocShell({
    lang: vm.lang,
    dir: vm.rtl ? "rtl" : "ltr",
    title: vm.docTitle,
    body,
  });
}
