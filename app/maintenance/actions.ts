"use server";

// Maintenance — Phase 1 server actions. Mirrors app/inventory/actions.ts's
// own "use server" + Supabase RPC pattern (createPurchaseOrder is the closest
// analog: validate client-side for a fast error, call the RPC which is the
// real, authoritative gate, revalidate the page).
//
// create_work_order (migration 0060) is RESERVE-ONLY — it does not touch
// stock. The out-of-stock hard block on the server is per-line qty vs.
// parts.qty_on_hand at save time; this file does not duplicate that check
// (it's the RPC's job, same "server is the source of truth" convention as
// every other Inventory RPC), it only surfaces the RPC's error message
// plainly. The New Work Order UI (NewWorkOrderModal.tsx) independently
// prevents selecting an out-of-stock part / an over-qty in the picker
// itself, per Turki's explicit ask — that's a UX affordance, not a
// substitute for this server-side gate.

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { RepairDescription, WorkOrder, WorkOrderTask, WorkOrderPartPhoto } from "@/lib/db-types";

async function actorEmail(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.email ?? null;
}

export type CreateWorkOrderLine = { part_id: string; qty: number };

export type CreateWorkOrderInput = {
  truck_id: string;
  type: string;
  priority: string;
  due_by: string; // ISO date (yyyy-mm-dd) or datetime
  // Added by migration 0073 — calendar placement parity with
  // outsourced_jobs.start_date. due_by is unchanged and still drives
  // in-house overdue.
  start_date: string;
  mechanic_staff_id: string;
  task_description_ids: string[];
  lines: CreateWorkOrderLine[];
  // Added by migration 0063 (labor costing) — real per-WO input now,
  // no longer a hardcoded constant. Server defaults to 4 if omitted.
  labor_hours?: number;
  // Polish item 1 (manual title, no migration) — optional, one field, the
  // user types in Arabic OR English. create_work_order itself is
  // UNTOUCHED (still sets title=title_ar=wo_number) — if this is set,
  // createWorkOrder() below does one plain follow-up update mirroring it
  // into both title and title_ar right after the RPC succeeds. Blank ->
  // the RPC's own number-as-title stands.
  title?: string;
};

function friendlyWoError(message: string): string {
  if (message.includes("has only") && message.includes("on hand")) {
    // create_work_order's own message is already specific/plain — pass it
    // through as-is, just without the SQL noise if any ever leaks in.
    return message;
  }
  if (message.includes("Mechanic not found")) {
    return "Selected mechanic is no longer eligible. Pick another mechanic.";
  }
  if (message.includes("no monthly salary set")) {
    // Already plain/actionable from the RPC — pass through as-is.
    return message;
  }
  return message;
}

export async function createWorkOrder(
  input: CreateWorkOrderInput,
): Promise<{ error: string | null; workOrder?: WorkOrder }> {
  if (!input.truck_id) return { error: "Truck is required." };
  if (!input.type) return { error: "Type is required." };
  if (!input.priority) return { error: "Priority is required." };
  if (!input.due_by) return { error: "Due date is required." };
  if (!input.start_date) return { error: "Start date is required." };
  if (!input.mechanic_staff_id) return { error: "Mechanic is required." };
  if (input.labor_hours != null && !(input.labor_hours > 0)) {
    return { error: "Labor hours must be positive." };
  }
  for (const l of input.lines ?? []) {
    if (!l?.part_id) return { error: "Line item is missing a part." };
    if (!(l.qty > 0)) return { error: "Line item quantity must be positive." };
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_work_order", {
    p_truck_id: input.truck_id,
    p_type: input.type,
    p_priority: input.priority,
    p_due_by: input.due_by,
    p_start_date: input.start_date,
    p_mechanic_staff_id: input.mechanic_staff_id,
    p_task_description_ids: input.task_description_ids ?? [],
    p_lines: input.lines ?? [],
    p_labor_hours: input.labor_hours ?? 4,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: friendlyWoError(error.message) };

  let workOrder = data as WorkOrder;

  // Polish item 1 — plain follow-up write, no RPC. create_work_order
  // itself is untouched (still sets title=title_ar=wo_number); if the
  // user typed a title, mirror it into both columns right here. Best-
  // effort: if this second write fails for any reason, the WO still
  // exists with its number-as-title fallback — never blocks creation.
  const typedTitle = input.title?.trim();
  if (typedTitle) {
    const { data: retitled } = await supabase
      .from("work_orders")
      .update({ title: typedTitle, title_ar: typedTitle })
      .eq("id", workOrder.id)
      .select("*")
      .single();
    if (retitled) workOrder = retitled as WorkOrder;
  }

  revalidatePath("/maintenance");
  return { error: null, workOrder };
}

// ---------------------------------------------------------------------------
// saveWorkOrderTitle — Polish item 1. Plain write, NO RPC (same pattern
// photos/repairers already use). Called from NewWorkOrderModal's own
// edit-save flow, which is only reachable while the job isn't completed —
// "editable until completed" falls out of that existing gate for free.
// This action itself doesn't re-check status. One field, mirrored into
// both title and title_ar.
// ---------------------------------------------------------------------------
export async function saveWorkOrderTitle(
  woId: string,
  title: string,
): Promise<{ error: string | null; workOrder?: WorkOrder }> {
  if (!woId) return { error: "Work order is required." };
  const t = title.trim();
  if (!t) return { error: "Title is required." };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("work_orders")
    .update({ title: t, title_ar: t })
    .eq("id", woId)
    .select("*")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/maintenance");
  return { error: null, workOrder: data as WorkOrder };
}

// ---------------------------------------------------------------------------
// edit_work_order (migration 0065) — editable while status is 'open' or
// 'in_progress'/'awaiting_parts'. Same "server RPC is the real gate" split:
// this file never touches parts/price_lots/stock_movements/
// work_order_part_consumptions directly. All reversal accuracy lives in
// return_to_lots/consume_work_order_line inside the RPC.
// ---------------------------------------------------------------------------

export type EditWorkOrderInput = {
  wo_id: string;
  type: string;
  priority: string;
  due_by: string;
  start_date: string;
  mechanic_staff_id: string;
  task_description_ids: string[];
  lines: CreateWorkOrderLine[];
  labor_hours: number;
};

export async function editWorkOrder(
  input: EditWorkOrderInput,
): Promise<{ error: string | null; workOrder?: WorkOrder }> {
  if (!input.wo_id) return { error: "Work order is required." };
  if (!input.type) return { error: "Type is required." };
  if (!input.priority) return { error: "Priority is required." };
  if (!input.due_by) return { error: "Due date is required." };
  if (!input.start_date) return { error: "Start date is required." };
  if (!input.mechanic_staff_id) return { error: "Mechanic is required." };
  if (!(input.labor_hours > 0)) return { error: "Labor hours must be positive." };
  for (const l of input.lines ?? []) {
    if (!l?.part_id) return { error: "Line item is missing a part." };
    if (!(l.qty > 0)) return { error: "Line item quantity must be positive." };
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("edit_work_order", {
    p_wo_id: input.wo_id,
    p_type: input.type,
    p_priority: input.priority,
    p_due_by: input.due_by,
    p_start_date: input.start_date,
    p_mechanic_staff_id: input.mechanic_staff_id,
    p_task_description_ids: input.task_description_ids ?? [],
    p_lines: input.lines ?? [],
    p_labor_hours: input.labor_hours,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: friendlyWoError(error.message) };

  revalidatePath("/maintenance");
  return { error: null, workOrder: data as WorkOrder };
}

// Inline "+ add description" — mirrors units'/suppliers' inline-create
// pattern (plain insert, no RPC needed, repair_descriptions has no
// invariant to protect). Case-insensitive dedupe against the English text,
// same courtesy createSupplier already gives (return the existing row
// instead of creating a near-duplicate).
export async function addRepairDescription(
  en: string,
  ar: string,
): Promise<{ error: string | null; description?: RepairDescription }> {
  const enTrim = en?.trim() ?? "";
  const arTrim = ar?.trim() ?? "";
  if (!enTrim) return { error: "Description text is required." };

  const supabase = createClient();

  const { data: existing } = await supabase
    .from("repair_descriptions")
    .select("id, en, ar, active, created_at")
    .eq("active", true)
    .ilike("en", enTrim)
    .maybeSingle();
  if (existing) return { error: null, description: existing as RepairDescription };

  const { data, error } = await supabase
    .from("repair_descriptions")
    .insert({ en: enTrim, ar: arTrim || enTrim })
    .select("id, en, ar, active, created_at")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/maintenance");
  return { error: null, description: data as RepairDescription };
}

// ---------------------------------------------------------------------------
// Phase 2 — lifecycle (migration 0061). start_work_order/complete_work_order
// route ALL stock deduction through consume_from_lots (the sole stock
// writer) via the private deduct_work_order_parts() helper — this file never
// touches parts/price_lots/stock_movements directly, same "server RPC is
// the real gate" split as create_work_order above. No truck-status handling
// anywhere in this phase (Turki's call — that's a separate, later,
// cross-module build).
// ---------------------------------------------------------------------------

// Both messages below are already plain/specific from the RPC itself
// (consume_from_lots' own "Not enough stock on hand: have X, requested Y."
// surfacing through deduct_work_order_parts, or start_work_order's own
// status guard) — passed through as-is, same convention as
// friendlyWoError above.
function friendlyLifecycleError(message: string): string {
  return message;
}

export async function startWorkOrder(
  woId: string,
): Promise<{ error: string | null; workOrder?: WorkOrder }> {
  if (!woId) return { error: "Work order is required." };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("start_work_order", {
    p_wo_id: woId,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: friendlyLifecycleError(error.message) };

  revalidatePath("/maintenance");
  return { error: null, workOrder: data as WorkOrder };
}

export async function completeWorkOrder(
  woId: string,
): Promise<{ error: string | null; workOrder?: WorkOrder }> {
  if (!woId) return { error: "Work order is required." };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("complete_work_order", {
    p_wo_id: woId,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: friendlyLifecycleError(error.message) };

  revalidatePath("/maintenance");
  return { error: null, workOrder: data as WorkOrder };
}

export async function toggleWorkOrderTask(
  taskId: string,
  done: boolean,
): Promise<{ error: string | null; task?: WorkOrderTask }> {
  if (!taskId) return { error: "Task is required." };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("toggle_work_order_task", {
    p_task_id: taskId,
    p_done: done,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: friendlyLifecycleError(error.message) };

  revalidatePath("/maintenance");
  return { error: null, task: data as WorkOrderTask };
}

export async function saveWorkOrderNotes(
  woId: string,
  notes: string,
): Promise<{ error: string | null; workOrder?: WorkOrder }> {
  if (!woId) return { error: "Work order is required." };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("save_work_order_notes", {
    p_wo_id: woId,
    p_notes: notes,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: friendlyLifecycleError(error.message) };

  revalidatePath("/maintenance");
  return { error: null, workOrder: data as WorkOrder };
}

// ---------------------------------------------------------------------------
// Phase 3 — part photos (migration 0067). Plain table + private Storage
// bucket, no RPC (no invariant to protect — same reasoning as 0043's
// warehouses/parts having no RPCs at all). Mirrors receiveLooseParts'
// upload-then-insert pattern in app/inventory/actions.ts: bytes go to
// Storage FIRST under an app-generated key, never the raw filename, then
// the pointer row is inserted. Count (4) and size (2 MB) limits enforced
// here — the RPC-less equivalent of every other server-side "real gate"
// in this app; the modal's own client-side checks are the UX affordance,
// not a substitute for these.
// ---------------------------------------------------------------------------

const PHOTO_BUCKET = "maintenance-photos";
const MAX_PHOTOS_PER_LINE = 4;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB, matches preview's own cap

export async function uploadWorkOrderPartPhoto(
  formData: FormData,
): Promise<{ error: string | null; photo?: WorkOrderPartPhoto }> {
  const workOrderPartId = String(formData.get("workOrderPartId") ?? "").trim();
  const file = formData.get("file");

  if (!workOrderPartId) return { error: "Work order part line is required." };
  if (!(file instanceof File) || file.size === 0) return { error: "Photo file is required." };
  if (file.size > MAX_PHOTO_BYTES) return { error: "Photo too large (max 2 MB)." };

  const supabase = createClient();

  const { count, error: countErr } = await supabase
    .from("work_order_part_photos")
    .select("id", { count: "exact", head: true })
    .eq("work_order_part_id", workOrderPartId);
  if (countErr) return { error: countErr.message };
  if ((count ?? 0) >= MAX_PHOTOS_PER_LINE) return { error: "Maximum 4 photos per part." };

  const extMatch = /\.([a-zA-Z0-9]{1,10})$/.exec(file.name);
  const ext = extMatch ? extMatch[1].toLowerCase() : "bin";
  const path = `${workOrderPartId}/photo-${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (uploadErr) return { error: `Photo upload failed: ${uploadErr.message}` };

  const { data, error } = await supabase
    .from("work_order_part_photos")
    .insert({
      work_order_part_id: workOrderPartId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
    })
    .select("id, work_order_part_id, storage_path, file_name, mime_type, uploaded_at")
    .single();
  if (error) {
    // Best-effort cleanup — avoid an orphaned storage object for a row
    // that never landed.
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    return { error: error.message };
  }

  revalidatePath("/maintenance");
  return { error: null, photo: data as WorkOrderPartPhoto };
}

export async function removeWorkOrderPartPhoto(photoId: string): Promise<{ error: string | null }> {
  if (!photoId) return { error: "Photo is required." };

  const supabase = createClient();

  const { data: photo, error: fetchErr } = await supabase
    .from("work_order_part_photos")
    .select("storage_path")
    .eq("id", photoId)
    .single();
  if (fetchErr || !photo) return { error: fetchErr?.message ?? "Photo not found." };

  const { error: deleteErr } = await supabase.from("work_order_part_photos").delete().eq("id", photoId);
  if (deleteErr) return { error: deleteErr.message };

  // Storage cleanup after the row is gone — a leftover blob with no
  // pointer is harmless; a pointer to a deleted blob is not.
  await supabase.storage.from(PHOTO_BUCKET).remove([photo.storage_path]);

  revalidatePath("/maintenance");
  return { error: null };
}

// Signed URLs, same on-demand convention as
// getSpecialChargeImageSignedUrl (app/trips/invoiceActions.ts) — generated
// when the modal actually needs to show them, not batch-prefetched on page
// load (a private bucket's signed links are time-limited, 5 minutes here,
// same as that precedent).
export async function getWorkOrderPartPhotoSignedUrls(
  paths: string[],
): Promise<{ error: string | null; urls?: Record<string, string> }> {
  if (paths.length === 0) return { error: null, urls: {} };

  const supabase = createClient();
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 300);
  if (error || !data) return { error: error?.message ?? "Could not generate photo links." };

  const urls: Record<string, string> = {};
  for (const item of data) {
    if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
  }
  return { error: null, urls };
}

// ---------------------------------------------------------------------------
// deleteWorkOrder — Polish P2 item 1 (migration 0081). delete_work_order
// itself is the real gate (RAISEs unless status='open'); this wrapper's
// only extra responsibility is the storage side Postgres can't reach:
// every work_order_part_photos.storage_path belonging to this WO is read
// FIRST (the rows are about to cascade away with the row delete), then —
// only after the RPC actually succeeds — those objects are removed from
// the maintenance-photos bucket. Same "read pointers, delete row, then
// clean up storage" order removeWorkOrderPartPhoto() already uses.
// ---------------------------------------------------------------------------
export async function deleteWorkOrder(woId: string): Promise<{ error: string | null }> {
  if (!woId) return { error: "Work order is required." };

  const supabase = createClient();

  const { data: lines } = await supabase
    .from("work_order_parts")
    .select("id")
    .eq("work_order_id", woId);
  const lineIds = (lines ?? []).map((l) => l.id as string);

  let photoPaths: string[] = [];
  if (lineIds.length > 0) {
    const { data: photos } = await supabase
      .from("work_order_part_photos")
      .select("storage_path")
      .in("work_order_part_id", lineIds);
    photoPaths = (photos ?? []).map((p) => p.storage_path as string);
  }

  const { error } = await supabase.rpc("delete_work_order", {
    p_wo_id: woId,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: friendlyLifecycleError(error.message) };

  if (photoPaths.length > 0) {
    // Best-effort — the WO row is already gone either way; a leftover blob
    // with no pointer left behind is a minor cleanup gap, not a data bug.
    await supabase.storage.from(PHOTO_BUCKET).remove(photoPaths);
  }

  revalidatePath("/maintenance");
  return { error: null };
}
