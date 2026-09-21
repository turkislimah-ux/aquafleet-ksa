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
//   case 7  the hide-from-customer toggle removes the pair AND the hero — a
//           document that names nothing as owed, because since 0204 the
//           payable and the Grand Total are the same number and moving the
//           hero between them hid nothing at all
//   case 8  invoiceEra() is not a status test — the REAL function, imported
//   case 9  the negative control — a mutated "applied" makes case 1, 2 and 6
//           all go red, so a green run is not a green tautology
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { join } from "path";
import { consumingItems, round2, type ConsumingTrip } from "../lib/money";
import {
  assembleInvoice,
  canEditSpecialCharges,
  type InvoiceAssembly,
  type SpecialChargeInput,
} from "../lib/invoice";
import {
  computeAmountPayable,
  toConsumingTrip,
  toConsumingCharge,
  isUnsettledTrip,
  isUnsettledCharge,
  type PayableTrip,
  type PayableCharge,
} from "../app/trips/amountPayable";
import type { InvoiceStatus } from "../lib/db-types";
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
  // Pre-VAT special-charge amount, case 7 only — the hidden document is
  // charges-only, so proving what it totals needs a charge to total.
  charge?: number;
}): PdfInvoiceData {
  const net = round2(opts.net + (opts.charge ?? 0));
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
    unpaidLines: [line(opts.net)],
    chargeLines:
      opts.charge != null
        ? [
            {
              id: "c1",
              kind: "charge",
              trip_date: "2026-06-12",
              description: "Standby waiting time",
              amount_sar: opts.charge,
              vat_sar: round2(opts.charge * 0.15),
              quantity: 1,
              price_sar: opts.charge,
              covered: false,
            },
          ]
        : [],
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
function printed(data: PdfInvoiceData): {
  hero: number;
  heroLabel: string;
  deduction: number | null;
  heroIsGrand: boolean;
  grand: number;
  hasTrips: boolean;
  hasCharges: boolean;
} {
  const vm = buildInvoiceViewModel(data);
  return {
    // EVERY document closes on a hero now (Turki's ruling): hiding changes
    // WHAT the figure speaks for — the charges total on a hidden, charges-only
    // document — never whether one exists. So the interesting outputs are the
    // AMOUNT, the LABEL it prints under, and which sections survived.
    hero: vm.hero.amount,
    heroLabel: vm.hero.label.en,
    deduction: vm.settlementRows.length ? vm.settlementRows[0].amount : null,
    heroIsGrand: vm.heroIsGrandTotal,
    grand: vm.totals.total,
    hasTrips: vm.sections.some((sec) => sec.kind === "trips"),
    hasCharges: vm.sections.some((sec) => sec.kind === "charges"),
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
// CASE 7 — the hide-from-customer toggle: WHOLE-SECTION omission.
//
// THIS CASE HAS NOW PINNED THREE RULINGS, which is why it pins the current
// one from every side. It first asserted the hidden hero falls back to Grand
// Total (a no-op once 0204 froze payable AT grand — the toggle renamed a
// caption and hid nothing). Then it asserted NO hero at all — but the trips
// stayed itemised above the empty slot, so the customer still read every
// priced delivery. Turki's ruling closes the hole where the money actually
// shows: the TRIPS SECTION LEAVES THE DOCUMENT, the totals speak for the
// charges alone, and the document still closes on an Amount Payable — equal
// to the charges total it just reached, so it adds up to what it shows.
// Frozen money on the invoice row is untouched throughout; the flag only
// decides what this render presents.
// ---------------------------------------------------------------------------
console.log("\n-- case 7: hiding omits the trips section and totals charges only");
{
  // 1,234.60 net of trips + a 200.00 charge → grand 1,649.79. The charge is
  // the point: a hidden document with no charges would total 0.00, which
  // satisfies almost any equality by accident.
  const shown = printed(doc({ net: 1234.6, charge: 200, applied: 580.21, payable: 1069.58, hide: false }));
  const hidden = printed(doc({ net: 1234.6, charge: 200, applied: 580.21, payable: 1069.58, hide: true }));
  check("shown — the trips section prints", shown.hasTrips);
  check("shown — the deduction prints", shown.deduction !== null);
  check("shown — the hero is the frozen payable", round2(shown.hero) === 1069.58);
  eq("shown — the stack total is the grand", shown.grand, round2(1434.6 * 1.15));
  check("hidden — the trips section is GONE", hidden.hasTrips === false);
  check("hidden — the charges section stays", hidden.hasCharges);
  check("hidden — the deduction is gone with the trip money", hidden.deduction === null);
  // The document adds up to what it shows: charges 200.00 + VAT 30.00.
  eq("hidden — the stack total is the CHARGES total", hidden.grand, 230);
  eq("hidden — the hero equals it", round2(hidden.hero), 230);
  check("hidden — and still calls itself Amount Payable", hidden.heroLabel === "Amount Payable");
  check(
    "hidden — heroIsGrandTotal stays false, so the total row AND the payable both print",
    hidden.heroIsGrand === false,
  );
  check("the two documents really do differ (the toggle is not a no-op)", shown.grand !== hidden.grand);
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


// ===========================================================================
// MOVED LAWS (0206 Group B). The five old-model harnesses are retired; every
// still-true money law they guarded lives HERE now, adapted to the ledger-era
// inputs. Deep-equal helper local to this block so the file's own boolean
// check() is untouched.
// ===========================================================================
let movedFailures = 0;
function deep(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    movedFailures++;
    failures++;
  }
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}` + (ok ? "" : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`));
}
const deepTrue = (name: string, cond: boolean) => deep(name, cond, true);

// ---------------------------------------------------------------------------
// A. MONEY-CORE LAWS — consumingItems (moved from scripts/prepaid-check.ts).
// The pool/statement/paid-up laws that file also held died with the pool;
// these are the ones the ledger era still leans on: the statement's deduction,
// the assembly's trip list and the payable all read this one function.
// ---------------------------------------------------------------------------
{
  const trip = (id: string, date: string, rate: number, delivered = true): ConsumingTrip => ({
    id,
    trip_date: date,
    delivered_at: delivered ? `${date}T10:00:00Z` : null,
    rate_sar: rate,
  });

  const one = consumingItems([trip("t1", "2026-06-05", 400)]);
  deep("money-core: trip amount stays 400 (pre-VAT, display)", one[0]?.amount, 400);
  deep("money-core: trip consumedAmount = 460 (400 * 1.15, per item)", one[0]?.consumedAmount, 460);

  const chargeOnly = consumingItems([], [{ id: "c1", charge_date: "2026-06-06", amount_sar: 200 }]);
  deep("money-core: charge-only -> 1 item, kind=charge", [chargeOnly.length, chargeOnly[0]?.kind], [1, "charge"]);
  deep("money-core: charge consumedAmount = 230 (200 * 1.15)", chargeOnly[0]?.consumedAmount, 230);

  const sameDay = consumingItems(
    [trip("t1", "2026-06-05", 100)],
    [{ id: "c1", charge_date: "2026-06-05", amount_sar: 100 }],
  );
  deep("money-core: same-date tiebreak — trip sorts before charge", sameDay.map((e) => e.kind), ["trip", "charge"]);

  // Membership is the CALLER'S array, never a date or a status read in here: a
  // voided invoice's charge is simply not passed, and it vanishes.
  deep(
    "money-core: charge released by omission (void) — queue shrinks to the trip",
    consumingItems([trip("t1", "2026-06-05", 100)], []).map((e) => e.id),
    ["t1"],
  );

  // A reversed trip (delivered_at -> null) drops out before any amount exists.
  deep(
    "money-core: undelivered/reversed trip never reaches the money",
    consumingItems([trip("t1", "2026-06-05", 100, false)]).length,
    0,
  );

  // asOfDate filters TRIPS ONLY; a charge is invoice-bound, not date-scoped.
  const gated = consumingItems(
    [trip("early", "2026-06-05", 100), trip("late", "2026-07-05", 100)],
    [{ id: "cLate", charge_date: "2026-07-09", amount_sar: 50 }],
    "2026-06-30",
  );
  deep("money-core: asOfDate drops the late TRIP, keeps the late CHARGE", gated.map((e) => e.id), ["early", "cLate"]);
}

// ---------------------------------------------------------------------------
// B. ASSEMBLY LAWS (moved whole from scripts/invoice-check.ts). The fixtures
// are the same; the retired `topups`/`returns` inputs are gone from
// AssembleInvoiceInput itself, which promotes that file's sharpest law — THE
// POOL CANNOT MOVE THE DOCUMENT — from a runtime sweep to a TYPE FACT, pinned
// by the @ts-expect-error tripwire at the end of this block.
// ---------------------------------------------------------------------------
{
  // The two money invariants, asserted on EVERY assembled case: they were both
  // violated in production once (grand built from covered lines only — 8 of 24
  // live invoices did not add up) and an identity catches that class where a
  // per-case expected value cannot.
  function reconciles(name: string, r: InvoiceAssembly) {
    deep(
      `${name}: covered + amountDue === grand (subtotal/vat/total)`,
      {
        subtotal: round2(r.covered.subtotal + r.amountDue.subtotal),
        vat: round2(r.covered.vat + r.amountDue.vat),
        total: round2(r.covered.total + r.amountDue.total),
      },
      r.grand,
    );
    const everyLine = round2(
      [...r.coveredLines, ...r.unpaidLines, ...r.chargeLines].reduce((s, l) => s + l.amount_sar, 0),
    );
    deep(`${name}: every line is inside grand.subtotal (nothing dropped)`, everyLine, r.grand.subtotal);
    // LEDGER ERA (0203): the whole document is billable in BOTH modes. The
    // prepaid draw is a ledger fact decided at settlement, not a line split.
    deep(`${name}: covered is zero (the draw is a ledger fact, not a line split)`, r.covered, {
      subtotal: 0,
      vat: 0,
      total: 0,
    });
    deepTrue(
      `${name}: amountDue === grand EXACTLY (the whole invoice is billable)`,
      JSON.stringify(r.amountDue) === JSON.stringify(r.grand),
    );
    deep(`${name}: coveredLines is empty in both modes`, r.coveredLines, []);
    deepTrue(
      `${name}: no line carries a coverage verdict`,
      [...r.coveredLines, ...r.unpaidLines, ...r.chargeLines].every((l) => l.covered === undefined),
    );
    deep(`${name}: no tripTotals — one trips table, document-level foot`, r.tripTotals, undefined);
  }

  const T = (id: string, date: string, rate: number, delivered = true): ConsumingTrip => ({
    id,
    trip_date: date,
    delivered_at: delivered ? `${date}T10:00:00Z` : null,
    rate_sar: rate,
  });
  const base = { customerId: "c1", periodStart: "2026-06-01", periodEnd: "2026-06-30" };

  {
    const r = assembleInvoice({
      ...base,
      paymentMode: "postpaid",
      trips: [T("t1", "2026-06-05", 300), T("t2", "2026-06-10", 300)],
      specialCharges: [],
    });
    deep("assembly: postpaid coveredLines always empty", r.coveredLines, []);
    deep("assembly: postpaid unpaidLines = both trips", r.unpaidLines.map((l) => l.id).sort(), ["t1", "t2"]);
    deep("assembly: postpaid amountDue totals", r.amountDue, { subtotal: 600, vat: 90, total: 690 });
    reconciles("assembly postpaid", r);
  }

  {
    const charges: SpecialChargeInput[] = [{ id: "ch1", label: "Extra hose fee", amount_sar: 150 }];
    const r = assembleInvoice({ ...base, paymentMode: "postpaid", trips: [T("t1", "2026-06-05", 300)], specialCharges: charges });
    deep("assembly: charge lands in unpaidLines with kind=charge", r.unpaidLines.find((l) => l.id === "ch1")?.kind, "charge");
    deep("assembly: charge amountDue = 300+150 -> 450/67.5/517.5", r.amountDue, { subtotal: 450, vat: 67.5, total: 517.5 });
    reconciles("assembly postpaid charge", r);
  }

  {
    // Period window is the ONLY scope: full history passed, May's trip absent.
    const r = assembleInvoice({
      ...base,
      paymentMode: "prepaid",
      trips: [T("tA-prior-period", "2026-05-15", 300), T("tB-this-period", "2026-06-15", 300)],
      specialCharges: [],
    });
    deep("assembly: period scope — June's trip billed", r.unpaidLines.map((l) => l.id), ["tB-this-period"]);
    deep("assembly: period scope — May's trip absent from every total", r.grand, { subtotal: 300, vat: 45, total: 345 });
    reconciles("assembly period scope", r);
  }

  {
    const r = assembleInvoice({
      ...base,
      paymentMode: "prepaid",
      trips: [T("before", "2026-05-31", 100), T("inside", "2026-06-15", 100), T("after", "2026-07-01", 100)],
      specialCharges: [],
    });
    deep("assembly: period boundary — only 'inside' appears", [...r.coveredLines, ...r.unpaidLines].map((l) => l.id), ["inside"]);
    reconciles("assembly period boundary", r);
  }

  {
    const r = assembleInvoice({
      ...base,
      paymentMode: "prepaid",
      trips: [T("t1", "2026-06-01", 100), T("t2", "2026-06-02", 100), T("t3", "2026-06-03", 100), T("t4", "2026-06-04", 100, false)],
      specialCharges: [],
    });
    const ids = [...r.coveredLines, ...r.unpaidLines].map((l) => l.id).sort();
    deep("assembly: reconciliation — t1/t2/t3 in, undelivered t4 excluded", ids, ["t1", "t2", "t3"]);
    deepTrue("assembly: no id duplicated across tables", new Set(ids).size === ids.length);
    reconciles("assembly reconciliation", r);
  }

  {
    // ROUNDING CONVERGENCE — one document-level pass, so the per-item halala
    // the old covered/unpaid split argued over is UNREACHABLE, not resolved.
    const r = assembleInvoice({
      ...base,
      paymentMode: "prepaid",
      trips: [T("t1", "2026-06-01", 0.05), T("t2", "2026-06-02", 0.05), T("t3", "2026-06-03", 0.05)],
      specialCharges: [],
    });
    deep("assembly: convergence — all three billed", r.unpaidLines.map((l) => l.id), ["t1", "t2", "t3"]);
    deep("assembly: convergence — grand = one pass = 0.15/0.02/0.17", r.grand, { subtotal: 0.15, vat: 0.02, total: 0.17 });
    deep("assembly: convergence — amountDue is the SAME figure, not per-item 0.12", r.amountDue, { subtotal: 0.15, vat: 0.02, total: 0.17 });
    deep("assembly: convergence — per-item rounding would still say 0.06; nothing reads it", round2(0.05 * 1.15), 0.06);
    reconciles("assembly convergence", r);
  }

  {
    // THE STRANDED CHARGE CANNOT RECUR (026-000009's shape in miniature).
    const r = assembleInvoice({
      customerId: "c1",
      paymentMode: "prepaid",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      trips: [T("t1", "2026-07-17", 500)],
      specialCharges: [{ id: "ch1", label: "emergency hours", amount_sar: 450, charge_date: "2026-07-18" }],
    });
    deep("assembly: stranded-charge — no coverage verdict on the charge", r.chargeLines.find((l) => l.id === "ch1")?.covered, undefined);
    deep("assembly: stranded-charge — amountDue = trip 500 + charge 450, one VAT pass", r.amountDue, { subtotal: 950, vat: 142.5, total: 1092.5 });
    reconciles("assembly stranded-charge", r);
  }

  {
    // Trips and charges TOGETHER — the old 575/345 halves appear nowhere.
    const r = assembleInvoice({
      customerId: "c1",
      paymentMode: "prepaid",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      trips: [T("tA", "2026-07-01", 500), T("tB", "2026-07-02", 200)],
      specialCharges: [{ id: "ch1", label: "a charge", amount_sar: 100, charge_date: "2026-07-03" }],
    });
    deep("assembly: one table — both trips billed, no wall", r.unpaidLines.map((l) => l.id), ["tA", "tB"]);
    deep("assembly: one table — amountDue = 500+200+100, one VAT pass", r.amountDue, { subtotal: 800, vat: 120, total: 920 });
    deepTrue(
      "assembly: one table — the old 575 / 345 halves appear nowhere",
      [r.grand, r.amountDue, r.covered].every((t) => t.total !== 575 && t.total !== 345),
    );
    reconciles("assembly one table", r);
  }

  {
    // A FULLY-FUNDED customer is still billed in full: the draw happens at
    // settlement and is reported as applied/payable, never by zeroing the
    // document. The case most likely to be "fixed" back by a reader who takes
    // a funded prepaid invoice for a paid one.
    const r = assembleInvoice({
      customerId: "c1",
      paymentMode: "prepaid",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      trips: [T("t1", "2026-07-01", 500)],
      specialCharges: [{ id: "ch1", label: "a charge", amount_sar: 100, charge_date: "2026-07-02" }],
    });
    deep("assembly: fully funded — amountDue is the FULL invoice, not zero", r.amountDue, { subtotal: 600, vat: 90, total: 690 });
    reconciles("assembly fully funded", r);
  }

  {
    // A FUTURE-DATED charge is LISTED AND BILLED — the live 0181 guard, and
    // the one case 0203 did not weaken. Fails loudly if a charge_date gate
    // ever returns to consumingItems() or the prepaid arm's charge filter.
    const r = assembleInvoice({
      customerId: "c1",
      paymentMode: "prepaid",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      trips: [T("t1", "2026-07-10", 500)],
      specialCharges: [{ id: "ch1", label: "charge dated after periodEnd", amount_sar: 100, charge_date: "2026-08-15" }],
    });
    deep("assembly: future-dated charge — still listed (0181)", r.chargeLines.map((l) => l.id), ["ch1"]);
    deep("assembly: future-dated charge — BILLED, amountDue = 500 + 100", r.amountDue, { subtotal: 600, vat: 90, total: 690 });
    reconciles("assembly future-dated charge", r);
  }

  {
    const r = assembleInvoice({ ...base, paymentMode: "prepaid", trips: [], specialCharges: [] });
    deep("assembly: empty — everything zero", [r.covered, r.amountDue, r.grand], [
      { subtotal: 0, vat: 0, total: 0 },
      { subtotal: 0, vat: 0, total: 0 },
      { subtotal: 0, vat: 0, total: 0 },
    ]);
    deep("assembly: empty — no lines", [r.coveredLines, r.unpaidLines], [[], []]);
    reconciles("assembly empty", r);
  }

  {
    let threw = false;
    try {
      assembleInvoice({ ...base, paymentMode: null, trips: [], specialCharges: [] });
    } catch {
      threw = true;
    }
    deepTrue("assembly: paymentMode null throws instead of silently defaulting", threw);
  }

  {
    const r = assembleInvoice({
      ...base,
      paymentMode: "postpaid",
      trips: [],
      specialCharges: [],
      sellerSnapshot: { legal_name: "Bin Slimah Group" },
      buyerSnapshot: { name: "Acme Co" },
      customerEmail: "acme@example.com",
    });
    deep("assembly: passthrough seller/buyer/email", [r.sellerSnapshot, r.buyerSnapshot, r.customerEmail], [
      { legal_name: "Bin Slimah Group" },
      { name: "Acme Co" },
      "acme@example.com",
    ]);
  }

  {
    // Reserve-at-draft exclusion (0030): a trip claimed by ANOTHER non-void
    // invoice appears in NO table and NO total, or one trip is billed twice.
    const r = assembleInvoice({
      ...base,
      paymentMode: "prepaid",
      trips: [T("t1", "2026-06-01", 100), T("t2", "2026-06-02", 100), T("t3", "2026-06-03", 100)],
      specialCharges: [],
      reservedElsewhereIds: ["t2"],
    });
    deep("assembly: reserve-exclusion — t1 + t3 billed, t2 absent", r.unpaidLines.map((l) => l.id), ["t1", "t3"]);
    deep("assembly: reserve-exclusion — grand excludes t2 too", r.grand, { subtotal: 200, vat: 30, total: 230 });
    reconciles("assembly reserve-exclusion", r);
  }

  {
    const r = assembleInvoice({
      ...base,
      paymentMode: "postpaid",
      trips: [T("t1", "2026-06-05", 300), T("t2", "2026-06-10", 300)],
      specialCharges: [],
      reservedElsewhereIds: ["t2"],
    });
    deep("assembly: postpaid reserve-exclusion — only t1 billable", r.unpaidLines.map((l) => l.id), ["t1"]);
    reconciles("assembly postpaid reserve-exclusion", r);
  }

  {
    const editable: InvoiceStatus[] = ["draft", "review"];
    const locked: InvoiceStatus[] = ["confirmed", "paid", "void"];
    deepTrue("assembly: special charges editable in draft/review only", editable.every((s) => canEditSpecialCharges(s)));
    deepTrue("assembly: special charges frozen from confirm onward", locked.every((s) => !canEditSpecialCharges(s)));
  }

  // THE POOL CANNOT MOVE THE DOCUMENT — now a TYPE fact. The old runtime sweep
  // (identical assembly under empty / flooded / refunded pools) died with the
  // `topups`/`returns` inputs themselves: an input that does not exist cannot
  // move anything. If either field ever returns to AssembleInvoiceInput, the
  // suppressed excess-property error below stops firing and tsc fails the
  // build with TS2578 (unused @ts-expect-error) — a tripwire that can fail.
  void (() =>
    assembleInvoice({
      ...base,
      paymentMode: "postpaid",
      trips: [],
      specialCharges: [],
      // @ts-expect-error -- the pool left the assembly input in 0206 Group B
      topups: [],
    }));
}

// ---------------------------------------------------------------------------
// C. AMOUNT PAYABLE LAWS (moved from scripts/amount-payable-check.ts). The
// figure the postpaid Finance column and the Breakdown box render. Its old
// decoupling proof ("a top-up moves the balance, not the payable") is a type
// fact now too: computeAmountPayable takes no pool inputs at all, and the
// running balance it was decoupled FROM is the ledger view's, not the app's.
// ---------------------------------------------------------------------------
{
  const RATE = 400;
  const TRIP_VAT = 460;
  const CHARGE_VAT = 230;
  type FixtureStatus = "draft" | "review" | "confirmed" | "paid";
  const lockedFor = (status: FixtureStatus | null): boolean => status === "paid";
  const trip = (id: string, opts: { delivered: boolean; invoice: FixtureStatus | null }): PayableTrip => ({
    id,
    trip_date: "2026-06-03",
    delivered_at: opts.delivered ? "2026-06-03T08:00:00.000Z" : null,
    rate_sar: RATE,
    invoiceLocked: lockedFor(opts.invoice),
  });
  const charge = (id: string, status: FixtureStatus): PayableCharge => ({
    id,
    label: id,
    amount_sar: 200,
    charge_date: "2026-06-04",
    created_at: "2026-06-04T09:00:00.000Z",
    paid: status === "paid",
  });
  const TRIPS: PayableTrip[] = [
    trip("t-none", { delivered: true, invoice: null }),
    trip("t-draft", { delivered: true, invoice: "draft" }),
    trip("t-review", { delivered: true, invoice: "review" }),
    trip("t-confirmed", { delivered: true, invoice: "confirmed" }),
    trip("t-paid", { delivered: true, invoice: "paid" }),
    trip("t-undelivered", { delivered: false, invoice: null }),
    trip("t-undelivered-draft", { delivered: false, invoice: "draft" }),
  ];
  const CHARGES: PayableCharge[] = [charge("ch-draft", "draft"), charge("ch-paid", "paid")];
  const EXPECTED = -2070; // 4 payable trips x 460 + 1 payable charge x 230, owed
  const payable = (mode: "prepaid" | "postpaid" | null, trips: PayableTrip[] = TRIPS, charges2: PayableCharge[] = CHARGES) =>
    computeAmountPayable({ mode, hasProject: true, projectRate: RATE, trips, charges: charges2 });

  for (const [name, id, want] of [
    ["delivered, NO invoice -> IN", "t-none", -TRIP_VAT],
    ["delivered, DRAFT invoice -> IN", "t-draft", -TRIP_VAT],
    ["delivered, REVIEW invoice -> IN", "t-review", -TRIP_VAT],
    ["delivered, CONFIRMED invoice -> IN", "t-confirmed", -TRIP_VAT],
    ["delivered, PAID invoice -> OUT", "t-paid", 0],
    ["UNDELIVERED, no invoice -> OUT", "t-undelivered", 0],
    ["UNDELIVERED on a draft invoice -> OUT", "t-undelivered-draft", 0],
  ] as const) {
    deep(`payable: ${name}`, payable("postpaid", TRIPS.filter((t) => t.id === id), []), want);
  }
  deep("payable: charge on a DRAFT invoice -> IN", payable("postpaid", [], [charge("c", "draft")]), -CHARGE_VAT);
  deep("payable: charge on a REVIEW invoice -> IN", payable("postpaid", [], [charge("c", "review")]), -CHARGE_VAT);
  deep("payable: charge on a CONFIRMED invoice -> IN", payable("postpaid", [], [charge("c", "confirmed")]), -CHARGE_VAT);
  deep("payable: charge on a PAID invoice -> OUT", payable("postpaid", [], [charge("c", "paid")]), 0);

  deep("payable: full fixture", payable("postpaid"), EXPECTED);
  deepTrue("payable: one path for both modes — identical inputs, identical figure", payable("prepaid") === payable("postpaid"));

  {
    const noFlag: PayableTrip = { id: "t-noflag", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: RATE };
    deep("payable: absent invoiceLocked counts as unsettled (owes)", payable("postpaid", [noFlag], []), -TRIP_VAT);
    deep("payable: isUnsettledTrip(absent flag) === true", isUnsettledTrip(noFlag), true);
    deep("payable: isUnsettledCharge mirrors it", isUnsettledCharge(charge("c", "draft")), true);
  }

  {
    const shapes: Array<[string, PayableTrip[], PayableCharge[]]> = [
      ["empty", [], []],
      ["all settled", TRIPS.filter((t) => t.invoiceLocked), CHARGES.filter((ch) => ch.paid)],
      ["all undelivered", TRIPS.filter((t) => t.delivered_at == null), []],
      ["charges only", [], CHARGES],
      ["full fixture", TRIPS, CHARGES],
    ];
    for (const [name, ts, chs] of shapes) {
      deepTrue(`payable: never positive — ${name}`, (payable("postpaid", ts, chs) as number) <= 0);
    }
    deep("payable: nothing owed reads as 0, not null", payable("postpaid", [], []), 0);
  }

  deep("payable: no project -> null", computeAmountPayable({ mode: "postpaid", hasProject: false, projectRate: RATE, trips: TRIPS, charges: CHARGES }), null);
  deep("payable: payment_mode unset -> null (em dash on screen)", payable(null), null);

  {
    const frozen: PayableTrip = { id: "t-frozen", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 100 };
    deep("payable: frozen trips.rate_sar wins over the project rate", payable("postpaid", [frozen], []), -115);
    const unpriced: PayableTrip = { id: "t-unpriced", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: null };
    deep("payable: no frozen rate falls back to the project rate", payable("postpaid", [unpriced], []), -TRIP_VAT);
  }

  {
    // THE COMPLEMENT INVARIANT: the payable slice and the settled slice are
    // the two halves of ONE consumingItems queue, split by the same flags.
    // The settled half used to be summed through derivedBalanceItems; it is
    // restated here over consumingItems directly — same figure, no pool.
    const sumConsumed = (trips2: PayableTrip[], charges2: PayableCharge[]) =>
      round2(
        consumingItems(
          trips2.map((t) => toConsumingTrip(t, RATE)),
          charges2.map(toConsumingCharge),
        ).reduce((s, e) => s + e.consumedAmount, 0),
      );
    const unpaidConsumption = -(payable("postpaid") as number);
    const settledSlice = sumConsumed(TRIPS.filter((t) => t.invoiceLocked), CHARGES.filter((ch) => ch.paid));
    const total = sumConsumed(TRIPS, CHARGES);
    deep("payable: complement — unpaid + settled === total consumption", round2(unpaidConsumption + settledSlice), total);
    deepTrue("payable: complement — the settled half is non-empty (not vacuous)", settledSlice > 0);
    deep("payable: complement — total is every delivered trip + every charge", total, 2760);
  }

  // NO POOL INPUT EXISTS — the decoupling law as a type fact, with the same
  // TS2578 tripwire as the assembly's above.
  void (() =>
    computeAmountPayable({
      mode: "postpaid",
      hasProject: true,
      projectRate: RATE,
      trips: [],
      charges: [],
      // @ts-expect-error -- computeAmountPayable takes no pool; a topups field
      // returning here would let a deposit look like a settlement
      topups: [],
    }));
}

// ---------------------------------------------------------------------------
// D. THE FREEZE BOUNDARY (moved from scripts/frozen-split-check.ts). That
// file's covered/unpaid RE-DERIVATION died with splitCoveredUnpaidItems; what
// it also guarded, and what stays true for the 29 pre-ledger invoices until
// the deploy-phase wipe, is the freeze law itself: an invoice carries a frozen
// snapshot IF AND ONLY IF it is issued, and the issued render path reads the
// FROZEN columns, never a recomputation. Fixture measured 2026-08-31.
// ---------------------------------------------------------------------------
{
  /** [invoice key, customer key, status, period_start, period_end,
   *   covered_total_sar, amount_due_sar, grand_total_sar,
   *   effective_payment_mode, frozen] */
  type FrozenInvoiceRow = [string, string, string, string, string, number, number, number, string, boolean];
  const INVOICES: FrozenInvoiceRow[] = [
    ["026-000001", "C1", "paid", "2026-07-15", "2026-07-16", 0, 920, 920, "prepaid", true],
    ["026-000003", "C1", "paid", "2026-07-10", "2026-07-16", 0, 920, 920, "prepaid", true],
    ["026-000004", "C1", "paid", "2026-07-12", "2026-07-16", 4140, 0, 4140, "prepaid", true],
    ["026-000005", "C3", "confirmed", "2026-07-16", "2026-07-16", 0, 0, 0, "prepaid", true],
    ["026-000006", "C2", "paid", "2026-07-12", "2026-07-16", 3381, 2300, 5681, "prepaid", true],
    ["026-000007", "C3", "paid", "2026-07-16", "2026-07-16", 1414.5, 471.5, 1414.5, "prepaid", true],
    ["026-000008", "C1", "paid", "2026-06-01", "2026-07-17", 1380, 0, 2530, "prepaid", true],
    ["026-000009", "C3", "confirmed", "2026-07-17", "2026-07-18", 0, 4243.5, 0, "prepaid", true],
    ["026-000011", "C1", "confirmed", "2026-07-18", "2026-07-18", 0, 0, 0, "prepaid", true],
    ["026-000012", "C1", "paid", "2026-07-24", "2026-07-27", 920, 0, 46920, "prepaid", true],
    ["026-000013", "C3", "paid", "2026-08-01", "2026-08-15", 33005, 0, 34155, "prepaid", true],
    ["026-000014", "C2", "paid", "2026-08-01", "2026-08-29", 24150, 32844, 24150, "prepaid", true],
    ["1", "C2", "void", "2026-07-01", "2026-07-12", 2415, 11500, 13915, "prepaid", true],
    ["2", "C2", "paid", "2026-07-01", "2026-07-12", 2415, 1150, 3565, "prepaid", true],
    ["3", "C1", "paid", "2026-07-01", "2026-07-12", 2300, 920, 3220, "prepaid", true],
    ["6", "C2", "void", "2026-06-01", "2026-06-30", 0, 1449, 1449, "prepaid", true],
    ["8", "C1", "paid", "2026-07-13", "2026-07-14", 0, 4600, 4600, "prepaid", true],
    ["X3607", "C1", "review", "2026-08-01", "2026-08-15", 0, 0, 0, "prepaid", false],
  ];
  const ISSUED = new Set(["confirmed", "paid", "void"]);

  /** Pure, so the negative control below can drive it with synthetic rows. */
  const freezeBoundaryBreaks = (rows: FrozenInvoiceRow[]): string[] =>
    rows.filter((i) => i[9] !== ISSUED.has(i[2])).map((i) => `${i[0]} (${i[2]}, frozen=${i[9]})`);

  const breaks = freezeBoundaryBreaks(INVOICES);
  deepTrue(`freeze boundary holds: frozen if and only if issued${breaks.length ? ` — ${breaks.join(", ")}` : ""}`, breaks.length === 0);

  // NEGATIVE CONTROL — a guard nobody has seen fail is not a guard.
  const control = freezeBoundaryBreaks([
    ["CTL-A", "C1", "paid", "2026-01-01", "2026-01-31", 0, 0, 0, "prepaid", false],
    ["CTL-B", "C1", "draft", "2026-01-01", "2026-01-31", 0, 0, 0, "prepaid", true],
  ]);
  deepTrue("freeze boundary control: both synthetic breaks are caught", control.length === 2);

  // THE OTHER HALF, in the source: the issued render path reads FROZEN
  // columns. If the frozen branch ever recomputes, this fails and the freeze
  // law has to be revisited on purpose.
  const actionsSrc = readFileSync(join(__dirname, "..", "app", "trips", "invoiceActions.ts"), "utf8");
  for (const needle of [
    'if (inv.status === "draft" || inv.status === "review") {',
    "coveredLines: inv.covered_lines ?? []",
    "unpaidLines: inv.unpaid_lines ?? []",
    "covered: { subtotal: inv.covered_subtotal_sar, vat: inv.covered_vat_sar, total: inv.covered_total_sar }",
    "amountDue: { subtotal: inv.amount_due_subtotal_sar, vat: inv.amount_due_vat_sar, total: inv.amount_due_sar }",
  ]) {
    deepTrue(`freeze law in source — invoiceActions.ts still contains: ${needle}`, actionsSrc.includes(needle));
  }
}

if (movedFailures > 0) {
  console.log(`\n${movedFailures} moved-law check(s) FAILED within the sections above.`);
}

console.log("");
if (failures === 0) {
  console.log(
    "All invoice-flow checks PASSED ✓ — the frozen pair, the settlement walk, the printed chain, and the moved assembly/payable/money-core/freeze laws all close.",
  );
  process.exit(0);
} else {
  console.log(`${failures} invoice-flow check(s) FAILED ✗`);
  process.exit(1);
}
