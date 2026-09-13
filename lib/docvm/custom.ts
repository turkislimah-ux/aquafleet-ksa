// CUSTOM REPORT VIEW-MODEL — what the printed builder output says, in what
// order, and in which words.
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING may
//   not.
//
// The source of truth is app/reports/StatementViews.tsx, CustomStatement — which
// itself holds no logic, because every rule about which metrics may be combined
// and how a ratio is computed lives in lib/report-builder.ts. This file holds no
// logic either, for the same reason: `BuiltReport` is ALREADY a view-model, so
// what is left here is resolving its keys and formatting its numbers.
//
// THE ONE STATEMENT WITH NO HEADLINE FIGURE. Every other sheet in the pack
// exists to state a total; this one renders whatever N metrics the reader asked
// for over whatever grouping they chose, and there is no number among them that
// deserves 72px. Inventing one would mean picking a column, which is a claim the
// builder never made. The masthead's `figure` is optional for exactly this case.
//
// THE "CHANGE SELECTION" BUTTON SIMPLY DOES NOT EXIST HERE. It is not dropped
// content — a control is not content. On screen it sits in a `no-print` wrapper,
// which is the same statement made in CSS.
//
// Purity: no React, no fs, no Supabase, no `process`, no `new Date()` —
// `generatedAt` is passed in, so the same input always renders the same sheet.

import { DASH, num2, numPlain } from "../docPrimitives";
import { fill, t, type Lang } from "../i18n";
import { basisLabel, formatShare } from "../reports";
import type { BuiltReport } from "../report-builder";
import { formatDateLang } from "../utils";
import { DOC_COMPANY, docGeneratedMeta } from "./reportDoc";

// ---------------------------------------------------------------------------
// Input — the report the builder already assembled
// ---------------------------------------------------------------------------

export type CustomDocInput = {
  lang: Lang;
  generatedAt: Date;
  /** The period line, composed by the builder and passed through untouched —
   *  it is content, not chrome the document writes. */
  title: string;
  report: BuiltReport;
};

// ---------------------------------------------------------------------------
// Output — one worded object per ATLAS block
// ---------------------------------------------------------------------------

export type CustomDocVm = {
  lang: Lang;
  rtl: boolean;
  /** The print dialog's name for the sheet. Never printed on it. */
  docTitle: string;

  masthead: {
    eyebrow: string;
    title: string;
    subtitle: string;
    meta: { label: string; value: string; num?: boolean }[][];
  };

  table: {
    /** BLANK, and deliberately — see the comment at the assignment. */
    labelHead: string;
    /** One per metric: the name, and the basis that qualifies it. */
    cols: readonly { head: string; sub: string }[];
    rows: readonly { label: string; values: readonly string[] }[];
  };

  /**
   * Printed INSTEAD of the table, and there are TWO of them because the screen
   * distinguishes two different nothings: a selection with no metrics in it, and
   * a selection whose metrics matched no data. `null` when the table prints.
   */
  empty: string | null;

  /** The builder's own notes, already translated, then the statement's. */
  notes: readonly string[];
  footer: readonly string[];
};

export function buildCustomVm(input: CustomDocInput): CustomDocVm {
  const { lang, report } = input;
  const generated = formatDateLang(input.generatedAt, lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // THE SAME THREE BRANCHES THE SCREEN TAKES, off the same `unit` enum. A null
  // is an em dash, never a zero: the builder returns null where a metric does
  // not apply to a row, which is not the same claim as "it measured nothing".
  const value = (v: number | null, unit: BuiltReport["columns"][number]["unit"]): string =>
    v === null
      ? DASH
      : unit === "percent"
        ? formatShare(v)
        : unit === "count"
          ? numPlain(v)
          : num2(v);

  const hasTable = report.columns.length > 0 && report.rows.length > 0;

  return {
    lang,
    rtl: lang === "ar",
    docTitle: fill(t("reports.doc.custom.docTitle", lang), { p: input.title }),

    masthead: {
      eyebrow: DOC_COMPANY,
      title: t("reports.custom.title", lang),
      subtitle: input.title,
      meta: [[docGeneratedMeta(lang, generated)]],
    },

    table: {
      // A BLANK HEAD, exactly as on screen (`<TH>{" "}</TH>`), and for the same
      // reason: the rows sit under a subtitle that already says what they are.
      // The CSV names the grouping here because a file has no title beside its
      // header row — a SHEET does, printed two lines up, so naming it again
      // would put a word on the paper the screen never wrote.
      labelHead: "",
      cols: report.columns.map((c) => ({
        // The column carries a KEY, not a label: report-builder resolved the
        // metric to `labelKey` so the heading and the builder's own picker
        // cannot drift apart.
        head: t(c.labelKey, lang),
        // basisLabel(), the same helper the picker, the glossary and the screen
        // read — never the raw enum, which an Arabic reader would get as `cash`.
        sub: basisLabel(c.basis, lang),
      })),
      // `values` is already in `columns` order, so the index that formats a cell
      // is the index that found its column. One ordered list, rebuilt wholesale
      // by the builder.
      rows: report.rows.map((r) => ({
        label: r.label,
        values: r.values.map((v, i) => value(v, report.columns[i].unit)),
      })),
    },

    empty: hasTable
      ? null
      : report.columns.length === 0
        ? t("reports.custom.noColumns", lang)
        : t("reports.custom.noMatch", lang),

    // The builder's notes arrive already translated — buildReport takes `lang`
    // and composes them from reports.builder.note.*. The statement's own note
    // follows them, in the order the screen prints the two.
    notes: [...report.notes, t("reports.custom.note", lang)],
    footer: [fill(t("reports.print.generated", lang), { d: generated }), DOC_COMPANY],
  };
}
