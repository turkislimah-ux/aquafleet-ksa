"use client";

// Maintenance — Phase 1: in-house scheduling core. Mirrors preview/'s
// pages-2.js maintenance() page function (lines ~1148-1385) structure:
// header -> 4-stat KPI row -> calendar/week-strip -> track switch -> (for
// In-House) sub-tabs + truck filter + group-by-truck + jobs table.
//
// Out-Sourced track exists as a UI toggle (matches preview always showing
// it) but renders an honest-empty state — no outsourced_jobs table/RPCs
// exist yet (later phase), same "render the real layout, empty state until
// it lands" convention app/fleet/[id]/FleetDetailClient.tsx already uses.
//
// This REPLACES the earlier mock-data page (see page.tsx's own header) —
// every number here is live from Supabase, nothing is a demo fixture.
//
// Phase-5 fixes: `truckFilter` is now SHARED between in-house and
// outsourced (matches preview's single S.mtTruckFilter — was two
// independent filters before). OS view/edit/new-job state is now owned
// HERE (see the newOsOpen/viewingOsId/editingOsId trio below, mirroring
// the in-house newWOOpen/viewingWoId/editingWoId trio) instead of inside
// OutsourcedTrack, so the shared calendar can open a specific OS job's
// detail view from a day-cell pill click regardless of which track's tab
// is active — and so the header's "+ New" action can target whichever
// track is active from one place, matching preview's own layout (the
// create button always sits in the page header, never inside the track's
// own table toolbar).

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, ChevronDown, ChevronRight, Eye, Layers, X, AlertTriangle } from "lucide-react";
import { PageHeader, Card, Stat, Btn, Table, TH, TD } from "@/components/ui";
import MtStatusPill, { type MtPillKind } from "./MtStatusPill";
import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";
import { cn, formatSar } from "@/lib/utils";
import type {
  Truck,
  Staff,
  Part,
  RepairDescription,
  WorkOrder,
  WorkOrderTask,
  WorkOrderPart,
  WorkOrderPartPhoto,
  CompanySettings,
  RepairerType,
  Repairer,
  OutsourcedDescription,
  OutsourcedJob,
  OutsourcedJobRepairer,
  OutsourcedJobTask,
  WorkshopPayment,
  WorkshopPaymentFile,
} from "@/lib/db-types";
import MaintenanceCalendar, { woCalendarKey } from "./MaintenanceCalendar";
import NewWorkOrderModal from "./NewWorkOrderModal";
import WorkOrderDetailModal from "./WorkOrderDetailModal";
import OutsourcedTrack from "./OutsourcedTrack";
import NewOutsourcedJobModal from "./NewOutsourcedJobModal";
import OutsourcedJobDetailModal from "./OutsourcedJobDetailModal";

// "all" is a pseudo-section — a filter view, never something sectionOf()
// itself returns. Means "every non-historical phase of THIS track,
// combined" (Turki's Phase-3 correction: All is scoped per-track, never a
// cross-track merge — that's what the deleted AllTrack.tsx got wrong).
type Section = "all" | "scheduled" | "in_progress" | "delayed" | "historical";

function isWoDelayed(w: WorkOrder): boolean {
  return w.status !== "completed" && w.status !== "cancelled" && new Date(w.due_by).getTime() < Date.now();
}

function sectionOf(w: WorkOrder): Section {
  if (isWoDelayed(w)) return "delayed";
  if (w.status === "completed" || w.status === "cancelled") return "historical";
  if (w.status === "in_progress" || w.status === "awaiting_parts") return "in_progress";
  return "scheduled";
}

function woKind(status: WorkOrder["status"]): MtPillKind {
  if (status === "completed" || status === "cancelled") return "completed";
  if (status === "in_progress" || status === "awaiting_parts") return "in_progress";
  return "scheduled";
}

export default function MaintenanceClient({
  trucks,
  mechanics,
  parts,
  repairDescriptions,
  workOrders,
  workOrderTasks,
  workOrderParts,
  workOrderPartPhotos,
  companySettings,
  repairerTypes,
  repairers,
  outsourcedDescriptions,
  outsourcedJobs,
  outsourcedJobRepairers,
  outsourcedJobTasks,
  workshopPayments,
  workshopPaymentFiles,
  currentUserEmail,
  error,
}: {
  trucks: Truck[];
  mechanics: Staff[];
  parts: Part[];
  repairDescriptions: RepairDescription[];
  workOrders: WorkOrder[];
  workOrderTasks: WorkOrderTask[];
  workOrderParts: WorkOrderPart[];
  workOrderPartPhotos: WorkOrderPartPhoto[];
  companySettings: CompanySettings | null;
  repairerTypes: RepairerType[];
  repairers: Repairer[];
  outsourcedDescriptions: OutsourcedDescription[];
  outsourcedJobs: OutsourcedJob[];
  outsourcedJobRepairers: OutsourcedJobRepairer[];
  outsourcedJobTasks: OutsourcedJobTask[];
  workshopPayments: WorkshopPayment[];
  workshopPaymentFiles: WorkshopPaymentFile[];
  currentUserEmail: string | null;
  error: string | null;
}) {
  const { lang } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [track, setTrack] = useState<"in_house" | "outsourced">("in_house");
  const [section, setSection] = useState<Section>("scheduled");
  const [truckFilter, setTruckFilter] = useState<string>("all");
  const [groupByTruck, setGroupByTruck] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expandedTrucks, setExpandedTrucks] = useState<Set<string>>(new Set(trucks.map((tr) => tr.id)));

  const [newWOOpen, setNewWOOpen] = useState(false);
  const [viewingWoId, setViewingWoId] = useState<string | null>(null);
  const [editingWoId, setEditingWoId] = useState<string | null>(null);

  // OS view/edit/new state — LIFTED here from OutsourcedTrack (Phase-5
  // fix): the calendar's day cells now show both tracks' own pills
  // depending on the active tab, and clicking an OS pill must open that
  // job's detail modal — which OutsourcedTrack's own internal state
  // couldn't do from outside it. Mirrors the in-house viewingWoId/
  // editingWoId pair immediately above, same pattern.
  const [newOsOpen, setNewOsOpen] = useState(false);
  const [viewingOsId, setViewingOsId] = useState<string | null>(null);
  const [editingOsId, setEditingOsId] = useState<string | null>(null);

  const trucksById = useMemo(() => new Map(trucks.map((tr) => [tr.id, tr])), [trucks]);
  const mechanicsById = useMemo(() => new Map(mechanics.map((m) => [m.id, m])), [mechanics]);
  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  const repairerIdsByJob = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const jr of outsourcedJobRepairers) {
      const arr = m.get(jr.outsourced_job_id) ?? [];
      arr.push(jr.repairer_id);
      m.set(jr.outsourced_job_id, arr);
    }
    return m;
  }, [outsourcedJobRepairers]);

  function jobRepairerObjs(jobId: string): Repairer[] {
    const ids = repairerIdsByJob.get(jobId) ?? [];
    return ids.map((id) => repairers.find((r) => r.id === id)).filter((r): r is Repairer => !!r);
  }

  // Deep-link open — Fleet Detail's own Maintenance History card ("View")
  // links here as /maintenance?wo=<id> or /maintenance?os=<id> instead of
  // just the bare page, so a job opens straight into its detail modal on
  // arrival, same as preview's own single-page-app MT.openJob() would.
  // Guarded against a stale/foreign id (job deleted, or belongs to a
  // different environment) — silently does nothing rather than crash.
  useEffect(() => {
    const woParam = searchParams.get("wo");
    const osParam = searchParams.get("os");
    if (woParam && workOrders.some((w) => w.id === woParam)) {
      setTrack("in_house");
      setViewingWoId(woParam);
    } else if (osParam && outsourcedJobs.some((j) => j.id === osParam)) {
      setTrack("outsourced");
      setViewingOsId(osParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Out-of-part — DERIVED, not stored (see WorkOrderDetailModal's own
  // comment for the full rule): only 'open' WOs are at risk, since a
  // started WO already holds its parts. Computed once here so both the
  // top banner and the row-level red highlight share one source of truth.
  const outOfPartWoIds = useMemo(() => {
    const linesByWo = new Map<string, WorkOrderPart[]>();
    for (const l of workOrderParts) {
      const arr = linesByWo.get(l.work_order_id) ?? [];
      arr.push(l);
      linesByWo.set(l.work_order_id, arr);
    }
    const ids = new Set<string>();
    for (const w of workOrders) {
      if (w.status !== "open") continue;
      const lines = linesByWo.get(w.id) ?? [];
      if (lines.some((l) => (partsById.get(l.part_id)?.qty_on_hand ?? 0) < l.qty)) ids.add(w.id);
    }
    return ids;
  }, [workOrders, workOrderParts, partsById]);

  const withSections = useMemo(() => workOrders.map((w) => ({ w, section: sectionOf(w) })), [workOrders]);

  const kpiScheduled = withSections.filter((x) => x.section === "scheduled").length;
  const kpiInProgress = withSections.filter((x) => x.section === "in_progress").length;
  const kpiDelayed = withSections.filter((x) => x.section === "delayed").length;

  const sectionCounts: Record<Section, number> = {
    all: kpiScheduled + kpiInProgress + kpiDelayed,
    scheduled: kpiScheduled,
    in_progress: kpiInProgress,
    delayed: kpiDelayed,
    historical: withSections.filter((x) => x.section === "historical").length,
  };

  const filtered = useMemo(() => {
    return withSections
      .filter((x) => (section === "all" ? x.section !== "historical" : x.section === section))
      .filter((x) => truckFilter === "all" || x.w.truck_id === truckFilter)
      .filter((x) => !selectedDate || woCalendarKey(x.w) === selectedDate)
      .map((x) => x.w)
      .sort((a, b) => new Date(a.due_by).getTime() - new Date(b.due_by).getTime());
  }, [withSections, section, truckFilter, selectedDate]);

  const groups = useMemo(() => {
    if (!groupByTruck || truckFilter !== "all") return null;
    const m = new Map<string, WorkOrder[]>();
    for (const w of filtered) {
      const arr = m.get(w.truck_id) ?? [];
      arr.push(w);
      m.set(w.truck_id, arr);
    }
    return m;
  }, [filtered, groupByTruck, truckFilter]);

  function truckRollup(truckId: string) {
    const rows = withSections.filter((x) => x.w.truck_id === truckId);
    return {
      scheduled: rows.filter((x) => x.section === "scheduled").length,
      in_progress: rows.filter((x) => x.section === "in_progress").length,
      delayed: rows.filter((x) => x.section === "delayed").length,
      historical: rows.filter((x) => x.section === "historical").length,
    };
  }

  function toggleExpanded(truckId: string) {
    setExpandedTrucks((prev) => {
      const next = new Set(prev);
      if (next.has(truckId)) next.delete(truckId);
      else next.add(truckId);
      return next;
    });
  }

  const viewingWo = viewingWoId ? workOrders.find((w) => w.id === viewingWoId) ?? null : null;
  const editingWo = editingWoId ? workOrders.find((w) => w.id === editingWoId) ?? null : null;

  function openEdit(woId: string) {
    setViewingWoId(null);
    setEditingWoId(woId);
  }

  const viewingOs = viewingOsId ? outsourcedJobs.find((j) => j.id === viewingOsId) ?? null : null;
  const editingOs = editingOsId ? outsourcedJobs.find((j) => j.id === editingOsId) ?? null : null;

  function openOsEdit(jobId: string) {
    setViewingOsId(null);
    setEditingOsId(jobId);
  }

  function renderRow(w: WorkOrder) {
    const truck = trucksById.get(w.truck_id);
    const mech = mechanicsById.get(w.assigned_mechanic_id);
    const delayed = isWoDelayed(w);
    const outOfPart = outOfPartWoIds.has(w.id);
    const priorityCls = {
      low: "text-slate-500",
      medium: "text-blue-600",
      high: "text-amber-600",
      critical: "text-rose-600 font-semibold",
    }[w.priority];
    return (
      <tr key={w.id} className={cn(outOfPart ? "bg-rose-500/5" : "")} title={outOfPart ? t("mt.outOfPartRow", lang) : undefined}>
        <TD className="font-mono text-xs">{w.wo_number}</TD>
        {!groups && (
          <TD className="font-mono text-xs">{truck ? `${truck.plate}` : w.truck_id}</TD>
        )}
        <TD>
          <span className="font-medium">{lang === "ar" ? w.title_ar : w.title}</span>
        </TD>
        <TD className={priorityCls}>{t(`status.${w.priority}`, lang)}</TD>
        <TD>{mech ? (lang === "ar" ? mech.name_ar || mech.name : mech.name) : "—"}</TD>
        <TD className="text-xs">{new Date(w.opened_at).toLocaleDateString()}</TD>
        <TD className={cn("text-xs", delayed ? "text-rose-600 font-medium" : "")}>{new Date(w.due_by).toLocaleDateString()}</TD>
        <TD>
          {outOfPart ? (
            <MtStatusPill kind="overdue" label={t("mt.outOfPart", lang)} />
          ) : delayed ? (
            <MtStatusPill kind="overdue" label={t("mt.delayed", lang)} />
          ) : (
            <MtStatusPill kind={woKind(w.status)} label={t(`status.${w.status}`, lang)} />
          )}
        </TD>
        <TD className="tabular-nums">{formatSar(w.estimated_cost_sar)}</TD>
        <TD>
          <Btn variant="outline" onClick={() => setViewingWoId(w.id)}><Eye className="h-3.5 w-3.5" />{t("mt.viewJob", lang)}</Btn>
        </TD>
      </tr>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.maintenance", lang)}
        subtitle={lang === "en" ? "Work orders, preventive schedules, and history" : "أوامر العمل والصيانة الوقائية والسجل"}
        actions={
          track === "in_house" ? (
            <Btn variant="primary" onClick={() => setNewWOOpen(true)} disabled={trucks.length === 0}>
              <Plus className="h-4 w-4" />{t("common.newWO", lang)}
            </Btn>
          ) : (
            <Btn variant="primary" onClick={() => setNewOsOpen(true)} disabled={trucks.length === 0}>
              <Plus className="h-4 w-4" />{t("mt.newOutsourcedJob", lang)}
            </Btn>
          )
        }
      />

      {error && (
        <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">{error}</div>
      )}

      {outOfPartWoIds.size > 0 && (
        <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300 flex items-center gap-2 flex-wrap">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="font-medium">{outOfPartWoIds.size} {t("mt.outOfPartBanner", lang)}:</span>
          {Array.from(outOfPartWoIds).map((id) => {
            const w = workOrders.find((x) => x.id === id);
            if (!w) return null;
            return (
              <button
                key={id}
                onClick={() => setViewingWoId(id)}
                className="font-mono underline hover:no-underline"
              >
                {w.wo_number}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={t("status.scheduled", lang)} value={kpiScheduled} />
        <Stat label={t("status.in_progress", lang)} value={kpiInProgress} tone={kpiInProgress > 0 ? "warn" : "ok"} />
        <Stat label={t("mt.delayed", lang)} value={kpiDelayed} tone={kpiDelayed > 0 ? "bad" : "ok"} />
        <Stat label={t("mt.outsourced", lang)} value={outsourcedJobs.length} />
      </div>

      <MaintenanceCalendar
        lang={lang}
        track={track}
        workOrders={workOrders}
        outsourcedJobs={outsourcedJobs}
        trucks={trucks}
        truckFilter={truckFilter}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        onOpenWorkOrder={setViewingWoId}
        onOpenOutsourcedJob={setViewingOsId}
      />

      <Card className="!p-2">
        <div className="inline-flex rounded-lg border p-1 gap-1" style={{ borderColor: "rgb(var(--border))" }}>
          <button
            onClick={() => setTrack("in_house")}
            className={cn("h-8 px-3 rounded-md text-xs font-medium", track === "in_house" ? "bg-brand-600 text-white" : "hover:bg-black/5 dark:hover:bg-white/5")}
          >
            {t("mt.inHouse", lang)} ({workOrders.length})
          </button>
          <button
            onClick={() => setTrack("outsourced")}
            className={cn("h-8 px-3 rounded-md text-xs font-medium", track === "outsourced" ? "bg-brand-600 text-white" : "hover:bg-black/5 dark:hover:bg-white/5")}
          >
            {t("mt.outsourced", lang)} ({outsourcedJobs.length})
          </button>
        </div>
      </Card>

      {track === "outsourced" ? (
        <OutsourcedTrack
          lang={lang}
          trucks={trucks}
          truckFilter={truckFilter}
          onTruckFilterChange={setTruckFilter}
          selectedDate={selectedDate}
          onClearDate={() => setSelectedDate(null)}
          onViewJob={setViewingOsId}
          repairerTypes={repairerTypes}
          repairers={repairers}
          outsourcedJobs={outsourcedJobs}
          outsourcedJobRepairers={outsourcedJobRepairers}
          workshopPayments={workshopPayments}
        />
      ) : (
        <>
          <Card className="!p-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-1 flex-wrap">
                {(["all", "scheduled", "in_progress", "delayed", "historical"] as Section[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSection(s)}
                    className={cn("h-9 px-3 rounded-lg text-xs font-medium border", section === s ? "bg-brand-600 text-white border-brand-600" : "")}
                    style={section !== s ? { borderColor: "rgb(var(--border))" } : undefined}
                  >
                    {s === "all" ? t("mt.all", lang) : s === "historical" ? t("mt.historical", lang) : s === "delayed" ? t("mt.delayed", lang) : t(`status.${s}`, lang)}
                    <span className="ms-1 muted">{sectionCounts[s]}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {selectedDate && (
                  <button
                    onClick={() => setSelectedDate(null)}
                    className="h-9 px-2.5 rounded-lg text-xs border flex items-center gap-1 hover:bg-black/5 dark:hover:bg-white/5"
                    style={{ borderColor: "rgb(var(--border))" }}
                  >
                    <X className="h-3 w-3" />{t("mt.clearDate", lang)}
                  </button>
                )}
                {truckFilter === "all" && (
                  <button
                    onClick={() => setGroupByTruck((v) => !v)}
                    className={cn("h-9 px-2.5 rounded-lg text-xs border flex items-center gap-1", groupByTruck ? "bg-brand-600 text-white border-brand-600" : "hover:bg-black/5 dark:hover:bg-white/5")}
                    style={groupByTruck ? undefined : { borderColor: "rgb(var(--border))" }}
                  >
                    <Layers className="h-3 w-3" />{t("mt.groupByTruck", lang)}
                  </button>
                )}
                <select
                  value={truckFilter}
                  onChange={(e) => setTruckFilter(e.target.value)}
                  className="h-9 px-2.5 rounded-lg text-xs border"
                  style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
                >
                  <option value="all">{t("common.all", lang)}</option>
                  {trucks.map((tr) => (
                    <option key={tr.id} value={tr.id}>{tr.plate}</option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          {groups ? (
            <div className="space-y-3">
              {Array.from(groups.entries()).map(([truckId, rows]) => {
                const truck = trucksById.get(truckId);
                const rollup = truckRollup(truckId);
                const expanded = expandedTrucks.has(truckId);
                return (
                  <Card key={truckId} className="!p-0 overflow-hidden">
                    <button
                      onClick={() => toggleExpanded(truckId)}
                      className="w-full flex items-center justify-between p-3 hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <div className="flex items-center gap-2">
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <span className="font-mono text-xs">{truck?.plate ?? truckId}</span>
                        <span className="text-sm font-medium">{truck?.model ?? ""}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="rounded px-1.5 py-0.5 bg-brand-500/10 text-brand-700 dark:text-brand-300">{t("status.scheduled", lang)} {rollup.scheduled}</span>
                        <span className="rounded px-1.5 py-0.5 bg-yellow-400/15 text-yellow-800 dark:text-yellow-300">{t("status.in_progress", lang)} {rollup.in_progress}</span>
                        <span className="rounded px-1.5 py-0.5 bg-rose-500/10 text-rose-700 dark:text-rose-300">{t("mt.delayed", lang)} {rollup.delayed}</span>
                        <span className="rounded px-1.5 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">{t("mt.historical", lang)} {rollup.historical}</span>
                      </div>
                    </button>
                    {expanded && (
                      <Table>
                        <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                          <tr>
                            <TH>WO</TH>
                            <TH>{t("common.title", lang)}</TH>
                            <TH>{t("common.priority", lang)}</TH>
                            <TH>{t("common.mechanic", lang)}</TH>
                            <TH>{t("common.opened", lang)}</TH>
                            <TH>{t("common.due", lang)}</TH>
                            <TH>{t("common.status", lang)}</TH>
                            <TH>{t("mt.woActualCost", lang)}</TH>
                            <TH></TH>
                          </tr>
                        </thead>
                        <tbody>{rows.map(renderRow)}</tbody>
                      </Table>
                    )}
                  </Card>
                );
              })}
              {groups.size === 0 && (
                <Card><p className="text-sm muted p-6 text-center">{t("mt.noWorkOrders", lang)}</p></Card>
              )}
            </div>
          ) : (
            <Card className="!p-0 overflow-hidden">
              {filtered.length === 0 ? (
                <p className="text-sm muted p-6 text-center">{t("mt.noWorkOrders", lang)}</p>
              ) : (
                <Table>
                  <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                    <tr>
                      <TH>WO</TH>
                      <TH>{t("common.truck", lang)}</TH>
                      <TH>{t("common.title", lang)}</TH>
                      <TH>{t("common.priority", lang)}</TH>
                      <TH>{t("common.mechanic", lang)}</TH>
                      <TH>{t("common.opened", lang)}</TH>
                      <TH>{t("common.due", lang)}</TH>
                      <TH>{t("common.status", lang)}</TH>
                      <TH>{t("mt.woActualCost", lang)}</TH>
                      <TH></TH>
                    </tr>
                  </thead>
                  <tbody>{filtered.map(renderRow)}</tbody>
                </Table>
              )}
            </Card>
          )}
        </>
      )}

      {newWOOpen && (
        <NewWorkOrderModal
          lang={lang}
          trucks={trucks}
          mechanics={mechanics}
          parts={parts}
          repairDescriptions={repairDescriptions}
          companySettings={companySettings}
          onClose={() => setNewWOOpen(false)}
          onCreated={() => {
            setNewWOOpen(false);
            router.refresh();
          }}
        />
      )}

      {editingWo && (
        <NewWorkOrderModal
          lang={lang}
          trucks={trucks}
          mechanics={mechanics}
          parts={parts}
          repairDescriptions={repairDescriptions}
          companySettings={companySettings}
          editingWorkOrder={editingWo}
          editingTasks={workOrderTasks.filter((tk) => tk.work_order_id === editingWo.id)}
          editingLines={workOrderParts.filter((l) => l.work_order_id === editingWo.id)}
          onClose={() => setEditingWoId(null)}
          onEdited={(wo) => {
            setEditingWoId(null);
            setViewingWoId(wo.id);
            router.refresh();
          }}
        />
      )}

      {viewingWo && (() => {
        const viewingLines = workOrderParts.filter((l) => l.work_order_id === viewingWo.id);
        const viewingLineIds = new Set(viewingLines.map((l) => l.id));
        return (
          <WorkOrderDetailModal
            lang={lang}
            workOrder={viewingWo}
            tasks={workOrderTasks.filter((tk) => tk.work_order_id === viewingWo.id)}
            lines={viewingLines}
            photos={workOrderPartPhotos.filter((p) => viewingLineIds.has(p.work_order_part_id))}
            truck={trucksById.get(viewingWo.truck_id) ?? null}
            mechanic={mechanicsById.get(viewingWo.assigned_mechanic_id) ?? null}
            parts={parts}
            onClose={() => setViewingWoId(null)}
            onEdit={() => openEdit(viewingWo.id)}
          />
        );
      })()}

      {newOsOpen && (
        <NewOutsourcedJobModal
          lang={lang}
          trucks={trucks}
          mechanics={mechanics}
          repairerTypes={repairerTypes}
          repairers={repairers}
          outsourcedDescriptions={outsourcedDescriptions}
          onClose={() => setNewOsOpen(false)}
          onCreated={() => {
            setNewOsOpen(false);
            router.refresh();
          }}
        />
      )}

      {editingOs && (
        <NewOutsourcedJobModal
          lang={lang}
          trucks={trucks}
          mechanics={mechanics}
          repairerTypes={repairerTypes}
          repairers={repairers}
          outsourcedDescriptions={outsourcedDescriptions}
          editingJob={editingOs}
          editingRepairerIds={repairerIdsByJob.get(editingOs.id) ?? []}
          editingTasks={outsourcedJobTasks.filter((tk) => tk.outsourced_job_id === editingOs.id)}
          onClose={() => setEditingOsId(null)}
          onEdited={(job) => {
            setEditingOsId(null);
            setViewingOsId(job.id);
            router.refresh();
          }}
        />
      )}

      {viewingOs && (
        <OutsourcedJobDetailModal
          lang={lang}
          job={viewingOs}
          tasks={outsourcedJobTasks.filter((tk) => tk.outsourced_job_id === viewingOs.id)}
          jobRepairers={jobRepairerObjs(viewingOs.id)}
          repairerTypes={repairerTypes}
          payments={workshopPayments.filter((p) => p.outsourced_job_id === viewingOs.id)}
          paymentFiles={workshopPaymentFiles.filter((f) =>
            workshopPayments.some((p) => p.outsourced_job_id === viewingOs.id && p.id === f.payment_id),
          )}
          truck={trucksById.get(viewingOs.truck_id) ?? null}
          mechanic={mechanicsById.get(viewingOs.responsible_mechanic_id) ?? null}
          onClose={() => setViewingOsId(null)}
          onEdit={() => openOsEdit(viewingOs.id)}
        />
      )}
    </div>
  );
}
