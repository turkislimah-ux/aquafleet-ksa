// MONEY CORE — PURE math, no Supabase/Next/I-O. The primitives every money
// surface shares: rounding, the VAT constant and gross-up, and the ONE
// expression of what delivered work costs (consumingItems).
//
// ---------------------------------------------------------------------------
// LINEAGE (0206 Group B): this file is the surviving half of lib/prepaid.ts.
// That module carried the pre-ledger prepaid pool — FIFO coverage
// (splitCoveredUnpaidItems), the derived running balance (derivedBalanceItems),
// the app-built statement (buildStatementItems), the paid-up reconstruction
// (paidUpBalance/paidUpBalanceAsOf) and the topup/return input types. All of
// it is RETIRED: balances are the 0203 ledger's view columns, the statement is
// lib/statementViewModel.ts over ledger rows, settlement is the 0204 RPCs, and
// nothing app-side derives a balance any more. What moved here is what the
// ledger era still computes: how a single piece of WORK is priced and ordered.
// The 29 pre-ledger invoices render from their FROZEN columns (freeze law
// 0027) and need none of the deleted math.
// ---------------------------------------------------------------------------

// The ONE rounding definition — round-half-up to 2dp (halalas). lib/vat.ts
// re-exports it rather than redefining, so every money value in the app
// rounds identically.
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Canonically defined HERE (not lib/vat.ts) so consumingItems below can use
// it without a circular import. lib/vat.ts imports and re-exports both;
// nothing outside this file hand-rolls 0.15 or 1.15 a second time.
export const VAT_RATE = 0.15;

/**
 * THE VAT gross-up. One expression for every per-item consumption figure, so
 * work can never be priced at two different rates.
 */
export function inclVat(amountPreVat: number): number {
  return round2(amountPreVat * (1 + VAT_RATE));
}

/**
 * THE draw-down: the VAT-inclusive total of a set of items, per-item grossed
 * then summed — NOT the sum grossed once. The two differ by halalas, and the
 * per-item figure is the one the ledger actually moves by: it is the same
 * expression v_customer_uninvoiced totals and the statement's trip/charge
 * deduction uses. The Mark Paid dialog's draw-down preview reads this over
 * one invoice's own rows, so previewing and settling are one expression
 * evaluated twice rather than two kept in step.
 */
export function settlementGross(items: readonly { amount_sar: number }[]): number {
  return round2(items.reduce((s, it) => s + inclVat(it.amount_sar), 0));
}

export type ConsumingTrip = {
  id: string;
  trip_date: string;
  delivered_at: string | null;
  // RESOLVED pre-VAT rate for this trip: the trip's OWN frozen `trips.rate_sar`
  // (stamped at delivery), falling back to its project's current
  // rate_per_trip_sar only when the trip has not been delivered yet and so has
  // nothing frozen. STILL RESOLVED BY THE CALLER — this module never fetches
  // and holds no opinion about where the number came from.
  //
  // THE FALLBACK CANNOT AFFECT MONEY, BY CONSTRUCTION: deliveredTripsSorted()
  // filters to `delivered_at != null` BEFORE any amount is computed, and a
  // delivered trip always carries a frozen rate.
  rate_sar: number;
  // Additive, display-only. Never read by any money math below — passenger
  // data threaded through to statement/invoice display.
  ref?: string | null;
  water_type?: "potable" | "non_potable" | null;
};

export type ConsumingCharge = {
  id: string;
  // Caller-resolved, required: a charge with no date cannot take part in a
  // date-ordered queue, so the caller falls back (e.g. to the invoice's
  // period_end) before constructing this type. ORDERING ONLY — it never
  // decides MEMBERSHIP; a charge's invoice FK does that, and the caller has
  // already applied it (a VOID invoice's charges are simply not passed in).
  charge_date: string;
  // Pre-VAT, = price_sar * quantity, already computed by the caller. This
  // file never does quantity * price itself.
  amount_sar: number;
  label?: string | null;
};

// A single queue entry — trip OR special charge, discriminated by `kind`.
// `amount` stays PRE-VAT (an invoice-assembly caller feeds it through
// calculateVat() for document-level display); `consumedAmount` is the
// separate, per-item, VAT-inclusive figure every consumption surface reads.
// The two must never be conflated: calculateVat() rounds VAT ONCE on a
// summed document subtotal, consumedAmount is rounded per item.
// `trip_date` carries the item's date regardless of origin (charge_date for
// charges).
export type ConsumedItem = {
  id: string;
  kind: "trip" | "charge";
  trip_date: string;
  delivered_at: string | null; // charges: always null, not applicable
  amount: number; // pre-VAT
  consumedAmount: number; // VAT-inclusive — round2(amount * (1 + VAT_RATE))
  ref?: string | null; // trips only
  water_type?: "potable" | "non_potable" | null; // trips only
  label?: string | null; // charges only
};

// Internal — trip-side half of consumingItems()'s combined queue, so the
// trip-filter/sort logic is not duplicated.
type DeliveredTripEntry = {
  id: string;
  trip_date: string;
  delivered_at: string;
  amount: number; // pre-VAT
  ref?: string | null;
  water_type?: "potable" | "non_potable" | null;
};

function deliveredTripsSorted(trips: ConsumingTrip[], asOfDate?: string): DeliveredTripEntry[] {
  return trips
    .filter((t): t is ConsumingTrip & { delivered_at: string } => t.delivered_at != null)
    .filter((t) => asOfDate == null || t.trip_date <= asOfDate)
    .map((t) => ({
      id: t.id,
      trip_date: t.trip_date,
      delivered_at: t.delivered_at,
      amount: round2(t.rate_sar),
      ref: t.ref,
      water_type: t.water_type,
    }))
    .sort((a, b) =>
      a.trip_date !== b.trip_date
        ? a.trip_date < b.trip_date ? -1 : 1
        : a.delivered_at !== b.delivered_at
        ? a.delivered_at < b.delivered_at ? -1 : 1
        : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
}

function compareConsumedItems(a: ConsumedItem, b: ConsumedItem): number {
  if (a.trip_date !== b.trip_date) return a.trip_date < b.trip_date ? -1 : 1;
  // Same-date tiebreak: trips before charges — arbitrary but deterministic
  // and documented (charges have no natural intra-day ordering signal the
  // way delivered_at gives trips one).
  if (a.kind !== b.kind) return a.kind === "trip" ? -1 : 1;
  if (a.kind === "trip") {
    const da = a.delivered_at ?? "";
    const db = b.delivered_at ?? "";
    if (da !== db) return da < db ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * THE shared "what does delivered work cost" function. Combines the
 * delivered/asOfDate-filtered trip list with the given charges (NOT
 * date-filtered — see below), maps both to ConsumedItem (adding the
 * VAT-inclusive consumedAmount), and returns ONE date-ordered queue.
 *
 * Its consumers under the ledger law: invoice assembly (which trips a period
 * bills, lib/invoice.ts), the statement's trip/charge rows and their Available
 * deduction (lib/statementViewModel.ts), and the postpaid Amount Payable rule
 * (app/trips/amountPayable.ts). `consumedAmount` is the same expression
 * v_customer_uninvoiced totals — round2(rate * (1 + vat)) per item — which is
 * what lets the statement's walk close on v_customer_available to the halala.
 * Never re-implement item selection, ordering or the VAT-inclusive math
 * anywhere else.
 *
 * asOfDate FILTERS TRIPS ONLY. A CHARGE IS INVOICE-BOUND, NOT DATE-SCOPED:
 * its invoice FK — applied by the caller — decides which document it belongs
 * to; its date is a label and an ordering key. This predicate used to gate
 * charges too, which made a future-dated charge structurally un-coverable
 * (measured live on 026-000017) and let past-dated ones through — one-sided
 * both ways. compareConsumedItems keeps a future-dated charge at the tail of
 * the queue, where it can take nothing from an earlier item.
 */
export function consumingItems(
  trips: ConsumingTrip[],
  charges: ConsumingCharge[] = [],
  asOfDate?: string,
): ConsumedItem[] {
  const tripItems: ConsumedItem[] = deliveredTripsSorted(trips, asOfDate).map((e) => ({
    id: e.id,
    kind: "trip",
    trip_date: e.trip_date,
    delivered_at: e.delivered_at,
    amount: e.amount,
    consumedAmount: inclVat(e.amount),
    ref: e.ref ?? null,
    water_type: e.water_type ?? null,
  }));

  // NO asOfDate gate — see the header. Charges are scoped by their invoice FK
  // (the caller's job), never by date.
  const chargeItems: ConsumedItem[] = charges.map((c) => ({
    id: c.id,
    kind: "charge",
    trip_date: c.charge_date,
    delivered_at: null,
    amount: round2(c.amount_sar),
    consumedAmount: inclVat(c.amount_sar),
    label: c.label ?? null,
  }));

  return [...tripItems, ...chargeItems].sort(compareConsumedItems);
}
