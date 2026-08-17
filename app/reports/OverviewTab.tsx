"use client";

// Reports — Tab 1, Overview.
//
// READS VIEWS ONLY. Every figure below is a column from migration 0098's
// semantic layer. The only arithmetic in this file is period-over-period
// comparison and share-of-total for the cost bars — both operate on numbers
// the views already produced, never on base tables.
//
// Layout reasoning: four north-star KPIs get real size at the top because they
// are the questions Turki actually asks (did we earn, did we keep any of it,
// did the cash arrive, who still owes us). Everything below is supporting
// context at a smaller weight — a page where every number shouts is a page
// with no hierarchy.
//
// Charts are recharts, already a dependency and already what this page used.
// Consumption hand-builds its charts because it needed dual axes and bar/line
// overlays that were fiddly to get right; nothing here needs that, so the
// library earns its place rather than 300 lines of hand-rolled SVG.

import { useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, BarChart,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, Info } from "lucide-react";
import { Card, Section, Table, TH, TD } from "@/components/ui";
import { cn, formatSar, formatNum } from "@/lib/utils";
import {
  monthTick, monthLabel, priorMonth, rowFor, delta, deltaTone, cashCoverage, isCurrentMonth,
  formatPct, formatShare, compactSar, costBuckets, AGING_ORDER,
  type Delta, type PnlRow, type CollectionsRow, type RevenueMonthRow,
  type ReceivableRow, type AgingRow, type PayrollRow, type OperationsRow,
  type RevenuePerTruckRow, type TopupsRow, type PurchasingRow,
  type MaintenancePerTruckRow, type MetricDictionaryRow,
} from "@/lib/reports";

const AXIS = "#94a3b8";      // slate-400 — legible on both themes
const GRID = "#94a3b833";

type Props = {
  months: string[];
  month: string | null;
  pnl: PnlRow[];
  collections: CollectionsRow[];
  revenue: RevenueMonthRow[];
  receivables: ReceivableRow[];
  aging: AgingRow[];
  payroll: PayrollRow[];
  operations: OperationsRow[];
  perTruck: RevenuePerTruckRow[];
  topups: TopupsRow[];
  purchasing: PurchasingRow[];
  maintPerTruck: MaintenancePerTruckRow[];
  /**
   * The metrics DICTIONARY (report_metrics). Not a measure — it is the
   * vocabulary every figure above is defined in, rendered at the bottom of
   * this tab by <MetricsGlossary>.
   */
  metrics: MetricDictionaryRow[];
  onManageExpenses: () => void;
};

export default function OverviewTab({
  months, month, pnl, collections, revenue, receivables, aging,
  payroll, operations, perTruck, topups, purchasing, maintPerTruck,
  metrics, onManageExpenses,
}: Props) {
  const prev = month ? priorMonth(months, month) : null;

  const p = rowFor(pnl, month);
  const pPrev = rowFor(pnl, prev);
  const col = rowFor(collections, month);
  const colPrev = rowFor(collections, prev);
  const rev = rowFor(revenue, month);
  const pay = rowFor(payroll, month);
  const ops = rowFor(operations, month);
  const opsPrev = rowFor(operations, prev);
  const top = rowFor(topups, month);
  const pur = rowFor(purchasing, month);

  // Receivables are a STATE view — as of now, not as of the picked month. The
  // card says so rather than letting the period picker imply otherwise.
  const outstanding = useMemo(
    () => receivables.reduce((n, r) => n + r.outstanding_sar, 0),
    [receivables],
  );

  const trucksThisMonth = useMemo(
    () => perTruck.filter((r) => r.month === month).sort((a, b) => b.allocated_revenue_sar - a.allocated_revenue_sar),
    [perTruck, month],
  );

  const maintThisMonth = useMemo(
    () => maintPerTruck
      .filter((r) => r.month === month)
      .sort((a, b) => b.total_maintenance_sar - a.total_maintenance_sar),
    [maintPerTruck, month],
  );

  // Totals across the shown trucks, used only to say out loud which half of
  // the cost is which. Sums of view-produced figures, not a re-derivation.
  const maintSplit = useMemo(
    () => maintThisMonth.reduce(
      (acc, r) => ({
        parts: acc.parts + r.maintenance_parts_sar,
        os: acc.os + r.os_payments_sar,
      }),
      { parts: 0, os: 0 },
    ),
    [maintThisMonth],
  );

  const trend = useMemo(
    () => pnl.map((r) => ({
      month: r.month,
      label: monthTick(r.month),
      revenue: r.revenue_sar,
      cost: r.operating_cost_sar,
      margin: r.operating_margin_pct,
    })),
    [pnl],
  );

  const cashTrend = useMemo(
    () => pnl.map((r) => ({
      label: monthTick(r.month),
      revenue: r.revenue_sar,
      collected: collections.find((c) => c.month === r.month)?.collected_gross_sar ?? 0,
    })),
    [pnl, collections],
  );

  const agingRows = useMemo(
    () => AGING_ORDER.map((b) => {
      const row = aging.find((a) => a.aging_bucket === b);
      return { bucket: b, value: row?.outstanding_sar ?? 0, count: row?.invoice_count ?? 0 };
    }),
    [aging],
  );

  if (!month || !p) {
    return (
      <div className="card p-8 text-center">
        <div className="text-sm font-medium">No periods to report on yet</div>
        <p className="text-sm muted mt-1">
          The month spine builds itself from real activity. Once there is a confirmed
          invoice, a trip or a parts consumption, this page fills in.
        </p>
      </div>
    );
  }

  const buckets = costBuckets(p);
  const bucketMax = Math.max(...buckets.map((b) => b.value), 1);
  const coverage = cashCoverage(col?.collected_gross_sar ?? 0, p.revenue_sar);

  return (
    <div className="space-y-5">
      {/* A partial month is not a bad month. Costs accrue daily while revenue
          lands at invoice confirmation, so the current period almost always
          shows cost without the revenue that will eventually offset it. */}
      {isCurrentMonth(month) && (
        <div className="rounded-lg px-3 py-2.5 text-sm flex gap-2 bg-brand-500/10 text-brand-700 dark:text-brand-300">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            <strong>{monthLabel(month)} is still in progress.</strong> Costs accrue day
            by day, but revenue is only recognised when an invoice is confirmed — usually
            at the end of the period. Expect this month to look cost-heavy until then.
            {prev && <> For a complete picture, switch the period to {monthLabel(prev)}.</>}
          </p>
        </div>
      )}

      {/* ---- North-star KPIs ------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <BigStat
          label="Revenue"
          value={formatSar(p.revenue_sar)}
          d={delta(p.revenue_sar, pPrev?.revenue_sar)}
          higherIsBetter
          prev={prev}
          foot={rev ? `${rev.invoice_count} invoice${rev.invoice_count === 1 ? "" : "s"} · ${rev.customer_count} customer${rev.customer_count === 1 ? "" : "s"}` : undefined}
          note="Confirmed invoices, net of VAT"
        />
        <BigStat
          label="Operating profit"
          value={formatSar(p.operating_profit_sar)}
          d={delta(p.operating_profit_sar, pPrev?.operating_profit_sar)}
          higherIsBetter
          prev={prev}
          tone={p.operating_profit_sar >= 0 ? "ok" : "bad"}
          foot={`Margin ${formatShare(p.operating_margin_pct)}`}
          note="Before other expenses"
        />
        <BigStat
          label="Collections"
          value={formatSar(col?.collected_gross_sar ?? 0)}
          d={delta(col?.collected_gross_sar ?? 0, colPrev?.collected_gross_sar)}
          higherIsBetter
          prev={prev}
          foot={coverage !== null ? `${formatShare(coverage)} of revenue` : undefined}
          note="Cash received, VAT included"
        />
        <BigStat
          label="Outstanding receivables"
          value={formatSar(outstanding)}
          higherIsBetter={false}
          foot={`${receivables.length} unpaid invoice${receivables.length === 1 ? "" : "s"}`}
          note="As of today, not the picked period"
        />
      </div>

      {/* ---- Supporting band ------------------------------------------- */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <MiniStat label="Operating cost" value={formatSar(p.operating_cost_sar)}
          d={delta(p.operating_cost_sar, pPrev?.operating_cost_sar)} higherIsBetter={false} />
        {/* The one clickable stat: click the number, edit what is behind it.
            Until tab 2 ships this is also the only way in, which is why it is
            a real affordance rather than a hidden menu item. */}
        <MiniStat label="Other expenses" value={formatSar(p.expenses_sar)}
          sub={p.expenses_sar === 0 ? "none recorded — add" : "manage"}
          onClick={onManageExpenses} />
        <MiniStat label="Net profit" value={formatSar(p.net_profit_sar)}
          d={delta(p.net_profit_sar, pPrev?.net_profit_sar)} higherIsBetter />
        <MiniStat label="Trips delivered" value={formatNum(ops?.trips_delivered ?? 0)}
          d={delta(ops?.trips_delivered ?? 0, opsPrev?.trips_delivered)} higherIsBetter
          sub={ops ? `of ${formatNum(ops.trips_total)} total` : undefined} />
        <MiniStat label="Trucks active" value={formatNum(ops?.trucks_active ?? 0)}
          sub={ops ? `${ops.work_orders} work order${ops.work_orders === 1 ? "" : "s"}` : undefined} />
        <MiniStat label="Stock purchased" value={formatSar(pur?.received_stock_value_sar ?? 0)}
          sub="not a P&L cost" />
      </div>

      {/* ---- Revenue vs cost ------------------------------------------- */}
      <Section title="Revenue, cost and margin">
        <div className="h-[320px] -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={trend} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" stroke={AXIS} fontSize={12} tickLine={false} axisLine={{ stroke: GRID }} />
              <YAxis yAxisId="sar" stroke={AXIS} fontSize={12} tickLine={false} axisLine={false}
                tickFormatter={(v) => compactSar(v as number)} />
              <YAxis yAxisId="pct" orientation="right" stroke={AXIS} fontSize={12} tickLine={false}
                axisLine={false} tickFormatter={(v) => `${Math.round(v as number)}%`} />
              <Tooltip
                contentStyle={{ background: "rgb(var(--card))", border: "1px solid rgb(var(--border))", borderRadius: 10, fontSize: 12 }}
                formatter={(v, name) => name === "Margin"
                  ? [formatShare(v as number), name]
                  : [formatSar(v as number), name]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="sar" dataKey="revenue" name="Revenue" fill="#0b7eea" radius={[4, 4, 0, 0]} maxBarSize={38} />
              <Bar yAxisId="sar" dataKey="cost" name="Operating cost" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={38} />
              {/* connectNulls stays FALSE: a month with no revenue has a null
                  margin by design (0098), and bridging it would draw a
                  confident line through a number that does not exist. */}
              <Line yAxisId="pct" type="monotone" dataKey="margin" name="Margin" stroke="#10b981"
                strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>

      {/* ---- Cost structure + cash ------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title={`Where the money went · ${monthLabel(month)}`}>
          <div className="space-y-3">
            {buckets.map((b) => {
              const share = p.operating_cost_sar > 0 ? (b.value / p.operating_cost_sar) * 100 : null;
              return (
                <div key={b.key}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{b.label}</span>
                    <span className="tabular-nums">
                      {formatSar(b.value)}
                      <span className="muted text-xs ml-2">{formatShare(share)}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full overflow-hidden" style={{ background: "rgb(var(--border))" }}>
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${(b.value / bucketMax) * 100}%`, background: b.color }} />
                  </div>
                </div>
              );
            })}

            <div className="pt-3 mt-1 border-t flex items-baseline justify-between text-sm"
              style={{ borderColor: "rgb(var(--border))" }}>
              <span className="font-semibold">Operating cost</span>
              <span className="font-semibold tabular-nums">{formatSar(p.operating_cost_sar)}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="muted">Other expenses (separate)</span>
              <span className="tabular-nums muted">{formatSar(p.expenses_sar)}</span>
            </div>

            {/* Payroll has no salary history — the layer exposes this precisely
                so the UI can say it out loud rather than implying precision it
                does not have. */}
            {pay && (
              <Disclosure>
                Payroll uses each person&apos;s <strong>current</strong> salary applied to
                whoever was employed that month — salaries are not effective-dated, so a
                raise changes past periods too.
                {pay.people_missing_salary > 0 && (
                  <> {pay.people_missing_salary} employed {pay.people_missing_salary === 1 ? "person has" : "people have"} no
                  salary recorded and {pay.people_missing_salary === 1 ? "counts" : "count"} as zero.</>
                )}
              </Disclosure>
            )}
          </div>
        </Section>

        <Section title="Earned vs collected">
          <div className="h-[240px] -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={cashTrend} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" stroke={AXIS} fontSize={12} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis stroke={AXIS} fontSize={12} tickLine={false} axisLine={false}
                  tickFormatter={(v) => compactSar(v as number)} />
                <Tooltip
                  contentStyle={{ background: "rgb(var(--card))", border: "1px solid rgb(var(--border))", borderRadius: 10, fontSize: 12 }}
                  formatter={(v, name) => [formatSar(v as number), name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="revenue" name="Revenue earned" fill="#0b7eea" radius={[4, 4, 0, 0]} maxBarSize={30} />
                <Line type="monotone" dataKey="collected" name="Cash collected" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <Disclosure>
            These are different bases on purpose. Revenue is earned when an invoice is
            confirmed and excludes VAT; collections are cash banked when it is paid and
            include VAT. They are never added together.
            {top && top.topups_sar > 0 && (
              <> Prepaid top-ups of {formatSar(top.topups_sar)} this month are cash in but
              are neither revenue nor an invoice payment, so they appear in neither line.</>
            )}
          </Disclosure>
        </Section>
      </div>

      {/* ---- Per-truck: what each truck earned, and what it cost -------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title={`Revenue by truck · ${monthLabel(month)}`}>
          {trucksThisMonth.length === 0 ? (
            <EmptyNote>No invoiced trips reached a truck this period.</EmptyNote>
          ) : (
            <Table>
              <thead>
                <tr>
                  <TH>Truck</TH>
                  <TH className="text-right">Trips</TH>
                  <TH className="text-right">Revenue</TH>
                </tr>
              </thead>
              <tbody>
                {trucksThisMonth.slice(0, 8).map((t) => (
                  <tr key={t.truck_id}>
                    <TD>{t.plate}</TD>
                    <TD className="text-right tabular-nums">{formatNum(t.trips)}</TD>
                    <TD className="text-right tabular-nums">{formatSar(t.allocated_revenue_sar)}</TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Disclosure>
            An allocation, not a measurement: a trip carries no rate of its own in this
            schema, so each invoice&apos;s revenue is split equally across its trips and
            follows them to their trucks.
          </Disclosure>
        </Section>

        {/* Three named measures (0099), never collapsed into one unlabelled
            number — "maintenance cost per truck" previously meant two
            different things on two different pages. Parts and outsourced are
            both shown because outsourced is the LARGER half. */}
        <Section title={`Maintenance cost by truck · ${monthLabel(month)}`}>
          {maintThisMonth.length === 0 ? (
            <EmptyNote>No maintenance spend reached a truck this period.</EmptyNote>
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
                {maintThisMonth.slice(0, 8).map((t) => (
                  <tr key={t.truck_id}>
                    <TD>{t.plate}</TD>
                    <TD className="text-right tabular-nums muted">
                      {t.maintenance_parts_sar === 0 ? "—" : formatSar(t.maintenance_parts_sar)}
                    </TD>
                    <TD className="text-right tabular-nums muted">
                      {t.os_payments_sar === 0 ? "—" : formatSar(t.os_payments_sar)}
                    </TD>
                    <TD className="text-right tabular-nums font-medium">
                      {formatSar(t.total_maintenance_sar)}
                    </TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Disclosure>
            Parts are the FIFO cost of what each truck&apos;s work orders consumed;
            outsourced is what outside workshops were paid for that truck. Labour on
            in-house work orders is not costed anywhere in this schema, so it is in
            neither column.
            {maintSplit.os > 0 && maintSplit.parts > 0 && (
              <> This period outsourced spend is {formatSar(maintSplit.os)} against{" "}
              {formatSar(maintSplit.parts)} of parts — a parts-only view would show
              roughly {formatShare((maintSplit.parts / (maintSplit.parts + maintSplit.os)) * 100)} of
              the real cost.</>
            )}
          </Disclosure>
        </Section>
      </div>

      {/* ---- Receivables ----------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Receivables aging">
          {outstanding === 0 ? (
            <EmptyNote>Nothing outstanding — every confirmed invoice is paid.</EmptyNote>
          ) : (
            <>
              <div className="h-[200px] -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agingRows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="bucket" stroke={AXIS} fontSize={12} tickLine={false} axisLine={{ stroke: GRID }} />
                    <YAxis stroke={AXIS} fontSize={12} tickLine={false} axisLine={false}
                      tickFormatter={(v) => compactSar(v as number)} />
                    <Tooltip
                      cursor={{ fill: "#94a3b81a" }}
                      contentStyle={{ background: "rgb(var(--card))", border: "1px solid rgb(var(--border))", borderRadius: 10, fontSize: 12 }}
                      formatter={(v) => [formatSar(v as number), "Outstanding"]}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56} fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 text-xs muted">
                Aged from the date each invoice was confirmed — this schema has no
                payment-terms column to age from a due date.
              </div>
            </>
          )}
        </Section>

        {receivables.length > 0 && (
        <Section title="Oldest unpaid invoices">
          <Table>
            <thead>
              <tr>
                <TH>Invoice</TH>
                <TH>Customer</TH>
                <TH className="text-right">Days</TH>
                <TH className="text-right">Outstanding</TH>
              </tr>
            </thead>
            <tbody>
              {receivables.slice(0, 6).map((r) => (
                <tr key={r.invoice_id}>
                  <TD>{r.invoice_number ?? "—"}</TD>
                  <TD>{r.customer_name}</TD>
                  <TD className="text-right tabular-nums">
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
        </Section>
        )}
      </div>

      {/* ---- Metrics dictionary ---------------------------------------- */}
      <MetricsGlossary metrics={metrics} />
    </div>
  );
}

// --- Pieces ----------------------------------------------------------------

function BigStat({
  label, value, d, higherIsBetter = true, prev, foot, note, tone,
}: {
  label: string; value: string; d?: Delta; higherIsBetter?: boolean;
  prev?: string | null; foot?: string; note?: string; tone?: "ok" | "bad";
}) {
  const t = d ? deltaTone(d, higherIsBetter) : undefined;
  return (
    <Card className="p-4">
      <div className="text-xs muted uppercase tracking-wide">{label}</div>
      <div className={cn(
        "text-3xl font-semibold mt-1.5 tabular-nums",
        tone === "ok" ? "text-emerald-600 dark:text-emerald-400" :
        tone === "bad" ? "text-rose-600 dark:text-rose-400" : "",
      )}>
        {value}
      </div>
      {d && prev && <DeltaLine d={d} tone={t} prev={prev} />}
      {foot && <div className="text-xs muted mt-1.5">{foot}</div>}
      {note && <div className="text-[11px] muted mt-0.5 italic">{note}</div>}
    </Card>
  );
}

function MiniStat({
  label, value, d, higherIsBetter = true, sub, onClick,
}: {
  label: string; value: string; d?: Delta; higherIsBetter?: boolean;
  sub?: string; onClick?: () => void;
}) {
  const t = d ? deltaTone(d, higherIsBetter) : undefined;
  const body = (
    <Card className={cn("p-3", onClick && "cursor-pointer hover:ring-1 hover:ring-brand-500/40 transition")}>
      <div className="text-[11px] muted uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold mt-1 tabular-nums">{value}</div>
      {d && (
        <div className={cn(
          "text-[11px] mt-0.5 tabular-nums",
          t === "ok" ? "text-emerald-600 dark:text-emerald-400" :
          t === "bad" ? "text-rose-600 dark:text-rose-400" : "muted",
        )}>
          {d.pct === null ? (d.abs === 0 ? "no change" : `${d.abs > 0 ? "+" : ""}${formatSar(d.abs)}`) : formatPct(d.pct)}
        </div>
      )}
      {sub && <div className="text-[11px] muted mt-0.5">{sub}</div>}
    </Card>
  );

  // A real <button> when it acts like one — keyboard focus and Enter come free,
  // which a click handler on a div would silently not provide.
  return onClick ? (
    <button type="button" onClick={onClick} className="text-left w-full">{body}</button>
  ) : body;
}

/**
 * The comparison line. When the prior period is 0 there is no percentage to
 * show — it says so and falls back to the absolute move, rather than printing
 * a meaningless "+100%".
 */
function DeltaLine({ d, tone, prev }: { d: Delta; tone?: "ok" | "bad"; prev: string }) {
  const Icon = d.dir === "up" ? TrendingUp : d.dir === "down" ? TrendingDown : Minus;
  return (
    <div className={cn(
      "flex items-center gap-1.5 text-xs mt-1.5 tabular-nums",
      tone === "ok" ? "text-emerald-600 dark:text-emerald-400" :
      tone === "bad" ? "text-rose-600 dark:text-rose-400" : "muted",
    )}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{d.pct === null ? `${d.abs >= 0 ? "+" : ""}${formatSar(d.abs)}` : formatPct(d.pct)}</span>
      <span className="muted font-normal">vs {monthLabel(prev)}</span>
    </div>
  );
}

/** A caveat the semantic layer exposed on purpose — shown, not buried. */
function Disclosure({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex gap-2 text-[11px] muted leading-relaxed">
      <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
      <p>{children}</p>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-sm muted">{children}</div>;
}

// --- Metrics dictionary -----------------------------------------------------
//
// THE SEMANTIC LAYER, READ RATHER THAN COUNTED. Every figure on this page comes
// from a view whose meaning is defined once, in SQL (report_metrics, migration
// 0098, extended by 0123/0124). This section renders that table — it computes
// nothing, and it is the only place on the page where the DESCRIPTION columns
// (meaning / formula / grain / source_view / basis / caveat) are shown at all.
// They were fetched and threaded here for a year and rendered nowhere, which is
// the exact failure mode CLAUDE.md §7 records for DailyOps.revenue: a column
// nothing displays is a column nobody can check.
//
// LAYOUT IS STACKED, NOT A GRID TABLE, and that is a measurement not a taste:
// live max lengths are caveat 785 chars, formula 208, source_view 169, meaning
// 113. Six columns of that in one row would either overflow or shrink every
// cell to a sliver. Each metric is its own block; the label/value pairs use
// `minmax(0,1fr)` on the value track — a plain `1fr` refuses to shrink below
// its content, which is what lets a long unbroken pointer like
// "v_payroll_monthly (…) · v_pnl_by_period.payroll_sar (…)" push past its
// container instead of wrapping.
//
// A NULL caveat renders NOTHING — no dash, no "N/A". 3 of the 30 rows have no
// caveat (operating_profit, operations, os_cost); those metrics carry no
// warning, which is a different claim from a warning we failed to load. Same
// rule as the compliance pills: absent never renders as a value.

/** Reading order — money first, then position, then activity. */
const BASIS_ORDER = ["accrual", "cash", "state", "operational"];

/**
 * What a basis MEANS, beside the group it labels. This is the distinction the
 * report builder is built to protect (migration 0100): accrual and cash measure
 * the same riyal at two different moments, so adding them double-counts. Saying
 * so once here beats hoping the reader knows.
 */
const BASIS_NOTE: Record<string, string> = {
  accrual: "Earned or incurred in the period — whether or not the money has moved yet.",
  cash: "Money that actually moved in the period. Never added to an accrual figure: a commission payout's base IS the trip commission the accrual side already counted.",
  state: "A position as of now, not a total for a period. A state figure does not belong in a period column.",
  operational: "Counts and activity rather than money.",
};

function MetricsGlossary({ metrics }: { metrics: MetricDictionaryRow[] }) {
  const [q, setQ] = useState("");

  // Grouped by basis. An unrecognised basis still renders — it sorts after the
  // four known ones rather than being dropped, so a metric added by a future
  // migration appears here without this file being touched.
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matched = needle
      ? metrics.filter((m) =>
          `${m.label} ${m.metric_key} ${m.meaning} ${m.source_view}`.toLowerCase().includes(needle))
      : metrics;

    const by = new Map<string, MetricDictionaryRow[]>();
    for (const m of matched) {
      const arr = by.get(m.basis) ?? [];
      arr.push(m);
      by.set(m.basis, arr);
    }
    const rank = (b: string) => {
      const i = BASIS_ORDER.indexOf(b);
      return i === -1 ? BASIS_ORDER.length : i;
    };
    return Array.from(by.entries())
      .map(([basis, rows]) => ({
        basis,
        rows: rows.slice().sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => rank(a.basis) - rank(b.basis) || a.basis.localeCompare(b.basis));
  }, [metrics, q]);

  const shown = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <Section
      title="Metrics dictionary"
      action={
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter metrics"
          aria-label="Filter metrics"
          className="w-40 sm:w-56 rounded-lg border bg-transparent px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-brand-500/40"
          style={{ borderColor: "rgb(var(--border))" }}
        />
      }
    >
      <p className="text-xs muted leading-relaxed">
        Every number on this page is defined once, in SQL — this is that
        definition, read straight from <code className="font-mono">report_metrics</code>.
        It is also the vocabulary the custom-report builder is fenced to: a
        metric it cannot offer is a metric that is not listed here.{" "}
        <span className="tabular-nums">
          {q.trim()
            ? `${formatNum(shown)} of ${formatNum(metrics.length)} shown.`
            : `${formatNum(metrics.length)} metrics.`}
        </span>
      </p>

      {metrics.length === 0 ? (
        <EmptyNote>The dictionary could not be read.</EmptyNote>
      ) : shown === 0 ? (
        <EmptyNote>No metric matches “{q.trim()}”.</EmptyNote>
      ) : (
        <div className="mt-4 space-y-6">
          {groups.map((g) => (
            <div key={g.basis}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide">{g.basis}</h4>
                <span className="text-[11px] muted tabular-nums">
                  {formatNum(g.rows.length)}
                </span>
              </div>
              {BASIS_NOTE[g.basis] && (
                <p className="mt-0.5 text-[11px] muted leading-relaxed">{BASIS_NOTE[g.basis]}</p>
              )}
              <div className="mt-2">
                {g.rows.map((m) => (
                  <MetricEntry key={m.metric_key} m={m} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function MetricEntry({ m }: { m: MetricDictionaryRow }) {
  return (
    <div className="py-3 border-t" style={{ borderColor: "rgb(var(--border))" }}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm font-medium">{m.label}</span>
        <code className="font-mono text-[11px] muted break-all">{m.metric_key}</code>
        <span className="ml-auto text-[11px] muted uppercase tracking-wide shrink-0">{m.unit}</span>
      </div>

      <p className="mt-1 text-sm leading-relaxed">{m.meaning}</p>

      {/* `minmax(0,1fr)` on the value track — see the note above; a bare `1fr`
          is what lets a long source_view pointer overflow instead of wrap. */}
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-[6.5rem_minmax(0,1fr)]">
        <dt className="muted uppercase tracking-wide">Formula</dt>
        <dd className="min-w-0 break-words font-mono">{m.formula}</dd>

        <dt className="muted uppercase tracking-wide">Grain</dt>
        <dd className="min-w-0 break-words">{m.grain}</dd>

        <dt className="muted uppercase tracking-wide">Source view</dt>
        <dd className="min-w-0 break-words font-mono">{m.source_view}</dd>
      </dl>

      {/* No caveat means no warning — never a dash, never "N/A". */}
      {m.caveat && <Disclosure>{m.caveat}</Disclosure>}
    </div>
  );
}
