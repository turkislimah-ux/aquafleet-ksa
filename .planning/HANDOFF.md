# SESSION HANDOFF

## State
- **main = 6500512. DB at 0205** (prod + test). On prepaid-adjustments.
- **0204 law:** confirm moves NO money — freezes amount_payable = grand_total.
  record_refund is SEVEN args (p_photo_path 5th); 6-arg DROPPED. Its proof
  guard precedes the Available cap, so cap tests use cash.
- **Mark Paid** is the ONE settlement action. Prepaid: draw =
  min(Available + remainder, remainder) — ADD-BACK load-bearing — apply,
  re-read, shortfall opens cash form. DB J proves it.
- **0205:** four *_ledger_balance/remaining DROPPED, confirm_invoice 21 args
  (*_subtotal STAY — legacy doc reads them). Balance/Remaining DERIVED by
  ledgerDrawFrom() in lib/invoiceViewModel.ts: LAST UNREVERSED invoice_draw
  OR balance_applied, walked (created_at, id).
- **Statement run = AVAILABLE** (v_customer_available), not Balance.
  invoice_draw/balance_applied/draw_reversal move it 0 (Amount still prints);
  trip/charge deduct round2(gross) at delivery; invoice_payments add. Items
  on LEGACY invoices excluded — in neither term. Headline = available_sar.
  scripts/db/ledger-check.ts walks it in SQL.
- **Sources:** invoice_payments is the 5th; 0204 doors DISJOINT, no de-dup;
  `payments` LEGACY-ONLY. TIMED rows sort by created_at, rank 0.
- **Trip rows say paid/unpaid** (invoiceLocked). Label = stem + tail; screen
  inks the TAIL only, paper carries the words (monochrome by construction).
- **hide-from-customer** omits the trips section WHOLE on print/PDF.
- **Era:** invoiceEra() in lib/invoice-era.ts — NOT a status test.
- **Gap:** balance returns render as the 0203 refund row.
- **PARKED:** snapshot-drop STEP 2 (SQL Editor); leaked-password off.

## Rules
- **NEVER build into .next while dev is up** — `npm run build` REFUSES via
  scripts/safe-build.sh; use `npm run build:verify`.
- CLAUDE.md = rules; aquafleet-domain/SKILL.md = domain rules. NEVER append.
- Money/migration gate: draft, STOP, review. Session cap 15 turns.
- This file stays under 2KB. If larger, Code is appending diary.
