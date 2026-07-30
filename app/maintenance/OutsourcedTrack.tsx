"use client";

// Outsourced-jobs track — list + modals wiring. Separate file from
// MaintenanceClient.tsx (same modular split Inventory's own
// PurchaseOrders.tsx already established) since this track has its own
// full set of concerns (repairers, payments, invoices) distinct from
// in-house work orders. Rendered by MaintenanceClient when
// track === 'outsourced'.
//
// Sub-tabs are Scheduled / In Progress / Historical only — THREE, not
// four. There is no separate "Delayed" bucket here: estimated_finish is a
// soft target, red-in-view when exceeded, derived at display time
// (isOverdue), never a stored status or a fourth section — a job stays in
// whichever section its real status puts it, just tinted.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Eye } from "lucide-react";
import { Card, Stat, StatusPill, Btn, Table, TH, TD } from "@/components/ui";
import { t } from "@/lib/i18n";
import { cn, formatSar, todayKey } from "@/lib/utils";
import type {
  Truck,
  Staff,
  RepairerType,
  Repairer,
  OutsourcedDescription,
  OutsourcedJob,
  OutsourcedJobRepairer,
  OutsourcedJobTask,
  WorkshopPayment,
  WorkshopPaymentFile,
} from "@/lib/db-types";
import NewOutsourcedJobModal from "./NewOutsourcedJobModal";
import OutsourcedJobDetailModal from "./OutsourcedJobDetailModal";

type OsSection = "scheduled" | "in_progress" | "historical";

function isOverdue(job: OutsourcedJob): boolean {
  return job.status !== "completed" && job.estimated_finish < todayKey();
}

function sectionOf(job: OutsourcedJob): OsSection {
  if (job.status === "completed") return "historical";
  if (job.status === "in_progress") return "in_progress";
  return "scheduled";
}

export default function OutsourcedTrack({
  lang,
  trucks,
  mechanics,
  repairerTypes,
  repairers,
  outsourcedDescriptions,
  outsourcedJobs,
  outsourcedJobRepairers,
  outsourcedJobTasks,
  workshopPayments,
  workshopPaymentFiles,
}: {
  lang: "en" | "ar";
  trucks: Truck[];
  mechanics: Staff[];
  repairerTypes: RepairerType[];
  repairers: Repairer[];
  outsourcedDescriptions: OutsourcedDescription[];
  outsourcedJobs: OutsourcedJob[];
  outsourcedJobRepairers: OutsourcedJobRepairer[];
  outsourcedJobTasks: OutsourcedJobTask[];
  workshopPayments: WorkshopPayment[];
  workshopPaymentFiles: WorkshopPaymentFile[];
}) {
  const router = useRouter();
  const [section, setSection] = useState<OsSection>("scheduled");
  const [truckFilter, setTruckFilter] = useState("all");

  const [newOpen, setNewOpen] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const trucksById = useMemo(() => new Map(trucks.map((tr) => [tr.id, tr])), [trucks]);
  const mechanicsById = useMemo(() => new Map(mechanics.map((m) => [m.id, m])), [mechanics]);
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
    scheduled: withSections.filter((x) => x.section === "scheduled").length,
    in_progress: withSections.filter((x) => x.section === "in_progress").length,
    historical: withSections.filter((x) => x.section === "historical").length,
  };

  const filtered = useMemo(() => {
    return withSections
      .filter((x) => x.section === section)
      .filter((x) => truckFilter === "all" || x.j.truck_id === truckFilter)
      .map((x) => x.j)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [withSections, section, truckFilter]);

  const viewingJob = viewingId ? outsourcedJobs.find((j) => j.id === viewingId) ?? null : null;
  const editingJob = editingId ? outsourcedJobs.find((j) => j.id === editingId) ?? null : null;

  function openEdit(id: string) {
    setViewingId(null);
    setEditingId(id);
  }

  function jobRepairerObjs(jobId: string): Repairer[] {
    const ids = repairerIdsByJob.get(jobId) ?? [];
    return ids.map((id) => repairersById.get(id)).filter((r): r is Repairer => !!r);
  }

  return (
    <>
      <Card className="!p-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            {(["scheduled", "in_progress", "historical"] as OsSection[]).map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={cn("h-9 px-3 rounded-lg text-xs font-medium border", section === s ? "bg-brand-600 text-white border-brand-600" : "")}
                style={section !== s ? { borderColor: "rgb(var(--border))" } : undefined}
              >
                {s === "historical" ? t("mt.historical", lang) : t(`status.${s}`, lang)}
                <span className="ms-1 muted">{sectionCounts[s]}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
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
            <Btn variant="primary" onClick={() => setNewOpen(true)} disabled={trucks.length === 0}>
              <Plus className="h-4 w-4" />{t("mt.newOutsourcedJob", lang)}
            </Btn>
          </div>
        </div>
      </Card>

      <Card className="!p-0 overflow-hidden">
        {filtered.length === 0 ? (
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
            <tbody>
              {filtered.map((j) => {
                const truck = trucksById.get(j.truck_id);
                const overdue = isOverdue(j);
                const jRepairers = jobRepairerObjs(j.id);
                const cost = actualCostByJob.get(j.id) ?? 0;
                return (
                  <tr key={j.id} className={cn(overdue ? "bg-rose-500/5" : "")}>
                    <TD className="font-mono text-xs">{j.os_number}</TD>
                    <TD className="font-mono text-xs">{truck?.plate ?? j.truck_id}</TD>
                    <TD>{t(`status.${j.type}`, lang)}</TD>
                    <TD className="text-xs">
                      {jRepairers.length === 0 ? "—" : jRepairers.map((r) => (lang === "ar" ? r.name_ar || r.name : r.name)).join(", ")}
                    </TD>
                    <TD className="text-xs">{new Date(j.start_date).toLocaleDateString()}</TD>
                    <TD className={cn("text-xs", overdue ? "text-rose-600 font-medium" : "")}>{new Date(j.estimated_finish).toLocaleDateString()}</TD>
                    <TD>
                      {overdue ? (
                        <StatusPill status="critical" label={t("mt.osOverdue", lang)} />
                      ) : (
                        <StatusPill status={j.status} label={t(`status.${j.status}`, lang)} />
                      )}
                    </TD>
                    <TD className="tabular-nums">{formatSar(cost)}</TD>
                    <TD>
                      <Btn variant="outline" onClick={() => setViewingId(j.id)}><Eye className="h-3.5 w-3.5" />{t("mt.viewJob", lang)}</Btn>
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {newOpen && (
        <NewOutsourcedJobModal
          lang={lang}
          trucks={trucks}
          mechanics={mechanics}
          repairerTypes={repairerTypes}
          repairers={repairers}
          outsourcedDescriptions={outsourcedDescriptions}
          onClose={() => setNewOpen(false)}
          onCreated={() => {
            setNewOpen(false);
            router.refresh();
          }}
        />
      )}

      {editingJob && (
        <NewOutsourcedJobModal
          lang={lang}
          trucks={trucks}
          mechanics={mechanics}
          repairerTypes={repairerTypes}
          repairers={repairers}
          outsourcedDescriptions={outsourcedDescriptions}
          editingJob={editingJob}
          editingRepairerIds={repairerIdsByJob.get(editingJob.id) ?? []}
          editingTasks={outsourcedJobTasks.filter((tk) => tk.outsourced_job_id === editingJob.id)}
          onClose={() => setEditingId(null)}
          onEdited={(job) => {
            setEditingId(null);
            setViewingId(job.id);
            router.refresh();
          }}
        />
      )}

      {viewingJob && (
        <OutsourcedJobDetailModal
          lang={lang}
          job={viewingJob}
          tasks={outsourcedJobTasks.filter((tk) => tk.outsourced_job_id === viewingJob.id)}
          jobRepairers={jobRepairerObjs(viewingJob.id)}
          repairerTypes={repairerTypes}
          payments={workshopPayments.filter((p) => p.outsourced_job_id === viewingJob.id)}
          paymentFiles={workshopPaymentFiles.filter((f) =>
            workshopPayments.some((p) => p.outsourced_job_id === viewingJob.id && p.id === f.payment_id),
          )}
          truck={trucksById.get(viewingJob.truck_id) ?? null}
          mechanic={mechanicsById.get(viewingJob.responsible_mechanic_id) ?? null}
          onClose={() => setViewingId(null)}
          onEdit={() => openEdit(viewingJob.id)}
        />
      )}
    </>
  );
}
