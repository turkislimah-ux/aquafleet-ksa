# Review pack — retire `water_stations.fill_cost` (migration 0122)

> ## ✅ CLOSED — reviewed, applied, verified, committed
>
> **0122 is APPLIED.** Everything below is the pack as handed over for review,
> preserved unedited. It records what was proposed and why, **not current state** —
> do not read its "not applied" framing as live.
>
> | | |
> |---|---|
> | Migration applied by | architect |
> | Migration committed | `dc9d411` |
> | CLAUDE.md §7 updated | same batch |
> | App commit | none needed — nothing in the app named the column |
>
> **Post-apply verification, all six blocks passed.** The two that mattered:
>
> - **B — the DO-NOT-FIX guard held.** Olaya's `fill_cost_potable_sar` still reads
>   NULL. Nobody "rescued" the dropped 70.00 into it, which was the one outcome §2
>   argued against.
> - **D — the money did not move.** `v_filling_cost_monthly` byte-identical:
>   Jun 210.00 (18/10), Jul 1,285.00 (143/3), Aug 5,185.00 (598/0); trips 817 / 13.
>
> Also: `fill_cost` gone from the whole schema (0 occurrences), per-type pair intact,
> 6 constraints all convalidated, 40 views / 40 invoker / 0 anon.
>
> §5's decision 1 — drop rather than preserve Olaya's 70.00 — was **not overruled**.

**Status at the time of writing (historical):** migration **DRAFTED, NOT APPLIED** —
`supabase/migrations/0122_retire_water_stations_fill_cost.sql`. **Stopped for review.**

**No app commit accompanies this, and that is deliberate** — see §3.

---

## 1. 0110 parked this and named its own release conditions. Both are now met.

0110 §3 says verbatim: the column is *"retired in a later migration once per-type
prices are entered and the trip backfill is verified."* Checked live rather than
assumed:

| Condition | State |
|---|---|
| Per-type prices entered | ✅ All 5 stations priced. `water_stations_offers_at_least_one_type` — which 0110 added **NOT VALID** because no row satisfied it yet — is now `convalidated = true` with **0** violating rows |
| Trip backfill verified | ✅ 817 trips, **13** uncosted, all 2026-06-29 → 2026-07-05 — exactly the grandfathered June–July set §7 records, unchanged |

**A second parked item turned out to be already closed.** 0110 also said a later
migration should `validate constraint` once every row satisfied it. Someone has
already done that, so **0122 does not touch the constraint** — flagged because the
§7 deferred note implies it is still outstanding.

---

## 2. What is lost — this one is NOT like 0121

`payment_model` held nothing but its own default. **This column holds real, distinct
values.** Full pre-drop state, reproduced in the migration header so the figures
survive in git even though the column will not:

| key | `fill_cost` | potable | non_potable |
|---|---|---|---|
| furaian_station | 0.00 | 0.00 | 0.00 |
| manfuhah_station | 0.00 | 5.00 | 0.00 |
| olaya_filling_point | **70.00** | **NULL** | 80.00 |
| shas_water_station | NULL | 80.00 | 50.00 |
| umm_al_hamam_station | 0.00 | NULL | 10.00 |

Four rows are 0.00 (fully covered by the per-type prices beside them) or NULL. **The
only datum that disappears is Olaya's 70.00** — and it has **never priced a single
fill**. Olaya has **zero trips**, any stage, all time. 0110 recorded the same fact.
No P&L figure, no frozen `trips.filling_cost_sar` snapshot, and no statement traces
back to it.

### ⚠️ Why 70.00 is NOT migrated into a per-type column

The obvious move is to write it into `fill_cost_potable_sar` so nothing is lost.
**That would be wrong**, and the migration says so in a DO-NOT-FIX block:

1. **Nobody knows which type the 70.00 was for.** The flat column predates the split.
2. Olaya reads `fill_cost_potable_sar = NULL`, and under this schema's central rule
   **NULL means "does not offer potable"** — a business statement, not a gap. Writing
   70.00 there would make the database assert Olaya offers potable at 70.00, which
   nobody has said.

This is exactly the trap 0110 avoided when it refused to seed the new columns from the
old one, and the same one that got a seed migration **drafted and deleted** during the
Water Station Cost work (§7: *"Do not seed a column whose NULL carries meaning"*).

**Losing an unused number beats inventing a business fact.** If you disagree, that is
the single decision in this batch worth overruling — say so and I will park the drop
instead.

---

## 3. Blast radius — and why there is no app commit

**Database: nil.** 0 views, 0 functions, 0 triggers, 0 indexes, 0 constraints.

> **Regex matters here.** `fill_cost[^_]` matches the flat column but **not**
> `fill_cost_potable_sar` / `fill_cost_non_potable_sar`. A plain `%fill_cost%` LIKE
> matches all three and gives a false positive on every check. The three
> `fill_cost`-named constraints on this table reference **only** the per-type columns
> — verified by reading their definitions, not their names.

**App: no change needed, which is unusual and was checked rather than assumed.** 0119
and 0121 both required an app commit first because app code still named the column.
Here every remaining mention is a **comment saying it is deprecated**:

- `app/trips/WaterStationsModal.tsx:13`, `app/trips/actions.ts:905` and `:928`,
  `components/OperationStationsModal.tsx:6`

Critically, **no TypeScript type declares it** — `StationPricing`
(`lib/station-pricing.ts`) names only the two per-type columns. Nothing selects it into
a typed shape, so there is no compile-time or runtime surface to break.

`supabase/migrations/0043` also greps positive; that is a prose line listing numeric
columns and their origin migrations, not a dependency.

### Constraint checks from the standing brief

| Constraint | Result |
|---|---|
| Don't touch money-core (`lib/prepaid.ts`, `lib/vat.ts`) | **Not touched.** Neither ever referenced this column |
| Don't change invoice/finance RPC signatures | **No RPC changed.** 0 functions reference the flat column at all |

---

## 4. Verification plan

The migration body is three lines: `begin;` / `alter table public.water_stations drop
column if exists fill_cost;` / `commit;`. No `cascade`, so an unexpected dependency
fails loudly.

| Block | Check |
|---|---|
| A | Column gone; the per-type pair still present |
| B | All 5 stations' per-type prices **unchanged** — and **Olaya's potable must still be NULL** (if it reads 70.00, someone "rescued" the flat value) |
| C | 6 constraints intact; `offers_at_least_one_type` still `convalidated = true` |
| D | **The money did not move** — `v_filling_cost_monthly` identical |
| E | 40 views / 40 invoker / 0 anon |
| F | Browser: Water Stations modal, new-trip station picker, Reports filling sub-tab |

**Block D is the one that matters.** Captured live at drafting:

| month | filling_cost_sar | costed | uncosted |
|---|---|---|---|
| 2026-06 | 210.00 | 18 | 10 |
| 2026-07 | 1,285.00 | 143 | 3 |
| 2026-08 | 5,185.00 | 598 | 0 |

June/July match the 210 / 1,285 the cost-mix doughnut reconciles against (§7). August
has grown since that note (4,390 → 5,185) because trips keep landing — **re-take the
BEFORE if time has passed** rather than trusting the row above.

**Caught during drafting, worth mentioning:** my first version of block D queried a
column `filling_uncosted_trips` that does not exist — the view's columns are
`month / filling_cost_sar / costed_trips / uncosted_trips`. Fixed before handover; the
block as written now runs.

---

## 5. Decisions taken, for confirmation

1. **Drop rather than preserve** Olaya's 70.00 — unused, untyped, and preserving it
   would require asserting a business fact nobody has stated. Recorded in the
   migration header so it survives in git.
2. **Do not touch `offers_at_least_one_type`** — already validated by someone else.
3. **No app commit** — nothing in the app names the column, not even a type.
4. **No backfill, no seed, no data movement** of any kind.

---

## 6. To apply

1. Re-run the four dependency checks in the migration header (mind the regex).
2. Capture block **D**'s BEFORE.
3. Run the migration.
4. Run blocks **A–E**, then the browser checks in **F**.
5. Commit the migration file the moment the apply is confirmed — the db-reset rule.
