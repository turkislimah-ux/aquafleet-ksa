"use client";

// Reports — the METRICS DICTIONARY, as a popup.
//
// THE SEMANTIC LAYER, READ RATHER THAN COUNTED. Every figure on the Overview
// tab comes from a metric that is REGISTERED once, in SQL (report_metrics,
// migration 0098, extended by 0123/0124/0187). This modal renders that registry
// — it computes nothing — and it is the only screen in the app that shows a
// metric's meaning / formula / grain / source_view / basis / caveat at all.
// Those were fetched and threaded through two components for a year and
// rendered nowhere, which is the exact failure mode CLAUDE.md §7 records for
// DailyOps.revenue: a field nothing displays is a field nobody can check.
//
// THE ROWS COME FROM THE TABLE; THE WORDS COME FROM lib/i18n (0187). The table
// answers WHICH METRICS EXIST and what shape each one is — metric_key, basis,
// unit, grain-as-a-machine-value, source_view. The prose a reader actually
// reads — label, meaning, formula, grain, caveat, in both languages — is app
// copy and lives in `reports.metricDef.<metric_key>`, reached through
// metricLabel() / metricText() in lib/reports. So this file reads a row for its
// STRUCTURE and a key for its WORDS, and `metric_key` is the join.
//
// IT SHIPPED AS A SECTION AT THE BOTTOM OF OVERVIEW AND WAS MOVED HERE
// (Turki's call). Recorded so the next reader does not "restore" it inline:
// 30 metrics is a long read, and parking it under the charts meant scrolling
// past the whole tab to reach a reference you consult mid-thought. A popup is
// reachable from the header at any scroll position and costs the tab no space.
//
// LAYOUT IS STACKED, NOT A GRID TABLE, and that is a measurement not a taste.
// Re-measured 2026-09-08 across BOTH languages, off the metricDef keys and the
// live table, since 0187 nearly doubles the prose this screen carries. Longest
// value per field, en / ar: caveat 785 / 700 (delivered_revenue_daily), formula
// 317 / 318 (running_balance — was 208 before 0187), meaning 118 / 122
// (amount_payable), grain 35 / 30, label 32 / 30. source_view is 169 and has no
// Arabic side — it is a pointer. Six columns of that in one row would either
// overflow or shrink every cell to a sliver. Each metric is its own block; the
// label/value pairs use
// `minmax(0,1fr)` on the value track — a plain `1fr` refuses to shrink below
// its content, which is what lets a long unbroken pointer like
// "v_payroll_monthly (…) · v_pnl_by_period.payroll_sar (…)" push past its
// container instead of wrapping. The two-column entry grid below `xl` halves
// the available width, so that rule is load-bearing here, not belt-and-braces.
//
// AN ABSENT caveat RENDERS NOTHING — no dash, no "N/A". Re-measured 2026-09-08:
// 2 of the 33 metrics carry no caveat (operating_profit, os_cost) — this said 3
// and named `operations`, which migration 0145 has since filled. Those metrics
// carry no warning, which is a different claim from a warning we failed to
// load. Same rule as the compliance pills: absent never renders as a value.
// Under 0187 "absent" means NO `caveat` KEY IN EITHER LANGUAGE, not an empty
// string: metricText() returns "" only when all three of its steps miss, and the
// gate below is that same expression, so a metric with no caveat and a metric
// whose caveat key is mistyped look alike here BY DESIGN — which is why
// scripts/metric-copy-check.ts asserts the key set rather than trusting the eye.
//
// EVERY METRIC ROW IS BILINGUAL, AND IT DID NOT TAKE THE MIGRATION THIS COMMENT
// PREDICTED. The paragraph here used to say translating these rows was "a
// MIGRATION, not a dictionary key" — an earlier draft of 0187 duly added
// label_ar / meaning_ar / formula_ar / grain_ar / caveat_ar columns. That draft
// was REPLACED. The app's words live in lib/i18n, and copy split across a
// dictionary and five database columns has two edit paths, two review paths and
// no compiler: `tsc` stops a missing key, nothing stops a missing column value.
//
// SO THERE ARE THREE MECHANISMS ON THIS SCREEN, AND WHICH ONE A FIELD GETS IS
// DECIDED BY WHAT THE FIELD *IS*:
//   · FREE PROSE → a PER-METRIC i18n KEY. label, meaning, formula, grain,
//     caveat are thirty-three metrics' worth of sentences, keyed under
//     `reports.metricDef.<metric_key>` and read through metricText(), which
//     falls through reader's-language → English → the row's own English column,
//     so a metric a future migration registers before its copy is keyed renders
//     English rather than nothing.
//   · A CLOSED ENUM → a PER-VALUE i18n KEY. `basis` (five values) via
//     basisLabel, `unit` (five values, per report_metrics_unit_check) via
//     unitLabel. Keying these per metric would store the same five words
//     thirty-three times and let two rows disagree.
//   · A POINTER → NEITHER. metric_key and source_view stay Latin in both
//     languages. `v_pnl_by_period.payroll_sar` is an address, and a translated
//     address does not resolve.
// Everything else on the popup — chrome, the five basis notes, the three <dt>
// labels — is the app's own words and was already keyed.
//
// FOUR FORMULAS ARE BYTE-IDENTICAL ACROSS en AND ar and that is the translation,
// not a gap: net_profit, operating_cost, operating_profit and
// total_maintenance_per_truck have formulas made entirely of metric names and
// operators (`revenue - operating_cost.`), with no word in them to translate.
//
// TWELVE LABELS ARE NOT KEYED HERE AT ALL — metricLabel() routes them to the
// `reports.metric.*` name the report builder already ships, because one metric
// must not end up with two names on two screens. That map lives in lib/reports;
// this file only ever calls metricLabel().

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { formatNum } from "@/lib/utils";
import { useApp } from "@/components/AppShell";
import { t, fill, plural, type Lang, type TKey } from "@/lib/i18n";
import {
  basisLabel, metricLabel, metricText, unitLabel, type MetricDictionaryRow,
} from "@/lib/reports";
import { Disclosure, EmptyNote } from "./OverviewTab";
import ScrollLock from "@/components/ScrollLock";

/**
 * Reading order — money first, then position, then activity.
 *
 * `settlement` (0185) sits directly after `cash` because that adjacency IS the
 * point being made: the two look alike and are not. An unranked basis sorts
 * last rather than vanishing, so this list is presentation, never a filter.
 */
const BASIS_ORDER = ["accrual", "cash", "settlement", "state", "operational"];

/**
 * The group HEADING for a basis comes from basisLabel() in lib/reports — the
 * same helper the builder's picker and the generated report's column heading
 * read, because all three printed the raw column value before this commit and
 * three copies of one map is how a fourth surface gets a fifth spelling. It
 * falls through to the raw string on a miss, which is what keeps the promise
 * the grouping below makes: an unrecognised basis still appears.
 */

/**
 * What a basis MEANS, beside the group it labels. This is the distinction the
 * report builder is built to protect (migration 0100): accrual and cash measure
 * the same riyal at two different moments, so adding them double-counts. Saying
 * so once here beats hoping the reader knows.
 *
 * The four sentences moved into the dictionary; this map is now the ENUM → key
 * lookup, which is what it always was in substance.
 */
const BASIS_NOTE: Record<string, TKey> = {
  accrual: "reports.glossary.basisNote.accrual",
  cash: "reports.glossary.basisNote.cash",
  settlement: "reports.glossary.basisNote.settlement",
  state: "reports.glossary.basisNote.state",
  operational: "reports.glossary.basisNote.operational",
};

export default function MetricsGlossaryModal({
  open, onClose, metrics,
}: {
  open: boolean;
  onClose: () => void;
  metrics: MetricDictionaryRow[];
}) {
  const { lang } = useApp();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [q, setQ] = useState("");

  // Esc closes. This modal is a reference the reader dips into and out of, so
  // the cheapest possible exit matters more here than on a form.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Grouped by basis. An unrecognised basis still renders — it sorts after the
  // four known ones rather than being dropped, so a metric added by a future
  // migration appears here without this file being touched.
  //
  // THE NEEDLE SEARCHES WHAT IS ON THE SCREEN, PLUS THE POINTERS. It used to
  // concatenate eight DATABASE columns — four English and four Arabic — which
  // was the right shape only while the Arabic lived in columns. It now reads the
  // four prose fields through metricText() in the RENDERED language, because
  // those are the only words the reader can actually see to search for: on the
  // Arabic screen, matching against English prose returns rows whose match is
  // invisible, and on the English screen the reverse. metric_key and source_view
  // are appended raw and unconditionally — they are Latin pointers in BOTH
  // languages (see the header), so an Arabic reader pasting `v_pnl_by_period`
  // must still get a hit. Cost is four key lookups and one concat per row per
  // keystroke, on 33 rows.
  //
  // caveat IS IN THE NEEDLE THOUGH IT IS BEHIND A DISCLOSURE. It is the longest
  // field on the block (785 chars) and the one carrying the warnings worth
  // finding; a filter that skipped it would report "no match" for a sentence the
  // dictionary demonstrably contains, one click away. metricText returns "" for
  // the two metrics that carry none, which concatenates harmlessly.
  //
  // SORTING IS BY THE RENDERED LABEL, WITH THE RENDERED LOCALE. It used to be
  // `a.label.localeCompare(b.label)` — the ENGLISH label, unconditionally, which
  // on the Arabic screen orders a list by keys the reader cannot see. That is an
  // English leak in behaviour rather than in text, and the only kind this pass
  // could have shipped without noticing. metricLabel() is the same helper the
  // entry renders, so the order always matches the words.
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matched = needle
      ? metrics.filter((m) =>
          [metricLabel(m, lang), metricText(m, "meaning", lang),
           metricText(m, "formula", lang), metricText(m, "caveat", lang),
           m.metric_key, m.source_view]
            .filter(Boolean).join(" ").toLowerCase().includes(needle))
      : metrics;

    const by = new Map<string, MetricDictionaryRow[]>();
    for (const m of matched) {
      const arr = by.get(m.basis) ?? [];
      arr.push(m);
      by.set(m.basis, arr);
    }
    const rank = (b: string) => {
      const i = BASIS_ORDER.indexOf(b);
      return i === -1 ? BASIS_ORDER.length : i;
    };
    return Array.from(by.entries())
      .map(([basis, rows]) => ({
        basis,
        rows: rows.slice().sort((a, b) =>
          metricLabel(a, lang).localeCompare(metricLabel(b, lang), lang)),
      }))
      .sort((a, b) => rank(a.basis) - rank(b.basis) || a.basis.localeCompare(b.basis));
  }, [metrics, q, lang]);

  const shown = groups.reduce((n, g) => n + g.rows.length, 0);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto"
      onClick={onClose}>
      <ScrollLock />
      <div className="card w-full max-w-[1200px] max-h-[92vh] flex flex-col p-0"
        role="dialog" aria-modal="true" aria-label={t("reports.shell.metricsDictionary", lang)}
        onClick={(e) => e.stopPropagation()}>

        {/* Header stays put while the list scrolls — the filter is the control
            you reach for after you have already scrolled past something. */}
        <div className="flex items-start justify-between gap-4 p-4 border-b shrink-0"
          style={{ borderColor: "rgb(var(--border))" }}>
          <div className="min-w-0">
            <h2 className="font-semibold">{t("reports.shell.metricsDictionary", lang)}</h2>
            {/* The `{" "}` either side of the <code> is JSX, not part of the
                sentence: the dictionary values carry no edge whitespace, so
                trimming one there could not silently join two words. */}
            <p className="text-[11px] muted leading-relaxed mt-0.5">
              {t("reports.glossary.intro.beforeCode", lang)}{" "}
              <code className="font-mono">report_metrics</code>
              {t("reports.glossary.intro.afterCode", lang)}{" "}
              <span className="tabular-nums">
                {q.trim()
                  ? fill(t("reports.glossary.shownOf", lang),
                      { n: formatNum(shown), m: formatNum(metrics.length) })
                  : fill(t(`reports.glossary.count.${plural(metrics.length)}`, lang),
                      { n: formatNum(metrics.length) })}
              </span>
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("reports.glossary.filter", lang)}
              aria-label={t("reports.glossary.filter", lang)}
              className="w-40 sm:w-56 rounded-lg border bg-transparent px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-brand-500/40"
              style={{ borderColor: "rgb(var(--border))" }}
            />
            <button onClick={onClose} aria-label={t("reports.close", lang)}
              className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-4 overflow-y-auto scrollbar-thin">
          {metrics.length === 0 ? (
            // A failed read is not an empty dictionary. Same rule as the
            // Dashboard's queues — "nothing there" and "could not read" are
            // different claims and must never share a message.
            <EmptyNote>{t("reports.glossary.readFailed", lang)}</EmptyNote>
          ) : shown === 0 ? (
            <EmptyNote>{fill(t("reports.glossary.noMatch", lang), { q: q.trim() })}</EmptyNote>
          ) : (
            <div className="space-y-6">
              {groups.map((g) => (
                <div key={g.basis}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide">
                      {basisLabel(g.basis, lang)}
                    </h4>
                    <span className="text-[11px] muted tabular-nums">
                      {formatNum(g.rows.length)}
                    </span>
                  </div>
                  {BASIS_NOTE[g.basis] && (
                    <p className="mt-0.5 text-[11px] muted leading-relaxed">
                      {t(BASIS_NOTE[g.basis], lang)}
                    </p>
                  )}
                  <div className="mt-2 grid gap-x-8 xl:grid-cols-2">
                    {g.rows.map((m) => (
                      <MetricEntry key={m.metric_key} m={m} lang={lang} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// `lang` arrives as a PROP rather than through useApp(): this renders once per
// metric, up to 33 times per open, and the three <dt> labels are the only thing
// on the block that is not database content.
//
// FIVE FIELDS GO THROUGH THE i18n LOOKUP, TWO DELIBERATELY DO NOT. label /
// meaning / formula / grain / caveat resolve through metricLabel/metricText,
// which fall through to English so a metric a future migration registers before
// its copy is keyed renders English rather than a hole — a blank is
// indistinguishable from a failed read, and this popup already has a separate
// honest message for that case. The two left alone are metric_key and
// source_view: pointers, Latin in both languages, rendered straight off the row.
// `unit` is neither — a five-value enum, so it goes through the key set.
function MetricEntry({ m, lang }: { m: MetricDictionaryRow; lang: Lang }) {
  // Resolved once, above the JSX, so the caveat's presence test and the caveat's
  // text are the SAME expression. A separate gate — reading `m.caveat` off the
  // row while rendering the keyed string — would show a warning header over a
  // metric whose copy never arrived, and hide a keyed warning on a metric whose
  // column is null. metricText returns "" when every step misses, so falsy stays
  // falsy and nothing renders.
  const caveat = metricText(m, "caveat", lang);

  // MONO IS FOR CODE, AND FOUR FORMULAS STILL *ARE* CODE. The four
  // identifier-only formulas (net_profit, operating_cost, operating_profit,
  // total_maintenance_per_truck) translate to themselves, so they keep the
  // mono face on the Arabic screen — they are still `revenue - operating_cost.`
  // The other 29 are Arabic sentences with identifiers embedded, and a mono
  // stack has no Arabic face: the browser falls back per-glyph, which is how a
  // paragraph ends up in a different typeface from every other paragraph on the
  // block. Test the RENDERED string, not the language, so this stays right for
  // whatever a future key or migration puts there.
  const formula = metricText(m, "formula", lang);
  const formulaIsCode = !/[؀-ۿ]/.test(formula);

  return (
    <div className="py-3 border-t" style={{ borderColor: "rgb(var(--border))" }}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span dir="auto" className="text-sm font-medium">{metricLabel(m, lang)}</span>
        {/* dir="auto" on every Latin pointer. Under `dir=rtl` a bidi run that
            ENDS in punctuation gets that punctuation pushed to the left edge —
            `revenue - operating_cost.` renders as `.revenue - operating_cost`,
            which reads as a typo in a field whose whole job is to be copied
            exactly. "auto" takes the base direction from the first strong
            character, so an ASCII value stays LTR inside an RTL page. */}
        <code dir="auto" className="font-mono text-[11px] muted break-all">{m.metric_key}</code>
        <span className="ms-auto text-[11px] muted uppercase tracking-wide shrink-0">
          {unitLabel(m.unit, lang)}
        </span>
      </div>

      <p dir="auto" className="mt-1 text-sm leading-relaxed">{metricText(m, "meaning", lang)}</p>

      {/* `minmax(0,1fr)` on the value track — see the note above; a bare `1fr`
          is what lets a long source_view pointer overflow instead of wrap. */}
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-[6.5rem_minmax(0,1fr)]">
        <dt className="muted uppercase tracking-wide">{t("reports.glossary.formula", lang)}</dt>
        <dd dir="auto" className={`min-w-0 break-words ${formulaIsCode ? "font-mono" : "leading-relaxed"}`}>
          {formula}
        </dd>

        <dt className="muted uppercase tracking-wide">{t("reports.glossary.grain", lang)}</dt>
        <dd dir="auto" className="min-w-0 break-words">{metricText(m, "grain", lang)}</dd>

        <dt className="muted uppercase tracking-wide">{t("reports.glossary.sourceView", lang)}</dt>
        <dd dir="auto" className="min-w-0 break-words font-mono">{m.source_view}</dd>
      </dl>

      {/* No caveat means no warning — never a dash, never "N/A". The span is
          the dir="auto" carrier: Disclosure takes children only, and widening
          its signature for one caller is the wrong trade. */}
      {caveat && <Disclosure><span dir="auto">{caveat}</span></Disclosure>}
    </div>
  );
}
