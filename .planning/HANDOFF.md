# SESSION HANDOFF

## State

- **DB is at migration 0174 — unchanged this session.** The item below shipped
  **NO migration**: it is TypeScript only, and the DB view was left untouched
  *deliberately*, not by omission (see "The three prepaid numbers"). Files `0172`,
  `0173`, `0174` all exist on disk and all three are APPLIED to the live database.
  - `0172` was applied through the Supabase SQL Editor.
  - `0173` and `0174` were applied through the MCP connection.
- **MCP-applied migrations write NO `schema_migrations` ledger row.** Neither do
  SQL Editor runs. The migration FILE is the record. So the ledger's max version
  lags reality and always will — **the objects in the catalog are the truth, the
  ledger is not.** Do not "discover" a missing migration from a ledger query and
  do not re-apply one on that basis. Check `pg_proc` / `pg_index` first.
- All pages built and verified. No open bugs. Two decisions are owed from Turki
  (below) — those are open QUESTIONS, not defects.

---

## Closed this session

| # | Item | Commit |
|---|---|---|
| 1 | **Prepaid Amount Payable redefined** — TS only, no migration | `d4c3d3e` |

### The new rule

**Amount Payable (the Trips/Finance COLUMN) = the VAT-inclusive value of every
DELIVERED trip and every non-void special charge NOT YET ON A PAID INVOICE.**
Negative = owed, zero = settled — the existing sign convention, unchanged. `<= 0`
by construction.

One rule, **both payment modes**. What changed is prepaid: it used to return the
running balance.

- **Added balance NO LONGER flows into it.** A prepaid pool FUNDS delivered work;
  it does not SETTLE it. A top-up moves the balance and leaves this column at rest.
- **A paid invoice clears its covered work out of it.** Draft, review and
  confirmed do not reduce it — only Mark Paid.
- **The two arms were COLLAPSED into one path.** After the change they are
  provably identical: same inputs, same filters, same engine call, and no caller
  scopes charges differently. `mode` survives only as a null-guard for an unset
  mode; it no longer selects a formula. The paid gate is exported as
  `isUnsettledTrip` / `isUnsettledCharge` — import the predicate, never restate it.
- **`topups`, `returns` and `prepaidBalance` are gone from
  `computeAmountPayable`'s signature entirely** — not accepted-and-ignored, not
  accepted at all. A payable function cannot see the pool it must not spend, so
  the rule holds by construction rather than by discipline. `noUnusedLocals`
  turned that into a prop cascade through `BreakdownReport` → `CustomersTab` →
  `TripsTabs`. **The cascade stops there: `FinanceTab` still receives both**, for
  the balance / banner / Settled Balance.
- Both surfaces got it from the one function — Finance tab and the project
  Breakdown report agree by construction.

Guarded by `scripts/amount-payable-check.ts` (new). **Changing either rule means
changing that harness first.**

---

## THE THREE PREPAID NUMBERS NOW ON SCREEN — DELIBERATELY DIFFERENT

Three figures look like one figure. They are not, and two of them are *allowed to
disagree*. **Do NOT "reconcile" them** — the durable reasoning is in
`.claude/skills/aquafleet-domain/SKILL.md`.

| # | Number | Where | Rule | Status |
|---|---|---|---|---|
| 1 | Prepaid running **BALANCE** | balance KPI, over-balance banner, Settled Balance, statement | deducts at **DELIVERY** (Model A), nets top-ups and returns | **unchanged** |
| 2 | **Amount Payable COLUMN** | Trips → Finance tab, Breakdown report | unpaid delivered work | **this change** |
| 3 | `v_customer_amount_payable` **VIEW** | Archive tab | for prepaid this is **the running balance** (= number 1) | **intentionally NOT changed** |

**A prepaid customer can hold pool credit AND owe on the payable column at the
same time.** That is the model, not a bug.

**Why the view stays balance-based — this is load-bearing, not laziness.**
`return_customer_balance()` gates a real cash refund on `amount_payable_sar > 0`
and freezes that figure into `customer_balance_returns` (the modal has no amount
field by design). `archive_project_guarded()` reads `archive_blocked` (prepaid
arm: `b.balance_sar < 0`, blocked when NEGATIVE) and
`owed_sar = GREATEST(0, -amount_payable_sar)` off the same row. Flip the view to
the column's rule and a debtor's figure turns POSITIVE — **the refund gate passes
and the RPC pays a customer their own debt**, while `owed_sar` collapses to 0 so
an archive override writes off nothing.

**Consequence to expect, not to fix: the Archive tab shows a DIFFERENT number
than the Trips tab for the same prepaid customer, BY DESIGN.** The view's
0139-era "mirror of the column" framing is obsolete — it mirrors the BALANCE.

---

## Decisions Turki LOCKED this item (do not re-litigate)

1. **TS-only; the DB view is not touched** — refund-gate safety, per the above.
2. **Sign = NEGATIVE-for-owed**, the existing convention. Not inverted.
3. **Returns are dropped from the payable.** It is unsettled WORK only — no pool
   term of any kind on that side.

---

## OPEN — decisions owed from Turki (raise these, do not bury them)

Carried forward unchanged. Real deferred work from the earlier lifetime-net
change. Nothing is broken today; both are judgement calls deliberately NOT made.

### O-1. Nine historical invoices whose DERIVED split now moves

8 paid + 1 void. Their **stored/frozen figures are untouched and correct** — the
printed documents are right and no money changed. But the prepaid pool widened
(lifetime net, no date gate), so a screen that **re-derives** the covered/unpaid
split shows a split differing from the printed document.

**Decision owed: reconcile, annotate, or leave. NOT yet decided.**

### O-2. `prepaid.ts` still date-gates two surfaces

`derivedBalanceItems` (`lib/prepaid.ts:341`) and `buildStatementItems` (`:431`)
still date-gate **both** topups and returns (point-in-time), while the invoice
engine now does not (lifetime).

**Inert today** — every app caller passes `asOfDate = undefined`. And
point-in-time may well be **correct** for a running statement. But it is a live
inconsistency between two surfaces that both answer "what's the balance".

**Decision owed: leave point-in-time, or make it lifetime. NOT yet decided.**

### Parked (lower priority)

`InvoicesModal` period default: both bounds default to today, so the default
range is a single day. Pre-existing UX papercut, nothing was changed, Turki's
call.

---

## Closed in earlier sessions (detail is in the commit messages)

| # | Item | Commit(s) |
|---|---|---|
| 1 | Fleet Health column removed (plus its dead i18n keys) | `4982c71` |
| 2 | Inventory approval-vote wedge fixed; 5 legacy POs backfilled — `0172` | `19f6466` |
| 3 | Prepaid balance is a **lifetime NET pool** — topups AND returns, no date gate. Code only | `9c287d6` |
| 4 | Trip-ref **gap-fill allocator** — `0173` + `0174` | `3223df5`, `0869576` |

Item 4 in one line: new refs reuse deleted numbers lowest-first within a
project's current-format series, counter row locked `for update` before the scan,
a gap fill does not advance the counter, legacy `WT-` is a separate series and
never a fillable gap, `0173`'s unique index on `(project_id, ref)` NULLS NOT
DISTINCT is the independent second layer.

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
- **A `grep -c` for a removed identifier hits the comment that documents the
  removal.** Verifying the pool args were gone from `amountPayable.ts`, the
  pattern `topups\|returns` returned 1 — the doc header sentence saying the
  function takes none. Match on identifier SHAPE
  (`(topups|balanceReturns)[[:space:]]*[:,)?]`, plus the type imports) when the
  claim is "this symbol is gone", or the prose will keep failing the check it
  exists to satisfy.
- Two locks from last session were **promoted into `CLAUDE.md`** and live there
  now, not here: migrations are BARE STATEMENTS with no `begin;`/`commit;` (§5),
  and identify a function by `oid::regprocedure::text`, never by
  `pg_get_function_identity_arguments()` which returns argument NAMES on PG15+
  (§6). A migration's own result-grid is not proof it applied (§5).

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
- **Re-measure any figure in this file before relying on it.** A number here is a
  pointer, not evidence.
- Session cap: 15 turns max. Compact once = wrap up.

## What's next

1. Turki rules on **O-1** and **O-2** above.
2. Then: Notifications + Settings feature (catalog in chat memory, architecture
   ruled, `0154` pending — renumber, that slot is long past).

Read `.claude/skills/aquafleet-domain/SKILL.md` for domain constraints.
