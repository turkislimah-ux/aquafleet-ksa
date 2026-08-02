"use client";

// Outsourced-jobs track — list + filters. Separate file from
// MaintenanceClient.tsx (same modular split Inventory's own
// PurchaseOrders.tsx already established) since this track has its own
// full set of concerns (repairers, payments, invoices) distinct from
// in-house work orders. Rendered by MaintenanceClient when
// track === 'outsourced'.
//
// Sub-tabs: All / Scheduled / In Progress / Historical — matches preview's
// own OS status-filter set exactly (pages-2.js's osStatusCounts: all,
// scheduled, in_progress, completed). "All" here means every non-historical
// phase of THIS track (scheduled + in_progress) — Phase-3 fix, per Turki:
// an "All" view is always scoped to one track, never a cross-track merge.
// There is still no separate "Delayed" bucket: estimated_finish is a soft
// target, red-in-view when exceeded, derived at display time (isOverdue),
// never a stored status or its own section — a job stays in whichever
// section its real status puts it, just tinted.
//
// Phase-5 fixes:
// - "+ New Outsourced Job" moved OUT of this component entirely — it now
//   lives in MaintenanceClient's PageHeader action slot, same spot the
//   in-house "+ New Work Order" button sits (Turki's ask, matches the
//   demo). View/edit/detail-modal state moved up alongside it, since the
//   calendar (also owned by MaintenanceClient) needs to be able to open a
//   specific job's detail view from a day-cell pill click — this
//   component's own local state couldn't be reached from outside it.
//   `onViewJob` is the one way in now, mirroring MaintenanceClient's own
//   `setViewingWoId` callback for the in-house table.
// - `truckFilter` is now LIFTED and SHARED with the in-house table (was
//   its own separate local state) — matches preview exactly (one
//   `S.mtTruckFilter` used by both tracks, not two independent filters),
//   and lets the calendar apply the same truck filter to whichever
//   track's pills it's showing.
// - `selectedDate`/`onClearDate` wire this table to the shared calendar
//   day-click filter, same as the in-house table already had (was never
//   wired here at all before — clicking a day never affected the OS list).
// - Group-by-truck added, mirroring the in-house table's own
//   expandedTrucks/groups pattern exactly (was in-house-only before).

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Eye, Layers, X } from "lucide-react";
import { Card, Btn, Table, TH, TD } from "@/components/ui";
import MtStatusPill, { type MtPillKind } from "./MtStatusPill";
import { t } from "@/lib/i18n";
import { cn, formatSar, todayKey } from "@/lib/utils";
import type {
  Truck,
  RepairerType,
  Repairer,
  OutsourcedJob,
  OutsourcedJobRepairer,
  WorkshopPayment,
} from "@/lib/db-types";

type OsSection = "all" | "scheduled" | "in_progress" | "historical";

function isOverdue(job: OutsourcedJob): boolean {
  return job.status !== "completed" && job.estimated_finish < todayKey();
}

function sectionOf(job: OutsourcedJob): OsSection {
  if (job.status === "completed") return "historical";
  if (job.status === "in_progress") return "in_progress";
  return "scheduled";
}

function osKind(status: OutsourcedJob["status"]): MtPillKind {
  if (status === "completed") return "completed";
  if (status === "in_progress") return "in_progress";
  return "scheduled";
}

export default function OutsourcedTrack({
  lang,
  trucks,
  truckFilter,
  onTruckFilterChange,
  selectedDate,
  onClearDate,
  onViewJob,
  repairerTypes,
  repairers,
  outsourcedJobs,
  outsourcedJobRepairers,
  workshopPayments,
}: {
  lang: "en" | "ar";
  trucks: Truck[];
  truckFilter: string;
  onTruckFilterChange: (id: string) => void;
  selectedDate: string | null;
  onClearDate: () => void;
  onViewJob: (id: string) => void;
  repairerTypes: RepairerType[];
  repairers: Repairer[];
  outsourcedJobs: OutsourcedJob[];
  outsourcedJobRepairers: OutsourcedJobRepairer[];
  workshopPayments: WorkshopPayment[];
}) {
  const [section, setSection] = useState<OsSection>("all");
  const [groupByTruck, setGroupByTruck] = useState(false);
  const [expandedTrucks, setExpandedTrucks] = useState<Set<string>>(new Set(trucks.map((tr) => tr.id)));

  const trucksById = useMemo(() => new Map(trucks.map((tr) => [tr.id, tr])), [trucks]);
  const repairersById = useMemo(() => new Map(repairers.map((r) => [r.id, r])), [repairers]);

  const repairerIdsByJob = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const jr of outsourcedJobRepairers) {
      const arr = m.get(jr.outsourced_job_id) ?? [];
      arr.push(jr.repairer_id);
      m.set(jr.outsourced_job_id, arr);
    }
    return m;
  }, [outsourcedJobRepairers]);

  const actualCostByJob = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of workshopPayments) {
      m.set(p.outsourced_job_id, (m.get(p.outsourced_job_id) ?? 0) + p.grand_total_sar);
    }
    return m;
  }, [workshopPayments]);

  const withSections = useMemo(() => outsourcedJobs.map((j) => ({ j, section: sectionOf(j) })), [outsourcedJobs]);

  const sectionCounts: Record<OsSection, number> = {
    all: withSections.filter((x) => x.section !== "historical").length,
    scheduled: withSections.filter((x) => x.section === "scheduled").length,
    in_progress: withSections.filter((x) => x.section === "in_progress").length,
    historical: withSections.filter((x) => x.section === "historical").length,
  };

  const filtered = useMemo(() => {
    return withSections
      .filter((x) => (section === "all" ? x.section !== "historical" : x.section === section))
      .filter((x) => truckFilter === "all" || x.j.truck_id === truckFilter)
      .filter((x) => !selectedDate || x.j.start_date === selectedDate)
      .map((x) => x.j)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [withSections, section, truckFilter, selectedDate]);

  const groups = useMemo(() => {
    if (!groupByTruck || truckFilter !== "all") return null;
    const m = new Map<string, OutsourcedJob[]>();
    for (const j of filtered) {
      const arr = m.get(j.truck_id) ?? [];
      arr.push(j);
      m.set(j.truck_id, arr);
    }
    return m;
  }, [filtered, groupByTruck, truckFilter]);

  function truckRollup(truckId: string) {
    const rows = withSections.filter((x) => x.j.truck_id === truckId);
    return {
      scheduled: rows.filter((x) => x.section === "scheduled").length,
      in_progress: rows.filter((x) => x.section === "in_progress").length,
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

  function jobRepairerObjs(jobId: string): Repairer[] {
    const ids = repairerIdsByJob.get(jobId) ?? [];
    return ids.map((id) => repairersById.get(id)).filter((r): r is Repairer => !!r);
  }

  function renderRow(j: OutsourcedJob, groupedView: boolean) {
    const truck = trucksById.get(j.truck_id);
    const overdue = isOverdue(j);
    const jRepairers = jobRepairerObjs(j.id);
    const cost = actualCostByJob.get(j.id) ?? 0;
    return (
      <tr key={j.id} className={cn(overdue ? "bg-rose-500/5" : "")}>
        <TD className="font-mono text-xs">{j.os_number}</TD>
        {!groupedView && (
          <TD className="font-mono text-xs">{truck?.plate ?? j.truck_id}</TD>
        )}
        <TD>{t(`status.${j.type}`, lang)}</TD>
        <TD className="text-xs">
          {jRepairers.length === 0 ? "—" : jRepairers.map((r) => (lang === "ar" ? r.name_ar || r.name : r.name)).join(", ")}
        </TD>
        <TD className="text-xs">{new Date(j.start_date).toLocaleDateString()}</TD>
        <TD className={cn("text-xs", overdue ? "text-rose-600 font-medium" : "")}>{new Date(j.estimated_finish).toLocaleDateString()}</TD>
        <TD>
          {overdue ? (
            <MtStatusPill kind="overdue" label={t("mt.osOverdue", lang)} />
          ) : (
            <MtStatusPill kind={osKind(j.status)} label={t(`status.${j.status}`, lang)} />
          )}
        </TD>
        <TD className="tabular-nums">{formatSar(cost)}</TD>
        <TD>
          <Btn variant="outline" onClick={() => onViewJob(j.id)}><Eye className="h-3.5 w-3.5" />{t("mt.viewJob", lang)}</Btn>
        </TD>
      </tr>
    );
  }

  return (
    <>
      <Card className="!p-0 overflow-hidden">
        <div className={cn("flex items-center justify-between gap-3 flex-wrap p-3", !groups && "border-b")} style={!groups ? { borderColor: "rgb(var(--border))" } : undefined}>
          <div className="flex items-center gap-1 flex-wrap">
            {(["all", "scheduled", "in_progress", "historical"] as OsSection[]).map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={cn("h-9 px-3 rounded-lg text-xs font-medium border", section === s ? "bg-brand-600 text-white border-brand-600" : "")}
                style={section !== s ? { borderColor: "rgb(var(--border))" } : undefined}
              >
                {s === "all" ? t("mt.all", lang) : s === "historical" ? t("mt.historical", lang) : t(`status.${s}`, lang)}
                <span className="ms-1 muted">{sectionCounts[s]}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selectedDate && (
              <button
                onClick={onClearDate}
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
            <span className="text-xs muted">{t("common.truck", lang)}:</span>
            <select
              value={truckFilter}
              onChange={(e) => onTruckFilterChange(e.target.value)}
              className="h-9 px-2.5 rounded-lg text-xs border w-44"
              style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
            >
              <option value="all">{t("common.all", lang)}</option>
              {trucks.map((tr) => (
                <option key={tr.id} value={tr.id}>{tr.plate}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Polish P2 item 5 — table attached directly to the filter
            header (one connected unit, like the demo). Only when
            ungrouped: grouped-by-truck renders its own per-truck cards
            below instead, no single table to attach to. */}
        {!groups && (
          filtered.length === 0 ? (
            <p className="text-sm muted p-6 text-center">{t("mt.osNoJobs", lang)}</p>
          ) : (
            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>OS</TH>
                  <TH>{t("common.truck", lang)}</TH>
                  <TH>{t("common.type", lang)}</TH>
                  <TH>{t("mt.repairers", lang)}</TH>
                  <TH>{t("mt.startDate", lang)}</TH>
                  <TH>{t("mt.estimatedFinish", lang)}</TH>
                  <TH>{t("common.status", lang)}</TH>
                  <TH>{t("mt.actualCost", lang)}</TH>
                  <TH></TH>
                </tr>
              </thead>
              <tbody>{filtered.map((j) => renderRow(j, false))}</tbody>
            </Table>
          )
        )}
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
                    <span className="rounded px-1.5 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">{t("mt.historical", lang)} {rollup.historical}</span>
                  </div>
                </button>
                {expanded && (
                  <Table>
                    <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                      <tr>
                        <TH>OS</TH>
                        <TH>{t("common.type", lang)}</TH>
                        <TH>{t("mt.repairers", lang)}</TH>
                        <TH>{t("mt.startDate", lang)}</TH>
                        <TH>{t("mt.estimatedFinish", lang)}</TH>
                        <TH>{t("common.status", lang)}</TH>
                        <TH>{t("mt.actualCost", lang)}</TH>
                        <TH></TH>
                      </tr>
                    </thead>
                    <tbody>{rows.map((j) => renderRow(j, true))}</tbody>
                  </Table>
                )}
              </Card>
            );
          })}
          {groups.size === 0 && (
            <Card><p className="text-sm muted p-6 text-center">{t("mt.osNoJobs", lang)}</p></Card>
          )}
        </div>
      ) : null}
    </>
  );
}
