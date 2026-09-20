# SESSION HANDOFF

## State
- **Batch 1 = 48a2f1b, Batch 2 = 6500512. DB at 0204** (applied by Turki to
  prod + test; the file is still UNTRACKED — stage it with the commit).
- **PREPAID BATCH 3 BUILT — UNCOMMITTED, awaiting Turki's in-browser pass.**
  Ten items: merged statement timeline · confirmed-phase panel shows payable
  vs Available · Add Balance in the ledger popup (AddBalanceForm.tsx, new) ·
  refund photo · Balance/Remaining under the Trips subtotal ·
  hide-from-customer · invoices by period_end desc · settlement on print+PDF ·
  bank_transfer proof everywhere.
- **Item 1 REDONE.** invoice_payments is a 5th statement source (ranks
  0/1|2/3/4), recordOnly — only ledger rows advance the run. Safe because
  0204's money doors are DISJOINT: apply_balance_to_invoice writes only
  customer_ledger, record_invoice_payment only invoice_payments. No de-dup
  exists; do not add one. `payments` is LEGACY-ONLY now (amount_payable_sar
  == null) or a modern invoice prints twice.
- **0204 law:** confirm moves NO money — freezes amount_payable = grand_total.
  record_refund is SEVEN args (p_photo_path 5th); the 6-arg one is DROPPED.
  Its proof guard runs BEFORE the Available cap — a cap test must use cash.
- **Era:** invoiceEra() in **lib/invoice-era.ts** — NOT a status test.
- **Gap:** balance returns render as the 0203 refund ledger row.
- **PARKED:** snapshot-drop STEP 2 (Turki, SQL Editor); leaked-password
  protection OFF. **CARRIED:** skills web-design-guidelines +
  vercel-composition-patterns absent.

## Rules
- **NEVER build into .next while dev is up** — it overwrites the running
  server's cache. Third incident cost a session. `npm run build` now routes
  through scripts/safe-build.sh and REFUSES; use `npm run build:verify`.
- CLAUDE.md = rules; aquafleet-domain/SKILL.md = domain rules. NEVER append.
- Money/migration gate: draft, STOP, architect reviews.
- Session cap: 15 turns. First compaction = wrap up.
- This file stays under 2KB. If larger, Code is appending diary. Cut it.
