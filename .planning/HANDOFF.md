# SESSION HANDOFF

## State

- **DB is at migration 0174.** Not 0171 — that figure is stale wherever it still
  appears. Files `0172`, `0173`, `0174` all exist on disk and all three are
  APPLIED to the live database.
  - `0172` was applied through the Supabase SQL Editor.
  - `0173` and `0174` were applied through the MCP connection.
- **MCP-applied migrations write NO `schema_migrations` ledger row.** Neither do
  SQL Editor runs. The migration FILE is the record. So the ledger's max version
  lags reality and always will — **the objects in the catalog are the truth, the
  ledger is not.** Do not "discover" a missing migration from a ledger query and
  do not re-apply one on that basis. Check `pg_proc` / `pg_index` first.
- All pages built and verified. No open bugs. Two decisions are owed from Turki
  (below) — those are open QUESTIONS, not defects.

## Closed this session

| # | Item | Commit(s) |
|---|---|---|
| 1 | Fleet Health column removed (plus its dead i18n keys) | `4982c71` |
| 2 | Inventory approval-vote wedge fixed; 5 legacy POs backfilled — `0172` | `19f6466` |
| 3 | Prepaid balance is a **lifetime NET pool** — topups AND returns, no date gate. Zero migrations, code only | `9c287d6` |
| 4 | Trip-ref **gap-fill allocator** — `0173` + `0174` | `3223df5`, `0869576` |

### Item 4 in detail

New trip refs now reuse deleted numbers **lowest-first** within a project's
current-format series for that year. `next_trip_ref_number` locks the
`(project_id, year)` counter row with `select … for update` **before** scanning
`[1 .. next_number-1]`, so two concurrent inserts cannot pick the same gap. A gap
fill returns **without advancing the counter**; only a contiguous series advances
it, by exactly 1.

- Legacy `WT-` refs are a **separate series and are never fillable gaps** — the
  scan matches the exact `initials-YYY-` prefix, not `project_id` alone (153 live
  trips carry both a `project_id` and a `WT-` ref).
- `trips_set_ref` is untouched, so the `WT-` fallback and the client-supplied-ref
  bypass are byte-for-byte unchanged.
- `0173` adds the backstop: unique index on `(project_id, ref)` **NULLS NOT
  DISTINCT** (PG15+). It is the second, independent layer — it rejects a
  duplicate ref even when no lock was involved.
- `create or replace function` reset the ACL, so `0174` re-revokes from
  `public, anon` **and re-grants** `authenticated` + `service_role` — those were
  explicit grants that the replace destroyed, not PUBLIC inheritance. Verified
  live: `anon_exec false`, `auth_exec true`, `service_exec true`.
- Test plan lives at `/tmp/0174-tests.sql` (deliberately outside the repo). Ran
  green: gap fill, no counter drift, `WT-` isolation, `23505` from
  `trips_project_ref_unique` on a duplicate. Two-session lock test verified
  structurally. DB restored to baseline: 850 trips, 7 counters, seq 183, 0 dupes.

---

## OPEN — decisions owed from Turki (raise these, do not bury them)

These are real deferred work from item 3. Nothing is broken today; both are
judgement calls that were deliberately NOT made.

### O-1. Nine historical invoices whose DERIVED split now moves

8 paid + 1 void. Their **stored/frozen figures are untouched and correct** — the
printed documents are right and no money changed. But the prepaid pool widened
(lifetime net, no date gate), so a screen that **re-derives** the covered/unpaid
split shows a split differing from the printed document.

**Decision owed: reconcile, annotate, or leave.** NOT yet decided.

### O-2. `prepaid.ts` still date-gates two surfaces

`derivedBalanceItems` (`lib/prepaid.ts:341`) and `buildStatementItems` (`:431`)
still date-gate **both** topups and returns (point-in-time), while the invoice
engine now does not (lifetime).

**Inert today** — every app caller passes `asOfDate = undefined`. And
point-in-time may well be **correct** for a running statement. But it is a live
inconsistency between two surfaces that both answer "what's the balance".

**Decision owed: leave point-in-time, or make it lifetime.** NOT yet decided.

### Parked (lower priority)

`InvoicesModal` period default: both bounds default to today, so the default
range is a single day. Pre-existing UX papercut, nothing was changed, Turki's
call.

---

## Workflow locks learned this session

These bit us and cost round-trips. They belong with the durable rules.

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
- **Migrations must be BARE STATEMENTS — no `begin;` / `commit;` wrapper.** The
  Supabase SQL Editor wraps each submission in its own transaction. A nested
  `begin` emits `WARNING: there is already a transaction in progress` and is
  ignored; the file's trailing `commit;` then ends the *editor's* transaction.
  Result: grids print, the run looks successful, and **nothing is created**.
  `0173` v1 failed exactly this way. The editor's own transaction is also what
  satisfies §6's "re-revoke in the same transaction".
- **A migration's own result-grid is NOT proof it applied.** Read the live
  catalog — `pg_index`, `pg_proc`, `has_function_privilege` — not the SELECTs the
  migration printed. Verification SELECTs go AFTER the DDL, and they are still
  only a claim until the catalog agrees.
- **Corollary, PG 17.6:** `pg_get_function_identity_arguments()` returns argument
  **names**, e.g. `'p_project_id uuid, p_year integer'`, not `'uuid, integer'`. A
  catalog filter written against the bare types matches **zero rows** and reports
  a healthy function as missing. Use `p.oid::regprocedure::text =
  'fn_name(uuid,integer)'` instead. This nearly produced a false catastrophe
  report on `0174`.

---

## Schema fact worth keeping

`trips` has a check constraint **`trips_project_or_customer`**: a trip needs
`project_id` **OR** `customer_id`. A fully bare `(null, null)` trip is
**rejected**. The `WT-` fallback series is therefore reached by **bare-CUSTOMER**
trips — customer set, no project — not by empty trips.

---

## Rules carried forward

- `CLAUDE.md` is the rules file — read it, don't append to it.
- Domain rules in `.claude/skills/aquafleet-domain/SKILL.md`.
- Money gate: salary / rates / commission / invoice / balance → draft, STOP, the
  architect reviews.
- Migration gate: Code drafts → STOPS → the architect reviews and applies.
- Explicit-path `git add`; inspect the staged blob with `git show :<path>`.
- Session cap: 15 turns max. Compact once = wrap up.

## What's next

1. Turki rules on **O-1** and **O-2** above.
2. Then: Notifications + Settings feature (catalog in chat memory, architecture
   ruled, `0154` pending — renumber, that slot is long past).

Read `.claude/skills/aquafleet-domain/SKILL.md` for domain constraints.
