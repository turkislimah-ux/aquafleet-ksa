"use server";

// Finance — prepaid customer ledger write surface (0203).
//
// Every mutation here is an RPC call: record_topup / record_refund /
// propose_ledger_correction / vote_ledger_correction are SECURITY DEFINER
// functions and the ONLY writers of customer_ledger and ledger_corrections.
// No table in this file is read or written directly any more — the legacy
// customer_topups / customer_balance_returns readers left with the 0206 app
// cutover, and 0207 drops the tables.
//
// p_actor is always the signed-in user's email (never a form field); a blank
// actor is the RPC's problem — it raises 'Actor identity is required.' and we
// surface that verbatim, like every other RPC error in this file.
//
// Photo rules (0204 — now BOTH money doors, top-up and refund):
// bank_transfer requires an ETF ref. number AND a photo; cash keeps both
// optional-but-recorded. Storage key is app-generated (topup-proofs bucket,
// 0040) — never the raw filename.
//
// These checks are a COURTESY COPY of the rule, not the rule. 0204 enforces
// the same thing inside record_topup / record_refund / record_invoice_payment,
// so a bypassed or stale client still cannot write an unproven bank transfer.
// The copy exists only so the operator is told what is missing while she is
// still looking at the form, instead of meeting a raw Postgres error after
// submit. If the two ever disagree, the RPC wins and its message is what the
// user sees — every error below is surfaced verbatim.

import { MAX_PREPARED_FILE_BYTES, mbLabel } from "@/lib/upload-image";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { error: string | null; data?: T };

// The slice of the returned customer_ledger row a fresh document print needs.
export type LedgerDocResult = {
  docNumber: string;
  amountSar: number;
  method: string;
  reference: string | null;
  note: string | null;
  /** The day the money moved — what the printed sheet dates itself by. */
  entryDate: string;
  createdAt: string;
  createdBy: string | null;
};

type LedgerRpcRow = {
  doc_number: string | null;
  amount_sar: number;
  method: string | null;
  reference: string | null;
  note: string | null;
  /** date column — PostgREST serialises it as "YYYY-MM-DD". */
  entry_date: string;
  created_at: string;
  created_by: string | null;
};

const PHOTO_BUCKET = "topup-proofs";

// Server backstop matching app/archive/actions.ts — the client compresses
// images and gates at this same figure BEFORE submit; this is the layer that
// holds when the client is bypassed or stale.
// The server half of the upload ceiling. ONE constant with the client gate
// (lib/upload-image.ts), because a server limit that is looser than the client
// one is not a second line of defence - it is a number nobody is enforcing.
const MAX_FILE_BYTES = MAX_PREPARED_FILE_BYTES;

// ONE upload path for every ledger proof. Top-up and refund put their images
// in the SAME bucket under the same `${customerId}/${kind}-${ts}.${ext}` shape,
// which is why getLedgerPhotoSignedUrl needed no change to serve refund proofs:
// it signs customer_ledger.photo_path out of this one bucket regardless of
// which door wrote the row.
//
// Not exported. A "use server" module may export only async functions, and a
// helper that is not an action has no business being a server hop.
async function uploadLedgerProof(
  supabase: ReturnType<typeof createClient>,
  customerId: string,
  kind: "topup" | "refund",
  file: FormDataEntryValue | null,
): Promise<{ error: string; path?: undefined } | { error: null; path: string | null }> {
  if (!(file instanceof File) || file.size === 0) return { error: null, path: null };
  if (file.size > MAX_FILE_BYTES) return { error: `File too large (max ${mbLabel(MAX_FILE_BYTES)} MB).` };
  const extMatch = /\.([a-zA-Z0-9]{1,10})$/.exec(file.name);
  const ext = extMatch ? extMatch[1].toLowerCase() : "bin";
  const path = `${customerId}/${kind}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (error) return { error: `Photo upload failed: ${error.message}` };
  return { error: null, path };
}

export async function recordTopup(formData: FormData): Promise<ActionResult<LedgerDocResult>> {
  const supabase = createClient();

  const customerId = String(formData.get("customerId") ?? "");
  const amountSar = Number(formData.get("amountSar"));
  const method = String(formData.get("method") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const file = formData.get("photoFile");
  // THE DATE THE FORM HAS ALWAYS COLLECTED, and until 0208 always discarded:
  // record_topup had no date parameter and customer_ledger had only
  // created_at, so a picked date reached the server and died here. SHAPE is
  // all that is checked — any date is legal, future included (Turki's ruling)
  // — and null lets the RPC fall back to today in Riyadh.
  const topupDate = String(formData.get("topupDate") ?? "").trim();
  const entryDate = /^\d{4}-\d{2}-\d{2}$/.test(topupDate) ? topupDate : null;

  if (!customerId) return { error: "Missing customer." };
  if (!Number.isFinite(amountSar) || amountSar <= 0) {
    return { error: "Add Balance amount must be a positive number." };
  }
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

  const up = await uploadLedgerProof(supabase, customerId, "topup", file);
  if (up.error) return { error: up.error };
  const photoPath = up.path;

  const { data: auth } = await supabase.auth.getUser();

  const { data, error } = await supabase.rpc("record_topup", {
    p_customer_id: customerId,
    p_amount: amountSar,
    p_method: method,
    p_reference: reference,
    p_photo_path: photoPath,
    p_actor: auth?.user?.email ?? null,
    p_note: note,
    // REQUIRES 0208. Named arguments mean a missing parameter is a schema
    // fault, not a silent default, so a deploy that runs this against the
    // 7-argument function fails loudly on the first top-up.
    p_entry_date: entryDate,
  });
  if (error) return { error: error.message };
  // `returns customer_ledger` (a single composite row) comes back as one
  // object through PostgREST; supabase-js types an untyped rpc() as any.
  const row = data as LedgerRpcRow;

  revalidatePath("/trips");
  return {
    error: null,
    data: {
      docNumber: row.doc_number ?? "",
      amountSar: row.amount_sar,
      method: row.method ?? method,
      reference: row.reference,
      note: row.note,
      entryDate: row.entry_date,
      createdAt: row.created_at,
      createdBy: row.created_by,
    },
  };
}

// ---------------------------------------------------------------------------
// REFUND (record_refund) — money OUT of the ledger, capped by Available.
// The cap lives in the RPC (it reads v_customer_available under the customer
// row lock); the app does NOT pre-check it — the RPC's error message is the
// single source of refusal and is shown verbatim. amount_sar is stored
// negative by the RPC; the form takes the positive figure being paid back.
//
// PHOTO (0204): a refund is money leaving the company, so it now carries proof
// on exactly the same terms as a top-up — required for bank_transfer, offered
// and stored but not required for cash. The 6-argument record_refund was
// DROPPED in 0204, so p_photo_path is not optional here: omit it and PostgREST
// cannot resolve the function at all and every refund fails.
// ---------------------------------------------------------------------------

export async function recordRefund(formData: FormData): Promise<ActionResult<LedgerDocResult>> {
  const supabase = createClient();

  const customerId = String(formData.get("customerId") ?? "");
  const amountSar = Number(formData.get("amountSar"));
  const method = String(formData.get("method") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const file = formData.get("photoFile");

  if (!customerId) return { error: "Missing customer." };
  if (!Number.isFinite(amountSar) || amountSar <= 0) {
    return { error: "Refund amount must be a positive number." };
  }
  if (method !== "cash" && method !== "bank_transfer") {
    return { error: "Method must be cash or bank transfer." };
  }
  if (method === "bank_transfer") {
    if (!reference) return { error: "Bank transfer requires an ETF Ref. number." };
    if (!(file instanceof File) || file.size === 0) {
      return { error: "Bank transfer requires a photo of the transfer." };
    }
  }

  // Upload BEFORE the RPC. If the RPC then refuses (over Available, say), the
  // image is an orphan in the bucket rather than a ledger row with no proof —
  // the safe side of the trade, and the same order record_topup already used.
  const up = await uploadLedgerProof(supabase, customerId, "refund", file);
  if (up.error) return { error: up.error };

  const { data: auth } = await supabase.auth.getUser();

  const { data, error } = await supabase.rpc("record_refund", {
    p_customer_id: customerId,
    p_amount: amountSar,
    p_method: method,
    p_reference: reference,
    p_photo_path: up.path,
    p_actor: auth?.user?.email ?? null,
    p_note: note,
  });
  if (error) return { error: error.message };
  // Same single-composite-row shape as record_topup above.
  const row = data as LedgerRpcRow;

  revalidatePath("/trips");
  return {
    error: null,
    data: {
      docNumber: row.doc_number ?? "",
      amountSar: row.amount_sar,
      method: row.method ?? method,
      reference: row.reference,
      note: row.note,
      entryDate: row.entry_date,
      createdAt: row.created_at,
      createdBy: row.created_by,
    },
  };
}

// ---------------------------------------------------------------------------
// LEDGER CORRECTIONS — two-vote model (0203, cloned from the 0057/0058 PO
// gate). Propose is open to any authenticated user; voting is restricted by
// the RPC (fleet_manager / ops_supervisor staff, never the proposer). All
// rules live in the RPCs; these actions validate only shape and pass every
// database error through verbatim.
// ---------------------------------------------------------------------------

export async function proposeLedgerCorrection(formData: FormData): Promise<ActionResult> {
  const supabase = createClient();

  const customerId = String(formData.get("customerId") ?? "");
  const amountSar = Number(formData.get("amountSar"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!customerId) return { error: "Missing customer." };
  if (!Number.isFinite(amountSar)) {
    return { error: "Correction amount must be a number (either sign)." };
  }

  const { data: auth } = await supabase.auth.getUser();

  const { error } = await supabase.rpc("propose_ledger_correction", {
    p_customer_id: customerId,
    p_amount: amountSar,
    p_reason: reason,
    p_actor: auth?.user?.email ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/trips");
  return { error: null };
}

export async function voteLedgerCorrection(formData: FormData): Promise<ActionResult> {
  const supabase = createClient();

  const correctionId = String(formData.get("correctionId") ?? "");
  const action = String(formData.get("action") ?? "");
  const comment = String(formData.get("comment") ?? "").trim() || null;

  if (!correctionId) return { error: "Missing correction." };

  const { data: auth } = await supabase.auth.getUser();

  const { error } = await supabase.rpc("vote_ledger_correction", {
    p_correction_id: correctionId,
    p_action: action,
    p_comment: comment,
    p_actor: auth?.user?.email ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/trips");
  return { error: null };
}

// record_topup's p_photo_path lands on customer_ledger.photo_path, and the
// file lives in the PRIVATE topup-proofs bucket (0040) — viewable only via a
// short-lived signed URL, never a public link. Mirrors invoiceActions.ts's
// getProofSignedUrl. (The legacy customer_topups twin of this action is gone
// with the 0206 app cutover — every history row is a ledger row now.)
export async function getLedgerPhotoSignedUrl(entryId: string): Promise<ActionResult<{ url: string }>> {
  const supabase = createClient();
  const { data: entry, error: entryErr } = await supabase
    .from("customer_ledger")
    .select("photo_path")
    .eq("id", entryId)
    .single();
  if (entryErr || !entry) return { error: entryErr?.message ?? "Ledger entry not found." };
  if (!entry.photo_path) return { error: "No photo on file for this entry." };

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(entry.photo_path, 300);
  if (error || !data) return { error: error?.message ?? "Could not generate a link to the photo." };
  return { error: null, data: { url: data.signedUrl } };
}
