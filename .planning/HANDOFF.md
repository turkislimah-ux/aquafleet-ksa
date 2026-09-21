# SESSION HANDOFF

## State
- **main = 5d5fa6d. DB at 0205** (prod + test). prepaid-adjustments merged
  and deleted; work on prepaid-legacy-removal. Gates green.
- **0204:** confirm moves NO money — freezes amount_payable = grand_total.
  record_refund SEVEN args (p_photo_path 5th); 6-arg DROPPED; its proof
  guard precedes the Available cap, so cap tests use cash.
- **Mark Paid** = the ONE settlement action. Prepaid draw =
  min(Available + remainder, remainder) — ADD-BACK load-bearing. Shortfall
  opens the cash form.
- **0205:** four *_ledger_balance/remaining DROPPED, confirm_invoice 21 args
  (*_subtotal STAY — legacy doc reads them). Balance/Remaining DERIVED by
  ledgerDrawFrom() in lib/invoiceViewModel.ts: LAST UNREVERSED draw/applied,
  walked (created_at, id).
- **Statement run = AVAILABLE** (v_customer_available), not Balance.
  draw/applied/reversal move it 0 (Amount still prints); trip/charge deduct
  round2(gross) at delivery; invoice_payments add. LEGACY-invoice items
  excluded — in neither term. Headline = available_sar; ledger-check.ts
  walks it in SQL.
- **Sources:** invoice_payments 5th; 0204 doors DISJOINT, no de-dup;
  `payments` LEGACY-ONLY; TIMED rows sort created_at, rank 0.
- **Trips say paid/unpaid** (invoiceLocked). Label = stem + tail; screen inks
  the TAIL only, paper carries it in words (monochrome by design).
- **ONE uninvoiced count** — fetchUninvoicedTripCounts; invoiceLocked is
  status='paid', never count with it.
- **hide-from-customer** omits the trips section WHOLE on print/PDF.
- **Era:** invoiceEra() in lib/invoice-era.ts — NOT a status test.
- **Gap:** balance returns render as the 0203 refund row.
- **PARKED:** snapshot-drop STEP 2 (SQL Editor); leaked-password off.

## Rules
- **NEVER build into .next while dev is up** — `npm run build` REFUSES via
  safe-build.sh; use `npm run build:verify`.
- CLAUDE.md + domain SKILL.md = rules. NEVER append.
- Migration gate: draft, STOP, review. Cap 15 turns.
- Stays under 2KB. If larger, Code is appending diary.
