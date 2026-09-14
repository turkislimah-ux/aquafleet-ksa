# SESSION HANDOFF

## State
- DB at 0198. `ls supabase/migrations/ | tail -5`. `git log --oneline -10`.
- **0198 APPLIED (2a0b9ca)** — notification_thresholds read-only to
  authenticated, verified.
- Payouts-N column-head fix committed (bcd33c9). Tree clean, nothing in flight.

## Rules
- CLAUDE.md = rules. Read it, NEVER append.
- .claude/skills/aquafleet-domain/SKILL.md = domain rules. NEVER append.
- Money/migration gate: draft, STOP, architect reviews.
- Session cap: 15 turns. First compaction = wrap up.
- This file stays under 2KB. If larger, Code is appending diary. Cut it.

## Current work
- ATLAS printable reports COMPLETE. `npm test` (typecheck+money+copy+sheets,
  ~30s) before committing; `test:db` reads the live DB, schema/RPC work only.
  88 sheets, and a moved page count FAILS until `doc-a4-proof.mjs --update`.
- **Notifications + Settings COMPLETE**, audited against the live DB
  2026-09-14. `v_active_alerts` (derived live, no cron) to
  `v_my_notifications` to the bell in AppShell; Settings writes
  `notification_prefs` + `notification_thresholds_user`, both read back.
  12 live alerts, every kind formatted and every entity routed.
- **0197 APPLIED.** Exit-permit cost recognition: `status='exited' and
  kind='permanent'` in base `v_parts_consumption_daily`, so returnable and
  voided permits no longer reach the P&L. Aug 2026 net moved +190 to correct
  (parts 3779 to 3589); Q3/year the same. Maintenance table unmoved.
- **CARRIED FORWARD — three, none blocking:**
  (i) No written-off status, so a returnable permit whose parts never return
  is never expensed. No screen shows the AMOUNT; the permit itself DOES
  surface, as `permit_overdue`. EP-26-0004 live: 190 SAR, due 2026-08-04.
  (ii) EP-26-0001: voided, line counters say 40,000 SAR still out, ledger
  says zero.
  (iii) All 50 views grant the full 7-privilege default to authenticated.
  CLAUDE.md §6's footer only revokes anon, so it never catches this.
