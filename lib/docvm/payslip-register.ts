// PAYSLIP-REGISTER VIEW-MODEL — what the printed register says, in what order,
// and in which words.
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING may
//   not.
//
// The source of truth is `PayslipsStatement` in app/reports/StatementViews.tsx:
// its lead line, its seven-column table, its status ladder and its closing note.
//
// ==========================================================================
// TWO DOCUMENTS, NOT ONE, AND THEY NEVER CO-MOUNTED ANYWAY
// ==========================================================================
// On screen the register and the one-driver payslip shared a single print id
// because opening a driver REPLACES the register — they are never both on the
// page, so one whitelist entry covered both. That was an artefact of printing
// the SCREEN. A register is a LIST and a payslip is a DOCUMENT: different
// masthead, different figure, different furniture. They are two view-models
// (this one and ./payslip.ts) and the component picks which to build, exactly
// as it already picks which to render.
//
// ==========================================================================
// THE COUNTS STAY WHOLE SENTENCES — WHY THERE IS NO STAT STRIP
// ==========================================================================
// The screen's lead line is three spans: `{n} payslips`, `{n} issued`, and
// `Total net <figure>`. The first two are stored WHOLE PER COUNT BUCKET because
// Arabic inflects the phrase — the dual `قسيمتا راتب` carries no numeral at all,
// the number is in the word. A stat cell wants a label over a value, so putting
// these on a strip means splitting a phrase that cannot be split in one of the
// two languages, and MINTING the missing half. That is inventing wording, which
// the law above forbids as squarely as dropping it.
//
// So they print as the screen writes them: one line, joined by the screen's own
// middot, exactly as lib/docvm/cost.ts joins its own lead. The THIRD span is the
// one figure that covers the whole sheet, so it goes where every other sheet in
// the pack puts that — the masthead figure, under its own screen label.
//
// ==========================================================================
// WHAT THE SCREEN CARRIES IN HUE, AND WHAT BECOMES OF IT
// ==========================================================================
//   * THE BASIS CHIP is emerald for paid and amber for earned, and in grayscale
//     it is two identical grey pills. It becomes the kit's STATUS MARK — solid
//     for paid, dashed for earned — which is the one categorical device that
//     survives a photocopier, and it is a BINARY, which is what the mark is for.
//     The chip's WORD is unchanged; only the hue is replaced.
//   * THE STATUS CELL is five-way on screen but binary in fact: either a payslip
//     EXISTS, and the cell is its number, or it does not, and the cell says why.
//     A number is an identifier and prints as one (isolated, never a slug); the
//     four reasons print as a DASHED mark, because dashed is the kit's word for
//     "this did not happen".
//   * THE TERMINATED TOOLTIP (`leftOn` / `leftOnNoHire`) does not print. A
//     tooltip is not printed wording — the P&L settled that for
//     `reports.th.uncosted` and the daily sheet for its unpriced chip.
//   * THE ROW IS CLICKABLE on screen. A sheet of paper is not.
//
// ==========================================================================
// THE TOTALS ROW FOOTS THE ONE COLUMN THE SCREEN TOTALS
// ==========================================================================
// The register has no totals row today; the printed one gets NET and nothing
// else. The screen states a net total in words (`Total net`) and the row carries
// that figure under that label, so no figure and no word is new. It does NOT
// total Salary — which the component computes and never shows — and it does NOT
// total Commission, which nothing computes anywhere. Either would be a
// measurement this report has never made, printed as if it had.
//
// Purity: no React, no fs, no Supabase, no `process`, no `new Date()` —
// `generatedAt` is passed in, so the same input always renders the same sheet.

import { fill, plural, t, type Lang } from "../i18n";
import type { IssuedPayslipRow, PayslipBasisRow } from "../reports";
import { formatDateLang, formatNum, formatSar, monthLabel } from "../utils";
import { DOC_COMPANY, docGeneratedMeta } from "./reportDoc";

// ---------------------------------------------------------------------------
// Input — the rows the screen already filtered and sorted
// ---------------------------------------------------------------------------

export type PayslipRegisterDocInput = {
  lang: Lang;
  generatedAt: Date;
  /** The period picker's own label — the masthead's subtitle. Passed through. */
  label: string;
  /**
   * Riyadh today, from the server. Drives ONE thing: whether a month is still
   * running, which is the fourth rung of the status ladder. Passed in rather
   * than read, for the same reason `generatedAt` is.
   */
  today: string;
  /**
   * ALREADY FILTERED TO THE PERIOD AND SORTED — the component's `rows` memo
   * verbatim. Re-filtering here would be a SECOND definition of which months the
   * register covers, and the two would drift the first time one of them changed.
   */
  rows: readonly PayslipBasisRow[];
  /** Every issued payslip in hand. The row's frozen figures win where one exists. */
  issued: readonly IssuedPayslipRow[];
};

// ---------------------------------------------------------------------------
// Output — one worded object per ATLAS block, and no ATLAS types in it
// ---------------------------------------------------------------------------

export type PayslipRegisterDocRow = {
  driver: string;
  month: string;
  salary: string;
  commission: string;
  /**
   * The chip, taken apart into the two things it says: the WORD, and whether it
   * is the settled state. The renderer spends the second on solid-vs-dashed and
   * nothing else — it never re-derives the first from it.
   */
  basis: { word: string; paid: boolean };
  net: string;
  /**
   * Either the payslip NUMBER (`issued`), or the one status word that says why
   * there is none. The ladder is applied here, once, in the screen's order.
   */
  status: { value: string; issued: boolean };
};

export type PayslipRegisterDocVm = {
  lang: Lang;
  rtl: boolean;
  /** The print dialog's name for the sheet. Never printed on it. */
  docTitle: string;

  masthead: {
    eyebrow: string;
    title: string;
    subtitle: string;
    meta: { label: string; value: string; num?: boolean }[][];
    /**
     * ABSENT over an empty register, rather than printing 0 SAR. The screen
     * drops the whole lead line when no row falls in the period — it states no
     * total at all — and a masthead 0 would state one that was never measured.
     */
    figure?: { caption: string; value: string; unit: string };
  };

  /** The two count phrases, joined by the screen's own middot. Null when empty. */
  lead: string | null;

  /**
   * The one sentence that replaces EVERYTHING when no row falls in the period.
   * Null whenever there are rows. The screen drops the lead line, the table and
   * the closing note together, so the sheet does too — a head with no body reads
   * as a rendering failure, and this report has an answer for that case.
   */
  empty: string | null;

  cols: {
    driver: string;
    month: string;
    salary: string;
    commission: string;
    basis: string;
    net: string;
    status: string;
  };

  rows: readonly PayslipRegisterDocRow[];

  /** The net total, under the screen's own name for it. Null when empty. */
  foot: { label: string; net: string } | null;

  /** The closing note. Empty string when there is nothing to qualify. */
  note: string;

  footer: readonly string[];
};

export function buildPayslipRegisterVm(
  input: PayslipRegisterDocInput,
): PayslipRegisterDocVm {
  const { lang, rows } = input;
  const generated = formatDateLang(input.generatedAt, lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // The register's own money format, not the pack's `num2`. Every cell on this
  // table is written by `formatSar` on screen — whole riyals, with the unit on
  // the figure — and rounding it differently here would restate the amounts.
  const money = (n: number) => formatSar(n);

  // A month can only be issued once it has finished. Same expression as the
  // component's, derived from the same `today`.
  const currentMonthStart = input.today.slice(0, 8) + "01";
  const isRunning = (p: string) => p >= currentMonthStart;

  const docFor = (r: PayslipBasisRow): IssuedPayslipRow | undefined =>
    input.issued.find(
      (i) => i.driver_id === r.driver_id && i.period_start === r.period_start,
    );

  // ONE PASS, the component's own reduce. `salary` is summed because the
  // component sums it; it is not printed, for the reason in the header.
  const totals = rows.reduce(
    (acc, r) => {
      const d = docFor(r);
      return {
        salary: acc.salary + (d ? d.base_salary_sar : r.base_salary_sar),
        net: acc.net + (d ? d.net_sar : r.net_sar),
        issued: acc.issued + (d ? 1 : 0),
      };
    },
    { salary: 0, net: 0, issued: 0 },
  );

  const has = rows.length > 0;

  // BOTH COUNTS GO IN RAW, never through a thousands format. The dictionary
  // pins that: the screen interpolates them directly, and a separator here
  // would change a figure rather than translate it.
  const lead = has
    ? [
        fill(t(`reports.payslips.count.${plural(rows.length)}`, lang), {
          n: rows.length,
        }),
        fill(t(`reports.payslips.issuedCount.${plural(totals.issued)}`, lang), {
          n: totals.issued,
        }),
      ].join(" · ")
    : null;

  const docRow = (r: PayslipBasisRow): PayslipRegisterDocRow => {
    // AN ISSUED SLIP'S FROZEN FIGURES WIN, exactly as the cells on screen
    // choose them: a document that exists is what was paid, and a fresh preview
    // of the same month could differ from it.
    const d = docFor(r);
    const commission = d
      ? d.commission_sar + d.specials_sar + d.adjustments_sar + d.bonus_sar
      : r.commission_sar + r.specials_sar + r.adjustments_sar + r.bonus_sar;
    const paid = (d ? d.commission_basis : r.commission_basis) === "paid" &&
      (d ? d.commission_settled : r.commission_settled);

    return {
      driver: r.driver_name,
      month: monthLabel(r.period_start, lang),
      salary: money(d ? d.base_salary_sar : r.base_salary_sar),
      commission: money(commission),
      basis: {
        word: t(
          paid ? "reports.payslips.chipPaid" : "reports.payslips.chipEarned",
          lang,
        ),
        paid,
      },
      net: money(d ? d.net_sar : r.net_sar),
      // THE LADDER, in the screen's order and on the screen's data: an issued
      // number is the strongest fact, then terminated — leaving the company
      // outranks a missing hire date — then a missing hire date, then a month
      // still running. Changing one without the other is how a sheet and the
      // screen start disagreeing about who was paid.
      status: d
        ? { value: d.payslip_number, issued: true }
        : {
            value: r.terminated
              ? t("reports.payslips.statusTerminated", lang)
              : r.hire_date_missing
                ? t("reports.payslips.statusNoHireDate", lang)
                : isRunning(r.period_start)
                  ? t("reports.payslips.statusMonthInProgress", lang)
                  : t("reports.payslips.statusNotIssued", lang),
            issued: false,
          },
    };
  };

  return {
    lang,
    rtl: lang === "ar",
    docTitle: fill(t("reports.doc.payslipRegister.docTitle", lang), {
      p: input.label,
    }),

    masthead: {
      eyebrow: DOC_COMPANY,
      // The statement's own name is the TAB's name — one statement, one
      // spelling, and the screen's head reads the same key.
      title: t("reports.statements.tab.payslips", lang),
      subtitle: input.label,
      meta: [[docGeneratedMeta(lang, generated)]],
      ...(has
        ? {
            figure: {
              caption: t("reports.payslips.totalNet", lang),
              // The separator and rounding `formatSar` gives, without its
              // suffix: the unit has its own slot on a masthead figure, and
              // printing it twice would read as part of the number.
              value: formatNum(totals.net),
              unit: t("reports.doc.figureUnit", lang),
            },
          }
        : {}),
    },

    lead,
    empty: has ? null : t("reports.payslips.empty", lang),

    cols: {
      // `common.driver` and `common.status`, not two more spellings of words
      // this app already keys; the middle five are the same `reports.th.*`
      // leaves the cost and revenue tables read.
      driver: t("common.driver", lang),
      month: t("reports.th.month", lang),
      salary: t("reports.th.salary", lang),
      commission: t("reports.th.commission", lang),
      basis: t("reports.th.basis", lang),
      net: t("reports.th.net", lang),
      status: t("common.status", lang),
    },

    rows: rows.map(docRow),

    foot: has
      ? { label: t("reports.payslips.totalNet", lang), net: money(totals.net) }
      : null,

    note: has ? t("reports.payslips.registerNote", lang) : "",

    footer: [
      fill(t("reports.print.generated", lang), { d: generated }),
      DOC_COMPANY,
    ],
  };
}
