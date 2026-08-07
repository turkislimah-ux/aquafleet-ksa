# CLAUDE.md — AquaFleet KSA (Bousla / بوصلة)

**Read this file first, every session, before doing anything else.** It defines how
we work on this project. It changes rarely. For *current state* (what's built, what's
next), read **§7 below** — that is the durable record — then `.planning/HANDOFF.json`
and recent `git log` for the short version. If the JSON and §7 disagree, §7 wins: the
JSON is auto-tool-owned and gets blanked periodically (see §5).

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
  uses gsd's schema and is now POPULATED by hand (it was all-null until 2026-08-07),
  but gsd itself still is not driving this project — `phase`/`plan`/`task` stay null
  deliberately, because we do not run gsd phases and inventing a phase number would
  be fiction. **Before leaning on gsd, report how it fits with this project's existing
  workflow (preview/-as-spec, the commit discipline below, HANDOFF.json) so we adopt
  it deliberately, not blindly.**

- **Domain rules (money, stock, RPCs, invariants)** → read
  `.claude/skills/aquafleet-domain/SKILL.md` at session start. This encodes
  business logic constraints (FIFO invariant, money-core boundary, one-SKU-one-
  warehouse, RPC conventions, counter-table pattern) that CLAUDE.md does not cover.
  **Read it before any migration, RPC, or server action work.**

---

## 5. Workflow discipline (non-negotiable)

- **One logical unit per commit.** Each commit tsc-clean.
- **Explicit-path `git add`** — list each file. **NEVER `git add .`**
- **HANDOFF.json — the root one IS committed; `preview/`'s stays UNSTAGED.**
  `.planning/HANDOFF.json` is committed as a deliberate SNAPSHOT (Turki's call,
  2026-08-07). `preview/.planning/HANDOFF.json` is never staged — it lives inside
  the read-only `preview/` tree and carries stale auto-tool content.
  **READ THIS BEFORE STAGING THE ROOT ONE.** That file is owned by an auto-tool
  (`"source": "auto-postool"`) which rewrites it back to the EMPTY template after
  tool calls — it did exactly that seconds after the snapshot was written, and the
  committed copy survived only because it had been staged first. So:
  - Write the content, then `git add` it **immediately**, then commit. A gap
    between writing and staging is a window for the tool to blank it.
  - **Never `git add .planning/HANDOFF.json` reflexively** — if the tool has run
    since, you will commit the empty template straight over real content and lose
    it silently. Check `git diff --cached` shows the rich version before committing.
  - After committing, `git checkout -- .planning/HANDOFF.json` so the working tree
    matches HEAD instead of showing a permanent phantom modification.
  - It will drift again on the next tool run. That is expected, not a bug to fix.
  - **§7 of this file is the durable record.** HANDOFF.json is a pointer to it,
    never the other way round — do not let real knowledge live only in the JSON.
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
- **Water stations vs Operation stations are SEPARATE** (migration 0014's "do NOT
  unify" rule). Water = fill stations (trips). Operation = driver/truck/staff base.
- **`lib/project-colors.ts`** = shared id-hashed project color palette (one source,
  used across Trips/Kanban/pills).
- **Immutable keys** on lookup tables (water_stations.key) — rename updates name only.
- **`todayKey()` / local-date helpers** for Riyadh — avoid UTC skew in date logic.

---

## 7. Current state & what's next

- This section IS the record. `.planning/HANDOFF.json` + `git log --oneline -20`
  give the short version, but the JSON is auto-tool-owned and periodically blanked
  (§5) — anything that matters belongs here, not only there.

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

- **Finance/Invoice PRD** is committed at `.planning/finance-invoice-spec.md` —
  **COMPLETE end-to-end, through commit `0562d2a`.** Data model (migration `0025`),
  project popup + `payment_mode` (migration `0026`), Finance tab, prepaid ledger,
  covered/unpaid engine, VAT, invoice lifecycle (migration `0027`) + reserve-at-draft
  and paid-invoice lock (migration `0030`), full UI (draft/review/confirm/pay/void,
  print, mailto) — **both prepaid and postpaid modes**, customer/company email
  templates (migrations `0028`/`0029`), and bilingual (EN/AR) PDF export (`lib/pdf.ts`,
  `lib/invoicePdfTemplate.ts`, migration `0031` — `invoice-pdfs` bucket). All
  money-logic harnesses green.
  - **Remaining setup (not code — runtime config):** PDF export code is done but
    needs a **PDFShift account + `PDF_API_KEY`** in `.env.local` (Turki's action)
    before real PDF output can be verified. Until then, Download PDF shows a graceful
    "PDF service not configured" message.
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
    double-deduct). Postpaid keeps cash/bank+proof. Known limitation: stored
    `payment_method` is `'cash'` under the hood — no `'balance'` enum value without a
    migration.
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
  - **Deferred related:** real `payment_method='balance'` enum for prepaid reporting.

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

- **Deferred: `payment_mode` reconciliation.** Finance Commit 1 added
  `projects.payment_mode` (`postpaid|prepaid`) as a new, additive column — it did NOT
  touch the legacy `customers.payment_model` (`postpaid|pay_as_you_go`, `NOT NULL`
  default, wired into `CustomerForm.tsx`/`app/customers/actions.ts`/`lib/db-types.ts`),
  to avoid a breaking change to an actively-used column outside that commit's scope.
  Turki confirmed `pay_as_you_go` ≈ `prepaid` (same concept) — so reconciling the two
  is a clean concept-merge, not resolving two different things. Do this next time
  customer app code is touched.
- **Deferred:** Route Optimization (`preview/map.js`), stored-status column cleanup
  migration, Predictive, IoT. (Archive and Maintenance are BUILT — see their own
  entries above; the old "Archive deferred / preview/archive.js is the spec" note
  was stale and has been removed.)
- **Deferred — Consumption:** Reports remains a separate top-level page and is still
  the thin placeholder it always was; customer archive documents as a schema
  question (`customer_id` on `archive_documents`) was raised at Archive Phase 3 and
  not decided; an optional UNIQUE on `drivers.iqama_number` / `staff.iqama_number` /
  `trucks.vehicle_registration` was discussed and deliberately not added.
- **Roadmap order:** Trips → Maintenance → Inventory → Archive → Consumption (all
  done) → Reports → Route Optimization → Predictive → IoT (last three deferred).
