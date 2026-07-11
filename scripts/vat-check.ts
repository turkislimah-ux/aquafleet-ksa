// Math confidence harness for the VAT calculation layer (spec §9, KSA 15%).
// No DB, no test framework. Mirrors prepaid-check.ts / covered-unpaid-check.ts
// discipline. Run:  npx tsx scripts/vat-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).

import { calculateVat, round2, VAT_RATE } from "../lib/vat";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}` + (ok ? "" : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`));
}

check("VAT_RATE = 15%", VAT_RATE, 0.15);

// --- Known-answer case: 300 * 0.15 = 45, grand 345 ---------------------------
{
  const r = calculateVat([{ id: "t1", amount_sar: 300 }]);
  check("known-answer: 300 -> vat 45, grand 345", r, {
    subtotal: 300,
    vatAmount: 45,
    grandTotal: 345,
    lines: [{ id: "t1", amount_sar: 300, lineVat: 45 }],
  });
}

// --- Single line ---------------------------------------------------------------
{
  const r = calculateVat([{ id: "t1", amount_sar: 100 }]);
  check("single line: 100 -> vat 15, grand 115", [r.subtotal, r.vatAmount, r.grandTotal], [100, 15, 115]);
}

// --- Multiple lines, no rounding divergence (clean amounts) --------------------
{
  const r = calculateVat([
    { id: "t1", amount_sar: 100 },
    { id: "t2", amount_sar: 100 },
    { id: "t3", amount_sar: 100 },
  ]);
  check("multiple clean lines: 3x100 -> subtotal 300, vat 45, grand 345", [r.subtotal, r.vatAmount, r.grandTotal], [300, 45, 345]);
  check("multiple clean lines: matches single-line known-answer (consistency)", [r.subtotal, r.vatAmount, r.grandTotal], [300, 45, 345]);
}

// --- Special charge included as just another pre-VAT line item -----------------
{
  const r = calculateVat([
    { id: "trip-total", description: "Delivered trips (covered)", amount_sar: 2000 },
    { id: "charge-1", description: "Extra hose fee", amount_sar: 150 },
  ]);
  check("special charge line included in taxable base: subtotal 2150", r.subtotal, 2150);
  check("special charge line included: vat = 322.5", r.vatAmount, 322.5);
  check("special charge line included: grand = 2472.5", r.grandTotal, 2472.5);
}

// --- Zero / edge amounts --------------------------------------------------------
{
  const r = calculateVat([]);
  check("empty line items: subtotal/vat/grand all 0", r, { subtotal: 0, vatAmount: 0, grandTotal: 0, lines: [] });
}
{
  const r = calculateVat([{ id: "t1", amount_sar: 0 }]);
  check("single zero-amount line: all 0", [r.subtotal, r.vatAmount, r.grandTotal], [0, 0, 0]);
}

// --- THE rounding-convention proof: per-invoice (ZATCA) vs naive per-line-sum --
// Three line items of 0.05 SAR each (deliberately tiny/edge amounts).
//   Per-invoice (document-level, what this module does):
//     subtotal = 0.15  ->  vat = round(0.15 * 0.15) = round(0.0225) = 0.02
//   Naive per-line-sum (what this module deliberately does NOT do):
//     each line: round(0.05 * 0.15) = round(0.0075) = 0.01  ->  sum = 0.03
// The two methods diverge by a halala on this input — proof that the choice
// matters, and confirmation this module takes the ZATCA (document-level) side.
{
  const items = [
    { id: "t1", amount_sar: 0.05 },
    { id: "t2", amount_sar: 0.05 },
    { id: "t3", amount_sar: 0.05 },
  ];
  const r = calculateVat(items);
  check("rounding proof: document-level vatAmount = 0.02 (ZATCA-correct)", r.vatAmount, 0.02);

  const naivePerLineSum = round2(items.reduce((s, l) => s + round2(l.amount_sar * VAT_RATE), 0));
  check("rounding proof: naive per-line-sum would give 0.03 (diverges)", naivePerLineSum, 0.03);
  check("rounding proof: the two methods actually diverge on this input", r.vatAmount !== naivePerLineSum, true);

  // Per-line preview values are still populated (display-only) but are NOT
  // what feeds vatAmount/grandTotal — prove they don't reconcile to the total.
  const lineVatSum = round2(r.lines.reduce((s, l) => s + l.lineVat, 0));
  check("rounding proof: per-line preview sums to the naive figure, not vatAmount", lineVatSum, naivePerLineSum);
  check("rounding proof: grandTotal uses the document-level vatAmount (0.17), not 0.18", r.grandTotal, 0.17);
}

// --- Rounding MODE: half-up (not banker's / round-half-to-even) ----------------
// 0.125 to 2dp: candidates 0.12 (even) vs 0.13 (odd). Half-up rounds UP to
// 0.13; banker's rounding would round to 0.12 (nearest even). This input
// discriminates between the two modes — proves half-up, not banker's.
check("rounding mode: round2(0.125) = 0.13 (half-up, not banker's 0.12)", round2(0.125), 0.13);
check("rounding mode: round2(1.005) = 1.01 (half-up)", round2(1.005), 1.01);

console.log("");
if (failures === 0) {
  console.log("All VAT checks PASSED ✓");
  process.exit(0);
} else {
  console.log(`${failures} VAT check(s) FAILED ✗`);
  process.exit(1);
}
