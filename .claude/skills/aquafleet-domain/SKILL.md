# AquaFleet KSA — Domain Rules & Data Conventions

Use this skill whenever writing or modifying server actions, RPCs, migrations,
or any code that touches money, stock, invoices, purchase orders, or the data
model. These are project-specific invariants — violating any of them produces
bugs that are hard to detect and expensive to fix.

**DO NOT APPEND build diary, implementation notes, or session history to this
file. It holds RULES ONLY. If it exceeds 15KB, Code is appending — cut back.**

---

## Money-Core Boundary

Two files own ALL money math for the customer-facing finance/invoice system:

- `lib/prepaid.ts` — prepaid ledger logic (VAT-inclusive balances, FIFO trip
  coverage, reserve-at-draft, release-on-cancel)
- `lib/vat.ts` — ZATCA-compliant VAT calculation (15%, document-level rounding)

Rules:
- Inventory does NOT touch these files. Inventory money is internal-only.
- Never duplicate VAT logic. Import from lib/vat.ts.

---

## Invoice & PO Numbering — Counter-Table Pattern

Gap-free sequential numbers use a counter table + function that locks with
FOR UPDATE and increments atomically.

Rules:
- NEVER generate numbers client-side.
- Any new numbered document type gets its own counter table + function.

---

## RPC Conventions

1. ONE signature per function. DROP exact old before CREATE OR REPLACE.
2. SECURITY DEFINER + SET search_path = public on every RPC.
3. Row-level locking: SELECT ... FOR UPDATE before mutation.
4. Actor capture: TEXT parameter for user email (audit trail).
5. Composition over reimplementation.

---

## One-SKU-One-Warehouse Rule

parts.warehouse_id is non-nullable FK. No part_stock join table.
A part cannot move between warehouses. PO enforces line warehouse match.

---

## FIFO Price Lots & Inventory Invariant

Critical invariant after every stock-touching operation:
SUM(price_lots.qty_remaining) WHERE part_id=X == parts.qty_on_hand WHERE id=X

Rules:
- Stock arrives ONLY through add_price_lot.
- Stock consumed ONLY through consume_from_lots (FIFO oldest-first).
- adjust_stock is the manual-correction exception.
- stock_movements is append-only. Never update or delete.

---

## Commission (effective-dated)

- project_commission_history = effective-dated config per project.
- commission_config_at(project_id, date) = resolver. Returns nothing = HARD ERROR.
- set_project_commission = THE one writer. No backdating.
- trips.commission_sar + mode/base/bump frozen at delivery (0152).
- recomputeDailyCommission re-ranks but prices at EACH trip's own frozen terms.
- update_project_with_customer DOES NOT take commission params (0153).
- Baseline is immutable (cancel refused).

---

## Effective-dated Rates

- salary_history table, baselines at employment floor.
- trips.rate_sar frozen at delivery. Prepaid reads frozen rate.
- Any surface pricing DELIVERED work reads trips.rate_sar, NOT projects.rate.

---

## Finance / Invoice Lifecycle

Draft → Review → Confirmed → Paid / Sales Return (credit note)

- Reserve-at-draft. ZATCA VAT 15%, document-level rounding.
- Gap-free yearly invoice numbering (counter-table pattern).

---

## Purchase Order Lifecycle

draft → issued → received → pending_approval → approved/rejected

- Only issued POs can be received. One-shot full receipt (v1).
- 2-approver matching-vote gate. Approved is FINAL.

---

## View Security (from CLAUDE.md §6)

Every CREATE OR REPLACE VIEW must restate:
  ALTER VIEW public.X SET (security_invoker = true);
  REVOKE ALL ON public.X FROM anon;
  GRANT SELECT ON public.X TO authenticated;

42P16: can only APPEND columns, cannot change type.

---

## Migration Discipline

- Verify file on disk before running.
- Counter tables and RPC drops go in same migration as CREATE.
- Code drafts → STOPS → architect reviews + applies.
- Never self-apply via Supabase MCP.

---

## Session Hygiene

- HANDOFF.md at session end (under 2KB).
- NEVER append build diary to CLAUDE.md or this file.
- If either file exceeds its size cap, Code is appending. Cut back.
- 15 turn cap. First compaction = wrap up.
