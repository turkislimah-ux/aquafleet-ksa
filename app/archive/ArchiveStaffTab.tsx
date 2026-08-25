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
  History, Eye, RotateCcw, X, IdCard, Users, Wallet, Archive,
} from "lucide-react";
import { Card, Btn, Table, TH, TD } from "@/components/ui";
import { LinkPill } from "./ArchiveModals";
import type { SubTabItem } from "./SubTabPicker";
import { cn, formatAmount } from "@/lib/utils";
import {
  docStatus, ARCHIVE_STATUS_ROW_TONE, ARCHIVE_STATUS_PILL, archiveStatusLabel,
  groupAccent, groupDot, linkedFieldFor, linkedFieldForDoc, readPersonLink, PERSON_ID_LABEL,
} from "@/lib/archive";
import type {
  ArchiveDocumentGroup,
  ArchiveDocument,
  ArchiveDocumentFile,
  ArchiveDocumentRenewal,
  ArchiveDocumentType,
  ArchiveDriverRow,
  ArchiveStaffRow,
} from "@/lib/db-types";
import ScrollLock from "@/components/ScrollLock";

export type StaffSubTab = "drivers" | "management" | "commissions" | "deleted";

export const STAFF_SUB_TABS: SubTabItem<StaffSubTab>[] = [
  { key: "drivers", label: "Drivers", icon: IdCard },
  { key: "management", label: "Management Staff", icon: Users },
  { key: "commissions", label: "Commission History", icon: Wallet },
  { key: "deleted", label: "Soft-deleted", icon: Archive },
];

// A person in a matrix, flattened to what the row needs. Drivers and staff
// render through the SAME row component — the two populations differ only in
// which table they came from and which subject column their documents use,
// not in how a compliance row looks.
type Person = {
  id: string;
  name: string;
  secondary: string | null;
  // The person's own ID columns (0088/0089). For a LINKED document the
  // matrix reads BOTH the number and the expiry from here — the document
  // stores neither, so this is the only source for its reference cell and
  // for its red/yellow status.
  iqama_number: string | null;
  iqama_expiry: string | null;
  license_number: string | null;
  license_expiry: string | null;
};

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

// No " SAR" suffix here on purpose — the unit is in the column header. Was a
// local `toLocaleString(undefined, …)`, which followed the browser's locale
// and rendered Arabic-Indic digits on an Arabic device.
const fmtMoney = (n: number): string => formatAmount(n);

export default function ArchiveStaffTab({
  subTab,
  groups,
  documents,
  filesByDoc,
  renewalsByDoc,
  drivers,
  staff,
  types,
  commissionHistory,
  today,
  highlightPersonId,
  onAddDocument,
  onEditDocument,
  onRenewDocument,
  onDeleteDocument,
  onOpenDocument,
  onOpenFile,
  onEditGroup,
  onDeleteGroup,
  onRestoreDriver,
  onRestoreStaff,
}: {
  subTab: StaffSubTab;
  groups: ArchiveDocumentGroup[];
  documents: ArchiveDocument[];
  filesByDoc: Map<string, ArchiveDocumentFile[]>;
  renewalsByDoc: Map<string, ArchiveDocumentRenewal[]>;
  drivers: ArchiveDriverRow[];
  staff: ArchiveStaffRow[];
  // Carries linked_driver_field / linked_staff_field, so whether a group is
  // linked is read from the data rather than a hardcoded list of type keys.
  types: ArchiveDocumentType[];
  // The Commission History sub-tab is a MIRROR of the Staff page's own
  // History tab, rendered by that very component — see its mount below.
  commissionHistory: React.ReactNode;
  today: string;
  // Deep-link target: the person whose row to scroll to and flash, arriving
  // from a clicked ID number elsewhere in the app.
  highlightPersonId: string | null;
  onAddDocument: (group: ArchiveDocumentGroup, person: Person) => void;
  onEditDocument: (doc: ArchiveDocument, group: ArchiveDocumentGroup, person: Person) => void;
  onRenewDocument: (doc: ArchiveDocument) => void;
  onDeleteDocument: (doc: ArchiveDocument) => void;
  onOpenDocument: (doc: ArchiveDocument) => void;
  onOpenFile: (path: string) => void;
  onEditGroup: (group: ArchiveDocumentGroup) => void;
  onDeleteGroup: (group: ArchiveDocumentGroup) => void;
  onRestoreDriver: (d: ArchiveDriverRow) => void;
  onRestoreStaff: (s: ArchiveStaffRow) => void;
}) {
  const typesByKey = useMemo(() => new Map(types.map((t) => [t.key, t])), [types]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Which document's renewal history is expanded — same one-at-a-time model
  // the Company tab's table uses.
  const [historyDocId, setHistoryDocId] = useState<string | null>(null);
  const [detailPerson, setDetailPerson] = useState<
    { kind: "driver"; row: ArchiveDriverRow } | { kind: "staff"; row: ArchiveStaffRow } | null
  >(null);

  // ACTIVE = the app-wide soft-delete convention (0011/0020): terminated_at
  // NULL and active true. Terminated people are a PRE-FILTER, never a state —
  // they drop out of the matrix entirely and reappear under Soft-deleted,
  // rather than rendering as a row with some "terminated" status.
  const activeDrivers = useMemo<Person[]>(
    () =>
      drivers
        .filter((d) => d.active && !d.terminated_at)
        .map((d) => ({
          id: d.id,
          name: d.name,
          secondary: null,
          iqama_number: d.iqama_number,
          iqama_expiry: d.iqama_expiry,
          license_number: d.license_number,
          license_expiry: d.license_expiry,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [drivers],
  );

  const activeStaff = useMemo<Person[]>(
    () =>
      staff
        .filter((s) => s.active && !s.terminated_at)
        .map((s) => ({
          id: s.id,
          name: s.name,
          secondary: s.role,
          iqama_number: s.iqama_number,
          iqama_expiry: s.iqama_expiry,
          license_number: null,
          license_expiry: null,
        }))
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
          // Decided ONCE per group (0089 put the type on the group), not per
          // document — so every row in a group agrees about whether it is
          // linked.
          const groupTypeRow = g.type_key ? typesByKey.get(g.type_key) ?? null : null;
          const linkField = linkedFieldFor(groupTypeRow, kind);

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
          // Expiry comes from the PERSON for a linked group — the documents
          // hold none. Same source the row pills use, so the header count and
          // the rows can never disagree.
          const expired = rows.reduce((n, r) => {
            const personExpiry = linkField ? readPersonLink(linkField, r.person).expiry : null;
            return (
              n +
              r.docs.filter(
                (d) =>
                  docStatus(linkField ? personExpiry : d.expiry_date, g.warning_days, today) === "expired",
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
                      {people.length} {kind === "driver" ? "driver" : "staff"}
                      {people.length === 1 ? "" : "s"} · warns at {g.warning_days}d
                    </span>
                  </span>
                </button>

                <div className="flex items-center gap-1 shrink-0">
                  {/* Gap counters. These are the tab's headline numbers — the
                      whole reason every person gets a row. */}
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
                          <tr
                            key={person.id}
                            data-person={person.id}
                            className={cn(
                              "bg-slate-500/[0.04]",
                              person.id === highlightPersonId && "ring-2 ring-inset ring-brand-500",
                            )}
                          >
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
                            // ONE source per row, resolved from the DOCUMENT's
                            // own driver_id/staff_id rather than the group's
                            // kind — so an iqama document (linked for BOTH
                            // populations) can never resolve to the wrong
                            // person column.
                            const rowField = linkedFieldForDoc(groupTypeRow, d) ?? linkField;
                            const link = rowField ? readPersonLink(rowField, person) : null;
                            const effectiveExpiry = link ? link.expiry : d.expiry_date;
                            const status = docStatus(effectiveExpiry, g.warning_days, today);
                            const docFiles = (filesByDoc.get(d.id) ?? []).filter((f) => f.renewal_id === null);
                            const docRenewals = renewalsByDoc.get(d.id) ?? [];
                            const showingHistory = historyDocId === d.id;
                            return (
                              <Fragment key={d.id}>
                              <tr
                                data-person={person.id}
                                onClick={() => onOpenDocument(d)}
                                className={cn(
                                  "cursor-pointer",
                                  ARCHIVE_STATUS_ROW_TONE[status],
                                  i === 0 && person.id === highlightPersonId && "ring-2 ring-inset ring-brand-500",
                                )}
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

                              {/* Prior versions, expanded under the row —
                                  identical to the Company tab's own history
                                  rows. A renewal keeps the person's ID number
                                  unchanged (that is the whole point of 0088),
                                  so the reference column is blank here for a
                                  linked document rather than repeating it. */}
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
                                    <TD className="font-mono text-xs muted">{linkField ? "—" : (r.reference_no || "—")}</TD>
                                    <TD className="text-xs muted">{fmtDate(r.issue_date)}</TD>
                                    <TD className="text-xs muted">{linkField ? "—" : fmtDate(r.expiry_date)}</TD>
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

  if (subTab === "drivers") return renderMatrix("driver", activeDrivers);
  if (subTab === "management") return renderMatrix("staff", activeStaff);

  // -------------------------------------------------------------------------
  // Commission History — a READ-ONLY MIRROR of the Staff page's History tab.
  //
  // It renders that page's OWN HistoryTab component, passed in as a node by
  // ArchiveClient. Not a lookalike rebuilt here: "same data, same view
  // button, same KPIs" is guaranteed structurally, because it IS the same
  // component. A copy would drift the first time that tab changes.
  //
  // Read-only needs no enforcement: HistoryTab has no write path at all. A
  // paid cycle is immutable ("Nothing here mutates" — its own header), so the
  // archive gets the view and the frozen payout snapshot with nothing to
  // suppress.
  //
  // NOTE, corrected in this round: Phase 2 built this sub-tab over
  // staff_commissions (0080 — MECHANIC commissions, recorded on the staff
  // page's own section). That is a different dataset from the Staff page's
  // History tab, which lists frozen DRIVER payouts from commission_payouts.
  // Turki asked for the History tab, so this now mirrors that one.
  // -------------------------------------------------------------------------
  if (subTab === "commissions") {
    return <>{commissionHistory}</>;
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
                <TH>Iqama ID</TH>
                <TH>Last working day</TH>
                <TH>Terminated on</TH>
                <TH>{null}</TH>
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
                  <TD>
                    <div className="flex items-center gap-1 justify-end">
                      <Btn variant="outline" onClick={() => setDetailPerson({ kind: "driver", row: d })}>
                        <Eye className="h-3.5 w-3.5" />View
                      </Btn>
                      <Btn variant="outline" onClick={() => onRestoreDriver(d)}>
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
                <TH>{null}</TH>
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
                  <TD>
                    <div className="flex items-center gap-1 justify-end">
                      <Btn variant="outline" onClick={() => setDetailPerson({ kind: "staff", row: s })}>
                        <Eye className="h-3.5 w-3.5" />View
                      </Btn>
                      <Btn variant="outline" onClick={() => onRestoreStaff(s)}>
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

      {detailPerson && (
        <TerminatedPersonDetail
          person={detailPerson}
          documents={documents}
          groups={groups}
          today={today}
          onRestore={() =>
            detailPerson.kind === "driver"
              ? onRestoreDriver(detailPerson.row)
              : onRestoreStaff(detailPerson.row)
          }
          onClose={() => setDetailPerson(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Terminated-person details — every field this page holds on them, plus the
// archive documents that OUTLIVED the termination (0084's subject FKs are ON
// DELETE RESTRICT precisely so a regulatory document survives its subject).
//
// Read-only apart from Restore. Rendered inline rather than in
// ArchiveModals.tsx because it is specific to this tab and nothing else
// mounts it — the leaf rule is about not importing BACK to a parent, which
// this does not do.
// ---------------------------------------------------------------------------
function TerminatedPersonDetail({
  person,
  documents,
  groups,
  today,
  onRestore,
  onClose,
}: {
  person: { kind: "driver"; row: ArchiveDriverRow } | { kind: "staff"; row: ArchiveStaffRow };
  documents: ArchiveDocument[];
  groups: ArchiveDocumentGroup[];
  today: string;
  onRestore: () => void;
  onClose: () => void;
}) {
  const isDriver = person.kind === "driver";
  const row = person.row;
  const groupsById = new Map(groups.map((g) => [g.id, g]));
  const theirDocs = documents.filter((d) =>
    isDriver ? d.driver_id === row.id : d.staff_id === row.id,
  );
  const dash = (v: string | number | null | undefined) =>
    v === null || v === undefined || v === "" ? "—" : String(v);

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
            <h2 className="font-semibold">{row.name}</h2>
            <p className="text-[11px] muted">
              {isDriver ? "Terminated driver" : "Terminated staff member"} · record kept, never deleted
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
          <div className="text-[11px] font-semibold uppercase tracking-wide muted">Identity</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <PersonField label="Name (Arabic)" value={dash(row.name_ar)} />
            <PersonField label="Iqama ID" value={dash(row.iqama_number)} mono />
            <PersonField label="Iqama expiry" value={fmtDate(row.iqama_expiry)} />
            {isDriver && (
              <>
                <PersonField label="License ID" value={dash((row as ArchiveDriverRow).license_number)} mono />
                <PersonField label="License expiry" value={fmtDate((row as ArchiveDriverRow).license_expiry)} />
              </>
            )}
            {!isDriver && <PersonField label="Role" value={dash((row as ArchiveStaffRow).role)} />}
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">Employment</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <PersonField label="Phone" value={dash(row.phone)} />
            {!isDriver && <PersonField label="Email" value={dash((row as ArchiveStaffRow).email)} />}
            <PersonField label="Hire date" value={fmtDate(row.hire_date)} />
            <PersonField label="Duty hours" value={dash(row.duty_hours)} />
            <PersonField
              label="Monthly salary"
              value={
                isDriver
                  ? (row as ArchiveDriverRow).salary_sar != null
                    ? `${fmtMoney(Number((row as ArchiveDriverRow).salary_sar))} SAR`
                    : "—"
                  : (row as ArchiveStaffRow).monthly_salary_sar != null
                    ? `${fmtMoney(Number((row as ArchiveStaffRow).monthly_salary_sar))} SAR`
                    : "—"
              }
            />
            {isDriver && (
              <PersonField label="Last working day" value={fmtDate((row as ArchiveDriverRow).termination_date)} />
            )}
            <PersonField
              label="Terminated on"
              value={row.terminated_at ? new Date(row.terminated_at).toLocaleDateString() : "—"}
            />
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
            Archived documents ({theirDocs.length})
          </div>
          {theirDocs.length === 0 ? (
            <p className="text-sm muted">No archived documents for this person.</p>
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
                  const status = docStatus(d.expiry_date, g?.warning_days ?? 30, today);
                  return (
                    <tr key={d.id}>
                      <TD className="text-xs">{g?.title ?? "—"}</TD>
                      <TD className="text-xs font-medium">{d.title}</TD>
                      <TD className="text-xs">{fmtDate(d.expiry_date)}</TD>
                      <TD>
                        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", ARCHIVE_STATUS_PILL[status])}>
                          {archiveStatusLabel(status, d.expiry_date, today)}
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

function PersonField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] muted mb-0.5">{label}</div>
      <div className={cn("text-sm", mono && "font-mono text-xs")}>{value}</div>
    </div>
  );
}
