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

- **One logical unit per commit.** Each commit tsc-clean. `noUnusedLocals` +
  `noUnusedParameters` enforced. Required params get `_` prefix, never deleted.
- **Explicit-path `git add`** — list each file. **NEVER `git add .`**
- **HANDOFF:** `.planning/HANDOFF.md` — committed, read at session start, write
  at session end. Must stay under 2KB.
- **Quote dynamic-route paths:** `git add 'app/fleet/[id]/page.tsx'`
- **Avoid `!` in commit messages** (zsh history expansion).
- **Stage with single-line `git add`, then `git status`** before committing.
- **Inspect staged blob, not working tree.** `git show :<path>` reads what
  would be committed.
- **Verify migration files on disk** before running in Supabase.
- **Code-then-migrate** for breaking schema changes.
- **Turki verifies in-browser before every commit.**
- **Migrations DRAFTED to disk** — never self-applied via Supabase MCP.
- **DO NOT APPEND build diary to this file, HANDOFF.md, or the domain skill.**
  Session state → HANDOFF.md only. If any of these files exceeds its size cap
  (CLAUDE.md 15KB, HANDOFF 2KB, domain skill 15KB), Code is appending. Cut back.

---

## 6. Architecture locks (persistent — do not violate)

- **Soft-delete, not hard-delete.** `terminated_at`, `archived_at`. Terminated =
  pre-filter, never a state.
- **Derived driver state** (`lib/driver-state.ts`): 4 states, server-computed.
  Exactly TWO expressions: TS helper + `v_driver_state_now`. Do not add a third.
- **Water stations ≠ Operation stations** (0014). Do NOT unify.
- **`lib/project-colors.ts`** = shared project color palette.
- **EVERY VIEW REPLACEMENT RESTATES ITS SECURITY FOOTER:**
```sql
  alter view public.X set (security_invoker = true);
  revoke all on public.X from anon;
  grant select on public.X to authenticated;
```
  Re-measure after every view change — counts matching is the check:
```sql
  select count(*) as views,
         count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
         count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'v' and n.nspname = 'public';
```
- **42P16:** `create or replace view` can only APPEND columns. Cannot insert,
  reorder, rename, or change type. Fix type changes with explicit cast.
- **Immutable keys** on lookup tables. Rename updates name only.
- **`todayKey()` / local-date helpers** for Riyadh — avoid UTC skew.
- **Commission:** effective-dated, delivery-moment freeze, one-writer
  (`set_project_commission`). See domain skill for full rules.
- **Rates:** effective-dated salary history, trips.rate_sar frozen at delivery.
  See domain skill for full rules.
- **Tax:** No income tax (100% Saudi-owned). Zakat is indicative only (2.5% of
  profit-before-Zakat). VAT is never profit.

---

## 7. Current state

**Do NOT append here.** Read `.planning/HANDOFF.md` for session state.
Domain rules → `.claude/skills/aquafleet-domain/SKILL.md`

DB at latest migration. All pages built+verified. Arabic phase closed.
Notifications + Settings feature in progress.
