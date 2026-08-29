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
import { useApp } from "@/components/AppShell";
import { t, plural, arText, type Lang, type TKey } from "@/lib/i18n";
import {
  buildApprovalEvents, APPROVAL_KIND_INLINE, APPROVAL_KIND_SHORT,
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

// `name_ar` rides along so the part name can go through arText(). It is
// nullable and arText() returns the base untouched when it is null, so a part
// with no Arabic name still renders its English one rather than a blank.
type PartNameLite = { id: string; name: string; name_ar: string | null; sku: string; unit: string | null };
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
//
// TWO WHOLE SENTENCES, not one with the verb swapped. English can splice
// "approved"/"rejected" into a fixed frame because only that one word moves;
// Arabic changes the verb itself, so each decision gets its own sentence.
function conflictMessage(
  e: ApprovalEvent,
  viewer: string | null,
  attempted: "approved" | "rejected",
  lang: Lang,
): string | null {
  const other = otherVote(e, viewer);
  if (!other || other.decision === attempted) return null;
  return t(
    other.decision === "approved"
      ? "consumption.approvalsTab.conflictApproved"
      : "consumption.approvalsTab.conflictRejected",
    lang,
  ).replace("{who}", () => other.decided_by);
}

// The option ORDER lives here; the words live in the dictionary. Same shape as
// every other filter row converted in this phase.
const KIND_FILTERS: { key: ApprovalKind | "all"; label: TKey }[] = [
  { key: "all", label: "consumption.approvalsTab.filterAll" },
  { key: "exit_permit", label: "consumption.approvalsTab.filterExitPermits" },
  { key: "work_order", label: "consumption.approvalsTab.filterWorkOrders" },
  { key: "outsourced_job", label: "consumption.approvalsTab.filterOutsourcedJobs" },
];

// The expanded-row heading. Three WHOLE labels rather than the kind label plus
// a " — parts" / " — vendor payment" tail: that tail is an English apposition,
// and gluing it onto an Arabic noun phrase at render time is the fragment
// splicing this batch was told to avoid.
const DETAIL_HEAD_TKEY: Record<ApprovalKind, TKey> = {
  exit_permit: "consumption.approvalsTab.detailExitPermit",
  work_order: "consumption.approvalsTab.detailWorkOrder",
  outsourced_job: "consumption.approvalsTab.detailOutsourcedJob",
};

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
  const { lang } = useApp();
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
        lang,
        repairerNames: (jobId) => {
          const ids = jobRepairerIds.get(jobId) ?? [];
          const names = ids.map((id) => repairerNameById.get(id)).filter(Boolean) as string[];
          return names.length > 0 ? names.join(", ") : null;
        },
      }),
    [
      permits, permitLines, workOrders, workOrderParts, outsourcedJobs,
      workshopPayments, approvals, viewer, destinationLabel,
      jobRepairerIds, repairerNameById, lang,
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
    const res = await decideConsumptionApproval(e.kind, e.subjectId, decision, reason, lang);
    setBusyKey(null);
    if (res.error) {
      // A conflict gets the message that names the other voter; anything else
      // (eligibility, a vanished subject) surfaces the server's own words —
      // which the action resolves in `lang`, hence the argument above. The one
      // exception is an RPC's own RAISE text, which lives in the migrations.
      return conflictMessage(e, viewer, decision, lang) ?? res.error;
    }
    router.refresh();
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label={t("consumption.approvalsTab.kpiPending", lang)} value={String(kpis.pending)} />
        <Kpi
          label={t("consumption.approvalsTab.kpiOneVote", lang)}
          value={String(kpis.awaitingSecond)}
          hint={t("consumption.approvalsTab.kpiOneVoteHint", lang)}
        />
        <Kpi
          label={t("consumption.approvalsTab.kpiDecided", lang)}
          value={String(kpis.decided)}
          hint={t("consumption.approvalsTab.kpiDecidedHint", lang)}
        />
        <Kpi
          label={t("consumption.approvalsTab.kpiValue", lang)}
          value={formatSar(kpis.pendingValue)}
          hint={t("consumption.approvalsTab.kpiValueHint", lang)}
        />
      </div>

      {/* The arrow was `&rarr;` in the JSX and is a literal → in the English
          dictionary value, which renders the same byte. The Arabic value uses
          ← instead: in an RTL line the reading order is right-to-left, so a
          right-pointing arrow would point back at the source. */}
      <div className="rounded-lg px-3 py-2 text-[11px] muted bg-black/[0.03] dark:bg-white/[0.04]">
        {t(`consumption.approvalsTab.explainer.${plural(LEDGER_LOCK_DAYS)}`, lang)
          .replace("{n}", () => String(LEDGER_LOCK_DAYS))}
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
          lang={lang}
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
              {t(
                pendingEvents.length > 0
                  ? "consumption.approvalsTab.emptyFiltered"
                  : events.length > 0
                    ? "consumption.approvalsTab.emptyAllDecided"
                    : "consumption.approvalsTab.emptyNothingYet",
                lang,
              )}
            </p>
            {pendingEvents.length === 0 && (
              <p className="text-xs muted mt-1">
                {t(
                  events.length > 0
                    ? "consumption.approvalsTab.emptyDecidedHint"
                    : "consumption.approvalsTab.emptyNothingYetHint",
                  lang,
                )}
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
                <TH>{t("consumption.approvalsTab.colReference", lang)}</TH>
                <TH>{t("consumption.shared.kind", lang)}</TH>
                <TH>{t("consumption.approvalsTab.colWhat", lang)}</TH>
                <TH>{t("consumption.approvalsTab.colWhen", lang)}</TH>
                <TH>{t("consumption.shared.value", lang)}</TH>
                <TH>{t("consumption.approvalsTab.colVotes", lang)}</TH>
                <TH>{t("common.status", lang)}</TH>
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
                          aria-label={t(
                            open
                              ? "consumption.shared.collapseAria"
                              : "consumption.shared.expandAria",
                            lang,
                          )}
                        >
                          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="rtl:-scale-x-100 h-4 w-4" />}
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
                          {t(APPROVAL_KIND_SHORT[e.kind], lang)}
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
                          <div className="text-[10px] muted italic">
                            {t("consumption.approvalsTab.awaitingSecond", lang)}
                          </div>
                        )}
                      </TD>
                      <TD>
                        <span className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                          APPROVAL_STATUS_PILL[e.status],
                        )}>
                          {t(APPROVAL_STATUS_LABELS[e.status], lang)}
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
                            {t(APPROVAL_STATUS_LABELS[standing.decision], lang)}
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
                            <span className="text-[11px] muted">
                              {t("consumption.approvalsTab.signInToDecide", lang)}
                            </span>
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
                                  {t(
                                    e.mine
                                      ? "consumption.approvalsTab.approveInstead"
                                      : "consumption.approvalsTab.approve",
                                    lang,
                                  )}
                                </Btn>
                              )}
                              {e.mine?.decision !== "rejected" && (
                                <Btn
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => setRejecting(e)}
                                >
                                  <X className="h-3.5 w-3.5" />
                                  {t(
                                    e.mine
                                      ? "consumption.approvalsTab.rejectInstead"
                                      : "consumption.approvalsTab.reject",
                                    lang,
                                  )}
                                </Btn>
                              )}
                            </>
                          )}
                        </div>
                        {e.mine && (
                          <div className="text-[11px] muted mt-0.5 text-end">
                            {/* A whole sentence per decision, not "You " + verb
                                + " this": Arabic puts the verb elsewhere. */}
                            {t(
                              e.mine.decision === "approved"
                                ? "consumption.approvalsTab.youApproved"
                                : "consumption.approvalsTab.youRejected",
                              lang,
                            )}
                          </div>
                        )}
                      </TD>
                    </tr>

                    {open && (
                      <tr>
                        <td colSpan={9} className="p-0 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                          <div className="p-4 bg-black/[0.015] dark:bg-white/[0.02] space-y-3">
                            <div className="text-[11px] font-semibold uppercase tracking-wide muted">
                              {t(DETAIL_HEAD_TKEY[e.kind], lang)}
                            </div>

                            {e.kind === "outsourced_job" ? (
                              <Table>
                                <thead>
                                  <tr>
                                    <TH>{t("consumption.approvalsTab.colInvoice", lang)}</TH>
                                    <TH>{t("consumption.approvalsTab.colDate", lang)}</TH>
                                    <TH>{t("consumption.approvalsTab.colRepairer", lang)}</TH>
                                    <TH>{t("consumption.approvalsTab.colSubtotal", lang)}</TH>
                                    <TH>{t("consumption.approvalsTab.colVat", lang)}</TH>
                                    <TH>{t("consumption.approvalsTab.colDiscount", lang)}</TH>
                                    <TH>{t("consumption.shared.total", lang)}</TH>
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
                                    <TH>{t("common.part", lang)}</TH>
                                    <TH>{t("common.note", lang)}</TH>
                                    <TH>{t("common.qty", lang)}</TH>
                                    <TH>{t("consumption.shared.fifoUnitValue", lang)}</TH>
                                    <TH>{t("consumption.shared.value", lang)}</TH>
                                  </tr>
                                </thead>
                                <tbody>
                                  {e.parts.map((l) => {
                                    const part = partsById.get(l.part_id);
                                    return (
                                      <tr key={l.key}>
                                        <TD>
                                          <span className="text-sm font-medium">
                                            {part
                                              ? arText(part.name, part.name_ar, lang)
                                              : t("consumption.usage.unknownPart", lang)}
                                          </span>
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
                                {t("consumption.approvalsTab.stillOutNote", lang)}
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
                                  {t(`consumption.approvalsTab.votesOf.${plural(e.voteCount)}`, lang)
                                    .replace("{n}", () => String(e.voteCount))
                                    .replace("{r}", () => String(APPROVALS_REQUIRED))}
                                </div>
                                {e.approvals.map((a) => (
                                  <div key={a.id} className="flex flex-wrap items-baseline gap-x-1.5">
                                    <span className={cn(
                                      "font-medium",
                                      a.decision === "rejected" && "text-rose-700 dark:text-rose-300",
                                    )}>
                                      {t(APPROVAL_STATUS_LABELS[a.decision], lang)}
                                    </span>
                                    <span>
                                      {t("consumption.approvalsTab.signedBy", lang)
                                        .replace("{who}", () => a.decided_by)}
                                    </span>
                                    <span className="opacity-70">
                                      {t("consumption.approvalsTab.signedOn", lang)
                                        .replace("{when}", () => formatDateTime(a.decided_at))}
                                    </span>
                                    {a.decided_by === viewer && (
                                      <span className="opacity-70">
                                        {t("consumption.approvalsTab.signedYou", lang)}
                                      </span>
                                    )}
                                    {a.reason && <span className="w-full">{a.reason}</span>}
                                    {/* Only when it was actually changed —
                                        otherwise it repeats the line above. */}
                                    {a.created_at.slice(0, 19) !== a.decided_at.slice(0, 19) && (
                                      <span className="w-full opacity-70 inline-flex items-center gap-1">
                                        <Undo2 className="h-3 w-3" />
                                        {t("consumption.approvalsTab.firstDecided", lang)
                                          .replace("{when}", () => formatDateTime(a.created_at))}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[11px] muted">
                                {t(`consumption.approvalsTab.notRuled.${plural(APPROVALS_REQUIRED)}`, lang)
                                  .replace("{n}", () => String(APPROVALS_REQUIRED))}
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
          lang={lang}
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

      {notice && <ConflictModal lang={lang} message={notice} onClose={() => setNotice(null)} />}
    </div>
  );
}

function FilterRow({
  options, active, onPick, badges, lang,
}: {
  // `label` is a dictionary KEY, not a word: the option order is the caller's
  // business, the wording is the dictionary's.
  options: { key: string; label: TKey }[];
  active: string;
  onPick: (k: string) => void;
  badges?: Record<string, number>;
  lang: Lang;
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
          {t(o.label, lang)}
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
function ConflictModal({
  message, onClose, lang,
}: { message: string; onClose: () => void; lang: Lang }) {
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
            <h2 className="font-semibold">{t("consumption.approvalsTab.conflictTitle", lang)}</h2>
            <p className="text-sm muted mt-0.5">{message}</p>
          </div>
        </div>
        <div className="flex justify-end p-4 border-t" style={{ borderColor: "rgb(var(--border))" }}>
          <Btn variant="primary" onClick={onClose}>
            {t("consumption.approvalsTab.conflictGotIt", lang)}
          </Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Reject needs a reason, so it gets a popup; approve does not, so it does not.
function RejectModal({
  event, busy, error, onCancel, onConfirm, lang,
}: {
  event: ApprovalEvent;
  busy: boolean;
  lang: Lang;
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
          <h2 className="font-semibold">
            {t("consumption.approvalsTab.rejectTitle", lang)
              .replace("{ref}", () => event.reference)}
          </h2>
          {/* SEAM. This used to be
              `APPROVAL_KIND_LABELS[event.kind].toLowerCase()` spliced into the
              sentence — an English-shaped move: Arabic has no letter case, so
              the call would be a no-op and the clause would carry a
              Title-Case noun mid-sentence. The kind now comes from
              APPROVAL_KIND_INLINE, which holds a real inline form per
              language. English output is unchanged. */}
          <p className="text-[11px] muted">
            {t("consumption.approvalsTab.rejectSubtitle", lang)
              .replace("{kind}", () => t(APPROVAL_KIND_INLINE[event.kind], lang))
              .replace("{ref}", () => event.reference)}
          </p>
        </div>
        <div className="p-4 space-y-2">
          <label className="text-xs muted block">
            {t("consumption.approvalsTab.reasonLabel", lang)}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={t("consumption.approvalsTab.reasonPlaceholder", lang)}
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
          <Btn variant="outline" onClick={onCancel}>{t("common.cancel", lang)}</Btn>
          <Btn
            variant="primary"
            disabled={busy || reason.trim().length === 0}
            onClick={() => onConfirm(reason.trim())}
          >
            {t(
              busy
                ? "common.recording"
                : "consumption.approvalsTab.recordRejection",
              lang,
            )}
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
