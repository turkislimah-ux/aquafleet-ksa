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

## covered + amountDue = grand, BY CONSTRUCTION — only TWO of the three are computed

An invoice carries three document totals. **Compute all three independently and
the identity holds only by accident.** It did not hold: before `1754140`, `grand`
was composed from a NON-COVERING line set (covered trips + covered charges),
`amountDue` from another (unpaid trips + uncovered charges) and `covered` from a
standalone pass over its own lines, leaving a residue of
`coveredCharges − unpaidTrips − uncoveredCharges` — zero only by coincidence.

**The rule, in `lib/invoice.ts`:**

1. **`grand` = ONE document-level `calculateVat()` pass over EVERY line the
   invoice shows** — covered trips + unpaid trips + ALL special charges. One
   pass, so the printed VAT is rounded once against the full taxable base, as
   ZATCA requires (`lib/vat.ts`).
2. **`amountDue` keeps its per-item, pool-exact rule, unchanged.**
3. **`covered` = `grand − amountDue`, component-wise. DERIVED LAST, never its
   own VAT pass.**

**Deriving `covered` last is the whole point, and it is not stylistic.** The two
rounding conventions — document-level for `grand`, pool-exact per-item for
`amountDue` — can differ by up to **0.01 SAR**. Subtraction puts that halala in
`covered`, an already-SETTLED display figure where it settles nothing, and keeps
it out of `amountDue`, which is **what the customer is actually asked to pay**.
Subtotals are exact sums either way, so only VAT can move.

**Do NOT re-narrow `grand` to "what is settled."** The figure describing the
whole document must cover the whole document. Postpaid always reconciled because
`grand` and `amountDue` were literally the same `calculateVat()` call and
`covered` was `{0,0,0}` — that is the shape prepaid now has too.

- **Guarded by `reconciles()` in `scripts/invoice-check.ts`**, called on every
  assembled case in BOTH payment modes. It asserts `covered + amountDue = grand`
  on subtotal/VAT/total AND that the sum of every displayed line IS
  `grand.subtotal`. **Never assert a total in that file without also calling
  `reconciles()`** — the old suite's failure was exactly this: every assertion
  pinned what the engine DID, none pinned what it had to ADD UP TO. Six
  old-law assertions were rewritten rather than deleted.
- **The Mark Paid modal draws the pool down by `covered.total`, not
  `grand.total`.** Now that `grand` carries the whole invoice, deducting it would
  charge the pool for the unpaid half as well.
- **Issued documents do NOT change** (freeze law `0027`). Both surfaces pick
  their total stack by ARITHMETIC, not by status: a frozen invoice whose stored
  lines reconcile to its stored total takes the new stack; one that does not
  renders exactly as issued, and heals on its own if the stored money is
  corrected. Nothing keys off status.
- **Dated measurement, 2026-09-05 — re-measure before quoting.** 8 of 24 live
  invoices did not add up, 38,709.00 SAR of delivered work sitting outside a
  document's own total; the as-issued branch fired on `026-000007`, `026-000009`,
  `026-000014`, `026-000017` and no others. Repairing those four is separate work
  under `0027`.

---

## asOfDate scopes CONSUMPTION, never the POOL

The prepaid pool is a **lifetime net** — `sum(all topups) − sum(all returns)`,
no date gate — at every site that computes one: `splitCoveredUnpaidItems`,
`lib/invoice.ts`'s `startingPool`, `derivedBalanceItems`, `buildStatementItems`,
and `v_customer_prepaid_balance` (which never gated). `9c287d6` moved the
invoice engine; `dc29e26` moved the last two functions.

**`asOfDate` is a CONSUMPTION filter and nothing else.** Never re-gate a credit
side with it: a caller passing a date would get a balance contradicting the
invoice engine, the view and the Finance KPI at once, silently, by exactly the
value of the top-ups dated after that date.

### It filters TRIPS ONLY — a CHARGE is INVOICE-BOUND, not date-scoped

`asOfDate` is load-bearing on the TRIP side: `lib/invoice.ts` passes `periodEnd`,
and the period is what SELECTS an invoice's trips, so `deliveredTripsSorted`
keeps its `trip_date <= asOfDate` gate. **`consumingItems` applies NO gate to
charges, and must not.** A special charge is scoped by its **invoice FK**, set
when it is attached — it belongs to that invoice whatever its `charge_date`
says, and is included in `grand` AND eligible for pool coverage on that basis
alone.

**This paragraph used to say "load-bearing there" with no trip/charge split, and
the code matched it: `consumingItems` carried `charge_date <= asOfDate` with
`asOfDate = periodEnd`. That was a bug, removed in `1754140`.** It left a
future-dated charge asked for and settled in different places at once —
`chargeLines` LISTED it (ungated since `0181`), `v_customer_prepaid_balance`
DEDUCTED it (that view never had a date predicate), and the FIFO walk REFUSED it
coverage. The filter was one-sided, so only future-dated charges were stranded,
which is why it went unseen. Live invoice `026-000017` is exactly this shape.

Ordering is unaffected: `compareConsumedItems` sorts by date, so a late charge
lands at the queue tail and cannot take pool from an earlier item.

**Do not reintroduce the gate to "scope charges to the period."** The period does
not select charges. The FK does.

- **`buildStatementItems`' settlements filter is the one legitimate exception**
  and stays gated. A settlement is a record-only row, contributes nothing to the
  running balance, so it cannot desync the closing figure. Returns are not like
  this — a return **does** move the balance, so it cannot keep a gate the credit
  sum lacks.
- `returnedTotal(returns, asOfDate)` keeps its optional param, **passed by
  nobody**. A dormant option for a future report, never for a pool.
- Guarded by `scripts/prepaid-check.ts` and `scripts/covered-unpaid-check.ts`.
  Both hold inverted cases that assert the gate's ABSENCE — they were rewritten
  rather than deleted precisely so a re-gating fails loudly. **This now covers
  BOTH gates:** the pool cut, and the charge cut removed in `1754140`.
- **The charge cases turn on `ch-future` and only on `ch-future`.** Both files
  pair a `ch-past` with a `ch-future` around the cutoff. The old filter was
  one-sided (`<=`), so `ch-past` passes whether or not the gate exists and proves
  nothing; **a fixture that drops `ch-future` silently disarms the guard.**
  Re-adding the filter must fail these six checks — verified by negative control
  when they were written.

---

## Duplicate customer info is ALLOWED — do not add a uniqueness or merge guard

**Two customer records may legitimately share an identical name, VAT number and
CR number** when they serve different projects. Each holds its **OWN separate
prepaid pool** and its own invoices; they are distinct counterparties for money
purposes and only coincide on their identity fields.

So: **do NOT add a VAT/CR uniqueness constraint, and do NOT add a dedupe or
merge guard on `customers`.** Either would block a valid case, and merging two
such records would silently pool two balances that must stay apart.

**VAT/CR carries NO identity signal on current data — do not reason from it.**
Re-measured 2026-08-31: `123456789012345` / `1234567890` is an unfilled
placeholder on **5 of 7 LIVE** customers — MMM construction, both Seder records,
TEST 111 and Turki Contraction. It is not a marker of the same company, so a
shared VAT/CR neither proves nor suggests a duplicate. That also makes the rule
above load-bearing rather than hypothetical: a uniqueness constraint would fail
immediately on five existing rows.

**Recounting this: `customers` holds 8 rows, and `Turki 1` is archived
(`archived_at` set) — soft-delete keeps it in the table.** A bare `count(*)`
returns 5 of 8 and reads as if this note were stale. It is not; scope to
`archived_at is null`. The constraint would still fail — an archived row is
still a row.

The two "Seder Facility mang./Mang. Co." records (differing only in the case of
"mang.") are 2 of the 3 prepaid customers. They are separate by ruling, not
because their identity fields match.

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
columns (0027's freeze law) — `invoiceActions.ts` reads them verbatim (grep
`coveredLines: inv.covered_lines`), and no user-facing view re-derives an
issued invoice. No document drifts. Only
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

## A GUARDED WRITE MUST READ BACK — PostgREST calls a zero-row UPDATE a SUCCESS

**`.update()` / `.delete()` that matches NO row returns `{ error: null }`.** It is
not an error in PostgREST; it is an UPDATE with a `WHERE` that matched nothing,
which SQL considers a normal outcome. So a write whose guard predicate filtered
it out reports success having changed nothing, the page revalidates, and the row
re-renders **from the database in its old state under a success message**. The
user is told the thing happened. It did not.

**Therefore: any write carrying a guard beyond its key must read back.** Two
honest shapes, both in use and both correct:

```ts
// 1. Single row — the common case.
const { data: hit, error } = await supabase
  .from("t").update({ … }).eq("id", id)
  .is("payout_id", null)          // ← the guard
  .select("id").maybeSingle();    // ← without this the guard is decoration
if (error) return { error: error.message };
if (!hit) return { error: SOMETHING_HONEST };

// 2. `.select()` WITHOUT single returns an ARRAY, so a miss is detectable too —
//    but only if the caller actually tests it. updateExitPermitDraft and
//    deleteExitPermitDraft both do. This shape is not a bug; a missing
//    `.length` test is.
const { data, error } = await supabase.from("t").delete()… .select("id");
if (!data || data.length === 0) return { error: t("…", lang) };
```

**ORDERING: the `!hit` bail goes ABOVE any destructive follow-on.** This is where
the rule stops being cosmetic. `removeDriverViolationImage` deleted the storage
object *after* a row-write that its own guard could filter out — a miss erased a
file the surviving row still pointed at. Bail first, then destroy.

**Where the follow-on deliberately runs FIRST, the read-back REPORTS the residue
instead of repairing it — and the comment must say which.**
`updateDraftInvoicePeriod` syncs its trip reservation before writing the period,
on purpose, so a genuine double-claim aborts with the period untouched. On a
guard miss the reservation therefore reflects the new range while the invoice
keeps the old one. Re-syncing would be a second write that can fail in turn. Say
so out loud; do not silently return success, and do not "fix" the ordering.

### What is NOT a guard — do not add read-backs to these

A repo-wide sweep (2026-08-31, 203 files, 107 write chains) found 22 guarded
chains with no read-back and **none was a defect.** Before calling one a finding:

- **A filter on a UNIQUE column is an IDENTITY LOOKUP, not a state gate** — 11
  of the 22. `key` is UNIQUE on all six lookup tables (`staff_roles`,
  `leave_types`, `commission_types`, `violation_types`, `water_stations`,
  `archive_document_types`), and `commission_periods` has a unique index on
  `(driver_id, month_key)`. **Check `pg_constraint` before deciding.**
- **Bulk writes, where zero rows is the CORRECT outcome** — 9 of the 22.
  Unassigning every truck from a driver, deleting a PO's lines, the
  approve-everything-still-pending flips. A read-back here would invent a
  failure. `trips`' commission heal filters `.is("commission_mode", null)`
  precisely so a concurrent stamp wins; a miss is the desired result.
- **A scoping filter behind a real prior check** — `updateExitPermitLineQty` and
  `removeExitPermitLine` call `assertDraft` first; `.eq("exit_permit_id", …)` is
  scope, so a miss is a caller bug, not a race.

### Evidence, and how to re-sweep

Seven sites fixed across four tables: `driver_violations` ×4
(`updateDriverViolation`, `voidDriverViolation`, and the two image writes —
`178df21`), then `setSpecialStatus`, `setAdjustmentStatus` and
`updateDraftInvoicePeriod` (`9e4ca3b`). The freeze predicates the rule protects
are `.is("voided_at", null)`, `.is("payout_id", null)` and
`.eq("status","draft")` — a voided fine, a paid commission line, a non-draft
invoice.

To re-sweep: find `.from("…")` chains containing `.update(`/`.delete(`/`.upsert(`,
and classify by (a) filters beyond the key, (b) presence of a read-back.
**Blank comments BEFORE parsing, never after** — prose commas end a chain early
and apostrophes open phantom strings, and a scanner that gets this wrong reports
an existing read-back as missing while printing a clean report. Point it at
`driver_violations` first: four writes, all four read back. Known answer, both
directions.

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

## Company bank accounts (0184) — every rule here reads like a defect

Printed on customer invoices as a Transfer Details block. Stored as a jsonb
ARRAY on `company_settings.bank_accounts`. All four rulings below look like bugs
to a session meeting them cold; each is deliberate and guarded.

### 1. The DB validates almost nothing, and the app is the other half of the deal

`company_settings_bank_accounts_shape` enforces exactly two things — the value is
an array, and it holds at most 3 elements (`MAX_BANK_ACCOUNTS`). It deliberately
does NOT enforce element shape: **a CHECK may not contain a subquery**, so
`jsonb_array_elements` is unavailable, and the only route to per-element
validation is an IMMUTABLE helper called from the constraint, a documented
anti-pattern.

**So the database WILL accept a malformed element, and nothing downstream may
assume a well-formed one:**

- **Every READ goes through `parseBankAccounts`** (`lib/bankAccounts.ts`), which
  returns only elements it can fully account for and silently drops the rest.
- **Every WRITE goes through `validateBankAccounts`** in the single server
  action. Shape is enforced THERE.
- **`CompanySettings.bank_accounts` is typed `unknown`** so `tsc` refuses to let
  a reader skip the parse. That is not laziness in the types — it is the
  enforcement mechanism. Do not "improve" it to a concrete type.

### 2. The IBAN field validates almost NOTHING, on purpose

`isAcceptableIban` is `/^[A-Z]{2}[0-9A-Z]+$/` against the normalised value. That
is the WHOLE rule. Practically only an empty field can fail it — **`"nope"` is a
saveable IBAN** (normalises to `NOPE`, reads as country code `NO`).

**IT ONCE RAN THE ISO 13616 MOD-97 CHECKSUM AND A LENGTH TEST. BOTH WERE REMOVED
BY TURKI ON 2026-09-05, THE SAME DAY, AFTER USING THE FIELD.** The reasoning is
kept because a future session WILL read this as a missing feature:

> We are not connected to any banking system. The checksum does not ask a bank
> whether an account exists — it only asserts that a string obeys a formula. So
> it can never confirm a correct IBAN; it can only reject an operator copying a
> real number off a real bank statement in front of him. That is what it did in
> practice: the field became nearly impossible to fill, and the failure was
> opaque — "invalid", with nothing on his screen to correct.

A wrong IBAN is caught where it always actually was: by the customer reading the
invoice, and by the bank refusing the transfer. Neither was ever replaced by the
checksum. **Do not re-add a checksum, a length rule, or a digits-only rule.**

What IS kept is the part that serves the operator rather than policing him —
`normalizeIban` (strip every separator, upper-case), `formatIban` (groups of 4,
the way every bank prints it), and `ensureSaPrefix`.

### 3. `SA` is a DEFAULT, never a whitelist — foreign accounts are allowed

`ensureSaPrefix` supplies `SA` **only when the value starts with a DIGIT**. The
test is POSITIONAL:

- Starts with a digit → no country code at all, and the operator meant the Saudi
  account. `SA` goes on, rather than sending a human back to type two letters.
- Starts with LETTERS → already carries its code. Left exactly as typed.
  Prepending would manufacture `SADE89…`, a number that is not any account
  anywhere, silently, on a payment instruction.

**`DE89…` and `MT84…` are accepted as typed. NO COUNTRY WHITELIST.** SA-only was
asked for and stood for exactly ONE TURN on 2026-09-05 before being amended to
SA-as-default; the harness keeps both foreign cases INVERTED rather than deleted
so the reversal stays on the record.

**Order matters on blur: prefix FIRST, then format.** Group first and the country
code lands mid-group, so the spacing sits a character off from every other
account on the invoice. Same on the write path — prefix, then test, so what gets
tested is what will be stored.

### 4. `show_on_invoice` FAILS CLOSED

Only an explicit `true` renders. A malformed or missing flag hides the account.
The cost of wrongly hiding is an operator ticking a box; the cost of wrongly
showing is **a customer wiring money to an account we did not intend to
publish.**

### 5. Freeze law 0027 applies, with NO cross-fallback

- **Draft / review → LIVE settings**, so a draft previews what it will freeze.
- **Confirmed / paid / void → the frozen `seller_snapshot`, and nothing else.**
  No live fallback, not even when the snapshot is empty.

**The no-fallback half is load-bearing:** `getInvoicePdf` CACHES issued bytes, so
a live read would leave a cached PDF disagreeing with the popup, and would graft
today's accounts onto a document already in the customer's hands.
`assembleForCustomerPeriod` captures the seller with `select("*")`, so the column
landed in the snapshot with no assembly change.

### Logging, and what these IBANs are

They are the **COMPANY's OWN** accounts, printed on customer invoices by design —
public information, not a secret, and not customer data. **They are still never
logged, and never written into a note, a commit message or an error string.** An
IBAN in a log line is an IBAN in a place nobody audits.

### The guard

**`scripts/bank-accounts-check.ts` (wired into `test:money`) asserts the
LOOSENING, not a validation.** A transposed digit, an altered digit, a short
value, a long value and two foreign IBANs must ALL be ACCEPTED. Those cases read
like bugs on purpose: re-adding a checksum, a length rule or a country test fails
there loudly instead of quietly re-breaking the field. Proven by negative control
when written — re-adding each turns 8, 3 and 3 checks red respectively.

---

## Traffic Violations & Payslip Deductions (0175–0178)

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
be dated before the **1st of the current month** (`monthStartKey`, computed as
`floor` in `TrafficViolationsSection.tsx` and passed to `ViolationForm.tsx`,
which spends it as the date input's `min` — and the server owns the rule). Future dates are allowed. That floor makes late-stranding impossible: a
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

### The notice photo (0178) — evidence, not money

`driver_violations.image_path` — **nullable `text`**, one optional photo of the
paper notice per fine. Measured live: `format_type` = `text`, `attnotnull` =
false.

- **It is a STORAGE KEY the app generates, never the uploaded filename:**
  `` `${driverId}/${violationId}-${Date.now()}.${ext}` `` — built in
  `uploadDriverViolationImage` (`app/drivers/actions.ts`), its only site.
  A user-supplied name is attacker-controlled and collides.
- **DISPLAY ONLY, and the catalog says so.** **Zero** views in `public` mention
  `image_path` — `v_driver_payslip_basis` included — and
  `issue_driver_payslip(uuid,date,text)`, the freeze RPC, does not mention it
  either. No deduction, no freeze, no snapshot copies it. A photo cannot move a
  number.
- **A VOID KEEPS THE PHOTO.** `voidDriverViolation` touches no storage and does
  not null the column — verified line-by-line over its body. A voided fine keeps
  its evidence for the same reason it stays readable at all.

**Read path: private bucket + short-lived signed URL. There is no public URL.**

- Bucket `violation-images`, `public = false`, created **by migration 0178** —
  buckets ARE migration DDL here. **13 buckets, 13 private, 0 public** (live
  `storage.buckets`), and all 13 ids appear in migration files.
- Reads go through `getDriverViolationImageUrl` → `createSignedUrl(path, 300)`
  in `app/drivers/actions.ts` — the sole call, grep by name not by line.
  `getPublicUrl` appears **nowhere** in the repo; the only textual hits are the
  two comments asserting that (this bullet and actions.ts's own).
- The **4-policy authenticated CRUD set** on `storage.objects` — select /
  insert / update / delete, role `authenticated`, each `bucket_id =
  'violation-images'` — written `drop policy if exists` then `create policy`,
  the measured house convention (136 drops against 147 creates repo-wide).
- **The 5 MB cap is APP-SIDE ONLY.** `storage.buckets.file_size_limit` is
  **null** for this bucket; the ceiling lives in `validateViolationImage`
  (client) and again in the upload action (server). Do not assume Storage will
  reject an oversized object.

**EDIT RULE — the photo inherits the fine's freeze, exactly.**

Editable on the **staff page** and on an **UNISSUED payslip**; **read-only
(view / open in a new tab) once frozen onto an issued payslip.** Enforced
server-side, not merely hidden: `violationIsFrozen()` + `FROZEN_MSG` guard all
four mutators — `updateDriverViolation` (1453), `voidDriverViolation` (1492),
`uploadDriverViolationImage` (1573), `removeDriverViolationImage` (1627).
`getDriverViolationImageUrl` (1666) is **deliberately unguarded**: reading
evidence is not editing a document, and a frozen fine is the one most likely to
be disputed.

**The payslip surface added NO new mutation path.** It imports and calls those
same guarded actions; the client gate `!doc && !x.locked` is the explanation,
never the lock. Adding a brand-new fine stays staff-page-only.

### LOCK — `window.open` with `noopener` returns NULL by spec

Do **not** write `window.open(url, "_blank", "noopener")` — or open a blank tab
with `noopener` in the feature string — and then read the null return as a
pop-up block. MDN, `Window/open`: *"the new window will not have access to the
originating window via `Window.opener` and returns `null`."* A window denied an
opener is also denied *to* its opener, so the handle needed to navigate the tab
never arrives.

This shipped as a bug: the payslip photo appeared blocked on every click while
no blocker was involved. The working shape, for any signed URL fetched after a
click:

```ts
const tab = window.open("", "_blank");  // sync, inside the user gesture
if (tab) tab.opener = null;             // about:blank is same-origin — sever by hand
const res = await getSignedUrl(id);     // the await that would have cost the gesture
if (tab) tab.location.href = res.url;
else /* null NOW means a real blocker */;
```

Open **before** the await (a post-await `window.open` loses the gesture and is
genuinely blocked), and null the opener manually to get what `noopener` was
for. Where a second click is acceptable, the drivers screen's pattern avoids
the problem outright: fetch, render, and offer full-size as a real
`<a target="_blank" rel="noopener noreferrer">` on an already-fetched URL.

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
