# SESSION HANDOFF — 2026-08-21 (0144 + 0145 committed; 0145 applied — Operations glossary reconciled)

**Read `CLAUDE.md` first, then `CLAUDE.md` §7 (the durable record), then this file.**
This file is a POINTER to §7, never the record itself — §5's rule, and §7's
`amountPayable.ts` entry exists because a rule that lived only in the handoff went
stale and actively wrong for two commits.

**NEWEST: `0145` is applied and committed; `0144` is committed and deliberately
NOT applied. Both are the Operations glossary — see §6 item 2, then §4.**

## 0. STORED-STATUS CLEANUP, ITEM 1 IS DONE (0143)

**`0143_drop_write_off_payment_mode.sql` is applied, live-verified and committed
(`7849641`).** SQL only — no TS, no UI, `tsc --noEmit` clean.

It dropped `customer_write_offs.payment_mode` and, in the SAME transaction,
recreated `archive_project_guarded` without it (the write-off INSERT lost the
column, and the coupled `v_mode` local went with it). Signature and behaviour
otherwise identical, including 0141's `on conflict ... where reversed_at is null`
target. Four self-asserts at the foot: column gone, one signature, body clean,
conflict target intact — any failure rolls back both changes.

**The durable rule is in §7, not here.** Two things future sessions need from it:
a write-off row carries no payment mode, and dropping a column an RPC writes is
ONE transaction because plpgsql bodies are not dependency-tracked.

Verified before drafting, on the live DB: zero readers — no view selects it, no
other routine names it (`restore_customer_guarded` touches the table and does
not), no app code reads it. Its only two `pg_depend` entries were its own CHECK,
which drops with the column. Turki applied it and rehearsed a forced archive
rolled back: the write-off row still writes with the column gone, and the 3
pre-existing rows are untouched.

**What the diagnosis behind item 1 found, and deliberately did NOT change:**

| column | verdict |
|---|---|
| `customer_write_offs.payment_mode` | dead → **dropped (0143)** |
| `invoices.payment_mode` | **LOAD-BEARING — leave it.** A deliberate snapshot; 0035 lets a project switch mode after confirm, so stored ≠ live is CORRECT. 7 non-null / 16 null, 0 disagreements today |
| `invoices.status` | **LOAD-BEARING, but a second encoding** of the same lifecycle as `confirmed_at/paid_at/voided_at`. 0 drift across 23 rows, held only by RPC discipline — no trigger, no CHECK ties them. `v_invoice_outstanding_live` reads the TIMESTAMPS and never `status`, while `v_customer_amount_payable` and 0142 read `status`. A reconciliation job, **not** a drop |
| `v_invoice_outstanding_live.effective_payment_mode` / `.outstanding_basis` | computed, **zero app readers** — app takes only `invoice_id, outstanding_sar` |

**CLOSED — `0135` and `0136` NEVER EXISTED. Do not re-open this.** Three
independent proofs: they are the only gaps in `0001..0143` on disk (141 files);
no file matching them was ever added on any branch (`git log --all
--diff-filter=A`); and the remote ledger jumps `0134b` (`20260818202229`)
straight to `0137` (`20260819104705`), ~14h apart with nothing between. The
numbers were skipped while drafting. Nothing is lost and nothing is recoverable
because there is nothing to recover. **What that reconciliation DID turn up is in
§4 — the ledger is not a mirror of disk.**

## 0a. CUSTOMER RESTORE IS COMPLETE, ALL THREE UNITS (2026-08-20)

**All three units are done, applied, verified and pushed.** Nothing about customer
restore is outstanding.

| unit | what | commit |
|---|---|---|
| 1 | `0142` — a balance return is a DEBIT (netting fix, 16 files) | `1f11997` |
| 2 | `0141` — `restore_customer_guarded` + ACTIVE-only write-off suppression | `3d09a54` |
| 3 | The Restore UI in the Archive page — row + detail popup | `ea07dbc` |

**The durable rules are in §7 and stay there.** Unit 3 added no new rule: it is UI
wiring over the RPC that unit 2 shipped, so §7 was deliberately NOT touched for it.

Unit 3, briefly (details are in the commit body, which is long on purpose):
- Restore in BOTH the archived-customer row and the detail popup, calling
  `restore_customer_guarded` with the actor from `actorEmail()` — server-side, never
  a form field.
- The confirm dialog NAMES the consequences before the click: a written-off
  customer's debt comes back (amount read at click time, not from the render
  capture), a refunded customer returns with no spendable credit.
- **23514 (not-archived) is treated as a STALE ROW, not a bug** — shows the RPC's
  message and refreshes so the dead row leaves the list. Structural drift raises
  plainly and is shown as-is.
- Both entry points gated on `archived_at` being set; the list also admits
  merely-inactive rows, for which the RPC could only ever raise 23514.
- Turki verified all six test groups in-browser, then asked for two colour changes
  (row Restore tinted brand-blue, write-off caption amber) — both from the existing
  palette, both in the same commit.

**Two stale comments were corrected in that commit rather than left to rot:**
`ArchiveCustomerTab`'s note that Restore deliberately did NOT exist, and
`app/archive/actions.ts`'s header claim that the file contains no RPC. Both were
true when written and both had been made false by the work above.

## 0b. UNIT 2 OF 3 IS DONE (2026-08-20)

**Migration 0141 is APPLIED to the live DB and committed (`3d09a54`).** Customer
restore exists. **The rules live in §7, not here.**

- **Turki applied 0141 himself via MCP this session**, so it is recorded remotely
  under the MCP auto-timestamp, NOT under the `0141_` filename. **The file on disk is
  the authoritative artifact.** Do not re-apply it and do not "re-push" it to fix the
  remote name.
- Live-verified with rolled-back rehearsals before the commit: write-off reversal
  returns TEST 111's debt to **−20,056** from live inputs with the row kept and
  marked; a returned-balance customer restores with its money untouched; re-archive
  after restore writes a fresh ACTIVE write-off. All 7 in-migration assertions passed
  at apply, including the two that read `pg_get_functiondef` / `pg_get_viewdef` back
  to prove the conflict target and both `reversed_at` predicates survived.
- SQL only — one file, +1,132 lines. No TS changed. `tsc --noEmit` clean.
- **0141 sits BELOW 0142 on purpose.** Drafted first, parked, landed second. Not a
  numbering mistake — do not renumber either file.

*(**Superseded by §0a** — unit 3 shipped in `ea07dbc`, so
`restore_customer_guarded` now has a caller. This section's "NEXT — UNIT 3, nothing
is built for it yet" has been removed rather than left standing, because a stale
NEXT is the one kind of stale that gets acted on.)*

## 0c. UNIT 1 OF 3 IS DONE (2026-08-20, earlier)

**Migration 0142 is APPLIED to the live DB and the netting fix is committed
(`1f11997`).** A recorded balance return is now a DEBIT against spendable prepaid
credit. **The rule itself lives in §7, not here** — this section only says where
things stand.

- DB is at **0142** (§7's DB line updated to match).
- Applied on live data: the one refunded customer nets to exactly **0.00** in BOTH
  the TS engine and the SQL view; all six un-refunded customers unchanged to the
  halala. All four in-migration assertions passed at apply time.
- Turki browser-verified the TS side before the commit.
- 16 files: the migration, `lib/prepaid.ts`, `lib/invoice.ts`, `lib/db-types.ts`,
  six `app/trips/*`, `app/archive/ArchiveCustomerTab.tsx`, two check harnesses.
  `tsc --noEmit` clean. `prepaid-check`, `covered-unpaid-check` and `invoice-check`
  all pass, with 16 new cases covering refunds.

*(Written while 0141 was still held back. **Superseded by §0b** — 0141 is now applied
and committed. Left in place rather than rewritten, because the sequencing is the
point: the netting shipped on its own, without the restore work riding along.)*

`CLAUDE.md.backup` is an untracked stray in the repo root. It is not ours to commit;
delete it or leave it, but never stage it.

**Naming note:** this file is `.planning/HANDOFF.md`. It is NOT gitignored (only
`.planning/HANDOFF.json` and `preview/.planning/HANDOFF.json` are — those belong to
the gsd plugin). But it sits one character away from the path that cost this repo
three blanked files. Our durable JSON snapshot remains
**`.planning/AQUAFLEET-HANDOFF.json`**. There is also an older
`.planning/SESSION-HANDOFF.md` (2026-08-17) — unrelated, not superseded by this.

---

## 1. RECENT COMMITS

Nine commits this session, one logical unit each (§5).

| hash | what |
|---|---|
| `7849641` | `0143` — drop the never-read `payment_mode` from customer write-offs |
| `688628c` | Record the 0143 rule in `CLAUDE.md` §7 + update this pointer |
| `2c13e0c` | Correct the stale view count in §7 (40 → 47) |
| `e5c0356` | Record the 0135/0136 reconciliation and the ledger finding |
| `6be5464` | Check the last two remote-only rows; record the `0101` divergence |
| `485b3a2` | `0144` — reconcile the repo to live for the Operations glossary |
| `eac5ec8` | Record the `0101` decision as RESOLVED; `0145` drafted |
| `bcb9ed6` | `0145` — add the non-additivity caveat to the `operations` metric |
| *(this file's commit)* | Record `0145` as applied + committed; re-measure the ledger |

`7849641` is SQL only, +215/−0, staged by explicit path, staged blob inspected
with `git show :<path>` before committing. The docs commits carry `CLAUDE.md` and
`.planning/HANDOFF.md` only — no code, deliberately separate from the migration.

`2c13e0c` exists because `688628c` edited the §7 DB line to bump the migration
number and left the stale view count sitting on the same line. **Editing one fact
on a line does not verify the others on it** — re-measure the whole line or leave
it alone.

**Kept from the previous session, still true:** `e65d980` and `0adbab1` are in
and pushed.

`e65d980` was already committed but **unpushed** when this session opened, while the
handoff's own §2 asserted "Nothing unpushed." `git status -sb` read
`## main...origin/main [ahead 1]`. **The handoff's self-claim about push state is the
one claim it cannot verify about itself — check `git status`, never the prose.**

`0adbab1` is docs-only: `CLAUDE.md` + `.planning/AQUAFLEET-HANDOFF.json`,
+27/−12, `tsc --noEmit` clean, staged by explicit path, staged blob inspected
(`git cat-file -s`, and the staged JSON re-parsed with `json.load` before commit).
The JSON diff GREW (9 insertions / 6 deletions) — reasoned before committing: 3
changed scalar lines plus 3 array appends, each append adding a comma to the previous
last element. §5's shrinking-diff-is-a-stop-signal did not fire.

## 2. CURRENT STATE

```
$ git -C /Users/turkislimah/aquafleet-ksa status -sb
## main...origin/main

$ git diff --stat            (empty)
$ git diff --stat --cached   (empty)
```

**Working tree clean, nothing uncommitted.** `npx tsc --noEmit` clean at session
end. **Push state is NOT asserted here** — this file is written before the push
that carries it, so the claim could only ever be a guess. `git status -sb` is the
authority; §1's lesson is that the handoff's self-claim about push is the one
claim it cannot verify about itself.

**`git` needs `-C /Users/turkislimah/aquafleet-ksa`.** The Bash tool's cwd is
`/Users/turkislimah`, which is NOT a repo — a bare `git push` died with
`fatal: not a git repository`. Shell cwd did not persist across turns this
session either: the session opened in `/Users/turkislimah` and the FIRST act of
real work had to be re-confirming the repo root with `git rev-parse --show-toplevel`.
**`~/.planning/HANDOFF.md` does not exist; `~/.planning/HANDOFF.json` is the gsd
stub and is EMPTY** — reading it at session start reports "no state" for a
project that has plenty. The real handoff is the one you are reading.
Same family as the wrong-directory grep in §5: **a command that ran somewhere else
does not report that it ran somewhere else.**

## 3. THE ARCHIVE VERIFICATION — CLOSED

**Turki's verbatim request was "verify archiving still works in browser". IT IS
DONE.** He ran the click-through **himself** on 2026-08-20 and reported "Test
Completed, Verified and pass". Archiving blocked with the figure.

**What that proves, and it is the whole question a DROP raises:** the app resolved
AND executed `archive_project_guarded` through PostgREST after `0140` removed the
bare name. **PGRST202 ("Could not find the function") does not occur** — ruled out
from the APP side, not just the DB side. Recorded in §7 on both the `0139` and the
`0140` entries (`0adbab1`).

**A BLOCK is a REFUSED write.** Nothing changed, and it still exercised the function
end-to-end. **Prefer the refused write whenever the alternative writes irreversible
data** — §5 carries this as a standing method.

### DB-side proof, from the prior session — still valid, read-only

| check | result |
|---|---|
| `archive_project*` routines in `public` | exactly one — `archive_project_guarded(uuid,text,text)` |
| argument shape | `p_project_id uuid, p_override_reason text DEFAULT null, p_actor text DEFAULT null` |
| matches the call at `app/trips/actions.ts:998`? | yes |
| `authenticated` EXECUTE | true |
| bare `archive_project` | gone |
| `prosecdef` (security definer) | **false** — runs as invoker |

```sql
select p.oid::regprocedure::text as signature,
       pg_get_function_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'archive_project%'
 order by 1;
```

The app branches on `const CHECK_VIOLATION = "23514"` and the figure is formatted by
the RPC (`to_char(v_owed, 'FM999,999,990.00')`). **Branch on the code, never the
message text.**

### The two write paths — ALSO DONE, by Turki, same night

He ran both himself after saying "i will do the archives my self". Verified read-only
afterwards:

| path | project | evidence |
|---|---|---|
| force-archive w/ override | RRR T `fd408e6e…` | project `archived_at`, **customer** `archived_at` and the `customer_write_offs` row all on **one identical stamp** `2026-08-19 23:32:29.473557+00`; frozen `amount_sar` **20,056.00** = the measured owed exactly; `reason` and `written_off_by` populated |
| plain archive, no override | Airport facilities `42941279…` | archived clean at `2026-08-20 00:02:41.959339+00`, project + customer one stamp, **+11,895.00 CREDIT** — a positive payable does not block |
| override ABANDONED | VVV Test 2 `70dcb451…` | `archived_at` still null, `customer_write_offs` still at **exactly 1 row** — **a block and a walked-away override are both completely inert** |

**The override is ROLE-GATED — offered to MANAGERS.** Turki's words.

**After the write-off, TEST 111 Co. reads `0.00` / `archive_blocked = false`** in
`v_customer_amount_payable`, down from −20,056.00. The write-off flows through
`v_receivables_open`'s `written_off` basis and **zeroes the guard's own input.**

### The Return Balance flow — ALSO DONE, and block G passed exactly

One `customer_balance_returns` row, Seder Facility Mang. Co. `de4b1ffc…`,
`2026-08-20 00:15:09`, **11,895.00 = the whole credit**, `bank_transfer`, ref
`FT-547516842`, `photo_path` in storage, `returned_on` / `note` / `returned_by` all
populated.

**AND THE BALANCE DID NOT MOVE.** `v_customer_prepaid_balance.balance_sar` and
`amount_payable_sar` both still read **11,895.00**, identical to before. The only
change is `balance_returned` → **true**. That is **RECORDING IS NOT DEDUCTING** proven
on live data, not asserted.

The second-call raise is **structural**: `customer_balance_returns_customer_id_key` is
a **UNIQUE index on `customer_id`**. One return per customer, enforced by the DB.

**EVERY PATH IN `0139` IS NOW EXERCISED. Nothing here needs re-verifying.**

### DO NOT, without asking Turki first

- **Complete an archive** — stamps `archived_at` on the project AND its customer, and
  **customers have NO Restore** (§7, deliberate — `0019` archives the customer as a
  side effect of the 1:1 project).
- **Force-archive with an override reason** — additionally inserts a
  `customer_write_offs` row: one per customer, unique-indexed, amount frozen at
  insert and never recomputed, and **a written-off customer is permanently an
  archived one.**

Both are real, effectively irreversible state changes on live data.

### Live figures, re-measured 2026-08-20 — RE-MEASURE AGAIN BEFORE USE

Unchanged from `0139`'s apply-time table, whose own note says these "move with every
delivery and invoice".

| project | project_id | customer | mode | owed SAR | blocked |
|---|---|---|---|---|---|
| The Royal Court of Saudi | `00243565-c998-4650-afb6-a87075747a11` | Seder Facility **m**ang. Co. | prepaid | 55,274.00 | yes |
| King Saud University | `dfab388f-db51-47ad-b144-f6b03b245a6a` | MMM construction Co. | prepaid | 48,290.00 | yes |
| VVV Test 2 | `70dcb451-dce0-4153-81af-182dc0a1d537` | VVV CO. | postpaid | 46,460.00 | yes |
| King Salman Park | `7a94e22e-83b3-45e8-a7d0-766da0855b8a` | Turki Contraction Co. | postpaid | 38,295.00 | yes |
| RRR T | `fd408e6e-5acf-4109-b474-28ae1b7e8e92` | TEST 111 Co. | postpaid | 20,056.00 | yes |
| *(no active project)* | — | Turki 1 | **null** | 1,035.00 | yes |
| Airport facilities | `42941279-747b-4fb8-b511-5d9c380766a6` | Seder Facility **M**ang. Co. | prepaid | — (credit 11,895.00) | no |

```sql
select p.name as project_name, p.id as project_id, v.customer_name,
       v.payment_mode, v.amount_payable_sar, v.owed_sar, v.archive_blocked
  from public.v_customer_amount_payable v
  left join public.projects p
    on p.customer_id = v.customer_id and p.archived_at is null
 order by v.amount_payable_sar asc;
```

**The `Turki 1` row is the SEVENTH and §7's apply-time table omits it** — no active
project, `payment_mode` NULL, still blocked. That is `0139`'s Q1 fail-closed rule
working: an unresolvable payment mode is treated as postpaid. **A customer with no
project still appears in this view.**

### NAME COLLISION — confirm by ID, never by the name on screen

Two DISTINCT customers, one letter apart, with two DISTINCT projects. Measured
read-only before anything irreversible was proposed:

| customer | customer_id | project | payable |
|---|---|---|---|
| Seder Facility **m**ang. Co. | `d59b9bfe-8a69-4b31-9d1d-a97ee2159341` | The Royal Court of Saudi | −55,274.00 |
| Seder Facility **M**ang. Co. | `de4b1ffc-fbc6-435b-a803-9dc116233003` | Airport facilities | **+11,895.00** |

`archived_at` null on both customers and both projects; both prepaid.
**Archiving one cannot touch the other.** This check had to clear first precisely
because an archive stamps the CUSTOMER and there is no customer restore.

## 4. DB STATE

- **Highest migration APPLIED: `0145_operations_metric_caveat.sql` — applied by
  Turki, live-verified and committed (`bcb9ed6`).** 9,015 bytes / 166 lines.
  Ledger row `operations_metric_caveat` @ `20260820214605`. Re-verified read-only
  2026-08-21: `operations.caveat` is 569 chars, carries both phrases its own
  assertion checks, `report_metrics` still holds 30 rows, `operations_by_driver`
  present exactly once. `0141`/`0142`/`0143` landed between this line's previous
  value (`0140`) and now; see §0, §0a, §0b.
- **Highest migration ON DISK: `0145` — the same file. The gap is `0144`, which
  is committed (`485b3a2`) and STAYS UNAPPLIED — Turki's call, 2026-08-21.** So
  the numbering INVERTS: an unapplied `0144` sits under an applied `0145`. That
  looks wrong to anyone diffing the ledger against disk and is not. Read the two
  apart before acting:
  - **DO NOT APPLY `0144` TO LIVE. IT IS NO LONGER A NO-OP, AND IT FAILS SILENTLY.**
    It was a no-op against the database as it stood BEFORE `0145`. It is not one
    now. Its step 2 sets `operations.caveat = null`, and `grain` / `source_view` /
    the `operations_by_driver` upsert all already match live — so **the only
    column it would change today is `caveat`, wiping the 569 chars `0145` just
    installed.** Its own assertion (2) checks `caveat is null`, which is `0098`'s
    shape, so after the wipe **the assertion passes and the transaction commits
    reporting success.** The glossary silently goes back to rendering nothing.
    Verified read-only 2026-08-21 before the decision; nothing was applied.
  - `0144_reconcile_operations_by_driver_metric.sql` — reconciliation only, and
    its value is ENTIRELY on the reset path: without it a rebuilt database has no
    `operations_by_driver` key at all. It does not need a ledger row to do that
    job. See §6 item 2.
  - `0145_operations_metric_caveat.sql` — the CONTENT change, applied. On a
    rebuild the two run in order: `0144` nulls the caveat back to `0098`'s shape,
    `0145` then writes the text. **They do not contradict each other** — `0144`'s
    assertion that the caveat is null is true at `0144`'s moment, which is the
    only moment it claims anything about. **Order is the whole safety property.**
    On disk it is `0144 → 0145`. Applying `0144` today runs it `0145 → 0144`,
    reversed, and last writer wins. If it ever must go into the ledger, the only
    safe sequence is `0144` then IMMEDIATELY re-run `0145`, same sitting.
  - **The general rule this earns: a migration's "no-op" status is a claim about
    one MOMENT, not a property of the file.** Every later migration that touches
    the same row can revoke it, silently, and an assertion written to defend the
    old moment will happily certify the damage. Re-verify against live before
    applying any migration that has been sitting unapplied.
- "Nothing applied-but-uncommitted" is **not** true of the ledger — four rows
  below. (The `0101` incident: **an applied-but-uncommitted migration is exactly
  what a db reset drops.**) The inverse now also holds: `0144` is
  committed-but-unapplied, which is the safe direction of the same asymmetry.
- **`0135`/`0136` never existed — CLOSED, see §0.** Do not re-reconcile.
- **THE REMOTE LEDGER IS NOT A MIRROR OF DISK: 143 files against 93 rows in
  `supabase_migrations.schema_migrations` (both re-measured 2026-08-21). Do not
  use it to audit what is applied — the DB itself is the authority.**
  - It records `0036`, `0037`, `0058`, then nothing until `0060`, after which it
    runs near-continuous. `0001–0035` and most of `0038–0059` are simply absent:
    applied before history tracking, or through the SQL Editor, which writes no
    row. Absence from the ledger is NOT evidence a migration did not run.
  - **10 rows carry no number**, all MCP-applied under auto-timestamps, measured
    2026-08-21 by `name !~ '^[0-9]'`: `v3_ledger_totals_and_hide_amount_due`,
    `invoice_payment_mode_snapshot`, `receipt_vote_approvals_and_lot_fix`,
    `retire_customers_payment_model`, `retire_water_stations_fill_cost`,
    `pay_commission_monthly`, `net_balance_returns` (0142),
    `restore_customer_reverse_write_off` (0141),
    `drop_write_off_payment_mode` (0143), `operations_metric_caveat` (0145).
    **Map by NAME, never by number** — and this line is itself the proof: it
    previously said 8 and listed disk numbers, which was one short even before
    `0145`, because six of those names map onto five remembered numbers. Count
    the ledger's own `name` column; do not translate it first.
  - `0141` sorts AFTER `0142` by timestamp, matching §0a's "0141 sits BELOW 0142
    on purpose". `0063/0064/0089/0097` each applied twice. `0140`'s remote name
    (`drop_unguarded_archive_project`) differs from its disk name.
- **FOUR rows are remote-only — applied, never committed as files:**
  `0101_operations_by_driver_reapply`, `0103_dashboard_views_fix`,
  `0103_restore_invoker_action_items`, `0134b_fix_balance_guard_customer_join`.
  **ALL FOUR ARE NOW CHECKED (2026-08-20). None is dangerous. Three are ledger
  artifacts; `0101`'s was a genuine file-vs-DB divergence, now RESOLVED by
  `0144` — §6 item 2.**
  - **`0134b` CHECKED, SAFE.** It repaired `pay_invoice`: the first 0134 guard
    joined `projects` on `i.project_id`, a column invoices do not have, so every
    `balance` settlement would have raised 42703. On-disk `0134` already carries
    the fixed `pr.customer_id = i.customer_id` join (line 196) and live
    `pay_invoice` matches it — the file was corrected in place after the hotfix.
    A ledger artifact, not a divergence. Disk replay reproduces correct behaviour.
  - **`0103_dashboard_views_fix` CHECKED, SAFE — and it is the reason
    `0103_restore_invoker_action_items` exists.** Its content is two corrections
    to `v_dashboard_action_items`: `invoice_unpaid` reads `v_receivables_open`
    directly instead of restating its predicate (the old branch counted 5,
    including 3 prepaid-settled invoices at `amount_due_sar = 0`), and
    `trip_overdue` moved from the denylist `stage <> 'delivered'` to the
    allowlist `stage in ('scheduled','loading','in_transit')`. Disk `0103`
    already carries **both** (lines 103 and 119) plus the full security footer
    (lines 494–503), so disk is a superset and replay reproduces live.
    - **IT IS ALSO A LIVE DEMONSTRATION OF THE §6 RULE.** The patch is a bare
      `create or replace view` with **no footer**, so it silently dropped
      `security_invoker` off a view sitting over 20+ RLS-enabled tables. The
      ledger timestamps are `0103_dashboard_views_fix` at `20260811000538` and
      `0103_restore_invoker_action_items` at `20260811000604` — **26 seconds
      apart.** The second row is not a migration, it is the repair for the
      first. §6 is not theory; this is what it costs.
    - Live end state re-measured: invoker `true` / anon `false` / auth `true`,
      reads `v_receivables_open`, old denylist gone, and dashboard
      `invoice_unpaid` = `v_receivables_open` count = **1 = 1** — the invariant
      the fix exists to hold.
  - **`0101_operations_by_driver_reapply` CHECKED — SAFE, but a REAL DIVERGENCE.
    Do not treat this one as a ledger artifact the way `0134b` was.**
    - **Its own header is wrong.** It says `re-apply — identical to the
      reviewed+verified file`. It is not: ledger sizes differ (base 3132 chars,
      reapply 2886) and the two disagree on the dictionary in **opposite
      directions**. Disk `0101` runs `update report_metrics ... where
      metric_key = 'operations'`, amending the existing key, and its header
      argues the case — a finer cut of one metric does not earn a second key
      (0100's precedent). The reapply instead **inserts a new key**,
      `operations_by_driver`.
    - **Live follows the reapply.** `operations_by_driver` exists; `operations`
      still reads `source_view = 'v_operations_monthly'`, `grain = 'one month'`,
      i.e. the disk UPDATE never ran. Confirmed one-directional: exactly one
      disk file touches `metric_key='operations'` (0101 itself) and **zero** disk
      files insert `operations_by_driver`, so **that live key cannot be
      reproduced from the repo.**
    - **The VIEW is fine** — live `pg_get_viewdef` matches disk exactly, invoker
      `true` / anon `false` / auth `true`. Divergence is dictionary rows only.
    - **Impact: nothing is broken today**, and it touches no money or security
      path. `app/reports/page.tsx:111` selects all of `report_metrics` and the
      glossary renders whatever rows exist, so the driver metric currently has a
      definition. A rebuild from migrations loses that glossary entry and
      changes the `operations` entry. **DECIDED 2026-08-21 — Turki kept live's
      separate `operations_by_driver` key; `0144` writes that choice to disk.
      This bullet is now HISTORY, not an open question.** The evidence is kept
      because it is what the decision rests on. Old wording follows for the
      record: keep live's separate
      `operations_by_driver` key, or keep disk's amended `operations`. Whichever
      wins needs a migration so file and DB finally agree.
    - **THE LESSON, which generalises past this file.** Disk `0101`'s header
      declares it "RECONCILED TO WHAT IS ACTUALLY APPLIED ... verified against
      `pg_get_viewdef`". That verification was honest and it passed —
      `pg_get_viewdef` simply cannot see `report_metrics` rows. **A file
      reconciled by viewdef is reconciled in its VIEW, not in its data writes.**
      A migration that both defines an object and writes rows needs both halves
      checked; the loud header covered only the half that was easy to measure.
- **DB writes this session: `0143` and `0145`, both applied by Turki.** Every
  query Claude Code ran was read-only `execute_sql`, including the post-apply
  verification of `0145`.
- View posture **re-measured 2026-08-20: 47 views / 47 security_invoker / 0
  anon-readable.** §7 claimed 40 until `2c13e0c`. §6 carries the query — *the two
  counts matching is the check, not the number.*
- **Tables: 76, all 76 RLS-enabled** (the §7 "73+" is deliberately open-ended).
  `anon` holds a table-level SELECT grant on all 76, but it is **inert**: 75
  policies exist, every one names `authenticated` only, none names `anon` or
  `public`, so RLS denies anon by default. **The table posture rests on the
  policies, not on the grants — do not "tidy" a policy away.** Note 76 tables
  against 75 policies: one table has RLS on with no policy at all. That fails
  closed and is safe; whether it is intentional is unverified.
- **Migrations are DRAFTED to disk for Turki to run in the Supabase SQL Editor —
  never self-applied through the MCP.** Read-only `execute_sql` queries ARE allowed
  and are the standard proof mechanism; that is all this session used.

## 5. DECISIONS / CONSTRAINTS

### No browser channel exists for an agent here — all three tiers assessed

1. **Claude-in-Chrome MCP** — `Claude in Chrome is not connected`, every attempt.
2. **Computer-use** — browsers are granted at tier **"read"**: visible in
   screenshots, clicks and typing BLOCKED. It cannot substitute.
3. **`mcp__Claude_Preview__preview_*`** — `preview_list` returns `[]`. It cannot
   attach to the externally-started dev server; every other tool in that server needs
   a `serverId` only `preview_start` produces, and `.claude/launch.json` does not
   exist.

**`preview_start` is NOT the workaround.** A second server lands on `/login` with no
Supabase session, so it proves nothing about archiving, and it writes to the same
`.next` as the running pid — **the exact thing that took this repo down twice.**
**Do not touch `.next`.** Dev server: `next dev -p 3002` (NOT 3000), pid 4638,
next-server v14.2.5; `/login` 200, everything else 307 behind auth.

**Calling `archive_project_guarded` through the Supabase MCP is NOT the fallback.**
It is a WRITE through the MCP, which §5 forbids, AND it bypasses the
app → PostgREST → RPC path that is the actual thing under test. A green result there
would prove nothing about the app. **Report the blocker plainly instead of falling
through to a tier that answers a different question.**

### `anon` holds EXECUTE on `archive_project_guarded` — and it is INERT

Measured, not asserted. It does **not** come from `0139` (which granted
`authenticated` only) — it is **Postgres's default `PUBLIC` EXECUTE on every new
function.** Why it cannot be used:

- `prosecdef = false` → the function runs as the INVOKER, not the owner.
- `projects`, `customers` and `customer_write_offs` all have
  `relrowsecurity = true`, and every policy on them is `{authenticated}`-scoped
  (`cmd=ALL`, `qual=true`).
- The function's FIRST statement is
  `select customer_id into v_cust_id from public.projects where id = p_project_id`.
  Anon sees zero rows → `v_cust_id` is null → `raise exception 'Project not found.'`
  It dies before reading the view and before any write.

**Ruling: same shape as §7's standing, Turki-reviewed ruling on the cosmetic `anon`
table SELECT grants — over-broad grant, zero live exposure, deferred to the dedicated
app-wide security pass alongside RBAC. NO grant was revoked and none should be
outside that pass.** Note a function EXECUTE grant is a *different shape* from a
table grant, which is why it was measured separately rather than waved through under
the existing ruling.

### A migration that is already a no-op against production still gets written

`0140`'s premise was **wrong, not merely stale** — §7 and the handoff both said the
function "IS STILL IN PLACE"; live measurement showed it already absent, dropped
out-of-band, with no migration on disk removing it. **Third time a long-standing §7
note was wrong rather than out of date** (Kanban first, `payment_model` second).
**Re-measure the premise before executing on it.**

The drift is an argument FOR the file, never for waving it off: **migration history
on disk is the RESET PATH.** Replaying from scratch runs `0019`, which RECREATES the
back door. `if exists` makes `0140` a no-op today and a real drop on every replay.

### Verification method: prefer the refused write

Proving an RPC resolves does not require completing its side effect. The block path
executes the function end-to-end and changes nothing. Reach for that shape first when
the alternative writes irreversible data. **This is no longer theory — it is how the
`0140` question was actually answered.**

### Three traps measured live while verifying the archive feature

1. **`v_customer_amount_payable` INCLUDES ARCHIVED CUSTOMERS.** `Turki 1` (archived
   2026-06-28) and TEST 111 Co. (archived 2026-08-19) are both still in it. **A
   surface that lists this view and calls the rows "active customers" is wrong** —
   filter on `customers.archived_at`. **This corrected a §7 line written ONE COMMIT
   earlier** (`0adbab1` said a customer with *no project* appears in the view; `Turki
   1` HAS one — `King Salman Park` `1bbf496e…`, archived the same second). **Fourth §7
   note found wrong rather than stale, and it was 20 minutes old.**
2. **ARCHIVE IS `archived_at` AND NOTHING ELSE.** On all three archived projects
   `projects.status` is still `'active'` and `customers.active` is still `true`.
   **Neither column tracks archiving — filtering on either does NOT exclude archived
   rows.**
3. **NAME COLLISION, SECOND INSTANCE.** Two projects named `King Salman Park`:
   `7a94e22e…` (Turki Contraction Co., active, 38,295.00 owed) and `1bbf496e…`
   (Turki 1, archived June). Beside the two case-differing Seders. **Match by id.**

**MEASUREMENT AGES.** A read at `00:01:58` correctly showed `Airport facilities`
unarchived; the archive landed **43 seconds later** at `00:02:41`. The measurement was
not wrong — it went stale while being reported. **When a human is acting in parallel,
re-measure AFTER they say they are done.**

### Grep traps — and the ToolSearch one

- **`archive_project` MATCHES `archive_project_guarded`** — any sweep for the bare
  name must exclude the guarded one or it reports the replacement as the thing it was
  meant to find. Same shape as the recorded `fill_cost[^_]` trap.
- **zsh expands an unquoted `--include=*.ts`** and kills the command — the EMPTY
  output reads as a clean sweep.
- **`grep` is case-sensitive by default** — `drop function` alone cannot prove no
  `DROP FUNCTION` exists.
- **An empty grep from the wrong directory is indistinguishable from a real finding.**
- **`ToolSearch`'s `select:` needs the EXACT fully-qualified deferred-tool name.**
  `select:preview_list` returns "No matching deferred tools found", which reads like
  the tool does not exist. Use the keyword form, or the full
  `mcp__<server-id>__<tool>` name.

**An empty result is only evidence once you know the command ran.**

## 6. NEXT

1. **`0139` IS CLOSED — every path clicked, recorded in §7 and the JSON. Do not
   re-open it.** Block, force-archive with override, plain archive on a credit
   customer, an abandoned override, and the Return flow.
   - **"RECORDING IS NOT DEDUCTING" IS DEAD — 0142 REVERSED IT.** It used to say
     nothing in the balance chain read `customer_balance_returns`. That was true
     when written and is now the opposite of the rule: a recorded return IS a
     debit, in both `lib/prepaid.ts` and `v_customer_prepaid_balance`. **§7's
     MONEY RULE (0142) is the authority.** The half that survives is the half
     that was never about deduction: still never post a negative top-up to
     "finish the job" — `topups_sar` means money paid IN, and a refund is netted
     at face value, not multiplied by 1.15.
2. **RESOLVED (2026-08-21) — the `0101` metrics-dictionary divergence. Turki
   ruled: KEEP the live shape, `operations_by_driver` stays as its own key.**
   Written as `0144_reconcile_operations_by_driver_metric.sql` (`485b3a2`).
   It upserts the driver key and restores `operations` to `0098`'s `grain` /
   `source_view` / null `caveat`, undoing the amendment disk `0101` applies on
   replay. **No-op against production, corrective on rebuild** — the 0140
   argument: disk history is the reset path, and before `0144` no migration on
   disk inserted `operations_by_driver`, so live could not be rebuilt from the
   repo at all. Background evidence stays in §4; do not re-litigate it.
   - **DONE — `0145_operations_metric_caveat.sql` is APPLIED and COMMITTED
     (`bcb9ed6`).** It adds the non-additivity caveat to `operations`, which
     `0144` deliberately leaves null. Kept separate because that is a CONTENT
     change, not a reconciliation (§5), and ordered after `0144` so a rebuild
     ends on this text. Unlike `0144` it is a real write against live: the
     `operations` row has been different since it landed, and `caveat` had been
     null since `0098`. All four of its own assertions passed at apply; §4
     carries the independent read-only re-verification.
   - **The warning is a GLOSSARY gap only — the product already carries it.**
     Traced read-only before drafting `0145`, so nobody re-runs this: Overview's
     "Trucks active" tile is single-month by construction (`rowFor`,
     `lib/reports.ts:450`). Only the Statements tab spans months (Monthly /
     Quarterly / Yearly, `PERIOD_TYPES`), and there `trucks_active` is
     `peakOver` — **highest single month, never summed** — and labelled in three
     places: the row suffix "most in any one month" when `multiMonth`
     (`StatementViews.tsx:934-938`), a `<Note>` carrying the full warning
     (`:997-1003`), and the narrative "at most N trucks in any single month"
     (`lib/reports.ts:653`). **No surface anywhere sums it.** `0145` makes the
     glossary say what the statement already says; it does not fix a wrong
     number, because there is no wrong number.
4. **Nothing else is scheduled-but-undone.** `0139`'s Q5 is closed. The Deferred list
   in §7 carries nothing blocked-and-actionable — RBAC + the app-wide security pass,
   effective-dated customer rates, multi-project customers, Route Optimization /
   Predictive / IoT are all parked deliberately.
5. **Still owed from much earlier, unrelated and still true:** an end-to-end
   in-browser "Download PDF" check against the live PDFShift API — nobody has
   confirmed a real PDF came back since `PDF_API_KEY` landed in `.env.local`.
   **Blocked on the same missing browser channel as §5.**
