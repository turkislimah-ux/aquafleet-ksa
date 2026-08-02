"use server";

// Maintenance — Phase 4: outsourced-jobs track server actions. Same
// "use server" + Supabase RPC pattern as actions.ts (in-house). ZERO stock/
// FIFO involvement anywhere in this file — no import, no reference, no call
// to consume_from_lots/return_to_lots/add_price_lot/any Inventory action.
//
// Money (workshop_payments): VAT is computed HERE, app-side, via
// lib/outsourced-vat.ts's computeWorkshopPaymentTotals() — which itself
// only imports the rate from lib/prepaid.ts, never touching that file, per
// the same borrow-the-rate convention lib/inventory-vat.ts established.
// The DB's own CHECK (grand_total_sar = subtotal_sar + vat_sar) is the
// final consistency floor regardless of what this file computes and sends.

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { slugifyKey } from "@/lib/slug";
import { computeWorkshopPaymentTotals } from "@/lib/outsourced-vat";
import type {
  RepairerType,
  Repairer,
  OutsourcedDescription,
  OutsourcedJob,
  OutsourcedJobTask,
  WorkshopPayment,
  WorkshopPaymentFile,
} from "@/lib/db-types";

async function actorEmail(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.email ?? null;
}

function friendlyOsError(message: string): string {
  // RPC messages are already plain/specific — pass through as-is, same
  // convention as friendlyWoError in actions.ts.
  return message;
}

// ---------------------------------------------------------------------------
// Lifecycle RPCs
// ---------------------------------------------------------------------------

export type CreateOutsourcedJobInput = {
  truck_id: string;
  responsible_mechanic_id: string;
  type: string;
  start_date: string;
  estimated_finish: string;
  repairer_ids: string[];
  task_description_ids: string[];
  // Polish item 1 (manual title, no migration) — same treatment as
  // createWorkOrder: optional, one field, mirrored into both title
  // columns via a plain follow-up write. create_outsourced_job itself is
  // UNTOUCHED (still sets title=title_ar=os_number).
  title?: string;
};

export async function createOutsourcedJob(
  input: CreateOutsourcedJobInput,
): Promise<{ error: string | null; job?: OutsourcedJob }> {
  if (!input.truck_id) return { error: "Truck is required." };
  if (!input.responsible_mechanic_id) return { error: "Responsible mechanic is required." };
  if (!input.type) return { error: "Type is required." };
  if (!input.start_date) return { error: "Start date is required." };
  if (!input.estimated_finish) return { error: "Estimated finish date is required." };
  if (!input.repairer_ids || input.repairer_ids.length === 0) {
    return { error: "At least one repairer is required." };
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_outsourced_job", {
    p_truck_id: input.truck_id,
    p_responsible_mechanic_id: input.responsible_mechanic_id,
    p_type: input.type,
    p_start_date: input.start_date,
    p_estimated_finish: input.estimated_finish,
    p_repairer_ids: input.repairer_ids,
    p_task_description_ids: input.task_description_ids ?? [],
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: friendlyOsError(error.message) };

  let job = data as OutsourcedJob;

  // Polish item 1 — plain follow-up write, no RPC. Best-effort: a failure
  // here never blocks creation, the os_number-as-title fallback stands.
  const typedTitle = input.title?.trim();
  if (typedTitle) {
    const { data: retitled } = await supabase
      .from("outsourced_jobs")
      .update({ title: typedTitle, title_ar: typedTitle })
      .eq("id", job.id)
      .select("*")
      .single();
    if (retitled) job = retitled as OutsourcedJob;
  }

  revalidatePath("/maintenance");
  return { error: null, job };
}

// ---------------------------------------------------------------------------
// saveOutsourcedJobTitle — Polish item 1. Plain write, NO RPC. Called from
// NewOutsourcedJobModal's own edit-save flow, which is only reachable
// while the job isn't completed — "editable until completed" falls out
// of that existing gate for free. This action doesn't re-check status
// itself.
// ---------------------------------------------------------------------------
export async function saveOutsourcedJobTitle(
  jobId: string,
  title: string,
): Promise<{ error: string | null; job?: OutsourcedJob }> {
  if (!jobId) return { error: "Outsourced job is required." };
  const t = title.trim();
  if (!t) return { error: "Title is required." };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("outsourced_jobs")
    .update({ title: t, title_ar: t })
    .eq("id", jobId)
    .select("*")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/maintenance");
  return { error: null, job: data as OutsourcedJob };
}

export type EditOutsourcedJobInput = {
  job_id: string;
  responsible_mechanic_id: string;
  type: string;
  start_date: string;
  estimated_finish: string;
  repairer_ids: string[];
  task_description_ids: string[];
};

// truck_id is deliberately NOT part of this input — a job's truck is fixed
// once created (Turki's call, migration 0069).
export async function editOutsourcedJob(
  input: EditOutsourcedJobInput,
): Promise<{ error: string | null; job?: OutsourcedJob }> {
  if (!input.job_id) return { error: "Outsourced job is required." };
  if (!input.responsible_mechanic_id) return { error: "Responsible mechanic is required." };
  if (!input.type) return { error: "Type is required." };
  if (!input.start_date) return { error: "Start date is required." };
  if (!input.estimated_finish) return { error: "Estimated finish date is required." };
  if (!input.repairer_ids || input.repairer_ids.length === 0) {
    return { error: "At least one repairer is required." };
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("edit_outsourced_job", {
    p_job_id: input.job_id,
    p_responsible_mechanic_id: input.responsible_mechanic_id,
    p_type: input.type,
    p_start_date: input.start_date,
    p_estimated_finish: input.estimated_finish,
    p_repairer_ids: input.repairer_ids,
    p_task_description_ids: input.task_description_ids ?? [],
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: friendlyOsError(error.message) };

  revalidatePath("/maintenance");
  return { error: null, job: data as OutsourcedJob };
}

export async function dispatchOutsourcedJob(
  jobId: string,
): Promise<{ error: string | null; job?: OutsourcedJob }> {
  if (!jobId) return { error: "Outsourced job is required." };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("dispatch_outsourced_job", {
    p_job_id: jobId,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: friendlyOsError(error.message) };

  revalidatePath("/maintenance");
  return { error: null, job: data as OutsourcedJob };
}

export async function completeOutsourcedJob(
  jobId: string,
): Promise<{ error: string | null; job?: OutsourcedJob }> {
  if (!jobId) return { error: "Outsourced job is required." };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("complete_outsourced_job", {
    p_job_id: jobId,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: friendlyOsError(error.message) };

  revalidatePath("/maintenance");
  return { error: null, job: data as OutsourcedJob };
}

export async function toggleOutsourcedJobTask(
  taskId: string,
  done: boolean,
): Promise<{ error: string | null; task?: OutsourcedJobTask }> {
  if (!taskId) return { error: "Task is required." };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("toggle_outsourced_job_task", {
    p_task_id: taskId,
    p_done: done,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: friendlyOsError(error.message) };

  revalidatePath("/maintenance");
  return { error: null, task: data as OutsourcedJobTask };
}

// save_outsourced_job_notes (migration 0072) — dedicated RPC, same
// reasoning save_work_order_notes has: a single-field quick save
// shouldn't carry edit_outsourced_job's full validation weight.
export async function saveOutsourcedJobNotes(
  jobId: string,
  notes: string,
): Promise<{ error: string | null; job?: OutsourcedJob }> {
  if (!jobId) return { error: "Outsourced job is required." };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("save_outsourced_job_notes", {
    p_job_id: jobId,
    p_notes: notes,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: friendlyOsError(error.message) };

  revalidatePath("/maintenance");
  return { error: null, job: data as OutsourcedJob };
}

// ---------------------------------------------------------------------------
// Inline-add lookups — plain inserts, no RPC (no invariant to protect),
// same reasoning addRepairDescription (0060)/units already established.
// ---------------------------------------------------------------------------

export async function addRepairerType(
  labelEn: string,
  labelAr: string,
): Promise<{ error: string | null; type?: RepairerType }> {
  const enTrim = labelEn?.trim() ?? "";
  if (!enTrim) return { error: "Type name is required." };
  const key = slugifyKey(enTrim);
  if (!key) return { error: "Type name needs letters or numbers." };

  const supabase = createClient();

  const { data: existing } = await supabase
    .from("repairer_types")
    .select("id, key, label_en, label_ar, active, created_at")
    .eq("key", key)
    .maybeSingle();
  if (existing) return { error: null, type: existing as RepairerType };

  const { data, error } = await supabase
    .from("repairer_types")
    .insert({ key, label_en: enTrim, label_ar: labelAr?.trim() || null })
    .select("id, key, label_en, label_ar, active, created_at")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/maintenance");
  return { error: null, type: data as RepairerType };
}

export type RepairerInput = {
  name: string;
  name_ar: string | null;
  location: string | null;
  type: string | null;
  contact_name: string | null;
  contact_number: string | null;
  description: string | null;
};

export async function addRepairer(
  input: RepairerInput,
): Promise<{ error: string | null; repairer?: Repairer }> {
  const name = input.name?.trim() ?? "";
  if (!name) return { error: "Repairer name is required." };

  const supabase = createClient();

  // Case-insensitive dedupe — same courtesy createSupplier gives.
  const { data: existing } = await supabase
    .from("repairers")
    .select("id, name, name_ar, location, type, contact_name, contact_number, description, active, created_at")
    .eq("active", true)
    .ilike("name", name)
    .maybeSingle();
  if (existing) return { error: null, repairer: existing as Repairer };

  const { data, error } = await supabase
    .from("repairers")
    .insert({
      name,
      name_ar: input.name_ar?.trim() || null,
      location: input.location?.trim() || null,
      type: input.type || null,
      contact_name: input.contact_name?.trim() || null,
      contact_number: input.contact_number?.trim() || null,
      description: input.description?.trim() || null,
    })
    .select("id, name, name_ar, location, type, contact_name, contact_number, description, active, created_at")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/maintenance");
  return { error: null, repairer: data as Repairer };
}

// Plain update — repairer edit has no invariant to protect (no FIFO/stock
// coupling on this entity at all).
export async function updateRepairer(
  repairerId: string,
  input: RepairerInput,
): Promise<{ error: string | null; repairer?: Repairer }> {
  if (!repairerId) return { error: "Repairer is required." };
  const name = input.name?.trim() ?? "";
  if (!name) return { error: "Repairer name is required." };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("repairers")
    .update({
      name,
      name_ar: input.name_ar?.trim() || null,
      location: input.location?.trim() || null,
      type: input.type || null,
      contact_name: input.contact_name?.trim() || null,
      contact_number: input.contact_number?.trim() || null,
      description: input.description?.trim() || null,
    })
    .eq("id", repairerId)
    .select("id, name, name_ar, location, type, contact_name, contact_number, description, active, created_at")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/maintenance");
  return { error: null, repairer: data as Repairer };
}

// SOFT delete only — Turki's explicit rule: a repairer is never
// hard-deleted (payments/jobs reference it via ON DELETE RESTRICT anyway,
// so a hard delete would fail the moment it's ever been used regardless;
// this is a deliberate pre-filter, same "active=false, never gone"
// convention as every other entity in this app — suppliers, warehouses,
// units, drivers/trucks).
export async function deleteRepairer(repairerId: string): Promise<{ error: string | null }> {
  if (!repairerId) return { error: "Repairer is required." };

  const supabase = createClient();
  const { error } = await supabase.from("repairers").update({ active: false }).eq("id", repairerId);
  if (error) return { error: error.message };

  revalidatePath("/maintenance");
  return { error: null };
}

export async function addOutsourcedDescription(
  en: string,
  ar: string,
): Promise<{ error: string | null; description?: OutsourcedDescription }> {
  const enTrim = en?.trim() ?? "";
  const arTrim = ar?.trim() ?? "";
  if (!enTrim) return { error: "Description text is required." };

  const supabase = createClient();

  const { data: existing } = await supabase
    .from("outsourced_descriptions")
    .select("id, en, ar, active, created_at")
    .eq("active", true)
    .ilike("en", enTrim)
    .maybeSingle();
  if (existing) return { error: null, description: existing as OutsourcedDescription };

  const { data, error } = await supabase
    .from("outsourced_descriptions")
    .insert({ en: enTrim, ar: arTrim || enTrim })
    .select("id, en, ar, active, created_at")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/maintenance");
  return { error: null, description: data as OutsourcedDescription };
}

// ---------------------------------------------------------------------------
// Workshop payments — the money. Plain insert, no RPC (no invariant beyond
// the DB's own CHECK). VAT computed here, app-side, from the app's real
// configured rate — never a fresh hardcoded 15%.
// ---------------------------------------------------------------------------

const PAYMENT_COLUMNS =
  "id, outsourced_job_id, repairer_id, invoice_number, invoice_date, subtotal_sar, vat_sar, discount_sar, grand_total_sar, note, created_by, created_at";

export type AddWorkshopPaymentInput = {
  outsourced_job_id: string;
  repairer_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  subtotal_sar: number;
  discount_sar: number;
  note: string | null;
};

export async function addWorkshopPayment(
  input: AddWorkshopPaymentInput,
): Promise<{ error: string | null; payment?: WorkshopPayment }> {
  if (!input.outsourced_job_id) return { error: "Outsourced job is required." };
  if (!input.repairer_id) return { error: "Repairer is required." };
  if (!(input.subtotal_sar >= 0)) return { error: "Subtotal cannot be negative." };
  if (!(input.discount_sar >= 0)) return { error: "Discount cannot be negative." };

  const totals = computeWorkshopPaymentTotals(input.subtotal_sar, input.discount_sar);
  if (totals.grand_total_sar < 0) {
    return { error: "Discount cannot exceed subtotal + VAT." };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("workshop_payments")
    .insert({
      outsourced_job_id: input.outsourced_job_id,
      repairer_id: input.repairer_id,
      invoice_number: input.invoice_number?.trim() || null,
      invoice_date: input.invoice_date || null,
      subtotal_sar: totals.subtotal_sar,
      vat_sar: totals.vat_sar,
      discount_sar: totals.discount_sar,
      grand_total_sar: totals.grand_total_sar,
      note: input.note?.trim() || null,
      created_by: await actorEmail(supabase),
    })
    .select(PAYMENT_COLUMNS)
    .single();
  if (error) return { error: error.message };

  revalidatePath("/maintenance");
  return { error: null, payment: data as WorkshopPayment };
}

// Plain update — no invariant beyond the DB's own CHECK, same reasoning
// addWorkshopPayment already has. VAT/discount recomputed the same way.
export async function updateWorkshopPayment(
  paymentId: string,
  input: AddWorkshopPaymentInput,
): Promise<{ error: string | null; payment?: WorkshopPayment }> {
  if (!paymentId) return { error: "Payment is required." };
  if (!input.repairer_id) return { error: "Repairer is required." };
  if (!(input.subtotal_sar >= 0)) return { error: "Subtotal cannot be negative." };
  if (!(input.discount_sar >= 0)) return { error: "Discount cannot be negative." };

  const totals = computeWorkshopPaymentTotals(input.subtotal_sar, input.discount_sar);
  if (totals.grand_total_sar < 0) {
    return { error: "Discount cannot exceed subtotal + VAT." };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from("workshop_payments")
    .update({
      repairer_id: input.repairer_id,
      invoice_number: input.invoice_number?.trim() || null,
      invoice_date: input.invoice_date || null,
      subtotal_sar: totals.subtotal_sar,
      vat_sar: totals.vat_sar,
      discount_sar: totals.discount_sar,
      grand_total_sar: totals.grand_total_sar,
      note: input.note?.trim() || null,
    })
    .eq("id", paymentId)
    .select(PAYMENT_COLUMNS)
    .single();
  if (error) return { error: error.message };

  revalidatePath("/maintenance");
  return { error: null, payment: data as WorkshopPayment };
}

// Hard delete — same as removing a photo/invoice file elsewhere in this
// app: no invariant protects a workshop_payments row (nothing sums it
// except the display-time reduce over whatever rows currently exist), and
// its own files cascade-delete in the DB. Storage cleanup for those files
// happens here explicitly first, same "fetch paths before the row is gone"
// convention removeWorkOrderPartPhoto/removeWorkshopPaymentFile already use.
export async function deleteWorkshopPayment(paymentId: string): Promise<{ error: string | null }> {
  if (!paymentId) return { error: "Payment is required." };

  const supabase = createClient();

  const { data: files } = await supabase
    .from("workshop_payment_files")
    .select("storage_path")
    .eq("payment_id", paymentId);

  const { error } = await supabase.from("workshop_payments").delete().eq("id", paymentId);
  if (error) return { error: error.message };

  if (files && files.length > 0) {
    await supabase.storage.from(INVOICE_BUCKET).remove(files.map((f) => f.storage_path));
  }

  revalidatePath("/maintenance");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Workshop payment invoice files — same shape/convention as
// work_order_part_photos (0067): upload to Storage first under an
// app-generated key, then insert the pointer row.
// ---------------------------------------------------------------------------

const INVOICE_BUCKET = "outsourced-invoices";
const MAX_INVOICE_BYTES = 5 * 1024 * 1024; // 5 MB — a scanned/photo invoice, more headroom than a 2 MB part photo

export async function uploadWorkshopPaymentFile(
  formData: FormData,
): Promise<{ error: string | null; file?: WorkshopPaymentFile }> {
  const paymentId = String(formData.get("paymentId") ?? "").trim();
  const file = formData.get("file");

  if (!paymentId) return { error: "Workshop payment is required." };
  if (!(file instanceof File) || file.size === 0) return { error: "Invoice file is required." };
  if (file.size > MAX_INVOICE_BYTES) return { error: "Invoice file too large (max 5 MB)." };

  const supabase = createClient();

  const extMatch = /\.([a-zA-Z0-9]{1,10})$/.exec(file.name);
  const ext = extMatch ? extMatch[1].toLowerCase() : "bin";
  const path = `${paymentId}/invoice-${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabase.storage.from(INVOICE_BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (uploadErr) return { error: `Invoice upload failed: ${uploadErr.message}` };

  const { data, error } = await supabase
    .from("workshop_payment_files")
    .insert({
      payment_id: paymentId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
    })
    .select("id, payment_id, storage_path, file_name, mime_type, uploaded_at")
    .single();
  if (error) {
    await supabase.storage.from(INVOICE_BUCKET).remove([path]);
    return { error: error.message };
  }

  revalidatePath("/maintenance");
  return { error: null, file: data as WorkshopPaymentFile };
}

export async function removeWorkshopPaymentFile(fileId: string): Promise<{ error: string | null }> {
  if (!fileId) return { error: "File is required." };

  const supabase = createClient();

  const { data: file, error: fetchErr } = await supabase
    .from("workshop_payment_files")
    .select("storage_path")
    .eq("id", fileId)
    .single();
  if (fetchErr || !file) return { error: fetchErr?.message ?? "File not found." };

  const { error: deleteErr } = await supabase.from("workshop_payment_files").delete().eq("id", fileId);
  if (deleteErr) return { error: deleteErr.message };

  await supabase.storage.from(INVOICE_BUCKET).remove([file.storage_path]);

  revalidatePath("/maintenance");
  return { error: null };
}

export async function getWorkshopPaymentFileSignedUrls(
  paths: string[],
): Promise<{ error: string | null; urls?: Record<string, string> }> {
  if (paths.length === 0) return { error: null, urls: {} };

  const supabase = createClient();
  const { data, error } = await supabase.storage.from(INVOICE_BUCKET).createSignedUrls(paths, 300);
  if (error || !data) return { error: error?.message ?? "Could not generate invoice links." };

  const urls: Record<string, string> = {};
  for (const item of data) {
    if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
  }
  return { error: null, urls };
}

// ---------------------------------------------------------------------------
// deleteOutsourcedJob — Polish P2 item 1 (migration 0081).
// delete_outsourced_job is the real gate: RAISEs unless status='scheduled',
// RAISEs "Remove all workshop payments before deleting this job." if any
// workshop_payments row exists for it. No storage cleanup needed here —
// a deletable job structurally has zero payments (the guard above), and
// workshop_payment_files FKs to workshop_payments, not this job directly.
// ---------------------------------------------------------------------------
export async function deleteOutsourcedJob(jobId: string): Promise<{ error: string | null }> {
  if (!jobId) return { error: "Outsourced job is required." };

  const supabase = createClient();
  const { error } = await supabase.rpc("delete_outsourced_job", {
    p_job_id: jobId,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: friendlyOsError(error.message) };

  revalidatePath("/maintenance");
  return { error: null };
}
