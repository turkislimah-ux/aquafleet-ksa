// PAYSLIP VIEW-MODEL — ONE DRIVER, ONE MONTH: what the printed slip says, in
// what order, and in which words.
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING may
//   not.
//
// The source of truth is `PayslipDocument` in app/reports/StatementViews.tsx:
// its head, its two exception callouts, its seven-row earnings table, the
// unabsorbed caveat, the fines itemisation and the commission provenance.
//
// ==========================================================================
// THE `f` BRANCH IS MOVED, NOT RE-DERIVED — AND THAT IS THE POINT
// ==========================================================================
// A payslip has TWO sources that are never blended: an ISSUED month reads every
// figure off `driver_payslips` (frozen at issue), an unissued one reads the same
// eleven off the basis view. The screen picks between them ONCE, in a single
// ternary, and every figure below it reads `f.*`.
//
// That ternary is copied here VERBATIM. Re-deriving it — "issued means read the
// doc, so read doc.net_sar here and row.net_sar there" — is how a sheet ends up
// with a frozen net over a live deduction. One branch, one place, eleven fields.
//
// `buildDocFines` moves whole for the same reason. It was already a view-model
// living in a component: two sources, one flattened shape, no JSX in it. The
// only thing left behind is `imagePath` and `locked`, which exist to drive
// SCREEN CONTROLS — a photo button and an edit gate. Paper has neither.
//
// ==========================================================================
// WHAT THE SCREEN CARRIES IN HUE, AND WHAT BECOMES OF IT
// ==========================================================================
//   * THE BASIS CHIP beside Commission is emerald for paid and amber for
//     earned; in grayscale it is two identical grey pills. It becomes the kit's
//     STATUS MARK — solid for paid out, dashed for merely earned — which is a
//     BINARY, which is exactly what the mark is for. The chip's WORD is
//     unchanged; only the hue is replaced. The register does the same to the
//     same chip, so the two documents agree.
//   * THE PAYMENT CHIP is a binary too (did the driver settle with the
//     authority?) and takes a mark. Its third state is not a third colour but
//     the ABSENCE of a record, and it prints as the screen's own em dash.
//   * THE SETTLEMENT CHIP is THREE-state — deducted / partial / unsettled — so
//     it is solid only for deducted and dashed for both others, with the WORD
//     carrying which. That is the same reading the register gives its four
//     unissued status words: dashed says "this did not happen", the word says
//     what did.
//   * THE UNABSORBED CALLOUT is an amber panel, and the amber IS the finding.
//     It becomes the severity GUTTER WORD (`reports.doc.payslip.unrecovered`),
//     which is the kit's device for exactly this and the one thing on the sheet
//     that survives a photocopier. The panel's sentence prints unchanged, all
//     three figures included.
//   * THE TWO EXCEPTION CALLOUTS (blocked, not-yet-issued) are amber and brand
//     tinted. On paper they are one note under the masthead — a standfirst —
//     because that is where the screen puts them and a tint says nothing a
//     position does not.
//
// ==========================================================================
// THE TITLE SAYS WHAT IT IS; THE MARK SAYS WHETHER IT HAPPENED
// ==========================================================================
// The screen heads an unissued month "Payslip (not issued)" — one dictionary
// leaf, parenthetical and all. Here the two halves separate: the title is
// `payslipWord` and the state is a DASHED MARK on the masthead's trailing edge,
// reading `statusNotIssued` — the register's own word for the same fact about
// the same driver-month.
//
// No word is added or dropped: "Payslip" + "Not issued" is "Payslip (not
// issued)" with the parentheses spent on the kit's device instead of on
// punctuation. What it buys is that a filed sheet states its own status on its
// FACE, in the slot every other document in the pack uses for that (see
// `Masthead.marks`), rather than inside a heading a reader skims.
//
// Turki can overrule this at review: the alternative is `payslipNotIssued` as
// the title and no mark, which is one line here and one line in the renderer.
//
// ==========================================================================
// NET PAY IS PRINTED TWICE, DELIBERATELY
// ==========================================================================
// Once as the masthead FIGURE and once as the ledger's closing line. They are
// not the same statement: the figure is what this document is FOR — the number
// a driver looks for before reading anything — and the ledger line is the last
// step of the arithmetic that reaches it. Dropping the figure would make the
// one sheet in the pack that leads with nothing; dropping the line would leave
// six additions and a subtraction that close on nothing.
//
// ==========================================================================
// WHAT IS SHED, AND WHY NONE OF IT IS A DEVIATION
// ==========================================================================
// The issue button, the confirm panel, the Actions column, the inline fine
// editor, the photo controls and the void panel are all `no-print` on screen
// ALREADY, or are controls rather than content. A document that instructs
// nobody to click anything loses nothing by not drawing the buttons. The
// `issuedBy` line goes with them — it sits in the same no-print row.
//
// Purity: no React, no fs, no Supabase, no `process`, no `new Date()` —
// `generatedAt` is passed in, so the same input always renders the same sheet.

import { arText, fill, personNameById, plural, t, type Lang } from "../i18n";
import type { IssuedPayslipRow, PayslipBasisRow } from "../reports";
import {
  inMonth,
  violationTypeLabel,
  type DriverViolationView,
  type ViolationType,
} from "../violations";
import {
  formatDateLang,
  formatNum,
  formatSar,
  formatSarExact,
  monthLabel,
} from "../utils";
import { DOC_COMPANY, docGeneratedMeta } from "./reportDoc";
import { bankLabel } from "../bank-codes";

// ---------------------------------------------------------------------------
// Input — exactly what the component holds
// ---------------------------------------------------------------------------

export type PayslipDocInput = {
  lang: Lang;
  generatedAt: Date;
  /** The month's basis row — the live figures, and the driver's identity. */
  row: PayslipBasisRow;
  /** The frozen document, when one exists. Its figures win wherever it does. */
  doc: IssuedPayslipRow | null;
  /** This driver's LIVE fines, every month of them. Read ONLY when `doc` is null. */
  violations: readonly DriverViolationView[];
  /** Every type, active and retired — a historical fine still needs its name. */
  violationTypes: readonly ViolationType[];
  /**
   * Is the month still running? The component's own prop, passed through rather
   * than re-derived from a date here: this file computes no "today".
   */
  running: boolean;
  /**
   * Where the money goes (0202) — resolved by resolvePayslipBank, LIVE from
   * the driver, NEVER from the snapshot. The ONE exception to the freeze rule
   * above, deliberately: every money figure states what WAS owed, but this
   * line answers "where do we send it", and a driver who changed banks must
   * see the new account on a reprint of an old slip. Null when either half of
   * the pair is missing — the resolver owns that rule.
   */
  bank: PayslipBankLine | null;
  /**
   * The drivers the PAGE already fetched (id, name, name_ar) — threaded in so
   * the sheet writes the driver's name in ITS OWN language through
   * personNameById. LIVE like the bank line, and for the same reason: the name
   * answers "who is this person", not "what was owed". The basis row's
   * prejoined `driver_name` stays the fallback.
   */
  driverNames: readonly { id: string; name: string; name_ar?: string | null }[];
};

/**
 * The bank pair as ONE value: the bank's 4-letter key, both spellings of its
 * name (the reader's language is picked at render, via bankLabel), and the
 * IBAN. Existing at all means BOTH halves are present — see resolvePayslipBank.
 */
export type PayslipBankLine = {
  key: string;
  label: string;
  label_ar: string;
  iban: string;
};

/**
 * THE PAIR RULE, IN ONE PLACE. A bank without an account, or an account
 * without a bank, renders as NOTHING — not a dash, not a blank label: on a
 * document someone takes to a teller, half a routing line reads as data. The
 * screen header and the printed masthead both call this, so they cannot
 * disagree about whether the pair is shown.
 *
 * `bankCodes` must be ALL rows, retired included — a driver still pointing at
 * a retired bank keeps its name (the 0201 lookup rule). An id that resolves
 * to NO row at all is treated as missing, same as no id.
 */
export function resolvePayslipBank(
  driver: { bank_code_id: string | null; iban: string | null } | null | undefined,
  bankCodes: readonly { id: string; key: string; label: string; label_ar: string }[],
): PayslipBankLine | null {
  if (!driver || !driver.bank_code_id || !driver.iban) return null;
  const bank = bankCodes.find((b) => b.id === driver.bank_code_id);
  if (!bank) return null;
  return { key: bank.key, label: bank.label, label_ar: bank.label_ar, iban: driver.iban };
}

// ---------------------------------------------------------------------------
// Output — one worded object per ATLAS block, and no ATLAS types in it
// ---------------------------------------------------------------------------

/** One earnings line. The seven of them are the screen's seven rows. */
export type PayslipDocLine = {
  label: string;
  /**
   * ALREADY FORMATTED, minus sign included. The Deductions line is the only one
   * that subtracts, and it carries U+2212 in front of its digits as ONE string:
   * split from them it would be reordered on an Arabic sheet and print on the
   * wrong end of the amount, which is the single worst typo available here.
   */
  value: string;
  /** The basis chip, taken apart into its word and its binary. Commission only. */
  mark?: { word: string; on: boolean };
  /** The muted qualifier the screen sets beside the Deductions label. */
  sub?: string;
  /** Closes the arithmetic: rule above. Net pay only. */
  rule?: boolean;
  /** The figure the document exists to state. Net pay only. */
  strong?: boolean;
};

/** One fine, as the sheet prints it. `DocFine` minus the two screen-only fields. */
export type PayslipDocFine = {
  label: string;
  ref: string;
  amount: string;
  date: string;
  /**
   * Did the DRIVER settle it with the authority? NULL when the record does not
   * say — which is not "unpaid", and prints as the screen's own em dash.
   */
  payment: { word: string; paid: boolean } | null;
  /**
   * What PAYROLL did with it. A different question, always answered. Three
   * states, so `deducted` is the binary and the WORD carries the other two
   * apart.
   */
  settlement: { word: string; deducted: boolean };
};

export type PayslipDocVm = {
  lang: Lang;
  rtl: boolean;
  /** The print dialog's name for the sheet. Never printed on it. */
  docTitle: string;

  masthead: {
    eyebrow: string;
    title: string;
    subtitle: string;
    meta: { label: string; value: string; num?: boolean }[][];
    /** Present ONLY on an unissued month. See the header. */
    marks?: readonly { label: string; on: boolean }[];
    figure: { caption: string; value: string; unit: string };
  };

  /**
   * The one sentence under the masthead: why the month is not issued, or why it
   * cannot be. Null on an issued document, which needs no explanation.
   */
  standfirst: string | null;

  /** The earnings ledger, in the screen's order. Always seven lines. */
  lines: readonly PayslipDocLine[];

  /**
   * The no-carry caveat, with its severity word. Null unless the month's fines
   * outran the pay.
   */
  caveat: { text: string; flag: string } | null;

  fines: {
    head: string;
    /** Where the list came from — frozen or live. Null when there are none. */
    source: string | null;
    /**
     * The sentence that stands in for the table when there are none. The screen
     * renders this section EVEN THEN, on purpose: an absent section is ambiguous
     * — no fines, or fines not shown? — and this sheet is handed to the person
     * whose pay they came out of.
     */
    none: string | null;
    cols: {
      type: string;
      ref: string;
      amount: string;
      date: string;
      payment: string;
      settlement: string;
    };
    rows: readonly PayslipDocFine[];
    /**
     * What was CLAIMED this month, not what was taken. The taken figure is the
     * Deductions line above, and when the two differ the caveat has already
     * said why.
     */
    foot: { label: string; total: string } | null;
  };

  /** Commission provenance. Null unless the block was settled by real payouts. */
  payouts: {
    head: string;
    rows: readonly { date: string; period: string; total: string }[];
    /** The trips those payouts covered. Null when the snapshot counted none. */
    covers: string | null;
  } | null;

  /** The closing qualifications, in the screen's order. Empty when neither applies. */
  notes: readonly string[];

  footer: readonly string[];
};

// ---------------------------------------------------------------------------
// The fines, flattened — `buildDocFines`, promoted
// ---------------------------------------------------------------------------

/**
 * ONE FINE, AS THE PAYSLIP SHOWS IT — the shape both sources are flattened to.
 *
 * Deliberately NOT DriverViolationView. That type carries `voided_at`,
 * `created_by` and the operator's private `note`, and the frozen snapshot
 * carries none of them; typing this table as the live row would leave three
 * fields that are meaningful in one branch and absent in the other, which is
 * how the two branches start rendering differently. This is the intersection.
 *
 * THE NOTE IS OMITTED ON PURPOSE. It is an internal remark between operators;
 * this document gets handed to the person the remark is about.
 */
type DocFine = {
  label: string;
  ref: string;
  amount: number;
  date: string;
  paid: boolean | null;
  state: "deducted" | "partial" | "unsettled";
};

/**
 * TWO SOURCES, NEVER BLENDED — the same rule the money figures follow.
 *
 * ISSUED MONTH → the payslip's own frozen snapshot. Not the live table: a fine
 * can be voided, re-priced or re-typed after issue, and a document must keep
 * saying what it said the day it was handed over.
 *
 * UNISSUED MONTH → live rows, narrowed with inMonth(), which is the SAME
 * half-open [start, next) window v_driver_payslip_basis sums with. A different
 * window here is the one way this table could itemise a set of fines that is
 * not the set the Deductions line was computed from.
 *
 * The frozen branch's settlement is a MONTH-LEVEL fact applied to every item,
 * because absorption has no per-fine share: the payslip clamps the whole month's
 * claim against the pay, so "which of these three was the one that did not fit"
 * has no answer. Saying `partial` on each is the honest reading.
 */
function docFines(input: {
  doc: IssuedPayslipRow | null;
  live: readonly DriverViolationView[];
  typeById: Map<string, ViolationType>;
  periodStart: string;
  lang: Lang;
}): DocFine[] {
  const { doc, live, typeById, periodStart, lang } = input;

  if (doc) {
    // ORDER LEFT EXACTLY AS FROZEN. issue_driver_payslip aggregates its items
    // `order by dv.violation_date, dv.ref_no` — oldest first — and re-sorting
    // here would make the printed sheet disagree with the record it was printed
    // from. The live branch below is sorted to MATCH this, not the reverse.
    const items = doc.snapshot?.violations?.items ?? [];
    // deductions_sar is what the pay actually absorbed; unabsorbed_sar is what
    // it could not. Zero absorbed is NOT "partly deducted" — nothing was taken,
    // and the month is as unsettled as one that was never issued.
    const state: DocFine["state"] =
      doc.deductions_sar <= 0
        ? "unsettled"
        : doc.unabsorbed_sar > 0
          ? "partial"
          : "deducted";
    return items.map((it) => ({
      // BOTH LABELS WERE FROZEN, so a type renamed or retired since issue still
      // prints the name that was on the sheet. arText picks the current reader's
      // language out of the pair the document itself stored.
      label: arText(it.type_label ?? "", it.type_label_ar ?? "", lang) || "—",
      ref: it.ref_no,
      amount: it.amount_sar,
      date: it.violation_date,
      // A string column, so it is tested for the one value that means paid
      // rather than trusted to be a boolean. Absent reads as unknown, not unpaid.
      paid: it.payment_status == null ? null : it.payment_status === "paid",
      state,
    }));
  }

  return live
    .filter((v) => inMonth(v, periodStart))
    // RE-SORTED, and this is the one place in the app that re-sorts these.
    // buildViolationViews hands them over NEWEST-first, which is right for the
    // drivers screen. A payslip is not a feed: it is the document the preview
    // literally becomes, and issue_driver_payslip freezes oldest-first. Leaving
    // the two in different orders would mean the sheet visibly reshuffles the
    // moment it is issued, with no figure having changed. Same tiebreak as the
    // RPC so two fines on one day cannot swap between preview and document.
    .slice()
    .sort((a, b) =>
      a.violation_date === b.violation_date
        ? a.ref_no.localeCompare(b.ref_no)
        : a.violation_date < b.violation_date
          ? -1
          : 1,
    )
    .map((v) => ({
      label: violationTypeLabel(typeById.get(v.violation_type_id), lang),
      ref: v.ref_no,
      amount: v.amount_sar,
      date: v.violation_date,
      paid: v.payment_status === "paid",
      state: v.settlement.state,
    }));
}

// ---------------------------------------------------------------------------

export function buildPayslipVm(input: PayslipDocInput): PayslipDocVm {
  const { lang, row, doc } = input;

  // THE SHEET'S LANGUAGE PICKS THE NAME — see `driverNames` on the input.
  const driverDisplayName =
    personNameById(input.driverNames, lang).get(row.driver_id) ?? row.driver_name;
  const generated = formatDateLang(input.generatedAt, lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // BOTH BRANCHES READ THE SAME ELEVEN FIGURES, and the branch is the screen's
  // own — copied, not re-derived. See the header.
  const f = doc
    ? {
        salary: doc.base_salary_sar,
        commission: doc.commission_sar,
        specials: doc.specials_sar,
        adjustments: doc.adjustments_sar,
        bonus: doc.bonus_sar,
        deductions: doc.deductions_sar,
        net: doc.net_sar,
        claim: doc.violation_deduction_sar,
        unabsorbed: doc.unabsorbed_sar,
        basis: doc.commission_basis,
        settled: doc.commission_settled,
      }
    : {
        salary: row.base_salary_sar,
        commission: row.commission_sar,
        specials: row.specials_sar,
        adjustments: row.adjustments_sar,
        bonus: row.bonus_sar,
        deductions: row.deductions_sar,
        net: row.net_sar,
        claim: row.violation_deduction_sar,
        unabsorbed: row.unabsorbed_sar,
        basis: row.commission_basis,
        settled: row.commission_settled,
      };

  // The earnings table is written by `formatSar` on screen — whole riyals, unit
  // on the figure. The fines table is `formatSarExact` and says why in its own
  // comment: its rows are supposed to add up to the total underneath them, and
  // three amounts rounded down make a column that visibly does not.
  const money = (n: number) => formatSar(n);

  const month = monthLabel(row.period_start, lang);

  const typeById = new Map<string, ViolationType>();
  for (const vt of input.violationTypes) typeById.set(vt.id, vt);

  const fines = docFines({
    doc,
    live: input.violations,
    typeById,
    periodStart: row.period_start,
    lang,
  });
  const finesTotal = fines.reduce((s, x) => s + x.amount, 0);

  // The chip's own test, verbatim: a basis of "paid" that has actually settled.
  // Anything else is an accrual, however it got there.
  const paidOut = f.basis === "paid" && f.settled;

  const blocked = row.hire_date_missing || input.running;

  const lines: PayslipDocLine[] = [
    { label: t("reports.payslips.basicSalary", lang), value: money(f.salary) },
    {
      // Commission and Adjustments are the SAME words the cost statement uses
      // for the same money — reports.th.commission and reports.costs.adjustments,
      // not payslip-local copies.
      label: t("reports.th.commission", lang),
      value: money(f.commission),
      mark: {
        word: t(
          paidOut
            ? "reports.payslips.chipPaid"
            : "reports.payslips.chipEarned",
          lang,
        ),
        on: paidOut,
      },
    },
    {
      label: t("reports.payslips.specialPayments", lang),
      value: money(f.specials),
    },
    { label: t("reports.costs.adjustments", lang), value: money(f.adjustments) },
    { label: t("reports.payslips.bonus", lang), value: money(f.bonus) },
    {
      label: t("reports.payslips.deductions", lang),
      // THE ONE ROW THAT SUBTRACTS. Every line above it adds, so it is the only
      // place a reader can be misled about direction. The sign and the digits
      // are ONE string for the reason on PayslipDocLine.value.
      value: f.deductions > 0 ? `−${money(f.deductions)}` : money(0),
      ...(f.deductions > 0
        ? { sub: t("reports.payslips.deductionsSource", lang) }
        : {}),
    },
    {
      label: t("reports.payslips.netPay", lang),
      value: money(f.net),
      rule: true,
      strong: true,
    },
  ];

  const payoutRows = doc?.snapshot?.payouts ?? [];
  const covered = doc?.snapshot?.covered_trips;

  const notes: string[] = [];
  // The branch tests the BASIS ENUM, not the chip's words. No space before the
  // "after" fragment — it opens with its own full stop.
  if (f.basis !== "paid") {
    notes.push(
      `${t("reports.payslips.earnedNoteBefore", lang)} ` +
        `${t("reports.payslips.earnedNoteStrong", lang)}` +
        `${t("reports.payslips.earnedNoteAfter", lang)}`,
    );
  }
  if (row.salary_missing) notes.push(t("reports.payslips.noSalaryRecorded", lang));

  return {
    lang,
    rtl: lang === "ar",
    // `{d}` and `{m}`, never the payslip number: an unissued slip has none, and
    // a dialog title reading "Payslip —" with nothing after it is worse than one
    // that never promised a number.
    docTitle: fill(t("reports.doc.payslip.docTitle", lang), {
      d: driverDisplayName,
      m: month,
    }),

    masthead: {
      eyebrow: DOC_COMPANY,
      title: doc
        ? `${t("reports.payslips.payslipWord", lang)} ${doc.payslip_number}`
        : t("reports.payslips.payslipWord", lang),
      // The driver's name follows the SHEET'S language — resolved above from
      // the page's own driver rows, with the basis row's prejoined name as the
      // fallback. The month beside it too: a month name is a label and
      // monthLabel writes it in the reader's language. The middot is the
      // screen's own.
      subtitle: `${driverDisplayName} · ${month}`,
      // The bank pair sits FIRST, directly under the driver's name — it is
      // about him; "generated" is about the sheet. One line, two pairs, and
      // `num: true` on the IBAN so "SA03…" never reorders on an Arabic sheet.
      // No line at all when the pair is incomplete — resolvePayslipBank's rule.
      meta: [
        ...(input.bank
          ? [[
              {
                label: t("shared.bank.fBank", lang),
                // "KEY · name" — bankLabel is the one spelling of a bank on
                // every surface (lib/bank-codes.ts); the sheet composes nothing.
                value: bankLabel(input.bank, lang),
              },
              {
                label: t("shared.bank.fIban", lang),
                value: input.bank.iban,
                num: true,
              },
            ]]
          : []),
        [docGeneratedMeta(lang, generated)],
      ],
      ...(doc
        ? {}
        : {
            marks: [
              { label: t("reports.payslips.statusNotIssued", lang), on: false },
            ],
          }),
      figure: {
        caption: t("reports.payslips.netPay", lang),
        // The separator and rounding `formatSar` gives, without its suffix: the
        // unit has its own slot on a masthead figure, and printing it twice
        // would read as part of the number.
        value: formatNum(f.net),
        unit: t("reports.doc.figureUnit", lang),
      },
    },

    // THE SCREEN'S TWO CALLOUTS, AS ONE SLOT. They are mutually exclusive there
    // — `!doc && blocked` and `!doc && !blocked` — so they are one sentence
    // here. `confirming` is screen state and is false on paper by definition:
    // nobody confirms an issue from a printed sheet.
    standfirst: doc
      ? null
      : blocked
        ? row.hire_date_missing
          ? t("reports.payslips.blockedNoHire", lang)
          : t("reports.payslips.blockedRunning", lang)
        : `${t("reports.payslips.notIssuedBefore", lang)} ` +
          `${t("reports.payslips.notIssuedStrong", lang)} ` +
          `${t("reports.payslips.notIssuedAfter", lang)}`,

    lines,

    caveat:
      f.unabsorbed > 0
        ? {
            // f.unabsorbed is the view's own column, not a subtraction done
            // here. The sentence is a RECORD of what went unrecovered, not a
            // debt this document collects or hands to next month.
            text: fill(t("reports.payslips.unabsorbedNote", lang), {
              claim: money(f.claim),
              taken: money(f.deductions),
              left: money(f.unabsorbed),
            }),
            flag: t("reports.doc.payslip.unrecovered", lang),
          }
        : null,

    fines: {
      head: t("reports.payslips.violTitle", lang),
      source: fines.length
        ? t(
            doc ? "reports.payslips.violFrozen" : "reports.payslips.violLive",
            lang,
          )
        : null,
      none: fines.length ? null : t("reports.payslips.violNone", lang),
      cols: {
        type: t("common.type", lang),
        ref: t("reports.payslips.violThRef", lang),
        amount: t("common.amount", lang),
        date: t("common.date", lang),
        payment: t("reports.payslips.violThPayment", lang),
        settlement: t("reports.payslips.violThSettlement", lang),
      },
      rows: fines.map((x) => ({
        label: x.label,
        ref: x.ref,
        amount: formatSarExact(x.amount),
        date: x.date,
        payment:
          x.paid === null
            ? null
            : {
                word: t(
                  x.paid ? "drivers.viol.paid" : "drivers.viol.notPaid",
                  lang,
                ),
                paid: x.paid,
              },
        settlement: {
          word: t(
            x.state === "deducted"
              ? "drivers.viol.stDeducted"
              : x.state === "partial"
                ? "drivers.viol.stPartial"
                : "drivers.viol.stUnsettled",
            lang,
          ),
          deducted: x.state === "deducted",
        },
      })),
      foot: fines.length
        ? {
            label: t("reports.payslips.violTotal", lang),
            total: formatSarExact(finesTotal),
          }
        : null,
    },

    // WHAT THE COMMISSION ACTUALLY IS. A number with no provenance on a document
    // someone is paid against is worth less than no number. Both halves of the
    // screen's gate are kept: a basis of "paid" AND payouts to show for it.
    payouts:
      f.basis === "paid" && payoutRows.length > 0
        ? {
            // `{n}` RAW — the screen interpolates it directly and formatNum
            // would add a separator this line never had. The `one` branch
            // carries no number at all in English ("Settled by payout"), which
            // is exactly the freedom EN[one] has; fill() finds no token.
            head: fill(
              t(`reports.payslips.settledBy.${plural(payoutRows.length)}`, lang),
              { n: payoutRows.length },
            ),
            // `period_label` STAYS ENGLISH, and this site is stricter than the
            // Commission History screen: it is frozen TWICE — pay_commission
            // wrote the caption, and issuing the payslip copied it into the
            // snapshot. paid_at is a raw ISO slice for the same freeze reason.
            rows: payoutRows.map((p) => ({
              date: p.paid_at ? p.paid_at.slice(0, 10) : "—",
              period: p.period_label ?? "—",
              total: money(p.total_sar),
            })),
            covers:
              covered && covered.count > 0 && covered.first_trip
                ? `${fill(
                    t(`reports.payslips.covers.${plural(covered.count)}`, lang),
                    { n: covered.count },
                  )} ${covered.first_trip} – ${covered.last_trip ?? ""}.` +
                  // The earlier-month test compares two DATE PREFIXES, never a
                  // rendered word. The screen bolds the sentence; a printed
                  // sheet ranks by position and this one is already last.
                  (covered.first_trip.slice(0, 7) !== row.period_start.slice(0, 7)
                    ? ` ${t("reports.payslips.earlierMonth", lang)}`
                    : "")
                : null,
          }
        : null,

    notes,

    footer: [
      fill(t("reports.print.generated", lang), { d: generated }),
      DOC_COMPANY,
    ],
  };
}
