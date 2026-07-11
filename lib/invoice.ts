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

import { consumingTrips, splitCoveredUnpaid, type ConsumingTrip, type TopupLite } from "./prepaid";
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

export type SpecialChargeInput = {
  id: string;
  label: string;
  amount_sar: number; // pre-VAT
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
};

function toVatItems(entries: { id: string; trip_date: string; amount: number }[]): VatLineItem[] {
  return entries.map((e) => ({ id: e.id, description: `Trip ${e.trip_date}`, amount_sar: e.amount }));
}

function chargesToVatItems(charges: SpecialChargeInput[]): VatLineItem[] {
  return charges.map((c) => ({ id: c.id, description: c.label, amount_sar: c.amount_sar }));
}

function toLine(
  v: VatLinePreview,
  kind: "trip" | "charge",
  tripDateById: Map<string, string>,
): InvoiceLine {
  return {
    id: v.id,
    kind,
    trip_date: tripDateById.get(v.id) ?? null,
    description: v.description ?? "",
    amount_sar: v.amount_sar,
    vat_sar: v.lineVat,
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
  } = input;

  if (paymentMode == null) {
    throw new Error(
      "assembleInvoice: project.payment_mode is unset — cannot build an invoice until it's chosen.",
    );
  }

  const inPeriod = (d: string) => d >= periodStart && d <= periodEnd;

  let coveredEntries: { id: string; trip_date: string; amount: number }[] = [];
  let unpaidTripEntries: { id: string; trip_date: string; amount: number }[] = [];

  if (paymentMode === "prepaid") {
    const split = splitCoveredUnpaid(topups, trips, periodEnd);
    coveredEntries = split.covered.filter((e) => inPeriod(e.trip_date));
    unpaidTripEntries = split.unpaid.filter((e) => inPeriod(e.trip_date));
  } else {
    unpaidTripEntries = consumingTrips(trips, periodEnd).filter((e) => inPeriod(e.trip_date));
  }

  const coveredTripDateById = new Map(coveredEntries.map((e) => [e.id, e.trip_date]));
  const unpaidTripDateById = new Map(unpaidTripEntries.map((e) => [e.id, e.trip_date]));

  const coveredItems = toVatItems(coveredEntries);
  const chargeItems = chargesToVatItems(specialCharges);
  const unpaidItems = [...toVatItems(unpaidTripEntries), ...chargeItems];

  const coveredVat = calculateVat(coveredItems);
  const amountDueVat = calculateVat(unpaidItems); // = the Unpaid table's own totals
  const grandVat = calculateVat([...coveredItems, ...unpaidItems]);

  const coveredLines = coveredVat.lines.map((l) => toLine(l, "trip", coveredTripDateById));
  const unpaidLines = amountDueVat.lines.map((l) =>
    toLine(l, unpaidTripDateById.has(l.id) ? "trip" : "charge", unpaidTripDateById),
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
