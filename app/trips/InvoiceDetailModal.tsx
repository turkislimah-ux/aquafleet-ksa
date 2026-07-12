"use client";

// Invoice workspace (Finance 5c) — the full Draft -> Review -> Confirmed ->
// Paid (+ Void) lifecycle for ONE invoice. Opened from InvoicesModal.
//
// Draft/Review stay LIVE: numbers come from previewInvoice() (always
// recomputes from current trips, per lib/invoice.ts's locked design).
// Confirmed/Paid/Void read the FROZEN snapshot columns straight off the
// invoices row via getInvoice() — never re-derived, so a printed/emailed
// invoice never silently drifts from what was actually confirmed.
//
// Both sources normalize into the same `View` shape below (InvoiceLine and
// InvoiceLineSnapshot are structurally identical — see lib/invoice.ts /
// lib/db-types.ts), so the render code below doesn't care which one it got.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X, Printer, Mail, Plus, Trash2, AlertTriangle } from "lucide-react";
import { Btn, StatusPill, Table, TH, TD } from "@/components/ui";
import { formatSar } from "@/lib/utils";
import { canEditSpecialCharges } from "@/lib/invoice";
import {
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type Invoice,
  type InvoiceLineSnapshot,
} from "@/lib/db-types";
import {
  getInvoice,
  previewInvoice,
  addSpecialCharge,
  removeSpecialCharge,
  setInvoiceReview,
  revertInvoiceToDraft,
  confirmInvoice,
  voidInvoice,
  markInvoicePaid,
  unpayInvoice,
  deleteDraftInvoice,
  getProofSignedUrl,
  getCompanyEmail,
} from "./invoiceActions";

// Fallback company email — used in template bodies/signatures whenever
// company_settings.email is unset. mailto cannot set the actual From
// address (opens in the user's own mail client) — this is reference text
// only, never the "to" or a forced sender.
const FALLBACK_COMPANY_EMAIL = "info@binslimah.com";

// Four purpose-specific mailto templates (Finance email templates, 0028/0029).
// Each maps to a distinct tone/purpose picked by the user before mailto opens.
type EmailType = "statement" | "payment_due" | "reminder" | "generic";
const EMAIL_TYPE_META: Record<EmailType, { label: string; hint: string }> = {
  statement: { label: "Monthly report / statement", hint: "Activity summary for the period." },
  payment_due: { label: "Payment due", hint: "This invoice is now due — request payment." },
  reminder: { label: "Payment reminder", hint: "Follow-up nudge for an outstanding balance." },
  generic: { label: "Plain / generic", hint: "Minimal — just the invoice reference." },
};

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

type Totals = { subtotal: number; vat: number; total: number };
type View = {
  coveredLines: InvoiceLineSnapshot[];
  unpaidLines: InvoiceLineSnapshot[];
  covered: Totals;
  amountDue: Totals;
  grand: Totals;
  sellerSnapshot: { legal_name: string; vat_number: string | null; cr_number: string | null; address: string | null } | null;
  buyerSnapshot: { name: string; vat_number: string | null; cr_number: string | null; billing_address: string | null } | null;
};

export default function InvoiceDetailModal({
  open,
  invoiceId,
  customerEmail,
  onClose,
  onBack,
  onMutated,
}: {
  open: boolean;
  invoiceId: string | null;
  customerEmail: string | null;
  onClose: () => void;
  onBack: () => void;
  onMutated: () => void;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<Invoice | null>(null);
  const [view, setView] = useState<View | null>(null);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Add-charge form (draft/review only).
  const [chargeLabel, setChargeLabel] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");

  // Two-step guards + inline forms for the irreversible/gated actions.
  const [confirmingConfirm, setConfirmingConfirm] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [payingOpen, setPayingOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<"cash" | "bank_transfer">("cash");
  const [unpaying, setUnpaying] = useState(false);
  const [unpayReason, setUnpayReason] = useState("");
  const [deletingDraft, setDeletingDraft] = useState(false);

  // Email templates (0028/0029): company email for the signature line, and
  // the open/closed state of the type-picker modal.
  const [companyEmail, setCompanyEmail] = useState<string | null>(null);
  const [emailPickerOpen, setEmailPickerOpen] = useState(false);

  async function load() {
    if (!invoiceId) return;
    setLoading(true);
    setError(null);
    const r = await getInvoice(invoiceId);
    if (r.error || !r.data) {
      setError(r.error ?? "Could not load invoice.");
      setLoading(false);
      return;
    }
    setRaw(r.data);

    if (r.data.status === "draft" || r.data.status === "review") {
      const p = await previewInvoice(invoiceId);
      if (p.error || !p.data) {
        setError(p.error ?? "Could not assemble invoice preview.");
        setLoading(false);
        return;
      }
      setView({
        coveredLines: p.data.coveredLines,
        unpaidLines: p.data.unpaidLines,
        covered: p.data.covered,
        amountDue: p.data.amountDue,
        grand: p.data.grand,
        sellerSnapshot: (p.data.sellerSnapshot as View["sellerSnapshot"]) ?? null,
        buyerSnapshot: (p.data.buyerSnapshot as View["buyerSnapshot"]) ?? null,
      });
    } else {
      setView({
        coveredLines: r.data.covered_lines ?? [],
        unpaidLines: r.data.unpaid_lines ?? [],
        covered: { subtotal: r.data.covered_subtotal_sar, vat: r.data.covered_vat_sar, total: r.data.covered_total_sar },
        amountDue: { subtotal: r.data.amount_due_subtotal_sar, vat: r.data.amount_due_vat_sar, total: r.data.amount_due_sar },
        grand: { subtotal: r.data.grand_subtotal_sar, vat: r.data.grand_vat_sar, total: r.data.grand_total_sar },
        sellerSnapshot: r.data.seller_snapshot,
        buyerSnapshot: r.data.buyer_snapshot,
      });
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!open || !invoiceId) return;
    setActionError(null);
    setConfirmingConfirm(false);
    setVoiding(false);
    setVoidReason("");
    setPayingOpen(false);
    setPayMethod("cash");
    setUnpaying(false);
    setUnpayReason("");
    setDeletingDraft(false);
    setChargeLabel("");
    setChargeAmount("");
    setEmailPickerOpen(false);
    load();
    getCompanyEmail().then((r) => setCompanyEmail(r.data?.email ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId]);

  async function refresh() {
    await load();
    onMutated();
    router.refresh();
  }

  function handlePrint() {
    document.body.classList.add("printing-invoice");
    const cleanup = () => {
      document.body.classList.remove("printing-invoice");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  async function runAction(fn: () => Promise<{ error: string | null }>) {
    setBusy(true);
    setActionError(null);
    const res = await fn();
    setBusy(false);
    if (res.error) {
      setActionError(res.error);
      return false;
    }
    await refresh();
    return true;
  }

  async function onAddCharge(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceId || !chargeLabel.trim() || Number(chargeAmount) <= 0) return;
    await runAction(() => addSpecialCharge(invoiceId, chargeLabel.trim(), Number(chargeAmount)));
    setChargeLabel("");
    setChargeAmount("");
  }

  async function onViewProof() {
    if (!invoiceId) return;
    const r = await getProofSignedUrl(invoiceId);
    if (r.error || !r.data) {
      setActionError(r.error ?? "Could not open proof of payment.");
      return;
    }
    window.open(r.data.url, "_blank", "noopener,noreferrer");
  }

  // Deletion removes the row entirely (0030 — draft-only, releases reserved
  // trips) — unlike other actions, refresh()/load() would fail afterward
  // since invoiceId no longer resolves, so this goes straight back to the
  // invoice list instead.
  async function onDeleteDraft() {
    if (!invoiceId) return;
    setBusy(true);
    setActionError(null);
    const res = await deleteDraftInvoice(invoiceId);
    setBusy(false);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    onMutated();
    onBack();
  }

  async function onMarkPaid(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!invoiceId) return;
    const form = new FormData(e.currentTarget);
    form.set("invoiceId", invoiceId);
    setBusy(true);
    setActionError(null);
    const res = await markInvoicePaid(form);
    setBusy(false);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    setPayingOpen(false);
    await refresh();
  }

  if (!open || !invoiceId || !mounted) return null;

  const status = raw?.status;
  const editable = raw ? canEditSpecialCharges(raw.status) : false;
  const canEmail = !!(raw && view && customerEmail);

  function sendTemplate(type: EmailType) {
    if (!raw || !view || !customerEmail) return;
    const href = buildMailtoFor(type, raw, view, customerEmail, companyEmail);
    setEmailPickerOpen(false);
    window.location.href = href;
  }

  return createPortal(
    <>
    <div className="invoice-print-portal fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="card p-0 w-full max-w-4xl max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar — not printed. */}
        <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-app bg-[rgb(var(--card))] px-5 py-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onBack} className="text-sm muted hover:text-[rgb(var(--fg))]">
              ← Back to invoices
            </button>
            {status && <StatusPill status={status} label={INVOICE_STATUS_LABELS[status]} />}
          </div>
          <div className="flex items-center gap-2">
            <span title={!canEmail && raw && view ? "No customer email on file" : undefined}>
              <Btn
                variant="outline"
                onClick={() => canEmail && setEmailPickerOpen(true)}
                className={!canEmail ? "opacity-50 pointer-events-none" : ""}
              >
                <Mail className="h-4 w-4" /> Email
              </Btn>
            </span>
            <Btn variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4" /> Print
            </Btn>
            <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {loading && <div className="p-10 text-center muted text-sm">Loading invoice…</div>}
        {error && <div className="p-10 text-center text-sm text-rose-600 dark:text-rose-400">{error}</div>}

        {!loading && !error && raw && view && (
          <div id="invoice-print" className="p-6 space-y-6">
            {/* Header — identity + document meta. */}
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div>
                <h2 className="text-xl font-semibold">
                  {raw.invoice_number ? `Invoice #${raw.invoice_number}` : "Invoice (draft — not yet numbered)"}
                </h2>
                <p className="text-sm muted mt-0.5">
                  {raw.period_start} → {raw.period_end}
                </p>
                {raw.vat_ref && <p className="text-sm muted">VAT ref: {raw.vat_ref}</p>}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <IdentityBlock title="Seller" name={view.sellerSnapshot?.legal_name ?? null} vat={view.sellerSnapshot?.vat_number ?? null} cr={view.sellerSnapshot?.cr_number ?? null} address={view.sellerSnapshot?.address ?? null} />
                <IdentityBlock title="Buyer" name={view.buyerSnapshot?.name ?? null} vat={view.buyerSnapshot?.vat_number ?? null} cr={view.buyerSnapshot?.cr_number ?? null} address={view.buyerSnapshot?.billing_address ?? null} extra={customerEmail} />
              </div>
            </div>

            {raw.status === "void" && raw.void_reason && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-700 dark:text-rose-300 break-inside-avoid">
                <span className="font-medium">Voided</span> {raw.voided_at ? `on ${raw.voided_at.slice(0, 10)}` : ""} — {raw.void_reason}
              </div>
            )}

            {/* Covered table — omitted entirely when empty (postpaid, or a
                prepaid customer with nothing yet covered this period). */}
            {view.coveredLines.length > 0 && (
              <LineTable title="Covered (paid from prepaid balance)" lines={view.coveredLines} totals={view.covered} />
            )}

            {/* Unpaid / Amount Due table — always shown, this IS the
                collectible amount. */}
            <LineTable
              title="Unpaid — Amount Due"
              lines={view.unpaidLines}
              totals={view.amountDue}
              editable={editable}
              onRemoveCharge={(id) =>
                runAction(() => removeSpecialCharge(invoiceId, id))
              }
            />

            {editable && (
              <form onSubmit={onAddCharge} className="flex items-end gap-2 flex-wrap break-inside-avoid no-print">
                <label className="flex flex-col gap-1 text-sm flex-1 min-w-[10rem]">
                  <span className="font-medium">Special charge label</span>
                  <input value={chargeLabel} onChange={(e) => setChargeLabel(e.target.value)} className={INPUT} style={INPUT_STYLE} placeholder="e.g. Callout fee" />
                </label>
                <label className="flex flex-col gap-1 text-sm w-40">
                  <span className="font-medium">Amount (pre-VAT)</span>
                  <input value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} type="number" min="0" step="any" className={INPUT} style={INPUT_STYLE} placeholder="0" />
                </label>
                <Btn type="submit" variant="outline" className={!chargeLabel.trim() || Number(chargeAmount) <= 0 ? "opacity-50 pointer-events-none" : ""}>
                  <Plus className="h-4 w-4" /> Add charge
                </Btn>
              </form>
            )}

            {/* Grand Total + Amount Due — both required, shown side by side. */}
            <div className="grid grid-cols-2 gap-4 break-inside-avoid">
              <TotalCard label="Grand Total (full period value)" totals={view.grand} tone="info" />
              <TotalCard label="Amount Due (collectible)" totals={view.amountDue} tone={view.amountDue.total > 0 ? "bad" : "ok"} />
            </div>

            {raw.status === "paid" && (
              <div className="rounded-lg border border-app p-3 text-sm break-inside-avoid">
                <span className="font-medium">Paid</span> {raw.paid_at ? `on ${raw.paid_at.slice(0, 10)}` : ""} via{" "}
                {raw.payment_method ? PAYMENT_METHOD_LABELS[raw.payment_method] : "—"}.
                {raw.proof_of_payment_path && (
                  <Btn variant="ghost" className="ms-2 no-print" onClick={onViewProof}>
                    View proof
                  </Btn>
                )}
              </div>
            )}

            {actionError && <p className="text-sm text-rose-600 dark:text-rose-400 no-print">{actionError}</p>}

            {/* Actions — status-dependent, not printed. */}
            <div className="no-print border-t border-app pt-4 space-y-3">
              {status === "draft" && !deletingDraft && (
                <div className="flex items-center gap-2">
                  <Btn variant="primary" onClick={() => runAction(() => setInvoiceReview(invoiceId))} className={busy ? "opacity-50 pointer-events-none" : ""}>
                    Move to Review
                  </Btn>
                  <Btn variant="outline" onClick={() => setDeletingDraft(true)} className={busy ? "opacity-50 pointer-events-none" : ""}>
                    <Trash2 className="h-4 w-4" /> Delete draft
                  </Btn>
                </div>
              )}
              {status === "draft" && deletingDraft && (
                <GuardBox
                  warning="Deletes this draft and releases every trip it had reserved, freeing them for another invoice. This cannot be undone."
                  busy={busy}
                  confirmLabel="Yes, delete draft"
                  onCancel={() => setDeletingDraft(false)}
                  onConfirm={onDeleteDraft}
                />
              )}

              {status === "review" && !confirmingConfirm && (
                <div className="flex items-center gap-2">
                  <Btn variant="outline" onClick={() => runAction(() => revertInvoiceToDraft(invoiceId))} className={busy ? "opacity-50 pointer-events-none" : ""}>
                    Back to Draft
                  </Btn>
                  <Btn variant="primary" onClick={() => setConfirmingConfirm(true)}>
                    Confirm Invoice
                  </Btn>
                </div>
              )}
              {status === "review" && confirmingConfirm && (
                <GuardBox
                  warning="Confirming assigns a permanent invoice number and VAT ref, and locks the invoice forever — there is no revert to draft after this. Special charges can no longer be edited."
                  busy={busy}
                  confirmLabel="Yes, confirm invoice"
                  onCancel={() => setConfirmingConfirm(false)}
                  onConfirm={() => runAction(() => confirmInvoice(invoiceId).then((r) => ({ error: r.error })))}
                />
              )}

              {status === "confirmed" && !voiding && !payingOpen && (
                <div className="flex items-center gap-2">
                  <Btn variant="primary" onClick={() => setPayingOpen(true)}>
                    Mark Paid
                  </Btn>
                  <Btn variant="outline" onClick={() => setVoiding(true)}>
                    Void
                  </Btn>
                </div>
              )}
              {status === "confirmed" && payingOpen && (
                <form onSubmit={onMarkPaid} className="space-y-3 max-w-sm">
                  <div className="flex items-center gap-4 text-sm">
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="paymentMethod" value="cash" checked={payMethod === "cash"} onChange={() => setPayMethod("cash")} />
                      Cash
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="paymentMethod" value="bank_transfer" checked={payMethod === "bank_transfer"} onChange={() => setPayMethod("bank_transfer")} />
                      Bank transfer
                    </label>
                  </div>
                  {payMethod === "bank_transfer" && (
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">Proof of payment (required) *</span>
                      <input type="file" name="proofFile" required className={INPUT} style={INPUT_STYLE} />
                    </label>
                  )}
                  <div className="flex items-center gap-2">
                    <Btn type="button" variant="ghost" onClick={() => setPayingOpen(false)}>
                      Cancel
                    </Btn>
                    <Btn type="submit" variant="primary" className={busy ? "opacity-50 pointer-events-none" : ""}>
                      {busy ? "Recording…" : "Confirm payment"}
                    </Btn>
                  </div>
                </form>
              )}
              {status === "confirmed" && voiding && (
                <div className="space-y-2 max-w-sm">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">Void reason *</span>
                    <textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} rows={2} className={INPUT} style={INPUT_STYLE} />
                  </label>
                  <GuardBox
                    warning="Voiding is the only undo for a confirmed invoice. The invoice number and VAT ref are retained forever, but this invoice will no longer be collectible."
                    busy={busy}
                    confirmLabel="Yes, void invoice"
                    confirmDisabled={!voidReason.trim()}
                    onCancel={() => setVoiding(false)}
                    onConfirm={() => runAction(() => voidInvoice(invoiceId, voidReason.trim()))}
                  />
                </div>
              )}

              {status === "paid" && !unpaying && (
                <Btn variant="outline" onClick={() => setUnpaying(true)}>
                  <AlertTriangle className="h-4 w-4" /> Admin: Un-pay
                </Btn>
              )}
              {status === "paid" && unpaying && (
                <div className="space-y-2 max-w-sm">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">Un-pay reason *</span>
                    <textarea value={unpayReason} onChange={(e) => setUnpayReason(e.target.value)} rows={2} className={INPUT} style={INPUT_STYLE} />
                  </label>
                  <GuardBox
                    warning="This reverses the payment and unlocks every trip this invoice locked. Only do this to correct a mistake — the customer's balance/collectible status changes immediately."
                    busy={busy}
                    confirmLabel="Yes, un-pay"
                    confirmDisabled={!unpayReason.trim()}
                    onCancel={() => setUnpaying(false)}
                    onConfirm={() => runAction(() => unpayInvoice(invoiceId, unpayReason.trim()))}
                  />
                </div>
              )}
            </div>

            <div className="border-t border-app pt-3 text-[11px] muted flex items-center justify-between">
              <span>Generated {new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>
              <span>Bin Slimah Group · Bousla</span>
            </div>
          </div>
        )}
      </div>
    </div>

    {emailPickerOpen && (
      <div
        className="no-print fixed inset-0 z-[60] grid place-items-center p-4 bg-black/40"
        onClick={() => setEmailPickerOpen(false)}
      >
        <div className="card p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Email invoice — choose type</h3>
            <button type="button" onClick={() => setEmailPickerOpen(false)} className="muted hover:text-[rgb(var(--fg))]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2">
            {(Object.keys(EMAIL_TYPE_META) as EmailType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => sendTemplate(type)}
                className="w-full text-left rounded-lg border border-app px-3 py-2 text-sm hover:border-brand-500 hover:bg-brand-500/10"
              >
                <div className="font-medium">{EMAIL_TYPE_META[type].label}</div>
                <div className="muted text-[11px]">{EMAIL_TYPE_META[type].hint}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    )}
    </>,
    document.body,
  );
}

function IdentityBlock({
  title,
  name,
  vat,
  cr,
  address,
  extra,
}: {
  title: string;
  name: string | null;
  vat: string | null;
  cr: string | null;
  address: string | null;
  extra?: string | null;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide muted mb-0.5">{title}</div>
      <div className="font-medium">{name ?? <span className="muted">Not on file</span>}</div>
      {vat && <div className="muted text-xs">VAT {vat}</div>}
      {cr && <div className="muted text-xs">CR {cr}</div>}
      {address && <div className="muted text-xs">{address}</div>}
      {extra && <div className="muted text-xs">{extra}</div>}
    </div>
  );
}

function LineTable({
  title,
  lines,
  totals,
  editable,
  onRemoveCharge,
}: {
  title: string;
  lines: InvoiceLineSnapshot[];
  totals: Totals;
  editable?: boolean;
  onRemoveCharge?: (id: string) => void;
}) {
  return (
    <section className="space-y-2 break-inside-avoid">
      <h3 className="text-xs font-semibold uppercase tracking-wide muted">{title}</h3>
      <div className="card p-0 overflow-hidden">
        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH>Date</TH>
              <TH>Description</TH>
              <TH>Amount</TH>
              <TH>VAT</TH>
              {editable && <TH></TH>}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <TD className="muted">Nothing here.</TD>
                <TD>{""}</TD>
                <TD>{""}</TD>
                <TD>{""}</TD>
                {editable && <TD>{""}</TD>}
              </tr>
            ) : (
              lines.map((l) => (
                <tr key={l.id}>
                  <TD>{l.trip_date ?? <span className="muted">—</span>}</TD>
                  <TD>{l.description}</TD>
                  <TD className="tabular-nums">{formatSar(l.amount_sar)}</TD>
                  <TD className="tabular-nums muted">{formatSar(l.vat_sar)}</TD>
                  {editable && (
                    <TD>
                      {l.kind === "charge" && onRemoveCharge && (
                        <button type="button" onClick={() => onRemoveCharge(l.id)} className="muted hover:text-rose-600 dark:hover:text-rose-400 no-print">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </TD>
                  )}
                </tr>
              ))
            )}
            <tr>
              <TD className="font-medium">{""}</TD>
              <TD className="font-medium">Subtotal / VAT / Total</TD>
              <TD className="tabular-nums font-medium">{formatSar(totals.subtotal)}</TD>
              <TD className="tabular-nums font-medium">{formatSar(totals.vat)}</TD>
              {editable && <TD>{""}</TD>}
            </tr>
          </tbody>
        </Table>
      </div>
    </section>
  );
}

function TotalCard({ label, totals, tone }: { label: string; totals: Totals; tone: "ok" | "bad" | "info" }) {
  const toneCls =
    tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-rose-600 dark:text-rose-400" : "text-brand-600 dark:text-brand-300";
  return (
    <div className="card p-4">
      <div className="text-xs muted uppercase tracking-wide">{label}</div>
      <div className={"text-2xl font-semibold mt-1 tabular-nums " + toneCls}>{formatSar(totals.total)}</div>
      <div className="text-xs muted mt-1">
        {formatSar(totals.subtotal)} + {formatSar(totals.vat)} VAT
      </div>
    </div>
  );
}

function GuardBox({
  warning,
  busy,
  confirmLabel,
  confirmDisabled,
  onCancel,
  onConfirm,
}: {
  warning: string;
  busy: boolean;
  confirmLabel: string;
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2 max-w-sm">
      <p className="text-sm text-amber-800 dark:text-amber-300 flex gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        {warning}
      </p>
      <div className="flex items-center gap-2">
        <Btn variant="ghost" onClick={onCancel}>
          Cancel
        </Btn>
        <Btn
          variant="primary"
          onClick={onConfirm}
          className={busy || confirmDisabled ? "opacity-50 pointer-events-none" : "bg-rose-600 hover:bg-rose-700"}
        >
          {busy ? "Working…" : confirmLabel}
        </Btn>
      </div>
    </div>
  );
}

// Builds the mailto: URI for one of the 4 template types. mailto only
// controls "to"/subject/body — it cannot set the From address, so
// companyEmail is referenced in the signature only, never used as a sender.
function buildMailtoFor(
  type: EmailType,
  raw: Invoice,
  view: View,
  customerEmail: string,
  companyEmail: string | null,
): string {
  const ref = raw.invoice_number ? `#${raw.invoice_number}` : `(draft, ${raw.period_start} to ${raw.period_end})`;
  const buyerName = view.buyerSnapshot?.name ?? "Customer";
  const period = `${raw.period_start} to ${raw.period_end}`;
  const vatLine = raw.vat_ref ? `VAT ref: ${raw.vat_ref}` : null;
  const grand = formatSar(view.grand.total);
  const due = formatSar(view.amountDue.total);
  const signature = ["Kind regards,", "Bin Slimah Group", companyEmail || FALLBACK_COMPANY_EMAIL];

  let subject: string;
  let bodyLines: (string | null)[];

  switch (type) {
    case "statement":
      subject = `Statement — ${buyerName} — ${period}`;
      bodyLines = [
        `Dear ${buyerName},`,
        "",
        `Please find below a summary of your account activity for the period ${period}.`,
        "",
        `Invoice ${ref}`,
        vatLine,
        `Grand Total: ${grand}`,
        `Amount Due: ${due}`,
        "",
        "If you have any questions about this statement, please don't hesitate to reach out.",
        "",
        ...signature,
      ];
      break;
    case "payment_due":
      subject = `Payment due — Invoice ${ref} — ${buyerName}`;
      bodyLines = [
        `Dear ${buyerName},`,
        "",
        `This is to confirm that invoice ${ref} for the period ${period} is now due for payment.`,
        "",
        vatLine,
        `Amount Due: ${due}`,
        "",
        "Kindly arrange payment at your earliest convenience. Please let us know if you need any further information to process this.",
        "",
        ...signature,
      ];
      break;
    case "reminder":
      subject = `Reminder — Payment outstanding for Invoice ${ref}`;
      bodyLines = [
        `Dear ${buyerName},`,
        "",
        `This is a friendly reminder that invoice ${ref} for the period ${period} remains outstanding.`,
        "",
        vatLine,
        `Amount Due: ${due}`,
        "",
        "We would appreciate it if you could arrange payment at your earliest convenience. If payment has already been made, please disregard this message.",
        "",
        ...signature,
      ];
      break;
    case "generic":
    default:
      subject = `Invoice ${ref}`;
      bodyLines = [`Dear ${buyerName},`, "", `Please find attached invoice ${ref} for the period ${period}.`, "", ...signature];
      break;
  }

  const body = bodyLines.filter((l) => l !== null).join("\n");
  return `mailto:${encodeURIComponent(customerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
