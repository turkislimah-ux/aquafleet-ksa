// SHARED INVOICE VIEW-MODEL — the one place that decides WHAT an invoice
// document says, in WHAT order, grouped WHICH way, and in WHICH words.
//
// Why this file exists
// -------------------
// The downloadable PDF used to be a second, independent implementation of the
// invoice sheet: it hardcoded ~24 EN/AR label pairs of its own, printed one row
// per trip where the popup printed grouped rows, and carried its own 3–4 column
// tables against the popup's 6. Every one of those is a silent divergence
// between what an operator approves on screen and what a customer receives.
//
// The rule this file enforces is:
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING
//   may not.
//
// So: no customer-facing string is written in a renderer. Every label below is
// resolved through `t()` from lib/i18n.ts using the SAME KEY the popup passes,
// and every trip row comes out of `groupInvoiceLines()` — the SAME function
// InvoiceDetailModal's LineTable/PrepaidTripTable call. A wording change lands
// on both surfaces at once, or it lands on neither.
//
// Bilingual, because a document is not a screen
// ---------------------------------------------
// The popup renders in ONE language (the operator's). A tax invoice renders in
// BOTH. That is the one structural difference, and it is why every label here
// is a `BiLabel` — `{ en: t(key,"en"), ar: t(key,"ar") }` — rather than a
// pre-resolved string. Both halves come from the same dictionary entry, so
// neither language can drift from the other or from the screen.
//
// NUMBERS ARE RAW, NOT FORMATTED. Each renderer formats for its own medium:
// the screen shows whole riyals (`formatSar`), a tax invoice shows 2 decimals.
// Freezing a format here would silently change one of the two surfaces.
//
// Purity: no React, no fs, no Supabase, no `process`. Importable from a server
// action, a client component, or a test script alike.

import { formatIban, visibleBankAccounts } from "./bankAccounts";
import { type InvoiceStatus, type InvoicePaymentMethod, type WaterType } from "./db-types";
import { invoiceStatusLabel, paymentMethodLabel, waterTypeLabel } from "./enum-labels";
import { fill, t, type TKey } from "./i18n";
import { groupInvoiceLines, type GroupedRow } from "./invoiceDisplay";
import { round2 } from "./vat";

// ---------------------------------------------------------------------------
// Input shapes — the normalized invoice payload
// ---------------------------------------------------------------------------
// These used to live in lib/invoicePdfTemplate.ts. They moved here because the
// view-model is now upstream of the renderer: the renderer imports the vm, so
// the vm cannot import the renderer. The `Pdf*` names are kept as-is so the one
// caller (app/trips/invoiceActions.ts) needs no rename, and the template
// re-exports them for anything still importing from there.

export type PdfLine = {
  id: string;
  kind: "trip" | "charge";
  trip_date: string | null;
  description: string;
  amount_sar: number;
  vat_sar: number;
  // Display-only passengers — structurally identical to lib/invoice.ts's
  // InvoiceLine and lib/db-types.ts's InvoiceLineSnapshot, which is what lets
  // both the live assembly and the frozen jsonb assign to this type unchanged.
  // WIDENED for this build: the download prints the same six columns as the
  // popup, and quantity/price/water type/ref are exactly what it was missing.
  ref?: string | null;
  water_type?: WaterType | null;
  quantity?: number | null;
  price_sar?: number | null;
  // v3, prepaid charge lines only — undefined for trip lines / postpaid.
  covered?: boolean;
};

export type PdfTotals = { subtotal: number; vat: number; total: number };

/**
 * The VAT-inclusive foot of the two prepaid trips tables. Mirrors the engine's
 * `InvoiceTripTableTotals` (lib/invoice.ts) so a live assembly and a frozen row
 * assign to it unchanged.
 *
 * A nullable `balance`/`remaining` pair stood here, mirroring a per-invoice
 * chained running balance. Both are gone from every surface — see
 * InvoiceTripTableTotals for why. With them went the whole pre-0036 "—" special
 * case: the only figure left is a subtotal, and a subtotal is derivable on
 * EVERY frozen row, including the legacy ones. Nothing on this document can
 * print a dash where a number belongs any more, because nothing on it depends
 * on a column that might not exist.
 */
export type PdfTripTotals = { covered: number; unpaid: number };

/**
 * ONE THING THAT SETTLED THIS INVOICE — a payment received, or a draw against
 * the customer's prepaid balance. Two sources, one shape, because the customer
 * reading the document cares in what order money arrived and by what route, not
 * which table it landed in.
 *
 *   "payment" — an `invoice_payments` row. `method` is always set; `reference`
 *               and `date` are mandatory for a bank transfer and optional for
 *               cash, which is exactly why they are nullable here.
 *   "applied" — a `customer_ledger` row with `entry_type = 'balance_applied'`.
 *               It has no method and no reference: the route IS the balance.
 *
 * `amount` is POSITIVE in both arms — see `PdfInvoiceData.settlementEvents`.
 */
export type PdfSettlementEvent = {
  kind: "payment" | "applied";
  method: InvoicePaymentMethod | null;
  date: string | null; // yyyy-mm-dd
  reference: string | null;
  amount: number;
};

/**
 * THE BALANCE DRAW BEHIND A LEDGER-ERA INVOICE, as the document reports it.
 *
 * Built by the caller from `customer_ledger` (app/trips/invoiceActions.ts's
 * loadLedgerDraw): the LAST `balance_applied` row for this invoice, plus the
 * customer's running balance immediately before and after it. `drawSar` is
 * POSITIVE — the ledger stores a draw negative, and no renderer should have to
 * know that to see that `balanceBefore − drawSar === balanceAfter`.
 *
 * Three states, because there are three different things a document can
 * truthfully say. A union rather than nullable numbers so none of them can be
 * rendered as another — see `PdfInvoiceData.ledgerDraw`.
 */
export type InvoiceLedgerDraw =
  | { state: "drawn"; balanceBefore: number; drawSar: number; balanceAfter: number }
  | { state: "none" }
  | { state: "unreadable" };

/**
 * THE DRAW BEHIND A LEDGER-ERA INVOICE, walked out of the customer's ledger.
 *
 * PURE, and exported so a harness can run it over real rows — the reason it
 * does not live in app/trips/invoiceActions.ts, which is a `"use server"`
 * module and may export only async functions. The document path and the popup
 * both call it, so the two cannot report different balances for one instant;
 * that divergence is why 0036's frozen pair was dropped (see 0205).
 *
 * WHICH ROW IS THE DRAW — and it is two entry types, not one:
 *
 *   invoice_draw     0203's deduction, taken AT CONFIRM.
 *   balance_applied  0204's deduction, taken when Mark Paid runs.
 *
 * Both mean "the balance paid this much of this invoice"; which one exists
 * depends only on when the invoice was confirmed. Matching `balance_applied`
 * alone printed an em-dash on every invoice confirmed between 0203 and 0204 —
 * on prod that is 026-000022, -024 and -026, all of them paid, all of them
 * showing a dash where a real deduction had happened.
 *
 * A REVERSED DRAW IS NOT A DRAW. Voiding an invoice writes a `draw_reversal`
 * pointing at the row it undoes (`reversal_of`), and the money came back. The
 * reversed row is skipped, so a voided-then-reissued invoice reports the draw
 * that stands rather than the one that was given back.
 *
 * THE LAST SURVIVING DRAW WINS. apply_balance_to_invoice can run more than
 * once against one invoice — a partial draw, a top-up, then the rest — and
 * what the document reports is where the settlement finally left the balance.
 *
 * Cash and transfer payments are not consulted. They settle through
 * `invoice_payments` and never touch the held balance (0204's two doors are
 * disjoint), so a shortfall paid in cash leaves both figures where the draw
 * put them.
 *
 * `rows` must be the customer's WHOLE ledger in the statement's own total
 * order — created_at then id — because Balance is a running total up to the
 * draw, and any other tie-break would let one surface disagree with another on
 * a day when two rows share a timestamp.
 */
export function ledgerDrawFrom(
  rows: readonly {
    id: string;
    amount_sar: number;
    entry_type: string;
    invoice_id: string | null;
    reversal_of: string | null;
  }[],
  invoiceId: string,
): InvoiceLedgerDraw {
  const reversed = new Set(
    rows.filter((r) => r.entry_type === "draw_reversal" && r.reversal_of).map((r) => r.reversal_of as string),
  );
  let last = -1;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const isDraw = r.entry_type === "invoice_draw" || r.entry_type === "balance_applied";
    if (r.invoice_id === invoiceId && isDraw && !reversed.has(r.id)) last = i;
  }
  // No surviving draw is the ORDINARY state of a confirmed invoice under 0204,
  // not a failure: confirm moves no money, so until Mark Paid runs there is
  // nothing to report and the document prints an em-dash.
  if (last < 0) return { state: "none" };

  let balanceAfter = 0;
  for (let i = 0; i <= last; i += 1) balanceAfter = round2(balanceAfter + rows[i].amount_sar);
  // The ledger stores a draw NEGATIVE, because that is what it does to the
  // balance. The document states it positive and says so in the caption, so
  // `balanceBefore − drawSar === balanceAfter` reads as the subtraction it is.
  const drawSar = round2(Math.abs(rows[last].amount_sar));
  return { state: "drawn", balanceBefore: round2(balanceAfter + drawSar), drawSar, balanceAfter };
}

export type PdfIdentity = {
  name: string | null; // legal_name (seller) or name (buyer)
  name_ar?: string | null; // company name (Arabic) — populated for BOTH parties
                           // (seller from legal_name_ar, buyer from name_ar)
  vat_number: string | null;
  cr_number: string | null;
  address: string | null; // address (seller) or billing_address (buyer)
  description?: string | null; // seller only
  telephone?: string | null; // seller only — landline
  phone?: string | null; // seller only — mobile
} | null;

// Normalized invoice data — the SAME shape whether it came from a live
// assembly (draft/review, via previewInvoice) or a frozen snapshot
// (confirmed/paid/void, via getInvoice). The caller does the snapshot-vs-live
// branch; nothing downstream of here knows which it got.
export type PdfInvoiceData = {
  /**
   * WHICH LAW THIS DOCUMENT WAS BUILT UNDER. Decided by the CALLER
   * (`toPdfInvoiceData`), never inferred here, and never from `status`:
   *
   *   "ledger" — 0203 onward. One trips table, no per-line coverage verdict,
   *              and the prepaid draw reported as the frozen
   *              `prepaidAppliedSar` / `amountPayableSar` pair below.
   *   "legacy" — confirmed BEFORE 0203, with `amount_payable_sar` null. Renders
   *              exactly as it was issued: Covered/Unpaid tables, coverage
   *              pills, the paid-up balance foot. Freeze law 0027 — an issued
   *              document is read verbatim, never re-derived under a law that
   *              did not exist when it was signed.
   *
   * A STATUS TEST WOULD BE WRONG TWICE OVER. Draft and review rows carry no
   * frozen payable at all yet are assembled by today's engine, so they are
   * "ledger"; and a paid invoice can be either era depending on when it was
   * confirmed. Only the caller, holding the row, can tell.
   */
  era: "ledger" | "legacy";
  status: InvoiceStatus;
  paymentMode: "prepaid" | "postpaid";
  invoiceNumber: string | null;
  periodStart: string;
  periodEnd: string;
  issueDate: string | null; // confirmed_at; null for draft/review
  seller: PdfIdentity;
  buyer: PdfIdentity;
  buyerEmail: string | null;
  coveredLines: PdfLine[]; // trips only
  unpaidLines: PdfLine[]; // prepaid: trips only. postpaid: trips + charges
  chargeLines: PdfLine[]; // prepaid only; always [] for postpaid
  covered: PdfTotals;
  amountDue: PdfTotals;
  grand: PdfTotals;
  tripTotals?: PdfTripTotals;
  /**
   * PAID-UP BALANCE, in riyals — deposits − paid-invoice consumption − returns.
   * `null` means "print nothing": postpaid always, since a postpaid customer has
   * no pool to be paid up against.
   *
   * COMPUTED BY THE CALLER, ONCE, through lib/prepaid.ts's `paidUpBalance` —
   * never here and never in a renderer. Which figure it is depends on the
   * invoice's own status, and that decision belongs with the code that can read
   * `paid_at` off the row (app/trips/invoiceActions.ts's `loadPaidUpBalance`):
   *
   *   draft / review / confirmed  →  CURRENT. Nothing about them is settled, so
   *                                  the number moves as invoices get paid.
   *   paid                        →  FROZEN at this invoice's `paid_at`.
   *   void                        →  FROZEN at this invoice's `voided_at`.
   *
   * The VM's job is to LABEL it and hand it to every surface as one value, so
   * the popup, the download and the printout cannot disagree.
   */
  paidUpBalanceSar: number | null;
  /**
   * THE FROZEN DRAW — `invoices.prepaid_applied_sar`, in riyals. What
   * confirm_invoice() took off the customer's Available balance at the moment
   * this invoice was confirmed: `min(max(Available, 0), grand_total)`.
   *
   * `null` on a draft or review row (nothing is drawn until confirm) and on
   * every LEGACY row (the column did not exist). 0 is a real answer and means
   * the customer had nothing available — it is NOT the same as null and must
   * not be collapsed into one.
   *
   * NOT COMPUTED ANYWHERE APP-SIDE, here least of all. The balance moves
   * between a page load and a confirm; only the RPC, holding the row lock, can
   * say what was actually taken.
   */
  prepaidAppliedSar: number | null;
  /**
   * THE FROZEN REMAINDER — `invoices.amount_payable_sar`, in riyals.
   * `grand_total − prepaid_applied` at confirm. Non-null on EVERY ledger-era
   * confirmed invoice of either mode: the postpaid arm of confirm_invoice()
   * writes `applied = 0, payable = grand_total`, which is what lets a postpaid
   * invoice take partial payments through the same path.
   *
   * `null` means "not settled through the ledger" — a draft, or a legacy row.
   * Both renderers and the settlement panel test THIS, not the status.
   */
  amountPayableSar: number | null;
  /**
   * THIS INVOICE'S BALANCE DRAW, and the customer's ledger balance either side
   * of it. Feeds the Balance / Remaining pair under the ledger-era Trips
   * subtotal and nothing else.
   *
   * WHAT IT REPLACED, and why the shape changed. The pair used to be
   * `ledgerBalanceSar` — the customer's balance RIGHT NOW — with Remaining
   * derived as `balance − this table's subtotal`. Two things were wrong with
   * that on an issued document: the figure moved every time the customer did
   * anything (a document is not a live dashboard), and the subtraction was
   * invented by the renderer rather than describing money that actually moved.
   * Before that, 0036 froze a FIFO walk at confirm; 0205 dropped those columns.
   *
   * Now both figures come from the `balance_applied` ledger rows for this
   * invoice — the rows that MOVED the money — so Balance − draw = Remaining is
   * an identity about real events, not a rendering. With several draws it is
   * the LAST one: that is where the invoice's settlement left the balance.
   *
   * Cash and transfer payments never appear here. They settle the invoice
   * without touching the held balance (0204's two doors are disjoint), so a
   * shortfall paid in cash leaves these two figures exactly where the draw did.
   *
   * THREE STATES, ALL DIFFERENT, none collapsible into a number:
   *   "drawn"      — a draw happened; print both figures.
   *   "none"       — no draw yet, which is the ordinary state of a confirmed
   *                  invoice under 0204. Both rows print an em-dash, because
   *                  there is no moment to report, not a zero to report.
   *   "unreadable" — the ledger could not be read. Words, never a figure.
   *
   * OPTIONAL, like `tripTotals` beside it, so a caller that never reads the
   * ledger (the flow and page-proof harnesses) stays valid. Absent is treated
   * as "unreadable" — the conservative arm, which states a doubt rather than
   * inventing a fact.
   */
  ledgerDraw?: InvoiceLedgerDraw;
  /**
   * SETTLEMENT ACTIVITY on this invoice, oldest first: every recorded payment
   * (`invoice_payments`) and every balance draw (`customer_ledger` rows with
   * `entry_type = 'balance_applied'`), already merged and sorted by the caller.
   *
   * `[]` means "no activity", which is a real and common answer on a freshly
   * confirmed invoice; the section simply does not print. Amounts are POSITIVE
   * here — each one is money that settled the invoice — and the ledger's own
   * negative sign is stripped at assembly, because a list of settlements is not
   * a list of ledger movements and printing a minus in it reads as a reversal.
   *
   * OPTIONAL for the same reason as `ledgerBalanceSar`; absent means `[]`.
   */
  settlementEvents?: PdfSettlementEvent[];
  /**
   * WHAT IS STILL OUTSTANDING — `v_invoice_settlement.remainder_sar`. The
   * closing figure of the settlement section, so the reader is never left to
   * subtract a column of their own. `null` alongside `amountPayableSar`: a
   * draft has nothing to settle, a legacy row settles under the old flow. With
   * no remainder to close on there is no section, even if events exist.
   */
  settlementRemainderSar?: number | null;
  /**
   * RAW jsonb off the seller row — `company_settings.bank_accounts` for a
   * draft, `seller_snapshot.bank_accounts` for an issued invoice. `unknown`
   * because migration 0184's CHECK guarantees an array of at most 3 and
   * nothing about what is IN it; `buildBankBlock` below is the only thing that
   * looks inside. See lib/bankAccounts.ts.
   */
  bankAccounts: unknown;
  hideAmountDue: boolean;
  paymentMethod: InvoicePaymentMethod | null;
  paidAt: string | null;
  voidReason: string | null;
  // The project's CURRENT water_type, used only when a frozen line's own
  // water_type is null (pre-water_type snapshots). Display-only substitution,
  // never written back — same fallback getInvoice() already hands the popup.
  // The download had no equivalent, so an old invoice printed "—" on screen's
  // real label.
  projectWaterType: WaterType | null;
  voidedAt: string | null;
};

// ---------------------------------------------------------------------------
// Output shapes — what a renderer consumes
// ---------------------------------------------------------------------------

/** One dictionary entry, resolved in both languages. See the header. */
export type BiLabel = { en: string; ar: string };

export type VmTripRow = {
  key: string;
  periodLabel: string;
  refRangeLabel: string;
  waterType: BiLabel | null; // null = pre-water_type snapshot, renderer prints "—"
  quantity: number;
  price: number;
  amount: number;
};

export type VmChargeRow = {
  id: string;
  date: string | null;
  description: string;
  quantity: number;
  price: number;
  amount: number;
  covered: boolean;
  statusLabel: BiLabel;
};

/**
 * A trip table's footer. Two shapes, because the two payment modes foot
 * differently and always have:
 *  - "ledger"   (prepaid) — Subtotal / balance / Remaining, three stacked rows
 *  - "subtotal" (postpaid) — one Subtotal row with a faded net+VAT split
 * A HIDDEN ledger-era prepaid document takes neither: hide-from-customer
 * omits its trips section whole, foot and all, so no prepaid table ever
 * prints a foot without its Balance and Remaining rows.
 * `preVat`/`vat` exist on both so the renderer never has to derive money.
 *
 * THE LAYOUT IS THE ORIGINAL ONE; THE BALANCE ROW'S VALUE IS NOT. The three
 * rows used to be fed by a per-invoice CHAINED running balance — the covered
 * table's Remaining seeded the unpaid table's balance — computed from frozen
 * `*_ledger_balance_sar` columns. That mechanism produced a figure the
 * statement, the Finance KPI and the over-balance banner all disagreed with,
 * and it is NOT coming back.
 *
 * WHICH honest figure feeds it depends on the era, which is why the caption
 * travels with it as `balanceLabel` instead of being picked by the renderer:
 *   legacy — the PAID-UP BALANCE (lib/prepaid.ts, via invoiceActions'
 *            `loadPaidUpBalance`), handed in as `paidUpBalanceSar`. As issued.
 *   ledger — the LEDGER BALANCE, `v_customer_available.balance_sar`, handed in
 *            as `ledgerBalanceSar`. The same column the Finance tab reads.
 * They are different numbers on the same customer, so they cannot share a
 * caption: "Paid-up balance" over the ledger figure would be a wrong name on a
 * legal document, the mistake `paidUpBalance`'s own dictionary note records.
 *
 * `balance` is a UNION, not a nullable number, for the same reason it is one
 * upstream: "the read failed" and "the balance is zero" are different content
 * and must not collapse into the same rendering. A renderer prints `amount` or
 * prints `note`; it never decides what a missing figure looks like.
 *
 * `remaining` is `balance − subtotal` for THIS table, and null exactly when the
 * balance is unreadable (nothing to subtract from). NOT chained across tables:
 * every prepaid table carries the same balance figure, never the one above it.
 */
export type VmTableFoot =
  | {
      style: "ledger";
      preVat: number;
      vat: number;
      subtotal: number;
      balanceLabel: BiLabel;
      /**
       * THREE RENDERINGS, and a renderer must not fold two of them together:
       *   { amount } — the figure.
       *   null       — no draw has happened. An em-dash: there is no moment to
       *                report. A 0 here would claim an empty balance.
       *   { note }   — the read failed. WORDS, never a numeral, so it cannot be
       *                skimmed as an amount.
       */
      balance: { amount: number } | { note: BiLabel } | null;
      /** The balance after the draw. null whenever `balance` is not a figure. */
      remaining: number | null;
    }
  | { style: "subtotal"; preVat: number; vat: number; total: number };

export type VmTripSection = {
  kind: "trips";
  title: BiLabel;
  emptyLabel: BiLabel;
  rows: VmTripRow[];
  foot: VmTableFoot;
};

export type VmChargesSection = {
  kind: "charges";
  title: BiLabel;
  rows: VmChargeRow[];
  preVat: number;
  vat: number;
  total: number;
  /**
   * Whether to print the Status column (the Covered / Rolls-forward pill).
   * FALSE on every ledger-era document, in both modes: coverage was a per-line
   * verdict and there is no longer one to print, so the column would carry a
   * pill whose meaning died with 0203.
   *
   * A FLAG RATHER THAN AN ABSENT COLUMN because the renderers' column count is
   * load-bearing — the table foot's `colspan` has to match — so the decision
   * has to arrive as data, once, instead of each renderer inferring it from
   * whether the rows happen to be all-covered. `VmChargeRow.covered` and
   * `.statusLabel` stay populated for the legacy rows that still print them.
   */
  showStatus: boolean;
};

export type VmSection = VmTripSection | VmChargesSection;

export type VmTotalRow = { label: BiLabel; amount: number };

/** One settled amount, already worded. See `VmSettlementDetail`. */
export type VmSettlementDetailRow = {
  key: string;
  /** yyyy-mm-dd, or null when the payment carried no date (cash may not). */
  date: string | null;
  /** "Payment — Bank transfer" / "Balance applied", resolved in both columns. */
  description: BiLabel;
  /** The bank reference. Null on cash and on every balance draw. */
  reference: string | null;
  amount: number;
};

/**
 * HOW THIS INVOICE WAS SETTLED — a dated list of payments and balance draws,
 * closing on what is still outstanding.
 *
 * `null` when there is nothing to say: any era but ledger, any mode but
 * prepaid, an invoice with no settlement activity yet, or a document hidden
 * from the customer. That last one is not an optimisation — this section
 * names trip money the hidden, charges-only document no longer carries
 * anywhere else, so it is the same disclosure the toggle exists to suppress
 * and it goes with the trips section.
 *
 * The ROWS are pre-worded and the REMAINDER is the view's own
 * `remainder_sar` — nothing here subtracts a column to reach it, so a document
 * that lists a partial payment and a partial draw still closes on the figure
 * the database would answer with.
 */
export type VmSettlementDetail = {
  title: BiLabel;
  rows: VmSettlementDetailRow[];
  colDate: BiLabel;
  colDescription: BiLabel;
  colReference: BiLabel;
  colAmount: BiLabel;
  remainderLabel: BiLabel;
  remainder: number;
};

/**
 * One printable account. `ibanDisplay` is pre-grouped (`SA03 8000 …`) because
 * the grouping is a WORDING decision, not a layout one — if each surface split
 * it for itself, the sheet and the PDF would sooner or later group differently
 * and the same number would read as two.
 */
export type VmBankAccount = {
  id: string;
  bankName: string;
  accountName: string;
  ibanDisplay: string;
};

/**
 * The invoice's Transfer Details. `null` when there is nothing to print, so
 * both renderers omit the whole block by testing one value rather than each
 * re-deriving "are there any visible accounts".
 */
export type VmBankBlock = {
  heading: BiLabel;
  /**
   * The ONLY per-field label, and the only one that carries information: a bank
   * name and a company name identify themselves, an unlabelled 24-character
   * string does not — it could as easily be an account number. Tagging all
   * three would cost a third line per account for two tags nobody reads.
   */
  ibanLabel: BiLabel;
  accounts: VmBankAccount[];
};

export type VmNotice = {
  tone: "ok" | "bad";
  heading: BiLabel;
  /** Already-filled sentence, per language. Dates/reasons are data, not labels. */
  detail: BiLabel;
  note: BiLabel | null;
};

export type InvoiceVm = {
  status: InvoiceStatus;
  statusLabel: BiLabel;
  paymentMode: "prepaid" | "postpaid";
  invoiceNumber: string | null;
  /** `#026-000042`, or the period in parentheses for an unnumbered draft. */
  invoiceRef: string;
  issueDate: string | null;
  periodStart: string;
  periodEnd: string;
  seller: PdfIdentity;
  buyer: PdfIdentity;
  buyerEmail: string | null;
  notice: VmNotice | null;
  /**
   * The document's footnotes, in order. A LIST rather than fixed slots because
   * which notes apply is a content decision, not a layout one — the rollover
   * sentence only belongs on a document that actually carries a rolled-forward
   * charge, and a renderer has no business working that out.
   */
  notes: BiLabel[];
  /**
   * Transfer Details — payment instructions, printed BELOW the notes and the
   * Grand Total. `null` when no account is ticked to show. See
   * `buildBankBlock`.
   */
  bank: VmBankBlock | null;
  sections: VmSection[];
  totals: { rows: VmTotalRow[]; vat: number; total: number };
  /** null when postpaid (no such card on screen) or when the toggle hides it. */
  amountDue: { totals: PdfTotals } | null;
  /**
   * SETTLEMENT, printed between the Grand Total and the hero. Ledger-era
   * prepaid only — `[]` everywhere else, so a renderer prints the block by
   * iterating and never by testing the mode.
   *
   * ONE row today: Prepaid Applied, NEGATIVE — it is a deduction, and a
   * deduction printed as a positive under a total reads as an addition. It is
   * the frozen figure off the invoice row; nothing here subtracts anything.
   * Amount Payable is deliberately absent — it is the hero directly below, and
   * printing it twice in one panel reads as two figures that happen to match.
   * An array, not a single field, because a later settlement fact (a write-off
   * line, say) joins this slot without touching a renderer.
   *
   * Empty when `hideAmountDue` is on: the hidden document is charges-only —
   * its trips section is omitted whole — and a Prepaid Applied line under a
   * charges total would disclose the trip money the toggle just removed. The
   * hero does NOT go with it: the hidden document still closes on Amount
   * Payable, equal to its charges total (see `hero`).
   */
  settlementRows: VmTotalRow[];
  /**
   * THE ONE FIGURE IN THE BIG BOX. Decided here so the sheet, the PDF and the
   * print cannot each pick a different one — which is exactly what happened
   * when each renderer wrote `vm.amountDue ? … : …` for itself.
   *
   * Ledger-era prepaid with settlement shown → Amount Payable. Ledger-era
   * prepaid HIDDEN from the customer → Amount Payable again, equal to the
   * charges total (the only money the hidden document shows — see the
   * builder's `hidden` comment). Legacy prepaid → Amount Due. Everything else
   * → Grand Total.
   *
   * NEVER ABSENT. Every document closes on one figure the customer can act
   * on; the toggle changes WHAT that figure speaks for, not whether it
   * exists.
   */
  hero: { label: BiLabel; amount: number };
  /**
   * Whether `hero` IS the Grand Total. When true a renderer must NOT print a
   * separate Grand Total row above the hero — it would be the same number
   * twice, which is the bug the old `vm.amountDue ?` conditional existed to
   * avoid. When false, print the Grand Total row; the hero is a different
   * figure.
   *
   * FALSE on the hidden document even though the two AMOUNTS match there: the
   * captions differ (TOTAL vs Amount Payable) and Turki's ruling prints both
   * lines — the total the charges reach, then the payable it becomes.
   */
  heroIsGrandTotal: boolean;
  /**
   * The payments-and-draws list, printed AFTER the hero — it explains how the
   * figure above it got where it is, so it cannot come before it. `null` on
   * every document that has nothing to list; see `VmSettlementDetail`.
   */
  settlementDetail: VmSettlementDetail | null;
  // NO top-level balance field, deliberately: the balance belongs to a table
  // foot, so it travels inside `VmTableFoot`'s "ledger" arm and nowhere else.
  /** Labels the renderer needs that are not attached to a section. */
  labels: {
    taxInvoice: BiLabel;
    buyer: BiLabel;
    seller: BiLabel;
    invoiceInfo: BiLabel;
    invoiceNo: BiLabel;
    issueDate: BiLabel;
    period: BiLabel;
    status: BiLabel;
    vatRegNo: BiLabel;
    crNo: BiLabel;
    tel: BiLabel;
    mobile: BiLabel;
    email: BiLabel;
    address: BiLabel;
    currencyLabel: BiLabel;
    notesHeading: BiLabel;
    notOnFile: BiLabel;
    draftNotNumbered: BiLabel;
    colDate: BiLabel;
    colDescription: BiLabel;
    colType: BiLabel;
    colQuantity: BiLabel;
    colPrice: BiLabel;
    colAmount: BiLabel;
    colStatus: BiLabel;
    subtotal: BiLabel;
    /**
     * The prepaid footer's THIRD row. The balance row above it has no label
     * here any more: it moved onto the foot itself as
     * `VmTableFoot.balanceLabel`, because the two eras put two different
     * figures in that slot and a document-level label could only name one of
     * them. `runningBalance` ("Running Balance") is still NOT the caption of
     * either — the layout was restorable, the old name was not.
     *
     * "Remaining" stays here: it means the same thing in both eras, balance
     * minus this table's subtotal, whichever balance it was.
     */
    remaining: BiLabel;
    /**
     * TEMPLATES, handed over UNFILLED (`{net}` / `{vat}` placeholders intact).
     * Each surface substitutes with its own number formatting — the sheet's
     * whole riyals, the tax document's halalas. Filling here would freeze one
     * medium's format into the other. Use `fillBi` to substitute.
     */
    vatSplit: BiLabel;
    chargesSubtotal: BiLabel;
    totalVat: BiLabel;
    grandTotal: BiLabel;
    amountDue: BiLabel;
    prepaidApplied: BiLabel;
    amountPayable: BiLabel;
    noCharges: BiLabel;
    currency: BiLabel;
    qrCaption: BiLabel;
  };
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/** `{ en: t(key,"en"), ar: t(key,"ar") }` — the only way a label is born here. */
function bi(key: TKey): BiLabel {
  return { en: t(key, "en"), ar: t(key, "ar") };
}

/** Same, for a template key that needs values substituted in both languages. */
function biFill(key: TKey, vals: Record<string, string | number>): BiLabel {
  return { en: fill(t(key, "en"), vals), ar: fill(t(key, "ar"), vals) };
}

/** A literal that is NOT translatable — an email address, a currency code. */
function biRaw(s: string): BiLabel {
  return { en: s, ar: s };
}

/**
 * Substitutes into a template label the vm handed over unfilled. Exported
 * because the substitution has to happen in the RENDERER — that is where the
 * medium's number formatting lives — while the template itself still comes
 * from the dictionary. One `fill` implementation, both sides.
 */
export function fillBi(label: BiLabel, vals: Record<string, string | number>): BiLabel {
  return { en: fill(label.en, vals), ar: fill(label.ar, vals) };
}

function toTripRows(rows: GroupedRow[]): VmTripRow[] {
  return rows.map((r) => ({
    key: r.key,
    periodLabel: r.periodLabel,
    refRangeLabel: r.refRangeLabel,
    waterType: r.waterType
      ? { en: waterTypeLabel(r.waterType, "en"), ar: waterTypeLabel(r.waterType, "ar") }
      : null,
    quantity: r.quantity,
    price: r.price,
    amount: r.amount,
  }));
}

function toChargeRows(lines: PdfLine[]): VmChargeRow[] {
  return lines.map((l) => ({
    id: l.id,
    date: l.trip_date,
    description: l.description,
    // Mirrors SpecialChargesSection's `l.quantity ?? 1` / `l.price_sar ??
    // l.amount_sar` fallbacks for snapshots frozen before those fields existed.
    quantity: l.quantity ?? 1,
    price: l.price_sar ?? l.amount_sar,
    amount: l.amount_sar,
    // ONLY an explicit `false` rolls forward. `undefined` is a pre-0036
    // snapshot, from an era where a charge was always billed on the invoice it
    // was added to — the popup reads it as Covered and so must this.
    covered: l.covered !== false,
    statusLabel:
      l.covered === false
        ? bi("trips.invoiceSheet.badgeRollsForward")
        : bi("trips.invoiceSheet.badgeCovered"),
  }));
}

/** Round-once net/VAT pair over a line subset — the popup's exact method. */
function netAndVat(lines: PdfLine[]): { preVat: number; vat: number; total: number } {
  const preVat = round2(lines.reduce((s, l) => s + l.amount_sar, 0));
  const vat = round2(lines.reduce((s, l) => s + (l.vat_sar ?? 0), 0));
  return { preVat, vat, total: round2(preVat + vat) };
}

/**
 * TRANSFER DETAILS — the payment instruction block, or `null`.
 *
 * EXPORTED, and that is the whole point of it living here. The popup does not
 * build a full view-model (it renders a live React sheet from its own `View`),
 * so if this block were inlined in `buildInvoiceViewModel` the popup would have
 * to restate the filter, the ordering and the IBAN spacing — three chances to
 * deviate from the document the customer actually receives. Both surfaces call
 * THIS.
 *
 * `null`, not an empty block, when nothing is ticked: a "Transfer Details"
 * heading over no accounts is worse than no heading, and `null` lets each
 * renderer drop the container, its border and its margin in one test.
 *
 * IBAN is grouped HERE, not in the renderers. Grouping is a WORDING decision —
 * it changes the characters printed — and this file owns wording. `formatIban`
 * is the same expression the settings screen displays, so an operator proofreads
 * the exact string the customer will read.
 */
export function buildBankBlock(bankAccounts: unknown): VmBankBlock | null {
  const accounts = visibleBankAccounts(bankAccounts);
  if (accounts.length === 0) return null;
  return {
    heading: bi("trips.invoiceSheet.transferDetails"),
    ibanLabel: bi("trips.invoiceSheet.fIban"),
    accounts: accounts.map((a) => ({
      id: a.id,
      bankName: a.bank_name,
      accountName: a.holder_name,
      ibanDisplay: formatIban(a.iban),
    })),
  };
}

export function buildInvoiceViewModel(data: PdfInvoiceData): InvoiceVm {
  const isPrepaid = data.paymentMode === "prepaid";
  const wt = data.projectWaterType;

  // --- Notice (void / paid) ------------------------------------------------
  // Mirrors the popup's two banner blocks, key for key. Dates and the void
  // reason are DATA and pass through untranslated in both columns; only the
  // sentences around them come from the dictionary.
  let notice: VmNotice | null = null;
  if (data.status === "void") {
    const on = data.voidedAt ? biFill("trips.invoiceSheet.voidedOn", { date: data.voidedAt.slice(0, 10) }) : null;
    const why = data.voidReason ? biFill("trips.invoiceSheet.voidSuffix", { reason: data.voidReason }) : null;
    notice = {
      tone: "bad",
      heading: bi("trips.invoiceSheet.salesReturn"),
      detail: {
        en: `${on?.en ?? ""}${why?.en ?? ""}`.trim(),
        ar: `${on?.ar ?? ""}${why?.ar ?? ""}`.trim(),
      },
      note: biFill("trips.invoiceSheet.salesReturnNote", {
        ref: data.invoiceNumber ? ` (${data.invoiceNumber})` : "",
      }),
    };
  } else if (data.status === "paid") {
    const on = data.paidAt ? biFill("trips.invoiceSheet.paidOn", { date: data.paidAt.slice(0, 10) }) : null;
    const via = bi("trips.invoiceSheet.via");
    const method = data.paymentMethod
      ? { en: paymentMethodLabel(data.paymentMethod, "en"), ar: paymentMethodLabel(data.paymentMethod, "ar") }
      : null;
    notice = {
      tone: "ok",
      heading: bi("trips.invoiceSheet.paid"),
      detail: {
        en: [on?.en, method ? `${via.en} ${method.en}` : null].filter(Boolean).join(" "),
        ar: [on?.ar, method ? `${via.ar} ${method.ar}` : null].filter(Boolean).join(" "),
      },
      note: null,
    };
  }

  const sections: VmSection[] = [];
  let totalRows: VmTotalRow[];
  let amountDue: { totals: PdfTotals } | null;
  // WHAT THE TOTALS BLOCK SPEAKS FOR. The frozen grand pair on every document
  // except one: a ledger-era prepaid invoice hidden from the customer, which
  // omits its trips section whole and must then total ONLY what it still
  // shows — the charges. A totals block that printed the full grand under a
  // charges-only table would be a document that does not add up on its own
  // page. The invoice ROW is untouched either way; this is presentation.
  let totalsVat = data.grand.vat;
  let totalsTotal = data.grand.total;

  // THE THREE BRANCHES, in the order they are tested:
  //   1. ledger-era prepaid  — one trips table + the settlement pair
  //   2. LEGACY prepaid      — the pre-0203 document, verbatim (freeze law 0027)
  //   3. postpaid            — unchanged in both eras; its document never
  //                            carried a coverage split to lose.
  const isLedger = data.era === "ledger";

  if (isPrepaid && isLedger) {
    // --- PREPAID, LEDGER ERA (0203): Trips → Special charges ---------------
    // ONE trips table. There is no covered/unpaid boundary to draw a second
    // table around: the draw is a document-level amount decided at settlement,
    // and it is reported under the totals as Prepaid Applied / Amount Payable.
    const tripLines = data.unpaidLines;
    const tripT = netAndVat(tripLines);
    const chargeT = netAndVat(data.chargeLines);

    if (data.hideAmountDue) {
      // HIDE FROM CUSTOMER (Turki's ruling, adjustments batch): the hidden
      // copy omits the TRIPS SECTION WHOLE — the table, its subtotal and the
      // Balance / Remaining rows under it. Not a foot swap and not a caption
      // drop: everything trip-priced is off the page, and what remains is a
      // charges-only document whose totals block speaks for exactly what it
      // still shows — charges subtotal, VAT on charges, their total, and an
      // Amount Payable equal to that total (the hero, below). Screen is
      // untouched, frozen money is untouched; the flag decides per render.
      totalRows = [{ label: bi("trips.invoiceSheet.specialCharges"), amount: chargeT.preVat }];
      totalsVat = chargeT.vat;
      totalsTotal = chargeT.total;
    } else {
      // The three-row foot (Subtotal / Balance / Remaining), UNGATED — every
      // visible ledger document prints it. Both figures come from the
      // `balance_applied` ledger rows for THIS invoice: the balance
      // immediately before the draw and immediately after it, the last draw
      // winning when there were several. `paidUpBalanceSar` is still carried
      // for the legacy branch below and is deliberately unread here.
      //
      // NEITHER FIGURE IS COMPUTED HERE. Remaining used to be `balance −
      // this table's subtotal`, a subtraction the renderer invented: a
      // balance does not fall by the trips subtotal, it falls by whatever was
      // drawn, and the two agree only when the balance covered the invoice
      // exactly. Now both come off the ledger and `before − draw = after` is
      // an identity about events that happened.
      //
      // THREE STATES, THREE RENDERINGS — a real draw, no draw yet, and a
      // failed read are three different facts, so the slot is a union and
      // none of them can be printed as a fabricated 0.
      const draw: InvoiceLedgerDraw = data.ledgerDraw ?? { state: "unreadable" };
      const ledgerBalanceRow: { amount: number } | { note: BiLabel } | null =
        draw.state === "drawn"
          ? { amount: draw.balanceBefore }
          : draw.state === "none"
            ? null
            : { note: bi("trips.invoiceSheet.paidUpUnavailable") };

      sections.push({
        kind: "trips",
        title: bi("trips.invoiceSheet.tTrips"),
        emptyLabel: bi("trips.invoiceSheet.emptyTrips"),
        rows: toTripRows(groupInvoiceLines(tripLines, wt)),
        foot: {
          style: "ledger",
          preVat: tripT.preVat,
          vat: tripT.vat,
          subtotal: tripT.total,
          balanceLabel: bi("trips.invoiceSheet.ledgerBalance"),
          balance: ledgerBalanceRow,
          remaining: draw.state === "drawn" ? draw.balanceAfter : null,
        },
      });

      // The stack rows sum the LINES printed above them, so they cannot
      // disagree with the tables — a ledger-era invoice's grand total is one
      // pass over exactly these lines, by construction.
      totalRows = [
        { label: bi("trips.invoiceSheet.subtotalTrips"), amount: tripT.preVat },
        { label: bi("trips.invoiceSheet.specialCharges"), amount: chargeT.preVat },
      ];
    }

    // The charges table prints on BOTH arms — it is the one section the
    // hidden document keeps, and the totals above foot to it.
    if (data.chargeLines.length > 0) {
      sections.push({
        kind: "charges",
        title: bi("trips.invoiceSheet.specialCharges"),
        rows: toChargeRows(data.chargeLines),
        preVat: chargeT.preVat,
        vat: chargeT.vat,
        total: chargeT.total,
        // No coverage verdict exists to print. See VmChargesSection.showStatus.
        showStatus: false,
      });
    }

    // NO Amount Due card. On a ledger-era invoice amountDue IS grand — the
    // whole document is billable — so the card would print the grand total a
    // second time under a different name. Same reason postpaid never had one.
    amountDue = null;
  } else if (isPrepaid) {
    // --- PREPAID, LEGACY (pre-0203): Covered → Unpaid → Special charges -----
    // FROZEN DOCUMENTS ONLY. Nothing assembled today reaches this branch — the
    // engine stopped producing covered lines, coverage flags and tripTotals at
    // 0203, so an invoice arrives here only because it was CONFIRMED under the
    // old law and its caller set era:"legacy". It renders exactly as issued,
    // including the paid-up balance foot and the coverage pills (0027).
    //
    // Do not "simplify" this into the branch above. The two produce different
    // documents on purpose, and the difference is which law the customer was
    // billed under.
    // Fallback for a row frozen before migration 0036, which carries no trip-
    // total columns and never will: both figures are still derivable from real
    // frozen document totals. On such a row `amountDue.total` IS the unpaid
    // trips total, because Amount Due was trips-only for the whole of that era
    // (see InvoiceDetailModal's DisplayLedgerTotals note) — the fallback holds
    // only for the legacy rows it fires on, it is not a general identity.
    const coveredTripsTotal = data.tripTotals?.covered ?? data.covered.total;
    const unpaidTripsTotal = data.tripTotals?.unpaid ?? data.amountDue.total;

    // These totals are VAT-INCLUSIVE, so they cannot be split on their own.
    // Derive pre-VAT from the same raw lines the engine summed, then back into
    // VAT, so the two halves always foot to the total shown beside them.
    const coveredPreVat = round2(data.coveredLines.reduce((s, l) => s + l.amount_sar, 0));
    const unpaidPreVat = round2(data.unpaidLines.reduce((s, l) => s + l.amount_sar, 0));

    // THE BALANCE ROW'S VALUE, decided ONCE for both tables. `paidUpBalanceSar`
    // is already the right figure for this invoice's status — live on an
    // unissued one, frozen at paid_at / voided_at once issued — because that
    // choice was made upstream where the row's timestamps live. Nothing about
    // the number is computed here.
    //
    // A prepaid invoice reaching this point with a null figure means the read
    // FAILED (postpaid never enters this branch), so the slot carries the
    // explicit note rather than a blank or a fabricated 0.
    const balanceRow: { amount: number } | { note: BiLabel } =
      data.paidUpBalanceSar != null
        ? { amount: data.paidUpBalanceSar }
        : { note: bi("trips.invoiceSheet.paidUpUnavailable") };
    // Balance minus this table's own VAT-inclusive subtotal. Display arithmetic
    // on two figures already decided — the same subtraction the pay-with-balance
    // panel shows — and deliberately NOT chained: the unpaid table's balance is
    // the same paid-up figure as the covered table's, never the covered table's
    // remainder. Chaining is the deleted mechanism.
    const remainingAfter = (subtotal: number) =>
      data.paidUpBalanceSar == null ? null : round2(data.paidUpBalanceSar - subtotal);

    sections.push({
      kind: "trips",
      title: bi("trips.invoiceSheet.tCoveredTrips"),
      emptyLabel: bi("trips.invoiceSheet.emptyTrips"),
      rows: toTripRows(groupInvoiceLines(data.coveredLines, wt)),
      foot: {
        style: "ledger",
        preVat: coveredPreVat,
        vat: round2(coveredTripsTotal - coveredPreVat),
        subtotal: coveredTripsTotal,
        balanceLabel: bi("trips.invoiceSheet.paidUpBalance"),
        balance: balanceRow,
        remaining: remainingAfter(coveredTripsTotal),
      },
    });

    // hide_amount_due is a PRINT-ONLY suppression. On screen the section stays
    // (the operator has to keep seeing what she is hiding); THIS document is
    // the customer-facing surface, so here it is a real omission — and the
    // Amount Due figure goes with it, because a due total with no rows behind
    // it is worse than either alone.
    if (!data.hideAmountDue) {
      sections.push({
        kind: "trips",
        title: bi("trips.invoiceSheet.tUnpaidTrips"),
        emptyLabel: bi("trips.invoiceSheet.emptyTrips"),
        rows: toTripRows(groupInvoiceLines(data.unpaidLines, wt)),
        foot: {
          style: "ledger",
          preVat: unpaidPreVat,
          vat: round2(unpaidTripsTotal - unpaidPreVat),
          subtotal: unpaidTripsTotal,
          balanceLabel: bi("trips.invoiceSheet.paidUpBalance"),
          balance: balanceRow,
          remaining: remainingAfter(unpaidTripsTotal),
        },
      });
    }

    if (data.chargeLines.length > 0) {
      const c = netAndVat(data.chargeLines);
      sections.push({
        kind: "charges",
        title: bi("trips.invoiceSheet.specialCharges"),
        rows: toChargeRows(data.chargeLines),
        preVat: c.preVat,
        vat: c.vat,
        total: c.total,
        // As issued: these rows carry real coverage verdicts.
        showStatus: true,
      });
    }

    // --- Grand Total stack --------------------------------------------------
    // Grand Total is the WHOLE invoice: every trip listed, covered or unpaid,
    // plus every special charge. The rows sum the LINES printed above them, so
    // they cannot disagree with the tables.
    //
    // The trip sum spans covered AND unpaid even when hideAmountDue removed the
    // unpaid TABLE: the toggle hides a section, it does not remove trips from
    // the invoice's own total. Shrinking TOTAL alongside would change what the
    // customer is billed.
    const tripsSubtotal = round2(
      [...data.coveredLines, ...data.unpaidLines].reduce((s, l) => s + l.amount_sar, 0),
    );
    const chargesSubtotalAll = round2(data.chargeLines.reduce((s, l) => s + l.amount_sar, 0));
    // An invoice frozen under the old covered-only Grand Total holds a stored
    // total that EXCLUDES lines it prints, so line-derived rows would render a
    // stack visibly not adding up to its own TOTAL. Those render AS ISSUED.
    // The test is arithmetic, never a status check, so a corrected row starts
    // reconciling on its own with nothing here to re-key (0027: an issued
    // document is read verbatim, never re-derived).
    const reconciles = round2(tripsSubtotal + chargesSubtotalAll + data.grand.vat) === data.grand.total;
    // The as-issued row. `!== false` so a pre-0036 snapshot carrying no
    // coverage flag counts as covered — which is what the engine that froze
    // this grand total did, and this row has to keep adding up to it.
    const frozenCoveredCharges = round2(
      data.chargeLines.filter((l) => l.covered !== false).reduce((s, l) => s + l.amount_sar, 0),
    );
    totalRows = reconciles
      ? [
          { label: bi("trips.invoiceSheet.subtotalTrips"), amount: tripsSubtotal },
          { label: bi("trips.invoiceSheet.specialCharges"), amount: chargesSubtotalAll },
        ]
      : [
          { label: bi("trips.invoiceSheet.subtotalCovered"), amount: data.covered.subtotal },
          { label: bi("trips.invoiceSheet.chargesCovered"), amount: frozenCoveredCharges },
        ];

    amountDue = data.hideAmountDue ? null : { totals: data.amountDue };
  } else {
    // --- POSTPAID: Covered (if any) → Unpaid trips → Special charges --------
    // Covered is OMITTED ENTIRELY when empty (a postpaid customer with nothing
    // covered this period), exactly as the popup omits it — not rendered as an
    // empty table.
    if (data.coveredLines.length > 0) {
      sections.push({
        kind: "trips",
        title: bi("trips.invoiceSheet.tCoveredPostpaid"),
        emptyLabel: bi("trips.invoiceSheet.emptyLines"),
        rows: toTripRows(groupInvoiceLines(data.coveredLines, wt)),
        // The frozen document totals, not a re-derivation — data.covered IS
        // this table's total.
        foot: { style: "subtotal", preVat: data.covered.subtotal, vat: data.covered.vat, total: data.covered.total },
      });
    }

    // Postpaid keeps trips and charges merged in unpaidLines; the popup splits
    // them for display and recomputes each subset's totals round-once. Same
    // split, same method, here.
    const tripLines = data.unpaidLines.filter((l) => l.kind === "trip");
    const chargeLines = data.unpaidLines.filter((l) => l.kind === "charge");
    const tripT = netAndVat(tripLines);
    const chargeT = netAndVat(chargeLines);

    sections.push({
      kind: "trips",
      title: bi("trips.invoiceSheet.tUnpaidPostpaid"),
      emptyLabel: bi("trips.invoiceSheet.emptyLines"),
      rows: toTripRows(groupInvoiceLines(tripLines, wt)),
      foot: { style: "subtotal", preVat: tripT.preVat, vat: tripT.vat, total: tripT.total },
    });

    if (chargeLines.length > 0) {
      sections.push({
        kind: "charges",
        title: bi("trips.invoiceSheet.specialCharges"),
        rows: toChargeRows(chargeLines),
        preVat: chargeT.preVat,
        vat: chargeT.vat,
        total: chargeT.total,
        // UNCHANGED IN BOTH ERAS. A postpaid charge has never carried a real
        // coverage verdict — `toChargeRows` defaults it to covered, so the
        // column prints a uniform pill — but the postpaid document is not what
        // 0203 changed, and dropping a column from it would be a redesign
        // smuggled in on a money change. It keeps its look.
        showStatus: true,
      });
    }

    totalRows = [
      { label: bi("trips.invoiceSheet.subtotalUnpaid"), amount: tripT.preVat },
      { label: bi("trips.invoiceSheet.specialCharges"), amount: chargeT.preVat },
    ];
    // NO Amount Due card for postpaid — with no prepaid balance it is always
    // numerically identical to Grand Total, i.e. the same figure printed twice.
    // The popup dropped it for that reason; the download follows.
    amountDue = null;
  }

  // --- Footnotes -----------------------------------------------------------
  // The VAT line is unconditional — it is the statutory basis this document is
  // issued under and the currency it is denominated in.
  //
  // The rollover line is CONDITIONAL and that is the point: it explains a
  // "Rolls forward" pill, so it belongs only on a document that shows one.
  // Printing it on every invoice would have the customer looking for a charge
  // that is not there. Postpaid never rolls anything forward, so this is
  // structurally prepaid-only without needing a mode test.
  //
  // `s.showStatus` gates it as well as the verdict does: the sentence explains
  // a pill, so on a document that prints no pill column it explains nothing.
  // On a ledger-era invoice nothing rolls forward in the first place — every
  // charge is billed on the invoice it is bound to — so both halves agree.
  const notes: BiLabel[] = [bi("trips.invoiceSheet.noteVatBasis")];
  if (sections.some((s) => s.kind === "charges" && s.showStatus && s.rows.some((r) => !r.covered))) {
    notes.push(bi("trips.invoiceSheet.noteRollsForward"));
  }

  // --- Settlement + hero ---------------------------------------------------
  // The applied/payable pair prints only when all four hold:
  //   ledger era · prepaid · a frozen payable exists · not hidden from customer
  //
  // The payable test is what keeps the pair off a DRAFT. A draft has been
  // assembled but not confirmed, so no draw has happened and there is nothing
  // honest to print — `prepaidAppliedSar` is null there, and printing 0.00
  // would tell the customer their balance was checked and found empty.
  const showSettlement =
    isLedger &&
    isPrepaid &&
    !data.hideAmountDue &&
    data.amountPayableSar != null &&
    data.prepaidAppliedSar != null;

  const settlementRows: VmTotalRow[] = showSettlement
    ? [
        // NEGATIVE on purpose — it is a deduction sitting under a total, and a
        // deduction printed positive reads as an addition. The renderers format
        // the sign; nothing here decides how a minus looks.
        //
        // Amount Payable is NOT a row here: it is the hero, immediately below.
        // Printing it in both places puts the same figure in the panel twice a
        // few millimetres apart, which reads as two figures that happen to
        // match and invites the customer to hunt for the difference. The panel
        // instead carries a chain the reader can do in their head:
        //   Grand Total − Prepaid Applied = the hero.
        { label: bi("trips.invoiceSheet.prepaidApplied"), amount: round2(-(data.prepaidAppliedSar ?? 0)) },
      ]
    : [];

  // HIDE-FROM-CUSTOMER, LEDGER ERA: the hero is the CHARGES total, presented
  // as Amount Payable.
  //
  // The hidden document is charges-only (the branch above dropped the trips
  // section and re-pointed the totals), and Turki's ruling is that it still
  // closes on a payable — the one figure a customer can act on — equal to the
  // charges total the stack above it just reached. So the panel reads:
  // charges subtotal, VAT on charges, their total, Amount Payable = that
  // total. Every line follows from the one before it; the document adds up
  // to what it shows and nothing trip-priced is on it.
  //
  // Legacy is deliberately excluded. There the toggle keeps its issued-era
  // meaning — drop the Unpaid table and the Amount Due card (freeze law 0027).
  const hidden = isLedger && isPrepaid && data.hideAmountDue;

  // ONE decision, made here, for every surface. `amountDue` survives only for
  // legacy prepaid documents, which is the one era that still has a due figure
  // distinct from its grand total. `totalsTotal` on the hidden arm IS the
  // charges total — the branch above set it, and hero and stack must foot to
  // each other, so they read one variable.
  const hero: { label: BiLabel; amount: number } = hidden
    ? { label: bi("trips.invoiceSheet.amountPayable"), amount: totalsTotal }
    : showSettlement
      ? { label: bi("trips.invoiceSheet.amountPayable"), amount: data.amountPayableSar ?? 0 }
      : amountDue
        ? { label: bi("trips.invoiceSheet.amountDue"), amount: amountDue.totals.total }
        : { label: bi("trips.invoiceSheet.grandTotal"), amount: data.grand.total };
  // `!hidden` is load-bearing: the hidden hero equals the stack's total in
  // NUMBER but carries a different caption (Amount Payable vs TOTAL), and
  // Turki's ruling prints both lines — the total the charges reach, then the
  // payable it becomes.
  const heroIsGrandTotal = !hidden && !showSettlement && amountDue == null;

  // --- How this invoice was settled ----------------------------------------
  // A dated list of every payment received and every draw against the
  // customer's balance, closing on what is still outstanding. It exists
  // because since 0204 a prepaid invoice RESTS at Confirmed and settles
  // afterwards, in pieces: the customer can receive the same document twice
  // with different amounts behind it, and a single Amount Payable line cannot
  // tell them which payment of theirs landed.
  //
  // Same four gates as the settlement pair, plus one more: `hidden`. This
  // section names amounts owed and paid against this invoice — trip money the
  // hidden document no longer carries anywhere else — so it is the same
  // disclosure the toggle exists to suppress and it goes with the trips
  // section. Without that gate the toggle would drop the trips table and then
  // print a payment list that adds back up to it.
  //
  // The remainder is the VIEW's own `remainder_sar`, not a subtraction over
  // the rows above it. Those rows are what the customer needs to recognise
  // their own payments; the closing figure is what the database would answer.
  const settlementEvents = data.settlementEvents ?? [];
  const settlementDetail: VmSettlementDetail | null =
    isLedger &&
    isPrepaid &&
    !hidden &&
    data.settlementRemainderSar != null &&
    settlementEvents.length > 0
      ? {
          title: bi("trips.invoiceSheet.seTitle"),
          rows: settlementEvents.map((e, i) => ({
            // The index is the key: two cash payments of the same amount on the
            // same day are two real events, and keying on their content would
            // silently collapse them into one row.
            key: `${e.kind}-${i}`,
            date: e.date ? e.date.slice(0, 10) : null,
            // Filled per language, not through `biFill`: the substituted value
            // is itself a translated word, and `biFill` fills both columns from
            // one set of values — which would drop "Bank transfer" into the
            // Arabic sentence. Same shape the notice block above uses.
            description:
              e.kind === "applied"
                ? bi("trips.invoiceSheet.seBalanceApplied")
                : e.method
                  ? {
                      en: fill(t("trips.invoiceSheet.sePaymentVia", "en"), {
                        method: paymentMethodLabel(e.method, "en"),
                      }),
                      ar: fill(t("trips.invoiceSheet.sePaymentVia", "ar"), {
                        method: paymentMethodLabel(e.method, "ar"),
                      }),
                    }
                  : bi("trips.invoiceSheet.sePayment"),
            reference: e.reference,
            amount: e.amount,
          })),
          colDate: bi("common.date"),
          colDescription: bi("trips.invoiceSheet.colDescription"),
          colReference: bi("trips.invoiceSheet.seColReference"),
          colAmount: bi("common.amount"),
          remainderLabel: bi("trips.invoiceSheet.sRemainder"),
          remainder: data.settlementRemainderSar,
        }
      : null;

  return {
    status: data.status,
    statusLabel: {
      en: invoiceStatusLabel(data.status, "en"),
      ar: invoiceStatusLabel(data.status, "ar"),
    },
    paymentMode: data.paymentMode,
    invoiceNumber: data.invoiceNumber,
    invoiceRef: data.invoiceNumber ? `#${data.invoiceNumber}` : `(${data.periodStart} — ${data.periodEnd})`,
    issueDate: data.issueDate ? data.issueDate.slice(0, 10) : null,
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
    seller: data.seller,
    buyer: data.buyer,
    buyerEmail: data.buyerEmail,
    notice,
    notes,
    bank: buildBankBlock(data.bankAccounts),
    sections,
    totals: { rows: totalRows, vat: totalsVat, total: totalsTotal },
    amountDue,
    settlementRows,
    hero,
    heroIsGrandTotal,
    settlementDetail,
    labels: {
      // The ZATCA-mandated document title. Download-only — the sheet's own
      // headline is `Invoice #{n}`, a different string for a different surface,
      // so this is NOT the popup's `headline` key.
      taxInvoice: bi("trips.invoiceSheet.fTaxInvoiceTitle"),
      buyer: bi("trips.invoiceSheet.buyer"),
      seller: bi("trips.invoiceSheet.seller"),
      invoiceInfo: bi("trips.invoiceSheet.invoiceInfo"),
      invoiceNo: bi("trips.invoiceSheet.fInvoiceNo"),
      issueDate: bi("trips.invoiceSheet.fIssueDate"),
      period: bi("trips.invoiceSheet.fPeriod"),
      status: bi("common.status"),
      vatRegNo: bi("trips.invoiceSheet.fVatRegNo"),
      crNo: bi("trips.invoiceSheet.fCrNo"),
      tel: bi("trips.invoiceSheet.fTel"),
      mobile: bi("trips.invoiceSheet.fMobile"),
      email: bi("trips.invoiceSheet.fEmail"),
      address: bi("trips.invoiceSheet.fAddress"),
      currencyLabel: bi("trips.invoiceSheet.fCurrency"),
      notesHeading: bi("trips.invoiceSheet.notesHeading"),
      notOnFile: bi("trips.invoiceSheet.notOnFile"),
      draftNotNumbered: bi("trips.invoiceSheet.vDraftNotNumbered"),
      colDate: bi("common.date"),
      colDescription: bi("trips.invoiceSheet.colDescription"),
      colType: bi("common.type"),
      colQuantity: bi("trips.invoiceSheet.colQuantity"),
      colPrice: bi("trips.invoiceSheet.colPrice"),
      colAmount: bi("common.amount"),
      colStatus: bi("common.status"),
      subtotal: bi("trips.invoiceSheet.subtotal"),
      remaining: bi("trips.invoiceSheet.remaining"),
      // UNFILLED templates — see the type. `fillBi` substitutes downstream.
      vatSplit: bi("trips.invoiceSheet.vatSplit"),
      chargesSubtotal: bi("trips.invoiceSheet.chargesSubtotal"),
      totalVat: bi("trips.invoiceSheet.totalVat"),
      grandTotal: bi("trips.invoiceSheet.grandTotal"),
      amountDue: bi("trips.invoiceSheet.amountDue"),
      prepaidApplied: bi("trips.invoiceSheet.prepaidApplied"),
      amountPayable: bi("trips.invoiceSheet.amountPayable"),
      noCharges: bi("trips.invoiceSheet.noCharges"),
      // SAR is a currency CODE, not a word — identical in both columns.
      currency: biRaw("SAR"),
      qrCaption: bi("trips.invoiceSheet.qrCaption"),
    },
  };
}
