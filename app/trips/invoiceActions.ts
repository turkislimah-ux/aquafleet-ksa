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
import type { BalanceReturnLite, ConsumingTrip, TopupLite } from "@/lib/prepaid";
import type { Invoice, CompanySettings, Customer, WaterType, PaymentMode } from "@/lib/db-types";
import { generateInvoicePdf, PdfServiceNotConfiguredError } from "@/lib/pdf";
import { buildInvoicePdfHtml, type PdfInvoiceData, type PdfIdentity } from "@/lib/invoicePdfTemplate";
import {
  MAX_BANK_ACCOUNTS,
  parseBankAccounts,
  validateBankAccounts,
  type CompanyBankAccount,
} from "@/lib/bankAccounts";
import { round2 } from "@/lib/vat";

export type ActionResult<T = undefined> = { error: string | null; data?: T };

const PROOF_BUCKET = "invoice-proofs";
const PDF_BUCKET = "invoice-pdfs";
const SPECIAL_CHARGE_IMAGE_BUCKET = "special-charge-images";

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
// lib/invoice.ts's RESERVE-AT-DRAFT EXCLUSION note, GENERALIZED in v3 to
// cover special charges too). `invoiceId` is the invoice we're assembling
// FOR — trips/charges it already claims are treated as "ours", not
// "reserved elsewhere"; pass null when no invoice exists yet
// (createDraftInvoice's pre-create assembly).
//
// v3: the special-charges fetch is now CUSTOMER-WIDE (every charge on every
// NON-VOID invoice for this customer, not just this invoiceId's own) — the
// FIFO pool must see every charge that ever consumed it (see lib/invoice.ts's
// PERIOD-MEMBERSHIP RULE + lib/prepaid.ts's "which invoices' charges
// consume" note: void-invoice charges are excluded here, at the fetch, by
// filtering out void invoice ids before the charges query even runs — this
// IS the caller-side exclusion lib/prepaid.ts's header defers to). Charges
// belonging to another (non-void) invoice than the one being assembled are
// still included in the FIFO input but excluded from the DISPLAYED
// chargeLines via reservedElsewhereIds, exactly like trips.
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
    .select("id, name, name_ar, vat_number, cr_number, billing_address, email")
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
  // lib/invoice.ts's PERIOD-MEMBERSHIP RULE), rate resolved FROZEN-FIRST from
  // trips.rate_sar with the project's rate_per_trip_sar only as the
  // not-yet-delivered fallback — see the mapping below, and the identical
  // convention in ./amountPayable's toConsumingTrip. invoice_id fetched to compute the
  // reserved-elsewhere set (0030) — a trip reserved by ANY invoice other
  // than the one we're assembling for is excluded.
  const { data: tripRows, error: tripErr } = await supabase
    .from("trips")
    // ref/water_type added (Finance polish batch A) — display-only passenger
    // data, threaded through ConsumingTrip -> InvoiceLine. Never used in any
    // rate/VAT/total math.
    .select("id, trip_date, delivered_at, invoice_id, ref, water_type, rate_sar")
    .eq("project_id", project.id);
  if (tripErr) return { error: tripErr.message };
  const trips: ConsumingTrip[] = (tripRows ?? []).map((t) => ({
    id: t.id,
    trip_date: t.trip_date,
    delivered_at: t.delivered_at,
    // FROZEN RATE FIRST — an invoice bills each trip at what it was worth on the
    // day it was delivered, not at whatever the project charges today. The
    // project's current rate remains only as the not-yet-delivered fallback, and
    // an undelivered trip is filtered out before any amount is computed.
    rate_sar: t.rate_sar ?? project.rate_per_trip_sar,
    ref: t.ref,
    water_type: t.water_type,
  }));

  const { data: topupRows, error: topupErr } = await supabase
    .from("customer_topups")
    .select("id, amount_sar, topup_date")
    .eq("customer_id", customerId);
  if (topupErr) return { error: topupErr.message };
  const topups: TopupLite[] = topupRows ?? [];

  // Refunds of prepaid credit (0142) — customer-wide, any date, same shape as
  // the top-up fetch above because they are the same pool's other side. Fails
  // LOUD like every other fetch here: falling back to [] would assemble an
  // invoice whose pool still holds money the customer has already been handed
  // back, and that invoice would show work as Covered that nothing covers.
  const { data: returnRows, error: returnErr } = await supabase
    .from("customer_balance_returns")
    .select("id, amount_sar, returned_on")
    .eq("customer_id", customerId);
  if (returnErr) return { error: returnErr.message };
  const returns: BalanceReturnLite[] = returnRows ?? [];

  // v3: customer-wide, non-void-invoice charges only — see header note.
  // Two-step (no nested-join precedent elsewhere in this codebase, kept
  // consistent): fetch this customer's non-void invoice ids, then every
  // charge on those invoices.
  const { data: customerInvoiceRows, error: custInvErr } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("customer_id", customerId);
  if (custInvErr) return { error: custInvErr.message };
  const nonVoidInvoiceIds = (customerInvoiceRows ?? []).filter((i) => i.status !== "void").map((i) => i.id);

  let chargeRows: {
    id: string;
    invoice_id: string;
    label: string;
    amount_sar: number;
    charge_date: string | null;
    quantity: number;
    price_sar: number | null;
    image_path: string | null;
    created_at: string;
  }[] = [];
  if (nonVoidInvoiceIds.length > 0) {
    const { data, error: chargeErr } = await supabase
      .from("invoice_special_charges")
      .select("id, invoice_id, label, amount_sar, charge_date, quantity, price_sar, image_path, created_at")
      .in("invoice_id", nonVoidInvoiceIds);
    if (chargeErr) return { error: chargeErr.message };
    chargeRows = data ?? [];
  }
  const specialCharges: SpecialChargeInput[] = chargeRows.map((c) => ({
    id: c.id,
    label: c.label,
    amount_sar: c.amount_sar,
    charge_date: c.charge_date,
    created_at: c.created_at,
    quantity: c.quantity,
    price_sar: c.price_sar,
    image_path: c.image_path,
  }));

  // Reserved-elsewhere set (v3, generalized — see header note): a trip whose
  // invoice_id is set to something other than this invoice, UNION a charge
  // whose invoice_id is something other than this invoice (every charge
  // always belongs to exactly one invoice from creation — see
  // addSpecialCharge below — so "elsewhere" simply means "not this one").
  const reservedElsewhereIds = [
    ...(tripRows ?? []).filter((t) => t.invoice_id != null && t.invoice_id !== invoiceId).map((t) => t.id),
    ...chargeRows.filter((c) => c.invoice_id !== invoiceId).map((c) => c.id),
  ];

  const { data: seller } = await supabase.from("company_settings").select("*").eq("id", true).single();

  const assembly = assembleInvoice({
    customerId,
    paymentMode: project.payment_mode,
    periodStart,
    periodEnd,
    trips,
    topups,
    returns,
    specialCharges,
    sellerSnapshot: seller ?? null,
    buyerSnapshot: {
      name: customer.name,
      name_ar: customer.name_ar,
      vat_number: customer.vat_number,
      cr_number: customer.cr_number,
      billing_address: customer.billing_address,
    },
    customerEmail: customer.email,
    reservedElsewhereIds,
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

// Discards an unfinalised invoice, releasing what it holds. 0182 widened the
// RPC from draft-only to draft OR review — a Review invoice no longer has to go
// Back-to-Draft first, which is what made a stale one clearable at all; 0183
// then renamed it delete_draft_invoice -> discard_invoice so the name stopped
// claiming draft-only. The RPC nulls trips.invoice_id (releasing the
// reservation) and deletes the row; invoice_special_charges goes with it
// through the FK's ON DELETE CASCADE, which is what frees a prepaid customer's
// held balance. Confirmed/paid/void are still rejected there — an issued
// document leaves by void_invoice, never by delete.
//
// THIS STRING IS UNCHECKED BY THE COMPILER. lib/db-types.ts is hand-written row
// shapes with no generated Functions map, and both Supabase clients are built
// without a <Database> generic, so supabase.rpc() accepts any string and a typo
// fails at runtime, not at tsc. It is the only rpc name for this function in
// the repo; grep is the regression test.
export async function deleteDraftInvoice(invoiceId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.rpc("discard_invoice", { p_invoice_id: invoiceId });
  if (error) return { error: error.message };
  revalidatePath("/trips");
  return { error: null };
}

// Inputs now match the invoice table's shape (Finance polish batch B, item
// 3): date/quantity/price replace the old label+amount-only form. amount_sar
// (the figure the VAT engine actually sums — lib/invoice.ts's
// chargesToVatItems) is computed HERE, once, at write time — round2(price *
// qty) — never re-derived inside the money-math read path. See migration
// 0032's header.
// ---------------------------------------------------------------------------
// Draft-only period edit (Finance polish batch B, item 1) — same
// date-range picker InvoicesModal uses to CREATE an invoice, reused here to
// CHANGE a draft's period. Re-assembles for the new range (self-excluded,
// same convention as createDraftInvoice/setInvoiceReview) and syncs
// reservation BEFORE writing the new period: a trip that dropped out of the
// new range is released, a trip newly in-range is claimed, and a genuine
// double-claim (sync_draft_reservation's conflict raise, migration 0030)
// aborts here with the period left untouched.
// ---------------------------------------------------------------------------
export async function updateDraftInvoicePeriod(
  invoiceId: string,
  periodStart: string,
  periodEnd: string,
): Promise<ActionResult> {
  const supabase = createClient();

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("id, customer_id, status")
    .eq("id", invoiceId)
    .single();
  if (invErr || !invoice) return { error: invErr?.message ?? "Invoice not found." };
  if (invoice.status !== "draft") return { error: "Only a Draft invoice's period can be changed." };
  if (periodEnd < periodStart) return { error: "Period end must be on or after period start." };

  const { error: assembleErr, assembly } = await assembleForCustomerPeriod({
    customerId: invoice.customer_id,
    periodStart,
    periodEnd,
    invoiceId,
  });
  if (assembleErr || !assembly) return { error: assembleErr ?? "Could not assemble invoice for the new period." };

  const { error: syncErr } = await supabase.rpc("sync_draft_reservation", {
    p_invoice_id: invoiceId,
    p_trip_ids: desiredReservationTripIds(assembly),
  });
  if (syncErr) return { error: syncErr.message };

  const { data: hit, error } = await supabase
    .from("invoices")
    .update({ period_start: periodStart, period_end: periodEnd })
    .eq("id", invoiceId)
    .eq("status", "draft")
    // READ BACK — the .eq("status","draft") above is a TOCTOU backstop for the
    // status check at the top of this function, and a backstop nobody reads is
    // not a backstop. setInvoiceReview and revertInvoiceToDraft both already do
    // this; this was the one guarded invoice write in the file that did not.
    //
    // The sync RPC has ALREADY RUN by the time we get here, and that ordering
    // stays deliberately (see the header: a double-claim must abort with the
    // period untouched). So on a miss the reservation reflects the new range
    // while the invoice keeps the old one. This read-back REPORTS that, it does
    // not repair it — re-syncing to the previous range is a second write that
    // can fail in turn. Say so out loud rather than return a clean success.
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!hit) {
    return {
      error:
        "This invoice left Draft while the period was being changed — the period was not saved. Reopen it as a draft and try again.",
    };
  }
  revalidatePath("/trips");
  return { error: null };
}

// Returns the new row's id (Finance polish batch D) — lets the caller chain
// an immediate uploadSpecialChargeImage() when the add-charge form has a
// staged file, all within one form submit ("attach while adding").
export async function addSpecialCharge(
  invoiceId: string,
  label: string,
  chargeDate: string | null,
  quantity: number,
  priceSar: number,
): Promise<ActionResult<{ id: string }>> {
  const supabase = createClient();
  const { data: invoice } = await supabase.from("invoices").select("status").eq("id", invoiceId).single();
  if (!invoice || !canEditSpecialCharges(invoice.status)) {
    return { error: "Special charges can only be edited while the invoice is Draft or Review." };
  }
  const amountSar = round2(priceSar * quantity);
  const { data, error } = await supabase
    .from("invoice_special_charges")
    .insert({
      invoice_id: invoiceId,
      label,
      amount_sar: amountSar,
      charge_date: chargeDate,
      quantity,
      price_sar: priceSar,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not add the charge." };
  revalidatePath("/trips");
  return { error: null, data: { id: data.id } };
}

export async function removeSpecialCharge(invoiceId: string, chargeId: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data: invoice } = await supabase.from("invoices").select("status").eq("id", invoiceId).single();
  if (!invoice || !canEditSpecialCharges(invoice.status)) {
    return { error: "Special charges can only be edited while the invoice is Draft or Review." };
  }
  // Best-effort image cleanup — read the path first so a storage failure
  // never blocks the row delete itself (an orphaned Storage object is a
  // harmless leak; a charge stuck because Storage hiccuped is not).
  const { data: charge } = await supabase
    .from("invoice_special_charges")
    .select("image_path")
    .eq("id", chargeId)
    .maybeSingle();
  const { error } = await supabase.from("invoice_special_charges").delete().eq("id", chargeId);
  if (error) return { error: error.message };
  if (charge?.image_path) {
    await supabase.storage.from(SPECIAL_CHARGE_IMAGE_BUCKET).remove([charge.image_path]);
  }
  revalidatePath("/trips");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Special charge image — optional, internal-only attachment (e.g. a receipt
// photo). Never surfaced on the customer-facing invoice/print/PDF (migration
// 0032 header) — this pair is only ever called from an internal control next
// to the charge row. Private bucket + short-lived signed URL, same pattern
// as getProofSignedUrl()/markInvoicePaid() above. Storage key is app-
// generated (`${invoiceId}/${chargeId}-${timestamp}.${ext}`), never the raw
// uploaded filename — the exact thing that broke before (0032 header).
// ---------------------------------------------------------------------------
export async function uploadSpecialChargeImage(invoiceId: string, chargeId: string, formData: FormData): Promise<ActionResult> {
  const supabase = createClient();
  const { data: invoice } = await supabase.from("invoices").select("status").eq("id", invoiceId).single();
  if (!invoice || !canEditSpecialCharges(invoice.status)) {
    return { error: "Special charges can only be edited while the invoice is Draft or Review." };
  }
  const file = formData.get("imageFile");
  if (!(file instanceof File) || file.size === 0) return { error: "No image file provided." };

  const extMatch = /\.([a-zA-Z0-9]{1,10})$/.exec(file.name);
  const ext = extMatch ? extMatch[1].toLowerCase() : "bin";
  const imagePath = `${invoiceId}/${chargeId}-${Date.now()}.${ext}`;

  const { error: uploadErr } = await supabase.storage.from(SPECIAL_CHARGE_IMAGE_BUCKET).upload(imagePath, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (uploadErr) return { error: `Image upload failed: ${uploadErr.message}` };

  const { error } = await supabase
    .from("invoice_special_charges")
    .update({ image_path: imagePath })
    .eq("id", chargeId);
  if (error) return { error: error.message };
  revalidatePath("/trips");
  return { error: null };
}

export async function getSpecialChargeImageSignedUrl(chargeId: string): Promise<ActionResult<{ url: string }>> {
  const supabase = createClient();
  const { data: charge, error: chargeErr } = await supabase
    .from("invoice_special_charges")
    .select("image_path")
    .eq("id", chargeId)
    .single();
  if (chargeErr || !charge) return { error: chargeErr?.message ?? "Special charge not found." };
  if (!charge.image_path) return { error: "No image on file for this charge." };

  const { data, error } = await supabase.storage
    .from(SPECIAL_CHARGE_IMAGE_BUCKET)
    .createSignedUrl(charge.image_path, 300);
  if (error || !data) return { error: error?.message ?? "Could not generate a link to the image." };
  return { error: null, data: { url: data.signedUrl } };
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
export async function getInvoice(
  invoiceId: string,
): Promise<ActionResult<Invoice & { projectWaterType: WaterType | null; projectPaymentMode: PaymentMode }>> {
  const supabase = createClient();
  const { data, error } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
  if (error || !data) return { error: error?.message ?? "Invoice not found." };
  // Display-only fallback (Finance polish batch C): old/frozen invoice line
  // snapshots predate the water_type field and store null for it. We resolve
  // the project's CURRENT water_type here so the UI can show a real label
  // instead of "—" — this never touches the frozen snapshot itself (covered_
  // lines/unpaid_lines stay exactly as confirm_invoice() wrote them).
  //
  // projectPaymentMode: the customer's CURRENT project.payment_mode — used by
  // the caller ONLY as a fallback for frozen invoices predating migration
  // 0037's payment_mode snapshot (raw.payment_mode == null). See
  // getInvoicePdf()'s identical fallback for the rationale.
  const invoice = data as Invoice;
  const { data: project } = await supabase
    .from("projects")
    .select("water_type, payment_mode")
    .eq("customer_id", invoice.customer_id)
    .maybeSingle();
  return {
    error: null,
    data: {
      ...invoice,
      projectWaterType: (project?.water_type as WaterType | null) ?? null,
      projectPaymentMode: (project?.payment_mode as PaymentMode | null) ?? "postpaid",
    },
  };
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
// Undelivered-trip blockers (Finance polish batch B, item 2) — mirrors the
// SERVER-SIDE guard added to confirm_invoice() (migration 0032) predicate
// for predicate: same project (via customer_id), same period bounds, same
// delivered_at is null filter — so the UI's block reason and the DB's hard
// block can never disagree. Note consumingItems()/splitCoveredUnpaidItems()
// (lib/prepaid.ts) filter OUT undelivered trips entirely, so this can't be
// derived from the assembly — it's a separate raw query.
// ---------------------------------------------------------------------------
export type UndeliveredTripBlocker = { id: string; trip_date: string; ref: string | null };

export async function getUndeliveredTripsForInvoice(invoiceId: string): Promise<ActionResult<UndeliveredTripBlocker[]>> {
  const supabase = createClient();
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("customer_id, period_start, period_end")
    .eq("id", invoiceId)
    .single();
  if (invErr || !invoice) return { error: invErr?.message ?? "Invoice not found." };

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id")
    .eq("customer_id", invoice.customer_id)
    .single();
  if (projErr || !project) return { error: projErr?.message ?? "No project found for this customer." };

  const { data: tripRows, error: tripErr } = await supabase
    .from("trips")
    .select("id, trip_date, ref")
    .eq("project_id", project.id)
    .gte("trip_date", invoice.period_start)
    .lte("trip_date", invoice.period_end)
    .is("delivered_at", null)
    .order("trip_date", { ascending: true });
  if (tripErr) return { error: tripErr.message };
  return { error: null, data: (tripRows ?? []) as UndeliveredTripBlocker[] };
}

// ---------------------------------------------------------------------------
// Confirm — THE atomic Review -> Confirmed transition. Assembly runs here in
// TS (pure, harnessed); the SQL function only persists the already-computed
// result alongside the gap-free invoice number claim, atomically.
// ---------------------------------------------------------------------------
export async function confirmInvoice(invoiceId: string): Promise<ActionResult<{ invoiceNumber: string }>> {
  const supabase = createClient();

  const { data: invoice } = await supabase.from("invoices").select("status").eq("id", invoiceId).single();
  if (!invoice || invoice.status !== "review") {
    return { error: "Invoice must be in Review status before it can be confirmed." };
  }

  const { error: assembleErr, assembly } = await assembleForInvoice(invoiceId);
  if (assembleErr || !assembly) return { error: assembleErr ?? "Could not assemble invoice for confirm." };

  const coveredTripIds = assembly.coveredLines.filter((l) => l.kind === "trip").map((l) => l.id);
  const unpaidTripIds = assembly.unpaidLines.filter((l) => l.kind === "trip").map((l) => l.id);
  // v3: prepaid keeps ALL its charges (covered + uncovered) in the dedicated
  // chargeLines table; postpaid keeps the old v2 shape (charges merged into
  // unpaidLines). Either way this is a full InvoiceLine snapshot now, not the
  // old ad-hoc {id,label,amount_sar,vat_sar} shape — matches InvoiceLineSnapshot.
  const specialChargesSnapshot =
    assembly.paymentMode === "postpaid"
      ? assembly.unpaidLines.filter((l) => l.kind === "charge")
      : assembly.chargeLines;

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
    p_covered_ledger_subtotal: assembly.ledger?.covered.subtotal ?? null,
    p_covered_ledger_balance: assembly.ledger?.covered.balance ?? null,
    p_covered_ledger_remaining: assembly.ledger?.covered.remaining ?? null,
    p_unpaid_ledger_subtotal: assembly.ledger?.unpaid.subtotal ?? null,
    p_unpaid_ledger_balance: assembly.ledger?.unpaid.balance ?? null,
    p_unpaid_ledger_remaining: assembly.ledger?.unpaid.remaining ?? null,
    p_payment_mode: assembly.paymentMode,
  });
  if (error) return { error: error.message };
  revalidatePath("/trips");
  return { error: null, data: { invoiceNumber: data?.invoice_number ?? "" } };
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
//
// v3 Batch 2 (migration 0039, APPLIED) — three postpaid-only fields:
// reference/date/note. bank_transfer requires reference AND date (a real bank
// transaction exists to point to — same reasoning as the existing proof-file
// requirement); cash leaves both optional. note is always optional. Trimmed to
// null here (not in the RPC), same convention as recordTopup
// (lib/actions/finance.ts).
//
// THREE METHODS, AND 'balance' IS NOT A THIRD WAY TO HAND OVER MONEY.
// 'balance' (migration 0134) is what prepaid's "Pay with Balance" writes: the
// prepaid engine already deducted the money at delivery / add-to-draft, so this
// records WHICH settlement happened. It therefore requires no proof file, no
// reference and no date — the bank_transfer branch below is the only one that
// gates on those, and 'balance' deliberately does not fall into it. Sending
// those fields would be inventing a bank transaction that never took place.
//
// THIS ALLOWLIST IS NOT THE PREPAID GUARD, AND MUST NOT BE MISTAKEN FOR IT.
// It admits 'balance' flatly. What refuses 'balance' on a POSTPAID invoice is
// pay_invoice() itself (0134), which resolves the invoice's mode — snapshot
// first, else the customer's project mode — BEFORE its update and raises if the
// result is not exactly 'prepaid'. Enforcement is server-side in the database on
// purpose: a client-side check here would be bypassable and would also be a
// second expression of a money rule. If that error surfaces to a user, the RPC's
// message is what they see, unwrapped.
// ---------------------------------------------------------------------------
export async function markInvoicePaid(formData: FormData): Promise<ActionResult> {
  const supabase = createClient();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const paymentMethod = String(formData.get("paymentMethod") ?? "");
  const file = formData.get("proofFile");
  const reference = String(formData.get("paymentReference") ?? "").trim() || null;
  const paymentDate = String(formData.get("paymentDate") ?? "").trim() || null;
  const note = String(formData.get("paymentNote") ?? "").trim() || null;

  if (!invoiceId) return { error: "Missing invoice id." };
  if (paymentMethod !== "cash" && paymentMethod !== "bank_transfer" && paymentMethod !== "balance") {
    return { error: "Payment method must be cash, bank_transfer or balance." };
  }

  let proofPath: string | null = null;
  if (paymentMethod === "bank_transfer") {
    if (!(file instanceof File) || file.size === 0) {
      return { error: "bank_transfer requires a proof-of-payment file." };
    }
    if (!reference) return { error: "bank_transfer requires a payment reference." };
    if (!paymentDate) return { error: "bank_transfer requires a payment date." };
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
    p_payment_reference: reference,
    p_payment_date: paymentDate,
    p_payment_note: note,
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
// v3 §9 — Amount Due hide toggle (migration 0036). A display preference, not
// frozen financial data: a plain `.update()`, editable regardless of invoice
// status (unlike every *_sar column, which is only ever written by
// confirm_invoice()). Governs print/PDF/email only — always visible on-screen
// to staff, per spec.
// ---------------------------------------------------------------------------
export async function setHideAmountDue(invoiceId: string, hide: boolean): Promise<ActionResult> {
  const supabase = createClient();

  // DROP THE CACHED PDF FIRST. getInvoicePdf() caches the rendered bytes for
  // confirmed/paid/void invoices on the premise that an issued document cannot
  // change (0027). This column is the ONE exception to that premise — it is a
  // display preference, deliberately editable at any status (see the header
  // above) — so without this the toggle moved the screen and the download kept
  // serving the document it rendered the first time, forever. It is not a
  // rendering bug; the renderer is never reached.
  //
  // ORDER IS DELIBERATE: clear, THEN write. If the clear fails we abort with
  // the flag unchanged, so the screen and the file still agree. Writing first
  // and clearing second would, on a failed clear, leave the preference flipped
  // and the download stale under a success message — the exact failure being
  // fixed. Losing a cache entry to a later failed write costs one regeneration
  // of identical bytes; nothing is destroyed that is not derived.
  const { error: cacheErr } = await supabase.storage.from(PDF_BUCKET).remove([`${invoiceId}.pdf`]);
  if (cacheErr) return { error: cacheErr.message };

  const { error } = await supabase.from("invoices").update({ hide_amount_due: hide }).eq("id", invoiceId);
  if (error) return { error: error.message };
  revalidatePath("/trips");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Company settings — email only (0029). Read-only convenience kept for
// InvoiceDetailModal's mailto signature (the only other caller); the
// CompanySettingsModal form itself now uses the fuller pair below (Batch D).
// Table is a singleton (id = true) — no id param needed.
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

// Batch D (invoice header restructure) — full company_settings get/set pair.
// legal_name is labeled "CR Company Name" and vat_number "VAT Registration
// Number" in the UI; the DB columns keep their original names (same "value
// stays, label changes" pattern as INVOICE_STATUS_LABELS in lib/db-types.ts).
// description/telephone/phone are new (migration 0041). All fields here are
// nullable/optional — required going forward is a form-layer nicety, not
// enforced by a NOT NULL (no backfill for existing rows).
export async function getCompanySettings(): Promise<ActionResult<CompanySettings>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("company_settings")
    .select("*")
    .eq("id", true)
    .single();
  if (error) return { error: error.message };
  return { error: null, data: data as CompanySettings };
}

export type CompanySettingsInput = {
  legal_name: string;
  legal_name_ar: string | null;
  vat_number: string | null;
  cr_number: string | null;
  address: string | null;
  email: string | null;
  description: string | null;
  telephone: string | null;
  phone: string | null;
  // Added by migration 0063 (Maintenance labor costing) — the single
  // company-wide working-days-per-month constant. Lives here (not on
  // staff) because it's one work calendar, not one per employee.
  standard_working_days_per_month: number;
};

export async function updateCompanySettings(input: CompanySettingsInput): Promise<ActionResult> {
  const legalName = input.legal_name.trim();
  if (!legalName) return { error: "CR Company Name is required." };
  if (!(input.standard_working_days_per_month > 0)) {
    return { error: "Working days per month must be a positive number." };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from("company_settings")
    .update({
      legal_name: legalName,
      legal_name_ar: input.legal_name_ar?.trim() || null,
      vat_number: input.vat_number?.trim() || null,
      cr_number: input.cr_number?.trim() || null,
      address: input.address?.trim() || null,
      email: input.email?.trim() || null,
      description: input.description?.trim() || null,
      telephone: input.telephone?.trim() || null,
      phone: input.phone?.trim() || null,
      standard_working_days_per_month: input.standard_working_days_per_month,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);
  if (error) return { error: error.message };
  revalidatePath("/trips");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Company bank accounts (migration 0184) — the invoice's Transfer Details.
//
// A SEPARATE PAIR, not extra fields on CompanySettingsInput above. Three
// reasons, in order of weight:
//
//  1. The identity form saves one flat record; this saves an ARRAY with its own
//     add/remove/reorder semantics and its own per-element validation. Folding
//     them together would mean a failed IBAN checksum rejects an unrelated
//     address edit, and vice versa.
//  2. `updateCompanySettings` is the write path for values that are SNAPSHOTTED
//     ONTO INVOICES at confirm. So is this one — see below — but the two have
//     different failure modes and deserve to fail independently.
//  3. The settings screen renders them as two cards with two Save buttons,
//     because that is what an operator expects of two unrelated things.
//
// SNAPSHOT NOTE, and it is not incidental: `assembleForCustomerPeriod` captures
// the seller with `select("*")`, so from the moment 0184 landed, EVERY newly
// confirmed invoice freezes the bank_accounts array into its `seller_snapshot`
// with no assembly change. That is the behaviour we want (see the view-model's
// bank block for why an issued document reads its own frozen copy), but it does
// mean this column is now invoice-facing history, not just a live setting.
// Editing it never rewrites a snapshot — 0027 — it only changes what the NEXT
// confirm freezes.
//
// IBANs are never logged here or anywhere downstream.
// ---------------------------------------------------------------------------
export async function getCompanyBankAccounts(): Promise<ActionResult<CompanyBankAccount[]>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("company_settings")
    .select("bank_accounts")
    .eq("id", true)
    .single();
  if (error) return { error: error.message };
  // Parsed, never cast: 0184's CHECK does not police element shape, so the
  // column can legally hold something this type does not describe.
  return { error: null, data: parseBankAccounts(data?.bank_accounts) };
}

export async function updateCompanyBankAccounts(
  accounts: CompanyBankAccount[],
): Promise<ActionResult> {
  // Server-side shape enforcement — the half of 0184's bargain the database
  // deliberately does not carry. The form validates first for a good message in
  // the operator's own language; this is the gate that actually holds, because
  // a server action is callable without the form.
  const checked = validateBankAccounts(accounts);
  if (!checked.ok) {
    const e = checked.error;
    // Plain English, matching updateCompanySettings' own literals above. The
    // caller renders its localized copy from the same codes; this is the
    // backstop nobody should normally see.
    const message =
      e.code === "too_many"
        ? `Up to ${MAX_BANK_ACCOUNTS} bank accounts.`
        : e.code === "bank_name_required"
          ? `Account ${e.index + 1}: bank name is required.`
          : e.code === "holder_name_required"
            ? `Account ${e.index + 1}: account name is required.`
            : // Never echo the value back — it is the one field here worth not
              // repeating into an error string that may end up in a log.
              `Account ${e.index + 1}: invalid IBAN.`;
    return { error: message };
  }

  const supabase = createClient();
  // WHOLE-ARRAY REPLACE, one atomic write. Not a per-element merge: display
  // order is the array's order, so a partial update has no meaning here, and
  // two concurrent edits should produce one of the two intended lists rather
  // than an interleaving neither operator asked for.
  const { error } = await supabase
    .from("company_settings")
    .update({ bank_accounts: checked.accounts, updated_at: new Date().toISOString() })
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

type SellerSnap = Pick<
  CompanySettings,
  | "legal_name"
  | "legal_name_ar"
  | "vat_number"
  | "cr_number"
  | "address"
  | "description"
  | "telephone"
  | "phone"
  // 0184 — rides along on the same `select("*")` capture. `unknown` on
  // CompanySettings, so it stays `unknown` here and reaches the view-model only
  // through parseBankAccounts.
  | "bank_accounts"
> | null;
type BuyerSnap = Pick<Customer, "name" | "name_ar" | "vat_number" | "cr_number" | "billing_address"> | null;

// Batch D — widened for the 3-section header (name_ar buyer-only,
// description/telephone/phone seller-only; toIdentity is shared by both, the
// unused side of each field simply stays undefined/null).
function toIdentity(opts: {
  name?: string | null;
  name_ar?: string | null;
  vat?: string | null;
  cr?: string | null;
  address?: string | null;
  description?: string | null;
  telephone?: string | null;
  phone?: string | null;
}): PdfIdentity {
  const { name = null, name_ar = null, vat = null, cr = null, address = null, description = null, telephone = null, phone = null } = opts;
  if (!name && !name_ar && !vat && !cr && !address && !description && !telephone && !phone) return null;
  return { name, name_ar, vat_number: vat, cr_number: cr, address, description, telephone, phone };
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

  // ONE project read for BOTH of the things this function needs off it — the
  // display-only water_type fallback and the pre-0037 payment_mode fallback.
  // The mode fallback used to run its own query inside the frozen branch; two
  // round trips to the same 1:1 row, and only one of them cached its result
  // anywhere. Hoisted above the cache check would be wasteful, so it sits
  // here: after the cache short-circuit, before either branch.
  //
  // water_type: an invoice line snapshot frozen before the field existed
  // stores null, and this document has a Type column. Without the project's
  // CURRENT type the download printed a dash where the sheet — which has had
  // this fallback since Finance polish batch C — printed a real label. Same
  // fallback, same source, display-only: the frozen snapshot is never touched.

  // Cache hit: reuse the previously-generated bytes, skip the provider call.
  if (cacheable) {
    const { data: cached } = await supabase.storage.from(PDF_BUCKET).download(storagePath);
    if (cached) {
      const buf = Buffer.from(await cached.arrayBuffer());
      return { error: null, data: { base64: buf.toString("base64"), filename } };
    }
  }

  const { data: project } = await supabase
    .from("projects")
    .select("water_type, payment_mode")
    .eq("customer_id", inv.customer_id)
    .maybeSingle();
  const projectWaterType = (project?.water_type as WaterType | null | undefined) ?? null;

  let pdfData: PdfInvoiceData;

  if (inv.status === "draft" || inv.status === "review") {
    const { error: asmErr, assembly } = await assembleForInvoice(invoiceId);
    if (asmErr || !assembly) return { error: asmErr ?? "Could not assemble invoice for PDF." };
    const seller = assembly.sellerSnapshot as SellerSnap;
    const buyer = assembly.buyerSnapshot as BuyerSnap;
    pdfData = {
      status: inv.status,
      paymentMode: assembly.paymentMode,
      invoiceNumber: inv.invoice_number,
      periodStart: inv.period_start,
      periodEnd: inv.period_end,
      // Draft/review is unconfirmed — no issue date exists yet.
      issueDate: null,
      seller: toIdentity({
        name: seller?.legal_name,
        name_ar: seller?.legal_name_ar ?? null,
        vat: seller?.vat_number ?? null,
        cr: seller?.cr_number ?? null,
        address: seller?.address ?? null,
        description: seller?.description ?? null,
        telephone: seller?.telephone ?? null,
        phone: seller?.phone ?? null,
      }),
      buyer: toIdentity({
        name: buyer?.name,
        name_ar: buyer?.name_ar ?? null,
        vat: buyer?.vat_number ?? null,
        cr: buyer?.cr_number ?? null,
        address: buyer?.billing_address ?? null,
      }),
      buyerEmail: assembly.customerEmail,
      // RAW jsonb, straight off the seller row the assembly just read — the
      // view-model parses and filters it. Draft/review reads LIVE company
      // settings here, which is correct: nothing about this document is frozen
      // yet, and a draft should preview the accounts it will actually freeze.
      bankAccounts: seller?.bank_accounts ?? null,
      coveredLines: assembly.coveredLines,
      unpaidLines: assembly.unpaidLines,
      chargeLines: assembly.chargeLines,
      covered: assembly.covered,
      amountDue: assembly.amountDue,
      grand: assembly.grand,
      ledger: assembly.ledger,
      hideAmountDue: inv.hide_amount_due,
      paymentMethod: null,
      paidAt: null,
      voidReason: null,
      projectWaterType,
      voidedAt: null,
    };
  } else {
    const seller = inv.seller_snapshot;
    const buyer = inv.buyer_snapshot;
    // Frozen invoices predating migration 0037 have no `payment_mode`
    // snapshot — fall back to the customer's CURRENT project.payment_mode.
    // Correct for every invoice confirmed before any mode switch (the
    // overwhelming majority); see migration 0037's header for the tradeoff.
    const paymentMode: PaymentMode =
      inv.payment_mode ?? (project?.payment_mode as PaymentMode | null | undefined) ?? "postpaid";
    const isPrepaid = paymentMode === "prepaid";
    pdfData = {
      status: inv.status,
      paymentMode,
      invoiceNumber: inv.invoice_number,
      periodStart: inv.period_start,
      periodEnd: inv.period_end,
      // Confirmed/paid/void — issue date is confirmed_at (frozen the instant
      // this invoice left draft/review).
      issueDate: inv.confirmed_at,
      seller: toIdentity({
        name: seller?.legal_name,
        name_ar: seller?.legal_name_ar ?? null,
        vat: seller?.vat_number ?? null,
        cr: seller?.cr_number ?? null,
        address: seller?.address ?? null,
        description: seller?.description ?? null,
        telephone: seller?.telephone ?? null,
        phone: seller?.phone ?? null,
      }),
      buyer: toIdentity({
        name: buyer?.name,
        name_ar: buyer?.name_ar ?? null,
        vat: buyer?.vat_number ?? null,
        cr: buyer?.cr_number ?? null,
        address: buyer?.billing_address ?? null,
      }),
      // Snapshot never retained an email (buyer_snapshot's Pick<Customer,...>
      // has no email field) — omitted rather than re-fetched live, consistent
      // with "frozen means frozen".
      buyerEmail: null,
      // THE FROZEN COPY, and no live fallback — deliberately.
      //
      // An invoice confirmed after 0184 carries its bank accounts in
      // seller_snapshot (captured by the same `select("*")` as every other
      // seller field), so it prints the instructions it was ISSUED with even
      // after the company adds, removes or unticks an account. 0027, unchanged.
      //
      // One confirmed BEFORE 0184 has no such key and therefore prints NO
      // Transfer Details at all. That is the honest outcome, not a gap to patch
      // with today's accounts: those documents were issued without payment
      // instructions and are already with the customer, and quietly grafting
      // current details onto an old issued invoice would make the file disagree
      // with the copy in the customer's hands.
      //
      // It also keeps the two surfaces in step. The popup reads the same frozen
      // key, and the download's cached bytes can never drift from it — a live
      // read here would leave every previously-cached PDF showing the old
      // account while the sheet beside it showed the new one.
      bankAccounts: seller?.bank_accounts ?? null,
      coveredLines: inv.covered_lines ?? [],
      // Prepaid (v3): unpaid_lines is trips-only already. Postpaid: unchanged
      // (trips + charges merged, exactly as frozen).
      unpaidLines: inv.unpaid_lines ?? [],
      chargeLines: isPrepaid ? (inv.special_charges_snapshot ?? []) : [],
      covered: { subtotal: inv.covered_subtotal_sar, vat: inv.covered_vat_sar, total: inv.covered_total_sar },
      amountDue: { subtotal: inv.amount_due_subtotal_sar, vat: inv.amount_due_vat_sar, total: inv.amount_due_sar },
      grand: { subtotal: inv.grand_subtotal_sar, vat: inv.grand_vat_sar, total: inv.grand_total_sar },
      // Passed RAW: present when the row carries a 0036+ ledger snapshot,
      // `undefined` otherwise. The pre-0036 legacy fallback (real subtotal off
      // the frozen document totals, null balance/remaining so the document
      // prints a dash rather than a fabricated 0) is NOT restated here — the
      // view-model owns that single expression for both surfaces. `?? 0` below
      // is type narrowing on a row whose non-null subtotals prove the snapshot
      // exists, and it is the popup's own line, verbatim.
      ledger:
        isPrepaid && inv.covered_ledger_subtotal_sar != null && inv.unpaid_ledger_subtotal_sar != null
          ? {
              covered: {
                subtotal: inv.covered_ledger_subtotal_sar,
                balance: inv.covered_ledger_balance_sar ?? 0,
                remaining: inv.covered_ledger_remaining_sar ?? 0,
              },
              unpaid: {
                subtotal: inv.unpaid_ledger_subtotal_sar,
                balance: inv.unpaid_ledger_balance_sar ?? 0,
                remaining: inv.unpaid_ledger_remaining_sar ?? 0,
              },
            }
          : undefined,
      hideAmountDue: inv.hide_amount_due,
      paymentMethod: inv.payment_method,
      paidAt: inv.paid_at,
      voidReason: inv.void_reason,
      projectWaterType,
      voidedAt: inv.voided_at,
    };
  }

  const html = await buildInvoicePdfHtml(pdfData);

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
