# For review — prepaid bills from the FROZEN rate

> ## ✅ CLOSED — approved, verified, committed `d0813b9`
>
> Turki confirmed the invoice path stays switched (§6, decision 3). Re-verified
> immediately before committing: Airport 32,800.00, King Saud 59,200.00, Royal Court
> 53,760.00 identical on both bases, 0 delivered trips with a NULL rate, confirmed
> invoices 20 / 114,551.50 unchanged.
>
> Preserved unedited below as the record of what was proposed and why.

**Status at the time of writing (historical):** code written, **NOT COMMITTED.
Stopped for review.** No migration — this is app-side only; `trips.rate_sar` already
exists and is populated (0128 + the delivery stamp).

---

## 1. ⚠️ The brief said "switch `lib/prepaid.ts`". It should not be switched, and was not.

`lib/prepaid.ts` **never fetches** and holds no opinion about where the rate comes
from — `ConsumingTrip.rate_sar` is populated by the **caller**. So the change is in
the three call sites, and the money engine is untouched.

**The functional diff is 8 lines across 3 files. `lib/prepaid.ts` has ZERO functional
changes — comments only.** That is the strongest form this change could take: the
consumption math, the FIFO ordering, the covered/unpaid split and every VAT figure are
byte-identical code.

| File | Change |
|---|---|
| `app/trips/actions.ts` | `fetchProjectBalance` — select `rate_sar`, use it |
| `app/trips/invoiceActions.ts` | invoice assembly — select `rate_sar`, use it |
| `app/trips/FinanceTab.tsx` | `TripLite` gains `rate_sar`; **2** construction sites |
| `lib/prepaid.ts` | **doc comment only** — the old note asserted the opposite |

`app/trips/page.tsx` needed no change: it already selects `*`.

---

## 2. The NULL fallback — proposed, not chosen silently

**Proposed rule:**
```ts
rate_sar: t.rate_sar ?? <the project's current rate_per_trip_sar>
```
*Frozen rate if the trip has one; the project's current rate only if it has not been
delivered yet.*

### Why the risk you flagged does not actually arise

`lib/prepaid.ts` filters **before** computing any amount:

```ts
deliveredTripsSorted() → .filter(t => t.delivered_at != null)
```

`consumingItems()` is the single queue that `derivedBalanceItems`,
`buildStatementItems` and `splitCoveredUnpaidItems` all walk, and it is built from
that filtered list. **Every trip that becomes money has been delivered — and a
delivered trip always carries a frozen rate.**

So the "not-yet-delivered trip consumes at NULL/zero, a silent under-charge" case is
**structurally unreachable**, not merely unlikely.

### Then why have a fallback at all

Three reasons, none of them about today's numbers:

1. **The type is `rate_sar: number`, non-null.** The DB column is nullable, so TS
   forces the caller to resolve it. Something must be written.
2. **It degrades to the OLD basis, not to zero.** If that delivered-filter is ever
   loosened, behaviour falls back to exactly today's semantics rather than silently
   billing nothing. `?? 0` was considered and **rejected** for precisely that reason.
3. It keeps undelivered trips holding a sane number while they are filtered out.

### Live confirmation

- **0** delivered trips in prepaid projects have a NULL rate
- The **only** delivered trip with a NULL rate **is the orphan** (no project) — and it
  never enters a project's trip list, so it cannot reach prepaid consumption
- **0** undelivered trips currently have a NULL rate (0128 backfilled everything);
  that changes as new trips are created, which is exactly what the fallback covers

---

## 3. Equivalence — verified independently, not taken on report

Delivered trips only, i.e. the set the engine actually walks:

| project | delivered | current basis | frozen basis | mismatches |
|---|---|---|---|---|
| Airport facilities | 80 | 32,800.00 | **32,800.00** | 0 |
| King Saud University | 148 | 59,200.00 | **59,200.00** | 0 |
| The Royal Court of Saudi | 128 | 53,760.00 | **53,760.00** | 0 |

Confirmed invoices: **20 / 114,551.50**.

Note the delivered counts (80 / 148 / 128) are **higher than the earlier baselines**
(77 / 145 / 128) — the eight verification deliveries landed in between. **The totals
still match on both bases**, which is the point: the two bases agree per-trip, so they
agree at any count.

---

## 4. What changes on the first real rate change — the intended behaviour

Today: nothing. From the first rate edit onward:

- a **delivered** trip keeps its frozen rate and **does not re-price**
- a **new** trip takes the new rate when it is delivered
- so a rate change bills forward only, and a customer's past consumption stops moving
  under them

That is the whole reason for the switch, and it is why the acceptance test must
demonstrate it rather than just prove the no-op.

---

## 5. Verification

**Already done:** tsc clean (both unused flags) · **all six money harnesses pass**
(including `prepaid-check` and `covered-unpaid-check`, which drive the engine directly)
· production build green with dev left running.

**For the architect to prove live, before/after:**

```sql
-- consumption on the frozen basis, per prepaid project
select p.name, count(*) filter (where t.delivered_at is not null) as delivered,
       sum(t.rate_sar) filter (where t.delivered_at is not null) as frozen_basis
  from projects p join trips t on t.project_id = p.id
 where p.payment_mode = 'prepaid' group by 1 order by 1;
-- Airport 32,800.00 · King Saud 59,200.00 · Royal Court 53,760.00

select count(*), sum(grand_total_sar) from invoices where confirmed_at is not null;
-- 20 / 114,551.50
```

Plus, in the browser: each prepaid customer's **balance** on the Finance tab, and one
**statement**, unchanged before and after.

**Then the intended-behaviour test — rolled back, because it writes a rate:**

```sql
begin;
  update projects set rate_per_trip_sar = rate_per_trip_sar + 50
   where payment_mode = 'prepaid' and name = 'Airport facilities';
  -- frozen basis must STILL read 32,800.00 — past delivered trips do not re-price
  select sum(t.rate_sar) filter (where t.delivered_at is not null)
    from projects p join trips t on t.project_id = p.id where p.name = 'Airport facilities';
  -- and the OLD basis would have read 32,800 + (80 x 50) = 36,800, which is the
  -- retroactive repricing this change removes
rollback;
select rate_per_trip_sar from projects where name = 'Airport facilities';  -- 410.00
```

---

## 6. Decisions for confirmation

1. **`lib/prepaid.ts` is not switched — its callers are.** The money engine keeps zero
   functional changes.
2. **Fallback is `?? project.rate_per_trip_sar`**, never `?? 0`.
3. **The invoice path was switched too**, not just prepaid. An invoice bills each trip
   at what it was worth on the day for the same reason a balance does; leaving it on the
   live rate would have made an invoice and a balance disagree about the same trip.
   Say so if you want invoicing left alone — it is one line back.
4. Nothing committed until you approve.
