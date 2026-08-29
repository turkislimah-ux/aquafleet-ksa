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
import { useApp } from "@/components/AppShell";
import { t, fill, plural, arText, type Lang, type TKey } from "@/lib/i18n";
import { invoiceStatusLabel, paymentMethodLabel, waterTypeLabel } from "@/lib/enum-labels";
import { formatDate, formatNum, formatSar, todayKey } from "@/lib/utils";
import { canEditSpecialCharges } from "@/lib/invoice";
import { round2 } from "@/lib/vat";
import { groupInvoiceLines } from "@/lib/invoiceDisplay";
import TripRefLink from "@/components/TripRefLink";
import {
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
//
// THIS IS A KEY TUPLE, NOT A LABEL MAP. It replaces the old
// `EMAIL_TYPE_META: Record<EmailType, {label, hint}>` const, whose English
// words could not follow a language switch from module scope. It carries the
// two things the map was actually load-bearing for — the MEMBERS and their
// ORDER in the picker — while the words come from
// `trips.invoice.emailType.<type>.{label,hint}` at the render site.
//
// The order is the same order the old `Object.keys(EMAIL_TYPE_META)` yielded
// (string keys enumerate in insertion order), but it is now STATED rather than
// inherited from how the object happened to be written.
//
// `EmailType` is derived from the tuple so the union and the list cannot drift
// apart — adding a template here is a `tsc` error until its dictionary leaves
// exist.
const EMAIL_TYPES = ["statement", "payment_due", "reminder", "generic", "sales_return"] as const;
type EmailType = (typeof EMAIL_TYPES)[number];

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
  // Read BEFORE the `!open || !invoiceId || !mounted` bail-out further down —
  // a hook after an early return is a hook-order violation.
  const { lang } = useApp();
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
      setError(r.error ?? t("trips.invoice.errLoad", lang));
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
        setError(p.error ?? t("trips.invoice.errPreview", lang));
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
      setPdfError(r.error ?? t("trips.invoice.errPdf", lang));
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
      setActionError(res.error ?? t("trips.invoice.errAddCharge", lang));
      return;
    }
    if (chargeImageFile) {
      const form = new FormData();
      form.set("imageFile", chargeImageFile);
      const imgRes = await uploadSpecialChargeImage(invoiceId, res.data.id, form);
      if (imgRes.error) {
        // Charge itself was added fine — surface the image failure but don't
        // discard the successful add; the row can still get an image later.
        setActionError(fill(t("trips.invoice.errChargeImage", lang), { err: imgRes.error }));
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
      setActionError(r.error ?? t("trips.invoice.errViewImage", lang));
      return;
    }
    window.open(r.data.url, "_blank", "noopener,noreferrer");
  }

  async function onSavePeriod(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceId) return;
    if (periodStartInput > periodEndInput) {
      // Same rule, same sentence InvoicesModal validates the CREATE form with —
      // reused from where its first reader put it rather than promoted.
      setPeriodError(t("trips.invoices.badPeriod", lang));
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
      setActionError(r.error ?? t("trips.invoice.errProof", lang));
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
              {t("trips.invoice.backToInvoices", lang)}
            </button>
            {/* TOOLBAR pill — chrome, so it translates. Keyed off `status`, the
                ENUM VALUE, exactly as the map it replaces was; nothing reads the
                label back. The SHEET's own Status line (:788, inside
                `#invoice-print`) still renders INVOICE_STATUS_LABELS and stays
                English, which is why that import is still here. */}
            {status && <StatusPill status={status} label={invoiceStatusLabel(status, lang)} />}
          </div>
          <div className="flex items-center gap-2">
            <span title={!canEmail && raw && view ? t("trips.invoice.noEmailOnFile", lang) : undefined}>
              <Btn
                variant="outline"
                onClick={() => canEmail && setEmailPickerOpen(true)}
                className={!canEmail ? "opacity-50 pointer-events-none" : ""}
              >
                <Mail className="h-4 w-4" /> {t("trips.invoice.emailBtn", lang)}
              </Btn>
            </span>
            <Btn variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4" /> {t("common.print", lang)}
            </Btn>
            <span title={pdfError ?? undefined}>
              <Btn
                variant="outline"
                onClick={handleDownloadPdf}
                className={downloadingPdf ? "opacity-50 pointer-events-none" : ""}
              >
                <Download className="h-4 w-4" />{" "}
                {t(downloadingPdf ? "trips.invoice.generating" : "trips.invoice.downloadPdf", lang)}
              </Btn>
            </span>
            <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {loading && <div className="p-10 text-center muted text-sm">{t("trips.invoice.loading", lang)}</div>}
        {error && <div className="p-10 text-center text-sm text-rose-600 dark:text-rose-400">{error}</div>}

        {!loading && !error && raw && view && (
          <div id="invoice-print" className="p-6 space-y-6">
            {/* Header — identity + document meta. */}
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div>
                <h2 className="text-xl font-semibold">
                  {raw.invoice_number
                    ? fill(t("trips.invoiceSheet.headline", lang), { n: raw.invoice_number })
                    : t("trips.invoiceSheet.headlineDraft", lang)}
                </h2>
                {status === "draft" && !readOnly && editingPeriod ? (
                  <form onSubmit={onSavePeriod} className="no-print flex items-end gap-2 flex-wrap mt-1">
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="font-medium">{t("trips.invoiceSheet.fPeriodStart", lang)}</span>
                      <input value={periodStartInput} onChange={(e) => setPeriodStartInput(e.target.value)} type="date" required className={INPUT} style={INPUT_STYLE} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="font-medium">{t("trips.invoiceSheet.fPeriodEnd", lang)}</span>
                      <input value={periodEndInput} onChange={(e) => setPeriodEndInput(e.target.value)} type="date" required className={INPUT} style={INPUT_STYLE} />
                    </label>
                    <Btn type="submit" variant="outline" className={savingPeriod ? "opacity-50 pointer-events-none" : ""}>
                      {t(savingPeriod ? "common.saving" : "common.save", lang)}
                    </Btn>
                    <Btn
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setEditingPeriod(false);
                        setPeriodError(null);
                      }}
                    >
                      {t("common.cancel", lang)}
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
                    title={t("trips.invoiceSheet.editPeriodHint", lang)}
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
                lang={lang}
                title={t("trips.invoiceSheet.buyer", lang)}
                name={view.buyerSnapshot?.name ?? null}
                nameAr={view.buyerSnapshot?.name_ar ?? null}
                lines={[
                  { label: "", value: view.buyerSnapshot?.billing_address ?? null },
                  { label: t("trips.invoiceSheet.fVatRegNo", lang), value: view.buyerSnapshot?.vat_number ?? null },
                  { label: t("trips.invoiceSheet.fCrNo", lang), value: view.buyerSnapshot?.cr_number ?? null },
                  { label: "", value: customerEmail },
                ]}
              />
              <IdentityBlock
                lang={lang}
                title={t("trips.invoiceSheet.seller", lang)}
                name={view.sellerSnapshot?.legal_name ?? null}
                nameAr={view.sellerSnapshot?.legal_name_ar ?? null}
                lines={[
                  { label: "", value: view.sellerSnapshot?.description ?? null },
                  { label: t("trips.invoiceSheet.fCrNo", lang), value: view.sellerSnapshot?.cr_number ?? null },
                  { label: "", value: view.sellerSnapshot?.address ?? null },
                  { label: t("trips.invoiceSheet.fTel", lang), value: view.sellerSnapshot?.telephone ?? null },
                  { label: t("trips.invoiceSheet.fMobile", lang), value: view.sellerSnapshot?.phone ?? null },
                  { label: t("trips.invoiceSheet.fVatRegNo", lang), value: view.sellerSnapshot?.vat_number ?? null },
                ]}
              />
              <IdentityBlock
                lang={lang}
                title={t("trips.invoiceSheet.invoiceInfo", lang)}
                lines={[
                  {
                    label: t("trips.invoiceSheet.fInvoiceNo", lang),
                    value: raw.invoice_number ?? t("trips.invoiceSheet.vDraftNotNumbered", lang),
                  },
                  { label: t("trips.invoiceSheet.fIssueDate", lang), value: raw.confirmed_at ? raw.confirmed_at.slice(0, 10) : "—" },
                  { label: t("trips.invoiceSheet.fPeriod", lang), value: `${raw.period_start} → ${raw.period_end}` },
                  { label: t("common.status", lang), value: status ? invoiceStatusLabel(status, lang) : null },
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
                  <span className="font-medium">{t("trips.invoiceSheet.salesReturn", lang)}</span>
                  {raw.voided_at ? fill(t("trips.invoiceSheet.voidedOn", lang), { date: raw.voided_at.slice(0, 10) }) : ""}
                  {raw.void_reason ? fill(t("trips.invoiceSheet.voidSuffix", lang), { reason: raw.void_reason }) : ""}
                </div>
                <div className="text-xs">
                  {fill(t("trips.invoiceSheet.salesReturnNote", lang), {
                    ref: raw.invoice_number ? ` (${raw.invoice_number})` : "",
                  })}
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
                  lang={lang}
                  title={t("trips.invoiceSheet.tCoveredTrips", lang)}
                  lines={view.coveredLines}
                  ledger={view.ledger?.covered ?? { subtotal: view.covered.total, balance: null, remaining: null }}
                  fallbackWaterType={view.projectWaterType}
                />
                <PrepaidTripTable
                  lang={lang}
                  title={t("trips.invoiceSheet.tUnpaidTrips", lang)}
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
                      lang={lang}
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
                    lang={lang}
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
                    <TotalCard
                      lang={lang}
                      label={t("trips.invoiceSheet.amountDue", lang)}
                      totals={view.amountDue}
                      tone={view.amountDue.total > 0 ? "bad" : "ok"}
                    />
                  </div>
                  {/* Grand Total — v3 §9, one stacked block: covered trips +
                      covered charges only (unpaid trips excluded). No title
                      (item 4). */}
                  <GrandTotalStack
                    lang={lang}
                    subtotalLabel={t("trips.invoiceSheet.subtotalCovered", lang)}
                    subtotal={view.covered.subtotal}
                    chargesLabel={t("trips.invoiceSheet.chargesCovered", lang)}
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
                    lang={lang}
                    title={t("trips.invoiceSheet.tCoveredPostpaid", lang)}
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
                  lang={lang}
                  title={t("trips.invoiceSheet.tUnpaidPostpaid", lang)}
                  lines={postpaidUnpaidTripLines}
                  totals={{ subtotal: postpaidUnpaidTripSubtotal, vat: postpaidUnpaidTripVat, total: postpaidUnpaidTripTotal }}
                  fallbackWaterType={view.projectWaterType}
                  headerRight={
                    <HideAmountDueToggle
                      lang={lang}
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
                    lang={lang}
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
                  lang={lang}
                  subtotalLabel={t("trips.invoiceSheet.subtotalUnpaid", lang)}
                  subtotal={postpaidUnpaidTripSubtotal}
                  chargesLabel={t("trips.invoiceSheet.specialCharges", lang)}
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
                  {fill(t(`trips.invoiceSheet.blockers.${plural(blockers.length)}`, lang), { n: blockers.length })}
                </p>
                <ul className="text-sm space-y-1 ps-6 list-disc">
                  {blockers.map((b) => (
                    <li key={b.id}>
                      {b.trip_date} — <TripRefLink tripId={b.id} label={b.ref ?? t("trips.invoiceSheet.viewTrip", lang)} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {raw.status === "paid" && (
              <div className="rounded-lg border border-app p-3 text-sm break-inside-avoid">
                <span className="font-medium">{t("trips.invoiceSheet.paid", lang)}</span>{" "}
                {raw.paid_at ? fill(t("trips.invoiceSheet.paidOn", lang), { date: raw.paid_at.slice(0, 10) }) : ""}{" "}
                {t("trips.invoiceSheet.via", lang)}{" "}
                {raw.payment_method ? paymentMethodLabel(raw.payment_method, lang) : "—"}.
                {raw.proof_of_payment_path && (
                  <Btn variant="ghost" className="ms-2 no-print" onClick={onViewProof}>
                    {t("trips.invoiceSheet.viewProof", lang)}
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
                    {t("trips.invoiceSheet.moveToReview", lang)}
                  </Btn>
                  <Btn variant="outline" onClick={() => setDeletingDraft(true)} className={busy ? "opacity-50 pointer-events-none" : ""}>
                    <Trash2 className="h-4 w-4" /> {t("trips.invoiceSheet.deleteDraft", lang)}
                  </Btn>
                </div>
              )}
              {status === "draft" && deletingDraft && (
                <GuardBox
                  lang={lang}
                  warning={t("trips.invoiceSheet.guardDeleteDraft", lang)}
                  busy={busy}
                  confirmLabel={t("trips.invoiceSheet.confirmDeleteDraft", lang)}
                  onCancel={() => setDeletingDraft(false)}
                  onConfirm={onDeleteDraft}
                />
              )}

              {status === "review" && !confirmingConfirm && (
                <div className="flex items-center gap-2">
                  <Btn variant="outline" onClick={() => runAction(() => revertInvoiceToDraft(invoiceId))} className={busy ? "opacity-50 pointer-events-none" : ""}>
                    {t("trips.invoiceSheet.backToDraft", lang)}
                  </Btn>
                  <span
                    title={
                      blockers.length > 0
                        ? t("trips.invoiceSheet.cannotConfirmTitle", lang)
                        : undefined
                    }
                  >
                    <Btn
                      variant="primary"
                      onClick={() => blockers.length === 0 && setConfirmingConfirm(true)}
                      className={blockers.length > 0 ? "opacity-50 pointer-events-none" : ""}
                    >
                      {t("trips.invoiceSheet.confirmInvoiceBtn", lang)}
                    </Btn>
                  </span>
                </div>
              )}
              {status === "review" && confirmingConfirm && (
                <GuardBox
                  lang={lang}
                  warning={t("trips.invoiceSheet.guardConfirm", lang)}
                  busy={busy}
                  confirmLabel={t("trips.invoiceSheet.confirmConfirm", lang)}
                  onCancel={() => setConfirmingConfirm(false)}
                  onConfirm={() => runAction(() => confirmInvoice(invoiceId).then((r) => ({ error: r.error })))}
                />
              )}

              {status === "confirmed" && !voiding && !payingOpen && (
                <div className="flex items-center gap-2">
                  <Btn variant="primary" onClick={() => setPayingOpen(true)}>
                    {t(isPrepaid ? "trips.invoiceSheet.payWithBalance" : "trips.invoiceSheet.markPaid", lang)}
                  </Btn>
                  <Btn variant="outline" onClick={() => setVoiding(true)}>
                    {t("trips.invoiceSheet.salesReturn", lang)}
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
                      <span className="muted">{t("trips.invoiceSheet.settledBalance", lang)}</span>
                      <span className="tabular-nums">{formatSar(settledBalance ?? 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="muted">{t("trips.invoiceSheet.thisInvoiceGrand", lang)}</span>
                      <span className="tabular-nums">− {formatSar(view.grand.total)}</span>
                    </div>
                    <div className="flex justify-between font-semibold pt-1.5 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                      <span>{t("trips.invoiceSheet.remainingSettled", lang)}</span>
                      <span className={"tabular-nums " + (((settledBalance ?? 0) - view.grand.total) < 0 ? "text-rose-600 dark:text-rose-400" : "")}>
                        {formatSar((settledBalance ?? 0) - view.grand.total)}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs muted">
                    {t("trips.invoiceSheet.balanceNote", lang)}
                  </p>
                  <div className="flex items-center gap-2">
                    <Btn type="button" variant="ghost" onClick={() => setPayingOpen(false)}>
                      {t("common.cancel", lang)}
                    </Btn>
                    <Btn type="button" variant="primary" onClick={onMarkPaidBalance} className={busy ? "opacity-50 pointer-events-none" : ""}>
                      {t(busy ? "common.recording" : "trips.invoiceSheet.confirmPayment", lang)}
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
                      {paymentMethodLabel("cash", lang)}
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="paymentMethod" value="bank_transfer" checked={payMethod === "bank_transfer"} onChange={() => setPayMethod("bank_transfer")} />
                      {paymentMethodLabel("bank_transfer", lang)}
                    </label>
                  </div>
                  {/* Batch 2 (migration 0039) — reference + date required for
                      bank_transfer (a real bank transaction to point to,
                      same reasoning as the proof file below); optional for
                      cash. Note always optional. Uncontrolled — read via
                      FormData in onMarkPaid, same as proofFile. */}
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">
                      {t("trips.invoiceSheet.fPaymentReference", lang)}
                      {t(payMethod === "bank_transfer" ? "trips.invoiceSheet.sufRequired" : "trips.invoiceSheet.sufOptional", lang)}
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
                      {t("trips.invoiceSheet.fPaymentDate", lang)}
                      {t(payMethod === "bank_transfer" ? "trips.invoiceSheet.sufRequired" : "trips.invoiceSheet.sufOptional", lang)}
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
                    <span className="font-medium">{t("trips.invoiceSheet.fPayNote", lang)}</span>
                    <textarea name="paymentNote" rows={2} className={INPUT} style={INPUT_STYLE} />
                  </label>
                  {payMethod === "bank_transfer" && (
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="font-medium">{t("trips.invoiceSheet.fProof", lang)}</span>
                      <input type="file" name="proofFile" required className={INPUT} style={INPUT_STYLE} />
                    </label>
                  )}
                  <div className="flex items-center gap-2">
                    <Btn type="button" variant="ghost" onClick={() => setPayingOpen(false)}>
                      {t("common.cancel", lang)}
                    </Btn>
                    <Btn type="submit" variant="primary" className={busy ? "opacity-50 pointer-events-none" : ""}>
                      {t(busy ? "common.recording" : "trips.invoiceSheet.confirmPayment", lang)}
                    </Btn>
                  </div>
                </form>
              )}
              {status === "confirmed" && voiding && (
                <div className="space-y-2 max-w-sm">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">{t("trips.invoiceSheet.fVoidReason", lang)}</span>
                    <textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} rows={2} className={INPUT} style={INPUT_STYLE} />
                  </label>
                  <GuardBox
                    lang={lang}
                    warning={t("trips.invoiceSheet.guardVoid", lang)}
                    busy={busy}
                    confirmLabel={t("trips.invoiceSheet.confirmVoid", lang)}
                    confirmDisabled={!voidReason.trim()}
                    onCancel={() => setVoiding(false)}
                    onConfirm={() => runAction(() => voidInvoice(invoiceId, voidReason.trim()))}
                  />
                </div>
              )}

              {status === "paid" && !unpaying && (
                <Btn variant="outline" onClick={() => setUnpaying(true)}>
                  <AlertTriangle className="h-4 w-4" /> {t("trips.invoiceSheet.adminUnpay", lang)}
                </Btn>
              )}
              {status === "paid" && unpaying && (
                <div className="space-y-2 max-w-sm">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">{t("trips.invoiceSheet.fUnpayReason", lang)}</span>
                    <textarea value={unpayReason} onChange={(e) => setUnpayReason(e.target.value)} rows={2} className={INPUT} style={INPUT_STYLE} />
                  </label>
                  <GuardBox
                    lang={lang}
                    warning={t("trips.invoiceSheet.guardUnpay", lang)}
                    busy={busy}
                    confirmLabel={t("trips.invoiceSheet.confirmUnpay", lang)}
                    confirmDisabled={!unpayReason.trim()}
                    onCancel={() => setUnpaying(false)}
                    onConfirm={() => runAction(() => unpayInvoice(invoiceId, unpayReason.trim()))}
                  />
                </div>
              )}
            </div>
            )}

            <div className="border-t border-app pt-3 text-[11px] muted flex items-center justify-between">
              <span>
                {fill(t("trips.invoiceSheet.generated", lang), {
                  date: formatDate(new Date(), { year: "numeric", month: "short", day: "numeric" }),
                })}
              </span>
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
            <h3 className="text-sm font-semibold">{t("trips.invoice.emailPickerTitle", lang)}</h3>
            <button type="button" onClick={() => setEmailPickerOpen(false)} className="muted hover:text-[rgb(var(--fg))]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2">
            {/* Sales Return notice only offered once actually returned;
                the other four don't make sense to send on a cancelled
                invoice (payment due/reminder chase money that's no longer
                owed), so they're hidden rather than left to misfire. */}
            {EMAIL_TYPES.filter((type) =>
              status === "void" ? type === "sales_return" : type !== "sales_return",
            ).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => sendTemplate(type)}
                className="w-full text-start rounded-lg border border-app px-3 py-2 text-sm hover:border-brand-500 hover:bg-brand-500/10"
              >
                {/* Keyed off the TEMPLATE VALUE `type`, the same value
                    sendTemplate() dispatches on. The picker never reads a
                    label back to decide which mail to build. */}
                <div className="font-medium">{t(`trips.invoice.emailType.${type}.label`, lang)}</div>
                <div className="muted text-[11px]">{t(`trips.invoice.emailType.${type}.hint`, lang)}</div>
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
  lang,
  title,
  name,
  nameAr,
  lines,
}: {
  // Every caller passes an ALREADY-TRANSLATED `title` and already-translated
  // labels — `lang` is here for the one string this component owns itself, the
  // "Not on file" placeholder below.
  lang: Lang;
  title: string;
  name?: string | null;
  nameAr?: string | null;
  lines: { label: string; value: string | null }[];
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide muted mb-0.5">{title}</div>
      {name !== undefined && (
        <div className="font-medium">{name ?? <span className="muted">{t("trips.invoiceSheet.notOnFile", lang)}</span>}</div>
      )}
      {/* THE ONE INTENTIONAL CHANGE INSIDE `#invoice-print`, and it changes no
          text. `dir="rtl"` used to sit on the block, which forced the whole
          line to lay out right-to-left regardless of the page's own direction —
          so on an English sheet this one line jumped to the right margin while
          every other line stayed left. The attribute is only needed for GLYPH
          ORDER within the Arabic name itself, so it moves to an inline <span>:
          the block now inherits the page direction and aligns with its
          neighbours, and the Arabic still shapes correctly.

          The rendered TEXT is byte-identical — `{nameAr}` was the div's only
          child (the surrounding whitespace runs contain newlines and are
          stripped by JSX), and it is now the span's only child. */}
      {nameAr && (
        <div className="font-medium">
          <span dir="rtl">{nameAr}</span>
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
  lang,
  title,
  lines,
  totals,
  fallbackWaterType,
  headerRight,
}: {
  lang: Lang;
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
              <TH>{t("common.date", lang)}</TH>
              <TH>{t("trips.invoiceSheet.colDescription", lang)}</TH>
              <TH>{t("common.type", lang)}</TH>
              <TH>{t("trips.invoiceSheet.colQuantity", lang)}</TH>
              <TH>{t("trips.invoiceSheet.colPrice", lang)}</TH>
              <TH>{t("common.amount", lang)}</TH>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <TD className="muted">{t("trips.invoiceSheet.emptyLines", lang)}</TD>
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
                  <TD>{r.waterType ? waterTypeLabel(r.waterType, lang) : "—"}</TD>
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
            <span className="muted">{t("trips.invoiceSheet.subtotal", lang)}</span>
            <span className="flex items-baseline gap-2">
              {/* v3.1 (item 3) — faded pre-VAT + VAT breakdown alongside the
                  figure. totals.subtotal is already pre-VAT here (Totals =
                  InvoiceTableTotals, lib/invoice.ts) — no re-derivation. */}
              <span className="tabular-nums text-xs text-black/35 dark:text-white/35">
                {fill(t("trips.invoiceSheet.vatSplit", lang), {
                  net: formatNum(totals.subtotal),
                  vat: formatNum(totals.vat),
                })}
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
  lang,
  title,
  lines,
  ledger,
  fallbackWaterType,
  headerRight,
  hiddenFromPrint = false,
}: {
  lang: Lang;
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
          <div className="px-4 py-3 text-sm muted">{t("trips.invoiceSheet.emptyTrips", lang)}</div>
        ) : (
        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH>{t("common.date", lang)}</TH>
              <TH>{t("trips.invoiceSheet.colDescription", lang)}</TH>
              <TH>{t("common.type", lang)}</TH>
              <TH>{t("trips.invoiceSheet.colQuantity", lang)}</TH>
              <TH>{t("trips.invoiceSheet.colPrice", lang)}</TH>
              <TH>{t("common.amount", lang)}</TH>
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
                  <TD>{r.waterType ? waterTypeLabel(r.waterType, lang) : "—"}</TD>
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
            <span className="muted">{t("trips.invoiceSheet.subtotal", lang)}</span>
            <span className="flex items-baseline gap-2">
              <span className="tabular-nums text-xs text-black/35 dark:text-white/35">
                {fill(t("trips.invoiceSheet.vatSplit", lang), { net: formatNum(preVat), vat: formatNum(vatAmt) })}
              </span>
              <span className="tabular-nums font-medium">{formatSar(ledger.subtotal)}</span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="muted">{t("trips.invoiceSheet.runningBalance", lang)}</span>
            {/* null = pre-migration-0036 legacy invoice, no frozen balance on
                disk (see DisplayLedgerTotals) — "—", never a fabricated 0. */}
            <span className="tabular-nums">{ledger.balance == null ? <span className="muted">—</span> : formatSar(ledger.balance)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-medium">{t("trips.invoiceSheet.remaining", lang)}</span>
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
  lang,
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
  lang: Lang;
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
        <h3 className="text-xs font-semibold uppercase tracking-wide muted">{t("trips.invoiceSheet.specialCharges", lang)}</h3>
        <div className="card p-0 overflow-hidden">
          {chargeLines.length > 0 ? (
            <>
              <Table>
                <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                  <tr>
                    <TH>{t("common.date", lang)}</TH>
                    <TH>{t("trips.invoiceSheet.colDescription", lang)}</TH>
                    <TH>{t("trips.invoiceSheet.colQuantity", lang)}</TH>
                    <TH>{t("trips.invoiceSheet.colPrice", lang)}</TH>
                    <TH>{t("common.amount", lang)}</TH>
                    <TH>{t("common.status", lang)}</TH>
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
                            {t("trips.invoiceSheet.badgeRollsForward", lang)}
                          </span>
                        ) : (
                          <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            {t("trips.invoiceSheet.badgeCovered", lang)}
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
                              title={t("trips.invoiceSheet.viewImageTitle", lang)}
                            >
                              <ImageIcon className="h-4 w-4" />
                            </button>
                          ) : (
                            editable && (
                              <label className="muted hover:text-[rgb(var(--fg))] cursor-pointer" title={t("trips.invoiceSheet.attachImageTitle", lang)}>
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
                <span className="muted">
                  {fill(t("trips.invoiceSheet.chargesSubtotal", lang), { net: formatNum(subtotal), vat: formatNum(vat) })}
                </span>
                <span className="font-semibold tabular-nums">{formatSar(total)}</span>
              </div>
            </>
          ) : (
            <p className="p-4 text-sm muted">{t("trips.invoiceSheet.noCharges", lang)}</p>
          )}
        </div>
      </section>

      {/* Add-charge form — untouched, still its own separate, roomier
          tinted-panel surface (item 7: "stays exactly as-is, separate"). */}
      {editable && (
        <section className="break-inside-avoid">
          <form onSubmit={onAddCharge} className="no-print space-y-4 rounded-2xl bg-black/[0.025] dark:bg-white/[0.035] p-6">
            <p className="text-xs font-semibold uppercase tracking-wide muted">{t("trips.invoiceSheet.addChargeTitle", lang)}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <label className="flex flex-col gap-1.5 text-sm col-span-2">
                <span className="font-medium">{t("trips.invoiceSheet.colDescription", lang)}</span>
                <input
                  value={chargeLabel}
                  onChange={(e) => setChargeLabel(e.target.value)}
                  className={INPUT}
                  style={INPUT_STYLE}
                  placeholder={t("trips.invoiceSheet.phCallout", lang)}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t("common.date", lang)}</span>
                <input value={chargeDate} onChange={(e) => setChargeDate(e.target.value)} type="date" className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t("trips.invoiceSheet.colQuantity", lang)}</span>
                <input value={chargeQty} onChange={(e) => setChargeQty(e.target.value)} type="number" min="0" step="any" className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t("trips.invoiceSheet.fPricePreVat", lang)}</span>
                <input value={chargePrice} onChange={(e) => setChargePrice(e.target.value)} type="number" min="0" step="any" className={INPUT} style={INPUT_STYLE} placeholder="0" />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t("common.amount", lang)}</span>
                <div className={INPUT + " muted tabular-nums"} style={INPUT_STYLE}>
                  {formatSar(chargeAmountPreview)}
                </div>
              </label>
              <label className="flex flex-col gap-1.5 text-sm col-span-2">
                <span className="font-medium">{t("trips.invoiceSheet.fAttachImage", lang)}</span>
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
                <Plus className="h-4 w-4" />{" "}
                {t(addingCharge ? "trips.invoiceSheet.adding" : "trips.invoiceSheet.addChargeBtn", lang)}
              </Btn>
            </div>
          </form>
        </section>
      )}
    </>
  );
}

function TotalCard({
  lang,
  label,
  totals,
  tone,
}: {
  lang: Lang;
  label: string;
  totals: Totals;
  tone: "ok" | "bad" | "info";
}) {
  const toneCls =
    tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-rose-600 dark:text-rose-400" : "text-brand-600 dark:text-brand-300";
  return (
    <div className="card p-4">
      <div className="text-xs muted uppercase tracking-wide">{label}</div>
      <div className={"text-2xl font-semibold mt-1 tabular-nums " + toneCls}>{formatSar(totals.total)}</div>
      <div className="text-xs muted mt-1">
        {fill(t("trips.invoiceSheet.totalCardSplit", lang), {
          subtotal: formatSar(totals.subtotal),
          vat: formatSar(totals.vat),
        })}
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
  lang,
  subtotalLabel,
  subtotal,
  chargesLabel,
  chargesSubtotal,
  vat,
  total,
}: {
  lang: Lang;
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
          <span className="muted">{t("trips.invoiceSheet.totalVat", lang)}</span>
          <span className="tabular-nums">{formatSar(vat)}</span>
        </div>
        <div className="flex items-center justify-between pt-2 mt-1 border-t border-app">
          <span className="font-semibold">{t("trips.invoiceSheet.grandTotal", lang)}</span>
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
  lang,
  hidden,
  busy,
  onToggle,
}: {
  lang: Lang;
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
      title={t("trips.invoiceSheet.hideDueTitle", lang)}
    >
      <span
        className={
          "relative inline-block h-4 w-7 rounded-full transition-colors " +
          (hidden ? "bg-[rgb(var(--border))]" : "bg-brand-600")
        }
      >
        {/* The knob is placed with inset-inline-start, not translate-x. It used
            to have no inset at all and slide with a physical translate, which
            works only while the static position is the left edge — in Arabic
            the static position is the RIGHT edge, so the "on" translate pushed
            the knob out of the track. The two offsets below are the same pixels
            the translates produced in LTR (2px and 14px on a 28px track holding
            a 12px knob), so English is unchanged. */}
        <span
          className={
            "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-[inset-inline-start] " +
            (hidden ? "start-0.5" : "start-3.5")
          }
        />
      </span>
      <span className="muted">
        {t(hidden ? "trips.invoiceSheet.hiddenFromCustomer" : "trips.invoiceSheet.visibleToCustomer", lang)}
      </span>
    </button>
  );
}

function GuardBox({
  lang,
  warning,
  busy,
  confirmLabel,
  confirmDisabled,
  onCancel,
  onConfirm,
}: {
  lang: Lang;
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
          {t("common.cancel", lang)}
        </Btn>
        <Btn
          variant="primary"
          onClick={onConfirm}
          className={busy || confirmDisabled ? "opacity-50 pointer-events-none" : "bg-rose-600 hover:bg-rose-700"}
        >
          {busy ? t("trips.invoiceSheet.working", lang) : confirmLabel}
        </Btn>
      </div>
    </div>
  );
}

// The rule between the Arabic and English blocks. ASCII hyphens deliberately:
// they are bidi-neutral, they need no font, and every plain-text client has
// them. A box-drawing or em-dash rule would depend on the recipient's glyph
// coverage, which is the one thing a mailto body cannot influence.
const MAIL_RULE = "------------------------------";

// Builds the mailto: URI for one of the 5 template types (the original four
// plus sales_return). mailto only controls "to"/subject/body — it cannot set
// the From address, so companyEmail is referenced in the signature only, never
// used as a sender, and it cannot carry an attachment or any styling at all.
//
// EVERY MAIL IS BILINGUAL, AND THIS FUNCTION IS NOT PASSED `lang`. Arabic
// block, rule, English block, always both, whichever language the operator was
// reading. It reads BOTH sides of each dictionary leaf rather than one.
//
// The two blocks are shaped differently on purpose — the English keeps its
// figures inline because that is the mail customers have always received, the
// Arabic puts every figure on its own line because a plain-text RTL line that
// trails off in a Latin number is where mail-client bidi visibly breaks and
// there is no `dir` attribute to pin it. Reasoning in full at the `emailBody`
// group header in lib/i18n.ts.
function buildMailtoFor(
  type: EmailType,
  raw: Invoice,
  view: View,
  customerEmail: string,
  companyEmail: string | null,
): string {
  const ref = raw.invoice_number ? `#${raw.invoice_number}` : `(draft, ${raw.period_start} to ${raw.period_end})`;
  const buyerName = view.buyerSnapshot?.name ?? "Customer";
  // THE ARABIC BLOCK ADDRESSES THE CUSTOMER IN ARABIC WHEN THE ROW HAS AN
  // ARABIC NAME. `arText()` is the app's one rule for a `*_ar` column — Arabic
  // only when the value is really there, non-null and non-empty AFTER a trim —
  // so a row saved with "  " addresses the customer by their base name instead
  // of opening the mail with a blank. The `"Customer"` stand-in for a snapshot
  // with no name at all is English on BOTH sides: it is not a name, and
  // inventing an Arabic one would say something the row does not.
  //
  // The lang argument is the literal "ar" because this block IS the Arabic one,
  // not because the app is in Arabic — `buildMailtoFor` never reads `lang`.
  const buyerNameAr = arText(buyerName, view.buyerSnapshot?.name_ar, "ar");
  const period = `${raw.period_start} to ${raw.period_end}`;
  const grand = formatSar(view.grand.total);
  const due = formatSar(view.amountDue.total);
  const returnedOn = raw.voided_at
    ? formatDate(raw.voided_at, { year: "numeric", month: "long", day: "numeric" })
    : null;

  // Same splice values on both sides except the two that HAVE a language:
  // `{buyer}`, resolved above, and `{date}`, whose missing-timestamp fallback is
  // a word rather than a date. Everything else — the reference, the period, both
  // figures — is one Latin string used by both blocks, so the two halves can
  // never quote different numbers. `fill()` leaves a token it cannot find alone,
  // so the Arabic sentences, which carry no tokens, pass through untouched.
  const valsEn = {
    buyer: buyerName,
    ref,
    period,
    grand,
    due,
    date: returnedOn ?? t("trips.invoice.emailBody.vRecently", "en"),
  };
  const valsAr = {
    ...valsEn,
    buyer: buyerNameAr,
    date: returnedOn ?? t("trips.invoice.emailBody.vRecently", "ar"),
  };
  const ar = (k: TKey) => fill(t(k, "ar"), valsAr);
  const en = (k: TKey) => fill(t(k, "en"), valsEn);

  // A subject is one line, so the label/value stacking the bodies use is not
  // available. The Arabic half therefore carries no data at all and the Latin
  // half carries it once: one pure Arabic run, one pure Latin run, nothing
  // straddling the join.
  const subjectOf = (k: TKey) => `${t(k, "ar")} | ${en(k)}`;

  // Arabic figure labels are the invoice sheet's own, so the mail names an
  // amount exactly as the document does.
  const lRef = t("trips.invoiceSheet.fInvoiceNo", "ar");
  const lPeriod = t("trips.invoiceSheet.fPeriod", "ar");
  // Only the `ar` side of these four is read. `grandTotal`'s English is the
  // sheet's "TOTAL"; the English block below spells "Grand Total:" inline as it
  // always has, so the two never meet.
  const lGrand = t("trips.invoiceSheet.grandTotal", "ar");
  const lDue = t("trips.invoiceSheet.amountDue", "ar");

  const greetAr = ar("trips.invoice.emailBody.greeting");
  const greetEn = en("trips.invoice.emailBody.greeting");
  const closeAr = ar("trips.invoice.emailBody.closing");
  // The English sign-off keeps the company line and address it has always had;
  // the Arabic block closes on its phrase alone, because the sender is named
  // once, underneath both blocks.
  const signature = [
    en("trips.invoice.emailBody.closing"),
    "Bin Slimah Group",
    companyEmail || FALLBACK_COMPANY_EMAIL,
  ];

  let subject: string;
  let arLines: (string | null)[];
  let enLines: (string | null)[];

  switch (type) {
    case "statement":
      subject = subjectOf("trips.invoice.emailBody.statement.subject");
      arLines = [
        greetAr,
        "",
        ar("trips.invoice.emailBody.statement.intro"),
        "",
        lPeriod,
        period,
        lRef,
        ref,
        lGrand,
        grand,
        lDue,
        due,
        "",
        ar("trips.invoice.emailBody.statement.outro"),
        "",
        closeAr,
      ];
      enLines = [
        greetEn,
        "",
        en("trips.invoice.emailBody.statement.intro"),
        "",
        `Invoice ${ref}`,
        `Grand Total: ${grand}`,
        `Amount Due: ${due}`,
        "",
        en("trips.invoice.emailBody.statement.outro"),
        "",
        ...signature,
      ];
      break;
    case "payment_due":
      subject = subjectOf("trips.invoice.emailBody.payment_due.subject");
      arLines = [
        greetAr,
        "",
        ar("trips.invoice.emailBody.payment_due.intro"),
        "",
        lRef,
        ref,
        lPeriod,
        period,
        lDue,
        due,
        "",
        ar("trips.invoice.emailBody.payment_due.outro"),
        "",
        closeAr,
      ];
      enLines = [
        greetEn,
        "",
        en("trips.invoice.emailBody.payment_due.intro"),
        "",
        `Amount Due: ${due}`,
        "",
        en("trips.invoice.emailBody.payment_due.outro"),
        "",
        ...signature,
      ];
      break;
    case "reminder":
      subject = subjectOf("trips.invoice.emailBody.reminder.subject");
      arLines = [
        greetAr,
        "",
        ar("trips.invoice.emailBody.reminder.intro"),
        "",
        lRef,
        ref,
        lPeriod,
        period,
        lDue,
        due,
        "",
        ar("trips.invoice.emailBody.reminder.outro"),
        "",
        closeAr,
      ];
      enLines = [
        greetEn,
        "",
        en("trips.invoice.emailBody.reminder.intro"),
        "",
        `Amount Due: ${due}`,
        "",
        en("trips.invoice.emailBody.reminder.outro"),
        "",
        ...signature,
      ];
      break;
    case "sales_return":
      subject = subjectOf("trips.invoice.emailBody.sales_return.subject");
      arLines = [
        greetAr,
        "",
        ar("trips.invoice.emailBody.sales_return.intro"),
        "",
        lRef,
        ref,
        t("trips.invoice.emailBody.fReturnDate", "ar"),
        valsAr.date,
        // `void_reason` is operator-entered free text of unknown script, which
        // is exactly why it gets a line to itself here rather than trailing an
        // Arabic sentence.
        raw.void_reason ? t("trips.invoice.emailBody.fReturnReason", "ar") : null,
        raw.void_reason || null,
        "",
        ar("trips.invoice.emailBody.sales_return.notice"),
        "",
        ar("trips.invoice.emailBody.sales_return.outro"),
        "",
        closeAr,
      ];
      enLines = [
        greetEn,
        "",
        en("trips.invoice.emailBody.sales_return.intro"),
        "",
        en("trips.invoice.emailBody.sales_return.notice"),
        raw.void_reason ? `Reason: ${raw.void_reason}` : null,
        "",
        en("trips.invoice.emailBody.sales_return.outro"),
        "",
        ...signature,
      ];
      break;
    case "generic":
    default:
      subject = subjectOf("trips.invoice.emailBody.generic.subject");
      arLines = [
        greetAr,
        "",
        ar("trips.invoice.emailBody.generic.intro"),
        "",
        lRef,
        ref,
        lPeriod,
        period,
        "",
        closeAr,
      ];
      enLines = [greetEn, "", en("trips.invoice.emailBody.generic.intro"), "", ...signature];
      break;
  }

  const body = [...arLines, "", MAIL_RULE, "", ...enLines].filter((l) => l !== null).join("\n");
  return `mailto:${encodeURIComponent(customerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
