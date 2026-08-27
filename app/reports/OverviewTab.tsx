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

import { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, BarChart,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, Info } from "lucide-react";
import { Card, Section, Table, TH, TD } from "@/components/ui";
import { cn, formatSar, formatNum } from "@/lib/utils";
import { useApp } from "@/components/AppShell";
import { t, fill, plural, type Lang, type TKey } from "@/lib/i18n";
import {
  monthTick, monthLabel, priorMonth, rowFor, delta, deltaTone, cashCoverage, isCurrentMonth,
  formatPct, formatShare, compactSar, costBuckets, AGING_ORDER,
  type Delta, type PnlRow, type CollectionsRow, type RevenueMonthRow,
  type ReceivableRow, type AgingRow, type PayrollRow, type OperationsRow,
  type RevenuePerTruckRow, type TopupsRow, type PurchasingRow,
  type MaintenancePerTruckRow,
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
  onManageExpenses: () => void;
};

export default function OverviewTab({
  months, month, pnl, collections, revenue, receivables, aging,
  payroll, operations, perTruck, topups, purchasing, maintPerTruck,
  onManageExpenses,
}: Props) {
  const { lang } = useApp();
  // One translator shorthand for the whole tab. `say` fills the `{token}`
  // holes; `tt` is the bare lookup, kept separate so a key with no tokens does
  // not pay for a regex pass it has nothing to substitute.
  const tt = (key: TKey) => t(key, lang);
  const say = (key: TKey, vals: Record<string, string | number>) => fill(t(key, lang), vals);

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
        <div className="text-sm font-medium">{tt("reports.overview.empty.title")}</div>
        <p className="text-sm muted mt-1">{tt("reports.overview.empty.body")}</p>
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
            <strong>{say("reports.overview.inProgress.strong", { p: monthLabel(month) })}</strong>{" "}
            {tt("reports.overview.inProgress.body")}
            {prev && <>{" "}{say("reports.overview.inProgress.switch", { p: monthLabel(prev) })}</>}
          </p>
        </div>
      )}

      {/* ---- North-star KPIs ------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <BigStat
          label={tt("reports.metric.revenue")}
          value={formatSar(p.revenue_sar)}
          d={delta(p.revenue_sar, pPrev?.revenue_sar)}
          higherIsBetter
          prev={prev}
          lang={lang}
          // TWO counted nouns, TWO independent count buckets — the separator is
          // a bullet, not grammar, so neither half governs the other. Both
          // counts go in RAW, as they did before: these card feet never ran
          // through formatNum, and adding a thousands separator here would be a
          // number change smuggled in under a translation.
          foot={rev
            ? `${say(`reports.overview.invoiceCount.${plural(rev.invoice_count)}`, { n: rev.invoice_count })} · ${say(`reports.overview.customerCount.${plural(rev.customer_count)}`, { n: rev.customer_count })}`
            : undefined}
          note={tt("reports.overview.note.revenue")}
        />
        <BigStat
          label={tt("reports.metric.operatingProfit")}
          value={formatSar(p.operating_profit_sar)}
          d={delta(p.operating_profit_sar, pPrev?.operating_profit_sar)}
          higherIsBetter
          prev={prev}
          lang={lang}
          tone={p.operating_profit_sar >= 0 ? "ok" : "bad"}
          foot={say("reports.overview.marginFoot", { v: formatShare(p.operating_margin_pct) })}
          note={tt("reports.overview.note.operatingProfit")}
        />
        <BigStat
          label={tt("reports.metric.collections")}
          value={formatSar(col?.collected_gross_sar ?? 0)}
          d={delta(col?.collected_gross_sar ?? 0, colPrev?.collected_gross_sar)}
          higherIsBetter
          prev={prev}
          lang={lang}
          foot={coverage !== null
            ? say("reports.overview.ofRevenue", { v: formatShare(coverage) })
            : undefined}
          note={tt("reports.overview.note.collections")}
        />
        <BigStat
          label={tt("reports.overview.outstandingReceivables")}
          value={formatSar(outstanding)}
          higherIsBetter={false}
          lang={lang}
          foot={say(`reports.overview.unpaidInvoices.${plural(receivables.length)}`,
            { n: receivables.length })}
          note={tt("reports.overview.note.receivables")}
        />
      </div>

      {/* ---- Supporting band ------------------------------------------- */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <MiniStat label={tt("reports.metric.operatingCost")} value={formatSar(p.operating_cost_sar)}
          d={delta(p.operating_cost_sar, pPrev?.operating_cost_sar)} higherIsBetter={false} lang={lang} />
        {/* The one clickable stat: click the number, edit what is behind it.
            Until tab 2 ships this is also the only way in, which is why it is
            a real affordance rather than a hidden menu item. */}
        <MiniStat label={tt("reports.metric.otherExpenses")} value={formatSar(p.expenses_sar)}
          lang={lang}
          sub={p.expenses_sar === 0
            ? tt("reports.overview.expensesNone")
            : tt("reports.overview.expensesManage")}
          onClick={onManageExpenses} />
        <MiniStat label={tt("reports.metric.netProfit")} value={formatSar(p.net_profit_sar)}
          d={delta(p.net_profit_sar, pPrev?.net_profit_sar)} higherIsBetter lang={lang} />
        <MiniStat label={tt("reports.metric.tripsDelivered")} value={formatNum(ops?.trips_delivered ?? 0)}
          d={delta(ops?.trips_delivered ?? 0, opsPrev?.trips_delivered)} higherIsBetter lang={lang}
          sub={ops ? say("reports.overview.ofTotal", { n: formatNum(ops.trips_total) }) : undefined} />
        <MiniStat label={tt("reports.overview.trucksActive")} value={formatNum(ops?.trucks_active ?? 0)}
          lang={lang}
          // The count was spliced — `${n} work order${n === 1 ? "" : "s"}` — which
          // is exactly the fragment splicing Arabic cannot survive. Whole
          // sentence per count bucket now.
          //
          // `n` goes in RAW, not through formatNum: this one count was the only
          // figure on the tab printed without a separator, and routing it
          // through the formatter would change 1,234 English bytes that have
          // nothing to do with translation.
          sub={ops
            ? say(`reports.overview.workOrders.${plural(ops.work_orders)}`,
                { n: ops.work_orders })
            : undefined} />
        <MiniStat label={tt("reports.overview.stockPurchased")} value={formatSar(pur?.received_stock_value_sar ?? 0)}
          lang={lang}
          sub={tt("reports.overview.notPnlCost")} />
      </div>

      {/* ---- Revenue vs cost ------------------------------------------- */}
      <Section title={tt("reports.overview.section.revCostMargin")}>
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
                // TRAP, FIXED IN THIS COMMIT. This read `name === "Margin"` —
                // it picked the FORMATTER by comparing against a display
                // string, so the moment that name became translatable every
                // Arabic margin would have rendered through the SAR formatter
                // as "12 ر.س" instead of "12%". `dataKey` is the series' own
                // identity and no language touches it.
                formatter={(v, name, item) => item?.dataKey === "margin"
                  ? [formatShare(v as number), name]
                  : [formatSar(v as number), name]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="sar" dataKey="revenue" name={tt("common.revenue")} fill="#0b7eea" radius={[4, 4, 0, 0]} maxBarSize={38} />
              <Bar yAxisId="sar" dataKey="cost" name={tt("reports.metric.operatingCost")} fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={38} />
              {/* connectNulls stays FALSE: a month with no revenue has a null
                  margin by design (0098), and bridging it would draw a
                  confident line through a number that does not exist. */}
              <Line yAxisId="pct" type="monotone" dataKey="margin" name={tt("common.margin")} stroke="#10b981"
                strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>

      {/* ---- Cost structure + cash ------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title={say("reports.overview.section.whereMoneyWent", { p: monthLabel(month) })}>
          <div className="space-y-3">
            {buckets.map((b) => {
              const share = p.operating_cost_sar > 0 ? (b.value / p.operating_cost_sar) * 100 : null;
              return (
                <div key={b.key}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{tt(b.labelKey)}</span>
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
              <span className="font-semibold">{tt("reports.metric.operatingCost")}</span>
              <span className="font-semibold tabular-nums">{formatSar(p.operating_cost_sar)}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="muted">{tt("reports.overview.otherExpensesSeparate")}</span>
              <span className="tabular-nums muted">{formatSar(p.expenses_sar)}</span>
            </div>

            {/* Payroll has no salary history — the layer exposes this precisely
                so the UI can say it out loud rather than implying precision it
                does not have. */}
            {pay && (
              <Disclosure>
                {/* THREE leaves, not one sentence with a marker in it: the
                    <strong> falls on "current" BEFORE the noun in English and
                    AFTER it in Arabic, so each language has to place it. The
                    `{" "}` either side is JSX — the values carry no edge
                    whitespace of their own. */}
                {tt("reports.overview.payroll.before")}{" "}
                <strong>{tt("reports.overview.payroll.current")}</strong>{" "}
                {tt("reports.overview.payroll.after")}
                {/* Spliced THREE times in one English sentence — person/people,
                    has/have, counts/count. Whole sentence per count bucket. */}
                {pay.people_missing_salary > 0 && (
                  <>{" "}{say(`reports.overview.payroll.missing.${plural(pay.people_missing_salary)}`,
                    { n: pay.people_missing_salary })}</>
                )}
              </Disclosure>
            )}
          </div>
        </Section>

        <Section title={tt("reports.overview.section.earnedVsCollected")}>
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
                <Bar dataKey="revenue" name={tt("reports.overview.series.revenueEarned")} fill="#0b7eea" radius={[4, 4, 0, 0]} maxBarSize={30} />
                <Line type="monotone" dataKey="collected" name={tt("reports.overview.series.cashCollected")} stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <Disclosure>
            {tt("reports.overview.basesNote")}
            {top && top.topups_sar > 0 && (
              <>{" "}{say("reports.overview.topupsNote", { v: formatSar(top.topups_sar) })}</>
            )}
          </Disclosure>
        </Section>
      </div>

      {/* ---- Per-truck: what each truck earned, and what it cost -------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title={say("reports.overview.section.revenueByTruck", { p: monthLabel(month) })}>
          {trucksThisMonth.length === 0 ? (
            <EmptyNote>{tt("reports.overview.noTruckRevenue")}</EmptyNote>
          ) : (
            <Table>
              <thead>
                <tr>
                  <TH>{tt("common.truck")}</TH>
                  <TH className="text-right">{tt("reports.th.trips")}</TH>
                  <TH className="text-right">{tt("common.revenue")}</TH>
                </tr>
              </thead>
              <tbody>
                {/* `r`, not `t` — the row parameter was `t` and would shadow the
                    translator this file now calls inside the loop. */}
                {trucksThisMonth.slice(0, 8).map((r) => (
                  <tr key={r.truck_id}>
                    <TD>{r.plate}</TD>
                    <TD className="text-right tabular-nums">{formatNum(r.trips)}</TD>
                    <TD className="text-right tabular-nums">{formatSar(r.allocated_revenue_sar)}</TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Disclosure>{tt("reports.overview.allocationNote")}</Disclosure>
        </Section>

        {/* Three named measures (0099), never collapsed into one unlabelled
            number — "maintenance cost per truck" previously meant two
            different things on two different pages. Parts and outsourced are
            both shown because outsourced is the LARGER half. */}
        <Section title={say("reports.overview.section.maintByTruck", { p: monthLabel(month) })}>
          {maintThisMonth.length === 0 ? (
            <EmptyNote>{tt("reports.overview.noTruckMaint")}</EmptyNote>
          ) : (
            <Table>
              <thead>
                <tr>
                  <TH>{tt("common.truck")}</TH>
                  <TH className="text-right">{tt("reports.th.parts")}</TH>
                  <TH className="text-right">{tt("reports.th.outsourced")}</TH>
                  <TH className="text-right">{tt("reports.th.total")}</TH>
                </tr>
              </thead>
              <tbody>
                {/* `r`, not `t` — see the note in the revenue table above. */}
                {maintThisMonth.slice(0, 8).map((r) => (
                  <tr key={r.truck_id}>
                    <TD>{r.plate}</TD>
                    <TD className="text-right tabular-nums muted">
                      {r.maintenance_parts_sar === 0 ? "—" : formatSar(r.maintenance_parts_sar)}
                    </TD>
                    <TD className="text-right tabular-nums muted">
                      {r.os_payments_sar === 0 ? "—" : formatSar(r.os_payments_sar)}
                    </TD>
                    <TD className="text-right tabular-nums font-medium">
                      {formatSar(r.total_maintenance_sar)}
                    </TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Disclosure>
            {tt("reports.overview.maintNote")}
            {maintSplit.os > 0 && maintSplit.parts > 0 && (
              <>{" "}{say("reports.overview.maintSplit", {
                o: formatSar(maintSplit.os),
                p: formatSar(maintSplit.parts),
                s: formatShare((maintSplit.parts / (maintSplit.parts + maintSplit.os)) * 100),
              })}</>
            )}
          </Disclosure>
        </Section>
      </div>

      {/* ---- Receivables ----------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title={tt("reports.overview.section.aging")}>
          {outstanding === 0 ? (
            <EmptyNote>{tt("reports.nothingOutstanding")}</EmptyNote>
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
                      formatter={(v) => [formatSar(v as number), tt("reports.th.outstanding")]}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56} fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 text-xs muted">
                {tt("reports.overview.agingNote")}
              </div>
            </>
          )}
        </Section>

        {receivables.length > 0 && (
        <Section title={tt("reports.overview.section.oldestUnpaid")}>
          <Table>
            <thead>
              <tr>
                <TH>{tt("reports.th.invoice")}</TH>
                <TH>{tt("reports.th.customer")}</TH>
                <TH className="text-right">{tt("reports.th.days")}</TH>
                <TH className="text-right">{tt("reports.th.outstanding")}</TH>
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

    </div>
  );
}

// --- Pieces ----------------------------------------------------------------

// `label`, `foot` and `note` arrive ALREADY TRANSLATED — they are strings the
// caller composed, several of them from a count bucket that only the caller
// knows the count for. `lang` is threaded in anyway because DeltaLine below
// says one word of its own.
function BigStat({
  label, value, d, higherIsBetter = true, prev, foot, note, tone, lang,
}: {
  label: string; value: string; d?: Delta; higherIsBetter?: boolean;
  prev?: string | null; foot?: string; note?: string; tone?: "ok" | "bad";
  lang: Lang;
}) {
  // `tone` here is the DELTA's tone, distinct from the `tone` prop above.
  const dTone = d ? deltaTone(d, higherIsBetter) : undefined;
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
      {d && prev && <DeltaLine d={d} tone={dTone} prev={prev} lang={lang} />}
      {foot && <div className="text-xs muted mt-1.5">{foot}</div>}
      {note && <div className="text-[11px] muted mt-0.5 italic">{note}</div>}
    </Card>
  );
}

function MiniStat({
  label, value, d, higherIsBetter = true, sub, onClick, lang,
}: {
  label: string; value: string; d?: Delta; higherIsBetter?: boolean;
  sub?: string; onClick?: () => void; lang: Lang;
}) {
  // Renamed off `t` for the same reason as the table loops above.
  const dTone = d ? deltaTone(d, higherIsBetter) : undefined;
  const body = (
    <Card className={cn("p-3", onClick && "cursor-pointer hover:ring-1 hover:ring-brand-500/40 transition")}>
      <div className="text-[11px] muted uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold mt-1 tabular-nums">{value}</div>
      {d && (
        <div className={cn(
          "text-[11px] mt-0.5 tabular-nums",
          dTone === "ok" ? "text-emerald-600 dark:text-emerald-400" :
          dTone === "bad" ? "text-rose-600 dark:text-rose-400" : "muted",
        )}>
          {d.pct === null
            ? (d.abs === 0 ? t("reports.overview.noChange", lang) : `${d.abs > 0 ? "+" : ""}${formatSar(d.abs)}`)
            : formatPct(d.pct)}
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
function DeltaLine({ d, tone, prev, lang }: {
  d: Delta; tone?: "ok" | "bad"; prev: string; lang: Lang;
}) {
  const Icon = d.dir === "up" ? TrendingUp : d.dir === "down" ? TrendingDown : Minus;
  return (
    <div className={cn(
      "flex items-center gap-1.5 text-xs mt-1.5 tabular-nums",
      tone === "ok" ? "text-emerald-600 dark:text-emerald-400" :
      tone === "bad" ? "text-rose-600 dark:text-rose-400" : "muted",
    )}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{d.pct === null ? `${d.abs >= 0 ? "+" : ""}${formatSar(d.abs)}` : formatPct(d.pct)}</span>
      <span className="muted font-normal">
        {fill(t("reports.overview.vs", lang), { p: monthLabel(prev) })}
      </span>
    </div>
  );
}

// The two helpers below are EXPORTED for MetricsGlossaryModal, which renders
// the report_metrics dictionary this tab's figures are defined in. That modal
// used to be a section at the bottom of this file and was moved out to a popup
// launched from the page header (Turki's call) — a 30-metric reference is
// something you consult mid-thought, not something you scroll the whole tab to
// reach. The import edge is ONE WAY: that file imports this one, never back.

/** A caveat the semantic layer exposed on purpose — shown, not buried. */
export function Disclosure({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex gap-2 text-[11px] muted leading-relaxed">
      <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
      <p>{children}</p>
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-sm muted">{children}</div>;
}
