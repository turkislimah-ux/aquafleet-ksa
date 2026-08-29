#!/usr/bin/env node
// Standing i18n guard: a lookup row's NAME lives on the ROW and nowhere else.
// Nothing under a lookup table's retired dictionary namespace may exist.
//
// Why this exists, and why it is the INVERSE of what it used to assert.
// Built-in staff roles and leave types were once translated BY KEY: `label` sat
// on the row, the caption sat in lib/i18n.ts, and this file compared the two so
// a typo in one could not hide behind the other. That model is gone. The row now
// carries both languages (`label` + `label_ar`, migrations 0168-0170) and display
// resolves through `arText(label, label_ar, lang)`, so the dictionary holds no
// name for these rows at all.
//
// Comparing two copies is therefore no longer the invariant — HAVING ONLY ONE
// COPY IS. The failure this guards against is a future session re-adding a
// `drivers.role.fleet_manager` leaf out of habit or from an old handoff, which
// would put a second name back in play: authoritative on some screens, diverging
// from the row on the rest, and invisible in English.
//
// Keys are still PARSED from the seed migration, never hand-copied into this
// file: a list typed here would only be a third place to get it wrong, and it
// would go stale the moment a built-in is added.
//
// Scope. This is deliberately NOT the per-batch byte-identity harness. That
// harness grades one batch's diff against a pre-edit English census, its inputs
// are scratch files for one batch, and it stays out of the repo. This file holds
// the one invariant that OUTLIVES a batch, so it reads repo files only and runs
// from a clean checkout on any machine.
//
// Reads the dictionary through the TypeScript AST, never by importing it and
// never by regex: i18n.ts is full of Arabic prose in comments, and a comment
// cannot leak into an AST walk.
//
// Usage:  node scripts/i18n-lookup-single-source-check.mjs   exit 0 = green, 1 = red
//         node scripts/i18n-lookup-single-source-check.mjs <path-to-dictionary>
//
// The optional path exists for the NEGATIVE CONTROL. An absence check passes
// trivially when it is checking nothing, so before trusting a green run, point it
// at a copy of the dictionary with one forbidden leaf pasted back in and confirm
// it goes red. A guard that cannot be made to fail is not a guard.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

// Repo root resolved at RUNTIME. An early version of this file hardcoded one
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
const I18N = process.argv[2] ? path.resolve(process.argv[2]) : `${ROOT}/lib/i18n.ts`;

// ---- EXTENSION POINT -------------------------------------------------------
// EVERY lookup table whose rows name themselves MUST be listed here, paired with
// the dictionary namespace its names are FORBIDDEN to occupy. If you convert a
// new one and forget this list, the guard stays silent and green while a second
// name creeps back — an omission is indistinguishable from a pass, which is the
// failure mode to watch for.
//
//   [ retired dictionary namespace, seed migration (repo-relative), table ]
//
// The namespaces below are the ones these tables USED to occupy. They are dead
// and must stay dead. The seed migration is read only to enumerate the built-in
// keys; its labels are quoted in failures but never compared.
//
// Only `is_default = true` rows are enumerated by name. A custom row is
// user-entered data, never had a dictionary key, and is covered by the namespace
// sweep rather than individually.
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

const violations = [];
let checked = 0;
for (const [ns, file, table] of SEED_GROUPS) {
  const abs = `${ROOT}/${file}`;
  if (!fs.existsSync(abs)) {
    violations.push(`${table}: seed migration ${file} not found`);
    continue;
  }
  const sql = fs.readFileSync(abs, "utf8");
  const block = sql.match(new RegExp(`insert into public\\.${table}[^;]*;`, "i"));
  if (!block) {
    violations.push(`${table}: no seed INSERT found in ${file}`);
    continue;
  }
  // ('key', 'Label', true) — the trailing `true` is is_default, so this matches
  // the built-in rows only. Parsing zero rows is a FAILURE, not a pass: it would
  // mean the guard enumerated nothing and its green would be meaningless.
  const rows = [...block[0].matchAll(/\(\s*'([a-z0-9_]+)'\s*,\s*'([^']*)'\s*,\s*true\s*\)/gi)];
  if (!rows.length) {
    violations.push(`${table}: seed INSERT parsed to zero built-in rows`);
    continue;
  }

  const enumerated = new Set();
  for (const [, key, label] of rows) {
    checked++;
    const leaf = `${ns}.${key}`;
    enumerated.add(leaf);
    if (dict.has(leaf)) {
      violations.push(
        `${leaf} — dictionary says '${dict.get(leaf)}' (seeded '${label}'). ` +
        `The ${table} row is the only name: render label / label_ar through arText.`
      );
    }
  }

  // A leaf anywhere under the retired namespace, including under a key that is
  // not a built-in. Catches a whole block pasted back, not just one caption.
  for (const k of dict.keys()) {
    if (k.startsWith(`${ns}.`) && !enumerated.has(k)) {
      violations.push(`${k} — namespace '${ns}' is retired; ${table} names itself.`);
    }
  }
}

console.log(`dictionary: ${I18N}`);
console.log(`lookup tables: ${SEED_GROUPS.length}   built-in keys enumerated: ${checked}`);
console.log("");

if (violations.length === 0) {
  console.log(`SINGLE SOURCE PASS   no dictionary name exists for any of the ${checked} built-in lookup rows`);
  process.exit(0);
}
console.log(`SINGLE SOURCE FAIL   ${violations.length} lookup name(s) have a second copy in the dictionary`);
for (const v of violations) console.log(`    ${v}`);
process.exit(1);
