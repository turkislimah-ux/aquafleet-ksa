# SESSION HANDOFF

## State

- **DB is at migration 0177.** Three migrations shipped this session, all
  applied, all on disk:
  - `0175_violation_types.sql` — the bilingual, extensible lookup.
  - `0176_driver_violations.sql` — the fines themselves.
  - `0177_payslip_violation_deductions.sql` — the payslip wiring + freeze table.
- **MCP-applied migrations write NO `schema_migrations` ledger row.** Neither do
  SQL Editor runs. The migration FILE is the record. The ledger's max version
  lags reality and always will — **the objects in the catalog are the truth, the
  ledger is not.** Do not "discover" a missing migration from a ledger query and
  do not re-apply one on that basis. Check `pg_proc` / `pg_index` first.
- All pages built and verified in-browser. No open bugs. Two decisions are owed
  from Turki (O-1, O-2 below) — open QUESTIONS, not defects.

---

## Closed this session — Traffic Violations, three stages

| # | Stage | Commit |
|---|---|---|
| 1 | Schema: `violation_types` + `driver_violations` — `0175`, `0176` | `4fdf30a` |
| 2 | Payslip deduction wiring + freeze table — `0177` | `5a7c0e6` |
| 3 | UI: driver-detail section, roster column, payslip fines table, preview fix | `ef899cd` |

---

## THE FEATURE MODEL — moved, not lost

**The traffic-violations money model now lives in
`.claude/skills/aquafleet-domain/SKILL.md` §"Traffic Violations & Payslip
Deductions (0175–0177)"** — the three tables, the deduction law, the date-floor
↔ clamp-no-carry link, the four 0177 CHECK constraints, WYSIWYG, Outstanding,
and the four locked decisions. It is durable money/schema law, not session
state, and `CLAUDE.md` §7 says that belongs in the skill. Every fact there was
re-measured out of `pg_index` / `pg_constraint` / `pg_attribute` /
`pg_get_viewdef` on 2026-08-31 before it was written. **One home, so the two
cannot drift.**

---

## CLOSED this session — both open decisions ruled

### O-1. Historical invoices whose DERIVED split moves — **RULED: LEAVE**

Re-measured 2026-08-31: **8** already-issued prepaid invoices (5 paid,
1 confirmed, 2 void) — not the "8 paid + 1 void" this file previously claimed.
13,524.00 SAR would move Unpaid → Covered, 7,831.50 of it already collected;
**2 of the 8 were already divergent before `9c287d6`.**

**Turki ruled LEAVE as-is. No data touched.** Not a bug: issued invoices render
and print from frozen columns (0027), so no document drifts. Annotated in
`.claude/skills/aquafleet-domain/SKILL.md` §"Frozen invoice splits diverging
from a re-derivation is EXPECTED" so it is not re-investigated. One live item:
`026-000009`, confirmed and unpaid at 4,243.50 SAR.

### O-2. `prepaid.ts` date-gated two surfaces — **RULED: MAKE LIFETIME**, done

`dc29e26`. `derivedBalanceItems` and `buildStatementItems` lost their
**credit-side** gates only; consumption and settlements keep theirs. Verified a
no-op on current data — all 3 prepaid customers byte-identical
(−28,290.00 / −32,689.00 / −471.50). Rule now in SKILL.md §"asOfDate scopes
CONSUMPTION, never the POOL". Harness cases inverted, not deleted.

### Parked (lower priority)

`InvoicesModal` period default: both bounds default to today, so the default
range is a single day. Pre-existing UX papercut, nothing was changed.

---

## Closed in earlier sessions (detail is in the commit messages)

| # | Item | Commit(s) |
|---|---|---|
| 1 | Fleet Health column removed (plus its dead i18n keys) | `4982c71` |
| 2 | Inventory approval-vote wedge fixed; 5 legacy POs backfilled — `0172` | `19f6466` |
| 3 | Prepaid balance is a **lifetime NET pool** — topups AND returns, no date gate | `9c287d6` |
| 4 | Trip-ref **gap-fill allocator** — `0173` + `0174` | `3223df5`, `0869576` |
| 5 | **Prepaid Amount Payable redefined** = unpaid delivered work. TS only, no migration. Guarded by `scripts/amount-payable-check.ts` | `d4c3d3e` |

**On item 5 — the THREE prepaid numbers are deliberately different and two of
them are allowed to disagree. Do NOT "reconcile" them.** The durable reasoning,
including why `v_customer_amount_payable` stays balance-based (flipping it makes
`return_customer_balance()` pay a debtor their own debt), lives in
`.claude/skills/aquafleet-domain/SKILL.md` §"Amount Payable ≠ the prepaid
BALANCE". Consequence to expect, not to fix: **the Archive tab shows a different
number than the Trips tab for the same prepaid customer, by design.**

---

## Workflow locks

- **NEVER run `preview_start` while a dev server is up.** It launches a *second*
  `next dev` that ignores `NEXT_DIST_DIR` and writes to the shared `.next`,
  clobbering the running server's build. `safe-build.sh`'s port guard does **not**
  catch a second dev server — it guards ports, not processes. Hygiene check:
  `pgrep -fl "next dev"` must return **exactly one** line.
- **Bash `cwd` resets to `$HOME` between calls.** `npx tsc` from `$HOME` gives
  BOTH a false failure (no local typescript) AND a false green (finds no project,
  exits 0). Always `cd` to the repo root **and** use
  `./node_modules/.bin/tsc --noEmit --project tsconfig.json`. Pinning the
  tsconfig alone is NOT enough — the binary resolution is the other half.
- Locks promoted into `CLAUDE.md` and living there now, not here: the `grep -c`
  comment-epitaph trap, now with its fix (§5 — strip comment lines, use
  `grep -F` on patterns with parens); migrations are
  BARE STATEMENTS with no `begin;`/`commit;` (§5); identify a function by
  `oid::regprocedure::text`, never `pg_get_function_identity_arguments()` which
  returns argument NAMES on PG15+ (§6); a migration's own result-grid is not
  proof it applied (§5).

---

## Schema facts worth keeping

- `trips` has a check constraint **`trips_project_or_customer`**: a trip needs
  `project_id` **OR** `customer_id`. A fully bare `(null, null)` trip is
  **rejected**. The `WT-` fallback series is therefore reached by
  **bare-CUSTOMER** trips — customer set, no project — not by empty trips.

(The `violation_types`-fetched-unfiltered rule moved to SKILL.md with the rest
of the violations model — it is domain law, not a loose schema note.)

---

## Rules carried forward

- `CLAUDE.md` is the rules file — read it, don't append to it.
- Domain rules in `.claude/skills/aquafleet-domain/SKILL.md`.
- Money gate: salary / rates / commission / invoice / balance → draft, STOP, the
  architect reviews.
- Migration gate: Code drafts → STOPS → the architect reviews and applies.
- Explicit-path `git add`; inspect the staged blob with `git show :<path>`.
- **Re-measure any figure in this file before relying on it.** A number here is a
  pointer, not evidence.
- Session cap: 15 turns max. Compact once = wrap up.

## What's next

1. **Notifications + Settings feature** (catalog in chat memory, architecture
   ruled, `0154` pending — renumber, that slot is long past). Nothing blocks it:
   O-1 and O-2 are both ruled and closed, and the violations model has migrated
   to SKILL.md.
2. Parked papercut: `InvoicesModal`'s single-day default period (above).

Read `.claude/skills/aquafleet-domain/SKILL.md` for domain constraints.
