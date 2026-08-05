"use server";

// Consumption — server actions for EXIT PERMITS (migration 0093).
//
// THE SPLIT THAT MATTERS, and why it is not arbitrary:
//
//   DRAFTS  -> plain single-table writes, every one gated on status='draft'.
//              A draft is paperwork: no stock has moved, no number is
//              claimed, so there is no invariant for an RPC to protect. The
//              status gate is in the WHERE clause of every write, so a
//              request that arrives late (after someone else confirmed the
//              permit) updates zero rows rather than editing history.
//
//   MONEY   -> the three orchestrator RPCs, and nothing else. Confirming an
//              exit, recording a return and voiding all move stock through
//              the FIFO helpers and keep the per-lot ledger in step. The
//              INTERNAL functions those RPCs call (consume_exit_permit_line,
//              return_exit_permit_line, next_ep_number) are revoked from
//              every app role — calling one directly would move stock with
//              no permit event around it, so this file could not call them
//              even if someone tried.

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { ExitPermit, ExitPermitFile } from "@/lib/db-types";

const BUCKET = "exit-permits";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function actorEmail(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.email ?? null;
}

// PostgREST surfaces a RAISE as a message string. These RPCs raise sentences
// meant to be read (0093 wrote them that way deliberately), so they are
// passed through rather than replaced with a generic apology.
function rpcError(e: { message?: string } | null): string {
  return e?.message ?? "Something went wrong.";
}

// ---------------------------------------------------------------------------
// Draft header
// ---------------------------------------------------------------------------

export type ExitPermitHeaderInput = {
  kind: "returnable" | "permanent";
  expected_return_on: string | null;
  warehouse_id: string;
  destination_kind: "water_station" | "project" | "truck" | "customer" | "other";
  destination_water_station_id: string | null;
  destination_project_id: string | null;
  destination_truck_id: string | null;
  destination_customer_id: string | null;
  destination_other_text: string | null;
  receiver_staff_id: string | null;
  receiver_name: string | null;
  carrier_name: string | null;
  note: string | null;
};

// Client-side mirrors of 0093's CHECK constraints, so a mistake reads as a
// sentence instead of a raw constraint violation. The DB stays the real gate.
function validateHeader(input: ExitPermitHeaderInput): string | null {
  if (!input.warehouse_id) return "Choose the warehouse the parts leave from.";
  if (input.kind === "returnable" && !input.expected_return_on) {
    return "A returnable permit needs an expected return date.";
  }
  if (input.kind === "permanent" && input.expected_return_on) {
    return "A permanent permit cannot carry a return date.";
  }
  const ids = [
    input.destination_water_station_id, input.destination_project_id,
    input.destination_truck_id, input.destination_customer_id,
  ];
  if (input.destination_kind === "other") {
    if (!input.destination_other_text?.trim()) return "Describe the destination.";
    if (ids.some(Boolean)) return "An 'other' destination cannot also point at a record.";
  } else if (ids.filter(Boolean).length !== 1) {
    return "Choose exactly one destination.";
  }
  const hasStaff = !!input.receiver_staff_id;
  const hasName = !!input.receiver_name?.trim();
  if (hasStaff === hasName) return "Give a receiver: either a staff member or a name.";
  return null;
}

function headerRow(input: ExitPermitHeaderInput) {
  return {
    kind: input.kind,
    expected_return_on: input.kind === "returnable" ? input.expected_return_on : null,
    warehouse_id: input.warehouse_id,
    destination_kind: input.destination_kind,
    destination_water_station_id: input.destination_water_station_id,
    destination_project_id: input.destination_project_id,
    destination_truck_id: input.destination_truck_id,
    destination_customer_id: input.destination_customer_id,
    destination_other_text: input.destination_other_text?.trim() || null,
    receiver_staff_id: input.receiver_staff_id,
    receiver_name: input.receiver_name?.trim() || null,
    carrier_name: input.carrier_name?.trim() || null,
    note: input.note?.trim() || null,
  };
}

export async function createExitPermitDraft(
  input: ExitPermitHeaderInput,
): Promise<{ error: string | null; permit?: ExitPermit }> {
  const bad = validateHeader(input);
  if (bad) return { error: bad };

  const supabase = createClient();
  const actor = await actorEmail(supabase);
  const { data, error } = await supabase
    .from("exit_permits")
    .insert({ ...headerRow(input), issued_by: actor, created_by: actor })
    .select("*")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/consumption");
  return { error: null, permit: data as ExitPermit };
}

export async function updateExitPermitDraft(
  permitId: string,
  input: ExitPermitHeaderInput,
): Promise<{ error: string | null }> {
  if (!permitId) return { error: "Permit is required." };
  const bad = validateHeader(input);
  if (bad) return { error: bad };

  const supabase = createClient();
  // .eq("status","draft") IS the guard — an exited permit's header is part of
  // a document that physically left, so it is not editable at all.
  const { data, error } = await supabase
    .from("exit_permits")
    .update(headerRow(input))
    .eq("id", permitId)
    .eq("status", "draft")
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "This permit is no longer a draft — it cannot be edited." };
  }

  revalidatePath("/consumption");
  return { error: null };
}

export async function deleteExitPermitDraft(permitId: string): Promise<{ error: string | null }> {
  if (!permitId) return { error: "Permit is required." };

  const supabase = createClient();

  // Storage first, while the file pointers are still readable — the rows are
  // about to cascade. Same order deleteArchiveGroup / deleteWorkOrder use.
  const { data: files } = await supabase
    .from("exit_permit_files")
    .select("storage_path")
    .eq("exit_permit_id", permitId);
  const paths = (files ?? []).map((f) => f.storage_path as string);

  const { data, error } = await supabase
    .from("exit_permits")
    .delete()
    .eq("id", permitId)
    .eq("status", "draft")
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Only a draft can be deleted. An exited permit is a record — void it instead." };
  }

  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);

  revalidatePath("/consumption");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Draft lines
// ---------------------------------------------------------------------------

async function assertDraft(
  supabase: ReturnType<typeof createClient>,
  permitId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("exit_permits")
    .select("status")
    .eq("id", permitId)
    .single();
  if (!data) return "Permit not found.";
  if (data.status !== "draft") return "Lines can only be changed while the permit is a draft.";
  return null;
}

export async function addExitPermitLine(
  permitId: string,
  partId: string,
  qty: number,
  note: string | null,
): Promise<{ error: string | null }> {
  if (!permitId || !partId) return { error: "Permit and part are required." };
  if (!Number.isFinite(qty) || qty <= 0) return { error: "Quantity must be more than zero." };

  const supabase = createClient();
  const bad = await assertDraft(supabase, permitId);
  if (bad) return { error: bad };

  const { error } = await supabase.from("exit_permit_lines").insert({
    exit_permit_id: permitId,
    part_id: partId,
    qty,
    note: note?.trim() || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/consumption");
  return { error: null };
}

export async function updateExitPermitLineQty(
  permitId: string,
  lineId: string,
  qty: number,
): Promise<{ error: string | null }> {
  if (!Number.isFinite(qty) || qty <= 0) return { error: "Quantity must be more than zero." };

  const supabase = createClient();
  const bad = await assertDraft(supabase, permitId);
  if (bad) return { error: bad };

  // qty ONLY. unit_price_sar and qty_returned are written by the RPCs alone —
  // this path must never touch either.
  const { error } = await supabase
    .from("exit_permit_lines")
    .update({ qty })
    .eq("id", lineId)
    .eq("exit_permit_id", permitId);
  if (error) return { error: error.message };

  revalidatePath("/consumption");
  return { error: null };
}

export async function removeExitPermitLine(
  permitId: string,
  lineId: string,
): Promise<{ error: string | null }> {
  const supabase = createClient();
  const bad = await assertDraft(supabase, permitId);
  if (bad) return { error: bad };

  const { error } = await supabase
    .from("exit_permit_lines")
    .delete()
    .eq("id", lineId)
    .eq("exit_permit_id", permitId);
  if (error) return { error: error.message };

  revalidatePath("/consumption");
  return { error: null };
}

// ---------------------------------------------------------------------------
// THE MONEY MOMENTS — the three orchestrator RPCs, nothing else.
// ---------------------------------------------------------------------------

export async function confirmExitPermit(permitId: string): Promise<{ error: string | null }> {
  if (!permitId) return { error: "Permit is required." };
  const supabase = createClient();
  const { error } = await supabase.rpc("confirm_exit_permit", {
    p_permit_id: permitId,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: rpcError(error) };

  revalidatePath("/consumption");
  revalidatePath("/inventory");
  return { error: null };
}

export async function recordExitPermitReturn(
  permitId: string,
  lines: { line_id: string; qty: number }[],
  returnedOn: string,
  note: string | null,
): Promise<{ error: string | null }> {
  if (!permitId) return { error: "Permit is required." };
  const usable = lines.filter((l) => Number.isFinite(l.qty) && l.qty > 0);
  if (usable.length === 0) return { error: "Enter a quantity for at least one line." };

  const supabase = createClient();
  const { error } = await supabase.rpc("record_exit_permit_return", {
    p_permit_id: permitId,
    p_lines: usable,
    p_returned_on: returnedOn || null,
    p_note: note?.trim() || null,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: rpcError(error) };

  revalidatePath("/consumption");
  revalidatePath("/inventory");
  return { error: null };
}

export async function voidExitPermit(
  permitId: string,
  reason: string | null,
): Promise<{ error: string | null }> {
  if (!permitId) return { error: "Permit is required." };
  const supabase = createClient();
  const { error } = await supabase.rpc("void_exit_permit", {
    p_permit_id: permitId,
    p_reason: reason?.trim() || null,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: rpcError(error) };

  revalidatePath("/consumption");
  revalidatePath("/inventory");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Attachments — same shape as the archive's file path.
// ---------------------------------------------------------------------------

export async function uploadExitPermitFile(
  formData: FormData,
): Promise<{ error: string | null; file?: ExitPermitFile }> {
  const permitId = String(formData.get("permitId") ?? "").trim();
  const file = formData.get("file");
  if (!permitId) return { error: "Permit is required." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file." };
  if (file.size > MAX_FILE_BYTES) return { error: "File is larger than 10 MB." };

  const supabase = createClient();
  const ext = file.name.includes(".") ? file.name.split(".").pop() : null;
  const path = `${permitId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (upErr) return { error: upErr.message };

  const { data, error } = await supabase
    .from("exit_permit_files")
    .insert({
      exit_permit_id: permitId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      uploaded_by: await actorEmail(supabase),
    })
    .select("*")
    .single();
  // Never leave a blob behind for a row that failed to land.
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    return { error: error.message };
  }

  revalidatePath("/consumption");
  return { error: null, file: data as ExitPermitFile };
}

export async function removeExitPermitFile(fileId: string): Promise<{ error: string | null }> {
  const supabase = createClient();
  const { data: row } = await supabase
    .from("exit_permit_files")
    .select("storage_path")
    .eq("id", fileId)
    .single();

  const { error } = await supabase.from("exit_permit_files").delete().eq("id", fileId);
  if (error) return { error: error.message };
  if (row?.storage_path) await supabase.storage.from(BUCKET).remove([row.storage_path]);

  revalidatePath("/consumption");
  return { error: null };
}

export async function getExitPermitFileUrls(
  paths: string[],
): Promise<{ error: string | null; urls?: Record<string, string> }> {
  if (paths.length === 0) return { error: null, urls: {} };
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 60 * 10);
  if (error) return { error: error.message };
  const urls: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) urls[row.path] = row.signedUrl;
  }
  return { error: null, urls };
}
