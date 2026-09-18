# SESSION HANDOFF

## State
- **DB at 0202, PROD + TEST.** Migration FILES authoritative. Repo
  UNLINKED = no `db push`.
- **IBAN CLOSED (bf3dedd):** driver/staff shape HARD (SA+22, DB) + mod-97
  `ibanChecksumOk` WARNS only (Turki 2026-09-17). Server never calls it —
  scripts/iban-check.ts grep-asserts. Company module (lib/bankAccounts.ts)
  has NO checksum (2026-09-05 ruling). Two rulings, deliberate.
- **PERMIT DECLARATION CLOSED (77b7fd1):** print-only, signature section,
  every permit, EN+AR verbatim (i18n printDeclaration*).
  `signatures(items, declaration?)` — no-declaration path byte-identical.
- **Shell guard (282050f):** scripts/repo-root-check.sh (INIT_CWD) gates
  npm test / test:db (CLAUDE.md §5).
- **0202 bank export CLOSED:** `lib/bank-transfer.ts` IS the contract (not
  i18n), CP1256 bytes, frozen money + live routing pair rule, digits fold
  at row boundary. 45 checks in test:money.
- **ENABLE/EMIT RULE — all nine report exports.** `resolveCsvRegistration`:
  nothing to emit = null = disabled button. Never register a raw builder.
- **Person names locale-aware app-wide (personName / personNameById,
  lib/i18n.ts). Views untouched.**
- **Vehicles:** grouping/naming/capacity/tabs live in lib/vehicle-groups,
  vehicle-types, capacity, fleet-tabs — never re-derive.
  `v_fleet_state_now` includes operation vehicles ON PURPOSE.
- **PARKED:** snapshot-drop STEP 2 (`drop-ledger-snapshot-2026-09-16.sql`)
  — Turki's, SQL Editor. Undo = `schema_migrations_backup_20260916`.
- **PARKED:** leaked-password protection OFF in Supabase Auth.
- **CARRIED:** web-design-guidelines + vercel-composition-patterns not
  installed. Use `preview/` + `frontend-design`, say so.

## Rules
- CLAUDE.md = rules. Read it, NEVER append.
- .claude/skills/aquafleet-domain/SKILL.md = domain rules. NEVER append.
- Money/migration gate: draft, STOP, architect reviews.
- Session cap: 15 turns. First compaction = wrap up.
- This file stays under 2KB. If larger, Code is appending diary. Cut it.
