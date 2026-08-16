# Review pack — filling cost as a dictionary metric (migration 0124)

> ## ✅ CLOSED — reviewed, applied, verified, committed
>
> **0124 is APPLIED.** Everything below is the pack as handed over for review,
> preserved unedited. It records what was proposed and why, **not current state** —
> do not read its "not applied" framing as live.
>
> | | |
> |---|---|
> | 0123 (found applied, uncommitted) | `f82fe1c` |
> | Fence move (app) | `dca9840` |
> | Migration committed | `b479671` |
> | CLAUDE.md §7 updated | same batch |
>
> **Post-apply verification, all blocks passed:** dictionary **30** rows; `filling_cost`
> carries grain `one month, quarter or year`, basis/unit `accrual / SAR`, both halves of
> the two-source pointer and the uncosted caveat; **five** operational cost buckets now
> present; reconcile still **3 rows / 0 mismatched**; money unmoved at
> Jun 210.00 (18/10) · Jul 1,285.00 (143/3) · Aug 5,185.00 (598/0).
>
> **The fingerprint check landed exactly as asserted** — 29 keys `b3bbb25d…` → 30 keys
> **`c4e9e453bafe97f19512423eca188f1a`**, the value predicted in §2. That is the proof
> that one key moved and not more, and it is the mirror of 0123's check (where the
> requirement was that it stay identical).
>
> §6's note stands as a live caution: filling and `operating_cost` are a component and
> its container, never addends.

**Status at the time of writing (historical):** migration **DRAFTED, NOT APPLIED** —
`supabase/migrations/0124_dictionary_filling_cost.sql`. **Stopped for review.**

**Fence move is COMMITTED** — `dca9840`. Inert until 0124 applies (fails closed). §4
below is the exact diff, so the fence move is deliberate and visible as asked.

---

## ⚠️ 0. First — 0123 was applied but uncommitted. Committed on sight (`f82fe1c`).

Found while starting this. That is precisely the db-reset vector §7 records
(`v_operations_by_driver_monthly`, lost exactly this way — a replay rebuilds from
*committed* files). Verified before committing: 10 metrics carry the period grain and
all name `v_pnl_by_period`; `operating_margin` has the sign-flip warning; 29 rows;
6 still `'one month'` (16 − 10); fingerprint `b3bbb25d…` **identical**, as its block D
required.

**Nothing was lost** — but it was one reset away from being.

---

## 1. What the entry says, and why it is not a clone of `parts_cost`

`metric_key = 'filling_cost'` — confirmed unused (0 keys matching `%fill%`), and in the
sibling naming style (`os_cost`, `payroll_cost`, `commissions_cost`).

**Direct-mapping bucket**, as the architect verified. `v_filling_cost_monthly` publishes
`filling_cost_sar` directly — no composition, unlike payroll/commissions — so it takes
0123's plain two-source pointer form:

| Column | Value |
|---|---|
| `grain` | `one month, quarter or year` |
| `source_view` | `v_filling_cost_monthly (month) · v_pnl_by_period.filling_cost_sar (month, quarter or year)` |
| `basis` | `accrual` |
| `unit` | `SAR` |

Reconcile verified live: **3 rows, 0 mismatched** on both `filling_cost_sar` and
`filling_uncosted_trips`.

### The caveat — the reason this entry needed its own thinking

Filling is the **only** cost bucket with an uncosted companion. The total covers trips
that *had* a price; grandfathered rows whose station never priced that water type
contribute nothing and are counted separately.

> **The total is SHORT by an unknown amount rather than complete.** Live: 10 uncosted in
> June, 3 in July, 0 in August, against 210.00 / 1,285.00 / 5,185.00.

The caveat states that plainly, notes that 0114 means the count is historical and fixed
(but the historical total stays short), and adds the trap §7 records: **a scheduled trip
has not filled yet and is excluded, so summing `trips.filling_cost_sar` raw will EXCEED
this view.**

### Two claims I verified rather than asserted

- **`on conflict (metric_key)`** — valid: `report_metrics_pkey PRIMARY KEY (metric_key)`.
  Also checked the two CHECK constraints accept `basis='accrual'` and `unit='SAR'`.
- **The `formula` text** — read against the live viewdef, not paraphrased. The view is
  `sum(t.filling_cost_sar)` where `stage in (loading, in_transit, delivered)`, grouped by
  `date_trunc('month', trip_date)`. The formula says exactly that.

---

## 2. The fingerprint moves — and that is the intent

0123's safety check was that the fingerprint stayed *identical*, proving a text-only
change could not alter what the builder offers. **This one is the opposite.**

| | keys | fingerprint |
|---|---|---|
| before | 29 | `b3bbb25d7b3d5e59e18dcf83a79b4f51` |
| after | 30 | `c4e9e453bafe97f19512423eca188f1a` |

Recorded as an asserted expectation. Block D says: any *other* value means more than one
key moved — stop and diff.

---

## 3. Scope: exactly what is dictionary vs app

| | |
|---|---|
| Migration 0124 | one `insert … on conflict` into `report_metrics`. **No view, no RPC, no measure.** |
| App (`dca9840`) | one `BUILDER_METRICS` entry + two mechanical supports |

---

## 4. The fence move, stated exactly (`lib/report-builder.ts` only)

**One key added. Nothing else added, removed or renamed.**

```
+ { key: "filling_cost", label: "Water filling cost", basis: "accrual", unit: "SAR",
+   groupings: ["period"], kind: "sum", field: "filling" },
```

Two supporting changes, both mechanical:

- `Bucket` gained a `filling` field (and `EMPTY` a zero). The accumulator had **no slot
  for it** — the figure was being *fetched and never bucketed*.
- The by-period branch sets `b.filling = p.filling_cost_sar`. `PnlPeriodRow` **already
  carried** `filling_cost_sar`, so **no new query, no new view read**.

**Groupings are period-only**, matching the four buckets around it: the figure comes from
`PnlPeriodRow`, which is per-period. There is no per-customer or per-truck filling view,
so offering those groupings would promise a number that does not exist.

### Deliberately NOT touched

`lib/dashboard-widgets`' `WIDGET_CATALOGUE` — the **Add Summary** fence. That is a
different surface: a Dashboard *tile*, with its own bilingual label, display modes, href
and value plumbing. The ruling was builder-eligibility. Block G asserts filling does
**not** appear there, so a stray addition would be caught.

---

## 5. Verification plan

| Block | Check |
|---|---|
| A | Dictionary is **30** rows |
| B | New entry: right grain, both halves of the pointer, uncosted caveat present |
| C | All **five** operational cost buckets now present (four before) |
| D | Fingerprint is exactly `c4e9e453…` — any other value means more than one key moved |
| E | Filling reconcile still **3 rows, 0 mismatched** |
| F | Money unmoved — 210.00 / 1,285.00 / 5,185.00 with 18/143/598 costed, 10/3/0 uncosted |
| G | **Genuinely offerable**: appears in the builder, column matches F, *disappears* under customer/truck grouping, and is *absent* from Add Summary |

**Already done:** tsc clean (both unused flags); all six money harnesses pass; production
build green via `safe-build.sh --dist-dir .next-verify`; `tsconfig.json` reverted; dev on
:3002 untouched.

**Not done: no browser click-through by me.** Block G is the one that needs a human — it
is the only check that proves the whole point (that the metric is actually selectable).

---

## 6. One thing worth a reviewer's eye

Filling has been **inside `operating_cost` since 0112**. In a builder report showing both,
they are a **component and its container — never addends**. Both are legitimate columns
and the builder has no cross-column total (by design, 0100), so nothing sums them
automatically. Flagging because a reader could reasonably try to add them.

---

## 7. To apply

1. Confirm the app is at or past **`dca9840`**.
2. Capture the before-fingerprint (should read `b3bbb25d…`).
3. Run the migration.
4. Run blocks **A–F**, then the browser checks in **G**.
5. Commit the migration file the moment the apply is confirmed — the db-reset rule.
