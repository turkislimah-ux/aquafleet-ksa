// Pure commission math — NO React, NO "use client". Extracted from
// CommissionsTab so the money logic is unit-testable without the UI (see
// scripts/commission-rows-check.ts). CommissionsTab re-exports these so the
// existing "./CommissionsTab" import sites keep working.
//
// SINGLE SOURCE OF TRUTH for base pay = trips.commission_sar (stamped on
// Delivered). Base is NEVER stored as a line — it is derived live. The three
// commission_* tables only carry extras (payout status + bonus, specials,
// adjustments). Total = base + active specials + active adjustments + bonus.
// A DENIED special/adjustment stays in the data but is EXCLUDED from every sum.
//
// ROLLING MODEL (migration 0009): "current" commission is a per-driver rolling
// balance — UNPAID delivered trips + UNPAID specials/adjustments (payout_id IS
// NULL) + the open cycle's bonus. Review state is pending|approved|denied:
// pending AND approved COUNT, only denied is excluded. On PAY a frozen snapshot
// is written to commission_payouts and the contributing rows are tagged with a
// payout_id (so they leave the current balance without being deleted). The
// rolling API lives at the bottom of this file (buildCurrentRows /
// buildPayoutSnapshot / buildHistoryRows); the month-based functions above are
// retained until the UI fully migrates off them.
//
// MONTH-SCOPED SINCE 0131. `pay_commission` now pays ONE MONTH at a time — it
// takes p_month_key ('YYYY-MM') and tags only that month's rows. So every
// rolling function below takes an OPTIONAL `monthKey`:
//   - set     → the balance FOR THAT MONTH, which is exactly what the RPC will
//               pay. This is the figure a Pay button may show.
//   - omitted → every unpaid month at once (the old all-time rolling balance).
//               Used for "does this terminated driver still owe anything" and
//               for the tab badge — questions about the driver, not a payment.
// A NUMBER SHOWN BESIDE A PAY BUTTON MUST BE THE MONTH-SCOPED ONE. The all-time
// total is larger whenever a driver has more than one unpaid month, and paying
// it would look like the RPC short-paid him.
//
// THE MONTH GRAIN IS trips.trip_date, NOT delivered_at. The RPC scopes base
// trips with `trip_date >= start and trip_date < end`; bucketing the screen on
// delivered_at would put a trip in a different month than the payment does
// (this fleet advances trips on the Kanban in bulk — 0109's finding). Specials,
// adjustments and the cycle row all carry their own month_key text column and
// are matched on it, byte-for-byte, the same way the RPC matches them.

// THREE IMPORTS, ALL DELIBERATE LEAVES. None pulls in React, Supabase or
// anything else that would stop scripts/commission-rows-check.ts running this
// module directly — verified by running it, not assumed. lib/commission's only
// import is a TYPE (erased at runtime), lib/db-types imports nothing at all, and
// lib/i18n has no import line whatsoever (it is a dictionary literal plus four
// pure functions), so this file's runtime dependency graph is still effectively
// empty.
//
// monthKeyOf USED TO BE DEFINED HERE TOO, byte-identically, with a comment
// admitting it "matches lib/commission monthKeyOf". It had no external consumer
// — ts-prune reported it as exported-but-used-in-module — so the copy was
// deleted rather than re-exported. lib/commission owns it, and owns the
// documented reason it buckets by the UTC instant (deterministic payroll
// grouping across machines). Two copies of a money-bucketing rule is one more
// than can be kept honest.
//
// currentMonthKey is the opposite question — which month the USER is in now, on
// the local clock — and lives in lib/utils beside todayKey. Do not merge the two.
import { monthKeyOf } from "./commission";
import { t, type Lang } from "./i18n";
import { currentMonthKey } from "./utils";

export type CommTrip = {
  driver_id: string | null;
  project_id: string | null;
  commission_sar: number | null;
  delivered_at: string | null;
};

export type CommPeriod = {
  driver_id: string;
  month_key: string;
  payout_status: "pending" | "approved" | "paid" | "denied";
  bonus_sar: number;
  deny_reason: string | null;
};

export type ItemStatus = "active" | "denied";

// Minimal shape buildCommissionRows needs; the full rows below extend it.
export type CommExtra = { driver_id: string; month_key: string; amount_sar: number; status?: ItemStatus };

export type CommSpecial = CommExtra & {
  id: string;
  label: string;
  date: string | null;
  note: string | null;
  is_special_trip: boolean;
  status: ItemStatus;
  deny_reason: string | null;
};

export type CommAdjustment = CommExtra & {
  id: string;
  label: string;
  date: string | null;
  note: string | null;
  status: ItemStatus;
  deny_reason: string | null;
};

export type DriverLite = { id: string; name: string; name_ar: string | null };

export type CommissionRow = {
  driverId: string;
  name: string;
  nameAr: string | null;
  base: number;
  trips: number;
  projects: number;
  specials: number;
  adjustments: number;
  bonus: number;
  total: number;
  status: CommPeriod["payout_status"];
};

export type BaseLine = { projectId: string | null; projectName: string; trips: number; amount: number };

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// A denied item never counts toward money. PURE predicate.
//
// MODULE-PRIVATE. Its two callers are both in this file (buildCommissionRows).
// It was exported and imported by nothing — an export on a money predicate is
// an invitation to apply the denied rule in a fourth place, and the rule is
// meant to have one expression that the sums here all route through.
function isActive(x: { status?: ItemStatus }): boolean {
  return (x.status ?? "active") !== "denied";
}


// The month a NEW special / adjustment / bonus is filed under, "YYYY-MM".
//
// RE-EXPORTED, NOT REDEFINED. The implementation lives in lib/utils.ts beside
// todayKey(), because it is a clock helper rather than commission logic — see
// its doc comment there for the two defects it replaced (UTC, and a const that
// never rolled over). It is re-exported here so the four write sites in
// CommissionsTab keep importing it from the module that owns their other
// commission helpers, and so this file still names the rule it depends on.
//
// MONTH_KEY IS NOT COSMETIC, WHICH IS WHY IT MATTERS HERE. v_commissions_monthly
// attributes specials, adjustments AND the bonus to a month by exact string
// match (month_key = to_char(month, 'YYYY-MM')), and v_driver_payslip_basis
// reads through it — so a wrong key files real money against the wrong month in
// Reports and on the wrong payslip. Since 0131 it is also the GRAIN of
// commission_periods and the conflict target of setCommissionBonus's upsert
// (driver_id,month_key) — the old "kept only as a human label" reading died with
// the one-open-row-per-driver index.
export { currentMonthKey };

// "2026-08" → "Aug 2026". HARDCODED month names, deliberately — pay_commission
// (0131) derives its own frozen payout caption from the same fixed English array
// rather than to_char(), which is lc_time-dependent. A screen label and a frozen
// payout caption that disagree about a month name would be read as two months.
//
// It lives here rather than in either tab because BOTH read it — Commissions
// labels the lens it is paying, History labels the month a frozen record paid
// for — and two copies of the month naming is exactly how the two screens start
// captioning the same payout differently. PURE display: it computes no money and
// is never parsed back into a key.
//
// `lang` is REQUIRED, not defaulted: a default would let a call site keep
// rendering English forever without tsc ever mentioning it.
// Indexing a const tuple types the element as the union of its twelve members,
// so `drivers.months.${key}` is twelve real TKeys rather than `string`.
const MONTH_KEYS = ["1","2","3","4","5","6","7","8","9","10","11","12"] as const;
export function monthLabel(monthKey: string, lang: Lang): string {
  const key = MONTH_KEYS[Number(monthKey.slice(5, 7)) - 1];
  return key ? `${t(`drivers.months.${key}`, lang)} ${monthKey.slice(0, 4)}` : monthKey;
}

// `buildBaseLines` USED TO LIVE HERE and was deleted: zero call sites, in app
// code, scripts and tests alike. It bucketed a driver+month's delivered trips by
// project keyed on `delivered_at`, which is the WRONG WINDOW for pay — the money
// path keys on `payout_id` + `trip_date`. `buildCurrentBaseLines` below is the
// one that ships, and its own header used to read "like buildBaseLines", naming
// an uncalled function as if it were the reference implementation.
//
// Do not reintroduce a delivered_at-keyed base-line builder beside the pay-time
// one. Two functions producing per-project base lines over two different windows
// is how a snapshot starts describing a different set of trips than the payment
// it is attached to.

// Build per-driver commission rows for one month. PURE — reused by the tab body
// and by the Commissions tab badge (current-month pending count) in DriversClient.
// Denied specials & adjustments are EXCLUDED from the sums.
export function buildCommissionRows(p: {
  drivers: DriverLite[];
  trips: CommTrip[];
  periods: CommPeriod[];
  specials: CommExtra[];
  adjustments: CommExtra[];
  monthKey: string;
  // The tab lists EVERY driver (includeEmpty), even with 0 base. The tab badge
  // counts only real pending payouts, so it omits this (zero-activity excluded).
  includeEmpty?: boolean;
}): CommissionRow[] {
  const { drivers, trips, periods, specials, adjustments, monthKey, includeEmpty = false } = p;
  const rows: CommissionRow[] = [];
  for (const d of drivers) {
    const dt = trips.filter((t) => t.driver_id === d.id && t.delivered_at && monthKeyOf(t.delivered_at) === monthKey);
    const base = round2(dt.reduce((s, t) => s + (t.commission_sar ?? 0), 0));
    const projects = new Set(dt.map((t) => t.project_id).filter(Boolean)).size;
    const sp = round2(
      specials.filter((x) => x.driver_id === d.id && x.month_key === monthKey && isActive(x)).reduce((s, x) => s + x.amount_sar, 0),
    );
    const adj = round2(
      adjustments.filter((x) => x.driver_id === d.id && x.month_key === monthKey && isActive(x)).reduce((s, x) => s + x.amount_sar, 0),
    );
    const period = periods.find((x) => x.driver_id === d.id && x.month_key === monthKey) ?? null;
    const bonus = round2(period?.bonus_sar ?? 0);
    const status = period?.payout_status ?? "pending";
    // Tab shows all drivers; badge counts only those with real activity.
    if (!includeEmpty && base === 0 && sp === 0 && adj === 0 && bonus === 0 && period == null) continue;
    rows.push({
      driverId: d.id,
      name: d.name,
      nameAr: d.name_ar,
      base,
      trips: dt.length,
      projects,
      specials: sp,
      adjustments: adj,
      bonus,
      total: round2(base + sp + adj + bonus),
      status,
    });
  }
  return rows;
}

// ===========================================================================
// ROLLING MODEL (migration 0009). New per-driver "current balance" API. Money
// rule: pending AND approved COUNT; only DENIED is excluded. "Current" = rows
// with payout_id == null (unpaid). PURE — covered by commission-rows-check.ts.
// ===========================================================================

// Per-item / per-bonus / per-payout review state.
export type ReviewStatus = "pending" | "approved" | "denied";

// A line counts toward money unless it is denied. Pending and approved both pay.
// (Generalized form of isActive for the 3-state model; treats a missing status
// as pending so a freshly inserted row counts immediately.)
export function countsForPay(x: { status?: ReviewStatus | null }): boolean {
  return (x.status ?? "pending") !== "denied";
}

// Unpaid = belongs to the current rolling cycle (not yet frozen into a payout).
export function isUnpaid(x: { payout_id?: string | null }): boolean {
  return (x.payout_id ?? null) === null;
}

// Does a row belong to `monthKey` ("YYYY-MM")? An OMITTED monthKey means "every
// month" and matches everything — that is the all-time rolling reading.
//
// trip_date is a Postgres DATE, which PostgREST returns as "YYYY-MM-DD", so the
// slice is exact and timezone-free: it agrees with the RPC's
// `trip_date >= to_date(key) and trip_date < to_date(key) + 1 month` for every
// value a DATE column can hold. Do NOT swap this for a `new Date()` round-trip —
// that reintroduces the UTC skew todayKey() exists to avoid.
//
// A row with NO date is EXCLUDED from a specific month rather than swept into
// the current one: it cannot be attributed, and the RPC will not pay it either.
function inMonth(value: string | null | undefined, monthKey?: string): boolean {
  if (monthKey == null) return true;
  if (!value) return false;
  return value.slice(0, 7) === monthKey;
}

// A delivered trip in the rolling model (carries payout_id; NULL = current).
export type CommTripRow = {
  driver_id: string | null;
  project_id: string | null;
  commission_sar: number | null;
  delivered_at: string | null;
  // The OPERATIONAL day, and the column the month lens buckets on (see the file
  // header). delivered_at answers "is it earned"; trip_date answers "which month
  // pays for it". Optional only so the pure-math harness can omit it.
  trip_date?: string | null;
  payout_id?: string | null;
};

// A special/adjustment in the rolling model. Math needs only these fields.
export type CommExtraRow = {
  id: string;
  driver_id: string;
  label?: string;
  amount_sar: number;
  status?: ReviewStatus | null;
  deny_reason?: string | null;
  payout_id?: string | null;
  // The month this item is filed under. Matched by exact string equality, the
  // same test `pay_commission` and v_commissions_monthly both use.
  month_key?: string | null;
};

// Full special row for the UI (rolling model). Extends the pure CommExtraRow with
// every field the manage popup + Breakdown render. status is the 3-state review.
export type CommSpecialRow = CommExtraRow & {
  driver_id: string;
  label: string;
  date: string | null;
  note: string | null;
  is_special_trip: boolean;
  status: ReviewStatus;
  deny_reason: string | null;
  month_key: string | null;
};

// Full adjustment row for the UI (rolling model). Amount may be negative.
export type CommAdjustmentRow = CommExtraRow & {
  driver_id: string;
  label: string;
  date: string | null;
  note: string | null;
  status: ReviewStatus;
  deny_reason: string | null;
  month_key: string | null;
};

// ONE cycle row per (driver, month) — commission_periods after 0131 re-grained
// it (the old one-open-row-per-driver unique index is gone; the live one is
// commission_periods_driver_month_idx on (driver_id, month_key), and month_key
// is NOT NULL). Bonus is reviewable; payout_status drives the Approve→Pay gate.
//
// month_key stays `string | null` in TS on purpose: the COLUMN is NOT NULL, but
// a row that has not been read back from the DB yet has no key, and widening a
// type to match a constraint we did not write here would be borrowed confidence.
export type CommCycle = {
  driver_id: string;
  bonus_sar: number;
  bonus_status: ReviewStatus;
  bonus_deny_reason: string | null;
  payout_status: ReviewStatus;
  approved_by: string | null;
  month_key: string | null;
  deny_reason: string | null;
  // Set once this month's bonus has been frozen into a payout (0131 TAGS the
  // cycle row, it never zeroes the bonus). A tagged row must be excluded from
  // every current-balance sum or the paid bonus counts a second time.
  payout_id?: string | null;
};

// A frozen History record (commission_payouts row).
export type CommPayout = {
  id: string;
  driver_id: string;
  paid_at: string;
  approved_by: string | null;
  period_label: string;
  base_sar: number;
  specials_sar: number;
  adjustments_sar: number;
  bonus_sar: number;
  total_sar: number;
  snapshot: PayoutSnapshot | unknown;
};

// One current-balance row per driver. Sums ONLY unpaid rows; pending+approved
// count, denied excluded; bonus counts unless its bonus_status is denied.
export type CurrentRow = {
  driverId: string;
  name: string;
  nameAr: string | null;
  base: number;
  trips: number;
  projects: number;
  specials: number;
  adjustments: number;
  bonus: number;
  total: number;
  payoutStatus: ReviewStatus;
  // True when there is anything to review/pay (non-zero activity or an open cycle).
  hasActivity: boolean;
};

export function buildCurrentRows(p: {
  drivers: DriverLite[];
  trips: CommTripRow[];
  cycles: CommCycle[];
  specials: CommExtraRow[];
  adjustments: CommExtraRow[];
  // "YYYY-MM" → this month's balance (what pay_commission would pay for it).
  // Omitted → every unpaid month at once. See the file header.
  monthKey?: string;
  includeEmpty?: boolean;
}): CurrentRow[] {
  const { drivers, trips, cycles, specials, adjustments, monthKey, includeEmpty = false } = p;
  const rows: CurrentRow[] = [];
  for (const d of drivers) {
    // Base = unpaid delivered trips for this driver, in month (if scoped).
    const dt = trips.filter(
      (t) => t.driver_id === d.id && t.delivered_at && isUnpaid(t) && inMonth(t.trip_date, monthKey),
    );
    const base = round2(dt.reduce((s, t) => s + (t.commission_sar ?? 0), 0));
    const projects = new Set(dt.map((t) => t.project_id).filter(Boolean)).size;

    const sp = round2(
      specials
        .filter((x) => x.driver_id === d.id && isUnpaid(x) && countsForPay(x) && inMonth(x.month_key, monthKey))
        .reduce((s, x) => s + x.amount_sar, 0),
    );
    const adj = round2(
      adjustments
        .filter((x) => x.driver_id === d.id && isUnpaid(x) && countsForPay(x) && inMonth(x.month_key, monthKey))
        .reduce((s, x) => s + x.amount_sar, 0),
    );

    // UNPAID cycle rows only. A row tagged with a payout_id has already had its
    // bonus frozen into a payout; 0131 keeps the amount on the row rather than
    // zeroing it, so including it here would pay the same bonus twice.
    //
    // With monthKey set this is AT MOST ONE row (the unique index guarantees
    // it) — but the sum is written once and reads correctly either way, rather
    // than as two branches that could drift apart.
    const driverCycles = cycles.filter(
      (c) => c.driver_id === d.id && isUnpaid(c) && inMonth(c.month_key, monthKey),
    );
    const bonus = round2(
      driverCycles
        .filter((c) => countsForPay({ status: c.bonus_status }))
        .reduce((s, c) => s + c.bonus_sar, 0),
    );
    // Latest month wins when unscoped — the Approve→Pay gate is per month, so
    // an all-time reading can only report the most recent one.
    const cycle =
      driverCycles.length === 0
        ? null
        : driverCycles.reduce((a, b) => ((a.month_key ?? "") >= (b.month_key ?? "") ? a : b));
    const payoutStatus: ReviewStatus = cycle?.payout_status ?? "pending";

    const hasActivity = base !== 0 || sp !== 0 || adj !== 0 || bonus !== 0 || cycle != null;
    if (!includeEmpty && !hasActivity) continue;

    rows.push({
      driverId: d.id,
      name: d.name,
      nameAr: d.name_ar,
      base,
      trips: dt.length,
      projects,
      specials: sp,
      adjustments: adj,
      bonus,
      total: round2(base + sp + adj + bonus),
      payoutStatus,
      hasActivity,
    });
  }
  return rows;
}

// Per-project base lines for one driver's CURRENT (unpaid) cycle, optionally
// scoped to one month. Keyed on payout_id + trip_date — the pay window, not
// delivered_at. PURE.
//
// THIS IS A PAY-TIME FUNCTION: its output becomes snapshot.baseLines and the
// `base` total the driver is paid. When it feeds payCommission the monthKey is
// REQUIRED to match the RPC's own trip window, or the snapshot would describe
// more trips than the payment tags.
export function buildCurrentBaseLines(
  trips: CommTripRow[],
  driverId: string,
  projectsById: Record<string, string>,
  monthKey?: string,
): BaseLine[] {
  const map = new Map<string, BaseLine>();
  for (const t of trips) {
    if (t.driver_id !== driverId || !t.delivered_at || !isUnpaid(t)) continue;
    if (!inMonth(t.trip_date, monthKey)) continue;
    const key = t.project_id ?? "—";
    const cur =
      map.get(key) ??
      {
        projectId: t.project_id,
        projectName: t.project_id ? projectsById[t.project_id] ?? t.project_id : "Ad-hoc · no project",
        trips: 0,
        amount: 0,
      };
    cur.trips += 1;
    cur.amount = round2(cur.amount + (t.commission_sar ?? 0));
    map.set(key, cur);
  }
  return [...map.values()];
}

// ---- Pay-time snapshot --------------------------------------------------------
// The frozen breakdown stored in commission_payouts.snapshot (jsonb). It records
// EVERY line (including denied, struck in History) but the *_sar totals count
// non-denied only — matching what the driver is actually paid.

export type SnapItem = {
  kind: "special" | "adjustment" | "bonus";
  id: string | null;
  label: string;
  amount: number;
  status: ReviewStatus;
  deny_reason: string | null;
};

export type PayoutSnapshot = {
  driverId: string;
  name: string;
  nameAr: string | null;
  // BOTH ARE WRITTEN BY THE RPC, NOT BY THIS FILE. pay_commission (0131) merges
  // `{periodLabel, monthKey}` over whatever snapshot it is handed: the label is
  // derived in SQL from p_month_key with a hardcoded English month array (never
  // to_char, which is lc_time-dependent), and monthKey is the paid scope itself.
  // What TypeScript puts here is a best effort that the database then makes
  // authoritative — one clock, one spelling, no chance of the caption and the
  // scope disagreeing. Read them back from the frozen snapshot, never re-derive.
  periodLabel: string;
  // Null on any payout frozen BEFORE 0131 — those were all-unpaid sweeps with
  // no month at all. Never back-derive it from period_label: that field is a
  // payout-RUN label, not the work period (the payslips work proved a payout
  // labelled "Jul 2026" that paid for work done entirely in June).
  monthKey: string | null;
  baseLines: BaseLine[];
  items: SnapItem[];
  base: number;
  specials: number;
  adjustments: number;
  bonus: number;
  total: number;
};

// Build the frozen snapshot + totals for one driver's CURRENT (unpaid) cycle.
// Totals exclude denied lines (those are what the strict pay flips to approved).
//
// THIS FUNCTION FILTERS NOTHING. It sums exactly the rows it is handed, so the
// CALLER owns the scope — pass the specials/adjustments already narrowed to the
// unpaid rows of the month being paid, the baseLines from buildCurrentBaseLines
// for that same month, and `cycle` = that month's UNPAID cycle row or null.
// Handing it an already-tagged (paid) cycle would put a second copy of a bonus
// the driver has already been paid into the snapshot AND into p_bonus, which
// the RPC then refuses with "bonus already paid" — loudly, but only after the
// figures were wrong.
export function buildPayoutSnapshot(p: {
  driver: DriverLite;
  periodLabel: string;
  monthKey: string | null;
  baseLines: BaseLine[];
  specials: CommExtraRow[];
  adjustments: CommExtraRow[];
  cycle: CommCycle | null;
}): PayoutSnapshot {
  const { driver, periodLabel, monthKey, baseLines, specials, adjustments, cycle } = p;

  const base = round2(baseLines.reduce((s, l) => s + l.amount, 0));

  const items: SnapItem[] = [];
  for (const x of specials) {
    items.push({
      kind: "special",
      id: x.id,
      label: x.label ?? "Special",
      amount: x.amount_sar,
      status: (x.status ?? "pending") as ReviewStatus,
      deny_reason: x.deny_reason ?? null,
    });
  }
  for (const x of adjustments) {
    items.push({
      kind: "adjustment",
      id: x.id,
      label: x.label ?? "Adjustment",
      amount: x.amount_sar,
      status: (x.status ?? "pending") as ReviewStatus,
      deny_reason: x.deny_reason ?? null,
    });
  }
  if (cycle && cycle.bonus_sar !== 0) {
    items.push({
      kind: "bonus",
      id: null,
      label: "Bonus",
      amount: cycle.bonus_sar,
      status: cycle.bonus_status,
      deny_reason: cycle.bonus_deny_reason ?? null,
    });
  }

  const sumKind = (k: SnapItem["kind"]) =>
    round2(items.filter((it) => it.kind === k && it.status !== "denied").reduce((s, it) => s + it.amount, 0));

  const specialsTotal = sumKind("special");
  const adjustmentsTotal = sumKind("adjustment");
  const bonusTotal = sumKind("bonus");
  const total = round2(base + specialsTotal + adjustmentsTotal + bonusTotal);

  return {
    driverId: driver.id,
    name: driver.name,
    nameAr: driver.name_ar,
    periodLabel,
    monthKey,
    baseLines,
    items,
    base,
    specials: specialsTotal,
    adjustments: adjustmentsTotal,
    bonus: bonusTotal,
    total,
  };
}

// ---- History rows -------------------------------------------------------------
// View-only mapping of commission_payouts for the History tab. Newest first;
// optional driver filter.
export type HistoryRow = {
  id: string;
  driverId: string;
  paidAt: string;
  periodLabel: string;
  // The month this payout PAID FOR, read out of the frozen snapshot (0131's RPC
  // writes it). NULL on every pre-0131 record — those swept all unpaid rows
  // regardless of month, so they genuinely have no single month, and the UI
  // must show that rather than guess. NEVER parsed out of periodLabel.
  monthKey: string | null;
  approvedBy: string | null;
  base: number;
  specials: number;
  adjustments: number;
  bonus: number;
  total: number;
};

// snapshot is typed `PayoutSnapshot | unknown` on CommPayout (it is raw jsonb),
// so the month is read defensively: a legacy record has no monthKey key at all,
// and a malformed one must read as "no month", never as a fabricated string.
export function payoutMonthKey(p: CommPayout): string | null {
  const snap = p.snapshot;
  if (!snap || typeof snap !== "object") return null;
  const v = (snap as { monthKey?: unknown }).monthKey;
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function buildHistoryRows(payouts: CommPayout[], driverId?: string, monthKey?: string): HistoryRow[] {
  return payouts
    .filter((p) => !driverId || p.driver_id === driverId)
    // A month filter matches ONLY records that carry that month. Pre-0131
    // payouts have none and are excluded — an unmonthed sweep is not evidence
    // that this month was paid.
    .filter((p) => monthKey == null || payoutMonthKey(p) === monthKey)
    .slice()
    .sort((a, b) => (a.paid_at < b.paid_at ? 1 : a.paid_at > b.paid_at ? -1 : 0))
    .map((p) => ({
      id: p.id,
      driverId: p.driver_id,
      paidAt: p.paid_at,
      periodLabel: p.period_label,
      monthKey: payoutMonthKey(p),
      approvedBy: p.approved_by,
      base: p.base_sar,
      specials: p.specials_sar,
      adjustments: p.adjustments_sar,
      bonus: p.bonus_sar,
      total: p.total_sar,
    }));
}
