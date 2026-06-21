"use client";

// Commissions tab. Mirrors the demo's COM namespace: month selector, 4 KPIs,
// status chips, per-driver payroll table, a real CSV export, and the per-driver
// Breakdown modal (specials, adjustments, manager bonus, payout workflow).
//
// SINGLE SOURCE OF TRUTH for base pay = trips.commission_sar (stamped on Delivered
// by lib/commission.ts). Base is NEVER stored as a commission line — it is derived
// live: a driver's delivered trips in the selected month, summed and grouped by
// project. The three commission_* tables only carry the extras (payout status +
// bonus, specials, adjustments). Total = base + specials + adjustments + bonus.
//
// DEVIATION from demo (approved): the demo lets you hand-edit each base line's
// trip count / rate. We don't — base is computed-truth. Corrections happen only
// through specials & adjustments, so the Breakdown shows base lines READ-ONLY.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Plus, Pencil, Eye, Save, Trash2, Check, X, Banknote, Info } from "lucide-react";
import { Stat, StatusPill } from "@/components/ui";
import { formatSar } from "@/lib/utils";
import {
  addCommissionSpecial,
  updateCommissionSpecial,
  removeCommissionSpecial,
  addCommissionAdjustment,
  updateCommissionAdjustment,
  removeCommissionAdjustment,
  setCommissionBonus,
  setPayoutStatus,
  type ActionResult,
} from "./actions";

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
// Minimal shape buildCommissionRows needs; the full rows below extend it.
export type CommExtra = { driver_id: string; month_key: string; amount_sar: number };
export type CommSpecial = CommExtra & {
  id: string;
  label: string;
  date: string | null;
  note: string | null;
  is_special_trip: boolean;
};
export type CommAdjustment = CommExtra & {
  id: string;
  label: string;
  date: string | null;
  note: string | null;
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
  status: "pending" | "approved" | "paid";
};

type BaseLine = { projectId: string | null; projectName: string; trips: number; amount: number };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// month_key of an ISO timestamp = "YYYY-MM" (matches lib/commission monthKeyOf).
function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

export const CURRENT_MONTH_KEY = new Date().toISOString().slice(0, 7);

// Per-project base lines for one driver+month (delivered trips only). PURE.
function buildBaseLines(
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
    const sp = round2(specials.filter((x) => x.driver_id === d.id && x.month_key === monthKey).reduce((s, x) => s + x.amount_sar, 0));
    const adj = round2(adjustments.filter((x) => x.driver_id === d.id && x.month_key === monthKey).reduce((s, x) => s + x.amount_sar, 0));
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

const BORDER = { borderColor: "rgb(var(--border))" } as const;
// Header cells mirror the demo's `.tbl th`: .7rem uppercase, .05em tracking, a
// subtle band, and roomy .5rem/.75rem padding (the demo's spacing, not tighter).
const TH_CLS =
  "text-start font-medium muted py-2 px-3 text-[.7rem] uppercase tracking-[.05em] whitespace-nowrap bg-black/[.02] dark:bg-white/[.02]";
const INPUT = "px-2.5 py-1.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

function OutlineBtn({
  onClick,
  children,
  disabled,
  type = "button",
}: {
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
      style={BORDER}
    >
      {children}
    </button>
  );
}

export default function CommissionsTab({
  drivers,
  trips,
  periods,
  specials,
  adjustments,
  projectsById,
}: {
  drivers: DriverLite[];
  trips: CommTrip[];
  periods: CommPeriod[];
  specials: CommSpecial[];
  adjustments: CommAdjustment[];
  projectsById: Record<string, string>;
}) {
  const [monthKey, setMonthKey] = useState(CURRENT_MONTH_KEY);
  const [filter, setFilter] = useState<Filter>("all");
  const [breakdownFor, setBreakdownFor] = useState<string | null>(null);
  // Special & Adjustment editors are their own distinct modals (create or edit).
  const [specialModal, setSpecialModal] = useState<{ driverId: string; entry: CommSpecial | null } | null>(null);
  const [adjustModal, setAdjustModal] = useState<{ driverId: string; entry: CommAdjustment | null } | null>(null);

  const months = useMemo(
    () => availableMonths(trips, periods, specials, adjustments),
    [trips, periods, specials, adjustments],
  );
  const rows = useMemo(
    () => buildCommissionRows({ drivers, trips, periods, specials, adjustments, monthKey, includeEmpty: true }),
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
              style={INPUT_STYLE}
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
                style={filter === s ? undefined : BORDER}
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
            style={BORDER}
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
              <th className={TH_CLS}>Driver</th>
              <th className={TH_CLS}>Base (Projects × Trips)</th>
              <th className={TH_CLS}>Specials / Bonuses</th>
              <th className={TH_CLS}>Adjustments</th>
              <th className={TH_CLS}>Total</th>
              <th className={TH_CLS}>Payout</th>
              <th className="py-2 px-3 bg-black/[.02] dark:bg-white/[.02]" />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 px-3 border-t text-center muted text-sm" style={BORDER}>
                  No commission records for this month.
                </td>
              </tr>
            )}
            {list.map((r) => {
              const editable = isCurrent && r.status !== "paid";
              return (
                <tr key={r.driverId}>
                  <td className="py-2.5 px-3 border-t whitespace-nowrap" style={BORDER}>
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
                  <td className="py-2.5 px-3 border-t whitespace-nowrap tabular-nums" style={BORDER}>
                    <span className="font-medium">{formatSar(r.base)}</span>
                    <span className="muted text-[11px] ms-1">({r.trips} trips · {r.projects} projects)</span>
                  </td>
                  <td className="py-2.5 px-3 border-t whitespace-nowrap tabular-nums" style={BORDER}>
                    {r.specials > 0 ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">+{formatSar(r.specials)}</span> : <span className="muted">—</span>}
                  </td>
                  <td className="py-2.5 px-3 border-t whitespace-nowrap tabular-nums" style={BORDER}>
                    {r.adjustments !== 0 ? (
                      <span className={r.adjustments > 0 ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-rose-600 dark:text-rose-400 font-medium"}>
                        {r.adjustments > 0 ? "+" : ""}{formatSar(r.adjustments)}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 border-t whitespace-nowrap tabular-nums font-semibold text-brand-600 dark:text-brand-300" style={BORDER}>
                    {formatSar(r.total)}
                  </td>
                  <td className="py-2.5 px-3 border-t whitespace-nowrap" style={BORDER}>
                    <StatusPill status={PAYOUT_TONE[r.status]} label={PAYOUT_LABEL[r.status]} />
                  </td>
                  <td className="py-2.5 px-3 border-t whitespace-nowrap" style={BORDER}>
                    <div className="flex items-center justify-end gap-1.5">
                      {editable && (
                        <>
                          <OutlineBtn onClick={() => setSpecialModal({ driverId: r.driverId, entry: null })}>
                            <Plus className="h-3.5 w-3.5" /> Special
                          </OutlineBtn>
                          <OutlineBtn onClick={() => setAdjustModal({ driverId: r.driverId, entry: null })}>
                            <Plus className="h-3.5 w-3.5" /> Adjust
                          </OutlineBtn>
                        </>
                      )}
                      <OutlineBtn onClick={() => setBreakdownFor(r.driverId)}>
                        <Eye className="h-3.5 w-3.5" /> Breakdown
                      </OutlineBtn>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-[11px] muted mt-3 leading-relaxed">
        Rules: commission accrues per delivered trip based on the project&apos;s rate (auto-derived — not editable here).
        Special trips &amp; manual adjustments are added on top. Manager can apply a discretionary monthly bonus.
      </div>

      {breakdownFor && (
        <BreakdownModal
          driverId={breakdownFor}
          monthKey={monthKey}
          drivers={drivers}
          trips={trips}
          periods={periods}
          specials={specials}
          adjustments={adjustments}
          projectsById={projectsById}
          onAddSpecial={(id) => setSpecialModal({ driverId: id, entry: null })}
          onEditSpecial={(sp) => setSpecialModal({ driverId: sp.driver_id, entry: sp })}
          onAddAdjust={(id) => setAdjustModal({ driverId: id, entry: null })}
          onEditAdjust={(a) => setAdjustModal({ driverId: a.driver_id, entry: a })}
          onClose={() => setBreakdownFor(null)}
        />
      )}

      {specialModal && (
        <SpecialModal
          driverId={specialModal.driverId}
          monthKey={monthKey}
          entry={specialModal.entry}
          onClose={() => setSpecialModal(null)}
        />
      )}
      {adjustModal && (
        <AdjustmentModal
          driverId={adjustModal.driverId}
          monthKey={monthKey}
          entry={adjustModal.entry}
          onClose={() => setAdjustModal(null)}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Breakdown modal — per driver, per month. All numbers recompute from props, so
// after any write + router.refresh() the open modal reflects the new data.
// ----------------------------------------------------------------------------
function BreakdownModal({
  driverId,
  monthKey,
  drivers,
  trips,
  periods,
  specials,
  adjustments,
  projectsById,
  onAddSpecial,
  onEditSpecial,
  onAddAdjust,
  onEditAdjust,
  onClose,
}: {
  driverId: string;
  monthKey: string;
  drivers: DriverLite[];
  trips: CommTrip[];
  periods: CommPeriod[];
  specials: CommSpecial[];
  adjustments: CommAdjustment[];
  projectsById: Record<string, string>;
  onAddSpecial: (driverId: string) => void;
  onEditSpecial: (entry: CommSpecial) => void;
  onAddAdjust: (driverId: string) => void;
  onEditAdjust: (entry: CommAdjustment) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const driver = drivers.find((d) => d.id === driverId);
  const baseLines = useMemo(() => buildBaseLines(trips, driverId, monthKey, projectsById), [trips, driverId, monthKey, projectsById]);
  const mySpecials = specials.filter((s) => s.driver_id === driverId && s.month_key === monthKey);
  const myAdjustments = adjustments.filter((a) => a.driver_id === driverId && a.month_key === monthKey);
  const period = periods.find((p) => p.driver_id === driverId && p.month_key === monthKey) ?? null;
  const bonus = round2(period?.bonus_sar ?? 0);
  const status = period?.payout_status ?? "pending";

  const base = round2(baseLines.reduce((s, l) => s + l.amount, 0));
  const spSum = round2(mySpecials.reduce((s, x) => s + x.amount_sar, 0));
  const adjSum = round2(myAdjustments.reduce((s, x) => s + x.amount_sar, 0));
  const total = round2(base + spSum + adjSum + bonus);

  const isCurrent = monthKey === CURRENT_MONTH_KEY;
  const editable = isCurrent && status !== "paid";

  const [bonusVal, setBonusVal] = useState(String(bonus));
  useEffect(() => setBonusVal(String(bonus)), [bonus]);

  async function run(fn: () => Promise<ActionResult>): Promise<boolean> {
    setBusy(true);
    setErr(null);
    const res = await fn();
    setBusy(false);
    if (res.error) {
      setErr(res.error);
      return false;
    }
    router.refresh();
    return true;
  }

  const driverName = driver?.name ?? driverId;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div className="card p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold">
            Commission Breakdown — {driverName}
            {driver?.name_ar ? <span className="muted font-normal"> · {driver.name_ar}</span> : null}
          </h2>
          <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4">
          {!editable && (
            <div className="rounded-lg p-3 text-xs flex items-start gap-2" style={{ background: "rgba(100,116,139,.10)", border: "1px solid rgb(var(--border))" }}>
              <Info className="h-4 w-4 muted mt-0.5 shrink-0" />
              <span>{status === "paid" ? "Paid — locked." : "Closed month — read-only."} {monthLabel(monthKey)}</span>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label="Driver">
              <div className="font-medium">{driverName}</div>
              <div className="text-[11px] muted">{monthLabel(monthKey)}</div>
            </SummaryCard>
            <SummaryCard label="Base (projects)">
              <div className="text-lg font-semibold tabular-nums">{formatSar(base)}</div>
            </SummaryCard>
            <SummaryCard label="Specials + Adjustments + Bonus">
              <div className={"text-lg font-semibold tabular-nums " + (spSum + adjSum + bonus > 0 ? "text-emerald-600 dark:text-emerald-400" : spSum + adjSum + bonus < 0 ? "text-rose-600 dark:text-rose-400" : "")}>
                {formatSar(spSum + adjSum + bonus)}
              </div>
            </SummaryCard>
            <SummaryCard label="Month Total">
              <div className="text-lg font-semibold tabular-nums text-brand-600 dark:text-brand-300">{formatSar(total)}</div>
              <div className="mt-0.5"><StatusPill status={PAYOUT_TONE[status]} label={PAYOUT_LABEL[status]} /></div>
            </SummaryCard>
          </div>

          {/* Base lines (read-only — computed-truth) */}
          <section>
            <h4 className="font-semibold text-sm mb-2">Projects &amp; Base Pay</h4>
            {baseLines.length === 0 ? (
              <p className="muted text-sm">No delivered trips for this driver this month.</p>
            ) : (
              <div className="space-y-2">
                {baseLines.map((l) => (
                  <div key={l.projectId ?? "—"} className="rounded-lg border p-3 flex items-center gap-3 flex-wrap" style={BORDER}>
                    <div className="flex-1 min-w-[180px]">
                      <div className="font-medium text-sm">{l.projectName}</div>
                      <div className="text-[11px] muted">{l.trips} delivered {l.trips === 1 ? "trip" : "trips"}</div>
                    </div>
                    <div className="font-semibold tabular-nums">{formatSar(l.amount)}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="text-[11px] muted mt-2">Base pay is auto-derived from each delivered trip&apos;s stamped commission. To correct it, add a special or an adjustment below.</div>
          </section>

          {/* Specials / Bonuses */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-sm">Specials / Bonuses</h4>
              {editable && (
                <OutlineBtn onClick={() => onAddSpecial(driverId)}><Plus className="h-3.5 w-3.5" /> Add Special</OutlineBtn>
              )}
            </div>
            {mySpecials.length === 0 ? (
              <p className="muted text-sm">No special trips logged.</p>
            ) : (
              <div className="space-y-2">
                {mySpecials.map((sp) => (
                  <div key={sp.id} className="rounded-lg border p-3 flex items-center gap-3 flex-wrap" style={BORDER}>
                    <div className="flex-1 min-w-[200px]">
                      <div className="font-medium text-sm flex items-center gap-2">
                        {sp.is_special_trip && <StatusPill status="scheduled" label="Special trip" />}
                        {sp.label}
                      </div>
                      <div className="text-[11px] muted">{[sp.date, sp.note].filter(Boolean).join(" · ") || "—"}</div>
                    </div>
                    <div className="text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">+{formatSar(sp.amount_sar)}</div>
                    {editable && (
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => onEditSpecial(sp)} className="muted hover:text-[rgb(var(--fg))]" title="Edit">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" disabled={busy} onClick={() => confirm("Remove this special?") && run(() => removeCommissionSpecial(sp.id))} className="text-rose-600 dark:text-rose-400 hover:opacity-70 disabled:opacity-50" title="Remove">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Adjustments */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold text-sm">Adjustments</h4>
              {editable && (
                <OutlineBtn onClick={() => onAddAdjust(driverId)}><Plus className="h-3.5 w-3.5" /> Add Adjustment</OutlineBtn>
              )}
            </div>
            {myAdjustments.length === 0 ? (
              <p className="muted text-sm">No adjustments.</p>
            ) : (
              <div className="space-y-2">
                {myAdjustments.map((a) => (
                  <div key={a.id} className="rounded-lg border p-3 flex items-center gap-3 flex-wrap" style={BORDER}>
                    <div className="flex-1 min-w-[200px]">
                      <div className="font-medium text-sm">{a.label}</div>
                      <div className="text-[11px] muted">{[a.date, a.note].filter(Boolean).join(" · ") || "—"}</div>
                    </div>
                    <div className={(a.amount_sar > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400") + " font-semibold tabular-nums"}>
                      {a.amount_sar > 0 ? "+" : ""}{formatSar(a.amount_sar)}
                    </div>
                    {editable && (
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => onEditAdjust(a)} className="muted hover:text-[rgb(var(--fg))]" title="Edit">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" disabled={busy} onClick={() => confirm("Remove this adjustment?") && run(() => removeCommissionAdjustment(a.id))} className="text-rose-600 dark:text-rose-400 hover:opacity-70 disabled:opacity-50" title="Remove">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Manager bonus */}
          <section className="rounded-lg border p-3 flex items-center gap-3 flex-wrap" style={BORDER}>
            <div className="flex-1 min-w-[180px]">
              <div className="font-semibold text-sm">Manager Bonus</div>
              <div className="text-[11px] muted">Discretionary monthly bonus.</div>
            </div>
            <input
              type="number"
              min="0"
              step="50"
              value={bonusVal}
              onChange={(e) => setBonusVal(e.target.value)}
              disabled={!editable || busy}
              className="px-2.5 py-1.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-28 tabular-nums disabled:opacity-60"
              style={INPUT_STYLE}
            />
            {editable && (
              <OutlineBtn onClick={() => run(() => setCommissionBonus(driverId, monthKey, Number(bonusVal) || 0))} disabled={busy}>
                <Save className="h-3.5 w-3.5" /> Set bonus
              </OutlineBtn>
            )}
          </section>

          {err && <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>}
        </div>

        {/* Footer — payout workflow */}
        <div className="flex justify-end gap-2 mt-5 flex-wrap">
          <OutlineBtn onClick={onClose}>Close</OutlineBtn>
          {editable && status === "pending" && (
            <OutlineBtn onClick={() => run(() => setPayoutStatus(driverId, monthKey, "approved"))} disabled={busy}>
              <Check className="h-3.5 w-3.5" /> Approve
            </OutlineBtn>
          )}
          {editable && (
            <PrimaryBtn onClick={() => confirm("Mark this payout as PAID? This locks the month for this driver.") && run(() => setPayoutStatus(driverId, monthKey, "paid"))} disabled={busy}>
              <Banknote className="h-3.5 w-3.5" /> Mark paid
            </PrimaryBtn>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card p-3">
      <div className="text-xs muted">{label}</div>
      {children}
    </div>
  );
}

function PrimaryBtn({
  onClick,
  children,
  disabled,
  type = "button",
}: {
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="h-8 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

// ----------------------------------------------------------------------------
// Special editor — its own distinct modal (create or edit). Only special fields.
// ----------------------------------------------------------------------------
function SpecialModal({
  driverId,
  monthKey,
  entry,
  onClose,
}: {
  driverId: string;
  monthKey: string;
  entry: CommSpecial | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("driver_id", driverId);
    fd.set("month_key", monthKey);
    setBusy(true);
    setErr(null);
    const res = entry ? await updateCommissionSpecial(entry.id, fd) : await addCommissionSpecial(fd);
    setBusy(false);
    if (res.error) {
      setErr(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold">{entry ? "Edit Special" : "Add Special"}</h2>
          <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="muted text-xs">Label</span>
            <input name="label" required defaultValue={entry?.label ?? ""} placeholder="e.g. Emergency desert run" className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted text-xs">Amount (SAR)</span>
            <input name="amount_sar" type="number" min="0" step="10" required defaultValue={entry?.amount_sar ?? 250} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted text-xs">Date</span>
            <input name="date" type="date" defaultValue={entry?.date ?? ""} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="muted text-xs">Note</span>
            <input name="note" defaultValue={entry?.note ?? ""} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input name="is_special_trip" type="checkbox" defaultChecked={entry ? entry.is_special_trip : true} /> <span className="muted">Counts as a special trip</span>
          </label>
          {err && <p className="text-sm text-rose-600 dark:text-rose-400 sm:col-span-2">{err}</p>}
          <div className="flex justify-end gap-2 sm:col-span-2 mt-1">
            <OutlineBtn onClick={onClose}>Cancel</OutlineBtn>
            <PrimaryBtn type="submit" disabled={busy}><Save className="h-3.5 w-3.5" /> {busy ? "Saving…" : entry ? "Update" : "Add"}</PrimaryBtn>
          </div>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Adjustment editor — its own distinct modal (create or edit). Adjustment fields
// only; amount may be negative (a deduction).
// ----------------------------------------------------------------------------
function AdjustmentModal({
  driverId,
  monthKey,
  entry,
  onClose,
}: {
  driverId: string;
  monthKey: string;
  entry: CommAdjustment | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("driver_id", driverId);
    fd.set("month_key", monthKey);
    setBusy(true);
    setErr(null);
    const res = entry ? await updateCommissionAdjustment(entry.id, fd) : await addCommissionAdjustment(fd);
    setBusy(false);
    if (res.error) {
      setErr(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold">{entry ? "Edit Adjustment" : "Add Adjustment"}</h2>
          <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <p className="text-[11px] muted sm:col-span-2">Positive adds, negative deducts (e.g. uniform deduction).</p>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="muted text-xs">Label</span>
            <input name="label" required defaultValue={entry?.label ?? ""} placeholder="e.g. Uniform deduction" className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted text-xs">Amount (SAR)</span>
            <input name="amount_sar" type="number" step="10" required defaultValue={entry?.amount_sar ?? -100} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted text-xs">Date</span>
            <input name="date" type="date" defaultValue={entry?.date ?? ""} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="muted text-xs">Note</span>
            <input name="note" defaultValue={entry?.note ?? ""} className={INPUT} style={INPUT_STYLE} />
          </label>
          {err && <p className="text-sm text-rose-600 dark:text-rose-400 sm:col-span-2">{err}</p>}
          <div className="flex justify-end gap-2 sm:col-span-2 mt-1">
            <OutlineBtn onClick={onClose}>Cancel</OutlineBtn>
            <PrimaryBtn type="submit" disabled={busy}><Save className="h-3.5 w-3.5" /> {busy ? "Saving…" : entry ? "Update" : "Add"}</PrimaryBtn>
          </div>
        </form>
      </div>
    </div>
  );
}
