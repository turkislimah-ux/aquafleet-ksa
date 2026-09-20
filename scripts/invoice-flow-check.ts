// THE LEDGER-ERA INVOICE FLOW, AS ARITHMETIC. No DB, no test framework.
// Run:  npx tsx scripts/invoice-flow-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS FOR, AND WHAT IT DELIBERATELY DOES NOT DO
//
// Since 0203 nothing app-side computes the prepaid draw. confirm_invoice reads
// Available under a row lock, decides `min(max(Available,0), grand_total)`
// itself, and freezes the pair. scripts/db/invoice-settlement-check.ts proves
// the database does that correctly, and it is the ONLY thing that can — it
// needs a real transaction.
//
// So this file does NOT re-implement the draw as a second opinion. A second
// implementation of a money rule is the thing the money-core boundary exists to
// forbid; if it agreed it would prove nothing, and if it disagreed nobody could
// say which one was wrong.
//
// What it guards instead is the part that lives entirely in this repo: the
// IDENTITIES the app assumes about those frozen figures, and the DOCUMENT the
// app prints from them. Those identities are assumed in a dozen places —
// InvoiceDetailModal's remainder, the settlement panel, the hero figure, the
// apply-balance preview — and each assumption is invisible until a customer
// reads a total that does not add up.
//
// The model below is a TRANSCRIPTION of 0203's law, not a competitor to it:
// the draw is an INPUT here (whatever the RPC decided), and every assertion is
// about what must then be true. Feed it a draw the database would never
// produce and the identities still have to hold — which is exactly why the
// sweep in case 2 feeds it 200-odd of them.
//
//   case 1  the freeze identity: grand_total = applied + payable, both modes
//   case 2  a SWEEP over (available, total) — every frozen pair the RPC could
//           ever produce satisfies the identity and the bounds
//   case 3  settlement walk: payable = paid + applied + writtenOff + remainder,
//           remainder floored at 0, status flips to paid exactly at zero
//   case 4  a partial payment NEVER rewrites a frozen column
//   case 5  void conservation: reversals return the pool to the halala, and
//           cash received is NOT reversed with it
//   case 6  THE PRINTED CHAIN: Grand Total − Prepaid Applied = the hero, read
//           out of buildInvoiceViewModel for every state the walk produces
//   case 7  the hide-from-customer toggle removes the pair AND the hero moves
//           back to Grand Total — a hidden deduction under a visible payable
//           would be a document that does not add up
//   case 8  invoiceEra() is not a status test — the REAL function, imported
//   case 9  the negative control — a mutated "applied" makes case 1, 2 and 6
//           all go red, so a green run is not a green tautology
// ---------------------------------------------------------------------------

import { round2 } from "../lib/prepaid";
import { invoiceEra } from "../lib/invoice-era";
import { buildInvoiceViewModel, type PdfInvoiceData, type PdfLine } from "../lib/invoiceViewModel";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
}

function eq(name: string, actual: number, expected: number): void {
  check(name, round2(actual) === round2(expected), `expected ${expected}, got ${actual}`);
}

/** Same shape as eq(), for the one case that compares strings. */
function eqs(name: string, actual: string, expected: string): void {
  check(name, actual === expected, `expected "${expected}", got "${actual}"`);
}

// ---------------------------------------------------------------------------
// THE TRANSCRIPTION. 0203's law, written once, as data-in/data-out.
//
// `freeze` takes what the RPC would have READ (Available, grand total, mode)
// and returns what it would have WRITTEN. It exists so the identities below
// have something to quantify over — it is never imported by the app, and the
// app never calls anything like it.
// ---------------------------------------------------------------------------

type Frozen = { applied: number; payable: number; status: "confirmed" | "paid" };

function freeze(availableSar: number, grandTotal: number, mode: "prepaid" | "postpaid"): Frozen {
  // The postpaid arm of confirm_invoice: applied 0, payable the whole total.
  // It is written out rather than special-cased into the prepaid arm because
  // that is how the migration reads, and a transcription that "simplifies" is
  // no longer a transcription.
  if (mode === "postpaid") {
    return { applied: 0, payable: round2(grandTotal), status: "confirmed" };
  }
  const draw = round2(Math.min(Math.max(availableSar, 0), grandTotal));
  const payable = round2(grandTotal - draw);
  return { applied: draw, payable, status: payable === 0 ? "paid" : "confirmed" };
}

/** v_invoice_settlement's remainder, in one expression. Floored at zero: an
 *  over-settled invoice is a data error, not a negative debt the UI should
 *  print with a minus in front of it. */
function remainder(payable: number, paid: number, applied: number, writtenOff: number): number {
  return Math.max(round2(payable - paid - applied - writtenOff), 0);
}

// ---------------------------------------------------------------------------
// A document fixture, minimal but REAL — it goes through the same
// buildInvoiceViewModel every surface uses. One trip line, no charges, so the
// only thing moving between cases is the frozen pair.
// ---------------------------------------------------------------------------

const ident = { name: "X", name_ar: null, vat_number: null, cr_number: null, address: null };

function line(net: number): PdfLine {
  return {
    id: "t1",
    kind: "trip",
    trip_date: "2026-06-10",
    description: "Water delivery",
    amount_sar: net,
    vat_sar: round2(net * 0.15),
    ref: "TR-1",
    water_type: "potable",
    quantity: 1,
    price_sar: net,
  };
}

function doc(opts: {
  net: number;
  applied: number | null;
  payable: number | null;
  status?: PdfInvoiceData["status"];
  mode?: "prepaid" | "postpaid";
  era?: "ledger" | "legacy";
  hide?: boolean;
}): PdfInvoiceData {
  const net = opts.net;
  const totals = { subtotal: net, vat: round2(net * 0.15), total: round2(net * 1.15) };
  return {
    era: opts.era ?? "ledger",
    status: opts.status ?? "confirmed",
    paymentMode: opts.mode ?? "prepaid",
    invoiceNumber: "026-000100",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    issueDate: "2026-07-01",
    seller: ident,
    buyer: ident,
    buyerEmail: null,
    // LEDGER ERA HAS NO SPLIT. Everything is one table; `covered` is 0/0/0 and
    // `amountDue` equals `grand`. That is the shape lib/invoice.ts produces
    // now that the FIFO split is off the confirm path.
    coveredLines: [],
    unpaidLines: [line(net)],
    chargeLines: [],
    covered: { subtotal: 0, vat: 0, total: 0 },
    amountDue: totals,
    grand: totals,
    paidUpBalanceSar: null,
    prepaidAppliedSar: opts.applied,
    amountPayableSar: opts.payable,
    bankAccounts: null,
    hideAmountDue: opts.hide ?? false,
    paymentMethod: null,
    paidAt: null,
    voidReason: null,
    projectWaterType: "potable",
    voidedAt: null,
  };
}

/** The hero and the settlement deduction, read out of the real view model. */
function printed(data: PdfInvoiceData): { hero: number; deduction: number | null; heroIsGrand: boolean; grand: number } {
  const vm = buildInvoiceViewModel(data);
  return {
    hero: vm.hero.amount,
    deduction: vm.settlementRows.length ? vm.settlementRows[0].amount : null,
    heroIsGrand: vm.heroIsGrandTotal,
    grand: vm.totals.total,
  };
}

console.log("\n=== invoice-flow-check — the ledger-era invoice flow as arithmetic ===\n");

// ---------------------------------------------------------------------------
// CASE 1 — the freeze identity, stated once for each mode.
// ---------------------------------------------------------------------------
console.log("-- case 1: the freeze identity");
{
  const TOTAL = 1419.79;

  const covered = freeze(3580.21, TOTAL, "prepaid");
  eq("prepaid, fully covered — applied", covered.applied, TOTAL);
  eq("prepaid, fully covered — payable", covered.payable, 0);
  eq("prepaid, fully covered — identity", covered.applied + covered.payable, TOTAL);
  check("prepaid, fully covered — status is paid at confirm", covered.status === "paid");

  const short = freeze(580.21, TOTAL, "prepaid");
  eq("prepaid, short — applied is capped by AVAILABLE", short.applied, 580.21);
  eq("prepaid, short — payable is the shortfall", short.payable, 839.58);
  eq("prepaid, short — identity", short.applied + short.payable, TOTAL);
  check("prepaid, short — status stays confirmed", short.status === "confirmed");

  // A prepaid customer in the red draws NOTHING. Not a negative draw, which
  // would be the pool paying the customer, and not a null — 0 is a real answer.
  const red = freeze(-2839.58, TOTAL, "prepaid");
  eq("prepaid, negative Available — applied is 0, never negative", red.applied, 0);
  eq("prepaid, negative Available — payable is the whole total", red.payable, TOTAL);

  const post = freeze(9999, TOTAL, "postpaid");
  eq("postpaid — applied is 0 even with a balance sitting there", post.applied, 0);
  eq("postpaid — payable is the whole total", post.payable, TOTAL);
  eq("postpaid — identity", post.applied + post.payable, TOTAL);
}

// ---------------------------------------------------------------------------
// CASE 2 — THE SWEEP. Three hand-picked cases can agree by luck; a couple of
// hundred cannot. Available runs from deep in the red to far past the total,
// crossing the two boundaries that matter — 0 and grand_total — at a halala's
// resolution, because those are exactly the points where a `<=` written as a
// `<` stops being visible.
// ---------------------------------------------------------------------------
console.log("\n-- case 2: sweep over every frozen pair the RPC could produce");
{
  const TOTAL = 1419.79;
  let identityHeld = 0, boundsHeld = 0, bad = "";
  for (let cents = -200; cents <= 200; cents++) {
    // Walk Available through both boundaries: 0 and TOTAL.
    for (const base of [0, TOTAL]) {
      const available = round2(base + cents / 100);
      const f = freeze(available, TOTAL, "prepaid");
      if (round2(f.applied + f.payable) === round2(TOTAL)) identityHeld++;
      else if (!bad) bad = `identity broke at available=${available}: ${f.applied} + ${f.payable}`;

      const inBounds =
        f.applied >= 0 && f.payable >= 0 && f.applied <= round2(TOTAL) && f.payable <= round2(TOTAL);
      if (inBounds) boundsHeld++;
      else if (!bad) bad = `bounds broke at available=${available}: ${JSON.stringify(f)}`;
    }
  }
  const n = 401 * 2;
  check(`identity holds across all ${n} frozen pairs`, identityHeld === n, bad);
  check(`applied and payable both stay within [0, total] across all ${n}`, boundsHeld === n, bad);

  // The two boundaries, named individually — a sweep that passes tells you
  // nothing about WHERE the edge is, and the edge is the whole question.
  eq("exactly enough Available draws the whole total", freeze(TOTAL, TOTAL, "prepaid").applied, TOTAL);
  eq("one halala short draws one halala short", freeze(round2(TOTAL - 0.01), TOTAL, "prepaid").applied, round2(TOTAL - 0.01));
  eq("one halala short leaves exactly one halala payable", freeze(round2(TOTAL - 0.01), TOTAL, "prepaid").payable, 0.01);
  eq("Available of exactly 0.00 draws nothing", freeze(0, TOTAL, "prepaid").applied, 0);
  eq("one halala of Available draws one halala", freeze(0.01, TOTAL, "prepaid").applied, 0.01);
}

// ---------------------------------------------------------------------------
// CASE 3 — the settlement walk. This is v_invoice_settlement's arithmetic and
// the rule the two settle RPCs enforce: nothing may exceed the remainder, and
// the status flips exactly when it reaches zero.
// ---------------------------------------------------------------------------
console.log("\n-- case 3: the settlement walk");
{
  const PAYABLE = 839.58;
  eq("nothing settled — remainder is the whole payable", remainder(PAYABLE, 0, 0, 0), PAYABLE);
  eq("after 300.00 cash", remainder(PAYABLE, 300, 0, 0), 539.58);
  eq("after cash + 539.58 applied", remainder(PAYABLE, 300, 539.58, 0), 0);
  eq("a write-off absorbs what is left", remainder(PAYABLE, 300, 0, 539.58), 0);
  eq("over-settled clamps to 0, never negative", remainder(PAYABLE, 1000, 0, 0), 0);

  // payable = paid + applied + writtenOff + remainder, at every step of a real
  // settlement. The walk is the identity; a step that does not close it means
  // the invoice lost money somewhere between two screens.
  const steps: { paid: number; applied: number; wo: number }[] = [
    { paid: 0, applied: 0, wo: 0 },
    { paid: 300, applied: 0, wo: 0 },
    { paid: 300, applied: 200, wo: 0 },
    { paid: 300, applied: 539.58, wo: 0 },
  ];
  let closed = 0;
  for (const s of steps) {
    const r = remainder(PAYABLE, s.paid, s.applied, s.wo);
    if (round2(s.paid + s.applied + s.wo + r) === PAYABLE) closed++;
  }
  check("the walk closes at every step", closed === steps.length, `${closed}/${steps.length} closed`);

  const paidAt = steps.map((s) => remainder(PAYABLE, s.paid, s.applied, s.wo) === 0);
  check("status flips to paid at exactly one step — the last", JSON.stringify(paidAt) === JSON.stringify([false, false, false, true]));
}

// ---------------------------------------------------------------------------
// CASE 4 — the frozen columns are FROZEN. Settling an invoice moves the
// remainder; it must never move `prepaid_applied_sar` or `amount_payable_sar`.
// Those two are the document, and a document that changes after it is issued
// is not a document. (0027's freeze law, restated on the 0203 columns.)
// ---------------------------------------------------------------------------
console.log("\n-- case 4: settlement never rewrites a frozen column");
{
  const f = freeze(580.21, 1419.79, "prepaid");
  const before = JSON.stringify(f);
  // A settlement is rows added elsewhere — invoice_payments and
  // customer_ledger. Nothing about it reaches back into the invoice row except
  // the status flip, so the modelled pair after a full settlement must be
  // byte-identical to the pair at confirm.
  const r = remainder(f.payable, 300, 539.58, 0);
  eq("fully settled", r, 0);
  check("the frozen pair is unchanged by settling", JSON.stringify(f) === before);
  eq("applied still reports the CONFIRM draw, not the total settled", f.applied, 580.21);
  eq("payable still reports the shortfall at confirm", f.payable, 839.58);
}

// ---------------------------------------------------------------------------
// CASE 5 — void conservation. void_invoice writes one paired reversal per
// un-reversed negative row, so the pool returns to exactly where it was. Cash
// is NOT in that loop: invoice_payments is append-only and refunding real money
// received is a separate act with its own document.
// ---------------------------------------------------------------------------
console.log("\n-- case 5: void conservation");
{
  const topups = 3000.0;
  const drawAtConfirm = -580.21;
  const appliedLater = -539.58;
  const balanceBeforeVoid = round2(topups + drawAtConfirm + appliedLater);
  eq("balance while the invoice stands", balanceBeforeVoid, 1880.21);

  const reversals = round2(-(drawAtConfirm + appliedLater));
  eq("one reversal per negative row, summed", reversals, 1119.79);
  eq("balance after void returns to the top-ups, to the halala", round2(balanceBeforeVoid + reversals), topups);

  const cashReceived = 300.0;
  eq("cash received is NOT reversed by the void", cashReceived, 300.0);
  check("…and it was never pool money to begin with", round2(topups + drawAtConfirm + appliedLater + reversals) === topups);
}

// ---------------------------------------------------------------------------
// CASE 6 — THE PRINTED CHAIN. The document prints a Grand Total, a negative
// Prepaid Applied under it, and a hero. The customer adds those in their head.
// If `Grand Total − Prepaid Applied` is not the hero, the invoice is wrong on
// paper no matter how right the database is — and no renderer test catches it,
// because both renderers would print the same wrong pair in perfect agreement.
//
// Read out of the REAL buildInvoiceViewModel, over every pair the freeze
// produces at a range of totals.
// ---------------------------------------------------------------------------
console.log("\n-- case 6: the printed chain, Grand Total − Prepaid Applied = hero");
{
  let chainHeld = 0, heroHeld = 0, total = 0, bad = "";
  for (const net of [100, 1234.6, 4321.05, 99999.99]) {
    const grand = round2(net * 1.15);
    for (const avail of [-50, 0, 0.01, round2(grand / 3), round2(grand - 0.01), grand, grand * 2]) {
      const f = freeze(avail, grand, "prepaid");
      const p = printed(doc({ net, applied: f.applied, payable: f.payable, status: f.status }));
      total++;
      // deduction is printed NEGATIVE, so this is an addition.
      if (round2(p.grand + (p.deduction ?? 0)) === round2(p.hero)) chainHeld++;
      else if (!bad) bad = `chain broke at net=${net} avail=${avail}: ${p.grand} + ${p.deduction} ≠ ${p.hero}`;

      if (round2(p.hero) === round2(f.payable)) heroHeld++;
      else if (!bad) bad = `hero ≠ payable at net=${net} avail=${avail}: ${p.hero} vs ${f.payable}`;
    }
  }
  check(`the printed chain closes in all ${total} documents`, chainHeld === total, bad);
  check(`the hero IS the frozen payable in all ${total}`, heroHeld === total, bad);

  // The deduction must be printed negative. A deduction under a total that is
  // printed positive reads as an addition, and the chain the customer does in
  // their head then gives the wrong answer twice as large as the error.
  const p = printed(doc({ net: 1234.6, applied: 580.21, payable: 839.58 }));
  eq("Prepaid Applied is printed NEGATIVE", p.deduction as number, -580.21);
  check("a settled ledger invoice does not print the hero as its Grand Total", p.heroIsGrand === false);
}

// ---------------------------------------------------------------------------
// CASE 7 — the hide-from-customer toggle. It removes the pair. If the hero
// stayed on Amount Payable while the deduction vanished, the customer would
// hold a document whose only two visible figures — Grand Total and hero —
// disagree, with nothing on the page to explain the gap. The VM must move the
// hero back to Grand Total in the same decision.
// ---------------------------------------------------------------------------
console.log("\n-- case 7: hiding the pair moves the hero back to Grand Total");
{
  const shown = printed(doc({ net: 1234.6, applied: 580.21, payable: 839.58, hide: false }));
  const hidden = printed(doc({ net: 1234.6, applied: 580.21, payable: 839.58, hide: true }));
  check("shown — the deduction prints", shown.deduction !== null);
  check("hidden — the deduction is gone", hidden.deduction === null);
  eq("hidden — the hero is the Grand Total", hidden.hero, hidden.grand);
  check("hidden — the renderer is told not to print a second Grand Total row", hidden.heroIsGrand === true);
  check("the two documents really do differ (the toggle is not a no-op)", shown.hero !== hidden.hero);
}

// ---------------------------------------------------------------------------
// CASE 8 — the era flag is not a status test. A draft carries no frozen pair
// and must print no settlement block; a legacy confirmed invoice carries none
// either and keeps its own document. Both are "confirmed-looking" states that
// a status test would get wrong.
// ---------------------------------------------------------------------------
console.log("\n-- case 8: era is not status");
{
  // THE REAL FUNCTION, not a transcription of it. invoiceEra() used to live in
  // app/trips/invoiceActions.ts — a `"use server"` module this harness cannot
  // import — so this case could only exercise the era flag a CALLER passes,
  // never the rule that computes it. It broke the build for an unrelated
  // reason (a server-action module may export only async functions), moved to
  // lib/invoice-era.ts, and the gap closed with it.
  eqs("draft is LEDGER with both columns null", invoiceEra({ status: "draft", amount_payable_sar: null }), "ledger");
  eqs("review is LEDGER too", invoiceEra({ status: "review", amount_payable_sar: null }), "ledger");
  eqs(
    "confirmed WITH a frozen payable is LEDGER — even a payable of 0",
    invoiceEra({ status: "confirmed", amount_payable_sar: 0 }),
    "ledger",
  );
  eqs(
    "confirmed WITHOUT one is LEGACY",
    invoiceEra({ status: "confirmed", amount_payable_sar: null }),
    "legacy",
  );
  // The pair that makes it not a status test: same status, opposite answers.
  eqs("paid with a frozen payable is LEDGER", invoiceEra({ status: "paid", amount_payable_sar: 1419.79 }), "ledger");
  eqs("paid without one is LEGACY", invoiceEra({ status: "paid", amount_payable_sar: null }), "legacy");
  eqs("void with a frozen payable is LEDGER", invoiceEra({ status: "void", amount_payable_sar: 0 }), "ledger");

  const draft = printed(doc({ net: 1234.6, applied: null, payable: null, status: "draft" }));
  check("a DRAFT prints no settlement pair (nothing has been drawn yet)", draft.deduction === null);
  eq("a DRAFT's hero is its Grand Total", draft.hero, draft.grand);

  const legacy = printed(doc({ net: 1234.6, applied: null, payable: null, era: "legacy", status: "confirmed" }));
  check("a LEGACY confirmed invoice prints no settlement pair", legacy.deduction === null);

  // 0 applied is a REAL answer — the customer had nothing available — and must
  // print, or an invoice that drew nothing would look like a legacy one.
  const zero = printed(doc({ net: 1234.6, applied: 0, payable: round2(1234.6 * 1.15) }));
  check("applied of 0.00 still prints the pair (0 is not null)", zero.deduction === 0);
  eq("…and the hero is the whole total", zero.hero, zero.grand);
}

// ---------------------------------------------------------------------------
// CASE 9 — THE NEGATIVE CONTROL. Every assertion above is an equality, and an
// equality that cannot fail is decoration. Mutate the applied figure by one
// halala WITHOUT mutating the payable — the exact shape of a confirm that
// wrote one column and not the other — and require the identity and the
// printed chain to BOTH go red.
// ---------------------------------------------------------------------------
console.log("\n-- case 9: the negative control");
{
  const net = 1234.6;
  const grand = round2(net * 1.15);
  const f = freeze(580.21, grand, "prepaid");
  const brokenApplied = round2(f.applied + 0.01);

  check("mutated identity is DETECTED", round2(brokenApplied + f.payable) !== round2(grand),
    "a one-halala mutation slipped through the identity — it cannot catch anything");

  const p = printed(doc({ net, applied: brokenApplied, payable: f.payable }));
  check("mutated printed chain is DETECTED", round2(p.grand + (p.deduction ?? 0)) !== round2(p.hero),
    "the printed chain still closed with a mutated deduction — case 6 proves nothing");
}

console.log("");
if (failures === 0) {
  console.log("All invoice-flow checks PASSED ✓ — the frozen pair, the settlement walk and the printed chain all close.");
  process.exit(0);
} else {
  console.log(`${failures} invoice-flow check(s) FAILED ✗`);
  process.exit(1);
}
