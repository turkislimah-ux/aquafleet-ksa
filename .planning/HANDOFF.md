# SESSION HANDOFF

## State
- **main = 7e694ec. DB at 0207** (prod + test). Prepaid rebuild + legacy
  removal COMPLETE on main; no branches. Gates green (626 DB assertions).
- **LEDGER IS THE ONLY MODEL.** 0207 dropped both pool views,
  return_customer_balance, customer_topups, customer_balance_returns, invoice
  trip-id arrays, projects.payment_mode. prepaid.ts gone; money.ts =
  primitives + consumingItems. 5 harnesses retired into invoice-flow-check.
- **0204:** confirm moves NO money — freezes amount_payable = grand_total.
  record_refund = the ONE refund door, capped by Available.
- **Mark Paid** = the ONE settlement action. Draw = min(Available + claim,
  claim) — ADD-BACK load-bearing — balanceDrawPreview(). Shortfall opens cash.
- **Balance/Remaining** = ledgerDrawFrom(): LAST UNREVERSED draw/applied,
  walked (created_at, id). Draft/review project the same two off the live
  account (projectedLedgerDraw) — display, freeze nothing.
- **Statement run = AVAILABLE**, not Balance. draw/applied/reversal move it 0;
  trip/charge deduct round2(gross) at delivery; invoice_payments add; LEGACY
  items in neither term. ledger-check walks it.
- **customers.payment_mode = the ONE authority.** Written only by the two
  project RPCs, behind can_switch_payment_mode.
- **confirm_invoice = 18 args.** No covered lines, no trip-id arrays; trip
  linkage = the DRAFT reservation (0030).
- **Trips say paid/unpaid**; screen inks the tail, paper uses words.
- **Era:** invoiceEra() in lib/invoice-era.ts — NOT a status test.
- **29 legacy invoices** render from frozen columns — do NOT drop them.
- **OPEN:** Add Balance date field ignored (ledger stamps created_at).
- **PARKED (deploy):** dummy wipe; snapshot-drop STEP 2; leaked-password off.

## Rules
- **NEVER build into .next while dev is up** — `npm run build` REFUSES via
  safe-build.sh; use `build:verify`.
- CLAUDE.md + domain SKILL.md = rules. NEVER append.
- Migration gate: draft, STOP, review. Cap 15 turns.
- Under 2KB. If larger, Code is appending diary.
