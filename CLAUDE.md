# CLAUDE.md — AquaFleet KSA (Bousla / بوصلة)

**Read this file first, every session, before doing anything else.** It defines how
we work on this project. It changes rarely. For *current state* (what's built, what's
next), read `.planning/HANDOFF.json` and recent `git log`.

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
- **Planning / phases / roadmap** → the **`gsd` suite**. NOTE: `.planning/HANDOFF.json`
  already uses gsd's schema but it's currently unused (all null). **Before leaning on
  gsd, report how it fits with this project's existing workflow (preview/-as-spec,
  the commit discipline below, HANDOFF.json) so we adopt it deliberately, not blindly.**

---

## 5. Workflow discipline (non-negotiable)

- **One logical unit per commit.** Each commit tsc-clean.
- **Explicit-path `git add`** — list each file. **NEVER `git add .`**
- **Both `.planning/HANDOFF.json` and `preview/.planning/HANDOFF.json` stay UNSTAGED.**
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

---

## 6. Key architecture locks (persistent — do not violate)

- **Soft-delete, not hard-delete**, for operational records: terminated drivers/trucks
  (`terminated_at`), archived projects. Terminated = a **pre-filter, never a state**.
  Records persist (commission history, incidents, etc. survive termination).
- **Derived driver state** (`lib/driver-state.ts`): 4 states (on_leave > off_duty >
  idle > active), server-computed per page. Never a stored status.
- **Water stations vs Operation stations are SEPARATE** (migration 0014's "do NOT
  unify" rule). Water = fill stations (trips). Operation = driver/truck/staff base.
- **`lib/project-colors.ts`** = shared id-hashed project color palette (one source,
  used across Trips/Kanban/pills).
- **Immutable keys** on lookup tables (water_stations.key) — rename updates name only.
- **`todayKey()` / local-date helpers** for Riyadh — avoid UTC skew in date logic.

---

## 7. Current state & what's next

- Read `.planning/HANDOFF.json` + `git log --oneline -20` for where things stand.

- **IN PROGRESS — Kanban board redesign + refinements (UNCOMMITTED on disk, finish this
  first).** A previous session ran out of context mid-task. Uncommitted changes sit in
  the working tree — DO NOT discard them; the good redesign is in there.
  - Files: `app/trips/ProjectsBoard.tsx`, `lib/db-types.ts` (STAGE_STYLES rebuilt,
    demo-matched), `tailwind.config.ts` (safelist). tsc passes.
  - The redesign matches `preview/` (pages-1.js kanban + app.css). Phase color mapping:
    scheduled=blue, loading=amber/yellow, **in_transit=orange**, delivered=green.
  - **Suspected bug:** STAGE_STYLES tokens may have been restructured in `db-types.ts`
    without `ProjectsBoard.tsx` fully rewired to consume them — which may explain the
    board rendering unchanged. Diagnose/verify the tokens are actually used before adding.
  - **Remaining refinement items to finish (check which are already done — don't redo):**
    1. Action buttons colored for DESTINATION phase (Start trip=blue, Mark in transit=
       **orange**, Mark delivered=green).
    2. Unique phase icons per action button (play=Start; a transit icon=Mark in transit;
       a delivery icon=Mark delivered).
    3. Summary table "Drivers operating this project" restyled to match `preview/` (keep
       current data/columns: Driver, Truck, Status, Trips·Month, Commission·Month, Last Trip).
    4. In-transit column accent → orange (color only, same pattern as others).
    5. Route icon on loading/in-transit cards: small icon-only, **disabled/muted** (no
       destination decided yet — must NOT navigate or look like a working link; must not
       eat the card's own phase-picker click).
  - Turki verifies against the demo image before commit.

- **Finance/Invoice PRD** is committed at `.planning/finance-invoice-spec.md` — the
  next big feature to build (~8 staged commits), pending Turki's final review.
- **Deferred:** Archive page (restore UI for soft-deleted records — `preview/archive.js`
  is the spec; rising priority), Maintenance page (+ truck-derived-state), Route
  Optimization (`preview/map.js`), stored-status column cleanup migration.
- **Roadmap order:** Trips (done) → Maintenance → Inventory → Reports → Archive →
  Route Optimization → Predictive → IoT (last three deferred).
