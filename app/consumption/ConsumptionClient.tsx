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
import { useTabParam } from "@/lib/useTabParam";
import { useRecordFocus } from "@/lib/useRecordFocus";
import { useRouter } from "next/navigation";
import {
  Plus, Pencil, Trash2, ChevronDown, ChevronRight, Printer, Undo2, Ban,
  RotateCcw, AlertTriangle, FileText, FileMinus, Paperclip,
} from "lucide-react";
import { PageHeader, Card, Btn, Table, TH, TD } from "@/components/ui";
import { cn, formatDate, formatDateTime, formatSar } from "@/lib/utils";
import { useApp } from "@/components/AppShell";
import { t, arText, personName, type Lang, type TKey } from "@/lib/i18n";
import {
  permitLineOutstanding, permitOutstanding, permitValueSar, permitWrittenOff,
  isOverdue, daysOverdue,
  lineUnitCost, EXIT_PERMIT_STATUS_PILL, EXIT_PERMIT_KIND_TKEY,
  EXIT_PERMIT_DESTINATION_TKEY, type LotLite, type ConsumptionLedgerRow,
} from "@/lib/exit-permits";
import {
  type ExitPermit, type ExitPermitLine, type ExitPermitReturn,
  type ExitPermitReturnLine, type ExitPermitFile,
  type ExitPermitWriteOff, type ExitPermitWriteOffLine,
  type ConsumptionApproval, type WorkOrder, type WorkOrderPart,
  type OutsourcedJob, type WorkshopPayment,
  type VehicleClass, type VehicleType,
} from "@/lib/db-types";
import { vehicleLabel } from "@/lib/vehicle-types";
import { deleteExitPermitDraft, getExitPermitFileUrls } from "./actions";
import {
  PermitFormModal, ConfirmExitModal, ReturnModal, VoidModal, PermitPrintView,
  WriteOffModal, ReverseWriteOffModal,
} from "./ExitPermitModals";
import ApprovalsTab from "./ApprovalsTab";
import PartsUsageTab from "./PartsUsageTab";
import type { WoLedgerRow } from "@/lib/parts-usage";

const CONSUMPTION_TABS = ["usage", "permits", "approvals"] as const;

export type WarehouseLite = { id: string; name: string };
export type NamedLite = { id: string; name: string };
// 0201 — `trucks` is a table of VEHICLES now, and this page lists both classes
// (a permit's destination can be a pickup). The class drives the grouping in the
// destination picker; `vehicle_type_id` resolves, through `vehicleTypes` below,
// to the word that says which vehicle a plate is.
export type TruckLite = {
  id: string;
  plate: string;
  vehicle_class: VehicleClass;
  vehicle_type_id: string | null;
};
export type StaffLite = { id: string; name: string; name_ar?: string | null };
// `name_ar` rides on the PART and STAFF types only. Warehouses, water
// stations, projects and trucks have no Arabic column in the schema, so
// `NamedLite` deliberately stays a bare `{ id, name }` rather than growing an
// optional field that would be null for most of its users.
export type PartLite = {
  id: string; name: string; name_ar: string | null; sku: string; unit: string | null;
  warehouse_id: string; qty_on_hand: number;
};

// THREE tabs. "Reports" used to sit here and has been removed: Reports is a
// separate top-level page in the sidebar, and a second entry point with the
// same name inside Consumption only invited the question of which one was
// real. Nothing was built behind it.
type Tab = "usage" | "permits" | "approvals";

// The tab strip carries a KEY, not a rendered label: the array is module-level
// and `t()` needs a language, which only exists inside the component.
const TABS: { key: Tab; labelKey: TKey }[] = [
  { key: "usage", labelKey: "consumption.client.tabUsage" },
  { key: "permits", labelKey: "consumption.client.tabPermits" },
  { key: "approvals", labelKey: "consumption.client.tabApprovals" },
];

export default function ConsumptionClient({
  permits, lines, returns, returnLines, writeOffs, writeOffLines, files,
  warehouses, parts, stations, projects, trucks, customers, staff,
  lots, ledger,
  approvals, workOrders, workOrderParts, outsourcedJobs, workshopPayments,
  repairers, jobRepairers, allParts, allTrucks, vehicleTypes, viewer, woLedger,
  today, error,
}: {
  permits: ExitPermit[];
  lines: ExitPermitLine[];
  returns: ExitPermitReturn[];
  returnLines: ExitPermitReturnLine[];
  // REVERSED ONES INCLUDED. The expansion lists both states, because both
  // posted real money in real months.
  writeOffs: ExitPermitWriteOff[];
  writeOffLines: ExitPermitWriteOffLine[];
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
  allParts: { id: string; name: string; name_ar: string | null; sku: string; unit: string | null; warehouse_id: string }[];
  allTrucks: TruckLite[];
  // The lookup behind an operation vehicle's name. ALL rows, active and
  // retired: this page only ever names a type, it never offers one to pick.
  vehicleTypes: VehicleType[];
  // Signed-in user's email — the approvals tab compares it to decided_by.
  viewer: string | null;
  // The MAINTENANCE per-lot ledger, for Parts Usage.
  woLedger: WoLedgerRow[];
  today: string;
  error: string | null;
}) {
  const { lang } = useApp();
  const router = useRouter();
  // Tab lives in the URL so global search can deep-link a sub-page.
  const [tab, setTab] = useTabParam<Tab>(CONSUMPTION_TABS, "permits");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "exited" | "voided" | "overdue">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Global-search record focus (?focus=exit_permit:<id>). A permit has no
  // detail modal — its row expansion IS the detail view — so arriving means
  // expanding that row and clearing any status filter that would hide it.
  useRecordFocus(["exit_permit"], (_e, id) => {
    if (!permits.some((x) => x.id === id)) return;
    setStatusFilter("all");
    setExpanded((prev) => new Set(prev).add(id));
  });
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
  const [writeOffPermit, setWriteOffPermit] = useState<ExitPermit | null>(null);
  // The REVERSE popup keys off the write-off, not the permit: a permit can
  // carry several, each with its own date, amount and reason, and reversing
  // "the permit's write-off" would be a question with more than one answer.
  const [reverseWriteOff, setReverseWriteOff] = useState<ExitPermitWriteOff | null>(null);
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

  const writeOffsByPermit = useMemo(() => {
    const m = new Map<string, ExitPermitWriteOff[]>();
    for (const w of writeOffs) {
      const a = m.get(w.exit_permit_id) ?? [];
      a.push(w);
      m.set(w.exit_permit_id, a);
    }
    return m;
  }, [writeOffs]);

  const filesByPermit = useMemo(() => {
    const m = new Map<string, ExitPermitFile[]>();
    for (const f of files) {
      const a = m.get(f.exit_permit_id) ?? [];
      a.push(f);
      m.set(f.exit_permit_id, a);
    }
    return m;
  }, [files]);

  // Built once here and passed to every child that names a vehicle — the
  // destination resolver below, the exit-permit form's picker, the approvals
  // list and the parts-usage tables.
  const vehicleTypeById = useMemo(
    () => new Map(vehicleTypes.map((vt) => [vt.id, vt])),
    [vehicleTypes],
  );

  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const warehousesById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  // ONE destination resolver, so the list row, the detail and the printable
  // permit can never describe the same permit differently.
  const destinationLabel = useMemo(() => {
    const st = new Map(stations.map((s) => [s.id, s.name]));
    const pr = new Map(projects.map((p) => [p.id, p.name]));
    // The vehicle's NAME, not its bare plate: an operation vehicle carries its
    // type, so a permit sent to a crane says so on the row, in the detail and
    // on the printed permit — all three read this one map.
    const tr = new Map(trucks.map((t) => [t.id, vehicleLabel(t, vehicleTypeById, lang)]));
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
  }, [stations, projects, trucks, customers, vehicleTypeById, lang]);

  const receiverLabel = useMemo(() => {
    const s = new Map(staff.map((x) => [x.id, personName(x, lang)]));
    return (p: ExitPermit): string =>
      p.receiver_staff_id ? s.get(p.receiver_staff_id) ?? "—" : p.receiver_name ?? "—";
  }, [staff, lang]);

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
      (n, p) => n + permitValueSar(p, linesByPermit.get(p.id) ?? []), 0,
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
    if (!confirm(t("consumption.client.deleteDraftConfirm", lang))) return;
    const res = await deleteExitPermitDraft(p.id, lang);
    if (res.error) { setActionError(res.error); return; }
    router.refresh();
  }

  async function openFile(path: string) {
    const res = await getExitPermitFileUrls([path]);
    if (res.error || !res.urls?.[path]) { setActionError(res.error ?? t("consumption.client.fileOpenFailed", lang)); return; }
    window.open(res.urls[path], "_blank", "noopener,noreferrer");
  }

  function closeAll() {
    setFormPermit(null); setConfirmPermit(null);
    setReturnPermit(null); setVoidPermit(null);
    setWriteOffPermit(null); setReverseWriteOff(null);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("consumption.client.title", lang)}
        subtitle={t("consumption.client.subtitle", lang)}
        actions={
          tab === "permits" ? (
            <Btn variant="primary" onClick={() => setFormPermit("new")}>
              <Plus className="h-4 w-4" />{t("consumption.client.newPermit", lang)}
            </Btn>
          ) : undefined
        }
      />

      <div className="flex items-center gap-1 border-b flex-wrap" style={{ borderColor: "rgb(var(--border))" }}>
        {TABS.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition",
              tab === tb.key
                ? "border-brand-600 text-brand-600 dark:text-brand-300"
                : "border-transparent muted hover:text-[rgb(var(--fg))]",
            )}
          >
            {t(tb.labelKey, lang)}
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
          vehicleTypeById={vehicleTypeById}
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
          vehicleTypeById={vehicleTypeById}
          viewer={viewer}
          // The SAME resolver the permits tab and the printable permit use, so
          // one permit can never be described three different ways.
          destinationLabel={destinationLabel}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label={t("consumption.client.kpiDrafts", lang)} value={String(kpis.drafts)} />
            <Kpi label={t("consumption.client.kpiOut", lang)} value={String(kpis.exited)} />
            <Kpi
              label={t("consumption.client.kpiOverdue", lang)}
              value={String(kpis.overdue)}
              tone={kpis.overdue > 0 ? "bad" : undefined}
            />
            <Kpi
              label={t("consumption.client.kpiValueOut", lang)}
              value={formatSar(kpis.outstandingValue)}
              hint={t("consumption.client.kpiValueOutHint", lang)}
            />
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {([
              ["all", "consumption.client.statusAll"],
              ["draft", "consumption.client.statusDrafts"],
              ["exited", "consumption.client.statusOut"],
              ["overdue", "consumption.client.statusOverdue"],
              ["voided", "consumption.client.statusVoided"],
            ] as const).map(([k, labelKey]) => (
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
                {t(labelKey, lang)}
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
                <p className="text-sm muted">
                  {t(statusFilter === "all"
                    ? "consumption.client.emptyYet"
                    : "consumption.client.emptyFiltered", lang)}
                </p>
                {statusFilter === "all" && (
                  <p className="text-xs muted mt-1">
                    {t("consumption.client.emptyHint", lang)}
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
                    <TH>{t("consumption.shared.permit", lang)}</TH>
                    <TH>{t("consumption.shared.kind", lang)}</TH>
                    <TH>{t("consumption.shared.destination", lang)}</TH>
                    <TH>{t("consumption.shared.receiver", lang)}</TH>
                    <TH>{t("consumption.shared.warehouse", lang)}</TH>
                    <TH>{t("consumption.shared.items", lang)}</TH>
                    <TH>{t("consumption.client.colValueOut", lang)}</TH>
                    <TH>{t("common.status", lang)}</TH>
                    <TH>{null}</TH>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => {
                    const pl = linesByPermit.get(p.id) ?? [];
                    const pr = returnsByPermit.get(p.id) ?? [];
                    const pw = writeOffsByPermit.get(p.id) ?? [];
                    const pf = filesByPermit.get(p.id) ?? [];
                    const open = expanded.has(p.id);
                    const overdue = overdueIds.has(p.id);
                    const outstanding = permitOutstanding(pl);
                    // From the LINE COLUMNS, not from `pw` — the write-off rows
                    // are the paperwork, `qty_written_off` is the balance, and
                    // the RPCs move the two together. Summing reversed and
                    // un-reversed paperwork would count a cancelled decision.
                    const writtenOff = permitWrittenOff(pl);
                    return (
                      <Fragment key={p.id}>
                        <tr className={cn(overdue && "bg-rose-500/[0.06]")}>
                          <TD>
                            <button
                              onClick={() => toggle(p.id)}
                              className="h-7 w-7 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                              aria-label={t(open
                                ? "consumption.shared.collapseAria"
                                : "consumption.shared.expandAria", lang)}
                            >
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="rtl:-scale-x-100 h-4 w-4" />}
                            </button>
                          </TD>
                          <TD>
                            <span className="font-mono text-xs font-medium">
                              {p.ep_number ?? <span className="muted">{t("consumption.client.statusDraft", lang)}</span>}
                            </span>
                            {pf.length > 0 && (
                              <span className="ms-1.5 inline-flex items-center gap-0.5 text-[10px] muted">
                                <Paperclip className="h-3 w-3" />{pf.length}
                              </span>
                            )}
                          </TD>
                          <TD className="text-xs">
                            {t(EXIT_PERMIT_KIND_TKEY[p.kind], lang)}
                            {p.kind === "returnable" && p.expected_return_on && (
                              <div className={cn("text-[11px]", overdue ? "text-rose-600 dark:text-rose-400 font-medium" : "muted")}>
                                {fill("consumption.client.dueOn", lang, "{d}", formatDate(p.expected_return_on + "T00:00:00"))}
                              </div>
                            )}
                          </TD>
                          <TD className="text-xs">
                            {destinationLabel(p)}
                            <div className="text-[11px] muted">{t(EXIT_PERMIT_DESTINATION_TKEY[p.destination_kind], lang)}</div>
                          </TD>
                          <TD className="text-xs">
                            {receiverLabel(p)}
                            {p.carrier_name && (
                              <div className="text-[11px] muted">
                                {fill("consumption.client.via", lang, "{name}", p.carrier_name)}
                              </div>
                            )}
                          </TD>
                          <TD className="text-xs">{warehousesById.get(p.warehouse_id)?.name ?? "—"}</TD>
                          <TD className="text-xs tabular-nums">
                            {pl.length}
                            {p.status === "exited" && p.kind === "returnable" && (
                              <div className="text-[11px] muted">
                                {fill("consumption.client.qtyOutstanding", lang, "{n}", String(outstanding))}
                              </div>
                            )}
                          </TD>
                          {/* DRAFT stays a dash: nothing has been drawn, so
                              there is no value yet to state. VOIDED prints an
                              actual 0 rather than a dash, because zero is a
                              MEASURED fact there — the void returned the stock
                              — and the KPI above already counts it as zero. A
                              dash would read as "not applicable" and leave the
                              row and the KPI looking like they disagree. */}
                          <TD className="text-xs tabular-nums">
                            {p.status === "draft" ? <span className="muted">—</span> : formatSar(permitValueSar(p, pl))}
                          </TD>
                          <TD>
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", EXIT_PERMIT_STATUS_PILL[p.status])}>
                                {t(p.status === "draft"
                                  ? "consumption.client.statusDraft"
                                  : p.status === "exited"
                                    ? "consumption.client.statusOut"
                                    : "consumption.client.statusVoided", lang)}
                              </span>
                              {overdue && p.expected_return_on && (
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20">
                                  <AlertTriangle className="h-3 w-3" />
                                  {fill("consumption.client.daysOverdue", lang, "{n}", String(daysOverdue(p.expected_return_on, today)))}
                                </span>
                              )}
                              {/* AMBER, NOT ROSE, and the distinction is the
                                  point: rose on this page means something is
                                  wrong and wants chasing. A write-off is a
                                  decision that has already been taken, so it
                                  states itself without raising an alarm. It is
                                  a CHIP beside the status rather than a status
                                  of its own, because the permit is still
                                  whatever it was — exited, or voided. */}
                              {writtenOff > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/25">
                                  <FileMinus className="h-3 w-3" />
                                  {fill("consumption.client.writtenOffChip", lang, "{n}", String(writtenOff))}
                                </span>
                              )}
                            </div>
                          </TD>
                          <TD>
                            <div className="flex items-center gap-1 justify-end">
                              {p.status === "draft" && (
                                <>
                                  <Btn variant="primary" onClick={() => setConfirmPermit(p)}>{t("consumption.shared.confirmExit", lang)}</Btn>
                                  <button
                                    onClick={() => setFormPermit(p)}
                                    className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                                    title={t("consumption.client.editDraft", lang)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={() => onDeleteDraft(p)}
                                    className="h-8 w-8 rounded-lg grid place-items-center text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                                    title={t("consumption.client.deleteDraft", lang)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                              {p.status === "exited" && (
                                <>
                                  {p.kind === "returnable" && outstanding > 0 && (
                                    <>
                                      <Btn variant="outline" onClick={() => setReturnPermit(p)}>
                                        <Undo2 className="h-3.5 w-3.5" />{t("consumption.client.returnBtn", lang)}
                                      </Btn>
                                      {/* SAME GATE AS RETURN — returnable,
                                          exited, something still out — because
                                          they are the two answers to the same
                                          question: it came back, or it is not
                                          coming back. A permanent permit
                                          expensed its parts on the way out and
                                          has nothing left to write off, which
                                          is also what the RPC says. */}
                                      <Btn variant="outline" onClick={() => setWriteOffPermit(p)}>
                                        <FileMinus className="h-3.5 w-3.5" />{t("consumption.client.writeOffBtn", lang)}
                                      </Btn>
                                    </>
                                  )}
                                  <button
                                    onClick={() => setVoidPermit(p)}
                                    className="h-8 w-8 rounded-lg grid place-items-center text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                                    title={t("consumption.shared.voidPermit", lang)}
                                  >
                                    <Ban className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                              {p.status !== "draft" && (
                                <button
                                  onClick={() => setPrintPermit(p)}
                                  className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                                  title={t("consumption.client.printablePermit", lang)}
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
                                <div className="text-[11px] font-semibold uppercase tracking-wide muted">{t("consumption.shared.items", lang)}</div>
                                {p.note && (
                                  <p className="text-sm rounded-lg px-3 py-2 bg-black/[0.03] dark:bg-white/[0.04]">
                                    {p.note}
                                  </p>
                                )}
                                <Table>
                                  <thead>
                                    <tr>
                                      <TH>{t("common.part", lang)}</TH>
                                      {/* NOTE gets its own column beside the
                                          part, capped at roughly two lines —
                                          a long note should be readable at a
                                          glance without stretching the row
                                          into a paragraph. */}
                                      <TH>{t("common.note", lang)}</TH>
                                      <TH>{t("consumption.shared.qtyOut", lang)}</TH>
                                      <TH>{t("consumption.client.colReturned", lang)}</TH>
                                      {/* ONLY WHEN THERE IS ONE. A permanent
                                          permit, and every returnable nobody
                                          has written anything off, gets the
                                          table it had — a column of dashes is
                                          a question the reader did not ask. */}
                                      {writtenOff > 0 && <TH>{t("consumption.client.colWrittenOff", lang)}</TH>}
                                      <TH>{t("consumption.shared.outstanding", lang)}</TH>
                                      <TH>{t("consumption.shared.fifoUnitValue", lang)}</TH>
                                      <TH>{t("consumption.shared.value", lang)}</TH>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {pl.map((l) => {
                                      const part = partsById.get(l.part_id);
                                      // THIS ROW PUTS Qty out, Returned AND
                                      // Outstanding SIDE BY SIDE, so the three
                                      // have to add up or the row argues with
                                      // itself. They are therefore derived
                                      // together, from `out`, rather than read
                                      // from three independent expressions.
                                      //
                                      // A DRAFT IS A PREVIEW on this table and
                                      // always has been — the Value cell below
                                      // prices it off `qty` for exactly that
                                      // reason — so it previews the exit with
                                      // everything still out. Nothing has left,
                                      // so nothing has come back either, and
                                      // Returned lands on 0 by construction.
                                      const out = p.status === "draft"
                                        ? Number(l.qty)
                                        : permitLineOutstanding(p, l);
                                      // WHAT CAME BACK, BY ANY ROUTE — not the
                                      // `qty_returned` counter. The two are
                                      // equal on every exited permit (measured:
                                      // qty_returned reconciles exactly to the
                                      // sum of its return-event lines on every
                                      // line in the database). They part company
                                      // on a VOIDED permit, where the void put
                                      // the stock back without filing a return
                                      // event, leaving the counter at 0 while
                                      // the shelf says otherwise. Printing the
                                      // counter there gave "2 out, 0 returned,
                                      // 0 outstanding". Which return events fired
                                      // is still on the page — the Returns list
                                      // directly below breaks them down.
                                      //
                                      // WRITTEN-OFF UNITS COME OUT OF THIS, and
                                      // that is the whole reason the subtraction
                                      // is spelled here rather than left to
                                      // widen silently. `out` already excludes
                                      // them, so leaving them in `back` would
                                      // file them under Returned — the one
                                      // column on this page that means the
                                      // parts are physically on a shelf again.
                                      // They are not. The three columns still
                                      // add up, now across four terms.
                                      const wo = Number(l.qty_written_off);
                                      const back = Number(l.qty) - out - wo;
                                      return (
                                        <tr key={l.id}>
                                          <TD>
                                            <span className="text-sm font-medium">
                                              {part ? arText(part.name, part.name_ar, lang) : t("consumption.usage.unknownPart", lang)}
                                            </span>
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
                                          <TD className="text-xs tabular-nums">{back || <span className="muted">—</span>}</TD>
                                          {writtenOff > 0 && (
                                            <TD className="text-xs tabular-nums">
                                              {wo
                                                ? <span className="text-amber-700 dark:text-amber-400 font-medium">{wo}</span>
                                                : <span className="muted">—</span>}
                                            </TD>
                                          )}
                                          <TD className="text-xs tabular-nums font-medium">{out}</TD>
                                          <TD className="text-xs tabular-nums">
                                            {(() => {
                                              const u = lineUnitCost(p.status, l, lots);
                                              if (u === null) return <span className="muted" title={t("consumption.client.noPriceTitle", lang)}>—</span>;
                                              return (
                                                <>
                                                  {formatSar(u)}
                                                  {p.status === "draft" && (
                                                    <span className="block text-[10px] muted">{t("consumption.shared.previewTag", lang)}</span>
                                                  )}
                                                </>
                                              );
                                            })()}
                                          </TD>
                                          <TD className="text-xs tabular-nums">
                                            {(() => {
                                              const u = lineUnitCost(p.status, l, lots);
                                              // PRICES THE OUTSTANDING COLUMN, literally —
                                              // `out` already carries the draft preview
                                              // (whole qty) and the voided zero, so the
                                              // money cell cannot disagree with the count
                                              // two columns to its left.
                                              return u === null ? <span className="muted">—</span> : formatSar(out * u);
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
                                      {fill("consumption.client.returnsHeading", lang, "{n}", String(pr.length))}
                                    </div>
                                    <ul className="space-y-1">
                                      {pr.map((r) => {
                                        const rl = returnLines.filter((x) => x.exit_permit_return_id === r.id);
                                        return (
                                          <li key={r.id} className="text-xs rounded-lg border px-2.5 py-1.5" style={{ borderColor: "rgb(var(--border))" }}>
                                            <span className="font-medium">
                                              {formatDate(r.returned_on + "T00:00:00")}
                                            </span>
                                            {" — "}
                                            {rl.map((x) => {
                                              const line = pl.find((l) => l.id === x.exit_permit_line_id);
                                              const part = line ? partsById.get(line.part_id) : null;
                                              const name = part
                                                ? arText(part.name, part.name_ar, lang)
                                                : t("consumption.client.unknownShort", lang);
                                              return t("consumption.client.returnItem", lang)
                                                .replace("{q}", () => String(x.qty))
                                                .replace("{p}", () => name);
                                            }).join(", ")}
                                            {r.note && <span className="muted"> · {r.note}</span>}
                                            {r.created_by && <span className="muted"> · {r.created_by}</span>}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </>
                                )}

                                {/* WRITE-OFFS, reversed ones included. A
                                    reversed row is struck through rather than
                                    dropped: it booked a cost in a month that
                                    has probably closed, and its credit landed
                                    in another. A list that showed only the live
                                    ones would leave the Cost report carrying
                                    two entries this page never mentions. */}
                                {pw.length > 0 && (
                                  <>
                                    <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
                                      {fill("consumption.client.writeOffsHeading", lang, "{n}", String(pw.length))}
                                    </div>
                                    <ul className="space-y-1">
                                      {pw.map((w) => {
                                        const wl = writeOffLines.filter((x) => x.exit_permit_write_off_id === w.id);
                                        const reversed = w.reversed_at !== null;
                                        return (
                                          <li
                                            key={w.id}
                                            className={cn(
                                              "text-xs rounded-lg border px-2.5 py-1.5 flex items-start gap-2",
                                              reversed && "opacity-60",
                                            )}
                                            style={{ borderColor: "rgb(var(--border))" }}
                                          >
                                            <div className="min-w-0 flex-1">
                                              <span className={cn("font-medium", reversed && "line-through")}>
                                                {formatDate(w.write_off_date + "T00:00:00")}
                                              </span>
                                              {" — "}
                                              <span className={cn(reversed && "line-through")}>
                                                {formatSar(Number(w.amount_sar))}
                                              </span>
                                              {" · "}
                                              {wl.map((x) => {
                                                const line = pl.find((l) => l.id === x.exit_permit_line_id);
                                                const part = line ? partsById.get(line.part_id) : null;
                                                const name = part
                                                  ? arText(part.name, part.name_ar, lang)
                                                  : t("consumption.client.unknownShort", lang);
                                                return t("consumption.client.returnItem", lang)
                                                  .replace("{q}", () => String(x.qty))
                                                  .replace("{p}", () => name);
                                              }).join(", ")}
                                              <span className="muted"> · {w.reason}</span>
                                              {w.note && <span className="muted"> · {w.note}</span>}
                                              {w.written_off_by && <span className="muted"> · {w.written_off_by}</span>}
                                              {reversed && (
                                                <div className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                                                  {w.reversed_at && fill("consumption.client.reversedOn", lang, "{d}", formatDate(w.reversed_at))}
                                                  {w.reversal_reason && fill("consumption.client.dashReason", lang, "{reason}", w.reversal_reason)}
                                                </div>
                                              )}
                                            </div>
                                            {!reversed && (
                                              <button
                                                onClick={() => setReverseWriteOff(w)}
                                                className="shrink-0 h-7 w-7 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                                                title={t("consumption.client.reverseWriteOffTitle", lang)}
                                              >
                                                <RotateCcw className="h-3.5 w-3.5" />
                                              </button>
                                            )}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </>
                                )}

                                {pf.length > 0 && (
                                  <>
                                    <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
                                      {fill("consumption.client.attachmentsHeading", lang, "{n}", String(pf.length))}
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
                                      <RotateCcw className="h-3.5 w-3.5" />{t("consumption.client.statusVoided", lang)}
                                    </span>
                                    {p.voided_at && fill("consumption.client.onDate", lang, "{d}", formatDate(p.voided_at))}
                                    {p.voided_by && fill("consumption.client.byWho", lang, "{who}", p.voided_by)}
                                    {p.void_reason && fill("consumption.client.dashReason", lang, "{reason}", p.void_reason)}
                                    <div className="mt-0.5">
                                      {t("consumption.client.voidedNote", lang)}
                                    </div>
                                  </div>
                                )}

                                <div className="text-[11px] muted">
                                  {p.issued_by && <>{fill("consumption.client.issuedBy", lang, "{who}", p.issued_by)}{" "}</>}
                                  {p.exited_at && (
                                    <>
                                      {fill("consumption.client.exitedAt", lang, "{d}", formatDateTime(p.exited_at))}
                                      {p.exited_by ? fill("consumption.client.byWho", lang, "{who}", p.exited_by) : ""}
                                      {"."}{" "}
                                    </>
                                  )}
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
          vehicleTypeById={vehicleTypeById}
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

      {writeOffPermit && (
        <WriteOffModal
          permit={writeOffPermit}
          lines={linesByPermit.get(writeOffPermit.id) ?? []}
          parts={parts}
          today={today}
          onClose={closeAll}
        />
      )}

      {reverseWriteOff && (
        <ReverseWriteOffModal
          writeOff={reverseWriteOff}
          writeOffLines={writeOffLines}
          lines={linesByPermit.get(reverseWriteOff.exit_permit_id) ?? []}
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
          destinationKind={t(EXIT_PERMIT_DESTINATION_TKEY[printPermit.destination_kind], lang)}
          receiver={receiverLabel(printPermit)}
          onClose={() => setPrintPermit(null)}
        />
      )}
    </div>
  );
}

/**
 * ONE-TOKEN INTERPOLATION, in the repo's idiom: a FUNCTION replacer, so a `$&`
 * or `$1` sitting inside a part name, a carrier name or a void reason is
 * inserted literally instead of being read as a replacement pattern.
 *
 * It exists as a helper rather than an inline `.replace()` at each of the ten
 * call sites for a second reason: several of those sites pass a column that is
 * `string | null` and has just been narrowed by a `&&` guard. Passing the value
 * as an ARGUMENT keeps the narrowing at the call site, where it holds; a closure
 * written inline would lose it and force a non-null assertion.
 */
function fill(key: TKey, lang: Lang, token: string, value: string): string {
  return t(key, lang).replace(token, () => value);
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
