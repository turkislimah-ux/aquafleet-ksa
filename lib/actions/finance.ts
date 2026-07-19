"use server";

// Finance Commit 2 — prepaid top-up recording. Minimal write-side surface;
// the derived-balance/statement READ side is pure (lib/prepaid.ts) and
// computed client-side from already-fetched trips/projects/topups (see
// app/trips/CustomersTab.tsx), mirroring the existing revenue-KPI pattern.
//
// Add Balance restructure (Batch B, migration 0040) — brings this in line
// with invoice payment (app/trips/invoiceActions.ts's markInvoicePaid):
// FormData instead of a plain object, so a proof photo can ride along.
// bank_transfer requires an ETF ref. number AND a photo (same reasoning
// pay_invoice() applies to invoice proof-of-payment).
//
// Batch B follow-up: cash is NOT stripped of ref/photo anymore — cash can be
// bank-deposited too (ETF ref + slip may exist), so both fields are simply
// optional for cash and kept as-entered. Only bank_transfer enforces them as
// required. Storage key is app-generated (topup-proofs bucket, 0040) — never
// the raw filename — for either method, whenever a file is actually provided.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { error: string | null; data?: T };

const PHOTO_BUCKET = "topup-proofs";

export async function recordTopup(formData: FormData): Promise<ActionResult> {
  const supabase = createClient();

  const customerId = String(formData.get("customerId") ?? "");
  const amountSar = Number(formData.get("amountSar"));
  const topupDate = String(formData.get("topupDate") ?? "").trim();
  const method = String(formData.get("method") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const file = formData.get("photoFile");

  if (!customerId) return { error: "Missing customer." };
  if (!Number.isFinite(amountSar) || amountSar <= 0) {
    return { error: "Add Balance amount must be a positive number." };
  }
  if (!topupDate) return { error: "Add Balance date is required." };
  if (method !== "cash" && method !== "bank_transfer") {
    return { error: "Method must be cash or bank transfer." };
  }

  if (method === "bank_transfer") {
    if (!reference) return { error: "Bank transfer requires an ETF Ref. number." };
    if (!(file instanceof File) || file.size === 0) {
      return { error: "Bank transfer requires a photo of the transfer." };
    }
  }
  // cash: reference/photo both optional — carried through as-entered below,
  // not required, not nulled. Same fields, just not mandatory.

  let photoPath: string | null = null;
  if (file instanceof File && file.size > 0) {
    const extMatch = /\.([a-zA-Z0-9]{1,10})$/.exec(file.name);
    const ext = extMatch ? extMatch[1].toLowerCase() : "bin";
    photoPath = `${customerId}/topup-${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from(PHOTO_BUCKET).upload(photoPath, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (uploadErr) return { error: `Photo upload failed: ${uploadErr.message}` };
  }

  // entered_by is the authenticated user's email — same pattern as
  // commission_periods.approved_by (app/drivers/actions.ts), not a free-text
  // form field.
  const { data: auth } = await supabase.auth.getUser();

  const { error } = await supabase.from("customer_topups").insert({
    customer_id: customerId,
    amount_sar: amountSar,
    topup_date: topupDate,
    method,
    note,
    reference,
    photo_path: photoPath,
    entered_by: auth?.user?.email ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/trips");
  return { error: null };
}

// topup-proofs is a PRIVATE Storage bucket (0040) — photo_path can only be
// viewed via a short-lived signed URL, never a public link. Mirrors
// invoiceActions.ts's getProofSignedUrl exactly.
export async function getTopupProofSignedUrl(topupId: string): Promise<ActionResult<{ url: string }>> {
  const supabase = createClient();
  const { data: topup, error: topupErr } = await supabase
    .from("customer_topups")
    .select("photo_path")
    .eq("id", topupId)
    .single();
  if (topupErr || !topup) return { error: topupErr?.message ?? "Balance addition not found." };
  if (!topup.photo_path) return { error: "No photo on file for this entry." };

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(topup.photo_path, 300);
  if (error || !data) return { error: error?.message ?? "Could not generate a link to the photo." };
  return { error: null, data: { url: data.signedUrl } };
}
