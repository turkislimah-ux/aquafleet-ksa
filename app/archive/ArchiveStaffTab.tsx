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
import { cn, formatAmount, formatDate } from "@/lib/utils";
import {
  docStatus, ARCHIVE_STATUS_ROW_TONE, ARCHIVE_STATUS_PILL, archiveStatusLabel,
  groupAccent, groupDot, linkedFieldFor, linkedFieldForDoc, readPersonLink, personIdLabel,
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
import { useApp } from "@/components/AppShell";
import { t, fill, plural, arText, type Lang } from "@/lib/i18n";
import ScrollLock from "@/components/ScrollLock";

export type StaffSubTab = "drivers" | "management" | "commissions" | "deleted";

// A FUNCTION, not a module-level const. A const would be built once, at import
// time, in whatever language the module happened to be evaluated under, and
// would then never change again. The KEYS are still the only thing the picker
// calls back with — the label is display, the key is state.
export function staffSubTabs(lang: Lang): SubTabItem<StaffSubTab>[] {
  return [
    { key: "drivers", label: t("archive.staff.subTabs.drivers", lang), icon: IdCard },
    { key: "management", label: t("archive.staff.subTabs.management", lang), icon: Users },
    { key: "commissions", label: t("archive.staff.subTabs.commissions", lang), icon: Wallet },
    { key: "deleted", label: t("archive.subTabDeleted", lang), icon: Archive },
  ];
}

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
  return formatDate(iso + "T00:00:00");
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
  const { lang } = useApp();
  // `row` and not `t` — the map callback's parameter used to shadow the
  // translator import. Renaming the PARAMETER is the fix; aliasing `t` would
  // have left every other call site in this file reading the wrong name.
  const typesByKey = useMemo(() => new Map(types.map((row) => [row.key, row])), [types]);
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
    // `kind` is the closed union the caller passes, set from WHICH population
    // this matrix is rendering — never read back off the rendered word.
    const subjectLabel =
      kind === "driver" ? t("common.driver", lang) : t("archive.staff.subjectStaff", lang);

    if (kindGroups.length === 0) {
      return (
        <Card>
          <div className="p-8 text-center">
            {/* Whole sentences per kind. The English used to splice the noun
                in and lowercase the subject label — see the dictionary note
                on why a `.toLowerCase()` on a translated string is a bug. */}
            <p className="text-sm muted">{t(`archive.staff.emptyGroups.${kind}`, lang)}</p>
            <p className="text-xs muted mt-1">{t(`archive.staff.emptyGroupsHint.${kind}`, lang)}</p>
          </div>
        </Card>
      );
    }

    if (people.length === 0) {
      return (
        <Card>
          <p className="text-sm muted p-6 text-center">
            {t(`archive.staff.emptyPeople.${kind}`, lang)}
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
                    {/* PATTERN B. archive_document_types carries label_en +
                        label_ar in the row itself, so the type name renders
                        through arText and nothing is added to the dictionary
                        or to SEED_GROUPS. `g.title` / `g.description` above
                        are USER DATA and stay verbatim. */}
                    <span className="text-[11px] muted block mt-0.5">
                      {groupTypeRow
                        ? `${arText(groupTypeRow.label_en, groupTypeRow.label_ar, lang)} · `
                        : ""}
                      {fill(t(`archive.staff.peopleMeta.${kind}.${plural(people.length)}`, lang), {
                        n: people.length,
                        d: g.warning_days,
                      })}
                    </span>
                  </span>
                </button>

                <div className="flex items-center gap-1 shrink-0">
                  {/* Gap counters. These are the tab's headline numbers — the
                      whole reason every person gets a row. */}
                  {linkField && <LinkPill />}
                  {missing > 0 && (
                    <span className={cn("text-xs px-2 py-1 rounded-full ring-1 ring-inset font-medium", MISSING_PILL)}>
                      {/* Counts PEOPLE, so it is per-kind. The one beside it
                          counts DOCUMENTS and lives at the route root. */}
                      {fill(t(`archive.staff.missingCount.${kind}.${plural(missing)}`, lang), {
                        n: missing,
                      })}
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
                      <TH>{subjectLabel}</TH>
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
                                {t("archive.missingPill", lang)}
                              </span>
                            </TD>
                            <TD>
                              <div className="flex items-center justify-end">
                                <Btn variant="outline" onClick={() => onAddDocument(g, person)}>
                                  <Plus className="h-3.5 w-3.5" />{t("common.add", lang)}
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
                                          {fill(t(`archive.docsCount.${plural(docs.length)}`, lang), {
                                            n: docs.length,
                                          })}
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
                                      {/* Keyed off PersonIdField — the closed
                                          union linkedFieldForDoc resolves —
                                          not off the linked_*_field COLUMN
                                          values ('iqama_number', …), which
                                          are internal mapping keys and never
                                          reach a screen. */}
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
                                      onClick={() => onEditDocument(d, g, person)}
                                      className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                                      title={t("archive.editDocTip", lang)}
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
                                        title={fill(t("archive.staff.addAnotherFor", lang), {
                                          name: person.name,
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
                                      {t("archive.previousVersion", lang)}
                                      {/* `superseded_by` is USER DATA (an
                                          actor's name) — separator and value
                                          stay in code. */}
                                      <div className="text-[11px]">
                                        {fill(t("archive.supersededOn", lang), {
                                          date: formatDate(r.superseded_at),
                                        })}
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
          <span className="font-semibold block">{t("archive.staff.terminatedDriversTitle", lang)}</span>
          {/* Shared with Terminated Trucks, Terminated Management Staff and
              Archived Customers — same sentence, same leaf. */}
          <span className="text-[11px] muted">
            {fill(t(`archive.recordsKept.${plural(terminatedDrivers.length)}`, lang), {
              n: terminatedDrivers.length,
            })}
          </span>
        </div>
        {terminatedDrivers.length === 0 ? (
          <p className="text-sm muted p-6 text-center">
            {t("archive.staff.terminatedDriversEmpty", lang)}
          </p>
        ) : (
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>{t("common.driver", lang)}</TH>
                <TH>{t("archive.personId.driver_iqama", lang)}</TH>
                <TH>{t("archive.staff.thLastWorkingDay", lang)}</TH>
                <TH>{t("archive.staff.thTerminatedOn", lang)}</TH>
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
                    {d.terminated_at ? formatDate(d.terminated_at) : "—"}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-1 justify-end">
                      <Btn variant="outline" onClick={() => setDetailPerson({ kind: "driver", row: d })}>
                        <Eye className="h-3.5 w-3.5" />{t("common.view", lang)}
                      </Btn>
                      <Btn variant="outline" onClick={() => onRestoreDriver(d)}>
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

      <Card className="!p-0 overflow-hidden">
        <div className="p-3 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <span className="font-semibold block">{t("archive.staff.terminatedStaffTitle", lang)}</span>
          <span className="text-[11px] muted">
            {fill(t(`archive.recordsKept.${plural(terminatedStaff.length)}`, lang), {
              n: terminatedStaff.length,
            })}
          </span>
        </div>
        {terminatedStaff.length === 0 ? (
          <p className="text-sm muted p-6 text-center">
            {t("archive.staff.terminatedStaffEmpty", lang)}
          </p>
        ) : (
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>{t("archive.staff.subjectStaff", lang)}</TH>
                <TH>{t("archive.staff.thRole", lang)}</TH>
                <TH>{t("archive.staff.thTerminatedOn", lang)}</TH>
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
                    {s.terminated_at ? formatDate(s.terminated_at) : "—"}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-1 justify-end">
                      <Btn variant="outline" onClick={() => setDetailPerson({ kind: "staff", row: s })}>
                        <Eye className="h-3.5 w-3.5" />{t("common.view", lang)}
                      </Btn>
                      <Btn variant="outline" onClick={() => onRestoreStaff(s)}>
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
  const { lang } = useApp();
  // The discriminant, not the rendered word. Every per-kind lookup below keys
  // off `person.kind`.
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
            {/* row.name is USER DATA. */}
            <h2 className="font-semibold">{row.name}</h2>
            {/* One whole leaf per kind, not a noun spliced into a shared
                tail: Arabic inflects the whole phrase around the subject. */}
            <p className="text-[11px] muted">
              {t(`archive.staff.detailSubtitle.${person.kind}`, lang)}
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
          <div className="text-[11px] font-semibold uppercase tracking-wide muted">
            {t("archive.staff.secIdentity", lang)}
          </div>
          {/* EVERY VALUE in this grid is USER DATA or an app-formatted date —
              only the labels are looked up. `iqama_number`, `license_number`,
              `role`, `phone`, `email` and `duty_hours` render verbatim, and
              fmtDate/formatDate stay Latin in both languages. */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <PersonField label={t("archive.fNameAr", lang)} value={dash(row.name_ar)} />
            {/* Both arms say "Iqama ID" in English and the same words in
                Arabic, but the key still follows the SUBJECT — the two are
                separate PersonIdField members and may diverge. */}
            <PersonField
              label={t(isDriver ? "archive.personId.driver_iqama" : "archive.personId.staff_iqama", lang)}
              value={dash(row.iqama_number)}
              mono
            />
            <PersonField label={t("archive.staff.fIqamaExpiry", lang)} value={fmtDate(row.iqama_expiry)} />
            {isDriver && (
              <>
                <PersonField label={t("archive.personId.driver_license", lang)} value={dash((row as ArchiveDriverRow).license_number)} mono />
                <PersonField label={t("archive.staff.fLicenseExpiry", lang)} value={fmtDate((row as ArchiveDriverRow).license_expiry)} />
              </>
            )}
            {!isDriver && <PersonField label={t("archive.staff.thRole", lang)} value={dash((row as ArchiveStaffRow).role)} />}
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
            {t("archive.staff.secEmployment", lang)}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <PersonField label={t("archive.fPhone", lang)} value={dash(row.phone)} />
            {!isDriver && <PersonField label={t("archive.fEmail", lang)} value={dash((row as ArchiveStaffRow).email)} />}
            <PersonField label={t("archive.staff.fHireDate", lang)} value={fmtDate(row.hire_date)} />
            <PersonField label={t("archive.staff.fDutyHours", lang)} value={dash(row.duty_hours)} />
            <PersonField
              label={t("archive.staff.fMonthlySalary", lang)}
              value={
                // formatAmount output stays Latin in both languages; only the
                // currency mark moves, which is what archive.sarAmount holds.
                isDriver
                  ? (row as ArchiveDriverRow).salary_sar != null
                    ? fill(t("archive.sarAmount", lang), {
                        n: fmtMoney(Number((row as ArchiveDriverRow).salary_sar)),
                      })
                    : "—"
                  : (row as ArchiveStaffRow).monthly_salary_sar != null
                    ? fill(t("archive.sarAmount", lang), {
                        n: fmtMoney(Number((row as ArchiveStaffRow).monthly_salary_sar)),
                      })
                    : "—"
              }
            />
            {isDriver && (
              <PersonField label={t("archive.staff.thLastWorkingDay", lang)} value={fmtDate((row as ArchiveDriverRow).termination_date)} />
            )}
            <PersonField
              label={t("archive.staff.thTerminatedOn", lang)}
              value={row.terminated_at ? formatDate(row.terminated_at) : "—"}
            />
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
            {fill(t(`archive.archivedDocsCount.${plural(theirDocs.length)}`, lang), {
              n: theirDocs.length,
            })}
          </div>
          {theirDocs.length === 0 ? (
            <p className="text-sm muted">{t("archive.staff.noArchivedDocs", lang)}</p>
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
                  const status = docStatus(d.expiry_date, g?.warning_days ?? 30, today);
                  return (
                    <tr key={d.id}>
                      <TD className="text-xs">{g?.title ?? "—"}</TD>
                      <TD className="text-xs font-medium">{d.title}</TD>
                      <TD className="text-xs">{fmtDate(d.expiry_date)}</TD>
                      <TD>
                        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", ARCHIVE_STATUS_PILL[status])}>
                          {archiveStatusLabel(status, d.expiry_date, today, lang)}
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

function PersonField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] muted mb-0.5">{label}</div>
      <div className={cn("text-sm", mono && "font-mono text-xs")}>{value}</div>
    </div>
  );
}
