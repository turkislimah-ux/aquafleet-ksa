# SESSION HANDOFF

## State
- DB at latest migration (0197). `ls supabase/migrations/ | tail -5`.
- `git log --oneline -10` for commits.

## Rules
- CLAUDE.md = rules. Read it, NEVER append to it.
- .claude/skills/aquafleet-domain/SKILL.md = domain rules. NEVER append.
- Money/migration gate: draft → STOP → architect reviews.
- Session cap: 15 turns. First compaction = wrap up.
- This file stays under 2KB. If larger, Code is appending diary. Cut it.

## Current work
- **ATLAS printable reports: COMPLETE.** `lib/atlas/` + `lib/docvm/` +
  `lib/docs/`, EN and AR as separate documents.
- `npm test` = typecheck + money + copy + sheets, ~30s, before committing.
  `test:db` reads the live DB — schema/RPC/action work only. `doc:render`
  writes 88 sheets; counts diff `scripts/doc-page-counts.json`, a moved sheet
  FAILS until `doc-a4-proof.mjs --update` re-cuts it.
- **0197 APPLIED + verified.** Exit-permit cost recognition: a part that left
  the warehouse is a cost only if it is not coming back. `status='exited' and
  kind='permanent'` in base `v_parts_consumption_daily` — returnable and
  voided permits no longer reach the P&L. Aug 2026 net moved +190 to correct
  (parts 3779→3589); Q3/year same 190; maintenance table unmoved. Also
  dropped a dead `and p.truck_id is not null` (truck_id is NOT NULL). Cost
  sheet bar now splits Maintenance parts / Other stock issued.
- **CARRIED FORWARD — two tickets, neither blocking:**
  (i) No written-off status exists (draft/exited/voided only), so a returnable
  permit whose parts never return is never expensed, and that stock is neither
  cost nor on-hand — no screen shows it. EP-26-0004 is live in this state:
  190 SAR, due back 2026-08-04. Needs a status + UI, not a view predicate.
  (ii) EP-26-0001: voided, line counters say 40,000 SAR still out while its
  ledger nets to zero. 0197 shields the P&L; the rows are still wrong.
- Open: StatementViews.tsx ~:1080 prints "Payouts N" under the AMOUNT head.
- Notifications + Settings feature in progress.
