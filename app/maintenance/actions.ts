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
import type { RepairDescription, WorkOrder, WorkOrderTask } from "@/lib/db-types";

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
  mechanic_staff_id: string;
  task_description_ids: string[];
  lines: CreateWorkOrderLine[];
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
  return message;
}

export async function createWorkOrder(
  input: CreateWorkOrderInput,
): Promise<{ error: string | null; workOrder?: WorkOrder }> {
  if (!input.truck_id) return { error: "Truck is required." };
  if (!input.type) return { error: "Type is required." };
  if (!input.priority) return { error: "Priority is required." };
  if (!input.due_by) return { error: "Due date is required." };
  if (!input.mechanic_staff_id) return { error: "Mechanic is required." };
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
    p_mechanic_staff_id: input.mechanic_staff_id,
    p_task_description_ids: input.task_description_ids ?? [],
    p_lines: input.lines ?? [],
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
