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
//   PREPAID: a statement of the WHOLE ACCOUNT, not of the money pot alone.
//   Five sources are merged into one date-ordered list — customer_ledger rows
//   (0203), delivered trips, special charges, `invoice_payments` rows, and
//   LEGACY paid invoices — and every figure on every one of them is passed in,
//   never derived. The headline Balance is v_customer_ledger_balance's, the
//   footer amount is v_customer_uninvoiced's, a trip's cost is
//   consumingItems()'s.
//
//   THE PAYMENT SOURCE IS THE PAYMENT TABLE, NOT THE INVOICE. It used to be
//   the invoice: one row per PAID invoice, printing that invoice's grand
//   total. Under 0204 that understates the account, and understates it in the
//   normal case. Confirm no longer moves money, so an invoice rests at
//   confirmed while money arrives against it in instalments — each one an
//   `invoice_payments` row with its own date, method, reference and amount.
//   Reading whole paid invoices meant a partial payment appeared NOWHERE until
//   the invoice happened to reach zero, and then appeared once, at the wrong
//   amount, on the wrong date. So `invoicePayments` is now the source, and
//   `payments` survives for LEGACY invoices only — the pre-0203 documents that
//   carry their settlement on the invoice row itself (payment_method /
//   payment_date / payment_reference) and have no payment rows to read. The
//   test is invoiceEra()'s, not a status test: `amount_payable_sar == null`.
//   Rendering both unconditionally would print a modern invoice twice.
//
//   A PAYMENT DOES NOT MOVE THE HELD BALANCE, and the running-balance column
//   must not pretend otherwise. `record_invoice_payment` writes
//   `invoice_payments` and nothing else; `apply_balance_to_invoice` writes a
//   `customer_ledger` row (`balance_applied`) and nothing else. The two doors
//   are disjoint by construction in 0204, so a balance draw reaches this file
//   exactly once — through `ledger`, where it advances the walk — and a cash
//   or transfer payment reaches it exactly once, through `invoicePayments`,
//   where it does not. No de-duplication is needed and none is performed.
//
//   TWO CLASSES OF ROW, and the distinction is the whole design. Rows that
//   MOVE the money held on account are the ledger rows, and only they advance
//   the running balance. Rows that RECORD something without moving it — a trip
//   delivered, a special charge raised, a payment made straight against an
//   invoice — print their own amount and carry the running balance forward
//   UNCHANGED. A delivered trip is work performed that creates a liability;
//   the balance only falls later, when balance is applied to the invoice that
//   bills it. A direct invoice payment settles that invoice with new money and
//   never touches the held balance. Those rows are flagged `recordOnly` so a
//   renderer can mark them without re-deriving the rule, and the document
//   carries `balanceNote` saying it in words — without that sentence the
//   second class reads as an arithmetic fault.
//
//   The ONE cumulative walk below is presentation of the ledger rows' own
//   amounts in sequence — the directive's sanctioned display device — and is
//   never used as a source figure: the headline is the view's, not the walk's.
//   The old app-derived balance is gone with lib/prepaid.ts (0206).
//
//   POSTPAID (unchanged): lib/money.ts's consumingItems() remains the only
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
// consumingItems() is now read by BOTH arms. It was postpaid-only while the
// prepaid statement printed ledger rows alone; the merged statement prints
// delivered trips and special charges too, and this is the ONE expression of
// what one of those costs (VAT-inclusive `consumedAmount`, the same basis
// v_customer_uninvoiced totals). The prepaid arm still derives no BALANCE from
// it — its figures are view columns passed in, exactly as before.
import { consumingItems, round2, type ConsumedItem, type ConsumingCharge, type ConsumingTrip } from "./money";
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
// Kept OUTSIDE lib/money.ts's ConsumingTrip/ConsumedItem, which stay untouched.
export type StatementTripMeta = {
  truckPlate: string | null;
  truckCapacityM3: number | null;
  /** On an invoice whose status is 'paid'. Drives the Type label's paid/unpaid
   *  half and, on the postpaid arm, the Settled-Balance filter. */
  invoiceLocked: boolean;
  /** On a LEGACY issued invoice — confirmed or paid with a null
   *  `amount_payable_sar`. Such a trip is in NEITHER term of
   *  v_customer_available (its invoice is not draft/review, so it is not
   *  Uninvoiced; its payable is null, so it is not confirmed-unsettled) and
   *  its money is already inside the 0203 seeded opening balance. Deducting
   *  it would take it off Available twice. */
  legacyInvoice: boolean;
};

// One `invoice_payments` row — money arriving against an invoice, which since
// 0204 is normally one of several. THE PRIMARY PAYMENT SOURCE on both arms.
// Postpaid renders it as a Payment (a real credit against what is owed);
// prepaid renders it as a record-only "Invoice paid" row — money that arrived
// FOR an invoice, which is why it never moves the held balance and never
// advances the running-balance column.
//
// `invoice_number` is the JOINED invoices.invoice_number, carried rather than
// looked up: this file holds no invoice list and resolving a number from an id
// would make it depend on one. Same reason StatementLedgerEntry carries it.
//
// `paid_on` is the operator-entered date and `created_at` the server stamp;
// the row is dated by the first and falls back to the second — the same
// "recorded vs actual" convention paymentDateOf() applies to a legacy invoice
// and StatementChargeInput applies to a charge. A payment row therefore always
// has a date and, unlike a legacy invoice, can never be dropped for lacking
// one.
export type StatementInvoicePaymentInput = {
  id: string;
  invoice_id: string;
  invoice_number: string;
  amount_sar: number;
  method: InvoicePaymentMethod | null;
  reference: string | null;
  paid_on: string | null;
  note: string | null;
  created_at: string;
};

// One paid invoice — LEGACY ONLY, see the header. A pre-0203 invoice carries
// its settlement on its own row and has no `invoice_payments` history, so this
// is the only record of it; a ledger-era invoice is rendered from its payment
// rows and its balance draws, and must NOT also appear here.
//
// `amount_payable_sar` is carried for exactly that filter and nothing else. It
// is invoiceEra()'s discriminator (lib/invoice-era.ts) — null means "confirmed
// before 0203", which is the one thing it can mean on a paid invoice. The
// column is read rather than the STATUS because status cannot answer the
// question: 'paid' is reachable in both eras.
export type StatementPaymentInput = {
  id: string;
  invoice_number: string;
  payment_method: InvoicePaymentMethod | null;
  payment_reference: string | null;
  payment_date: string | null;
  paid_at: string | null;
  grand_total_sar: number;
  amount_payable_sar: number | null;
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
  /** timestamptz — the moment the row was written. ORDERS the row. */
  created_at: string;
  /** The day the money moved (0208) — operator-picked on a top-up, this row's
   *  own day on every other writer. DATES the row. */
  entry_date: string;
};

// One special charge, as invoice_special_charges stores it. `charge_date` is
// NULLABLE at the database level (migration 0032 added the column, so rows
// older than it carry none) and this is the one place that decides the
// fallback: the row's own created_at date. lib/money.ts's ConsumingCharge
// demands a resolved date and refuses to guess, so the resolution happens here
// on the way in, exactly the caller-resolves convention that type documents.
export type StatementChargeInput = {
  id: string;
  label: string | null;
  /** Pre-VAT, as stored. consumingItems() adds the VAT, nothing here does. */
  amount_sar: number;
  charge_date: string | null;
  created_at: string;
  /** On a LEGACY issued invoice — same test and same reason as
   *  StatementTripMeta.legacyInvoice. Excluded from the Available walk. */
  legacyInvoice: boolean;
};

export type StatementVmInput = {
  customerName: string;
  projectName: string | null;
  mode: "prepaid" | "postpaid";
  // ---- Prepaid inputs (0203 ledger model) --------------------------------
  /** The customer's ledger rows, oldest first. Prepaid only; ignored postpaid. */
  ledger: StatementLedgerEntry[];
  /** v_customer_ledger_balance.balance_sar — the money ON THE LEDGER, passed
   *  through. No longer the headline (see `available`); still the figure the
   *  Finance tab's Balance column shows, carried so the two agree. */
  balance: number;
  /** v_customer_available.available_sar — THE headline figure, and the figure
   *  the running column closes on.
   *
   *  Balance − Uninvoiced − the unsettled remainder of confirmed ledger-era
   *  invoices, computed IN THE VIEW. Passed through, never derived here: the
   *  walk below is presentation of the same arithmetic row by row, and the
   *  view is the authority it must agree with. */
  available: number;
  /** Count of delivered-but-uninvoiced trips (lib/customer-ledger.ts's count
   *  query) and v_customer_uninvoiced.uninvoiced_sar, for the footer line. */
  uninvoicedCount: number;
  uninvoicedSar: number;
  // ---- Shared inputs -----------------------------------------------------
  // These three were the POSTPAID arm's alone while the prepaid statement
  // printed ledger rows only. The merged statement reads them too, so a
  // delivered trip and a paid invoice appear on both documents — as an
  // itemised bill line on postpaid, as a record-only row on prepaid.
  trips: ConsumingTrip[];
  /** PAID invoices — rendered for the LEGACY era only (see the type). The
   *  field keeps its name because every caller already passes the whole paid
   *  set and the filter is this file's business, not theirs. */
  payments: StatementPaymentInput[];
  /** `invoice_payments` rows — THE payment source since 0204. Required, not
   *  optional: `charges` may default to [] because a customer with none is the
   *  ordinary case and absence reads the same as emptiness, but a caller that
   *  forgot THIS renders a statement which silently omits every settlement
   *  made since the ledger model landed. A compile error is the cheaper
   *  failure. */
  invoicePayments: StatementInvoicePaymentInput[];
  /** Special charges, PREPAID ONLY and OPTIONAL. Optional because the caller
   *  chain that feeds this view-model does not thread them yet (FinanceTab
   *  already groups them per customer but does not pass the group down), and a
   *  required field would have every existing call site fail to compile while
   *  handing over an empty array. Absent reads as "no charges", which is the
   *  truthful rendering of a customer who has none. The postpaid arm ignores
   *  it: its charges are invoice lines, not statement rows. */
  charges?: StatementChargeInput[];
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
  | {
      kind: "bi";
      value: BiLabel;
      // SCREEN-ONLY SPLIT of the SAME label. `value` is always the whole
      // thing, so every renderer that ignores this field prints it complete —
      // the document and the PDF do exactly that, and must, being monochrome.
      // The screen uses it to ink the qualifier ALONE: on a trip row "Trip
      // delivered —" keeps the table's own colour and only "paid"/"unpaid"
      // carries the green or the amber. `stem + " " + tail` reconstructs
      // `value` exactly, and a parity check holds it to that.
      inkSplit?: { stem: BiLabel; tail: BiLabel };
    }
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
  // TRUE when this row RECORDS an event without moving the money held on
  // account — a delivered trip, a special charge, a payment made straight
  // against an invoice. The running-balance column holds flat across it.
  //
  // Decided here, once, rather than inferred from `kind` by each renderer:
  // "charge" means a balance DRAW on a ledger row and a record-only special
  // charge on a merged row, so kind alone cannot answer the question. Always
  // false on postpaid, which has no held balance for a row to move or not
  // move.
  recordOnly: boolean;
  /**
   * A TRIP ROW'S PAID STATE, for ink only. "paid" and "unpaid" appear on trip
   * rows; every other row leaves it undefined.
   *
   * Carried BESIDE `kind` rather than folded into it because it is not a kind
   * of event — it is the same event (a delivery) in two settlement states, and
   * widening the kind union would make every renderer that switches on kind
   * grow two arms for one thing. The WORDS are in the Type cell already, which
   * is what carries the distinction onto the monochrome printed surfaces; this
   * only tells a colour surface which colour.
   */
  tone?: "paid" | "unpaid";
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
  // THE RUNNING-BALANCE FOOTNOTE, prepaid only (null on postpaid, which has no
  // such column). It says in words what `recordOnly` says in a flag: the
  // running balance is the money held on account, and delivered work and
  // direct invoice payments do not change it. Without it, every record-only
  // row reads as an arithmetic fault — an amount printed beside a balance that
  // did not move. It belongs with the VAT-basis caption on both surfaces
  // because it is a note about HOW TO READ the figures, not a figure.
  balanceNote: BiLabel | null;
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

// The same convention on an `invoice_payments` row: `paid_on` is the date the
// operator says the money arrived, `created_at` the moment it was recorded.
// Total — `created_at` is NOT NULL on the table — so unlike paymentDateOf()
// this can never return "" and no payment row is ever dropped off the list.
function invoicePaymentDateOf(p: StatementInvoicePaymentInput): string {
  return p.paid_on ?? p.created_at.slice(0, 10);
}

// LEGACY ONLY — see StatementPaymentInput. invoiceEra()'s rule, restated on the
// one column that carries it rather than imported: lib/invoice-era.ts takes a
// `Pick<Invoice, "status" | "amount_payable_sar">` and this type has no status
// (every row here is already paid, which is why it was fetched), so calling it
// would mean inventing a status to satisfy the signature. The predicate itself
// is one comparison and is stated in both places identically.
function isLegacyPaidInvoice(p: StatementPaymentInput): boolean {
  return p.amount_payable_sar == null;
}

const EMPTY: StatementCell = { kind: "empty" };

/**
 * Build the statement view-model.
 *
 * PREPAID ORDER OF OPERATIONS:
 *   1. merge the four sources (ledger rows, delivered trips, special charges,
 *      invoice payments) into ONE list, oldest first
 *   2. walk that FULL list, advancing the running balance on ledger rows and
 *      carrying it flat across the rest, stamping every row with the figure
 *      that stands after it
 *   3. filter to the visible period for display only
 *   4. the headline is the PASSED-IN view balance, period-independent
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
    invoicePayments,
    charges = [],
    tripMetaById,
    projectWaterType,
    dateFrom,
    dateTo,
  } = input;

  const hasPeriodFilter = dateFrom !== "" || dateTo !== "";
  const inPeriod = (d: string) => (dateFrom === "" || d >= dateFrom) && (dateTo === "" || d <= dateTo);

  // LEGACY PAID INVOICES ONLY, and only those that can be dated. A ledger-era
  // invoice is rendered from its `invoice_payments` rows and its
  // `balance_applied` ledger rows, so admitting it here would print it twice;
  // a row with neither payment_date nor paid_at has no place on a dated ledger
  // at all, so it is dropped rather than sorted to the top under "".
  const allPayments = payments.filter((p) => isLegacyPaidInvoice(p) && paymentDateOf(p) !== "");

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

  // ---- Prepaid: one chronological record of the whole account ------------
  if (mode === "prepaid") {
    // SPECIAL CHARGES, dated on the way in. lib/money.ts's ConsumingCharge
    // requires a resolved charge_date and holds no opinion about where it came
    // from; invoice_special_charges.charge_date is nullable, so the row's own
    // created_at date is the fallback. Resolved here and nowhere else.
    // Charges on a LEGACY issued invoice, by id. Same exclusion as a trip's
    // `legacyInvoice` flag and for the same reason — the view counts them in
    // neither term. A Set because the walk asks per row.
    const legacyChargeIds = new Set(charges.filter((c) => c.legacyInvoice).map((c) => c.id));

    const chargeInputs: ConsumingCharge[] = charges.map((c) => ({
      id: c.id,
      charge_date: c.charge_date ?? c.created_at.slice(0, 10),
      amount_sar: c.amount_sar,
      label: c.label,
    }));

    // THE ONE EXPRESSION OF WHAT WORK COSTS, for trips and charges alike —
    // the same call the postpaid arm makes. It filters trips to delivered
    // (delivered_at not null) and attaches the VAT-inclusive `consumedAmount`,
    // which is the basis v_customer_uninvoiced totals in, so the rows and the
    // footer figure speak about money the same way.
    const items = consumingItems(trips, chargeInputs);

    // ONE LIST, FIVE SOURCES. `rank` is the same-date tiebreak and it is
    // ordered the way an account reads: money movements first, then the work
    // they paid for, then the charges, then a legacy whole-invoice settlement.
    // `tie` is the last resort so the order is total and therefore stable run
    // to run — a statement that reshuffles two same-day rows between renders
    // is a statement nobody can reconcile.
    //
    // A SETTLEMENT'S TWO HALVES SHARE RANK 0 AND SORT BY THE CLOCK, which is
    // what keeps them next to each other on the page. Settling one invoice can
    // produce two rows — the balance draw, then the cash or transfer covering
    // what the balance could not — and Mark Paid writes them seconds apart.
    // They used to sit in separate rank classes (0 and 3) with every trip
    // delivered that day in between, so on a busy day the two halves of one
    // settlement were dozens of rows apart while two unrelated invoices'
    // payments ended up adjacent, looking like a pair. On a ~40-truck fleet
    // that is the ordinary case, not an edge one.
    //
    // Both halves carry a real `created_at`, so the fix is chronology rather
    // than grouping machinery: rank 0 holds every TIMED money row and orders
    // them by the instant they happened. Nothing has to know which payment
    // belongs to which draw — written seconds apart, they land together.
    //
    // TRIPS AND CHARGES KEEP THEIR OWN RANKS because they are dated but not
    // timed (a delivery has a day, not a clock reading), so they cannot join a
    // chronological class without inventing a time for them.
    //
    // LEGACY WHOLE-INVOICE ROWS STAY AT RANK 4. A pre-0203 invoice was settled
    // on its own row and has no balance draw to sit beside, so moving it would
    // buy no adjacency and would reorder statements that are already issued.
    type PrepaidEvent =
      | { date: string; rank: 0; tie: string; src: "ledger"; entry: StatementLedgerEntry }
      | { date: string; rank: 1 | 2; tie: string; src: "item"; item: ConsumedItem }
      | { date: string; rank: 0; tie: string; src: "invoicePayment"; payment: StatementInvoicePaymentInput }
      | { date: string; rank: 4; tie: string; src: "payment"; payment: StatementPaymentInput };

    // THE SORT KEY FOR A TIMED MONEY ROW. Two ISO-8601 strings from one column
    // compare correctly as text, but these two reach this module through
    // different readers and different queries — so the instant is normalised
    // before it is compared. "+00:00" and "Z" on the same moment are different
    // strings, and comparing them raw would interleave two rows by their
    // punctuation. The id is appended so the order is TOTAL: two rows written
    // in the same millisecond still have one stable order rather than relying
    // on the input order surviving the sort.
    const moneyTie = (iso: string, id: string): string => {
      const ms = Date.parse(iso);
      return `${Number.isNaN(ms) ? iso : new Date(ms).toISOString()}|${id}`;
    };

    const events: PrepaidEvent[] = [
      ...ledger.map(
        (e): PrepaidEvent => ({
          // DATED BY `entry_date`, ORDERED BY `created_at` — the same split the
          // invoice payments below already use, for the same reason: a top-up
          // keyed in today for money that arrived last week belongs on last
          // week's line, and then sorts after that day's other money rows
          // because it is the last thing we learned about that day. For every
          // writer but the top-up the two agree by construction, so nothing
          // else on the statement moves.
          date: e.entry_date,
          rank: 0,
          tie: moneyTie(e.created_at, e.id),
          src: "ledger",
          entry: e,
        }),
      ),
      ...items.map(
        (it): PrepaidEvent => ({
          // A TRIP IS DATED BY ITS DELIVERY, not by its scheduled trip_date:
          // delivery is the moment the work existed, and delivered_at is the
          // column that says so. The fallback cannot fire — consumingItems()
          // has already dropped every trip whose delivered_at is null — and is
          // written only so the expression is total. A charge has no delivery,
          // so its own resolved date stands.
          date: it.kind === "trip" ? (it.delivered_at ?? it.trip_date).slice(0, 10) : it.trip_date,
          rank: it.kind === "trip" ? 1 : 2,
          tie: it.id,
          src: "item",
          item: it,
        }),
      ),
      // EVERY payment row, including the ones on an invoice that is still
      // confirmed. That is the whole correction: an instalment is an event on
      // the account the day it arrives, not the day the last instalment
      // happens to close the invoice out.
      ...invoicePayments.map(
        (p): PrepaidEvent => ({
          date: invoicePaymentDateOf(p),
          rank: 0,
          // THE ROW IS DATED BY `paid_on` AND ORDERED BY `created_at`, and the
          // two can disagree: a transfer keyed in today for money that moved
          // last week belongs on last week's date. It then sorts after that
          // day's other money rows, which is both deterministic and honest —
          // it is the last thing we learned about that day.
          tie: moneyTie(p.created_at, p.id),
          src: "invoicePayment",
          payment: p,
        }),
      ),
      ...allPayments.map(
        (p): PrepaidEvent => ({ date: paymentDateOf(p), rank: 4, tie: p.id, src: "payment", payment: p }),
      ),
    ].sort((a, b) =>
      a.date !== b.date
        ? a.date < b.date
          ? -1
          : 1
        : a.rank !== b.rank
          ? a.rank - b.rank
          : a.tie < b.tie
            ? -1
            : a.tie > b.tie
              ? 1
              : 0,
    );

    // THE RUNNING COLUMN IS AVAILABLE (Turki's ruling), not the ledger balance.
    //
    // Available is what the customer can actually spend:
    //
    //     Available = Balance − Uninvoiced − confirmed-unsettled remainder
    //
    // and v_customer_available computes it that way. This walk states the same
    // arithmetic event by event, so the closing figure equals available_sar to
    // the halala — pinned on fixtures by the parity check and against live rows
    // by scripts/db/ledger-check.ts.
    //
    // WHY A DELIVERED TRIP NOW MOVES IT, when under the old law it did not.
    // The column used to be Balance, which a trip genuinely does not touch —
    // work is performed, money moves later. But a delivered trip DOES reduce
    // Available the moment it happens, because it enters Uninvoiced; and when
    // it is later invoiced and settled it leaves Uninvoiced and reduces Balance
    // by the same figure. One deduction, at delivery, covers every stage.
    //
    // WHY A BALANCE DRAW DOES NOT. `balance_applied` and `invoice_draw` lower
    // Balance by X and lower the invoice's unsettled remainder by X at the same
    // instant, so Available is unmoved: (B−X) − U − (S−X) = B − U − S. A
    // `draw_reversal` unwinds both halves for the same reason. The Amount cell
    // still prints the figure — money really moved — but the column holds, and
    // that is the arithmetic, not a display convention.
    //
    // WHY A SHORTFALL PAYMENT RAISES IT. Cash settles part of a confirmed
    // invoice without touching Balance, so the unsettled remainder falls and
    // Available rises by the amount paid.
    //
    // LEGACY-INVOICE WORK IS EXCLUDED. A trip or charge on a confirmed or paid
    // invoice with a null payable sits in NEITHER term of the view — not
    // Uninvoiced, not confirmed-unsettled — and its money is already inside the
    // 0203 seeded opening balance. Deducting it here would take it off twice.
    //
    // FULL, UNFILTERED walk: the column must show true cumulative history even
    // when the visible rows are period-filtered, which is why the filter is
    // applied after it.
    const availableDelta = (ev: PrepaidEvent): number => {
      if (ev.src === "ledger") {
        const e = ev.entry;
        // A draw, its reversal and 0203's confirm-time draw all move Balance
        // and the reservation together. See above.
        return e.entry_type === "invoice_draw" ||
          e.entry_type === "balance_applied" ||
          e.entry_type === "draw_reversal"
          ? 0
          : e.amount_sar;
      }
      if (ev.src === "item") {
        const it = ev.item;
        const legacy =
          it.kind === "trip" ? (tripMetaById.get(it.id)?.legacyInvoice ?? false) : legacyChargeIds.has(it.id);
        // consumedAmount IS the view's own per-item expression —
        // round2(rate × (1 + vat_rate)) with the same rate fallback — so the
        // walk and v_customer_uninvoiced cannot round differently.
        return legacy ? 0 : -it.consumedAmount;
      }
      // Cash or transfer against an invoice: the remainder falls, Balance does
      // not, so Available rises.
      if (ev.src === "invoicePayment") return ev.payment.amount_sar;
      // A LEGACY whole-paid invoice is outside both terms entirely.
      return 0;
    };

    let run = 0;
    const walked = events.map((ev) => {
      const delta = availableDelta(ev);
      run = round2(run + delta);
      return { ev, running: run, delta };
    });
    const visible = walked.filter(({ ev }) => inPeriod(ev.date));

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
    //   money in  (topup)                    -> "topup"      (green)
    //   money back to customer (refund)      -> "return"     (amber)
    //   an invoice settled from the balance
    //            (balance_applied)           -> "settlement" (green)
    //   money drawn at confirm (invoice_draw)-> "charge"      (muted)
    //   money restored (draw_reversal)       -> "payment"     (green)
    //   correction                           -> by its sign
    //
    // COLOUR FOLLOWS THE LABEL. `balance_applied` reads "Invoice paid", and a
    // settled invoice is the thing management scans a long statement for — the
    // same reason the cash and transfer rows beside it are tinted. Leaving it
    // in the muted charge ink meant two rows saying "Invoice paid" rendered
    // differently, one grey and one green, on one table.
    //
    // `invoice_draw` STAYS MUTED, and the pair is deliberate: it reads
    // "Invoice draw", which is what it is — the 0203 law's debit at confirm,
    // taken before anything was settled and reversible by a void. Tinting it
    // would promise a settlement the row does not claim.
    const kindOf = (e: StatementLedgerEntry): StatementRow["kind"] =>
      e.entry_type === "topup"
        ? "topup"
        : e.entry_type === "refund"
          ? "return"
          : e.entry_type === "balance_applied"
            ? "settlement"
            : e.entry_type === "draw_reversal"
              ? "payment"
              : e.entry_type === "correction"
                ? e.amount_sar > 0
                  ? "payment"
                  : "charge"
                : "charge";

    // A BALANCE DRAW IS THE INVOICE BEING PAID, and the statement says so in
    // those words (Turki's ruling). It used to read "Balance applied", which
    // names the MECHANISM — true, and not what the customer is looking for:
    // on a statement the event is that an invoice got settled, and the
    // mechanism belongs in the Method column beside it, which now carries it.
    //
    // "Balance applied" survives where it is still the right words — the
    // ledger drill-in (app/trips/CustomerLedgerModal.tsx), which lists ledger
    // rows AS ledger rows and has no invoice-centred reading to offer.
    const typeKeyOf = (e: StatementLedgerEntry): TKey =>
      e.entry_type === "topup"
        ? "trips.finance.addBalance"
        : e.entry_type === "refund"
          ? "trips.statement.typeReturn"
          : e.entry_type === "invoice_draw"
            ? "trips.statement.typeInvoiceDraw"
            : e.entry_type === "balance_applied"
              ? "trips.statement.typeInvoicePayment"
              : e.entry_type === "draw_reversal"
                ? "trips.statement.typeDrawReversal"
                : "trips.statement.typeCorrection";

    const rows: StatementRow[] = visible.map(({ ev, running, delta }) => {
      // The running-balance cell, identical on every row — a MOVING row shows
      // the figure it produced, a record-only row shows the figure it left
      // alone. One expression, so the two can never diverge in format.
      const runCell: StatementCell = {
        kind: "num",
        value: running,
        sign: "none",
        split: null,
        negative: running < 0,
      };

      if (ev.src === "ledger") {
        const e = ev.entry;
        // REF — the row's own document number (RCT-… / CN-…), or the invoice
        // it is linked to. A correction has neither, deliberately: its paper
        // trail is the corrections table, not a numbered document.
        const refCell: StatementCell = e.doc_number
          ? { kind: "text", value: e.doc_number }
          : e.invoice_number
            ? { kind: "text", value: e.invoice_number }
            : EMPTY;

        // METHOD — only rows where money physically changed hands carry one,
        // PLUS the balance draw, whose Type says the invoice was PAID and so
        // has to say what paid it.
        //
        // ITS METHOD IS NOT IN THE `method` COLUMN, and cannot be:
        // apply_balance_to_invoice() writes customer_id, entry_type, amount,
        // invoice_id, note and created_by, and nothing else (0204), so the
        // column is null on every one of these rows. It is null because the
        // route IS the balance — there was no cash and no bank to name. That
        // makes the label a property of the ENTRY TYPE rather than of the
        // row's data, which is why it is decided here instead of read.
        //
        // Same leaf the legacy flow prints for the same act (`payment_method`
        // = 'balance' on a pre-0203 invoice), so one column cannot end up
        // using two words for one thing as the old invoices age out.
        //
        // `invoice_draw` IS DELIBERATELY NOT INCLUDED, though it is the same
        // act under the 0203 law. Its Type already reads "Invoice draw" — a
        // draw is from the balance by definition, so the caption would repeat
        // what the row has already said. It is not free repetition either:
        // this label is a two-line bilingual cell in a narrow column, and a
        // 0203-era statement is mostly draw rows. The page proof measured it
        // at two extra A4 pages on a 140-draw statement, paid for a word the
        // reader already had. `draw_reversal` is out for a different reason —
        // it is an undo, not a payment, and a payment method beside it would
        // read as a second draw.
        const methodCell: StatementCell =
          e.entry_type === "balance_applied"
            ? {
                kind: "bi",
                value: {
                  en: paymentMethodLabel("balance", "en"),
                  ar: paymentMethodLabel("balance", "ar"),
                },
              }
            : e.method
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
        // the magnitude and the sign glyph restates the direction. No VAT
        // split anywhere: a ledger row is a money movement, not a taxable
        // supply — the tax lives on the invoice the draw points at.
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
          // RECORD-ONLY NOW MEANS "DID NOT MOVE AVAILABLE", which on a ledger
          // row is true of exactly the three that move Balance and the
          // reservation together — a draw, 0203's confirm-time draw, and a
          // reversal. Derived from the walk's own delta so the flag and the
          // column can never disagree about the same row.
          recordOnly: delta === 0,
          cells: [
            { kind: "date", value: ev.date },
            { kind: "bi", value: bi(typeKeyOf(e)) },
            refCell,
            methodCell,
            noteCell,
            amountCell,
            runCell,
          ],
        };
      }

      // DELIVERED TRIP or SPECIAL CHARGE — work performed, priced by
      // consumingItems(), recorded without moving the balance.
      //
      // THE SIGN IS "none", AND THAT IS THE POINT. A "−" beside a figure on
      // this table means money left the account, and it did not: the balance
      // beside this row is the same one above it. Signing a delivered trip as
      // a debit is precisely the pre-0203 reading the rebuild removed.
      if (ev.src === "item") {
        const it = ev.item;
        const isTrip = it.kind === "trip";
        return {
          key: `${it.kind}-${it.id}`,
          kind: isTrip ? ("trip" as const) : ("charge" as const),
          ...(isTrip
            ? { tone: (tripMetaById.get(it.id)?.invoiceLocked ? "paid" : "unpaid") as "paid" | "unpaid" }
            : {}),
          recordOnly: delta === 0,
          cells: [
            { kind: "date", value: ev.date },
            {
              kind: "bi",
              // A DELIVERED TRIP SAYS WHETHER IT IS PAID (Turki's ruling).
              // Paid = on an invoice whose status is 'paid', which is
              // tripMetaById's `invoiceLocked` — already computed in
              // app/trips/page.tsx and already the flag the Settled-Balance
              // filter trusts. Everything else delivered is unpaid: no
              // invoice, a draft one, or a confirmed one still outstanding.
              //
              // STEM AND QUALIFIER ARE JOINED HERE, once, and the halves are
              // carried alongside so the screen can ink the qualifier alone.
              // Whoever renders `value` gets the whole label either way.
              //
              // Charges are untouched — a charge is raised, not delivered,
              // and has no paid/unpaid reading of its own.
              ...(isTrip
                ? (() => {
                    const stem = bi("trips.statement.typeDeliveryStem");
                    const tail = bi(
                      tripMetaById.get(it.id)?.invoiceLocked
                        ? "trips.statement.typePaidTail"
                        : "trips.statement.typeUnpaidTail",
                    );
                    return {
                      value: { en: `${stem.en} ${tail.en}`, ar: `${stem.ar} ${tail.ar}` },
                      inkSplit: { stem, tail },
                    };
                  })()
                : { value: bi("trips.statement.typeCharge") }),
            },
            // Ref is the trip's own reference, through formatTripRef so the
            // "No ref" wording matches every other surface. A charge has none.
            isTrip ? { kind: "tripRef", value: formatTripRef(it.ref), tripId: it.id } : EMPTY,
            // No money changed hands, so no method — the same rule the ledger
            // rows follow.
            EMPTY,
            // Note carries what the row IS beyond its type: the water
            // delivered, or the charge's own label.
            isTrip ? waterTypeCell(it.water_type) : it.label ? { kind: "text", value: it.label } : EMPTY,
            // VAT-INCLUSIVE, and deliberately not split. The tax on this work
            // is stated on the invoice that bills it; a statement showing a
            // net/VAT breakdown per row would be a second, unreconciled
            // rendering of the same tax.
            { kind: "num", value: it.consumedAmount, sign: "none", split: null, negative: false },
            runCell,
          ],
        };
      }

      // A SHORTFALL PAYMENT — one `invoice_payments` row: cash or a transfer
      // arriving for an invoice the balance could not cover, which since 0204
      // is normally one instalment of several. Money arriving FOR an invoice
      // rather than INTO the balance: recorded, never deducted, which is
      // exactly why `recordOnly` is true and the running balance holds flat
      // across it. `runCell` carries the figure forward unchanged, so two
      // partial payments on one invoice can never move the closing balance
      // away from the headline the view publishes.
      //
      // IT IS NOT "INVOICE PAID", and the distinction is the customer's, not
      // ours (Turki's ruling). This money settles what the balance left over;
      // the invoice being paid is the balance draw above it, which now carries
      // that label. Calling both rows the same thing told a customer reading
      // one settlement that two invoices had been paid.
      //
      // The METHOD is the payment's own and always a real one — cash or bank
      // transfer, the only two record_invoice_payment() accepts (a balance
      // route goes through the other door entirely). The null arm below is
      // defensive, not a case the RPC can produce.
      //
      // The AMOUNT is the payment's own, not the invoice's total — the
      // distinction this row exists to make.
      if (ev.src === "invoicePayment") {
        const ip = ev.payment;
        return {
          key: `invoice-payment-${ip.id}`,
          kind: "settlement" as const,
          recordOnly: delta === 0,
          cells: [
            { kind: "date", value: ev.date },
            { kind: "bi", value: bi("trips.statement.typeShortfallPayment") },
            // REF is the invoice this money settled — the document the
            // customer is reconciling against. Its own payment id is
            // machinery and appears nowhere.
            { kind: "text", value: ip.invoice_number },
            ip.method
              ? {
                  kind: "bi",
                  value: {
                    en: paymentMethodLabel(ip.method, "en"),
                    ar: paymentMethodLabel(ip.method, "ar"),
                  },
                }
              : EMPTY,
            // NOTE — the payment's note, else its bank reference, else blank.
            // Same precedence as a ledger row's, so the two kinds of money
            // movement read identically down the column.
            ip.note
              ? { kind: "text", value: ip.note }
              : ip.reference
                ? { kind: "text", value: ip.reference }
                : EMPTY,
            { kind: "num", value: ip.amount_sar, sign: "none", split: null, negative: false },
            runCell,
          ],
        };
      }

      // A LEGACY PAID INVOICE — pre-0203, settled on the invoice row itself
      // with no payment history to itemise, so the whole document is the
      // event and its grand total is the amount. Record-only for the same
      // reason as above.
      const p = ev.payment;
      return {
        key: `payment-${p.id}`,
        kind: "settlement" as const,
        recordOnly: delta === 0,
        cells: [
          { kind: "date", value: ev.date },
          { kind: "bi", value: bi("trips.statement.typeInvoicePayment") },
          { kind: "text", value: p.invoice_number },
          p.payment_method
            ? {
                kind: "bi",
                value: {
                  en: paymentMethodLabel(p.payment_method, "en"),
                  ar: paymentMethodLabel(p.payment_method, "ar"),
                },
              }
            : EMPTY,
          p.payment_reference ? { kind: "text", value: p.payment_reference } : EMPTY,
          { kind: "num", value: p.grand_total_sar, sign: "none", split: null, negative: false },
          runCell,
        ],
      };
    });

    return {
      ...common,
      // Always present on prepaid, including on an empty statement: it
      // explains the Running Balance COLUMN, which is there whether or not a
      // row is. Suppressing it on the empty case would mean the reader who
      // most needs the convention explained — someone opening an unfamiliar
      // account — is the one reader who does not get it.
      balanceNote: bi("trips.statement.balanceNote"),
      headline: {
        // THE VIEW'S FIGURE, passed through — v_customer_available.
        // available_sar. The walk above reaches the same number by stating its
        // arithmetic row by row, and the parity check and the DB harness both
        // pin that; the VIEW remains the authority, and this is it.
        label: bi("trips.finance.colAvailable"),
        value: input.available,
        negative: input.available < 0,
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
  // 0204 applies to BOTH modes — confirm freezes a payable and moves no money
  // on a postpaid invoice either, so a postpaid customer pays in instalments
  // exactly as a prepaid one does. Reading whole paid invoices here understated
  // a postpaid account for the same reason and by the same amount.
  const invoicePaymentRows = invoicePayments.filter((p) => inPeriod(invoicePaymentDateOf(p)));

  // Merge trip + payment rows chronologically — payments render like any other
  // statement row, oldest first. Equal dates keep INSERTION order (the
  // comparator returns 0 and Array.prototype.sort is stable), which is why the
  // three groups are concatenated in the order they are: a same-day trip still
  // precedes the money that settled it, and the legacy whole-invoice row still
  // sits where it always sat, after the itemised payments.
  const merged: (
    | { kind: "trip"; date: string; row: ConsumedItem }
    | { kind: "invoicePayment"; date: string; row: StatementInvoicePaymentInput }
    | { kind: "payment"; date: string; row: StatementPaymentInput }
  )[] = [
    ...postpaidTrips.map((tr) => ({ kind: "trip" as const, date: tr.trip_date, row: tr })),
    ...invoicePaymentRows.map((p) => ({
      kind: "invoicePayment" as const,
      date: invoicePaymentDateOf(p),
      row: p,
    })),
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
        // Postpaid has no held balance and no running-balance column, so no
        // row on it can move or fail to move one. False throughout.
        recordOnly: false,
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
    // The REFERENCE column. bank_transfer is the only method that carries one
    // (0039 requires it, and 0204 made it a condition inside the RPC), so it
    // shows the reference; every other method names itself from the shared
    // label map instead. Reading the branch the other way round is what made
    // 0134's 'balance' render as a bare em dash. One expression, applied to
    // both payment shapes — they differ only in which columns hold the pair.
    const paymentRefCell = (method: InvoicePaymentMethod | null, reference: string | null): StatementCell =>
      method === "bank_transfer"
        ? reference
          ? { kind: "text", value: reference }
          : EMPTY
        : method
          ? {
              kind: "bi",
              value: { en: paymentMethodLabel(method, "en"), ar: paymentMethodLabel(method, "ar") },
            }
          : EMPTY;

    if (r.kind === "invoicePayment") {
      const ip = r.row;
      return {
        key: `invoice-payment-${ip.id}`,
        kind: "payment" as const,
        recordOnly: false,
        cells: [
          { kind: "date", value: r.date },
          paymentRefCell(ip.method, ip.reference),
          { kind: "bi", value: bi("trips.statement.typePayment") },
          EMPTY,
          EMPTY,
          EMPTY,
          EMPTY,
          // THE PAYMENT'S OWN AMOUNT, not the invoice's total. A credit, so
          // it keeps the "plus" the postpaid arm has always given a payment.
          { kind: "num", value: ip.amount_sar, sign: "plus", split: null, negative: false },
        ],
      };
    }

    const p = r.row;
    const refCell = paymentRefCell(p.payment_method, p.payment_reference);
    return {
      key: `payment-${p.id}`,
      kind: "payment" as const,
      recordOnly: false,
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
    // No held balance, no running-balance column, nothing to explain.
    balanceNote: null,
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
