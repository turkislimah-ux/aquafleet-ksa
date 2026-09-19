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
