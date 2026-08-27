// Consumption approvals — the DERIVED bits.
//
// THE LIST IS DERIVED, NOT STORED. An approval row does not have to exist for
// an event to appear: the tab reads the three SOURCE tables, left-joins
// consumption_approvals, and calls anything without a row PENDING. That is
// what makes the whole history retro-approvable the moment 0094 applied, with
// zero backfill — and it is why "pending" is not a decision value in the DB
// (0094's CHECK allows only 'approved' and 'rejected'). Pending is the absence
// of a row, computed here.
//
// Same rule as lib/driver-state.ts, lib/truck-status.ts, lib/archive.ts and
// lib/exit-permits.ts: if it can be computed from other columns, compute it.
//
// NOTHING HERE WRITES. This module is pure; it takes rows and returns rows.

import type {
  ConsumptionApproval, ExitPermit, ExitPermitLine,
  WorkOrder, WorkOrderPart, OutsourcedJob, WorkshopPayment,
} from "./db-types";
import { permitValueSar } from "./exit-permits";
import { t, type Lang, type TKey } from "./i18n";

export type ApprovalKind = "exit_permit" | "work_order" | "outsourced_job";
export type ApprovalStatus = "pending" | "approved" | "rejected";

// TWO SIGN-OFFS MAKE AN APPROVAL (0095). One objection ends it.
export const APPROVALS_REQUIRED = 2;

// Kind is colour-coded so the three streams are separable at a glance in a
// mixed queue — blue permits, yellow in-house, purple outsourced.
export const APPROVAL_KIND_PILL: Record<ApprovalKind, string> = {
  exit_permit: "bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/25",
  work_order: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/25",
  outsourced_job: "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/25",
};

// ENUM VALUE -> DICTIONARY KEY. These three carry a TKey rather than English:
// unlike db-types.ts's enum maps they are not a shared file's source of option
// order — this module is read by app/consumption/** only, and the three lists
// are already ordered by the ApprovalKind/ApprovalStatus unions above.
export const APPROVAL_KIND_LABELS: Record<ApprovalKind, TKey> = {
  exit_permit: "consumption.shared.exitPermit",
  work_order: "consumption.approvals.kindWorkOrder",
  outsourced_job: "consumption.approvals.kindOutsourcedJob",
};

// The LOWER-CASE mid-sentence form. The reject modal used to call
// `.toLowerCase()` on APPROVAL_KIND_LABELS to drop the kind into a sentence,
// which is an English-shaped operation — Arabic has no letter case, so the call
// is a no-op there and the sentence would carry a Title-Case noun mid-clause.
export const APPROVAL_KIND_INLINE: Record<ApprovalKind, TKey> = {
  exit_permit: "consumption.approvals.inlineExitPermit",
  work_order: "consumption.approvals.inlineWorkOrder",
  outsourced_job: "consumption.approvals.inlineOutsourcedJob",
};

// Short form for the row pill, where the reference number already says a lot.
export const APPROVAL_KIND_SHORT: Record<ApprovalKind, TKey> = {
  exit_permit: "consumption.approvals.shortExitPermit",
  work_order: "consumption.approvals.shortWorkOrder",
  outsourced_job: "consumption.approvals.shortOutsourcedJob",
};

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, TKey> = {
  pending: "consumption.approvals.statusPending",
  approved: "consumption.approvals.statusApproved",
  rejected: "consumption.approvals.statusRejected",
};

export const APPROVAL_STATUS_PILL: Record<ApprovalStatus, string> = {
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/25",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25",
  rejected: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20",
};

// The column on consumption_approvals that carries this kind's subject. One
// definition, used by both the derive below and the server action, so the two
// can never disagree about which FK belongs to which kind.
export const APPROVAL_SUBJECT_COLUMN: Record<ApprovalKind, "exit_permit_id" | "work_order_id" | "outsourced_job_id"> = {
  exit_permit: "exit_permit_id",
  work_order: "work_order_id",
  outsourced_job: "outsourced_job_id",
};

// A part line as the tab shows it — shared shape across permits and work
// orders so one table renders both.
export type ApprovalPartLine = {
  key: string;
  part_id: string;
  qty: number;
  unitPriceSar: number;
  valueSar: number;
  note: string | null;
};

export type ApprovalEvent = {
  kind: ApprovalKind;
  // The subject's own id — the value written to this kind's FK column.
  subjectId: string;
  reference: string;          // EP-26-0001 / WO-26-0007 / OS-26-0003
  title: string;
  occurredAt: string | null;  // exited_at / closed_at, ISO
  truckId: string | null;     // work orders and outsourced jobs
  where: string | null;       // permits: destination; OS: repairer names
  parts: ApprovalPartLine[];  // permits and work orders; empty for OS
  payments: WorkshopPayment[]; // outsourced jobs only
  valueSar: number;

  status: ApprovalStatus;
  // Every decision recorded against this event, newest first. Under 0095
  // there is one row per PERSON, so this is the sign-off sheet.
  approvals: ConsumptionApproval[];
  approvedCount: number;
  // Distinct people who have voted. Under 0097's matching rule this is the
  // number that matters — they cannot have voted differently.
  voteCount: number;
  // The first objection. A rejection ends the event, so only one can matter,
  // and this is the one whose reason gets shown.
  rejection: ConsumptionApproval | null;
  // The viewer's OWN row, if they have acted. Drives the buttons: a person
  // changes their own decision, they never add a second one.
  mine: ConsumptionApproval | null;
  // When this event reached its terminal state — the 2nd distinct approval,
  // or the objection that ended it. NULL while still collecting.
  //
  // THIS IS THE 30-DAY CLOCK'S ZERO, and it is deliberately computed in ONE
  // place: migration 0096's consumption_event_completed_at() implements the
  // identical rule in SQL, and the Approvals Ledger reads this rather than
  // re-deriving its own. Three copies of a completion rule is how the UI ends
  // up disagreeing with the guard about whether something is locked.
  completedAt: string | null;
};

/**
 * Build the event list.
 *
 * INCLUSION RULES, each one a deliberate cut:
 *   - exit permits: status 'exited'. A DRAFT moved nothing, and a VOIDED
 *     permit has already been reversed — listing either would park a row in
 *     the queue that can never mean anything.
 *   - work orders: status 'completed' AND at least one work_order_parts row.
 *     A completed WO that consumed nothing has no consumption to approve.
 *   - outsourced jobs: at least one workshop_payments row. The job's status is
 *     NOT a filter — what is being approved is the vendor spend, and a payment
 *     recorded against a still-open job is still real money.
 *
 * Sorted newest first by when the event happened, with undated rows last.
 */
export function buildApprovalEvents(input: {
  permits: ExitPermit[];
  permitLines: ExitPermitLine[];
  workOrders: WorkOrder[];
  workOrderParts: WorkOrderPart[];
  outsourcedJobs: OutsourcedJob[];
  workshopPayments: WorkshopPayment[];
  approvals: ConsumptionApproval[];
  // The signed-in user, so their own row can drive the buttons. Null when
  // there is no session email — the tab then shows decisions read-only rather
  // than offering an action that could not be attributed.
  viewer: string | null;
  destinationLabel: (p: ExitPermit) => string;
  repairerNames: (jobId: string) => string | null;
  // Only one string in this whole module is composed rather than looked up: the
  // stand-in title an untitled permit gets. Work orders and outsourced jobs
  // carry their own DB title, so nothing else here needs a language.
  lang: Lang;
}): ApprovalEvent[] {
  const lang = input.lang;
  // 0095 changed the key from the EVENT to (EVENT, APPROVER), so each of
  // these now holds a LIST — the sign-off sheet, not a single verdict.
  const byPermit = new Map<string, ConsumptionApproval[]>();
  const byWorkOrder = new Map<string, ConsumptionApproval[]>();
  const byJob = new Map<string, ConsumptionApproval[]>();
  const push = (m: Map<string, ConsumptionApproval[]>, k: string, a: ConsumptionApproval) => {
    const arr = m.get(k) ?? [];
    arr.push(a);
    m.set(k, arr);
  };
  for (const a of input.approvals) {
    if (a.exit_permit_id) push(byPermit, a.exit_permit_id, a);
    else if (a.work_order_id) push(byWorkOrder, a.work_order_id, a);
    else if (a.outsourced_job_id) push(byJob, a.outsourced_job_id, a);
  }

  const events: ApprovalEvent[] = [];

  // --- Exit permits ---------------------------------------------------------
  const linesByPermit = new Map<string, ExitPermitLine[]>();
  for (const l of input.permitLines) {
    const a = linesByPermit.get(l.exit_permit_id) ?? [];
    a.push(l);
    linesByPermit.set(l.exit_permit_id, a);
  }
  for (const p of input.permits) {
    if (p.status !== "exited") continue;
    const lines = linesByPermit.get(p.id) ?? [];
    events.push({
      kind: "exit_permit",
      subjectId: p.id,
      reference: p.ep_number ?? "—",
      title: p.note?.trim() || t("consumption.approvals.untitledPermit", lang),
      occurredAt: p.exited_at,
      truckId: p.destination_truck_id,
      where: input.destinationLabel(p),
      // Value follows the permits tab exactly: what is still OUT, at the
      // stamped FIFO cost. Anything returned is back on the shelf and is not
      // consumption to approve.
      parts: lines.map((l) => {
        const outstanding = Number(l.qty) - Number(l.qty_returned);
        return {
          key: l.id,
          part_id: l.part_id,
          qty: outstanding,
          unitPriceSar: Number(l.unit_price_sar),
          valueSar: outstanding * Number(l.unit_price_sar),
          note: l.note,
        };
      }),
      payments: [],
      valueSar: permitValueSar(lines),
      ...fold(byPermit.get(p.id) ?? [], input.viewer),
    });
  }

  // --- In-house work orders -------------------------------------------------
  const partsByWo = new Map<string, WorkOrderPart[]>();
  for (const wp of input.workOrderParts) {
    const a = partsByWo.get(wp.work_order_id) ?? [];
    a.push(wp);
    partsByWo.set(wp.work_order_id, a);
  }
  for (const wo of input.workOrders) {
    if (wo.status !== "completed") continue;
    const wps = partsByWo.get(wo.id) ?? [];
    if (wps.length === 0) continue;
    events.push({
      kind: "work_order",
      subjectId: wo.id,
      reference: wo.wo_number,
      title: wo.title,
      occurredAt: wo.closed_at,
      truckId: wo.truck_id,
      where: null,
      // unit_price_sar here is the FIFO cost consume_work_order_line stamped
      // at deduction — read, never recomputed.
      parts: wps.map((wp) => ({
        key: wp.id,
        part_id: wp.part_id,
        qty: Number(wp.qty),
        unitPriceSar: Number(wp.unit_price_sar),
        valueSar: Number(wp.qty) * Number(wp.unit_price_sar),
        note: null,
      })),
      payments: [],
      valueSar: wps.reduce((n, wp) => n + Number(wp.qty) * Number(wp.unit_price_sar), 0),
      ...fold(byWorkOrder.get(wo.id) ?? [], input.viewer),
    });
  }

  // --- Outsourced jobs ------------------------------------------------------
  const paymentsByJob = new Map<string, WorkshopPayment[]>();
  for (const wp of input.workshopPayments) {
    const a = paymentsByJob.get(wp.outsourced_job_id) ?? [];
    a.push(wp);
    paymentsByJob.set(wp.outsourced_job_id, a);
  }
  for (const job of input.outsourcedJobs) {
    const pays = paymentsByJob.get(job.id) ?? [];
    if (pays.length === 0) continue;
    events.push({
      kind: "outsourced_job",
      subjectId: job.id,
      reference: job.os_number,
      title: job.title,
      occurredAt: job.closed_at,
      truckId: job.truck_id,
      where: input.repairerNames(job.id),
      parts: [],
      payments: pays,
      // The job's WHOLE vendor spend. workshop_payments is one-to-many and
      // already is in practice, so this sums rather than showing the first.
      valueSar: pays.reduce((n, x) => n + Number(x.grand_total_sar), 0),
      ...fold(byJob.get(job.id) ?? [], input.viewer),
    });
  }

  return events.sort((a, b) => {
    if (!a.occurredAt && !b.occurredAt) return 0;
    if (!a.occurredAt) return 1;
    if (!b.occurredAt) return -1;
    return b.occurredAt.localeCompare(a.occurredAt);
  });
}

/**
 * Fold one event's sign-off sheet into the shape the tab renders.
 *
 * THE RULE — a verbatim port of approve_stock_receipt/reject_stock_receipt:
 *   The first voter votes either way. The SECOND voter's decision MUST MATCH
 *   the first; a differing vote is REFUSED (migration 0097's trigger), so an
 *   event can never hold two different outcomes. TWO MATCHING VOTES from
 *   DISTINCT people complete it — approved or rejected, whichever they agree
 *   on. Anything less is PENDING.
 *
 * "One objection ends it" is GONE. It could complete an event on a single
 * vote, which the matching model has no room for.
 *
 * There is no disagreement branch. Migration 0097's trigger refuses a vote
 * that differs from an existing one, so an event holding two outcomes cannot
 * be written — handling a state the database forbids would be dead code
 * pretending to be a safeguard.
 */
export function fold(rows: ConsumptionApproval[], viewer: string | null): {
  status: ApprovalStatus;
  approvals: ConsumptionApproval[];
  approvedCount: number;
  voteCount: number;
  rejection: ConsumptionApproval | null;
  mine: ConsumptionApproval | null;
  completedAt: string | null;
} {
  const sorted = [...rows].sort((a, b) => b.decided_at.localeCompare(a.decided_at));
  const rejections = sorted.filter((r) => r.decision === "rejected");

  // Distinct VOTERS, regardless of decision — 0097 guarantees they agree.
  const voters = new Set(sorted.map((r) => r.decided_by));
  const voteCount = voters.size;

  // The agreed decision — any row names it, since they all match.
  const agreed = sorted[0]?.decision ?? null;

  const status: ApprovalStatus =
    voteCount < APPROVALS_REQUIRED || !agreed ? "pending" : agreed;

  // Kept for the "N of 2" counter: the number of people who have voted, which
  // under the matching rule is the same thing as the number who agree.
  const approvedCount = voteCount;

  // The EARLIEST objection — the one that actually ended it. `sorted` is
  // newest-first, so the last element of the rejections slice is the oldest.
  const firstRejection = rejections.length > 0 ? rejections[rejections.length - 1] : null;

  // Completion time. MIRRORS migration 0096's consumption_event_completed_at()
  // line for line: the SECOND DISTINCT voter's timestamp, no decision logic.
  // Grouping by voter before ordering is what stops one person re-voting from
  // supplying the second signature themselves.
  let completedAt: string | null = null;
  if (status !== "pending") {
    const firstPerVoter = new Map<string, string>();
    for (const r of sorted) {
      const seen = firstPerVoter.get(r.decided_by);
      if (!seen || r.decided_at < seen) firstPerVoter.set(r.decided_by, r.decided_at);
    }
    const ordered = [...firstPerVoter.values()].sort();
    completedAt = ordered[APPROVALS_REQUIRED - 1] ?? null;
  }

  return {
    status,
    approvals: sorted,
    approvedCount,
    voteCount,
    rejection: firstRejection,
    mine: viewer ? sorted.find((r) => r.decided_by === viewer) ?? null : null,
    completedAt,
  };
}
