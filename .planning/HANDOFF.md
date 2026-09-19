# SESSION HANDOFF

## State
- **0203 customer_ledger APPLIED prod+test.** Seed run; Available==legacy
  verified. DB at 0203. Migration FILES authoritative; repo UNLINKED.
- **PREPAID BATCH 1 BUILT — UNCOMMITTED, awaiting Turki's in-browser pass.**
  lib/customer-ledger.ts (sole reader of the 3 views) · prepaid Finance tab
  (FinanceTab + AddBalanceModal receipt/done view + CustomerLedgerModal:
  ledger w/ running balance, refund, corrections+votes) · RCT/CN print via
  lib/docvm/ledgerDoc + lib/docs/ledgerDoc · statement rebuilt on ledger ·
  doc-render-ledger.ts corpus (8 sheets pinned) · scripts/db/ledger-check.ts
  in test:db. npm test + test:db GREEN.
- **0203 fallout fixed in harnesses:** customers.payment_mode NOT NULL →
  3 seeds updated; R8 INVERTED (paid invoices now void directly, by design);
  R9 raise text updated.
- **DEVIATION:** archive returnCustomerBalance NOT switched to record_refund
  — legacy surface, Batch 2–3. Nothing new reads v_customer_prepaid_balance.
- **NEXT:** Turki verifies checklist → commit Batch 1 → Batch 2–3 (legacy
  surfaces onto ledger) → 0204 drops old views/tables + projects.payment_mode.
- **IBAN CLOSED (bf3dedd):** driver/staff SA+22 HARD; mod-97 WARNS only.
- **0202 bank export CLOSED:** lib/bank-transfer.ts IS the contract.
- **Person names locale-aware app-wide (personName*). Views untouched.**
- **Vehicles:** lib/vehicle-groups/-types/capacity/fleet-tabs — never re-derive.
- **PARKED:** snapshot-drop STEP 2 (Turki, SQL Editor); leaked-password
  protection OFF in Supabase Auth.
- **CARRIED:** web-design-guidelines + vercel-composition-patterns missing.

## Rules
- CLAUDE.md = rules. Read it, NEVER append.
- .claude/skills/aquafleet-domain/SKILL.md = domain rules. NEVER append.
- Money/migration gate: draft, STOP, architect reviews.
- Session cap: 15 turns. First compaction = wrap up.
- This file stays under 2KB. If larger, Code is appending diary. Cut it.
