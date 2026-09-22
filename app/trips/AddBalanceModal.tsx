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
// Photo viewing (history rows) uses getLedgerPhotoSignedUrl, mirroring
// InvoiceDetailModal's getProofSignedUrl.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Printer, Image as ImageIcon } from "lucide-react";
import { Btn, Table, TH, TD } from "@/components/ui";
import { formatSar, todayKey } from "@/lib/utils";
import { recordTopup, getLedgerPhotoSignedUrl, type LedgerDocResult } from "@/lib/actions/finance";
import { prepareUploadFiles, uploadErrorVars } from "@/lib/upload-image";
// The printable RCT sheet (0203) — view-model decides the words, docs kit the
// look, printHtml the iframe. Same trio every other document print uses.
import { buildLedgerDocVm } from "@/lib/docvm/ledgerDoc";
import { buildLedgerDocHtml } from "@/lib/docs/ledgerDoc";
import { printHtml } from "@/lib/printHtml";
import type { CompanySettings } from "@/lib/db-types";
import ScrollLock from "@/components/ScrollLock";
import { useApp } from "@/components/AppShell";
import { t, fill } from "@/lib/i18n";
// The history row's method cell reads the ENUM VALUE through this helper.
// `db-types`'s own label map is not imported and not edited.
import { paymentMethodLabel } from "@/lib/enum-labels";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export type AddBalanceCustomerOption = { id: string; name: string };

// One history row — a customer_ledger topup (0206 app cutover: the legacy
// customer_topups arm and its era tag are gone with the table's readers).
// Photos live behind getLedgerPhotoSignedUrl; the RCT number is doc_number.
export type AddBalanceHistoryRow = {
  id: string;
  amount_sar: number;
  topup_date: string;
  method: "cash" | "bank_transfer" | null;
  reference: string | null;
  photo_path: string | null;
  doc_number: string | null;
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
  // Letterhead for the printable receipt. null prints an unheaded sheet
  // rather than blocking (lib/docvm/ledgerDoc.ts).
  company,
}: {
  open: boolean;
  onClose: () => void;
  customers: AddBalanceCustomerOption[];
  fixedCustomer: AddBalanceCustomerOption | null;
  history: AddBalanceHistoryRow[];
  company: CompanySettings | null;
}) {
  const router = useRouter();
  const { lang } = useApp();
  // "done" (new, 0203): the moment record_topup returns, the receipt number
  // exists — this view says so and offers the print before anything closes.
  const [view, setView] = useState<"list" | "form" | "done">("form");
  const [receipt, setReceipt] = useState<LedgerDocResult | null>(null);

  const [customerId, setCustomerId] = useState("");
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
    setPhoto(null);
    setPhotoKey((k) => k + 1);
    setError(null);
    setReceipt(null);
  }, [open, fixedCustomer]);

  const canSubmit =
    customerId !== "" &&
    Number(amount) > 0 &&
    date !== "" &&
    method !== "" &&
    // ETF ref + photo are only REQUIRED for bank_transfer — cash may carry
    // them optionally (cash can still be bank-deposited) but isn't blocked
    // without them.
    (method === "cash" || (reference.trim() !== "" && photo !== null));

  function close() {
    if (saving) return;
    onClose();
  }

  // Mirrors InvoiceDetailModal's onViewProof — short-lived signed URL, never
  // a public link (topup-proofs is a private bucket). Every row is a
  // customer_ledger id now; the legacy customer_topups routing is gone.
  async function onViewPhoto(row: AddBalanceHistoryRow) {
    const r = await getLedgerPhotoSignedUrl(row.id);
    if (r.error || !r.data) {
      // `r.error` is the server action's own string and stays ENGLISH — only
      // OUR fallback translates.
      setError(r.error ?? t("trips.addBalance.errPhoto", lang));
      return;
    }
    window.open(r.data.url, "_blank", "noopener,noreferrer");
  }

  // Print the RCT for the top-up that JUST saved (done view only). The VM is
  // built from record_topup's own return — no re-fetch, no arithmetic; the
  // signed amount is presented via Math.abs inside the VM builder.
  function onPrintReceipt() {
    if (!receipt) return;
    const name = fixedCustomer?.name ?? customers.find((c) => c.id === customerId)?.name ?? "";
    const vm = buildLedgerDocVm({
      lang,
      generatedAt: new Date(),
      kind: "topup",
      docNumber: receipt.docNumber,
      customerName: name,
      amountSar: receipt.amountSar,
      method: receipt.method,
      reference: receipt.reference,
      note: receipt.note,
      entryDate: receipt.entryDate,
      createdAt: receipt.createdAt,
      createdBy: receipt.createdBy,
      company,
    });
    printHtml(buildLedgerDocHtml(vm));
  }

  function openForm() {
    setCustomerId(fixedCustomer?.id ?? "");
    setMethod("");
    setAmount("");
    setDate(todayKey());
    setNote("");
    setReference("");
    setPhoto(null);
    setPhotoKey((k) => k + 1);
    setError(null);
    setView("form");
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) {
      setError(t("trips.addBalance.errIncomplete", lang));
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
      // The receipt number exists the moment record_topup returns — show it
      // and offer the print BEFORE anything closes (0203 done view). The
      // refresh runs now so the history list is current when dismissed.
      setReceipt(res.data);
      setView("done");
      router.refresh();
    } catch {
      setError(t("shared.upload.saveFailedNetwork", lang));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  // The customer's name is USER DATA and prints as stored, in either language.
  const title = fixedCustomer
    ? fill(t("trips.addBalance.titleFor", lang), { name: fixedCustomer.name })
    : t("trips.finance.addBalance", lang);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
      <ScrollLock />
      <div
        // TWO WIDTHS, because this shell hosts two different things. The list
        // view is a six-column history table (Date / Receipt / Method / ETF
        // Ref. / Amount / Photo) and gets the app's size:lg width, 1080px, like
        // every other table-bearing trips popup. The ADD FORM stays narrower —
        // it (and the done view) is a
        // single-column stack of single-line fields, and a 1080px-wide date
        // input is harder to fill in, not easier — but not as narrow as the
        // md it used to be, which cramped the amount and ETF-reference rows.
        className={
          "card p-6 w-full max-h-[90vh] overflow-y-auto scrollbar-thin " +
          (view === "list" ? "max-w-[1080px]" : "max-w-xl")
        }
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
            <p className="text-sm muted mb-4">{t("trips.addBalance.listSubtitle", lang)}</p>
            <Btn variant="primary" onClick={openForm} className="mb-4">
              <Plus className="h-4 w-4" /> {t("trips.finance.addBalance", lang)}
            </Btn>
            {error && <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">{error}</p>}
            {history.length === 0 ? (
              <div className="card p-8 text-center muted text-sm">{t("trips.addBalance.listEmpty", lang)}</div>
            ) : (
              <div className="card p-0 overflow-hidden">
                <Table>
                  <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                    <tr>
                      <TH>{t("common.date", lang)}</TH>
                      <TH>{t("trips.addBalance.colReceipt", lang)}</TH>
                      <TH>{t("trips.finance.colMethod", lang)}</TH>
                      <TH>{t("trips.addBalance.colEtfRef", lang)}</TH>
                      <TH>{t("common.amount", lang)}</TH>
                      <TH>{t("trips.addBalance.colPhoto", lang)}</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {/* The row variable was `t`, which SHADOWED the translator
                        inside this map and made every key above unreachable
                        here. Renamed to `tp` (topup) — same rename already
                        applied in DriverDutyTable and DriverRosterTable. */}
                    {history.map((tp) => (
                      <tr key={tp.id}>
                        <TD className="tabular-nums">{tp.topup_date}</TD>
                        {/* Receipt number: ledger rows carry RCT-…; legacy
                            customer_topups rows predate numbering — em dash. */}
                        <TD className="tabular-nums">
                          {tp.doc_number ?? <span className="muted">—</span>}
                        </TD>
                        <TD>
                          {tp.method ? paymentMethodLabel(tp.method, lang) : <span className="muted">—</span>}
                        </TD>
                        <TD>{tp.reference ? tp.reference : <span className="muted">—</span>}</TD>
                        <TD className="tabular-nums">{formatSar(tp.amount_sar)}</TD>
                        <TD>
                          {tp.photo_path ? (
                            <button
                              type="button"
                              onClick={() => onViewPhoto(tp)}
                              className="inline-flex items-center gap-1 text-brand-600 hover:underline"
                            >
                              <ImageIcon className="h-3.5 w-3.5" /> {t("common.view", lang)}
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
        ) : view === "done" ? (
          <>
            {/* Success view (0203): the receipt number is the whole point of
                this screen — record_topup returned it, show it BEFORE the
                modal closes, with the print one tap away. */}
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 mt-3">
              {t("trips.addBalance.successTitle", lang)}
            </p>
            <p className="text-sm mt-2">
              {fill(t("trips.addBalance.successReceipt", lang), {
                n: receipt?.docNumber ?? "",
              })}
            </p>
            <p className="text-2xl font-semibold tabular-nums mt-2">
              {formatSar(receipt?.amountSar ?? 0)}
            </p>
            <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-app">
              <Btn
                type="button"
                variant="ghost"
                onClick={() => (fixedCustomer ? setView("list") : close())}
              >
                {t("common.close", lang)}
              </Btn>
              <Btn type="button" variant="primary" onClick={onPrintReceipt}>
                <Printer className="h-4 w-4" /> {t("trips.addBalance.printReceipt", lang)}
              </Btn>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm muted mb-4">
              {t("trips.addBalance.formSubtitle", lang)}
            </p>

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
                        setError(fill(t(r.errorKey, lang), uploadErrorVars(r)));
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
                <Btn type="button" variant="ghost" onClick={() => (fixedCustomer ? setView("list") : close())}>
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
          </>
        )}
      </div>
    </div>
  );
}
