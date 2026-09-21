# SESSION HANDOFF

## State
- **main = 6500512. DB at 0205** (prod + test). Branch prepaid-adjustments:
  a8d14c7 Batch 3 + 0204 -> 0ee08da Fix 1 -> 2bcd6f3 Mark Paid ->
  1023df3 statement rework -> 0205.
- **0204 law:** confirm moves NO money — freezes amount_payable = grand_total.
  record_refund is SEVEN args (p_photo_path 5th); 6-arg DROPPED. Its proof
  guard precedes the Available cap — cap tests use cash.
- **Mark Paid** is the ONE settlement action. Prepaid: draw =
  min(Available + remainder, remainder) — ADD-BACK load-bearing — apply,
  re-read, shortfall opens the cash form. DB J proves it.
- **0205:** four *_ledger_balance/remaining columns DROPPED, confirm_invoice
  is 21 args (*_subtotal STAY — legacy doc reads them). Balance/Remaining are
  DERIVED by ledgerDrawFrom() in lib/invoiceViewModel.ts (exported there — a
  "use server" module cannot): LAST UNREVERSED invoice_draw OR
  balance_applied row, walked (created_at, id). PDF v9.
- **Statement:** invoice_payments is a 5th source, recordOnly — only ledger
  rows advance the run. 0204's doors are DISJOINT; no de-dup. `payments` is
  LEGACY-ONLY. balance_applied = "Invoice paid" + "Prepaid balance";
  invoice_payments = "Shortfall payment" + own method. TIMED rows sort by
  created_at at rank 0, so a settlement's halves stay adjacent.
- **hide-from-customer** omits the trips section WHOLE on print/PDF.
- **Era:** invoiceEra() in lib/invoice-era.ts — NOT a status test.
- **Gap:** balance returns render as the 0203 refund row.
- **PARKED:** snapshot-drop STEP 2 (SQL Editor); leaked-password off.

## Rules
- **NEVER build into .next while dev is up** — overwrites the running
  server's cache (cost 3 sessions). `npm run build` REFUSES via
  scripts/safe-build.sh; use `npm run build:verify`.
- CLAUDE.md = rules; aquafleet-domain/SKILL.md = domain rules. NEVER append.
- Money/migration gate: draft, STOP, review.
- Session cap: 15 turns. First compaction = wrap up.
- This file stays under 2KB. If larger, Code is appending diary.
