"use server";

// Server actions for the invoice lifecycle (Finance Commit 5b, spec §6/§7/
// §8). Draft -> Review -> Confirmed -> Paid, + Void. lib/invoice.ts does all
// the math (pure, harnessed); this file is I/O only — fetch, call
// assembleInvoice(), then either a plain single-row update (draft/review/
// revert — no atomicity concerns beyond one row) or one of the atomic SQL
// functions from migration 0027 (confirm/void/pay/unpay — multi-column or
// multi-row writes that must succeed or fail together).
//
// NOT the UI (5c, later) — no components here, just the actions 5c will call.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assembleInvoice, canEditSpecialCharges, type InvoiceAssembly, type SpecialChargeInput } from "@/lib/invoice";
import type { ConsumingTrip, TopupLite } from "@/lib/prepaid";
import type { Invoice } from "@/lib/db-types";

export type ActionResult<T = undefined> = { error: string | null; data?: T };

const PROOF_BUCKET = "invoice-proofs";

// ---------------------------------------------------------------------------
// Shared: fetch everything assembleInvoice() needs for one invoice row and
// run it. Used by both the read-only preview (draft/review display) and by
// confirmInvoice() right before it snapshots the result. Always re-fetches
// live — draft/review NEVER read a stored snapshot, per the locked design
// (see migration 0027 header).
// ---------------------------------------------------------------------------
async function assembleForInvoice(
  invoiceId: string,
): Promise<{ error: string | null; assembly?: InvoiceAssembly; sellerRow?: unknown; buyerRow?: unknown }> {
  const supabase = createClient();

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("id, customer_id, period_start, period_end, status")
    .eq("id", invoiceId)
    .single();
  if (invErr || !invoice) return { error: invErr?.message ?? "Invoice not found." };

  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .select("id, name, vat_number, cr_number, billing_address, email")
    .eq("id", invoice.customer_id)
    .single();
  if (custErr || !customer) return { error: custErr?.message ?? "Customer not found." };

  // Project is 1:1 with customer (lib/prepaid.ts header) — no project_id
  // stored on invoices, derived here.
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, rate_per_trip_sar, payment_mode")
    .eq("customer_id", invoice.customer_id)
    .single();
  if (projErr || !project) return { error: projErr?.message ?? "No project found for this customer." };

  // Full trip history for the project (not period-filtered — see
  // lib/invoice.ts's PERIOD-MEMBERSHIP RULE), rate resolved from the
  // project's rate_per_trip_sar, never trips.rate_sar (same convention as
  // app/trips/FinanceTab.tsx).
  const { data: tripRows, error: tripErr } = await supabase
    .from("trips")
    .select("id, trip_date, delivered_at")
    .eq("project_id", project.id);
  if (tripErr) return { error: tripErr.message };
  const trips: ConsumingTrip[] = (tripRows ?? []).map((t) => ({
    id: t.id,
    trip_date: t.trip_date,
    delivered_at: t.delivered_at,
    rate_sar: project.rate_per_trip_sar,
  }));

  const { data: topupRows, error: topupErr } = await supabase
    .from("customer_topups")
    .select("id, amount_sar, topup_date")
    .eq("customer_id", invoice.customer_id);
  if (topupErr) return { error: topupErr.message };
  const topups: TopupLite[] = topupRows ?? [];

  const { data: chargeRows, error: chargeErr } = await supabase
    .from("invoice_special_charges")
    .select("id, label, amount_sar")
    .eq("invoice_id", invoiceId);
  if (chargeErr) return { error: chargeErr.message };
  const specialCharges: SpecialChargeInput[] = chargeRows ?? [];

  const { data: seller } = await supabase.from("company_settings").select("*").eq("id", true).single();

  const assembly = assembleInvoice({
    customerId: invoice.customer_id,
    paymentMode: project.payment_mode,
    periodStart: invoice.period_start,
    periodEnd: invoice.period_end,
    trips,
    topups,
    specialCharges,
    sellerSnapshot: seller ?? null,
    buyerSnapshot: {
      name: customer.name,
      vat_number: customer.vat_number,
      cr_number: customer.cr_number,
      billing_address: customer.billing_address,
    },
    customerEmail: customer.email,
  });

  return { error: null, assembly, sellerRow: seller, buyerRow: customer };
}

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------
export async function createDraftInvoice(
  customerId: string,
  periodStart: string,
  periodEnd: string,
): Promise<ActionResult<{ id: string }>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("invoices")
    .insert({ customer_id: customerId, period_start: periodStart, period_end: periodEnd })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create draft invoice." };
  revalidatePath("/trips");
  return { error: null, data: { id: data.id } };
}

export async function addSpecialCharge(invoiceId: string, label: string, amountSar: number): Promise<ActionResult> {
  const supabase = createClient();
  const { data: invoice } = await supabase.from("invoices").select("status").eq("id", invoiceId).single();
  if (!invoice || !canEditSpecialCharges(invoice.status)) {
    return { error: "Special charges can only be edited while the invoice is Draft or Review." };
  }
  const { error } = await supabase
    .from("invoice_special_charges")
    .insert({ invoice_id: invoiceId, label, amount_sar: amountSar });
  if (error) return { error: error.message };
  revalidatePath("/trips");
  return { error: null };
}

export async function removeSpecialCharge(invoiceId: string, chargeId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data: invoice } = await supabase.from("invoices").select("status").eq("id", invoiceId).single();
  if (!invoice || !canEditSpecialCharges(invoice.status)) {
    return { error: "Special charges can only be edited while the invoice is Draft or Review." };
  }
  const { error } = await supabase.from("invoice_special_charges").delete().eq("id", chargeId);
  if (error) return { error: error.message };
  revalidatePath("/trips");
  return { error: null };
}

// Live preview for the UI (5c) — draft AND review both stay live-recomputed,
// never a stored snapshot, per the locked design.
export async function previewInvoice(invoiceId: string): Promise<ActionResult<InvoiceAssembly>> {
  const { error, assembly } = await assembleForInvoice(invoiceId);
  if (error || !assembly) return { error: error ?? "Could not assemble invoice preview." };
  return { error: null, data: assembly };
}

// Raw row read — the ONLY correct source for confirmed/paid/void display.
// Unlike previewInvoice() (always live-recomputes, correct for draft/review
// only), this reads the frozen snapshot columns exactly as confirm_invoice()
// wrote them, so a Confirmed invoice's displayed numbers never drift from
// what was actually confirmed even if underlying trips change afterward.
export async function getInvoice(invoiceId: string): Promise<ActionResult<Invoice>> {
  const supabase = createClient();
  const { data, error } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
  if (error || !data) return { error: error?.message ?? "Invoice not found." };
  return { error: null, data: data as Invoice };
}

// Invoice history for one customer — newest period first. Powers the
// per-customer "Invoices" list (5c).
export async function listInvoicesForCustomer(customerId: string): Promise<ActionResult<Invoice[]>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("customer_id", customerId)
    .order("period_start", { ascending: false });
  if (error) return { error: error.message };
  return { error: null, data: (data ?? []) as Invoice[] };
}

// invoice-proofs is a PRIVATE Storage bucket — proof_of_payment_path can
// only be viewed via a short-lived signed URL, never a public link.
export async function getProofSignedUrl(invoiceId: string): Promise<ActionResult<{ url: string }>> {
  const supabase = createClient();
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("proof_of_payment_path")
    .eq("id", invoiceId)
    .single();
  if (invErr || !invoice) return { error: invErr?.message ?? "Invoice not found." };
  if (!invoice.proof_of_payment_path) return { error: "No proof of payment on file for this invoice." };

  const { data, error } = await supabase.storage
    .from(PROOF_BUCKET)
    .createSignedUrl(invoice.proof_of_payment_path, 300);
  if (error || !data) return { error: error?.message ?? "Could not generate a link to the proof file." };
  return { error: null, data: { url: data.signedUrl } };
}

// ---------------------------------------------------------------------------
// Draft <-> Review — freely reversible, single-row updates, no RPC needed
// (no number/VAT ref claimed yet at either status).
// ---------------------------------------------------------------------------
export async function setInvoiceReview(invoiceId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "review", reviewed_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Invoice is not in draft status — cannot move to review." };
  revalidatePath("/trips");
  return { error: null };
}

export async function revertInvoiceToDraft(invoiceId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("invoices")
    .update({ status: "draft", reviewed_at: null })
    .eq("id", invoiceId)
    .eq("status", "review")
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Invoice is not in review status — cannot revert to draft." };
  revalidatePath("/trips");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Confirm — THE atomic Review -> Confirmed transition. Assembly runs here in
// TS (pure, harnessed); the SQL function only persists the already-computed
// result alongside the gap-free number + VAT ref claim, atomically.
// ---------------------------------------------------------------------------
export async function confirmInvoice(invoiceId: string): Promise<ActionResult<{ invoiceNumber: number }>> {
  const supabase = createClient();

  const { data: invoice } = await supabase.from("invoices").select("status").eq("id", invoiceId).single();
  if (!invoice || invoice.status !== "review") {
    return { error: "Invoice must be in Review status before it can be confirmed." };
  }

  const { error: assembleErr, assembly } = await assembleForInvoice(invoiceId);
  if (assembleErr || !assembly) return { error: assembleErr ?? "Could not assemble invoice for confirm." };

  const coveredTripIds = assembly.coveredLines.filter((l) => l.kind === "trip").map((l) => l.id);
  const unpaidTripIds = assembly.unpaidLines.filter((l) => l.kind === "trip").map((l) => l.id);
  const specialChargesSnapshot = assembly.unpaidLines
    .filter((l) => l.kind === "charge")
    .map((l) => ({ id: l.id, label: l.description, amount_sar: l.amount_sar, vat_sar: l.vat_sar }));

  const { data, error } = await supabase.rpc("confirm_invoice", {
    p_invoice_id: invoiceId,
    p_seller_snapshot: assembly.sellerSnapshot,
    p_buyer_snapshot: assembly.buyerSnapshot,
    p_covered_lines: assembly.coveredLines,
    p_unpaid_lines: assembly.unpaidLines,
    p_special_charges: specialChargesSnapshot,
    p_covered_trip_ids: coveredTripIds,
    p_unpaid_trip_ids: unpaidTripIds,
    p_covered_subtotal: assembly.covered.subtotal,
    p_covered_vat: assembly.covered.vat,
    p_covered_total: assembly.covered.total,
    p_due_subtotal: assembly.amountDue.subtotal,
    p_due_vat: assembly.amountDue.vat,
    p_due_total: assembly.amountDue.total,
    p_grand_subtotal: assembly.grand.subtotal,
    p_grand_vat: assembly.grand.vat,
    p_grand_total: assembly.grand.total,
  });
  if (error) return { error: error.message };
  revalidatePath("/trips");
  return { error: null, data: { invoiceNumber: data?.invoice_number ?? 0 } };
}

// ---------------------------------------------------------------------------
// Void — the only undo for a Confirmed invoice. Number/VAT ref retained
// forever (see migration 0027).
// ---------------------------------------------------------------------------
export async function voidInvoice(invoiceId: string, reason: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc("void_invoice", { p_invoice_id: invoiceId, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath("/trips");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Pay — Confirmed -> Paid. bank_transfer requires exactly one proof file,
// uploaded to Storage before the RPC call (the RPC only persists a path,
// upload is plain I/O). cash needs no file. Locks both covered AND unpaid
// trips (migration 0027's pay_invoice()).
// ---------------------------------------------------------------------------
export async function markInvoicePaid(formData: FormData): Promise<ActionResult> {
  const supabase = createClient();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const paymentMethod = String(formData.get("paymentMethod") ?? "");
  const file = formData.get("proofFile");

  if (!invoiceId) return { error: "Missing invoice id." };
  if (paymentMethod !== "cash" && paymentMethod !== "bank_transfer") {
    return { error: "Payment method must be cash or bank_transfer." };
  }

  let proofPath: string | null = null;
  if (paymentMethod === "bank_transfer") {
    if (!(file instanceof File) || file.size === 0) {
      return { error: "bank_transfer requires a proof-of-payment file." };
    }
    const extMatch = /\.([a-zA-Z0-9]{1,10})$/.exec(file.name);
    const ext = extMatch ? extMatch[1].toLowerCase() : "bin";
    proofPath = `${invoiceId}/proof-${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage.from(PROOF_BUCKET).upload(proofPath, file, {
      contentType: file.type || "application/octet-stream",
    });
    if (uploadErr) return { error: `Proof upload failed: ${uploadErr.message}` };
  }

  const { error } = await supabase.rpc("pay_invoice", {
    p_invoice_id: invoiceId,
    p_payment_method: paymentMethod,
    p_proof_path: proofPath,
  });
  if (error) return { error: error.message };
  revalidatePath("/trips");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Un-pay — gated admin action (the approval gate/warning is a UI concern,
// 5c). Unlocks every trip this invoice locked; invoice returns to Confirmed.
// "by" is derived server-side from the authenticated user, same convention
// as app/drivers/actions.ts's approved_by — never a UI text input.
// ---------------------------------------------------------------------------
export async function unpayInvoice(invoiceId: string, reason: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data: auth } = await supabase.auth.getUser();
  const by = auth?.user?.email ?? "unknown";
  const { error } = await supabase.rpc("unpay_invoice", { p_invoice_id: invoiceId, p_reason: reason, p_by: by });
  if (error) return { error: error.message };
  revalidatePath("/trips");
  return { error: null };
}
