# CLAUDE.md — AquaFleet KSA (Bousla / بوصلة)

**Read this file first, every session, before doing anything else.** It defines how
we work on this project. It changes rarely. For *current state* (what's built, what's
next), read **§7 below** — that is the durable record — then
`.planning/AQUAFLEET-HANDOFF.json` and recent `git log` for the short version. If the
JSON and §7 disagree, §7 wins.

**`.planning/HANDOFF.json` (no prefix) is NOT ours — it belongs to the gsd plugin,
is gitignored, and is rewritten from an empty template after tool calls. Never read
it for state and never stage it. See §5.**

---

## 1. What this project is

AquaFleet KSA (internal: Bousla / بوصلة) — a fleet-management web app for Bin Slimah
Group, a 50+ year-old family water-transport & treatment business in Riyadh (~40
trucks, 3 stations). Non-technical founder (Turki) directs; the app manages trucks,
drivers, staff, trips, projects, commissions, leave, stations, and (upcoming) finance/
invoicing.

- **Stack:** Next.js (App Router) + Supabase (Postgres) + Tailwind. TypeScript.
- **Repo:** `~/aquafleet-ksa`, GitHub `turkislimah-ux/aquafleet-ksa`, branch `main`.
- **Terminal:** macOS zsh. **Migrations run in the Supabase SQL Editor (browser).**
  Supabase is also connected to Claude directly (use it for schema checks/queries).

---

## 2. Roles — who does what (do NOT cross these lines)

**Two Claudes work on this project:**

- **Claude the architect** (chat/planning instance): owns architecture, data model,
  SQL review, git discipline, and *writing the prompts* that direct Claude Code.
  Specifies **behavior, data, logic, constraints, and content/color MAPPING only**.
  **NEVER specifies visual design** — not layout, styling, shapes, sizing, spacing,
  or visual treatment. When the architect has interfered with design, the result has
  been worse. Hard rule.

- **Claude Code** (this executing instance): owns **ALL file edits** and **ALL design
  decisions**. Builds from `preview/` as the spec. Reads and follows the relevant
  skills. Makes every visual/UX choice.

**Turki** directs and verifies every change in-browser before it's committed.

---

## 3. `preview/` is the authoritative design spec (READ-ONLY)

The `preview/` directory is the original demo — the **ground-truth spec** for design
and features. It is **read-only**; never edit it. Match it exactly for any UI work —
pull real values (hex, class structure, layout) from it rather than eyeballing or
reinterpreting. When design has failed here, it was because it was *described* instead
of *pulled from `preview/`*. Always pull from `preview/`.

**File → page/feature map:**
- `preview/index.html` — entry; open in a browser to click through the live demo.
- `preview/pages-1.js`, `preview/pages-2.js` — page markup/logic (Kanban is in pages-1).
- `preview/app.css` — ALL styling (the design ground-truth).
- `preview/archive.js` — the Archive page (not yet built in the app).
- `preview/map.js` — the route/map feature (Route Optimization, deferred).
- `preview/data.js` — mock data. `preview/components.js`, `icons.js`, `i18n.js`, `app.js`.

When building/restyling a page: read its `preview/` source + `app.css` FIRST, match it.

---

## 4. Skills — invoke the right one per task (do NOT load all at once)

Loading every skill at once wastes context and has crashed sessions. Invoke the
relevant skill(s) **when the task calls for it**:

- **UI / design / restyling / new pages** → read & follow **`frontend-design`**
  (its brainstorm → critique-vs-defaults → build process, not a mechanical pass) and
  **`web-design-guidelines`**. This is the taste standard. Match `preview/` alongside.
- **Database: migrations, schema, queries, RLS** → **`supabase-postgres-best-practices`**.
  Supabase is connected — use it to verify schema/state.
- **React components / composition / performance** → **`vercel-react-best-practices`**
  + **`vercel-composition-patterns`**.
- **Verifying UI behavior in-browser** → **`webapp-testing`** (Playwright).
- **Planning / phases / roadmap** → the **`gsd` suite**. NOTE:
  `.planning/AQUAFLEET-HANDOFF.json` uses gsd's schema and is POPULATED BY HAND (it
  was all-null until 2026-08-07), but gsd itself is not driving this project —
  `phase`/`plan`/`task` stay null deliberately, because we do not run gsd phases and
  inventing a phase number would be fiction. **Before leaning on gsd, report how it
  fits with this project's existing workflow (preview/-as-spec, the commit discipline
  below, the handoff file) so we adopt it deliberately, not blindly.**
  - **Borrowing gsd's SCHEMA is not the same as giving gsd the PATH, and conflating
    the two cost us three blanked files.** gsd's PostToolUse checkpoint treats
    `.planning/HANDOFF.json` as its own and overwrites it unconditionally. Our copy
    lives at `.planning/AQUAFLEET-HANDOFF.json` for that reason — see §5.

- **Domain rules (money, stock, RPCs, invariants)** → read
  `.claude/skills/aquafleet-domain/SKILL.md` at session start. This encodes
  business logic constraints (FIFO invariant, money-core boundary, one-SKU-one-
  warehouse, RPC conventions, counter-table pattern) that CLAUDE.md does not cover.
  **Read it before any migration, RPC, or server action work.**

---

## 5. Workflow discipline (non-negotiable)

- **One logical unit per commit.** Each commit tsc-clean. `noUnusedLocals` +
  `noUnusedParameters` are enforced — unused = build failure. Required params
  kept for signature shape get an `_` prefix, never deleted.
- **Explicit-path `git add`** — list each file. **NEVER `git add .`**
- **HANDOFF files:**
  - `.planning/HANDOFF.md` — session handoff, committed. Read at session start,
    write at session end. Current state lives HERE, not in CLAUDE.md §7.
  - `.planning/HANDOFF.json` (no prefix) — gsd plugin's checkpoint. Gitignored.
    Never read for state, never stage.
  - `preview/.planning/HANDOFF.json` — same, inside read-only `preview/`. Gitignored.
- **Quote dynamic-route paths** in git commands: `git add 'app/fleet/[id]/page.tsx'`
  — zsh globs `[id]` silently.
- **Avoid `!` in commit messages** (zsh history expansion).
- **Stage with single-line `git add`, then `git status`** to confirm before
  committing. Multi-line paste has silently staged nothing before.
- **Inspect the staged blob, not the working tree.** `git show :<path>` reads
  what would be committed. A file can be correct on disk and blank in the index.
- **Verify migration files on disk** (`ls supabase/migrations/ | tail -3` + `cat`)
  BEFORE running in Supabase. Migrations have been "drafted in conversation" but
  never written to disk — always verify.
- **Code-then-migrate** for breaking schema changes: build code against the new
  schema, run migration, verify in-browser, commit both together. Additive
  migrations (new nullable/defaulted columns) are lower-risk.
- **Turki verifies in-browser before every commit.** Nothing commits unverified.
- Migrations numbered sequentially (`00NN_name.sql`).
- **Migrations DRAFTED to disk** — never self-applied by Claude Code through
  Supabase MCP. Draft the file, stop, let Turki run it.
- **Do NOT append build history to CLAUDE.md.** Session state goes in HANDOFF.md.
  If this file exceeds 20KB, check for appended diary.

---

## 6. Key architecture locks (persistent — do not violate)

- **Soft-delete, not hard-delete** for operational records: `terminated_at`,
  `archived_at`. Terminated = pre-filter, never a state.
- **Derived driver state** (`lib/driver-state.ts`): 4 states (on_leave > off_duty
  > idle > active), server-computed. **Exactly TWO expressions:** TS helper +
  `v_driver_state_now` (0106). `v_fleet_state_now` and `v_drivers_ops_now` compose
  on the view. Drift guard asserts agreement at Dashboard load. Do not add a third.
- **Water stations ≠ Operation stations** (0014). Separate, do NOT unify.
- **`lib/project-colors.ts`** = shared id-hashed project color palette.
- **EVERY VIEW REPLACEMENT RESTATES ITS SECURITY FOOTER:**
```sql
  alter view public.X set (security_invoker = true);
  revoke all on public.X from anon;
  grant select on public.X to authenticated;
```
  `create or replace view` silently drops reloptions. Re-measure after every
  view change — the two counts matching is the check, not the number:
```sql
  select count(*) as views,
         count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
         count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'v' and n.nspname = 'public';
```
- **`create or replace view` can only APPEND a column** (error 42P16). Cannot
  insert, reorder, rename, or change type. Type changes from arithmetic (bare
  `numeric` vs `numeric(12,2)`) also trigger it — fix with explicit cast:
  `(case … end)::numeric(12,2)`. Verify type with `format_type(atttypid,atttypmod)`
  on `pg_attribute`, not by reading the view body.
- **Immutable keys** on lookup tables (`water_stations.key`) — rename updates
  name only.
- **`todayKey()` / local-date helpers** for Riyadh — avoid UTC skew.

---

## 7. Current state & what's next

**Do NOT append build history to this file.** CLAUDE.md holds rules only.
Current state lives in `.planning/HANDOFF.md` — read it at session start.

- **DB:** migration 0149. 73+ tables RLS-enabled, 48 views security_invoker, 0 anon-readable.
- **Built:** Dashboard, Fleet, Drivers & People, Finance/Invoice, Inventory,
  Maintenance, Archive, Consumption, Search/Header, Reports, Water Station Cost,
  Driver Payslips — all verified, no open bugs.
- **A WRITE-OFF ROW CARRIES NO PAYMENT MODE (0143).**
  `archive_project_guarded` records exactly **customer, project, amount, reason,
  actor** — nothing else. `customer_write_offs.payment_mode` existed from 0139 to
  0143: written on every forced archive, **read by nothing** (no view, no other
  routine, no app code). Do not re-add it. A write-off is a frozen AMOUNT; the
  mode the debt was owed under is still resolvable live from the project, and
  `invoices.payment_mode` remains the one snapshot that is genuinely read.
  - **DROPPING A COLUMN AN RPC WRITES IS ONE TRANSACTION, NOT TWO.** plpgsql
    bodies are **not** dependency-tracked, so `drop column` succeeds against a
    live writer and reports nothing — the failure lands as 42703 at the next
    forced archive, mid-override. Recreate the writer and drop the column in the
    same transaction, then assert the body with `pg_get_functiondef` afterwards.
    Prefer a bare drop over CASCADE: an unexpected dependent should fail loudly.
  - **Rewriting `archive_project_guarded` re-risks 0141.** Its
    `on conflict (customer_id) where reversed_at is null` target must be read back
    after any body change, or a bare `on conflict (customer_id)` returns and the
    next forced archive dies with 42P10.
- **MONEY RULE (0142) — a recorded balance return is a DEBIT.** A row in
  `customer_balance_returns` REDUCES spendable prepaid credit, same class as
  consumption. Netted at FACE VALUE (a refund is a cash movement, not a taxable
  supply — do not multiply by 1.15) and never modelled as a negative top-up
  (`topups_sar` means "money paid in"). The rule has **exactly two expressions**
  and both were changed together: `lib/prepaid.ts` (`returnedTotal()` is the ONE
  returns summation, threaded into `derivedBalanceItems`,
  `splitCoveredUnpaidItems` and `buildStatementItems`) and
  `v_customer_prepaid_balance`. `v_customer_amount_payable` and
  `v_invoice_outstanding_live` inherit it through `balance_sar` — do not add a
  third expression. Before 0142 nothing subtracted a return: a refunded
  customer's credit stayed spendable after the money was gone.
- **ARCHIVE IS NO LONGER A ONE-WAY DOOR (0141).** `restore_customer_guarded`
  un-archives a customer AND its project in one transaction on one timestamp,
  and reverses an active write-off by **marking** it (`reversed_at`,
  `reversed_by`) and KEEPING the row — amount/reason/actor stay frozen. It
  writes **no balance**: never delete a `customer_balance_returns` row and never
  post a compensating negative top-up to "undo" an archive.
  - **Write-off suppression is ACTIVE-only.** `v_customer_amount_payable` and
    `v_invoice_outstanding_live` both carry `and w.reversed_at is null` **in the
    JOIN condition**. In a WHERE clause it turns the LEFT JOIN inner and drops
    every customer who never had a write-off.
  - **The partial index and the conflict target are ONE change.**
    `customer_write_offs` has a partial unique index on active rows (not a
    table-wide `UNIQUE(customer_id)`), and `archive_project_guarded` uses
    `on conflict (customer_id) where reversed_at is null`. Split them and you
    get either 42P10 or — worse, silently — a re-archived debtor whose insert
    collides with the old reversed row and writes nothing.
- **Current work:** Fleet page cleanup batch (Trips/Finance items). See HANDOFF.md.
- **Deferred:** effective-dated rates, Route Optimization, Predictive AI, IoT,
  drivers/staff table unification (v2).

**Session discipline:**
- Read `.planning/HANDOFF.md` for what's in progress — do NOT ask CLAUDE.md.
- Write `.planning/HANDOFF.md` at session end — do NOT append to this file.
- If this file exceeds 20KB, something is wrong — check for appended build diary.
