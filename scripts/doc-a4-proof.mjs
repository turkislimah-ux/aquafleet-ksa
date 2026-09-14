// A4 PROOF HARNESS for the ATLAS printed sheets. Renders a directory of sheet
// HTML to A4 PDFs and reports each file's PAGE COUNT.
//
//   node scripts/doc-a4-proof.mjs [dir] [substring]
//
// `dir` defaults to $DOC_SHEETS, then to the corpus directory that
// scripts/doc-render-statements.ts writes. PDFs land in `<dir>/pdf`.
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
// and nothing else. A count is the cheapest way to see that, and the fastest
// regression check after any kit spacing change: render, read the column, compare
// against what the same sheet printed before.
//
// This lives in scripts/ rather than /tmp because Node resolves ESM imports from
// the SCRIPT's directory — a copy in /tmp cannot find `playwright`.
//
// To LOOK at a page rather than count it, rasterise the PDF:
//   pdftoppm -png -r 110 -f 2 -l 2 <file>.pdf /tmp/out/p

import { chromium } from "playwright";
import { readdirSync, mkdirSync, readFileSync } from "node:fs";

const SRC = process.argv[2] ?? process.env.DOC_SHEETS ?? "/tmp/atlas-sheets";
const only = process.argv[3] ?? "";
const OUT = `${SRC}/pdf`;
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

for (const f of files) {
  await page.goto(`file://${SRC}/${f}`, { waitUntil: "load" });
  // Fonts first. A PDF printed before the Arabic face loads paginates against
  // the fallback's metrics and reports a page count the real sheet never has.
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ media: "print" });
  const path = `${OUT}/${f.replace(/\.html$/, ".pdf")}`;
  await page.pdf({
    path,
    format: "A4",
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  });
  // Page count straight off the PDF's own page objects, so the harness needs no
  // rasteriser installed to answer the question it is usually asked.
  const buf = readFileSync(path);
  const pages = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  console.log(`${pages}\t${path}`);
}

await browser.close();
