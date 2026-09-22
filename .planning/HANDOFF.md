# SESSION HANDOFF

## State
- **main = 7e694ec. DB at 0208** (prod + test). Prepaid rebuild + legacy
  removal COMPLETE; no branches. Gates green (637 DB assertions).
- **LEDGER IS THE ONLY MODEL.** 0207 dropped both pool views,
  return_customer_balance, the dummy tables, the invoice trip-id arrays,
  projects.payment_mode. prepaid.ts gone; money.ts = primitives.
- **0204:** confirm moves NO money — freezes amount_payable = grand_total.
  record_refund = the ONE refund door, capped by Available.
- **Mark Paid** = the ONE settlement. Draw = min(Available + claim, claim) —
  ADD-BACK load-bearing — balanceDrawPreview(). Then cash.
- **Balance/Remaining** = ledgerDrawFrom(): LAST UNREVERSED draw/applied,
  walked (created_at, id). Draft/review project the same two live
  (projectedLedgerDraw).
- **Statement run = AVAILABLE**. draw/applied/reversal move it 0; trip/charge
  deduct round2(gross) at delivery; invoice_payments add; LEGACY items in
  neither. Rows DATED entry_date, ORDERED created_at.
- **customers.payment_mode = the ONE authority**, written only by the project
  RPCs behind can_switch_payment_mode.
- **confirm_invoice = 18 args**; trip linkage = the DRAFT reservation (0030).
- **Trips say paid/unpaid**; screen inks the tail, paper uses words.
- **Era:** invoiceEra() in lib/invoice-era.ts — NOT a status test.
- **29 legacy invoices** render from frozen columns — do NOT drop them.
- **0208:** customer_ledger.entry_date — operator-picked on a top-up, any date
  incl. future; record_topup 8 args. Balance/Available NEVER date-filtered.
- **PARKED (deploy):** dummy wipe; snapshot-drop STEP 2; leaked-password off.

## Rules
- **NEVER build into .next while dev is up** — `build` REFUSES via
  safe-build.sh; use `build:verify`.
- CLAUDE.md + domain SKILL.md = rules. NEVER append.
- Migration gate: draft, STOP, review. Cap 15 turns.
- Under 2KB. If larger, Code is appending diary.
