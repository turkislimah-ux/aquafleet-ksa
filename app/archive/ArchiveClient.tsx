"use client";

// Archive — Phase 1: the tabbed shell + the COMPANY tab, end to end.
//
// Turki's two-step model drives the layout: a group is a container (title +
// description + color + its own warning threshold), and documents are added
// INTO a group via an "Add Document" action sitting next to that group's own
// title — not a single page-level "add" that then asks which group.
//
// STATUS IS DERIVED, NEVER STORED — every tint, pill and summary count on
// this page reads lib/archive.ts's docStatus(), which computes from
// (expiry_date, that group's warning_days, today). One source, so a document
// can't be counted "expiring" in the summary while rendering "valid" in its
// row. Same rule as lib/driver-state.ts / lib/truck-status.ts.
//
// Tabs: Company is live; Staff/Truck/Customer are rendered as real tabs with
// an honest "coming in a later phase" state rather than hidden — same
// "render the real layout, empty state until it lands" convention
// FleetDetailClient.tsx and the original Maintenance OS tab both used.

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Pencil, Trash2, ChevronDown, ChevronRight, RefreshCw,
  FileText, History,
} from "lucide-react";
import { PageHeader, Card, Btn, Table, TH, TD } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  docStatus, expirySummary,
  ARCHIVE_STATUS_ROW_TONE, ARCHIVE_STATUS_PILL, archiveStatusLabel,
  groupAccent, groupDot,
} from "@/lib/archive";
import type {
  ArchiveTab,
  ArchiveDocumentGroup,
  ArchiveDocument,
  ArchiveDocumentFile,
  ArchiveDocumentRenewal,
  ArchiveDocumentType,
} from "@/lib/db-types";
import { deleteArchiveGroup, deleteArchiveDocument, getArchiveFileSignedUrls } from "./actions";
import { GroupModal, DocumentModal, RenewModal, DocumentDetailModal } from "./ArchiveModals";

const TABS: { key: ArchiveTab; label: string }[] = [
  { key: "company", label: "Company" },
  { key: "staff", label: "Staff" },
  { key: "truck", label: "Truck" },
  { key: "customer", label: "Customer" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString();
}

export default function ArchiveClient({
  groups,
  documents,
  files,
  renewals,
  types,
  today,
  error,
}: {
  groups: ArchiveDocumentGroup[];
  documents: ArchiveDocument[];
  files: ArchiveDocumentFile[];
  renewals: ArchiveDocumentRenewal[];
  types: ArchiveDocumentType[];
  today: string;
  error: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<ArchiveTab>("company");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ArchiveDocumentGroup | null>(null);
  const [docModalGroupId, setDocModalGroupId] = useState<string | null>(null);
  const [editingDoc, setEditingDoc] = useState<ArchiveDocument | null>(null);
  const [renewingDoc, setRenewingDoc] = useState<ArchiveDocument | null>(null);
  const [historyDocId, setHistoryDocId] = useState<string | null>(null);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const typesByKey = useMemo(() => new Map(types.map((t) => [t.key, t])), [types]);

  const docsByGroup = useMemo(() => {
    const m = new Map<string, ArchiveDocument[]>();
    for (const d of documents) {
      const arr = m.get(d.group_id) ?? [];
      arr.push(d);
      m.set(d.group_id, arr);
    }
    return m;
  }, [documents]);

  const filesByDoc = useMemo(() => {
    const m = new Map<string, ArchiveDocumentFile[]>();
    for (const f of files) {
      const arr = m.get(f.document_id) ?? [];
      arr.push(f);
      m.set(f.document_id, arr);
    }
    return m;
  }, [files]);

  const renewalsByDoc = useMemo(() => {
    const m = new Map<string, ArchiveDocumentRenewal[]>();
    for (const r of renewals) {
      const arr = m.get(r.document_id) ?? [];
      arr.push(r);
      m.set(r.document_id, arr);
    }
    return m;
  }, [renewals]);

  // The expiring-documents summary. Built to EXTEND: expirySummary() takes a
  // flat document list + a group lookup and has no tab awareness, so Phases
  // 2-3 widen the input without changing this call or adding a second counter.
  const summary = useMemo(
    () => expirySummary(documents, groupsById, today),
    [documents, groupsById, today],
  );

  const detailDoc = detailDocId ? documents.find((d) => d.id === detailDocId) ?? null : null;
  const detailGroup = detailDoc ? groupsById.get(detailDoc.group_id) ?? null : null;

  function toggleCollapsed(groupId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  async function onDeleteGroup(g: ArchiveDocumentGroup) {
    const count = docsByGroup.get(g.id)?.length ?? 0;
    const msg = count > 0
      ? `Delete "${g.title}" and its ${count} document${count === 1 ? "" : "s"}? This cannot be undone.`
      : `Delete "${g.title}"? This cannot be undone.`;
    if (!confirm(msg)) return;
    const res = await deleteArchiveGroup(g.id);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    router.refresh();
  }

  async function onDeleteDocument(d: ArchiveDocument) {
    if (!confirm(`Permanently delete "${d.title}", its files and its renewal history? This cannot be undone.`)) return;
    const res = await deleteArchiveDocument(d.id);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    router.refresh();
  }

  async function openFile(path: string) {
    const res = await getArchiveFileSignedUrls([path]);
    if (res.error || !res.urls?.[path]) {
      setActionError(res.error ?? "Could not open file.");
      return;
    }
    window.open(res.urls[path], "_blank", "noopener,noreferrer");
  }

  function closeModals() {
    setGroupModalOpen(false);
    setEditingGroup(null);
    setDocModalGroupId(null);
    setEditingDoc(null);
    setRenewingDoc(null);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Archive"
        subtitle="Company, staff, truck and customer documents — with expiry tracking and renewal history"
        actions={
          tab === "company" ? (
            <Btn variant="primary" onClick={() => { setEditingGroup(null); setGroupModalOpen(true); }}>
              <Plus className="h-4 w-4" />Create Group
            </Btn>
          ) : undefined
        }
      />

      {/* Tabs — underline style, matching TripsTabs.tsx / Maintenance. */}
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

      {/* Expiring-documents summary — sits above the tab content because it's
          a page-level roll-up (Company-only in Phase 1, all tabs later). */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-xs muted uppercase tracking-wide">Expired</div>
          <div className={cn("text-2xl font-semibold mt-1 tabular-nums", summary.expired > 0 ? "text-rose-600 dark:text-rose-400" : "")}>
            {summary.expired}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs muted uppercase tracking-wide">Expiring soon</div>
          <div className={cn("text-2xl font-semibold mt-1 tabular-nums", summary.expiringSoon > 0 ? "text-amber-600 dark:text-amber-400" : "")}>
            {summary.expiringSoon}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs muted uppercase tracking-wide">Documents</div>
          <div className="text-2xl font-semibold mt-1 tabular-nums">{documents.length}</div>
        </div>
      </div>

      {tab !== "company" ? (
        <Card>
          <p className="text-sm muted p-6 text-center">
            {TABS.find((t) => t.key === tab)?.label} documents — coming in a later phase.
          </p>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <div className="p-8 text-center">
            <p className="text-sm muted">No document groups yet.</p>
            <p className="text-xs muted mt-1">
              Create a group (e.g. Commercial Registration, Insurance) then add documents to it.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const docs = docsByGroup.get(g.id) ?? [];
            const isCollapsed = collapsed.has(g.id);
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
                      {/* Description sits BELOW the title — Turki's explicit ask. */}
                      {g.description && <span className="text-xs muted block">{g.description}</span>}
                      <span className="text-[11px] muted block mt-0.5">
                        {docs.length} document{docs.length === 1 ? "" : "s"} · warns at {g.warning_days}d
                      </span>
                    </span>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* "Add Document" sits next to THIS group's title — the
                        second step of the two-step model. */}
                    <Btn variant="outline" onClick={() => { setEditingDoc(null); setDocModalGroupId(g.id); }}>
                      <Plus className="h-3.5 w-3.5" />Add Document
                    </Btn>
                    <button
                      onClick={() => { setEditingGroup(g); setGroupModalOpen(true); }}
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
                  docs.length === 0 ? (
                    <p className="text-sm muted p-6 text-center">No documents in this group yet.</p>
                  ) : (
                    <Table>
                      <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                        <tr>
                          <TH>Document</TH>
                          <TH>Reference</TH>
                          <TH>Issued</TH>
                          <TH>Expires</TH>
                          <TH>Status</TH>
                          <TH>Files</TH>
                          <TH></TH>
                        </tr>
                      </thead>
                      <tbody>
                        {docs.map((d) => {
                          const status = docStatus(d.expiry_date, g.warning_days, today);
                          const docFiles = (filesByDoc.get(d.id) ?? []).filter((f) => f.renewal_id === null);
                          const docRenewals = renewalsByDoc.get(d.id) ?? [];
                          const showingHistory = historyDocId === d.id;
                          return (
                            <Fragment key={d.id}>
                              <tr
                                onClick={() => setDetailDocId(d.id)}
                                className={cn("cursor-pointer", ARCHIVE_STATUS_ROW_TONE[status])}
                              >
                                <TD>
                                  <span className="font-medium">{d.title}</span>
                                  {d.note && <div className="text-[11px] muted truncate max-w-[220px]">{d.note}</div>}
                                </TD>
                                <TD className="font-mono text-xs">{d.reference_no || "—"}</TD>
                                <TD className="text-xs">{fmtDate(d.issue_date)}</TD>
                                <TD className="text-xs">{fmtDate(d.expiry_date)}</TD>
                                <TD>
                                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", ARCHIVE_STATUS_PILL[status])}>
                                    {archiveStatusLabel(status, d.expiry_date, today)}
                                  </span>
                                </TD>
                                <TD>
                                  {docFiles.length === 0 ? (
                                    <span className="text-xs muted">—</span>
                                  ) : (
                                    <div className="flex items-center gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
                                      {docFiles.map((f) => (
                                        <button
                                          key={f.id}
                                          onClick={() => openFile(f.storage_path)}
                                          className="inline-flex items-center gap-1 text-[11px] rounded border px-1.5 py-0.5 hover:bg-black/5 dark:hover:bg-white/5 max-w-[140px]"
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
                                  <div
                                    className="flex items-center gap-1 justify-end"
                                    onClick={(e) => e.stopPropagation()}
                                  >
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
                                    <Btn variant="outline" onClick={() => setRenewingDoc(d)}>
                                      <RefreshCw className="h-3.5 w-3.5" />Renew
                                    </Btn>
                                    <button
                                      onClick={() => { setEditingDoc(d); setDocModalGroupId(g.id); }}
                                      className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                                      title="Edit document"
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </button>
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

                              {/* Renewal history — the superseded versions, newest
                                  first, each with its own files still attached. */}
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
                                    <TD className="font-mono text-xs muted">{r.reference_no || "—"}</TD>
                                    <TD className="text-xs muted">{fmtDate(r.issue_date)}</TD>
                                    <TD className="text-xs muted">{fmtDate(r.expiry_date)}</TD>
                                    <TD><span className="text-xs muted">Superseded</span></TD>
                                    <TD>
                                      {rFiles.length === 0 ? (
                                        <span className="text-xs muted">—</span>
                                      ) : (
                                        <div className="flex items-center gap-1 flex-wrap">
                                          {rFiles.map((f) => (
                                            <button
                                              key={f.id}
                                              onClick={() => openFile(f.storage_path)}
                                              className="inline-flex items-center gap-1 text-[11px] rounded border px-1.5 py-0.5 hover:bg-black/5 dark:hover:bg-white/5 max-w-[140px] muted"
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
                                    <TD>{null}</TD>
                                  </tr>
                                );
                              })}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </Table>
                  )
                )}
              </Card>
            );
          })}
        </div>
      )}

      {groupModalOpen && (
        <GroupModal tab="company" editingGroup={editingGroup} onClose={closeModals} onSaved={closeModals} />
      )}

      {docModalGroupId && (
        <DocumentModal
          types={types}
          groupId={docModalGroupId}
          groupTitle={groupsById.get(docModalGroupId)?.title ?? ""}
          editingDocument={editingDoc}
          existingFiles={editingDoc ? filesByDoc.get(editingDoc.id) ?? [] : []}
          onClose={closeModals}
          onSaved={() => router.refresh()}
        />
      )}

      {renewingDoc && (
        <RenewModal document={renewingDoc} onClose={closeModals} onSaved={closeModals} />
      )}

      {detailDoc && detailGroup && (
        <DocumentDetailModal
          document={detailDoc}
          group={detailGroup}
          type={detailDoc.type_key ? typesByKey.get(detailDoc.type_key) ?? null : null}
          files={filesByDoc.get(detailDoc.id) ?? []}
          renewals={renewalsByDoc.get(detailDoc.id) ?? []}
          today={today}
          onOpenFile={openFile}
          onClose={() => setDetailDocId(null)}
          onEdit={() => {
            setDetailDocId(null);
            setEditingDoc(detailDoc);
            setDocModalGroupId(detailDoc.group_id);
          }}
          onRenew={() => {
            setDetailDocId(null);
            setRenewingDoc(detailDoc);
          }}
        />
      )}
    </div>
  );
}
