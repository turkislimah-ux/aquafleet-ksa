#!/usr/bin/env node
/**
 * ARCHIVE — the applier that put 0200 on PRODUCTION on 2026-09-15.
 *
 * Kept, not deleted, for two reasons: it is the only record of how 0200 reached
 * prod, and the pending migration-ledger reconcile will need the same transport.
 * It lives here rather than in scripts/db/ because it is an operational one-off,
 * NOT a test — nothing in `npm test` should ever open a socket to production.
 *
 * WHY NOT psql OR `supabase db push`: psql is not installed on this machine, and
 * db push is unusable against prod — prod's ledger is timestamp-style
 * (20260717090430...), the local directory is 0001-style, so push would try to
 * replay history. This drives node-postgres directly instead. client.query() on
 * a plain string uses the simple query protocol, so the migration's own
 * begin;/commit; is honoured exactly as psql would honour it.
 *
 * HARD GUARD, INVERTED from every other guard in this project: the connection
 * must be PRODUCTION. Six paths were tested before the first real run — the test
 * ref, a `...supabase.co.evil.net` lookalike, a missing credential, an env file
 * naming the test ref, an env file naming neither ref, and the green path. All
 * five red paths abort before a socket opens.
 *
 * Needs .env.prod.local with PROD_DB_URL (gitignored, and deliberately NOT left
 * on disk after a run — it holds the production password in plaintext).
 *
 * Usage:
 *   node .planning/post-deploy/apply-0200-prod.mjs guardonly  # guard only, no socket
 *   node .planning/post-deploy/apply-0200-prod.mjs check      # guard + preflight, no writes
 *   node .planning/post-deploy/apply-0200-prod.mjs partA      # apply the DDL migration
 *   node .planning/post-deploy/apply-0200-prod.mjs ledger     # insert the schema_migrations row
 *   node .planning/post-deploy/apply-0200-prod.mjs partB      # run the verification (self-rollback)
 */

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';

const EXPECTED_HOST = 'db.ceqzmztewbborwgxnrqh.supabase.co';
const EXPECTED_REF = 'ceqzmztewbborwgxnrqh';
const FORBIDDEN_REF = 'vlyxazfinmlanjdttavg'; // aquafleet-test — named so a paste-slip is loud

// Both parts are DERIVED FROM THE COMMITTED MIGRATION, not from scratch files.
// The original run read /tmp/0200-apply/*.sql; /tmp does not survive a reboot,
// which would have left this script unrunnable the day it was next needed. The
// split point is the migration's own `commit;` — part A is the DDL transaction
// up to and including it, part B is the self-rollback verification after it.
const MIGRATION = 'supabase/migrations/0200_exit_permit_write_offs.sql';
const MIGRATION_MD5 = 'fd8fe67ba6821e52768fc0d5f1dacedd';
const PART_A_MD5 = '5510750185b92de858da8203478a74d6';
const PART_B_MD5 = '1fd5f5f3206279e3d65f523949196582';

const ENV_FILE = '.env.prod.local';
const ENV_KEY = 'PROD_DB_URL';

// Matches the created_by on all 132 existing prod ledger rows (they were written
// by MCP apply_migration under this account). Same account, same credential here.
const LEDGER_CREATED_BY = 'turkislimah@gmail.com';

const die = (msg) => {
  console.error(`\nABORT: ${msg}\n`);
  process.exit(1);
};

function loadUrl() {
  const fromEnv = process.env[ENV_KEY];
  if (fromEnv) return fromEnv.trim();
  if (!existsSync(ENV_FILE)) {
    die(`${ENV_FILE} not found and ${ENV_KEY} not exported. Nothing to connect with.`);
  }

  // Mirror of scripts/db/harness.ts, inverted. That guard refuses if the PROD
  // ref appears anywhere in the test env file; this one refuses if the TEST ref
  // appears anywhere in the prod env file. A file naming both projects is a file
  // someone edited in a hurry, and this script does DDL on production.
  const raw = readFileSync(ENV_FILE, 'utf8');
  if (raw.includes(FORBIDDEN_REF)) {
    die(`${ENV_FILE} mentions the TEST ref ${FORBIDDEN_REF}. Refusing to read a prod credential out of a file that also names test.`);
  }
  if (!raw.includes(EXPECTED_REF)) {
    die(`${ENV_FILE} never mentions the PROD ref ${EXPECTED_REF}. Wrong file, or wrong project.`);
  }

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() !== ENV_KEY) continue;
    return line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  die(`${ENV_KEY} not present in ${ENV_FILE}.`);
}

/** The guard. Runs before any socket is opened. */
function guard(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    die('Connection string is not parseable as a URL.');
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) die(`Not a postgres URL (protocol ${u.protocol}).`);

  const host = u.hostname;
  if (host.includes(FORBIDDEN_REF)) {
    die(`Host ${host} is the TEST ref (${FORBIDDEN_REF}). This script only targets PRODUCTION.`);
  }
  if (host !== EXPECTED_HOST) {
    die(
      `Host is "${host}", expected "${EXPECTED_HOST}".\n` +
        `  If this is a POOLER URL (aws-*.pooler.supabase.com), the guard cannot confirm the\n` +
        `  ref from the hostname. Do not loosen the guard — supply the direct connection\n` +
        `  string from Supabase > Project Settings > Database > Connection string > URI.`,
    );
  }
  console.log(`GUARD PASSED — target host ${host}`);
  console.log(`GUARD PASSED — project ref ${EXPECTED_REF}  (PRODUCTION)`);
  console.log(`GUARD PASSED — not the test ref ${FORBIDDEN_REF}`);
  return u;
}

const md5of = (s) => createHash('md5').update(Buffer.from(s, 'utf8')).digest('hex');

let _parts = null;

/** Split the committed migration at its own `commit;` into the two submittable halves. */
function splitMigration() {
  if (_parts) return _parts;
  if (!existsSync(MIGRATION)) {
    die(`${MIGRATION} is missing. Run from the repo root.`);
  }
  const buf = readFileSync(MIGRATION);
  const whole = createHash('md5').update(buf).digest('hex');
  if (whole !== MIGRATION_MD5) {
    die(
      `${MIGRATION} md5 is ${whole}, expected ${MIGRATION_MD5}.\n` +
        `  The migration changed after it was applied to production. Refusing to\n` +
        `  re-derive parts from a file that no longer matches what prod ran.`,
    );
  }
  const lines = buf.toString('utf8').split('\n');
  const i = lines.indexOf('commit;');
  if (i < 0) die(`${MIGRATION} has no bare \`commit;\` line — cannot find the split point.`);
  if (lines.indexOf('commit;', i + 1) !== -1) {
    die(`${MIGRATION} has more than one bare \`commit;\` line — the split point is ambiguous.`);
  }
  _parts = {
    A: lines.slice(0, i + 1).join('\n') + '\n',
    B: lines.slice(i + 1).join('\n'),
  };
  return _parts;
}

/** which: 'A' (DDL migration) or 'B' (self-rollback verification). */
function part(which) {
  const sql = splitMigration()[which];
  const expected = which === 'A' ? PART_A_MD5 : PART_B_MD5;
  const md5 = md5of(sql);
  if (md5 !== expected) {
    die(`Part ${which} md5 is ${md5}, expected ${expected}. Refusing to apply SQL I cannot vouch for.`);
  }
  console.log(`PART ${which} OK — md5 ${md5}  (${Buffer.byteLength(sql, 'utf8')} bytes, from ${MIGRATION})`);
  return sql;
}

async function connect(url) {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const { rows } = await client.query(
    'select current_database() as db, version() as v, (now() at time zone $1)::timestamptz as riyadh_now',
    ['Asia/Riyadh'],
  );
  console.log(`CONNECTED — db ${rows[0].db}`);
  return client;
}

/** Everything 0200 touches, measured BEFORE we touch it. */
const PREFLIGHT = `
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name in
      ('exit_permit_write_offs','exit_permit_write_off_lines'))                       as new_tables_present,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='exit_permit_lines'
      and column_name='qty_written_off')                                             as qty_written_off_present,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('write_off_exit_permit_line','write_off_exit_permit_lines','reverse_exit_permit_write_off'))
                                                                                      as new_functions_present,
  (select count(*) from supabase_migrations.schema_migrations)                        as ledger_rows,
  (select count(*) from supabase_migrations.schema_migrations where version ~ '^[0-9]{14}$')
                                                                                      as ledger_timestamp_style,
  (select count(*) from supabase_migrations.schema_migrations where version ~ '^0[0-9]{3}')
                                                                                      as ledger_0001_style,
  (select item_count from public.v_dashboard_action_items where kind='permit_return_overdue')
                                                                                      as dashboard_overdue_now
`;

async function main() {
  const mode = process.argv[2];
  if (!['guardonly', 'check', 'partA', 'ledger', 'partB'].includes(mode)) {
    die('Usage: apply-0200-prod.mjs guardonly|check|partA|ledger|partB');
  }
  console.log(`\n=== 0200 PROD APPLIER — mode: ${mode} ===\n`);

  // Parts are derived and checksummed FIRST, before any credential is read. The
  // prod password is deliberately not left on disk, so this archive has to stay
  // runnable without one — `guardonly` with no credential still proves the split
  // still reproduces the two halves that production actually ran.
  part('A');
  part('B');

  if (mode === 'guardonly' && !process.env[ENV_KEY] && !existsSync(ENV_FILE)) {
    console.log(`\nguardonly: parts verified. No ${ENV_KEY} and no ${ENV_FILE}, so the guard was not exercised.`);
    return;
  }

  const url = loadUrl();
  guard(url);

  // Exercise the guard's GREEN path without opening a socket, so a guard bug is
  // found here rather than mid-apply.
  if (mode === 'guardonly') {
    console.log('\nguardonly: guard accepted, parts verified, no connection attempted.');
    return;
  }

  const client = await connect(url);
  try {
    if (mode === 'check') {
      const pre = (await client.query(PREFLIGHT)).rows[0];
      console.log('\nPREFLIGHT:', JSON.stringify(pre, null, 2));
      const recent = await client.query(
        'select version, name from supabase_migrations.schema_migrations order by version desc limit 3',
      );
      console.log('\nLEDGER — 3 most recent rows (shape to match):');
      console.table(recent.rows);
      if (Number(pre.new_tables_present) > 0) {
        console.log('\nNOTE: 0200 objects already exist. Part A has already been applied.');
      }
    }

    if (mode === 'partA') {
      const sql = part('A');
      const pre = (await client.query(PREFLIGHT)).rows[0];
      if (Number(pre.new_tables_present) > 0) {
        die('0200 tables already exist on prod. Refusing to re-apply. Run `check` to inspect.');
      }
      console.log(`\nBEFORE — dashboard permit_return_overdue item_count = ${pre.dashboard_overdue_now}`);
      console.log('\nAPPLYING PART A (file carries its own begin; ... commit;) ...');
      await client.query(sql); // simple query protocol: multi-statement + explicit tx honoured
      const post = (await client.query(PREFLIGHT)).rows[0];
      console.log('\nPART A APPLIED. POSTFLIGHT:', JSON.stringify(post, null, 2));
      console.log(`\nAFTER  — dashboard permit_return_overdue item_count = ${post.dashboard_overdue_now}`);
    }

    if (mode === 'ledger') {
      const pre = (await client.query(PREFLIGHT)).rows[0];
      if (Number(pre.new_tables_present) !== 2) {
        die('0200 tables are not both present. Apply part A before recording the ledger row.');
      }
      const dup = await client.query(
        "select version, name from supabase_migrations.schema_migrations where name = 'exit_permit_write_offs'",
      );
      if (dup.rowCount > 0) {
        console.log('Ledger row already present:');
        console.table(dup.rows);
      } else {
        // SHAPE MEASURED FROM PROD, NOT ASSUMED. All 132 existing rows populate
        // version (14-digit UTC), name (snake_case, no number prefix, no .sql),
        // created_by, and statements (text[] of exactly ONE element holding the
        // whole submitted SQL). idempotency_key and rollback are null on all 132.
        // An earlier draft of this script inserted version+name only; that would
        // have left this row the one row in the table with no body recorded.
        const sql = part('A');
        const ins = await client.query(
          `insert into supabase_migrations.schema_migrations
             (version, name, created_by, statements)
           values (to_char(now() at time zone 'UTC', 'YYYYMMDDHH24MISS'),
                   'exit_permit_write_offs', $1, array[$2::text])
           returning version, name, created_by,
                     array_length(statements, 1) as n_statements,
                     length(statements[1]) as statement_chars`,
          [LEDGER_CREATED_BY, sql],
        );
        console.log('LEDGER ROW INSERTED:');
        console.table(ins.rows);
      }
      const recent = await client.query(
        'select version, name from supabase_migrations.schema_migrations order by version desc limit 3',
      );
      console.log('\nLEDGER — 3 most recent rows now:');
      console.table(recent.rows);
    }

    if (mode === 'partB') {
      const sql = part('B');
      console.log('\nRUNNING PART B. It ends in a deliberate raise and rolls itself back.\n');
      try {
        await client.query(sql);
        console.log('UNEXPECTED: part B completed WITHOUT raising. That is not a pass — it means');
        console.log('the verification block did not run. Do not record a pass.');
        process.exitCode = 1;
      } catch (e) {
        const passed = typeof e.message === 'string' && e.message.startsWith('0200 VERIFY PASSED');
        console.log(`RESULT: ${passed ? 'PASS' : 'FAIL'}`);
        console.log(`\nMESSAGE:\n${e.message}`);
        if (e.detail) console.log(`\nDETAIL:\n${e.detail}`);
        if (e.hint) console.log(`\nHINT:\n${e.hint}`);
        if (e.where) console.log(`\nWHERE:\n${e.where}`);
        if (!passed) process.exitCode = 1;
      }
      // Whatever happened, make sure nothing is left open.
      try {
        await client.query('rollback');
      } catch {
        /* no transaction in progress */
      }
    }
  } finally {
    await client.end();
  }
  console.log('\n=== done ===\n');
}

main().catch((e) => {
  console.error('\nUNHANDLED:', e.message);
  if (e.detail) console.error('DETAIL:', e.detail);
  process.exit(1);
});
