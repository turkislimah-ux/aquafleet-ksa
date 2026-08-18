import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatSar(n: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) + " SAR";
}

export function formatNum(n: number, digits = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
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
