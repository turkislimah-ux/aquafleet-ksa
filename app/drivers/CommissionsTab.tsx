"use client";

// Commissions tab (READ). Mirrors the demo's COM.section(): month selector, 4
// KPIs, status chips, per-driver payroll table, and a real CSV export.
//
// SINGLE SOURCE OF TRUTH for base pay = trips.commission_sar (stamped on Delivered
// by lib/commission.ts). Base is NEVER stored as a commission line — it is derived
// live here: a driver's delivered trips in the selected month, summed and grouped
// by project. The three commission_* tables only carry the extras (payout status +
// bonus, specials, adjustments). Total = base + specials + adjustments + bonus.
//
// Write actions (Breakdown, Add Special, Add Adjustment, Manager Bonus, payout
// workflow) arrive in the next commit — this commit is read-only.

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Stat, StatusPill } from "@/components/ui";
import { formatSar } from "@/lib/utils";

// --- shared types (also imported by page.tsx for fetching, and DriversClient) ---
export type CommTrip = {
  driver_id: string | null;
  project_id: string | null;
  commission_sar: number | null;
  delivered_at: string | null;
};
export type CommPeriod = {
  driver_id: string;
  month_key: string;
  payout_status: "pending" | "approved" | "paid";
  bonus_sar: number;
};
export type CommExtra = { driver_id: string; month_key: string; amount_sar: number };

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
  status: "pending" | "approved" | "paid";
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// month_key of an ISO timestamp = "YYYY-MM" (matches lib/commission monthKeyOf).
function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

export const CURRENT_MONTH_KEY = new Date().toISOString().slice(0, 7);

// Build per-driver commission rows for one month. PURE — reused by the tab body
// and by the Commissions tab badge (current-month pending count) in DriversClient.
export function buildCommissionRows(p: {
  drivers: DriverLite[];
  trips: CommTrip[];
  periods: CommPeriod[];
  specials: CommExtra[];
  adjustments: CommExtra[];
  monthKey: string;
}): CommissionRow[] {
  const { drivers, trips, periods, specials, adjustments, monthKey } = p;
  const rows: CommissionRow[] = [];
  for (const d of drivers) {
    const dt = trips.filter((t) => t.driver_id === d.id && t.delivered_at && monthKeyOf(t.delivered_at) === monthKey);
    const base = round2(dt.reduce((s, t) => s + (t.commission_sar ?? 0), 0));
    const projects = new Set(dt.map((t) => t.project_id).filter(Boolean)).size;
    const sp = round2(specials.filter((x) => x.driver_id === d.id && x.month_key === monthKey).reduce((s, x) => s + x.amount_sar, 0));
    const adj = round2(adjustments.filter((x) => x.driver_id === d.id && x.month_key === monthKey).reduce((s, x) => s + x.amount_sar, 0));
    const period = periods.find((x) => x.driver_id === d.id && x.month_key === monthKey) ?? null;
    const bonus = round2(period?.bonus_sar ?? 0);
    const status = period?.payout_status ?? "pending";
    // Include a driver only if they have any commission activity this month.
    if (base === 0 && sp === 0 && adj === 0 && bonus === 0 && period == null) continue;
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

// Months offered in the selector: any month with delivered trips or extras, plus
// the current month, newest first.
function availableMonths(trips: CommTrip[], periods: CommPeriod[], specials: CommExtra[], adjustments: CommExtra[]): string[] {
  const set = new Set<string>([CURRENT_MONTH_KEY]);
  for (const t of trips) if (t.delivered_at) set.add(monthKeyOf(t.delivered_at));
  for (const x of periods) set.add(x.month_key);
  for (const x of specials) set.add(x.month_key);
  for (const x of adjustments) set.add(x.month_key);
  return [...set].sort().reverse();
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

// Payout pill: map status → an existing statusTone token for the right color.
// paid → green (active), approved → blue (scheduled→info), pending → amber (warning).
const PAYOUT_TONE: Record<CommissionRow["status"], string> = {
  paid: "active",
  approved: "scheduled",
  pending: "warning",
};
const PAYOUT_LABEL: Record<CommissionRow["status"], string> = {
  paid: "Paid",
  approved: "Approved",
  pending: "Pending",
};

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CHIPS = ["all", "pending", "approved", "paid"] as const;
type Filter = (typeof CHIPS)[number];

export default function CommissionsTab({
  drivers,
  trips,
  periods,
  specials,
  adjustments,
}: {
  drivers: DriverLite[];
  trips: CommTrip[];
  periods: CommPeriod[];
  specials: CommExtra[];
  adjustments: CommExtra[];
}) {
  const [monthKey, setMonthKey] = useState(CURRENT_MONTH_KEY);
  const [filter, setFilter] = useState<Filter>("all");

  const months = useMemo(
    () => availableMonths(trips, periods, specials, adjustments),
    [trips, periods, specials, adjustments],
  );
  const rows = useMemo(
    () => buildCommissionRows({ drivers, trips, periods, specials, adjustments, monthKey }),
    [drivers, trips, periods, specials, adjustments, monthKey],
  );

  const list = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const isCurrent = monthKey === CURRENT_MONTH_KEY;

  const pool = round2(rows.reduce((s, r) => s + r.total, 0));
  const paid = round2(rows.filter((r) => r.status === "paid").reduce((s, r) => s + r.total, 0));
  const pending = round2(rows.filter((r) => r.status === "pending").reduce((s, r) => s + r.total, 0));
  const avg = rows.length ? round2(pool / rows.length) : 0;

  function chipCount(s: Filter): number {
    return s === "all" ? rows.length : rows.filter((r) => r.status === s).length;
  }

  function exportCsv() {
    const header = ["Driver", "Driver ID", "Base SAR", "Trips", "Projects", "Specials SAR", "Adjustments SAR", "Bonus SAR", "Total SAR", "Payout Status", "Month"];
    const body = list.map((r) => [r.name, r.driverId, r.base, r.trips, r.projects, r.specials, r.adjustments, r.bonus, r.total, r.status, monthKey]);
    const csv = [header, ...body].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `commissions-${monthKey}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-emerald-600 dark:text-emerald-400 text-lg">﷼</span>
          <div>
            <h3 className="font-semibold">Driver Commissions</h3>
            <p className="text-xs muted">
              {monthLabel(monthKey)}{" "}
              {isCurrent ? (
                <span className="text-brand-600 dark:text-brand-300">· Current month</span>
              ) : (
                <span className="muted">· Closed month — read-only</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5">
            <span className="muted text-xs">Month:</span>
            <select
              value={monthKey}
              onChange={(e) => setMonthKey(e.target.value)}
              className="px-2 py-1.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
              style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
            >
              {months.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1 flex-wrap">
            {CHIPS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={
                  "px-2.5 py-1 rounded-full text-xs font-medium border transition " +
                  (filter === s ? "bg-brand-600 text-white border-brand-600" : "hover:bg-black/5 dark:hover:bg-white/5")
                }
                style={filter === s ? undefined : { borderColor: "rgb(var(--border))" }}
              >
                {s === "all" ? "All" : PAYOUT_LABEL[s]} <span className={filter === s ? "opacity-80" : "muted"}>{chipCount(s)}</span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={exportCsv}
            disabled={list.length === 0}
            className="h-9 px-3 rounded-lg text-sm font-medium inline-flex items-center gap-2 border hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ borderColor: "rgb(var(--border))" }}
          >
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Total Payout (month)" value={formatSar(pool)} tone="info" />
        <Stat label="Already Paid" value={formatSar(paid)} tone="ok" />
        <Stat label="Pending Approval" value={formatSar(pending)} tone="warn" />
        <Stat label="Avg per Driver" value={formatSar(avg)} />
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-start font-medium muted py-2 px-3 text-xs uppercase tracking-wide whitespace-nowrap">Driver</th>
              <th className="text-start font-medium muted py-2 px-3 text-xs uppercase tracking-wide whitespace-nowrap">Base (Projects × Trips)</th>
              <th className="text-start font-medium muted py-2 px-3 text-xs uppercase tracking-wide whitespace-nowrap">Specials</th>
              <th className="text-start font-medium muted py-2 px-3 text-xs uppercase tracking-wide whitespace-nowrap">Adjustments</th>
              <th className="text-start font-medium muted py-2 px-3 text-xs uppercase tracking-wide whitespace-nowrap">Total</th>
              <th className="text-start font-medium muted py-2 px-3 text-xs uppercase tracking-wide whitespace-nowrap">Payout</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                  No commission records for this month.
                </td>
              </tr>
            )}
            {list.map((r) => (
              <tr key={r.driverId}>
                <td className="py-2.5 px-3 border-t whitespace-nowrap" style={{ borderColor: "rgb(var(--border))" }}>
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full text-white grid place-items-center text-xs font-semibold shrink-0" style={{ background: "#0c66bf" }}>
                      {(r.name.trim().split(/\s+/)[0]?.[0] ?? "?").toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-[11px] muted">{r.nameAr ?? ""}</div>
                    </div>
                  </div>
                </td>
                <td className="py-2.5 px-3 border-t whitespace-nowrap tabular-nums" style={{ borderColor: "rgb(var(--border))" }}>
                  <span className="font-medium">{formatSar(r.base)}</span>
                  <span className="muted text-[11px] ms-1">({r.trips} trips · {r.projects} projects)</span>
                </td>
                <td className="py-2.5 px-3 border-t whitespace-nowrap tabular-nums" style={{ borderColor: "rgb(var(--border))" }}>
                  {r.specials > 0 ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">+{formatSar(r.specials)}</span> : <span className="muted">—</span>}
                </td>
                <td className="py-2.5 px-3 border-t whitespace-nowrap tabular-nums" style={{ borderColor: "rgb(var(--border))" }}>
                  {r.adjustments !== 0 ? (
                    <span className={r.adjustments > 0 ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-rose-600 dark:text-rose-400 font-medium"}>
                      {r.adjustments > 0 ? "+" : ""}{formatSar(r.adjustments)}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="py-2.5 px-3 border-t whitespace-nowrap tabular-nums font-semibold text-brand-600 dark:text-brand-300" style={{ borderColor: "rgb(var(--border))" }}>
                  {formatSar(r.total)}
                </td>
                <td className="py-2.5 px-3 border-t whitespace-nowrap" style={{ borderColor: "rgb(var(--border))" }}>
                  <StatusPill status={PAYOUT_TONE[r.status]} label={PAYOUT_LABEL[r.status]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[11px] muted mt-3 leading-relaxed">
        Rules: commission accrues per delivered trip based on the project&apos;s rate. Special trips &amp; manual adjustments are added on top. Manager can apply a discretionary monthly bonus.
      </div>
    </div>
  );
}
