// Prepaid balance ledger — PURE math, no Supabase/Next/I-O. Mirrors
// lib/commission.ts's discipline (see scripts/prepaid-check.ts).
//
// ---------------------------------------------------------------------------
// v3 CUTOVER (Finance Step 3): the v2 model (pre-VAT consumption; exported
// consumingTrips/derivedBalance/buildStatement/splitCoveredUnpaid) is RETIRED.
// Every caller (lib/invoice.ts, app/trips/actions.ts, FinanceTab.tsx,
// StatementModal.tsx) now uses the v3 functions below (consumingItems /
// derivedBalanceItems / buildStatementItems / splitCoveredUnpaidItems) — the
// ONE live consumption model, VAT-inclusive, trips+charges combined FIFO.
// scripts/invoice-check.ts and scripts/prepaid-check.ts /
// scripts/covered-unpaid-check.ts were rewritten alongside this cutover to
// assert only v3 behavior. No parallel/legacy consumption implementation
// remains in this file.
// ---------------------------------------------------------------------------

// Exported — lib/vat.ts (Finance Commit 4) reuses this exact rounding
// definition rather than redefining its own, so every money value in the
// Finance feature rounds identically (round-half-up to 2dp / halalas).
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Canonically defined HERE (not lib/vat.ts) so lib/prepaid.ts's v3
// consumption math (below) can use it without a circular import — round2
// already flowed prepaid.ts -> vat.ts; VAT_RATE now flows the same
// direction. lib/vat.ts imports and re-exports both from here; nothing
// outside this file hand-rolls 0.15 or 1.15 a second time (grep-verified:
// only scripts/vat-check.ts imports VAT_RATE, via lib/vat.ts's re-export,
// unaffected by this move).
export const VAT_RATE = 0.15;

export type ConsumingTrip = {
  id: string;
  trip_date: string;
  delivered_at: string | null;
  // RESOLVED pre-VAT rate for this trip (its project's rate_per_trip_sar at
  // call time) — see header note. NOT the raw trips.rate_sar column.
  rate_sar: number;
  // Additive, display-only (Finance polish batch A). Never read by any money
  // math below — purely passenger data threaded through to statement/invoice
  // display (trip-ref link, water-type grouping label).
  ref?: string | null;
  water_type?: "potable" | "non_potable" | null;
};

export type TopupLite = {
  id: string;
  amount_sar: number;
  topup_date: string;
};

export type TopupStatementInput = TopupLite & { note?: string | null; reference?: string | null };

// Internal only — trip-side half of consumingItems()'s combined queue.
// NOT exported: v2's standalone consumingTrips() export was retired in the
// v3 cutover (see file header). This helper survives only as a private
// building block so the trip-filter/sort logic isn't duplicated.
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

// ============================================================================
// v3 MODEL (finance-invoice-spec.md v3, §2 / §4.2 / §5) — LIVE rule, wired
// into every caller as of the Step 3 cutover (see file header).
//
//   Top-ups = plain money credits (unchanged from v2 — no VAT concept on the
//   credit side, ever).
//
//   Consumption is VAT-INCLUSIVE: a delivered trip consumes
//   `round2(rate_sar * (1 + VAT_RATE))`; a special charge consumes
//   `round2(amount_sar * (1 + VAT_RATE))`. This is the ONE reversal from v2
//   (which consumed pre-VAT rate_sar/amount_sar directly) — under v2, Bin
//   Slimah absorbed VAT whenever balance couldn't stretch; under v3, the
//   customer's balance bears the VAT, matching what the invoice will
//   eventually bill for that item.
//
//   balance = sum(top-ups) - sum(VAT-inclusive consumption). Can go negative
//   (over-balance), same as v2.
//
//   IMPORTANT — this VAT-inclusive multiplier is a CONSUMPTION/bookkeeping
//   concern only, computed per item. It is NOT the same computation as
//   lib/vat.ts's calculateVat(), which rounds VAT ONCE on a document-level
//   SUMMED subtotal for invoice display. The two must never be conflated:
//   a `ConsumedItem`'s `amount` field stays PRE-VAT (so a future invoice-
//   assembly caller can still feed it through calculateVat() for correct
//   document-level display); `consumedAmount` is the separate, per-item,
//   VAT-inclusive figure that drives balance/coverage math. VAT_RATE is
//   imported from nowhere else — it's the same constant defined just above,
//   shared with lib/vat.ts's document-level math, never hand-rolled twice.
//
//   Timing: a trip consumes at delivery (delivered_at set) — same gate as
//   v2. A special charge consumes once it's added to a NON-VOID invoice
//   (draft/review/confirmed/paid) — no "delivered"-equivalent gate of its
//   own. WHICH INVOICES' CHARGES CONSUME (the rule, and why): every charge
//   belonging to a draft/review/confirmed/paid invoice; a charge on a VOID
//   invoice does not. This mirrors ConsumingTrip.rate_sar's caller-resolved
//   convention exactly — this file has NO invoice-status awareness at all.
//   The caller (a future step, once lib/invoice.ts/actions.ts are migrated)
//   is responsible for excluding a void invoice's charges before building
//   the ConsumingCharge[] array passed in here; "void releases" a charge's
//   consumption simply by the caller no longer including it, the exact same
//   mechanism a reversed trip (delivered_at -> null) already uses today to
//   stop consuming. No separate "released" flag or special-case code needed.
//
//   ONE FIFO queue by date, trips + special charges together (charge_date,
//   migration 0032). Whole-item coverage — no splitting, same rule as v2's
//   whole-trip coverage, just extended to a mixed queue. Uncovered items
//   roll forward exactly as v2's uncovered trips did.
//
//   Still the TOTAL-BALANCE model (locked, same as v2): covered/unpaid is a
//   PRESENTATION SPLIT of the single derived balance, never a per-top-up or
//   per-item allocation.
//
// SINGLE-SOURCE-OF-TRUTH: consumingItems() is the ONE v3 "what consumes
// balance" function. derivedBalanceItems() and buildStatementItems() (below)
// both call it for their debit side, and splitCoveredUnpaidItems() walks its
// exact output list — so the v3 balance, statement, and covered/unpaid split
// can never disagree on which items count, their consumedAmount, or their
// order. Never re-implement item selection/ordering/VAT-inclusive math
// anywhere else.
// ============================================================================

export type ConsumingCharge = {
  id: string;
  // Caller-resolved, required. migration 0032's charge_date column is
  // nullable at the DB level (pre-batch-B rows predate it) — a charge with
  // no date can't take part in a date-ordered queue, so the caller must
  // resolve one (e.g. fall back to the invoice's period_end) before
  // constructing this type, exactly like ConsumingTrip.rate_sar being
  // resolved before construction. Never re-derived in here.
  charge_date: string;
  // Pre-VAT, = price_sar * quantity, already computed by the caller — same
  // source-of-truth field lib/invoice.ts's chargesToVatItems already reads
  // (amount_sar). This file never does quantity * price itself.
  amount_sar: number;
  label?: string | null;
};

// A single v3 queue entry — trip OR special charge, discriminated by `kind`.
// `amount` stays PRE-VAT (see model note above — feeds a future document-
// level VAT display call unchanged); `consumedAmount` is the VAT-inclusive
// figure that actually draws down balance. `trip_date` carries the item's
// date regardless of origin (charge_date for charges) — same field-reuse
// convention lib/invoice.ts's LineExtra type already established.
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
 * THE v3 shared "what consumes balance" function. Combines
 * deliveredTripsSorted()'s delivered/asOfDate-filtered trip list with the
 * given charges (asOfDate-filtered by charge_date; no other filtering — see
 * the "which invoices' charges consume" note above), maps both to
 * ConsumedItem (adding the VAT-inclusive consumedAmount), and returns ONE
 * date-ordered queue. derivedBalanceItems/buildStatementItems/
 * splitCoveredUnpaidItems all walk
 * this exact list.
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
    consumedAmount: round2(e.amount * (1 + VAT_RATE)),
    ref: e.ref ?? null,
    water_type: e.water_type ?? null,
  }));

  const chargeItems: ConsumedItem[] = charges
    .filter((c) => asOfDate == null || c.charge_date <= asOfDate)
    .map((c) => ({
      id: c.id,
      kind: "charge",
      trip_date: c.charge_date,
      delivered_at: null,
      amount: round2(c.amount_sar),
      consumedAmount: round2(c.amount_sar * (1 + VAT_RATE)),
      label: c.label ?? null,
    }));

  return [...tripItems, ...chargeItems].sort(compareConsumedItems);
}

/**
 * v3 derived balance = sum(top-ups up to asOfDate) - sum(VAT-inclusive
 * consumption up to asOfDate, via consumingItems). Pure; recomputed fresh
 * every call. `charges` defaults to `[]` so a trips-only caller still gets
 * correct VAT-inclusive trip consumption without needing to pass charges.
 */
export function derivedBalanceItems(
  topups: TopupLite[],
  trips: ConsumingTrip[],
  charges: ConsumingCharge[] = [],
  asOfDate?: string,
): number {
  const credits = round2(
    topups.filter((t) => asOfDate == null || t.topup_date <= asOfDate).reduce((s, t) => s + t.amount_sar, 0),
  );
  const debits = round2(consumingItems(trips, charges, asOfDate).reduce((s, e) => s + e.consumedAmount, 0));
  return round2(credits - debits);
}

export type StatementItemEntry = {
  kind: "topup" | "trip" | "charge";
  id: string;
  date: string;
  // Positive for a top-up credit, NEGATIVE VAT-INCLUSIVE consumedAmount for
  // a trip/charge debit — the statement shows the true draw on balance, not
  // the pre-VAT item amount.
  amount: number;
  runningBalance: number;
  note?: string | null;
  reference?: string | null;
  ref?: string | null; // trip debits only
  water_type?: "potable" | "non_potable" | null; // trip debits only
};

/**
 * v3 bank-statement-style ledger: every top-up credit + every trip/charge
 * VAT-inclusive debit, chronological (date asc; same-day tie: credit before
 * debit, then consumingItems'/compareConsumedItems' own tiebreak, then id),
 * with a running balance. The final entry's runningBalance always equals
 * derivedBalanceItems(...) for the same inputs — both derive from the same
 * consumingItems() core.
 */
export function buildStatementItems(
  topups: TopupStatementInput[],
  trips: ConsumingTrip[],
  charges: ConsumingCharge[] = [],
  asOfDate?: string,
): StatementItemEntry[] {
  const credits = topups
    .filter((t) => asOfDate == null || t.topup_date <= asOfDate)
    .map((t) => ({
      kind: "topup" as const,
      id: t.id,
      date: t.topup_date,
      amount: round2(t.amount_sar),
      note: t.note ?? null,
      reference: t.reference ?? null,
    }));
  const debits = consumingItems(trips, charges, asOfDate).map((e) => ({
    kind: e.kind,
    id: e.id,
    date: e.trip_date,
    amount: round2(-e.consumedAmount),
    note: e.kind === "charge" ? e.label ?? null : null,
    reference: null as string | null,
    ref: e.kind === "trip" ? e.ref ?? null : null,
    water_type: e.kind === "trip" ? e.water_type ?? null : null,
  }));

  const merged = [...credits, ...debits].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "topup" ? -1 : 1; // same-day: credit before debit
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  let running = 0;
  return merged.map((e) => {
    running = round2(running + e.amount);
    return { ...e, runningBalance: running };
  });
}

export type CoveredUnpaidItemsResult = {
  covered: ConsumedItem[];
  unpaid: ConsumedItem[];
  coveredTotal: number; // VAT-inclusive sum (consumedAmount)
  unpaidTotal: number; // VAT-inclusive sum (consumedAmount)
  // Leftover pool after only-covered items subtracted. Always >= 0 — never
  // driven negative (unlike derivedBalanceItems, which subtracts every
  // consumed item unconditionally and can go negative to show over-balance).
  remainingBalance: number;
};

/**
 * v3 covered/unpaid split — splits consumingItems()'s combined trips+charges
 * queue against the top-up pool, FIFO, whole-item coverage (no splitting):
 * an item is Covered only if its full consumedAmount (VAT-inclusive) fits in
 * the remaining pool. The first item that doesn't fit, and every item after
 * it in queue order, goes Unpaid and rolls forward — identical rule to v2's
 * whole-trip coverage, just walking the mixed queue instead of trips only.
 *
 * Invariant (enforced by the harness on every case): coveredTotal +
 * unpaidTotal === sum of every consumingItems() consumedAmount, and
 * remainingBalance − unpaidTotal === derivedBalanceItems(topups, trips,
 * charges, asOfDate) for the same inputs.
 */
export function splitCoveredUnpaidItems(
  topups: TopupLite[],
  trips: ConsumingTrip[],
  charges: ConsumingCharge[] = [],
  asOfDate?: string,
): CoveredUnpaidItemsResult {
  let pool = round2(
    topups.filter((t) => asOfDate == null || t.topup_date <= asOfDate).reduce((s, t) => s + t.amount_sar, 0),
  );

  const items = consumingItems(trips, charges, asOfDate);
  const covered: ConsumedItem[] = [];
  const unpaid: ConsumedItem[] = [];
  let hitWall = false;

  for (const e of items) {
    if (!hitWall && pool >= e.consumedAmount) {
      covered.push(e);
      pool = round2(pool - e.consumedAmount);
    } else {
      hitWall = true;
      unpaid.push(e);
    }
  }

  const coveredTotal = round2(covered.reduce((s, e) => s + e.consumedAmount, 0));
  const unpaidTotal = round2(unpaid.reduce((s, e) => s + e.consumedAmount, 0));

  return { covered, unpaid, coveredTotal, unpaidTotal, remainingBalance: pool };
}
