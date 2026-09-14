# SESSION HANDOFF

## State
- DB at latest migration. Run `ls supabase/migrations/ | tail -5` to check.
- Run `git log --oneline -10` for recent commits.

## Rules
- CLAUDE.md = rules. Read it, NEVER append to it.
- .claude/skills/aquafleet-domain/SKILL.md = domain constraints. NEVER append to it.
- Money/migration gate: draft → STOP → architect reviews.
- Session cap: 15 turns. First compaction = wrap up.
- This file must stay under 2KB. If larger, Code is appending diary. Cut it.

## Current work
- **Printable-reports ATLAS redesign: COMPLETE.** Every report renders from
  `lib/atlas/` (kit) + `lib/docvm/` (words+numbers) + `lib/docs/` (renderers),
  EN and AR as separate documents, printed via `printHtml()` into a hidden
  iframe. Old print stylesheet removed in `2767ef3`; `@page { size: A4 }` is all
  that is left, for a raw Ctrl+P.
- **Sheets are verified by a committed suite now, not by eye.** `npm test` =
  typecheck + money + copy + sheets, ~30s, run before committing. `test:db` is
  separate — it reads the live DB, so run it only for schema/RPC/action work.
  `npm run doc:render` writes all 88 sheets (9 documents x EN/AR) to
  /tmp/atlas-sheets. Page counts diff against `scripts/doc-page-counts.json`:
  a sheet that moves FAILS until you re-run `doc-a4-proof.mjs --update` and
  commit the new baseline. That is the proof a kit change is safe.
- Open, source-side, not print: Cost report Parts figure off ~240 SAR (two
  queries disagree); `app/reports/StatementViews.tsx` ~:1080 prints "Payouts N"
  under the AMOUNT column head.
- Notifications + Settings feature in progress.
- Read CLAUDE.md §7 for state stub.
