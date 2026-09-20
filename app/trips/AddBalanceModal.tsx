"use client";

// Add Balance (formerly "top-up") — Batch B restructure. Reworked to match
// the invoice pattern (InvoicesModal's list + InvoiceDetailModal's Mark-Paid
// form). The LIST is still folded in here, because nothing else shows this
// customer's top-up history; the FORM is not, because the ledger popup shows
// the same one (see below):
//   - Opened from a customer row: shows that customer's balance-addition
//     HISTORY first (date/method/ref/amount, most recent first), with an
//     "Add Balance" button in the corner that switches to the input form.
//   - Opened from the tab's global "Add Balance" button: no single customer
//     to show history for yet, so this skips straight to the form (which
//     still has the customer picker, same as before this batch).
//
// THE FORM BODY ITSELF NO LONGER LIVES HERE. The fields, the
// cash/bank_transfer required-flip (ETF ref + photo required for
// bank_transfer, both still offered for cash), the submit gate and the
// recordTopup call moved to ./AddBalanceForm so the Customer Ledger popup can
// offer the same top-up without a second copy of it. This file keeps the
// shell: the three views, the history table and the receipt.
// Photo viewing (history rows) uses getTopupProofSignedUrl, mirroring
// InvoiceDetailModal's getProofSignedUrl.

import { useEffect, useState } from "react";
import { X, Plus, Printer, Image as ImageIcon } from "lucide-react";
import { Btn, Table, TH, TD } from "@/components/ui";
import { formatSar } from "@/lib/utils";
import {
  getTopupProofSignedUrl,
  getLedgerPhotoSignedUrl,
  type LedgerDocResult,
} from "@/lib/actions/finance";
import AddBalanceForm, { type AddBalanceCustomerOption } from "./AddBalanceForm";
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

// The customer-option shape is DECLARED by the form (./AddBalanceForm, which
// is what takes it) and re-exported here so the callers that have always
// imported it from this module keep working.
export type { AddBalanceCustomerOption };

// One history row from EITHER era, tagged by source: "legacy" rows are
// customer_topups (pre-0203, photos behind getTopupProofSignedUrl, no receipt
// number); "ledger" rows are customer_ledger topups (photos behind
// getLedgerPhotoSignedUrl, RCT number in doc_number). FinanceTab merges the
// two lists — this modal only routes by the tag.
export type AddBalanceHistoryRow = {
  id: string;
  amount_sar: number;
  topup_date: string;
  method: "cash" | "bank_transfer" | null;
  reference: string | null;
  photo_path: string | null;
  source: "legacy" | "ledger";
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
  const { lang } = useApp();
  // "done" (new, 0203): the moment record_topup returns, the receipt number
  // exists — this view says so and offers the print before anything closes.
  const [view, setView] = useState<"list" | "form" | "done">("form");
  const [receipt, setReceipt] = useState<LedgerDocResult | null>(null);
  // The name the receipt prints under. The RPC's returned row carries no
  // customer name, and the picked customer is the form's state now, so the
  // form hands the name over with the row.
  const [receiptName, setReceiptName] = useState("");
  // Owned by the form, mirrored here because THIS shell is what refuses to
  // close mid-save.
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on every open — the right starting view and no stale receipt or
  // photo-link error. The FIELDS reset themselves: the form below mounts
  // fresh whenever this view changes or the fixed customer does.
  useEffect(() => {
    if (!open) return;
    setView(fixedCustomer ? "list" : "form");
    setError(null);
    setReceipt(null);
    setReceiptName("");
  }, [open, fixedCustomer]);

  function close() {
    if (saving) return;
    onClose();
  }

  // Mirrors InvoiceDetailModal's onViewProof — short-lived signed URL, never
  // a public link (topup-proofs is a private bucket). Routed by the row's
  // era tag: legacy rows are customer_topups ids, ledger rows are
  // customer_ledger ids — same bucket, different table naming the file.
  async function onViewPhoto(row: AddBalanceHistoryRow) {
    const r =
      row.source === "ledger"
        ? await getLedgerPhotoSignedUrl(row.id)
        : await getTopupProofSignedUrl(row.id);
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
    const vm = buildLedgerDocVm({
      lang,
      generatedAt: new Date(),
      kind: "topup",
      docNumber: receipt.docNumber,
      customerName: receiptName,
      amountSar: receipt.amountSar,
      method: receipt.method,
      reference: receipt.reference,
      note: receipt.note,
      createdAt: receipt.createdAt,
      createdBy: receipt.createdBy,
      company,
    });
    printHtml(buildLedgerDocHtml(vm));
  }

  // Only the view (and the list's own error) is cleared here — the form's
  // fields come back blank on their own, because leaving "list" mounts a new
  // one.
  function openForm() {
    setError(null);
    setView("form");
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

            {/* Keyed by the fixed customer so a changed one re-seeds the
                fields, which is what the reset effect used to do for them. */}
            <AddBalanceForm
              key={fixedCustomer?.id ?? "global"}
              customers={customers}
              fixedCustomer={fixedCustomer}
              onSuccess={(r, name) => {
                setReceipt(r);
                setReceiptName(name);
                setView("done");
              }}
              onCancel={() => (fixedCustomer ? setView("list") : close())}
              onBusyChange={setSaving}
            />
          </>
        )}
      </div>
    </div>
  );
}
