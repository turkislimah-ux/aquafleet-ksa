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
import { APPROVAL_SUBJECT_COLUMN, type ApprovalKind } from "@/lib/consumption-approvals";
import { t, type Lang } from "@/lib/i18n";

const BUCKET = "exit-permits";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function actorEmail(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.email ?? null;
}

// PostgREST surfaces a RAISE as a message string. These RPCs raise sentences
// meant to be read (0093 wrote them that way deliberately), so they are
// passed through rather than replaced with a generic apology.
//
// PASSED THROUGH MEANS PASSED THROUGH IN ENGLISH — those sentences live in the
// migrations, and an Arabic reader gets them as written. Translating them needs
// an error-code contract between plpgsql and this file, which is a schema
// change, not a copy fix (see the note on `consumption.errors`). Only the
// no-message fallback is ours, so only it is translated.
function rpcError(e: { message?: string } | null, lang: Lang): string {
  return e?.message ?? t("consumption.errors.rpcFallback", lang);
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
//
// This is the FORM-LEVEL guard: it fires on submit and prints as one banner at
// the top of the permit modal, which is why it needs `lang` even though the
// per-field labels above it were translated long ago.
function validateHeader(input: ExitPermitHeaderInput, lang: Lang): string | null {
  if (!input.warehouse_id) return t("consumption.errors.warehouseRequired", lang);
  if (input.kind === "returnable" && !input.expected_return_on) {
    return t("consumption.errors.returnableNeedsDate", lang);
  }
  if (input.kind === "permanent" && input.expected_return_on) {
    return t("consumption.errors.permanentNoDate", lang);
  }
  const ids = [
    input.destination_water_station_id, input.destination_project_id,
    input.destination_truck_id, input.destination_customer_id,
  ];
  if (input.destination_kind === "other") {
    if (!input.destination_other_text?.trim()) return t("consumption.errors.describeDestination", lang);
    if (ids.some(Boolean)) return t("consumption.errors.otherDestNoRecord", lang);
  } else if (ids.filter(Boolean).length !== 1) {
    return t("consumption.errors.oneDestination", lang);
  }
  const hasStaff = !!input.receiver_staff_id;
  const hasName = !!input.receiver_name?.trim();
  if (hasStaff === hasName) return t("consumption.errors.receiverRequired", lang);
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
  lang: Lang,
): Promise<{ error: string | null; permit?: ExitPermit }> {
  const bad = validateHeader(input, lang);
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
  lang: Lang,
): Promise<{ error: string | null }> {
  if (!permitId) return { error: t("consumption.errors.permitRequired", lang) };
  const bad = validateHeader(input, lang);
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
    return { error: t("consumption.errors.noLongerDraft", lang) };
  }

  revalidatePath("/consumption");
  return { error: null };
}

export async function deleteExitPermitDraft(
  permitId: string,
  lang: Lang,
): Promise<{ error: string | null }> {
  if (!permitId) return { error: t("consumption.errors.permitRequired", lang) };

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
    return { error: t("consumption.errors.onlyDraftDeletable", lang) };
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
  lang: Lang,
): Promise<string | null> {
  const { data } = await supabase
    .from("exit_permits")
    .select("status")
    .eq("id", permitId)
    .single();
  if (!data) return t("consumption.errors.permitNotFound", lang);
  if (data.status !== "draft") return t("consumption.errors.itemsDraftOnly", lang);
  return null;
}

export async function addExitPermitLine(
  permitId: string,
  partId: string,
  qty: number,
  note: string | null,
  lang: Lang,
): Promise<{ error: string | null }> {
  if (!permitId || !partId) return { error: t("consumption.errors.permitAndPartRequired", lang) };
  if (!Number.isFinite(qty) || qty <= 0) return { error: t("consumption.errors.qtyPositive", lang) };

  const supabase = createClient();
  const bad = await assertDraft(supabase, permitId, lang);
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
  lang: Lang,
): Promise<{ error: string | null }> {
  if (!Number.isFinite(qty) || qty <= 0) return { error: t("consumption.errors.qtyPositive", lang) };

  const supabase = createClient();
  const bad = await assertDraft(supabase, permitId, lang);
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
  lang: Lang,
): Promise<{ error: string | null }> {
  const supabase = createClient();
  const bad = await assertDraft(supabase, permitId, lang);
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

export async function confirmExitPermit(
  permitId: string,
  lang: Lang,
): Promise<{ error: string | null }> {
  if (!permitId) return { error: t("consumption.errors.permitRequired", lang) };
  const supabase = createClient();
  const { error } = await supabase.rpc("confirm_exit_permit", {
    p_permit_id: permitId,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: rpcError(error, lang) };

  revalidatePath("/consumption");
  revalidatePath("/inventory");
  return { error: null };
}

export async function recordExitPermitReturn(
  permitId: string,
  lines: { line_id: string; qty: number }[],
  returnedOn: string,
  note: string | null,
  lang: Lang,
): Promise<{ error: string | null }> {
  if (!permitId) return { error: t("consumption.errors.permitRequired", lang) };
  const usable = lines.filter((l) => Number.isFinite(l.qty) && l.qty > 0);
  if (usable.length === 0) return { error: t("consumption.errors.returnNeedsQty", lang) };

  const supabase = createClient();
  const { error } = await supabase.rpc("record_exit_permit_return", {
    p_permit_id: permitId,
    p_lines: usable,
    p_returned_on: returnedOn || null,
    p_note: note?.trim() || null,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: rpcError(error, lang) };

  revalidatePath("/consumption");
  revalidatePath("/inventory");
  return { error: null };
}

export async function voidExitPermit(
  permitId: string,
  reason: string | null,
  lang: Lang,
): Promise<{ error: string | null }> {
  if (!permitId) return { error: t("consumption.errors.permitRequired", lang) };
  const supabase = createClient();
  const { error } = await supabase.rpc("void_exit_permit", {
    p_permit_id: permitId,
    p_reason: reason?.trim() || null,
    p_actor: await actorEmail(supabase),
  });
  if (error) return { error: rpcError(error, lang) };

  revalidatePath("/consumption");
  revalidatePath("/inventory");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Attachments — same shape as the archive's file path.
// ---------------------------------------------------------------------------

export async function uploadExitPermitFile(
  formData: FormData,
  lang: Lang,
): Promise<{ error: string | null; file?: ExitPermitFile }> {
  const permitId = String(formData.get("permitId") ?? "").trim();
  const file = formData.get("file");
  if (!permitId) return { error: t("consumption.errors.permitRequired", lang) };
  if (!(file instanceof File) || file.size === 0) return { error: t("consumption.errors.chooseFile", lang) };
  if (file.size > MAX_FILE_BYTES) return { error: t("consumption.errors.fileTooLarge", lang) };

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

// ---------------------------------------------------------------------------
// APPROVALS (migration 0094) — Phase 2.
//
// READ THIS BEFORE EDITING. This action writes exactly ONE table:
// consumption_approvals. It does not update the permit, the work order or the
// outsourced job; it does not call an RPC; it does not touch parts,
// price_lots or stock_movements. The database has no mechanism to do any of
// that from here (0094 creates no function and no trigger), and this file must
// not become that mechanism. A rejection is INFORMATION — the parts already
// left, the job already happened. Reversing a permit is void_exit_permit's
// job, deliberately kept a separate, explicit action.
//
// The only other statements below are SELECTs used to check the subject is
// eligible before recording an opinion about it.
// ---------------------------------------------------------------------------

// Kind and its FK column both come from lib/consumption-approvals — ONE
// definition shared with the derive, so the tab and this action can never
// disagree about which column carries which subject. A local copy lived here
// briefly and was byte-identical, which is exactly how the two drift later.
type ApprovalKindArg = ApprovalKind;
const SUBJECT_COLUMN = APPROVAL_SUBJECT_COLUMN;

// Mirrors the tab's own inclusion rules server-side, so a stray call cannot
// record a decision about something the queue would never have offered — e.g.
// a draft permit, or a work order that consumed nothing.
async function subjectIsEligible(
  supabase: ReturnType<typeof createClient>,
  kind: ApprovalKindArg,
  subjectId: string,
  lang: Lang,
): Promise<string | null> {
  if (kind === "exit_permit") {
    const { data } = await supabase
      .from("exit_permits").select("status").eq("id", subjectId).maybeSingle();
    if (!data) return t("consumption.errors.permitGone", lang);
    if (data.status !== "exited") return t("consumption.errors.permitMustHaveExited", lang);
    return null;
  }
  if (kind === "work_order") {
    const { data } = await supabase
      .from("work_orders").select("status").eq("id", subjectId).maybeSingle();
    if (!data) return t("consumption.errors.workOrderGone", lang);
    if (data.status !== "completed") return t("consumption.errors.workOrderMustBeCompleted", lang);
    const { count } = await supabase
      .from("work_order_parts")
      .select("id", { count: "exact", head: true })
      .eq("work_order_id", subjectId);
    if (!count) return t("consumption.errors.workOrderNoParts", lang);
    return null;
  }
  const { data } = await supabase
    .from("outsourced_jobs").select("id").eq("id", subjectId).maybeSingle();
  if (!data) return t("consumption.errors.outsourcedJobGone", lang);
  const { count } = await supabase
    .from("workshop_payments")
    .select("id", { count: "exact", head: true })
    .eq("outsourced_job_id", subjectId);
  if (!count) return t("consumption.errors.outsourcedJobNoPayment", lang);
  return null;
}

export async function decideConsumptionApproval(
  kind: ApprovalKindArg,
  subjectId: string,
  decision: "approved" | "rejected",
  reason: string | null,
  lang: Lang,
): Promise<{ error: string | null }> {
  if (!subjectId) return { error: t("consumption.errors.nothingSelected", lang) };
  if (!(kind in SUBJECT_COLUMN)) return { error: t("consumption.errors.unknownApprovalKind", lang) };
  if (decision !== "approved" && decision !== "rejected") {
    return { error: t("consumption.errors.decisionInvalid", lang) };
  }
  const trimmed = reason?.trim() || null;
  // Enforced here, not only in the form: a rejection nobody explained is a
  // dead end for whoever reads it later. Approval stays free of the demand —
  // "yes, as expected" needs no essay.
  if (decision === "rejected" && !trimmed) {
    return { error: t("consumption.errors.rejectionNeedsReason", lang) };
  }

  const supabase = createClient();
  const column = SUBJECT_COLUMN[kind];
  const actor = await actorEmail(supabase);
  // decided_by is NOT NULL as of 0095 — the approver is part of the key now,
  // so an unattributable decision is refused here rather than at the database
  // with a 23502 nobody can read.
  if (!actor) return { error: t("consumption.errors.signInAgain", lang) };

  const bad = await subjectIsEligible(supabase, kind, subjectId, lang);
  if (bad) return { error: bad };

  // ONE ROW PER (EVENT, PERSON) — 0095's key. A person CHANGES their own
  // decision; they never add a second one, so two approvals always mean two
  // people. supabase-js cannot express a partial-index conflict target for
  // upsert, so this reads first and branches; the index is still the real
  // guarantee — a race loses on 23505 rather than inflating the count.
  const { data: existing } = await supabase
    .from("consumption_approvals")
    .select("id")
    .eq(column, subjectId)
    .eq("decided_by", actor)
    .maybeSingle();

  if (existing) {
    // decided_at moves; created_at deliberately does not — it keeps saying
    // when THIS PERSON first ruled on the event.
    const { error } = await supabase
      .from("consumption_approvals")
      .update({
        decision,
        reason: trimmed,
        decided_by: actor,
        decided_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("consumption_approvals").insert({
      [column]: subjectId,
      decision,
      reason: trimmed,
      decided_by: actor,
    });
    if (error) return { error: error.message };
  }

  revalidatePath("/consumption");
  return { error: null };
}
