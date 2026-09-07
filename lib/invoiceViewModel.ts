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
 * `preVat`/`vat` exist on both so the renderer never has to derive money.
 *
 * THE LAYOUT IS THE ORIGINAL ONE; THE BALANCE ROW'S VALUE IS NOT. The three
 * rows used to be fed by a per-invoice CHAINED running balance — the covered
 * table's Remaining seeded the unpaid table's balance — computed from frozen
 * `*_ledger_balance_sar` columns. That mechanism produced a figure the
 * statement, the Finance KPI and the over-balance banner all disagreed with,
 * and it is NOT coming back. The rows are now fed by the PAID-UP BALANCE, the
 * one shared expression (lib/prepaid.ts, reached through
 * invoiceActions' `loadPaidUpBalance`), handed in as `PdfInvoiceData.
 * paidUpBalanceSar`. Same three rows on the page, one honest number behind them.
 *
 * `balance` is a UNION, not a nullable number, for the same reason it is one
 * upstream: "the read failed" and "the balance is zero" are different content
 * and must not collapse into the same rendering. A renderer prints `amount` or
 * prints `note`; it never decides what a missing figure looks like.
 *
 * `remaining` is `balance − subtotal` for THIS table, and null exactly when the
 * balance is unreadable (nothing to subtract from). NOT chained across tables:
 * both prepaid tables carry the same balance figure.
 */
export type VmTableFoot =
  | {
      style: "ledger";
      preVat: number;
      vat: number;
      subtotal: number;
      balance: { amount: number } | { note: BiLabel };
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
};

export type VmSection = VmTripSection | VmChargesSection;

export type VmTotalRow = { label: BiLabel; amount: number };

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
     * The prepaid footer's balance row. `runningBalance` ("Running Balance")
     * stood here and is deliberately NOT restored with the row it labelled: the
     * row's position is the original one, but the figure in it is the PAID-UP
     * BALANCE, not the chained per-invoice running balance that name described.
     * Naming it "Running Balance" would put a wrong name on a legal document —
     * the layout is restorable, the old caption is not.
     */
    paidUpBalance: BiLabel;
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

  if (isPrepaid) {
    // --- PREPAID: Covered trips → Unpaid trips → Special charges ------------
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
  const notes: BiLabel[] = [bi("trips.invoiceSheet.noteVatBasis")];
  if (sections.some((s) => s.kind === "charges" && s.rows.some((r) => !r.covered))) {
    notes.push(bi("trips.invoiceSheet.noteRollsForward"));
  }

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
    totals: { rows: totalRows, vat: data.grand.vat, total: data.grand.total },
    amountDue,
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
      paidUpBalance: bi("trips.invoiceSheet.paidUpBalance"),
      remaining: bi("trips.invoiceSheet.remaining"),
      // UNFILLED templates — see the type. `fillBi` substitutes downstream.
      vatSplit: bi("trips.invoiceSheet.vatSplit"),
      chargesSubtotal: bi("trips.invoiceSheet.chargesSubtotal"),
      totalVat: bi("trips.invoiceSheet.totalVat"),
      grandTotal: bi("trips.invoiceSheet.grandTotal"),
      amountDue: bi("trips.invoiceSheet.amountDue"),
      noCharges: bi("trips.invoiceSheet.noCharges"),
      // SAR is a currency CODE, not a word — identical in both columns.
      currency: biRaw("SAR"),
      qrCaption: bi("trips.invoiceSheet.qrCaption"),
    },
  };
}
