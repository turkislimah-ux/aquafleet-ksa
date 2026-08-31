# AquaFleet KSA — Domain Rules & Data Conventions

Use this skill whenever writing or modifying server actions, RPCs, migrations,
or any code that touches money, stock, invoices, purchase orders, or the data
model. These are project-specific invariants — violating any of them produces
bugs that are hard to detect and expensive to fix.

---

## Money-Core Boundary

Two files own ALL money math for the **customer-facing finance/invoice system**:

- `lib/prepaid.ts` — prepaid ledger logic (VAT-inclusive balances, FIFO trip
  coverage, reserve-at-draft, release-on-cancel)
- `lib/vat.ts` — ZATCA-compliant VAT calculation (15%, document-level rounding)

**Rules:**
- Inventory does NOT touch these files. Inventory money (unit costs, lot prices,
  PO totals) is internal/operational — no VAT, no customer ledger interaction.
- If Inventory needs its own money helpers, create a separate `lib/inventory-cost.ts`.
- Never duplicate VAT logic. If a future feature needs VAT, import from `lib/vat.ts`.

---

## Amount Payable ≠ the prepaid BALANCE — and the view ≠ the column

Three numbers here look like one number. They are not, and two of them are
deliberately allowed to disagree. Do not "reconcile" them.

**1. Amount Payable (the COLUMN)** — `app/trips/amountPayable.ts`, rendered on
the Finance tab and in the project Breakdown report. **One rule, both payment
modes:** the VAT-inclusive value of every DELIVERED trip and every non-void
special charge **not yet on a PAID invoice**. Draft / review / confirmed do not
reduce it; only Mark Paid does. **A prepaid top-up does not reduce it either** —
a pool FUNDS delivered work, it does not SETTLE it. Sign convention: negative =
owed to us, zero = settled; `<= 0` by construction, because the function passes
no credits side to `derivedBalanceItems`.

**2. The prepaid running BALANCE** — `lib/prepaid.ts`'s `derivedBalanceItems`
over UNFILTERED inputs. Deducts at DELIVERY (**Model A**, unchanged), nets
top-ups and balance returns, and drives the Running Balance column, the
over-balance banner, Settled Balance and the statement. A prepaid customer can
hold pool credit AND owe on the payable column at the same time. That is the
model, not a bug.

**3. `v_customer_amount_payable.amount_payable_sar` (the VIEW, 0139)** — for
prepaid this is **the running balance** (negative = owed), i.e. number 2, NOT
number 1. **This divergence is intentional and load-bearing:**

- `return_customer_balance()` gates a real cash refund on `amount_payable_sar > 0`
  and freezes that figure into `customer_balance_returns` (the modal has no
  amount field by design).
- `archive_project_guarded()` reads `archive_blocked` (prepaid arm:
  `b.balance_sar < 0` — blocked when NEGATIVE) and `owed_sar`
  (`GREATEST(0, -amount_payable_sar)`) off the same row.

Flip the view to the column's rule and a debtor's figure turns positive, so the
refund gate passes and **the RPC pays a customer their own debt**; `owed_sar`
also collapses to 0, so an archive override would write off nothing. **Leave the
view balance-based.** Its 0139-era "mirror of the column" framing is obsolete —
it mirrors the BALANCE.

**Rules:**
- The paid gate is ONE predicate, computed once server-side in
  `app/trips/page.tsx`: `invoiceLocked` (trips, `:265`) and `paid` (charges,
  `:362`), both off the single `.eq("status","paid")` query. Import
  `isUnsettledTrip` / `isUnsettledCharge` from `amountPayable.ts`; never restate
  the predicate.
- Never pass a balance, top-ups or returns into `computeAmountPayable`. It takes
  none — that is what makes "adding balance does not reduce it" true by
  construction rather than by discipline.
- Changing either rule means changing `scripts/amount-payable-check.ts` first.

---

## asOfDate scopes CONSUMPTION, never the POOL

The prepaid pool is a **lifetime net** — `sum(all topups) − sum(all returns)`,
no date gate — at every site that computes one: `splitCoveredUnpaidItems`,
`lib/invoice.ts`'s `startingPool`, `derivedBalanceItems`, `buildStatementItems`,
and `v_customer_prepaid_balance` (which never gated). `9c287d6` moved the
invoice engine; `dc29e26` moved the last two functions.

**`asOfDate` is a CONSUMPTION filter and nothing else.** It is load-bearing
there — `lib/invoice.ts` passes `periodEnd` to scope an invoice's consumption to
its period. Never re-gate a credit side with it: a caller passing a date would
get a balance contradicting the invoice engine, the view and the Finance KPI at
once, silently, by exactly the value of the top-ups dated after that date.

- **`buildStatementItems`' settlements filter is the one legitimate exception**
  and stays gated. A settlement is a record-only row, contributes nothing to the
  running balance, so it cannot desync the closing figure. Returns are not like
  this — a return **does** move the balance, so it cannot keep a gate the credit
  sum lacks.
- `returnedTotal(returns, asOfDate)` keeps its optional param, **passed by
  nobody**. A dormant option for a future report, never for a pool.
- Guarded by `scripts/prepaid-check.ts` and `scripts/covered-unpaid-check.ts`.
  Both hold inverted cases that assert the gate's ABSENCE — they were rewritten
  rather than deleted precisely so a re-gating fails loudly.

---

## Duplicate customer info is ALLOWED — do not add a uniqueness or merge guard

**Two customer records may legitimately share an identical name, VAT number and
CR number** when they serve different projects. Each holds its **OWN separate
prepaid pool** and its own invoices; they are distinct counterparties for money
purposes and only coincide on their identity fields.

So: **do NOT add a VAT/CR uniqueness constraint, and do NOT add a dedupe or
merge guard on `customers`.** Either would block a valid case, and merging two
such records would silently pool two balances that must stay apart.

A matching placeholder VAT/CR is expected, not a data-quality defect — the two
"Seder Facility mang./Mang. Co." records (sharing VAT `123456789012345`, CR
`1234567890`) are this pattern, and are why the DB reads as 3 prepaid customers.

---

## Frozen invoice splits diverging from a re-derivation is EXPECTED

**Do not re-investigate this as a live bug.** Widening the pool changed what a
*re-derivation* of the covered/unpaid split returns, but not one stored figure.

**Measured live 2026-08-31:** 8 already-issued prepaid invoices (5 paid,
1 confirmed, 2 void) re-derive a split differing from their FROZEN split —
13,524.00 SAR would move Unpaid → Covered, of which 7,831.50 is already
collected. **2 of the 8 were already divergent BEFORE `9c287d6`**, so the pool
change is not the sole cause and "revert it" would not close it.

**Why this is not a defect:** confirmed / paid / void invoices render and print
from the frozen `covered_lines` / `unpaid_lines` jsonb and the stored total
columns (0027's freeze law) — `invoiceActions.ts:1035` reads them verbatim, and
no user-facing view re-derives an issued invoice. No document drifts. Only
draft and review recompute live, which is the point of freezing at confirm.

**Treatment: LEFT as-is** (Turki, 2026-08-31). The freeze rule is correct as
issued; no data was touched. The one live item is `026-000009`, confirmed and
unpaid at 4,243.50 SAR.

These counts are a dated measurement, not durable law — **re-measure before
quoting them.** The durable part is the rule above it.

**Re-measure with `npx tsx scripts/frozen-split-check.ts`**, which exists so this
stops being rebuilt from a throwaway script. It PRINTS the count/SAR (never
asserts them) and ASSERTS the durable half: **an invoice carries a frozen split
if and only if it is issued.** Note it reports **10 / 28,474.00 SAR**, not the
8 / 13,524.00 above — a METHOD difference, not new data: it re-derives void
invoices too, whose lines were released back to the pool, so they re-derive to
nothing and book their full stored `amount_due`. Neither figure changes the
ruling. Read its per-invoice lines, never the total alone.

---

## Invoice & PO Numbering — Counter-Table Pattern

Gap-free sequential numbers use a dedicated counter table + a function that
locks the row with `FOR UPDATE` and increments atomically. The counter rolls
back if the transaction fails — truly gap-free.

- `invoice_number_counter` + `next_invoice_number(year)` — invoices (0034)
- `po_number_counter` + `next_po_number(year)` — purchase orders (0050)

**Rules:**
- NEVER generate numbers client-side (count+1 is a race condition).
- Any new numbered document type gets its own counter table + function.
- The function must lock the counter row `FOR UPDATE` before incrementing.

---

## RPC Conventions

Every Supabase RPC in this project follows these rules:

1. **Exactly ONE signature per function.** Before `CREATE OR REPLACE`, always
   `DROP FUNCTION IF EXISTS function_name(exact_arg_types)` with the exact
   parameter types. This prevents overload accumulation (the 0036/0037 incident).
2. **`SECURITY DEFINER`** + **`SET search_path = public`** on every RPC.
3. **Row-level locking:** any RPC that mutates a row must `SELECT ... FOR UPDATE`
   the target row first (parts, purchase_orders, invoices, etc).
4. **Actor capture:** use a `TEXT` parameter (typically `p_actor` or similar) for
   the user's email. Matches the app's `entered_by`/`created_by` convention.
   Never rely on `auth.uid()` alone — the actor email is the audit trail.
5. **Composition over reimplementation:** if an RPC's logic overlaps an existing
   RPC, call the existing one. Example: `receive_purchase_order` calls
   `receive_loose_parts` rather than reimplementing stock receipt logic.

---

## One-SKU-One-Warehouse Rule

A part (SKU) exists in exactly one warehouse. `parts.warehouse_id` is a
non-nullable FK. There is NO `part_stock` join table.

**Rules:**
- A part row cannot be moved between warehouses (delete + recreate if needed).
- `create_purchase_order` enforces this: every line's `part.warehouse_id` must
  equal the PO's `warehouse_id`. The RPC rejects mismatches.
- UI dropdowns for parts must filter by the active warehouse context.

---

## FIFO Price Lots & Inventory Invariant

Stock quantities are tracked via `price_lots` (FIFO). Each lot records
`qty_purchased` and `qty_remaining`.

**Critical invariant — must hold after every stock-touching operation:**

SUM(price_lots.qty_remaining) WHERE part_id = X == parts.qty_on_hand WHERE id = X


**Rules:**
- Stock arrives ONLY through `add_price_lot` (which increments `parts.qty_on_hand`
  and creates a lot). Never write to `parts.qty_on_hand` directly.
- Stock is consumed ONLY through `consume_from_lots` (FIFO oldest-first drain,
  decrements both lot and part). Live caller: Maintenance's `consume_work_order_line`
  (via `deduct_work_order_parts` / `edit_work_order`, migration 0065).
- Stock is RETURNED (reversed) ONLY through `return_to_lots` (migration 0065) —
  the reverse counterpart to `consume_from_lots`, same discipline: locks the
  exact `price_lots` rows being restored, never creates a phantom lot, never
  writes `parts.qty_on_hand` directly (increments it as part of the same
  accounted operation), and logs a `stock_movements` row
  (`movement_type='return'`). It restores to the EXACT lots stock was drawn
  from — reconstructed from `work_order_part_consumptions`, an append-only
  per-lot ledger (`direction` 'consume'/'return') that both
  `consume_work_order_line` and `return_to_lots` write to. Without that
  ledger, a reversal has no way to know which lots to credit back.
- `consume_from_lots` and `return_to_lots` together are the ONLY two writers
  of `price_lots.qty_remaining` / `parts.qty_on_hand` for consumption-shaped
  operations. `add_price_lot` remains the only writer for receiving-shaped
  operations (new stock in). Three writers total, each with one direction,
  none overlapping.
- `adjust_stock` is the manual-correction exception (direct qty change + movement
  log). Use sparingly.
- `stock_movements` is append-only. Never update or delete movement rows.
- After any migration or RPC that touches stock, verify the invariant:
```sql
  SELECT p.id, p.name, p.qty_on_hand, COALESCE(SUM(pl.qty_remaining),0) AS lot_sum
  FROM parts p LEFT JOIN price_lots pl ON pl.part_id = p.id
  GROUP BY p.id, p.name, p.qty_on_hand
  HAVING p.qty_on_hand <> COALESCE(SUM(pl.qty_remaining),0);
```
  Zero rows = pass. Any rows = broken invariant, stop and fix before proceeding.

---

## Stock Receipts & Invoice Evidence

Every stock receipt (loose parts or PO-based) requires an uploaded invoice file.
Files go to the private Supabase Storage bucket `stock-receipt-invoices`.

- `receive_loose_parts` enforces `p_files` is non-empty.
- `receive_purchase_order` composes `receive_loose_parts`, inheriting the gate.
- `stock_receipts.po_id` (nullable) links PO-based receipts back to their PO.

---

## Purchase Order Lifecycle

draft → issued → (received via receive_purchase_order) → pending_approval → approved
→ rejected


- Only `issued` POs can be received (not drafts — deliberate deviation from preview).
- Receipt is one-shot full receipt (no partial shipments in v1).
- Approval requires MIN 2 distinct approvers (schema-enforced via UNIQUE constraint
  on `purchase_order_approvals(purchase_order_id, approver_email)`).
- Eligible approvers: active staff with email, not terminated, role in
  (`fleet_manager`, `ops_supervisor`, `inventory_clerk`).

---

## Finance / Invoice Lifecycle (customer-facing)

Draft → Review → Confirmed → Paid
→ Sales Return (credit note)


- Reserve-at-draft: customer balance is reserved when invoice moves to Draft.
- ZATCA VAT at 15%, document-level rounding (not per-line).
- Bilingual AR/EN invoice PDF via PDFShift (behind `lib/pdf.ts`).
- Gap-free yearly invoice numbering (counter-table pattern, see above).

---

## Traffic Violations & Payslip Deductions (0175–0177)

### The three tables

- **`violation_types`** — bilingual lookup. **`label` AND `label_ar` are both
  NOT NULL**; a new type demands both names, or English lands on the Arabic
  screen. `key` is immutable (`violation_types_key_unique`) — a rename touches
  the label only. `active` is a **soft-retire**, not a delete.
  - **Fetch types UNFILTERED by `active`; let the picker filter.** Label
    resolution needs retired types — a fine written against a since-deactivated
    type must still render its name, and the locked historical rows nobody can
    edit are the likeliest to point at one.
- **`driver_violations`** — the fines. Child of `drivers`.
  - **`voided_at` is the delete path**, with `voided_by` + `void_reason`
    (both nullable). **Never hard-delete.** A voided fine leaves every total and
    every list while staying readable — that difference is the entire point.
  - **Reference is unique PER DRIVER among LIVE rows only** —
    `driver_violations_driver_ref_live_unique` on `(driver_id, ref_no)`
    `WHERE voided_at IS NULL`. A voided fine frees its reference for re-entry.
- **`driver_payslip_violations`** — the freeze table, `(payslip_id,
  violation_id)`. **`UNIQUE(violation_id)`**
  (`driver_payslip_violations_violation_unique`): a fine can be consumed by **at
  most one payslip, ever**. Frozen fines are locked — no edit, no void, enforced
  in the server action, not merely hidden in the UI.

### THE DEDUCTION LAW

A payslip deducts **that month's LIVE fines**: `voided_at IS NULL`, dated inside
the month, **every `payment_status`**. Settling with the authority is a
different question from payroll recovering it.

```
violation_deduction_sar = month_fines                              -- col 19, the claim
deductions_sar          = LEAST(month_fines, GREATEST(gross, 0))   -- col 20, what pay absorbed
unabsorbed_sar          = month_fines - deductions_sar             -- col 21, what it could not
net_sar                 = gross - deductions_sar                   -- col 18, CLAMPS at 0
```

**THREE FIGURES, DELIBERATELY DISTINCT.** Collapsing any two is the bug this
model exists to prevent.

**`unabsorbed_sar` IS A RECORD, NOT A CARRY.** No cross-month carry, no
remainder chain, no month-order requirement, no later month reads it.
Recovering it is a human decision made outside this app. **The deduction is a
pure function of `(driver, month)`** — which is what makes the preview
trustworthy.

**WHY NO CARRY IS NEEDED — the load-bearing link.** On ADD, a violation cannot
be dated before the **1st of the current month** (`monthStartKey`,
`TrafficViolationsSection.tsx:134` as the input `min`, and the server owns the
rule). Future dates are allowed. That floor makes late-stranding impossible: a
fine can never appear in a month whose payslip is already issued, so there is
nothing for a carry to rescue. **The floor and clamp-no-carry hold each other
up — do not revisit one alone.** On EDIT the floor is absent, since the row's
own date is the subject.

### The clamp is IN THE DATABASE, not just the view

Four CHECK constraints on `driver_payslips`, added by 0177, all verified present
in `pg_constraint`:

- `driver_payslips_net_nonneg` — `net_sar >= 0`
- `driver_payslips_violation_deduction_nonneg` — `violation_deduction_sar >= 0`
- `driver_payslips_unabsorbed_nonneg` — `unabsorbed_sar >= 0`
- `driver_payslips_deduction_within_violations` — `deductions_sar <= violation_deduction_sar`

### WYSIWYG — preview and document read the same columns

`v_driver_payslip_basis` computes the deduction in **columns 19–21**; `net_sar`
is col 18 and is **already net**. `issue_driver_payslip(uuid,date,text)` freezes
those columns **verbatim** — it does not recompute and does not subtract again.
The preview reads the same columns, so a preview and the document it becomes
cannot disagree.

- `issue_driver_payslip` is **SECURITY DEFINER** and §6-re-revoked —
  `has_function_privilege('anon', …, 'execute')` = **false**, `authenticated` =
  true. Any redefinition must re-revoke in the same transaction.
- The frozen snapshot's `violations.items` orders **oldest-first**
  (`order by dv.violation_date, dv.ref_no`); the live preview is sorted to
  match, or the sheet visibly reshuffles on issue with no figure changing.

### Outstanding

**`lib/violations.ts` owns it** — one arithmetic, three surfaces, so they cannot
answer differently.

```
outstanding = sum(live fines) - sum(deductions_sar across ISSUED payslips)
            = fines in unissued months + each issued month's unabsorbed_sar
```

Read-only aggregation on top of 0177 — **it adds no money object.**

- **NOT clamped at zero, deliberately.** The only route to a negative is a fine
  voided *after* a payslip absorbed it — which the UI forbids, and which would
  mean a document deducted money for a fine that no longer exists. That is a
  real defect worth seeing; `Math.max(0, …)` would hide exactly the case worth
  finding.
- **Settlement status is MONTH-LEVEL, not per-fine.** Absorption has no per-fine
  share: a month claiming 500 that absorbs 300 leaves 200 across two 250 fines,
  and "which one was the outstanding one" has no answer. Deducted = issued and
  fully absorbed; Partly deducted = left a remainder; **Unsettled = absorbed
  nothing at all** (zero absorbed is not "partly" anything).

### Locked decisions (do not re-litigate)

1. **Clamp-no-carry**, over a remainder chain — the chain needs a stable origin
   month and the live data has none.
2. **Deduct every `payment_status`.** Paid-to-the-authority ≠ recovered-from-pay.
3. **Date floor = 1st of the current month, future dates allowed**, ADD only.
4. **RBAC on add-a-type: deferred.** Any authenticated user can add one today.

Guarded by `scripts/payslip-deduction-check.ts`.

---

## Migration Discipline (beyond what CLAUDE.md covers)

- **Verify on disk before running:** `ls supabase/migrations/ | tail -5` then
  `cat` the file. Migrations have been "drafted in conversation" but never written
  to disk — always verify the file exists and matches what was reviewed.
- **Counter tables and RPC drops go in the same migration** as their CREATE.
- **Additive-only is safer:** new nullable columns, new tables = low risk.
  Altering constraints, dropping columns, changing RPC signatures = review gate.
- **Test data is not production data.** Flag messy test rows but never delete
  data without Turki's explicit approval.

---

## Session Hygiene

- Update `CLAUDE.md` section 7 (or equivalent state section) at the end of any session
  that changes what's built or what's next.
- **OUR handoff file is `.planning/AQUAFLEET-HANDOFF.json`, and it IS committed**
  (Turki's call, 2026-08-07). Write it by hand, stage it by explicit path, commit.
  No special ceremony — the ceremony that used to live here existed only because
  the path was contested, and it no longer is.
  - **`.planning/HANDOFF.json` and `preview/.planning/HANDOFF.json` are the gsd
    plugin's, and are GITIGNORED.** gsd's PostToolUse checkpoint rewrites them
    from an empty template after nearly every tool call. **Empty is their correct
    state in this repo** (upstream bug #17, fixed in gsd v4.0.1 — we run a stale
    3.4.4). Never read them for project state, never stage them, never "repair"
    them.
  - **THE HISTORY, BECAUSE THE LESSON GENERALISES.** We used to write our snapshot
    to the contested `.planning/HANDOFF.json`. It was committed blank over a real
    snapshot once (`7b29c65`, restored in `86adec8`) and blanked twice more in one
    later round — once between the file being verified and the `git add` seconds
    after, so the INDEX held the blank while the working tree looked right. Every
    guard worked and it still happened three times. **The fix was ownership, not
    vigilance: when two tools claim one path, move the path.**
  - **`CLAUDE.md` §5 is the authority** — it keeps the staging-discipline rules
    that came out of this, because they apply to any generated file: the `add`
    conditional on the write succeeding, inspect the STAGED BLOB not the working
    tree, a shrinking diff is a stop signal, and `git checkout -- <path>` restores
    from the INDEX so recovery needs `git checkout HEAD -- <path>`. If this file
    ever disagrees with §5, §5 wins.
- If a session is getting long (15+ turns), proactively save state and suggest
  starting fresh rather than degrading.
- When verifying a build, check the DB state (via Supabase MCP) independently of
  what the code claims — trust but verify.
