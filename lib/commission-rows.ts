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

// TWO IMPORTS, BOTH DELIBERATE LEAVES. Neither pulls in React, Supabase or
// anything else that would stop scripts/commission-rows-check.ts running this
// module directly — verified by running it, not assumed. lib/commission's only
// import is a TYPE (erased at runtime) and lib/db-types imports nothing at all,
// so this file's runtime dependency graph is still effectively empty.
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

// A denied item never counts toward money. PURE predicate, used everywhere.
export function isActive(x: { status?: ItemStatus }): boolean {
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
// Reports and on the wrong payslip. Note the "month_key is kept only as a human
// label" comment on setCommissionBonus in app/drivers/actions.ts describes that
// upsert's CONFLICT TARGET (driver_id alone); it is not a statement about the
// views, which do read this column.
export { currentMonthKey };

// Per-project base lines for one driver+month (delivered trips only). PURE.
export function buildBaseLines(
  trips: CommTrip[],
  driverId: string,
  monthKey: string,
  projectsById: Record<string, string>,
): BaseLine[] {
  const map = new Map<string, BaseLine>();
  for (const t of trips) {
    if (t.driver_id !== driverId || !t.delivered_at || monthKeyOf(t.delivered_at) !== monthKey) continue;
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

// A delivered trip in the rolling model (carries payout_id; NULL = current).
export type CommTripRow = {
  driver_id: string | null;
  project_id: string | null;
  commission_sar: number | null;
  delivered_at: string | null;
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

// The single OPEN cycle per driver (commission_periods after 0009). Bonus is
// reviewable; payout_status drives the strict Approve→Pay gate.
export type CommCycle = {
  driver_id: string;
  bonus_sar: number;
  bonus_status: ReviewStatus;
  bonus_deny_reason: string | null;
  payout_status: ReviewStatus;
  approved_by: string | null;
  month_key: string | null;
  deny_reason: string | null;
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
  includeEmpty?: boolean;
}): CurrentRow[] {
  const { drivers, trips, cycles, specials, adjustments, includeEmpty = false } = p;
  const rows: CurrentRow[] = [];
  for (const d of drivers) {
    // Base = unpaid delivered trips for this driver.
    const dt = trips.filter((t) => t.driver_id === d.id && t.delivered_at && isUnpaid(t));
    const base = round2(dt.reduce((s, t) => s + (t.commission_sar ?? 0), 0));
    const projects = new Set(dt.map((t) => t.project_id).filter(Boolean)).size;

    const sp = round2(
      specials.filter((x) => x.driver_id === d.id && isUnpaid(x) && countsForPay(x)).reduce((s, x) => s + x.amount_sar, 0),
    );
    const adj = round2(
      adjustments.filter((x) => x.driver_id === d.id && isUnpaid(x) && countsForPay(x)).reduce((s, x) => s + x.amount_sar, 0),
    );

    const cycle = cycles.find((c) => c.driver_id === d.id) ?? null;
    const bonus = round2(cycle && countsForPay({ status: cycle.bonus_status }) ? cycle.bonus_sar : 0);
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

// Per-project base lines for one driver's CURRENT (unpaid) cycle. Like
// buildBaseLines but filtered by payout_id == null instead of by month. PURE.
export function buildCurrentBaseLines(
  trips: CommTripRow[],
  driverId: string,
  projectsById: Record<string, string>,
): BaseLine[] {
  const map = new Map<string, BaseLine>();
  for (const t of trips) {
    if (t.driver_id !== driverId || !t.delivered_at || !isUnpaid(t)) continue;
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
  periodLabel: string;
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
export function buildPayoutSnapshot(p: {
  driver: DriverLite;
  periodLabel: string;
  baseLines: BaseLine[];
  specials: CommExtraRow[];
  adjustments: CommExtraRow[];
  cycle: CommCycle | null;
}): PayoutSnapshot {
  const { driver, periodLabel, baseLines, specials, adjustments, cycle } = p;

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
  approvedBy: string | null;
  base: number;
  specials: number;
  adjustments: number;
  bonus: number;
  total: number;
};

export function buildHistoryRows(payouts: CommPayout[], driverId?: string): HistoryRow[] {
  return payouts
    .filter((p) => !driverId || p.driver_id === driverId)
    .slice()
    .sort((a, b) => (a.paid_at < b.paid_at ? 1 : a.paid_at > b.paid_at ? -1 : 0))
    .map((p) => ({
      id: p.id,
      driverId: p.driver_id,
      paidAt: p.paid_at,
      periodLabel: p.period_label,
      approvedBy: p.approved_by,
      base: p.base_sar,
      specials: p.specials_sar,
      adjustments: p.adjustments_sar,
      bonus: p.bonus_sar,
      total: p.total_sar,
    }));
}
