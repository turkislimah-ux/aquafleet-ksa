# SESSION HANDOFF

## State
- **DB at 0202, PROD + TEST.** Migration FILES are authoritative. Repo
  UNLINKED = no `db push`.
- **0202 CLOSED, VERIFIED IN-BROWSER:** bank details (a89ed87) + bank-transfer
  export (f0edd54). Payslips CSV = bank portal salary batch: Arabic headers
  byte-exact (`lib/bank-transfer.ts` IS the contract — not i18n), CP1256
  bytes (`lib/cp1256.ts`), frozen money + live routing (pair rule),
  Arabic-Indic digits folded at row boundary (`lib/digits.ts`, the one
  fold). Unissued rows amber via one status discriminant. 45 checks:
  `scripts/bank-transfer-check.ts` (test:money).
- **ENABLE/EMIT RULE — ALL nine report exports.** `resolveCsvRegistration`
  (lib/csv.ts) probes the builder at registration: nothing to emit = null
  registration = disabled button. `useCsvSource` wires it; builder deps must
  cover its rows AND period. Never register a raw builder.
- **OPERATION VEHICLES + TYPED CAPACITY: CLOSED** (aca7486, 366bb2f,
  058f09d). Grouping `lib/vehicle-groups.ts`, naming `lib/vehicle-types.ts`,
  capacity `lib/capacity.ts`, tabs `lib/fleet-tabs.ts` — never re-derive.
  `capacity_m3` arithmetic only; labels `formatCapacity`.
- **test:guards** (in npm test) — capacity-single-writer +
  trucks-write-surface, text-level.
- **`v_fleet_state_now` includes operation vehicles ON PURPOSE.** Utilization
  excludes them via `v_truck_day_state`. Do not reconcile.
- **PARKED:** snapshot-drop STEP 2 (`drop-ledger-snapshot-2026-09-16.sql`) —
  Turki's, SQL Editor. Undo = `schema_migrations_backup_20260916`; orphan
  bodies in 580d42b.
- **PARKED:** leaked-password protection OFF in Supabase Auth.
- **CARRIED:** `web-design-guidelines` + `vercel-composition-patterns` NOT
  installed. Use `preview/` + `frontend-design` and say so.

## Rules
- CLAUDE.md = rules. Read it, NEVER append.
- .claude/skills/aquafleet-domain/SKILL.md = domain rules. NEVER append.
- Money/migration gate: draft, STOP, architect reviews.
- Session cap: 15 turns. First compaction = wrap up.
- This file stays under 2KB. If larger, Code is appending diary. Cut it.
