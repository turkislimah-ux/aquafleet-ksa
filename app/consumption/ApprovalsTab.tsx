"use client";

// Consumption — the APPROVALS tab (Phase 2).
//
// A LEAF module: imports lib/, components/ and ./actions only, never back
// from ConsumptionClient — the one-way edge the Phase-4 import-cycle incident
// made a standing rule (tsc and next build both miss a cycle; Next's dev
// module system resolves it to undefined and blanks the page).
//
// NON-BLOCKING BY CONSTRUCTION. Nothing on this screen gates anything. A
// pending row is not "waiting" on someone in any operational sense — the
// parts already left, the job already happened. So there is no urgency
// styling, no countdown, no blocked state: it is a ledger of opinions about
// events, and the only button writes one row.

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check, X, ChevronDown, ChevronRight, ClipboardCheck, Undo2,
} from "lucide-react";
import { createPortal } from "react-dom";
import { Card, Btn, Table, TH, TD } from "@/components/ui";
import { cn, formatDate, formatDateTime, formatSar } from "@/lib/utils";
import {
  buildApprovalEvents, APPROVAL_KIND_LABELS, APPROVAL_KIND_SHORT,
  APPROVAL_KIND_PILL, APPROVAL_STATUS_LABELS, APPROVAL_STATUS_PILL,
  APPROVALS_REQUIRED,
  type ApprovalEvent, type ApprovalKind,
} from "@/lib/consumption-approvals";
import { LEDGER_LOCK_DAYS } from "@/lib/approvals-ledger";
import type {
  ConsumptionApproval, ExitPermit, ExitPermitLine,
  WorkOrder, WorkOrderPart, OutsourcedJob, WorkshopPayment,
} from "@/lib/db-types";
import { decideConsumptionApproval } from "./actions";
import ScrollLock from "@/components/ScrollLock";

type PartNameLite = { id: string; name: string; sku: string; unit: string | null };
type TruckLite = { id: string; plate: string };

// The vote that is ALREADY on the event — the one a second voter has to match.
// `approvals` is newest-first, so the last element is the first vote cast.
function firstVote(e: ApprovalEvent): ConsumptionApproval | null {
  return e.approvals.length > 0 ? e.approvals[e.approvals.length - 1] : null;
}

// Somebody else's vote. What matters in a conflict is the OTHER person's
// decision, not the viewer's own.
function otherVote(e: ApprovalEvent, viewer: string | null): ConsumptionApproval | null {
  return e.approvals.find((a) => a.decided_by !== viewer) ?? null;
}

// THE CONFLICT MESSAGE IS COMPOSED HERE, not taken from the database.
// 0097's raise names the standing decision but NOT who cast it — it cannot,
// since a trigger writing an email into an error string would leak it to any
// caller. The app already has the row, so it says the useful thing: who, and
// what they decided.
function conflictMessage(
  e: ApprovalEvent,
  viewer: string | null,
  attempted: "approved" | "rejected",
): string | null {
  const other = otherVote(e, viewer);
  if (!other || other.decision === attempted) return null;
  return `Conflict — ${other.decided_by} already ${other.decision === "approved" ? "approved" : "rejected"} this. A second vote has to match theirs; a split decision is not allowed.`;
}

const KIND_FILTERS: { key: ApprovalKind | "all"; label: string }[] = [
  { key: "all", label: "All kinds" },
  { key: "exit_permit", label: "Exit permits" },
  { key: "work_order", label: "In-house work orders" },
  { key: "outsourced_job", label: "Outsourced jobs" },
];

export default function ApprovalsTab({
  permits, permitLines, workOrders, workOrderParts, outsourcedJobs,
  workshopPayments, repairerNameById, jobRepairerIds, approvals,
  partNames, trucks, destinationLabel, viewer,
}: {
  permits: ExitPermit[];
  permitLines: ExitPermitLine[];
  workOrders: WorkOrder[];
  workOrderParts: WorkOrderPart[];
  outsourcedJobs: OutsourcedJob[];
  workshopPayments: WorkshopPayment[];
  repairerNameById: Map<string, string>;
  jobRepairerIds: Map<string, string[]>;
  approvals: ConsumptionApproval[];
  partNames: PartNameLite[];
  trucks: TruckLite[];
  destinationLabel: (p: ExitPermit) => string;
  // The signed-in user. Their own row decides what the buttons offer, so a
  // person changes their decision rather than stacking a second one.
  viewer: string | null;
}) {
  const router = useRouter();
  const [kindFilter, setKindFilter] = useState<ApprovalKind | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<ApprovalEvent | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // A refusal from the APPROVE button has nowhere in the row to live without
  // pushing every other column out of shape, so it gets a popup. A refusal
  // from REJECT already has a natural home — under the reason box in the
  // popup the user is standing in — so it stays there.
  const [notice, setNotice] = useState<string | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const partsById = useMemo(() => new Map(partNames.map((p) => [p.id, p])), [partNames]);
  const trucksById = useMemo(() => new Map(trucks.map((t) => [t.id, t])), [trucks]);

  const events = useMemo(
    () =>
      buildApprovalEvents({
        permits, permitLines, workOrders, workOrderParts,
        outsourcedJobs, workshopPayments, approvals,
        viewer,
        destinationLabel,
        repairerNames: (jobId) => {
          const ids = jobRepairerIds.get(jobId) ?? [];
          const names = ids.map((id) => repairerNameById.get(id)).filter(Boolean) as string[];
          return names.length > 0 ? names.join(", ") : null;
        },
      }),
    [
      permits, permitLines, workOrders, workOrderParts, outsourcedJobs,
      workshopPayments, approvals, viewer, destinationLabel,
      jobRepairerIds, repairerNameById,
    ],
  );

  const kpis = useMemo(() => {
    let pending = 0, awaitingSecond = 0, decided = 0, pendingValue = 0;
    for (const e of events) {
      if (e.status === "pending") {
        pending++;
        pendingValue += e.valueSar;
        if (e.voteCount === 1) awaitingSecond++;
      } else decided++;
    }
    return { pending, awaitingSecond, decided, pendingValue };
  }, [events]);

  // COMPLETED EVENTS RELOCATE. Once two matching votes land, the event is
  // decided and belongs to the Archive's Approvals Ledger — this tab is the
  // work queue, not the record. A consumption re-vote that drops one below
  // two brings it straight back here, because "pending" is derived from the
  // votes rather than stored.
  const pendingEvents = useMemo(() => events.filter((e) => e.status === "pending"), [events]);

  const visible = useMemo(
    () => pendingEvents.filter((e) => kindFilter === "all" || e.kind === kindFilter),
    [pendingEvents, kindFilter],
  );

  function keyOf(e: ApprovalEvent) {
    return `${e.kind}:${e.subjectId}`;
  }

  function toggle(k: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  }

  /**
   * Cast a vote. Returns the message to SHOW on failure, or null on success —
   * the caller decides where it goes, because approve and reject have
   * different right answers for that.
   */
  async function decide(
    e: ApprovalEvent,
    decision: "approved" | "rejected",
    reason: string | null,
  ): Promise<string | null> {
    setBusyKey(keyOf(e));
    const res = await decideConsumptionApproval(e.kind, e.subjectId, decision, reason);
    setBusyKey(null);
    if (res.error) {
      // A conflict gets the message that names the other voter; anything else
      // (eligibility, a vanished subject) surfaces the server's own words.
      return conflictMessage(e, viewer, decision) ?? res.error;
    }
    router.refresh();
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Awaiting a decision" value={String(kpis.pending)} />
        <Kpi
          label="Have one vote"
          value={String(kpis.awaitingSecond)}
          hint="Need a matching second"
        />
        <Kpi
          label="Decided"
          value={String(kpis.decided)}
          hint="Moved to the Approvals Ledger"
        />
        <Kpi
          label="Value pending"
          value={formatSar(kpis.pendingValue)}
          hint="Parts and vendor spend not yet ruled on"
        />
      </div>

      <div className="rounded-lg px-3 py-2 text-[11px] muted bg-black/[0.03] dark:bg-white/[0.04]">
        Two matching votes decide an event — the second voter must agree with the first, and a
        differing vote is refused. A decision here is a record, not a gate: it moves no stock and
        changes nothing about the permit, work order or job. Decided events leave this tab for
        Archive &rarr; Approvals Ledger, where they stay changeable for {LEDGER_LOCK_DAYS} days.
      </div>

      {/* No error banner here, and no inline row message either — a refusal
          in the row stretched every other column out of shape. Approve
          failures go to ConflictModal; reject failures stay under the reason
          box in the popup the user is already standing in. */}

      {/* The STATUS filter is gone, not hidden. With decided events relocated
          to the Ledger this queue holds nothing but pending, so an
          Approved/Rejected filter could only ever return an empty table —
          a control that cannot do anything is worse than no control. */}
      <div className="flex items-center gap-4 flex-wrap">
        <FilterRow
          options={KIND_FILTERS}
          active={kindFilter}
          onPick={(k) => setKindFilter(k as ApprovalKind | "all")}
        />
      </div>

      {visible.length === 0 ? (
        <Card>
          <div className="p-10 text-center">
            <ClipboardCheck className="h-6 w-6 mx-auto mb-2 opacity-40" />
            {/* THREE distinct empty states, because they mean different
                things. Testing "events.length" here was wrong: with decided
                events relocated to the Ledger, a fully-decided queue reported
                "No events match these filters" — blaming a filter for a
                relocation, when no filter was involved. */}
            <p className="text-sm muted">
              {pendingEvents.length > 0
                ? "No events match these filters."
                : events.length > 0
                  ? "Everything has been decided."
                  : "Nothing to approve yet."}
            </p>
            {pendingEvents.length === 0 && (
              <p className="text-xs muted mt-1">
                {events.length > 0
                  ? "Decided events live in Archive → Approvals Ledger."
                  : "Exited permits, completed in-house work orders that used parts, and outsourced jobs with a vendor payment all show up here."}
              </p>
            )}
          </div>
        </Card>
      ) : (
        <Card className="!p-0 overflow-hidden">
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>{null}</TH>
                <TH>Reference</TH>
                <TH>Kind</TH>
                <TH>What</TH>
                <TH>When</TH>
                <TH>Value</TH>
                <TH>Votes</TH>
                <TH>Status</TH>
                <TH>{null}</TH>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => {
                const k = keyOf(e);
                const open = expanded.has(k);
                const truck = e.truckId ? trucksById.get(e.truckId) : null;
                const busy = busyKey === k;
                // The vote already on the event — what a second vote must match.
                const standing = firstVote(e);
                return (
                  <Fragment key={k}>
                    <tr>
                      <TD>
                        <button
                          onClick={() => toggle(k)}
                          className="h-7 w-7 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                          aria-label={open ? "Collapse" : "Expand"}
                        >
                          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </TD>
                      <TD>
                        <span className="font-mono text-xs font-medium">{e.reference}</span>
                      </TD>
                      <TD className="text-xs">
                        <span className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                          APPROVAL_KIND_PILL[e.kind],
                        )}>
                          {APPROVAL_KIND_SHORT[e.kind]}
                        </span>
                      </TD>
                      <TD className="whitespace-normal max-w-[280px]">
                        <span className="text-sm line-clamp-1" title={e.title}>{e.title}</span>
                        <div className="text-[11px] muted line-clamp-1">
                          {truck ? truck.plate : null}
                          {truck && e.where ? " · " : null}
                          {e.where}
                        </div>
                      </TD>
                      <TD className="text-xs muted">
                        {e.occurredAt ? formatDate(e.occurredAt) : "—"}
                      </TD>
                      <TD className="text-xs tabular-nums font-medium">{formatSar(e.valueSar)}</TD>
                      {/* VOTE DOTS — copied from the inventory approvals
                          queue (PurchaseOrders.tsx, the restored dot
                          indicator) rather than re-invented, down to the
                          emerald fill, the 1px ring and the "n/2" caption, so
                          the two queues read identically. */}
                      <TD className="text-xs">
                        <div className="inline-flex items-center gap-1">
                          {Array.from({ length: APPROVALS_REQUIRED }).map((_, i) => (
                            <span
                              key={i}
                              className="h-2 w-2 rounded-full inline-block"
                              style={{
                                background: i < e.voteCount ? "#10b981" : "rgb(var(--border))",
                                boxShadow: i < e.voteCount ? "0 0 0 1px rgba(16,185,129,.4)" : undefined,
                              }}
                            />
                          ))}
                          <span className="muted ms-1">{e.voteCount}/{APPROVALS_REQUIRED}</span>
                        </div>
                        {e.approvals.length > 0 && (
                          <div className="text-[11px] muted">
                            {e.approvals.map((a) => a.decided_by).join(", ")}
                          </div>
                        )}
                        {e.voteCount === 1 && (
                          <div className="text-[10px] muted italic">awaiting a matching second vote</div>
                        )}
                      </TD>
                      <TD>
                        <span className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                          APPROVAL_STATUS_PILL[e.status],
                        )}>
                          {APPROVAL_STATUS_LABELS[e.status]}
                        </span>
                        {/* THE STANDING DECISION, colour-coded — what the
                            first voter chose, which is what a second vote has
                            to match. Just the action: the vote COUNT and the
                            voter's NAME both already live in the Votes
                            column, and repeating either here only crowds the
                            cell. */}
                        {standing && (
                          <div
                            className={cn(
                              "text-[11px] mt-0.5 font-medium",
                              standing.decision === "approved"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-600 dark:text-rose-400",
                            )}
                          >
                            {APPROVAL_STATUS_LABELS[standing.decision]}
                          </div>
                        )}
                      </TD>
                      <TD>
                        {/* THE BUTTONS TRACK THE VIEWER'S OWN ROW, not the
                            event's status. Under 0095 a person holds exactly
                            one row per event, so the only question here is
                            "what did I say, and do I want to change it" — the
                            event's overall verdict is the pill's job. */}
                        <div className="flex items-center gap-1 justify-end">
                          {!viewer ? (
                            <span className="text-[11px] muted">Sign in to decide</span>
                          ) : (
                            <>
                              {e.mine?.decision !== "approved" && (
                                <Btn
                                  variant="primary"
                                  disabled={busy}
                                  onClick={async () => {
                                    const msg = await decide(e, "approved", null);
                                    if (msg) setNotice(msg);
                                  }}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  {e.mine ? "Approve instead" : "Approve"}
                                </Btn>
                              )}
                              {e.mine?.decision !== "rejected" && (
                                <Btn
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => setRejecting(e)}
                                >
                                  <X className="h-3.5 w-3.5" />
                                  {e.mine ? "Reject instead" : "Reject"}
                                </Btn>
                              )}
                            </>
                          )}
                        </div>
                        {e.mine && (
                          <div className="text-[11px] muted mt-0.5 text-end">
                            You {e.mine.decision === "approved" ? "approved" : "rejected"} this
                          </div>
                        )}
                      </TD>
                    </tr>

                    {open && (
                      <tr>
                        <td colSpan={9} className="p-0 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                          <div className="p-4 bg-black/[0.015] dark:bg-white/[0.02] space-y-3">
                            <div className="text-[11px] font-semibold uppercase tracking-wide muted">
                              {APPROVAL_KIND_LABELS[e.kind]}
                              {e.kind === "outsourced_job" ? " — vendor payment" : " — parts"}
                            </div>

                            {e.kind === "outsourced_job" ? (
                              <Table>
                                <thead>
                                  <tr>
                                    <TH>Invoice</TH><TH>Date</TH><TH>Repairer</TH>
                                    <TH>Subtotal</TH><TH>VAT</TH><TH>Discount</TH><TH>Total</TH>
                                  </tr>
                                </thead>
                                <tbody>
                                  {e.payments.map((p) => (
                                    <tr key={p.id}>
                                      <TD className="text-xs font-mono">{p.invoice_number ?? "—"}</TD>
                                      <TD className="text-xs muted">
                                        {p.invoice_date
                                          ? formatDate(p.invoice_date + "T00:00:00")
                                          : "—"}
                                      </TD>
                                      <TD className="text-xs">{repairerNameById.get(p.repairer_id) ?? "—"}</TD>
                                      <TD className="text-xs tabular-nums">{formatSar(Number(p.subtotal_sar))}</TD>
                                      <TD className="text-xs tabular-nums">{formatSar(Number(p.vat_sar))}</TD>
                                      <TD className="text-xs tabular-nums">
                                        {Number(p.discount_sar) > 0
                                          ? formatSar(Number(p.discount_sar))
                                          : <span className="muted">—</span>}
                                      </TD>
                                      <TD className="text-xs tabular-nums font-medium">
                                        {formatSar(Number(p.grand_total_sar))}
                                      </TD>
                                    </tr>
                                  ))}
                                </tbody>
                              </Table>
                            ) : (
                              <Table>
                                <thead>
                                  <tr>
                                    <TH>Part</TH><TH>Note</TH><TH>Qty</TH>
                                    <TH>FIFO unit value</TH><TH>Value</TH>
                                  </tr>
                                </thead>
                                <tbody>
                                  {e.parts.map((l) => {
                                    const part = partsById.get(l.part_id);
                                    return (
                                      <tr key={l.key}>
                                        <TD>
                                          <span className="text-sm font-medium">{part?.name ?? "Unknown part"}</span>
                                          <div className="text-[11px] muted">
                                            {part?.sku}{part?.unit ? ` · ${part.unit}` : ""}
                                          </div>
                                        </TD>
                                        <TD className="whitespace-normal align-top max-w-[240px]">
                                          {l.note
                                            ? <span className="text-[11px] muted line-clamp-2" title={l.note}>{l.note}</span>
                                            : <span className="text-[11px] muted">—</span>}
                                        </TD>
                                        <TD className="text-xs tabular-nums">{l.qty}</TD>
                                        <TD className="text-xs tabular-nums">{formatSar(l.unitPriceSar)}</TD>
                                        <TD className="text-xs tabular-nums font-medium">{formatSar(l.valueSar)}</TD>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </Table>
                            )}

                            {e.kind === "exit_permit" && (
                              <p className="text-[11px] muted">
                                Quantities are what is still OUT — anything returned is back on the
                                shelf and is not counted here.
                              </p>
                            )}

                            {/* THE SIGN-OFF SHEET. Coloured by the STANDING
                                DECISION — green approved, red rejected — not
                                by e.status. Status is "pending" until the
                                second vote lands, so keying the colour off it
                                left every row in this queue grey and lost the
                                red/green entirely. What is on the event is
                                already a decision; it just is not final yet.
                                It lists EVERY signatory, because with two
                                voters "who signed this" is the real question. */}
                            {e.approvals.length > 0 ? (
                              <div className={cn(
                                "rounded-lg px-3 py-2 text-xs space-y-1.5",
                                standing?.decision === "approved"
                                  ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                                  : "bg-rose-500/10 text-rose-800 dark:text-rose-200",
                              )}>
                                <div className="font-medium">
                                  {e.voteCount} of {APPROVALS_REQUIRED} votes — needs a matching second to decide
                                </div>
                                {e.approvals.map((a) => (
                                  <div key={a.id} className="flex flex-wrap items-baseline gap-x-1.5">
                                    <span className={cn(
                                      "font-medium",
                                      a.decision === "rejected" && "text-rose-700 dark:text-rose-300",
                                    )}>
                                      {APPROVAL_STATUS_LABELS[a.decision]}
                                    </span>
                                    <span>by {a.decided_by}</span>
                                    <span className="opacity-70">
                                      on {formatDateTime(a.decided_at)}
                                    </span>
                                    {a.decided_by === viewer && <span className="opacity-70">(you)</span>}
                                    {a.reason && <span className="w-full">{a.reason}</span>}
                                    {/* Only when it was actually changed —
                                        otherwise it repeats the line above. */}
                                    {a.created_at.slice(0, 19) !== a.decided_at.slice(0, 19) && (
                                      <span className="w-full opacity-70 inline-flex items-center gap-1">
                                        <Undo2 className="h-3 w-3" />
                                        first decided {formatDateTime(a.created_at)}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] muted">
                                Not yet ruled on — needs {APPROVALS_REQUIRED} approvals.
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      {rejecting && (
        <RejectModal
          event={rejecting}
          busy={busyKey === keyOf(rejecting)}
          error={rejectError}
          onCancel={() => { setRejectError(null); setRejecting(null); }}
          onConfirm={async (reason) => {
            const msg = await decide(rejecting, "rejected", reason);
            setRejectError(msg);
            if (!msg) setRejecting(null);
          }}
        />
      )}

      {notice && <ConflictModal message={notice} onClose={() => setNotice(null)} />}
    </div>
  );
}

function FilterRow({
  options, active, onPick, badges,
}: {
  options: { key: string; label: string }[];
  active: string;
  onPick: (k: string) => void;
  badges?: Record<string, number>;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onPick(o.key)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-sm font-medium transition border",
            active === o.key
              ? "bg-brand-500/10 border-brand-600 text-brand-700 dark:text-brand-300"
              : "border-transparent muted hover:bg-black/5 dark:hover:bg-white/5",
          )}
        >
          {o.label}
          {badges?.[o.key] ? (
            <span className="ms-1.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[10px] font-semibold">
              {badges[o.key]}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

// The APPROVE refusal. Approving takes one click with no form behind it, so a
// failure has nowhere to land in the row without stretching it — a popup says
// it once, clearly, and leaves the table alone.
function ConflictModal({ message, onClose }: { message: string; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto"
      onClick={onClose}
    >
      <ScrollLock />
      <div className="card w-full max-w-[440px] p-0" onClick={(ev) => ev.stopPropagation()}>
        <div className="p-4 flex items-start gap-3">
          <span className="h-8 w-8 shrink-0 rounded-full grid place-items-center bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <X className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">Vote not recorded</h2>
            <p className="text-sm muted mt-0.5">{message}</p>
          </div>
        </div>
        <div className="flex justify-end p-4 border-t" style={{ borderColor: "rgb(var(--border))" }}>
          <Btn variant="primary" onClick={onClose}>Got it</Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Reject needs a reason, so it gets a popup; approve does not, so it does not.
function RejectModal({
  event, busy, error, onCancel, onConfirm,
}: {
  event: ApprovalEvent;
  busy: boolean;
  // The refusal, shown BELOW the reason box — the popup stays open on a
  // conflict so the typed reason survives and the reader is told why right
  // where they are, instead of behind a dismissed dialog.
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState(event.mine?.reason ?? "");
  // Portal only after mount — same guard as the exit-permit modals' Overlay.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto"
      onClick={onCancel}
    >
      <ScrollLock />
      <div
        className="card w-full max-w-[520px] p-0"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="p-4 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <h2 className="font-semibold">Reject {event.reference}</h2>
          <p className="text-[11px] muted">
            This records a rejection against {APPROVAL_KIND_LABELS[event.kind].toLowerCase()}{" "}
            {event.reference}. Nothing is reversed and no stock moves.
          </p>
        </div>
        <div className="p-4 space-y-2">
          <label className="text-xs muted block">Reason *</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="What is wrong with this one?"
            className="px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full bg-transparent"
            style={{ borderColor: "rgb(var(--border))" }}
          />
          {error && (
            <div className="rounded-lg px-3 py-2 text-xs bg-rose-500/10 text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: "rgb(var(--border))" }}>
          <Btn variant="outline" onClick={onCancel}>Cancel</Btn>
          <Btn
            variant="primary"
            disabled={busy || reason.trim().length === 0}
            onClick={() => onConfirm(reason.trim())}
          >
            {busy ? "Recording…" : "Record rejection"}
          </Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs muted uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-[11px] muted mt-0.5">{hint}</div>}
    </div>
  );
}
