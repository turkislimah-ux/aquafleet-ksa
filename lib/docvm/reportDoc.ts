// THE FOUR THINGS EVERY REPORT SHEET SAYS THE SAME WAY.
//
// Eleven view-models import this file, each mirroring a DIFFERENT statement on
// the reports pack. What they share is not a coincidence of wording — it is one
// SURFACE. They are all the same screen: one tab, one period control, one Print
// button, and whatever statement is mounted underneath. A sheet torn off that
// tab identifies itself, dates itself and units its money the same way no
// matter which statement produced it, because to the person filing it they are
// one pack.
//
// IT USED TO SAY "FOUR", AND THE SHARED THING USED TO BE A COMPONENT:
// `PrintBand` in app/reports/StatementViews.tsx stamped a title/period band on
// top of whichever statement was about to print, and this file was here so that
// changing the band could not leave four sheets disagreeing with it. The band
// is deleted — every statement now renders a masthead inside its own document —
// so the justification had to be restated rather than quietly outlived. The
// constraint survived the mechanism: these four values still have exactly one
// expression, and it is still because the pack is one surface.
//
// This is why this file exists and lib/docvm/{breakdown,purchaseOrder,
// exitPermit}.ts have no equivalent: those three mirror three unrelated screens
// that happen to print the same company NAME, so each declares its own literal
// beside the screen it answers to. Hoisting a coincidence into a shared module
// would claim a relationship that is not there. Here the relationship IS there.
//
// Nothing in this file decides a LOOK. It resolves words and hands back plain
// data, exactly as a view-model must.

import { t, type Lang } from "../i18n";
import type { MetaPair } from "../atlas/blocks";

/**
 * The identification line, and the ONE literal in this file.
 *
 * It lands in the masthead's eyebrow, and the reason it is a literal is the
 * reason the band that carried it before printed it inside a `translate="no"`
 * span: a filed sheet has no sidebar and no tab, so this line is the only thing
 * on the paper that says whose statement it is. A translated company name
 * defeats it. A proper noun is not a dictionary leaf — it does not go through
 * `t()`, in either direction.
 *
 * NOT "Bin Slimah Group · Bousla", which is what lib/docvm/breakdown.ts and
 * lib/docvm/purchaseOrder.ts carry. Those two mirror screens whose own footers
 * print the internal product name beside the company's; the statements screen
 * does not, so neither does this sheet. Adding it here would be an ADDITION to
 * the source's wording, which the printable law forbids as squarely as dropping
 * one.
 */
export const DOC_COMPANY = "Bin Slimah Group";

/**
 * The unit beside a figure — a LITERAL, in both languages, and deliberately.
 *
 * Every statement on screen writes its money through `formatSar` (lib/utils.ts),
 * whose unit is a hard-coded " SAR" whatever the language toggle says — the same
 * en-US pinning that keeps this app's digits and dates Latin. A translated
 * "ريال" on the SHEET beside an Arabic SCREEN saying "SAR" is a WORDING
 * deviation, and the law does not rank those below wrong numbers.
 *
 * lib/i18n.ts holds the epitaph for the key this replaced — grep `sarUnit` there
 * for why it must not come back, and for the two exemptions that are NOT this:
 * `reports.doc.figureUnit`, the spelled-out masthead caption that English spells
 * out too, and whole-phrase column heads like "المبلغ بالريال", where the unit is
 * inside the head's own grammar rather than beside a figure.
 */
export const DOC_SAR = "SAR";

/**
 * The masthead's generated stamp, as a meta pair.
 *
 * It sits in the masthead's meta row, opposite the period — where the band used
 * to print it, on its second line. The sheet prints it twice — here and in the
 * footer — for the reason
 * lib/docvm/breakdown.ts gives about its Issued pair: both come from ONE string
 * computed once by the caller, so the two cannot disagree about when the sheet
 * was made.
 *
 * `num: true` because a date is an IDENTIFIER-shaped run of digits and
 * separators: isolated, it reads left-to-right on an Arabic sheet, which is how
 * the screen renders it too.
 */
export function docGeneratedMeta(lang: Lang, generated: string): MetaPair {
  return { label: t("reports.doc.generatedLabel", lang), value: generated, num: true };
}
