"use client";

// Per-customer invoice history + "new draft" entry point (Finance 5c).
// Opened from FinanceTab's "Invoices" row action. Own local list state
// (fetched via listInvoicesForCustomer) since invoice history is naturally
// lazy — not part of the page's bulk server-fetched props.
//
// Drills into InvoiceDetailModal (the actual lifecycle workspace) for both
// a freshly-created draft and any existing invoice in the list.

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Trash2 } from "lucide-react";
import { Btn, StatusPill, Table, TH, TD } from "@/components/ui";
import { cn, formatSar, todayKey } from "@/lib/utils";
import { type Invoice } from "@/lib/db-types";
import { createDraftInvoice, deleteDraftInvoice, listInvoicesForCustomer } from "./invoiceActions";
import InvoiceDetailModal, { GuardBox } from "./InvoiceDetailModal";
import ScrollLock from "@/components/ScrollLock";
import { useApp } from "@/components/AppShell";
import { t, fill } from "@/lib/i18n";
import { invoiceStatusLabel } from "@/lib/enum-labels";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// UNFINALISED = still mutable, and still HOLDING. Both statuses reserve their
// trips and consume a prepaid customer's balance through their special
// charges; only 'confirmed' onwards is a document. Same two statuses
// discard_invoice accepts since 0182, deliberately — the wash marks
// exactly the rows the delete button appears on, so the cue and the capability
// never disagree.
const isUnfinalized = (status: string) => status === "draft" || status === "review";

// The amber wash. Values are preview/'s warn vocabulary, not picked by eye:
// amber-500 is #f59e0b, preview's single warn hue (app.css `.pill-warn .dot`,
// `.col-loading`, `.insight-warn`), and Tailwind's amber is not overridden in
// tailwind.config.ts, so the token resolves to that exact hex.
//   resting light .06  — preview `.insight-warn` background, its faded-warn surface
//   resting dark  .10  — this app's own in-modal row tint (SalaryHistoryModal)
//   hover  light  .12  — preview `.pill-warn` background
//   hover  dark   .16  — preview `.modal-body .pill-ok` / `.pill-info` alpha
// Kept as classes rather than an inline `style`, because an inline background
// beats every class and would kill the row's hover response outright.
// Split from the hover so the confirmation row below can carry the wash
// WITHOUT it: a background that shifts under an open guard panel reads as a
// second thing happening while the operator is deciding.
const ROW_UNFINALIZED_BG = "bg-amber-500/[0.06] dark:bg-amber-500/[0.10]";
const ROW_UNFINALIZED_HOVER = "hover:bg-amber-500/[0.12] dark:hover:bg-amber-500/[0.16]";
const ROW_PLAIN = "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]";

// settledBalance: prepaid customers only (Finance tab's per-row figure,
// already computed there — passed through unchanged so InvoiceDetailModal's
// "Pay with Balance" confirmation can display it without recomputing.
// undefined/null for postpaid (no balance concept).
export type InvoiceCustomer = { id: string; name: string; email: string | null; settledBalance?: number | null };

export default function InvoicesModal({
  open,
  onClose,
  customer,
  initialInvoiceId = null,
}: {
  open: boolean;
  onClose: () => void;
  customer: InvoiceCustomer | null;
  /**
   * Global search deep link (?focus=invoice:<id>): open straight into this
   * invoice's detail rather than the customer's invoice list. Applied ONCE
   * per open — see the consumed ref below for why that matters.
   */
  initialInvoiceId?: string | null;
}) {
  const router = useRouter();
  const { lang } = useApp();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [periodStart, setPeriodStart] = useState(todayKey());
  const [periodEnd, setPeriodEnd] = useState(todayKey());
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  // Permanent delete, one row at a time. Holding the id (not a boolean) is what
  // keeps the confirmation anchored to the row it belongs to — opening a second
  // one closes the first, so two guards can never be armed at once.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Deep-link focus, applied once per open. A plain effect on
  // (invoices, initialInvoiceId) would re-select the invoice the instant the
  // user closed its detail — selectedInvoiceId goes back to null, the deps
  // have not changed, so the effect fires again and the modal reopens itself.
  // The ref records that this arrival has already been honoured.
  const focusConsumedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      focusConsumedRef.current = null;
      return;
    }
    if (!initialInvoiceId || focusConsumedRef.current === initialInvoiceId) return;
    // Only after the list has actually loaded, and only if the invoice is
    // really in it — a stale link should land on the list, not on an empty
    // detail modal.
    if (!invoices.some((i) => i.id === initialInvoiceId)) return;
    focusConsumedRef.current = initialInvoiceId;
    setSelectedInvoiceId(initialInvoiceId);
  }, [open, initialInvoiceId, invoices]);

  async function load() {
    if (!customer) return;
    setLoading(true);
    setError(null);
    const r = await listInvoicesForCustomer(customer.id);
    if (r.error) {
      setError(r.error);
    } else {
      setInvoices(r.data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!open || !customer) return;
    setCreating(false);
    setCreateError(null);
    setPeriodStart(todayKey());
    setPeriodEnd(todayKey());
    setSelectedInvoiceId(null);
    setConfirmingDeleteId(null);
    setDeleteError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.id]);

  function close() {
    if (saving || deleting) return;
    onClose();
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!customer || periodStart > periodEnd) {
      setCreateError(t("trips.invoices.badPeriod", lang));
      return;
    }
    setSaving(true);
    setCreateError(null);
    const res = await createDraftInvoice(customer.id, periodStart, periodEnd);
    setSaving(false);
    if (res.error || !res.data) {
      // `res.error` is the SERVER's own message and stays English; the fallback
      // is ours, so it translates.
      setCreateError(res.error ?? t("trips.invoices.createFailed", lang));
      return;
    }
    setCreating(false);
    setSelectedInvoiceId(res.data.id);
    router.refresh();
  }

  // PERMANENT. deleteDraftInvoice calls discard_invoice (named
  // delete_draft_invoice until 0183), which since 0182
  // accepts draft OR review: it nulls trips.invoice_id for this invoice and
  // deletes the row, and invoice_special_charges goes with it through the FK's
  // ON DELETE CASCADE — which is what frees the customer's held balance.
  //
  // TWO REFRESHES, BOTH NEEDED, AND THEY ARE NOT THE SAME REFRESH. load() is
  // this modal's own list, fetched client-side; router.refresh() re-pulls the
  // Trips page's server props, which is where the released trips and the
  // recomputed balance actually live. Dropping either one leaves half the
  // screen showing money and trips the database no longer holds.
  //
  // No status check here. The server owns that gate, and duplicating it in the
  // client would be a second place for the rule to drift — the button is simply
  // not rendered on rows the RPC would reject.
  async function onDelete(invoiceId: string) {
    setDeleting(true);
    setDeleteError(null);
    const res = await deleteDraftInvoice(invoiceId);
    setDeleting(false);
    if (res.error) {
      // The server's own message, English — same convention as onCreate.
      setDeleteError(res.error);
      return;
    }
    setConfirmingDeleteId(null);
    await load();
    router.refresh();
  }

  if (!open || !customer) return null;

  const anyUnfinalized = invoices.some((i) => isUnfinalized(i.status));

  return (
    <>
      <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
        <ScrollLock />
        {/* 1080px = this app's size:lg popup width (InventoryClient.tsx:130).
            Widened from max-w-2xl: six columns (Period / Status / Invoice # /
            Grand Total / Amount Due / actions) plus two money figures that must
            stay on one line each do not fit in 672px. */}
        <div className="card p-6 w-full max-w-[1080px] max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold">
              {fill(t("trips.invoices.title", lang), { name: customer.name })}
            </h2>
            <button type="button" onClick={close} className="muted hover:text-[rgb(var(--fg))]">
              <X className="h-5 w-5" />
            </button>
          </div>
          <p className="text-sm muted mb-4">{t("trips.invoices.subtitle", lang)}</p>

          {!creating ? (
            <Btn variant="primary" onClick={() => setCreating(true)} className="mb-4">
              <Plus className="h-4 w-4" /> {t("trips.invoices.newInvoice", lang)}
            </Btn>
          ) : (
            <form onSubmit={onCreate} className="mb-4 space-y-3 rounded-lg border border-app p-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{t("trips.invoices.fPeriodStart", lang)} *</span>
                  <input value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} type="date" required className={INPUT} style={INPUT_STYLE} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{t("trips.invoices.fPeriodEnd", lang)} *</span>
                  <input value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} type="date" required className={INPUT} style={INPUT_STYLE} />
                </label>
              </div>
              <p className="text-xs muted">{t("trips.invoices.periodHint", lang)}</p>
              {createError && <p className="text-sm text-rose-600 dark:text-rose-400">{createError}</p>}
              <div className="flex items-center justify-end gap-2">
                <Btn type="button" variant="ghost" onClick={() => setCreating(false)}>
                  {t("common.cancel", lang)}
                </Btn>
                <Btn type="submit" variant="primary" className={saving ? "opacity-50 pointer-events-none" : ""}>
                  {t(saving ? "trips.invoices.creating" : "trips.invoices.createDraft", lang)}
                </Btn>
              </div>
            </form>
          )}

          {loading && <div className="p-6 text-center muted text-sm">{t("common.loading", lang)}</div>}
          {error && <div className="p-6 text-center text-sm text-rose-600 dark:text-rose-400">{error}</div>}

          {!loading && !error && (
            invoices.length === 0 ? (
              <div className="card p-8 text-center muted text-sm">{t("trips.invoices.empty", lang)}</div>
            ) : (
              <div className="card p-0 overflow-hidden">
                <Table>
                  <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                    <tr>
                      <TH>{t("trips.invoices.colPeriod", lang)}</TH>
                      <TH>{t("common.status", lang)}</TH>
                      <TH>{t("trips.invoices.colNumber", lang)}</TH>
                      <TH>{t("trips.invoices.colGrandTotal", lang)}</TH>
                      <TH>{t("trips.invoices.colAmountDue", lang)}</TH>
                      <TH></TH>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => {
                      const unfinalized = isUnfinalized(inv.status);
                      const confirming = confirmingDeleteId === inv.id;
                      return (
                        <Fragment key={inv.id}>
                          <tr className={cn(unfinalized ? [ROW_UNFINALIZED_BG, ROW_UNFINALIZED_HOVER] : ROW_PLAIN)}>
                            <TD>
                              {inv.period_start} → {inv.period_end}
                            </TD>
                            <TD>
                              <StatusPill status={inv.status} label={invoiceStatusLabel(inv.status, lang)} />
                            </TD>
                            <TD>{inv.invoice_number ?? <span className="muted">—</span>}</TD>
                            <TD className="tabular-nums">{formatSar(inv.grand_total_sar)}</TD>
                            <TD className="tabular-nums">{formatSar(inv.amount_due_sar)}</TD>
                            <TD>
                              <div className="flex items-center gap-2">
                                <Btn variant="outline" onClick={() => setSelectedInvoiceId(inv.id)}>
                                  {t("trips.invoices.open", lang)}
                                </Btn>
                                {/* Only on rows the RPC would accept. A confirmed
                                    or paid invoice is a document — it leaves by
                                    Void, never by delete. */}
                                {unfinalized && (
                                  <Btn
                                    variant="ghost"
                                    onClick={() => {
                                      setDeleteError(null);
                                      setConfirmingDeleteId(confirming ? null : inv.id);
                                    }}
                                    disabled={deleting}
                                    className="text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    {t("trips.invoices.discard", lang)}
                                  </Btn>
                                )}
                              </div>
                            </TD>
                          </tr>

                          {/* The confirmation is its own full-width row rather
                              than a popup: it sits directly under the invoice it
                              will destroy, so the period and total being deleted
                              stay on screen while the operator decides, and it
                              adds no second stacking layer over an already
                              stacked modal. */}
                          {confirming && (
                            <tr className={ROW_UNFINALIZED_BG}>
                              <td colSpan={6} className="px-3 pb-3">
                                <GuardBox
                                  lang={lang}
                                  warning={t("trips.invoices.guardDiscard", lang)}
                                  busy={deleting}
                                  confirmLabel={t("trips.invoices.confirmDiscard", lang)}
                                  onCancel={() => setConfirmingDeleteId(null)}
                                  onConfirm={() => onDelete(inv.id)}
                                />
                                {deleteError && (
                                  <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{deleteError}</p>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            )
          )}

          {/* Says what the wash means. Rendered only when something is actually
              washed — a permanent legend for an absent colour is noise. */}
          {!loading && !error && anyUnfinalized && (
            <p className="mt-2 text-xs muted">{t("trips.invoices.unfinalizedHint", lang)}</p>
          )}
        </div>
      </div>

      <InvoiceDetailModal
        open={selectedInvoiceId !== null}
        invoiceId={selectedInvoiceId}
        customerEmail={customer.email}
        settledBalance={customer.settledBalance ?? null}
        onClose={() => {
          setSelectedInvoiceId(null);
          onClose();
        }}
        onBack={() => setSelectedInvoiceId(null)}
        onMutated={load}
      />
    </>
  );
}
