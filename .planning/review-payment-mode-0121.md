# Review pack — `payment_mode` reconciliation (migration 0121)

> ## ✅ CLOSED — reviewed, applied, verified, committed
>
> **0121 is APPLIED.** Everything below is the pack as it was handed over for
> review, preserved unedited from that point. It is a record of what was proposed
> and why, **not a description of current state** — do not read its "not applied"
> framing as live.
>
> | | |
> |---|---|
> | App code | `e69ec6a` |
> | Migration applied by | architect |
> | Migration committed | `25ce8cb` |
> | CLAUDE.md §7 updated | `6776c4f` |
>
> **Post-apply verification (all passed):** `payment_model` column 0, its CHECK 0,
> the name gone from the whole schema; customers 7 unchanged; `projects.payment_mode`
> 3/3/1 and `invoices.payment_mode` 5/1/15 both unmoved; 40 views / 40 invoker /
> 0 anon; all four `p_payment_mode` RPCs still exactly one overload each.
>
> **One correction to the migration's own header, on the record:** its block B says
> "expect 7 / 7" for total/live customers. Live is **6** and always has been —
> "Turki 1" was archived 2026-06-28, seven weeks before the migration. A column drop
> cannot archive a row and the total (7) is unchanged, so nothing is wrong; that
> expectation was written without measuring the `archived_at` filter.
>
> **Section 1's headline finding was confirmed by the apply:** this was a retirement,
> not a merge. See CLAUDE.md §7's `payment_mode` entry for the durable version,
> including the lesson about re-measuring a deferred item's premise.

---

**Status at the time of writing (historical):** app code committed (`e69ec6a`).
Migration **DRAFTED, NOT APPLIED** —
`supabase/migrations/0121_retire_customers_payment_model.sql`. **Stopped for review.**

---

## 1. Headline: this is a RETIREMENT, not a merge

The brief (and CLAUDE.md §7) framed this as a concept-merge — `pay_as_you_go` ≈
`prepaid`. **The live data says there is nothing to merge.** Checked before deciding
anything:

| Finding | Evidence |
|---|---|
| `pay_as_you_go` has **never been used** | `customers.payment_model` = `'postpaid'` on **all 7 rows** — the column DEFAULT |
| It is **wrong**, not merely redundant | Disagrees with the real setting on **3 of 6** customer/project pairs |
| Nothing reads it | **0** views, **0** functions (one *comment*), **0** triggers, **0** policies, **0** indexes |

The three disagreeing rows:

| Customer | `payment_model` says | project says |
|---|---|---|
| MMM construction Co. | postpaid | **prepaid** |
| Seder Facility mang. Co. | postpaid | **prepaid** |
| Seder Facility Mang. Co. | postpaid | **prepaid** |

**Why it drifted:** the Customers form was its *only* writer, and nothing updated it
when the project's real mode changed through ProjectModal. Two writable sources, one
of them unguarded and unread. Merging it into `projects.payment_mode` would import
that wrongness.

**Rename direction, decided by consumers rather than preference:** `projects.payment_mode`
survives. It is what all four RPCs take, what `can_switch_payment_mode` (0035) guards,
and what `invoices.payment_mode` freezes at confirm (0037). `customers.payment_model`
is dropped.

---

## 2. What the migration does

```sql
alter table public.customers drop column if exists payment_model;
```

One statement, no `cascade` (so an unexpected dependency fails loudly rather than
cascading). The `customers_payment_model_check` CHECK constraint drops with the column
automatically — it is not named separately.

---

## 3. Blast radius

**Database:** nil beyond the column. Verified six ways (queries are in the migration
header for independent re-running): views 0, functions 1-but-only-a-comment, triggers
0, policies 0, indexes 0.

The one function hit is `create_project_with_customer`, whose *only* mention is:

```
-- 1) Customer. payment_model/active fall to their column defaults.
```

It does not name the column in any INSERT or UPDATE. The migration header includes a
query to re-confirm that specific line before applying, and says STOP if an INSERT
turns out to name it.

**App:** already handled in `e69ec6a`, committed ahead of the migration — the 0119
order (stop reading before dropping). Removed: the writable "Payment model" select,
the `payment_model` key in `createCustomer`/`updateCustomer`'s shared `parse()`, the
`PaymentModel` type, `PAYMENT_MODEL_LABELS`.

**The app is correct in BOTH directions.** It reads customers with `select("*")` and
simply no longer declares the column in its type, so there is no window where one side
is broken. The migration can be applied whenever.

### Constraint checks from the brief

| Constraint | Result |
|---|---|
| Don't touch money-core (`lib/prepaid.ts`, `lib/vat.ts`) | **Not touched.** Neither ever referenced `payment_model` — confirmed by grep, not assumed. Nothing to flag. |
| Don't change invoice/finance RPC signatures | **No RPC changed.** Flagged below for completeness. |

**RPC flag (no action needed, stated because the brief asked):** four functions take a
`p_payment_mode text` parameter — `create_project_with_customer`,
`update_project_with_customer`, `confirm_invoice`, `can_switch_payment_mode`. **All
four refer to `projects.payment_mode` or `invoices.payment_mode`, not the column being
dropped.** None is altered, and none needs to be.

**Worth knowing:** `payment_mode` exists on **three** tables — `projects` (the source),
`invoices` (the 0037 frozen snapshot, correctly a separate historical record), and
formerly `customers` under the `payment_model` name. Only the third is going.

---

## 4. What replaced the UI control

The Customers list's **Payment** column is now **derived** from the customer's project
(`projects.payment_mode`), read-only, resolved server-side. 1 customer = 1 project
(`projects_customer_id_unique`, 0015), so the mapping is unambiguous. No project, or a
project with no mode set → **em dash**, matching the `—` the Archive customer tab
already uses for this exact field.

**The writable control is gone from the Customers form on purpose.** The real one is
ProjectModal's Payment & Rate section, where `can_switch_payment_mode` refuses a switch
until every invoice is settled. A second writable source with no guard in front of it
is precisely what produced the drift.

> ⚠️ **A visible change Turki should see and confirm.** The Payment column previously
> read "Postpaid" for every customer. It will now read **Prepaid** for three of them.
> That is a correction — those three customers' projects have always been prepaid — but
> it will look like a change. This is the one judgement call in the batch worth
> explicit sign-off: **is removing the payment field from the Customers form acceptable,
> given the real editor is one click away under Trips → Customers → Manage project?**

---

## 5. Verification plan

**Before applying** — block F in the migration, run while the column still exists:

```sql
select c.name, c.payment_model as customer_says, p.payment_mode as project_says
  from public.customers c left join public.projects p on p.customer_id = c.id
 order by c.name;
```

Expect `postpaid` on every row and three rows where the project says `prepaid`.
**If any row reads `pay_as_you_go`, STOP** — someone started using the column since
drafting and the retirement needs re-deciding.

**After applying** — blocks A–E:

| Block | Check |
|---|---|
| A | Column gone; `customers_payment_model_check` gone with it |
| B | 7/7 rows intact; column count differs by exactly 1; every other field present |
| C | Source of truth unmoved — projects 3/3/1, invoices 5/1/15 |
| D | 40 views / 40 invoker / 0 anon; the four RPCs still have **exactly one overload each** |
| E | Browser: `/customers`, its Edit form, ProjectModal, Archive customer tab |

**Already done:** `tsc` clean (both unused-flags on); production build via
`safe-build.sh --dist-dir .next-verify`; `tsconfig.json` reverted; dev on :3002
untouched (`/login` 200).

**Not done: no browser click-through by me.** The `/customers` checks in block E are
the ones that need a human.

---

## 6. Decisions taken, for confirmation

1. **Retire rather than merge** — no `pay_as_you_go` data exists to convert.
2. **`projects.payment_mode` survives**, direction chosen by consumer count, not taste.
3. **Payment becomes a derived, read-only column** on the Customers list rather than
   being deleted from the page outright — preserves the information without a second
   source of record.
4. **The writable field is removed** from the Customers form entirely.
5. **`invoices.payment_mode` left alone** — a frozen snapshot is a legitimately
   separate record of what the arrangement *was*, not a duplicate of what it *is*.

---

## 7. To apply

1. Confirm the running app is at or past **`e69ec6a`**.
2. Run block **F** (evidence) while the column still exists.
3. Run the migration.
4. Run blocks **A–D**, then the browser checks in **E**.
5. Commit the migration file the moment the apply is confirmed — the db-reset rule.
