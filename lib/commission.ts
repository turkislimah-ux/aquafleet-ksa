// Driver-commission engine — PURE. No Supabase, no Next, no I/O. Every function
// here is deterministic and unit-checkable in isolation (see
// scripts/commission-check.ts). The board/actions consume this; they never
// re-implement the math.
//
// Model (Path B, confirmed):
//   base  = driver base commission per trip, SAR
//   mode  = 'fixed' | 'scalable'
//   bump% = scalable step %; 0 for fixed
//
// THOSE THREE ARE ARGUMENTS, NOT A SOURCE. This block used to name
// projects.commission_value / _mode / _bump_pct as where they come from, and
// that has been wrong since 2b (bc92d18): callers now resolve them from
// commission_config_at(project_id, trip_date) — the terms in force on the day
// the trip is FOR — and the projects columns are a write-side mirror that goes
// stale the moment a future-dated change activates. This file must not name a
// source at all. It is pure: it prices whatever base it is handed, and pointing
// it at a column is how a caller would talk itself into reading the stale one.
//
//   fixed    : every delivered trip pays `base`.
//   scalable : the n-th delivered trip pays  base * (1 + (n-1) * bump%/100),
//              where n is THIS driver's trip number ON THIS PROJECT within a
//              single SCHEDULED day (trips.trip_date — resets to 1 each day,
//              bucketed by the day the trip is FOR, not the click-time it was
//              marked delivered).

import type { CommissionMode } from "./db-types";

// Round to 2 decimals (money). Keeps 60 * 1.05 = 63, not 62.99999.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Commission for the n-th trip (1-based) of a driver on a project within a
 * single SCHEDULED DAY (`trips.trip_date`). Said "this month" until now — the
 * ramp has been per-day since the bucketing moved to `trip_date`, and the
 * module header above has described it that way the whole time.
 * - fixed    → base, regardless of n.
 * - scalable → base * (1 + (n-1) * bumpPct/100).
 * Guards: n is clamped to >= 1; a non-finite/negative base yields 0.
 *
 * `n` is supplied by the caller; this function does no bucketing of its own.
 * `dailyDriverProjectCommission` below is what turns a day's trips into
 * positions, and it is the definition of the window.
 */
export function commissionForNthTrip(
  base: number,
  mode: CommissionMode,
  bumpPct: number,
  n: number
): number {
  if (!Number.isFinite(base) || base <= 0) return 0;
  const idx = Math.max(1, Math.floor(n));
  if (mode === "fixed") return round2(base);
  const pct = Number.isFinite(bumpPct) ? bumpPct : 0;
  return round2(base * (1 + (idx - 1) * (pct / 100)));
}

/**
 * Commission for a trip being delivered NOW, given how many of this driver's
 * trips on this project were ALREADY delivered for the SAME SCHEDULED DAY
 * (`trips.trip_date`) — not the same month, and not the same click-session.
 * The new trip is the (priorSameDay + 1)-th. Used by the delivery action to
 * stamp trips.commission_sar.
 *
 * The parameter was called `priorThisMonth`, which is why this is a rename and
 * not only a comment fix: the arg is positional, every caller already computes
 * a per-day count (`priorToday` in `priceDelivery`), and a parameter that
 * names the wrong window is an instruction to pass the wrong number.
 */
export function commissionForDelivery(
  base: number,
  mode: CommissionMode,
  bumpPct: number,
  priorSameDay: number
): number {
  const prior = Math.max(0, Math.floor(priorSameDay));
  return commissionForNthTrip(base, mode, bumpPct, prior + 1);
}

// "YYYY-MM" for an ISO timestamp. Derived from the UTC instant (deterministic
// across machines). Month-boundary deliveries are bucketed by UTC date.
// Used for REPORTING/payroll-period grouping (BreakdownReport, CustomersTab,
// FinanceTab, commission-rows.ts's payout cycles) — NOT for scaling position
// (see dailyDriverProjectCommission below for that).
//
// THE ONLY DEFINITION. lib/commission-rows.ts carried a byte-identical copy,
// whose own comment admitted it "matches lib/commission monthKeyOf" — an
// acknowledged duplicate of a money-bucketing rule, which is exactly the kind
// that has to stay honest. The copy had no external consumer, so it was deleted
// and that file now imports this one.
//
// IT IS NOT A "WHAT MONTH IS IT" HELPER, and the difference is a real bug that
// shipped. Passing `new Date().toISOString()` into this function to get the
// current month reads the UTC instant, so on the 1st between 00:00 and 02:59
// Riyadh it answers the PREVIOUS month, and on 1 January the previous YEAR.
// That question belongs to currentMonthKey() in lib/utils.ts, which reads the
// local clock. Bucketing a STORED timestamp and asking what month the USER is in
// are different questions that happen to agree for 21 hours a day.
export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

type DeliveredLite = { id: string; trip_date: string; delivered_at: string | null };

export type DailyCommission = {
  dayKey: string;
  count: number;
  total: number;
  perTrip: { n: number; delivered_at: string; commission: number }[];
};

/**
 * Roll up one driver's commission on one project for a single scheduled DAY
 * (`trips.trip_date` — the day the trip is FOR, a plain `date` column, not
 * `delivered_at`). `trips` is that driver's delivered trips on that project
 * (any days); rows are filtered to `dayKey` by `trip_date` (NOT by when they
 * were clicked delivered), sorted by `delivered_at` ascending (tiebreak `id`
 * ascending) for within-day order, numbered n = 1..k, and each priced.
 * Because bucketing is by `trip_date`, the scalable ramp resets per
 * scheduled day regardless of when trips are actually clicked delivered —
 * clicking several different-day trips in one session does NOT collapse
 * them into one bucket, and a trip delivered late still scales under the
 * day it was FOR, not the day it was clicked.
 *
 * Trips with a null delivered_at are ignored (not yet delivered = no commission).
 */
export function dailyDriverProjectCommission(
  trips: DeliveredLite[],
  base: number,
  mode: CommissionMode,
  bumpPct: number,
  dayKey: string
): DailyCommission {
  const inDay = trips
    .filter((t): t is DeliveredLite & { delivered_at: string } => !!t.delivered_at)
    .filter((t) => t.trip_date === dayKey)
    .sort((a, b) =>
      a.delivered_at !== b.delivered_at
        ? a.delivered_at < b.delivered_at ? -1 : 1
        : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );

  const perTrip = inDay.map((t, i) => {
    const n = i + 1;
    return { n, delivered_at: t.delivered_at, commission: commissionForNthTrip(base, mode, bumpPct, n) };
  });

  return {
    dayKey,
    count: perTrip.length,
    total: round2(perTrip.reduce((s, p) => s + p.commission, 0)),
    perTrip,
  };
}
