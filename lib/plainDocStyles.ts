// PLAIN DOCUMENT KIT — the shared chrome for Bousla's black-and-white
// printables (Concept 3 - Panel).
//
// WHY THIS IS A KIT AND NOT A TEMPLATE
// ------------------------------------
// The invoice is the first plain document; the customer STATEMENT is the
// second. Everything in this file is the part they share — page geometry,
// type scale, the boxed header cards, the table rules, the pills, the panel,
// the Arabic typography law — so the statement inherits a look rather than
// re-deriving one. Nothing invoice-specific belongs here; that lives in
// lib/invoicePrintTemplate.ts.
//
// NO COLOUR, BY CONSTRUCTION
// --------------------------
// Every value below is ink or a grey. The reference mockup carried exactly one
// colour — a #0B7EEA accent bar — and it is set in INK here: this document is
// specified to survive a fax, a mono laser and a photocopier, and a document
// that is "mono-safe except for one bar" is not mono-safe. Hierarchy is carried
// by SIZE, WEIGHT, RULE THICKNESS and CASE only. If a future edit reaches for a
// hue to distinguish two things, the distinction is not yet designed.
//
// Solid-vs-dashed is the one categorical device: a solid ink fill means the
// thing HAPPENED (covered, paid), a dashed outline means it did not (rolls
// forward, unsettled). Both survive greyscale because neither depends on hue.
//
// FONTS BY URL, NOT BASE64. lib/invoicePdfTemplate.ts inlines its faces with
// readFileSync because PDFShift fetches that HTML as a standalone document with
// no origin to resolve against. This document is printed by the user's own
// browser from a same-origin iframe, so it can reference /public — which keeps
// the payload ~290KB smaller per print and lets the browser cache the faces
// across prints. It also keeps this module PURE (no fs, no process), so unlike
// the PDF template it could render client-side if that is ever wanted.

/**
 * @font-face block for the plain documents. Same two families as the download —
 * a print sheet and its PDF must not shape Arabic differently — referenced by
 * root-relative URL. Root-relative resolves correctly inside a `srcdoc` iframe:
 * such a document inherits the parent's base URL.
 */
export function plainFontFaceCss(): string {
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
      font-family: 'Noto Sans Arabic';
      font-style: normal;
      font-weight: 400;
      font-display: block;
      src: url('/fonts/NotoSansArabic-Regular.woff2') format('woff2');
      unicode-range: U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200E;
    }
    @font-face {
      font-family: 'Noto Sans Arabic';
      font-style: normal;
      font-weight: 700;
      font-display: block;
      src: url('/fonts/NotoSansArabic-Bold.woff2') format('woff2');
      unicode-range: U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200E;
    }
  `;
}

/**
 * The plain document stylesheet.
 *
 * NOTE FOR ANYONE EDITING THE COMMENTS BELOW: this stylesheet lives inside a
 * TEMPLATE LITERAL. A backtick here ends the string, and the failure is a parse
 * error somewhere else entirely with no mention of CSS. Plain quotes only.
 */
export const PLAIN_DOC_CSS = `
  /* A4 with real page margins rather than a fixed-height sheet box. A fixed
     sheet clips its own overflow, which on a real invoice means silently
     dropping billed trips off the bottom. Margins let content flow and
     paginate; nothing is ever cut. */
  @page { size: A4; margin: 15mm 14mm; }
  * { box-sizing: border-box; }

  /* ---------- ARABIC TYPOGRAPHY LAW ----------
     ARABIC IS SET LARGER THAN THE LATIN IT SITS BESIDE. That is not a mistake
     to tidy up to matching numbers — it is what equal legibility costs.

     Latin capitals stay readable when tiny because their shapes are distinct
     outlines. Arabic is not: the letters beh/teh/theh/noon/yeh share one body
     and differ ONLY in the number and position of their dots. Shrink the text
     and the dots close up, and the reader is no longer reading letters, they
     are guessing words.

     Expressed as EM so one number governs the whole sheet and the relationship
     cannot drift per-rule. Absolute px appears below ONLY to hold a floor under
     Arabic whose Latin parent is a micro-label — there, matching the parent
     would be illegible at any weight. NOTHING renders below 8.4px.

     This law is carried over from the download deliberately. The two documents
     say the same words; they must not disagree about whether Arabic is
     readable. */
  :root {
    --ar-inline: 1.12;  /* shares a baseline with Latin — restrained, or the line jumps */
    --ar-block: 1.22;   /* owns its own line — free to take the full step up */

    /* Ink and greys. There is no hue in this file. */
    --ink: #0d1526;
    --ink-soft: #334155;
    --ink-faint: #64748b;
    --rule: #cbd5e1;
    --rule-mid: #e2e8f0;
    --rule-faint: #eef2f7;
  }

  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: 'Inter', 'Noto Sans Arabic', system-ui, sans-serif;
    font-size: 10.5px; line-height: 1.45; color: var(--ink);
    -webkit-font-smoothing: antialiased;
    /* The solid pills and the accent rule are INK, not decoration — a print
       engine that drops backgrounds turns a Covered pill into an empty
       outline, i.e. into the OTHER state. */
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  /* ---------- masthead ---------- */
  .masthead { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm;
              break-inside: avoid; }
  .wordmark { font-size: 15px; font-weight: 700; letter-spacing: -.01em; line-height: 1.2; }
  /* The seller's Arabic legal name — an identity field on a tax document, not
     a caption under the English one. */
  .wordmark .ar { display: block; font-size: 12px; line-height: 1.5; font-weight: 400; }
  .wordmark small { display: block; font-size: 8.4px; font-weight: 400; letter-spacing: .14em;
                    text-transform: uppercase; color: var(--ink-faint); margin-top: 2px; }
  .doctype { text-align: right; flex: 0 0 auto; }
  .doctype .t-en { font-size: 15px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
  /* The Arabic document title carries the same legal weight as the English.
     Near-parity, not a subtitle. */
  .doctype .t-ar { font-size: 13.5px; line-height: 1.4; }
  .doctype .no { margin-top: 3px; font-size: 7px; letter-spacing: .13em; text-transform: uppercase;
                 color: var(--ink-faint); }
  .doctype .no .ar { letter-spacing: 0; text-transform: none; font-size: 9px; }
  .doctype .no b { display: block; font-size: 14px; letter-spacing: .02em; color: var(--ink);
                   font-variant-numeric: tabular-nums; }

  /* The reference's one coloured element, set in ink. Two weights of the same
     line: the thick one closes the masthead, the hairline opens the body. */
  .accent { height: 3px; background: var(--ink); margin-top: 5px; }
  .accent-thin { height: 1px; background: var(--ink); margin-top: 1.5px; }

  /* ---------- meta strip ---------- */
  /* One bordered band of labelled cells, divided by hairlines. Same four facts
     in the same order as the download's header strip. */
  .metastrip { display: flex; border: 1px solid var(--rule); margin-top: 4mm; break-inside: avoid; }
  .metastrip .cell { flex: 1; padding: 5px 8px; min-width: 0; }
  .metastrip .cell + .cell { border-left: 1px solid var(--rule); }

  /* ---------- key / value ---------- */
  .k { font-size: 7px; letter-spacing: .13em; text-transform: uppercase; color: var(--ink-faint);
       font-weight: 700; }
  /* Parent is a 7px uppercase micro-label — an em-scale off that is unreadable,
     so these take an absolute floor instead. */
  .k .ar { display: block; letter-spacing: 0; text-transform: none; font-size: 9px; line-height: 1.5;
           font-weight: 400; }
  .v { font-size: 10.5px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 1px; }
  .v .ar { display: block; font-weight: 400; font-size: 9.6px; line-height: 1.55; color: var(--ink-soft); }

  /* ---------- boxed cards ---------- */
  .cards { display: flex; gap: 5mm; margin-top: 4mm; align-items: stretch; break-inside: avoid; }
  .card { flex: 1; border: 1px solid var(--rule); padding: 6px 8px; min-width: 0; }
  .card.wide { flex: 1.25; }
  .card h3 { margin: 0 0 4px; padding-bottom: 3px; border-bottom: 1px solid var(--rule-mid);
             font-size: 7.5px; letter-spacing: .15em; text-transform: uppercase; font-weight: 700;
             display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
  .card h3 .ar { letter-spacing: 0; text-transform: none; font-size: 9px; font-weight: 400;
                 color: var(--ink-faint); }
  .nm { font-size: 11px; font-weight: 700; line-height: 1.25; }
  /* Reads as a co-equal name, not a gloss. */
  .nm-ar { font-size: 10.6px; line-height: 1.5; }
  .desc { font-size: 8.4px; color: var(--ink-faint); margin-bottom: 2px; }
  dl { margin: 3px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 1px 8px; }
  dt { font-size: 7.2px; color: var(--ink-faint); white-space: nowrap; padding-top: 1.5px; }
  dt .ar { font-size: 8.8px; }
  dd { margin: 0; font-size: 9.2px; font-variant-numeric: tabular-nums; }

  /* ---------- status chip ---------- */
  .chip { display: inline-flex; align-items: baseline; gap: 4px; border: 1px solid var(--ink);
          padding: 1px 8px; font-size: 8.5px; font-weight: 700; letter-spacing: .06em;
          text-transform: uppercase; margin-top: 2px; }
  .chip .ar { font-size: 9.4px; font-weight: 400; text-transform: none; letter-spacing: 0; }

  /* ---------- QR ---------- */
  /* NOT the ZATCA cryptographic QR — see the payload comment in
     lib/invoicePrintTemplate.ts. The slot is the reference's reserved 30mm box. */
  .qrbox { flex: 0 0 34mm; border: 1px solid var(--rule); padding: 6px; text-align: center;
           display: flex; flex-direction: column; justify-content: center; }
  .qr { width: 30mm; height: 30mm; margin: 0 auto; border: 1px dashed #94a3b8; padding: 1.5mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .qrcap { font-size: 6.8px; color: var(--ink-faint); margin-top: 4px; letter-spacing: .06em;
           text-transform: uppercase; }
  .qrcap .ar { display: block; letter-spacing: 0; text-transform: none; font-size: 8.8px;
               line-height: 1.5; }

  /* ---------- notice ---------- */
  /* Solid frame for a good outcome, dashed for a reversal — the same
     solid/dashed grammar as the pills, so the two never need a hue. */
  .notice { margin-top: 4mm; padding: 5px 8px; font-size: 8.6px; display: flex; gap: 6px;
            align-items: center; flex-wrap: wrap; break-inside: avoid; border: 1px solid var(--ink); }
  .notice.bad { border-style: dashed; }
  .notice .tag { font-size: 7px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
                 padding: 2px 7px; white-space: nowrap; background: var(--ink); color: #fff; }
  .notice.bad .tag { background: #fff; color: var(--ink); border: 1px solid var(--ink); }
  .notice .tag .ar { letter-spacing: 0; text-transform: none; font-size: 8.8px; font-weight: 400;
                     margin-left: 3px; color: inherit; }
  .notice .ar { margin-left: 4px; }
  .notice .note-extra { flex: 1 0 100%; font-size: 8px; color: var(--ink-soft); }

  /* ---------- sections + tables ---------- */
  .sec { margin-top: 5mm; }
  .sec > h2 { margin: 0 0 3px; font-size: 7.5px; letter-spacing: .15em; text-transform: uppercase;
              font-weight: 700; display: flex; justify-content: space-between; align-items: baseline; }
  .sec > h2 .ar { font-size: 9.6px; font-weight: 400; letter-spacing: 0; text-transform: none;
                  color: var(--ink-faint); }
  table { width: 100%; border-collapse: collapse; }
  /* Repeats the column header on every page a long table spills onto — this is
     the running header a multi-page invoice actually needs. */
  thead { display: table-header-group; }
  tfoot { display: table-row-group; }
  thead th { font-size: 7px; letter-spacing: .11em; text-transform: uppercase; color: var(--ink-faint);
             font-weight: 700; text-align: left; padding: 4px 4px 3px;
             border-bottom: 1.5px solid var(--ink); }
  /* Column headers are read once and then relied on for the whole table — the
     one place a reader cannot afford to guess which word they are looking at. */
  thead th .ar { display: block; letter-spacing: 0; text-transform: none; font-size: 9px;
                 line-height: 1.5; font-weight: 400; }
  thead th .cur-tag { letter-spacing: 0; }
  tbody td { padding: 3px 4px; border-bottom: 1px solid var(--rule-faint); vertical-align: top;
             font-size: 9.6px; }
  /* A row is the atom: it may move to the next page but must never be sliced
     through the middle of its own text. */
  tbody tr, tfoot tr { break-inside: avoid; }
  tbody tr.empty td { text-align: center; padding: 7px 4px; font-size: 9px; color: var(--ink-faint); }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .dt { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .desc-main { font-weight: 700; }
  .muted { color: var(--ink-faint); }
  .ar.inline { margin-left: 4px; font-weight: 400; }

  /* THE HEAVY RULE. The first footer row is where the itemised list stops
     being a list and becomes a figure — carried by rule WEIGHT, since the
     reference's tint is unavailable to a mono document. */
  tfoot td { padding: 3px 4px; font-size: 9.6px; }
  tfoot tr.first td { border-top: 1.5px solid var(--ink); }
  tfoot .lbl { text-align: right; font-weight: 700; }
  tfoot .split { font-weight: 400; color: var(--ink-faint); font-size: 8.4px; margin-left: 6px; }
  tfoot tr.grand td { border-top: 1px solid var(--rule); font-weight: 700; font-size: 11.5px; }

  /* ---------- pills ---------- */
  .pill { display: inline-block; font-size: 7.2px; letter-spacing: .08em; text-transform: uppercase;
          padding: 2px 8px; font-weight: 700; white-space: nowrap; }
  /* Pills are tight by design, so this is the tightest Arabic on the sheet.
     8.4px is the floor — the rolls-forward word carries a shadda and a damma,
     and below this they merge into the letter and it stops being a word. */
  .pill .ar { letter-spacing: 0; text-transform: none; font-size: 8.4px; font-weight: 400;
              color: inherit; }
  .pill.on { background: var(--ink); color: #fff; }
  .pill.off { border: 1px dashed var(--ink-faint); color: var(--ink-soft); }

  /* ---------- settlement ---------- */
  .settle { display: flex; gap: 5mm; margin-top: 5mm; align-items: stretch; break-inside: avoid; }
  .note { flex: 1; border: 1px solid var(--rule); padding: 6px 8px; font-size: 8.6px;
          color: var(--ink-soft); min-width: 0; }
  .note h4 { margin: 0 0 3px; padding-bottom: 3px; border-bottom: 1px solid var(--rule-mid);
             font-size: 7.5px; letter-spacing: .15em; text-transform: uppercase; color: var(--ink); }
  .note h4 .ar { letter-spacing: 0; text-transform: none; font-size: 9px; font-weight: 400;
                 color: var(--ink-faint); margin-left: 4px; }
  .note p { margin: 0 0 5px; }
  .note p:last-child { margin: 0; }
  /* A full Arabic SENTENCE gets its own line, not a trailing inline run — a
     paragraph-length RTL string appended to an LTR one is unreadable however
     well the bidi isolates behave. This is the one run a reader reads THROUGH
     rather than glances at, so it takes the biggest relative step and full ink. */
  .note .ar.block { display: block; margin-top: 3px; color: var(--ink); }

  /* THE THICK LEFT EDGE. The document's one weighted element, and it points at
     the figure the customer acts on. */
  .panel { flex: 0 0 78mm; border: 1px solid var(--rule); border-left: 5px solid var(--ink);
           padding: 9px 11px; }
  .panel .r0 { display: flex; justify-content: space-between; gap: 8px; font-size: 8.8px;
               padding: 1.5px 0; color: var(--ink-soft); }
  .panel .r0 b { font-variant-numeric: tabular-nums; color: var(--ink); font-weight: 700;
                 white-space: nowrap; }
  .panel .sep { border-top: 1px solid var(--ink); margin: 5px 0 6px; }
  .panel .lab { font-size: 7.4px; letter-spacing: .16em; text-transform: uppercase; font-weight: 700;
                color: var(--ink-faint); }
  .panel .lab .ar { float: right; letter-spacing: 0; text-transform: none; font-size: 9.8px;
                    font-weight: 400; }
  .panel .amt { font-size: 24px; font-weight: 700; letter-spacing: -.02em; line-height: 1.15;
                margin-top: 1px; font-variant-numeric: tabular-nums; }
  .panel .amt .cur { font-size: 10.5px; font-weight: 400; color: var(--ink-faint); margin-left: 4px;
                     letter-spacing: .04em; }

  /* ---------- transfer details ---------- */
  /* Full width, BELOW the settlement row. This is the last thing the reader
     needs and the first thing they act on, so it sits where the eye lands after
     the Amount Due figure rather than competing with it alongside. */
  .bank { margin-top: 4mm; border: 1px solid var(--rule); padding: 6px 8px 7px; break-inside: avoid; }
  .bank h4 { margin: 0 0 5px; padding-bottom: 3px; border-bottom: 1px solid var(--rule-mid);
             font-size: 7.5px; letter-spacing: .15em; text-transform: uppercase; }
  .bank h4 .ar { letter-spacing: 0; text-transform: none; font-size: 9px; font-weight: 400;
                 color: var(--ink-faint); margin-left: 4px; }
  /* COLUMNS, not a stack. Three stacked accounts is six lines of vertical space
     for information the customer uses ONE of; side by side it is two lines
     whatever the count, and the hairline says these are alternatives, pick one,
     where a vertical list would read as a sequence of steps. */
  .bank .accts { display: flex; gap: 10px; align-items: flex-start; }
  .bank .acct { flex: 1 1 0; min-width: 0; }
  .bank .acct + .acct { border-left: 1px solid var(--rule); padding-left: 10px; }
  .bank .who { font-size: 8.6px; color: var(--ink-soft); line-height: 1.35; overflow-wrap: anywhere; }
  .bank .who b { color: var(--ink); font-weight: 700; }
  .bank .who .sep { color: var(--ink-faint); margin: 0 3px; }
  /* CAPTION ABOVE THE VALUE, not beside it. GEOMETRY, not taste: A4 less 14mm
     margins and this box's padding leaves ~180mm, so three columns are ~57mm
     each. A bilingual IBAN tag sitting BESIDE the number eats ~16mm of that,
     leaving ~41mm for a run that measures ~38mm — under two millimetres of
     slack, and the overflow when it loses is a wrapped IBAN, i.e. the one
     string on this page a human retypes into a banking app, broken across two
     lines. Above the number, the value gets the full column. */
  .bank .iban { margin-top: 2px; }
  .bank .iban .t { display: block; font-size: 6.6px; letter-spacing: .13em; text-transform: uppercase;
                   font-weight: 700; color: var(--ink-faint); line-height: 1.3; }
  .bank .iban .t .ar { letter-spacing: 0; text-transform: none; font-size: 8.6px; font-weight: 400;
                       margin-left: 4px; }
  /* Tabular figures so no two glyphs share a width, a hair of tracking so the
     4-groups stay separable, nowrap so it can only ever be read as ONE number,
     and its own LTR isolate so no Arabic beside it can reorder it. */
  .bank .iban .v { display: block; font-size: 8.8px; font-weight: 700; color: var(--ink);
                   font-variant-numeric: tabular-nums; letter-spacing: .035em;
                   white-space: nowrap; unicode-bidi: isolate; }

  /* ---------- footer ---------- */
  footer { margin-top: 4mm; padding-top: 3px; border-top: 1px solid var(--rule); display: flex;
           justify-content: space-between; gap: 10px; font-size: 7.2px; color: var(--ink-faint);
           break-inside: avoid; }

  /* BIDI SAFETY — every Arabic run is its own isolate, so it can never reorder
     the Latin label or number sitting next to it. Without this a "Tel <number>"
     pair renders with the digits on the wrong side. */
  .ar, .nm-ar { unicode-bidi: isolate; }

  /* The base step-up. Every rule above that sets an explicit Arabic size beats
     this on specificity by design — those are the micro-label floors. This
     catches every run that does NOT declare one, which is most of them. */
  .ar { font-size: calc(1em * var(--ar-inline)); line-height: 1.62; }
  .ar.block { font-size: calc(1em * var(--ar-block)); line-height: 1.78; }
`;

/**
 * Wraps a rendered body in the plain document shell.
 *
 * `extraCss` exists for a document that needs a rule the kit cannot own — a
 * column width, a one-off block. If a second document ever passes the SAME
 * extra rule, that rule belongs in PLAIN_DOC_CSS instead.
 */
export function plainDocShell(opts: { title: string; body: string; extraCss?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${opts.title}</title>
<style>
${plainFontFaceCss()}
${PLAIN_DOC_CSS}
${opts.extraCss ?? ""}
</style>
</head>
<body>
${opts.body}
</body>
</html>`;
}
