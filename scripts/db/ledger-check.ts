// LIVE DATABASE guard for the CUSTOMER LEDGER (0203) — the three reader views
// and the two money-writing RPCs the prepaid rebuild stands on.
// Run:  npm run test:db      (or: npx tsx scripts/db/ledger-check.ts)
// Exits 0 if every assertion passes, 1 otherwise (CI-friendly).
//
// Pass 4 of the scripts/db suite. Same discipline as the other three: one
// transaction ending in ROLLBACK, a savepoint per case, refusals matched
// against their raise text so a refusal landing on a DIFFERENT gate cannot
// pass as green, and a census on a FRESH connection proving no row survived —
// including the two document-number counters, because an RCT/CN sequence that
// leaked out of the rollback would put a gap in a gap-free series.
//
// WHAT IT ASSERTS
//
//   arithmetic  every literal below re-derived offline before a socket opens
//   baseline    fresh customer: Balance 0, Uninvoiced = 2 delivered trips
//               (per-trip rounding — the halala pin), Available = 0 − Uninvoiced
//   topup       record_topup returns an RCT- doc; Balance view == Σ ledger rows
//               (the view's ONE job); Available == Balance − Uninvoiced
//   refund cap  refund of Available + 0.01 REFUSED with the cap's own words;
//               refusal leaves the money unmoved
//   refund ok   refund of EXACTLY Available accepted (cap is >, not >=);
//               CN- doc; row stored NEGATIVE; Available lands on 0.00
//   sign check  direct inserts violating customer_ledger_sign_check raise it
//               by name — negative topup, positive refund, zero correction
//   input gates zero amount and blank actor refused for their stated reasons
//   anon        denied EXECUTE on both RPCs (CLAUDE.md §6)
//
// THE FIGURES ARE DELIBERATELY UGLY. Rate 1234.50 grosses to 1419.675 → the
// per-item rounding convention says 1419.68 PER TRIP, so two trips uninvoice
// at 2839.36 — one halala away from round(sum) arithmetic. If any layer
// switches to document-level rounding here, the baseline fails before a
// single RPC runs.

import { Client, type QueryResult } from "pg";
import {
  check, connOptions, fail, failureCount, loadTestEnv, money, ok,
  PROVISION_STATION_SQL, SEED_STATION, SEED_WATER_TYPE, TEST_REF,
} from "./harness";

// ---------------------------------------------------------------------------
// Fixture — every figure this file asserts, derived once here.
// ---------------------------------------------------------------------------

const TRIP_NET = 1234.5;
const TRIP_GROSS = 1419.68; // round(1234.50 × 1.15, 2) — the halala that must survive
const UNINVOICED = 2839.36; // 2 × TRIP_GROSS, per-item rounding
const TOPUP = 3000.0;
const AVAILABLE = 160.64; // TOPUP − UNINVOICED
const REFUND_OVER = 160.65; // one halala past the cap
const BALANCE_AFTER_REFUND = 2839.36; // TOPUP − AVAILABLE

const TRIP_DATE = "2020-01-15";
const ACTOR = "dbchk@harness.local";

const TOPUP_SQL = `select * from public.record_topup($1::uuid, $2::numeric, $3::text, $4::text, $5::text, $6::text, $7::text)`;
// Seven arguments since 0204, which gave the refund a proof photo and DROPPED
// the six-argument version outright. The argument list here is positional, so
// the added p_photo_path sits fifth and pushes p_actor and p_note along one
// place each — calling this with the old six would not merely lose the photo,
// it would fail to resolve the function at all and read like a schema fault.
const REFUND_SQL = `select * from public.record_refund($1::uuid, $2::numeric, $3::text, $4::text, $5::text, $6::text, $7::text)`;

type Row = Record<string, unknown>;
type Outcome = { row: Row | null; err: { message: string } | null };

async function main(): Promise<void> {
  const env = loadTestEnv();
  const conn = connOptions(env);

  // Literals re-derived offline BEFORE a socket opens — these fail on a bad
  // constant, not on a bad database.
  console.log("");
  check("fixture arithmetic — TRIP_GROSS = round(net × 1.15, 2)", TRIP_GROSS, money(TRIP_NET * 1.15));
  check("fixture arithmetic — UNINVOICED = 2 × per-trip gross", UNINVOICED, money(2 * TRIP_GROSS));
  check("fixture arithmetic — AVAILABLE = TOPUP − UNINVOICED", AVAILABLE, money(TOPUP - UNINVOICED));
  check("fixture arithmetic — REFUND_OVER is one halala past the cap", REFUND_OVER, money(AVAILABLE + 0.01));
  check("fixture arithmetic — BALANCE_AFTER_REFUND = TOPUP − AVAILABLE", BALANCE_AFTER_REFUND, money(TOPUP - AVAILABLE));
  check(
    "fixture arithmetic — the halala pin is real (per-item ≠ round-of-sum would differ at 4 trips)",
    money(4 * TRIP_GROSS) !== money(4 * TRIP_NET * 1.15),
    true,
  );

  // Every table this file can touch, plus BOTH counters: a sequence that
  // survived the rollback is a leak the row counts cannot see.
  const censusSql = `
    select
      (select count(*) from public.customers)                        as customers,
      (select count(*) from public.projects)                         as projects,
      (select count(*) from public.trips)                            as trips,
      (select count(*) from public.customer_ledger)                  as ledger_rows,
      (select count(*) from public.ledger_corrections)               as corrections,
      (select count(*) from public.ledger_correction_votes)          as votes,
      (select coalesce(sum(next_number), 0)
         from public.topup_receipt_counter)                          as rct_counter_sum,
      (select coalesce(sum(next_number), 0)
         from public.credit_note_counter)                            as cn_counter_sum`;

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

  // --- Money read-backs, straight off the three views this file exists for.
  const balance = async (customerId: string): Promise<number> =>
    money(
      (await c.query(`select balance_sar from public.v_customer_ledger_balance where customer_id = $1`, [customerId]))
        .rows[0].balance_sar,
    );
  const uninvoiced = async (customerId: string): Promise<number> =>
    money(
      (await c.query(`select uninvoiced_sar from public.v_customer_uninvoiced where customer_id = $1`, [customerId]))
        .rows[0].uninvoiced_sar,
    );
  const available = async (customerId: string): Promise<number> =>
    money(
      (await c.query(`select available_sar from public.v_customer_available where customer_id = $1`, [customerId]))
        .rows[0].available_sar,
    );
  /** Σ of the raw rows — what v_customer_ledger_balance CLAIMS to equal. */
  const rowSum = async (customerId: string): Promise<number> =>
    money(
      (
        await c.query(
          `select round(coalesce(sum(amount_sar), 0), 2) as s from public.customer_ledger where customer_id = $1`,
          [customerId],
        )
      ).rows[0].s,
    );

  /** The identity the whole model hangs on, asserted at every settle point. */
  async function identity(label: string, customerId: string): Promise<void> {
    const [b, u, a, s] = [
      await balance(customerId), await uninvoiced(customerId),
      await available(customerId), await rowSum(customerId),
    ];
    check(`${label}: Balance == Σ ledger rows`, b, s);
    check(`${label}: Available == Balance − Uninvoiced`, a, money(b - u));
  }

  // --- A case body, run inside a savepoint and rolled back whatever happens —
  //     even on success, so every case starts from the post-topup baseline.
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

  // --- A refusal must raise AND raise for the stated reason — matching the
  //     fragment is the proof the guard CAN fire, encoded in the run itself.
  async function refuses(
    label: string,
    sql: string,
    args: unknown[],
    fragment: string,
    role = "service_role",
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
    // SEED — one prepaid customer, one project, TWO delivered trips with NO
    // invoice at all. That satisfies the uninvoiced predicate's simplest arm
    // (delivered AND invoice_id null) without borrowing confirm_invoice —
    // this file guards the ledger, not the invoice lifecycle.
    // =====================================================================

    const customer = (
      await c.query(
        `insert into public.customers (name, customer_type, payment_mode)
         values ('DBCHK LEDGER', 'construction', 'prepaid') returning id`,
      )
    ).rows[0].id as string;

    const project = (
      await c.query(
        `insert into public.projects
           (customer_id, name, initials, default_water_station, water_type, status,
            payment_mode, rate_per_trip_sar)
         values ($1, 'DBCHK LEDGER PROJECT', 'DBL', 'manfuhah_station', 'potable', 'active',
                 'prepaid', $2) returning id`,
        [customer, TRIP_NET],
      )
    ).rows[0].id as string;

    for (let i = 0; i < 2; i++) {
      await c.query(
        `insert into public.trips
           (project_id, customer_id, water_station, water_type, rate_sar, stage, trip_date, delivered_at)
         values ($1, $2, 'manfuhah_station', 'potable', $3, 'delivered', $4, now())`,
        [project, customer, TRIP_NET, TRIP_DATE],
      );
    }
    console.log(`\nSeeded: customer ${customer}`);

    // ---- Baseline, asserted not recorded: an empty ledger and two delivered
    //      trips priced per-item. This is where the halala pin bites first.
    check("baseline — Balance of an empty ledger is 0.00", await balance(customer), 0);
    check("baseline — Uninvoiced = 2 trips at per-trip rounding (the halala pin)", await uninvoiced(customer), UNINVOICED);
    check("baseline — Available = 0 − Uninvoiced", await available(customer), money(-UNINVOICED));
    await identity("baseline", customer);

    // =====================================================================
    // TOP-UP — persists for every case below (each case savepoints off it).
    // =====================================================================
    console.log("\n-- record_topup");
    // A photo path is now mandatory alongside the reference: 0204 made proof a
    // condition of a bank transfer inside the RPC itself, so this seed stopped
    // being acceptable the moment the migration landed. The value is only ever
    // a storage key in a text column — the RPC does not resolve it and nothing
    // in this harness reads it back — so a literal keeps the seed honest
    // without inventing a bucket object.
    const t = await rpc(TOPUP_SQL, [customer, TOPUP, "bank_transfer", "DBCHK-REF-1", `${customer}/topup-dbchk.webp`, ACTOR, "harness top-up"]);
    ok("topup accepted", t.err === null);
    if (t.err) throw new Error("topup seed failed: " + t.err.message);
    ok("topup doc is an RCT- number", /^RCT-\d{4}-\d{6}$/.test(String(t.row?.doc_number)));
    check("topup row stored POSITIVE at 2dp", money(t.row?.amount_sar), TOPUP);
    check("Balance after top-up", await balance(customer), TOPUP);
    check("Available after top-up (Balance − Uninvoiced, to the halala)", await available(customer), AVAILABLE);
    await identity("after top-up", customer);

    // =====================================================================
    // REFUND CAP — one halala over refused, exactly Available accepted.
    // =====================================================================
    // CASH, deliberately. This case exists to prove the CAP refuses, and since
    // 0204 the bank-transfer proof guard runs ahead of the cap — a reference-
    // less, photo-less bank transfer is now refused for missing proof and never
    // reaches the arithmetic under test. Cash requires no proof, so the cap is
    // the only thing left that can refuse and the assertion keeps meaning what
    // its name says. The proof guards get their own coverage in
    // scripts/db/invoice-settlement-check.ts.
    await refuses(
      "refund of Available + 0.01",
      REFUND_SQL, [customer, REFUND_OVER, "cash", null, null, ACTOR, null],
      "exceeds the customer",
    );
    check("refusal left Balance unmoved", await balance(customer), TOPUP);
    check("refusal left Available unmoved", await available(customer), AVAILABLE);

    await scenario("refund of EXACTLY Available (cap is >, not >=)", async () => {
      const r = await rpc(REFUND_SQL, [customer, AVAILABLE, "cash", null, null, ACTOR, "harness refund"]);
      ok("refund accepted", r.err === null);
      if (r.err) { console.log(`          db said: ${r.err.message.split("\n")[0]}`); return; }
      ok("refund doc is a CN- number", /^CN-\d{4}-\d{6}$/.test(String(r.row?.doc_number)));
      check("refund row stored NEGATIVE", money(r.row?.amount_sar), money(-AVAILABLE));
      check("Balance after refund", await balance(customer), BALANCE_AFTER_REFUND);
      check("Available lands on exactly 0.00", await available(customer), 0);
      await identity("after refund", customer);
    });

    // =====================================================================
    // SIGN CHECK — direct inserts as service_role, so the CONSTRAINT is what
    // refuses, not a privilege. Each names customer_ledger_sign_check in the
    // raise: matching it is the proof the constraint can fire.
    // =====================================================================
    const INSERT_SQL = `
      insert into public.customer_ledger (customer_id, entry_type, amount_sar, doc_number, created_by)
      values ($1, $2, $3, $4, 'DBCHK')`;
    await console.log("\n-- customer_ledger_sign_check");
    await refuses("NEGATIVE topup", INSERT_SQL, [customer, "topup", -5, "RCT-0000-000000"], "customer_ledger_sign_check");
    await refuses("POSITIVE refund", INSERT_SQL, [customer, "refund", 5, "CN-0000-000000"], "customer_ledger_sign_check");
    await refuses("ZERO correction", INSERT_SQL, [customer, "correction", 0, null], "customer_ledger_sign_check");

    // =====================================================================
    // INPUT GATES + ANON (CLAUDE.md §6).
    // =====================================================================
    console.log("\n-- input gates and grants");
    await refuses("topup of zero", TOPUP_SQL, [customer, 0, "cash", null, null, ACTOR, null], "greater than zero");
    await refuses("topup without an actor", TOPUP_SQL, [customer, 100, "cash", null, null, "  ", null], "Actor identity");
    await refuses("refund of zero", REFUND_SQL, [customer, 0, "cash", null, null, ACTOR, null], "greater than zero");
    await refuses("anon denied record_topup", TOPUP_SQL, [customer, 100, "cash", null, null, ACTOR, null], "permission denied", "anon");
    await refuses("anon denied record_refund", REFUND_SQL, [customer, 100, "cash", null, null, ACTOR, null], "permission denied", "anon");
  } finally {
    await c.query("rollback");
    await c.end();
  }

  // ---- No rows survived — measured on a FRESH connection, counters included.
  const post = new Client(conn);
  await post.connect();
  const censusAfter = (await post.query(censusSql)).rows[0];
  await post.end();
  console.log("\nCensus AFTER:  " + JSON.stringify(censusAfter));
  check("census unchanged — every row AND both counters rolled back", censusAfter, censusBefore);

  const n = failureCount();
  console.log(n === 0 ? "\nledger-check: ALL ASSERTIONS PASSED\n" : `\nledger-check: ${n} FAILURE(S)\n`);
  process.exit(n === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nledger-check crashed: " + String(e?.message ?? e));
  process.exit(1);
});
