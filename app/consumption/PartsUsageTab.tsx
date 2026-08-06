"use client";

// Consumption — the PARTS USAGE tab.
//
// A LEAF module: imports lib/ and components/ only, never back from
// ConsumptionClient — the one-way edge the Phase-4 import-cycle incident made
// a standing rule.
//
// PURE ANALYTICS. Nothing here writes, and nothing here recomputes a cost:
// every SAR figure is a FIFO price that was stamped when the stock moved.
//
// VALUE AND QUANTITY SIDE BY SIDE, everywhere. That is the brief, and it is
// also the honest way to show this data — 57 cheap filters and 2 expensive
// pumps are the same "consumption" only if you are looking at one number.
//
// ONE PERIOD DRIVES THE PAGE. The picker at the top sets the granularity and
// every reading answers "this period vs the one before" at that scale. Three
// things are deliberately exempt and say so on screen: the weekly summary
// (weekly by definition), the combined trend chart (a history, with its own
// coarser toggle), and "currently out" (a statement about right now, not a
// window).

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  PackageMinus, Wrench, DoorOpen, Clock, AlertTriangle, X,
  TrendingUp, TrendingDown, Minus, Truck,
} from "lucide-react";
import { Card, Btn, Table, TH, TD } from "@/components/ui";
import { cn, formatSar, formatNum } from "@/lib/utils";
import {
  buildUsageRows, totals, bySource, byWarehouse, byDestination,
  topParts, outstandingReturnable, byTruck, weeklySummary,
  periodWindow, inWindow, pctChange, trendSeries, movingAverage,
  PERIOD_LABELS, TREND_LABELS,
  type UsageRow, type Bucket, type WoLedgerRow, type EpLedgerRow,
  type PeriodKind, type TrendKind, type TruckUsage, type SummaryBullet,
} from "@/lib/parts-usage";
import type {
  ExitPermit, ExitPermitLine, WorkOrder, WorkOrderPart,
} from "@/lib/db-types";

type PartLite = { id: string; name: string; sku: string; unit: string | null; warehouse_id: string };
type WarehouseLite = { id: string; name: string };
type TruckLite = { id: string; plate: string };

export default function PartsUsageTab({
  workOrders, workOrderParts, woLedger,
  permits, permitLines, epLedger,
  parts, warehouses, trucks, destinationLabel,
}: {
  workOrders: WorkOrder[];
  workOrderParts: WorkOrderPart[];
  woLedger: WoLedgerRow[];
  permits: ExitPermit[];
  permitLines: ExitPermitLine[];
  epLedger: EpLedgerRow[];
  parts: PartLite[];
  warehouses: WarehouseLite[];
  trucks: TruckLite[];
  destinationLabel: (p: ExitPermit) => string;
}) {
  const [period, setPeriod] = useState<PeriodKind>("month");
  const [trend, setTrend] = useState<TrendKind>("month");
  const [sourceFilter, setSourceFilter] = useState<"all" | "maintenance" | "exit_permit">("all");
  const [modal, setModal] = useState<null | "trucks" | "value" | "qty">(null);

  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const warehouseName = useMemo(() => {
    const m = new Map(warehouses.map((w) => [w.id, w.name]));
    return (id: string) => m.get(id) ?? null;
  }, [warehouses]);
  const plateOf = useMemo(() => {
    const m = new Map(trucks.map((t) => [t.id, t.plate]));
    return (id: string) => m.get(id) ?? null;
  }, [trucks]);
  const partName = useMemo(() => {
    const m = new Map(parts.map((p) => [p.id, p.name]));
    return (id: string) => m.get(id) ?? null;
  }, [parts]);

  const allRows = useMemo(
    () =>
      buildUsageRows({
        workOrders, workOrderParts, woLedger,
        permits, permitLines, epLedger,
        partWarehouse: (id) => partsById.get(id)?.warehouse_id ?? null,
        destinationLabel,
      }),
    [workOrders, workOrderParts, woLedger, permits, permitLines, epLedger, partsById, destinationLabel],
  );

  // The source filter narrows the pool BEFORE the period is applied, so the
  // "vs last period" comparison is like-for-like within the chosen source.
  const pool = useMemo(
    () => (sourceFilter === "all" ? allRows : allRows.filter((r) => r.source === sourceFilter)),
    [allRows, sourceFilter],
  );

  const win = useMemo(() => periodWindow(period, new Date()), [period]);
  const rows = useMemo(() => inWindow(pool, win.start, win.end), [pool, win]);
  const prevRows = useMemo(() => inWindow(pool, win.prevStart, win.prevEnd), [pool, win]);

  const grand = useMemo(() => totals(rows), [rows]);
  const grandPrev = useMemo(() => totals(prevRows), [prevRows]);
  const sources = useMemo(() => bySource(rows), [rows]);
  const sourcesPrev = useMemo(() => bySource(prevRows), [prevRows]);
  const warehouseBuckets = useMemo(() => byWarehouse(rows, warehouseName), [rows, warehouseName]);
  const destinations = useMemo(() => byDestination(rows), [rows]);
  const top = useMemo(() => topParts(rows, partName, 5), [rows, partName]);
  const topAll = useMemo(() => topParts(rows, partName, 9999), [rows, partName]);
  const truckRows = useMemo(() => byTruck(rows, plateOf), [rows, plateOf]);

  // The trend chart is a HISTORY — it ignores the period picker on purpose.
  const series = useMemo(() => trendSeries(pool, trend), [pool, trend]);
  const trendLine = useMemo(() => movingAverage(series), [series]);

  // The weekly summary is weekly whatever the picker says, and it reads the
  // UNFILTERED pool — a narrative about "the company's consumption" that
  // silently obeyed a source filter would be misleading.
  const weekly = useMemo(
    () => weeklySummary(allRows, new Date(), partName, plateOf),
    [allRows, partName, plateOf],
  );

  // Outstanding is current state, never period-scoped.
  const outstanding = useMemo(
    () => outstandingReturnable({ permits, permitLines, destinationLabel }),
    [permits, permitLines, destinationLabel],
  );
  const outstandingTotal = useMemo(
    () => outstanding.reduce(
      (a, r) => ({ qty: a.qty + r.qty, valueSar: a.valueSar + r.valueSar }),
      { qty: 0, valueSar: 0 },
    ),
    [outstanding],
  );

  const maintenanceRecords = useMemo(() => {
    const completed = new Set(workOrders.filter((w) => w.status === "completed").map((w) => w.id));
    const byWo = new Map<string, { wo: WorkOrder; rows: UsageRow[] }>();
    for (const r of allRows) {
      if (r.source !== "maintenance" || !r.workOrderId || !completed.has(r.workOrderId)) continue;
      const wo = workOrders.find((w) => w.id === r.workOrderId);
      if (!wo) continue;
      const entry = byWo.get(wo.id) ?? { wo, rows: [] };
      entry.rows.push(r);
      byWo.set(wo.id, entry);
    }
    return [...byWo.values()].sort((a, b) => (b.wo.closed_at ?? "").localeCompare(a.wo.closed_at ?? ""));
  }, [allRows, workOrders]);

  const preLedgerCount = useMemo(() => allRows.filter((r) => r.stamped === "line").length, [allRows]);

  if (allRows.length === 0) {
    return (
      <Card>
        <div className="p-10 text-center">
          <PackageMinus className="h-6 w-6 mx-auto mb-2 opacity-40" />
          <p className="text-sm muted">No parts have left stock yet.</p>
          <p className="text-xs muted mt-1">
            Consumption appears here once a work order deducts its parts or an exit permit is
            confirmed.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* ---- The global period picker ---- */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {(Object.keys(PERIOD_LABELS) as PeriodKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setPeriod(k)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium transition border",
                period === k
                  ? "bg-brand-500/10 border-brand-600 text-brand-700 dark:text-brand-300"
                  : "border-transparent muted hover:bg-black/5 dark:hover:bg-white/5",
              )}
            >
              {PERIOD_LABELS[k]}
            </button>
          ))}
        </div>
        <span className="text-[11px] muted">
          Showing <span className="font-medium">{win.label}</span> against {win.prevLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <PairKpi
          label="Consumed this period"
          valueSar={grand.valueSar} qty={grand.qty}
          prevValue={grandPrev.valueSar} prevQty={grandPrev.qty}
          icon={<PackageMinus className="h-4 w-4" />}
        />
        <PairKpi
          label="Maintenance"
          valueSar={sources.find((s) => s.key === "maintenance")?.valueSar ?? 0}
          qty={sources.find((s) => s.key === "maintenance")?.qty ?? 0}
          prevValue={sourcesPrev.find((s) => s.key === "maintenance")?.valueSar ?? 0}
          prevQty={sourcesPrev.find((s) => s.key === "maintenance")?.qty ?? 0}
          icon={<Wrench className="h-4 w-4" />}
        />
        <PairKpi
          label="Exit permits"
          valueSar={sources.find((s) => s.key === "exit_permit")?.valueSar ?? 0}
          qty={sources.find((s) => s.key === "exit_permit")?.qty ?? 0}
          prevValue={sourcesPrev.find((s) => s.key === "exit_permit")?.valueSar ?? 0}
          prevQty={sourcesPrev.find((s) => s.key === "exit_permit")?.qty ?? 0}
          icon={<DoorOpen className="h-4 w-4" />}
        />
        <PairKpi
          label="Out and not back"
          valueSar={outstandingTotal.valueSar} qty={outstandingTotal.qty}
          icon={<Clock className="h-4 w-4" />}
          tone={outstandingTotal.qty > 0 ? "warn" : undefined}
          note="Right now — not period-scoped"
        />
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {([
          ["all", "Everything"],
          ["maintenance", "Maintenance only"],
          ["exit_permit", "Exit permits only"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSourceFilter(k)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition border",
              sourceFilter === k
                ? "bg-brand-500/10 border-brand-600 text-brand-700 dark:text-brand-300"
                : "border-transparent muted hover:bg-black/5 dark:hover:bg-white/5",
            )}
          >
            {label}
          </button>
        ))}
        <span className="ms-auto text-[11px] muted">
          Every figure is the FIFO cost stamped when the stock moved.
        </span>
      </div>

      {/* ---- 2) Combined consumption: bars + trend line, own toggle ---- */}
      <Card className="!p-0 overflow-hidden">
        <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">Total consumption over time</h3>
            <p className="text-[11px] muted">
              Everything that left stock — maintenance draws and exit permits together — with a
              3-point moving average. Full history, independent of the period picker.
            </p>
          </div>
          <div className="flex items-center gap-1">
            {(Object.keys(TREND_LABELS) as TrendKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setTrend(k)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-medium transition border",
                  trend === k
                    ? "bg-brand-500/10 border-brand-600 text-brand-700 dark:text-brand-300"
                    : "border-transparent muted hover:bg-black/5 dark:hover:bg-white/5",
                )}
              >
                {TREND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="p-4 pt-0">
          <ComboChart series={series} trend={trendLine} />
        </div>
      </Card>

      {/* ---- 3) Weekly feedback summary ---- */}
      <Card className="!p-0 overflow-hidden">
        <SectionHead
          title="This week in review"
          hint={`${weekly.window.label} — always weekly, whatever the period picker says`}
        />
        <ul className="px-4 pb-4 space-y-2">
          {weekly.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <BulletIcon tone={b.tone} />
              <span>{b.text}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* ---- 1) Top costly trucks ---- */}
      <Card className="!p-0 overflow-hidden">
        <SectionHead
          title="Top 5 costly trucks"
          hint="Maintenance parts drawn per truck this period"
          action={truckRows.length > 0
            ? <button onClick={() => setModal("trucks")} className="text-xs text-brand-600 dark:text-brand-300 font-medium hover:underline">View all trucks</button>
            : undefined}
        />
        <TruckTable rows={truckRows.slice(0, 5)} />
      </Card>

      {/* ---- 5) Parts consumption: two lists side by side ---- */}
      <Card className="!p-0 overflow-hidden">
        <SectionHead title="Parts consumption" hint="What is driving the numbers this period" />
        <div className="grid grid-cols-1 lg:grid-cols-2">
          <div>
            <div className="px-4 pb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide muted">Top 5 by value</h4>
              {topAll.byValue.length > 5 && (
                <button onClick={() => setModal("value")} className="text-xs text-brand-600 dark:text-brand-300 font-medium hover:underline">
                  View full list
                </button>
              )}
            </div>
            <TopPartsTable buckets={top.byValue} highlight="value" />
          </div>
          {/* The separator: a vertical rule between the two lists on wide
              screens, a horizontal one when they stack. */}
          <div className="border-t lg:border-t-0 lg:border-s" style={{ borderColor: "rgb(var(--border))" }}>
            <div className="px-4 pt-4 lg:pt-0 pb-2 flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide muted">Top 5 by quantity</h4>
              {topAll.byQty.length > 5 && (
                <button onClick={() => setModal("qty")} className="text-xs text-brand-600 dark:text-brand-300 font-medium hover:underline">
                  View full list
                </button>
              )}
            </div>
            <TopPartsTable buckets={top.byQty} highlight="qty" />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="!p-0 overflow-hidden">
          <SectionHead title="Maintenance vs exit permits" hint="Where this period's consumption went" />
          <div className="p-4"><SplitBars buckets={sources} emptyText="Nothing consumed this period." /></div>
        </Card>

        <Card className="!p-0 overflow-hidden">
          <SectionHead title="By warehouse" hint="Which stock room it came out of" />
          <div className="p-4"><SplitBars buckets={warehouseBuckets} emptyText="No warehouse data this period." /></div>
        </Card>

        <Card className="!p-0 overflow-hidden">
          <SectionHead title="By destination" hint="Exit permits only — maintenance has no destination" />
          <div className="p-4"><SplitBars buckets={destinations} emptyText="No exit permits left this period." /></div>
        </Card>

        <Card className="!p-0 overflow-hidden">
          <SectionHead title="Currently out and not back" hint="Returnable permits still holding stock — as of now" />
          {outstanding.length === 0 ? (
            <p className="p-4 text-sm muted">Nothing is out — every returnable permit is back.</p>
          ) : (
            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr><TH>Permit</TH><TH>Destination</TH><TH>Due back</TH><TH>Qty</TH><TH>Value</TH></tr>
              </thead>
              <tbody>
                {outstanding.map((r) => (
                  <tr key={r.permitId}>
                    <TD><span className="font-mono text-xs font-medium">{r.reference}</span></TD>
                    <TD className="text-xs">{r.destination}</TD>
                    <TD className="text-xs muted">
                      {r.expectedReturnOn
                        ? new Date(r.expectedReturnOn + "T00:00:00").toLocaleDateString()
                        : "—"}
                    </TD>
                    <TD className="text-xs tabular-nums font-medium">{formatNum(r.qty, 2)}</TD>
                    <TD className="text-xs tabular-nums font-medium">{formatSar(r.valueSar)}</TD>
                  </tr>
                ))}
                <tr>
                  <TD className="text-xs font-semibold">Total</TD>
                  <TD>{null}</TD><TD>{null}</TD>
                  <TD className="text-xs tabular-nums font-semibold">{formatNum(outstandingTotal.qty, 2)}</TD>
                  <TD className="text-xs tabular-nums font-semibold">{formatSar(outstandingTotal.valueSar)}</TD>
                </tr>
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {/* ---- 6) The records table sits BELOW everything above ---- */}
      <Card className="!p-0 overflow-hidden">
        <SectionHead
          title="In-house maintenance consumption history"
          hint="Every part each completed work order drew from stock — full history, not period-scoped"
        />
        {maintenanceRecords.length === 0 ? (
          <p className="p-4 text-sm muted">No completed work order has consumed parts yet.</p>
        ) : (
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>Work order</TH><TH>Job</TH><TH>Closed</TH>
                <TH>Part</TH><TH>Qty</TH><TH>Unit cost</TH><TH>Value</TH>
              </tr>
            </thead>
            <tbody>
              {maintenanceRecords.map(({ wo, rows: woRows }) =>
                woRows.map((r, i) => {
                  const part = partsById.get(r.partId);
                  return (
                    <tr key={r.key}>
                      <TD className="align-top">
                        {i === 0 && <span className="font-mono text-xs font-medium">{wo.wo_number}</span>}
                      </TD>
                      <TD className="align-top whitespace-normal max-w-[220px]">
                        {i === 0 && <span className="text-xs line-clamp-2" title={wo.title}>{wo.title}</span>}
                      </TD>
                      <TD className="align-top text-xs muted">
                        {i === 0 && (wo.closed_at ? new Date(wo.closed_at).toLocaleDateString() : "—")}
                      </TD>
                      <TD>
                        <span className="text-sm">{part?.name ?? "Unknown part"}</span>
                        <div className="text-[11px] muted">
                          {part?.sku}{part?.unit ? ` · ${part.unit}` : ""}
                          {r.stamped === "line" && (
                            <span className="ms-1 text-amber-600 dark:text-amber-400">· pre-ledger</span>
                          )}
                        </div>
                      </TD>
                      <TD className="text-xs tabular-nums">{formatNum(r.qty, 2)}</TD>
                      <TD className="text-xs tabular-nums muted">
                        {r.qty !== 0 ? formatSar(r.valueSar / r.qty) : "—"}
                      </TD>
                      <TD className="text-xs tabular-nums font-medium">{formatSar(r.valueSar)}</TD>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </Table>
        )}
      </Card>

      {preLedgerCount > 0 && (
        <div className="rounded-lg px-3 py-2 text-[11px] muted bg-amber-500/10 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <span>
            {preLedgerCount} line{preLedgerCount === 1 ? "" : "s"} predate{preLedgerCount === 1 ? "s" : ""} the
            per-lot consumption ledger, so {preLedgerCount === 1 ? "its" : "their"} cost comes from the
            work order&apos;s own stamped unit price instead of the lot breakdown. The figure is the same
            one the deduction recorded — there is just no per-lot detail behind it.
          </span>
        </div>
      )}

      {modal === "trucks" && (
        <ListModal title="All trucks by maintenance parts" subtitle={win.label} onClose={() => setModal(null)}>
          <TruckTable rows={truckRows} />
        </ListModal>
      )}
      {modal === "value" && (
        <ListModal title="All parts by value" subtitle={win.label} onClose={() => setModal(null)}>
          <TopPartsTable buckets={topAll.byValue} highlight="value" />
        </ListModal>
      )}
      {modal === "qty" && (
        <ListModal title="All parts by quantity" subtitle={win.label} onClose={() => setModal(null)}>
          <TopPartsTable buckets={topAll.byQty} highlight="qty" />
        </ListModal>
      )}
    </div>
  );
}

function SectionHead({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-[11px] muted">{hint}</p>
      </div>
      {action}
    </div>
  );
}

function BulletIcon({ tone }: { tone: SummaryBullet["tone"] }) {
  const cls = "h-3.5 w-3.5 shrink-0 mt-1";
  if (tone === "up") return <TrendingUp className={cn(cls, "text-amber-600 dark:text-amber-400")} />;
  if (tone === "down") return <TrendingDown className={cn(cls, "text-emerald-600 dark:text-emerald-400")} />;
  if (tone === "flat") return <Minus className={cn(cls, "muted")} />;
  return <span className={cn(cls, "rounded-full bg-black/20 dark:bg-white/25 h-1.5 w-1.5 mt-2")} />;
}

/** Value and quantity as equals, each with its own change against the
 *  previous period — a percentage with no base is left blank rather than
 *  rendered as an infinite jump. */
function PairKpi({
  label, valueSar, qty, prevValue, prevQty, icon, tone, note,
}: {
  label: string; valueSar: number; qty: number;
  prevValue?: number; prevQty?: number;
  icon: React.ReactNode; tone?: "warn"; note?: string;
}) {
  const dV = prevValue === undefined ? null : pctChange(valueSar, prevValue);
  const dQ = prevQty === undefined ? null : pctChange(qty, prevQty);
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 text-xs muted uppercase tracking-wide">
        <span className={cn(tone === "warn" && "text-amber-600 dark:text-amber-400")}>{icon}</span>
        {label}
      </div>
      <div className={cn(
        "text-2xl font-semibold mt-1 tabular-nums",
        tone === "warn" && qty > 0 && "text-amber-600 dark:text-amber-400",
      )}>
        {formatSar(valueSar)}
      </div>
      <div className="flex items-baseline gap-2 mt-0.5">
        <span className="text-xs muted tabular-nums">{formatNum(qty, 2)} units</span>
        {dQ !== null && <Delta pct={dQ} small />}
      </div>
      {dV !== null && <div className="mt-1"><Delta pct={dV} label="in value" /></div>}
      {note && <div className="text-[10px] muted mt-1">{note}</div>}
    </div>
  );
}

function Delta({ pct, label, small }: { pct: number; label?: string; small?: boolean }) {
  const up = pct >= 0;
  return (
    <span className={cn(
      "inline-flex items-center gap-0.5 tabular-nums",
      small ? "text-[10px]" : "text-[11px]",
      // More consumption is not automatically good news, so this is neutral
      // amber for up and emerald for down rather than green-means-growth.
      up ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400",
    )}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? "+" : ""}{Math.round(pct)}%{label ? ` ${label}` : ""}
    </span>
  );
}

/**
 * Bars for the period's value with a moving-average line on top, in ONE
 * chart. Drawn as SVG so the line lands exactly on each bar's centre;
 * `vector-effect` keeps the stroke honest when the viewBox stretches.
 *
 * Quantity is NOT a second bar here — this chart answers "what is total
 * consumption doing", and two scales in one frame would make the trend line
 * ambiguous about which series it follows. Quantity per bucket is in the
 * tooltip and in every other view on the page.
 */
function ComboChart({ series, trend }: { series: Bucket[]; trend: number[] }) {
  if (series.length === 0) return <p className="text-sm muted">No consumption yet.</p>;

  // BARS ARE HTML, THE LINE IS SVG, and that split is deliberate. A pure-SVG
  // chart stretched to the container needs preserveAspectRatio="none", which
  // makes bars balloon when there are few buckets and turns every dot into an
  // ellipse. Laying the bars out with flex keeps them a sane width at any
  // bucket count, and the overlay only has to carry a polyline — whose stroke
  // stays honest under the same stretch via vector-effect.
  const H = 100;
  const max = Math.max(...series.map((b) => b.valueSar), ...trend, 1);
  const y = (v: number) => H - (v / max) * (H - 6);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <div style={{ minWidth: Math.max(series.length * 56, 260) }}>
          <div className="relative" style={{ height: 160 }}>
            <div className="absolute inset-0 flex items-end">
              {series.map((b) => (
                <div key={b.key} className="flex-1 flex justify-center items-end h-full">
                  <div
                    className="w-full max-w-[44px] rounded-t bg-brand-500/60"
                    style={{ height: `${Math.max((b.valueSar / max) * 94, b.valueSar > 0 ? 1.5 : 0)}%` }}
                    title={`${b.label}: ${formatSar(b.valueSar)} · ${formatNum(b.qty, 2)} units`}
                  />
                </div>
              ))}
            </div>
            <svg
              viewBox={`0 0 ${series.length} ${H}`}
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full pointer-events-none"
            >
              <polyline
                points={trend.map((v, i) => `${i + 0.5},${y(v)}`).join(" ")}
                fill="none"
                className="stroke-amber-500"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
          <div className="flex">
            {series.map((b, i) => (
              <div key={b.key} className="flex-1 text-center px-0.5">
                <div className="text-[10px] muted whitespace-nowrap">{b.label}</div>
                <div className="text-[10px] tabular-nums font-medium">{formatSar(b.valueSar)}</div>
                <div className="text-[10px] tabular-nums muted">{formatNum(b.qty, 2)}u</div>
                <div className="text-[10px] tabular-nums text-amber-600 dark:text-amber-400"
                  title="3-point moving average">
                  ~{formatSar(trend[i])}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 text-[11px] muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-500/60" />Total consumption (SAR)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-amber-500" />Trend (3-point average)
        </span>
      </div>
    </div>
  );
}

function TruckTable({ rows }: { rows: TruckUsage[] }) {
  if (rows.length === 0) {
    return <p className="p-4 text-sm muted">No maintenance parts were drawn this period.</p>;
  }
  return (
    <Table>
      <thead style={{ background: "rgba(0,0,0,0.02)" }}>
        <tr><TH>Truck</TH><TH>Times to maintenance</TH><TH>Qty</TH><TH>Total maintenance value</TH></tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.truckId}>
            <TD>
              <span className="inline-flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5 muted" />
                <span className="font-mono text-xs font-medium">{t.plate}</span>
              </span>
            </TD>
            <TD className="text-xs tabular-nums">{t.visits}</TD>
            <TD className="text-xs tabular-nums">{formatNum(t.qty, 2)}</TD>
            <TD className="text-xs tabular-nums font-medium">{formatSar(t.valueSar)}</TD>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function SplitBars({ buckets, emptyText }: { buckets: Bucket[]; emptyText: string }) {
  if (buckets.length === 0) return <p className="text-sm muted">{emptyText}</p>;
  const maxVal = Math.max(...buckets.map((b) => b.valueSar), 1);
  const maxQty = Math.max(...buckets.map((b) => b.qty), 1);

  return (
    <div className="space-y-3">
      {buckets.map((b) => (
        <div key={b.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium truncate">{b.label}</span>
            <span className="text-xs tabular-nums shrink-0">
              <span className="font-semibold">{formatSar(b.valueSar)}</span>
              <span className="muted"> · {formatNum(b.qty, 2)} units</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-black/[0.06] dark:bg-white/[0.08]">
            <div className="h-full bg-brand-500/70" style={{ width: `${(b.valueSar / maxVal) * 100}%` }} />
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-black/[0.06] dark:bg-white/[0.08]">
            <div className="h-full bg-emerald-500/60" style={{ width: `${(b.qty / maxQty) * 100}%` }} />
          </div>
        </div>
      ))}
      <div className="flex items-center gap-4 text-[11px] muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-500/70" />Value (SAR)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/60" />Quantity (units)
        </span>
      </div>
    </div>
  );
}

function TopPartsTable({ buckets, highlight }: { buckets: Bucket[]; highlight: "value" | "qty" }) {
  if (buckets.length === 0) return <p className="p-4 text-sm muted">Nothing consumed this period.</p>;
  return (
    <Table>
      <thead style={{ background: "rgba(0,0,0,0.02)" }}>
        <tr><TH>Part</TH><TH>Qty</TH><TH>Value</TH></tr>
      </thead>
      <tbody>
        {buckets.map((b) => (
          <tr key={b.key}>
            <TD className="whitespace-normal max-w-[240px]">
              <span className="text-sm line-clamp-1" title={b.label}>{b.label}</span>
            </TD>
            <TD className={cn("text-xs tabular-nums", highlight === "qty" && "font-semibold")}>
              {formatNum(b.qty, 2)}
            </TD>
            <TD className={cn("text-xs tabular-nums", highlight === "value" && "font-semibold")}>
              {formatSar(b.valueSar)}
            </TD>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function ListModal({
  title, subtitle, onClose, children,
}: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  // Portal only after mount — same guard as every other modal in this app.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto" onClick={onClose}>
      <div className="card w-full max-w-[720px] max-h-[85vh] overflow-y-auto scrollbar-thin p-0"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-4 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <div>
            <h2 className="font-semibold">{title}</h2>
            <p className="text-[11px] muted">{subtitle}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
        <div className="flex justify-end p-4 border-t" style={{ borderColor: "rgb(var(--border))" }}>
          <Btn variant="outline" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}
