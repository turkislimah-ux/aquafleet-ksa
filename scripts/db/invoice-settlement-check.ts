// LIVE DATABASE guard for the 0203 INVOICE SETTLEMENT flow — the prepaid draw
// at confirm, the frozen payable identity, partial payments, apply-balance, and
// the void that gives the money back.
// Run:  npm run test:db   (or: npx tsx scripts/db/invoice-settlement-check.ts)
// Exits 0 if every assertion passes, 1 otherwise (CI-friendly).
//
// Pass 5 of the scripts/db suite. Same discipline as the other four: ONE
// transaction ending in ROLLBACK, a savepoint per case, refusals matched
// against their raise text, and a census on a FRESH connection that includes
// all three document-number counters.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS SEPARATELY FROM ledger-check.ts
//
// ledger-check guards the ledger in ISOLATION: top-up in, refund out, the sign
// constraint, the three reader views. It deliberately never calls
// confirm_invoice, because a harness that proves two things proves neither when
// it goes red.
//
// This file guards the other half — the moment the ledger and the invoice meet.
// That moment is `confirm_invoice`, and NOTHING app-side computes it: the RPC
// reads Available itself, decides the draw itself, and freezes
// prepaid_applied_sar + amount_payable_sar itself. There is therefore no
// offline fixture that can test it. Either it is tested here against a real
// database or it is not tested at all.
//
// ---------------------------------------------------------------------------
// WHAT IT ASSERTS
//
//   full cover    prepaid confirm draws exactly min(Available, grand_total);
//                 payable 0 -> status flips to 'paid' in the same call
//   the rule      the draw is RE-DERIVED from measured rows, not just compared
//                 to a literal: draw == min(max(balance@confirm - uninvoiced@
//                 confirm, 0), grand_total). A literal-only check passes for a
//                 draw that is right by coincidence
//   identity      grand_total == prepaid_applied + amount_payable, every time
//   conservation  a FULLY covered confirm leaves Available untouched — the work
//                 only moves from Uninvoiced to drawn. If those two figures ever
//                 disagree the customer was charged twice for one delivery
//   short         Available < total -> partial draw, payable shortfall, status
//                 stays 'confirmed'
//   partial pay   cash payment of less than the remainder leaves it 'confirmed';
//                 remainder + 0.01 REFUSED by the overpay gate
//   apply balance top-up then apply_balance_to_invoice clears the remainder to
//                 0.00 and flips to 'paid'; payable == paid + applied
//   void(paid)    a PAID invoice voids: every draw AND every applied row is
//                 reversed, Balance returns to the halala, trips are released,
//                 and the invoice_payments row SURVIVES (append-only — refunding
//                 cash actually received is a separate act)
//   postpaid      confirm writes applied = 0, payable = grand_total, and writes
//                 NO ledger row at all
//   gates         legacy invoice (payable null) refuses both settle RPCs;
//                 apply-balance refuses a postpaid customer and refuses when
//                 there is nothing to apply; bad method / no proof / zero / no
//                 actor all refuse for their own stated reasons
//   anon          denied EXECUTE on all three RPCs (CLAUDE.md §6)
//
// ---------------------------------------------------------------------------
// THE SEED SHAPE IS THE REAL ONE, NOT A CONVENIENT ONE
//
// Trip A carries invoice_id = the review invoice, because the app reserves
// trips at DRAFT (invoiceActions -> p_trip_ids). That reservation is what makes
// the confirm-time read correct: v_customer_uninvoiced counts a delivered trip
// while its invoice is draft/review and drops it the instant the status flips,
// so confirm_invoice's flip-then-read order sees this invoice's work exactly
// once — inside grand_total — and never also in Uninvoiced. Seed the trip with
// a NULL invoice_id and the draw would double-count it, which is precisely the
// bug this file has to be able to see.
//
// Trip B is delivered, in the same period, and on NO invoice. It exists so that
// Uninvoiced is non-zero at the moment of the draw. Without it, Available and
// Balance are the same number at confirm and an implementation that drew
// min(BALANCE, total) — ignoring outstanding delivered work — would pass green.
// ---------------------------------------------------------------------------

import { Client, type QueryResult } from "pg";
import {
  check, connOptions, fail, failureCount, loadTestEnv, money, ok,
  PROVISION_STATION_SQL, SEED_STATION, SEED_WATER_TYPE, TEST_REF,
} from "./harness";

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

const UNINVOICED_BOTH = 2839.58;  // trips A + B, per-item gross — before confirm
const UNINVOICED_AFTER = 1419.79; // trip B only — the instant A's invoice confirms

// --- fully covered path
const TOPUP_FULL = 5000.0;
const AVAIL_BEFORE_FULL = 2160.42;  // 5000.00 − 2839.58
const AVAIL_AT_CONFIRM_FULL = 3580.21; // 5000.00 − 1419.79 (A has left Uninvoiced)
const DRAW_FULL = 1419.79;          // min(3580.21, 1419.79) — capped by the TOTAL
const BALANCE_AFTER_FULL = 3580.21;

// --- short path
const TOPUP_SHORT = 2000.0;
const AVAIL_AT_CONFIRM_SHORT = 580.21; // 2000.00 − 1419.79
const DRAW_SHORT = 580.21;             // min(580.21, 1419.79) — capped by AVAILABLE
const PAYABLE_SHORT = 839.58;          // 1419.79 − 580.21
const BALANCE_AFTER_SHORT = 1419.79;

const PAY_CASH = 300.0;
const REMAINDER_AFTER_CASH = 539.58;  // 839.58 − 300.00
const OVERPAY = 539.59;               // one halala past the remainder

const TOPUP_TOP = 1000.0;
const AVAIL_BEFORE_APPLY = 1000.0;    // (1419.79 + 1000.00) − 1419.79
const APPLIED = 539.58;               // min(1000.00, 539.58) — capped by the REMAINDER
const BALANCE_AFTER_APPLY = 1880.21;  // 2419.79 − 539.58
const BALANCE_AFTER_VOID_SHORT = 3000.0; // both top-ups back, both draws reversed

const PERIOD_START = "2020-01-01";
const PERIOD_END = "2020-01-31";
const TRIP_DATE = "2020-01-15";
const PAID_ON = "2020-02-01";
const ACTOR = "settlechk@harness.local";

const TOPUP_SQL = `select * from public.record_topup($1::uuid, $2::numeric, $3::text, $4::text, $5::text, $6::text, $7::text)`;
const PAY_SQL = `select * from public.record_invoice_payment($1::uuid, $2::numeric, $3::text, $4::text, $5::text, $6::date, $7::text, $8::text)`;
const APPLY_SQL = `select * from public.apply_balance_to_invoice($1::uuid, $2::text)`;
const VOID_SQL = `select * from public.void_invoice($1::uuid, $2::text, $3::text)`;

// SAME `from`-clause rule as confirm-invoice-check: a composite-returning call
// expanded with `.*` in the target list is evaluated ONCE PER OUTPUT COLUMN, so
// the second evaluation would find the invoice already confirmed and raise
// "Invoice is not in review status" — a real bug wearing a green disguise.
// $18 = p_payment_mode, $19 = p_actor (0203's addition; the six nullable ledger
// numerics between them stay literal nulls, as the ledger model does not use
// the FIFO split any more).
const CONFIRM_SQL = `
  select * from public.confirm_invoice(
    $1::uuid, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb,
    $7::uuid[], $8::uuid[],
    $9::numeric, $10::numeric, $11::numeric,
    $12::numeric, $13::numeric, $14::numeric,
    $15::numeric, $16::numeric, $17::numeric,
    null, null, null, null, null, null,
    $18::text, $19::text
  )`;

/** Confirm args for a one-trip invoice with NO pool-covered split. The ledger
 *  model draws at confirm instead of pre-splitting lines, so covered is 0/0/0
 *  and due == grand for prepaid and postpaid alike. That keeps 0191's Tier B
 *  (covered + due == grand) satisfied by construction. */
function confirmArgs(invoiceId: string, tripId: string, mode: string): unknown[] {
  return [
    invoiceId,
    JSON.stringify({ name: "SETTLECHK SELLER" }),
    JSON.stringify({ name: "SETTLECHK BUYER" }),
    JSON.stringify([]),
    JSON.stringify([{ kind: "trip", id: tripId, label: "SETTLECHK trip", date: TRIP_DATE, amount_sar: TRIP_NET }]),
    JSON.stringify([]),
    [],
    [tripId],
    0, 0, 0,
    TRIP_NET, TRIP_VAT, TRIP_GROSS,
    TRIP_NET, TRIP_VAT, TRIP_GROSS,
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
  check("fixture — AVAIL_BEFORE_FULL = topup − both trips", AVAIL_BEFORE_FULL, money(TOPUP_FULL - UNINVOICED_BOTH));
  check("fixture — AVAIL_AT_CONFIRM_FULL = topup − trip B", AVAIL_AT_CONFIRM_FULL, money(TOPUP_FULL - UNINVOICED_AFTER));
  check("fixture — DRAW_FULL = min(available, total), capped by TOTAL", DRAW_FULL, Math.min(AVAIL_AT_CONFIRM_FULL, TRIP_GROSS));
  check("fixture — BALANCE_AFTER_FULL = topup − draw", BALANCE_AFTER_FULL, money(TOPUP_FULL - DRAW_FULL));
  check(
    "fixture — a FULL cover leaves Available where it started (conservation)",
    money(BALANCE_AFTER_FULL - UNINVOICED_AFTER),
    AVAIL_BEFORE_FULL,
  );
  check("fixture — AVAIL_AT_CONFIRM_SHORT = topup − trip B", AVAIL_AT_CONFIRM_SHORT, money(TOPUP_SHORT - UNINVOICED_AFTER));
  check("fixture — DRAW_SHORT = min(available, total), capped by AVAILABLE", DRAW_SHORT, Math.min(AVAIL_AT_CONFIRM_SHORT, TRIP_GROSS));
  check("fixture — payable identity: total = applied + payable", TRIP_GROSS, money(DRAW_SHORT + PAYABLE_SHORT));
  check("fixture — BALANCE_AFTER_SHORT = topup − draw", BALANCE_AFTER_SHORT, money(TOPUP_SHORT - DRAW_SHORT));
  check("fixture — REMAINDER_AFTER_CASH = payable − cash", REMAINDER_AFTER_CASH, money(PAYABLE_SHORT - PAY_CASH));
  check("fixture — OVERPAY is one halala past the remainder", OVERPAY, money(REMAINDER_AFTER_CASH + 0.01));
  check("fixture — AVAIL_BEFORE_APPLY", AVAIL_BEFORE_APPLY, money(BALANCE_AFTER_SHORT + TOPUP_TOP - UNINVOICED_AFTER));
  check("fixture — APPLIED = min(available, remainder), capped by the REMAINDER", APPLIED, Math.min(AVAIL_BEFORE_APPLY, REMAINDER_AFTER_CASH));
  check("fixture — payable is settled twice over: cash + applied", PAYABLE_SHORT, money(PAY_CASH + APPLIED));
  check("fixture — BALANCE_AFTER_APPLY", BALANCE_AFTER_APPLY, money(BALANCE_AFTER_SHORT + TOPUP_TOP - APPLIED));
  check("fixture — void of the short invoice restores BOTH top-ups", BALANCE_AFTER_VOID_SHORT, money(TOPUP_SHORT + TOPUP_TOP));

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
  const available = async (customerId: string): Promise<number> =>
    money((await c.query(`select available_sar from public.v_customer_available where customer_id = $1`, [customerId])).rows[0].available_sar);
  const invoiceRow = async (invoiceId: string): Promise<Row> =>
    (await c.query(`select status, invoice_number, grand_total_sar, prepaid_applied_sar, amount_payable_sar from public.invoices where id = $1`, [invoiceId])).rows[0];
  const settlement = async (invoiceId: string): Promise<Row> =>
    (await c.query(`select payable_sar, paid_sar, applied_sar, written_off_sar, remainder_sar from public.v_invoice_settlement where invoice_id = $1`, [invoiceId])).rows[0];
  /** Ledger rows for one invoice, by type — the audit trail the money moved on. */
  const ledgerByType = async (invoiceId: string): Promise<Record<string, number>> => {
    const rows = (await c.query(
      `select entry_type, round(sum(amount_sar), 2) as s from public.customer_ledger
        where invoice_id = $1 group by entry_type`, [invoiceId])).rows;
    const m: Record<string, number> = {};
    for (const r of rows) m[String(r.entry_type)] = money(r.s);
    return m;
  };
  const tripInvoiceId = async (tripId: string): Promise<string | null> =>
    (await c.query(`select invoice_id from public.trips where id = $1`, [tripId])).rows[0].invoice_id ?? null;

  /** The identity every confirmed invoice must satisfy, whatever the mode. */
  function payableIdentity(label: string, inv: Row): void {
    check(
      `${label}: grand_total == prepaid_applied + amount_payable`,
      money(inv.grand_total_sar),
      money(money(inv.prepaid_applied_sar) + money(inv.amount_payable_sar)),
    );
  }

  /** RE-DERIVE the draw from measured rows rather than trusting the literal.
   *  balance@confirm is reconstructed by adding the draw back to the balance
   *  that survives it; uninvoiced@confirm is what the view says now, because a
   *  draw moves no trip. A literal-only assertion cannot tell a correct draw
   *  from one that is right by arithmetic coincidence. */
  async function drawFollowsTheRule(label: string, customerId: string, inv: Row): Promise<void> {
    const drew = money(inv.prepaid_applied_sar);
    const balAtConfirm = money((await balance(customerId)) + drew);
    const uninvAtConfirm = await uninvoiced(customerId);
    const availAtConfirm = money(balAtConfirm - uninvAtConfirm);
    const expected = money(Math.min(Math.max(availAtConfirm, 0), money(inv.grand_total_sar)));
    check(`${label}: draw == min(max(Available@confirm, 0), grand_total) — re-derived`, drew, expected);
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

    // =====================================================================
    // SEED. Two customers, one prepaid and one postpaid, each with a project,
    // an invoice in 'review' and a delivered trip RESERVED to that invoice.
    // The prepaid customer gets a second delivered trip on no invoice, so
    // Uninvoiced is non-zero at the moment of the draw (see the header).
    // =====================================================================

    // `initials` is a caller argument, not a constant: projects_initials_unique
    // is a GLOBAL uniqueness constraint, so seeding two projects in one
    // transaction with the same initials dies on the insert and proves nothing.
    async function seedCustomer(tag: string, mode: string, initials: string): Promise<{ customer: string; project: string; invoice: string; trip: string }> {
      const customer = (await c.query(
        `insert into public.customers (name, customer_type, payment_mode)
         values ($1, 'construction', $2) returning id`,
        [`SETTLECHK ${tag}`, mode])).rows[0].id as string;
      const project = (await c.query(
        `insert into public.projects
           (customer_id, name, initials, default_water_station, water_type, status, payment_mode, rate_per_trip_sar)
         values ($1, $2, $3, 'manfuhah_station', 'potable', 'active', $4, $5) returning id`,
        [customer, `SETTLECHK ${tag} PROJECT`, initials, mode, TRIP_NET])).rows[0].id as string;
      const invoice = (await c.query(
        `insert into public.invoices (customer_id, period_start, period_end, status)
         values ($1, $2, $3, 'review') returning id`,
        [customer, PERIOD_START, PERIOD_END])).rows[0].id as string;
      // invoice_id set at seed time because the app reserves at DRAFT. See header.
      const trip = (await c.query(
        `insert into public.trips
           (project_id, customer_id, water_station, water_type, rate_sar, stage, trip_date, delivered_at, invoice_id)
         values ($1, $2, 'manfuhah_station', 'potable', $3, 'delivered', $4, now(), $5) returning id`,
        [project, customer, TRIP_NET, TRIP_DATE, invoice])).rows[0].id as string;
      return { customer, project, invoice, trip };
    }

    const pp = await seedCustomer("PREPAID", "prepaid", "SCP");
    seeded.customer = pp.customer; seeded.project = pp.project;
    seeded.invoice = pp.invoice; seeded.tripA = pp.trip;

    // Trip B — delivered, same period, on NO invoice. Permanently uninvoiced.
    seeded.tripB = (await c.query(
      `insert into public.trips
         (project_id, customer_id, water_station, water_type, rate_sar, stage, trip_date, delivered_at)
       values ($1, $2, 'manfuhah_station', 'potable', $3, 'delivered', $4, now()) returning id`,
      [pp.project, pp.customer, TRIP_NET, TRIP_DATE])).rows[0].id;

    const post = await seedCustomer("POSTPAID", "postpaid", "SCO");
    seeded.customer2 = post.customer; seeded.project2 = post.project;
    seeded.invoice2 = post.invoice; seeded.tripC = post.trip;

    console.log("\nSeeded: " + JSON.stringify(seeded));

    // ---- Baseline. The draft/review reservation must NOT hide delivered work:
    //      both trips count as Uninvoiced while the invoice is still 'review'.
    check("baseline — empty ledger reads 0.00", await balance(pp.customer), 0);
    check("baseline — Uninvoiced counts BOTH trips while the invoice is 'review'", await uninvoiced(pp.customer), UNINVOICED_BOTH);
    check("baseline — Available = 0 − Uninvoiced", await available(pp.customer), money(-UNINVOICED_BOTH));

    // =====================================================================
    // 1. PREPAID, FULLY COVERED. Draw capped by the TOTAL; payable 0; the
    //    status flip to 'paid' happens inside confirm_invoice, not after it.
    // =====================================================================
    await scenario("prepaid confirm, balance covers the whole invoice", async () => {
      const t = await rpc(TOPUP_SQL, [pp.customer, TOPUP_FULL, "cash", null, null, ACTOR, null]);
      ok("top-up accepted", t.err === null);
      check("Available before confirm", await available(pp.customer), AVAIL_BEFORE_FULL);

      const r = await rpc(CONFIRM_SQL, confirmArgs(pp.invoice, seeded.tripA, "prepaid"));
      ok("confirm accepted", r.err === null);
      if (r.err) { console.log(`          db said: ${r.err.message.split("\n")[0]}`); return; }

      const inv = await invoiceRow(pp.invoice);
      ok("invoice number allocated", /^\d{3}-\d{6}$/.test(String(inv.invoice_number)));
      check("Uninvoiced at confirm dropped THIS invoice's trip, kept trip B", await uninvoiced(pp.customer), UNINVOICED_AFTER);
      check("prepaid_applied_sar == the whole grand total", money(inv.prepaid_applied_sar), DRAW_FULL);
      check("amount_payable_sar == 0.00", money(inv.amount_payable_sar), 0);
      check("status flipped to 'paid' inside the same call", inv.status, "paid");
      payableIdentity("full cover", inv);
      await drawFollowsTheRule("full cover", pp.customer, inv);

      check("ONE invoice_draw row, stored NEGATIVE", (await ledgerByType(pp.invoice)).invoice_draw, money(-DRAW_FULL));
      check("Balance after the draw", await balance(pp.customer), BALANCE_AFTER_FULL);
      check(
        "CONSERVATION — a full cover leaves Available exactly where it started",
        await available(pp.customer), AVAIL_BEFORE_FULL,
      );

      const s = await settlement(pp.invoice);
      check("settlement — payable", money(s.payable_sar), 0);
      check("settlement — remainder", money(s.remainder_sar), 0);
      check("settlement — nothing was PAID in cash (the pool settled it)", money(s.paid_sar), 0);
      check("settlement — nothing was APPLIED post-confirm either", money(s.applied_sar), 0);

      // ---- void from 'paid'. The reversal must put the customer back exactly
      //      where they were: same Balance, same Available, trip released.
      const v = await rpc(VOID_SQL, [pp.invoice, "harness void", ACTOR]);
      ok("void of a PAID invoice accepted", v.err === null);
      if (v.err) { console.log(`          db said: ${v.err.message.split("\n")[0]}`); return; }
      check("void — status", (await invoiceRow(pp.invoice)).status, "void");
      check("void — a paired draw_reversal was written", (await ledgerByType(pp.invoice)).draw_reversal, DRAW_FULL);
      check("void — Balance restored to the halala", await balance(pp.customer), TOPUP_FULL);
      check("void — trip released back to no invoice", await tripInvoiceId(seeded.tripA), null);
      check("void — Uninvoiced counts both trips again", await uninvoiced(pp.customer), UNINVOICED_BOTH);
      check("void — Available back to the pre-confirm figure", await available(pp.customer), AVAIL_BEFORE_FULL);
    });

    // =====================================================================
    // 2. PREPAID, SHORT. Draw capped by AVAILABLE; a payable remains; then
    //    partial cash, then top-up + apply-balance to clear it.
    // =====================================================================
    await scenario("prepaid confirm on a SHORT balance, then partial cash, then apply balance", async () => {
      const t = await rpc(TOPUP_SQL, [pp.customer, TOPUP_SHORT, "cash", null, null, ACTOR, null]);
      ok("top-up accepted", t.err === null);

      const r = await rpc(CONFIRM_SQL, confirmArgs(pp.invoice, seeded.tripA, "prepaid"));
      ok("confirm accepted", r.err === null);
      if (r.err) { console.log(`          db said: ${r.err.message.split("\n")[0]}`); return; }

      let inv = await invoiceRow(pp.invoice);
      check("prepaid_applied_sar == Available, not the total", money(inv.prepaid_applied_sar), DRAW_SHORT);
      check("amount_payable_sar == the shortfall", money(inv.amount_payable_sar), PAYABLE_SHORT);
      check("status stays 'confirmed' — money is still owed", inv.status, "confirmed");
      payableIdentity("short cover", inv);
      await drawFollowsTheRule("short cover", pp.customer, inv);
      check("Balance after the partial draw", await balance(pp.customer), BALANCE_AFTER_SHORT);
      check("Available is spent to exactly 0.00", await available(pp.customer), 0);
      check("settlement — remainder == the payable", money((await settlement(pp.invoice)).remainder_sar), PAYABLE_SHORT);

      // Available is 0.00 here, so there is genuinely nothing to apply. That is
      // a DIFFERENT refusal from "wrong status" or "wrong mode", and matching
      // its words is what keeps the three apart.
      await refuses("apply_balance with Available at 0.00", APPLY_SQL, [pp.invoice, ACTOR], "Nothing to apply");

      // ---- partial cash payment
      const p = await rpc(PAY_SQL, [pp.invoice, PAY_CASH, "cash", null, null, PAID_ON, ACTOR, null]);
      ok("partial cash payment accepted", p.err === null);
      if (p.err) { console.log(`          db said: ${p.err.message.split("\n")[0]}`); return; }
      inv = await invoiceRow(pp.invoice);
      check("a PARTIAL payment does not flip the status", inv.status, "confirmed");
      let s = await settlement(pp.invoice);
      check("settlement — paid", money(s.paid_sar), PAY_CASH);
      check("settlement — remainder after the cash", money(s.remainder_sar), REMAINDER_AFTER_CASH);
      check("a cash payment writes NO ledger row (it is not pool money)", (await ledgerByType(pp.invoice)).invoice_payment ?? null, null);
      check("Balance untouched by a cash payment", await balance(pp.customer), BALANCE_AFTER_SHORT);

      await refuses(
        "payment of remainder + 0.01", PAY_SQL,
        [pp.invoice, OVERPAY, "cash", null, null, PAID_ON, ACTOR, null],
        "exceeds the invoice remainder",
      );
      check("the refused overpay left the remainder unmoved", money((await settlement(pp.invoice)).remainder_sar), REMAINDER_AFTER_CASH);

      // ---- top-up, then apply the balance to the remainder
      const t2 = await rpc(TOPUP_SQL, [pp.customer, TOPUP_TOP, "cash", null, null, ACTOR, null]);
      ok("second top-up accepted", t2.err === null);
      check("Available before apply", await available(pp.customer), AVAIL_BEFORE_APPLY);

      const a = await rpc(APPLY_SQL, [pp.invoice, ACTOR]);
      ok("apply_balance accepted", a.err === null);
      if (a.err) { console.log(`          db said: ${a.err.message.split("\n")[0]}`); return; }
      inv = await invoiceRow(pp.invoice);
      check("apply — status flipped to 'paid'", inv.status, "paid");
      check("apply — the FROZEN payable is not rewritten", money(inv.amount_payable_sar), PAYABLE_SHORT);
      check("apply — prepaid_applied_sar is not rewritten either (it is the CONFIRM draw)", money(inv.prepaid_applied_sar), DRAW_SHORT);
      s = await settlement(pp.invoice);
      check("apply — applied_sar is capped by the REMAINDER, not by Available", money(s.applied_sar), APPLIED);
      check("apply — remainder is 0.00", money(s.remainder_sar), 0);
      check("apply — payable is settled twice over: cash + applied", money(s.payable_sar), money(money(s.paid_sar) + money(s.applied_sar)));
      check("apply — Balance after", await balance(pp.customer), BALANCE_AFTER_APPLY);
      check("apply — trip stamped to the now-paid invoice", await tripInvoiceId(seeded.tripA), pp.invoice);

      // ---- void a PAID invoice that was settled two ways. BOTH negative
      //      ledger rows reverse; the cash row does NOT vanish.
      const v = await rpc(VOID_SQL, [pp.invoice, "harness void", ACTOR]);
      ok("void accepted", v.err === null);
      if (v.err) { console.log(`          db said: ${v.err.message.split("\n")[0]}`); return; }
      const byType = await ledgerByType(pp.invoice);
      check("void — the draw AND the applied row are both reversed", byType.draw_reversal, money(DRAW_SHORT + APPLIED));
      check("void — Balance restored to the sum of both top-ups", await balance(pp.customer), BALANCE_AFTER_VOID_SHORT);
      check(
        "void — the invoice_payments row SURVIVES (append-only; refunding real cash is a separate act)",
        money((await settlement(pp.invoice)).paid_sar), PAY_CASH,
      );
      check("void — trip released", await tripInvoiceId(seeded.tripA), null);
    });

    // =====================================================================
    // 3. POSTPAID. No pool, so no draw — and NO ledger row of any kind. The
    //    negative is the point: a prepaid arm that fires for everyone would
    //    still make the two frozen columns look right.
    // =====================================================================
    await scenario("postpaid confirm writes applied = 0 and touches no ledger", async () => {
      const r = await rpc(CONFIRM_SQL, confirmArgs(post.invoice, post.trip, "postpaid"));
      ok("confirm accepted", r.err === null);
      if (r.err) { console.log(`          db said: ${r.err.message.split("\n")[0]}`); return; }

      const inv = await invoiceRow(post.invoice);
      check("prepaid_applied_sar == 0.00", money(inv.prepaid_applied_sar), 0);
      check("amount_payable_sar == the whole grand total", money(inv.amount_payable_sar), TRIP_GROSS);
      check("status stays 'confirmed'", inv.status, "confirmed");
      payableIdentity("postpaid", inv);
      check("NO ledger rows were written for this invoice", await ledgerByType(post.invoice), {});
      check("the postpaid customer's Balance is still 0.00", await balance(post.customer), 0);

      // A postpaid customer has no pool, so apply-balance must refuse on MODE —
      // not on status, and not on "nothing to apply".
      await refuses("apply_balance for a POSTPAID customer", APPLY_SQL, [post.invoice, ACTOR], "only be applied for a prepaid customer");

      // Partial payments work the same on a postpaid invoice: that is the one
      // thing postpaid gains from this rebuild.
      const p = await rpc(PAY_SQL, [post.invoice, PAY_CASH, "cash", null, null, PAID_ON, ACTOR, null]);
      ok("postpaid partial payment accepted", p.err === null);
      check("postpaid — status stays 'confirmed' after a partial", (await invoiceRow(post.invoice)).status, "confirmed");
      check("postpaid — remainder", money((await settlement(post.invoice)).remainder_sar), money(TRIP_GROSS - PAY_CASH));

      const p2 = await rpc(PAY_SQL, [post.invoice, money(TRIP_GROSS - PAY_CASH), "cash", null, null, PAID_ON, ACTOR, null]);
      ok("postpaid final payment accepted", p2.err === null);
      check("postpaid — the payment that clears the remainder flips to 'paid'", (await invoiceRow(post.invoice)).status, "paid");
      check("postpaid — trip stamped", await tripInvoiceId(post.trip), post.invoice);
    });

    // =====================================================================
    // 4. THE LEGACY GATE. 0203 does not backfill, so every pre-ledger
    //    confirmed invoice has a NULL amount_payable_sar forever. Both settle
    //    RPCs must refuse those by name — the app routes them to the legacy
    //    flow, and it can only do that if the database says so out loud.
    // =====================================================================
    await scenario("legacy invoices (amount_payable_sar null) refuse both settle RPCs", async () => {
      const legacy = (await c.query(
        `insert into public.invoices (customer_id, period_start, period_end, status, grand_total_sar)
         values ($1, $2, $3, 'confirmed', $4) returning id`,
        [pp.customer, PERIOD_START, PERIOD_END, TRIP_GROSS])).rows[0].id as string;
      check("the legacy row really has a NULL payable", (await invoiceRow(legacy)).amount_payable_sar, null);
      check("v_invoice_settlement reports a NULL remainder for it", (await settlement(legacy)).remainder_sar, null);
      await refuses("record_invoice_payment on a legacy invoice", PAY_SQL,
        [legacy, PAY_CASH, "cash", null, null, PAID_ON, ACTOR, null], "no frozen amount payable");
      await refuses("apply_balance_to_invoice on a legacy invoice", APPLY_SQL,
        [legacy, ACTOR], "no frozen amount payable");
    });

    // =====================================================================
    // 5. INPUT GATES + ANON (CLAUDE.md §6). Each runs against a real
    //    confirmed prepaid invoice so the ONLY thing wrong is the argument
    //    under test — a refusal cannot be credited to the wrong gate.
    // =====================================================================
    await scenario("input gates and grants", async () => {
      await rpc(TOPUP_SQL, [pp.customer, TOPUP_SHORT, "cash", null, null, ACTOR, null]);
      const r = await rpc(CONFIRM_SQL, confirmArgs(pp.invoice, seeded.tripA, "prepaid"));
      if (r.err) { fail("gates: seed confirm failed", r.err.message.split("\n")[0]); return; }
      const inv = pp.invoice;

      await refuses("method 'balance' (it is applied, not paid)", PAY_SQL,
        [inv, 100, "balance", null, null, PAID_ON, ACTOR, null], "Invalid payment method");
      await refuses("bank_transfer with no proof", PAY_SQL,
        [inv, 100, "bank_transfer", "REF-1", null, PAID_ON, ACTOR, null], "requires a proof-of-payment file");
      await refuses("bank_transfer with no reference", PAY_SQL,
        [inv, 100, "bank_transfer", null, "proofs/x.pdf", PAID_ON, ACTOR, null], "requires a payment reference");
      await refuses("bank_transfer with no date", PAY_SQL,
        [inv, 100, "bank_transfer", "REF-1", "proofs/x.pdf", null, ACTOR, null], "requires a payment date");
      await refuses("payment of zero", PAY_SQL,
        [inv, 0, "cash", null, null, PAID_ON, ACTOR, null], "greater than zero");
      await refuses("payment without an actor", PAY_SQL,
        [inv, 100, "cash", null, null, PAID_ON, "  ", null], "Actor identity");
      await refuses("apply_balance without an actor", APPLY_SQL, [inv, "  "], "Actor identity");

      // cash needs neither proof nor reference nor date — the asymmetry is
      // deliberate, and an assertion is the only thing that keeps it.
      const cashOnly = await rpc(PAY_SQL, [inv, 100, "cash", null, null, null, ACTOR, null]);
      ok("cash payment with no proof, no reference and no date is ACCEPTED", cashOnly.err === null);
      if (cashOnly.err) console.log(`          db said: ${cashOnly.err.message.split("\n")[0]}`);

      await refuses("anon denied record_invoice_payment", PAY_SQL,
        [inv, 100, "cash", null, null, PAID_ON, ACTOR, null], "permission denied", "anon");
      await refuses("anon denied apply_balance_to_invoice", APPLY_SQL, [inv, ACTOR], "permission denied", "anon");
      await refuses("anon denied void_invoice", VOID_SQL, [inv, "x", ACTOR], "permission denied", "anon");
    });
  } finally {
    // ---- TEARDOWN. Unconditional: a thrown assertion must not strand rows.
    await c.query("rollback");
    await c.end();
  }

  // ---- ZERO-LEAK, on a FRESH connection so it cannot read its own
  //      uncommitted transaction. Counters included: confirm allocated invoice
  //      numbers and record_topup allocated receipt numbers in nearly every
  //      scenario above.
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
      [seeded.customer, seeded.customer2],
      [seeded.invoice, seeded.invoice2],
      [seeded.tripA, seeded.tripB, seeded.tripC],
    ],
  )).rows;
  check("zero-leak — none of the seeded ids survive", leaked, []);
  await postConn.end();

  const n = failureCount();
  console.log(n === 0
    ? "\ninvoice-settlement-check: ALL ASSERTIONS PASSED — the draw, the payable, the settlement and the void all hold.\n"
    : `\ninvoice-settlement-check: ${n} FAILURE(S)\n`);
  process.exit(n === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\ninvoice-settlement-check crashed: " + String(e?.message ?? e));
  process.exit(1);
});
