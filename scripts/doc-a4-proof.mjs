// A4 PROOF HARNESS for the ATLAS printed sheets. Renders a directory of sheet
// HTML to A4 PDFs, counts each one's PAGES, and diffs that against the
// checked-in baseline in scripts/doc-page-counts.json.
//
//   node scripts/doc-a4-proof.mjs [dir] [substring]
//   node scripts/doc-a4-proof.mjs --update            # rewrite the baseline
//   node scripts/doc-a4-proof.mjs --no-baseline <dir> # a dir that is not the corpus
//   npm run test:pages                                # render the corpus, then diff
//
// `dir` defaults to $DOC_SHEETS, then to the corpus directory that
// scripts/doc-render-statements.ts writes. PDFs land in `<dir>/pdf`.
//
// THE BASELINE IS THE CHECK, and it is committed for the same reason a snapshot
// test is: a page count is not a thing anyone remembers. 68 sheets print between
// one and six pages each, and the number that matters is not any single count
// but WHICH ONE MOVED. Held in the repo, that question is answered by a diff
// rather than by two terminal windows and a good memory.
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

const SRC = argv[0] ?? process.env.DOC_SHEETS ?? "/tmp/atlas-sheets";
const only = argv[1] ?? "";
const OUT = `${SRC}/pdf`;
const BASELINE = new URL("./doc-page-counts.json", import.meta.url);
mkdirSync(OUT, { recursive: true });

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
