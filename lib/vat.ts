// VAT calculation layer (spec §9, KSA 15%). Pure math, no I/O — mirrors
// lib/prepaid.ts's discipline (pure functions, own test harness before UI).
//
// STALE (pre-v3) claim corrected: the prepaid balance is NO LONGER pre-VAT
// only (PRD v3 §2 — balance consumption reversed to VAT-INCLUSIVE: a trip/
// charge draws `amount * (1 + VAT_RATE)` from balance, not `amount`). This
// file's OWN math stays a genuinely separate concern though — DOCUMENT-LEVEL
// invoice-display VAT (subtotal summed first, VAT rounded ONCE against that
// subtotal), never per-item. lib/prepaid.ts's v3 consumption math needs the
// same VAT_RATE constant, so VAT_RATE is now canonically DEFINED in
// lib/prepaid.ts (alongside round2, which already flowed that direction) and
// re-exported from here — one constant, one direction of flow, no circular
// import. This file still never touches lib/prepaid.ts's per-item
// consumption math or stored rows — it only computes VAT for DISPLAY at the
// invoice/statement layer, from pre-VAT inputs (covered/billed trip rates +
// special charges) that the invoice layer (Commit 5) assembles and passes in.
//
// ROUNDING CONVENTION — DOCUMENT-LEVEL, not per-line-summed (ZATCA-correct):
// ZATCA's Electronic Invoice XML Implementation Standard states the VAT
// category tax amount (BT-110) "shall be rounded on document level and not
// as a summation of rounded Invoice line VAT amounts" — i.e. sum the pre-VAT
// taxable base first, apply the rate ONCE, round ONCE. Formula per ZATCA:
// TaxAmount = ROUND(TaxableAmount × 0.15, 2). This file follows that exactly:
// subtotal is summed first (all lines pre-VAT), VAT is computed and rounded
// once against that subtotal. Per-line VAT figures are still returned (an
// invoice line legitimately shows its own VAT for readability) but they are
// DISPLAY-ONLY — they are never summed to produce the invoice total, and can
// legitimately differ from a naive per-line sum by a halala or two (that
// divergence is exactly what the harness proves, and why per-invoice is the
// correct choice here).
//
// ROUNDING MODE — round-half-up (a.k.a. round-half-away-from-zero), 2
// decimals (halalas). This is standard arithmetic rounding — what ZATCA's
// ROUND(x, 2) means, and what every spreadsheet/invoicing tool defaults to —
// NOT banker's rounding (round-half-to-even). Reuses lib/prepaid.ts's round2
// (Math.round-based, already half-up) rather than redefining it, so every
// money value across the Finance feature rounds identically.

import { round2, VAT_RATE } from "./prepaid";
export { round2, VAT_RATE };

export type VatLineItem = {
  id: string;
  description?: string;
  amount_sar: number; // pre-VAT
};

// Per-line VAT figure — DISPLAY ONLY (see file header). Not used to derive
// vatAmount/grandTotal below; those come from the document-level subtotal.
export type VatLinePreview = VatLineItem & { lineVat: number };

export type VatBreakdown = {
  subtotal: number; // pre-VAT, sum of all line items
  vatAmount: number; // subtotal * VAT_RATE, rounded ONCE (document-level)
  grandTotal: number; // subtotal + vatAmount
  lines: VatLinePreview[]; // display-only per-line VAT breakdown
};

/**
 * Document-level VAT breakdown for an invoice/statement. Takes pre-VAT line
 * items (billed/covered trip rates, special charges — caller assembles the
 * mix, this function doesn't care which) and returns subtotal/VAT/grand
 * total plus a display-only per-line VAT breakdown.
 */
export function calculateVat(lineItems: VatLineItem[]): VatBreakdown {
  const subtotal = round2(lineItems.reduce((s, l) => s + l.amount_sar, 0));
  const vatAmount = round2(subtotal * VAT_RATE);
  const grandTotal = round2(subtotal + vatAmount);
  const lines: VatLinePreview[] = lineItems.map((l) => ({
    ...l,
    lineVat: round2(l.amount_sar * VAT_RATE),
  }));
  return { subtotal, vatAmount, grandTotal, lines };
}
