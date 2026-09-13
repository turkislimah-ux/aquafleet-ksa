// CUSTOM REPORT DOCUMENT RENDERER — the LOOK of the printed builder output, and
// only the look.
//
// The other half of lib/docvm/custom.ts:
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// THE ONE SHEET WHOSE TABLE HAS NO FIXED SHAPE. Every other printable in this
// app knows its columns at authoring time; this one is handed between one and a
// dozen metrics chosen by the reader, over a grouping they also chose. So the
// geometry here is a FUNCTION of the column count rather than a set of widths,
// and that is the whole of this file's work.

import { atlasDocShell, block, masthead, note, sheetFooter, table, type Col } from "../atlas";
import type { CustomDocVm } from "../docvm/custom";

/**
 * THE COLUMN HEADS MUST WRAP; THE FIGURES MUST NOT.
 *
 * A measure column is `num`, and the kit sets `.num { white-space: nowrap }` so
 * a figure can never be broken across two lines. That rule reaches the `th` as
 * well, which is right for every other sheet in the pack — their heads are one
 * or two short words, authored. Here a head is whatever the metrics dictionary
 * calls the metric ("Total maintenance per truck"), and held on one line by a
 * dozen of them it pushes the table past the paper edge.
 *
 * Scoped to the HEAD only, and shipped as this sheet's extra CSS rather than
 * added to the kit: the kit's rule is correct for the sheets that do not have
 * this problem, and a dynamic-column table is the only place it bites.
 */
const WRAP_CSS = [
  `th.num { white-space: normal; }`,
  // AND ONCE THEY WRAP, THEY MUST SIT ON THE RULE, NOT IN THE MIDDLE OF IT. A
  // `th` is middle-aligned by default, which is invisible on a pack of authored
  // one-line heads and a mess on thirteen dictionary names: "Water filling cost"
  // takes three lines where "Payroll" takes one, so every `.sub-line` beneath
  // them lands at a different height and the basis row — accrual, accrual,
  // settlement, operational — reads as scattered type rather than a row.
  // Bottom-aligned, the rag goes to the TOP where the head's own first line
  // already varies, and the qualifiers line up one leading above the head rule.
  `th { vertical-align: bottom; }`,
].join("\n");

// ---------------------------------------------------------------------------
// THE FIT — what a column WANTS, and what this sheet gives up when thirteen of
// them want more than the paper has
// ---------------------------------------------------------------------------
//
// THE KIT'S TABLE HAS NO HORIZONTAL PADDING AT ALL. `th` is `padding: 0 0 7px`
// and `td` is `padding: 8px 0` (shell.ts), and `Col.gap` is the opt-in
// separator every other sheet reaches for where two columns would otherwise
// touch. Those sheets have three or four columns and room to spend; here the
// column count is the reader's, and at thirteen metrics the table arrives at
// the paper edge with NOTHING left over — measured below. Columns then sit
// edge to edge and the heads read as one word: PARTSOUTSOURCED, PAYROLLCOMMISSIONS.
//
// So the separator cannot be handed out at a fixed size and hoped for. What
// the columns demand has to be estimated BEFORE the gap is spent, and the
// sheet has to have something to give up when the estimate exceeds the page.
// It gives up two things, in this order — the cheapest first:
//
//   1. THE TRACKED CAPS ON THE HEAD. Caps plus 0.14em costs about 40% over the
//      same words set sentence-case, and on this sheet the head is not an
//      authored two-word label — it is a dictionary name ("Outsourced cost",
//      "Invoices settled"), long enough that the head, not the figure, is what
//      sets the column's minimum. Dropping the device buys back more measure
//      than anything else here and costs no type size at all. The `.sub-line`
//      below it was never capped (shell.ts: "a head is tracked caps and a
//      sub-head is not"), so the two lines still rank correctly by weight.
//   2. TYPE SIZE, as a `zoom` on the table — the same device the shell uses on
//      `body`, and for the same reason: one knob scales the figures, both head
//      lines, the rules and the gap together, in whichever language is being
//      set, without this file restating a single one of the kit's sizes.
//
// Both steps are skipped when the table already fits, which is every selection
// up to about ten metrics — the common sheet is the kit's look, untouched.
//
// THE CONSTANTS ARE MEASURED, NOT REASONED. Rendered 2026-09-13 from the live
// 13-metric sheet at the print measure, reading each column's min-content:
// a tabular figure runs ~4.75px per character at the kit's 9.5px; a tracked
// caps head ~6.6px per character at 7.5px (worst case "Invoices"); the same
// words sentence-case ~4.6px ("Commissions"); the 8px `.sub-line` ~4.0px
// ("operational"). Rounded UP, because the failure direction is not symmetric:
// over-estimating leaves a little slack, under-estimating puts a figure past
// the margin. Arabic glyphs measured ~2.7px per character at the 9.2px the
// Arabic law sets for `th` — much narrower than Latin, and it carries no caps
// to give up, so its arm goes straight to step 2 on the rare sheet that needs it.

/** The inline measure the sheet lays out in — shell.ts's `body { zoom }` divisor. */
const MEASURE = 702;
/** The separator, in the same px. One head-size of air between two columns. */
const GAP = 8;
/** What the grouping column is held back for it: a month or a short name, one line. */
const LABEL_FLOOR = 46;

const PER_CHAR = {
  /** A figure cell, 9.5px tabular. */
  fig: 4.8,
  /** A `th` word in tracked caps, 7.5px + 0.14em. */
  capsHead: 6.6,
  /** The same word sentence-case at the same size. */
  plainHead: 4.8,
  /** A `.sub-line` word, 8px + 0.03em. */
  sub: 4.1,
  /** An Arabic `th` word at the 9.2px the Arabic law sets — no caps to shed. */
  arHead: 3.2,
  /** An Arabic `.sub-line` word. */
  arSub: 3.0,
} as const;

/** Below this the type stops being money and starts being a texture. */
const MIN_ZOOM = 0.62;

/** A cell wraps at its spaces, so its minimum is its LONGEST WORD, not its length. */
const longestWord = (s: string): number =>
  s.split(/\s+/).reduce((a, w) => Math.max(a, [...w].length), 0);

/**
 * The width this table's measure columns demand, in layout px, if nothing is
 * given up. Each column takes the widest of the three things stacked in it: its
 * figures, its head, its basis line.
 */
function metricDemand(vm: CustomDocVm, caps: boolean): number {
  const ar = vm.rtl;
  const head = ar ? PER_CHAR.arHead : caps ? PER_CHAR.capsHead : PER_CHAR.plainHead;
  const sub = ar ? PER_CHAR.arSub : PER_CHAR.sub;
  return vm.table.cols.reduce((total, c, i) => {
    const figChars = vm.table.rows.reduce((w, r) => Math.max(w, [...(r.values[i] ?? "")].length), 0);
    return (
      total +
      Math.max(figChars * PER_CHAR.fig, longestWord(c.head) * head, longestWord(c.sub) * sub)
    );
  }, 0);
}

function fitCss(vm: CustomDocVm): string {
  const n = vm.table.cols.length;
  const spent = n * GAP + LABEL_FLOOR;
  const fits = (caps: boolean) => MEASURE / (metricDemand(vm, caps) + spent);

  // Step 1 is Latin-only: the Arabic head carries no caps to drop, so offering
  // it the choice would print the same sheet and claim a saving it never made.
  const caps = vm.rtl || fits(true) >= 1;
  const zoom = Math.max(MIN_ZOOM, Math.min(1, fits(caps)));

  return [
    WRAP_CSS,
    // AT THE START, NOT THE END. A column's inline-start edge is where the
    // PREVIOUS column's figure ended, so the padding lands in the gutter
    // between the two; put it at the end instead and the last column's figures
    // come away from the right margin, which is the one edge every figure on
    // this sheet is aligned to. Correct in both directions by construction —
    // in Arabic the same edge is the right one, and the label column, having no
    // `.num`, is untouched in either.
    `th.num, td.num { padding-inline-start: ${GAP}px; }`,
    caps ? "" : `th { text-transform: none; letter-spacing: normal; }`,
    zoom < 1 ? `table { zoom: ${zoom.toFixed(3)}; }` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildCustomHtml(vm: CustomDocVm): string {
  const m = vm.masthead;
  const n = vm.table.cols.length;

  // THE LABEL COLUMN TAKES A FIXED SHARE AND THE METRICS SPLIT THE REST EQUALLY.
  // Equal shares, not measure-fit: the columns hold the same KIND of thing, so a
  // wider one reads as a more important one — and with the figures right-aligned
  // and tabular, an equal grid is what puts them on a comparable scale down the
  // page. The label column is the only cell that holds prose (a month, a
  // customer, a plate) and is the only one allowed to wrap, so it gets the
  // single largest share and no more.
  const cols: Col[] = [
    { head: vm.table.labelHead, width: "28%" },
    ...vm.table.cols.map(
      (c): Col => ({ head: c.head, sub: c.sub, num: true, width: `${(72 / n).toFixed(3)}%` }),
    ),
  ];

  const body = [
    // NO FIGURE. There is no number on this sheet that deserves 72px, because
    // picking one would be a claim the builder never made.
    masthead({ eyebrow: m.eyebrow, title: m.title, subtitle: m.subtitle, meta: m.meta }),

    // TWO DIFFERENT NOTHINGS, and the view-model has already chosen which
    // sentence answers this one. Both drop the table entirely — a head row of
    // column names over a sentence explaining there are no columns is a
    // contradiction printed twice.
    block(
      vm.empty !== null
        ? note(vm.empty)
        : table({
            cols,
            rows: vm.table.rows.map((r) => ({
              cells: [{ v: r.label, cls: "name" }, ...r.values],
            })),
          }),
    ),

    // The builder's own notes, then the statement's, in the order the screen
    // prints them. Each is its own paragraph: they are separate claims about
    // separate columns, and run together they read as one qualified sentence.
    block(vm.notes.map(note).join("")),

    sheetFooter(vm.footer),
  ].join("\n");

  return atlasDocShell({
    lang: vm.lang,
    dir: vm.rtl ? "rtl" : "ltr",
    title: vm.docTitle,
    body,
    extraCss: fitCss(vm),
  });
}
