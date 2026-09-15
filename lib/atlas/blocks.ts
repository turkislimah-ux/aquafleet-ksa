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

/**
 * An ITEM SEPARATOR, with whatever whitespace it is padded by.
 *
 * THE SAME RULE AS THE WHITESPACE ONE ABOVE, applied to the other thing that
 * sits BETWEEN runs rather than inside one. A middot joining "AAA-5552" to
 * "drove 2 trucks" is not part of either phrase; it is the punctuation of the
 * LINE. Swept into the LTR run it renders at that run's right-hand end, which
 * on an Arabic line puts it BEFORE the plate it was meant to follow - the
 * reader meets the separator first and the thing it separates second. Measured
 * on 29 driver cells across the three operations sheets.
 *
 * DELIBERATELY THREE CHARACTERS, and the exclusions matter more than the
 * inclusions. Each of these is a list separator in every use this app has and
 * can never be part of a value:
 *
 *   hyphen-minus  EXCLUDED. A minus sign, a plate's own hyphen, an ISO date's.
 *                 Pulling it out would strand the sign of a negative figure.
 *   comma, stop   EXCLUDED. Thousands and decimal marks; 6,950.00 is ONE run.
 *   colon, slash  EXCLUDED. Inside times and dates.
 *   en/em dash    EXCLUDED, though both read as separators in prose. The
 *                 EMPTY-CELL DASH is a lone em dash that iso() wraps on its
 *                 own - 210 of them across the 50 rendered sheets - and
 *                 treating it as a separator would unwrap every one, rewriting
 *                 documents that have nothing wrong with them.
 *
 * Whitespace is taken WITH the separator, so a stripped " (middot) " leaves no
 * double space behind and the isolate's edges stay clean without a second trim.
 */
const SEP_RUN = /(\s*[·•|]\s*)/;

const ltrRun = (t: string): string =>
  `<span class="iso" dir="ltr">${esc(t)}</span>`;

/**
 * A BOUNDARY NEUTRAL: punctuation that can sit at the EDGE of a fragment but can
 * never be part of the value there.
 *
 * SEP_RUN above excludes the colon and the comma, and is right to: a colon lives
 * inside 10:52:31 and a comma inside 6,950.00, so splitting a fragment ON them
 * would cut times and thousands in half. This is the other question, asked only
 * at the two ENDS of a fragment, where those defences do not apply — NO value
 * this app prints begins or ends with a colon, a comma or a semicolon. A time
 * does not start with ":" and 1,234 does not trail its separator.
 *
 * WHY IT MATTERS, measured on the Arabic purchase order. The unit-cost sub-line
 * composes "(مطلوب: 30.00)". iso() splits it on the Arabic run, leaving ": 30.00)"
 * as one Latin fragment whose leading colon was swept into the LTR isolate — so
 * the isolate rendered its own contents left-to-right and put the colon at that
 * run's far end:
 *
 *     :30.00)بولطم(        (x-measured in Chrome, left to right)
 *
 * which a reader meets, right to left, as "(مطلوب" then ")" then the figure then
 * a colon dangling off the end. The separator arrives before the thing it
 * separates and the bracket closes around nothing — the same defect SEP_RUN was
 * written for, arriving at the edge instead of the middle.
 *
 * Left OUTSIDE the isolate the colon is a plain neutral between an Arabic word
 * and a neutral object, N1 resolves it to the paragraph's own direction, and it
 * settles where it was written.
 *
 * THE DASHES STAY OUT of this set, for SEP_RUN's own reasons: a leading hyphen
 * is the sign of a negative figure, and a lone em dash is the empty-cell mark
 * that 210 cells across the corpus depend on. The stop stays out too — "Co."
 * ends in one and that period belongs to the name.
 */
const EDGE_NEUTRAL = /[\s:,;]/;

/**
 * One non-RTL fragment: isolate its core, leave its outer whitespace behind —
 * and its boundary punctuation with it (EDGE_NEUTRAL above).
 *
 * A core of PURE NEUTRALS is left bare. An isolate pins a base direction, and a
 * fragment with no letter and no digit has none to pin - an em dash between two
 * Arabic phrases resolves to the paragraph either way, so wrapping it only adds
 * markup to read past. Note this is the SPLIT path only: a value that is a lone
 * dash reaches iso() with no RTL anywhere and takes the early return above,
 * which still wraps it, so the 210 empty cells on the sheets are untouched.
 */
const isoCore = (part: string): string => {
  let lead = 0;
  let end = part.length;
  while (lead < end && EDGE_NEUTRAL.test(part[lead])) lead++;
  while (end > lead && EDGE_NEUTRAL.test(part[end - 1])) end--;
  const core = part.slice(lead, end);
  if (core === "") return esc(part); // whitespace, or the empty edges of a split
  if (!/[\p{L}\p{N}]/u.test(core)) return esc(part);
  return esc(part.slice(0, lead)) + ltrRun(core) + esc(part.slice(end));
};

/**
 * The WHOLE value as ONE left-to-right unit, Arabic words inside it included.
 *
 * THE CASE iso() CANNOT SERVE, and the reason it cannot is worth stating
 * precisely, because iso() is right about everything else.
 *
 * iso() SPLITS at each RTL run and isolates the Latin pieces individually. On
 * the day-first date that shaped it — "04 أغسطس 2026" — that is exactly correct:
 * three runs, laid out right-to-left as 04 · أغسطس · 2026, which is the order
 * they are read in.
 *
 * A MONTH-FIRST date has one Latin run and it is all on ONE SIDE of the month
 * word: "أغسطس 5, 2026, 10:52:31 PM" splits into [أغسطس][5, 2026, 10:52:31 PM].
 * The isolate renders left-to-right INSIDE itself, so its rightmost character is
 * the M of PM — and in an RTL line the reader meets the month, then immediately
 * PM, then the time, then the year, and finally the day, furthest from the month
 * it belongs to. Every piece is individually correct and the line is unreadable.
 * A short tail like "1, 2026" survives it because the eye takes the pair as one
 * token; "15, 2026, 10:52:31 PM" does not.
 *
 * So: no split. One isolate, LTR base, month name and figures inside it
 * together, keeping the order the formatter wrote them in. The Arabic word still
 * renders its own letters right-to-left — that is the word's business — but it
 * no longer detaches from its day.
 *
 * AND THE OUTER ISOLATE ALONE IS NOT ENOUGH, which cost a round trip to find.
 * `dir="ltr"` sets the base LEVEL; it does not change any character's bidi CLASS.
 * An Arabic letter is class AL, and UAX#9 W2 re-types every European number that
 * follows a strong AL as an ARABIC number (EN -> AN). AN is laid out in
 * right-to-left GROUPS, so inside a "ltr" isolate "سبتمبر 15, 2026, 10:52:31 PM"
 * still printed
 *
 *     10:52:31 ,2026 ,15 سبتمبر PM        (x-measured in Chrome, left to right)
 *
 * — the three figures reversed as blocks, and PM, which is strong L and so the
 * one token W2 does NOT touch, thrown clear to the other end of the line. That is
 * the exact shape Turki photographed.
 *
 * The month is therefore given an isolate OF ITS OWN. Inside that isolate it is
 * still strong AL and still reads right-to-left; from outside it is a single
 * neutral object, so the last strong type the digits can see is the unit's own
 * left-to-right start. W2 leaves them EN, W7 then makes them L, and the whole
 * tail — figures, commas, time and PM — lays out in one Latin run in written
 * order. Two isolates, not one: the inner one is what makes the outer one true.
 *
 * NOT A REPLACEMENT FOR iso(). Use this only where the value is a single
 * composed token whose internal order is Latin-structured: a localised date, and
 * so far nothing else. Passing a NAME through here is the bug the `num` flag
 * warns about, in the opposite direction.
 */
export function isoUnit(value: string | number): string {
  const s = String(value);
  // No Arabic word in it, so nothing can re-type the digits: one isolate is the
  // whole job, and this is every English document's path.
  if (!RTL_RUN.test(s)) return ltrRun(s);
  const inner = s
    .split(RTL_RUN)
    .map((part, i) =>
      // `dir="auto"` rather than "rtl": the run is whatever script it is, and
      // the only claim being made here is that it is SEALED.
      i % 2 === 1 ? `<span class="iso" dir="auto">${esc(part)}</span>` : esc(part),
    )
    .join("");
  return `<span class="iso" dir="ltr">${inner}</span>`;
}

export function iso(value: string | number): string {
  const s = String(value);
  // The common case, and the ONLY case in an English document: no strong RTL
  // character anywhere, so the whole value is a single run. Same bytes this
  // function emitted before it learned to split - and the separator rule below
  // is deliberately NOT applied here, because in an LTR paragraph a middot has
  // nowhere wrong to go.
  if (!RTL_RUN.test(s)) return ltrRun(s);
  return s
    .split(RTL_RUN)
    .map((part, i) => {
      if (i % 2 === 1) return esc(part); // an RTL run: never isolated
      return part
        .split(SEP_RUN)
        .map((piece, j) => (j % 2 === 1 ? esc(piece) : isoCore(piece)))
        .join("");
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
  /**
   * The value is ONE composed token in Latin order — a localised date — so it
   * is isolated WHOLE rather than split run by run. See isoUnit(). Wins over
   * `num`, which would split it at its month name and strand the day.
   */
  unit?: boolean;
  /** Trailing prose after the value, e.g. "per delivered trip". */
  tail?: string;
  /**
   * The LEAD fact of a meta stack, set in weight.
   *
   * For the stack whose lines are BARE VALUES with no label word — where two
   * neighbours can be the same string standing for different facts, and the
   * reader has only rank to tell them apart. The payout voucher is exactly
   * that: the month a run SETTLED sits above the run's own frozen caption, and
   * on most rows both read "Sep 2026". Unranked they print as one line typed
   * twice.
   *
   * WEIGHT rather than case or tracking, because this marks a VALUE: caps and
   * tracking are the label register here, and a value wearing it reads as a
   * heading for the line beneath. Weight is also one of the three devices that
   * survive Arabic, which has no case (see the RTL note further down).
   */
  strong?: boolean;
};

/** Issuing-company identity, for documents that instruct a third party. */
export type Letterhead = {
  name: string;
  /** readonly: the kit only ever maps over these. A view-model that hands over
   *  a frozen list should not have to widen it to be printed. */
  lines: readonly MetaPair[];
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
  /**
   * Status marks on the trailing edge of the eyebrow line, same grammar as
   * mark(): solid means it happened, dashed means it did not.
   *
   * Here rather than in the body because a document's state qualifies the
   * document, not one of its sections — an exit permit that is VOIDED is void
   * on its face, and a reader who has to reach the foot of the sheet to learn
   * that has already been misled. Every field of this block is escaped and
   * there is no raw slot, deliberately, so a caller cannot smuggle a mark in
   * through a string: it asks for one, and the kit draws it.
   */
  marks?: readonly { label: string; on: boolean }[];
};

function metaPair(p: MetaPair): string {
  const v = p.unit
    ? isoUnit(p.value)
    : p.num
      ? iso(p.value)
      : `<span>${esc(p.value)}</span>`;
  // A tail that OPENS with punctuation is a continuation of the value, not a
  // new word after it: ", fixed per delivered trip" closes the clause the
  // figure started. Joining with an unconditional space sets the comma adrift -
  // "12.00 SAR , fixed" - which reads as a typo on a document a customer keeps.
  // Decided here rather than by asking callers to pre-trim, because a caller
  // that gets it wrong produces a defect nobody sees until the sheet is an
  // image. Caught exactly that way, diffing the kit against the approved JPGs.
  const tail = p.tail ? (/^[,.;:!?)\]]/.test(p.tail) ? "" : " ") + esc(p.tail) : "";
  const body = `${esc(p.label)} ${v}${tail}`;
  // Around the WHOLE pair, not just the value: a labelled lead line ranks as
  // one line. The letterhead already sets its name this way, so <b> is the
  // block's established weight device rather than a new one.
  return p.strong ? `<b>${body}</b>` : body;
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

  // eyebrowEnd and marks share the trailing edge, so they need a group of their
  // own: two flex children of .mast-line would be pushed apart by its
  // space-between, stranding the reference on the left of the marks instead of
  // beside them.
  const end =
    m.eyebrowEnd || m.marks?.length
      ? `<div class="mast-end">` +
        (m.eyebrowEnd ? `<div class="lbl eyebrow">${metaPair(m.eyebrowEnd)}</div>` : "") +
        (m.marks ?? []).map((s) => mark(s.label, s.on)).join("") +
        `</div>`
      : "";

  // THE FOOTING IS OMITTED, NOT EMPTIED. A REPORT always has meta and usually a
  // figure; a DOCUMENT has neither — its identity is a grid in its first
  // section, and `figure` is deliberately absent on a PO or a permit (see the
  // Masthead type). Emitting the wrapper anyway left an empty block carrying
  // .mast-foot's 22px top margin, which reads on the sheet as a tear-off strip
  // with nothing in it. An empty div is not free just because it is empty.
  const foot =
    m.meta.length || figure
      ? `<div class="mast-foot">
    <div class="mast-meta">${m.meta.map((line) => line.map(metaPair).join(" &nbsp; &nbsp; ")).join("<br>")}</div>
    ${figure}
  </div>`
      : "";

  return `<header class="mast">
  <div class="mast-line">
    <div class="lbl eyebrow">${esc(m.eyebrow)}</div>
    ${end}
  </div>
  <h1 class="title">${esc(m.title)}</h1>
  ${subtitle}
  ${head}
  ${foot}
  <div class="rule-heavy"></div>
</header>`;
}

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

/**
 * WHERE THE SECTION TITLE SITS. Two placements, one label device.
 *
 * - `gutter` — the title hangs out in the fixed leading column and the content
 *   sits beside it. A wide-margin reading layout: the titles form a scannable
 *   rail down the edge and the content keeps one continuous measure.
 * - `top` — the title sits ABOVE its content at full measure, no leading
 *   column. The content gets the whole width, which is what a DOCUMENT wants:
 *   a purchase order's table has six columns to place and no width to lend to a
 *   rail of headings nobody reads twice.
 *
 * THE CHOICE IS PER REPORT AND IT IS THE VIEW-MODEL'S CALLER'S, not this
 * file's. What does NOT change with it: the type tokens, the rules, the
 * severity gutter-word device, and above all the RANKED LABEL — English sets
 * these heads as tracked caps, Arabic as weight + size + a hairline, because
 * Arabic has no case to track. Both modes emit the SAME `.sec-head` element, so
 * that ranking is inherited rather than restated, and neither mode can drift
 * from the other in the one place a reader would notice.
 */
export type SectionLayout = "gutter" | "top";

/**
 * A section: a title and its content.
 *
 * `flag` puts the severity word under the section head, for a finding that
 * applies to the whole section rather than to one row.
 *
 * NO break-after: avoid ON A GUTTER HEAD, EVER. There it is a GRID ITEM, so it
 * cannot be stranded from its content the way a stacked heading can: the grid
 * row carries both or fragments both. Asking Chromium to avoid a break after a
 * grid item propagated the constraint outward and pushed the entire flow off
 * page one, turning a 2-page sheet into a blank page followed by two. Measured,
 * not theorised. A TOP head is a stacked heading and CAN be orphaned, so it
 * takes the opposite treatment — see `.stack` in ./shell.ts, where the rule is
 * scoped to that mode precisely so it can never reach a grid item.
 */
export function section(opts: {
  head: string;
  sub?: string;
  flag?: string;
  body: string;
  /** Class for the content column, e.g. "chart" or "pair". */
  bodyClass?: string;
  /**
   * Defaults to `gutter`, which is what every report shipped before this
   * argument existed. The default is load-bearing for exactly that reason:
   * the Customer Breakdown is live and its sections must keep rendering
   * byte-identically, so adding the argument had to change nothing for a caller
   * that does not pass it. New reports state their mode explicitly.
   */
  layout?: SectionLayout;
  /**
   * A HARD RULE ABOVE: what follows is not the next STEP of this sheet, it is a
   * DIFFERENT DOCUMENT that happens to share the paper.
   *
   * Reach for it only where adding the two blocks' figures together would be
   * WRONG rather than merely unusual — the VAT list under the P&L, whose six
   * rows carry no total by design; the manual side-log under the daily trips,
   * totalled separately by 0166 and never joined to the project totals. Spent on
   * an ordinary section it devalues itself, and then the one place it is
   * load-bearing reads as decoration.
   *
   * It replaces a GAP, which is what the screens use and what paper cannot
   * carry: a gap of any size is just a gap once the card edge is gone, and at a
   * page boundary it vanishes altogether and the two blocks run together.
   */
  divider?: boolean;
}): string {
  const head = `<div class="sec-head">${esc(opts.head)}${
    opts.sub ? `<span class="sub">${esc(opts.sub)}</span>` : ""
  }${opts.flag ? gutterWord(opts.flag) : ""}</div>`;
  const body = `<div${opts.bodyClass ? ` class="${opts.bodyClass}"` : ""}>${opts.body}</div>`;
  // Appended, never substituted: the divider is orthogonal to the placement of
  // the head, so it must not cost a caller its layout mode.
  const cls = `${opts.layout === "top" ? "stack" : "row"}${opts.divider ? " sec-break" : ""}`;

  // Two wrappers, one child order. The head is written FIRST in both, so the
  // reading order and the DOM order agree in gutter mode too and the placement
  // stays a pure matter of the container's own layout.
  return `<section class="${cls}">
  ${head}
  ${body}
</section>`;
}

/**
 * A section with NO head, spanning the whole measure.
 *
 * NOT a `section()` with an empty head — that reserves the 104px gutter column
 * and hangs the content beside a blank, which reads as a heading that failed to
 * render rather than as a block that never had one.
 *
 * It exists because a HEADING IS WORDING, and wording is the view-model's. A
 * report is written in sections and names each one; a gate pass is one
 * continuous instruction — its screen source has no headings anywhere, so a
 * renderer that invented "Line items" over its table would be putting a word on
 * the sheet that nobody wrote. The block takes its place in the flow by
 * POSITION, which is what the screen does too.
 *
 * Keeps `section`'s margin and its break-inside: avoid, so a headless block is
 * spaced and paginated exactly like a headed one.
 */
export function block(body: string): string {
  return `<section>${body}</section>`;
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
  /**
   * Every cell isolated WHOLE, as one Latin-ordered token, instead of split run
   * by run. The LOCALISED-DATE column: see isoUnit() for why a month-first date
   * cannot survive the split that a day-first one needs. Wins over `iso` and
   * `num`; alignment still follows `num`.
   */
  unit?: boolean;
  /** Extra trailing gap, for a table whose columns would otherwise collide. */
  gap?: boolean;
  /** A grouping cell that spans its rows, ruled on its trailing edge. */
  group?: boolean;
  width?: string;
  /**
   * A quieter second line under the column head — the counterpart of `Cell.sub`
   * one row up, and added for the same reason.
   *
   * For the fact that QUALIFIES the whole column rather than heading a column of
   * its own: the custom report's BASIS (accrual / cash / operational) under the
   * metric it measures. That pairing is two lines in one cell on screen, and the
   * two alternatives on paper are both wrong — spliced into the head it makes an
   * unreadable heading, and split into its own column it claims the basis ranks
   * beside the metric and needs a head nobody wrote.
   *
   * ESCAPED, never isolated: a sub-head is WORDING (a translated enum label),
   * not a figure, so `num`/`iso` do not reach it. The head itself is not
   * isolated either, for the same reason.
   */
  sub?: string;
};

export type Cell =
  | string
  | {
      v: string;
      cls?: string;
      colSpan?: number;
      rowSpan?: number;
      /**
       * A quieter second line under the value, in the same cell.
       *
       * For the fact that QUALIFIES the value rather than standing beside it: a
       * part's SKU under its name, the ordered price under the one actually
       * paid, an approval's timestamp under the approver. Every one of those is
       * a muted second line on its own screen already, so a column of its own
       * on paper would need a head nobody wrote and would claim the two facts
       * rank equally.
       *
       * ESCAPED AND ISOLATED ON THE COLUMN'S OWN RULE, exactly as the value is
       * — a sub-line is not a back door past `raw`. It is inert under `raw`,
       * where the caller owns the whole cell's markup.
       */
      sub?: string;
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

/**
 * `afterGroup` is the column's POSITION, not a property of its spec: the cell
 * takes the air on the far side of the preceding column's grouping rail. It is
 * passed in rather than read off `col` because the column that needs it is not
 * the column that declares `group`, and because the head and the foot - neither
 * of which draws a rail - still have to line up with the body that does.
 */
function cellHtml(c: Cell, col: Col | undefined, afterGroup = false): string {
  const o = typeof c === "string" ? { v: c } : c;
  const classes: string[] = [];
  if (col?.num) classes.push("num");
  if (col?.gap) classes.push("col-gap");
  if (col?.group) classes.push("group");
  if (afterGroup) classes.push("rail-gap");
  if ("cls" in o && o.cls) classes.push(o.cls);
  const attrs =
    (classes.length ? ` class="${classes.join(" ")}"` : "") +
    ("colSpan" in o && o.colSpan ? ` colspan="${o.colSpan}"` : "") +
    ("rowSpan" in o && o.rowSpan ? ` rowspan="${o.rowSpan}"` : "");
  const raw = "raw" in o && o.raw;
  const text = (s: string) =>
    col?.unit ? isoUnit(s) : col?.num || col?.iso ? iso(s) : esc(s);
  const body = raw ? o.v : text(o.v);
  const sub =
    !raw && "sub" in o && o.sub ? `<span class="sub-line">${text(o.sub)}</span>` : "";
  return `<td${attrs}>${body}${sub}</td>`;
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

  // The column immediately after a grouping column, which takes the air on the
  // far side of that column's rail. Read from the SPEC, so head, body and foot
  // all answer it the same way and stay in one vertical line.
  const afterGroup = (i: number): boolean => opts.cols[i - 1]?.group === true;

  const head = opts.headless
    ? ""
    : `<thead><tr>` +
      (hasFlag ? `<th class="gwcol"></th>` : "") +
      opts.cols
        .map((c, i) => {
          const cls = [c.num ? "num" : "", c.gap ? "col-gap" : "", afterGroup(i) ? "rail-gap" : ""]
            .filter(Boolean)
            .join(" ");
          const sub = c.sub ? `<span class="sub-line">${esc(c.sub)}</span>` : "";
          return `<th${cls ? ` class="${cls}"` : ""}${c.width ? ` style="width:${c.width}"` : ""}>${esc(
            c.head,
          )}${sub}</th>`;
        })
        .join("") +
      `</tr></thead>`;

  const body = opts.rows.length
    ? opts.rows
        .map(
          (r) =>
            `<tr${r.cls ? ` class="${r.cls}"` : ""}>` +
            (hasFlag ? `<td class="gwcol">${r.flag ? gutterWord(r.flag) : ""}</td>` : "") +
            r.cells
              .map((c, i) => {
                const ci = i + (r.colOffset ?? 0);
                return cellHtml(c, opts.cols[ci], afterGroup(ci));
              })
              .join("") +
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
            // A FOOT CELL IS NOT A GROUPING CELL. `group` draws the rail that
            // ties a spanned name to the rows beneath it; a totals row has no
            // spanned name, and its label almost always covers MORE columns
            // than the body's group cell does - so the rail would land at a
            // different horizontal position and read as a second, misaligned
            // vertical rule under the table. The column's other flags survive,
            // because those describe the FIGURE and a total is one.
            const spec = opts.cols[footCol];
            const html = cellHtml(
              c,
              spec?.group ? { ...spec, group: false } : spec,
              afterGroup(footCol),
            );
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

/**
 * THE SAME LEDGER OVER MORE THAN TWO COLUMNS.
 *
 * `ledger()` is hard-wired to label + figure, which is every ledger in the pack
 * but one. The P&L sets each line against the PRIOR period and the two movements
 * between them, so a line is one label and four figures; four two-column ledgers
 * side by side would print the same eighteen labels four times and break the one
 * comparison the sheet exists to make.
 *
 * So what is lifted out of `ledger()` is its RULE GRAMMAR — rules are RARE and
 * each one CLOSES a step — and applied over a declared column list. The row
 * classes are literally the same two (`rule-above`, `strong`), not a second
 * spelling of them: a change to what a subtotal looks like has to land on both
 * ledgers or the pack has two ledgers.
 *
 * Two devices are added that two columns never needed. Both are described where
 * they are set, in shell.ts:
 *
 *   `{ head }` — a heading inside the table body, naming the step the lines
 *   beneath it compose.
 *   `indent` — a line that is a COMPONENT of another line rather than a step of
 *   its own.
 *
 * AND ONE THAT IS NOT ADDED: there is no `estimate` flag here. A row that is not
 * a measured figure is marked with the severity gutter WORD, like every other
 * finding in the pack — the screen italicises it, and italic is the first thing
 * a photocopier loses.
 */
export type LedgerRow =
  | { head: string }
  /**
   * A SENTENCE ON ITS OWN ROW, spanning every column.
   *
   * Not `note()` under the table, and the difference is grouping rather than
   * styling: each of these belongs to the line it sits against — the empty
   * state standing in for the expense lines, the caveat the Zakat figure may
   * never print without, the count of fills whose cost is unknown. Moved to the
   * foot of the sheet they would all still be true and none of them would still
   * be attached, which is the deviation.
   *
   * It takes a `flag` for the same reason any row does: a sentence can be a
   * finding.
   */
  | { note: string; flag?: string }
  | {
      label: string;
      /** One cell per column AFTER the label column, in column order. */
      values: readonly Cell[];
      /**
       * A BINARY about the line, set beside its label.
       *
       * For the fact that qualifies the FIGURE without being one: a payslip's
       * commission line is the same amount whether it was already paid out or
       * only earned this month, and the difference decides what the driver can
       * expect. On screen that is a chip beside the word; here it is the kit's
       * one categorical device (see `mark`).
       *
       * Beside the LABEL, never in a column of its own: a column needs a head
       * nobody wrote, and this qualifies one line out of seven — six empty cells
       * under a heading is a column of nothing.
       */
      mark?: { word: string; on: boolean };
      /** A component of the line it sits under, not a step of its own. */
      indent?: boolean;
      /** A sub-label under the main one. */
      sub?: string;
      /** Closes a step: rule above. */
      rule?: boolean;
      /** The figure the step exists to state. */
      strong?: boolean;
      /** The severity word, in the gutter. */
      flag?: string;
    };

export function ledgerTable(opts: {
  /** The label column FIRST, then one per measure. */
  cols: readonly Col[];
  rows: readonly LedgerRow[];
  compact?: boolean;
  foot?: readonly Cell[];
  /**
   * The same option `table()` takes, forwarded for the same case `ledger()`
   * hard-codes: a two-column ledger whose left side is prose and whose right
   * side is the figure that prose names has nothing to head.
   *
   * It is an OPTION here rather than the default because the P&L ledger heads
   * four measure columns and could not be read without them, while a payslip's
   * earnings ledger heads none on screen either.
   */
  headless?: boolean;
}): string {
  const rows: Row[] = opts.rows.map((r) =>
    // Both spanning forms cover every column INCLUDING the label's, and NOT the
    // gutter's: table() emits that cell itself when any row carries a flag.
    "head" in r
      ? { cells: [{ v: r.head, cls: "sechead", colSpan: opts.cols.length }] }
      : "note" in r
        ? {
            ...(r.flag ? { flag: r.flag } : {}),
            cells: [{ v: r.note, cls: "quiet wrap", colSpan: opts.cols.length }],
          }
        : {
            flag: r.flag,
            cells: [
              {
                // COMPOSED HERE rather than handed to cellHtml as `v` + `sub`,
                // because a mark is markup and `sub` is inert under `raw`. The
                // two halves are escaped exactly as cellHtml would escape them
                // on a label column — which carries neither `num` nor `iso`, so
                // its own `text()` is `esc` — and the composition is the same
                // one ledger() makes two hundred lines up. A label column
                // declared `iso` would isolate nothing it should: a ledger label
                // is prose.
                v:
                  esc(r.label) +
                  (r.mark ? " " + mark(r.mark.word, r.mark.on) : "") +
                  (r.sub ? `<span class="sub-line">${esc(r.sub)}</span>` : ""),
                raw: true,
                cls:
                  [r.indent ? "indent" : "", r.strong ? "name" : ""]
                    .filter(Boolean)
                    .join(" ") || undefined,
              },
              ...r.values,
            ],
            cls:
              [r.rule ? "rule-above" : "", r.strong ? "strong" : ""]
                .filter(Boolean)
                .join(" ") || undefined,
          },
  );
  return table({
    cols: opts.cols,
    rows,
    compact: opts.compact,
    headless: opts.headless,
    ...(opts.foot ? { foot: opts.foot } : {}),
  });
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
 *
 * `iso` IS OPT-IN, AND THAT IS A SCOPE DECISION RATHER THAN A DESIGN ONE. A
 * note is prose, so most of them are one direction throughout and isolation is
 * inert; but a note that quotes FIGURES is a mixed line like any other, and the
 * browser reorders it. The cost sheet's fill lead is the measured case - Arabic
 * renders "210.00 SAR" with the unit displaced past the next count, so the
 * sheet reads 210.00, then 18, then SAR.
 *
 * It is the ONLY one. Every mixed-direction string on all 25 Arabic sheets was
 * laid out and its runs read back off their boxes; this note was the single
 * line whose runs came out in the wrong order. So default-on would rewrite the
 * markup of every note on every sheet, issued ones included, to fix one - and
 * the flag is set where a note has been MEASURED to need it instead.
 *
 * That measurement is a snapshot of today's fixtures, not a property of the
 * kit: a note that starts quoting a figure tomorrow is naked again and nothing
 * here will say so. The detector, not this comment, is what re-answers it.
 */
export function note(text: string, opts?: { iso?: boolean }): string {
  return `<p class="note">${opts?.iso ? iso(text) : esc(text)}</p>`;
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

export type RunItem = { label: string; count: string };

/**
 * A NAMED SET WITH A COUNT ON EACH MEMBER, inside a table cell.
 *
 * Not chips(): a chip draws a box, and a cell holding five boxed names reads as
 * five controls in a column of plain values - the boxes outweigh the names they
 * hold, and the count has nowhere to sit inside one. Not a joined sentence
 * either: "Riyadh Camp 12 Jeddah Yard 8" cannot be parsed back into pairs by any
 * reader who does not already know the data.
 *
 * So: the label system the kit already ranks by language - tracked caps in
 * Latin, weight and size in Arabic - with the count set quietly beside it. ONE
 * RUN PER LINE, not a flowed cloud: flowed, the break falls wherever the cell
 * width puts it and a count lands beside the NEXT name as often as beside its
 * own. Stacked, a long name still wraps, but inside its own run.
 *
 * THE COUNT IS ISOLATED, THE NAME IS NOT. A project name is user text of unknown
 * direction and isolating it as LTR is the bug in the opposite direction; the
 * count is a Latin digit run inside it and reorders without the isolate.
 */
export function runs(items: readonly RunItem[]): string {
  return (
    `<div class="runs">` +
    items
      .map(
        (r) =>
          `<span class="run"><span class="lbl run-label">${esc(r.label)}</span>` +
          `<span class="run-count">${iso(r.count)}</span></span>`,
      )
      .join("") +
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
