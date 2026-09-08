import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
// The dictionary, for the month NAMES below. lib/i18n.ts imports nothing at
// all, so this edge adds no cycle — checked before it was drawn, not assumed.
import { t, type Lang } from "./i18n";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * "" AND WHITESPACE BECOME NULL, for any optional text column.
 *
 * PROMOTED HERE FROM lib/profile.ts when the issue reporter became its second
 * consumer — the same rule and the same precedent as daysAgoKey and
 * currentMonthKey below. It is not profile logic; it is what every optional
 * text field in this app has to do on the way to the database.
 *
 * An empty string is FALSY BUT NOT NULLISH, and that has now cost this repo
 * three separate bugs in one week — the notification bell, the commission money
 * path and the settings loader. `note ?? "None"` keeps "" and renders blank;
 * `note || "None"` does not. Storing NULL means BOTH spellings behave, so no
 * future reader has to know which one to reach for.
 *
 * It also makes "cleared" and "never filled in" the same state, which is what
 * they mean to a person, and it is what the nonblank CHECK constraints in 0157
 * and 0159 require — those reject '' outright with a 23514.
 */
export function blankToNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * Image types accepted by every upload in this app.
 *
 * ONE LIST, BECAUSE IT IS A SECURITY DECISION, AND THOSE MUST NOT BE EXPRESSED
 * TWICE. Avatars (profile-images) and issue screenshots (issue-report-images)
 * both read back through signed URLs, so the browser renders whatever the
 * bucket hands it.
 *
 * NOTE WHAT IS ABSENT: `image/svg+xml`. An SVG is an image that can carry
 * script, and it would sail straight through a `startsWith("image/")` test —
 * which is exactly why this is an explicit allow-list rather than a prefix
 * check. Keeping two copies of this list is how SVG quietly comes back.
 */
export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/** For an <input type="file"> accept attribute. */
export const IMAGE_ACCEPT = ALLOWED_IMAGE_MIME.join(",");

/**
 * Null when the file is acceptable, else the reason. Shared client and server.
 *
 * The size cap is a PARAMETER rather than a constant because the two callers
 * genuinely differ: an avatar is a head-and-shoulders photo, while an issue
 * attachment is a full-screen screenshot, which as a PNG routinely runs to
 * several megabytes. One shared number would either reject legitimate
 * screenshots or let avatars be far larger than they ever need to be.
 */
export function validateImageFile(
  file: { size: number; type: string },
  maxBytes: number,
): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > maxBytes) {
    return `Image is too large — maximum ${Math.round(maxBytes / (1024 * 1024))} MB.`;
  }
  if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type)) {
    return "Use a JPEG, PNG, WebP or GIF image.";
  }
  return null;
}

// NUMBERS ARE ALWAYS LATIN, IN BOTH LANGUAGES — every formatter here pins
// "en-US" and none of them takes a `lang`. Arabic-Indic digits (٠١٢٣) are a
// display convention this app does not use: plate digits are the ONE place
// Arabic numerals appear, they are preview-only, and lib/plate.ts guards them.
//
// The pinned locale is doing real work, not decoration. `toLocaleString()` and
// `toLocaleString(undefined, …)` follow the BROWSER's locale, so the same row
// renders "1,234.56" on an English device and "١٬٢٣٤٫٥٦" on an Arabic one —
// different digits AND different group/decimal marks (٬ ٫). That is invisible
// to whoever develops in English and it is not controlled by the app's own
// language toggle at all.

export function formatSar(n: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) + " SAR";
}

export function formatNum(n: number, digits = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
}

// EXACT to the halala — 1,234.56, never 1,235. This is NOT interchangeable with
// `formatSar` above, and the difference is money, not style: `formatSar` rounds
// to whole riyals for dashboard headlines, so routing a ledger figure through it
// silently restates the amount. Archive invoice rows, staff/truck ledgers and the
// maintenance-job export all quote a figure the user can reconcile against a
// document, so they round-trip at two decimals or they are wrong.
//
// Exists because five copies of `toLocaleString(undefined, { min: 2, max: 2 })`
// had accumulated across app/archive/ — each browser-locale-dependent per the
// note above. One definition, one locale, one precision.
export function formatAmount(n: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatSarExact(n: number) {
  return `${formatAmount(n)} SAR`;
}

// THE TWO CANONICAL DATE FORMATTERS. Pinned "en-US" like the number formatters
// above, and both deliberately take NO `lang`. Everything user-facing that shows
// a date or a timestamp goes through one of these; there is no third.
//
// `formatDateTime` replaced five copies of
// `toLocaleString(lang === "ar" ? "ar-SA" : "en-US")` — the app-toggle bug,
// which fired for every user the moment the language switch flipped, producing
// "٢٥‏/٨‏/٢٠٢٦، ١:٣٠:٠٠ م". Passing "ar-SA" also reorders the date parts and
// swaps the AM/PM marker, so it was never only about digits.
//
// `formatDate` closes the quieter half: the 69 `toLocaleDateString()` /
// `toLocaleString()` calls with NO locale argument. Those follow the DEVICE,
// not the app, so they render Latin on a developer's machine and Arabic-Indic
// on an Arabic-locale phone — the same screen, two different alphabets,
// untouched by the language toggle. Nobody developing in English can see it.
//
// The options object passes straight through, because several callers need one
// (`timeZone: "UTC"` for the parts-usage buckets, "short"/"long" month shapes
// for the invoice and breakdown headers). Passing options is NOT a second
// formatter — the locale is still pinned here and only here.
//
// SCOPE NOTE: pinning "en-US" means a device set to another ENGLISH locale now
// sees US date order (8/25/2026) where it used to see its own (25/08/2026).
// That is the deliberate trade: one predictable rendering everywhere beats a
// date whose shape depends on the phone. Riyadh reads both.
//
// NOT everything that formats a date belongs here. `formatDayKey` above renders
// a YYYY-MM-DD calendar key in its own "1 Sep 2026" shape and parses the parts
// to avoid a UTC shift; `todayKey`/`daysAgoKey` never touch Intl at all. And any
// date that becomes a KEY or a COMPARISON — notably driver-state-drift.ts's
// en-CA + Asia/Riyadh bucket key, which is diffed against SQL — must never be
// routed through a display formatter.
export function formatDateTime(
  iso: string | number | Date,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Date(iso).toLocaleString("en-US", opts);
}

export function formatDate(
  iso: string | number | Date,
  opts?: Intl.DateTimeFormatOptions,
): string {
  return new Date(iso).toLocaleDateString("en-US", opts);
}

// ===========================================================================
// MONTH NAMES, AND THE LANGUAGE-AWARE DATE PATH BUILT ON THEM
// ===========================================================================
// THE RULING THIS IMPLEMENTS: in Arabic, a month renders its GREGORIAN name in
// Arabic — يونيو 2026 — with LATIN digits and the Latin part order. English
// output does not move by one byte. The calendar is unchanged; only the word is
// translated. Nothing here ever passes "ar-SA".
//
// WHY NOT `Intl.DateTimeFormat(lang, …)`, WHICH WOULD BE ONE LINE. Two reasons,
// either sufficient:
//   1. It is the shape the two formatters above exist to have removed. The
//      header at the top of this block records what a locale-following date
//      formatter shipped last time: "٢٥‏/٨‏/٢٠٢٦، ١:٣٠:٠٠ م", the whole date
//      reordered and renumbered by the language toggle.
//   2. Its Latin digits are an ICU DEFAULT, not a guarantee. `Intl` with the
//      bare "ar" tag renders Latin digits today because CLDR's default
//      numbering system for undifferentiated Arabic is `latn`; that is a data
//      decision in a table that ships with the runtime, not a promise of the
//      API, and the same call under "ar-SA" already returns ٢٠٢٦. Reading the
//      digits off the app's own formatter and only the NAME out of the
//      dictionary makes the guarantee ours.
//
// THE ENGLISH SIDE OF EVERY FUNCTION BELOW DELEGATES TO THE EXISTING CALL
// UNTOUCHED — it is not rebuilt from the dictionary leaves. That is what makes
// "English is byte-identical" true BY CONSTRUCTION rather than by twelve
// successful string comparisons. It is also not theoretical: formatDayKey below
// formats "en-GB", and en-GB renders September as "Sept", where
// `common.monthShort."9".en` is "Sep". Routing the English through the leaves
// would have silently changed one month in eleven render sites, and only in
// September.

// Indexing a const tuple types the element as the union of its twelve members,
// so `common.monthShort.${key}` is twelve real TKeys rather than `string` —
// the same device app/trips and lib/commission-rows use.
const MONTH_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;

/**
 * One month's NAME, from a 1-based month number. "" for anything out of range,
 * so a caller can test it and fall back to whatever it was given.
 *
 * `style` is an ENGLISH-ONLY distinction. Arabic has no month abbreviation —
 * يناير is both forms — so `common.monthLong.ar` is byte-identical to
 * `common.monthShort.ar` and this argument changes nothing on that side. The
 * dictionary keeps both sets anyway; see the note over `common.monthLong`.
 */
export function monthName(
  month: number,
  lang: Lang,
  style: "short" | "long" = "short",
): string {
  const key = MONTH_KEYS[month - 1];
  if (!key) return "";
  return style === "long"
    ? t(`common.monthLong.${key}`, lang)
    : t(`common.monthShort.${key}`, lang);
}

/**
 * THE CANONICAL MONTH LABEL: "2026-08" or "2026-08-01" -> "Aug 2026" /
 * "أغسطس 2026". The YEAR is an app-formatted figure and stays Latin in both
 * languages, as every other number in this app does.
 *
 * Six implementations of this line existed before it — lib/commission-rows,
 * lib/reports, lib/dashboard, app/reports/StatementViews, app/fleet/FleetClient
 * and lib/parts-usage — in four different spellings across three locales, which
 * is how "Aug 2026", "August 2026" and "Sept 2026" all became the same label.
 * Callers keep their own SHAPE by passing `style`; what they no longer keep is
 * their own opinion about the words.
 *
 * Takes the KEY, not a Date, on purpose. A YYYY-MM key is a calendar month, not
 * an instant: handing it to a Date constructor is what puts a month label a day
 * — and therefore sometimes a MONTH — off in a negative-offset browser. The
 * slices read the characters and never construct one.
 */
export function monthLabel(
  monthKey: string,
  lang: Lang,
  style: "short" | "long" = "short",
): string {
  const name = monthName(Number(monthKey.slice(5, 7)), lang, style);
  return name ? `${name} ${monthKey.slice(0, 4)}` : monthKey;
}

/**
 * Format `d` exactly as `locale` + `opts` would, then swap ONLY the month name
 * for its Arabic leaf. Every other part — the digits, the separators, the
 * order, any AM/PM marker — is produced by the Latin formatter and passed
 * through verbatim, which is the whole point: the Arabic string differs from
 * the English one by one token.
 *
 * THE MONTH NUMBER COMES FROM A SECOND FORMATTER, NOT FROM PARSING THE NAME
 * THE FIRST ONE PRINTED. A name table would have to know that en-GB writes
 * "Sept" and en-US writes "Sep", and would silently stop translating September
 * on the day a caller changed locale. Asking for `month: "numeric"` under the
 * SAME `timeZone` is the same question with an unambiguous answer.
 *
 * THE RESULT IS THE ENGLISH STRING WITH ONE SUBSTRING REPLACED — it is NOT
 * reassembled from `formatToParts`. That distinction is not stylistic, and it
 * cost a measurement to find (scripts/month-label-check.ts §4 is where it
 * surfaced): on this runtime the two disagree by an invisible character.
 *
 *   Intl.DateTimeFormat("en-US", {…, hour, minute}).format(d)
 *     -> "Jan 15, 2026, 01:30 PM"   space before PM is U+0020
 *   …the same formatter's .formatToParts(d) joined
 *     -> "Jan 15, 2026, 01:30 PM"   space before PM is U+202F
 *
 * `format()` normalises the narrow no-break space ICU puts before a day period;
 * `formatToParts()` hands back the raw literal. So a parts-join produced an
 * Arabic stamp that differed from its English twin by the month AND by one
 * space character — invisible on screen, and a real difference to anything that
 * compares, searches or copies the two. Only one surface carries a day period
 * today (the drivers History paid_at stamp), which is exactly why nobody would
 * have caught it by looking.
 *
 * Replacing into `format()`'s own output makes "the Arabic differs from the
 * English by exactly the month" true BY CONSTRUCTION rather than by a
 * per-token equality nobody re-verifies — the same argument the header above
 * makes for English byte-identity. `.replace()` with a string pattern hits the
 * FIRST occurrence only, and a month token is alphabetic while every other
 * field in every option set here is digits, punctuation or AM/PM, so there is
 * nothing else in the string for it to match. The replacer is a FUNCTION so
 * that a `$` in a dictionary leaf could never be read as a substitution
 * pattern.
 */
function swapMonthName(
  d: Date,
  locale: string,
  opts: Intl.DateTimeFormatOptions,
  lang: Lang,
): string {
  const fmt = new Intl.DateTimeFormat(locale, opts);
  const english = fmt.format(d);
  const idx = Number(
    new Intl.DateTimeFormat("en-US", {
      month: "numeric",
      timeZone: opts.timeZone,
    }).format(d),
  );
  const name = monthName(idx, lang, opts.month === "long" ? "long" : "short");
  if (!name) return english;
  // The token AS THIS LOCALE PRINTED IT — "Sept" under en-GB, "Sep" under
  // en-US. Read off the parts rather than rebuilt, because it is the exact
  // substring that has to be found in `english`.
  const token = fmt.formatToParts(d).find((p) => p.type === "month")?.value;
  if (!token) return english;
  return english.replace(token, () => name);
}

/** True only when `opts` asks for a month by NAME — the sole thing translated. */
function hasMonthName(opts?: Intl.DateTimeFormatOptions): boolean {
  return opts?.month === "short" || opts?.month === "long";
}

/**
 * `formatDate` with a language. English is the pinned call, unchanged; Arabic
 * is that same call with the month name swapped.
 *
 * WHEN THE OPTIONS NAME NO MONTH, BOTH LANGUAGES TAKE THE ENGLISH PATH. A
 * numeric date (8/25/2026) has nothing to translate under this ruling — the
 * digits stay Latin in both languages — so there is no reason to route it
 * through a second formatter, and one good reason not to: `formatDate` with no
 * options and `Intl.DateTimeFormat` with no options do not default to the same
 * fields. Delegating removes that difference instead of documenting it.
 */
export function formatDateLang(
  iso: string | number | Date,
  lang: Lang,
  opts?: Intl.DateTimeFormatOptions,
): string {
  if (lang === "en" || !hasMonthName(opts)) return formatDate(iso, opts);
  return swapMonthName(new Date(iso), "en-US", opts!, lang);
}

/** `formatDateTime` with a language. Same two rules as `formatDateLang`. */
export function formatDateTimeLang(
  iso: string | number | Date,
  lang: Lang,
  opts?: Intl.DateTimeFormatOptions,
): string {
  if (lang === "en" || !hasMonthName(opts)) return formatDateTime(iso, opts);
  return swapMonthName(new Date(iso), "en-US", opts!, lang);
}

/**
 * THE en-GB ADAPTER. NOT a third canonical formatter — read the header above
 * `formatDateTime` before adding a caller.
 *
 * A handful of sites pin "en-GB" themselves and predate the two canonical
 * formatters: formatDayKey's "1 Sept 2026", the two fleet last-service stamps'
 * "05 Aug 2026", the projects board's "05 Aug" and the issue list's
 * "24 Aug, 14:32". Their day-first shape is what is on Turki's screens today,
 * and re-pinning them to en-US would reorder five surfaces to translate one
 * word — a bigger change than the one being made, and one nobody asked for.
 *
 * So the locale stays the CALLER'S and is passed in. The English arm is the
 * same formatter object `toLocaleDateString(locale, opts)` builds, which is
 * byte-identical by specification whenever `opts` names its own fields — as
 * every caller here does, since the month name is what brought them. The
 * equivalence is asserted per site, old expression against new, by
 * scripts/month-label-check.ts rather than left to that paragraph.
 */
export function formatDateLangLocale(
  iso: string | number | Date,
  lang: Lang,
  locale: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  const d = new Date(iso);
  if (lang === "en" || !hasMonthName(opts)) {
    return new Intl.DateTimeFormat(locale, opts).format(d);
  }
  return swapMonthName(d, locale, opts, lang);
}

// Local "today" as YYYY-MM-DD. Uses getFullYear/getMonth/getDate (local clock),
// matching the trip day-math convention (ProjectsBoard.dayKey) so leave-"today"
// and trip-days agree. Replaces `new Date().toISOString().slice(0,10)`, which is
// UTC and drifts a day behind local dates in +hours timezones (e.g. Riyadh) for
// the first hours after local midnight.
export function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// N days before today, as YYYY-MM-DD on the SAME local clock as todayKey().
//
// WHY THIS EXISTS RATHER THAN `new Date(Date.now() - n*86400000).toISOString()`:
// that expression is UTC, so pairing it with todayKey() puts the two ends of a
// window on two different clocks. In Riyadh (UTC+3) the UTC date is still
// yesterday until 03:00 local, so between 00:00 and 02:59 the window silently
// started a day early — measured:
//
//   Riyadh now              todayKey()   UTC since     local since
//   2026-08-16T01:30+03:00  2026-08-16   2026-07-16    2026-07-17   <- off by one
//   2026-08-16T12:00+03:00  2026-08-16   2026-07-17    2026-07-17
//
// Both ends must come from one clock or the window is a different length for
// three hours a night. setDate() handles month and year rollover, so this is
// also correct across 1 March, 1 January and leap days, which subtracting
// 86400000 milliseconds is not guaranteed to be across a DST change.
export function daysAgoKey(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Shift an existing YYYY-MM-DD key by a number of days or years, returning
 * another YYYY-MM-DD key. Unlike todayKey()/daysAgoKey() these read no clock at
 * all — they move a date the CALLER already has, which is what a page holding a
 * server-computed Riyadh `today` needs.
 *
 * THE WHOLE ROUND TRIP IS UTC, AND THAT IS THE POINT. The shape these replace,
 * written twice in app/drivers, was:
 *
 *   const end = new Date(`${today}T00:00:00`);   // no Z -> parsed as LOCAL
 *   end.setDate(end.getDate() + 90);
 *   const endKey = end.toISOString().slice(0, 10);   // serialized as UTC
 *
 * A date-time literal with no offset is parsed on the local clock, but
 * toISOString() always prints UTC — so east of UTC the slice lands on the day
 * BEFORE the one that was computed. In Riyadh (UTC+3) a "+90 days" window was
 * really 89 days and a "12 months back" cutoff started a day late, every day of
 * the year, on the one screen whose comments promised Riyadh correctness.
 * Appending "Z" and using the setUTC* setters keeps parse and serialize on one
 * clock, so the arithmetic is exactly the arithmetic that was asked for.
 *
 * setUTCDate/setUTCFullYear handle month, year and leap-day rollover, so
 * addYearsToKey("2024-02-29", -1) normalizes to 2023-03-01 rather than throwing
 * or producing an invalid date — the same behaviour daysAgoKey relies on.
 */
export function addDaysToKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Render a "YYYY-MM-DD" day key as a readable label ("1 Sep 2026").
 *
 * PARSES THE PARTS, NEVER `new Date(key)`. That constructor reads a bare date
 * string as UTC midnight, and toLocaleDateString then re-renders it in the
 * viewer's zone — so on any negative-offset machine the label lands on the day
 * BEFORE the one stored. These keys are calendar dates (commission
 * effective_from, trip_date), not instants; they carry no time and must not
 * acquire one on the way to the screen. Passing the parts to the Date
 * constructor builds it in local terms, so the digits survive the round trip
 * whatever zone the browser is in.
 */
export function formatDayKey(key: string): string {
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", DAY_KEY_OPTS);
}

// Named so the two functions cannot drift apart in their options while sharing
// a doc comment that says they agree.
const DAY_KEY_OPTS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};

/**
 * `formatDayKey` with a language: "1 Sept 2026" / "1 سبتمبر 2026".
 *
 * The parts-parsing above is repeated rather than delegated because it IS the
 * correctness of this function — the local-midnight Date is what the label is
 * built from, and handing the key to `formatDateLangLocale` would reintroduce
 * exactly the `new Date(key)` UTC shift the comment above forbids.
 *
 * NOTE THE ENGLISH: en-GB abbreviates September as "Sept", not "Sep". That is
 * the current output on eleven screens and it does not change here; only the
 * Arabic arm reads the dictionary.
 */
export function formatDayKeyLang(key: string, lang: Lang): string {
  if (lang === "en") return formatDayKey(key);
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return key;
  return formatDateLangLocale(new Date(y, m - 1, d), lang, "en-GB", DAY_KEY_OPTS);
}

export function addYearsToKey(key: string, years: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/**
 * The CURRENT month, "YYYY-MM", on the same local clock as todayKey().
 *
 * A FUNCTION, NEVER A CONST. It began life as
 * `export const CURRENT_MONTH_KEY = new Date().toISOString().slice(0, 7)` in
 * lib/commission-rows.ts, which was wrong twice: UTC (so on the FIRST of a month
 * between 00:00 and 02:59 Riyadh it yielded the PREVIOUS month, and on 1 January
 * the previous YEAR), and — worse — evaluated once at module load, so it never
 * rolled over at all and went stale for the lifetime of a session or process.
 * Anything answering "what is now" has to be called, not captured.
 *
 * IT LIVES HERE, BESIDE todayKey(), BECAUSE IT IS A CLOCK HELPER — not commission
 * logic. It was promoted out of lib/commission-rows.ts the moment a second
 * consumer appeared, which is the same reason and the same precedent as
 * daysAgoKey being promoted here in 22aad18. Three app/trips surfaces now read it
 * for their current-month default, and importing that from a *commission* module
 * would have been the wrong dependency.
 *
 * DO NOT CONFUSE THIS WITH monthKeyOf() in lib/commission.ts, which slices a
 * stored date/timestamp rather than reading the clock. Passing
 * `new Date().toISOString()` into it to get "this month" is exactly the bug this
 * replaces: that reads the UTC instant, so on the 1st between 00:00 and 02:59
 * Riyadh it answers the previous month, and on 1 January the previous year.
 *
 * Every month comparison in the app now buckets on a DATE column (trips.trip_date,
 * customer_topups.topup_date), which is already local calendar terms — so
 * monthKeyOf's plain slice and this function land on the same calendar by
 * construction. A short-lived localMonthKeyOf() existed here to convert
 * timestamptz values instead; re-basing those call sites onto trip_date removed
 * its last caller and it was deleted rather than left dormant.
 */
export function currentMonthKey(): string {
  return todayKey().slice(0, 7);
}

export function statusTone(s: string): "ok" | "warn" | "bad" | "info" | "muted" {
  switch (s) {
    case "active": case "on_duty": case "delivered": case "completed": case "paid": return "ok";
    case "idle": case "scheduled": case "loading": case "off_duty": case "confirmed": return "info";
    case "maintenance": case "in_progress": case "awaiting_parts": case "warning": case "training": case "in_transit": case "review": return "warn";
    case "out_of_service": case "cancelled": case "critical": case "void": return "bad";
    // "draft" falls through to muted — an invoice draft is the one lifecycle
    // status that isn't ok/warn/bad/info, just "not started yet".
    default: return "muted";
  }
}
