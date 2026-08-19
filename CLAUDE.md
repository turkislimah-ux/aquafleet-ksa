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

- This section IS the record. `.planning/AQUAFLEET-HANDOFF.json` + `git log --oneline
  -20` give the short version — anything that matters belongs here, not only there.
  (The unprefixed `.planning/HANDOFF.json` is gsd's, gitignored, and not state — §5.)

- **KANBAN board redesign — DONE and committed** (`11edf4f`, plus `92779b0` for the
  driver summary table and `180332b` for day-scoping). This entry sat at the top of §7
  for weeks reading "IN PROGRESS — UNCOMMITTED on disk, finish this first". **That was
  stale.** Verified against the real code before rewriting, item by item; two of its
  claims were not merely out of date but WRONG, and both are corrected below.
  - Files: `app/trips/ProjectsBoard.tsx`, `lib/db-types.ts` (`STAGE_STYLES`),
    `tailwind.config.ts` (safelist). Nothing uncommitted; the working tree is clean.
  - **Phase colour mapping (still the lock):** scheduled=blue, loading=amber/yellow,
    **in_transit=orange**, delivered=green. `STAGE_STYLES` is the one source and the
    Dashboard's own stage colours read the same mapping, so a stage means the same
    colour on both screens.
  - **CORRECTION 1 — the "suspected bug" was FALSE.** §7 suspected `STAGE_STYLES` tokens
    had been restructured without `ProjectsBoard.tsx` being rewired, and blamed it for
    "the board rendering unchanged". The tokens ARE consumed: `s.columnBorder` and
    `s.headerText` on the column, `s.chip` on the delivered badge, all off
    `STAGE_STYLES[stage]`. There is no unwired token. **Do not go hunting for it.**
  - **CORRECTION 2 — item 1 was SUPERSEDED, not left undone.** §7 recorded the rule as
    "action buttons coloured for the DESTINATION phase". Turki later replaced that with
    the opposite: **every action button is solid-filled in the card's OWN CURRENT-stage
    colour**, never the destination's, so the column accent and its button always agree.
    Start trip (on a scheduled card) = solid blue, Mark in transit (on a loading card) =
    solid amber, Mark delivered (on an in_transit card) = solid orange. This is also a
    deliberate deviation from `preview/app.css`'s `.kanban-action-*`, which uses one
    outline treatment plus a "turns green when done" success button. The reasoning is
    written into `ProjectsBoard.tsx` above the `ACTION_*` constants. **A future
    "match the demo" pass must not revert either decision.**
  - The other four items are done as specified: unique phase icons (Play / Truck /
    Check); the "Drivers operating this project" summary table; in-transit column accent
    orange (`border-t-orange-600`); and the route hint on loading/in-transit cards,
    pixel-matched to preview's `.kanban-hint` but **muted and DISABLED** — no route
    destination exists yet, so it must never navigate, never look like a working link,
    and never eat the card's own phase-picker click.
  - **The summary table's columns are DAY-scoped, not month** — Trips (day) / Commission
    (day). §7 asked for `Trips·Month`/`Commission·Month`, which predates `180332b`
    making the whole Projects tab day-scoped behind a week-calendar strip. The columns
    follow the board's own window; that is a consequence of a later decision, not a miss.
  - **Board scope, load-bearing for anything that reconciles against it:** the Kanban is
    DAY-SCOPED — its single filter point is `dayTrips` (`trip_date === selectedDay`) —
    and it renders a card per project where `status === 'active'` over a query already
    filtered by `archived_at is null`, plus a separate "Direct customer trips" card for
    trips with no project. The Dashboard's Projects section shares that predicate and
    differs only in window (current month); see the Dashboard entry below.

- **Finance/Invoice PRD** is committed at `.planning/finance-invoice-spec.md` —
  **COMPLETE end-to-end, through commit `0562d2a`.** Data model (migration `0025`),
  project popup + `payment_mode` (migration `0026`), Finance tab, prepaid ledger,
  covered/unpaid engine, VAT, invoice lifecycle (migration `0027`) + reserve-at-draft
  and paid-invoice lock (migration `0030`), full UI (draft/review/confirm/pay/void,
  print, mailto) — **both prepaid and postpaid modes**, customer/company email
  templates (migrations `0028`/`0029`), and bilingual (EN/AR) PDF export (`lib/pdf.ts`,
  `lib/invoicePdfTemplate.ts`, migration `0031` — `invoice-pdfs` bucket). All
  money-logic harnesses green.
  - **Runtime config — NO LONGER PENDING (this line used to say "Turki's action,
    pending" and was stale).** `PDF_API_KEY` **IS set** in `.env.local` (a real
    PDFShift key, `sk_833…`), so the missing-key guard no longer short-circuits and
    the v3 auth fix (`f7ad606`, `-u "api:$KEY"`) is the line that actually executes.
    The graceful "PDF service not configured" message is now a fallback for a
    key-less environment, not the normal state. **Still owed: an end-to-end
    in-browser Download PDF check against the live API** — nobody has confirmed a
    real PDF came back since the key landed.
  - **Deferred — Finance:**
    1. Send-from-domain email (real outbound sending, e.g. via a transactional email
       provider) — current email is mailto-only (opens the user's own mail client).
       Separate project, not blocking.
    2. Full Settings screen — `company_settings.email` today only has the minimal
       get/set pair built for the invoice email templates (0029), not a real settings UI.
    3. Effective-dated commission config — still deferred (commission, not invoicing).
       Likely one feature with item 4 below (both need the same effective-dated-rate
       history mechanism, one for driver pay, one for customer billing).
    4. Mixed-rate invoice row splitting — requires effective-dated RATE history on
       projects (today `rate_per_trip_sar` is a single current value, no history). A
       rate change mid-period should split that period's invoice into two rows (old
       rate up to the change, new rate after) instead of applying the current rate
       retroactively to the whole period. Prepaid balance deduction would need to walk
       old-then-new by date too (mirrors `consumingTrips()`'s ordering, just rate-aware).
    5. Multi-project customers with separate finance — currently impossible
       (`projects_customer_id_unique`, migration 0015 enforces 1 customer = 1 project),
       and invoices key off `customer_id` only, never `project_id` (0025). The C3
       payment-mode-switch guard (0035) explicitly notes this same limitation in its
       header. Supporting it would need invoices to become project-scoped.

- **Finance tab polish (Batches A/B/C, migrations `0032`–`0035`) is COMPLETE, through
  commit `1431453`.** Built on top of the Finance/Invoice PRD above:
  - Grouped invoice tables, print statement, clickable trip-ref → jumps to and
    highlights the trip on the Kanban board, water-type inheritance (trip inherits its
    project's default unless overridden), draft-period editing, undelivered-trip
    confirm block (`confirm_invoice()` refuses to confirm while any trip in the
    invoice's period is undelivered — migration `0032`).
  - Special-charges section gained a detail view with internal reference images.
  - Per-project trip refs: `XX-YYY-NNNN` (project initials + trip_date year + per-
    project counter) — migration `0033`.
  - Invoice numbers moved to yearly reset: `YYY-NNNNNN` (confirm-year + per-year
    counter, replacing the old global counter) — migration `0034`. `vat_ref` removed
    entirely in the same migration (column, index, counter, function, all app-code
    references) — redundant once `invoice_number` itself carries a year.
  - Payment-mode switch now requires settlement first: `can_switch_payment_mode()`
    blocks a real mode change (never the first-time forced choice) unless every
    invoice for the customer is paid/void, no delivered trip sits un-invoiced, and (if
    leaving prepaid) the balance is exactly zero — enforced server-side inside
    `update_project_with_customer`, checked proactively client-side in `ProjectModal`
    — migration `0035`.

- **Prepaid VAT-inclusive rebuild (v3) is COMPLETE, through commit `f365830`**
  (finance-invoice-spec.md v3). Reworks the prepaid model end-to-end:
  - **Model:** top-ups stay plain money. Trips consume `rate_per_trip_sar * 1.15` from
    balance at delivery; special charges consume `amount_sar * 1.15` the instant they're
    added to a draft invoice (not at confirm). ONE FIFO queue drains trips AND charges
    together, oldest-first by date — no separate trip-only/charge-only queues.
    Covered/unpaid is a presentation-only split of that single derived-balance walk, not
    a second consumption pass.
  - **Engine (`lib/prepaid.ts`):** the old v2 quartet (`consumingTrips`/`derivedBalance`/
    `buildStatement`/`splitCoveredUnpaid`) is DELETED — replaced by `consumingItems`/
    `derivedBalanceItems`/`buildStatementItems`/`splitCoveredUnpaidItems` (same shapes,
    trips+charges combined). `VAT_RATE`'s canonical home moved here too (`lib/vat.ts`
    now just re-exports it) — the v3 consumption math needs it directly, one direction
    of flow, no circular import.
  - **Invoice UI:** each trips table (Covered/Unpaid) shows its own stacked Subtotal/
    Balance/Remaining ledger figures below the table (not an in-table row); a faded
    pre-VAT+VAT breakdown sits beside the bold total everywhere (numbers only, no "SAR"
    on the faded half — bold total keeps it); Special Charges gets its own table
    (covered + uncovered, each tagged); Grand Total is one titleless stacked block
    (covered trips + covered charges only) with Amount Due beside it in prepaid, removed
    entirely in postpaid (same figure twice otherwise, no second card); a hide-toggle on
    the Unpaid table header governs print/PDF/email only — always visible on-screen.
  - **Finance tab:** the per-customer table shows SETTLED balance (consumption from
    PAID invoices only — moves only on Mark Paid); the KPI row + over-balance alerts +
    invoice-table ledgers use RUNNING (derived, all consumption) balance — two different
    numbers by design, not a bug.
  - **Migrations:** `0036` (ledger-total columns + `hide_amount_due`), `0037`
    (`payment_mode` snapshot frozen at confirm), `0038` (dropped two stale
    `confirm_invoice` overloads `0036`/`0037` left behind — exactly one 24-arg signature
    live now; see §5's process-lesson note on how those overloads happened).
  - **Legacy invoices** confirmed before `0036`: Balance/Remaining render as "—" (never
    a fabricated 0), and their charges are treated as covered (best-available
    approximation, no backfill — same precedent as every other frozen-snapshot gap).

- **Statement rebuild is COMPLETE, through commit `5889092`.**
  - **Batch 1 (`39ed7f8`):** prepaid pay action is "Pay with Balance" — confirmation
    shows settled balance − Grand Total, records/locks via the existing pay path (no
    double-deduct). Postpaid keeps cash/bank+proof. ~~Known limitation: stored
    `payment_method` is `'cash'` under the hood~~ — **SUPERSEDED by migration `0134`,
    applied: prepaid settlements now store `payment_method = 'balance'`. See the
    `0134` entry below.**
  - **Batch 2 (migration `0039`):** `invoices` gains `payment_reference`/
    `payment_date` (user-entered, distinct from `paid_at`)/`payment_note`, all
    nullable. `pay_invoice` dropped+recreated 6-arg (bank_transfer requires
    reference+date, cash optional); `unpay_invoice` clears them on revert. Exactly
    one signature each.
  - **Batch 3:** statement rebuilt both modes — truck plate+capacity columns
    (`trips.truck_id`→`trucks`, snapshotted at trip creation, not delivery — accepted
    since statements only show delivered trips), period picker (filters rows, footer
    stays all-time), PREPAID/POSTPAID STATEMENT titles with method shown by project.
    Prepaid: VAT-inclusive AMOUNT with stacked faded pre-VAT+VAT, TYPE=water-type-only,
    top-up rows (date/ref/'Top-up'/amount, no note). Postpaid: VAT + TOTAL columns,
    payment rows (`payment_date` date-only, ref or 'Cash', 'Payment', amount under
    TOTAL), 'Total payable' footer.
  - ~~**Deferred related:** real `payment_method='balance'` enum for prepaid
    reporting.~~ **NO LONGER DEFERRED — migration `0134` is applied and verified.
    See its own entry below.**

- **Finance/Invoice page polish (Batches A–D, migrations `0040`–`0042`) is DONE,
  through commit `6601e50`.**
  - **(A) Finance tab relabel + columns:** tab renamed Finance/Invoice; Top-up →
    "Add Balance" labels; Mode → Method; new Unsettled Trips and Rate (incl. VAT)
    columns.
  - **(B) Add Balance popup rebuilt (migration `0040`):** history list + top-corner
    "Add Balance" button; method is cash or bank_transfer — bank_transfer requires
    photo + ETF reference, cash's are optional-but-kept-if-provided; photo viewable
    from the history list. `customer_topups` gains `method`/`photo_path`; new
    `topup-proofs` bucket. (Resolves the "required top-up photo" item that was
    deferred at the Statement rebuild above.)
  - **(C) Sales Return:** `'void'` relabeled "Sales Return" in the UI only — stored
    status/columns unchanged (`void`/`void_reason`/`voided_at`); reuses those
    columns, adds an unpaid-note line naming the invoice number; new "Sales Return"
    notice email template. Already a terminal state, so this was a view-only
    relabel, no lifecycle change.
  - **(D) Three-section legal invoice header** (on-screen, print, and PDF, migrations
    `0041`/`0042`):
    - Buyer: company name EN + AR, address, VAT Registration Number, CR number.
    - Seller: CR Company Name, company name (Arabic), description, CR number,
      address, telephone, phone, VAT Registration Number.
    - Invoice info: invoice number, issue date (`confirmed_at`), period.
    - Most buyer fields pre-existed on `customers` (`name_ar`, `billing_address`,
      `vat_number`, `cr_number`) — Batch D just wired them into
      `create_project_with_customer`/`update_project_with_customer` (migration
      `0041`, drop+recreate with 4 new trailing customer params) and into the
      buyer snapshot (now captures `name_ar` too). "VAT Registration Number"
      reuses the existing `vat_number` column (both `customers` and
      `company_settings` — no new reg-number column); "CR Company Name" reuses
      `company_settings.legal_name`. Genuinely new columns: `company_settings`
      gains `description`/`telephone`/`phone` (0041) and `legal_name_ar` (0042,
      follow-up — seller-side Arabic name, `customers.name_ar`'s counterpart).
    - **Company Settings form now edits every company field** (was email-only) —
      legal_name, legal_name_ar, description, cr_number, vat_number, address,
      telephone, phone, email.

- **Inventory was built as the FULL demo (preview/'s Inventory page: parts +
  warehouses + suppliers + FIFO cost lots + Purchase Orders + Approvals + Financial
  Analysis), in 7 phases. Phases 1–7 of 7 are COMPLETE.**
  - **Phases 1–3:** commits `580e135` (migrations) + `11d9239` (app code).
  - **Phase 4 (Purchase Orders core, draft->issued):** commits `dd67682`
    (migration `0050`) + `ab3008d` (app code).
  - **Phase 5 (PO receiving):** commits `3d55392` (migration `0051`) +
    `fc8005c` (app code).
  - **Phase 6 (PO Approvals):** commits `ab3a414` (migration `0052`) +
    `07c7729` (app code).
  - **Phase 7, partial (Approvals + Financial Analysis tabs):** commit
    `9c3e08a`. Turki flagged these two tabs as entirely MISSING from the app
    (preview has had them since the PO phases began) — this app was a single
    flat page with no tab structure at all until this commit.
  - **Phase 7, final (AI-Suggest-PO + per-part finance report):** migration
    `9e3f2fe` (`0053`), app code committed separately (see below). Closes out
    the 7-phase Inventory build.
  - **Migrations `0043`–`0053`, all applied and verified:** `warehouses`/`parts`
    (0043), `stock_movements` audit ledger + `receive_stock`/`adjust_stock` RPCs
    (0044), `suppliers` entity (0045), FIFO `price_lots` + `add_price_lot`/
    `consume_from_lots` (0046), `stock_receipts`/`stock_receipt_lines`/
    `stock_receipt_files` + private `stock-receipt-invoices` bucket +
    `receive_loose_parts` RPC (0047), `suppliers.name_ar` (0048), `units` lookup
    table, seeded (0049), `purchase_orders`/`purchase_order_lines` + gap-free
    `po_number` counter + `create_purchase_order`/`issue_purchase_order` RPCs
    (0050), `purchase_order_lines.received_qty`/`received_unit_price_sar`,
    `purchase_orders.received_by`/`received_date`, `stock_receipts.po_id`, +
    `receive_purchase_order` RPC (0051), `purchase_order_approvals`
    (UNIQUE per po+approver) + `purchase_orders.rejected_by`/`rejected_at`/
    `rejection_reason` + `approve_purchase_order`/`reject_purchase_order`
    RPCs (0052), `purchase_orders.ai_generated`/`ai_rationale`/
    `ai_rationale_ar` + `create_purchase_order` extended to 9 args (0053 —
    old 6-arg signature dropped, exactly one version in the DB, confirmed).
  - **Built and working (Phases 1–3):** warehouse tabs; parts table with KPIs
    (inventory value/SKUs/low stock) and stock-tier coloring; part drawer
    (pricing snapshot with current/previous price + trend, FIFO batches table,
    stock_movements history, reorder info); Add Parts/receive flow (supplier +
    warehouse pickers, multi-line part/qty/price builder, mandatory multi-file
    invoice upload) with inline New Item / New Supplier / New Warehouse / New
    Unit creates, each merging in-flight and auto-selecting; Category is a
    free-text combo (existing values + free typing, mirrors preview); Unit is
    a lookup-table picker (code + meaning both shown, code is the stored
    value) with its own inline "+ Unit" create.
  - **Built and working (Phase 4):** New PO modal (supplier/warehouse pickers +
    inline creates, "pick a part" filtered to the PO's own warehouse so the
    RPC's consistency guard is never hit in normal use, Save draft / Issue
    now); PO list modal (draft+issued, click-through to detail); read-only PO
    detail (status pill, print via the existing portal+body-class pattern,
    Issue action on a draft); the "Active procurement" proc-strip's Open POs
    chip (header, warehouses.length>0). PO total is NEVER stored — always
    derived from `purchase_order_lines` at render, everywhere it's shown.
  - **Built and working (Phase 5):** Receive Purchase Order modal (per-line
    ordered vs actual qty/price, mandatory invoice upload — same
    `InvoiceFileTile` component the loose-receive flow uses); Awaiting Receipt
    list (issued POs, card grid, matches preview's `openReceiveList` layout);
    "Receive Stock" action on an issued PO's detail view; proc-strip's
    Awaiting Receipt chip. `receive_purchase_order` (0051) composes on
    `receive_loose_parts` (0047) rather than reimplementing receiving — a PO
    receipt gets the exact same mandatory-invoice gate and `stock_receipts`
    write as a loose receipt (see the Phase 5 lesson below for why this
    wasn't the first draft's design).
  - **Built and working (Phase 6):** Approve/Reject actions on a
    `pending_approval` PO (approver identity = the authenticated session,
    same convention as every other actor field in this feature — no persona
    picker like preview's, since this app has real auth; eligibility —
    `staff.role` in the approver set — is enforced by the RPC, not
    duplicated client-side); approvals section on PO detail (who signed off,
    count X/2, rejection block when rejected); Pending Review list; proc-
    strip's third chip (now meaningful, since there's an approve/reject UI to
    click through to). Also closed a Phase 5 gap while wiring this:
    `page.tsx`'s selects were missing `received_by`/`received_date`/
    `received_qty`/`received_unit_price_sar` (columns existed, just never
    selected) — PO detail now shows actual-vs-ordered qty/price per line and
    an "Actual total" once anything's been received.
  - **Built and working (Phase 7, partial):** top-level 3-tab nav (Inventory
    Levels / Approvals / Financial Analysis, preview's own `inv-tabs`) —
    header actions (New PO/Add Parts) and the ProcStrip/search/parts-table
    are Inventory-Levels-tab-scoped now, matching preview; a 5-stat KPI row
    (added Open POs + Pending Approval to the existing 3) sits above the
    tabs, always visible, also matching preview. Approvals tab:
    `pending_approval` queue, approval-dot progress, quick Approve action
    per row. Financial Analysis tab: Spend 30d/90d (real dates), inventory
    value, open PO count, top-spend-category + spend-by-supplier bar
    charts, AI Insights card (low-stock/price-up/consolidate
    recommendations, read-only for now).
  - **Built and working (Phase 7, final):** "AI-Suggest" header button
    (Inventory-Levels-tab-scoped, disabled — not toasted, no toast utility
    exists anywhere in this app — when there's nothing to reorder) and the
    Financial Analysis tab's low-stock insight "AI-Suggest ->" CTA, both
    calling `suggestAIPurchaseLines()` (a client-side heuristic — parts
    at/below reorder level, excluding parts already on an open draft/issued
    PO — paired with one of 4 canned `{en,ar}` rationale strings, same as
    preview; NOT a real model call, same as preview) and opening `NewPOModal`
    prefilled via its `aiSuggestion` prop (supplier/warehouse/lines seeded,
    `.ai-banner`-style callout shown, `ai_generated`/`ai_rationale`/
    `ai_rationale_ar` persisted through `createPurchaseOrder()` at submit).
    "★ AI" badge next to the PO number everywhere a PO row/header appears
    (POListModal, PODetailModal, ReceiveListModal, ApprovalsListModal,
    ApprovalsTab, PartFinanceModal's purchase-history rows) when
    `ai_generated` is true; PODetailModal also shows the full rationale
    banner. Per-part finance report (`PartFinanceModal`, preview's
    `openPartFinance`/`partFinance()`) opened from a new chart-icon button on
    the parts table (next to "View"): purchases/stock-value/price-trend
    stat row (real, from `purchase_order_lines` + `price_lots`), an AI tip
    card (critical-stock / price-up / overstocked / healthy, same tiering as
    preview), and a purchase-history table linking back to each PO's detail
    view.
  - **Dormant by design (RPC exists, no app-code caller yet — do not remove, do
    not treat as dead code):** `consume_from_lots` (0046, lights up at
    work-order-parts-usage — PO receiving now has a caller via
    `receive_purchase_order`->`receive_loose_parts`->`add_price_lot`, so this
    is narrower than before: only the *Maintenance* consumption path is still
    unwired); `receive_stock` (0044, superseded by the lot-based
    `receive_loose_parts` — its APP-CODE WRAPPER was deleted as genuine dead
    code in the cleanup pass, but the RPC itself stays live in the DB).
    Movement-history/maintenance-usage log is blocked on `work_orders`
    existing (Maintenance phase, not built yet) — stock_movements stands in
    for it today.
  - **Deliberate deviations from `preview/` — do NOT let a future "match the demo"
    pass revert these, they were each a specific Turki call, not an oversight:**
    Adjust Stock (manual stock-correction path; preview has no such UI — no FIFO
    tiers to "recount" against); weighted-average cost shown to 2 decimals (every
    other SAR figure in this app is whole-number); units as a first-class lookup
    table with inline add (preview hardcodes a hardcoded unit list); supplier
    Arabic name (preview's supplier form has no name_ar); category stays a
    free-text combo (Turki's explicit instruction, not moved to a lookup table
    like units were); PO receiving requires `status='issued'` (0051), not
    draft-or-issued like preview; approver identity is the real session email
    (0052), not preview's persona picker; AI-Suggest groups candidate parts by
    `warehouse_id` (the largest group, capped at 5 lines like preview), not
    preview's supplier-based grouping — this app's `create_purchase_order`
    enforces one supplier + one warehouse per PO (0050's guard), so warehouse
    is the hard constraint here; supplier is only prefilled best-effort when
    every part in the group shares the same `parts.supplier` value matching a
    real `suppliers.name`, otherwise left for the user to pick. Per-part
    finance report drops preview's consumption/usage stats
    (`spentByConsumption`/`totalConsumed`) and the "purchased but not
    consumed" AI-tip branch — this app has no consumption/usage workflow yet
    (`stock_movements`' `'consume'` movement_type exists in the 0046 CHECK
    constraint but nothing writes it), so that section was dropped rather
    than faked; everything else in the report (purchases, stock value, price
    trend) is real data.
  - **Post-Phase-7 audit + gap-closing pass:** a full systematic comparison
    against `preview/` (functional/wording + a separate git-history + visual/
    CSS pass) turned up a list of real gaps; Turki approved all of them, then
    excluded six as a separate, data-risk track — **NOT done in this pass,
    still open:** unified receive with extra ad-hoc lines on a PO receipt
    (preview's `_renderReceiveModal` PO-lookup field / `ReceivePOModal`'s
    inability to add lines — same underlying gap described two ways);
    sequential auto-SKU; single-part quick-reorder (`INV.openReorder`); the
    Actual-Total column on the Approvals queue; New PO's default supplier;
    and every visual/CSS/styling finding (colors, `.btn` hover/press
    micro-interactions, `.card` radius/shadow, icon substitutions — none of
    that is being done at all, not just deferred).
    **Closed in this pass (no migration needed — real data already
    selected):** wording (`inv.printInvoice`→"Print as Invoice",
    `inv.saveLot`→"Save Lot", `c.lowStock`→"Low Stock Items", page subtitle
    content-matched to preview's message shape but on the real warehouse
    count, not preview's hardcoded "3"); stock-cell `title` tooltip wired to
    the already-existing `TIER_LABEL` map; `NewPOModal`'s expected-delivery
    now defaults to today+7 (preview's own default); AI-Suggest's disabled
    header button now carries preview's "nothing to reorder" toast text as
    its `title` attribute (no toast utility exists in this app); PO detail
    now shows `Requested by` (`requested_by` was already selected in
    `page.tsx`, just never rendered); `PartFinanceModal` gained a footer
    (Close + "View Part", jumping to the full drawer); the ProcStrip's
    "Pending review" chip now switches to the Approvals tab directly
    (`onGoToApprovals`, matching preview's `INV.setTab('approvals')` exactly)
    instead of opening a standalone popup — `ApprovalsListModal` had no other
    entry point and preview has no such popup at all, so it was deleted
    rather than left unreachable; `ApprovePOModal` now pre-checks whether the
    current session already approved this exact PO and swaps the form for
    preview's own message (`inv.youCannotApprove`) instead of only surfacing
    a raw RPC error after submit — the real enforcement stays the DB's
    `UNIQUE(purchase_order_id, approver_email)` constraint (0052), this is a
    friendlier message in front of it, not a new security control. `Btn`
    (`components/ui.tsx`, shared primitive) gained an optional `title` prop
    (`disabled` was already added in the Phase 7 AI-Suggest pass) to support
    the above — backward compatible, every other caller unaffected.
  - **Turki tested `e9a03d5` and reported 4 real issues, fixed:** (1) the
    AI-Suggest button's disabled-state tooltip never showed — a `title` on a
    `disabled` `<button>` doesn't fire hover in Chrome/most browsers; fixed
    by moving the `title` onto a wrapping `<span>` instead (the `Btn`'s own
    `disabled:pointer-events-none` lets hover fall through to it). (2)
    `PODetailModal`'s info grid was missing `PO Number` entirely and hid
    `Received by`/`Received on` completely pre-receipt instead of showing
    them with preview's own `—` fallback — rebuilt to match preview's exact
    8-field grid/order (PO Number, Status, Issued on, Expected delivery,
    Requested by, Received by, Received on, Warehouse), all unconditional.
    (3) `PartFinanceModal` was missing the `Consumption (all time)` stat and
    was sized at `max-w-[720px]` instead of the `max-w-[1080px]` every other
    `size:lg` popup in this app uses (see `InventoryClient.tsx:130`) — fixed,
    and see the next bullet for why consumption isn't a fabrication despite
    the earlier "no consumption workflow" deviation note. (4) The part
    drawer (`ViewPartModal`) was missing preview's own inline "Financial
    summary" card (`inv.perPartFinance`, pages-2.js:1766-1809) entirely —
    preview shows the exact same 4-stat-grid + AI-tip block in BOTH the
    drawer AND the standalone finance popup; this app only had the popup.
    Fixed by factoring `computePartFinanceStats()` (pure calc) +
    `PartFinanceSummaryCard` (render) out of `PartFinanceModal` into shared
    exports (`PurchaseOrders.tsx`) that `ViewPartModal` now also calls —
    one definition of each number, not two hand-copied ones that could
    drift. **Consumption stat, revisited:** the earlier "dropped rather than
    faked" reasoning (see the deviation note above) was too conservative —
    preview's OWN consumption numbers are static seed data too (`partUsage`
    in `data.js`), not derived from any live workflow in preview's own UI
    either. This app derives the same stat from real `stock_movements` rows
    where `movement_type='consume'` (0046) — honestly always 0 today (still
    nothing writes that type), not fake, and it'll start moving the moment a
    real consumption flow (Maintenance/work-orders) ships. `spentByConsumption`
    specifically stays 0 even then until `stock_movements` gains a per-
    movement cost column (currently only `qty_delta`/`qty_after`) — flagged
    in `computePartFinanceStats`'s own comment for whoever builds that flow.
  - **Test 6 (asked, then fixed): "Add new price" removed, replaced with a
    prefilled "Add Parts."** Turki's original ask read two ways — open the
    real "New Item"/AddPartModal prefilled (would insert a SECOND part row,
    same name, different SKU/id — duplicate-part risk) vs. prefill the
    existing receiving flow with this part as a line (adds stock to the SAME
    part, real invoice/`stock_receipts` record, no new row). Asked before
    building (data-integrity stakes either way) — Turki confirmed the
    receiving-flow route. `AddPriceLotModal` (the drawer's old standalone
    quick-action, and its `addPriceLot()` client wrapper in `actions.ts`) is
    DELETED — no other entry point, same "no dead code left unreachable"
    call as `ApprovalsListModal` earlier in this pass. The `add_price_lot`
    RPC itself stays live (still called by `receive_loose_parts`/
    `receive_purchase_order` internally). The drawer's button is now "Add
    Parts" (`PackagePlus`, same label/icon as the header button), opening
    `ReceivePartsModal` via a new optional `prefill` prop (`{warehouseId,
    lines}`) — seeds `warehouseId`/`lines` initial state exactly like
    `NewPOModal`'s `aiSuggestion` prop already does. Default qty: enough to
    clear `reorder_level` if set (`reorder_level - qty_on_hand + 1`,
    minimum 1), else 1 always — Turki's exact spec. Default price: the
    part's current price (`currentLot?.price_sar ?? unit_cost_sar`). Supplier
    is left unset (same reasoning as AI-Suggest's best-effort-only supplier
    prefill) — `parts.supplier` is free text, not guaranteed to match a real
    `suppliers.name`.
  - **Migration `0054`, applied and verified — data-only, no schema
    change:** grants Turki's own login (`turkias.co@hotmail.com` — the
    original draft targeted `turkislimah@gmail.com`, corrected before
    running once Turki confirmed his actual session email) approval access.
    Root cause of test 10's "Not authorized to approve purchase orders":
    `approve_purchase_order` (0052) requires a `public.staff` row for the
    actor's email with an eligible role (`fleet_manager`/`ops_supervisor`/
    `inventory_clerk`), `active=true`, `terminated_at is null` — checked
    live, no `staff` row existed for that email at all. `0054` upserted one
    with `role='fleet_manager'` (idempotent — updates if a row already
    exists, inserts if not). Turki's own framing ("always give all
    access... full authority... for testing and managing") is honored for
    THIS login specifically, not by loosening the RPC's role check for
    everyone — that stays a real business rule, matching preview's own
    `APPROVER_ROLES` model.
  - **Per-warehouse scoping (first of the "risky batch," app-only, no
    migration/RPC touched) — a tab per warehouse, no combined/all view.**
    Turki's explicit requirements, a deliberate departure from preview
    (preview's own per-warehouse control is a dropdown with an "All
    warehouses" option — this app has no combined view at all): a new tab
    row (one button per warehouse, `warehouseTab` state, defaults to the
    first warehouse) sits directly below the page title, above everything
    else. It filters ONLY `visibleParts` (search/category/table) — the old
    `warehouseFilter` dropdown inside the Inventory Levels filter bar is
    gone, fully replaced. **Everything else on the page stays exactly as
    global/unscoped as it already was** — a deliberate, narrower read of
    "stays global" than scoping everything: the 5-stat KPI row, ProcStrip's
    three chips, the Approvals tab, the Financial Analysis tab, and
    AI-Suggest's own warehouse-grouping heuristic were ALL already computed
    from every part/PO regardless of warehouse (matches preview's own
    behavior — see the KPI row's own pre-existing comment), and none of
    that changed. Only the two manual create-flows got a small, in-scope
    ergonomic addition: `NewPOModal`/`ReceivePartsModal` gained an optional
    `defaultWarehouseId` prop, defaulting their warehouse picker to the
    page's active tab instead of always the first warehouse (still fully
    editable, still overridden by `aiSuggestion`/`prefill` when either is
    set). Suppliers/units confirmed already unscoped structurally (neither
    table has a `warehouse_id` column) — nothing to change there.
    **"+ Warehouse" removed from every popup** (`NewPOModal`,
    `ReceivePartsModal`) — `CreateWarehouseModal`'s header instance is the
    only entry point now, and now auto-switches the page's active
    warehouse tab to whatever was just created (`onCreated` prop, wasn't
    wired there before). Removing the inline triggers made the
    "merge locally-created warehouse into the list" pattern
    (`localWarehouses`/`newWarehouseOpen`/`allWarehouses`) dead in both
    modals — removed alongside, along with `PurchaseOrders.tsx`'s now-
    orphaned `CreateWarehouseModal` import (its one caller was the trigger
    just removed).
  - **Stage 2 of the "risky batch" — unified receive with extra ad-hoc
    lines. Migration `0055`, applied and verified.** `receive_purchase_order`
    (0051) reworked to accept two `p_lines` element shapes: existing PO
    lines (`{line_id, received_qty, received_unit_price_sar}`, unchanged)
    and extra parts the supplier delivered that were never on the PO
    (`{part_id, received_qty, received_unit_price_sar}`, new) — both feed
    the same `receive_loose_parts()` call unchanged, so the mandatory-
    invoice gate, `add_price_lot`, and the FIFO invariant are identical for
    both. On save, the PO's own `purchase_order_lines` gets a genuinely new
    row per extra part (ordered = received, since there's no real "ordered"
    figure for something never ordered) — checked preview's actual
    `confirmReceipt()` first (not assumed): preview's own demo silently
    drops this reconciliation for ad-hoc lines, so this app deliberately
    goes beyond preview's own (incomplete) behavior here, per Turki's
    explicit ask.
    - **UI (`ReceivePOModal`, `PurchaseOrders.tsx`):** the line table now
      distinguishes PO-derived lines (ordered qty/price shown, a Match/
      Variance pill — preview's own `pill-ok`/`pill-warn`, exact hex) from
      extra ones (an "Extra — not on PO" badge, no ordered figures to
      compare). A "pick a part to add" control below the table is
      restricted to the PO's own warehouse and excludes parts already on
      the draft — the same guards the RPC itself enforces, surfaced
      client-side so the picker never even offers something that would be
      rejected. Extra lines always have a remove button; PO-derived lines
      only get one once detached (see below) — every PO line must still be
      included otherwise, same completeness rule as before.
    - **Detach from PO — Turki's own requirement, zero preview equivalent.**
      A checkbox-style toggle in the modal switches which server action
      `submit()` calls: checked, it calls `receiveLooseParts()` (0047 — the
      exact same action the header's "Add Parts" flow already uses) with
      the draft's current lines/files/note and the PO's own supplier_id/
      warehouse_id (still not editable — detaching changes whether the PO
      gets reconciled, not what was received); unchecked (default), it
      calls `receivePurchaseOrder()` as before. Detaching never touches the
      PO at all — no `po_id` stamped, no status change, no PO line writes.
      This needed no new server action — `receiveLooseParts()` already
      existed for the loose-receive flow.
    - `actions.ts`: `ReceivePoLineInput` is now a union type mirroring the
      RPC's two shapes exactly; `receivePurchaseOrder()`'s validation
      accepts either and its error path now runs through `friendlyPoError()`
      (already existed for `create_purchase_order`'s own warehouse-mismatch
      message — same substring, reused as-is) for the new extra-line
      warehouse-guard error.
  - **Stage 3 of the "risky batch" — 7 app-only fixes/additions, no
    migration/RPC touched.**
    - **Items 1 + 7, one fix.** Every Inventory modal except `PODetailModal`
      rendered its `fixed inset-0` backdrop inline in the component tree,
      not portaled — `PODetailModal` was the one exception, already using
      `createPortal(..., document.body)`. Traced two real bugs to that: (a)
      the backdrop clipped at the top (an inline `fixed` element only
      anchors to the true viewport when nothing in its ancestor chain
      establishes a new containing block — portaling removes the
      ambiguity), and (b) stacked popups (e.g. "+ New Item" over "Add
      Part") — a child modal's backdrop div is a DOM CHILD of the parent's
      own backdrop div when rendered inline, so clicking the child's dimmed
      backdrop to dismiss it bubbles the click straight into the parent's
      backdrop too, closing both and losing the parent's typed input.
      Fixed with one shared `ModalOverlay` component
      (`SharedCreateModals.tsx` — portal + `mounted` guard, same pattern
      `PODetailModal` already used, plus `stopPropagation()` on its own
      backdrop click as belt-and-suspenders) — all ~14 other inventory
      modals across `InventoryClient.tsx`/`PurchaseOrders.tsx`/
      `SharedCreateModals.tsx` now use it instead of a raw backdrop div.
      Portaling makes stacked modals DOM siblings, not nested, so a child's
      backdrop click has no parent-modal ancestor left to bubble into.
    - **Items 2 + 3 — KPI row + "Active Procurement" (ProcStrip) now scope
      to the active warehouse tab; Approvals-tab badge + Financial Analysis
      stay global.** New `kpi*`-prefixed variables (`kpiInventoryValue`/
      `kpiSkuCount`/`kpiLowStockCount`/`kpiOpenPOsCount`/
      `kpiAwaitingReceiptCount`/`kpiPendingReviewCount`/`kpiPurchaseOrders`)
      computed from `parts`/`purchaseOrders` filtered to `warehouseTab` —
      NOT a rename/in-place filter of the existing global variables, since
      those still feed the Approvals-tab's own badge count and
      `FinancialAnalysisTab`'s props, both required to stay global. Also
      scoped what `POListModal`/`ReceiveListModal` show (their
      `purchaseOrders` prop is now `kpiPurchaseOrders`) so a ProcStrip
      chip's count always matches what clicking it opens.
    - **Item 4 — every `AddPartModal` field is now required.** Real
      behavior change: the client-side `autoSku()` "generate if blank"
      helper is gone entirely (removed as dead code, not left orphaned) —
      "required" and "auto-fill if blank" are contradictory. Name (Arabic),
      SKU, Category, Unit, Unit price, Reorder level, and Reorder qty are
      all now hard-gated in `canSubmit`, matching the item/equipment name
      field's existing requirement.
    - **Item 5 — `ReceivePartsModal`'s "pick a part to add" dropdown is now
      scoped to its own selected warehouse.** Was listing every part
      system-wide; `NewPOModal`'s own `partsInWarehouse` pattern already did
      this correctly — this was the one place it was missing. New
      `partsInWarehouse` memo, same filter (`p.warehouse_id === warehouseId`).
    - **Item 6 — a draft PO can now be edited.** The one deliberate
      exception to "every PO mutation goes through an RPC" in this whole
      feature — flagged, not slipped in. New `updatePurchaseOrder()` server
      action (`actions.ts`) does 3 separate Supabase calls (update header
      gated on `status='draft'`, delete old lines, insert new ones) instead
      of one RPC transaction — accepted specifically because a draft
      carries zero real-world commitment yet (nothing issued, no stock
      moved, no approval started), so worst case on partial failure is a
      draft temporarily missing lines, fixable by editing again — not a
      data-integrity incident. Re-implements create_purchase_order's own
      validation (supplier/warehouse exist+active, every line's part
      belongs to the chosen warehouse) in TypeScript, since there's no RPC
      backing this to do it server-side otherwise. `NewPOModal` gained an
      `editingPO` prop (mutually exclusive with `aiSuggestion`) prefilling
      every field from the existing draft; submit routes to
      `updatePurchaseOrder()` instead of `createPurchaseOrder()` when set,
      everything after that (Issue now, error handling) unchanged. New
      "Edit" button on `PODetailModal`'s footer, draft POs only — no
      preview equivalent (preview never lets you edit a saved PO either).
  - **Stage 4 of the "risky batch" — 4 app-only items, no migration/RPC
    touched.** (Migration `0054` — grants Turki's real login `fleet_manager`
    access for PO approval — was drafted/applied/verified earlier but stays
    intentionally uncommitted; not in scope for this stage's commit either.)
    - **Item 1 — single-part quick-reorder.** Preview's own `INV.openReorder`
      (pages-2.js:1877), previously excluded as a data-risk item, now built.
      New cart-icon button on a `PartsTable` row (gated on
      `stockTier(p) === "critical"`) and a "Create PO" footer button on
      `ViewPartModal` (same gate) both call a new `openQuickReorder(part)`
      handler in `InventoryClient.tsx`, which builds a `NewPOQuickReorder`
      (`PurchaseOrders.tsx`) — `{ warehouseId, supplierId, line }` — and
      opens `NewPOModal` with it. Qty prefills to
      `max(1, reorder_level - qty_on_hand + 1)` (same formula already used
      for the "Add Parts" drawer-button prefill). Supplier prefills from
      `findLastSupplierId()`: the most recent PO (by `request_date`, any
      status) with a line for this part, falling back to matching the
      static `parts.supplier` free-text field against a real supplier's
      name (same heuristic `suggestAIPurchaseLines` already uses), then
      `null`. The warehouse is **locked**, not just defaulted:
      `NewPOModal`'s new `lockWarehouseId` derived value disables every
      `<option>` except the part's own warehouse in the warehouse
      `<select>` — the select itself stays interactive/openable (per
      Turki's explicit wording), only the non-matching options are
      individually disabled. Mutually exclusive with `aiSuggestion`/
      `editingPO` (all three share `newPOOpen` + `NewPOModal`'s create-mode
      branch); every existing opener of `NewPOModal` now also clears
      `quickReorder` so a plain "New PO" click afterwards opens blank.
    - **Item 2 — Approvals queue gained an "Actual Total" column.**
      `ApprovalsTab` (`PurchaseOrders.tsx`) takes a new `purchaseOrderLines`
      prop; each row sums `received_qty * received_unit_price_sar` across
      that PO's lines. No ordered-value fallback needed (unlike
      `PODetailModal`'s line table) — every PO reaching this queue is
      `pending_approval` or later, meaning `receive_purchase_order` has
      already stamped both received fields on every line (0051/0055's own
      contract).
    - **Item 3 — `NewPOModal` gained a "Supplier contact" info card**
      (preview's own `_supplierCardHtml`/`#poSupplierCard`,
      pages-2.js:2241-2255 — never built here before; only `PODetailModal`
      had the equivalent). Blank `—` until `supplierId` is set (no default
      supplier was ever picked automatically — confirmed the field's
      `useState` initializer has no such fallback); once picked, shows
      `name`, then `name_ar` beneath it if set (a field preview's own
      suppliers don't have at all — migration `0048`'s addition), plus
      contact person/phone/email, same fields `PODetailModal`'s card
      already shows.
    - **Item 4 — auto-SKU in `AddPartModal`.** New
      `computeAutoSku(existingSkus)` (`SharedCreateModals.tsx`) — NOT
      name-based (first draft derived the SKU from the typed name; Turki
      caught this as wrong before commit). Default is `"SKU-"` + any
      random number not already used by an existing SKU in the parts
      table — doesn't have to follow the highest, any unused number is
      fine, just re-rolled until it misses the full parts-list collision
      set. Seeded once via `useState`'s lazy initializer at mount (not
      re-derived from the name field — there's nothing name-related to
      react to anymore), replacing the random-suffix `autoSku()` deleted
      as dead code in Stage 3. SKU stays `required` (already true since
      Stage 3) and stays fully editable — this is a convenience default
      only, `parts.sku`'s `unique not null` constraint (migration `0043`)
      was already the real enforcement, unchanged.
    - **Verification:** built a throwaway `/inv-batch-test` diagnostic
      route (mock data, no Supabase/auth — same technique as every prior
      stage's render-verification) mounting `InventoryClient` +
      `AddPartModal` directly, plus a temporary `lib/supabase/
      middleware.ts` auth-gate bypass to reach it unauthenticated. Wrote
      a Playwright test (`tests/inventory-batch.spec.ts`,
      `playwright.config.ts`, new `@playwright/test` devDependency —
      first browser-test infra in this repo) covering all 4 items against
      that route; all 4 passed. Diagnostic route deleted and the
      middleware bypass reverted (confirmed `git diff` empty) before
      finishing; dev server restarted clean, `/login` 200 and
      `/inventory` 307 reconfirmed. The Playwright test file depends on
      the now-deleted `/inv-batch-test` route to actually run — it's
      documentation of what was verified, not a standing regression
      suite, unless Turki wants the diagnostic route kept permanently for
      that purpose (his call, flagged, not decided here).
  - **Stage 5 — VAT on parts invoices. Migration `0056` (applied/verified
    earlier, invariant clean) + its app-code UI, both in scope now.**
    Fixed 15% (ZATCA), entered unit prices VAT-EXCLUSIVE, PER-LINE
    rounding summed for the document total (`round(qty * unit_price *
    0.15, 2)` per line, then SUM the already-rounded lines) — the
    opposite of `lib/vat.ts`'s own document-level-rounding rule for
    customer invoices (that file's header quotes ZATCA's own invoice-XML
    rule for why IT rounds once; parts VAT is a genuinely different,
    separately-correct convention for a different document). New
    `lib/inventory-vat.ts` — borrows ONLY `VAT_RATE` from `lib/prepaid.ts`
    (a read, not a modification), never routes through `lib/vat.ts`'s
    `calculateVat()`. `lib/vat.ts`/`prepaid.ts`/`invoice.ts` untouched, as
    required.
    - **Columns (0056):** `purchase_order_lines.line_vat_sar` (+
      `received_line_vat_sar`, nullable), `purchase_orders.subtotal_sar`/
      `vat_sar`/`total_sar` (+ `received_subtotal_sar`/`received_vat_sar`/
      `received_total_sar`, nullable), `stock_receipts.vat_sar`/
      `grand_total_sar` (`total_cost_sar` unchanged), `stock_receipt_lines
      .line_vat_sar`. All additive, no backfill — a pre-0056 record (e.g.
      `PO-2026-0003`) reads 0/null on every new column, confirmed via
      Supabase MCP query before building any UI against it. `price_lots`/
      `parts.unit_cost_sar` gained NO column — VAT for those is computed
      live, display-only, never stored (see below).
    - **Where VAT shows, exactly:** New PO (line table gets a "VAT (15%)"
      column right after unit cost, before Subtotal; footer becomes a
      3-line stack — subtotal, then `+ VAT`, then bold total — replacing
      the old single-line "Estimated total"); Add Part (a live "+ VAT
      (15%): X per unit" readout under the Unit price field — display
      only, `parts.unit_cost_sar` itself is never touched, stays
      VAT-exclusive); the part-row chart's Purchase history table
      (`PartFinanceModal`) gets the same VAT column, sourced from each
      line's STORED `received_line_vat_sar ?? line_vat_sar` (never
      recomputed); the part drawer's Stock batches (FIFO `price_lots`)
      table gets a VAT column too, but computed LIVE from that lot's own
      `qty_purchased * price_sar * 15%` — `price_lots` has no stored VAT
      column, nothing to go stale; and the "Financial summary" card's
      Purchases stat (`computePartFinanceStats`/`PartFinanceSummaryCard`)
      gained a `+ VAT = grand total` subline, summed from the same stored
      per-line figures — the ONLY one of that card's 4 stats to change;
      Stock Value/Consumption/Price Trend are byte-for-byte untouched.
    - **Where VAT stays off, deliberately:** `FinancialAnalysisTab`
      (Spend 30d/90d, top-spend-category/by-supplier bars, AI Insights) —
      explicitly named "financial analysis" in Turki's own exclusion list,
      distinct from the per-part "financial summary" card above, which DOES
      get VAT — confirmed by exclusion once the tab's own content was read
      end-to-end and none of it overlapped the inclusion list. Also
      untouched: KPI row's Inventory Value, `PartsTable`'s Stock Value
      column, the Pricing snapshot card (current/previous price + trend +
      avg cost), and every consumption figure.
    - **Consistency extensions beyond the 5 named spots (not asked for
      verbatim, but the same PO/receipt data is already shown elsewhere in
      this feature and leaving those screens VAT-blind would have been a
      visible, confusing gap):** `PODetailModal`'s line table + footer
      (same VAT column + 3-line stack, reading the STORED header/line
      figures with a fallback to the pre-existing derived total only for a
      pre-0056 PO, so a real historical PO doesn't render a false "0");
      `ReceivePOModal`'s line table + footer (same, client-side preview via
      `calculateInventoryVatDocument`, since the RPC recomputes and stores
      the real figures at submit time); the Approvals queue's existing
      "Actual Total" column (Stage 4, item 2) upgraded from a flat
      qty×price sum into the same subtotal/VAT/total stack, reading
      `purchase_orders.received_subtotal_sar/received_vat_sar` with the
      same pre-0056 fallback.
    - **`updatePurchaseOrder`** (`actions.ts`, the one PO-mutation path not
      backed by an RPC, flagged since Stage 3) now also computes and
      writes `line_vat_sar` per line and `subtotal_sar`/`vat_sar`/
      `total_sar` on the header, via `lib/inventory-vat.ts` — otherwise
      editing a draft PO would silently zero out its own VAT figures.
    - **Verification:** DB state checked directly via the Supabase MCP
      before writing any UI (confirmed `PO-2026-0003` reads 0/null on
      every new column, confirmed the FIFO invariant query returns zero
      rows). Built a throwaway `/inv-vat-test` diagnostic route + temporary
      middleware bypass (same technique as every prior stage) using a
      REAL existing part/price-lot pair (queried live via the Supabase
      MCP) so the Stock batches table's own auth-gated server action
      (`getPriceLots`) had real rows to return — this diagnostic route has
      no real login session, so RLS quietly returns empty for anything
      fetched that way; the one place this bit (Stock batches' exact VAT
      *value*) the test verifies the column header only and notes why —
      Turki's own in-browser check covers the populated case, same as
      every stage. New `tests/inventory-vat.spec.ts`, 7 tests, all passed
      (New PO, Approvals real+legacy, Add Part, Stock batches header +
      Pricing-snapshot absence, Financial summary Purchases + 3-stat
      absence, Purchase history real+legacy, Financial Analysis tab
      whole-page absence). Diagnostic route deleted and the middleware
      bypass reverted (confirmed `git diff` empty) before finishing; dev
      server restarted clean, `/login` 200 and `/inventory` 307
      reconfirmed. (Running the OLDER `tests/inventory-batch.spec.ts`
      afterward now fails all 4 of its own tests — expected, not a
      regression: it depends on `/inv-batch-test`, deleted at the end of
      Stage 4 per this same convention, documented there already.)
  - **Stage 5 follow-up — 4 VAT DISPLAY fixes, presentation/arrangement
    only.** Stored VAT data itself (migration `0056`) was already correct
    and verified — nothing here recomputes VAT, touches an RPC, or touches
    `lib/inventory-vat.ts`/`vat.ts`/`prepaid.ts`/`invoice.ts`. Every figure
    below reads a value already stored or already being computed the same
    way as some other already-built spot in this feature.
    - **Item 1 — Add Part's VAT readout wasn't visible enough.** Was a
      single `text-[11px] muted` caption ("+ VAT (15%): X per unit") — easy
      to miss, unlike New PO's own clearly-labeled VAT column. Replaced
      with two labeled, normal-weight readouts side by side ("VAT (15%):
      X" / "Total (incl. VAT): Y"), same `calculateInventoryVatDocument()`
      helper New PO's own footer already calls (one line item, qty 1) —
      not a new formula, just a more visible presentation of the same
      number.
      - **Follow-up (Turki: still not rendering at all after the above).**
        Investigated the 3 candidate causes named in the ask (dead
        condition, qty/price not wired, dead branch, values 0/hiding) —
        none reproduced. Live-verified through all 3 real mount paths this
        component is actually used from (New PO's "+ New Item", Add
        Parts' "+ New Item", and a standalone mount) via a throwaway
        route + Playwright, typing a price into Unit price each time —
        the readout rendered correctly (`VAT (15%): 15 SAR` /
        `Total (incl. VAT): 115 SAR` for a 100 SAR entry) in every case,
        both before AND after the hardening below. No reproducible code
        defect found — most likely a stale dev-server/fast-refresh state
        on the browser side at the time it was checked, not a logic bug.
        Hardened anyway, since it was already there: `parseNumField
        (unitCost)` was being called twice (once for the VAT figure, once
        for Total) — collapsed into one parsed `price` value read once.
        Deliberately did NOT hoist the readout out of the Unit-price
        `<label>` into its own grid cell — this form is `grid
        grid-cols-2`, and a sibling node there would have shifted every
        field after it into the wrong column; stayed nested inside the
        same `<label>`, same position as before.
      - **Second follow-up — Turki: still absent from the STANDALONE
        header "Add Part" button specifically ("unit price and quantity
        both filled"), distinct from the "+ New Item" paths already
        verified.** The "quantity" detail was the tell: `AddPartModal`
        (the single-new-SKU form) has no qty field at all — the header
        has no standalone "Add Part" (singular) button either (only "New
        PO" / "Add Parts" / "AI-Suggest", confirmed by reading the actual
        JSX, not just the historical comment saying the old standalone
        button was deleted). What Turki meant was the header's "Add
        Parts" (plural) button — `ReceivePartsModal`, the LOOSE receiving
        flow (no PO), which DOES have a qty + unit price per line, same
        shape as `ReceivePOModal` (its PO-linked sibling, already
        VAT-treated). This one had never been touched — genuinely 0
        VAT anywhere in it, not a rendering bug, a real gap. Fixed with
        the exact same pattern as `ReceivePOModal`: VAT column after
        "Actual unit price" (`lineVat(l.qty, l.unit_price_sar)`), and the
        footer's single "Actual total" row replaced with the subtotal/
        VAT/total stack (`calculateInventoryVatDocument` over `lines`).
        Verified live through the actual header "Add Parts" button
        specifically (not a standalone mount) before reporting fixed.
    - **Item 2a — Stock batches' "Subtotal" was pre-VAT; renamed "Total",
      made VAT-inclusive.** Was `qty_remaining x price_sar`, labeled
      "Subtotal". Now the VAT column (added in the original Stage 5 pass)
      switched its own basis from `qty_purchased` (the batch's original
      received quantity — a historical "what was booked at receipt time"
      figure) to `qty_remaining`, matching the renamed "Total" column's own
      basis — so the row now foots correctly (VAT + pre-VAT subtotal =
      Total), instead of two columns quietly using two different
      quantities. `price_lots` still has no stored VAT column (0056's own
      design — a FIFO ledger row isn't a booked document) — both figures
      stay live-computed from its own `qty_remaining`/`price_sar`, same as
      before, just consistently.
    - **Item 2b + item 3 — same fix, two spots: total-first, breakdown
      below (was subtotal-first, breakdown below).** The Financial summary
      card's "Purchases" stat and the Purchase history table
      (`PartFinanceModal`, opened via the part-row chart-icon button) both
      used to show the pre-VAT subtotal as the bold headline figure with a
      small "+ VAT = total" line underneath — backwards from what Turki
      wanted. Both now lead with the bold VAT-inclusive total, with a
      faded "{subtotal} + {vat} VAT" line below it — same two source
      numbers each time (`totalPurchased`/`purchasesVat` for the stat;
      `cost`/`vat` per row for the history table), just re-perspectived,
      not recomputed. The history table's separate "VAT" and "Cost"
      columns were merged into one "Total (incl. VAT)" column (5 columns
      now, not 6) to make room for the stacked total/breakdown, same
      pattern the Approvals queue's own Actual Total column already uses.
    - **Item 4 — Open PO list's "PO Total" was pre-VAT; now VAT-inclusive,
      reading the stored header figure.** `POListModal` (opened via
      "Active Procurement"'s "Open POs" chip) always shows draft/issued
      POs — never yet received, so only the ORDERED-side header total
      applies. Was `poTotal()` (a local helper re-deriving
      `qty x unit_price_sar` from lines, pre-VAT) — now reads
      `po.total_sar` directly (written by `create_purchase_order`/
      `updatePurchaseOrder` at write time, already VAT-inclusive), falling
      back to the old `poTotal()` derivation only for a pre-0056 PO
      (`total_sar` reads 0 there, honestly — not back-computed, same
      precedent as every other pre-migration fallback in this feature).
      `poTotal()` itself stays alive as that fallback, not removed.
    - **Verification:** built a throwaway `/inv-vat-fix-test` diagnostic
      route + temporary middleware bypass (same technique as every prior
      stage), reusing the same REAL existing part/price-lot pair (queried
      live via the Supabase MCP) as the original Stage 5 pass, plus a new
      mock draft PO (`po3`, real stored ordered-side VAT: 500 subtotal / 75
      VAT / 575 total) to exercise the Open PO list. New
      `tests/inventory-vat-fixes.spec.ts`, 5 tests, all passed (Add Part
      readout visibility, Stock batches rename+basis, Financial summary
      total-first, Purchase history total-first, Open PO list VAT-
      inclusive total). Diagnostic route deleted and the middleware bypass
      reverted (confirmed `git diff` empty) before finishing; dev server
      restarted clean, `/login` 200 and `/inventory` 307 reconfirmed.
  - **Polish round — 7 design-only items, no migration/RPC/data changes.**
    `lib/prepaid.ts`/`vat.ts`/`invoice.ts`/`inventory-vat.ts` untouched.
    - **Item 1 — "pick a part to add" now a custom `PartPicker`, not a bare
      `<select>`.** Native `<option>` can't reliably carry a per-row
      colored dot cross-browser, so this is a genuinely new small
      component (`SharedCreateModals.tsx`), not a `<select>` restyle —
      button + popover listbox, each row showing qty+unit and a stock-
      state dot/color (green/amber/rose), relabeled for this context
      ("Current"/"Low stock"/"Depleted" — `PICKER_TIER_LABEL`, distinct
      from the drawer's own "Healthy"/"Getting low"/"Critical — reorder"
      wording) but the SAME thresholds as the parts table's own stock
      cell. Used by all 3 "pick a part to add" sites (`ReceivePartsModal`,
      `NewPOModal`, `ReceivePOModal`'s extra-line picker). Required moving
      `stockTier`/`StockTier`/`TIER_TEXT`/`TIER_DOT`/`TIER_LABEL` from
      `InventoryClient.tsx` into `SharedCreateModals.tsx` (exported there,
      imported back) — same one-way-edge pattern `categoryLabel`/
      `useNumField`/`parseNumField` already established, not a new risk.
    - **Item 2 — row-action icons now match preview exactly**
      (pages-2.js ~3155-3161, `.btn-outline`/`.btn-primary`/`.btn-icon`,
      app.css ~244-292/643): View is a LABELED outline pill (was icon-only
      before), chart-report is an outline icon-only square, quick-reorder
      is a PRIMARY (filled brand) icon-only square shown only on critical
      rows — and in preview's own ORDER (View, chart, cart), not the
      reversed order this row used to render.
    - **Item 3 — faded background tints: baby-blue (supplier-info),
      light-purple (financial-summary), light-green (pricing-snapshot).**
      Turki's own call, NOT a preview match — preview's own `.supplier-
      card` is a neutral black/white .015-.025 tint, not blue (checked
      before assuming); confirmed there's no equivalent tint on the other
      two cards in preview either. Uses this app's own already-live AI-
      insights-card rgba intensity (~.05-.06) for consistency, applied via
      Tailwind arbitrary-value classes (`bg-[rgba(...)]`) directly on each
      `Card`, not a change to the shared `Card` component (`components/
      ui.tsx` untouched — scoped, not a global un-asked-for change).
      Applied to both places "Financial summary" renders (`ViewPartModal`'s
      inline card AND `PartFinanceModal`'s popup — same shared
      `PartFinanceSummaryCard`, so both needed their own wrapper tinted).
    - **Item 4 — warehouse tabs restyled from a filled-pill segmented
      control to this app's own underline-tab convention** — matches
      `TripsTabs.tsx`'s Projects/Customers/Finance tabs exactly (`flex
      items-center gap-1 border-b` container, `border-b-2 -mb-px` active
      indicator, `border-brand-600 text-brand-600` active / `border-
      transparent muted` inactive). The container's own `border-b` IS the
      divider line under the title Turki asked for — same as `TripsTabs`,
      no separate element needed.
    - **Item 5 — "New PO" -> "New Purchase Order"** (English only; preview's
      own Arabic string, i18n.js:569, already matched — only the English
      side had been shortened).
    - **Item 6 — AI-Suggest header button recolored** with this app's own
      established AI gradient (`linear-gradient(135deg,#8b5cf6,#0b7eea)` —
      already used for the `AiPill`/`.ai-chip` badge on `ai_generated`
      POs, sourced from preview's own `.ai-chip`/`.ai-pill`, app.css
      ~731-739) — was plain outline, indistinguishable from New PO/Add
      Parts.
    - **Item 7 — new "Adjust Item" action (part drawer footer, `Pencil`
      icon — this app's established Edit-icon convention, matches
      `CustomerForm.tsx`/`DriversClient.tsx`).** No preview equivalent
      (preview has NO edit-part UI at all, by original design — see
      `InventoryClient.tsx`'s own header comment on why the edit flow was
      deleted entirely in an earlier pass); this reverses that call, per
      Turki's own explicit ask now. New `updatePart()` server action
      (`actions.ts`) — plain single-table update, no RPC (same "not a
      data-integrity risk" reasoning `updatePurchaseOrder` already
      established for editing a draft PO, Stage 3 item 6). GUARDRAILS,
      both enforced structurally, not just left out of the form: (1) new
      `PartUpdateInput` type (`Omit<PartInput, "sku" | "qty_on_hand" |
      "warehouse_id">`) makes it impossible even at the type level to pass
      those 3 through this path, and the update payload itself never
      includes those keys either; (2) SKU shown read-only (same disabled-
      box pattern `AddPartModal`'s own Warehouse field already uses);
      (3) warehouse ALSO shown read-only, on the same "already assumed
      stable by every `purchase_order_lines`/`price_lots` row for this
      part" reasoning as SKU — not explicitly asked, but the same
      protective instinct as the explicit qty_on_hand guardrail. Adds two
      fields `AddPartModal`'s own create form never had — Supplier (free
      text) and Lead time (days) — because Turki's own field list for
      THIS form explicitly names supplier, and lead time was the one
      other descriptive field with no edit path anywhere.
    - **Verification:** built a throwaway `/inv-polish-test` diagnostic
      route + temporary middleware bypass (same technique as every prior
      stage), 3 parts at 3 different stock tiers (Current/Low stock/
      Depleted) to exercise item 1's color-coding and item 2's critical-
      only cart button together. New `tests/inventory-polish.spec.ts`, 8
      tests (item 3 split into 3a/3b — supplier-tint, pricing/financial
      tints), all passed. Item 7's test verifies the form opens correctly
      pre-filled with SKU locked and no qty field — it does NOT exercise
      an actual save (`updatePart()` is a real, auth-gated server action;
      this diagnostic route has no Supabase session, same limitation as
      every prior stage's test suite) — Turki's own in-browser check
      covers the real save. Diagnostic route deleted and the middleware
      bypass reverted (confirmed `git diff` empty) before finishing; dev
      server restarted clean, `/login` 200 and `/inventory` 307
      reconfirmed.
  - **Polish round follow-up — fix for item 3 (tints never rendered) + 2
    new additions, still design-only.**
    - **ROOT CAUSE of the missing tints, found:** `Card`'s own `.card` CSS
      class (`app/globals.css`) sets `background-color`, declared as PLAIN
      CSS positioned AFTER the `@tailwind utilities` directive in the same
      file. Tailwind only reorders rules wrapped in `@layer` — plain CSS
      after `@tailwind utilities` stays exactly where it is in the
      compiled stylesheet, i.e. AFTER every Tailwind utility class. At
      equal specificity (both single-class selectors), the LATER rule in
      the stylesheet wins — so `.card`'s own background always silently
      overrode the `bg-[rgba(...)]` tint utility, regardless of source
      order in the JSX. `globals.css` already had a near-identical
      documented precedent for this exact trap (`.trip-highlight`'s own
      comment: "`.card`'s box-shadow below always overwrote a ring's
      box-shadow — same specificity, later rule"). **Fix:** `!bg-[rgba(...)]`
      (Tailwind's important-modifier) on all 5 tinted spots — same
      technique already used for the AI-Suggest button's gradient in the
      original polish-round pass, just not yet applied to the tints.
      **Test gap closed too:** the original test suite only checked
      className presence (`toHaveClass`), which was already true before
      the fix — passing then despite the real bug. Rewritten to
      `toHaveCSS("background-color", ...)`, which reads
      `getComputedStyle` and would have caught this the first time.
    - **Addition 1 — widened the part picker (260-280px -> 380px) in both
      Add Parts and New PO**, plus a font cleanup shared by all 3 usages
      (`PartPicker`, `SharedCreateModals.tsx`, ReceivePOModal's extra-line
      picker included for free): sku/name now separated by a proper "·"
      (was a bare space, reading cramped once widened) — same separator
      convention this app already uses everywhere else a sku+name pair
      sits on one line; name gets `font-medium`, qty/tier badge gets
      `font-medium` too, for a clearer visual hierarchy.
    - **Addition 2 — Add Part popup now shows supplier info "the same way
      New PO shows it."** Preview's own create-flow has no supplier field
      at all (supplier is only ever assigned later, at receipt time) — a
      deliberate addition beyond preview, per Turki's explicit ask.
      Extracted New PO's own inline "Supplier contact" card JSX into a new
      shared `SupplierContactCard` (`SharedCreateModals.tsx`) — blank "—"
      until picked, then name/name_ar/contact/phone/email, identical
      behavior to New PO's own card. `PODetailModal`'s similar-looking
      card was deliberately left alone (different behavior — read-only for
      an already-committed PO, supplier always present, no blank state —
      folding it in would have been a real behavior change nobody asked
      for). `AddPartModal` gained a `suppliers` prop + its own supplier
      picker (+ inline "+Supplier" create, same pattern New PO uses) —
      `parts.supplier` stays free text (0043); the picked supplier's
      `name` is stored as a snapshot at submit time, same "free-text
      snapshot of a real `suppliers.name`" convention AI-Suggest's own
      best-effort supplier match already relies on elsewhere. Both
      `AddPartModal` mount sites (NewPOModal's own "+ New Item",
      ReceivePartsModal's own "+ New Item") updated to pass `suppliers`.
    - **Verification:** rebuilt the throwaway `/inv-polish-test` route +
      temporary middleware bypass; `tests/inventory-polish.spec.ts` grew
      from 8 to 10 tests (3a/3b rewritten to computed-style checks, 2 new
      addition tests) — all 10 passed. Diagnostic route deleted and the
      middleware bypass reverted (confirmed `git diff` empty); dev server
      restarted clean, `/login` 200 and `/inventory` 307 reconfirmed.
    - **Second follow-up — Turki: addition 2's supplier info "does NOT
      appear at all" on Add Part.** Traced against New PO exactly as
      asked. The card WAS mounted and DID render — proved with a raw
      `innerText` dump of the actual popup through both real entry points
      (New PO's "+ New Item" and Add Parts' own "+ New Item") — but it sat
      at the very BOTTOM of the form, after 6 more fields (Category/Unit/
      price/reorder x2), while New PO shows its own card immediately after
      its Supplier/Warehouse row. Technically present, practically
      invisible without scrolling past everything else first — that's the
      real "same way New PO shows it" gap. Fixed by making the card a
      `col-span-2` grid item positioned directly under the Supplier field
      (the grid stays ONE `grid-cols-2`, not split into two) — same
      prominence as New PO's own card now. Re-verified through both real
      entry points again, this time also asserting the card's Y-position
      sits ABOVE the Category field's (a real regression guard, not just
      presence) — `tests/inventory-polish.spec.ts`'s addition-2 test
      rewritten to check both entry points + the position, all 10 tests
      still pass.
    - **Third follow-up — Turki: wrong popup entirely.** The whole
      "supplier in Add Part" addition had landed on the WRONG component.
      Two distinct, confirmed-different modals:
      - **"+ New Item" = `AddPartModal`** (`SharedCreateModals.tsx`, title
        "New item / equipment") — creates a brand-new catalog SKU. Should
        have NO supplier field — preview's own create flow never had one
        either (supplier is only ever assigned later, at receipt time).
        This is where the previous two follow-ups had mistakenly built
        the supplier picker/card.
      - **"Add Part" = `ReceivePartsModal`** (`InventoryClient.tsx`, title
        "Add Parts to Inventory", opened via the header "Add Parts"
        button) — the actual receiving flow. This one already HAD its own
        top-level `supplierId`/`allSuppliers` (a supplier is required to
        receive stock) but never got the contact-info card.
      **Reverted `AddPartModal` to its exact pre-supplier-work state** —
      confirmed byte-for-byte identical to the version at commit `f800f93`
      (diffed directly, zero differences beyond the file's own trailing
      marker). Removed: the `suppliers` prop, the `supplierId`/
      `localSuppliers`/`newSupplierOpen`/`allSuppliers`/`selectedSupplier`
      state, the Supplier `<select>` field, the `SupplierContactCard`
      mount, the `NewSupplierModal` mount, and `submit`'s `supplier:
      selectedSupplier?.name ?? null` (back to plain `null`). Both
      `AddPartModal` mount sites (NewPOModal's own "+ New Item",
      ReceivePartsModal's own "+ New Item") stopped passing `suppliers`.
      **Added supplier info to `ReceivePartsModal` instead** — a new
      `selectedSupplier` derived from its OWN pre-existing `supplierId`/
      `allSuppliers`, and `<SupplierContactCard lang={lang}
      supplier={selectedSupplier} />` placed immediately after its own
      Supplier/Warehouse row (same position/prominence as New PO's own
      card) — no new state needed, this modal already tracked everything
      required.
    - **Verification:** rebuilt the diagnostic route, confirmed via BOTH
      real entry points to "+ New Item" that it's back to its original
      field set (name/name_ar/SKU/warehouse/category/unit/price/reorder —
      no "supplier" text anywhere), and confirmed "Add Parts to Inventory"
      shows the blank-"—"-then-populated-on-selection card, screenshots
      included (blue-tinted "SUPPLIER CONTACT" box, "—" before picking,
      full name/name_ar/contact/phone/email after). `tests/inventory-
      polish.spec.ts`'s addition-2 test rewritten to target
      `ReceivePartsModal` instead of `AddPartModal`, plus a new dedicated
      regression-guard test asserting "+ New Item" has zero "supplier"
      text through both entry points — 11 tests total, all pass.
  - **Working rules that held, keep applying through Phase 7:** every migration
    drafted to disk and reviewed/run by Turki before any app code assumes it
    exists; exactly one signature per RPC (see `0038`'s incident above for why);
    the FIFO invariant (`sum(price_lots.qty_remaining) == parts.qty_on_hand` per
    part) verified after every phase that touches lots; inventory/parts cost is
    internal-only money (`unit_cost_sar`, `price_lots.price_sar`) and must never
    flow into `lib/prepaid.ts`/`vat.ts`/`invoice.ts` — those stay customer-facing
    money only.
  - **Lesson from Phase 3 (applied, worked):** commit each phase immediately
    once it verifies, instead of letting it sit uncommitted through a follow-up
    pass (that's exactly how Phase 3 + its cleanup pass got too interleaved to
    split, forcing the one-off combined commit `11d9239`). Phases 4, 5, and 6
    all followed this: migration committed the moment it was confirmed
    applied, app code committed the moment it was confirmed working — clean,
    separable commits every time, nothing left to entangle.
  - **Lesson from Phase 5: check preview's ACTUAL code, not its own comments,
    and reuse the existing mechanism instead of building a parallel one.**
    The first draft of migration 0051 invented a PO-receiving path with no
    mandatory invoice and no `stock_receipts` row — reviewed and rejected
    before running. Preview's own lifecycle comment ("draft -> issued ->
    received -> pending_approval...") doesn't match what its code actually
    does (there's no `received` status assignment anywhere in
    `receivePO()`), and its receive flow was assumed to be a separate,
    lighter-weight path without re-reading `confirmReceipt()`, which applies
    the SAME mandatory-invoice gate to loose and PO receipts alike, no
    exception. Fixed by having `receive_purchase_order` call
    `receive_loose_parts` directly instead of reimplementing any of its
    validation/writes — composing on an existing, already-correct RPC beat
    a parallel one that quietly dropped a requirement. Re-read the actual
    demo code path end-to-end before designing a schema/RPC for it, not just
    the nearest comment describing it.
  - **New lesson from Phase 4: watch for import cycles across sibling files.**
    Splitting a page's modals across multiple files (this app's own established
    pattern — see app/trips/*.tsx) is fine, but if file A exports something file
    B needs AND file B exports something file A needs, that's a real cycle —
    `tsc`/`next build` do NOT catch it (nothing touches the cross-import at
    module-top-level), but Next's dev module system can resolve it to
    `undefined` at request time and crash the whole page blank. Fix: give the
    genuinely-shared pieces their own leaf module (no imports back to either
    caller) that both files import from one-way — same fix used here
    (`app/inventory/SharedCreateModals.tsx`, holding `CreateWarehouseModal`/
    `NewSupplierModal`/`AddPartModal`, now imported one-way by both
    `InventoryClient.tsx` and `PurchaseOrders.tsx`). Sketch the import
    direction before splitting a page across new files, not after hitting a
    blank page.

- **ARCHIVE page is COMPLETE — 5 tabs, migrations `0084`–`0092`, through commit
  `6e2b08a`.** Company / Staff / Truck / Customer, plus the cross-cutting Approvals
  Ledger (see the Consumption entry below — it lives on Archive but is fed by both
  approval systems).
  - **The linking model, and the incident that shaped it.** For a LINKED (type +
    subject) combination the number and its expiry live ONLY on the subject's own
    record (`drivers.license_number`, `staff.iqama_number`,
    `trucks.vehicle_registration`/`registration_expiry`) and the archive document
    stores NEITHER. `0092` moved that rule from the app into the DATABASE —
    `archive_linked_one_per_person()` raises `23514` if a linked document arrives
    carrying its own number or expiry. It raises rather than silently NULLing,
    because quietly discarding a typed value is how "I entered it and it vanished"
    bugs happen.
  - **`0090` dropped a duplicate design.** The linking migration was
    double-applied by two concurrent sessions; the DB was cleaned to ONE design
    (columns on `archive_document_types`: `linked_driver_field` /
    `linked_staff_field` / `linked_truck_field`). **`archive_linked_types` (table)
    and `archive_one_linked_doc_per_person` (function/trigger) do NOT exist — do
    not reference them.** `0089`/`0091` on disk hold SUPERSEDED versions of the
    guard and are EXPECTED to differ from live; do not "fix" them to match.
  - **A real data-loss bug shipped and was fixed** (`04e3433`): `updateDriver`/
    `updateStaff` included the linked identity columns in their update payload, and
    a disabled input submits nothing — so `nullable(null)` blanked iqama/licence on
    every unrelated edit. Fixed by destructuring those keys OUT of all three update
    actions. A later scan confirmed no data was actually lost. **Never let a linked
    identity column into an update payload from a form that renders it disabled.**
  - Renew writes the new number/expiry to the SUBJECT and passes NULL to the
    parent, and the renewal SNAPSHOT captures the subject's OUTGOING pair
    server-side — without that capture a linked document's history would record
    blanks (`archive_document_renewals` is history, so `0092`'s guard does not
    apply to it).
  - **Customers have NO Restore**, deliberately: `0019` archives a customer as a
    side effect of archiving its 1:1 project, so a solo restore would leave a
    half-restored state. Truck restore clears all four termination fields.
  - Derived-never-stored throughout (`lib/archive.ts`): document status, expiry
    tallies, group accents. "Missing" is deliberately NOT in `ArchiveDocStatus` so
    `expirySummary` cannot tally gaps as expiries.

- **CONSUMPTION page is COMPLETE — 3 tabs, migrations `0093`–`0097`, through commit
  `6e2b08a`.** Tabs: **Consumptions** (analytics), **Exit Permits**, **Approvals**.
  There is NO Reports tab — Reports is a separate top-level page; a second entry
  point with the same name inside Consumption only invited "which one is real".
  - **Exit Permits (`0093`).** Gate pass for parts leaving for a NON-maintenance
    reason: draft (paperwork only) -> confirm exit (the money moment) -> returns ->
    void. **TWO FINDINGS from reading the live money helpers changed the design and
    must not be re-litigated:** (1) `return_to_lots` CANNOT be reused — it is
    hard-wired to work orders (takes `work_order_part_id`, reads
    `work_orders.wo_number`, writes `work_order_part_consumptions`), so `0093` adds
    `return_exit_permit_line` with the same FIFO-reversal algorithm against its own
    ledger; (2) `consume_from_lots` does NOT report which lots it drew from, so the
    per-lot ledger cannot be built from its return value —
    `consume_exit_permit_line` mirrors `consume_work_order_line`'s two-pass pattern
    exactly (same ordering clause, so the passes cannot disagree).
    Void restores ONLY the still-outstanding quantity; anything already returned
    went back with its own return event, and the ledger makes that exact rather
    than inferred.
  - **Approvals (`0094`/`0095`/`0097`) — an OVERLAY, never a gate.** One table,
    three nullable FKs + a CHECK that exactly one is set (the archive's subject
    pattern). **Approving or rejecting moves NO stock and changes NO source status
    — `0094` creates no function and no trigger, so the database has no mechanism
    for it, and `decideConsumptionApproval` writes that one table and nothing
    else. Keep it that way.** Voting is a verbatim port of
    `approve_stock_receipt`'s rule: first voter votes either way, the SECOND must
    MATCH, a differing vote raises (`0097`'s trigger). **Two matching votes from
    distinct people complete an event — that is the ONLY completion definition,
    shared by the guard, the trigger and the Ledger.** "One objection ends it" was
    tried and dropped (it could complete an event on a single vote).
  - **`0096` — the 30-day lock, applied.** A completed consumption approval is
    re-votable for 30 days, then the DATABASE refuses insert/update/delete. Scoped
    to `consumption_approvals` ONLY: the inventory approval tables are already
    locked at completion by their own RPCs (every one gates on
    `status = 'pending_approval'`), so a trigger there would guard nothing while
    reaching into the stock-moving path. DELETE is guarded only at
    `pg_trigger_depth() = 1` so an FK cascade from the subject still works.
    **Known and accepted:** the applied bodies are byte-different from the file —
    inline `--` comments were stripped in transit. Normalised (comments +
    whitespace) both hash identically, so the logic is the file's; a future
    byte-comparison will trip on this, and that is why.
  - **Approvals Ledger (Archive tab 5).** A DERIVED view of completed approvals
    across BOTH systems — nothing is copied, so nothing can drift. Consumption rows
    are re-votable; **inventory rows arrive already locked**, because a completed
    receipt REJECTION already applied its stock effect (it deletes `price_lots`
    rows, and `stock_receipt_lines.price_lot_id` is ON DELETE SET NULL — there is
    nothing left to restore). Both active Approvals queues show PENDING only;
    decided events live in the Ledger.
  - **Consumptions tab — analytics, and the hole it works around.** Reads the two
    per-lot ledgers (`exit_permit_line_consumptions`,
    `work_order_part_consumptions`); net consumed = consume − return, which makes
    returns AND voids fall out for free. **BUT the maintenance ledger does not
    cover its own history** — 2 completed work orders were deducted before it
    existed, and ledger-only aggregation dropped 57 of 78 units (73%) silently. A
    part with no ledger rows falls back to `work_order_parts.qty × unit_price_sar`,
    which is the SAME stamped figure from the other end of the same write (verified
    equal on all 11 rows that have both), and those rows are tagged "pre-ledger" in
    the UI. Analytics count every DEDUCTED work order (including in-progress ones —
    that stock has left); the records table stays completed-only.
    **`work_orders.actual_cost_sar` EQUALS the parts value exactly on all 13
    deducted rows — never add it on top of parts consumption, it double-counts.**

- **REPORTS page is COMPLETE — 2 tabs, migrations `0098`–`0101`, through commit
  `eaf7e2e`.** The app's last page, rebuilt wholesale from a mock-data placeholder.
  Tabs: **Overview** (KPIs + charts) and **Reports** (the printable statement pack).
  - **THE SEMANTIC LAYER IS THE POINT (`0098`).** Every metric is defined ONCE, in
    SQL. The page reads views and NEVER re-derives a number, so this page, a future
    statement, and an AI agent reading the same views cannot disagree about what
    "revenue" means. 24 views + `report_metrics` (a dictionary: plain-language
    meaning, formula, grain, basis, caveat per metric) + an `expenses` table.
    **If a number is missing, the fix is a migration — not a join added to the page.**
  - **EVERY VIEW IS `security_invoker = true`.** These were the FIRST views in this
    schema. A default view runs as OWNER and bypasses RLS on 68 RLS-enabled tables,
    so this is a security gate, not a style choice. SELECT granted to
    `authenticated`, revoked from `anon`. Verified live: 24/24 invoker, 0 anon-
    readable. **Every future view gets the same treatment.**
  - **The money rules, each checked against live rows before being written:**
    - Revenue is ACCRUAL and "confirmed" means `confirmed_at is not null`, NOT
      `status='confirmed'` — paid invoices were confirmed first and keep the
      timestamp. A status filter hid 26,550 of 70,650 (38%).
    - Revenue is NET of VAT (`grand_subtotal_sar`). VAT is a collected liability.
    - Voided invoices excluded, and kept visible in their own view (Sales Returns).
    - **Parts cost is FIFO consumption ONLY. Purchases are NEVER a P&L line** — a
      purchase is inventory until consumed. Live, receipts are ~57x consumption over
      the same window; expensing both would overstate cost enormously. Purchasing
      lives in a cash/procurement view, labelled as not-a-P&L-line.
    - Parts cost INCLUDES the pre-ledger fallback, because the Consumption page does
      and the two must agree. Ledger-only understates July by 72%.
    - Commissions are ACCRUAL (earned). The cash view is separate; summing both
      double-counts, since a payout's base IS the same trip commission.
    - Manual expenses are their OWN P&L section — never merged into the four
      operational buckets. Both `operating_profit` (before) and `net_profit` (after)
      are exposed so their effect stays visible.
  - **RATIOS ARE RECOMPUTED IN SQL, NEVER AVERAGED (`0100`).** Additive measures sum
    across months; ratios do not. Live proof: Q3-to-date margin is **-38.7%** from
    the period's own totals and **+20.5%** if the monthly margins are averaged — it
    flips the sign. `v_pnl_by_period` carries month/quarter/year in one view with the
    margin recomputed per period. Same rule one level up in the report builder.
  - **TWO NON-ADDITIVE MEASURES, handled explicitly, never summed:**
    `people_missing_salary` (summing Jul+Aug gives 6; truth is 3 — it is a per-month
    state) and `trucks_active` (a DISTINCT count; summing double-counts a truck
    working in two months — today it coincidentally matches, which is worse than a
    visible error). Multi-month periods report the highest single month and say so.
  - **`0099` — per-truck maintenance carries THREE separately named measures**
    (`maintenance_parts_sar` / `os_payments_sar` / `total_maintenance_sar`), never
    blended. "Maintenance cost per truck" previously meant two different things:
    parts-only (what the Consumption page still shows) is the SMALLER half —
    7,043.95 against 19,671.50 of outsourced. A dictionary caveat claiming OS is not
    attributable per truck was FALSE and was corrected; `outsourced_jobs.truck_id` is
    populated and every riyal traces to a truck.
  - **`0101` — the driver grain for the Operations statement.** Grouped BEFORE the
    join to drivers, so a trip with no `driver_id` keeps its own row and the driver
    figures always sum to `v_operations_monthly` (June has 33 trips, 1 unattributed —
    an inner join would have shown 32 beside a period total of 33). The UI labels
    that row **"Unassigned"** — the applied view returns a NULL name, so the label is
    the UI's job. Grouped by `driver_id`, not name: two driver records share a name,
    and the plate is what distinguishes them.
  - **THE DRIVER IS MEASURED, THE TRUCK IS DISPLAY-ONLY.** No truck-level figure
    appears in a driver row; trucks-that-moved and maintenance activity stay in the
    period summary. Driver tables lead the statement; drivers are ROWS and measures
    are COLUMNS (asked for three times before the intended reading was clear — a
    test now asserts the orientation so it cannot silently flip).
  - **TWO LIMITATIONS, stated in the UI rather than hidden:** salaries have NO
    history, so a past period is costed at each person's CURRENT salary (only the
    employment window is historical); revenue per truck is an ALLOCATION, because
    `trips.rate_sar` is NULL on all 203 rows, so invoice revenue is split across
    linked trips. Both surfaced on screen, not just in comments.
  - **Custom report builder — a pivot table FENCED to the semantic layer.** Pick
    metrics, a grouping and a period; the result reads the same views. Enforcement
    lives in `lib/report-builder.ts`: a block is only offered if its key is live in
    `report_metrics` (`BUILDER_METRICS` is module-private so the fence cannot be
    bypassed), groupings narrow to what the selected metrics support, ratios
    recompute per row, and there is deliberately NO total across columns so accrual
    and cash can never be added. The natural-language box beside it is a marked seam
    with no model call — its only future job is to fill in the same builder.
  - **Printing.** The clipped-column bug was NOT sizing: `visibility:hidden` hides
    the sidebar but KEEPS ITS LAYOUT, so statements stayed indented 256px and
    overflowed the sheet. Fixed by removing the shell from FLOW, pinned to unique
    classes (`header.h-14`, never a bare `header` — every statement renders one of
    its own). Plus A4 margins, repeating table headers, and a paper-only ID band.
  - **`numeric` can arrive as a STRING.** Postgres `numeric` has no exact JS
    equivalent, so `a - b` yields NaN and `a + b` concatenates — both rendering as
    plausible garbage rather than erroring. Coerced once at the server boundary,
    columns listed explicitly because `invoice_number` is a numeric-LOOKING string
    that must stay text.
  - **Migration files were RECONCILED to what actually ran.** `0099`/`0100`/`0101`
    were each applied in a modified form; every file was rewritten to match live
    (verified against `pg_get_viewdef`) with the differences recorded in its own
    header. Do NOT "fix" them back toward the drafts.
  - **THE DICTIONARY IS COMPLETE — migrations `0123` + `0124`, commits `f82fe1c`,
    `dca9840`, `b479671`.** `0100` had left two holes, both now closed. Neither
    touched a view, an RPC or a measure.
    - **`0123` — the period pointers.** `0100` added one new key rather than amending
      the ten existing P&L entries, so `revenue`/`operating_cost`/`operating_margin`
      and the rest still read grain "one month" and named only their monthly view,
      although each IS available per quarter and year. All ten now carry
      `one month, quarter or year` and a two-source pointer. **The count and list in
      `0100`'s own header were correct** — the first deferred note in this stretch
      whose premise survived re-measurement.
      - **NOT a find-and-replace, because two of the ten are COMPOSED.**
        `v_payroll_monthly` carries the staff/driver split and `v_commissions_monthly`
        four components, while `v_pnl_by_period` exposes only the combined total —
        so those two say "combined total only". The other four map directly.
      - **`operating_margin` is the dangerous one.** Widening a RATIO's grain invites
        the error `0100` exists to prevent, so its caveat now carries the proof:
        averaging the monthly margins for Q3-to-date gives **+20.5%** where the
        correct figure is **−38.7%** — it flips the sign. `v_pnl_by_period` recomputes
        per period; the risk is a reader doing their own arithmetic.
      - **Proven inert:** `grain`/`source_view` are display strings (`String()`-coerced,
        never parsed), and the fingerprint of `metric_key` was **identical** before and
        after — which is what proves the builder and Add Summary offered the same set.
    - **`0124` — the missing fifth cost bucket.** The dictionary described FOUR of the
      five operational costs; filling had no entry despite being inside
      `operating_cost` since `0112`. Added as `filling_cost`, a DIRECT-mapping bucket.
      - **Its caveat is why it is not a clone of `parts_cost`:** filling is the only
        bucket with an uncosted companion, so **the total is SHORT by an unknown
        amount rather than complete** — live 10 uncosted in June, 3 July, 0 August.
        It also repeats the trap above: a SCHEDULED trip has not filled, so summing
        `trips.filling_cost_sar` raw EXCEEDS the view.
      - **BUILDER-ELIGIBLE, and that took a second half.** A dictionary row alone does
        nothing: `lib/report-builder` offers a block only where `BUILDER_METRICS` and
        the live dictionary agree. **Exactly one key** was added there, plus a `filling`
        slot on `Bucket` — the figure was being FETCHED (`PnlPeriodRow` already carried
        it) and never bucketed. **Groupings are period-only**, like the four buckets
        around it: there is no per-customer or per-truck filling view.
      - **`lib/dashboard-widgets`' `WIDGET_CATALOGUE` was deliberately NOT touched** —
        Add Summary is a Dashboard TILE with its own bilingual label, displays, href
        and value plumbing. Builder-eligibility was the ruling.
      - **The fingerprint MOVED here, by design**, and the expected value was asserted
        in advance: 29 keys `b3bbb25d…` → 30 keys `c4e9e453…`, which is the proof that
        one key moved and not more.
    - **FILLING AND `operating_cost` ARE A COMPONENT AND ITS CONTAINER, NEVER ADDENDS.**
      Both are legitimate builder columns; the builder has no cross-column total by
      design (`0100`), so nothing sums them — but a reader might try.
  - **THE DICTIONARY IS ON SCREEN — commits `0da456b` (built as a section) and
    `e0a5289` (relocated as a popup).** `app/reports/MetricsGlossaryModal.tsx`. Read-
    only render of `report_metrics`; no view, RPC, measure or fence was touched.
    - **IT EXISTS BECAUSE SIX COLUMNS HAD TRAVELLED UNREAD FOR A YEAR.**
      `meaning`, `formula`, `grain`, `source_view`, `basis` and `caveat` were
      fetched on every `/reports` load and rendered NOWHERE — `StatementsTab` reads
      `metric_key` only, as the builder's fence. **`noUnusedLocals` cannot catch an
      unused object FIELD**, so the compiler had nothing to say. `0123`/`0124` had
      just spent two migrations getting those columns right, into a screen that did
      not show them. All six now render, which is the whole point of the piece.
    - **A PAGE-LEVEL POPUP, launched from a "Metrics dictionary" button in the page
      header, right of the period picker, Overview tab only.** It shipped as a
      section at the bottom of Overview and was moved (Turki's call) — a 30-metric
      reference is consulted mid-thought, not scrolled to. Mounted in
      `ReportsClient`, NOT inside `OverviewTab`, so it survives a tab switch and
      opens at any scroll position. **Do not restore it inline.**
      - `OverviewTab` no longer receives `metrics` at all. It keeps and EXPORTS
        `Disclosure`/`EmptyNote`; the import edge is ONE WAY — the modal imports
        that tab, never back.
      - **The header's `actions` gate was `tab === "overview" && months.length > 0`;
        the month guard moved INWARD to cover only the period picker.** An empty
        month spine is a reason not to offer a period, not a reason to hide the
        dictionary — the dictionary is what explains what the missing figures would
        have meant.
      - **No launcher on tab 2, deliberately:** it carries its own period control and
        its own use of the same dictionary, as the builder's fence.
    - **THREE OF THIRTY HAVE A NULL `caveat` AND RENDER NO BLOCK AT ALL** —
      `operating_profit`, `operations`, `os_cost`. Never "N/A", never an em dash:
      both read as missing data, and a metric with nothing to warn about is not the
      same as one whose warning failed to load. **The brief for this build asserted
      all 30 rows had content in every column. Measured live three times; they do
      not.** A test asserts the empty case renders one `<p>` and the `collections`
      control renders two, so the check cannot pass by matching nothing.
    - **`app/reports/page.tsx`'s comment is now TRUE.** It had claimed the dictionary
      was displayed; for a year nothing displayed it. It now names both consumers and
      the split between them — `metric_key` for the fence, the description columns for
      the glossary — and points at the popup by name.
    - **LAYOUT: `minmax(0,1fr)` is the load-bearing part.** A bare `1fr` refuses to
      shrink below its content, so `0123`'s two-source pointers (169 chars, no break
      opportunity inside `v_commissions_paid_monthly`) overflowed their cell. Paired
      with `min-w-0 break-words`. **The popup's `xl:grid-cols-2` entry grid inverts
      the usual responsive assumption — text cells are NARROWEST at a WIDE viewport**,
      so the overflow audit runs at 1440px as the hard case and 1024px as the
      single-column control.
    - **`tests/reports-glossary.spec.ts` (8 tests) depends on the DELETED
      `/reports-glossary-check` route** — same convention as every prior phase. It
      opens the popup through the REAL button rather than finding a mounted modal, so
      the launcher and the tab gate were under test, not only the modal's internals.
      Its fixture was HARDCODED from all 30 live rows because `report_metrics` is
      RLS'd to `authenticated`: a session-less route fetches zero rows and the
      glossary renders its "could not be read" branch, proving nothing.
  - **INCIDENT — a db reset dropped `v_operations_by_driver_monthly`** because the
    replay rebuilt from committed migrations and `0101` was applied but not yet
    committed. Everything else survived. Re-applied and committed. **A migration that
    is applied but uncommitted is exactly what a reset drops** — commit the file the
    moment it is confirmed applied. (Worth pinning down before the next reset:
    `0101` WAS committed in `c561d5c` before the drop, so the replay source may not
    be this repo's `supabase/migrations/`.)
  - **PROCESS LESSON, REPEATED AND NOT LEARNED THE FIRST TIME:** Phases 2–3 plus
    three follow-up rounds were committed as ONE commit because
    `lib/reports.ts`/`StatementsTab.tsx`/`StatementViews.tsx` each accumulated code
    from every round, and every commit must be tsc-clean. This is the SAME trap
    already recorded under Inventory Phase 3. Commit each round the moment it
    verifies; do not let five review rounds pile up first.
  - **Deferred — Reports:** a driver status-change report (needs transition history;
    `drivers.status` is current-only, so there is nothing to count) — parked with
    RBAC and effective-dated salaries; **idle trucks** and **fleet availability** on
    the Operations statement (need the fleet roster and distinct trucks-under-
    maintenance respectively — deliberately NOT estimated); promoting cash-coverage
    into the semantic layer if it becomes load-bearing; and switching the Consumption
    page's top-costly-trucks to read `maintenance_parts_sar` from the view instead of
    its own TS derivation.
  - **The six `tests/reports-*.spec.ts` specs depend on a DELETED `/reports-verify`
    diagnostic route** — same convention as every prior phase. They document what was
    verified; they are not a standing regression suite unless that route is made
    permanent (Turki's call, flagged, not decided).

- **DASHBOARD rebuilt as the CATCH-UP page — migrations `0103`–`0109` (13 views),
  through commit `d77eddb`.** The old page was a mock-data leftover. It answers four
  questions and deliberately does NOT restate Reports Overview: what needs action,
  what happened since you last looked, where things stand right now, and a small
  headline set that links into Reports.
  - **WHY IT WAS REBUILT, in one number.** The old page summed `trips.rate_sar` in
    TypeScript for "Revenue (30d)" and rendered **0** while Reports rendered
    **70,650** — `rate_sar` is NULL on every row (203 then, 676 now). A figure that
    disagrees with the statement it links to is worse than no figure. **Every number now reads a view;
    nothing is re-derived in TS.** If a number is missing the fix is a migration.
  - **`0103` — the queue, the feed, the fleet snapshot.**
    - The activity feed needed **NO new table and NO triggers.** Timestamp coverage was
      MEASURED first: nine state-vs-stamp checks, zero gaps, 320 events across 19
      kinds, no null timestamps. An event-log table would have duplicated data the
      schema already carries.
    - `invoice_unpaid` **composes on `v_receivables_open`** rather than restating its
      predicate. The first version restated it "closely" and read 5 where Reports read
      2 — the applied view also carries an inner join to customers. **Composing on the
      view makes the two incapable of disagreeing; do not "simplify" it back.**
    - `trip_overdue` uses an **allowlist** (`stage in (scheduled, loading,
      in_transit)`), not `stage <> 'delivered'` — a denylist silently adopts every
      future stage.
    - Dates are Asia/Riyadh, matching `todayKey()`, so the queue cannot disagree with
      the module pages for three hours every night.
  - **`0104` — the DAY grain, and the limit it refuses to fake.**
    - **A full daily P&L IS NOT POSSIBLE from this data.** Payroll has no daily source
      (`staff.monthly_salary_sar` / `drivers.salary_sar`) and was **98.9% / 67.3% /
      74.9%** of operating cost in Jun/Jul/Aug; commission specials, adjustments and
      bonuses are keyed by a text `month_key`. So the view measures **`direct_cost_sar`**
      (parts + outsourced + trip commissions — the three sources with a real per-day
      stamp) and never calls it "cost". `v_monthly_only_costs` reports the excluded
      riyals per month so a chart states its blind spot as a NUMBER.
      **Never label `direct_margin` as profit; never present direct cost as cost.**
    - Revenue is NOT redefined — it reads `v_revenue_invoices`, the same rows the
      monthly view reads, one bucket finer, so days sum to the month by construction.
      Consequence, accepted: revenue lands on the day an invoice was **CONFIRMED**, not
      the days its trips ran, so the series is lumpy and a month can read zero.
    - **`v_parts_consumption`'s definition MOVED DOWN a level** rather than being
      restated: `v_parts_consumption_daily` is the base and the monthly view rolls it
      up. Proven byte-identical before drafting (18 rows in, 18 out) and re-proven
      after apply by full symmetric difference, so `v_parts_cost_monthly`,
      `v_maintenance_cost_per_truck_monthly` and `v_pnl_monthly` are untouched.
  - **`0105` — Delivery Output. The bar is a PROXY and the card says so.**
    Measured volume does not exist (`trips.tank_size_m3` empty on every trip), so the
    bars are the delivering truck's **capacity DISPATCHED** — the full tank of every
    truck that ran, full or not — which is real entered data on 15/15 trucks.
    `trips_delivered_no_truck` is the honesty column: a delivered trip with no truck
    counts on the line and contributes nothing to the bars, so the UI names the
    shortfall instead of leaving the two series quietly disagreeing.
  - **`0106` — projects, cost composition, drivers ops, and ONE FEWER COPY OF DRIVER
    STATE.**
    - `0103` had embedded the driver-state rule as a CTE inside `v_fleet_state_now` and
      flagged it as accepted duplication. A drivers board would have made a **third**
      copy, so the CTE was lifted into **`v_driver_state_now`** and both other views
      read it. Two expressions remain (this view + `lib/driver-state.ts`) and
      `lib/actions/driver-state-drift.ts` compares them. `v_fleet_state_now`'s output
      is unchanged — same 13 columns/order/types, proven 11/6/1/4/0 both ways.
    - **Trap disarmed:** `0103` used `d.id not in (select driver_id from …)`. `NOT IN`
      against a subquery containing one NULL evaluates to NULL, so every driver would
      fall through to `active`. Zero NULLs today, so output was identical; rewritten as
      `not exists`.
    - **`active` means ASSIGNED, not driving.** Three drivers hold in-flight trips with
      no assigned truck, so their canonical state is `off_duty` while work is in
      progress (the Kanban already blurs those cards). State and trip stage are
      SEPARATE columns and `state_conflicts_with_trips` surfaces the pairing —
      **forcing them to agree would print a falsehood in one of them.**
    - **Compliance is four-valued** — `expired | expiring_soon | not_recorded | ok`.
      Five of eleven live drivers have no `iqama_expiry`; a missing date is not a
      passing check and `not_recorded` never collapses into `ok` (grey, never green).
    - Cost composition reads **`v_pnl_monthly` only** (it already publishes all five
      types including manual expenses), so "other" cannot differ from the P&L's own.
      Monthly by necessity, not preference. Shares recompute per month (0100), the
      denominator is stated as `operating_cost + expenses` because manual expenses are
      their own P&L section, and a month with no cost returns **NULL shares** — the UI
      renders that EMPTY, never five 0% slices.
  - **`0107` — current month, and a truck cell that says why.**
    - Projects scope to the current Riyadh month, auto-resetting on the 1st. **The
      month filter lives in the LEFT JOIN's ON clause, never in WHERE** — in WHERE it
      evaluates after the join and `NULL >= date` is not true, so a project with no
      trips this month vanishes instead of rendering an empty card. Measured on a quiet
      month: **join = 6 rows, WHERE = 0 rows.** On the 1st of a slow month the WHERE
      form would blank the whole section and look like an outage.
    - The drivers board's truck resolves assigned-first, else the truck of the latest
      in-flight trip (`truck_source` says which), and flags maintenance using **the
      same `busy_trucks` definition `v_fleet_state_now` uses** — two spellings of "in
      maintenance" would drift. **The flag is NOT exclusive to off_duty rows:** Khalid 2
      has an ASSIGNED truck in the workshop and is `active`, because assignment is what
      the state rule reads. The STATE is unchanged by 0107 — a truck in the workshop is
      still no truck available.
    - `trip_stage` is the **most RECENT** in-flight trip, not the most advanced (0106
      answered "the best this driver has going" rather than "what is he doing now").
      Tiebreak, written into the file: `trip_date DESC`, then most-advanced stage that
      day, then `id DESC` — the last key exists so the result cannot flip between two
      identical rows, which is the instability that gets blamed on the UI.
  - **`0108`/`0109` — DELIVERED (earned) revenue, and the bucket that had to be
    corrected.** `v_delivered_revenue_daily`: each delivered trip priced at its
    project's `rate_per_trip_sar`, per day. **DASHBOARD-ONLY — Reports,
    `v_revenue_monthly` and `v_pnl_monthly` are untouched and remain the only revenue
    the P&L knows.**
    - **IT IS NOT BILLED REVENUE AND MUST NEVER BE LABELLED "Revenue".** The two differ
      by TIMING (delivered now, invoiced later) and COVERAGE (delivered work never
      invoiced), and **billed can EXCEED delivered** when an invoice covers earlier
      periods and special charges — live, July does exactly that. Never add them,
      never feed delivered into a margin. The KPI "Revenue" tile stays the Reports
      anchor, and the card says so on screen.
    - The price is `projects.rate_per_trip_sar` reached through `trips.project_id`.
      It is NOT `trips.rate_sar` (NULL on every row) and there is no customer-level
      rate column. One delivered trip has no project: it contributes **0.00**, is
      counted in `delivered_trips_unpriced`, and the UI qualifies the figure only in
      months that actually have one. **Never guess a price.**
    - **`0109` IS A CORRECTION AND IS ON RECORD AS ONE.** `0108` bucketed by
      `delivered_at` — which records **when the stage button was pressed**, not when
      the water was delivered. This fleet advances trips on the Kanban in bulk, so
      five weeks of work collapsed onto three afternoons, one holding **310 trips**;
      all-time, 22 distinct days by `delivered_at` against **35** by `trip_date`.
      Turki caught it from the chart shape alone. `0109` re-buckets onto
      `trips.trip_date` — the operational day, the Kanban's own day filter, and the
      bucket `v_delivery_output_daily` already used, so those two now agree by
      construction and `0108`'s "do not reconcile these" warning is obsolete. The
      total does not move: 631 trips / 202,260 SAR before and after.
      **Both migrations are committed** (`f27229b`, `ad2b6e0`) rather than squashed —
      same precedent as `0038` and `0090`.
    - `trip_date` is a DATE column, so `0108`'s Riyadh-vs-UTC caveat disappeared with
      it. `delivered_at` is untouched on the table and `v_activity_feed` still reads
      it correctly — "trip delivered" as an EVENT did happen when the button was
      pressed.
    - The chart briefly carried BOTH revenue lines so they could be compared; the
      invoiced series was then dropped at Turki's call. The card is titled
      **"Delivered revenue vs direct cost"** and its note names the measure as
      earned-not-billed and points at where billed revenue lives.

  - **THE HERO SPACER IN `app/DashboardClient.tsx` IS LOAD-BEARING, NOT DECORATION.**
    The header's search bar translates down into that empty region and rises back on
    scroll (`components/SearchDock.tsx`). The first rebuild dropped `useHeroDock` and
    the spacer, which silently killed the whole intro — with no hero to measure,
    dock-distance stayed 0. Removing the spacer removes the feature.
  - **A FAILED READ MUST NEVER CLAIM AN EMPTY QUEUE.** A shipped-and-fixed bug: the
    page rendered "Every queue is clear right now" while the fetch had errored. Every
    section now distinguishes "nothing there" from "could not read", and a headline
    with no period renders an em dash rather than a confident zero. Tone colours follow
    the same rule — a figure we do not have gets no colour.
  - **THE DRIFT GUARD'S SHAPE IS THE LESSON.** The first one lived behind a throwaway
    `/dash-drift` route, became unreachable when that route was deleted at teardown,
    and was deleted with it — it existed for exactly as long as nobody needed it. The
    replacement runs on the Dashboard itself every load, renders NOTHING when healthy
    (which is what makes it affordable to leave permanent), tracks `reachable`
    separately from `ok` (with no session RLS returns zero rows on BOTH sides, which a
    naive comparison would score as agreement), and can never take the page down.
    **Do not move it back behind a diagnostic route.**
  - **CANVAS TEXT IS INVISIBLE TEXT.** Chart.js paints its legend onto the canvas, so
    series names are pixels — nothing for a screen reader, nothing for a test.
    `ComboChart` carries an `aria-label`; `BarChart` gained an optional `ariaLabel`
    (unset by default, so every Reports/Inventory caller is unchanged). Two test bugs
    came from this: an unscoped `getByRole("alert")` is never 0 in dev (Next mounts its
    own empty alert root outside the page tree), and one negative assertion filtered
    `<div>` by text and took `.first()`, silently resolving to the whole page wrapper —
    **a negative assertion on an unscoped locator proves nothing.**
  - **Add Summary is fenced to the semantic layer**, mirroring `lib/report-builder.ts`'s
    `BUILDER_METRICS`: the catalogue is module-private, a widget is only offered if its
    key is live in `report_metrics`, and the fence is re-checked server-side so it
    cannot be bypassed by a crafted request. The natural-language box beside it is a
    marked seam with no model call.
  - **Deferred — Dashboard:** per-trip measured volume (retires 0105's capacity proxy
    the day `trips.tank_size_m3` starts being recorded); a daily payroll source (would
    let `direct_cost` become real cost); a per-trip or effective-dated RATE, which
    would let delivered revenue price a trip at what it was actually worth on the day
    rather than at its project's CURRENT rate — the same effective-dated-rate
    mechanism already deferred under Finance items 3 and 4; the `0100` dictionary gap
    is unchanged.
  - **The `tests/dashboard-*.spec.ts` specs depend on DELETED throwaway routes**
    (`/dash-drift`, `/dash-daily-check`, `/dash-0106-check`, `/dash-0107-check`,
    `/dash-0108-check`, `/dash-0109-check`) — same convention as every prior phase.
    They document what was verified. Each fixture carried LIVE figures pulled via the
    Supabase MCP plus a few rows real data does not have (a zero-cost month, an
    expired licence, a project with no trips this month), because **a branch that
    never renders is a branch that ships unchecked.**
  - **NUMERIC assertions belong in the migration verification blocks, not in
    Playwright.** Chart.js is a MODULE import, so `page.evaluate` cannot reach
    `Chart.getChart` to read plotted values — a test that appears to check a series'
    numbers is checking nothing. The specs cover labelling, disclosure and conditional
    notes; the figures are proven in SQL. Three test bugs came from this area and are
    worth not repeating: an unscoped `getByRole("alert")` is never 0 in dev (Next
    mounts its own empty alert root outside the page tree); a negative assertion that
    filtered `<div>` by text and took `.first()` silently resolved to the whole page
    wrapper, so it passed for the wrong reason until unrelated copy exposed it; and a
    KPI selector expected `"REVENUE"` when the uppercase is CSS-only. **A negative
    assertion on an unscoped locator proves nothing.**
  - **A SPEC THAT CONTRADICTS SHIPPED DESIGN GETS DELETED, NOT LEFT TO FAIL.**
    `tests/dashboard-0108.spec.ts` asserted an "Invoiced revenue" series that was
    later dropped at Turki's call; it was replaced by
    `tests/dashboard-delivered-revenue.spec.ts`. A spec asserting the opposite of
    intent is worse than no spec, because someone eventually "fixes" the code to
    match it.

- **DEAD-CODE HYGIENE PASS — repo-wide, five commits, through `3819188`.** All
  behaviour-neutral: no route added or removed, no rendered output changed, no DB
  object touched. Recorded because two of the INSTRUMENTS were wrong first time,
  and those cost more than the findings did.
  - **Removed as unreachable** (`b3b591e`): `AreaChart`, `BarChart` and
    `DualBarChart` from `components/Charts.tsx` — their last callers were Operating
    margin, Receivables aging and the original Revenue-vs-cost pairing, all replaced
    during the Dashboard rebuild. `ScriptableContext` went with `AreaChart`. The
    export surface of `lib/dashboard.ts` and `lib/dashboard-widgets.ts` was narrowed
    to what actually crosses a module boundary (same cleanup the Reports pass did).
    **`preview/`'s own `drawAreaChart`/`drawBars`/`drawDualBar` remain the spec if
    any is ever rebuilt** — nothing was lost, only the unused port.
  - **`DailyOps.revenue` stopped being threaded** (`3638707`): billed revenue was
    fetched, mapped and passed to the client but rendered nowhere once the invoiced
    series left the chart. **Carrying a figure nothing renders is how two versions of
    one number start to drift** — the next person needing billed revenue finds it
    already in scope, uses it, and now there are two paths nobody reconciles. The
    field went; its invariant (billed revenue is bucketed by `confirmed_at` in UTC so
    days sum to `v_revenue_monthly` exactly) moved onto the KPI "Revenue" tile in
    `app/page.tsx`, where the number is actually shown. `DailyOps` carries a note
    saying the omission is deliberate, so it does not get "fixed" back.
  - **Ten compiler-confirmed unused locals cleared** (`cdcb62a`) across
    `drivers`/`iot`/`predictive`/`routes`/`InvoiceDetailModal`/`mock-data`/
    `parts-usage`, then `noUnusedLocals` + `noUnusedParameters` enabled (`6506f2e`)
    — **in that order, so the flip was green rather than turning the build red.**
    Finally the write-only `chargeImageFile` prop and its two call sites (`3819188`):
    the child owns the file input and reports upward via the setter, so passing the
    value back down was never needed. The parent's state stays — it is read at submit.
  - **INSTRUMENT #1 — A NAME GREP LIES ABOUT `components/Charts.tsx`.** It reported
    three genuinely dead ports as LIVE, because `app/reports` and `app/trips` import
    same-named `BarChart`/`PieChart`/`ComposedChart` from **recharts**, and
    `app/consumption` defines its own local `ComboChart`. **Exactly ONE file imports
    that module** — `app/DashboardClient.tsx`, taking `ComboChart` and `PieChart`.
    Check real import sites, not names. The file header now says so.
  - **INSTRUMENT #2 — BYTE-COMPARING `.next/app-path-routes-manifest.json` IS NOT AN
    IDENTITY TEST.** A byte diff "failed" on a behaviour-neutral change; rebuilding
    the SAME unchanged tree twice also produces byte-different output, because Next
    emits that file with non-deterministic key order. **Parse it and compare the route
    set and mappings** (17 routes, identical values). Verified that way in every
    commit of this pass.
  - **The right verification for a dead-code change is BUILD + IDENTITY, not a
    browser click-through:** `tsc` clean, `next build` compiles, route set and
    mappings unchanged, auth gate intact (`/login` 200, everything else 307). A
    behaviour checklist for removing code nothing calls is theatre.
  - **Pre-existing build warning, not caused by this pass:** `@supabase/supabase-js`
    touches a Node API (`process.version`) under the Edge Runtime. Confirmed present
    on `HEAD` before the change by rebuilding the stashed tree — do not go hunting it
    after a future cleanup.

- **WATER STATION COST — a deliberate P&L change, migrations `0110`–`0114`, through
  commit `98dbfea`.** Filling water costs money and the P&L did not know it. The
  feature ran in phases, each committed the moment it verified: `76f0957` (0110,
  per-type pricing + the trip snapshot column), `35c3798` (capture UI), `119814b`
  (0111 backfill), `5499c20` (0112, into the P&L), `6f9a445` (0113, the period
  grain), `f574a4c` (Reports cost statement), `7f462af` (the station-change gate),
  `4494b54` (Dashboard), `4564419` (test 4), `08d9580` (0114, the DB guarantee),
  `441123b` + `1a783f7` (follow-ups), `19080c0` + `da924a8` + `98dbfea` (the sweep).
  - **NULL IS NOT 0.00, AND THAT DISTINCTION IS THE WHOLE MODEL.** A station prices
    each water type separately (`fill_cost_potable_sar` / `fill_cost_non_potable_sar`):
    a price SET — **including 0** — means the station OFFERS that type; NULL means it
    does not. **0 is real** (company-owned stations fill free), so it can never be
    collapsed into "no price". Every helper in `lib/station-pricing.ts` preserves
    that, and `?? 0`, `Number(x) || 0` or any truthiness check reintroduces the bug
    the schema was shaped to prevent. The flat `water_stations.fill_cost` it replaced
    was kept unwritten through 0110–0121 and is **now GONE — retired in `0122`**
    (commit `dc9d411`), once both conditions 0110 set for itself were met: per-type
    prices entered on every station, and the trip backfill verified.
  - **`trips.filling_cost_sar` IS A FROZEN SNAPSHOT, AND THE FREEZE IS AGAINST PRICE
    EDITS — NOT AGAINST CHANGING WHICH STATION FILLED.** Editing a station's price
    later must not reprice history. But if the truck actually filled somewhere else,
    the frozen figure is a price from a station it never visited — a wrong record,
    not a protected one — so a station change RE-TAKES it. `decideStationChange`
    returns `costPatch: null` (do not touch) as a distinct outcome from
    `{ filling_cost_sar: null }` (moved, new station does not price this type) — two
    different claims, kept apart by the type.
    - **THE COST IS FROZEN ONLY WHEN THE TRIP IS CLOSED HISTORY, WHICH MEANS
      DELIVERED AT *BOTH ENDS* OF THE WRITE — NOT "the target stage is delivered".**
      This entry originally read "a DELIVERED trip is never re-snapshotted", and that
      phrasing is exactly the bug that shipped (`c76e731` fixed it). `setTripStage`
      passed only the TARGET stage, so changing the station and marking the trip
      delivered in one Move-trip apply was read as closed history: it wrote the new
      station and kept the OLD station's price. The action did not even SELECT the
      trip's current stage, so it could not tell "already closed" from "becoming
      delivered right now".

      | from | to | station changed | cost |
      |---|---|---|---|
      | in_transit | delivered | yes | **RE-TAKEN** (was the bug) |
      | delivered | delivered | yes | frozen — closed history |
      | delivered | in_transit | yes | **RE-TAKEN** — reopened, live again |
      | loading | loading | yes | **RE-TAKEN** |

      Becoming delivered is still live: the fill has just been asserted to have
      happened somewhere else. Leaving delivered is live again too — which is why
      keying on the CURRENT stage alone would have been wrong in the other direction.
      `stationChangePatch` takes both stages and computes `closedHistory` once;
      `decideStationChange`'s third parameter is named `closedHistory`, not
      `isDelivered`, because **the wrong name is what made the wrong value look right
      at the call site.**
    - **HOW IT WAS CAUGHT, and why no test would have:** Turki read
      "Shas Water Station · 1 fill · **15 SAR**" on the Reports cost sub-tab. Shas
      charges 80.00 for potable and always has; the 15.00 was Manfuhah's potable price
      from before he edited it to 5.00 — a figure that had never been a Shas price at
      all. **The reconciliation held perfectly** (the statement faithfully reported the
      stored snapshot), so nothing summed wrong; only a human who knew Shas's price
      could see it. **0114 could not catch it either** — the trigger refuses impossible
      station/type pairs but writes no money, and Shas *does* fill potable, so the move
      was legitimate and only the snapshot was wrong. Blast radius was measured, not
      assumed: exactly ONE trip. Every other frozen cost differing from its station's
      current price is explained by a price edit on the same station and type (356 of
      them, all correct). KI-026-0062 was corrected to 80.00 and the fix re-verified
      in-browser on a second trip.
  - **A SCHEDULED TRIP'S FROZEN COST IS NOT A COST YET.**
    `v_filling_cost_monthly` joins `stage in (loading, in_transit, delivered)` — a
    scheduled trip has not filled, so it contributes nothing. **Summing
    `trips.filling_cost_sar` raw will therefore EXCEED the statement** and look like an
    understatement in the view; live, August carries 20 scheduled trips holding 165.00
    that correctly do not appear. This cost a false alarm during verification — a
    predicted total was 5 SAR out purely because a scheduled trip's cost was subtracted
    from a figure it had never been part of. **Reconcile against the view's own
    predicate, never against a raw trip sum.**
  - **THE GATE IS ONE RULE READ FROM TWO DIRECTIONS.** Trip creation fixes the station
    and narrows the TYPE (`selectableWaterTypes`); a station change fixes the type and
    narrows the STATION (`stationBlockedForType`). Only the first existed at capture
    time, and the second surface had nothing — proven live by **KI-026-0062**, a
    potable in-transit trip moved to Umm Al Hamam, which does not fill potable at all.
    Its cost correctly re-snapshotted to NULL and the trip sat at a station physically
    incapable of filling it; NULL was the honest record of a state that should have
    been unreachable. Both directions now live in `lib/station-pricing.ts`, and the
    server actions call ONE pure `decideStationChange` rather than restating either.
    KI-026-0062 was corrected to Manfuhah on evidence, not preference — 3 potable
    siblings the same day, 107 project-wide.
  - **`0114` PUTS THE RULE IN THE DATABASE, AND IT IS A TRIGGER FOR A REASON.** A CHECK
    constraint is retroactive: **13 potable trips at Umm Al Hamam predate per-type
    pricing and are legitimately grandfathered**, and `NOT VALID` only defers the
    problem — a later `VALIDATE`, or a `pg_restore` (which re-checks everything), would
    reject the dump. A BEFORE trigger inspects only the NEW row, so history is
    structurally out of reach. **It applies at every stage including delivered** —
    grandfathering means the existing rows stay, not that more may be made. Three
    details that are load-bearing:
    - **TWO triggers, not one.** `OLD` cannot be referenced in an INSERT trigger's
      `WHEN` clause, so a single `INSERT OR UPDATE` would bury the IS-DISTINCT-FROM
      test in the body — every stage move, commission recompute and invoice stamp
      entering the function to be told to leave. Split, the UPDATE trigger's `WHEN`
      is evaluated without calling the function at all.
    - **`pg_trigger_depth() > 1` on UPDATE.** `trips_water_station_fkey` is `ON UPDATE
      CASCADE`, so renaming a station KEY rewrites `water_station` on every trip
      pointing at it — indistinguishable from a station change, and it would
      re-validate the 13 grandfathered rows and refuse a legitimate admin rename.
      Same technique and reason as `0096`'s 30-day lock.
    - **SECURITY DEFINER, because the failure mode matters.** `water_stations` RLS is
      `authenticated/ALL/USING(true)` today so INVOKER would work — but if that policy
      is ever narrowed, an invoker lookup returns no row, `not found` allows, and the
      guard **fails OPEN, silently, exactly when someone tightened security.**
      Enforcement must fail closed. No revoke footer: Postgres refuses to invoke a
      trigger function directly, and EXECUTE is checked at CREATE TRIGGER time.
    - **It writes NOTHING.** The re-snapshot stays in the app, where the freeze rule
      lives. Splitting the money rule across SQL and TypeScript is how the gate came
      apart the first time.
  - **CONSEQUENCE OF 0114, worth knowing before reading any filling figure:**
    `filling_uncosted_trips` is **HISTORICAL-ONLY**. New trips can no longer be
    uncosted — the insert raises instead — so the count is fixed at 13 (June–July).
    **A new uncosted trip appearing means the guard was dropped, not that the data
    changed.** The count still travels wherever the money is shown, because `sum()`
    skips NULLs and those 13 do make the historical total short by an unknown amount.
  - **`0112` FAILED ITS FIRST APPLY WITH `42P16`** — a column was inserted mid-list.
    `create or replace view` can only APPEND. It could not be dropped and recreated
    either, because `v_pnl_by_period` depends on `v_pnl_monthly` and 0112 does not
    recreate it. Redrafted append-only; `0113` follows the same discipline even though
    nothing depends on it, because "nothing depends on it today" is a fact with a
    shelf life. **Every view in this feature restates `security_invoker` + revoke anon
    + grant authenticated after the create** — `create or replace view` does not
    preserve reloptions.
  - **A SEED MIGRATION WAS DRAFTED AND DELETED BEFORE IT RAN.** It would have turned
    Umm Al Hamam's deliberate "no potable" into "potable at 0" — undoing a real
    business decision under the guise of a backfill. Exactly one deliberate NULL was at
    risk. **Do not seed a column whose NULL carries meaning.**
  - **THE COST MIX DOUGHNUT HAD STOPPED FOOTING and nobody noticed for three months.**
    It rendered four hardcoded slices while `operating_cost_sar` had included filling
    since 0112 — short by 210 / 1,285 / **4,390** in Jun/Jul/Aug. Now five slices,
    gap 0.00 every month. The **direct-cost line needed no change**: it reads
    `v_daily_operations.direct_cost_sar` as-is (`app/page.tsx` → `directCost`), which
    has carried filling since 0112 — a display refresh, not a re-summed series. **Never
    re-derive a bucket list at a call site; that is what let it drift.**
  - **`updateTrip` WAS DELETED (`da924a8`), and the reason generalises.** No callers,
    but it wrote `water_station`/`water_type` with neither the gate nor the
    re-snapshot — so a station change through it would have stranded a frozen cost, a
    failure 0114 deliberately does NOT catch because the trigger writes no money.
    **Exported from a `"use server"` file, it was a live endpoint whether or not a
    component called it — "unused" is not "unreachable".** A future trip-edit UI
    belongs on `stationChangePatch`; the file header says so.
  - **TWO COST DOUGHNUTS HAD SWAPPED COLOURS** (`98dbfea`). Reports and the Dashboard
    each hardcoded their own hexes, and Payroll/Outsourced were reversed between them —
    the amber wedge meant payroll on one page and outsourced work on the other. Worse
    than two arbitrary palettes, because it looks consistent while meaning opposite
    things. **`lib/cost-colors.ts` is now the one source** (a leaf module — the two
    libs are siblings, neither is the other's parent), and `CostSliceKey` is an alias
    of its key set rather than a second hand-written union.
  - **`tests/trip-station-gate.spec.ts` and `tests/cost-colors.spec.ts` are the FIRST
    specs in this repo that need no diagnostic route and no auth bypass** — both drive
    pure functions, so they do not rot at teardown like every earlier suite. The gate
    spec states its own limit up front: with no Supabase session a server action cannot
    be exercised end to end, because RLS returns zero stations and the gate then fails
    to fire **for the wrong reason** while the test still goes green. It drives
    `decideStationChange` instead, which is the whole decision; the DB half ran against
    real rows through the MCP and was reverted (fingerprint `b8e4cdb…`, P&L unmoved).
  - **PROCESS INCIDENT, not a code defect:** the whole Reports page rendered unstyled
    and was misdiagnosed as a UI-phase regression. Cause: `rm -rf .next && npx next
    build` **while the dev server was running** — HTML 200, every `/_next/static/*`
    404, `.next/BUILD_ID` present where dev output belonged. **Never delete `.next`
    under a running dev server.** To verify a production build without stopping it,
    point `distDir` elsewhere — and note `next build` **rewrites `tsconfig.json`**
    (reformats it and injects the dist path into `include`); revert it afterwards.
  - **THE FLAT `water_stations.fill_cost` IS RETIRED — migration `0122`, commit
    `dc9d411`.** 0110 had parked it with its own release condition ("once per-type
    prices are entered and the trip backfill is verified"); both were checked live
    and held — every station carries a per-type price, and
    `water_stations_offers_at_least_one_type` was **already** `convalidated` (the
    second thing 0110 parked, closed by someone before this).
    - **NO APP COMMIT WAS NEEDED, which made this unlike `0119`/`0121`.** Every
      remaining mention was a COMMENT saying the column was deprecated, and no
      TypeScript type declared it — `StationPricing` names only the per-type pair —
      so nothing selected it into a typed shape. Checked rather than assumed.
    - **THE ONE DATUM DESTROYED, and why rescuing it would have been wrong:**
      `olaya_filling_point.fill_cost = 70.00`, the only non-zero value. Olaya has
      **zero trips, any stage, all time**, so that figure had never priced a fill —
      no P&L number and no frozen `trips.filling_cost_sar` traced to it. The tempting
      move was to write it into `fill_cost_potable_sar` so "nothing is lost". **That
      would have invented a business fact:** nobody knows which water type the flat
      70.00 was for, and Olaya's potable price is NULL, which under this schema's
      central rule MEANS "does not offer potable". The migration carries a DO-NOT-FIX
      block, and its verification asserts Olaya's potable is still NULL afterwards.
      The full pre-drop table is preserved in the migration header so the figures
      survive in git. **Losing an unused number beats inventing a business fact.**
    - **The money proof:** `v_filling_cost_monthly` was byte-identical before and
      after — Jun 210.00 (18 costed / 10 uncosted), Jul 1,285.00 (143/3), Aug
      5,185.00 (598/0); trips 817 / 13 uncosted. Dropping a column no view reads
      cannot reach the P&L, and that is what the check demonstrates rather than
      assumes.
      **THOSE ARE APPLY-TIME FIGURES, NOT STANDING EXPECTATIONS.** June and July
      are closed and should not move; **August grows with every delivery** — it
      already reads 5,205.00 / 600 costed after eight trips were delivered during
      the piece-3 verification. **Re-read the current month live; only reconcile
      the closed months against a written number.** A checklist that hardcodes a
      growing figure reports a failure that is really just time passing.
    - **Trap for anyone re-checking dependencies:** use `fill_cost[^_]`, not
      `%fill_cost%`. The loose pattern also matches `fill_cost_potable_sar` /
      `fill_cost_non_potable_sar` and returns false positives on every check —
      including the three `fill_cost`-named CONSTRAINTS, which reference only the
      per-type columns.
  - **THE STATION ROW SHAPE IS CONSOLIDATED — commit `aae45dd`.** This entry used to
    read "`StationPricing` is hand-rolled in three places". The count was LOW: four
    files declared a shape carrying the two price columns, and one of them must stay
    separate — so the split matters more than the number.
    - **Three were genuinely duplicated**, byte-identical, ten fields, same order:
      `app/trips/page.tsx` (declared FUNCTION-LOCALLY, the least discoverable place
      for it), `ProjectsBoard.tsx`, `WaterStationsModal.tsx`. All three now import
      **`WaterStationRow`** from `lib/station-pricing`, expressed there as
      `StationOption & {...}` so a full row IS a pickable option plus admin fields.
    - **`WaterStationInput` (app/trips/actions.ts) is NOT merged, deliberately.** It
      is the WRITE shape: it composes on `StationPricing` for the price pair but
      carries **no `key`** — the immutable FK target for `trips.water_station`,
      generated once on create and never present in an update payload — and no
      `id`/`active`. Folding it into the row type would put all three back within
      reach of the edit form. Both type docs state the boundary, in both directions.
    - **Why it mattered even though all three copies agreed:** the shape carries two
      PRICE columns, and NULL vs 0 mean different things here. Three hand-written
      copies is how a `?? 0` "fix" lands in one file and not the others. The two
      price columns now have **exactly one declaration in the repo**.
  - **Deferred — Water Station Cost:** there is **no supported clear-the-station
    path** — `trips.water_station` is NOT NULL with an FK and the slug CHECK forbids
    `""`, so `setTripStation(id, "")` fails on the foreign key, and the code's
    empty/NULL guards are unreachable today.

- **DRIVER PAYSLIPS — migrations `0115`–`0118`, through commit `5476b24`.** A
  numbered, frozen settlement document per driver per month, plus a commission
  review table beside it. Built on the Reports statement pack: `?statement=payslips`.
  Commits: `186143a` (0115), `81e682c` (confirm + bold), `3209f4b` (0116),
  `e67b2d1` (terminated label + review table), `be33162` (0117), `5476b24` (sweep).
  **`0118` is DRAFTED, NOT APPLIED** — see the drift note below.
  - **SNAPSHOT AT ISSUE, NOT EFFECTIVE-DATED SALARY.** A payslip is a DOCUMENT;
    its defining property is that it does not change after you hand it over.
    Issuing freezes every figure and assigns a gap-free number
    (`PS-2026-000001`, counter-table pattern, `FOR UPDATE`). An UNISSUED month is
    a live preview computed at TODAY's salary and the register says so.
    Effective-dated salary stays deferred — that is one mechanism with three
    consumers (driver salary, commission rates, customer rates) and half-building
    it inside a payslip feature would have got it wrong for all three.
  - **TWO BASES ON ONE SCREEN, DELIBERATELY.** The payslip register is
    **SETTLEMENT month** — commission attributed by `paid_at` (Riyadh). The
    review table below it is **WORK month** — what the driver earned from the
    trips he drove, paid out or not. **The same driver legitimately shows two
    different totals**, and live, two July drivers do. Both tables label the
    basis explicitly on screen; left implied it reads as a bug in one of them.
  - **WHY `paid_at` AND NOT `period_label`.** `period_label` is a payout-RUN
    label, not the work period, and the live data proves it: a payout labelled
    "Jul 2026" paid for work done entirely in **June**, another spanned **two
    months**, one driver had **two payouts in one label** (178 + 26, summed —
    taking "the latest" would have silently dropped 26.00), and two payouts
    locked **zero trips** (specials only). Attributing by trips would split one
    paid total across two documents; parsing the label puts June's work on a July
    slip anyway, by parsing free text. `paid_at` is typed and keeps a payout
    whole.
  - **THE COMMISSION BLOCK COMPOSES ON `commission_payouts`, never recomputes.**
    Where a payout settled in the month, the block IS that payout by id. Only
    where none exists does it fall back to accrual — and that fallback counts
    only trips with `payout_id IS NULL`, which is what stops one trip's
    commission reaching two payslips.
  - **TERMINATED IS A LABEL RULE, NOT A GATE.** Status priority: issued number →
    **Terminated** → No hire date → month in progress → Not issued. A terminated
    driver's final month is a legitimate payslip and stays issuable. **A driver
    with no hire date is SHOWN but CANNOT be issued** — enforced in the RPC
    (23514), not just in the button.
  - **THE DEFECT 0116 CAUGHT, AND HOW.** 0115's first draft claimed "all 11 live
    drivers have a hire date". That 11 came from a query filtered to
    `terminated_at is null`, written up as if it described every driver. There
    are **16**; the **5** with no hire date are the 5 terminated ones, at 1,300
    each, and the old `coalesce(hire_date, m.month)` read them as employed — ten
    permanent 1,300 SAR documents issuable to people who had left. **Every
    verification block missed it because they inherited the wrong premise from
    the prose above them.** Check the set your claim is about, not the set your
    query returned.
  - **`0117` — THE SAME DEFECT, LIVE IN THE P&L.** `v_payroll_monthly` gated
    employment with `COALESCE(hire_date,'1900-01-01')`, billing people for every
    historical month. **The suggested fix — exclude NULL-hire people — was
    overridden with data:** 0 of 5 such drivers have a June trip but 4 of 5 have
    July trips, and the sixth is an **active fleet_manager on 4,500/month**.
    Excluding would have dropped August payroll 31,300 → 26,800 for someone who
    works there today. The floor moved to `COALESCE(hire_date, created_at::date)`
    — a real date, claiming only that **nothing earlier is defensible**. June
    payroll 36,000 → **25,000**; July and August unmoved. It degrades to nothing
    once real hire dates are entered.
  - **KNOWN DRIFT, GATED: net pay is expressed twice** — in
    `issue_driver_payslip`'s INSERT and in `payslipPreviewNet` (TypeScript, for
    the unissued preview). They agree today and nothing keeps them agreeing.
    **`0118` closes it** by appending `net_sar` to the basis view AND making the
    RPC read it instead of re-adding the components — adding the column alone
    would give three expressions, not one. **Drafted, not applied; the TS helper
    must not be deleted until it is, or the preview breaks.**
  - **PRINT: the payslips surface is the ONE place two print subtrees coexist.**
    Every other statement mounts alone, so "one visible id" sufficed until now.
    `#payslips-print` and `#commission-review-print` are both in all six
    `globals.css` rule groups, and `body.printing-review` picks which survives —
    without it, printing either emits both.
  - **Live data to reconcile against:** 2 issued payslips (`PS-2026-000001`,
    `PS-2026-000002`, counter at 2 — **keep both, intentional test data**); the
    review table reconciles to `v_commissions_monthly` to the riyal (Jun 428.00 /
    Jul 2,226.02 / Aug 12,912.52); two distinct drivers are both named
    **"Fahad 4"**, disambiguated in the UI by a short id only where the name is
    ambiguous.
  - **Deferred — payslips:** a deductions data source (`deductions_sar` ships at
    0 so the arithmetic is complete and adding one changes no issued slip); an
    approval step before issue (parked with RBAC). **Effective-dated salary is
    now BUILT — see the entry below.**

- **EFFECTIVE-DATED RATES — COMPLETE. Migrations `0125`–`0128`, commits
  `742bec1`, `5c67762`, `78a3038`, `0e836a6`, plus app work `f4dead3`
  (rate freezes at delivery) and `29e5f05` (salary-history screen).**
  Forward-only salary history, the customer rate frozen per trip, and the screen
  that records a back-dated raise. `0125` shipped a live defect and `0126` fixed
  it forward — `0125` stays as applied history rather than being rewritten (the
  `0038` / `0090` / `0109` precedent).
  - **§7's OLD FRAMING WAS WRONG AND THE SCOPE SHRANK.** This was carried for
    months as *"one mechanism with three consumers (driver salary, commission
    rates, customer rates)"*. Measured: the three are in **three different
    states** and only ONE had live exposure. **Commission is already frozen**
    (`trips.commission_sar` stamped on 730/730 delivered trips), so effective-
    dating its config would protect an already-stamped number — **ruled out of
    scope, do not build it.** Customer rate is a separate, still-open snapshot
    job (below). Only salary was actually broken.
  - **THE MODEL: forward-only, baseline at the employment floor.**
    `salary_history` uses the subject pattern (two nullable FKs + CHECK exactly
    one set). A month resolves to **the latest row with `effective_from <= that
    month's end`** — one path, no fallback. Seeded 22 rows (16 drivers **including
    the 5 terminated**, whose salaries July's 20,900 depends on, + 6 staff).
  - **WHY THE BASELINE IS DATED AT `COALESCE(hire_date, created_at::date)`, AND
    WHY THAT IS THE WHOLE FIX.** `0125` seeded baselines at TODAY and resolved
    with a *fallback to the earliest row*. That made one row do two jobs — the
    immutable baseline the past falls back to, AND today's salary a raise
    updates — so the trigger's same-day upsert silently rewrote the past. A +100
    raise moved June 25,000 → 25,100 and July 37,800 → 37,900. `0126` dates
    baselines in the past instead, which **removes the fallback entirely** and
    makes collision *impossible* rather than policed: the trigger writes
    today-dated rows, and today is past every closed month's end.
    **It is 0117's own floor**, the same expression the employment window uses —
    so "counted in a month" and "has a resolvable salary that month" agree by
    construction. **A 1900 sentinel was deliberately NOT used**; 0117 rejected
    exactly that for employment.
  - **HISTORY IS TRIGGER-MAINTAINED, and that is not optional.** The app writes
    `salary_sar` straight from its forms. If only the seed wrote history, the
    first hire or raise through the UI would leave that person with **no row —
    and the resolution would drop them from payroll entirely**. A silent
    under-count of real wages is the worst failure available here. Two triggers
    per table (0114's lesson: `OLD` is unavailable in an `INSERT` `WHEN` clause).
    **Base columns stay the current salary; history is derived from them, never
    the reverse.**
  - **`is_baseline` IS INFORMATIONAL ONLY** — the resolution does not read it.
    The date separation is the fix; the flag exists so "which row is the seed"
    is queryable and so verification can assert baselines were not mutated.
  - **`salary_is_current_snapshot` NOW MEANS SOMETHING.** It was a hardcoded
    `true` placeholder for exactly this feature. It now answers *"has no
    recorded change taken effect by this month's end"* — true for all three
    months today. It read `false` for August under `0125`, when it briefly meant
    "fell back to the baseline"; that was a display flag, not a money figure.
  - **PROVEN WRITE-FREE, which is stronger than the sampled test.** 0 non-baseline
    rows dated on/before 30 Jun or 31 Jul, 0 baselines on today's date, and today
    is past both month ends — so a today-dated raise is *unreachable* from either
    month for every future raise, not just the one sampled. Payroll unmoved at
    **25,000 / 37,800 / 31,300** (June is the 0117-corrected figure), and both
    frozen payslips byte-identical.
  - **`0127` — THE FOURTH PAYROLL VIEW.** `v_driver_payslip_basis` read
    `d.salary_sar` directly and was split out rather than half-done, because
    `create or replace` must reproduce its **18 columns verbatim** and it is the
    payslip money path. Written against the full `pg_get_viewdef` with exactly
    ONE expression changed. **Applied while it was still a no-op, deliberately** —
    every past month resolved to the current salary either way, so nothing could
    move; applying it after the first raise would have changed several figures at
    once with no clean before/after to diff. `v_pnl_monthly` and
    `v_monthly_only_costs` compose on `v_payroll_monthly` and inherited the fix
    for free. `salary_missing` was left as `d.salary_sar IS NULL` — keeping the
    change to one expression is what made the no-op claim checkable.

  - **LESSON, third occurrence — derive an expected count with the SAME
    predicate the code uses.** `0125`'s own block C predicted 17 seed rows; the
    truth is 22, because the seed correctly includes terminated drivers and I had
    counted live ones. Same shape as `0121`'s "7/7 customers" and `0123`'s
    "8 month-only" slips.

- **CUSTOMER RATE FROZEN PER TRIP — migration `0128`, app `f4dead3`.**
  `trips.rate_sar` was NULL on all 817 rows and nothing stamped it, so anything
  not yet on a confirmed invoice re-priced at the project's CURRENT rate.
  - **`0128` BACKFILLED 816 TRIPS; THE ONE WITHOUT A PROJECT KEPT ITS NULL.**
    The UPDATE **selects rather than joins-and-coalesces**, so a project-less trip
    is never a candidate — a join would have dropped it or stamped it with
    something invented.
  - **OPTION A WAS EVIDENCE-BACKED, NOT PREFERENCE.** Backfilling a frozen price
    from a CURRENT value normally asserts something nobody checked. Here the
    frozen confirmed-invoice lines prove it: every `amount_sar` equals its
    project's current rate (410=410, 400=400, 420=420), so **no rate has ever
    moved** and "current" IS the historical rate. `0128`'s block C re-runs that
    check and says STOP if it ever reads otherwise.
  - **`f4dead3` FREEZES IT GOING FORWARD, in `setTripStage`**, beside the two
    freezes already there. **Four decisions that could have gone the other way:**
    it is **NOT gated on `payout_id`** (that lock is about DRIVER commission
    frozen into a payout snapshot; the customer rate is a different party's
    money); a trip with **no project stamps nothing**; it is **NOT nulled when
    leaving delivered** (unlike `commission_sar` — `0128`'s model is that a trip
    carrying a project carries that project's rate, so clearing it would erase
    what the backfill deliberately set, and re-delivering re-stamps, mirroring
    the station re-take rule); and it **fails closed** — a failed project read
    refuses the whole stage move rather than completing a delivery with an
    unstamped rate.
  - **BROWSER-VERIFIED, AND CONFIRMED IN THE DATA AFTERWARDS.** Eight trips were
    delivered across five projects and the freeze fired correctly on every one —
    RRR 160, King Saud 400 x3, King Salman 300, Airport 410 x3, each equal to its
    project's rate. Table-wide after: 817 trips / 816 stamped / 0 missed /
    0 wrongly-stamped / 0 mismatches. The freeze also fired ALONGSIDE the other
    two on the same rows (`commission_sar`, `filling_cost_sar` both stamped),
    which is the check that matters most — three freezes, one transition, no
    interference.
  - **THAT VERIFICATION LEFT REAL DATA, KEPT DELIBERATELY (Turki's call).** Those
    eight deliveries are genuine operational events, not test residue, so August
    net profit moved **-59,900.02 -> -60,088.36** on their new commission and
    filling cost. Payroll was untouched. Recorded because a P&L figure that moved
    during verification looks like a defect later if nobody wrote down that it
    was a real delivery.
  - **THREE FROZEN MONEY FIGURES NOW LIVE ON A TRIP, and they freeze at
    different moments for different reasons — do NOT unify them:**
    `commission_sar` (at delivery, gated on `payout_id`, re-derived across a
    driver+project+day ramp), `filling_cost_sar` (at creation, re-taken on a
    station change), `rate_sar` (at delivery, ungated, never nulled).
  - **COSMETIC CONSEQUENCE, recorded so it is not "fixed" wrongly:** a trip
    created from now on carries `rate_sar` NULL until delivery, while every
    pre-`0128` trip was backfilled regardless of stage. `ProjectsBoard` renders
    `rate_sar ?? 0`, so a NEW scheduled trip reads 0 there until delivered.
    Self-correcting, and **not** a reason to stamp at creation — the snapshot's
    whole point is to record the price at the moment the trip became billable.
  - **PREPAID AND INVOICES NOW BILL FROM THE FROZEN RATE — commit `d0813b9`.**
    The last money-core step, and the only change in this workstream that could
    have moved a customer's balance. A rate change now prices only NEW work;
    past consumption stops moving under the customer.
    - **`lib/prepaid.ts` WAS NOT SWITCHED — ITS CALLERS WERE, and that is the
      whole shape of it.** That module never fetches; `ConsumingTrip.rate_sar` is
      populated by whoever builds the list. So the engine kept **zero functional
      changes** — FIFO ordering, the covered/unpaid split and every VAT figure are
      byte-identical code — and only its doc comment moved, because the old one
      asserted the opposite. **Eight functional lines across three files.**
    - **THE NULL RISK WAS STRUCTURALLY UNREACHABLE, not merely unlikely.** The
      worry was an undelivered trip billing at NULL. But `deliveredTripsSorted()`
      filters `delivered_at != null` BEFORE any amount is computed, and
      `consumingItems()` is the single queue `derivedBalanceItems`,
      `buildStatementItems` and `splitCoveredUnpaidItems` all walk — so every trip
      that becomes money has been delivered, and a delivered trip always carries a
      frozen rate.
    - **The fallback is `?? project.rate_per_trip_sar`, NEVER `?? 0`** — the type
      is non-null so a value must be written, and if that filter is ever loosened
      behaviour degrades to the OLD basis rather than to billing nothing. `?? 0`
      was rejected, not merely not chosen.
    - **THE INVOICE PATH WAS SWITCHED TOO.** An invoice bills a trip at what it
      was worth on the day for the same reason a balance does; leaving it live
      would have let an invoice and a balance disagree about the SAME trip.
    - **Proven a no-op on all existing data:** Airport 32,800.00, King Saud
      59,200.00, Royal Court 53,760.00 identical on both bases, 0 delivered trips
      with a NULL rate, confirmed invoices 20 / 114,551.50 unchanged. The
      delivered counts had GROWN since the proposal (77/145/128 -> 80/148/128) and
      the totals still matched — the bases agree per trip, so they agree at any
      count, which is the stronger statement.
    - **THE ONE TRIP THAT STILL HAS NO FROZEN RATE IS THE ORPHAN** (no project).
      It never enters a project's trip list, so it cannot reach prepaid
      consumption. Do not "fix" it by inventing a rate.
  - **FOUR SURFACES PRICE DELIVERED WORK, AND ALL FOUR READ `trips.rate_sar`.
    KEEP THEM ALIGNED — this is the invariant, not a tidy outcome.**

    | surface | where | since |
    |---|---|---|
    | prepaid consumption | `ConsumingTrip.rate_sar` | `d0813b9` |
    | invoice lines | `ConsumingTrip.rate_sar` | `d0813b9` |
    | delivered revenue (Dashboard) | `v_delivered_revenue_daily` | 0129 |
    | Customers Revenue KPI | `app/trips/CustomersTab.tsx` | 0129 |

    Anything that reaches for `projects.rate_per_trip_sar` to price DELIVERED
    work has reintroduced the defect. **The project rate is what NEW work will
    cost, not what past work did.** A fifth surface reads the frozen column too.
    - **THE FOURTH SURFACE WAS FOUND BY ITS OWN COMMENT, and that is the lesson.**
      CustomersTab summed the project's CURRENT rate under a comment claiming it
      "reconciles to `v_delivered_revenue_daily` riyal-for-riyal". True when
      written; 0129 would have made it a lie on the first rate change — three of
      four surfaces switched, with the code still asserting the fourth agreed.
      **A comment that names WHY two numbers agree survives a change; a comment
      that merely asserts they agree becomes false silently.** Both were rewritten
      to state the basis.
    - **The whole batch was a no-op today and that is WHY it landed now:** 737
      trips / **237,120.00** identical on both bases in all three months, with
      **0** trips falling through to the fallback. Land a basis change while
      before/after is provably identical — not after a rate move, when several
      figures shift at once and there is nothing clean to diff against.

- **SALARY-HISTORY SCREEN — `29e5f05`.** Opened from the Salary cell on the
  driver detail panel (`app/drivers/SalaryHistoryModal.tsx`).
  - **IT EXISTS FOR BACK-DATING, not for everyday raises.** The triggers already
    record a change entered TODAY, so the ordinary case never needed a screen.
    Only a dated row can say *"he has been on 5,000 since March"*. Its other job
    is showing the timeline every payroll figure now resolves through.
  - **THE HONESTY BLOCK IS THE DESIGN, not decoration.** A back-dated row
    legitimately re-costs reported months — that is what recording it MEANS — but
    it must never be discovered afterwards. The form states, **before the save**,
    which month the recalculation starts from and that it reaches months already
    reported. It is computed **from the DATE ALONE** rather than previewing a
    server-side number, so the reader can check the rule instead of trusting a
    figure. **Saving a back-dated row is the ONE user action in this app that
    intentionally moves previously reported profit.**
  - **BASELINES ARE GUARDED TWICE.** A baseline renders with a lock badge and
    **no delete control at all** — not a disabled one, because there is no
    circumstance in which removing it is right and a greyed button would only
    invite the question — and `removeSalaryChange` refuses it **server-side**.
    Deleting one would make the earliest months resolve to nothing, which reads
    as a salary of **zero** rather than an error.
  - **`addSalaryChange` DOES NOT WRITE `drivers.salary_sar`.** That would fire
    the trigger and record a SECOND row dated today, turning one back-dated
    correction into two rows saying different things. **One writer, one
    direction:** the person's own form owns the current value, this screen owns
    the timeline.
  - **BROWSER-VERIFIED ON BOTH PANELS, AND IT LEFT NOTHING BEHIND.** After the
    check, `salary_history` still held **22 rows, all baselines, 0 changes** — the
    back-dated case was exercised and CANCELLED rather than saved, so payroll
    stayed 25,000 / 37,800 / 31,300 with `salary_is_current_snapshot` true for all
    three months. Verifying this screen means deciding whether to keep what it
    writes; the honest end state of that check is either a recorded change you
    meant, or no row at all.
  - A failed read renders as an **error, not an empty timeline** — "never had a
    salary recorded" is a very different claim from "could not load it".
  - **BOTH PEOPLE-DETAIL PANELS CARRY IT** — drivers and staff. The modal and
    both actions are subject-agnostic (`{driverId}` | `{staffId}`), so the staff
    side was a button rather than a feature. Wiring it also **added the salary
    cell to the staff detail, which never had one** — staff salary was editable
    on the form and displayed nowhere. The figure and its timeline went in
    together on purpose: a salary with no history beside it is exactly the
    arrangement that let the value drift unnoticed until `0125`.

- **`payment_mode` reconciliation — DONE, migration `0121`, commits `e69ec6a`
  (app) + `25ce8cb` (migration).** This entry stood for months as "a clean
  concept-merge (`pay_as_you_go` ≈ `prepaid`) — do it next time customer app code is
  touched". **The premise was wrong, and the live data is what showed it.**
  - **THERE WAS NOTHING TO MERGE.** `customers.payment_model` read `'postpaid'` on
    **all 7 rows** — its own column DEFAULT. `pay_as_you_go` had **never been used**,
    so the merge had zero rows to convert. Worse, the column DISAGREED with the real
    setting on **3 of 6** customer/project pairs (three customers read postpaid while
    their project was prepaid). Not a second opinion needing reconciliation — a stale
    default that never tracked anything and was outright wrong on half the live rows.
    Merging it in would have imported that wrongness.
  - **WHY IT DRIFTED, the transferable part:** the Customers form was its ONLY
    writer, and nothing updated it when the project's real mode changed through
    ProjectModal. Two writable sources, one of them unguarded and unread — the
    guarded one being `can_switch_payment_mode` (0035).
  - **Direction was decided by CONSUMERS, not preference.** Nothing read
    `payment_model`: 0 views, 0 functions (`create_project_with_customer` mentions it
    in a COMMENT only — "payment_model/active fall to their column defaults" — and
    names it in no INSERT), 0 triggers, 0 policies, 0 indexes. `projects.payment_mode`
    is what all four RPCs take, what 0035 guards, and what invoices freeze at confirm.
    So the retirement was one statement: `alter table customers drop column`.
  - **`payment_mode` EXISTS ON THREE TABLES AND ONLY ONE WAS A DUPLICATE.**
    `projects.payment_mode` is the source (nullable on purpose — "unset" must stay
    detectable). `invoices.payment_mode` is the 0037 frozen snapshot and is
    CORRECTLY separate: it records what the arrangement WAS when the document was
    issued, not what it is now. **Do not "reconcile" that one.**
  - **The Customers list's Payment column is now DERIVED** from the customer's
    project (1:1 via `projects_customer_id_unique`), read-only, em dash when unset —
    the same `—` convention the Archive customer tab already used for this field.
    **The writable control is gone from that form on purpose**; ProjectModal is the
    one editor. `PaymentModel` and `PAYMENT_MODEL_LABELS` are deleted, and
    `lib/db-types.ts` carries a note saying neither comes back.
  - **Visible consequence, and it is a correction:** that column previously read
    "Postpaid" for every customer and now reads **Prepaid for three of them**.
  - **No RPC signature changed and none needed to** — all four `p_payment_mode`
    parameters refer to `projects`/`invoices`, not the dropped column. Money core
    (`lib/prepaid.ts`, `lib/vat.ts`) never referenced `payment_model` at all.
  - **LESSON, since this is the second time a long-standing §7 note turned out to be
    wrong rather than merely stale** (the Kanban entry was the first): a deferred item
    describes the world as it was understood when it was written. **Re-measure the
    premise before executing on it** — this one had been true-sounding and wrong for
    months, and a single `group by` on the column would have shown it at any point.
- **COMMISSION MONTH LENS — migration `0131`, commits `c8fa286` (SQL) + `48d9629`
  (app).** `pay_commission` used to sweep every unpaid row; `0131` re-grains it to
  ONE month, and `48d9629` is the repair for the app half, which was still calling
  the old all-time signature. **The screen could show one month and pay another** —
  that is the defect this closed, and it is why the two halves are a pair.
  - **`commission_periods`** is now **one row per driver per month** (`ensureCycle`
    upserts `onConflict "driver_id,month_key"` — a hard dependency on 0131's re-grain).
    **This entry used to call that table `commission_cycles`, which DOES NOT EXIST**
    — the loose name came from the app's own `cycles`/`CommCycle` variable and type,
    which are deliberately generic and are NOT the table name. Every query in
    `app/drivers/actions.ts` names `commission_periods` correctly; only this
    paragraph was wrong. Sibling trap: `staff_commission_types` does not exist
    either — it is `commission_types`.
    `payCommission(driverId, monthKey)`, `approvePayout`, `setBonusStatus` and
    `reopenPayout` are all month-scoped, and `setCommissionBonus` refuses to write
    into a month that is already paid.
  - **`period_label` IS A PAYOUT-RUN CAPTION, NEVER THE WORK PERIOD** — the same
    finding the payslip register made (`paid_at`, not the label). `defaultPeriodLabel()`
    is deleted. `buildPayoutSnapshot` now REQUIRES a `monthKey` and freezes it into
    the snapshot; `payoutMonthKey()` reads it back. **A pre-0131 sweep reports `null`
    and is never back-derived from `period_label`** — History shows those legacy rows
    with an em dash, excludes them from any specific month, and SAYS SO on screen
    rather than letting a record silently vanish.
  - `monthLabel()` lives in `lib/commission-rows.ts` as the single definition, from a
    hardcoded English month array, so the screen label and the RPC's frozen caption
    cannot disagree about a month name.
  - **TWO CALL SITES STAY MONTH-LESS ON PURPOSE** — the drivers-roster balance and the
    drivers badge look across ALL months, not the lens. Item 9 below depends on that.
  - Money harness: **70 PASS / 0 FAIL**, with new month-scoped cases J/K/K2/K3.

- **`0132` — `drivers.health_insurance` ADDED (tri-state), `drivers.rating` DROPPED.**
  Commits `c144978` (app stops reading `rating`) then `8cd3a76` (the migration) —
  **in that order, deliberately.** A PostgREST select naming a dropped column returns
  400, so both Fleet fetches would have failed to render the instant it applied;
  landing the app half first meant the page was never down. Same code-then-migrate
  rule as everywhere else, applied to a DROP.
  - **`health_insurance` IS NULLABLE WITH NO DEFAULT AND NO BACKFILL, AND THE
    TRI-STATE IS THE FEATURE.** Null = "not recorded yet", which is a DIFFERENT FACT
    from an explicit No. Defaulting the fleet to `false` would assert that ~every
    driver is uninsured — a compliance claim nobody made. The column COMMENT says so
    on the column itself so a later migration does not tidy a default in. All 16
    drivers read null today.
  - `rating` had been dead since `0023` replaced the safety/rating/hours/incidents
    block: no form ever wrote it, every cell on screen was already an em dash, and
    0 views / 0 functions referenced it, so the drop could not cascade.

- **STAFF PAGE UI BATCH — commit `b50c534`.** Eight items on `/drivers`, batch-built
  against `0132`'s new column. No migration, no RPC, no money helper touched.
  - **Item 9 is the only money-display item, and it ADDS NO ARITHMETIC.** The Drivers
    table's new **Unpaid Commission** column renders the PRE-EXISTING `balanceByDriver`
    map built in `app/drivers/page.tsx` by
    `buildCurrentRows({ drivers: allDrivers, trips: commTrips, cycles, specials,
    adjustments, includeEmpty: true })` — no `monthKey`, so **all periods**, over
    fetches already pre-filtered to `payout_id is null`. That map already gated
    `commissionDrivers`, so **it IS the Commissions tab's own source, not a copy of
    it** — the column is structurally incapable of drifting from the tab beside it.
    **Zero is printed as a muted `formatSar(0)`, never an em dash** — nothing owed is
    a real answer, and a dash reads as missing data (same rule as the glossary's null
    caveats).
  - **Item 3 — THE INCIDENTS KPI READS `driver_incidents`. ONE SOURCE, READ IN TWO
    PLACES. It went to the dead column and back, and the round trip is the record.**
    - **The final state (`SETTLED`):** the KPI counts LIVE `driver_incidents` rows
      inside a rolling 12-month cutoff, roster-scoped — the SAME table the driver
      detail panel reads — so the two figures on that screen agree by construction.
      That is `b50c534`'s version, reinstated.
    - **The path, so nobody walks it again.** The brief said "fix Incidents (12mo) so
      it reads `incidents_12mo`". The old reducer ALREADY read that column correctly;
      **the column is dead** — unwritten since `0023` removed its form controls, 0 on
      every row. `b50c534` switched to live rows and disclosed the swap; the
      instruction afterwards was to put it back, and `e0326d0` did, with a comment
      asserting the KPI and the panel were *different sources not expected to agree*.
      **Then the architect measured it live: `mohammed 2` has a real
      `driver_incidents` row inside the window, and `incidents_12mo` reads 0 for
      every driver.** So the KPI was printing 0 beside a panel showing a real
      incident — not two honest sources, one broken one. Reverted forward.
    - **THE `e0326d0` INSTRUCTION IS WITHDRAWN AND MUST NOT BE RE-APPLIED.** "KPI
      reads `incidents_12mo`, do not reconcile with the detail panel" is WRONG. Both
      surfaces read `driver_incidents`. **Reconciling them was the fix, not the bug.**
      The reducer carries this in its own comment and
      `tests/staff-batch.spec.ts`'s item-3 test asserts the count again.
    - **`drivers.incidents_12mo` WAS A CONFIRMED DEAD DUPLICATE AND IS NOW DROPPED —
      migration `0133`, applied and verified.** It rode with the Staff cleanup, in
      its own migration, app-refs-stripped-first (`bea2a52`, the `rating`/`0132`
      precedent — PostgREST returns 400 on a select naming a dropped column).
      Nothing wrote it, so there was no writer to build: **a writer was the wrong
      answer, the column was.** See the Staff cleanup entry.
    - Avg Safety was dropped from the KPI row; **`drivers.safety_score` stays in the
      database.**
  - **Item 3's On Duty bar prints its zeros.** Every one of the four derived states
    gets a key even at 0 (`OnDutyBar`) — a dropped segment reads as a broken chart,
    and today all live drivers sit in one state. Colours come from `DRIVER_STATE_TONE`,
    the same mapping the pills use, so the bar and the pill can never disagree.
  - **Item 4 routes through a NEW optional `tone` override on `StatusPill`, NOT through
    `statusTone()`.** `lib/utils.ts`'s `statusTone()` is a GLOBAL shared mapping
    (trucks/invoices/trips/drivers) returning `"info"` for BOTH `idle` and `off_duty`
    — recolouring there would have repainted three other pages. `DRIVER_STATE_TONE`
    (`lib/driver-state.ts`) holds the driver mapping: active=ok/green, idle=warn/amber,
    off_duty and on_leave=yellow. `PILL_TONE_CLS` is exported from `components/ui.tsx`
    so the bar reads the same class table.
  - **Item 6's mechanics cluster EXCLUDES `head_of_maintenance`, everywhere.** Open
    work orders come from `work_orders.assigned_mechanic_id` reduced in `page.tsx`;
    the head's own open WOs are NOT in the count. Duty hours are labelled **"With duty
    hours set"** and the card deliberately never says "on duty now" — `duty_hours` is a
    shift LENGTH, not a clock-in state, and the wording is load-bearing (a test asserts
    the card does not contain /on duty now/i). Iqama window is **90 days** (a renewal
    is a multi-week errand), already-expired iqamas are counted, and a station-less
    staff member becomes a real **"Unassigned"** row rather than being dropped.
  - **Item 1 — History became a sub-tab of Commissions**; `?tab=history` still
    deep-links into it, so no existing link breaks. Item 5 — Add staff sits in the page
    header where New driver does, staff tab only, and opens the form via a **nonce
    prop, not a boolean**, so cancelling and pressing again reopens it. Item 7 — the
    plate cell is `font-mono text-sm font-semibold`. Item 8 — health insurance renders
    where Rating was: Yes (emerald) / No (rose) / a MUTED `—` titled "Not recorded"
    that is **explicitly not red**, and the form's select offers all three with a new
    driver defaulting to unrecorded.
  - **`tests/staff-batch.spec.ts` (9 tests) depends on the DELETED `/staff-batch-check`
    route** — same convention as every prior phase. Route and middleware bypass torn
    down, `git diff` confirmed empty, `/login` 200 and `/drivers` 307 reconfirmed.
  - **PROCESS INCIDENT, second occurrence, same cause:** four tests failed because the
    page never HYDRATED — three `/_next/static/*` 404s from a `next build` run earlier
    under the live dev server, which clobbers `.next`. Exactly the trap already recorded
    under Water Station Cost. The `?tab=history` deep-link test PASSED throughout
    (server-rendered), and that split is what localised the fault to client JS.
    **Never delete or rebuild `.next` under a running dev server.**
  - **Escape does not close the driver detail modal** — there is no key handler, only
    the footer Close button and the X. A spec that presses Escape times out on the
    overlay intercepting the next click.
  - **BONUS MONTH PICKER — the mismatch is CLOSED, and the refusal is now real
    (`578743e`).** The review checklist claimed the picker "refuses save without a
    month". It could not: `bonusMonth` was `useState<string>(monthKey)` with a
    re-sync effect, so it was never empty and the refusal could never fire. It was
    reported as a mismatch rather than quietly built, then built on instruction.
    - **It starts EMPTY and the lens moving re-seeds it to EMPTY, never to the new
      lens** — otherwise moving the lens silently re-points a pick made under the
      old one. A `Select month…` placeholder leads the options.
    - **THE AMOUNT INPUT IS GATED TOO, NOT JUST `Set`** — an editable amount beside
      a greyed-out button reads as a broken button rather than a missing input.
    - **WHY THIS ONE FIELD DOES NOT TAKE THE LENS.** Every other month-scoped write
      on that screen does, because the lens is what the reader is looking at. The
      bonus is the one write that can legitimately DISAGREE with the lens, so it
      must be chosen rather than defaulted — a bonus filed against the wrong month
      is a money error nobody sees until that month is paid, and a pre-filled month
      is exactly how it happens. The amber cross-month warning stays, now guarded
      against the empty string.
    - `bonusCycle` resolves to `null` while the month is empty, so `bonus` is 0 and
      the Remove button (gated on `bonus !== 0`) does not render — no change needed
      there, but that is why.
    - **`tests/bonus-month-picker.spec.ts` (5 tests, all passed) depends on the
      DELETED `/bonus-month-check` route** — same convention as every prior phase.
      **The SAVE is deliberately not under test**: `setCommissionBonus` is an
      auth-gated server action and a session-less route would fail it for a reason
      that has nothing to do with the gate. One test bug worth not repeating: an
      unscoped `getByRole("option")` resolves against BOTH selects on that screen —
      the tab's month lens carries the same labels — so the option assertions are
      scoped to the bonus select.

- **STAFF PAGE BATCH 2 — five display refinements, commit `3f9c7b8`.** All
  non-money: no migration, no RPC, no money helper touched, and every figure was
  already being computed before this batch — only how it is shown changed.
  - **Item 1 — the CSV export is Excel-friendly, and BOTH halves of that are
    load-bearing.** A **UTF-8 BOM** leads the file (built from `String.fromCharCode
    (0xfeff)`, never a literal — U+FEFF renders as nothing, so a literal is invisible
    in every editor and indistinguishable from a stray edit that deleted it); without
    it Excel assumes the system ANSI codepage and every Arabic driver name arrives as
    mojibake, which is what made this export unusable for an Arabic roster. A
    **`sep=,` directive** follows it, because Excel opens a `.csv` with the SYSTEM
    list separator rather than the comma the format is named after — on a `;` locale
    every row lands in a single cell. **The trade was decided on asymmetric failure
    cost:** the directive costs one stray first row in Numbers/Sheets, which do not
    know it, and a visible junk row is recoverable in seconds where a silently
    single-columned sheet is not. Rows terminate **CRLF**, and `csvCell` quotes a
    bare `\r` too — otherwise a name pasted in from another system starts a row
    mid-value.
    - The assembled lines are named `lines`, **not `rows`** — `rows` is the
      component's own unfiltered row memo, and shadowing it there is exactly how an
      export quietly starts ignoring the filter.
  - **Item 2 — the month lens and Export CSV moved beside the sub-tabs, VIA A PORTAL,
    and the portal is the point.** They govern the whole screen, so they belong next
    to the control that chooses the screen rather than among the status chips that
    filter only the table below them. **Lifting `monthKey` into `DriversClient` was
    rejected:** `CommissionsTab`'s own header states that the figure beside the Pay
    button and the `monthKey` handed to `payCommission` cannot diverge *because there
    is exactly one of that state*, and a prop boundary between them is precisely what
    would break it. `buildMonthOptions` is module-private too, so the parent could not
    build the option list anyway. `controlsHost` decides **WHERE** they render, never
    **WHETHER** — given no host they stay in the card's own header, which is what a
    standalone mount gets.
    - **The host node is `useState`, not `useRef`, and the setter IS the callback
      ref.** A ref's `.current` fills during commit without re-rendering, so the first
      paint would read null and the portal would never mount.
  - **Item 3 — the On Duty card is FOUR SEPARATE BARS, ONE PER STATE. DO NOT MERGE
    THEM BACK INTO ONE.** It shipped in batch 1 as a single stacked track with a
    four-cell legend and was replaced on Turki's call. The reason generalises: on a
    stacked track every segment is measured against its neighbours, so the eye reads
    *which state is biggest* and cannot read *how much of the roster is idle* without
    doing arithmetic. **All four bars share ONE denominator — the whole roster** — so
    the second question is answered directly, and a state at 0 degenerates into an
    empty track rather than a segment that vanished and took its label with it.
    Colours are still `PILL_TONE_CLS[DRIVER_STATE_TONE[s]]`, the same table the status
    pills read, so bar and pill cannot disagree.
  - **Item 4 — the staff leave tally sits BESIDE THE NAME and states its basis on
    screen.** It took two moves to land (`3f9c7b8`, then `7400c81`), and both are the
    same lesson at different distances. It was an absolutely-positioned corner badge on
    a wrapper `div.relative` that existed for nothing else (the wrapper went with it),
    which read as a notification stuck ON the card rather than a fact ABOUT the person;
    batch 2 brought it inside the card but left it at the RIGHT EDGE, where it was
    technically in the card and still read as a separate column with nothing tying it to
    whose leave it was. It now sits in the name row, immediately after the "On leave"
    pill — **the person and their leave read as one unit, which is the whole claim the
    number makes.** It is sized to that pill (`text-[10px]`, `px-1.5 py-0.5`), not to its
    old right-edge treatment, because that row sets the card's height and the previous
    `text-sm`/`px-2` chip would have pushed every card taller for a figure most of them
    do not carry. **The "On leave" status pill is a DIFFERENT FACT and stays put** — it
    is a state TODAY, the tally is how much of the year has been taken; they sit
    together deliberately. **"since Jan 1"
    is on screen, not only in the tooltip** — without it the reader guesses between a
    rolling twelve months, an entitlement balance and a calendar-year tally, and those
    are three different conversations to have with an employee. **Zero renders
    nothing**: a "0d" chip on most of the grid drowns the ones that matter.
    - **DERIVED LIVE FROM `leave_periods` EVERY RENDER, AND THERE MUST NEVER BE A
      SCHEDULED RESET.** `leaveDaysInYear(periods, currentYear)` already existed, so
      this item was a relocation rather than new plumbing. A cron that zeroed a stored
      counter each January would **destroy the prior year's record** to produce a
      number this expression gets for free — on 1 January the year rolls, no period
      falls inside it yet, and it reads 0 on its own. Distinct from the "On leave"
      pill, which is a state TODAY.
  - **Item 5 — the Incidents and Licence KPIs name the drivers behind the figure.**
    Incident names come from `driver_incidents` (the same rows the KPI counts, so
    `mohammed 2` appears), **grouped by driver with a count suffix** — the KPI counts
    ROWS and a driver can have several, and the "(2)" is what keeps the list addable
    back up to the figure above it. Licence names are ordered **soonest first**, which
    is the order the list is acted on.
    - **DUPLICATE NAMES ARE REAL IN THIS DATA** — two drivers are both called
      "Fahad 4" — so `driverLabelById` appends a 4-char id fragment **only where the
      name is ambiguous**, the same convention the payslip register already uses.
    - **Truncated at three with the remainder counted, full list on hover.** A KPI card
      is a fixed-height tile in a six-column row; an unbounded list would push it
      taller than the three beside it and shear the whole row. Nothing is hidden, only
      deferred — the figure above already says how many there are. **Zero names render
      NOTHING, never "None"**: the KPI already reads 0 and a second element saying so
      is noise on the three cards where it would appear.
  - **`tests/staff-batch2.spec.ts` (6 tests, all passed) depends on the DELETED
    `/staff-batch2-check` route** — same convention as every prior phase. Item 1 is
    asserted on the downloaded file's raw BYTES, because reading it as a string can
    silently strip U+FEFF and the test would then pass with the BOM missing. Item 3
    asserts the shared denominator (every fill at 25% on a 1/1/1/1 fixture), not just
    the four figures — four bars that each scaled to their own maximum would print the
    same numbers.
    - **One test bug worth not repeating: the page header carries the SAME
      `flex items-start justify-between` classes as the new sub-tab row**, so a
      class-only locator resolved to the header and proved nothing. Scoped by content
      (the row that contains the Historical sub-tab) instead.
  - **`tests/staff-batch.spec.ts`'s per-state figure assertions were DELETED, not
    repointed** — they described the stacked track item 3 replaced, down to its
    `text-xl` class. Same rule as `tests/dashboard-0108.spec.ts`: a spec asserting the
    opposite of intent is worse than no spec. Its label assertions survive, because
    labelling every state including the zeros is a rule both versions obey.

- **STAFF PAGE CLEANUP — one survey pass over the whole page, commits `bea2a52`
  (the `incidents_12mo` strip, alone and first) and `343923f` (everything else).**
  13 files, ~6,644 lines, surveyed for dead code, 0098 drift, duplicated
  definitions, lying comments, UTC-vs-Riyadh date bugs, dead specs and RLS.
  **THE MONEY GATE WAS NOT TRIGGERED:** `lib/commission-rows.ts`,
  `SalaryHistoryModal.tsx`, `staff.monthly_salary_sar` and the unpaid-commission
  column source are untouched. `CommissionsTab.tsx` WAS edited — a stale comment
  and a type-only re-export trim, no arithmetic — and that is recorded here so a
  later reader who sees the file in this commit does not have to re-derive that it
  was safe.
  - **`drivers.incidents_12mo`: DROPPED — migration `0133`, applied and verified by
    the architect.** `lib/db-types.ts:133` was the ONE real reference and now
    carries a tombstone modelled on the adjacent `rating` block. The app half
    (`bea2a52`) landed first, then `0133` ran — the `rating`/`0132` precedent,
    because a PostgREST select naming a dropped column returns **400**. Verified
    live afterward: the column no longer exists on `drivers`; `driver_incidents`
    (the real record) is untouched — `mohammed 2`'s row is still there and the
    Incidents KPI reads it. **Naming note, same as 0131/0132:** the Supabase MCP
    records the apply under its own auto-generated timestamp version
    (`20260818160714`), not a sequential `0133` version number — the file on disk,
    `supabase/migrations/0133_drop_driver_incidents_12mo.sql`, is the source of
    truth and its name IS what the migration list shows this time (unlike 0131,
    which lost its numeric prefix entirely). Cosmetic only, schema identical.
  - **`RoleSelect` IS DELETED — one definition where there were two.** ~106 lines
    in `StaffTab.tsx`, line for line `./LookupSelect`, which was written later as
    its generalized form and whose own header already said so. `addStaffRole`
    already matches `onAdd` exactly, so nothing adapts between them, and the two
    behavioural deltas are generic error strings — **the role wording users
    actually see is passed in through `addLabel`/`newPlaceholder`.** A tombstone
    says not to re-add a role-specific copy.
    - **`noUnusedLocals` NAMED THE ORPHANED IMPORTS; MY PREDICTION HAD BEEN
      WIDER THAN REALITY.** I expected `useMemo`, `useRouter`, `Btn` and
      `StaffRole` to fall out too; the compiler showed all four are still used
      elsewhere in the file and only `@/lib/slug` and `cn` were dead. **Delete,
      then let the compiler tell you the closure** — guessing it produces
      collateral damage that looks like part of the same change.
  - **TWO DATE BUGS, AND THEY ARE THE SAME BUG TWICE.** Both built a key with
    `new Date("YYYY-MM-DDT00:00:00")` — no `Z`, so it parses **local** — then
    serialized with `.toISOString()`, which is **UTC**. East of UTC that slices
    back one day, every day: `StaffTab`'s iqama window opened at **89** days while
    its own comment said 90 (a lying comment and a date bug in one place), and
    `DriversClient`'s incident 12-month window opened a day late.
    - Fixed through **two NEW shared helpers in `lib/utils.ts`** —
      `addDaysToKey` / `addYearsToKey` — which keep the whole round trip in UTC
      (`T00:00:00Z` + `setUTCDate`/`setUTCFullYear`) and normalize Feb-29 as a
      side effect. **Routing both sites through one definition was the point**;
      fixing them in place would have left two copies of the correct expression
      the way there were two of the wrong one.
    - **THE OTHER `new Date` SITES ARE CORRECT AND WERE LEFT ALONE** — a
      `new Date(iso)` on a **timestamptz** (`HistoryTab:38`, `StaffTab:435`,
      `actions.ts:169,251`), a `new Date(iso + "T00:00:00").toLocaleDateString()`
      for **local display** (`LeaveSection:27`, `MechanicCommissionsSection:39`),
      and all pure string-slice date math. The bug shape is specifically
      **local parse → UTC serialize**, not `new Date` itself.
  - **`YEAR_END` BECAME `yearEndKey(today)`** in `DriversClient` — a module-level
    const with two independent faults: it read the **browser** clock rather than
    the server's Riyadh `today`, and being captured at module load it **never
    rolled over** into a new year. Ruled a clear fix rather than a Turki decision,
    since neither fault has a defensible reading.
  - **`app/drivers/page.tsx`'s ERROR CHAIN COVERED 19 OF 21 FETCHES, AND THE TWO
    MISSING ONES WERE NOT HARMLESS.** `activeWorkOrdersRes` and
    `activeOutsourcedJobsRes` feed `buildActiveJobTruckIds`; **a failed read
    arrives as `null`, and `null` yields an EMPTY set** — so every truck reads as
    having no active job and a truck in the workshop shows as available.
    That is the Dashboard's **"a failed read must never claim an empty queue"** in
    a different costume: silently reporting the all-clear is worse than reporting
    nothing.
  - **31 OF 35 SPEC FILES DELETED — a spec that cannot pass in ANY configuration
    is not documentation.** 24 drove diagnostic routes torn down at the end of
    their own pass (this repo's standing convention), and
    `station-type-pricing.spec.ts` targets the REAL `/trips` route but its own
    header admits it needs the reverted `VERIFY_BYPASS`. A permanently-red suite
    is a broken build everyone learns to ignore, **which is what makes a real
    failure invisible**. Survivors, all pure-unit, no server: `cost-colors`,
    `driver-assign-gate`, `month-keys`, `trip-station-gate` — 28 tests, **run
    green BEFORE anything was deleted**, so the deletion was subtraction from a
    known-good baseline rather than a hope.
    - **A QUOTED-ROUTE GREP ALONE UNDER-REPORTS.** Many specs embed the route in a
      full `http://localhost:3002/...` const, so the sweep had to extract quoted
      literals **and** `^const [A-Z0-9_]+ ?=` lines, then check each of the 24
      candidate routes for existence in `app/`. All 24 are gone.
    - `playwright.config.ts`'s own comment had become a lying comment ("throwaway
      config for the follow-up-batch browser test"). It now states that every
      remaining spec needs no server, why the 31 went, and why `baseURL` is kept
      with **deliberately no `webServer` auto-start** — `next build`/dev-server
      interaction has taken this repo down twice.
  - **SECURITY: CLEAN.** All 14 staff-surface tables carry exactly one
    `authenticated_all_<table>` policy (`roles={authenticated}`, `cmd=ALL`,
    `qual=true`). Anon holds the table-level SELECT **grant** but every policy is
    `authenticated`-scoped, so anon receives **zero rows** —
    **`has_table_privilege('anon', …, 'SELECT')` is a GRANT check, not a
    row-visibility check.** An over-broad grant, not a live exposure; revoking it
    is a DB change and therefore the architect's.
  - **RULING, app-wide, not just the 14 staff tables above: LEAVE THE ANON
    SELECT GRANT AS-IS, for now.** The same finding holds across all 74 tables in
    the schema, not only the Staff surface — Supabase's own default grants `anon`
    table-level SELECT on every new table, and every one of those 74 tables carries
    an `authenticated`-scoped RLS policy that blocks every anon row. Turki reviewed
    this and ruled to leave it: zero live exposure, and the grant itself is
    cosmetic (over-broad, not open). **Deferred to a dedicated app-wide security
    pass, done alongside future RBAC** (the same pass that role-checks and
    `APPROVER_ROLES`-style gating are already deferred to elsewhere in this file) —
    not fixed piecemeal per feature. **No grant has been revoked; none should be,
    outside that pass.**
  - **TWO STALE FACTS IN THIS FILE WERE CORRECTED FROM LIVE MEASUREMENT** — §6's
    view posture (40/40 → **44/44/0**, with the note that *the two counts matching
    is the check, not the number*) and the commission entry's `commission_cycles`
    → **`commission_periods`**. Both are recorded in their own sections above.
  - **AN EMPTY GREP FROM THE WRONG DIRECTORY IS INDISTINGUISHABLE FROM A REAL
    FINDING.** A `commission_cycles|commission_periods` sweep returned nothing at
    all and briefly read as "no references anywhere"; the shell's cwd had drifted
    into `tests/` from an earlier `cd`. From the repo root it returns 11+ hits in
    `app/drivers/actions.ts`. **Absence of output is only evidence if you know
    where you were standing.**
  - **0098 drift: NONE FOUND.** No Staff metric is computed in the page that
    belongs in a view — the KPIs read live rows the detail panels read too, which
    is the reconciliation batch 1 already established.
  - Verified: `npx tsc --noEmit` clean, `npx playwright test` **28 passed**.

- **PREPAID SETTLEMENT VISIBILITY — migration `0134` (applied) plus commits
  `219b175` (app half of 0134), `c588831` (statement settlement rows) and
  `64ace36` (failed-read surfacing).**
  - **`0134` — `invoices.payment_method` gains `'balance'`.** The request that
    produced it said "no migration needed, `payment_method` is free text". **It is
    not free text, and there were TWO gates:** `0025`'s CHECK constraint and
    `0039`'s `pay_invoice()` body, which raises `Invalid payment method: balance`.
    The RPC gate fires first, so shipping the app half alone would not have written
    a wrong label — it would have made **every prepaid settlement fail outright**, a
    live outage on the money path. That is why the app half was gated behind the
    file. **`'balance'` is a bookkeeping LABEL, not a debit:** the money was already
    consumed at delivery by `lib/prepaid.ts`'s FIFO walk, and the pay action only
    records and locks. **No amount, balance, VAT figure or ledger row moves.**
  - **NO BACKFILL, deliberately.** Two populations of already-paid invoices are
    left exactly as recorded: `prepaid`+`cash` (the mislabel this fixes — rewriting
    a settled document's stored method changes history after the fact) and
    `payment_mode = null` (pre-`0037`, unclassifiable). **Any report splitting cash
    from balance must expect the pre-`0134` period to read cash-heavy.**
  - **The prepaid guard is the point, not the widened allowlist.** `pay_invoice()`
    resolves mode snapshot-first then falls back to the customer's project —
    **exactly what the UI already does** (`payment_mode ?? projectPaymentMode`); any
    other resolution would put a refusal behind an enabled button. A NULL snapshot
    is **not** evidence of "not prepaid", it is evidence no snapshot was taken.
    **RECONCILED FILE:** the applied guard wraps the project lookup in
    `count(distinct …) = 1` so a future mixed-mode customer resolves to *unknown*
    and **fails closed** rather than authorising off an arbitrary row; the drafted
    version used a plain scalar subquery. The file on disk was rewritten to match
    what ran — `0099`/`0100`/`0101` precedent, correction recorded not squashed.
    `CREATE OR REPLACE` (not drop+recreate) because the signature is byte-identical
    to `0039`'s, which satisfies the `0038` one-signature rule by construction.
  - **STANDING AUDIT (verification block D in the migration), not a one-off:** zero
    rows, forever, where `payment_method = 'balance'` resolves to a non-prepaid
    mode. The CHECK alone would still permit `'balance'` on any row, so the query
    covers a direct write bypassing the RPC. **Its mode resolution is a deliberate
    byte-copy of the guard's** — an audit that resolves differently from the rule it
    audits reports its own disagreement as a finding. Change both in one commit.
  - **`c588831` — the prepaid statement now TRACES paid invoices.** A paid prepaid
    invoice previously vanished from the statement entirely (the `mode ===
    "postpaid" ? payments : []` gate), so the customer saw balance consumed with no
    document tying it to an invoice. `StatementItemEntry.kind` gains **`settlement`**
    and `buildStatementItems` a **5th** defaulted parameter (5th, not 4th —
    `asOfDate` already held slot 4). **THE ROW RECORDS, IT DOES NOT DEDUCT:** the
    trips and charges the invoice covers already consumed balance at delivery, so
    the running balance **holds flat across it and is not recomputed** — deducting
    would double-count. It sits in **TRUE date order** interleaved with topups,
    trips and charges, never appended at the end; within its own day it sorts
    **last**, so it can never land between a same-day credit and the debit it
    funded. `"Invoice payable"` / `"Balance"` are rendered by `StatementModal` —
    `lib/prepaid.ts` is pure math and carries only `reference: invoice_number`.
    **Zero arithmetic changed:** the settlement branch short-circuits before the
    pre-existing comparator, and `scripts/prepaid-check.ts` asserts every
    non-settlement row is byte-identical to the no-settlement baseline.
  - **`64ace36` — `paidInvoicesRes.error` was UNCHECKED.** `app/trips/page.tsx`
    destructured 13 fetches and the error chain covered 12; a failed read degraded
    to `(paidInvoicesRes.data ?? [])`, which would drop every payment row **and**
    unlock every paid-invoice trip — false data, silently. Same rule as the Staff
    cleanup's failed-read fix and the Dashboard's "a failed read must never claim an
    empty queue".
  - **CLOSED — the stranded special charge (~1,667.50).** Commits `6109f3b` (the
    app fix) and `d5c9271` (migration `0138`). This entry stood as "OPEN, NOT
    BUILT" pending Turki's business-rule call; he made it, and the framing that
    decided it was **"all app data is DUMMY — we are not fixing fake balances for
    their own sake, we are fixing the STRUCTURAL LOGIC so it is correct when real
    data arrives."**
    - **THE DEFECT, for anyone reading this after the fix.** An **uncovered**
      special charge on a **confirmed** invoice was excluded from `grand_total`
      AND from `amount_due` (which was unpaid TRIPS only), yet it is FK-bound to
      that one invoice at creation, editable only in Draft/Review, and hidden from
      every other invoice by `reservedElsewhereIds` — **so it could never be billed
      anywhere, while `consumingItems` had already deducted it from balance.**
      Trips had two outlets (covered→balance, unpaid→amount due); charges had one
      outlet and a dead end.
    - **THE FIX IS THE SECOND OUTLET, NOT A SPECIAL CASE.** `lib/invoice.ts` now
      routes uncovered charges into `amount_due` exactly as unpaid trips already
      flow, so a charge cannot strand. **The filter is `covered !== true`, NOT
      `=== false`** — an unflagged charge belongs in Amount Due, never silently
      inside Grand Total; the failure has to land where someone will see it.
      VAT is rounded **per charge line** (`round2(amount * (1 + VAT_RATE))` each,
      then summed), matching `ConsumedItem.consumedAmount` — sum-then-round
      disagrees by riyals against the balance the same charge already consumed.
    - **The LYING COMMENT at `lib/invoice.ts:36-41` is corrected.** It claimed an
      uncovered charge "rolls forward (same mechanism as trips)", which was false
      for display and billing — it rolled forward only inside the FIFO pool, and
      the reserve-at-draft paragraph directly below it said so.
    - **The two live instances resolved differently, on purpose.** `98551243`
      "emergency hours" 517.50 incl VAT on `026-000009` (confirmed, unpaid) now
      appears in Amount Due and is billable — the structural fix reaches it with
      no data edit. `fa048000` "test z" 1,150.00 on `026-000008` was **already
      paid**, so no billing outlet could reach it retroactively; it was test data
      and `0138` **plain-deletes it, no audit trail** (Turki's call). Balance moved
      −49,440.00 → −48,290.00 (+1,150.00 = 1,000.00 × 1.15) and `026-000008` stayed
      byte-identical at 2,530.00 grand / 0.00 due.
    - **`0138` MATCHES ON id AND label AND amount, and the redundancy is
      deliberate:** `026-000008` carries TWO 1,000.00 charges dated the same day —
      "test" (`70e80c73`, KEEP) and "test z" (`fa048000`, DELETE). It also stays
      **uncommented in the file**: a comment-only migration replays as a no-op, so
      a db reset would resurrect "test z".

- **OUTSTANDING REFLECTS THE LIVE PREPAID BALANCE — migration `0137`, commits
  `9603778` (SQL) and `0b46a6a` (the app half).** A confirmed invoice's
  `amount_due_sar` is frozen at confirm. For a PREPAID customer that figure goes
  stale the moment the balance moves — **a top-up after confirmation covers work
  the invoice still shows as due** — so the receivable was overstated by however
  much balance had arrived since. The fix is one SQL definition read by every
  consumer.
  - **THE RULE, in full:**
    ```
    prepaid   : outstanding = least(frozen, greatest(0, shortfall − already_taken))
    otherwise : outstanding = frozen                     (byte-unchanged)
    ```
    **The cap can only ever REDUCE a receivable, never invent one** — a balance
    swing cannot make an invoice owe more than the document it was printed on.
    A postpaid invoice comes out of the view identical to what went in.
  - **IT IS A VIEW BECAUSE THE BALANCE IS A PLAIN SUM, AND THAT IS THE ONE FACT
    THE WHOLE DESIGN RESTS ON.** Balance is `topups − Σ consumedAmount` — the
    **FIFO walk only decides the covered/unpaid SPLIT**, not the total. So SQL can
    express the balance without reimplementing `lib/prepaid.ts`'s queue. Had the
    balance itself been order-dependent, this would have had to stay in TypeScript.
  - **THREE VIEWS:**
    - `v_customer_prepaid_balance` — a SQL mirror of `derivedBalanceItems`. VAT is
      `round2(amount * (1 + VAT_RATE))` **per item**, matching
      `ConsumedItem.consumedAmount`; sum-then-round disagrees by riyals.
    - `v_invoice_outstanding_live` — eleven columns, keyed by `invoice_id`.
      Allocation is a **newest-first window** so two invoices cannot both claim the
      same riyal of balance.
    - `v_receivables_open` — first nine columns byte-identical to `0098`'s, two
      appended (42P16: append only), `where o.outstanding_sar > 0`.
  - **"ABSENT MEANS ZERO" IS A PROPERTY OF THE VIEW, NOT AN ASSUMPTION AT THE CALL
    SITE.** `v_invoice_outstanding_live` emits a row for **every** confirmed,
    unpaid, non-void invoice **including the ones whose outstanding is 0.00**. So a
    miss means the invoice is paid, void or unconfirmed — all of which owe nothing
    — and each consumer's `?? 0` is a fact rather than a fallback.
    - **CONSEQUENCE, and both consumers were rewritten for it: the `if (!is_paid)`
      / `else` branch is GONE, not kept alongside.** It used to add the frozen
      figure only on the not-paid branch. Re-testing `is_paid` in TypeScript would
      be a second, weaker copy of a predicate the view already applies, and the two
      could disagree. `e.outstanding += index.get(i.invoice_id) ?? 0` is
      unconditional. **Note a prepaid invoice can now be UNPAID and owe NOTHING**,
      so paid and outstanding are not two halves of one number and are not shown
      as such.
  - **ONE SQL DEFINITION, THREE CONSUMERS. DO NOT REIMPLEMENT THE CAP IN
    TYPESCRIPT** — and a per-row TS copy could not be correct anyway, because the
    rule reads a customer's **whole invoice set in date order**, not one row.
    - `app/reports/StatementViews.tsx` (`RevenueStatement`) — joins by id, sums.
    - `lib/report-builder.ts` (customer grouping) — same join, and the builder now
      emits a second note saying the figure reflects the CURRENT balance, because
      it can move without any invoice changing.
    - `v_receivables_open` — which means the **Overview receivables KPI and the
      Dashboard's `invoice_unpaid` queue went live for free**, by composition. They
      were never threaded through `ReportsClient`, and must not be.
  - **DELIBERATELY LEFT FROZEN: `app/trips/InvoicesModal.tsx` (~line 201)** renders
    the per-invoice `amount_due_sar` in the Finance list. **That is THE DOCUMENT'S
    OWN NUMBER on a per-document row and it must keep matching the printed
    invoice.** A live figure there would make the screen disagree with the PDF the
    customer holds. Same reasoning as `invoices.payment_mode` (0037) being a
    snapshot: a document records what was true when it was issued.
  - **TWO OF ELEVEN COLUMNS CROSS THE MODULE BOUNDARY.** `InvoiceOutstandingLiveRow`
    carries `invoice_id` and `outstanding_sar` only, and `page.tsx`'s `select()`
    names them rather than using `*`. The other nine (the resolved payment mode,
    the balance, the shortfall, the basis) are real and useful in SQL and render
    nowhere. **Carrying a figure nothing renders is how two versions of one number
    start to drift** — the `DailyOps.revenue` lesson (`3638707`), and the glossary's
    six description columns travelling unread for a year, which `noUnusedLocals`
    could not catch because it does not see an unused object FIELD. Widen it when a
    consumer needs a column, not in advance.
  - **FAILED-READ HAZARD, stated where it lives rather than hidden.** An errored
    fetch degrades to an empty array, an empty index makes every outstanding read
    0, and that **UNDERSTATES receivables** instead of erroring.
    `outstandingLiveRes.error` is in `page.tsx`'s error chain and the page renders
    its banner, which is the same bargain every other read on that page makes.
    **If outstanding ever gets a surface that renders without the page-level
    banner, it needs its own could-not-read state** — a receivable quietly reading
    zero is the Dashboard's "a failed read must never claim an empty queue" in
    another costume.
  - **VERIFIED LIVE by the architect before the app half was written**, six blocks
    green:

    | invoice | mode | frozen | live |
    |---|---|---|---|
    | `026-000009` (`de4b1ffc`) | prepaid | 4,243.50 | **0.00**, basis `live_prepaid_balance` |
    | `026-000002` (`e958b840`) | postpaid | 3,795.00 | **3,795.00**, unchanged |

    `v_receivables_open` moved 2 rows / 8,038.50 → **1 row / 3,795.00**. Zero cap
    violations, zero double-count, all three views `security_invoker` and
    anon-locked. **View posture 44/44 → 46/46** (two new; `v_receivables_open` was
    replaced, not added).
  - **`0137` FAILED ITS FIRST APPLY ON 42P16's TYPE FACE** — see §6, which was
    corrected because of it. `least()`/`greatest()` returns bare `numeric` where
    the replaced column was `numeric(12,2)`.
  - **ORDERING: the migration went FIRST here, unlike `0132`/`0133`.** A PostgREST
    select naming a view that does not exist returns **400**, so the app half had
    to wait for the views. A DROP runs the opposite way — app refs stripped first.

- **YOU CANNOT ARCHIVE AWAY A DEBT — migration `0139` (applied by the architect)
  plus commit `2c9103e` (the whole app half).** Three parts that are one feature:
  **THE BLOCK** (archiving is refused while money is owed TO US), **THE RETURN** (a
  prepaid customer in CREDIT *is* archivable, and the leftover is money WE owe THEM,
  paid back as a real outbound payment), and **THE WRITE-OFF** (a manager may force
  the archive with a REASON — not a bypass, a decision: the debt is written off,
  zeroed and attributed). **NOTHING HERE INVENTS A NUMBER** — every figure is read
  from an existing view and frozen. Composes on `0137`'s `v_customer_prepaid_balance`
  and extends its `v_invoice_outstanding_live`, which is why it reads in sequence
  directly after the entry above.
  - **THE SIGN CONVENTION IS THE LOAD-BEARING IDEA. Learn it before reading anything
    else in this entry:**

    | `amount_payable_sar` | meaning | archive |
    |---|---|---|
    | **< 0** | money owed **TO US** | **BLOCKED** |
    | **= 0** | settled | allowed |
    | **> 0** | credit we owe **THEM** | allowed, return offered |

    **THE BLOCK IS EXACTLY "Amount Payable IS NEGATIVE", FOR BOTH MODES.** Turki
    stated it as two rules (one for prepaid, one for postpaid) because he states
    owed as a positive quantity; they are **the same rule** once the sign is fixed,
    and collapsing them to one expression is the point — **two expressions of one
    rule is two things that can drift.** `owed_sar = greatest(0, -amount_payable_sar)`
    is published alongside it purely so Turki's reading of "owed" has a column of its
    own; it is derived, never a second source.
  - **THE POSTPAID ARM IS A DECLARED SECOND EXPRESSION OF A MONEY RULE, AND IT IS
    DECLARED AS ONE.** The prepaid side **COMPOSES** on `0137`'s
    `v_customer_prepaid_balance` (itself the declared SQL mirror of `lib/prepaid.ts`)
    — not copied, not touched. Postpaid has **no SQL home**: the Finance tab computes
    it in TypeScript from `derivedBalanceItems([], …)`, so `0139` expresses it in SQL
    for the first time. **The five conventions it must copy exactly, or it is
    wrong:**
    1. VAT-inclusive **rounded PER ITEM** (`round(amount * 1.15, 2)` then summed —
       never sum-then-round).
    2. A trip counts only once `delivered_at is not null`.
    3. Priced `coalesce(trips.rate_sar, projects.rate_per_trip_sar)` — the frozen
       rate first (`0128`).
    4. A trip reaches its customer through **`projects.customer_id`**.
       `trips.customer_id` is NULL on every row and **must never be used here**.
    5. "Not paid" means the invoice is not `status='paid'` — draft/review/confirmed/
       void still owe. A special charge counts on a non-void invoice and stops when
       paid.

    **IF ANY OF THOSE CHANGE IN `lib/prepaid.ts` OR IN `FinanceTab.tsx`, THEY CHANGE
    HERE IN THE SAME COMMIT.**
  - **THE WRITE-OFF SITS ONE LAYER ABOVE THE BALANCE, AND SUBTRACTING IT INSIDE
    `v_customer_prepaid_balance` WAS CONSIDERED AND REJECTED.** That view is in
    lockstep with `lib/prepaid.ts`, which has no write-off concept — changing one
    without the other is the exact drift `0137`'s header forbids. So the two
    questions stay separate views:
    ```
    "What did this customer actually consume?"  -> v_customer_prepaid_balance
    "What do they still owe us?"                -> v_customer_amount_payable
    ```
    A written-off customer is **ALWAYS** an archived one — the write-off row is
    inserted in the same transaction as the archive stamp, and nothing else can
    insert one.
  - **RECORDING IS NOT DEDUCTING, AND THEREFORE THE MARK IS LOAD-BEARING.**
    `customer_balance_returns` is **NOT A TOP-UP AND MUST NEVER BE READ AS ONE.**
    `v_customer_prepaid_balance` does not subtract it; `lib/prepaid.ts` does not know
    it exists; **nothing in the balance chain reads that table.** The customer's
    balance figure is deliberately UNCHANGED after a return. Because the figure does
    not move, **a positive balance next to no mark means "we still owe this" and the
    same figure with a mark means "already paid back" — a returned balance shown
    bare is a FALSE LIABILITY.** Do not "finish the job" by writing a negative
    top-up: that double-counts against a balance that was already correct.
    - **`BalanceWithMark` (`app/archive/ArchiveCustomerTab.tsx`) is the ONE component
      that renders figure-plus-mark**, used by both the Soft-deleted table cell and
      the detail block, so the two surfaces cannot disagree. **Any new surface showing
      this balance uses that component; do not render the figure bare anywhere.**
  - **THE AMOUNT IS NOT A FIELD AND MUST NEVER BECOME ONE — on either side.**
    `return_customer_balance()` reads it from `v_customer_amount_payable` and freezes
    its own copy into the row; **the caller does not get to name the amount.** A
    number typed into a form would be a second opinion about a figure the database
    already holds, and the only outcomes of a disagreement are paying back the wrong
    sum or recording a return that does not match what was paid.
    `ReturnBalanceModal.tsx` therefore **SHOWS** it — read-only, from the same view
    row the table behind the popup renders — so the person handing over the money can
    check it, without being able to change it. Same rule stated in three headers
    (the modal, `lib/actions/finance.ts`, the migration) on purpose.
  - **FIVE OPEN QUESTIONS, EACH DECIDED IN THE MIGRATION. Do not re-litigate without
    reading its header:**
    - **Q1 — UNKNOWN PAYMENT MODE FAILS CLOSED.** A customer resolving to no single
      `payment_mode` is treated as POSTPAID, so unpaid delivered work still blocks.
      `0137` set the precedent in the other direction (unknown keeps the FROZEN
      figure) and the principle is the same one: **never suppress a debt we cannot
      prove is settled.**
    - **Q2 — THE GUARD IS CUSTOMER-WIDE; THE FINANCE TAB'S COLUMN IS NOT.** The tab
      resolves ONE project and reads page-filtered trips; this view sums every
      project including archived ones. Measured at apply time: **3 such trips exist
      (1,035.00, customer "Turki 1", already archived, `payment_mode` null)** and
      **0 customers have more than one active project**, so the two agree on every
      live row today. Deliberate — the guard should be the conservative one.
    - **Q3 — ONE RETURN AND ONE WRITE-OFF PER CUSTOMER**, enforced by unique indexes.
      **Partial returns are NOT supported by design:** allowing them would mean the
      "Returned" mark needs an amount comparison rather than an existence check, and
      the mark is what the whole feature rests on.
    - **Q4 — "MANAGER" IS NOT ENFORCED, BECAUSE THIS APP HAS NO ROLE GATE.** The
      override is available to any authenticated user AND FULLY ATTRIBUTED — reason
      NOT NULL and non-blank (`check (btrim(reason) <> '')`, so the DATABASE refuses
      a blank one rather than trusting a form validator), actor, timestamp.
      **The audit trail is the control.** If a real role gate lands later it goes in
      the RPC and nowhere else. Parked with the same RBAC pass everything else is.
    - **Q5 — `0019`'s `archive_project()` WAS AN UNGUARDED BACK DOOR. CLOSED —
      migration `0140`, applied and committed (`e42c233`).** A function's argument
      list cannot change under create-or-replace, so the guarded version had to be a
      new name rather than a replacement, which left the old two-line archive
      callable and able to archive a debt away. It was the one thing about `0139`
      that was not self-contained; it is now. `archive_project_guarded(uuid, text,
      text)` is the ONLY archive path that exists in the database. See the `0140`
      entry below for why the file was still required even though the function had
      already gone missing from production.
  - **WHY AN RPC AND NOT APP CODE:** this is a data-integrity rule, not a UI
    courtesy, and **PostgREST runs each statement in its own transaction** — an
    app-side pair could half-apply and leave either a debt archived with no
    write-off, or a write-off against a customer that is still active.
    `archive_project_guarded()` reads `archive_blocked`, `owed_sar` and
    `payment_mode` from the view; **if that function ever grows its own arithmetic,
    that is the bug.**
    - **`errcode = 'check_violation'` → PostgREST `error.code === "23514"` is the
      app's branch condition** (`const CHECK_VIOLATION = "23514"` in
      `app/trips/actions.ts`). **Branch on the code, never on the message text.**
    - The raised message carries the figure already formatted
      (`to_char(v_owed, 'FM999,999,990.00')`) **because the caller has to show it
      and re-deriving it app-side would be a second answer to the same question.**
    - The write-off insert uses `on conflict (customer_id) do nothing` so a retry is
      idempotent; the archive stamp is guarded on `archived_at is null` so a
      double-archive is a true no-op. Trips are intentionally untouched (`0019`).
  - **`v_receivables_open` DROPS WRITTEN-OFF INVOICES BY COMPOSITION — no second
    edit.** `v_invoice_outstanding_live` gained ONE case branch: a written-off
    customer's confirmed-unpaid invoices report `0.00` on basis `'written_off'`, and
    `v_receivables_open`'s own `where outstanding_sar > 0` filters them out for free
    — the same ride `0137` got.
  - **42P16 discipline, since this replaced a view on the money path:** no column
    added, removed, reordered or renamed, and types were verified with
    `format_type(atttypid, atttypmod)` on `pg_attribute` — **NOT `pg_get_viewdef`,
    which does not show a resolved type** (§6). `outstanding_basis` is now cast
    **`::text` explicitly** (it was three bare literals resolving by inference) so a
    future branch cannot quietly shift the column type and cost another apply cycle.
  - **Objects added:** `customer_write_offs` and `customer_balance_returns` (both
    `customer_id` UNIQUE + `on delete restrict`, both with the amount FROZEN by the
    RPC and **never recomputed afterwards** — re-deriving it later would silently
    rewrite the size of a decision someone signed their name to); the **PRIVATE**
    `balance-return-proofs` bucket (one-bucket-per-proof-type, the `invoice-proofs`
    /`special-charge-images`/`topup-proofs` precedent, app-generated key
    `${customerId}/return-${Date.now()}.${ext}`, **never the raw filename**);
    `v_customer_amount_payable` (18 columns, mode resolution a **byte-copy of
    `0134`'s `pay_invoice()` guard** — `count(distinct payment_mode) = 1` else NULL —
    and `archive_blocked` published **as a column** so the RPC, the UI and any future
    reader all ask the same question of the same expression); and the two RPCs.
    - `customer_balance_returns_bank_transfer_proof_check` is **byte-equivalent to
      `customer_topups_bank_transfer_proof_check` (`0040`)** — a transfer carries a
      reference AND a photo of it; cash keeps both optional-but-recorded. **Neither
      direction of money can be recorded to a weaker standard than the other**, and
      that rule is now stated in three places (the CHECK, the server action, the
      modal's `canSubmit`) so the button is never enabled into a refusal.
    - `return_customer_balance()` enforces its preconditions **in the function, not
      in a form**: the customer must be ARCHIVED (a return is the closing act of an
      archive, not a routine withdrawal), the credit strictly positive, one return
      per customer. First three raise `check_violation`, the fourth
      `unique_violation`. It ends by writing **NO BALANCE** — if a future edit adds
      an update to `customer_topups` or any balance source there, it is wrong.
  - **VIEW POSTURE MOVED 46 → 47** — `v_customer_amount_payable` is the only
    addition; the other two were replacements. **Re-measured live 2026-08-19:
    47 views / 47 security_invoker / 0 anon-readable**, and §6's standing line was
    updated to match. That line has now gone stale three times, which is exactly why
    it says *the two counts matching is the check, not the number* — re-measure with
    §6's own query rather than trusting either figure.
  - **THE APP HALF — commit `2c9103e`, 8 files, tsc clean.** Every archive call site
    is on the guarded RPC; nothing calls `archive_project()` any more.
    - `app/trips/actions.ts` — `archiveProject(projectId, overrideReason?)` calls
      `archive_project_guarded`, returns `{ error, blocked? }`, branches on `23514`.
    - `app/trips/ProjectModal.tsx` — danger-zone override flow: the block message
      arrives from the RPC (carrying the figure), and the force-archive button is
      double-gated on `overrideReason` being non-blank.
    - `app/archive/page.tsx` — fetches `v_customer_amount_payable` naming its
      columns **explicitly** (not `*` — the "carrying a figure nothing renders" rule),
      coerces the three numerics at the server boundary (`numeric` arrives as a
      STRING), and adds the fetch to the page's error chain.
    - `app/archive/ArchiveCustomerTab.tsx` — the Soft-deleted sub-tab, the
      `BalanceWithMark` component, the "Balance to return" column, and the two detail
      blocks (balance-to-return + write-off audit). The Return launcher is gated
      `!!payable && payable.amount_payable_sar > 0 && !payable.balance_returned`.
    - `app/archive/ReturnBalanceModal.tsx` (new) — mirrors `AddBalanceModal` shell for
      shell, minus the amount. **The payable row is resolved at the MOUNT in
      `ArchiveClient`, not captured by the launcher** — otherwise the popup could show
      a figure that `router.refresh()` has since moved. The reset effect keys on
      `[open, customer]`, not `[open]`: this launches from a table of many rows and a
      method left over from the previous customer is exactly the carry-over nobody
      re-reads before pressing the button.
    - `lib/actions/finance.ts` — `returnCustomerBalance(formData)` (no amount read
      anywhere in it) and `getBalanceReturnProofSignedUrl(customerId)`, keyed by
      CUSTOMER because the return row is unique per customer. It lives beside
      `recordTopup` rather than in `app/archive/actions.ts`, whose own header states
      that file holds **no RPC, only single-table CRUD** — this one reads a view,
      enforces preconditions and freezes a figure inside one RPC, which is the
      opposite of that rule and the same shape as the top-up above it.
      **`getBalanceReturnProofSignedUrl` has NO caller yet, deliberately** — the modal
      has no history list to view a proof from. It is for a future viewer, not dead
      code.
    - `lib/db-types.ts` — `CustomerAmountPayableRow` (the 11 columns the app actually
      reads).
  - **NOT YET VERIFIED IN-BROWSER — nothing in this feature has been clicked
    through.** `2c9103e` is pushed ahead of Turki's check, which inverts §5's normal
    order and is recorded here for that reason. **Two things to exercise:** the block
    message + override on a project with money owed, and the Return flow on the one
    prepaid customer in credit. Measured at apply time, Amount Payable for the six
    active customers was:

    | customer | mode | amount payable |
    |---|---|---|
    | TEST 111 Co. | postpaid | −20,056.00 |
    | Turki Contraction Co. | postpaid | −38,295.00 |
    | VVV CO. | postpaid | −46,460.00 |
    | MMM construction Co. | prepaid | −48,290.00 |
    | Seder Facility mang. Co. | prepaid | −55,274.00 |
    | **Seder Facility Mang. Co.** | prepaid | **+11,895.00** ← the one in credit |

    **Those are APPLY-TIME figures, not standing expectations** — they move with
    every delivery and invoice, same caveat as `0122`'s. The return rehearsal is the
    migration's own block G: **`balance_sar` must be IDENTICAL before and after**,
    only `balance_returned` may change, and a second call must raise "already been
    returned".

- **THE UNGUARDED BACK DOOR IS CLOSED — migration `0140`, applied clean, commits
  `e42c233` (the migration) and `35d0946` (the stale comment it left behind).**
  `drop function if exists public.archive_project(uuid)` — `0139`'s Q5, the one thing
  that entry flagged as not self-contained. `archive_project_guarded(uuid, text,
  text)` is now the only archive path the database has.
  - **THE PREMISE WAS WRONG, NOT MERELY STALE, AND MEASURING IT FIRST IS THE ONLY
    REASON THAT WAS FOUND.** §7 and the handoff both asserted the function "IS STILL
    IN PLACE". Measured live before drafting: `public.archive_project(uuid)` was
    **ALREADY ABSENT**, and the only `archive_project*` routine in the database was
    the guarded one. It had been dropped out-of-band at some point after `0139` —
    **no migration on disk removed it.** This is the THIRD time a long-standing §7
    note has turned out wrong rather than out of date (the Kanban entry was the first,
    `payment_model` the second). **Re-measure the premise before executing on it.**
  - **THE FILE WAS STILL REQUIRED, AND THAT IS THE WHOLE POINT — a drift like this is
    an argument FOR writing the migration, never for waving it off as already done.**
    Migration history on disk is the RESET PATH: replaying from scratch runs `0019`,
    which **RECREATES** the back door, and nothing downstream removes it. Without this
    file a database reset silently reintroduces the hole `0139` was written to close —
    the same class of problem as the applied-but-uncommitted `0101`. `if exists` makes
    it idempotent: **a no-op against production today, a real drop on every replay.**
    - `0019` is wrapped in a single `begin`/`commit`, so it was all-or-nothing, and
      its other artifacts (`projects.archived_at`, `customers.archived_at`,
      `projects_active_idx`, `customers_active_idx`) are all still present — which is
      what proves the function was created and later removed rather than never made.
    - **IT IS NOT COMMENT-ONLY** (`0138`'s lesson — a comment-only migration replays
      as a no-op). The drop is real DDL, and a `do $$` block asserts BOTH halves of
      the end state in the same run: the bare name at **0** signatures (an overload
      with a different argument list would still be an unguarded back door — the
      `0038` one-signature rule) and `archive_project_guarded` at **exactly 1**.
      **A drop that silently took out the wrong function would otherwise look
      identical to a successful one.** No revoke footer is needed: dropping a
      function drops its privileges with it.
  - **ORDERING — app half first, the DROP direction.** Same as `rating`/`0132` and
    `incidents_12mo`/`0133`: a PostgREST call naming a function that no longer exists
    fails outright, so dropping first would have broken archiving the instant it
    applied. `2c9103e` had already moved every call site, so there were no refs left
    to strip — a bare drop. `35d0946` fixed the one thing that went stale on apply:
    `app/trips/actions.ts`'s comment still said the old function existed and a drop
    was scheduled.
  - **GREP TRAP, and it is the `fill_cost[^_]` trap in a new costume:**
    **`archive_project` MATCHES `archive_project_guarded`**, so any sweep for the bare
    name must exclude the guarded one or it reports the replacement as the thing it
    was meant to find. Two other false negatives cost time in the same session and are
    the same shape as the recorded wrong-directory grep: **zsh expands an unquoted
    `--include=*.ts`** and kills the command, returning EMPTY output that reads as a
    clean sweep; and **`grep` is case-sensitive by default**, so `drop function` alone
    cannot prove no `DROP FUNCTION` exists on disk. **An empty result is only evidence
    once you know the command ran.**

- **AMOUNT PAYABLE HAS ONE AUTHORITY, AND IT IS TYPESCRIPT — `app/trips/amountPayable.ts`,
  commit `629a1a9`.** The rule was written inline in `FinanceTab.tsx` for the Finance
  tab's Amount Payable column (`a69a06d`); the project Breakdown report now shows the
  same figure, and `BreakdownReport` is not inside `FinanceTab` — it is rendered by
  `CustomersTab`, a sibling under `TripsTabs` — so the value could not simply be read
  across. The rule moved to a leaf module that imports nothing from either caller
  (only `lib/prepaid` and `lib/db-types`), imported ONE WAY by both. **Same shape and
  same reason as `DeliveriesReportBand` (`b0c386c`)**: two siblings importing one leaf
  cannot form a cycle, which is the trap already recorded under Inventory Phase 4.
  - **THE CORRECTION THAT PRODUCED THIS ENTRY.** `.planning/AQUAFLEET-HANDOFF.json`'s
    `next_action` carried the rule **BACKWARDS** — "`v_customer_amount_payable` IS THE
    SINGLE SOURCE for Amount Payable — any second surface showing that figure reads
    that view and never recomputes it a second way." **`a69a06d` deliberately REJECTED
    fetching that view**, and item 3 shipped TypeScript-side. The view (`0139`) is a
    **RECONCILIATION MIRROR**, exactly as `v_customer_prepaid_balance` (`0137`) is a
    declared SQL mirror of `lib/prepaid.ts` — a mirror is not an authority.
    **A NEW SURFACE SHOWING THIS FIGURE IMPORTS `amountPayable.ts`. IT DOES NOT FETCH
    THE VIEW.** Putting a second computation of this number on a screen is the exact
    thing `a69a06d` rejected.
  - **This is also §5's own failure mode, and it is the reason for this entry:** the
    JSON is a POINTER to §7, never the record itself. A rule that lives only in the
    JSON can go stale and actively wrong with nothing to check it against — this one
    had, for two commits.
  - **IT REUSES `derivedBalanceItems`; THERE IS NO ARITHMETIC IN THE FILE.** Prepaid =
    the running balance (top-ups minus VAT-inclusive consumption), so the uncovered
    part is exactly its negative side. Postpaid = `derivedBalanceItems([], …)` over the
    slice that has not been PAID FOR — credits-minus-debits with the credits side
    empty — which reuses `consumingItems()`'s delivered-only filter and per-item
    rounding rather than restating either. **Drafting, reviewing or confirming an
    invoice does not reduce it; only Mark Paid does.**
  - **SIGN IS THE MEANING, and it matches `0139`'s table exactly** — negative = owed to
    us, zero = settled, positive = credit the customer holds (prepaid only; a postpaid
    customer has no pool and can never compute above 0). Renderers read the sign and
    add nothing of their own. **Null** (no project, or `payment_mode` unset on a legacy
    pre-`0025` row) renders an em dash — guessing at a receivable is what `0137` exists
    to prevent.
  - **PERIOD-INDEPENDENT BY CONSTRUCTION.** Nothing in the file takes a month or a date
    window. The Breakdown box therefore sits beside month-scoped figures and **says so
    on screen** — a month-sliced payable is a different number from the one the Finance
    column renders, so it must never be "fixed" by slicing the inputs.
  - **`prepaidBalance` IS A REUSE HATCH, NOT A SECOND FORMULA.** FinanceTab already
    computes the running balance for its KPI and its over-balance banner, so it passes
    it in rather than computing the identical figure twice per row. Both paths are the
    same call with the same inputs. **A caller passing a DIFFERENT number there is
    misusing it.**
  - **PROVEN READ-ONLY BEFORE THE COMMIT LANDED, both halves.** (1) The extracted rule
    equals the pre-refactor `FinanceTab` logic line-for-line in behaviour — same
    branches, same prepaid-balance source, same sign, same rounding — so the Finance
    column is unchanged. (2) The Breakdown box reads the SAME slices the column does
    for all three inputs: `TripsTabs` hands the same array references to both branches,
    so there is no second fetch and no exclusion rule that could differ. **Trips are
    project-scoped on BOTH paths; topups and charges are customer-wide on BOTH paths**
    — that asymmetry is a property of the rule (invoices, topups and charges carry
    `customer_id`, never `project_id`, per `0025`), not a divergence between surfaces.
    The one shape difference is inert: FinanceTab projects topups to five fields while
    the report passes whole rows, and `derivedBalanceItems` reads only `amount_sar`.
  - **DEFERRED, LOGGED NOT FIXED — the TypeScript multi-project resolution FAILS OPEN
    where the SQL side fails CLOSED.** `FinanceTab.tsx` resolves a customer's project
    with `m.set(p.customer_id, p)`, so **the last project silently wins**. `0134` met
    the same ambiguity in SQL and chose `count(distinct …) = 1 else NULL`, which fails
    closed — `0139`'s view byte-copies that guard for the same reason.
    - **Unreachable today**: `projects_customer_id_unique` (`0015`, guard-wrapped,
      "Business rule LOCKED") makes customer→project 1:1 at the database, and 0 live
      customers have more than one active project.
    - **If `0015` is ever lifted** — and multi-project customers with separate finance
      is already a named deferred Finance item, so this is a scheduled change and not a
      hypothetical — the Finance column would net a customer's WHOLE topup and charge
      history against ONE arbitrarily chosen project's trips, while each project's
      Breakdown box nets it against its own. **Two boxes, one column, three numbers,
      no error.**
    - **The fix is a fail-LOUD TS guard, landing in the same commit as whatever lifts
      `0015`** — not a second arbitrary choice, and not a quiet null.

- **Deferred:** Route Optimization (`preview/map.js`), stored-status column cleanup
  migration, Predictive, IoT. (Archive and Maintenance are BUILT — see their own
  entries above; the old "Archive deferred / preview/archive.js is the spec" note
  was stale and has been removed. `drivers.incidents_12mo`'s drop was ALSO on this
  list — it is no longer deferred, `0133` is applied and verified; see the Staff
  cleanup entry above.)
  - The DROP migration retiring `0019`'s `archive_project()` was on this list and is
    **no longer deferred — `0140` is applied, verified and committed**, so nothing
    on the list above is scheduled-but-undone. See the `0140` entry above (it closes
    `0139`'s Q5, and its premise turned out to be wrong rather than merely stale).
- **Deferred — Consumption:** customer archive documents as a schema question
  (`customer_id` on `archive_documents`) was raised at Archive Phase 3 and not
  decided; an optional UNIQUE on `drivers.iqama_number` / `staff.iqama_number` /
  `trucks.vehicle_registration` was discussed and deliberately not added. (Reports is
  a separate top-level page and is now BUILT — see its own entry above; the old
  "still the thin placeholder it always was" note was stale and has been removed.)
- **Roadmap order:** Trips → Maintenance → Inventory → Archive → Consumption →
  Reports (all done) → Route Optimization → Predictive → IoT (last three deferred).
  **Every page in the roadmap that is not deferred is now built.** The Dashboard was
  never on this list — it was a mock-data placeholder that survived every phase — and
  was rebuilt last, on top of the Reports semantic layer (see its own entry above).
