// Inventory (parts) VAT — PURE math, no Supabase/Next/I-O. Mirrors
// lib/prepaid.ts's own discipline (pure functions, no I/O).
//
// DELIBERATELY SEPARATE FROM lib/vat.ts. That file computes DOCUMENT-LEVEL
// VAT for customer invoices — subtotal summed first, VAT rounded ONCE
// against that subtotal (its own header quotes ZATCA's invoice-XML rule:
// "rounded on document level and not as a summation of rounded Invoice
// line VAT amounts"). Turki's own explicit rule for PARTS VAT is the
// opposite: each line's VAT is rounded PER LINE, and the document VAT is
// the SUM of those already-rounded line VATs — never a fresh
// round(subtotal * rate, 2). Two genuinely different, both-correct
// conventions for two different documents (customer invoices vs. supplier
// purchase/receiving records) — forcing parts VAT through
// lib/vat.ts's calculateVat() would silently apply the wrong one.
//
// This file borrows ONLY the 15% rate from lib/prepaid.ts (a read, an
// import — not a modification of that file, and lib/vat.ts/prepaid.ts/
// invoice.ts are never touched by anything in this file or its callers).
// Its own rounding is round-half-up to 2 decimals — same arithmetic
// Postgres's round(numeric, 2) and lib/prepaid.ts's Math.round-based
// round2() both already use for positive amounts, so the SQL side
// (migration 0056's receive_loose_parts/create_purchase_order/
// receive_purchase_order) and this TS side agree without sharing code.
//
// STORAGE VS. DISPLAY — this file is used for BOTH:
//   - Live client-side preview (New PO draft, Add Part's cost readout)
//     before anything is saved — the RPC always recomputes/stores the
//     real figures server-side at write time (0056); this is preview only.
//   - Display-only re-derivation for figures that were never stored (FIFO
//     price_lots batches, per-part purchase-history rows built from
//     already-stored purchase_order_lines/stock_receipt_lines columns).
// Never used for: stock value, pricing snapshot (parts.unit_cost_sar/
// price_lots.price_sar), inventory value, financial analysis, any
// consumption figure, or price trend — those stay VAT-free by design
// (0056's own header) and this file is never imported by any of that math.

import { VAT_RATE } from "./prepaid";
import { formatNum } from "./utils";
export { VAT_RATE };

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// This app's own formatSar() (lib/utils.ts) rounds to WHOLE SAR — the
// established convention for every other money figure here (CLAUDE.md's
// own deviation note: "every other SAR figure in this app is whole-number",
// the ONE prior exception being weighted-avg-cost's own 2-decimal display).
// VAT is a second, genuine exception: a 15% tax figure needs halala
// precision to be an honest booked amount (37.50 shown as "38" would
// misrepresent what was actually charged) — same `formatNum(x, 2) + " SAR"`
// pattern the avgCost display already uses, reused here rather than
// inventing a third convention.
export function formatSarVat(n: number): string {
  return `${formatNum(n, 2)} SAR`;
}

// Per-line VAT = 15% of (unit price x qty), rounded HERE, per line — the
// one formula every call site in this file (and migration 0056's SQL)
// shares.
export function lineVat(qty: number, unitPriceSar: number): number {
  return round2(qty * unitPriceSar * VAT_RATE);
}

export function lineSubtotal(qty: number, unitPriceSar: number): number {
  return round2(qty * unitPriceSar);
}

export type InventoryVatLine = { qty: number; unitPriceSar: number };

export type InventoryVatDocument = {
  subtotal: number; // sum of per-line subtotals (each already rounded)
  vat: number; // sum of per-line VATs (each already rounded) — NEVER round(subtotal * VAT_RATE, 2)
  total: number; // subtotal + vat
};

// Document-level rollup for a New PO draft / any client-side preview of a
// set of lines before they're saved. Same per-line-then-summed rule the
// RPCs use server-side — this is a preview of what the RPC will store, not
// a second source of truth for anything already saved.
export function calculateInventoryVatDocument(lines: InventoryVatLine[]): InventoryVatDocument {
  let subtotal = 0;
  let vat = 0;
  for (const l of lines) {
    subtotal += lineSubtotal(l.qty, l.unitPriceSar);
    vat += lineVat(l.qty, l.unitPriceSar);
  }
  subtotal = round2(subtotal);
  vat = round2(vat);
  return { subtotal, vat, total: round2(subtotal + vat) };
}
