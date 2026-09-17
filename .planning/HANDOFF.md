# SESSION HANDOFF

## State
- **DB at 0201, PROD + TEST.** Applied 2026-09-16 via Supabase MCP at Turki's
  instruction (the one exception to the draft-and-stop gate). Ledger stamped
  0201 on both; earlier reconcile rows condensed, migration FILES are
  authoritative. Repo UNLINKED = no `db push`.
- **OPERATION VEHICLES + TYPED CAPACITY: BUILT, VERIFIED IN-BROWSER, CLOSED.**
  aca7486 (truck write path onto typed capacity), 366bb2f (surfaced, grouped,
  type-labelled), 058f09d (sweep: dead code, drifted comments). Nothing open.
  - Grouping = `lib/vehicle-groups.ts` ONLY. Naming = `lib/vehicle-types.ts`.
    Capacity triple = `lib/capacity.ts`. Fleet tabs = `lib/fleet-tabs.ts`.
    Never re-derive at a call site.
- **`npm run test:guards` (in `npm test`)** — `capacity-single-writer-check` +
  `trucks-write-surface-check`. Text-level: fail if a write path reaches
  `trucks` or builds capacity columns outside their owning files.
- **`v_fleet_state_now` INCLUDES operation vehicles ON PURPOSE.** Utilization
  excludes them via `v_truck_day_state`, truck-only. Do not "fix" either
  to match.
- **PARKED:** snapshot-drop STEP 2 (`drop-ledger-snapshot-2026-09-16.sql`) —
  STEP 1 green on prod, proven able to RAISE; STEP 2 is Turki's, SQL Editor.
  Undo = prod `schema_migrations_backup_20260916`; 7 orphan bodies md5-exact
  in `ledger-orphan-bodies-2026-09-16.sql` (580d42b).
- **PARKED:** leaked-password protection OFF in Supabase Auth.
- **CARRIED:** `web-design-guidelines` + `vercel-composition-patterns` NOT
  installed here. CLAUDE.md §4 names both — use `preview/` + `frontend-design`
  and say so, do not pretend.

## Rules
- CLAUDE.md = rules. Read it, NEVER append.
- .claude/skills/aquafleet-domain/SKILL.md = domain rules. NEVER append.
- Money/migration gate: draft, STOP, architect reviews.
- Session cap: 15 turns. First compaction = wrap up.
- This file stays under 2KB. If larger, Code is appending diary. Cut it.
- ATLAS: 114 sheets; a moved page count fails `npm test` until `--update`.
