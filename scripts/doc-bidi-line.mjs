// CHARACTER-ORDER DIAGNOSTIC, the third of the bidi tools. Visual left-to-right
// character order of one element, isolates and all.
//
//   node scripts/doc-bidi-line.mjs <file.ar.html> <css-selector> [nth] [dir]
//
// `dir` defaults to $DOC_SHEETS, then to the corpus directory that
// scripts/doc-render-statements.ts writes.
//
// doc-bidi-tokens.mjs deliberately SKIPS isolated text, because its question is
// "what does the browser do to a string nobody pinned". This one asks the
// opposite question - "did pinning it work" - so it walks every text node in
// the element and reads the result off the boxes.
import { chromium } from "playwright";
const [file, sel, nth = "0", dir] = process.argv.slice(2);
const SRC = dir ?? process.env.DOC_SHEETS ?? "/tmp/atlas-sheets";
if (!file || !sel) {
  console.error("usage: doc-bidi-line.mjs <file.ar.html> <css-selector> [nth] [dir]");
  process.exit(2);
}
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage();
await p.goto(`file://${SRC}/${file}`, { waitUntil: "load" });
const lines = await p.evaluate(([sel, nth]) => {
  const el = document.querySelectorAll(sel)[+nth];
  if (!el) return null;
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const marks = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const s = n.nodeValue ?? "";
    for (let k = 0; k < s.length; k++) {
      if (!s[k].trim()) continue;
      const r = document.createRange(); r.setStart(n, k); r.setEnd(n, k + 1);
      const bb = r.getBoundingClientRect();
      marks.push({ ch: s[k], x: bb.x, y: Math.round(bb.y) });
    }
  }
  const ys = [...new Set(marks.map((m) => m.y))].sort((a, c) => a - c);
  return ys.map((y) =>
    marks.filter((m) => m.y === y).sort((a, c) => a.x - c.x).map((m) => m.ch).join(""),
  );
}, [sel, nth]);
await b.close();
if (!lines) { console.error("no match"); process.exit(1); }
lines.forEach((l, i) => console.log(`line${i} (visual L->R): ${l}`));
