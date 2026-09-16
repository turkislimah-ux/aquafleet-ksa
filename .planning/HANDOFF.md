# SESSION HANDOFF

## State
- DB at 0200.
- **0200 APPLIED TO PROD + VERIFIED (ef45248)** — write-offs, DB half, via
  `apply-0200-prod.mjs` (archive, NOT a test — no prod socket in `npm test`).
  Verify exits 0 (NOTICE not raise), SKIPPED on empty data.
- **0199 §1 APPLIED (0a20682)** — 50 views SELECT-only. Half 2 DEFERRED at
  `0199b-default-acl-revoke.sql`.
- **LEDGER RECONCILE DONE (f2e6938).** Prod AND test 198 rows, 0001..0200
  (0135/0136 absent), 1:1 with files, verified live. Files = source of truth;
  `db push`/`db diff`/rebuild valid once linked. Repo UNLINKED = no push.
- **SNAPSHOT DROP DRAFTED, NOT RUN (fb900fe, notice 9eed78d).** Undo = prod
  `schema_migrations_backup_20260916`, 133 rows.
  `drop-ledger-snapshot-2026-09-16.sql`: STEP 1 ran GREEN on prod and is proven
  able to RAISE; STEP 2 = Turki drops it, SQL Editor. The 7 bodies that lived
  ONLY there are md5-exact in `ledger-orphan-bodies-2026-09-16.sql` (580d42b)
  — drop costs only the undo.
- **CARRIED:** leaked-password protection OFF in Supabase Auth.

## Rules
- CLAUDE.md = rules. Read it, NEVER append.
- .claude/skills/aquafleet-domain/SKILL.md = domain rules. NEVER append.
- Money/migration gate: draft, STOP, architect reviews.
- Session cap: 15 turns. First compaction = wrap up.
- This file stays under 2KB. If larger, Code is appending diary. Cut it.

## Current work
- **ALL BUILDS COMPLETE** — write-off UI (bb44c90), Notifications, Settings,
  ATLAS, `--clearance` (0d0a655). Corpus = 114 sheets; a moved page count
  FAILS until `doc-a4-proof.mjs --update`.
- **ARABIC DATES (1bb97ae).** UAX#9 W2: an Arabic month (AL) re-types EN
  digits to AN, so one isolate scrambles. Cure = TWO isolates
  (`isoUnit`). Measure per-character (`Range` x), never by screenshot.
- **SHEETS (374825e, 2f3c031), argued at code sites:** isolate at the CELL not
  the column; `.mast` margin COLLAPSES; spacing scoped `extraCss`.
- **07b1655 — never correct data to suit a reader.** `qty_returned` counts
  RETURN EVENTS; the readers were wrong.
