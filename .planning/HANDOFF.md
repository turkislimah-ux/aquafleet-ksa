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
  iframe. Batch 7 (payout voucher + part record) shipped `fc3541c`; the old
  print stylesheet was removed in `2767ef3` — no `@media print`, no `.no-print`,
  no `printing-*` body classes, no `*-print` ids, no PrintBand, no portals.
  `@page { size: A4; margin: 14mm }` is all that is left, for a raw Ctrl+P.
- Verify sheets on an A4 PDF (Playwright `page.pdf({format:'A4'})`, run from
  repo root), never a browser viewport — the sheet's measure is ~658px.
  `npm run test:bidi` renders the statement corpus and checks it; add
  `scripts/doc-a4-proof.mjs <dir>` for page counts. Both committed `16f4013`.
- Open, source-side, not print: Cost report Parts figure off ~240 SAR (two
  queries disagree); `app/reports/StatementViews.tsx` ~:1080 prints "Payouts N"
  under the AMOUNT column head.
- Notifications + Settings feature in progress.
- Read CLAUDE.md §7 for state stub.
