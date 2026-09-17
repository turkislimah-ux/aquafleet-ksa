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

  /* ---------- THE COMPACT VARIANT ----------
     One flag, for a document that is a SINGLE SHEET by nature rather than by
     luck: an exit permit is a gate pass, signed on a bonnet, and the whole of
     it has to be in one hand. The report scale is built for a spread that can
     afford 26px between sections; here that spacing is what pushes a ten-line
     permit onto a second page carrying nothing but signatures.

     WHAT IT TIGHTENS IS SPACE, AND THE TITLE. Nothing else. The title drops
     27px -> 21px because a permit number is an identifier to read once, not a
     headline; every other change is a margin or a padding.

     WHAT IT DELIBERATELY DOES NOT TOUCH IS TYPE SIZE, and that is the whole
     discipline of it. body stays 9.5px and the Arabic body stays
     10.6px/1.72, because the Arabic typography law above is a LEGIBILITY floor,
     not a default to trade against a page count: beh, teh, theh, noon and yeh
     differ only in dots, and a compact flag that shrank them would buy one page
     by making the Arabic sheet a guess. A permit that still runs to two pages
     runs to two pages — see the exit permit renderer on why clipping is not an
     option available to this kit.

     A body class rather than an extraCss string passed per document, so the
     SECOND compact document inherits the same decisions instead of restating
     them slightly differently. */
  body.compact .mast { margin-bottom: 14px; }
  body.compact .title { font-size: 21px; margin-top: 8px; }
  body.compact .mast-foot { margin-top: 16px; }
  body.compact section { margin-top: 17px; }
  body.compact .ident { row-gap: 13px; }
  body.compact td { padding: 6px 0; }
  body.compact .signs { margin-top: 20px; gap: 26px; }
  body.compact .sign-line { margin-top: 26px; }
  /* The declaration wrapper takes the compact top margin INSTEAD of the .signs
     inside it (zeroed above), so the section moves as one piece. */
  body.compact .sign-sec { margin-top: 20px; }
  body.compact .sign-sec .signs { margin-top: 0; }

  /* ---------- THE GRID ----------
     The single vertical the whole page is built on. grid-template-columns is
     already direction-aware: in an RTL document the gutter column lands on the
     right with no override, which is why the gutter is expressed here once and
     never flipped. */
  .row { display: grid; grid-template-columns: var(--gutter) 1fr; column-gap: var(--gutter-gap); }
  .full { grid-column: 1 / -1; }
  /* A GRID ITEM STRETCHES TO ITS ROW BY DEFAULT, and a stretched head is a box
     the height of the whole section wearing a two-line label. That is invisible
     in Latin, where the head carries no rule — and wrong in Arabic, where it
     carries one: the rule that is supposed to sit UNDER THE LABEL gets painted
     at the bottom edge of the stretched box instead. On the Arabic receivables
     sheet the open-invoices head measured 84px tall for ~33px of text, so its
     rule landed level with the LAST ROW of the table, detached from the words it
     underlines and reading as a stray hairline in white space. Hugging the
     content fixes both languages at once and changes nothing in Latin. */
  .row > .sec-head { align-self: start; }

  /* ---------- MASTHEAD ----------
     Deliberately NOT on the .row gutter grid. The title is the widest thing on
     the page and belongs across the whole measure; hanging it in the 104px
     title column crushes it to one word per line. Two tiers instead: a
     full-measure title, then a 1fr/auto footing of meta against figure. */
  .mast { margin-bottom: 20px; }
  .mast-line { display: flex; justify-content: space-between; align-items: baseline; gap: 18px; }
  /* The trailing-edge group: a reference and any status marks travel together.
     Its own flex context, because as siblings of the eyebrow they would be
     spread by the space-between above and the reference would land against the
     opposite margin from the marks it qualifies. */
  .mast-end { display: flex; align-items: baseline; gap: 12px; }
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
  /* The hairline counterpart, for a divide INSIDE a section: the block below it
     belongs to the same head but is a different KIND of statement — a rejection
     under the approvals it overrides, not one more of them. A heavy rule there
     would read as the end of the section, which is the opposite claim. */
  .rule { border-top: var(--rule-hair) solid var(--hair); margin-top: 11px; }

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
  /* ---------- ...EXCEPT A SECTION THAT HOLDS A TABLE ----------
     The paragraph above says a section taller than a page "still fragments, and
     Chromium drops the constraint rather than looping, which is the correct
     fallback". It drops the constraint, but NOT before first shunting the whole
     section to the next sheet — so a 34-line purchase order printed a
     THREE-QUARTERS-EMPTY PAGE ONE, then split the table across pages two and
     three anyway. The atomicity bought nothing and cost a sheet of A4.

     A TABLE DOES NOT NEED THE SECTION TO BE ATOMIC, because it already solves
     the same problem better. Atomicity exists to stop a gutter head being
     stranded above zero rows; a table repeats its column heads on every page it
     spills onto (table-header-group, below) and keeps each row whole (tr,
     break-inside: avoid), so the reader can never meet an unlabelled fragment.
     A pair grid has neither and keeps the rule.

     break-after: avoid on the thead is the remaining guard: it stops Chromium
     placing the column heads at the foot of a page with their first row
     overleaf, which is the one orphan table-header-group cannot fix by itself.

     :has() is the selector rather than a class because WHICH sections are
     tables is a fact about the document's content, not a decision the caller
     should have to remember — a new renderer that forgets to pass a flag gets a
     wasted page and no error. On an engine without :has() the rule simply does
     not match and the behaviour is today's, which is wasteful, not broken.

     NO BACKTICKS IN THIS COMMENT, and none anywhere else in this string either:
     the whole stylesheet is a TEMPLATE LITERAL, so a backtick quoting a CSS
     keyword ENDS IT. The first draft of this paragraph quoted four of them and
     turned the rest of the file into a syntax error at the next stray "table".
     Quote CSS in prose bare, the way every comment above does. */
  section:has(table) { break-inside: auto; }
  thead { break-after: avoid; }
  .sec-head {
    font-size: 8px; font-weight: 700; letter-spacing: 0.18em;
    text-transform: uppercase; color: var(--ink); line-height: 1.5;
    padding-top: 2px;
  }
  .sec-head .sub {
    display: block; font-weight: 400; letter-spacing: 0.08em;
    color: var(--quiet); margin-top: 4px;
  }

  /* ---------- THE OTHER SECTION MODE: TITLE ON TOP ----------
     Same section, same head element, same ranked label — the title simply sits
     ABOVE its content at full measure instead of hanging in a leading column.
     A REPORT chooses the gutter, because its titles form a scannable rail down
     the edge of a page the reader skims. A DOCUMENT chooses this, because a
     purchase order's line table has six columns to place and no width to lend
     to a rail of headings nobody reads twice.

     THERE IS NO .stack DISPLAY DECLARATION, AND THAT IS THE POINT. .row has to
     declare a grid to make two columns; stacking is what a section does on its
     own. Everything below is the consequence of losing the column, nothing more.

     WIDTH IS THE ONE THING THAT DOES NOT SURVIVE THE MOVE. In the gutter the
     head is 104px wide because the COLUMN is, so the Arabic label hairline
     (html[lang=ar] .sec-head, far below) draws under the label and stops. Let
     the same head be an ordinary block and it inherits the full measure, so
     that hairline becomes a rule clean across the sheet — which is a section
     DIVIDER, a different claim than this label makes, sitting directly above
     content it would appear to separate rather than name. max-content restores
     the gutter's behaviour without restoring the gutter: the box hugs the
     longest of the label, its sub and its severity word, so both the Arabic
     hairline and the Latin severity rule stay label-width in either mode.
     max-width keeps a long head wrapping inside the measure instead of
     overflowing it — the same asymmetric overflow the stat band documents,
     where RTL loses text off the paper edge and LTR quietly shrinks the page.

     No inline alignment is written and none is needed. A block box with
     max-content width and no auto margins sits at the containing block's inline
     START edge, which is the right edge under dir=rtl. Writing left/right here
     would be the bug, not the fix.

     BREAK-AFTER: AVOID IS CORRECT HERE AND WRONG ONE RULE ABOVE. The SECTIONS
     comment bans it on a gutter head: there the head is a GRID ITEM, Chromium
     propagates the constraint out to the container and pushes the whole flow off
     page one. A stacked head is an ordinary block child, the constraint stays
     local, and it is genuinely needed — a section holding a table has
     break-inside: auto, so without this a head can print at the foot of a page
     with its table overleaf. The child combinator is load-bearing: it scopes the
     rule to this mode so it can never reach the grid-item case. */
  /* 13px IS MEASURED, NOT CHOSEN. It was 9px first, which renders a real
     computed gap of 8.4px between head and content — while the identity grid
     INSIDE that content sets its own two rows 33px apart. That inverts the
     hierarchy: the heading binds more tightly to the first row of fields than
     the rows bind to each other, so ORDER reads as a label on PO NUMBER rather
     than a title over all eight fields. The gutter never exposed this, because
     there the head is in a different COLUMN and the eye never compares the two
     gaps. Stacking is what puts them on the same axis, so the mode owns the fix.
     13px is the value at which the head visibly floats above its block, and it
     is bounded above by the 26px that separates one section from the next -
     bought by re-rendering, not by taste: every purchase-order fixture holds its
     page count at 13px, in both languages. */
  /* BREAK-INSIDE IS A SECOND RULE, NOT A RESTATEMENT OF BREAK-AFTER. The sub
     line is a child of this box, not a sibling of it, so break-after: avoid
     says nothing about the boundary BETWEEN the name and the count - and that
     is the boundary the daily sheet actually broke on, printing R TTT at the
     foot of page one and 7 ASSIGNED DRIVERS at the head of page two above a
     table nothing on that page named. A heading is one object; it does not
     paginate. Two lines high, so nothing can be stranded by holding it whole. */
  .stack > .sec-head {
    width: max-content; max-width: 100%;
    padding-top: 0; margin-bottom: 13px;
    break-after: avoid;
    break-inside: avoid;
  }
  /* The Arabic head closes with a hairline and 4px of padding under it, so its
     ink stops lower in the same box. Matching the Latin 13px would therefore
     read TIGHTER, not equal. Two more, so the gap under the RULE matches the gap
     under Latin TEXT. Keep this above the Latin value if that one moves. */
  html[lang="ar"] .stack > .sec-head { margin-bottom: 15px; }

  /* ---------- A SECTION THAT IS A DIFFERENT DOCUMENT ----------
     Ordinary sections are STEPS of one argument and are held apart by 26px of
     space alone. This one is not a step: the P&L sheet carries a VAT list that
     shares its period and its paper and NOTHING ELSE — no total, no net, no
     column in common, and the P&L's figures must never be read as summing with
     it. The screen states that with a 10mm gap between two cards. On paper a gap
     of any size is just a gap, and the reader has no card edge to infer from; at
     a page boundary the gap disappears entirely and the two run together.

     A RULE SAYS IT AND SPACE CANNOT. --rule-heavy is the weight the sheet
     already spends on a closing total, which is the right register: this is a
     harder break than any rule INSIDE either table, so it must outweigh them.

     ON THE SECTION, NOT ON THE HEAD, and the .stack comment above is why: a
     border on the head would draw only to max-content width and read as
     underlining the words. The claim is about the whole block beneath it.

     The margin is what it replaces, so the padding restores the head's air
     under the new ink rather than adding to it - 26px of margin sits ABOVE the
     rule, 20px of padding below it. Logical properties are unnecessary: a
     horizontal rule mirrors to nothing. */
  section.sec-break {
    border-top: var(--rule-heavy) solid var(--ink);
    padding-top: 20px;
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
  tfoot { display: table-row-group; break-before: avoid; }
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
  /* A cell whose WORDING is a mid-sentence noun the screen sets in a column of
     its own. The leaf really is lowercase ("special") because it is written to
     read inside a sentence too, and the screen lifts it with CSS rather than
     storing a second cased copy. The sheet mirrors the screen, so it lifts it
     the same way — casing here is LOOK, and moving it into the view-model
     would be a second spelling of one word. Inert in Arabic, which has no
     case; that is the whole reason the device is case and not letter-spacing. */
  .cap { text-transform: capitalize; }
  /* A line that was REFUSED. The rule is the whole device: the screen also
     drops the row to 60% opacity, and a grey row is a grey row on a
     photocopier — indistinguishable from ink that ran. The severity word in the
     gutter carries what the opacity was saying; this carries what the
     line-through was. A sub-line under the value keeps full ink and no rule,
     because the REASON is not itself struck out. */
  .strike { text-decoration: line-through; }
  /* text-decoration: none CANNOT cancel an ancestor's line. Decorations
     PROPAGATE to in-flow descendants and are drawn by the ancestor across
     them, so a "none" on the child is inert — measured on an A4 proof, where
     the deny reason came out struck through with this exact rule in place.
     Only a box the line does not propagate INTO escapes it, and an atomic
     inline is one; width:100% then makes that inline-block occupy the whole
     measure, so it still starts its own line as display:block did. */
  .strike .sub-line {
    display: inline-block; width: 100%; text-decoration: none;
  }
  tfoot td {
    border-top: var(--rule-mid) solid var(--ink); border-bottom: var(--rule-heavy) solid var(--ink);
    font-weight: 500; padding-top: 8px; padding-bottom: 8px;
  }
  .col-gap { padding-inline-end: 18px; }
  /* A grouping cell that spans its rows. Top-aligned, because it labels the
     whole run rather than sitting on any one baseline in it. */
  .group { vertical-align: top; font-weight: 500; padding-top: 8px;
           border-inline-end: var(--rule-hair) solid var(--row); padding-inline-end: 14px; }
  /* The FAR side of that rail. The rule above pays its 14px INSIDE the grouping
     cell, so it only opens air between the name and the hairline; the column
     beside it has no horizontal padding of its own - td pays 8px top and bottom
     and nothing either side - so its first glyph lands ON that hairline. Air on
     one side only does not read as a gutter between two columns, it reads as a
     rule shoved against the plate, and it reads that way in both directions
     equally: the padding is logical, so RTL moves the crowding to the other
     side rather than curing it.

     Applied BY COLUMN, never by an adjacent-sibling selector. Under a rowSpan
     the rows beneath the spanned name carry no grouping cell at all, so a
     sibling rule would indent the first row of each group and none of the rest
     - a plate column that steps sideways halfway down every group. The head and
     the foot take it too: neither draws a rail, but both must line up with the
     body that does. */
  .rail-gap { padding-inline-start: 14px; }

  /* ---------- LEDGER ----------
     A ledger line is a step in an argument, not a row in a list, so the rule
     grammar is the opposite of a table's: rules are RARE and each one closes a
     step. Only the line the section is leading to is set in full ink. */
  tr.rule-above td { border-top: var(--rule-mid) solid var(--ink); padding-top: 10px; }
  tr.strong td { font-size: 12px; }
  .sub-line { display: block; font-size: 8px; color: var(--mid); line-height: 1.5; margin-top: 2px; }
  /* The same device one row up, in a COLUMN HEAD. A head is tracked caps and a
     sub-head is not: "accrual" set in 0.14em caps beside the metric it
     qualifies reads as a second heading of equal rank, which is the one thing
     it must not. Weight and case are what rank the two lines here, exactly as
     they rank .sec-head against its .sub. */
  th .sub-line { text-transform: none; letter-spacing: 0.03em; font-weight: 400; }

  /* Seven short rows of two figures do not need seven rules. Ruling every one
     is the default-spreadsheet look and it puts twenty-eight hairlines on a
     page that needs four. Leading separates the rows; only the head and the
     total keep a rule, which is also the only place a rule means anything. */
  table.compact td { border-bottom: 0; padding: 6.5px 0; }
  table.compact th { padding-bottom: 8px; }
  table.compact tfoot td { padding-top: 9px; }

  /* A HEADING INSIDE THE TABLE BODY, and the two devices under it.
     Both are for the ledger that runs long enough to have STEPS — the P&L runs
     eighteen lines from revenue to profit after Zakat — where the column head
     cannot name them, because the head belongs to the columns and the columns
     do not change down the page.

     BOTH SELECTORS NAME "table", and that is the gwcol trap above, not a style:
     "table.compact td" sets the SHORTHAND "padding: 6.5px 0" at (0,1,2), so a
     bare "td.sechead" at (0,1,1) loses wherever it is written and the heading
     would sit at row leading with no air above it. Naming the element ties the
     score, and these rules are later, so they win. They are BELOW the compact
     block for the same reason and must stay there.

     No rule of its own: a line under a section head would read as CLOSING the
     step above rather than opening the one below, and closing a step is the one
     thing a rule means in this table (tr.rule-above). Case and tracking carry it
     instead — the column head's device one rank down, in --mid rather than ink. */
  table td.sechead {
    text-transform: uppercase; letter-spacing: 0.12em; font-size: 7.5px;
    font-weight: 700; color: var(--mid);
    padding-top: 15px; padding-bottom: 1px;
  }
  /* Nothing above the first row to clear. */
  table tbody tr:first-child td.sechead { padding-top: 2px; }

  /* A line that is a COMPONENT of another line rather than a step of its own -
     parts and outsourced under cost of operations. Indent is the only device
     that says "these sum to the line below" without a word for it, and it
     spends no weight, no rule and no colour, all three of which are already
     carrying other meanings in this table. Logical, so it is the right edge in
     Arabic without a second rule. */
  table td.indent { padding-inline-start: 15px; }

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
     column of nothing.

     SPECIFICITY DECIDES THIS, NOT SOURCE ORDER, and both selectors below name
     the element "table" for that reason alone. "table.compact td" above sets
     the SHORTHAND "padding: 6.5px 0", which scores (0,1,2); a bare "td.gwcol"
     scores (0,1,1) and loses, wherever it is written. The trailing gap went
     to zero and the severity word welded itself to the sentence it qualifies —
     WATCH28,960 on the English narrative, and the same in Arabic. Naming
     it here ties the score, and a tie is settled by position, which these
     rules win. A compact table was the ONLY variant that lost, which is why it
     went unseen: the flagged tables shipped so far are all full-height. */
  table th.gwcol, table td.gwcol {
    padding-inline-end: 12px; width: 1%; white-space: nowrap; }
  table td.gwcol { padding-top: 9px; }

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

  /* ---------- RUNS ----------
     A named set where every member carries its own COUNT, inside a table cell:
     the projects one driver served, with the trips on each. Chips are wrong for
     it twice over - a box drawn around each of five names in one cell outweighs
     the names it holds, and a count has nowhere to sit inside a chip.

     STACKED, ONE RUN PER LINE, not flowed as a cloud. Flowed, the line break
     falls wherever the cell width puts it, so a count lands beside the NEXT
     name as often as beside its own and the cell stops being readable as pairs
     at all. Stacked, a long name still wraps, but it wraps inside its own run
     and keeps its figure with it.

     The NAME takes the label system, which is what makes the set greyscale and
     unmistakable for the plain values in the columns beside it - tracked caps
     in Latin, weight and size in Arabic, both inherited from .lbl. Tracked
     LESS than a real label, because a project name is several times longer than
     one.

     BOTH HALVES RUN IN FULL INK. The count was set in --mid to mark it as the
     quiet half, and that was a misreading of what the cell holds: the count IS
     the measurement - the trips this driver ran on this project, the figure the
     Trips column beside it totals - and a number the reader has to lean in to
     make out is a number the sheet failed to state. The two are ranked by CASE
     and TRACKING instead, which costs no contrast to spend: the name is tracked
     caps, the count is plain tabular figures, and nothing else in the cell looks
     like either one. */
  .runs { margin-top: 1px; }
  .run { display: block; line-height: 1.5; }
  .run + .run { margin-top: 2px; }
  .run-label { font-size: 8px; letter-spacing: 0.1em; color: var(--ink); }
  .run-count { font-size: 9px; font-weight: 500; color: var(--ink);
               font-variant-numeric: tabular-nums; margin-inline-start: 7px; }

  /* ---------- STATUS MARK ----------
     SOLID means it happened, DASHED means it did not. The grammar is unchanged
     and the invoice still reads the same way. What changed is WHERE the two
     states are drawn: on a rule UNDER the word, never as a box around it.

     The box was wrong on paper. A filled panel of ink and a four-sided outline
     are both heavier objects than the 7.2px word they hold, so the loudest thing
     on a register row was a container, and the eye went to the darkest rectangle
     on the sheet instead of to the money the sheet is about. Ruled, the mark
     ranks with the micro-labels it belongs to and the figures stay on top.

     It also gives the cell its horizontal space back. The box paid 8px of
     padding on each side, which is what shoved a status hard against the figure
     in the column before it — and padding inside the MARK cannot fix that,
     because the head and the totals row carry no mark and would not move with
     it. Separation between two columns is a COLUMN's job; it is paid once, by
     .col-gap, where all three row-groups answer it the same way.

     RULE-MID RATHER THAN RULE-HAIR, and only because of the dashes: at 0.6px a
     dash pattern renders as an intermittent smudge rather than as a dashed line,
     so the single distinction this device rests on stops being legible at
     exactly the size it is needed. Both states take the SAME weight — solid
     versus dashed is the whole signal, and thickening one would rank the two as
     well as tell them apart. */
  .mark { display: inline-block; font-size: 7.2px; font-weight: 700; letter-spacing: 0.14em;
          text-transform: uppercase; white-space: nowrap; line-height: 1.4;
          padding-bottom: 2px; color: var(--ink); }
  .mark.on { border-bottom: var(--rule-mid) solid var(--ink); }
  .mark.off { border-bottom: var(--rule-mid) dashed var(--mid); color: var(--soft); }

  /* ---------- SIGNATURE BLOCK ----------
     A rule to sign ON, with the label BENEATH it. Above the rule the label
     competes with the signature for the same space and the signature wins,
     which is how a signed form ends up unreadable. */
  .signs { display: flex; gap: 34px; margin-top: 26px; break-inside: avoid; }
  .signs > div { flex: 1; }
  .sign-line { border-top: var(--rule-mid) solid var(--ink); margin-top: 34px; padding-top: 6px; }
  .sign-sub { font-size: 7.5px; color: var(--mid); margin-top: 3px; }

  /* ---------- SIGNATURE DECLARATION ----------
     The attestation the signer signs against, printed as PART of the signature
     section (see signatures() in blocks.ts). The WRAPPER owns the break rule:
     the paragraph and the rules beneath it are one legal unit and may never
     land on different pages. The section opens with the same mid rule the
     sign-lines close with, so the zone reads as one framed device.

     INK, not --mid: a declaration is content the signer attests to, not a
     caveat — it must survive a photocopy the way the signatures must.

     The Arabic paragraph takes its own size: the Latin 8px prose body sits
     below the 8.4px Arabic legibility floor (the typography law above), and an
     attestation is the last text on the sheet that may go sub-legible. No
     letter-spacing anywhere near it, per the same law. The title is a .lbl and
     gets the Arabic label system for free; the top rule already frames the
     block, so it takes no second rule of its own. */
  .sign-sec { break-inside: avoid; margin-top: 26px; }
  .sign-sec .signs { margin-top: 0; }
  .sign-declare { border-top: var(--rule-mid) solid var(--ink); padding-top: 8px; }
  .sign-declare .lbl { margin-bottom: 5px; color: var(--ink); }
  .sign-declare p { margin: 0; font-size: 8px; line-height: 1.75; color: var(--ink); }
  html[lang="ar"] .sign-declare p { font-size: 9.4px; line-height: 1.8; }

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
  /**
   * The single-sheet scale: tighter spacing and a smaller title, same type
   * sizes. For a document meant to be held rather than read at a desk. See THE
   * COMPACT VARIANT in ATLAS_CSS for what it does and, more importantly, what
   * it refuses to do.
   */
  compact?: boolean;
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
<body${opts.compact ? ` class="compact"` : ""}>
${opts.body}
</body>
</html>`;
}
