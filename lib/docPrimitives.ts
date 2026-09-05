// DOCUMENT PRIMITIVES — the four expressions every printable renderer needs,
// in ONE place so two surfaces cannot format the same number two ways.
//
// These lived privately inside lib/invoicePdfTemplate.ts while there was only
// one document renderer. There are now two (the Aquaglass download and the
// plain print sheet) and a statement is next, so they move here rather than
// being copied. That matters most for `num2`: the download, the print sheet
// and the statement are all TAX documents, and a halala that one of them
// rounds away while another prints it is exactly the silent divergence
// lib/invoiceViewModel.ts exists to prevent. The view-model hands over RAW
// numbers precisely so the formatting decision is made once per MEDIUM — and
// print and PDF are the same medium.
//
// Purity: no fs, no React, no `process`. Importable from a server action, a
// client component, or a test script alike.

import { type BiLabel } from "./invoiceViewModel";

/** HTML-escapes a value destined for a template literal. */
export function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// BARE 2-decimal money, no currency suffix — a column header carries "(SAR)"
// and the Amount Due figure carries its own currency chip, so repeating "SAR"
// on every cell is noise in a table that is entirely one currency.
//
// TWO DECIMALS, deliberately diverging from the sheet's whole-riyal formatSar:
// this is the tax document. A halala the screen rounds away has to be visible
// on the invoice the customer pays and the auditor reads.
export function num2(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Plain integer/qty rendering — no forced decimals. */
export function numPlain(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

// The one bilingual building block: English, then the Arabic underneath or
// alongside depending on the class the caller picks. `unicode-bidi: isolate`
// on `.ar` (declared by each stylesheet) is what stops an Arabic run from
// reordering the Latin text next to it — without it a label like
// "Tel +966 11 ..." renders its number on the wrong side of the Arabic word.
export function bl(l: BiLabel, arClass = "ar"): string {
  return `${esc(l.en)}<span class="${arClass}" dir="rtl">${esc(l.ar)}</span>`;
}

/** An EM DASH for a figure that genuinely does not exist. Never a zero. */
export const DASH = "—";
