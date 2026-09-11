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
  CornerDownRight, History, Eye, RotateCcw, X, Wrench, ArrowRight, Archive,
} from "lucide-react";
import { Card, Btn, Table, TH, TD } from "@/components/ui";
import { LinkPill } from "./ArchiveModals";
import type { SubTabItem } from "./SubTabPicker";
import {
  getMaintenanceJobDetail,
  type MaintenanceJobDetail,
  type MaintenanceLineQty,
  type MaintenanceLineSub,
} from "./actions";
import { useApp } from "@/components/AppShell";
import { t, fill, plural, arText, type Lang } from "@/lib/i18n";
import { cn, formatAmount, formatDate } from "@/lib/utils";
import { toLatinDigits } from "@/lib/digits";
import {
  docStatus, ARCHIVE_STATUS_ROW_TONE, ARCHIVE_STATUS_PILL, archiveStatusLabel,
  groupAccent, groupDot, linkedFieldFor, linkedFieldForDoc, readPersonLink,
  personIdLabel,
} from "@/lib/archive";
import type {
  ArchiveDocumentGroup,
  ArchiveDocument,
  ArchiveDocumentFile,
  ArchiveDocumentRenewal,
  ArchiveDocumentType,
  ArchiveTruckRow,
} from "@/lib/db-types";
import ScrollLock from "@/components/ScrollLock";

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

// A FUNCTION, not a module-level const: the labels are language-dependent and
// a const would be built once, at import time, in whatever language the module
// happened to be evaluated under — and would then never change again. The KEYS
// are still the only thing the picker calls back with.
export function truckSubTabs(lang: Lang): SubTabItem<TruckSubTab>[] {
  return [
    { key: "documents", label: t("archive.truck.subTabs.documents", lang), icon: FileText },
    { key: "maintenance", label: t("archive.truck.subTabs.maintenance", lang), icon: Wrench },
    { key: "deleted", label: t("archive.subTabDeleted", lang), icon: Archive },
  ];
}

// Same reasoning as the Staff tab's: "Missing" is a ROW state, never a member
// of ArchiveDocStatus — that union feeds expirySummary(), and a gap is not an
// expiry.
const MISSING_PILL =
  "bg-slate-500/10 text-slate-600 dark:text-slate-400 ring-slate-500/25";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return formatDate(iso + "T00:00:00");
}

// No " SAR" suffix here on purpose — the unit is in the column header. Was a
// local `toLocaleString(undefined, …)`, which followed the browser's locale
// and rendered Arabic-Indic digits on an Arabic device.
const fmtMoney = (n: number): string => formatAmount(n);

// Param is `truck`, not `t` — `t` is the translator everywhere in this file
// now, and a shadow here would be the kind of bug that only shows up in the
// one branch that happens to translate.
function truckLabel(truck: ArchiveTruckRow): string {
  return truck.plate;
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
  onRestoreTruck: (truck: ArchiveTruckRow) => void;
}) {
  const { lang } = useApp();
  const typesByKey = useMemo(() => new Map(types.map((ty) => [ty.key, ty])), [types]);
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
        .filter((truck) => truck.active && !truck.terminated_at)
        .sort((a, b) => a.plate.localeCompare(b.plate)),
    [trucks],
  );

  const terminatedTrucks = useMemo(
    () => trucks.filter((truck) => truck.terminated_at || !truck.active),
    [trucks],
  );

  const trucksById = useMemo(() => new Map(trucks.map((truck) => [truck.id, truck])), [trucks]);

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
            <p className="text-sm muted">{t("archive.truck.emptyGroups", lang)}</p>
            <p className="text-xs muted mt-1">
              {t("archive.truck.emptyGroupsHint", lang)}
            </p>
          </div>
        </Card>
      );
    }

    if (activeTrucks.length === 0) {
      return (
        <Card>
          <p className="text-sm muted p-6 text-center">{t("archive.truck.emptyTrucks", lang)}</p>
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
                  {isCollapsed ? <ChevronRight className="rtl:-scale-x-100 h-4 w-4 mt-0.5 shrink-0" /> : <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" />}
                  <span className={cn("h-2.5 w-2.5 rounded-full mt-1.5 shrink-0", groupDot(g.color))} />
                  <span className="min-w-0">
                    <span className="font-semibold block truncate">{g.title}</span>
                    {g.description && <span className="text-xs muted block">{g.description}</span>}
                    <span className="text-[11px] muted block mt-0.5">
                      {/* Pattern B: the document type is bilingual in the DB,
                          so its label is read straight off the row rather than
                          looked up by key. */}
                      {groupTypeRow
                        ? `${arText(groupTypeRow.label_en, groupTypeRow.label_ar, lang)} · `
                        : ""}
                      {fill(t(`archive.truck.groupMeta.${plural(activeTrucks.length)}`, lang), {
                        n: activeTrucks.length,
                        d: g.warning_days,
                      })}
                    </span>
                  </span>
                </button>

                <div className="flex items-center gap-1 shrink-0">
                  {linkField && <LinkPill />}
                  {missing > 0 && (
                    <span className={cn("text-xs px-2 py-1 rounded-full ring-1 ring-inset font-medium", MISSING_PILL)}>
                      {fill(t(`archive.truck.missingCount.${plural(missing)}`, lang), { n: missing })}
                    </span>
                  )}
                  {expired > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full ring-1 ring-inset font-medium bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20">
                      {fill(t(`archive.expiredCount.${plural(expired)}`, lang), { n: expired })}
                    </span>
                  )}
                  <button
                    onClick={() => onEditGroup(g)}
                    className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                    title={t("archive.editGroupTip", lang)}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onDeleteGroup(g)}
                    className="h-8 w-8 rounded-lg grid place-items-center text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                    title={t("archive.deleteGroupTip", lang)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {!isCollapsed && (
                <Table>
                  <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                    <tr>
                      <TH>{t("archive.truck.thTruck", lang)}</TH>
                      <TH>{t("archive.thReferenceId", lang)}</TH>
                      <TH>{t("archive.thIssued", lang)}</TH>
                      <TH>{t("archive.thExpires", lang)}</TH>
                      <TH>{t("common.note", lang)}</TH>
                      <TH>{t("archive.thFiles", lang)}</TH>
                      <TH>{t("common.status", lang)}</TH>
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
                                {t("archive.missingPill", lang)}
                              </span>
                            </TD>
                            <TD>
                              <div className="flex items-center justify-end">
                                <Btn variant="outline" onClick={() => onAddDocument(g, truck)}>
                                  <Plus className="h-3.5 w-3.5" />{t("common.add", lang)}
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
                                          <div className="text-[11px] muted mt-0.5">
                                            {fill(t(`archive.docsCount.${plural(docs.length)}`, lang), {
                                              n: docs.length,
                                            })}
                                          </div>
                                        )}
                                      </>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-xs muted ps-3">
                                        <CornerDownRight className="rtl:-scale-x-100 h-3 w-3" />
                                        {d.title}
                                      </span>
                                    )}
                                  </TD>
                                  <TD className="font-mono text-xs">
                                    {rowField ? (
                                      <>
                                        {link?.number || "—"}
                                        <span className="block font-sans text-[10px] muted">
                                          {personIdLabel(rowField, lang)}
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
                                      {archiveStatusLabel(status, effectiveExpiry, today, lang)}
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
                                          title={t("archive.renewalHistoryTip", lang)}
                                        >
                                          <History className="h-3.5 w-3.5" />
                                          {docRenewals.length}
                                        </button>
                                      )}
                                      <Btn variant="outline" onClick={() => onRenewDocument(d)}>
                                        <RefreshCw className="h-3.5 w-3.5" />{t("archive.renew", lang)}
                                      </Btn>
                                      <button
                                        onClick={() => onEditDocument(d, g, truck)}
                                        className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                                        title={t("archive.editDocTip", lang)}
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
                                          title={fill(t("archive.truck.addAnotherFor", lang), {
                                            plate: truck.plate,
                                          })}
                                        >
                                          <Plus className="h-4 w-4" />
                                        </button>
                                      )}
                                      <button
                                        onClick={() => onDeleteDocument(d)}
                                        className="h-8 w-8 rounded-lg grid place-items-center text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                                        title={t("archive.deleteDocTip", lang)}
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
                                        {t("archive.previousVersion", lang)}
                                        <div className="text-[11px]">
                                          {fill(t("archive.supersededOn", lang), {
                                            date: formatDate(r.superseded_at),
                                          })}
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
                                      <TD><span className="text-xs muted">{t("archive.superseded", lang)}</span></TD>
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
            {/* The card heading and the sub-tab segment are the same words in
                both languages — one leaf, read twice, rather than two that a
                reword would have to find separately. */}
            <span className="font-semibold block">{t("archive.truck.subTabs.maintenance", lang)}</span>
            <span className="text-[11px] muted">
              {t("archive.truck.maintSubtitle", lang)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="muted text-xs">{t("archive.truck.thTruck", lang)}</span>
            <select
              value={maintTruckId}
              onChange={(e) => setMaintTruckId(e.target.value)}
              className="px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
              style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
            >
              <option value="all">{t("archive.truck.allTrucks", lang)}</option>
              {/* Every truck, terminated included — a terminated truck's
                  history is exactly the kind of thing an archive is for. */}
              {trucks.map((truck) => (
                <option key={truck.id} value={truck.id}>{truck.plate}</option>
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
            {t("archive.truck.maintEmpty", lang)}
          </p>
        ) : (
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>{t("archive.truck.thRef", lang)}</TH>
                <TH>{t("archive.truck.thTruck", lang)}</TH>
                <TH>{t("archive.truck.thJob", lang)}</TH>
                <TH>{t("archive.truck.thTrack", lang)}</TH>
                <TH>{t("common.status", lang)}</TH>
                <TH>{t("common.opened", lang)}</TH>
                <TH>{t("archive.truck.thClosed", lang)}</TH>
                <TH>{t("archive.truck.thPartsCost", lang)}</TH>
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
                      {t(`archive.truck.kind.${r.kind}`, lang)}
                    </span>
                  </TD>
                  {/* FLAGGED, deliberately untranslated: `status` is a raw
                      work_orders / outsourced_jobs enum typed `string` here.
                      Its value set is owned by the Maintenance route, which
                      this batch does not convert, so there is no closed union
                      to key a dictionary group off — a partial map would
                      silently fall through to English for any value it missed.
                      It stays as the underscore-stripped raw value until the
                      Maintenance batch gives it a home. */}
                  <TD className="text-xs capitalize">{r.status.replace(/_/g, " ")}</TD>
                  <TD className="text-xs">{r.opened ? fmtDate(r.opened.slice(0, 10)) : "—"}</TD>
                  <TD className="text-xs">
                    {r.closed ? formatDate(r.closed) : "—"}
                  </TD>
                  <TD className="text-xs tabular-nums">
                    {r.cost != null
                      ? fill(t("archive.sarAmount", lang), { n: fmtMoney(Number(r.cost)) })
                      : <span className="muted">—</span>}
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
          <span className="font-semibold block">{t("archive.truck.terminatedTitle", lang)}</span>
          <span className="text-[11px] muted">
            {fill(t(`archive.recordsKept.${plural(terminatedTrucks.length)}`, lang), {
              n: terminatedTrucks.length,
            })}
          </span>
        </div>
        {terminatedTrucks.length === 0 ? (
          <p className="text-sm muted p-6 text-center">{t("archive.truck.terminatedEmpty", lang)}</p>
        ) : (
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>{t("archive.truck.thTruck", lang)}</TH>
                <TH>{t("archive.thReason", lang)}</TH>
                <TH>{t("archive.truck.thPrice", lang)}</TH>
                <TH>{t("archive.truck.thReleased", lang)}</TH>
                <TH>{t("archive.truck.thTerminatedOn", lang)}</TH>
                <TH>{null}</TH>
              </tr>
            </thead>
            <tbody>
              {terminatedTrucks.map((truck) => (
                <tr key={truck.id}>
                  <TD>
                    <span className="font-medium">{truck.plate}</span>
                    {truck.model && <div className="text-[11px] muted">{truck.model}</div>}
                  </TD>
                  <TD className="text-xs">
                    {/* Keyed off termination_reason's VALUE — the two-value
                        enum the restore RPC clears — not off its wording. */}
                    {truck.termination_reason === "sold" ? t("archive.truck.reason.sold", lang)
                      : truck.termination_reason === "total_loss" ? t("archive.truck.reason.total_loss", lang)
                      : <span className="muted">—</span>}
                  </TD>
                  <TD className="text-xs tabular-nums">
                    {truck.termination_price != null
                      ? fill(t("archive.sarAmount", lang), { n: fmtMoney(Number(truck.termination_price)) })
                      : <span className="muted">—</span>}
                  </TD>
                  <TD className="text-xs">{fmtDate(truck.released_date)}</TD>
                  <TD className="text-xs">
                    {truck.terminated_at ? formatDate(truck.terminated_at) : "—"}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-1 justify-end">
                      <Btn variant="outline" onClick={() => setDetailTruck(truck)}>
                        <Eye className="h-3.5 w-3.5" />{t("common.view", lang)}
                      </Btn>
                      <Btn variant="outline" onClick={() => onRestoreTruck(truck)}>
                        <RotateCcw className="h-3.5 w-3.5" />{t("archive.restore", lang)}
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
  const { lang } = useApp();
  const groupsById = new Map(groups.map((g) => [g.id, g]));
  const theirDocs = documents.filter((d) => d.truck_id === truck.id);
  const jobCount =
    workOrders.filter((w) => w.truck_id === truck.id).length +
    outsourcedJobs.filter((o) => o.truck_id === truck.id).length;
  const dash = (v: string | number | null | undefined) =>
    v === null || v === undefined || v === "" ? "—" : String(v);
  // `dash` for an IDENTIFIER — VIN and vehicle registration, the two fields
  // below that render `mono`. Deliberately NOT folded into `dash` itself:
  // `fModel` goes through the same helper and a model name is prose, so an
  // Arabic one is allowed to keep whatever digits its author typed (the
  // standing lib/i18n.ts ruling). Year / capacity / odometer are numeric
  // columns and cannot carry Arabic-Indic digits in the first place.
  // Folding here is belt-and-braces over the write guards in
  // app/fleet/actions.ts and app/archive/actions.ts — it is what makes rows
  // stored BEFORE those guards read Latin. See lib/digits.ts.
  const idDash = (v: string | null | undefined) => toLatinDigits(dash(v));

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto"
      onClick={onClose}
    >
      <ScrollLock />
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
            <p className="text-[11px] muted">{t("archive.truck.detailSubtitle", lang)}</p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide muted">{t("archive.truck.sectionVehicle", lang)}</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <TruckField label={t("archive.truck.fModel", lang)} value={dash(truck.model)} />
            <TruckField label={t("archive.truck.fYear", lang)} value={dash(truck.year)} />
            <TruckField label={t("archive.truck.fCapacity", lang)} value={dash(truck.capacity_m3)} />
            <TruckField label={t("archive.truck.fVin", lang)} value={idDash(truck.vin)} mono />
            {/* Same words as the LINKED-field label for a truck, in both
                languages — the column this field shows IS what a linked
                registration document reads from, so it reuses that leaf
                rather than minting a second copy that could drift. */}
            <TruckField label={t("archive.personId.truck_registration", lang)} value={idDash(truck.vehicle_registration)} mono />
            <TruckField label={t("archive.truck.fRegistrationExpiry", lang)} value={fmtDate(truck.registration_expiry)} />
            <TruckField label={t("archive.truck.fOdometer", lang)} value={dash(truck.odometer_km)} />
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">{t("archive.truck.sectionTermination", lang)}</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <TruckField
              label={t("archive.thReason", lang)}
              value={
                truck.termination_reason === "sold" ? t("archive.truck.reason.sold", lang)
                : truck.termination_reason === "total_loss" ? t("archive.truck.reason.total_loss", lang)
                : "—"
              }
            />
            <TruckField
              label={t("archive.truck.thPrice", lang)}
              value={
                truck.termination_price != null
                  ? fill(t("archive.sarAmount", lang), { n: fmtMoney(Number(truck.termination_price)) })
                  : "—"
              }
            />
            <TruckField label={t("archive.truck.thReleased", lang)} value={fmtDate(truck.released_date)} />
            <TruckField
              label={t("archive.truck.thTerminatedOn", lang)}
              value={truck.terminated_at ? formatDate(truck.terminated_at) : "—"}
            />
            <TruckField label={t("archive.truck.fJobCount", lang)} value={String(jobCount)} />
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
            {fill(t(`archive.archivedDocsCount.${plural(theirDocs.length)}`, lang), {
              n: theirDocs.length,
            })}
          </div>
          {theirDocs.length === 0 ? (
            <p className="text-sm muted">{t("archive.truck.noArchivedDocs", lang)}</p>
          ) : (
            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>{t("archive.thGroup", lang)}</TH>
                  <TH>{t("archive.thDocument", lang)}</TH>
                  <TH>{t("archive.thExpires", lang)}</TH>
                  <TH>{t("common.status", lang)}</TH>
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
                          {archiveStatusLabel(status, expiry, today, lang)}
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
          <Btn variant="outline" onClick={onClose}>{t("archive.close", lang)}</Btn>
          <Btn variant="primary" onClick={onRestore}>
            <RotateCcw className="h-4 w-4" />{t("archive.restore", lang)}
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
  const { lang } = useApp();
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto"
      onClick={onClose}
    >
      <ScrollLock />
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
              {t(`archive.truck.jobKind.${detail.kind}`, lang)}
              {" · "}
              {/* UN-FLAGGED. The note here said this was "a raw Maintenance-route
                  enum with no closed union to key off", and the second half was
                  the only true part: the value always WAS one of
                  WorkOrderStatus | OutsourcedJobStatus, the action just typed it
                  `string`. Typing it properly (see MaintenanceJobDetail) makes
                  `status.${...}` a checked key, and every member of both unions
                  is already in that group — the Maintenance page renders the
                  same column the same way.

                  `.replace(/_/g, " ")` + `capitalize` went with it. That pair
                  was never a translation; it made "in_progress" look tidy in
                  English and left it untouched in Arabic. */}
              {t(`status.${detail.status}`, lang)}
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
          <div className="text-[11px] font-semibold uppercase tracking-wide muted">{t("archive.truck.sectionDetails", lang)}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* RULED AND FIXED. This block used to carry a FLAG saying `f.label`
                — plus `linesTitle` / `linesEmpty` / `l.label` / `l.sub` /
                `total` below — were display strings built SERVER-SIDE and were
                "left English pending a ruling". The ruling came: they are
                copy, copy is translated, and a server action has no language to
                translate with. getMaintenanceJobDetail now returns keys and raw
                values; the words are written here.

                ONE rule for the value, covering both an enum and a unit —
                see the `valueKey` note on MaintenanceJobDetail. */}
            {detail.fields.map((f) => (
              <TruckField
                key={f.labelKey}
                label={t(f.labelKey, lang)}
                value={f.valueKey ? fill(t(f.valueKey, lang), { v: f.value }) : f.value}
              />
            ))}
          </div>

          {/* The heading, the empty line and the "unknown" fallbacks below are a
              pure function of `kind` — which is why they are no longer shipped
              from the server at all. This component already switches on `kind`
              for its table headers; it now does so for its sentences too. */}
          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
            {t(detail.kind === "in_house" ? "archive.truck.linesInHouse" : "archive.truck.linesOutsourced", lang)}
            {" ("}{detail.lines.length}{")"}
          </div>
          {detail.lines.length === 0 ? (
            <p className="text-sm muted">
              {t(detail.kind === "in_house" ? "archive.truck.linesEmptyInHouse" : "archive.truck.linesEmptyOutsourced", lang)}
            </p>
          ) : (
            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>{detail.kind === "in_house" ? t("common.part", lang) : t("archive.truck.thRepairer", lang)}</TH>
                  <TH>{detail.kind === "in_house" ? t("archive.truck.thQtyDrawn", lang) : t("archive.truck.thSubtotalVat", lang)}</TH>
                  {/* On-hand pair — in-house only; an outsourced job consumes
                      no inventory, so the column would be empty for every row
                      rather than merely blank for some. */}
                  {detail.kind === "in_house" && <TH>{t("archive.truck.thOnHand", lang)}</TH>}
                  <TH>{detail.kind === "in_house" ? t("archive.truck.thValue", lang) : t("archive.thTotal", lang)}</TH>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l, i) => (
                  <tr key={i}>
                    <TD>
                      <span className="font-medium text-sm">
                        {l.label ??
                          t(
                            detail.kind === "in_house"
                              ? "archive.truck.unknownPart"
                              : "archive.truck.unknownRepairer",
                            lang,
                          )}
                      </span>
                      {(() => {
                        const sub = lineSubText(l.sub, lang);
                        return sub ? <div className="text-[11px] muted">{sub}</div> : null;
                      })()}
                    </TD>
                    <TD className="text-xs tabular-nums">{lineQtyText(l.qty, lang)}</TD>
                    {detail.kind === "in_house" && (
                      <TD className="text-xs tabular-nums">
                        {l.onHandBefore !== null && l.onHandAfter !== null ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="muted">{l.onHandBefore}</span>
                            <ArrowRight className="rtl:-scale-x-100 h-3 w-3 muted shrink-0" />
                            <span className="font-medium">{l.onHandAfter}</span>
                          </span>
                        ) : (
                          <span className="muted" title={t("archive.truck.noStockMovement", lang)}>—</span>
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
            <div className="text-sm font-semibold text-end tabular-nums">
              {fill(
                t(
                  detail.kind === "in_house" ? "archive.truck.partsTotal" : "archive.truck.totalPaid",
                  lang,
                ),
                { amount: detail.total },
              )}
            </div>
          )}

          {detail.note && (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">{t("common.note", lang)}</div>
              <p className="text-sm whitespace-pre-wrap">{detail.note}</p>
            </>
          )}
        </div>

        <div
          className="flex justify-end gap-2 p-4 border-t"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <Btn variant="outline" onClick={onClose}>{t("archive.close", lang)}</Btn>
        </div>
      </div>
    </div>
  );
}

// The two composed cells of a maintenance-job line, written HERE rather than on
// the server, because both are sentences and the server has no language.
//
// Each takes the discriminated shape getMaintenanceJobDetail sends and returns
// finished text. Kept as plain functions, not components, so the table row can
// drop the result straight into a `<TD>` and a null sub-line stays genuinely
// absent instead of rendering an empty `<div>`.

function lineQtyText(qty: MaintenanceLineQty, lang: Lang): string {
  if (qty.form === "drawn") {
    return fill(t("archive.truck.qtyDrawn", lang), { drawn: qty.drawn, planned: qty.planned });
  }
  if (qty.form === "planned") {
    return fill(t("archive.truck.qtyPlanned", lang), { planned: qty.planned });
  }
  return fill(t("archive.truck.subtotalPlusVat", lang), { subtotal: qty.subtotal, vat: qty.vat });
}

function lineSubText(sub: MaintenanceLineSub | null, lang: Lang): string | null {
  if (!sub) return null;
  if (sub.form === "text") return sub.text || null;
  // Joined AFTER translating, and each part drops out independently — an absent
  // invoice number, an absent date and a zero discount each remove themselves
  // and their separator, which is what the server's old `.filter(Boolean)` did
  // before the words had to move.
  const parts = [
    sub.invoiceNumber ? fill(t("archive.truck.subInvoice", lang), { n: sub.invoiceNumber }) : null,
    sub.invoiceDate,
    sub.discount ? fill(t("archive.truck.subDiscount", lang), { amount: sub.discount }) : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function TruckField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] muted mb-0.5">{label}</div>
      <div className={cn("text-sm", mono && "font-mono text-xs")}>{value}</div>
    </div>
  );
}
