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

- **One logical unit per commit.** Each commit tsc-clean — and since `6506f2e`
  that means MORE than it used to: `tsconfig.json` carries `noUnusedLocals` and
  `noUnusedParameters`, so an unused import, local or parameter now FAILS the
  build rather than accumulating until someone sweeps. **A parameter genuinely
  required by a signature, interface or callback shape gets an `_` prefix — never
  delete it, that changes the shape the caller depends on.**
- **Explicit-path `git add`** — list each file. **NEVER `git add .`**
- **THE HANDOFF FILE IS `.planning/AQUAFLEET-HANDOFF.json`. IT IS COMMITTED.**
  A deliberate snapshot (Turki's call, 2026-08-07), updated by hand each round and
  staged by explicit path like any other file.
  - **`.planning/HANDOFF.json` — no prefix — IS NOT OURS.** It belongs to the gsd
    plugin's PostToolUse checkpoint. Gitignored. Never read it for state, never
    stage it, and do not "fix" it when it looks empty — empty is its correct state
    for this repo.
  - **`preview/.planning/HANDOFF.json`** — same thing inside the read-only
    `preview/` tree. Also gitignored.
  - **§7 of this file is the durable record.** The handoff JSON is a pointer to it,
    never the other way round — do not let real knowledge live only in the JSON.

- **WHY THE PATH MOVED, AND THE LESSON THAT OUTLIVES IT.** We wrote our handoff to
  `.planning/HANDOFF.json` for months. gsd's PostToolUse hook writes that same path
  after nearly every tool call (60s throttle), and in gsd 3.4.4 `writeCheckpoint()`
  had no guard: it produced a 450-byte empty skeleton and overwrote our snapshot with
  it. **This is upstream's [#17][gsd17], fixed in v4.0.1 — we were simply two months
  stale.** The mechanism is a broken import, not missing state: `checkpoint.cjs`
  destructures `safeReadFile`/`execGit` from `core.cjs`, which stopped exporting them
  (verified `undefined` on our copy), so every read inside `generateCheckpoint()`
  throws, a bare `catch {}` swallows it, and the null skeleton gets written **whether
  or not `.planning/STATE.md` exists**. Full note, including why our first diagnosis
  was wrong: `.planning/gsd-handoff-clobber-note.md`.

  [gsd17]: https://github.com/buildomator/buildomator/issues/17
  - **It committed the blank once — `7b29c65`, over a full snapshot, restored in
    `86adec8`** — and struck twice more in a single round afterwards, including once
    between the moment the file was verified at 12,515 bytes and the `git add` three
    seconds later. The staged blob was blank while the working tree looked perfect.
  - **THE FIX WAS OWNERSHIP, NOT VIGILANCE, AND THAT IS THE GENERAL RULE.** Every
    guard below worked — and we still lost the file three times, because a rule that
    must be obeyed on every single commit forever will eventually not be. **When two
    tools claim one path, move the path. Do not get better at defending it.** The
    guards are kept because they generalise, not because this specific file still
    needs them:
    - **The `git add` must be conditional on the write actually SUCCEEDING**, not
      merely chained after it with `&&`. `7b29c65`'s python heredoc threw **before
      writing anything** and the chained `add` staged whatever was already on disk.
      One command is not atomic.
    - **INSPECT THE STAGED BLOB, NOT THE WORKING TREE.** `git show :<path>` and
      `git cat-file -s` read exactly what would be committed. A file can be correct
      on disk and blank in the index. This is what caught the second and third hits.
    - **A SHRINKING DIFF IS A STOP SIGNAL, not a curiosity.** `16 insertions, 30
      deletions` on a file you only added to means something else wrote it.
    - **`git checkout -- <path>` RESTORES FROM THE INDEX, NOT HEAD.** Once a bad
      blob is staged, the reflexive restore writes the bad content over itself and
      reports success. Use **`git checkout HEAD -- <path>`**. This one is nasty
      precisely because the normal recovery move is the thing that fails silently.
    - **Recovery is `git show <last-good-commit>:<path>`** — rebuild from the blob
      and re-apply the round's updates rather than retyping from memory.
- **Quote dynamic-route paths** with brackets in git commands, e.g.
  `git add 'app/fleet/[id]/page.tsx'` — zsh globs `[id]` and silently drops it otherwise.
- **Avoid `!` in commit messages** (zsh history expansion).
- **Stage with a single-line `git add`, then `git status` to confirm** the exact set is
  staged BEFORE committing. (A multi-line paste has silently staged nothing before.)
- **Verify migration files exist on disk** (`ls supabase/migrations/ | tail -3` + `cat`)
  BEFORE running them in Supabase. (Migrations have been "drafted in report" but never
  written to disk multiple times — always verify.)
- **Code-then-migrate** for breaking schema changes: build the code against the new
  schema first, then run the migration, then verify in-browser, then commit both together.
  Purely additive migrations (new nullable/defaulted columns) are lower-risk.
- **Turki verifies in-browser before every commit.** Nothing commits unverified.
- Migrations numbered sequentially (`00NN_name.sql`). Highest so far: check
  `ls supabase/migrations/`.
- **Migrations are DRAFTED to disk for Turki to run in the Supabase SQL Editor — never
  self-applied by Claude Code through the Supabase MCP** (reaffirming §1). Incident: the
  v3 prepaid rebuild self-applied `0036`/`0037` directly via MCP instead of drafting them
  for Turki, which is how they ended up as stray `confirm_invoice` overloads instead of
  clean replacements (fixed in `0038` — see §7). Draft the file, stop, let Turki run it.

---

## 6. Key architecture locks (persistent — do not violate)

- **Soft-delete, not hard-delete**, for operational records: terminated drivers/trucks
  (`terminated_at`), archived projects. Terminated = a **pre-filter, never a state**.
  Records persist (commission history, incidents, etc. survive termination).
- **Derived driver state** (`lib/driver-state.ts`): 4 states (on_leave > off_duty >
  idle > active), server-computed per page. Never a stored status.
  **EXACTLY TWO EXPRESSIONS OF THIS RULE MAY EXIST** — that TS helper and
  `v_driver_state_now` (0106), which mirrors its precedence. `v_fleet_state_now` and
  `v_drivers_ops_now` COMPOSE on the view rather than restating it, and
  `lib/actions/driver-state-drift.ts` asserts the two remaining copies agree on live
  data at every Dashboard load. **Do not add a third.** Note `active` means ASSIGNED
  (a truck and a live project), NOT currently driving — a driver with no truck can
  still hold in-flight trips, and the two facts are shown separately.
- **Water stations vs Operation stations are SEPARATE** (migration 0014's "do NOT
  unify" rule). Water = fill stations (trips). Operation = driver/truck/staff base.
- **`lib/project-colors.ts`** = shared id-hashed project color palette (one source,
  used across Trips/Kanban/pills).
- **EVERY VIEW REPLACEMENT RESTATES ITS SECURITY FOOTER.** `create or replace
  view` does **NOT** preserve reloptions, so a replaced view silently reverts to
  owner-run and bypasses RLS on 68 RLS-enabled tables. Every `create or replace
  view` must be followed by:
  ```sql
  alter view public.X set (security_invoker = true);
  revoke all on public.X from anon;
  grant select on public.X to authenticated;
  ```
  This is not per-feature style — it is the standing rule for every view, and
  the failure is invisible: the view keeps returning rows, just with the wrong
  privileges. Live count to check against: **47 views, 47 security_invoker, 0
  anon-readable** (re-measured 2026-08-19, after 0139 added
  `v_customer_amount_payable` — its other two views were REPLACEMENTS, not
  additions). This line has now gone stale three times — 40/40 for months while
  four views were added, then 44/44 while 0137 added two, then 46/46 while 0139
  added one — which is the point: **the two counts matching is the check, not the
  number**, so re-measure and update rather than trusting the figure written here:
  ```sql
  select count(*) as views,
         count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
         count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'v' and n.nspname = 'public';
  ```
- **`create or replace view` can only APPEND a column** — it cannot insert,
  reorder or rename one (error **42P16**, which cost 0112 an apply cycle). If a
  new column belongs in the middle, it still goes at the end.
  - **42P16 HAS A SECOND FACE: IT ALSO REFUSES A TYPE CHANGE**, and this entry
    listing only insert/reorder/rename is what let it through a second time —
    **`0137` failed its first apply on it.** A column declared `numeric(12,2)`
    cannot be replaced by a bare `numeric`. The typmod is part of the column's
    identity, so "same name, same position" is NOT enough: `least()`/`greatest()`
    arithmetic returns bare `numeric` even when every input carries a typmod,
    whereas a plain column reference inherits one — so simply wrapping an existing
    column in arithmetic changes its type and breaks the replace.
  - **The fix is an explicit cast, and the parens go on BOTH sides:**
    `(case … end)::numeric(12,2)`. A `case` expression must be parenthesised
    before `::` binds to the whole thing rather than to the last branch.
  - **VERIFY THE TYPE, NOT JUST THE NAME AND ORDER.** `0137`'s own header claimed
    the replaced columns were "byte-identical in NAME, ORDER and TYPE" when only
    name and order had been checked. `select attname, format_type(atttypid,
    atttypmod) from pg_attribute` on the existing view is the check — reading the
    `pg_get_viewdef` body is not, because the body does not show the resolved type.
- **Immutable keys** on lookup tables (water_stations.key) — rename updates name only.
- **`todayKey()` / local-date helpers** for Riyadh — avoid UTC skew in date logic.

---


## 7. Current state & what's next

**Do NOT append build history to this file.** CLAUDE.md holds rules only.
Current state lives in `.planning/HANDOFF.md` — read it at session start.

- **DB:** migration 0140. 73+ tables RLS-enabled, 40 views security_invoker, 0 anon-readable.
- **Built:** Dashboard, Fleet, Drivers & People, Finance/Invoice, Inventory,
  Maintenance, Archive, Consumption, Search/Header, Reports, Water Station Cost,
  Driver Payslips — all verified, no open bugs.
- **Current work:** Fleet page cleanup batch (Trips/Finance items). See HANDOFF.md.
- **Deferred:** effective-dated rates, Route Optimization, Predictive AI, IoT,
  drivers/staff table unification (v2).

**Session discipline:**
- Read `.planning/HANDOFF.md` for what's in progress — do NOT ask CLAUDE.md.
- Write `.planning/HANDOFF.md` at session end — do NOT append to this file.
- If this file exceeds 20KB, something is wrong — check for appended build diary.
