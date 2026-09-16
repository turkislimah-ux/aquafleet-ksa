#!/usr/bin/env node
// Standing guard: `trucks.capacity_m3` is WRITTEN in exactly one file.
//
// WHAT IT PROTECTS
// -----------------------------------------------------------------------------
// Migration 0201 kept `trucks.capacity_m3` — ten surfaces read it — but stopped
// it being a field anyone fills in. It is now derived from the pair that
// replaced it, and Postgres holds the two together:
//
//   capacity_m3 is not distinct from
//     (case when capacity_unit = 'm3' then capacity_value end)
//
// So `{ capacity_m3: 33 }` on its own is no longer a save. It is a 23514 in
// production and a puzzled operator, and the fix — build all three columns
// together — only works if there is one place that builds them. That place is
// `lib/capacity.ts`. This file is what keeps it the only one.
//
// The failure mode is not malice, it is HABIT. `capacity_m3` was the capacity
// column for two hundred migrations; the next person to add a vehicle import, a
// seed script or a second form will reach for it because that is what it was
// called, and nothing on screen will say otherwise until a write fails.
//
// HOW IT DECIDES WHAT A WRITE IS
// -----------------------------------------------------------------------------
// Through the TypeScript AST, never by regex. `capacity_m3` legitimately
// appears in this repo as:
//
//   · a TYPE member            capacity_m3: number | null;     (db-types, 2 more)
//   · a property READ          tr.capacity_m3 != null
//   · a PostgREST select list  .select("id, plate, capacity_m3, ...")
//   · Arabic and English PROSE lib/i18n.ts's metric caveat, twice
//
// A regex that caught writes would catch all of those, and a regex tuned to
// miss them would miss `capacity_m3 : 33` with a space. So the check is
// structural: an ObjectLiteral property assignment, a shorthand property, or an
// assignment to a `.capacity_m3` member. Type members are `PropertySignature`
// and never match; property reads are `PropertyAccessExpression` and never
// match; string literals are not visited at all.
//
// PROVING IT CAN FAIL
// -----------------------------------------------------------------------------
// An absence check passes trivially when it is checking nothing — a renamed
// directory, a changed extension, a walker that silently found zero files, and
// it stays green forever while saying nothing. Two answers, both required:
//
//   1. It ASSERTS THE WRITER EXISTS. `lib/capacity.ts` must contain at least
//      one real `capacity_m3` write. If the helper is deleted, gutted or moved,
//      this goes RED rather than green-because-empty.
//   2. It takes a root to scan as argv, for the negative control:
//
//        mkdir -p /tmp/cap && printf 'const r = { capacity_m3: 1 };\n' > /tmp/cap/bad.ts
//        node scripts/capacity-single-writer-check.mjs /tmp/cap    # must exit 1
//
//      Run that before trusting a green run. A guard nobody has seen fail is a
//      comment.
//
// Usage:  node scripts/capacity-single-writer-check.mjs           exit 0 = green
//         node scripts/capacity-single-writer-check.mjs <dir...>  negative control

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

// Repo root resolved at RUNTIME — the same lesson
// scripts/i18n-lookup-single-source-check.mjs records in its own header: an
// early version of that file hardcoded one contributor's home directory and
// could not run anywhere else.
function repoRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

const ROOT = repoRoot();
const COLUMN = "capacity_m3";

// THE one writer, repo-relative. Changing this line is changing the rule.
const SOLE_WRITER = "lib/capacity.ts";

const DEFAULT_ROOTS = ["app", "lib", "components", "scripts"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build"]);
const EXTS = new Set([".ts", ".tsx", ".mts", ".cts"]);

const overrideRoots = process.argv.slice(2);
const scanRoots = overrideRoots.length ? overrideRoots : DEFAULT_ROOTS;
const isNegativeControl = overrideRoots.length > 0;

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (EXTS.has(path.extname(e.name))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every structural WRITE of `capacity_m3` in one file, as { line, kind, text }.
 *
 * Deliberately NOT counted as writes:
 *   PropertySignature        a type member
 *   PropertyAccessExpression a read
 *   StringLiteral            a select list, a comment, Arabic prose
 */
function findWrites(file) {
  const src = fs.readFileSync(file, "utf8");
  // A file that never mentions the column cannot write it — skip the parse.
  if (!src.includes(COLUMN)) return [];

  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const hits = [];
  const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const textOf = (node) => sf.text.slice(node.getStart(sf), node.getEnd()).split("\n")[0].trim();

  function named(node) {
    // `capacity_m3:` and `"capacity_m3":` are the same write.
    if (!node) return false;
    if (ts.isIdentifier(node)) return node.text === COLUMN;
    if (ts.isStringLiteral(node)) return node.text === COLUMN;
    return false;
  }

  function visit(node) {
    if (ts.isPropertyAssignment(node) && named(node.name)) {
      hits.push({ line: at(node), kind: "object key", text: textOf(node) });
    } else if (ts.isShorthandPropertyAssignment(node) && named(node.name)) {
      hits.push({ line: at(node), kind: "shorthand key", text: textOf(node) });
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === COLUMN
    ) {
      hits.push({ line: at(node), kind: "member assignment", text: textOf(node) });
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return hits;
}

// ---- scan -------------------------------------------------------------------

const files = [];
for (const r of scanRoots) {
  walk(path.isAbsolute(r) ? r : path.join(ROOT, r), files);
}

const offenders = [];
for (const file of files) {
  const rel = path.relative(ROOT, file);
  if (rel === SOLE_WRITER) continue;
  for (const hit of findWrites(file)) offenders.push({ rel, ...hit });
}

const problems = [];

if (offenders.length) {
  problems.push(
    `${offenders.length} write${offenders.length === 1 ? "" : "s"} of \`${COLUMN}\` outside ${SOLE_WRITER}:`,
    ...offenders.map((o) => `    ${o.rel}:${o.line}  (${o.kind})  ${o.text}`),
    "",
    `  \`${COLUMN}\` is derived (0201) and tied to capacity_value/capacity_unit by`,
    "  trucks_capacity_m3_consistent_check. Writing it alone is a 23514 at runtime.",
    `  Build the triple with capacityColumns() from ${SOLE_WRITER} and spread it.`,
  );
}

// Guard the guard. A green run has to mean "one writer", never "no files found".
if (!isNegativeControl) {
  if (!files.length) {
    problems.push(`Scanned ${scanRoots.join(", ")} and found no TypeScript files. This check checked nothing.`);
  }
  const writerPath = path.join(ROOT, SOLE_WRITER);
  if (!fs.existsSync(writerPath)) {
    problems.push(`${SOLE_WRITER} does not exist. The sole writer moved; this check is now checking nothing.`);
  } else if (findWrites(writerPath).length === 0) {
    problems.push(
      `${SOLE_WRITER} contains no \`${COLUMN}\` write.`,
      "  Either the helper was gutted, or the rule moved and this file was not told.",
    );
  }
}

if (problems.length) {
  console.error(`capacity-single-writer-check: RED\n\n  ${problems.join("\n  ")}\n`);
  process.exit(1);
}

console.log(
  `capacity-single-writer-check: green — ${files.length} files scanned, \`${COLUMN}\` written only in ${SOLE_WRITER}`,
);
