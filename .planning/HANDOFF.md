# SESSION HANDOFF

## State
- DB at 0200. Tree clean.
- **0200 APPLIED TO PROD + VERIFIED (ef45248)** — write-offs, DB half, via
  `.planning/post-deploy/apply-0200-prod.mjs` (archive, NOT a test — never put
  a prod socket in `npm test`). 11/11, zero residue.
- **0199 §1 APPLIED (0a20682)** — 50 views SELECT-only. Default-ACL half
  DEFERRED at `.planning/post-deploy/0199b-default-acl-revoke.sql`.
- **LEDGER RECONCILE DONE (f2e6938).** Prod AND test both 198 rows, 0001..0200
  (0135/0136 absent), 1:1 with the files, no drift or orphans, verified live.
  Files are source of truth: `db push` / `db diff` / rebuild valid once linked.
  Repo stays UNLINKED = no push path. UNDO = prod table
  `supabase_migrations.schema_migrations_backup_20260916` (133 rows, fp
  `4bdf5ea8`).
- **0200 verify exits 0 on success** (NOTICE, not a raise), SKIPPED when the DB
  has no exit-permit data. Prevention -> detection trade in the header.
- **CARRIED:** leaked-password protection OFF in Supabase Auth.

## Rules
- CLAUDE.md = rules. Read it, NEVER append.
- .claude/skills/aquafleet-domain/SKILL.md = domain rules. NEVER append.
- Money/migration gate: draft, STOP, architect reviews.
- Session cap: 15 turns. First compaction = wrap up.
- This file stays under 2KB. If larger, Code is appending diary. Cut it.

## Current work
- **ALL BUILDS COMPLETE.** Write-off UI shipped (bb44c90); Notifications,
  Settings, ATLAS done. Corpus = 114 sheets; a moved page count FAILS until
  `doc-a4-proof.mjs --update`. `--clearance` shipped (0d0a655).
- **ARABIC DATES (1bb97ae).** UAX#9 W2: an Arabic month (class AL) re-types EN
  digits to AN, so a one-isolate date scrambles. Cure = TWO isolates
  (`isoUnit`). Measure per-character (`Range` x), never by screenshot.
- **SHEETS (374825e, 2f3c031), argued at their code sites:** isolate at the
  CELL never the column; `.mast` margin COLLAPSES; spacing is scoped `extraCss`.
- **07b1655 — never correct data to suit a reader.** `qty_returned` counts
  RETURN EVENTS; the readers were wrong.
