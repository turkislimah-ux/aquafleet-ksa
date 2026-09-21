// =============================================================================
// lib/customer-ledger.ts — THE ONLY READER of the customer_ledger model (0203).
// =============================================================================
// Every prepaid money figure on a Batch-1 surface comes through here, and every
// figure it returns comes straight from a database view or table column — this
// module does NO arithmetic and NO rounding, ever. Balance, Uninvoiced and
// Available are three view columns, not computations:
//
//   Balance    = v_customer_ledger_balance.balance_sar   (sum of ledger rows)
//   Uninvoiced = v_customer_uninvoiced.uninvoiced_sar    (delivered, not drawn)
//   Available  = v_customer_available.available_sar      (Balance − Uninvoiced,
//                                                         computed IN the view)
//
// Nothing here reads v_customer_prepaid_balance, v_customer_amount_payable, or
// lib/prepaid.ts's derived balance — those legacy readers keep serving the
// Batch 2–3 surfaces until 0204 drops them. Writes never happen here either:
// they go through the SECURITY DEFINER RPCs (record_topup, record_refund,
// propose_ledger_correction, vote_ledger_correction) via lib/actions/finance.ts.

import type { SupabaseClient } from "@supabase/supabase-js";

// -----------------------------------------------------------------------------
// Row shapes — mirror the view/table columns byte-for-byte. numeric comes back
// as number through supabase-js; we type it as number and pass it through.
// -----------------------------------------------------------------------------

export type CustomerLedgerBalanceRow = {
  customer_id: string;
  customer_name: string;
  balance_sar: number;
};

export type CustomerUninvoicedRow = {
  customer_id: string;
  customer_name: string;
  trip_uninvoiced_sar: number;
  charge_uninvoiced_sar: number;
  uninvoiced_sar: number;
};

export type CustomerAvailableRow = {
  customer_id: string;
  customer_name: string;
  balance_sar: number;
  uninvoiced_sar: number;
  available_sar: number;
};

export type LedgerEntryType =
  | "topup"
  | "invoice_draw"
  | "balance_applied"
  | "refund"
  | "correction"
  | "draw_reversal";

export type LedgerEntryRow = {
  id: string;
  customer_id: string;
  entry_type: LedgerEntryType;
  amount_sar: number;
  invoice_id: string | null;
  doc_number: string | null;
  reversal_of: string | null;
  method: string | null;
  reference: string | null;
  photo_path: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  // Joined for display: the human invoice number behind invoice-linked rows.
  invoice: { invoice_number: string | null } | null;
};

// PER-INVOICE SETTLEMENT — v_invoice_settlement, the ONE place the app may ask
// "how much of this invoice is still outstanding". Never derive it from
// invoices.status, payment_method or paid_at: those three are display-only
// history since 0203 and a partially-paid invoice still reads `confirmed` with
// a null payment_method.
//
// `payable_sar` is NULL in exactly two cases, and they mean different things:
//   - a DRAFT/REVIEW invoice: nothing has been confirmed, so no draw has
//     happened and no payable has been frozen.
//   - a LEGACY invoice confirmed before 0203: it was settled under the old
//     model and must stay on the old flow.
// `remainder_sar` is NULL alongside it. A caller that needs to tell the two
// apart tests the invoice's status, not this row.
export type InvoiceSettlementRow = {
  invoice_id: string;
  customer_id: string;
  invoice_number: string | null;
  status: string;
  payable_sar: number | null;
  paid_sar: number;
  applied_sar: number;
  written_off_sar: number;
  remainder_sar: number | null;
};

// One recorded payment against one invoice. APPEND-ONLY by grant: authenticated
// holds SELECT and nothing else, so these rows arrive through
// record_invoice_payment() and are never edited or deleted — voiding an invoice
// reverses the ledger and leaves its payments standing.
export type InvoicePaymentRow = {
  id: string;
  invoice_id: string;
  amount_sar: number;
  method: "cash" | "bank_transfer";
  reference: string | null;
  proof_path: string | null;
  paid_on: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type LedgerCorrectionStatus = "pending" | "approved" | "rejected";

export type LedgerCorrectionRow = {
  id: string;
  customer_id: string;
  amount_sar: number;
  reason: string;
  status: LedgerCorrectionStatus;
  proposed_by: string;
  ledger_entry_id: string | null;
  created_at: string;
  decided_at: string | null;
};

export type LedgerCorrectionVoteRow = {
  id: string;
  correction_id: string;
  approver_email: string;
  action: "approve" | "reject";
  comment: string | null;
  voted_at: string;
};

// -----------------------------------------------------------------------------
// Reads. All ordered deterministically; callers group/filter in memory.
// -----------------------------------------------------------------------------

type Db = SupabaseClient;

export async function fetchLedgerBalances(supabase: Db) {
  return supabase
    .from("v_customer_ledger_balance")
    .select("customer_id, customer_name, balance_sar")
    .order("customer_name")
    .returns<CustomerLedgerBalanceRow[]>();
}

export async function fetchUninvoiced(supabase: Db) {
  return supabase
    .from("v_customer_uninvoiced")
    .select("customer_id, customer_name, trip_uninvoiced_sar, charge_uninvoiced_sar, uninvoiced_sar")
    .order("customer_name")
    .returns<CustomerUninvoicedRow[]>();
}

export async function fetchAvailable(supabase: Db) {
  return supabase
    .from("v_customer_available")
    .select("customer_id, customer_name, balance_sar, uninvoiced_sar, available_sar")
    .order("customer_name")
    .returns<CustomerAvailableRow[]>();
}

// ONE customer's Available. Same view, same column, filtered — for the
// surfaces that already know whose money they are looking at (an invoice
// popup, a trip form) and must not pull every customer to find one row.
export async function fetchCustomerAvailable(supabase: Db, customerId: string) {
  return supabase
    .from("v_customer_available")
    .select("customer_id, customer_name, balance_sar, uninvoiced_sar, available_sar")
    .eq("customer_id", customerId)
    .maybeSingle<CustomerAvailableRow>();
}

// Full ledger, all customers, oldest-first inside each customer — the order a
// running balance is presented in. Running balance itself is presentation
// (cumulative display of amount_sar down the rows), never persisted and never
// used as a source figure: the headline Balance is always the view's.
export async function fetchLedgerEntries(supabase: Db) {
  return supabase
    .from("customer_ledger")
    .select(
      "id, customer_id, entry_type, amount_sar, invoice_id, doc_number, reversal_of, method, reference, photo_path, note, created_by, created_at, invoice:invoices(invoice_number)",
    )
    .order("customer_id")
    .order("created_at", { ascending: true })
    .returns<LedgerEntryRow[]>();
}

// ONE customer's ledger rows, oldest-first, in the SAME total order the
// statement walks: created_at then id. Just the four columns a walk needs.
//
// WHY A WALK NEEDS ROWS AND NOT A VIEW. The three views answer "what is the
// balance NOW". The ledger-era invoice document has to answer "what was the
// balance either side of THIS invoice's draw", which is a historical point
// and has no view because it is presentation — 0203's sanctioned cumulative
// display of amount_sar down the rows, the same device the statement and the
// ledger popup already perform. The walk itself is NOT done here: this module
// does no arithmetic (see the header). It hands over the rows; the caller
// that needs the figure walks them (app/trips/invoiceActions.ts's
// loadLedgerDraw).
//
// ORDERED BY (created_at, id) TO MATCH THE STATEMENT. Two rows can share a
// timestamp, and if the invoice document and the statement broke that tie
// differently they would report two different balances for one instant — the
// exact class of disagreement the 0036 freeze was dropped for.
export type LedgerWalkRow = {
  id: string;
  amount_sar: number;
  entry_type: LedgerEntryType;
  invoice_id: string | null;
  /** The row this one reverses — set on `draw_reversal` rows only (0203). */
  reversal_of: string | null;
  created_at: string;
};

export async function fetchLedgerWalkRows(supabase: Db, customerId: string) {
  return supabase
    .from("customer_ledger")
    .select("id, amount_sar, entry_type, invoice_id, reversal_of, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .returns<LedgerWalkRow[]>();
}

// ONE invoice's settlement. Single-row read by id — the invoice detail is the
// only surface that needs it, and it already knows which invoice it is.
export async function fetchInvoiceSettlement(supabase: Db, invoiceId: string) {
  return supabase
    .from("v_invoice_settlement")
    .select(
      "invoice_id, customer_id, invoice_number, status, payable_sar, paid_sar, applied_sar, written_off_sar, remainder_sar",
    )
    .eq("invoice_id", invoiceId)
    .maybeSingle<InvoiceSettlementRow>();
}

// Payment history for ONE invoice, oldest-first — the order money arrived, and
// the order a reader reconciles it in.
export async function fetchInvoicePayments(supabase: Db, invoiceId: string) {
  return supabase
    .from("invoice_payments")
    .select("id, invoice_id, amount_sar, method, reference, proof_path, paid_on, note, created_by, created_at")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: true })
    .returns<InvoicePaymentRow[]>();
}

// EVERY customer's payment rows, customer-tagged through the parent invoice —
// the statement's payment source. Oldest-first, the order money arrived and
// the order a statement reads.
//
// WHY IT IS A SEPARATE READER FROM fetchInvoicePayments() ABOVE. That one
// answers "what has been paid on THIS invoice" for the settlement panel, which
// already knows whose invoice it is and needs no join. This one answers "what
// has this customer paid, ever, against anything", which is a different
// question with a different shape: the row has no customer_id of its own, so
// the customer and the invoice NUMBER both have to come off the joined
// invoices row. Widening the per-invoice reader to carry a join no caller of
// it wants would make every settlement panel pay for a column it never reads.
//
// VOID INVOICES ARE EXCLUDED. A payment against a voided document is not an
// event on the account the customer can reconcile — the same rule
// app/trips/page.tsx already applies to special charges, and the same reason.
export type StatementInvoicePaymentJoinedRow = {
  id: string;
  invoice_id: string;
  amount_sar: number;
  method: "cash" | "bank_transfer";
  reference: string | null;
  paid_on: string | null;
  note: string | null;
  created_at: string;
  invoice: { customer_id: string; invoice_number: string; status: string } | null;
};

export async function fetchInvoicePaymentsForStatements(supabase: Db) {
  return supabase
    .from("invoice_payments")
    .select(
      "id, invoice_id, amount_sar, method, reference, paid_on, note, created_at, invoice:invoices(customer_id, invoice_number, status)",
    )
    .order("created_at", { ascending: true })
    .returns<StatementInvoicePaymentJoinedRow[]>();
}

export async function fetchLedgerCorrections(supabase: Db) {
  return supabase
    .from("ledger_corrections")
    .select(
      "id, customer_id, amount_sar, reason, status, proposed_by, ledger_entry_id, created_at, decided_at",
    )
    .order("created_at", { ascending: false })
    .returns<LedgerCorrectionRow[]>();
}

export async function fetchLedgerCorrectionVotes(supabase: Db) {
  return supabase
    .from("ledger_correction_votes")
    .select("id, correction_id, approver_email, action, comment, voted_at")
    .order("voted_at", { ascending: true })
    .returns<LedgerCorrectionVoteRow[]>();
}

// -----------------------------------------------------------------------------
// Uninvoiced-deliveries COUNT — the statement footer needs "N deliveries not
// yet invoiced" and v_customer_uninvoiced deliberately has no count column.
// This restates the view's TRIP predicate exactly (delivered AND (no invoice
// OR the invoice is still draft/review)) and counts rows per customer.
// COUNT ONLY — the footer AMOUNT is always uninvoiced_sar from the view, so
// Balance − footer amount reconciles with Available to the halala.
// -----------------------------------------------------------------------------

type UninvoicedCountTripRow = {
  id: string;
  invoice_id: string | null;
  project: { customer_id: string } | null;
  invoice: { status: string } | null;
};

export async function fetchUninvoicedTripCounts(
  supabase: Db,
): Promise<{ data: Map<string, number> | null; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from("trips")
    .select("id, invoice_id, project:projects(customer_id), invoice:invoices(status)")
    .not("delivered_at", "is", null)
    .returns<UninvoicedCountTripRow[]>();
  if (error) return { data: null, error };

  const counts = new Map<string, number>();
  for (const t of data ?? []) {
    const customerId = t.project?.customer_id;
    if (!customerId) continue;
    const uninvoiced =
      t.invoice_id == null || t.invoice?.status === "draft" || t.invoice?.status === "review";
    if (!uninvoiced) continue;
    counts.set(customerId, (counts.get(customerId) ?? 0) + 1);
  }
  return { data: counts, error: null };
}
