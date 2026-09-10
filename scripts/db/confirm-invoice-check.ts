// LIVE DATABASE guard for the 0191 totals assertions on public.confirm_invoice.
// Run:  npm run test:db      (or: npx tsx scripts/db/confirm-invoice-check.ts)
// Exits 0 if every assertion passes, 1 otherwise (CI-friendly).
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS, AND WHY IT IS NOT IN test:money
//
// Every other harness in scripts/ is a PURE OFFLINE FIXTURE: it imports the TS
// money engine and re-derives arithmetic in-process. None of them can see
// public.confirm_invoice, which is plpgsql and lives only in the database. So
// the 0191 assertions — the ones that stop the NEXT invoice whose covered +
// amount due does not equal its grand — have no regression test at all. A
// future `create or replace function` that drops a tier would be invisible to
// the whole suite.
//
// This file is that test. It needs a network round trip and a real transaction,
// so it gets its OWN npm script: a network test must not pollute the pure
// offline suite. `test:money` must stay runnable with no credentials, no
// connectivity and no side effects; the moment one of its members can fail
// because a DNS lookup timed out, a red suite stops meaning "the money is
// wrong".
//
// WHAT IT ASSERTS — the negatives ARE the test
//
// A suite that only confirms GOOD invoices proves the RPC runs. It does not
// prove the assertion DISCRIMINATES. So each tier gets a payload that is
// correct in every respect except that tier, and the run fails unless the
// database RAISES — and raises with THAT TIER's message, not some earlier gate's
// (an "invoice is not in review status" would otherwise read as a green
// negative). Same doctrine as 0191's own in-migration negative controls: a
// guard nobody has watched fail is not a guard.
//
//   case 1  correct payload             -> must SUCCEED  (confirmed + numbered)
//   case 2  line sum != grand_subtotal  -> must RAISE Tier A
//   case 3  covered + due != grand      -> must RAISE Tier B   <- the B1-catcher
//   case 4  grand_vat != subtotal*rate  -> must RAISE Tier C
//   case 5  called as `anon`            -> must be DENIED (CLAUDE.md §6)
//
// Case 3 is the one that matters most: it is the exact shape of the bug 0191
// was written for — five already-issued invoices, 41,756.50 SAR of lines
// sitting outside their own document total. If this file ever goes green with
// case 3 not raising, the door is open again.
//
// EACH NEGATIVE IS ONE MUTATION AWAY FROM CASE 1. Case 2 changes only a line
// amount; case 3 only the due stack; case 4 only the VAT figures. So a raise
// can only be attributed to the mutated tier — and case 1 proves the seed is
// otherwise confirmable, which is what makes the negatives readable at all.
//
// NO ROWS SURVIVE. Everything runs inside ONE transaction that ends in
// ROLLBACK, with a savepoint per case so a raise does not poison the next one
// (and so case 1's success does not leave the invoice 'confirmed', which would
// make cases 2-4 raise for the WRONG reason). next_invoice_number is a counter
// TABLE, not a sequence, so the allocated number rolls back with everything
// else — asserted below on a FRESH connection.
// ---------------------------------------------------------------------------

import { Client } from "pg";
import { check, connOptions, failureCount, loadTestEnv, ok, TEST_REF } from "./harness";

// ---------------------------------------------------------------------------
// The payload. One trip line, 100.00 net.
//
//   grand    100.00 / 15.00 / 115.00     one document-level VAT pass
//   covered    0.00 /  0.00 /   0.00     postpaid: nothing is pool-covered
//   due      100.00 / 15.00 / 115.00     covered + due = grand, by construction
//
// Tier A: the line sums to 100.00 = grand subtotal.
// Tier B: 0 + 100 = 100, 0 + 15 = 15, 0 + 115 = 115.
// Tier C: round(100.00 * 0.15, 2) = 15.00 = grand VAT.
// ---------------------------------------------------------------------------

const LINE_NET = 100.0;
const PERIOD_START = "2020-01-01";
const PERIOD_END = "2020-01-31";
const TRIP_DATE = "2020-01-15";

type Payload = {
  coveredLines: unknown[];
  unpaidLines: unknown[];
  charges: unknown[];
  coveredTripIds: string[];
  unpaidTripIds: string[];
  cSub: number; cVat: number; cTot: number;
  dSub: number; dVat: number; dTot: number;
  gSub: number; gVat: number; gTot: number;
};

function basePayload(tripId: string): Payload {
  return {
    coveredLines: [],
    unpaidLines: [
      { kind: "trip", id: tripId, label: "DBCHK trip", date: TRIP_DATE, amount_sar: LINE_NET },
    ],
    charges: [],
    coveredTripIds: [],
    unpaidTripIds: [tripId],
    cSub: 0, cVat: 0, cTot: 0,
    dSub: 100.0, dVat: 15.0, dTot: 115.0,
    gSub: 100.0, gVat: 15.0, gTot: 115.0,
  };
}

// CALL IT FROM THE `from` CLAUSE, NEVER AS `select (confirm_invoice(...)).*`.
// A composite-returning call expanded with `.*` in the target list is evaluated
// ONCE PER OUTPUT COLUMN — 25 times here. The first call confirms the invoice;
// the second finds status <> 'review' and raises "Invoice is not in review
// status", which reads exactly like the RPC rejecting a good payload. That is
// not hypothetical: this harness hit it on its first run. In `from` the
// function is a single relation-producing call, evaluated once.
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

function confirmArgs(invoiceId: string, p: Payload): unknown[] {
  return [
    invoiceId,
    JSON.stringify({ name: "DBCHK SELLER" }),
    JSON.stringify({ name: "DBCHK BUYER" }),
    JSON.stringify(p.coveredLines),
    JSON.stringify(p.unpaidLines),
    JSON.stringify(p.charges),
    p.coveredTripIds,
    p.unpaidTripIds,
    p.cSub, p.cVat, p.cTot,
    p.dSub, p.dVat, p.dTot,
    p.gSub, p.gVat, p.gTot,
    "postpaid",
  ];
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const env = loadTestEnv();
  const conn = connOptions(env);

  // ---- Pre-run census, on its own connection, outside the test transaction.
  //      This is the baseline the zero-leak assertion compares against.
  const censusSql = `
    select
      (select count(*) from public.customers)                  as customers,
      (select count(*) from public.projects)                   as projects,
      (select count(*) from public.trips)                      as trips,
      (select count(*) from public.invoices)                   as invoices,
      (select count(*) from public.invoice_special_charges)    as charges,
      (select count(*) from public.project_commission_history) as commission_history,
      (select coalesce(sum(next_number), 0)
         from public.invoice_number_counter)                   as counter_sum`;

  const pre = new Client(conn);
  await pre.connect();
  // pg's own parse of the URI, not this file's regex — proves the two agree.
  ok(`pg connected to a host naming ${TEST_REF}`, String((pre as unknown as { host: string }).host).includes(TEST_REF));
  const censusBefore = (await pre.query(censusSql)).rows[0];
  await pre.end();
  console.log("\nCensus BEFORE: " + JSON.stringify(censusBefore));

  const c = new Client(conn);
  await c.connect();

  const seeded: Record<string, string> = {};
  let sawSuccess = false;

  try {
    await c.query("begin");

    // ---- SEED. The real dependency chain: customer -> project -> delivered
    //      trip -> invoice in 'review'. The trip must be DELIVERED or
    //      confirm_invoice's first gate rejects every case for a reason that
    //      has nothing to do with the totals.
    seeded.customer = (
      await c.query(
        `insert into public.customers (name, customer_type)
         values ('DBCHK HARNESS CUSTOMER', 'construction') returning id`,
      )
    ).rows[0].id;

    seeded.project = (
      await c.query(
        `insert into public.projects
           (customer_id, name, initials, default_water_station, water_type, status, payment_mode)
         values ($1, 'DBCHK HARNESS PROJECT', 'DBK', 'manfuhah_station', 'potable', 'active', 'postpaid')
         returning id`,
        [seeded.customer],
      )
    ).rows[0].id;

    seeded.trip = (
      await c.query(
        `insert into public.trips
           (project_id, customer_id, water_station, water_type, rate_sar, stage, trip_date, delivered_at)
         values ($1, $2, 'manfuhah_station', 'potable', $3, 'delivered', $4, now())
         returning id`,
        [seeded.project, seeded.customer, LINE_NET, TRIP_DATE],
      )
    ).rows[0].id;

    seeded.invoice = (
      await c.query(
        `insert into public.invoices (customer_id, period_start, period_end, status)
         values ($1, $2, $3, 'review') returning id`,
        [seeded.customer, PERIOD_START, PERIOD_END],
      )
    ).rows[0].id;

    console.log("\nSeeded: " + JSON.stringify(seeded) + "\n");

    // ---- Case runner. Every case gets its own savepoint and is rolled back
    //      to it afterwards — INCLUDING the one that succeeds. Cases must all
    //      see the same 'review' invoice; if case 1 left it 'confirmed', cases
    //      2-4 would raise "not in review status" and a message check is the
    //      only thing standing between that and a false green.
    async function runCase(
      n: number,
      label: string,
      p: Payload,
      expect: { raises: string | null; asRole?: string },
    ): Promise<void> {
      const sp = `case_${n}`;
      await c.query(`savepoint ${sp}`);
      let err: { message: string; code?: string } | null = null;
      let row: Record<string, unknown> | null = null;
      try {
        if (expect.asRole) await c.query(`set local role ${expect.asRole}`);
        row = (await c.query(CONFIRM_SQL, confirmArgs(seeded.invoice, p))).rows[0];
      } catch (e) {
        err = e as { message: string; code?: string };
      }

      if (expect.raises === null) {
        ok(`case ${n} — ${label}: SUCCEEDED`, err === null);
        if (err) console.log(`          unexpected raise: ${err.message}`);
        if (row) {
          sawSuccess = true;
          check(`case ${n} — status frozen to 'confirmed'`, row.status, "confirmed");
          ok(
            `case ${n} — invoice number allocated (got ${String(row.invoice_number)})`,
            /^\d{3}-\d{6}$/.test(String(row.invoice_number)),
          );
          check(`case ${n} — grand_total_sar written`, Number(row.grand_total_sar), 115.0);
          check(`case ${n} — amount_due_sar written`, Number(row.amount_due_sar), 115.0);
          check(`case ${n} — covered_total_sar written`, Number(row.covered_total_sar), 0);
        }
      } else {
        ok(`case ${n} — ${label}: RAISED`, err !== null);
        if (err) {
          ok(
            `case ${n} — raised for the RIGHT reason (matched "${expect.raises}")`,
            err.message.includes(expect.raises),
          );
          console.log(`          db said: ${err.message.split("\n")[0]}`);
        } else {
          console.log("          NOTHING RAISED — the assertion cannot fail, so a green confirm proves nothing.");
        }
      }

      await c.query(`rollback to savepoint ${sp}`);
      await c.query("reset role");
      // The invoice must be back in 'review' for the next case. Asserted, not
      // assumed: a savepoint that did not unwind turns every later case into a
      // status error wearing a raise's clothes.
      const st = (await c.query(`select status from public.invoices where id = $1`, [seeded.invoice]))
        .rows[0].status;
      check(`case ${n} — invoice back in 'review' after rollback to savepoint`, st, "review");
    }

    // ---- case 1. The control. Everything below is this payload, mutated once.
    await runCase(1, "correct payload", basePayload(seeded.trip), { raises: null, asRole: "service_role" });

    // ---- case 2. TIER A. The printed line says 90.00, the document claims a
    //      100.00 subtotal. B and C stay internally consistent, so only A can
    //      account for a raise.
    const a = basePayload(seeded.trip);
    (a.unpaidLines[0] as { amount_sar: number }).amount_sar = 90.0;
    await runCase(2, "Tier A — lines sum to 90.00, grand subtotal says 100.00", a, {
      raises: "does not add up to its own lines",
      asRole: "service_role",
    });

    // ---- case 3. TIER B. THE B1-CATCHER. Lines still sum to the grand
    //      subtotal (A passes) and grand VAT is still one clean pass (C
    //      passes), but covered + due is 10.00 short of grand — the exact
    //      shape of 026-000009, whose 517.50 charge sat outside its own total.
    const b = basePayload(seeded.trip);
    b.dSub = 90.0; b.dVat = 13.5; b.dTot = 103.5;
    await runCase(3, "Tier B — covered + due is 10.00 short of grand (the B1 shape)", b, {
      raises: "covered + amount due does not equal grand",
      asRole: "service_role",
    });

    // ---- case 4. TIER C. VAT one halala off a single document-level pass,
    //      carried through the due stack so B still balances exactly.
    const cc = basePayload(seeded.trip);
    cc.dVat = 15.01; cc.dTot = 115.01; cc.gVat = 15.01; cc.gTot = 115.01;
    await runCase(4, "Tier C — grand VAT 15.01 against a 100.00 subtotal", cc, {
      raises: "one document-level pass over the",
      asRole: "service_role",
    });

    // ---- case 5. CLAUDE.md §6. `create or replace function` resets the ACL to
    //      EXECUTE TO PUBLIC and anon inherits PUBLIC; the anon key ships in
    //      the client bundle. 0191 re-revokes. This is the read-back that would
    //      notice the next redefinition forgetting to.
    await runCase(5, "anon must NOT be able to call confirm_invoice", basePayload(seeded.trip), {
      raises: "permission denied for function confirm_invoice",
      asRole: "anon",
    });

    ok("the positive case actually ran (a suite of only negatives proves nothing)", sawSuccess);
  } finally {
    // ---- TEARDOWN. Unconditional: a thrown assertion must not strand rows.
    await c.query("rollback");
    await c.end();
  }

  // ---- ZERO-LEAK. On a FRESH connection, so it cannot be reading its own
  //      uncommitted transaction. Two ways, because a census can match by
  //      coincidence and an id lookup can miss a row the seed created
  //      indirectly (the projects commission-history trigger).
  const post = new Client(conn);
  await post.connect();
  const censusAfter = (await post.query(censusSql)).rows[0];
  console.log("\nCensus AFTER:  " + JSON.stringify(censusAfter));

  for (const k of Object.keys(censusBefore)) {
    check(`zero-leak — ${k} unchanged`, censusAfter[k], censusBefore[k]);
  }

  const leaked = (
    await post.query(
      `select 'customer' k, id from public.customers where id = $1
       union all select 'project', id from public.projects  where id = $2
       union all select 'trip',    id from public.trips     where id = $3
       union all select 'invoice', id from public.invoices  where id = $4`,
      [seeded.customer, seeded.project, seeded.trip, seeded.invoice],
    )
  ).rows;
  check("zero-leak — none of the seeded ids survive", leaked, []);

  // The invoice number case 1 allocated must have rolled back with everything
  // else. next_invoice_number writes a counter TABLE, so it does — but that is
  // the kind of fact that stops being true after one refactor to a sequence.
  const stray = (
    await post.query(
      `select count(*)::int n from public.invoices
        where period_start = $1 and period_end = $2`,
      [PERIOD_START, PERIOD_END],
    )
  ).rows[0].n;
  check("zero-leak — no invoice survives on the harness period", stray, 0);
  await post.end();

  console.log("");
  const failures = failureCount();
  if (failures === 0) {
    console.log("All confirm_invoice DB checks PASSED ✓ — every tier raised, nothing leaked.");
    process.exit(0);
  } else {
    console.log(`${failures} confirm_invoice DB check(s) FAILED ✗`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\nHARNESS ERROR — the run did not complete, so nothing is proven:\n", e);
  process.exit(1);
});
