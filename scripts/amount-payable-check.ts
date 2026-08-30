// Math confidence harness for the AMOUNT PAYABLE column
// (app/trips/amountPayable.ts). No DB, no test framework.
// Run:  npx tsx scripts/amount-payable-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).
//
// WHY THIS FILE EXISTS. computeAmountPayable had NO harness at all — the only
// mention of it anywhere under scripts/ was a comment in covered-unpaid-check.
// It is the figure the Finance tab and the project Breakdown report both render
// as "what this customer still owes us", so it was the largest unguarded money
// surface in the tree.
//
// THE RULE IT GUARDS (one rule, BOTH payment modes): the VAT-inclusive value of
// every DELIVERED trip and every non-void special charge NOT YET on a PAID
// invoice. Draft / review / confirmed do not reduce it; only Mark Paid does.
// A prepaid top-up does not reduce it either — a pool FUNDS delivered work, it
// does not SETTLE it. Sign: negative = owed to us, zero = settled, never above
// zero.
//
// The prepaid RUNNING BALANCE is a different number and still deducts at
// DELIVERY (Model A). The decoupling case below asserts both halves at once:
// a top-up moves the balance and leaves the payable alone. That case is the
// one that FAILS against the pre-change code, so it is the regression test for
// this whole change.

import {
  computeAmountPayable,
  toConsumingTrip,
  toConsumingCharge,
  isUnsettledTrip,
  isUnsettledCharge,
  type PayableTrip,
  type PayableCharge,
} from "../app/trips/amountPayable";
import { consumingItems, derivedBalanceItems, round2, type TopupLite } from "../lib/prepaid";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name}` + (ok ? "" : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`));
}

const RATE = 400; // 400 * 1.15 = 460 consumed, VAT-inclusive
const TRIP_VAT = 460;
const CHARGE_VAT = 230; // 200 * 1.15

type InvoiceStatus = "draft" | "review" | "confirmed" | "paid";

// UPSTREAM DERIVATION, REPRODUCED RATHER THAN HAND-WAVED. These two mirror
// app/trips/page.tsx exactly — `:265` for trips and `:362` for charges, both
// off the single `.eq("status","paid")` query at `:233`. Writing the booleans
// by hand would let the harness agree with itself while disagreeing with the
// page; deriving them from a status means each case below really does say
// "a trip on a DRAFT invoice", not "a trip whose flag I set to false".
const lockedFor = (status: InvoiceStatus | null): boolean => status === "paid";
const chargePaidFor = (status: InvoiceStatus): boolean => status === "paid";

function trip(id: string, opts: { delivered: boolean; invoice: InvoiceStatus | null }): PayableTrip {
  return {
    id,
    trip_date: "2026-06-03",
    delivered_at: opts.delivered ? "2026-06-03T08:00:00.000Z" : null,
    rate_sar: RATE,
    invoiceLocked: lockedFor(opts.invoice),
  };
}

function charge(id: string, status: InvoiceStatus): PayableCharge {
  return {
    id,
    label: id,
    amount_sar: 200,
    charge_date: "2026-06-04",
    created_at: "2026-06-04T09:00:00.000Z",
    paid: chargePaidFor(status),
  };
}

// The canonical fixture: every trip state that exists, plus one payable charge
// and one settled charge. VOID invoices are absent on purpose — page.tsx:354
// drops those charges upstream, so a void charge never reaches this function
// and a fixture containing one would be testing a path that cannot happen.
const TRIPS: PayableTrip[] = [
  trip("t-none", { delivered: true, invoice: null }), // 460 — in
  trip("t-draft", { delivered: true, invoice: "draft" }), // 460 — in
  trip("t-review", { delivered: true, invoice: "review" }), // 460 — in
  trip("t-confirmed", { delivered: true, invoice: "confirmed" }), // 460 — in
  trip("t-paid", { delivered: true, invoice: "paid" }), // out — settled
  trip("t-undelivered", { delivered: false, invoice: null }), // out — not delivered
  trip("t-undelivered-draft", { delivered: false, invoice: "draft" }), // out — delivered gate wins
];
const CHARGES: PayableCharge[] = [
  charge("ch-draft", "draft"), // 230 — in
  charge("ch-paid", "paid"), // out — settled
];

// 4 payable trips (4 x 460 = 1840) + 1 payable charge (230) = 2070, owed.
const EXPECTED = -2070;

const payable = (
  mode: "prepaid" | "postpaid" | null,
  trips: PayableTrip[] = TRIPS,
  charges: PayableCharge[] = CHARGES,
) => computeAmountPayable({ mode, hasProject: true, projectRate: RATE, trips, charges });

// --- Per-state membership: which trips land in the figure ---------------------
// Each case is the full fixture MINUS everything but the trip under test, so a
// pass means "this state contributes exactly this much", not "the total happens
// to come out right".
for (const [name, id, want] of [
  ["delivered, NO invoice -> IN", "t-none", -TRIP_VAT],
  ["delivered, DRAFT invoice -> IN", "t-draft", -TRIP_VAT],
  ["delivered, REVIEW invoice -> IN", "t-review", -TRIP_VAT],
  ["delivered, CONFIRMED invoice -> IN", "t-confirmed", -TRIP_VAT],
  ["delivered, PAID invoice -> OUT", "t-paid", 0],
  ["UNDELIVERED, no invoice -> OUT", "t-undelivered", 0],
  ["UNDELIVERED on a draft invoice -> OUT", "t-undelivered-draft", 0],
] as const) {
  check(`prepaid: ${name}`, payable("prepaid", TRIPS.filter((t) => t.id === id), []), want);
}

// --- Per-state membership: charges -------------------------------------------
check("prepaid: charge on a DRAFT invoice -> IN", payable("prepaid", [], [charge("c", "draft")]), -CHARGE_VAT);
check("prepaid: charge on a REVIEW invoice -> IN", payable("prepaid", [], [charge("c", "review")]), -CHARGE_VAT);
check("prepaid: charge on a CONFIRMED invoice -> IN", payable("prepaid", [], [charge("c", "confirmed")]), -CHARGE_VAT);
check("prepaid: charge on a PAID invoice -> OUT", payable("prepaid", [], [charge("c", "paid")]), 0);

// --- The whole fixture, both modes, and the COLLAPSE proof --------------------
check("prepaid: full fixture", payable("prepaid"), EXPECTED);
check("postpaid: full fixture (regression — all 4 statuses)", payable("postpaid"), EXPECTED);
check(
  "prepaid and postpaid are the SAME figure for identical inputs (one path, not two)",
  payable("prepaid") === payable("postpaid"),
  true,
);

// --- Missing flag reads as UNSETTLED, never as settled -----------------------
// `invoiceLocked` is optional. The fallback direction is a money decision: an
// unknown lock state must OWE, not silently drop out of a receivable.
{
  const noFlag: PayableTrip = {
    id: "t-noflag",
    trip_date: "2026-06-03",
    delivered_at: "2026-06-03T08:00:00.000Z",
    rate_sar: RATE,
  };
  check("absent invoiceLocked counts as unsettled (owes)", payable("prepaid", [noFlag], []), -TRIP_VAT);
  check("isUnsettledTrip(absent flag) === true", isUnsettledTrip(noFlag), true);
  check("isUnsettledCharge mirrors it on the charge side", isUnsettledCharge(charge("c", "draft")), true);
}

// --- THE DECOUPLING PROOF: a top-up moves the BALANCE, not the PAYABLE -------
// This is the case that fails against the pre-change code, where the prepaid
// arm returned the running balance itself. A huge top-up with zero paid
// invoices must leave the payable exactly where it was — the customer has
// funded the work, not settled it — while the balance swings by the full
// amount. Both halves are asserted, because either one alone would still pass
// if the two numbers had been wired together the other way round.
{
  const hugeTopup: TopupLite[] = [{ id: "u1", amount_sar: 1_000_000, topup_date: "2026-06-01" }];
  const allConsuming = TRIPS.map((t) => toConsumingTrip(t, RATE));
  const allCharges = CHARGES.map(toConsumingCharge);

  check("huge top-up, zero paid invoices: PAYABLE unchanged", payable("prepaid"), EXPECTED);

  // Running balance (Model A) over UNFILTERED inputs — every delivered trip and
  // every non-void charge consumes, paid or not. 5 delivered trips x 460 = 2300,
  // plus 2 charges x 230 = 460, so 2760 consumed against the pool.
  const balanceNoTopup = derivedBalanceItems([], allConsuming, allCharges);
  const balanceWithTopup = derivedBalanceItems(hugeTopup, allConsuming, allCharges);
  check("running balance without the top-up", balanceNoTopup, -2760);
  check("running balance WITH the top-up (it moves)", balanceWithTopup, 997_240);
  check(
    "the two numbers are decoupled: balance moved by the full top-up, payable by 0",
    round2(balanceWithTopup - balanceNoTopup) === 1_000_000 && payable("prepaid") === EXPECTED,
    true,
  );
  check(
    "a funded prepaid customer can hold credit AND owe on the column at once",
    balanceWithTopup > 0 && (payable("prepaid") as number) < 0,
    true,
  );
}

// --- NEVER POSITIVE ----------------------------------------------------------
// There is no credits side, so nothing can drive the figure above zero. Swept
// across every fixture shape rather than asserted once, because "never" is the
// claim.
{
  const shapes: Array<[string, PayableTrip[], PayableCharge[]]> = [
    ["empty", [], []],
    ["all settled", TRIPS.filter((t) => t.invoiceLocked), CHARGES.filter((ch) => ch.paid)],
    ["all undelivered", TRIPS.filter((t) => t.delivered_at == null), []],
    ["charges only", [], CHARGES],
    ["full fixture", TRIPS, CHARGES],
  ];
  for (const [name, ts, chs] of shapes) {
    for (const mode of ["prepaid", "postpaid"] as const) {
      check(`${mode}: never positive — ${name}`, (payable(mode, ts, chs) as number) <= 0, true);
    }
  }
  check("prepaid: nothing owed reads as 0, not null", payable("prepaid", [], []), 0);
}

// --- Null cases: we do NOT guess at a receivable -------------------------------
check("no project -> null", computeAmountPayable({ mode: "prepaid", hasProject: false, projectRate: RATE, trips: TRIPS, charges: CHARGES }), null);
check("payment_mode unset -> null (em dash on screen)", payable(null), null);

// --- Frozen rate wins over the project's current rate --------------------------
// The rate rule lives in toConsumingTrip; this proves the payable inherits it
// rather than re-pricing delivered work whenever the project's rate moves.
{
  const frozen: PayableTrip = { id: "t-frozen", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: 100 };
  check("frozen trips.rate_sar is used, not the project rate", payable("prepaid", [frozen], []), -115);
}
{
  const unpriced: PayableTrip = { id: "t-unpriced", trip_date: "2026-06-03", delivered_at: "2026-06-03T08:00:00.000Z", rate_sar: null };
  check("no frozen rate falls back to the project rate", payable("prepaid", [unpriced], []), -TRIP_VAT);
}

// --- THE COMPLEMENT INVARIANT --------------------------------------------------
// Amount Payable and FinanceTab's Settled Balance consumption slice are the two
// halves of ONE queue, split by the same pair of flags. Their consumption must
// add back up to consumingItems() over the unfiltered input — no item dropped,
// none double-counted, no third rounding convention. This is the structural
// guard: it fails if either filter is ever narrowed or widened on its own.
{
  const unpaidConsumption = -(payable("prepaid") as number);

  // The Settled Balance slice, exactly as FinanceTab:292-307 builds it — same
  // flags, the other way round — reduced to its consumption term.
  const settledSlice = -derivedBalanceItems(
    [],
    TRIPS.filter((t) => t.invoiceLocked).map((t) => toConsumingTrip(t, RATE)),
    CHARGES.filter((ch) => ch.paid).map(toConsumingCharge),
  );

  const total = round2(
    consumingItems(
      TRIPS.map((t) => toConsumingTrip(t, RATE)),
      CHARGES.map(toConsumingCharge),
    ).reduce((s, e) => s + e.consumedAmount, 0),
  );

  check("complement: unpaid + settled === total consumption", round2(unpaidConsumption + settledSlice), total);
  check("complement: the settled half is non-empty (the check is not vacuous)", settledSlice > 0, true);
  check("complement: total is every delivered trip + every non-void charge", total, 2760);
}

console.log(failures === 0 ? "\nAll amount-payable checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
