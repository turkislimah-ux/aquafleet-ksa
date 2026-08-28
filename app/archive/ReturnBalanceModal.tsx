"use client";

// BALANCE RETURN — the OUTBOUND counterpart of app/trips/AddBalanceModal.tsx,
// and deliberately its mirror image: same two methods, same "a transfer carries
// an ETF reference AND a photo of it" rule, same shell, same footer. Money
// leaving is held to the standard money arriving is held to.
//
// **THERE IS NO AMOUNT FIELD, AND ONE MUST NEVER BE ADDED.** The figure is read
// by return_customer_balance() from v_customer_amount_payable and frozen into
// the row (0139). A number typed here would be a second opinion about a figure
// the database already holds, and the only outcomes of a disagreement are paying
// back the wrong sum or recording a return that does not match what was paid.
// The amount is therefore SHOWN — read-only, from the same view row the table
// behind this popup renders — so the person confirming can see what they are
// about to hand over, without being able to change it.
//
// RECORDING IS NOT DEDUCTING: this writes the MARK that the credit went back.
// The balance figure is deliberately unchanged afterwards (lib/actions/finance.ts
// says the same on the action itself), which is exactly why the "Returned" mark
// has to travel beside the figure everywhere it is shown.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Btn } from "@/components/ui";
import { formatSar, todayKey } from "@/lib/utils";
import { returnCustomerBalance } from "@/lib/actions/finance";
import type { ArchiveCustomerRow, CustomerAmountPayableRow } from "@/lib/db-types";
import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";
import ScrollLock from "@/components/ScrollLock";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export default function ReturnBalanceModal({
  open,
  customer,
  payable,
  onClose,
}: {
  open: boolean;
  customer: ArchiveCustomerRow | null;
  // The view row for THIS customer. Its amount is displayed, never submitted —
  // the RPC re-reads it server-side and freezes its own copy.
  payable: CustomerAmountPayableRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { lang } = useApp();
  const [method, setMethod] = useState<"" | "cash" | "bank_transfer">("");
  const [returnedOn, setReturnedOn] = useState(todayKey());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [hasPhoto, setHasPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seeded per customer, not just per open: this popup is launched from a
  // table of many rows, and a method left over from the previous customer is
  // the kind of carry-over nobody re-reads before pressing the button.
  useEffect(() => {
    if (!open) return;
    setMethod("");
    setReturnedOn(todayKey());
    setReference("");
    setNote("");
    setHasPhoto(false);
    setSaving(false);
    setError(null);
  }, [open, customer]);

  // Byte-equivalent to AddBalanceModal's rule, minus the amount: cash needs
  // neither reference nor photo, a transfer needs both. The server action and
  // the table's own CHECK constraint enforce the same thing — this is the
  // client half, so the button is never enabled into a refusal.
  const canSubmit =
    method !== "" &&
    returnedOn !== "" &&
    (method === "cash" || (reference.trim() !== "" && hasPhoto));

  function close() {
    if (saving) return;
    onClose();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!customer) return;
    if (!canSubmit) {
      setError(t("archive.ret.validation", lang));
      return;
    }
    setSaving(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    form.set("customerId", customer.id);
    form.set("returnedOn", returnedOn);
    form.set("reference", reference);
    const res = await returnCustomerBalance(form);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onClose();
    router.refresh();
  }

  if (!open || !customer) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
      <ScrollLock />
      <div
        className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">{t("archive.ret.title", lang)}</h2>
          <button type="button" onClick={close} className="muted hover:text-[rgb(var(--fg))]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-xs muted mb-4">
          {customer.name}
          {customer.name_ar ? ` · ${customer.name_ar}` : ""}
        </p>

        {/* READ-ONLY, and prominent: this is the one figure the person doing
            the payout is checking against the cash or the transfer screen in
            front of them. It is not an input — see this file's header. */}
        <div
          className="rounded-xl border p-3 mb-4"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <div className="text-[11px] muted uppercase tracking-wide">
            {t("archive.ret.amountToReturn", lang)}
          </div>
          <div className="text-2xl font-semibold tabular-nums mt-0.5">
            {payable ? formatSar(payable.amount_payable_sar) : "—"}
          </div>
          <div className="text-[11px] muted mt-1">
            {t("archive.ret.amountNote", lang)}
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="method"
                value="cash"
                checked={method === "cash"}
                onChange={() => setMethod("cash")}
              />
              {t("archive.ret.method.cash", lang)}
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="method"
                value="bank_transfer"
                checked={method === "bank_transfer"}
                onChange={() => setMethod("bank_transfer")}
              />
              {t("archive.ret.method.bank_transfer", lang)}
            </label>
          </div>

          <label className="flex flex-col gap-1.5 text-sm">
            {/* The required asterisk stays a bare literal beside the label, the
                way every other converted form in the app marks one. */}
            <span className="font-medium">{t("archive.ret.fReturnedOn", lang)} *</span>
            <input
              value={returnedOn}
              onChange={(e) => setReturnedOn(e.target.value)}
              type="date"
              required
              className={INPUT}
              style={INPUT_STYLE}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            {/* Keyed off the FORM STATE, not off the rendered label — the same
                rule the radios above follow. */}
            <span className="font-medium">
              {t(
                method === "bank_transfer"
                  ? "archive.ret.fRefNumber.required"
                  : "archive.ret.fRefNumber.optional",
                lang,
              )}
            </span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              required={method === "bank_transfer"}
              className={INPUT}
              style={INPUT_STYLE}
              placeholder={t("archive.ret.refPlaceholder", lang)}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">
              {t(
                method === "bank_transfer"
                  ? "archive.ret.fPhoto.required"
                  : "archive.ret.fPhoto.optional",
                lang,
              )}
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
            <span className="font-medium">{t("common.note", lang)}</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} name="note" rows={2}
              className={INPUT} style={INPUT_STYLE} />
          </label>

          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-app">
            <Btn type="button" variant="ghost" onClick={close}>
              {t("common.cancel", lang)}
            </Btn>
            <Btn
              type="submit"
              variant="primary"
              className={!canSubmit || saving ? "opacity-50 pointer-events-none" : ""}
            >
              {t(saving ? "common.recording" : "archive.ret.submit", lang)}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  );
}
