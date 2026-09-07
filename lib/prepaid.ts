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
  // RESOLVED pre-VAT rate for this trip. Since the frozen-rate switch this is
  // the trip's OWN frozen `trips.rate_sar` (stamped at delivery), falling back
  // to its project's current rate_per_trip_sar only when the trip has not been
  // delivered yet and so has nothing frozen.
  //
  // STILL RESOLVED BY THE CALLER, which has NOT changed: this module never
  // fetches and holds no opinion about where the number came from. What changed
  // is what the callers hand it — see each construction site.
  //
  // THE FALLBACK CANNOT AFFECT MONEY, BY CONSTRUCTION: deliveredTripsSorted()
  // below filters to `delivered_at != null` BEFORE any amount is computed, and a
  // delivered trip always carries a frozen rate. The fallback exists so an
  // undelivered trip still holds a sane number while it is filtered out, and so
  // the behaviour degrades to the OLD basis rather than to zero if that filter
  // is ever loosened.
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

// ---------------------------------------------------------------------------
// BALANCE RETURNS — a refund of prepaid credit (customer_balance_returns,
// migration 0139) is a DEBIT of the same class as consumption (migration 0142).
//
// WHY THE RULE CHANGED. 0139 recorded a return as a MARK and deliberately left
// balance_sar alone: "recording is not deducting". That held only because a
// returned-balance customer was always archived, and an archived customer
// cannot create new work — the untouched figure was inert. It is not inert
// once such a customer can be active again: every balance/coverage path here
// read top-ups raw, so money that had physically been paid back still read as
// spendable credit and could cover a second set of trips. Turki's ruling: a
// recorded return REDUCES spendable prepaid credit. This module now nets it.
//
// NOT A NEGATIVE TOP-UP, and never modelled as one. A top-up is money arriving;
// a return is money leaving. Folding a return into the credits side would make
// `topups_sar` lie about what was ever paid in, and the statement could no
// longer show the refund as its own event.
//
// NOT PART OF consumingItems(). A return is not a billable supply — it must
// never surface as an invoice line, and lib/invoice.ts maps
// splitCoveredUnpaidItems()'s covered/unpaid entries straight into lines. So
// returns are threaded as a SEPARATE debit input to the three balance-bearing
// functions rather than as a fourth ConsumedItem kind.
//
// NO VAT. Consumption is grossed up by VAT_RATE because it mirrors what the
// invoice will bill. A refund is a cash movement, not a taxable supply: the
// amount returned is exactly the amount that leaves the pool.
// ---------------------------------------------------------------------------
export type BalanceReturnLite = {
  id: string;
  amount_sar: number;
  // Caller-resolved calendar date of the refund (customer_balance_returns
  // .returned_on, NOT NULL). Carried for ORDERING and display — the statement
  // interleaves the row by this date. It no longer gates any pool sum: like
  // topup_date, it is a lifetime credit-side term (see derivedBalanceItems).
  returned_on: string;
};

// THE ONE returns summation. derivedBalanceItems, splitCoveredUnpaidItems and
// buildStatementItems all route through this (buildStatementItems via the rows
// it builds, whose amounts sum to exactly this), so no two of them can total
// returns differently — the same single-source-of-truth discipline
// consumingItems() enforces for the consumption side.
//
// EXPORTED still, though its one OUTSIDE caller is gone: lib/invoice.ts used to
// recompute the starting pool locally (`startingPool`) to walk the per-invoice
// covered-ledger entering balance, and that whole walk has been deleted — it was
// the running-balance mechanism the invoice no longer shows. The export stays
// because the harnesses assert against it directly.
//
// `asOfDate` HAS EXACTLY ONE CALLER, and it is not a pool: paidUpCore() below,
// reached only through paidUpBalanceAsOf(). The three POOL call sites
// (derivedBalanceItems, splitCoveredUnpaidItems and the invoice engine's split)
// still sum returns over the customer's whole life, because a live pool is a
// lifetime net — pass a date at any of those and the balance silently
// contradicts every other one in the app.
//
// What makes that one use legitimate is that it gates ALL THREE terms —
// deposits, consumption and returns — at the SAME instant, reconstructing a
// historical figure rather than trimming one side of a live one. See its header.
// The forbidden thing was never the date; it was the ASYMMETRY.
export function returnedTotal(returns: BalanceReturnLite[], asOfDate?: string): number {
  return round2(
    returns
      .filter((r) => asOfDate == null || r.returned_on <= asOfDate)
      .reduce((s, r) => s + r.amount_sar, 0),
  );
}

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
//   balance = sum(top-ups) - sum(VAT-inclusive consumption) - sum(balance
//   returns). Can go negative (over-balance), same as v2. The returns term
//   arrived with 0142 — see the BALANCE RETURNS note above TopupLite for why a
//   refund is a debit and why it is the one debit that does NOT flow through
//   consumingItems().
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
//
// BALANCE RETURNS are the ONE debit outside this queue, because they are the
// one debit that is not a billable supply (see the note above TopupLite). They
// get the same treatment one level up: returnedTotal() is their single
// summation, and all three functions below route through it, so they cannot
// disagree about refunds either.
// ============================================================================

export type ConsumingCharge = {
  id: string;
  // Caller-resolved, required. migration 0032's charge_date column is
  // nullable at the DB level (pre-batch-B rows predate it) — a charge with
  // no date can't take part in a date-ordered queue, so the caller must
  // resolve one (e.g. fall back to the invoice's period_end) before
  // constructing this type, exactly like ConsumingTrip.rate_sar being
  // resolved before construction. Never re-derived in here.
  //
  // ORDERING ONLY — it never decides MEMBERSHIP. A charge's invoice FK does
  // that, and the caller has already applied it. consumingItems() does not
  // filter charges by this date; see its header for what that filter cost.
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
 * given charges (NOT date-filtered — see below), maps both to ConsumedItem
 * (adding the VAT-inclusive consumedAmount), and returns ONE date-ordered
 * queue. derivedBalanceItems/buildStatementItems/splitCoveredUnpaidItems all
 * walk this exact list.
 *
 * asOfDate FILTERS TRIPS ONLY. A CHARGE IS INVOICE-BOUND, NOT DATE-SCOPED.
 * Every special charge is FK-bound to exactly one invoice at creation, so its
 * invoice — not its date — decides which document it belongs to, and the
 * caller has already scoped the charge list by that FK. Its date is a label.
 *
 * This used to carry `charge_date <= asOfDate`, and with asOfDate = the
 * invoice's periodEnd that made a FUTURE-DATED charge structurally
 * un-coverable: it never entered this walk, so it could never land in
 * splitCoveredUnpaidItems' covered side, so lib/invoice.ts tagged it
 * `covered: false` — while the same function's chargeLines half, which never
 * had the filter, displayed it anyway. Displayed, deducted from the balance,
 * and permanently uncoverable. Measured live on 026-000017 (a 1,000.00 charge
 * dated two days past periodEnd, uncovered against ~40,000 of remaining pool).
 *
 * The predicate was also one-SIDED — `<=` let PAST-dated charges through — so
 * the same engine covered a charge dated before the period and refused one
 * dated after it. Deleting it makes this walk agree with the two authorities
 * that never had the filter: v_customer_prepaid_balance (charge_consumption_sar
 * consumes every charge on every non-void invoice, no date predicate) and
 * confirm_invoice()'s charge-divergence guard (payload must match the whole
 * charge table, dates irrelevant).
 *
 * Ordering is unaffected in the direction that would matter: compareConsumedItems
 * sorts by date, so a future-dated charge lands at the TAIL of the queue and
 * cannot take pool from an earlier item — it can only consume what survives them.
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

/**
 * v3 derived balance = sum(ALL top-ups) - sum(VAT-inclusive consumption up to
 * asOfDate, via consumingItems) - sum(ALL balance returns). Pure; recomputed
 * fresh every call. `charges` defaults to `[]` so a trips-only caller still
 * gets correct VAT-inclusive trip consumption without needing to pass charges.
 *
 * THE POOL IS A LIFETIME NET; asOfDate SCOPES CONSUMPTION ONLY. Same rule, same
 * words, as splitCoveredUnpaidItems below (Turki, locked) — and that is the
 * whole reason the two sums above lost their date filter. The credit side used
 * to cut at `topup_date <= asOfDate` and `returned_on <= asOfDate`, which was
 * INERT (every production caller passes asOfDate = undefined) but LOADED: the
 * first caller to pass a date would have got a balance that contradicts the
 * invoice engine's pool, v_customer_prepaid_balance and the Finance KPI at
 * once, silently, and by the exact value of the top-ups dated after that date.
 * Removing the gate changes no current number and closes that.
 *
 * asOfDate STAYS on consumingItems() and is load-bearing there —
 * lib/invoice.ts passes periodEnd to scope an invoice's TRIP consumption to its
 * period. Deleting the parameter would take that with it. It no longer touches
 * CHARGES: a charge is invoice-bound, not date-scoped (see consumingItems).
 *
 * `returns` (0142) defaults to `[]` — a caller with no refunds to report gets
 * byte-identical numbers to before. It is the LAST parameter for that reason:
 * every existing positional call still compiles and still means the same thing.
 * A caller that CAN have refunds must pass them; see the BALANCE RETURNS note
 * above for why a refund is a debit rather than a negative credit.
 *
 * This is the ONE expression of a customer's spendable prepaid credit on the
 * app side. Its SQL counterpart is v_customer_prepaid_balance.balance_sar,
 * which nets returns the same way (migration 0142) so the two cannot disagree.
 */
export function derivedBalanceItems(
  topups: TopupLite[],
  trips: ConsumingTrip[],
  charges: ConsumingCharge[] = [],
  asOfDate?: string,
  returns: BalanceReturnLite[] = [],
): number {
  // NO asOfDate on either credit term — see the LIFETIME NET note above.
  const credits = round2(topups.reduce((s, t) => s + t.amount_sar, 0));
  const debits = round2(consumingItems(trips, charges, asOfDate).reduce((s, e) => s + e.consumedAmount, 0));
  const returned = returnedTotal(returns);
  return round2(credits - debits - returned);
}

// ---------------------------------------------------------------------------
// PAID-UP BALANCE — the invoice document's balance, and the Finance page's
// column of the same name. THE ONE EXPRESSION; every surface reads its output.
//
// deposits − PAID-invoice consumption − returns.
//
// It is NOT the running balance and must never be confused with one. The
// running balance (derivedBalanceItems / buildStatementItems, Model A) deducts
// every DELIVERED trip and charge; this deducts only what a PAID invoice has
// settled. The two therefore differ by exactly the Amount Payable column —
// `paidUp = running − payable` — and a prepaid customer can legitimately show a
// healthy paid-up balance while the pool behind it is overdrawn. That is why
// the Finance row now prints BOTH, and why the invoice prints only this one:
// a document is a statement of what has been settled, not of what is spendable.
// The spendable figure lives on the STATEMENT (Plan A) and on the Finance row.
//
// WHY THIS GATES THE POOL WHEN NOTHING ELSE MAY.
//
// The house rule is "asOfDate scopes CONSUMPTION, never the POOL" — a live
// balance whose credit side is cut at a date contradicts every other balance in
// the app by the value of the top-ups after that date. That rule is about
// ASYMMETRY, and it stands.
//
// `asOf` here is not a consumption filter bolted onto a live pool. It is a
// COMPLETE RECONSTRUCTION of all three terms at ONE instant: the same moment
// gates the deposits, the consumption and the returns together. Nothing is left
// ungated to disagree with anything else. That is what a frozen figure on an
// issued document has to be — a paid invoice states the balance as it stood
// when it was paid, and it may never move again.
//
// Which is also why this is a function of its own instead of a new argument to
// derivedBalanceItems. Passing a date THERE would gate consumption only, leave
// the pool lifetime, and produce precisely the silent contradiction the rule
// forbids. Two different questions, two different functions.
// ---------------------------------------------------------------------------

/**
 * One item that a PAID invoice has settled — a trip or a special charge.
 *
 * `amount_sar` is PRE-VAT (the same figure `ConsumedItem.amount` carries); the
 * pool's own unit is VAT-inclusive, so this is grossed up here through the same
 * `inclVat` every other consumption site uses.
 */
export type PaidConsumedAmount = {
  id: string;
  amount_sar: number;
};

/**
 * The same item, carrying the instant it was settled.
 *
 * `paid_at` is the OWNING INVOICE's payment timestamp, not the item's own date.
 * An item consumes the paid-up balance at the moment its invoice was paid,
 * which is the only ordering that makes the as-of walk well defined.
 */
export type PaidConsumedItem = PaidConsumedAmount & { paid_at: string };

/**
 * THE VAT gross-up. One expression for `consumingItems` and `paidUpBalance`
 * alike, so the pool can never be drawn down at two different rates.
 */
export function inclVat(amountPreVat: number): number {
  return round2(amountPreVat * (1 + VAT_RATE));
}

/**
 * THE draw-down: what a set of settled items takes off the paid-up balance.
 *
 * Per-item gross, then summed — NOT the sum grossed up once. The two differ by
 * halalas (three items of 0.03 gross to 0.09 item-wise and 0.10 in one step),
 * and the item-wise figure is the one the balance actually moves by, because
 * `paidUpCore`'s debit side below IS this function.
 *
 * That shared call is the point. The pay-with-balance panel previews
 * `paidUp − settlementGross(this invoice's items)`, so previewing and settling
 * are one expression evaluated twice rather than two expressions that have to
 * be kept in step. A stored `grand_total_sar` cannot serve here: invoices frozen
 * by the covered-only engine hold a total that EXCLUDES lines they list (live
 * today on 026-000009 and 026-000017), so the panel promised one figure and the
 * payment moved the balance by another.
 */
export function settlementGross(items: readonly { amount_sar: number }[]): number {
  return round2(items.reduce((s, it) => s + inclVat(it.amount_sar), 0));
}

/**
 * THE paid-up balance expression: deposits − paid-invoice consumption − returns.
 * Private; reached through the two exports below.
 *
 * GRANULARITY IS NOT UNIFORM, and cannot be. `paid_at` is a timestamp;
 * `topup_date` and `returned_on` are calendar DATES with no time on them. So
 * the consumption side compares instants while the credit side compares the
 * as-of DAY, which means a top-up or a refund recorded on the same day an
 * invoice was paid counts as having happened BEFORE it. That is the same
 * inclusive `<= day` convention every other date filter in this file uses
 * (`trip_date <= asOfDate`, `returned_on <= asOfDate`); inventing a time for a
 * dateless row would be a fabrication, and excluding the whole day would drop
 * real money from the figure.
 */
function paidUpCore(
  topups: TopupLite[],
  paidItems: readonly (PaidConsumedAmount & { paid_at?: string })[],
  returns: BalanceReturnLite[],
  asOf: string | null,
): number {
  const asOfDay = asOf == null ? null : asOf.slice(0, 10);
  const asOfMs = asOf == null ? null : Date.parse(asOf);

  const credits = round2(
    topups.filter((tu) => asOfDay == null || tu.topup_date <= asOfDay).reduce((s, tu) => s + tu.amount_sar, 0),
  );
  const debits = settlementGross(
    paidItems.filter((it) => asOfMs == null || Date.parse(it.paid_at!) <= asOfMs),
  );
  // The dormant `asOfDate` parameter's FIRST and ONLY caller — see returnedTotal's
  // own note. Legitimate here for the reason spelled out above the type: this
  // gates all three terms at one instant, so no side is left ungated to
  // contradict another.
  const returned = returnedTotal(returns, asOfDay ?? undefined);

  return round2(credits - debits - returned);
}

/**
 * CURRENT paid-up balance — live, and it moves every time an invoice is paid.
 *
 * What draft, review and confirmed-unpaid invoices show, and what the Finance
 * row's column shows. Takes items WITHOUT timestamps on purpose: a caller that
 * cannot say when each item was settled is structurally unable to ask the
 * as-of question below, so it cannot accidentally produce a half-gated figure.
 */
export function paidUpBalance(input: {
  topups: TopupLite[];
  paidItems: PaidConsumedAmount[];
  returns?: BalanceReturnLite[];
}): number {
  return paidUpCore(input.topups, input.paidItems, input.returns ?? [], null);
}

/**
 * FROZEN paid-up balance — the figure as it stood at ONE instant, which may
 * never move again.
 *
 * What a PAID invoice shows (`asOf` = its own `paid_at`) and what a VOID one
 * shows (`asOf` = its `voided_at`). Every item must carry the moment its
 * invoice was paid; that requirement is the type's, not a convention, because
 * an as-of figure computed from undated items would silently be the current
 * one wearing a frozen label.
 */
export function paidUpBalanceAsOf(input: {
  topups: TopupLite[];
  paidItems: PaidConsumedItem[];
  returns?: BalanceReturnLite[];
  asOf: string;
}): number {
  return paidUpCore(input.topups, input.paidItems, input.returns ?? [], input.asOf);
}

/**
 * A PAID prepaid invoice, shown on the statement as a RECORD-ONLY row.
 *
 * It is NOT a debit and NOT a credit: the trips and charges that invoice
 * covers already consumed balance at delivery (see consumingItems), so
 * deducting it again here would double-count. buildStatementItems therefore
 * carries the amount for display and leaves runningBalance untouched.
 */
export type SettlementStatementInput = {
  id: string;
  date: string; // invoice payment date
  invoice_number: string;
  amount: number; // invoice grand_total_sar, VAT-inclusive, positive
};

export type StatementItemEntry = {
  kind: "topup" | "trip" | "charge" | "settlement" | "return";
  id: string;
  date: string;
  // Positive for a top-up credit, NEGATIVE VAT-INCLUSIVE consumedAmount for
  // a trip/charge debit — the statement shows the true draw on balance, not
  // the pre-VAT item amount. A "settlement" row carries the paid invoice's
  // positive grand total for DISPLAY ONLY and never moves runningBalance. A
  // "return" row is a NEGATIVE plain amount (no VAT gross-up — a refund is a
  // cash movement, not a taxable supply) and DOES move runningBalance.
  amount: number;
  runningBalance: number;
  note?: string | null;
  reference?: string | null;
  ref?: string | null; // trip debits only
  water_type?: "potable" | "non_potable" | null; // trip debits only
};

// SAME-DAY ORDER, as one explicit rank rather than a chain of pairwise tests.
//
//   0 topup       money in, first — a credit always precedes the debits it funded
//   1 trip        consumption, trips before charges (matches
//   2 charge       compareConsumedItems' own same-day tiebreak exactly)
//   3 return       the refund of whatever survived the day's consumption
//   4 settlement  record-only, always last so it can never split a credit/debit pair
//
// The previous form asked `a.kind === "topup" ? -1 : 1`, which answered 1 in
// BOTH directions for a same-day trip-vs-charge pair — an inconsistent
// comparator, so that ordering was whatever the sort implementation happened to
// do. A rank cannot be inconsistent, and it puts the statement in step with
// compareConsumedItems instead of merely near it. Credit-before-debit and
// settlement-last are unchanged; no figure moves, only the order of two rows
// that share a date.
function sameDayRank(kind: StatementItemEntry["kind"]): number {
  return kind === "topup" ? 0 : kind === "trip" ? 1 : kind === "charge" ? 2 : kind === "return" ? 3 : 4;
}

/**
 * v3 bank-statement-style ledger: every top-up credit + every trip/charge
 * VAT-inclusive debit + every balance return, chronological (date asc;
 * same-day tie: sameDayRank above, then id),
 * with a running balance. The final entry's runningBalance always equals
 * derivedBalanceItems(...) for the same inputs — both derive from the same
 * consumingItems() core.
 *
 * PAID INVOICES (settlements) are RECORD-ONLY rows interleaved in true date
 * order. They carry an amount for display and contribute NOTHING to the
 * running balance — the trips and charges the invoice covers already left the
 * balance at delivery, so deducting the invoice too would double-count. A
 * settlement sorts LAST within its own date so it can never split a same-day
 * credit/debit pair, and the credit-before-debit tiebreak below is unchanged
 * for every non-settlement pair.
 *
 * BALANCE RETURNS (0142) are REAL DEBITS, unlike settlements: the money left
 * the business, so the row carries a negative amount and moves the running
 * balance. They must appear here or the statement's closing figure would stop
 * matching derivedBalanceItems — the invariant above is the whole reason this
 * function cannot opt out of the netting rule.
 */
export function buildStatementItems(
  topups: TopupStatementInput[],
  trips: ConsumingTrip[],
  charges: ConsumingCharge[] = [],
  asOfDate?: string,
  settlements: SettlementStatementInput[] = [],
  returns: BalanceReturnLite[] = [],
): StatementItemEntry[] {
  // EVERY top-up, no date gate — the pool is a lifetime net (see
  // derivedBalanceItems' note). The closing runningBalance below must equal
  // that function over the same inputs, so the two credit sides cannot be
  // filtered differently without breaking the invariant this file is built on.
  const credits = topups
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

  // SETTLEMENTS KEEP THEIR GATE, deliberately. A settlement is not the pool —
  // it is a record-only row tracing a paid invoice, contributes nothing to the
  // running balance, and so cannot desync the closing figure from
  // derivedBalanceItems no matter how it is filtered. An invoice paid after the
  // date being asked about has genuinely not been paid yet as of that date.
  const settlementRows = settlements
    .filter((s) => asOfDate == null || s.date <= asOfDate)
    .map((s) => ({
      kind: "settlement" as const,
      id: s.id,
      date: s.date,
      amount: round2(s.amount),
      note: null as string | null,
      reference: s.invoice_number,
    }));

  // EVERY refund, no date gate — the other half of the pool, same rule as the
  // top-ups above. A return DOES move the running balance, so unlike a
  // settlement it cannot keep a gate the credit sum does not have.
  const returnRows = returns
    .map((r) => ({
      kind: "return" as const,
      id: r.id,
      date: r.returned_on,
      // NEGATIVE, and NOT grossed up by VAT_RATE — a refund is cash leaving,
      // not a supply. See the BALANCE RETURNS note at the top of this file.
      amount: round2(-r.amount_sar),
      note: null as string | null,
      reference: null as string | null,
    }));

  const merged = [...credits, ...debits, ...settlementRows, ...returnRows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.kind !== b.kind) return sameDayRank(a.kind) - sameDayRank(b.kind);
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  let running = 0;
  return merged.map((e) => {
    // A settlement RECORDS, it does not deduct — the balance holds flat across
    // it and is not recomputed.
    if (e.kind !== "settlement") running = round2(running + e.amount);
    return { ...e, runningBalance: running };
  });
}

export type CoveredUnpaidItemsResult = {
  covered: ConsumedItem[];
  unpaid: ConsumedItem[];
  coveredTotal: number; // VAT-inclusive sum (consumedAmount)
  unpaidTotal: number; // VAT-inclusive sum (consumedAmount)
  // Leftover pool after balance returns and only-covered items are subtracted.
  // Never driven negative BY CONSUMPTION (unlike derivedBalanceItems, which
  // subtracts every consumed item unconditionally and can go negative to show
  // over-balance): an item that does not fit is left uncovered rather than
  // overdrawing.
  //
  // It CAN start below zero if returns exceed top-ups, because returns are
  // netted off the pool up front rather than walked item by item. That does not
  // arise from the app: return_customer_balance refunds exactly the balance
  // then standing, so top-ups - returns lands on the consumption recorded at
  // refund time, i.e. >= 0. It is left unclamped deliberately — clamping would
  // buy a tidier floor at the cost of the reconciliation invariant below, which
  // is the property the harness actually checks.
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
 * BALANCE RETURNS (0142) come off the POOL, not the queue. A refund is not a
 * billable item — lib/invoice.ts maps this function's covered/unpaid entries
 * straight into invoice lines, so a return appearing among them would be
 * billed to the customer. Netting it into the starting pool instead produces
 * the correct split with no new item kind: the pool left after a refund is
 * exactly the consumption it had already paid for, so work up to the refund
 * stays Covered and everything after it falls Unpaid — which is precisely the
 * position a refunded customer is in.
 *
 * THE POOL IS A LIFETIME NET — asOfDate gates NEITHER SIDE of it (Turki,
 * locked). Any deposit pays any invoice regardless of the deposit's date, past
 * or future, and every refund comes off it regardless of the refund's date.
 * That is exactly what v_customer_prepaid_balance reports: neither its topups
 * sub-select nor its returns sub-select carries a date predicate.
 *
 * This function used to cut the pool at `topup_date <= asOfDate`; with asOfDate
 * = the invoice's periodEnd that silently dropped every
 * backdated-invoice-plus-later-deposit case, the customer's own money going
 * uncounted against their own trips. The returns term carried the same cut, and
 * ungating only the deposits would have over-stated the pool by any refund
 * dated after periodEnd — both halves move together or the pool is not a net.
 *
 * asOfDate still scopes CONSUMPTION — consumingItems() below keeps filtering
 * TRIPS by date, so an invoice for a period still bills only that period's
 * work. It does NOT filter charges: a charge belongs to its invoice by FK
 * regardless of its date, and gating it there made a future-dated charge
 * permanently uncoverable (see consumingItems' header).
 *
 * Invariant (enforced by the harness on every case): coveredTotal +
 * unpaidTotal === sum of every consumingItems() consumedAmount, and
 * remainingBalance − unpaidTotal === the same lifetime-credit balance the
 * harness reconciles against. Netting returns into the pool preserves the
 * second identity exactly — both sides lose the same term.
 */
export function splitCoveredUnpaidItems(
  topups: TopupLite[],
  trips: ConsumingTrip[],
  charges: ConsumingCharge[] = [],
  asOfDate?: string,
  returns: BalanceReturnLite[] = [],
): CoveredUnpaidItemsResult {
  let pool = round2(round2(topups.reduce((s, t) => s + t.amount_sar, 0)) - returnedTotal(returns));

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
