"use client";

// BALANCE RETURN — the Archive's refund door, and since the 0206 app cutover
// it IS the ledger's refund door: recordRefund -> record_refund (0204), the
// same RPC the Finance tab's ledger popup drives. The refund writes a
// customer_ledger row with a credit-note number and shows up on the ledger and
// the statement like any refund — no separate returns table, no mark that has
// to be reconciled with a balance it did not move.
//
// **THERE IS STILL NO AMOUNT FIELD.** The figure shown is the customer's
// Available — the exact cap record_refund enforces under the customer row
// lock — and the whole of it is what this popup submits. A number typed here
// would be a second opinion about a figure the database owns; if Available
// moves between render and save, the RPC refuses and its message is shown
// VERBATIM (Turki's ruling), which is the correct outcome of the race.
//
// Proof rule is the RPC's, mirrored client-side so the button is never
// enabled into a refusal: a bank transfer requires an ETF reference AND a
// photo; cash carries both optionally.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Btn } from "@/components/ui";
import { formatSar } from "@/lib/utils";
import { recordRefund } from "@/lib/actions/finance";
import { prepareUploadFiles } from "@/lib/upload-image";
import type { ArchiveCustomerRow, ArchiveCustomerFundsRow } from "@/lib/db-types";
import { useApp } from "@/components/AppShell";
import { t, fill } from "@/lib/i18n";
import ScrollLock from "@/components/ScrollLock";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export default function ReturnBalanceModal({
  open,
  customer,
  funds,
  onClose,
}: {
  open: boolean;
  customer: ArchiveCustomerRow | null;
  // The funds row for THIS customer. Its Available is displayed AND submitted
  // as the refund amount — the RPC re-checks the cap under the row lock, so a
  // stale figure is refused, never silently honoured.
  funds: ArchiveCustomerFundsRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { lang } = useApp();
  const [method, setMethod] = useState<"" | "cash" | "bank_transfer">("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  // The PREPARED file (image → WebP, compressed; PDF/other untouched), not the
  // raw pick — the raw bytes never leave the browser. photoKey remounts the
  // input when a pick is rejected, so the same file can be re-picked.
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoKey, setPhotoKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seeded per customer, not just per open: this popup is launched from a
  // table of many rows, and a method left over from the previous customer is
  // the kind of carry-over nobody re-reads before pressing the button.
  useEffect(() => {
    if (!open) return;
    setMethod("");
    setReference("");
    setNote("");
    setPhoto(null);
    setPhotoKey((k) => k + 1);
    setSaving(false);
    setError(null);
  }, [open, customer]);

  // The RPC's own proof rule, client half: cash needs neither reference nor
  // photo, a transfer needs both. There must also be something to refund —
  // record_refund refuses a non-positive amount before it checks anything
  // else, so a 0-Available row never reaches the server from here.
  const canSubmit =
    method !== "" &&
    (funds?.available_sar ?? 0) > 0 &&
    (method === "cash" || (reference.trim() !== "" && photo !== null));

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
    // THE WHOLE AVAILABLE, from the same row the figure above renders. The
    // RPC re-reads Available under the customer row lock and refuses anything
    // over it, so a figure gone stale between render and save is an error
    // shown verbatim below — never a wrong payout.
    form.set("amountSar", String(funds?.available_sar ?? 0));
    form.set("reference", reference);
    // The PREPARED file replaces the input's own raw-bytes entry — what
    // uploads is exactly what the state (and the gates) saw.
    if (photo) form.set("photoFile", photo);
    else form.delete("photoFile");
    // try/catch: a network drop mid-await otherwise leaves the button stuck
    // on busy with no message — the finally owns the busy flag now.
    try {
      const res = await recordRefund(form);
      if (res.error) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setError(t("shared.upload.saveFailedNetwork", lang));
    } finally {
      setSaving(false);
    }
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
            {funds ? formatSar(funds.available_sar) : "—"}
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
                // Prepared at PICK time: image → compressed WebP (orientation
                // kept), PDF/other untouched; undecodable or still-over-10MB
                // is refused HERE, by name, not after Save.
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
