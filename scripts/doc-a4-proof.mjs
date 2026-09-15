// A4 PROOF HARNESS for the ATLAS printed sheets. Renders a directory of sheet
// HTML to A4 PDFs, counts each one's PAGES, and diffs that against the
// checked-in baseline in scripts/doc-page-counts.json.
//
//   node scripts/doc-a4-proof.mjs [dir] [substring]
//   node scripts/doc-a4-proof.mjs --update            # rewrite the baseline
//   node scripts/doc-a4-proof.mjs --no-baseline <dir> # a dir that is not the corpus
//   node scripts/doc-a4-proof.mjs --clearance         # + px left on each last page
//   npm run test:pages                                # render the corpus, then diff
//
// `dir` defaults to $DOC_SHEETS, then to the corpus directory that
// scripts/doc-render-statements.ts writes. PDFs land in `<dir>/pdf`.
//
// THE BASELINE IS THE CHECK, and it is committed for the same reason a snapshot
// test is: a page count is not a thing anyone remembers. The corpus prints
// between one and six pages a sheet, and the number that matters is not any
// single count but WHICH ONE MOVED. Held in the repo, that question is answered
// by a diff rather than by two terminal windows and a good memory.
//
// The sharpest entry in the file is part-OIL-5W30.ar at 2pp. That sheet has six
// sections and a chart, and it printed a third page holding nothing but the
// footer until lib/docs/part.ts tightened its own section rhythm. A kit spacing
// change puts it back over, and this is what says so.
//
// A MOVED COUNT IS NOT AUTOMATICALLY A BUG. Adding a row to a fixture legimately
// pushes a sheet to a second page. The check's claim is narrower and is the one
// that was missing: nothing moved SILENTLY. Re-run with --update, and the
// baseline diff in the commit is the record of what the change cost in paper.
//
// NEW SHEETS FAIL TOO, deliberately. A sheet nobody has ever counted is exactly
// the one worth looking at once, and --update is one command.
//
// WHY A PDF AND NOT A SCREENSHOT. A sheet's measure is ~658px inside the kit's
// own page box; a browser viewport is 1400px wide and paginates nowhere. Judging
// type size, column fit or a page break off a viewport screenshot reads a layout
// the paper will never print. Everything this harness is for — does the table
// flow to page two with its heads repeated, does the footer fall off the end —
// only exists once the content is paginated, which only `page.pdf()` does.
//
// MARGINS ARE ZERO ON PURPOSE. The page box belongs to the DOCUMENT
// (`@page { size: A4; margin: 17mm 18mm 16mm }` in lib/atlas/shell.ts). A margin
// passed to page.pdf() would be a SECOND margin stacked on the kit's, and the
// sheet would print at a measure nothing in the app declares.
//
// THE PAGE COUNT IS THE POINT, not a convenience. Overflow on these sheets is
// rarely visible in the content — it shows up as one more page holding a footer
// and nothing else, which is how the Arabic part record printed three pages for
// 17px. A count catches that; reading the sheet does not.
//
// WHAT THE COUNT CANNOT DO is say which sheet is NEXT, and both orphans this
// corpus has had were invisible until they happened. --clearance answers that
// one: px of room left on each sheet's last page, ascending, so a sheet sitting
// a few pixels from the edge is readable as such before a fixture moves it. It
// is a report and not a gate — a tight sheet is not a broken sheet, and failing
// the corpus on one would mean the baseline diff got noisier to say something
// less certain.
//
// This lives in scripts/ rather than /tmp because Node resolves ESM imports from
// the SCRIPT's directory — a copy in /tmp cannot find `playwright`.
//
// To LOOK at a page rather than count it, rasterise the PDF:
//   pdftoppm -png -r 110 -f 2 -l 2 <file>.pdf /tmp/out/p

import { chromium } from "playwright";
import { readdirSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return false;
  argv.splice(i, 1);
  return true;
};
const UPDATE = flag("--update");
const NO_BASELINE = flag("--no-baseline");
const CLEARANCE = flag("--clearance");

const SRC = argv[0] ?? process.env.DOC_SHEETS ?? "/tmp/atlas-sheets";
const only = argv[1] ?? "";
const OUT = `${SRC}/pdf`;
const BASELINE = new URL("./doc-page-counts.json", import.meta.url);
mkdirSync(OUT, { recursive: true });

/** THE PAGE BOX, READ OUT OF THE STYLESHEET RATHER THAN COPIED FROM IT.
 *  --clearance reports a distance to the bottom of the page, which is only a
 *  number if the page is the one the sheets actually declare. Hardcoding
 *  174x264 would be right today and silently wrong the day somebody changes a
 *  margin in lib/atlas/shell.ts — and wrong in the worst way, since every sheet
 *  would still get a confident figure. Parsed, a margin change moves the
 *  numbers; a change this cannot parse stops the run. */
function pageBox() {
  const src = readFileSync(new URL("../lib/atlas/shell.ts", import.meta.url), "utf8");
  const rule = src.match(/@page\s*\{([^}]*)\}/);
  if (!rule) throw new Error("doc-a4-proof: no @page rule in lib/atlas/shell.ts");
  const size = rule[1].match(/size:\s*([A-Za-z0-9]+)/);
  if (!size || size[1] !== "A4") {
    throw new Error(`doc-a4-proof: @page size is ${size?.[1] ?? "unset"}, expected A4`);
  }
  const mm = (rule[1].match(/margin:\s*([^;]+)/)?.[1] ?? "")
    .trim()
    .split(/\s+/)
    .map((v) => {
      const n = /^(-?[\d.]+)mm$/.exec(v);
      if (!n) throw new Error(`doc-a4-proof: @page margin "${v}" is not in mm`);
      return Number(n[1]);
    });
  // The CSS shorthand, all four arities, so this reads the rule rather than the
  // one arity it happens to be written in today.
  const [top, right, bottom, left] =
    mm.length === 1 ? [mm[0], mm[0], mm[0], mm[0]]
    : mm.length === 2 ? [mm[0], mm[1], mm[0], mm[1]]
    : mm.length === 3 ? [mm[0], mm[1], mm[2], mm[1]]
    : mm.length === 4 ? mm
    : (() => { throw new Error(`doc-a4-proof: @page margin has ${mm.length} values`); })();
  const px = (v) => (v / 25.4) * 96;
  return { w: px(210 - left - right), h: px(297 - top - bottom) };
}

const files = readdirSync(SRC)
  .filter((f) => f.endsWith(".html") && f.includes(only))
  .sort();

if (!files.length) {
  console.error(`no .html in ${SRC}${only ? ` matching "${only}"` : ""}`);
  process.exit(2);
}

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
const counts = {};

for (const f of files) {
  await page.goto(`file://${SRC}/${f}`, { waitUntil: "load" });
  // Fonts first. A PDF printed before the Arabic face loads paginates against
  // the fallback's metrics and reports a page count the real sheet never has.
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: "print" });
  const stem = f.replace(/\.html$/, "");
  const path = `${OUT}/${stem}.pdf`;
  await page.pdf({
    path,
    format: "A4",
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  });
  // Page count straight off the PDF's own page objects, so the harness needs no
  // rasteriser installed to answer the question it is usually asked.
  const buf = readFileSync(path);
  counts[stem] = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  console.log(`${counts[stem]}\t${path}`);
}

// ---------------------------------------------------------------------------
// CLEARANCE — how much room is left on a sheet's LAST page.
//
// The page count answers "did anything move". It cannot answer "what is about
// to move", and that is the question every orphan in this corpus was invisible
// to until it had already happened: the Arabic part record and the Arabic
// purchase order both sat a few pixels over a break, printed a page carrying
// nothing but their footer, and nothing in the harness said so beforehand.
// A sheet at 20px of clearance and a sheet at 175px are both "1pp" and are not
// the same sheet.
//
// MEASURED ON ITS OWN PAGE, deliberately. The clearance pass lays the document
// out at the page box's WIDTH so that the flow height is the paper's, and a
// viewport that narrow would be inherited by the next page.pdf() in the loop
// above. Passing --clearance must not be able to change a page count, so the
// two never share a page object.
//
// WHY THE VIEWPORT IS THE CONTENT WIDTH AND NOT 702. shell.ts puts
// `zoom: 0.936806` on BODY (= 657.638 / 702). Body therefore lays out at
// viewport/zoom and is scaled back down, so a viewport set to the content box
// reproduces the paper measure exactly, and documentElement.scrollHeight comes
// back in ROOT px — paper px — with the zoom already applied.
//
// THE FIGURE IS AN UPPER BOUND, AND SAYS SO WHEN IT IS A LOOSE ONE. This is
// flow height against page height; `section { break-inside: avoid }` means real
// pagination can PUSH a block whole onto the next page and leave white space
// the flow height does not know about. When that happens the arithmetic page
// count disagrees with the PDF's, and those rows are marked `~`: the sheet has
// AT MOST that much room, likely less. An exact figure needs the ink off a
// raster, which would cost this harness its no-rasteriser property for a number
// that is only ever read as "is this one close".
if (CLEARANCE) {
  const box = pageBox();
  // HEIGHT 100, AND THAT IS NOT ARBITRARY. scrollHeight never reports less than
  // the viewport, so a comfortable viewport silently floors every short sheet
  // at the same number: at 900 the whole corpus below 900px reported an
  // identical 97.8px of clearance, which is 997.8 - 900 and not a measurement
  // of anything. The viewport has to be shorter than the shortest sheet. Safe
  // to make it tiny because nothing in lib/atlas/shell.ts is sized against the
  // viewport — no vh unit, no height:100% on html or body — so height cannot
  // reach the layout.
  const mPage = await browser.newPage({
    viewport: { width: Math.round(box.w), height: 100 },
  });
  const rows = [];
  for (const f of files) {
    await mPage.goto(`file://${SRC}/${f}`, { waitUntil: "load" });
    await mPage.evaluate(() => document.fonts.ready);
    await mPage.emulateMedia({ media: "print" });
    const h = await mPage.evaluate(() => document.documentElement.scrollHeight);
    const stem = f.replace(/\.html$/, "");
    const pages = counts[stem];
    rows.push({ stem, pages, left: pages * box.h - h, pushed: Math.ceil(h / box.h) !== pages });
  }
  await mPage.close();

  rows.sort((a, b) => a.left - b.left);
  console.log(
    `\nCLEARANCE — px left on the last page, ${box.w.toFixed(1)} x ${box.h.toFixed(1)}px box` +
      `\n(~ = unbreakable blocks were pushed, so the figure is an upper bound)\n`,
  );
  for (const r of rows) {
    // One Arabic body line is ~18px (10.6px at 1.72). A sheet with less than a
    // line in hand is one wrapped cell away from an orphan, which is the whole
    // thing this column exists to show BEFORE a baseline fails.
    const mark = r.left < 18 ? "  <- under one line" : "";
    console.log(
      `${r.pushed ? "~" : " "}${r.left.toFixed(1).padStart(8)}  ${String(r.pages)}pp  ${r.stem}${mark}`,
    );
  }
}

await browser.close();

// ---------------------------------------------------------------------------

if (UPDATE) {
  // Sorted, one key per line: the diff has to be readable, because the review
  // of a baseline change IS the check. A reordering blob is not reviewable.
  const sorted = Object.fromEntries(Object.keys(counts).sort().map((k) => [k, counts[k]]));
  writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`\nbaseline written: ${Object.keys(sorted).length} sheets`);
  process.exit(0);
}

if (NO_BASELINE) process.exit(0);

const base = JSON.parse(readFileSync(BASELINE, "utf8"));
const moved = [];
const added = [];
for (const [stem, n] of Object.entries(counts)) {
  if (!(stem in base)) added.push(`${stem}  ${n}pp`);
  else if (base[stem] !== n) moved.push(`${stem}  ${base[stem]}pp -> ${n}pp`);
}
// A sheet in the baseline that this run did not produce is only a finding on a
// FULL run. A filtered run covers a subset by definition, and reporting the
// other 60 as missing would bury the two lines worth reading.
const gone = only ? [] : Object.keys(base).filter((k) => !(k in counts));

for (const l of moved) console.log(`MOVED    ${l}`);
for (const l of added) console.log(`NEW      ${l}`);
for (const l of gone) console.log(`MISSING  ${l}`);

if (moved.length || added.length || gone.length) {
  console.error(
    `\nFAIL: ${moved.length} moved, ${added.length} new, ${gone.length} missing.` +
      `\nIf the new counts are correct, re-run with --update and commit the baseline.`,
  );
  process.exit(1);
}
console.log(`\n${Object.keys(counts).length} sheets, page counts match the baseline`);
