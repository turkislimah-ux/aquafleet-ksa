// LIVE DATABASE guard for the invoice LIFECYCLE RPCs — pay_invoice,
// unpay_invoice, void_invoice.
// Run:  npm run test:db      (or: npx tsx scripts/db/invoice-lifecycle-check.ts)
// Exits 0 if every assertion passes, 1 otherwise (CI-friendly).
//
// Pass 2 of the scripts/db suite. Pass 1 (confirm-invoice-check.ts) proved the
// 0191 assertions at the FREEZE point; this proves what the three RPCs do to
// the money AFTER the freeze. Same discipline: one transaction, a savepoint per
// case, rollback in `finally`, and every guard watched failing before its green
// is believed.
//
// ===========================================================================
// THREE THINGS THE LIVE DEFINITIONS DO NOT DO, MEASURED BEFORE THIS WAS
// WRITTEN. Read these before changing an assertion — two of them are the
// opposite of what the RPC names suggest.
//
// 1. pay_invoice DOES NOT DRAW DOWN THE PREPAID POOL. It writes no ledger row
//    at all — no customer_topups insert, nothing. v_customer_prepaid_balance is
//    DERIVED: topups − delivered-trip gross − charge gross − returns, and not
//    one term of it mentions `paid`. That is Model A, deduction at DELIVERY:
//    a pool FUNDS delivered work, it does not SETTLE it. So the assertion here
//    is that paying moves the pool by EXACTLY 0.00 — and that is a real guard,
//    not a tautology: the day someone "fixes" pay_invoice by adding a ledger
//    write, the pool double-counts (once at delivery, once at payment) and this
//    case is the only thing in the repo that would notice.
//
//    The covered-vs-grand rule lives one layer up, in lib/prepaid.ts's
//    settlementGross() — the pay-with-balance figure sums the invoice's COVERED
//    items, deliberately not the stored grand_total_sar. What the database can
//    prove about it is asserted in case 1: on a split invoice the frozen
//    covered_total_sar reconciles to the covered LINES and grand_total_sar does
//    not, and the gap is the exact amount a grand-based drawdown would
//    overcharge the customer.
//
// 2. unpay_invoice DOES NOT RELEASE TRIPS. Deliberate, and unchanged since
//    0030: the trips stay reserved to the invoice; only void and delete
//    release. Asserted here so a future "symmetry" cleanup fails loudly.
//
// 3. void_invoice RELEASES TRIPS BUT NOT CHARGES — not at the FK, anyway. It
//    nulls trips.invoice_id and leaves invoice_special_charges.invoice_id
//    pointing at the void invoice. The charge is released ECONOMICALLY instead:
//    v_customer_prepaid_balance counts charges on invoices `status <> 'void'`,
//    so voiding returns the charge's gross to the pool without moving a row.
//    Both halves are asserted, because they are different mechanisms and a
//    change to either would look like the other still working.
// ===========================================================================
//
// WHAT IT ASSERTS — the refusals are half the test
//
//   case 1  pay (prepaid, 'balance')  pool unmoved; covered != grand; trips locked
//   case 2  pay (postpaid, 'cash')    amount payable −230.00 -> 0.00
//   case 3  unpay round trip          payable returns to −230.00 to the halala
//   case 4  unpay round trip          prepaid pool identical at all three points
//   case 5  void (prepaid)            trips released; pool rises by the charge gross
//   case 6  void (postpaid)           trips released; payable unchanged
//   R1..R9  every refusal the three RPCs encode
//   R10-12  anon denied on all three (CLAUDE.md section 6)
//
// NO ROWS SURVIVE. Same shape as pass 1: one transaction ending in ROLLBACK,
// asserted afterwards by a census taken on a FRESH connection.

import { Client, type QueryResult } from "pg";
import { check, connOptions, fail, failureCount, loadTestEnv, money, ok, TEST_REF } from "./harness";

// ---------------------------------------------------------------------------
// The two scenarios, and every figure this file asserts, derived once here.
//
// PREPAID customer P
//   top-up                                        500.00
//   3 delivered trips at 100.00 net, 115.00 gross 345.00 consumed at DELIVERY
//   1 special charge 50.00 net, 57.50 gross        57.50 consumed while not void
//   pool = 500.00 − 345.00 − 57.50               =  97.50
//
//   its invoice, split so covered != grand:
//     covered  1 trip        100.00 /  15.00 / 115.00
//     due      2 trips + chg 250.00 /  37.50 / 287.50
//     grand    everything    350.00 /  52.50 / 402.50
//   Tier A 100+100+100+50 = 350. Tier B 100+250 = 350, 15+37.5 = 52.5,
//   115+287.5 = 402.5. Tier C round(350 * 0.15, 2) = 52.50. All three pass.
//
// POSTPAID customer Q
//   2 delivered trips at 100.00 net, 115.00 gross
//   amount payable = −230.00 until the invoice covering them is PAID
// ---------------------------------------------------------------------------

const TRIP_NET = 100.0;
const TRIP_GROSS = 115.0;
const CHARGE_NET = 50.0;
const CHARGE_GROSS = 57.5;
const TOPUP = 500.0;

const POOL_BASE = 97.5; // 500.00 − 3*115.00 − 57.50
const POOL_AFTER_VOID = 155.0; // charge released economically: +57.50
const PAYABLE_BASE = -230.0; // −2 * 115.00
const COVERED_TOTAL = 115.0; // the figure a balance payment settles by
const GRAND_TOTAL = 402.5; // the figure it must NOT settle by
const OVERCHARGE_IF_GRAND = 287.5; // GRAND_TOTAL − COVERED_TOTAL

const PERIOD_START = "2020-01-01";
const PERIOD_END = "2020-01-31";
const TRIP_DATE = "2020-01-15";

const CONFIRM_SQL = `
  select * from public.confirm_invoice(
    $1::uuid, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb,
    $7::uuid[], $8::uuid[],
    $9::numeric, $10::numeric, $11::numeric,
    $12::numeric, $13::numeric, $14::numeric,
    $15::numeric, $16::numeric, $17::numeric,
    null, null, null, null, null, null,
    $18::text
  )`;

// Called from `from`, never as `select (f(...)).*` — a composite expanded with
// `.*` in the target list is evaluated once per output column. Pass 1 hit that
// and it read exactly like the RPC rejecting a good payload.
const PAY_SQL = `select * from public.pay_invoice($1::uuid, $2::text, $3::text, $4::text, $5::date, $6::text)`;
const UNPAY_SQL = `select * from public.unpay_invoice($1::uuid, $2::text, $3::text)`;
const VOID_SQL = `select * from public.void_invoice($1::uuid, $2::text)`;

type Row = Record<string, unknown>;
type Outcome = { row: Row | null; err: { message: string } | null };

async function main(): Promise<void> {
  const env = loadTestEnv();
  const conn = connOptions(env);

  // The expected figures below are LITERALS on purpose — deriving them from the
  // same arithmetic the view performs would assert the view against itself. But
  // a literal can be a typo, so the arithmetic is checked here, offline, before
  // a socket is opened. These fail on a bad constant, not on a bad database.
  console.log("");
  check("fixture arithmetic — POOL_BASE = topup − 3 trips − 1 charge", POOL_BASE, money(TOPUP - 3 * TRIP_GROSS - CHARGE_GROSS));
  check("fixture arithmetic — POOL_AFTER_VOID = POOL_BASE + the charge gross", POOL_AFTER_VOID, money(POOL_BASE + CHARGE_GROSS));
  check("fixture arithmetic — PAYABLE_BASE = −2 trips gross", PAYABLE_BASE, money(-2 * TRIP_GROSS));
  check("fixture arithmetic — COVERED_TOTAL = 1 trip gross", COVERED_TOTAL, TRIP_GROSS);
  check("fixture arithmetic — GRAND_TOTAL = 3 trips + 1 charge, gross", GRAND_TOTAL, money(3 * TRIP_GROSS + CHARGE_GROSS));
  check("fixture arithmetic — OVERCHARGE_IF_GRAND = GRAND − COVERED", OVERCHARGE_IF_GRAND, money(GRAND_TOTAL - COVERED_TOTAL));

  // Every table these three RPCs can touch, plus the two the seed writes.
  const censusSql = `
    select
      (select count(*) from public.customers)                   as customers,
      (select count(*) from public.projects)                    as projects,
      (select count(*) from public.trips)                       as trips,
      (select count(*) from public.invoices)                    as invoices,
      (select count(*) from public.invoice_special_charges)     as charges,
      (select count(*) from public.customer_topups)             as topups,
      (select count(*) from public.customer_balance_returns)    as returns,
      (select count(*) from public.project_commission_history)  as commission_history,
      (select coalesce(sum(next_number), 0)
         from public.invoice_number_counter)                    as counter_sum,
      (select count(*) from public.trips where invoice_id is not null) as trips_reserved`;

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

  // --- Call an RPC inside its own savepoint, as service_role. A raise aborts
  //     the transaction until something unwinds, so a refusal case that did not
  //     carry its own savepoint would poison every case after it.
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
  const pool = async (customerId: string): Promise<number> =>
    money(
      (
        await c.query(`select balance_sar from public.v_customer_prepaid_balance where customer_id = $1`, [
          customerId,
        ])
      ).rows[0].balance_sar,
    );

  const payable = async (customerId: string): Promise<number> =>
    money(
      (
        await c.query(
          `select amount_payable_sar from public.v_customer_amount_payable where customer_id = $1`,
          [customerId],
        )
      ).rows[0].amount_payable_sar,
    );

  const invStatus = async (id: string): Promise<string> =>
    (await c.query(`select status from public.invoices where id = $1`, [id])).rows[0].status;

  const reservedCount = async (invoiceId: string): Promise<number> =>
    Number(
      (await c.query(`select count(*)::int n from public.trips where invoice_id = $1`, [invoiceId]))
        .rows[0].n,
    );

  // --- A case body, run inside a savepoint and rolled back whatever happens.
  //     Rolled back even when it SUCCEEDS: every case must start from the same
  //     confirmed baseline, or a later case fails for an earlier case's reason.
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

  // --- A refusal: the call must raise, and raise for the stated reason. A
  //     refusal that lands on a DIFFERENT gate is a false green — every one of
  //     these invoices can also fail with "not in confirmed status", which
  //     would pass a bare "did it raise" check.
  async function refuses(
    label: string,
    sql: string,
    args: unknown[],
    fragment: string,
    opts: { role?: string; untouchedInvoice?: string; expectStatus?: string } = {},
  ): Promise<void> {
    const sp = `_ref_${spSeq++}`;
    await c.query(`savepoint ${sp}`);
    try {
      const r = await rpc(sql, args, opts.role ?? "service_role");
      ok(`${label}: REFUSED`, r.err !== null);
      if (r.err) {
        ok(`${label}: refused for the RIGHT reason (matched "${fragment}")`, r.err.message.includes(fragment));
        console.log(`          db said: ${r.err.message.split("\n")[0]}`);
      } else {
        console.log("          NOTHING RAISED — the refusal cannot fire, so a green run proves nothing.");
      }
      if (opts.untouchedInvoice && opts.expectStatus) {
        check(
          `${label}: refusal left the invoice untouched`,
          await invStatus(opts.untouchedInvoice),
          opts.expectStatus,
        );
      }
    } finally {
      await c.query(`rollback to savepoint ${sp}`);
      await c.query("reset role");
    }
  }

  try {
    await c.query("begin");

    // =====================================================================
    // SEED — the real dependency chain, twice: a PREPAID customer whose pool
    // this file measures, and a POSTPAID one whose amount-payable it measures.
    // Both are needed: for a prepaid customer amount_payable_sar IS the pool
    // (0139), so the pay/unpay round trip has nothing to move there.
    // =====================================================================

    async function seedCustomer(
      tag: string,
      mode: "prepaid" | "postpaid",
      tripCount: number,
    ): Promise<{ customer: string; project: string; trips: string[]; invoice: string }> {
      const customer = (
        await c.query(
          `insert into public.customers (name, customer_type)
           values ($1, 'construction') returning id`,
          [`DBCHK LIFECYCLE ${tag}`],
        )
      ).rows[0].id;

      const project = (
        await c.query(
          `insert into public.projects
             (customer_id, name, initials, default_water_station, water_type, status,
              payment_mode, rate_per_trip_sar)
           values ($1, $2, $3, 'manfuhah_station', 'potable', 'active', $4, $5) returning id`,
          [customer, `DBCHK ${tag} PROJECT`, tag.slice(0, 3), mode, TRIP_NET],
        )
      ).rows[0].id;

      const trips: string[] = [];
      for (let i = 0; i < tripCount; i++) {
        trips.push(
          (
            await c.query(
              `insert into public.trips
                 (project_id, customer_id, water_station, water_type, rate_sar, stage, trip_date, delivered_at)
               values ($1, $2, 'manfuhah_station', 'potable', $3, 'delivered', $4, now())
               returning id`,
              [project, customer, TRIP_NET, TRIP_DATE],
            )
          ).rows[0].id,
        );
      }

      const invoice = (
        await c.query(
          `insert into public.invoices (customer_id, period_start, period_end, status)
           values ($1, $2, $3, 'review') returning id`,
          [customer, PERIOD_START, PERIOD_END],
        )
      ).rows[0].id;

      return { customer, project, trips, invoice };
    }

    const P = await seedCustomer("PREPAID", "prepaid", 3);
    const Q = await seedCustomer("POSTPAID", "postpaid", 2);
    Object.assign(seeded, {
      pCustomer: P.customer, pProject: P.project, pInvoice: P.invoice,
      qCustomer: Q.customer, qProject: Q.project, qInvoice: Q.invoice,
    });

    await c.query(
      `insert into public.customer_topups (customer_id, amount_sar, topup_date, method)
       values ($1, $2, $3, 'cash')`,
      [P.customer, TOPUP, PERIOD_START],
    );

    const pCharge = (
      await c.query(
        `insert into public.invoice_special_charges (invoice_id, label, amount_sar, charge_date)
         values ($1, 'DBCHK emergency hours', $2, $3) returning id`,
        [P.invoice, CHARGE_NET, TRIP_DATE],
      )
    ).rows[0].id;

    // --- Take both invoices through the freeze point. Reusing confirm_invoice
    //     rather than writing 'confirmed' by hand is the point: a lifecycle
    //     test that hand-forged its starting row would not be testing the
    //     lifecycle.
    const pConfirm = await rpc(CONFIRM_SQL, [
      P.invoice,
      JSON.stringify({ name: "DBCHK SELLER" }),
      JSON.stringify({ name: "DBCHK BUYER P" }),
      JSON.stringify([{ kind: "trip", id: P.trips[0], amount_sar: TRIP_NET }]),
      JSON.stringify([
        { kind: "trip", id: P.trips[1], amount_sar: TRIP_NET },
        { kind: "trip", id: P.trips[2], amount_sar: TRIP_NET },
      ]),
      JSON.stringify([{ kind: "charge", id: pCharge, amount_sar: CHARGE_NET }]),
      [P.trips[0]],
      [P.trips[1], P.trips[2]],
      100.0, 15.0, 115.0,
      250.0, 37.5, 287.5,
      350.0, 52.5, 402.5,
      "prepaid",
    ]);
    if (pConfirm.err) throw new Error("prepaid seed failed to confirm: " + pConfirm.err.message);

    const qConfirm = await rpc(CONFIRM_SQL, [
      Q.invoice,
      JSON.stringify({ name: "DBCHK SELLER" }),
      JSON.stringify({ name: "DBCHK BUYER Q" }),
      JSON.stringify([]),
      JSON.stringify([
        { kind: "trip", id: Q.trips[0], amount_sar: TRIP_NET },
        { kind: "trip", id: Q.trips[1], amount_sar: TRIP_NET },
      ]),
      JSON.stringify([]),
      [],
      [Q.trips[0], Q.trips[1]],
      0, 0, 0,
      200.0, 30.0, 230.0,
      200.0, 30.0, 230.0,
      "postpaid",
    ]);
    if (qConfirm.err) throw new Error("postpaid seed failed to confirm: " + qConfirm.err.message);

    console.log("\nSeeded and confirmed: " + JSON.stringify(seeded));

    // --- Baselines. Asserted, not just recorded: if the seed does not produce
    //     these figures, every delta below is measured against the wrong thing.
    check("baseline — prepaid pool (500.00 topup − 345.00 trips − 57.50 charge)", await pool(P.customer), POOL_BASE);
    check("baseline — postpaid amount payable (−2 x 115.00)", await payable(Q.customer), PAYABLE_BASE);
    check("baseline — prepaid invoice is 'confirmed'", await invStatus(P.invoice), "confirmed");
    check("baseline — postpaid invoice is 'confirmed'", await invStatus(Q.invoice), "confirmed");
    check("baseline — no trip is reserved to the prepaid invoice yet", await reservedCount(P.invoice), 0);

    // =====================================================================
    // CASE 1 — pay_invoice on the PREPAID invoice, method 'balance'.
    // =====================================================================
    await scenario("case 1 — pay (prepaid, 'balance')", async () => {
      const before = await pool(P.customer);
      const r = await rpc(PAY_SQL, [P.invoice, "balance", null, null, PERIOD_END, "DBCHK"]);
      ok("case 1 — pay_invoice SUCCEEDED", r.err === null);
      if (r.err) return console.log(`          unexpected raise: ${r.err.message}`);

      check("case 1 — status is 'paid'", r.row!.status, "paid");
      ok("case 1 — paid_at stamped", r.row!.paid_at != null);
      check("case 1 — payment_method recorded", r.row!.payment_method, "balance");

      // THE ASSERTION THIS CASE EXISTS FOR. Model A: the pool deducted at
      // DELIVERY, so payment moves it by nothing. A ledger write added to
      // pay_invoice would double-count and land here.
      const after = await pool(P.customer);
      check("case 1 — prepaid pool UNMOVED by payment (Model A, deducts at delivery)", after, before);
      check("case 1 — pool delta is exactly 0.00", money(after - before), 0);

      // The covered-vs-grand rule, in the form the database can prove: the
      // frozen covered total reconciles to the COVERED LINES, and the grand
      // total does not. settlementGross() sums those same lines.
      const sums = (
        await c.query(
          `select round(coalesce(sum(round((e->>'amount_sar')::numeric * (1 + public.vat_rate()), 2)), 0), 2) covered_lines_gross,
                  max(i.covered_total_sar) covered_total, max(i.grand_total_sar) grand_total
             from public.invoices i
             left join lateral jsonb_array_elements(i.covered_lines) e on true
            where i.id = $1`,
          [P.invoice],
        )
      ).rows[0];
      check("case 1 — covered_total_sar equals the gross of the COVERED lines", money(sums.covered_total), money(sums.covered_lines_gross));
      check("case 1 — covered_total_sar is 115.00", money(sums.covered_total), COVERED_TOTAL);
      check("case 1 — grand_total_sar is 402.50, a DIFFERENT figure", money(sums.grand_total), GRAND_TOTAL);
      ok("case 1 — the two totals genuinely differ, so the case discriminates", money(sums.grand_total) !== money(sums.covered_total));
      check(
        "case 1 — settling by grand instead of covered would overcharge by 287.50",
        money(Number(sums.grand_total) - Number(sums.covered_total)),
        OVERCHARGE_IF_GRAND,
      );

      // 0027: BOTH lists lock, covered and unpaid alike.
      check("case 1 — all 3 trips locked to the invoice (covered AND unpaid)", await reservedCount(P.invoice), 3);
    });

    // =====================================================================
    // CASE 2 — pay_invoice on the POSTPAID invoice, method 'cash'.
    // =====================================================================
    await scenario("case 2 — pay (postpaid, 'cash')", async () => {
      check("case 2 — payable before payment", await payable(Q.customer), PAYABLE_BASE);
      const r = await rpc(PAY_SQL, [Q.invoice, "cash", null, "DBCHK-REF", PERIOD_END, null]);
      ok("case 2 — pay_invoice SUCCEEDED", r.err === null);
      if (r.err) return console.log(`          unexpected raise: ${r.err.message}`);
      check("case 2 — status is 'paid'", r.row!.status, "paid");
      check("case 2 — amount payable settles to 0.00", await payable(Q.customer), 0);
      check("case 2 — both trips locked to the invoice", await reservedCount(Q.invoice), 2);
    });

    // =====================================================================
    // CASE 3 — pay -> unpay is IDENTITY on the postpaid payable.
    // =====================================================================
    await scenario("case 3 — unpay round trip (postpaid payable)", async () => {
      const before = await payable(Q.customer);
      const paid = await rpc(PAY_SQL, [Q.invoice, "cash", null, "DBCHK-REF", PERIOD_END, null]);
      ok("case 3 — pay leg SUCCEEDED", paid.err === null);
      const mid = await payable(Q.customer);
      check("case 3 — payable is 0.00 while paid", mid, 0);

      const un = await rpc(UNPAY_SQL, [Q.invoice, "DBCHK reason", "DBCHK operator"]);
      ok("case 3 — unpay leg SUCCEEDED", un.err === null);
      if (un.err) return console.log(`          unexpected raise: ${un.err.message}`);

      const after = await payable(Q.customer);
      check("case 3 — payable returns to the pre-pay figure, to the halala", after, before);
      ok("case 3 — the round trip actually moved something in between", mid !== before);

      check("case 3 — status back to 'confirmed'", un.row!.status, "confirmed");
      check("case 3 — paid_at cleared", un.row!.paid_at, null);
      check("case 3 — payment_method cleared", un.row!.payment_method, null);
      check("case 3 — payment_reference cleared", un.row!.payment_reference, null);
      ok("case 3 — unpaid_at stamped", un.row!.unpaid_at != null);
      check("case 3 — unpaid_reason recorded", un.row!.unpaid_reason, "DBCHK reason");
      check("case 3 — unpaid_by recorded", un.row!.unpaid_by, "DBCHK operator");

      // 0030: unpay does NOT release. Only void and delete do.
      check("case 3 — trips stay RESERVED after unpay (0030 — only void releases)", await reservedCount(Q.invoice), 2);
    });

    // =====================================================================
    // CASE 4 — the same round trip against the PREPAID pool.
    // =====================================================================
    await scenario("case 4 — unpay round trip (prepaid pool)", async () => {
      const before = await pool(P.customer);
      await rpc(PAY_SQL, [P.invoice, "balance", null, null, PERIOD_END, null]);
      const mid = await pool(P.customer);
      const un = await rpc(UNPAY_SQL, [P.invoice, "DBCHK reason", "DBCHK operator"]);
      ok("case 4 — unpay SUCCEEDED", un.err === null);
      const after = await pool(P.customer);
      check("case 4 — pool at baseline before", before, POOL_BASE);
      check("case 4 — pool unchanged while paid", mid, POOL_BASE);
      check("case 4 — pool unchanged after unpay", after, POOL_BASE);
      check("case 4 — round trip is identity on the pool", after, before);
      check("case 4 — status back to 'confirmed'", await invStatus(P.invoice), "confirmed");
    });

    // =====================================================================
    // CASE 5 — void_invoice on the PREPAID invoice. Two different release
    // mechanisms, asserted separately.
    // =====================================================================
    await scenario("case 5 — void (prepaid): trips released, charge released economically", async () => {
      // Lock the trips first, so the release is visible as a change rather
      // than as a state that was never set.
      await rpc(PAY_SQL, [P.invoice, "balance", null, null, PERIOD_END, null]);
      await rpc(UNPAY_SQL, [P.invoice, "DBCHK", "DBCHK"]);
      check("case 5 — 3 trips reserved before the void", await reservedCount(P.invoice), 3);
      const before = await pool(P.customer);
      check("case 5 — pool at baseline before the void", before, POOL_BASE);

      const r = await rpc(VOID_SQL, [P.invoice, "DBCHK void reason"]);
      ok("case 5 — void_invoice SUCCEEDED", r.err === null);
      if (r.err) return console.log(`          unexpected raise: ${r.err.message}`);

      check("case 5 — status is 'void'", r.row!.status, "void");
      ok("case 5 — voided_at stamped", r.row!.voided_at != null);
      check("case 5 — void_reason recorded", r.row!.void_reason, "DBCHK void reason");

      // Mechanism 1: trips.invoice_id nulled — the row moves.
      check("case 5 — every trip RELEASED (invoice_id nulled, re-pickable)", await reservedCount(P.invoice), 0);
      const free = Number(
        (
          await c.query(
            `select count(*)::int n from public.trips where project_id = $1 and invoice_id is null`,
            [P.project],
          )
        ).rows[0].n,
      );
      check("case 5 — all 3 trips are free for a later invoice", free, 3);

      // Mechanism 2: the CHARGE row does not move. It is released by the
      // pool's `status <> 'void'` filter instead.
      const stillAttached = Number(
        (
          await c.query(`select count(*)::int n from public.invoice_special_charges where invoice_id = $1`, [
            P.invoice,
          ])
        ).rows[0].n,
      );
      check("case 5 — the charge row still points at the void invoice (no FK move)", stillAttached, 1);
      const after = await pool(P.customer);
      check("case 5 — pool rises to 155.00 (the charge leaves consumption)", after, POOL_AFTER_VOID);
      check("case 5 — the rise is exactly the charge's gross, 57.50", money(after - before), CHARGE_GROSS);
    });

    // =====================================================================
    // CASE 6 — void on the POSTPAID invoice.
    // =====================================================================
    await scenario("case 6 — void (postpaid): trips released, payable unchanged", async () => {
      await rpc(PAY_SQL, [Q.invoice, "cash", null, "DBCHK-REF", PERIOD_END, null]);
      await rpc(UNPAY_SQL, [Q.invoice, "DBCHK", "DBCHK"]);
      check("case 6 — 2 trips reserved before the void", await reservedCount(Q.invoice), 2);

      const r = await rpc(VOID_SQL, [Q.invoice, "DBCHK void reason"]);
      ok("case 6 — void_invoice SUCCEEDED", r.err === null);
      if (r.err) return console.log(`          unexpected raise: ${r.err.message}`);
      check("case 6 — status is 'void'", r.row!.status, "void");
      check("case 6 — both trips RELEASED", await reservedCount(Q.invoice), 0);
      // The work was delivered and never paid for, so voiding the document
      // does not make the money go away.
      check("case 6 — payable is still −230.00: voiding a document unbills, it does not forgive", await payable(Q.customer), PAYABLE_BASE);
    });

    // =====================================================================
    // REFUSALS. Every guard the three RPCs encode, each proven to fire for
    // its own reason.
    // =====================================================================
    console.log("\n-- refusals");

    await refuses("R1 pay — invalid payment method", PAY_SQL,
      [P.invoice, "cheque", null, null, PERIOD_END, null],
      "Invalid payment method", { untouchedInvoice: P.invoice, expectStatus: "confirmed" });

    await refuses("R2 pay — bank_transfer with no proof file", PAY_SQL,
      [Q.invoice, "bank_transfer", null, "REF", PERIOD_END, null],
      "requires a proof-of-payment file", { untouchedInvoice: Q.invoice, expectStatus: "confirmed" });

    await refuses("R3 pay — bank_transfer with no reference", PAY_SQL,
      [Q.invoice, "bank_transfer", "proof/path.jpg", null, PERIOD_END, null],
      "requires a payment reference");

    await refuses("R4 pay — bank_transfer with no payment date", PAY_SQL,
      [Q.invoice, "bank_transfer", "proof/path.jpg", "REF", null, null],
      "requires a payment date");

    // The 0134 guard: 'balance' resolves the mode through the invoice snapshot,
    // else the customer's projects. Q is postpaid on both.
    await refuses("R5 pay — 'balance' on a POSTPAID invoice", PAY_SQL,
      [Q.invoice, "balance", null, null, PERIOD_END, null],
      "balance payment is only valid for prepaid invoices",
      { untouchedInvoice: Q.invoice, expectStatus: "confirmed" });

    await scenario("R6 pay — an ALREADY-PAID invoice", async () => {
      const first = await rpc(PAY_SQL, [Q.invoice, "cash", null, "REF", PERIOD_END, null]);
      ok("R6 — the first payment succeeded (so the second is the thing refused)", first.err === null);
      const second = await rpc(PAY_SQL, [Q.invoice, "cash", null, "REF", PERIOD_END, null]);
      ok("R6 — the second payment REFUSED", second.err !== null);
      if (second.err) {
        ok("R6 — refused for the RIGHT reason", second.err.message.includes("not in confirmed status"));
        console.log(`          db said: ${second.err.message.split("\n")[0]}`);
      }
    });

    await refuses("R7 unpay — an invoice that is CONFIRMED, not paid", UNPAY_SQL,
      [Q.invoice, "DBCHK", "DBCHK"], "not in paid status",
      { untouchedInvoice: Q.invoice, expectStatus: "confirmed" });

    await scenario("R7b unpay — an invoice that is VOID", async () => {
      await rpc(VOID_SQL, [Q.invoice, "DBCHK"]);
      const r = await rpc(UNPAY_SQL, [Q.invoice, "DBCHK", "DBCHK"]);
      ok("R7b — REFUSED", r.err !== null);
      if (r.err) {
        ok("R7b — refused for the RIGHT reason", r.err.message.includes("not in paid status"));
        console.log(`          db said: ${r.err.message.split("\n")[0]}`);
      }
    });

    // The lifecycle rule 0182's hint states: unpay first, then void.
    await scenario("R8 void — a PAID invoice (must unpay first)", async () => {
      const paid = await rpc(PAY_SQL, [Q.invoice, "cash", null, "REF", PERIOD_END, null]);
      ok("R8 — the invoice really is paid before the void attempt", paid.err === null);
      const r = await rpc(VOID_SQL, [Q.invoice, "DBCHK"]);
      ok("R8 — void REFUSED on a paid invoice", r.err !== null);
      if (r.err) {
        ok("R8 — refused for the RIGHT reason", r.err.message.includes("not in confirmed status"));
        console.log(`          db said: ${r.err.message.split("\n")[0]}`);
      }
      check("R8 — the invoice is still 'paid', not half-voided", await invStatus(Q.invoice), "paid");
    });

    await scenario("R9 void — an ALREADY-VOID invoice", async () => {
      const first = await rpc(VOID_SQL, [Q.invoice, "DBCHK"]);
      ok("R9 — the first void succeeded (so the second is the thing refused)", first.err === null);
      const second = await rpc(VOID_SQL, [Q.invoice, "DBCHK"]);
      ok("R9 — the second void REFUSED", second.err !== null);
      if (second.err) {
        ok("R9 — refused for the RIGHT reason", second.err.message.includes("not in confirmed status"));
        console.log(`          db said: ${second.err.message.split("\n")[0]}`);
      }
    });

    // CLAUDE.md section 6. `create or replace function` resets the ACL to
    // EXECUTE TO PUBLIC and anon inherits PUBLIC; the anon key ships in the
    // client bundle. These are the read-backs that notice the next
    // redefinition forgetting to re-revoke.
    await refuses("R10 anon — pay_invoice", PAY_SQL,
      [Q.invoice, "cash", null, "REF", PERIOD_END, null],
      "permission denied for function pay_invoice", { role: "anon" });
    await refuses("R11 anon — unpay_invoice", UNPAY_SQL,
      [Q.invoice, "DBCHK", "DBCHK"],
      "permission denied for function unpay_invoice", { role: "anon" });
    await refuses("R12 anon — void_invoice", VOID_SQL,
      [Q.invoice, "DBCHK"],
      "permission denied for function void_invoice", { role: "anon" });
  } finally {
    await c.query("rollback");
    await c.end();
  }

  // ---- ZERO-LEAK, on a FRESH connection so it cannot read its own
  //      uncommitted transaction.
  const post = new Client(conn);
  await post.connect();
  const censusAfter = (await post.query(censusSql)).rows[0];
  console.log("\nCensus AFTER:  " + JSON.stringify(censusAfter));
  for (const k of Object.keys(censusBefore)) {
    check(`zero-leak — ${k} unchanged`, censusAfter[k], censusBefore[k]);
  }

  const leaked = (
    await post.query(
      `select 'customer' k, id from public.customers where id = any($1::uuid[])
       union all select 'project', id from public.projects where id = any($2::uuid[])
       union all select 'invoice', id from public.invoices where id = any($3::uuid[])`,
      [
        [seeded.pCustomer, seeded.qCustomer],
        [seeded.pProject, seeded.qProject],
        [seeded.pInvoice, seeded.qInvoice],
      ],
    )
  ).rows;
  check("zero-leak — none of the seeded ids survive", leaked, []);

  const stray = (
    await post.query(
      `select count(*)::int n from public.invoices where period_start = $1 and period_end = $2`,
      [PERIOD_START, PERIOD_END],
    )
  ).rows[0].n;
  check("zero-leak — no invoice survives on the harness period", stray, 0);
  await post.end();

  console.log("");
  const failures = failureCount();
  if (failures === 0) {
    console.log("All invoice-lifecycle DB checks PASSED ✓ — every refusal fired, nothing leaked.");
    process.exit(0);
  } else {
    console.log(`${failures} invoice-lifecycle DB check(s) FAILED ✗`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\nHARNESS ERROR — the run did not complete, so nothing is proven:\n", e);
  process.exit(1);
});
