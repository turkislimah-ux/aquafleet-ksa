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

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ChevronDown, ChevronRight, Eye, Layers, X, AlertTriangle } from "lucide-react";
import { PageHeader, Card, Stat, StatusPill, Btn, Table, TH, TD } from "@/components/ui";
import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";
import { cn, formatSar } from "@/lib/utils";
import type { Truck, Staff, Part, RepairDescription, WorkOrder, WorkOrderTask, WorkOrderPart, CompanySettings } from "@/lib/db-types";
import MaintenanceCalendar from "./MaintenanceCalendar";
import NewWorkOrderModal from "./NewWorkOrderModal";
import WorkOrderDetailModal from "./WorkOrderDetailModal";

type Section = "scheduled" | "in_progress" | "delayed" | "historical";

function isWoDelayed(w: WorkOrder): boolean {
  return w.status !== "completed" && w.status !== "cancelled" && new Date(w.due_by).getTime() < Date.now();
}

function sectionOf(w: WorkOrder): Section {
  if (isWoDelayed(w)) return "delayed";
  if (w.status === "completed" || w.status === "cancelled") return "historical";
  if (w.status === "in_progress" || w.status === "awaiting_parts") return "in_progress";
  return "scheduled";
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function MaintenanceClient({
  trucks,
  mechanics,
  parts,
  repairDescriptions,
  workOrders,
  workOrderTasks,
  workOrderParts,
  companySettings,
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
  companySettings: CompanySettings | null;
  currentUserEmail: string | null;
  error: string | null;
}) {
  const { lang } = useApp();
  const router = useRouter();

  const [track, setTrack] = useState<"in_house" | "outsourced">("in_house");
  const [section, setSection] = useState<Section>("scheduled");
  const [truckFilter, setTruckFilter] = useState<string>("all");
  const [groupByTruck, setGroupByTruck] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expandedTrucks, setExpandedTrucks] = useState<Set<string>>(new Set(trucks.map((tr) => tr.id)));

  const [newWOOpen, setNewWOOpen] = useState(false);
  const [viewingWoId, setViewingWoId] = useState<string | null>(null);
  const [editingWoId, setEditingWoId] = useState<string | null>(null);

  const trucksById = useMemo(() => new Map(trucks.map((tr) => [tr.id, tr])), [trucks]);
  const mechanicsById = useMemo(() => new Map(mechanics.map((m) => [m.id, m])), [mechanics]);
  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

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
    scheduled: kpiScheduled,
    in_progress: kpiInProgress,
    delayed: kpiDelayed,
    historical: withSections.filter((x) => x.section === "historical").length,
  };

  const filtered = useMemo(() => {
    return withSections
      .filter((x) => x.section === section)
      .filter((x) => truckFilter === "all" || x.w.truck_id === truckFilter)
      .filter((x) => !selectedDate || ymd(new Date(x.w.due_by)) === selectedDate)
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
            <StatusPill status="critical" label={t("mt.outOfPart", lang)} />
          ) : delayed ? (
            <StatusPill status="critical" label={t("mt.delayed", lang)} />
          ) : (
            <StatusPill status={w.status} label={t(`status.${w.status}`, lang)} />
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
          ) : undefined
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
        <Stat label={t("mt.outsourced", lang)} value={0} sub={lang === "en" ? "Coming in a later phase" : "قادم في مرحلة لاحقة"} />
      </div>

      <MaintenanceCalendar
        lang={lang}
        workOrders={workOrders}
        trucks={trucks}
        truckFilter={truckFilter}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        onOpenWorkOrder={setViewingWoId}
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
            {t("mt.outsourced", lang)} (0)
          </button>
        </div>
      </Card>

      {track === "outsourced" ? (
        <Card>
          <p className="text-sm muted p-6 text-center">{t("mt.outsourcedComingSoon", lang)}</p>
        </Card>
      ) : (
        <>
          <Card className="!p-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-1 flex-wrap">
                {(["scheduled", "in_progress", "delayed", "historical"] as Section[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSection(s)}
                    className={cn("h-9 px-3 rounded-lg text-xs font-medium border", section === s ? "bg-brand-600 text-white border-brand-600" : "")}
                    style={section !== s ? { borderColor: "rgb(var(--border))" } : undefined}
                  >
                    {s === "historical" ? t("mt.historical", lang) : s === "delayed" ? t("mt.delayed", lang) : t(`status.${s}`, lang)}
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
                        <span className="rounded px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-300">{t("status.in_progress", lang)} {rollup.in_progress}</span>
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
                            <TH>{lang === "en" ? "Est. Cost" : "تكلفة تقديرية"}</TH>
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
                      <TH>{lang === "en" ? "Est. Cost" : "تكلفة تقديرية"}</TH>
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

      {viewingWo && (
        <WorkOrderDetailModal
          lang={lang}
          workOrder={viewingWo}
          tasks={workOrderTasks.filter((tk) => tk.work_order_id === viewingWo.id)}
          lines={workOrderParts.filter((l) => l.work_order_id === viewingWo.id)}
          truck={trucksById.get(viewingWo.truck_id) ?? null}
          mechanic={mechanicsById.get(viewingWo.assigned_mechanic_id) ?? null}
          parts={parts}
          onClose={() => setViewingWoId(null)}
          onEdit={() => openEdit(viewingWo.id)}
        />
      )}
    </div>
  );
}
