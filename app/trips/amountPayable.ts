// AMOUNT PAYABLE — the ONE expression of "what does this customer still owe us
// for work already provided, net of what they have actually paid".
//
// WHY THIS FILE EXISTS. The rule was written for the Finance tab's Amount
// Payable column (a69a06d) and lived inline in FinanceTab.tsx. The project
// Breakdown report now shows the same figure, and BreakdownReport is NOT inside
// FinanceTab — it is rendered by CustomersTab, a sibling under TripsTabs — so
// the value could not simply be read across. The alternatives were to recompute
// it there (a money rule copied twice is a money rule that can drift in one
// place, which a69a06d's own message and .claude/skills/aquafleet-domain
// both forbid) or to fetch v_customer_amount_payable (0139) — which is now
// doubly wrong, because that view is no longer even the same number for a
// prepaid customer (see THE VIEW below). So the rule lives here, in a leaf
// module that imports nothing from either caller. Same shape as
// DeliveriesReportBand (b0c386c), which was extracted for the same reason:
// ProjectsBoard and BreakdownReport both import it one way, so no sibling
// cycle can form.
//
// THE RULE, BOTH MODES: the VAT-inclusive value of every DELIVERED trip and
// every non-void special charge that is NOT YET SETTLED BY A PAID INVOICE.
// Drafting, reviewing or confirming an invoice does not reduce it; only Mark
// Paid does, and it clears exactly that invoice's work out of the figure.
//
// **A PREPAID CUSTOMER'S POOL IS NOT AN INPUT HERE, AND THAT IS THE POINT.**
// Adding balance does not reduce what is owed for work already delivered; it
// funds the work, it does not settle it. So this function takes no top-ups and
// no balance returns — not "takes them and ignores them", TAKES THEM NOT AT
// ALL, because a money function that accepts a pool argument reads as one that
// spends it, and that reading is exactly the old behaviour we removed.
//
// THE PREPAID RUNNING BALANCE IS A DIFFERENT NUMBER AND STILL DEDUCTS AT
// DELIVERY (Model A, untouched). It is derivedBalanceItems() over UNFILTERED
// inputs — FinanceTab computes it separately and it drives the Running Balance
// column, the over-balance banner, Settled Balance and the statement. The two
// figures decoupled deliberately, and a prepaid customer can now hold pool
// credit AND owe for delivered work at the same time. That is the model.
//
// THE VIEW, v_customer_amount_payable (0139), NO LONGER MIRRORS THIS FUNCTION
// FOR PREPAID, AND MUST NOT BE "RECONCILED" WITH IT. Its prepaid arm stays the
// running balance because return_customer_balance() gates a real cash refund on
// `amount_payable_sar > 0` and the archive guard reads the same row — flipping
// the view to this rule would make a debtor's figure positive and refund them
// their own debt. The divergence is load-bearing; see
// .claude/skills/aquafleet-domain/SKILL.md.
//
// SIGN IS THE MEANING, not decoration. Negative = owed to us. Zero = settled.
// The result is <= 0 by construction in BOTH modes now: with the credits side
// empty nothing can drive it above zero, so leftover prepaid credit stays where
// it belongs — in the balance, not here. Renderers read the sign and add
// nothing of their own.
//
// PERIOD-INDEPENDENT BY CONSTRUCTION. Nothing here takes a month or a date
// window: this is a running figure as of now, over all periods. A caller that
// displays it beside period-scoped figures says so on screen — it must never
// "fix" the mismatch by slicing the inputs, because a month-sliced payable is a
// different number than the one the Finance tab's column renders.

import {
  derivedBalanceItems,
  type ConsumingTrip,
  type ConsumingCharge,
} from "@/lib/prepaid";
import type { PaymentMode, WaterType } from "@/lib/db-types";

// Structural inputs — deliberately WIDER than either caller's own row type so
// both can pass their rows unchanged. FinanceTab's TripLite declares
// `trip_date: string`; CustomersTab's declares `trip_date: string | null`
// (BreakdownTrip likewise). The column is NOT NULL in the database, so the
// wider type costs nothing and spares both callers a cast.
export type PayableTrip = {
  id: string;
  trip_date: string | null;
  delivered_at: string | null;
  rate_sar?: number | null;
  ref?: string | null;
  water_type?: WaterType | null;
  // invoice_id set AND that invoice is status='paid' (computed in
  // app/trips/page.tsx). A trip on a draft, review, confirmed or void invoice
  // is NOT locked and still owes. OPTIONAL, and the fallback direction is
  // deliberate: an absent flag reads as NOT locked, so an unknown lock state
  // owes rather than silently dropping out of a receivable.
  invoiceLocked?: boolean;
};

export type PayableCharge = {
  id: string;
  label: string | null;
  amount_sar: number;
  charge_date: string | null;
  created_at: string;
  // Parent invoice is status='paid' (app/trips/page.tsx). Charges on VOID
  // invoices are already dropped upstream, so draft/review/confirmed all count.
  paid: boolean;
};

// Engine-input adapters. These carry the RATE RESOLUTION, which is a money rule
// (frozen `trips.rate_sar` first, the project's current rate only as the
// not-yet-delivered fallback — lib/prepaid.ts's ConsumingTrip note, migration
// 0128), and a money rule copied N times can drift in N-1 places. One copy,
// every slice.
//
// Neither adapter FILTERS anything: which trips and which charges belong in a
// given slice is the caller's question and differs per slice (all / paid-only /
// unpaid-only). These only translate a row into the engine's input shape.
export function toConsumingTrip(t: PayableTrip, projectRate: number): ConsumingTrip {
  return {
    id: t.id,
    // A trip with no date cannot take part in a date-ordered queue. The column
    // is NOT NULL, so this coalesce selects no rows in practice — it exists
    // because the widened input type admits null, not because data does.
    trip_date: t.trip_date ?? "",
    delivered_at: t.delivered_at,
    // FROZEN RATE FIRST — see lib/prepaid.ts's ConsumingTrip note. The
    // project's current rate is only the not-yet-delivered fallback.
    rate_sar: t.rate_sar ?? projectRate,
    ref: t.ref,
    water_type: t.water_type,
  };
}

export function toConsumingCharge(ch: PayableCharge): ConsumingCharge {
  return {
    id: ch.id,
    // Resolve a date the same way lib/invoice.ts's resolveChargeDate does
    // (charge_date, falling back to created_at's date) — the engine requires
    // one and never re-derives it.
    charge_date: ch.charge_date ?? ch.created_at.slice(0, 10),
    amount_sar: ch.amount_sar,
    label: ch.label,
  };
}

/**
 * THE PAID GATE — the single predicate this module turns on, named once so the
 * trip side and the charge side cannot drift apart, and so a future third slice
 * has something to import rather than restate.
 *
 * `invoiceLocked` (trips) and `paid` (charges) are the SAME notion computed on
 * the two row shapes in app/trips/page.tsx (`:265` and `:362`), both off the one
 * `.eq("status", "paid")` query at `:233`. Nothing here re-derives them; these
 * only say which side of the gate the payable stands on. FinanceTab's Settled
 * Balance is the exact complement — it filters on the same two flags, the other
 * way round.
 */
export const isUnsettledTrip = (t: PayableTrip): boolean => !t.invoiceLocked;
export const isUnsettledCharge = (ch: PayableCharge): boolean => !ch.paid;

/**
 * The rule itself.
 *
 * Returns null when there is no project, or when the project's payment_mode is
 * unset (legacy pre-0025 rows). We cannot say what an unset customer owes
 * without guessing which model to apply, and guessing at a receivable is the one
 * thing migration 0137 exists to prevent. Renderers show that as an em dash.
 *
 * ONE PATH FOR BOTH MODES, and the collapse is the point rather than a tidy-up:
 * prepaid and postpaid now ask the identical question — "what delivered work is
 * not on a paid invoice" — over identical inputs, so a `mode === "prepaid"`
 * branch here could only ever differ from the postpaid one by accident. The mode
 * is still READ, because an unset mode must still return null; it just no longer
 * selects a formula.
 */
export function computeAmountPayable(args: {
  mode: PaymentMode | null;
  hasProject: boolean;
  projectRate: number;
  trips: PayableTrip[];
  charges: PayableCharge[];
}): number | null {
  const { mode, hasProject, projectRate, trips, charges } = args;
  if (!hasProject) return null;
  if (mode !== "prepaid" && mode !== "postpaid") return null;

  // Same engine, no top-ups: derivedBalanceItems([], …) is credits minus debits
  // with the credits side empty, i.e. the negated VAT-inclusive consumption of
  // exactly this slice. It reuses consumingItems()'s delivered-only filter
  // (lib/prepaid.ts:138) and its per-item rounding rather than restating either
  // — there is no second summation of money anywhere in this file.
  //
  // NO RETURNS TERM, and that is not an omission. A balance return refunds
  // prepaid CREDIT: it moves the pool, not the work. This figure has no pool
  // term at all, so netting a refund here would shrink a debt because we handed
  // money back — the wrong direction. Refunds net in the running balance
  // (lib/prepaid.ts's returnedTotal, 0142); they have no place here.
  return derivedBalanceItems(
    [],
    trips.filter(isUnsettledTrip).map((t) => toConsumingTrip(t, projectRate)),
    charges.filter(isUnsettledCharge).map(toConsumingCharge),
  );
}
