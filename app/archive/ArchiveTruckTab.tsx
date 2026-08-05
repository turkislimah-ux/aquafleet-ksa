"use client";

// Archive — Phase 3: the TRUCK tab.
//
// A LEAF module, exactly like ArchiveStaffTab: imports from lib/ and
// components/ only, mounts NO modals of its own, and reaches every popup
// through callbacks ArchiveClient owns. One-way import edge, structurally.
//
// THE MATRIX is the same idea as the Staff tab's, with the truck as the
// subject: every ACTIVE truck gets a row in every group whether or not it has
// that document, because the gap is the finding. Empty rows are DERIVED at
// read (trucks x their documents in this group, joined in memory) — no
// placeholder document is ever written, so nothing needs cleaning up when a
// truck is added, terminated, or a group is edited.
//
// WHY A SEPARATE FILE rather than generalising ArchiveStaffTab: the two tabs
// share a shape but not their content. Trucks have plate/model/capacity where
// people have name/role, and the sub-tabs are entirely different (maintenance
// history and terminated trucks vs. commission history and terminated
// people). Forcing one component to serve both would mean a prop for every
// difference — more branching than duplication, and every future change to
// one tab would have to be reasoned about for the other.

import { Fragment, useMemo, useState } from "react";
import {
  Plus, Pencil, Trash2, ChevronDown, ChevronRight, RefreshCw, FileText,
  CornerDownRight, History, Eye, RotateCcw, X, Wrench, ArrowRight,
} from "lucide-react";
import { Card, Btn, Table, TH, TD } from "@/components/ui";
import { LinkPill } from "./ArchiveModals";
import { getMaintenanceJobDetail, type MaintenanceJobDetail } from "./actions";
import { cn } from "@/lib/utils";
import {
  docStatus, ARCHIVE_STATUS_ROW_TONE, ARCHIVE_STATUS_PILL, archiveStatusLabel,
  groupAccent, groupDot, linkedFieldFor, linkedFieldForDoc, readPersonLink,
  PERSON_ID_LABEL,
} from "@/lib/archive";
import type {
  ArchiveDocumentGroup,
  ArchiveDocument,
  ArchiveDocumentFile,
  ArchiveDocumentRenewal,
  ArchiveDocumentType,
  ArchiveTruckRow,
} from "@/lib/db-types";

// Narrow shapes matching EXACTLY what app/archive/page.tsx selects. Not the
// full WorkOrder / OutsourcedJob types: those claim a couple of dozen columns
// this tab neither needs nor fetches, and a type that overstates its select is
// the lie the maintenance cleanup pass went out of its way to avoid.
export type ArchiveTruckTabWorkOrder = {
  id: string;
  wo_number: string;
  truck_id: string;
  title: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  actual_cost_sar: number | null;
};

export type ArchiveTruckTabOutsourcedJob = {
  id: string;
  os_number: string;
  truck_id: string;
  title: string;
  status: string;
  start_date: string;
  closed_at: string | null;
};

export type TruckSubTab = "documents" | "maintenance" | "deleted";

export const TRUCK_SUB_TABS: { key: TruckSubTab; label: string }[] = [
  { key: "documents", label: "Documents" },
  { key: "maintenance", label: "Maintenance History" },
  { key: "deleted", label: "Soft-deleted" },
];

// Same reasoning as the Staff tab's: "Missing" is a ROW state, never a member
// of ArchiveDocStatus — that union feeds expirySummary(), and a gap is not an
// expiry.
const MISSING_PILL =
  "bg-slate-500/10 text-slate-600 dark:text-slate-400 ring-slate-500/25";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString();
}

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function truckLabel(t: ArchiveTruckRow): string {
  return t.plate;
}

export default function ArchiveTruckTab({
  subTab,
  groups,
  documents,
  filesByDoc,
  renewalsByDoc,
  trucks,
  types,
  workOrders,
  outsourcedJobs,
  today,
  highlightTruckId,
  onAddDocument,
  onEditDocument,
  onRenewDocument,
  onDeleteDocument,
  onOpenDocument,
  onOpenFile,
  onEditGroup,
  onDeleteGroup,
  onRestoreTruck,
}: {
  subTab: TruckSubTab;
  groups: ArchiveDocumentGroup[];
  documents: ArchiveDocument[];
  filesByDoc: Map<string, ArchiveDocumentFile[]>;
  renewalsByDoc: Map<string, ArchiveDocumentRenewal[]>;
  trucks: ArchiveTruckRow[];
  types: ArchiveDocumentType[];
  // READ-ONLY feeds for the maintenance sub-tab. The archive DISPLAYS this
  // history; it never copies it into a table of its own.
  workOrders: ArchiveTruckTabWorkOrder[];
  outsourcedJobs: ArchiveTruckTabOutsourcedJob[];
  today: string;
  highlightTruckId: string | null;
  onAddDocument: (group: ArchiveDocumentGroup, truck: ArchiveTruckRow) => void;
  onEditDocument: (doc: ArchiveDocument, group: ArchiveDocumentGroup, truck: ArchiveTruckRow) => void;
  onRenewDocument: (doc: ArchiveDocument) => void;
  onDeleteDocument: (doc: ArchiveDocument) => void;
  onOpenDocument: (doc: ArchiveDocument) => void;
  onOpenFile: (path: string) => void;
  onEditGroup: (group: ArchiveDocumentGroup) => void;
  onDeleteGroup: (group: ArchiveDocumentGroup) => void;
  onRestoreTruck: (t: ArchiveTruckRow) => void;
}) {
  const typesByKey = useMemo(() => new Map(types.map((t) => [t.key, t])), [types]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [historyDocId, setHistoryDocId] = useState<string | null>(null);
  const [detailTruck, setDetailTruck] = useState<ArchiveTruckRow | null>(null);
  const [maintTruckId, setMaintTruckId] = useState<string>("all");
  // Maintenance detail is LAZY — fetched when a row is clicked, not loaded
  // with the page. See getMaintenanceJobDetail's own note for why.
  const [jobDetail, setJobDetail] = useState<MaintenanceJobDetail | null>(null);
  const [jobLoading, setJobLoading] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);

  async function openJob(kind: "in_house" | "outsourced", id: string) {
    setJobLoading(id);
    setJobError(null);
    const res = await getMaintenanceJobDetail(kind, id);
    setJobLoading(null);
    if ("error" in res && res.error) {
      setJobError(res.error);
      return;
    }
    setJobDetail(res as MaintenanceJobDetail);
  }

  // ACTIVE = the app-wide soft-delete convention (0020), same pre-filter the
  // Staff tab applies: terminated trucks drop out of the matrix entirely and
  // reappear under Soft-deleted, rather than rendering as some "terminated"
  // status inside it.
  const activeTrucks = useMemo(
    () =>
      trucks
        .filter((t) => t.active && !t.terminated_at)
        .sort((a, b) => a.plate.localeCompare(b.plate)),
    [trucks],
  );

  const terminatedTrucks = useMemo(
    () => trucks.filter((t) => t.terminated_at || !t.active),
    [trucks],
  );

  const trucksById = useMemo(() => new Map(trucks.map((t) => [t.id, t])), [trucks]);

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // -------------------------------------------------------------------------
  // DOCUMENTS — the compliance matrix.
  // -------------------------------------------------------------------------
  if (subTab === "documents") {
    if (groups.length === 0) {
      return (
        <Card>
          <div className="p-8 text-center">
            <p className="text-sm muted">No truck document groups yet.</p>
            <p className="text-xs muted mt-1">
              Create a group (e.g. Registration, Insurance, Inspection) — every truck then gets a
              row in it automatically.
            </p>
          </div>
        </Card>
      );
    }

    if (activeTrucks.length === 0) {
      return (
        <Card>
          <p className="text-sm muted p-6 text-center">No active trucks to track documents for.</p>
        </Card>
      );
    }

    return (
      <div className="space-y-3">
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.id);
          // Decided ONCE per group — 0089/0091 put the type on the group, so
          // every row in it agrees about whether it is linked.
          const groupTypeRow = g.type_key ? typesByKey.get(g.type_key) ?? null : null;
          const linkField = linkedFieldFor(groupTypeRow, "truck");

          // The LEFT JOIN, in memory. Trucks drive the rows.
          const rows = activeTrucks.map((truck) => ({
            truck,
            docs: documents.filter((d) => d.group_id === g.id && d.truck_id === truck.id),
          }));

          const missing = rows.filter((r) => r.docs.length === 0).length;
          // Expiry comes from the TRUCK for a linked group — same source the
          // row pills use, so header and rows can never disagree.
          const expired = rows.reduce((n, r) => {
            const linkedExpiry = linkField ? readPersonLink(linkField, r.truck).expiry : null;
            return (
              n +
              r.docs.filter(
                (d) =>
                  docStatus(linkField ? linkedExpiry : d.expiry_date, g.warning_days, today) ===
                  "expired",
              ).length
            );
          }, 0);

          return (
            <Card key={g.id} className={cn("!p-0 overflow-hidden border-s-4", groupAccent(g.color))}>
              <div
                className="flex items-start justify-between gap-3 p-3 flex-wrap border-b"
                style={{ borderColor: "rgb(var(--border))" }}
              >
                <button
                  onClick={() => toggleCollapsed(g.id)}
                  className="flex items-start gap-2 text-start flex-1 min-w-0"
                >
                  {isCollapsed ? <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" /> : <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" />}
                  <span className={cn("h-2.5 w-2.5 rounded-full mt-1.5 shrink-0", groupDot(g.color))} />
                  <span className="min-w-0">
                    <span className="font-semibold block truncate">{g.title}</span>
                    {g.description && <span className="text-xs muted block">{g.description}</span>}
                    <span className="text-[11px] muted block mt-0.5">
                      {groupTypeRow ? `${groupTypeRow.label_en} · ` : ""}
                      {activeTrucks.length} truck{activeTrucks.length === 1 ? "" : "s"} · warns at{" "}
                      {g.warning_days}d
                    </span>
                  </span>
                </button>

                <div className="flex items-center gap-1 shrink-0">
                  {linkField && <LinkPill />}
                  {missing > 0 && (
                    <span className={cn("text-xs px-2 py-1 rounded-full ring-1 ring-inset font-medium", MISSING_PILL)}>
                      {missing} missing
                    </span>
                  )}
                  {expired > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full ring-1 ring-inset font-medium bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20">
                      {expired} expired
                    </span>
                  )}
                  <button
                    onClick={() => onEditGroup(g)}
                    className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                    title="Edit group"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onDeleteGroup(g)}
                    className="h-8 w-8 rounded-lg grid place-items-center text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                    title="Delete group"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {!isCollapsed && (
                <Table>
                  <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                    <tr>
                      <TH>Truck</TH>
                      <TH>Reference / ID no.</TH>
                      <TH>Issued</TH>
                      <TH>Expires</TH>
                      <TH>Note</TH>
                      <TH>Files</TH>
                      <TH>Status</TH>
                      <TH>{null}</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ truck, docs }) => {
                      if (docs.length === 0) {
                        return (
                          <tr
                            key={truck.id}
                            data-truck={truck.id}
                            className={cn(
                              "bg-slate-500/[0.04]",
                              truck.id === highlightTruckId && "ring-2 ring-inset ring-brand-500",
                            )}
                          >
                            <TD>
                              <span className="font-medium">{truckLabel(truck)}</span>
                              {truck.model && <div className="text-[11px] muted">{truck.model}</div>}
                            </TD>
                            <TD className="text-xs muted">—</TD>
                            <TD className="text-xs muted">—</TD>
                            <TD className="text-xs muted">—</TD>
                            <TD className="text-xs muted">—</TD>
                            <TD className="text-xs muted">—</TD>
                            <TD>
                              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", MISSING_PILL)}>
                                Missing
                              </span>
                            </TD>
                            <TD>
                              <div className="flex items-center justify-end">
                                <Btn variant="outline" onClick={() => onAddDocument(g, truck)}>
                                  <Plus className="h-3.5 w-3.5" />Add
                                </Btn>
                              </div>
                            </TD>
                          </tr>
                        );
                      }

                      return (
                        <Fragment key={truck.id}>
                          {docs.map((d, i) => {
                            // Resolved from the DOCUMENT's own truck_id, not
                            // from the group's kind — the same fix that cured
                            // the iqama both-populations bug, extended here so
                            // that class of defect cannot reappear for trucks.
                            const rowField = linkedFieldForDoc(groupTypeRow, d) ?? linkField;
                            const link = rowField ? readPersonLink(rowField, truck) : null;
                            const effectiveExpiry = link ? link.expiry : d.expiry_date;
                            const status = docStatus(effectiveExpiry, g.warning_days, today);
                            const docFiles = (filesByDoc.get(d.id) ?? []).filter((f) => f.renewal_id === null);
                            const docRenewals = renewalsByDoc.get(d.id) ?? [];
                            const showingHistory = historyDocId === d.id;
                            return (
                              <Fragment key={d.id}>
                                <tr
                                  data-truck={truck.id}
                                  onClick={() => onOpenDocument(d)}
                                  className={cn(
                                    "cursor-pointer",
                                    ARCHIVE_STATUS_ROW_TONE[status],
                                    i === 0 && truck.id === highlightTruckId && "ring-2 ring-inset ring-brand-500",
                                  )}
                                >
                                  <TD>
                                    {i === 0 ? (
                                      <>
                                        <span className="font-medium">{truckLabel(truck)}</span>
                                        {truck.model && <div className="text-[11px] muted">{truck.model}</div>}
                                        {docs.length > 1 && (
                                          <div className="text-[11px] muted mt-0.5">{docs.length} documents</div>
                                        )}
                                      </>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-xs muted ps-3">
                                        <CornerDownRight className="h-3 w-3" />
                                        {d.title}
                                      </span>
                                    )}
                                  </TD>
                                  <TD className="font-mono text-xs">
                                    {rowField ? (
                                      <>
                                        {link?.number || "—"}
                                        <span className="block font-sans text-[10px] muted">
                                          {PERSON_ID_LABEL[rowField]}
                                        </span>
                                      </>
                                    ) : (
                                      d.reference_no || "—"
                                    )}
                                  </TD>
                                  <TD className="text-xs">{fmtDate(d.issue_date)}</TD>
                                  <TD className="text-xs">{fmtDate(effectiveExpiry)}</TD>
                                  <TD className="text-xs">
                                    {d.note ? (
                                      <span className="block truncate max-w-[180px]" title={d.note}>{d.note}</span>
                                    ) : (
                                      <span className="muted">—</span>
                                    )}
                                  </TD>
                                  <TD>
                                    {docFiles.length === 0 ? (
                                      <span className="text-xs muted">—</span>
                                    ) : (
                                      <div className="flex items-center gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
                                        {docFiles.map((f) => (
                                          <button
                                            key={f.id}
                                            onClick={() => onOpenFile(f.storage_path)}
                                            className="inline-flex items-center gap-1 text-[11px] rounded border px-1.5 py-0.5 hover:bg-black/5 dark:hover:bg-white/5 max-w-[120px]"
                                            style={{ borderColor: "rgb(var(--border))" }}
                                            title={f.file_name}
                                          >
                                            <FileText className="h-3 w-3 shrink-0" />
                                            <span className="truncate">{f.file_name}</span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </TD>
                                  <TD>
                                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", ARCHIVE_STATUS_PILL[status])}>
                                      {archiveStatusLabel(status, effectiveExpiry, today)}
                                    </span>
                                  </TD>
                                  <TD>
                                    <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                                      {docRenewals.length > 0 && (
                                        <button
                                          onClick={() => setHistoryDocId(showingHistory ? null : d.id)}
                                          className={cn(
                                            "inline-flex items-center gap-1 text-[11px] rounded-lg border px-2 py-1 hover:bg-black/5 dark:hover:bg-white/5",
                                            showingHistory && "bg-black/5 dark:bg-white/5",
                                          )}
                                          style={{ borderColor: "rgb(var(--border))" }}
                                          title="Renewal history"
                                        >
                                          <History className="h-3.5 w-3.5" />
                                          {docRenewals.length}
                                        </button>
                                      )}
                                      <Btn variant="outline" onClick={() => onRenewDocument(d)}>
                                        <RefreshCw className="h-3.5 w-3.5" />Renew
                                      </Btn>
                                      <button
                                        onClick={() => onEditDocument(d, g, truck)}
                                        className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                                        title="Edit document"
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </button>
                                      {/* Another document for the SAME truck in
                                          this group — allowed only for
                                          non-linked types; a linked group is
                                          one-per-truck and 0091's trigger
                                          refuses a second, so the affordance
                                          is hidden rather than offered and
                                          then rejected. */}
                                      {i === docs.length - 1 && !linkField && (
                                        <button
                                          onClick={() => onAddDocument(g, truck)}
                                          className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                                          title={`Add another document for ${truck.plate}`}
                                        >
                                          <Plus className="h-4 w-4" />
                                        </button>
                                      )}
                                      <button
                                        onClick={() => onDeleteDocument(d)}
                                        className="h-8 w-8 rounded-lg grid place-items-center text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                                        title="Delete document"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </TD>
                                </tr>

                                {showingHistory && docRenewals.map((r) => {
                                  const rFiles = (filesByDoc.get(d.id) ?? []).filter((f) => f.renewal_id === r.id);
                                  return (
                                    <tr key={r.id} className="bg-black/[0.02] dark:bg-white/[0.02]">
                                      <TD className="text-xs muted ps-8">
                                        Previous version
                                        <div className="text-[11px]">
                                          superseded {new Date(r.superseded_at).toLocaleDateString()}
                                          {r.superseded_by ? ` · ${r.superseded_by}` : ""}
                                        </div>
                                      </TD>
                                      <TD className="font-mono text-xs muted">{rowField ? "—" : (r.reference_no || "—")}</TD>
                                      <TD className="text-xs muted">{fmtDate(r.issue_date)}</TD>
                                      <TD className="text-xs muted">{rowField ? "—" : fmtDate(r.expiry_date)}</TD>
                                      <TD className="text-xs muted">{r.note || "—"}</TD>
                                      <TD>
                                        {rFiles.length === 0 ? (
                                          <span className="text-xs muted">—</span>
                                        ) : (
                                          <div className="flex items-center gap-1 flex-wrap">
                                            {rFiles.map((f) => (
                                              <button
                                                key={f.id}
                                                onClick={() => onOpenFile(f.storage_path)}
                                                className="inline-flex items-center gap-1 text-[11px] rounded border px-1.5 py-0.5 hover:bg-black/5 dark:hover:bg-white/5 max-w-[120px] muted"
                                                style={{ borderColor: "rgb(var(--border))" }}
                                                title={f.file_name}
                                              >
                                                <FileText className="h-3 w-3 shrink-0" />
                                                <span className="truncate">{f.file_name}</span>
                                              </button>
                                            ))}
                                          </div>
                                        )}
                                      </TD>
                                      <TD><span className="text-xs muted">Superseded</span></TD>
                                      <TD>{null}</TD>
                                    </tr>
                                  );
                                })}
                              </Fragment>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Card>
          );
        })}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // MAINTENANCE HISTORY — READ-ONLY over work_orders + outsourced_jobs.
  //
  // The archive DISPLAYS this; it never copies it. There is no archive-side
  // maintenance table and no write path here — the Maintenance page stays the
  // single place a job is created or edited. Both feeds already key off
  // truck_id, so this needed no migration at all.
  //
  // The two are merged into ONE list rather than shown side by side: from a
  // truck's point of view "who fixed it and when" is one history, and the
  // in-house/outsourced split is an attribute of a job, not a reason to make
  // the reader check two tables and interleave the dates themselves.
  // -------------------------------------------------------------------------
  if (subTab === "maintenance") {
    type Row = {
      id: string;
      kind: "in_house" | "outsourced";
      ref: string;
      truckId: string;
      title: string;
      status: string;
      opened: string;
      closed: string | null;
      cost: number | null;
    };

    const rows: Row[] = [
      ...workOrders.map((w) => ({
        id: w.id,
        kind: "in_house" as const,
        ref: w.wo_number,
        truckId: w.truck_id,
        title: w.title,
        status: w.status,
        opened: w.opened_at,
        closed: w.closed_at,
        // Parts-only actual cost (0079's boundary — labour is NOT summed in).
        cost: w.actual_cost_sar,
      })),
      ...outsourcedJobs.map((o) => ({
        id: o.id,
        kind: "outsourced" as const,
        ref: o.os_number,
        truckId: o.truck_id,
        title: o.title,
        status: o.status,
        opened: o.start_date,
        closed: o.closed_at,
        // Outsourced cost lives in workshop payments, not on the job row —
        // shown as "—" rather than a fabricated 0.
        cost: null,
      })),
    ]
      .filter((r) => maintTruckId === "all" || r.truckId === maintTruckId)
      .sort((a, b) => (b.opened ?? "").localeCompare(a.opened ?? ""));

    return (
      <Card className="!p-0 overflow-hidden">
        <div
          className="flex items-center justify-between gap-3 p-3 border-b flex-wrap"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <div>
            <span className="font-semibold block">Maintenance History</span>
            <span className="text-[11px] muted">
              Read-only — in-house work orders and outsourced jobs, newest first.
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="muted text-xs">Truck</span>
            <select
              value={maintTruckId}
              onChange={(e) => setMaintTruckId(e.target.value)}
              className="px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
              style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
            >
              <option value="all">All trucks</option>
              {/* Every truck, terminated included — a terminated truck's
                  history is exactly the kind of thing an archive is for. */}
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>{t.plate}</option>
              ))}
            </select>
          </div>
        </div>

        {jobError && (
          <div className="m-3 rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">
            {jobError}
          </div>
        )}

        {rows.length === 0 ? (
          <p className="text-sm muted p-6 text-center">
            <Wrench className="h-5 w-5 mx-auto mb-2 opacity-50" />
            No maintenance history for this selection.
          </p>
        ) : (
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>Ref</TH>
                <TH>Truck</TH>
                <TH>Job</TH>
                <TH>Track</TH>
                <TH>Status</TH>
                <TH>Opened</TH>
                <TH>Closed</TH>
                <TH>Parts cost</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.kind}-${r.id}`}
                  onClick={() => openJob(r.kind, r.id)}
                  className={cn(
                    "cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.03]",
                    jobLoading === r.id && "opacity-60",
                  )}
                >
                  <TD className="font-mono text-xs">{r.ref}</TD>
                  <TD className="text-xs">{trucksById.get(r.truckId)?.plate ?? "—"}</TD>
                  <TD className="text-xs font-medium">{r.title}</TD>
                  <TD>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                        r.kind === "in_house"
                          ? "bg-brand-500/10 text-brand-700 dark:text-brand-300 ring-brand-500/20"
                          : "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/25",
                      )}
                    >
                      {r.kind === "in_house" ? "In-house" : "Outsourced"}
                    </span>
                  </TD>
                  <TD className="text-xs capitalize">{r.status.replace(/_/g, " ")}</TD>
                  <TD className="text-xs">{r.opened ? fmtDate(r.opened.slice(0, 10)) : "—"}</TD>
                  <TD className="text-xs">
                    {r.closed ? new Date(r.closed).toLocaleDateString() : "—"}
                  </TD>
                  <TD className="text-xs tabular-nums">
                    {r.cost != null ? `${fmtMoney(Number(r.cost))} SAR` : <span className="muted">—</span>}
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {jobDetail && (
          <MaintenanceJobModal detail={jobDetail} onClose={() => setJobDetail(null)} />
        )}
      </Card>
    );
  }

  // -------------------------------------------------------------------------
  // SOFT-DELETED — READ-ONLY apart from Restore.
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-3">
      <Card className="!p-0 overflow-hidden">
        <div className="p-3 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <span className="font-semibold block">Terminated Trucks</span>
          <span className="text-[11px] muted">
            {terminatedTrucks.length} record{terminatedTrucks.length === 1 ? "" : "s"} · kept, never deleted
          </span>
        </div>
        {terminatedTrucks.length === 0 ? (
          <p className="text-sm muted p-6 text-center">No terminated trucks.</p>
        ) : (
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>Truck</TH>
                <TH>Reason</TH>
                <TH>Price</TH>
                <TH>Released</TH>
                <TH>Terminated on</TH>
                <TH>{null}</TH>
              </tr>
            </thead>
            <tbody>
              {terminatedTrucks.map((t) => (
                <tr key={t.id}>
                  <TD>
                    <span className="font-medium">{t.plate}</span>
                    {t.model && <div className="text-[11px] muted">{t.model}</div>}
                  </TD>
                  <TD className="text-xs">
                    {t.termination_reason === "sold" ? "Sold"
                      : t.termination_reason === "total_loss" ? "Total loss"
                      : <span className="muted">—</span>}
                  </TD>
                  <TD className="text-xs tabular-nums">
                    {t.termination_price != null ? `${fmtMoney(Number(t.termination_price))} SAR` : <span className="muted">—</span>}
                  </TD>
                  <TD className="text-xs">{fmtDate(t.released_date)}</TD>
                  <TD className="text-xs">
                    {t.terminated_at ? new Date(t.terminated_at).toLocaleDateString() : "—"}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-1 justify-end">
                      <Btn variant="outline" onClick={() => setDetailTruck(t)}>
                        <Eye className="h-3.5 w-3.5" />View
                      </Btn>
                      <Btn variant="outline" onClick={() => onRestoreTruck(t)}>
                        <RotateCcw className="h-3.5 w-3.5" />Restore
                      </Btn>
                    </div>
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {detailTruck && (
        <TerminatedTruckDetail
          truck={detailTruck}
          documents={documents}
          groups={groups}
          workOrders={workOrders}
          outsourcedJobs={outsourcedJobs}
          today={today}
          onRestore={() => onRestoreTruck(detailTruck)}
          onClose={() => setDetailTruck(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terminated-truck details — everything this page holds on it, plus the
// documents and maintenance jobs that OUTLIVED the termination. 0084's subject
// FKs are ON DELETE RESTRICT precisely so a regulatory document survives its
// subject; work orders survive for the same soft-delete reason.
// ---------------------------------------------------------------------------
function TerminatedTruckDetail({
  truck,
  documents,
  groups,
  workOrders,
  outsourcedJobs,
  today,
  onRestore,
  onClose,
}: {
  truck: ArchiveTruckRow;
  documents: ArchiveDocument[];
  groups: ArchiveDocumentGroup[];
  workOrders: ArchiveTruckTabWorkOrder[];
  outsourcedJobs: ArchiveTruckTabOutsourcedJob[];
  today: string;
  onRestore: () => void;
  onClose: () => void;
}) {
  const groupsById = new Map(groups.map((g) => [g.id, g]));
  const theirDocs = documents.filter((d) => d.truck_id === truck.id);
  const jobCount =
    workOrders.filter((w) => w.truck_id === truck.id).length +
    outsourcedJobs.filter((o) => o.truck_id === truck.id).length;
  const dash = (v: string | number | null | undefined) =>
    v === null || v === undefined || v === "" ? "—" : String(v);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-[860px] max-h-[90vh] overflow-y-auto scrollbar-thin p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between p-4 border-b"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <div>
            <h2 className="font-semibold">{truck.plate}</h2>
            <p className="text-[11px] muted">Terminated truck · record kept, never deleted</p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide muted">Vehicle</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <TruckField label="Model" value={dash(truck.model)} />
            <TruckField label="Year" value={dash(truck.year)} />
            <TruckField label="Capacity (m³)" value={dash(truck.capacity_m3)} />
            <TruckField label="VIN" value={dash(truck.vin)} mono />
            <TruckField label="Vehicle Registration" value={dash(truck.vehicle_registration)} mono />
            <TruckField label="Registration expiry" value={fmtDate(truck.registration_expiry)} />
            <TruckField label="Odometer (km)" value={dash(truck.odometer_km)} />
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">Termination</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <TruckField
              label="Reason"
              value={
                truck.termination_reason === "sold" ? "Sold"
                : truck.termination_reason === "total_loss" ? "Total loss"
                : "—"
              }
            />
            <TruckField
              label="Price"
              value={truck.termination_price != null ? `${fmtMoney(Number(truck.termination_price))} SAR` : "—"}
            />
            <TruckField label="Released" value={fmtDate(truck.released_date)} />
            <TruckField
              label="Terminated on"
              value={truck.terminated_at ? new Date(truck.terminated_at).toLocaleDateString() : "—"}
            />
            <TruckField label="Maintenance jobs on record" value={String(jobCount)} />
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
            Archived documents ({theirDocs.length})
          </div>
          {theirDocs.length === 0 ? (
            <p className="text-sm muted">No archived documents for this truck.</p>
          ) : (
            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>Group</TH>
                  <TH>Document</TH>
                  <TH>Expires</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {theirDocs.map((d) => {
                  const g = groupsById.get(d.group_id);
                  // A linked document has no expiry of its own — read the
                  // truck's, same single source as the matrix.
                  const expiry = d.expiry_date ?? truck.registration_expiry;
                  const status = docStatus(expiry, g?.warning_days ?? 30, today);
                  return (
                    <tr key={d.id}>
                      <TD className="text-xs">{g?.title ?? "—"}</TD>
                      <TD className="text-xs font-medium">{d.title}</TD>
                      <TD className="text-xs">{fmtDate(expiry)}</TD>
                      <TD>
                        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", ARCHIVE_STATUS_PILL[status])}>
                          {archiveStatusLabel(status, expiry, today)}
                        </span>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </div>

        <div
          className="flex justify-end gap-2 p-4 border-t"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <Btn variant="outline" onClick={onClose}>Close</Btn>
          <Btn variant="primary" onClick={onRestore}>
            <RotateCcw className="h-4 w-4" />Restore
          </Btn>
        </div>
      </div>
    </div>
  );
}

// Read-only detail for one maintenance job. Same content the Maintenance page
// already renders for these jobs, reached from the truck's own history — the
// archive shows it, it never lets you change it, so there is no footer action
// beyond Close.
function MaintenanceJobModal({
  detail,
  onClose,
}: {
  detail: MaintenanceJobDetail;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-[860px] max-h-[90vh] overflow-y-auto scrollbar-thin p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between p-4 border-b"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <div className="min-w-0">
            <h2 className="font-semibold truncate">{detail.title}</h2>
            <p className="text-[11px] muted">
              <span className="font-mono">{detail.ref}</span>
              {" · "}
              {detail.kind === "in_house" ? "In-house work order" : "Outsourced job"}
              {" · "}
              <span className="capitalize">{detail.status.replace(/_/g, " ")}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide muted">Details</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {detail.fields.map((f) => (
              <TruckField key={f.label} label={f.label} value={f.value} />
            ))}
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
            {detail.linesTitle} ({detail.lines.length})
          </div>
          {detail.lines.length === 0 ? (
            <p className="text-sm muted">{detail.linesEmpty}</p>
          ) : (
            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>{detail.kind === "in_house" ? "Part" : "Repairer"}</TH>
                  <TH>{detail.kind === "in_house" ? "Qty drawn" : "Subtotal + VAT"}</TH>
                  {/* On-hand pair — in-house only; an outsourced job consumes
                      no inventory, so the column would be empty for every row
                      rather than merely blank for some. */}
                  {detail.kind === "in_house" && <TH>On hand</TH>}
                  <TH>{detail.kind === "in_house" ? "Value" : "Total"}</TH>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l, i) => (
                  <tr key={i}>
                    <TD>
                      <span className="font-medium text-sm">{l.label}</span>
                      {l.sub && <div className="text-[11px] muted">{l.sub}</div>}
                    </TD>
                    <TD className="text-xs tabular-nums">{l.qty}</TD>
                    {detail.kind === "in_house" && (
                      <TD className="text-xs tabular-nums">
                        {l.onHandBefore !== null && l.onHandAfter !== null ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="muted">{l.onHandBefore}</span>
                            <ArrowRight className="h-3 w-3 muted shrink-0" />
                            <span className="font-medium">{l.onHandAfter}</span>
                          </span>
                        ) : (
                          <span className="muted" title="No matching stock movement found for this work order">—</span>
                        )}
                      </TD>
                    )}
                    <TD className="text-xs tabular-nums font-medium">{l.amount}</TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          {detail.total && (
            <div className="text-sm font-semibold text-end tabular-nums">{detail.total}</div>
          )}

          {detail.note && (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">Note</div>
              <p className="text-sm whitespace-pre-wrap">{detail.note}</p>
            </>
          )}
        </div>

        <div
          className="flex justify-end gap-2 p-4 border-t"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <Btn variant="outline" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </div>
  );
}

function TruckField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] muted mb-0.5">{label}</div>
      <div className={cn("text-sm", mono && "font-mono text-xs")}>{value}</div>
    </div>
  );
}
