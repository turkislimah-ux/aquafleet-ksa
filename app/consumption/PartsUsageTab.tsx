"use client";

// Consumption — the PARTS USAGE tab (Phase 3, the last one).
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

import { useMemo, useState } from "react";
import { PackageMinus, Wrench, DoorOpen, Clock, AlertTriangle } from "lucide-react";
import { Card, Table, TH, TD } from "@/components/ui";
import { cn, formatSar, formatNum } from "@/lib/utils";
import {
  buildUsageRows, totals, byMonth, bySource, byWarehouse, byDestination,
  topParts, outstandingReturnable,
  type UsageRow, type Bucket, type WoLedgerRow, type EpLedgerRow,
} from "@/lib/parts-usage";
import type {
  ExitPermit, ExitPermitLine, WorkOrder, WorkOrderPart,
} from "@/lib/db-types";

type PartLite = { id: string; name: string; sku: string; unit: string | null; warehouse_id: string };
type WarehouseLite = { id: string; name: string };

export default function PartsUsageTab({
  workOrders, workOrderParts, woLedger,
  permits, permitLines, epLedger,
  parts, warehouses, destinationLabel,
}: {
  workOrders: WorkOrder[];
  workOrderParts: WorkOrderPart[];
  woLedger: WoLedgerRow[];
  permits: ExitPermit[];
  permitLines: ExitPermitLine[];
  epLedger: EpLedgerRow[];
  parts: PartLite[];
  warehouses: WarehouseLite[];
  destinationLabel: (p: ExitPermit) => string;
}) {
  const [sourceFilter, setSourceFilter] = useState<"all" | "maintenance" | "exit_permit">("all");

  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const warehouseName = useMemo(() => {
    const m = new Map(warehouses.map((w) => [w.id, w.name]));
    return (id: string) => m.get(id) ?? null;
  }, [warehouses]);

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

  const rows = useMemo(
    () => (sourceFilter === "all" ? allRows : allRows.filter((r) => r.source === sourceFilter)),
    [allRows, sourceFilter],
  );

  const partName = (id: string) => {
    const p = partsById.get(id);
    return p ? p.name : null;
  };

  const grand = useMemo(() => totals(rows), [rows]);
  const months = useMemo(() => byMonth(rows), [rows]);
  const sources = useMemo(() => bySource(allRows), [allRows]);
  const warehouseBuckets = useMemo(() => byWarehouse(rows, warehouseName), [rows, warehouseName]);
  const destinations = useMemo(() => byDestination(allRows), [allRows]);
  const top = useMemo(() => topParts(rows, partName, 8), [rows, partsById]);
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

  // Maintenance records — COMPLETED work orders only, per the brief. The
  // analytics above deliberately count every DEDUCTED work order, including
  // ones still in progress, because that stock has already left the shelf.
  const maintenanceRecords = useMemo(() => {
    const completed = new Set(
      workOrders.filter((w) => w.status === "completed").map((w) => w.id),
    );
    const byWo = new Map<string, { wo: WorkOrder; rows: UsageRow[] }>();
    for (const r of allRows) {
      if (r.source !== "maintenance") continue;
      const wp = workOrderParts.find((x) => `wo:${x.id}` === r.key);
      if (!wp || !completed.has(wp.work_order_id)) continue;
      const wo = workOrders.find((w) => w.id === wp.work_order_id);
      if (!wo) continue;
      const entry = byWo.get(wo.id) ?? { wo, rows: [] };
      entry.rows.push(r);
      byWo.set(wo.id, entry);
    }
    return [...byWo.values()].sort((a, b) =>
      (b.wo.closed_at ?? "").localeCompare(a.wo.closed_at ?? ""));
  }, [allRows, workOrders, workOrderParts]);

  const preLedgerCount = useMemo(
    () => allRows.filter((r) => r.stamped === "line").length,
    [allRows],
  );

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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <PairKpi
          label="Consumed, all time"
          valueSar={grand.valueSar}
          qty={grand.qty}
          icon={<PackageMinus className="h-4 w-4" />}
        />
        <PairKpi
          label="Maintenance"
          valueSar={sources.find((s) => s.key === "maintenance")?.valueSar ?? 0}
          qty={sources.find((s) => s.key === "maintenance")?.qty ?? 0}
          icon={<Wrench className="h-4 w-4" />}
        />
        <PairKpi
          label="Exit permits"
          valueSar={sources.find((s) => s.key === "exit_permit")?.valueSar ?? 0}
          qty={sources.find((s) => s.key === "exit_permit")?.qty ?? 0}
          icon={<DoorOpen className="h-4 w-4" />}
        />
        <PairKpi
          label="Out and not back"
          valueSar={outstandingTotal.valueSar}
          qty={outstandingTotal.qty}
          icon={<Clock className="h-4 w-4" />}
          tone={outstandingTotal.qty > 0 ? "warn" : undefined}
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

      {/* ---- Consumption over time ---- */}
      <Card className="!p-0 overflow-hidden">
        <SectionHead
          title="Consumption over time"
          hint="Value and quantity of parts leaving stock, by month"
        />
        <div className="p-4">
          <MonthlyTrend months={months} />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ---- Maintenance vs exit permits ---- */}
        <Card className="!p-0 overflow-hidden">
          <SectionHead
            title="Maintenance vs exit permits"
            hint="Where consumption is going — repair draws against non-maintenance exits"
          />
          <div className="p-4">
            <SplitBars buckets={sources} emptyText="Nothing consumed yet." />
          </div>
        </Card>

        {/* ---- By warehouse ---- */}
        <Card className="!p-0 overflow-hidden">
          <SectionHead title="By warehouse" hint="Which stock room it came out of" />
          <div className="p-4">
            <SplitBars buckets={warehouseBuckets} emptyText="No warehouse data." />
          </div>
        </Card>

        {/* ---- By destination ---- */}
        <Card className="!p-0 overflow-hidden">
          <SectionHead
            title="By destination"
            hint="Exit permits only — maintenance has no destination"
          />
          <div className="p-4">
            <SplitBars buckets={destinations} emptyText="No exit permits have left yet." />
          </div>
        </Card>

        {/* ---- Currently out ---- */}
        <Card className="!p-0 overflow-hidden">
          <SectionHead
            title="Currently out and not back"
            hint="Returnable permits still holding stock"
          />
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
                  <TD>{null}</TD>
                  <TD>{null}</TD>
                  <TD className="text-xs tabular-nums font-semibold">{formatNum(outstandingTotal.qty, 2)}</TD>
                  <TD className="text-xs tabular-nums font-semibold">{formatSar(outstandingTotal.valueSar)}</TD>
                </tr>
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {/* ---- Top parts ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="!p-0 overflow-hidden">
          <SectionHead title="Top parts by value" hint="What consumption is costing most" />
          <TopPartsTable buckets={top.byValue} highlight="value" />
        </Card>
        <Card className="!p-0 overflow-hidden">
          <SectionHead title="Top parts by quantity" hint="What moves most often" />
          <TopPartsTable buckets={top.byQty} highlight="qty" />
        </Card>
      </div>

      {/* ---- Maintenance records ---- */}
      <Card className="!p-0 overflow-hidden">
        <SectionHead
          title="In-house maintenance consumption history"
          hint="Every part each completed work order drew from stock"
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
                      {/* One work order reads as one block: its number, job and
                          date are written once and its parts listed under
                          them, rather than repeated down every line. */}
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

      {/* THE PRE-LEDGER CAVEAT, said out loud rather than buried. These rows
          are real consumption with a real stamped cost, they simply predate
          the per-lot ledger, so a reader comparing this tab to the ledger
          tables directly should know why the numbers differ. */}
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
    </div>
  );
}

function SectionHead({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="px-4 pt-4 pb-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-[11px] muted">{hint}</p>
    </div>
  );
}

/** Value and quantity as equals — two figures, one card, neither subordinate. */
function PairKpi({
  label, valueSar, qty, icon, tone,
}: {
  label: string; valueSar: number; qty: number;
  icon: React.ReactNode; tone?: "warn";
}) {
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
      <div className="text-xs muted tabular-nums mt-0.5">{formatNum(qty, 2)} units</div>
    </div>
  );
}

/** Monthly trend. Two bars per month — value and quantity on their OWN
 *  scales, because SAR and units share no axis and pretending otherwise
 *  makes one of them look flat. */
function MonthlyTrend({ months }: { months: Bucket[] }) {
  if (months.length === 0) return <p className="text-sm muted">No consumption yet.</p>;
  const maxVal = Math.max(...months.map((m) => m.valueSar), 1);
  const maxQty = Math.max(...months.map((m) => m.qty), 1);

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2 overflow-x-auto pb-1" style={{ minHeight: 140 }}>
        {months.map((m) => (
          <div key={m.key} className="flex flex-col items-center gap-1 min-w-[52px] flex-1">
            <div className="flex items-end gap-1 h-[110px] w-full justify-center">
              <div
                className="w-4 rounded-t bg-brand-500/70"
                style={{ height: `${Math.max(2, (m.valueSar / maxVal) * 100)}%` }}
                title={`${formatSar(m.valueSar)} value`}
              />
              <div
                className="w-4 rounded-t bg-emerald-500/60"
                style={{ height: `${Math.max(2, (m.qty / maxQty) * 100)}%` }}
                title={`${formatNum(m.qty, 2)} units`}
              />
            </div>
            <div className="text-[10px] muted whitespace-nowrap">
              {new Date(m.key + "-01T00:00:00").toLocaleDateString(undefined, { month: "short", year: "2-digit" })}
            </div>
            <div className="text-[10px] tabular-nums text-center leading-tight">
              <div className="font-medium">{formatSar(m.valueSar)}</div>
              <div className="muted">{formatNum(m.qty, 2)}u</div>
            </div>
          </div>
        ))}
      </div>
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-4 text-[11px] muted">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-brand-500/70" />Value (SAR)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/60" />Quantity (units)
      </span>
    </div>
  );
}

/** A category list with both measures bar-charted on their own scales. */
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
      <Legend />
    </div>
  );
}

function TopPartsTable({ buckets, highlight }: { buckets: Bucket[]; highlight: "value" | "qty" }) {
  if (buckets.length === 0) return <p className="p-4 text-sm muted">Nothing consumed yet.</p>;
  return (
    <Table>
      <thead style={{ background: "rgba(0,0,0,0.02)" }}>
        <tr><TH>Part</TH><TH>Qty</TH><TH>Value</TH></tr>
      </thead>
      <tbody>
        {buckets.map((b) => (
          <tr key={b.key}>
            <TD className="whitespace-normal max-w-[260px]">
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
