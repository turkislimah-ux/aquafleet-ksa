"use client";

// Customer Ledger drill-in (0203) — the prepaid customer's money screen.
//
// EVERY FIGURE HERE IS READ-ONLY. Balance / Uninvoiced / Available arrive as
// props straight from the three views (lib/customer-ledger.ts is the only
// reader); the table rows are customer_ledger rows as stored. The ONE
// sanctioned exception is the Running column: a cumulative walk of amount_sar
// down the rows, presentation only, never persisted, never fed back into any
// figure — the headline Balance is always the view's own number.
//
// Writes go through the SECURITY DEFINER RPCs only:
//   Refund      → recordRefund      → record_refund   (capped by Available IN
//                                     THE DATABASE; its error shows VERBATIM)
//   Correction  → proposeLedgerCorrection / voteLedgerCorrection — the 2-vote
//                 gate cloned from the PO gate: proposer sees no vote control,
//                 each voter votes once, two matching votes decide.
//
// Printing reuses the ledger-document trio (docvm/docs/printHtml) — a row
// with an RCT-… number prints the receipt, a CN-… row prints the credit note,
// both straight off the row's own columns.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Printer, Image as ImageIcon, Undo2, Scale } from "lucide-react";
import { Btn, Stat, Table, TH, TD } from "@/components/ui";
import { formatSar } from "@/lib/utils";
import {
  recordRefund,
  proposeLedgerCorrection,
  voteLedgerCorrection,
  getLedgerPhotoSignedUrl,
  type LedgerDocResult,
} from "@/lib/actions/finance";
import { buildLedgerDocVm } from "@/lib/docvm/ledgerDoc";
import { buildLedgerDocHtml } from "@/lib/docs/ledgerDoc";
import { printHtml } from "@/lib/printHtml";
import type { CompanySettings } from "@/lib/db-types";
import type {
  LedgerEntryRow,
  LedgerEntryType,
  LedgerCorrectionRow,
  LedgerCorrectionVoteRow,
} from "@/lib/customer-ledger";
import ScrollLock from "@/components/ScrollLock";
import { useApp } from "@/components/AppShell";
import { t, fill, type Lang } from "@/lib/i18n";
import { paymentMethodLabel } from "@/lib/enum-labels";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// Same words the statement's Type column uses (lib/statementViewModel.ts's
// typeKeyOf) — one vocabulary for the same six row kinds, on screen and on
// paper. Exhaustive switch: a new entry_type fails typecheck here, on purpose.
function typeLabel(et: LedgerEntryType, lang: Lang): string {
  switch (et) {
    case "topup":
      return t("trips.finance.addBalance", lang);
    case "refund":
      return t("trips.statement.typeReturn", lang);
    case "invoice_draw":
      return t("trips.statement.typeInvoiceDraw", lang);
    case "balance_applied":
      return t("trips.statement.typeBalanceApplied", lang);
    case "draw_reversal":
      return t("trips.statement.typeDrawReversal", lang);
    case "correction":
      return t("trips.statement.typeCorrection", lang);
  }
}

export default function CustomerLedgerModal({
  open,
  onClose,
  customer,
  entries,
  balance,
  uninvoiced,
  available,
  corrections,
  votesByCorrection,
  currentUserEmail,
  company,
}: {
  open: boolean;
  onClose: () => void;
  customer: { id: string; name: string } | null;
  /** customer_ledger rows for THIS customer, oldest-first (fetch order). */
  entries: LedgerEntryRow[];
  /** The three view figures — passed through, never derived here. */
  balance: number;
  uninvoiced: number;
  available: number;
  corrections: LedgerCorrectionRow[];
  votesByCorrection: Map<string, LedgerCorrectionVoteRow[]>;
  currentUserEmail: string | null;
  /** Letterhead for prints. null prints an unheaded sheet, never blocks. */
  company: CompanySettings | null;
}) {
  const router = useRouter();
  const { lang } = useApp();

  // Which inline panel is open under the action row. One at a time.
  const [panel, setPanel] = useState<"refund" | "correction" | null>(null);

  // ── Refund form ──────────────────────────────────────────────────────────
  const [refAmount, setRefAmount] = useState("");
  const [refMethod, setRefMethod] = useState<"" | "cash" | "bank_transfer">("");
  const [refReference, setRefReference] = useState("");
  const [refNote, setRefNote] = useState("");
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  // The credit note record_refund just returned — its CN number and print.
  const [creditNote, setCreditNote] = useState<LedgerDocResult | null>(null);

  // ── Correction form ──────────────────────────────────────────────────────
  const [corrAmount, setCorrAmount] = useState("");
  const [corrReason, setCorrReason] = useState("");
  const [proposing, setProposing] = useState(false);
  const [corrError, setCorrError] = useState<string | null>(null);
  const [corrDone, setCorrDone] = useState(false);

  // ── Voting ───────────────────────────────────────────────────────────────
  const [voteComments, setVoteComments] = useState<Record<string, string>>({});
  const [votingId, setVotingId] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<{ id: string; msg: string } | null>(null);

  // Photo-link failures (ledger rows with a slip attached).
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Fresh state on every open — same rule as AddBalanceModal.
  useEffect(() => {
    if (!open) return;
    setPanel(null);
    setRefAmount("");
    setRefMethod("");
    setRefReference("");
    setRefNote("");
    setRefunding(false);
    setRefundError(null);
    setCreditNote(null);
    setCorrAmount("");
    setCorrReason("");
    setProposing(false);
    setCorrError(null);
    setCorrDone(false);
    setVoteComments({});
    setVotingId(null);
    setVoteError(null);
    setPhotoError(null);
  }, [open, customer]);

  // Running balance — THE sanctioned presentation walk (see header). Rows
  // arrive oldest-first; each row's running figure is the cumulative sum of
  // amount_sar up to and including it.
  const walked = useMemo(() => {
    let run = 0;
    return entries.map((e) => {
      run += e.amount_sar;
      return { e, run };
    });
  }, [entries]);

  const pending = useMemo(
    () => corrections.filter((c) => c.status === "pending"),
    [corrections],
  );

  const busy = refunding || proposing || votingId !== null;

  function close() {
    if (busy) return;
    onClose();
  }

  async function onViewPhoto(entryId: string) {
    const r = await getLedgerPhotoSignedUrl(entryId);
    if (r.error || !r.data) {
      setPhotoError(r.error ?? t("trips.addBalance.errPhoto", lang));
      return;
    }
    setPhotoError(null);
    window.open(r.data.url, "_blank", "noopener,noreferrer");
  }

  // Print a numbered ledger row (RCT-… or CN-…) straight off its own columns.
  function onPrintRow(e: LedgerEntryRow) {
    if (!customer || !e.doc_number) return;
    if (e.entry_type !== "topup" && e.entry_type !== "refund") return;
    const vm = buildLedgerDocVm({
      lang,
      generatedAt: new Date(),
      kind: e.entry_type,
      docNumber: e.doc_number,
      customerName: customer.name,
      amountSar: e.amount_sar,
      method: e.method,
      reference: e.reference,
      note: e.note,
      createdAt: e.created_at,
      createdBy: e.created_by,
      company,
    });
    printHtml(buildLedgerDocHtml(vm));
  }

  // Print the credit note that JUST saved — from record_refund's own return.
  function onPrintCreditNote() {
    if (!customer || !creditNote) return;
    const vm = buildLedgerDocVm({
      lang,
      generatedAt: new Date(),
      kind: "refund",
      docNumber: creditNote.docNumber,
      customerName: customer.name,
      amountSar: creditNote.amountSar,
      method: creditNote.method,
      reference: creditNote.reference,
      note: creditNote.note,
      createdAt: creditNote.createdAt,
      createdBy: creditNote.createdBy,
      company,
    });
    printHtml(buildLedgerDocHtml(vm));
  }

  const canRefund =
    Number(refAmount) > 0 &&
    refMethod !== "" &&
    // Same required-flip as Add Balance: ETF ref only required for bank.
    (refMethod === "cash" || refReference.trim() !== "");

  async function onRefund(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!customer) return;
    if (!canRefund) {
      setRefundError(t("trips.ledger.errRefundIncomplete", lang));
      return;
    }
    setRefunding(true);
    setRefundError(null);
    try {
      const fd = new FormData();
      fd.set("customerId", customer.id);
      fd.set("amountSar", refAmount);
      fd.set("method", refMethod);
      fd.set("reference", refReference);
      fd.set("note", refNote);
      const res = await recordRefund(fd);
      if (res.error || !res.data) {
        // VERBATIM — an over-Available refusal is the DATABASE's sentence
        // (record_refund's raise) and must reach the screen unedited.
        setRefundError(res.error ?? t("shared.upload.saveFailedNetwork", lang));
        return;
      }
      setCreditNote(res.data);
      setRefAmount("");
      setRefMethod("");
      setRefReference("");
      setRefNote("");
      router.refresh();
    } catch {
      setRefundError(t("shared.upload.saveFailedNetwork", lang));
    } finally {
      setRefunding(false);
    }
  }

  const canPropose =
    corrAmount.trim() !== "" &&
    Number.isFinite(Number(corrAmount)) &&
    Number(corrAmount) !== 0 &&
    corrReason.trim() !== "";

  async function onPropose(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!customer) return;
    if (!canPropose) {
      setCorrError(t("trips.ledger.errCorrIncomplete", lang));
      return;
    }
    setProposing(true);
    setCorrError(null);
    setCorrDone(false);
    try {
      const fd = new FormData();
      fd.set("customerId", customer.id);
      fd.set("amountSar", corrAmount);
      fd.set("reason", corrReason);
      const res = await proposeLedgerCorrection(fd);
      if (res.error) {
        setCorrError(res.error);
        return;
      }
      setCorrDone(true);
      setCorrAmount("");
      setCorrReason("");
      router.refresh();
    } catch {
      setCorrError(t("shared.upload.saveFailedNetwork", lang));
    } finally {
      setProposing(false);
    }
  }

  async function onVote(correctionId: string, action: "approve" | "reject") {
    setVotingId(correctionId);
    setVoteError(null);
    try {
      const fd = new FormData();
      fd.set("correctionId", correctionId);
      fd.set("action", action);
      fd.set("comment", voteComments[correctionId] ?? "");
      const res = await voteLedgerCorrection(fd);
      if (res.error) {
        // VERBATIM — proposer-cannot-vote / double-vote refusals are the
        // RPC's own sentences.
        setVoteError({ id: correctionId, msg: res.error });
        return;
      }
      router.refresh();
    } catch {
      setVoteError({ id: correctionId, msg: t("shared.upload.saveFailedNetwork", lang) });
    } finally {
      setVotingId(null);
    }
  }

  if (!open || !customer) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
      <ScrollLock />
      <div
        className="card p-6 w-full max-w-[1080px] max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          {/* Customer name is USER DATA — prints as stored in either language. */}
          <h2 className="text-lg font-semibold">
            {fill(t("trips.ledger.title", lang), { name: customer.name })}
          </h2>
          <button type="button" onClick={close} className="muted hover:text-[rgb(var(--fg))]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm muted mb-4">{t("trips.ledger.subtitle", lang)}</p>

        {/* The three readers — view figures verbatim. Available below zero is
            the tab's alarm state and stays rose here too. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <Stat
            label={t("trips.finance.colBalance", lang)}
            value={formatSar(balance)}
            sub={t("trips.finance.colBalanceHint", lang)}
          />
          <Stat
            label={t("trips.finance.colUninvoiced", lang)}
            value={formatSar(uninvoiced)}
            sub={t("trips.finance.colUninvoicedHint", lang)}
            tone={uninvoiced > 0 ? "warn" : undefined}
          />
          <Stat
            label={t("trips.finance.colAvailable", lang)}
            value={formatSar(available)}
            sub={t("trips.finance.colAvailableHint", lang)}
            tone={available < 0 ? "bad" : "ok"}
          />
        </div>

        {/* Action row — each button opens its inline panel below. */}
        <div className="flex items-center gap-2 mb-4">
          <Btn
            variant={panel === "refund" ? "primary" : "outline"}
            onClick={() => setPanel(panel === "refund" ? null : "refund")}
          >
            <Undo2 className="h-4 w-4" /> {t("trips.ledger.refund", lang)}
          </Btn>
          <Btn
            variant={panel === "correction" ? "primary" : "outline"}
            onClick={() => setPanel(panel === "correction" ? null : "correction")}
          >
            <Scale className="h-4 w-4" /> {t("trips.ledger.proposeCorrection", lang)}
          </Btn>
        </div>

        {panel === "refund" && (
          <div className="card p-4 mb-4">
            <p className="text-sm font-medium mb-1">{t("trips.ledger.refund", lang)}</p>
            <p className="text-sm muted mb-3">{t("trips.ledger.refundSubtitle", lang)}</p>
            <form onSubmit={onRefund} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{t("trips.addBalance.fAmount", lang)} *</span>
                  <input
                    value={refAmount}
                    onChange={(e) => setRefAmount(e.target.value)}
                    type="number"
                    min="0"
                    step="any"
                    required
                    className={INPUT}
                    style={INPUT_STYLE}
                  />
                </label>
                <div className="flex items-end gap-4 text-sm pb-2">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="refundMethod"
                      value="cash"
                      checked={refMethod === "cash"}
                      onChange={() => setRefMethod("cash")}
                    />
                    {t("labels.payCash", lang)}
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="refundMethod"
                      value="bank_transfer"
                      checked={refMethod === "bank_transfer"}
                      onChange={() => setRefMethod("bank_transfer")}
                    />
                    {t("labels.payBankTransfer", lang)}
                  </label>
                </div>
              </div>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">
                  {t("trips.addBalance.fEtfRef", lang)}
                  {refMethod === "bank_transfer"
                    ? t("trips.addBalance.suffixRequired", lang)
                    : t("trips.addBalance.suffixOptional", lang)}
                </span>
                <input
                  value={refReference}
                  onChange={(e) => setRefReference(e.target.value)}
                  required={refMethod === "bank_transfer"}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t("common.note", lang)}</span>
                <textarea
                  value={refNote}
                  onChange={(e) => setRefNote(e.target.value)}
                  rows={2}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>

              {refundError && (
                <p className="text-sm text-rose-600 dark:text-rose-400">{refundError}</p>
              )}
              {creditNote && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    {fill(t("trips.ledger.refundDone", lang), { n: creditNote.docNumber })}
                  </p>
                  <Btn type="button" variant="outline" onClick={onPrintCreditNote}>
                    <Printer className="h-4 w-4" /> {t("trips.ledger.printCreditNote", lang)}
                  </Btn>
                </div>
              )}

              <div className="flex items-center justify-end pt-1">
                <Btn
                  type="submit"
                  variant="primary"
                  className={!canRefund || refunding ? "opacity-50 pointer-events-none" : ""}
                >
                  {t(refunding ? "trips.ledger.refunding" : "trips.ledger.refund", lang)}
                </Btn>
              </div>
            </form>
          </div>
        )}

        {panel === "correction" && (
          <div className="card p-4 mb-4">
            <p className="text-sm font-medium mb-1">{t("trips.ledger.proposeCorrection", lang)}</p>
            <p className="text-sm muted mb-3">{t("trips.ledger.corrSubtitle", lang)}</p>
            <form onSubmit={onPropose} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{t("trips.ledger.fCorrAmount", lang)} *</span>
                  {/* Signed on purpose — no min: a correction can move either
                      way; the RPC refuses only zero. */}
                  <input
                    value={corrAmount}
                    onChange={(e) => setCorrAmount(e.target.value)}
                    type="number"
                    step="any"
                    required
                    className={INPUT}
                    style={INPUT_STYLE}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{t("trips.ledger.fReason", lang)} *</span>
                  <input
                    value={corrReason}
                    onChange={(e) => setCorrReason(e.target.value)}
                    required
                    className={INPUT}
                    style={INPUT_STYLE}
                  />
                </label>
              </div>

              {corrError && <p className="text-sm text-rose-600 dark:text-rose-400">{corrError}</p>}
              {corrDone && (
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  {t("trips.ledger.corrProposed", lang)}
                </p>
              )}

              <div className="flex items-center justify-end pt-1">
                <Btn
                  type="submit"
                  variant="primary"
                  className={!canPropose || proposing ? "opacity-50 pointer-events-none" : ""}
                >
                  {t(proposing ? "trips.ledger.proposing" : "trips.ledger.proposeCorrection", lang)}
                </Btn>
              </div>
            </form>
          </div>
        )}

        {/* Pending corrections — the 2-vote gate. Proposer sees no controls;
            a voter who already voted sees none either. */}
        {pending.length > 0 && (
          <div className="mb-4">
            <p className="text-sm font-medium mb-2">{t("trips.ledger.pendingCorrections", lang)}</p>
            <div className="space-y-2">
              {pending.map((c) => {
                const votes = votesByCorrection.get(c.id) ?? [];
                const isProposer = currentUserEmail !== null && currentUserEmail === c.proposed_by;
                const hasVoted =
                  currentUserEmail !== null &&
                  votes.some((v) => v.approver_email === currentUserEmail);
                return (
                  <div key={c.id} className="card p-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span
                        className={
                          "text-base font-semibold tabular-nums " +
                          (c.amount_sar >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400")
                        }
                      >
                        {c.amount_sar >= 0 ? "+" : ""}
                        {formatSar(c.amount_sar)}
                      </span>
                      <span className="text-xs muted">
                        {fill(t("trips.ledger.corrProposedBy", lang), { name: c.proposed_by })}
                      </span>
                    </div>
                    <p className="text-sm mt-1">{c.reason}</p>

                    {votes.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {votes.map((v) => (
                          <p key={v.id} className="text-xs muted">
                            {v.approver_email} —{" "}
                            {t(
                              v.action === "approve" ? "trips.ledger.approve" : "trips.ledger.reject",
                              lang,
                            )}
                            {v.comment ? ` · ${v.comment}` : ""}
                          </p>
                        ))}
                      </div>
                    )}

                    {voteError?.id === c.id && (
                      <p className="text-sm text-rose-600 dark:text-rose-400 mt-2">
                        {voteError.msg}
                      </p>
                    )}

                    {isProposer ? (
                      <p className="text-xs muted mt-2">{t("trips.ledger.corrYouProposed", lang)}</p>
                    ) : hasVoted ? (
                      <p className="text-xs muted mt-2">{t("trips.ledger.corrYouVoted", lang)}</p>
                    ) : (
                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        <input
                          value={voteComments[c.id] ?? ""}
                          onChange={(e) =>
                            setVoteComments((m) => ({ ...m, [c.id]: e.target.value }))
                          }
                          placeholder={t("trips.ledger.fComment", lang)}
                          className={INPUT + " flex-1 min-w-[200px]"}
                          style={INPUT_STYLE}
                        />
                        <Btn
                          variant="outline"
                          onClick={() => onVote(c.id, "approve")}
                          className={votingId !== null ? "opacity-50 pointer-events-none" : ""}
                        >
                          {t("trips.ledger.approve", lang)}
                        </Btn>
                        <Btn
                          variant="outline"
                          onClick={() => onVote(c.id, "reject")}
                          className={
                            "text-rose-600 dark:text-rose-400 " +
                            (votingId !== null ? "opacity-50 pointer-events-none" : "")
                          }
                        >
                          {t("trips.ledger.reject", lang)}
                        </Btn>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {photoError && (
          <p className="text-sm text-rose-600 dark:text-rose-400 mb-3">{photoError}</p>
        )}

        {/* The ledger itself — oldest-first, running balance walked down. */}
        {entries.length === 0 ? (
          <div className="card p-8 text-center muted text-sm">{t("trips.ledger.empty", lang)}</div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>{t("common.date", lang)}</TH>
                  <TH>{t("common.type", lang)}</TH>
                  <TH>{t("trips.statement.colRef", lang)}</TH>
                  <TH>{t("trips.finance.colMethod", lang)}</TH>
                  <TH>{t("common.note", lang)}</TH>
                  <TH>{t("common.amount", lang)}</TH>
                  <TH>{t("trips.statement.colRunningBalance", lang)}</TH>
                  <TH>{null}</TH>
                </tr>
              </thead>
              <tbody>
                {walked.map(({ e, run }) => (
                  <tr key={e.id}>
                    <TD className="tabular-nums">{e.created_at.slice(0, 10)}</TD>
                    <TD>{typeLabel(e.entry_type, lang)}</TD>
                    {/* Ref = the row's own document number, else the invoice
                        it is linked to. Corrections have neither, on purpose:
                        their paper trail is the corrections table. */}
                    <TD className="tabular-nums">
                      {e.doc_number ?? e.invoice?.invoice_number ?? (
                        <span className="muted">—</span>
                      )}
                    </TD>
                    <TD>
                      {e.method === "cash" || e.method === "bank_transfer" ? (
                        paymentMethodLabel(e.method, lang)
                      ) : e.method ? (
                        e.method
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </TD>
                    <TD className="max-w-[220px]">
                      {e.note ? (
                        <span className="block truncate" title={e.note}>
                          {e.note}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </TD>
                    <TD
                      className={
                        "tabular-nums font-medium " +
                        (e.amount_sar >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400")
                      }
                    >
                      {e.amount_sar >= 0 ? "+" : ""}
                      {formatSar(e.amount_sar)}
                    </TD>
                    <TD className="tabular-nums">{formatSar(run)}</TD>
                    <TD>
                      <div className="flex items-center gap-3">
                        {e.doc_number &&
                          (e.entry_type === "topup" || e.entry_type === "refund") && (
                            <button
                              type="button"
                              onClick={() => onPrintRow(e)}
                              className="inline-flex items-center gap-1 text-brand-600 hover:underline"
                            >
                              <Printer className="h-3.5 w-3.5" /> {t("common.print", lang)}
                            </button>
                          )}
                        {e.photo_path && (
                          <button
                            type="button"
                            onClick={() => onViewPhoto(e.id)}
                            className="inline-flex items-center gap-1 text-brand-600 hover:underline"
                          >
                            <ImageIcon className="h-3.5 w-3.5" /> {t("common.view", lang)}
                          </button>
                        )}
                      </div>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
