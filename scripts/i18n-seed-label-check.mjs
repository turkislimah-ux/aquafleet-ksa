#!/usr/bin/env node
// Standing i18n guard: every BUILT-IN lookup label we translate BY KEY must
// spell its English exactly the way its seed migration spells it.
//
// Why this exists. A built-in staff role / leave type used to render its `label`
// STRAIGHT FROM THE ROW. Translating it moved that English into lib/i18n.ts, so
// from that moment two files spell the same string and nothing compares them. A
// typo ("Paid" for "Paid leave") is invisible in English — the UI keeps
// rendering, it has just quietly stopped agreeing with the database.
//
// Labels are PARSED from the seed migration, never hand-copied into this file: a
// list typed here would only be a third place to get it wrong.
//
// Scope. This is deliberately NOT the per-batch byte-identity harness. That
// harness grades one batch's diff against a pre-edit English census, its inputs
// are scratch files for one batch, and it stays out of the repo. This file holds
// the one invariant that OUTLIVES a batch, so it reads repo files only and runs
// from a clean checkout on any machine.
//
// Reads the dictionary through the TypeScript AST, never by importing it and
// never by regex: i18n.ts is full of prose comments, and a comment cannot leak
// into an AST walk.
//
// Usage:  node scripts/i18n-seed-label-check.mjs      exit 0 = green, 1 = red

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";

// Repo root resolved at RUNTIME. The previous version of this file hardcoded one
// contributor's home directory, which is most of why it could not run anywhere
// but the machine it was written on.
function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd(); // tarball checkout, no .git — still works if run from root
  }
}
const ROOT = repoRoot();
const I18N = `${ROOT}/lib/i18n.ts`;

// ---- EXTENSION POINT -------------------------------------------------------
// EVERY lookup table whose built-in rows are translated by key MUST be listed
// here. If you translate a new one and forget this list, the guard stays silent
// and green while the new labels drift — an omission is indistinguishable from a
// pass, which is the failure mode to watch for.
//
//   [ dictionary namespace, seed migration (repo-relative), table name ]
//
// Only `is_default = true` rows are checked. A custom row (is_default = false) is
// user-entered data, has no dictionary key, and must never be listed here.
const SEED_GROUPS = [
  ["drivers.role",      "supabase/migrations/0011_staff_roles_termination.sql", "staff_roles"],
  ["drivers.leaveType", "supabase/migrations/0012_leave.sql",                   "leave_types"],
];
// ---- END EXTENSION POINT ---------------------------------------------------

// `export const dict = { … } as const` — peel the wrappers so the walk sees the
// object literal rather than the AsExpression around it.
function unwrap(n) {
  if (!n) return n;
  if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n)) return unwrap(n.expression);
  if (ts.isSatisfiesExpression?.(n)) return unwrap(n.expression);
  return n;
}
const propName = (p) => {
  const n = p.name;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
  return null;
};
const litText = (e) => {
  const i = unwrap(e);
  if (!i) return null;
  if (ts.isStringLiteral(i) || ts.isNoSubstitutionTemplateLiteral(i)) return i.text;
  return null;
};

// dotted path -> the `en` value. A LEAF is any node carrying BOTH `en` and `ar`
// as string literals; anything else is a namespace and we keep descending.
function readDict(file) {
  if (!fs.existsSync(file)) {
    console.error(`FATAL: ${file} not found (run this from inside the repo)`);
    process.exit(2);
  }
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  let dictObj = null;
  const findDict = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(sf) === "dict" && node.initializer) {
      const init = unwrap(node.initializer);
      if (ts.isObjectLiteralExpression(init)) dictObj = init;
    }
    ts.forEachChild(node, findDict);
  };
  findDict(sf);
  if (!dictObj) {
    console.error(`FATAL: no \`dict\` object literal found in ${file}`);
    process.exit(2);
  }

  const out = new Map();
  const walk = (obj, prefix) => {
    const props = obj.properties.filter(ts.isPropertyAssignment);
    const byName = new Map();
    for (const p of props) {
      const n = propName(p);
      if (n) byName.set(n, p);
    }
    const en = byName.get("en"), ar = byName.get("ar");
    if (en && ar && litText(en.initializer) !== null && litText(ar.initializer) !== null) {
      out.set(prefix, litText(en.initializer));
      return;
    }
    for (const p of props) {
      const n = propName(p);
      if (n == null) continue;
      const init = unwrap(p.initializer);
      if (ts.isObjectLiteralExpression(init)) walk(init, prefix ? `${prefix}.${n}` : n);
    }
  };
  walk(dictObj, "");
  return out;
}

const dict = readDict(I18N);

const mismatch = [];
let checked = 0;
for (const [prefix, file, table] of SEED_GROUPS) {
  const abs = `${ROOT}/${file}`;
  if (!fs.existsSync(abs)) {
    mismatch.push(`${table}: seed migration ${file} not found`);
    continue;
  }
  const sql = fs.readFileSync(abs, "utf8");
  const block = sql.match(new RegExp(`insert into public\\.${table}[^;]*;`, "i"));
  if (!block) {
    mismatch.push(`${table}: no seed INSERT found in ${file}`);
    continue;
  }
  // ('key', 'Label', true) — the trailing `true` is is_default, so this matches
  // the built-in rows only.
  const rows = [...block[0].matchAll(/\(\s*'([a-z0-9_]+)'\s*,\s*'([^']*)'\s*,\s*true\s*\)/gi)];
  if (!rows.length) {
    mismatch.push(`${table}: seed INSERT parsed to zero built-in rows`);
    continue;
  }
  for (const [, key, label] of rows) {
    checked++;
    const dv = dict.get(`${prefix}.${key}`);
    if (dv === undefined) mismatch.push(`${prefix}.${key} — seeded '${label}' but no dictionary key`);
    else if (dv !== label) mismatch.push(`${prefix}.${key} — seed '${label}' vs dict '${dv}'`);
  }
}

console.log(`dictionary: ${I18N}`);
console.log(`lookup groups: ${SEED_GROUPS.length}   built-in labels checked: ${checked}`);
console.log("");

if (mismatch.length === 0) {
  console.log(`SEED LABEL PASS   all ${checked} built-in lookup labels match their seeded DB label byte-for-byte`);
  process.exit(0);
}
console.log(`SEED LABEL FAIL   ${mismatch.length} built-in label(s) disagree with the seed`);
for (const m of mismatch) console.log(`    ${m}`);
process.exit(1);
