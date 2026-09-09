# CLAUDE.md — AquaFleet KSA (Bousla / بوصلة)

**Read this file first, every session.** It is RULES ONLY and changes rarely.
**Current state — what is built, what is in flight, what is open — lives in
`.planning/HANDOFF.md`.** Read that second, then recent `git log`.

This file holds no state and no build history — §7 is a routing table, one State
line and the rule under it. If a state-looking line appears here, it is a bug.

**`.planning/HANDOFF.json` (no prefix) is NOT ours** — gsd plugin's, gitignored,
rewritten from an empty template after tool calls. Same for
`preview/.planning/HANDOFF.json`. Never read either for state, never stage it.
Ours is `.planning/HANDOFF.md` (+ `AQUAFLEET-HANDOFF.json`).

---

## 1. What this project is

AquaFleet KSA (internal: Bousla / بوصلة) — fleet management for Bin Slimah Group,
a 50+ year-old family water-transport & treatment business in Riyadh (~40 trucks,
3 stations). Non-technical founder (Turki) directs. Manages trucks, drivers,
staff, trips, projects, commissions, leave, stations, finance/invoicing.

**Those two figures describe the BUSINESS, not the database** — the live rows are
a partial working set and have never matched them. They are Turki's confirmed
facts about his own fleet, which makes them **the only figures here that
re-measuring cannot settle**: do NOT "correct" them from a `count(*)`. The gap is
expected; do not re-raise it.

- **Stack:** Next.js (App Router) + Supabase (Postgres) + Tailwind. TypeScript.
- **Repo:** `~/aquafleet-ksa`, GitHub `turkislimah-ux/aquafleet-ksa`, branch `main`.
- **Terminal:** macOS zsh. **Migrations run in the Supabase SQL Editor (browser).**
  Supabase is also connected to Claude directly — use it to verify schema/state.

---

## 2. Roles — do NOT cross these lines

- **Claude the architect** (chat instance): architecture, data model, SQL review,
  git discipline, and writing the prompts that direct Claude Code. Specifies
  **behavior, data, logic, constraints, and content/color MAPPING only.**
  **NEVER visual design** — not layout, styling, shapes, sizing, spacing, or
  treatment. When the architect has interfered with design the result was worse.
  Hard rule.
- **Claude Code** (executing instance): **ALL file edits, ALL design decisions.**
  Builds from `preview/` as the spec. Reads the relevant skills.
- **Turki** directs, and verifies every change in-browser (the gate is in §5).

---

## 3. `preview/` is the authoritative design spec (READ-ONLY)

The original demo, and the ground truth for design and features. **Never edit
it.** Building or restyling a page starts by reading its `preview/` source plus
`app.css`, and pulling real values (hex, class structure, layout) rather than
eyeballing them — when design has failed here it was because it was *described*
instead of *pulled from `preview/`*.

- `index.html` entry · `pages-1.js` / `pages-2.js` page markup+logic (Kanban is
  in pages-1) · `app.css` ALL styling · `archive.js` Archive · `map.js` route/map
  (Route Optimization, deferred) · `data.js` mock data · `components.js`,
  `icons.js`, `i18n.js`, `app.js`

---

## 4. Skills — invoke per task, do NOT load all at once

Loading every skill at once wastes context and has crashed sessions.

- **UI / design / new pages** → **`frontend-design`** (follow its brainstorm →
  critique-vs-defaults → build process, not a mechanical pass) +
  **`web-design-guidelines`**. The taste standard. Match `preview/` alongside.
- **DB: migrations, schema, queries, RLS** → **`supabase-postgres-best-practices`**.
- **React composition / performance** → **`vercel-react-best-practices`** +
  **`vercel-composition-patterns`**.
- **Verifying UI in-browser** → **`webapp-testing`** (Playwright).
- **Domain rules (money, stock, RPCs, invariants)** →
  `.claude/skills/aquafleet-domain/SKILL.md` — FIFO invariant, money-core
  boundary, one-SKU-one-warehouse, RPC conventions, counter-table pattern.
  **Read it before any migration, RPC, or server-action work.**
- **Planning / phases** → the **`gsd`** suite, which does NOT drive this project.
  `.planning/AQUAFLEET-HANDOFF.json` borrows gsd's SCHEMA and is filled BY HAND;
  `phase`/`plan`/`task` stay null deliberately, because inventing a phase number
  we never ran would be fiction. **Borrowing the schema is not giving gsd the
  PATH — conflating them blanked three files**, which is why ours lives elsewhere
  (header; post-mortem in `.planning/gsd-handoff-clobber-note.md`). Before leaning
  on gsd, report how it fits preview/-as-spec, §5's commit discipline and the
  handoff file, so it is adopted deliberately rather than by drift.

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
  7+ times, still live: §6's `divide-` grep has exactly one hit and it is a
  comment. The tool:
```sh
  npx tsx scripts/code-grep.ts '<identifier>' [path...]
```
  Exit 0 = genuinely gone; exit 1 prints every live site. Reads the STAGED blob
  (`--worktree` for disk), scans all tracked ts/tsx/css/sql when given no path.
  **Do NOT hand-roll this with `grep`.** A line filter CANNOT work: a block
  comment's continuation lines carry no marker, so dropping lines that *begin* a
  comment reports prose as code — a comment's extent is not a property of one
  line. The script lexes and self-tests at import, and two `test:money` checks
  import it, so a broken stripper turns that suite red instead of reporting green.
  **The cases that burned us are fixtures inside it now**, not anecdotes here.
- **Quote dynamic-route paths:** `git add 'app/fleet/[id]/page.tsx'` — zsh globs
  `[id]` silently. **Avoid `!` in commit messages** (history expansion).
- **`.planning/HANDOFF.md` is ours and committed** — read it at session start,
  write it at session end. The `HANDOFF.json`s are gsd's; see the header.
- **Migrations:** sequential `00NN_name.sql`, **DRAFTED to disk and never
  self-applied by Claude Code** — draft, stop, let Turki/the architect run it.
  **Verify the file exists** (`ls supabase/migrations/ | tail -3`) before it runs;
  migrations have been "drafted in conversation" and never written. Breaking
  schema changes go **code-then-migrate**: build against the new schema, migrate,
  verify in-browser, commit together. Additive columns are lower-risk.
- **BARE STATEMENTS ONLY — a NEW migration carries no `begin;` / `commit;`.**
  The SQL Editor already wraps each submission: a nested `begin;` warns and is
  ignored, then the trailing `commit;` ends the EDITOR's transaction. Grids
  print, the run reads green, **nothing was created** — 0173 v1 did exactly this.
  **0173 is the boundary: 0173+ are bare, while 147 of the 170 files up to 0172
  still carry `begin;`/`commit;`.** Those predate the rule and went in by another
  path — do NOT "fix" them; 147 false hits is a false catastrophe (§6). That same
  editor transaction satisfies §6's "re-revoke in the same transaction".
- **A MIGRATION'S OWN RESULT-GRID IS NOT PROOF IT APPLIED.** Verification SELECTs
  are a claim; the catalog is the evidence. Confirm against `pg_index` /
  `pg_proc` / `has_function_privilege` after the fact, never by reading what the
  migration printed.
- **Turki verifies in-browser before every commit.** Nothing commits unverified.
- **THE DATABASE OUTRANKS THE NOTES on any question of DB state.** MCP-applied
  corrections touch the database and **never touch the repo**, so nothing in git
  signals that a note went stale. DB and note disagree → **the DB won**:
  re-measure, act on the measurement, then fix the note. Never re-raise an item
  because a note still lists it open — one corrected trip was re-raised across
  several sessions by a note wrong about both its paid status and its count.
- **Re-measure every number before quoting it, ours included; a figure in a
  handoff is a pointer, not evidence.** **One that dates itself gets CUT, not
  updated** — a customer count and a file count both rotted here. **"X because Y"
  is only as strong as Y, so measure Y THIS turn**: never from memory, never off
  a filename. Two self-caught — a VAT/CR "match" counted on 2 rows instead of the
  table, and a table name read off its migration's filename, which reports a
  healthy migration as MISSING (§6). **Notes earn the strictest check, because
  the next session trusts them without re-measuring.**
- **No build history in this file.** §7's 15KB cap is the trigger. **Compress by
  re-verifying every claim, never by trimming prose blind.** Passes 1–4 each
  found a stale fact. **Pass 5 (2026-09-09) found ZERO** — every claim here was
  re-measured against the repo and the live catalog and held. Read that as the
  file having converged, not as licence to skip the audit: the audit is what
  makes a cut safe, and the one pass that finds nothing is indistinguishable
  beforehand from the one that finds the bug.

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
  `divide-` IS the bug**, and grep is its regression test (§5).

**WHAT SURVIVES A REPLACEMENT IS NOT OBVIOUS — AND WHAT DOES NOT IS A PERMISSION.**
Three of the next four rules are one lesson in three places; the fourth is how to
check it without fooling yourself.

- **EVERY VIEW REPLACEMENT RESTATES ITS SECURITY FOOTER** — `security_invoker`,
  `revoke` from anon, `grant select` to authenticated. `create or replace view`
  silently drops reloptions, and it does NOT refresh the view's comment (same
  OID), so a stale comment outlives the branch it described. **Then re-measure:
  the check is `views` == `security_invoker` and `anon_readable` == 0, never the
  absolute count.** SQL for footer and count: domain skill, "View & function
  security footers".
- **`create or replace view` can only APPEND a column** (42P16) — cannot insert,
  reorder, rename or retype. Arithmetic retypes too (bare `numeric` vs
  `numeric(12,2)`); fix with an explicit cast, `(case … end)::numeric(12,2)`.
  Verify with `format_type(atttypid, atttypmod)` on `pg_attribute`, never by
  reading the view body.
- **A REDEFINED FUNCTION IS EXECUTE-TO-PUBLIC AGAIN — RE-REVOKE IN THE SAME
  TRANSACTION.** `create or replace function` and `drop`+`create` both reset the
  ACL to the Postgres default, `EXECUTE TO PUBLIC`; `anon` inherits PUBLIC, and
  the anon key ships in the client bundle. **No default-privileges equivalent
  exists for functions** (0161's covers TABLES only) — nothing makes this stick.
  Every SECURITY DEFINER function and every money or guarded RPC ends with a
  `revoke execute` naming **BOTH `public` and `anon`** — statement in the domain
  skill, "View & function security footers". The offender is the PUBLIC entry
  (EMPTY grantee, `=X/postgres`); revoking `anon` alone changes nothing.
  **Not hypothetical:** 0115 defined `issue_driver_payslip`, 0118 replaced it
  without re-revoking, leaving a definer money RPC callable by anyone holding the
  anon key — bypassing RLS *and* 0161's table revoke, since a definer runs as its
  owner. Closed in **0163**; **0164** locked the guarded RPCs. Invariant: **zero
  NON-TRIGGER functions anon-executable** — trigger functions are unreachable via
  PostgREST and several legitimately remain.
- **TWO WAYS TO READ THAT BACK WRONG, and both INVERT the answer** — a healthy
  function reported as a breach. **A false catastrophe reads exactly like a real
  one.** Read back with `has_function_privilege('anon', …, 'execute')` = false,
  **never `proacl` matching**; identify by `p.oid::regprocedure::text`, **never
  `pg_get_function_identity_arguments()`**. Why each inverts: domain skill, same
  section.
- **New tables in `public` still end with `revoke all on public.X from anon`,**
  even though 0161 revoked anon everywhere. Default privileges only affect tables
  created AFTER it, so on a fresh `db reset` every earlier migration runs first —
  the per-table line is what makes each migration correct on its own.

---

## 7. Current state & what's next

**Do NOT append build history, implementation notes, or money rules here.**
- Money/schema rules → `.claude/skills/aquafleet-domain/SKILL.md`
- Session state → `.planning/HANDOFF.md`
- If this file exceeds 15KB, Code is appending. Cut back to this stub.

**State:** DB at migration 0191. All pages built+verified. Arabic phase complete (copy fixes land as they surface).

**Do not read this number out of `schema_migrations`** — its versions are
timestamps, not our `00NN`, and it carries far fewer rows than we have files: a
SQL Editor run writes none. MCP-applied migrations DO appear, so it is neither
complete nor empty, and either way it cannot answer "what number are we on".
The files on disk and the objects in the catalog are the record.
