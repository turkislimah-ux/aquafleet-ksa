// Byte-identity harness for the ARABIC MONTH-NAME sweep. No DB, no test
// framework.
// Run:  npx tsx scripts/month-label-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).
//
// WHY THIS FILE EXISTS. The sweep translated one thing and one thing only: the
// month NAME. Every other property of every date on every screen — the digits,
// the separators, the field order, the zero-padding, the AM/PM marker, the
// en-GB-vs-en-US locale each site had already pinned — was to survive
// untouched, and the ENGLISH output was to be identical to the byte.
//
// That promise is architectural, not incidental: the English arm of every new
// function DELEGATES to the pre-existing call rather than rebuilding it from
// the dictionary. So most of what follows is asserting an equivalence that the
// code shape already makes true. That is deliberate. The shape is what a future
// edit will break, and a green test over an assertion nobody can see is worth
// less than a red one over an assertion that used to hold.
//
// It is also not theoretical. `lib/utils.ts` documents the trap this file was
// written for: en-GB abbreviates September as "Sept", en-US as "Sep", and
// `common.monthShort."9".en` is "Sep". Routing eleven en-GB render sites through
// the dictionary would have silently changed one month in twelve, on one month
// of the year, in a way no reviewer would catch in October. Section 3 below is
// that case, written out.
//
// WHAT IT CHECKS, and what each check protects:
//   1. THE DICTIONARY — all twelve months resolve in both languages and both
//      styles (t() returns the PATH on a miss, so a typo'd leaf renders as
//      "common.monthLong.9" rather than throwing). Plus the ruling itself:
//      Arabic short == Arabic long, since Arabic has no abbreviated form.
//   2. THE CANONICAL PAIR — formatDateLang / formatDateTimeLang against the
//      pinned formatDate / formatDateTime they wrap, for every month-bearing
//      option set the app actually passes, across all twelve months.
//   3. THE en-GB ADAPTER — formatDateLangLocale against the raw
//      `new Intl.DateTimeFormat(locale, opts)` expression each of its five
//      callers used BEFORE the sweep. This is the "asserted per site" the doc
//      comment over formatDateLangLocale promises; the option sets below are
//      copied from the call sites, named after them, and are the whole of that
//      promise.
//   4. THE ARABIC SIDE — differs from the English by EXACTLY the month token
//      (delete the month from both and the remainders are equal), and contains
//      no Arabic-Indic digit anywhere. The second half is the ar-SA ban made
//      mechanical: ar-SA renders ٢٠٢٦, so a stray locale tag fails here even if
//      it is introduced somewhere this file does not name.
//   5. THE DELEGATING WRAPPERS — lib/reports, lib/parts-usage, lib/dashboard
//      and lib/commission-rows each kept a month-label function of their own
//      NAME while its body moved to lib/utils. Each is asserted to agree with
//      the canonical helper at the style it pins, so a wrapper cannot quietly
//      re-acquire an opinion about the words.
//   6. periodLabel — the client-side replacement for v_pnl_by_period's baked
//      `label` column, at all three grains, in both languages.
//
// WHAT IT CANNOT CHECK, stated so nobody mistakes green for total coverage:
//   - app/trips/BreakdownReport.tsx's two wrappers. That file is a React client
//     component; importing it here pulls JSX and "use client" into a plain tsx
//     run. Its monthLabel delegates to utils with "short" pinned and its
//     shortMonthLabel is a distinct format (year sliced to 2 digits) — both are
//     asserted below as EXPRESSIONS, re-stated from the source, which catches a
//     change in utils but not a change in that file.
//   - Whether a given SCREEN calls the Lang-aware function at all. A caller that
//     was missed in the sweep still renders correct English and is invisible
//     here; the inventory in the sweep's report is the record of that, not this.
//   - The RTL/mixed-script rendering of the result. That is a browser property.

import {
  formatDate,
  formatDateTime,
  formatDateLang,
  formatDateTimeLang,
  formatDateLangLocale,
  formatDayKey,
  formatDayKeyLang,
  monthLabel,
  monthName,
} from "../lib/utils";
import { t, type Lang, type TKey } from "../lib/i18n";
import { monthLabel as reportsMonthLabel, monthTick, periodLabel } from "../lib/reports";
import { trendLabel } from "../lib/parts-usage";
import { monthLabel as commissionMonthLabel } from "../lib/commission-rows";

let failures = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    console.log(`        want: ${JSON.stringify(want)}`);
    console.log(`        got:  ${JSON.stringify(got)}`);
  }
}

function value(path: string, lang: Lang): string {
  return t(path as TKey, lang);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
// TWELVE DATES, BUILT ON THE LOCAL CLOCK. `new Date(y, m-1, d, …)` and not an
// ISO string, because every formatter under test renders in the machine's zone:
// an ISO instant would name a different month either side of midnight depending
// on where this runs, and a harness that passes in Riyadh and fails in CI is
// worse than no harness. The local constructor makes the calendar date the
// input, which is what a date LABEL is about.
//
// Day 15 for the same reason — it is the furthest a day can be from a month
// boundary, so no residual zone assumption in a formatter can move it.
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const DATES = MONTHS.map((m) => new Date(2026, m - 1, 15, 13, 30, 0));

// One extra instant with an AM/PM-bearing time, matching the drivers History
// stamp ("Aug 25, 2026, 01:30 PM") — the only surface in the sweep whose format
// carries a day period, which is a token the month swap must not disturb.
const PM_INSTANT = new Date(2026, 7, 25, 13, 30, 0);

const LANGS: Lang[] = ["en", "ar"];

/**
 * Every month-bearing option set the app passes to the canonical pair, named
 * after the site it came from. A set with no `month: "short" | "long"` is out of
 * scope by construction — both language arms delegate to the pinned formatter —
 * so none appears here.
 */
const CANONICAL_OPTS: { site: string; opts: Intl.DateTimeFormatOptions; time: boolean }[] = [
  {
    site: "BreakdownReport generatedOn",
    opts: { year: "numeric", month: "short", day: "numeric" },
    time: false,
  },
  {
    site: "InvoiceDetailModal sheet footer",
    opts: { year: "numeric", month: "short", day: "numeric" },
    time: false,
  },
  {
    site: "InvoiceDetailModal voided-on (long)",
    opts: { year: "numeric", month: "long", day: "numeric" },
    time: false,
  },
  {
    site: "parts-usage week range",
    opts: { month: "short", day: "numeric", timeZone: "UTC" },
    time: false,
  },
  {
    site: "drivers HistoryTab paid_at",
    opts: {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    },
    time: true,
  },
];

/**
 * The five sites that pinned a locale of their own BEFORE the canonical pair
 * existed. `before` is the expression that stood at the call site; `after` is
 * the adapter call that replaced it. Section 3 asserts they are the same string.
 */
const LOCALE_SITES: { site: string; locale: string; opts: Intl.DateTimeFormatOptions }[] = [
  {
    site: "FleetClient lastServiceLabel",
    locale: "en-GB",
    opts: { day: "2-digit", month: "short", year: "numeric" },
  },
  {
    site: "FleetDetailClient lastServiceLabel",
    locale: "en-GB",
    opts: { day: "2-digit", month: "short", year: "numeric" },
  },
  {
    site: "ProjectsBoard fmtPhaseStamp (date half)",
    locale: "en-GB",
    opts: { day: "2-digit", month: "short" },
  },
  {
    site: "IssuesSection when()",
    locale: "en-GB",
    opts: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
  },
  {
    site: "utils formatDayKey DAY_KEY_OPTS",
    locale: "en-GB",
    opts: { day: "numeric", month: "short", year: "numeric" },
  },
];

const ARABIC_INDIC = /[٠-٩۰-۹]/;

console.log("=== 1. The dictionary ===");

for (const m of MONTHS) {
  for (const lang of LANGS) {
    for (const style of ["short", "long"] as const) {
      const key = style === "long" ? `common.monthLong.${m}` : `common.monthShort.${m}`;
      const got = monthName(m, lang, style);
      // A miss returns the PATH, which is the only sentinel t() has. Comparing
      // against the path rather than against "" is what makes a typo'd leaf a
      // FAILURE instead of an empty month name nobody notices.
      check(`monthName(${m}, ${lang}, ${style}) resolves`, got !== key && got.length > 0, true);
      check(`monthName(${m}, ${lang}, ${style}) has no Arabic-Indic digits`,
        ARABIC_INDIC.test(got), false);
    }
  }

  // THE RULING: Arabic has no month abbreviation. يناير is both forms, so the
  // `style` argument is an ENGLISH-ONLY distinction and the two Arabic leaves
  // must be byte-identical. If they ever diverge, half the app's Arabic months
  // silently acquire a second spelling.
  check(`month ${m}: Arabic short == Arabic long`,
    monthName(m, "ar", "short"), monthName(m, "ar", "long"));

  // And the English pair must NOT be identical, or `common.monthLong` is a
  // pointless second copy of `common.monthShort` and the callers that pass
  // "long" are getting an abbreviation.
}

const enShortLong = MONTHS.map((m) => [monthName(m, "en", "short"), monthName(m, "en", "long")]);
// MAY IS THE ONLY MONTH WHOSE ENGLISH FORMS COINCIDE — measured, not recalled.
// The first draft of this file listed May, June and July, on the reasoning that
// three-letter month names cannot be abbreviated. That is wrong for two of them:
// the dictionary holds Jun/June and Jul/July, and only "May" is its own
// abbreviation. Hard-coding the set is the point — a leaf that silently became
// its own long form would otherwise read as normal.
const sameByDesign = new Set([5]);
for (const m of MONTHS) {
  const [short, long] = enShortLong[m - 1];
  check(`month ${m}: English short vs long differ (May excepted)`,
    short === long, sameByDesign.has(m));
}

// Out-of-range returns "", so a caller can test it and fall back to what it was
// handed. This is load-bearing: monthLabel returns the raw key on "", which is
// how a malformed month key renders as itself rather than as " 2026".
check("monthName(0) is empty", monthName(0, "en"), "");
check("monthName(13) is empty", monthName(13, "en"), "");
check("monthLabel falls back to the key when the month is out of range",
  monthLabel("2026-99", "en"), "2026-99");

console.log("\n=== 2. The canonical pair — English is byte-identical ===");

for (const { site, opts, time } of CANONICAL_OPTS) {
  let identical = true;
  let differing: string | null = null;
  for (const d of DATES) {
    const before = time ? formatDateTime(d, opts) : formatDate(d, opts);
    const after = time ? formatDateTimeLang(d, "en", opts) : formatDateLang(d, "en", opts);
    if (before !== after) {
      identical = false;
      differing = `${before} != ${after}`;
      break;
    }
  }
  check(`${site}: English unchanged across all 12 months${differing ? ` (${differing})` : ""}`,
    identical, true);
}

// Bare calls — no options — take the English path in BOTH languages, because a
// numeric date has no month NAME to translate. Asserted rather than assumed:
// this is the branch that keeps `formatDate(iso)` and `Intl.DateTimeFormat()`
// from disagreeing about their default fields.
check("formatDateLang with no options: ar == en",
  formatDateLang(PM_INSTANT, "ar"), formatDate(PM_INSTANT));
check("formatDateTimeLang with no options: ar == en",
  formatDateTimeLang(PM_INSTANT, "ar"), formatDateTime(PM_INSTANT));
check("formatDateLang with month: 'numeric': ar == en",
  formatDateLang(PM_INSTANT, "ar", { year: "numeric", month: "numeric", day: "numeric" }),
  formatDate(PM_INSTANT, { year: "numeric", month: "numeric", day: "numeric" }));

// formatDayKey / formatDayKeyLang. The English arm delegates outright, so this
// asserts the delegation rather than the format; the "1 Sept 2026" shape itself
// is section 3's job, where the en-GB locale is the thing under test.
for (const m of MONTHS) {
  const key = `2026-${String(m).padStart(2, "0")}-15`;
  check(`formatDayKeyLang(${key}, en) == formatDayKey(${key})`,
    formatDayKeyLang(key, "en"), formatDayKey(key));
}
check("formatDayKeyLang passes a malformed key through",
  formatDayKeyLang("not-a-date", "ar"), "not-a-date");

console.log("\n=== 3. The en-GB adapter — per site, old expression vs new ===");

for (const { site, locale, opts } of LOCALE_SITES) {
  let identical = true;
  let differing: string | null = null;
  for (const d of DATES) {
    // THE EXPRESSION THAT STOOD AT THE CALL SITE, verbatim.
    const before = new Intl.DateTimeFormat(locale, opts).format(d);
    const after = formatDateLangLocale(d, "en", locale, opts);
    if (before !== after) {
      identical = false;
      differing = `${before} != ${after}`;
      break;
    }
  }
  check(`${site} [${locale}]: English unchanged across all 12 months${differing ? ` (${differing})` : ""}`,
    identical, true);
}

// THE "Sept" TRAP, WRITTEN OUT. This is the case the whole architecture is built
// around: en-GB's September abbreviation is FOUR letters, the dictionary's is
// three, and eleven render sites format en-GB. If the English arm ever stops
// delegating and starts reading the dictionary, this is the check that goes red
// — and it is the only month of the year that would.
const SEPT = new Date(2026, 8, 15);
check("en-GB abbreviates September as 'Sept' (the trap this file exists for)",
  new Intl.DateTimeFormat("en-GB", { month: "short" }).format(SEPT), "Sept");
check("the dictionary abbreviates September as 'Sep'", monthName(9, "en", "short"), "Sep");
check("formatDayKey keeps en-GB's 'Sept' — the dictionary does NOT overwrite it",
  formatDayKey("2026-09-01"), "1 Sept 2026");
check("formatDayKeyLang(en) keeps it too",
  formatDayKeyLang("2026-09-01", "en"), "1 Sept 2026");
check("the Arabic arm reads the dictionary and drops 'Sept' entirely",
  formatDayKeyLang("2026-09-01", "ar"), `1 ${monthName(9, "ar")} 2026`);

console.log("\n=== 4. The Arabic side — one token differs, no Arabic-Indic digits ===");

/**
 * Delete the month NAME from a formatted string and return what is left.
 *
 * This is how "differs by exactly one token" is made mechanical. Both languages
 * are formatted with the same locale and options, so if the only substitution is
 * the month, then removing each side's own month name leaves two identical
 * remainders — same digits, same separators, same order, same AM/PM. Any other
 * change (a reordered field, a renumbered year, an inserted RTL mark) survives
 * the deletion and fails the comparison.
 */
function withoutMonth(s: string, month: string): string {
  return s.split(month).join(" ");
}

for (const { site, opts, time } of CANONICAL_OPTS) {
  let ok = true;
  let noDigits = true;
  let detail: string | null = null;
  for (let i = 0; i < DATES.length; i++) {
    const d = DATES[i];
    const style = opts.month === "long" ? "long" : "short";
    const en = time ? formatDateTimeLang(d, "en", opts) : formatDateLang(d, "en", opts);
    const ar = time ? formatDateTimeLang(d, "ar", opts) : formatDateLang(d, "ar", opts);
    const enMonth = new Intl.DateTimeFormat("en-US", {
      month: opts.month, timeZone: opts.timeZone,
    }).format(d);
    const arMonth = monthName(MONTHS[i], "ar", style);

    if (!ar.includes(arMonth)) { ok = false; detail = `${ar} lacks ${arMonth}`; break; }
    if (withoutMonth(en, enMonth) !== withoutMonth(ar, arMonth)) {
      ok = false;
      detail = `${en} -> ${ar} differs by more than the month`;
      break;
    }
    if (ARABIC_INDIC.test(ar)) { noDigits = false; detail = ar; break; }
  }
  check(`${site}: Arabic differs by EXACTLY the month${detail ? ` (${detail})` : ""}`, ok, true);
  check(`${site}: Arabic carries no Arabic-Indic digit`, noDigits, true);
}

for (const { site, locale, opts } of LOCALE_SITES) {
  let ok = true;
  let noDigits = true;
  let detail: string | null = null;
  for (let i = 0; i < DATES.length; i++) {
    const d = DATES[i];
    const en = formatDateLangLocale(d, "en", locale, opts);
    const ar = formatDateLangLocale(d, "ar", locale, opts);
    // The English month token comes from the SITE'S OWN LOCALE, which is the
    // point — en-GB says "Sept" here, and the remainder comparison would fail if
    // this asked en-US for the token instead.
    const enMonth = new Intl.DateTimeFormat(locale, {
      month: opts.month, timeZone: opts.timeZone,
    }).format(d);
    const arMonth = monthName(MONTHS[i], "ar", opts.month === "long" ? "long" : "short");

    if (!ar.includes(arMonth)) { ok = false; detail = `${ar} lacks ${arMonth}`; break; }
    if (withoutMonth(en, enMonth) !== withoutMonth(ar, arMonth)) {
      ok = false;
      detail = `${en} -> ${ar} differs by more than the month`;
      break;
    }
    if (ARABIC_INDIC.test(ar)) { noDigits = false; detail = ar; break; }
  }
  check(`${site} [${locale}]: Arabic differs by EXACTLY the month${detail ? ` (${detail})` : ""}`,
    ok, true);
  check(`${site} [${locale}]: Arabic carries no Arabic-Indic digit`, noDigits, true);
}

// The month LABEL and the year. The year is an app-formatted figure and stays
// Latin in both languages — asserted directly, because this is the single most
// visible string in the sweep (every chart axis, every period picker).
for (const m of MONTHS) {
  const key = `2026-${String(m).padStart(2, "0")}`;
  check(`monthLabel(${key}, ar) is "<arabic month> 2026"`,
    monthLabel(key, "ar"), `${monthName(m, "ar")} 2026`);
  check(`monthLabel(${key}, ar) carries no Arabic-Indic digit`,
    ARABIC_INDIC.test(monthLabel(key, "ar")), false);
}

console.log("\n=== 5. The delegating wrappers agree with the canonical helper ===");

// Each of these kept its NAME while its body moved to lib/utils. The style each
// pins is part of the contract: lib/reports' monthLabel is a chart axis and is
// SHORT; parts-usage's month arm is a period heading and is LONG. A wrapper that
// re-acquired an opinion — or a default that changed under it — fails here.
for (const m of MONTHS) {
  const key = `2026-${String(m).padStart(2, "0")}`;
  const dayKey = `${key}-01`;
  for (const lang of LANGS) {
    check(`reports.monthLabel(${key}, ${lang}) == utils short`,
      reportsMonthLabel(dayKey, lang), monthLabel(dayKey, lang, "short"));
    check(`commission-rows.monthLabel(${key}, ${lang}) == utils short`,
      commissionMonthLabel(key, lang), monthLabel(key, lang, "short"));

    // monthTick: the bare month NAME, with a 2-digit year only in January.
    // The year is SLICED off the key, never formatted — which is why it cannot
    // come back Arabic-Indic. Both branches asserted.
    const tick = monthTick(dayKey, lang);
    check(`reports.monthTick(${key}, ${lang})`,
      tick, m === 1 ? `${monthName(1, lang)} 26` : monthName(m, lang));
    check(`reports.monthTick(${key}, ${lang}) carries no Arabic-Indic digit`,
      ARABIC_INDIC.test(tick), false);

    // parts-usage's trend axis: "Aug 26" / "أغسطس 26" for EVERY month, not just
    // January — a different format from monthTick over the same data, which is
    // why the two are separate functions rather than one with a flag.
    check(`parts-usage.trendLabel(month, ${key}, ${lang})`,
      trendLabel("month", key, lang), `${monthName(m, lang)} 26`);
  }
}

// The two BreakdownReport wrappers, re-stated as expressions (see WHAT IT CANNOT
// CHECK). monthLabel there pins "short"; shortMonthLabel is the 2-digit-year
// form, which differs from monthLabel in the YEAR and only in the year.
for (const lang of LANGS) {
  check(`BreakdownReport monthLabel shape (${lang})`,
    monthLabel("2026-06", lang, "short"), `${monthName(6, lang)} 2026`);
  check(`BreakdownReport shortMonthLabel shape (${lang})`,
    `${monthName(6, lang)} 26`, `${monthName(6, lang)} ${"2026".slice(2)}`);
}

// lib/dashboard's monthTitle is the LONG style — a page heading, not an axis.
// Re-pointed at utils in PART 2; asserted at the style it pins.
check("dashboard monthTitle style is long (en)", monthLabel("2026-08-01", "en", "long"), "August 2026");
check("dashboard monthTitle style is long (ar)",
  monthLabel("2026-08-01", "ar", "long"), `${monthName(8, "ar", "long")} 2026`);

console.log("\n=== 6. periodLabel — the client-side replacement for the baked column ===");

// v_pnl_by_period bakes its `label` with SQL to_char(), so the string has ONE
// value for every reader and cannot follow the toggle. periodLabel rebuilds it
// from period_type + period_start. The English forms below are the view's own
// output, measured live — changing one of them is a visible content change on
// the management pack, not a refactor.
const PERIOD_CASES: { type: "month" | "quarter" | "year"; start: string; en: string }[] = [
  { type: "month", start: "2026-09-01", en: "Sep 2026" },
  { type: "month", start: "2026-08-01", en: "Aug 2026" },
  { type: "month", start: "2026-07-01", en: "Jul 2026" },
  { type: "month", start: "2026-06-01", en: "Jun 2026" },
  { type: "quarter", start: "2026-07-01", en: "Q3 2026" },
  { type: "quarter", start: "2026-04-01", en: "Q2 2026" },
  { type: "quarter", start: "2026-01-01", en: "Q1 2026" },
  { type: "quarter", start: "2026-10-01", en: "Q4 2026" },
  { type: "year", start: "2026-01-01", en: "2026" },
];

for (const c of PERIOD_CASES) {
  const row = { period_type: c.type, period_start: c.start };
  check(`periodLabel(${c.type} ${c.start}, en)`, periodLabel(row, "en"), c.en);
  const ar = periodLabel(row, "ar");
  check(`periodLabel(${c.type} ${c.start}, ar) carries no Arabic-Indic digit`,
    ARABIC_INDIC.test(ar), false);
  check(`periodLabel(${c.type} ${c.start}, ar) keeps the Latin year`,
    ar.includes(c.start.slice(0, 4)), true);
  if (c.type === "month") {
    check(`periodLabel(${c.type} ${c.start}, ar) names the Arabic month`,
      ar, `${monthName(Number(c.start.slice(5, 7)), "ar")} 2026`);
  }
  if (c.type === "year") {
    // A YEAR IS A NUMBER, NOT A PHRASE. It has nothing to translate, so both
    // languages must return the identical four characters — no wrapper word, no
    // marker, no reordering.
    check(`periodLabel(year, ar) == periodLabel(year, en)`, ar, c.en);
  }
}

// The quarter wrapper IS translated ("Q{q} {y}" / "الربع {q} {y}"), and both
// substitutions must land — a fill() miss would leave a literal "{q}" on the
// management pack's period picker.
const q3ar = periodLabel({ period_type: "quarter", period_start: "2026-07-01" }, "ar");
check("periodLabel(quarter, ar) substitutes both placeholders",
  q3ar.includes("{"), false);
check("periodLabel(quarter, ar) is the Arabic quarter wrapper",
  q3ar, value("common.quarterLabel", "ar").replace("{q}", "3").replace("{y}", "2026"));

console.log("\n=== 7. The ar-SA ban, mechanically ===");

// THIS FILE HOLDS THE ONLY DELIBERATE "ar-SA" IN THE REPO. READ THIS BEFORE
// TREATING A GREP HIT AS A REGRESSION.
//
//   npx tsx scripts/code-grep.ts 'ar-SA'      -> EXIT 1, three hits, all below
//
// That is expected and permanent. The ban is on the APP rendering through
// ar-SA; this is a test asserting what ar-SA does, which is the opposite thing.
// Scope the check to app source and it is clean (205 files, measured
// 2026-09-08 with the sweep staged):
//
//   npx tsx scripts/code-grep.ts 'ar-SA' $(git ls-files 'app/*.ts' 'app/*.tsx' \
//     'lib/*.ts' 'lib/*.tsx' 'components/*.ts' 'components/*.tsx' | tr '\n' ' ')
//
// PASS THE FILES, NOT THE DIRECTORIES. code-grep takes literal paths and feeds
// each to `git show :<path>`; a directory throws, is swallowed by its catch, and
// the run reports "No live reference ... in 3 file(s)" with EXIT 0 having read
// nothing. A false green that reads exactly like a real pass.
//
// The assertion itself: ar-SA renders the SAME call in Arabic-Indic digits.
// Stating that here means this file documents WHY the ban exists rather than
// only that it is observed — and it fails loudly if the runtime's CLDR data ever
// changes underneath the claim.
const arSA = new Intl.DateTimeFormat("ar-SA", { year: "numeric" }).format(PM_INSTANT);
check("ar-SA really does produce Arabic-Indic digits (the reason for the ban)",
  ARABIC_INDIC.test(arSA), true);
check("every app formatter above produced none",
  ARABIC_INDIC.test([
    formatDateLang(PM_INSTANT, "ar", { year: "numeric", month: "short", day: "numeric" }),
    formatDateTimeLang(PM_INSTANT, "ar", {
      year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }),
    formatDayKeyLang("2026-08-25", "ar"),
    monthLabel("2026-08", "ar"),
    monthTick("2026-01-01", "ar"),
    trendLabel("month", "2026-08", "ar"),
    periodLabel({ period_type: "quarter", period_start: "2026-07-01" }, "ar"),
  ].join(" ")), false);

console.log(failures === 0
  ? "\nAll month-label checks passed."
  : `\n${failures} month-label check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
