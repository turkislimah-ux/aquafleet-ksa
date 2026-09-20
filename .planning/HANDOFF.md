# SESSION HANDOFF

## State
- **Batch 1 COMMITTED (48a2f1b).** DB at 0203.
- **PREPAID BATCH 2 BUILT — UNCOMMITTED, awaiting Turki's in-browser pass.**
  Ledger invoice flow: doc + print carry Prepaid Applied / Amount Payable
  (invoiceViewModel settlementRows + hero, both renderers, i18n) · invoice.ts
  prepaid arm drops the FIFO split (covered 0/0/0, due==grand) · invoiceActions
  pass p_actor + recordInvoicePayment + applyBalanceToInvoice ·
  InvoiceDetailModal settlement panel: partial pay, apply balance,
  void-from-paid, unpay gate, history · CreateTripForm warns, never blocks,
  when prepaid Available < price.
- **Era:** invoiceEra() in **lib/invoice-era.ts** — draft/review = ledger, else
  amount_payable_sar != null. NOT a status test. Was in invoiceActions, BROKE
  THE BUILD ("use server" exports only async fns). Never async a pure helper to
  silence it — move it out.
- **Tests added:** db/invoice-settlement-check (test:db) · invoice-flow-check
  (test:money) · server-action-export-check.mjs (test:guards, catches the
  above) · invoice-page-proof (REPORT only, no page baseline exists).
  npm test + test:db + build GREEN; ledger docs 1pp, download == print.
- **Batch 3 (NOT touched, deliberate):** Dashboard/Reports receivables and
  archive returnCustomerBalance still legacy. Then 0204 drops old views/tables
  + projects.payment_mode (EDIT surface only).
- **CLOSED:** IBAN (bf3dedd) · 0202 bank export (lib/bank-transfer.ts IS
  contract) · personName* locale-aware. **Vehicles:** lib/vehicle-groups/
  -types/capacity/fleet-tabs — never re-derive.
- **PARKED:** snapshot-drop STEP 2 (Turki, SQL Editor); leaked-password
  protection OFF in Auth. **CARRIED:** skills web-design-guidelines +
  vercel-composition-patterns absent.

## Rules
- CLAUDE.md = rules; aquafleet-domain/SKILL.md = domain rules. NEVER append.
- Money/migration gate: draft, STOP, architect reviews.
- Session cap: 15 turns. First compaction = wrap up.
- This file stays under 2KB. If larger, Code is appending diary. Cut it.
