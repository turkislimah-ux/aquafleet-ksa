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
- Keep both `HANDOFF.json` files unstaged (`.planning/` and `preview/.planning/`).
- If a session is getting long (15+ turns), proactively save state and suggest
  starting fresh rather than degrading.
- When verifying a build, check the DB state (via Supabase MCP) independently of
  what the code claims — trust but verify.
