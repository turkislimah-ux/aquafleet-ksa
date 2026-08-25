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
import { formatDate, formatNum, formatSar, todayKey } from "@/lib/utils";
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
  type PaymentMode,
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
  setHideAmountDue,
  type UndeliveredTripBlocker,
} from "./invoiceActions";
import ScrollLock from "@/components/ScrollLock";

// Fallback company email — used in template bodies/signatures whenever
// company_settings.email is unset. mailto cannot set the actual From
// address (opens in the user's own mail client) — this is reference text
// only, never the "to" or a forced sender.
const FALLBACK_COMPANY_EMAIL = "info@binslimah.com";

// Purpose-specific mailto templates (Finance email templates, 0028/0029).
// Each maps to a distinct tone/purpose picked by the user before mailto opens.
// Batch C adds "sales_return" — a Sales Return (cancellation) notice, only
// meaningful once the invoice has actually been returned/voided.
type EmailType = "statement" | "payment_due" | "reminder" | "generic" | "sales_return";
const EMAIL_TYPE_META: Record<EmailType, { label: string; hint: string }> = {
  statement: { label: "Monthly report / statement", hint: "Activity summary for the period." },
  payment_due: { label: "Payment due", hint: "This invoice is now due — request payment." },
  reminder: { label: "Payment reminder", hint: "Follow-up nudge for an outstanding balance." },
  generic: { label: "Plain / generic", hint: "Minimal — just the invoice reference." },
  sales_return: { label: "Sales Return notice", hint: "Explains this invoice was cancelled." },
};

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

type Totals = { subtotal: number; vat: number; total: number };
// Display-layer ledger shape (money-bug fix, v3.1) — widens InvoiceLedgerTotals'
// balance/remaining to `| null` for the ONE case the pure engine never has to
// handle: a CONFIRMED invoice frozen before migration 0036 added the ledger
// snapshot columns (covered_ledger_subtotal_sar etc, all null on that row
// forever — frozen columns are never backfilled, see lib/db-types.ts). For
// those legacy rows, `subtotal` is still derivable (view.covered.total /
// view.amountDue.total already exist as real VAT-inclusive frozen figures —
// on a pre-0036 row amountDue.total IS ledger.unpaid.subtotal, because Amount
// Due was trips-only for the whole of that era; the stranded-charge fix later
// widened Amount Due to include uncovered special charges, so the two figures
// are NOT equal on invoices confirmed after it, and this fallback is not a
// general identity — it holds only for the frozen legacy rows it fires on. See
// lib/invoice.ts's AMOUNT DUE header note. covered.total is its own
// calculateVat() pass that reconciles to within a halala), but
// `balance`/`remaining` genuinely no
// longer exist on disk — showing them as "0" is what caused the original
// bug (a fabricated "-2,940 VAT" and a false "Running Balance: 0" next to 7
// real covered trips). Rendered as "—" instead of a fabricated number.
type DisplayLedgerTotals = { subtotal: number; balance: number | null; remaining: number | null };
type View = {
  paymentMode: PaymentMode;
  coveredLines: InvoiceLineSnapshot[]; // trips only. Always [] for postpaid.
  // prepaid: trips only. postpaid: trips + charges (unchanged v2 shape).
  unpaidLines: InvoiceLineSnapshot[];
  // v3, prepaid only — ALL of this invoice's special charges (covered +
  // uncovered), each tagged `covered`. Always [] for postpaid (postpaid's
  // charges stay merged into unpaidLines, read out separately below).
  chargeLines: InvoiceLineSnapshot[];
  covered: Totals;
  amountDue: Totals;
  grand: Totals;
  // v3, prepaid only — the Covered/Unpaid trips tables' stacked
  // Subtotal/Balance/Remaining figures. undefined for postpaid. Always
  // populated for prepaid (draft/review from the live engine, confirmed/paid
  // either from the frozen snapshot columns or, for pre-0036 legacy rows,
  // the derived DisplayLedgerTotals fallback built in refresh() below).
  ledger?: { covered: DisplayLedgerTotals; unpaid: DisplayLedgerTotals };
  // description/telephone/phone added Batch D (invoice header restructure),
  // legal_name_ar added Batch D follow-up #1 — all captured automatically via
  // company_settings' `select("*")` (see invoiceActions.ts's
  // assembleForCustomerPeriod), no assembly code change.
  sellerSnapshot: {
    legal_name: string;
    legal_name_ar: string | null;
    vat_number: string | null;
    cr_number: string | null;
    address: string | null;
    description: string | null;
    telephone: string | null;
    phone: string | null;
  } | null;
  // name_ar added Batch D — hand-built buyer snapshot, see invoiceActions.ts.
  buyerSnapshot: {
    name: string;
    name_ar: string | null;
    vat_number: string | null;
    cr_number: string | null;
    billing_address: string | null;
  } | null;
  // Display-only fallback (Finance polish batch C) — the project's CURRENT
  // water_type, used when a frozen/old line's own water_type is null. Never
  // written back to a stored snapshot.
  projectWaterType: WaterType | null;
};

export default function InvoiceDetailModal({
  open,
  invoiceId,
  customerEmail,
  settledBalance,
  onClose,
  onBack,
  onMutated,
  readOnly = false,
}: {
  open: boolean;
  invoiceId: string | null;
  customerEmail: string | null;
  // Prepaid customers only (Finance tab's per-row figure, §Batch-1 "Pay with
  // Balance" confirmation) — display-only, never recomputed here. null for
  // postpaid / not-yet-loaded.
  settledBalance?: number | null;
  onClose: () => void;
  onBack: () => void;
  onMutated: () => void;
  // VIEW-ONLY mount (the Archive's Customer tab). The archive records what
  // already exists; it is not a second place to move an invoice through its
  // lifecycle. Everything that READS stays identical — the whole point of
  // reusing this component rather than rebuilding a lookalike is that the
  // archive shows the same invoice, laid out the same way, including print
  // and PDF. Only the WRITE affordances are withheld.
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [raw, setRaw] = useState<(Invoice & { projectWaterType: WaterType | null; projectPaymentMode: PaymentMode }) | null>(null);
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
        paymentMode: p.data.paymentMode,
        coveredLines: p.data.coveredLines,
        unpaidLines: p.data.unpaidLines,
        chargeLines: p.data.chargeLines,
        covered: p.data.covered,
        amountDue: p.data.amountDue,
        grand: p.data.grand,
        ledger: p.data.ledger,
        sellerSnapshot: (p.data.sellerSnapshot as View["sellerSnapshot"]) ?? null,
        buyerSnapshot: (p.data.buyerSnapshot as View["buyerSnapshot"]) ?? null,
        projectWaterType: r.data.projectWaterType,
      });
    } else {
      // Frozen invoices predating migration 0037 have no `payment_mode`
      // snapshot — fall back to the customer's CURRENT project.payment_mode
      // (correct for every invoice confirmed before any mode switch; see
      // migration 0037's header and getInvoicePdf()'s identical fallback).
      const paymentMode = r.data.payment_mode ?? r.data.projectPaymentMode;
      const hasLedgerSnapshot =
        r.data.covered_ledger_subtotal_sar != null && r.data.unpaid_ledger_subtotal_sar != null;
      setView({
        paymentMode,
        coveredLines: r.data.covered_lines ?? [],
        unpaidLines: r.data.unpaid_lines ?? [],
        chargeLines: paymentMode === "prepaid" ? (r.data.special_charges_snapshot ?? []) : [],
        covered: { subtotal: r.data.covered_subtotal_sar, vat: r.data.covered_vat_sar, total: r.data.covered_total_sar },
        amountDue: { subtotal: r.data.amount_due_subtotal_sar, vat: r.data.amount_due_vat_sar, total: r.data.amount_due_sar },
        grand: { subtotal: r.data.grand_subtotal_sar, vat: r.data.grand_vat_sar, total: r.data.grand_total_sar },
        ledger:
          paymentMode === "prepaid"
            ? hasLedgerSnapshot
              ? {
                  covered: {
                    subtotal: r.data.covered_ledger_subtotal_sar!,
                    balance: r.data.covered_ledger_balance_sar ?? 0,
                    remaining: r.data.covered_ledger_remaining_sar ?? 0,
                  },
                  unpaid: {
                    subtotal: r.data.unpaid_ledger_subtotal_sar!,
                    balance: r.data.unpaid_ledger_balance_sar ?? 0,
                    remaining: r.data.unpaid_ledger_remaining_sar ?? 0,
                  },
                }
              : // Pre-migration-0036 legacy invoice — no ledger snapshot was
                // ever written. Subtotal is still real (derived from the
                // frozen document totals that DO exist — see DisplayLedgerTotals
                // comment above); balance/remaining genuinely don't exist for
                // this row, so "—" instead of a fabricated 0.
                {
                  covered: { subtotal: r.data.covered_total_sar, balance: null, remaining: null },
                  unpaid: { subtotal: r.data.amount_due_sar, balance: null, remaining: null },
                }
            : undefined,
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

  // Prepaid "Pay with Balance" (Batch 1) — no cash/bank choice (prepaid never
  // pays that way, spec v3 §7): the engine already deducted the balance at
  // delivery (trips) / add-to-draft (charges), so this step only RECORDS
  // settlement and LOCKS the covered items — same pay_invoice() RPC the
  // postpaid cash/bank form calls, just with no user-facing method choice.
  //
  // IT NOW RECORDS 'balance', WHICH IS WHAT MIGRATION 0134 EXISTS FOR.
  // This used to send 'cash' — a deliberate mislabel, because 0025's CHECK
  // constraint permitted only 'cash'/'bank_transfer' and no 'balance' value
  // existed to write. 0134 widened that constraint AND added a guard inside
  // pay_invoice() that refuses 'balance' unless the invoice resolves to prepaid
  // mode (snapshot first, else the customer's project mode), so the honest value
  // is now both storable and enforced. THIS IS THE ONLY CALLER THAT SENDS
  // 'balance' — the postpaid form still sends the user's cash/bank_transfer
  // choice, and neither path ever rewrites an already-settled record.
  //
  // No proof file, reference or date are sent, and that is not an omission:
  // there is no bank transaction to point at. The money left the balance when
  // the work was delivered, not now.
  //
  // HISTORICAL ROWS ARE NOT BACKFILLED. Prepaid invoices settled before 0134
  // still read 'cash'. A settled document records what was written at the time,
  // and no figure anywhere derives from this column — the prepaid engine walks
  // its own FIFO queue, never payment_method — so a rewrite would buy nothing
  // and would make history claim a value that did not exist when it was issued.
  async function onMarkPaidBalance() {
    if (!invoiceId) return;
    const form = new FormData();
    form.set("invoiceId", invoiceId);
    form.set("paymentMethod", "balance");
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
  // readOnly folds in here rather than at each call site: `editable` already
  // governs every special-charge mutation, so one AND covers the add form,
  // the remove buttons and the image upload together, with no chance of a
  // fourth write path being added later and missing the gate.
  const editable = raw && !readOnly ? canEditSpecialCharges(raw.status) : false;
  const canEmail = !!(raw && view && customerEmail);

  const isPrepaid = view?.paymentMode === "prepaid";

  // --- POSTPAID (unchanged v2 shape — do not touch) ------------------------
  // Special-charges-only subtotal (item 3) — computed for DISPLAY only, same
  // round-once methodology as calculateVat() (lib/vat.ts), applied to the
  // charges subset. Never fed back into the document-level totals, which
  // stay exactly as lib/invoice.ts computed them.
  const postpaidChargeLines = view?.unpaidLines.filter((l) => l.kind === "charge") ?? [];
  const postpaidChargesSubtotal = round2(postpaidChargeLines.reduce((s, l) => s + l.amount_sar, 0));
  const postpaidChargesVat = round2(postpaidChargeLines.reduce((s, l) => s + (l.vat_sar ?? 0), 0));
  const postpaidChargesTotal = round2(postpaidChargesSubtotal + postpaidChargesVat);
  const chargeAmountPreview = round2((Number(chargeQty) || 0) * (Number(chargePrice) || 0));

  // Unpaid table is trip-only (special charges have their own section below)
  // — totals recomputed for the trip subset the same round-once way as
  // postpaidCharges*/Vat/Total above. view.amountDue stays untouched (it's
  // still the real, includes-charges document total used for Amount Due /
  // Grand Total further down).
  const postpaidUnpaidTripLines = view?.unpaidLines.filter((l) => l.kind === "trip") ?? [];
  const postpaidUnpaidTripSubtotal = round2(postpaidUnpaidTripLines.reduce((s, l) => s + l.amount_sar, 0));
  const postpaidUnpaidTripVat = round2(postpaidUnpaidTripLines.reduce((s, l) => s + (l.vat_sar ?? 0), 0));
  const postpaidUnpaidTripTotal = round2(postpaidUnpaidTripSubtotal + postpaidUnpaidTripVat);

  // --- PREPAID (v3 §9) ------------------------------------------------------
  // Special Charges table source: view.chargeLines already carries ALL of
  // this invoice's own charges (covered + uncovered), each tagged — not a
  // filter over unpaidLines (prepaid's unpaidLines is trips-only, see
  // lib/invoice.ts's POSTPAID note). Grand Total's "Special Charges (covered)"
  // row sums only the covered subset — same round-once convention as above.
  const prepaidChargeLines = view?.chargeLines ?? [];
  // l.covered undefined = a pre-migration-0036 legacy charge snapshot (no
  // per-charge coverage concept existed before v3 — every special charge was
  // simply billed unconditionally on whatever invoice it was added to, see
  // finance-invoice-spec.md §4/§7's "rolls forward... (v3)" framing). Treat
  // undefined as covered (`!== false`), not as excluded — excluding it here
  // while the frozen grand_total_sar/grand_vat_sar snapshot already counted
  // it (computed by the old engine, at confirm time) is what produced the
  // "Special Charges (covered) = 0 SAR but Total VAT/TOTAL include it anyway"
  // inconsistency.
  const prepaidCoveredChargesSubtotal = round2(
    prepaidChargeLines.filter((l) => l.covered !== false).reduce((s, l) => s + l.amount_sar, 0),
  );

  function sendTemplate(type: EmailType) {
    if (!raw || !view || !customerEmail) return;
    const href = buildMailtoFor(type, raw, view, customerEmail, companyEmail);
    setEmailPickerOpen(false);
    window.location.href = href;
  }

  return createPortal(
    <>
    <div className="invoice-print-portal fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <ScrollLock />
      <div
        // 1080px = this app's size:lg popup width (InventoryClient.tsx:130).
        // Widened from max-w-4xl: the trip tables are six columns and each row
        // carries a stacked pre-VAT+VAT figure, so the money column needs room
        // that Date/Ref/Truck/Capacity/Type were taking. The PRINT sheet is
        // unaffected — globals.css flattens this portal and sizes to the page.
        className="card p-0 w-full max-w-[1080px] max-h-[90vh] overflow-y-auto scrollbar-thin"
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
                {status === "draft" && !readOnly && editingPeriod ? (
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
              </div>
            </div>

            {/* Batch D — three-section header (Buyer / Seller / Invoice info),
                mirrors the PDF's identityBlock()/invoiceInfoBlock() layout so
                on-screen, print, and PDF all agree. Buyer/Seller pull from the
                frozen (or live-preview) snapshots; Invoice info is derived
                straight off `raw` — never itself snapshotted. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm break-inside-avoid">
              <IdentityBlock
                title="Buyer"
                name={view.buyerSnapshot?.name ?? null}
                nameAr={view.buyerSnapshot?.name_ar ?? null}
                lines={[
                  { label: "", value: view.buyerSnapshot?.billing_address ?? null },
                  { label: "VAT Registration No.", value: view.buyerSnapshot?.vat_number ?? null },
                  { label: "CR No.", value: view.buyerSnapshot?.cr_number ?? null },
                  { label: "", value: customerEmail },
                ]}
              />
              <IdentityBlock
                title="Seller"
                name={view.sellerSnapshot?.legal_name ?? null}
                nameAr={view.sellerSnapshot?.legal_name_ar ?? null}
                lines={[
                  { label: "", value: view.sellerSnapshot?.description ?? null },
                  { label: "CR No.", value: view.sellerSnapshot?.cr_number ?? null },
                  { label: "", value: view.sellerSnapshot?.address ?? null },
                  { label: "Tel", value: view.sellerSnapshot?.telephone ?? null },
                  { label: "Mobile", value: view.sellerSnapshot?.phone ?? null },
                  { label: "VAT Registration No.", value: view.sellerSnapshot?.vat_number ?? null },
                ]}
              />
              <IdentityBlock
                title="Invoice info"
                lines={[
                  { label: "Invoice No.", value: raw.invoice_number ?? "Draft — not yet numbered" },
                  { label: "Issue date", value: raw.confirmed_at ? raw.confirmed_at.slice(0, 10) : "—" },
                  { label: "Period", value: `${raw.period_start} → ${raw.period_end}` },
                  { label: "Status", value: status ? INVOICE_STATUS_LABELS[status] : null },
                ]}
              />
            </div>

            {/* Batch C — "Void" relabeled "Sales Return" in the UI; stored
                status/columns stay 'void'/void_reason/voided_at (no data
                migration). Second line is the new unpaid note the spec
                asks for, always shown once returned (not gated on
                void_reason — legacy rows may predate the required-reason
                rule but are still unpaid). */}
            {raw.status === "void" && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-700 dark:text-rose-300 break-inside-avoid space-y-1">
                <div>
                  <span className="font-medium">Sales Return</span>
                  {raw.voided_at ? ` on ${raw.voided_at.slice(0, 10)}` : ""}
                  {raw.void_reason ? ` — ${raw.void_reason}` : ""}
                </div>
                <div className="text-xs">
                  This invoice{raw.invoice_number ? ` (${raw.invoice_number})` : ""} is unpaid — marked Sales Return.
                </div>
              </div>
            )}

            {isPrepaid ? (
              <>
                {/* v3 §9 — Covered/Unpaid TRIPS tables, ALWAYS shown (even at
                    zero rows), each with its own stacked
                    Subtotal/Balance/Remaining ledger footer. Pre-VAT rows —
                    no per-row VAT column (VAT only ever appears in the
                    Grand Total stack below). */}
                <PrepaidTripTable
                  title="Covered Trips"
                  lines={view.coveredLines}
                  ledger={view.ledger?.covered ?? { subtotal: view.covered.total, balance: null, remaining: null }}
                  fallbackWaterType={view.projectWaterType}
                />
                <PrepaidTripTable
                  title="Unpaid Trips"
                  lines={view.unpaidLines}
                  ledger={view.ledger?.unpaid ?? { subtotal: view.amountDue.total, balance: null, remaining: null }}
                  fallbackWaterType={view.projectWaterType}
                  // PRINT ONLY — the section stays on screen either way (§7:
                  // this toggle "governs print/PDF/email only, always visible
                  // on-screen"). Pairs with the PDF's own guard in
                  // lib/invoicePdfTemplate.ts so the printed sheet and the
                  // downloaded PDF suppress the same thing, and with the
                  // Amount Due card below — the table and the figure it feeds
                  // travel together or the customer gets a due total with no
                  // rows behind it.
                  hiddenFromPrint={raw.hide_amount_due}
                  headerRight={
                    <HideAmountDueToggle
                      hidden={raw.hide_amount_due}
                      busy={busy}
                      onToggle={() => runAction(() => setHideAmountDue(invoiceId, !raw.hide_amount_due))}
                    />
                  }
                />

                {/* Special charges — ALL of this invoice's charges (covered +
                    uncovered), each tagged, positioned below the Unpaid
                    trips table per §9. Same editable add/remove/attach
                    surface as before. */}
                {(prepaidChargeLines.length > 0 || editable) && (
                  <SpecialChargesSection
                    chargeLines={prepaidChargeLines}
                    subtotal={round2(prepaidChargeLines.reduce((s, l) => s + l.amount_sar, 0))}
                    vat={round2(prepaidChargeLines.reduce((s, l) => s + (l.vat_sar ?? 0), 0))}
                    total={round2(
                      prepaidChargeLines.reduce((s, l) => s + l.amount_sar, 0) +
                        prepaidChargeLines.reduce((s, l) => s + (l.vat_sar ?? 0), 0),
                    )}
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
                    setChargeImageFile={setChargeImageFile}
                    chargeImageInputKey={chargeImageInputKey}
                  />
                )}

                {/* Amount Due + Grand Total — side by side (layout fix), not
                    stacked. Amount Due (item 5) is the smaller, single-figure
                    card; Grand Total is the wider stacked block — both
                    right-aligned as one visual pair. Hide toggle lives on the
                    Unpaid Trips table above (item 6) — the Amount Due card
                    itself is just the figure, no sentence, no toggle. */}
                <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:justify-end break-inside-avoid">
                  {/* Same print-only suppression as the Unpaid Trips table
                      above, for the same reason: Amount Due IS the unpaid
                      table's total, so hiding one and printing the other
                      leaves the customer a figure with nothing behind it.
                      Screen keeps both — the person choosing what the
                      customer sees has to keep seeing it themselves. */}
                  <div
                    className={"sm:w-64 sm:flex-shrink-0" + (raw.hide_amount_due ? " no-print" : "")}
                  >
                    <TotalCard label="Amount Due" totals={view.amountDue} tone={view.amountDue.total > 0 ? "bad" : "ok"} />
                  </div>
                  {/* Grand Total — v3 §9, one stacked block: covered trips +
                      covered charges only (unpaid trips excluded). No title
                      (item 4). */}
                  <GrandTotalStack
                    subtotalLabel="Subtotal (Covered trips)"
                    subtotal={view.covered.subtotal}
                    chargesLabel="Special Charges (covered)"
                    chargesSubtotal={prepaidCoveredChargesSubtotal}
                    vat={view.grand.vat}
                    total={view.grand.total}
                  />
                </div>
              </>
            ) : (
              <>
                {/* Covered table — omitted entirely when empty (postpaid
                    customer with nothing yet covered this period). */}
                {view.coveredLines.length > 0 && (
                  <LineTable
                    title="Covered (paid from prepaid balance)"
                    lines={view.coveredLines}
                    totals={view.covered}
                    fallbackWaterType={view.projectWaterType}
                  />
                )}

                {/* Unpaid / Amount Due table — trips only (special charges
                    have their own section below). Totals recomputed for the
                    trip-only subset — view.amountDue (the real document
                    total, includes charges) is still what feeds Amount
                    Due/Grand Total further down, untouched. */}
                <LineTable
                  title="Unpaid — Amount Due (trips)"
                  lines={postpaidUnpaidTripLines}
                  totals={{ subtotal: postpaidUnpaidTripSubtotal, vat: postpaidUnpaidTripVat, total: postpaidUnpaidTripTotal }}
                  fallbackWaterType={view.projectWaterType}
                  headerRight={
                    <HideAmountDueToggle
                      hidden={raw.hide_amount_due}
                      busy={busy}
                      onToggle={() => runAction(() => setHideAmountDue(invoiceId, !raw.hide_amount_due))}
                    />
                  }
                />

                {/* Special charges — own self-contained section (Finance
                    polish batch D). Rows + subtotal + add-form (incl.
                    image-attach-on-add) all live together in one bounded
                    box, clearly separate from the trip tables above and
                    Grand Total/Amount Due below. */}
                {(postpaidChargeLines.length > 0 || editable) && (
                  <SpecialChargesSection
                    chargeLines={postpaidChargeLines}
                    subtotal={postpaidChargesSubtotal}
                    vat={postpaidChargesVat}
                    total={postpaidChargesTotal}
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
                    setChargeImageFile={setChargeImageFile}
                    chargeImageInputKey={chargeImageInputKey}
                  />
                )}

                {/* No Amount Due box for postpaid (layout fix) — postpaid has
                    no prepaid balance, so Amount Due is always numerically
                    identical to Grand Total below it (same figure twice,
                    meaningless second card). The hide-amount-due toggle stays
                    on the Unpaid trips table above (item 6) — it still
                    governs whether the figure appears in print/PDF/email,
                    independent of this on-screen removal. */}

                {/* Grand Total (item 2) — same stacked structure as prepaid:
                    Subtotal → Special Charges → VAT → Total, no Balance/
                    Remaining (postpaid has no balance). No title (item 4). */}
                <GrandTotalStack
                  subtotalLabel="Subtotal (Unpaid trips)"
                  subtotal={postpaidUnpaidTripSubtotal}
                  chargesLabel="Special Charges"
                  chargesSubtotal={postpaidChargesSubtotal}
                  vat={view.grand.vat}
                  total={view.grand.total}
                />
              </>
            )}

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

            {/* Actions — status-dependent, not printed, and absent entirely
                on a read-only mount. */}
            {!readOnly && (
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
                    {isPrepaid ? "Pay with Balance" : "Mark Paid"}
                  </Btn>
                  <Btn variant="outline" onClick={() => setVoiding(true)}>
                    Sales Return
                  </Btn>
                </div>
              )}
              {/* Prepaid — Batch 1: no cash/bank choice, just a confirmation
                  showing settled balance draw-down. Numbers are display-only
                  (settledBalance from the Finance tab row, view.grand.total
                  already computed) — nothing recomputed here. */}
              {status === "confirmed" && payingOpen && isPrepaid && (
                <div className="space-y-3 max-w-sm">
                  <div className="card p-3 text-sm space-y-1.5" style={{ borderColor: "rgb(var(--border))" }}>
                    <div className="flex justify-between">
                      <span className="muted">Settled balance</span>
                      <span className="tabular-nums">{formatSar(settledBalance ?? 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="muted">This invoice (Grand Total)</span>
                      <span className="tabular-nums">− {formatSar(view.grand.total)}</span>
                    </div>
                    <div className="flex justify-between font-semibold pt-1.5 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                      <span>Remaining settled balance</span>
                      <span className={"tabular-nums " + (((settledBalance ?? 0) - view.grand.total) < 0 ? "text-rose-600 dark:text-rose-400" : "")}>
                        {formatSar((settledBalance ?? 0) - view.grand.total)}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs muted">
                    The balance already covered these trips/charges at delivery — this just records the settlement and locks them. No new money changes hands.
                  </p>
                  <div className="flex items-center gap-2">
                    <Btn type="button" variant="ghost" onClick={() => setPayingOpen(false)}>
                      Cancel
                    </Btn>
                    <Btn type="button" variant="primary" onClick={onMarkPaidBalance} className={busy ? "opacity-50 pointer-events-none" : ""}>
                      {busy ? "Recording…" : "Confirm payment"}
                    </Btn>
                  </div>
                </div>
              )}
              {/* Postpaid — unchanged (v2 shape). */}
              {status === "confirmed" && payingOpen && !isPrepaid && (
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
                  {/* Batch 2 (migration 0039) — reference + date required for
                      bank_transfer (a real bank transaction to point to,
                      same reasoning as the proof file below); optional for
                      cash. Note always optional. Uncontrolled — read via
                      FormData in onMarkPaid, same as proofFile. */}
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">
                      Payment reference{payMethod === "bank_transfer" ? " (required) *" : " (optional)"}
                    </span>
                    <input
                      type="text"
                      name="paymentReference"
                      required={payMethod === "bank_transfer"}
                      className={INPUT}
                      style={INPUT_STYLE}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">
                      Payment date{payMethod === "bank_transfer" ? " (required) *" : " (optional)"}
                    </span>
                    <input
                      type="date"
                      name="paymentDate"
                      required={payMethod === "bank_transfer"}
                      className={INPUT}
                      style={INPUT_STYLE}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">Note (optional)</span>
                    <textarea name="paymentNote" rows={2} className={INPUT} style={INPUT_STYLE} />
                  </label>
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
                    <span className="font-medium">Sales Return reason *</span>
                    <textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} rows={2} className={INPUT} style={INPUT_STYLE} />
                  </label>
                  <GuardBox
                    warning="Marking this a Sales Return is the only undo for a confirmed invoice, and it's terminal — there is no path back to Confirmed/Paid. The invoice number and VAT ref are retained forever, but this invoice will no longer be collectible."
                    busy={busy}
                    confirmLabel="Yes, mark as Sales Return"
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
            )}

            <div className="border-t border-app pt-3 text-[11px] muted flex items-center justify-between">
              <span>Generated {formatDate(new Date(), { year: "numeric", month: "short", day: "numeric" })}</span>
              {/* translate="no" on the SPAN, not the row — "Generated <date>"
                  is ordinary prose that SHOULD translate. Only the company's
                  own name is fenced off. This footer prints onto an invoice
                  that leaves the building, so a translated company name here
                  reaches a customer. */}
              <span translate="no">Bin Slimah Group · Bousla</span>
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
        <ScrollLock />
        <div className="card p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Email invoice — choose type</h3>
            <button type="button" onClick={() => setEmailPickerOpen(false)} className="muted hover:text-[rgb(var(--fg))]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2">
            {/* Sales Return notice only offered once actually returned;
                the other four don't make sense to send on a cancelled
                invoice (payment due/reminder chase money that's no longer
                owed), so they're hidden rather than left to misfire. */}
            {(Object.keys(EMAIL_TYPE_META) as EmailType[])
              .filter((type) => (status === "void" ? type === "sales_return" : type !== "sales_return"))
              .map((type) => (
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

// Batch D — generalized to render any of the three header sections (Buyer /
// Seller / Invoice info). `name` is the bold headline (omitted entirely for
// Invoice info, which has no single "name"); `nameAr` is an optional second
// bold line (buyer's Arabic company name only — seller has no name_ar,
// invoice info has none). `lines` is an ordered list of label/value pairs;
// entries with a null value are dropped, and an empty label renders the
// value alone (used for address/description/email — text that reads fine
// unlabeled).
function IdentityBlock({
  title,
  name,
  nameAr,
  lines,
}: {
  title: string;
  name?: string | null;
  nameAr?: string | null;
  lines: { label: string; value: string | null }[];
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide muted mb-0.5">{title}</div>
      {name !== undefined && <div className="font-medium">{name ?? <span className="muted">Not on file</span>}</div>}
      {nameAr && (
        <div className="font-medium" dir="rtl">
          {nameAr}
        </div>
      )}
      {lines
        .filter((l) => l.value)
        .map((l, i) => (
          <div key={i} className="muted text-xs">
            {l.label ? `${l.label} ${l.value}` : l.value}
          </div>
        ))}
    </div>
  );
}

function LineTable({
  title,
  lines,
  totals,
  fallbackWaterType,
  headerRight,
}: {
  title: string;
  lines: InvoiceLineSnapshot[];
  totals: Totals;
  // Display-only fallback (Finance polish batch C) — project's CURRENT
  // water_type, used when a line's own snapshot water_type is null (pre-
  // water_type-field invoice). Never mutates the frozen snapshot.
  fallbackWaterType?: WaterType | null;
  // v3.1 (item 6) — lets the postpaid Unpaid table host the hide-amount-due
  // toggle at its header, same row as the title. Undefined for Covered.
  headerRight?: React.ReactNode;
}) {
  // Trip lines only (special charges get their own section — see
  // SpecialChargesSection below). Presentation-only: collapse per-trip lines
  // into grouped summary rows (one row per project rate — see
  // lib/invoiceDisplay.ts). VAT is NOT shown per row — it appears only in the
  // document-level totals passed in via `totals` (untouched money logic).
  const rows = groupInvoiceLines(lines, fallbackWaterType);

  return (
    <section className="space-y-2 break-inside-avoid">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide muted">{title}</h3>
        {headerRight}
      </div>
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
          </tbody>
        </Table>
        {/* Footer lives OUTSIDE the table (matches PrepaidTripTable's
            footer treatment, item 1 v3.2 fix) — a per-column <td> here
            auto-sizes to each column's DATA-row content (Price/Amount are
            narrow, just numbers), which split the faded pre-VAT figure and
            the bold total across two far-apart, independently-sized
            columns instead of reading as one grouped subtotal breakdown.
            A flex row below the table sizes on its own content instead. */}
        <div className="border-t border-app px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="muted">Subtotal</span>
            <span className="flex items-baseline gap-2">
              {/* v3.1 (item 3) — faded pre-VAT + VAT breakdown alongside the
                  figure. totals.subtotal is already pre-VAT here (Totals =
                  InvoiceTableTotals, lib/invoice.ts) — no re-derivation. */}
              <span className="tabular-nums text-xs text-black/35 dark:text-white/35">
                {formatNum(totals.subtotal)} + VAT {formatNum(totals.vat)}
              </span>
              <span className="tabular-nums font-medium">{formatSar(totals.total)}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

// v3 §9 — prepaid Covered/Unpaid TRIPS table. ALWAYS rendered (even with zero
// rows — "always shown, even at zero" per spec), pre-VAT rows (no per-row
// VAT column — VAT only ever shows in the Grand Total stack). Footer is the
// stacked Subtotal/Balance/Remaining ledger figures (VAT-inclusive),
// replacing LineTable's inline "Subtotal / VAT / Total" row — mirrors
// lib/invoicePdfTemplate.ts's prepaidTripTable exactly (same three figures,
// same source: view.ledger, never re-derived here).
function PrepaidTripTable({
  title,
  lines,
  ledger,
  fallbackWaterType,
  headerRight,
  hiddenFromPrint = false,
}: {
  title: string;
  lines: InvoiceLineSnapshot[];
  ledger: DisplayLedgerTotals;
  fallbackWaterType?: WaterType | null;
  // v3.1 (item 6) — lets the Unpaid Trips table host the hide-amount-due
  // toggle at its header, same row as the title. Undefined for Covered.
  headerRight?: React.ReactNode;
  // hide_amount_due, PRINT ONLY. §7's rule for this toggle is that it
  // "governs print/PDF/email only — always visible on-screen", so this is a
  // print-media class and MUST NOT become a conditional render: the person
  // deciding what the customer sees has to keep seeing it themselves.
  hiddenFromPrint?: boolean;
}) {
  const rows = groupInvoiceLines(lines, fallbackWaterType);
  // v3.1 (item 3) — faded pre-VAT + VAT breakdown alongside the Subtotal
  // figure. ledger.subtotal is VAT-inclusive (file header) so it can't be
  // decomposed on its own; derive pre-VAT from the SAME raw lines already
  // passed in (sum of amount_sar, the one figure the VAT engine reads —
  // lib/invoice.ts), then back into VAT so the two halves always foot
  // exactly to ledger.subtotal. Display-only — no new consumption math.
  const preVat = round2(lines.reduce((s, l) => s + l.amount_sar, 0));
  const vatAmt = round2(ledger.subtotal - preVat);

  return (
    <section className={"space-y-2 break-inside-avoid" + (hiddenFromPrint ? " no-print" : "")}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide muted">{title}</h3>
        {headerRight}
      </div>
      <div className="card p-0 overflow-hidden">
        {/* EMPTY STATE: no six-column header, no row of five blank cells. A
            skeleton table with nothing in it reads as a table that failed to
            load; one quiet line reads as an answer. The ledger footer below
            stays either way — "always shown, even at zero" is still the rule,
            and Remaining is a real figure whether or not any trip sits above
            it. This also brings the screen CLOSER to the PDF, whose own empty
            state is a single colspan cell (invoicePdfTemplate.ts). */}
        {rows.length === 0 ? (
          <div className="px-4 py-3 text-sm muted">No trips.</div>
        ) : (
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
            {
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
            }
          </tbody>
        </Table>
        )}
        <div className="border-t border-app px-4 py-3 space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="muted">Subtotal</span>
            <span className="flex items-baseline gap-2">
              <span className="tabular-nums text-xs text-black/35 dark:text-white/35">
                {formatNum(preVat)} + VAT {formatNum(vatAmt)}
              </span>
              <span className="tabular-nums font-medium">{formatSar(ledger.subtotal)}</span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="muted">Running Balance</span>
            {/* null = pre-migration-0036 legacy invoice, no frozen balance on
                disk (see DisplayLedgerTotals) — "—", never a fabricated 0. */}
            <span className="tabular-nums">{ledger.balance == null ? <span className="muted">—</span> : formatSar(ledger.balance)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-medium">Remaining</span>
            <span className={"tabular-nums font-semibold " + (ledger.remaining != null && ledger.remaining < 0 ? "text-rose-600 dark:text-rose-400" : "")}>
              {ledger.remaining == null ? <span className="muted font-normal">—</span> : formatSar(ledger.remaining)}
            </span>
          </div>
        </div>
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
  setChargeImageFile: (f: File | null) => void;
  chargeImageInputKey: number;
}) {
  const canSubmit = !!chargeLabel.trim() && Number(chargeQty) > 0 && Number(chargePrice) >= 0;

  return (
    <>
      {/* v3.1 (item 7) — the charges TABLE is now its own section, styled
          like its sister tables (Covered/Unpaid: title + `card p-0
          overflow-hidden` + a border-top footer strip), not bundled inside
          the tinted add-charge panel anymore. Always shown when there's
          anything to show or the invoice is editable (same gating the
          caller already applies), matching Covered/Unpaid's "always shown"
          convention. */}
      <section className="space-y-2 break-inside-avoid">
        <h3 className="text-xs font-semibold uppercase tracking-wide muted">Special Charges</h3>
        <div className="card p-0 overflow-hidden">
          {chargeLines.length > 0 ? (
            <>
              <Table>
                <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                  <tr>
                    <TH>Date</TH>
                    <TH>Description</TH>
                    <TH>Quantity</TH>
                    <TH>Price</TH>
                    <TH>Amount</TH>
                    <TH>Status</TH>
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
                        {/* v3 §9 — this table is prepaid-only (postpaid never
                            renders SpecialChargesSection here), so `covered`
                            undefined means one thing: a pre-migration-0036
                            legacy snapshot with no per-charge coverage field
                            at all. Pre-v3, a special charge had no rollover
                            concept — it was always billed on the invoice it
                            was added to (spec §4/§7) — so undefined reads as
                            Covered, same as explicit `true`. Only an explicit
                            `false` (the v3 engine's real "rolled forward,
                            excluded from this invoice's Grand Total" tag)
                            shows "Rolls forward". */}
                        {l.covered === false ? (
                          <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400">
                            Rolls forward
                          </span>
                        ) : (
                          <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            Covered
                          </span>
                        )}
                      </TD>
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
                <span className="muted">Subtotal {formatNum(subtotal)} + VAT {formatNum(vat)} =</span>
                <span className="font-semibold tabular-nums">{formatSar(total)}</span>
              </div>
            </>
          ) : (
            <p className="p-4 text-sm muted">No special charges on this invoice yet.</p>
          )}
        </div>
      </section>

      {/* Add-charge form — untouched, still its own separate, roomier
          tinted-panel surface (item 7: "stays exactly as-is, separate"). */}
      {editable && (
        <section className="break-inside-avoid">
          <form onSubmit={onAddCharge} className="no-print space-y-4 rounded-2xl bg-black/[0.025] dark:bg-white/[0.035] p-6">
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
        </section>
      )}
    </>
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

// v3 §9, generalized in v3.1 (items 2 & 4) — the stacked Grand Total block,
// now shared by BOTH modes: Subtotal → Special Charges → VAT → Total. No
// title (the block is self-evident — item 4); no Balance/Remaining rows ever
// (postpaid has no balance concept — item 2). Prepaid feeds it covered
// trips + covered charges only (unpaid trips excluded, unchanged v3 §9
// behavior); postpaid feeds it the full unpaid-trips + charges period value
// (its existing view.grand, untouched — see lib/invoice.ts's POSTPAID note).
function GrandTotalStack({
  subtotalLabel,
  subtotal,
  chargesLabel,
  chargesSubtotal,
  vat,
  total,
}: {
  subtotalLabel: string;
  subtotal: number;
  chargesLabel: string;
  chargesSubtotal: number;
  vat: number;
  total: number;
}) {
  return (
    <section className="space-y-2 break-inside-avoid">
      <div className="card p-4 space-y-1.5 text-sm max-w-md sm:min-w-[26rem] ms-auto">
        <div className="flex items-center justify-between">
          <span className="muted">{subtotalLabel}</span>
          <span className="tabular-nums">{formatSar(subtotal)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="muted">{chargesLabel}</span>
          <span className="tabular-nums">{formatSar(chargesSubtotal)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="muted">Total VAT</span>
          <span className="tabular-nums">{formatSar(vat)}</span>
        </div>
        <div className="flex items-center justify-between pt-2 mt-1 border-t border-app">
          <span className="font-semibold">TOTAL</span>
          <span className="text-xl font-semibold tabular-nums text-brand-600 dark:text-brand-300">{formatSar(total)}</span>
        </div>
      </div>
    </section>
  );
}

// v3.1 (item 6) — the Amount-Due hide toggle, moved out of the old Amount Due
// section header and into the top of the Unpaid Trips table (same control,
// same `invoices.hide_amount_due` column, same setHideAmountDue() action —
// just relocated). Shared by both modes (item 5: Amount Due applies to both).
function HideAmountDueToggle({
  hidden,
  busy,
  onToggle,
}: {
  hidden: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      className={"no-print inline-flex items-center gap-2 text-xs " + (busy ? "opacity-50 pointer-events-none" : "")}
      title="Controls whether Amount Due appears in print / PDF / email — always visible here on-screen."
    >
      <span
        className={
          "relative inline-block h-4 w-7 rounded-full transition-colors " +
          (hidden ? "bg-[rgb(var(--border))]" : "bg-brand-600")
        }
      >
        <span
          className={
            "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform " +
            (hidden ? "translate-x-0.5" : "translate-x-3.5")
          }
        />
      </span>
      <span className="muted">{hidden ? "Hidden from customer" : "Visible to customer"}</span>
    </button>
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
        `Amount Due: ${due}`,
        "",
        "We would appreciate it if you could arrange payment at your earliest convenience. If payment has already been made, please disregard this message.",
        "",
        ...signature,
      ];
      break;
    case "sales_return": {
      const returnDate = raw.voided_at
        ? formatDate(raw.voided_at, { year: "numeric", month: "long", day: "numeric" })
        : "recently";
      subject = `Sales Return — Invoice ${ref} — ${buyerName}`;
      bodyLines = [
        `Dear ${buyerName},`,
        "",
        `This is to notify you that invoice ${ref} was cancelled (Sales Return) on ${returnDate}.`,
        "",
        "This invoice is no longer valid and no payment is owed against it. Please disregard it for any accounting or payment purposes.",
        raw.void_reason ? `Reason: ${raw.void_reason}` : null,
        "",
        "If you have any questions, please don't hesitate to reach out.",
        "",
        ...signature,
      ];
      break;
    }
    case "generic":
    default:
      subject = `Invoice ${ref}`;
      bodyLines = [`Dear ${buyerName},`, "", `Please find attached invoice ${ref} for the period ${period}.`, "", ...signature];
      break;
  }

  const body = bodyLines.filter((l) => l !== null).join("\n");
  return `mailto:${encodeURIComponent(customerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
