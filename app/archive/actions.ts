"use server";

// Archive — server actions (migration 0084).
//
// NO RPC anywhere in this file, deliberately: every mutation here is plain
// single-table CRUD with no cross-table invariant to protect — no counter/
// gap-free number, no stock, no money. Same "plain write, no RPC" precedent
// as updateRepairer/deleteRepairer (osActions.ts), the part-photo path
// (maintenance/actions.ts), and staff_commissions (0080). See 0084's own
// footer note for the full reasoning, including what would change if the
// renew path ever needs to become atomic.

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type {
  ArchiveTab,
  ArchiveDocumentGroup,
  ArchiveDocument,
  ArchiveDocumentFile,
} from "@/lib/db-types";

const BUCKET = "archive-documents";
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB — scans/PDFs run larger than photos

async function actorEmail(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.email ?? null;
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export type ArchiveGroupInput = {
  tab: ArchiveTab;
  title: string;
  description: string | null;
  color: string | null;
  warning_days: number;
};

function validateGroup(input: ArchiveGroupInput): string | null {
  if (!input.title.trim()) return "Group title is required.";
  // Mirrors the DB CHECK (warning_days > 0) so the user gets a plain message
  // instead of a raw constraint-violation string. The DB stays the real gate.
  if (!Number.isFinite(input.warning_days) || input.warning_days <= 0) {
    return "Warning threshold must be at least 1 day.";
  }
  return null;
}

export async function createArchiveGroup(
  input: ArchiveGroupInput,
): Promise<{ error: string | null; group?: ArchiveDocumentGroup }> {
  const bad = validateGroup(input);
  if (bad) return { error: bad };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("archive_document_groups")
    .insert({
      tab: input.tab,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      color: input.color,
      warning_days: input.warning_days,
      created_by: await actorEmail(supabase),
    })
    .select("*")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/archive");
  return { error: null, group: data as ArchiveDocumentGroup };
}

export async function updateArchiveGroup(
  groupId: string,
  input: ArchiveGroupInput,
): Promise<{ error: string | null; group?: ArchiveDocumentGroup }> {
  if (!groupId) return { error: "Group is required." };
  const bad = validateGroup(input);
  if (bad) return { error: bad };

  const supabase = createClient();
  // `tab` is deliberately NOT updatable — moving a group between tabs would
  // strand its documents' subject links (a staff document has a staff_id
  // that means nothing under the Company tab).
  const { data, error } = await supabase
    .from("archive_document_groups")
    .update({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      color: input.color,
      warning_days: input.warning_days,
    })
    .eq("id", groupId)
    .select("*")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/archive");
  return { error: null, group: data as ArchiveDocumentGroup };
}

export async function deleteArchiveGroup(groupId: string): Promise<{ error: string | null }> {
  if (!groupId) return { error: "Group is required." };

  const supabase = createClient();

  // Storage cleanup BEFORE the row delete — the documents (and therefore
  // their file-pointer rows) are about to cascade away, so this is the last
  // moment their storage_paths are readable. Same "read pointers first,
  // delete row, then clean the bucket" order deleteWorkOrder() uses.
  const { data: docs } = await supabase
    .from("archive_documents")
    .select("id")
    .eq("group_id", groupId);
  const docIds = (docs ?? []).map((d) => d.id as string);

  let paths: string[] = [];
  if (docIds.length > 0) {
    const { data: files } = await supabase
      .from("archive_document_files")
      .select("storage_path")
      .in("document_id", docIds);
    paths = (files ?? []).map((f) => f.storage_path as string);
  }

  const { error } = await supabase.from("archive_document_groups").delete().eq("id", groupId);
  if (error) return { error: error.message };

  if (paths.length > 0) {
    // Best-effort: the rows are already gone either way. A leftover blob with
    // no pointer is a minor cleanup gap, not a data bug.
    await supabase.storage.from(BUCKET).remove(paths);
  }

  revalidatePath("/archive");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export type ArchiveDocumentInput = {
  group_id: string;
  title: string;
  reference_no: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  note: string | null;
  // Phase 1 (Company) never sets these; Phases 2-3 will. At most one may be
  // non-null — the DB CHECK is the real gate.
  driver_id?: string | null;
  staff_id?: string | null;
  truck_id?: string | null;
};

function validateDocument(input: ArchiveDocumentInput): string | null {
  if (!input.group_id) return "Group is required.";
  if (!input.title.trim()) return "Document title is required.";
  // Client mirror of the DB's own date-order CHECK — same friendly-message-
  // in-front-of-a-real-constraint approach as validateGroup above.
  if (input.issue_date && input.expiry_date && input.expiry_date < input.issue_date) {
    return "Expiry date must be on or after the issue date.";
  }
  const subjects = [input.driver_id, input.staff_id, input.truck_id].filter(Boolean);
  if (subjects.length > 1) return "A document can belong to only one subject.";
  return null;
}

export async function createArchiveDocument(
  input: ArchiveDocumentInput,
): Promise<{ error: string | null; document?: ArchiveDocument }> {
  const bad = validateDocument(input);
  if (bad) return { error: bad };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("archive_documents")
    .insert({
      group_id: input.group_id,
      title: input.title.trim(),
      reference_no: input.reference_no?.trim() || null,
      issue_date: input.issue_date || null,
      expiry_date: input.expiry_date || null,
      note: input.note?.trim() || null,
      driver_id: input.driver_id ?? null,
      staff_id: input.staff_id ?? null,
      truck_id: input.truck_id ?? null,
      created_by: await actorEmail(supabase),
    })
    .select("*")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/archive");
  return { error: null, document: data as ArchiveDocument };
}

export async function updateArchiveDocument(
  documentId: string,
  input: ArchiveDocumentInput,
): Promise<{ error: string | null; document?: ArchiveDocument }> {
  if (!documentId) return { error: "Document is required." };
  const bad = validateDocument(input);
  if (bad) return { error: bad };

  const supabase = createClient();
  // A plain EDIT — corrects a typo in place, writes NO history. Renewing is a
  // different operation with different intent (see renewArchiveDocument).
  const { data, error } = await supabase
    .from("archive_documents")
    .update({
      title: input.title.trim(),
      reference_no: input.reference_no?.trim() || null,
      issue_date: input.issue_date || null,
      expiry_date: input.expiry_date || null,
      note: input.note?.trim() || null,
    })
    .eq("id", documentId)
    .select("*")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/archive");
  return { error: null, document: data as ArchiveDocument };
}

export async function deleteArchiveDocument(documentId: string): Promise<{ error: string | null }> {
  if (!documentId) return { error: "Document is required." };

  const supabase = createClient();

  // Same read-pointers-first order as deleteArchiveGroup. Covers BOTH current
  // and superseded-version files: every row in archive_document_files FKs
  // document_id, regardless of its renewal_id, so one query gets them all.
  const { data: files } = await supabase
    .from("archive_document_files")
    .select("storage_path")
    .eq("document_id", documentId);
  const paths = (files ?? []).map((f) => f.storage_path as string);

  const { error } = await supabase.from("archive_documents").delete().eq("id", documentId);
  if (error) return { error: error.message };

  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);

  revalidatePath("/archive");
  return { error: null };
}

// ---------------------------------------------------------------------------
// RENEW — the one ordered, multi-step operation in this file.
//
// ORDER IS DELIBERATE and must not be rearranged:
//   1. snapshot the OUTGOING values into archive_document_renewals
//   2. stamp the outgoing FILES with that renewal's id
//   3. update the parent row with the NEW values
//
// Why this order: a partial failure must never leave the parent updated
// WITHOUT its snapshot — that would silently destroy the superseded version,
// which is the exact thing renewal history exists to prevent. Failing at
// step 1 changes nothing; failing at step 2 or 3 leaves a visible, re-doable
// history row (the old version is preserved, just not yet replaced). The
// safe failure mode is "history row exists, parent not yet updated", never
// the reverse.
// ---------------------------------------------------------------------------

export type ArchiveRenewInput = {
  reference_no: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  note: string | null;
};

export async function renewArchiveDocument(
  documentId: string,
  input: ArchiveRenewInput,
): Promise<{ error: string | null; document?: ArchiveDocument }> {
  if (!documentId) return { error: "Document is required." };
  if (input.issue_date && input.expiry_date && input.expiry_date < input.issue_date) {
    return { error: "Expiry date must be on or after the issue date." };
  }

  const supabase = createClient();

  // Read the CURRENT (about to be superseded) values.
  const { data: current, error: readErr } = await supabase
    .from("archive_documents")
    .select("id, reference_no, issue_date, expiry_date, note")
    .eq("id", documentId)
    .single();
  if (readErr || !current) return { error: readErr?.message ?? "Document not found." };

  // STEP 1 — snapshot the outgoing version (append-only history).
  const { data: renewal, error: renewalErr } = await supabase
    .from("archive_document_renewals")
    .insert({
      document_id: documentId,
      reference_no: current.reference_no,
      issue_date: current.issue_date,
      expiry_date: current.expiry_date,
      note: current.note,
      superseded_by: await actorEmail(supabase),
    })
    .select("id")
    .single();
  if (renewalErr || !renewal) return { error: renewalErr?.message ?? "Could not save renewal history." };

  // STEP 2 — stamp the outgoing files onto that renewal, so the superseded
  // version keeps its own scans instead of them being silently re-attributed
  // to the new version. Only files still marked "current" (renewal_id null)
  // move; files already belonging to an EARLIER renewal stay where they are.
  const { error: stampErr } = await supabase
    .from("archive_document_files")
    .update({ renewal_id: renewal.id })
    .eq("document_id", documentId)
    .is("renewal_id", null);
  if (stampErr) return { error: stampErr.message };

  // STEP 3 — the parent now becomes the NEW current version.
  const { data: updated, error: updateErr } = await supabase
    .from("archive_documents")
    .update({
      reference_no: input.reference_no?.trim() || null,
      issue_date: input.issue_date || null,
      expiry_date: input.expiry_date || null,
      note: input.note?.trim() || null,
    })
    .eq("id", documentId)
    .select("*")
    .single();
  if (updateErr) return { error: updateErr.message };

  revalidatePath("/archive");
  return { error: null, document: updated as ArchiveDocument };
}

// ---------------------------------------------------------------------------
// Files — multiple per document. Same shape as uploadWorkshopPaymentFile /
// uploadWorkOrderPartPhoto: upload bytes, insert the pointer row, and remove
// the blob again if the row insert fails (never leave an orphaned object for
// a row that never landed).
// ---------------------------------------------------------------------------

export async function uploadArchiveDocumentFile(
  formData: FormData,
): Promise<{ error: string | null; file?: ArchiveDocumentFile }> {
  const documentId = String(formData.get("documentId") ?? "").trim();
  const file = formData.get("file");

  if (!documentId) return { error: "Document is required." };
  if (!(file instanceof File) || file.size === 0) return { error: "File is required." };
  if (file.size > MAX_FILE_BYTES) return { error: "File too large (max 10 MB)." };

  const supabase = createClient();

  const extMatch = /\.([a-zA-Z0-9]{1,10})$/.exec(file.name);
  const ext = extMatch ? extMatch[1].toLowerCase() : "bin";
  const path = `${documentId}/doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (uploadErr) return { error: `Upload failed: ${uploadErr.message}` };

  const { data, error } = await supabase
    .from("archive_document_files")
    .insert({
      document_id: documentId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
    })
    .select("*")
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    return { error: error.message };
  }

  revalidatePath("/archive");
  return { error: null, file: data as ArchiveDocumentFile };
}

export async function removeArchiveDocumentFile(fileId: string): Promise<{ error: string | null }> {
  if (!fileId) return { error: "File is required." };

  const supabase = createClient();

  const { data: file, error: fetchErr } = await supabase
    .from("archive_document_files")
    .select("storage_path")
    .eq("id", fileId)
    .single();
  if (fetchErr || !file) return { error: fetchErr?.message ?? "File not found." };

  const { error: deleteErr } = await supabase.from("archive_document_files").delete().eq("id", fileId);
  if (deleteErr) return { error: deleteErr.message };

  // Storage cleanup after the row is gone — a leftover blob with no pointer
  // is harmless; a pointer to a deleted blob is not.
  await supabase.storage.from(BUCKET).remove([file.storage_path]);

  revalidatePath("/archive");
  return { error: null };
}

// Signed URLs, generated on demand (5 min) — same convention as
// getWorkshopPaymentFileSignedUrls / getWorkOrderPartPhotoSignedUrls. The
// bucket is private, so links must be short-lived and never prefetched in
// bulk at page load.
export async function getArchiveFileSignedUrls(
  paths: string[],
): Promise<{ error: string | null; urls?: Record<string, string> }> {
  if (paths.length === 0) return { error: null, urls: {} };

  const supabase = createClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 300);
  if (error || !data) return { error: error?.message ?? "Could not generate file links." };

  const urls: Record<string, string> = {};
  for (const item of data) {
    if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
  }
  return { error: null, urls };
}
