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
// It does not compute money.
//
//   PREPAID (rebuilt on 0203's customer_ledger): every row is a ledger row
//   passed in verbatim, the headline Balance is v_customer_ledger_balance's
//   figure passed in, and the footer amount is v_customer_uninvoiced's. The
//   ONE cumulative walk below (running balance down the rows) is presentation
//   of the rows' own amounts in sequence — the directive's sanctioned display
//   device — and is never used as a source figure: the headline is the view's,
//   not the walk's. Nothing reads lib/prepaid.ts's derived balance any more.
//
//   POSTPAID (unchanged): lib/prepaid.ts's consumingItems() remains the only
//   expression of what a postpaid trip costs, called with exactly the
//   arguments the modal always passed.
//
// Nothing here re-signs, re-rounds, re-bases or re-sums a single amount. This
// file ARRANGES what it is handed; it does not participate in the money-core.
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
// POSTPAID-ONLY imports. The prepaid arm no longer touches lib/prepaid.ts —
// its rows arrive as ledger rows and its figures as view columns (0203).
import { consumingItems, round2, type ConsumedItem, type ConsumingTrip } from "./prepaid";
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

// One prepaid ledger row, exactly as customer_ledger stores it plus the joined
// invoice number. Re-declared here (rather than imported from
// lib/customer-ledger.ts) so this view-model stays importable from a test
// script with no Supabase types in the graph — the same reason
// StatementTripMeta is re-declared above.
export type StatementLedgerEntryType =
  | "topup"
  | "invoice_draw"
  | "balance_applied"
  | "refund"
  | "correction"
  | "draw_reversal";

export type StatementLedgerEntry = {
  id: string;
  entry_type: StatementLedgerEntryType;
  /** SIGNED, as stored: money in positive, money out negative
   *  (customer_ledger_sign_check). Never re-signed here. */
  amount_sar: number;
  doc_number: string | null;
  /** The joined invoices.invoice_number, for invoice-linked rows. */
  invoice_number: string | null;
  method: string | null;
  reference: string | null;
  note: string | null;
  /** timestamptz. The row's date on the statement is its first 10 chars. */
  created_at: string;
};

export type StatementVmInput = {
  customerName: string;
  projectName: string | null;
  mode: "prepaid" | "postpaid";
  // ---- Prepaid inputs (0203 ledger model) --------------------------------
  /** The customer's ledger rows, oldest first. Prepaid only; ignored postpaid. */
  ledger: StatementLedgerEntry[];
  /** v_customer_ledger_balance.balance_sar — THE headline figure, passed
   *  through. Never derived from the rows here. */
  balance: number;
  /** Count of delivered-but-uninvoiced trips (lib/customer-ledger.ts's count
   *  query) and v_customer_uninvoiced.uninvoiced_sar, for the footer line. */
  uninvoicedCount: number;
  uninvoicedSar: number;
  // ---- Postpaid inputs (unchanged path) ----------------------------------
  trips: ConsumingTrip[];
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
// two on-screen tables exactly. Prepaid is a bank-statement ledger of 0203
// rows (date/type/ref/method/note/amount, ending on a running balance);
// postpaid is an itemised bill (breaks VAT out and ends on a total).
export type StatementColumnKey =
  | "date"
  | "type"
  | "truck"
  | "capacity"
  | "ref"
  | "method"
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
  // "N deliveries not yet invoiced — X SAR" under the prepaid table. Carried
  // the same way as vatSplitTemplate: an UNFILLED template plus the two raw
  // figures, substituted by each renderer in its own number format. The
  // AMOUNT is v_customer_uninvoiced.uninvoiced_sar passed through, so
  // Balance − footer amount reconciles with Available by construction. null
  // on postpaid, and on a prepaid statement with nothing uninvoiced — a
  // renderer seeing null prints nothing.
  uninvoicedFooter: { template: BiLabel; count: number; amount: number } | null;
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
 * PREPAID ORDER OF OPERATIONS:
 *   1. walk the FULL ledger oldest-first, annotating each row with the
 *      cumulative running balance
 *   2. filter to the visible period for display only
 *   3. the headline is the PASSED-IN view balance, period-independent
 * Filtering before walking would make the running balance restart mid-history
 * — the single most likely way to silently produce a wrong document.
 *
 * POSTPAID is byte-identical to what it was before the ledger rebuild.
 */
export function buildStatementVm(input: StatementVmInput): StatementVm {
  const {
    mode,
    ledger,
    trips,
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

  // ---- Prepaid: the bank-statement ledger (0203 rows, verbatim) -----------
  if (mode === "prepaid") {
    // FULL (unfiltered) walk — the running balance must reflect true
    // cumulative history even when the visible rows are period-filtered.
    // The walk is PRESENTATION: it shows each row's own signed amount
    // accumulating down the page. The headline is NOT taken from it — that is
    // the view's balance, passed in.
    let run = 0;
    const annotated = ledger.map((e) => {
      run += e.amount_sar;
      return { e, running: run };
    });
    const entries = annotated.filter(({ e }) => inPeriod(e.created_at.slice(0, 10)));

    const columns: StatementColumn[] = [
      { key: "date", label: bi("common.date"), align: "start" },
      { key: "type", label: bi("common.type"), align: "start" },
      { key: "ref", label: bi("trips.statement.colRef"), align: "start" },
      { key: "method", label: bi("trips.finance.colMethod"), align: "start" },
      { key: "note", label: bi("common.note"), align: "start" },
      { key: "amount", label: bi("common.amount"), align: "end" },
      { key: "runningBalance", label: bi("trips.statement.colRunningBalance"), align: "end" },
    ];

    // Entry type -> the row's STYLING kind. Reuses the union the renderers
    // already switch over exhaustively, so no renderer needs a new arm:
    //   money in  (topup)                    -> "topup"    (green)
    //   money back to customer (refund)      -> "return"   (amber)
    //   money drawn (invoice_draw /
    //                balance_applied)        -> "charge"   (muted)
    //   money restored (draw_reversal)       -> "payment"  (green)
    //   correction                           -> by its sign
    const kindOf = (e: StatementLedgerEntry): StatementRow["kind"] =>
      e.entry_type === "topup"
        ? "topup"
        : e.entry_type === "refund"
          ? "return"
          : e.entry_type === "draw_reversal"
            ? "payment"
            : e.entry_type === "correction"
              ? e.amount_sar > 0
                ? "payment"
                : "charge"
              : "charge";

    const typeKeyOf = (e: StatementLedgerEntry): TKey =>
      e.entry_type === "topup"
        ? "trips.finance.addBalance"
        : e.entry_type === "refund"
          ? "trips.statement.typeReturn"
          : e.entry_type === "invoice_draw"
            ? "trips.statement.typeInvoiceDraw"
            : e.entry_type === "balance_applied"
              ? "trips.statement.typeBalanceApplied"
              : e.entry_type === "draw_reversal"
                ? "trips.statement.typeDrawReversal"
                : "trips.statement.typeCorrection";

    const rows: StatementRow[] = entries.map(({ e, running }) => {
      // REF — the row's own document number (RCT-… / CN-…), or the invoice it
      // is linked to. A correction has neither, deliberately: its paper trail
      // is the corrections table, not a numbered document.
      const refCell: StatementCell = e.doc_number
        ? { kind: "text", value: e.doc_number }
        : e.invoice_number
          ? { kind: "text", value: e.invoice_number }
          : EMPTY;

      // METHOD — only rows where money physically changed hands carry one.
      const methodCell: StatementCell = e.method
        ? {
            kind: "bi",
            value: {
              en: paymentMethodLabel(e.method as InvoicePaymentMethod, "en"),
              ar: paymentMethodLabel(e.method as InvoicePaymentMethod, "ar"),
            },
          }
        : EMPTY;

      // NOTE — the row's note, else its bank reference, else blank.
      const noteCell: StatementCell = e.note
        ? { kind: "text", value: e.note }
        : e.reference
          ? { kind: "text", value: e.reference }
          : EMPTY;

      // AMOUNT — the ledger's own sign IS the row's meaning; the cell shows
      // the magnitude and the sign glyph restates the direction. No VAT split
      // anywhere: a ledger row is a money movement, not a taxable supply —
      // the tax lives on the invoice the draw points at.
      const amountCell: StatementCell = {
        kind: "num",
        value: Math.abs(e.amount_sar),
        sign: e.amount_sar > 0 ? "plus" : "minus",
        split: null,
        negative: false,
      };

      return {
        key: `ledger-${e.id}`,
        kind: kindOf(e),
        cells: [
          { kind: "date", value: e.created_at.slice(0, 10) },
          { kind: "bi", value: bi(typeKeyOf(e)) },
          refCell,
          methodCell,
          noteCell,
          amountCell,
          { kind: "num", value: running, sign: "none", split: null, negative: running < 0 },
        ],
      };
    });

    return {
      ...common,
      headline: {
        // THE VIEW'S FIGURE, passed through — v_customer_ledger_balance. The
        // walk above agrees with it by construction (same rows, same signs),
        // but the view is the authority.
        label: bi("trips.statement.footBalance"),
        value: input.balance,
        negative: input.balance < 0,
      },
      columns,
      rows,
      emptyLabel:
        rows.length > 0
          ? null
          : bi(hasPeriodFilter ? "trips.statement.emptyPeriod" : "trips.statement.emptyPrepaid"),
      uninvoicedFooter:
        input.uninvoicedCount > 0 || input.uninvoicedSar !== 0
          ? {
              template: bi("trips.statement.footUninvoiced"),
              count: input.uninvoicedCount,
              amount: input.uninvoicedSar,
            }
          : null,
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
    // Postpaid has no prepaid balance to reconcile — the footer is a prepaid
    // device and its absence here is what keeps this arm byte-identical.
    uninvoicedFooter: null,
  };
}
