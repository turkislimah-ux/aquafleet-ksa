// Invoice assembly engine (Finance Commit 5a, spec §6/§7/§8/§10/§11). Pure
// math, no I/O — mirrors lib/prepaid.ts / lib/vat.ts's discipline (pure
// functions, own test harness before the lifecycle actions / UI touch it).
//
// Builds the Covered table + Unpaid table + Grand Total + Amount Due for a
// customer/project over a billing period, reusing the two already-built
// engines rather than re-deriving anything:
//   - splitCoveredUnpaid (lib/prepaid.ts) for the prepaid covered/unpaid split
//   - calculateVat (lib/vat.ts) for every VAT figure, document-level
//
// PERIOD-MEMBERSHIP RULE (the one subtle correctness point in this file):
// splitCoveredUnpaid/consumingTrips are called over the customer's FULL
// trip/topup history up to periodEnd, THEN the result is filtered down to
// trip_date within [periodStart, periodEnd] — never the other way around.
// The FIFO pool-drain order depends on every trip ever consumed, not just
// this period's; pre-filtering to the period first would let a trip "skip
// the queue" and appear falsely Covered by ignoring balance an earlier
// period's trips already spent. lib/prepaid.ts's own header already
// established consumption depends only on trip_date/delivered_at/rate,
// never on invoice linkage — this reuses that guarantee correctly. Callers
// MUST pass the customer's full trip/topup history, not a period-prefiltered
// slice.
//
// TWO-TABLE / THREE-TOTALS MODEL (locked decision):
//   Covered table  = already-paid-from-balance trips (prepaid only), shown
//                     WITH their own VAT for record/ZATCA completeness.
//   Unpaid table   = collectible trips (prepaid: over-balance trips;
//                     postpaid: every trip) + special charges — this table
//                     IS "Amount Due": what the customer still owes.
//   Grand Total    = full period value = Covered + Unpaid combined.
// Each of the three totals (covered / amountDue / grand) is its OWN
// independent calculateVat() call — its own document-level subtotal-then-
// round-once pass over its own line set. They are NOT required to
// reconcile to each other (covered.total + amountDue.total can legitimately
// differ from grand.total by a halala) — this is the exact same
// "document-level, not summed" principle Commit 4 already locked in and
// proved with a harness; three independent document-level roundings don't
// magically become additive just because they're presented side by side.
// The harness proves this divergence is expected, not a bug.
//
// Postpaid projects never call splitCoveredUnpaid at all: coveredLines is
// always [], every delivered trip in the period is an Unpaid/collectible
// line, and amountDue/grand end up numerically identical (same input line
// set) — not "close", exactly equal, since they're the same calculateVat
// call in that case.
//
// RESERVE-AT-DRAFT EXCLUSION (Finance Commit 6, reserved != locked — see
// lib/db-types.ts Trip.invoice_id comment and migration 0030 header):
// `reservedElsewhereTripIds` removes trips already reserved by ANOTHER
// non-void invoice from the billable output, so the same trip can never
// appear on two invoices at once. This filter is applied AFTER
// splitCoveredUnpaid/consumingTrips run on the FULL trip history (see
// PERIOD-MEMBERSHIP RULE above) — it is a display/billing filter on the
// already-computed split, never a pre-filter on the input trips array.
// Excluding a trip here does NOT change the FIFO pool math for every OTHER
// trip in the split (a reserved-elsewhere trip still consumed its share of
// balance when it was walked by splitCoveredUnpaid — this filter only hides
// it from THIS invoice's line items, it doesn't un-consume it).

import { consumingTrips, splitCoveredUnpaid, type ConsumingTrip, type ConsumptionEntry, type TopupLite } from "./prepaid";
import { calculateVat, type VatLineItem, type VatLinePreview } from "./vat";
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
  trip_date: string | null; // null for charge lines
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
};

export type InvoiceTableTotals = {
  subtotal: number; // pre-VAT
  vat: number; // document-level, rounded once against this table's subtotal
  total: number; // subtotal + vat
};

export type InvoiceAssembly = {
  customerId: string;
  periodStart: string;
  periodEnd: string;
  paymentMode: PaymentMode;

  coveredLines: InvoiceLine[]; // always [] for postpaid
  unpaidLines: InvoiceLine[]; // trips + special charges — this IS the Amount Due table

  covered: InvoiceTableTotals;
  amountDue: InvoiceTableTotals; // = unpaidLines' totals
  grand: InvoiceTableTotals; // covered + unpaid combined, independently rounded

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
  // pre-filtered to the period. See PERIOD-MEMBERSHIP RULE above. rate_sar
  // must already be resolved to the project's rate_per_trip_sar (same
  // convention as lib/prepaid.ts's ConsumingTrip — never trips.rate_sar).
  trips: ConsumingTrip[];
  // ALL topups for this customer, any date. Ignored entirely for postpaid.
  topups: TopupLite[];
  specialCharges: SpecialChargeInput[];
  sellerSnapshot?: unknown;
  buyerSnapshot?: unknown;
  customerEmail?: string | null;
  // Trip ids reserved by ANOTHER non-void invoice — excluded from this
  // invoice's output. See the RESERVE-AT-DRAFT EXCLUSION note above. Default
  // empty (no exclusion) so existing callers/harness cases are unaffected.
  reservedElsewhereTripIds?: Iterable<string>;
};

function toVatItems(entries: { id: string; trip_date: string; amount: number }[]): VatLineItem[] {
  return entries.map((e) => ({ id: e.id, description: `Trip ${e.trip_date}`, amount_sar: e.amount }));
}

function chargesToVatItems(charges: SpecialChargeInput[]): VatLineItem[] {
  return charges.map((c) => ({ id: c.id, description: c.label, amount_sar: c.amount_sar }));
}

type TripPassenger = { trip_date: string; ref?: string | null; water_type?: "potable" | "non_potable" | null };

// Unified per-line extra-info shape (Finance polish batch B) — trip lines
// populate trip_date/ref/water_type, charge lines populate trip_date (from
// charge_date — reuses the same display field, see below)/quantity/
// price_sar/image_path. One map covers both since trip ids and charge ids
// never collide (distinct id spaces).
type LineExtra = {
  trip_date?: string | null;
  ref?: string | null;
  water_type?: "potable" | "non_potable" | null;
  quantity?: number | null;
  price_sar?: number | null;
  image_path?: string | null;
};

function toLine(v: VatLinePreview, kind: "trip" | "charge", infoById: Map<string, LineExtra>): InvoiceLine {
  const info = infoById.get(v.id);
  return {
    id: v.id,
    kind,
    trip_date: info?.trip_date ?? null,
    description: v.description ?? "",
    amount_sar: v.amount_sar,
    vat_sar: v.lineVat,
    ref: info?.ref ?? null,
    water_type: info?.water_type ?? null,
    // Charges: quantity/price_sar default to 1/amount_sar for a pre-batch-B
    // row that has neither on file (see migration 0032 header). Trips never
    // carry these — left undefined, same as before.
    quantity: kind === "charge" ? info?.quantity ?? 1 : undefined,
    price_sar: kind === "charge" ? info?.price_sar ?? v.amount_sar : undefined,
    image_path: kind === "charge" ? info?.image_path ?? null : undefined,
  };
}

export function assembleInvoice(input: AssembleInvoiceInput): InvoiceAssembly {
  const {
    customerId,
    paymentMode,
    periodStart,
    periodEnd,
    trips,
    topups,
    specialCharges,
    sellerSnapshot = null,
    buyerSnapshot = null,
    customerEmail = null,
    reservedElsewhereTripIds,
  } = input;

  if (paymentMode == null) {
    throw new Error(
      "assembleInvoice: project.payment_mode is unset — cannot build an invoice until it's chosen.",
    );
  }

  const inPeriod = (d: string) => d >= periodStart && d <= periodEnd;
  const reservedElsewhere = new Set(reservedElsewhereTripIds ?? []);
  const notReservedElsewhere = (e: { id: string }) => !reservedElsewhere.has(e.id);

  let coveredEntries: ConsumptionEntry[] = [];
  let unpaidTripEntries: ConsumptionEntry[] = [];

  if (paymentMode === "prepaid") {
    const split = splitCoveredUnpaid(topups, trips, periodEnd);
    coveredEntries = split.covered.filter((e) => inPeriod(e.trip_date)).filter(notReservedElsewhere);
    unpaidTripEntries = split.unpaid.filter((e) => inPeriod(e.trip_date)).filter(notReservedElsewhere);
  } else {
    unpaidTripEntries = consumingTrips(trips, periodEnd).filter((e) => inPeriod(e.trip_date)).filter(notReservedElsewhere);
  }

  const toPassenger = (e: ConsumptionEntry): TripPassenger => ({
    trip_date: e.trip_date,
    ref: e.ref,
    water_type: e.water_type,
  });
  const coveredTripInfoById = new Map<string, LineExtra>(coveredEntries.map((e) => [e.id, toPassenger(e)]));
  const unpaidTripInfoById = new Map<string, LineExtra>(unpaidTripEntries.map((e) => [e.id, toPassenger(e)]));
  // Charges never appear in the Covered table (they aren't trips) — only
  // merged into the Unpaid/Amount Due info map.
  const chargeInfoById = new Map<string, LineExtra>(
    specialCharges.map((c) => [
      c.id,
      {
        trip_date: c.charge_date ?? null,
        quantity: c.quantity ?? 1,
        price_sar: c.price_sar ?? c.amount_sar,
        image_path: c.image_path ?? null,
      },
    ]),
  );
  const unpaidInfoById = new Map<string, LineExtra>([...unpaidTripInfoById, ...chargeInfoById]);

  const coveredItems = toVatItems(coveredEntries);
  const chargeItems = chargesToVatItems(specialCharges);
  const unpaidItems = [...toVatItems(unpaidTripEntries), ...chargeItems];

  const coveredVat = calculateVat(coveredItems);
  const amountDueVat = calculateVat(unpaidItems); // = the Unpaid table's own totals
  const grandVat = calculateVat([...coveredItems, ...unpaidItems]);

  const coveredLines = coveredVat.lines.map((l) => toLine(l, "trip", coveredTripInfoById));
  const unpaidLines = amountDueVat.lines.map((l) =>
    toLine(l, unpaidTripInfoById.has(l.id) ? "trip" : "charge", unpaidInfoById),
  );

  return {
    customerId,
    periodStart,
    periodEnd,
    paymentMode,
    coveredLines,
    unpaidLines,
    covered: { subtotal: coveredVat.subtotal, vat: coveredVat.vatAmount, total: coveredVat.grandTotal },
    amountDue: { subtotal: amountDueVat.subtotal, vat: amountDueVat.vatAmount, total: amountDueVat.grandTotal },
    grand: { subtotal: grandVat.subtotal, vat: grandVat.vatAmount, total: grandVat.grandTotal },
    sellerSnapshot,
    buyerSnapshot,
    customerEmail,
  };
}
