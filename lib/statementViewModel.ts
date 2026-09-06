// SHARED STATEMENT VIEW-MODEL — the one place that decides WHAT a customer
// statement says, in WHAT order, in WHICH columns, and in WHICH words.
//
// Same law as lib/invoiceViewModel.ts, applied to the other document:
//
//   EVERY STATEMENT SURFACE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0%
//   DEVIATION in DATA, GROUPING and WORDING. The LOOK may differ; the DATA and
//   WORDING may not.
//
// The on-screen statement (app/trips/StatementModal.tsx) is the SOURCE OF
// TRUTH. This file was extracted OUT of it, not written alongside it: every
// column head, every Type label, every row order and every figure below is the
// expression the modal already had. The modal now renders from here, so a
// change lands on the screen and the download together or on neither.
//
// WHAT THIS FILE DOES NOT DO
// --------------------------
// It does not compute money. lib/prepaid.ts's buildStatementItems() and
// consumingItems() remain the ONLY expressions of the ledger, and they are
// called here with exactly the arguments the modal always passed. Nothing here
// re-signs, re-rounds, re-bases or re-sums a single amount. This file ARRANGES
// what that engine returns; it does not participate in the money-core.
//
// NUMBERS ARE RAW, NOT FORMATTED — same rule as the invoice view-model. The
// screen shows whole riyals (`formatSar`); a document shows 2 decimals
// (`num2`). Freezing a format here would silently change one of the two.
//
// Bilingual, because a document is not a screen: the popup renders in ONE
// language (the operator's), a downloadable statement renders in BOTH. So
// every label is a `BiLabel` resolved from lib/i18n.ts through the SAME KEY
// the popup passed, never a string written here.
//
// A STATEMENT IS NOT A TAX INVOICE. No ZATCA fields, no QR, no seller VAT
// number, no invoice number — none of that appears on the on-screen statement,
// so none of it may appear on the document. See the note in lib/i18n.ts's
// `trips.statement` block: the ZATCA artifact is the invoice.
//
// Purity: no React, no fs, no Supabase, no `process`. Importable from a server
// action, a client component, or a test script alike.

import { type InvoicePaymentMethod, type WaterType } from "./db-types";
import { paymentMethodLabel, paymentModeLabel, waterTypeLabel } from "./enum-labels";
// `fill` dropped with the sample-ref line — it was this file's only token
// substitution. The VAT-split template is carried UNFILLED to the renderers on
// purpose (see `vatSplitTemplate`), so nothing here interpolates any more.
import { t, type TKey } from "./i18n";
import {
  buildStatementItems,
  consumingItems,
  round2,
  type BalanceReturnLite,
  type ConsumedItem,
  type ConsumingCharge,
  type ConsumingTrip,
  type SettlementStatementInput,
  type TopupStatementInput,
} from "./prepaid";
// The ref column's wording lives here for BOTH surfaces. lib/trip-ref.ts's own
// header requires it: "ALL trip-ref rendering (Kanban cards, invoice tables,
// statements) must go through this file". A document that printed a bare blank
// where the screen prints "No ref" would be a wording deviation, which is
// exactly what this view-model exists to make impossible.
import { formatTripRef } from "./trip-ref";

export type BiLabel = { en: string; ar: string };

function bi(key: TKey): BiLabel {
  return { en: t(key, "en"), ar: t(key, "ar") };
}

// ---------------------------------------------------------------------------
// Inputs — the exact prop set StatementModal already receives
// ---------------------------------------------------------------------------
// Deliberately field-for-field identical to the modal's props. That is what
// makes "the document mirrors the screen" true by construction rather than by
// discipline: both surfaces are handed the same object and call this same
// function on it.

// Per-trip display metadata, keyed by trip id (app/trips/StatementModal.tsx's
// TripMeta, re-declared here so the view-model does not import a React module).
// Kept OUTSIDE lib/prepaid.ts's ConsumingTrip/ConsumedItem, which stay untouched.
export type StatementTripMeta = {
  truckPlate: string | null;
  truckCapacityM3: number | null;
  invoiceLocked: boolean;
};

// One paid invoice. Postpaid renders it as a Payment (a real credit against
// what is owed); prepaid renders it as a record-only "Invoice payable" row.
export type StatementPaymentInput = {
  id: string;
  invoice_number: string;
  payment_method: InvoicePaymentMethod | null;
  payment_reference: string | null;
  payment_date: string | null;
  paid_at: string | null;
  grand_total_sar: number;
};

export type StatementVmInput = {
  customerName: string;
  projectName: string | null;
  mode: "prepaid" | "postpaid";
  topups: TopupStatementInput[];
  trips: ConsumingTrip[];
  charges: ConsumingCharge[];
  returns: BalanceReturnLite[];
  payments: StatementPaymentInput[];
  tripMetaById: Map<string, StatementTripMeta>;
  projectWaterType: WaterType | null;
  // `projectInitials` REMOVED with the sample-ref line it existed solely to
  // build. It was threaded FinanceTab -> modal -> view-model for that one
  // string; nothing else ever read it.
  // Period picker. Filters TABLE ROWS ONLY — the header figure stays global,
  // exactly as on screen (a bank statement's current balance does not move
  // because you scrolled to an old page).
  dateFrom: string;
  dateTo: string;
};

// ---------------------------------------------------------------------------
// Output — columns, rows, header
// ---------------------------------------------------------------------------

// The column set differs by MODE, in both membership and order — mirroring the
// two on-screen tables exactly. Prepaid is a ledger (ends on a running
// balance); postpaid is an itemised bill (breaks VAT out and ends on a total).
export type StatementColumnKey =
  | "date"
  | "type"
  | "truck"
  | "capacity"
  | "ref"
  | "note"
  | "amount"
  | "runningBalance"
  | "vat"
  | "total";

export type StatementColumn = { key: StatementColumnKey; label: BiLabel; align: "start" | "end" };

// A cell is one of four shapes. The renderer decides how each LOOKS; the
// view-model decides what each IS.
//   - text  : a bilingual or plain string (already resolved)
//   - date  : an ISO date, rendered as-is on both surfaces
//   - num   : a RAW number plus its sign treatment and optional VAT split
//   - empty : the em-dash placeholder both surfaces print for "not applicable"
export type StatementCell =
  | { kind: "empty" }
  | { kind: "date"; value: string }
  | { kind: "text"; value: string }
  | { kind: "bi"; value: BiLabel }
  // A trip reference that links on screen (TripRefLink) and prints as plain
  // text in the document. `tripId` is carried so the modal can build the link
  // without re-deriving which rows are trips.
  | { kind: "tripRef"; value: string; tripId: string }
  | {
      kind: "num";
      value: number;
      // "plus"  — a credit, rendered +N (top-up, postpaid payment)
      // "minus" — a debit, rendered −N (trip, charge, balance return)
      // "none"  — neither, rendered bare (settlement record, running balance,
      //           postpaid VAT/amount/total columns)
      sign: "plus" | "minus" | "none";
      // The faded "{net} + VAT {vat}" sub-line under a prepaid debit. Present
      // ONLY where the screen shows it: trip and charge rows. A balance return
      // carries none deliberately — a refund of credit is a cash movement, not
      // a taxable supply, so a VAT split there would be inventing a tax line.
      split: { net: number; vat: number } | null;
      // Screen-only emphasis flag, mirroring the modal's rose ink for a
      // negative running balance. The document is monochrome and ignores it.
      negative: boolean;
    };

export type StatementRow = {
  key: string;
  // The row's own nature, so a renderer can style it without re-deriving.
  // Mirrors StatementItemEntry's kinds plus postpaid's "payment".
  kind: "topup" | "trip" | "charge" | "settlement" | "return" | "payment";
  cells: StatementCell[];
};

export type StatementVm = {
  mode: "prepaid" | "postpaid";
  // Header — customer data. Turki's layout: this block, with the headline
  // figure beside it.
  title: BiLabel;
  customerName: string;
  projectName: string | null;
  modeLabel: BiLabel;
  subtitle: BiLabel;
  // THE PERIOD, as a header FIELD. It replaced the sample-ref line (see the
  // note in lib/i18n.ts's `trips.statement` block): a statement's period is a
  // fact about the document a reader needs before any figure on it means
  // anything, and it was previously a small strip under the header rather than
  // a field in it.
  //
  // Still echoed rather than recomputed — `periodFrom`/`periodTo` are the
  // picker's own two values, nothing more. null = all-time, and the document
  // says so in words rather than printing two blanks.
  periodFrom: string | null;
  periodTo: string | null;
  periodLabel: BiLabel;
  fromLabel: BiLabel;
  toLabel: BiLabel;
  allTimeLabel: BiLabel;
  // THE HEADLINE FIGURE, beside the header. Mode-dependent and period-
  // INDEPENDENT — computed from the full unfiltered data, same as on screen.
  //   prepaid  -> "Running balance:"  (the ledger's closing runningBalance)
  //   postpaid -> "Total payable:"    (VAT-inclusive total of every postpaid
  //                                    trip not yet on a PAID invoice)
  headline: { label: BiLabel; value: number; negative: boolean };
  columns: StatementColumn[];
  rows: StatementRow[];
  // Shown in place of the table when there are no rows. Which of the three
  // messages applies is decided here, not in a renderer.
  emptyLabel: BiLabel | null;
  currency: BiLabel;
  // The faded pre-VAT/VAT sub-line, carried as an UNFILLED template —
  // "{net} + VAT {vat}" from lib/i18n.ts, tokens intact. The wording is decided
  // here (one place, both surfaces); the two numbers are substituted by each
  // renderer in ITS OWN format, because the screen shows whole riyals and a
  // document shows two decimals. Resolving it here would freeze one of them.
  vatSplitTemplate: BiLabel;
};

// payment_date is a plain date (user-entered); paid_at is a full timestamp
// (server now()). Trimming the timestamp to date-only is the SAME "recorded vs
// actual" convention StatementModal's paymentDateOf used — lifted verbatim.
function paymentDateOf(p: StatementPaymentInput): string {
  return p.payment_date ?? (p.paid_at ? p.paid_at.slice(0, 10) : "");
}

const EMPTY: StatementCell = { kind: "empty" };

/**
 * Build the statement view-model.
 *
 * THE ORDER OF OPERATIONS BELOW IS THE MODAL'S, UNCHANGED:
 *   1. drop payments with no usable date (no place on a dated ledger)
 *   2. prepaid: map them to record-only settlements
 *   3. run buildStatementItems over the FULL, unfiltered inputs
 *   4. take the closing runningBalance from the FULL list
 *   5. filter to the visible period for display only
 * Reversing 3 and 5 would make the running balance restart mid-history — the
 * single most likely way to silently produce a wrong document.
 */
export function buildStatementVm(input: StatementVmInput): StatementVm {
  const {
    mode,
    topups,
    trips,
    charges,
    returns,
    payments,
    tripMetaById,
    projectWaterType,
    dateFrom,
    dateTo,
  } = input;

  const hasPeriodFilter = dateFrom !== "" || dateTo !== "";
  const inPeriod = (d: string) => (dateFrom === "" || d >= dateFrom) && (dateTo === "" || d <= dateTo);

  // A row with neither payment_date nor paid_at has no place on a dated
  // ledger, so it is dropped rather than sorted to the top under "".
  const allPayments = payments.filter((p) => paymentDateOf(p) !== "");

  const title = bi(mode === "prepaid" ? "trips.statement.titlePrepaid" : "trips.statement.titlePostpaid");
  const subtitle = bi(mode === "prepaid" ? "trips.statement.subPrepaid" : "trips.statement.subPostpaid");
  const modeLabel: BiLabel = { en: paymentModeLabel(mode, "en"), ar: paymentModeLabel(mode, "ar") };

  const common = {
    mode,
    title,
    customerName: input.customerName,
    projectName: input.projectName,
    modeLabel,
    subtitle,
    periodFrom: dateFrom === "" ? null : dateFrom,
    periodTo: dateTo === "" ? null : dateTo,
    // `periodLabel` was previously a JOINED "From — To" string that NO surface
    // rendered — dead the day it was written, and invisible to
    // `noUnusedLocals` because an object property is not a local. It is now the
    // field's heading, with the two date labels carried separately so a
    // renderer can put them where its medium wants them.
    periodLabel: bi("trips.statement.periodHeading"),
    fromLabel: bi("trips.statement.from"),
    toLabel: bi("trips.statement.to"),
    allTimeLabel: bi("trips.statement.allTime"),
    // SAR is a currency CODE, not a word — identical in both columns, same as
    // lib/invoiceViewModel.ts's biRaw("SAR").
    currency: { en: "SAR", ar: "SAR" } as BiLabel,
    vatSplitTemplate: bi("trips.statement.vatSplit"),
  };

  // The water-type Type cell, shared by both modes. Falls back to the
  // project's CURRENT water_type for pre-water_type-field rows; prints the
  // em-dash when neither exists. Display-only, mutates nothing.
  function waterTypeCell(rowType: WaterType | null | undefined): StatementCell {
    const wt = rowType ?? projectWaterType;
    if (!wt) return EMPTY;
    return { kind: "bi", value: { en: waterTypeLabel(wt, "en"), ar: waterTypeLabel(wt, "ar") } };
  }

  function truckCells(tripId: string): [StatementCell, StatementCell] {
    const meta = tripMetaById.get(tripId);
    const plate = meta?.truckPlate ?? null;
    const cap = meta?.truckCapacityM3 ?? null;
    return [
      plate ? { kind: "text", value: plate } : EMPTY,
      // The "m³" unit is part of the value on screen; kept identical here so
      // the two surfaces cannot disagree about the unit.
      cap != null ? { kind: "text", value: `${cap} m³` } : EMPTY,
    ];
  }

  // ---- Prepaid: the bank-statement ledger --------------------------------
  if (mode === "prepaid") {
    // Record-only rows: a paid prepaid invoice is TRACED, never deducted.
    const settlements: SettlementStatementInput[] = allPayments.map((p) => ({
      id: p.id,
      date: paymentDateOf(p),
      invoice_number: p.invoice_number,
      amount: p.grand_total_sar,
    }));

    // FULL (unfiltered) sequence — the running balance must reflect true
    // cumulative history even when the visible rows are period-filtered.
    const allEntries = buildStatementItems(topups, trips, charges, undefined, settlements, returns);
    const entries = allEntries.filter((e) => inPeriod(e.date));
    const balance = allEntries.length > 0 ? allEntries[allEntries.length - 1].runningBalance : 0;

    // Pre-VAT/VAT breakdown for debit rows — a second call to the SAME pure
    // function buildStatementItems() calls internally, keyed by kind+id. No new
    // math: consumingItems() already carries both the pre-VAT `amount` and the
    // VAT-inclusive `consumedAmount`.
    const consumedById = new Map<string, ConsumedItem>(
      consumingItems(trips, charges).map((e) => [`${e.kind}:${e.id}`, e]),
    );

    const columns: StatementColumn[] = [
      { key: "date", label: bi("common.date"), align: "start" },
      { key: "type", label: bi("common.type"), align: "start" },
      { key: "truck", label: bi("common.truck"), align: "start" },
      { key: "capacity", label: bi("common.capacity"), align: "start" },
      { key: "ref", label: bi("trips.statement.colRef"), align: "start" },
      { key: "note", label: bi("common.note"), align: "start" },
      { key: "amount", label: bi("common.amount"), align: "end" },
      { key: "runningBalance", label: bi("trips.statement.colRunningBalance"), align: "end" },
    ];

    const rows: StatementRow[] = entries.map((e) => {
      const isTrip = e.kind === "trip";
      const [truck, capacity] = isTrip ? truckCells(e.id) : [EMPTY, EMPTY];

      // TYPE — four named kinds; the fifth renders the trip's water type.
      const typeCell: StatementCell =
        e.kind === "topup"
          ? { kind: "bi", value: bi("trips.finance.addBalance") }
          : e.kind === "settlement"
            ? { kind: "bi", value: bi("trips.statement.typeSettlement") }
            : e.kind === "return"
              ? { kind: "bi", value: bi("trips.statement.typeReturn") }
              : e.kind === "charge"
                ? { kind: "bi", value: bi("trips.statement.typeCharge") }
                : waterTypeCell(e.water_type);

      // REF — a trip links; a top-up/settlement shows its reference; the rest
      // are blank.
      const refCell: StatementCell = isTrip
        ? { kind: "tripRef", value: formatTripRef(e.ref), tripId: e.id }
        : (e.kind === "topup" || e.kind === "settlement") && e.reference
          ? { kind: "text", value: e.reference }
          : EMPTY;

      // NOTE — never shown for a top-up (its reference is in the Ref column);
      // fixed wording for a settlement; the row's own note otherwise.
      const noteCell: StatementCell =
        e.kind === "topup"
          ? EMPTY
          : e.kind === "settlement"
            ? { kind: "bi", value: bi("trips.statement.noteBalance") }
            : e.note
              ? { kind: "text", value: e.note }
              : EMPTY;

      // AMOUNT — the sign treatment IS the row's meaning.
      const consumed = isTrip || e.kind === "charge" ? consumedById.get(`${e.kind}:${e.id}`) : undefined;
      const amountCell: StatementCell =
        e.kind === "topup"
          ? { kind: "num", value: e.amount, sign: "plus", split: null, negative: false }
          : e.kind === "settlement"
            ? // Neither a credit nor a debit — no sign, no VAT split. The
              // document's own total, for the record.
              { kind: "num", value: e.amount, sign: "none", split: null, negative: false }
            : e.kind === "return"
              ? // A real debit — signed, and the running balance moves with it.
                // No VAT split (see StatementCell's `split` note).
                { kind: "num", value: Math.abs(e.amount), sign: "minus", split: null, negative: false }
              : {
                  kind: "num",
                  value: Math.abs(e.amount),
                  sign: "minus",
                  split: {
                    net: consumed?.amount ?? 0,
                    vat: round2((consumed?.consumedAmount ?? 0) - (consumed?.amount ?? 0)),
                  },
                  negative: false,
                };

      return {
        key: `${e.kind}-${e.id}`,
        kind: e.kind,
        cells: [
          { kind: "date", value: e.date },
          typeCell,
          truck,
          capacity,
          refCell,
          noteCell,
          amountCell,
          { kind: "num", value: e.runningBalance, sign: "none", split: null, negative: e.runningBalance < 0 },
        ],
      };
    });

    return {
      ...common,
      headline: {
        label: bi("trips.statement.footRunningBalance"),
        value: balance,
        negative: balance < 0,
      },
      columns,
      rows,
      emptyLabel:
        rows.length > 0
          ? null
          : bi(hasPeriodFilter ? "trips.statement.emptyPeriod" : "trips.statement.emptyPrepaid"),
    };
  }

  // ---- Postpaid: itemised trips + recorded payments -----------------------
  // Trip rows come from consumingItems() directly (trip entries only —
  // postpaid passes no charges), the same pure "what counts" function.
  const allPostpaidTrips = consumingItems(trips).filter((e) => e.kind === "trip");
  const postpaidTrips = allPostpaidTrips.filter((tr) => inPeriod(tr.trip_date));

  // "Total payable" — VAT-inclusive total of every postpaid trip NOT yet on a
  // paid invoice (tripMetaById's invoiceLocked, the same flag Settled Balance
  // uses). GLOBAL — period-independent, same as prepaid's balance.
  const totalPayable = round2(
    allPostpaidTrips.filter((tr) => !tripMetaById.get(tr.id)?.invoiceLocked).reduce((s, tr) => s + tr.consumedAmount, 0),
  );

  const paymentRows = allPayments.filter((p) => inPeriod(paymentDateOf(p)));

  // Merge trip + payment rows chronologically — payments render like any other
  // statement row, oldest first.
  const merged: (
    | { kind: "trip"; date: string; row: ConsumedItem }
    | { kind: "payment"; date: string; row: StatementPaymentInput }
  )[] = [
    ...postpaidTrips.map((tr) => ({ kind: "trip" as const, date: tr.trip_date, row: tr })),
    ...paymentRows.map((p) => ({ kind: "payment" as const, date: paymentDateOf(p), row: p })),
  ].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));

  const columns: StatementColumn[] = [
    { key: "date", label: bi("common.date"), align: "start" },
    { key: "ref", label: bi("trips.statement.colRef"), align: "start" },
    { key: "type", label: bi("common.type"), align: "start" },
    { key: "truck", label: bi("common.truck"), align: "start" },
    { key: "capacity", label: bi("common.capacity"), align: "start" },
    { key: "amount", label: bi("common.amount"), align: "end" },
    { key: "vat", label: bi("trips.statement.colVat"), align: "end" },
    { key: "total", label: bi("common.total"), align: "end" },
  ];

  const rows: StatementRow[] = merged.map((r) => {
    if (r.kind === "trip") {
      const tr = r.row;
      const [truck, capacity] = truckCells(tr.id);
      return {
        key: `trip-${tr.id}`,
        kind: "trip" as const,
        cells: [
          { kind: "date", value: tr.trip_date },
          { kind: "tripRef", value: formatTripRef(tr.ref), tripId: tr.id },
          waterTypeCell(tr.water_type),
          truck,
          capacity,
          // AMOUNT is PRE-VAT here (VAT is broken out in its own column) —
          // the postpaid convention, unchanged.
          { kind: "num", value: tr.amount, sign: "none", split: null, negative: false },
          { kind: "num", value: round2(tr.consumedAmount - tr.amount), sign: "none", split: null, negative: false },
          { kind: "num", value: tr.consumedAmount, sign: "none", split: null, negative: false },
        ],
      };
    }
    const p = r.row;
    // The REFERENCE column. bank_transfer is the only method that carries one
    // (0039 requires it), so it shows the reference; every other method names
    // itself from the shared label map instead. Reading the branch the other
    // way round is what made 0134's 'balance' render as a bare em dash.
    const refCell: StatementCell =
      p.payment_method === "bank_transfer"
        ? p.payment_reference
          ? { kind: "text", value: p.payment_reference }
          : EMPTY
        : p.payment_method
          ? {
              kind: "bi",
              value: { en: paymentMethodLabel(p.payment_method, "en"), ar: paymentMethodLabel(p.payment_method, "ar") },
            }
          : EMPTY;
    return {
      key: `payment-${p.id}`,
      kind: "payment" as const,
      cells: [
        paymentDateOf(p) ? { kind: "date", value: paymentDateOf(p) } : EMPTY,
        refCell,
        { kind: "bi", value: bi("trips.statement.typePayment") },
        EMPTY,
        EMPTY,
        EMPTY,
        EMPTY,
        { kind: "num", value: p.grand_total_sar, sign: "plus", split: null, negative: false },
      ],
    };
  });

  return {
    ...common,
    headline: {
      label: bi("trips.statement.footTotalPayable"),
      value: totalPayable,
      // Mirrors the modal's rose ink, which triggers on > 0 for postpaid
      // (money owed) rather than < 0. Same predicate, not a new one.
      negative: totalPayable > 0,
    },
    columns,
    rows,
    emptyLabel:
      rows.length > 0 ? null : bi(hasPeriodFilter ? "trips.statement.emptyPeriod" : "trips.statement.emptyPostpaid"),
  };
}
