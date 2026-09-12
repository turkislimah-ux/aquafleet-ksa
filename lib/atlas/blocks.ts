// ATLAS BLOCKS — the page furniture every ATLAS report is assembled from.
//
// WHAT BELONGS HERE
// -----------------------------------------------------------------------------
// A block is a piece of LOOK that more than one report needs: a masthead, a
// stat strip, a ruled table, a callout. Nothing here knows what a trip is, what
// a purchase order is, or how a figure was computed. Every function takes a
// plain view-model and returns an HTML string, and the boundary is the same one
// lib/invoicePdfTemplate.ts states at its head and for the same reason:
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// That rule exists because of a real failure, not as tidiness: when a renderer
// is allowed to decide wording or re-derive a figure, an operator approves one
// document and the recipient receives another. So if a block below is tempted
// to compute a percentage, pick a label or choose a word, the view-model is
// missing a field.
//
// THE ESCAPING CONTRACT
// -----------------------------------------------------------------------------
// EVERY function here escapes what it is given. Callers pass plain text, never
// markup. The single exception is a Cell marked `raw: true`, which exists so a
// status mark or a figure that has already been through iso() can sit inside a
// table cell, and it is named on the type so no one reaches for it by accident.
//
// THE ISOLATION CONTRACT
// -----------------------------------------------------------------------------
// iso() is applied BY THIS FILE, not by callers, everywhere the shape of the
// data makes it unconditional: a column declared num, a stat value, the
// masthead figure, a callout value. Those are always figures, so they always
// need isolating, so remembering to ask for it is not a decision anyone should
// have to make correctly sixteen times. The places a caller must still opt in
// are the ones where the same slot can hold either a figure or a name, and the
// type says so.

import { esc } from "../docPrimitives";

/* ------------------------------------------------------------------ */
/* Bidi isolation                                                      */
/* ------------------------------------------------------------------ */

/**
 * Wrap the LEFT-TO-RIGHT RUNS of a value in their own isolates, one each.
 *
 * THE BUG THIS FIXES: a Latin or numeric run that starts with a digit is
 * reordered by the bidi algorithm when it sits inside an Arabic paragraph.
 * "115.00 SAR" next to an Arabic word renders with the unit on the wrong side;
 * an invoice reference like 026-000021 can have its segments swapped outright.
 *
 * That is not an edge case in this app, it is the normal case in every Arabic
 * report. Every number and date is pinned to en-US Latin digits in BOTH
 * languages (lib/utils.ts, which states explicitly that it never uses ar-SA),
 * and every identifier is normalised to Latin digits before it is stored
 * (lib/digits.ts). So an Arabic ATLAS sheet is an Arabic document in which
 * every single figure is a foreign LTR run.
 *
 * THE BUG THAT ISOLATING THE WHOLE STRING CAUSES, which is the opposite one and
 * was caught by rendering the Arabic proof sheet. An isolate does not just
 * protect its contents from the outside, it imposes a BASE DIRECTION on them.
 * Force dir=ltr onto "04 أغسطس 2026" and the three parts resolve to levels
 * 0/1/2 instead of 2/1/2, and the reader gets the day, then the YEAR, then the
 * month. The same applied to "115.00 ريال" puts the unit on the wrong side -
 * precisely the defect above, reintroduced by the thing meant to prevent it.
 * Eleven values on the Arabic sheet were wrong this way: every money value with
 * a unit, every payment date, the issue date, and a table foot label.
 *
 * So the isolate goes on the RUN, never on the string. A value that is entirely
 * LTR is one run and comes out exactly as it did before - which is why the
 * English sheet is unchanged to the byte by this, and why the English diff is a
 * real regression test for it. A value that is entirely Arabic has no LTR run
 * and gets no isolate at all, so asking for isolation on a name is now inert
 * instead of harmful. Mixed values get each figure pinned and the Arabic left
 * to the paragraph, which is the only arrangement that reads correctly.
 *
 * Belt and braces on purpose: the dir attribute carries unicode-bidi: isolate
 * through the HTML UA stylesheet, and the class restates it in ATLAS_CSS so the
 * behaviour does not depend on that.
 *
 * Whitespace between runs stays OUTSIDE the isolate. Inside, it would belong to
 * an LTR run and sit at that run's right-hand end, which is the wrong end of it
 * on an Arabic line.
 */

/**
 * Strong right-to-left scripts, as a capturing split pattern.
 *
 * THIS IS A BIDI-CLASS QUESTION WEARING A SCRIPT COSTUME. What matters is
 * whether a character is bidi class R or AL, and JavaScript has no \p{bc=AL} -
 * the property escapes it does have are Script and General_Category, neither of
 * which is the thing being asked. So the classes are approximated by block
 * range, listed rather than inferred.
 *
 * Arabic, its supplements and its presentation forms, because that is what this
 * app produces. Hebrew, Syriac and Thaana because they cost one range each, and
 * the alternative to covering them is failing SILENTLY on a string nobody
 * expected rather than loudly.
 *
 * The Arabic-Indic DIGITS inside ؀-ۿ are deliberately left IN, even
 * though a digit is not strong RTL. They are bidi class AN, which already takes
 * the Arabic direction from its surroundings, so leaving them outside an
 * isolate is the correct rendering and not an oversight. They should never
 * reach here at all - lib/utils.ts pins every figure to en-US Latin digits in
 * BOTH languages and lib/digits.ts normalises identifiers before storage - so
 * this is the behaviour for a string that already broke a rule upstream.
 *
 * ﻿ is excluded on purpose. It closes the Arabic presentation-forms block
 * numerically, but it is the byte-order mark, bidi class BN, and pulling it
 * into an RTL run would split a value on an invisible character.
 */
const RTL_RUN =
  /([֐-׿؀-ۿ܀-ݏݐ-ݿހ-޿ࢠ-ࣿיִ-﷿ﹰ-ﻼ]+)/;

const ltrRun = (t: string): string =>
  `<span class="iso" dir="ltr">${esc(t)}</span>`;

export function iso(value: string | number): string {
  const s = String(value);
  // The common case, and the ONLY case in an English document: no strong RTL
  // character anywhere, so the whole value is a single run. Same bytes this
  // function emitted before it learned to split.
  if (!RTL_RUN.test(s)) return ltrRun(s);
  return s
    .split(RTL_RUN)
    .map((part, i) => {
      if (i % 2 === 1) return esc(part); // an RTL run: never isolated
      const lead = part.length - part.trimStart().length;
      const trail = part.length - part.trimEnd().length;
      const core = part.slice(lead, part.length - trail);
      if (core === "") return esc(part); // whitespace, or the empty edges of a split
      return (
        esc(part.slice(0, lead)) +
        ltrRun(core) +
        esc(part.slice(part.length - trail))
      );
    })
    .join("");
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

/**
 * A micro-label.
 *
 * Which of the two label systems this renders in is decided by the DOCUMENT
 * LANGUAGE in ATLAS_CSS, not here and not by the caller. Latin gets tracked
 * uppercase; Arabic gets weight, size and a rule, because Arabic has no case
 * and letter-spacing breaks its joins. See the two LABELS sections at the foot
 * of ATLAS_CSS for why that substitution is forced rather than preferred.
 *
 * A caller that branched on language here would be re-deciding, per call site,
 * something the kit has already decided once.
 */
export function lbl(text: string, cls?: string): string {
  return `<div class="lbl${cls ? " " + cls : ""}">${esc(text)}</div>`;
}

/**
 * The severity word.
 *
 * Decided as the ONE device replacing every colour-coded state across the five
 * reports that currently carry meaning in hue alone. It is a word rather than a
 * shade because a word survives a photocopier, needs no key at the foot of the
 * page, and says WHICH problem rather than only that there is one.
 *
 * Used at two scales with one class: in a table row's leading gutter column,
 * and under a section head in the page gutter. The kit does not rank severities
 * against each other and must not start: the WORD carries the rank, so a report
 * with two levels uses two words rather than two weights of the same word.
 */
export function gutterWord(word: string): string {
  return `<span class="gw">${esc(word)}</span>`;
}

/* ------------------------------------------------------------------ */
/* Masthead                                                            */
/* ------------------------------------------------------------------ */

/** One label/value pair on the masthead meta block. */
export type MetaPair = {
  label: string;
  value: string;
  /** Set when the value is a FIGURE or an IDENTIFIER, so it is isolated. Leave
   *  unset for a name or a word: isolating an Arabic name as LTR is the same
   *  bug in the opposite direction. */
  num?: boolean;
  /** Trailing prose after the value, e.g. "per delivered trip". */
  tail?: string;
};

/** Issuing-company identity, for documents that instruct a third party. */
export type Letterhead = {
  name: string;
  lines: MetaPair[];
};

export type Masthead = {
  /** Small tracked label above the title, e.g. the report's kind. */
  eyebrow: string;
  /** Trailing-edge counterpart to the eyebrow, e.g. a reference. */
  eyebrowEnd?: MetaPair;
  title: string;
  /** Bolded lead of the subtitle line, e.g. the customer. */
  subtitleLead?: string;
  subtitle?: string;
  /** Meta block, one array per printed line. */
  meta: MetaPair[][];
  /**
   * THE dramatic figure. Present on a REPORT, which exists to state a measured
   * total, and absent on a DOCUMENT, which exists to instruct: a purchase order
   * or an exit permit has no single number that deserves 72px, and giving it
   * one invents an emphasis the document does not have.
   */
  figure?: { caption: string; value: string; unit: string };
  /** Present on a document that must state its issuer on its face. */
  letterhead?: Letterhead;
};

function metaPair(p: MetaPair): string {
  const v = p.num ? iso(p.value) : `<span>${esc(p.value)}</span>`;
  // A tail that OPENS with punctuation is a continuation of the value, not a
  // new word after it: ", fixed per delivered trip" closes the clause the
  // figure started. Joining with an unconditional space sets the comma adrift -
  // "12.00 SAR , fixed" - which reads as a typo on a document a customer keeps.
  // Decided here rather than by asking callers to pre-trim, because a caller
  // that gets it wrong produces a defect nobody sees until the sheet is an
  // image. Caught exactly that way, diffing the kit against the approved JPGs.
  const tail = p.tail ? (/^[,.;:!?)\]]/.test(p.tail) ? "" : " ") + esc(p.tail) : "";
  return `${esc(p.label)} ${v}${tail}`;
}

/**
 * The masthead.
 *
 * Deliberately NOT on the .row gutter grid the rest of the page uses. The title
 * is the widest thing on the sheet and belongs across the whole measure; hung
 * in the 104px gutter column it crushes to one word per line. Two tiers
 * instead: a full-measure title, then a 1fr/auto footing of meta against
 * figure.
 */
export function masthead(m: Masthead): string {
  const head = m.letterhead
    ? `<div class="letterhead"><b>${esc(m.letterhead.name)}</b>` +
      m.letterhead.lines.map(metaPair).join("<br>") +
      `</div>`
    : "";

  const figure = m.figure
    ? `<div class="figure-block">
      <div class="lbl figure-cap">${esc(m.figure.caption)}</div>
      <div class="figure">${iso(m.figure.value)}</div>
      <div class="lbl figure-unit">${esc(m.figure.unit)}</div>
    </div>`
    : "";

  const subtitle =
    m.subtitleLead || m.subtitle
      ? `<div class="subtitle">` +
        (m.subtitleLead ? `<b>${esc(m.subtitleLead)}</b>` : "") +
        (m.subtitleLead && m.subtitle ? " &nbsp;/&nbsp; " : "") +
        (m.subtitle ? esc(m.subtitle) : "") +
        `</div>`
      : "";

  return `<header class="mast">
  <div class="mast-line">
    <div class="lbl eyebrow">${esc(m.eyebrow)}</div>
    ${m.eyebrowEnd ? `<div class="lbl eyebrow">${metaPair(m.eyebrowEnd)}</div>` : ""}
  </div>
  <h1 class="title">${esc(m.title)}</h1>
  ${subtitle}
  ${head}
  <div class="mast-foot">
    <div class="mast-meta">${m.meta.map((line) => line.map(metaPair).join(" &nbsp; &nbsp; ")).join("<br>")}</div>
    ${figure}
  </div>
  <div class="rule-heavy"></div>
</header>`;
}

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

/**
 * A hanging-gutter section: the title sits out in the fixed leading column and
 * the content hangs beside it.
 *
 * `flag` puts the severity word under the section head, for a finding that
 * applies to the whole section rather than to one row.
 *
 * NO break-after: avoid ON THE HEAD, EVER. The head is a GRID ITEM, so it
 * cannot be stranded from its content the way a stacked heading can: the grid
 * row carries both or fragments both. Asking Chromium to avoid a break after a
 * grid item propagated the constraint outward and pushed the entire flow off
 * page one, turning a 2-page sheet into a blank page followed by two. Measured,
 * not theorised.
 */
export function section(opts: {
  head: string;
  sub?: string;
  flag?: string;
  body: string;
  /** Class for the content column, e.g. "chart" or "pair". */
  bodyClass?: string;
}): string {
  return `<section class="row">
  <div class="sec-head">${esc(opts.head)}${opts.sub ? `<span class="sub">${esc(opts.sub)}</span>` : ""}${
    opts.flag ? gutterWord(opts.flag) : ""
  }</div>
  <div${opts.bodyClass ? ` class="${opts.bodyClass}"` : ""}>${opts.body}</div>
</section>`;
}

/* ------------------------------------------------------------------ */
/* Stat strip                                                          */
/* ------------------------------------------------------------------ */

export type Stat = {
  label: string;
  /** The measured figure. Isolated automatically. */
  value?: string;
  /** Unit chip after the figure, e.g. SAR. */
  unit?: string;
  /**
   * Set INSTEAD of value when the report genuinely cannot compute this metric.
   * Rendered as words, never as a faint zero: a grey 0 reads as a measured zero
   * and this is the opposite claim.
   */
  absent?: string;
};

/**
 * Figures on a shared baseline, held apart by hairlines rather than boxes.
 *
 * Sized for up to five cells on a full measure. Six will fit and read cramped;
 * a report with six metrics has two sections, not one crowded strip.
 *
 * THE <wbr> BEFORE THE UNIT IS LOAD-BEARING, not tidiness. Value and unit are
 * written adjacent with no whitespace between them - the gap is a margin, not a
 * space - so the line has NO break opportunity and cannot wrap however narrow
 * the cell gets. That is what turned an over-wide strip into a clipped one on
 * the RTL sheet: with nowhere to break, the cell refused to shrink, pushed the
 * page past the paper edge, and the last figure was cut. <wbr> is a break
 * opportunity and nothing else - it adds no space and is inert while the line
 * fits, so the approved English sheet is unchanged by it - but when the cell
 * runs out of room the unit drops to a second line instead of off the page.
 * Pair it with min-width:0 on the cell (shell.ts, STAT BAND); either alone is
 * half the mechanism.
 */
export function statStrip(stats: readonly Stat[]): string {
  const cell = (s: Stat) => {
    const body = s.absent
      ? `<div class="stat-absent">${esc(s.absent)}</div>`
      : `<div class="stat-value">${iso(s.value ?? "")}${
          s.unit ? `<wbr><span class="stat-unit">${esc(s.unit)}</span>` : ""
        }</div>`;
    return `<div>${lbl(s.label, "stat-label")}${body}</div>`;
  };
  return `<div class="stats">${stats.map(cell).join("")}</div>`;
}

/* ------------------------------------------------------------------ */
/* Tables                                                              */
/* ------------------------------------------------------------------ */

export type Col = {
  head: string;
  /**
   * A figure or an identifier column. Drives THREE things at once so they can
   * never disagree: trailing alignment, tabular figures, and iso() on every
   * cell in the column. This is the centralisation the kit exists for: the
   * caller declares what the column IS, once, and never remembers to isolate a
   * cell again.
   */
  num?: boolean;
  /**
   * Isolate every cell WITHOUT making the column trailing-aligned.
   *
   * For an IDENTIFIER that reads as a word in its column but is a foreign LTR
   * run in the sentence around it: an invoice number, a plate, a date. These
   * are exactly the values iso() was written for - 026-000021 has its segments
   * swapped outright inside an Arabic paragraph - but they are set flush to the
   * reading edge beside names and methods, not ranged right beside money.
   *
   * A DATE belongs here even though a localised one is half Arabic, because it
   * is iso() that decides what inside the cell gets pinned, run by run: so
   * "04 أغسطس 2026" keeps both its figures isolated and leaves its month to the
   * paragraph's direction. That is a statement about iso(), not a coincidence.
   * Before it learned to split, this flag on a date column put the YEAR between
   * the day and the month on every row of the Arabic payments table.
   *
   * Without this the only way to isolate such a cell is a raw Cell carrying a
   * hand-written iso(), which puts the decision back at every call site and is
   * the precise thing declaring the column is meant to end. num implies this;
   * setting both is harmless and redundant.
   */
  iso?: boolean;
  /** Extra trailing gap, for a table whose columns would otherwise collide. */
  gap?: boolean;
  /** A grouping cell that spans its rows, ruled on its trailing edge. */
  group?: boolean;
  width?: string;
};

export type Cell =
  | string
  | {
      v: string;
      cls?: string;
      colSpan?: number;
      rowSpan?: number;
      /**
       * The value is ALREADY HTML and is emitted verbatim. The one escape hatch
       * in this file, for a status mark or an already-isolated figure. Anything
       * reaching this path with user text in it is an injection; pass plain
       * text and let the kit escape it instead.
       */
      raw?: boolean;
    };

export type Row = {
  cells: readonly Cell[];
  /** The severity word for this row. Its presence anywhere in the table is what
   *  creates the gutter column: an always-present empty column is a column of
   *  nothing. */
  flag?: string;
  cls?: string;
  /**
   * Index of the column this row's FIRST cell belongs to.
   *
   * Only non-zero under a rowSpan: the rows beneath a spanning group cell carry
   * one fewer cell, so without this their cells would be matched against the
   * wrong column definitions and a figure column would lose its alignment and
   * its isolate halfway down the table. Stated rather than inferred, because
   * inferring it means guessing which of several shorter rows is the spanned
   * one.
   */
  colOffset?: number;
};

function cellHtml(c: Cell, col: Col | undefined): string {
  const o = typeof c === "string" ? { v: c } : c;
  const classes: string[] = [];
  if (col?.num) classes.push("num");
  if (col?.gap) classes.push("col-gap");
  if (col?.group) classes.push("group");
  if ("cls" in o && o.cls) classes.push(o.cls);
  const attrs =
    (classes.length ? ` class="${classes.join(" ")}"` : "") +
    ("colSpan" in o && o.colSpan ? ` colspan="${o.colSpan}"` : "") +
    ("rowSpan" in o && o.rowSpan ? ` rowspan="${o.rowSpan}"` : "");
  const raw = "raw" in o && o.raw;
  const body = raw ? o.v : col?.num || col?.iso ? iso(o.v) : esc(o.v);
  return `<td${attrs}>${body}</td>`;
}

/**
 * The ruled table: no verticals, no zebra, ranked horizontals.
 *
 * `compact` drops the row rules and lets leading do the separating. Seven short
 * rows of two figures do not need seven rules; ruling every one is the
 * default-spreadsheet look and puts twenty-eight hairlines on a page that needs
 * four.
 *
 * `empty` is what prints when there are no rows. A table with a head and no
 * body reads as a rendering failure; a sentence reads as an answer.
 */
export function table(opts: {
  cols: readonly Col[];
  rows: readonly Row[];
  /** Totals row. Cells only; the kit supplies the gutter cell if one is needed. */
  foot?: readonly Cell[];
  compact?: boolean;
  empty?: string;
  /**
   * Omit the column head entirely. For a LEDGER, whose left column is prose and
   * whose right column is the figure that prose names: heading them would rule
   * off two words that label nothing.
   */
  headless?: boolean;
}): string {
  const hasFlag = opts.rows.some((r) => r.flag);

  const head = opts.headless
    ? ""
    : `<thead><tr>` +
      (hasFlag ? `<th class="gwcol"></th>` : "") +
      opts.cols
        .map((c) => {
          const cls = [c.num ? "num" : "", c.gap ? "col-gap" : ""].filter(Boolean).join(" ");
          return `<th${cls ? ` class="${cls}"` : ""}${c.width ? ` style="width:${c.width}"` : ""}>${esc(
            c.head,
          )}</th>`;
        })
        .join("") +
      `</tr></thead>`;

  const body = opts.rows.length
    ? opts.rows
        .map(
          (r) =>
            `<tr${r.cls ? ` class="${r.cls}"` : ""}>` +
            (hasFlag ? `<td class="gwcol">${r.flag ? gutterWord(r.flag) : ""}</td>` : "") +
            r.cells.map((c, i) => cellHtml(c, opts.cols[i + (r.colOffset ?? 0)])).join("") +
            `</tr>`,
        )
        .join("")
    : `<tr><td colspan="${opts.cols.length + (hasFlag ? 1 : 0)}"><div class="empty-line">${esc(
        opts.empty ?? "Nothing to report for this period.",
      )}</div></td></tr>`;

  // The totals row is skipped when there is nothing to total. A grand total of
  // 0.00 under an empty table asserts a measurement that was never made.
  // A foot cell takes the spec of the column it actually LANDS in, which is not
  // its own index the moment anything above it spans. A totals row is almost
  // always [label spanning the descriptive columns, the total] - two cells over
  // five columns - so indexing by position handed the total column 1's spec
  // instead of column 4's. On the payments table that meant the total inherited
  // the Invoice column's trailing gap rather than Amount SAR's numeric
  // alignment, and 13,685.00 printed ~53px short of the three figures it totals.
  // A total that does not line up with its own column reads as a different
  // number. Walk the span instead.
  let footCol = 0;
  const foot =
    opts.foot && opts.rows.length
      ? `<tfoot><tr>` +
        (hasFlag ? `<td class="gwcol"></td>` : "") +
        opts.foot
          .map((c) => {
            const html = cellHtml(c, opts.cols[footCol]);
            footCol += (typeof c === "object" && c.colSpan) || 1;
            return html;
          })
          .join("") +
        `</tr></tfoot>`
      : "";

  return `<table${opts.compact ? ` class="compact"` : ""}>${head}<tbody>${body}</tbody>${foot}</table>`;
}

/**
 * A label/value ledger: two columns, the label reading as prose and the figure
 * on the trailing edge.
 *
 * This is the profit-and-loss shape, and the reason it is not just table() with
 * two columns is the RULE GRAMMAR. A ledger line is a step in an argument, so
 * only the lines that CLOSE a step carry a rule. `rule` marks a subtotal,
 * `strong` marks the line the reader is being led to.
 */
export type LedgerLine = {
  label: string;
  value: string;
  unit?: string;
  /** A sub-label under the main one, e.g. what the figure excludes. */
  sub?: string;
  /** Closes a step: rule above. */
  rule?: boolean;
  /** The figure the section exists to state. */
  strong?: boolean;
  flag?: string;
};

export function ledger(lines: readonly LedgerLine[]): string {
  const rows: Row[] = lines.map((l) => ({
    flag: l.flag,
    cells: [
      {
        v:
          esc(l.label) +
          (l.sub ? `<span class="sub-line">${esc(l.sub)}</span>` : ""),
        raw: true,
        cls: l.strong ? "name" : undefined,
      },
      {
        v: iso(l.value) + (l.unit ? `<span class="stat-unit">${esc(l.unit)}</span>` : ""),
        raw: true,
        cls: l.strong ? "name" : undefined,
      },
    ],
    cls: [l.rule ? "rule-above" : "", l.strong ? "strong" : ""].filter(Boolean).join(" ") || undefined,
  }));
  return table({ cols: [{ head: "" }, { head: "", num: true }], rows, compact: true, headless: true });
}

/* ------------------------------------------------------------------ */
/* Callout                                                             */
/* ------------------------------------------------------------------ */

/**
 * A single figure the reader is meant to act on, carried by rule WEIGHT rather
 * than by a box. A box around it would be a fourth kind of container on a page
 * that draws none.
 */
export function callout(opts: {
  value: string;
  unit?: string;
  note?: string;
  flag?: string;
}): string {
  return `<div class="callout">
    ${opts.flag ? gutterWord(opts.flag) : ""}
    <div class="callout-val">${iso(opts.value)}${
      opts.unit ? `<span class="stat-unit">${esc(opts.unit)}</span>` : ""
    }</div>
    ${opts.note ? `<p class="callout-note">${esc(opts.note)}</p>` : ""}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Rolling windows                                                     */
/* ------------------------------------------------------------------ */

export type WindowItem = { label: string; count: string; sub?: string };

/** Today / 7 / 30 / 90 day counters. Same hairline grammar as the stat strip. */
export function windows(items: readonly WindowItem[]): string {
  return (
    `<div class="windows">` +
    items
      .map(
        (w) =>
          `<div>${lbl(w.label, "win-label")}<div class="win-count">${iso(w.count)}</div>` +
          (w.sub ? `<div class="win-sub">${iso(w.sub)}</div>` : "") +
          `</div>`,
      )
      .join("") +
    `</div>`
  );
}

/* ------------------------------------------------------------------ */
/* Pairs, notes, lists                                                 */
/* ------------------------------------------------------------------ */

/** Two half-measure columns, each under its own ruled label. */
export function pair(
  a: { label: string; body: string },
  b: { label: string; body: string },
): string {
  const col = (c: { label: string; body: string }) =>
    `<div><div class="pairlabel">${esc(c.label)}</div>${c.body}</div>`;
  return `<div class="pair">${col(a)}${col(b)}</div>`;
}

/**
 * A footnote under a block.
 *
 * Its job is to state a CAVEAT the figures cannot state themselves: which date
 * a window is anchored to, whether a rate was frozen, what a total excludes.
 * Measured at 72ch, which is where a line stops being comfortable to track back
 * from at this size.
 */
export function note(text: string): string {
  return `<p class="note">${esc(text)}</p>`;
}

export function defList(items: readonly { term: string; value: string }[]): string {
  return (
    `<dl class="inline-list">` +
    items
      .map((i) => `<dt class="lbl">${esc(i.term)}</dt><dd>${esc(i.value)}</dd>`)
      .join("") +
    `</dl>`
  );
}

/* ------------------------------------------------------------------ */
/* Identity, chips, marks                                              */
/* ------------------------------------------------------------------ */

export type IdentItem = { label: string; value: string; num?: boolean; sub?: string };

/**
 * Label over value, in columns: the set of facts a document states ABOUT
 * ITSELF, as against the figures a report measures. A purchase order's supplier
 * and terms, an exit permit's vehicle and driver.
 *
 * Label ABOVE the value, not beside it. Beside it, a long value wraps under its
 * own label and the pair stops reading as a pair.
 */
export function identGrid(items: readonly IdentItem[], cols = 3): string {
  return (
    `<div class="ident" style="--ident-cols:${cols}">` +
    items
      .map(
        (i) =>
          `<div>${lbl(i.label)}<div class="ident-val">${
            i.num ? iso(i.value) : `<b>${esc(i.value)}</b>`
          }${i.sub ? `<br>${esc(i.sub)}` : ""}</div></div>`,
      )
      .join("") +
    `</div>`
  );
}

/**
 * A SET of short values, not a ranking. Outlined and never filled, so no chip
 * can be read as more important than its neighbour.
 */
export function chips(items: readonly string[]): string {
  return (
    `<div class="chips">` +
    items.map((c) => `<span class="chip">${esc(c)}</span>`).join("") +
    `</div>`
  );
}

/**
 * Solid means it happened, dashed means it did not.
 *
 * The one categorical device in the kit that is not a word, kept because it is
 * already the grammar of the invoice and the statement: a reader who has seen
 * one Bousla document can read this one. It carries a BINARY only. Anything
 * with three states uses the severity word instead.
 */
export function mark(label: string, on: boolean): string {
  return `<span class="mark ${on ? "on" : "off"}">${esc(label)}</span>`;
}

/* ------------------------------------------------------------------ */
/* Signatures                                                          */
/* ------------------------------------------------------------------ */

export type SignItem = { label: string; sub?: string };

/**
 * Rules to sign ON, with the label BENEATH each.
 *
 * Beneath, not above: above the rule the label shares space with the signature
 * and the signature wins, which is how a signed form ends up unreadable. The
 * height above each rule is fixed so a hand has room whatever the label says.
 */
export function signatures(items: readonly SignItem[]): string {
  return (
    `<div class="signs">` +
    items
      .map(
        (s) =>
          `<div><div class="sign-line">${lbl(s.label)}</div>` +
          (s.sub ? `<div class="sign-sub">${esc(s.sub)}</div>` : "") +
          `</div>`,
      )
      .join("") +
    `</div>`
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

/**
 * The sheet's own footer: who produced it and when.
 *
 * NOT page numbers. Chromium has no @page counter support, so a CSS-only page
 * number prints the words Page of with nothing between them on every sheet.
 * Numbering comes from the print pipeline instead: the browser's print dialog
 * for a printed sheet, displayHeaderFooter for a generated PDF.
 */
export function sheetFooter(parts: readonly string[]): string {
  return (
    `<div class="sheet-foot">` +
    parts.map((p) => `<span>${esc(p)}</span>`).join("") +
    `</div>`
  );
}
