"use client";

// Archive — the three popups (group create/edit, add/edit document, renew)
// plus the shared ModalOverlay.
//
// A LEAF module: it imports from lib/ and components/ only, never back from
// ArchiveClient.tsx — so the one-way edge is structural, not a convention
// someone has to remember. Same fix Inventory's SharedCreateModals.tsx
// established after the Phase-4 import-cycle incident (a mutual import
// between sibling page files resolves to `undefined` at request time in
// Next's dev module system and blanks the whole page, and neither tsc nor
// next build catches it).

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Trash2, FileText, Upload, User, Truck as TruckIcon, ChevronDown, Lock, Link as LinkIcon } from "lucide-react";
import { Btn } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  ARCHIVE_GROUP_COLORS, ARCHIVE_STATUS_PILL, archiveStatusLabel, docStatus, groupDot,
  linkedFieldFor, groupExpectsLink, PERSON_ID_LABEL,
  type PersonIdField, type LinkSubjectKind,
} from "@/lib/archive";
import type {
  ArchiveTab,
  ArchiveSubjectKind,
  ArchiveDocumentGroup,
  ArchiveDocument,
  ArchiveDocumentFile,
  ArchiveDocumentRenewal,
  ArchiveDocumentType,
} from "@/lib/db-types";
import {
  createArchiveGroup,
  updateArchiveGroup,
  createArchiveDocument,
  updateArchiveDocument,
  renewArchiveDocument,
  uploadArchiveDocumentFile,
  removeArchiveDocumentFile,
  addArchiveDocumentType,
  setPersonLinkedId,
} from "./actions";

// The purple "Link" pill. Purple because every other status colour in the
// archive is already spoken for by expiry (red/amber/green/slate) — a link is
// a different kind of fact, so it gets a colour that can never be misread as
// an expiry state.
export function LinkPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/25">
      <LinkIcon className="h-3 w-3" />
      Link
    </span>
  );
}

// A pulled, read-only value. Used wherever a linked number/expiry is SHOWN
// rather than entered — Add attaches a document to a fact that already
// exists, so a fresh-looking input there would invite typing a second copy of
// it, which 0092 now refuses at the database anyway.
function LockedValue({ value }: { value: string }) {
  return (
    <div
      className="px-3 py-2 rounded-lg border text-sm opacity-60 cursor-not-allowed flex items-center gap-2 bg-black/[0.03] dark:bg-white/[0.03]"
      style={INPUT_STYLE}
      aria-disabled
    >
      <Lock className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{value || "Not set"}</span>
    </div>
  );
}

// Type dropdown with the Link pill on the RIGHT of each type name. Native
// <option> can't hold markup, so this is a real listbox.
function TypePicker({
  types,
  value,
  subjectKind,
  onChange,
}: {
  types: ArchiveDocumentType[];
  value: string;
  subjectKind: LinkSubjectKind | null;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = types.find((t) => t.key === value) ?? null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(INPUT, "flex items-center justify-between gap-2 text-start")}
        style={INPUT_STYLE}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className={cn("truncate", !selected && "muted")}>
            {selected ? selected.label_en : "Choose a type…"}
          </span>
          {selected && linkedFieldFor(selected, subjectKind) && <LinkPill />}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 muted" />
      </button>

      {open && (
        <>
          {/* Click-away layer — keeps the popover self-contained. */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul
            className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto scrollbar-thin rounded-lg border shadow-lg py-1"
            style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
          >
            {types.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => { onChange(t.key); setOpen(false); }}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-start hover:bg-black/5 dark:hover:bg-white/5",
                    t.key === value && "bg-brand-500/10",
                  )}
                >
                  <span className="truncate">{t.label_en}</span>
                  {/* RIGHT of the type text, per Turki. Shown when the type
                      links for THIS group's population — an iqama type shows
                      it for both, a license type only for drivers. */}
                  {linkedFieldFor(t, subjectKind) && <LinkPill />}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full bg-transparent";
const INPUT_STYLE = { borderColor: "rgb(var(--border))" } as const;

// Widened well beyond images (Turki's ask). Verified: the archive-documents
// bucket has NO mime-type or size restriction at the storage level, so this
// list is purely what the PICKER offers — the only real ceiling is the
// project-global upload cap enforced in actions.ts (MAX_FILE_BYTES).
// Extensions are listed alongside mime types because Windows/macOS report
// Office files inconsistently (a .docx can arrive as
// application/octet-stream), and an extension match is what makes the picker
// actually accept them in that case.
const ACCEPT_FILE_TYPES = [
  "image/*",
  "application/pdf",
  ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.odt,.ods,.ppt,.pptx",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");

// A file chosen but NOT yet uploaded — the create/renew popups stage these
// locally and upload them only AFTER the row they attach to exists.
export type StagedFile = { id: string; file: File };

function newStagedId(): string {
  return `staged-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Shared staged-file picker + list. Used by BOTH create and renew, so the
// two behave identically instead of drifting apart.
function StagedFilePicker({
  staged,
  onAdd,
  onRemove,
  hint,
}: {
  staged: StagedFile[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  hint: string;
}) {
  return (
    <div className="space-y-2">
      {staged.length > 0 && (
        <ul className="space-y-1">
          {staged.map((sf) => (
            <li
              key={sf.id}
              className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
              style={INPUT_STYLE}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 muted" />
              <span className="truncate flex-1">{sf.file.name}</span>
              <span className="muted shrink-0">{(sf.file.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                onClick={() => onRemove(sf.id)}
                className="p-1 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                aria-label="Remove file"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label
        className="inline-flex items-center gap-1.5 text-xs rounded-lg border px-2.5 py-1.5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
        style={INPUT_STYLE}
      >
        <Upload className="h-3.5 w-3.5" />
        Attach files
        <input
          type="file"
          multiple
          accept={ACCEPT_FILE_TYPES}
          onChange={(e) => {
            onAdd(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
          className="hidden"
        />
      </label>
      <p className="text-[11px] muted">{hint}</p>
    </div>
  );
}

// Portal + mounted guard + stopPropagation on the backdrop — the exact
// pattern Inventory's ModalOverlay settled on. Portaling makes stacked
// modals DOM siblings rather than nested, so a child's backdrop click has no
// parent-modal ancestor to bubble into and accidentally close.
export function ModalOverlay({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

function ModalShell({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  // `wide` = the 1080px width every other size:lg popup in this app uses
  // (see InventoryClient.tsx). The document form earns it: it now carries
  // 9 fields plus an attachment list.
  wide?: boolean;
}) {
  return (
    <ModalOverlay onClick={onClose}>
      <div
        className={cn(
          "card w-full max-h-[90vh] overflow-y-auto scrollbar-thin p-0",
          wide ? "max-w-[1080px]" : "max-w-[560px]",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between p-4 border-b"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <h2 className="font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">{children}</div>
        <div
          className="flex justify-end gap-2 p-4 border-t"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          {footer}
        </div>
      </div>
    </ModalOverlay>
  );
}

// ---------------------------------------------------------------------------
// Group create / edit — step one of Turki's two-step model.
// ---------------------------------------------------------------------------
export function GroupModal({
  tab,
  defaultSubjectKind = "none",
  types,
  editingGroup,
  onClose,
  onSaved,
}: {
  tab: ArchiveTab;
  // Offered as the group's type on staff/truck tabs. Carries the linked_*
  // columns, so the purple Link pill is read straight off the data.
  types: ArchiveDocumentType[];
  // Which population a NEW group is for. The caller passes the sub-tab the
  // user is standing in, so the picker below opens on the right answer
  // instead of making them restate it.
  defaultSubjectKind?: ArchiveSubjectKind;
  editingGroup?: ArchiveDocumentGroup | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editingGroup;
  const [title, setTitle] = useState(editingGroup?.title ?? "");
  const [description, setDescription] = useState(editingGroup?.description ?? "");
  const [color, setColor] = useState(editingGroup?.color ?? "brand");
  const [warningDays, setWarningDays] = useState(editingGroup?.warning_days ?? 30);
  const [subjectKind, setSubjectKind] = useState<ArchiveSubjectKind>(
    editingGroup?.subject_kind ?? defaultSubjectKind,
  );
  // 0089 — the group's type. Every document in a staff/truck group is this
  // type, which is what lets the LINK be decided once, at the group, instead
  // of per document.
  const [groupTypeKey, setGroupTypeKey] = useState(editingGroup?.type_key ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedLinkField = linkedFieldFor(
    types.find((t) => t.key === groupTypeKey),
    subjectKind === "driver" ? "driver"
    : subjectKind === "staff" ? "staff"
    : subjectKind === "truck" ? "truck"
    : null,
  );

  async function submit() {
    if (!title.trim()) {
      setError("Group title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const input = {
      tab,
      subject_kind: subjectKind,
      type_key: tab === "staff" || tab === "truck" ? groupTypeKey || null : null,
      title,
      description: description || null,
      color,
      warning_days: warningDays,
    };
    const res = isEdit
      ? await updateArchiveGroup(editingGroup!.id, input)
      : await createArchiveGroup(input);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  return (
    <ModalShell
      title={isEdit ? "Edit Group" : "Create Group"}
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={submit} disabled={saving || !title.trim()}>
            {saving ? "…" : "Save"}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">{error}</div>
      )}

      <div>
        <label className="text-xs muted block mb-1">Title *</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} style={INPUT_STYLE} autoFocus />
      </div>

      {/* WHO the group is for — staff tab only, because it is the only tab
          with two populations. Required by the DB: 0086's CHECK refuses a
          staff group left at the default 'none'. LOCKED once the group
          exists: flipping it would put every document already filed in the
          group in violation of 0087's guard at once. */}
      {tab === "staff" && (
        <div>
          <label className="text-xs muted block mb-1">This group is for *</label>
          {isEdit ? (
            <div className="px-3 py-2 rounded-lg border text-sm opacity-60" style={INPUT_STYLE}>
              {subjectKind === "driver" ? "Drivers" : "Management staff"}
            </div>
          ) : (
            <div className="flex gap-2">
              {([
                { key: "driver" as const, label: "Drivers" },
                { key: "staff" as const, label: "Management staff" },
              ]).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setSubjectKind(o.key)}
                  className={cn(
                    "flex-1 px-3 py-2 rounded-lg border text-sm transition",
                    subjectKind === o.key
                      ? "border-brand-600 bg-brand-500/10 text-brand-700 dark:text-brand-300 font-medium"
                      : "hover:bg-black/5 dark:hover:bg-white/5",
                  )}
                  style={subjectKind === o.key ? undefined : INPUT_STYLE}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] muted mt-1">
            {isEdit
              ? "Cannot be changed after the group is created."
              : "Every person in this list gets a row, whether or not they have the document yet."}
          </p>
        </div>
      )}

      {(tab === "staff" || tab === "truck") && (
        <div>
          <label className="text-xs muted block mb-1">Document type *</label>
          {isEdit ? (
            <div className="px-3 py-2 rounded-lg border text-sm opacity-60 flex items-center gap-2" style={INPUT_STYLE}>
              {types.find((t) => t.key === groupTypeKey)?.label_en ?? "—"}
              {linkedFieldFor(
                types.find((t) => t.key === groupTypeKey),
                subjectKind === "driver" ? "driver"
                : subjectKind === "staff" ? "staff"
                : subjectKind === "truck" ? "truck"
                : null,
              ) && <LinkPill />}
            </div>
          ) : (
            <>
              {/* A custom listbox, not a native <select>: an <option> cannot
                  carry a styled pill in any browser, and Turki wants the
                  purple Link pill sitting to the RIGHT of the type name in
                  the dropdown itself. Same reason Inventory's PartPicker
                  exists rather than a restyled select. */}
              <TypePicker
                types={types.filter((t) => t.active || t.key === groupTypeKey)}
                value={groupTypeKey}
                subjectKind={
                  subjectKind === "driver" ? "driver"
                  : subjectKind === "staff" ? "staff"
                  : subjectKind === "truck" ? "truck"
                  : null
                }
                onChange={setGroupTypeKey}
              />
              {/* The pill itself now sits in the picker — on the selected
                  row and on each option — so this is the explanation only. A
                  second pill here would repeat what is visible two lines up. */}
              {selectedLinkField && (
                <p className="text-[11px] muted mt-1.5">
                  The {PERSON_ID_LABEL[selectedLinkField].toLowerCase()} and its expiry live on the
                  person. Documents here read those; they store no copy.
                </p>
              )}
            </>
          )}
          <p className="text-[11px] muted mt-1">
            {isEdit
              ? "Cannot be changed after the group is created."
              : "Every document in this group is this type."}
          </p>
        </div>
      )}

      <div>
        <label className="text-xs muted block mb-1">Description</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Shown under the group title — optional"
          className={INPUT}
          style={INPUT_STYLE}
        />
      </div>

      <div>
        <label className="text-xs muted block mb-1">Color</label>
        <div className="flex items-center gap-2 flex-wrap">
          {ARCHIVE_GROUP_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setColor(c.key)}
              className={cn(
                "h-8 w-8 rounded-full grid place-items-center border-2 transition",
                color === c.key ? "border-brand-600" : "border-transparent hover:border-black/10 dark:hover:border-white/10",
              )}
              title={c.key}
            >
              <span className={cn("h-4 w-4 rounded-full", c.dot)} />
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs muted block mb-1">Warn when expiring within (days) *</label>
        <input
          type="number"
          min={1}
          value={warningDays}
          onChange={(e) => setWarningDays(Number(e.target.value) || 0)}
          className={INPUT}
          style={INPUT_STYLE}
        />
        <p className="text-[11px] muted mt-1">
          Documents in this group turn yellow inside this window, red once expired.
        </p>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Add / edit document — the UNIVERSAL input set. Deliberately generic so ONE
// form fits any regulatory document, now in three labelled sections
// (Identity / Reference + validity / Attachments) across a wide layout,
// because the field count outgrew a single narrow column.
//
// FILE HANDLING DIFFERS BY MODE, on purpose:
//   - CREATE: files are STAGED locally and uploaded only after the document
//     row exists (a file needs a document_id to attach to). If the row saves
//     but an upload fails, the document is kept and the failure is reported
//     with the file named — never a silent drop.
//   - EDIT: the document already exists, so files upload immediately, which
//     also lets existing attachments be removed inline.
// ---------------------------------------------------------------------------
export function DocumentModal({
  groupId,
  groupTitle,
  subject,
  groupType,
  editingDocument,
  existingFiles,
  types,
  onClose,
  onSaved,
}: {
  groupId: string;
  groupTitle: string;
  // WHOSE document this is, when the group demands a subject (0086/0087).
  // Supplied by the matrix row that was clicked — never typed, never picked
  // in this form. That is what makes the guard unreachable in normal use
  // rather than merely unlikely: the group and the subject arrive together,
  // from the same click.
  //
  // Undefined = a company group (subject_kind 'none'), Phase 1's behaviour.
  subject?: {
    kind: "driver" | "staff" | "truck";
    id: string;
    name: string;
    // The person's CURRENT number AND expiry for whichever field this
    // group's type links to. Both arrive together because both live on the
    // person and both are edited here (0089).
    linkedNumber?: string | null;
    linkedExpiry?: string | null;
  };
  // The group's own type (0089), for staff/truck groups. When set, the Type
  // field is INHERITED and shown blocked/faded — the group already answered
  // that question, and letting a document disagree with its group is exactly
  // what moving the type up to the group was meant to prevent.
  groupType?: ArchiveDocumentType | null;
  editingDocument?: ArchiveDocument | null;
  existingFiles?: ArchiveDocumentFile[];
  types: ArchiveDocumentType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editingDocument;
  const [title, setTitle] = useState(editingDocument?.title ?? "");
  const [referenceNo, setReferenceNo] = useState(editingDocument?.reference_no ?? "");
  // THE LINK (0088/0089). For a linked combination the number AND expiry
  // live on the PERSON, so these are seeded from their row — not from the
  // document — and saved back to them. Held separately from referenceNo /
  // expiryDate so the two pairs can never be written to the same place.
  const [personNumber, setPersonNumber] = useState("");
  const [personExpiry, setPersonExpiry] = useState("");
  const [issueDate, setIssueDate] = useState(editingDocument?.issue_date ?? "");
  const [expiryDate, setExpiryDate] = useState(editingDocument?.expiry_date ?? "");
  const [note, setNote] = useState(editingDocument?.note ?? "");
  const [issuingEntity, setIssuingEntity] = useState(editingDocument?.issuing_entity ?? "");
  const [holderName, setHolderName] = useState(editingDocument?.holder_name ?? "");
  const [typeKey, setTypeKey] = useState(editingDocument?.type_key ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline "add new type" — locally merged so a just-created type is
  // selectable immediately, without waiting for the page to refetch. Same
  // merge-in-flight pattern the Inventory create-modals already use.
  const [localTypes, setLocalTypes] = useState<ArchiveDocumentType[]>([]);
  const [addingType, setAddingType] = useState(false);
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [savingType, setSavingType] = useState(false);

  // The picker offers ACTIVE types only — plus, always, whatever this
  // document is already set to. A type retired after a document was filed
  // must still show as that document's type, otherwise opening Edit and
  // pressing Save would silently blank a field nobody touched.
  const allTypes = useMemo(() => {
    const seen = new Set(types.map((t) => t.key));
    const merged = [...types, ...localTypes.filter((t) => !seen.has(t.key))];
    return merged.filter((t) => t.active || t.key === editingDocument?.type_key);
  }, [types, localTypes, editingDocument]);

  // In a staff/truck group the type is INHERITED from the group and cannot
  // be chosen here; on the company tab it is still per-document (0085).
  const inheritedType = groupType ?? null;
  const effectiveTypeKey = inheritedType ? inheritedType.key : typeKey;

  // Is this document linked? Resolved from the SUBJECT — for a driver
  // document that is linked_driver_field, for a staff document
  // linked_staff_field — even when BOTH are set, which is the case for iqama
  // and was the source of the persistence bug.
  const idField: PersonIdField | null = linkedFieldFor(inheritedType, subject?.kind ?? null);

  // The guard that removes the silent fallback. If the group's type links for
  // this subject but no concrete field resolved, the number must NOT quietly
  // go onto the document's reference_no — that is precisely how a linked
  // number goes missing from the person's record and never sticks on re-edit.
  const linkExpected = groupExpectsLink(inheritedType, subject?.kind ?? null);

  // Seed the person's number + expiry once the linked field is known.
  useEffect(() => {
    if (!idField || !subject) return;
    setPersonNumber(subject.linkedNumber ?? "");
    setPersonExpiry(subject.linkedExpiry ?? "");
  }, [idField, subject]);

  async function submitNewType() {
    const label = newTypeLabel.trim();
    if (!label) return;
    setSavingType(true);
    setError(null);
    const res = await addArchiveDocumentType(label);
    setSavingType(false);
    if (res.error || !res.type) {
      setError(res.error ?? "Could not add type.");
      return;
    }
    setLocalTypes((prev) => [...prev, res.type!]);
    setTypeKey(res.type.key);
    setNewTypeLabel("");
    setAddingType(false);
  }

  const currentFiles = (existingFiles ?? []).filter((f) => f.renewal_id === null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);

  async function onUploadNow(picked: File[]) {
    if (!editingDocument) return;
    setUploading(true);
    setError(null);
    for (const file of picked) {
      const fd = new FormData();
      fd.set("documentId", editingDocument.id);
      fd.set("file", file);
      const res = await uploadArchiveDocumentFile(fd);
      if (res.error) {
        setError(`${file.name}: ${res.error}`);
        break;
      }
    }
    setUploading(false);
    onSaved();
  }

  async function onRemoveFile(fileId: string) {
    setBusyFileId(fileId);
    const res = await removeArchiveDocumentFile(fileId);
    setBusyFileId(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  async function submit() {
    if (!title.trim()) {
      setError("Document title is required.");
      return;
    }
    // FAIL LOUDLY rather than write the number to the wrong place.
    if (linkExpected && !idField) {
      setError(
        "This group's type is linked to a person field, but that field could not be resolved. Not saving — the number would be stored on the document instead of the person.",
      );
      return;
    }

    setSaving(true);
    setError(null);

    // The subject's number is saved FIRST for a linked document — but ONLY
    // on EDIT. On CREATE the fields are locked and pulled (Turki's UX lock):
    // Add means "attach a document to the number that already exists", not
    // "type a number here", so there is nothing new to write and nothing to
    // accidentally overwrite on the subject's record.
    if (idField && subject && isEdit) {
      const res = await setPersonLinkedId(idField, subject.id, {
        number: personNumber,
        expiry: personExpiry || null,
      });
      if (res.error) {
        setSaving(false);
        setError(res.error);
        return;
      }
    }

    const input = {
      group_id: groupId,
      title,
      issue_date: issueDate || null,
      // A LINKED document stores no expiry of its own — the person's is the
      // single source, and 0089's trigger refuses a second copy outright.
      expiry_date: idField || linkExpected ? null : (expiryDate || null),
      note: note || null,
      // LINKED documents deliberately store NO reference_no. The number is on
      // the person; writing a copy here is exactly the drift this model
      // exists to prevent, so the column is forced null rather than merely
      // left alone (which would strand a stale value if a document's type
      // were changed from unlinked to linked).
      // A linked document NEVER stores a number of its own. `linkExpected` is
      // belt-and-braces alongside idField: either one being true is enough to
      // keep reference_no empty.
      reference_no: idField || linkExpected ? null : (referenceNo || null),
      issuing_entity: issuingEntity || null,
      holder_name: holderName || null,
      type_key: effectiveTypeKey || null,
      // Exactly ONE of these is ever set, and only on create — the subject is
      // fixed at filing. updateArchiveDocument doesn't write subject columns
      // at all, so re-assigning a document to a different person isn't an
      // edit, it's a new document. (Editing one that way would also have to
      // clear the old column to stay inside 0087's guard — a second failure
      // mode not worth opening for a case nobody asked for.)
      driver_id: subject?.kind === "driver" ? subject.id : null,
      staff_id: subject?.kind === "staff" ? subject.id : null,
      truck_id: subject?.kind === "truck" ? subject.id : null,
    };

    if (isEdit) {
      const res = await updateArchiveDocument(editingDocument!.id, input);
      setSaving(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      onSaved();
      return;
    }

    // CREATE — row first, then the staged files against its new id.
    const res = await createArchiveDocument(input);
    if (res.error || !res.document) {
      setSaving(false);
      setError(res.error ?? "Could not create document.");
      return;
    }

    const failed: string[] = [];
    for (const sf of staged) {
      const fd = new FormData();
      fd.set("documentId", res.document.id);
      fd.set("file", sf.file);
      const up = await uploadArchiveDocumentFile(fd);
      if (up.error) failed.push(sf.file.name);
    }
    setSaving(false);

    // The document IS saved either way — report the upload failures by name
    // and keep the popup open so the user can retry, rather than closing and
    // silently losing the attachments they thought they'd added.
    if (failed.length > 0) {
      setError(
        `Document saved, but ${failed.length} file(s) failed to upload: ${failed.join(", ")}. Reopen the document to attach them.`,
      );
      return;
    }
    onSaved();
  }

  return (
    <ModalShell
      wide
      title={isEdit ? "Edit Document" : `Add Document — ${groupTitle}`}
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={submit} disabled={saving || uploading || !title.trim()}>
            {saving ? "Saving…" : "Save"}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">{error}</div>
      )}

      {/* IDENTITY — what this document is, who issued it, whose it is. */}
      <div className="text-[11px] font-semibold uppercase tracking-wide muted">Identity</div>
      {subject && (
        <div className="rounded-lg border px-3 py-2 text-sm flex items-center gap-2" style={INPUT_STYLE}>
          {subject.kind === "truck"
            ? <TruckIcon className="h-4 w-4 muted shrink-0" />
            : <User className="h-4 w-4 muted shrink-0" />}
          <span className="muted">
            {subject.kind === "driver" ? "Driver" : subject.kind === "staff" ? "Staff member" : "Truck"}:
          </span>
          <span className="font-medium">{subject.name}</span>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-1">
          <label className="text-xs muted block mb-1">Document title *</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} style={INPUT_STYLE} autoFocus />
        </div>

        <div>
          <label className="text-xs muted block mb-1">Type of document</label>
          {inheritedType ? (
            <>
              <div
                className="px-3 py-2 rounded-lg border text-sm opacity-60 cursor-not-allowed flex items-center gap-2 bg-black/[0.03] dark:bg-white/[0.03]"
                style={INPUT_STYLE}
                aria-disabled
              >
                {inheritedType.label_en}
                {idField && <LinkPill />}
              </div>
              <p className="text-[11px] muted mt-1">Set by the group — every document here is this type.</p>
            </>
          ) : addingType ? (
            <div className="flex gap-2">
              <input
                value={newTypeLabel}
                onChange={(e) => setNewTypeLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitNewType(); } }}
                placeholder="New type name"
                className={cn(INPUT, "flex-1")}
                style={INPUT_STYLE}
                autoFocus
              />
              <Btn variant="primary" onClick={submitNewType} disabled={savingType || !newTypeLabel.trim()}>
                {savingType ? "…" : "Add"}
              </Btn>
              <Btn variant="outline" onClick={() => { setAddingType(false); setNewTypeLabel(""); }}>Cancel</Btn>
            </div>
          ) : (
            <select
              value={typeKey}
              onChange={(e) => {
                if (e.target.value === "__add__") setAddingType(true);
                else setTypeKey(e.target.value);
              }}
              className={INPUT}
              style={INPUT_STYLE}
            >
              <option value="">—</option>
              {allTypes.map((t) => (
                <option key={t.key} value={t.key}>{t.label_en}</option>
              ))}
              <option value="__add__">+ Add new type…</option>
            </select>
          )}
        </div>

        <div>
          <label className="text-xs muted block mb-1">Issuing entity</label>
          <input
            value={issuingEntity}
            onChange={(e) => setIssuingEntity(e.target.value)}
            placeholder="e.g. Ministry of Transport"
            className={INPUT}
            style={INPUT_STYLE}
          />
        </div>

        <div>
          <label className="text-xs muted block mb-1">Holder name</label>
          <input
            value={holderName}
            onChange={(e) => setHolderName(e.target.value)}
            placeholder="Whose name it is in"
            className={INPUT}
            style={INPUT_STYLE}
          />
        </div>

        <div className="md:col-span-2">
          <label className="text-xs muted block mb-1">Note</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </div>
      </div>

      {/* REFERENCE + VALIDITY — the numbers and dates that drive expiry. */}
      <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">Reference &amp; validity</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          {idField ? (
            <>
              <label className="text-xs muted flex items-center gap-2 mb-1">
                {PERSON_ID_LABEL[idField]} — {subject?.name}
                <LinkPill />
              </label>
              {isEdit ? (
                <>
                  <input
                    value={personNumber}
                    onChange={(e) => setPersonNumber(e.target.value)}
                    className={INPUT}
                    style={INPUT_STYLE}
                  />
                  <p className="text-[11px] muted mt-1">
                    Saved on the subject&apos;s record. This is where it is edited.
                  </p>
                </>
              ) : (
                <>
                  <LockedValue value={personNumber} />
                  <p className="text-[11px] muted mt-1">
                    Already on the record — this document attaches to it.
                  </p>
                </>
              )}
            </>
          ) : (
            <>
              <label className="text-xs muted block mb-1">Reference / ID number</label>
              <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </>
          )}
        </div>
        <div>
          <label className="text-xs muted block mb-1">Issue date</label>
          <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </div>
        <div>
          {idField ? (
            <>
              <label className="text-xs muted flex items-center gap-2 mb-1">
                Expiry date<LinkPill />
              </label>
              {isEdit ? (
                <>
                  <input
                    type="date"
                    value={personExpiry}
                    onChange={(e) => setPersonExpiry(e.target.value)}
                    className={INPUT}
                    style={INPUT_STYLE}
                  />
                  <p className="text-[11px] muted mt-1">
                    The subject&apos;s expiry — this document&apos;s status reads it.
                  </p>
                </>
              ) : (
                <>
                  <LockedValue value={personExpiry ? new Date(personExpiry + "T00:00:00").toLocaleDateString() : ""} />
                  <p className="text-[11px] muted mt-1">
                    Renew to move it forward.
                  </p>
                </>
              )}
            </>
          ) : (
            <>
          <label className="text-xs muted block mb-1">Expiry date</label>
          <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </>
          )}
        </div>
      </div>

      {/* ATTACHMENTS */}
      <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">Attachments</div>
      {isEdit ? (
        <div className="space-y-2">
          {currentFiles.length > 0 && (
            <ul className="space-y-1">
              {currentFiles.map((f) => (
                <li key={f.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs" style={INPUT_STYLE}>
                  <FileText className="h-3.5 w-3.5 shrink-0 muted" />
                  <span className="truncate flex-1">{f.file_name}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveFile(f.id)}
                    disabled={busyFileId === f.id}
                    className="p-1 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
                    aria-label="Remove file"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label
            className="inline-flex items-center gap-1.5 text-xs rounded-lg border px-2.5 py-1.5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
            style={INPUT_STYLE}
          >
            <Upload className="h-3.5 w-3.5" />
            {uploading ? "Uploading…" : "Add files"}
            <input
              type="file"
              multiple
              accept={ACCEPT_FILE_TYPES}
              onChange={(e) => { onUploadNow(Array.from(e.target.files ?? [])); e.target.value = ""; }}
              className="hidden"
              disabled={uploading}
            />
          </label>
          <p className="text-[11px] muted">Images, PDF, Word, Excel and more. Max 10 MB each.</p>
        </div>
      ) : (
        <StagedFilePicker
          staged={staged}
          onAdd={(picked) => setStaged((prev) => [...prev, ...picked.map((f) => ({ id: newStagedId(), file: f }))])}
          onRemove={(id) => setStaged((prev) => prev.filter((sf) => sf.id !== id))}
          hint="Attached when you save. Images, PDF, Word, Excel and more. Max 10 MB each."
        />
      )}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Renew — captures the NEW version's values. The outgoing version is
// snapshotted to history server-side (see renewArchiveDocument's ordered
// steps); this form never edits history, only supplies what replaces it.
// ---------------------------------------------------------------------------
export function RenewModal({
  document: doc,
  linked,
  onClose,
  onSaved,
}: {
  document: ArchiveDocument;
  // Present when this document's group type links to a subject field
  // (0089/0091). RENEW IS THE WRITE PATH for a linked number and expiry —
  // Add only attaches to what already exists, so this is where a new Iqama,
  // licence or registration period actually lands on the subject's record.
  linked?: {
    field: PersonIdField;
    subjectId: string;
    subjectName: string;
    label: string;
    currentNumber: string | null;
    currentExpiry: string | null;
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  // Prefill from the current version — a renewal usually keeps the same
  // reference number and shifts the dates forward. For a LINKED document the
  // current values live on the SUBJECT, not on the document, so they are
  // seeded from there instead.
  const [referenceNo, setReferenceNo] = useState(linked ? (linked.currentNumber ?? "") : (doc.reference_no ?? ""));
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [note, setNote] = useState(doc.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Staged files = the NEW version's documents. They upload only AFTER the
  // renewal succeeds, so they land on the refreshed current version — the
  // outgoing files have already been stamped onto the superseded record by
  // then (renewArchiveDocument's step 2), so these can never be mistakenly
  // swept into history.
  const [staged, setStaged] = useState<StagedFile[]>([]);

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await renewArchiveDocument(doc.id, {
      reference_no: referenceNo || null,
      issue_date: issueDate || null,
      expiry_date: expiryDate || null,
      note: note || null,
      // For a linked document the new number/expiry go to the SUBJECT and
      // the parent is written null for both — 0092 refuses a linked document
      // that carries either. The action reads the OUTGOING pair server-side
      // for the history snapshot before overwriting them.
      linked: linked
        ? {
            field: linked.field,
            subjectId: linked.subjectId,
            number: referenceNo || null,
            expiry: expiryDate || null,
          }
        : undefined,
    });
    if (res.error) {
      setSaving(false);
      setError(res.error);
      return;
    }

    const failed: string[] = [];
    for (const sf of staged) {
      const fd = new FormData();
      fd.set("documentId", doc.id);
      fd.set("file", sf.file);
      const up = await uploadArchiveDocumentFile(fd);
      if (up.error) failed.push(sf.file.name);
    }
    setSaving(false);

    // The renewal itself succeeded — say so, name what failed, and stay open
    // rather than closing on a half-done state.
    if (failed.length > 0) {
      setError(
        `Renewed, but ${failed.length} file(s) failed to upload: ${failed.join(", ")}. Open the document to attach them.`,
      );
      return;
    }
    onSaved();
  }

  return (
    <ModalShell
      title={`Renew — ${doc.title}`}
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={submit} disabled={saving}>
            {saving ? "…" : "Renew"}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">{error}</div>
      )}

      <div className="rounded-lg px-3 py-2 text-xs bg-brand-500/10 text-brand-700 dark:text-brand-300">
        The current version is kept as history — its details and files stay retrievable.
        {linked && ` The outgoing ${linked.label.toLowerCase()} and expiry are recorded there too.`}
      </div>

      <div>
        <label className="text-xs muted flex items-center gap-2 mb-1">
          {linked ? `New ${linked.label.toLowerCase()} — ${linked.subjectName}` : "New reference / ID number"}
          {linked && <LinkPill />}
        </label>
        <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        {linked && (
          <p className="text-[11px] muted mt-1">
            Saved on the subject&apos;s record. The current value is kept in this document&apos;s history.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs muted block mb-1">New issue date</label>
          <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={INPUT} style={INPUT_STYLE} autoFocus />
        </div>
        <div>
          <label className="text-xs muted flex items-center gap-2 mb-1">
            New expiry date{linked && <LinkPill />}
          </label>
          <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
          {linked && (
            <p className="text-[11px] muted mt-1">
              Moves the subject&apos;s expiry forward — every status reading it follows.
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="text-xs muted block mb-1">Note</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} style={INPUT_STYLE} />
      </div>

      <div>
        <label className="text-xs muted block mb-1">New version files</label>
        <StagedFilePicker
          staged={staged}
          onAdd={(picked) => setStaged((prev) => [...prev, ...picked.map((f) => ({ id: newStagedId(), file: f }))])}
          onRemove={(id) => setStaged((prev) => prev.filter((sf) => sf.id !== id))}
          hint="Attached to the renewed document when you save. The current files move to history."
        />
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Full-details view — Turki's item 5: clicking a document ROW opens the whole
// record, attachments included, instead of forcing Edit just to read it.
//
// READ-ONLY by design. Edit and Renew are offered as hand-offs to the popups
// that already own those writes (this modal closes itself first, so the two
// are never stacked). Nothing here writes, so there is no second save path
// that could drift from DocumentModal's.
//
// Attachments are split CURRENT (renewal_id === null) vs. PREVIOUS VERSIONS
// (stamped with the renewal they belonged to) — the same distinction 0084's
// file model encodes, surfaced instead of flattened, so an old scan is never
// mistaken for the live one.
// ---------------------------------------------------------------------------
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] muted mb-0.5">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function FileChip({ file, onOpen }: { file: ArchiveDocumentFile; onOpen: (p: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(file.storage_path)}
      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/5 max-w-full"
      style={INPUT_STYLE}
      title={file.file_name}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 muted" />
      <span className="truncate">{file.file_name}</span>
    </button>
  );
}

export function DocumentDetailModal({
  document: doc,
  group,
  type,
  files,
  renewals,
  today,
  linkedId,
  onOpenFile,
  onClose,
  onEdit,
  onRenew,
}: {
  document: ArchiveDocument;
  group: ArchiveDocumentGroup;
  type: ArchiveDocumentType | null;
  // For a linked document (0088) the reference IS the person's own number,
  // so the row below reads it from them rather than showing an empty
  // reference_no that is empty BY DESIGN and would look like missing data.
  linkedId?: { label: string; value: string | null; expiry: string | null; personName: string } | null;
  files: ArchiveDocumentFile[];
  renewals: ArchiveDocumentRenewal[];
  today: string;
  onOpenFile: (path: string) => void;
  onClose: () => void;
  onEdit: () => void;
  onRenew: () => void;
}) {
  // A linked document has no expiry of its own — the person's is the single
  // source, so the pill here reads exactly what the matrix row reads.
  const status = docStatus(linkedId ? linkedId.expiry : doc.expiry_date, group.warning_days, today);
  const currentFiles = files.filter((f) => f.renewal_id === null);
  const filesByRenewal = new Map<string, ArchiveDocumentFile[]>();
  for (const f of files) {
    if (!f.renewal_id) continue;
    const arr = filesByRenewal.get(f.renewal_id) ?? [];
    arr.push(f);
    filesByRenewal.set(f.renewal_id, arr);
  }
  const dash = (v: string | null) => (v && v.trim() ? v : "—");
  const date = (iso: string | null) =>
    iso ? new Date(iso + "T00:00:00").toLocaleDateString() : "—";

  return (
    <ModalShell
      wide
      title={doc.title}
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>Close</Btn>
          <Btn variant="outline" onClick={onEdit}>Edit</Btn>
          <Btn variant="primary" onClick={onRenew}>Renew</Btn>
        </>
      }
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-xs">
          <span className={cn("h-2 w-2 rounded-full", groupDot(group.color))} />
          {group.title}
        </span>
        <span
          className={cn(
            "text-xs px-2 py-0.5 rounded-full ring-1 ring-inset",
            ARCHIVE_STATUS_PILL[status],
          )}
        >
          {archiveStatusLabel(status, linkedId ? linkedId.expiry : doc.expiry_date, today)}
        </span>
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">Identity</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <DetailRow label="Type of document" value={type ? type.label_en : "—"} />
        <DetailRow label="Issuing entity" value={dash(doc.issuing_entity)} />
        <DetailRow label="Holder name" value={dash(doc.holder_name)} />
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
        Reference &amp; validity
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {linkedId ? (
          <DetailRow
            label={`${linkedId.label} (${linkedId.personName})`}
            value={
              <>
                {dash(linkedId.value)}
                <span className="block text-[11px] muted">Held on the person</span>
              </>
            }
          />
        ) : (
          <DetailRow label="Reference no." value={dash(doc.reference_no)} />
        )}
        <DetailRow label="Issue date" value={date(doc.issue_date)} />
        <DetailRow
          label="Expiry date"
          value={
            linkedId ? (
              <>
                {date(linkedId.expiry)}
                <span className="block text-[11px] muted">Held on the person</span>
              </>
            ) : (
              date(doc.expiry_date)
            )
          }
        />
      </div>

      {doc.note && doc.note.trim() && (
        <>
          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">Note</div>
          <p className="text-sm whitespace-pre-wrap">{doc.note}</p>
        </>
      )}

      <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
        Attachments ({currentFiles.length})
      </div>
      {currentFiles.length === 0 ? (
        <p className="text-sm muted">No files attached to the current version.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {currentFiles.map((f) => (
            <FileChip key={f.id} file={f} onOpen={onOpenFile} />
          ))}
        </div>
      )}

      {renewals.length > 0 && (
        <>
          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
            Previous versions ({renewals.length})
          </div>
          <div className="space-y-2">
            {renewals.map((r) => {
              const rf = filesByRenewal.get(r.id) ?? [];
              return (
                <div key={r.id} className="rounded-lg border p-2.5 space-y-2" style={INPUT_STYLE}>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <DetailRow label="Reference no." value={dash(r.reference_no)} />
                    <DetailRow label="Issue date" value={date(r.issue_date)} />
                    <DetailRow label="Expiry date" value={date(r.expiry_date)} />
                    <DetailRow
                      label="Replaced on"
                      value={new Date(r.superseded_at).toLocaleDateString()}
                    />
                  </div>
                  {r.note && r.note.trim() && (
                    <p className="text-xs muted whitespace-pre-wrap">{r.note}</p>
                  )}
                  {rf.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {rf.map((f) => (
                        <FileChip key={f.id} file={f} onOpen={onOpenFile} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </ModalShell>
  );
}
