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
import { slugifyKey, isValidSlug } from "@/lib/slug";
import { linkTarget, isStandingType, type PersonIdField } from "@/lib/archive";
import type {
  ArchiveTab,
  ArchiveSubjectKind,
  ArchiveDocumentGroup,
  ArchiveDocument,
  ArchiveDocumentFile,
  ArchiveDocumentType,
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
  // Which population this group's rows are keyed by (0086). The DB CHECK
  // requires it to agree with `tab` — a staff-tab group left at the default
  // 'none' is REFUSED, so the create form must always send a real value.
  subject_kind: ArchiveSubjectKind;
  // 0089 — ONE type for every document in a staff/truck group. Required by
  // the app for those tabs (a group with no type can never be linked, so it
  // would silently lose the whole point of the rework); must stay NULL on
  // company groups, which keep 0085's per-document type. The DB allows NULL
  // so legacy pre-0089 groups keep working.
  type_key: string | null;
  title: string;
  description: string | null;
  color: string | null;
  warning_days: number;
};

function validateGroup(input: ArchiveGroupInput): string | null {
  if (!input.title.trim()) return "Group title is required.";
  // Mirror of 0086's tab/subject_kind CHECK, so the user sees a sentence
  // instead of a raw constraint violation. The DB stays the real gate.
  const expected: Record<ArchiveTab, ArchiveSubjectKind[]> = {
    company: ["none"],
    staff: ["driver", "staff"],
    truck: ["truck"],
    customer: ["customer"],
  };
  if (!expected[input.tab].includes(input.subject_kind)) {
    return input.tab === "staff"
      ? "Choose whether this group is for drivers or management staff."
      : `A ${input.tab} group cannot be a "${input.subject_kind}" group.`;
  }
  // Mirrors the DB CHECK (warning_days > 0) so the user gets a plain message
  // instead of a raw constraint-violation string. The DB stays the real gate.
  if (!Number.isFinite(input.warning_days) || input.warning_days <= 0) {
    return "Warning threshold must be at least 1 day.";
  }
  if ((input.tab === "staff" || input.tab === "truck") && !input.type_key) {
    return "Choose the document type this group holds.";
  }
  if (input.tab !== "staff" && input.tab !== "truck" && input.type_key) {
    return "Only staff and truck groups carry a group-level document type.";
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
      subject_kind: input.subject_kind,
      type_key: input.type_key,
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
  // `tab` and `subject_kind` are deliberately NOT updatable. Moving a group
  // between tabs would strand its documents' subject links (a staff document
  // has a staff_id that means nothing under the Company tab), and flipping
  // subject_kind on a group that already holds documents would put every one
  // of them in violation of 0087's guard at once — the next edit to any of
  // them would then be refused by the DB. Both are create-time decisions.
  //
  // `type_key` joins them for the same reason, and a sharper one: changing a
  // group from a non-linked type to a linked one would instantly make every
  // document in it illegal (they hold their own reference_no/expiry_date,
  // which a linked document may not) AND could collide with the one-per-
  // person rule. Retype = new group.
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
  // Added by 0085 — all optional identity attributes.
  issuing_entity: string | null;
  holder_name: string | null;
  type_key: string | null;
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
      issuing_entity: input.issuing_entity?.trim() || null,
      holder_name: input.holder_name?.trim() || null,
      type_key: input.type_key || null,
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
      issuing_entity: input.issuing_entity?.trim() || null,
      holder_name: input.holder_name?.trim() || null,
      type_key: input.type_key || null,
    })
    .eq("id", documentId)
    .select("*")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/archive");
  return { error: null, document: data as ArchiveDocument };
}

// ---------------------------------------------------------------------------
// Document types — the managed pick-list (0085). Inline "add new type"
// mirrors addStaffCommissionType (0080) exactly: slugify the typed label
// into a stable `key`, and RE-ACTIVATE an existing key rather than erroring
// on a duplicate. label_ar gets the same typed label as label_en — the
// inline-add flow has one text field, same UX as leave types / staff roles /
// repairer types, none of which prompt for a separate Arabic label either.
// ---------------------------------------------------------------------------
// Delete a document type. Refuses a standing type, and refuses one that is
// still referenced.
//
// The usage check here is a COURTESY, not the guarantee: between checking and
// deleting, someone could create a group using the type. That race is exactly
// what the FK's ON DELETE RESTRICT is for — it turns the race into a clean
// error instead of an orphaned reference, so this function checks first for a
// readable message and lets the constraint be the backstop.
export async function deleteArchiveDocumentType(
  key: string,
): Promise<{ error: string | null }> {
  if (!key) return { error: "Type is required." };
  if (isStandingType(key)) {
    return { error: "Built-in types cannot be deleted. Retire it instead by leaving it unused." };
  }

  const supabase = createClient();

  const [{ count: groupCount }, { count: docCount }] = await Promise.all([
    supabase
      .from("archive_document_groups")
      .select("id", { count: "exact", head: true })
      .eq("type_key", key),
    supabase
      .from("archive_documents")
      .select("id", { count: "exact", head: true })
      .eq("type_key", key),
  ]);

  const used = (groupCount ?? 0) + (docCount ?? 0);
  if (used > 0) {
    return {
      error: `This type is used by ${groupCount ?? 0} group(s) and ${docCount ?? 0} document(s). It cannot be deleted while anything references it.`,
    };
  }

  const { error } = await supabase.from("archive_document_types").delete().eq("key", key);
  if (error) {
    // 23503 = foreign_key_violation: something started using the type between
    // the check above and this delete. Say so plainly rather than surfacing a
    // raw constraint string.
    if (error.code === "23503") {
      return { error: "That type just came into use and can no longer be deleted." };
    }
    return { error: error.message };
  }

  revalidatePath("/archive");
  return { error: null };
}

export async function addArchiveDocumentType(
  label: string,
): Promise<{ error: string | null; type?: ArchiveDocumentType }> {
  const clean = label.trim();
  if (!clean) return { error: "Type name is required." };
  const key = slugifyKey(clean);
  if (!key) return { error: "Type name needs letters or numbers." };
  if (!isValidSlug(key)) return { error: "Type name must start with a letter." };

  const supabase = createClient();

  const { data: existing } = await supabase
    .from("archive_document_types")
    .select("*")
    .eq("key", key)
    .maybeSingle();

  if (existing) {
    // Reuse. If it was retired, bring it back rather than refusing — the
    // user is explicitly asking for this type to exist again.
    if (!existing.active) {
      const { data: revived, error } = await supabase
        .from("archive_document_types")
        .update({ active: true })
        .eq("key", key)
        .select("*")
        .single();
      if (error) return { error: error.message };
      revalidatePath("/archive");
      return { error: null, type: revived as ArchiveDocumentType };
    }
    return { error: null, type: existing as ArchiveDocumentType };
  }

  const { data, error } = await supabase
    .from("archive_document_types")
    .insert({ key, label_en: clean, label_ar: clean })
    .select("*")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/archive");
  return { error: null, type: data as ArchiveDocumentType };
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
  // LINKED renewal (0089/0091/0092). Present only when the document's group
  // type links to a subject field. When set, `reference_no`/`expiry_date`
  // above are IGNORED — the new values go to the subject instead, and the
  // parent document is written NULL for both, because 0092's guard refuses a
  // linked document that carries either.
  linked?: {
    field: PersonIdField;
    subjectId: string;
    number: string | null;
    expiry: string | null;
  };
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

  // LINKED RENEWAL (0089/0091/0092). For a linked document the number and
  // expiry live on the SUBJECT, and 0092's guard now REFUSES a linked
  // document that carries either — so this path cannot write them to the
  // parent, and the outgoing values are not on the parent to snapshot from.
  //
  // The outgoing pair is read HERE, server-side, rather than trusted from the
  // client: the history row is the only record that survives once the
  // subject's own columns are overwritten, so it must reflect what was
  // actually there a moment ago, not what a form believed.
  let outgoing: { number: string | null; expiry: string | null } | null = null;
  if (input.linked) {
    const target = linkTarget(input.linked.field);
    const { data: subject, error: subjErr } = await supabase
      .from(target.table)
      .select(`${target.numberColumn}, ${target.expiryColumn}`)
      .eq("id", input.linked.subjectId)
      .single();
    if (subjErr) return { error: subjErr.message };
    const row = subject as Record<string, string | null> | null;
    outgoing = {
      number: row?.[target.numberColumn] ?? null,
      expiry: row?.[target.expiryColumn] ?? null,
    };
  }

  // STEP 1 — snapshot the outgoing version (append-only history).
  //
  // archive_document_renewals is HISTORY, not current state, so 0092's guard
  // does not apply to it — which is what lets a linked document keep a
  // truthful record of the number and expiry it used to have. Without this
  // the history would record blanks and the previous number would be gone.
  const { data: renewal, error: renewalErr } = await supabase
    .from("archive_document_renewals")
    .insert({
      document_id: documentId,
      reference_no: outgoing ? outgoing.number : current.reference_no,
      issue_date: current.issue_date,
      expiry_date: outgoing ? outgoing.expiry : current.expiry_date,
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
      // A linked document stores NEITHER — forced null rather than merely
      // left alone, so there is no path by which a stale value survives.
      reference_no: input.linked ? null : (input.reference_no?.trim() || null),
      issue_date: input.issue_date || null,
      expiry_date: input.linked ? null : (input.expiry_date || null),
      note: input.note?.trim() || null,
    })
    .eq("id", documentId)
    .select("*")
    .single();
  if (updateErr) return { error: updateErr.message };

  // STEP 4 (linked only) — the renewal's whole point: the SUBJECT's number
  // and expiry move forward. Written LAST, after the history row exists, so a
  // failure here leaves the old values in place with the snapshot already
  // recorded, rather than moving the number with no record of what it was.
  if (input.linked) {
    const res = await setPersonLinkedId(input.linked.field, input.linked.subjectId, {
      number: input.linked.number,
      expiry: input.linked.expiry,
    });
    if (res.error) return { error: res.error };
  }

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

// ---------------------------------------------------------------------------
// THE LINK — writing a linked number + expiry to the PERSON (0088/0089).
//
// For a linked (type + subject) combination the number AND its expiry belong
// to the person, not the document. This is the archive's only writer of those
// columns, and the document keeps NO copy of either — so the two can never
// disagree, because there is only ever one of them.
//
// SECURITY NOTE, and the reason this doesn't take a column name: the table
// and both columns are resolved HERE from a closed union via
// lib/archive.ts's linkTarget(). archive_document_types.linked_driver_field
// stores a column NAME, but that value is never interpolated into SQL — it is
// matched against known cases and thrown away. A row in that table can pick
// which of three known targets is used; it can never invent a fourth.
//
// Plain single-table update, no RPC — same precedent as every other write in
// this file: one table, no cross-table invariant, no money, no counter.
// ---------------------------------------------------------------------------
export async function setPersonLinkedId(
  field: PersonIdField,
  personId: string,
  value: { number: string | null; expiry: string | null },
): Promise<{ error: string | null }> {
  if (!personId) return { error: "Person is required." };

  const target = linkTarget(field);
  const supabase = createClient();

  const { error } = await supabase
    .from(target.table)
    .update({
      [target.numberColumn]: value.number?.trim() || null,
      [target.expiryColumn]: value.expiry || null,
    })
    .eq("id", personId);
  if (error) return { error: error.message };

  // Both pages read these columns, so both are revalidated — the Archive
  // shows the document row, the Staff page shows the profile field.
  revalidatePath("/archive");
  // Both pages that show these read them: /drivers for a person, /fleet for a
  // truck. Revalidating both is cheaper than deciding which one to skip.
  revalidatePath("/drivers");
  revalidatePath("/fleet");
  return { error: null };
}

// ---------------------------------------------------------------------------
// RESTORE a soft-deleted person — the exact inverse of termination.
//
// active = true, terminated_at = null. For a driver, termination_date is
// cleared too: it is the effective last-working-day that accompanied the
// termination, and leaving it set on a restored driver would leave a "last
// day" on someone who is back at work.
//
// Deliberately NOT touching anything else. Termination is a soft-delete
// (architecture lock: records persist), so nothing was destroyed to restore —
// commissions, incidents, leave and archive documents all kept resolving
// throughout, and they keep resolving now.
// ---------------------------------------------------------------------------
export async function restoreDriver(driverId: string): Promise<{ error: string | null }> {
  if (!driverId) return { error: "Driver is required." };
  const supabase = createClient();
  const { error } = await supabase
    .from("drivers")
    .update({ active: true, terminated_at: null, termination_date: null })
    .eq("id", driverId);
  if (error) return { error: error.message };
  revalidatePath("/archive");
  revalidatePath("/drivers");
  return { error: null };
}

// RESTORE a soft-deleted TRUCK. Turki's call: clear all four termination
// fields, not just the two that hide it.
//
// A truck that is back in service has no "sold for X, released on Y" — leaving
// termination_reason / termination_price / released_date set would mean the
// Fleet page can show a live, working truck still carrying a sale price, which
// reads as a contradiction everywhere those fields appear, and a later
// re-termination would overwrite them anyway. The cost is real and worth
// stating: if the truck was genuinely sold and restored by mistake, the sale
// price is gone and has to be re-entered.
export async function restoreTruck(truckId: string): Promise<{ error: string | null }> {
  if (!truckId) return { error: "Truck is required." };
  const supabase = createClient();
  const { error } = await supabase
    .from("trucks")
    .update({
      active: true,
      terminated_at: null,
      termination_reason: null,
      termination_price: null,
      released_date: null,
    })
    .eq("id", truckId);
  if (error) return { error: error.message };
  revalidatePath("/archive");
  revalidatePath("/fleet");
  return { error: null };
}

export async function restoreStaff(staffId: string): Promise<{ error: string | null }> {
  if (!staffId) return { error: "Staff member is required." };
  const supabase = createClient();
  const { error } = await supabase
    .from("staff")
    .update({ active: true, terminated_at: null })
    .eq("id", staffId);
  if (error) return { error: error.message };
  revalidatePath("/archive");
  revalidatePath("/drivers");
  return { error: null };
}

// ---------------------------------------------------------------------------
// MAINTENANCE JOB DETAIL — read-only, for the Truck tab's history sub-tab.
//
// Fetched ON DEMAND (when a row is clicked) rather than loaded with the page.
// The archive would otherwise have to pull every work-order part line, every
// FIFO consumption row and every workshop payment in the database on every
// render, to populate a popup that is usually never opened. This is a read
// with no writes, so lazily fetching it costs nothing but a round trip.
//
// DISPLAY ONLY. The archive shows this history; the Maintenance page remains
// the only place a job is created or changed.
// ---------------------------------------------------------------------------
export type MaintenanceJobDetail = {
  kind: "in_house" | "outsourced";
  ref: string;
  title: string;
  status: string;
  fields: { label: string; value: string }[];
  // In-house: the parts lines with what was actually drawn from stock.
  // Outsourced: the repairer payment lines.
  lines: {
    label: string;
    sub: string | null;
    qty: string;
    amount: string;
    // On-hand BEFORE and AFTER this work order's consumption. In-house only
    // (outsourced jobs consume no inventory), and null when no matching
    // stock movement was found — an honest blank beats a fabricated count.
    onHandBefore: string | null;
    onHandAfter: string | null;
  }[];
  linesTitle: string;
  linesEmpty: string;
  total: string | null;
  note: string | null;
  error: string | null;
};

function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`;
}

function dateOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

export async function getMaintenanceJobDetail(
  kind: "in_house" | "outsourced",
  jobId: string,
): Promise<MaintenanceJobDetail | { error: string }> {
  if (!jobId) return { error: "Missing job." };
  const supabase = createClient();

  if (kind === "in_house") {
    const { data: wo, error: woErr } = await supabase
      .from("work_orders")
      .select(
        "id, wo_number, title, type, priority, status, opened_at, start_date, due_by, closed_at, assigned_mechanic_id, actual_cost_sar, labor_hours, labor_rate_sar, mechanic_notes, odometer_at_service, created_by, completed_by",
      )
      .eq("id", jobId)
      .single();
    if (woErr || !wo) return { error: woErr?.message ?? "Work order not found." };

    const [{ data: mech }, { data: parts }] = await Promise.all([
      supabase.from("staff").select("name").eq("id", wo.assigned_mechanic_id).maybeSingle(),
      supabase
        .from("work_order_parts")
        .select("id, part_id, qty, unit_price_sar")
        .eq("work_order_id", jobId),
    ]);

    const partIds = (parts ?? []).map((p) => p.part_id as string);
    const wopIds = (parts ?? []).map((p) => p.id as string);

    // The CONSUMPTION ledger (0065) keys off work_order_part_id, not the work
    // order — and it records both directions, so a returned quantity has to be
    // netted off rather than counted as a second draw.
    const [{ data: partRows }, { data: cons }] = await Promise.all([
      partIds.length
        ? supabase.from("parts").select("id, name, sku, unit").in("id", partIds)
        : Promise.resolve({ data: [] as { id: string; name: string; sku: string; unit: string | null }[] }),
      wopIds.length
        ? supabase
            .from("work_order_part_consumptions")
            .select("work_order_part_id, direction, qty, unit_price_sar")
            .in("work_order_part_id", wopIds)
        : Promise.resolve({ data: [] as { work_order_part_id: string; direction: string; qty: number; unit_price_sar: number }[] }),
    ]);

    // ON-HAND BEFORE/AFTER comes from stock_movements, NOT from
    // work_order_part_consumptions — that ledger records the per-lot draw and
    // carries no running balance at all. stock_movements is where qty_after
    // lives, so it is the only place this pair can be read from.
    const { data: movements } = partIds.length
      ? await supabase
          .from("stock_movements")
          .select("part_id, movement_type, qty_delta, qty_after, note, created_at")
          .in("part_id", partIds)
          .eq("movement_type", "consume")
          .order("created_at", { ascending: true })
      : { data: [] as { part_id: string; movement_type: string; qty_delta: number; qty_after: number; note: string | null; created_at: string }[] };

    // Movements are tied to a work order only by a free-text note ("Work order
    // WO-26-0007"). Matching is deliberately two-tier rather than one loose
    // `includes`: the FULL number is tried first, and only if nothing matches
    // does it fall back to the legacy short form ("WO-0007", one known row
    // written before the year segment existed). A single loose match on the
    // trailing digits alone would let WO-25-0007 and WO-26-0007 collide.
    const woNumber = wo.wo_number as string;
    const legacyRef = woNumber.replace(/^(WO)-\d+-(\d+)$/i, "$1-$2");
    function movementsFor(partId: string) {
      const mine = (movements ?? []).filter((m) => m.part_id === partId);
      const exact = mine.filter((m) => (m.note ?? "").includes(woNumber));
      if (exact.length > 0) return exact;
      if (legacyRef !== woNumber) {
        return mine.filter((m) => (m.note ?? "").includes(legacyRef));
      }
      return [];
    }

    const partById = new Map((partRows ?? []).map((p) => [p.id as string, p]));
    const consumedByWop = new Map<string, { qty: number; value: number }>();
    for (const c of cons ?? []) {
      const sign = c.direction === "return" ? -1 : 1;
      const cur = consumedByWop.get(c.work_order_part_id as string) ?? { qty: 0, value: 0 };
      cur.qty += sign * Number(c.qty);
      cur.value += sign * Number(c.qty) * Number(c.unit_price_sar);
      consumedByWop.set(c.work_order_part_id as string, cur);
    }

    return {
      kind: "in_house",
      ref: wo.wo_number as string,
      title: wo.title as string,
      status: wo.status as string,
      fields: [
        { label: "Type", value: String(wo.type ?? "—") },
        { label: "Priority", value: String(wo.priority ?? "—") },
        { label: "Mechanic", value: mech?.name ?? "—" },
        { label: "Opened", value: dateOnly(wo.opened_at as string) },
        { label: "Started", value: dateOnly(wo.start_date as string | null) },
        { label: "Due by", value: dateOnly(wo.due_by as string) },
        { label: "Closed", value: dateOnly(wo.closed_at as string | null) },
        { label: "Odometer", value: wo.odometer_at_service != null ? `${wo.odometer_at_service} km` : "—" },
        { label: "Labor hours", value: String(wo.labor_hours ?? "—") },
        { label: "Labor rate", value: money(wo.labor_rate_sar as number | null) },
        { label: "Created by", value: (wo.created_by as string | null) ?? "—" },
        { label: "Completed by", value: (wo.completed_by as string | null) ?? "—" },
      ],
      linesTitle: "Parts consumed",
      linesEmpty: "No parts were consumed on this work order.",
      lines: (parts ?? []).map((p) => {
        const part = partById.get(p.part_id as string);
        const drawn = consumedByWop.get(p.id as string);
        // Staged consumption (an edit that drew more later) writes more than
        // one movement, so BEFORE reads from the FIRST and AFTER from the
        // LAST. For the ordinary single-movement case the two are the same
        // row and this reduces to Turki's own formula:
        //   AFTER = qty_after, BEFORE = qty_after - qty_delta.
        const ms = movementsFor(p.part_id as string);
        const first = ms[0];
        const last = ms[ms.length - 1];
        return {
          label: part?.name ?? "Unknown part",
          sub: part?.sku ? `${part.sku}${part.unit ? ` · ${part.unit}` : ""}` : null,
          // Planned quantity vs what the FIFO ledger actually drew. They
          // normally match; showing both means a reversal or a partial draw
          // is visible instead of hidden behind one number.
          qty: drawn ? `${drawn.qty} of ${p.qty}` : `${p.qty} planned`,
          amount: drawn ? money(drawn.value) : money(Number(p.qty) * Number(p.unit_price_sar)),
          // qty_delta is negative for a consume, so subtracting it adds the
          // drawn quantity back to reach the pre-consumption count.
          onHandBefore: first ? String(Number(first.qty_after) - Number(first.qty_delta)) : null,
          onHandAfter: last ? String(Number(last.qty_after)) : null,
        };
      }),
      // Parts-only, per 0079's boundary — labour is shown above as hours and
      // rate and is deliberately NOT added into this figure.
      total: `Parts total ${money(wo.actual_cost_sar as number | null)}`,
      note: (wo.mechanic_notes as string | null) ?? null,
      error: null,
    };
  }

  const { data: job, error: jobErr } = await supabase
    .from("outsourced_jobs")
    .select(
      "id, os_number, title, type, status, start_date, estimated_finish, closed_at, responsible_mechanic_id, notes, created_by, completed_by",
    )
    .eq("id", jobId)
    .single();
  if (jobErr || !job) return { error: jobErr?.message ?? "Outsourced job not found." };

  const [{ data: mech }, { data: payments }] = await Promise.all([
    supabase.from("staff").select("name").eq("id", job.responsible_mechanic_id).maybeSingle(),
    supabase
      .from("workshop_payments")
      .select("id, repairer_id, invoice_number, invoice_date, subtotal_sar, vat_sar, discount_sar, grand_total_sar, note")
      .eq("outsourced_job_id", jobId),
  ]);

  const repairerIds = [...new Set((payments ?? []).map((p) => p.repairer_id as string))];
  const { data: repairers } = repairerIds.length
    ? await supabase.from("repairers").select("id, name").in("id", repairerIds)
    : { data: [] as { id: string; name: string }[] };
  const repairerById = new Map((repairers ?? []).map((r) => [r.id as string, r.name as string]));

  const grand = (payments ?? []).reduce((n, p) => n + Number(p.grand_total_sar), 0);

  return {
    kind: "outsourced",
    ref: job.os_number as string,
    title: job.title as string,
    status: job.status as string,
    fields: [
      { label: "Type", value: String(job.type ?? "—") },
      { label: "Responsible mechanic", value: mech?.name ?? "—" },
      { label: "Started", value: dateOnly(job.start_date as string) },
      { label: "Estimated finish", value: dateOnly(job.estimated_finish as string) },
      { label: "Closed", value: dateOnly(job.closed_at as string | null) },
      { label: "Created by", value: (job.created_by as string | null) ?? "—" },
      { label: "Completed by", value: (job.completed_by as string | null) ?? "—" },
    ],
    linesTitle: "Workshop payments",
    linesEmpty: "No workshop payment recorded for this job.",
    lines: (payments ?? []).map((p) => ({
      label: repairerById.get(p.repairer_id as string) ?? "Unknown repairer",
      sub: [
        p.invoice_number ? `Invoice ${p.invoice_number}` : null,
        p.invoice_date ? dateOnly(p.invoice_date as string) : null,
        Number(p.discount_sar) > 0 ? `Discount ${money(p.discount_sar as number)}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
      qty: `${money(p.subtotal_sar as number)} + ${money(p.vat_sar as number)} VAT`,
      amount: money(p.grand_total_sar as number),
      // Outsourced work consumes no inventory, so there is no on-hand pair to
      // show — null rather than a zero that would read as "stock hit zero".
      onHandBefore: null,
      onHandAfter: null,
    })),
    total: (payments ?? []).length > 0 ? `Total paid ${money(grand)}` : null,
    note: (job.notes as string | null) ?? null,
    error: null,
  };
}
