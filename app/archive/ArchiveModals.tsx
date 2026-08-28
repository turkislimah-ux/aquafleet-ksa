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
import { X, Plus, Trash2, FileText, Upload, User, Truck as TruckIcon, ChevronDown, Lock, Link as LinkIcon } from "lucide-react";
import { Btn } from "@/components/ui";
import { useApp } from "@/components/AppShell";
import { t, fill, plural, arText } from "@/lib/i18n";
import { cn, formatDate } from "@/lib/utils";
import {
  ARCHIVE_GROUP_COLORS, ARCHIVE_STATUS_PILL, archiveStatusLabel, docStatus, groupDot,
  linkedFieldFor, groupExpectsLink, isStandingType, personIdLabel, personIdLabelLower,
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
  deleteArchiveDocumentType,
  setPersonLinkedId,
} from "./actions";
import ScrollLock from "@/components/ScrollLock";

// The purple "Link" pill. Purple because every other status colour in the
// archive is already spoken for by expiry (red/amber/green/slate) — a link is
// a different kind of fact, so it gets a colour that can never be misread as
// an expiry state.
export function LinkPill() {
  const { lang } = useApp();
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/25">
      <LinkIcon className="h-3 w-3" />
      {t("archive.linkPill", lang)}
    </span>
  );
}

// A pulled, read-only value. Used wherever a linked number/expiry is SHOWN
// rather than entered — Add attaches a document to a fact that already
// exists, so a fresh-looking input there would invite typing a second copy of
// it, which 0092 now refuses at the database anyway.
function LockedValue({ value }: { value: string }) {
  const { lang } = useApp();
  return (
    <div
      className="px-3 py-2 rounded-lg border text-sm opacity-60 cursor-not-allowed flex items-center gap-2 bg-black/[0.03] dark:bg-white/[0.03]"
      style={INPUT_STYLE}
      aria-disabled
    >
      <Lock className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{value || t("archive.notSet", lang)}</span>
    </div>
  );
}

// Type dropdown with the Link pill on the RIGHT of each type name. Native
// <option> can't hold markup, so this is a real listbox.
function TypePicker({
  types,
  value,
  subjectKind,
  usageByKey,
  onChange,
  onAdded,
  onDeleted,
}: {
  types: ArchiveDocumentType[];
  value: string;
  subjectKind: LinkSubjectKind | null;
  // How many groups + documents reference each type. Delete is offered only
  // at zero — the FK (ON DELETE RESTRICT on both referencing columns) is the
  // real guarantee, this just avoids showing an action that would fail.
  usageByKey: Map<string, number>;
  onChange: (key: string) => void;
  // Named `ty`, not `t`: `t` is the translator throughout this file, and a
  // parameter that shadows it turns every lookup inside the closure into a
  // type error at best and the wrong call at worst.
  onAdded: (ty: ArchiveDocumentType) => void;
  onDeleted: (key: string) => void;
}) {
  const { lang } = useApp();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const selected = types.find((ty) => ty.key === value) ?? null;

  async function submitNew() {
    const label = newLabel.trim();
    if (!label) return;
    setBusy(true);
    setErr(null);
    const res = await addArchiveDocumentType(label);
    setBusy(false);
    if (res.error || !res.type) {
      setErr(res.error ?? t("archive.errAddType", lang));
      return;
    }
    onAdded(res.type);
    onChange(res.type.key);
    setNewLabel("");
    setAdding(false);
    setOpen(false);
  }

  async function remove(key: string, label: string) {
    if (!confirm(fill(t("archive.confirmDeleteType", lang), { label }))) return;
    setBusy(true);
    setErr(null);
    const res = await deleteArchiveDocumentType(key);
    setBusy(false);
    if (res.error) {
      setErr(res.error);
      return;
    }
    if (value === key) onChange("");
    onDeleted(key);
  }

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
            {selected
              ? arText(selected.label_en, selected.label_ar, lang)
              : t("archive.typePicker.choose", lang)}
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
            {types.map((ty) => {
              // Delete is offered ONLY for a user-added type with nothing
              // referencing it. Built-ins are excluded outright: 'iqama',
              // 'license' and 'registration' are the keys the linked mapping
              // is defined against, so deleting one would break linking, and
              // the rest are the base vocabulary.
              const deletable = !isStandingType(ty.key) && (usageByKey.get(ty.key) ?? 0) === 0;
              // Pattern B: the type vocabulary is bilingual in the DB, so the
              // label comes from the ROW, never from the dictionary.
              const label = arText(ty.label_en, ty.label_ar, lang);
              return (
                <li key={ty.key} className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => { onChange(ty.key); setOpen(false); }}
                    className={cn(
                      "flex-1 min-w-0 flex items-center justify-between gap-2 px-3 py-2 text-sm text-start hover:bg-black/5 dark:hover:bg-white/5",
                      ty.key === value && "bg-brand-500/10",
                    )}
                  >
                    <span className="truncate">{label}</span>
                    {/* RIGHT of the type text, per Turki. Shown when the type
                        links for THIS group's population — an iqama type shows
                        it for both, a license type only for drivers. */}
                    {linkedFieldFor(ty, subjectKind) && <LinkPill />}
                  </button>
                  {deletable && (
                    <button
                      type="button"
                      onClick={() => remove(ty.key, label)}
                      disabled={busy}
                      className="px-2 grid place-items-center text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40"
                      title={fill(t("archive.typePicker.deleteTip", lang), { label })}
                      aria-label={fill(t("archive.typePicker.deleteAria", lang), { label })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}

            {/* Inline add — the same mechanism the Add-Document form uses, so
                a type can be created from wherever it is first needed rather
                than only from the other screen. */}
            <li className="border-t mt-1 pt-1" style={{ borderColor: "rgb(var(--border))" }}>
              {adding ? (
                <div className="p-2 flex gap-2">
                  <input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); submitNew(); }
                      if (e.key === "Escape") { setAdding(false); setNewLabel(""); }
                    }}
                    placeholder={t("archive.phNewType", lang)}
                    className={cn(INPUT, "flex-1")}
                    style={INPUT_STYLE}
                    autoFocus
                  />
                  <Btn variant="primary" onClick={submitNew} disabled={busy || !newLabel.trim()}>
                    {busy ? "…" : t("common.add", lang)}
                  </Btn>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-start text-brand-600 dark:text-brand-300 hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("archive.typePicker.addNew", lang)}
                </button>
              )}
            </li>

            {err && (
              <li className="px-3 py-2 text-[11px] text-rose-600 dark:text-rose-400">{err}</li>
            )}
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
  const { lang } = useApp();
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
              <span className="muted shrink-0">
                {fill(t("archive.fileSizeKb", lang), { n: (sf.file.size / 1024).toFixed(0) })}
              </span>
              <button
                type="button"
                onClick={() => onRemove(sf.id)}
                className="p-1 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                aria-label={t("archive.removeFile", lang)}
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
        {t("archive.attachFiles", lang)}
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
      <ScrollLock />
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
  typeUsage,
  editingGroup,
  onClose,
  onSaved,
}: {
  tab: ArchiveTab;
  // Offered as the group's type on staff/truck tabs. Carries the linked_*
  // columns, so the purple Link pill is read straight off the data.
  types: ArchiveDocumentType[];
  // Reference counts per type key, so the picker only offers delete on a
  // type nothing points at.
  typeUsage: Map<string, number>;
  // Which population a NEW group is for. The caller passes the sub-tab the
  // user is standing in, so the picker below opens on the right answer
  // instead of making them restate it.
  defaultSubjectKind?: ArchiveSubjectKind;
  editingGroup?: ArchiveDocumentGroup | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { lang } = useApp();
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
  // Locally created / deleted types, merged in-flight so the picker reflects
  // the change immediately instead of waiting for the page to refetch — same
  // pattern the Add-Document form's inline add already uses.
  const [localTypes, setLocalTypes] = useState<ArchiveDocumentType[]>([]);
  const [deletedTypeKeys, setDeletedTypeKeys] = useState<string[]>([]);
  const allGroupTypes = (() => {
    const seen = new Set(types.map((ty) => ty.key));
    return [...types, ...localTypes.filter((ty) => !seen.has(ty.key))].filter(
      (ty) => !deletedTypeKeys.includes(ty.key),
    );
  })();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedLinkField = linkedFieldFor(
    allGroupTypes.find((ty) => ty.key === groupTypeKey),
    subjectKind === "driver" ? "driver"
    : subjectKind === "staff" ? "staff"
    : subjectKind === "truck" ? "truck"
    : null,
  );

  async function submit() {
    if (!title.trim()) {
      setError(t("archive.groupModal.errTitle", lang));
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
      title={isEdit ? t("archive.groupModal.titleEdit", lang) : t("archive.createGroup", lang)}
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>{t("common.cancel", lang)}</Btn>
          <Btn variant="primary" onClick={submit} disabled={saving || !title.trim()}>
            {saving ? "…" : t("common.save", lang)}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">{error}</div>
      )}

      <div>
        <label className="text-xs muted block mb-1">{t("archive.groupModal.fTitle", lang)}</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} style={INPUT_STYLE} autoFocus />
      </div>

      {/* WHO the group is for — staff tab only, because it is the only tab
          with two populations. Required by the DB: 0086's CHECK refuses a
          staff group left at the default 'none'. LOCKED once the group
          exists: flipping it would put every document already filed in the
          group in violation of 0087's guard at once. */}
      {tab === "staff" && (
        <div>
          <label className="text-xs muted block mb-1">{t("archive.groupModal.fFor", lang)}</label>
          {isEdit ? (
            <div className="px-3 py-2 rounded-lg border text-sm opacity-60" style={INPUT_STYLE}>
              {/* Keyed off the subject_kind VALUE, never off the rendered
                  label — the label moves with `lang`, the value is what the
                  DB constrains and what setSubjectKind writes. */}
              {subjectKind === "driver"
                ? t("archive.subjectKind.driver", lang)
                : t("archive.subjectKind.staff", lang)}
            </div>
          ) : (
            <div className="flex gap-2">
              {(["driver", "staff"] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setSubjectKind(o)}
                  className={cn(
                    "flex-1 px-3 py-2 rounded-lg border text-sm transition",
                    subjectKind === o
                      ? "border-brand-600 bg-brand-500/10 text-brand-700 dark:text-brand-300 font-medium"
                      : "hover:bg-black/5 dark:hover:bg-white/5",
                  )}
                  style={subjectKind === o ? undefined : INPUT_STYLE}
                >
                  {t(`archive.subjectKind.${o}`, lang)}
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] muted mt-1">
            {isEdit
              ? t("archive.groupModal.locked", lang)
              : t("archive.groupModal.hintFor", lang)}
          </p>
        </div>
      )}

      {(tab === "staff" || tab === "truck") && (
        <div>
          <label className="text-xs muted block mb-1">{t("archive.groupModal.fType", lang)}</label>
          {isEdit ? (
            <div className="px-3 py-2 rounded-lg border text-sm opacity-60 flex items-center gap-2" style={INPUT_STYLE}>
              {(() => {
                const ty = allGroupTypes.find((x) => x.key === groupTypeKey);
                return ty ? arText(ty.label_en, ty.label_ar, lang) : "—";
              })()}
              {linkedFieldFor(
                allGroupTypes.find((ty) => ty.key === groupTypeKey),
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
                types={allGroupTypes.filter((ty) => ty.active || ty.key === groupTypeKey)}
                usageByKey={typeUsage}
                onAdded={(ty) => setLocalTypes((prev) => [...prev, ty])}
                onDeleted={(key) => setDeletedTypeKeys((prev) => [...prev, key])}
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
                  {fill(t("archive.groupModal.linkNote", lang), {
                    field: personIdLabelLower(selectedLinkField, lang),
                  })}
                </p>
              )}
            </>
          )}
          <p className="text-[11px] muted mt-1">
            {isEdit
              ? t("archive.groupModal.locked", lang)
              : t("archive.groupModal.hintType", lang)}
          </p>
        </div>
      )}

      <div>
        <label className="text-xs muted block mb-1">{t("archive.groupModal.fDescription", lang)}</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("archive.groupModal.phDescription", lang)}
          className={INPUT}
          style={INPUT_STYLE}
        />
      </div>

      <div>
        <label className="text-xs muted block mb-1">{t("archive.groupModal.fColor", lang)}</label>
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
              title={t(`archive.color.${c.key}`, lang)}
            >
              <span className={cn("h-4 w-4 rounded-full", c.dot)} />
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs muted block mb-1">{t("archive.groupModal.fWarnDays", lang)}</label>
        <input
          type="number"
          min={1}
          value={warningDays}
          onChange={(e) => setWarningDays(Number(e.target.value) || 0)}
          className={INPUT}
          style={INPUT_STYLE}
        />
        <p className="text-[11px] muted mt-1">
          {t("archive.groupModal.hintWarnDays", lang)}
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
  const { lang } = useApp();
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
    const seen = new Set(types.map((ty) => ty.key));
    const merged = [...types, ...localTypes.filter((ty) => !seen.has(ty.key))];
    return merged.filter((ty) => ty.active || ty.key === editingDocument?.type_key);
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
      setError(res.error ?? t("archive.errAddType", lang));
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
      setError(t("archive.docModal.errTitle", lang));
      return;
    }
    // FAIL LOUDLY rather than write the number to the wrong place.
    if (linkExpected && !idField) {
      setError(t("archive.docModal.errLinkUnresolved", lang));
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
      setError(res.error ?? t("archive.docModal.errCreate", lang));
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
        fill(t(`archive.docModal.errUploadPartial.${plural(failed.length)}`, lang), {
          n: failed.length,
          names: failed.join(", "),
        }),
      );
      return;
    }
    onSaved();
  }

  return (
    <ModalShell
      wide
      title={
        isEdit
          ? t("archive.docModal.titleEdit", lang)
          : fill(t("archive.docModal.titleAdd", lang), { group: groupTitle })
      }
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>{t("common.cancel", lang)}</Btn>
          <Btn variant="primary" onClick={submit} disabled={saving || uploading || !title.trim()}>
            {saving ? t("common.saving", lang) : t("common.save", lang)}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">{error}</div>
      )}

      {/* IDENTITY — what this document is, who issued it, whose it is. */}
      <div className="text-[11px] font-semibold uppercase tracking-wide muted">{t("archive.section.identity", lang)}</div>
      {subject && (
        <div className="rounded-lg border px-3 py-2 text-sm flex items-center gap-2" style={INPUT_STYLE}>
          {subject.kind === "truck"
            ? <TruckIcon className="h-4 w-4 muted shrink-0" />
            : <User className="h-4 w-4 muted shrink-0" />}
          <span className="muted">
            {/* Keyed off subject.kind — the VALUE the caller resolved from the
                group's subject_kind — not off the phrase it prints. */}
            {t(`archive.subjectLabel.${subject.kind}`, lang)}:
          </span>
          <span className="font-medium">{subject.name}</span>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-1">
          <label className="text-xs muted block mb-1">{t("archive.docModal.fTitle", lang)}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} style={INPUT_STYLE} autoFocus />
        </div>

        <div>
          <label className="text-xs muted block mb-1">{t("archive.fTypeOfDocument", lang)}</label>
          {inheritedType ? (
            <>
              <div
                className="px-3 py-2 rounded-lg border text-sm opacity-60 cursor-not-allowed flex items-center gap-2 bg-black/[0.03] dark:bg-white/[0.03]"
                style={INPUT_STYLE}
                aria-disabled
              >
                {arText(inheritedType.label_en, inheritedType.label_ar, lang)}
                {idField && <LinkPill />}
              </div>
              <p className="text-[11px] muted mt-1">{t("archive.docModal.typeInherited", lang)}</p>
            </>
          ) : addingType ? (
            <div className="flex gap-2">
              <input
                value={newTypeLabel}
                onChange={(e) => setNewTypeLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitNewType(); } }}
                placeholder={t("archive.phNewType", lang)}
                className={cn(INPUT, "flex-1")}
                style={INPUT_STYLE}
                autoFocus
              />
              <Btn variant="primary" onClick={submitNewType} disabled={savingType || !newTypeLabel.trim()}>
                {savingType ? "…" : t("common.add", lang)}
              </Btn>
              <Btn variant="outline" onClick={() => { setAddingType(false); setNewTypeLabel(""); }}>{t("common.cancel", lang)}</Btn>
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
              {allTypes.map((ty) => (
                <option key={ty.key} value={ty.key}>{arText(ty.label_en, ty.label_ar, lang)}</option>
              ))}
              <option value="__add__">{t("archive.docModal.addNewTypeOption", lang)}</option>
            </select>
          )}
        </div>

        <div>
          <label className="text-xs muted block mb-1">{t("archive.fIssuingEntity", lang)}</label>
          <input
            value={issuingEntity}
            onChange={(e) => setIssuingEntity(e.target.value)}
            placeholder={t("archive.docModal.phIssuingEntity", lang)}
            className={INPUT}
            style={INPUT_STYLE}
          />
        </div>

        <div>
          <label className="text-xs muted block mb-1">{t("archive.fHolderName", lang)}</label>
          <input
            value={holderName}
            onChange={(e) => setHolderName(e.target.value)}
            placeholder={t("archive.docModal.phHolderName", lang)}
            className={INPUT}
            style={INPUT_STYLE}
          />
        </div>

        <div className="md:col-span-2">
          <label className="text-xs muted block mb-1">{t("common.note", lang)}</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </div>
      </div>

      {/* REFERENCE + VALIDITY — the numbers and dates that drive expiry. */}
      <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">{t("archive.section.refValidity", lang)}</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          {idField ? (
            <>
              <label className="text-xs muted flex items-center gap-2 mb-1">
                {fill(t("archive.docModal.fLinked", lang), {
                  field: personIdLabel(idField, lang),
                  // `?? ""` because JSX printed nothing for an absent name;
                  // fill() would print the string "undefined".
                  name: subject?.name ?? "",
                })}
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
                    {t("archive.docModal.linkedNumEditHint", lang)}
                  </p>
                </>
              ) : (
                <>
                  <LockedValue value={personNumber} />
                  <p className="text-[11px] muted mt-1">
                    {t("archive.docModal.linkedNumLockedHint", lang)}
                  </p>
                </>
              )}
            </>
          ) : (
            <>
              <label className="text-xs muted block mb-1">{t("archive.docModal.fReference", lang)}</label>
              <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </>
          )}
        </div>
        <div>
          <label className="text-xs muted block mb-1">{t("archive.fIssueDate", lang)}</label>
          <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </div>
        <div>
          {idField ? (
            <>
              <label className="text-xs muted flex items-center gap-2 mb-1">
                {t("archive.fExpiryDate", lang)}<LinkPill />
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
                    {t("archive.docModal.linkedExpEditHint", lang)}
                  </p>
                </>
              ) : (
                <>
                  <LockedValue value={personExpiry ? formatDate(personExpiry + "T00:00:00") : ""} />
                  <p className="text-[11px] muted mt-1">
                    {t("archive.docModal.linkedExpLockedHint", lang)}
                  </p>
                </>
              )}
            </>
          ) : (
            <>
          <label className="text-xs muted block mb-1">{t("archive.fExpiryDate", lang)}</label>
          <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
            </>
          )}
        </div>
      </div>

      {/* ATTACHMENTS */}
      <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">{t("archive.section.attachments", lang)}</div>
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
                    aria-label={t("archive.removeFile", lang)}
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
            {uploading ? t("archive.uploading", lang) : t("archive.addFiles", lang)}
            <input
              type="file"
              multiple
              accept={ACCEPT_FILE_TYPES}
              onChange={(e) => { onUploadNow(Array.from(e.target.files ?? [])); e.target.value = ""; }}
              className="hidden"
              disabled={uploading}
            />
          </label>
          <p className="text-[11px] muted">{t("archive.fileHint", lang)}</p>
        </div>
      ) : (
        <StagedFilePicker
          staged={staged}
          onAdd={(picked) => setStaged((prev) => [...prev, ...picked.map((f) => ({ id: newStagedId(), file: f }))])}
          onRemove={(id) => setStaged((prev) => prev.filter((sf) => sf.id !== id))}
          hint={t("archive.fileHintStaged", lang)}
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
  // `field` alone — no pre-rendered `label`. The caller used to pass both, and
  // the label was then case-folded here for mid-sentence use; that made the
  // caller responsible for a string whose language this component decides, and
  // .toLowerCase() on a translated label is a no-op in Arabic. The label is now
  // derived from the field at render time, in the two shapes it is needed in.
  linked?: {
    field: PersonIdField;
    subjectId: string;
    subjectName: string;
    currentNumber: string | null;
    currentExpiry: string | null;
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { lang } = useApp();
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
        fill(t(`archive.renewModal.errUploadPartial.${plural(failed.length)}`, lang), {
          n: failed.length,
          names: failed.join(", "),
        }),
      );
      return;
    }
    onSaved();
  }

  return (
    <ModalShell
      title={fill(t("archive.renewModal.title", lang), { title: doc.title })}
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>{t("common.cancel", lang)}</Btn>
          <Btn variant="primary" onClick={submit} disabled={saving}>
            {saving ? "…" : t("archive.renew", lang)}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">{error}</div>
      )}

      <div className="rounded-lg px-3 py-2 text-xs bg-brand-500/10 text-brand-700 dark:text-brand-300">
        {t("archive.renewModal.historyNote", lang)}
        {/* The separating space stays in the CODE, not in the dictionary
            value — a leading space inside a translated string is invisible to
            a translator and gets trimmed by the first person who tidies it. */}
        {linked &&
          ` ${fill(t("archive.renewModal.historyNoteLinked", lang), {
            field: personIdLabelLower(linked.field, lang),
          })}`}
      </div>

      <div>
        <label className="text-xs muted flex items-center gap-2 mb-1">
          {linked
            ? fill(t("archive.renewModal.fNewLinked", lang), {
                field: personIdLabelLower(linked.field, lang),
                name: linked.subjectName,
              })
            : t("archive.renewModal.fNewReference", lang)}
          {linked && <LinkPill />}
        </label>
        <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        {linked && (
          <p className="text-[11px] muted mt-1">
            {t("archive.renewModal.linkedNumHint", lang)}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs muted block mb-1">{t("archive.renewModal.fNewIssue", lang)}</label>
          <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={INPUT} style={INPUT_STYLE} autoFocus />
        </div>
        <div>
          <label className="text-xs muted flex items-center gap-2 mb-1">
            {t("archive.renewModal.fNewExpiry", lang)}{linked && <LinkPill />}
          </label>
          <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
          {linked && (
            <p className="text-[11px] muted mt-1">
              {t("archive.renewModal.linkedExpHint", lang)}
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="text-xs muted block mb-1">{t("common.note", lang)}</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} style={INPUT_STYLE} />
      </div>

      <div>
        <label className="text-xs muted block mb-1">{t("archive.renewModal.fNewFiles", lang)}</label>
        <StagedFilePicker
          staged={staged}
          onAdd={(picked) => setStaged((prev) => [...prev, ...picked.map((f) => ({ id: newStagedId(), file: f }))])}
          onRemove={(id) => setStaged((prev) => prev.filter((sf) => sf.id !== id))}
          hint={t("archive.renewModal.fileHint", lang)}
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
  // `field`, not a rendered label — same reason as RenewModal's `linked`.
  linkedId?: { field: PersonIdField; value: string | null; expiry: string | null; personName: string } | null;
  files: ArchiveDocumentFile[];
  renewals: ArchiveDocumentRenewal[];
  today: string;
  onOpenFile: (path: string) => void;
  onClose: () => void;
  onEdit: () => void;
  onRenew: () => void;
}) {
  const { lang } = useApp();
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
    iso ? formatDate(iso + "T00:00:00") : "—";

  return (
    <ModalShell
      wide
      title={doc.title}
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>{t("archive.close", lang)}</Btn>
          <Btn variant="outline" onClick={onEdit}>{t("common.edit", lang)}</Btn>
          <Btn variant="primary" onClick={onRenew}>{t("archive.renew", lang)}</Btn>
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
          {archiveStatusLabel(status, linkedId ? linkedId.expiry : doc.expiry_date, today, lang)}
        </span>
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">{t("archive.section.identity", lang)}</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <DetailRow
          label={t("archive.fTypeOfDocument", lang)}
          value={type ? arText(type.label_en, type.label_ar, lang) : "—"}
        />
        <DetailRow label={t("archive.fIssuingEntity", lang)} value={dash(doc.issuing_entity)} />
        <DetailRow label={t("archive.fHolderName", lang)} value={dash(doc.holder_name)} />
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
        {t("archive.section.refValidity", lang)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {linkedId ? (
          <DetailRow
            label={fill(t("archive.detail.linkedLabel", lang), {
              field: personIdLabel(linkedId.field, lang),
              name: linkedId.personName,
            })}
            value={
              <>
                {dash(linkedId.value)}
                <span className="block text-[11px] muted">{t("archive.detail.heldOnPerson", lang)}</span>
              </>
            }
          />
        ) : (
          <DetailRow label={t("archive.detail.fReferenceNo", lang)} value={dash(doc.reference_no)} />
        )}
        <DetailRow label={t("archive.fIssueDate", lang)} value={date(doc.issue_date)} />
        <DetailRow
          label={t("archive.fExpiryDate", lang)}
          value={
            linkedId ? (
              <>
                {date(linkedId.expiry)}
                <span className="block text-[11px] muted">{t("archive.detail.heldOnPerson", lang)}</span>
              </>
            ) : (
              date(doc.expiry_date)
            )
          }
        />
      </div>

      {doc.note && doc.note.trim() && (
        <>
          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">{t("common.note", lang)}</div>
          <p className="text-sm whitespace-pre-wrap">{doc.note}</p>
        </>
      )}

      <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
        {fill(t(`archive.detail.attachmentsCount.${plural(currentFiles.length)}`, lang), {
          n: currentFiles.length,
        })}
      </div>
      {currentFiles.length === 0 ? (
        <p className="text-sm muted">{t("archive.detail.noFiles", lang)}</p>
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
            {fill(t(`archive.detail.previousVersionsCount.${plural(renewals.length)}`, lang), {
              n: renewals.length,
            })}
          </div>
          <div className="space-y-2">
            {renewals.map((r) => {
              const rf = filesByRenewal.get(r.id) ?? [];
              return (
                <div key={r.id} className="rounded-lg border p-2.5 space-y-2" style={INPUT_STYLE}>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <DetailRow label={t("archive.detail.fReferenceNo", lang)} value={dash(r.reference_no)} />
                    <DetailRow label={t("archive.fIssueDate", lang)} value={date(r.issue_date)} />
                    <DetailRow label={t("archive.fExpiryDate", lang)} value={date(r.expiry_date)} />
                    <DetailRow
                      label={t("archive.detail.fReplacedOn", lang)}
                      value={formatDate(r.superseded_at)}
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
