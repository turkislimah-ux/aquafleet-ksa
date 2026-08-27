"use client";

// Commission History — VIEW ONLY. Lists frozen payout records from
// commission_payouts (each made by the strict Pay in the Breakdown). Opening a
// record shows the FROZEN snapshot (jsonb captured at pay time) — base lines +
// every item (denied lines struck/greyed with reason) + the totals the driver
// was actually paid. Print renders only the record (scoped @media print in
// globals.css isolates #history-print).
//
// Nothing here mutates: a paid cycle is immutable. Filter by driver and/or by
// the month the payout PAID FOR to browse.
//
// SINCE 0131 A PAYOUT SETTLES ONE MONTH, and the month it settled is read out of
// the frozen snapshot (payoutMonthKey), never out of period_label — period_label
// is a payout-RUN caption, not the work period, and the live data proves the two
// come apart (a run labelled "Jul 2026" paid for work done entirely in June).
// A pre-0131 record swept EVERY unpaid row regardless of month, so it genuinely
// has no single month: it renders an em dash in the Month column and is excluded
// from every specific-month filter. An unmonthed sweep is not evidence that the
// month you picked was paid — so it is never counted as one.

import { useMemo, useState } from "react";
import { Eye, X, Printer, History as HistoryIcon } from "lucide-react";
import { Stat, StatusPill, Table, TH, TD } from "@/components/ui";
import { useApp } from "@/components/AppShell";
import { t, fill, plural, arText, type Lang } from "@/lib/i18n";
import { formatDateTime, formatSar } from "@/lib/utils";
import {
  buildHistoryRows,
  monthLabel,
  payoutMonthKey,
  type CommPayout,
  type DriverLite,
  type PayoutSnapshot,
  type SnapItem,
} from "@/lib/commission-rows";
import ScrollLock from "@/components/ScrollLock";

function fmtDate(iso: string): string {
  // Frozen paid_at is an ISO timestamptz. Show date + short time.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatDateTime(d, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The "some payouts are hidden" note. ONE WHOLE SENTENCE per plural bucket —
 * Arabic inflects the counted noun, so there is no "{n} + word" seam to splice.
 * `{months}` survives `fill()` untouched and is the seam the <em> goes into,
 * the same inline-token device PartsUsageTab uses for `{cur}`.
 */
function UnmonthedNote({ n, lang }: { n: number; lang: Lang }) {
  const [before, after] = fill(t(`drivers.count.unmonthedHidden.${plural(n)}`, lang), { n }).split("{months}");
  return (
    <>
      {before}
      <em>{t("drivers.hist.allMonths", lang)}</em>
      {after}
    </>
  );
}

export default function HistoryTab({
  payouts,
  drivers,
  dropdownDrivers,
}: {
  payouts: CommPayout[];
  // Unfiltered (terminated included) — name-resolution must work on old records.
  drivers: DriverLite[];
  // Active ∪ terminated-with-payout-history — scopes the "Driver" filter <select>.
  dropdownDrivers: DriverLite[];
}) {
  const { lang } = useApp();
  const [driverFilter, setDriverFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [open, setOpen] = useState<CommPayout | null>(null);

  // The map holds the ROW, not a rendered name: a display string built inside a
  // memo keyed on data alone would survive a language flip unchanged.
  const driverById = useMemo(() => {
    const m = new Map<string, DriverLite>();
    for (const d of drivers) m.set(d.id, d);
    return m;
  }, [drivers]);
  const displayName = (id: string) => {
    const d = driverById.get(id);
    return d ? arText(d.name, d.name_ar, lang) : "—";
  };

  // Only months that a record actually settled — this is history, so unlike the
  // Commissions lens the current month is NOT added. An empty month here would
  // be an invitation to look for a payout that was never made.
  const monthOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const p of payouts) {
      const k = payoutMonthKey(p);
      if (k) keys.add(k);
    }
    return [...keys].sort().reverse();
  }, [payouts]);

  const rows = useMemo(
    () =>
      buildHistoryRows(
        payouts,
        driverFilter === "all" ? undefined : driverFilter,
        monthFilter === "all" ? undefined : monthFilter,
      ),
    [payouts, driverFilter, monthFilter],
  );

  // Pre-0131 sweeps carry no month, so a specific-month filter hides them. Say
  // so rather than letting a record silently vanish from a filtered view.
  const unmonthedHidden = useMemo(
    () =>
      monthFilter === "all"
        ? 0
        : payouts.filter(
            (p) => (driverFilter === "all" || p.driver_id === driverFilter) && payoutMonthKey(p) == null,
          ).length,
    [payouts, driverFilter, monthFilter],
  );

  // KPIs over the (filtered) history view.
  const totalPaid = rows.reduce((s, r) => s + r.total, 0);
  const count = rows.length;
  const drivenSet = new Set(rows.map((r) => r.driverId)).size;

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <Stat label={t("drivers.hist.statPayouts", lang)} value={count} tone="info" />
        <Stat label={t("drivers.hist.statTotalPaid", lang)} value={formatSar(totalPaid)} tone="ok" />
        <Stat label={t("drivers.hist.statDriversPaid", lang)} value={drivenSet} tone="info" />
      </div>

      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-3 text-sm flex-wrap">
          <div className="flex items-center gap-2">
            <span className="muted">{t("common.driver", lang)}</span>
            <select
              value={driverFilter}
              onChange={(e) => setDriverFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
              style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
            >
              <option value="all">{t("drivers.hist.allDrivers", lang)}</option>
              {dropdownDrivers.map((d) => (
                <option key={d.id} value={d.id}>{arText(d.name, d.name_ar, lang)}</option>
              ))}
            </select>
          </div>

          {/* The month a record PAID FOR — not when it was paid. Both columns are
              in the table, and they routinely differ: August's settlement run
              pays July's work. */}
          <div className="flex items-center gap-2">
            <span className="muted">{t("drivers.hist.monthSettled", lang)}</span>
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
              style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
            >
              <option value="all">{t("drivers.hist.allMonths", lang)}</option>
              {monthOptions.map((k) => (
                <option key={k} value={k}>{monthLabel(k, lang)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {unmonthedHidden > 0 && (
        <p className="mb-3 text-xs muted">
          <UnmonthedNote n={unmonthedHidden} lang={lang} />
        </p>
      )}

      <div className="card p-0 overflow-hidden">
        <Table>
          <thead>
            <tr>
              <TH>{t("drivers.hist.thPaid", lang)}</TH>
              <TH>{t("common.driver", lang)}</TH>
              <TH>{t("drivers.hist.monthSettled", lang)}</TH>
              <TH>{t("drivers.hist.thPayoutRun", lang)}</TH>
              <TH className="text-end">{t("drivers.comm.base", lang)}</TH>
              <TH className="text-end">{t("drivers.comm.specials", lang)}</TH>
              <TH className="text-end">{t("drivers.comm.adjustments", lang)}</TH>
              <TH className="text-end">{t("drivers.comm.bonus", lang)}</TH>
              <TH className="text-end">{t("drivers.comm.total", lang)}</TH>
              <TH className="text-end" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="py-8 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                  <HistoryIcon className="h-5 w-5 mx-auto mb-2 opacity-50" />
                  {monthFilter === "all"
                    ? t("drivers.hist.noneYet", lang)
                    : fill(t("drivers.hist.noneForMonth", lang), { month: monthLabel(monthFilter, lang) })}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                <TD className="whitespace-nowrap"><span dir="ltr">{fmtDate(r.paidAt)}</span></TD>
                <TD className="font-medium">{displayName(r.driverId)}</TD>
                {/* Em dash for a pre-0131 sweep — it settled no single month, and
                    a month must never be back-derived from the run caption. */}
                <TD className="whitespace-nowrap">
                  {r.monthKey ? (
                    <span className="font-medium">{monthLabel(r.monthKey, lang)}</span>
                  ) : (
                    <span className="muted" title={t("drivers.hist.unmonthedTitle", lang)}>—</span>
                  )}
                </TD>
                <TD className="muted">{r.periodLabel}</TD>
                {/* Money is `en-US` in both languages — isolated on an inner span,
                    never with dir on the cell (that would flip `text-align: start`). */}
                <TD className="text-end tabular-nums"><span dir="ltr">{formatSar(r.base)}</span></TD>
                <TD className="text-end tabular-nums"><span dir="ltr">{formatSar(r.specials)}</span></TD>
                <TD className="text-end tabular-nums"><span dir="ltr">{formatSar(r.adjustments)}</span></TD>
                <TD className="text-end tabular-nums"><span dir="ltr">{formatSar(r.bonus)}</span></TD>
                <TD className="text-end tabular-nums font-semibold"><span dir="ltr">{formatSar(r.total)}</span></TD>
                <TD className="text-end">
                  <button
                    type="button"
                    onClick={() => setOpen(payouts.find((p) => p.id === r.id) ?? null)}
                    className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
                    style={{ borderColor: "rgb(var(--border))" }}
                  >
                    <Eye className="h-3.5 w-3.5" /> {t("common.view", lang)}
                  </button>
                </TD>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {open && (
        <PayoutDetail
          payout={open}
          driverName={displayName(open.driver_id)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function PayoutDetail({
  payout,
  driverName,
  onClose,
}: {
  payout: CommPayout;
  driverName: string;
  onClose: () => void;
}) {
  const { lang } = useApp();
  // Snapshot is frozen jsonb — render straight from it (computed-truth at pay time).
  const snap = payout.snapshot as PayoutSnapshot | null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <ScrollLock />
      <div
        className="card p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4 no-print">
          <h2 className="text-lg font-semibold">{fill(t("drivers.hist.payoutOf", lang), { name: driverName })}</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
              style={{ borderColor: "rgb(var(--border))" }}
            >
              <Printer className="h-4 w-4" /> {t("drivers.hist.print", lang)}
            </button>
            <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div id="history-print" className="space-y-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <div className="text-lg font-semibold">{driverName}</div>
              {snap?.nameAr && <div className="text-sm muted">{snap.nameAr}</div>}
            </div>
            <div className="text-end">
              {/* The month settled leads; the run caption sits under it as the
                  smaller fact. A legacy sweep has no month and shows only the
                  caption — nothing is invented to fill the gap. */}
              {snap?.monthKey ? (
                <div className="text-sm font-semibold">{monthLabel(snap.monthKey, lang)}</div>
              ) : (
                <div className="text-xs muted">{t("drivers.hist.sweptAll", lang)}</div>
              )}
              <div className="text-xs muted uppercase tracking-wide">{payout.period_label}</div>
              <div className="text-xs muted">{fill(t("drivers.hist.paidAt", lang), { when: fmtDate(payout.paid_at) })}</div>
              {payout.approved_by && (
                <div className="text-xs muted">{fill(t("drivers.hist.approvedBy", lang), { who: payout.approved_by })}</div>
              )}
            </div>
          </div>

          {/* Base lines (per project) */}
          <div>
            <h4 className="font-semibold text-sm mb-2">{t("drivers.hist.baseHeading", lang)}</h4>
            <div className="card p-0 overflow-hidden">
              <Table>
                <thead>
                  <tr>
                    <TH>{t("drivers.comm.project", lang)}</TH>
                    <TH className="text-end">{t("drivers.comm.trips", lang)}</TH>
                    <TH className="text-end">{t("drivers.comm.amount", lang)}</TH>
                  </tr>
                </thead>
                <tbody>
                  {(snap?.baseLines ?? []).length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-4 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                        {t("drivers.hist.noBaseTrips", lang)}
                      </td>
                    </tr>
                  )}
                  {(snap?.baseLines ?? []).map((l, i) => (
                    <tr key={i}>
                      {/* Discriminate on the VALUE (`projectId == null`), never on
                          the frozen English label — the snapshot is jsonb written
                          at pay time and is never rewritten. */}
                      <TD>{l.projectId ? l.projectName : t("drivers.comm.adhoc", lang)}</TD>
                      <TD className="text-end tabular-nums">{l.trips}</TD>
                      <TD className="text-end tabular-nums"><span dir="ltr">{formatSar(l.amount)}</span></TD>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>

          {/* Items (specials / adjustments / bonus) */}
          <div>
            <h4 className="font-semibold text-sm mb-2">{t("drivers.hist.items", lang)}</h4>
            <div className="card p-0 overflow-hidden">
              <Table>
                <thead>
                  <tr>
                    <TH>{t("drivers.hist.thItem", lang)}</TH>
                    <TH>{t("common.type", lang)}</TH>
                    <TH>{t("common.status", lang)}</TH>
                    <TH className="text-end">{t("drivers.comm.amount", lang)}</TH>
                  </tr>
                </thead>
                <tbody>
                  {(snap?.items ?? []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                        {t("drivers.hist.noItems", lang)}
                      </td>
                    </tr>
                  )}
                  {(snap?.items ?? []).map((it: SnapItem, i) => {
                    const denied = it.status === "denied";
                    return (
                      <tr key={i} className={denied ? "opacity-60" : ""}>
                        <TD className={denied ? "line-through" : ""}>
                          {it.label}
                          {denied && it.deny_reason && (
                            <span className="block text-[11px] muted no-underline">
                              {fill(t("drivers.hist.deniedReason", lang), { reason: it.deny_reason })}
                            </span>
                          )}
                        </TD>
                        {/* Keyed off the stored `kind` enum, not off any label. */}
                        <TD className="capitalize">{t(`drivers.comm.kind.${it.kind}`, lang)}</TD>
                        <TD>
                          <StatusPill
                            status={denied ? "denied" : "approved"}
                            label={denied ? t("drivers.comm.denied", lang) : t("drivers.comm.approved", lang)}
                          />
                        </TD>
                        <TD className={"text-end tabular-nums " + (denied ? "line-through" : "")}>
                          <span dir="ltr">{formatSar(it.amount)}</span>
                        </TD>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          </div>

          {/* Totals — frozen, paid amounts (denied excluded) */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            <Totline label={t("drivers.comm.base", lang)} value={payout.base_sar} />
            <Totline label={t("drivers.comm.specials", lang)} value={payout.specials_sar} />
            <Totline label={t("drivers.comm.adjustments", lang)} value={payout.adjustments_sar} />
            <Totline label={t("drivers.comm.bonus", lang)} value={payout.bonus_sar} />
            <Totline label={t("drivers.comm.total", lang)} value={payout.total_sar} strong />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5 no-print">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
            style={{ borderColor: "rgb(var(--border))" }}
          >
            {t("drivers.close", lang)}
          </button>
        </div>
      </div>
    </div>
  );
}

function Totline({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-lg border p-2" style={{ borderColor: "rgb(var(--border))" }}>
      <div className="text-[11px] muted uppercase tracking-wide">{label}</div>
      <div className={"tabular-nums " + (strong ? "text-base font-semibold" : "text-sm")}>{formatSar(value)}</div>
    </div>
  );
}
