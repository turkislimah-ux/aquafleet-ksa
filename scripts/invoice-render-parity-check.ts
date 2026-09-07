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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildInvoicePdfHtml } from "../lib/invoicePdfTemplate";
import { buildInvoicePrintHtml } from "../lib/invoicePrintTemplate";
import type { PdfInvoiceData, PdfLine } from "../lib/invoiceViewModel";
import { t } from "../lib/i18n";
// The comment-aware lexer. NOT a hand-rolled grep — see CLAUDE.md §5 and case
// 9's note. It self-tests at import, so a broken stripper turns this file red
// rather than reporting a green all-clear.
import { liveHits, stripComments } from "./code-grep";

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
  // The two trips-table SUBTOTALS, VAT-inclusive — one per prepaid table.
  //
  // These used to sit inside a four-term `ledger` that also carried a `balance`
  // and a `remaining` per table, read off the frozen `*_ledger_balance_sar` /
  // `*_remaining_sar` columns and CHAINED (covered's Remaining seeded unpaid's
  // Balance). The three-row LAYOUT is back by Turki's ruling; the chain and the
  // frozen columns behind it are not. What replaced them: one paid-up figure,
  // handed in whole, shown in BOTH tables, each Remaining subtracting only its
  // own subtotal from it. Case 8 pins that with the arithmetic below.
  tripTotals: { covered: 11730, unpaid: 6095 },
  // Prepaid, so a figure prints. 40,000 deposited against 11,730 settled by
  // paid invoices — deliberately NOT 28,270-minus-anything derivable from the
  // rows above, because the paid-up balance is a property of the CUSTOMER and
  // no renderer may reconstruct it from the document.
  paidUpBalanceSar: 28270,
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
// unpaidLines), no trips-table feet, NO PAID-UP BALANCE (there is no pool to be
// paid up against), and a paid notice with a method.
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
  tripTotals: undefined,
  paidUpBalanceSar: null,
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

  // =========================================================================
  // 8 and 9 are the RUNNING-BALANCE REGRESSION GUARD, from both ends: 8 reads
  // the rendered documents, 9 reads the source that produces them.
  //
  // THE BUG THEY EXIST TO STOP: the invoice used to WALK a running balance of
  // its own — a Balance and a Remaining under each trips table, chained, so
  // covered's Remaining became unpaid's Balance. That walk started from a pool
  // the document could not see the whole of, so a customer's invoice and their
  // statement reported two different balances and both looked authoritative.
  //
  // THE LAYOUT IS NOT THE BUG, AND IT IS BACK. Turki restored the three inline
  // rows (Subtotal / balance / Remaining) verbatim; what stayed deleted is the
  // CHAIN and the frozen `*_ledger_balance_sar` / `*_remaining_sar` columns
  // feeding it. The balance row now carries the PAID-UP BALANCE, handed to the
  // document as one number: the SAME figure in both tables, each Remaining
  // subtracting only that table's own subtotal. The true running balance still
  // lives in the STATEMENT and on the Finance row and never on an invoice.
  //
  // So these checks moved from "no balance rows exist" to the sharper claim:
  // the rows exist, and the number in them is NOT walked. The forbidden-wording
  // check below and the no-chaining arithmetic together are what say that.
  //
  // A rendered check alone would not hold: a renderer could compute a walk and
  // print it under any wording. A source check alone would not hold either: the
  // strings live in i18n, not in the renderer. Both, or neither is worth much.
  // =========================================================================
  console.log("\n=== 8. RENDERED — no invoice prints a running balance ===");
  // The statement's OWN label, in both languages. It is legitimate there and
  // must never appear on an invoice; taking the forbidden token from the live
  // i18n leaf rather than hard-coding it means a reworded statement column
  // keeps this honest instead of quietly ceasing to guard anything.
  //
  // READ THE TEXT, NOT THE HTML. Both renderers carry a CSS comment naming the
  // paid-up line (it is the quietest block on the card and says why), so a raw
  // `html.includes(label)` reports every postpaid document as printing a
  // balance it does not print. textOf() drops <style> and <head> — the same
  // filter case 1 already trusts, reused rather than re-invented.
  const bodyText = (html: string) => textOf(html).join("\n");
  const forbidden = [t("trips.statement.colRunningBalance", "en"), t("trips.statement.colRunningBalance", "ar")];
  for (const [name, data] of CASES) {
    const both = bodyText(await buildInvoicePrintHtml(data)) + "\n" + bodyText(await buildInvoicePdfHtml(data));
    const found = forbidden.filter((f) => both.includes(f));
    check(`${name} — neither document says "Running Balance"`, found.length === 0, `found: ${JSON.stringify(found)}`);
  }
  // The positive half: the paid-up figure is on a PREPAID document ONCE PER
  // TRIPS TABLE — twice with both sections, and absent from a postpaid one.
  // "Absent" on its own is satisfied by a renderer that prints nothing at all.
  const sar = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const paidUpStr = sar(28270);
  const paidUpLbl = t("trips.invoiceSheet.paidUpBalance", "en");
  for (const [label, html] of [
    ["print", await buildInvoicePrintHtml(prepaid)],
    ["pdf", await buildInvoicePdfHtml(prepaid)],
  ] as const) {
    const n = bodyText(html).split(paidUpStr).length - 1;
    check(`prepaid ${label} — paid-up balance printed once per trips table, so twice (${n})`, n === 2);
  }
  // ── THE NO-CHAINING ASSERTION, and the reason section 8 still earns its keep
  // now that the rows are back. Both tables carry the SAME balance; each
  // Remaining subtracts only its OWN subtotal:
  //
  //   covered  28,270.00 − 11,730.00 = 16,540.00
  //   unpaid   28,270.00 −  6,095.00 = 22,175.00
  //
  // A restored CHAIN would print the unpaid table's balance as covered's
  // remainder (16,540.00) and its Remaining as 16,540.00 − 6,095.00 =
  // 10,445.00. That figure appears nowhere on a correct document and is
  // derivable no other way, which is what makes its absence evidence rather
  // than decoration. Both halves are asserted: the right numbers PRESENT and
  // the chained one ABSENT — absence alone is satisfied by a blank page.
  for (const [label, render] of [
    ["print", buildInvoicePrintHtml],
    ["pdf", buildInvoicePdfHtml],
  ] as const) {
    const body = bodyText(await render(prepaid));
    check(`prepaid ${label} — covered Remaining is 16,540.00`, body.includes(sar(16540)));
    check(`prepaid ${label} — unpaid Remaining is 22,175.00 (unchained)`, body.includes(sar(22175)));
    check(`prepaid ${label} — the CHAINED 10,445.00 appears nowhere`, !body.includes(sar(10445)));
  }
  for (const [label, html] of [
    ["print", await buildInvoicePrintHtml(postpaid)],
    ["pdf", await buildInvoicePdfHtml(postpaid)],
  ] as const) {
    check(`postpaid ${label} — no paid-up line at all`, !bodyText(html).includes(paidUpLbl));
  }
  // INVERTED — the absence above is a real filter, not an empty document.
  {
    const withFigure = await buildInvoicePrintHtml(prepaid);
    check("…and the SAME renderer does print it when the figure is there", bodyText(withFigure).includes(paidUpLbl));
  }
  // A PREPAID INVOICE NEVER LEAVES THE BALANCE SLOT EMPTY. This assertion is
  // the inverse of the one that stood here, and the flip is the fix: the old
  // check blessed "prepaid + null figure prints nothing", which is precisely
  // the state Turki hit — an invoice with no balance line and nothing saying
  // why, indistinguishable on the page from a postpaid invoice, which is what
  // let a mode that had silently resolved wrong look like a design decision.
  // Blank is now reserved for postpaid alone (asserted just above); prepaid
  // gets the figure or the reason there isn't one.
  const naLbl = t("trips.invoiceSheet.paidUpUnavailable", "en");
  for (const [label, render] of [
    ["print", buildInvoicePrintHtml],
    ["pdf", buildInvoicePdfHtml],
  ] as const) {
    const body = bodyText(await render({ ...prepaid, paidUpBalanceSar: null }));
    check(`prepaid ${label} with a null figure still occupies the balance slot`, body.includes(paidUpLbl));
    check(`…and says it is unavailable rather than printing a figure`, body.includes(naLbl));
    // A zero balance is a REAL reading and must not borrow the unavailable
    // wording — the one confusion this arm exists to prevent.
    const zero = bodyText(await render({ ...prepaid, paidUpBalanceSar: 0 }));
    check(`prepaid ${label} with a ZERO balance prints the figure, not the note`, zero.includes(paidUpLbl) && !zero.includes(naLbl));
    // …and postpaid stays blank even in the unavailable arm: null there is a
    // mode, not a failure.
    const post = bodyText(await render({ ...postpaid, paidUpBalanceSar: null }));
    check(`postpaid ${label} prints neither the balance nor the note`, !post.includes(paidUpLbl) && !post.includes(naLbl));
  }
  // THE WHOLE MATRIX, because the cases above pin ONE status with the hide
  // toggle OFF and a positive figure. Every axis here was a live suspect while
  // the missing paid-up line was being hunted, and each was cleared by running
  // it rather than by reading the template:
  //
  //   status         — `paid` and `void` take the frozen as-of arm upstream,
  //                    and `draft` has no invoice number, so all five run.
  //   hideAmountDue  — a PRINT-ONLY suppression that drops the whole Unpaid
  //                    Trips SECTION from the vm, taking one of the two
  //                    footers with it. So the expected count is not a
  //                    constant: two rows normally, ONE under the toggle, and
  //                    that one has to be the covered table's. A renderer that
  //                    hung the balance row off the unpaid branch would print
  //                    nothing at all on exactly the four live invoices
  //                    carrying the toggle and nowhere else — which is why the
  //                    count, not mere presence, is what is asserted.
  //   sign           — 0 must print, not be swallowed by a truthiness test on
  //                    the amount; negative is a real state (an over-drawn
  //                    pool) and must print too. `null` is in this list for the
  //                    same reason and is the case that actually broke: it is
  //                    the ONE value that used to print nothing, and it printed
  //                    nothing at every status and both toggle positions.
  //
  // 40 assertions per renderer. They are cheap, and the alternative is reading
  // two template files and believing the answer.
  for (const status of ["draft", "review", "confirmed", "paid", "void"] as const) {
    for (const hideAmountDue of [false, true]) {
      for (const figure of [28270, 0, -1200, null]) {
        const data: PdfInvoiceData = { ...prepaid, status, hideAmountDue, paidUpBalanceSar: figure };
        const label = `${status}/hide=${hideAmountDue}/${figure}`;
        const want = hideAmountDue ? 1 : 2;
        for (const [r, render] of [
          ["print", buildInvoicePrintHtml],
          ["pdf", buildInvoicePdfHtml],
        ] as const) {
          const n = bodyText(await render(data)).split(paidUpLbl).length - 1;
          check(`prepaid ${label} — ${r} keeps the balance row in every trips table (${n}/${want})`, n === want);
        }
      }
    }
  }

  console.log("\n=== 9. SOURCE — the walk is gone from the code, not just hidden ===");
  // Comments are stripped first. Every one of these files carries prose
  // explaining the removal, and an epitaph matching the very name it buries is
  // how this class of check has reported a completed deletion as a failure four
  // times in this repo (CLAUDE.md §5).
  const SCAN = [
    "lib/invoice.ts",
    "lib/invoiceViewModel.ts",
    "lib/invoicePdfTemplate.ts",
    "lib/invoicePrintTemplate.ts",
    "app/trips/InvoiceDetailModal.tsx",
  ];
  // `runningBalance` is the i18n leaf the walk printed under, and the three
  // `*LedgerTotals` are the types that carried its four-term foot. Any of them
  // back in live code means the mechanism is back.
  //
  // `remaining` IS NOT ON THIS LIST, and dropping it was the deliberate edit
  // when the layout was restored. It is a live label again — the third row of
  // every prepaid foot — so scanning for it would fail on correct code, and a
  // check that fails when the code is right gets widened until it guards
  // nothing. The word was never the bug; the WALK was, and the walk is what
  // `runningBalance` and the three types name.
  const NEEDLES = ["runningBalance", "InvoiceLedgerTotals", "PdfLedgerTotals", "DisplayLedgerTotals"];
  for (const rel of SCAN) {
    const src = readFileSync(join(process.cwd(), rel), "utf8");
    for (const needle of NEEDLES) {
      const hits = liveHits(src, needle, "ts");
      check(
        `${rel} — no live \`${needle}\``,
        hits.length === 0,
        hits.map((h) => `${rel}:${h.line}: ${h.text}`).join("\n        "),
      );
    }
  }
  // INVERTED — the scanner can still find something. Without this, a broken
  // stripper that returned "" would print the greenest report in the file.
  {
    const planted = liveHits("const runningBalance = walk(pool);", "runningBalance", "ts");
    check("the scanner finds a planted walk", planted.length === 1);
    const buried = liveHits("// runningBalance was deleted here\nconst a = 1;", "runningBalance", "ts");
    check("…and does NOT find the comment announcing its deletion", buried.length === 0);
  }

  console.log("\n=== 10. PDF CACHE — one key expression, and it is versioned ===");
  // NOT a rendering check, and here anyway, because this is what actually broke.
  // getInvoicePdf() stores rendered bytes for paid/void invoices and nothing
  // re-renders them when the TEMPLATE changes — so four prepaid invoices went on
  // serving documents from before the paid-up line existed, showing no balance
  // at all no matter how correct sections 7 and 8 above had become. Every check
  // in this file passes while that is true; only the key version fixes it.
  //
  // Two properties, both mechanical: the path is built in ONE place (four sites
  // shared a hand-written template literal, and an invalidation that missed the
  // version would silently stop invalidating), and it carries the version.
  {
    const src = readFileSync(join(process.cwd(), "app/trips/invoiceActions.ts"), "utf8");
    const handRolled = liveHits(src, "${invoiceId}.pdf", "ts");
    check(
      "invoiceActions — no hand-built cache path bypassing pdfCachePath()",
      handRolled.length === 0,
      handRolled.map((h) => `:${h.line}: ${h.text}`).join("\n        "),
    );
    check("…and the one path expression carries the template version", liveHits(src, "PDF_CACHE_VERSION", "ts").length >= 2);
  }

  console.log("\n=== 11. PAY-WITH-BALANCE PANEL — previews the payment, not a frozen column ===");
  // The panel promises the balance a payment will leave behind. It may only
  // subtract the figure the payment itself subtracts — `settlementSar`, summed
  // server-side by lib/prepaid's `settlementGross`, which IS paidUpCore's debit
  // side. `view.grand.total` is the stored `grand_total_sar`, and on invoices
  // frozen by the covered-only engine that column EXCLUDES lines the document
  // lists: 026-000017 previewed 7,544.00 against a real 8,694.00 draw-down,
  // 026-000009 previewed 0.00 against 4,761.00.
  //
  // SCOPED TO THE PANEL, deliberately. `grand.total` is correct and live
  // elsewhere in this file — the Grand Total stack is literally that figure —
  // so a whole-file scan would fail on right code, and a check that fails on
  // right code gets widened until it guards nothing (see section 9).
  {
    const rel = "app/trips/InvoiceDetailModal.tsx";
    const src = readFileSync(join(process.cwd(), rel), "utf8");
    const open = liveHits(src, "payingOpen && isPrepaid", "ts");
    const close = liveHits(src, "payingOpen && !isPrepaid", "ts");
    check("the prepaid pay panel is locatable, exactly once", open.length === 1 && close.length === 1);
    check("…and the postpaid form follows it", open.length === 1 && close.length === 1 && open[0].line < close[0].line);

    if (open.length === 1 && close.length === 1 && open[0].line < close[0].line) {
      // stripComments preserves line numbering (liveHits maps stripped lines
      // back onto source lines), so slicing the stripped text by those line
      // numbers yields the panel's CODE with its prose removed — which matters
      // here, because the comment above the panel discusses `grand.total` by
      // name to explain why it is not used.
      const panel = stripComments(src, "ts").split("\n").slice(open[0].line - 1, close[0].line - 1).join("\n");
      check("the panel does NOT read grand.total", !panel.includes("grand.total"));
      check("…and DOES subtract the server-computed settlementSar", panel.includes("settlementSar"));
    }

    // INVERTED — a slice that always came back empty would pass the first check
    // forever. Plant the old reading and the same test must reject it.
    const planted = stripComments("<span>{formatSar(view.grand.total)}</span>", "ts");
    check("the scan rejects a planted grand.total", planted.includes("grand.total"));
  }

  console.log(failures === 0 ? "\nAll parity checks passed." : `\n${failures} FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
