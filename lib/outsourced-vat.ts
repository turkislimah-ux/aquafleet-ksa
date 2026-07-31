// Outsourced-jobs (workshop payments) VAT — PURE math, no Supabase/Next/I-O.
// Mirrors lib/inventory-vat.ts's own discipline and its own header's rule:
// "borrows ONLY the rate from lib/prepaid.ts (a read, an import — not a
// modification of that file)". Same here — lib/prepaid.ts/vat.ts/invoice.ts
// are never touched by anything in this file or its callers.
//
// DELIBERATELY SEPARATE FROM lib/vat.ts AND lib/inventory-vat.ts. Turki's
// spec for workshop payments: "Total-level, not per-item" — the app enters
// ONE subtotal per payment (the whole vendor invoice), not itemized lines,
// so there is no per-line-vs-document rounding question to answer here at
// all — just round(subtotal * VAT_RATE, 2), once, for that one figure.
//
// This money is EXTERNAL/VENDOR AP, VAT-INCLUSIVE — it must never mix with
// Inventory's internal, VAT-exclusive parts cost (lib/inventory-vat.ts) or
// customer-facing invoice VAT (lib/vat.ts) in any shared total. Nothing in
// this file imports either of those, and nothing outside app/maintenance
// should import this file.

import { VAT_RATE } from "./prepaid";
export { VAT_RATE };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type WorkshopPaymentTotals = {
  subtotal_sar: number;
  vat_sar: number;
  discount_sar: number;
  grand_total_sar: number;
};

// One computation, one place — the DB's own CHECK
// (grand_total_sar = subtotal_sar + vat_sar - discount_sar, migration 0071)
// is the authoritative floor; this is what the form uses to arrive at
// numbers that will actually pass it, computed from the user's entered
// subtotal + discount. VAT is STILL computed on the FULL subtotal — the
// discount only affects the final grand total, never the VAT figure
// itself (migration 0071's own explicit rule).
export function computeWorkshopPaymentTotals(subtotalSar: number, discountSar = 0): WorkshopPaymentTotals {
  const subtotal = round2(subtotalSar);
  const vat = round2(subtotal * VAT_RATE);
  const discount = round2(discountSar);
  return {
    subtotal_sar: subtotal,
    vat_sar: vat,
    discount_sar: discount,
    grand_total_sar: round2(subtotal + vat - discount),
  };
}
