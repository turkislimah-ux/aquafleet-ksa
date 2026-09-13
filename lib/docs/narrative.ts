// NARRATIVE DOCUMENT RENDERER — the LOOK of the printed period review, and only
// the look.
//
// The other half of lib/docvm/narrative.ts:
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// TOP TITLES. The sheet is a masthead, four figures and a short run of
// sentences; there is one heading on it and nothing for a gutter rail to align.
//
// THE BULLETS ARE A HEADLESS TABLE, which is the one assembly decision in this
// file worth defending. They are prose, so a table looks like the wrong block —
// until the tone has to be printed. `Row.flag` is the kit's severity word at row
// scale, it hangs in a leading column the sentences clear, and it appears only
// because some row carries one. The alternatives were worse in both directions:
// a bullet glyph re-encodes nothing (the dot's MEANING was its hue, which paper
// does not have), and splicing the word into the sentence edits text
// buildNarrative wrote. `headless` keeps the column heads off it — the same
// reason the kit's ledger uses it, since heading a column of prose rules off a
// word that labels nothing. `compact` drops the row rules: five sentences do not
// need five hairlines between them.

import {
  atlasDocShell,
  block,
  masthead,
  note,
  sheetFooter,
  statStrip,
  table,
} from "../atlas";
import type { NarrativeDocVm } from "../docvm/narrative";

export function buildNarrativeHtml(vm: NarrativeDocVm): string {
  const m = vm.masthead;

  const body = [
    masthead({
      eyebrow: m.eyebrow,
      title: m.title,
      subtitle: m.subtitle,
      meta: m.meta,
      figure: m.figure,
    }),

    block(
      table({
        // ONE COLUMN, and its head is never emitted — see `headless`. The empty
        // string is not a word, it is the absence of one, and the kit's type
        // asks for a head whether or not the table will print it.
        cols: [{ head: "" }],
        rows: vm.bullets.map((b) => ({ cells: [b.text], flag: b.word })),
        headless: true,
        compact: true,
      }),
    ),

    // BELOW the sentences, exactly as on screen: the bullets are the argument
    // and these four are what it was argued from. Putting the strip above them
    // would make the sheet open on its own evidence.
    block(statStrip(vm.stats)),

    block(note(vm.note)),

    sheetFooter(vm.footer),
  ].join("\n");

  return atlasDocShell({
    lang: vm.lang,
    dir: vm.rtl ? "rtl" : "ltr",
    title: vm.docTitle,
    body,
  });
}
