"use client";

// Commission History — VIEW ONLY. Lists frozen payout records from
// commission_payouts (each made by the strict Pay in the Breakdown). Opening a
// record shows the FROZEN snapshot (jsonb captured at pay time) — base lines +
// every item (denied lines struck/greyed with reason) + the totals the driver
// was actually paid. Print renders only the record (scoped @media print in
// globals.css isolates #history-print).
//
// Nothing here mutates: a paid cycle is immutable. Filter by driver to browse.

import { useMemo, useState } from "react";
import { Eye, X, Printer, History as HistoryIcon } from "lucide-react";
import { Stat, StatusPill, Table, TH, TD } from "@/components/ui";
import { formatSar } from "@/lib/utils";
import {
  buildHistoryRows,
  type CommPayout,
  type DriverLite,
  type PayoutSnapshot,
  type SnapItem,
} from "@/lib/commission-rows";

function fmtDate(iso: string): string {
  // Frozen paid_at is an ISO timestamptz. Show date + short time.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [driverFilter, setDriverFilter] = useState<string>("all");
  const [open, setOpen] = useState<CommPayout | null>(null);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of drivers) m.set(d.id, d.name);
    return m;
  }, [drivers]);

  const rows = useMemo(
    () => buildHistoryRows(payouts, driverFilter === "all" ? undefined : driverFilter),
    [payouts, driverFilter],
  );

  // KPIs over the (filtered) history view.
  const totalPaid = rows.reduce((s, r) => s + r.total, 0);
  const count = rows.length;
  const drivenSet = new Set(rows.map((r) => r.driverId)).size;

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <Stat label="Payouts" value={count} tone="info" />
        <Stat label="Total Paid" value={formatSar(totalPaid)} tone="ok" />
        <Stat label="Drivers Paid" value={drivenSet} tone="info" />
      </div>

      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          <span className="muted">Driver</span>
          <select
            value={driverFilter}
            onChange={(e) => setDriverFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
            style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
          >
            <option value="all">All drivers</option>
            {dropdownDrivers.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <Table>
          <thead>
            <tr>
              <TH>Paid</TH>
              <TH>Driver</TH>
              <TH>Period</TH>
              <TH className="text-end">Base</TH>
              <TH className="text-end">Specials</TH>
              <TH className="text-end">Adjustments</TH>
              <TH className="text-end">Bonus</TH>
              <TH className="text-end">Total</TH>
              <TH className="text-end" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                  <HistoryIcon className="h-5 w-5 mx-auto mb-2 opacity-50" />
                  No paid commissions yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                <TD className="whitespace-nowrap">{fmtDate(r.paidAt)}</TD>
                <TD className="font-medium">{nameById.get(r.driverId) ?? "—"}</TD>
                <TD>{r.periodLabel}</TD>
                <TD className="text-end tabular-nums">{formatSar(r.base)}</TD>
                <TD className="text-end tabular-nums">{formatSar(r.specials)}</TD>
                <TD className="text-end tabular-nums">{formatSar(r.adjustments)}</TD>
                <TD className="text-end tabular-nums">{formatSar(r.bonus)}</TD>
                <TD className="text-end tabular-nums font-semibold">{formatSar(r.total)}</TD>
                <TD className="text-end">
                  <button
                    type="button"
                    onClick={() => setOpen(payouts.find((p) => p.id === r.id) ?? null)}
                    className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
                    style={{ borderColor: "rgb(var(--border))" }}
                  >
                    <Eye className="h-3.5 w-3.5" /> View
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
          driverName={nameById.get(open.driver_id) ?? "—"}
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
  // Snapshot is frozen jsonb — render straight from it (computed-truth at pay time).
  const snap = payout.snapshot as PayoutSnapshot | null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="card p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4 no-print">
          <h2 className="text-lg font-semibold">Payout — {driverName}</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
              style={{ borderColor: "rgb(var(--border))" }}
            >
              <Printer className="h-4 w-4" /> Print
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
              <div className="text-xs muted uppercase tracking-wide">{payout.period_label}</div>
              <div className="text-xs muted">Paid {fmtDate(payout.paid_at)}</div>
              {payout.approved_by && <div className="text-xs muted">Approved by {payout.approved_by}</div>}
            </div>
          </div>

          {/* Base lines (per project) */}
          <div>
            <h4 className="font-semibold text-sm mb-2">Base — delivered trips</h4>
            <div className="card p-0 overflow-hidden">
              <Table>
                <thead>
                  <tr>
                    <TH>Project</TH>
                    <TH className="text-end">Trips</TH>
                    <TH className="text-end">Amount</TH>
                  </tr>
                </thead>
                <tbody>
                  {(snap?.baseLines ?? []).length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-4 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                        No base trips.
                      </td>
                    </tr>
                  )}
                  {(snap?.baseLines ?? []).map((l, i) => (
                    <tr key={i}>
                      <TD>{l.projectName}</TD>
                      <TD className="text-end tabular-nums">{l.trips}</TD>
                      <TD className="text-end tabular-nums">{formatSar(l.amount)}</TD>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>

          {/* Items (specials / adjustments / bonus) */}
          <div>
            <h4 className="font-semibold text-sm mb-2">Items</h4>
            <div className="card p-0 overflow-hidden">
              <Table>
                <thead>
                  <tr>
                    <TH>Item</TH>
                    <TH>Type</TH>
                    <TH>Status</TH>
                    <TH className="text-end">Amount</TH>
                  </tr>
                </thead>
                <tbody>
                  {(snap?.items ?? []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                        No items.
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
                            <span className="block text-[11px] muted no-underline">Denied: {it.deny_reason}</span>
                          )}
                        </TD>
                        <TD className="capitalize">{it.kind}</TD>
                        <TD><StatusPill status={denied ? "denied" : "approved"} label={denied ? "Denied" : "Approved"} /></TD>
                        <TD className={"text-end tabular-nums " + (denied ? "line-through" : "")}>{formatSar(it.amount)}</TD>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          </div>

          {/* Totals — frozen, paid amounts (denied excluded) */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            <Totline label="Base" value={payout.base_sar} />
            <Totline label="Specials" value={payout.specials_sar} />
            <Totline label="Adjustments" value={payout.adjustments_sar} />
            <Totline label="Bonus" value={payout.bonus_sar} />
            <Totline label="Total" value={payout.total_sar} strong />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5 no-print">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
            style={{ borderColor: "rgb(var(--border))" }}
          >
            Close
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
