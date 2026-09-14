// TOKEN-ORDER DIAGNOSTIC, the second half of doc-bidi-check.mjs. For ONE sheet,
// prints every naked mixed-direction string with the VISUAL left-to-right order
// of its LTR tokens.
//
//   node scripts/doc-bidi-tokens.mjs cost-jun-live.ar.html [dir]
//
// The check says a string is UNPINNED. This says what the browser then DID with
// it, which is the question that decides whether the finding needs a fix.
//
// THE INVARIANT BEING CHECKED, and it needs no reimplementation of UBA: in an
// RTL paragraph the top-level items of a line are laid out RIGHT to LEFT in
// logical order. So reading the line LEFT to right, the LTR tokens must appear
// in REVERSE of the order they occupy in the source string. Anything else means
// the neutral resolution moved one past another.
//
// Tokens, not characters, because a token's INTERNAL order is never in doubt —
// "210.00" is one LTR run and renders left-to-right whatever surrounds it. The
// only question a mixed line raises is where the runs land relative to each
// other, and that is exactly what this prints.
//
// WRONG IS A PROMPT TO MEASURE, NOT A VERDICT — the descending rule OVER-REPORTS
// in two shapes, both seen on the committed narrative sheets and both correct on
// the paper. Read the flagged line character-by-character (doc-bidi-line.mjs)
// before touching anything.
//
//   1. A MULTI-WORD LTR RUN. "MMM construction Co." is three tokens to the regex
//      and ONE run to the browser, laid out left-to-right INSIDE itself, so its
//      indices ascend (0,1,2) within an otherwise descending line. The tokeniser
//      splits on the space; the UBA does not.
//   2. A NUMBER AND ITS UNIT ACROSS A LEVEL-1 NEUTRAL. "55,000 SAR" is two LTR
//      runs with a neutral between them that resolves to L, so they too render
//      left-to-right as a pair, reversing the expected order of that one step.
//
// Both reduce to the same thing: the rule assumes every token is its own
// top-level item, and adjacent LTR tokens are not. The tool stays as it is —
// narrowing it to suppress those two would also suppress the real defect they
// resemble, and the corpus holds a couple of hundred naked strings to keep an
// eye on, not a couple of hundred bugs. doc-bidi-check.mjs prints the current
// count; it is a baseline to watch, which is why that tool does not fail on it.

import { chromium } from "playwright";

const file = process.argv[2];
const SRC = process.argv[3] ?? process.env.DOC_SHEETS ?? "/tmp/atlas-sheets";
if (!file) { console.error("usage: doc-bidi-tokens.mjs <file.ar.html> [dir]"); process.exit(2); }

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.goto(`file://${SRC}/${file}`, { waitUntil: "load" });

const rows = await page.evaluate(() => {
  const RTL = /[֐-׿؀-ۿ܀-ݏހ-޿ࡠ-ࣿיִ-﷿ﹰ-ﻼ]/;
  const TOK = /[A-Za-z0-9][A-Za-z0-9.,:%\/-]*/g;
  const out = [];
  const seen = new Set();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (n.parentElement?.closest(".iso")) continue;
    const s = n.nodeValue ?? "";
    if (!s.trim() || !RTL.test(s) || !/[A-Za-z0-9]/.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);

    // Logical tokens, with the source offset of each, so the visual read can be
    // matched back to a position rather than to a value (two "3"s on a line
    // would otherwise be indistinguishable).
    const toks = [];
    for (const m of s.matchAll(TOK)) toks.push({ i: toks.length, t: m[0], at: m.index });
    if (toks.length < 2) continue;

    // The x of a token is the x of its FIRST character - enough to order runs
    // against each other, and it cannot be confused by a run's own width.
    const marks = toks.map((tk) => {
      const r = document.createRange();
      r.setStart(n, tk.at);
      r.setEnd(n, tk.at + 1);
      return { ...tk, x: r.getBoundingClientRect().x };
    });
    const visual = [...marks].sort((a, b) => a.x - b.x);
    out.push({
      text: s.trim().slice(0, 110),
      logical: marks.map((m) => m.t),
      visualIdx: visual.map((m) => m.i),
      visual: visual.map((m) => m.t),
    });
  }
  return out;
});
await browser.close();

for (const r of rows) {
  // Correct == visual indices strictly DESCENDING.
  const ok = r.visualIdx.every((v, k) => k === 0 || r.visualIdx[k - 1] > v);
  console.log(`\n${ok ? "ok  " : "WRONG"}  ${r.text}`);
  console.log(`   logical: ${r.logical.join(" | ")}`);
  console.log(`   visual : ${r.visual.join(" | ")}   [${r.visualIdx.join(",")}]`);
}
