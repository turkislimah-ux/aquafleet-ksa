"use client";

// Reports — the individual statements behind tab 2.
//
// A LEAF MODULE: it imports lib/ and components/ only, never back from
// StatementsTab. That one-way edge is the standing rule from the Phase-4
// import-cycle incident — tsc and next build do not catch a cycle, but Next's
// dev module system can resolve it to undefined and blank the page.
//
// Every statement here reads views. Where a month-grain view has to cover a
// quarter or a year, it is SUMMED — and only where the measure is additive.
// The two measures that are not additive (trucks_active, people_missing_salary)
// are handled explicitly and labelled; see the rule in lib/reports.ts.
//
// Each statement carries its own print id so "print" means "print this
// statement", not the whole tab. The ids are whitelisted in globals.css.

import { useMemo, useState } from "react";
import { Info, Printer } from "lucide-react";
import { Table, TH, TD, Btn } from "@/components/ui";
import { cn, formatSar, formatNum } from "@/lib/utils";
import { WATER_TYPE_LABELS, type WaterType } from "@/lib/db-types";
import type { BuiltReport } from "@/lib/report-builder";
import {
  monthsIn, sumOver, peakOver, formatShare, AGING_ORDER,
  type PnlPeriodRow, type RevenueInvoiceRow, type SalesReturnRow,
  type ReceivableRow, type AgingRow, type MaintenancePerTruckRow,
  type PurchasingRow, type PayrollRow, type CommissionsRow,
  type CommissionsPaidRow, type OperationsRow, type NarrativeBullet,
  type OperationsByDriverRow,
  type FillingMonthRow, type FillingByStationRow,
  type PayslipBasisRow, type IssuedPayslipRow, payslipPreviewNet,
  type DriverCommissionByProjectRow,
} from "@/lib/reports";

// MODULE-PRIVATE. Used by 17 call sites in this file and imported by none —
// StatementsTab takes only the statement components. It was exported from the
// start and never consumed, so the export was surface with no reader.
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex gap-2 text-[11px] muted leading-relaxed">
      <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
      <p>{children}</p>
    </div>
  );
}

/**
 * The band that only exists on paper.
 *
 * On screen the page already says which company and which statement you are
 * looking at — the sidebar, the tab and the period picker all do that work. A
 * printed sheet has none of that context and gets filed on its own, so it has
 * to carry its own identification or it becomes an anonymous table of numbers.
 */
function PrintBand({ title, period }: { title: React.ReactNode; period: string }) {
  return (
    <div className="print-only" style={{ marginBottom: "10pt", borderBottom: "1px solid #000", paddingBottom: "6pt" }}>
      <div style={{ fontSize: "8pt", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Bin Slimah Group
      </div>
      <div style={{ fontSize: "14pt", fontWeight: 600, marginTop: "2pt" }}>{title}</div>
      <div style={{ fontSize: "9pt", display: "flex", justifyContent: "space-between", marginTop: "2pt" }}>
        <span>{period}</span>
        <span>Generated {new Date().toISOString().slice(0, 10)}</span>
      </div>
    </div>
  );
}

function Head({ title, period }: { title: React.ReactNode; period: string }) {
  return (
    <>
      <PrintBand title={title} period={period} />
      <header className="mb-4 no-print">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm muted">{period}</p>
      </header>
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-sm muted">{children}</div>;
}

// ---------------------------------------------------------------------------
// REVENUE STATEMENT — by customer, paid vs outstanding, returns on their own
// line. Grouping invoice rows by customer is selection, not re-derivation:
// every figure summed here came out of v_revenue_invoices.
// ---------------------------------------------------------------------------
export function RevenueStatement({
  invoices, returns, periodStart, periodEnd, label,
}: {
  invoices: RevenueInvoiceRow[]; returns: SalesReturnRow[];
  periodStart: string; periodEnd: string; label: string;
}) {
  const rows = useMemo(() => {
    const inPeriod = invoices.filter((i) => i.month >= periodStart && i.month <= periodEnd);
    const byCustomer = new Map<string, {
      name: string; revenue: number; paid: number; outstanding: number; count: number;
    }>();
    for (const i of inPeriod) {
      const e = byCustomer.get(i.customer_id)
        ?? { name: i.customer_name, revenue: 0, paid: 0, outstanding: 0, count: 0 };
      e.revenue += i.revenue_sar;
      e.count += 1;
      // Paid is measured on the invoice's own flag; outstanding on the amount
      // still due. An invoice can be partly covered by a prepaid balance, so
      // these are not two halves of one number and are not presented as such.
      if (i.is_paid) e.paid += i.revenue_sar;
      else e.outstanding += i.amount_due_sar;
      byCustomer.set(i.customer_id, e);
    }
    return [...byCustomer.values()].sort((a, b) => b.revenue - a.revenue);
  }, [invoices, periodStart, periodEnd]);

  const periodReturns = useMemo(
    () => returns.filter((r) => r.month >= periodStart && r.month <= periodEnd),
    [returns, periodStart, periodEnd],
  );

  const totals = {
    revenue: sumOver(rows, (r) => r.revenue),
    paid: sumOver(rows, (r) => r.paid),
    outstanding: sumOver(rows, (r) => r.outstanding),
  };
  const returned = sumOver(periodReturns, (r) => r.reversed_revenue_sar);

  return (
    <div id="revenue-print" className="card p-6">
      <Head title="Revenue statement" period={label} />

      {rows.length === 0 ? (
        <Empty>No invoices were confirmed in this period.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <TH>Customer</TH>
              <TH className="text-right">Invoices</TH>
              <TH className="text-right">Revenue</TH>
              <TH className="text-right">Paid</TH>
              <TH className="text-right">Outstanding</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <TD>{r.name}</TD>
                <TD className="text-right tabular-nums">{formatNum(r.count)}</TD>
                <TD className="text-right tabular-nums">{formatSar(r.revenue)}</TD>
                <TD className="text-right tabular-nums muted">
                  {r.paid === 0 ? "—" : formatSar(r.paid)}
                </TD>
                <TD className="text-right tabular-nums">
                  {r.outstanding === 0 ? <span className="muted">—</span> : formatSar(r.outstanding)}
                </TD>
              </tr>
            ))}
            <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
              <TD>Total</TD>
              <TD className="text-right tabular-nums">{formatNum(sumOver(rows, (r) => r.count))}</TD>
              <TD className="text-right tabular-nums">{formatSar(totals.revenue)}</TD>
              <TD className="text-right tabular-nums">{formatSar(totals.paid)}</TD>
              <TD className="text-right tabular-nums">{formatSar(totals.outstanding)}</TD>
            </tr>
          </tbody>
        </Table>
      )}

      {/* Returns are a SEPARATE line, never netted into the figures above. */}
      <div className="mt-5">
        <h3 className="text-xs uppercase tracking-wide muted font-medium mb-2">
          Sales returns (reversed invoicing)
        </h3>
        {periodReturns.length === 0 ? (
          <p className="text-sm muted">None in this period.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <TH>Invoice</TH>
                <TH>Reason</TH>
                <TH className="text-right">Reversed</TH>
              </tr>
            </thead>
            <tbody>
              {periodReturns.map((r) => (
                <tr key={r.invoice_id}>
                  <TD>{r.invoice_number ?? "—"}</TD>
                  <TD className="muted">{r.void_reason ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{formatSar(r.reversed_revenue_sar)}</TD>
                </tr>
              ))}
              <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
                <TD>Total reversed</TD>
                <TD>{""}</TD>
                <TD className="text-right tabular-nums">{formatSar(returned)}</TD>
              </tr>
            </tbody>
          </Table>
        )}
      </div>

      <Note>
        Revenue is net of VAT and counts every invoice that has been confirmed,
        including those since paid. Sales returns are shown on their own line and are
        already excluded from the revenue above — the two are never netted silently.
        Outstanding is the amount still due, which on a prepaid account can be less
        than the invoice value because part was covered by balance.
      </Note>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RECEIVABLES STATEMENT — a position as of today, not a period measure.
// ---------------------------------------------------------------------------
export function ReceivablesStatement({
  receivables, aging,
}: { receivables: ReceivableRow[]; aging: AgingRow[] }) {
  const bands = AGING_ORDER.map((b) => {
    const row = aging.find((a) => a.aging_bucket === b);
    return { bucket: b, value: row?.outstanding_sar ?? 0, count: row?.invoice_count ?? 0 };
  });
  const total = sumOver(bands, (b) => b.value);
  const ordered = [...receivables].sort((a, b) => b.days_outstanding - a.days_outstanding);

  return (
    <div id="receivables-print" className="card p-6">
      <Head title="Receivables statement" period="As of today" />

      {total === 0 ? (
        <Empty>Nothing outstanding — every confirmed invoice is paid.</Empty>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <TH>Band</TH>
                <TH className="text-right">Invoices</TH>
                <TH className="text-right">Outstanding</TH>
                <TH className="text-right">Share</TH>
              </tr>
            </thead>
            <tbody>
              {bands.map((b) => (
                <tr key={b.bucket}>
                  <TD>{b.bucket} days</TD>
                  <TD className="text-right tabular-nums">{formatNum(b.count)}</TD>
                  <TD className="text-right tabular-nums">
                    {b.value === 0 ? <span className="muted">—</span> : formatSar(b.value)}
                  </TD>
                  <TD className="text-right tabular-nums muted">
                    {formatShare(total > 0 ? (b.value / total) * 100 : null)}
                  </TD>
                </tr>
              ))}
              <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
                <TD>Total</TD>
                <TD className="text-right tabular-nums">{formatNum(sumOver(bands, (b) => b.count))}</TD>
                <TD className="text-right tabular-nums">{formatSar(total)}</TD>
                <TD className="text-right tabular-nums">100.0%</TD>
              </tr>
            </tbody>
          </Table>

          <h3 className="text-xs uppercase tracking-wide muted font-medium mt-5 mb-2">
            Open invoices, oldest first
          </h3>
          <Table>
            <thead>
              <tr>
                <TH>Invoice</TH>
                <TH>Customer</TH>
                <TH>Confirmed</TH>
                <TH className="text-right">Days</TH>
                <TH className="text-right">Outstanding</TH>
              </tr>
            </thead>
            <tbody>
              {ordered.map((r) => (
                <tr key={r.invoice_id}>
                  <TD>{r.invoice_number ?? "—"}</TD>
                  <TD>{r.customer_name}</TD>
                  <TD className="muted">{r.confirmed_at.slice(0, 10)}</TD>
                  <TD className="text-right tabular-nums">
                    {/* Same day-colouring convention as the Overview. */}
                    <span className={cn(
                      r.days_outstanding > 90 ? "text-rose-600 dark:text-rose-400 font-medium" :
                      r.days_outstanding > 60 ? "text-amber-600 dark:text-amber-400" : "",
                    )}>
                      {formatNum(r.days_outstanding)}
                    </span>
                  </TD>
                  <TD className="text-right tabular-nums">{formatSar(r.outstanding_sar)}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}

      <Note>
        A position as of today, not a figure for the selected period — the period picker
        does not apply to it. Invoices age from the date they were confirmed, because
        this schema has no payment-terms column to age from a due date.
      </Note>
    </div>
  );
}

// ---------------------------------------------------------------------------
// COST STATEMENTS
// ---------------------------------------------------------------------------
export function CostStatement({
  maintPerTruck, purchasing, payroll, commissions, commissionsPaid,
  filling, fillingByStation,
  periodStart, periodEnd, label,
}: {
  maintPerTruck: MaintenancePerTruckRow[];
  purchasing: PurchasingRow[];
  payroll: PayrollRow[];
  commissions: CommissionsRow[];
  commissionsPaid: CommissionsPaidRow[];
  filling: FillingMonthRow[];
  fillingByStation: FillingByStationRow[];
  periodStart: string; periodEnd: string; label: string;
}) {
  // Per truck: sum the three named measures across the period's months. All
  // three are additive money, so this is a sum of view output, not a new
  // definition. They stay SEPARATE columns — the whole point of 0099.
  const trucks = useMemo(() => {
    const inPeriod = maintPerTruck.filter((r) => r.month >= periodStart && r.month <= periodEnd);
    const byTruck = new Map<string, { plate: string; parts: number; os: number; total: number }>();
    for (const r of inPeriod) {
      const e = byTruck.get(r.truck_id) ?? { plate: r.plate, parts: 0, os: 0, total: 0 };
      e.parts += r.maintenance_parts_sar;
      e.os += r.os_payments_sar;
      e.total += r.total_maintenance_sar;
      byTruck.set(r.truck_id, e);
    }
    return [...byTruck.values()].sort((a, b) => b.total - a.total);
  }, [maintPerTruck, periodStart, periodEnd]);

  const pur = monthsIn(purchasing, periodStart, periodEnd);
  const pay = monthsIn(payroll, periodStart, periodEnd);
  const com = monthsIn(commissions, periodStart, periodEnd);
  const comPaid = monthsIn(commissionsPaid, periodStart, periodEnd);

  const earned =
    sumOver(com, (r) => r.trip_commission_sar) + sumOver(com, (r) => r.specials_sar) +
    sumOver(com, (r) => r.adjustments_sar) + sumOver(com, (r) => r.bonus_sar);
  const paid = sumOver(comPaid, (r) => r.commissions_paid_sar);

  const partsTotal = sumOver(trucks, (t) => t.parts);
  const osTotal = sumOver(trucks, (t) => t.os);

  // ---- station fill (0112) ----------------------------------------------
  // Summed across the period's months from the view's own output — no new
  // definition. The uncosted count is summed the same way and travels with
  // the money everywhere below; it is a trip COUNT and genuinely additive.
  const fillMonths = monthsIn(filling, periodStart, periodEnd);
  const fillTotal = sumOver(fillMonths, (r) => r.filling_cost_sar);
  const fillUncosted = sumOver(fillMonths, (r) => r.uncosted_trips);
  const fillCosted = sumOver(fillMonths, (r) => r.costed_trips);

  const fillRows = useMemo(
    () => fillingByStation.filter((r) => r.month >= periodStart && r.month <= periodEnd),
    [fillingByStation, periodStart, periodEnd]
  );

  // BY WATER TYPE. Grouped from the same rows the station table uses, so the
  // two tables and the total are three views of one number and cannot drift.
  const byType = useMemo(() => {
    const m = new Map<string, { sar: number; costed: number; uncosted: number }>();
    for (const r of fillRows) {
      const e = m.get(r.water_type) ?? { sar: 0, costed: 0, uncosted: 0 };
      e.sar += r.filling_cost_sar;
      e.costed += r.costed_trips;
      e.uncosted += r.uncosted_trips;
      m.set(r.water_type, e);
    }
    return [...m.entries()].sort((a, b) => b[1].sar - a[1].sar);
  }, [fillRows]);

  // BY STATION, keyed on station_key rather than the display name — a renamed
  // station keeps resolving, and two stations could share a name.
  const byStation = useMemo(() => {
    const m = new Map<string, { name: string; sar: number; costed: number; uncosted: number }>();
    for (const r of fillRows) {
      const e = m.get(r.station_key) ?? {
        // A null name means the station key no longer exists. The cost still
        // counts, so the row is labelled rather than dropped from the total.
        name: r.station_name ?? `${r.station_key} (removed)`,
        sar: 0, costed: 0, uncosted: 0,
      };
      e.sar += r.filling_cost_sar;
      e.costed += r.costed_trips;
      e.uncosted += r.uncosted_trips;
      m.set(r.station_key, e);
    }
    return [...m.values()].sort((a, b) => b.sar - a.sar);
  }, [fillRows]);

  return (
    <div id="cost-print" className="card p-6">
      <Head title="Cost statements" period={label} />

      {/* --- Station fill cost (0112) ------------------------------------
          THE UNCOSTED COUNT IS NOT OPTIONAL DECORATION. sum() skips NULLs,
          so every figure here is the total of what is KNOWN and is short by
          an unknown amount whenever a fill has no price for its water type.
          Showing the money alone would be showing a total that is quietly
          wrong, so the count sits beside every total and in both tables. */}
      <h3 className="text-xs uppercase tracking-wide muted font-medium mb-2">
        Station fill cost
      </h3>
      {/* An explicit separator, not just the flex gap. Two adjacent spans have
          NO whitespace between them in JSX, so if the gap ever fails to apply —
          print stylesheet, or CSS not yet loaded — they run together as
          "4,390 SAR520 fills costed". The middot also matches the separator
          convention used elsewhere in the app. */}
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-lg font-semibold tabular-nums">{formatSar(fillTotal)}</span>
        <span className="text-xs muted" aria-hidden>·</span>
        <span className="text-xs muted">{fillCosted} fills costed</span>
        {fillUncosted > 0 && (
          <>
            <span className="text-xs muted" aria-hidden>·</span>
            <span className="text-xs text-amber-700 dark:text-amber-300">
            {fillUncosted} {fillUncosted === 1 ? "fill has" : "fills have"} no price for
            {" "}{fillUncosted === 1 ? "its" : "their"} water type — cost unknown, not zero, and
            not included above
            </span>
          </>
        )}
      </div>

      {fillRows.length === 0 ? (
        <p className="text-sm muted mb-6">No fills in this period.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div>
            <h4 className="text-[11px] uppercase tracking-wide muted mb-1">By water type</h4>
            <Table>
              <thead>
                <tr>
                  <TH>Water type</TH>
                  <TH className="text-right">Fills</TH>
                  <TH className="text-right">Uncosted</TH>
                  <TH className="text-right">Cost</TH>
                </tr>
              </thead>
              <tbody>
                {byType.map(([wt, v]) => (
                  <tr key={wt}>
                    <TD>{WATER_TYPE_LABELS[wt as WaterType] ?? wt}</TD>
                    <TD className="text-right tabular-nums">{v.costed}</TD>
                    <TD className={cn("text-right tabular-nums",
                      v.uncosted > 0 && "text-amber-700 dark:text-amber-300")}>
                      {v.uncosted || "—"}
                    </TD>
                    <TD className="text-right tabular-nums">{formatSar(v.sar)}</TD>
                  </tr>
                ))}
                <tr className="font-semibold border-t" style={{ borderColor: "rgb(var(--border))" }}>
                  <TD>Total</TD>
                  <TD className="text-right tabular-nums">{fillCosted}</TD>
                  <TD className="text-right tabular-nums">{fillUncosted || "—"}</TD>
                  <TD className="text-right tabular-nums">{formatSar(fillTotal)}</TD>
                </tr>
              </tbody>
            </Table>
          </div>

          <div>
            <h4 className="text-[11px] uppercase tracking-wide muted mb-1">By station</h4>
            <Table>
              <thead>
                <tr>
                  <TH>Station</TH>
                  <TH className="text-right">Fills</TH>
                  <TH className="text-right">Uncosted</TH>
                  <TH className="text-right">Cost</TH>
                </tr>
              </thead>
              <tbody>
                {byStation.map((v) => (
                  <tr key={v.name}>
                    <TD>{v.name}</TD>
                    <TD className="text-right tabular-nums">{v.costed}</TD>
                    <TD className={cn("text-right tabular-nums",
                      v.uncosted > 0 && "text-amber-700 dark:text-amber-300")}>
                      {v.uncosted || "—"}
                    </TD>
                    <TD className="text-right tabular-nums">{formatSar(v.sar)}</TD>
                  </tr>
                ))}
                <tr className="font-semibold border-t" style={{ borderColor: "rgb(var(--border))" }}>
                  <TD>Total</TD>
                  <TD className="text-right tabular-nums">{fillCosted}</TD>
                  <TD className="text-right tabular-nums">{fillUncosted || "—"}</TD>
                  <TD className="text-right tabular-nums">{formatSar(fillTotal)}</TD>
                </tr>
              </tbody>
            </Table>
          </div>
        </div>
      )}

      {/* --- Maintenance per truck --- */}
      <h3 className="text-xs uppercase tracking-wide muted font-medium mb-2">
        Maintenance by truck
      </h3>
      {trucks.length === 0 ? (
        <p className="text-sm muted">No maintenance spend reached a truck in this period.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <TH>Truck</TH>
              <TH className="text-right">Parts</TH>
              <TH className="text-right">Outsourced</TH>
              <TH className="text-right">Total</TH>
            </tr>
          </thead>
          <tbody>
            {trucks.map((t) => (
              <tr key={t.plate}>
                <TD>{t.plate}</TD>
                <TD className="text-right tabular-nums muted">
                  {t.parts === 0 ? "—" : formatSar(t.parts)}
                </TD>
                <TD className="text-right tabular-nums muted">
                  {t.os === 0 ? "—" : formatSar(t.os)}
                </TD>
                <TD className="text-right tabular-nums font-medium">{formatSar(t.total)}</TD>
              </tr>
            ))}
            <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
              <TD>Total</TD>
              <TD className="text-right tabular-nums">{formatSar(partsTotal)}</TD>
              <TD className="text-right tabular-nums">{formatSar(osTotal)}</TD>
              <TD className="text-right tabular-nums">{formatSar(partsTotal + osTotal)}</TD>
            </tr>
          </tbody>
        </Table>
      )}
      <Note>
        Three separate measures, never blended into one figure. Parts is the FIFO cost of
        what each truck&apos;s work orders consumed; outsourced is what outside workshops
        were paid for that truck. Labour on in-house work orders is not costed anywhere
        in this schema, so it is in neither column.
      </Note>

      {/* --- Payroll --- */}
      <h3 className="text-xs uppercase tracking-wide muted font-medium mt-6 mb-2">Payroll</h3>
      <Table>
        <thead>
          <tr>
            <TH>Component</TH>
            <TH className="text-right">Amount</TH>
          </tr>
        </thead>
        <tbody>
          <tr>
            <TD>Staff salaries</TD>
            <TD className="text-right tabular-nums">{formatSar(sumOver(pay, (r) => r.staff_salary_sar))}</TD>
          </tr>
          <tr>
            <TD>Driver salaries</TD>
            <TD className="text-right tabular-nums">{formatSar(sumOver(pay, (r) => r.driver_salary_sar))}</TD>
          </tr>
          <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
            <TD>Total payroll</TD>
            <TD className="text-right tabular-nums">
              {formatSar(sumOver(pay, (r) => r.staff_salary_sar + r.driver_salary_sar))}
            </TD>
          </tr>
        </tbody>
      </Table>
      <Note>
        Two things to know about this figure. Salaries are <strong>not effective-dated</strong> in
        this schema, so a past period is costed at each person&apos;s current salary — a raise
        changes history. Only the employment window is historical.
        {peakOver(pay, (r) => r.people_missing_salary) > 0 && (
          <> And in at least one month of this period,{" "}
          {peakOver(pay, (r) => r.people_missing_salary)} employed{" "}
          {peakOver(pay, (r) => r.people_missing_salary) === 1 ? "person has" : "people have"} no
          salary recorded and {peakOver(pay, (r) => r.people_missing_salary) === 1 ? "counts" : "count"} as
          zero. That is a per-month state, so it is reported as the highest month rather
          than added up.</>
        )}
      </Note>

      {/* --- Commissions --- */}
      <h3 className="text-xs uppercase tracking-wide muted font-medium mt-6 mb-2">
        Commissions — earned and paid
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Table>
            <thead>
              <tr><TH>Earned (accrual)</TH><TH className="text-right">Amount</TH></tr>
            </thead>
            <tbody>
              <tr>
                <TD>Trip commission</TD>
                <TD className="text-right tabular-nums">{formatSar(sumOver(com, (r) => r.trip_commission_sar))}</TD>
              </tr>
              <tr>
                <TD>Specials</TD>
                <TD className="text-right tabular-nums">{formatSar(sumOver(com, (r) => r.specials_sar))}</TD>
              </tr>
              <tr>
                <TD>Adjustments</TD>
                <TD className="text-right tabular-nums">{formatSar(sumOver(com, (r) => r.adjustments_sar))}</TD>
              </tr>
              <tr>
                <TD>Bonuses</TD>
                <TD className="text-right tabular-nums">{formatSar(sumOver(com, (r) => r.bonus_sar))}</TD>
              </tr>
              <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
                <TD>Total earned</TD>
                <TD className="text-right tabular-nums">{formatSar(earned)}</TD>
              </tr>
            </tbody>
          </Table>
        </div>
        <div>
          <Table>
            <thead>
              <tr><TH>Paid (cash)</TH><TH className="text-right">Amount</TH></tr>
            </thead>
            <tbody>
              <tr>
                <TD>Payouts</TD>
                <TD className="text-right tabular-nums">{formatNum(sumOver(comPaid, (r) => r.payout_count))}</TD>
              </tr>
              <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
                <TD>Total paid</TD>
                <TD className="text-right tabular-nums">{formatSar(paid)}</TD>
              </tr>
            </tbody>
          </Table>
        </div>
      </div>
      <Note>
        Side by side, and <strong>never added together</strong>. A payout&apos;s base is the
        same trip commission already counted as earned, so summing the two would count it
        twice. Earned lands in the month the work was done; paid lands when the payout was
        made. Adjustments are signed and are often negative deductions, which correctly
        reduce the earned total.
      </Note>

      {/* --- Purchasing --- */}
      <h3 className="text-xs uppercase tracking-wide muted font-medium mt-6 mb-2">
        Purchasing — procurement and cash, NOT a P&amp;L cost
      </h3>
      <Table>
        <thead>
          <tr>
            <TH>Measure</TH>
            <TH className="text-right">Value</TH>
          </tr>
        </thead>
        <tbody>
          <tr>
            <TD>Stock received</TD>
            <TD className="text-right tabular-nums">
              {formatSar(sumOver(pur, (r) => r.received_stock_value_sar))}
            </TD>
          </tr>
          <tr>
            <TD>Receipts</TD>
            <TD className="text-right tabular-nums">{formatNum(sumOver(pur, (r) => r.receipt_count))}</TD>
          </tr>
        </tbody>
      </Table>
      <Note>
        A procurement and cash view only. This is deliberately <strong>not</strong> a P&amp;L
        line: a purchase is inventory until it is consumed, and expensing both the purchase
        and the consumption would double-count. That cost reaches the P&amp;L later, as parts
        consumed, when the stock is actually used.
      </Note>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OPERATIONAL PERFORMANCE
// ---------------------------------------------------------------------------
/**
 * One driver column.
 *
 * The DRIVER is the unit measured. The plate is context for reading the
 * column and is never itself a measure — no truck-level figure appears under
 * a driver anywhere in this statement.
 */
type DriverCol = {
  key: string;
  name: string;
  plate: string | null;
  trucksUsed: number;
  scheduled: number;
  delivered: number;
  notDelivered: number;
  completion: number | null;
};

export function OperationsStatement({
  operations, byDriver, periodStart, periodEnd, label, multiMonth,
}: {
  operations: OperationsRow[];
  byDriver: OperationsByDriverRow[];
  periodStart: string; periodEnd: string; label: string;
  multiMonth: boolean;
}) {
  const rows = monthsIn(operations, periodStart, periodEnd);

  const trips = sumOver(rows, (r) => r.trips_total);
  const delivered = sumOver(rows, (r) => r.trips_delivered);
  const workOrders = sumOver(rows, (r) => r.work_orders);
  const osJobs = sumOver(rows, (r) => r.outsourced_jobs);
  const permits = sumOver(rows, (r) => r.exit_permits);
  const peakTrucks = peakOver(rows, (r) => r.trucks_active);

  // Ratios from PERIOD TOTALS, never an average of monthly rates — the same
  // rule 0100 exists to enforce for the P&L margin.
  const completion = trips > 0 ? (delivered / trips) * 100 : null;
  const maintenanceEvents = workOrders + osJobs;

  // --- Driver columns ------------------------------------------------------
  // Rolled up across the period's months. Counts are additive; the completion
  // rate is RECOMPUTED from each driver's own period totals rather than
  // averaged from the per-month rates the view supplies.
  const drivers = useMemo<DriverCol[]>(() => {
    const inPeriod = byDriver.filter((r) => r.month >= periodStart && r.month <= periodEnd);
    const acc = new Map<string, DriverCol & { plateCounts: Map<string, number> }>();

    for (const r of inPeriod) {
      // Grouped by driver_id, not name: two driver records can share a name,
      // and merging them would be a real error. The null key is the
      // no-driver-recorded bucket, kept so the columns foot to the total.
      const key = r.driver_id ?? "__unassigned__";
      const e = acc.get(key) ?? {
        key,
        name: r.driver_name ?? "Unassigned",
        plate: null, trucksUsed: 0,
        scheduled: 0, delivered: 0, notDelivered: 0, completion: null,
        plateCounts: new Map<string, number>(),
      };
      e.scheduled += r.trips_scheduled;
      e.delivered += r.trips_delivered;
      e.notDelivered += r.trips_not_delivered;
      e.trucksUsed = Math.max(e.trucksUsed, r.trucks_used);
      if (r.primary_plate) {
        e.plateCounts.set(r.primary_plate, (e.plateCounts.get(r.primary_plate) ?? 0) + r.trips_scheduled);
      }
      acc.set(key, e);
    }

    return [...acc.values()]
      .map(({ plateCounts, ...d }) => ({
        ...d,
        // Across a multi-month period a driver may have a different primary
        // truck each month — take the one behind the most trips.
        plate: [...plateCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
        completion: d.scheduled > 0 ? (d.delivered / d.scheduled) * 100 : null,
      }))
      .sort((a, b) => {
        // Unassigned last, whatever its size — it is a gap, not a performer.
        if (a.key === "__unassigned__") return 1;
        if (b.key === "__unassigned__") return -1;
        return b.scheduled - a.scheduled;
      });
  }, [byDriver, periodStart, periodEnd]);

  const driverScheduled = sumOver(drivers, (d) => d.scheduled);
  const driverDelivered = sumOver(drivers, (d) => d.delivered);

  /**
   * The left-hand cell of a driver row: name, then the plate as CONTEXT, then
   * the multi-truck note when there was more than one. The truck is never a
   * measure — it is here so the reader knows which vehicle the row refers to.
   */
  const driverCell = (d: DriverCol) => (
    <TD>
      <span className="block font-medium">{d.name}</span>
      <span className="block text-[10px] muted">{d.plate ?? "—"}</span>
      {d.trucksUsed > 1 && (
        <span className="block text-[10px] muted">drove {d.trucksUsed} trucks</span>
      )}
    </TD>
  );

  return (
    <div id="ops-print" className="card p-6">
      <Head title="Operational performance" period={label} />

      {drivers.length === 0 ? (
        <Note>No trips were recorded in this period, so there is nothing to break down by driver.</Note>
      ) : (
        <>
          {/* --- DELIVERY: one row per driver, measures across the top. --- */}
          <h3 className="text-xs uppercase tracking-wide muted font-medium mb-2">
            Delivery by driver
          </h3>
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <TH>Driver</TH>
                  <TH className="text-right">Trips scheduled</TH>
                  <TH className="text-right">Trips delivered</TH>
                  <TH className="text-right">Not delivered</TH>
                  <TH className="text-right">Completion rate</TH>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.key}>
                    {driverCell(d)}
                    <TD className="text-right tabular-nums">{formatNum(d.scheduled)}</TD>
                    <TD className="text-right tabular-nums">{formatNum(d.delivered)}</TD>
                    <TD className="text-right tabular-nums">
                      {d.notDelivered === 0 ? <span className="muted">—</span> : formatNum(d.notDelivered)}
                    </TD>
                    <TD className="text-right tabular-nums font-medium">{formatShare(d.completion)}</TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <Note>
            Each driver&apos;s completion rate is computed from that driver&apos;s own
            scheduled and delivered counts — never averaged, and never inherited from
            the period figure below. The plate beside a name is the truck that driver was
            in; it is context only and is never measured per driver. Drivers are grouped
            by record, not by name, so two people sharing a first name stay on separate
            rows — the plate is what tells them apart.
          </Note>

          {/* --- FLEET UTILISATION: DRIVER-WORKLOAD measures only. --- */}
          <h3 className="text-xs uppercase tracking-wide muted font-medium mt-6 mb-2">
            Fleet utilisation by driver
          </h3>
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <TH>Driver</TH>
                  <TH className="text-right">Share of scheduled trips</TH>
                  <TH className="text-right">Share of delivered trips</TH>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.key}>
                    {driverCell(d)}
                    <TD className="text-right tabular-nums">
                      {formatShare(driverScheduled > 0 ? (d.scheduled / driverScheduled) * 100 : null)}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatShare(driverDelivered > 0 ? (d.delivered / driverDelivered) * 100 : null)}
                    </TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <Note>
            Workload shares, so they measure the DRIVER. A truck-level figure never
            appears in a driver row — trucks that moved and maintenance activity stay in
            the period summary below. Shares are computed against the period totals and
            add to 100%.
            {drivers.some((d) => d.key === "__unassigned__") && (
              <> One row is <strong>Unassigned</strong>: trips recorded with no driver.
              It is kept so the driver rows still add up to the period total rather than
              quietly falling short.</>
            )}
          </Note>
        </>
      )}


      {/* --- Truck-level and fleet-level facts live HERE, BELOW the driver
              tables. Nothing in this block is per-driver: trucks that moved,
              work orders and maintenance events are fleet facts, and putting
              them under a driver column would change what they mean. The
              driver tables lead because the driver is what this statement
              measures; this block is the context they sit in. --- */}
      <h3 className="text-xs uppercase tracking-wide muted font-medium mt-6 mb-2">Period summary</h3>
      <Table>
        <thead>
          <tr><TH>Measure</TH><TH className="text-right">Value</TH></tr>
        </thead>
        <tbody>
          <tr>
            <TD>Trips scheduled</TD>
            <TD className="text-right tabular-nums">{formatNum(trips)}</TD>
          </tr>
          <tr>
            <TD>Trips delivered</TD>
            <TD className="text-right tabular-nums">{formatNum(delivered)}</TD>
          </tr>
          <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
            <TD>Delivery completion rate</TD>
            <TD className="text-right tabular-nums">{formatShare(completion)}</TD>
          </tr>
          <tr>
            <TD>
              Trucks that moved
              {multiMonth && <span className="muted text-xs"> — most in any one month</span>}
            </TD>
            <TD className="text-right tabular-nums">{formatNum(peakTrucks)}</TD>
          </tr>
          <tr>
            <TD>Work orders</TD>
            <TD className="text-right tabular-nums">{formatNum(workOrders)}</TD>
          </tr>
          <tr>
            <TD>Outsourced jobs</TD>
            <TD className="text-right tabular-nums">{formatNum(osJobs)}</TD>
          </tr>
          <tr>
            <TD>Maintenance events</TD>
            <TD className="text-right tabular-nums">{formatNum(maintenanceEvents)}</TD>
          </tr>
          <tr>
            <TD>Exit permits</TD>
            <TD className="text-right tabular-nums">{formatNum(permits)}</TD>
          </tr>
        </tbody>
      </Table>

      {rows.length > 1 && (
        <>
          <h3 className="text-xs uppercase tracking-wide muted font-medium mt-6 mb-2">
            By month
          </h3>
          <Table>
            <thead>
              <tr>
                <TH>Month</TH>
                <TH className="text-right">Trips</TH>
                <TH className="text-right">Delivered</TH>
                <TH className="text-right">Completion</TH>
                <TH className="text-right">Trucks</TH>
                <TH className="text-right">WOs</TH>
                <TH className="text-right">OS jobs</TH>
                <TH className="text-right">Permits</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}>
                  <TD>{r.month.slice(0, 7)}</TD>
                  <TD className="text-right tabular-nums">{formatNum(r.trips_total)}</TD>
                  <TD className="text-right tabular-nums">{formatNum(r.trips_delivered)}</TD>
                  <TD className="text-right tabular-nums">
                    {formatShare(r.trips_total > 0 ? (r.trips_delivered / r.trips_total) * 100 : null)}
                  </TD>
                  <TD className="text-right tabular-nums">{formatNum(r.trucks_active)}</TD>
                  <TD className="text-right tabular-nums">{formatNum(r.work_orders)}</TD>
                  <TD className="text-right tabular-nums">{formatNum(r.outsourced_jobs)}</TD>
                  <TD className="text-right tabular-nums">{formatNum(r.exit_permits)}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}

      <Note>
        Trips, work orders, outsourced jobs and permits are event counts, so they add
        across months. <strong>Trucks that moved does not.</strong> It is a distinct
        count, and a truck working in two months would be counted twice by a sum — so a
        multi-month period reports the highest single month. A true period-level
        distinct count cannot be recovered from monthly rows.
      </Note>
      <Note>
        Two measures are deliberately absent because the data cannot support them
        honestly yet: <strong>idle trucks</strong> needs the fleet roster alongside these
        counts, and <strong>fleet availability</strong> needs the distinct trucks under
        maintenance in the period. Neither is estimated here.
      </Note>
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE NARRATIVE
// ---------------------------------------------------------------------------
export function NarrativeStatement({
  bullets, label, pnl,
}: { bullets: NarrativeBullet[]; label: string; pnl: PnlPeriodRow }) {
  const dot = (tone: NarrativeBullet["tone"]) =>
    tone === "up" ? "bg-emerald-500" :
    tone === "down" ? "bg-rose-500" :
    tone === "warn" ? "bg-amber-500" :
    tone === "flat" ? "bg-slate-400" : "bg-brand-500";

  return (
    <div id="narrative-print" className="card p-6">
      <Head title={`${label} in review`} period="Computed from the period's own figures" />

      <ul className="space-y-2.5">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0 mt-[7px]", dot(b.tone))} />
            <span>{b.text}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 pt-3 border-t grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm"
        style={{ borderColor: "rgb(var(--border))" }}>
        <div>
          <div className="text-[11px] muted uppercase tracking-wide">Revenue</div>
          <div className="font-semibold tabular-nums">{formatSar(pnl.revenue_sar)}</div>
        </div>
        <div>
          <div className="text-[11px] muted uppercase tracking-wide">Operating cost</div>
          <div className="font-semibold tabular-nums">{formatSar(pnl.operating_cost_sar)}</div>
        </div>
        <div>
          <div className="text-[11px] muted uppercase tracking-wide">Operating profit</div>
          <div className={cn("font-semibold tabular-nums",
            pnl.operating_profit_sar < 0 && "text-rose-600 dark:text-rose-400")}>
            {formatSar(pnl.operating_profit_sar)}
          </div>
        </div>
        <div>
          <div className="text-[11px] muted uppercase tracking-wide">Margin</div>
          <div className="font-semibold tabular-nums">{formatShare(pnl.operating_margin_pct)}</div>
        </div>
      </div>

      <Note>
        Every sentence above is computed from this period&apos;s own figures — nothing is
        templated prose with numbers dropped in, and each line is a comparison you could
        redo by hand from the statements on this page.
      </Note>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CUSTOM REPORT — the builder's output.
//
// Renders whatever lib/report-builder.ts assembled. It holds no logic of its
// own on purpose: every rule about which metrics may be combined, which
// groupings are legal and how a ratio is computed lives in that module, so
// there is exactly one place those rules can be got wrong.
// ---------------------------------------------------------------------------
export function CustomStatement({
  report, title, onEdit,
}: { report: BuiltReport; title: string; onEdit: () => void }) {
  return (
    <div id="custom-print" className="card p-6">
      <Head title="Custom report" period={title} />

      {report.columns.length === 0 ? (
        <Empty>No columns selected.</Empty>
      ) : report.rows.length === 0 ? (
        <Empty>Nothing matched this selection.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <TH>{" "}</TH>
              {report.columns.map((c) => (
                <TH key={c.id} className="text-right">
                  <span className="block">{c.label}</span>
                  <span className="block text-[10px] font-normal muted normal-case">{c.basis}</span>
                </TH>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.label}>
                <TD>{r.label}</TD>
                {r.values.map((v, i) => (
                  <TD key={report.columns[i].id} className="text-right tabular-nums">
                    {v === null ? <span className="muted">—</span>
                      : report.columns[i].unit === "percent" ? formatShare(v)
                      : report.columns[i].unit === "count" ? formatNum(v)
                      : formatSar(v)}
                  </TD>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {report.notes.map((n, i) => <Note key={i}>{n}</Note>)}
      <Note>
        Built from defined metrics only, reading the same views as every other report
        on this page. There is deliberately no total across columns — metrics on
        different bases must never be added.
      </Note>

      <div className="mt-4 no-print">
        <button onClick={onEdit}
          className="text-sm font-medium text-brand-600 dark:text-brand-300 hover:underline">
          Change selection
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PAYSLIPS (0115) — a REGISTER, and the DOCUMENT it opens.
//
// preview/ has no payslip surface at all (checked across the whole tree), so
// unlike every other statement here this one has no demo to match. The shape
// below is chosen to mirror the statements it sits beside rather than to
// invent a fifth visual language on the same page.
//
// TWO VIEWS, ONE PRINT SUBTREE. The register lists a month's drivers; picking
// one replaces the body with that driver's document. They never render at the
// same time, which keeps the existing "one print id in the DOM" invariant —
// pressing Print on the document prints the document, not the register behind
// it.
//
// THE DOCUMENT IS THE POINT. A register row is a preview that recomputes every
// time the page loads; an issued payslip is frozen and is the figure of record.
// The two are visually distinct on purpose, because confusing them is how
// someone hands out a number that later changes.
// ---------------------------------------------------------------------------

/** Paid vs earned, said in words rather than left to a colour. */
function BasisChip({ basis, settled }: { basis: string; settled: boolean }) {
  const paid = basis === "paid" && settled;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset whitespace-nowrap",
        paid
          ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300"
          : "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300",
      )}
      title={paid
        ? "Settled — this commission was actually paid out in this month"
        : "Earned but not yet paid. It will appear again as PAID on the payslip for the month it is settled in."}
    >
      {paid ? "Paid" : "Earned"}
    </span>
  );
}

function monthLabelOf(iso: string) {
  const [y, m] = iso.split("-");
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

export function PayslipsStatement({
  basis, issued, commission, periodStart, periodEnd, label, today,
  selectedDriverId, onSelectDriver, onIssue, issuingId,
}: {
  basis: PayslipBasisRow[];
  issued: IssuedPayslipRow[];
  /** 0116 — work-month earnings, the review table below the register. */
  commission: DriverCommissionByProjectRow[];
  periodStart: string; periodEnd: string; label: string;
  /** Riyadh today, from the server — never new Date() in the client. */
  today: string;
  selectedDriverId: string | null;
  onSelectDriver: (driverId: string | null) => void;
  onIssue: (driverId: string, periodStart: string) => void;
  issuingId: string | null;
}) {
  const rows = useMemo(
    () => basis
      .filter((r) => r.period_start >= periodStart && r.period_start <= periodEnd)
      .sort((a, b) =>
        b.period_start.localeCompare(a.period_start) ||
        a.driver_name.localeCompare(b.driver_name)),
    [basis, periodStart, periodEnd],
  );

  // A month can only be issued once it has finished. The database refuses it
  // (23514) and this is the same rule said early, so the button is never a
  // trap — but the RPC stays the enforcement, not this.
  const currentMonthStart = today.slice(0, 8) + "01";
  const isRunning = (p: string) => p >= currentMonthStart;

  const selected = selectedDriverId
    ? rows.find((r) => r.driver_id === selectedDriverId) ?? null
    : null;

  if (selected) {
    const doc = issued.find(
      (i) => i.driver_id === selected.driver_id && i.period_start === selected.period_start,
    ) ?? null;
    return (
      // SAME print id as the register, because they are never both mounted —
      // that is what keeps "Print" meaning "print what I am looking at".
      <div id="payslips-print" className="card p-6">
        <PayslipDocument
          row={selected}
          doc={doc}
          running={isRunning(selected.period_start)}
          onBack={() => onSelectDriver(null)}
          onIssue={onIssue}
          issuing={issuingId === selected.driver_id}
        />
      </div>
    );
  }

  const totals = rows.reduce(
    (acc, r) => {
      const d = issued.find((i) => i.driver_id === r.driver_id && i.period_start === r.period_start);
      return {
        salary: acc.salary + (d ? d.base_salary_sar : r.base_salary_sar),
        net: acc.net + (d ? d.net_sar : payslipPreviewNet(r)),
        issued: acc.issued + (d ? 1 : 0),
      };
    },
    { salary: 0, net: 0, issued: 0 },
  );

  return (
    <>
      <div id="payslips-print" className="card p-6">
      <Head title="Payslips" period={label} />

      {rows.length === 0 ? (
        <Empty>No drivers on the payroll for this period.</Empty>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <span className="muted">{rows.length} {rows.length === 1 ? "payslip" : "payslips"}</span>
            <span className="muted" aria-hidden>·</span>
            <span className="muted">{totals.issued} issued</span>
            <span className="muted" aria-hidden>·</span>
            <span>Total net <b className="tabular-nums">{formatSar(totals.net)}</b></span>
          </div>

          <Table>
            <thead>
              <tr>
                <TH>Driver</TH>
                <TH>Month</TH>
                <TH className="text-right">Salary</TH>
                <TH className="text-right">Commission</TH>
                <TH>Basis</TH>
                <TH className="text-right">Net</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const doc = issued.find(
                  (i) => i.driver_id === r.driver_id && i.period_start === r.period_start,
                );
                // An issued slip shows its FROZEN figures, never a fresh
                // preview — that is what "snapshot at issue" means on screen.
                const salary = doc ? doc.base_salary_sar : r.base_salary_sar;
                const commission = doc
                  ? doc.commission_sar + doc.specials_sar + doc.adjustments_sar + doc.bonus_sar
                  : r.commission_sar + r.specials_sar + r.adjustments_sar + r.bonus_sar;
                const net = doc ? doc.net_sar : payslipPreviewNet(r);
                return (
                  <tr
                    key={`${r.driver_id}-${r.period_start}`}
                    onClick={() => onSelectDriver(r.driver_id)}
                    className="cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  >
                    <TD className="font-medium">{r.driver_name}</TD>
                    <TD className="muted">{monthLabelOf(r.period_start)}</TD>
                    <TD className="text-right tabular-nums">{formatSar(salary)}</TD>
                    <TD className="text-right tabular-nums">{formatSar(commission)}</TD>
                    <TD>
                      <BasisChip
                        basis={doc ? doc.commission_basis : r.commission_basis}
                        settled={doc ? doc.commission_settled : r.commission_settled}
                      />
                    </TD>
                    <TD className="text-right tabular-nums font-semibold">{formatSar(net)}</TD>
                    <TD>
                      {/* PRIORITY, ruled: an issued number is the strongest fact
                          (the document exists), then TERMINATED — leaving the
                          company outranks a missing hire date, and today every
                          NULL-hire driver is terminated so all five read
                          Terminated. The ISSUE BLOCK is unchanged: hire_date
                          still refuses, termination does not. */}
                      {doc ? (
                        <span className="font-mono text-[11px] font-bold">{doc.payslip_number}</span>
                      ) : r.terminated ? (
                        <span
                          className="text-[11px] font-bold text-slate-600 dark:text-slate-300"
                          title={r.termination_date
                            ? `Left the company on ${r.termination_date}${r.hire_date_missing ? " · no hire date recorded, so no payslip can be issued" : ""}`
                            : undefined}
                        >
                          Terminated
                        </span>
                      ) : r.hire_date_missing ? (
                        <span className="text-[11px] font-bold text-rose-700 dark:text-rose-300">
                          No hire date
                        </span>
                      ) : isRunning(r.period_start) ? (
                        <span className="text-[11px] font-bold muted">Month in progress</span>
                      ) : (
                        <span className="text-[11px] font-bold muted">Not issued</span>
                      )}
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </Table>

          <Note>
            An unissued row is a PREVIEW: its salary is today&apos;s salary, and it will
            change if the salary changes. Issuing freezes the figures and numbers the
            document — from then on the payslip shows what it showed on the day it was
            issued, whatever happens to the salary afterwards.
          </Note>
        </>
      )}
      </div>

      {/* THE SECOND TABLE. Outside the payslips print id on purpose: it is a
          different document with its own print button, and nesting it inside
          would make "print the register" also print this. */}
      <CommissionReviewTable
        rows={commission}
        periodStart={periodStart} periodEnd={periodEnd} label={label}
      />
    </>
  );
}

/**
 * ONE DRIVER, ONE MONTH — the thing you print and hand over.
 *
 * Renders the FROZEN document when one exists and the live preview when it does
 * not, and never blends them: an issued slip reads every figure off
 * driver_payslips, a preview reads every figure off the basis view.
 */
function PayslipDocument({
  row, doc, running, onBack, onIssue, issuing,
}: {
  row: PayslipBasisRow;
  doc: IssuedPayslipRow | null;
  running: boolean;
  onBack: () => void;
  onIssue: (driverId: string, periodStart: string) => void;
  issuing: boolean;
}) {
  const f = doc
    ? {
        salary: doc.base_salary_sar, commission: doc.commission_sar,
        specials: doc.specials_sar, adjustments: doc.adjustments_sar,
        bonus: doc.bonus_sar, deductions: doc.deductions_sar, net: doc.net_sar,
        basis: doc.commission_basis, settled: doc.commission_settled,
      }
    : {
        salary: row.base_salary_sar, commission: row.commission_sar,
        specials: row.specials_sar, adjustments: row.adjustments_sar,
        bonus: row.bonus_sar, deductions: 0, net: payslipPreviewNet(row),
        basis: row.commission_basis, settled: row.commission_settled,
      };

  const covered = doc?.snapshot?.covered_trips;
  const payouts = doc?.snapshot?.payouts ?? [];
  const blocked = row.hire_date_missing || running;

  // ISSUING IS IRREVERSIBLE AND NUMBERED, so it asks first. There is no delete
  // path for a payslip by design — undoing one means an architect deleting the
  // row AND resetting the counter, or the next document silently skips a
  // number. A single misclick must not be able to start that.
  //
  // An inline panel rather than window.confirm: the browser dialog cannot show
  // the figures, and the whole point of confirming is seeing WHAT is about to
  // be frozen. It is dismissable and Cancel is the resting position.
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 no-print">
        <button
          type="button"
          onClick={onBack}
          className="text-sm muted hover:text-[rgb(var(--fg))] focus-ring rounded px-1"
        >
          ← All payslips
        </button>
        {doc ? (
          <span className="text-xs muted">
            Issued {doc.issued_at.slice(0, 10)} by {doc.issued_by}
          </span>
        ) : (
          <button
            type="button"
            disabled={blocked || issuing}
            onClick={() => setConfirming(true)}
            title={
              row.hire_date_missing
                ? "This driver has no hire date, so a payslip period cannot be established. Set the hire date on the driver first."
                : running
                  ? "This month has not finished yet. A payslip can only be issued for a completed month."
                  : undefined
            }
            className="h-9 px-4 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {issuing ? "Issuing…" : "Issue payslip"}
          </button>
        )}
      </div>

      <Head
        title={doc
          ? <>Payslip <b className="font-mono font-bold">{doc.payslip_number}</b></>
          : "Payslip (not issued)"}
        period={`${row.driver_name} · ${monthLabelOf(row.period_start)}`}
      />

      {/* WHY THE ACTION IS UNAVAILABLE, said where the button is — a disabled
          control with no reason is indistinguishable from a broken one. */}
      {!doc && blocked && (
        <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[12px] leading-relaxed">
          {row.hire_date_missing
            ? "This driver has no hire date recorded, so there is no employment period a payslip could cover. Set the hire date on the driver, then issue. The figures below are shown for reference only."
            : "This month is still running. A payslip can only be issued once the month has finished, so the figures below are not final."}
        </div>
      )}

      {!doc && !blocked && !confirming && (
        <div className="mb-4 rounded-lg border border-brand-500/25 bg-brand-500/5 px-3 py-2 text-[12px] leading-relaxed">
          Not issued yet. Salary is shown at <b>today&apos;s</b> rate — issuing freezes
          these figures and assigns the payslip number.
        </div>
      )}

      {!doc && confirming && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 no-print">
          <div className="text-sm font-semibold">Issue this payslip?</div>
          <p className="mt-1 text-[12px] leading-relaxed">
            This freezes <b>{row.driver_name}</b>&apos;s pay for{" "}
            <b>{monthLabelOf(row.period_start)}</b> at{" "}
            <b className="tabular-nums">{formatSar(f.net)}</b> net and gives it a
            permanent payslip number.
          </p>
          <p className="mt-1.5 text-[12px] leading-relaxed">
            <b>It cannot be undone from here.</b> The figures stop following the
            driver&apos;s salary from this moment — that is the point of issuing, and it
            is why there is no edit or delete afterwards.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={issuing}
              onClick={() => { setConfirming(false); onIssue(row.driver_id, row.period_start); }}
              className="h-9 px-4 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white transition disabled:opacity-50"
            >
              {issuing ? "Issuing…" : "Yes, issue it"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-9 px-4 rounded-lg text-sm font-medium ring-1 ring-inset transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
              style={{ borderColor: "rgb(var(--border))" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <Table>
        <tbody>
          <tr>
            <TD className="font-medium">Basic salary</TD>
            <TD className="text-right tabular-nums">{formatSar(f.salary)}</TD>
          </tr>
          <tr>
            <TD>
              <span className="font-medium">Commission</span>{" "}
              <BasisChip basis={f.basis} settled={f.settled} />
            </TD>
            <TD className="text-right tabular-nums">{formatSar(f.commission)}</TD>
          </tr>
          <tr>
            <TD>Special payments</TD>
            <TD className="text-right tabular-nums">{formatSar(f.specials)}</TD>
          </tr>
          <tr>
            <TD>Adjustments</TD>
            <TD className="text-right tabular-nums">{formatSar(f.adjustments)}</TD>
          </tr>
          <tr>
            <TD>Bonus</TD>
            <TD className="text-right tabular-nums">{formatSar(f.bonus)}</TD>
          </tr>
          <tr>
            <TD className="muted">Deductions</TD>
            <TD className="text-right tabular-nums muted">{formatSar(f.deductions)}</TD>
          </tr>
          <tr className="border-t-2">
            <TD className="font-semibold">Net pay</TD>
            <TD className="text-right tabular-nums font-semibold text-base">{formatSar(f.net)}</TD>
          </tr>
        </tbody>
      </Table>

      {/* WHAT THE COMMISSION ACTUALLY IS. A number with no provenance on a
          document someone is paid against is worth less than no number. */}
      {f.basis === "paid" && payouts.length > 0 && (
        <div className="mt-4 text-[12px]">
          <div className="font-medium mb-1">
            Settled by {payouts.length === 1 ? "payout" : `${payouts.length} payouts`}
          </div>
          <ul className="space-y-0.5 muted">
            {payouts.map((p) => (
              <li key={p.id} className="tabular-nums">
                {p.paid_at ? p.paid_at.slice(0, 10) : "—"} · {p.period_label ?? "—"} ·{" "}
                {formatSar(p.total_sar)}
              </li>
            ))}
          </ul>
          {covered && covered.count > 0 && covered.first_trip && (
            <p className="mt-1 muted">
              Covers {covered.count} {covered.count === 1 ? "trip" : "trips"} worked{" "}
              {covered.first_trip} – {covered.last_trip}.{" "}
              {covered.first_trip.slice(0, 7) !== row.period_start.slice(0, 7) && (
                <b>Some of that work was done in an earlier month; it is paid here because
                that is when it was settled.</b>
              )}
            </p>
          )}
        </div>
      )}

      {f.basis !== "paid" && (
        <Note>
          This commission is <b>earned but not yet paid</b>. When it is settled it will
          appear again, as PAID, on the payslip for the month it is paid in — that is a
          record of two different events, not the same money counted twice.
        </Note>
      )}

      {row.salary_missing && (
        <Note>No salary is recorded for this driver, so basic salary reads 0.</Note>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// COMMISSION REVIEW (0116) — DISPLAY ONLY. No buttons, no actions, writes
// nothing. Management reads what each driver EARNED.
//
// IT SITS UNDER THE PAYSLIP REGISTER AND SHOWS A DIFFERENT BASIS ON PURPOSE,
// which is the whole reason it is labelled as loudly as it is:
//
//   the register above  -> what was SETTLED in this month (paid_at)
//   this table          -> what was EARNED in the month the trips were DRIVEN
//
// The same driver legitimately shows two different totals on one screen. Live,
// two July drivers do. Without the labelling that reads as a bug in one of
// them, so the heading, the subtitle and the footnote all say "work month"
// and "earned, paid out or not" rather than leaving it to be inferred.
//
// Delivered trips only — commission exists on no other stage, and
// v_commissions_monthly (which the P&L reads) filters the same way, so this
// table cannot disagree with the P&L about what trip commission means.
// ---------------------------------------------------------------------------

function CommissionReviewTable({
  rows, periodStart, periodEnd, label,
}: {
  rows: DriverCommissionByProjectRow[];
  periodStart: string; periodEnd: string; label: string;
}) {
  const drivers = useMemo(() => {
    const inPeriod = rows.filter((r) => r.month >= periodStart && r.month <= periodEnd);

    // Group the view's driver x month x project rows into one row per driver
    // for the period. Summing view output across a period is what every
    // statement here already does; no metric is defined by this.
    const byDriver = new Map<string, {
      driverId: string; name: string; trips: number; commission: number;
      projects: Map<string, { name: string; trips: number }>;
    }>();

    for (const r of inPeriod) {
      const e = byDriver.get(r.driver_id) ?? {
        driverId: r.driver_id, name: r.driver_name, trips: 0, commission: 0,
        projects: new Map<string, { name: string; trips: number }>(),
      };
      e.trips += r.trips_delivered;
      e.commission += r.commission_sar;
      // A NULL project is a direct-customer trip — real work with real
      // commission, kept by the view rather than dropped. The UI names it, the
      // same way the Operations statement names its unassigned driver row.
      const key = r.project_id ?? "__direct__";
      const name = r.project_name ?? "Direct customer";
      const p = e.projects.get(key) ?? { name, trips: 0 };
      p.trips += r.trips_delivered;
      e.projects.set(key, p);
      byDriver.set(r.driver_id, e);
    }

    return [...byDriver.values()].sort((a, b) => b.commission - a.commission);
  }, [rows, periodStart, periodEnd]);

  // TWO DRIVERS SHARE THE NAME "Fahad 4" — different ids, both terminated. To a
  // manager reading a list of names they are the same person, and the rows
  // carry different money. Only ambiguous names get a discriminator, so the
  // common case stays clean: the app has no per-driver display code beyond the
  // name, and inventing one for every row would be noise.
  const duplicateNames = useMemo(() => {
    const seen = new Map<string, number>();
    for (const d of drivers) seen.set(d.name, (seen.get(d.name) ?? 0) + 1);
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [drivers]);

  const totals = drivers.reduce(
    (a, d) => ({ trips: a.trips + d.trips, commission: a.commission + d.commission }),
    { trips: 0, commission: 0 },
  );

  // Only this table prints, not the register above it. Both live in the DOM at
  // once, so a body class picks which subtree the print stylesheet keeps —
  // the same mechanism the breakdown report already uses.
  function printReview() {
    document.body.classList.add("printing-review");
    window.print();
    document.body.classList.remove("printing-review");
  }

  return (
    <div id="commission-review-print" className="card p-6 mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PrintBand title="Commission earned by driver" period={`${label} · work month`} />
          <h2 className="text-lg font-semibold no-print">Commission earned by driver</h2>
          <p className="text-sm muted no-print">
            {label} · <b>work month</b> — what each driver earned from the trips he
            drove in this period, <b>whether or not it has been paid out yet</b>.
          </p>
        </div>
        <Btn variant="outline" onClick={printReview} className="no-print">
          <Printer className="h-4 w-4" /> Print this table
        </Btn>
      </div>

      {/* THE DISTINCTION, STATED WHERE THE NUMBERS ARE. The register above uses
          the settlement month; this uses the work month. Same money, two
          questions — and the totals for one driver will legitimately differ. */}
      <div className="mt-3 mb-4 rounded-lg border border-brand-500/25 bg-brand-500/5 px-3 py-2 text-[12px] leading-relaxed">
        This is <b>not</b> the payslip figure above. The payslip register shows what was{" "}
        <b>settled</b> in this month; this table shows what was <b>earned</b> in the month
        the work was done. A driver whose June trips were paid in July appears here under{" "}
        <b>June</b> and on his payslip under <b>July</b>, so the two totals differing is
        expected, not an error.
      </div>

      {drivers.length === 0 ? (
        <Empty>No delivered trips in this period.</Empty>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <TH>Driver</TH>
                <TH className="text-right">Trips</TH>
                <TH>Projects served</TH>
                <TH className="text-right">Commission earned</TH>
              </tr>
            </thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.driverId}>
                  <TD className="font-medium align-top">
                    {d.name}
                    {duplicateNames.has(d.name) && (
                      <span className="ms-1.5 font-mono text-[10px] muted font-normal">
                        #{d.driverId.slice(0, 4)}
                      </span>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums align-top">{formatNum(d.trips)}</TD>
                  <TD className="align-top">
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                      {[...d.projects.values()]
                        .sort((a, b) => b.trips - a.trips)
                        .map((p) => (
                          <span key={p.name} className="whitespace-nowrap">
                            {p.name}{" "}
                            <span className="text-[11px] muted tabular-nums">
                              {formatNum(p.trips)}
                            </span>
                          </span>
                        ))}
                    </div>
                  </TD>
                  <TD className="text-right tabular-nums font-semibold align-top">
                    {formatSar(d.commission)}
                  </TD>
                </tr>
              ))}
              <tr className="border-t-2">
                <TD className="font-semibold">Total</TD>
                <TD className="text-right tabular-nums font-semibold">{formatNum(totals.trips)}</TD>
                <TD>{""}</TD>
                <TD className="text-right tabular-nums font-semibold">
                  {formatSar(totals.commission)}
                </TD>
              </tr>
            </tbody>
          </Table>

          <Note>
            Delivered trips only — commission is earned on delivery, so a scheduled or
            in-transit trip has earned nothing yet and is not counted here. The small
            number beside each project is that project&apos;s trip count. Trips taken for a
            direct customer rather than a project are grouped as <b>Direct customer</b>.
          </Note>
        </>
      )}
    </div>
  );
}
