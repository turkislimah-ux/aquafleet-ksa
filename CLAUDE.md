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

**Those two figures describe the BUSINESS, not the database.** The live rows are a
partial working set and have never matched them. Do NOT "correct" this line from a
`count(*)` — it is Turki's fact about his own fleet, not a measurement, and it is
the one number in this file that re-measuring cannot settle. He has confirmed it
and the gap to the seeded rows is expected — do not re-raise it.

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
- **HANDOFF files:** `.planning/HANDOFF.md` is ours and committed — read at
  session start, write at session end; current state lives THERE, not here.
  `.planning/HANDOFF.json` and `preview/.planning/HANDOFF.json` are gsd's,
  gitignored — never read for state, never stage.
- **Migrations:** numbered sequentially (`00NN_name.sql`), **DRAFTED to disk and
  never self-applied by Claude Code** — draft, stop, let Turki/the architect run
  it. **Verify the file exists on disk** (`ls supabase/migrations/ | tail -3` +
  `cat`) before it is run; migrations have been "drafted in conversation" and
  never written. **Code-then-migrate** for breaking schema changes: build against
  the new schema, migrate, verify in-browser, commit together. Additive changes
  (new nullable/defaulted columns) are lower-risk.
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
  the Supabase anon key ships in the client bundle. **There is no
  default-privileges equivalent for functions** (0161's covers TABLES only), so
  nothing makes this stick. Every SECURITY DEFINER function and every money or
  guarded RPC ends with:
```sql
  revoke execute on function public.X(<exact identity args>) from public, anon;
```
  **`from public, anon` — BOTH.** The offending grant is the PUBLIC one (an ACL
  entry with an EMPTY grantee, `=X/postgres`); revoking from `anon` alone leaves
  it and changes nothing. Read it back with `has_function_privilege('anon', …,
  'execute')` = false. **Never assert via `proacl` matching** — `'%=X/%'` also
  matches `postgres=X/postgres` and reports every function as leaking.
  Not hypothetical: 0115 defined `issue_driver_payslip`, 0118 replaced it without
  re-revoking, and a SECURITY DEFINER money RPC sat callable by anyone with the
  anon key — bypassing RLS *and* 0161's table revoke, because a definer runs as
  its owner. Proven by probe (business-logic 23514, not permission 42501), closed
  in **0163**; **0164** locked the guarded RPCs. Invariant: **zero NON-TRIGGER
  functions anon-executable** (trigger functions are unreachable via PostgREST and
  several legitimately remain).
- **New tables in `public` still end with `revoke all on public.X from anon`,**
  even though 0161 revoked anon everywhere and stopped future tables inheriting
  grants. That default-privileges change only affects tables created AFTER it, so
  on a fresh `db reset` every earlier migration creates its table first — and the
  per-table line is what makes each migration correct read on its own.

---

## 7. Durable money & schema rules

**Not a status report.** What is built / in flight / open lives in
`.planning/HANDOFF.md`. These are the rules that must survive any future change.

- **A WRITE-OFF ROW CARRIES NO PAYMENT MODE (0143).** `archive_project_guarded`
  records exactly customer, project, amount, reason, actor.
  `customer_write_offs.payment_mode` existed 0139→0143, was written on every
  forced archive and **read by nothing**. Do not re-add: a write-off is a frozen
  AMOUNT, the mode the debt was owed under stays resolvable live from the project,
  and `invoices.payment_mode` is the one snapshot genuinely read.
  - **Dropping a column an RPC writes is ONE transaction, not two.** plpgsql
    bodies are not dependency-tracked, so `drop column` succeeds silently against
    a live writer and fails as 42703 at the next forced archive, mid-override.
    Recreate the writer and drop the column together, then assert the body with
    `pg_get_functiondef`. Bare drop over CASCADE — an unexpected dependent should
    fail loudly.
- **A RECORDED BALANCE RETURN IS A DEBIT (0142).** A `customer_balance_returns`
  row REDUCES spendable prepaid credit, same class as consumption. Netted at FACE
  VALUE — a refund is cash leaving, not a taxable supply, so no `× 1.15` — and
  never modelled as a negative top-up (`topups_sar` means "money paid in"). Before
  0142 nothing subtracted a return, so a refunded customer's credit stayed
  spendable after the money was gone.
  - **EXACTLY TWO EXPRESSIONS, and it stays two:** `returnedTotal()` in
    `lib/prepaid.ts` is the ONE TS-side summation — every consumer IMPORTS it
    rather than restating it, including `lib/invoice.ts` — and
    `v_customer_prepaid_balance` is the SQL side. `v_customer_amount_payable` and
    `v_invoice_outstanding_live` inherit through `balance_sar`. Do not add a third.
    (`buildStatementItems` consumes the return ROWS for the ledger, not the
    summation — a different use of the same data, not a second expression.)
- **ARCHIVE IS NOT A ONE-WAY DOOR (0141).** `restore_customer_guarded` un-archives
  a customer AND its project in one transaction on one timestamp, and reverses an
  active write-off by **marking** it (`reversed_at`, `reversed_by`) while KEEPING
  the row — amount/reason/actor stay frozen. It writes **no balance**: never delete
  a `customer_balance_returns` row, never post a compensating negative top-up to
  "undo" an archive.
  - **Write-off suppression is ACTIVE-only, and `and w.reversed_at is null`
    belongs in the JOIN condition** of `v_customer_amount_payable` and
    `v_invoice_outstanding_live`. In a WHERE clause it turns the LEFT JOIN inner
    and drops every customer who never had a write-off.
  - **The partial index and the conflict target are ONE change.**
    `customer_write_offs` has a partial unique index on active rows
    (`(customer_id) where reversed_at is null`, not a table-wide
    `UNIQUE(customer_id)`), matched by `archive_project_guarded`'s `on conflict
    (customer_id) where reversed_at is null`. Split them and you get 42P10 — or,
    worse and silently, a re-archived debtor whose insert collides with the old
    reversed row and writes nothing. **Any rewrite of that RPC must read the
    conflict target back afterwards.**
- **A TRIP OWNS THE COMMISSION TERMS IT WAS DELIVERED UNDER (0152).**
  `trips.commission_mode` / `.commission_base_sar` / `.commission_bump_pct` are a
  COPY of `commission_config_at(project_id, trip_date)` taken at the delivery
  moment: all three or none (`trips_commission_terms_all_or_none`), NULL until
  delivered, NULL forever for a trip with no project or no driver, re-stamped on
  every re-delivery. `commission_base_sar` is the INPUT RATE and `commission_sar`
  is the MONEY — do not swap them in a select, which is why the base column is not
  called `commission_value`.
  - **VALUES, NEVER A FK to `project_commission_history`.** That row is mutable in
    place: `set_project_commission` upserts on `(project_id, effective_from)` and
    `created_at` is not in the SET list, so it dates the FIRST write. Measured on
    R TTT: one row went 15.00 → 20.00 → 15.00 in an afternoon with `created_at`
    frozen, and its six trips carry 15/15/20/20/15/15 — a FK would have repriced
    two delivered trips twice. Full trace in 0152's header. Corollary:
    **`created_at` is NOT a change-moment signal;** never build a freeze rule on it.
  - **`recomputeDailyCommission` RE-RANKS, it does not RE-RATE.** It re-derives
    `commission_sar` from EACH trip's own frozen terms at that trip's live
    position — never reads `commission_config_at` for the bucket, never writes the
    three term columns. That resolver is read at ONE place: the delivery stamp in
    `priceDelivery`. Paid trips hold a position but are never re-stamped.
- **`update_project_with_customer` DOES NOT TAKE A COMMISSION (0150 → 0153).**
  The three parameters are gone; passing one is a PGRST202, the intended loud
  failure. `set_project_commission` (0148) is the ONLY path that moves a commission
  figure on an existing project, so no unrelated save can revert one from a stale
  pre-fill. Do not re-add them.
  - **`create_project_with_customer` is a DIFFERENT function and keeps its three**
    — creation writes them and 0147's INSERT trigger makes them the baseline
    history row. The two RPCs' argument blocks are byte-identical around `p_rate`,
    so a blind find-replace breaks project creation: disambiguate on `p_project_id`.
  - **Dropping a parameter is a DROP+CREATE, and DROP DISCARDS THE ACL.** Postgres
    allows only TRAILING defaults, which is why 0151 had to MOVE the three before
    0153 could remove them. See §6's function rule — this is the same trap.

**Deferred:** effective-dated CUSTOMER rates (`projects.rate_per_trip_sar` is
still one live column — no history table, no `rate_at()` resolver; **driver
COMMISSION is already effective-dated**, 0146–0149, so this is the rate half only,
and 0128's `trips.rate_sar` freeze is a per-trip snapshot, not a rate history),
Route Optimization, Predictive AI, IoT, drivers/staff table unification (v2).
