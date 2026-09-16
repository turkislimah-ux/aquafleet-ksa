#!/usr/bin/env node
// Standing guard: nothing hand-writes SQL against `trucks` outside the sanctioned
// surfaces.
//
// WHY THIS EXISTS, GIVEN THE OTHER GUARD
// -----------------------------------------------------------------------------
// scripts/capacity-single-writer-check.mjs keeps `capacity_m3` to one writer, and
// it does that through the TypeScript AST — object keys, shorthand keys, member
// assignments. That is the right instrument for TypeScript and it is BLIND to a
// string. This passes it without a murmur:
//
//     await client.query("update public.trucks set capacity_m3 = 33 where id = $1");
//
// To the AST that is a StringLiteral, which the other check does not even visit.
// At runtime it is a 23514 — 0201 ties the column to capacity_value/capacity_unit
// with `is not distinct from`, so a lone `capacity_m3` no longer saves. Worse, a
// hand-written `update trucks set capacity_value = ...` that FORGETS capacity_m3
// does not error at all: the check constraint is satisfied by a stale pair only
// when the two happen to agree, and when they disagree it fails at a distance,
// in someone else's import, on a Sunday.
//
// So: the AST guard names the COLUMN, this one names the TABLE. Neither one
// subsumes the other and both are cheap.
//
// WHAT COUNTS AS A HIT
// -----------------------------------------------------------------------------
// SQL TEXT ONLY — `insert into [public.]trucks` / `update [only] [public.]trucks`
// in any scanned file, with any whitespace or newline between the tokens, quoted
// or not.
//
// PostgREST calls (`supabase.from("trucks").update(...)`) are deliberately NOT
// hits. app/fleet/actions.ts is the sanctioned write surface for vehicles and it
// is full of them; flagging those would make this check a permanent lie that
// everyone learns to ignore. The column-level guard already covers what those
// calls put in the row. This one exists for the path that goes AROUND the client.
//
// Comments are stripped before matching, so the prose above — which says the
// forbidden thing several times in plain English — does not trip the check that
// contains it. String contents are KEPT, because a string is exactly where the
// SQL we are hunting lives.
//
// KNOWN LIMIT, stated rather than hidden: the stripper is a character scanner,
// not a parser. A regex literal containing a lone quote character could open a
// string region it should not, and SQL after it on the same line would be missed.
// No scanned file does that today, and the positive controls below would not
// catch it if one did. If this check ever has to be trusted against hostile input
// rather than habit, it needs a real lexer.
//
// PROVING IT CAN FAIL
// -----------------------------------------------------------------------------
// Two mechanisms, because "found nothing" and "looked nowhere" print the same
// word otherwise:
//
//   1. LIVE POSITIVE CONTROLS. The two allowlisted fixtures really do write
//      `trucks` in SQL text, and every green run asserts that the matcher still
//      SEES them. If the regex rots, the walker loses an extension, or the
//      stripper eats the wrong region, those stop matching and this goes RED —
//      pointing at itself instead of quietly blessing the repo.
//   2. An argv root override, for a negative control:
//
//        mkdir -p /tmp/tw && printf 'const q = `update trucks set x = 1`;\n' > /tmp/tw/bad.ts
//        node scripts/trucks-write-surface-check.mjs /tmp/tw      # must exit 1
//
// Usage:  node scripts/trucks-write-surface-check.mjs           exit 0 = green
//         node scripts/trucks-write-surface-check.mjs <dir...>  negative control

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Repo root at RUNTIME, never a hardcoded home directory — the lesson
// scripts/i18n-lookup-single-source-check.mjs records in its own header.
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
const TABLE = "trucks";

// The roots named in the rule. Migrations are not among them — see ALLOWLIST.
const DEFAULT_ROOTS = ["app", "lib", "scripts"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build"]);

// Wider than the rule's ".ts/.mjs/.sql" on purpose. A guard that skips .tsx
// because nobody thought of it is the classic way one of these dies quietly.
const EXTS = new Set([".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs", ".js", ".sql"]);

// Repo-relative. A trailing "/" means "everything under here".
//
//   lib/capacity.ts            THE capacity writer. Holds no SQL today; listed
//                              because if it ever needs raw SQL, it is the file
//                              that is allowed to have it.
//   supabase/migrations/       DDL and data moves belong in a migration. Outside
//                              DEFAULT_ROOTS, so inert right now — it is here so
//                              that widening the roots stays correct instead of
//                              going red on two hundred legitimate files.
//   the two fixtures           Test harnesses that talk to Postgres through `pg`
//                              directly. No PostgREST, no server action, so they
//                              have no helper to call. They are also the live
//                              positive controls below.
const ALLOWLIST = [
  "lib/capacity.ts",
  "supabase/migrations/",
  "scripts/db/inventory-money-check.ts",
  "scripts/drivers-active-restore-check.sql",
];

// Files that MUST match, every run. Losing one is a failure of this check, not
// a pass for the repo.
const POSITIVE_CONTROLS = [
  "scripts/db/inventory-money-check.ts",
  "scripts/drivers-active-restore-check.sql",
];

// Assembled from parts so the source of this file never contains the forbidden
// phrase contiguously — otherwise the guard flags itself and has to be
// allowlisted, which is a hole you can drive anything through.
const WRITE_RE = new RegExp(
  String.raw`(?:insert\s+into|update(?:\s+only)?)\s+` + // the verb
    String.raw`(?:"?public"?\s*\.\s*)?` + //               optional schema
    String.raw`"?${TABLE}"?(?![\w"])`, //                  the table, whole word
  "gi",
);

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

function isAllowed(rel) {
  return ALLOWLIST.some((a) => (a.endsWith("/") ? rel.startsWith(a) : rel === a));
}

/**
 * Blank out comments, keep everything else — INCLUDING string contents, which is
 * where the SQL lives. Every consumed character is replaced by exactly one
 * character (space, or the newline itself), so offsets in the returned text still
 * index the original and line numbers need no bookkeeping.
 */
function stripComments(src, lineComment) {
  let out = "";
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    // `https://` is not a comment. The one false positive worth special-casing.
    if (src.startsWith(lineComment, i) && !(lineComment === "//" && src[i - 1] === ":")) {
      while (i < n && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }

    if (c === "/" && src[i + 1] === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += i < n ? "  " : "";
      i += 2;
      continue;
    }

    if (c === "'" || c === '"' || c === "`") {
      out += c;
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        const ch = src[i];
        out += ch;
        i++;
        if (ch === c) break;
      }
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

function findWrites(file) {
  let src;
  try {
    src = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  // Cheap reject: a file that never names the table cannot write it.
  if (!src.toLowerCase().includes(TABLE)) return [];

  const code = stripComments(src, path.extname(file) === ".sql" ? "--" : "//");

  const hits = [];
  WRITE_RE.lastIndex = 0;
  for (let m = WRITE_RE.exec(code); m; m = WRITE_RE.exec(code)) {
    const line = code.slice(0, m.index).split("\n").length;
    hits.push({
      line,
      // Show the ORIGINAL line, not the comment-blanked one.
      text: src.split("\n")[line - 1].trim(),
    });
  }
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
  if (!isNegativeControl && isAllowed(rel)) continue;
  for (const hit of findWrites(file)) offenders.push({ rel, ...hit });
}

const problems = [];

if (offenders.length) {
  problems.push(
    `${offenders.length} raw-SQL write${offenders.length === 1 ? "" : "s"} to \`${TABLE}\` outside the allowlist:`,
    ...offenders.map((o) => `    ${o.rel}:${o.line}  ${o.text}`),
    "",
    "  Vehicle rows are written through app/fleet/actions.ts, which builds the",
    "  capacity triple with capacityColumns() from lib/capacity.ts. Hand-written",
    "  SQL skips that and 0201's trucks_capacity_m3_consistent_check will either",
    "  reject the row (23514) or, worse, accept a stale capacity_m3 that every",
    "  m3 reader in the app then believes.",
    "",
    "  Schema and data moves belong in supabase/migrations/. Test fixtures that",
    "  legitimately need raw SQL go in the ALLOWLIST at the top of this file,",
    "  with a reason.",
  );
}

// Guard the guard.
if (!isNegativeControl) {
  if (!files.length) {
    problems.push(
      `Scanned ${scanRoots.join(", ")} and found no files. This check checked nothing.`,
    );
  }
  for (const rel of POSITIVE_CONTROLS) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) {
      problems.push(
        `Positive control ${rel} is gone.`,
        "  Drop it from POSITIVE_CONTROLS and ALLOWLIST together, or this check",
        "  has lost its proof that the matcher still works.",
      );
    } else if (findWrites(full).length === 0) {
      problems.push(
        `Positive control ${rel} no longer matches.`,
        `  It is supposed to contain a raw-SQL write to \`${TABLE}\`. Either the`,
        "  fixture changed, or the matcher in this file has stopped working and a",
        "  green run would mean nothing.",
      );
    }
  }
}

if (problems.length) {
  console.error(`trucks-write-surface-check: RED\n\n  ${problems.join("\n  ")}\n`);
  process.exit(1);
}

console.log(
  `trucks-write-surface-check: green — ${files.length} files scanned, no raw-SQL \`${TABLE}\` writes outside ${ALLOWLIST.length} allowlisted paths`,
);
