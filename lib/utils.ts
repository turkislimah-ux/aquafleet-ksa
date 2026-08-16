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
 * DO NOT CONFUSE THIS WITH monthKeyOf(). That helper (lib/commission.ts, and an
 * identical copy in lib/commission-rows.ts) buckets an ISO timestamp by its UTC
 * instant, deliberately and by documented decision, so payroll grouping is
 * deterministic across machines. This answers a different question — which month
 * the USER is in right now — and the two are only interchangeable for 21 hours a
 * day. Passing `new Date().toISOString()` into monthKeyOf() to get "this month"
 * is exactly the bug this replaces.
 */
export function currentMonthKey(): string {
  return todayKey().slice(0, 7);
}

/**
 * "YYYY-MM" for a stored timestamp, on the LOCAL clock.
 *
 * THIS IS THE THIRD MONTH QUESTION, AND ALL THREE ARE DIFFERENT. Keeping them
 * apart is the whole point:
 *
 *   currentMonthKey()          which month is it NOW            local clock
 *   localMonthKeyOf(iso)       which month did THIS happen in   local clock
 *   monthKeyOf(iso)            same, but by the UTC instant     lib/commission
 *
 * monthKeyOf is correct and deliberate for payroll grouping — bucketing by UTC
 * is what makes it deterministic across machines — but it is WRONG the moment
 * its result is compared against a local month key, because the two sides then
 * sit on different clocks. In Riyadh (UTC+3) a delivery stamped between 00:00
 * and 02:59 local is still the previous day in UTC, so on the 1st of a month it
 * buckets to the previous MONTH and drops out of "this month" entirely.
 *
 * IT ACCEPTS A PLAIN DATE STRING TOO, AND THAT GUARD IS DELIBERATE. These call
 * sites sit beside ones reading DATE columns (trips.trip_date,
 * customer_topups.topup_date), which are already local calendar terms and need
 * no conversion at all. Passing one to `new Date()` would parse it as UTC
 * midnight and, west of Greenwich, shift it back a day — a bug that would appear
 * only for users in negative offsets and never in Riyadh. So a bare YYYY-MM-DD
 * is sliced directly, which is both correct and what monthKeyOf would have done.
 *
 * Live check before this shipped: of 730 delivered trips, ZERO currently bucket
 * differently under UTC vs Riyadh — so this closes a latent hole rather than
 * moving a number today. Separately, 6 of those 730 fall in a different month by
 * delivered_at than by trip_date; that is a BASIS question, not a timezone one,
 * and is deliberately not addressed here.
 */
export function localMonthKeyOf(iso: string): string {
  // Already a local calendar date (YYYY-MM-DD) — no instant to convert.
  if (iso.length === 10 && !iso.includes("T")) return iso.slice(0, 7);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 7); // unparseable: behave as before
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
