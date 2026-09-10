// LIVE DATABASE guard for the INVENTORY money path — FIFO lot consumption,
// add_price_lot, and the return_customer_balance refund gate.
// Run:  npm run test:db   (or: npx tsx scripts/db/inventory-money-check.ts)
// Exits 0 if every assertion passes, 1 otherwise (CI-friendly).
//
// Pass 3, and the last of the scripts/db suite. Pass 1 pinned confirm_invoice at
// the freeze point, pass 2 pinned pay/unpay/void after it; this one pins the
// money the CUSTOMER-facing engine never touches. Inventory cost is internal —
// no VAT, no prepaid ledger — so it has its own arithmetic and its own way of
// going wrong, and FIFO is the part of it that decides what a repair COST.
//
// ===========================================================================
// ENTER FROM THE TOP. The TS layer never names the inner three functions: it
// calls start_work_order, which calls deduct_work_order_parts, which calls
// consume_work_order_line per line, which records the per-lot split and then
// calls consume_from_lots for THE ONLY FORWARD STOCK WRITE. A harness that
// called consume_from_lots directly and stopped there would prove the walk
// orders correctly and prove nothing about the figure that reaches the work
// order. Every FIFO case here goes in through start_work_order. Case 4 adds a
// direct consume_from_lots call ON TOP, because the two functions carry their
// own copy of the ORDER BY and a drift between them is exactly the bug that
// would survive testing only the wrapper.
//
// THE FIXTURE IS BUILT TO DISCRIMINATE. Three lots whose received_on order,
// created_at order and price order are all DIFFERENT from each other:
//
//   inserted 1st   L_NEW   received 2020-03-01   4 @ 30.00   newest, cheapest
//   inserted 2nd   L_OLD   received 2020-01-01   6 @ 50.00   oldest, dearest
//   inserted 3rd   L_MID   received 2020-02-01   5 @ 40.00
//
// Consuming 9 therefore has three different right-looking answers, and only
// one correct one:
//
//   by received_on (CORRECT)  6 @ 50.00 + 3 @ 40.00  = 420.00
//   by created_at             4 @ 30.00 + 5 @ 50.00  = 370.00
//   by price, cheapest first  4 @ 30.00 + 5 @ 40.00  = 320.00
//
// A fixture where those coincide would pass under all three rules. The suite
// asserts the three orderings genuinely differ before it asserts the outcome,
// so the discrimination is proven rather than assumed.
//
// ===========================================================================
// TWO THINGS MEASURED HERE THAT THE ERROR TEXT DOES NOT ADMIT
//
// 1. THE DRIFT GUARD EXISTS TWICE, WITH TWO DIFFERENT MESSAGES, AND THE OUTER
//    ONE FIRES FIRST. consume_work_order_line walks the lots to record the
//    split BEFORE consume_from_lots walks them to decrement, so on the work
//    order path it is the OUTER guard that raises —
//      'Price-lot ledger is short for work order % — qty_on_hand and lots have drifted.'
//    and consume_from_lots' own
//      'Price-lot ledger is short by % for part %; qty_on_hand and lots have drifted.'
//    is only reachable by calling it directly. Both are asserted, separately,
//    because a change that removed either would leave the other still green.
//
// 2. ON THE WORK ORDER PATH, AN OVER-REQUEST IS REPORTED AS DRIFT. Ask a work
//    order for more than exists and the outer loop runs out of lots first, so
//    the operator is told the ledger has drifted when in fact the stock is
//    simply not there. consume_from_lots' honest 'Not enough stock on hand'
//    never gets a chance to fire. Asserted as measured, not as it ought to
//    read — this file records behavior; changing the message is separate work.
//
// 3. return_customer_balance's ALREADY-REFUNDED GUARD DOES NOT FIRE ON AN
//    ORDINARY DOUBLE REFUND. It sits BEHIND the amount-is-positive guard, and
//    the first refund is itself subtracted from the balance, so a second call
//    straight after the first is turned away by
//      'This customer holds no balance to return.'
//    and never reaches
//      'This customer''s balance has already been returned.'
//    The already-returned guard is reachable in exactly ONE shape: the customer
//    is refunded and then FUNDED AGAIN. That is also the only shape in which it
//    is load-bearing — with money back in the pool, nothing else stands between
//    a second call and a second cash payout. B5 pins the ordering, B6 pins the
//    guard itself. Neither alone proves the double-payout is closed.
// ===========================================================================
//
// WHAT IT ASSERTS
//
//   baseline   add_price_lot: qty, unit cost, movement rows, lot ORDERING
//   case 1     FIFO spanning two lots, per-lot COST asserted, not just qty
//   case 2     a consume landing exactly on a lot boundary
//   case 3     a consume spanning all three lots; on-hand == sum(remaining)
//   case 4     consume_from_lots direct — its own ORDER BY, not the wrapper's
//   case 5     return_customer_balance succeeds for an archived creditor
//   F1..F6     stock and drift refusals
//   A1..A3     add_price_lot input refusals
//   B1..B6     the refund gate, including the DEBTOR case
//   R1..R6     anon denied on every function in the chain
//
// NO ROWS SURVIVE. One transaction ending in ROLLBACK, asserted afterwards by
// a census taken on a FRESH connection.

import { Client, type QueryResult } from "pg";
import { check, connOptions, fail, failureCount, loadTestEnv, money, ok, TEST_REF } from "./harness";

// --- The three lots. Named by AGE, since age is what FIFO sorts on.
const L_OLD = { received: "2020-01-01", price: 50.0, qty: 6.0 };
const L_MID = { received: "2020-02-01", price: 40.0, qty: 5.0 };
const L_NEW = { received: "2020-03-01", price: 30.0, qty: 4.0 };
const ON_HAND = 15.0; // 4 + 6 + 5

// --- Case 1: consume 9. 6 from L_OLD, 3 from L_MID.
const C1_QTY = 9.0;
const C1_COST = 420.0; // 6*50.00 + 3*40.00
const C1_WEIGHTED = 46.67; // 420.00 / 9, into numeric(12,2)
const C1_COST_IF_CREATED_AT = 370.0; // 4*30.00 + 5*50.00
const C1_COST_IF_CHEAPEST = 320.0; // 4*30.00 + 5*40.00

// --- Case 3: consume 12. All of L_OLD and L_MID, 1 of L_NEW.
const C3_QTY = 12.0;
const C3_WEIGHTED = 44.17; // (300 + 200 + 30) / 12

// --- The refund fixtures.
const TRIP_NET = 100.0;
const TRIP_GROSS = 115.0;
const TOPUP = 500.0;
const REFUNDABLE = 385.0; // 500.00 − 115.00
const DEBTOR_BALANCE = -115.0; // one delivered trip, no top-up
const TRIP_DATE = "2020-01-15";

const ADD_LOT_SQL = `select * from public.add_price_lot($1::uuid, $2::numeric, $3::numeric, $4::date, $5::text, $6::text)`;
const START_WO_SQL = `select * from public.start_work_order($1::uuid, $2::text)`;
const CONSUME_SQL = `select * from public.consume_from_lots($1::uuid, $2::numeric, $3::text, $4::text)`;
const CONSUME_LINE_SQL = `select * from public.consume_work_order_line($1::uuid, $2::numeric, $3::text)`;
const DEDUCT_SQL = `select * from public.deduct_work_order_parts($1::uuid, $2::text)`;
const RETURN_SQL = `select * from public.return_customer_balance($1::uuid, $2::text, $3::text, $4::text, $5::date, $6::text, $7::text)`;

type Row = Record<string, unknown>;
type Outcome = { row: Row | null; err: { message: string } | null };

async function main(): Promise<void> {
  const env = loadTestEnv();
  const conn = connOptions(env);

  // Offline first: the expected figures are literals so they cannot be derived
  // from the same arithmetic they are testing, but a literal can be a typo.
  console.log("");
  check("fixture arithmetic — ON_HAND is the three lots", ON_HAND, money(L_OLD.qty + L_MID.qty + L_NEW.qty));
  check("fixture arithmetic — C1_COST is 6 at 50.00 plus 3 at 40.00", C1_COST, money(6 * L_OLD.price + 3 * L_MID.price));
  check("fixture arithmetic — C1_WEIGHTED is C1_COST over C1_QTY at 2dp", C1_WEIGHTED, money(C1_COST / C1_QTY));
  check("fixture arithmetic — C3_WEIGHTED is the three-lot blend", C3_WEIGHTED, money((6 * L_OLD.price + 5 * L_MID.price + 1 * L_NEW.price) / C3_QTY));
  check("fixture arithmetic — REFUNDABLE is the top-up less one trip gross", REFUNDABLE, money(TOPUP - TRIP_GROSS));
  check("fixture arithmetic — DEBTOR_BALANCE is one trip gross, owed", DEBTOR_BALANCE, money(-TRIP_GROSS));
  ok("fixture discriminates — the three candidate costs are all different",
    new Set([C1_COST, C1_COST_IF_CREATED_AT, C1_COST_IF_CHEAPEST]).size === 3);

  const censusSql = `
    select
      (select count(*) from public.warehouses)                    as warehouses,
      (select count(*) from public.parts)                         as parts,
      (select count(*) from public.price_lots)                    as price_lots,
      (select count(*) from public.stock_movements)               as stock_movements,
      (select count(*) from public.trucks)                        as trucks,
      (select count(*) from public.staff)                         as staff,
      (select count(*) from public.work_orders)                   as work_orders,
      (select count(*) from public.work_order_parts)              as work_order_parts,
      (select count(*) from public.work_order_part_consumptions)  as wo_consumptions,
      (select count(*) from public.customers)                     as customers,
      (select count(*) from public.projects)                      as projects,
      (select count(*) from public.trips)                         as trips,
      (select count(*) from public.customer_topups)               as topups,
      (select count(*) from public.customer_balance_returns)      as balance_returns,
      (select coalesce(sum(qty_on_hand), 0) from public.parts)    as total_on_hand,
      (select coalesce(sum(qty_remaining), 0) from public.price_lots) as total_remaining`;

  const pre = new Client(conn);
  await pre.connect();
  ok(`pg connected to a host naming ${TEST_REF}`, String((pre as unknown as { host: string }).host).includes(TEST_REF));
  const censusBefore = (await pre.query(censusSql)).rows[0];
  await pre.end();
  console.log("\nCensus BEFORE: " + JSON.stringify(censusBefore));

  const c = new Client(conn);
  await c.connect();
  const seeded: Record<string, string> = {};

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

  // --- Read-backs.
  const onHand = async (partId: string): Promise<number> =>
    money((await c.query(`select qty_on_hand from public.parts where id = $1`, [partId])).rows[0].qty_on_hand);

  const unitCost = async (partId: string): Promise<number> =>
    money((await c.query(`select unit_cost_sar from public.parts where id = $1`, [partId])).rows[0].unit_cost_sar);

  const lotsRemaining = async (partId: string): Promise<number> =>
    money(
      (await c.query(`select coalesce(sum(qty_remaining), 0) s from public.price_lots where part_id = $1`, [partId]))
        .rows[0].s,
    );

  // Every lot for the part, oldest received_on first — the order FIFO must use.
  const lotState = async (partId: string): Promise<{ received: string; price: number; remaining: number }[]> =>
    (
      await c.query(
        `select to_char(received_on, 'YYYY-MM-DD') received, price_sar, qty_remaining
           from public.price_lots where part_id = $1 order by received_on asc, created_at asc`,
        [partId],
      )
    ).rows.map((r) => ({ received: r.received, price: money(r.price_sar), remaining: money(r.qty_remaining) }));

  // The per-lot SPLIT the work order recorded: which lot, how much, at what
  // cost. This is the money assertion — a quantity-only check passes on a walk
  // that took the right amounts from the wrong lots.
  const splitFor = async (woPartId: string): Promise<{ received: string; qty: number; unit: number }[]> =>
    (
      await c.query(
        `select to_char(l.received_on, 'YYYY-MM-DD') received, wc.qty, wc.unit_price_sar
           from public.work_order_part_consumptions wc
           join public.price_lots l on l.id = wc.price_lot_id
          where wc.work_order_part_id = $1 and wc.direction = 'consume'
          order by wc.created_at asc, l.received_on asc`,
        [woPartId],
      )
    ).rows.map((r) => ({ received: r.received, qty: money(r.qty), unit: money(r.unit_price_sar) }));

  const woPartPrice = async (woPartId: string): Promise<number> =>
    money((await c.query(`select unit_price_sar from public.work_order_parts where id = $1`, [woPartId])).rows[0].unit_price_sar);

  const balance = async (customerId: string): Promise<number> =>
    money(
      (await c.query(`select balance_sar from public.v_customer_prepaid_balance where customer_id = $1`, [customerId]))
        .rows[0].balance_sar,
    );

  const payable = async (customerId: string): Promise<number> =>
    money(
      (
        await c.query(`select amount_payable_sar from public.v_customer_amount_payable where customer_id = $1`, [
          customerId,
        ])
      ).rows[0].amount_payable_sar,
    );

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

  // A refusal must raise AND raise for its own stated reason. Four of the
  // refusals below can also fail with a DIFFERENT message from the same
  // functions, so a bare did-it-raise check would go green on the wrong gate.
  async function refuses(
    label: string,
    sql: string,
    args: unknown[],
    fragment: string,
    opts: { role?: string; part?: string; expectOnHand?: number } = {},
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
      // A refusal mid-walk must leave no half-applied decrements behind.
      if (opts.part && opts.expectOnHand !== undefined) {
        check(`${label}: stock untouched by the refusal`, await onHand(opts.part), opts.expectOnHand);
        check(`${label}: lots untouched by the refusal`, await lotsRemaining(opts.part), ON_HAND);
      }
    } finally {
      await c.query(`rollback to savepoint ${sp}`);
      await c.query("reset role");
    }
  }

  try {
    await c.query("begin");

    // =====================================================================
    // SEED — warehouse, part, truck, mechanic, and four work orders sized for
    // the four consumption shapes. Lots are added through add_price_lot, not
    // by INSERT: the input side of FIFO is part of what this file tests, and a
    // hand-inserted lot would skip the qty_on_hand and unit_cost_sar writes
    // that make the later assertions mean anything.
    // =====================================================================

    const warehouse = (
      await c.query(`insert into public.warehouses (name, active) values ('DBCHK WAREHOUSE', true) returning id`)
    ).rows[0].id;

    const part = (
      await c.query(
        `insert into public.parts (sku, name, unit, qty_on_hand, warehouse_id, active)
         values ('DBCHK-SKU-FIFO', 'DBCHK FIFO part', 'ea', 0, $1, true) returning id`,
        [warehouse],
      )
    ).rows[0].id;

    const truck = (
      await c.query(
        `insert into public.trucks (plate, status, active) values ('DBCHK-0001', 'idle', true) returning id`,
      )
    ).rows[0].id;

    const mechanic = (
      await c.query(
        `insert into public.staff (name, role, active) values ('DBCHK MECHANIC', 'mechanic', true) returning id`,
      )
    ).rows[0].id;

    async function seedWorkOrder(num: string, qty: number): Promise<{ wo: string; line: string }> {
      const wo = (
        await c.query(
          `insert into public.work_orders
             (wo_number, truck_id, type, priority, status, title, title_ar, due_by, assigned_mechanic_id)
           values ($1, $2, 'corrective', 'medium', 'open', 'DBCHK', 'DBCHK', now() + interval '1 day', $3)
           returning id`,
          [num, truck, mechanic],
        )
      ).rows[0].id;
      const line = (
        await c.query(
          `insert into public.work_order_parts (work_order_id, part_id, qty, unit_price_sar)
           values ($1, $2, $3, 0) returning id`,
          [wo, part, qty],
        )
      ).rows[0].id;
      return { wo, line };
    }

    const WO_A = await seedWorkOrder("DBCHK-WO-A", C1_QTY); //  9 — spans two lots
    const WO_B = await seedWorkOrder("DBCHK-WO-B", L_OLD.qty); //  6 — exact boundary
    const WO_C = await seedWorkOrder("DBCHK-WO-C", C3_QTY); // 12 — spans all three
    const WO_D = await seedWorkOrder("DBCHK-WO-D", 99.0); // 99 — over-request

    Object.assign(seeded, { warehouse, part, truck, mechanic, woA: WO_A.wo, woB: WO_B.wo, woC: WO_C.wo, woD: WO_D.wo });

    // --- add_price_lot, three times, in an order that is NOT received_on order.
    console.log("\n-- baseline: add_price_lot (the input side of FIFO)");
    const lotIds: Record<string, string> = {};
    let running = 0;
    for (const [name, lot] of [["L_NEW", L_NEW], ["L_OLD", L_OLD], ["L_MID", L_MID]] as const) {
      const r = await rpc(ADD_LOT_SQL, [part, lot.price, lot.qty, lot.received, `DBCHK ${name}`, "DBCHK"]);
      if (r.err) throw new Error(`${name} failed to land: ${r.err.message}`);
      lotIds[name] = r.row!.add_price_lot as string;
      running = money(running + lot.qty);
      ok(`baseline — ${name} returned a lot id`, typeof lotIds[name] === "string" && lotIds[name].length === 36);
      check(`baseline — qty_on_hand accumulates to ${running} after ${name}`, await onHand(part), running);
      check(`baseline — unit_cost_sar tracks the lot just received (${name})`, await unitCost(part), lot.price);
    }
    check("baseline — on hand is the sum of the three lots", await onHand(part), ON_HAND);
    check("baseline — sum(qty_remaining) agrees with qty_on_hand", await lotsRemaining(part), ON_HAND);

    const movements = (
      await c.query(
        `select movement_type, qty_delta, qty_after from public.stock_movements
          where part_id = $1 order by created_at asc`,
        [part],
      )
    ).rows.map((r) => ({ t: r.movement_type, d: money(r.qty_delta), after: money(r.qty_after) }));
    check("baseline — three receive_lot movements, each stamped with the running total", movements, [
      { t: "receive_lot", d: 4, after: 4 },
      { t: "receive_lot", d: 6, after: 10 },
      { t: "receive_lot", d: 5, after: 15 },
    ]);

    // --- The ordering claim the whole file rests on. Asserted, not assumed.
    const byReceived = (await lotState(part)).map((l) => l.received);
    const byCreated = (
      await c.query(
        `select to_char(received_on, 'YYYY-MM-DD') d from public.price_lots
          where part_id = $1 order by created_at asc`,
        [part],
      )
    ).rows.map((r) => r.d);
    const byPrice = (
      await c.query(
        `select to_char(received_on, 'YYYY-MM-DD') d from public.price_lots
          where part_id = $1 order by price_sar asc`,
        [part],
      )
    ).rows.map((r) => r.d);
    check("baseline — received_on order is oldest first", byReceived, ["2020-01-01", "2020-02-01", "2020-03-01"]);
    check("baseline — created_at order is DIFFERENT (insertion order)", byCreated, ["2020-03-01", "2020-01-01", "2020-02-01"]);
    check("baseline — cheapest-first order is DIFFERENT again", byPrice, ["2020-03-01", "2020-02-01", "2020-01-01"]);
    ok("baseline — so a FIFO bug cannot hide behind a coincidence in the fixture",
      JSON.stringify(byReceived) !== JSON.stringify(byCreated) && JSON.stringify(byReceived) !== JSON.stringify(byPrice));

    // --- Customers for the refund gate.
    async function seedCustomer(
      tag: string,
      mode: "prepaid" | "postpaid",
      opts: { archived: boolean; topup: number; trips: number },
    ): Promise<string> {
      const customer = (
        await c.query(
          `insert into public.customers (name, customer_type, archived_at)
           values ($1, 'construction', $2) returning id`,
          [`DBCHK INV ${tag}`, opts.archived ? new Date().toISOString() : null],
        )
      ).rows[0].id;
      const project = (
        await c.query(
          `insert into public.projects
             (customer_id, name, initials, default_water_station, water_type, status, payment_mode, rate_per_trip_sar)
           values ($1, $2, $3, 'manfuhah_station', 'potable', 'active', $4, $5) returning id`,
          [customer, `DBCHK ${tag}`, tag.slice(0, 3), mode, TRIP_NET],
        )
      ).rows[0].id;
      for (let i = 0; i < opts.trips; i++) {
        await c.query(
          `insert into public.trips
             (project_id, customer_id, water_station, water_type, rate_sar, stage, trip_date, delivered_at)
           values ($1, $2, 'manfuhah_station', 'potable', $3, 'delivered', $4, now())`,
          [project, customer, TRIP_NET, TRIP_DATE],
        );
      }
      if (opts.topup > 0) {
        await c.query(
          `insert into public.customer_topups (customer_id, amount_sar, topup_date, method)
           values ($1, $2, $3, 'cash')`,
          [customer, opts.topup, TRIP_DATE],
        );
      }
      return customer;
    }

    // CREDITOR   archived, holds real money      → the one legal refund
    // DEBTOR     archived, OWES money            → the guard that matters
    // LIVE       holds money but NOT archived    → wrong lifecycle stage
    // POSTPAID   archived, unpaid delivered work → payable is <= 0 by construction
    const CREDITOR = await seedCustomer("CREDITOR", "prepaid", { archived: true, topup: TOPUP, trips: 1 });
    const DEBTOR = await seedCustomer("DEBTOR", "prepaid", { archived: true, topup: 0, trips: 1 });
    const LIVE = await seedCustomer("LIVE", "prepaid", { archived: false, topup: TOPUP, trips: 1 });
    const POSTPAID = await seedCustomer("POSTPAID", "postpaid", { archived: true, topup: 0, trips: 1 });
    Object.assign(seeded, { creditor: CREDITOR, debtor: DEBTOR, live: LIVE, postpaid: POSTPAID });

    console.log("\n-- baseline: the refund fixtures");
    check("baseline — creditor holds 385.00", await balance(CREDITOR), REFUNDABLE);
    check("baseline — creditor's payable mirrors the balance (0139, prepaid arm)", await payable(CREDITOR), REFUNDABLE);
    check("baseline — DEBTOR is at −115.00, i.e. owes us", await payable(DEBTOR), DEBTOR_BALANCE);
    ok("baseline — the debtor case is genuinely negative, so the guard has something to refuse", (await payable(DEBTOR)) < 0);
    check("baseline — postpaid customer's payable is −115.00", await payable(POSTPAID), DEBTOR_BALANCE);
    check("baseline — no balance return exists yet for the creditor",
      Number((await c.query(`select count(*)::int n from public.customer_balance_returns where customer_id = $1`, [CREDITOR])).rows[0].n), 0);

    // =====================================================================
    // CASE 1 — FIFO through start_work_order, spanning two lots.
    // =====================================================================
    await scenario("case 1 — FIFO spans two lots, entered through start_work_order", async () => {
      const r = await rpc(START_WO_SQL, [WO_A.wo, "DBCHK"]);
      ok("case 1 — start_work_order SUCCEEDED", r.err === null);
      if (r.err) return console.log(`          unexpected raise: ${r.err.message}`);
      check("case 1 — work order is in_progress", r.row!.status, "in_progress");
      ok("case 1 — inventory_deducted_at stamped", r.row!.inventory_deducted_at != null);

      // THE MONEY ASSERTION. Which lots, how much from each, AT WHAT COST.
      const split = await splitFor(WO_A.line);
      check("case 1 — the split is two rows: 6 from the OLDEST lot, then 3 from the next", split, [
        { received: L_OLD.received, qty: 6, unit: L_OLD.price },
        { received: L_MID.received, qty: 3, unit: L_MID.price },
      ]);
      const cost = money(split.reduce((s, x) => s + x.qty * x.unit, 0));
      check("case 1 — total cost drawn is 420.00", cost, C1_COST);
      ok("case 1 — NOT the created_at answer (370.00)", cost !== C1_COST_IF_CREATED_AT);
      ok("case 1 — NOT the cheapest-first answer (320.00)", cost !== C1_COST_IF_CHEAPEST);
      check("case 1 — the line's weighted unit price is 46.67", await woPartPrice(WO_A.line), C1_WEIGHTED);

      check("case 1 — lots drained oldest-first, in place", await lotState(part), [
        { received: L_OLD.received, price: L_OLD.price, remaining: 0 },
        { received: L_MID.received, price: L_MID.price, remaining: 2 },
        { received: L_NEW.received, price: L_NEW.price, remaining: 4 },
      ]);
      check("case 1 — qty_on_hand is 6", await onHand(part), money(ON_HAND - C1_QTY));
      check("case 1 — qty_on_hand and sum(qty_remaining) still AGREE", await lotsRemaining(part), await onHand(part));

      const mv = (
        await c.query(
          `select qty_delta, qty_after from public.stock_movements
            where part_id = $1 and movement_type = 'consume' order by created_at`,
          [part],
        )
      ).rows.map((x) => ({ d: money(x.qty_delta), after: money(x.qty_after) }));
      check("case 1 — one consume movement, −9 leaving 6", mv, [{ d: -9, after: 6 }]);
    });

    // =====================================================================
    // CASE 2 — a consume landing exactly on a lot boundary.
    // =====================================================================
    await scenario("case 2 — consume lands exactly on a lot boundary", async () => {
      const r = await rpc(START_WO_SQL, [WO_B.wo, "DBCHK"]);
      ok("case 2 — start_work_order SUCCEEDED", r.err === null);
      if (r.err) return console.log(`          unexpected raise: ${r.err.message}`);
      check("case 2 — exactly ONE consumption row, no zero-qty tail on the next lot", await splitFor(WO_B.line), [
        { received: L_OLD.received, qty: L_OLD.qty, unit: L_OLD.price },
      ]);
      check("case 2 — unit price is the single lot's own price", await woPartPrice(WO_B.line), L_OLD.price);
      check("case 2 — the oldest lot is emptied and the others untouched", await lotState(part), [
        { received: L_OLD.received, price: L_OLD.price, remaining: 0 },
        { received: L_MID.received, price: L_MID.price, remaining: L_MID.qty },
        { received: L_NEW.received, price: L_NEW.price, remaining: L_NEW.qty },
      ]);
      check("case 2 — on hand and lots agree", await lotsRemaining(part), await onHand(part));
    });

    // =====================================================================
    // CASE 3 — a consume spanning all three lots.
    // =====================================================================
    await scenario("case 3 — consume spans all three lots", async () => {
      const r = await rpc(START_WO_SQL, [WO_C.wo, "DBCHK"]);
      ok("case 3 — start_work_order SUCCEEDED", r.err === null);
      if (r.err) return console.log(`          unexpected raise: ${r.err.message}`);
      check("case 3 — three rows, dearest-oldest first and cheapest-newest last", await splitFor(WO_C.line), [
        { received: L_OLD.received, qty: L_OLD.qty, unit: L_OLD.price },
        { received: L_MID.received, qty: L_MID.qty, unit: L_MID.price },
        { received: L_NEW.received, qty: 1, unit: L_NEW.price },
      ]);
      check("case 3 — weighted unit price is 44.17", await woPartPrice(WO_C.line), C3_WEIGHTED);
      check("case 3 — qty_on_hand is 3", await onHand(part), money(ON_HAND - C3_QTY));
      check("case 3 — on hand and lots still agree after a three-lot walk", await lotsRemaining(part), 3);
    });

    // =====================================================================
    // CASE 4 — consume_from_lots DIRECT. It carries its own copy of the
    // ORDER BY; testing only the wrapper would not notice the two drifting.
    // =====================================================================
    await scenario("case 4 — consume_from_lots orders by received_on on its own", async () => {
      const r = await rpc(CONSUME_SQL, [part, C1_QTY, "DBCHK direct", "DBCHK"]);
      ok("case 4 — consume_from_lots SUCCEEDED", r.err === null);
      if (r.err) return console.log(`          unexpected raise: ${r.err.message}`);
      check("case 4 — it returns the updated part row", money(r.row!.qty_on_hand), money(ON_HAND - C1_QTY));
      check("case 4 — same oldest-first drain as the work order path", await lotState(part), [
        { received: L_OLD.received, price: L_OLD.price, remaining: 0 },
        { received: L_MID.received, price: L_MID.price, remaining: 2 },
        { received: L_NEW.received, price: L_NEW.price, remaining: 4 },
      ]);
      check("case 4 — on hand and lots agree", await lotsRemaining(part), await onHand(part));
      check("case 4 — it records NO per-lot cost of its own (that is the caller's job)",
        Number((await c.query(`select count(*)::int n from public.work_order_part_consumptions`)).rows[0].n), 0);
    });

    // =====================================================================
    // CASE 5 — return_customer_balance, the one legal refund.
    //
    // NOTE: this RPC is SECURITY INVOKER, unlike everything else in this file.
    // The harness runs as service_role, which bypasses RLS, so what is proven
    // here is its ARITHMETIC and its EXPLICIT guards — not its row-level
    // policies. Those need a JWT-bearing client and are out of scope.
    // =====================================================================
    await scenario("case 5 — refund an archived creditor", async () => {
      const before = await payable(CREDITOR);
      const r = await rpc(RETURN_SQL, [CREDITOR, "cash", "DBCHK-REF", null, TRIP_DATE, "DBCHK", "DBCHK operator"]);
      ok("case 5 — return_customer_balance SUCCEEDED", r.err === null);
      if (r.err) return console.log(`          unexpected raise: ${r.err.message}`);

      const row = (
        await c.query(
          `select amount_sar, method, reference, to_char(returned_on,'YYYY-MM-DD') returned_on, returned_by
             from public.customer_balance_returns where customer_id = $1`,
          [CREDITOR],
        )
      ).rows[0];
      // The modal has no amount field by design — the RPC freezes the figure it
      // read. Asserting the amount is therefore asserting the whole design.
      check("case 5 — the frozen amount is the balance the RPC read, 385.00", money(row.amount_sar), REFUNDABLE);
      check("case 5 — the frozen amount equals the pre-refund payable", money(row.amount_sar), before);
      check("case 5 — method recorded", row.method, "cash");
      check("case 5 — reference recorded", row.reference, "DBCHK-REF");
      check("case 5 — returned_by recorded", row.returned_by, "DBCHK operator");
      check("case 5 — the balance is now exactly 0.00, not merely small", await balance(CREDITOR), 0);
    });

    // =====================================================================
    // STOCK AND DRIFT REFUSALS.
    // =====================================================================
    console.log("\n-- refusals: stock and the drift guard");

    await refuses("F1 consume_from_lots — more than is on hand", CONSUME_SQL,
      [part, 99.0, "DBCHK", "DBCHK"], "Not enough stock on hand", { part, expectOnHand: ON_HAND });

    await refuses("F2 consume_from_lots — a non-positive quantity", CONSUME_SQL,
      [part, 0, "DBCHK", "DBCHK"], "Consumed quantity must be positive.", { part, expectOnHand: ON_HAND });

    await scenario("F3 consume_from_lots — the ledger-short guard, drift constructed", async () => {
      // Simulate the missed backfill the guard was written for: qty_on_hand
      // says 20, the lots only account for 15.
      await c.query(`update public.parts set qty_on_hand = 20 where id = $1`, [part]);
      check("F3 — drift is in place: on hand 20, lots 15", await onHand(part), 20);
      const r = await rpc(CONSUME_SQL, [part, 18.0, "DBCHK", "DBCHK"]);
      ok("F3 — REFUSED", r.err !== null);
      if (r.err) {
        ok("F3 — refused for the RIGHT reason", r.err.message.includes("qty_on_hand and lots have drifted"));
        ok("F3 — and it names the shortfall, 3", r.err.message.includes("short by 3"));
        console.log(`          db said: ${r.err.message.split("\n")[0]}`);
      }
      check("F3 — the partial lot decrements were rolled back", await lotsRemaining(part), ON_HAND);
      check("F3 — qty_on_hand not decremented either", await onHand(part), 20);
    });

    await scenario("F4 work order path — the OUTER drift guard, a different message", async () => {
      await c.query(`update public.parts set qty_on_hand = 20 where id = $1`, [part]);
      await c.query(`update public.work_order_parts set qty = 18 where id = $1`, [WO_D.line]);
      const r = await rpc(START_WO_SQL, [WO_D.wo, "DBCHK"]);
      ok("F4 — REFUSED", r.err !== null);
      if (r.err) {
        ok("F4 — refused for the RIGHT reason", r.err.message.includes("qty_on_hand and lots have drifted"));
        // The distinguishing half: consume_work_order_line names the WORK
        // ORDER, consume_from_lots names the PART. Fire the wrong one and this
        // fails while the fragment above still passes.
        ok("F4 — it is the WORK ORDER guard, not the part-level one", r.err.message.includes("for work order DBCHK-WO-D"));
        ok("F4 — and NOT the part-level wording", !r.err.message.includes("short by"));
        console.log(`          db said: ${r.err.message.split("\n")[0]}`);
      }
      check("F4 — no consumption rows survived the refusal",
        Number((await c.query(`select count(*)::int n from public.work_order_part_consumptions where work_order_part_id = $1`, [WO_D.line])).rows[0].n), 0);
      check("F4 — the work order is still open", (await c.query(`select status from public.work_orders where id = $1`, [WO_D.wo])).rows[0].status, "open");
    });

    await scenario("F5 work order path — an OVER-REQUEST is reported as drift (measured, not endorsed)", async () => {
      // No drift here: on hand and lots both say 15. The line asks for 99.
      // consume_work_order_line's recording walk runs out of lots before
      // consume_from_lots ever gets to say 'Not enough stock on hand'.
      check("F5 — on hand and lots agree, so this is a shortage and nothing else", await onHand(part), await lotsRemaining(part));
      const r = await rpc(START_WO_SQL, [WO_D.wo, "DBCHK"]);
      ok("F5 — REFUSED", r.err !== null);
      if (r.err) {
        ok("F5 — the message says DRIFT even though the stock is simply absent",
          r.err.message.includes("qty_on_hand and lots have drifted"));
        ok("F5 — the honest 'Not enough stock' never fires on this path",
          !r.err.message.includes("Not enough stock"));
        console.log(`          db said: ${r.err.message.split("\n")[0]}`);
      }
      check("F5 — stock untouched", await onHand(part), ON_HAND);
    });

    await scenario("F6 consume — an inactive part", async () => {
      await c.query(`update public.parts set active = false where id = $1`, [part]);
      const r = await rpc(CONSUME_SQL, [part, 1.0, "DBCHK", "DBCHK"]);
      ok("F6 — REFUSED", r.err !== null);
      if (r.err) {
        ok("F6 — refused for the RIGHT reason", r.err.message.includes("Part not found or inactive."));
        console.log(`          db said: ${r.err.message.split("\n")[0]}`);
      }
    });

    // =====================================================================
    // add_price_lot INPUT REFUSALS.
    // =====================================================================
    console.log("\n-- refusals: add_price_lot");

    await refuses("A1 add_price_lot — zero quantity", ADD_LOT_SQL,
      [part, 10.0, 0, L_OLD.received, "DBCHK", "DBCHK"], "Received quantity must be positive.",
      { part, expectOnHand: ON_HAND });

    await refuses("A2 add_price_lot — negative price", ADD_LOT_SQL,
      [part, -1.0, 5.0, L_OLD.received, "DBCHK", "DBCHK"], "Price cannot be negative.",
      { part, expectOnHand: ON_HAND });

    await scenario("A3 add_price_lot — an inactive part", async () => {
      await c.query(`update public.parts set active = false where id = $1`, [part]);
      const r = await rpc(ADD_LOT_SQL, [part, 10.0, 5.0, L_OLD.received, "DBCHK", "DBCHK"]);
      ok("A3 — REFUSED", r.err !== null);
      if (r.err) {
        ok("A3 — refused for the RIGHT reason", r.err.message.includes("Part not found or inactive."));
        console.log(`          db said: ${r.err.message.split("\n")[0]}`);
      }
    });

    // =====================================================================
    // THE REFUND GATE. B3 is the one that matters: amount_payable_sar is the
    // prepaid RUNNING BALANCE, negative when the customer OWES us. Flip the
    // comparison and the RPC pays a debtor their own debt, in cash, and
    // freezes the figure into customer_balance_returns where nothing later
    // re-derives it.
    // =====================================================================
    console.log("\n-- refusals: the refund gate");

    await refuses("B1 refund — a method that is neither cash nor bank_transfer", RETURN_SQL,
      [CREDITOR, "cheque", null, null, TRIP_DATE, null, "DBCHK"], "Return method must be cash or bank_transfer.");

    await refuses("B2 refund — a customer that does not exist", RETURN_SQL,
      ["00000000-0000-0000-0000-000000000000", "cash", null, null, TRIP_DATE, null, "DBCHK"], "Customer not found.");

    await refuses("B3 refund — an archived customer who OWES money (the debtor gate)", RETURN_SQL,
      [DEBTOR, "cash", null, null, TRIP_DATE, null, "DBCHK"], "This customer holds no balance to return.");

    await refuses("B3b refund — an archived POSTPAID customer, payable <= 0 by construction", RETURN_SQL,
      [POSTPAID, "cash", null, null, TRIP_DATE, null, "DBCHK"], "This customer holds no balance to return.");

    await refuses("B4 refund — a customer holding money but NOT archived", RETURN_SQL,
      [LIVE, "cash", null, null, TRIP_DATE, null, "DBCHK"], "Only an archived customer's balance can be returned.");

    // B5 and B6 are one refusal measured twice, because the guard ORDER decides
    // which message a double refund gets — and on the ordinary double refund it
    // is NOT the one the wording leads you to expect. See fact 3 in the header.
    await scenario("B5 refund — a SECOND refund immediately after the first", async () => {
      const first = await rpc(RETURN_SQL, [CREDITOR, "cash", null, null, TRIP_DATE, null, "DBCHK"]);
      ok("B5 — the first refund succeeded (so the second is the thing refused)", first.err === null);
      check("B5 — the refund itself drove the balance to 0.00", await payable(CREDITOR), 0);
      const second = await rpc(RETURN_SQL, [CREDITOR, "cash", null, null, TRIP_DATE, null, "DBCHK"]);
      ok("B5 — the second refund REFUSED", second.err !== null);
      if (second.err) {
        // MEASURED, not assumed: the amount-is-positive gate sits AHEAD of the
        // already-returned gate, and the first refund zeroed the balance, so it
        // is the balance gate that answers here.
        ok("B5 — it is the BALANCE gate that fires, not the already-returned one",
          second.err.message.includes("This customer holds no balance to return."));
        ok("B5 — and the already-returned wording is NOT what came back",
          !second.err.message.includes("already been returned"));
        console.log(`          db said: ${second.err.message.split("\n")[0]}`);
      }
      check("B5 — exactly one return row exists",
        Number((await c.query(`select count(*)::int n from public.customer_balance_returns where customer_id = $1`, [CREDITOR])).rows[0].n), 1);
    });

    await scenario("B6 refund — refunded, then FUNDED AGAIN: now the already-returned gate fires", async () => {
      const first = await rpc(RETURN_SQL, [CREDITOR, "cash", null, null, TRIP_DATE, null, "DBCHK"]);
      ok("B6 — the first refund succeeded", first.err === null);
      // Put real money back in, so the balance gate can no longer answer for it.
      // This is the ONLY shape in which the already-returned guard is reachable,
      // and it is the shape that would otherwise pay the customer twice.
      await c.query(
        `insert into public.customer_topups (customer_id, amount_sar, topup_date, method) values ($1, $2, $3, 'cash')`,
        [CREDITOR, TOPUP, TRIP_DATE],
      );
      check("B6 — the customer is back in credit, so the balance gate is out of the way", await payable(CREDITOR), TOPUP);
      const second = await rpc(RETURN_SQL, [CREDITOR, "cash", null, null, TRIP_DATE, null, "DBCHK"]);
      ok("B6 — the second refund REFUSED", second.err !== null);
      if (second.err) {
        ok("B6 — refused for the RIGHT reason", second.err.message.includes("balance has already been returned"));
        ok("B6 — and NOT via the balance gate this time", !second.err.message.includes("holds no balance"));
        console.log(`          db said: ${second.err.message.split("\n")[0]}`);
      }
      check("B6 — still exactly one return row, so no second payout was recorded",
        Number((await c.query(`select count(*)::int n from public.customer_balance_returns where customer_id = $1`, [CREDITOR])).rows[0].n), 1);
    });

    // =====================================================================
    // ANON. CLAUDE.md section 6: `create or replace function` resets the ACL
    // to EXECUTE TO PUBLIC, anon inherits PUBLIC, and the anon key ships in
    // the client bundle. Every function in this chain, entry points and inner
    // ones alike — an inner function left callable is just a longer way in.
    // =====================================================================
    console.log("\n-- refusals: anon denied across the chain");

    await refuses("R1 anon — start_work_order", START_WO_SQL, [WO_A.wo, "x"],
      "permission denied for function start_work_order", { role: "anon" });
    await refuses("R2 anon — deduct_work_order_parts", DEDUCT_SQL, [WO_A.wo, "x"],
      "permission denied for function deduct_work_order_parts", { role: "anon" });
    await refuses("R3 anon — consume_work_order_line", CONSUME_LINE_SQL, [WO_A.line, 1.0, "x"],
      "permission denied for function consume_work_order_line", { role: "anon" });
    await refuses("R4 anon — consume_from_lots", CONSUME_SQL, [part, 1.0, "x", "x"],
      "permission denied for function consume_from_lots", { role: "anon" });
    await refuses("R5 anon — add_price_lot", ADD_LOT_SQL, [part, 1.0, 1.0, L_OLD.received, "x", "x"],
      "permission denied for function add_price_lot", { role: "anon" });
    await refuses("R6 anon — return_customer_balance", RETURN_SQL,
      [CREDITOR, "cash", null, null, TRIP_DATE, null, "x"],
      "permission denied for function return_customer_balance", { role: "anon" });
  } finally {
    await c.query("rollback");
    await c.end();
  }

  // ---- ZERO-LEAK on a FRESH connection, so it cannot read its own
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
      `select 'warehouse' k, id from public.warehouses where id = $1
       union all select 'part', id from public.parts where id = $2
       union all select 'truck', id from public.trucks where id = $3
       union all select 'staff', id from public.staff where id = $4
       union all select 'work_order', id from public.work_orders where id = any($5::uuid[])
       union all select 'customer', id from public.customers where id = any($6::uuid[])`,
      [
        seeded.warehouse,
        seeded.part,
        seeded.truck,
        seeded.mechanic,
        [seeded.woA, seeded.woB, seeded.woC, seeded.woD],
        [seeded.creditor, seeded.debtor, seeded.live, seeded.postpaid],
      ],
    )
  ).rows;
  check("zero-leak — none of the seeded ids survive", leaked, []);

  const strays = (
    await post.query(
      `select (select count(*)::int from public.parts where sku like 'DBCHK-%') parts,
              (select count(*)::int from public.work_orders where wo_number like 'DBCHK-%') wos,
              (select count(*)::int from public.trucks where plate like 'DBCHK-%') trucks,
              (select count(*)::int from public.price_lots where note like 'DBCHK %') lots`,
    )
  ).rows[0];
  check("zero-leak — no DBCHK-tagged row of any kind survives", strays, { parts: 0, wos: 0, trucks: 0, lots: 0 });
  await post.end();

  console.log("");
  const failures = failureCount();
  if (failures === 0) {
    console.log("All inventory-money DB checks PASSED ✓ — FIFO drained oldest-first, every refusal fired, nothing leaked.");
    process.exit(0);
  } else {
    console.log(`${failures} inventory-money DB check(s) FAILED ✗`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\nHARNESS ERROR — the run did not complete, so nothing is proven:\n", e);
  process.exit(1);
});
