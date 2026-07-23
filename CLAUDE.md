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

- **Inventory is being built as the FULL demo (preview/'s Inventory page: parts +
  warehouses + suppliers + FIFO cost lots + Purchase Orders + Approvals + Financial
  Analysis), in 7 phases. Phases 1–6 of 7 are COMPLETE — only Phase 7 left.**
  - **Phases 1–3:** commits `580e135` (migrations) + `11d9239` (app code).
  - **Phase 4 (Purchase Orders core, draft->issued):** commits `dd67682`
    (migration `0050`) + `ab3008d` (app code).
  - **Phase 5 (PO receiving):** commits `3d55392` (migration `0051`) +
    `fc8005c` (app code).
  - **Phase 6 (PO Approvals):** commits `ab3a414` (migration `0052`) +
    `07c7729` (app code).
  - **Migrations `0043`–`0052`, all applied and verified:** `warehouses`/`parts`
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
    RPCs (0052).
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
  - **Remaining phase:** 7 Financial Analysis + per-part finance +
    AI-suggest-PO.
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
    (0052), not preview's persona picker.
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

- **Deferred: `payment_mode` reconciliation.** Finance Commit 1 added
  `projects.payment_mode` (`postpaid|prepaid`) as a new, additive column — it did NOT
  touch the legacy `customers.payment_model` (`postpaid|pay_as_you_go`, `NOT NULL`
  default, wired into `CustomerForm.tsx`/`app/customers/actions.ts`/`lib/db-types.ts`),
  to avoid a breaking change to an actively-used column outside that commit's scope.
  Turki confirmed `pay_as_you_go` ≈ `prepaid` (same concept) — so reconciling the two
  is a clean concept-merge, not resolving two different things. Do this next time
  customer app code is touched.
- **Deferred:** Archive page (restore UI for soft-deleted records — `preview/archive.js`
  is the spec; rising priority), Maintenance page (+ truck-derived-state), Route
  Optimization (`preview/map.js`), stored-status column cleanup migration.
- **Roadmap order:** Trips (done) → Maintenance → Inventory → Reports → Archive →
  Route Optimization → Predictive → IoT (last three deferred).
