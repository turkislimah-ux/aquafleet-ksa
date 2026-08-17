"use client";

// Commissions tab — ONE MONTH AT A TIME (migration 0131). The month lens at the
// top of this tab is not a filter over a rolling balance; it IS the scope of
// every figure and every action on the screen. "This month's balance" = the
// driver's UNPAID delivered trips whose trip_date falls in the lens month, plus
// UNPAID specials/adjustments filed under that month_key, plus that month's
// cycle bonus. The Breakdown is the DECISION CENTER: approve/deny/restore each
// line + the bonus, see the live total, then Approve the payout and (strictly)
// Pay — which freezes a History snapshot and resets THAT MONTH to zero. Other
// months are untouched and stay payable on their own.
//
// THE LENS IS CLIENT-SIDE. page.tsx fetches every unpaid row once (with
// trip_date and month_key); the month never round-trips. But the number beside
// the Pay button and the monthKey handed to payCommission come from the SAME
// lens value, so what is shown and what is paid cannot diverge.
//
// TRIPS BUCKET ON trip_date, NOT delivered_at (0109 — this fleet advances the
// Kanban in bulk, so delivered_at records when a button was pressed). This is
// the same predicate pay_commission uses to tag the trips it pays for.
//
// SINGLE SOURCE OF TRUTH for base pay = trips.commission_sar (stamped on Delivered
// by lib/commission.ts). Base is NEVER stored as a commission line — it is derived
// live: a driver's unpaid delivered trips, summed and grouped by project. The three
// commission_* tables only carry the extras (open-cycle bonus + status, specials,
// adjustments). Total = base + Σ(specials≠denied) + Σ(adjustments≠denied) + bonus≠denied.
//
// MONEY RULE: pending AND approved both COUNT; only DENIED is excluded. A denied
// line stays visible (struck/greyed + reason) and is restorable until Pay.
//
// The two manage popups (Specials/Bonuses, Adjustments) are ADD / EDIT / DELETE
// only — every approve/deny/restore decision lives in the Breakdown. Setting or
// removing the bonus amount lives in the Specials popup; its review is in Breakdown.
//
// DEVIATION from demo (approved): the demo lets you hand-edit each base line's
// trip count / rate. We don't — base is computed-truth.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Plus, Pencil, Eye, Save, Trash2, Check, X, Banknote, Info, Ban, RotateCcw } from "lucide-react";
import { Stat, StatusPill } from "@/components/ui";
import { formatSar } from "@/lib/utils";
import {
  addCommissionSpecial,
  updateCommissionSpecial,
  removeCommissionSpecial,
  setSpecialStatus,
  addCommissionAdjustment,
  updateCommissionAdjustment,
  removeCommissionAdjustment,
  setAdjustmentStatus,
  setCommissionBonus,
  setBonusStatus,
  approvePayout,
  reopenPayout,
  payCommission,
  type ActionResult,
} from "./actions";

// Pure money math + shared types live in a NON-client module so they are
// unit-testable without React (see lib/commission-rows.ts and
// scripts/commission-rows-check.ts). Import for local use here, and re-export so
// the existing "./CommissionsTab" import sites (page.tsx, DriversClient) keep
// resolving these from here unchanged.
import {
  round2,
  countsForPay,
  isUnpaid,
  buildCurrentRows,
  buildCurrentBaseLines,
  currentMonthKey,
  monthLabel,
  type DriverLite,
  type CommTripRow,
  type CommCycle,
  type CommSpecialRow,
  type CommAdjustmentRow,
  type ReviewStatus,
} from "@/lib/commission-rows";

export { buildCurrentRows } from "@/lib/commission-rows";
export type {
  DriverLite,
  CommTripRow,
  CommCycle,
  CommSpecialRow,
  CommAdjustmentRow,
  CurrentRow,
} from "@/lib/commission-rows";

// Review pill: map a 3-state review → an existing statusTone token for color.
// approved → blue (scheduled / ready to pay), pending → amber (warning),
// denied → red (critical).
const STATUS_TONE: Record<ReviewStatus, string> = {
  approved: "scheduled",
  pending: "warning",
  denied: "critical",
};
const STATUS_LABEL: Record<ReviewStatus, string> = {
  approved: "Approved",
  pending: "Pending",
  denied: "Denied",
};

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CHIPS = ["all", "pending", "approved", "denied"] as const;
type Filter = (typeof CHIPS)[number];

// Every month the lens can be pointed at: the months that actually carry unpaid
// work, plus the current month (which must always be selectable even before the
// first trip of it lands, since that is where a new special/bonus is filed).
// Descending — the newest month is the one being settled.
//
// A trip contributes its trip_date's month; an extra/cycle contributes its
// month_key verbatim. A row with no date contributes NOTHING rather than being
// swept into the current month — the same refusal-to-guess as inMonth() in
// lib/commission-rows.ts.
function buildMonthOptions(
  trips: CommTripRow[],
  cycles: CommCycle[],
  specials: CommSpecialRow[],
  adjustments: CommAdjustmentRow[],
): string[] {
  const keys = new Set<string>([currentMonthKey()]);
  for (const t of trips) {
    if (t.trip_date) keys.add(t.trip_date.slice(0, 7));
  }
  for (const c of cycles) {
    if (c.month_key) keys.add(c.month_key);
  }
  for (const x of [...specials, ...adjustments]) {
    if (x.month_key) keys.add(x.month_key);
  }
  return [...keys].sort().reverse();
}

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

function SuccessBtn({
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
      className="h-8 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function DangerBtn({
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
      className="h-8 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
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

export default function CommissionsTab({
  drivers,
  trips,
  cycles,
  specials,
  adjustments,
  projectsById,
}: {
  drivers: DriverLite[];
  trips: CommTripRow[];
  cycles: CommCycle[];
  specials: CommSpecialRow[];
  adjustments: CommAdjustmentRow[];
  projectsById: Record<string, string>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [breakdownFor, setBreakdownFor] = useState<string | null>(null);
  // Manage popups: each holds a driverId; the popup itself reads live props.
  const [specialsFor, setSpecialsFor] = useState<string | null>(null);
  const [adjustmentsFor, setAdjustmentsFor] = useState<string | null>(null);

  // THE LENS. Defaults to the current month — the month a manager is settling on
  // any ordinary day — and every figure below is scoped to it.
  const [monthKey, setMonthKey] = useState<string>(() => currentMonthKey());
  const monthOptions = useMemo(
    () => buildMonthOptions(trips, cycles, specials, adjustments),
    [trips, cycles, specials, adjustments],
  );

  const rows = useMemo(
    () => buildCurrentRows({ drivers, trips, cycles, specials, adjustments, monthKey, includeEmpty: true }),
    [drivers, trips, cycles, specials, adjustments, monthKey],
  );

  const list = filter === "all" ? rows : rows.filter((r) => r.payoutStatus === filter);

  const pool = round2(rows.reduce((s, r) => s + r.total, 0));
  const approvedSum = round2(rows.filter((r) => r.payoutStatus === "approved").reduce((s, r) => s + r.total, 0));
  const pendingSum = round2(rows.filter((r) => r.payoutStatus === "pending").reduce((s, r) => s + r.total, 0));
  const activeCount = rows.filter((r) => r.hasActivity).length;
  const avg = activeCount ? round2(pool / activeCount) : 0;

  function chipCount(s: Filter): number {
    return s === "all" ? rows.length : rows.filter((r) => r.payoutStatus === s).length;
  }

  const driverNameById = useMemo(() => new Map(drivers.map((d) => [d.id, d.name])), [drivers]);

  function exportCsv() {
    const header = ["Driver", "Driver ID", "Month", "Base SAR", "Trips", "Projects", "Specials SAR", "Adjustments SAR", "Bonus SAR", "Total SAR", "Payout Status"];
    const body = list.map((r) => [r.name, r.driverId, monthKey, r.base, r.trips, r.projects, r.specials, r.adjustments, r.bonus, r.total, r.payoutStatus]);
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
              Unpaid balance <span className="text-brand-600 dark:text-brand-300">· {monthLabel(monthKey)}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* THE LENS — the scope of every figure and every action on this screen,
              not a filter over a rolling balance. Deliberately sized and labelled
              like a scope control rather than dropped in among the status chips. */}
          <label className="flex items-center gap-2 h-9 ps-3 pe-1 rounded-lg border" style={BORDER}>
            <span className="text-xs muted uppercase tracking-[.05em]">Month</span>
            <select
              value={monthKey}
              onChange={(e) => setMonthKey(e.target.value)}
              className="h-7 pe-1 bg-transparent text-sm font-medium outline-none focus:ring-2 focus:ring-brand-500/30 rounded"
            >
              {monthOptions.map((k) => (
                <option key={k} value={k}>
                  {monthLabel(k)}
                </option>
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
                {s === "all" ? "All" : STATUS_LABEL[s]} <span className={filter === s ? "opacity-80" : "muted"}>{chipCount(s)}</span>
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
        <Stat label="Current Pool" value={formatSar(pool)} tone="info" />
        <Stat label="Approved (awaiting pay)" value={formatSar(approvedSum)} tone="ok" />
        <Stat label="Pending Review" value={formatSar(pendingSum)} tone="warn" />
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
                  No commission activity in {monthLabel(monthKey)}.
                </td>
              </tr>
            )}
            {list.map((r) => {
              const editable = r.payoutStatus === "pending";
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
                    {r.specials + r.bonus > 0 ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">+{formatSar(r.specials + r.bonus)}</span> : <span className="muted">—</span>}
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
                    <StatusPill status={STATUS_TONE[r.payoutStatus]} label={STATUS_LABEL[r.payoutStatus]} />
                  </td>
                  <td className="py-2.5 px-3 border-t whitespace-nowrap" style={BORDER}>
                    <div className="flex items-center justify-end gap-1.5">
                      {editable && (
                        <>
                          <OutlineBtn onClick={() => setSpecialsFor(r.driverId)}>
                            <Plus className="h-3.5 w-3.5" /> Specials / Bonuses
                          </OutlineBtn>
                          <OutlineBtn onClick={() => setAdjustmentsFor(r.driverId)}>
                            <Plus className="h-3.5 w-3.5" /> Adjustments
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
        Rules: commission accrues per delivered trip based on the project&apos;s rate (auto-derived — not editable here),
        and lands in the month the trip ran. Specials, the bonus &amp; adjustments are added on top of the month they are
        filed under. Review each line in the Breakdown — pending &amp; approved count, denied is excluded. Approve the
        payout, then Pay to freeze a History record and settle {monthLabel(monthKey)}. Every other month is untouched
        and stays payable on its own.
      </div>

      {breakdownFor && (
        <BreakdownModal
          driverId={breakdownFor}
          monthKey={monthKey}
          drivers={drivers}
          trips={trips}
          cycles={cycles}
          specials={specials}
          adjustments={adjustments}
          projectsById={projectsById}
          onClose={() => setBreakdownFor(null)}
        />
      )}

      {specialsFor && (
        <SpecialsModal
          driverId={specialsFor}
          driverName={driverNameById.get(specialsFor) ?? specialsFor}
          monthKey={monthKey}
          monthOptions={monthOptions}
          specials={specials}
          cycles={cycles}
          onClose={() => setSpecialsFor(null)}
        />
      )}

      {adjustmentsFor && (
        <AdjustmentsModal
          driverId={adjustmentsFor}
          driverName={driverNameById.get(adjustmentsFor) ?? adjustmentsFor}
          monthKey={monthKey}
          adjustments={adjustments}
          onClose={() => setAdjustmentsFor(null)}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Breakdown modal — the DECISION CENTER. Per-line approve/deny/restore (specials,
// adjustments, bonus), a LIVE total (pending+approved count, denied excluded),
// then Approve payout → strict Pay. All numbers recompute from props, so after
// any write + router.refresh() it reflects the new data.
//
// SCOPED TO ONE MONTH (0131). The monthKey it receives is the tab's lens, and it
// is BOTH what every figure here is computed from AND what is handed to
// payCommission — so the amount on the Pay button is the amount that gets paid,
// against the month it is captioned with. Every review action carries the same
// key, because approve/deny now flip one month's rows, not the driver's whole
// unpaid history.
// ----------------------------------------------------------------------------
type DenyTarget =
  | { kind: "special"; id: string; label: string; amount: number }
  | { kind: "adjustment"; id: string; label: string; amount: number }
  | { kind: "bonus"; id: null; label: string; amount: number };

function BreakdownModal({
  driverId,
  monthKey,
  drivers,
  trips,
  cycles,
  specials,
  adjustments,
  projectsById,
  onClose,
}: {
  driverId: string;
  monthKey: string;
  drivers: DriverLite[];
  trips: CommTripRow[];
  cycles: CommCycle[];
  specials: CommSpecialRow[];
  adjustments: CommAdjustmentRow[];
  projectsById: Record<string, string>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [denyTarget, setDenyTarget] = useState<DenyTarget | null>(null);

  const driver = drivers.find((d) => d.id === driverId);
  const baseLines = useMemo(
    () => buildCurrentBaseLines(trips, driverId, projectsById, monthKey),
    [trips, driverId, projectsById, monthKey],
  );
  const mySpecials = specials.filter((s) => s.driver_id === driverId && s.month_key === monthKey && isUnpaid(s));
  const myAdjustments = adjustments.filter((a) => a.driver_id === driverId && a.month_key === monthKey && isUnpaid(a));
  // (driver, month) is the GRAIN of commission_periods since 0131, and isUnpaid
  // keeps a settled month's bonus out — it is frozen in that payout's snapshot,
  // and pay_commission would refuse to pay it a second time anyway.
  const cycle = cycles.find((c) => c.driver_id === driverId && c.month_key === monthKey && isUnpaid(c)) ?? null;
  const bonusAmt = round2(cycle?.bonus_sar ?? 0);
  const bonusStatus: ReviewStatus = cycle?.bonus_status ?? "pending";
  const payoutStatus: ReviewStatus = cycle?.payout_status ?? "pending";

  const base = round2(baseLines.reduce((s, l) => s + l.amount, 0));
  const spSum = round2(mySpecials.filter(countsForPay).reduce((s, x) => s + x.amount_sar, 0));
  const adjSum = round2(myAdjustments.filter(countsForPay).reduce((s, x) => s + x.amount_sar, 0));
  const bonusInTotal = bonusAmt !== 0 && countsForPay({ status: bonusStatus }) ? bonusAmt : 0;
  const total = round2(base + spSum + adjSum + bonusInTotal);

  // pending → review lines + Approve payout. approved → frozen for pay (Reopen to edit).
  const canReview = payoutStatus === "pending";
  const driverName = driver?.name ?? driverId;

  async function run(fn: () => Promise<ActionResult>): Promise<void> {
    setBusy(true);
    setErr(null);
    const res = await fn();
    setBusy(false);
    if (res.error) {
      setErr(res.error);
      return;
    }
    router.refresh();
  }

  // Per-line review controls (shown only while the payout is pending).
  function itemControls(status: ReviewStatus, onApprove: () => void, onDeny: () => void, onRestore: () => void) {
    if (!canReview) return null;
    return (
      <div className="flex items-center gap-1.5">
        {status === "denied" ? (
          <OutlineBtn onClick={onRestore} disabled={busy}><RotateCcw className="h-3.5 w-3.5" /> Restore</OutlineBtn>
        ) : (
          <>
            {status === "pending" && (
              <OutlineBtn onClick={onApprove} disabled={busy}><Check className="h-3.5 w-3.5" /> Approve</OutlineBtn>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={onDeny}
              className="h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border border-rose-300/60 dark:border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
            >
              <Ban className="h-3.5 w-3.5" /> Deny
            </button>
          </>
        )}
      </div>
    );
  }

  function onDenyConfirm(reason: string): Promise<ActionResult> {
    if (!denyTarget) return Promise.resolve({ error: "No target." });
    if (denyTarget.kind === "special") return setSpecialStatus(denyTarget.id, "denied", reason);
    if (denyTarget.kind === "adjustment") return setAdjustmentStatus(denyTarget.id, "denied", reason);
    return setBonusStatus(driverId, monthKey, "denied", reason);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div className="card p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold">
            Commission Breakdown — {driverName}
            {driver?.name_ar ? <span className="muted font-normal"> · {driver.name_ar}</span> : null}
            <span className="muted font-normal"> · {monthLabel(monthKey)}</span>
          </h2>
          <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4">
          {/* State banner */}
          {canReview ? (
            <div className="rounded-lg p-3 text-xs flex items-start gap-2" style={{ background: "rgba(100,116,139,.10)", border: "1px solid rgb(var(--border))" }}>
              <Info className="h-4 w-4 muted mt-0.5 shrink-0" />
              <span>Everything below is <strong>{monthLabel(monthKey)}</strong> only. Review each line (Approve / Deny / Restore), then <strong>Approve payout</strong>. Pending and approved both count toward the total; denied is excluded.</span>
            </div>
          ) : (
            <div className="rounded-lg p-3 text-xs flex items-start gap-2" style={{ background: "rgba(16,185,129,.10)", border: "1px solid rgba(16,185,129,.30)" }}>
              <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
              <span className="text-emerald-700 dark:text-emerald-300">{monthLabel(monthKey)} approved{cycle?.approved_by ? ` by ${cycle.approved_by}` : ""} — ready to pay. <strong>Pay</strong> freezes a History record and settles {monthLabel(monthKey)}; every other month stays payable on its own. Reopen to edit again.</span>
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
              <div className={"text-lg font-semibold tabular-nums " + (spSum + adjSum + bonusInTotal > 0 ? "text-emerald-600 dark:text-emerald-400" : spSum + adjSum + bonusInTotal < 0 ? "text-rose-600 dark:text-rose-400" : "")}>
                {formatSar(spSum + adjSum + bonusInTotal)}
              </div>
            </SummaryCard>
            <SummaryCard label="Current Total">
              <div className="text-lg font-semibold tabular-nums text-brand-600 dark:text-brand-300">{formatSar(total)}</div>
              <div className="mt-0.5"><StatusPill status={STATUS_TONE[payoutStatus]} label={STATUS_LABEL[payoutStatus]} /></div>
            </SummaryCard>
          </div>

          {/* Separator — sets Base Pay apart from the summary cards above. */}
          <hr className="my-4 border-t" style={BORDER} />

          {/* Base lines (read-only — computed-truth) */}
          <section>
            <h4 className="font-semibold text-sm mb-2">Projects &amp; Base Pay</h4>
            {baseLines.length === 0 ? (
              <p className="muted text-sm">No unpaid delivered trips for this driver in {monthLabel(monthKey)}.</p>
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
            <div className="text-[11px] muted mt-2">Base pay is auto-derived from each delivered trip&apos;s stamped commission. Edit specials, the bonus, or adjustments from the row buttons.</div>
          </section>

          {/* Separator — sets Base Pay apart from Specials/Bonus/Adjustments below. */}
          <hr className="my-4 border-t" style={BORDER} />

          {/* Specials — review each */}
          <section>
            <h4 className="font-semibold text-sm mb-2">Specials</h4>
            {mySpecials.length === 0 ? (
              <p className="muted text-sm">No specials.</p>
            ) : (
              <div className="space-y-2">
                {mySpecials.map((sp) => {
                  const denied = sp.status === "denied";
                  return (
                    <div key={sp.id} className={"rounded-lg border p-3 flex items-center gap-3 flex-wrap " + (denied ? "opacity-60" : "")} style={BORDER}>
                      <div className="flex-1 min-w-[200px]">
                        <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                          {sp.is_special_trip && <StatusPill status="scheduled" label="Special trip" />}
                          <StatusPill status={STATUS_TONE[sp.status]} label={STATUS_LABEL[sp.status]} />
                          <span className={denied ? "line-through" : ""}>{sp.label}</span>
                        </div>
                        <div className="text-[11px] muted">{[sp.date, sp.note].filter(Boolean).join(" · ") || "—"}</div>
                        {denied && sp.deny_reason && <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5">Reason: {sp.deny_reason}</div>}
                      </div>
                      <div className={"font-semibold tabular-nums " + (denied ? "muted line-through" : "text-emerald-600 dark:text-emerald-400")}>+{formatSar(sp.amount_sar)}</div>
                      {itemControls(
                        sp.status,
                        () => run(() => setSpecialStatus(sp.id, "approved")),
                        () => setDenyTarget({ kind: "special", id: sp.id, label: sp.label, amount: sp.amount_sar }),
                        () => run(() => setSpecialStatus(sp.id, "pending")),
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Bonus — reviewable line */}
          <section>
            <h4 className="font-semibold text-sm mb-2">Manager Bonus</h4>
            {bonusAmt === 0 ? (
              <p className="muted text-sm">No bonus set.</p>
            ) : (
              <div className={"rounded-lg border p-3 flex items-center gap-3 flex-wrap " + (bonusStatus === "denied" ? "opacity-60" : "")} style={BORDER}>
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                    <Banknote className="h-4 w-4 muted" />
                    <StatusPill status={STATUS_TONE[bonusStatus]} label={STATUS_LABEL[bonusStatus]} />
                    <span className={bonusStatus === "denied" ? "line-through" : ""}>Manager Bonus</span>
                  </div>
                  <div className="text-[11px] muted">Discretionary bonus for {monthLabel(monthKey)}.</div>
                  {bonusStatus === "denied" && cycle?.bonus_deny_reason && <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5">Reason: {cycle.bonus_deny_reason}</div>}
                </div>
                <div className={"font-semibold tabular-nums " + (bonusStatus === "denied" ? "muted line-through" : "text-emerald-600 dark:text-emerald-400")}>+{formatSar(bonusAmt)}</div>
                {itemControls(
                  bonusStatus,
                  () => run(() => setBonusStatus(driverId, monthKey, "approved")),
                  () => setDenyTarget({ kind: "bonus", id: null, label: "Manager Bonus", amount: bonusAmt }),
                  () => run(() => setBonusStatus(driverId, monthKey, "pending")),
                )}
              </div>
            )}
          </section>

          {/* Adjustments — review each */}
          <section>
            <h4 className="font-semibold text-sm mb-2">Adjustments</h4>
            {myAdjustments.length === 0 ? (
              <p className="muted text-sm">No adjustments.</p>
            ) : (
              <div className="space-y-2">
                {myAdjustments.map((a) => {
                  const denied = a.status === "denied";
                  return (
                    <div key={a.id} className={"rounded-lg border p-3 flex items-center gap-3 flex-wrap " + (denied ? "opacity-60" : "")} style={BORDER}>
                      <div className="flex-1 min-w-[200px]">
                        <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                          <StatusPill status={STATUS_TONE[a.status]} label={STATUS_LABEL[a.status]} />
                          <span className={denied ? "line-through" : ""}>{a.label}</span>
                        </div>
                        <div className="text-[11px] muted">{[a.date, a.note].filter(Boolean).join(" · ") || "—"}</div>
                        {denied && a.deny_reason && <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5">Reason: {a.deny_reason}</div>}
                      </div>
                      <div className={"font-semibold tabular-nums " + (denied ? "muted line-through" : a.amount_sar > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                        {a.amount_sar > 0 ? "+" : ""}{formatSar(a.amount_sar)}
                      </div>
                      {itemControls(
                        a.status,
                        () => run(() => setAdjustmentStatus(a.id, "approved")),
                        () => setDenyTarget({ kind: "adjustment", id: a.id, label: a.label, amount: a.amount_sar }),
                        () => run(() => setAdjustmentStatus(a.id, "pending")),
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {err && <p className="text-sm text-rose-600 dark:text-rose-400">{err}</p>}
        </div>

        {/* Footer — Approve payout → strict Pay. */}
        <div className="flex justify-end gap-2 mt-5 flex-wrap">
          <OutlineBtn onClick={onClose}>Close</OutlineBtn>
          {payoutStatus === "pending" && (
            <SuccessBtn onClick={() => run(() => approvePayout(driverId, monthKey))} disabled={busy}>
              <Check className="h-3.5 w-3.5" /> Approve {monthLabel(monthKey)} payout
            </SuccessBtn>
          )}
          {payoutStatus === "approved" && (
            <>
              <OutlineBtn onClick={() => run(() => reopenPayout(driverId, monthKey))} disabled={busy}>
                <RotateCcw className="h-3.5 w-3.5" /> Reopen
              </OutlineBtn>
              <PrimaryBtn
                onClick={() =>
                  confirm(
                    `Pay ${driverName} ${formatSar(total)} for ${monthLabel(monthKey)}? This freezes a History record and settles that month. Other months are untouched.`,
                  ) && run(() => payCommission(driverId, monthKey))
                }
                disabled={busy}
              >
                <Banknote className="h-3.5 w-3.5" /> Pay {formatSar(total)} · {monthLabel(monthKey)}
              </PrimaryBtn>
            </>
          )}
        </div>
      </div>

      {denyTarget && (
        <DenyModal
          title={`Deny ${denyTarget.kind}`}
          prompt={`Deny "${denyTarget.label}" (${formatSar(denyTarget.amount)}). It stays visible but is excluded from the total until restored.`}
          onConfirm={onDenyConfirm}
          onClose={() => setDenyTarget(null)}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Specials & Bonuses manage popup — ADD / EDIT / DELETE only (review lives in the
// Breakdown). Plus the Manager-Bonus row (inline amount Set / Remove). Status is
// shown read-only for context; setting the bonus re-opens its review (→ pending).
//
// SPECIALS ARE FILED UNDER THE LENS MONTH, always — the list and the add form use
// the same key, so a special added here appears in the view that added it.
//
// THE BONUS IS THE ONE EXCEPTION and has its OWN month picker, because a bonus is
// a decision about a month rather than an event that happened on a date: a manager
// settling August routinely awards a bonus for July's work. The picker defaults to
// the lens month; pointing it elsewhere is allowed and SAID OUT LOUD, because the
// amount then leaves this view entirely. Since 0131 that key is also the conflict
// target of setCommissionBonus's upsert — the wrong key writes a real bonus against
// a month nobody is looking at.
// ----------------------------------------------------------------------------
function SpecialsModal({
  driverId,
  driverName,
  monthKey,
  monthOptions,
  specials,
  cycles,
  onClose,
}: {
  driverId: string;
  driverName: string;
  monthKey: string;
  monthOptions: string[];
  specials: CommSpecialRow[];
  cycles: CommCycle[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mySpecials = specials.filter((s) => s.driver_id === driverId && s.month_key === monthKey && isUnpaid(s));
  const editing = mySpecials.find((s) => s.id === editId) ?? null;

  // The bonus month. Separate from the lens on purpose (see the header note) and
  // re-seeded whenever the lens moves, so the default is always "the month I am
  // looking at" rather than a stale pick from a previous open.
  const [bonusMonth, setBonusMonth] = useState<string>(monthKey);
  useEffect(() => setBonusMonth(monthKey), [monthKey]);

  // The bonus SHOWN is the one on that month's own cycle row. isUnpaid keeps a
  // settled month's frozen bonus out of an editable box — setCommissionBonus
  // would refuse the write anyway, and showing it as editable invites the attempt.
  const bonusCycle = cycles.find((c) => c.driver_id === driverId && c.month_key === bonusMonth && isUnpaid(c)) ?? null;
  const bonus = round2(bonusCycle?.bonus_sar ?? 0);
  const [bonusVal, setBonusVal] = useState(String(bonus));
  useEffect(() => setBonusVal(String(bonus)), [bonus]);

  async function run(fn: () => Promise<ActionResult>): Promise<void> {
    setBusy(true);
    setErr(null);
    const res = await fn();
    setBusy(false);
    if (res.error) {
      setErr(res.error);
      return;
    }
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("driver_id", driverId);
    fd.set("month_key", monthKey);
    setBusy(true);
    setErr(null);
    const res = editId ? await updateCommissionSpecial(editId, fd) : await addCommissionSpecial(fd);
    setBusy(false);
    if (res.error) {
      setErr(res.error);
      return;
    }
    router.refresh();
    setEditId(null);
    form.reset();
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div className="card p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold">Specials &amp; Bonuses — {driverName} <span className="muted font-normal text-sm">· {monthLabel(monthKey)}</span></h2>
          <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]"><X className="h-5 w-5" /></button>
        </div>

        {/* Add / edit special form */}
        <form key={editId ?? "new"} onSubmit={onSubmit} className="rounded-lg border p-3 grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4" style={BORDER}>
          <div className="sm:col-span-2 text-sm font-semibold">{editId ? "Edit special" : "Add special"}</div>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="muted text-xs">Label</span>
            <input name="label" required defaultValue={editing?.label ?? ""} placeholder="e.g. Emergency desert run" className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted text-xs">Amount (SAR)</span>
            <input name="amount_sar" type="number" min="0" step="10" required defaultValue={editing?.amount_sar ?? 250} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted text-xs">Date</span>
            <input name="date" type="date" defaultValue={editing?.date ?? ""} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="muted text-xs">Note</span>
            <input name="note" defaultValue={editing?.note ?? ""} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input name="is_special_trip" type="checkbox" defaultChecked={editing ? editing.is_special_trip : true} /> <span className="muted">Counts as a special trip</span>
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            {editId && <OutlineBtn onClick={() => setEditId(null)}>Cancel edit</OutlineBtn>}
            <PrimaryBtn type="submit" disabled={busy}><Save className="h-3.5 w-3.5" /> {busy ? "Saving…" : editId ? "Update special" : "Add special"}</PrimaryBtn>
          </div>
        </form>

        {/* Combined list: specials (edit/delete) + the manager bonus row */}
        <div className="space-y-2">
          {mySpecials.length === 0 && bonus === 0 && (
            <p className="muted text-sm">No specials or bonus for {monthLabel(monthKey)} yet.</p>
          )}

          {mySpecials.map((sp) => {
            const denied = sp.status === "denied";
            return (
              <div key={sp.id} className={"rounded-lg border p-3 flex items-center gap-3 flex-wrap " + (denied ? "opacity-60" : "")} style={BORDER}>
                <div className="flex-1 min-w-[180px]">
                  <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                    {sp.is_special_trip && <StatusPill status="scheduled" label="Special trip" />}
                    <StatusPill status={STATUS_TONE[sp.status]} label={STATUS_LABEL[sp.status]} />
                    <span className={denied ? "line-through" : ""}>{sp.label}</span>
                  </div>
                  <div className="text-[11px] muted">{[sp.date, sp.note].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <div className={"font-semibold tabular-nums " + (denied ? "muted line-through" : "text-emerald-600 dark:text-emerald-400")}>+{formatSar(sp.amount_sar)}</div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setEditId(sp.id)} className="muted hover:text-[rgb(var(--fg))]" title="Edit"><Pencil className="h-4 w-4" /></button>
                  <button type="button" disabled={busy} onClick={() => confirm("Delete this special permanently?") && run(() => removeCommissionSpecial(sp.id))} className="text-rose-600 dark:text-rose-400 hover:opacity-70 disabled:opacity-50" title="Delete"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            );
          })}

          {/* Manager bonus row — inline Set / Remove, with its OWN month. Review
              (approve/deny) is in the Breakdown, under whichever month it was filed. */}
          <div className="rounded-lg border p-3 flex items-center gap-3 flex-wrap" style={{ ...BORDER, background: "rgba(100,116,139,.06)" }}>
            <div className="flex-1 min-w-[180px]">
              <div className="font-medium text-sm flex items-center gap-2"><Banknote className="h-4 w-4 muted" /> Manager Bonus</div>
              <div className="text-[11px] muted">
                Discretionary bonus for {monthLabel(bonusMonth)} (current: {formatSar(bonus)}).
              </div>
            </div>
            <select
              value={bonusMonth}
              onChange={(e) => setBonusMonth(e.target.value)}
              disabled={busy}
              className="px-2.5 py-1.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-60"
              style={INPUT_STYLE}
              aria-label="Bonus month"
            >
              {monthOptions.map((k) => (
                <option key={k} value={k}>
                  {monthLabel(k)}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="50"
              value={bonusVal}
              onChange={(e) => setBonusVal(e.target.value)}
              disabled={busy}
              className="px-2.5 py-1.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-28 tabular-nums disabled:opacity-60"
              style={INPUT_STYLE}
            />
            <OutlineBtn onClick={() => run(() => setCommissionBonus(driverId, bonusMonth, Number(bonusVal) || 0))} disabled={busy}>
              <Save className="h-3.5 w-3.5" /> Set
            </OutlineBtn>
            {bonus !== 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => confirm(`Remove the ${monthLabel(bonusMonth)} manager bonus?`) && run(() => setCommissionBonus(driverId, bonusMonth, 0))}
                className="text-rose-600 dark:text-rose-400 hover:opacity-70 disabled:opacity-50"
                title="Remove bonus"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            {bonusMonth !== monthKey && (
              <p className="basis-full text-[11px] text-amber-600 dark:text-amber-400">
                Filing against {monthLabel(bonusMonth)}, not {monthLabel(monthKey)} — this amount will not appear in
                the view you are in. Switch the tab&apos;s month lens to {monthLabel(bonusMonth)} to review and pay it.
              </p>
            )}
          </div>
        </div>

        {err && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{err}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <OutlineBtn onClick={onClose}>Close</OutlineBtn>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Adjustments manage popup — ADD / EDIT / DELETE only (review lives in the
// Breakdown). Amount may be negative (a deduction); no min/max/sign limiter.
//
// Filed under the LENS month, and the list is that month's rows — the same key
// both ways, so an adjustment added here shows up in the view that added it.
// There is deliberately no month picker: unlike the bonus, an adjustment is an
// event with a date, and the month it belongs to is the month being settled.
// ----------------------------------------------------------------------------
function AdjustmentsModal({
  driverId,
  driverName,
  monthKey,
  adjustments,
  onClose,
}: {
  driverId: string;
  driverName: string;
  monthKey: string;
  adjustments: CommAdjustmentRow[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const myAdjustments = adjustments.filter((a) => a.driver_id === driverId && a.month_key === monthKey && isUnpaid(a));
  const editing = myAdjustments.find((a) => a.id === editId) ?? null;

  async function run(fn: () => Promise<ActionResult>): Promise<void> {
    setBusy(true);
    setErr(null);
    const res = await fn();
    setBusy(false);
    if (res.error) {
      setErr(res.error);
      return;
    }
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("driver_id", driverId);
    fd.set("month_key", monthKey);
    setBusy(true);
    setErr(null);
    const res = editId ? await updateCommissionAdjustment(editId, fd) : await addCommissionAdjustment(fd);
    setBusy(false);
    if (res.error) {
      setErr(res.error);
      return;
    }
    router.refresh();
    setEditId(null);
    form.reset();
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div className="card p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold">Adjustments — {driverName} <span className="muted font-normal text-sm">· {monthLabel(monthKey)}</span></h2>
          <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]"><X className="h-5 w-5" /></button>
        </div>

        {/* Add / edit adjustment form */}
        <form key={editId ?? "new"} onSubmit={onSubmit} className="rounded-lg border p-3 grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4" style={BORDER}>
          <div className="sm:col-span-2 text-sm font-semibold">{editId ? "Edit adjustment" : "Add adjustment"}</div>
          <p className="text-[11px] muted sm:col-span-2">Positive adds, negative deducts (e.g. uniform deduction). No limit.</p>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="muted text-xs">Label</span>
            <input name="label" required defaultValue={editing?.label ?? ""} placeholder="e.g. Uniform deduction" className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted text-xs">Amount (SAR)</span>
            <input name="amount_sar" type="number" step="10" required defaultValue={editing?.amount_sar ?? -100} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted text-xs">Date</span>
            <input name="date" type="date" defaultValue={editing?.date ?? ""} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="muted text-xs">Note</span>
            <input name="note" defaultValue={editing?.note ?? ""} className={INPUT} style={INPUT_STYLE} />
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            {editId && <OutlineBtn onClick={() => setEditId(null)}>Cancel edit</OutlineBtn>}
            <PrimaryBtn type="submit" disabled={busy}><Save className="h-3.5 w-3.5" /> {busy ? "Saving…" : editId ? "Update adjustment" : "Add adjustment"}</PrimaryBtn>
          </div>
        </form>

        {/* Adjustments list */}
        <div className="space-y-2">
          {myAdjustments.length === 0 && <p className="muted text-sm">No adjustments for {monthLabel(monthKey)} yet.</p>}
          {myAdjustments.map((a) => {
            const denied = a.status === "denied";
            return (
              <div key={a.id} className={"rounded-lg border p-3 flex items-center gap-3 flex-wrap " + (denied ? "opacity-60" : "")} style={BORDER}>
                <div className="flex-1 min-w-[180px]">
                  <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                    <StatusPill status={STATUS_TONE[a.status]} label={STATUS_LABEL[a.status]} />
                    <span className={denied ? "line-through" : ""}>{a.label}</span>
                  </div>
                  <div className="text-[11px] muted">{[a.date, a.note].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <div className={"font-semibold tabular-nums " + (denied ? "muted line-through" : a.amount_sar > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                  {a.amount_sar > 0 ? "+" : ""}{formatSar(a.amount_sar)}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setEditId(a.id)} className="muted hover:text-[rgb(var(--fg))]" title="Edit"><Pencil className="h-4 w-4" /></button>
                  <button type="button" disabled={busy} onClick={() => confirm("Delete this adjustment permanently?") && run(() => removeCommissionAdjustment(a.id))} className="text-rose-600 dark:text-rose-400 hover:opacity-70 disabled:opacity-50" title="Delete"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            );
          })}
        </div>

        {err && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{err}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <OutlineBtn onClick={onClose}>Close</OutlineBtn>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// DenyModal — captures a required reason, then runs onConfirm. Used for per-item
// deny (special / adjustment / bonus) in the Breakdown.
// ----------------------------------------------------------------------------
function DenyModal({
  title,
  prompt,
  onConfirm,
  onClose,
}: {
  title: string;
  prompt: string;
  onConfirm: (reason: string) => Promise<ActionResult>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) {
      setErr("Enter a reason.");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await onConfirm(reason.trim());
    setBusy(false);
    if (res.error) {
      setErr(res.error);
      return;
    }
    router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4 bg-black/50" onClick={onClose}>
      <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2 capitalize"><Ban className="h-5 w-5 text-rose-600 dark:text-rose-400" /> {title}</h2>
          <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]"><X className="h-5 w-5" /></button>
        </div>
        <p className="text-sm muted mb-3">{prompt}</p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="muted text-xs">Reason (required)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Why is this being denied?"
            className="px-2.5 py-1.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full"
            style={INPUT_STYLE}
          />
        </label>
        {err && <p className="text-sm text-rose-600 dark:text-rose-400 mt-2">{err}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <OutlineBtn onClick={onClose}>Cancel</OutlineBtn>
          <DangerBtn onClick={submit} disabled={busy}><Ban className="h-3.5 w-3.5" /> {busy ? "Denying…" : "Deny"}</DangerBtn>
        </div>
      </div>
    </div>
  );
}
