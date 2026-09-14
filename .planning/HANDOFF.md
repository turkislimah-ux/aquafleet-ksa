# SESSION HANDOFF

## State
- DB at 0199. `ls supabase/migrations/ | tail -5`. `git log --oneline -10`.
- **0198 APPLIED (2a0b9ca)** — notification_thresholds read-only to authenticated.
- **0199 SECTION 1 APPLIED (0a20682)** — 50 views SELECT-only for authenticated;
  committed == applied. Default-ACL half DEFERRED to post-deploy RBAC, parked
  outside migrations at `.planning/post-deploy/0199b-default-acl-revoke.sql`.
- Tree clean, nothing in flight.

## Rules
- CLAUDE.md = rules. Read it, NEVER append.
- .claude/skills/aquafleet-domain/SKILL.md = domain rules. NEVER append.
- Money/migration gate: draft, STOP, architect reviews.
- Session cap: 15 turns. First compaction = wrap up.
- This file stays under 2KB. If larger, Code is appending diary. Cut it.

## Current work
- ATLAS printable reports COMPLETE. 88 sheets; a moved page count FAILS until
  `doc-a4-proof.mjs --update`.
- **Notifications + Settings COMPLETE**, audited live 2026-09-14; 12 alerts,
  every kind formatted and routed.
- **0197 APPLIED.** Returnable and voided permits no longer reach the P&L.
- **EP-26-0001 CLOSED (07b1655) — never corrupt data.** `qty_returned` counts
  what came back through a RETURN EVENT, and 0093:820 deliberately leaves it
  alone on a void, a void being a cancellation. The readers were wrong, not the
  rows. Five ungated `qty - qty_returned` readers now treat voided AND draft
  permits as nothing-outstanding, via `permitLineOutstanding`/`permitValueSar`
  in lib/exit-permits.ts — both take the permit, so the compiler finds callers.
  Remember: the expanded row's **Returned** column means "back by ANY route", so
  a voided permit shows the void-restored qty while the counter stays 0.
- **CARRIED FORWARD — one, not blocking:** no written-off status, so a
  returnable permit whose parts never return is never expensed. No screen shows
  the AMOUNT; the permit DOES surface, as `permit_overdue`. EP-26-0004 live:
  190 SAR, due 2026-08-04.
