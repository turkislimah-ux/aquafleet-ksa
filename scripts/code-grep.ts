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
// SELF-TESTING ON EVERY RUN. Both fixture sets below execute before any file is
// read, and a failure aborts instead of reporting. A verification tool that
// might itself be broken is worse than none, and a --self-test flag nobody
// passes rots. It costs well under a millisecond.
//
// READING ZERO FILES IS NOT A PASS. The lexer above was right and the tool still
// reported a false green, because path handling sat outside it: a directory
// argument (`code-grep 'ar-SA' app lib components`) was passed straight to
// `git show :app`, which fails, and the read loop's catch — there to skip
// untracked files — swallowed it. Three arguments, zero files read, and a
// report reading "no live reference in 3 file(s)", the 3 being the ARGUMENT
// count. A false GREEN is worse than the false red this file was written to
// prevent: it is indistinguishable from a real pass. So paths are now RESOLVED
// before anything is read (resolvePaths), directories expand, a path that is
// neither in the index nor on disk is fatal, and the count reported is the
// number of files ACTUALLY read — which, if it is zero, is itself fatal.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
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
// Path resolution
// ---------------------------------------------------------------------------

/** The extensions the no-argument scan covers, and the filter a directory gets. */
const SCAN_GLOBS = ["*.ts", "*.tsx", "*.css", "*.sql"];
const SCAN_EXTS = SCAN_GLOBS.map((g) => g.slice(1));

export type PathKind = "file" | "dir" | "missing";

export type ResolvedPaths = {
  /** Tracked files to read, in argument order, deduped. */
  files: string[];
  /** On disk but not in the index — no staged blob to read. */
  untracked: string[];
  /** In neither the index nor the working tree. Fatal: the caller typed it wrong. */
  missing: string[];
  /** A real directory holding nothing this tool scans. Fatal: it can only produce a false green. */
  emptyDirs: string[];
};

/**
 * Turns CLI path arguments into a file list, CLASSIFYING everything it cannot
 * read rather than dropping it. Pure: `git` and `stat` are injected so the
 * fixtures below can drive it against a fake index.
 *
 * Never exits — every failure mode comes back as a bucket, and main() decides.
 * That is what makes it testable, and testing it is the whole point.
 */
export function resolvePaths(
  paths: string[],
  git: (a: string[]) => string,
  stat: (p: string) => PathKind,
): ResolvedPaths {
  const lines = (s: string) => s.split("\n").filter(Boolean);

  if (paths.length === 0) {
    return { files: lines(git(["ls-files", ...SCAN_GLOBS])), untracked: [], missing: [], emptyDirs: [] };
  }

  const files: string[] = [];
  const untracked: string[] = [];
  const missing: string[] = [];
  const emptyDirs: string[] = [];
  const seen = new Set<string>();
  const keep = (f: string) => {
    if (seen.has(f)) return; // a file named twice — directly and inside a directory — is read once
    seen.add(f);
    files.push(f);
  };

  for (const p of paths) {
    const tracked = lines(git(["ls-files", "--", p]));

    // Exactly itself: a tracked file, read whatever its extension — an explicit
    // argument is an instruction, not a suggestion.
    if (tracked.length === 1 && tracked[0] === p) {
      keep(p);
      continue;
    }

    // Anything else that matched is a directory (or a glob) standing in for its
    // contents. Filter to the same extensions the no-argument scan uses.
    if (tracked.length > 0) {
      const scannable = tracked.filter((f) => SCAN_EXTS.some((e) => f.endsWith(e)));
      if (scannable.length === 0) emptyDirs.push(p);
      else scannable.forEach(keep);
      continue;
    }

    // Matched nothing in the index. Which of the three reasons decides the exit code.
    const kind = stat(p);
    if (kind === "dir") emptyDirs.push(p);
    else if (kind === "file") untracked.push(p);
    else missing.push(p);
  }

  return { files, untracked, missing, emptyDirs };
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

// A fake index, so path resolution is pinned without touching the repo. `git`
// answers the two ls-files shapes resolvePaths issues; `stat` answers from the
// same list plus any untracked-on-disk extras.
function fakeGit(index: string[]) {
  const matches = (spec: string, f: string) =>
    spec.startsWith("*.") ? f.endsWith(spec.slice(1)) : f === spec || f.startsWith(spec.replace(/\/+$/, "") + "/");
  return (a: string[]) => {
    if (a[0] !== "ls-files") throw new Error(`fixture git got an unexpected call: ${a.join(" ")}`);
    const specs = a.slice(1).filter((s) => s !== "--");
    return index.filter((f) => specs.some((s) => matches(s, f))).join("\n");
  };
}

function fakeStat(index: string[], disk: string[]) {
  const all = [...index, ...disk];
  return (p: string): PathKind => {
    if (all.includes(p)) return "file";
    if (all.some((f) => f.startsWith(p.replace(/\/+$/, "") + "/"))) return "dir";
    return "missing";
  };
}

const PATH_FIXTURES: {
  name: string;
  args: string[];
  index: string[];
  disk?: string[];
  expect: { files: string[]; untracked?: string[]; missing?: string[]; emptyDirs?: string[] };
}[] = [
  {
    name: "THE FALSE GREEN: a directory argument EXPANDS — it is not silently skipped",
    args: ["app", "lib"],
    index: ["app/page.tsx", "app/trips/page.tsx", "app/logo.svg", "lib/invoice.ts", "components/x.tsx"],
    expect: { files: ["app/page.tsx", "app/trips/page.tsx", "lib/invoice.ts"] },
  },
  {
    name: "a directory expands to the SCANNED extensions only",
    args: ["docs"],
    index: ["docs/notes.md", "docs/schema.sql"],
    expect: { files: ["docs/schema.sql"] },
  },
  {
    name: "a directory holding nothing scannable is an ERROR, never an empty pass",
    args: ["docs"],
    index: ["docs/notes.md"],
    expect: { files: [], emptyDirs: ["docs"] },
  },
  {
    name: "an explicitly named tracked file is read whatever its extension",
    args: ["lib/invoice.ts", "README.md"],
    index: ["lib/invoice.ts", "README.md"],
    expect: { files: ["lib/invoice.ts", "README.md"] },
  },
  {
    name: "a path in neither the index nor the working tree is FATAL, not a skip",
    args: ["lib/gone.ts"],
    index: ["lib/invoice.ts"],
    expect: { files: [], missing: ["lib/gone.ts"] },
  },
  {
    name: "an untracked file is its own bucket — not confused with a bogus path",
    args: ["lib/new.ts"],
    index: ["lib/invoice.ts"],
    disk: ["lib/new.ts"],
    expect: { files: [], untracked: ["lib/new.ts"] },
  },
  {
    name: "a file reached twice, directly and via its directory, is read once",
    args: ["lib", "lib/invoice.ts"],
    index: ["lib/invoice.ts"],
    expect: { files: ["lib/invoice.ts"] },
  },
  {
    name: "no arguments still means every tracked ts/tsx/css/sql file",
    args: [],
    index: ["app/page.tsx", "lib/invoice.ts", "app/globals.css", "supabase/migrations/0001_x.sql", "README.md"],
    expect: { files: ["app/page.tsx", "lib/invoice.ts", "app/globals.css", "supabase/migrations/0001_x.sql"] },
  },
];

function pathFailures(): string[] {
  const fails: string[] = [];
  for (const f of PATH_FIXTURES) {
    const got = resolvePaths(f.args, fakeGit(f.index), fakeStat(f.index, f.disk ?? []));
    const want: ResolvedPaths = {
      files: f.expect.files,
      untracked: f.expect.untracked ?? [],
      missing: f.expect.missing ?? [],
      emptyDirs: f.expect.emptyDirs ?? [],
    };
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      fails.push(`${f.name}\n      expected ${JSON.stringify(want)}\n      got      ${JSON.stringify(got)}`);
    }
  }
  return fails;
}

function selfTest() {
  const failed = FIXTURES.filter((f) => (liveHits(f.src, f.needle, f.mode).length > 0) !== f.live);
  const pathFailed = pathFailures();
  if (failed.length > 0 || pathFailed.length > 0) {
    console.error("code-grep SELF-TEST FAILED — refusing to report results.");
    for (const f of failed) console.error(`  expected ${f.live ? "LIVE" : "comment-only"}: ${f.name}`);
    for (const m of pathFailed) console.error(`  path resolution: ${m}`);
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
  const stat = (p: string): PathKind => {
    try {
      return statSync(p).isDirectory() ? "dir" : "file";
    } catch {
      return "missing";
    }
  };

  const { files, untracked, missing, emptyDirs } = resolvePaths(args.slice(1), git, stat);

  // An argument that resolved to nothing is fatal. Scanning the rest and
  // reporting green would answer a question narrower than the one asked.
  if (missing.length > 0 || emptyDirs.length > 0) {
    console.error(`code-grep: refusing to report — ${missing.length + emptyDirs.length} argument(s) resolved to no file.`);
    for (const p of missing) console.error(`  no such path, in neither the index nor the working tree: ${p}`);
    for (const p of emptyDirs) console.error(`  no tracked ${SCAN_GLOBS.join(" ")} files under: ${p}`);
    process.exit(2);
  }

  // An untracked file HAS no staged blob, so the default mode has nothing to
  // read — a real skip, but a loud one. --worktree reads disk, so it can.
  const targets = [...files];
  for (const p of untracked) {
    if (worktree) targets.push(p);
    else console.error(`code-grep: skipping ${p} — untracked, so it has no staged blob. Re-run with --worktree to read it from disk.`);
  }

  const found: { file: string; line: number; text: string }[] = [];
  let read = 0;
  for (const f of targets) {
    let src: string;
    try {
      src = worktree ? readFileSync(f, "utf8") : git(["show", `:${f}`]);
    } catch (e) {
      // resolvePaths already proved this path exists. Failing here means
      // something changed underneath us — silence would be the false green again.
      console.error(`code-grep: cannot read ${f} — ${String((e as Error).message).split("\n")[0]}`);
      process.exit(2);
    }
    read++;
    for (const h of liveHits(src, needle, modeFor(f))) found.push({ file: f, ...h });
  }

  // Zero files read proves nothing about the needle, whatever the argument count said.
  if (read === 0) {
    console.error(`code-grep: read 0 files — that is not evidence about "${needle}".`);
    process.exit(2);
  }

  if (found.length === 0) {
    console.log(`No live reference to "${needle}" in ${read} file(s) read — comments only, if anything.`);
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
