// Answers ONE question: does this identifier still appear anywhere that is not
// a comment? That is the question CLAUDE.md's epitaph rule asks after every
// removal, and getting it wrong is expensive in both directions — a false
// "still live" sends you hunting a call site that is a sentence, and a false
// "gone" ships a dangling reference.
//
// WHY THIS IS NOT A grep CHAIN. The rule used to be written as
//   git show :<path> | grep -nF '<id>' | grep -vE '^\s*[0-9]+:\s*(\*|//|--|/\*)'
// which drops lines whose FIRST character starts a comment. A block comment's
// second line has no marker of its own, so the filter keeps it and reports
// prose as code. It bit on exactly the removal that prompted this file: a JSX
// note reading "The helper (lib/trip-ref.ts's sampleTripRef) is deleted" was
// reported as a live reference to the thing it was announcing the death of.
// No line-oriented filter can fix this — a comment's extent is not a property
// of any single line.
//
// SO THIS IS A LEXER, NOT A REGEX. Comments are found by scanning, which means
// tracking the three things that can contain comment-looking text and must not
// be treated as comments: quoted strings, template literals (with their ${}
// re-entry into code), and regex literals. A bare /\/\*[\s\S]*?\*\//g would
// happily start a "comment" at a /* inside a CSS string and swallow real code
// up to the next */ — over-stripping, which is the DANGEROUS direction, since
// deleted text cannot be searched.
//
// COMMENTS ARE BLANKED, NOT DELETED. Every non-newline character becomes a
// space, so byte offsets and line numbers survive and a hit can be reported at
// its true location. The older helper dropped whole lines and could only ever
// report a count.
//
// SELF-TESTING ON EVERY RUN. The fixtures below execute before any file is
// read, and a failure aborts instead of reporting. A verification tool that
// might itself be broken is worse than none, and a --self-test flag nobody
// passes rots. It costs well under a millisecond.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Mode = "ts" | "css" | "sql";

function modeFor(file: string): Mode {
  if (file.endsWith(".sql")) return "sql";
  if (file.endsWith(".css")) return "css";
  return "ts";
}

// Characters after which a `/` begins a REGEX rather than a division. The list
// is the standard heuristic: an operator or an opener cannot be followed by a
// division, so a slash there must open a pattern. Getting this wrong only
// matters for a regex containing an unescaped `//` or `/*`, which is rare and
// which the fixtures below pin.
const REGEX_OK_AFTER = new Set("(,=:[!&|?{};+-*%~^<>".split(""));
const REGEX_OK_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete",
  "void", "do", "else", "yield", "await", "case",
]);

/**
 * Replaces every comment with spaces, preserving length, line count and
 * therefore every line number. Strings, template literals and regex literals
 * are left intact — a comment marker inside one is not a comment.
 */
export function stripComments(src: string, mode: Mode = "ts"): string {
  const out = src.split("");
  const n = src.length;

  // Tracks ${ } re-entry inside template literals. "tpl" means a `...` is open;
  // "brace" means we are inside its ${ } and are reading code again.
  const stack: ("tpl" | "brace")[] = [];

  let i = 0;
  let prev = ""; // last significant (non-space, non-comment) character
  let prevWord = "";

  const blankTo = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    // ---- comments -------------------------------------------------------
    const lineComment =
      (mode !== "sql" && c === "/" && c2 === "/") || (mode === "sql" && c === "-" && c2 === "-");
    if (lineComment) {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blankTo(i, j);
      i = j;
      continue;
    }
    if (mode !== "sql" && c === "/" && c2 === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(n, j + 2);
      blankTo(i, j);
      i = j;
      continue;
    }

    // ---- strings --------------------------------------------------------
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === c || src[j] === "\n") break;
        j++;
      }
      i = j + 1;
      prev = c; prevWord = "";
      continue;
    }

    // ---- template literals ----------------------------------------------
    if (mode === "ts" && c === "`") {
      stack.push("tpl");
      i++;
      // Scan the template body here rather than via a flag, so ${ } can push
      // back into the main loop with the template still remembered.
      while (i < n && stack[stack.length - 1] === "tpl") {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "`") { stack.pop(); i++; break; }
        if (src[i] === "$" && src[i + 1] === "{") { stack.push("brace"); i += 2; break; }
        i++;
      }
      prev = "`"; prevWord = "";
      continue;
    }
    if (c === "}" && stack[stack.length - 1] === "brace") {
      stack.pop();
      i++;
      // Back inside the template body: resume scanning it.
      while (i < n && stack[stack.length - 1] === "tpl") {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "`") { stack.pop(); i++; break; }
        if (src[i] === "$" && src[i + 1] === "{") { stack.push("brace"); i += 2; break; }
        i++;
      }
      prev = "}"; prevWord = "";
      continue;
    }

    // ---- regex literals --------------------------------------------------
    if (mode === "ts" && c === "/" && (prev === "" || REGEX_OK_AFTER.has(prev) || REGEX_OK_KEYWORDS.has(prevWord))) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const d = src[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "\n") break;            // unterminated: it was division
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) { closed = true; j++; break; }
        j++;
      }
      if (closed) { i = j; prev = "/"; prevWord = ""; continue; }
      // fall through: treat as an ordinary character
    }

    if (/\s/.test(c)) { i++; continue; }
    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      prevWord = src.slice(i, j);
      prev = src[j - 1];
      i = j;
      continue;
    }
    prev = c; prevWord = "";
    i++;
  }

  return out.join("");
}

/** Live (non-comment) hits for `needle`, as 1-based line numbers with text. */
export function liveHits(src: string, needle: string, mode: Mode = "ts") {
  const stripped = stripComments(src, mode);
  const hits: { line: number; text: string }[] = [];
  const srcLines = src.split("\n");
  stripped.split("\n").forEach((l, idx) => {
    if (l.includes(needle)) hits.push({ line: idx + 1, text: srcLines[idx].trim() });
  });
  return hits;
}

// ---------------------------------------------------------------------------
// Fixtures. Run on every invocation — see the header.
//
// Each is a MINIMAL reproduction of a way this has actually gone wrong, or
// could. The JSX pair is the one that prompted the file: the same identifier,
// once as prose across a comment's second line and once as a call.
// ---------------------------------------------------------------------------

const FIXTURES: { name: string; src: string; needle: string; mode: Mode; live: boolean }[] = [
  {
    name: "JSX comment spanning lines — the reported blind spot",
    src: '<div>\n  {/* the helper (lib/trip-ref.ts\'s sampleTripRef) is\n      deleted; this was its only caller. */}\n</div>',
    needle: "sampleTripRef", mode: "ts", live: false,
  },
  {
    name: "the same name, actually called",
    src: "<div>{sampleTripRef(initials)}</div>",
    needle: "sampleTripRef", mode: "ts", live: true,
  },
  { name: "line comment", src: "// sampleTripRef removed\nconst a = 1;", needle: "sampleTripRef", mode: "ts", live: false },
  {
    name: "block comment continuation line carries no marker",
    src: "/* one\n   sampleTripRef\n   three */\nconst a = 1;",
    needle: "sampleTripRef", mode: "ts", live: false,
  },
  {
    name: "a comment marker inside a STRING is not a comment",
    src: 'const u = "https://x/*y*/z"; sampleTripRef();',
    needle: "sampleTripRef", mode: "ts", live: true,
  },
  {
    name: "a CSS comment inside a template literal must not swallow the code after it",
    src: "const css = `\n  /* a note */\n  .x { color: red }\n`;\nsampleTripRef();",
    needle: "sampleTripRef", mode: "ts", live: true,
  },
  {
    name: "template ${} re-enters code, and a comment there is still a comment",
    src: "const s = `a ${ /* sampleTripRef */ b } c`;",
    needle: "sampleTripRef", mode: "ts", live: false,
  },
  {
    name: "and a call inside ${} is live",
    src: "const s = `a ${sampleTripRef(x)} c`;",
    needle: "sampleTripRef", mode: "ts", live: true,
  },
  {
    name: "a regex literal is not a comment opener",
    src: "const r = /\\/\\*[\\s\\S]*?\\*\\//g; sampleTripRef();",
    needle: "sampleTripRef", mode: "ts", live: true,
  },
  { name: "css block comment", src: "/* #statement-print {} */\n.a { color: red }", needle: "#statement-print", mode: "css", live: false },
  { name: "css live rule", src: "#statement-print { color: red }", needle: "#statement-print", mode: "css", live: true },
  { name: "sql -- comment", src: "-- drop_thing()\nselect 1;", needle: "drop_thing", mode: "sql", live: false },
];

function selfTest() {
  const failed = FIXTURES.filter((f) => (liveHits(f.src, f.needle, f.mode).length > 0) !== f.live);
  if (failed.length > 0) {
    console.error("code-grep SELF-TEST FAILED — refusing to report results.");
    for (const f of failed) console.error(`  expected ${f.live ? "LIVE" : "comment-only"}: ${f.name}`);
    process.exit(2);
  }
}

// AT MODULE LOAD, NOT INSIDE main(). Every importer gets the guarantee, not
// just the CLI — which is the point, since scripts/statement-parity-check.ts
// bases three assertions on this stripper and runs inside test:money. Placed
// here, that chain cannot report a comment-blind scan as green.
selfTest();

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const worktree = argv.includes("--worktree");
  const args = argv.filter((a) => a !== "--worktree");
  const needle = args[0];

  if (!needle) {
    console.error("usage: npx tsx scripts/code-grep.ts <identifier> [path...] [--worktree]");
    console.error("  Reads the STAGED blob by default (what would actually be committed);");
    console.error("  --worktree reads the files on disk instead.");
    console.error("  Exit 0 = no live reference. Exit 1 = still referenced.");
    process.exit(2);
  }

  const git = (a: string[]) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  let files = args.slice(1);
  if (files.length === 0) {
    files = git(["ls-files", "*.ts", "*.tsx", "*.css", "*.sql"]).split("\n").filter(Boolean);
  }

  const found: { file: string; line: number; text: string }[] = [];
  for (const f of files) {
    let src: string;
    try {
      src = worktree ? readFileSync(f, "utf8") : git(["show", `:${f}`]);
    } catch {
      continue; // untracked, or tracked but not staged
    }
    for (const h of liveHits(src, needle, modeFor(f))) found.push({ file: f, ...h });
  }

  if (found.length === 0) {
    console.log(`No live reference to "${needle}" in ${files.length} file(s) — comments only, if anything.`);
    process.exit(0);
  }
  console.log(`"${needle}" is still referenced in code:`);
  for (const h of found) console.log(`  ${h.file}:${h.line}: ${h.text}`);
  process.exit(1);
}

// ONLY as a CLI. scripts/statement-parity-check.ts imports stripComments from
// here, and an unguarded main() would run — and process.exit() — on that
// import, killing the harness before its first assertion.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
