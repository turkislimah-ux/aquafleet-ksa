// BIDI STRUCTURE CHECK for the ATLAS printed sheets — finds Arabic text that
// mixes directions WITHOUT an isolate around the LTR part.
//
//   node scripts/doc-bidi-check.mjs [dir] [substring]
//   npm run test:bidi          # renders the corpus, then checks it
//
// `dir` defaults to $DOC_SHEETS, then to the corpus directory that
// scripts/doc-render-statements.ts writes. Only `.ar.html` is read: an English
// sheet has no direction to mix.
//
// ONLY EDGE FAILS THE RUN, AND THAT ASYMMETRY IS THE WHOLE DESIGN. The corpus
// holds a few hundred NAKED strings and 0 EDGE, and those hundreds are not
// hundreds of bugs: a naked mixed string is one the browser MIGHT reorder, and
// most of them — a month name beside a year, a total beside "SAR", a unit beside
// its label — resolve correctly, because the neutral between the two runs
// resolves to the run's own direction. Exiting 1 on those would be a gate that
// is red on a clean tree, which is a gate nobody reads.
//
// EDGE is different in kind. It is an isolate that swept a boundary separator
// into the LTR run, so the separator renders at that run's wrong end. There is
// no arrangement of correct text that produces it. It is 0 today and any number
// above 0 is a defect, so that is the number with teeth.
//
// So: EDGE exits 1, NAKED prints its count. The count is a BASELINE — read it,
// and if it moved after a change, the change unpinned something. Use
// doc-bidi-tokens.mjs on the named sheet to see what the browser did with it.
//
// Why a detector rather than reading sheets: a bidi fault does not look like a
// bug in the HTML, it looks like correct text that the BROWSER reorders. The
// only reliable signal is structural — an LTR run sitting in an Arabic text
// node with no `dir` isolate pinning it. That is greppable; the visual result
// is not.
//
// It reports two shapes, which have different fixes:
//   NAKED   — a text node holding both a strong-RTL char and an LTR run, with
//             no isolate at all. The whole string was never passed through
//             iso(). The browser reorders it.
//   EDGE    — an isolate whose content STARTS or ENDS with a separator that
//             abuts Arabic. iso() swept a boundary neutral into the LTR run,
//             so it renders at that run's wrong end.

import { chromium } from "playwright";
import { readdirSync } from "node:fs";

const SRC = process.argv[2] ?? process.env.DOC_SHEETS ?? "/tmp/atlas-sheets";
const only = process.argv[3] ?? "";
const files = readdirSync(SRC)
  .filter((f) => f.endsWith(".ar.html") && f.includes(only))
  .sort();

if (!files.length) {
  console.error(`no .ar.html in ${SRC}${only ? ` matching "${only}"` : ""}`);
  process.exit(2);
}

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
let naked = 0, edge = 0;

for (const f of files) {
  await page.goto(`file://${SRC}/${f}`, { waitUntil: "load" });
  const hits = await page.evaluate(() => {
    const RTL = /[֐-׿؀-ۿ܀-ݏހ-޿ࡠ-ࣿיִ-﷿ﹰ-ﻼ]/;
    // An LTR run worth pinning: Latin letters or digits, two chars or more, or
    // any digit group. A lone stray letter is noise.
    const LTR = /[A-Za-z0-9][A-Za-z0-9.,:%\/-]*/;
    const out = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const s = n.nodeValue ?? "";
      if (!s.trim()) continue;
      // `.iso`, NOT `[dir]`: <html dir="rtl"> matches every node, so a [dir]
      // test reports the whole document as isolated and finds nothing.
      const inIso = !!n.parentElement?.closest(".iso");
      if (!inIso) {
        if (RTL.test(s) && LTR.test(s)) {
          out.push({ kind: "NAKED", text: s.trim().slice(0, 90) });
        }
        continue;
      }
      // Inside an isolate. Does the isolate's own text begin or end with a
      // separator, AND does Arabic sit immediately beyond that edge?
      const box = n.parentElement.closest(".iso");
      const t = (box.textContent ?? "").trim();
      const before = box.previousSibling?.nodeValue ?? "";
      const after = box.nextSibling?.nodeValue ?? "";
      const SEP = /[·•|,;:–—-]/;
      if (SEP.test(t.slice(-1)) && RTL.test(after)) {
        out.push({ kind: "EDGE", text: t.slice(0, 60) + " ]→ " + after.trim().slice(0, 20) });
      } else if (SEP.test(t[0]) && RTL.test(before)) {
        out.push({ kind: "EDGE", text: before.trim().slice(-20) + " ←[ " + t.slice(0, 60) });
      }
    }
    return out;
  });
  if (!hits.length) continue;
  console.log(`\n${f}`);
  const seen = new Set();
  for (const h of hits) {
    const key = h.kind + h.text;
    if (seen.has(key)) continue;
    seen.add(key);
    if (h.kind === "NAKED") naked++; else edge++;
    console.log(`  ${h.kind}  ${h.text}`);
  }
}
await browser.close();
console.log(`\n${naked} NAKED, ${edge} EDGE across ${files.length} Arabic sheets`);
if (edge) {
  console.error(`FAIL: ${edge} EDGE. An isolate swept a boundary separator into its LTR run.`);
  process.exit(1);
}
