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

import { useMemo } from "react";
import { Info } from "lucide-react";
import { Table, TH, TD } from "@/components/ui";
import { cn, formatSar, formatNum } from "@/lib/utils";
import type { BuiltReport } from "@/lib/report-builder";
import {
  monthsIn, sumOver, peakOver, formatShare, AGING_ORDER,
  type PnlPeriodRow, type RevenueInvoiceRow, type SalesReturnRow,
  type ReceivableRow, type AgingRow, type MaintenancePerTruckRow,
  type PurchasingRow, type PayrollRow, type CommissionsRow,
  type CommissionsPaidRow, type OperationsRow, type NarrativeBullet,
  type OperationsByDriverRow,
} from "@/lib/reports";

export function Note({ children }: { children: React.ReactNode }) {
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
function PrintBand({ title, period }: { title: string; period: string }) {
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

function Head({ title, period }: { title: string; period: string }) {
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
  periodStart, periodEnd, label,
}: {
  maintPerTruck: MaintenancePerTruckRow[];
  purchasing: PurchasingRow[];
  payroll: PayrollRow[];
  commissions: CommissionsRow[];
  commissionsPaid: CommissionsPaidRow[];
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

  return (
    <div id="cost-print" className="card p-6">
      <Head title="Cost statements" period={label} />

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
