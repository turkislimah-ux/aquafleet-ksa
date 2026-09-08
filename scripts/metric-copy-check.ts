// Copy-integrity harness for the METRICS DICTIONARY (0187). No DB, no test
// framework.
// Run:  npx tsx scripts/metric-copy-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).
//
// WHY THIS FILE EXISTS. 0187 moved the dictionary's prose out of
// report_metrics' columns and into lib/i18n under
// `reports.metricDef.<metric_key>`. That trade buys a compiler on the KEYS and
// a diff a human can review — but it gives up one thing, and this file is the
// price of getting it back:
//
//   metricText() returns "" when every fall-through misses, and the popup's
//   `{caveat && …}` gate turns "" into "render no warning". So a metric that
//   HAS NO CAVEAT and a metric whose caveat key was MISTYPED look identical on
//   screen. Nothing else in the tree can tell them apart. Two metrics really do
//   carry no warning — operating_profit and os_cost — so "no caveat" cannot be
//   made an error, and the only honest guard is asserting the key SET.
//
// WHAT IT CHECKS, and what each check is protecting:
//   1. ROSTER — the 33 metric_keys the registry holds after 0187, both
//      directions: every roster entry is keyed, and no metricDef key exists
//      that is not on the roster (a typo'd metric_key would otherwise sit in
//      i18n forever, rendering for nobody).
//   2. REQUIRED FIELDS — meaning / formula / grain present in BOTH languages
//      for all 33. `tsc` cannot see this: a leaf is `{ en, ar }` by convention,
//      and a key with one side missing type-checks fine.
//   3. LABELS — exactly 21 metricDef labels, and exactly 12 metrics routed to
//      an existing `reports.metric.*` name instead. The two sets must be
//      DISJOINT and must cover the roster: an overlap is one metric with two
//      names, a gap is a metric with none.
//   4. CAVEATS — exactly 31, and absent in BOTH languages on exactly
//      operating_profit and os_cost. A key present in one language only would
//      print the other language's sentence under a heading that promises a
//      caution.
//   5. BYTE-FIDELITY of the three rows 0187 inserts — the `en` side of each
//      i18n key equals the string in the migration's VALUES, character for
//      character, parsed out of the .sql. That is what makes metricText's third
//      step (the row's own column) invisible when it fires: if the fall-through
//      renders DIFFERENT English from the key, it is a silent content change
//      rather than a graceful degradation.
//
// WHAT IT CANNOT CHECK, stated so nobody mistakes green for total coverage:
// the 30 PRE-EXISTING rows' English columns are not readable from here (no DB
// access in this harness, and the anon key cannot select report_metrics). Their
// byte-fidelity was established once, by checksum, when the copy moved: md5 of
// the whole 30-row corpus, DB side and i18n side, bd3d2ac5d0a96dff7fe2be59beabcd5d
// (measured 2026-09-08). Re-establishing it needs a service-role connection and
// is a different job from this file.
//
// THE MIGRATION HOLDS THE OTHER HALF. 0187's DO block asserts the DB side —
// 33 rows, caveat null on exactly those same two keys, 4 settlement-basis
// metrics. This file asserts the copy side. Neither one alone proves the two
// agree about which metrics carry a warning; together they do.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dict, t, type Lang, type TKey } from "../lib/i18n";
import { METRIC_LABEL_TKEY } from "../lib/reports";

let failures = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    console.log(`        want: ${JSON.stringify(want)}`);
    console.log(`        got:  ${JSON.stringify(got)}`);
  }
}

/**
 * Present-in-this-language, using t() rather than walking `dict`.
 *
 * `t()` returns the PATH on a miss, and metricText() in lib/reports resolves by
 * exactly that sentinel. Reading `dict` directly here would be a second lookup
 * implementation that could disagree with the renderer about what counts as
 * present — which is the one disagreement this file exists to catch. The
 * trim() mirrors metricText's, so a key translated to "  " fails here instead
 * of rendering an empty block.
 */
function has(path: string, lang: Lang): boolean {
  const hit = t(path as TKey, lang);
  return hit !== path && hit.trim().length > 0;
}

function value(path: string, lang: Lang): string {
  return t(path as TKey, lang);
}

// ---------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------
// THE 33 metric_keys report_metrics HOLDS AFTER 0187, WRITTEN OUT. This is the
// one hand-maintained list in the file and it is deliberate: the whole point is
// to fail when the registry and the copy drift, and a roster derived FROM the
// copy could not detect a metric that was registered and never keyed. A new
// migration adding a metric adds a line here, and that line is the reminder to
// key its copy.
//
// The 30 pre-0187 keys are READ OFF THE LIVE TABLE (2026-09-08), not recalled
// and not reconstructed from migration filenames — a first pass at this list
// written from memory got a third of it wrong, inventing `trips_delivered`,
// `vat_input` and `within_month_collection_rate` (all real things elsewhere in
// the app, none of them a registry row) while missing `daily_direct_cost`,
// `pnl_by_period` and four more. The last three are 0187's.
const ROSTER = [
  "collections",
  "commissions_cost",
  "commissions_paid",
  "daily_direct_cost",
  "daily_direct_margin",
  "daily_revenue",
  "delivered_revenue_daily",
  "delivery_output",
  "expenses",
  "filling_cost",
  "maintenance_cost_per_truck",
  "monthly_only_cost",
  "net_profit",
  "operating_cost",
  "operating_margin",
  "operating_profit",
  "operations",
  "operations_by_driver",
  "os_cost",
  "os_payments_per_truck",
  "parts_cost_at_consumption",
  "payroll_cost",
  "pnl_by_period",
  "purchasing_spend",
  "receivables_aging",
  "receivables_outstanding",
  "revenue",
  "revenue_per_truck",
  "topups",
  "total_maintenance_per_truck",
  // 0187
  "amount_payable",
  "paid_up_balance",
  "running_balance",
] as const;

// The two metrics that carry no warning. Named, never counted — "2" would also
// be satisfied by two DIFFERENT metrics losing theirs.
const NO_CAVEAT = ["operating_profit", "os_cost"];

const LANGS: Lang[] = ["en", "ar"];

// ---------------------------------------------------------------------------
// 1. Roster ↔ metricDef, both directions
// ---------------------------------------------------------------------------
const metricDef = (dict as unknown as {
  reports: { metricDef: Record<string, Record<string, unknown>> };
}).reports.metricDef;

const keyed = Object.keys(metricDef).sort();
// Widened to string[] on purpose. `as const` above is what makes the roster a
// literal list a reader can diff against the table; keeping that narrow union
// here would make `roster.includes(someString)` a type error at every site that
// asks the only question this file asks — is this key on the roster.
const roster: string[] = [...ROSTER].sort();

check("roster size is 33", roster.length, 33);
check("every roster metric is keyed in metricDef", roster.filter((k) => !keyed.includes(k)), []);
check("no metricDef key is off-roster", keyed.filter((k) => !roster.includes(k)), []);

// ---------------------------------------------------------------------------
// 2. meaning / formula / grain — present in both languages, all 33
// ---------------------------------------------------------------------------
for (const field of ["meaning", "formula", "grain"] as const) {
  for (const lang of LANGS) {
    const missing = roster.filter((k) => !has(`reports.metricDef.${k}.${field}`, lang));
    check(`${field}: all 33 present in ${lang}`, missing, []);
  }
}

// ---------------------------------------------------------------------------
// 3. Labels — 21 keyed here, 12 routed to reports.metric.*, disjoint, covering
// ---------------------------------------------------------------------------
const reused = Object.keys(METRIC_LABEL_TKEY).sort();
const labelled = roster.filter((k) => has(`reports.metricDef.${k}.label`, "en"));

check("12 metrics reuse an existing reports.metric name", reused.length, 12);
check("every reused metric is on the roster", reused.filter((k) => !roster.includes(k)), []);
check("21 metrics carry their own metricDef label", labelled.length, 21);
check("label sets are DISJOINT (no metric has two names)",
  reused.filter((k) => labelled.includes(k)), []);
check("label sets COVER the roster (no metric has no name)",
  roster.filter((k) => !reused.includes(k) && !labelled.includes(k)), []);

for (const lang of LANGS) {
  check(`metricDef labels resolve in ${lang}`,
    roster.filter((k) => !reused.includes(k) && !has(`reports.metricDef.${k}.label`, lang)), []);
  check(`reused reports.metric names resolve in ${lang}`,
    reused.filter((k) => !has(METRIC_LABEL_TKEY[k], lang)), []);
}

// ---------------------------------------------------------------------------
// 4. Caveats — 31 present in both languages, absent in both on exactly two
// ---------------------------------------------------------------------------
for (const lang of LANGS) {
  const withCaveat = roster.filter((k) => has(`reports.metricDef.${k}.caveat`, lang));
  const without = roster.filter((k) => !withCaveat.includes(k));
  check(`caveat: 31 present in ${lang}`, withCaveat.length, 31);
  check(`caveat: absent in ${lang} on exactly operating_profit and os_cost`, without, NO_CAVEAT);
}

// A key that exists in ONE language is the failure mode the two loops above
// cannot phrase on their own: each passes if its own side is complete. Compare
// the sets.
check("caveat: en and ar agree on WHICH metrics have one",
  roster.filter((k) =>
    has(`reports.metricDef.${k}.caveat`, "en") !== has(`reports.metricDef.${k}.caveat`, "ar")), []);

// ---------------------------------------------------------------------------
// 5. Byte-fidelity: the i18n `en` side == 0187's VALUES
// ---------------------------------------------------------------------------
// The migration is parsed rather than transcribed, because a transcription is a
// third copy of the same sentences and would drift silently.
//
// COMMENTS ARE BLANKED BEFORE PARSING, NEVER AFTER (CLAUDE.md §5). 0187's
// header prose contains apostrophes — "customer's", "editor's" — and a scanner
// that tokenises quotes first reads one as an opening string literal and
// swallows the rest of the file. That is not hypothetical; it is how the first
// pass at this parse failed.
function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      out += c; i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { out += "''"; i += 2; continue; }
        out += sql[i];
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) { out += " "; i++; }
      out += "  "; i += 2;
      continue;
    }
    out += c; i++;
  }
  return out;
}

/** Every single-quoted literal in order, with '' unescaped to '. */
function literals(sql: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < sql.length) {
    if (sql[i] !== "'") { i++; continue; }
    i++;
    let buf = "";
    while (i < sql.length) {
      if (sql[i] === "'" && sql[i + 1] === "'") { buf += "'"; i += 2; continue; }
      if (sql[i] === "'") { i++; break; }
      buf += sql[i]; i++;
    }
    out.push(buf);
  }
  return out;
}

const MIGRATION = join(__dirname, "..", "supabase", "migrations",
  "0187_report_metrics_balance_terms.sql");

const sql = stripSqlComments(readFileSync(MIGRATION, "utf8"));
const insert = sql.slice(sql.indexOf("insert into public.report_metrics"),
  sql.indexOf("on conflict (metric_key)"));
const lits = literals(insert);

// Nine columns per row, in the VALUES order the insert declares.
const COLS = ["metric_key", "label", "meaning", "formula", "unit", "grain",
  "source_view", "basis", "caveat"] as const;

check("0187 parses to 3 rows of 9 literals", lits.length, COLS.length * 3);

for (let r = 0; r < 3; r++) {
  const row = Object.fromEntries(
    COLS.map((c, j) => [c, lits[r * COLS.length + j]])) as Record<string, string>;
  const k = row.metric_key;

  check(`0187 row ${r} is a roster metric`, roster.includes(k), true);

  // `label` for all three is keyed in metricDef (none of the three reuses a
  // reports.metric name — that was measured, not assumed: the three balance
  // terms have near-duplicate strings under trips.* on another route, and were
  // deliberately NOT pointed at them, since a Finance-tab column rename would
  // otherwise rewrite a dictionary definition).
  for (const field of ["label", "meaning", "formula", "grain", "caveat"] as const) {
    check(`${k}.${field}: i18n en == 0187 column`,
      value(`reports.metricDef.${k}.${field}`, "en"), row[field]);
  }

  // grain is the one field that is BOTH prose and a stored value; the column
  // and the key must not diverge, which the loop above already covers. unit and
  // basis are enums with their own key sets and are asserted as raw values.
  check(`${k}.unit is SAR`, row.unit, "SAR");
  check(`${k}.basis is settlement`, row.basis, "settlement");
}

console.log(failures === 0
  ? "\nAll metric-copy checks passed."
  : `\n${failures} metric-copy check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
