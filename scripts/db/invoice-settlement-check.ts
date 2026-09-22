// LIVE DATABASE guard for the 0204 INVOICE SETTLEMENT flow — the freeze at
// confirm, the two ways money actually moves, the reservation Available now
// carries, and the bank-transfer proof rules.
// Run:  npm run test:db   (or: npx tsx scripts/db/invoice-settlement-check.ts)
// Exits 0 if every assertion passes, 1 otherwise (CI-friendly).
//
// Pass 5 of the scripts/db suite. Same discipline as the other four: ONE
// transaction ending in ROLLBACK, a savepoint per case, refusals matched
// against their raise text, and a census on a FRESH connection that includes
// all three document-number counters.
//
// ---------------------------------------------------------------------------
// WHAT CHANGED, AND WHY THIS FILE WAS REWRITTEN
//
// Until 0204, confirm_invoice DREW min(Available, grand_total) out of the
// prepaid balance. Confirming was therefore a payment, and a prepaid invoice
// could land on 'paid' without anyone recording a settlement. Turki ruled that
// out. 0204 deleted the draw:
//
//   confirm_invoice moves NO money. It freezes amount_payable_sar =
//   grand_total and prepaid_applied_sar = 0, leaves status 'confirmed', and
//   writes NO customer_ledger row — prepaid and postpaid alike.
//
// The previous version of this file asserted the opposite. Those assertions
// were not wrong code, they were an EXPIRED SPEC, so they are gone rather than
// repaired. What replaces them is the 0204 contract:
//
//   money moves through apply_balance_to_invoice (the prepaid balance) and
//   record_invoice_payment (cash / bank transfer), and ONLY those two. Each
//   flips the invoice to 'paid' when the remainder reaches zero, and only then.
//
// The balance must still be reserved against debt already issued, or a
// customer could be refunded money he owes on a confirmed invoice. 0204 moved
// that reservation out of the ledger and into the view:
//
//   Available = Balance − Uninvoiced − unsettled remainder of confirmed,
//               ledger-era invoices
//
// with the reservation exposed as the new sixth column,
// confirmed_unsettled_sar.
//
// ---------------------------------------------------------------------------
// THE SEVEN PROOFS
//
//   1  confirm freezes and moves nothing: status 'confirmed', payable ==
//      grand_total, applied == 0, NO ledger row, Balance untouched. Asserted
//      for a prepaid customer WITH money on the books (§A) and for a postpaid
//      one (§B) — a rich prepaid customer is the only shape in which a
//      resurrected draw would have something to take, so a poor fixture would
//      pass this vacuously
//   2  a PARTIAL apply_balance reduces the remainder and leaves the invoice
//      unpaid (§D)
//   3  the apply that takes the remainder to zero — and, on the cash arm, the
//      payment that does — flips the invoice to 'paid', and only then (§D, §B)
//   4  Available RESERVES confirmed debt: confirming moves the invoice's value
//      out of Uninvoiced and into confirmed_unsettled_sar in the same instant,
//      Available does not jump, and the reservation shrinks as the invoice is
//      settled and vanishes when it is paid (§C)
//   5  apply_balance still works when the remainder EXCEEDS the balance (§E)
//   6  a refund is capped by the NEW Available, which is strictly tighter than
//      Balance − Uninvoiced while a confirmed invoice is unsettled (§F)
//   7  the bank-transfer proof rules raise on all three money RPCs when the
//      photo/proof, the reference or (for a payment) the date is missing, and
//      cash requires none of them (§G)
//
// plus, kept from the previous version because 0204 did not touch them and
// dropping live coverage is a loss: the legacy gate on null amount_payable_sar,
// the input gates, void reversing an applied row, and the anon grants
// (CLAUDE.md §6).
//
// ---------------------------------------------------------------------------
// WHY §E IS THE LOAD-BEARING ONE
//
// apply_balance_to_invoice adds the invoice's OWN unsettled remainder back to
// Available before capping the draw. Without that line the invoice being
// settled is counted against itself: a customer with 300 on the books against
// a 400 remainder reads as Available −100, least(−100, 400) is negative, and
// the RPC raises "Nothing to apply" — he can never spend the balance he
// actually has. §E is that exact shape, and it asserts the PRECONDITION
// (Available really is negative) alongside the outcome, so it cannot pass by
// accident on a fixture where Available happened to be positive.
//
// Note that this is not a corner case bolted on for the test. A partial apply
// requires min(Available + remainder, remainder) < remainder, which is to say
// Available < 0. EVERY partial application in this file therefore runs through
// the self-reservation line; §D would go red with it too. §E exists because it
// names the case in one clean fixture with nothing else moving.
//
// ---------------------------------------------------------------------------
// THE SEED SHAPE IS THE REAL ONE, NOT A CONVENIENT ONE
//
// Trip A carries invoice_id = the review invoice, because the app reserves
// trips at DRAFT (invoiceActions -> p_trip_ids). v_customer_uninvoiced counts a
// delivered trip while its invoice is draft/review and drops it the instant the
// status flips, so the value of a confirmed invoice leaves Uninvoiced and
// enters the confirmed-remainder term in the same instant. That continuity is
// what §C measures; seeding the trip with a NULL invoice_id would let the same
// money sit in both terms and Available would sag by a whole invoice at
// confirm.
//
// Trip B is delivered, in the same period, and on NO invoice. It exists so that
// Uninvoiced is non-zero throughout — without it Balance, Available and the
// reservation arithmetic all collapse onto the same number and a view that
// forgot a term would still read correctly.
// ---------------------------------------------------------------------------

import { Client, type QueryResult } from "pg";
import {
  check as rawCheck, connOptions, fail as rawFail, failureCount, loadTestEnv,
  money, ok as rawOk, PROVISION_STATION_SQL, SEED_STATION, SEED_WATER_TYPE, TEST_REF,
} from "./harness";

// ---------------------------------------------------------------------------
// Assertion counting. harness.ts counts FAILURES, which is the wrong half of
// the question here: a harness that seeded nothing, asserted nothing and rolled
// back reports zero failures and reads as a clean pass. Everything below goes
// through these three wrappers so the summary can name how many assertions
// actually ran, and the exit code can refuse a run that made none.
// ---------------------------------------------------------------------------

let assertions = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  assertions++;
  rawCheck(label, actual, expected);
}
function ok(label: string, cond: boolean): void {
  assertions++;
  rawOk(label, cond);
}
function fail(label: string, detail: string): void {
  assertions++;
  rawFail(label, detail);
}

// ---------------------------------------------------------------------------
// Fixture — every figure asserted below, derived once here and re-checked
// offline before a socket opens.
//
// 1234.60 is chosen so the VAT is EXACT at 2dp (1234.60 × 0.15 = 185.19, no
// rounding). ledger-check already owns the half-halala rounding pin; repeating
// it here would make a rounding failure light up two harnesses and tell you
// nothing about which layer moved.
// ---------------------------------------------------------------------------

const TRIP_NET = 1234.6;
const TRIP_VAT = 185.19;   // 1234.60 × 0.15, exact
const TRIP_GROSS = 1419.79; // TRIP_NET + TRIP_VAT

const UNINVOICED_BOTH = 2839.58;  // trips A + B, per-item gross — while A's invoice is 'review'
const UNINVOICED_AFTER = 1419.79; // trip B only — the instant A's invoice confirms

// --- §A / §C: a customer with plenty on the books. The confirm must leave all
//     of it alone, and Available must not move across the confirm.
const TOPUP_RICH = 5000.0;
const AVAIL_RICH_BEFORE = 2160.42; // 5000.00 − 2839.58 − 0
const AVAIL_RICH_AFTER = 2160.42;  // 5000.00 − 1419.79 − 1419.79 — continuity
const BAL_AFTER_FULL_APPLY = 3580.21; // 5000.00 − 1419.79

// --- §D: partial apply, then the rest.
const TOPUP_THIN = 2000.0;
const AVAIL_THIN_AT_CONFIRM = -839.58; // 2000.00 − 1419.79 − 1419.79 — NEGATIVE
const DRAW_PARTIAL = 580.21;           // min(Available + remainder, remainder) = min(580.21, 1419.79)
const REMAINDER_AFTER_PARTIAL = 839.58; // 1419.79 − 580.21
const BAL_AFTER_PARTIAL = 1419.79;      // 2000.00 − 580.21
const TOPUP_TOP = 1000.0;
const AVAIL_BEFORE_REST = 160.42;       // 2419.79 − 1419.79 − 839.58
const DRAW_REST = 839.58;               // min(160.42 + 839.58, 839.58) — capped by the REMAINDER
const BAL_AFTER_REST = 1580.21;         // 2419.79 − 839.58

// --- §B: the postpaid cash arm. Partial, then the payment that clears it.
const PAY_CASH = 300.0;
const REMAINDER_AFTER_CASH = 1119.79; // 1419.79 − 300.00
const OVERPAY = 1119.8;               // one halala past the remainder

// --- §E / §F: a single-trip invoice grossing a round 400.00, so the
//     self-reservation case reads as the 300-against-400 shape from the
//     migration comment with no arithmetic noise.
const SMALL_NET = 347.83;
const SMALL_VAT = 52.17;   // round(347.83 × 0.15, 2) = round(52.1745, 2)
const SMALL_GROSS = 400.0;

const PIN_TOPUP = 300.0;
const PIN_AVAIL = -100.0;   // 300.00 − 0 − 400.00 — the invoice reserved against itself
const PIN_DRAW = 300.0;     // the whole balance; least() still caps at the remainder
const PIN_REMAINDER = 100.0; // 400.00 − 300.00

const REF_TOPUP = 1000.0;
const REF_AVAIL = 600.0;      // 1000.00 − 0 − 400.00
const REF_OVER = 600.01;      // one halala past the NEW cap
const REF_BAL_AFTER = 400.0;  // 1000.00 − 600.00

const PERIOD_START = "2020-01-01";
const PERIOD_END = "2020-01-31";
const TRIP_DATE = "2020-01-15";
const PAID_ON = "2020-02-01";
const ACTOR = "settlechk@harness.local";

const TOPUP_SQL = `select * from public.record_topup($1::uuid, $2::numeric, $3::text, $4::text, $5::text, $6::text, $7::text)`;
// 0204 dropped the 6-argument record_refund. p_photo_path is argument 5.
const REFUND_SQL = `select * from public.record_refund($1::uuid, $2::numeric, $3::text, $4::text, $5::text, $6::text, $7::text)`;
const PAY_SQL = `select * from public.record_invoice_payment($1::uuid, $2::numeric, $3::text, $4::text, $5::text, $6::date, $7::text, $8::text)`;
const APPLY_SQL = `select * from public.apply_balance_to_invoice($1::uuid, $2::text)`;
const VOID_SQL = `select * from public.void_invoice($1::uuid, $2::text, $3::text)`;

// SAME `from`-clause rule as confirm-invoice-check: a composite-returning call
// expanded with `.*` in the target list is evaluated ONCE PER OUTPUT COLUMN, so
// the second evaluation would find the invoice already confirmed and raise
// "Invoice is not in review status" — a real bug wearing a green disguise.
// 0207: 18 arguments. $15 = p_payment_mode, $16 = p_actor; the two nulls are
// the ledger subtotals. No covered lines and no trip-id arrays any more — the
// trip is reserved at seed time (trips.invoice_id), the way the app's own
// draft reservation (0030) does it, and that reservation IS the linkage.
const CONFIRM_SQL = `
  select * from public.confirm_invoice(
    $1::uuid, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb,
    $6::numeric, $7::numeric, $8::numeric,
    $9::numeric, $10::numeric, $11::numeric,
    $12::numeric, $13::numeric, $14::numeric,
    null, null,
    $15::text, $16::text
  )`;

/** Confirm args for a one-trip invoice with NO pool-covered split. Under 0204
 *  nothing is covered at confirm for anyone, so covered is 0/0/0 and
 *  due == grand for prepaid and postpaid alike — which keeps 0191's Tier B
 *  (covered + due == grand) satisfied by construction. */
function confirmArgs(
  invoiceId: string, tripId: string, mode: string,
  net: number, vat: number, gross: number,
): unknown[] {
  return [
    invoiceId,
    JSON.stringify({ name: "SETTLECHK SELLER" }),
    JSON.stringify({ name: "SETTLECHK BUYER" }),
    JSON.stringify([{ kind: "trip", id: tripId, label: "SETTLECHK trip", date: TRIP_DATE, amount_sar: net }]),
    JSON.stringify([]),
    0, 0, 0,
    net, vat, gross,
    net, vat, gross,
    mode,
    ACTOR,
  ];
}

type Row = Record<string, unknown>;
type Outcome = { row: Row | null; err: { message: string } | null };

async function main(): Promise<void> {
  const env = loadTestEnv();
  const conn = connOptions(env);

  // ---- Literals re-derived offline BEFORE a socket opens. These fail on a bad
  //      constant, not on a bad database — so a red run here is never ambiguous.
  console.log("");
  check("fixture — TRIP_VAT is exact at 2dp", TRIP_VAT, money(TRIP_NET * 0.15));
  check("fixture — TRIP_GROSS = net + vat", TRIP_GROSS, money(TRIP_NET + TRIP_VAT));
  check("fixture — UNINVOICED_BOTH = 2 × gross", UNINVOICED_BOTH, money(2 * TRIP_GROSS));
  check("fixture — UNINVOICED_AFTER = 1 × gross", UNINVOICED_AFTER, TRIP_GROSS);
  check("fixture — AVAIL_RICH_BEFORE = topup − both trips − nothing reserved",
    AVAIL_RICH_BEFORE, money(TOPUP_RICH - UNINVOICED_BOTH - 0));
  check("fixture — AVAIL_RICH_AFTER = topup − trip B − the confirmed remainder",
    AVAIL_RICH_AFTER, money(TOPUP_RICH - UNINVOICED_AFTER - TRIP_GROSS));
  check("fixture — CONTINUITY: confirming does not move Available at all",
    AVAIL_RICH_AFTER, AVAIL_RICH_BEFORE);
  check("fixture — BAL_AFTER_FULL_APPLY = topup − the whole remainder",
    BAL_AFTER_FULL_APPLY, money(TOPUP_RICH - TRIP_GROSS));

  check("fixture — AVAIL_THIN_AT_CONFIRM is NEGATIVE, which is what a partial apply means",
    AVAIL_THIN_AT_CONFIRM < 0, true);
  check("fixture — AVAIL_THIN_AT_CONFIRM = topup − trip B − remainder",
    AVAIL_THIN_AT_CONFIRM, money(TOPUP_THIN - UNINVOICED_AFTER - TRIP_GROSS));
  check("fixture — DRAW_PARTIAL = min(Available + remainder, remainder) — the self-reservation",
    DRAW_PARTIAL, money(Math.min(AVAIL_THIN_AT_CONFIRM + TRIP_GROSS, TRIP_GROSS)));
  check("fixture — DRAW_PARTIAL is SHORT of the remainder, so the invoice stays unpaid",
    DRAW_PARTIAL < TRIP_GROSS, true);
  check("fixture — REMAINDER_AFTER_PARTIAL = remainder − draw",
    REMAINDER_AFTER_PARTIAL, money(TRIP_GROSS - DRAW_PARTIAL));
  check("fixture — BAL_AFTER_PARTIAL = topup − draw", BAL_AFTER_PARTIAL, money(TOPUP_THIN - DRAW_PARTIAL));
  check("fixture — AVAIL_BEFORE_REST = balance + second topup − trip B − remainder",
    AVAIL_BEFORE_REST, money(BAL_AFTER_PARTIAL + TOPUP_TOP - UNINVOICED_AFTER - REMAINDER_AFTER_PARTIAL));
  check("fixture — DRAW_REST is capped by the REMAINDER, not by Available",
    DRAW_REST, money(Math.min(AVAIL_BEFORE_REST + REMAINDER_AFTER_PARTIAL, REMAINDER_AFTER_PARTIAL)));
  check("fixture — DRAW_REST takes the remainder to exactly zero",
    money(REMAINDER_AFTER_PARTIAL - DRAW_REST), 0);
  check("fixture — BAL_AFTER_REST", BAL_AFTER_REST, money(BAL_AFTER_PARTIAL + TOPUP_TOP - DRAW_REST));

  check("fixture — REMAINDER_AFTER_CASH = grand total − cash", REMAINDER_AFTER_CASH, money(TRIP_GROSS - PAY_CASH));
  check("fixture — OVERPAY is one halala past the remainder", OVERPAY, money(REMAINDER_AFTER_CASH + 0.01));

  check("fixture — SMALL_VAT = round(net × 0.15, 2)", SMALL_VAT, money(SMALL_NET * 0.15));
  check("fixture — SMALL_GROSS is a round 400.00", SMALL_GROSS, money(SMALL_NET + SMALL_VAT));
  check("fixture — the per-trip Uninvoiced rounding agrees with the document total",
    SMALL_GROSS, money(SMALL_NET * 1.15));
  check("fixture — PIN_AVAIL = topup − 0 uninvoiced − the whole remainder", PIN_AVAIL, money(PIN_TOPUP - SMALL_GROSS));
  check("fixture — PIN is the migration's own shape: balance BELOW the remainder", PIN_TOPUP < SMALL_GROSS, true);
  check("fixture — PIN_AVAIL is NEGATIVE, which is the whole point of §E", PIN_AVAIL < 0, true);
  check("fixture — PIN_DRAW = min(Available + remainder, remainder) = the whole balance",
    PIN_DRAW, money(Math.min(PIN_AVAIL + SMALL_GROSS, SMALL_GROSS)));
  check("fixture — PIN_REMAINDER = remainder − draw", PIN_REMAINDER, money(SMALL_GROSS - PIN_DRAW));
  check("fixture — REF_AVAIL = topup − 0 uninvoiced − the confirmed remainder", REF_AVAIL, money(REF_TOPUP - SMALL_GROSS));
  check("fixture — the NEW cap is strictly tighter than Balance − Uninvoiced", REF_AVAIL < REF_TOPUP, true);
  check("fixture — REF_OVER is one halala past the NEW cap", REF_OVER, money(REF_AVAIL + 0.01));
  check("fixture — REF_BAL_AFTER = topup − refund", REF_BAL_AFTER, money(REF_TOPUP - REF_AVAIL));

  // ---- Census. Every table this file can touch plus ALL THREE counters: a
  //      document sequence that leaked past the rollback would put a permanent
  //      gap in a gap-free series, and no row count can see that.
  const censusSql = `
    select
      (select count(*) from public.customers)                  as customers,
      (select count(*) from public.projects)                   as projects,
      (select count(*) from public.trips)                      as trips,
      (select count(*) from public.invoices)                   as invoices,
      (select count(*) from public.invoice_payments)           as invoice_payments,
      (select count(*) from public.customer_ledger)            as ledger_rows,
      (select coalesce(sum(next_number), 0)
         from public.invoice_number_counter)                   as inv_counter_sum,
      (select coalesce(sum(next_number), 0)
         from public.topup_receipt_counter)                    as rct_counter_sum,
      (select coalesce(sum(next_number), 0)
         from public.credit_note_counter)                      as cn_counter_sum`;

  const pre = new Client(conn);
  await pre.connect();
  ok(
    `pg connected to a host naming ${TEST_REF}`,
    String((pre as unknown as { host: string }).host).includes(TEST_REF),
  );
  const censusBefore = (await pre.query(censusSql)).rows[0];
  await pre.end();
  console.log("\nCensus BEFORE: " + JSON.stringify(censusBefore));

  const c = new Client(conn);
  await c.connect();
  const seeded: Record<string, string> = {};

  // --- Call an RPC inside its own savepoint, as service_role by default. A
  //     raise aborts the transaction until something unwinds it, so a refusal
  //     without its own savepoint would poison every case after it.
  let rpcSeq = 0;
  async function rpc(sql: string, args: unknown[], role = "service_role"): Promise<Outcome> {
    const sp = `_rpc_${rpcSeq++}`;
    await c.query(`savepoint ${sp}`);
    try {
      await c.query(`set local role ${role}`);
      const r: QueryResult = await c.query(sql, args as never);
      await c.query(`release savepoint ${sp}`);
      await c.query("reset role");
      return { row: (r.rows[0] ?? null) as Row | null, err: null };
    } catch (e) {
      await c.query(`rollback to savepoint ${sp}`);
      await c.query("reset role");
      return { row: null, err: e as { message: string } };
    }
  }

  // --- Money read-backs.
  const balance = async (customerId: string): Promise<number> =>
    money((await c.query(`select balance_sar from public.v_customer_ledger_balance where customer_id = $1`, [customerId])).rows[0].balance_sar);
  const uninvoiced = async (customerId: string): Promise<number> =>
    money((await c.query(`select uninvoiced_sar from public.v_customer_uninvoiced where customer_id = $1`, [customerId])).rows[0].uninvoiced_sar);
  /** The whole 0204 Available row, reservation column included. */
  const availableRow = async (customerId: string): Promise<Row> =>
    (await c.query(
      `select balance_sar, uninvoiced_sar, available_sar, confirmed_unsettled_sar
         from public.v_customer_available where customer_id = $1`, [customerId])).rows[0];
  const available = async (customerId: string): Promise<number> =>
    money((await availableRow(customerId)).available_sar);
  const reserved = async (customerId: string): Promise<number> =>
    money((await availableRow(customerId)).confirmed_unsettled_sar);
  const invoiceRow = async (invoiceId: string): Promise<Row> =>
    (await c.query(`select status, invoice_number, grand_total_sar, prepaid_applied_sar, amount_payable_sar from public.invoices where id = $1`, [invoiceId])).rows[0];
  const settlement = async (invoiceId: string): Promise<Row> =>
    (await c.query(`select payable_sar, paid_sar, applied_sar, written_off_sar, remainder_sar from public.v_invoice_settlement where invoice_id = $1`, [invoiceId])).rows[0];
  /** Ledger rows for one invoice, by type — the audit trail money moved on. */
  const ledgerByType = async (invoiceId: string): Promise<Record<string, number>> => {
    const rows = (await c.query(
      `select entry_type, round(sum(amount_sar), 2) as s from public.customer_ledger
        where invoice_id = $1 group by entry_type`, [invoiceId])).rows;
    const m: Record<string, number> = {};
    for (const r of rows) m[String(r.entry_type)] = money(r.s);
    return m;
  };
  /** Every ledger row for a customer, invoice-linked or not. A draw written
   *  with a null invoice_id would slip past ledgerByType; this sees it. */
  const ledgerCount = async (customerId: string): Promise<number> =>
    Number((await c.query(`select count(*) as n from public.customer_ledger where customer_id = $1`, [customerId])).rows[0].n);
  const tripInvoiceId = async (tripId: string): Promise<string | null> =>
    (await c.query(`select invoice_id from public.trips where id = $1`, [tripId])).rows[0].invoice_id ?? null;

  /** The identity every confirmed invoice must satisfy under 0204: the whole
   *  document is payable and none of it has been settled by confirming. */
  async function freezeHolds(label: string, invoiceId: string, gross: number): Promise<void> {
    const inv = await invoiceRow(invoiceId);
    check(`${label}: status is 'confirmed' — nothing was auto-paid`, inv.status, "confirmed");
    check(`${label}: amount_payable_sar == the whole grand total`, money(inv.amount_payable_sar), gross);
    check(`${label}: prepaid_applied_sar == 0.00 — confirm applies nothing`, money(inv.prepaid_applied_sar), 0);
    check(`${label}: grand_total_sar is the figure that was frozen`, money(inv.grand_total_sar), gross);
    check(`${label}: NO ledger row exists for this invoice`, await ledgerByType(invoiceId), {});
    const s = await settlement(invoiceId);
    check(`${label}: settlement — payable == grand total`, money(s.payable_sar), gross);
    check(`${label}: settlement — nothing paid`, money(s.paid_sar), 0);
    check(`${label}: settlement — nothing applied`, money(s.applied_sar), 0);
    check(`${label}: settlement — the whole document is still owed`, money(s.remainder_sar), gross);
  }

  /** The view's own arithmetic, re-derived from the columns beside it. A
   *  literal-only assertion cannot tell a correct Available from one that is
   *  right by coincidence on this fixture. */
  async function availableFollowsTheRule(label: string, customerId: string): Promise<void> {
    const r = await availableRow(customerId);
    check(
      `${label}: Available == Balance − Uninvoiced − confirmed unsettled — re-derived`,
      money(r.available_sar),
      money(money(r.balance_sar) - money(r.uninvoiced_sar) - money(r.confirmed_unsettled_sar)),
    );
  }

  // --- A case body, run inside a savepoint and rolled back whatever happens —
  //     even on success, so every scenario starts from the same clean seed.
  let spSeq = 0;
  async function scenario(label: string, body: () => Promise<void>): Promise<void> {
    const sp = `_case_${spSeq++}`;
    console.log(`\n-- ${label}`);
    await c.query(`savepoint ${sp}`);
    try {
      await body();
    } catch (e) {
      fail(`${label}: threw instead of asserting`, String((e as Error).message).split("\n")[0]);
    } finally {
      await c.query(`rollback to savepoint ${sp}`);
      await c.query("reset role");
    }
  }

  // --- A refusal must raise AND raise for the stated reason. Matching the
  //     fragment is the proof the guard CAN fire, encoded in the run itself.
  async function refuses(
    label: string, sql: string, args: unknown[], fragment: string, role = "service_role",
  ): Promise<void> {
    const sp = `_ref_${spSeq++}`;
    await c.query(`savepoint ${sp}`);
    try {
      const r = await rpc(sql, args, role);
      ok(`${label}: REFUSED`, r.err !== null);
      if (r.err) {
        ok(`${label}: refused for the RIGHT reason (matched "${fragment}")`, r.err.message.includes(fragment));
        console.log(`          db said: ${r.err.message.split("\n")[0]}`);
      } else {
        console.log("          NOTHING RAISED — the refusal cannot fire, so a green run proves nothing.");
      }
    } finally {
      await c.query(`rollback to savepoint ${sp}`);
      await c.query("reset role");
    }
  }

  try {
    await c.query("begin");

    // ---- Precondition, provisioned not inherited (see harness.ts).
    const station = (await c.query(PROVISION_STATION_SQL, [SEED_STATION])).rows[0];
    check(`precondition — ${SEED_STATION} exists and prices ${SEED_WATER_TYPE}`,
      station?.key === SEED_STATION && station?.fill_cost_potable_sar !== null, true);

    // ---- SCHEMA precondition. If v_customer_available is still the 0203
    //      five-column view, every reservation assertion below would fail with
    //      an unhelpful "column does not exist" from deep inside a helper.
    //      Name it here instead, once, in words.
    const availCols = (await c.query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'v_customer_available'
        order by ordinal_position`)).rows.map((r) => String(r.column_name));
    check(
      "precondition — v_customer_available carries 0204's six columns in order",
      availCols,
      ["customer_id", "customer_name", "balance_sar", "uninvoiced_sar", "available_sar", "confirmed_unsettled_sar"],
    );

    // =====================================================================
    // SEED. Four customers, each with its own project, an invoice in 'review'
    // and a delivered trip RESERVED to that invoice. `initials` is a caller
    // argument, not a constant: projects_initials_unique is a GLOBAL
    // constraint, so four projects sharing initials die on the insert and
    // prove nothing.
    // =====================================================================

    async function seedCustomer(
      tag: string, mode: string, initials: string, net: number,
    ): Promise<{ customer: string; project: string; invoice: string; trip: string }> {
      const customer = (await c.query(
        `insert into public.customers (name, customer_type, payment_mode)
         values ($1, 'construction', $2) returning id`,
        [`SETTLECHK ${tag}`, mode])).rows[0].id as string;
      const project = (await c.query(
        `insert into public.projects
           (customer_id, name, initials, default_water_station, water_type, status, rate_per_trip_sar)
         values ($1, $2, $3, 'manfuhah_station', 'potable', 'active', $4) returning id`,
        [customer, `SETTLECHK ${tag} PROJECT`, initials, net])).rows[0].id as string;
      const invoice = (await c.query(
        `insert into public.invoices (customer_id, period_start, period_end, status)
         values ($1, $2, $3, 'review') returning id`,
        [customer, PERIOD_START, PERIOD_END])).rows[0].id as string;
      // invoice_id set at seed time because the app reserves at DRAFT. See header.
      const trip = (await c.query(
        `insert into public.trips
           (project_id, customer_id, water_station, water_type, rate_sar, stage, trip_date, delivered_at, invoice_id)
         values ($1, $2, 'manfuhah_station', 'potable', $3, 'delivered', $4, now(), $5) returning id`,
        [project, customer, net, TRIP_DATE, invoice])).rows[0].id as string;
      return { customer, project, invoice, trip };
    }

    const pp = await seedCustomer("PREPAID", "prepaid", "ZZSC1", TRIP_NET);
    seeded.customer = pp.customer; seeded.project = pp.project;
    seeded.invoice = pp.invoice; seeded.tripA = pp.trip;

    // Trip B — delivered, same period, on NO invoice. Permanently uninvoiced.
    seeded.tripB = (await c.query(
      `insert into public.trips
         (project_id, customer_id, water_station, water_type, rate_sar, stage, trip_date, delivered_at)
       values ($1, $2, 'manfuhah_station', 'potable', $3, 'delivered', $4, now()) returning id`,
      [pp.project, pp.customer, TRIP_NET, TRIP_DATE])).rows[0].id;

    const post = await seedCustomer("POSTPAID", "postpaid", "ZZSC2", TRIP_NET);
    seeded.customer2 = post.customer; seeded.project2 = post.project;
    seeded.invoice2 = post.invoice; seeded.tripC = post.trip;

    // The self-reservation pin and the refund cap each get their own customer
    // with a single trip and NOTHING uninvoiced, so the only term moving in
    // Available is the confirmed remainder under test.
    const pin = await seedCustomer("PIN", "prepaid", "ZZSC3", SMALL_NET);
    seeded.customer3 = pin.customer; seeded.project3 = pin.project;
    seeded.invoice3 = pin.invoice; seeded.tripD = pin.trip;

    const ref = await seedCustomer("REFUND", "prepaid", "ZZSC4", SMALL_NET);
    seeded.customer4 = ref.customer; seeded.project4 = ref.project;
    seeded.invoice4 = ref.invoice; seeded.tripE = ref.trip;

    console.log("\nSeeded: " + JSON.stringify(seeded));

    // ---- Baseline. The draft/review reservation must NOT hide delivered work:
    //      both trips count as Uninvoiced while the invoice is still 'review'.
    check("baseline — empty ledger reads 0.00", await balance(pp.customer), 0);
    check("baseline — Uninvoiced counts BOTH trips while the invoice is 'review'", await uninvoiced(pp.customer), UNINVOICED_BOTH);
    check("baseline — nothing is reserved yet: no invoice is confirmed", await reserved(pp.customer), 0);
    check("baseline — Available = 0 − Uninvoiced − 0", await available(pp.customer), money(-UNINVOICED_BOTH));

    // =====================================================================
    // §A — PROOF 1 (prepaid). Confirm freezes and moves NOTHING.
    //
    // The top-up comes FIRST and is deliberately larger than the invoice. That
    // is what gives this proof teeth: under 0203 this exact call drew 1419.79
    // and flipped the invoice to 'paid'. If that behaviour ever returns, the
    // balance assertion below goes red on the money and the status assertion
    // goes red on the flip. Run the same case against a customer with an empty
    // ledger and a resurrected draw would have nothing to take, and the whole
    // scenario would pass while proving nothing.
    // =====================================================================
    await scenario("PROOF 1 (prepaid) — confirm freezes the payable and moves no money", async () => {
      const t = await rpc(TOPUP_SQL, [pp.customer, TOPUP_RICH, "cash", null, null, ACTOR, null]);
      ok("top-up accepted", t.err === null);
      check("the customer really has more than the invoice on the books", await balance(pp.customer), TOPUP_RICH);
      const ledgerBefore = await ledgerCount(pp.customer);

      const r = await rpc(CONFIRM_SQL, confirmArgs(pp.invoice, seeded.tripA, "prepaid", TRIP_NET, TRIP_VAT, TRIP_GROSS));
      ok("confirm accepted", r.err === null);
      if (r.err) { console.log(`          db said: ${r.err.message.split("\n")[0]}`); return; }

      ok("invoice number allocated", /^\d{3}-\d{6}$/.test(String((await invoiceRow(pp.invoice)).invoice_number)));
      await freezeHolds("prepaid confirm", pp.invoice, TRIP_GROSS);

      check("THE RULING — Balance is untouched by the confirm", await balance(pp.customer), TOPUP_RICH);
      check("no ledger row of ANY kind was written for this customer", await ledgerCount(pp.customer), ledgerBefore);
      check("Uninvoiced dropped THIS invoice's trip and kept trip B", await uninvoiced(pp.customer), UNINVOICED_AFTER);
      check("the trip stays reserved to the invoice — it is not released", await tripInvoiceId(seeded.tripA), pp.invoice);
    });

    // =====================================================================
    // §B — PROOF 1 (postpaid) and the CASH arm of PROOF 3. The freeze is
    // identical for a customer with no pool at all; then a partial payment
    // leaves it 'confirmed' and the payment that clears the remainder flips it.
    // =====================================================================
    await scenario("PROOF 1 (postpaid) + PROOF 3 (cash) — same freeze, then paid only at zero", async () => {
      const r = await rpc(CONFIRM_SQL, confirmArgs(post.invoice, post.trip, "postpaid", TRIP_NET, TRIP_VAT, TRIP_GROSS));
      ok("confirm accepted", r.err === null);
      if (r.err) { console.log(`          db said: ${r.err.message.split("\n")[0]}`); return; }

      await freezeHolds("postpaid confirm", post.invoice, TRIP_GROSS);
      check("the postpaid customer's Balance is still 0.00", await balance(post.customer), 0);
      check("no ledger row exists for this customer at all", await ledgerCount(post.customer), 0);

      // A postpaid customer has no pool, so apply-balance must refuse on MODE —
      // not on status, and not on "nothing to apply".
      await refuses("apply_balance for a POSTPAID customer", APPLY_SQL, [post.invoice, ACTOR], "only be applied for a prepaid customer");

      const p = await rpc(PAY_SQL, [post.invoice, PAY_CASH, "cash", null, null, PAID_ON, ACTOR, null]);
      ok("partial cash payment accepted", p.err === null);
      if (p.err) { console.log(`          db said: ${p.err.message.split("\n")[0]}`); return; }
      check("a PARTIAL payment does not flip the status", (await invoiceRow(post.invoice)).status, "confirmed");
      let s = await settlement(post.invoice);
      check("settlement — paid", money(s.paid_sar), PAY_CASH);
      check("settlement — remainder after the cash", money(s.remainder_sar), REMAINDER_AFTER_CASH);
      check("a cash payment writes NO ledger row (it is not pool money)", await ledgerCount(post.customer), 0);

      await refuses(
        "payment of remainder + 0.01", PAY_SQL,
        [post.invoice, OVERPAY, "cash", null, null, PAID_ON, ACTOR, null],
        "exceeds the invoice remainder",
      );
      check("the refused overpay left the remainder unmoved", money((await settlement(post.invoice)).remainder_sar), REMAINDER_AFTER_CASH);

      const p2 = await rpc(PAY_SQL, [post.invoice, REMAINDER_AFTER_CASH, "cash", null, null, PAID_ON, ACTOR, null]);
      ok("the payment that clears the remainder is accepted", p2.err === null);
      if (p2.err) { console.log(`          db said: ${p2.err.message.split("\n")[0]}`); return; }
      check("PROOF 3 (cash) — status flips to 'paid' at exactly zero", (await invoiceRow(post.invoice)).status, "paid");
      s = await settlement(post.invoice);
      check("settlement — remainder is 0.00", money(s.remainder_sar), 0);
      check("settlement — the frozen payable is settled entirely in cash", money(s.payable_sar), money(s.paid_sar));
      check("the trip is stamped to the now-paid invoice", await tripInvoiceId(post.trip), post.invoice);
    });

    // =====================================================================
    // §C — PROOF 4. Available RESERVES confirmed debt.
    //
    // Three measurements, each of which a dropped term would break:
    //   before   nothing confirmed, so the reservation is 0
    //   after    the invoice's value leaves Uninvoiced and arrives in
    //            confirmed_unsettled_sar in the same instant — Available does
    //            not jump, and it now sits a whole remainder BELOW
    //            Balance − Uninvoiced. Drop the new term from the view and
    //            Available reads 3580.21 instead of 2160.42.
    //   settled  paying the invoice releases the reservation; Available lands
    //            back where it was, because the money only moved from
    //            RESERVED to SPENT.
    // =====================================================================
    await scenario("PROOF 4 — Available reserves a confirmed, unsettled invoice", async () => {
      const t = await rpc(TOPUP_SQL, [pp.customer, TOPUP_RICH, "cash", null, null, ACTOR, null]);
      ok("top-up accepted", t.err === null);
      check("before confirm — nothing is reserved", await reserved(pp.customer), 0);
      check("before confirm — Available", await available(pp.customer), AVAIL_RICH_BEFORE);
      await availableFollowsTheRule("before confirm", pp.customer);

      const r = await rpc(CONFIRM_SQL, confirmArgs(pp.invoice, seeded.tripA, "prepaid", TRIP_NET, TRIP_VAT, TRIP_GROSS));
      ok("confirm accepted", r.err === null);
      if (r.err) { console.log(`          db said: ${r.err.message.split("\n")[0]}`); return; }

      check("THE RESERVATION — confirmed_unsettled_sar == the whole grand total", await reserved(pp.customer), TRIP_GROSS);
      check("Available is a whole remainder BELOW Balance − Uninvoiced",
        money(money(TOPUP_RICH - UNINVOICED_AFTER) - (await available(pp.customer))), TRIP_GROSS);
      check("CONTINUITY — confirming does not move Available at all", await available(pp.customer), AVAIL_RICH_AFTER);
      check("...and that figure is where it was before the confirm", AVAIL_RICH_AFTER, AVAIL_RICH_BEFORE);
      await availableFollowsTheRule("after confirm", pp.customer);

      // Settle the whole thing out of the balance. Available is comfortably
      // positive here, so this arm does NOT depend on the self-reservation
      // line — §E owns that case.
      const a = await rpc(APPLY_SQL, [pp.invoice, ACTOR]);
      ok("apply_balance accepted", a.err === null);
      if (a.err) { console.log(`          db said: ${a.err.message.split("\n")[0]}`); return; }
      check("the draw is capped by the REMAINDER, not by Available", money((await settlement(pp.invoice)).applied_sar), TRIP_GROSS);
      check("status flipped to 'paid'", (await invoiceRow(pp.invoice)).status, "paid");
      check("Balance after the apply", await balance(pp.customer), BAL_AFTER_FULL_APPLY);
      check("a PAID invoice reserves nothing — it has no remainder", await reserved(pp.customer), 0);
      check("Available is back where it started: reserved money only became spent money",
        await available(pp.customer), AVAIL_RICH_BEFORE);
      await availableFollowsTheRule("after settlement", pp.customer);

      // Not one of the seven, but 0204 left void_invoice alone and the previous
      // version of this file covered it. A void reverses the applied row and
      // gives the balance back.
      const v = await rpc(VOID_SQL, [pp.invoice, "harness void", ACTOR]);
      ok("void of a PAID invoice accepted", v.err === null);
      if (v.err) { console.log(`          db said: ${v.err.message.split("\n")[0]}`); return; }
      check("void — status", (await invoiceRow(pp.invoice)).status, "void");
      check("void — a paired draw_reversal was written for the applied row", (await ledgerByType(pp.invoice)).draw_reversal, TRIP_GROSS);
      check("void — Balance restored to the halala", await balance(pp.customer), TOPUP_RICH);
      check("void — trip released back to no invoice", await tripInvoiceId(seeded.tripA), null);
      check("void — a void invoice reserves nothing", await reserved(pp.customer), 0);
      check("void — Available back to the pre-confirm figure", await available(pp.customer), AVAIL_RICH_BEFORE);
    });

    // =====================================================================
    // §D — PROOFS 2 and 3 (balance arm). A partial apply, then the rest.
    //
    // A partial apply requires min(Available + remainder, remainder) <
    // remainder, i.e. Available < 0. There is no fixture in which a partial
    // application happens at a positive Available, so this scenario leans on
    // the self-reservation line too — §E is where that is stated as the proof.
    // =====================================================================
    await scenario("PROOFS 2 and 3 — a partial apply leaves it unpaid; the rest flips it to paid", async () => {
      const t = await rpc(TOPUP_SQL, [pp.customer, TOPUP_THIN, "cash", null, null, ACTOR, null]);
      ok("top-up accepted", t.err === null);

      const r = await rpc(CONFIRM_SQL, confirmArgs(pp.invoice, seeded.tripA, "prepaid", TRIP_NET, TRIP_VAT, TRIP_GROSS));
      ok("confirm accepted", r.err === null);
      if (r.err) { console.log(`          db said: ${r.err.message.split("\n")[0]}`); return; }
      check("the confirm still moved nothing on the thin balance", await balance(pp.customer), TOPUP_THIN);
      check("Available at confirm is NEGATIVE — the debt outruns the balance", await available(pp.customer), AVAIL_THIN_AT_CONFIRM);

      // ---- PROOF 2. The apply draws what there is and stops.
      const a = await rpc(APPLY_SQL, [pp.invoice, ACTOR]);
      ok("apply_balance accepted", a.err === null);
      if (a.err) { console.log(`          db said: ${a.err.message.split("\n")[0]}`); return; }
      let inv = await invoiceRow(pp.invoice);
      let s = await settlement(pp.invoice);
      check("PROOF 2 — applied_sar == the partial draw", money(s.applied_sar), DRAW_PARTIAL);
      check("PROOF 2 — the remainder is REDUCED, not cleared", money(s.remainder_sar), REMAINDER_AFTER_PARTIAL);
      check("PROOF 2 — the invoice is still unpaid", inv.status, "confirmed");
      check("PROOF 2 — the FROZEN payable is not rewritten by a settlement", money(inv.amount_payable_sar), TRIP_GROSS);
      check("PROOF 2 — prepaid_applied_sar stays 0: it is the CONFIRM figure, not the settlement", money(inv.prepaid_applied_sar), 0);
      check("PROOF 2 — one balance_applied row, stored NEGATIVE", (await ledgerByType(pp.invoice)).balance_applied, money(-DRAW_PARTIAL));
      check("PROOF 2 — Balance after the partial draw", await balance(pp.customer), BAL_AFTER_PARTIAL);
      check("PROOF 2 — the reservation shrank to the NEW remainder", await reserved(pp.customer), REMAINDER_AFTER_PARTIAL);
      check("PROOF 2 — the trip is NOT stamped while money is owed", await tripInvoiceId(seeded.tripA), pp.invoice);

      // Balance is spent to the halala, so a second apply has nothing left:
      // Available + remainder is exactly 0. That is a DIFFERENT refusal from
      // "wrong status" or "wrong mode", and matching its words keeps them apart.
      await refuses("apply_balance with the balance spent out", APPLY_SQL, [pp.invoice, ACTOR], "Nothing to apply");
      check("the refused apply left the remainder unmoved", money((await settlement(pp.invoice)).remainder_sar), REMAINDER_AFTER_PARTIAL);

      // ---- PROOF 3. Top up, apply the rest, land on exactly zero.
      const t2 = await rpc(TOPUP_SQL, [pp.customer, TOPUP_TOP, "cash", null, null, ACTOR, null]);
      ok("second top-up accepted", t2.err === null);
      check("Available before the second apply", await available(pp.customer), AVAIL_BEFORE_REST);

      const a2 = await rpc(APPLY_SQL, [pp.invoice, ACTOR]);
      ok("second apply accepted", a2.err === null);
      if (a2.err) { console.log(`          db said: ${a2.err.message.split("\n")[0]}`); return; }
      inv = await invoiceRow(pp.invoice);
      s = await settlement(pp.invoice);
      check("PROOF 3 — applied_sar is the sum of both draws", money(s.applied_sar), money(DRAW_PARTIAL + DRAW_REST));
      check("PROOF 3 — the second draw is capped by the REMAINDER, not by Available",
        money(money(s.applied_sar) - DRAW_PARTIAL), DRAW_REST);
      check("PROOF 3 — the remainder reached exactly 0.00", money(s.remainder_sar), 0);
      check("PROOF 3 — and ONLY then does the status flip to 'paid'", inv.status, "paid");
      check("PROOF 3 — the frozen payable survived both settlements", money(inv.amount_payable_sar), TRIP_GROSS);
      check("PROOF 3 — payable == paid + applied", money(s.payable_sar), money(money(s.paid_sar) + money(s.applied_sar)));
      check("PROOF 3 — Balance after", await balance(pp.customer), BAL_AFTER_REST);
      check("PROOF 3 — the reservation is released", await reserved(pp.customer), 0);
      check("PROOF 3 — the trip is stamped to the now-paid invoice", await tripInvoiceId(seeded.tripA), pp.invoice);
    });

    // =====================================================================
    // §E — PROOF 5. The self-reservation, in the migration's own shape.
    //
    // Balance 300.00 against a remainder of 400.00, nothing uninvoiced. The
    // view reserves this invoice, so Available reads −100.00. apply_balance
    // adds the invoice's OWN remainder back before capping:
    //
    //     v_available := -100.00 + 400.00 = 300.00
    //     v_draw      := least(300.00, 400.00) = 300.00
    //
    // DELETE THAT ONE LINE and v_available stays −100.00, least(−100, 400) is
    // −100, the `v_draw <= 0` guard fires, and the RPC raises "Nothing to
    // apply". Three assertions below go red on that: "apply accepted", the
    // draw figure, and the balance landing on zero. The negative-Available
    // precondition is asserted FIRST so the case cannot quietly become
    // vacuous if the fixture ever drifts into positive territory.
    // =====================================================================
    await scenario("PROOF 5 — apply_balance works when the remainder EXCEEDS the balance", async () => {
      const t = await rpc(TOPUP_SQL, [pin.customer, PIN_TOPUP, "cash", null, null, ACTOR, null]);
      ok("top-up accepted", t.err === null);

      const r = await rpc(CONFIRM_SQL, confirmArgs(pin.invoice, pin.trip, "prepaid", SMALL_NET, SMALL_VAT, SMALL_GROSS));
      ok("confirm accepted", r.err === null);
      if (r.err) { console.log(`          db said: ${r.err.message.split("\n")[0]}`); return; }

      check("setup — this customer has nothing uninvoiced, so only the reservation moves", await uninvoiced(pin.customer), 0);
      check("setup — the remainder is 400.00", money((await settlement(pin.invoice)).remainder_sar), SMALL_GROSS);
      check("setup — the balance is 300.00, BELOW the remainder", await balance(pin.customer), PIN_TOPUP);
      const availBefore = await available(pin.customer);
      check("PRECONDITION — Available reads NEGATIVE, because the invoice is reserved against itself", availBefore < 0, true);
      check("PRECONDITION — and it reads exactly −100.00", availBefore, PIN_AVAIL);

      const a = await rpc(APPLY_SQL, [pin.invoice, ACTOR]);
      ok("PROOF 5 — apply_balance is ACCEPTED at a negative Available", a.err === null);
      if (a.err) {
        console.log(`          db said: ${a.err.message.split("\n")[0]}`);
        console.log("          THIS IS THE SELF-RESERVATION LINE. apply_balance_to_invoice must add the");
        console.log("          invoice's own remainder back to Available before capping the draw.");
        return;
      }
      const s = await settlement(pin.invoice);
      check("PROOF 5 — the draw is the whole balance, 300.00", money(s.applied_sar), PIN_DRAW);
      check("PROOF 5 — the balance is spent to exactly 0.00", await balance(pin.customer), 0);
      check("PROOF 5 — the draw did NOT overrun into a negative balance", (await balance(pin.customer)) >= 0, true);
      check("PROOF 5 — the remainder is reduced to 100.00", money(s.remainder_sar), PIN_REMAINDER);
      check("PROOF 5 — the invoice is still unpaid", (await invoiceRow(pin.invoice)).status, "confirmed");
      check("PROOF 5 — the reservation shrank to what is still owed", await reserved(pin.customer), PIN_REMAINDER);

      // The cap still binds at the bottom: balance 0, remainder 100, so
      // Available + remainder is 0 and there is genuinely nothing to apply.
      // Without this the self-reservation line could be "fixed" by ignoring
      // Available altogether, which would draw a balance the customer has not got.
      await refuses("a second apply with the balance spent out", APPLY_SQL, [pin.invoice, ACTOR], "Nothing to apply");
      check("the refused apply left the balance at 0.00", await balance(pin.customer), 0);
    });

    // =====================================================================
    // §F — PROOF 6. A refund is capped by the NEW Available.
    //
    // Balance 1000.00, nothing uninvoiced, one confirmed invoice owing 400.00.
    // Under 0203's view the cap would have been 1000.00 and 600.01 would have
    // sailed through, handing back money already invoiced. Under 0204 the cap
    // is 600.00 and the refusal quotes the new definition by name.
    // =====================================================================
    await scenario("PROOF 6 — a refund is capped by Available, which now reserves confirmed debt", async () => {
      const t = await rpc(TOPUP_SQL, [ref.customer, REF_TOPUP, "cash", null, null, ACTOR, null]);
      ok("top-up accepted", t.err === null);

      const r = await rpc(CONFIRM_SQL, confirmArgs(ref.invoice, ref.trip, "prepaid", SMALL_NET, SMALL_VAT, SMALL_GROSS));
      ok("confirm accepted", r.err === null);
      if (r.err) { console.log(`          db said: ${r.err.message.split("\n")[0]}`); return; }

      check("setup — nothing uninvoiced, so the cap moves on the reservation alone", await uninvoiced(ref.customer), 0);
      check("setup — the confirmed invoice reserves 400.00", await reserved(ref.customer), SMALL_GROSS);
      check("the cap is 600.00, not the 1000.00 on the books", await available(ref.customer), REF_AVAIL);
      check("the cap is TIGHTER than Balance − Uninvoiced by exactly the confirmed remainder",
        money(REF_TOPUP - (await available(ref.customer))), SMALL_GROSS);

      await refuses(
        "refund of the cap + 0.01", REFUND_SQL,
        [ref.customer, REF_OVER, "cash", null, null, ACTOR, null],
        "exceeds the customer's Available balance",
      );
      check("the refused refund left the Balance unmoved", await balance(ref.customer), REF_TOPUP);

      // The cap is `>`, not `>=` — refunding exactly Available is allowed.
      const rf = await rpc(REFUND_SQL, [ref.customer, REF_AVAIL, "cash", null, null, ACTOR, null]);
      ok("refund of EXACTLY the cap accepted", rf.err === null);
      if (rf.err) { console.log(`          db said: ${rf.err.message.split("\n")[0]}`); return; }
      check("the refund row is a 'refund'", rf.row?.entry_type, "refund");
      check("the refund is stored NEGATIVE", money(rf.row?.amount_sar), money(-REF_AVAIL));
      ok("a credit note number was allocated", /^CN-\d{4}-\d{6}$/.test(String(rf.row?.doc_number)));
      check("Balance after the refund", await balance(ref.customer), REF_BAL_AFTER);
      check("Available is spent to exactly 0.00", await available(ref.customer), 0);
      check("the money still owed on the confirmed invoice is untouched by the refund",
        await reserved(ref.customer), SMALL_GROSS);
      check("what remains on the books is exactly the reserved debt", await balance(ref.customer), SMALL_GROSS);

      await refuses(
        "a further refund of one halala", REFUND_SQL,
        [ref.customer, 0.01, "cash", null, null, ACTOR, null],
        "exceeds the customer's Available balance",
      );
    });

    // =====================================================================
    // §G — PROOF 7. The bank-transfer proof rules, on all three money RPCs.
    // Each case is otherwise valid, so a refusal cannot be credited to some
    // other gate. Cash is checked too: the asymmetry is deliberate, and an
    // assertion is the only thing that keeps it.
    // =====================================================================
    await scenario("PROOF 7 — a bank transfer needs its proof; cash needs none", async () => {
      await rpc(TOPUP_SQL, [pp.customer, TOPUP_THIN, "cash", null, null, ACTOR, null]);
      const r = await rpc(CONFIRM_SQL, confirmArgs(pp.invoice, seeded.tripA, "prepaid", TRIP_NET, TRIP_VAT, TRIP_GROSS));
      if (r.err) { fail("PROOF 7: seed confirm failed", r.err.message.split("\n")[0]); return; }
      const inv = pp.invoice;

      // --- record_topup
      await refuses("top-up by transfer with no photo", TOPUP_SQL,
        [pp.customer, 100, "bank_transfer", "REF-1", null, ACTOR, null], "requires a photo of the transfer.");
      await refuses("top-up by transfer with no reference", TOPUP_SQL,
        [pp.customer, 100, "bank_transfer", null, "proofs/x.pdf", ACTOR, null], "requires a transfer reference.");
      await refuses("top-up by transfer with neither", TOPUP_SQL,
        [pp.customer, 100, "bank_transfer", null, null, ACTOR, null], "both are missing");
      // 0204 TRIMS these inputs. Under 0203 they were tested with `is null`, so
      // a single space satisfied the rule and the proof was optional in practice.
      await refuses("top-up by transfer with a WHITESPACE reference", TOPUP_SQL,
        [pp.customer, 100, "bank_transfer", "   ", "proofs/x.pdf", ACTOR, null], "requires a transfer reference.");

      // --- record_refund (7 arguments since 0204; p_photo_path is the fifth)
      await refuses("refund by transfer with no photo", REFUND_SQL,
        [pp.customer, 1, "bank_transfer", "REF-1", null, ACTOR, null], "requires a photo of the transfer.");
      await refuses("refund by transfer with no reference", REFUND_SQL,
        [pp.customer, 1, "bank_transfer", null, "proofs/x.pdf", ACTOR, null], "requires a transfer reference.");
      await refuses("refund by transfer with neither", REFUND_SQL,
        [pp.customer, 1, "bank_transfer", null, null, ACTOR, null], "both are missing");
      await refuses("refund by transfer with a WHITESPACE photo path", REFUND_SQL,
        [pp.customer, 1, "bank_transfer", "REF-1", "   ", ACTOR, null], "requires a photo of the transfer.");

      // --- record_invoice_payment. The DATE is required too: it is what
      //     reconciles the row against the bank statement.
      await refuses("payment by transfer with no proof", PAY_SQL,
        [inv, 100, "bank_transfer", "REF-1", null, PAID_ON, ACTOR, null], "requires a proof-of-payment file");
      await refuses("payment by transfer with no reference", PAY_SQL,
        [inv, 100, "bank_transfer", null, "proofs/x.pdf", PAID_ON, ACTOR, null], "requires a payment reference");
      await refuses("payment by transfer with no date", PAY_SQL,
        [inv, 100, "bank_transfer", "REF-1", "proofs/x.pdf", null, ACTOR, null], "requires a payment date");
      await refuses("payment by transfer with a WHITESPACE proof path", PAY_SQL,
        [inv, 100, "bank_transfer", "REF-1", "   ", PAID_ON, ACTOR, null], "requires a proof-of-payment file");

      // --- cash needs none of the three, on any of the three RPCs.
      const cashTop = await rpc(TOPUP_SQL, [pp.customer, 100, "cash", null, null, ACTOR, null]);
      ok("cash top-up with no reference and no photo is ACCEPTED", cashTop.err === null);
      if (cashTop.err) console.log(`          db said: ${cashTop.err.message.split("\n")[0]}`);
      const cashPay = await rpc(PAY_SQL, [inv, 100, "cash", null, null, null, ACTOR, null]);
      ok("cash payment with no proof, no reference and no date is ACCEPTED", cashPay.err === null);
      if (cashPay.err) console.log(`          db said: ${cashPay.err.message.split("\n")[0]}`);
      // The refund customer is the one with room under the cap for a cash refund.
      await rpc(TOPUP_SQL, [ref.customer, REF_TOPUP, "cash", null, null, ACTOR, null]);
      const cashRef = await rpc(REFUND_SQL, [ref.customer, 1, "cash", null, null, ACTOR, null]);
      ok("cash refund with no reference and no photo is ACCEPTED", cashRef.err === null);
      if (cashRef.err) console.log(`          db said: ${cashRef.err.message.split("\n")[0]}`);

      // --- the neighbouring gates, so a proof-rule failure cannot be confused
      //     with one of these.
      await refuses("method 'balance' on a payment (it is applied, not paid)", PAY_SQL,
        [inv, 100, "balance", null, null, PAID_ON, ACTOR, null], "Invalid payment method");
      await refuses("payment of zero", PAY_SQL,
        [inv, 0, "cash", null, null, PAID_ON, ACTOR, null], "greater than zero");
      await refuses("payment without an actor", PAY_SQL,
        [inv, 100, "cash", null, null, PAID_ON, "  ", null], "Actor identity");
      await refuses("apply_balance without an actor", APPLY_SQL, [inv, "  "], "Actor identity");
      await refuses("refund without an actor", REFUND_SQL,
        [pp.customer, 1, "cash", null, null, "  ", null], "Actor identity");
    });

    // =====================================================================
    // §H — THE LEGACY GATE. 0203 did not backfill and 0204 did not either, so
    // every pre-ledger confirmed invoice has a NULL amount_payable_sar forever.
    // Both settle RPCs must refuse those by name — the app routes them to the
    // legacy flow, and it can only do that if the database says so out loud.
    // The same null is what keeps them OUT of the new reservation term, whose
    // money is already inside the seeded opening balance.
    // =====================================================================
    await scenario("§H — legacy invoices (amount_payable_sar null) refuse both settle RPCs", async () => {
      const legacy = (await c.query(
        `insert into public.invoices (customer_id, period_start, period_end, status, grand_total_sar)
         values ($1, $2, $3, 'confirmed', $4) returning id`,
        [pp.customer, PERIOD_START, PERIOD_END, TRIP_GROSS])).rows[0].id as string;
      check("the legacy row really has a NULL payable", (await invoiceRow(legacy)).amount_payable_sar, null);
      check("v_invoice_settlement reports a NULL remainder for it", (await settlement(legacy)).remainder_sar, null);
      check("a legacy invoice reserves NOTHING — its money is in the opening balance",
        await reserved(pp.customer), 0);
      await refuses("record_invoice_payment on a legacy invoice", PAY_SQL,
        [legacy, PAY_CASH, "cash", null, null, PAID_ON, ACTOR, null], "no frozen amount payable");
      await refuses("apply_balance_to_invoice on a legacy invoice", APPLY_SQL,
        [legacy, ACTOR], "no frozen amount payable");
    });

    // =====================================================================
    // §J — MARK PAID, THE COMPOSED FLOW (Fix Group 2).
    //
    // The screen no longer offers apply-balance and record-payment as two
    // choices; Mark Paid walks the SAME two RPCs in the order money moves —
    // draw what the balance covers, then collect whatever is left. Every
    // individual step is already proved above. What is NOT proved above is
    // the COMPOSITION, and it is where the flow can go wrong in ways no
    // single-RPC test can see:
    //
    //   1. balance covers    → one apply, nothing to collect, status paid
    //   2. shortfall         → apply draws part, then CASH clears the rest
    //   3. no usable balance → apply refuses, cash alone settles it
    //
    // MIXING THE TWO DOORS IS THE POINT OF CASE 2. §D applies twice and §B
    // pays cash twice; neither shows that a balance draw and a cash receipt
    // land on one invoice and foot to the frozen payable together. They are
    // disjoint writers — customer_ledger and invoice_payments — so nothing
    // but a test that uses both proves v_invoice_settlement adds them up.
    //
    // THE DIALOG'S FIGURE IS ASSERTED AGAINST THE RPC'S, not against a
    // constant. `previewDraw` below is the expression the screen shows
    // (lib: markPaidDraw in InvoiceDetailModal), computed from the SAME live
    // Available and remainder the operator would be looking at, and each case
    // requires the applied amount to equal it exactly. That is the audit
    // defect stated as an assertion: a preview that drops the add-back
    // understates the draw, and here it would simply be a wrong number.
    // =====================================================================

    /** What Mark Paid's confirmation states it will draw, from the two live
     *  figures the screen reads. Mirrors apply_balance_to_invoice()'s own
     *  arithmetic INCLUDING the self-reservation add-back. */
    function previewDraw(avail: number, remainder: number): number {
      return Math.max(0, money(Math.min(money(avail + remainder), remainder)));
    }

    await scenario("§J1 — Mark Paid: the balance covers it, paid in one step", async () => {
      const t = await rpc(TOPUP_SQL, [ref.customer, REF_TOPUP, "cash", null, null, ACTOR, null]);
      ok("top-up accepted", t.err === null);
      const r = await rpc(CONFIRM_SQL, confirmArgs(ref.invoice, ref.trip, "prepaid", SMALL_NET, SMALL_VAT, SMALL_GROSS));
      ok("confirm accepted", r.err === null);
      if (r.err) { console.log(`          db said: ${r.err.message.split("\n")[0]}`); return; }

      const availBefore = await available(ref.customer);
      const remBefore = money((await settlement(ref.invoice)).remainder_sar);
      check("the confirmed remainder is the whole payable", remBefore, SMALL_GROSS);
      check("Available reserves it, so it sits a whole remainder below the balance",
        availBefore, money(REF_TOPUP - SMALL_GROSS));
      const shown = previewDraw(availBefore, remBefore);
      check("the dialog would state the WHOLE remainder as leaving the balance", shown, SMALL_GROSS);

      const a = await rpc(APPLY_SQL, [ref.invoice, ACTOR]);
      ok("the single apply is accepted", a.err === null);
      if (a.err) { console.log(`          db said: ${a.err.message.split("\n")[0]}`); return; }
      const s = await settlement(ref.invoice);
      check("§J1 — the RPC drew EXACTLY what the dialog stated", money(s.applied_sar), shown);
      check("§J1 — the remainder reached zero, so no payment form is needed", money(s.remainder_sar), 0);
      check("§J1 — status is paid after ONE step", (await invoiceRow(ref.invoice)).status, "paid");
      check("§J1 — no cash was recorded: the balance did all of it", money(s.paid_sar), 0);
      check("§J1 — Balance after", await balance(ref.customer), money(REF_TOPUP - SMALL_GROSS));
      check("§J1 — the trip is stamped to the paid invoice", await tripInvoiceId(ref.trip), ref.invoice);
    });

    await scenario("§J2 — Mark Paid: shortfall, applied then cash, both doors on one invoice", async () => {
      const t = await rpc(TOPUP_SQL, [pin.customer, PIN_TOPUP, "cash", null, null, ACTOR, null]);
      ok("top-up accepted", t.err === null);
      const r = await rpc(CONFIRM_SQL, confirmArgs(pin.invoice, pin.trip, "prepaid", SMALL_NET, SMALL_VAT, SMALL_GROSS));
      ok("confirm accepted", r.err === null);
      if (r.err) { console.log(`          db said: ${r.err.message.split("\n")[0]}`); return; }

      const availBefore = await available(pin.customer);
      const remBefore = money((await settlement(pin.invoice)).remainder_sar);
      check("Available is NEGATIVE — the invoice reserves against a thinner balance", availBefore, PIN_AVAIL);
      const shown = previewDraw(availBefore, remBefore);
      // THE DEFECT, AS A NUMBER. Dropping the add-back gives
      // min(-100.00, 400.00) = -100.00, i.e. the dialog would offer nothing
      // (or a negative) on a case where the RPC draws the customer's whole
      // 300.00. The two expressions are stated side by side so the gap is the
      // assertion rather than a comment about one.
      check("the dialog states the whole thin balance, not the negative Available", shown, PIN_DRAW);
      check("the un-added-back preview would have UNDERSTATED it",
        money(Math.min(availBefore, remBefore)) < shown, true);

      const a = await rpc(APPLY_SQL, [pin.invoice, ACTOR]);
      ok("apply accepted", a.err === null);
      if (a.err) { console.log(`          db said: ${a.err.message.split("\n")[0]}`); return; }
      let s = await settlement(pin.invoice);
      check("§J2 — the RPC drew EXACTLY what the dialog stated", money(s.applied_sar), shown);
      check("§J2 — a shortfall remains, so the flow must go on to cash", money(s.remainder_sar), PIN_REMAINDER);
      check("§J2 — the invoice is NOT paid yet", (await invoiceRow(pin.invoice)).status, "confirmed");
      check("§J2 — the balance is spent to the halala", await balance(pin.customer), 0);

      // Step 3 — the payment form opens pre-filled with exactly this figure.
      const p = await rpc(PAY_SQL, [pin.invoice, PIN_REMAINDER, "cash", null, null, PAID_ON, ACTOR, null]);
      ok("the shortfall payment is accepted", p.err === null);
      if (p.err) { console.log(`          db said: ${p.err.message.split("\n")[0]}`); return; }
      s = await settlement(pin.invoice);
      check("§J2 — remainder reached exactly zero", money(s.remainder_sar), 0);
      check("§J2 — and ONLY then does the status flip", (await invoiceRow(pin.invoice)).status, "paid");
      // THE COMPOSITION, FOOTED. Two disjoint writers, one frozen payable.
      check("§J2 — payable == applied + paid, across BOTH doors",
        money(s.payable_sar), money(money(s.applied_sar) + money(s.paid_sar)));
      check("§J2 — the balance door contributed the draw", money(s.applied_sar), PIN_DRAW);
      check("§J2 — the cash door contributed the shortfall", money(s.paid_sar), PIN_REMAINDER);
      check("§J2 — the cash leg wrote NO ledger row", (await ledgerByType(pin.invoice)).balance_applied, money(-PIN_DRAW));
      check("§J2 — the trip is stamped once the last riyal lands", await tripInvoiceId(pin.trip), pin.invoice);
    });

    await scenario("§J3 — Mark Paid: no usable balance, cash alone settles it", async () => {
      // NO TOP-UP. Balance 0.00, so Available is the reservation itself and
      // the add-back lands exactly on zero — the boundary the screen uses to
      // skip the draw entirely rather than let the RPC refuse it.
      const r = await rpc(CONFIRM_SQL, confirmArgs(pin.invoice, pin.trip, "prepaid", SMALL_NET, SMALL_VAT, SMALL_GROSS));
      ok("confirm accepted", r.err === null);
      if (r.err) { console.log(`          db said: ${r.err.message.split("\n")[0]}`); return; }

      const availBefore = await available(pin.customer);
      const remBefore = money((await settlement(pin.invoice)).remainder_sar);
      check("Balance is empty", await balance(pin.customer), 0);
      check("Available is the reservation, negated", availBefore, money(-SMALL_GROSS));
      const shown = previewDraw(availBefore, remBefore);
      check("the dialog would state ZERO leaving the balance", shown, 0);

      // The screen does not attempt this draw. The RPC's refusal is asserted
      // anyway: the skip is a courtesy, and the database is what makes it safe.
      await refuses("apply_balance with nothing available", APPLY_SQL, [pin.invoice, ACTOR], "Nothing to apply");
      check("the refused apply moved no money", await balance(pin.customer), 0);
      check("…and left the remainder whole", money((await settlement(pin.invoice)).remainder_sar), SMALL_GROSS);

      const p = await rpc(PAY_SQL, [pin.invoice, SMALL_GROSS, "cash", null, null, PAID_ON, ACTOR, null]);
      ok("the full cash payment is accepted", p.err === null);
      if (p.err) { console.log(`          db said: ${p.err.message.split("\n")[0]}`); return; }
      const s = await settlement(pin.invoice);
      check("§J3 — the remainder reached zero on cash alone", money(s.remainder_sar), 0);
      check("§J3 — status is paid", (await invoiceRow(pin.invoice)).status, "paid");
      check("§J3 — nothing was drawn from the balance", money(s.applied_sar), 0);
      check("§J3 — the whole payable arrived as cash", money(s.paid_sar), SMALL_GROSS);
      check("§J3 — no ledger row was written at all", await ledgerCount(pin.customer), 0);
    });

    // =====================================================================
    // §I — ANON (CLAUDE.md §6). Every money RPC this file drives must be
    // closed to the anon role.
    // =====================================================================
    await scenario("§I — anon is denied EXECUTE on every money RPC", async () => {
      await rpc(TOPUP_SQL, [pp.customer, TOPUP_THIN, "cash", null, null, ACTOR, null]);
      const r = await rpc(CONFIRM_SQL, confirmArgs(pp.invoice, seeded.tripA, "prepaid", TRIP_NET, TRIP_VAT, TRIP_GROSS));
      if (r.err) { fail("§I: seed confirm failed", r.err.message.split("\n")[0]); return; }
      const inv = pp.invoice;

      await refuses("anon denied record_invoice_payment", PAY_SQL,
        [inv, 100, "cash", null, null, PAID_ON, ACTOR, null], "permission denied", "anon");
      await refuses("anon denied apply_balance_to_invoice", APPLY_SQL, [inv, ACTOR], "permission denied", "anon");
      await refuses("anon denied record_topup", TOPUP_SQL,
        [pp.customer, 100, "cash", null, null, ACTOR, null], "permission denied", "anon");
      await refuses("anon denied record_refund", REFUND_SQL,
        [pp.customer, 1, "cash", null, null, ACTOR, null], "permission denied", "anon");
      await refuses("anon denied void_invoice", VOID_SQL, [inv, "x", ACTOR], "permission denied", "anon");
      // The EXECUTE grant is checked before the function body runs, so it does
      // not matter that this invoice is already confirmed: a denial here is
      // the grant, and the "not in review status" raise would prove it was not.
      await refuses("anon denied confirm_invoice", CONFIRM_SQL,
        confirmArgs(inv, seeded.tripA, "prepaid", TRIP_NET, TRIP_VAT, TRIP_GROSS),
        "permission denied", "anon");
    });
  } finally {
    // ---- TEARDOWN. Unconditional: a thrown assertion must not strand rows.
    //      Everything above ran inside this one transaction, so the rollback is
    //      the whole cleanup — no fixture of this harness's making can survive
    //      it, and nothing pre-existing was ever written to.
    await c.query("rollback");
    await c.end();
  }

  // ---- ZERO-LEAK, on a FRESH connection so it cannot read its own
  //      uncommitted transaction. Counters included: confirm allocated invoice
  //      numbers, record_topup allocated receipt numbers and record_refund
  //      allocated credit-note numbers in nearly every scenario above.
  const postConn = new Client(conn);
  await postConn.connect();
  const censusAfter = (await postConn.query(censusSql)).rows[0];
  console.log("\nCensus AFTER:  " + JSON.stringify(censusAfter));
  for (const k of Object.keys(censusBefore)) {
    check(`zero-leak — ${k} unchanged`, censusAfter[k], censusBefore[k]);
  }
  const leaked = (await postConn.query(
    `select 'customer' k, id from public.customers where id = any($1::uuid[])
     union all select 'invoice', id from public.invoices where id = any($2::uuid[])
     union all select 'trip', id from public.trips where id = any($3::uuid[])`,
    [
      [seeded.customer, seeded.customer2, seeded.customer3, seeded.customer4],
      [seeded.invoice, seeded.invoice2, seeded.invoice3, seeded.invoice4],
      [seeded.tripA, seeded.tripB, seeded.tripC, seeded.tripD, seeded.tripE],
    ],
  )).rows;
  check("zero-leak — none of the seeded ids survive", leaked, []);
  await postConn.end();

  // ---- SUMMARY. The assertion count is part of the verdict: a run that
  //      asserted nothing has zero failures too, and must not read as a pass.
  const n = failureCount();
  if (assertions === 0) {
    console.log("\ninvoice-settlement-check: NO ASSERTIONS RAN — that is a failure, not a pass.\n");
    process.exit(1);
  }
  console.log(n === 0
    ? `\ninvoice-settlement-check: ALL ${assertions} ASSERTIONS PASSED — confirm moves no money, ` +
      `settlement does, Available reserves confirmed debt, and a transfer needs its proof.\n`
    : `\ninvoice-settlement-check: ${n} FAILURE(S) out of ${assertions} assertions\n`);
  process.exit(n === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\ninvoice-settlement-check crashed: " + String(e?.message ?? e));
  process.exit(1);
});
