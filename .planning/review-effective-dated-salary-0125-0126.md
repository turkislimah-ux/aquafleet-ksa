# Review pack — effective-dated salary (0125 + 0126) + the rate-snapshot proposal

> ## ✅ CLOSED — applied, defect found and fixed forward, all committed
>
> Preserved unedited below as the record of what was proposed and why, **not current
> state** — do not read its "not applied" framing as live.
>
> | | |
> |---|---|
> | 0125 salary history | applied, committed `742bec1` |
> | **0125 shipped a live defect** | see below |
> | 0126 baseline made immutable | applied, verified, committed `5c67762` |
>
> **THE DEFECT THIS PACK DID NOT CATCH.** 0125's seed row played two roles at once —
> the immutable BASELINE that pre-history months fall back to, *and* TODAY's salary that
> a raise updates. The trigger's same-day upsert corrected the second and silently
> rewrote the first. A +100 raise entered today moved June payroll 25,000 → 25,100 and
> July 37,800 → 37,900: **past reported profit rewrote**, violating the ruling the
> migration existed to implement. Caught in verification by the architect, not by me.
>
> §1's "⚠️ the rule that makes forward-only actually work" was therefore **necessary but
> not sufficient** — it protected the fallback's *existence* and missed that the row it
> falls back to was mutable.
>
> **0126's fix bettered the proposed lean.** Rather than marking the baseline immutable
> and keeping the fallback, it dates baselines at each person's employment floor, which
> removes the fallback entirely: one resolution path, and collision becomes structurally
> impossible rather than policed. Proven write-free — 0 non-baseline rows reach June or
> July, 0 baselines sit on today's date.
>
> **Also corrected:** §1 predicted 17 seed rows; the real figure is **22** and 22 is
> right — the seed correctly includes the 5 terminated drivers July's 20,900 depends on.
> Third expected-count slip of that shape, now a named rule: derive an expected count
> with the SAME predicate the code uses.
>
> **§4's rate-snapshot proposal is still OPEN** — the A-vs-B backfill ruling has not been
> made, and no rate work has been built.

**Status at the time of writing (historical):**
`supabase/migrations/0125_salary_history.sql` **DRAFTED, NOT APPLIED.**
**Stopped.** Nothing committed this round. `0124` confirmed committed (`b479671`) before
starting — no repeat of last round.

**Two follow-ups are scoped but NOT drafted, deliberately** — §3 and §4 say why.

---

## 1. 0125 — what it does

| Piece | Detail |
|---|---|
| `salary_history` table | Subject pattern (two nullable FKs + CHECK exactly one set), matching `consumption_approvals` / `archive_documents`. Partial unique on (subject, `effective_from`). RLS enabled, `authenticated` policy — mirrors `driver_payslips`. |
| Seed | Every person's current salary, **effective TODAY (Riyadh)**. People with no salary get **no row** — absence is the honest representation. Expect **17** rows (11 drivers + 6 staff). |
| `v_payroll_monthly` | Resolves **effective** salary per month. Column list reproduced exactly (42P16). Security footer restated (§6 lock). |
| Triggers | Keep history in step with the base columns — see §2. |

### ⚠️ The rule that makes forward-only actually work

The seed alone does **not** deliver it. The guarantee is the **resolution rule**:

> latest row with `effective_from <= month end` — **falling back to the EARLIEST row**
> when the month predates all history.

**Without the fallback, June and July resolve to NULL, payroll collapses to zero, and the
P&L restates catastrophically.** Their month-ends precede the seed date. That fallback is
the entire forward-only guarantee and is called out in the migration as un-simplifiable.

With one seed row per person effective today:

| Month | Resolution | Result |
|---|---|---|
| June (ends 06-30) | no row ≤ that date → **fallback** | today's salary |
| July (ends 07-31) | no row ≤ that date → **fallback** | today's salary |
| Aug (ends 08-31) | seed row qualifies | today's salary |

All three read exactly what they read now.

---

## 2. Why a trigger, not an app write

The app writes `drivers.salary_sar` / `staff.monthly_salary_sar` directly from its forms.
**If only the seed wrote history, the day someone is hired or given a raise through the UI
they would have no history row — and the resolution would return NULL and DROP THEM FROM
PAYROLL ENTIRELY.** A silent under-count of real wages is the worst failure this feature
could have.

So history is trigger-maintained: any insert or salary-changing update writes a row
effective today. The app needs no change to stay correct and it cannot be forgotten by a
future edit path. **Two triggers per table, not one** — 0114's lesson: `OLD` is
unavailable in an `INSERT` trigger's `WHEN` clause.

Base columns stay the current salary and remain what the forms read/write. **History is
derived from them, never the reverse** — one writer, one direction.

---

## 3. ⚠️ Scope correction: it is 4 views, and I covered 3

The brief says the four payroll-reading views resolve effective salary. Checked:

| View | Status |
|---|---|
| `v_payroll_monthly` | **rewritten in 0125** |
| `v_pnl_monthly` | composes on it → **inherits the fix** |
| `v_monthly_only_costs` | composes on it → **inherits the fix** |
| `v_driver_payslip_basis` | reads `COALESCE(d.salary_sar, 0)` **directly — NOT covered** |

**I split it out rather than half-doing it.** It is an 18-column view and
`create or replace` must reproduce every column exactly in order and type; transcribing
that from a truncated read into the **payslip money path** is how a money view gets
quietly corrupted. It gets its own migration, drafted against the full `pg_get_viewdef`.

**No urgency:** with all history starting today, its resolved value for every past month
is identical to `d.salary_sar` — the change is a **no-op today** and only starts mattering
after the first real raise. Sequencing it second is safe, not a gap.

---

## 4. `trips.rate_sar` — the proposal, and why it is money-neutral

**It is not primarily a migration.** The column already exists and is NULL on all 817
rows; stamping happens at the delivery transition in `app/trips/actions.ts`, beside
`commission_sar`. Only the **backfill** is a data decision.

### The money-core question, answered with evidence

The brief requires: *if stamping changes any prepaid consumption number, STOP and flag.*
**It cannot, and here is why rather than an assurance:**

- `lib/prepaid.ts:38` documents `ConsumingTrip.rate_sar` as **"resolved at call time — NOT
  the raw `trips.rate_sar` column."** `lib/invoice.ts:231` says the same.
- The actual feed is `FinanceTab.tsx:224/257` and `fetchProjectBalance`
  (`actions.ts:764`), both passing **`project.rate_per_trip_sar`**.
- So **nothing in the money path reads the column being stamped.** Writing it moves no
  consumption figure, because no consumer exists.

**Switching prepaid to read the frozen rate is a SEPARATE change and a real ruling** — it
would be the moment customer money could move. Not proposed here.

### One real consequence to note

`ProjectsBoard.tsx:1711` renders `getRate={(t) => t.rate_sar ?? 0}` — today always **0**.
Stamping makes that Kanban figure start showing real rates. An improvement, but a
**visible change** from a "pure snapshot", so it should not surprise anyone.

### Backfill — proposing, not guessing

| Option | Effect |
|---|---|
| **A — backfill delivered trips from the project's current rate** | Provably accurate *today*: the frozen invoice lines show every confirmed `amount_sar` equals its project's current rate (410=410, 400=400, 420=420), so **no rate has ever moved** and "current" *is* the historical rate. |
| **B — leave NULL as "pre-snapshot"** | Matches the 13 grandfathered filling trips, and §7's *"do not seed a column whose NULL carries meaning"*. |

**My recommendation: A**, because the evidence removes the usual objection — we are not
asserting an unknown, we can demonstrate the rate never changed. B leaves
`ProjectsBoard` showing 0 forever for 817 real trips.

**Architect's call.** The migration is one `UPDATE` either way and I have not written it
pending the ruling.

---

## 5. The three before/after proofs

Captured live, at drafting.

**(a) Past payroll unmoved** — blocks A. Must be byte-identical:

| month | staff | driver | missing | payroll | operating_cost | net_profit |
|---|---|---|---|---|---|---|
| 2026-06 | 10,600.00 | 14,400.00 | 4 | **25,000.00** | 25,598.00 | −25,598.00 |
| 2026-07 | 16,900.00 | 20,900.00 | 3 | 37,800.00 | 57,443.9700 | 206.0300 |
| 2026-08 | 16,900.00 | 14,400.00 | 3 | 31,300.00 | 59,900.0200 | −59,900.0200 |

**June must read 25,000.00** — the 0117-corrected figure. Anything else means the fallback
is wrong: **revert.**

**(b) Issued payslips unmoved** — block B, row-hashed so a single changed field shows:

| payslip | base | commission | net | hash |
|---|---|---|---|---|
| PS-2026-000001 | 1,300.00 | 204.00 | 1,504.00 | `4c98509b50f2599dc65c797760d26aaa` |
| PS-2026-000002 | 1,300.00 | 217.02 | 1,517.02 | `e27bcb32b466660a4b5265878325e42c` |

0125 does not touch `driver_payslips` at all; they read their own snapshot.

**(c) Prepaid/consumption unmoved** — structural, per §4: 0125 touches no customer-money
object, and the rate work writes a column no money path reads. Inputs recorded:
Airport 410.00 / 77 delivered / 2 top-ups · KSU 400.00 / 145 / 6 · Royal Court 420.00 /
128 / 1, and **0 trips currently carry a frozen rate**.

Blocks **F** and **G** exercise the trigger and a future-dated change **inside a
transaction that is rolled back**, because they write real salary data — with an explicit
post-rollback count to confirm the restore.

---

## 6. What I did not do

- **No app code touched.** Surfaces come after apply, per the brief.
- **No money-core file touched** — `lib/prepaid.ts`, `lib/vat.ts`, invoice math untouched.
- **No commission work** — out of scope by ruling.
- **`driver_payslips` untouched.**
- **Nothing committed.**

---

## 7. Sequence from here

1. Review + apply **0125**; verify (a) and (b) against live data.
2. Rule on the **§4 backfill** (A or B).
3. I draft **0126** (`v_driver_payslip_basis`, verbatim) and the rate-snapshot work.
4. Then the surfaces — a salary-history UI is not in this build and has not been designed.
