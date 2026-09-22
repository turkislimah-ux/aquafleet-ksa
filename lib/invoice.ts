// Invoice assembly engine (Finance Commit 5a, spec §6/§7/§8/§10/§11). Pure
// math, no I/O — mirrors lib/money.ts / lib/vat.ts's discipline (pure
// functions, own test harness before the lifecycle actions / UI touch it).
//
// ===========================================================================
// LEDGER ERA (0203) — READ THIS BEFORE THE REST OF THIS HEADER
// ===========================================================================
// THIS FILE NO LONGER SPLITS A PREPAID INVOICE INTO COVERED AND UNPAID, and
// the several hundred lines below describing how it did are kept because the
// documents they produced are still on the books and still render — NOT
// because anything here still computes them.
//
// What changed: the prepaid draw is a LEDGER fact, decided by
// confirm_invoice() server-side at the moment of confirm —
// `draw = min(max(Available,0), grand_total)`, frozen onto
// invoices.prepaid_applied_sar / amount_payable_sar. Nothing app-side computes
// it, so nothing app-side may present a per-LINE coverage verdict either. A
// FIFO walk here would be a second, competing opinion about the same money,
// arrived at from a slice of history the document happens to see — which is
// the exact class of bug the running-balance removal already settled once.
//
// So BOTH arms of this function now have the same shape: every delivered trip
// in the period, every charge FK-bound to this invoice, ONE document-level VAT
// pass, `covered` zeros, `amountDue === grand`, no `tripTotals`. The prepaid
// arm keeps its separate `chargeLines` array (the prepaid document has always
// printed a Special Charges section and that structure stays), and that is now
// the ONLY structural difference between the two.
//
// `covered` and `amountDue` are NOT deleted from InvoiceAssembly: confirm_invoice
// still takes the covered/due/grand triple and still asserts covered + due ===
// grand (TIER B), so the zeros are load-bearing, not vestigial. Frozen rows
// carrying real covered figures render AS ISSUED — see the VM's `era` flag.
//
// The `covered` flag on a charge line is likewise not set any more. A ledger-era
// invoice bills every charge it lists; nothing rolls forward. Frozen rows keep
// their flags and keep printing their pills.
// ===========================================================================
//
// ENGINES: consumingItems (lib/money.ts) for the delivered-trip list, and
// calculateVat (lib/vat.ts) for every document-level VAT figure. The FIFO
// coverage walk (splitCoveredUnpaidItems) is GONE with lib/prepaid.ts (0206
// Group B) — the 29 invoices frozen under it render from their stored columns
// (freeze law 0027) and are never re-derived, so nothing needs it to run.
//
// PERIOD-MEMBERSHIP RULE (the one subtle correctness point in this file):
// splitCoveredUnpaidItems/consumingItems are called over the customer's FULL
// trip/topup/charge history up to periodEnd, THEN the result is filtered
// down to items whose date falls within [periodStart, periodEnd] — never the
// other way around. The FIFO pool-drain order depends on every item ever
// consumed, not just this period's; pre-filtering to the period first would
// let an item "skip the queue" and appear falsely Covered by ignoring
// balance an earlier period's items already spent. lib/money.ts's own
// header already established consumption depends only on
// trip_date/delivered_at/rate (or charge_date/amount), never on invoice
// linkage — this reuses that guarantee correctly. Callers MUST pass the
// customer's full trip/topup/charge history, not a period-prefiltered slice.
//
// ── FROM HERE TO THE IMPORTS: THE SUPERSEDED (PRE-0203) PREPAID LAW ────────
// Every paragraph below describes what this file did BEFORE the ledger era and
// is retained for the invoices frozen under it, which render as issued and are
// never re-derived (freeze law 0027). None of it runs.
//
// THREE-TABLE / LEDGER MODEL (v3 §9, prepaid only — replaced the old
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
// Nothing forced that to zero, and it was not zero on 8 of 24 invoices.
//
// SCOPE, BECAUSE LOSING IT MAKES THIS NOTE READ AS STALE WHEN IT IS NOT: 24 is
// the ISSUED, NON-POSTPAID set. Postpaid stores covered = 0 and amountDue =
// grand, so its residual is zero by construction; drafts and reviews carry no
// frozen columns at all. Count all 36 invoice rows, or all 25 issued, and the
// figures below stop reproducing — which is exactly how this note got re-raised
// as stale once already. Re-measure on the right axis:
//
//   select count(*) filter (where grand_total_sar
//            - (covered_total_sar + amount_due_sar) <> 0) as nonzero, count(*)
//   from invoices
//   where invoice_number is not null and payment_mode is distinct from 'postpaid';
//
// THE 8 CANNOT GROW — these are frozen snapshot columns on issued invoices and
// the law that produced them is gone, so no new invoice joins the set. Only the
// denominator moves.
//
// The negative side cost money: 38,709.00 SAR across FOUR invoices, and the
// split matters because the two halves arrive by different routes. THREE are
// the TRIPS half, 37,559.00 together — 026-000014's grand total came out
// 32,844.00 SAR short of its own delivered work, 026-000009's 4,243.50 short
// and 026-000007's 471.50 short. For 026-000014 and 026-000007, which are PAID,
// those trips stay invoice_id-reserved and were billable nowhere else — the
// dead end the stranded-charge note above describes, reached by the TRIPS half
// instead. 026-000009 is CONFIRMED, not paid; do not describe it as a paid
// invoice. The FOURTH, 026-000017 at 1,150.00, is the CHARGES half: the second
// of the two charges stranded above, reaching the same dead end from the other
// side. 37,559.00 + 1,150.00 = 38,709.00.
//
// Re-deriving 026-000009 through the identity above yields 4,761.00, not
// 4,243.50, and that is NOT a discrepancy: its snapshot froze BEFORE Amount Due
// widened to carry uncovered charges, so its stored due omits its own 517.50 —
// one of the two stranded charges named above. One document, two laws. Every
// other invoice in the set re-derives to its stored residual exactly.
//
// The positive side — 48,875.00 across the other four, covered charges inside
// grand but missing from covered_subtotal — moved no cash but proved the fault
// was structural: one object, two behaviours, decided by nothing but which set
// it landed in.
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
// lib/money.ts computes ConsumedItem.consumedAmount, which is what the FIFO
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
// leaking into whether the invoice adds up. scripts/invoice-flow-check.ts §B
// (ASSEMBLY LAWS) asserts the identity on EVERY case, both modes — see its
// reconciles().
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

import { consumingItems, VAT_RATE, round2, type ConsumingTrip, type ConsumedItem } from "./money";
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

// The VAT-inclusive foot of each prepaid TRIPS table — Covered and Unpaid.
// Σ consumedAmount over that table's own items, NOT calculateVat's
// document-level round-once pass (see file header, "Amount Due" note). This is
// the one place in the invoice that shows a VAT-inclusive figure outside the
// document totals, because it mirrors the balance ledger's units rather than
// the invoice's per-row pre-VAT convention.
//
// A `balance` and a `remaining` stood beside these two subtotals until the
// running-balance redesign, forming the "ledger" this type was named for:
// `balance` walked the GLOBAL FIFO pool up to each table's first line and
// `remaining` was balance − subtotal. THE WALK IS GONE, deliberately and
// entirely. A per-invoice chained pool figure is a running balance computed by
// a document that has no business computing one — it re-derived a customer-wide
// ledger from whichever slice of history a single invoice happened to see, and
// so contradicted the statement, the Finance row and the next invoice in the
// same breath. The invoice now prints a PAID-UP BALANCE instead — summed from
// customer_ledger as of the freeze instant by loadPaidUpBalance()
// (app/trips/invoiceActions.ts), which is a property of the CUSTOMER at an
// instant, not of the document. The running balance has exactly one home: the
// statement (Plan A) and the Finance row that mirrors it.
//
// Do not reintroduce a balance term here. This type having exactly two fields
// is the guard, and scripts/invoice-render-parity-check.ts asserts no renderer
// prints one off a table foot.
export type InvoiceTripTableTotals = {
  covered: number;
  unpaid: number;
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

  // THE THREE DOCUMENT TOTALS. Only TWO are computed — see the GRAND TOTAL
  // header note above, and the derivation at `const grandVat` below. All three
  // one-liners here described the PRE-1754140 law until 2026-09-05; the law
  // they described is the one that let `covered + amountDue` differ from
  // `grand`.
  /** grand − amountDue, component-wise. DERIVED LAST, never its own VAT pass. */
  covered: InvoiceTableTotals;
  /** The collectible: unpaid trips + UNCOVERED charges, per-item and pool-exact. */
  amountDue: InvoiceTableTotals;
  /** ONE document-level VAT pass over EVERY line shown (covered trips + unpaid trips + ALL charges). Postpaid: same call as amountDue, so identical. */
  grand: InvoiceTableTotals;
  // Prepaid only: the VAT-inclusive foot of each trips table. undefined for
  // postpaid, whose tables foot with a plain document-level total instead.
  tripTotals?: InvoiceTripTableTotals;

  // Passthrough identity, not computed — caller resolves these; kept here so
  // 5b's confirm step and 5c's display/mailto have one assembled object to
  // read from instead of re-fetching seller/buyer/email separately.
  sellerSnapshot: unknown;
  buyerSnapshot: unknown;
  customerEmail: string | null;
};

export type AssembleInvoiceInput = {
  customerId: string;
  paymentMode: PaymentMode | null; // null = unset customer payment_mode — throws, see below
  periodStart: string; // inclusive, trip_date
  periodEnd: string; // inclusive, trip_date
  // ALL delivered trips for this customer/project, any date — NOT
  // pre-filtered to the period. See PERIOD-MEMBERSHIP RULE above. rate_sar must
  // already be RESOLVED BY THE CALLER, frozen-first: the trip's own
  // trips.rate_sar, with the project's current rate_per_trip_sar only as the
  // not-yet-delivered fallback (lib/money.ts's ConsumingTrip note). An invoice
  // bills each trip at what it was worth on the day it was delivered, so a rate
  // change between delivery and invoicing cannot move an already-delivered line.
  trips: ConsumingTrip[];
  // `topups` and `returns` are GONE (0206 Group B). They fed the FIFO coverage
  // walk, which stopped running here at 0203 — the draw is a ledger fact
  // decided at settlement — and the two fields sat accepted-and-ignored until
  // this cleanup removed them from the type. An invoice is assembled from
  // WORK, not from money held on account.
  // v3: for prepaid this must be the customer's FULL non-void-invoice charge
  // history (every charge on a draft/review/confirmed/paid invoice, any
  // invoice) — NOT just this invoice's own charges — so the FIFO walk sees
  // every consumer of the pool. See PERIOD-MEMBERSHIP RULE + lib/money.ts's
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
    specialCharges,
    sellerSnapshot = null,
    buyerSnapshot = null,
    customerEmail = null,
    reservedElsewhereIds,
  } = input;

  if (paymentMode == null) {
    throw new Error(
      "assembleInvoice: the customer's payment_mode is unset — cannot build an invoice until it's chosen.",
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

  // --- Prepaid, LEDGER ERA (0203) ----------------------------------------
  // Same shape as the postpaid arm above: every delivered trip in the period,
  // every charge FK-bound to this invoice, ONE document-level VAT pass. NO
  // coverage walk — `min(Available, grand_total)` is drawn by confirm_invoice()
  // and frozen onto invoices.prepaid_applied_sar, so no per-LINE verdict exists
  // to compute here any more.
  //
  // The ONE structural difference that survives: the prepaid document keeps its
  // charges in a SEPARATE `chargeLines` array (its own Special Charges table),
  // where postpaid merges them into unpaidLines. That is layout, not money.
  const unpaidTripEntries = consumingItems(trips, [], periodEnd)
    .filter((e): e is ConsumedItem & { kind: "trip" } => e.kind === "trip")
    .filter((e) => inPeriod(e.trip_date))
    .filter(notReservedElsewhere);

  const coveredLines: InvoiceLine[] = [];
  const unpaidLines = unpaidTripEntries.map(toTripLine);

  // Special Charges table: ALL of THIS invoice's charges (not reserved
  // elsewhere).
  //
  // NOT period-filtered — deliberately, and unchanged from both old arms. Every
  // charge is FK-bound to exactly one invoice at creation, so
  // notReservedElsewhere alone scopes this correctly. A charge_date filter here
  // made the invoice omit charges the balance had already been deducted for
  // (0181).
  //
  // No `covered` flag: every charge on a ledger-era invoice is BILLED on it.
  const ownCharges = specialCharges.filter(notReservedElsewhere);
  const chargeLines: InvoiceLine[] = ownCharges.map((c) => ({
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

  // ---- covered / amountDue / grand (InvoiceTableTotals) ----
  // ONE document-level calculateVat() pass over every line this document shows
  // — trips + every special charge — so the printed VAT is rounded once against
  // the full taxable base exactly as ZATCA requires (lib/vat.ts). Identical
  // treatment to the postpaid arm.
  //
  // covered is ZERO and amountDue === grand. The whole invoice is billable; the
  // prepaid draw against it happens AFTER this, in confirm_invoice(), and shows
  // on the document as the frozen `prepaid_applied_sar` / `amount_payable_sar`
  // pair — not as a per-line split. These two fields are NOT vestigial:
  // confirm_invoice still takes the covered/due/grand triple and still asserts
  // covered + due === grand on all three components (TIER B, 0191), so the
  // zeros are load-bearing and must keep being sent.
  const docVat = calculateVat([
    ...toVatItems(unpaidTripEntries),
    ...chargesToVatItems(ownCharges),
  ]);

  const covered: InvoiceTableTotals = { subtotal: 0, vat: 0, total: 0 };
  // Two separate literals, never one shared reference — a caller that mutated
  // one would otherwise silently move the other.
  const amountDue: InvoiceTableTotals = {
    subtotal: docVat.subtotal,
    vat: docVat.vatAmount,
    total: docVat.grandTotal,
  };
  const grand: InvoiceTableTotals = {
    subtotal: docVat.subtotal,
    vat: docVat.vatAmount,
    total: docVat.grandTotal,
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
    // NO tripTotals. The prepaid document has one trips table now, and it foots
    // with the document-level total like postpaid's does.
    sellerSnapshot,
    buyerSnapshot,
    customerEmail,
  };
}
