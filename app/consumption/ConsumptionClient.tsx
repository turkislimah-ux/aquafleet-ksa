"use client";

// Consumption — the page shell + the EXIT PERMITS tab (Phase 1).
//
// Modals live in ExitPermitModals.tsx (a leaf: it imports lib/ and
// components/ only, never back from here) — the one-way edge that the
// Phase-4 import-cycle incident made a standing rule.
//
// DERIVED, NEVER STORED: overdue and outstanding come from
// lib/exit-permits.ts at render. The only stored state is `status`, because
// "stock actually left" is an event, not something computable from other
// columns.

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Pencil, Trash2, ChevronDown, ChevronRight, Printer, Undo2, Ban,
  RotateCcw, AlertTriangle, FileText, Paperclip,
} from "lucide-react";
import { PageHeader, Card, Btn, Table, TH, TD } from "@/components/ui";
import { cn, formatSar } from "@/lib/utils";
import {
  outstandingQty, permitOutstanding, permitValueSar, isOverdue, daysOverdue,
  lineUnitCost, EXIT_PERMIT_STATUS_PILL, type LotLite, type ConsumptionLedgerRow,
} from "@/lib/exit-permits";
import {
  EXIT_PERMIT_KIND_LABELS, EXIT_PERMIT_DESTINATION_LABELS,
  type ExitPermit, type ExitPermitLine, type ExitPermitReturn,
  type ExitPermitReturnLine, type ExitPermitFile,
  type ConsumptionApproval, type WorkOrder, type WorkOrderPart,
  type OutsourcedJob, type WorkshopPayment,
} from "@/lib/db-types";
import { deleteExitPermitDraft, getExitPermitFileUrls } from "./actions";
import {
  PermitFormModal, ConfirmExitModal, ReturnModal, VoidModal, PermitPrintView,
} from "./ExitPermitModals";
import ApprovalsTab from "./ApprovalsTab";
import PartsUsageTab from "./PartsUsageTab";
import type { WoLedgerRow } from "@/lib/parts-usage";

export type WarehouseLite = { id: string; name: string };
export type NamedLite = { id: string; name: string };
export type TruckLite = { id: string; plate: string };
export type StaffLite = { id: string; name: string };
export type PartLite = {
  id: string; name: string; sku: string; unit: string | null;
  warehouse_id: string; qty_on_hand: number;
};

// THREE tabs. "Reports" used to sit here and has been removed: Reports is a
// separate top-level page in the sidebar, and a second entry point with the
// same name inside Consumption only invited the question of which one was
// real. Nothing was built behind it.
type Tab = "usage" | "permits" | "approvals";

const TABS: { key: Tab; label: string }[] = [
  { key: "usage", label: "Parts Usage" },
  { key: "permits", label: "Exit Permits" },
  { key: "approvals", label: "Approvals" },
];

export default function ConsumptionClient({
  permits, lines, returns, returnLines, files,
  warehouses, parts, stations, projects, trucks, customers, staff,
  lots, ledger,
  approvals, workOrders, workOrderParts, outsourcedJobs, workshopPayments,
  repairers, jobRepairers, allParts, allTrucks, viewer, woLedger,
  today, error,
}: {
  permits: ExitPermit[];
  lines: ExitPermitLine[];
  returns: ExitPermitReturn[];
  returnLines: ExitPermitReturnLine[];
  files: ExitPermitFile[];
  warehouses: WarehouseLite[];
  parts: PartLite[];
  stations: NamedLite[];
  projects: NamedLite[];
  trucks: TruckLite[];
  customers: NamedLite[];
  staff: StaffLite[];
  lots: LotLite[];
  ledger: ConsumptionLedgerRow[];
  // --- Approvals tab (Phase 2) ---
  approvals: ConsumptionApproval[];
  workOrders: WorkOrder[];
  workOrderParts: WorkOrderPart[];
  outsourcedJobs: OutsourcedJob[];
  workshopPayments: WorkshopPayment[];
  repairers: NamedLite[];
  jobRepairers: { outsourced_job_id: string; repairer_id: string }[];
  // Unfiltered label lookups — history can reference a deactivated part or a
  // terminated truck, and it must still render its name.
  allParts: { id: string; name: string; sku: string; unit: string | null; warehouse_id: string }[];
  allTrucks: TruckLite[];
  // Signed-in user's email — the approvals tab compares it to decided_by.
  viewer: string | null;
  // The MAINTENANCE per-lot ledger, for Parts Usage.
  woLedger: WoLedgerRow[];
  today: string;
  error: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("permits");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "exited" | "voided" | "overdue">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  // THE FORM'S OPEN PERMIT.
  //
  // `"new"` means "no draft row exists yet". The moment one is created the
  // modal hands the real row back and this becomes that row — which is what
  // fixes three bugs at once: the modal keeps receiving its REAL lines (so a
  // freshly added line appears), the warehouse select locks once lines exist,
  // and nothing re-initialises the warehouse from warehouses[0] on a
  // re-render. Previously the modal owned the new id privately, so the parent
  // was stuck passing lines={[]} and permit={null} forever.
  const [formPermit, setFormPermit] = useState<ExitPermit | null | "new">(null);
  const [confirmPermit, setConfirmPermit] = useState<ExitPermit | null>(null);
  const [returnPermit, setReturnPermit] = useState<ExitPermit | null>(null);
  const [voidPermit, setVoidPermit] = useState<ExitPermit | null>(null);
  const [printPermit, setPrintPermit] = useState<ExitPermit | null>(null);

  const linesByPermit = useMemo(() => {
    const m = new Map<string, ExitPermitLine[]>();
    for (const l of lines) {
      const a = m.get(l.exit_permit_id) ?? [];
      a.push(l);
      m.set(l.exit_permit_id, a);
    }
    return m;
  }, [lines]);

  const returnsByPermit = useMemo(() => {
    const m = new Map<string, ExitPermitReturn[]>();
    for (const r of returns) {
      const a = m.get(r.exit_permit_id) ?? [];
      a.push(r);
      m.set(r.exit_permit_id, a);
    }
    return m;
  }, [returns]);

  const filesByPermit = useMemo(() => {
    const m = new Map<string, ExitPermitFile[]>();
    for (const f of files) {
      const a = m.get(f.exit_permit_id) ?? [];
      a.push(f);
      m.set(f.exit_permit_id, a);
    }
    return m;
  }, [files]);

  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const warehousesById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  // ONE destination resolver, so the list row, the detail and the printable
  // permit can never describe the same permit differently.
  const destinationLabel = useMemo(() => {
    const st = new Map(stations.map((s) => [s.id, s.name]));
    const pr = new Map(projects.map((p) => [p.id, p.name]));
    const tr = new Map(trucks.map((t) => [t.id, t.plate]));
    const cu = new Map(customers.map((c) => [c.id, c.name]));
    return (p: ExitPermit): string => {
      switch (p.destination_kind) {
        case "water_station": return st.get(p.destination_water_station_id ?? "") ?? "—";
        case "project": return pr.get(p.destination_project_id ?? "") ?? "—";
        case "truck": return tr.get(p.destination_truck_id ?? "") ?? "—";
        case "customer": return cu.get(p.destination_customer_id ?? "") ?? "—";
        default: return p.destination_other_text ?? "—";
      }
    };
  }, [stations, projects, trucks, customers]);

  const receiverLabel = useMemo(() => {
    const s = new Map(staff.map((x) => [x.id, x.name]));
    return (p: ExitPermit): string =>
      p.receiver_staff_id ? s.get(p.receiver_staff_id) ?? "—" : p.receiver_name ?? "—";
  }, [staff]);

  const repairerNameById = useMemo(
    () => new Map(repairers.map((r) => [r.id, r.name])),
    [repairers],
  );

  const jobRepairerIds = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const row of jobRepairers) {
      const a = m.get(row.outsourced_job_id) ?? [];
      a.push(row.repairer_id);
      m.set(row.outsourced_job_id, a);
    }
    return m;
  }, [jobRepairers]);

  const overdueIds = useMemo(() => {
    const set = new Set<string>();
    for (const p of permits) {
      if (isOverdue(p, linesByPermit.get(p.id) ?? [], today)) set.add(p.id);
    }
    return set;
  }, [permits, linesByPermit, today]);

  const visible = useMemo(() => {
    if (statusFilter === "all") return permits;
    if (statusFilter === "overdue") return permits.filter((p) => overdueIds.has(p.id));
    return permits.filter((p) => p.status === statusFilter);
  }, [permits, statusFilter, overdueIds]);

  const kpis = useMemo(() => {
    const exited = permits.filter((p) => p.status === "exited");
    const outstandingValue = exited.reduce(
      (n, p) => n + permitValueSar(linesByPermit.get(p.id) ?? []), 0,
    );
    return {
      drafts: permits.filter((p) => p.status === "draft").length,
      exited: exited.length,
      overdue: overdueIds.size,
      outstandingValue,
    };
  }, [permits, linesByPermit, overdueIds]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function onDeleteDraft(p: ExitPermit) {
    if (!confirm("Delete this draft permit? Nothing has left the warehouse, so nothing is reversed.")) return;
    const res = await deleteExitPermitDraft(p.id);
    if (res.error) { setActionError(res.error); return; }
    router.refresh();
  }

  async function openFile(path: string) {
    const res = await getExitPermitFileUrls([path]);
    if (res.error || !res.urls?.[path]) { setActionError(res.error ?? "Could not open file."); return; }
    window.open(res.urls[path], "_blank", "noopener,noreferrer");
  }

  function closeAll() {
    setFormPermit(null); setConfirmPermit(null);
    setReturnPermit(null); setVoidPermit(null);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Consumption"
        subtitle="Where parts go when they leave the shelf — usage, exit permits and reporting"
        actions={
          tab === "permits" ? (
            <Btn variant="primary" onClick={() => setFormPermit("new")}>
              <Plus className="h-4 w-4" />New Exit Permit
            </Btn>
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

      {(error || actionError) && (
        <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">
          {error ?? actionError}
        </div>
      )}

      {tab === "usage" ? (
        <PartsUsageTab
          workOrders={workOrders}
          workOrderParts={workOrderParts}
          woLedger={woLedger}
          permits={permits}
          permitLines={lines}
          epLedger={ledger.map((r) => ({
            exit_permit_line_id: r.exit_permit_line_id,
            direction: r.direction,
            qty: Number(r.qty),
            unit_price_sar: Number(r.unit_price_sar),
            created_at: r.created_at,
          }))}
          parts={allParts}
          warehouses={warehouses}
          trucks={allTrucks}
          // The SAME resolver every other tab uses, so one permit is never
          // described three different ways.
          destinationLabel={destinationLabel}
        />
      ) : tab === "approvals" ? (
        <ApprovalsTab
          permits={permits}
          permitLines={lines}
          workOrders={workOrders}
          workOrderParts={workOrderParts}
          outsourcedJobs={outsourcedJobs}
          workshopPayments={workshopPayments}
          repairerNameById={repairerNameById}
          jobRepairerIds={jobRepairerIds}
          approvals={approvals}
          partNames={allParts}
          trucks={allTrucks}
          viewer={viewer}
          // The SAME resolver the permits tab and the printable permit use, so
          // one permit can never be described three different ways.
          destinationLabel={destinationLabel}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Drafts" value={String(kpis.drafts)} />
            <Kpi label="Out on permit" value={String(kpis.exited)} />
            <Kpi
              label="Overdue returns"
              value={String(kpis.overdue)}
              tone={kpis.overdue > 0 ? "bad" : undefined}
            />
            <Kpi
              label="Value outstanding"
              value={formatSar(kpis.outstandingValue)}
              hint="FIFO cost of what is out and not yet back"
            />
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {([
              ["all", "All"], ["draft", "Drafts"], ["exited", "Out"],
              ["overdue", "Overdue"], ["voided", "Voided"],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setStatusFilter(k)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium transition border",
                  statusFilter === k
                    ? "bg-brand-500/10 border-brand-600 text-brand-700 dark:text-brand-300"
                    : "border-transparent muted hover:bg-black/5 dark:hover:bg-white/5",
                )}
              >
                {label}
                {k === "overdue" && kpis.overdue > 0 && (
                  <span className="ms-1.5 rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-300 px-1.5 py-0.5 text-[10px] font-semibold">
                    {kpis.overdue}
                  </span>
                )}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <Card>
              <div className="p-10 text-center">
                <p className="text-sm muted">No exit permits{statusFilter === "all" ? " yet" : " match this filter"}.</p>
                {statusFilter === "all" && (
                  <p className="text-xs muted mt-1">
                    A permit is the gate pass for parts leaving for a non-maintenance reason.
                  </p>
                )}
              </div>
            </Card>
          ) : (
            <Card className="!p-0 overflow-hidden">
              <Table>
                <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                  <tr>
                    <TH>{null}</TH>
                    <TH>Permit</TH>
                    <TH>Kind</TH>
                    <TH>Destination</TH>
                    <TH>Receiver</TH>
                    <TH>Warehouse</TH>
                    <TH>Items</TH>
                    <TH>Value out</TH>
                    <TH>Status</TH>
                    <TH>{null}</TH>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => {
                    const pl = linesByPermit.get(p.id) ?? [];
                    const pr = returnsByPermit.get(p.id) ?? [];
                    const pf = filesByPermit.get(p.id) ?? [];
                    const open = expanded.has(p.id);
                    const overdue = overdueIds.has(p.id);
                    const outstanding = permitOutstanding(pl);
                    return (
                      <Fragment key={p.id}>
                        <tr className={cn(overdue && "bg-rose-500/[0.06]")}>
                          <TD>
                            <button
                              onClick={() => toggle(p.id)}
                              className="h-7 w-7 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                              aria-label={open ? "Collapse" : "Expand"}
                            >
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </TD>
                          <TD>
                            <span className="font-mono text-xs font-medium">
                              {p.ep_number ?? <span className="muted">Draft</span>}
                            </span>
                            {pf.length > 0 && (
                              <span className="ms-1.5 inline-flex items-center gap-0.5 text-[10px] muted">
                                <Paperclip className="h-3 w-3" />{pf.length}
                              </span>
                            )}
                          </TD>
                          <TD className="text-xs">
                            {EXIT_PERMIT_KIND_LABELS[p.kind]}
                            {p.kind === "returnable" && p.expected_return_on && (
                              <div className={cn("text-[11px]", overdue ? "text-rose-600 dark:text-rose-400 font-medium" : "muted")}>
                                due {new Date(p.expected_return_on + "T00:00:00").toLocaleDateString()}
                              </div>
                            )}
                          </TD>
                          <TD className="text-xs">
                            {destinationLabel(p)}
                            <div className="text-[11px] muted">{EXIT_PERMIT_DESTINATION_LABELS[p.destination_kind]}</div>
                          </TD>
                          <TD className="text-xs">
                            {receiverLabel(p)}
                            {p.carrier_name && <div className="text-[11px] muted">via {p.carrier_name}</div>}
                          </TD>
                          <TD className="text-xs">{warehousesById.get(p.warehouse_id)?.name ?? "—"}</TD>
                          <TD className="text-xs tabular-nums">
                            {pl.length}
                            {p.status === "exited" && p.kind === "returnable" && (
                              <div className="text-[11px] muted">{outstanding} out</div>
                            )}
                          </TD>
                          <TD className="text-xs tabular-nums">
                            {p.status === "draft" ? <span className="muted">—</span> : formatSar(permitValueSar(pl))}
                          </TD>
                          <TD>
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", EXIT_PERMIT_STATUS_PILL[p.status])}>
                                {p.status === "draft" ? "Draft" : p.status === "exited" ? "Out" : "Voided"}
                              </span>
                              {overdue && p.expected_return_on && (
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20">
                                  <AlertTriangle className="h-3 w-3" />
                                  {daysOverdue(p.expected_return_on, today)}d overdue
                                </span>
                              )}
                            </div>
                          </TD>
                          <TD>
                            <div className="flex items-center gap-1 justify-end">
                              {p.status === "draft" && (
                                <>
                                  <Btn variant="primary" onClick={() => setConfirmPermit(p)}>Confirm exit</Btn>
                                  <button
                                    onClick={() => setFormPermit(p)}
                                    className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                                    title="Edit draft"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => onDeleteDraft(p)}
                                    className="h-8 w-8 rounded-lg grid place-items-center text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                                    title="Delete draft"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                              {p.status === "exited" && (
                                <>
                                  {p.kind === "returnable" && outstanding > 0 && (
                                    <Btn variant="outline" onClick={() => setReturnPermit(p)}>
                                      <Undo2 className="h-3.5 w-3.5" />Return
                                    </Btn>
                                  )}
                                  <button
                                    onClick={() => setVoidPermit(p)}
                                    className="h-8 w-8 rounded-lg grid place-items-center text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                                    title="Void permit"
                                  >
                                    <Ban className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                              {p.status !== "draft" && (
                                <button
                                  onClick={() => setPrintPermit(p)}
                                  className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                                  title="Printable permit"
                                >
                                  <Printer className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          </TD>
                        </tr>

                        {open && (
                          <tr>
                            <td colSpan={10} className="p-0 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                              <div className="p-4 bg-black/[0.015] dark:bg-white/[0.02] space-y-3">
                                <div className="text-[11px] font-semibold uppercase tracking-wide muted">Items</div>
                                {p.note && (
                                  <p className="text-sm rounded-lg px-3 py-2 bg-black/[0.03] dark:bg-white/[0.04]">
                                    {p.note}
                                  </p>
                                )}
                                <Table>
                                  <thead>
                                    <tr>
                                      <TH>Part</TH>
                                      {/* NOTE gets its own column beside the
                                          part, capped at roughly two lines —
                                          a long note should be readable at a
                                          glance without stretching the row
                                          into a paragraph. */}
                                      <TH>Note</TH>
                                      <TH>Qty out</TH>
                                      <TH>Returned</TH>
                                      <TH>Outstanding</TH>
                                      <TH>FIFO unit value</TH>
                                      <TH>Value</TH>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {pl.map((l) => {
                                      const part = partsById.get(l.part_id);
                                      const out = outstandingQty(l);
                                      return (
                                        <tr key={l.id}>
                                          <TD>
                                            <span className="text-sm font-medium">{part?.name ?? "Unknown part"}</span>
                                            <div className="text-[11px] muted">
                                              {part?.sku}{part?.unit ? ` · ${part.unit}` : ""}
                                            </div>
                                          </TD>
                                          <TD className="whitespace-normal align-top max-w-[260px]">
                                            {l.note
                                              ? <span className="text-[11px] muted line-clamp-2" title={l.note}>{l.note}</span>
                                              : <span className="text-[11px] muted">—</span>}
                                          </TD>
                                          <TD className="text-xs tabular-nums">{l.qty}</TD>
                                          <TD className="text-xs tabular-nums">{l.qty_returned || <span className="muted">—</span>}</TD>
                                          <TD className="text-xs tabular-nums font-medium">{out}</TD>
                                          <TD className="text-xs tabular-nums">
                                            {(() => {
                                              const u = lineUnitCost(p.status, l, lots);
                                              if (u === null) return <span className="muted" title="Not enough stock in lots to price this item">—</span>;
                                              return (
                                                <>
                                                  {formatSar(u)}
                                                  {p.status === "draft" && (
                                                    <span className="block text-[10px] muted">preview</span>
                                                  )}
                                                </>
                                              );
                                            })()}
                                          </TD>
                                          <TD className="text-xs tabular-nums">
                                            {(() => {
                                              const u = lineUnitCost(p.status, l, lots);
                                              const basis = p.status === "draft" ? Number(l.qty) : out;
                                              return u === null ? <span className="muted">—</span> : formatSar(basis * u);
                                            })()}
                                          </TD>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </Table>

                                {pr.length > 0 && (
                                  <>
                                    <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
                                      Returns ({pr.length})
                                    </div>
                                    <ul className="space-y-1">
                                      {pr.map((r) => {
                                        const rl = returnLines.filter((x) => x.exit_permit_return_id === r.id);
                                        return (
                                          <li key={r.id} className="text-xs rounded-lg border px-2.5 py-1.5" style={{ borderColor: "rgb(var(--border))" }}>
                                            <span className="font-medium">
                                              {new Date(r.returned_on + "T00:00:00").toLocaleDateString()}
                                            </span>
                                            {" — "}
                                            {rl.map((x) => {
                                              const line = pl.find((l) => l.id === x.exit_permit_line_id);
                                              const part = line ? partsById.get(line.part_id) : null;
                                              return `${x.qty} × ${part?.name ?? "?"}`;
                                            }).join(", ")}
                                            {r.note && <span className="muted"> · {r.note}</span>}
                                            {r.created_by && <span className="muted"> · {r.created_by}</span>}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </>
                                )}

                                {pf.length > 0 && (
                                  <>
                                    <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
                                      Attachments ({pf.length})
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      {pf.map((f) => (
                                        <button
                                          key={f.id}
                                          onClick={() => openFile(f.storage_path)}
                                          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/5 max-w-[220px]"
                                          style={{ borderColor: "rgb(var(--border))" }}
                                          title={f.file_name}
                                        >
                                          <FileText className="h-3.5 w-3.5 shrink-0 muted" />
                                          <span className="truncate">{f.file_name}</span>
                                        </button>
                                      ))}
                                    </div>
                                  </>
                                )}

                                {p.status === "voided" && (
                                  <div className="rounded-lg px-3 py-2 text-xs bg-rose-500/10 text-rose-700 dark:text-rose-300">
                                    <span className="inline-flex items-center gap-1 font-medium">
                                      <RotateCcw className="h-3.5 w-3.5" />Voided
                                    </span>
                                    {p.voided_at && ` on ${new Date(p.voided_at).toLocaleDateString()}`}
                                    {p.voided_by && ` by ${p.voided_by}`}
                                    {p.void_reason && ` — ${p.void_reason}`}
                                    <div className="mt-0.5">
                                      Only the outstanding quantity was restored; anything already
                                      returned had gone back with its own return event.
                                    </div>
                                  </div>
                                )}

                                <div className="text-[11px] muted">
                                  {p.issued_by && <>Issued by {p.issued_by}. </>}
                                  {p.exited_at && <>Exited {new Date(p.exited_at).toLocaleString()}{p.exited_by ? ` by ${p.exited_by}` : ""}. </>}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          )}
        </>
      )}

      {formPermit && (
        <PermitFormModal
          permit={formPermit === "new" ? null : formPermit}
          lines={formPermit === "new" ? [] : linesByPermit.get(formPermit.id) ?? []}
          files={formPermit === "new" ? [] : filesByPermit.get(formPermit.id) ?? []}
          lots={lots}
          // Called when a draft row first comes into existence. Adopting it
          // here is what keeps the popup's data live without closing it.
          onDraftCreated={(p) => { setFormPermit(p); router.refresh(); }}
          // Add/delete a line, attach a file: refresh the data, keep the
          // popup open. Only an explicit Close dismisses it.
          onRefresh={() => router.refresh()}
          warehouses={warehouses}
          parts={parts}
          stations={stations}
          projects={projects}
          trucks={trucks}
          customers={customers}
          staff={staff}
          onClose={closeAll}
        />
      )}

      {confirmPermit && (
        <ConfirmExitModal
          permit={confirmPermit}
          lines={linesByPermit.get(confirmPermit.id) ?? []}
          parts={parts}
          lots={lots}
          onClose={closeAll}
        />
      )}

      {returnPermit && (
        <ReturnModal
          permit={returnPermit}
          lines={linesByPermit.get(returnPermit.id) ?? []}
          parts={parts}
          ledger={ledger}
          today={today}
          onClose={closeAll}
        />
      )}

      {voidPermit && (
        <VoidModal
          permit={voidPermit}
          lines={linesByPermit.get(voidPermit.id) ?? []}
          parts={parts}
          onClose={closeAll}
        />
      )}

      {printPermit && (
        <PermitPrintView
          permit={printPermit}
          lines={linesByPermit.get(printPermit.id) ?? []}
          parts={parts}
          warehouseName={warehousesById.get(printPermit.warehouse_id)?.name ?? "—"}
          destination={destinationLabel(printPermit)}
          destinationKind={EXIT_PERMIT_DESTINATION_LABELS[printPermit.destination_kind]}
          receiver={receiverLabel(printPermit)}
          onClose={() => setPrintPermit(null)}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "bad" }) {
  return (
    <div className="card p-4">
      <div className="text-xs muted uppercase tracking-wide">{label}</div>
      <div className={cn("text-2xl font-semibold mt-1 tabular-nums", tone === "bad" && "text-rose-600 dark:text-rose-400")}>
        {value}
      </div>
      {hint && <div className="text-[11px] muted mt-0.5">{hint}</div>}
    </div>
  );
}
