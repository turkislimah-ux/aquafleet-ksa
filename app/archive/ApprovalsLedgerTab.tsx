"use client";

// Archive — the APPROVALS LEDGER tab.
//
// A LEAF module: imports lib/, components/ and the consumption server action
// only, never back from ArchiveClient — the one-way edge the Phase-4
// import-cycle incident made a standing rule.
//
// WHAT THIS SCREEN IS. Completed approvals from BOTH systems, derived live
// from their own tables. Nothing was copied here, so nothing can drift: a row
// is present because its event has two matching votes, and it leaves the
// instant that stops being true.
//
// THE ASYMMETRY IS THE POINT, and it is shown rather than smoothed over.
// Consumption rows are re-votable for 30 days because those votes are inert.
// Inventory rows are read-only forever because their completing vote already
// moved stock and flipped a status, and their own RPCs refuse to act again —
// so a button here would only produce an error. Each locked row says WHY.

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, ChevronDown, ChevronRight, Lock, Scale, Clock } from "lucide-react";
import { Card, Btn, Table, TH, TD } from "@/components/ui";
import { cn, formatDate, formatDateTime, formatSar } from "@/lib/utils";
import {
  buildLedger, LEDGER_KIND_PILL, LEDGER_LOCK_DAYS,
  type LedgerRow, type LedgerKind, type LedgerSystem, type LedgerOutcome,
  type LedgerWorkOrder, type LedgerOutsourcedJob,
  type LedgerPurchaseOrder, type LedgerStockReceipt,
} from "@/lib/approvals-ledger";
import type {
  ConsumptionApproval, ExitPermit, ExitPermitLine,
  WorkOrderPart, WorkshopPayment,
} from "@/lib/db-types";
import { useApp } from "@/components/AppShell";
import { t, fill, plural, type Lang } from "@/lib/i18n";
import { decideConsumptionApproval } from "../consumption/actions";

export type PoApprovalLite = {
  purchase_order_id: string; approver_email: string;
  comment: string | null; approved_at: string;
};
export type ReceiptApprovalLite = {
  stock_receipt_id: string; approver_email: string; action: string;
  outcome: string | null; comment: string | null; approved_at: string;
};

// FUNCTIONS, not module-level consts. A const is built once at import time, in
// whatever language the module happened to be evaluated under, and never changes
// again — the freeze that bit the truck and customer sub-tab strips. The KEYS
// stay the filter STATE; the label is display only.
function systemFilters(lang: Lang): { key: LedgerSystem | "all"; label: string }[] {
  return [
    { key: "all", label: t("archive.ledger.filterAllSystems", lang) },
    { key: "consumption", label: t("archive.ledger.system.consumption", lang) },
    { key: "inventory", label: t("archive.ledger.system.inventory", lang) },
  ];
}

function outcomeFilters(lang: Lang): { key: LedgerOutcome | "all"; label: string }[] {
  return [
    { key: "all", label: t("archive.ledger.filterAllOutcomes", lang) },
    // The SET words, not the row's own word — see the dictionary note on why
    // `filterApproved` and `outcome.approved` are two leaves in Arabic.
    { key: "approved", label: t("archive.ledger.filterApproved", lang) },
    { key: "rejected", label: t("archive.ledger.filterRejected", lang) },
  ];
}

export default function ApprovalsLedgerTab({
  approvals, permits, permitLines, workOrders, workOrderParts,
  outsourcedJobs, workshopPayments,
  poApprovals, purchaseOrders, receiptApprovals, stockReceipts,
  supplierNames, viewer, nowMs,
}: {
  approvals: ConsumptionApproval[];
  permits: ExitPermit[];
  permitLines: ExitPermitLine[];
  workOrders: LedgerWorkOrder[];
  workOrderParts: WorkOrderPart[];
  outsourcedJobs: LedgerOutsourcedJob[];
  workshopPayments: WorkshopPayment[];
  poApprovals: PoApprovalLite[];
  purchaseOrders: LedgerPurchaseOrder[];
  receiptApprovals: ReceiptApprovalLite[];
  stockReceipts: LedgerStockReceipt[];
  supplierNames: Map<string, string>;
  viewer: string | null;
  // One instant for the whole page, from the server — see buildLedger.
  nowMs: number;
}) {
  const router = useRouter();
  const { lang } = useApp();
  const [systemFilter, setSystemFilter] = useState<LedgerSystem | "all">("all");
  const [outcomeFilter, setOutcomeFilter] = useState<LedgerOutcome | "all">("all");
  const [kindFilter, setKindFilter] = useState<LedgerKind | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ledger = useMemo(
    () =>
      buildLedger({
        approvals, permits, permitLines, workOrders, workOrderParts,
        outsourcedJobs, workshopPayments,
        poApprovals, purchaseOrders, receiptApprovals, stockReceipts,
        supplierName: (id) => supplierNames.get(id) ?? null,
        nowMs,
      }),
    [
      approvals, permits, permitLines, workOrders, workOrderParts,
      outsourcedJobs, workshopPayments, poApprovals, purchaseOrders,
      receiptApprovals, stockReceipts, supplierNames, nowMs,
    ],
  );

  const kpis = useMemo(() => {
    let revotable = 0, locked = 0, approved = 0, rejected = 0;
    for (const r of ledger) {
      if (r.revotable) revotable++; else locked++;
      if (r.outcome === "approved") approved++; else rejected++;
    }
    return { total: ledger.length, revotable, locked, approved, rejected };
  }, [ledger]);

  const kindsPresent = useMemo(
    () => [...new Set(ledger.map((r) => r.kind))],
    [ledger],
  );

  const visible = useMemo(
    () =>
      ledger.filter(
        (r) =>
          (systemFilter === "all" || r.system === systemFilter) &&
          (outcomeFilter === "all" || r.outcome === outcomeFilter) &&
          (kindFilter === "all" || r.kind === kindFilter),
      ),
    [ledger, systemFilter, outcomeFilter, kindFilter],
  );

  function toggle(k: string) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  }

  // Re-vote. Only ever reachable on a consumption row inside the window —
  // and the same server action the Consumption tab uses, so there is one
  // write path for a consumption decision, not a ledger-specific second one.
  async function revote(row: LedgerRow, decision: "approved" | "rejected") {
    if (!row.revotable) return;
    const reason =
      decision === "rejected"
        ? window.prompt(t("archive.ledger.promptRejectReason", lang))?.trim() ?? ""
        : null;
    if (decision === "rejected" && !reason) return;

    setBusyKey(row.key); setError(null);
    const res = await decideConsumptionApproval(
      row.kind as "exit_permit" | "work_order" | "outsourced_job",
      row.subjectId,
      decision,
      reason,
      lang,
    );
    setBusyKey(null);
    if (res.error) { setError(res.error); return; }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label={t("archive.ledger.kpiCompleted", lang)} value={String(kpis.total)} />
        <Kpi label={t("archive.ledger.filterApproved", lang)} value={String(kpis.approved)} />
        <Kpi label={t("archive.ledger.filterRejected", lang)} value={String(kpis.rejected)} />
        <Kpi
          label={t("archive.ledger.kpiRevotable", lang)}
          value={String(kpis.revotable)}
          hint={fill(t(`archive.ledger.lockedAsHistory.${plural(kpis.locked)}`, lang), {
            n: kpis.locked,
          })}
        />
      </div>

      <div className="rounded-lg px-3 py-2 text-[11px] muted bg-black/[0.03] dark:bg-white/[0.04]">
        {fill(t("archive.ledger.banner", lang), { d: LEDGER_LOCK_DAYS })}
      </div>

      {error && (
        <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <Pills options={systemFilters(lang)} active={systemFilter} onPick={(k) => setSystemFilter(k as LedgerSystem | "all")} />
        <span className="h-5 w-px" style={{ background: "rgb(var(--border))" }} />
        <Pills options={outcomeFilters(lang)} active={outcomeFilter} onPick={(k) => setOutcomeFilter(k as LedgerOutcome | "all")} />
        <span className="h-5 w-px" style={{ background: "rgb(var(--border))" }} />
        <Pills
          options={[
            { key: "all", label: t("archive.ledger.filterAllKinds", lang) },
            ...kindsPresent.map((k) => ({
              key: k,
              label: t(`archive.ledger.kindShort.${k}`, lang),
            })),
          ]}
          active={kindFilter}
          onPick={(k) => setKindFilter(k as LedgerKind | "all")}
        />
      </div>

      {visible.length === 0 ? (
        <Card>
          <div className="p-10 text-center">
            <Scale className="h-6 w-6 mx-auto mb-2 opacity-40" />
            <p className="text-sm muted">
              {t(
                ledger.length === 0
                  ? "archive.ledger.emptyAll"
                  : "archive.ledger.emptyFiltered",
                lang,
              )}
            </p>
            {ledger.length === 0 && (
              <p className="text-xs muted mt-1">
                {t("archive.ledger.emptyHint", lang)}
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
                <TH>{t("archive.thReference", lang)}</TH>
                <TH>{t("archive.ledger.thSystem", lang)}</TH>
                <TH>{t("archive.ledger.thKind", lang)}</TH>
                <TH>{t("archive.ledger.thWhat", lang)}</TH>
                <TH>{t("archive.ledger.thCompleted", lang)}</TH>
                <TH>{t("archive.ledger.thValue", lang)}</TH>
                <TH>{t("archive.ledger.thOutcome", lang)}</TH>
                <TH>{t("archive.ledger.thWindow", lang)}</TH>
                <TH>{null}</TH>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const open = expanded.has(r.key);
                const busy = busyKey === r.key;
                return (
                  <Fragment key={r.key}>
                    <tr>
                      <TD>
                        <button
                          onClick={() => toggle(r.key)}
                          className="h-7 w-7 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                          aria-label={t(open ? "archive.ledger.collapse" : "archive.ledger.expand", lang)}
                        >
                          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </TD>
                      <TD><span className="font-mono text-xs font-medium">{r.reference}</span></TD>
                      <TD className="text-xs muted">
                        {t(`archive.ledger.system.${r.system}`, lang)}
                      </TD>
                      <TD>
                        <span className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                          LEDGER_KIND_PILL[r.kind],
                        )}>
                          {t(`archive.ledger.kindShort.${r.kind}`, lang)}
                        </span>
                      </TD>
                      <TD className="whitespace-normal max-w-[260px]">
                        <span className="text-sm line-clamp-1" title={r.title}>{r.title}</span>
                      </TD>
                      <TD className="text-xs muted">
                        {formatDate(r.completedAt)}
                      </TD>
                      <TD className="text-xs tabular-nums font-medium">
                        {r.valueSar === null ? <span className="muted">—</span> : formatSar(r.valueSar)}
                      </TD>
                      <TD>
                        <span className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                          r.outcome === "approved"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25"
                            : "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20",
                        )}>
                          {t(`archive.ledger.outcome.${r.outcome}`, lang)}
                        </span>
                      </TD>
                      <TD className="text-xs">
                        {r.locked ? (
                          <span className="inline-flex items-center gap-1 muted">
                            <Lock className="h-3 w-3" />{t("archive.ledger.lockedPill", lang)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                            <Clock className="h-3 w-3" />
                            {/* Reuses the expiry pills' countdown — "{n}d left" is the
                                same sentence, so it is one leaf, not two. */}
                            {fill(t(`archive.status.daysLeft.${plural(r.daysLeft)}`, lang), {
                              n: r.daysLeft,
                            })}
                          </span>
                        )}
                      </TD>
                      <TD>
                        <div className="flex items-center gap-1 justify-end">
                          {r.revotable && viewer ? (
                            <>
                              {r.outcome !== "approved" && (
                                <Btn variant="primary" disabled={busy} onClick={() => void revote(r, "approved")}>
                                  <Check className="h-3.5 w-3.5" />{t("archive.ledger.approve", lang)}
                                </Btn>
                              )}
                              {r.outcome !== "rejected" && (
                                <Btn variant="outline" disabled={busy} onClick={() => void revote(r, "rejected")}>
                                  <X className="h-3.5 w-3.5" />{t("archive.ledger.reject", lang)}
                                </Btn>
                              )}
                            </>
                          ) : (
                            <span className="text-[11px] muted inline-flex items-center gap-1">
                              <Lock className="h-3 w-3" />{t("archive.ledger.readOnly", lang)}
                            </span>
                          )}
                        </div>
                      </TD>
                    </tr>

                    {open && (
                      <tr>
                        <td colSpan={10} className="p-0 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                          <div className="p-4 bg-black/[0.015] dark:bg-white/[0.02] space-y-3">
                            <div className="text-[11px] font-semibold uppercase tracking-wide muted">
                              {fill(t("archive.ledger.signOffSheet", lang), {
                                kind: t(`archive.ledger.kind.${r.kind}`, lang),
                              })}
                            </div>

                            <div className={cn(
                              "rounded-lg px-3 py-2 text-xs space-y-1.5",
                              r.outcome === "approved"
                                ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                                : "bg-rose-500/10 text-rose-800 dark:text-rose-200",
                            )}>
                              <div className="font-medium">
                                {fill(t(`archive.ledger.decidedOn.${r.outcome}`, lang), {
                                  date: formatDateTime(r.completedAt),
                                })}
                              </div>
                              {r.votes.map((v, i) => (
                                <div key={`${v.by}-${i}`} className="flex flex-wrap items-baseline gap-x-1.5">
                                  <span className="font-medium">
                                    {t(`archive.ledger.outcome.${v.decision}`, lang)}
                                  </span>
                                  {/* `v.by` is the voter's email and `v.comment` their own
                                      words — USER DATA, interpolated, never translated. */}
                                  <span>{fill(t("archive.ledger.voteBy", lang), { name: v.by })}</span>
                                  <span className="opacity-70">
                                    {fill(t("archive.ledger.voteOn", lang), { date: formatDateTime(v.at) })}
                                  </span>
                                  {v.by === viewer && (
                                    <span className="opacity-70">{t("archive.ledger.you", lang)}</span>
                                  )}
                                  {v.comment && <span className="w-full">{v.comment}</span>}
                                </div>
                              ))}
                              {r.reason && (
                                <div className="w-full pt-0.5">
                                  {fill(t("archive.ledger.reasonLine", lang), { reason: r.reason })}
                                </div>
                              )}
                            </div>

                            <div className="text-[11px] muted">
                              {r.locked ? (
                                <span className="inline-flex items-start gap-1">
                                  <Lock className="h-3 w-3 mt-0.5 shrink-0" />
                                  {/* `lockReason` is a LedgerLockReason union member, not a
                                      sentence — lib/approvals-ledger.ts stopped composing
                                      English so a pure derivation module could stay one.
                                      Only `window_elapsed` spends {d}; fill on a
                                      token-free template is a no-op.

                                      THE NULL ARM IS UNREACHABLE IN PRACTICE and is still
                                      written out: buildLedger sets a reason on every locked
                                      row, but `locked` and `lockReason` are independent
                                      fields on LedgerRow, so the type cannot say so and
                                      nothing would catch it if that ever stopped being
                                      true. Rendering nothing is what the old
                                      `{r.lockReason}` did with a null. */}
                                  {r.lockReason
                                    ? fill(t(`archive.ledger.lockReason.${r.lockReason}`, lang), {
                                        d: LEDGER_LOCK_DAYS,
                                      })
                                    : null}
                                </span>
                              ) : (
                                fill(t(`archive.ledger.revotableUntil.${plural(r.daysLeft)}`, lang), {
                                  date: formatDate(r.locksAt),
                                  n: r.daysLeft,
                                })
                              )}
                            </div>
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
    </div>
  );
}

function Pills({
  options, active, onPick,
}: {
  options: { key: string; label: string }[];
  active: string;
  onPick: (k: string) => void;
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
        </button>
      ))}
    </div>
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
