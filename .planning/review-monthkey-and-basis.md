# Review pack — monthKeyOf dedupe → delivered-basis re-base

> ## ✅ CLOSED — approved by architect + Turki, no follow-ups
>
> Answers to the three questions in §10:
>
> 1. **Basis re-base APPROVED.** Turki verified the June/July figures against the
>    Dashboard and confirmed them as corrections.
> 2. **Leave `buildBaseLines` / `buildCommissionRows` as-is** — dead money code stays
>    until the UI fully migrates off it.
> 3. **The `54d3f58` / `bc32691` commit split was fine.** No action.
>
> Preserved unedited below as the record of what was proposed and why.

**Range:** `1dab0e8` (exclusive) → `65c081e` (HEAD). Six commits, three of them code.
**Status:** all applied, committed, tree clean. No migration involved — app code only.
**Purpose:** architect review before starting the `payment_mode` reconciliation.

---

## 1. The commits

| Commit | What |
|---|---|
| `2a210a5` | Commission: one `monthKeyOf`, not two |
| `2405211` | HANDOFF |
| `54d3f58` | Trips: bucket `delivered_at` on the local clock |
| `7a26f41` | HANDOFF |
| `bc32691` | Trips: re-base delivered figures onto `trip_date` |
| `65c081e` | HANDOFF |

Net code diff across the range:

```
app/trips/BreakdownReport.tsx | 68 ++++++++++++--------
app/trips/CustomersTab.tsx    | 55 +++++++++++--------
lib/commission-rows.ts        | 26 ++++++------
lib/commission.ts             | 18 +++++++--
lib/utils.ts                  | 19 +++++-----
tests/month-keys.spec.ts      | 71 +++++++++++++++++++++++++
```

**`54d3f58` was substantially superseded by `bc32691`.** That is deliberate and is
covered in §5 — it is the single most important thing to review here.

---

## 2. `2a210a5` — one `monthKeyOf`

`lib/commission-rows.ts` carried a byte-identical copy of `lib/commission.ts`'s
`monthKeyOf`, with a comment that admitted it (*"matches lib/commission monthKeyOf"*).

**Direction decided by consumers, not preference:**

| Module | Internal uses | External consumers |
|---|---|---|
| `lib/commission.ts` | 0 | **4** — BreakdownReport, CustomersTab, FinanceTab, `scripts/commission-check` |
| `lib/commission-rows.ts` | 2 | **0** |

The copy with no external consumer was **deleted**, not re-exported. `commission-rows`
now imports the one everything else already used.

**Proof it cannot change behaviour:** both bodies were `return iso.slice(0, 7);` —
diffed byte-identical before deleting.

**The real risk was the leaf property, and it was checked by running, not reading.**
`scripts/commission-rows-check.ts` executes `lib/commission-rows.ts` directly under
node, so a *runtime* dependency would break it. `lib/commission`'s only import is a
**type** (erased at compile) and `lib/db-types` imports nothing, so the runtime graph
stays empty. Verified by running the harness.

---

## 3. `54d3f58` — delivered_at bucketed on the local clock

Four sites bucketed `trips.delivered_at` (timestamptz) with `monthKeyOf` — which
slices the **UTC instant** — then compared the result against a **local** month key.
Two sides, two clocks.

Added `localMonthKeyOf` to `lib/utils.ts`. Sites: CustomersTab ×2, BreakdownReport ×2.

**Scope went beyond the ask on purpose.** The request named CustomersTab; BreakdownReport
carried the identical expression twice, two lines from code being edited anyway.

**Measured before changing anything:** of 730 delivered trips, **0** bucket differently
under UTC vs Riyadh. So this closed a *latent* hole; no live figure moved.

**This commit is now mostly reverted by `bc32691`.** See §5.

---

## 4. `bc32691` — re-base delivered figures onto `trip_date`

The substantive change. `delivered_at` records **when the stage button was pressed**,
not when the water moved; this fleet advances trips on the Kanban in bulk.

Migration **`0109`** already re-based the Dashboard's delivered-revenue view onto
`trip_date` for exactly this reason (§7 records five weeks of work collapsing onto
three afternoons, one holding 310 trips). CustomersTab and BreakdownReport had **not**
followed — so two screens disagreed about the same measure.

### The evidence

Measured against `v_delivered_revenue_daily`, the definition of record:

| Month | Old basis | New basis | The view |
|---|---|---|---|
| 2026-06 | 26 trips / **7,400** | 22 / **6,200** | 22 / **6,200** ✓ |
| 2026-07 | 126 trips / **41,970** | 130 / **43,170** | 130 / **43,170** ✓ |
| 2026-08 | 577 / 184,860 | 577 / 184,860 | 577 / 184,860 ✓ |

Old basis was out by **1,200 SAR in June and again in July**. New basis matches
exactly in all three months. **August — the current month — is unchanged**, which is
why this is invisible on screen today.

### What did and did not move

- **Predicate unchanged** — a trip still counts only if delivered. Only the **bucket** moved.
- Live, `stage='delivered'` ⟺ `delivered_at IS NOT NULL` on **all 730 rows**, so this
  selects exactly the set the view's `stage` filter does.
- `trips.trip_date` is **NOT NULL** (verified), so no rows are dropped by the new filter.

### Consequence — the clamps

`deliveredInMonth` is now a strict **subset** of `totalInMonth` (same NOT-NULL
`trip_date`, differing only by the predicate), so `0 ≤ delivered ≤ total` holds by
construction and BreakdownReport's `Math.max(0,…)` / `Math.min(1,…)` became
unreachable. Removed.

**Checked before removing:** they had **never fired** on live data — 0 of 17
project-months violated the bound, max ratio exactly 1.00. So these were
*correct-but-unfired* guards, not guards masking a defect.

---

## 5. ⚠️ The thing most worth reviewing: `54d3f58` → `bc32691`

`54d3f58` added `localMonthKeyOf` to convert timestamptz → local month.
`bc32691` re-based those same call sites onto `trip_date` — a **DATE** column, already
local calendar terms — which removed the helper's last caller.

**`localMonthKeyOf` was therefore deleted one commit after being added.**

This is the repo's own *"superseding is not removing"* rule applied to my own work
(same rule that retired `payslipPreviewNet`, `AddPriceLotModal`, `updateTrip`).
`noUnusedLocals` is what surfaced it. `tests/month-keys.spec.ts` was **rewritten**, not
patched — a spec asserting a deleted helper is worse than no spec.

**Was `54d3f58` wasted?** Judgement call for review. My read: it was a correct fix for
the problem as scoped at the time (timezone), and the basis question was explicitly
flagged as *"its own decision"* rather than folded in silently. Had the basis re-base
been rejected, `54d3f58` would still be the right code. But it is fair to say the two
could have been one commit if the basis call had been made first.

**Net result is simpler than either:** the surviving invariant is

> **Every month comparison in the app buckets on a DATE column** — so no timezone
> conversion is involved anywhere.

That is stronger than "convert timestamps correctly", because it removes the conversion.

---

## 6. Final helper map

| Helper | Question | Home |
|---|---|---|
| `todayKey()` | today, `YYYY-MM-DD` | `lib/utils` |
| `daysAgoKey(n)` | n days back, same clock (**negative n goes forward** — how today+7 is expressed) | `lib/utils` |
| `currentMonthKey()` | which month is it **now** | `lib/utils` |
| `monthKeyOf(iso)` | the month of a **stored** date — one definition | `lib/commission` |

Four helpers. `localMonthKeyOf` existed between `54d3f58` and `bc32691` only.

---

## 7. Deliberately NOT done

**`lib/commission-rows.ts:136,170`** still bucket `delivered_at` by month, inside:
- `buildBaseLines` — **zero callers**; ts-prune reports it unused
- `buildCommissionRows` — called only by its own harness

The live UI uses the rolling API keyed on `payout_id IS NULL`, not a month. The file
header already says these month-based functions are *"retained until the UI fully
migrates off them"*. Changing money code with no production caller is risk without
benefit — listed here so the grep hit is not mistaken for a miss.

**`delivered_at` remains correct for EVENT surfaces** (`v_activity_feed`) — the button
press is a real event. Not swept.

---

## 8. Self-corrections on the record

Both would otherwise read as settled fact:

1. **The clamp comment overstated.** First draft said the guards *"hid"* a problem.
   They never fired on live data. Corrected in the committed comment.
2. **Earlier claim about bonus removal was wrong.** I had said a stale month key would
   make bonus *removal* target the wrong month and silently fail. `setCommissionBonus`
   upserts `onConflict: "driver_id"` **alone** and the cycle is read back by
   `driver_id` alone — `month_key` never participates in matching. The real damage is
   view attribution, which is worse, not better.

---

## 9. Verification performed

- `tsc` clean, `noUnusedLocals` + `noUnusedParameters` on
- **All six money harnesses pass**: commission-rows, commission, covered-unpaid,
  invoice, prepaid, vat — the standing proof no money *math* moved
- `tests/month-keys.spec.ts` — 5 tests, passing under **Asia/Riyadh, UTC,
  America/Los_Angeles (−8), Pacific/Kiritimati (+14)**. Pure functions: no diagnostic
  route, no auth bypass, does not rot at teardown
- Production build via `./scripts/safe-build.sh --dist-dir .next-verify`;
  `tsconfig.json` reverted; dev on :3002 untouched (`/login` 200)

**Not done: no browser click-through by me.** Suggested check (read-only, writes
nothing): `/trips` → Customers tab, Finance tab, and a project's Breakdown report —
switch the month picker to **June** and **July**, which is where figures shift. They
should now match the Dashboard's delivered-revenue card. August is unchanged.

---

## 10. Questions for review

1. **Is the basis re-base right for these two surfaces?** It aligns them with `0109`
   and `v_delivered_revenue_daily`, but it does change what June/July revenue reads on
   a customer-facing tab. Turki should see the 7,400 → 6,200 and 41,970 → 43,170 moves
   and confirm those are corrections, not regressions.
2. **Should the legacy `buildBaseLines` / `buildCommissionRows` be deleted outright**
   rather than left on the old basis? They are unreachable from the UI today.
3. **Was splitting `54d3f58` from `bc32691` the right call**, or should the basis
   question have been raised before doing the timezone fix?

---

## 11. What's left after this

**From this sweep: nothing.** Zero UTC date keys, one `monthKeyOf`, every month figure
on a DATE column, delivered basis unified with the Dashboard.

**Next up (agreed):** `payment_mode` reconciliation — `customers.payment_model`
(`postpaid|pay_as_you_go`, NOT NULL, wired into `CustomerForm.tsx` /
`app/customers/actions.ts` / `lib/db-types.ts`) vs `projects.payment_mode`
(`postpaid|prepaid`, migration 0025/0026). Turki has confirmed `pay_as_you_go` ≈
`prepaid`, so it is a concept-merge, not a conflict resolution. **This one will need a
migration** — it touches an actively-used NOT NULL column.

**Standing deferred (untouched by any of this):** retire `water_stations.fill_cost`;
`StationPricing` hand-rolled in 3 places; the `0100` dictionary gap; effective-dated
rates (one mechanism, three consumers); Route Optimization / Predictive / IoT.

**Needs Turki, not code:** missing hire dates (5 drivers, 1 staff); PDFShift account +
`PDF_API_KEY` in `.env.local`.
