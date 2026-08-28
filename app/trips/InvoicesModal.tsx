"use client";

// Per-customer invoice history + "new draft" entry point (Finance 5c).
// Opened from FinanceTab's "Invoices" row action. Own local list state
// (fetched via listInvoicesForCustomer) since invoice history is naturally
// lazy — not part of the page's bulk server-fetched props.
//
// Drills into InvoiceDetailModal (the actual lifecycle workspace) for both
// a freshly-created draft and any existing invoice in the list.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Plus } from "lucide-react";
import { Btn, StatusPill, Table, TH, TD } from "@/components/ui";
import { formatSar, todayKey } from "@/lib/utils";
import { type Invoice } from "@/lib/db-types";
import { createDraftInvoice, listInvoicesForCustomer } from "./invoiceActions";
import InvoiceDetailModal from "./InvoiceDetailModal";
import ScrollLock from "@/components/ScrollLock";
import { useApp } from "@/components/AppShell";
import { t, fill } from "@/lib/i18n";
import { invoiceStatusLabel } from "@/lib/enum-labels";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.id]);

  function close() {
    if (saving) return;
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

  if (!open || !customer) return null;

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
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
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
                          <Btn variant="outline" onClick={() => setSelectedInvoiceId(inv.id)}>
                            {t("trips.invoices.open", lang)}
                          </Btn>
                        </TD>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )
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
