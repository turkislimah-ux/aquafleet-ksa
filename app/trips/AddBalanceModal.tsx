"use client";

// Add Balance (formerly "top-up") — Batch B restructure. Reworked to match
// the invoice pattern (InvoicesModal's list + InvoiceDetailModal's Mark-Paid
// form), both folded into one file since neither view is reused elsewhere or
// carries invoice-level complexity:
//   - Opened from a customer row: shows that customer's balance-addition
//     HISTORY first (date/method/ref/amount, most recent first), with an
//     "Add Balance" button in the corner that switches to the input form.
//   - Opened from the tab's global "Add Balance" button: no single customer
//     to show history for yet, so this skips straight to the form (which
//     still has the customer picker, same as before this batch).
//
// The form's cash/bank_transfer choice drives which fields are REQUIRED
// (ETF ref + photo required for bank_transfer), mirroring
// app/trips/InvoiceDetailModal.tsx's postpaid Mark-Paid form — but per the
// Batch B follow-up, both fields are shown (and optionally fillable) for
// cash too: cash can still be bank-deposited and carry an ETF ref + slip.
// Calls the restructured recordTopup server action (lib/actions/finance.ts,
// migration 0040) — same FormData-with-file convention as markInvoicePaid.
// Photo viewing (history rows) uses getTopupProofSignedUrl, mirroring
// InvoiceDetailModal's getProofSignedUrl.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Image as ImageIcon } from "lucide-react";
import { Btn, Table, TH, TD } from "@/components/ui";
import { formatSar, todayKey } from "@/lib/utils";
import { recordTopup, getTopupProofSignedUrl } from "@/lib/actions/finance";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export type AddBalanceCustomerOption = { id: string; name: string };

// Just enough of FinanceTab's (page.tsx-sourced) TopupRow to render history —
// kept narrow deliberately, same convention as every other *Lite type here.
export type AddBalanceHistoryRow = {
  id: string;
  amount_sar: number;
  topup_date: string;
  method: "cash" | "bank_transfer" | null;
  reference: string | null;
  // Batch B follow-up — lets the history popup offer a "view photo" link.
  photo_path: string | null;
};

export default function AddBalanceModal({
  open,
  onClose,
  customers,
  // When set, this is the per-row entry point: history-first, customer
  // locked. When null, this is the global entry point: form-first (no
  // history to show yet), customer picker shown.
  fixedCustomer,
  history,
}: {
  open: boolean;
  onClose: () => void;
  customers: AddBalanceCustomerOption[];
  fixedCustomer: AddBalanceCustomerOption | null;
  history: AddBalanceHistoryRow[];
}) {
  const router = useRouter();
  const [view, setView] = useState<"list" | "form">("form");

  const [customerId, setCustomerId] = useState("");
  const [method, setMethod] = useState<"" | "cash" | "bank_transfer">("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayKey());
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [hasPhoto, setHasPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on every open — fresh state each time, seeded with the fixed
  // customer (if any), today's date, and the right starting view.
  useEffect(() => {
    if (!open) return;
    setView(fixedCustomer ? "list" : "form");
    setCustomerId(fixedCustomer?.id ?? "");
    setMethod("");
    setAmount("");
    setDate(todayKey());
    setNote("");
    setReference("");
    setHasPhoto(false);
    setError(null);
  }, [open, fixedCustomer]);

  const canSubmit =
    customerId !== "" &&
    Number(amount) > 0 &&
    date !== "" &&
    method !== "" &&
    // ETF ref + photo are only REQUIRED for bank_transfer — cash may carry
    // them optionally (cash can still be bank-deposited) but isn't blocked
    // without them.
    (method === "cash" || (reference.trim() !== "" && hasPhoto));

  function close() {
    if (saving) return;
    onClose();
  }

  // Mirrors InvoiceDetailModal's onViewProof — short-lived signed URL, never
  // a public link (topup-proofs is a private bucket).
  async function onViewPhoto(topupId: string) {
    const r = await getTopupProofSignedUrl(topupId);
    if (r.error || !r.data) {
      setError(r.error ?? "Could not open photo.");
      return;
    }
    window.open(r.data.url, "_blank", "noopener,noreferrer");
  }

  function openForm() {
    setCustomerId(fixedCustomer?.id ?? "");
    setMethod("");
    setAmount("");
    setDate(todayKey());
    setNote("");
    setReference("");
    setHasPhoto(false);
    setError(null);
    setView("form");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) {
      setError("Pick a customer, method, and enter a positive amount and date.");
      return;
    }
    setSaving(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    form.set("customerId", customerId);
    form.set("amountSar", amount);
    form.set("topupDate", date);
    // Sent as-entered for BOTH methods now — cash keeps whatever ETF ref it
    // was given instead of being blanked (Batch B follow-up).
    form.set("reference", reference);
    const res = await recordTopup(form);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (fixedCustomer) {
      // Back to history, not fully closed — mirrors the invoice list
      // reappearing after a detail action, lets Turki see the new row land.
      setView("list");
      router.refresh();
      return;
    }
    close();
    router.refresh();
  }

  if (!open) return null;

  const title = fixedCustomer ? `Add Balance — ${fixedCustomer.name}` : "Add Balance";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
      <div
        className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={close} className="muted hover:text-[rgb(var(--fg))]">
            <X className="h-5 w-5" />
          </button>
        </div>

        {view === "list" ? (
          <>
            <p className="text-sm muted mb-4">Balance additions for this customer, most recent first.</p>
            <Btn variant="primary" onClick={openForm} className="mb-4">
              <Plus className="h-4 w-4" /> Add Balance
            </Btn>
            {error && <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">{error}</p>}
            {history.length === 0 ? (
              <div className="card p-8 text-center muted text-sm">No balance added yet for this customer.</div>
            ) : (
              <div className="card p-0 overflow-hidden">
                <Table>
                  <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                    <tr>
                      <TH>Date</TH>
                      <TH>Method</TH>
                      <TH>ETF Ref.</TH>
                      <TH>Amount</TH>
                      <TH>Photo</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((t) => (
                      <tr key={t.id}>
                        <TD className="tabular-nums">{t.topup_date}</TD>
                        <TD>
                          {t.method === "cash" ? "Cash" : t.method === "bank_transfer" ? "Bank transfer" : <span className="muted">—</span>}
                        </TD>
                        <TD>{t.reference ? t.reference : <span className="muted">—</span>}</TD>
                        <TD className="tabular-nums">{formatSar(t.amount_sar)}</TD>
                        <TD>
                          {t.photo_path ? (
                            <button
                              type="button"
                              onClick={() => onViewPhoto(t.id)}
                              className="inline-flex items-center gap-1 text-brand-600 hover:underline"
                            >
                              <ImageIcon className="h-3.5 w-3.5" /> View
                            </button>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </TD>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-sm muted mb-4">
              Pre-VAT amount. Adds to the customer&apos;s prepaid balance immediately.
            </p>

            <form onSubmit={onSubmit} className="space-y-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Customer *</span>
                {fixedCustomer ? (
                  <div className={INPUT + " bg-black/[0.03] dark:bg-white/[0.04]"} style={INPUT_STYLE}>
                    {fixedCustomer.name}
                  </div>
                ) : (
                  <select
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    required
                    className={INPUT}
                    style={INPUT_STYLE}
                  >
                    <option value="">Select customer…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>

              {/* Cash / Bank Transfer choice — mirrors InvoiceDetailModal's
                  postpaid Mark-Paid form. Drives which fields below are
                  required, same "flip on method" rule. */}
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="method"
                    value="cash"
                    checked={method === "cash"}
                    onChange={() => setMethod("cash")}
                  />
                  Cash
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="method"
                    value="bank_transfer"
                    checked={method === "bank_transfer"}
                    onChange={() => setMethod("bank_transfer")}
                  />
                  Bank transfer
                </label>
              </div>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Amount (SAR, pre-VAT) *</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  type="number"
                  min="0"
                  step="any"
                  required
                  className={INPUT}
                  style={INPUT_STYLE}
                  placeholder="e.g. 5000"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Date *</span>
                <input
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  type="date"
                  required
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>

              {/* Both fields shown for EITHER method — cash can still be
                  bank-deposited and carry an ETF ref + slip. Only
                  bank_transfer makes them required (asterisk + `required`
                  flip on method, same rule as before, just no longer hides
                  the fields for cash). */}
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">
                  ETF Ref. number{method === "bank_transfer" ? " (required) *" : " (optional)"}
                </span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  required={method === "bank_transfer"}
                  className={INPUT}
                  style={INPUT_STYLE}
                  placeholder="e.g. bank transfer ref"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">
                  Photo{method === "bank_transfer" ? " of transfer (required) *" : " (optional)"}
                </span>
                <input
                  type="file"
                  name="photoFile"
                  required={method === "bank_transfer"}
                  onChange={(e) => setHasPhoto(!!e.target.files?.length)}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Note</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  name="note"
                  rows={2}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>

              {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-app">
                <Btn type="button" variant="ghost" onClick={() => (fixedCustomer ? setView("list") : close())}>
                  Cancel
                </Btn>
                <Btn
                  type="submit"
                  variant="primary"
                  className={!canSubmit || saving ? "opacity-50 pointer-events-none" : ""}
                >
                  {saving ? "Adding…" : "Add Balance"}
                </Btn>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
