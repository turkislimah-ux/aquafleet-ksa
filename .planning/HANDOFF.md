# SESSION HANDOFF

## State
- **main = 1491877. DB at 0210** (prod + test). No branches. Gates green (637).
- **LEDGER IS THE ONLY MODEL.** 0207 dropped the pool views,
  return_customer_balance, the dummy tables, the trip-id arrays and
  projects.payment_mode. prepaid.ts gone; money.ts = primitives.
- **0204:** confirm moves NO money — freezes amount_payable = grand_total.
  record_refund = the ONE refund door, capped by Available.
- **Mark Paid** = the ONE settlement. Draw = min(Available+claim, claim) —
  ADD-BACK load-bearing — balanceDrawPreview(); then cash.
- **Balance/Remaining** = ledgerDrawFrom(): LAST UNREVERSED draw/applied,
  walked (created_at, id). Draft/review project live.
- **Statement run = AVAILABLE**. draw/applied/reversal move it 0; trip/charge
  deduct round2(gross) at delivery; invoice_payments add; LEGACY neither.
  DATED entry_date, ORDERED created_at.
- **0209/0210:** anon = 0 in public; authenticated closed on the 8 number
  generators + 6 trigger fns (definer callers only). vat_rate NOT pinned —
  stays inlinable (0190).
- **VERCEL request cap 4.5MB** — uploads gate 4MB/3.5MB; PDF fonts traced.
- **customers.payment_mode = the ONE authority**, written only by the
  project RPCs behind can_switch_payment_mode.
- **Trips say paid/unpaid**; screen inks the tail, paper uses words.
- **Era:** invoiceEra() (lib/invoice-era.ts) — NOT a status test.
- **29 legacy invoices** render from frozen columns — never drop.
- **0208:** customer_ledger.entry_date — operator-picked, any date incl
  future; record_topup 8 args. Balance/Available NEVER date-filtered.
- **PARKED:** dummy wipe; snapshot-drop STEP 2; leaked-password off.

## Rules
- **NEVER build into .next while dev is up** — `build` REFUSES via
  safe-build.sh; use `build:verify`. Dev rewrites tsconfig.json — restore,
  never stage.
- CLAUDE.md + domain SKILL.md = rules. NEVER append.
- Migration gate: draft, STOP, review. Cap 15 turns.
- Under 2KB; if larger, Code is appending diary.
