// A `"use server"` MODULE MAY EXPORT ONLY ASYNC FUNCTIONS.
//
// Run:  node scripts/server-action-export-check.mjs
// Exits 0 if every server-action module is clean, 1 otherwise.
//
// WHY THIS EXISTS. `export function invoiceEra(...)` — two pure lines, no I/O —
// sat in app/trips/invoiceActions.ts and failed the whole module at BUILD time
// with "Server actions must be async functions", taking every importer down
// with it. Nothing caught it earlier: `npm run typecheck` types the file fine
// (the rule is a bundler rule, not a type rule), and `npm test` never builds.
// So the gap was real and the fix for it is not "remember" — it is this file.
//
// THE REPAIR THAT LOOKS EASIEST IS THE WRONG ONE. Marking the helper `async`
// silences the compiler and leaves a pure predicate reachable only across a
// server boundary, which pushes every client and every offline harness into
// keeping its own copy of the rule. The correct move is the one this check
// nudges you toward: put pure code in a plain module.
//
// WHAT COUNTS AS A SERVER-ACTION MODULE: `"use server"` as the file's first
// statement. A `"use server"` INSIDE a function body is the inline form — legal,
// common, and none of this file's business, which is why the directive's
// position is what selects the file rather than its mere presence.
//
// WHAT IS ALLOWED OUT:
//   export async function foo()        the actions themselves
//   export const foo = async (         the arrow form Next also accepts
//   export type / export interface     erased before the bundler ever looks
// Anything else — const, let, var, sync function, class, enum, default — is a
// build failure waiting for the next `next build`, so it fails here instead.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["app", "lib"];
const EXT = /\.(tsx|ts)$/;

/** Every .ts/.tsx under the roots, skipping node_modules and dot-dirs. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

/**
 * True only when "use server" is the file's FIRST statement. Leading comments
 * and blank lines are skipped; anything else means the directive (if present
 * at all) is the inline, in-function form.
 */
function isServerActionModule(src) {
  const lines = src.split("\n");
  let inBlockComment = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (line === "") continue;
    if (line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlockComment = true;
      continue;
    }
    return /^["']use server["'];?$/.test(line);
  }
  return false;
}

const ALLOWED = [
  /^export async function\s/,
  /^export const\s+\w+\s*(:[^=]+)?=\s*async\s*[(<]/,
  /^export type\s/,
  /^export interface\s/,
  // `export type { X } from "..."` / `export type { X }` — types only, erased.
  /^export type\s*\{/,
];

const files = ROOTS.flatMap((r) => walk(r));
const offenders = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (!isServerActionModule(src)) continue;
  src.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    if (!/^export\b/.test(line)) return;
    if (ALLOWED.some((re) => re.test(line))) return;
    offenders.push({ file, line: i + 1, text: line.trim() });
  });
}

const serverModules = files.filter((f) => isServerActionModule(readFileSync(f, "utf8")));

// A guard that scanned nothing would report the same clean sweep as a guard
// that scanned everything, so say the denominator out loud.
console.log(`server-action-export-check: scanned ${serverModules.length} "use server" modules`);

if (serverModules.length === 0) {
  console.error('server-action-export-check: found NO "use server" modules — the detector is broken, not the code.');
  process.exit(1);
}

if (offenders.length === 0) {
  console.log("server-action-export-check: PASS — every export is an async function or a type.");
  process.exit(0);
}

console.error("\nserver-action-export-check: FAIL — non-async exports in a \"use server\" module:\n");
for (const o of offenders) console.error(`  ${o.file}:${o.line}\n    ${o.text}`);
console.error(
  "\nMove the pure code to a plain module (see lib/invoice-era.ts). Do NOT mark it" +
    "\nasync to satisfy the bundler — that hides a pure function behind a server hop.",
);
process.exit(1);
