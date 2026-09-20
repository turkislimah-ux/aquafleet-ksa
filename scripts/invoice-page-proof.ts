// PAGE PROOF for the ledger-era invoice document.
//
// The invoice is NOT part of the ATLAS corpus (`npm run doc:render` →
// doc-a4-proof), because it is not an ATLAS sheet: it has its own shell
// (lib/plainDocStyles.ts) and its own two renderers. So "did the settlement
// pair push the invoice onto a second page" had no standing answer. This file
// measures it the way doc-a4-proof does — print to A4 through Chrome, count
// the PDF's own /Type /Page objects — so the number comes off paginated paper
// rather than a viewport, which cannot see a page break at all.
//
// BOTH SURFACES, EVERY CASE. The download (PDFShift HTML) and the print sheet
// are two files; a settlement row that fits on one and not the other is
// exactly the asymmetry worth catching, and it is invisible if only one is
// measured.
//
// Run from the repo root — lib/invoicePdfTemplate.ts inlines its fonts with
// readFileSync off process.cwd():
//   npx tsx scripts/invoice-page-proof.ts
//
// It ASSERTS NOTHING and is deliberately not in `npm test`: there is no
// committed page-count baseline for invoices, and a proof that reports is
// honest where a proof that passes against no baseline is not. Read the
// numbers.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

import { buildInvoicePdfHtml } from "../lib/invoicePdfTemplate";
import { buildInvoicePrintHtml } from "../lib/invoicePrintTemplate";
import type { PdfInvoiceData, PdfLine } from "../lib/invoiceViewModel";

const OUT = "/tmp/invoice-page-proof";
mkdirSync(OUT, { recursive: true });

const round2 = (n: number): number => Math.round(n * 100) / 100;

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
  trip_date: `2026-06-${String((i % 28) + 1).padStart(2, "0")}`,
  description: `Water delivery — Site ${i}`,
  amount_sar: qty * price,
  vat_sar: round2(qty * price * 0.15),
  ref: `TR-2026-0${100 + i}`,
  water_type: "potable",
  quantity: qty,
  price_sar: price,
});

const totals = (sub: number) => ({ subtotal: sub, vat: round2(sub * 0.15), total: round2(sub * 1.15) });

/**
 * n trips of 10 × 450 = 4,500 net each.
 *
 * ROW COUNT IS NOT TRIP COUNT. groupInvoiceLines() collapses trips by per-trip
 * RATE, so 24 trips at one rate print ONE row and stress nothing. `vary` gives
 * every trip its own rate, which is the only way to make the trips table grow
 * — and therefore the only honest LONG case.
 */
function trips(n: number, vary = false): { lines: PdfLine[]; net: number } {
  const lines = Array.from({ length: n }, (_, i) => trip(i + 1, 10, vary ? 450 + i * 25 : 450));
  const net = lines.reduce((s, l) => s + l.amount_sar, 0);
  return { lines, net: round2(net) };
}

function ledgerDoc(opts: {
  tripCount: number;
  applied: number | null;
  payable: number | null;
  status?: PdfInvoiceData["status"];
  mode?: "prepaid" | "postpaid";
  era?: "ledger" | "legacy";
  hide?: boolean;
  number?: string;
  vary?: boolean;
}): PdfInvoiceData {
  const { lines, net } = trips(opts.tripCount, opts.vary);
  return {
    era: opts.era ?? "ledger",
    status: opts.status ?? "confirmed",
    paymentMode: opts.mode ?? "prepaid",
    invoiceNumber: opts.number ?? "026-000101",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    issueDate: "2026-07-01",
    seller,
    buyer,
    buyerEmail: "accounts@seder.example",
    // Ledger era: ONE trips table, covered 0/0/0, amountDue === grand.
    coveredLines: [],
    unpaidLines: lines,
    chargeLines: [],
    covered: totals(0),
    amountDue: totals(net),
    grand: totals(net),
    tripTotals: undefined,
    paidUpBalanceSar: null,
    prepaidAppliedSar: opts.applied,
    amountPayableSar: opts.payable,
    bankAccounts: [
      {
        id: "bank-1",
        bank_name: "Al Rajhi Bank",
        holder_name: "Bin Slimah Group for Water Transport",
        iban: "SA0380000000608010167519",
        show_on_invoice: true,
      },
    ],
    hideAmountDue: opts.hide ?? false,
    paymentMethod: null,
    paidAt: null,
    voidReason: null,
    projectWaterType: "potable",
    voidedAt: null,
  };
}

// 3 trips at one rate = 13,500 net = 15,525.00 gross, printing ONE grouped
// row — the common case, one rate per project. The applied/payable figures are
// facts about the customer's pool at the confirm instant, not derivations.
const base: PdfInvoiceData = ledgerDoc({ tripCount: 3, applied: 12000, payable: 3525 });

// LEGACY (pre-0203), rendered under 0027's freeze law: two trips tables with a
// coverage verdict, a charge table, trips-table feet and the paid-up balance
// foot. Built as its own shape rather than by flipping `era` on a ledger doc —
// a legacy document with no covered arm is not a document that ever existed,
// and measuring its page count would answer a question nobody asked.
const legacy: PdfInvoiceData = {
  ...base,
  era: "legacy",
  invoiceNumber: "026-000009",
  prepaidAppliedSar: null,
  amountPayableSar: null,
  coveredLines: [trip(1, 12, 450), trip(2, 8, 450)],
  unpaidLines: [trip(3, 10, 450)],
  chargeLines: [
    {
      id: "charge-0",
      kind: "charge",
      trip_date: "2026-06-18",
      description: "Standby waiting time",
      amount_sar: 1200,
      vat_sar: 180,
      quantity: 4,
      price_sar: 300,
      covered: true,
    },
    {
      id: "charge-1",
      kind: "charge",
      trip_date: "2026-06-19",
      description: "After-hours delivery surcharge",
      amount_sar: 800,
      vat_sar: 120,
      quantity: 2,
      price_sar: 400,
      covered: false,
    },
  ],
  covered: totals(10200),
  amountDue: totals(5300),
  grand: totals(15500),
  tripTotals: { covered: 11730, unpaid: 6095 },
  paidUpBalanceSar: 28270,
};

const CASES: ReadonlyArray<readonly [string, PdfInvoiceData]> = [
  ["ledger-prepaid-short", base],
  [
    "ledger-prepaid-covered-paid",
    ledgerDoc({ tripCount: 3, applied: 15525, payable: 0, status: "paid", number: "026-000102" }),
  ],
  ["ledger-prepaid-hidden-pair", ledgerDoc({ tripCount: 3, applied: 12000, payable: 3525, hide: true })],
  // 24 DISTINCT rates → 24 printed rows. The worst realistic trips table.
  ["ledger-prepaid-LONG-24-rows", ledgerDoc({ tripCount: 24, applied: 60000, payable: 89355, vary: true })],
  // THE CONTROL for the case above: same document, settlement pair suppressed.
  // If both read the same page count, the pair is not what moved the break —
  // without this line a 2pp LONG case reads like the batch cost a page.
  [
    "ledger-prepaid-LONG-24-rows-hidden",
    ledgerDoc({ tripCount: 24, applied: 60000, payable: 89355, vary: true, hide: true }),
  ],
  [
    "ledger-postpaid",
    ledgerDoc({ tripCount: 3, applied: 0, payable: 15525, mode: "postpaid", number: "026-000103" }),
  ],
  ["legacy-confirmed", legacy],
  ["ledger-prepaid-draft", ledgerDoc({ tripCount: 3, applied: null, payable: null, status: "draft" })],
];

// Wrapped rather than top-level: tsx compiles a .ts in this package as CJS
// (no "type": "module"), and CJS has no top-level await. The file must stay
// .ts to be INSIDE `npm run typecheck` — tsconfig's include is **/*.ts, so an
// .mts would typecheck nowhere and drift unnoticed.
async function main(): Promise<void> {
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();

  console.log("\n=== invoice page proof — A4, Chrome print, /Type /Page count ===\n");
  console.log("pp\tsettlement rows\tdocument");

  for (const [stem, data] of CASES) {
    for (const surface of ["download", "print"] as const) {
      const html =
        surface === "download" ? await buildInvoicePdfHtml(data) : await buildInvoicePrintHtml(data);
      const htmlPath = `${OUT}/${stem}.${surface}.html`;
      writeFileSync(htmlPath, html);
      await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
      // Fonts first: a PDF printed before the Arabic face loads paginates
      // against the fallback's metrics and reports a page count the real sheet
      // never has.
      await page.evaluate(() => document.fonts.ready);
      await page.emulateMedia({ media: "print" });
      const pdfPath = `${OUT}/${stem}.${surface}.pdf`;
      await page.pdf({
        path: pdfPath,
        format: "A4",
        printBackground: true,
        // The @page rule owns the margin. One passed here would stack on it.
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      });
      const buf = readFileSync(pdfPath);
      const pp = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      // Sanity, printed beside the count: a 1pp reading is only meaningful if
      // the rows being measured are actually ON the sheet.
      const rows = (html.match(/class="settled"/g) ?? []).length;
      const bodyRows = (html.match(/<tr/g) ?? []).length;
      console.log(`${pp}\t${rows}\t\t${stem}.${surface}  (${bodyRows} table rows)`);
    }
  }

  await browser.close();
  console.log("\nPDFs and HTML in", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
