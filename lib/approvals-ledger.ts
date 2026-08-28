// Approvals Ledger — the shared derivation across BOTH approval systems.
//
// DERIVED, NEVER COPIED. Nothing is written anywhere to put a row in this
// ledger and nothing is written to take it out: a row is here because its
// event has two matching votes, and it leaves the moment that stops being
// true. There is no ledger table, so there is nothing to drift.
//
// FIVE SOURCES, TWO SYSTEMS, ONE SHAPE:
//   Consumption (0094/0095)  exit permits, in-house work orders, OS jobs
//   Inventory                purchase orders, stock receipts
//
// THEY ARE NOT SYMMETRIC, and pretending they were would be the bug. The
// consumption tables are inert and re-votable; the inventory ones are written
// by SECURITY DEFINER RPCs whose completing vote already moved stock and
// flipped the parent's status, which is why every one of those RPCs refuses
// to act once the parent leaves 'pending_approval'. So inventory rows arrive
// here ALREADY LOCKED — not by a 30-day clock but by their own lifecycle —
// and this module marks them that way rather than offering a button that
// would raise.
//
// NOTHING HERE WRITES. Pure functions over rows.

import type {
  ConsumptionApproval, ExitPermit, ExitPermitLine,
  WorkOrder, WorkOrderPart, OutsourcedJob, WorkshopPayment,
  PurchaseOrder, StockReceipt,
} from "./db-types";

// The subject rows are taken as the NARROW shapes this module actually reads,
// not the full table types. The archive page already fetches trimmed work
// orders and jobs for its Truck tab, and demanding the whole row here would
// force it to over-fetch just to satisfy a type.
export type LedgerWorkOrder = Pick<WorkOrder, "id" | "wo_number" | "title" | "status">;
export type LedgerOutsourcedJob = Pick<OutsourcedJob, "id" | "os_number" | "title">;
export type LedgerPurchaseOrder =
  Pick<PurchaseOrder, "id" | "po_number" | "supplier_id" | "total_sar" | "received_total_sar">;
export type LedgerStockReceipt =
  Pick<StockReceipt,
    "id" | "supplier_id" | "received_on" | "receipt_type"
    | "total_cost_sar" | "grand_total_sar" | "rejection_reason">;
import { permitValueSar } from "./exit-permits";
import { fold } from "./consumption-approvals";

// The re-vote window, in days. MUST match migration 0096's
// `interval '30 days'` — the UI hides the buttons, the database refuses the
// write, and they have to agree about when.
export const LEDGER_LOCK_DAYS = 30;

export type LedgerSystem = "consumption" | "inventory";

export type LedgerKind =
  | "exit_permit" | "work_order" | "outsourced_job"
  | "purchase_order" | "stock_receipt";

export type LedgerOutcome = "approved" | "rejected";

// WHY A COMPLETED ROW CANNOT BE RE-VOTED. A VALUE, not a sentence.
//
// This used to be four English strings built right here, which put display
// language inside a module whose own header promises pure derivation over
// rows — and made the reason untranslatable without threading a language into
// a data builder. The wording now lives in the dictionary under
// `archive.ledger.lockReason.*` and is looked up by the one component that
// renders a ledger row. Closed union, so a fifth lock cause fails the build at
// that lookup instead of reaching a screen as a raw key.
//
// The long/short KIND LABELS that used to sit here went the same way, for the
// same reason: nothing outside that component ever read them.
export type LedgerLockReason =
  /** Consumption row past the 30-day window. */
  | "window_elapsed"
  /** A completed PO — approving it set the status and its RPCs refuse again. */
  | "po_status_set"
  /** A rejected receipt — the completing vote already applied its stock effect. */
  | "receipt_rejection_applied"
  /** An approved receipt — its RPCs refuse a vote once it leaves pending. */
  | "receipt_left_pending";

// Same palette as the Consumption tab for the three kinds it shares, so a
// permit is the same blue in both places. The two inventory kinds get their
// own hues rather than reusing one.
export const LEDGER_KIND_PILL: Record<LedgerKind, string> = {
  exit_permit: "bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/25",
  work_order: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/25",
  outsourced_job: "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/25",
  purchase_order: "bg-teal-500/10 text-teal-700 dark:text-teal-300 ring-teal-500/25",
  stock_receipt: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 ring-indigo-500/25",
};

export type LedgerVote = {
  by: string;
  at: string;
  decision: LedgerOutcome;
  comment: string | null;
};

export type LedgerRow = {
  key: string;
  system: LedgerSystem;
  kind: LedgerKind;
  subjectId: string;
  reference: string;
  title: string;
  outcome: LedgerOutcome;
  /** When the event reached its terminal state. The 30-day clock's zero. */
  completedAt: string;
  /** completedAt + LEDGER_LOCK_DAYS. */
  locksAt: string;
  locked: boolean;
  /** Whole days remaining; 0 once locked. */
  daysLeft: number;
  /** Consumption only, and only while unlocked. */
  revotable: boolean;
  /** Why this row cannot be re-voted, when it cannot. */
  lockReason: LedgerLockReason | null;
  valueSar: number | null;
  votes: LedgerVote[];
  reason: string | null;
};

function daysBetween(fromIso: string, toMs: number): number {
  return Math.floor((toMs - new Date(fromIso).getTime()) / 86_400_000);
}

/**
 * Build the ledger.
 *
 * `nowMs` is passed in rather than read here so the whole page renders against
 * ONE instant — otherwise two rows a millisecond apart could disagree about
 * whether the window has closed.
 */
export function buildLedger(input: {
  // --- Consumption ---
  approvals: ConsumptionApproval[];
  permits: ExitPermit[];
  permitLines: ExitPermitLine[];
  workOrders: LedgerWorkOrder[];
  workOrderParts: WorkOrderPart[];
  outsourcedJobs: LedgerOutsourcedJob[];
  workshopPayments: WorkshopPayment[];
  // --- Inventory ---
  poApprovals: { purchase_order_id: string; approver_email: string; comment: string | null; approved_at: string }[];
  purchaseOrders: LedgerPurchaseOrder[];
  receiptApprovals: {
    stock_receipt_id: string; approver_email: string; action: string;
    outcome: string | null; comment: string | null; approved_at: string;
  }[];
  stockReceipts: LedgerStockReceipt[];
  // Neither purchase_orders nor stock_receipts carries a supplier NAME — both
  // hold supplier_id only (checked, not assumed). Resolved by the caller so
  // this module stays free of a suppliers fetch.
  supplierName: (id: string) => string | null;
  nowMs: number;
}): LedgerRow[] {
  const rows: LedgerRow[] = [];

  const finish = (
    base: Omit<LedgerRow, "locksAt" | "locked" | "daysLeft" | "revotable" | "lockReason">,
    system: LedgerSystem,
    inventoryLockReason: LedgerLockReason | null,
  ): LedgerRow => {
    const locksAt = new Date(
      new Date(base.completedAt).getTime() + LEDGER_LOCK_DAYS * 86_400_000,
    ).toISOString();
    const elapsed = daysBetween(base.completedAt, input.nowMs);
    const locked = system === "inventory" || elapsed >= LEDGER_LOCK_DAYS;
    return {
      ...base,
      locksAt,
      locked,
      daysLeft: locked ? 0 : Math.max(0, LEDGER_LOCK_DAYS - elapsed),
      revotable: system === "consumption" && !locked,
      lockReason:
        system === "inventory" ? inventoryLockReason : locked ? "window_elapsed" : null,
    };
  };

  // -------------------------------------------------------------------------
  // CONSUMPTION — completion comes from fold(), the SAME function the
  // Consumption tab uses and the same rule migration 0096 implements in SQL.
  // -------------------------------------------------------------------------
  const byEvent = new Map<string, ConsumptionApproval[]>();
  for (const a of input.approvals) {
    const id = a.exit_permit_id ?? a.work_order_id ?? a.outsourced_job_id;
    if (!id) continue;
    const arr = byEvent.get(id) ?? [];
    arr.push(a);
    byEvent.set(id, arr);
  }

  const consumptionVotes = (rowsFor: ConsumptionApproval[]): LedgerVote[] =>
    rowsFor.map((r) => ({
      by: r.decided_by, at: r.decided_at, decision: r.decision, comment: r.reason,
    }));

  const linesByPermit = new Map<string, ExitPermitLine[]>();
  for (const l of input.permitLines) {
    const arr = linesByPermit.get(l.exit_permit_id) ?? [];
    arr.push(l);
    linesByPermit.set(l.exit_permit_id, arr);
  }

  for (const p of input.permits) {
    if (p.status !== "exited") continue;
    const f = fold(byEvent.get(p.id) ?? [], null);
    if (!f.completedAt || f.status === "pending") continue;
    rows.push(finish({
      key: `exit_permit:${p.id}`,
      system: "consumption",
      kind: "exit_permit",
      subjectId: p.id,
      reference: p.ep_number ?? "—",
      title: p.note?.trim() || "Parts leaving the warehouse",
      outcome: f.status === "approved" ? "approved" : "rejected",
      completedAt: f.completedAt,
      valueSar: permitValueSar(linesByPermit.get(p.id) ?? []),
      votes: consumptionVotes(f.approvals),
      reason: f.rejection?.reason ?? null,
    }, "consumption", null));
  }

  const partsByWo = new Map<string, WorkOrderPart[]>();
  for (const wp of input.workOrderParts) {
    const arr = partsByWo.get(wp.work_order_id) ?? [];
    arr.push(wp);
    partsByWo.set(wp.work_order_id, arr);
  }

  for (const wo of input.workOrders) {
    if (wo.status !== "completed") continue;
    const wps = partsByWo.get(wo.id) ?? [];
    if (wps.length === 0) continue;
    const f = fold(byEvent.get(wo.id) ?? [], null);
    if (!f.completedAt || f.status === "pending") continue;
    rows.push(finish({
      key: `work_order:${wo.id}`,
      system: "consumption",
      kind: "work_order",
      subjectId: wo.id,
      reference: wo.wo_number,
      title: wo.title,
      outcome: f.status === "approved" ? "approved" : "rejected",
      completedAt: f.completedAt,
      valueSar: wps.reduce((n, wp) => n + Number(wp.qty) * Number(wp.unit_price_sar), 0),
      votes: consumptionVotes(f.approvals),
      reason: f.rejection?.reason ?? null,
    }, "consumption", null));
  }

  const paymentsByJob = new Map<string, WorkshopPayment[]>();
  for (const wp of input.workshopPayments) {
    const arr = paymentsByJob.get(wp.outsourced_job_id) ?? [];
    arr.push(wp);
    paymentsByJob.set(wp.outsourced_job_id, arr);
  }

  for (const job of input.outsourcedJobs) {
    const pays = paymentsByJob.get(job.id) ?? [];
    if (pays.length === 0) continue;
    const f = fold(byEvent.get(job.id) ?? [], null);
    if (!f.completedAt || f.status === "pending") continue;
    rows.push(finish({
      key: `outsourced_job:${job.id}`,
      system: "consumption",
      kind: "outsourced_job",
      subjectId: job.id,
      reference: job.os_number,
      title: job.title,
      outcome: f.status === "approved" ? "approved" : "rejected",
      completedAt: f.completedAt,
      valueSar: pays.reduce((n, x) => n + Number(x.grand_total_sar), 0),
      votes: consumptionVotes(f.approvals),
      reason: f.rejection?.reason ?? null,
    }, "consumption", null));
  }

  // -------------------------------------------------------------------------
  // INVENTORY — READ-ONLY. Completion is the 2nd-earliest vote, matching what
  // approve_purchase_order / approve_stock_receipt actually do.
  // -------------------------------------------------------------------------
  const poById = new Map(input.purchaseOrders.map((p) => [p.id, p]));
  const poVotes = new Map<string, typeof input.poApprovals>();
  for (const a of input.poApprovals) {
    const arr = poVotes.get(a.purchase_order_id) ?? [];
    arr.push(a);
    poVotes.set(a.purchase_order_id, arr);
  }

  for (const [poId, votes] of poVotes) {
    // purchase_order_approvals has NO decision column — it records approvals
    // only. A PO rejection is a single-actor write on purchase_orders itself,
    // never a vote, so it can never reach this ledger's two-vote bar.
    if (votes.length < 2) continue;
    const po = poById.get(poId);
    if (!po) continue;
    const ordered = [...votes].sort((a, b) => a.approved_at.localeCompare(b.approved_at));
    rows.push(finish({
      key: `purchase_order:${poId}`,
      system: "inventory",
      kind: "purchase_order",
      subjectId: poId,
      reference: po.po_number,
      title: input.supplierName(po.supplier_id) ?? "Purchase order",
      outcome: "approved",
      completedAt: ordered[1].approved_at,
      // Received-side total when it exists, ordered-side otherwise — the same
      // fallback the inventory tab uses for a pre-0056 PO.
      valueSar: Number(po.received_total_sar ?? po.total_sar ?? 0) || null,
      votes: ordered.map((v) => ({
        by: v.approver_email, at: v.approved_at, decision: "approved" as const, comment: v.comment,
      })),
      reason: null,
    }, "inventory", "po_status_set"));
  }

  const receiptById = new Map(input.stockReceipts.map((r) => [r.id, r]));
  const receiptVotes = new Map<string, typeof input.receiptApprovals>();
  for (const a of input.receiptApprovals) {
    const arr = receiptVotes.get(a.stock_receipt_id) ?? [];
    arr.push(a);
    receiptVotes.set(a.stock_receipt_id, arr);
  }

  for (const [receiptId, votes] of receiptVotes) {
    if (votes.length < 2) continue;
    const receipt = receiptById.get(receiptId);
    if (!receipt) continue;
    const ordered = [...votes].sort((a, b) => a.approved_at.localeCompare(b.approved_at));
    // The two votes MATCH by construction — the RPC refuses a second vote
    // that disagrees — so either one names the outcome.
    const rejected = ordered[0].action === "reject";
    rows.push(finish({
      key: `stock_receipt:${receiptId}`,
      system: "inventory",
      kind: "stock_receipt",
      subjectId: receiptId,
      // stock_receipts has no receipt NUMBER of its own (checked) — the
      // inventory tab identifies one by supplier and date, so this does the
      // same rather than inventing a reference that exists nowhere else.
      reference: `${receipt.receipt_type === "po" ? "PO receipt" : "Direct"} · ${receipt.received_on}`,
      title: input.supplierName(receipt.supplier_id) ?? "Stock receipt",
      outcome: rejected ? "rejected" : "approved",
      completedAt: ordered[1].approved_at,
      valueSar: Number(receipt.grand_total_sar || receipt.total_cost_sar || 0) || null,
      votes: ordered.map((v) => ({
        by: v.approver_email,
        at: v.approved_at,
        decision: v.action === "reject" ? ("rejected" as const) : ("approved" as const),
        comment: v.comment,
      })),
      reason: receipt.rejection_reason ?? ordered.find((v) => v.comment)?.comment ?? null,
    }, "inventory", rejected ? "receipt_rejection_applied" : "receipt_left_pending"));
  }

  // Newest completion first — a ledger is read from the top.
  return rows.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}
