"use client";

// Transaction-statement drill-in (Finance tab). ITEMIZED per-trip detail —
// every trip, distinct from the invoice's grouped summary ranges (see
// lib/invoiceDisplay.ts). Two modes:
//   - prepaid: bank-statement-style chronological ledger — top-up credits +
//     delivered-trip/special-charge VAT-inclusive debits, running balance.
//   - postpaid: itemized delivered trips + Payment rows (paid invoices) — no
//     balance/ledger concept (spec §8/§10: postpaid has no prepaid balance).
//
// THIS FILE NO LONGER DECIDES WHAT THE STATEMENT SAYS.
// ----------------------------------------------------
// Every column, every row, every Type label, every order and every figure now
// comes from lib/statementViewModel.ts's buildStatementVm(). That module was
// extracted OUT of this one — the engine calls, the settlement mapping, the
// period-filter-after-the-full-walk ordering and the label keys below are the
// expressions this file already had, moved verbatim. What stays here is the
// LOOK: the popup's tints, its emerald/amber/rose ink, its truncation, the
// portal and the print hooks.
//
// The reason for the split is the downloadable statement (statementActions.ts
// -> lib/statementPdfTemplate.ts). It renders from the SAME buildStatementVm()
// call on the SAME inputs, so the file and the screen cannot disagree about a
// figure, a column or a word — a change lands on both or on neither. That is
// the 0%-deviation contract lib/invoiceViewModel.ts states for the invoice,
// applied to the other document.
//
// NUMBERS ARRIVE RAW AND ARE FORMATTED HERE. The view-model hands over the
// unrounded value; this screen prints whole riyals via formatSar/formatNum,
// the document prints two decimals via num2. Neither surface re-signs,
// re-rounds or re-bases anything — the sign and the VAT split are decided in
// the view-model and only rendered here.
//
// What the view-model does NOT own, and why:
//   - The period picker's STATE (two date inputs) is UI state, so it lives
//     here; its VALUES are passed into buildStatementVm, which applies them.
//     Footer figures stay period-INDEPENDENT — always computed from the full,
//     unfiltered data, same as a real bank statement's "current balance" not
//     moving just because you scrolled to an old page. That rule is enforced
//     in the view-model now, not in this render.
//   - The Ref column's LINK. The view-model emits a `tripRef` cell carrying
//     the trip id; this surface wraps it in TripRefLink, the document prints
//     the same text plain. Same VALUE, different affordance.
//
// PRINT AND DOWNLOAD EMIT THE SAME DOCUMENT — see handlePrint below. Print no
// longer prints this popup; it renders lib/statementPdfTemplate.ts from the
// same `vm` and prints that in a hidden iframe. The `printing-statement` body
// class, the #statement-print / .statement-print-portal CSS in app/globals.css,
// and the colourless settlement marker classes that block hooked onto are all
// gone together. The portal and mounted guard stay — those are how the modal
// mounts, not how it printed.
//
// What still differs between the two: Download crosses the network to the PDF
// provider and can fail on its own (see the toolbar's error line); Print is
// local string building and cannot.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Printer, Download } from "lucide-react";
import { Btn, Table, TH, TD } from "@/components/ui";
import { formatSar, formatNum } from "@/lib/utils";
import type { BalanceReturnLite, ConsumingTrip, ConsumingCharge, TopupStatementInput } from "@/lib/prepaid";
import { type WaterType } from "@/lib/db-types";
import {
  buildStatementVm,
  type StatementCell,
  type StatementColumnKey,
  type StatementPaymentInput,
  type StatementRow,
  type StatementTripMeta,
} from "@/lib/statementViewModel";
import TripRefLink from "@/components/TripRefLink";
// The PRINTED statement is the same document the download is — same template,
// same view-model instance. Not a second rendering of this DOM.
import { buildStatementHtml } from "@/lib/statementPdfTemplate";
import { printHtml } from "@/lib/printHtml";
import ScrollLock from "@/components/ScrollLock";
import { useApp } from "@/components/AppShell";
import { t, fill } from "@/lib/i18n";
import { getStatementPdf } from "./statementActions";

const INPUT = "px-2.5 py-1.5 rounded-lg border text-xs outline-none focus:ring-2 focus:ring-brand-500/30";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// Settlement-row colour — SCREEN ONLY, and now screen only in the literal
// sense: nothing prints this DOM any more.
//
// These two strings used to lead with `statement-settlement-row` /
// `statement-settlement-ink`, colourless marker classes whose only job was to
// give app/globals.css's @media print block something to hook onto so it could
// strip the tint and the green ink off a printed page. That block is gone with
// the print repoint, so the markers are gone with it — a hook with nothing on
// the other end is worse than no hook, because the next reader assumes the
// suppression still happens somewhere.
//
// Both printed surfaces are monochrome by construction now:
// lib/statementPdfTemplate.ts carries a settlement in italic and a rule
// rather than a tint, and print and download both render it.
const SETTLEMENT_ROW_CLS = "bg-emerald-500/[0.07]";
const SETTLEMENT_INK_CLS = "text-emerald-700 dark:text-emerald-400 font-medium";

// Balance-return ink (0142). A refund is money LEAVING the pool, so it reads
// as a debit like a trip or a charge — the distinction it needs is WHY, not
// whether it subtracts, so only the Type label is coloured and the row itself
// stays untinted. It used to reuse the settlement row's print hook so the same
// @media print rule stripped its amber; with the print repoint there is no page
// to strip it from — the printed statement is lib/statementPdfTemplate.ts,
// which never had a colour to lose.
const RETURN_INK_CLS = "text-amber-700 dark:text-amber-400 font-medium";

const CREDIT_INK_CLS = "text-emerald-600 dark:text-emerald-400";

// Per-trip display metadata (truck + paid-lock), keyed by trip id. Built once
// in FinanceTab from the FULL trips list (app/trips/page.tsx's existing truck
// join + invoiceLocked flag) — deliberately kept OUTSIDE lib/prepaid.ts's
// ConsumingTrip/ConsumedItem types, which stay untouched.
//
// ALIASED, not re-declared: this used to be its own shape and the view-model
// mirrored it, which is two places for one contract. FinanceTab still imports
// `TripMeta` from here, so the name stays; the definition is now the
// view-model's and cannot drift from what buildStatementVm actually reads.
export type TripMeta = StatementTripMeta;

// Paid-invoice row source — one row per paid invoice (app/trips/page.tsx
// PaidInvoiceRow). Not engine output; a plain data pass-through.
// BOTH MODES read it: postpaid renders it as a Payment (a real credit against
// what is owed), prepaid as a record-only "Invoice payable" row that traces
// the document without moving the balance. Aliased for the same reason as
// TripMeta above.
export type StatementPayment = StatementPaymentInput;

// ---------------------------------------------------------------------------
// Look: the two class tables
// ---------------------------------------------------------------------------
// A column's own cell treatment — alignment, numerals, truncation. Identical
// to what each <TD> carried before the extraction, keyed by column instead of
// hand-written per row.
function tdCls(colKey: StatementColumnKey): string {
  switch (colKey) {
    case "date":
      return "tabular-nums";
    // The Note cell is the only one that can hold free text long enough to
    // wreck an eight-column table, so it is the only one that truncates.
    case "note":
      return "max-w-[10rem] truncate";
    case "truck":
    case "capacity":
      return "muted";
    case "amount":
      return "tabular-nums";
    case "vat":
      return "tabular-nums muted";
    case "total":
    case "runningBalance":
      return "tabular-nums font-medium";
    case "type":
    case "ref":
      // Ink for these two is decided by the ROW, below — a Type cell is
      // emerald on a top-up and amber on a return, so it cannot be a property
      // of the column.
      return "";
  }
}

// A row's ink, applied to the cell CONTENT. Says what KIND of event the row
// is, which is the one thing colour carries on this screen.
function rowInk(kind: StatementRow["kind"]): string {
  switch (kind) {
    case "topup":
    case "payment":
      return `${CREDIT_INK_CLS} font-medium`;
    case "settlement":
      return SETTLEMENT_INK_CLS;
    case "return":
      return RETURN_INK_CLS;
    case "trip":
    case "charge":
      return "muted";
  }
}

export default function StatementModal({
  open,
  onClose,
  customerName,
  mode,
  topups,
  trips,
  charges,
  returns,
  projectWaterType,
  projectName,
  tripMetaById,
  payments,
}: {
  open: boolean;
  onClose: () => void;
  customerName: string;
  mode: "prepaid" | "postpaid";
  topups: TopupStatementInput[];
  trips: ConsumingTrip[];
  // v3 — prepaid only. Always [] for postpaid (no coverage/balance concept).
  charges: ConsumingCharge[];
  // Recorded refunds of prepaid credit (0142) — prepaid only, and defaulted so
  // the postpaid caller and any future one read unchanged. These are DEBITS in
  // the engine, so the closing running balance below only agrees with the
  // Finance tab's Balance column while they are threaded through.
  returns?: BalanceReturnLite[];
  // Display-only fallback (Finance polish batch C) — project's CURRENT
  // water_type, used when an entry/trip's own water_type is null (pre-
  // water_type-field data). Never mutates any stored record.
  projectWaterType?: WaterType | null;
  // `projectInitials` REMOVED with the sample-ref line it fed. It was a
  // demo/format string, never a real trip's number; the header carries the
  // statement PERIOD in that slot now.
  // Project name shown next to the payment method/mode in the header.
  projectName?: string | null;
  // Truck plate/capacity + paid-lock per trip.
  tripMetaById: Map<string, TripMeta>;
  // Paid invoices for this customer (see StatementPayment above).
  payments: StatementPayment[];
}) {
  const { lang } = useApp();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);


  // Period picker — filters TABLE ROWS only (the view-model applies it).
  // Defaults to all-time (both empty).
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [downloading, setDownloading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // CTRL/CMD+P IS INTERCEPTED, AND AFTER THE REPOINT IT HAS TO BE.
  //
  // app/globals.css opens its print block with `body * { visibility: hidden }`
  // and then whitelists specific subtrees. The statement used to be on that
  // whitelist; it deliberately is not any more, because printing the popup's
  // React DOM is exactly the drift this change removes. So a raw browser print
  // with this modal open would otherwise resolve to a blank sheet — the worst
  // failure available, because it looks like the printer's fault.
  //
  // Routing the shortcut to handlePrint() also makes the keyboard and the
  // button emit the SAME document, which is what anyone pressing Ctrl+P in
  // front of a statement means. Capture phase so nothing swallows it first.
  // Same treatment, same reasons, as InvoiceDetailModal.
  //
  // Declared ABOVE the `!open` early return because it is a hook, and BELOW the
  // period state because its dep array reads it.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "p" && e.key !== "P") return;
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.altKey || e.shiftKey) return;
      e.preventDefault();
      handlePrint();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted, mode, dateFrom, dateTo, lang]);

  if (!open || !mounted) return null;

  // THE SAME CALL THE DOCUMENT MAKES. Everything below renders off `vm`.
  const vm = buildStatementVm({
    customerName,
    projectName: projectName ?? null,
    mode,
    topups,
    trips,
    charges,
    returns: returns ?? [],
    payments,
    tripMetaById,
    projectWaterType: projectWaterType ?? null,
    dateFrom,
    dateTo,
  });

  const hasPeriodFilter = vm.periodFrom !== null || vm.periodTo !== null;

  // PRINT AND DOWNLOAD ARE NOW THE SAME DOCUMENT.
  //
  // This used to add a `printing-statement` body class and call
  // window.print(), which printed THIS POPUP: screen layout, screen number
  // formats (whole riyals, not the document's halalas), and every control
  // suppressed by hand with `no-print` classes. It agreed with the screen by
  // BEING the screen — and disagreed with the downloadable PDF, which is the
  // one thing the customer actually receives.
  //
  // Now it renders `buildStatementHtml(vm)` — literally the same function, on
  // literally the same `vm` object this render is drawing from — and prints
  // that in a hidden iframe. Print/download agreement is no longer a property
  // of two stylesheets kept in sync; it is one function called twice. The
  // invoice was repointed the same way and for the same reason (see
  // InvoiceDetailModal.handlePrint).
  //
  // NO SERVER ROUND-TRIP, unlike the invoice's. buildStatementHtml is pure
  // string building with no fs and no `process` (its own header says so), and
  // this component already holds the vm — so print works with the PDF provider
  // down, or offline, and cannot fail separately from what is on screen.
  function handlePrint() {
    printHtml(buildStatementHtml(vm));
  }

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    setPdfError(null);
    // The action re-runs buildStatementVm on exactly these inputs — the same
    // object this render used, INCLUDING the period filter, so the file is a
    // snapshot of the statement on screen rather than a second reading of the
    // ledger taken a moment later. The Map travels as an array; see
    // StatementPdfInput.
    const r = await getStatementPdf({
      customerName,
      projectName: projectName ?? null,
      mode,
      topups,
      trips,
      charges,
      returns: returns ?? [],
      payments,
      tripMeta: Array.from(tripMetaById, ([tripId, m]) => ({ tripId, ...m })),
      projectWaterType: projectWaterType ?? null,
      dateFrom,
      dateTo,
    });
    setDownloading(false);
    if (r.error || !r.data) {
      setPdfError(r.error ?? t("trips.invoice.errPdf", lang));
      return;
    }
    // Server Actions can't stream a Blob directly — bytes arrive as base64;
    // decode to a Blob here and trigger a normal browser download via a
    // throwaway <a download> (no navigation, works across browsers). Same
    // pattern as InvoiceDetailModal's handleDownloadPdf.
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

  // -------------------------------------------------------------------------
  // Cell rendering — LOOK ONLY
  // -------------------------------------------------------------------------
  // Takes the cell the view-model decided on and dresses it. It never chooses
  // a word, a sign or a figure; the only judgement here is which ink and
  // whether the Ref column links.
  function renderCell(cell: StatementCell, row: StatementRow, colKey: StatementColumnKey) {
    switch (cell.kind) {
      case "empty":
        return <span className="muted">—</span>;
      case "date":
        return cell.value;
      case "text":
        return cell.value;
      case "bi":
        // Type and Note are the ink-carrying text cells; everything else
        // renders in the table's own colour.
        return colKey === "type" || colKey === "note" ? (
          <span className={rowInk(row.kind)}>{cell.value[lang]}</span>
        ) : (
          cell.value[lang]
        );
      case "tripRef":
        return <TripRefLink tripId={cell.tripId} label={cell.value} />;
      case "num": {
        const sign = cell.sign === "plus" ? "+" : cell.sign === "minus" ? "−" : "";
        const figure = `${sign}${formatSar(cell.value)}`;

        // The running balance is the only figure whose ink tracks its VALUE
        // rather than its row kind — a negative balance is the thing a manager
        // scans a statement for.
        if (colKey === "runningBalance") {
          return <span className={cell.negative ? "text-rose-600 dark:text-rose-400" : ""}>{figure}</span>;
        }

        // A prepaid debit stacks its VAT breakdown underneath — same treatment
        // as InvoiceDetailModal's PrepaidTripTable/LineTable footers. BOTH
        // figures are formatNum() over numbers the view-model already
        // computed; the connector is the dictionary's, not this file's.
        if (cell.split) {
          return (
            <span className="flex flex-col items-end">
              <span className="tabular-nums font-medium">{figure}</span>
              <span className="tabular-nums text-xs text-black/35 dark:text-white/35">
                {fill(vm.vatSplitTemplate[lang], {
                  net: formatNum(cell.split.net),
                  vat: formatNum(cell.split.vat),
                })}
              </span>
            </span>
          );
        }

        // Postpaid's Amount/VAT/Total on a trip row carry no ink — they are
        // the plain itemisation. Every other figure is coloured by its row.
        if (row.kind === "trip" || row.kind === "charge") return figure;

        // A TOP-UP'S FIGURE IS COLOURED BUT NOT BOLD, unlike its Type label
        // and unlike every other coloured figure on the table. Deliberate, and
        // preserved from before this render was rewritten: the debit beside it
        // is plain weight, so bolding the credit would make a statement read as
        // if the money coming in mattered more than the work going out.
        const ink = row.kind === "topup" ? CREDIT_INK_CLS : rowInk(row.kind);
        return <span className={ink}>{figure}</span>;
      }
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <ScrollLock />
      <div
        // `id="statement-print"` and `.statement-print-portal` REMOVED with the
        // @media print block that was their only reader. Nothing prints this
        // subtree any more, so an id promising otherwise is a trap.
        // 1080px is this app's size:lg popup width (InventoryClient.tsx:130,
        // PurchaseOrders.tsx, the maintenance and reports modals). Widened from
        // max-w-3xl because BOTH statement tables are EIGHT columns — the widest
        // in the app — and Date/Type/Truck/Capacity/Ref/Note/Amount/Running
        // Balance at 768px wraps the Note and Ref cells into unreadable stacks.
        className="card p-6 w-full max-w-[1080px] max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1 gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-wide">{vm.title[lang]}</h2>
            <p className="text-sm mt-0.5">
              <span className="font-medium">{vm.customerName}</span>
              {vm.projectName && <span className="muted"> · {vm.projectName}</span>}
              <span className="muted"> · {vm.modeLabel[lang]}</span>
            </p>
          </div>
          <div className="no-print flex items-center gap-3 shrink-0">
            {/* Two different documents, so two buttons: Print hands THIS popup
                to the browser, Download fetches the A4 file. They fail
                separately and say so separately. */}
            <Btn variant="outline" onClick={handleDownload} disabled={downloading}>
              <Download className="h-4 w-4" />{" "}
              {downloading ? t("trips.invoice.generating", lang) : t("trips.statement.downloadPdf", lang)}
            </Btn>
            <Btn variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4" /> {t("common.print", lang)}
            </Btn>
            <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        {/* The sample-ref line stood here and is GONE. It rendered "Ref. K1-0001"
            over sampleTripRef() — a synthetic EXAMPLE of the project's reference
            FORMAT, not any trip in this statement — directly under the customer
            name, where it read like a fact about this customer's account.
            The screen's period is the picker below: those two date inputs carry
            the same `from`/`to` labels the document's header line uses and hold
            the same two values, so the document adds a rendering of the period,
            not a second source of it. */}
        <p className="text-sm muted mb-4">{vm.subtitle[lang]}</p>
        {pdfError && <p className="no-print text-sm text-rose-600 dark:text-rose-400 mb-4">{pdfError}</p>}

        {/* Period picker — table rows only, footer figures stay global. */}
        <div className="no-print flex items-end gap-2 flex-wrap mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium muted">{t("trips.statement.from", lang)}</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium muted">{t("trips.statement.to", lang)}</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={INPUT} style={INPUT_STYLE} />
          </label>
          {hasPeriodFilter && (
            <Btn
              variant="ghost"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
            >
              {vm.allTimeLabel[lang]}
            </Btn>
          )}
        </div>

        {vm.rows.length === 0 ? (
          <div className="card p-10 text-center muted text-sm">{vm.emptyLabel?.[lang]}</div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  {vm.columns.map((c) => (
                    <TH key={c.key}>{c.label[lang]}</TH>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vm.rows.map((row) => (
                  <tr
                    key={row.key}
                    // DISPLAY COLOUR ONLY — a settlement row is tinted so
                    // management can pick the paid invoices out of a long
                    // statement at a glance. It changes no figure: the row
                    // still RECORDS rather than deducts, and the running
                    // balance still holds flat across it (lib/prepaid.ts).
                    // The tint is on the ROW while a top-up's green is on
                    // its TEXT, deliberately — both are green-family, but
                    // a top-up is money arriving and a settlement is not,
                    // so they must not render identically.
                    className={row.kind === "settlement" ? SETTLEMENT_ROW_CLS : ""}
                  >
                    {row.cells.map((cell, i) => (
                      <TD key={vm.columns[i].key} className={tdCls(vm.columns[i].key)}>
                        {renderCell(cell, row, vm.columns[i].key)}
                      </TD>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 mt-4 border-t border-app">
          <div className="text-sm">
            <span className="muted">{vm.headline.label[lang]} </span>
            <span
              className={
                "font-semibold tabular-nums " + (vm.headline.negative ? "text-rose-600 dark:text-rose-400" : "")
              }
            >
              {formatSar(vm.headline.value)}
            </span>
          </div>
          <Btn variant="outline" onClick={onClose} className="no-print">
            {t("common.close", lang)}
          </Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}
