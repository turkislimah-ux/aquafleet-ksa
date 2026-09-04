// Invoice assembly engine (Finance Commit 5a, spec §6/§7/§8/§10/§11 — v3
// cutover per finance-invoice-spec.md v3 §5/§9). Pure math, no I/O — mirrors
// lib/prepaid.ts / lib/vat.ts's discipline (pure functions, own test harness
// before the lifecycle actions / UI touch it).
//
// v3 CUTOVER: reuses the v3 engines exclusively —
//   - splitCoveredUnpaidItems (lib/prepaid.ts) for the prepaid covered/unpaid
//     split (ONE combined trips+charges FIFO queue, VAT-inclusive consumption)
//   - consumingItems (lib/prepaid.ts) for postpaid's plain delivered-trip list
//   - calculateVat (lib/vat.ts) for every document-level VAT figure
// No legacy (v2) consumption function is imported or called anywhere in this
// file — see lib/prepaid.ts's header for the retired-functions note.
//
// PERIOD-MEMBERSHIP RULE (the one subtle correctness point in this file):
// splitCoveredUnpaidItems/consumingItems are called over the customer's FULL
// trip/topup/charge history up to periodEnd, THEN the result is filtered
// down to items whose date falls within [periodStart, periodEnd] — never the
// other way around. The FIFO pool-drain order depends on every item ever
// consumed, not just this period's; pre-filtering to the period first would
// let an item "skip the queue" and appear falsely Covered by ignoring
// balance an earlier period's items already spent. lib/prepaid.ts's own
// header already established consumption depends only on
// trip_date/delivered_at/rate (or charge_date/amount), never on invoice
// linkage — this reuses that guarantee correctly. Callers MUST pass the
// customer's full trip/topup/charge history, not a period-prefiltered slice.
//
// THREE-TABLE / LEDGER MODEL (v3 §9, prepaid only — replaces the old
// two-table model):
//   Covered TRIPS table — trips only (never charges), already paid from
//     balance.
//   Unpaid TRIPS table  — trips only (never charges), over-balance trips
//     that rolled forward. NOT "Amount Due" anymore (v3 reverses that): this
//     table's own VAT-inclusive subtotal informs Amount Due (unpaid trips
//     only, see below) but Amount Due is no longer "whatever this table
//     contains" in the loose v2 sense — it's a dedicated, narrower figure.
//   Special Charges table — ALL of THIS invoice's charges (covered AND
//     uncovered), each tagged `covered: boolean`. Positioned below the
//     Unpaid trips table per §9. A covered charge counts toward Grand Total;
//     an uncovered one counts toward AMOUNT DUE (see below).
//     THE COMMENT THAT USED TO SIT HERE WAS FALSE AND IS RECORDED AS SUCH:
//     it said an uncovered charge "rolls forward (same 'unpaid rolls forward'
//     mechanism as trips)". It does not. It rolls forward only INSIDE the
//     FIFO pool — i.e. it keeps consuming balance — and it never reached a
//     billable document, because (a) Amount Due was trips-only and (b) every
//     charge is FK-bound to exactly one invoice at creation and hidden from
//     every other invoice by reservedElsewhereIds (see RESERVE-AT-DRAFT
//     EXCLUSION below, which is the paragraph that contradicted it). A charge
//     on a CONFIRMED invoice is frozen there, so an uncovered one was
//     unbillable forever while the balance engine had already deducted it.
//     Two live charges stranded that way (517.50 + 1,150.00) are what forced
//     this fix. Trips have TWO outlets (covered -> Grand Total, unpaid ->
//     Amount Due); charges now have the same two, instead of one outlet and a
//     dead end.
//   Each of Covered/Unpaid TRIPS tables ALSO gets a `ledger` entry — three
//   stacked figures (subtotal/balance/remaining), always present even at
//   zero, computed from the SAME splitCoveredUnpaidItems() walk (never
//   re-derived) so they can't disagree with coveredLines/unpaidLines.
//
// GRAND TOTAL = THE WHOLE INVOICE, AND covered + amountDue === grand ALWAYS.
// The money law, both payment modes, on subtotal AND VAT AND total:
//
//   grand     = ONE document-level VAT pass over EVERY line the invoice shows
//               — covered trips + unpaid trips + ALL special charges,
//               covered or not. Nothing on the document sits outside it.
//   amountDue = the collectible: unpaid trips + UNCOVERED charges, summed
//               per-item VAT-inclusive so it ties to the pool (see below).
//   covered   = grand − amountDue, component-wise. DERIVED, never its own VAT
//               pass — that is what makes the identity exact rather than
//               approximate, and it is the only arrangement where ZATCA's
//               document-level rounding of grand and the pool-exact per-item
//               rounding of amountDue both survive.
//
// v3 §9 SHIPPED THE REVERSE AND IT WAS A REAL BUG, measured on live data
// before this changed. Grand was built ONLY from what was settled (covered
// trips + covered charges), covered from covered TRIPS alone, amountDue from
// unpaid trips + uncovered charges — three sets that neither cover nor
// partition the invoice, so:
//
//   grand − (covered + amountDue) = coveredCharges − unpaidTrips − uncoveredCharges
//
// Nothing forced that to zero, and it was not zero on 8 of 24 invoices. The
// negative side cost money: 026-000014's grand total came out 32,844.00 SAR
// short of its own delivered work and 026-000007's 471.50 short, and since
// those trips stay invoice_id-reserved on a PAID invoice they were billable
// nowhere else — the dead end the stranded-charge note above describes,
// reached by the TRIPS half instead. 38,709.00 SAR across four invoices. The
// positive side (covered charges inside grand but missing from
// covered_subtotal) moved no cash but proved the fault was structural: one
// object, two behaviours, decided by nothing but which set it landed in.
//
// Do NOT re-narrow grand to "what is settled". The figure describing the
// settled portion is `covered`, which now genuinely holds it, charges included.
//
// AMOUNT DUE (v3 §9, NARROWED from v2; WIDENED AGAIN by the stranded-charge
// fix): = the Unpaid TRIPS table's own VAT-inclusive subtotal PLUS this
// invoice's UNCOVERED special charges, VAT-inclusive.
//
// IT USED TO BE TRIPS-ONLY ("never special charges"), AND THAT IS THE BUG THE
// SPECIAL-CHARGES NOTE ABOVE DESCRIBES: a charge the pool could not cover had
// nowhere to go — excluded from Grand Total by being uncovered, excluded from
// Amount Due by being a charge, and unable to appear on any later invoice.
// Adding it here is the whole of the structural fix; nothing else about the
// document changes.
//
// UNITS. Each uncovered charge contributes round2(amount_sar * (1 + VAT_RATE))
// — per item, rounded per item, then summed. That is BYTE-FOR-BYTE how
// lib/prepaid.ts computes ConsumedItem.consumedAmount, which is what the FIFO
// pool actually deducted, so Amount Due reconciles to the balance engine to
// the halala. It is deliberately NOT a calculateVat() document-level pass over
// the charges: that would round once against their combined subtotal and could
// land a halala away from what the pool spent.
//
// AMOUNT DUE IS NO LONGER `ledger.unpaid.subtotal`. It is
// `ledger.unpaid.subtotal + uncovered charges`. The ledger stays trips-only on
// purpose — it is the footer OF the Unpaid TRIPS table and must keep
// describing that table's own rows. So the two figures are now allowed to
// differ, and they differ by exactly the uncovered-charges total. Do not
// "restore" the old equality; it would re-strand the charges.
//
// FORWARD-LOOKING ONLY, AND THIS NEEDS NO MIGRATION. Draft/review invoices
// recompute live through this file on every open (see
// InvoiceDetailModal's status branch / previewInvoice); confirmed and paid
// invoices render from their frozen snapshot columns and are never re-derived.
// confirm_invoice() stores whatever total the app hands it, so widening the
// figure here changes NEW confirms only — no already-confirmed document is
// rewritten, which is the same "fix forward, never rewrite applied history"
// rule the migrations follow.
//
// THE THREE TOTALS RECONCILE EXACTLY, AND THAT IS ENFORCED, NOT HOPED FOR.
// This paragraph used to say the opposite — that each total was its own
// independently-rounded pass and they were "NOT required to reconcile to each
// other to the halala". That licence is what let a 32,844.00 SAR hole read as
// a rounding convention. Only TWO of the three are now computed: grand (one
// document-level pass, ZATCA) and amountDue (per-item, pool-exact). covered is
// their difference, so covered + amountDue === grand on all three figures by
// construction — the same reason postpaid has always reconciled (grand and
// amountDue are literally the same call there).
//
// The two rounding conventions still differ by up to a halala, as they always
// did; the difference now has a defined home (covered's VAT) instead of
// leaking into whether the invoice adds up. scripts/invoice-check.ts asserts
// the identity on EVERY case, both modes — see reconciles().
//
// POSTPAID — completely unchanged (per Step 3 instruction, do not touch):
// no balance/FIFO/coverage concept applies. coveredLines is always [],
// chargeLines is always [] (charges stay merged into unpaidLines, exactly as
// before — v3's separate Special Charges table is a prepaid-only concept),
// ledger is undefined, and amountDue/grand are numerically identical (same
// input line set: every delivered trip in the period + every special
// charge), exactly as before.
//
// RESERVE-AT-DRAFT EXCLUSION (Finance Commit 6, reserved != locked — see
// lib/db-types.ts Trip.invoice_id comment and migration 0030 header),
// GENERALIZED in v3 to cover special charges too (every special charge
// already belongs to exactly one invoice at creation — see
// app/trips/invoiceActions.ts's addSpecialCharge — so "reserved elsewhere"
// for a charge simply means "belongs to a different invoice than the one
// being assembled"): `reservedElsewhereIds` removes trips/charges already
// claimed by ANOTHER non-void invoice from THIS invoice's line-item output,
// so the same trip/charge can never appear on two invoices at once. Applied
// AFTER splitCoveredUnpaidItems/consumingItems run on the FULL history (see
// PERIOD-MEMBERSHIP RULE above) — a display/billing filter on the
// already-computed split, never a pre-filter on the input arrays. Excluding
// an item here does NOT change the FIFO pool math for every OTHER item in
// the split (a reserved-elsewhere item still consumed its share of balance
// when it was walked — this filter only hides it from THIS invoice's line
// items, it doesn't un-consume it).

import {
  splitCoveredUnpaidItems,
  consumingItems,
  returnedTotal,
  VAT_RATE,
  round2,
  type BalanceReturnLite,
  type ConsumingTrip,
  type ConsumingCharge,
  type ConsumedItem,
  type TopupLite,
} from "./prepaid";
import { calculateVat, type VatLineItem } from "./vat";
import type { InvoiceStatus } from "./db-types";

export type PaymentMode = "postpaid" | "prepaid";

// Special charges are editable ONLY while the invoice is Draft or Review —
// once Confirmed, the invoice is fully locked (charges are frozen in
// confirm_invoice()'s special_charges_snapshot; "no revert to draft after
// confirm" means there's no path back to an editable state). Pure/tested
// here so app/trips/invoiceActions.ts's add/removeSpecialCharge and any
// future 5c UI gating share ONE source of truth instead of two copies of
// the same status check drifting apart.
export function canEditSpecialCharges(status: InvoiceStatus): boolean {
  return status === "draft" || status === "review";
}

// Finance polish batch B: special charges now carry the invoice table's own
// shape (date/description/quantity/price/amount) instead of a bare
// label+amount. `label` stays the underlying field name (matches the DB
// column — no rename) but is presented as "description" in the UI, per the
// item 3 spec. `amount_sar` remains the ONE figure the VAT engine reads
// (chargesToVatItems below) — quantity/price_sar are display/input fields
// only, computed into amount_sar (= price * qty) by the caller BEFORE this
// engine ever sees it. This file's math boundary is unchanged: it still
// only ever sums amount_sar, never quantity * price itself.
export type SpecialChargeInput = {
  id: string;
  label: string;
  amount_sar: number; // pre-VAT, = price_sar * quantity (computed by caller)
  charge_date?: string | null;
  // v3: fallback source for charge_date when it's null (pre-batch-B rows
  // predate the column). Resolved here as charge_date ?? created_at's date
  // part — never re-derived anywhere else (mirrors ConsumingTrip.rate_sar's
  // "caller resolves, this file never re-derives" convention, just applied
  // to the one field that still needs a fallback).
  created_at?: string | null;
  quantity?: number | null; // defaults to 1 for pre-batch-B rows (see migration 0032)
  price_sar?: number | null; // defaults to amount_sar for pre-batch-B rows (no price on file)
  image_path?: string | null; // internal-only — never surfaced on customer-facing output
};

// A single displayable line — trip or special charge — with its own
// display-only per-line VAT (lib/vat.ts's lineVat convention: informative,
// never summed to produce a table/document total).
export type InvoiceLine = {
  id: string; // trip id, or special-charge id
  kind: "trip" | "charge";
  trip_date: string | null; // charge_date for charge lines (resolved, see SpecialChargeInput)
  description: string;
  amount_sar: number; // pre-VAT
  vat_sar: number; // display-only
  // Additive, display-only (Finance polish batch A). null for charge lines.
  // Never read by any total/VAT math above — passenger data for the
  // grouped-row/clickable-ref UI only.
  ref?: string | null;
  water_type?: "potable" | "non_potable" | null;
  // Additive, display-only (Finance polish batch B) — charge lines only.
  // quantity/price_sar are the INPUT fields the charge was entered with;
  // amount_sar above stays the one figure the VAT engine sums (= price_sar *
  // quantity, computed by the caller before this file ever sees it — see
  // SpecialChargeInput). image_path is an internal-only reference, never
  // read by any customer-facing render path (print/PDF/mailto).
  quantity?: number | null;
  price_sar?: number | null;
  image_path?: string | null;
  // v3, prepaid charge lines only: whether this charge's full VAT-inclusive
  // amount fit in the FIFO pool. undefined for trip lines (coveredLines vs
  // unpaidLines already encodes coverage for trips) and for postpaid charge
  // lines (no coverage concept applies — see POSTPAID note above).
  covered?: boolean;
};

export type InvoiceTableTotals = {
  subtotal: number; // pre-VAT
  vat: number; // document-level, rounded once against this table's subtotal
  total: number; // subtotal + vat
};

// v3 §9 — the stacked Subtotal/Balance/Remaining figures shown beneath a
// Covered or Unpaid TRIPS table. ALL THREE are VAT-inclusive (this is the
// one place in the invoice that shows a VAT-inclusive running figure outside
// document-level totals — it mirrors the balance ledger's own units, not the
// invoice's per-row pre-VAT convention). subtotal = the table's own items,
// summed VAT-inclusive (Σ consumedAmount, NOT calculateVat's document-level
// round-once pass — see file header, "Amount Due" note). balance = the pool
// available going into this table's items (the v3 FIFO walk, up to but not
// including this table's own items). remaining = balance − subtotal
// (negative on the Unpaid table when the pool falls short — expected).
export type InvoiceLedgerTotals = {
  subtotal: number;
  balance: number;
  remaining: number;
};

export type InvoiceAssembly = {
  customerId: string;
  periodStart: string;
  periodEnd: string;
  paymentMode: PaymentMode;

  coveredLines: InvoiceLine[]; // trips only, always [] for postpaid
  unpaidLines: InvoiceLine[]; // prepaid: trips only. postpaid: trips + charges (unchanged v2 shape — see POSTPAID note)
  // v3, prepaid only: ALL of this invoice's special charges (covered +
  // uncovered), each tagged `covered`. Always [] for postpaid — postpaid's
  // charges stay merged into unpaidLines exactly as before.
  chargeLines: InvoiceLine[];

  covered: InvoiceTableTotals; // trips only (pre-VAT covered-trips document total — feeds Grand Total)
  amountDue: InvoiceTableTotals; // v3 prepaid: unpaid TRIPS only. postpaid: unchanged (trips + charges)
  grand: InvoiceTableTotals; // v3 prepaid: covered trips + covered charges only. postpaid: unchanged (= amountDue)
  // v3, prepaid only: the stacked ledger figures for the Covered/Unpaid
  // trips tables. undefined for postpaid (no balance concept — see POSTPAID
  // note above).
  ledger?: { covered: InvoiceLedgerTotals; unpaid: InvoiceLedgerTotals };

  // Passthrough identity, not computed — caller resolves these; kept here so
  // 5b's confirm step and 5c's display/mailto have one assembled object to
  // read from instead of re-fetching seller/buyer/email separately.
  sellerSnapshot: unknown;
  buyerSnapshot: unknown;
  customerEmail: string | null;
};

export type AssembleInvoiceInput = {
  customerId: string;
  paymentMode: PaymentMode | null; // null = unset project.payment_mode — throws, see below
  periodStart: string; // inclusive, trip_date
  periodEnd: string; // inclusive, trip_date
  // ALL delivered trips for this customer/project, any date — NOT
  // pre-filtered to the period. See PERIOD-MEMBERSHIP RULE above. rate_sar must
  // already be RESOLVED BY THE CALLER, frozen-first: the trip's own
  // trips.rate_sar, with the project's current rate_per_trip_sar only as the
  // not-yet-delivered fallback (lib/prepaid.ts's ConsumingTrip note). An invoice
  // bills each trip at what it was worth on the day it was delivered, so a rate
  // change between delivery and invoicing cannot move an already-delivered line.
  trips: ConsumingTrip[];
  // ALL topups for this customer, any date. Ignored entirely for postpaid.
  topups: TopupLite[];
  // ALL recorded refunds of prepaid credit for this customer, any date (0142).
  // Prepaid only — a postpaid customer has no pool to refund from, so the
  // postpaid arm never reads it.
  //
  // A refund SHRINKS THE POOL, which moves the FIFO wall backwards: work that
  // the pool covered before the refund can fall into Unpaid after it. That is
  // the correct invoice, not a defect — the customer no longer holds the money
  // that was covering it. Defaulted to [] so the harness and any caller with no
  // refunds assemble byte-identically to before.
  //
  // It never becomes a LINE. lib/invoice.ts maps covered/unpaid ConsumedItems
  // straight into billable lines, and a refund is not a supply we can bill for;
  // it only ever changes where the covered/unpaid boundary sits.
  returns?: BalanceReturnLite[];
  // v3: for prepaid this must be the customer's FULL non-void-invoice charge
  // history (every charge on a draft/review/confirmed/paid invoice, any
  // invoice) — NOT just this invoice's own charges — so the FIFO walk sees
  // every consumer of the pool. See PERIOD-MEMBERSHIP RULE + lib/prepaid.ts's
  // "which invoices' charges consume" note. reservedElsewhereIds (below)
  // then narrows the DISPLAYED chargeLines down to this invoice's own.
  // For postpaid this can just be this invoice's own charges (no FIFO runs).
  specialCharges: SpecialChargeInput[];
  sellerSnapshot?: unknown;
  buyerSnapshot?: unknown;
  customerEmail?: string | null;
  // Trip AND charge ids claimed by ANOTHER non-void invoice — excluded from
  // this invoice's displayed line items. See the RESERVE-AT-DRAFT EXCLUSION
  // note above. Default empty (no exclusion) so existing callers/harness
  // cases are unaffected.
  reservedElsewhereIds?: Iterable<string>;
};

function toVatItems(entries: { id: string; trip_date: string; amount: number }[]): VatLineItem[] {
  return entries.map((e) => ({ id: e.id, description: `Trip ${e.trip_date}`, amount_sar: e.amount }));
}

function chargesToVatItems(charges: { id: string; label: string; amount_sar: number }[]): VatLineItem[] {
  return charges.map((c) => ({ id: c.id, description: c.label, amount_sar: c.amount_sar }));
}

function resolveChargeDate(c: SpecialChargeInput, fallback: string): string {
  return c.charge_date ?? (c.created_at ? c.created_at.slice(0, 10) : fallback);
}

export function assembleInvoice(input: AssembleInvoiceInput): InvoiceAssembly {
  const {
    customerId,
    paymentMode,
    periodStart,
    periodEnd,
    trips,
    topups,
    returns = [],
    specialCharges,
    sellerSnapshot = null,
    buyerSnapshot = null,
    customerEmail = null,
    reservedElsewhereIds,
  } = input;

  if (paymentMode == null) {
    throw new Error(
      "assembleInvoice: project.payment_mode is unset — cannot build an invoice until it's chosen.",
    );
  }

  const inPeriod = (d: string) => d >= periodStart && d <= periodEnd;
  const reservedElsewhere = new Set(reservedElsewhereIds ?? []);
  const notReservedElsewhere = (e: { id: string }) => !reservedElsewhere.has(e.id);

  const toTripLine = (e: ConsumedItem): InvoiceLine => ({
    id: e.id,
    kind: "trip",
    trip_date: e.trip_date,
    description: `Trip ${e.trip_date}`,
    amount_sar: e.amount,
    vat_sar: round2(e.amount * VAT_RATE),
    ref: e.ref ?? null,
    water_type: e.water_type ?? null,
  });

  if (paymentMode === "postpaid") {
    // --- UNCHANGED v2 shape (see POSTPAID note above) --------------------
    const unpaidTripEntries = consumingItems(trips, [], periodEnd)
      .filter((e): e is ConsumedItem & { kind: "trip" } => e.kind === "trip")
      .filter((e) => inPeriod(e.trip_date))
      .filter(notReservedElsewhere);
    // Charges are NOT period-filtered. Each charge is FK-bound to exactly one
    // invoice at creation, so notReservedElsewhere already scopes this to THIS
    // invoice's own charges. A charge_date filter here dropped charges that
    // v_customer_prepaid_balance had already consumed (no date filter there at
    // all) — see 0181. Trips stay period-filtered; they are not FK-claimed the
    // same way.
    const periodCharges = specialCharges.filter(notReservedElsewhere);

    const unpaidTripLines = unpaidTripEntries.map(toTripLine);
    const chargeLinesForUnpaid: InvoiceLine[] = periodCharges.map((c) => ({
      id: c.id,
      kind: "charge",
      trip_date: resolveChargeDate(c, periodEnd),
      description: c.label,
      amount_sar: round2(c.amount_sar),
      vat_sar: round2(c.amount_sar * VAT_RATE),
      quantity: c.quantity ?? 1,
      price_sar: c.price_sar ?? c.amount_sar,
      image_path: c.image_path ?? null,
    }));
    const unpaidLines = [...unpaidTripLines, ...chargeLinesForUnpaid];

    const unpaidItems = [...toVatItems(unpaidTripEntries), ...chargesToVatItems(periodCharges)];
    const amountDueVat = calculateVat(unpaidItems);
    const grandVat = calculateVat(unpaidItems); // covered is always [] for postpaid — same input set

    return {
      customerId,
      periodStart,
      periodEnd,
      paymentMode,
      coveredLines: [],
      unpaidLines,
      chargeLines: [],
      covered: { subtotal: 0, vat: 0, total: 0 },
      amountDue: { subtotal: amountDueVat.subtotal, vat: amountDueVat.vatAmount, total: amountDueVat.grandTotal },
      grand: { subtotal: grandVat.subtotal, vat: grandVat.vatAmount, total: grandVat.grandTotal },
      sellerSnapshot,
      buyerSnapshot,
      customerEmail,
    };
  }

  // --- Prepaid: v3 three-table model -------------------------------------
  const chargesForEngine: ConsumingCharge[] = specialCharges.map((c) => ({
    id: c.id,
    charge_date: resolveChargeDate(c, periodEnd),
    amount_sar: round2(c.amount_sar),
    label: c.label,
  }));

  // periodEnd scopes TRIP consumption only. consumingItems() no longer gates
  // charges by date, so a charge dated after periodEnd now reaches the FIFO
  // walk and can be covered like any other — it used to be displayed by
  // chargeLines below, deducted by v_customer_prepaid_balance, and refused
  // coverage here, all at once (026-000017).
  const split = splitCoveredUnpaidItems(topups, trips, chargesForEngine, periodEnd, returns);

  const coveredTripEntries = split.covered
    .filter((e): e is ConsumedItem & { kind: "trip" } => e.kind === "trip")
    .filter((e) => inPeriod(e.trip_date))
    .filter(notReservedElsewhere);
  const unpaidTripEntries = split.unpaid
    .filter((e): e is ConsumedItem & { kind: "trip" } => e.kind === "trip")
    .filter((e) => inPeriod(e.trip_date))
    .filter(notReservedElsewhere);
  const coveredChargeIds = new Set(split.covered.filter((e) => e.kind === "charge").map((e) => e.id));

  const coveredLines = coveredTripEntries.map(toTripLine);
  const unpaidLines = unpaidTripEntries.map(toTripLine);

  // Special Charges table: ALL of THIS invoice's charges (not reserved
  // elsewhere), covered+uncovered together, each tagged.
  //
  // NOT period-filtered — deliberately. Every charge is FK-bound to exactly one
  // invoice at creation, so notReservedElsewhere alone scopes this correctly,
  // while v_customer_prepaid_balance consumes EVERY charge on a non-void
  // invoice with no date filter whatsoever. A charge_date filter here made the
  // invoice omit charges the balance had already been deducted for (0181).
  //
  // 0181 removed the filter from THIS half only. The MATH half kept it one
  // level down, inside consumingItems(), so the disagreement survived in the
  // shape that mattered more: the charge was listed here and refused coverage
  // there. Both halves are ungated now — see splitCoveredUnpaidItems above.
  const chargeLines: InvoiceLine[] = specialCharges
    .filter(notReservedElsewhere)
    .map((c) => ({
      id: c.id,
      kind: "charge",
      trip_date: resolveChargeDate(c, periodEnd),
      description: c.label,
      amount_sar: round2(c.amount_sar),
      vat_sar: round2(c.amount_sar * VAT_RATE),
      quantity: c.quantity ?? 1,
      price_sar: c.price_sar ?? c.amount_sar,
      image_path: c.image_path ?? null,
      covered: coveredChargeIds.has(c.id),
    }));

  // ---- Ledger (v3 §9): Subtotal/Balance/Remaining, both trips tables ----
  // Balance entering the Covered table = pool value immediately before the
  // first line THIS invoice actually shows, walked through the GLOBAL
  // covered order (full customer history, not just this period — see
  // PERIOD-MEMBERSHIP RULE). Balance entering the Unpaid table is simply the
  // split's frozen remainingBalance: once the FIFO wall is hit the pool
  // never moves again, so every unpaid item (this invoice's or another's)
  // shares that same entering value.
  // MUST match splitCoveredUnpaidItems' own starting pool exactly, because the
  // walk below re-derives the entering balance from it. Refunds net out here
  // for that reason and no other — same summation helper (returnedTotal,
  // imported rather than restated), same rounding.
  //
  // NEITHER side is cut at periodEnd, matching the engine's lifetime net pool
  // (Turki, locked — see splitCoveredUnpaidItems). This line previously
  // restated both a `topup_date <= periodEnd` filter and a periodEnd-gated
  // returnedTotal; the two sites have to move together or the entering-balance
  // walk would start from a different number than the split it is walking.
  const startingPool = round2(round2(topups.reduce((s, t) => s + t.amount_sar, 0)) - returnedTotal(returns));
  const coveredLineIds = new Set(coveredTripEntries.map((e) => e.id));
  let poolWalk = startingPool;
  let coveredBalance = poolWalk;
  let foundFirstCoveredLine = false;
  for (const item of split.covered) {
    if (!foundFirstCoveredLine && coveredLineIds.has(item.id)) {
      coveredBalance = poolWalk;
      foundFirstCoveredLine = true;
    }
    poolWalk = round2(poolWalk - item.consumedAmount);
  }
  if (!foundFirstCoveredLine) coveredBalance = poolWalk; // no covered lines this invoice — always-shown-at-zero case

  const coveredLedgerSubtotal = round2(coveredTripEntries.reduce((s, e) => s + e.consumedAmount, 0));
  const unpaidLedgerSubtotal = round2(unpaidTripEntries.reduce((s, e) => s + e.consumedAmount, 0));
  const unpaidBalance = split.remainingBalance;

  const ledger = {
    covered: {
      subtotal: coveredLedgerSubtotal,
      balance: coveredBalance,
      remaining: round2(coveredBalance - coveredLedgerSubtotal),
    },
    unpaid: {
      subtotal: unpaidLedgerSubtotal,
      balance: unpaidBalance,
      remaining: round2(unpaidBalance - unpaidLedgerSubtotal),
    },
  };

  // ---- covered / amountDue / grand (InvoiceTableTotals) ----
  // ORDER OF DERIVATION IS THE WHOLE RULE (see the GRAND TOTAL header note):
  // grand is computed FIRST, from every line; amountDue keeps its own
  // pool-exact rule; covered is what is left. covered is therefore never
  // computed from its own line set — deriving it was how covered charges went
  // missing from covered_subtotal while sitting inside grand.
  const coveredTripVatItems = toVatItems(coveredTripEntries);

  // Amount Due = unpaid TRIPS + UNCOVERED special charges, VAT-inclusive.
  // The trips half is still taken verbatim from ledger.unpaid.subtotal (never
  // independently rounded); the charges half is summed per-item at
  // round2(amount * 1.15), which is exactly ConsumedItem.consumedAmount — see
  // the AMOUNT DUE note in the file header for why both halves are built this
  // way and why this figure is no longer equal to ledger.unpaid.subtotal.
  //
  // `covered !== true` rather than `covered === false`: covered is optional on
  // InvoiceLine and undefined for postpaid/trip lines. It is always set on the
  // prepaid charge lines built above, so the two are equivalent here — the
  // stricter form is written to survive a future line that omits the flag,
  // because an unflagged charge belongs in Amount Due (billable), never
  // silently in Grand Total (settled).
  const uncoveredChargeLines = chargeLines.filter((l) => l.covered !== true);
  const uncoveredChargePreVat = round2(uncoveredChargeLines.reduce((s, l) => s + l.amount_sar, 0));
  const uncoveredChargeInclVat = round2(
    uncoveredChargeLines.reduce((s, l) => s + round2(l.amount_sar * (1 + VAT_RATE)), 0),
  );

  const unpaidTripPreVat = round2(unpaidTripEntries.reduce((s, e) => s + e.amount, 0));
  const amountDueSubtotal = round2(unpaidTripPreVat + uncoveredChargePreVat);
  const amountDueTotal = round2(unpaidLedgerSubtotal + uncoveredChargeInclVat);
  const amountDue: InvoiceTableTotals = {
    subtotal: amountDueSubtotal,
    vat: round2(amountDueTotal - amountDueSubtotal),
    total: amountDueTotal,
  };

  // GRAND TOTAL = the whole invoice. EVERY line this document shows: covered
  // trips + unpaid trips + every special charge, covered or not. ONE
  // document-level calculateVat() pass, so the printed VAT is rounded once
  // against the full taxable base exactly as ZATCA requires (lib/vat.ts).
  const grandVat = calculateVat([
    ...coveredTripVatItems,
    ...toVatItems(unpaidTripEntries),
    ...chargesToVatItems(chargeLines.map((l) => ({ id: l.id, label: l.description, amount_sar: l.amount_sar }))),
  ]);
  const grand: InvoiceTableTotals = {
    subtotal: grandVat.subtotal,
    vat: grandVat.vatAmount,
    total: grandVat.grandTotal,
  };

  // COVERED = GRAND − AMOUNT DUE, component-wise. Not its own VAT pass, on
  // purpose: subtraction is what makes covered + amountDue === grand hold on
  // all three figures identically rather than approximately, and it is the
  // only arrangement in which BOTH the ZATCA document-level rounding of grand
  // AND the pool-exact per-item rounding of amountDue survive. The <= 0.01
  // residue between the two conventions lands here, in the already-SETTLED
  // figure, where it settles nothing — never in the collectible.
  //
  // The subtotals are exact sums either way (no rounding to disagree about),
  // so this only ever moves a halala of VAT.
  const covered: InvoiceTableTotals = {
    subtotal: round2(grand.subtotal - amountDue.subtotal),
    vat: round2(grand.vat - amountDue.vat),
    total: round2(grand.total - amountDue.total),
  };

  return {
    customerId,
    periodStart,
    periodEnd,
    paymentMode,
    coveredLines,
    unpaidLines,
    chargeLines,
    covered,
    amountDue,
    grand,
    ledger,
    sellerSnapshot,
    buyerSnapshot,
    customerEmail,
  };
}
