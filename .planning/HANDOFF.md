# SESSION HANDOFF

## State
- DB at 0200. Tree clean.
- **0200 APPLIED TO PROD + VERIFIED (ef45248)** — write-offs, DB half, via
  `.planning/post-deploy/apply-0200-prod.mjs` (archive, NOT a test — never put
  a prod socket in `npm test`). Verify self-rolls-back; 11/11, zero residue.
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
- **ALL BUILDS COMPLETE.** Write-off UI shipped (bb44c90); Notifications,
  Settings, ATLAS done. Corpus = 114 sheets; a moved page count FAILS until
  `doc-a4-proof.mjs --update`.
- **ARABIC DATES (1bb97ae).** UAX#9 W2: an Arabic month is class AL and
  re-types EN digits after it to AN, so a one-isolate date scrambles. Cure is
  TWO isolates (`isoUnit`). `dir="ltr"` sets the base LEVEL, not a character's
  class — cannot fix it. Measure bidi per-character (`Range` x); a screenshot
  reorders it and is not evidence.
- **SHEETS (374825e, 2f3c031), argued at their code sites:** isolate a date at
  the CELL, never the column; `.mast` margin COLLAPSES, so a masthead spacing
  rule buys 0px; sheet spacing is scoped `extraCss`, never kit.
- **NEXT, agreed:** `--clearance` on `doc-a4-proof.mjs` — px from each sheet's
  last break, so the next orphan shows early.
- **07b1655 — never correct data to suit a reader.** `qty_returned` counts
  RETURN EVENTS; the readers were wrong.
