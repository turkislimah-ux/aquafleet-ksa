# SESSION HANDOFF

## State
- **main = 6500512. DB at 0204** (prod + test). Branch
  **prepaid-adjustments**: a8d14c7 = Batch 3 + the 0204 file, 0ee08da = Fix
  Group 1. **Fix Group 2 (Mark Paid) UNCOMMITTED.**
- **Fix Group 1:** Add Balance ONLY from the ledger popup · hide-from-customer
  omits the trips section WHOLE on print/PDF (charges-only totals, Amount
  Payable = charges total, screen unchanged, PDF v8) · subtotal note once.
- **Statement:** invoice_payments is a 5th source, recordOnly — only ledger
  rows advance the run. 0204's money doors are DISJOINT; no de-dup exists, do
  not add one. `payments` is LEGACY-ONLY (amount_payable_sar == null) or a
  modern invoice prints twice.
- **0204 law:** confirm moves NO money — freezes amount_payable = grand_total.
  record_refund is SEVEN args (p_photo_path 5th); the 6-arg one is DROPPED.
  Its proof guard runs BEFORE the Available cap — a cap test needs cash.
- **Mark Paid** is the ONE settlement action (Settlement block + the two
  buttons deleted). Prepaid: dialog states draw = min(Available + remainder,
  remainder) — the ADD-BACK is load-bearing, plain min understates every draw
  — apply, re-read, shortfall opens the cash form. Postpaid goes straight
  there. DB §J proves all three flows.
- **Era:** invoiceEra() in **lib/invoice-era.ts** — NOT a status test.
- **Gap:** balance returns render as the 0203 refund row.
- **PARKED:** snapshot-drop STEP 2 (Turki, SQL Editor); leaked-password OFF.
  **CARRIED:** skills web-design-guidelines + vercel-composition.

## Rules
- **NEVER build into .next while dev is up** — it overwrites the running
  server's cache. Third incident cost a session. `npm run build` routes
  through scripts/safe-build.sh and REFUSES; use `npm run build:verify`.
- CLAUDE.md = rules; aquafleet-domain/SKILL.md = domain rules. NEVER append.
- Money/migration gate: draft, STOP, architect reviews.
- Session cap: 15 turns. First compaction = wrap up.
- This file stays under 2KB. If larger, Code is appending diary. Cut it.
