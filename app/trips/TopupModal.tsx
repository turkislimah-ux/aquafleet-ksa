"use client";

// Record-a-topup form (Finance tab). Calls the existing recordTopup server
// action (lib/actions/finance.ts) — inserts into customer_topups, pre-VAT.
// Two entry points, same modal:
//   - a specific row's "Record top-up" button → customer preselected/locked.
//   - the tab's global "Record top-up" button → customer is a picker,
//     PREPAID customers only (postpaid customers don't run a balance).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Btn } from "@/components/ui";
import { todayKey } from "@/lib/utils";
import { recordTopup } from "@/lib/actions/finance";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export type TopupCustomerOption = { id: string; name: string };

export default function TopupModal({
  open,
  onClose,
  customers,
  // When set, the customer is fixed (opened from a table row) and the picker
  // is hidden. When null, the picker is shown (global "Record top-up").
  fixedCustomer,
}: {
  open: boolean;
  onClose: () => void;
  customers: TopupCustomerOption[];
  fixedCustomer: TopupCustomerOption | null;
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayKey());
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on every open — fresh form each time, seeded with the fixed customer
  // (if any) and today's date.
  useEffect(() => {
    if (!open) return;
    setCustomerId(fixedCustomer?.id ?? "");
    setAmount("");
    setDate(todayKey());
    setNote("");
    setReference("");
    setError(null);
  }, [open, fixedCustomer]);

  const canSubmit = customerId !== "" && Number(amount) > 0 && date !== "";

  function close() {
    if (saving) return;
    onClose();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) {
      setError("Pick a customer and enter a positive amount and date.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await recordTopup({
      customerId,
      amountSar: Number(amount),
      topupDate: date,
      note: note || null,
      reference: reference || null,
    });
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    close();
    router.refresh();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
      <div
        className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Record top-up</h2>
          <button type="button" onClick={close} className="muted hover:text-[rgb(var(--fg))]">
            <X className="h-5 w-5" />
          </button>
        </div>
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

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Reference</span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className={INPUT}
              style={INPUT_STYLE}
              placeholder="e.g. bank transfer ref, invoice #"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Note</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className={INPUT}
              style={INPUT_STYLE}
            />
          </label>

          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-app">
            <Btn type="button" variant="ghost" onClick={close}>
              Cancel
            </Btn>
            <Btn
              type="submit"
              variant="primary"
              className={!canSubmit || saving ? "opacity-50 pointer-events-none" : ""}
            >
              {saving ? "Recording…" : "Record top-up"}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  );
}
