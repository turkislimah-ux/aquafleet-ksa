# SESSION HANDOFF

## State
- **main = 6500512. DB at 0204** (prod + test). Branch **prepaid-adjustments**:
  a8d14c7 = Batch 3 + the 0204 file, 0ee08da = Fix Group 1, 2bcd6f3 = Mark
  Paid. **Statement label + order work UNCOMMITTED.**
- **0204 law:** confirm moves NO money — freezes amount_payable = grand_total.
  record_refund is SEVEN args (p_photo_path 5th); the 6-arg one is DROPPED.
  Its proof guard runs BEFORE the Available cap — a cap test needs cash.
- **Mark Paid** is the ONE settlement action. Prepaid: dialog states draw =
  min(Available + remainder, remainder) — the ADD-BACK is load-bearing, a
  plain min understates it — then apply, re-read, shortfall opens the cash
  form. DB §J proves 3 flows.
- **Statement:** invoice_payments is a 5th source, recordOnly — only ledger
  rows advance the run. 0204's doors are DISJOINT; no de-dup, do not add one.
  `payments` is LEGACY-ONLY (amount_payable_sar == null). balance_applied =
  "Invoice paid" + Method "Prepaid balance"; invoice_payments = "Shortfall
  payment" + own method; legacy + invoice_draw unchanged. TIMED money rows
  share rank 0 sorted by created_at, so a settlement's halves stay adjacent.
- **hide-from-customer** omits the trips section WHOLE on print/PDF (PDF v8).
- **Era:** invoiceEra() in **lib/invoice-era.ts** — NOT a status test.
- **Gap:** balance returns render as the 0203 refund row.
- **PARKED:** snapshot-drop STEP 2 (SQL Editor); leaked-password OFF.
  **CARRIED:** skills web-design-guidelines + vercel-composition.

## Rules
- **NEVER build into .next while dev is up** — it overwrites the running
  server's cache (cost a session 3x). `npm run build` routes through
  scripts/safe-build.sh and REFUSES; use `npm run build:verify`.
- CLAUDE.md = rules; aquafleet-domain/SKILL.md = domain rules. NEVER append.
- Money/migration gate: draft, STOP, architect reviews.
- Session cap: 15 turns. First compaction = wrap up.
- This file stays under 2KB. If larger, Code is appending diary. Cut it.
