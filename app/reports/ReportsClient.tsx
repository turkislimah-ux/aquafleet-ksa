"use client";

// Reports — the page shell.
//
// Two tabs: Overview (KPIs and charts) and Reports (printable statements).
// The tab bar is the same underline convention as Consumption/Trips/Inventory
// — one pattern for tabs across the app, not a new one per page.
//
// The global period picker lives HERE, not inside a tab, because both tabs
// answer questions about the same period and a picker that resets when you
// switch tabs would be its own small bug.

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  monthsDesc, monthLabel,
  type PnlRow, type CollectionsRow, type RevenueMonthRow, type ReceivableRow,
  type AgingRow, type PayrollRow, type OperationsRow, type RevenuePerTruckRow,
  type TopupsRow, type PurchasingRow, type MaintenancePerTruckRow,
} from "@/lib/reports";
import OverviewTab from "./OverviewTab";

type Tab = "overview" | "statements";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "statements", label: "Reports" },
];

export type ReportsClientProps = {
  error: string | null;
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
};

export default function ReportsClient(props: ReportsClientProps) {
  const [tab, setTab] = useState<Tab>("overview");

  const months = useMemo(() => monthsDesc(props.pnl), [props.pnl]);
  // Default to the newest month the spine knows about. The spine always runs
  // to the current month (0098), so this is "this month" in normal use and
  // still resolves to something real if the data ever stops short.
  const [month, setMonth] = useState<string | null>(months[0] ?? null);
  const active = month && months.includes(month) ? month : months[0] ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        subtitle="Revenue, cost and profit — every figure from one shared definition"
        actions={
          months.length > 0 ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="muted">Period</span>
              <select
                value={active ?? ""}
                onChange={(e) => setMonth(e.target.value)}
                className="px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
                style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
              >
                {months.map((m) => (
                  <option key={m} value={m}>{monthLabel(m)}</option>
                ))}
              </select>
            </label>
          ) : undefined
        }
      />

      <div className="flex items-center gap-1 border-b flex-wrap" style={{ borderColor: "rgb(var(--border))" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition",
              tab === t.key
                ? "border-brand-600 text-brand-600 dark:text-brand-300"
                : "border-transparent muted hover:text-[rgb(var(--fg))]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {props.error && (
        <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">
          {props.error}
        </div>
      )}

      {tab === "overview" ? (
        <OverviewTab {...props} months={months} month={active} />
      ) : (
        <div className="card p-8 text-center">
          <div className="text-sm font-medium">Printable statements</div>
          <p className="text-sm muted mt-1 max-w-md mx-auto">
            The management pack — P&amp;L, revenue and cost statements, receivables
            aging and operational performance — arrives in the next phase. It reads
            the same views this Overview does, so the two cannot disagree.
          </p>
        </div>
      )}
    </div>
  );
}
