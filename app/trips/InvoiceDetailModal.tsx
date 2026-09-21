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
// BOTH, deliberately. formatDateLang is the screen/print path; the plain
// formatDate survives for buildMailtoFor's exported email body, which stays
// English — see the note there.
import { formatDate, formatDateLang, formatNum, formatSar, todayKey } from "@/lib/utils";
import { canEditSpecialCharges } from "@/lib/invoice";
import { prepareUploadFiles } from "@/lib/upload-image";
import { round2 } from "@/lib/vat";
import { groupInvoiceLines } from "@/lib/invoiceDisplay";
import { buildBankBlock, type InvoiceLedgerDraw, type VmBankBlock } from "@/lib/invoiceViewModel";
import TripRefLink from "@/components/TripRefLink";
import { printHtml } from "@/lib/printHtml";
import {
  type Invoice,
  type InvoiceLineSnapshot,
  type WaterType,
  type PaymentMode,
} from "@/lib/db-types";
// The 0203 row shapes, imported as TYPES only. This screen never queries the
// ledger model itself — lib/customer-ledger.ts is its one reader and
// getInvoice() is the one call site; these names exist here so the payload
// that arrives has a shape the compiler can hold us to.
import type { InvoicePaymentRow, InvoiceSettlementRow } from "@/lib/customer-ledger";
import {
  getInvoice,
  previewInvoice,
  addSpecialCharge,
  removeSpecialCharge,
  setInvoiceReview,
  revertInvoiceToDraft,
  confirmInvoice,
  voidInvoice,
  // markInvoicePaid IS GONE FROM THE LEDGER ERA, and the two names that replace
  // it are not a rename: they are the two things it used to be at once. It sent
  // a full-amount pay_invoice() for postpaid AND a `balance` settlement for
  // prepaid, so "record that money arrived" and "draw down the customer's
  // balance" shared one button, one FormData and one RPC. 0203 split them:
  // money arriving is invoice_payments (partial, repeatable, append-only),
  // drawing the balance is a customer_ledger row. Two acts, two actions.
  recordInvoicePayment,
  applyBalanceToInvoice,
  // …and the old act survives for the old rows, under a name that says so. The
  // 0203 RPCs REFUSE an invoice confirmed before them (no frozen payable to
  // count a partial payment down against), so without this every already-
  // confirmed, unpaid invoice would lose its settle button. Offered only when
  // era === "legacy". Never widen it.
  markInvoicePaidLegacy,
  unpayInvoice,
  deleteDraftInvoice,
  getProofSignedUrl,
  // Per-PAYMENT slip. The invoice-level signer above reads the single legacy
  // column; a ledger invoice can carry several slips, one per arrival.
  getPaymentProofSignedUrl,
  getCompanyEmail,
  getInvoicePdf,
  getInvoicePrintHtml,
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
// DisplayLedgerTotals LIVED HERE and is not coming back, even though the three
// footer rows it fed are. It widened the engine's ledger shape to
// `balance: number | null` so a pre-0036 legacy invoice — frozen before the
// ledger snapshot columns existed, never backfilled — could print "—" instead
// of a fabricated 0 for a CHAINED running balance read off those columns.
// Nothing reads those columns now: the balance row is fed by the paid-up
// balance, which is available on every row regardless of when it froze, so the
// legacy special case has nothing left to special-case. The subtotals come from
// `tripTotals`; the balance rides in on `paidUpBalanceSar`.
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
  // Prepaid only — the Covered/Unpaid trips tables' one foot figure each, the
  // VAT-INCLUSIVE subtotal of that table. undefined for postpaid. Always
  // populated for prepaid (draft/review from the live engine, confirmed/paid
  // from the frozen snapshot columns, legacy pre-0036 rows from the frozen
  // document totals — see refresh() below).
  //
  // NO BALANCE TERM HERE, and the footer's balance row is not an argument for
  // adding one. A `balance`/`remaining` pair used to sit beside each of these
  // and CHAIN a per-invoice running balance across the two tables — covered's
  // remainder seeding unpaid's balance — off frozen `*_ledger_balance_sar`
  // columns. That mechanism is deleted. The rows are still on the page, fed by
  // the paid-up balance (`raw.paidUpBalanceSar`, one shared expression), which
  // is why it does not travel with the subtotals: it is not a per-table figure.
  tripTotals?: { covered: number; unpaid: number };
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
    // bank_accounts added by migration 0184, same `select("*")` free ride.
    //
    // `unknown`, matching CompanySettings: 0184's CHECK guarantees an array of
    // at most 3 and says nothing about what is IN it, so the only safe reader
    // is lib/bankAccounts' parse — reached here through buildBankBlock, which
    // is the same expression the downloadable PDF calls.
    bank_accounts: unknown;
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

// printHtml MOVED to lib/printHtml.ts when the statement's print path was
// repointed onto its own document — two callers, one copy. Imported above.

export default function InvoiceDetailModal({
  open,
  invoiceId,
  customerEmail,
  onClose,
  onBack,
  onMutated,
  readOnly = false,
}: {
  open: boolean;
  invoiceId: string | null;
  customerEmail: string | null;
  // `settledBalance` REMOVED. It was the Finance tab's per-row figure, passed
  // down the prop chain so the "Pay with Balance" panel could show a draw-down.
  // The popup now reads the paid-up balance off its OWN getInvoice payload,
  // which is the single shared expression — a prop carrying a second copy of a
  // money figure through two components is exactly how the two ended up able to
  // disagree. Do not reinstate it.
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
  // paidUpBalanceSar rides on `raw` because it comes from getInvoice, which is
  // the ONE call site of the paid-up read (loadPaidUpBalance) in this path. The
  // popup never computes a balance of its own — that is the entire point of the
  // running-balance removal. null = postpaid, or a fetch that failed.
  const [raw, setRaw] = useState<
    | (Invoice & {
        projectWaterType: WaterType | null;
        projectPaymentMode: PaymentMode;
        paidUpBalanceSar: number | null;
        settlementSar: number | null;
        paidUpError: string | null;
        // --- LEDGER ERA (0203) ----------------------------------------------
        // Which body of law this invoice is settled under, decided server-side
        // by invoiceEra() off the frozen amount_payable_sar. NOT a status test
        // and NOT a date test: 0203's confirm freezes a payable in BOTH payment
        // modes, so a null on a confirmed row means exactly one thing — it was
        // confirmed before 0203 and keeps the covered/unpaid split forever.
        era: "ledger" | "legacy";
        // The ONE source for "how much of this invoice is still outstanding".
        // Never derived here from status / payment_method / paid_at: those are
        // display-only history since 0203, and a partially-paid invoice still
        // reads `confirmed` with a null payment_method.
        settlement: InvoiceSettlementRow | null;
        // Every recorded payment against this invoice, oldest first. Empty is a
        // real answer (nobody has paid yet); a failed read is also empty, which
        // is why the panel's figures come from `settlement` and this array is
        // only ever a HISTORY list — it is never summed into a balance.
        payments: InvoicePaymentRow[];
        // The customer's Available balance RIGHT NOW (prepaid only, null for
        // postpaid or a failed read). Live, not frozen — it is what a
        // post-confirm apply-balance would draw against, so it must not be
        // confused with prepaid_applied_sar, which froze at confirm.
        availableSar: number | null;
        // The customer's ledger BALANCE right now (prepaid only, null for
        // postpaid or a failed read). Distinct from availableSar above:
        // balance is everything on the ledger, available is that balance less
        // what is already spoken for (uninvoiced work plus the unsettled
        // remainder of confirmed invoices). The trips foot shows the balance
        // because that is the figure the customer recognises; the apply panel
        // shows available because that is what can actually move.
        ledgerDraw: InvoiceLedgerDraw;
      })
    | null
  >(null);
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
  // PARTIAL PAYMENTS MEAN THE AMOUNT IS AN INPUT. It was never one before: the
  // old path paid the whole invoice or nothing, so the figure was implied by
  // the button. record_invoice_payment takes any amount up to the remainder,
  // so it is typed — CONTROLLED (not FormData-only like the reference/date
  // beside it) because the field is pre-filled with the outstanding remainder
  // and the "pay it all" case must be one click, not a re-typing exercise.
  const [payAmount, setPayAmount] = useState("");
  // Reference, date and proof are CONTROLLED TOO (0204, item 10). They used to
  // be read from FormData at submit and gated by nothing but the `required`
  // attribute, which is enough to stop a submission and useless for saying
  // WHAT is missing before one is attempted — the operator filled the form,
  // pressed the button, and met either a browser bubble on one field at a time
  // or record_invoice_payment's own raise after the round trip. Holding the
  // three values in state lets the gate below name every gap at once, while
  // the form is still on screen and still fixable.
  //
  // The RPC enforces the identical rule and remains the authority; this is the
  // courtesy layer in front of it, not a substitute for it.
  const [payReference, setPayReference] = useState("");
  const [payDate, setPayDate] = useState("");
  const [payProof, setPayProof] = useState<File | null>(null);
  // Forces the (still uncontrolled, as file inputs must be) proof picker to
  // remount and clear — same technique as chargeImageInputKey above.
  const [payProofInputKey, setPayProofInputKey] = useState(0);
  // MARK PAID's one confirmation. Not a form — apply_balance_to_invoice takes
  // no amount at all (it draws min(Available + remainder, remainder) under its
  // own row lock). This flag only opens the panel that STATES the amount about
  // to leave the balance before the ledger row is written.
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
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

  // Print. Its OWN pair, not the download's: the two now produce two different
  // documents through two different paths (this one renders HTML and never
  // touches the PDF provider), so sharing the error state would report a failed
  // print in the download button's tooltip and send the operator to the wrong
  // button.
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  // RETURNS WHAT IT LOADED, as well as storing it. Mark Paid is a COMPOSED
  // action — apply the balance, then look at what is left and decide whether a
  // payment form is still needed — and `raw` is state, so it does not change
  // until the next render. Reading the decision off the returned row keeps the
  // whole sequence on one set of figures; reading it off `raw` would branch on
  // the settlement as it stood BEFORE the draw.
  async function load(): Promise<typeof raw> {
    if (!invoiceId) return null;
    setLoading(true);
    setError(null);
    const r = await getInvoice(invoiceId);
    if (r.error || !r.data) {
      setError(r.error ?? t("trips.invoice.errLoad", lang));
      setLoading(false);
      return null;
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
        return null;
      }
      setView({
        paymentMode: p.data.paymentMode,
        coveredLines: p.data.coveredLines,
        unpaidLines: p.data.unpaidLines,
        chargeLines: p.data.chargeLines,
        covered: p.data.covered,
        amountDue: p.data.amountDue,
        grand: p.data.grand,
        tripTotals: p.data.tripTotals,
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
      // The two `*_ledger_subtotal_sar` columns keep their 0036 names — they
      // are stored money and renaming a column that holds frozen figures is a
      // migration, not a refactor. Only the two balance/remaining pairs beside
      // them went dead; future confirms write null into those (see
      // invoiceActions.ts's confirm payload).
      const hasTripTotalsSnapshot =
        r.data.covered_ledger_subtotal_sar != null && r.data.unpaid_ledger_subtotal_sar != null;
      setView({
        paymentMode,
        coveredLines: r.data.covered_lines ?? [],
        unpaidLines: r.data.unpaid_lines ?? [],
        chargeLines: paymentMode === "prepaid" ? (r.data.special_charges_snapshot ?? []) : [],
        covered: { subtotal: r.data.covered_subtotal_sar, vat: r.data.covered_vat_sar, total: r.data.covered_total_sar },
        amountDue: { subtotal: r.data.amount_due_subtotal_sar, vat: r.data.amount_due_vat_sar, total: r.data.amount_due_sar },
        grand: { subtotal: r.data.grand_subtotal_sar, vat: r.data.grand_vat_sar, total: r.data.grand_total_sar },
        tripTotals:
          paymentMode === "prepaid"
            ? hasTripTotalsSnapshot
              ? { covered: r.data.covered_ledger_subtotal_sar!, unpaid: r.data.unpaid_ledger_subtotal_sar! }
              : // Pre-migration-0036 legacy invoice — the snapshot columns did
                // not exist when it froze and are never backfilled. Both
                // subtotals are still REAL figures, read off the frozen
                // document totals that do exist on the row.
                //
                // `amount_due_sar` IS the unpaid trips subtotal for the whole
                // of that era, because Amount Due was trips-only then; the
                // stranded-charge fix later widened it to include uncovered
                // special charges, so the two are NOT equal on anything
                // confirmed after that. This is not a general identity — it
                // holds only for the legacy rows this arm can fire on. See
                // lib/invoice.ts's AMOUNT DUE header note.
                { covered: r.data.covered_total_sar, unpaid: r.data.amount_due_sar }
            : undefined,
        sellerSnapshot: r.data.seller_snapshot,
        buyerSnapshot: r.data.buyer_snapshot,
        projectWaterType: r.data.projectWaterType,
      });
    }
    setLoading(false);
    return r.data;
  }

  useEffect(() => {
    if (!open || !invoiceId) return;
    setActionError(null);
    setConfirmingConfirm(false);
    setVoiding(false);
    setVoidReason("");
    setPayingOpen(false);
    setPayMethod("cash");
    setPayAmount("");
    setMarkPaidOpen(false);
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
    setPrintError(null);
    load();
    getCompanyEmail().then((r) => setCompanyEmail(r.data?.email ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId]);

  async function refresh() {
    await load();
    onMutated();
    router.refresh();
  }

  // PRINT — a document of its own, no longer this popup on paper.
  //
  // What this replaces: `document.body.classList.add("printing-invoice")` plus
  // a globals.css `@media print` block that hid every element on the page
  // except this modal, flattened the overlay, and printed the live React DOM.
  // It agreed with the screen by BEING the screen — which meant it printed an
  // application window: screen layout, screen number formats (whole riyals, not
  // the tax document's halalas), and controls suppressed one by one with
  // `no-print` classes that had to be maintained by hand forever.
  //
  // Now the server renders the same view-model the download renders
  // (lib/invoicePrintTemplate.ts) and the browser prints THAT. Agreement with
  // the screen is no longer a property of the markup; it is a property of the
  // shared view-model, which is where it belongs.
  async function handlePrint() {
    if (!invoiceId || printing) return;
    setPrinting(true);
    setPrintError(null);
    const r = await getInvoicePrintHtml(invoiceId);
    setPrinting(false);
    if (r.error || !r.data) {
      setPrintError(r.error ?? t("trips.invoice.errPrint", lang));
      return;
    }
    printHtml(r.data.html);
  }

  // Ctrl/Cmd+P is intercepted, and it HAS to be.
  //
  // globals.css opens its print block with `body * { visibility: hidden }` and
  // then whitelists specific report subtrees. The invoice used to be on that
  // whitelist; it deliberately is not any more. So a raw browser print with
  // this modal open would now resolve to a legally blank sheet — the worst
  // possible failure, because it looks like the printer's fault.
  //
  // Routing the shortcut to handlePrint() also makes the keyboard and the
  // button emit the same document, which is what anyone pressing Ctrl+P in
  // front of an invoice means. Capture phase so nothing swallows it first.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "p" && e.key !== "P") return;
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.altKey || e.shiftKey) return;
      e.preventDefault();
      void handlePrint();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId, printing, lang]);

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

  // The hide toggle saves and re-reads IN PLACE — deliberately NOT runAction().
  // runAction ends in refresh() → onMutated() + router.refresh(), the full
  // list-and-page reload a money action needs; this flag is a display
  // preference no server-rendered surface reads (app/trips/page.tsx's invoice
  // selects carry no hide_amount_due), and that global reload is what closed
  // this popup under the operator mid-toggle. Save, re-read this ONE invoice
  // so the switch reflects the stored state, stay open.
  async function toggleHideAmountDue() {
    if (!invoiceId || !raw) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await setHideAmountDue(invoiceId, !raw.hide_amount_due);
      if (res.error) {
        setActionError(res.error);
        return;
      }
      await load();
    } catch {
      setActionError(t("shared.upload.saveFailedNetwork", lang));
    } finally {
      setBusy(false);
    }
  }

  async function runAction(fn: () => Promise<{ error: string | null }>) {
    setBusy(true);
    setActionError(null);
    // try/catch: a network drop mid-await otherwise leaves the button stuck
    // on busy with no message — the finally owns the busy flag now.
    try {
      const res = await fn();
      if (res.error) {
        setActionError(res.error);
        return false;
      }
      await refresh();
      return true;
    } catch {
      setActionError(t("shared.upload.saveFailedNetwork", lang));
      return false;
    } finally {
      setBusy(false);
    }
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
    // try/catch: a network drop mid-await otherwise leaves the button stuck
    // on busy with no message — the finally owns the busy flag now.
    try {
      const res = await addSpecialCharge(invoiceId, chargeLabel.trim(), chargeDate || null, qty, price);
      if (res.error || !res.data) {
        setActionError(res.error ?? t("trips.invoice.errAddCharge", lang));
        return;
      }
      if (chargeImageFile) {
        // Already PREPARED at pick time (onPickChargeImage) — this is the
        // compressed WebP, not the raw camera bytes.
        const form = new FormData();
        form.set("imageFile", chargeImageFile);
        const imgRes = await uploadSpecialChargeImage(invoiceId, res.data.id, form);
        if (imgRes.error) {
          // Charge itself was added fine — surface the image failure but don't
          // discard the successful add; the row can still get an image later.
          setActionError(fill(t("trips.invoice.errChargeImage", lang), { err: imgRes.error }));
        }
      }
      setChargeLabel("");
      setChargeDate(todayKey());
      setChargeQty("1");
      setChargePrice("");
      setChargeImageFile(null);
      setChargeImageInputKey((k) => k + 1);
      await refresh();
    } catch {
      setActionError(t("shared.upload.saveFailedNetwork", lang));
    } finally {
      setAddingCharge(false);
    }
  }

  // Pick-time preparation for the add-charge form's staged image: compress to
  // WebP (orientation kept), refuse undecodable or still-over-10MB picks by
  // name, and remount the input so the same file can be re-picked. Passed to
  // SpecialChargesSection as its setChargeImageFile — the child stays dumb.
  function onPickChargeImage(f: File | null) {
    if (!f) {
      setChargeImageFile(null);
      return;
    }
    void (async () => {
      const r = await prepareUploadFiles([f]);
      if (!r.ok) {
        setChargeImageFile(null);
        setChargeImageInputKey((k) => k + 1);
        setActionError(fill(t(r.errorKey, lang), { name: r.name }));
        return;
      }
      setActionError(null);
      setChargeImageFile(r.files[0] ?? null);
    })();
  }

  async function onUploadChargeImage(chargeId: string, file: File) {
    if (!invoiceId) return;
    // The row-attach path hands over the RAW pick — prepare it here before it
    // travels (compress image, refuse undecodable/oversize by name).
    const r = await prepareUploadFiles([file]);
    if (!r.ok) {
      setActionError(fill(t(r.errorKey, lang), { name: r.name }));
      return;
    }
    const prepared = r.files[0];
    if (!prepared) return;
    const form = new FormData();
    form.set("imageFile", prepared);
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
    try {
      const res = await updateDraftInvoicePeriod(invoiceId, periodStartInput, periodEndInput);
      if (res.error) {
        setPeriodError(res.error);
        return;
      }
      setEditingPeriod(false);
      await refresh();
    } catch {
      setPeriodError(t("shared.upload.saveFailedNetwork", lang));
    } finally {
      setSavingPeriod(false);
    }
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

  // Same act, keyed by PAYMENT instead of invoice — the history list below can
  // hold several slips and each row opens its own. Kept as a separate function
  // rather than a parameterised one because the two read different columns in
  // different tables; merging them would mean a caller choosing a branch, and
  // the branch it would choose is the era test this screen deliberately makes
  // only once.
  async function onViewPaymentProof(paymentId: string) {
    const r = await getPaymentProofSignedUrl(paymentId);
    if (r.error || !r.data) {
      setActionError(r.error ?? t("trips.invoice.errProof", lang));
      return;
    }
    window.open(r.data.url, "_blank", "noopener,noreferrer");
  }

  // Deletion removes the row entirely — draft OR review since 0182, releasing
  // its reserved trips and, through the charges' ON DELETE CASCADE, the prepaid
  // balance they were holding. Unlike every other action here, refresh()/load()
  // would fail afterward since invoiceId no longer resolves, so this goes
  // straight back to the invoice list instead.
  async function onDeleteDraft() {
    if (!invoiceId) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await deleteDraftInvoice(invoiceId);
      if (res.error) {
        setActionError(res.error);
        return;
      }
      onMutated();
      onBack();
    } catch {
      setActionError(t("shared.upload.saveFailedNetwork", lang));
    } finally {
      setBusy(false);
    }
  }

  // RECORD A PAYMENT — one arrival of money against this invoice, for ANY
  // amount up to the outstanding remainder. This is the whole pay path now, in
  // both payment modes: a prepaid invoice whose balance did not cover it is
  // collected exactly like a postpaid one, because at that point it is the same
  // fact — the customer owes cash and some of it turned up.
  //
  // WHAT IT NO LONGER DOES: flip the invoice to `paid` and write
  // payment_method/paid_at as the record of settlement. record_invoice_payment
  // inserts an invoice_payments row and lets v_invoice_settlement decide what
  // is left; the status only moves to `paid` when the remainder reaches zero,
  // which may be this payment, the third one, or an apply-balance afterwards.
  //
  // The amount rides in the FormData like everything else here rather than
  // being passed as an argument, so the server action keeps ONE input shape and
  // one place to refuse a bad one.
  async function onRecordPayment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!invoiceId) return;
    const form = new FormData(e.currentTarget);
    form.set("invoiceId", invoiceId);
    setBusy(true);
    setActionError(null);
    // try/catch: a network drop mid-await otherwise leaves the button stuck
    // on busy with no message — the finally owns the busy flag now.
    try {
      // The proof input is uncontrolled (read straight off the form), so the
      // image is prepared HERE, at submit: compressed WebP replaces the raw
      // bytes in the FormData; a PDF slip passes through untouched; an
      // undecodable or still-over-10MB file is refused by name before any
      // network leaves.
      const proof = form.get("proofFile");
      if (proof instanceof File && proof.size > 0) {
        const r = await prepareUploadFiles([proof]);
        if (!r.ok) {
          setActionError(fill(t(r.errorKey, lang), { name: r.name }));
          return;
        }
        const prepared = r.files[0];
        if (prepared) form.set("proofFile", prepared);
      }
      const res = await recordInvoicePayment(form);
      if (res.error) {
        setActionError(res.error);
        return;
      }
      setPayingOpen(false);
      resetPayForm();
      await refresh();
    } catch {
      setActionError(t("shared.upload.saveFailedNetwork", lang));
    } finally {
      setBusy(false);
    }
  }

  // Clears every field of the ledger payment form. One function because the
  // four pieces of state are one form, and a stale reference or slip surviving
  // into the NEXT payment on the same invoice is the kind of error nobody
  // catches: the figures would be right and the evidence would belong to a
  // different transfer.
  function resetPayForm() {
    setPayAmount("");
    setPayReference("");
    setPayDate("");
    setPayProof(null);
    setPayProofInputKey((k) => k + 1);
  }

  // LEGACY SETTLEMENT — the pre-0203 full-amount path, unchanged in behaviour
  // and reachable only when era === "legacy".
  //
  // It is not kept for symmetry. record_invoice_payment() RAISES on an invoice
  // with no frozen amount_payable_sar, and 0203 backfills nothing, so every
  // invoice confirmed before it has no ledger-era way to be settled — deleting
  // this would strand real receivables behind a screen with no button. These
  // rows keep the law they were frozen under until they are all closed.
  //
  // Two entry points because the old path had two: a full form for cash/bank,
  // and a bare confirmation for the prepaid `balance` method, which moves no
  // money and therefore asks for no reference, date or slip. Both reach the
  // same server action, and 0134's own guard still decides who may send
  // 'balance'.
  async function onLegacyPay(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!invoiceId) return;
    const form = new FormData(e.currentTarget);
    form.set("invoiceId", invoiceId);
    setBusy(true);
    setActionError(null);
    try {
      const proof = form.get("proofFile");
      if (proof instanceof File && proof.size > 0) {
        const r = await prepareUploadFiles([proof]);
        if (!r.ok) {
          setActionError(fill(t(r.errorKey, lang), { name: r.name }));
          return;
        }
        const prepared = r.files[0];
        if (prepared) form.set("proofFile", prepared);
      }
      const res = await markInvoicePaidLegacy(form);
      if (res.error) {
        setActionError(res.error);
        return;
      }
      setPayingOpen(false);
      await refresh();
    } catch {
      setActionError(t("shared.upload.saveFailedNetwork", lang));
    } finally {
      setBusy(false);
    }
  }

  async function onLegacyPayBalance() {
    if (!invoiceId) return;
    const form = new FormData();
    form.set("invoiceId", invoiceId);
    form.set("paymentMethod", "balance");
    const ok = await runAction(() => markInvoicePaidLegacy(form));
    if (ok) setPayingOpen(false);
  }

  // MARK PAID — THE one settlement action on a ledger-era confirmed invoice.
  //
  // It is composed, not new: the balance draw and the cash receipt are the two
  // money doors 0204 built, and this walks the operator through them in the
  // order the money actually moves. What it replaces is a screen that offered
  // both doors side by side and made the operator decide which one settlement
  // needed — a question only the figures can answer, and they are on the server.
  //
  //   1. Draw whatever the balance can cover (prepaid, and only when there is
  //      something to draw). NO AMOUNT IS SENT: apply_balance_to_invoice()
  //      computes it under the customer row lock. An amount decided here would
  //      be a second opinion on the balance, read a moment before the write.
  //   2. Re-read. Remainder at zero means the RPC already flipped the invoice
  //      to paid and there is nothing further to ask for.
  //   3. Anything still outstanding is cash the customer owes, so the payment
  //      form opens pre-filled with exactly that — which is the same form a
  //      postpaid invoice goes straight to, because by then it is the same fact.
  //
  // THE RE-READ USES load()'s RETURN, not `raw`. `raw` is state and still holds
  // the pre-draw settlement at this point, so branching on it would offer a
  // payment form for an invoice that just went paid, or skip one that did not.
  //
  // EVERY REFUSAL IS THE SERVER'S OWN SENTENCE. Nothing here interprets an RPC
  // error or substitutes a friendlier one: the reasons it can raise (wrong
  // status, wrong mode, nothing to apply) are distinctions the operator needs
  // in the database's own words.
  async function onMarkPaid() {
    if (!invoiceId) return;
    setBusy(true);
    setActionError(null);
    try {
      // The cash-only paths — postpaid, an unusable balance, or a prepaid
      // customer whose Available cannot cover a halala of this invoice. No
      // draw is attempted because the RPC would refuse one ("Nothing to
      // apply"), and a refusal the screen could have predicted is noise.
      if (!isPrepaid || markPaidDraw == null || markPaidDraw <= 0) {
        setMarkPaidOpen(false);
        setPayAmount(remainderSar != null ? String(remainderSar) : "");
        setPayingOpen(true);
        return;
      }

      const res = await applyBalanceToInvoice(invoiceId);
      if (res.error) {
        setActionError(res.error);
        return;
      }
      const fresh = await load();
      onMutated();
      router.refresh();

      const left = fresh?.settlement?.remainder_sar ?? null;
      setMarkPaidOpen(false);
      // A null remainder here is a READ that failed, not a settled invoice, so
      // it must not close the flow as though the invoice were paid. The form
      // opens with an empty amount and the operator types what arrived.
      if (left != null && left <= 0) return;
      setPayAmount(left != null ? String(left) : "");
      setPayingOpen(true);
    } catch {
      setActionError(t("shared.upload.saveFailedNetwork", lang));
    } finally {
      setBusy(false);
    }
  }

  if (!open || !invoiceId || !mounted) return null;

  const status = raw?.status;
  // The two statuses discard_invoice accepts since 0182 — an unfinalised
  // invoice that still HOLDS its reserved trips and, through its special
  // charges, a prepaid customer's balance. Named once so the button and its
  // guard cannot drift apart, and so this reads as one rule rather than the
  // same disjunction typed twice. Matches `isUnfinalized` in InvoicesModal;
  // both exist because the RPC is the single authority on which statuses can
  // be discarded, and neither screen may offer a control it would reject.
  const canDiscard = status === "draft" || status === "review";
  // readOnly folds in here rather than at each call site: `editable` already
  // governs every special-charge mutation, so one AND covers the add form,
  // the remove buttons and the image upload together, with no chance of a
  // fourth write path being added later and missing the gate.
  const editable = raw && !readOnly ? canEditSpecialCharges(raw.status) : false;
  const canEmail = !!(raw && view && customerEmail);

  const isPrepaid = view?.paymentMode === "prepaid";

  // ===========================================================================
  // LEDGER ERA (0203) — which law this invoice is settled under, and the facts
  // that law provides.
  // ===========================================================================
  // `isLedger` is a payload field, not a test performed here, precisely so this
  // screen cannot invent a fourth definition of "which era". It is false for
  // exactly one thing: an invoice confirmed before 0203, which has no frozen
  // payable and keeps the covered/unpaid document plus the old full-amount pay
  // button forever. Drafts are always ledger — they have not frozen anything
  // yet, so there is nothing old about them.
  const isLedger = raw?.era === "ledger";

  // v_invoice_settlement for THIS invoice. THE source of "what is outstanding",
  // and the ONLY one: invoices.status, payment_method and paid_at are
  // display-only history since 0203 — a half-paid invoice still reads
  // `confirmed` with a null payment_method, so reading those to answer this
  // question gives the wrong answer confidently.
  const settlement = raw?.settlement ?? null;
  // A null `payable_sar` on a CONFIRMED row means the read failed (era already
  // told us it is not legacy), so the panel refuses rather than printing zeros.
  // On a draft it is the normal, correct state: nothing has been frozen.
  const settlementReadable = isLedger && settlement != null && settlement.payable_sar != null;
  const remainderSar = settlementReadable ? (settlement!.remainder_sar ?? 0) : null;
  // Recorded payments, oldest first — a HISTORY list, never summed into a
  // figure. Every amount the panel shows comes from the view, which does the
  // summing in SQL under the same lock the writes take.
  const payments = raw?.payments ?? [];
  // The customer's Available balance right now (prepaid only). LIVE, and not to
  // be confused with prepaid_applied_sar beside it, which froze at confirm:
  // this is what a post-confirm apply-balance would have to draw from.
  const availableSar = raw?.availableSar ?? null;
  // WHAT MARK PAID WILL TAKE OFF THE BALANCE — apply_balance_to_invoice()'s own
  // arithmetic, previewed. Null when either side is unreadable, never zero:
  // "nothing to draw" and "we could not find out" are different answers and
  // only one of them is a reason to send the operator straight to the cash
  // form.
  //
  // THE ADD-BACK IS THE WHOLE POINT, and its absence was a real defect. Since
  // 0204 `v_customer_available` RESERVES the unsettled remainder of every
  // confirmed ledger invoice — including this one — so Available is already
  // this invoice's own debt lighter. A plain min(Available, remainder)
  // therefore UNDERSTATES every draw and reads negative on exactly the common
  // case: balance 300 against a remainder of 400 shows Available −100, so the
  // panel promised nothing while the RPC went on to draw the whole 300.
  // Migration 0204 adds the invoice's own remainder back before capping, and
  // this line is that same expression — not an approximation of it:
  //
  //     draw = min(Available + remainder, remainder)
  //
  // It is a FORECAST, never an instruction. Nothing sends it: the RPC re-reads
  // under the customer row lock and its answer is the one that lands.
  const markPaidDraw =
    availableSar == null || remainderSar == null
      ? null
      : Math.max(0, round2(Math.min(round2(availableSar + remainderSar), remainderSar)));

  // UN-PAY'S GATE, mirroring unpay_invoice()'s two guards exactly (0203 §12):
  // no invoice_payments rows, and no balance_applied ledger rows. Both are
  // reversals the RPC refuses to make because the money genuinely moved — a
  // recorded payment is cash that arrived, an applied balance is a ledger row
  // with a date on it. Void is the correct undo for both, and it reverses the
  // ledger itself while leaving the payments standing.
  //
  // THE UI GATE IS A COURTESY, NOT THE RULE. The RPC raises its own sentence
  // either way and runAction surfaces it verbatim; this just stops the operator
  // opening a reason box for an action that cannot succeed.
  const unpayBlocked = payments.length > 0 || (settlement != null && settlement.applied_sar > 0);

  // THE paid-up balance, straight off the server payload. Server-side it is
  // ONE expression (invoiceActions' loadPaidUpBalance — the ledger balance,
  // frozen at paid_at/voided_at as the rows that existed by then), so this screen, the PDF
  // and the print document cannot disagree. A partial figure is never shown.
  //
  // THE TWO NULLS ARE NOT THE SAME NULL. `paidUpError` set means the read
  // FAILED; `paidUp` null with no error means postpaid, where there is nothing
  // to show. Collapsing them is what let a broken query render as a prepaid
  // invoice with no balance line and no complaint.
  const paidUp = raw?.paidUpBalanceSar ?? null;
  const paidUpError = raw?.paidUpError ?? null;
  // UNREADABLE = no figure, whatever the reason. Confirm on the pay-with-balance
  // panel needs the FIGURE, not merely the absence of an error: a prepaid
  // invoice whose balance came through null with no error reported is exactly
  // the case that rendered a full prepaid layout with no balance in it.
  const paidUpUnreadable = paidUpError != null || paidUp == null;
  // What paying this invoice will take off that balance, computed server-side
  // by the SAME expression the payment itself will apply (lib/money's
  // settlementGross over this invoice's own rows). The panel below
  // subtracts THIS, never `view.grand.total`: on an invoice frozen by the
  // covered-only engine the stored grand total excludes lines the document
  // lists, so it previewed a draw-down the payment then did not make.
  const settlementSar = raw?.settlementSar ?? null;
  // Same three-outcome discipline as the balance: a missing draw-down is a
  // failed read, never a zero. Both figures come from one server read, so this
  // only diverges from `paidUpUnreadable` on a postpaid row, where the panel
  // does not render at all.
  const payPreviewUnreadable = paidUpUnreadable || settlementSar == null;
  // What the trips tables' BALANCE ROW renders: the figure, or the reason there
  // isn't one. Never blank, and never a fabricated 0 — the two are different
  // content, so they are different shapes, decided here once for both tables.
  //
  // ONE value for BOTH tables, deliberately NOT chained. The rows this restores
  // used to walk a balance across the two tables, covered's Remaining seeding
  // unpaid's Balance; that walk is the deleted mechanism, and re-deriving it
  // from the paid-up figure would rebuild it under a new name.
  const balanceRow: { amount: number } | { note: string } = paidUpUnreadable
    ? { note: t("trips.invoiceSheet.paidUpUnavailable", lang) }
    : { amount: paidUp as number };
  // Balance minus that table's own VAT-inclusive subtotal — the same
  // subtraction the pay-with-balance panel already shows, on two figures
  // already decided. null when the balance is unreadable: there is nothing to
  // subtract from, and a lone "0" here would read as a real remainder.
  const remainingAfter = (subtotal: number) => (paidUpUnreadable ? null : round2((paidUp as number) - subtotal));

  // --- LEDGER-ERA BALANCE ROW ----------------------------------------------
  // The same pair of rows, fed by the OTHER era's money. A ledger-era prepaid
  // invoice has no paid-up figure — the retired pool expression answered a
  // question 0203 stopped asking — so both figures come off the `balance_applied`
  // ledger rows for THIS invoice: the balance immediately before the draw and
  // immediately after it, the last draw winning when there were several.
  //
  // THIS SCREEN DOES NOT COMPUTE THEM. `ledgerDraw` arrives already walked by
  // invoiceActions' ledgerDrawFrom(), the same call the document makes, so the
  // popup and the PDF cannot report different balances for one instant. It
  // used to read a live `balance_sar` and subtract this table's subtotal —
  // two inventions at once, since a balance does not fall by a subtotal, it
  // falls by whatever was actually drawn.
  //
  // THREE STATES, and the middle one is the common case under 0204: an invoice
  // nothing has been drawn against yet prints an em-dash on both rows, because
  // there is no moment to report rather than a zero to report.
  const ledgerDraw: InvoiceLedgerDraw = raw?.ledgerDraw ?? { state: "unreadable" };
  const ledgerBalanceRow: { amount: number } | { note: string } | null =
    ledgerDraw.state === "drawn"
      ? { amount: ledgerDraw.balanceBefore }
      : ledgerDraw.state === "none"
        ? null
        : { note: t("trips.invoiceSheet.paidUpUnavailable", lang) };
  const ledgerRemaining = ledgerDraw.state === "drawn" ? ledgerDraw.balanceAfter : null;

  // --- WHAT THE PAYMENT FORM IS STILL MISSING (0204, item 10) --------------
  // A bank transfer is a real transaction somewhere else, and the only thing
  // making it auditable here is the trio that points at it: a reference, the
  // date the money moved, and a picture of the slip. record_invoice_payment()
  // RAISES when any of the three is absent, which is correct and arrives far
  // too late — after the round trip, on a form the operator has usually
  // already stopped looking at.
  //
  // This is that same rule, stated forward instead of backward: every gap at
  // once, while the fields are on screen. Cash asks for none of it (the money
  // changed hands here, and the receipt is this row), so the list is empty and
  // the button is live as soon as there is an amount.
  //
  // THE RPC REMAINS THE AUTHORITY. This list is not consulted by anything that
  // writes; it only decides whether the submit button is offered, and its
  // refusal message is never shown in place of the server's.
  const payMissing: string[] = [];
  if (!(Number(payAmount) > 0)) payMissing.push(t("trips.invoiceSheet.payGateAmount", lang));
  if (payMethod === "bank_transfer") {
    if (payReference.trim() === "") payMissing.push(t("trips.invoiceSheet.payGateReference", lang));
    if (payDate === "") payMissing.push(t("trips.invoiceSheet.payGateDate", lang));
    if (payProof == null) payMissing.push(t("trips.invoiceSheet.payGateProof", lang));
  }

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

  // GRAND TOTAL STACK — DERIVED FROM THE LINE SNAPSHOTS, NOT FROM THE COVERED
  // SUBSET. Grand Total is the whole invoice: every trip this document lists,
  // covered or unpaid, plus every special charge, covered or uncovered. So the
  // rows sum the LINES the document is actually showing, which is the only
  // source that cannot disagree with the tables printed above them.
  //
  // This replaces a `chargeLines.filter(l => l.covered !== false)` subtotal.
  // That row was correct against the OLD covered-only Grand Total and is wrong
  // against this one twice over: it dropped uncovered charges that grand now
  // counts, and — since covered charges were already inside grand.vat/total —
  // it left the block adding up only by coincidence of what was excluded.
  const prepaidTripsSubtotal = round2(
    [...(view?.coveredLines ?? []), ...(view?.unpaidLines ?? [])].reduce((s, l) => s + l.amount_sar, 0),
  );
  const prepaidChargesSubtotalAll = round2(prepaidChargeLines.reduce((s, l) => s + l.amount_sar, 0));

  // LEDGER-ERA TRIPS TABLE — one table, so one foot figure, VAT-inclusive to
  // match what PrepaidTripTable's footer promises. Derived from the lines the
  // table is printing rather than from a `tripTotals` snapshot, because the
  // ledger era has no such snapshot: lib/invoice.ts stopped emitting one when
  // the covered/unpaid split went away (there is nothing left to split). Same
  // round-once convention the postpaid subsets beside it use — display only,
  // never fed back into document totals.
  const ledgerTripLines = view?.unpaidLines ?? [];
  const ledgerTripsTotal = round2(
    ledgerTripLines.reduce((s, l) => s + l.amount_sar, 0) + ledgerTripLines.reduce((s, l) => s + (l.vat_sar ?? 0), 0),
  );

  // ...EXCEPT ON AN INVOICE FROZEN UNDER THE OLD LAW, WHICH IS RENDERED AS
  // ISSUED. Draft/review recompute live and always reconcile. Confirmed / paid
  // / void render from frozen columns (0027), and the ones frozen by the
  // covered-only engine hold a grand_total_sar that EXCLUDES lines they list —
  // so line-derived rows would print a stack that visibly does not add up to
  // its own total. Those get their stored money corrected separately; until
  // then they render in the shape they were issued in, which at least agrees
  // with itself.
  //
  // The test is arithmetic, not a status check, deliberately: an old invoice
  // whose figures happen to obey the current law (no unpaid trips, no charges —
  // the two totals coincide there) renders the new stack and is identical
  // either way. Nothing keys off `status`, so nothing has to be re-keyed when
  // the 8 divergent rows are corrected — they simply start reconciling.
  const prepaidStackReconciles =
    view != null &&
    round2(prepaidTripsSubtotal + prepaidChargesSubtotalAll + view.grand.vat) === view.grand.total;

  // The as-issued row, used ONLY when the check above fails. Covered charges
  // only, `!== false` so a pre-0036 snapshot with no coverage flag counts as
  // covered — which is what the old engine did when it froze the grand total
  // this row has to keep adding up to. Reaching for this figure on a live
  // invoice would double-count: the covered charges are already inside
  // prepaidChargesSubtotalAll above.
  const frozenCoveredChargesSubtotal = round2(
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
    {/* No `invoice-print-portal` class any more: globals.css had a rule that
        flattened this overlay for print, and there is nothing left for it to
        flatten. This subtree is a SCREEN surface only. */}
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <ScrollLock />
      <div
        // 1080px = this app's size:lg popup width (InventoryClient.tsx:130).
        // Widened from max-w-4xl: the trip tables are six columns and each row
        // carries a stacked pre-VAT+VAT figure, so the money column needs room
        // that Date/Ref/Truck/Capacity/Type were taking. Nothing here is
        // width-constrained by paper: the printed sheet is its own document.
        className="card p-0 w-full max-w-[1080px] max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar — not printed. */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-app bg-[rgb(var(--card))] px-5 py-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onBack} className="text-sm muted hover:text-[rgb(var(--fg))]">
              {t("trips.invoice.backToInvoices", lang)}
            </button>
            {/* TOOLBAR pill — chrome, so it translates. Keyed off `status`, the
                ENUM VALUE, exactly as the map it replaces was; nothing reads the
                label back. The sheet's own Status line (:941) resolves through
                the same `invoiceStatusLabel`, so the two agree by construction.
                The PRINTED status comes from the view-model, not from either. */}
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
            <span title={printError ?? undefined}>
              <Btn
                variant="outline"
                onClick={handlePrint}
                className={printing ? "opacity-50 pointer-events-none" : ""}
              >
                <Printer className="h-4 w-4" />{" "}
                {printing ? t("trips.invoice.generating", lang) : t("common.print", lang)}
              </Btn>
            </span>
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
          // Was `id="invoice-print"` — the hook globals.css used to whitelist
          // this subtree for printing. The id is gone because keeping it would
          // invite a second print path back in. Print renders from the
          // view-model (lib/invoicePrintTemplate.ts), never from this DOM.
          <div className="p-6 space-y-6">
            {/* Header — identity + document meta. */}
            <div className="flex items-start justify-between gap-6 flex-wrap">
              <div>
                <h2 className="text-xl font-semibold">
                  {raw.invoice_number
                    ? fill(t("trips.invoiceSheet.headline", lang), { n: raw.invoice_number })
                    : t("trips.invoiceSheet.headlineDraft", lang)}
                </h2>
                {status === "draft" && !readOnly && editingPeriod ? (
                  <form onSubmit={onSavePeriod} className="flex items-end gap-2 flex-wrap mt-1">
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

            {isPrepaid && isLedger ? (
              /* ── PREPAID, LEDGER ERA (0203) ─────────────────────────────────
                 ONE trips table, no coverage verdict anywhere, and the
                 settlement stated once at the bottom.

                 What this replaces and why: the two tables below (Covered /
                 Unpaid) were the FIFO walk made visible — every trip carried a
                 verdict about which side of the prepaid pool it fell on, and a
                 balance was re-printed under each table so the reader could
                 follow the walk. 0203 deleted the walk. The draw is now ONE
                 figure taken at confirm against the customer's Available
                 balance, so there is no per-trip verdict left to show and no
                 second place the balance belongs. Splitting the trips anyway
                 would invent a distinction the money no longer makes.

                 This is also the shape the PRINTED sheet and the downloaded PDF
                 render for the same invoice — one trips table, no Status column
                 on charges, TOTAL → Prepaid Applied → AMOUNT PAYABLE. The popup
                 has to agree with the paper. */
              <>
                <PrepaidTripTable
                  lang={lang}
                  title={t("trips.invoiceSheet.tTrips", lang)}
                  lines={ledgerTripLines}
                  subtotal={ledgerTripsTotal}
                  fallbackWaterType={view.projectWaterType}
                  // Balance and Remaining are BACK on this table (0204, item
                  // 6), fed by the ledger reader rather than the retired
                  // pool's paid-up expression. The earlier note here said these props
                  // were deliberately omitted because the settlement is stated
                  // once at the bottom; that reasoning conflated two different
                  // questions. The closing chain answers "what is owed on THIS
                  // invoice"; these two rows answer "what does the customer
                  // have, and what is left of it after this table" — the
                  // figure a reader wants beside the trips, not under them.
                  //
                  // The caption is passed explicitly because the ledger
                  // balance is NOT the paid-up balance the default names.
                  balanceLabel={t("trips.invoiceSheet.ledgerBalance", lang)}
                  balance={ledgerBalanceRow}
                  remaining={ledgerRemaining}
                  //
                  // The hide-from-customer toggle stays HERE, on the one trips
                  // table, because it is still the same control governing the
                  // same thing — whether the customer's copy shows what is left
                  // to pay. Screen always shows it; print/PDF/email obey it via
                  // the view-model. §7 unchanged.
                  headerRight={
                    <HideAmountDueToggle
                      lang={lang}
                      hidden={raw.hide_amount_due}
                      busy={busy}
                      onToggle={toggleHideAmountDue}
                    />
                  }
                />

                {(prepaidChargeLines.length > 0 || editable) && (
                  <SpecialChargesSection
                    lang={lang}
                    chargeLines={prepaidChargeLines}
                    subtotal={prepaidChargesSubtotalAll}
                    vat={round2(prepaidChargeLines.reduce((s, l) => s + (l.vat_sar ?? 0), 0))}
                    total={round2(
                      prepaidChargesSubtotalAll + prepaidChargeLines.reduce((s, l) => s + (l.vat_sar ?? 0), 0),
                    )}
                    // Every charge on a ledger-era invoice is billed on it. A
                    // column whose only value is "Covered" is noise.
                    showStatus={false}
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
                    setChargeImageFile={onPickChargeImage}
                    chargeImageInputKey={chargeImageInputKey}
                  />
                )}

                {/* NO Amount Due card beside this stack, and its absence is the
                    point. Under the ledger law a prepaid invoice's amountDue IS
                    its grand total (lib/invoice.ts emits them equal), so the
                    card would print the stack's own figure a second time a few
                    centimetres away — the exact repetition the document work
                    removed from the paper version. What the operator actually
                    needs to know, "how much is still collectible", is the
                    Amount Payable hero and the settlement panel below it.

                    The settlement pair is passed ONLY on a frozen invoice, from
                    the invoice ROW's frozen columns — never from
                    v_invoice_settlement, whose remainder moves as payments
                    arrive. A draft has frozen nothing, so it shows a plain
                    Grand Total exactly as it always did. */}
                <GrandTotalStack
                  lang={lang}
                  rows={[
                    { label: t("trips.invoiceSheet.subtotalTrips", lang), amount: prepaidTripsSubtotal },
                    { label: t("trips.invoiceSheet.specialCharges", lang), amount: prepaidChargesSubtotalAll },
                  ]}
                  vat={view.grand.vat}
                  total={view.grand.total}
                  settlement={
                    raw.amount_payable_sar != null
                      ? { applied: raw.prepaid_applied_sar ?? 0, payable: raw.amount_payable_sar }
                      : undefined
                  }
                />
              </>
            ) : isPrepaid ? (
              <>
                {/* ── PREPAID, LEGACY (confirmed before 0203) ─────────────────
                    FROZEN DOCUMENT, RENDERED AS ISSUED. Everything below is the
                    pre-ledger shape and stays byte-for-byte what it was: these
                    invoices were settled under the covered/unpaid law, their
                    stored columns describe that law, and re-rendering them in
                    the new shape would make a tax document claim figures it was
                    never issued with (0027 freeze law). It is unreachable for
                    anything confirmed from 0203 onward.

                    v3 §9 — Covered/Unpaid TRIPS tables, ALWAYS shown (even at
                    zero rows), each closing on the stacked Subtotal / balance /
                    Remaining footer. Pre-VAT rows — no per-row VAT column (VAT
                    only ever appears in the Grand Total stack below).

                    The footer's POSITION and SHAPE are the original ones. Its
                    balance row is NOT: it carries the paid-up balance, the same
                    figure the documents print, not the chained per-invoice
                    running balance these two tables used to walk between them.
                    Both tables get the SAME balance — no chaining. */}
                <PrepaidTripTable
                  lang={lang}
                  title={t("trips.invoiceSheet.tCoveredTrips", lang)}
                  lines={view.coveredLines}
                  subtotal={view.tripTotals?.covered ?? view.covered.total}
                  balance={balanceRow}
                  remaining={remainingAfter(view.tripTotals?.covered ?? view.covered.total)}
                  fallbackWaterType={view.projectWaterType}
                />
                <PrepaidTripTable
                  lang={lang}
                  title={t("trips.invoiceSheet.tUnpaidTrips", lang)}
                  lines={view.unpaidLines}
                  subtotal={view.tripTotals?.unpaid ?? view.amountDue.total}
                  balance={balanceRow}
                  remaining={remainingAfter(view.tripTotals?.unpaid ?? view.amountDue.total)}
                  fallbackWaterType={view.projectWaterType}
                  // No `hiddenFromPrint` here any more, and that is the point:
                  // hide-amount-due is now honoured ONCE, upstream, by the
                  // view-model (vm.amountDue goes null), which every printed
                  // and downloaded document reads. This markup used to carry a
                  // SECOND mechanism for the same rule — a `no-print` class on
                  // the table and another on the Amount Due card — and two
                  // mechanisms for one rule is how they drift apart. The
                  // section stays on screen either way, unchanged (§7: this
                  // toggle "governs print/PDF/email only, always visible
                  // on-screen").
                  headerRight={
                    <HideAmountDueToggle
                      lang={lang}
                      hidden={raw.hide_amount_due}
                      busy={busy}
                      onToggle={toggleHideAmountDue}
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
                    setChargeImageFile={onPickChargeImage}
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
                  {/* This card used to drop out of the printout when the hide
                      toggle was on. It no longer needs to: the modal is not a
                      print surface, and the documents that are read
                      hide-amount-due from the view-model. Screen keeps the
                      card unconditionally — the person choosing what the
                      customer sees has to keep seeing it themselves. */}
                  <div className="sm:w-64 sm:flex-shrink-0">
                    <TotalCard
                      lang={lang}
                      label={t("trips.invoiceSheet.amountDue", lang)}
                      totals={view.amountDue}
                      tone={view.amountDue.total > 0 ? "bad" : "ok"}
                    />
                  </div>
                  {/* Grand Total — the WHOLE invoice: every trip on it,
                      covered or unpaid, plus every special charge. Rows come
                      from the line snapshots so they cannot disagree with the
                      tables above; the fallback renders an invoice frozen under
                      the old covered-only law exactly as it was issued. See
                      prepaidStackReconciles. */}
                  <GrandTotalStack
                    lang={lang}
                    rows={
                      prepaidStackReconciles
                        ? [
                            { label: t("trips.invoiceSheet.subtotalTrips", lang), amount: prepaidTripsSubtotal },
                            { label: t("trips.invoiceSheet.specialCharges", lang), amount: prepaidChargesSubtotalAll },
                          ]
                        : [
                            { label: t("trips.invoiceSheet.subtotalCovered", lang), amount: view.covered.subtotal },
                            { label: t("trips.invoiceSheet.chargesCovered", lang), amount: frozenCoveredChargesSubtotal },
                          ]
                    }
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
                    setChargeImageFile={onPickChargeImage}
                    chargeImageInputKey={chargeImageInputKey}
                  />
                )}

                {/* No Amount Due box for postpaid (layout fix) — postpaid has
                    no prepaid balance, so Amount Due is always numerically
                    identical to Grand Total below it (same figure twice,
                    meaningless second card).

                    And no hide-amount-due toggle either: the toggle exists to
                    suppress a figure the customer has already paid against
                    from a prepaid balance. Postpaid has no such balance, so
                    hiding Amount Due would only hide the invoice's own total
                    from the person being billed for it. PREPAID ONLY — the PDF
                    template has always read `hideAmountDue` in its prepaid
                    branch alone, so this removes the popup's odd one out
                    rather than changing what any document renders. */}

                {/* Grand Total (item 2) — same stacked structure as prepaid:
                    Subtotal → Special Charges → VAT → Total, no Balance/
                    Remaining (postpaid has no balance). No title (item 4). */}
                <GrandTotalStack
                  lang={lang}
                  rows={[
                    { label: t("trips.invoiceSheet.subtotalUnpaid", lang), amount: postpaidUnpaidTripSubtotal },
                    { label: t("trips.invoiceSheet.specialCharges", lang), amount: postpaidChargesSubtotal },
                  ]}
                  vat={view.grand.vat}
                  total={view.grand.total}
                />
              </>
            )}

            {/* Transfer Details — LAST content block on the sheet, below Grand
                Total in both payment modes. It used to be marked as one of the
                few blocks the print stylesheet did NOT suppress, because a
                printed invoice needs its payment instruction more than the
                screen does. That distinction is not this markup's to make any
                more: nothing prints this popup, and the document decides for
                itself what it carries.

                One expression with the download. `buildBankBlock` is the same
                function lib/invoicePdfTemplate.ts renders from — it owns the
                show_on_invoice filter, the order and the IBAN spacing, so this
                popup cannot show a different set of accounts, in a different
                order, spaced a different way, from the PDF the customer opens.
                The LOOK diverges (sheet card here, Aquaglass strip there); the
                DATA and WORDING cannot. */}
            <TransferDetailsSection lang={lang} bank={buildBankBlock(view.sellerSnapshot?.bank_accounts)} />

            {/* Undelivered-trip blockers (item 2) — only at Review, mirrors
                confirm_invoice()'s SQL guard exactly (migration 0032).
                Highlight-on-click/clear-on-hover comes free from
                TripRefLink -> useIncomingTripHighlight (Batch A). */}
            {status === "review" && blockers.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
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

            {/* THE PAID BOX IS LEGACY-ONLY NOW, and the gate is the point. It
                reads invoices.payment_method, which record_invoice_payment()
                and apply_balance_to_invoice() never write: both set `paid` +
                paid_at and leave the method null, because under the ledger
                model an invoice can be settled by three cash payments and a
                balance draw and there is no single method to name. Left
                ungated, every ledger invoice printed "Paid on 2026-03-04 via
                —", which is a worse answer than none. The settlement panel
                below says what actually happened, payment by payment. */}
            {raw.status === "paid" && !isLedger && (
              <div className="rounded-lg border border-app p-3 text-sm break-inside-avoid">
                <span className="font-medium">{t("trips.invoiceSheet.paid", lang)}</span>{" "}
                {raw.paid_at ? fill(t("trips.invoiceSheet.paidOn", lang), { date: raw.paid_at.slice(0, 10) }) : ""}{" "}
                {t("trips.invoiceSheet.via", lang)}{" "}
                {raw.payment_method ? paymentMethodLabel(raw.payment_method, lang) : "—"}.
                {raw.proof_of_payment_path && (
                  <Btn variant="ghost" className="ms-2" onClick={onViewProof}>
                    {t("trips.invoiceSheet.viewProof", lang)}
                  </Btn>
                )}
              </div>
            )}

            {/* ═══ SETTLEMENT FIGURES — ONLY WHEN THEY CANNOT BE READ ══════
                The Amount Payable / Outstanding / Available panel that stood
                here is GONE (Turki's ruling). It was a five-row restatement of
                v_invoice_settlement offered beside two buttons, and it existed
                to help the operator choose between them; Mark Paid removes the
                choice, so the panel was answering a question nobody is asked
                any more. What this invoice still owes now reaches the operator
                where it is acted on — in Mark Paid's own confirmation, and in
                the payment form's pre-filled amount.

                THE FAILED READ STAYS, and it is not a leftover. Every control
                below is gated on `settlementReadable`, so an unreadable
                settlement produces a confirmed invoice with no settlement
                action and no stated reason — which reads as a bug in the
                screen rather than a fact about the data. This says which it
                is, in words, and never as a zero. */}
            {(status === "confirmed" || status === "paid") && isLedger && !settlementReadable && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-300">
                {t("trips.invoiceSheet.sUnavailable", lang)}
              </div>
            )}

            {/* PAYMENT HISTORY — arrivals, oldest first, never summed here.
                invoice_payments is append-only by grant (authenticated holds
                SELECT and nothing else), so this list only ever grows: voiding
                an invoice reverses the ledger and leaves these standing, which
                is the correct history of a payment that really was received.
                `paid_on` is the money's own date and `created_at` is when it was
                keyed in — the first is what a reconciler wants, so it wins when
                present. */}
            {payments.length > 0 && (
              <div className="rounded-lg border border-app p-3 space-y-2 text-sm">
                <div className="font-medium">{t("trips.invoiceSheet.historyTitle", lang)}</div>
                <ul className="space-y-1.5">
                  {payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="tabular-nums muted shrink-0">
                          {(p.paid_on ?? p.created_at).slice(0, 10)}
                        </span>
                        <span className="shrink-0">{paymentMethodLabel(p.method, lang)}</span>
                        {p.reference && <span className="muted truncate">· {p.reference}</span>}
                        {p.proof_path && (
                          <Btn variant="ghost" onClick={() => onViewPaymentProof(p.id)}>
                            {t("trips.invoiceSheet.viewProof", lang)}
                          </Btn>
                        )}
                      </span>
                      <span className="tabular-nums shrink-0">{formatSar(p.amount_sar)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {actionError && <p className="text-sm text-rose-600 dark:text-rose-400">{actionError}</p>}
            {pdfError && <p className="text-sm text-rose-600 dark:text-rose-400">{pdfError}</p>}
            {printError && <p className="text-sm text-rose-600 dark:text-rose-400">{printError}</p>}

            {/* Actions — status-dependent, not printed, and absent entirely
                on a read-only mount. */}
            {!readOnly && (
            <div className="border-t border-app pt-4 space-y-3">
              {status === "draft" && !deletingDraft && (
                <div className="flex items-center gap-2">
                  <Btn variant="primary" onClick={() => runAction(() => setInvoiceReview(invoiceId))} className={busy ? "opacity-50 pointer-events-none" : ""}>
                    {t("trips.invoiceSheet.moveToReview", lang)}
                  </Btn>
                  <Btn variant="outline" onClick={() => setDeletingDraft(true)} className={busy ? "opacity-50 pointer-events-none" : ""}>
                    <Trash2 className="h-4 w-4" /> {t("trips.invoices.discard", lang)}
                  </Btn>
                </div>
              )}
              {/* ONE guard for both statuses, and it deliberately borrows the
                  `trips.invoices.*` strings the list already uses. The same
                  irreversible act must not be described two different ways
                  depending on which screen the operator reached it from — the
                  list's copy is the complete one (trips released AND charges
                  stop consuming balance), so it is the one that survives. */}
              {canDiscard && deletingDraft && (
                <GuardBox
                  lang={lang}
                  warning={t("trips.invoices.guardDiscard", lang)}
                  busy={busy}
                  confirmLabel={t("trips.invoices.confirmDiscard", lang)}
                  onCancel={() => setDeletingDraft(false)}
                  onConfirm={onDeleteDraft}
                />
              )}

              {/* `!deletingDraft` matches the draft row above: when the guard
                  opens, the actions it is asking about get out of its way. */}
              {status === "review" && !confirmingConfirm && !deletingDraft && (
                <div className="flex items-center gap-2">
                  <Btn variant="outline" onClick={() => runAction(() => revertInvoiceToDraft(invoiceId))} className={busy ? "opacity-50 pointer-events-none" : ""}>
                    {t("trips.invoiceSheet.backToDraft", lang)}
                  </Btn>
                  {/* Discard is reachable directly from Review now (0182). It
                      sits next to Back-to-Draft rather than beside Confirm
                      because both are ways OUT of review, and it stays visually
                      apart from the primary action it must never be mistaken
                      for. */}
                  <Btn variant="outline" onClick={() => setDeletingDraft(true)} className={busy ? "opacity-50 pointer-events-none" : ""}>
                    <Trash2 className="h-4 w-4" /> {t("trips.invoices.discard", lang)}
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

              {/* ═══ CONFIRMED / PAID — the settlement controls ═══════════════
                  ONE row for both statuses, because under the ledger model they
                  are the same situation at two points along it: `paid` is
                  simply what the RPC set when the outstanding amount reached
                  zero. So every control here is gated on the SETTLEMENT, never
                  on the status — the status is the consequence, and gating on a
                  consequence is how a half-paid invoice ends up with no way to
                  receive the other half.

                  Each panel below REPLACES this row instead of stacking under
                  it. This is a modal over a long document; a live control row
                  floating above an open form is how the wrong button gets
                  clicked. */}
              {(status === "confirmed" || status === "paid") &&
                !voiding && !payingOpen && !markPaidOpen && !unpaying && (
                <div className="flex items-center gap-2 flex-wrap">
                  {/* MARK PAID — ONE button, ledger era, and only while
                      something is outstanding. At zero there is nothing left
                      to settle and both RPCs behind it would refuse; the
                      absence says so before a figure is typed.

                      Two buttons stood here — Record payment and Apply balance
                      — and choosing between them was the operator's problem.
                      It should never have been: whether the balance covers
                      this invoice is a question about figures held on the
                      server, and getting it wrong meant either a refused RPC
                      or cash collected that the balance would have paid.

                      PREPAID OPENS THE CONFIRMATION; postpaid goes straight to
                      the payment form, because a customer with no pool has
                      nothing to confirm about one. The pre-fill happens HERE,
                      at the click, rather than in an effect: the field's
                      starting value is the remainder as it stands now, not a
                      thing to be re-synced while the operator is editing it. */}
                  {isLedger && settlementReadable && (remainderSar as number) > 0 && (
                    <Btn
                      variant="primary"
                      onClick={() => {
                        if (isPrepaid) {
                          setMarkPaidOpen(true);
                          return;
                        }
                        setPayAmount(String(remainderSar));
                        setPayingOpen(true);
                      }}
                    >
                      {t("trips.invoiceSheet.markPaid", lang)}
                    </Btn>
                  )}
                  {/* LEGACY — the old single button, old label, old flow, and
                      confirmed-only: pay_invoice() has never accepted a paid
                      invoice and does not start now. */}
                  {!isLedger && status === "confirmed" && (
                    <Btn variant="primary" onClick={() => setPayingOpen(true)}>
                      {t(isPrepaid ? "trips.invoiceSheet.payWithBalance" : "trips.invoiceSheet.markPaid", lang)}
                    </Btn>
                  )}
                  {/* SALES RETURN — reachable FROM PAID now, and that is the
                      substance of it. A paid invoice needing to be undone is
                      exactly the case with money to reverse, and void_invoice()
                      writes a draw_reversal for every draw and applied balance
                      itself. Un-pay cannot do that, which is why it refuses
                      those invoices rather than competing for the job. */}
                  <Btn variant="outline" onClick={() => setVoiding(true)}>
                    {t("trips.invoiceSheet.salesReturn", lang)}
                  </Btn>
                  {/* UN-PAY — paid only, and only while nothing has moved.
                      `unpayBlocked` mirrors the RPC's two guards, and when it is
                      set the button is REPLACED BY THE REASON rather than
                      merely disabled: the operator needs to learn which undo to
                      reach for, not to discover it from a raised exception
                      after filling in a reason box. */}
                  {status === "paid" && !unpayBlocked && (
                    <Btn variant="outline" onClick={() => setUnpaying(true)}>
                      <AlertTriangle className="h-4 w-4" /> {t("trips.invoiceSheet.adminUnpay", lang)}
                    </Btn>
                  )}
                  {status === "paid" && unpayBlocked && (
                    <p className="text-xs muted basis-full">{t("trips.invoiceSheet.unpayBlockedNote", lang)}</p>
                  )}
                  {!isLedger && (
                    <p className="text-xs muted basis-full">{t("trips.invoiceSheet.legacyFlowNote", lang)}</p>
                  )}
                </div>
              )}

              {/* ── RECORD A PAYMENT (ledger era) ────────────────────────────
                  ONE form for both payment modes. A prepaid invoice whose
                  balance fell short is collected exactly like a postpaid one,
                  because by then it is the same fact: the customer owes cash
                  and some of it turned up. The old screen had two panels here
                  for what turned out to be one act.

                  THE AMOUNT IS A STARTING VALUE, NOT A LIMIT. It pre-fills with
                  the outstanding figure so "they paid all of it" is one click,
                  and stays freely editable because a part-payment is the whole
                  reason this form exists. No max is set: the ceiling belongs to
                  record_invoice_payment(), which holds the row lock and refuses
                  an overpayment with a sentence naming both figures. A `max`
                  here would be a second, staler opinion of the same rule. */}
              {payingOpen && isLedger && (
                <form onSubmit={onRecordPayment} className="space-y-3 max-w-sm">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">{t("trips.invoiceSheet.fPayAmount", lang)}</span>
                    <input
                      type="number"
                      name="amount"
                      step="0.01"
                      min="0.01"
                      required
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className={INPUT + " text-lg tabular-nums"}
                      style={INPUT_STYLE}
                    />
                  </label>
                  {remainderSar != null && (
                    <p className="text-xs muted">
                      {fill(t("trips.invoiceSheet.payAmountHint", lang), { amount: formatSar(remainderSar) })}
                    </p>
                  )}
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
                  {/* Reference + date required for bank_transfer (a real bank
                      transaction exists to point to), optional for cash — the
                      same rule 0203's RPC enforces, and it raises its own
                      message if this markup is ever bypassed.

                      CONTROLLED since 0204's item 10. They still travel in the
                      FormData by `name` exactly as before; the state exists so
                      the gate above this form's button can say what is missing
                      rather than leaving the operator to discover it one
                      browser bubble at a time. `required` stays as the second
                      line of the same defence. */}
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">
                      {t("trips.invoiceSheet.fPaymentReference", lang)}
                      {t(payMethod === "bank_transfer" ? "trips.invoiceSheet.sufRequired" : "trips.invoiceSheet.sufOptional", lang)}
                    </span>
                    <input
                      type="text"
                      name="paymentReference"
                      required={payMethod === "bank_transfer"}
                      value={payReference}
                      onChange={(e) => setPayReference(e.target.value)}
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
                      value={payDate}
                      onChange={(e) => setPayDate(e.target.value)}
                      className={INPUT}
                      style={INPUT_STYLE}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">{t("trips.invoiceSheet.fPayNote", lang)}</span>
                    <textarea name="paymentNote" rows={2} className={INPUT} style={INPUT_STYLE} />
                  </label>
                  {/* THE SLIP IS NOW OFFERED ON BOTH METHODS. It used to render
                      only for bank_transfer, so a cash payment had nowhere to
                      put a signed receipt even when one existed — the evidence
                      was refused by the form rather than by any rule. It is
                      required on a transfer and merely available on cash, which
                      is exactly what the suffix says and exactly what the RPC
                      enforces.

                      The input stays UNCONTROLLED, because a file input must
                      be; onChange mirrors the selection into state purely so
                      the gate can see it, and the key remounts it on reset. */}
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="font-medium">
                      {t("trips.invoiceSheet.fProof", lang)}
                      {t(payMethod === "bank_transfer" ? "trips.invoiceSheet.sufRequired" : "trips.invoiceSheet.sufOptional", lang)}
                    </span>
                    <input
                      key={payProofInputKey}
                      type="file"
                      name="proofFile"
                      required={payMethod === "bank_transfer"}
                      onChange={(e) => setPayProof(e.target.files?.[0] ?? null)}
                      className={INPUT}
                      style={INPUT_STYLE}
                    />
                  </label>
                  {/* WHAT IS STILL MISSING, STATED BEFORE THE ATTEMPT. Only
                      rendered when something is: a complete form says nothing
                      and simply offers its button. Amber rather than red — the
                      form is unfinished, not wrong. */}
                  {payMissing.length > 0 && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-300">
                      <div className="font-medium">{t("trips.invoiceSheet.payGateTitle", lang)}</div>
                      <ul className="mt-1 space-y-0.5 list-disc ps-5">
                        {payMissing.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Btn
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setPayingOpen(false);
                        resetPayForm();
                      }}
                    >
                      {t("common.cancel", lang)}
                    </Btn>
                    <Btn
                      type="submit"
                      variant="primary"
                      className={busy || payMissing.length > 0 ? "opacity-50 pointer-events-none" : ""}
                    >
                      {t(busy ? "common.recording" : "trips.invoiceSheet.confirmPayment", lang)}
                    </Btn>
                  </div>
                </form>
              )}

              {/* ── MARK PAID: THE ONE CONFIRMATION (ledger era, prepaid) ────
                  It states ONE thing — the amount about to leave the balance —
                  because that is the only consequence the operator is being
                  asked to accept. The rows under it are that figure's
                  arithmetic, in the order it is reached: what the customer has,
                  what this invoice wants, what will move, and what is left of
                  each afterwards.

                  A PREVIEW OF THE SERVER'S OWN min(), AND NOTHING ELSE.
                  `markPaidDraw` restates apply_balance_to_invoice()'s
                  expression, add-back included; it does not decide the draw and
                  it is not sent. See its definition for why the add-back is
                  load-bearing rather than cosmetic.

                  A FAILED READ REFUSES OUTRIGHT. `availableSar` and
                  `remainderSar` are null, never zero, when unreadable, so
                  "nothing to draw" and "we could not find out" stay different
                  answers — and only the first of them lets the flow continue to
                  the cash form. */}
              {markPaidOpen && (
                <div className="space-y-3 max-w-sm">
                  {availableSar == null || remainderSar == null || markPaidDraw == null ? (
                    <div className="card p-3 text-sm text-amber-700 dark:text-amber-400" style={{ borderColor: "rgb(var(--border))" }}>
                      {t("trips.invoiceSheet.applyUnavailable", lang)}
                    </div>
                  ) : markPaidDraw <= 0 ? (
                    /* NOTHING THE BALANCE CAN COVER. The RPC would refuse this
                       draw, so it is never attempted — the dialog says why and
                       the button goes on to the cash form. The two figures stay
                       on screen: "no balance to apply" is a conclusion, and the
                       operator is owed the numbers it came from. */
                    <div className="card p-3 text-sm space-y-1.5" style={{ borderColor: "rgb(var(--border))" }}>
                      <div className="flex justify-between">
                        <span className="muted">{t("trips.invoiceSheet.applyAvailable", lang)}</span>
                        <span className="tabular-nums">{formatSar(availableSar)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="muted">{t("trips.invoiceSheet.applyRemainder", lang)}</span>
                        <span className="tabular-nums">{formatSar(remainderSar)}</span>
                      </div>
                      <p className="pt-1.5 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                        {t("trips.invoiceSheet.mpNoBalance", lang)}
                      </p>
                    </div>
                  ) : (
                    <div className="card p-3 text-sm space-y-1.5" style={{ borderColor: "rgb(var(--border))" }}>
                      <div className="flex justify-between">
                        <span className="muted">{t("trips.invoiceSheet.applyAvailable", lang)}</span>
                        <span className="tabular-nums">{formatSar(availableSar)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="muted">{t("trips.invoiceSheet.applyRemainder", lang)}</span>
                        <span className="tabular-nums">{formatSar(remainderSar)}</span>
                      </div>
                      {/* THE FIGURE THIS DIALOG EXISTS FOR — what leaves the
                          balance the moment Confirm is pressed. */}
                      <div className="flex justify-between font-semibold pt-1.5 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                        <span>{t("trips.invoiceSheet.applyWillApply", lang)}</span>
                        <span className="tabular-nums">{formatSar(markPaidDraw)}</span>
                      </div>
                      {/* THE TWO AFTER-STATES. The row above says how much
                          moves; these say what each side is left with, which is
                          what the operator has to tell the customer standing in
                          front of them. Quiet, and below the rule, because they
                          are consequences of the conclusion rather than further
                          terms in it.

                          Display arithmetic on figures the panel has already
                          stated, all of which came whole from the server. NOT a
                          second opinion: the RPC re-reads under the row lock, so
                          if anything moved in between these were forecasts and
                          the ledger is the record. */}
                      <div className="flex justify-between text-xs muted">
                        <span>{t("trips.invoiceSheet.applyAfter", lang)}</span>
                        <span className="tabular-nums">{formatSar(round2(availableSar - markPaidDraw))}</span>
                      </div>
                      <div className="flex justify-between text-xs muted">
                        <span>{t("trips.invoiceSheet.mpOutstandingAfter", lang)}</span>
                        <span className="tabular-nums">{formatSar(round2(remainderSar - markPaidDraw))}</span>
                      </div>
                    </div>
                  )}
                  {/* What happens NEXT, said before it happens: a draw that
                      clears the invoice ends here, and one that does not opens
                      the cash form for the rest. The operator should not
                      discover a second step by arriving at it. */}
                  <p className="text-xs muted">
                    {t(
                      markPaidDraw != null && markPaidDraw > 0 && remainderSar != null && markPaidDraw >= remainderSar
                        ? "trips.invoiceSheet.mpNoteClears"
                        : "trips.invoiceSheet.mpNoteShortfall",
                      lang,
                    )}
                  </p>
                  <p className="text-xs muted">{t("trips.invoiceSheet.applyNote", lang)}</p>
                  <div className="flex items-center gap-2">
                    <Btn type="button" variant="ghost" onClick={() => setMarkPaidOpen(false)}>
                      {t("common.cancel", lang)}
                    </Btn>
                    {/* ONE BUTTON, BOTH PATHS. With a draw it applies the
                        balance and then decides; with none it goes straight to
                        the cash form. The label follows the act, so the
                        operator reads what the press will do rather than what
                        the dialog is called. Withheld entirely on a failed
                        read — there is no safe act to offer. */}
                    {availableSar != null && remainderSar != null && markPaidDraw != null && (
                      <Btn
                        type="button"
                        variant="primary"
                        onClick={onMarkPaid}
                        className={busy ? "opacity-50 pointer-events-none" : ""}
                      >
                        {t(
                          busy
                            ? "common.recording"
                            : markPaidDraw > 0
                              ? "trips.invoiceSheet.confirmApply"
                              : "trips.invoiceSheet.recordPaymentBtn",
                          lang,
                        )}
                      </Btn>
                    )}
                  </div>
                </div>
              )}

              {/* ── LEGACY PAY, PREPAID (pre-0203 invoices only) ─────────────
                  UNCHANGED, and unchanged on purpose: these rows were frozen
                  under the covered/unpaid engine and are settled by the law
                  they were issued under. No cash/bank choice — the balance
                  already covered the work at delivery, so this records the
                  settlement and locks it.

                  THE DRAW-DOWN IS settlementSar, the payment's own sum over
                  this invoice's items, and it has been wrong twice for the same
                  reason: the panel reached for a figure computed for something
                  else. It read covered.total (true of the POOL, false of the
                  PAID-UP balance, which moves by everything the payment
                  settles), then view.grand.total (right on invoices frozen
                  under the current law, wrong on the ones whose stored total
                  EXCLUDES lines the document lists — 026-000017 previewed
                  7,544.00 against a real 8,694.00). Both are settled; do not
                  reopen them.

                  `paidUp ?? 0` USED TO STAND IN THESE THREE ROWS, so a failed
                  read printed a confident draw-down off a balance of zero. It
                  refuses now, and Confirm is not offered. */}
              {payingOpen && !isLedger && isPrepaid && (
                <div className="space-y-3 max-w-sm">
                  {payPreviewUnreadable ? (
                    <div className="card p-3 text-sm text-amber-700 dark:text-amber-400" style={{ borderColor: "rgb(var(--border))" }}>
                      {t("trips.invoiceSheet.paidUpUnavailable", lang)}
                    </div>
                  ) : (
                    <div className="card p-3 text-sm space-y-1.5" style={{ borderColor: "rgb(var(--border))" }}>
                      <div className="flex justify-between">
                        <span className="muted">{t("trips.invoiceSheet.paidUpBalance", lang)}</span>
                        <span className="tabular-nums">{formatSar(paidUp as number)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="muted">{t("trips.invoiceSheet.thisInvoiceGrand", lang)}</span>
                        <span className="tabular-nums">− {formatSar(settlementSar as number)}</span>
                      </div>
                      <div className="flex justify-between font-semibold pt-1.5 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                        <span>{t("trips.invoiceSheet.remainingSettled", lang)}</span>
                        <span className={"tabular-nums " + (round2((paidUp as number) - (settlementSar as number)) < 0 ? "text-rose-600 dark:text-rose-400" : "")}>
                          {formatSar(round2((paidUp as number) - (settlementSar as number)))}
                        </span>
                      </div>
                    </div>
                  )}
                  <p className="text-xs muted">
                    {t("trips.invoiceSheet.balanceNote", lang)}
                  </p>
                  <div className="flex items-center gap-2">
                    <Btn type="button" variant="ghost" onClick={() => setPayingOpen(false)}>
                      {t("common.cancel", lang)}
                    </Btn>
                    {!payPreviewUnreadable && (
                      <Btn type="button" variant="primary" onClick={onLegacyPayBalance} className={busy ? "opacity-50 pointer-events-none" : ""}>
                        {t(busy ? "common.recording" : "trips.invoiceSheet.confirmPayment", lang)}
                      </Btn>
                    )}
                  </div>
                </div>
              )}

              {/* ── LEGACY PAY, POSTPAID (pre-0203 invoices only) ────────────
                  The v2 form, verbatim, minus the amount field it never had:
                  pay_invoice() settles in full or not at all. */}
              {payingOpen && !isLedger && !isPrepaid && (
                <form onSubmit={onLegacyPay} className="space-y-3 max-w-sm">
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

              {/* VOID FROM PAID TOO (0203 §11) — the guard widened with the
                  button above it. void_invoice() accepts confirmed AND paid,
                  and reverses every un-reversed draw and applied balance on its
                  way, so this is the correct undo for an invoice whose money
                  has already moved. */}
              {(status === "confirmed" || status === "paid") && voiding && (
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
                {/* SAFE TO TRANSLATE, and checked rather than assumed: this is
                    `new Date()` at render time — a "printed on" stamp. It is
                    not stored on the invoice, not parsed back, not part of the
                    ZATCA QR payload and not one of the frozen document fields.
                    The surrounding sentence already translates (see the note
                    below on what translate="no" fences off), so the date inside
                    it moving with the language is the consistent outcome. */}
                {fill(t("trips.invoiceSheet.generated", lang), {
                  date: formatDateLang(new Date(), lang, { year: "numeric", month: "short", day: "numeric" }),
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
        className="fixed inset-0 z-[60] grid place-items-center p-4 bg-black/40"
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
      {/* THE ONE INTENTIONAL CHANGE INSIDE THE SHEET SUBTREE, and it changes no
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
}: {
  lang: Lang;
  title: string;
  lines: InvoiceLineSnapshot[];
  totals: Totals;
  // Display-only fallback (Finance polish batch C) — project's CURRENT
  // water_type, used when a line's own snapshot water_type is null (pre-
  // water_type-field invoice). Never mutates the frozen snapshot.
  fallbackWaterType?: WaterType | null;
  // No `headerRight` here (unlike PrepaidTripTable) — this table is postpaid-
  // only, and the sole control it ever hosted was the hide-amount-due toggle,
  // which is prepaid-only. Nothing else has ever needed the slot.
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
// stacked Subtotal / balance / Remaining rows, all three handed in whole and
// never re-derived here. Mirrors lib/invoicePdfTemplate.ts and
// lib/invoicePrintTemplate.ts, which close on the same three rows.
//
// THE COMPONENT TAKES NO CHAINED BALANCE AND CANNOT BUILD ONE. It receives one
// already-decided balance and one already-decided remainder; it has no access
// to the other table's figures, which is what makes the deleted mechanism —
// covered's Remaining seeding unpaid's Balance, producing a per-invoice balance
// the statement, the Finance KPI and the over-balance banner all disagreed with
// — unreachable from here rather than merely unused.
function PrepaidTripTable({
  lang,
  title,
  lines,
  subtotal,
  balance,
  balanceLabel,
  remaining,
  fallbackWaterType,
  headerRight,
}: {
  lang: Lang;
  title: string;
  lines: InvoiceLineSnapshot[];
  // VAT-INCLUSIVE subtotal of this table.
  subtotal: number;
  // The balance row's value: the paid-up figure, or the reason there isn't one.
  // A union, not a nullable number — "unreadable" and "zero" are different
  // content and the choice between them is not this component's to make.
  //
  // OPTIONAL, and it governs BOTH rows rather than one — the pair is one
  // block, so a caller either has a balance to state or has none. Postpaid
  // callers omit it. Every prepaid caller passes it, in both eras.
  //
  // It was omitted on the ledger-era call site for a while, on the reasoning
  // that a 0203 document states its settlement once in the closing chain. That
  // reasoning is gone (0204, item 6): the chain answers what is owed on this
  // invoice, these rows answer what the customer holds, and the two are not
  // the same question. What each era passes here IS different, though — see
  // balanceLabel.
  //
  // THREE VALUES NOW, not two. `undefined` still means "no pair at all"
  // (postpaid); `null` means "the pair renders, with an em-dash in both rows"
  // — a ledger-era invoice nothing has been drawn against yet, which under
  // 0204 is the ordinary state of a confirmed invoice. A 0 there would claim
  // an empty balance.
  balance?: { amount: number } | { note: string } | null;
  // The caption for that row, because the two eras put DIFFERENT NUMBERS in
  // it. Legacy passes the paid-up balance (since 0206 the LEDGER balance,
  // frozen at paid_at or voided_at by loadPaidUpBalance); the ledger era
  // passes v_customer_available.balance_sar, read
  // live. Same customer, same table, two figures that can legitimately
  // disagree — so naming both "Paid-up balance" would be a false statement on
  // one of them.
  //
  // Defaulted rather than required so the legacy call sites stay byte-for-byte
  // what they were.
  balanceLabel?: string;
  // Balance minus this table's subtotal; null when the balance is unreadable.
  // Ignored when `balance` is omitted — neither row renders.
  remaining?: number | null;
  fallbackWaterType?: WaterType | null;
  // v3.1 (item 6) — lets the Unpaid Trips table host the hide-amount-due
  // toggle at its header, same row as the title. Undefined for Covered.
  headerRight?: React.ReactNode;
  // There was a `hiddenFromPrint?: boolean` here that appended `no-print` when
  // hide-amount-due was on. Removed with the DOM print path: the toggle is
  // honoured in lib/invoiceViewModel.ts now, so every document obeys it and
  // this component went back to being screen-only.
}) {
  const rows = groupInvoiceLines(lines, fallbackWaterType);
  // v3.1 (item 3) — faded pre-VAT + VAT breakdown alongside the Subtotal
  // figure. `subtotal` is VAT-inclusive so it can't be decomposed on its own;
  // derive pre-VAT from the SAME raw lines already passed in (sum of
  // amount_sar, the one figure the VAT engine reads — lib/invoice.ts), then
  // back into VAT so the two halves always foot exactly to `subtotal`.
  // Display-only — no new consumption math.
  const preVat = round2(lines.reduce((s, l) => s + l.amount_sar, 0));
  const vatAmt = round2(subtotal - preVat);

  return (
    <section className="space-y-2 break-inside-avoid">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide muted">{title}</h3>
        {headerRight}
      </div>
      <div className="card p-0 overflow-hidden">
        {/* EMPTY STATE: no six-column header, no row of five blank cells. A
            skeleton table with nothing in it reads as a table that failed to
            load; one quiet line reads as an answer. The subtotal footer below
            stays either way — "always shown, even at zero" is still the rule,
            and a zero subtotal is a real answer. This also brings the screen
            CLOSER to the PDF, whose own empty state is a single colspan cell
            (invoicePdfTemplate.ts). */}
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
              <span className="tabular-nums font-medium">{formatSar(subtotal)}</span>
            </span>
          </div>
          {balance !== undefined && (
            <>
              <div className="flex items-center justify-between">
                <span className="muted">{balanceLabel ?? t("trips.invoiceSheet.paidUpBalance", lang)}</span>
                {/* The unreadable arm is set as WORDS — no tabular numerals — so
                    it cannot be skimmed as an amount. A dash stood here for the
                    legacy pre-0036 case the chained balance had; the paid-up
                    balance has no such case, so the only reason this cell holds
                    no figure now is a failed read, and it says so. */}
                {balance === null ? (
                  <span className="muted">—</span>
                ) : "note" in balance ? (
                  <span className="text-xs italic text-amber-600 dark:text-amber-400">{balance.note}</span>
                ) : (
                  <span className="tabular-nums">{formatSar(balance.amount)}</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium">{t("trips.invoiceSheet.remaining", lang)}</span>
                <span className={"tabular-nums font-semibold " + (remaining != null && remaining < 0 ? "text-rose-600 dark:text-rose-400" : "")}>
                  {remaining == null ? <span className="muted font-normal">—</span> : formatSar(remaining)}
                </span>
              </div>
            </>
          )}
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
  showStatus = true,
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
  // LEDGER ERA (0203) turns this off. The Status column carried a PER-CHARGE
  // coverage verdict — "Covered" / "Rolls forward" — produced by the FIFO walk
  // that decided, charge by charge, how much of the prepaid pool each one ate.
  // That walk is gone: the draw is one document-level figure taken at confirm,
  // so every charge on a ledger-era invoice is simply BILLED on it and a column
  // whose only two values are "yes" and "yes" is noise on a bookkeeping table.
  // Defaults true so the legacy document, which still means it, is untouched.
  showStatus?: boolean;
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
                    {showStatus && <TH>{t("common.status", lang)}</TH>}
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
                      {showStatus && (
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
                      )}
                      <TD>
                        <div className="flex items-center gap-2.5">
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
          <form onSubmit={onAddCharge} className="space-y-4 rounded-2xl bg-black/[0.025] dark:bg-white/[0.035] p-6">
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

// The stacked Grand Total block, shared by BOTH modes: composition rows → VAT
// → Total. No title (the block is self-evident); no Balance/Remaining rows ever
// (postpaid has no balance concept).
//
// `rows` REPLACED a fixed subtotal/charges pair. The rows are no longer one
// fixed shape: prepaid now lists every trip and every special charge (Grand
// Total is the whole invoice), while an invoice frozen under the old
// covered-only law still lists what it was issued with. Both are two rows
// today; neither is guaranteed to stay two, and hard-coding the pair is what
// made the old stack silently mis-describe its own total.
//
// The rows must sum, with `vat`, to `total`. That is the caller's job and the
// caller checks it — see prepaidStackReconciles. This component does not
// re-derive money, on purpose: a frozen document's figures are read verbatim.
//
// `settlement` (0203, prepaid, ledger era) appends the document's own closing
// chain and MOVES THE HERO. Without it the big figure is the Grand Total, which
// is what postpaid and every legacy invoice want. With it the reader gets:
//
//     TOTAL                      17,825.00      ← demoted to a plain row
//     Prepaid Applied           −12,000.00
//     ─────────────────────────────────────
//     AMOUNT PAYABLE              5,825.00      ← the hero
//
// which is the identical shape, wording and order the printed sheet and the
// downloaded PDF render (lib/invoicePrintTemplate.ts / invoicePdfTemplate.ts,
// both driven by vm.hero + vm.settlementRows). Three surfaces, one chain.
//
// AMOUNT PAYABLE IS NOT RE-DERIVED FROM total − applied. Both figures are
// frozen columns off the invoice row, and subtracting them here would be a
// fourth opinion on a sum the database already took under a lock. If they ever
// fail to reconcile, the document must SHOW that rather than paper over it.
function GrandTotalStack({
  lang,
  rows,
  vat,
  total,
  settlement,
}: {
  lang: Lang;
  rows: { label: string; amount: number }[];
  vat: number;
  total: number;
  settlement?: { applied: number; payable: number };
}) {
  return (
    <section className="space-y-2 break-inside-avoid">
      <div className="card p-4 space-y-1.5 text-sm max-w-md sm:min-w-[26rem] ms-auto">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between">
            <span className="muted">{r.label}</span>
            <span className="tabular-nums">{formatSar(r.amount)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <span className="muted">{t("trips.invoiceSheet.totalVat", lang)}</span>
          <span className="tabular-nums">{formatSar(vat)}</span>
        </div>
        <div className="flex items-center justify-between pt-2 mt-1 border-t border-app">
          <span className={settlement ? "muted" : "font-semibold"}>{t("trips.invoiceSheet.grandTotal", lang)}</span>
          <span
            className={
              settlement
                ? "tabular-nums"
                : "text-xl font-semibold tabular-nums text-brand-600 dark:text-brand-300"
            }
          >
            {formatSar(total)}
          </span>
        </div>
        {settlement && (
          <>
            {/* NEGATIVE, and shown as such. It is a deduction sitting under a
                total; printed positive it reads as an addition, and the chain
                above it stops being one a customer can check in their head. */}
            <div className="flex items-center justify-between">
              <span className="muted">{t("trips.invoiceSheet.prepaidApplied", lang)}</span>
              <span className="tabular-nums">{formatSar(round2(-settlement.applied))}</span>
            </div>
            <div className="flex items-center justify-between pt-2 mt-1 border-t border-app">
              <span className="font-semibold">{t("trips.invoiceSheet.amountPayable", lang)}</span>
              <span
                className={
                  "text-xl font-semibold tabular-nums " +
                  (settlement.payable > 0
                    ? "text-brand-600 dark:text-brand-300"
                    : "text-emerald-600 dark:text-emerald-400")
                }
              >
                {formatSar(settlement.payable)}
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// TRANSFER DETAILS — where to send the money. Renders nothing when the
// view-model says `null` (no account ticked for the invoice), so the sheet ends
// on Grand Total exactly as it did before 0184 for every customer whose
// operator has not turned this on.
//
// The vm hands over BiLabels because the DOWNLOAD is bilingual. This surface is
// not — the popup renders in the operator's one language, like every other
// label on it — so each label is picked here, not upstream. Same words, one
// column of them.
function TransferDetailsSection({ lang, bank }: { lang: Lang; bank: VmBankBlock | null }) {
  if (!bank) return null;
  const pick = (l: { en: string; ar: string }) => (lang === "ar" ? l.ar : l.en);
  return (
    <section className="space-y-2 break-inside-avoid">
      <h3 className="text-xs font-semibold uppercase tracking-wide muted">{pick(bank.heading)}</h3>
      <div className="card p-4">
        {/* Columns on a wide screen, a stack on a narrow one. Three accounts
            are ALTERNATIVES — pick one and pay — and side-by-side says that
            where a numbered vertical list would read as three steps. The
            `divide-` carries its own colour (CLAUDE.md §6): without it the
            rules stay at preflight #e5e7eb and go wrong in dark mode. */}
        <div className="grid gap-3 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[rgb(var(--border))]">
          {bank.accounts.map((a, i) => (
            <div key={a.id} className={i > 0 ? "pt-3 sm:pt-0 sm:ps-4" : ""}>
              <div className="text-sm leading-snug break-words">
                <span className="font-semibold">{a.bankName || "—"}</span>
                {a.accountName && <span className="muted"> · {a.accountName}</span>}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide muted shrink-0">
                  {pick(bank.ibanLabel)}
                </span>
                {/* The one string on this sheet that gets retyped into a
                    banking app. Explicit LTR + tabular figures so it neither
                    reorders inside the RTL sheet nor wobbles between glyphs. */}
                <span dir="ltr" className="text-sm font-semibold tabular-nums tracking-tight break-all">
                  {a.ibanDisplay || "—"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// v3.1 (item 6) — the Amount-Due hide toggle, moved out of the old Amount Due
// section header and into the top of the Unpaid Trips table (same control,
// same `invoices.hide_amount_due` column, same setHideAmountDue() action —
// just relocated).
//
// PREPAID ONLY. It once rendered in both modes, on the theory that Amount Due
// applies to both. It doesn't, in the sense that matters: the toggle suppresses
// a figure the customer has already paid against from a prepaid balance, and
// postpaid has no balance for it to be paid against — hiding it there would
// hide the invoice's own total from the person being billed. The PDF template
// already agreed, reading `hideAmountDue` in its prepaid branch only; the popup
// was the outlier. One call site now, in the prepaid branch.
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
      className={"inline-flex items-center gap-2 text-xs " + (busy ? "opacity-50 pointer-events-none" : "")}
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

// EXPORTED for InvoicesModal's per-row permanent delete. That list already
// imports this module (it renders InvoiceDetailModal), so this adds no new
// edge and no cycle — InvoiceDetailModal never imports InvoicesModal. It is
// exported rather than copied because a destructive confirmation is exactly
// the thing that must not exist in two visual dialects: one amber panel, one
// rose confirm button, everywhere the app asks "are you sure".
export function GuardBox({
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
  // LEFT ENGLISH ON PURPOSE — the one date in this file the Arabic month sweep
  // did not touch. This is not a screen render: it is spliced into a mailto:
  // body that LEAVES THE BUILDING, and the paragraph below is the rule it obeys
  // — every value except `{buyer}` and the `{date}` FALLBACK WORD is a single
  // Latin string shared by both language blocks, so the two halves can never
  // quote different facts. A translated `returnedOn` would put an Arabic month
  // in the English paragraph too, since `valsAr` spreads `valsEn` and overrides
  // only the fallback. Making it per-block is possible but is a change to
  // exported customer correspondence, not a display tweak, so it is flagged
  // rather than made here.
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
