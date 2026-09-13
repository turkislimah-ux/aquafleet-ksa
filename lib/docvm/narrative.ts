// NARRATIVE VIEW-MODEL — what the printed period review says, in what order,
// and in which words.
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING may
//   not.
//
// The source of truth is app/reports/StatementViews.tsx, NarrativeStatement.
//
// THE BULLETS ARRIVE WRITTEN. `buildNarrative` (lib/reports.ts) takes `lang` and
// composes every sentence from reports.narrative.*, figures and all, so this
// file must not touch their text — not to reformat a number inside one, not to
// re-order them. They are DATA here. Only the furniture around them is keyed,
// which is the same division the component states in its own comment.
//
// Purity: no React, no fs, no Supabase, no `process`, no `new Date()` —
// `generatedAt` is passed in, so the same input always renders the same sheet.

import { DASH, num2 } from "../docPrimitives";
import { fill, t, type Lang } from "../i18n";
import { formatShare, type NarrativeBullet } from "../reports";
import { formatDateLang } from "../utils";
import { DOC_COMPANY, DOC_SAR, docGeneratedMeta } from "./reportDoc";

// ---------------------------------------------------------------------------
// Input — the bullets as written, the four figures as measured
// ---------------------------------------------------------------------------

export type NarrativeDocInput = {
  lang: Lang;
  generatedAt: Date;
  /** The period label the screen splices into the title, already composed. */
  label: string;
  /** Already translated by buildNarrative. Passed through untouched. */
  bullets: readonly NarrativeBullet[];
  /** The four figures the strip names, straight off the P&L row the screen
   *  reads — NOT re-derived, and not a second spelling of any of them. */
  pnl: {
    revenue: number;
    operatingCost: number;
    operatingProfit: number;
    /** Null in a month with no revenue — a margin on nothing is not a number. */
    operatingMarginPct: number | null;
  };
};

// ---------------------------------------------------------------------------
// Output — one worded object per ATLAS block
// ---------------------------------------------------------------------------

/** Mirrors lib/atlas/blocks.ts's `Stat`. */
export type DocStat = { label: string; value?: string; unit?: string; absent?: string };

export type NarrativeDocVm = {
  lang: Lang;
  rtl: boolean;
  /** The print dialog's name for the sheet. Never printed on it. */
  docTitle: string;

  masthead: {
    eyebrow: string;
    title: string;
    subtitle: string;
    meta: { label: string; value: string; num?: boolean }[][];
    figure: { caption: string; value: string; unit: string };
  };

  stats: readonly DocStat[];

  /** One line per bullet: the sentence, and the tone as a word. */
  bullets: readonly { word: string; text: string }[];

  note: string;
  footer: readonly string[];
};

/**
 * THE TONE, AS A WORD.
 *
 * On screen the tone is a 1.5px coloured dot and nothing else — five hues, no
 * key, no text. lib/atlas/shell.ts names "the narrative dots" as one of the five
 * reports carrying meaning in hue alone, and the gutter word is the device it
 * mandates in their place: a word survives a photocopier, needs no legend, and
 * says WHICH reading rather than only that there is one.
 *
 * Keyed off the TONE ENUM, never off the sentence — exactly as the screen's own
 * `dot()` is, and for the same reason it gives: buildNarrative sets the tone
 * beside the text, so the word stays right in Arabic.
 *
 * The kit does not rank severities and must not start. Five tones, five words,
 * one weight.
 */
function toneWord(tone: NarrativeBullet["tone"], lang: Lang): string {
  switch (tone) {
    case "up":
      return t("reports.doc.narrative.tone.up", lang);
    case "down":
      return t("reports.doc.narrative.tone.down", lang);
    case "flat":
      return t("reports.doc.narrative.tone.flat", lang);
    case "warn":
      return t("reports.doc.narrative.tone.warn", lang);
    case "info":
      return t("reports.doc.narrative.tone.info", lang);
  }
}

export function buildNarrativeVm(input: NarrativeDocInput): NarrativeDocVm {
  const { lang, pnl } = input;
  const money = (n: number) => num2(n);
  const generated = formatDateLang(input.generatedAt, lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return {
    lang,
    rtl: lang === "ar",
    docTitle: fill(t("reports.doc.narrative.docTitle", lang), { p: input.label }),

    masthead: {
      eyebrow: DOC_COMPANY,
      title: fill(t("reports.narrative.stmt.title", lang), { p: input.label }),
      subtitle: t("reports.narrative.stmt.period", lang),
      meta: [[docGeneratedMeta(lang, generated)]],
      // OPERATING PROFIT is the figure this sheet exists to state — the bullets
      // are an argument that arrives at it, and the strip below carries the two
      // numbers it is made of.
      //
      // NO SEVERITY MARK ON A LOSS. The screen turns a negative profit rose,
      // which on paper would become a gutter word saying what the MINUS SIGN
      // already says, one glyph to its left. A second encoding of a fact the
      // figure carries is noise, not redundancy.
      figure: {
        caption: t("reports.metric.operatingProfit", lang),
        value: money(pnl.operatingProfit),
        unit: t("reports.doc.figureUnit", lang),
      },
    },

    // The same four the screen prints under the bullets, from the same leaves:
    // a second spelling of "Operating profit" is exactly the drift the metric
    // namespace exists to stop.
    stats: [
      { label: t("reports.metric.revenue", lang), value: money(pnl.revenue), unit: DOC_SAR },
      {
        label: t("reports.metric.operatingCost", lang),
        value: money(pnl.operatingCost),
        unit: DOC_SAR,
      },
      {
        label: t("reports.metric.operatingProfit", lang),
        value: money(pnl.operatingProfit),
        unit: DOC_SAR,
      },
      // common.margin, not a fourth spelling of it. An em dash where the ratio
      // is incomputable, in the slot meant for exactly that claim: a faint 0.0%
      // would read as a measured zero margin, which is the opposite of "there
      // was no revenue to take a margin of".
      pnl.operatingMarginPct === null
        ? { label: t("common.margin", lang), absent: DASH }
        : { label: t("common.margin", lang), value: formatShare(pnl.operatingMarginPct) },
    ],

    bullets: input.bullets.map((b) => ({ word: toneWord(b.tone, lang), text: b.text })),

    note: t("reports.narrative.stmt.note", lang),
    footer: [fill(t("reports.print.generated", lang), { d: generated }), DOC_COMPANY],
  };
}
