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

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Trash2, FileText, Upload } from "lucide-react";
import { Btn } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ARCHIVE_GROUP_COLORS } from "@/lib/archive";
import type {
  ArchiveTab,
  ArchiveDocumentGroup,
  ArchiveDocument,
  ArchiveDocumentFile,
} from "@/lib/db-types";
import {
  createArchiveGroup,
  updateArchiveGroup,
  createArchiveDocument,
  updateArchiveDocument,
  renewArchiveDocument,
  uploadArchiveDocumentFile,
  removeArchiveDocumentFile,
} from "./actions";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full bg-transparent";
const INPUT_STYLE = { borderColor: "rgb(var(--border))" } as const;

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
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <ModalOverlay onClick={onClose}>
      <div
        className="card w-full max-w-[560px] max-h-[90vh] overflow-y-auto scrollbar-thin p-0"
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
  editingGroup,
  onClose,
  onSaved,
}: {
  tab: ArchiveTab;
  editingGroup?: ArchiveDocumentGroup | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editingGroup;
  const [title, setTitle] = useState(editingGroup?.title ?? "");
  const [description, setDescription] = useState(editingGroup?.description ?? "");
  const [color, setColor] = useState(editingGroup?.color ?? "brand");
  const [warningDays, setWarningDays] = useState(editingGroup?.warning_days ?? 30);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) {
      setError("Group title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const input = { tab, title, description: description || null, color, warning_days: warningDays };
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
// Add / edit document — the UNIVERSAL input set (reference no, issue date,
// expiry date, note) plus multi-file upload. Deliberately generic so ONE form
// fits any regulatory document.
//
// Files upload IMMEDIATELY on pick (once the document exists), matching how
// the workshop-payment / part-photo flows already behave — the alternative
// (stage locally, upload at submit) means a failed submit silently drops
// files the user believes are attached.
// ---------------------------------------------------------------------------
export function DocumentModal({
  groupId,
  groupTitle,
  editingDocument,
  existingFiles,
  onClose,
  onSaved,
}: {
  groupId: string;
  groupTitle: string;
  editingDocument?: ArchiveDocument | null;
  existingFiles?: ArchiveDocumentFile[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editingDocument;
  const [title, setTitle] = useState(editingDocument?.title ?? "");
  const [referenceNo, setReferenceNo] = useState(editingDocument?.reference_no ?? "");
  const [issueDate, setIssueDate] = useState(editingDocument?.issue_date ?? "");
  const [expiryDate, setExpiryDate] = useState(editingDocument?.expiry_date ?? "");
  const [note, setNote] = useState(editingDocument?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Files attached to the CURRENT version only (renewal_id null) — superseded
  // versions' files belong to their renewal and are shown in the history view.
  const currentFiles = (existingFiles ?? []).filter((f) => f.renewal_id === null);
  const [uploading, setUploading] = useState(false);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0 || !editingDocument) return;
    setUploading(true);
    setError(null);
    for (const file of picked) {
      const fd = new FormData();
      fd.set("documentId", editingDocument.id);
      fd.set("file", file);
      const res = await uploadArchiveDocumentFile(fd);
      if (res.error) {
        setError(res.error);
        break;
      }
    }
    setUploading(false);
    e.target.value = "";
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
    setSaving(true);
    setError(null);
    const input = {
      group_id: groupId,
      title,
      reference_no: referenceNo || null,
      issue_date: issueDate || null,
      expiry_date: expiryDate || null,
      note: note || null,
    };
    const res = isEdit
      ? await updateArchiveDocument(editingDocument!.id, input)
      : await createArchiveDocument(input);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  return (
    <ModalShell
      title={isEdit ? "Edit Document" : `Add Document — ${groupTitle}`}
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
        <label className="text-xs muted block mb-1">Document title *</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={INPUT} style={INPUT_STYLE} autoFocus />
      </div>

      <div>
        <label className="text-xs muted block mb-1">Reference / ID number</label>
        <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={INPUT} style={INPUT_STYLE} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs muted block mb-1">Issue date</label>
          <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </div>
        <div>
          <label className="text-xs muted block mb-1">Expiry date</label>
          <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </div>
      </div>

      <div>
        <label className="text-xs muted block mb-1">Note</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} style={INPUT_STYLE} />
      </div>

      {/* Files: only available once the document row exists — a file needs a
          document_id to attach to. On create, the user saves first, then
          reopens to attach; the hint below says so rather than showing a
          dead control. */}
      <div>
        <label className="text-xs muted block mb-1">Files</label>
        {!isEdit ? (
          <p className="text-[11px] muted">Save the document first, then reopen it to attach files.</p>
        ) : (
          <div className="space-y-2">
            {currentFiles.length > 0 && (
              <ul className="space-y-1">
                {currentFiles.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
                    style={{ borderColor: "rgb(var(--border))" }}
                  >
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
            <label className="inline-flex items-center gap-1.5 text-xs rounded-lg border px-2.5 py-1.5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5" style={{ borderColor: "rgb(var(--border))" }}>
              <Upload className="h-3.5 w-3.5" />
              {uploading ? "Uploading…" : "Add files"}
              <input type="file" multiple accept="image/*,application/pdf" onChange={onPickFile} className="hidden" disabled={uploading} />
            </label>
            <p className="text-[11px] muted">Multiple files allowed — front/back scans, receipts. Max 10 MB each.</p>
          </div>
        )}
      </div>
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
  onClose,
  onSaved,
}: {
  document: ArchiveDocument;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Prefill from the current version — a renewal usually keeps the same
  // reference number and shifts the dates forward.
  const [referenceNo, setReferenceNo] = useState(doc.reference_no ?? "");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [note, setNote] = useState(doc.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const res = await renewArchiveDocument(doc.id, {
      reference_no: referenceNo || null,
      issue_date: issueDate || null,
      expiry_date: expiryDate || null,
      note: note || null,
    });
    setSaving(false);
    if (res.error) {
      setError(res.error);
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
      </div>

      <div>
        <label className="text-xs muted block mb-1">New reference / ID number</label>
        <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className={INPUT} style={INPUT_STYLE} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs muted block mb-1">New issue date</label>
          <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={INPUT} style={INPUT_STYLE} autoFocus />
        </div>
        <div>
          <label className="text-xs muted block mb-1">New expiry date</label>
          <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </div>
      </div>

      <div>
        <label className="text-xs muted block mb-1">Note</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} style={INPUT_STYLE} />
      </div>
    </ModalShell>
  );
}
