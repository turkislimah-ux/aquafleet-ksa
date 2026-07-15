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
import { X, Printer, Mail, Plus, Trash2, AlertTriangle, Download, Image as ImageIcon, Paperclip } from "lucide-react";
import { Btn, StatusPill, Table, TH, TD } from "@/components/ui";
import { formatSar, todayKey } from "@/lib/utils";
import { canEditSpecialCharges } from "@/lib/invoice";
import { round2 } from "@/lib/vat";
import { groupInvoiceLines } from "@/lib/invoiceDisplay";
import TripRefLink from "@/components/TripRefLink";
import {
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type Invoice,
  type InvoiceLineSnapshot,
  type WaterType,
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
  getInvoicePdf,
  updateDraftInvoicePeriod,
  getUndeliveredTripsForInvoice,
  uploadSpecialChargeImage,
  getSpecialChargeImageSignedUrl,
  type UndeliveredTripBlocker,
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
  // Display-only fallback (Finance polish batch C) — the project's CURRENT
  // water_type, used when a frozen/old line's own water_type is null. Never
  // written back to a stored snapshot.
  projectWaterType: WaterType | null;
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
  const [raw, setRaw] = useState<(Invoice & { projectWaterType: WaterType | null }) | null>(null);
  const [view, setView] = useState<View | null>(null);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Add-charge form (draft/review only) — shape matches the invoice table
  // (Finance polish batch B, item 3): date/description/quantity/price, with
  // amount = price * qty computed server-side (addSpecialCharge).
  const [chargeLabel, setChargeLabel] = useState("");
  const [chargeDate, setChargeDate] = useState(todayKey());
  const [chargeQty, setChargeQty] = useState("1");
  const [chargePrice, setChargePrice] = useState("");
  // Staged image file for the NEW charge (Finance polish batch D — "attach
  // while adding"). Uploaded right after addSpecialCharge() resolves, inside
  // the same onAddCharge submit. chargeImageInputKey forces the (uncontrolled)
  // file input to remount/clear after a successful add.
  const [chargeImageFile, setChargeImageFile] = useState<File | null>(null);
  const [chargeImageInputKey, setChargeImageInputKey] = useState(0);
  const [addingCharge, setAddingCharge] = useState(false);

  // Draft-only period edit (item 1) — same date-range shape as
  // InvoicesModal's "create draft" form, reused here to CHANGE a draft's
  // period. updateDraftInvoicePeriod re-syncs reservation server-side.
  const [editingPeriod, setEditingPeriod] = useState(false);
  const [periodStartInput, setPeriodStartInput] = useState("");
  const [periodEndInput, setPeriodEndInput] = useState("");
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [savingPeriod, setSavingPeriod] = useState(false);

  // Undelivered-trip blockers (item 2) — fetched only at Review, mirrors the
  // SERVER-SIDE guard in confirm_invoice() (migration 0032) so the UI and DB
  // can never disagree about what blocks Confirm.
  const [blockers, setBlockers] = useState<UndeliveredTripBlocker[]>([]);

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

  // Download PDF (hosted Chrome-to-PDF API, lib/pdf.ts). Separate busy/error
  // state from the lifecycle-action `busy`/`actionError` above — downloading
  // is read-only and shouldn't disable the lifecycle buttons or vice versa.
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

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

    // Blockers only matter at Review (what gates Confirm) — mirrors the SQL
    // guard's exact predicate, see getUndeliveredTripsForInvoice() header.
    if (r.data.status === "review") {
      const b = await getUndeliveredTripsForInvoice(invoiceId);
      setBlockers(b.data ?? []);
    } else {
      setBlockers([]);
    }

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
        projectWaterType: r.data.projectWaterType,
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
        projectWaterType: r.data.projectWaterType,
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
    setChargeDate(todayKey());
    setChargeQty("1");
    setChargePrice("");
    setChargeImageFile(null);
    setChargeImageInputKey((k) => k + 1);
    setAddingCharge(false);
    setEditingPeriod(false);
    setPeriodError(null);
    setSavingPeriod(false);
    setBlockers([]);
    setEmailPickerOpen(false);
    setPdfError(null);
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

  async function handleDownloadPdf() {
    if (!invoiceId || downloadingPdf) return;
    setDownloadingPdf(true);
    setPdfError(null);
    const r = await getInvoicePdf(invoiceId);
    setDownloadingPdf(false);
    if (r.error || !r.data) {
      setPdfError(r.error ?? "Could not generate the PDF.");
      return;
    }
    // Server Actions can't stream a Blob directly — bytes arrive as base64;
    // decode to a Blob here and trigger a normal browser download via a
    // throwaway <a download> (no navigation, works across browsers).
    const bytes = Uint8Array.from(atob(r.data.base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = r.data.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

  // Two-step when an image is staged (create the charge, then upload against
  // its new id) but still ONE form submit / one busy state from the user's
  // point of view — "attach while adding" (Finance polish batch D). Falls
  // back to the plain single-step add when no file was chosen.
  async function onAddCharge(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(chargeQty);
    const price = Number(chargePrice);
    if (!invoiceId || !chargeLabel.trim() || qty <= 0 || price < 0) return;
    setAddingCharge(true);
    setActionError(null);
    const res = await addSpecialCharge(invoiceId, chargeLabel.trim(), chargeDate || null, qty, price);
    if (res.error || !res.data) {
      setAddingCharge(false);
      setActionError(res.error ?? "Could not add the charge.");
      return;
    }
    if (chargeImageFile) {
      const form = new FormData();
      form.set("imageFile", chargeImageFile);
      const imgRes = await uploadSpecialChargeImage(invoiceId, res.data.id, form);
      if (imgRes.error) {
        // Charge itself was added fine — surface the image failure but don't
        // discard the successful add; the row can still get an image later.
        setActionError(`Charge added, but the image failed to attach: ${imgRes.error}`);
      }
    }
    setAddingCharge(false);
    setChargeLabel("");
    setChargeDate(todayKey());
    setChargeQty("1");
    setChargePrice("");
    setChargeImageFile(null);
    setChargeImageInputKey((k) => k + 1);
    await refresh();
  }

  async function onUploadChargeImage(chargeId: string, file: File) {
    if (!invoiceId) return;
    const form = new FormData();
    form.set("imageFile", file);
    await runAction(() => uploadSpecialChargeImage(invoiceId, chargeId, form));
  }

  async function onViewChargeImage(chargeId: string) {
    const r = await getSpecialChargeImageSignedUrl(chargeId);
    if (r.error || !r.data) {
      setActionError(r.error ?? "Could not open the attached image.");
      return;
    }
    window.open(r.data.url, "_blank", "noopener,noreferrer");
  }

  async function onSavePeriod(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceId) return;
    if (periodStartInput > periodEndInput) {
      setPeriodError("Pick a valid period (start must be on or before end).");
      return;
    }
    setSavingPeriod(true);
    setPeriodError(null);
    const res = await updateDraftInvoicePeriod(invoiceId, periodStartInput, periodEndInput);
    setSavingPeriod(false);
    if (res.error) {
      setPeriodError(res.error);
      return;
    }
    setEditingPeriod(false);
    await refresh();
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

  // Special-charges-only subtotal (item 3) — computed for DISPLAY only, same
  // round-once methodology as calculateVat() (lib/vat.ts), applied to the
  // charges subset. Never fed back into the document-level totals, which
  // stay exactly as lib/invoice.ts computed them.
  const chargeLines = view?.unpaidLines.filter((l) => l.kind === "charge") ?? [];
  const chargesSubtotal = round2(chargeLines.reduce((s, l) => s + l.amount_sar, 0));
  const chargesVat = round2(chargeLines.reduce((s, l) => s + (l.vat_sar ?? 0), 0));
  const chargesTotal = round2(chargesSubtotal + chargesVat);
  const chargeAmountPreview = round2((Number(chargeQty) || 0) * (Number(chargePrice) || 0));

  // Unpaid table is now trip-only (special charges moved to their own
  // section below) — totals recomputed for the trip subset the same
  // round-once way as chargesSubtotal/Vat/Total above. view.amountDue stays
  // untouched (it's still the real, includes-charges document total used for
  // Amount Due / Grand Total further down).
  const unpaidTripLines = view?.unpaidLines.filter((l) => l.kind === "trip") ?? [];
  const unpaidTripSubtotal = round2(unpaidTripLines.reduce((s, l) => s + l.amount_sar, 0));
  const unpaidTripVat = round2(unpaidTripLines.reduce((s, l) => s + (l.vat_sar ?? 0), 0));
  const unpaidTripTotal = round2(unpaidTripSubtotal + unpaidTripVat);

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
            <span title={pdfError ?? undefined}>
              <Btn
                variant="outline"
                onClick={handleDownloadPdf}
                className={downloadingPdf ? "opacity-50 pointer-events-none" : ""}
              >
                <Download className="h-4 w-4" /> {downloadingPdf ? "Generating…" : "Download PDF"}
              </Btn>
            </span>
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
                {status === "draft" && editingPeriod ? (
                  <form onSubmit={onSavePeriod} className="no-print flex items-end gap-2 flex-wrap mt-1">
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="font-medium">Period start</span>
                      <input value={periodStartInput} onChange={(e) => setPeriodStartInput(e.target.value)} type="date" required className={INPUT} style={INPUT_STYLE} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="font-medium">Period end</span>
                      <input value={periodEndInput} onChange={(e) => setPeriodEndInput(e.target.value)} type="date" required className={INPUT} style={INPUT_STYLE} />
                    </label>
                    <Btn type="submit" variant="outline" className={savingPeriod ? "opacity-50 pointer-events-none" : ""}>
                      {savingPeriod ? "Saving…" : "Save"}
                    </Btn>
                    <Btn
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setEditingPeriod(false);
                        setPeriodError(null);
                      }}
                    >
                      Cancel
                    </Btn>
                    {periodError && <p className="w-full text-sm text-rose-600 dark:text-rose-400">{periodError}</p>}
                  </form>
                ) : status === "draft" ? (
                  <button
                    type="button"
                    className="text-sm muted mt-0.5 underline decoration-dotted underline-offset-2 hover:text-[rgb(var(--fg))]"
                    onClick={() => {
                      setPeriodStartInput(raw.period_start);
                      setPeriodEndInput(raw.period_end);
                      setPeriodError(null);
                      setEditingPeriod(true);
                    }}
                    title="Click to change this draft's period"
                  >
                    {raw.period_start} → {raw.period_end}
                  </button>
                ) : (
                  <p className="text-sm muted mt-0.5">
                    {raw.period_start} → {raw.period_end}
                  </p>
                )}
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
              <LineTable
                title="Covered (paid from prepaid balance)"
                lines={view.coveredLines}
                totals={view.covered}
                fallbackWaterType={view.projectWaterType}
              />
            )}

            {/* Unpaid / Amount Due table — trips only now (special charges
                have their own section below). Totals recomputed for the
                trip-only subset — view.amountDue (the real document total,
                includes charges) is still what feeds Amount Due/Grand Total
                further down, untouched. */}
            <LineTable
              title="Unpaid — Amount Due (trips)"
              lines={unpaidTripLines}
              totals={{ subtotal: unpaidTripSubtotal, vat: unpaidTripVat, total: unpaidTripTotal }}
              fallbackWaterType={view.projectWaterType}
            />

            {/* Special charges — own self-contained section (Finance polish
                batch D). Rows + subtotal + add-form (incl. image-attach-on-
                add) all live together in one bounded box, clearly separate
                from the trip tables above and Grand Total/Amount Due below. */}
            {(chargeLines.length > 0 || editable) && (
              <SpecialChargesSection
                chargeLines={chargeLines}
                subtotal={chargesSubtotal}
                vat={chargesVat}
                total={chargesTotal}
                editable={editable}
                onRemoveCharge={(id) => runAction(() => removeSpecialCharge(invoiceId, id))}
                onUploadChargeImage={onUploadChargeImage}
                onViewChargeImage={onViewChargeImage}
                onAddCharge={onAddCharge}
                addingCharge={addingCharge}
                chargeLabel={chargeLabel}
                setChargeLabel={setChargeLabel}
                chargeDate={chargeDate}
                setChargeDate={setChargeDate}
                chargeQty={chargeQty}
                setChargeQty={setChargeQty}
                chargePrice={chargePrice}
                setChargePrice={setChargePrice}
                chargeAmountPreview={chargeAmountPreview}
                chargeImageFile={chargeImageFile}
                setChargeImageFile={setChargeImageFile}
                chargeImageInputKey={chargeImageInputKey}
              />
            )}

            {/* Grand Total + Amount Due — both required, shown side by side,
                clearly separated (own grid, own spacing) from the special
                charges section above. */}
            <div className="grid grid-cols-2 gap-4 break-inside-avoid">
              <TotalCard label="Grand Total (full period value)" totals={view.grand} tone="info" />
              <TotalCard label="Amount Due (collectible)" totals={view.amountDue} tone={view.amountDue.total > 0 ? "bad" : "ok"} />
            </div>

            {/* Undelivered-trip blockers (item 2) — only at Review, mirrors
                confirm_invoice()'s SQL guard exactly (migration 0032).
                Highlight-on-click/clear-on-hover comes free from
                TripRefLink -> useIncomingTripHighlight (Batch A). */}
            {status === "review" && blockers.length > 0 && (
              <div className="no-print rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2 break-inside-avoid">
                <p className="text-sm text-amber-800 dark:text-amber-300 flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  {blockers.length} trip{blockers.length > 1 ? "s" : ""} in this invoice&apos;s period{" "}
                  {blockers.length > 1 ? "are" : "is"} not yet delivered — Confirm is blocked until every trip is
                  delivered.
                </p>
                <ul className="text-sm space-y-1 ps-6 list-disc">
                  {blockers.map((b) => (
                    <li key={b.id}>
                      {b.trip_date} — <TripRefLink tripId={b.id} label={b.ref ?? "View trip"} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

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
            {pdfError && <p className="text-sm text-rose-600 dark:text-rose-400 no-print">{pdfError}</p>}

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
                  <span
                    title={
                      blockers.length > 0
                        ? "Cannot confirm — undelivered trips in this invoice's period (see list above)."
                        : undefined
                    }
                  >
                    <Btn
                      variant="primary"
                      onClick={() => blockers.length === 0 && setConfirmingConfirm(true)}
                      className={blockers.length > 0 ? "opacity-50 pointer-events-none" : ""}
                    >
                      Confirm Invoice
                    </Btn>
                  </span>
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
  fallbackWaterType,
}: {
  title: string;
  lines: InvoiceLineSnapshot[];
  totals: Totals;
  // Display-only fallback (Finance polish batch C) — project's CURRENT
  // water_type, used when a line's own snapshot water_type is null (pre-
  // water_type-field invoice). Never mutates the frozen snapshot.
  fallbackWaterType?: WaterType | null;
}) {
  // Trip lines only (special charges get their own section — see
  // SpecialChargesSection below). Presentation-only: collapse per-trip lines
  // into grouped summary rows (one row per project rate — see
  // lib/invoiceDisplay.ts). VAT is NOT shown per row — it appears only in the
  // document-level totals passed in via `totals` (untouched money logic).
  const rows = groupInvoiceLines(lines, fallbackWaterType);

  return (
    <section className="space-y-2 break-inside-avoid">
      <h3 className="text-xs font-semibold uppercase tracking-wide muted">{title}</h3>
      <div className="card p-0 overflow-hidden">
        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH>Date</TH>
              <TH>Description</TH>
              <TH>Type</TH>
              <TH>Quantity</TH>
              <TH>Price</TH>
              <TH>Amount</TH>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <TD className="muted">Nothing here.</TD>
                <TD>{""}</TD>
                <TD>{""}</TD>
                <TD>{""}</TD>
                <TD>{""}</TD>
                <TD>{""}</TD>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.key}>
                  <TD>{r.periodLabel}</TD>
                  <TD>
                    {r.firstTripId ? (
                      <TripRefLink tripId={r.firstTripId} label={r.refRangeLabel} />
                    ) : (
                      <span className="muted">{r.refRangeLabel}</span>
                    )}
                  </TD>
                  <TD>{r.typeLabel}</TD>
                  <TD className="tabular-nums">{r.quantity}</TD>
                  <TD className="tabular-nums">{formatSar(r.price)}</TD>
                  <TD className="tabular-nums">{formatSar(r.amount)}</TD>
                </tr>
              ))
            )}
            <tr>
              <TD className="font-medium">{""}</TD>
              <TD className="font-medium">Subtotal / VAT / Total</TD>
              <TD className="muted">{""}</TD>
              <TD className="muted">{""}</TD>
              <TD className="tabular-nums font-medium">{formatSar(totals.subtotal)}</TD>
              <TD className="tabular-nums font-medium">
                {formatSar(totals.total)} <span className="muted font-normal">(VAT {formatSar(totals.vat)})</span>
              </TD>
            </tr>
          </tbody>
        </Table>
      </div>
    </section>
  );
}

// Special charges — own self-contained section (Finance polish batch D).
// Everything lives together in ONE bounded box: existing charge rows, the
// subtotal/VAT/total strip, and the add-charge form (now including the
// image-attach control, staged and uploaded right after the row is created).
// Deliberately roomier than the trip tables above (p-6, generous field gaps)
// per the "too condensed" complaint — this is a distinct, secondary
// bookkeeping surface, not a dense ledger.
function SpecialChargesSection({
  chargeLines,
  subtotal,
  vat,
  total,
  editable,
  onRemoveCharge,
  onUploadChargeImage,
  onViewChargeImage,
  onAddCharge,
  addingCharge,
  chargeLabel,
  setChargeLabel,
  chargeDate,
  setChargeDate,
  chargeQty,
  setChargeQty,
  chargePrice,
  setChargePrice,
  chargeAmountPreview,
  chargeImageFile,
  setChargeImageFile,
  chargeImageInputKey,
}: {
  chargeLines: InvoiceLineSnapshot[];
  subtotal: number;
  vat: number;
  total: number;
  editable: boolean;
  onRemoveCharge: (id: string) => void;
  onUploadChargeImage: (id: string, file: File) => void;
  onViewChargeImage: (id: string) => void;
  onAddCharge: (e: React.FormEvent) => void;
  addingCharge: boolean;
  chargeLabel: string;
  setChargeLabel: (v: string) => void;
  chargeDate: string;
  setChargeDate: (v: string) => void;
  chargeQty: string;
  setChargeQty: (v: string) => void;
  chargePrice: string;
  setChargePrice: (v: string) => void;
  chargeAmountPreview: number;
  chargeImageFile: File | null;
  setChargeImageFile: (f: File | null) => void;
  chargeImageInputKey: number;
}) {
  const canSubmit = !!chargeLabel.trim() && Number(chargeQty) > 0 && Number(chargePrice) >= 0;

  return (
    <section className="space-y-2 break-inside-avoid">
      <h3 className="text-xs font-semibold uppercase tracking-wide muted">Special charges</h3>
      {/* Borderless tinted panel (Turki: "remove the border, refit the table
          and box") — the section reads as its own bounded surface via the
          background tint + generous radius/padding rather than a hard edge.
          The rows-table and add-form sit inside as their own raised (card-
          background + shadow, still no border) surfaces, so the grouping is
          legible without ever stacking borders. */}
      <div className="rounded-2xl bg-black/[0.025] dark:bg-white/[0.035] p-6 space-y-5">
        {chargeLines.length > 0 ? (
          <div className="rounded-xl bg-[rgb(var(--card))] shadow-sm overflow-hidden">
            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>Date</TH>
                  <TH>Description</TH>
                  <TH>Quantity</TH>
                  <TH>Price</TH>
                  <TH>Amount</TH>
                  <TH></TH>
                </tr>
              </thead>
              <tbody>
                {chargeLines.map((l) => (
                  <tr key={l.id}>
                    <TD>{l.trip_date ?? <span className="muted">—</span>}</TD>
                    <TD>{l.description}</TD>
                    <TD className="tabular-nums">{l.quantity ?? 1}</TD>
                    <TD className="tabular-nums">{formatSar(l.price_sar ?? l.amount_sar)}</TD>
                    <TD className="tabular-nums">{formatSar(l.amount_sar)}</TD>
                    <TD>
                      <div className="flex items-center gap-2.5 no-print">
                        {l.image_path ? (
                          <button
                            type="button"
                            onClick={() => onViewChargeImage(l.id)}
                            className="muted hover:text-[rgb(var(--fg))]"
                            title="View attached image (internal only)"
                          >
                            <ImageIcon className="h-4 w-4" />
                          </button>
                        ) : (
                          editable && (
                            <label className="muted hover:text-[rgb(var(--fg))] cursor-pointer" title="Attach an image (internal only)">
                              <Paperclip className="h-4 w-4" />
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) onUploadChargeImage(l.id, f);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                          )
                        )}
                        {editable && (
                          <button type="button" onClick={() => onRemoveCharge(l.id)} className="muted hover:text-rose-600 dark:hover:text-rose-400">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="flex items-center justify-end gap-2 border-t border-app px-4 py-3 text-sm">
              <span className="muted">Subtotal {formatSar(subtotal)} + VAT {formatSar(vat)} =</span>
              <span className="font-semibold tabular-nums">{formatSar(total)}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm muted">No special charges on this invoice yet.</p>
        )}

        {editable && (
          <form onSubmit={onAddCharge} className="no-print space-y-4 rounded-xl bg-[rgb(var(--card))] shadow-sm p-5">
            <p className="text-xs font-semibold uppercase tracking-wide muted">Add a charge</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <label className="flex flex-col gap-1.5 text-sm col-span-2">
                <span className="font-medium">Description</span>
                <input value={chargeLabel} onChange={(e) => setChargeLabel(e.target.value)} className={INPUT} style={INPUT_STYLE} placeholder="e.g. Callout fee" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Date</span>
                <input value={chargeDate} onChange={(e) => setChargeDate(e.target.value)} type="date" className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Quantity</span>
                <input value={chargeQty} onChange={(e) => setChargeQty(e.target.value)} type="number" min="0" step="any" className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Price (pre-VAT)</span>
                <input value={chargePrice} onChange={(e) => setChargePrice(e.target.value)} type="number" min="0" step="any" className={INPUT} style={INPUT_STYLE} placeholder="0" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Amount</span>
                <div className={INPUT + " muted tabular-nums"} style={INPUT_STYLE}>
                  {formatSar(chargeAmountPreview)}
                </div>
              </label>
              <label className="flex flex-col gap-1.5 text-sm col-span-2">
                <span className="font-medium">Attach image (optional, internal only)</span>
                <input
                  key={chargeImageInputKey}
                  type="file"
                  accept="image/*"
                  onChange={(e) => setChargeImageFile(e.target.files?.[0] ?? null)}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>
            </div>
            <div className="flex items-center justify-end">
              <Btn type="submit" variant="outline" className={!canSubmit || addingCharge ? "opacity-50 pointer-events-none" : ""}>
                <Plus className="h-4 w-4" /> {addingCharge ? "Adding…" : "Add charge"}
              </Btn>
            </div>
          </form>
        )}
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
