"use client";

// Transaction-statement drill-in (Finance tab). ITEMIZED per-trip detail —
// every trip, distinct from the invoice's grouped summary ranges (see
// lib/invoiceDisplay.ts). Two modes:
//   - prepaid: bank-statement-style chronological ledger — top-up credits +
//     delivered-trip/special-charge VAT-inclusive debits, running balance.
//     Built from lib/prepaid.ts's v3 buildStatementItems() (pure, tested by
//     scripts/prepaid-check.ts), trips + charges combined FIFO.
//   - postpaid: itemized delivered trips + Payment rows (paid invoices) — no
//     balance/ledger concept (spec §8/§10: postpaid has no prepaid balance).
//     Trip rows built from consumingItems() directly (trip entries only —
//     postpaid passes no charges), the same pure/shared "what counts"
//     function. Payment rows are a separate data source (paid invoices'
//     payment_reference/payment_date/grand_total_sar), not engine output.
//
// Statement rebuild (Batch 3, finance-invoice-spec.md v3) — adds, on top of
// the above, WITHOUT any lib/prepaid.ts change:
//   - Truck plate/capacity columns (per trip row, both modes) — sourced from
//     a caller-built tripMetaById map (app/trips/page.tsx's existing
//     trips.truck_id -> trucks join, threaded through FinanceTab), never
//     added to ConsumingTrip/ConsumedItem/StatementItemEntry themselves.
//   - A period picker (date-range filter on the TABLE ROWS only). Footer
//     figures (Running balance / Total payable) stay period-INDEPENDENT —
//     always computed from the full, unfiltered data, same as a real bank
//     statement's "current balance" not moving just because you scrolled to
//     an old page.
//   - Postpaid gains per-trip VAT + TOTAL columns. Both figures are already
//     computed by consumingItems() (amount = pre-VAT, consumedAmount = VAT-
//     inclusive) — VAT column is just their difference, TOTAL is
//     consumedAmount directly. No new formula.
//   - Postpaid's footer becomes "Total payable" — the VAT-inclusive total of
//     every postpaid trip NOT YET on a paid invoice (tripMetaById's
//     invoiceLocked flag, already computed in page.tsx for Settled Balance).
//   - Prepaid's AMOUNT column shows the bold VAT-inclusive debit with a
//     faded "pre-VAT + VAT" breakdown beside it — same treatment as
//     InvoiceDetailModal's PrepaidTripTable/LineTable footers. The pre-VAT
//     split isn't stored on StatementItemEntry, so it's read from a second,
//     already-exported call to consumingItems() (trips+charges), keyed by
//     kind+id — reusing the SAME pure function buildStatementItems() already
//     calls internally, not new math.
//   - Prepaid top-up rows show reference (not note) — note is only ever
//     shown for trip/charge debit rows now.
//
// Paid-invoice trace (prepaid) — a "settlement" row per PAID prepaid invoice,
// interleaved in true date order like every other event:
//   Date = payment date · Type = "Invoice payable" · Ref = invoice number ·
//   Note = "Balance" · Amount = the invoice grand total.
// It is a RECORD, not a movement: the running balance holds FLAT across it,
// because the trips and charges the invoice covers already consumed balance at
// delivery — deducting the invoice too would double-count. The engine
// (buildStatementItems' `settlements` parameter) skips these rows in its
// running walk; the labels above are rendered here, so lib/prepaid.ts stays
// pure math with no presentation strings.
//
// Pre-VAT throughout for postpaid's raw AMOUNT column (VAT is broken out
// separately) — the prepaid ledger's debit amounts are VAT-inclusive by
// design (see StatementItemEntry's comment in lib/prepaid.ts).
//
// Print reuses the existing portal pattern (InvoiceDetailModal/BreakdownReport):
// createPortal + mounted guard + a `printing-statement` body class toggled
// around window.print(), paired with #statement-print / .statement-print-portal
// CSS in app/globals.css.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Printer } from "lucide-react";
import { Btn, Table, TH, TD } from "@/components/ui";
import { formatSar, formatNum } from "@/lib/utils";
import {
  buildStatementItems,
  consumingItems,
  round2,
  type ConsumedItem,
  type ConsumingTrip,
  type ConsumingCharge,
  type SettlementStatementInput,
  type TopupStatementInput,
} from "@/lib/prepaid";
import {
  WATER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  type WaterType,
  type InvoicePaymentMethod,
} from "@/lib/db-types";
import { formatTripRef, sampleTripRef } from "@/lib/trip-ref";
import TripRefLink from "@/components/TripRefLink";

const INPUT = "px-2.5 py-1.5 rounded-lg border text-xs outline-none focus:ring-2 focus:ring-brand-500/30";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// Statement rebuild (Batch 3) — per-trip display metadata (truck + paid-
// lock), keyed by trip id. Built once in FinanceTab from the FULL trips
// list (app/trips/page.tsx's existing truck join + invoiceLocked flag) —
// deliberately kept OUTSIDE lib/prepaid.ts's ConsumingTrip/ConsumedItem
// types, which stay untouched.
export type TripMeta = { truckPlate: string | null; truckCapacityM3: number | null; invoiceLocked: boolean };

// Paid-invoice row source — one row per paid invoice (app/trips/page.tsx
// PaidInvoiceRow). Not engine output; a plain data pass-through.
// BOTH MODES read it now: postpaid renders it as a Payment (a real credit
// against what is owed), prepaid as a record-only "Invoice payable" row that
// traces the document without moving the balance.
export type StatementPayment = {
  id: string;
  invoice_number: string;
  // Imported, not re-declared — see PaidInvoiceRow (app/trips/page.tsx), which
  // this mirrors field-for-field. A hand-rolled two-value copy would have denied
  // 0134's 'balance' at the type level while the column returns it.
  payment_method: InvoicePaymentMethod | null;
  payment_reference: string | null;
  payment_date: string | null;
  paid_at: string | null;
  grand_total_sar: number;
};

function truckCell(meta: TripMeta | undefined) {
  return {
    plate: meta?.truckPlate ?? null,
    capacity: meta?.truckCapacityM3 ?? null,
  };
}

// payment_date is a plain date (user-entered); paid_at is a full timestamp
// (server now()) — this fallback must trim it to date-only, same "recorded
// vs actual" convention as SpecialChargeRow.charge_date falling back to
// created_at.slice(0, 10) in FinanceTab.
function paymentDateOf(p: StatementPayment): string {
  return p.payment_date ?? (p.paid_at ? p.paid_at.slice(0, 10) : "");
}

export default function StatementModal({
  open,
  onClose,
  customerName,
  mode,
  topups,
  trips,
  charges,
  projectWaterType,
  projectInitials,
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
  // Display-only fallback (Finance polish batch C) — project's CURRENT
  // water_type, used when an entry/trip's own water_type is null (pre-
  // water_type-field data). Never mutates any stored record.
  projectWaterType?: WaterType | null;
  // Project's stable trip-ref prefix (projects.initials, 0033) — used only
  // to render a sample/demo ref under the customer name, never a real trip.
  projectInitials?: string | null;
  // Statement rebuild (Batch 3) — project name shown next to the payment
  // method/mode in the header.
  projectName?: string | null;
  // Statement rebuild (Batch 3) — truck plate/capacity + paid-lock per trip.
  tripMetaById: Map<string, TripMeta>;
  // Paid invoices for this customer. Postpaid renders them as Payment rows;
  // prepaid renders them as record-only "Invoice payable" rows (prepaid's
  // real credits are top-ups, already in `topups` — a paid prepaid invoice is
  // NOT a credit and NOT a debit, see the settlement note in lib/prepaid.ts).
  payments: StatementPayment[];
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Period picker — filters TABLE ROWS only. Footer figures stay global (see
  // file header). Defaults to all-time (both empty).
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const hasPeriodFilter = dateFrom !== "" || dateTo !== "";
  function inPeriod(d: string) {
    return (dateFrom === "" || d >= dateFrom) && (dateTo === "" || d <= dateTo);
  }

  if (!open || !mounted) return null;

  function handlePrint() {
    document.body.classList.add("printing-statement");
    const cleanup = () => {
      document.body.classList.remove("printing-statement");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  const sampleRef = sampleTripRef(projectInitials);

  // Paid invoices, BOTH modes (the old `mode === "postpaid" ? payments : []`
  // gate is lifted — prepaid needs them for its record-only settlement rows).
  // A row with neither payment_date nor paid_at has no place on a dated
  // ledger, so it is dropped rather than sorted to the top under "".
  const allPayments = payments.filter((p) => paymentDateOf(p) !== "");

  // ---- Prepaid ----------------------------------------------------------
  // Record-only rows: a paid prepaid invoice is TRACED, never deducted — the
  // trips and charges it covers already consumed balance at delivery.
  const settlements: SettlementStatementInput[] =
    mode === "prepaid"
      ? allPayments.map((p) => ({
          id: p.id,
          date: paymentDateOf(p),
          invoice_number: p.invoice_number,
          amount: p.grand_total_sar,
        }))
      : [];
  // Full (unfiltered) sequence — running balance must reflect true
  // cumulative history even when the visible rows are period-filtered.
  const allEntries = mode === "prepaid" ? buildStatementItems(topups, trips, charges, undefined, settlements) : [];
  const entries = allEntries.filter((e) => inPeriod(e.date));
  const balance = allEntries.length > 0 ? allEntries[allEntries.length - 1].runningBalance : 0;
  // Pre-VAT/VAT breakdown for trip+charge debit rows — a second, already-
  // exported call to the SAME pure function buildStatementItems() calls
  // internally. No new math; consumingItems() already carries both the
  // pre-VAT `amount` and VAT-inclusive `consumedAmount`.
  const consumedById =
    mode === "prepaid"
      ? new Map(consumingItems(trips, charges).map((e) => [`${e.kind}:${e.id}`, e]))
      : new Map<string, ConsumedItem>();

  // ---- Postpaid -----------------------------------------------------------
  const allPostpaidTrips = mode === "postpaid" ? consumingItems(trips).filter((e) => e.kind === "trip") : [];
  const postpaidTrips = allPostpaidTrips.filter((t) => inPeriod(t.trip_date));
  // "Total payable" — VAT-inclusive total of every postpaid trip NOT yet on
  // a paid invoice (tripMetaById's invoiceLocked, same flag Settled Balance
  // already uses). Global — period-independent, same as prepaid's balance.
  const totalPayable = round2(
    allPostpaidTrips
      .filter((t) => !tripMetaById.get(t.id)?.invoiceLocked)
      .reduce((s, t) => s + t.consumedAmount, 0),
  );
  const paymentRows = mode === "postpaid" ? allPayments.filter((p) => inPeriod(paymentDateOf(p))) : [];
  // Merge trip + payment rows chronologically for display (payments render
  // like any other statement row, oldest first, same as top-ups above).
  const postpaidRows: (
    | { kind: "trip"; date: string; row: (typeof postpaidTrips)[number] }
    | { kind: "payment"; date: string; row: StatementPayment }
  )[] = [
    ...postpaidTrips.map((t) => ({ kind: "trip" as const, date: t.trip_date, row: t })),
    ...paymentRows.map((p) => ({ kind: "payment" as const, date: paymentDateOf(p), row: p })),
  ].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));

  const title = mode === "prepaid" ? "PREPAID STATEMENT" : "POSTPAID STATEMENT";
  const modeLabel = mode === "prepaid" ? "Prepaid" : "Postpaid";

  return createPortal(
    <div className="statement-print-portal fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div
        id="statement-print"
        className="card p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1 gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-wide">{title}</h2>
            <p className="text-sm mt-0.5">
              <span className="font-medium">{customerName}</span>
              {projectName && <span className="muted"> · {projectName}</span>}
              <span className="muted"> · {modeLabel}</span>
            </p>
          </div>
          <div className="no-print flex items-center gap-3 shrink-0">
            <Btn variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4" /> Print
            </Btn>
            <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        {sampleRef && <p className="text-sm muted mb-1">Ref. {sampleRef}</p>}
        <p className="text-sm muted mb-4">
          {mode === "prepaid"
            ? "Add Balance credits and delivered-trip/charge debits (VAT-inclusive), oldest first."
            : "Delivered trips and recorded payments, oldest first."}
        </p>

        {/* Period picker — table rows only, footer figures stay global. */}
        <div className="no-print flex items-end gap-2 flex-wrap mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium muted">From</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={INPUT} style={INPUT_STYLE} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium muted">To</span>
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
              All-time
            </Btn>
          )}
        </div>

        {mode === "prepaid" ? (
          entries.length === 0 ? (
            <div className="card p-10 text-center muted text-sm">
              {hasPeriodFilter ? "No activity in this period." : "No balance added or delivered trips yet."}
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <Table>
                <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                  <tr>
                    <TH>Date</TH>
                    <TH>Type</TH>
                    <TH>Truck</TH>
                    <TH>Capacity</TH>
                    <TH>Ref</TH>
                    <TH>Note</TH>
                    <TH>Amount</TH>
                    <TH>Running Balance</TH>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const truck = e.kind === "trip" ? truckCell(tripMetaById.get(e.id)) : { plate: null, capacity: null };
                    const consumed =
                      e.kind === "trip" || e.kind === "charge" ? consumedById.get(`${e.kind}:${e.id}`) : undefined;
                    return (
                      <tr key={`${e.kind}-${e.id}`}>
                        <TD className="tabular-nums">{e.date}</TD>
                        <TD>
                          {e.kind === "topup" ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">Add Balance</span>
                          ) : e.kind === "settlement" ? (
                            <span className="muted">Invoice payable</span>
                          ) : e.kind === "charge" ? (
                            <span className="muted">Special charge</span>
                          ) : (
                            <span className="muted">
                              {(e.water_type ?? projectWaterType) ? WATER_TYPE_LABELS[(e.water_type ?? projectWaterType) as WaterType] : "—"}
                            </span>
                          )}
                        </TD>
                        <TD className="muted">{truck.plate ?? "—"}</TD>
                        <TD className="muted">{truck.capacity != null ? `${truck.capacity} m³` : "—"}</TD>
                        <TD>
                          {e.kind === "trip" ? (
                            <TripRefLink tripId={e.id} label={formatTripRef(e.ref)} />
                          ) : e.kind === "topup" || e.kind === "settlement" ? (
                            e.reference || <span className="muted">—</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </TD>
                        <TD className="max-w-[10rem] truncate">
                          {e.kind === "topup" ? (
                            <span className="muted">—</span>
                          ) : e.kind === "settlement" ? (
                            "Balance"
                          ) : (
                            e.note || <span className="muted">—</span>
                          )}
                        </TD>
                        <TD className="tabular-nums">
                          {e.kind === "topup" ? (
                            <span className="text-emerald-600 dark:text-emerald-400">+{formatSar(e.amount)}</span>
                          ) : e.kind === "settlement" ? (
                            // Neither a credit nor a debit — no sign, no VAT
                            // split. The document's own total, for the record.
                            <span>{formatSar(e.amount)}</span>
                          ) : (
                            <span className="flex flex-col items-end">
                              <span className="tabular-nums font-medium">−{formatSar(Math.abs(e.amount))}</span>
                              <span className="tabular-nums text-xs text-black/35 dark:text-white/35">
                                {formatNum(consumed?.amount ?? 0)} + VAT {formatNum(round2((consumed?.consumedAmount ?? 0) - (consumed?.amount ?? 0)))}
                              </span>
                            </span>
                          )}
                        </TD>
                        <TD className="tabular-nums font-medium">
                          <span className={e.runningBalance < 0 ? "text-rose-600 dark:text-rose-400" : ""}>
                            {formatSar(e.runningBalance)}
                          </span>
                        </TD>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )
        ) : postpaidRows.length === 0 ? (
          <div className="card p-10 text-center muted text-sm">
            {hasPeriodFilter ? "No activity in this period." : "No delivered trips or payments yet."}
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>Date</TH>
                  <TH>Ref</TH>
                  <TH>Type</TH>
                  <TH>Truck</TH>
                  <TH>Capacity</TH>
                  <TH>Amount</TH>
                  <TH>VAT</TH>
                  <TH>Total</TH>
                </tr>
              </thead>
              <tbody>
                {postpaidRows.map((r) =>
                  r.kind === "trip" ? (
                    <tr key={`trip-${r.row.id}`}>
                      <TD className="tabular-nums">{r.row.trip_date}</TD>
                      <TD>
                        <TripRefLink tripId={r.row.id} label={formatTripRef(r.row.ref)} />
                      </TD>
                      <TD className="muted">
                        {(r.row.water_type ?? projectWaterType) ? WATER_TYPE_LABELS[(r.row.water_type ?? projectWaterType) as WaterType] : "—"}
                      </TD>
                      <TD className="muted">{tripMetaById.get(r.row.id)?.truckPlate ?? "—"}</TD>
                      <TD className="muted">
                        {tripMetaById.get(r.row.id)?.truckCapacityM3 != null ? `${tripMetaById.get(r.row.id)!.truckCapacityM3} m³` : "—"}
                      </TD>
                      <TD className="tabular-nums">{formatSar(r.row.amount)}</TD>
                      <TD className="tabular-nums muted">{formatSar(round2(r.row.consumedAmount - r.row.amount))}</TD>
                      <TD className="tabular-nums font-medium">{formatSar(r.row.consumedAmount)}</TD>
                    </tr>
                  ) : (
                    <tr key={`payment-${r.row.id}`}>
                      <TD className="tabular-nums">{paymentDateOf(r.row) || "—"}</TD>
                      {/* The REFERENCE column. bank_transfer is the only method
                          that carries one (0039 requires it), so it shows the
                          reference; every other method names itself from the
                          shared label map instead. Reading the branch the other
                          way round — special-casing 'cash' and letting
                          everything else fall through to the reference — is what
                          made 0134's 'balance' render as a bare em dash: it has
                          no reference either, and never will. */}
                      <TD>
                        {r.row.payment_method === "bank_transfer" ? (
                          r.row.payment_reference || <span className="muted">—</span>
                        ) : r.row.payment_method ? (
                          PAYMENT_METHOD_LABELS[r.row.payment_method]
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </TD>
                      <TD>
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">Payment</span>
                      </TD>
                      <TD className="muted">—</TD>
                      <TD className="muted">—</TD>
                      <TD className="muted">—</TD>
                      <TD className="muted">—</TD>
                      <TD className="tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
                        +{formatSar(r.row.grand_total_sar)}
                      </TD>
                    </tr>
                  ),
                )}
              </tbody>
            </Table>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 mt-4 border-t border-app">
          {mode === "prepaid" ? (
            <div className="text-sm">
              <span className="muted">Running balance: </span>
              <span className={"font-semibold tabular-nums " + (balance < 0 ? "text-rose-600 dark:text-rose-400" : "")}>
                {formatSar(balance)}
              </span>
            </div>
          ) : (
            <div className="text-sm">
              <span className="muted">Total payable: </span>
              <span className={"font-semibold tabular-nums " + (totalPayable > 0 ? "text-rose-600 dark:text-rose-400" : "")}>
                {formatSar(totalPayable)}
              </span>
            </div>
          )}
          <Btn variant="outline" onClick={onClose} className="no-print">
            Close
          </Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}
