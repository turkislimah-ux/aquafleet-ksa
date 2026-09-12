// ATLAS — the document kit for Bousla's standalone printable REPORTS.
//
// WHAT THIS IS, AND WHY IT IS NOT lib/plainDocStyles.ts
// -----------------------------------------------------------------------------
// plainDocStyles.ts is the kit for the two TAX DOCUMENTS (invoice, statement).
// It is bilingual by construction: every label prints English and Arabic side by
// side, because a ZATCA document must be readable by a customer and an auditor
// who may not share a language. That is a legal requirement and it shapes the
// whole stylesheet.
//
// A REPORT is not that. It is read by ONE person, in ONE language, and doubling
// every label halves the room for the figures the report exists to show. So
// ATLAS is ONE DOCUMENT, ONE LANGUAGE: the caller passes lang + dir and gets a
// sheet set entirely in that language. bl() from lib/docPrimitives.ts is
// deliberately NOT the ATLAS pattern and must not leak in here.
//
// That single decision is why atlasDocShell takes lang and dir as arguments
// rather than hardcoding them the way plainDocShell hardcodes lang="en". A
// hardcoded shell can only ever emit one language, and an Arabic report printed
// inside an lang="en" dir="ltr" document is wrong in three separate ways at
// once: the wrong font is selected, the layout does not mirror, and the bidi
// algorithm resolves mixed runs against the wrong base direction.
//
// THE LOOK
// -----------------------------------------------------------------------------
// Austere Swiss / editorial, built on a HANGING GUTTER: every section title sits
// out in a fixed leading column and the content hangs beside it, so the eye
// finds the structure down one hard vertical without a single box being drawn.
// Rules do the rest and they are RANKED: 2.4px closing the masthead, 1px under a
// table head, 0.6px mid-grey between rows. A page where every rule is the same
// weight has no hierarchy; a page where every rule is near-white has no
// structure at all.
//
// The type carries the drama. One figure at 72px against labels at 7.5px is a
// 10:1 ratio and it is spent ONCE, on the masthead. Everywhere else hierarchy
// comes from weight, case and tracking, never from another big number.
//
// NO COLOUR, BY CONSTRUCTION
// -----------------------------------------------------------------------------
// Every value below is ink or a grey, and the same rule that governs
// plainDocStyles.ts governs this file: these sheets are specified to survive a
// fax, a mono laser and a photocopier. Hierarchy is carried by SIZE, WEIGHT,
// RULE THICKNESS and CASE only. Where a report currently encodes meaning in hue
// alone (an aging bucket, an uncosted line, a price rise), that meaning is
// re-expressed as a WORD in the row gutter, not as a grey. See gutterWord() in
// ./blocks.ts and the note above the .gw rule below.
//
// Nothing here is pure #000000. Pure black prints as a flat hole and reads
// cheaper than a rich off-black on every press and every laser printer.
//
// EDITING THE COMMENTS INSIDE ATLAS_CSS
// -----------------------------------------------------------------------------
// The stylesheet lives inside a TEMPLATE LITERAL. A backtick anywhere in it,
// including inside a CSS comment, ends the string, and the failure surfaces as a
// parse error somewhere else entirely with no mention of CSS. Plain quotes only.

/** Direction of a document. Paired with lang, never inferred from it at a call
 *  site: the pairing is made once, in atlasDocShell. */
export type Dir = "ltr" | "rtl";

/**
 * @font-face block for the ATLAS sheets, by root-relative URL.
 *
 * Root-relative resolves correctly inside a srcdoc iframe, which is how
 * lib/printHtml.ts prints these: such a document inherits the parent's base
 * URL. That keeps this module PURE (no fs, no process) and lets the browser
 * cache the faces across prints, unlike lib/invoicePdfTemplate.ts which must
 * base64-inline its faces because PDFShift fetches the HTML with no origin to
 * resolve against.
 *
 * TWO FILES, SPLIT BY UNICODE RANGE, NOT TWO STACKS.
 * Inter carries Latin and the digits; Cairo carries Arabic. Because the ranges
 * do not overlap, a figure inside an Arabic sentence is set in the LATIN face
 * automatically, with no span and no class. That is load-bearing here: every
 * number and date in this app is pinned to en-US Latin digits in BOTH languages
 * (lib/utils.ts), so an Arabic report is full of Latin numerals and they must
 * not fall to whatever numerals the Arabic face happens to ship.
 *
 * CAIRO, NOT NOTO SANS ARABIC. plainDocStyles.ts uses Noto because it must
 * match the PDF download glyph for glyph on a tax document. A report has no
 * such twin, so it takes the face the APP ITSELF is set in (app/globals.css),
 * which means the Arabic on paper is the Arabic the reader just saw on screen.
 * Cairo is also VARIABLE across 400-700, and a continuous weight axis is
 * exactly what the Arabic label system below needs.
 */
export function atlasFontFaceCss(): string {
  return `
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 100 900;
      font-display: block;
      src: url('/fonts/Inter-Latin-Variable.woff2') format('woff2');
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC,
                     U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193,
                     U+2212, U+2215, U+FEFF, U+FFFD;
    }
    @font-face {
      font-family: 'Cairo';
      font-style: normal;
      font-weight: 400 700;
      font-display: block;
      src: url('/fonts/Cairo-Arabic-Variable.woff2') format('woff2');
      unicode-range: U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FEFC, U+200C-200E;
    }
  `;
}

/**
 * The ATLAS stylesheet.
 *
 * See the file header before editing the comments inside: no backticks.
 */
export const ATLAS_CSS = `
  /* A4 with real page margins rather than a fixed-height sheet box.
     A fixed sheet clips its own overflow, and on a report that means silently
     dropping rows off the bottom of page one and printing nothing at all on
     page two. Margins let content flow and paginate; nothing is ever cut.

     The four surfaces being replaced fail here in two different ways and both
     are the same bug: the exit permit and the driver payout pin their print
     view to position:absolute; inset:0, which clips, and the purchase order and
     breakdown paginate without repeating their column heads. Flow plus the
     table-header-group rule below fixes both. */
  @page { size: A4; margin: 17mm 18mm 16mm; }

  * { box-sizing: border-box; }

  :root {
    /* ---- ink and greys. There is no hue in this file. ---- */
    --ink: #141414;        /* near-black: body, rules that mean something */
    --soft: #4a4a4a;       /* secondary prose */
    --mid: #6e6e6e;        /* micro-labels, axis text, the second chart series */
    --quiet: #7a7a7a;      /* a value that is present but not asserted */
    --hair: #a8a8a8;       /* visible hairline. NOT near-white */
    --row: #cccccc;        /* between table rows only */
    --tint: #d8d8d8;       /* bar and area fill */

    /* ---- rule ranks. Three weights, and only three. ---- */
    --rule-heavy: 2.4px;   /* closes the masthead, closes a total */
    --rule-mid: 1px;       /* under a column head */
    --rule-hair: 0.6px;    /* between rows, between stat cells */

    /* ---- the hanging gutter ---- */
    --gutter: 104px;
    --gutter-gap: 26px;

    /* ---- the band under a chart ----
       The approved sheet never blockified its chart SVGs, so each one was an
       INLINE REPLACED element sitting on a text baseline, and the line box kept
       the strut's descender plus half-leading UNDERNEATH it. That band is what
       separated every chart from whatever came next: the trend chart from its
       legend, the legend from its note, the split bar from the DELIVERIES head.
       display:block is the right call - an inline chart is at the mercy of
       whitespace in the markup, and collapsing that whitespace out silently
       moves the page - but dropping the band with it moved everything below the
       split bar up and cost page 2 ten raster px at 200dpi.
       4.719px is MEASURED off the approved document (chart box 78.719 against a
       74 svg; legend box 20.719 against a 16 swatch), not derived from font
       metrics. Deliberately a constant and not a function of the body face: a
       chart must not shift because the page switched to Arabic. */
    --chart-leading: 4.719px;

    /* ---- the label rule (Arabic label system, see below) ---- */
    --lbl-rule: 0.8px solid var(--hair);

    /* ---- type stacks ----
       Helvetica Neue first because that is the face this register was invented
       in and the one the approved design was drawn in; its UltraLight and Bold
       are far enough apart to hold a hierarchy on their own. Inter second as
       the SHIPPED fallback, so a machine without Helvetica Neue gets a real
       grotesque with a real 200 weight rather than Arial, whose lack of a light
       weight would collapse the masthead figure to regular and take the whole
       type contrast with it. */
    --sans: 'Helvetica Neue', 'Inter', Helvetica, Arial, sans-serif;
    --arabic: 'Cairo', 'Noto Sans Arabic', sans-serif;
  }

  html, body { margin: 0; padding: 0; background: #ffffff; }

  /* ---------- THE DESIGN SCALE ----------
     EVERY px IN THIS FILE IS A LAYOUT px, NOT A PAPER px, AND THE TWO DIFFER BY
     THIS FACTOR. The approved ATLAS sheet was never printed at 1:1. Its KPI
     strip was wider than the column, so the document overflowed, and Chromium
     answered by AUTO-FITTING the page - it divides the paper content box by the
     integer document.scrollWidth and scales the print by the result. A4 less
     18mm of side margin is 174mm, which is 657.638 CSS px; that sheet laid out
     at 702; 657.638 / 702 = 0.936806. So the type Turki approved is 93.68% of
     the sizes written here, and the 2-page pagination he approved is a
     consequence of the same shrink.

     THAT SHRINK WAS AN ACCIDENT OF A DEFECT, AND THE DEFECT IS NOW FIXED (see
     STAT BAND). Removing the overflow removes the auto-fit with it: the sheet
     renders ~6.7% larger, page one loses the trend chart to page two and
     English paginates 2 -> 3, with a quarter of page one and most of page three
     left blank. Nothing is lost or clipped that way and it sits on its margins
     - but it does not read as the design that was signed off, so the scale is
     stated here instead of being inherited from a bug.

     THREE WAYS TO RESTATE IT. Two are wrong and were measured, not reasoned:

     - page.pdf({ scale }) - the PDF-level knob. Changes the OUTPUT, not the
       LAYOUT, so the sheet lays out at a flat 657.638/scale with nothing
       overflowing, which is a DIFFERENT composition; and on an RTL document
       Chromium anchors the content's right edge at (rightMargin * scale),
       sliding the whole Arabic sheet 11.8mm off its margins. Both failures are
       written up in .next-report-concepts/render-atlas.mjs, which passes no
       scale because of them.
     - zoom on :root - scales the PAGE BOX, margins included. Measured at
       200dpi: ink ran 133..1521 image px where the margins are 142..1513, i.e.
       1.1mm outside the printable area on BOTH edges, because the 18mm margin
       was itself multiplied by 0.936806.
     - zoom on BODY - what this rule does. @page margins are applied to the page
       box before body lays out, so they are untouched; body's own box is what
       scales. Measured on the same rasters: 142..1513 in English and 141..1513
       in Arabic, which is the approved baseline's extent exactly, in both
       directions, at 2 pages each.

     Do NOT "simplify" this away by baking 0.936806 into every literal. The
     round numbers here are the design (18px, 26px, 104px); 16.86 and 24.36 are
     arithmetic. And do not read the 702 as meaningful - it was the old strip's
     width. The durable statement is the RATIO between a declared px and an
     approved paper px, which is what is written below.

     If an engine ignores zoom the sheet degrades exactly as the third paragraph
     describes: bigger, one page longer, nothing lost. */
  body { zoom: 0.936806; /* 657.638 / 702 */
    font-family: var(--sans);
    color: var(--ink);
    font-size: 9.5px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    font-variant-numeric: tabular-nums;
    font-feature-settings: 'tnum' 1, 'kern' 1;
    /* The split bar's solid block and the knocked-out figures inside it are
       INK, not decoration: an engine that drops backgrounds turns the delivered
       block into an empty outline, which is the OTHER state. */
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  /* ---------- ARABIC TYPOGRAPHY LAW ----------
     Carried over from lib/plainDocStyles.ts unchanged in principle, because the
     two kits must not disagree about whether Arabic is readable.

     ARABIC IS SET LARGER THAN THE LATIN IT SITS BESIDE. That is not a mistake
     to tidy up to matching numbers, it is what equal legibility costs. Latin
     capitals stay readable when tiny because their shapes are distinct
     outlines. Arabic is not: beh, teh, theh, noon and yeh share one body and
     differ ONLY in the number and position of their dots. Shrink the text and
     the dots close up and the reader is guessing words.

     NOTHING RENDERS BELOW 8.4px. */
  html[lang="ar"] body {
    font-family: var(--arabic), var(--sans);
    font-size: 10.6px;
    line-height: 1.72;
  }

  /* ---------- THE GRID ----------
     The single vertical the whole page is built on. grid-template-columns is
     already direction-aware: in an RTL document the gutter column lands on the
     right with no override, which is why the gutter is expressed here once and
     never flipped. */
  .row { display: grid; grid-template-columns: var(--gutter) 1fr; column-gap: var(--gutter-gap); }
  .full { grid-column: 1 / -1; }

  /* ---------- MASTHEAD ----------
     Deliberately NOT on the .row gutter grid. The title is the widest thing on
     the page and belongs across the whole measure; hanging it in the 104px
     title column crushes it to one word per line. Two tiers instead: a
     full-measure title, then a 1fr/auto footing of meta against figure. */
  .mast { margin-bottom: 20px; }
  .mast-line { display: flex; justify-content: space-between; align-items: baseline; gap: 18px; }
  .title {
    font-size: 27px; font-weight: 400; letter-spacing: -0.016em;
    line-height: 1.14; margin: 10px 0 0; max-width: 24ch;
  }
  .subtitle { font-size: 10.5px; color: var(--soft); margin-top: 7px; }
  .subtitle b { font-weight: 500; color: var(--ink); }

  .mast-foot {
    display: grid; grid-template-columns: 1fr auto; column-gap: 40px;
    align-items: end; margin-top: 22px;
  }
  .mast-meta { font-size: 8.5px; color: var(--mid); line-height: 1.85; }
  .mast-meta span { color: var(--ink); }

  /* The ONE dramatic figure, and the only place a number is allowed to be
     dramatic. text-align: end rather than right so it stays on the trailing
     edge when the page mirrors. */
  .figure-block { text-align: end; }
  .figure {
    font-size: 72px; font-weight: 200; letter-spacing: -0.035em;
    line-height: 0.84; color: var(--ink); white-space: nowrap;
  }

  /* LETTERHEAD. A report states who produced it in the footer and that is
     enough. A purchase order is an INSTRUCTION TO A THIRD PARTY and has to
     state the issuing company on its face: legal name, VAT registration, CR.
     The identity itself is never authored here, it is the same seller identity
     the invoice prints. */
  .letterhead { font-size: 8.5px; line-height: 1.7; color: var(--mid); }
  .letterhead b { display: block; font-size: 12.5px; font-weight: 600; color: var(--ink);
                  letter-spacing: -0.004em; margin-bottom: 3px; }
  .letterhead span { color: var(--ink); }

  .rule-heavy { border-top: var(--rule-heavy) solid var(--ink); margin-top: 15px; }

  /* ---------- SECTIONS ----------
     No break-after: avoid on the section head. It sits in the gutter COLUMN, so
     it cannot be stranded from its content by a page break the way a stacked
     heading can: the grid row carries both or fragments both. Asking Chromium
     to avoid a break after a GRID ITEM instead propagated the constraint
     outward and pushed the entire flow off page one, turning a 2-page sheet
     into a blank page followed by 2 pages. Do not reintroduce it.

     KEEP THE HEAD WITH ITS ROWS BY MAKING THE SECTION ATOMIC INSTEAD. The rule
     above says the grid row "carries both or fragments both", and fragmenting
     both is exactly what went wrong: on the Arabic sheet the by-driver section
     split so that page 2 ended with the section head, both pair labels and both
     2.4px rules above ZERO rows, and page 3 repeated the labels. break-inside
     on the GRID CONTAINER is a different property on a different element than
     the break-after trap above, and it does not propagate: it asks Chromium to
     move the whole row to the next page, which is the behaviour wanted.

     Two things this deliberately does NOT do. It does not bind the head to the
     FIRST ROW only - there is no CSS for that across a grid - so a section
     taller than a page still fragments, and Chromium drops the constraint
     rather than looping, which is the correct fallback for a long payments
     table. And it is NOT break-after: avoid on .pairlabel, which also clears
     the orphan and costs the English diff nothing, but fragments the head
     instead, stranding its Arabic label hairline in the gutter with nothing
     under it. An orphaned head reads as a page break; a floating rule reads as
     a printing fault. */
  section { margin-top: 26px; break-inside: avoid; }
  .sec-head {
    font-size: 8px; font-weight: 700; letter-spacing: 0.18em;
    text-transform: uppercase; color: var(--ink); line-height: 1.5;
    padding-top: 2px;
  }
  .sec-head .sub {
    display: block; font-weight: 400; letter-spacing: 0.08em;
    color: var(--quiet); margin-top: 4px;
  }

  /* ---------- STAT BAND ----------
     Figures on a shared baseline, no boxes. The cells are held apart by
     hairlines on their leading edge, which mirror for free.

     THE BAND IS SIZED TO FIT THE COLUMN, AND THAT IS NOT COSMETIC. Five cells
     of figure-plus-unit is the widest thing this kit builds, and at the
     original 21px/14px it did not fit: min-content 572.30 against a 527.64
     column. An over-wide block does not fail symmetrically. Left-to-right it
     overflows RIGHT, where Chromium's print auto-fit shrinks the whole page to
     compensate and nothing is visibly lost. Right-to-left the SAME overflow
     runs to negative x and is cut at the paper edge: the Arabic sheet printed
     its last stat as a sliced "|15.00" with the unit gone entirely. Same
     defect in both languages, invisible in one of them.

     18px and 8px are the measured fit, and they are measured in BOTH LATIN
     FACES, which matters more than it looks. --sans lists 'Helvetica Neue'
     before 'Inter', so a Mac never renders Inter and every other machine
     renders nothing else - and Inter sets these figures about 7.8% wider
     (616.69 min-content against Helvetica Neue's 572.30). A fix tuned on a Mac
     therefore proves nothing about production. At 18/8 the band is 478.67 in
     Helvetica Neue and 516.41 in Inter, inside 527.64 either way.

     min-width: 0 AND THE <wbr> IN blocks.ts ARE THE PART THAT LASTS. The sizes
     above fit THIS data; they do not fit all data, and one more digit on a
     six-figure revenue would put the band back over the column. The flex
     default min-width:auto is what lets a cell refuse to shrink and push the
     page out, so it is the actual mechanism of the clip. With it zeroed the
     band can never widen the page: an over-long figure drops its unit to a
     second line at the <wbr> instead of being cut off the edge. Losing a line
     break is a blemish. Losing the unit off a money figure is a wrong number. */
  .stats { display: flex; align-items: flex-end; break-inside: avoid; }
  .stats > div { flex: 1; min-width: 0; padding-inline: 8px;
                 border-inline-start: var(--rule-hair) solid var(--hair); }
  .stats > div:first-child { padding-inline-start: 0; border-inline-start: 0; }
  .stats > div:last-child { padding-inline-end: 0; }
  .stat-value { font-size: 18px; font-weight: 300; letter-spacing: -0.02em; line-height: 1; }
  .stat-unit { font-size: 8px; font-weight: 500; color: var(--mid); margin-inline-start: 3px;
               letter-spacing: 0.08em; }
  /* A metric the report cannot compute, as against one that is genuinely zero.
     Set in words, never in a faint numeral: a grey 0 reads as a measured zero
     and this is the opposite claim. */
  .stat-absent { font-size: 10.5px; font-weight: 400; font-style: italic; color: var(--quiet);
                 line-height: 1.35; letter-spacing: 0; }

  /* ---------- TABLES ----------
     No verticals, no zebra, ranked horizontals. */
  table { width: 100%; border-collapse: collapse; }
  /* Repeats the column head on every page a long table spills onto. Without it
     page two of a 90-row payslip register is an unlabelled grid of numbers. */
  thead { display: table-header-group; }
  /* NOT table-footer-group. As a footer group Chromium repeats the totals row
     on every page, so a 3-page register prints three different grand totals. */
  tfoot { display: table-row-group; }
  tr { break-inside: avoid; }
  th {
    font-size: 7.5px; font-weight: 700; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--ink); text-align: start;
    padding: 0 0 7px; border-bottom: var(--rule-mid) solid var(--ink);
  }
  td {
    font-size: 9.5px; padding: 8px 0; border-bottom: var(--rule-hair) solid var(--row);
    vertical-align: baseline;
  }
  tbody tr:last-child td { border-bottom: 0; }
  .num { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .name { font-weight: 500; }
  .quiet { color: var(--quiet); font-style: italic; }
  .wrap { white-space: normal; }
  tfoot td {
    border-top: var(--rule-mid) solid var(--ink); border-bottom: var(--rule-heavy) solid var(--ink);
    font-weight: 500; padding-top: 8px; padding-bottom: 8px;
  }
  .col-gap { padding-inline-end: 18px; }
  /* A grouping cell that spans its rows. Top-aligned, because it labels the
     whole run rather than sitting on any one baseline in it. */
  .group { vertical-align: top; font-weight: 500; padding-top: 8px;
           border-inline-end: var(--rule-hair) solid var(--row); padding-inline-end: 14px; }

  /* ---------- LEDGER ----------
     A ledger line is a step in an argument, not a row in a list, so the rule
     grammar is the opposite of a table's: rules are RARE and each one closes a
     step. Only the line the section is leading to is set in full ink. */
  tr.rule-above td { border-top: var(--rule-mid) solid var(--ink); padding-top: 10px; }
  tr.strong td { font-size: 12px; }
  .sub-line { display: block; font-size: 8px; color: var(--mid); line-height: 1.5; margin-top: 2px; }

  /* Seven short rows of two figures do not need seven rules. Ruling every one
     is the default-spreadsheet look and it puts twenty-eight hairlines on a
     page that needs four. Leading separates the rows; only the head and the
     total keep a rule, which is also the only place a rule means anything. */
  table.compact td { border-bottom: 0; padding: 6.5px 0; }
  table.compact th { padding-bottom: 8px; }
  table.compact tfoot td { padding-top: 9px; }

  /* A pairlabel is ALREADY a ruled head - that is the whole of what it is - so
     the column head directly beneath it must not draw a second one. Left in,
     the two land about 20px apart at the same weight and the block reads as two
     headings for one table, which is the exact effect ranked rules exist to
     prevent. Expressed as a selector rather than an option because the
     condition is structural: pair() emits the label immediately before the
     table, so nothing is being remembered at a call site. */
  .pairlabel + table th { border-bottom: 0; }

  /* An empty result is a SENTENCE, never a blank frame. A table with a head and
     no body reads as a rendering failure; this reads as an answer. */
  .empty-line { font-size: 9.5px; font-style: italic; color: var(--quiet);
                padding: 10px 0 2px; }

  /* ---------- THE SEVERITY GUTTER ----------
     Five reports currently carry meaning in hue alone: the receivables aging
     buckets, the cost sheet's uncosted fills, the narrative dots, the payslip
     unabsorbed flag and the daily sheet's unpriced trips. In grayscale every
     one of those collapses to the same grey and the reader loses the finding
     the report was written to surface.

     The replacement is a WORD. Not a shade, not a symbol, not an asterisk with
     a key at the bottom of the page: OVERDUE, UNCOSTED, RISE, UNPRICED, sitting
     in a narrow gutter on the row's leading edge. It reads at a glance, it
     survives a photocopier, it needs no legend, and it says WHICH problem
     rather than only that there is one.

     The same class serves at section scale, under a section head in the page
     gutter, so the device is one device at both scales. */
  .gw { font-size: 6.8px; font-weight: 700; letter-spacing: 0.16em;
        text-transform: uppercase; color: var(--ink); white-space: nowrap;
        line-height: 1.4; }
  .sec-head .gw { display: block; margin-top: 6px; padding-top: 5px;
                  border-top: var(--rule-mid) solid var(--ink); }
  /* The severity column itself: no head, minimum width, and it only exists on a
     table that actually has a flagged row. An always-present empty column is a
     column of nothing. */
  th.gwcol, td.gwcol { padding-inline-end: 12px; width: 1%; white-space: nowrap; }
  td.gwcol { padding-top: 9px; }

  /* ---------- PROSE, NOTES, PAIRS ---------- */
  .note { font-size: 8px; color: var(--mid); line-height: 1.7; margin-top: 9px; max-width: 72ch; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; column-gap: 34px; }
  .pairlabel {
    font-size: 7.5px; font-weight: 700; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--ink);
    padding-bottom: 7px; border-bottom: var(--rule-mid) solid var(--ink); margin-bottom: 8px;
  }
  /* No break-after: avoid here - see SECTIONS above, which solves the orphan it
     would have solved, without fragmenting the head to do it. */

  /* ---------- THE CALLOUT: weight, not a box ---------- */
  .callout { border-top: var(--rule-heavy) solid var(--ink); padding-top: 10px; break-inside: avoid; }
  .callout-val { font-size: 27px; font-weight: 300; letter-spacing: -0.02em; line-height: 1; }
  .callout-note { font-size: 8px; color: var(--mid); margin-top: 7px; line-height: 1.65; max-width: 74ch; }

  /* ---------- ROLLING WINDOWS ---------- */
  .windows { display: flex; break-inside: avoid; margin-top: 4px; }
  .windows > div { flex: 1; padding-inline-start: 14px; border-inline-start: var(--rule-hair) solid var(--hair); }
  .windows > div:first-child { padding-inline-start: 0; border-inline-start: 0; }
  .win-count { font-size: 17px; font-weight: 300; line-height: 1.25; }
  .win-sub { font-size: 8.5px; color: var(--soft); }

  /* ---------- IDENTITY GRID ----------
     Label over value, in columns. Used where a document must state a set of
     facts about itself (a purchase order's supplier and terms, an exit
     permit's vehicle and driver) rather than measure anything. */
  .ident { display: grid; grid-template-columns: repeat(var(--ident-cols, 3), 1fr);
           column-gap: 26px; row-gap: 14px; break-inside: avoid; }
  .ident-val { font-size: 10.5px; line-height: 1.45; margin-top: 5px; }
  .ident-val b { font-weight: 500; }

  /* ---------- CHIPS ----------
     A set of short values that is a SET, not a ranking: the filters a custom
     report was built from, the water types seen in a month. Outlined, never
     filled, so no chip can be read as more important than its neighbour. */
  .chips { display: flex; flex-wrap: wrap; gap: 5px 6px; margin-top: 4px; }
  .chip { border: var(--rule-hair) solid var(--hair); padding: 2px 8px 3px;
          font-size: 8.5px; line-height: 1.4; color: var(--ink); }

  /* ---------- STATUS MARK ----------
     The one categorical device that is not a word: a SOLID mark means the thing
     happened, a DASHED outline means it did not. Both survive greyscale because
     neither depends on hue, and it is the same grammar the invoice already
     uses, so a reader who has seen one document can read the other. */
  .mark { display: inline-block; font-size: 7.2px; font-weight: 700; letter-spacing: 0.1em;
          text-transform: uppercase; padding: 2px 8px; white-space: nowrap; line-height: 1.4; }
  .mark.on { background: var(--ink); color: #ffffff; }
  .mark.off { border: var(--rule-hair) dashed var(--mid); color: var(--soft); }

  /* ---------- SIGNATURE BLOCK ----------
     A rule to sign ON, with the label BENEATH it. Above the rule the label
     competes with the signature for the same space and the signature wins,
     which is how a signed form ends up unreadable. */
  .signs { display: flex; gap: 34px; margin-top: 26px; break-inside: avoid; }
  .signs > div { flex: 1; }
  .sign-line { border-top: var(--rule-mid) solid var(--ink); margin-top: 34px; padding-top: 6px; }
  .sign-sub { font-size: 7.5px; color: var(--mid); margin-top: 3px; }

  /* ---------- CHARTS ---------- */
  .chart { break-inside: avoid; margin-top: 2px; }
  /* Child combinator, not a descendant: the legend's swatches live inside a
     .chart too and carry the band on their own row instead (see .legend > span).

     PADDING, not margin, and content-box against the global border-box reset.
     Margin was tried first and did nothing twice over, for two different
     reasons: below the trend chart it collapsed with .legend's 10px margin-top
     (max, not sum) so the legend never moved, and below the split bar - last
     child of a .chart that is not itself a grid item - it collapsed straight out
     of the box. Padding does neither, and content-box keeps the height attribute
     meaning the same thing it does in the viewBox, which is what stops the
     letterbox scale from changing. */
  .chart > svg {
    display: block; box-sizing: content-box;
    padding-bottom: var(--chart-leading);
  }
  /* The legend is HTML, not SVG text, so the browser measures the label widths
     instead of this kit guessing them from a character count. That guess was
     wrong for Arabic by roughly a third, since Arabic glyphs join and carry no
     capitals. Flex also mirrors for free. The swatches stay SVG because they
     must draw the REAL dash pattern and the REAL marker: a legend that does not
     show what is actually on the page is decoration.

     margin-inline:auto pairs with the inline max-width trendLegend sets, so the
     legend picks up the same letterbox offset preserveAspectRatio gives its own
     chart in print. The measurement and the reason live in trendLegend's
     header; do not replace this with a hard-coded indent. */
  .legend {
    display: flex; flex-wrap: wrap; align-items: center; gap: 4px 26px;
    margin-top: 10px; margin-inline: auto;
  }
  /* The band goes on the ROW, not on the swatch: it has to sit below the label
     as well, and the label is the taller of the two whenever the type grows
     (Arabic runs 9.4px here). Put it on the svg instead and a long-label legend
     would clear its note by less than a short-label one. */
  .legend > span {
    display: inline-flex; align-items: center; gap: 6px;
    margin-bottom: var(--chart-leading);
  }
  /* overflow:visible so a round line-cap at x=0 renders outside the viewBox,
     exactly as it did when the whole legend was one wide SVG. Clipped instead,
     the swatch rule loses a cap at each end and reads shorter than the chart's
     own strokes, which are drawn with the same cap. */
  .legend svg { display: block; flex: 0 0 auto; overflow: visible; }
  .legend .k { font-size: 7.6px; letter-spacing: 0.09em; text-transform: uppercase; }
  .legend .k1 { font-weight: 600; color: var(--ink); }
  .legend .k2 { font-weight: 400; color: var(--mid); }

  /* ---------- DEFINITION LIST ---------- */
  /* The dl states its OWN margins. Nothing else in this sheet leaves a block
     margin to the UA stylesheet, and this one was doing it twice over: 1em top
     and 1em bottom, where 1em is the list's own 9.5px. It read as correct only
     because the last dd's 12px rhythm margin collapsed through the bottom and
     won the max. Zeroing that last margin - the obvious tidy-up - therefore did
     not remove 0px, it removed the 2.5px by which 12 beat 9.5, and SOURCES came
     out 2.5px short, which on page 2 put BY DRIVER and everything under it 6
     raster px high. Stated here, the box no longer depends on a collapse or on
     a default. */
  .inline-list { font-size: 9.5px; line-height: 1.75; margin: 9.5px 0 12px; }
  .inline-list dd { margin: 0 0 12px; }
  .inline-list dd:last-child { margin-bottom: 0; }

  /* ---------- SHEET FOOTER ----------
     Identity and provenance, not page numbers. Chromium has no @page counter
     support, so a CSS-only footer would print the words Page of with nothing
     between them on every sheet. Page numbering comes from the print pipeline:
     the browser print dialog for a printed sheet, displayHeaderFooter for a
     generated PDF. */
  .sheet-foot { margin-top: 22px; padding-top: 5px; border-top: var(--rule-hair) solid var(--hair);
                display: flex; justify-content: space-between; gap: 18px;
                font-size: 7px; color: var(--mid); letter-spacing: 0.06em;
                break-inside: avoid; }

  /* ---------- BIDI SAFETY ----------
     Every figure and every identifier is wrapped by iso() in ./blocks.ts. The
     dir attribute it emits already carries unicode-bidi: isolate through the
     HTML UA stylesheet; this restates it so the isolation does not depend on
     that, and so a reader of the CSS can see that it is intended.

     THE BUG THIS PREVENTS: a Latin or numeric run that STARTS WITH A DIGIT
     reorders inside an Arabic paragraph. Every number and date in this app is
     pinned to en-US Latin digits in both languages, so in an Arabic report
     every single figure is a foreign LTR run inside RTL text, which makes this
     the most-exercised rule in the file rather than an edge case. */
  .iso { unicode-bidi: isolate; }

  /* ---------- LABELS, SYSTEM ONE: LATIN ----------
     Tracked uppercase micro-type. Small enough to stay out of the way, tracked
     and capitalised enough that it can never be mistaken for content. */
  .lbl {
    font-size: 7.5px; font-weight: 600; letter-spacing: 0.15em;
    text-transform: uppercase; color: var(--mid);
  }
  .lbl-strong { font-weight: 700; letter-spacing: 0.14em; color: var(--ink); }
  .eyebrow { letter-spacing: 0.17em; }
  .stat-label { margin-bottom: 9px; min-height: 20px; }
  .win-label { font-size: 7px; letter-spacing: 0.16em; font-weight: 700; }
  .figure-cap { letter-spacing: 0.17em; font-weight: 600; margin-bottom: 10px; }
  .figure-unit { font-size: 9px; font-weight: 500; letter-spacing: 0.22em; margin-top: 8px; }
  .inline-list dt { font-weight: 700; letter-spacing: 0.14em; margin-bottom: 3px; }

  /* ---------- LABELS, SYSTEM TWO: ARABIC ----------
     THE LATIN SYSTEM CANNOT BE TRANSLATED, IT HAS TO BE REPLACED.

     Both of its devices are unavailable in Arabic and not as a matter of taste.
     Arabic has NO CASE, so text-transform: uppercase does nothing at all and
     the label loses its loudest signal silently. And letter-spacing is actively
     destructive: Arabic letters JOIN, and tracking prises the joins apart, so a
     tracked Arabic word is not a styled word, it is a broken one.

     So the Arabic label is built from the three devices that do survive:
       WEIGHT  700 against body 400, a full step rather than a nudge.
       SIZE    9.6px against a 7.5px Latin label. Larger, not smaller: the
               dotted-letter problem in the typography law above bites hardest
               exactly here, on the shortest runs.
       RULE    a hairline under the label, which is what actually replaces the
               tracking. It is the rule, not the weight, that makes a 9.6px bold
               Arabic run read as a HEADING rather than as a short bold
               sentence, because at that size and weight nothing else
               distinguishes the two.

     THE RULE IS ADDED ONLY WHERE ONE IS NOT ALREADY THERE. A table head and a
     pair label already close with a rule in both languages, so they need weight
     and size only; adding a second would double it. The masthead eyebrow and
     the figure caption are single runs standing alone in white space with
     nothing they could be confused with, and ruling them would clutter the one
     part of the page that earns its silence. */
  html[lang="ar"] .lbl,
  html[lang="ar"] th,
  html[lang="ar"] .pairlabel,
  html[lang="ar"] .sec-head,
  html[lang="ar"] .gw,
  html[lang="ar"] .mark,
  html[lang="ar"] .legend .k {
    letter-spacing: 0;
    text-transform: none;
    font-weight: 700;
  }
  html[lang="ar"] .lbl { font-size: 9.6px; color: var(--ink); }
  html[lang="ar"] .sec-head { font-size: 10.2px; line-height: 1.6; }
  html[lang="ar"] .sec-head .sub { font-size: 9.2px; font-weight: 400; color: var(--quiet); }
  html[lang="ar"] th { font-size: 9.2px; }
  html[lang="ar"] .pairlabel { font-size: 9.6px; }
  html[lang="ar"] .gw { font-size: 8.6px; }
  html[lang="ar"] .mark { font-size: 8.6px; font-weight: 700; }
  html[lang="ar"] .legend .k { font-size: 9.4px; }
  html[lang="ar"] .legend .k2 { font-weight: 400; }
  html[lang="ar"] .win-label { font-size: 9.2px; }
  html[lang="ar"] .figure-cap { font-size: 9.4px; }
  html[lang="ar"] .figure-unit { font-size: 9.6px; font-weight: 700; }
  html[lang="ar"] .inline-list dt { font-size: 9.6px; }

  /* THE RULE. Applied to the labels that LEAD a block of content, which is
     precisely where the Latin system used tracking to say I am a heading. */
  html[lang="ar"] .sec-head,
  html[lang="ar"] .stat-label,
  html[lang="ar"] .win-label,
  html[lang="ar"] .ident .lbl,
  html[lang="ar"] .inline-list dt {
    border-bottom: var(--lbl-rule);
    padding-bottom: 4px;
  }
  /* The stat label reserves a fixed height in Latin so five figures share a
     baseline whatever their labels wrap to. The Arabic label is taller, so the
     reservation has to grow with it or the rules under a two-line label and a
     one-line label land at different heights across the strip. */
  html[lang="ar"] .stat-label { min-height: 30px; }

  /* The severity gutter word is the one Arabic label that keeps a rule despite
     sitting in a table, because it is the only text in that column and without
     a rule a 8.6px bold Arabic word reads as an ordinary short cell value. */
  html[lang="ar"] .sec-head .gw { border-bottom: 0; }

  /* Arabic set at a light weight falls back to Cairo's 400 floor, so a 300
     Latin figure and a 400 Arabic word beside it read as the same weight. The
     figures are Latin digits and unaffected; this catches the WORDS that share
     those lines. */
  html[lang="ar"] .stat-absent { font-size: 10.4px; }
`;

/**
 * Wraps a rendered body in the ATLAS shell.
 *
 * `lang` and `dir` are REQUIRED and are the reason this function exists rather
 * than reusing plainDocShell. They are passed as a pair rather than derived
 * from each other so a future third language cannot silently inherit the wrong
 * direction from a two-branch guess.
 *
 * The mirroring itself is not done here and is not done per-report: every rule
 * in ATLAS_CSS that could take a side is written with a LOGICAL property, so
 * setting dir on the root element is the whole of it. There is no RTL
 * stylesheet to keep in step with the LTR one, which is the failure mode that
 * makes bidirectional layouts rot.
 *
 * `extraCss` exists for a document that needs a rule the kit cannot own: a
 * column width, a one-off block. If a SECOND document ever passes the same
 * extra rule, that rule belongs in ATLAS_CSS instead.
 */
export function atlasDocShell(opts: {
  lang: string;
  dir: Dir;
  title: string;
  body: string;
  extraCss?: string;
}): string {
  return `<!doctype html>
<html lang="${opts.lang}" dir="${opts.dir}">
<head>
<meta charset="utf-8" />
<title>${opts.title}</title>
<style>
${atlasFontFaceCss()}
${ATLAS_CSS}
${opts.extraCss ?? ""}
</style>
</head>
<body>
${opts.body}
</body>
</html>`;
}
