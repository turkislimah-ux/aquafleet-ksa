"use client";

// The Add Balance INPUT FORM — lifted out of AddBalanceModal because two
// surfaces now offer the same top-up and neither may carry its own copy of it:
//   - AddBalanceModal's "form" view (the popup this came from), and
//   - CustomerLedgerModal's Add Balance panel, beside Refund and Propose
//     Correction, where the customer is already fixed by the popup.
//
// What it owns: the fields, the cash/bank_transfer required-flip (ETF ref +
// photo required for bank_transfer only, both still offered for cash — a cash
// payment can still be bank-deposited and carry an ETF ref + slip), the
// canSubmit gate, the client-side image preparation, and the recordTopup call.
//
// What it does NOT own: the receipt. record_topup's returned row goes straight
// to `onSuccess`, and each host presents it in its own shell — a full "done"
// view in AddBalanceModal, one inline line inside the panel in the ledger
// popup. `onBusyChange` exists for the same reason: each host blocks its own
// dismiss while a save is in flight, and the flag lives here.
//
// router.refresh() runs HERE, immediately after a successful save, so every
// host sees fresh figures without having to remember to ask — that is what
// keeps the ledger popup's rows and stat strip current under the open panel.
//
// The form has no reset of its own: every host mounts it fresh (a changed
// `key`, or an unmount on view change) when a blank form is wanted.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Btn } from "@/components/ui";
import { todayKey } from "@/lib/utils";
import { recordTopup, type LedgerDocResult } from "@/lib/actions/finance";
import { prepareUploadFiles } from "@/lib/upload-image";
import { useApp } from "@/components/AppShell";
import { t, fill } from "@/lib/i18n";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export type AddBalanceCustomerOption = { id: string; name: string };

export default function AddBalanceForm({
  customers,
  // When set, the customer is decided by the host (a per-customer popup) and
  // shows as a read-only field instead of the picker.
  fixedCustomer,
  // record_topup's own returned row, plus the name the receipt prints under —
  // the row carries no customer name and the host may not know which option
  // was picked.
  onSuccess,
  onCancel,
  onBusyChange,
}: {
  customers: AddBalanceCustomerOption[];
  fixedCustomer: AddBalanceCustomerOption | null;
  onSuccess: (receipt: LedgerDocResult, customerName: string) => void;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const router = useRouter();
  const { lang } = useApp();

  const [customerId, setCustomerId] = useState(fixedCustomer?.id ?? "");
  const [method, setMethod] = useState<"" | "cash" | "bank_transfer">("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayKey());
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  // The PREPARED file (image → WebP, compressed; PDF/other untouched), not the
  // raw pick — the raw bytes never leave the browser. photoKey remounts the
  // input when a pick is rejected, so the same file can be re-picked.
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoKey, setPhotoKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    customerId !== "" &&
    Number(amount) > 0 &&
    date !== "" &&
    method !== "" &&
    // ETF ref + photo are only REQUIRED for bank_transfer — cash may carry
    // them optionally (cash can still be bank-deposited) but isn't blocked
    // without them.
    (method === "cash" || (reference.trim() !== "" && photo !== null));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) {
      setError(t("trips.addBalance.errIncomplete", lang));
      return;
    }
    setSaving(true);
    onBusyChange(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    form.set("customerId", customerId);
    form.set("amountSar", amount);
    form.set("topupDate", date);
    // Sent as-entered for BOTH methods now — cash keeps whatever ETF ref it
    // was given instead of being blanked (Batch B follow-up).
    form.set("reference", reference);
    // The PREPARED file replaces the input's own raw-bytes entry — what
    // uploads is exactly what the state (and the gates) saw.
    if (photo) form.set("photoFile", photo);
    else form.delete("photoFile");
    // try/catch: a network drop mid-await otherwise leaves the button stuck
    // on busy with no message — the finally owns the busy flag now.
    try {
      const res = await recordTopup(form);
      if (res.error || !res.data) {
        setError(res.error ?? t("shared.upload.saveFailedNetwork", lang));
        return;
      }
      // The receipt number exists the moment record_topup returns — the host
      // shows it (and offers the print) before anything closes. The refresh
      // runs now so whatever list or figure the host renders is current.
      const name = fixedCustomer?.name ?? customers.find((c) => c.id === customerId)?.name ?? "";
      onSuccess(res.data, name);
      router.refresh();
    } catch {
      setError(t("shared.upload.saveFailedNetwork", lang));
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{t("common.customer", lang)} *</span>
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
            <option value="">{t("trips.addBalance.selectCustomer", lang)}</option>
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
          {t("labels.payCash", lang)}
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="method"
            value="bank_transfer"
            checked={method === "bank_transfer"}
            onChange={() => setMethod("bank_transfer")}
          />
          {t("labels.payBankTransfer", lang)}
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{t("trips.addBalance.fAmount", lang)} *</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number"
          min="0"
          step="any"
          required
          className={INPUT}
          style={INPUT_STYLE}
          placeholder={t("trips.addBalance.amountPlaceholder", lang)}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{t("common.date", lang)} *</span>
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
          {t("trips.addBalance.fEtfRef", lang)}
          {method === "bank_transfer"
            ? t("trips.addBalance.suffixRequired", lang)
            : t("trips.addBalance.suffixOptional", lang)}
        </span>
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          required={method === "bank_transfer"}
          className={INPUT}
          style={INPUT_STYLE}
          placeholder={t("trips.addBalance.refPlaceholder", lang)}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">
          {t("trips.addBalance.fPhoto", lang)}
          {method === "bank_transfer"
            ? t("trips.addBalance.suffixPhotoRequired", lang)
            : t("trips.addBalance.suffixOptional", lang)}
        </span>
        <input
          key={photoKey}
          type="file"
          name="photoFile"
          required={method === "bank_transfer"}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (!f) {
              setPhoto(null);
              setError(null);
              return;
            }
            // Prepared at PICK time: image → compressed WebP
            // (orientation kept), PDF/other untouched; undecodable or
            // still-over-10MB is refused HERE, by name, not after Save.
            void (async () => {
              const r = await prepareUploadFiles([f]);
              if (!r.ok) {
                setPhoto(null);
                setError(fill(t(r.errorKey, lang), { name: r.name }));
                setPhotoKey((k) => k + 1);
                return;
              }
              setError(null);
              setPhoto(r.files[0] ?? null);
            })();
          }}
          className={INPUT}
          style={INPUT_STYLE}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{t("common.note", lang)}</span>
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
        <Btn type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel", lang)}
        </Btn>
        <Btn
          type="submit"
          variant="primary"
          className={!canSubmit || saving ? "opacity-50 pointer-events-none" : ""}
        >
          {t(saving ? "trips.addBalance.adding" : "trips.finance.addBalance", lang)}
        </Btn>
      </div>
    </form>
  );
}
