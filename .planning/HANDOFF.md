# SESSION HANDOFF

## State
- **main = 1413e67. DB at 0208** (prod + test). Prepaid rebuild + legacy
  removal COMPLETE; no branches. Gates green (637 DB).
- **LEDGER IS THE ONLY MODEL.** 0207 dropped both pool views,
  return_customer_balance, the dummy tables, the invoice trip-id arrays,
  projects.payment_mode. prepaid.ts gone; money.ts = primitives.
- **0204:** confirm moves NO money — freezes amount_payable = grand_total.
  record_refund = the ONE refund door, capped by Available.
- **Mark Paid** = the ONE settlement. Draw = min(Available + claim, claim) —
  ADD-BACK load-bearing — balanceDrawPreview(); then cash.
- **Balance/Remaining** = ledgerDrawFrom(): LAST UNREVERSED draw/applied,
  walked (created_at, id). Draft/review project them live.
- **Statement run = AVAILABLE**. draw/applied/reversal move it 0; trip/charge
  deduct round2(gross) at delivery; invoice_payments add; LEGACY in neither.
  DATED entry_date, ORDERED created_at.
- **customers.payment_mode = the ONE authority**, written only by the project
  RPCs behind can_switch_payment_mode.
- **confirm_invoice = 18 args**; trip linkage = DRAFT reservation (0030).
- **Trips say paid/unpaid**; screen inks the tail, paper uses words.
- **Era:** invoiceEra() in lib/invoice-era.ts — NOT a status test.
- **29 legacy invoices** render from frozen columns — do NOT drop them.
- **0208:** customer_ledger.entry_date — operator-picked, any date incl.
  future; record_topup 8 args. Balance/Available NEVER date-filtered.
- **StickyTabs** (ui.tsx) pins the tabs on the 8 tabbed pages. Its `top-14`
  IS the header's h-14 — move one, move both.
- **PARKED (deploy):** dummy wipe; snapshot-drop STEP 2; leaked-password off.

## Rules
- **NEVER build into .next while dev is up** — `build` REFUSES via
  safe-build.sh; use `build:verify`. Dev rewrites tsconfig.json — restore it,
  never stage it.
- CLAUDE.md + domain SKILL.md = rules. NEVER append.
- Migration gate: draft, STOP, review. Cap 15 turns.
- Under 2KB. If larger, Code is appending diary.
