# HANDOFF — AquaFleet KSA (Bousla)

Written 2026-07-27, HEAD `256d10d`. Every fact below was verified against the live repo (git log, `supabase/migrations/`, live Supabase schema via the Supabase MCP, `preview/`, `CLAUDE.md`) at write time — not recalled from memory. **Read `CLAUDE.md` first, always** — it changes rarely and defines how this project works; this file is a snapshot of *where things stand right now*, `CLAUDE.md` is the standing rulebook.

---

## 1. Project goal

AquaFleet KSA (internal name: **Bousla / بوصلة**) is a fleet-management web app built for **Bin Slimah Group**, a 50+ year-old family water-transport & treatment business in Riyadh (~40 trucks, 3 stations). Turki is the non-technical founder who directs the build and verifies every change in-browser. The app manages trucks, drivers, staff, trips, projects, commissions, leave, stations, finance/invoicing, and — as of this session — a full Inventory module.

**`preview/` is the authoritative product spec.** It's a standalone HTML/JS demo (`preview/index.html`, `pages-1.js`/`pages-2.js`, `app.css`, `data.js`, `archive.js`, `map.js`, `components.js`, `icons.js`, `i18n.js`) that defines the real design and feature set. It is **read-only** — the real Next.js app is built to mirror it exactly (markup structure, class names, hex colors, wording, field lists), pulled directly from its source, never eyeballed or reinvented. Every deviation from it in the real app is deliberate and recorded (see §4).

Stack: Next.js (App Router) + Supabase (Postgres 17) + Tailwind, TypeScript. Repo `~/aquafleet-ksa`, GitHub `turkislimah-ux/aquafleet-ksa`, branch `main`.

---

## 2. Working model & role boundaries (read this before touching anything)

This is the load-bearing convention for the whole project — stated prominently because it's the thing most likely to get crossed by a fresh session:

- **Claude Code owns ALL design, UI, and the build/dev approach**, and mirrors `preview/` faithfully. This includes layout, component structure, wording, field lists, icons, colors, spacing — every visual and UX choice.
- **The architect/reviewer's lane is DATA ONLY**: reviewing and running migrations (Turki runs them in the Supabase SQL Editor — migrations are drafted to disk and **never self-applied** by Claude Code through the Supabase MCP, except when explicitly instructed otherwise in a given turn), verifying the database (schema, live function bodies, the FIFO invariant, row counts), and surfacing data/money/scope decisions as clear multiple-choice-style questions when a real judgment call is needed. The architect does **not** spec design, name UI elements, or decide layout/wording/fields — CLAUDE.md is explicit that when the architect has interfered with design in the past, the result was worse.
- **Every migration is reviewed before running.** Each RPC ends with **exactly one live signature** — enforced via the "exact-signature `drop function if exists` immediately before `create or replace function`" pattern, every time, even when a signature is unchanged (defensive/consistent, not just reactive). Verified live via `select oid::regprocedure from pg_proc where proname = '...'` returning exactly one row.
- **The FIFO invariant — `sum(price_lots.qty_remaining) == parts.qty_on_hand` per part — is verified after every migration that touches lots.** Verified live right now, as of this write: **zero violations**.
- **Commit discipline:** one logical unit per commit; **explicit-path `git add`** only, never `git add .` or `-A`; **both `.planning/HANDOFF.json` and `preview/.planning/HANDOFF.json` always stay unstaged** (both are currently all-null/unused scaffolding from an unadopted `gsd`-style workflow — confirmed by reading `.planning/HANDOFF.json` directly). Quote dynamic-route paths with brackets in git commands (zsh globs `[id]`). Avoid `!` in commit messages (zsh history expansion).
- **The money core — `lib/prepaid.ts`, `lib/vat.ts`, `lib/invoice.ts` — is never touched by Inventory work.** Inventory has its own, deliberately separate VAT file (`lib/inventory-vat.ts`) for internal parts-cost VAT — see §4. This boundary has held for the entire build; no exceptions were made.

---

## 3. Current status: Inventory module is COMPLETE

The Inventory feature was built as the **full `preview/` demo** (parts + warehouses + suppliers + FIFO cost lots + Purchase Orders + Approvals + Financial Analysis), then extended twice beyond `preview/` itself (Direct/loose invoice approval, and the two-vote model) at Turki's explicit request — `preview/` has no Direct-invoice-approval concept at all, confirmed by reading its actual source before building anything there.

**Built, in order:**
- Phases 1–3: parts/warehouses/suppliers/FIFO price lots, Add Parts receiving flow.
- Phase 4: Purchase Orders core (draft → issued).
- Phase 5: PO receiving (mandatory invoice upload, composes on the loose-receive RPC rather than a parallel path).
- Phase 6: PO Approvals (original 2-approver, count-based model).
- Phase 7: Approvals + Financial Analysis tabs, AI-Suggest-PO, per-part finance report.
- **Full demo-vs-`preview/` audit** — a systematic pass that closed real gaps (wording, tooltips, defaults, missing fields) and separately tracked a "risky batch" of higher-stakes items.
- **"Risky batch," 5 stages** — per-warehouse scoping (a tab per warehouse, KPIs/procurement strip scoped, Approvals/Financial-Analysis stay global by design); unified PO receive with extra ad-hoc lines (migration `0055`); 7 app-only fixes (portaled modals fixing 2 real backdrop bugs, KPI scoping, required fields, warehouse-scoped part picker, draft-PO editing); quick-reorder + Approvals actual-total + supplier-contact card + auto-SKU; **VAT on parts invoices** (migration `0056` — fixed 15% ZATCA, VAT-exclusive entry, per-line rounding summed) plus a follow-up display-fixes pass.
- **Polish round** — custom stock-aware `PartPicker`, row-action icons matching `preview/` exactly, faded background tints (Turki's own call, not a `preview/` match), underline warehouse tabs, "New Purchase Order" label, AI-Suggest gradient, new "Adjust Item" action (descriptive-info edit, SKU/warehouse locked) — plus 3 follow-up rounds fixing a real CSS-cascade bug (`.card`'s plain-CSS background always beat a Tailwind tint utility at equal specificity — fixed with `!` important-modifier) and a real component-confusion bug (supplier info had landed on "+ New Item" instead of the real receiving popup).
- **Stage B — the approval/archive rework** (this session, migrations `0057`/`0058`): every receipt (Direct loose-receive OR PO-linked) is now its own approvable invoice, typed `'direct'|'po'`, with a genuine **two-vote matching model** replacing the old immediate/count-based approval — see §4 for the full model. Plus: a Direct-invoice detail popup (didn't exist before — Direct rows previously opened nothing), a votes column revert to match the prior two-dot style, reject-outcome-next-to-voter display, and a full dead-code cleanup pass afterward.

**Migrations `0043`–`0058`, all applied and verified live** (16 total): `0043` warehouses/parts, `0044` stock_movements, `0045` suppliers, `0046` FIFO price_lots, `0047` stock_receipts, `0048` supplier name_ar, `0049` units, `0050` purchase_orders, `0051` PO receiving, `0052` PO approvals (superseded but still live, see §6), `0053` AI-Suggest, `0054` data-only access grant, `0055` unified receive w/ extra lines, `0056` VAT, `0057` receipt approval + Direct invoices, `0058` two-vote model + lot-link fix.

**Recent commit hashes (verified via `git log`):**
```
256d10d  Inventory: dead-code cleanup after Stage B
659c4bc  Inventory Stage B: invoice approval, two-vote approve/reject, reject outcomes, archive-ready
16e3f02  Inventory migrations: receipt approval + two-vote model with lot-link fix (0057, 0058)
edb5dde  Inventory: supplier info on Add Part, revert New Item popup
b6721cf  Inventory polish: part-picker states, icons, color tints, warehouse tabs, Adjust Item, supplier in Add Part
d1e9d69  Inventory migration: parts VAT (0056)
```
Full history: `git log --oneline -- app/inventory/ supabase/migrations/`. Working tree is clean at HEAD except both `HANDOFF.json` files and untracked test files (see §6).

---

## 4. Key decisions and why

- **One SKU = one warehouse.** A `parts` row belongs to exactly one warehouse; there's no cross-warehouse SKU sharing. This is the hard constraint `create_purchase_order` enforces (one supplier + one warehouse per PO), and it's why AI-Suggest groups candidate parts by `warehouse_id` rather than `preview/`'s own supplier-based grouping.
- **FIFO price lots (`price_lots`) are the single stock/cost writer.** `add_price_lot()` is the only function that increments `parts.qty_on_hand` and refreshes `parts.unit_cost_sar`; every receiving path (loose or PO) funnels through it via `receive_loose_parts()`. The invariant `sum(price_lots.qty_remaining) == parts.qty_on_hand` is checked after every migration that touches lots — verified clean right now.
- **VAT stored per-line, then summed** — fixed 15% (ZATCA), unit prices entered VAT-exclusive, `round(qty * unit_price * 0.15, 2)` computed **per line** and the already-rounded lines summed for the document total. This is the deliberate *opposite* of `lib/vat.ts`'s own document-level-rounding rule for customer invoices — two genuinely different, separately-correct conventions for two different documents, not an inconsistency. `lib/inventory-vat.ts` borrows only the `VAT_RATE` constant from `lib/prepaid.ts` (a read, never a modification) and never routes through `lib/vat.ts`'s `calculateVat()`. VAT is deliberately **excluded** from: `FinancialAnalysisTab` (Spend 30d/90d, spend-by-category/supplier, AI Insights — explicitly named in Turki's own exclusion list), the KPI row's Inventory Value, `PartsTable`'s Stock Value column, the Pricing-snapshot card, and every consumption figure.
- **Two-approver rule, reused, not duplicated** — both the original PO-only approval (migration `0052`) and the newer receipt-level approval (migration `0057`/`0058`) require exactly 2 distinct eligible approvers (`staff.role in ('fleet_manager','ops_supervisor','inventory_clerk')`, checked server-side inside the RPC only, never duplicated client-side).
- **The two-vote MATCHING model (migration `0058`) — the current, correct model, replacing an earlier immediate/count-based design mid-session:**
  - Both approvers must cast the **same action**. Two approves → approved. Two matching rejects (same outcome; reason may differ) → rejected. A mismatched second vote (e.g. approve then reject) is **blocked server-side** with a clear message — nothing is written.
  - The **first vote records only** — no stock movement, no status change, regardless of which outcome was chosen. **Stock only moves on the completing, matching second reject vote.** This is the core correctness property of the whole model.
  - The sole first voter can freely change their own vote (approve↔reject, or switch reject outcome) any time before a second, matching vote lands — implemented as an UPSERT on `stock_receipt_approvals`' existing `UNIQUE(stock_receipt_id, approver_email)` key, a deliberate, narrow exception to this feature's usual append-only-ledger convention (justified because a lone vote is genuinely provisional, not yet a committed fact).
  - **Approved is final** — enforced *inside* both RPCs (`status <> 'pending_approval'` raises immediately, first check, before any vote logic runs), not just hidden in the UI.
- **Two reject outcomes**, chosen at reject time, both approvers must match on outcome (not on reason):
  - **`void_cost`** — keeps the received stock, reprices that receipt's own price lots to 0 (qty untouched).
  - **`remove_stock`** — reverses the stock this receipt added (finds "this receipt's lots" via `stock_receipt_lines.price_lot_id → price_lots`, **never** a `price_lots.stock_receipt_id` column, which doesn't exist — this was a real, confirmed-and-fixed bug in the first draft of `0057`, corrected in `0058`). **Blocked** ("already-consumed" guard) if any of that receipt's own lots show `qty_remaining < qty_purchased`, or if a `'consume'`-type `stock_movements` row exists for an affected part since the receipt was booked. Both signals are checked independently (not just re-reading the same field twice) — deliberately conservative, since `consume_from_lots` has no live caller yet (see §6) so this guard can't be exercised for real today, but is built correctly for the moment it can be.
  - The **all-or-nothing untraceable-line guard** applies to **both** outcomes (not just `remove_stock`): if any line on the receipt has a null `price_lot_id`, the whole reject is blocked, naming the part — see §6 for the current real count of affected rows.
- **Deliberate deviations from `preview/` — confirmed intentional, do NOT revert these in a future "match the demo" pass:**
  - **Adjust Stock** (manual stock-correction path) — `preview/` has no such UI (no FIFO tiers to "recount" against); this app's own addition, one entry point (drawer footer).
  - **Weighted-average cost shown to 2 decimals** — every other SAR figure in this app is whole-number; cost specifically needs the precision.
  - **Units as a first-class lookup table** with inline "+ Unit" create — `preview/` hardcodes a fixed unit list.
  - **Supplier Arabic name (`name_ar`)** — `preview/`'s own supplier form has no such field.
  - **Category stays a free-text combo** — Turki's explicit instruction, deliberately *not* moved to a lookup table the way units were.
  - **PO receiving requires `status='issued'`** — not draft-or-issued like `preview/`.
  - **Approver identity is the real authenticated session email** — not `preview/`'s persona picker (this app has real auth, `preview/` doesn't).

---

## 5. Completed work — commit-referenced summary

| Phase | What | Commits |
|---|---|---|
| 1–3 | Warehouses/parts/FIFO lots, Add Parts receiving | `580e135`, `11d9239` |
| 4 | Purchase Orders core (draft→issued) | `dd67682` (migration `0050`), `ab3008d` |
| 5 | PO receiving | `3d55392` (migration `0051`), `fc8005c` |
| 6 | PO Approvals (original model) | `ab3a414` (migration `0052`), `07c7729` |
| 7 | Approvals/Financial-Analysis tabs, AI-Suggest, per-part report | `9c3e08a`, `2aec47b`, migration `9e3f2fe`/`0053` |
| Audit + risky batch | Per-warehouse scoping, unified receive w/ extra lines, VAT, polish rounds | `e85d9c4`, `321151b` (migration `0055`), `b771816`, `7529a4e`, `d1e9d69` (migration `0056`), `f800f93`, `a648fbb`, `b6721cf`, `edb5dde` |
| **Stage B (this session)** | Receipt approval + Direct invoices, two-vote model, lot-link fix, UI fixes, cleanup | `16e3f02` (migrations `0057`/`0058`), `659c4bc` (app code), `256d10d` (cleanup) |

---

## 6. Open items / known limitations / assumptions

- **Untraceable-lines guard — VERIFY THIS COUNT, don't trust "5" at face value.** At write time, live `stock_receipt_lines` shows **24 total rows, 15 with `price_lot_id` set, 9 null** (not 5 — checked live via the Supabase MCP right now, not assumed). At least one null row is dated **2026-07-27 11:19:53**, which is *after* migration `0058` (the fix that makes `receive_loose_parts` populate `price_lot_id` going forward) was applied earlier in this same session — and cross-checking `price_lots` shows **no new lot was created for that receipt's parts at all** around that timestamp, meaning `add_price_lot` itself doesn't appear to have run for those lines. This contradicts a clean "all pre-fix" story. **Not root-caused in this session** — plausible explanations not yet distinguished: (a) that receipt's rows were seeded/edited directly in the SQL editor rather than through the real RPC (bypassing the fix entirely), or (b) a real, still-live gap in some receiving path not yet identified. **Next session: check `stock_receipt_lines` again, and if the null count is still growing on receipts created through the real app UI (not manual SQL), this is a live bug in `receive_loose_parts`/`receive_purchase_order`, not historical debt, and needs its own migration.** Whatever the true count turns out to be, the *behavior* is correct and by design: a line with null `price_lot_id` permanently blocks **both** reject outcomes for its receipt (untraceable, all-or-nothing) — approving is unaffected.
- **Dormant-by-design DB objects — do NOT remove in a future cleanup, confirmed still live:**
  - `consume_from_lots` — reserved for the Maintenance/work-orders phase (parts-usage consumption), not built yet. Zero app-code callers today, on purpose.
  - `receive_stock` — superseded by lot-based `receive_loose_parts`; its app-code wrapper was already removed as genuine dead code, but the RPC itself stays live in the DB.
  - `approve_purchase_order` / `reject_purchase_order` (migration `0052`) — superseded by the receipt-level vote model for user-facing approval, **but still live and still called directly** (via raw `supabase.rpc(...)`, not through their own now-deleted app-code wrapper functions) from inside `actions.ts`'s `approveReceipt()`/`rejectReceipt()`, to mirror final status onto `purchase_orders` once a PO-linked receipt's vote finalizes. Confirmed live via `pg_proc` at write time (exactly one signature each, present).
- **`.planning/HANDOFF.json` and `preview/.planning/HANDOFF.json`** are both confirmed all-null/unused scaffolding (read directly, not assumed) — a `gsd`-style schema was never adopted for this project's actual workflow. Keep leaving both unstaged; don't populate them without deciding to adopt that workflow deliberately first (CLAUDE.md's own explicit caveat).
- **CLAUDE.md's own §7 currently opens with an "IN PROGRESS — Kanban board redesign, uncommitted" note** (unrelated to Inventory, predates this whole session) — but `git status` right now shows a clean tree for every file that note names (`ProjectsBoard.tsx`, `tailwind.config.ts`). This looks like stale documentation that was never updated after that work actually landed in some earlier session, rather than a real loose end — worth a quick double-check + a CLAUDE.md edit to remove the stale note, not treated as active work.
- **Untracked test files currently sitting in the working tree**, not yet committed or cleaned up: `tests/inventory-approvals-fix.spec.ts`, `tests/inventory-cleanup.spec.ts`, `tests/inventory-stageb-vote.spec.ts`, `tests/inventory-stageb.spec.ts`. Each documents what was verified for its stage against a since-deleted throwaway diagnostic route (this project's established verification pattern — see CLAUDE.md §4/§7) — they will fail if re-run as-is since their routes no longer exist. Decide whether to commit them as historical documentation, rebuild permanent diagnostic infra, or discard.
- **Stray untracked file `HANDOFF_1.md`** at repo root — not created by this session's work, unexplained origin, left untouched.

---

## 7. Next steps

**Immediate next build: the Archive page.** The data is already fully ready for it — every receipt (Direct or PO-linked) already lives permanently in `stock_receipts`, typed (`receipt_type: 'direct'|'po'`), and status-marked (`'approved'` or `'rejected'`, with `rejection_mode` distinguishing `void_cost` vs `remove_stock` for the rejected ones). Nothing is hard-deleted anywhere in this feature. The Archive page's job is essentially `select * from stock_receipts where status in ('approved','rejected')`, joined to lines/PO/supplier/warehouse as needed, with real layout/filtering/organization still to be designed — **`preview/archive.js` is NOT the spec for this** (confirmed by reading it: it's a document-expiry tracker for insurance/registration/license documents, completely unrelated to invoices — a genuine, confirmed departure from `preview/`, not an oversight). This Archive page will need its own design pass from scratch.

**Broader roadmap position** (per CLAUDE.md's own stated order): Trips (done) → Maintenance (not started) → **Inventory (done)** → Reports (not started) → **Archive (next)** → Route Optimization → Predictive → IoT (last three explicitly deferred, no timeline).
