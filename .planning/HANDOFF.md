# SESSION HANDOFF

## State
- DB at 0200. Tree clean.
- **0200 APPLIED TO PROD + VERIFIED (ef45248)** — exit-permit write-offs, DB
  half. Applied 2026-09-15 via `.planning/post-deploy/apply-0200-prod.mjs`
  (archive, NOT a test — never put a prod socket in `npm test`). Part B verify
  self-rolls-back: 11/11 claims, zero residue, August P&L unchanged at 3589,
  dashboard overdue 2→1, security 50/50/0, restated RPCs still secdef+pinned.
- **0199 §1 APPLIED (0a20682)** — 50 views SELECT-only. Default-ACL half
  DEFERRED at `.planning/post-deploy/0199b-default-acl-revoke.sql`.
- **PENDING — ledger reconcile.** Prod = 133 timestamp rows, local dir =
  0001-style. `supabase db push` at prod would replay history. Do not run it.
- **CARRIED, not blocking:** leaked-password protection OFF in Supabase Auth;
  prod has `reconcile_0193_trigger_fn_text` with no local file.

## Rules
- CLAUDE.md = rules. Read it, NEVER append.
- .claude/skills/aquafleet-domain/SKILL.md = domain rules. NEVER append.
- Money/migration gate: draft, STOP, architect reviews.
- Session cap: 15 turns. First compaction = wrap up.
- This file stays under 2KB. If larger, Code is appending diary. Cut it.

## Current work
- **NEXT AND LAST BUILD — write-off UI** (0200's app half). Write off /
  reverse on an EXITED returnable permit, written-off chip, EN+AR RTL, printed
  permit shows it. `outstanding = qty − qty_returned − qty_written_off` goes in
  ONE place in lib/exit-permits.ts; the compiler finds the rest (07b1655
  proved it). Turki verifies on EP-26-0004 (190 SAR, due 2026-08-04): write
  off, see 190 land in this month's Cost/P&L, reverse, confirm credit back.
- ATLAS reports COMPLETE. 88 sheets; a moved page count FAILS until
  `doc-a4-proof.mjs --update`. Notifications + Settings COMPLETE.
- **07b1655 — never correct data to suit a reader.** `qty_returned` counts
  RETURN EVENTS; 0093:820 leaves it alone on a void. Readers were wrong, not
  rows. The expanded row's **Returned** column means "back by ANY route".
