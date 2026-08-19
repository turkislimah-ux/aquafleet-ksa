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
// both forbid) or to fetch v_customer_amount_payable (0139), which would put a
// SECOND computation of this number on a screen — the exact thing a69a06d
// rejected, since the view is a declared mirror rather than a separate
// authority. So the rule moved here instead, to a leaf module that imports
// nothing from either caller. Same shape as DeliveriesReportBand (b0c386c),
// which was extracted for the same reason: ProjectsBoard and BreakdownReport
// both import it one way, so no sibling cycle can form.
//
// SIGN IS THE MEANING, not decoration. Negative = owed to us. Zero = settled.
// Positive = credit the customer holds (prepaid only — a postpaid customer has
// no pool and so can never compute above 0). Renderers read the sign and add
// nothing of their own.
//
// PERIOD-INDEPENDENT BY CONSTRUCTION. Nothing here takes a month or a date
// window: this is a running figure as of now, over all periods. A caller that
// displays it beside period-scoped figures says so on screen — it must never
// "fix" the mismatch by slicing the inputs, because a month-sliced payable is a
// different number than the one the Finance tab's column renders.

import { derivedBalanceItems, type ConsumingTrip, type ConsumingCharge, type TopupStatementInput } from "@/lib/prepaid";
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
  // is NOT locked and still owes.
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
 * The rule itself.
 *
 * Returns null when there is no project, or when the project's payment_mode is
 * unset (legacy pre-0025 rows). We cannot say what an unset customer owes
 * without guessing which model to apply, and guessing at a receivable is the one
 * thing migration 0137 exists to prevent. Renderers show that as an em dash.
 *
 * `prepaidBalance` is the caller's ALREADY-COMPUTED running balance
 * (`derivedBalanceItems(topups, allConsuming, allCharges)`) when it happens to
 * have one, purely so the Finance tab does not compute the identical figure
 * twice per row — it drives that tab's "Total running balance" KPI and
 * over-balance banner as well. Pass null and the prepaid arm computes it here
 * from `topups`/`trips`/`charges` instead. BOTH PATHS ARE THE SAME CALL with
 * the same inputs; this is a reuse hatch, not a second formula, and a caller
 * that passes a DIFFERENT number here is misusing it.
 */
export function computeAmountPayable(args: {
  mode: PaymentMode | null;
  hasProject: boolean;
  projectRate: number;
  trips: PayableTrip[];
  charges: PayableCharge[];
  topups: TopupStatementInput[];
  prepaidBalance?: number | null;
}): number | null {
  const { mode, hasProject, projectRate, trips, charges, topups } = args;
  if (!hasProject) return null;

  if (mode === "prepaid") {
    // PREPAID — the answer IS the running balance: top-ups minus the
    // VAT-inclusive consumption of every delivered trip and every non-void
    // charge, so the part their pool does not cover is exactly its negative
    // side. Charges from draft/review/confirmed invoices are in there by
    // construction (page.tsx excludes only void).
    if (args.prepaidBalance != null) return args.prepaidBalance;
    return derivedBalanceItems(
      topups,
      trips.map((t) => toConsumingTrip(t, projectRate)),
      charges.map(toConsumingCharge),
    );
  }

  if (mode === "postpaid") {
    // POSTPAID — no pool to net against, so payable is the consumption that has
    // not been PAID FOR. Drafting, reviewing or confirming an invoice does not
    // reduce it; only Mark Paid does. That is precisely what the two existing
    // paid-flags already mean, so there is no new invoice-status predicate here.
    //
    // Same engine, no top-ups: derivedBalanceItems([], …) is credits minus
    // debits with the credits side empty, i.e. the negated VAT-inclusive
    // consumption of exactly this slice. It reuses consumingItems()'s
    // delivered-only filter and per-item rounding rather than restating either —
    // there is no second summation of money anywhere in this file.
    return derivedBalanceItems(
      [],
      trips.filter((t) => !t.invoiceLocked).map((t) => toConsumingTrip(t, projectRate)),
      charges.filter((ch) => !ch.paid).map(toConsumingCharge),
    );
  }

  return null;
}
