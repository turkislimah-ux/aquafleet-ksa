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
// It reports three shapes, which have different fixes:
//   NAKED   — a text node holding both a strong-RTL char and an LTR run, with
//             no isolate at all. The whole string was never passed through
//             iso(). The browser reorders it.
//   EDGE    — an isolate whose content STARTS or ENDS with a separator that
//             abuts Arabic. iso() swept a boundary neutral into the LTR run,
//             so it renders at that run's wrong end.
//   ORDER   — an isolate whose characters do NOT land on the page in the order
//             they were written. The pin did not hold. See below.
//
// ---------------------------------------------------------------------------
// THE ORDER GUARD — the character-order check, promoted from a manual tool
// ---------------------------------------------------------------------------
// NAKED and EDGE are STRUCTURAL: they read the DOM and ask whether a string was
// pinned, and whether the pin swallowed a separator. Neither one ever looks at
// where a character actually lands. So the failure they cannot see is the pin
// that is PRESENT and does not WORK — an `.iso` whose `dir` is missing, wrong,
// or overridden by CSS. The node is inside `.iso`, so the NAKED test skips it;
// no separator sits at its boundary, so the EDGE test passes it; and the sheet
// prints "1,260.00 INV-026" as "INV-026 1,260.00" with nothing in the markup
// looking wrong.
//
// doc-bidi-line.mjs has always been able to answer this, one element at a time,
// by hand: it reads each character's box and prints the true visual order. This
// is that reading made automatic over every isolate on every Arabic sheet.
//
// THE INVARIANT: inside an isolate that contains no strong-RTL character of its
// own, the characters must appear left-to-right in the order they were written.
// That is the whole claim `iso()` makes. If the browser moved any of them, the
// isolate failed at its one job.
//
// WHY IT CANNOT OVER-REPORT, which is what kept doc-bidi-tokens.mjs advisory:
//   · OUTERMOST ISOLATES ONLY. An inner `.iso dir="auto"` wrapping an Arabic
//     month (isoUnit) is strong RTL and reads right-to-left correctly; judged on
//     its own it would look reversed. It is never judged on its own.
//   · A NESTED ISOLATE IS ONE ATOM. Its internal order is its own business, so
//     the outer box is asked only where that whole box landed. This is the same
//     reasoning doc-bidi-tokens.mjs applies to a token, applied to a run that
//     really is top-level rather than to one the regex invented.
//   · ANY STRONG-RTL CHARACTER OUTSIDE A NESTED ISOLATE DISQUALIFIES THE BOX.
//     Then the box is genuinely mixed and plain logical order is not the rule.
//   · LINES ARE READ ONE AT A TIME. A wrapped isolate continues on the next
//     line, so atoms are ordered by line first and x second — otherwise every
//     wrap would read as a reordering.
//
// ORDER EXITS 1, like EDGE, and for the same reason: there is no arrangement of
// correct text that produces it.

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
let naked = 0, edge = 0, order = 0;

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

    // ----- ORDER: did the pin hold? (see this file's header) -----------------
    // Atoms in LOGICAL order. A nested .iso is one atom; every other character
    // is its own. A strong-RTL character that is not inside a nested isolate
    // disqualifies the box — see the header.
    const atoms = (box) => {
      const list = [];
      let mixed = false;
      const walkNode = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            if (child.classList?.contains("iso")) {
              const r = child.getBoundingClientRect();
              list.push({ label: (child.textContent ?? "").trim().slice(0, 12), x: r.x, y: r.y });
            } else {
              walkNode(child);
            }
            continue;
          }
          if (child.nodeType !== 3) continue;
          const s = child.nodeValue ?? "";
          for (let k = 0; k < s.length; k++) {
            if (!s[k].trim()) continue;
            if (RTL.test(s[k])) { mixed = true; return; }
            const r = document.createRange();
            r.setStart(child, k);
            r.setEnd(child, k + 1);
            const bb = r.getBoundingClientRect();
            list.push({ label: s[k], x: bb.x, y: bb.y });
          }
        }
      };
      walkNode(box);
      return mixed ? null : list;
    };

    for (const box of document.querySelectorAll(".iso")) {
      // Outermost only: an inner dir="auto" Arabic run is an atom, never a case.
      if (box.parentElement?.closest(".iso")) continue;
      const list = atoms(box);
      if (!list || list.length < 2) continue;

      // Line first, x second. A wrapped isolate resumes on the next line, and
      // that is not a reordering.
      const line = (a) => Math.round(a.y / 4);
      const visual = list
        .map((a, i) => ({ ...a, i }))
        .sort((a, b) => (line(a) - line(b)) || (a.x - b.x));
      const moved = visual.some((a, k) => a.i !== k);
      if (moved) {
        out.push({
          kind: "ORDER",
          text:
            "written: " + list.map((a) => a.label).join("") +
            "   |   rendered: " + visual.map((a) => a.label).join(""),
        });
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
    if (h.kind === "NAKED") naked++; else if (h.kind === "EDGE") edge++; else order++;
    console.log(`  ${h.kind}  ${h.text}`);
  }
}
await browser.close();
console.log(`\n${naked} NAKED, ${edge} EDGE, ${order} ORDER across ${files.length} Arabic sheets`);
if (edge) {
  console.error(`FAIL: ${edge} EDGE. An isolate swept a boundary separator into its LTR run.`);
}
if (order) {
  console.error(`FAIL: ${order} ORDER. An isolate's characters did not print in written order — the pin did not hold.`);
}
if (edge || order) process.exit(1);
