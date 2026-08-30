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

import { useCallback, useMemo, useState } from "react";
import { Info, Printer } from "lucide-react";
import { Table, TH, TD, Btn } from "@/components/ui";
import { cn, formatSar, formatSarExact, formatNum, todayKey } from "@/lib/utils";
import { useApp } from "@/components/AppShell";
import { t, fill, plural, arText, type Lang } from "@/lib/i18n";
// WATER_TYPE_LABELS stays ENGLISH this batch, deliberately. It lives in
// lib/db-types.ts and is read by 20+ call sites across app/trips/**,
// lib/invoiceDisplay.ts and a server action — exactly one of them is in
// app/reports/. Translating it here would reach outside this batch; minting a
// reports-local copy is how one map becomes three and a fourth surface gets a
// fifth spelling. It is flagged for the Trips batch instead.
import { WATER_TYPE_LABELS, type WaterType } from "@/lib/db-types";
import type { BuiltReport } from "@/lib/report-builder";
import {
  basisLabel,
  monthsIn, sumOver, peakOver, formatShare, AGING_ORDER, outstandingLiveIndex,
  type InvoiceOutstandingLiveRow,
  type PnlPeriodRow, type RevenueInvoiceRow, type SalesReturnRow,
  type ReceivableRow, type AgingRow, type MaintenancePerTruckRow,
  type PurchasingRow, type PayrollRow, type CommissionsRow,
  type CommissionsPaidRow, type OperationsRow, type NarrativeBullet,
  type OperationsByDriverRow,
  type FillingMonthRow, type FillingByStationRow,
  type PayslipBasisRow, type IssuedPayslipRow,
  type DriverCommissionByProjectRow,
} from "@/lib/reports";
import {
  inMonth, violationTypeLabel,
  type DriverViolationView, type ViolationType,
} from "@/lib/violations";
import type { CsvValue } from "@/lib/csv";
// NOT a violation of the leaf rule above: exportSource.ts imports react,
// lib/csv and lib/i18n and nothing else — in particular it does not import
// StatementsTab, so the one-way edge this file depends on still holds.
import { useCsvSource, withSar, withPct, type RegisterCsv } from "./exportSource";

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
  const { lang } = useApp();
  return (
    <div className="print-only" style={{ marginBottom: "10pt", borderBottom: "1px solid #000", paddingBottom: "6pt" }}>
      {/* translate="no" — this line is the whole point of the band: it is the
          identification a filed sheet carries when nothing else on the paper
          says whose statement it is. A translated company name defeats that.
          The title and period below are content and translate normally. */}
      <div translate="no" style={{ fontSize: "8pt", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Bin Slimah Group
      </div>
      <div style={{ fontSize: "14pt", fontWeight: 600, marginTop: "2pt" }}>{title}</div>
      <div style={{ fontSize: "9pt", display: "flex", justifyContent: "space-between", marginTop: "2pt" }}>
        <span>{period}</span>
        {/* todayKey(), NOT toISOString().slice(0,10). This date is PRINTED on a
            document that leaves the building, and a UTC slice reads a day
            behind local for the first three hours after Riyadh midnight — so a
            statement generated at 01:30 went out stamped yesterday. Of the
            three UTC-slice sites this was the only one whose wrong answer
            ends up on paper in someone else's hands. */}
        <span>{fill(t("reports.print.generated", lang), { d: todayKey() })}</span>
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
  invoices, returns, outstandingLive, periodStart, periodEnd, label, registerCsv,
}: {
  invoices: RevenueInvoiceRow[]; returns: SalesReturnRow[];
  outstandingLive: InvoiceOutstandingLiveRow[];
  periodStart: string; periodEnd: string; label: string;
  registerCsv?: RegisterCsv;
}) {
  const { lang } = useApp();
  const rows = useMemo(() => {
    const inPeriod = invoices.filter((i) => i.month >= periodStart && i.month <= periodEnd);
    // 0137 — outstanding comes from the view, keyed by invoice_id. The cap
    // against the frozen figure lives in SQL; this is a join and a sum.
    const outstanding = outstandingLiveIndex(outstandingLive);
    const byCustomer = new Map<string, {
      name: string; revenue: number; paid: number; outstanding: number; count: number;
    }>();
    for (const i of inPeriod) {
      const e = byCustomer.get(i.customer_id)
        ?? { name: i.customer_name, revenue: 0, paid: 0, outstanding: 0, count: 0 };
      e.revenue += i.revenue_sar;
      e.count += 1;
      // Paid is measured on the invoice's own flag; outstanding on what the
      // customer STILL owes right now. An invoice can be partly covered by a
      // prepaid balance, so these are not two halves of one number and are not
      // presented as such — and since 0137 that is truer than it was: a prepaid
      // invoice can be unpaid AND owe nothing, because the balance now covers it.
      //
      // NO `else` HERE, deliberately. This used to add the frozen
      // amount_due_sar only on the not-paid branch; the view already publishes
      // a row for every confirmed, unpaid, non-void invoice and for nothing
      // else, so a PAID invoice is simply absent and contributes 0 on its own.
      // Re-testing is_paid would be a second, weaker copy of a predicate the
      // view already applies — and the two could disagree.
      if (i.is_paid) e.paid += i.revenue_sar;
      e.outstanding += outstanding.get(i.invoice_id) ?? 0;
      byCustomer.set(i.customer_id, e);
    }
    return [...byCustomer.values()].sort((a, b) => b.revenue - a.revenue);
  }, [invoices, outstandingLive, periodStart, periodEnd]);

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

  // ONE ROW PER CUSTOMER, plus the total line the table already shows.
  // The sales-returns sub-table below is NOT exported: it is a different grain
  // (one row per returned invoice, not per customer) and putting it under the
  // same headings would put a returned amount in the Revenue column. Its total
  // is on screen and is called out to Turki as an omission.
  const buildCsv = useCallback(() => {
    if (rows.length === 0) return null;
    return {
      slug: "revenue",
      title: t("reports.revenue.title", lang),
      period: label,
      columns: [
        t("reports.th.customer", lang),
        t("reports.th.invoices", lang),
        withSar(t("reports.metric.revenue", lang), lang),
        withSar(t("reports.th.paid", lang), lang),
        withSar(t("reports.th.outstanding", lang), lang),
      ],
      rows: [
        ...rows.map((r): CsvValue[] => [r.name, r.count, r.revenue, r.paid, r.outstanding]),
        // The invoice count on the total line is a sum of the counts above, the
        // same figure the footer renders — not a re-count of the source rows.
        [
          t("reports.th.total", lang),
          sumOver(rows, (r) => r.count),
          totals.revenue, totals.paid, totals.outstanding,
        ],
      ],
    };
  }, [lang, label, rows, totals.revenue, totals.paid, totals.outstanding]);

  useCsvSource(registerCsv, buildCsv);

  return (
    <div id="revenue-print" className="card p-6">
      <Head title={t("reports.revenue.title", lang)} period={label} />

      {rows.length === 0 ? (
        <Empty>{t("reports.revenue.empty", lang)}</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <TH>{t("reports.th.customer", lang)}</TH>
              <TH className="text-end">{t("reports.th.invoices", lang)}</TH>
              <TH className="text-end">{t("reports.metric.revenue", lang)}</TH>
              <TH className="text-end">{t("reports.th.paid", lang)}</TH>
              <TH className="text-end">{t("reports.th.outstanding", lang)}</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <TD>{r.name}</TD>
                <TD className="text-end tabular-nums">{formatNum(r.count)}</TD>
                <TD className="text-end tabular-nums">{formatSar(r.revenue)}</TD>
                <TD className="text-end tabular-nums muted">
                  {r.paid === 0 ? "—" : formatSar(r.paid)}
                </TD>
                <TD className="text-end tabular-nums">
                  {r.outstanding === 0 ? <span className="muted">—</span> : formatSar(r.outstanding)}
                </TD>
              </tr>
            ))}
            <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
              <TD>{t("reports.th.total", lang)}</TD>
              <TD className="text-end tabular-nums">{formatNum(sumOver(rows, (r) => r.count))}</TD>
              <TD className="text-end tabular-nums">{formatSar(totals.revenue)}</TD>
              <TD className="text-end tabular-nums">{formatSar(totals.paid)}</TD>
              <TD className="text-end tabular-nums">{formatSar(totals.outstanding)}</TD>
            </tr>
          </tbody>
        </Table>
      )}

      {/* Returns are a SEPARATE line, never netted into the figures above. */}
      <div className="mt-5">
        <h3 className="text-xs uppercase tracking-wide muted font-medium mb-2">
          {t("reports.revenue.returnsHead", lang)}
        </h3>
        {periodReturns.length === 0 ? (
          <p className="text-sm muted">{t("reports.revenue.noneInPeriod", lang)}</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <TH>{t("reports.th.invoice", lang)}</TH>
                <TH>{t("reports.th.reason", lang)}</TH>
                <TH className="text-end">{t("reports.th.reversed", lang)}</TH>
              </tr>
            </thead>
            <tbody>
              {periodReturns.map((r) => (
                <tr key={r.invoice_id}>
                  <TD>{r.invoice_number ?? "—"}</TD>
                  <TD className="muted">{r.void_reason ?? "—"}</TD>
                  <TD className="text-end tabular-nums">{formatSar(r.reversed_revenue_sar)}</TD>
                </tr>
              ))}
              <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
                <TD>{t("reports.revenue.totalReversed", lang)}</TD>
                <TD>{""}</TD>
                <TD className="text-end tabular-nums">{formatSar(returned)}</TD>
              </tr>
            </tbody>
          </Table>
        )}
      </div>

      <Note>{t("reports.revenue.note", lang)}</Note>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RECEIVABLES STATEMENT — a position as of today, not a period measure.
// ---------------------------------------------------------------------------
export function ReceivablesStatement({
  receivables, aging, registerCsv,
}: { receivables: ReceivableRow[]; aging: AgingRow[]; registerCsv?: RegisterCsv }) {
  const { lang } = useApp();
  const bands = AGING_ORDER.map((b) => {
    const row = aging.find((a) => a.aging_bucket === b);
    return { bucket: b, value: row?.outstanding_sar ?? 0, count: row?.invoice_count ?? 0 };
  });
  const total = sumOver(bands, (b) => b.value);
  // MEMOIZED for identity, not for cost. `[...x].sort()` returns a new array
  // every render, and the export callback below closes over it — an unstable
  // dep there re-registers on every render, and registering sets state one
  // level up, so the render that follows re-registers again. Same order, same
  // rows; only the reference is now stable.
  const ordered = useMemo(
    () => [...receivables].sort((a, b) => b.days_outstanding - a.days_outstanding),
    [receivables],
  );

  // THE OPEN INVOICES, NOT THE AGING BANDS. The bands are a four-row summary of
  // the very rows below them — a spreadsheet reader can pivot the band out of
  // the day count, and cannot recover an invoice from a band. Each row carries
  // its own band anyway, so nothing in the summary is lost.
  //
  // NO `period`. This statement is a position as of today, not a measure over a
  // range: `Head` prints "As of today" where every other statement prints a
  // period label, and the file says the same (see CsvTable.period in lib/csv).
  const buildCsv = useCallback(() => {
    if (ordered.length === 0) return null;
    return {
      slug: "receivables",
      title: t("reports.receivables.title", lang),
      period: t("reports.receivables.asOfToday", lang),
      columns: [
        t("reports.th.invoice", lang),
        t("reports.th.customer", lang),
        t("reports.th.confirmed", lang),
        t("reports.th.band", lang),
        t("reports.th.days", lang),
        withSar(t("reports.th.outstanding", lang), lang),
      ],
      rows: ordered.map((r): CsvValue[] => [
        // An unnumbered invoice writes an EMPTY cell, not the em dash the table
        // shows: a dash in a spreadsheet is a value someone can filter on by
        // accident, an empty cell is the absence it actually is.
        r.invoice_number ?? null,
        r.customer_name,
        // The date only, as rendered — confirmed_at is a full timestamp and the
        // time of day is not what this column reports.
        r.confirmed_at.slice(0, 10),
        r.aging_bucket,
        r.days_outstanding,
        r.outstanding_sar,
      ]),
    };
  }, [lang, ordered]);

  useCsvSource(registerCsv, buildCsv);

  return (
    <div id="receivables-print" className="card p-6">
      <Head title={t("reports.receivables.title", lang)}
        period={t("reports.receivables.asOfToday", lang)} />

      {total === 0 ? (
        <Empty>{t("reports.nothingOutstanding", lang)}</Empty>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <TH>{t("reports.th.band", lang)}</TH>
                <TH className="text-end">{t("reports.th.invoices", lang)}</TH>
                <TH className="text-end">{t("reports.th.outstanding", lang)}</TH>
                <TH className="text-end">{t("reports.th.share", lang)}</TH>
              </tr>
            </thead>
            <tbody>
              {bands.map((b) => (
                <tr key={b.bucket}>
                  {/* `b.bucket` is the view's own aging label — "0-30", "90+".
                      Digits and punctuation only, so it goes in unchanged and
                      un-reformatted; only the word beside it is keyed. */}
                  <TD>{fill(t("reports.receivables.bandDays", lang), { b: b.bucket })}</TD>
                  <TD className="text-end tabular-nums">{formatNum(b.count)}</TD>
                  <TD className="text-end tabular-nums">
                    {b.value === 0 ? <span className="muted">—</span> : formatSar(b.value)}
                  </TD>
                  <TD className="text-end tabular-nums muted">
                    {formatShare(total > 0 ? (b.value / total) * 100 : null)}
                  </TD>
                </tr>
              ))}
              <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
                <TD>{t("reports.th.total", lang)}</TD>
                <TD className="text-end tabular-nums">{formatNum(sumOver(bands, (b) => b.count))}</TD>
                <TD className="text-end tabular-nums">{formatSar(total)}</TD>
                {/* Not keyed: the band shares always total 100 %, so this is a
                    figure written as a constant, not a sentence. It matches
                    formatShare()'s output and stays Latin in both languages
                    like every other number on the page. */}
                <TD className="text-end tabular-nums">100.0%</TD>
              </tr>
            </tbody>
          </Table>

          <h3 className="text-xs uppercase tracking-wide muted font-medium mt-5 mb-2">
            {t("reports.receivables.openInvoices", lang)}
          </h3>
          <Table>
            <thead>
              <tr>
                <TH>{t("reports.th.invoice", lang)}</TH>
                <TH>{t("reports.th.customer", lang)}</TH>
                <TH>{t("reports.th.confirmed", lang)}</TH>
                <TH className="text-end">{t("reports.th.days", lang)}</TH>
                <TH className="text-end">{t("reports.th.outstanding", lang)}</TH>
              </tr>
            </thead>
            <tbody>
              {ordered.map((r) => (
                <tr key={r.invoice_id}>
                  <TD>{r.invoice_number ?? "—"}</TD>
                  <TD>{r.customer_name}</TD>
                  <TD className="muted">{r.confirmed_at.slice(0, 10)}</TD>
                  <TD className="text-end tabular-nums">
                    {/* Same day-colouring convention as the Overview. */}
                    <span className={cn(
                      r.days_outstanding > 90 ? "text-rose-600 dark:text-rose-400 font-medium" :
                      r.days_outstanding > 60 ? "text-amber-600 dark:text-amber-400" : "",
                    )}>
                      {formatNum(r.days_outstanding)}
                    </span>
                  </TD>
                  <TD className="text-end tabular-nums">{formatSar(r.outstanding_sar)}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}

      <Note>{t("reports.receivables.note", lang)}</Note>
    </div>
  );
}

// ---------------------------------------------------------------------------
// COST STATEMENTS
// ---------------------------------------------------------------------------
export function CostStatement({
  maintPerTruck, purchasing, payroll, commissions, commissionsPaid,
  filling, fillingByStation,
  periodStart, periodEnd, label, registerCsv,
}: {
  maintPerTruck: MaintenancePerTruckRow[];
  purchasing: PurchasingRow[];
  payroll: PayrollRow[];
  commissions: CommissionsRow[];
  commissionsPaid: CommissionsPaidRow[];
  filling: FillingMonthRow[];
  fillingByStation: FillingByStationRow[];
  periodStart: string; periodEnd: string; label: string;
  registerCsv?: RegisterCsv;
}) {
  const { lang } = useApp();
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

  // PEAK, never a sum — people_missing_salary is a per-month STATE, so the
  // highest month is the honest figure and adding twelve of them would invent
  // people. Hoisted because the note below read it four times to answer one
  // question; the count-bucket sentence now asks once.
  const missingSalary = peakOver(pay, (r) => r.people_missing_salary);

  // `tr`, not `t` — the translator is imported into this scope now, and a
  // callback parameter named `t` shadows it for the whole body. Same rule as
  // the period picker in StatementsTab.
  const partsTotal = sumOver(trucks, (tr) => tr.parts);
  const osTotal = sumOver(trucks, (tr) => tr.os);

  // HOISTED, NOT NEW. Each of these was written inline in a <TD> below and is
  // now named so the CSV builder and the cell that renders it read the SAME
  // expression — a second copy in the builder is a second place for a money
  // figure to drift. Identical arithmetic, identical order; `earned` and `paid`
  // above are left exactly as they were.
  const staffSalary = sumOver(pay, (r) => r.staff_salary_sar);
  const driverSalary = sumOver(pay, (r) => r.driver_salary_sar);
  const totalPayroll = sumOver(pay, (r) => r.staff_salary_sar + r.driver_salary_sar);
  const tripCommission = sumOver(com, (r) => r.trip_commission_sar);
  const specials = sumOver(com, (r) => r.specials_sar);
  const adjustments = sumOver(com, (r) => r.adjustments_sar);
  const bonuses = sumOver(com, (r) => r.bonus_sar);
  const payoutCount = sumOver(comPaid, (r) => r.payout_count);
  const stockReceived = sumOver(pur, (r) => r.received_stock_value_sar);
  const receiptCount = sumOver(pur, (r) => r.receipt_count);

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
    const m = new Map<string, {
      key: string; name: string | null; sar: number; costed: number; uncosted: number;
    }>();
    for (const r of fillRows) {
      const e = m.get(r.station_key) ?? {
        // A null name means the station key no longer exists. The cost still
        // counts, so the row is labelled rather than dropped from the total —
        // but the LABEL is built at render, not here. Composing it in the memo
        // would put a translated string in the dependency array and leave the
        // table in the previous language until fillRows next changed.
        key: r.station_key, name: r.station_name,
        sar: 0, costed: 0, uncosted: 0,
      };
      e.sar += r.filling_cost_sar;
      e.costed += r.costed_trips;
      e.uncosted += r.uncosted_trips;
      m.set(r.station_key, e);
    }
    return [...m.values()].sort((a, b) => b.sar - a.sar);
  }, [fillRows]);

  // THE TOTALS, NOT THE BREAKDOWNS. This statement puts six tables on screen —
  // fill by water type, fill by station, maintenance per truck, payroll,
  // commissions earned, commissions paid, plus purchasing — and they have four
  // different row grains. One CSV cannot hold four grains without either
  // inventing blank columns or firing four files from one button, so it holds
  // the scalar totals every one of those tables foots to. The per-truck,
  // per-station and per-water-type rows are called out as omissions.
  //
  // Component | Unit | Value: a single numeric column carrying riyals AND trip
  // counts, so the unit rides per ROW, the same shape the Overview export uses.
  const buildCsv = useCallback(() => {
    const SAR = t("reports.export.unitSar", lang);
    const CNT = t("reports.export.unitCount", lang);
    const rows: CsvValue[][] = [
      // Fill cost. THE UNCOSTED COUNT TRAVELS WITH THE MONEY, here as much as on
      // screen: sum() skips a fill whose station has no price for its water
      // type, so `fillTotal` is the total of what is KNOWN and is short by an
      // unknown amount whenever that count is above zero. A file with the money
      // and without the count is a total that is quietly wrong.
      [t("reports.costs.fillHead", lang), SAR, fillTotal],
      [t("reports.th.fills", lang), CNT, fillCosted],
      [t("reports.th.uncosted", lang), CNT, fillUncosted],

      [t("reports.th.parts", lang), SAR, partsTotal],
      [t("reports.th.outsourced", lang), SAR, osTotal],
      [t("reports.costs.maintHead", lang), SAR, partsTotal + osTotal],

      [t("reports.costs.staffSalaries", lang), SAR, staffSalary],
      [t("reports.costs.driverSalaries", lang), SAR, driverSalary],
      [t("reports.costs.totalPayroll", lang), SAR, totalPayroll],

      [t("reports.costs.tripCommission", lang), SAR, tripCommission],
      [t("reports.costs.specials", lang), SAR, specials],
      [t("reports.costs.adjustments", lang), SAR, adjustments],
      [t("reports.costs.bonuses", lang), SAR, bonuses],
      [t("reports.costs.totalEarned", lang), SAR, earned],
      // CASH, NOT ACCRUAL — and never netted against the earned lines above.
      // The two panels sit side by side on screen for exactly that reason.
      [t("reports.costs.payouts", lang), CNT, payoutCount],
      [t("reports.costs.totalPaid", lang), SAR, paid],

      // NOT A P&L COST — stock received is inventory moving, expensed when it is
      // consumed. It sits last, below everything that does belong to the
      // statement, so no reader takes the column as something that sums.
      [t("reports.costs.stockReceived", lang), SAR, stockReceived],
      [t("reports.costs.receipts", lang), CNT, receiptCount],
    ];
    return {
      slug: "costs",
      title: t("reports.costs.title", lang),
      period: label,
      columns: [
        t("common.component", lang),
        t("reports.export.unit", lang),
        t("reports.th.value", lang),
      ],
      rows,
    };
  }, [
    lang, label, fillTotal, fillCosted, fillUncosted, partsTotal, osTotal,
    staffSalary, driverSalary, totalPayroll,
    tripCommission, specials, adjustments, bonuses, earned, payoutCount, paid,
    stockReceived, receiptCount,
  ]);

  useCsvSource(registerCsv, buildCsv);

  return (
    <div id="cost-print" className="card p-6">
      <Head title={t("reports.costs.title", lang)} period={label} />

      {/* --- Station fill cost (0112) ------------------------------------
          THE UNCOSTED COUNT IS NOT OPTIONAL DECORATION. sum() skips NULLs,
          so every figure here is the total of what is KNOWN and is short by
          an unknown amount whenever a fill has no price for its water type.
          Showing the money alone would be showing a total that is quietly
          wrong, so the count sits beside every total and in both tables. */}
      <h3 className="text-xs uppercase tracking-wide muted font-medium mb-2">
        {t("reports.costs.fillHead", lang)}
      </h3>
      {/* An explicit separator, not just the flex gap. Two adjacent spans have
          NO whitespace between them in JSX, so if the gap ever fails to apply —
          print stylesheet, or CSS not yet loaded — they run together as
          "4,390 SAR520 fills costed". The middot also matches the separator
          convention used elsewhere in the app. */}
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-lg font-semibold tabular-nums">{formatSar(fillTotal)}</span>
        <span className="text-xs muted" aria-hidden>·</span>
        {/* `{n}` goes in RAW, not through formatNum — this count was
            interpolated directly before this commit and adding a thousands
            separator now would change a figure, not translate it. */}
        <span className="text-xs muted">
          {fill(t(`reports.costs.fillsCosted.${plural(fillCosted)}`, lang), { n: fillCosted })}
        </span>
        {fillUncosted > 0 && (
          <>
            <span className="text-xs muted" aria-hidden>·</span>
            {/* English spliced TWO words off one `=== 1` test — "fill
                has"/"fills have" and "its"/"their". Arabic changes more than
                those two words, so the sentence is stored whole per count
                bucket instead of assembled from fragments. */}
            <span className="text-xs text-amber-700 dark:text-amber-300">
              {fill(t(`reports.costs.uncosted.${plural(fillUncosted)}`, lang), { n: fillUncosted })}
            </span>
          </>
        )}
      </div>

      {fillRows.length === 0 ? (
        <p className="text-sm muted mb-6">{t("reports.costs.noFills", lang)}</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div>
            <h4 className="text-[11px] uppercase tracking-wide muted mb-1">
              {t("reports.costs.byWaterType", lang)}
            </h4>
            <Table>
              <thead>
                <tr>
                  <TH>{t("reports.th.waterType", lang)}</TH>
                  <TH className="text-end">{t("reports.th.fills", lang)}</TH>
                  <TH className="text-end">{t("reports.th.uncosted", lang)}</TH>
                  <TH className="text-end">{t("common.cost", lang)}</TH>
                </tr>
              </thead>
              <tbody>
                {byType.map(([wt, v]) => (
                  <tr key={wt}>
                    {/* Still English in both languages — see the import note.
                        The map is shared with Trips and translating it is that
                        batch's job, not a reports-local second copy. */}
                    <TD>{WATER_TYPE_LABELS[wt as WaterType] ?? wt}</TD>
                    <TD className="text-end tabular-nums">{v.costed}</TD>
                    <TD className={cn("text-end tabular-nums",
                      v.uncosted > 0 && "text-amber-700 dark:text-amber-300")}>
                      {v.uncosted || "—"}
                    </TD>
                    <TD className="text-end tabular-nums">{formatSar(v.sar)}</TD>
                  </tr>
                ))}
                <tr className="font-semibold border-t" style={{ borderColor: "rgb(var(--border))" }}>
                  <TD>{t("reports.th.total", lang)}</TD>
                  <TD className="text-end tabular-nums">{fillCosted}</TD>
                  <TD className="text-end tabular-nums">{fillUncosted || "—"}</TD>
                  <TD className="text-end tabular-nums">{formatSar(fillTotal)}</TD>
                </tr>
              </tbody>
            </Table>
          </div>

          <div>
            <h4 className="text-[11px] uppercase tracking-wide muted mb-1">
              {t("reports.costs.byStation", lang)}
            </h4>
            <Table>
              <thead>
                <tr>
                  <TH>{t("reports.th.station", lang)}</TH>
                  <TH className="text-end">{t("reports.th.fills", lang)}</TH>
                  <TH className="text-end">{t("reports.th.uncosted", lang)}</TH>
                  <TH className="text-end">{t("common.cost", lang)}</TH>
                </tr>
              </thead>
              <tbody>
                {byStation.map((v) => (
                  // Keyed on station_key, not the display name: the name is
                  // now nullable, two stations could share one, and 0014 makes
                  // the key the immutable identity anyway.
                  <tr key={v.key}>
                    <TD>{v.name ?? fill(t("reports.costs.stationRemoved", lang), { k: v.key })}</TD>
                    <TD className="text-end tabular-nums">{v.costed}</TD>
                    <TD className={cn("text-end tabular-nums",
                      v.uncosted > 0 && "text-amber-700 dark:text-amber-300")}>
                      {v.uncosted || "—"}
                    </TD>
                    <TD className="text-end tabular-nums">{formatSar(v.sar)}</TD>
                  </tr>
                ))}
                <tr className="font-semibold border-t" style={{ borderColor: "rgb(var(--border))" }}>
                  <TD>{t("reports.th.total", lang)}</TD>
                  <TD className="text-end tabular-nums">{fillCosted}</TD>
                  <TD className="text-end tabular-nums">{fillUncosted || "—"}</TD>
                  <TD className="text-end tabular-nums">{formatSar(fillTotal)}</TD>
                </tr>
              </tbody>
            </Table>
          </div>
        </div>
      )}

      {/* --- Maintenance per truck --- */}
      <h3 className="text-xs uppercase tracking-wide muted font-medium mb-2">
        {t("reports.costs.maintHead", lang)}
      </h3>
      {trucks.length === 0 ? (
        <p className="text-sm muted">{t("reports.costs.noMaint", lang)}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <TH>{t("reports.th.truck", lang)}</TH>
              <TH className="text-end">{t("reports.th.parts", lang)}</TH>
              <TH className="text-end">{t("reports.th.outsourced", lang)}</TH>
              <TH className="text-end">{t("reports.th.total", lang)}</TH>
            </tr>
          </thead>
          <tbody>
            {/* `tr`, not `t` — a map parameter named `t` shadows the translator
                for the whole callback body. */}
            {trucks.map((tr) => (
              <tr key={tr.plate}>
                <TD>{tr.plate}</TD>
                <TD className="text-end tabular-nums muted">
                  {tr.parts === 0 ? "—" : formatSar(tr.parts)}
                </TD>
                <TD className="text-end tabular-nums muted">
                  {tr.os === 0 ? "—" : formatSar(tr.os)}
                </TD>
                <TD className="text-end tabular-nums font-medium">{formatSar(tr.total)}</TD>
              </tr>
            ))}
            <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
              <TD>{t("reports.th.total", lang)}</TD>
              <TD className="text-end tabular-nums">{formatSar(partsTotal)}</TD>
              <TD className="text-end tabular-nums">{formatSar(osTotal)}</TD>
              <TD className="text-end tabular-nums">{formatSar(partsTotal + osTotal)}</TD>
            </tr>
          </tbody>
        </Table>
      )}
      <Note>{t("reports.costs.maintNote", lang)}</Note>

      {/* --- Payroll --- */}
      <h3 className="text-xs uppercase tracking-wide muted font-medium mt-6 mb-2">
        {t("reports.metric.payroll", lang)}
      </h3>
      <Table>
        <thead>
          <tr>
            <TH>{t("common.component", lang)}</TH>
            <TH className="text-end">{t("reports.th.amount", lang)}</TH>
          </tr>
        </thead>
        <tbody>
          <tr>
            <TD>{t("reports.costs.staffSalaries", lang)}</TD>
            <TD className="text-end tabular-nums">{formatSar(staffSalary)}</TD>
          </tr>
          <tr>
            <TD>{t("reports.costs.driverSalaries", lang)}</TD>
            <TD className="text-end tabular-nums">{formatSar(driverSalary)}</TD>
          </tr>
          <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
            <TD>{t("reports.costs.totalPayroll", lang)}</TD>
            <TD className="text-end tabular-nums">
              {formatSar(totalPayroll)}
            </TD>
          </tr>
        </tbody>
      </Table>
      {/* Split at the one mid-sentence <strong>. The space before it and after
          `</strong>` is JSX — the dictionary values carry no edge whitespace,
          so neither seam can silently join two words. */}
      <Note>
        {t("reports.costs.payrollNoteBefore", lang)}{" "}
        <strong>{t("reports.costs.payrollNoteStrong", lang)}</strong>{" "}
        {t("reports.costs.payrollNoteAfter", lang)}
        {/* English spliced THREE words off one `=== 1` test — "person
            has"/"people have" and "counts"/"count". Whole sentence per count
            bucket; the leading space is JSX, not part of the value. */}
        {missingSalary > 0 && (
          <> {fill(t(`reports.costs.missingSalary.${plural(missingSalary)}`, lang),
            { n: missingSalary })}</>
        )}
      </Note>

      {/* --- Commissions --- */}
      <h3 className="text-xs uppercase tracking-wide muted font-medium mt-6 mb-2">
        {t("reports.costs.commissionsHead", lang)}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Table>
            <thead>
              <tr>
                <TH>{t("reports.costs.earnedAccrual", lang)}</TH>
                <TH className="text-end">{t("reports.th.amount", lang)}</TH>
              </tr>
            </thead>
            <tbody>
              <tr>
                <TD>{t("reports.costs.tripCommission", lang)}</TD>
                <TD className="text-end tabular-nums">{formatSar(tripCommission)}</TD>
              </tr>
              <tr>
                <TD>{t("reports.costs.specials", lang)}</TD>
                <TD className="text-end tabular-nums">{formatSar(specials)}</TD>
              </tr>
              <tr>
                <TD>{t("reports.costs.adjustments", lang)}</TD>
                <TD className="text-end tabular-nums">{formatSar(adjustments)}</TD>
              </tr>
              <tr>
                <TD>{t("reports.costs.bonuses", lang)}</TD>
                <TD className="text-end tabular-nums">{formatSar(bonuses)}</TD>
              </tr>
              <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
                <TD>{t("reports.costs.totalEarned", lang)}</TD>
                <TD className="text-end tabular-nums">{formatSar(earned)}</TD>
              </tr>
            </tbody>
          </Table>
        </div>
        <div>
          <Table>
            <thead>
              <tr>
                <TH>{t("reports.costs.paidCash", lang)}</TH>
                <TH className="text-end">{t("reports.th.amount", lang)}</TH>
              </tr>
            </thead>
            <tbody>
              <tr>
                <TD>{t("reports.costs.payouts", lang)}</TD>
                <TD className="text-end tabular-nums">{formatNum(payoutCount)}</TD>
              </tr>
              <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
                <TD>{t("reports.costs.totalPaid", lang)}</TD>
                <TD className="text-end tabular-nums">{formatSar(paid)}</TD>
              </tr>
            </tbody>
          </Table>
        </div>
      </div>
      {/* No space after `</strong>`: the AFTER value opens with the full stop
          that closes the emphasised clause. */}
      <Note>
        {t("reports.costs.commissionsNoteBefore", lang)}{" "}
        <strong>{t("reports.costs.commissionsNoteStrong", lang)}</strong>
        {t("reports.costs.commissionsNoteAfter", lang)}
      </Note>

      {/* --- Purchasing --- */}
      <h3 className="text-xs uppercase tracking-wide muted font-medium mt-6 mb-2">
        {/* `&amp;` was JSX ESCAPING, not content — this always rendered a
            literal "P&L", so that is what the dictionary value holds. */}
        {t("reports.costs.purchasingHead", lang)}
      </h3>
      <Table>
        <thead>
          <tr>
            <TH>{t("reports.th.measure", lang)}</TH>
            <TH className="text-end">{t("reports.th.value", lang)}</TH>
          </tr>
        </thead>
        <tbody>
          <tr>
            <TD>{t("reports.costs.stockReceived", lang)}</TD>
            <TD className="text-end tabular-nums">
              {formatSar(stockReceived)}
            </TD>
          </tr>
          <tr>
            <TD>{t("reports.costs.receipts", lang)}</TD>
            <TD className="text-end tabular-nums">{formatNum(receiptCount)}</TD>
          </tr>
        </tbody>
      </Table>
      <Note>
        {t("reports.costs.purchasingNoteBefore", lang)}{" "}
        <strong>{t("reports.costs.purchasingNoteStrong", lang)}</strong>{" "}
        {t("reports.costs.purchasingNoteAfter", lang)}
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
  // NULL is the no-driver-recorded bucket, and it stays null all the way to
  // the cell that renders it. Baking "Unassigned" in here would put a
  // translated string inside a useMemo keyed on data, so the table would keep
  // the old language until the rows themselves changed.
  name: string | null;
  plate: string | null;
  trucksUsed: number;
  scheduled: number;
  delivered: number;
  notDelivered: number;
  completion: number | null;
};

export function OperationsStatement({
  operations, byDriver, periodStart, periodEnd, label, multiMonth, registerCsv,
}: {
  operations: OperationsRow[];
  byDriver: OperationsByDriverRow[];
  periodStart: string; periodEnd: string; label: string;
  multiMonth: boolean;
  registerCsv?: RegisterCsv;
}) {
  const { lang } = useApp();
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
        name: r.driver_name,
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
      <span className="block font-medium">{d.name ?? t("reports.ops.unassigned", lang)}</span>
      <span className="block text-[10px] muted">{d.plate ?? "—"}</span>
      {/* `{n}` stays RAW — this count was interpolated directly and passing it
          through formatNum would add a separator the phrase never had. The
          `one` bucket is unreachable behind `> 1` and is minted anyway: a leaf
          missing from the family would not typecheck, and an unreachable
          branch is cheaper than a template literal that cannot compile. */}
      {d.trucksUsed > 1 && (
        <span className="block text-[10px] muted">
          {fill(t(`reports.ops.droveTrucks.${plural(d.trucksUsed)}`, lang), { n: d.trucksUsed })}
        </span>
      )}
    </TD>
  );

  // THE TWO DRIVER TABLES, MERGED INTO ONE. Delivery and Fleet utilisation are
  // split on screen because eight numeric columns is too wide to read; a
  // spreadsheet has no such limit and one row per driver is what a reader will
  // sort and filter. Nothing is lost in the merge — both tables have the same
  // rows in the same order, and the "drove N trucks" note under a driver's name
  // becomes its own column rather than a sentence.
  //
  // The period-summary table below (trips, trucks that moved, work orders,
  // maintenance events, exit permits) is NOT here: it is fleet-level, a
  // different grain from a driver row, and its figures are the P&L spine's own
  // — the Overview export carries them against a period. Called out as an
  // omission rather than bolted on as blank-padded rows.
  const buildCsv = useCallback(() => {
    if (drivers.length === 0) return null;
    return {
      slug: "operations",
      title: t("reports.ops.title", lang),
      period: label,
      columns: [
        t("common.driver", lang),
        t("common.truck", lang),
        t("reports.th.trucks", lang),
        t("reports.th.tripsScheduled", lang),
        t("reports.metric.tripsDelivered", lang),
        t("reports.th.notDelivered", lang),
        withPct(t("reports.th.completionRate", lang), lang),
        withPct(t("reports.th.shareScheduled", lang), lang),
        withPct(t("reports.th.shareDelivered", lang), lang),
      ],
      rows: drivers.map((d): CsvValue[] => [
        // The same fallback the driver cell renders — a null driver_id is the
        // no-driver-recorded bucket, kept so the rows foot to the total.
        d.name ?? t("reports.ops.unassigned", lang),
        d.plate,
        d.trucksUsed,
        d.scheduled,
        d.delivered,
        d.notDelivered,
        // RAW PERCENTAGE POINTS in all three, as `formatShare` receives them.
        // The completion rate comes off the memo, recomputed there from each
        // driver's own period totals rather than averaged from monthly rates.
        // The two shares are the same expressions the utilisation cells hold,
        // over the same period denominators.
        d.completion,
        driverScheduled > 0 ? (d.scheduled / driverScheduled) * 100 : null,
        driverDelivered > 0 ? (d.delivered / driverDelivered) * 100 : null,
      ]),
    };
  }, [lang, label, drivers, driverScheduled, driverDelivered]);

  useCsvSource(registerCsv, buildCsv);

  return (
    <div id="ops-print" className="card p-6">
      <Head title={t("reports.ops.title", lang)} period={label} />

      {drivers.length === 0 ? (
        <Note>{t("reports.ops.noTrips", lang)}</Note>
      ) : (
        <>
          {/* --- DELIVERY: one row per driver, measures across the top. --- */}
          <h3 className="text-xs uppercase tracking-wide muted font-medium mb-2">
            {t("reports.ops.deliveryByDriver", lang)}
          </h3>
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <TH>{t("common.driver", lang)}</TH>
                  <TH className="text-end">{t("reports.th.tripsScheduled", lang)}</TH>
                  <TH className="text-end">{t("reports.metric.tripsDelivered", lang)}</TH>
                  <TH className="text-end">{t("reports.th.notDelivered", lang)}</TH>
                  <TH className="text-end">{t("reports.th.completionRate", lang)}</TH>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.key}>
                    {driverCell(d)}
                    <TD className="text-end tabular-nums">{formatNum(d.scheduled)}</TD>
                    <TD className="text-end tabular-nums">{formatNum(d.delivered)}</TD>
                    <TD className="text-end tabular-nums">
                      {d.notDelivered === 0 ? <span className="muted">—</span> : formatNum(d.notDelivered)}
                    </TD>
                    <TD className="text-end tabular-nums font-medium">{formatShare(d.completion)}</TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <Note>{t("reports.ops.deliveryNote", lang)}</Note>

          {/* --- FLEET UTILISATION: DRIVER-WORKLOAD measures only. --- */}
          <h3 className="text-xs uppercase tracking-wide muted font-medium mt-6 mb-2">
            {t("reports.ops.utilisationHead", lang)}
          </h3>
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <TH>{t("common.driver", lang)}</TH>
                  <TH className="text-end">{t("reports.th.shareScheduled", lang)}</TH>
                  <TH className="text-end">{t("reports.th.shareDelivered", lang)}</TH>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.key}>
                    {driverCell(d)}
                    <TD className="text-end tabular-nums">
                      {formatShare(driverScheduled > 0 ? (d.scheduled / driverScheduled) * 100 : null)}
                    </TD>
                    <TD className="text-end tabular-nums">
                      {formatShare(driverDelivered > 0 ? (d.delivered / driverDelivered) * 100 : null)}
                    </TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <Note>
            {t("reports.ops.utilisationNote", lang)}
            {/* The branch tests the KEY, not the label — `__unassigned__` is
                what the memo bucketed a null driver_id under, so the footnote
                appears for the same rows in both languages. The emphasised
                word is the same leaf the driver cell renders. */}
            {drivers.some((d) => d.key === "__unassigned__") && (
              <> {t("reports.ops.unassignedNoteBefore", lang)}{" "}
              <strong>{t("reports.ops.unassigned", lang)}</strong>
              {t("reports.ops.unassignedNoteAfter", lang)}</>
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
      <h3 className="text-xs uppercase tracking-wide muted font-medium mt-6 mb-2">
        {t("reports.ops.periodSummary", lang)}
      </h3>
      <Table>
        <thead>
          <tr>
            <TH>{t("reports.th.measure", lang)}</TH>
            <TH className="text-end">{t("reports.th.value", lang)}</TH>
          </tr>
        </thead>
        <tbody>
          <tr>
            <TD>{t("reports.th.tripsScheduled", lang)}</TD>
            <TD className="text-end tabular-nums">{formatNum(trips)}</TD>
          </tr>
          <tr>
            <TD>{t("reports.metric.tripsDelivered", lang)}</TD>
            <TD className="text-end tabular-nums">{formatNum(delivered)}</TD>
          </tr>
          <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
            <TD>{t("reports.ops.deliveryCompletionRate", lang)}</TD>
            <TD className="text-end tabular-nums">{formatShare(completion)}</TD>
          </tr>
          <tr>
            <TD>
              {t("reports.ops.trucksThatMoved", lang)}
              {/* The space before the qualifier is JSX and sits inside the
                  span, exactly where it did before. */}
              {multiMonth && (
                <span className="muted text-xs"> {t("reports.ops.mostInAnyMonth", lang)}</span>
              )}
            </TD>
            <TD className="text-end tabular-nums">{formatNum(peakTrucks)}</TD>
          </tr>
          <tr>
            <TD>{t("reports.ops.workOrders", lang)}</TD>
            <TD className="text-end tabular-nums">{formatNum(workOrders)}</TD>
          </tr>
          <tr>
            <TD>{t("reports.ops.outsourcedJobs", lang)}</TD>
            <TD className="text-end tabular-nums">{formatNum(osJobs)}</TD>
          </tr>
          <tr>
            <TD>{t("reports.ops.maintenanceEvents", lang)}</TD>
            <TD className="text-end tabular-nums">{formatNum(maintenanceEvents)}</TD>
          </tr>
          <tr>
            <TD>{t("reports.ops.exitPermits", lang)}</TD>
            <TD className="text-end tabular-nums">{formatNum(permits)}</TD>
          </tr>
        </tbody>
      </Table>

      {rows.length > 1 && (
        <>
          <h3 className="text-xs uppercase tracking-wide muted font-medium mt-6 mb-2">
            {t("reports.ops.byMonth", lang)}
          </h3>
          <Table>
            <thead>
              <tr>
                <TH>{t("reports.th.month", lang)}</TH>
                <TH className="text-end">{t("reports.th.trips", lang)}</TH>
                <TH className="text-end">{t("reports.th.delivered", lang)}</TH>
                <TH className="text-end">{t("reports.th.completion", lang)}</TH>
                <TH className="text-end">{t("reports.th.trucks", lang)}</TH>
                <TH className="text-end">{t("reports.th.wos", lang)}</TH>
                <TH className="text-end">{t("reports.th.osJobs", lang)}</TH>
                <TH className="text-end">{t("reports.th.permits", lang)}</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month}>
                  <TD>{r.month.slice(0, 7)}</TD>
                  <TD className="text-end tabular-nums">{formatNum(r.trips_total)}</TD>
                  <TD className="text-end tabular-nums">{formatNum(r.trips_delivered)}</TD>
                  <TD className="text-end tabular-nums">
                    {formatShare(r.trips_total > 0 ? (r.trips_delivered / r.trips_total) * 100 : null)}
                  </TD>
                  <TD className="text-end tabular-nums">{formatNum(r.trucks_active)}</TD>
                  <TD className="text-end tabular-nums">{formatNum(r.work_orders)}</TD>
                  <TD className="text-end tabular-nums">{formatNum(r.outsourced_jobs)}</TD>
                  <TD className="text-end tabular-nums">{formatNum(r.exit_permits)}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}

      <Note>
        {t("reports.ops.countsNoteBefore", lang)}{" "}
        <strong>{t("reports.ops.countsNoteStrong", lang)}</strong>{" "}
        {t("reports.ops.countsNoteAfter", lang)}
      </Note>
      {/* TWO mid-sentence emphases, so five leaves and four JSX separators. */}
      <Note>
        {t("reports.ops.absentNote1", lang)}{" "}
        <strong>{t("reports.ops.absentStrong1", lang)}</strong>{" "}
        {t("reports.ops.absentNote2", lang)}{" "}
        <strong>{t("reports.ops.absentStrong2", lang)}</strong>{" "}
        {t("reports.ops.absentNote3", lang)}
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
  const { lang } = useApp();
  // Keyed off the TONE enum, never off the sentence — buildNarrative sets the
  // tone alongside the text, so the dot stays the right colour in Arabic.
  const dot = (tone: NarrativeBullet["tone"]) =>
    tone === "up" ? "bg-emerald-500" :
    tone === "down" ? "bg-rose-500" :
    tone === "warn" ? "bg-amber-500" :
    tone === "flat" ? "bg-slate-400" : "bg-brand-500";

  return (
    <div id="narrative-print" className="card p-6">
      {/* The bullets themselves arrive already translated — buildNarrative
          takes `lang` and composes them from reports.narrative.*. Only the
          furniture around them is keyed here. */}
      <Head title={fill(t("reports.narrative.stmt.title", lang), { p: label })}
        period={t("reports.narrative.stmt.period", lang)} />

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
        {/* These four name the SAME figures the P&L names, so they read the
            same leaves. A second spelling of "Operating profit" is exactly the
            drift the metric namespace exists to stop. */}
        <div>
          <div className="text-[11px] muted uppercase tracking-wide">
            {t("reports.metric.revenue", lang)}
          </div>
          <div className="font-semibold tabular-nums">{formatSar(pnl.revenue_sar)}</div>
        </div>
        <div>
          <div className="text-[11px] muted uppercase tracking-wide">
            {t("reports.metric.operatingCost", lang)}
          </div>
          <div className="font-semibold tabular-nums">{formatSar(pnl.operating_cost_sar)}</div>
        </div>
        <div>
          <div className="text-[11px] muted uppercase tracking-wide">
            {t("reports.metric.operatingProfit", lang)}
          </div>
          <div className={cn("font-semibold tabular-nums",
            pnl.operating_profit_sar < 0 && "text-rose-600 dark:text-rose-400")}>
            {formatSar(pnl.operating_profit_sar)}
          </div>
        </div>
        <div>
          {/* common.margin, not a fourth spelling of it — this labels the same
              ratio the P&L's own margin row labels. */}
          <div className="text-[11px] muted uppercase tracking-wide">
            {t("common.margin", lang)}
          </div>
          <div className="font-semibold tabular-nums">{formatShare(pnl.operating_margin_pct)}</div>
        </div>
      </div>

      <Note>{t("reports.narrative.stmt.note", lang)}</Note>
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
  report, title, onEdit, registerCsv, groupingLabel,
}: {
  report: BuiltReport; title: string; onEdit: () => void;
  registerCsv?: RegisterCsv; groupingLabel: string;
}) {
  const { lang } = useApp();

  // ALREADY CSV-SHAPED. `BuiltReport` is columns plus one values array per row
  // in column order — this is the one statement that needs no reshaping at all,
  // only headings resolved and the unit folded into each of them.
  //
  // The BASIS sub-heading (accrual / cash / operational) is dropped: a CSV has
  // one header row, and a basis spliced into the same cell as the metric name
  // would make the heading unusable as a pivot label. The builder's notes are
  // dropped for the same reason the VAT list is — they are prose, and prose in
  // a numeric column is not a note, it is a broken row.
  const buildCsv = useCallback(() => {
    if (report.columns.length === 0 || report.rows.length === 0) return null;
    return {
      slug: "custom",
      title: t("reports.custom.title", lang),
      period: title,
      columns: [
        // The row-label column has a BLANK heading on screen (`<TH>{" "}</TH>`)
        // because the table sits under a title that already says what the rows
        // are. A file has no such title beside the header row, so the grouping
        // — Period, Customer or Truck — is named here.
        groupingLabel,
        ...report.columns.map((c) => {
          const label = t(c.labelKey, lang);
          return c.unit === "SAR" ? withSar(label, lang)
            : c.unit === "percent" ? withPct(label, lang)
            : label;
        }),
      ],
      // `values` is already in `columns` order and already raw — a null stays
      // null, which writes the empty cell the em dash stands for on screen.
      rows: report.rows.map((r): CsvValue[] => [r.label, ...r.values]),
    };
  }, [lang, title, groupingLabel, report]);

  useCsvSource(registerCsv, buildCsv);

  return (
    <div id="custom-print" className="card p-6">
      {/* `title` arrives already composed by the builder and is passed through
          untouched — it is the PERIOD line, not chrome this component writes. */}
      <Head title={t("reports.custom.title", lang)} period={title} />

      {report.columns.length === 0 ? (
        <Empty>{t("reports.custom.noColumns", lang)}</Empty>
      ) : report.rows.length === 0 ? (
        <Empty>{t("reports.custom.noMatch", lang)}</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <TH>{" "}</TH>
              {report.columns.map((c) => (
                <TH key={c.id} className="text-end">
                  {/* The column carries a KEY, not a label — report-builder
                      resolved the metric to `labelKey` so the heading and the
                      builder's own picker cannot drift apart. The basis reads
                      basisLabel(), the same helper the picker and the metrics
                      dictionary read; it printed the raw enum before this
                      commit, which an Arabic reader would have got as `cash`. */}
                  <span className="block">{t(c.labelKey, lang)}</span>
                  <span className="block text-[10px] font-normal muted normal-case">
                    {basisLabel(c.basis, lang)}
                  </span>
                </TH>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r, i) => (
              // Keyed on POSITION, not on `r.label`: the label is a period
              // name in one grouping and a customer or truck name in another,
              // so it is neither unique (two customers can share a name) nor
              // stable across a language switch. The rows are one ordered list
              // rebuilt wholesale by the builder, so the index IS the identity.
              <tr key={i}>
                <TD>{r.label}</TD>
                {r.values.map((v, i) => (
                  <TD key={report.columns[i].id} className="text-end tabular-nums">
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

      {/* The builder's notes arrive already translated — buildReport takes
          `lang` and composes them from reports.builder.note.*. */}
      {report.notes.map((n, i) => <Note key={i}>{n}</Note>)}
      <Note>{t("reports.custom.note", lang)}</Note>

      <div className="mt-4 no-print">
        <button onClick={onEdit}
          className="text-sm font-medium text-brand-600 dark:text-brand-300 hover:underline">
          {t("reports.custom.changeSelection", lang)}
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

/**
 * Paid vs earned, said in words rather than left to a colour.
 *
 * `lang` arrives as a PROP: this renders once per register row and once inside
 * the document, and both call sites already hold `lang` from their own
 * useApp(). The test stays on the BASIS ENUM and the settled flag — the words
 * below are what the enum is rendered AS, never what it is read from.
 */
function BasisChip({ basis, settled, lang }: { basis: string; settled: boolean; lang: Lang }) {
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
        ? t("reports.payslips.chipPaidTitle", lang)
        : t("reports.payslips.chipEarnedTitle", lang)}
    >
      {paid ? t("reports.payslips.chipPaid", lang) : t("reports.payslips.chipEarned", lang)}
    </span>
  );
}

function monthLabelOf(iso: string) {
  const [y, m] = iso.split("-");
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

export function PayslipsStatement({
  basis, issued, commission, violationsByDriver, violationTypes,
  periodStart, periodEnd, label, today,
  selectedDriverId, onSelectDriver, onIssue, issuingId, registerCsv,
}: {
  basis: PayslipBasisRow[];
  issued: IssuedPayslipRow[];
  /** 0116 — work-month earnings, the review table below the register. */
  commission: DriverCommissionByProjectRow[];
  /**
   * 0175-0177 — LIVE fines per driver, newest first, settlement resolved
   * server-side. Consumed ONLY by the one-driver document, and only for a month
   * that has no payslip: an issued month itemises from its own frozen snapshot,
   * because a fine can be voided or re-priced after issue and the document must
   * keep saying what it said the day it was handed over.
   */
  violationsByDriver: Record<string, DriverViolationView[]>;
  violationTypes: ViolationType[];
  periodStart: string; periodEnd: string; label: string;
  /** Riyadh today, from the server — never new Date() in the client. */
  today: string;
  selectedDriverId: string | null;
  onSelectDriver: (driverId: string | null) => void;
  onIssue: (driverId: string, periodStart: string) => void;
  issuingId: string | null;
  registerCsv?: RegisterCsv;
}) {
  const { lang } = useApp();
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

  // THE REGISTER, AND ONLY WHILE THE REGISTER IS SHOWING. Opening one driver's
  // payslip replaces the body with a DOCUMENT — a numbered, signed artefact with
  // a print button of its own, not a table — so the builder returns null there
  // and the header button disables itself rather than exporting a one-row file
  // that reads like the register the user just left.
  //
  // MUST SIT ABOVE the `if (selected)` return below.
  const buildCsv = useCallback(() => {
    if (selected || rows.length === 0) return null;
    return {
      slug: "payslips",
      title: t("reports.statements.tab.payslips", lang),
      period: label,
      columns: [
        t("common.driver", lang),
        t("reports.th.month", lang),
        withSar(t("reports.th.salary", lang), lang),
        withSar(t("reports.th.commission", lang), lang),
        t("reports.th.basis", lang),
        withSar(t("reports.th.net", lang), lang),
        t("common.status", lang),
      ],
      rows: rows.map((r): CsvValue[] => {
        // AN ISSUED SLIP'S FROZEN FIGURES WIN, exactly as the cells below
        // choose them: a document that exists is what was paid, and a fresh
        // preview of the same month could differ from it.
        const doc = issued.find(
          (i) => i.driver_id === r.driver_id && i.period_start === r.period_start,
        );
        const salary = doc ? doc.base_salary_sar : r.base_salary_sar;
        const comm = doc
          ? doc.commission_sar + doc.specials_sar + doc.adjustments_sar + doc.bonus_sar
          : r.commission_sar + r.specials_sar + r.adjustments_sar + r.bonus_sar;
        const net = doc ? doc.net_sar : r.net_sar;
        // The chip's own condition, not a second rule: `paid` is basis "paid"
        // AND settled, everything else reads as earned.
        const chipBasis = doc ? doc.commission_basis : r.commission_basis;
        const chipSettled = doc ? doc.commission_settled : r.commission_settled;
        const basisText = chipBasis === "paid" && chipSettled
          ? t("reports.payslips.chipPaid", lang)
          : t("reports.payslips.chipEarned", lang);
        // SAME PRIORITY AS THE STATUS CELL, in the same order: an issued number
        // is the strongest fact, then terminated, then a missing hire date,
        // then a month still running. Changing one without the other is how the
        // file and the screen start disagreeing about who was paid.
        const status = doc ? doc.payslip_number
          : r.terminated ? t("reports.payslips.statusTerminated", lang)
          : r.hire_date_missing ? t("reports.payslips.statusNoHireDate", lang)
          : isRunning(r.period_start) ? t("reports.payslips.statusMonthInProgress", lang)
          : t("reports.payslips.statusNotIssued", lang);
        return [
          r.driver_name,
          monthLabelOf(r.period_start),
          salary, comm, basisText, net, status,
        ];
      }),
    };
    // `currentMonthStart` is what `isRunning` closes over, and it is derived
    // from `today` — so `today` is the dep, not the function.
  }, [lang, label, rows, issued, selected, today]);

  useCsvSource(registerCsv, buildCsv);

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
          violations={violationsByDriver[selected.driver_id] ?? []}
          violationTypes={violationTypes}
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
        net: acc.net + (d ? d.net_sar : r.net_sar),
        issued: acc.issued + (d ? 1 : 0),
      };
    },
    { salary: 0, net: 0, issued: 0 },
  );

  return (
    <>
      <div id="payslips-print" className="card p-6">
      {/* The statement's own name is the TAB's name — one statement, one
          spelling. `label` is the period line and arrives already formatted. */}
      <Head title={t("reports.statements.tab.payslips", lang)} period={label} />

      {rows.length === 0 ? (
        <Empty>{t("reports.payslips.empty", lang)}</Empty>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            {/* Both counts go in RAW — they were interpolated directly before
                this commit, and formatNum would add a thousands separator the
                line never had. English spliced only the noun off a `=== 1`
                test; Arabic inflects the whole phrase, so it is stored whole
                per count bucket. */}
            <span className="muted">
              {fill(t(`reports.payslips.count.${plural(rows.length)}`, lang), { n: rows.length })}
            </span>
            <span className="muted" aria-hidden>·</span>
            <span className="muted">
              {fill(t(`reports.payslips.issuedCount.${plural(totals.issued)}`, lang),
                { n: totals.issued })}
            </span>
            <span className="muted" aria-hidden>·</span>
            {/* The space before <b> is JSX on the same line, exactly where it
                was — the dictionary value carries no trailing space. */}
            <span>{t("reports.payslips.totalNet", lang)} <b className="tabular-nums">{formatSar(totals.net)}</b></span>
          </div>

          <Table>
            <thead>
              <tr>
                {/* common.driver and common.status, not two more spellings of
                    words this app already keys; the middle five are the same
                    reports.th.* leaves the cost and revenue tables read. */}
                <TH>{t("common.driver", lang)}</TH>
                <TH>{t("reports.th.month", lang)}</TH>
                <TH className="text-end">{t("reports.th.salary", lang)}</TH>
                <TH className="text-end">{t("reports.th.commission", lang)}</TH>
                <TH>{t("reports.th.basis", lang)}</TH>
                <TH className="text-end">{t("reports.th.net", lang)}</TH>
                <TH>{t("common.status", lang)}</TH>
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
                // An issued slip's frozen net, else the view's net_sar. Both
                // come from the SAME expression since 0118 — the freeze reads
                // this column too, so a preview and its document cannot differ.
                const net = doc ? doc.net_sar : r.net_sar;
                return (
                  <tr
                    key={`${r.driver_id}-${r.period_start}`}
                    onClick={() => onSelectDriver(r.driver_id)}
                    className="cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  >
                    <TD className="font-medium">{r.driver_name}</TD>
                    <TD className="muted">{monthLabelOf(r.period_start)}</TD>
                    <TD className="text-end tabular-nums">{formatSar(salary)}</TD>
                    <TD className="text-end tabular-nums">{formatSar(commission)}</TD>
                    <TD>
                      <BasisChip
                        basis={doc ? doc.commission_basis : r.commission_basis}
                        settled={doc ? doc.commission_settled : r.commission_settled}
                        lang={lang}
                      />
                    </TD>
                    <TD className="text-end tabular-nums font-semibold">{formatSar(net)}</TD>
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
                          // `{d}` is a stored ISO date — Latin in both
                          // languages, like every other date this app writes.
                          // The suffix is joined with a space added HERE, so
                          // neither dictionary value carries edge whitespace.
                          title={r.termination_date
                            ? fill(t("reports.payslips.leftOn", lang), { d: r.termination_date })
                              + (r.hire_date_missing
                                ? " " + t("reports.payslips.leftOnNoHire", lang)
                                : "")
                            : undefined}
                        >
                          {t("reports.payslips.statusTerminated", lang)}
                        </span>
                      ) : r.hire_date_missing ? (
                        <span className="text-[11px] font-bold text-rose-700 dark:text-rose-300">
                          {t("reports.payslips.statusNoHireDate", lang)}
                        </span>
                      ) : isRunning(r.period_start) ? (
                        <span className="text-[11px] font-bold muted">
                          {t("reports.payslips.statusMonthInProgress", lang)}
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold muted">
                          {t("reports.payslips.statusNotIssued", lang)}
                        </span>
                      )}
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </Table>

          <Note>{t("reports.payslips.registerNote", lang)}</Note>
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
 * ONE FINE, AS THE PAYSLIP SHOWS IT — the shape both sources are flattened to.
 *
 * Deliberately NOT DriverViolationView. That type carries `voided_at`,
 * `created_by` and the operator's private `note`, and the frozen snapshot
 * carries none of them; typing this table as the live row would leave three
 * fields that are meaningful in one branch and absent in the other, which is
 * how the two branches start rendering differently. This is the intersection,
 * and it is exactly what a driver reading the sheet needs.
 *
 * THE NOTE IS OMITTED ON PURPOSE. It is on the drivers screen, where it is an
 * internal remark between operators; this document gets handed to the person
 * the remark is about.
 */
type DocFine = {
  key: string;
  label: string;
  ref: string;
  amount: number;
  date: string;
  /** Did the DRIVER settle it with the authority? `null` = the record does not say. */
  paid: boolean | null;
  /** What PAYROLL did with it. A different question; see ViolationSettlement. */
  state: "deducted" | "partial" | "unsettled";
};

/**
 * TWO SOURCES, NEVER BLENDED — the same rule the money figures follow.
 *
 * ISSUED MONTH → the payslip's own frozen snapshot. Not the live table: a fine
 * can be voided, re-priced or re-typed after issue, and a document must keep
 * saying what it said the day it was handed over. Reading live here would let
 * a sheet in someone's hand disagree with the same sheet reopened next week.
 *
 * UNISSUED MONTH → live rows, narrowed with inMonth(), which is the SAME
 * half-open [start, next) window v_driver_payslip_basis sums with. A different
 * window here is the one way this table could itemise a set of fines that is
 * not the set the Deductions line was computed from.
 *
 * The frozen branch's settlement is a MONTH-LEVEL fact and is applied to every
 * item, because absorption has no per-fine share: the payslip clamps the whole
 * month's claim against the pay, so "which of these three was the one that did
 * not fit" has no answer. Saying `partial` on each is the honest reading —
 * the month was partly recovered, and no row is more settled than another.
 */
function buildDocFines(input: {
  doc: IssuedPayslipRow | null;
  live: DriverViolationView[];
  typeById: Map<string, ViolationType>;
  periodStart: string;
  lang: Lang;
}): DocFine[] {
  const { doc, live, typeById, periodStart, lang } = input;

  if (doc) {
    // ORDER LEFT EXACTLY AS FROZEN. issue_driver_payslip aggregates its items
    // `order by dv.violation_date, dv.ref_no` — oldest first — and re-sorting
    // here would make the printed sheet disagree with the record it was printed
    // from. The live branch below is sorted to MATCH this, not the reverse.
    const items = doc.snapshot?.violations?.items ?? [];
    // deductions_sar is what the pay actually absorbed; unabsorbed_sar is what
    // it could not. Zero absorbed is NOT "partly deducted" — nothing was taken,
    // and the month is as unsettled as one that was never issued.
    const state: DocFine["state"] =
      doc.deductions_sar <= 0 ? "unsettled" : doc.unabsorbed_sar > 0 ? "partial" : "deducted";
    return items.map((it) => ({
      key: it.id,
      // BOTH LABELS WERE FROZEN, so a type renamed or retired since issue still
      // prints the name that was on the sheet. arText picks the current
      // reader's language out of the pair the document itself stored.
      label: arText(it.type_label ?? "", it.type_label_ar ?? "", lang) || "—",
      ref: it.ref_no,
      amount: it.amount_sar,
      date: it.violation_date,
      // A string column, so it is tested for the one value that means paid
      // rather than trusted to be a boolean. Absent reads as unknown, not unpaid.
      paid: it.payment_status == null ? null : it.payment_status === "paid",
      state,
    }));
  }

  return live
    .filter((v) => inMonth(v, periodStart))
    // RE-SORTED, and this is the one place in the app that re-sorts these.
    // buildViolationViews hands them over NEWEST-first, which is right for the
    // drivers screen — an operator wants the fine that just arrived at the top.
    // A payslip is not a feed: it is the document this preview literally
    // becomes, and issue_driver_payslip freezes oldest-first. Leaving the two
    // in different orders would mean the sheet visibly reshuffles the moment it
    // is issued, with no figure having changed. Same tiebreak as the RPC so two
    // fines on one day cannot swap between the preview and the document.
    .sort((a, b) =>
      a.violation_date === b.violation_date
        ? a.ref_no.localeCompare(b.ref_no)
        : a.violation_date < b.violation_date ? -1 : 1,
    )
    .map((v) => ({
      key: v.id,
      label: violationTypeLabel(typeById.get(v.violation_type_id), lang),
      ref: v.ref_no,
      amount: v.amount_sar,
      date: v.violation_date,
      paid: v.payment_status === "paid",
      state: v.settlement.state,
    }));
}

/** The two settlement chips. Same ring idiom as BasisChip above it. */
function FineChip({ tone, title, children }: {
  tone: "ok" | "warn" | "neutral";
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset whitespace-nowrap",
        tone === "ok" && "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
        tone === "warn" && "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300",
        tone === "neutral" && "muted ring-[rgb(var(--border))]",
      )}
    >
      {children}
    </span>
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
  row, doc, violations, violationTypes, running, onBack, onIssue, issuing,
}: {
  row: PayslipBasisRow;
  doc: IssuedPayslipRow | null;
  /**
   * This driver's LIVE fines, every month of them, settlement already resolved
   * server-side. Narrowed to the picked month here — and read ONLY when the
   * month has no payslip. See buildDocFines.
   */
  violations: DriverViolationView[];
  /** Every type, active and retired — a historical fine still needs its name. */
  violationTypes: ViolationType[];
  running: boolean;
  onBack: () => void;
  onIssue: (driverId: string, periodStart: string) => void;
  issuing: boolean;
}) {
  const { lang } = useApp();
  // BOTH BRANCHES READ THE SAME FOUR FIGURES. The preview branch used to
  // hardcode `deductions: 0` while reading row.net_sar, which was honest while
  // the view's net_sar was gross and became a lie the moment 0177 made it
  // net-of-deduction: the net shrank by the fine and the Deductions line still
  // said zero, so the slip did not add up on its own face.
  //
  // The preview now reads the view's own columns 19-21. That is the WYSIWYG
  // guarantee end to end — the view computes the deduction, the preview renders
  // what the view computed, and issue_driver_payslip freezes the same row
  // without recomputing. A preview and the document it becomes cannot disagree.
  const f = doc
    ? {
        salary: doc.base_salary_sar, commission: doc.commission_sar,
        specials: doc.specials_sar, adjustments: doc.adjustments_sar,
        bonus: doc.bonus_sar, deductions: doc.deductions_sar, net: doc.net_sar,
        claim: doc.violation_deduction_sar, unabsorbed: doc.unabsorbed_sar,
        basis: doc.commission_basis, settled: doc.commission_settled,
      }
    : {
        salary: row.base_salary_sar, commission: row.commission_sar,
        specials: row.specials_sar, adjustments: row.adjustments_sar,
        bonus: row.bonus_sar, deductions: row.deductions_sar, net: row.net_sar,
        claim: row.violation_deduction_sar, unabsorbed: row.unabsorbed_sar,
        basis: row.commission_basis, settled: row.commission_settled,
      };

  const covered = doc?.snapshot?.covered_trips;
  const payouts = doc?.snapshot?.payouts ?? [];
  const blocked = row.hire_date_missing || running;

  // Built here rather than on the server because it depends on `lang`, which
  // only the browser knows — the fetch cannot pick a label language for a
  // reader who can toggle it.
  const typeById = useMemo(() => {
    const m = new Map<string, ViolationType>();
    for (const vt of violationTypes) m.set(vt.id, vt);
    return m;
  }, [violationTypes]);

  const fines = useMemo(
    () => buildDocFines({ doc, live: violations, typeById, periodStart: row.period_start, lang }),
    [doc, violations, typeById, row.period_start, lang],
  );
  // formatSarExact, not formatSar, for every figure in this table INCLUDING the
  // total. Whole-riyal rounding is right for the earnings breakdown above, where
  // each line is independent; here the rows are supposed to add up to the total
  // underneath them, and three fines rounded down make a column that visibly
  // does not — the one arithmetic error a reader can catch unaided.
  const finesTotal = sumOver(fines, (x) => x.amount);

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
          {/* The ARROW lives inside the dictionary value and flips in Arabic:
              an RTL line reads right to left, so a left-pointing arrow would
              point away from where "back" is. */}
          {t("reports.payslips.allPayslips", lang)}
        </button>
        {doc ? (
          <span className="text-xs muted">
            {/* `{d}` is an ISO date and `{b}` the issuer's name — entity data
                with no `_ar` column, so both stay as stored. */}
            {fill(t("reports.payslips.issuedBy", lang),
              { d: doc.issued_at.slice(0, 10), b: doc.issued_by })}
          </span>
        ) : (
          <button
            type="button"
            disabled={blocked || issuing}
            onClick={() => setConfirming(true)}
            // Both reasons test DATA — the missing hire date and the running
            // month — never the words they produce.
            title={
              row.hire_date_missing
                ? t("reports.payslips.noHireTitle", lang)
                : running
                  ? t("reports.payslips.runningTitle", lang)
                  : undefined
            }
            className="h-9 px-4 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {issuing ? t("reports.payslips.issuing", lang) : t("reports.payslips.issuePayslip", lang)}
          </button>
        )}
      </div>

      <Head
        title={doc
          // The space before <b> is JSX on the same line; the payslip NUMBER
          // beside it is monospace data and is never translated.
          ? <>{t("reports.payslips.payslipWord", lang)} <b className="font-mono font-bold">{doc.payslip_number}</b></>
          : t("reports.payslips.payslipNotIssued", lang)}
        // The driver's name is entity data with no `_ar` column, and
        // monthLabelOf() writes a Latin month abbreviation in both languages —
        // the same call every other date on this page makes.
        period={`${row.driver_name} · ${monthLabelOf(row.period_start)}`}
      />

      {/* WHY THE ACTION IS UNAVAILABLE, said where the button is — a disabled
          control with no reason is indistinguishable from a broken one. */}
      {!doc && blocked && (
        <div className="mb-4 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[12px] leading-relaxed">
          {row.hire_date_missing
            ? t("reports.payslips.blockedNoHire", lang)
            : t("reports.payslips.blockedRunning", lang)}
        </div>
      )}

      {!doc && !blocked && !confirming && (
        <div className="mb-4 rounded-lg border border-brand-500/25 bg-brand-500/5 px-3 py-2 text-[12px] leading-relaxed">
          {/* Split at the one mid-sentence <b>. Both `{" "}` are JSX — the
              values carry no edge whitespace, so neither seam can join two
              words. */}
          {t("reports.payslips.notIssuedBefore", lang)}{" "}
          <b>{t("reports.payslips.notIssuedStrong", lang)}</b>{" "}
          {t("reports.payslips.notIssuedAfter", lang)}
        </div>
      )}

      {!doc && confirming && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 no-print">
          <div className="text-sm font-semibold">{t("reports.payslips.confirmTitle", lang)}</div>
          {/* FOUR FRAGMENTS AROUND THREE BOLD DATA SLOTS — name, month, net —
              in the same order in both languages. `confirmAfterName` is the
              one value in the dictionary that carries edge whitespace, and
              deliberately: English attaches "'s" to the name with no space and
              Arabic needs one, so the difference IS the translation. Every
              other seam here is a JSX `{" "}`. */}
          <p className="mt-1 text-[12px] leading-relaxed">
            {t("reports.payslips.confirmBefore", lang)}{" "}
            <b>{row.driver_name}</b>
            {t("reports.payslips.confirmAfterName", lang)}{" "}
            <b>{monthLabelOf(row.period_start)}</b>{" "}
            {t("reports.payslips.confirmAfterMonth", lang)}{" "}
            <b className="tabular-nums">{formatSar(f.net)}</b>{" "}
            {t("reports.payslips.confirmTail", lang)}
          </p>
          <p className="mt-1.5 text-[12px] leading-relaxed">
            <b>{t("reports.payslips.confirmUndoStrong", lang)}</b>{" "}
            {t("reports.payslips.confirmUndoAfter", lang)}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={issuing}
              onClick={() => { setConfirming(false); onIssue(row.driver_id, row.period_start); }}
              className="h-9 px-4 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white transition disabled:opacity-50"
            >
              {issuing
                ? t("reports.payslips.issuing", lang)
                : t("reports.payslips.yesIssueIt", lang)}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-9 px-4 rounded-lg text-sm font-medium ring-1 ring-inset transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
              style={{ borderColor: "rgb(var(--border))" }}
            >
              {t("common.cancel", lang)}
            </button>
          </div>
        </div>
      )}

      <Table>
        <tbody>
          <tr>
            <TD className="font-medium">{t("reports.payslips.basicSalary", lang)}</TD>
            <TD className="text-end tabular-nums">{formatSar(f.salary)}</TD>
          </tr>
          <tr>
            <TD>
              {/* Commission and Adjustments are the SAME words the cost
                  statement uses for the same money — reports.th.commission and
                  reports.costs.adjustments, not payslip-local copies. */}
              <span className="font-medium">{t("reports.th.commission", lang)}</span>{" "}
              <BasisChip basis={f.basis} settled={f.settled} lang={lang} />
            </TD>
            <TD className="text-end tabular-nums">{formatSar(f.commission)}</TD>
          </tr>
          <tr>
            <TD>{t("reports.payslips.specialPayments", lang)}</TD>
            <TD className="text-end tabular-nums">{formatSar(f.specials)}</TD>
          </tr>
          <tr>
            <TD>{t("reports.costs.adjustments", lang)}</TD>
            <TD className="text-end tabular-nums">{formatSar(f.adjustments)}</TD>
          </tr>
          <tr>
            <TD>{t("reports.payslips.bonus", lang)}</TD>
            <TD className="text-end tabular-nums">{formatSar(f.bonus)}</TD>
          </tr>
          {/* THE ONE ROW THAT SUBTRACTS. Every line above it adds, so it is the
              only place a reader can be misled about direction — it renders with
              an explicit minus and stops being muted the moment it is non-zero,
              because muted grey is how you style a number that does not matter
              and this one just took money off someone's pay.

              The sign and the digits are ONE dir="ltr" span. Split, RTL would
              reorder them and print the minus on the wrong end of the amount —
              the single worst typo available on a payslip. The rest of this
              file's money cells are unsigned, which is why they need no wrapper
              and this one does. */}
          <tr>
            <TD className={f.deductions > 0 ? "" : "muted"}>
              {t("reports.payslips.deductions", lang)}
              {f.deductions > 0 && (
                <span className="muted text-[12px]">
                  {" — "}
                  {t("reports.payslips.deductionsSource", lang)}
                </span>
              )}
            </TD>
            <TD
              className={cn(
                "text-end tabular-nums",
                f.deductions > 0 ? "font-medium" : "muted",
              )}
            >
              {f.deductions > 0 ? (
                <span dir="ltr">{"−"}{formatSar(f.deductions)}</span>
              ) : (
                formatSar(0)
              )}
            </TD>
          </tr>
          <tr className="border-t-2">
            <TD className="font-semibold">{t("reports.payslips.netPay", lang)}</TD>
            <TD className="text-end tabular-nums font-semibold text-base">{formatSar(f.net)}</TD>
          </tr>
        </tbody>
      </Table>

      {/* THE NO-CARRY RULE, SAID OUT LOUD, ONLY WHEN IT APPLIES. Rendered when
          the month's fines exceeded what the pay could absorb — f.unabsorbed is
          the view's own column 21, not a subtraction done here.

          It is deliberately a sentence and not a fourth table row. A row reads
          as another figure in the arithmetic, and this figure is NOT in the
          arithmetic: net already stands, and the remainder is a record of what
          went unrecovered, not a debt this document collects or hands to next
          month. Recovering it is a human decision made outside this app, so the
          line has to say so rather than leave the reader to assume a balance
          follows the driver.

          Amber, matching this file's other two exception callouts (blocked,
          not-yet-issued) rather than minting a third treatment. Not red: the
          payslip is correct and issuable — a fine simply outran the pay. */}
      {f.unabsorbed > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[12px] leading-relaxed">
          {fill(t("reports.payslips.unabsorbedNote", lang), {
            claim: formatSar(f.claim),
            taken: formatSar(f.deductions),
            left: formatSar(f.unabsorbed),
          })}
        </div>
      )}

      {/* THE ANSWER TO "WHICH FINES?".
          ────────────────────────────
          It sits immediately under the Deductions line and its callout because
          that is where the question is raised: a single "Deductions −300" row
          is the figure a driver disputes, and the dispute is not about the
          subtraction, it is about which tickets. Putting the itemisation any
          further down — beside the commission provenance, say — separates a
          challenge from its evidence by a screen of unrelated detail.

          IT RENDERS EVEN WHEN THERE ARE NONE, which is the opposite of what an
          empty table usually deserves. This sheet is handed over and filed. An
          ABSENT section is ambiguous — no fines, or fines not shown? — and on
          a document that takes money off someone's pay that ambiguity is the
          expensive kind. One muted sentence settles it.

          Deliberately NOT no-print. Its whole purpose is to survive onto the
          paper the driver keeps. */}
      <h3 className="text-xs uppercase tracking-wide muted font-medium mt-6 mb-2">
        {t("reports.payslips.violTitle", lang)}
      </h3>

      {fines.length === 0 ? (
        <p className="text-[12px] muted">{t("reports.payslips.violNone", lang)}</p>
      ) : (
        <>
          {/* WHERE THE LIST CAME FROM, said before the list. The two sources
              answer differently on purpose and the reader has no other way to
              tell which one they are looking at. */}
          <p className="text-[11px] muted mb-2 leading-relaxed">
            {t(doc ? "reports.payslips.violFrozen" : "reports.payslips.violLive", lang)}
          </p>

          <Table>
            <thead>
              <tr>
                <TH>{t("common.type", lang)}</TH>
                <TH>{t("reports.payslips.violThRef", lang)}</TH>
                <TH className="text-end">{t("common.amount", lang)}</TH>
                <TH>{t("common.date", lang)}</TH>
                <TH>{t("reports.payslips.violThPayment", lang)}</TH>
                <TH>{t("reports.payslips.violThSettlement", lang)}</TH>
              </tr>
            </thead>
            <tbody>
              {fines.map((x) => (
                <tr key={x.key}>
                  <TD className="whitespace-normal font-medium">{x.label}</TD>
                  {/* A government reference is a Latin token in both languages,
                      and monospace because it gets read digit by digit against
                      a paper notice. Same treatment as the drivers screen. */}
                  <TD><span dir="ltr" className="font-mono text-xs">{x.ref}</span></TD>
                  <TD className="text-end tabular-nums">
                    <span dir="ltr">{formatSarExact(x.amount)}</span>
                  </TD>
                  {/* Stored ISO, printed ISO — the same unambiguous form every
                      other date on this document uses. */}
                  <TD className="muted"><span dir="ltr">{x.date}</span></TD>
                  <TD>
                    {/* TWO DIFFERENT QUESTIONS ABOUT ONE ROW, both answered,
                        because neither implies the other: a driver can have
                        settled the ticket with the authority while payroll has
                        not yet recovered it, and vice versa. Collapsing them
                        into one badge means guessing which the reader meant. */}
                    {x.paid === null ? (
                      <span className="muted">—</span>
                    ) : (
                      <FineChip tone={x.paid ? "ok" : "warn"}>
                        {t(x.paid ? "drivers.viol.paid" : "drivers.viol.notPaid", lang)}
                      </FineChip>
                    )}
                  </TD>
                  <TD>
                    <FineChip
                      tone={x.state === "deducted" ? "ok" : x.state === "partial" ? "warn" : "neutral"}
                    >
                      {t(
                        x.state === "deducted" ? "drivers.viol.stDeducted"
                          : x.state === "partial" ? "drivers.viol.stPartial"
                            : "drivers.viol.stUnsettled",
                        lang,
                      )}
                    </FineChip>
                  </TD>
                </tr>
              ))}
              {/* THE COLUMN HAS TO ADD UP IN FRONT OF THE READER. This total is
                  what was CLAIMED this month, not what was taken — the taken
                  figure is the Deductions line above, and when the two differ
                  the amber callout has already explained why. */}
              <tr className="border-t font-semibold" style={{ borderColor: "rgb(var(--border))" }}>
                <TD>{t("reports.payslips.violTotal", lang)}</TD>
                {/* Every cell rendered, none spanned — the house idiom for a
                    total row here (see the aging table). colSpan is not on TD's
                    props and widening a shared primitive for one row would be a
                    cross-cutting change made for a cosmetic reason. */}
                <TD>{null}</TD>
                <TD className="text-end tabular-nums">
                  <span dir="ltr">{formatSarExact(finesTotal)}</span>
                </TD>
                <TD>{null}</TD>
                <TD>{null}</TD>
                <TD>{null}</TD>
              </tr>
            </tbody>
          </Table>
        </>
      )}

      {/* WHAT THE COMMISSION ACTUALLY IS. A number with no provenance on a
          document someone is paid against is worth less than no number. */}
      {f.basis === "paid" && payouts.length > 0 && (
        <div className="mt-4 text-[12px]">
          {/* `{n}` RAW — it was interpolated directly and formatNum would add
              a separator this line never had. The `one` branch carries NO
              number in English ("Settled by payout", not "…by 1 payout"),
              which is exactly the freedom EN[one] has; fill() simply finds no
              token to replace. */}
          <div className="font-medium mb-1">
            {fill(t(`reports.payslips.settledBy.${plural(payouts.length)}`, lang),
              { n: payouts.length })}
          </div>
          <ul className="space-y-0.5 muted">
            {payouts.map((p) => (
              <li key={p.id} className="tabular-nums">
                {p.paid_at ? p.paid_at.slice(0, 10) : "—"} · {p.period_label ?? "—"} ·{" "}
                {formatSar(p.total_sar)}
              </li>
            ))}
          </ul>
          {/* The two trip dates are stored ISO strings and the dash between
              them is punctuation — both stay as they are in either language.
              `{n}` RAW again; the count and its noun were spliced off one
              `=== 1` test, so the phrase is stored whole per count bucket. The
              earlier-month test compares two DATE PREFIXES, never a rendered
              word. */}
          {covered && covered.count > 0 && covered.first_trip && (
            <p className="mt-1 muted">
              {fill(t(`reports.payslips.covers.${plural(covered.count)}`, lang),
                { n: covered.count })}{" "}
              {covered.first_trip} – {covered.last_trip}.{" "}
              {covered.first_trip.slice(0, 7) !== row.period_start.slice(0, 7) && (
                <b>{t("reports.payslips.earlierMonth", lang)}</b>
              )}
            </p>
          )}
        </div>
      )}

      {/* The branch tests the BASIS ENUM, not the chip's words. No space after
          `</b>` — the "after" value opens with its own full stop. */}
      {f.basis !== "paid" && (
        <Note>
          {t("reports.payslips.earnedNoteBefore", lang)}{" "}
          <b>{t("reports.payslips.earnedNoteStrong", lang)}</b>
          {t("reports.payslips.earnedNoteAfter", lang)}
        </Note>
      )}

      {row.salary_missing && (
        <Note>{t("reports.payslips.noSalaryRecorded", lang)}</Note>
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
  const { lang } = useApp();
  const drivers = useMemo(() => {
    const inPeriod = rows.filter((r) => r.month >= periodStart && r.month <= periodEnd);

    // Group the view's driver x month x project rows into one row per driver
    // for the period. Summing view output across a period is what every
    // statement here already does; no metric is defined by this.
    const byDriver = new Map<string, {
      driverId: string; name: string; trips: number; commission: number;
      // NULL is the direct-customer bucket and it stays NULL all the way to
      // the chip that renders it — naming it here would put a translated
      // string inside a memo keyed on data, so the table would keep the old
      // language until the rows themselves changed. Same call as DriverCol.
      projects: Map<string, { name: string | null; trips: number }>;
    }>();

    for (const r of inPeriod) {
      const e = byDriver.get(r.driver_id) ?? {
        driverId: r.driver_id, name: r.driver_name, trips: 0, commission: 0,
        projects: new Map<string, { name: string | null; trips: number }>(),
      };
      e.trips += r.trips_delivered;
      e.commission += r.commission_sar;
      // A NULL project is a direct-customer trip — real work with real
      // commission, kept by the view rather than dropped. The UI names it, the
      // same way the Operations statement names its unassigned driver row.
      const key = r.project_id ?? "__direct__";
      const p = e.projects.get(key) ?? { name: r.project_name, trips: 0 };
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
          {/* ONE leaf for "work month", read by the print band, the subtitle
              and the footnote — the phrase is the point of the table, and
              three spellings of it is how the point gets blurred. */}
          <PrintBand
            title={t("reports.commissionReview.title", lang)}
            period={`${label} · ${t("reports.commissionReview.workMonth", lang)}`}
          />
          <h2 className="text-lg font-semibold no-print">
            {t("reports.commissionReview.title", lang)}
          </h2>
          <p className="text-sm muted no-print">
            {label} · <b>{t("reports.commissionReview.workMonth", lang)}</b>{" "}
            {t("reports.commissionReview.subtitleAfterMonth", lang)}{" "}
            <b>{t("reports.commissionReview.subtitleStrong", lang)}</b>.
          </p>
        </div>
        <Btn variant="outline" onClick={printReview} className="no-print">
          {/* The space after the icon is JSX on the same line, as before. */}
          <Printer className="h-4 w-4" /> {t("reports.commissionReview.printThisTable", lang)}
        </Btn>
      </div>

      {/* THE DISTINCTION, STATED WHERE THE NUMBERS ARE. The register above uses
          the settlement month; this uses the work month. Same money, two
          questions — and the totals for one driver will legitimately differ. */}
      {/* FIVE EMPHASISED WORDS INSIDE ONE PARAGRAPH, each a whole grammatical
          unit in the same slot in both languages — never a word spliced out of
          a sentence. The two MONTH NAMES are part of the example sentence, not
          data, so they are translated with it. Every seam is a JSX `{" "}`
          except the last, whose value opens with its own comma. */}
      <div className="mt-3 mb-4 rounded-lg border border-brand-500/25 bg-brand-500/5 px-3 py-2 text-[12px] leading-relaxed">
        {t("reports.commissionReview.distinct1", lang)}{" "}
        <b>{t("reports.commissionReview.distinctNot", lang)}</b>{" "}
        {t("reports.commissionReview.distinct2", lang)}{" "}
        <b>{t("reports.commissionReview.distinctSettled", lang)}</b>{" "}
        {t("reports.commissionReview.distinct3", lang)}{" "}
        <b>{t("reports.commissionReview.distinctEarned", lang)}</b>{" "}
        {t("reports.commissionReview.distinct4", lang)}{" "}
        <b>{t("reports.commissionReview.distinctJune", lang)}</b>{" "}
        {t("reports.commissionReview.distinct5", lang)}{" "}
        <b>{t("reports.commissionReview.distinctJuly", lang)}</b>
        {t("reports.commissionReview.distinct6", lang)}
      </div>

      {drivers.length === 0 ? (
        <Empty>{t("reports.commissionReview.noDeliveredTrips", lang)}</Empty>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <TH>{t("common.driver", lang)}</TH>
                <TH className="text-end">{t("reports.th.trips", lang)}</TH>
                <TH>{t("reports.th.projectsServed", lang)}</TH>
                <TH className="text-end">{t("reports.th.commissionEarned", lang)}</TH>
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
                  <TD className="text-end tabular-nums align-top">{formatNum(d.trips)}</TD>
                  <TD className="align-top">
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                      {/* Iterated as ENTRIES so the chip can key on the
                          project id — `p.name` was the React key and it is now
                          nullable, not unique, and language-dependent. The
                          direct-customer bucket is named HERE, at render. */}
                      {[...d.projects.entries()]
                        .sort((a, b) => b[1].trips - a[1].trips)
                        .map(([pid, p]) => (
                          <span key={pid} className="whitespace-nowrap">
                            {p.name ?? t("reports.commissionReview.directCustomer", lang)}{" "}
                            <span className="text-[11px] muted tabular-nums">
                              {formatNum(p.trips)}
                            </span>
                          </span>
                        ))}
                    </div>
                  </TD>
                  <TD className="text-end tabular-nums font-semibold align-top">
                    {formatSar(d.commission)}
                  </TD>
                </tr>
              ))}
              <tr className="border-t-2">
                <TD className="font-semibold">{t("reports.th.total", lang)}</TD>
                <TD className="text-end tabular-nums font-semibold">{formatNum(totals.trips)}</TD>
                <TD>{""}</TD>
                <TD className="text-end tabular-nums font-semibold">
                  {formatSar(totals.commission)}
                </TD>
              </tr>
            </tbody>
          </Table>

          {/* The emphasised name is the SAME leaf the chips above render, so
              the footnote cannot name a bucket the table spells differently.
              The full stop is JSX, as it was. */}
          <Note>
            {t("reports.commissionReview.reviewNote", lang)}{" "}
            <b>{t("reports.commissionReview.directCustomer", lang)}</b>.
          </Note>
        </>
      )}
    </div>
  );
}
