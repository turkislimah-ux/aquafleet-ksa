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
import { cn, formatDate, formatNum, formatSar, todayKey } from "@/lib/utils";
import { useApp } from "@/components/AppShell";
import { t, plural, arText, type Lang } from "@/lib/i18n";
import {
  buildUsageRows, totals, bySource, byWarehouse, byDestination,
  topParts, outstandingReturnable, byTruck, weeklySummary,
  periodWindow, inWindow, pctChange, movingAverage, timelineKeys, seriesOn,
  PERIOD_LABELS, TREND_LABELS,
  type UsageRow, type Bucket, type WoLedgerRow, type EpLedgerRow,
  type PeriodKind, type TrendKind, type TruckUsage, type SummaryBullet,
} from "@/lib/parts-usage";
import type {
  ExitPermit, ExitPermitLine, WorkOrder, WorkOrderPart,
} from "@/lib/db-types";
import ScrollLock from "@/components/ScrollLock";

// `name_ar` rides along so a part name can go through arText(). It is nullable
// and arText() returns the base untouched when it is null, so a part with no
// Arabic name still renders its English one rather than a blank.
//
// Warehouses and trucks get NO Arabic column: `warehouses` has no `name_ar` in
// the schema, and a plate is a registration string, not prose.
type PartLite = { id: string; name: string; name_ar: string | null; sku: string; unit: string | null; warehouse_id: string };
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
  const { lang } = useApp();
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
  // DISPLAY name, so arText() decides which column is shown. The map is rebuilt
  // when the language changes because that is what the label on a bar reads.
  const partName = useMemo(() => {
    const m = new Map(parts.map((p) => [p.id, arText(p.name, p.name_ar, lang)]));
    return (id: string) => m.get(id) ?? null;
  }, [parts, lang]);

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

  const win = useMemo(() => periodWindow(period, new Date(), lang), [period, lang]);
  const rows = useMemo(() => inWindow(pool, win.start, win.end), [pool, win]);
  const prevRows = useMemo(() => inWindow(pool, win.prevStart, win.prevEnd), [pool, win]);

  const grand = useMemo(() => totals(rows), [rows]);
  const grandPrev = useMemo(() => totals(prevRows), [prevRows]);
  const sources = useMemo(() => bySource(rows, lang), [rows, lang]);
  const sourcesPrev = useMemo(() => bySource(prevRows, lang), [prevRows, lang]);
  const warehouseBuckets = useMemo(() => byWarehouse(rows, warehouseName, lang), [rows, warehouseName, lang]);
  const destinations = useMemo(() => byDestination(rows, lang), [rows, lang]);
  const top = useMemo(() => topParts(rows, partName, lang, 5), [rows, partName, lang]);
  const topAll = useMemo(() => topParts(rows, partName, lang, 9999), [rows, partName, lang]);

  // EVERY part in the catalogue, ranked — including the ones that consumed
  // nothing this period. "Top 5" answers what moved; this answers what did
  // NOT, which is the question a zero row exists to answer. Ties break on
  // name so the two orderings are stable rather than arbitrary.
  const allPartsRanked = useMemo(() => {
    const consumed = new Map(topAll.byValue.map((b) => [b.key, b]));
    const all: Bucket[] = parts.map(
      (p) => consumed.get(p.id) ?? { key: p.id, label: arText(p.name, p.name_ar, lang), qty: 0, valueSar: 0 },
    );
    return {
      byValue: [...all].sort((a, b) => b.valueSar - a.valueSar || a.label.localeCompare(b.label)),
      byQty: [...all].sort((a, b) => b.qty - a.qty || a.label.localeCompare(b.label)),
    };
  }, [topAll, parts, lang]);
  const truckRows = useMemo(() => byTruck(rows, plateOf, lang), [rows, plateOf, lang]);

  // The trend charts are a HISTORY — they ignore the period picker on purpose,
  // and they run on a FIXED rolling window (12 months / 8 quarters / 5 years)
  // so an empty stretch stays on the axis instead of disappearing from it.
  const series = useMemo(() => {
    const keys = timelineKeys(trend, new Date());
    return seriesOn(pool, trend, keys);
  }, [pool, trend]);
  const trendLine = useMemo(() => movingAverage(series), [series]);

  // The paired value/quantity chart is always MONTHLY over the last 12 months,
  // whatever the combined chart's own toggle is set to.
  const monthlySeries = useMemo(
    () => seriesOn(pool, "month", timelineKeys("month", new Date())),
    [pool],
  );

  // Outstanding is current state, never period-scoped.
  const outstanding = useMemo(
    () => outstandingReturnable({ permits, permitLines, destinationLabel }),
    [permits, permitLines, destinationLabel],
  );
  const outstandingTotal = useMemo(() => {
    // todayKey(), NOT toISOString().slice(0,10). expectedReturnOn is a DATE
    // column already in local calendar terms, so comparing it against a UTC
    // slice compares two different clocks: for the first three hours after
    // Riyadh midnight the slice still reads yesterday, and a part that became
    // overdue at midnight is not counted until 03:00.
    const todayIso = todayKey();
    return outstanding.reduce(
      (a, r) => ({
        qty: a.qty + r.qty,
        valueSar: a.valueSar + r.valueSar,
        overdue: a.overdue + (r.expectedReturnOn && r.expectedReturnOn < todayIso ? 1 : 0),
      }),
      { qty: 0, valueSar: 0, overdue: 0 },
    );
  }, [outstanding]);

  // The weekly summary is weekly whatever the picker says, and it reads the
  // UNFILTERED pool — a narrative about "the company's consumption" that
  // silently obeyed a source filter would be misleading.
  const weekly = useMemo(
    () => weeklySummary(allRows, new Date(), partName, plateOf, lang, outstandingTotal),
    [allRows, partName, plateOf, lang, outstandingTotal],
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

  // "Showing X against Y", with X emphasised. The dictionary owns the whole
  // sentence and the tab splits it on `{cur}`: the head is whatever comes
  // before the emphasised label, the tail carries `{prev}`. The key's own
  // comment pins `{cur}` before `{prev}` in every language so this holds.
  //
  // The `= ""` default is NOT decoration. `split()` is typed `string[]` and
  // `noUncheckedIndexedAccess` is off, so `showingTail` is typed `string` while
  // being `undefined` at runtime for any leaf that lost its `{cur}` — a lie the
  // compiler will not catch. The default settles it once, here, instead of a
  // `?? ""` in the middle of the JSX.
  const [showingHead, showingTail = ""] = t("consumption.partsUsage.showingAgainst", lang).split("{cur}");

  if (allRows.length === 0) {
    return (
      <Card>
        <div className="p-10 text-center">
          <PackageMinus className="h-6 w-6 mx-auto mb-2 opacity-40" />
          <p className="text-sm muted">{t("consumption.partsUsage.emptyTitle", lang)}</p>
          <p className="text-xs muted mt-1">
            {t("consumption.partsUsage.emptyHint", lang)}
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* ---- The global period picker ----
           The "showing X against Y" line sits UNDER the buttons, not beside
           them: inline it competed with the tab row above it and pushed the
           last button around as the label's width changed with the period. */}
      <div className="space-y-1.5">
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
              {t(PERIOD_LABELS[k], lang)}
            </button>
          ))}
        </div>
        <p className="text-[11px] muted">
          {showingHead}<span className="font-medium">{win.label}</span>{showingTail.replace("{prev}", () => win.prevLabel)}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <PairKpi
          lang={lang}
          label={t("consumption.partsUsage.kpiConsumed", lang)}
          valueSar={grand.valueSar} qty={grand.qty}
          prevValue={grandPrev.valueSar} prevQty={grandPrev.qty}
          icon={<PackageMinus className="h-4 w-4" />}
        />
        <PairKpi
          lang={lang}
          label={t("consumption.usage.sourceMaintenance", lang)}
          valueSar={sources.find((s) => s.key === "maintenance")?.valueSar ?? 0}
          qty={sources.find((s) => s.key === "maintenance")?.qty ?? 0}
          prevValue={sourcesPrev.find((s) => s.key === "maintenance")?.valueSar ?? 0}
          prevQty={sourcesPrev.find((s) => s.key === "maintenance")?.qty ?? 0}
          icon={<Wrench className="h-4 w-4" />}
        />
        <PairKpi
          lang={lang}
          label={t("consumption.usage.sourceExitPermits", lang)}
          valueSar={sources.find((s) => s.key === "exit_permit")?.valueSar ?? 0}
          qty={sources.find((s) => s.key === "exit_permit")?.qty ?? 0}
          prevValue={sourcesPrev.find((s) => s.key === "exit_permit")?.valueSar ?? 0}
          prevQty={sourcesPrev.find((s) => s.key === "exit_permit")?.qty ?? 0}
          icon={<DoorOpen className="h-4 w-4" />}
        />
        <PairKpi
          lang={lang}
          label={t("consumption.partsUsage.kpiOutNotBack", lang)}
          valueSar={outstandingTotal.valueSar} qty={outstandingTotal.qty}
          icon={<Clock className="h-4 w-4" />}
          tone={outstandingTotal.qty > 0 ? "warn" : undefined}
          note={t("consumption.partsUsage.kpiOutNote", lang)}
        />
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {([
          ["all", "consumption.partsUsage.srcAll"],
          ["maintenance", "consumption.partsUsage.srcMaintenance"],
          ["exit_permit", "consumption.partsUsage.srcExitPermits"],
        ] as const).map(([k, labelKey]) => (
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
            {t(labelKey, lang)}
          </button>
        ))}
        <span className="ms-auto text-[11px] muted">
          {t("consumption.partsUsage.fifoNote", lang)}
        </span>
      </div>

      {/* ---- 2) Combined consumption: bars + trend line, own toggle ---- */}
      <Card className="!p-0 overflow-hidden">
        <div className="px-4 pt-4 pb-2 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold">{t("consumption.partsUsage.trendTitle", lang)}</h3>
            <p className="text-[11px] muted">
              {t("consumption.partsUsage.trendHint", lang)}
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
                {t(TREND_LABELS[k], lang)}
              </button>
            ))}
          </div>
        </div>
        <div className="p-4 pt-0">
          <ComboChart series={series} trend={trendLine} lang={lang} />
        </div>
      </Card>

      {/* ---- Monthly trend: value AND quantity, always the last 12 months ---- */}
      <Card className="!p-0 overflow-hidden">
        <SectionHead
          title={t("consumption.partsUsage.monthlyTitle", lang)}
          hint={t("consumption.partsUsage.monthlyHint", lang)}
        />
        <div className="p-4 pt-0">
          <PairedTrendChart series={monthlySeries} lang={lang} />
        </div>
      </Card>

      {/* ---- 3) Weekly feedback summary ---- */}
      <Card className="!p-0 overflow-hidden">
        <SectionHead
          title={t("consumption.partsUsage.weekTitle", lang)}
          hint={t("consumption.partsUsage.weekHint", lang).replace("{w}", () => weekly.window.label)}
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
          title={t("consumption.partsUsage.trucksTitle", lang)}
          hint={t("consumption.partsUsage.trucksHint", lang)}
          action={truckRows.length > 0
            ? <button onClick={() => setModal("trucks")} className="text-xs text-brand-600 dark:text-brand-300 font-medium hover:underline">{t("consumption.partsUsage.viewAllTrucks", lang)}</button>
            : undefined}
        />
        <TruckTable rows={truckRows.slice(0, 5)} lang={lang} />
      </Card>

      {/* ---- 5) Parts consumption: two lists side by side ----
           Two SEPARATE cards rather than one card split by a rule. The single
           box with an internal divider read as a table that had been cut in
           half; the gap between two cards is the separator, and each list
           gets its own header and its own full-list link. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="!p-0 overflow-hidden">
          <SectionHead
            title={t("consumption.partsUsage.topValueTitle", lang)}
            hint={t("consumption.partsUsage.topValueHint", lang)}
            action={
              <button onClick={() => setModal("value")} className="text-xs text-brand-600 dark:text-brand-300 font-medium hover:underline">
                {t("consumption.partsUsage.viewAllParts", lang)}
              </button>
            }
          />
          <TopPartsTable buckets={top.byValue} highlight="value" lang={lang} />
        </Card>
        <Card className="!p-0 overflow-hidden">
          <SectionHead
            title={t("consumption.partsUsage.topQtyTitle", lang)}
            hint={t("consumption.partsUsage.topQtyHint", lang)}
            action={
              <button onClick={() => setModal("qty")} className="text-xs text-brand-600 dark:text-brand-300 font-medium hover:underline">
                {t("consumption.partsUsage.viewAllParts", lang)}
              </button>
            }
          />
          <TopPartsTable buckets={top.byQty} highlight="qty" lang={lang} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="!p-0 overflow-hidden">
          <SectionHead title={t("consumption.partsUsage.splitTitle", lang)} hint={t("consumption.partsUsage.splitHint", lang)} />
          <div className="p-4"><SplitBars buckets={sources} emptyText={t("consumption.partsUsage.nothingConsumed", lang)} lang={lang} /></div>
        </Card>

        <Card className="!p-0 overflow-hidden">
          <SectionHead title={t("consumption.partsUsage.warehouseTitle", lang)} hint={t("consumption.partsUsage.warehouseHint", lang)} />
          <div className="p-4"><SplitBars buckets={warehouseBuckets} emptyText={t("consumption.partsUsage.warehouseEmpty", lang)} lang={lang} /></div>
        </Card>

        <Card className="!p-0 overflow-hidden">
          <SectionHead title={t("consumption.partsUsage.destTitle", lang)} hint={t("consumption.partsUsage.destHint", lang)} />
          <div className="p-4"><SplitBars buckets={destinations} emptyText={t("consumption.partsUsage.destEmpty", lang)} lang={lang} /></div>
        </Card>

        <Card className="!p-0 overflow-hidden">
          <SectionHead title={t("consumption.partsUsage.outTitle", lang)} hint={t("consumption.partsUsage.outHint", lang)} />
          {outstanding.length === 0 ? (
            <p className="p-4 text-sm muted">{t("consumption.partsUsage.outEmpty", lang)}</p>
          ) : (
            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>{t("consumption.shared.permit", lang)}</TH>
                  <TH>{t("consumption.shared.destination", lang)}</TH>
                  <TH>{t("consumption.partsUsage.colDueBack", lang)}</TH>
                  <TH>{t("common.qty", lang)}</TH>
                  <TH>{t("consumption.shared.value", lang)}</TH>
                </tr>
              </thead>
              <tbody>
                {outstanding.map((r) => (
                  <tr key={r.permitId}>
                    <TD><span className="font-mono text-xs font-medium">{r.reference}</span></TD>
                    <TD className="text-xs">{r.destination}</TD>
                    <TD className="text-xs muted">
                      {r.expectedReturnOn
                        ? formatDate(r.expectedReturnOn + "T00:00:00")
                        : "—"}
                    </TD>
                    <TD className="text-xs tabular-nums font-medium">{formatNum(r.qty, 2)}</TD>
                    <TD className="text-xs tabular-nums font-medium">{formatSar(r.valueSar)}</TD>
                  </tr>
                ))}
                <tr>
                  <TD className="text-xs font-semibold">{t("consumption.shared.total", lang)}</TD>
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
          title={t("consumption.partsUsage.recordsTitle", lang)}
          hint={t("consumption.partsUsage.recordsHint", lang)}
        />
        {maintenanceRecords.length === 0 ? (
          <p className="p-4 text-sm muted">{t("consumption.partsUsage.recordsEmpty", lang)}</p>
        ) : (
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>{t("consumption.partsUsage.colWorkOrder", lang)}</TH>
                <TH>{t("consumption.partsUsage.colJob", lang)}</TH>
                <TH>{t("consumption.partsUsage.colClosed", lang)}</TH>
                <TH>{t("common.part", lang)}</TH>
                <TH>{t("common.qty", lang)}</TH>
                <TH>{t("consumption.partsUsage.colUnitCost", lang)}</TH>
                <TH>{t("consumption.shared.value", lang)}</TH>
              </tr>
            </thead>
            <tbody>
              {maintenanceRecords.map(({ wo, rows: woRows }) =>
                woRows.map((r, i) => {
                  const part = partsById.get(r.partId);
                  // The tooltip and the clamped line show the SAME string, so
                  // the Arabic title is resolved once rather than twice.
                  const woTitle = arText(wo.title, wo.title_ar, lang);
                  return (
                    <tr key={r.key}>
                      <TD className="align-top">
                        {i === 0 && <span className="font-mono text-xs font-medium">{wo.wo_number}</span>}
                      </TD>
                      <TD className="align-top whitespace-normal max-w-[220px]">
                        {i === 0 && <span className="text-xs line-clamp-2" title={woTitle}>{woTitle}</span>}
                      </TD>
                      <TD className="align-top text-xs muted">
                        {i === 0 && (wo.closed_at ? formatDate(wo.closed_at) : "—")}
                      </TD>
                      <TD>
                        <span className="text-sm">
                          {part ? arText(part.name, part.name_ar, lang) : t("consumption.usage.unknownPart", lang)}
                        </span>
                        <div className="text-[11px] muted">
                          {part?.sku}{part?.unit ? ` · ${part.unit}` : ""}
                          {r.stamped === "line" && (
                            <span className="ms-1 text-amber-600 dark:text-amber-400">{t("consumption.partsUsage.preLedgerTag", lang)}</span>
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
            {t(`consumption.partsUsage.preLedgerBanner.${plural(preLedgerCount)}`, lang)
              .replace("{n}", () => String(preLedgerCount))}
          </span>
        </div>
      )}

      {modal === "trucks" && (
        <ListModal title={t("consumption.partsUsage.modalTrucksTitle", lang)} subtitle={win.label} onClose={() => setModal(null)} lang={lang}>
          <TruckTable rows={truckRows} lang={lang} />
        </ListModal>
      )}
      {modal === "value" && (
        <ListModal
          title={t("consumption.partsUsage.modalValueTitle", lang)}
          subtitle={t("consumption.partsUsage.modalAllPartsSubtitle", lang).replace("{w}", () => win.label)}
          onClose={() => setModal(null)}
          lang={lang}
        >
          <TopPartsTable buckets={allPartsRanked.byValue} highlight="value" showZero lang={lang} />
        </ListModal>
      )}
      {modal === "qty" && (
        <ListModal
          title={t("consumption.partsUsage.modalQtyTitle", lang)}
          subtitle={t("consumption.partsUsage.modalAllPartsSubtitle", lang).replace("{w}", () => win.label)}
          onClose={() => setModal(null)}
          lang={lang}
        >
          <TopPartsTable buckets={allPartsRanked.byQty} highlight="qty" showZero lang={lang} />
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

/**
 * "12.00 units" — the COUNTED unit string, four call sites (the KPI tile, the
 * split bars, and two chart tooltips). One helper rather than four inline
 * lookups so the bucket rule and the two-decimal format cannot drift apart.
 *
 * `plural()` truncates, so a fractional quantity buckets on its whole part —
 * 12.50 counts as twelve. The formatted numeral is what is substituted, so the
 * ".50" still reaches the screen.
 */
function unitsLabel(qty: number, lang: Lang): string {
  return t(`consumption.partsUsage.units.${plural(qty)}`, lang)
    .replace("{n}", () => formatNum(qty, 2));
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
  label, valueSar, qty, prevValue, prevQty, icon, tone, note, lang,
}: {
  label: string; valueSar: number; qty: number;
  prevValue?: number; prevQty?: number;
  icon: React.ReactNode; tone?: "warn"; note?: string; lang: Lang;
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
        <span className="text-xs muted tabular-nums">{unitsLabel(qty, lang)}</span>
        {dQ !== null && <Delta pct={dQ} small />}
      </div>
      {dV !== null && <div className="mt-1"><Delta pct={dV} label={t("consumption.partsUsage.deltaInValue", lang)} /></div>}
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
// ---------------------------------------------------------------------------
// CHART FRAME — one axis system, shared by both charts below.
//
// Real axes, because a bar with no scale beside it is decoration. Y ticks with
// gridlines on the left, an X axis line under the bars, and a fixed timeline
// so an empty month reads as an empty month instead of vanishing from the
// axis entirely.
// ---------------------------------------------------------------------------
const PLOT_H = 190;
const GUTTER = 52;   // room for the Y labels
const RIGHT = 46;    // room for a second Y axis when there is one

/** Round a max up to something a human would label an axis with. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1_000) return `${(n / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return formatNum(n, 0);
}

const TICKS = 4;

function ChartFrame({
  series, leftMax, rightMax, leftUnit, rightUnit, children,
}: {
  series: Bucket[];
  leftMax: number;
  rightMax?: number;
  leftUnit: string;
  rightUnit?: string;
  /** Rendered inside the plot area, which is `relative`. */
  children: React.ReactNode;
}) {
  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => i / TICKS);
  return (
    // pt-2 so the topmost tick label, which is centred ON the top gridline,
    // is not sliced in half by the card edge.
    <div className="overflow-x-auto pt-2">
      <div style={{ minWidth: Math.max(series.length * 46 + GUTTER + RIGHT, 320) }}>
        <div className="flex">
          {/* Y axis — left */}
          <div className="shrink-0 relative" style={{ width: GUTTER, height: PLOT_H }}>
            {ticks.map((t) => (
              <div key={t} className="absolute end-1 -translate-y-1/2 text-[10px] muted tabular-nums"
                style={{ top: `${(1 - t) * 100}%` }}>
                {compact(leftMax * t)}
              </div>
            ))}
          </div>

          {/* Plot */}
          <div className="flex-1 relative border-s border-b"
            style={{ height: PLOT_H, borderColor: "rgb(var(--border))" }}>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t"
                style={{
                  top: `${(1 - t) * 100}%`,
                  borderColor: "rgb(var(--border))",
                  opacity: t === 0 ? 0 : 0.45,
                }}
              />
            ))}
            {children}
          </div>

          {/* Y axis — right, only when a second scale exists */}
          {rightMax !== undefined && (
            <div className="shrink-0 relative" style={{ width: RIGHT, height: PLOT_H }}>
              {ticks.map((t) => (
                <div key={t} className="absolute start-1 -translate-y-1/2 text-[10px] tabular-nums text-emerald-600 dark:text-emerald-400"
                  style={{ top: `${(1 - t) * 100}%` }}>
                  {compact(rightMax * t)}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* X axis labels, aligned to the plot area */}
        <div className="flex">
          <div className="shrink-0" style={{ width: GUTTER }} />
          <div className="flex-1 flex">
            {series.map((b) => (
              <div key={b.key} className="flex-1 text-center pt-1">
                <div className="text-[10px] muted whitespace-nowrap">{b.label}</div>
              </div>
            ))}
          </div>
          {rightMax !== undefined && <div className="shrink-0" style={{ width: RIGHT }} />}
        </div>

        <div className="flex">
          <div className="shrink-0 text-[10px] muted text-end pe-1" style={{ width: GUTTER }}>{leftUnit}</div>
          <div className="flex-1" />
          {rightUnit && (
            <div className="shrink-0 text-[10px] text-emerald-600 dark:text-emerald-400 ps-1" style={{ width: RIGHT }}>
              {rightUnit}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * TOTAL CONSUMPTION — one bar per bucket plus the moving-average line.
 *
 * Bars are HTML and only the line is SVG. A pure-SVG chart stretched to its
 * container needs preserveAspectRatio="none", which balloons bars at low
 * bucket counts and turns every dot into an ellipse; flex bars stay a sane
 * width at any count and the polyline survives the same stretch via
 * vector-effect.
 */
function ComboChart({ series, trend, lang }: { series: Bucket[]; trend: number[]; lang: Lang }) {
  if (series.length === 0) return <p className="text-sm muted">{t("consumption.partsUsage.chartEmpty", lang)}</p>;
  const max = niceMax(Math.max(...series.map((b) => b.valueSar), ...trend, 1));

  return (
    <div className="space-y-2">
      <ChartFrame series={series} leftMax={max} leftUnit="SAR">
        <div className="absolute inset-0 flex items-end">
          {series.map((b) => (
            <div key={b.key} className="flex-1 flex justify-center items-end h-full px-[3px]">
              <div
                className="w-full max-w-[26px] rounded-t bg-brand-500/70"
                style={{ height: `${(b.valueSar / max) * 100}%` }}
                title={t("consumption.partsUsage.tipValueQty", lang)
                  .replace("{l}", () => b.label)
                  .replace("{v}", () => formatSar(b.valueSar))
                  .replace("{q}", () => unitsLabel(b.qty, lang))}
              />
            </div>
          ))}
        </div>
        {/*
          THE BARS FOLLOW `dir`; THE POLYLINE DOES NOT. Bars and x-axis labels
          are flex rows, so RTL reverses them for free and the oldest bucket
          lands on the right. SVG geometry has no such rule — `dir` never
          reaches a viewBox — so the line went on drawing oldest-at-x=0 and ran
          backwards against its own bars in Arabic. Mirroring x is the fix.

          This is the ONLY chart on the route drawn in SVG coordinates, which is
          exactly why it is the only one that read the wrong way: every other
          consumption chart is HTML flex and was already RTL-correct.

          Mirror about the viewBox width (`series.length`), not `trend.length` —
          the viewBox is what the coordinates are expressed in, and reading the
          bound off the other array would only be right by coincidence.
        */}
        <svg viewBox={`0 0 ${series.length} 100`} preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none">
          <polyline
            points={trend
              .map((v, i) => {
                const x = lang === "ar" ? series.length - 0.5 - i : i + 0.5;
                return `${x},${100 - (v / max) * 100}`;
              })
              .join(" ")}
            fill="none" className="stroke-amber-500" strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
          />
        </svg>
      </ChartFrame>
      <div className="flex items-center gap-4 text-[11px] muted ps-[52px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-500/70" />{t("consumption.partsUsage.legendTotal", lang)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-amber-500" />{t("consumption.partsUsage.legendTrend", lang)}
        </span>
      </div>
    </div>
  );
}

/**
 * MONTHLY TREND — value AND quantity, two bars per bucket, on their own
 * scales with their own axes. SAR and units share no axis, and forcing them
 * onto one would flatten whichever is smaller into nothing.
 */
function PairedTrendChart({ series, lang }: { series: Bucket[]; lang: Lang }) {
  if (series.length === 0) return <p className="text-sm muted">{t("consumption.partsUsage.chartEmpty", lang)}</p>;
  const maxV = niceMax(Math.max(...series.map((b) => b.valueSar), 1));
  const maxQ = niceMax(Math.max(...series.map((b) => b.qty), 1));

  return (
    <div className="space-y-2">
      <ChartFrame series={series} leftMax={maxV} rightMax={maxQ} leftUnit="SAR" rightUnit={t("consumption.partsUsage.axisUnits", lang)}>
        <div className="absolute inset-0 flex items-end">
          {series.map((b) => (
            <div key={b.key} className="flex-1 flex justify-center items-end gap-[2px] h-full px-[3px]">
              <div
                className="w-full max-w-[12px] rounded-t bg-brand-500/70"
                style={{ height: `${(b.valueSar / maxV) * 100}%` }}
                title={t("consumption.partsUsage.tipValue", lang)
                  .replace("{l}", () => b.label)
                  .replace("{v}", () => formatSar(b.valueSar))}
              />
              <div
                className="w-full max-w-[12px] rounded-t bg-emerald-500/70"
                style={{ height: `${(b.qty / maxQ) * 100}%` }}
                title={t("consumption.partsUsage.tipQty", lang)
                  .replace("{l}", () => b.label)
                  .replace("{q}", () => unitsLabel(b.qty, lang))}
              />
            </div>
          ))}
        </div>
      </ChartFrame>
      <div className="flex items-center gap-4 text-[11px] muted ps-[52px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-500/70" />{t("consumption.partsUsage.legendValue", lang)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/70" />{t("consumption.partsUsage.legendQty", lang)}
        </span>
      </div>
    </div>
  );
}

function TruckTable({ rows, lang }: { rows: TruckUsage[]; lang: Lang }) {
  if (rows.length === 0) {
    return <p className="p-4 text-sm muted">{t("consumption.partsUsage.truckEmpty", lang)}</p>;
  }
  return (
    <Table>
      <thead style={{ background: "rgba(0,0,0,0.02)" }}>
        <tr>
          <TH>{t("common.truck", lang)}</TH>
          <TH>{t("consumption.partsUsage.colVisits", lang)}</TH>
          <TH>{t("common.qty", lang)}</TH>
          <TH>{t("consumption.partsUsage.colTruckValue", lang)}</TH>
        </tr>
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

function SplitBars({ buckets, emptyText, lang }: { buckets: Bucket[]; emptyText: string; lang: Lang }) {
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
              <span className="muted"> · {unitsLabel(b.qty, lang)}</span>
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
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-500/70" />{t("consumption.partsUsage.legendValue", lang)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/60" />{t("consumption.partsUsage.legendQty", lang)}
        </span>
      </div>
    </div>
  );
}

function TopPartsTable({
  buckets, highlight, showZero, lang,
}: { buckets: Bucket[]; highlight: "value" | "qty"; showZero?: boolean; lang: Lang }) {
  if (buckets.length === 0) return <p className="p-4 text-sm muted">{t("consumption.partsUsage.nothingConsumed", lang)}</p>;
  return (
    <Table>
      <thead style={{ background: "rgba(0,0,0,0.02)" }}>
        <tr>
          <TH>{t("common.part", lang)}</TH>
          <TH>{t("common.qty", lang)}</TH>
          <TH>{t("consumption.shared.value", lang)}</TH>
        </tr>
      </thead>
      <tbody>
        {buckets.map((b) => {
          // A part that consumed nothing is greyed rather than hidden — the
          // whole point of the full list is that it shows the quiet ones.
          const idle = showZero && b.qty === 0 && b.valueSar === 0;
          return (
            <tr key={b.key} className={cn(idle && "opacity-55")}>
              <TD className="whitespace-normal max-w-[240px]">
                <span className="text-sm line-clamp-1" title={b.label}>{b.label}</span>
                {idle && <span className="ms-1.5 text-[10px] muted">{t("consumption.partsUsage.notUsed", lang)}</span>}
              </TD>
              <TD className={cn("text-xs tabular-nums", highlight === "qty" && !idle && "font-semibold")}>
                {formatNum(b.qty, 2)}
              </TD>
              <TD className={cn("text-xs tabular-nums", highlight === "value" && !idle && "font-semibold")}>
                {formatSar(b.valueSar)}
              </TD>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function ListModal({
  title, subtitle, onClose, children, lang,
}: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode; lang: Lang }) {
  // Portal only after mount — same guard as every other modal in this app.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto" onClick={onClose}>
      <ScrollLock />
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
          <Btn variant="outline" onClick={onClose}>{t("consumption.shared.close", lang)}</Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}
