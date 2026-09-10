# CLAUDE.md — AquaFleet KSA (Bousla / بوصلة)

**Read this file first, every session.** RULES ONLY, changes rarely. **Current
state — what is built, in flight, open — lives in `.planning/HANDOFF.md`.** Read
that second, then recent `git log`. This file holds no state and no build
history: §7 is a routing table, one State line and the rule under it. A
state-looking line here is a bug.

**`.planning/HANDOFF.json` and `preview/.planning/HANDOFF.json` are NOT ours** —
gsd plugin's, gitignored, rewritten from an empty template after tool calls.
Never read either for state, never stage them. Ours is `.planning/HANDOFF.md`
(+ `AQUAFLEET-HANDOFF.json`).

---

## 1. What this project is

AquaFleet KSA (internal: Bousla / بوصلة) — fleet management for Bin Slimah Group,
a 50+ year-old family water-transport & treatment business in Riyadh (~40 trucks,
3 stations). Non-technical founder (Turki) directs. Manages trucks, drivers,
staff, trips, projects, commissions, leave, stations, finance/invoicing.

**Those two figures describe the BUSINESS, not the database.** The live rows are
a partial working set and have never matched them; they are Turki's confirmed
facts about his own fleet, **the only figures here that re-measuring cannot
settle**. Do NOT "correct" them from a `count(*)`; the gap is expected, do not
re-raise it.

- **Stack:** Next.js (App Router) + Supabase (Postgres) + Tailwind. TypeScript.
- **Repo:** `~/aquafleet-ksa`, GitHub `turkislimah-ux/aquafleet-ksa`, branch `main`.
- **Terminal:** macOS zsh. **Migrations run in the Supabase SQL Editor (browser).**
  Supabase is also connected to Claude directly — use it to verify schema/state.

---

## 2. Roles — do NOT cross these lines

- **Claude the architect** (chat instance): architecture, data model, SQL review,
  git discipline, and the prompts that direct Claude Code. Specifies **behavior,
  data, logic, constraints, and content/color MAPPING only. NEVER visual design**
  — not layout, styling, shapes, sizing, spacing or treatment. Every time the
  architect interfered with design the result was worse. Hard rule.
- **Claude Code** (executing instance): **ALL file edits, ALL design decisions.**
  Builds from `preview/` as the spec. Reads the relevant skills.
- **Turki** directs, and verifies every change in-browser (the gate is in §5).

---

## 3. `preview/` is the authoritative design spec (READ-ONLY)

The original demo, and ground truth for design and features. **Never edit it.**
Building or restyling a page starts by reading its `preview/` source plus
`app.css` and pulling real values (hex, class structure, layout), never
eyeballing them — when design failed here it was *described* instead of *pulled*.

- `index.html` entry · `pages-1.js` / `pages-2.js` page markup+logic (Kanban is
  in pages-1) · `app.css` ALL styling · `archive.js` Archive · `map.js` route/map
  (Route Optimization, deferred) · `data.js` mock data · `components.js`,
  `icons.js`, `i18n.js`, `app.js`

---

## 4. Skills — invoke per task, do NOT load all at once

Loading every skill at once wastes context and has crashed sessions.

- **UI / design / new pages** → **`frontend-design`** (its brainstorm →
  critique-vs-defaults → build process, not a mechanical pass) +
  **`web-design-guidelines`**. The taste standard. Match `preview/` alongside.
- **DB: migrations, schema, queries, RLS** → **`supabase-postgres-best-practices`**.
- **React composition / performance** → **`vercel-react-best-practices`** +
  **`vercel-composition-patterns`**.
- **Verifying UI in-browser** → **`webapp-testing`** (Playwright).
- **Domain rules (money, stock, RPCs, invariants)** →
  `.claude/skills/aquafleet-domain/SKILL.md` — money-core boundary, FIFO,
  one-SKU-one-warehouse, RPC and counter-table conventions. **Read it before any
  migration, RPC, or server-action work.**
- **Planning / phases** → the **`gsd`** suite, which does NOT drive this project.
  `.planning/AQUAFLEET-HANDOFF.json` borrows gsd's SCHEMA and is filled BY HAND;
  `phase`/`plan`/`task` stay null deliberately — inventing a phase number we
  never ran is fiction. **Borrowing the schema is not giving gsd the PATH —
  conflating them blanked three files** (post-mortem:
  `.planning/gsd-handoff-clobber-note.md`), which is why ours lives elsewhere.
  Before leaning on gsd, say how it fits preview/-as-spec, §5 and the handoff
  file — adopt it deliberately, never by drift.

---

## 5. Workflow discipline (non-negotiable)

- **One logical unit per commit**, each tsc-clean. `noUnusedLocals` +
  `noUnusedParameters` are enforced — unused = build failure. A param kept for
  signature shape gets an `_` prefix, never deletion.
- **Explicit-path `git add`**, listing each file, **NEVER `git add .`** — on ONE
  line, then `git status` to confirm; a multi-line paste has silently staged
  nothing. **Then inspect the STAGED BLOB, not the working tree:** `git show
  :<path>` is what commits. A file can be right on disk and blank in the index.
- **A `grep -c` FOR A REMOVED IDENTIFIER HITS THE COMMENT DOCUMENTING THE
  REMOVAL — STRIP COMMENTS BEFORE TRUSTING THE COUNT.** The epitaph fails the
  very check that confirms the burial, and reads exactly like a failed fix. Seen
  7+ times, still live: the ONLY uncoloured `divide-` left in the tree (§6) is
  the comment documenting the fix. The tool:
```sh
  npx tsx scripts/code-grep.ts '<identifier>' [path...]
```
  Exit 0 = genuinely gone; exit 1 prints every live site. Reads the STAGED blob
  (`--worktree` for disk), scans all tracked ts/tsx/css/sql when given no path.
  **Do NOT hand-roll it with `grep`:** a line filter CANNOT work, because a block
  comment's continuation lines carry no marker, so dropping the lines that
  *begin* one reports prose as code. The script lexes, self-tests at import, and
  two `test:money` checks import it, so a broken stripper turns that suite red
  instead of green. **The cases that burned us are fixtures inside it now.**
- **Quote dynamic-route paths:** `git add 'app/fleet/[id]/page.tsx'` — zsh globs
  `[id]` silently. **Avoid `!` in commit messages** (history expansion).
- **`.planning/HANDOFF.md` is ours and committed** — read at session start, write
  at session end. The `HANDOFF.json`s are gsd's (header).
- **Migrations:** sequential `00NN_name.sql`, **DRAFTED to disk and never
  self-applied by Claude Code** — draft, stop, let Turki/the architect run it.
  **Verify the file exists** (`ls supabase/migrations/ | tail -3`) before it runs
  — migrations have been "drafted in conversation" and never written. Breaking
  schema changes go **code-then-migrate**: build, migrate, verify in-browser,
  commit together.
- **BARE STATEMENTS ONLY — a NEW migration carries no `begin;` / `commit;`.**
  The SQL Editor already wraps each submission: a nested `begin;` warns and is
  ignored, then the trailing `commit;` ends the EDITOR's transaction. Grids
  print, the run reads green, **nothing was created** — 0173 v1 did exactly this.
  **0173 is the boundary: 0173+ are bare, 147 of the 170 files up to 0172 still
  carry them.** Those predate the rule — do NOT "fix" them; 147 false hits is a
  false catastrophe (§6). That editor transaction is also what satisfies §6's
  "same transaction".
- **A MIGRATION'S OWN RESULT-GRID IS NOT PROOF IT APPLIED.** Its verification
  SELECTs are a claim; the catalog is the evidence. Confirm after the fact
  against `pg_index` / `pg_proc` / `has_function_privilege`.
- **Turki verifies in-browser before every commit.** Nothing commits unverified.
- **THE DATABASE OUTRANKS THE NOTES on any question of DB state.** MCP-applied
  corrections touch the database and **never touch the repo**, so nothing in git
  signals that a note went stale. DB and note disagree → **the DB won**:
  re-measure, act on that, then fix the note. Never re-raise an item because a
  note still lists it open — one corrected trip was re-raised for several
  sessions by a note wrong about both its paid status and its count.
- **Re-measure every number before quoting it, ours included; a figure in a
  handoff is a pointer, not evidence.** **One that dates itself gets CUT, not
  updated** — a customer count and a file count both rotted here. **"X because Y"
  is only as strong as Y, so measure Y THIS turn**: never from memory, never off
  a filename. Two self-caught — a VAT/CR "match" counted on 2 rows not the table,
  and a table name read off its migration's filename, which reports a healthy
  migration as MISSING (§6). **Notes earn the strictest check: the next session
  trusts them without re-measuring.**
- **No build history in this file.** §7's 15KB cap is the trigger. **Compress by
  re-verifying every claim, never by trimming prose blind.** Passes 1–4 each
  found a stale fact; pass 5 (2026-09-09) found none and was read as convergence.
  **Pass 6 (2026-09-11) then found §6's ACL mechanism wrong** — a rule right in
  its instruction and wrong in its reason, which is the kind someone eventually
  argues their way out of. "Converged" is a measurement, never licence to skip
  the audit: the audit is what makes a cut safe, and the pass that finds nothing
  is indistinguishable beforehand from the one that finds the bug.

---

## 6. Architecture locks (persistent — do not violate)

- **Soft-delete, not hard-delete** for operational records (`terminated_at`,
  `archived_at`). Terminated = a pre-filter, never a state.
- **Derived driver state** (`lib/driver-state.ts`): 4 states, on_leave > off_duty
  > idle > active, server-computed. **EXACTLY TWO EXPRESSIONS:** the TS helper and
  `v_driver_state_now` (0106). `v_fleet_state_now` / `v_drivers_ops_now` compose on
  the view. A drift guard asserts agreement at Dashboard load. Do not add a third.
- **Water stations ≠ Operation stations** (0014). Separate; do NOT unify.
- **`lib/project-colors.ts`** = the shared id-hashed project colour palette.
- **Immutable keys** on lookup tables (`water_stations.key`) — a rename updates
  the name only.
- **`todayKey()` / local-date helpers** for Riyadh — avoid UTC skew.
- **`divide-*` CARRIES ITS OWN COLOUR: `divide-y divide-[rgb(var(--border))]`.**
  `border-color` is not inherited, so an inline `borderColor` paints the
  container's own frame only — the `divide-y` rules stay at preflight `#e5e7eb`,
  right in light mode and wrong in dark, which is how it reached seven sites.
  Nothing else covers it: no `borderColor.DEFAULT`, no `@layer base` for `*`. On
  a border-less container that inline style is inert — delete it. **An uncoloured
  `divide-` IS the bug**; grep is its regression test (§5).

**WHAT SURVIVES A REPLACEMENT IS NOT OBVIOUS, AND DIFFERS BY FORM.** The next
three rules are that one lesson; the fourth is how to read it back without
fooling yourself.

- **EVERY VIEW REPLACEMENT RESTATES ITS SECURITY FOOTER** — `security_invoker`,
  `revoke` from anon, `grant select` to authenticated. `create or replace view`
  silently drops reloptions, and does NOT refresh the view's comment (same OID),
  so a stale comment outlives the branch it described. **Then re-measure: the
  check is `views` == `security_invoker` and `anon_readable` == 0, never the
  absolute count.** SQL: domain skill, "View & function security footers".
- **`create or replace view` can only APPEND a column** (42P16) — never insert,
  reorder, rename or retype, and arithmetic retypes too (bare `numeric` vs
  `numeric(12,2)`); fix with an explicit cast, `(case … end)::numeric(12,2)`.
  Verify with `format_type(atttypid, atttypmod)` on `pg_attribute`, never by
  reading the view body.
- **EVERY FUNCTION DEFINITION CARRIES ITS OWN REVOKE — AND ONLY ONE FORM STRIPS
  THE ACL.** `drop`+`create` resets it to the Postgres default, `EXECUTE TO
  PUBLIC`, being a NEW OID; **`create or replace function` PRESERVES `proacl`.**
  Measured, not reasoned: 0150 replaces that way and asserts the before-ACL
  against the after (`is distinct from`, 0150:329), and production passed. **The
  rule does not weaken on that** — the two forms sit one line apart in a diff and
  re-revoking is free. So every SECURITY DEFINER function and every money or
  guarded RPC ends with a `revoke execute` naming **BOTH `public` and `anon`**
  (statement: domain skill, "View & function security footers"). The offender is
  the PUBLIC entry (EMPTY grantee, `=X/postgres`) that `anon` inherits, and the
  anon key ships in the client bundle; revoking `anon` alone changes nothing, and
  **no default-privileges equivalent exists for functions** (0161's covers TABLES
  only). **Not hypothetical:** 0115 defined `issue_driver_payslip` with NO revoke
  — it landed after 0083's sweep, so nothing ever gave it one — and 0118's
  `drop`+`create` added none either, leaving a definer money RPC callable by
  anyone holding the anon key, bypassing RLS *and* 0161's table revoke since a
  definer runs as its owner. Closed in **0163**; **0164** locked the guarded
  RPCs. Invariant: **zero NON-TRIGGER functions anon-executable** — trigger
  functions are unreachable via PostgREST and several legitimately remain.
- **TWO WAYS TO READ THAT BACK WRONG, and both INVERT the answer** — a healthy
  function reported as a breach. **A false catastrophe reads exactly like a real
  one.** Read back with `has_function_privilege('anon', …, 'execute')` = false,
  **never `proacl` matching**; identify by `p.oid::regprocedure::text`, **never
  `pg_get_function_identity_arguments()`**. Why each inverts: domain skill, same
  section.
- **New tables in `public` still end with `revoke all on public.X from anon`,**
  even though 0161 revoked anon everywhere. Default privileges only reach tables
  created AFTER them, and on a fresh `db reset` every earlier migration runs
  first — the per-table line is what makes each migration correct on its own.

---

## 7. Current state & what's next

**Do NOT append build history, implementation notes, or money rules here.**
- Money/schema rules → `.claude/skills/aquafleet-domain/SKILL.md`
- Session state → `.planning/HANDOFF.md`
- If this file exceeds 15KB, Code is appending. Cut back to this stub.

**State:** DB at migration 0195. All pages built+verified. Arabic phase complete (copy fixes land as they surface).

**Do not read this number out of `schema_migrations`** — its versions are
timestamps, not our `00NN`, and a SQL Editor run writes no row while an
MCP-applied migration does, so it is neither complete nor empty and cannot answer
"what number are we on". The files on disk and the objects in the catalog are the
record.
