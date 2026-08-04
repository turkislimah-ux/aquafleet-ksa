"use client";

// Archive — Phase 2: the STAFF tab.
//
// A LEAF module. It imports from lib/ and components/ only, and mounts NO
// modals of its own — every popup this tab can open is owned by
// ArchiveClient and reached through the callbacks below. That keeps the
// import edge one-way (ArchiveClient -> here, never back) rather than
// relying on someone remembering not to reach upward. Same structural fix
// ArchiveModals.tsx and Inventory's SharedCreateModals.tsx already apply,
// after the Phase-4 import-cycle incident that neither tsc nor next build
// catches.
//
// ===========================================================================
// THE MATRIX — the point of this tab
// ===========================================================================
// A group here is not a list of documents; it is a COMPLIANCE MATRIX. Every
// active person in the group's population gets a row whether or not they
// have the document, because a missing document is the finding. A group with
// zero documents still renders every driver — which is exactly why 0086 put
// subject_kind on the GROUP: there are no documents to infer the population
// from.
//
// EMPTY ROWS ARE DERIVED, NEVER MATERIALIZED. The "LEFT JOIN" happens right
// here in memory (people x their documents in this group). No placeholder
// document row is ever written for a person who lacks one — a stored blank
// would need cleaning up on every hire, termination and group edit, and
// would count as a real document in any query that forgot to exclude it.
//
// STATUS IS DERIVED TOO — same lib/archive.ts docStatus() the Company tab
// uses, so a document cannot read "expiring" in the page summary and "valid"
// in its row. "Missing" is deliberately NOT one of its statuses: see
// MISSING_PILL below.

import { Fragment, useMemo, useState } from "react";
import {
  Plus, Pencil, Trash2, ChevronDown, ChevronRight, RefreshCw, FileText, CornerDownRight,
} from "lucide-react";
import { Card, Btn, Table, TH, TD } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  docStatus, ARCHIVE_STATUS_ROW_TONE, ARCHIVE_STATUS_PILL, archiveStatusLabel,
  groupAccent, groupDot,
} from "@/lib/archive";
import type {
  ArchiveDocumentGroup,
  ArchiveDocument,
  ArchiveDocumentFile,
  ArchiveDriverRow,
  ArchiveStaffRow,
  StaffCommission,
  StaffCommissionType,
} from "@/lib/db-types";

export type StaffSubTab = "drivers" | "management" | "commissions" | "deleted";

export const STAFF_SUB_TABS: { key: StaffSubTab; label: string }[] = [
  { key: "drivers", label: "Drivers" },
  { key: "management", label: "Management Staff" },
  { key: "commissions", label: "Commission History" },
  { key: "deleted", label: "Soft-deleted" },
];

// A person in a matrix, flattened to what the row needs. Drivers and staff
// render through the SAME row component — the two populations differ only in
// which table they came from and which subject column their documents use,
// not in how a compliance row looks.
type Person = { id: string; name: string; secondary: string | null };

// "Missing" is a ROW state, not a document status — there is no document, so
// there is nothing for docStatus() to be computed from. Keeping it out of
// ArchiveDocStatus is deliberate: that union feeds expirySummary(), and a
// fifth member there would invite a future counter to tally "missing" into
// an expiry figure it has no business in. A gap is a gap, not an expiry.
const MISSING_PILL =
  "bg-slate-500/10 text-slate-600 dark:text-slate-400 ring-slate-500/25";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString();
}

function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ArchiveStaffTab({
  subTab,
  groups,
  documents,
  filesByDoc,
  drivers,
  staff,
  commissions,
  commissionTypes,
  today,
  onAddDocument,
  onEditDocument,
  onRenewDocument,
  onDeleteDocument,
  onOpenDocument,
  onOpenFile,
  onEditGroup,
  onDeleteGroup,
}: {
  subTab: StaffSubTab;
  groups: ArchiveDocumentGroup[];
  documents: ArchiveDocument[];
  filesByDoc: Map<string, ArchiveDocumentFile[]>;
  drivers: ArchiveDriverRow[];
  staff: ArchiveStaffRow[];
  commissions: StaffCommission[];
  commissionTypes: StaffCommissionType[];
  today: string;
  onAddDocument: (group: ArchiveDocumentGroup, person: Person) => void;
  onEditDocument: (doc: ArchiveDocument, group: ArchiveDocumentGroup, person: Person) => void;
  onRenewDocument: (doc: ArchiveDocument) => void;
  onDeleteDocument: (doc: ArchiveDocument) => void;
  onOpenDocument: (doc: ArchiveDocument) => void;
  onOpenFile: (path: string) => void;
  onEditGroup: (group: ArchiveDocumentGroup) => void;
  onDeleteGroup: (group: ArchiveDocumentGroup) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // ACTIVE = the app-wide soft-delete convention (0011/0020): terminated_at
  // NULL and active true. Terminated people are a PRE-FILTER, never a state —
  // they drop out of the matrix entirely and reappear under Soft-deleted,
  // rather than rendering as a row with some "terminated" status.
  const activeDrivers = useMemo<Person[]>(
    () =>
      drivers
        .filter((d) => d.active && !d.terminated_at)
        .map((d) => ({ id: d.id, name: d.name, secondary: d.iqama_number }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [drivers],
  );

  const activeStaff = useMemo<Person[]>(
    () =>
      staff
        .filter((s) => s.active && !s.terminated_at)
        .map((s) => ({ id: s.id, name: s.name, secondary: s.role }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [staff],
  );

  const terminatedDrivers = useMemo(
    () => drivers.filter((d) => d.terminated_at || !d.active),
    [drivers],
  );
  const terminatedStaff = useMemo(
    () => staff.filter((s) => s.terminated_at || !s.active),
    [staff],
  );

  const commissionTypeLabel = useMemo(() => {
    const m = new Map(commissionTypes.map((t) => [t.key, t.label_en]));
    // Falls back to the raw key rather than "—": a retired type still has to
    // name itself in history, and the key is readable enough to be useful.
    return (key: string) => m.get(key) ?? key;
  }, [commissionTypes]);

  const staffNameById = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff]);

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // -------------------------------------------------------------------------
  // The matrix, shared by both people sub-tabs.
  // -------------------------------------------------------------------------
  function renderMatrix(kind: "driver" | "staff", people: Person[]) {
    const kindGroups = groups.filter((g) => g.subject_kind === kind);
    const subjectLabel = kind === "driver" ? "Driver" : "Staff member";

    if (kindGroups.length === 0) {
      return (
        <Card>
          <div className="p-8 text-center">
            <p className="text-sm muted">
              No {kind === "driver" ? "driver" : "management staff"} document groups yet.
            </p>
            <p className="text-xs muted mt-1">
              Create a group (e.g. {kind === "driver" ? "Driving Licence, Iqama, Work Permit" : "Iqama, Employment Contract"}) —
              every {subjectLabel.toLowerCase()} then gets a row in it automatically.
            </p>
          </div>
        </Card>
      );
    }

    if (people.length === 0) {
      return (
        <Card>
          <p className="text-sm muted p-6 text-center">
            No active {kind === "driver" ? "drivers" : "management staff"} to track documents for.
          </p>
        </Card>
      );
    }

    return (
      <div className="space-y-3">
        {kindGroups.map((g) => {
          const isCollapsed = collapsed.has(g.id);

          // The LEFT JOIN, in memory. One entry per person, always — the
          // people list drives it, not the documents.
          const rows = people.map((p) => ({
            person: p,
            docs: documents.filter(
              (d) =>
                d.group_id === g.id &&
                (kind === "driver" ? d.driver_id === p.id : d.staff_id === p.id),
            ),
          }));

          const missing = rows.filter((r) => r.docs.length === 0).length;
          const expired = rows.reduce(
            (n, r) =>
              n + r.docs.filter((d) => docStatus(d.expiry_date, g.warning_days, today) === "expired").length,
            0,
          );

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
                      {people.length} {kind === "driver" ? "driver" : "staff"}
                      {people.length === 1 ? "" : "s"} · warns at {g.warning_days}d
                    </span>
                  </span>
                </button>

                <div className="flex items-center gap-1 shrink-0">
                  {/* Gap counters. These are the tab's headline numbers — the
                      whole reason every person gets a row. */}
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
                      <TH>{subjectLabel}</TH>
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
                    {rows.map(({ person, docs }) => {
                      // NO DOCUMENT — the gap. One row, em-dashes, a Missing
                      // pill, and a faint tint so a full group's holes are
                      // visible while scrolling rather than needing to be
                      // read cell by cell.
                      if (docs.length === 0) {
                        return (
                          <tr key={person.id} className="bg-slate-500/[0.04]">
                            <TD>
                              <span className="font-medium">{person.name}</span>
                              {person.secondary && (
                                <div className="text-[11px] muted">{person.secondary}</div>
                              )}
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
                                <Btn variant="outline" onClick={() => onAddDocument(g, person)}>
                                  <Plus className="h-3.5 w-3.5" />Add
                                </Btn>
                              </div>
                            </TD>
                          </tr>
                        );
                      }

                      // ONE ROW PER DOCUMENT. Turki allowed more than one per
                      // person per group, so each gets its own line with its
                      // own dates and status — a merged cell would force one
                      // pill to speak for two documents that can expire on
                      // different days. The name prints once; continuations
                      // are marked instead of repeated.
                      return (
                        <Fragment key={person.id}>
                          {docs.map((d, i) => {
                            const status = docStatus(d.expiry_date, g.warning_days, today);
                            const docFiles = (filesByDoc.get(d.id) ?? []).filter((f) => f.renewal_id === null);
                            return (
                              <tr
                                key={d.id}
                                onClick={() => onOpenDocument(d)}
                                className={cn("cursor-pointer", ARCHIVE_STATUS_ROW_TONE[status])}
                              >
                                <TD>
                                  {i === 0 ? (
                                    <>
                                      <span className="font-medium">{person.name}</span>
                                      {person.secondary && (
                                        <div className="text-[11px] muted">{person.secondary}</div>
                                      )}
                                      {docs.length > 1 && (
                                        <div className="text-[11px] muted mt-0.5">
                                          {docs.length} documents
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-xs muted ps-3">
                                      <CornerDownRight className="h-3 w-3" />
                                      {d.title}
                                    </span>
                                  )}
                                </TD>
                                <TD className="font-mono text-xs">{d.reference_no || "—"}</TD>
                                <TD className="text-xs">{fmtDate(d.issue_date)}</TD>
                                <TD className="text-xs">{fmtDate(d.expiry_date)}</TD>
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
                                    {archiveStatusLabel(status, d.expiry_date, today)}
                                  </span>
                                </TD>
                                <TD>
                                  <div
                                    className="flex items-center gap-1 justify-end"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <Btn variant="outline" onClick={() => onRenewDocument(d)}>
                                      <RefreshCw className="h-3.5 w-3.5" />Renew
                                    </Btn>
                                    <button
                                      onClick={() => onEditDocument(d, g, person)}
                                      className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                                      title="Edit document"
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </button>
                                    {/* Another document for the SAME person in
                                        the same group — allowed by Turki's
                                        no-uniqueness decision, so the path to
                                        it lives on the row it extends. */}
                                    {i === docs.length - 1 && (
                                      <button
                                        onClick={() => onAddDocument(g, person)}
                                        className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                                        title={`Add another document for ${person.name}`}
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

  if (subTab === "drivers") return renderMatrix("driver", activeDrivers);
  if (subTab === "management") return renderMatrix("staff", activeStaff);

  // -------------------------------------------------------------------------
  // Commission history — READ-ONLY over staff_commissions (0080).
  //
  // The archive DISPLAYS this history; it never copies it. There is no
  // archive-side commission table and no write path here — staff_commissions
  // stays the single source, edited only on the People page where it lives.
  // Commission money is standalone (Turki's money boundary) and is not summed
  // into any work-order, payroll or maintenance figure — including here: the
  // total below is a total of THIS LIST, nothing else.
  // -------------------------------------------------------------------------
  if (subTab === "commissions") {
    const rows = [...commissions].sort((a, b) => b.commission_date.localeCompare(a.commission_date));
    const total = rows.reduce((n, c) => n + Number(c.amount_sar), 0);

    return (
      <Card className="!p-0 overflow-hidden">
        <div
          className="flex items-center justify-between gap-3 p-3 border-b flex-wrap"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <div>
            <span className="font-semibold block">Commission History</span>
            <span className="text-[11px] muted">
              Read-only — recorded on the Staff page, shown here for the record.
            </span>
          </div>
          <div className="text-end">
            <div className="text-[11px] muted uppercase tracking-wide">Total shown</div>
            <div className="text-lg font-semibold tabular-nums">{fmtMoney(total)} SAR</div>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm muted p-6 text-center">No commissions recorded yet.</p>
        ) : (
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>Date</TH>
                <TH>Staff member</TH>
                <TH>Type</TH>
                <TH>Note</TH>
                <TH>Amount</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <TD className="text-xs">{fmtDate(c.commission_date)}</TD>
                  <TD>
                    {/* A commission whose staff row is gone from this fetch
                        still shows — never dropped silently. */}
                    <span className="font-medium">{staffNameById.get(c.staff_id) ?? "Unknown staff"}</span>
                  </TD>
                  <TD className="text-xs">{commissionTypeLabel(c.commission_type)}</TD>
                  <TD className="text-xs">
                    {c.note ? (
                      <span className="block truncate max-w-[260px]" title={c.note}>{c.note}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </TD>
                  <TD className="tabular-nums font-medium">{fmtMoney(Number(c.amount_sar))} SAR</TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    );
  }

  // -------------------------------------------------------------------------
  // Soft-deleted — READ-ONLY. Terminated drivers and staff, from their own
  // tables. Nothing is restored or purged from here in this phase; this is
  // the record that the app's soft-delete lock (terminated_at, never a hard
  // delete) exists to preserve. Their documents also survive by design —
  // 0084's subject FKs are ON DELETE RESTRICT precisely so a regulatory
  // document outlives its subject.
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-3">
      <Card className="!p-0 overflow-hidden">
        <div className="p-3 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <span className="font-semibold block">Terminated Drivers</span>
          <span className="text-[11px] muted">
            {terminatedDrivers.length} record{terminatedDrivers.length === 1 ? "" : "s"} · kept, never deleted
          </span>
        </div>
        {terminatedDrivers.length === 0 ? (
          <p className="text-sm muted p-6 text-center">No terminated drivers.</p>
        ) : (
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>Driver</TH>
                <TH>Iqama no.</TH>
                <TH>Last working day</TH>
                <TH>Terminated on</TH>
              </tr>
            </thead>
            <tbody>
              {terminatedDrivers.map((d) => (
                <tr key={d.id}>
                  <TD>
                    <span className="font-medium">{d.name}</span>
                    {d.name_ar && <div className="text-[11px] muted">{d.name_ar}</div>}
                  </TD>
                  <TD className="font-mono text-xs">{d.iqama_number || "—"}</TD>
                  <TD className="text-xs">{fmtDate(d.termination_date)}</TD>
                  <TD className="text-xs">
                    {d.terminated_at ? new Date(d.terminated_at).toLocaleDateString() : "—"}
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="!p-0 overflow-hidden">
        <div className="p-3 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <span className="font-semibold block">Terminated Management Staff</span>
          <span className="text-[11px] muted">
            {terminatedStaff.length} record{terminatedStaff.length === 1 ? "" : "s"} · kept, never deleted
          </span>
        </div>
        {terminatedStaff.length === 0 ? (
          <p className="text-sm muted p-6 text-center">No terminated staff.</p>
        ) : (
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>Staff member</TH>
                <TH>Role</TH>
                <TH>Terminated on</TH>
              </tr>
            </thead>
            <tbody>
              {terminatedStaff.map((s) => (
                <tr key={s.id}>
                  <TD>
                    <span className="font-medium">{s.name}</span>
                    {s.name_ar && <div className="text-[11px] muted">{s.name_ar}</div>}
                  </TD>
                  <TD className="text-xs">{s.role}</TD>
                  <TD className="text-xs">
                    {s.terminated_at ? new Date(s.terminated_at).toLocaleDateString() : "—"}
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
