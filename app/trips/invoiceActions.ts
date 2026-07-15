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
import type { Invoice, CompanySettings, Customer, WaterType } from "@/lib/db-types";
import { generateInvoicePdf, PdfServiceNotConfiguredError } from "@/lib/pdf";
import { buildInvoicePdfHtml, type PdfInvoiceData, type PdfIdentity } from "@/lib/invoicePdfTemplate";

export type ActionResult<T = undefined> = { error: string | null; data?: T };

const PROOF_BUCKET = "invoice-proofs";
const PDF_BUCKET = "invoice-pdfs";

// Note on runtime: this file has no `export const runtime` of its own —
// Server Actions inherit the runtime of the Server Component page that
// renders the caller (app/trips/page.tsx), which has no edge config, so
// this already runs on the Node runtime by default. Called out explicitly
// because generateInvoicePdf()/buildInvoicePdfHtml() below use Buffer and
// fs.readFileSync (lib/pdf.ts, lib/invoicePdfTemplate.ts) — both Node-only
// APIs that would break under an edge runtime. If app/trips/page.tsx ever
// gains `export const runtime = "edge"`, this feature breaks — don't add one.

// ---------------------------------------------------------------------------
// Shared: fetch everything assembleInvoice() needs for a customer/period and
// run it, applying the reserve-at-draft exclusion (migration 0030 — see
// lib/invoice.ts's RESERVE-AT-DRAFT EXCLUSION note). `excludeInvoiceId` is
// the invoice we're assembling FOR — trips it already reserves are treated
// as "ours", not "reserved elsewhere"; pass null when no invoice exists yet
// (createDraftInvoice's pre-create assembly). `invoiceId` (when given) also
// scopes the special-charges fetch — a not-yet-created draft has none.
//
// Used by: previewInvoice() (read-only display, draft/review), confirmInvoice()
// (right before it snapshots the result), createDraftInvoice() (pre-create,
// to compute the initial reservation set), and setInvoiceReview() (to
// re-sync reservation before the status flip). Always re-fetches live —
// draft/review NEVER read a stored snapshot, per the locked design (see
// migration 0027 header).
// ---------------------------------------------------------------------------
async function assembleForCustomerPeriod(params: {
  customerId: string;
  periodStart: string;
  periodEnd: string;
  invoiceId: string | null;
}): Promise<{ error: string | null; assembly?: InvoiceAssembly; sellerRow?: unknown; buyerRow?: unknown }> {
  const { customerId, periodStart, periodEnd, invoiceId } = params;
  const supabase = createClient();

  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .select("id, name, vat_number, cr_number, billing_address, email")
    .eq("id", customerId)
    .single();
  if (custErr || !customer) return { error: custErr?.message ?? "Customer not found." };

  // Project is 1:1 with customer (lib/prepaid.ts header) — no project_id
  // stored on invoices, derived here.
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, rate_per_trip_sar, payment_mode")
    .eq("customer_id", customerId)
    .single();
  if (projErr || !project) return { error: projErr?.message ?? "No project found for this customer." };

  // Full trip history for the project (not period-filtered — see
  // lib/invoice.ts's PERIOD-MEMBERSHIP RULE), rate resolved from the
  // project's rate_per_trip_sar, never trips.rate_sar (same convention as
  // app/trips/FinanceTab.tsx). invoice_id fetched to compute the
  // reserved-elsewhere set (0030) — a trip reserved by ANY invoice other
  // than the one we're assembling for is excluded.
  const { data: tripRows, error: tripErr } = await supabase
    .from("trips")
    // ref/water_type added (Finance polish batch A) — display-only passenger
    // data, threaded through ConsumingTrip -> InvoiceLine. Never used in any
    // rate/VAT/total math.
    .select("id, trip_date, delivered_at, invoice_id, ref, water_type")
    .eq("project_id", project.id);
  if (tripErr) return { error: tripErr.message };
  const trips: ConsumingTrip[] = (tripRows ?? []).map((t) => ({
    id: t.id,
    trip_date: t.trip_date,
    delivered_at: t.delivered_at,
    rate_sar: project.rate_per_trip_sar,
    ref: t.ref,
    water_type: t.water_type,
  }));
  const reservedElsewhereTripIds = (tripRows ?? [])
    .filter((t) => t.invoice_id != null && t.invoice_id !== invoiceId)
    .map((t) => t.id);

  const { data: topupRows, error: topupErr } = await supabase
    .from("customer_topups")
    .select("id, amount_sar, topup_date")
    .eq("customer_id", customerId);
  if (topupErr) return { error: topupErr.message };
  const topups: TopupLite[] = topupRows ?? [];

  let specialCharges: SpecialChargeInput[] = [];
  if (invoiceId) {
    const { data: chargeRows, error: chargeErr } = await supabase
      .from("invoice_special_charges")
      .select("id, label, amount_sar")
      .eq("invoice_id", invoiceId);
    if (chargeErr) return { error: chargeErr.message };
    specialCharges = chargeRows ?? [];
  }

  const { data: seller } = await supabase.from("company_settings").select("*").eq("id", true).single();

  const assembly = assembleInvoice({
    customerId,
    paymentMode: project.payment_mode,
    periodStart,
    periodEnd,
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
    reservedElsewhereTripIds,
  });

  return { error: null, assembly, sellerRow: seller, buyerRow: customer };
}

// Convenience wrapper for an EXISTING invoice — reads its customer/period/
// status off the row, then delegates to assembleForCustomerPeriod above.
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

  return assembleForCustomerPeriod({
    customerId: invoice.customer_id,
    periodStart: invoice.period_start,
    periodEnd: invoice.period_end,
    invoiceId,
  });
}

// The trip ids an invoice's CURRENT assembly should reserve — union of
// covered + unpaid trip lines (charges aren't trips, nothing to reserve for
// those). Reused by createDraftInvoice() (pre-create) and setInvoiceReview()
// (re-sync) so both compute "what should be reserved" identically.
function desiredReservationTripIds(assembly: InvoiceAssembly): string[] {
  return [...assembly.coveredLines, ...assembly.unpaidLines]
    .filter((l) => l.kind === "trip")
    .map((l) => l.id);
}

// ---------------------------------------------------------------------------
// Draft — reserve-at-draft (0030): the initial trip set is computed here (in
// TS, via assembleForCustomerPeriod — same math previewInvoice() will show)
// and reserved atomically alongside the insert by create_draft_invoice()
// (SQL). This is an EXPLICIT user action (clicking "Create draft" in
// InvoicesModal) — never triggered by a read/view.
// ---------------------------------------------------------------------------
export async function createDraftInvoice(
  customerId: string,
  periodStart: string,
  periodEnd: string,
): Promise<ActionResult<{ id: string }>> {
  const supabase = createClient();

  const { error: assembleErr, assembly } = await assembleForCustomerPeriod({
    customerId,
    periodStart,
    periodEnd,
    invoiceId: null,
  });
  if (assembleErr || !assembly) return { error: assembleErr ?? "Could not assemble the new invoice." };

  const { data, error } = await supabase.rpc("create_draft_invoice", {
    p_customer_id: customerId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_trip_ids: desiredReservationTripIds(assembly),
  });
  if (error || !data) return { error: error?.message ?? "Could not create draft invoice." };
  revalidatePath("/trips");
  return { error: null, data: { id: data.id } };
}

// Abandons a draft, releasing its reserved trips (0030 — draft-only, see
// migration header; a Review invoice must Back-to-Draft first).
export async function deleteDraftInvoice(invoiceId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc("delete_draft_invoice", { p_invoice_id: invoiceId });
  if (error) return { error: error.message };
  revalidatePath("/trips");
  return { error: null };
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
export async function getInvoice(invoiceId: string): Promise<ActionResult<Invoice & { projectWaterType: WaterType | null }>> {
  const supabase = createClient();
  const { data, error } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
  if (error || !data) return { error: error?.message ?? "Invoice not found." };
  // Display-only fallback (Finance polish batch C): old/frozen invoice line
  // snapshots predate the water_type field and store null for it. We resolve
  // the project's CURRENT water_type here so the UI can show a real label
  // instead of "—" — this never touches the frozen snapshot itself (covered_
  // lines/unpaid_lines stay exactly as confirm_invoice() wrote them).
  const invoice = data as Invoice;
  const { data: project } = await supabase
    .from("projects")
    .select("water_type")
    .eq("customer_id", invoice.customer_id)
    .maybeSingle();
  return { error: null, data: { ...invoice, projectWaterType: (project?.water_type as WaterType | null) ?? null } };
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
// Draft -> Review is an EXPLICIT user action ("Move to Review" click) — the
// right place to re-sync reservation (0030) against however the trip set
// may have drifted since the draft was created (new deliveries, etc.), so
// what gets reserved matches exactly what's about to be reviewed. Sync runs
// BEFORE the status flip; if it fails (a genuine double-book race), the
// invoice stays in draft rather than moving to review with a stale/conflicted
// reservation.
export async function setInvoiceReview(invoiceId: string): Promise<ActionResult> {
  const supabase = createClient();

  const { error: assembleErr, assembly } = await assembleForInvoice(invoiceId);
  if (assembleErr || !assembly) return { error: assembleErr ?? "Could not assemble invoice for review." };

  const { error: syncErr } = await supabase.rpc("sync_draft_reservation", {
    p_invoice_id: invoiceId,
    p_trip_ids: desiredReservationTripIds(assembly),
  });
  if (syncErr) return { error: syncErr.message };

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
// 5c). Invoice returns to Confirmed; trips stay RESERVED to it (0030 —
// un-pay reverses payment, not reservation; only void/delete release trips
// now — see migration 0030's unpay_invoice()). "by" is derived server-side
// from the authenticated user, same convention as app/drivers/actions.ts's
// approved_by — never a UI text input.
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

// ---------------------------------------------------------------------------
// Company settings — email only (0029). Minimal get/set pair for the small
// Finance-tab form; NOT a full settings screen (deferred). Table is a
// singleton (id = true) — no id param needed.
// ---------------------------------------------------------------------------
export async function getCompanyEmail(): Promise<ActionResult<{ email: string | null }>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("company_settings")
    .select("email")
    .eq("id", true)
    .single();
  if (error) return { error: error.message };
  return { error: null, data: { email: data?.email ?? null } };
}

export async function updateCompanyEmail(email: string): Promise<ActionResult> {
  const supabase = createClient();
  const trimmed = email.trim();
  const { error } = await supabase
    .from("company_settings")
    .update({ email: trimmed || null, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) return { error: error.message };
  revalidatePath("/trips");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Invoice PDF export — Finance §7/§11. Draft/review is live (assembled
// fresh, same as previewInvoice() above, never stored — content is still
// mutable). Confirmed/paid/void is the frozen snapshot (same rule as
// getInvoice() above) AND is cache-eligible: the first download for a given
// invoice id generates + uploads to the private `invoice-pdfs` bucket at a
// deterministic path (`${invoiceId}.pdf`); every later download re-reads
// those cached bytes instead of calling the PDF provider again — safe
// because a confirmed/paid/void snapshot can never change. Nothing is
// generated eagerly at confirm time — only on first explicit download.
//
// Returns base64 (not a signed URL) so ONE return shape covers both the
// live path (no stored object to sign a URL for) and the cached path —
// the client (InvoiceDetailModal) decodes it into a Blob and triggers a
// normal browser download.
// ---------------------------------------------------------------------------
export type InvoicePdfResult = { base64: string; filename: string };

type SellerSnap = Pick<CompanySettings, "legal_name" | "vat_number" | "cr_number" | "address"> | null;
type BuyerSnap = Pick<Customer, "name" | "vat_number" | "cr_number" | "billing_address"> | null;

function toIdentity(name: string | null | undefined, vat: string | null, cr: string | null, address: string | null): PdfIdentity {
  if (!name && !vat && !cr && !address) return null;
  return { name: name ?? null, vat_number: vat, cr_number: cr, address };
}

export async function getInvoicePdf(invoiceId: string): Promise<ActionResult<InvoicePdfResult>> {
  const supabase = createClient();

  const { data: invoice, error: invErr } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
  if (invErr || !invoice) return { error: invErr?.message ?? "Invoice not found." };
  const inv = invoice as Invoice;

  const filename = inv.invoice_number
    ? `invoice-${inv.invoice_number}.pdf`
    : `invoice-draft-${invoiceId.slice(0, 8)}.pdf`;

  const cacheable = inv.status === "confirmed" || inv.status === "paid" || inv.status === "void";
  const storagePath = `${invoiceId}.pdf`;

  // Cache hit: reuse the previously-generated bytes, skip the provider call.
  if (cacheable) {
    const { data: cached } = await supabase.storage.from(PDF_BUCKET).download(storagePath);
    if (cached) {
      const buf = Buffer.from(await cached.arrayBuffer());
      return { error: null, data: { base64: buf.toString("base64"), filename } };
    }
  }

  let pdfData: PdfInvoiceData;

  if (inv.status === "draft" || inv.status === "review") {
    const { error: asmErr, assembly } = await assembleForInvoice(invoiceId);
    if (asmErr || !assembly) return { error: asmErr ?? "Could not assemble invoice for PDF." };
    const seller = assembly.sellerSnapshot as SellerSnap;
    const buyer = assembly.buyerSnapshot as BuyerSnap;
    pdfData = {
      status: inv.status,
      invoiceNumber: inv.invoice_number,
      vatRef: inv.vat_ref,
      periodStart: inv.period_start,
      periodEnd: inv.period_end,
      seller: toIdentity(seller?.legal_name, seller?.vat_number ?? null, seller?.cr_number ?? null, seller?.address ?? null),
      buyer: toIdentity(buyer?.name, buyer?.vat_number ?? null, buyer?.cr_number ?? null, buyer?.billing_address ?? null),
      buyerEmail: assembly.customerEmail,
      coveredLines: assembly.coveredLines,
      unpaidLines: assembly.unpaidLines,
      covered: assembly.covered,
      amountDue: assembly.amountDue,
      grand: assembly.grand,
      paymentMethod: null,
      paidAt: null,
      voidReason: null,
      voidedAt: null,
    };
  } else {
    const seller = inv.seller_snapshot;
    const buyer = inv.buyer_snapshot;
    pdfData = {
      status: inv.status,
      invoiceNumber: inv.invoice_number,
      vatRef: inv.vat_ref,
      periodStart: inv.period_start,
      periodEnd: inv.period_end,
      seller: toIdentity(seller?.legal_name, seller?.vat_number ?? null, seller?.cr_number ?? null, seller?.address ?? null),
      buyer: toIdentity(buyer?.name, buyer?.vat_number ?? null, buyer?.cr_number ?? null, buyer?.billing_address ?? null),
      // Snapshot never retained an email (buyer_snapshot's Pick<Customer,...>
      // has no email field) — omitted rather than re-fetched live, consistent
      // with "frozen means frozen".
      buyerEmail: null,
      coveredLines: inv.covered_lines ?? [],
      unpaidLines: inv.unpaid_lines ?? [],
      covered: { subtotal: inv.covered_subtotal_sar, vat: inv.covered_vat_sar, total: inv.covered_total_sar },
      amountDue: { subtotal: inv.amount_due_subtotal_sar, vat: inv.amount_due_vat_sar, total: inv.amount_due_sar },
      grand: { subtotal: inv.grand_subtotal_sar, vat: inv.grand_vat_sar, total: inv.grand_total_sar },
      paymentMethod: inv.payment_method,
      paidAt: inv.paid_at,
      voidReason: inv.void_reason,
      voidedAt: inv.voided_at,
    };
  }

  const html = buildInvoicePdfHtml(pdfData);

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateInvoicePdf(html);
  } catch (err) {
    if (err instanceof PdfServiceNotConfiguredError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Could not generate the PDF." };
  }

  if (cacheable) {
    // Best-effort cache write — an upload failure here must not fail the
    // download itself (the user still gets their PDF this time; the next
    // download simply regenerates instead of hitting a stale cache).
    await supabase.storage
      .from(PDF_BUCKET)
      .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true });
  }

  return { error: null, data: { base64: pdfBuffer.toString("base64"), filename } };
}
