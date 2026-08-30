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

## THE FEATURE MODEL — do not re-derive this wrong

Every fact below was re-measured out of `pg_index` / `pg_constraint` /
`pg_attribute` at session close, not read off the migration files.

### The records

- A fine is a `driver_violations` row against ONE driver, typed from
  `violation_types`. **`label` AND `label_ar` are both NOT NULL** — a new type
  demands both names, because copying the English across would put English on
  the Arabic screen.
- **Reference is unique per driver among LIVE rows only** —
  `driver_violations_driver_ref_live_unique` on `(driver_id, ref_no)`
  `WHERE voided_at IS NULL`. A voided fine frees its reference for re-entry.
- **`voided_at` is the delete path**, with `voided_by` and `void_reason`
  alongside (both nullable). **Never hard-delete.** A voided fine leaves every
  total and every list while staying readable in the database — that difference
  is the entire point.

### The deduction

A payslip deducts **that month's live fines**: `voided_at IS NULL`, dated inside
the month, **every `payment_status`**. Whether the driver settled the ticket
with the authority is a different question from whether payroll charges him.

```
deductions_sar  = LEAST(month_fines, GREATEST(gross, 0))
unabsorbed_sar  = month_fines - deductions_sar
net_sar         = gross - deductions_sar          -- clamps at 0
```

**THREE NUMBERS, DELIBERATELY DISTINCT.** Collapsing any two is the bug this
model exists to prevent:

| Figure | Means |
|---|---|
| gross | the earnings sum, before any fine |
| `deductions_sar` | what the pay could actually absorb |
| `unabsorbed_sar` | what it could not |

Guarded in the database, all verified present:

- `driver_payslips_net_nonneg` — `net_sar >= 0`
- `driver_payslips_deduction_within_violations` — `deductions_sar <= violation_deduction_sar`
- `driver_payslips_unabsorbed_nonneg`, `driver_payslips_violation_deduction_nonneg`

**`unabsorbed_sar` IS A RECORD, NOT A CARRY.** No cross-month carry, no
remainder chain, no month-order requirement. No later month reads it. Recovering
it is a human decision made outside this app. **The deduction is a pure function
of (driver, month)** — which is exactly what makes the preview trustworthy.

### The freeze

`driver_payslip_violations` records which fines a payslip consumed.
**`UNIQUE(violation_id)`** (`driver_payslip_violations_violation_unique`) — a
fine can be consumed by at most one payslip, ever.

- **Frozen fines are LOCKED**: no edit, no void. Enforced in the server action,
  not merely hidden in the UI.
- **Settlement status is MONTH-LEVEL, not per-fine.** Absorption has no per-fine
  share — a month claiming 500 that absorbs 300 leaves 200 across two 250 fines,
  and "which one was the outstanding one" has no answer. Deducted if the month's
  payslip is issued and absorbed everything; Partly deducted if it left a
  remainder; **Unsettled if the payslip absorbed nothing at all** (zero absorbed
  is not "partly" anything).

### Outstanding

Roster column and driver-detail callout. **`lib/violations.ts` owns it** — one
arithmetic, three surfaces, so they cannot answer differently.

```
outstanding = sum(live fines) - sum(deductions_sar across issued payslips)
            = fines in unissued months + each issued month's unabsorbed_sar
```

Read-only aggregation on top of 0177 — **it adds no money object.** A fully
absorbed fine contributes 0; a voided one contributes nothing at all.
**Not clamped at zero, deliberately:** the only route to a negative is a fine
voided *after* a payslip absorbed it, which the UI forbids and which would mean
a document deducted money for a fine that no longer exists. That is a real
defect worth seeing, and `Math.max(0, …)` would hide exactly the case worth
finding.

### WYSIWYG

`v_driver_payslip_basis` computes the deduction in **columns 19–21**
(`violation_deduction_sar`, `deductions_sar`, `unabsorbed_sar`; `net_sar` is
col 18 and is **already net**). `issue_driver_payslip` freezes those columns
verbatim — it does **not** recompute, and it no longer subtracts. The preview
reads the same columns. A preview and the document it becomes cannot disagree.

**The Stage 3 correctness fix was exactly this:** the preview hardcoded
`deductions: 0` while reading `net_sar`. Honest while the view's net was gross;
a lie the moment 0177 made it net-of-deduction — the net shrank by the fine and
the Deductions line still said zero, so the slip did not add up on its own face.

The frozen snapshot's `violations.items` orders **oldest-first**
(`order by dv.violation_date, dv.ref_no`). The live preview is sorted to match,
or the sheet visibly reshuffles the moment it is issued with no figure changing.

---

## Decisions Turki LOCKED this feature (do not re-litigate)

1. **Clamp-no-carry**, chosen over a remainder chain. The chain needs a stable
   origin month and the live data has none — June is unissued and the
   `v_report_months` floor moves.
2. **Deduct every `payment_status`.** Paid-to-the-authority ≠ recovered-from-pay.
3. **Date floor = 1st of the current month; future dates allowed.** On ADD only —
   on edit the floor is absent, since the row's own date is the subject. **This
   floor is what makes late-fine stranding impossible, which is why no carry is
   needed.** The two decisions hold each other up; do not revisit one alone.
4. **RBAC on add-a-type: deferred.** Any authenticated user can add one today.

---

## OPEN — decisions owed from Turki (raise these, do not bury them)

Carried forward **unchanged**, from the prepaid lifetime-net change. Nothing is
broken today; both are judgement calls deliberately NOT made.

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
- **A `grep -c` for a removed identifier hits the comment that documents the
  removal. THIS RECURRED THIS SESSION** — the pre-commit check
  `grep -c 'deductions: 0'` on the staged `StatementViews.tsx` returned **1**,
  and the hit was the comment explaining that the hardcode was removed. It read
  exactly like a failed fix. Previously seen on `amountPayable.ts` with
  `topups\|returns`. **Split comment from executable text before trusting a
  count** (`grep -v '^\s*[0-9]*:\s*//'`), or match on identifier SHAPE, and read
  the surrounding lines rather than the number alone. A prose epitaph will keep
  failing the check that exists to confirm the burial.
- Locks promoted into `CLAUDE.md` and living there now, not here: migrations are
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
- `violation_types` is fetched **unfiltered by `active`** on both pages, and the
  picker filters instead. Label resolution needs retired types: a fine written
  against a since-deactivated type must still render its name, and the locked
  historical rows nobody can edit are the likeliest to point at one.

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
2. **Promote the violations money model into
   `.claude/skills/aquafleet-domain/SKILL.md`.** Per `CLAUDE.md` §7 money and
   schema rules belong there, not in a session handoff — the model section above
   is durable, not session state, and should migrate on the next domain pass.
3. Then: Notifications + Settings feature (catalog in chat memory, architecture
   ruled, `0154` pending — renumber, that slot is long past).

Read `.claude/skills/aquafleet-domain/SKILL.md` for domain constraints.
