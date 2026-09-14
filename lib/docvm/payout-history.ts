// PAYOUT VOUCHER VIEW-MODEL — ONE FROZEN COMMISSION PAYOUT: what the printed
// voucher says, in what order, and in which words.
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING may
//   not.
//
// The source of truth is `PayoutDetail` in app/drivers/HistoryTab.tsx: its
// four-line head, its base-lines table, its items table with the denied rows,
// and its five totals.
//
// ==========================================================================
// EVERYTHING IS READ OFF THE FROZEN SNAPSHOT. NOTHING IS RE-DERIVED.
// ==========================================================================
// A payout is immutable: `pay_commission` wrote the jsonb at pay time and the
// row has not been touched since. The screen renders straight out of it and so
// does this file. Two consequences that look like omissions and are not:
//
//   * THE FIVE TOTALS COME FROM THE ROW'S COLUMNS, not from summing the tables
//     above them. base_sar…total_sar are what the driver was actually paid;
//     the item list includes DENIED lines, which were not. Re-footing the table
//     would produce a bigger number than the cheque.
//   * NEITHER TABLE GETS A TOTALS ROW, for the same reason — a foot under the
//     items column would have to either include the denied amounts (wrong) or
//     silently exclude them (a figure the screen never showed). The stat strip
//     IS the total, exactly as the screen's five boxes are.
//
// ==========================================================================
// WHAT THE SCREEN CARRIES IN HUE AND OPACITY, AND WHAT BECOMES OF IT
// ==========================================================================
//   * A DENIED ITEM is struck through AND dropped to 60% opacity, and its
//     status is an amber/emerald pill. On paper the strike survives (it is a
//     rule, not a shade) and the opacity does not — a grey row photocopies as
//     ink that ran. The opacity becomes the severity GUTTER WORD, which is the
//     kit's one device for exactly this, and the pill becomes a status MARK:
//     approved is solid because it happened, denied is dashed because it did
//     not. That is three screen devices mapping to three paper ones, and the
//     WORDS are unchanged in all three.
//   * THE DENY REASON stays where the screen puts it — under the item's own
//     name, quieter, in the same cell — as a `sub`. A column of its own would
//     need a head nobody wrote and would rank the excuse beside the item.
//
// ==========================================================================
// THE MASTHEAD META CARRIES SENTENCES, NOT LABEL/VALUE PAIRS
// ==========================================================================
// The screen's head block is four stacked lines and only ONE of them has a
// label: the month stands bare, the run caption stands bare, and the last two
// are whole sentences that contain their own label word ("Paid {when}",
// "Approved by {who}"). So every pair here has an EMPTY label and the screen's
// sentence as its value — and each gets a LINE OF ITS OWN, because the screen
// stacks them and the kit sets pairs that share a line side by side.
//
// Bare values stacked are only legible if they are RANKED, which is why the
// month takes `strong`. See the meta block's own comment for the failure that
// established it.
//
// The alternative was to split each sentence at its token and promote the lead
// word to a label — "Paid" over the date. In English that is invisible. In
// Arabic it is not: "دُفعت في" is a verb phrase, and the label register for the
// same fact is "تاريخ الدفع", a different string. Promoting it would have meant
// either printing a word the screen does not say, or splicing a translated
// sentence at a brace, which is the kind of clever that survives exactly until
// someone edits the leaf.
//
// ==========================================================================
// period_label STAYS ENGLISH, AND IS THE ONLY ISOLATED VALUE THAT IS NOT A
// FIGURE
// ==========================================================================
// The screen renders it `dir="ltr"` with a comment giving two independent
// reasons — it is FROZEN TEXT the RPC wrote, and it is the payout RUN's
// caption, not the month the run settled. Both hold here. `num: true` is the
// kit's isolate, which is what `dir="ltr"` was doing; it is not a claim that
// the caption is a number.

import {
  monthLabel,
  type CommPayout,
  type PayoutSnapshot,
  type SnapItem,
} from "../commission-rows";
import { fill, t, type Lang } from "../i18n";
import { formatDateTimeLang, formatNum, formatSar } from "../utils";

/** Not DOC_COMPANY. lib/docvm/reportDoc.ts is the REPORTS pack's shared
 *  identity; this sheet mirrors an unrelated screen that happens to print the
 *  same company name, so it declares its own — the same call
 *  lib/docvm/{breakdown,purchaseOrder,exitPermit}.ts already made. */
const COMPANY = "Bin Slimah Group · Bousla";

export type PayoutDocInput = {
  lang: Lang;
  generatedAt: Date;
  /** The frozen row. Every figure on the sheet comes from it or from its jsonb. */
  payout: CommPayout;
  /**
   * The driver's name AS THE SCREEN RESOLVED IT — `arText(d.name, d.name_ar)`
   * off the unfiltered driver list, which is how the modal's heading is built.
   * Passed in rather than read from the snapshot: the snapshot's `name` is
   * frozen at pay time, and a driver renamed since would get two different
   * names on one sheet.
   */
  driverName: string;
  /**
   * The voucher's document number (DP-2026-0001), or null.
   *
   * NULLABLE AND STAYING NULLABLE, even though migration 0196 has since made
   * the column NOT NULL and every live row carries one. The type is not a
   * restatement of the constraint: this is a pure view-model reached from
   * several callers, and a masthead that prints "DP-" with nothing after it is
   * worse than one that is absent. Null omits the whole slot.
   */
  payoutNo: string | null;
};

type Pair = { label: string; value: string; num?: boolean; strong?: boolean };

export type PayoutDocLine = {
  /** Project name, or the ad-hoc word when the line carries no project. */
  label: string;
  trips: string;
  amount: string;
};

export type PayoutDocItem = {
  label: string;
  /** The deny reason, already worded ("Denied: {reason}"). Null unless denied. */
  reason: string | null;
  kind: string;
  status: string;
  denied: boolean;
  amount: string;
};

export type PayoutDocVm = {
  lang: Lang;
  rtl: boolean;
  docTitle: string;
  masthead: {
    eyebrow: string;
    eyebrowEnd: Pair | null;
    title: string;
    subtitle: string | null;
    meta: Pair[][];
    figure: { caption: string; value: string; unit: string };
  };
  /** The five frozen totals, in the screen's order. */
  stats: { label: string; value: string }[];
  base: {
    head: string;
    cols: { project: string; trips: string; amount: string };
    rows: PayoutDocLine[];
    empty: string;
  };
  items: {
    head: string;
    cols: { item: string; type: string; status: string; amount: string };
    rows: PayoutDocItem[];
    empty: string;
    /** The severity word a denied row flies in the gutter. */
    deniedFlag: string;
  };
  signature: string;
  footer: string[];
};

/**
 * Copied from HistoryTab's own `fmtDate`, including the NaN guard.
 *
 * FORMATTING A FROZEN VALUE IS NOT REWRITING IT — paid_at is a timestamptz, not
 * a caption, so rendering its month word in Arabic changes no record. That is
 * the opposite of period_label, which IS a stored string and is printed exactly
 * as the RPC wrote it.
 */
function fmtDate(value: string, lang: Lang): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return formatDateTimeLang(d, lang, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildPayoutDocVm(input: PayoutDocInput): PayoutDocVm {
  const { lang, payout, driverName } = input;
  const snap = payout.snapshot as PayoutSnapshot | null;

  // NO sarUnit LOCAL, AND NO KEY EITHER. Every figure on this sheet is written
  // by formatSar, which appends its own hard-coded " SAR" in both languages —
  // the stat strip included, because the screen's Totline does exactly that.
  // There is no slot left for a separate unit chip, which is why this file has
  // no unit literal where lib/docvm/breakdown.ts needs one.
  const generated = fmtDate(input.generatedAt.toISOString(), lang);

  // The screen's four head lines, in the screen's order and words. Empty
  // labels throughout — see the header.
  const bare = (value: string, o?: { num?: boolean; strong?: boolean }): Pair => ({
    label: "",
    value,
    ...(o?.num ? { num: true } : {}),
    ...(o?.strong ? { strong: true } : {}),
  });

  // ONE PAIR PER LINE, because the screen stacks these four and the kit joins
  // pairs sharing a line with four spaces. The month and the caption are a
  // DIFFERENT FACT each (see the header) but on most rows they are the same
  // STRING — "Sep 2026" settled by the "Sep 2026" run — and side by side that
  // printed as "Sep 2026     Sep 2026", which reads as one line typed twice.
  // Stacked and RANKED they read as the screen's two lines, because that is
  // what they are: the screen sets the month semibold and the caption small.
  // GROUPING is unchanged — same facts, same order, same words.
  const meta: Pair[][] = [
    // A pre-0131 sweep settled no single month and says so in a sentence;
    // nothing is invented to fill the gap — and that sentence takes NO weight,
    // because the screen sets it quiet too. There is no ambiguity to resolve in
    // that branch anyway: "Swept all" cannot be mistaken for the caption below.
    [
      snap?.monthKey
        ? bare(monthLabel(snap.monthKey, lang), { strong: true })
        : bare(t("drivers.hist.sweptAll", lang)),
    ],
    [bare(payout.period_label, { num: true })],
    // NO `num` on either sentence below. The kit's isolate is for a FIGURE or
    // an IDENTIFIER; these are whole translated sentences, and forcing the
    // Arabic "دُفعت في …" to LTR is the same bug as leaving the frozen Latin
    // caption unisolated, in the opposite direction.
    [bare(fill(t("drivers.hist.paidAt", lang), { when: fmtDate(payout.paid_at, lang) }))],
    ...(payout.approved_by
      ? [[bare(fill(t("drivers.hist.approvedBy", lang), { who: payout.approved_by }))]]
      : []),
  ];

  const baseRows: PayoutDocLine[] = (snap?.baseLines ?? []).map((l) => ({
    // Discriminate on the VALUE (`projectId == null`), never on the frozen
    // English label — the snapshot is jsonb written at pay time and is never
    // rewritten. Same law the screen states at its own render site.
    label: l.projectId ? l.projectName : t("drivers.comm.adhoc", lang),
    trips: formatNum(l.trips),
    amount: formatSar(l.amount),
  }));

  const itemRows: PayoutDocItem[] = (snap?.items ?? []).map((it: SnapItem) => {
    const denied = it.status === "denied";
    return {
      // A BONUS IS FORCED, not defaulted: a bonus line is synthesised from the
      // cycle row and can never carry a user label, so the "Bonus" in every
      // pre-existing snapshot is known to be our own word. A special or an
      // adjustment might be what somebody typed, so those only translate on
      // payouts frozen from here on. The screen's rule, character for
      // character.
      label:
        it.kind === "bonus"
          ? t("drivers.comm.itemName.bonus", lang)
          : it.label || t(`drivers.comm.itemName.${it.kind}`, lang),
      reason:
        denied && it.deny_reason
          ? fill(t("drivers.hist.deniedReason", lang), { reason: it.deny_reason })
          : null,
      kind: t(`drivers.comm.kind.${it.kind}`, lang),
      status: denied ? t("drivers.comm.denied", lang) : t("drivers.comm.approved", lang),
      denied,
      amount: formatSar(it.amount),
    };
  });

  return {
    lang,
    rtl: lang === "ar",
    // The modal's own heading, reused rather than restated — see the leaf's
    // comment in lib/i18n.ts.
    docTitle: fill(t("drivers.hist.payoutOf", lang), { name: driverName }),

    masthead: {
      eyebrow: t("drivers.hist.doc.eyebrow", lang),
      eyebrowEnd: input.payoutNo
        ? {
            label: t("drivers.hist.doc.payoutNo", lang),
            value: input.payoutNo,
            num: true,
          }
        : null,
      title: driverName,
      // The Arabic name under the Latin one, exactly where the screen puts it
      // and only when the snapshot froze one.
      subtitle: snap?.nameAr || null,
      meta,
      figure: {
        caption: t("drivers.hist.statTotalPaid", lang),
        // The separator and rounding formatSar gives, without its suffix: the
        // unit has its own slot on a masthead figure and printing it twice
        // would read as part of the number.
        //
        // ZERO DECIMALS, which is formatSar's own `maximumFractionDigits: 0` —
        // not formatSarExact's two. The Total box lower down the sheet is
        // written by formatSar, and a masthead reading 1,443.85 over a stat
        // reading 1,444 SAR is the same figure twice in two precisions.
        value: formatNum(payout.total_sar),
        unit: t("drivers.hist.doc.figureUnit", lang),
      },
    },

    // FROM THE ROW'S COLUMNS, never from the tables — see the header.
    stats: [
      { label: t("drivers.comm.base", lang), value: formatSar(payout.base_sar) },
      { label: t("drivers.comm.specials", lang), value: formatSar(payout.specials_sar) },
      { label: t("drivers.comm.adjustments", lang), value: formatSar(payout.adjustments_sar) },
      { label: t("drivers.comm.bonus", lang), value: formatSar(payout.bonus_sar) },
      { label: t("drivers.comm.total", lang), value: formatSar(payout.total_sar) },
    ],

    base: {
      head: t("drivers.hist.baseHeading", lang),
      cols: {
        project: t("drivers.comm.project", lang),
        trips: t("drivers.comm.trips", lang),
        amount: t("drivers.comm.amount", lang),
      },
      rows: baseRows,
      empty: t("drivers.hist.noBaseTrips", lang),
    },

    items: {
      head: t("drivers.hist.items", lang),
      cols: {
        item: t("drivers.hist.thItem", lang),
        type: t("common.type", lang),
        status: t("common.status", lang),
        amount: t("drivers.comm.amount", lang),
      },
      rows: itemRows,
      empty: t("drivers.hist.noItems", lang),
      // The pill's own word, in the gutter. Same word, different device.
      deniedFlag: t("drivers.comm.denied", lang),
    },

    // NEW ON PAPER, and the one block here that mirrors nothing: a modal is
    // read, a voucher is handed over and signed for.
    signature: fill(t("drivers.hist.doc.signatureLine", lang), {
      role: t("drivers.hist.doc.receivedBy", lang),
    }),

    footer: [fill(t("drivers.hist.doc.generated", lang), { date: generated }), COMPANY],
  };
}
