// THE 0%-DEVIATION CONTRACT, MADE FALSIFIABLE. No DB, no test framework.
// Run:  npx tsx scripts/invoice-render-parity-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).
//
// MUST RUN FROM THE REPO ROOT — lib/invoicePdfTemplate.ts inlines its fonts
// with readFileSync off process.cwd(), because PDFShift fetches that HTML
// standalone. The print sheet has no such constraint (same-origin, /fonts/*),
// which is exactly the kind of asymmetry this file exists to keep harmless.
//
// WHAT IS BEING GUARDED
// ---------------------
// lib/invoiceViewModel.ts decides WHAT an invoice says, in WHAT order, grouped
// WHICH way, in WHICH words. lib/invoicePdfTemplate.ts (the download) and
// lib/invoicePrintTemplate.ts (Ctrl+P) choose LOOK ONLY. Two renderers over one
// model is a promise that nothing enforces on its own: the previous drift —
// the download growing its own labels, its own grouping, its own column count —
// was invisible until someone held a printout beside a PDF.
//
// So case 1 strips both documents to their TEXT and requires the two token
// multisets to be identical. Ink, geometry and font plumbing differ freely; a
// single word, figure or row that appears in one and not the other fails.
//
// AND THE COMPARISON PROVES IT CAN FAIL. Case 2 feeds the two renderers
// DELIBERATELY DIFFERENT data and requires the diff to speak. Without it,
// "(none) / (none)" is equally consistent with perfect agreement and with a
// tokenizer that returns two empty arrays — and the broken version reads
// greener than the working one. Case 3 asserts the token count is non-trivial
// for the same reason from the other side.
//
// Case 4 is the money law (`1754140`): grand = covered + amountDue, with every
// line — trips AND special charges — inside the grand total. The superseded
// structure it rules out is the pre-fix one, where the charge sat OUTSIDE the
// services total; a mockup still shows that layout, so this is worth pinning.
//
// Case 5 pins the hero figure across the three states that change it, because
// `vm.amountDue === null` is the single predicate standing in for "postpaid OR
// the hide toggle is on" and a renderer testing status or mode itself would be
// a fourth place for the rule to live.

import { buildInvoicePdfHtml } from "../lib/invoicePdfTemplate";
import { buildInvoicePrintHtml } from "../lib/invoicePrintTemplate";
import type { PdfInvoiceData, PdfLine } from "../lib/invoiceViewModel";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
}

// ---------------------------------------------------------------------------
// Fixtures — shaped like the real thing, invented so no DB is needed
// ---------------------------------------------------------------------------

const seller = {
  name: "Bin Slimah Group for Water Transport",
  name_ar: "مجموعة بن سليمة لنقل المياه",
  vat_number: "300012345600003",
  cr_number: "1010123456",
  address: "Al Malaz District, Riyadh 12836, Saudi Arabia",
  description: "Water transport and treatment services",
  telephone: "011 456 7890",
  phone: "055 123 4567",
};

const buyer = {
  name: "Seder Facility Management Co.",
  name_ar: "شركة سدر لإدارة المرافق",
  vat_number: "310098765400003",
  cr_number: "1010987654",
  address: "Exit 10, Eastern Ring Road, Riyadh",
};

const trip = (i: number, qty: number, price: number): PdfLine => ({
  id: `trip-${i}`,
  kind: "trip",
  trip_date: `2026-06-${String(10 + i).padStart(2, "0")}`,
  description: `Water delivery — Site ${i}`,
  amount_sar: qty * price,
  vat_sar: round2(qty * price * 0.15),
  ref: `TR-2026-0${100 + i}`,
  water_type: "potable",
  quantity: qty,
  price_sar: price,
});

const charge = (i: number, label: string, qty: number, price: number, covered: boolean): PdfLine => ({
  id: `charge-${i}`,
  kind: "charge",
  trip_date: `2026-06-${18 + i}`,
  description: label,
  amount_sar: qty * price,
  vat_sar: round2(qty * price * 0.15),
  quantity: qty,
  price_sar: price,
  covered,
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const totals = (sub: number) => ({ subtotal: sub, vat: round2(sub * 0.15), total: round2(sub * 1.15) });

// Prepaid: trips split covered/unpaid, one covered charge and one that rolls
// forward, a frozen ledger, and a bank account flagged for the invoice.
const prepaid: PdfInvoiceData = {
  status: "confirmed",
  paymentMode: "prepaid",
  invoiceNumber: "026-000009",
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  issueDate: "2026-07-01",
  seller,
  buyer,
  buyerEmail: "accounts@seder.example",
  coveredLines: [trip(1, 12, 450), trip(2, 8, 450)],
  unpaidLines: [trip(3, 10, 450)],
  chargeLines: [
    charge(0, "Standby waiting time", 4, 300, true),
    charge(1, "After-hours delivery surcharge", 2, 400, false),
  ],
  covered: totals(10200),
  amountDue: totals(5300),
  grand: totals(15500),
  ledger: {
    covered: { subtotal: 11730, balance: 40000, remaining: 28270 },
    unpaid: { subtotal: 6095, balance: null, remaining: null },
  },
  bankAccounts: [
    {
      id: "bank-1",
      bank_name: "Al Rajhi Bank",
      holder_name: "Bin Slimah Group for Water Transport",
      iban: "SA0380000000608010167519",
      show_on_invoice: true,
    },
  ],
  hideAmountDue: false,
  paymentMethod: null,
  paidAt: null,
  voidReason: null,
  projectWaterType: "potable",
  voidedAt: null,
};

// Postpaid: no covered arm, no separate charge section (charges ride in
// unpaidLines), no ledger, and a paid notice with a method.
const postpaid: PdfInvoiceData = {
  ...prepaid,
  status: "paid",
  paymentMode: "postpaid",
  invoiceNumber: "026-000010",
  coveredLines: [],
  unpaidLines: [trip(1, 12, 450), trip(2, 8, 450), trip(3, 10, 450), charge(0, "Standby waiting time", 4, 300, false)],
  chargeLines: [],
  covered: totals(0),
  amountDue: totals(14700),
  grand: totals(14700),
  ledger: undefined,
  paymentMethod: "bank_transfer",
  paidAt: "2026-07-14",
};

// Void: the sales-return notice, the one status that prints a reason.
const voided: PdfInvoiceData = {
  ...prepaid,
  status: "void",
  invoiceNumber: "026-000011",
  voidReason: "Duplicate of 026-000009",
  voidedAt: "2026-07-20",
};

// Draft: no number, no issue date, no bank rows to show.
const draft: PdfInvoiceData = {
  ...prepaid,
  status: "draft",
  invoiceNumber: null,
  issueDate: null,
  bankAccounts: [],
};

const CASES: ReadonlyArray<readonly [string, PdfInvoiceData]> = [
  ["prepaid / confirmed", prepaid],
  ["prepaid / hide amount due", { ...prepaid, hideAmountDue: true }],
  ["postpaid / paid", postpaid],
  ["prepaid / void", voided],
  ["prepaid / draft, no bank", draft],
];

// ---------------------------------------------------------------------------
// Tokenizer — everything a reader would READ, nothing they would only SEE
// ---------------------------------------------------------------------------
// THREE THINGS ARE REMOVED, AND EACH ONE IS A LOOK DIFFERENCE THE CONTRACT
// EXPLICITLY ALLOWS. They are listed rather than quietly dropped, because
// "widen the filter until it passes" is how a parity test becomes decoration.
//
//   <head>  — the plain sheet carries a <title> (it is a standalone document
//             and the browser shows that string in the print dialog); the PDF
//             is fetched by PDFShift and has none. Nothing in <head> is on the
//             page. Whole element goes, not just the title, so a future <meta>
//             cannot sneak a difference in either.
//   <style> — the entire point. The two are supposed to look different.
//   <svg>   — carries no words. It is also where the LOOK genuinely diverges:
//             the download prints a decorative water-droplet glyph and the
//             plain sheet prints no ornament at all, by design. Case 6 asserts
//             the QR itself survives on both rather than diffing it here.

function textOf(html: string): string[] {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// Multiset difference — a token appearing TWICE in one document and once in the
// other is a real divergence, so `includes` would be too lenient.
function surplus(a: string[], b: string[]): string[] {
  const pool = new Map<string, number>();
  for (const s of b) pool.set(s, (pool.get(s) ?? 0) + 1);
  const out: string[] = [];
  for (const s of a) {
    const n = pool.get(s) ?? 0;
    if (n === 0) out.push(s);
    else pool.set(s, n - 1);
  }
  return out;
}

function heroOf(html: string): string {
  const m = html.match(/<div class="lab">([\s\S]*?)<\/div>\s*<div class="amt"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) return "NO HERO";
  const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return `${strip(m[1])} = ${strip(m[2])}`;
}

// ---------------------------------------------------------------------------

async function main() {
  console.log("=== 1. Print and download say the SAME THING ===");
  let minTokens = Number.POSITIVE_INFINITY;
  for (const [name, data] of CASES) {
    const p = textOf(await buildInvoicePrintHtml(data));
    const d = textOf(await buildInvoicePdfHtml(data));
    minTokens = Math.min(minTokens, p.length);
    const onlyPrint = surplus(p, d);
    const onlyPdf = surplus(d, p);
    check(
      `${name} — ${p.length} tokens, identical`,
      onlyPrint.length === 0 && onlyPdf.length === 0,
      `print-only: ${JSON.stringify(onlyPrint)}\n        pdf-only:   ${JSON.stringify(onlyPdf)}`,
    );
  }

  console.log("\n=== 2. INVERTED — the comparison above can FAIL ===");
  const a = textOf(await buildInvoicePrintHtml(prepaid));
  const b = textOf(await buildInvoicePdfHtml({ ...prepaid, invoiceNumber: "026-DIFFERENT" }));
  const diff = surplus(a, b);
  check(
    "perturbing one field makes the diff speak",
    diff.length > 0,
    "the tokenizer or the differ is broken — case 1's green means nothing",
  );

  console.log("\n=== 3. The documents are not empty ===");
  check(`every case yields > 100 text tokens (min ${minTokens})`, minTokens > 100);

  console.log("\n=== 4. Money law 1754140 — grand = covered + due, charges INSIDE ===");
  for (const [name, data] of [
    ["prepaid", prepaid],
    ["postpaid", postpaid],
  ] as const) {
    check(
      `${name} — covered + amountDue = grand`,
      round2(data.covered.total + data.amountDue.total) === round2(data.grand.total),
      `${data.covered.total} + ${data.amountDue.total} != ${data.grand.total}`,
    );
  }
  // The structural half: every line's pre-VAT value is inside the grand
  // subtotal. The superseded layout added Special Charges AFTER the total.
  const lineSum = round2(
    [...prepaid.coveredLines, ...prepaid.unpaidLines, ...prepaid.chargeLines].reduce((s, l) => s + l.amount_sar, 0),
  );
  check(
    "every trip AND charge line is inside the grand subtotal",
    lineSum === round2(prepaid.grand.subtotal),
    `lines ${lineSum} != grand subtotal ${prepaid.grand.subtotal}`,
  );

  console.log("\n=== 5. Hero figure follows vm.amountDue, nothing else ===");
  const heroCases: ReadonlyArray<readonly [string, PdfInvoiceData, "due" | "total"]> = [
    ["prepaid, toggle off", prepaid, "due"],
    ["prepaid, toggle ON", { ...prepaid, hideAmountDue: true }, "total"],
    ["postpaid", postpaid, "total"],
  ];
  for (const [name, data, want] of heroCases) {
    const html = await buildInvoicePrintHtml(data);
    const hero = heroOf(html);
    const wantAmt = want === "due" ? data.amountDue.total : data.grand.total;
    const shows = hero.includes(wantAmt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    check(`${name} — hero is the ${want === "due" ? "Amount Due" : "grand total"}: ${hero}`, shows);
  }

  console.log("\n=== 6. QR survives on both, and the plain sheet has NO ornament ===");
  for (const [name, data] of CASES) {
    const printHtml = await buildInvoicePrintHtml(data);
    const pdfHtml = await buildInvoicePdfHtml(data);
    const n = (h: string) => (h.match(/<svg/g) ?? []).length;
    // Exactly one on the plain sheet: the QR. More than one means a graphic
    // crept into a document whose whole premise is that it photocopies.
    check(`${name} — print has exactly 1 svg (the QR), pdf has ${n(pdfHtml)}`, n(printHtml) === 1 && n(pdfHtml) >= 1);
  }

  console.log("\n=== 7. Mono by construction — no colour anywhere in the plain sheet ===");
  // A hex or rgb() outside the grey ramp is a design regression this file can
  // catch for free. Greys are r == g == b; the ink scale is slightly blue and
  // is listed explicitly so adding a new one is a deliberate edit here too.
  const ALLOWED = new Set(["#0d1526", "#334155", "#64748b", "#cbd5e1", "#e2e8f0", "#eef2f7", "#94a3b8", "#fff", "#ffffff", "#000", "#ffffff00"]);
  const sheet = await buildInvoicePrintHtml(prepaid);
  // THE LOOKAHEAD IS LOAD-BEARING. vm.invoiceRef is "#026-000009" — a document
  // number that opens with three hex-shaped digits, so a plain `\b` boundary
  // clips it to "#026" and reports the INVOICE NUMBER as a stray colour. The
  // check then fails on a healthy sheet, which reads exactly like a real
  // regression. Reject anything still followed by a hex digit or a hyphen.
  const hexes = [...new Set((sheet.match(/#[0-9a-fA-F]{3,8}(?![0-9a-fA-F-])/g) ?? []).map((h) => h.toLowerCase()))]
    .filter((h) => !ALLOWED.has(h) && !/^#([0-9a-f])\1{2,7}$/.test(h));
  check("no unexpected hex colours", hexes.length === 0, `found: ${JSON.stringify(hexes)}`);
  const rgbs = [...new Set(sheet.match(/rgba?\([^)]*\)/g) ?? [])];
  check("no rgb()/rgba() colours", rgbs.length === 0, `found: ${JSON.stringify(rgbs)}`);
  const grads = (sheet.match(/gradient/gi) ?? []).length;
  check("no gradients", grads === 0, `found ${grads}`);

  console.log(failures === 0 ? "\nAll parity checks passed." : `\n${failures} FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
