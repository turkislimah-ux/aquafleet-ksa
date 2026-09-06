// PLAIN A4 CUSTOMER STATEMENT — the downloadable document.
//
// Renders lib/statementViewModel.ts's StatementVm into the shared plain-
// document shell (lib/plainDocStyles.ts). This is the surface that kit was
// built for: see the note in lib/i18n.ts's `trips.statement` block, written
// when the kit was extracted — "The statement is ALSO the next surface to
// inherit lib/plainDocStyles.ts, which is why that kit is a shared module
// rather than part of the invoice template."
//
// LOOK ONLY. Every string, every column, every figure and every row order
// arrives already decided by the view-model. This file picks type sizes, rules
// and spacing; it must never choose a word, drop a column, or touch a number
// beyond formatting it for the medium (`num2`, 2 decimals — the same decision
// the invoice download and print sheet make, from the same primitive).
//
// A STATEMENT IS NOT A TAX INVOICE — no ZATCA fields, no QR block, no seller
// VAT/CR number, no invoice number. The on-screen statement carries none of
// those, so neither does this. The kit's `.qrbox` rules go deliberately unused.
//
// MULTI-PAGE IS THE NORMAL CASE, not an edge case — a statement runs to
// hundreds of rows. Three things carry that, all inherited from the kit rather
// than restated here: `thead { display: table-header-group }` repeats the
// column heads on every page, `tbody tr { break-inside: avoid }` stops a row
// being sliced through its own text, and `@page { margin }` lets content flow
// instead of clipping to a fixed sheet box. The header block below adds
// `break-inside: avoid` for the same reason.
//
// SERVER-OR-BROWSER: pure string building, no fs and no `process`. Unlike
// lib/invoicePdfTemplate.ts it inlines no fonts, because it does not need to —
// it goes to the same PDFShift renderer, which fetches the same self-hosted
// /fonts/*.woff2 the kit references.

import { bl, DASH, esc, num2 } from "./docPrimitives";
import { fill } from "./i18n";
import { plainDocShell } from "./plainDocStyles";
import type { BiLabel, StatementCell, StatementColumn, StatementRow, StatementVm } from "./statementViewModel";

// A bilingual label whose two halves may legitimately be the SAME string.
// `trips.statement.vatSplit` is exactly that — Turki's Batch 9 ruling keeps
// "VAT" Latin in Arabic, so both columns read "{net} + VAT {vat}" and `bl()`
// would print the identical line twice under every debit. Comparing rather
// than hardcoding `.en` means the day the dictionary diverges, this starts
// rendering both halves on its own instead of silently dropping the Arabic.
function blOnce(l: BiLabel): string {
  return l.en === l.ar ? esc(l.en) : bl(l);
}

// ---------------------------------------------------------------------------
// Document-specific rules
// ---------------------------------------------------------------------------
// Per plainDocShell's contract: `extraCss` is for a rule the kit cannot own —
// a column width, a one-off block. If a second document ever needs the same
// rule, it belongs in PLAIN_DOC_CSS instead.
//
// NO BACKTICKS BELOW, INCLUDING INSIDE THE CSS COMMENTS. This is a template
// literal, so a backtick quoting a selector the way the prose above quotes one
// CLOSES the string. What follows is then parsed as TypeScript, and the errors
// land on whatever CSS word comes next — "Cannot find name 'table'", "Property
// 'accent' does not exist" — pointing at the line AFTER the real fault, in a
// file whose CSS is otherwise valid. Cost two debugging passes on this feature
// alone. Quote selectors bare: .stmt-table, not the backticked form.
const STATEMENT_CSS = `
  /* ---------- header: customer data, with the figure beside it ----------
     A two-column band rather than a stack, so the reader's eye lands on WHO
     and HOW MUCH in one movement. The figure is the reason the document is
     opened; it does not belong at the bottom of page nine. */
  .stmt-head { display: flex; gap: 6mm; align-items: stretch; margin-top: 4mm;
               break-inside: avoid; }
  /* Rounded rather than sharp (Turki). 3px, not a pill: at this box size a
     larger radius starts reading as a UI card on a page that is deliberately
     not a UI. Both boxes take the SAME radius — two different corner treatments
     side by side is the thing that would actually look unconsidered. */
  .stmt-who { flex: 1; border: 1px solid var(--rule); border-radius: 3px;
              padding: 7px 9px; min-width: 0; }
  .stmt-who .cust { font-size: 13px; font-weight: 700; line-height: 1.25; }
  .stmt-who .meta { margin-top: 3px; font-size: 9.2px; color: var(--ink-soft); }
  .stmt-who .meta .sep { color: var(--ink-faint); margin: 0 5px; }
  .stmt-who .meta .ar { font-size: 11px; font-weight: 500; }

  /* THE PERIOD FIELD — replaced the sample-ref line in this same slot. A
     hairline above it separates a fact about the DOCUMENT from the facts about
     the CUSTOMER above, without spending a second box on it. The dates are
     tabular and isolated so an RTL run cannot reorder "from → to". */
  .stmt-who .period { margin-top: 5px; padding-top: 4px;
                      border-top: 1px solid var(--rule-faint); }
  .stmt-who .period .lab { font-size: 7px; letter-spacing: .12em; text-transform: uppercase;
                           font-weight: 700; color: var(--ink-faint); }
  .stmt-who .period .lab .ar { letter-spacing: 0; text-transform: none; font-size: 10px;
                               font-weight: 500; margin-left: 5px; color: var(--ink-soft); }
  /* EACH KEY SITS ON TOP OF ITS OWN DATE (Turki). This was one inline run —
     From / من / date / arrow / To / إلى / date — seven items on a single 10px
     line, two of them right-to-left. Every piece was individually legible and
     the line as a whole was not: nothing told the eye which key owned which
     date except reading order, and reading order is exactly what a mixed-
     direction run makes ambiguous. Stacking binds them by POSITION, which
     survives any bidi reordering, and the two columns then read at a glance.
     flex-end so the dates share one optical baseline with the arrow between
     them; the keys hang above, ragged-top, which is correct — they are
     annotations on the dates, not a row of their own. */
  .stmt-who .period .val { margin-top: 3px; font-variant-numeric: tabular-nums; }
  .stmt-who .period .val.range { display: flex; align-items: flex-end; gap: 8px; }
  .stmt-who .period .val .seg { display: flex; flex-direction: column; }
  /* HIERARCHY IS CARRIED BY WEIGHT AND COLOUR, NOT BY SIZE — which is what
     lets the Arabic keep the size the legibility pass gave it. The Arabic key
     is 9.5px against an 11px date and would compete on size alone, so it is
     held at weight 500 in ink-faint while the date is 700 in full ink. Sizing
     the Arabic DOWN to restore the hierarchy would have undone the fix. */
  /* .pk, NOT .k — THE KIT ALREADY OWNS .k. lib/plainDocStyles.ts declares a
     bare .k rule and, worse, .k .ar with display:block, for the invoice's
     field grid, where a narrow key column does want its Arabic underneath.
     This field does not: the key belongs on ONE line above its date, and
     inheriting that display:block silently made it two, turning each column
     into a three-line stack and pulling the arrow off the dates' baseline.
     Nothing here declared display at all, so the kit's rule won on a property
     this file never mentioned. Renaming is the fix rather than out-specifying —
     a statement-only element has no business answering to a kit selector. */
  .stmt-who .period .val .seg .pk { display: block; font-size: 7px;
                                    letter-spacing: .1em; text-transform: uppercase;
                                    font-weight: 700; color: var(--ink-faint);
                                    line-height: 1.45; }
  .stmt-who .period .val .seg .d { font-size: 11px; font-weight: 700;
                                   line-height: 1.25; unicode-bidi: isolate; }
  .stmt-who .period .val .arrow { color: var(--ink-faint); font-size: 10px;
                                  line-height: 1.25; padding-bottom: 1px; }
  .stmt-who .period .val .ar { font-size: 11px; font-weight: 500; }
  /* THE KEY'S ARABIC, held at 9.5px. The rule above is a DESCENDANT selector,
     so it also catches the .ar inside .pk; left alone it renders "من" at 11px,
     the same size as the date it labels. 9.5px still clears the 7px Latin
     beside it — Noto Sans Arabic has no capitals to borrow presence from,
     which is the whole basis for the legibility bump — while the weight-500
     and ink-faint above keep it subordinate to the date. Declared after the
     .val .ar rule, and one class more specific, so it wins. The inline display
     is stated rather than assumed — that is the exact property the kit's .k
     rule set behind our back, and the .pk rename only removes that if the
     intent is written down where the next reader will look. */
  .stmt-who .period .val .pk .ar { display: inline; font-size: 9.5px;
                                   letter-spacing: 0; text-transform: none;
                                   font-weight: 500; margin-left: 4px; }

  /* THE FIGURE. Boxed in solid ink so it reads as the document's conclusion
     rather than another field. Its width is fixed so a long customer name
     cannot squeeze it, and dir="ltr" on the number keeps the digits and the
     minus sign in Latin order whatever language surrounds them. */
  .stmt-fig { flex: 0 0 56mm; border: 1.5px solid var(--ink); border-radius: 3px;
              padding: 7px 9px;
              display: flex; flex-direction: column; justify-content: center; }
  .stmt-fig .lab { font-size: 7px; letter-spacing: .12em; text-transform: uppercase;
                   font-weight: 700; color: var(--ink-faint); line-height: 1.3; }
  /* The label naming the document's single most important number. Arabic at
     10.5/500 against a 7px uppercase Latin micro-label: Noto Sans Arabic has no
     capitals to borrow presence from, so matching the Latin's SIZE would leave
     it materially less legible than the line it translates. */
  .stmt-fig .lab .ar { display: block; letter-spacing: 0; text-transform: none;
                       font-size: 10.5px; font-weight: 500; line-height: 1.55;
                       color: var(--ink-soft); }
  .stmt-fig .amt { margin-top: 4px; font-size: 19px; font-weight: 700; line-height: 1.1;
                   font-variant-numeric: tabular-nums; letter-spacing: -.015em;
                   unicode-bidi: isolate; }
  .stmt-fig .amt .cur { font-size: 10px; font-weight: 400; color: var(--ink-soft);
                        margin-left: 5px; letter-spacing: .04em; }

  /* ---------- the caption ----------
     The period STRIP that used to sit here is gone: the period is a header
     field now, and printing it twice would be the document contradicting its
     own layout about which one is authoritative. */
  .stmt-sub { margin-top: 3mm; font-size: 8.8px; color: var(--ink-soft); }
  .stmt-sub .ar { display: block; font-size: 11px; font-weight: 500;
                  line-height: 1.6; color: var(--ink-soft); }

  /* ---------- the divider ----------
     ONE line (Turki). The kit's masthead rule is .accent (3px) followed by
     .accent-thin (1px) — a heavy double band built for a tax invoice's
     letterhead. A statement is a running record, not a letterhead, so it takes
     a single hairline instead. The kit is UNCHANGED: lib/invoicePrintTemplate.ts
     shares it and still wants the double band. */
  .stmt-rule { height: 1px; background: var(--ink); margin-top: 5px; }

  /* ---------- the table ----------
     ONE table, every column present (Turki's direction). Widths are declared
     rather than left to the auto layout: eight columns of mixed text and
     figures otherwise collapse the Note column to nothing on a page that
     happens to hold one long truck plate. */
  .stmt-table { margin-top: 4mm; }
  .stmt-table thead th { padding-top: 0; }
  .stmt-table td.type { font-weight: 700; }

  /* ---------- Arabic legibility (Turki) ----------
     WORDING IS UNCHANGED — every string still comes from lib/i18n.ts through
     the view-model. This is rendering only.
     Scoped to .stmt-table DELIBERATELY. These same selectors live in the
     shared kit, where lib/invoicePrintTemplate.ts depends on them; bumping them
     there would silently restyle a ZATCA tax document that nobody is verifying
     in this pass. If the invoice wants the same treatment it should be asked
     for and checked on its own.
     Column heads are the worst offender on the page: the kit sets them at 9px
     against 7px uppercase Latin, and they are the one line a reader cannot
     afford to guess at, since a wrong guess mislabels a money column. */
  .stmt-table thead th .ar { font-size: 10.5px; font-weight: 500; line-height: 1.55;
                             color: var(--ink-soft); }
  /* Body-cell Arabic (Type, Note) sat at the Latin's own 9.6px at weight 400,
     which renders visibly lighter at Arabic's smaller x-height. */
  .stmt-table tbody td .ar { font-size: 10.6px; font-weight: 500; }
  .stmt-table tbody tr.empty td .ar { font-size: 10.4px; font-weight: 500; }
  /* The faded pre-VAT/VAT sub-line under a debit — the same breakdown the
     screen shows beneath the bold figure, in the same place. */
  .stmt-table .split { display: block; font-size: 7.8px; font-weight: 400;
                       color: var(--ink-faint); margin-top: 1px;
                       font-variant-numeric: tabular-nums; unicode-bidi: isolate; }
  .stmt-table td.amt { font-weight: 700; }
  /* A settlement RECORDS rather than moves money. On screen that is carried by
     a green tint; this document is monochrome, so it is carried by a rule and
     italic ink instead — visible without colour, and it changes no figure. */
  .stmt-table tr.settlement td { font-style: italic; color: var(--ink-soft); }
  .stmt-table tr.settlement td.dt { font-style: normal; }
`;

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

// Renders ONE cell. The view-model has already decided what the cell IS; this
// decides only how it looks on paper.
//
// A `tripRef` prints as plain text — the screen's TripRefLink is a navigation
// affordance, and a link to an internal route is meaningless in a file that
// leaves the building. Its VALUE is unchanged, which is what parity is about,
// and the view-model has already run it through formatTripRef, so the "No ref"
// fallback reads the same here as on screen.
function cellHtml(cell: StatementCell, splitTpl: BiLabel): string {
  switch (cell.kind) {
    case "empty":
      return `<span class="muted">${DASH}</span>`;
    case "date":
      return esc(cell.value);
    case "text":
      return esc(cell.value);
    case "bi":
      return bl(cell.value);
    case "tripRef":
      return esc(cell.value);
    case "num": {
      // The sign IS the row's meaning — a credit, a debit, or neither. Rendered
      // with the SAME characters the screen uses: an ASCII "+" and a real
      // MINUS SIGN (U+2212), never a hyphen.
      const sign = cell.sign === "plus" ? "+" : cell.sign === "minus" ? "−" : "";
      const main = `${sign}${num2(cell.value)}`;
      // The connector is the dictionary's, never this file's — same string the
      // screen fills. Only the two NUMBERS are formatted for this medium.
      const split = cell.split
        ? `<span class="split">${blOnce({
            en: fill(splitTpl.en, { net: num2(cell.split.net), vat: num2(cell.split.vat) }),
            ar: fill(splitTpl.ar, { net: num2(cell.split.net), vat: num2(cell.split.vat) }),
          })}</span>`
        : "";
      return `<span dir="ltr">${main}</span>${split}`;
    }
  }
}

function rowHtml(row: StatementRow, columns: StatementColumn[], splitTpl: BiLabel): string {
  const tds = row.cells
    .map((cell, i) => {
      const col = columns[i];
      const classes: string[] = [];
      if (col.align === "end") classes.push("num");
      if (col.key === "date") classes.push("dt");
      if (col.key === "type") classes.push("type");
      if (col.key === "amount") classes.push("amt");
      const cls = classes.length > 0 ? ` class="${classes.join(" ")}"` : "";
      return `<td${cls}>${cellHtml(cell, splitTpl)}</td>`;
    })
    .join("");
  return `<tr class="${esc(row.kind)}">${tds}</tr>`;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/**
 * Builds the complete statement HTML from the shared view-model.
 *
 * Takes the VM, not the raw inputs, deliberately: the renderer must not be able
 * to reach the ledger engine at all. That is what makes "the document mirrors
 * the screen" structural — there is no second path to a number here.
 */
export function buildStatementHtml(vm: StatementVm): string {
  const colgroup = `<colgroup>${vm.columns
    .map((c) => `<col class="col-${esc(c.key)}" />`)
    .join("")}</colgroup>`;

  const thead = `<thead><tr>${vm.columns
    .map((c) => `<th${c.align === "end" ? ' class="num"' : ""}>${bl(c.label)}</th>`)
    .join("")}</tr></thead>`;

  // The empty state is a row INSIDE the table rather than a card replacing it,
  // so the column heads stay visible. A reader of a paper statement cannot
  // click anything to find out what they were looking at.
  const tbody =
    vm.rows.length > 0
      ? `<tbody>${vm.rows.map((r) => rowHtml(r, vm.columns, vm.vatSplitTemplate)).join("")}</tbody>`
      : `<tbody><tr class="empty"><td colspan="${vm.columns.length}">${
          vm.emptyLabel ? bl(vm.emptyLabel) : ""
        }</td></tr></tbody>`;

  // THE PERIOD FIELD. Only the picker's own two values — nothing is computed
  // here, and an unfiltered statement says "All-time" in words rather than
  // printing two blanks or an open-ended range the reader has to interpret.
  //
  // Each date is labelled ("From" / "To") instead of relying on the arrow
  // alone: on a bilingual page the surrounding text can run right-to-left, and
  // a bare `A → B` then has to be read against the paragraph direction to know
  // which end is the start. The label sits ON TOP of its own date (Turki), so
  // the pairing is carried by position rather than by reading order — see the
  // .stmt-who .period .val rules.
  //
  // THE WHOLE .val ELEMENT IS BUILT HERE, not just its contents, because the
  // two branches want different layouts: a range is a two-column flex row, an
  // unfiltered statement is one word. Emitting a single .val and varying only
  // the inside would force the flex rules onto the "All-time" case, which then
  // breaks its own Arabic onto a second flex item.
  const seg = (label: BiLabel, date: string | null) =>
    `<span class="seg"><span class="pk">${bl(label)}</span>` +
    `<span class="d">${esc(date ?? DASH)}</span></span>`;

  const periodValue =
    vm.periodFrom || vm.periodTo
      ? `<div class="val range" dir="ltr">${seg(vm.fromLabel, vm.periodFrom)}` +
        `<span class="arrow">→</span>${seg(vm.toLabel, vm.periodTo)}</div>`
      : `<div class="val">${bl(vm.allTimeLabel)}</div>`;

  const metaBits = [
    vm.projectName ? esc(vm.projectName) : null,
    bl(vm.modeLabel),
  ].filter((s): s is string => s !== null);

  const body = `
<div class="masthead">
  <div class="wordmark">${bl(vm.title)}</div>
</div>
<div class="stmt-rule"></div>

<div class="stmt-head">
  <div class="stmt-who">
    <div class="cust">${esc(vm.customerName)}</div>
    <div class="meta">${metaBits.join('<span class="sep">·</span>')}</div>
    <div class="period">
      <div class="lab">${bl(vm.periodLabel)}</div>
      ${periodValue}
    </div>
  </div>
  <div class="stmt-fig">
    <div class="lab">${bl(vm.headline.label)}</div>
    <div class="amt" dir="ltr">${num2(vm.headline.value)}<span class="cur">${esc(vm.currency.en)}</span></div>
  </div>
</div>

<div class="stmt-sub">${bl(vm.subtitle, "ar block")}</div>

<div class="stmt-table">
  <table>
    ${colgroup}
    ${thead}
    ${tbody}
  </table>
</div>`;

  return plainDocShell({
    // The tab/print title, not a rendered heading — English only, because a
    // filename-shaped string is not a place for a bidirectional run.
    title: `${vm.title.en} — ${vm.customerName}`,
    body,
    extraCss: STATEMENT_CSS,
  });
}
