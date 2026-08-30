# CLAUDE.md — AquaFleet KSA (Bousla / بوصلة)

**Read this file first, every session.** It is RULES ONLY and changes rarely.
**Current state — what is built, what is in flight, what is open — lives in
`.planning/HANDOFF.md`.** Read that second, then recent `git log`.

This file holds no state and no build history. §7 holds durable money and schema
RULES, not a status report. If a state-looking line appears here, it is a bug.

**`.planning/HANDOFF.json` (no prefix) is NOT ours** — gsd plugin's, gitignored,
rewritten from an empty template after tool calls. Never read it for state, never
stage it. Ours is `.planning/HANDOFF.md` (+ `AQUAFLEET-HANDOFF.json`). See §5.

---

## 1. What this project is

AquaFleet KSA (internal: Bousla / بوصلة) — fleet management for Bin Slimah Group,
a 50+ year-old family water-transport & treatment business in Riyadh (~40 trucks,
3 stations). Non-technical founder (Turki) directs. Manages trucks, drivers,
staff, trips, projects, commissions, leave, stations, finance/invoicing.

**Those two figures describe the BUSINESS, not the database,** and the live rows —
a partial working set — have never matched them. Do NOT "correct" them from a
`count(*)`: they are Turki's confirmed facts about his own fleet, and the one
number here that re-measuring cannot settle. The gap is expected; do not re-raise.

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
- **Turki** directs, and verifies every change in-browser before it is committed.

---

## 3. `preview/` is the authoritative design spec (READ-ONLY)

The original demo, and the ground truth for design and features. **Never edit
it.** For any UI work, pull real values (hex, class structure, layout) from it
rather than eyeballing or reinterpreting — when design has failed here it was
because it was *described* instead of *pulled from `preview/`*.

- `index.html` entry · `pages-1.js` / `pages-2.js` page markup+logic (Kanban is
  in pages-1) · `app.css` ALL styling · `archive.js` Archive · `map.js` route/map
  (Route Optimization, deferred) · `data.js` mock data · `components.js`,
  `icons.js`, `i18n.js`, `app.js`

Building or restyling a page: read its `preview/` source + `app.css` FIRST.

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
- **Planning / phases** → the **`gsd`** suite, but it does NOT drive this project.
  `.planning/AQUAFLEET-HANDOFF.json` borrows gsd's schema and is populated BY
  HAND; `phase`/`plan`/`task` stay null deliberately, because we do not run gsd
  phases and inventing a phase number would be fiction. Before leaning on gsd,
  report how it fits the existing workflow (preview/-as-spec, §5's commit
  discipline, the handoff file) so it is adopted deliberately.
  - **Borrowing gsd's SCHEMA is not giving gsd the PATH — conflating them cost
    three blanked files.** Its PostToolUse checkpoint overwrites
    `.planning/HANDOFF.json` unconditionally. Ours lives elsewhere for that reason.

---

## 5. Workflow discipline (non-negotiable)

- **One logical unit per commit**, each tsc-clean. `noUnusedLocals` +
  `noUnusedParameters` are enforced — unused = build failure. A param kept for
  signature shape gets an `_` prefix, never deletion.
- **Explicit-path `git add`**, listing each file. **NEVER `git add .`** Stage
  with a single-line `git add`, then `git status` to confirm — a multi-line paste
  has silently staged nothing before.
- **Inspect the staged blob, not the working tree:** `git show :<path>` is what
  would actually be committed. A file can be correct on disk and blank in the index.
- **Quote dynamic-route paths:** `git add 'app/fleet/[id]/page.tsx'` — zsh globs
  `[id]` silently. **Avoid `!` in commit messages** (history expansion).
- **HANDOFF files:** `.planning/HANDOFF.md` is ours and committed — read at session
  start, write at session end; state lives THERE, not here. Both `HANDOFF.json`s
  (`.planning/` and `preview/.planning/`) are gsd's — see the header.
- **Migrations:** numbered sequentially (`00NN_name.sql`), **DRAFTED to disk and
  never self-applied by Claude Code** — draft, stop, let Turki/the architect run
  it. **Verify the file exists on disk** (`ls supabase/migrations/ | tail -3` +
  `cat`) before it is run; migrations have been "drafted in conversation" and
  never written. **Code-then-migrate** for breaking schema changes: build against
  the new schema, migrate, verify in-browser, commit together. Additive changes
  (new nullable/defaulted columns) are lower-risk.
- **BARE STATEMENTS ONLY — a migration file carries no `begin;` / `commit;`.**
  The SQL Editor already runs each submission in its own transaction: a nested
  `begin;` emits `WARNING: there is already a transaction in progress` and is
  ignored, then the file's trailing `commit;` ends the EDITOR's transaction. The
  grids print, the run reads as a success, and **nothing was created** — 0173 v1
  did exactly this. That editor transaction is also what satisfies §6's
  "re-revoke in the same transaction".
- **A MIGRATION'S OWN RESULT-GRID IS NOT PROOF IT APPLIED.** Verification SELECTs
  are a claim; the catalog is the evidence. Confirm against `pg_index` /
  `pg_proc` / `has_function_privilege` after the fact, never by reading what the
  migration printed.
- **Turki verifies in-browser before every commit.** Nothing commits unverified.
- **THE DATABASE OUTRANKS THE NOTES on any question of DB state.** The architect
  applies corrections through MCP: those touch the database and **never touch the
  repo**, so they are invisible here and leave nothing in git to signal a note
  went stale. If the live DB and a note disagree, **the DB won** — re-measure, act
  on the measurement, then fix the note. Never re-raise an item because a note
  still lists it open. Not hypothetical: one corrected trip was re-raised across
  several sessions, and the note was wrong about both its paid status and its count.
- **Re-measure a number before quoting it, including numbers in our own files.**
  A figure in a handoff is a pointer, not evidence.
- **No build history in this file.** It is rules only; state goes to HANDOFF.md.
  Past 20KB, check for appended diary — and compress by re-verifying every claim,
  not by trimming prose blind. Both prior compression passes found a stale fact;
  the audit is the payoff, the bytes are the pretext.

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
  `border-color` is not inherited, so an inline `borderColor` on the container
  paints its own frame only — the rules `divide-y` creates stay at preflight's
  `#e5e7eb`. Light mode sits one step off that and dark mode does not, so it looks
  right in the mode you develop in; that is how it reached seven sites. Nothing
  else covers it: no `borderColor.DEFAULT`, no `@layer base` rule for `*`. On a
  border-less container the inline style is inert anyway (preflight zeroes
  border-width) — delete it, don't leave it implying the rules are handled.
  **An uncoloured `divide-` IS the bug**; grep is the regression test.

**WHAT SURVIVES A REPLACEMENT IS NOT OBVIOUS — AND WHAT DOES NOT IS A PERMISSION.**
The next three rules are one lesson in three places.

- **EVERY VIEW REPLACEMENT RESTATES ITS SECURITY FOOTER.** `create or replace
  view` silently drops reloptions, and it does NOT refresh the view's comment
  (same OID), so a stale comment outlives the branch it described.
```sql
  alter view public.X set (security_invoker = true);
  revoke all on public.X from anon;
  grant select on public.X to authenticated;
```
  Re-measure after every view change — the two counts MATCHING is the check, not
  the number:
```sql
  select count(*) as views,
         count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
         count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'v' and n.nspname = 'public';
```
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
  Every SECURITY DEFINER function and every money or guarded RPC ends with:
```sql
  revoke execute on function public.X(<exact identity args>) from public, anon;
```
  **BOTH grantees.** The offending entry is the PUBLIC one (EMPTY grantee,
  `=X/postgres`); revoking `anon` alone leaves it and changes nothing. Read back
  with `has_function_privilege('anon', …, 'execute')` = false — **never via
  `proacl` matching**, `'%=X/%'` also matches `postgres=X/postgres` and reports
  every function as leaking. **And identify the function by
  `p.oid::regprocedure::text = 'fn_name(uuid,integer)'`, never by
  `pg_get_function_identity_arguments()`** — on PG15+ that returns argument
  NAMES (`'p_project_id uuid, p_year integer'`), so a filter of `= 'uuid,
  integer'` matches ZERO rows and reports a healthy function as missing and
  anon-executable. A false catastrophe reads exactly like a real one.
  Not hypothetical: 0115 defined
  `issue_driver_payslip`, 0118 replaced it without re-revoking, and a definer
  money RPC sat callable by anyone with the anon key — bypassing RLS *and* 0161's
  table revoke, since a definer runs as its owner. Proven by probe (business-logic
  23514, not permission 42501), closed in **0163**; **0164** locked the guarded
  RPCs. Invariant: **zero NON-TRIGGER functions anon-executable** (trigger
  functions are unreachable via PostgREST; several legitimately remain).
- **New tables in `public` still end with `revoke all on public.X from anon`,**
  even though 0161 revoked anon everywhere and stopped future tables inheriting
  grants. That default-privileges change only affects tables created AFTER it, so
  on a fresh `db reset` every earlier migration creates its table first — and the
  per-table line is what makes each migration correct read on its own.

---

## 7. Current state & what's next

**Do NOT append build history, implementation notes, or money rules here.**
- Money/schema rules → `.claude/skills/aquafleet-domain/SKILL.md`
- Session state → `.planning/HANDOFF.md`
- If this file exceeds 15KB, Code is appending. Cut back to this stub.

**State:** DB at migration 0177. All pages built+verified. Arabic phase closed.
Read `.planning/HANDOFF.md` for current work.

**Do not read this number out of `schema_migrations`** — neither an MCP-applied
migration nor a SQL Editor run writes a ledger row, so the ledger's max version
lags permanently. The files on disk and the objects in the catalog are the record.
