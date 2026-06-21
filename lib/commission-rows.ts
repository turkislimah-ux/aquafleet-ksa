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

// month_key of an ISO timestamp = "YYYY-MM" (matches lib/commission monthKeyOf).
export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

export const CURRENT_MONTH_KEY = new Date().toISOString().slice(0, 7);

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
