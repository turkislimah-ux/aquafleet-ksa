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
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Download, Plus, Pencil, Eye, Save, Trash2, Check, X, Banknote, Info, Ban, RotateCcw } from "lucide-react";
import { Stat, StatusPill } from "@/components/ui";
import { formatSar } from "@/lib/utils";
import { useApp } from "@/components/AppShell";
import { t, fill, plural } from "@/lib/i18n";
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
// scripts/commission-rows-check.ts). Imported here for local use, and re-exported
// below for ONE consumer: DriversClient, which already imports this file for the
// component and takes buildCurrentRows + four row types off the same import.
//
// This comment used to name page.tsx as a second consumer. It no longer is —
// page.tsx imports from "@/lib/commission-rows" directly — and the re-export
// list was trimmed to exactly what DriversClient takes at the same time, so
// "who reads this" is answerable by grepping one import site rather than
// trusting this paragraph. If the last consumer ever goes, so does the
// re-export: lib/commission-rows is the real home and importing from there is
// the shorter path anyway.
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
import ScrollLock from "@/components/ScrollLock";

export { buildCurrentRows } from "@/lib/commission-rows";
export type {
  CommTripRow,
  CommCycle,
  CommSpecialRow,
  CommAdjustmentRow,
} from "@/lib/commission-rows";

// Review pill: map a 3-state review → an existing statusTone token for color.
// approved → blue (scheduled / ready to pay), pending → amber (warning),
// denied → red (critical).
const STATUS_TONE: Record<ReviewStatus, string> = {
  approved: "scheduled",
  pending: "warning",
  denied: "critical",
};
// The matching LABEL map is gone: a review pill now reads
// t(`drivers.comm.status.${status}`) straight off the stored enum, so there is
// no second English-only table to keep in step with the dictionary.

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  // \r is quoted too. The row terminator below is CRLF, so a bare CR inside a
  // value would otherwise be read as the start of one — a driver name pasted in
  // from another system is exactly where that arrives.
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Excel opens a .csv with the SYSTEM list separator, not the comma the format is
// named after. On a locale where that separator is ";" every row lands in a
// single cell, which is what "the export is broken" looks like to the person
// opening it. The `sep=` directive is Excel's own override and is honoured
// whatever the locale, so the file reads the same on every machine.
//
// It costs one stray first row in Numbers/Sheets, which do not know the
// directive. That trade is deliberate: a visible junk row is recoverable in
// seconds, a silently single-columned sheet is not, and Excel is what this file
// is exported for.
const CSV_SEP = ",";
const CSV_SEP_DIRECTIVE = `sep=${CSV_SEP}`;

// Excel assumes the system ANSI codepage unless a UTF-8 BOM says otherwise, and
// without it every Arabic driver name renders as mojibake. The BOM is the whole
// reason this export was unusable for an Arabic roster.
// Built from its code point rather than typed as a literal: U+FEFF renders as
// nothing at all, so a literal here would be invisible in every editor and
// indistinguishable from a stray edit that deleted it.
const UTF8_BOM = String.fromCharCode(0xfeff);

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
  controlsHost = null,
}: {
  drivers: DriverLite[];
  trips: CommTripRow[];
  cycles: CommCycle[];
  specials: CommSpecialRow[];
  adjustments: CommAdjustmentRow[];
  projectsById: Record<string, string>;
  // WHERE the month lens and Export CSV render — not WHETHER. Given a host node
  // they are portalled up beside the sub-tabs; given nothing they stay in this
  // card's own header, which is what a standalone mount (a diagnostic route, a
  // future embed) gets.
  //
  // A PORTAL RATHER THAN LIFTING THE STATE, deliberately. `monthKey` is the lens
  // this file's header calls load-bearing: the figure beside the Pay button and
  // the monthKey handed to payCommission are the same value, and they cannot
  // diverge only because there is exactly one of it. Moving it to the parent
  // would put a prop boundary between the two. `buildMonthOptions` is also
  // module-private, so the parent could not build the option list anyway.
  controlsHost?: HTMLElement | null;
}) {
  const { lang } = useApp();
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
    // Not named `rows` — that is the component's own unfiltered row list, and
    // shadowing it here is how an export quietly starts ignoring the filter.
    const lines = [header, ...body].map((row) => row.map(csvCell).join(CSV_SEP));
    const csv = UTF8_BOM + [CSV_SEP_DIRECTIVE, ...lines].join("\r\n") + "\r\n";
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

  // The two page-scope controls. Rendered once, mounted in one of two places.
  const scopeControls = (
    <div className="flex items-center gap-2 flex-wrap">
      {/* THE LENS — the scope of every figure and every action on this screen,
          not a filter over a rolling balance. Deliberately sized and labelled
          like a scope control rather than dropped in among the status chips. */}
      <label className="flex items-center gap-2 h-9 ps-3 pe-1 rounded-lg border" style={BORDER}>
        <span className="text-xs muted uppercase tracking-[.05em]">{t("drivers.commTab.month", lang)}</span>
        <select
          value={monthKey}
          onChange={(e) => setMonthKey(e.target.value)}
          className="h-7 pe-1 bg-transparent text-sm font-medium outline-none focus:ring-2 focus:ring-brand-500/30 rounded"
        >
          {monthOptions.map((k) => (
            <option key={k} value={k}>
              {monthLabel(k, lang)}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={exportCsv}
        disabled={list.length === 0}
        className="h-9 px-3 rounded-lg text-sm font-medium inline-flex items-center gap-2 border hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 disabled:cursor-not-allowed"
        style={BORDER}
      >
        <Download className="h-4 w-4" /> {t("drivers.commTab.exportCsv", lang)}
      </button>
    </div>
  );

  return (
    <div className="card p-4">
      {controlsHost ? createPortal(scopeControls, controlsHost) : null}

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-emerald-600 dark:text-emerald-400 text-lg">﷼</span>
          <div>
            <h3 className="font-semibold">{t("drivers.commTab.title", lang)}</h3>
            <p className="text-xs muted">
              {t("drivers.commTab.unpaidBalance", lang)} <span className="text-brand-600 dark:text-brand-300">· {monthLabel(monthKey, lang)}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* The status chips filter the TABLE. They stay in the card header
              because that is what they act on; the month lens and the export act
              on the whole screen and have moved up beside the sub-tabs. */}
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
                {s === "all" ? t("common.all", lang) : t(`drivers.comm.status.${s}`, lang)} <span className={filter === s ? "opacity-80" : "muted"}>{chipCount(s)}</span>
              </button>
            ))}
          </div>

          {controlsHost ? null : scopeControls}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label={t("drivers.commTab.statPool", lang)} value={formatSar(pool)} tone="info" />
        <Stat label={t("drivers.commTab.statApproved", lang)} value={formatSar(approvedSum)} tone="ok" />
        <Stat label={t("drivers.commTab.statPending", lang)} value={formatSar(pendingSum)} tone="warn" />
        <Stat label={t("drivers.commTab.statAvg", lang)} value={formatSar(avg)} />
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={TH_CLS}>{t("common.driver", lang)}</th>
              <th className={TH_CLS}>{t("drivers.commTab.thBase", lang)}</th>
              <th className={TH_CLS}>{t("drivers.commTab.specialsBonuses", lang)}</th>
              <th className={TH_CLS}>{t("drivers.comm.adjustments", lang)}</th>
              <th className={TH_CLS}>{t("drivers.comm.total", lang)}</th>
              <th className={TH_CLS}>{t("drivers.commTab.thPayout", lang)}</th>
              <th className="py-2 px-3 bg-black/[.02] dark:bg-white/[.02]" />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 px-3 border-t text-center muted text-sm" style={BORDER}>
                  {fill(t("drivers.commTab.noneInMonth", lang), { month: monthLabel(monthKey, lang) })}
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
                    <span className="font-medium" dir="ltr">{formatSar(r.base)}</span>
                    {/* Two counts, but two INDEPENDENT phrases either side of a
                        separator — so two whole sentences, not a 4×4 cross
                        product. The parentheses stay in the JSX. */}
                    <span className="muted text-[11px] ms-1">({fill(t(`drivers.count.trips.${plural(r.trips)}`, lang), { n: r.trips })} · {fill(t(`drivers.count.projects.${plural(r.projects)}`, lang), { n: r.projects })})</span>
                  </td>
                  <td className="py-2.5 px-3 border-t whitespace-nowrap tabular-nums" style={BORDER}>
                    {r.specials + r.bonus > 0 ? <span className="text-emerald-600 dark:text-emerald-400 font-medium" dir="ltr">+{formatSar(r.specials + r.bonus)}</span> : <span className="muted">—</span>}
                  </td>
                  <td className="py-2.5 px-3 border-t whitespace-nowrap tabular-nums" style={BORDER}>
                    {r.adjustments !== 0 ? (
                      <span className={r.adjustments > 0 ? "text-emerald-600 dark:text-emerald-400 font-medium" : "text-rose-600 dark:text-rose-400 font-medium"} dir="ltr">
                        {r.adjustments > 0 ? "+" : ""}{formatSar(r.adjustments)}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 border-t whitespace-nowrap tabular-nums font-semibold text-brand-600 dark:text-brand-300" style={BORDER}>
                    <span dir="ltr">{formatSar(r.total)}</span>
                  </td>
                  <td className="py-2.5 px-3 border-t whitespace-nowrap" style={BORDER}>
                    <StatusPill status={STATUS_TONE[r.payoutStatus]} label={t(`drivers.comm.status.${r.payoutStatus}`, lang)} />
                  </td>
                  <td className="py-2.5 px-3 border-t whitespace-nowrap" style={BORDER}>
                    <div className="flex items-center justify-end gap-1.5">
                      {editable && (
                        <>
                          <OutlineBtn onClick={() => setSpecialsFor(r.driverId)}>
                            <Plus className="h-3.5 w-3.5" /> {t("drivers.commTab.specialsBonuses", lang)}
                          </OutlineBtn>
                          <OutlineBtn onClick={() => setAdjustmentsFor(r.driverId)}>
                            <Plus className="h-3.5 w-3.5" /> {t("drivers.comm.adjustments", lang)}
                          </OutlineBtn>
                        </>
                      )}
                      <OutlineBtn onClick={() => setBreakdownFor(r.driverId)}>
                        <Eye className="h-3.5 w-3.5" /> {t("drivers.commTab.breakdown", lang)}
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
        {fill(t("drivers.commTab.rules", lang), { month: monthLabel(monthKey, lang) })}
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
  const { lang } = useApp();
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
          <OutlineBtn onClick={onRestore} disabled={busy}><RotateCcw className="h-3.5 w-3.5" /> {t("drivers.commTab.restore", lang)}</OutlineBtn>
        ) : (
          <>
            {status === "pending" && (
              <OutlineBtn onClick={onApprove} disabled={busy}><Check className="h-3.5 w-3.5" /> {t("drivers.commTab.approve", lang)}</OutlineBtn>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={onDeny}
              className="h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border border-rose-300/60 dark:border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
            >
              <Ban className="h-3.5 w-3.5" /> {t("drivers.commTab.deny", lang)}
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
      <ScrollLock />
      <div className="card p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {fill(t("drivers.commTab.breakdownTitle", lang), { name: driverName })}
            {driver?.name_ar ? <span className="muted font-normal"> · {driver.name_ar}</span> : null}
            <span className="muted font-normal"> · {monthLabel(monthKey, lang)}</span>
          </h2>
          <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4">
          {/* State banner */}
          {canReview ? (
            <div className="rounded-lg p-3 text-xs flex items-start gap-2" style={{ background: "rgba(100,116,139,.10)", border: "1px solid rgb(var(--border))" }}>
              <Info className="h-4 w-4 muted mt-0.5 shrink-0" />
              <span>{t("drivers.commTab.reviewPre", lang)} <strong>{monthLabel(monthKey, lang)}</strong> {t("drivers.commTab.reviewMid", lang)} <strong>{t("drivers.commTab.approvePayout", lang)}</strong>{t("drivers.commTab.reviewPost", lang)}</span>
            </div>
          ) : (
            <div className="rounded-lg p-3 text-xs flex items-start gap-2" style={{ background: "rgba(16,185,129,.10)", border: "1px solid rgba(16,185,129,.30)" }}>
              <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
              <span className="text-emerald-700 dark:text-emerald-300">{cycle?.approved_by
                ? fill(t("drivers.commTab.approvedByWho", lang), { month: monthLabel(monthKey, lang), who: cycle.approved_by })
                : fill(t("drivers.commTab.approvedNoWho", lang), { month: monthLabel(monthKey, lang) })} <strong>{t("drivers.commTab.pay", lang)}</strong> {fill(t("drivers.commTab.payFreezes", lang), { month: monthLabel(monthKey, lang) })}</span>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard label={t("common.driver", lang)}>
              <div className="font-medium">{driverName}</div>
              <div className="text-[11px] muted">{monthLabel(monthKey, lang)}</div>
            </SummaryCard>
            <SummaryCard label={t("drivers.commTab.baseProjects", lang)}>
              <div className="text-lg font-semibold tabular-nums"><span dir="ltr">{formatSar(base)}</span></div>
            </SummaryCard>
            <SummaryCard label={t("drivers.commTab.extrasSum", lang)}>
              <div className={"text-lg font-semibold tabular-nums " + (spSum + adjSum + bonusInTotal > 0 ? "text-emerald-600 dark:text-emerald-400" : spSum + adjSum + bonusInTotal < 0 ? "text-rose-600 dark:text-rose-400" : "")}>
                <span dir="ltr">{formatSar(spSum + adjSum + bonusInTotal)}</span>
              </div>
            </SummaryCard>
            <SummaryCard label={t("drivers.commTab.currentTotal", lang)}>
              <div className="text-lg font-semibold tabular-nums text-brand-600 dark:text-brand-300"><span dir="ltr">{formatSar(total)}</span></div>
              <div className="mt-0.5"><StatusPill status={STATUS_TONE[payoutStatus]} label={t(`drivers.comm.status.${payoutStatus}`, lang)} /></div>
            </SummaryCard>
          </div>

          {/* Separator — sets Base Pay apart from the summary cards above. */}
          <hr className="my-4 border-t" style={BORDER} />

          {/* Base lines (read-only — computed-truth) */}
          <section>
            <h4 className="font-semibold text-sm mb-2">{t("drivers.commTab.basePayHeading", lang)}</h4>
            {baseLines.length === 0 ? (
              <p className="muted text-sm">{fill(t("drivers.commTab.noBaseLines", lang), { month: monthLabel(monthKey, lang) })}</p>
            ) : (
              <div className="space-y-2">
                {baseLines.map((l) => (
                  <div key={l.projectId ?? "—"} className="rounded-lg border p-3 flex items-center gap-3 flex-wrap" style={BORDER}>
                    <div className="flex-1 min-w-[180px]">
                      <div className="font-medium text-sm">{l.projectName}</div>
                      <div className="text-[11px] muted">{fill(t(`drivers.count.deliveredTrips.${plural(l.trips)}`, lang), { n: l.trips })}</div>
                    </div>
                    <div className="font-semibold tabular-nums"><span dir="ltr">{formatSar(l.amount)}</span></div>
                  </div>
                ))}
              </div>
            )}
            <div className="text-[11px] muted mt-2">{t("drivers.commTab.basePayNote", lang)}</div>
          </section>

          {/* Separator — sets Base Pay apart from Specials/Bonus/Adjustments below. */}
          <hr className="my-4 border-t" style={BORDER} />

          {/* Specials — review each */}
          <section>
            <h4 className="font-semibold text-sm mb-2">{t("drivers.comm.specials", lang)}</h4>
            {mySpecials.length === 0 ? (
              <p className="muted text-sm">{t("drivers.commTab.noSpecials", lang)}</p>
            ) : (
              <div className="space-y-2">
                {mySpecials.map((sp) => {
                  const denied = sp.status === "denied";
                  return (
                    <div key={sp.id} className={"rounded-lg border p-3 flex items-center gap-3 flex-wrap " + (denied ? "opacity-60" : "")} style={BORDER}>
                      <div className="flex-1 min-w-[200px]">
                        <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                          {sp.is_special_trip && <StatusPill status="scheduled" label={t("drivers.commTab.specialTrip", lang)} />}
                          <StatusPill status={STATUS_TONE[sp.status]} label={t(`drivers.comm.status.${sp.status}`, lang)} />
                          <span className={denied ? "line-through" : ""}>{sp.label}</span>
                        </div>
                        {/* No dir override: this joins an ISO date with a FREE-TEXT
                            note, and forcing the pair LTR would mis-order an Arabic
                            note to straighten a date that bidi already handles. */}
                        <div className="text-[11px] muted">{[sp.date, sp.note].filter(Boolean).join(" · ") || "—"}</div>
                        {denied && sp.deny_reason && <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5">{fill(t("drivers.commTab.reason", lang), { reason: sp.deny_reason })}</div>}
                      </div>
                      <div className={"font-semibold tabular-nums " + (denied ? "muted line-through" : "text-emerald-600 dark:text-emerald-400")}><span dir="ltr">+{formatSar(sp.amount_sar)}</span></div>
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
            <h4 className="font-semibold text-sm mb-2">{t("drivers.commTab.managerBonus", lang)}</h4>
            {bonusAmt === 0 ? (
              <p className="muted text-sm">{t("drivers.commTab.noBonus", lang)}</p>
            ) : (
              <div className={"rounded-lg border p-3 flex items-center gap-3 flex-wrap " + (bonusStatus === "denied" ? "opacity-60" : "")} style={BORDER}>
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                    <Banknote className="h-4 w-4 muted" />
                    <StatusPill status={STATUS_TONE[bonusStatus]} label={t(`drivers.comm.status.${bonusStatus}`, lang)} />
                    <span className={bonusStatus === "denied" ? "line-through" : ""}>{t("drivers.commTab.managerBonus", lang)}</span>
                  </div>
                  <div className="text-[11px] muted">{fill(t("drivers.commTab.discretionaryFor", lang), { month: monthLabel(monthKey, lang) })}</div>
                  {bonusStatus === "denied" && cycle?.bonus_deny_reason && <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5">{fill(t("drivers.commTab.reason", lang), { reason: cycle.bonus_deny_reason })}</div>}
                </div>
                <div className={"font-semibold tabular-nums " + (bonusStatus === "denied" ? "muted line-through" : "text-emerald-600 dark:text-emerald-400")}><span dir="ltr">+{formatSar(bonusAmt)}</span></div>
                {itemControls(
                  bonusStatus,
                  () => run(() => setBonusStatus(driverId, monthKey, "approved")),
                  () => setDenyTarget({ kind: "bonus", id: null, label: t("drivers.commTab.managerBonus", lang), amount: bonusAmt }),
                  () => run(() => setBonusStatus(driverId, monthKey, "pending")),
                )}
              </div>
            )}
          </section>

          {/* Adjustments — review each */}
          <section>
            <h4 className="font-semibold text-sm mb-2">{t("drivers.comm.adjustments", lang)}</h4>
            {myAdjustments.length === 0 ? (
              <p className="muted text-sm">{t("drivers.commTab.noAdjustments", lang)}</p>
            ) : (
              <div className="space-y-2">
                {myAdjustments.map((a) => {
                  const denied = a.status === "denied";
                  return (
                    <div key={a.id} className={"rounded-lg border p-3 flex items-center gap-3 flex-wrap " + (denied ? "opacity-60" : "")} style={BORDER}>
                      <div className="flex-1 min-w-[200px]">
                        <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                          <StatusPill status={STATUS_TONE[a.status]} label={t(`drivers.comm.status.${a.status}`, lang)} />
                          <span className={denied ? "line-through" : ""}>{a.label}</span>
                        </div>
                        {/* No dir override: same reason as the specials line above —
                            the note is free text and may be Arabic. */}
                        <div className="text-[11px] muted">{[a.date, a.note].filter(Boolean).join(" · ") || "—"}</div>
                        {denied && a.deny_reason && <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5">{fill(t("drivers.commTab.reason", lang), { reason: a.deny_reason })}</div>}
                      </div>
                      <div className={"font-semibold tabular-nums " + (denied ? "muted line-through" : a.amount_sar > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                        <span dir="ltr">{a.amount_sar > 0 ? "+" : ""}{formatSar(a.amount_sar)}</span>
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
          <OutlineBtn onClick={onClose}>{t("drivers.close", lang)}</OutlineBtn>
          {payoutStatus === "pending" && (
            <SuccessBtn onClick={() => run(() => approvePayout(driverId, monthKey))} disabled={busy}>
              <Check className="h-3.5 w-3.5" /> {fill(t("drivers.commTab.approveMonthPayout", lang), { month: monthLabel(monthKey, lang) })}
            </SuccessBtn>
          )}
          {payoutStatus === "approved" && (
            <>
              <OutlineBtn onClick={() => run(() => reopenPayout(driverId, monthKey))} disabled={busy}>
                <RotateCcw className="h-3.5 w-3.5" /> {t("drivers.commTab.reopen", lang)}
              </OutlineBtn>
              <PrimaryBtn
                onClick={() =>
                  confirm(
                    fill(t("drivers.commTab.confirmPay", lang), {
                      name: driverName,
                      amount: formatSar(total),
                      month: monthLabel(monthKey, lang),
                    }),
                  ) && run(() => payCommission(driverId, monthKey))
                }
                disabled={busy}
              >
                <Banknote className="h-3.5 w-3.5" /> {fill(t("drivers.commTab.payBtn", lang), { amount: formatSar(total), month: monthLabel(monthKey, lang) })}
              </PrimaryBtn>
            </>
          )}
        </div>
      </div>

      {denyTarget && (
        <DenyModal
          title={fill(t("drivers.commTab.denyKind", lang), { kind: t(`drivers.comm.kind.${denyTarget.kind}`, lang) })}
          prompt={fill(t("drivers.commTab.denyPrompt", lang), { label: denyTarget.label, amount: formatSar(denyTarget.amount) })}
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
  const { lang } = useApp();
  const router = useRouter();
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const mySpecials = specials.filter((s) => s.driver_id === driverId && s.month_key === monthKey && isUnpaid(s));
  const editing = mySpecials.find((s) => s.id === editId) ?? null;

  // The bonus month. Separate from the lens on purpose (see the header note) and
  // deliberately STARTS EMPTY — the month must be picked, it is never defaulted.
  //
  // It used to seed from monthKey, which meant the control could not be empty and
  // so could never refuse a save. That is the wrong shape for this one field: a
  // bonus filed against the wrong month is a money error that nobody sees until
  // that month is paid, and a pre-filled month is exactly how it happens — the
  // reader agrees with a value they never chose. Every OTHER month-scoped write on
  // this screen takes the lens, because the lens is what the reader is looking at;
  // this one does not, because it is the one that can disagree with the lens.
  //
  // Re-seeded to empty (not to the new lens) whenever the lens moves, so moving the
  // lens can never silently re-point a pick made under the old one.
  const [bonusMonth, setBonusMonth] = useState<string>("");
  useEffect(() => setBonusMonth(""), [monthKey]);

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
      <ScrollLock />
      <div className="card p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold">{fill(t("drivers.commTab.specialsTitle", lang), { name: driverName })} <span className="muted font-normal text-sm">· {monthLabel(monthKey, lang)}</span></h2>
          <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]"><X className="h-5 w-5" /></button>
        </div>

        {/* Add / edit special form */}
        <form key={editId ?? "new"} onSubmit={onSubmit} className="rounded-lg border p-3 grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4" style={BORDER}>
          <div className="sm:col-span-2 text-sm font-semibold">{editId ? t("drivers.commTab.editSpecial", lang) : t("drivers.commTab.addSpecial", lang)}</div>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="muted text-xs">{t("drivers.commTab.fLabel", lang)}</span>
            <input name="label" required defaultValue={editing?.label ?? ""} placeholder={t("drivers.commTab.phSpecialLabel", lang)} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted text-xs">{t("drivers.commTab.fAmount", lang)}</span>
            <input name="amount_sar" type="number" min="0" step="10" required defaultValue={editing?.amount_sar ?? 250} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted text-xs">{t("drivers.date", lang)}</span>
            <input name="date" type="date" defaultValue={editing?.date ?? ""} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="muted text-xs">{t("common.note", lang)}</span>
            <input name="note" defaultValue={editing?.note ?? ""} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input name="is_special_trip" type="checkbox" defaultChecked={editing ? editing.is_special_trip : true} /> <span className="muted">{t("drivers.commTab.countsAsSpecialTrip", lang)}</span>
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            {editId && <OutlineBtn onClick={() => setEditId(null)}>{t("drivers.commTab.cancelEdit", lang)}</OutlineBtn>}
            <PrimaryBtn type="submit" disabled={busy}><Save className="h-3.5 w-3.5" /> {busy ? t("common.saving", lang) : editId ? t("drivers.commTab.updateSpecial", lang) : t("drivers.commTab.addSpecial", lang)}</PrimaryBtn>
          </div>
        </form>

        {/* Combined list: specials (edit/delete) + the manager bonus row */}
        <div className="space-y-2">
          {mySpecials.length === 0 && bonus === 0 && (
            <p className="muted text-sm">{fill(t("drivers.commTab.noSpecialsOrBonus", lang), { month: monthLabel(monthKey, lang) })}</p>
          )}

          {mySpecials.map((sp) => {
            const denied = sp.status === "denied";
            return (
              <div key={sp.id} className={"rounded-lg border p-3 flex items-center gap-3 flex-wrap " + (denied ? "opacity-60" : "")} style={BORDER}>
                <div className="flex-1 min-w-[180px]">
                  <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                    {sp.is_special_trip && <StatusPill status="scheduled" label={t("drivers.commTab.specialTrip", lang)} />}
                    <StatusPill status={STATUS_TONE[sp.status]} label={t(`drivers.comm.status.${sp.status}`, lang)} />
                    <span className={denied ? "line-through" : ""}>{sp.label}</span>
                  </div>
                  {/* No dir override — the note is free text and may be Arabic. */}
                  <div className="text-[11px] muted">{[sp.date, sp.note].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <div className={"font-semibold tabular-nums " + (denied ? "muted line-through" : "text-emerald-600 dark:text-emerald-400")}><span dir="ltr">+{formatSar(sp.amount_sar)}</span></div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setEditId(sp.id)} className="muted hover:text-[rgb(var(--fg))]" title={t("common.edit", lang)}><Pencil className="h-4 w-4" /></button>
                  <button type="button" disabled={busy} onClick={() => confirm(t("drivers.commTab.confirmDeleteSpecial", lang)) && run(() => removeCommissionSpecial(sp.id))} className="text-rose-600 dark:text-rose-400 hover:opacity-70 disabled:opacity-50" title={t("common.delete", lang)}><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            );
          })}

          {/* Manager bonus row — inline Set / Remove, with its OWN month. Review
              (approve/deny) is in the Breakdown, under whichever month it was filed. */}
          <div className="rounded-lg border p-3 flex items-center gap-3 flex-wrap" style={{ ...BORDER, background: "rgba(100,116,139,.06)" }}>
            <div className="flex-1 min-w-[180px]">
              <div className="font-medium text-sm flex items-center gap-2"><Banknote className="h-4 w-4 muted" /> {t("drivers.commTab.managerBonus", lang)}</div>
              <div className="text-[11px] muted">
                {bonusMonth
                  ? fill(t("drivers.commTab.discretionaryCurrent", lang), { month: monthLabel(bonusMonth, lang), amount: formatSar(bonus) })
                  : t("drivers.commTab.discretionaryPick", lang)}
              </div>
            </div>
            <select
              value={bonusMonth}
              onChange={(e) => setBonusMonth(e.target.value)}
              disabled={busy}
              className="px-2.5 py-1.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-60"
              style={INPUT_STYLE}
              aria-label={t("drivers.commTab.bonusMonth", lang)}
            >
              <option value="">{t("drivers.commTab.selectMonth", lang)}</option>
              {monthOptions.map((k) => (
                <option key={k} value={k}>
                  {monthLabel(k, lang)}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="50"
              value={bonusVal}
              onChange={(e) => setBonusVal(e.target.value)}
              disabled={busy || !bonusMonth}
              className="px-2.5 py-1.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-28 tabular-nums disabled:opacity-60"
              style={INPUT_STYLE}
            />
            {/* Both the amount and Set are gated on the month, not just Set — an
                editable amount beside a greyed-out Set reads as a broken button. */}
            <OutlineBtn onClick={() => run(() => setCommissionBonus(driverId, bonusMonth, Number(bonusVal) || 0))} disabled={busy || !bonusMonth}>
              <Save className="h-3.5 w-3.5" /> {t("drivers.commTab.set", lang)}
            </OutlineBtn>
            {bonus !== 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => confirm(fill(t("drivers.commTab.confirmRemoveBonus", lang), { month: monthLabel(bonusMonth, lang) })) && run(() => setCommissionBonus(driverId, bonusMonth, 0))}
                className="text-rose-600 dark:text-rose-400 hover:opacity-70 disabled:opacity-50"
                title={t("drivers.commTab.removeBonus", lang)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            {!bonusMonth && (
              <p className="basis-full text-[11px] muted">
                {t("drivers.commTab.noMonthSelected", lang)}
              </p>
            )}
            {bonusMonth !== "" && bonusMonth !== monthKey && (
              <p className="basis-full text-[11px] text-amber-600 dark:text-amber-400">
                {/* ONE stored sentence, not three fragments: `fill` replaces every
                    occurrence, so {bonusMonth} appearing twice is fine — and Arabic
                    is free to order the two months however it reads. */}
                {fill(t("drivers.commTab.filingAgainst", lang), { bonusMonth: monthLabel(bonusMonth, lang), lensMonth: monthLabel(monthKey, lang) })}
              </p>
            )}
          </div>
        </div>

        {err && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{err}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <OutlineBtn onClick={onClose}>{t("drivers.close", lang)}</OutlineBtn>
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
  const { lang } = useApp();
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
      <ScrollLock />
      <div className="card p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold">{fill(t("drivers.commTab.adjustmentsTitle", lang), { name: driverName })} <span className="muted font-normal text-sm">· {monthLabel(monthKey, lang)}</span></h2>
          <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]"><X className="h-5 w-5" /></button>
        </div>

        {/* Add / edit adjustment form */}
        <form key={editId ?? "new"} onSubmit={onSubmit} className="rounded-lg border p-3 grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4" style={BORDER}>
          <div className="sm:col-span-2 text-sm font-semibold">{editId ? t("drivers.commTab.editAdjustment", lang) : t("drivers.commTab.addAdjustment", lang)}</div>
          <p className="text-[11px] muted sm:col-span-2">{t("drivers.commTab.adjustmentNote", lang)}</p>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="muted text-xs">{t("drivers.commTab.fLabel", lang)}</span>
            <input name="label" required defaultValue={editing?.label ?? ""} placeholder={t("drivers.commTab.phAdjustmentLabel", lang)} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted text-xs">{t("drivers.commTab.fAmount", lang)}</span>
            <input name="amount_sar" type="number" step="10" required defaultValue={editing?.amount_sar ?? -100} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted text-xs">{t("drivers.date", lang)}</span>
            <input name="date" type="date" defaultValue={editing?.date ?? ""} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="muted text-xs">{t("common.note", lang)}</span>
            <input name="note" defaultValue={editing?.note ?? ""} className={INPUT} style={INPUT_STYLE} />
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            {editId && <OutlineBtn onClick={() => setEditId(null)}>{t("drivers.commTab.cancelEdit", lang)}</OutlineBtn>}
            <PrimaryBtn type="submit" disabled={busy}><Save className="h-3.5 w-3.5" /> {busy ? t("common.saving", lang) : editId ? t("drivers.commTab.updateAdjustment", lang) : t("drivers.commTab.addAdjustment", lang)}</PrimaryBtn>
          </div>
        </form>

        {/* Adjustments list */}
        <div className="space-y-2">
          {myAdjustments.length === 0 && <p className="muted text-sm">{fill(t("drivers.commTab.noAdjustmentsForMonth", lang), { month: monthLabel(monthKey, lang) })}</p>}
          {myAdjustments.map((a) => {
            const denied = a.status === "denied";
            return (
              <div key={a.id} className={"rounded-lg border p-3 flex items-center gap-3 flex-wrap " + (denied ? "opacity-60" : "")} style={BORDER}>
                <div className="flex-1 min-w-[180px]">
                  <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                    <StatusPill status={STATUS_TONE[a.status]} label={t(`drivers.comm.status.${a.status}`, lang)} />
                    <span className={denied ? "line-through" : ""}>{a.label}</span>
                  </div>
                  {/* No dir override — the note is free text and may be Arabic. */}
                  <div className="text-[11px] muted">{[a.date, a.note].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <div className={"font-semibold tabular-nums " + (denied ? "muted line-through" : a.amount_sar > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                  <span dir="ltr">{a.amount_sar > 0 ? "+" : ""}{formatSar(a.amount_sar)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setEditId(a.id)} className="muted hover:text-[rgb(var(--fg))]" title={t("common.edit", lang)}><Pencil className="h-4 w-4" /></button>
                  <button type="button" disabled={busy} onClick={() => confirm(t("drivers.commTab.confirmDeleteAdjustment", lang)) && run(() => removeCommissionAdjustment(a.id))} className="text-rose-600 dark:text-rose-400 hover:opacity-70 disabled:opacity-50" title={t("common.delete", lang)}><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            );
          })}
        </div>

        {err && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{err}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <OutlineBtn onClick={onClose}>{t("drivers.close", lang)}</OutlineBtn>
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
  const { lang } = useApp();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) {
      setErr(t("drivers.commTab.errReason", lang));
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
      <ScrollLock />
      <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2 capitalize"><Ban className="h-5 w-5 text-rose-600 dark:text-rose-400" /> {title}</h2>
          <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]"><X className="h-5 w-5" /></button>
        </div>
        <p className="text-sm muted mb-3">{prompt}</p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="muted text-xs">{t("drivers.commTab.fReason", lang)}</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            autoFocus
            placeholder={t("drivers.commTab.phReason", lang)}
            className="px-2.5 py-1.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full"
            style={INPUT_STYLE}
          />
        </label>
        {err && <p className="text-sm text-rose-600 dark:text-rose-400 mt-2">{err}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <OutlineBtn onClick={onClose}>{t("common.cancel", lang)}</OutlineBtn>
          <DangerBtn onClick={submit} disabled={busy}><Ban className="h-3.5 w-3.5" /> {busy ? t("drivers.commTab.denying", lang) : t("drivers.commTab.deny", lang)}</DangerBtn>
        </div>
      </div>
    </div>
  );
}
