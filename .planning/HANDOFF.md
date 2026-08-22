# SESSION HANDOFF — 2026-08-23 (DELIVERY-MOMENT COMMISSION FREEZE SHIPPED, BOTH HALVES. The three-step parameter drop is also finished — 0153 applied. NOTHING IS IN FLIGHT.)

**Read `CLAUDE.md` first, then `CLAUDE.md` §7 (the durable record), then this file.**
This file is a POINTER to §7, never the record itself — §5's rule, and §7's
`amountPayable.ts` entry exists because a rule that lived only in the handoff went
stale and actively wrong for two commits.

---

## SHIPPED: DELIVERY-MOMENT COMMISSION FREEZE (Option B). BOTH HALVES.

**The bug, reproduced in testing:** a driver has trips delivered TODAY at the old
rate; a today-dated `set_project_commission` runs; a NEW trip for the same
driver/project/today is delivered — and the ALREADY-DELIVERED trips reprice to
the new rate.

**The cause, traced:** `recomputeDailyCommission` fires on ordinary stage churn
(its only call site is `setTripStage`), selects EVERY delivered trip in the
`(driver, project, trip_date)` bucket, and resolves **ONE**
`commission_config_at(project, trip_date)` for all of them. `trip_date` is today
and the change is effective today, so the whole day reprices. The 2b fix stopped
a PAST day repricing at TODAY's terms; it is a no-op on the same-day case because
the day-key and the change-date are the same date.

**The rule, decided:** a trip freezes the commission RATE it was delivered under.
Recompute keeps re-ranking positions by `delivered_at`, but prices each trip at
**its own** frozen rate at its live position. See `CLAUDE.md` §7 for the durable
statement — it is a money rule and it lives there, not here.

**Where it stands:**

- **`0151`** — applied, committed `0f5cddc`. `update_project_with_customer` now
  accepts the call with or without the three commission args (moved to the end,
  defaulted null) so the app can stop sending them without a broken-save window.
- **`0152`** — applied, verified, committed `ccab13c`. Adds
  `trips.commission_mode` / `.commission_base_sar` / `.commission_bump_pct` plus
  the all-or-none check constraint, and backfills 757 stampable delivered trips
  from `commission_config_at(project_id, trip_date)`. Turki confirmed: 757
  stamped, the two no-project/no-driver trips left null, constraint present, zero
  stamp-vs-resolver drift, `commission_sar` unmoved.
  **NOT RE-RUNNABLE — no `if not exists` on the adds, by design.** It IS safe to
  re-run only the backfill UPDATE on its own (block e), which is guarded by
  `commission_mode is null`; that is the gap-window sweep.
- **THE APP REWIRE** — committed `a76726c`, deployed. `priceDelivery` returns the
  config it priced with; `setTripStage` freezes it onto the trip beside
  `commission_sar` on every entry to `delivered` and clears all four on the way
  out; `recomputeDailyCommission` no longer resolves a config for the bucket at
  all — it prices each trip from its own columns at its live position, and its
  write set names only `commission_sar`. A null-only self-heal fills any row
  delivered in the gap between the 0152 backfill and the deploy.

  **The proof, before it landed:** all 192 existing buckets re-ranked and repriced
  from the stored columns; the `commission_sar` fingerprint over the 358 unpaid
  real-project trips is byte-identical either side
  (`a1c2b3a32645263b24d189fce556b363`), zero change on all real projects. The only
  divergences are the two accepted classes, neither in the write set: 12 paid
  legacy payout snapshots, and the test projects. `commission-check` went 35 → 41
  cases.
- **`0153`** — applied, committed `a7a2b86`. Drops the three parameters from
  `update_project_with_customer` for real. Signature-only: `prosrc` md5 is
  `e0a731881696673fac355ab5269dc5c8` before and after, `functiondef` 2764 → 2622
  (exactly the 142-byte parameter suffix), ACL identical, `anon` still cannot
  execute. The param drop is finished; there is no step 4.

**The three-step parameter drop, closed.** 0151 (`0f5cddc`) widened, step 2
(`44b461d`) stopped the caller sending, 0153 (`a7a2b86`) removed. Passing a
commission argument to that RPC is now a PGRST202, deliberately. `CLAUDE.md` §7
carries the durable rule and the two traps worth keeping: the create RPC keeps
its three and its argument block is byte-identical around `p_rate`, so a blind
find-replace breaks project creation; and DROP discards the ACL.

**THE ONE THING STILL OPEN**, unrelated to the above: the one-off correction for
trip `804a6a54-c958-4a77-9d00-8ae2c24369da` (King Salman Park, driver
`a9157ee2`, `trip_date 2026-07-08`, stamped 10.30, expected 10.00). It is one of
**12 PAID legacy rows** whose stored figure disagrees with the current ramp —
recompute never writes paid trips, so it will not self-heal, and the freeze work
did not touch it. Option A (push back + re-deliver in-browser) vs option B
(equivalent SQL UPDATE) has still never been chosen. Ask before assuming it was
dropped.

**File transfer, for next session:** an inline attachment arrives blank on the
architect's end. A file UPLOADED to the chat is readable. Upload, do not attach.

---

## ITEM 4 IS DONE. EFFECTIVE-DATED COMMISSION IS COMPLETE END TO END.

*("Item 4" here is the cleanup-batch work item, the one §6 item 3 tracks. It is
NOT §6's item 4, which is a different and much smaller thing. The two collide
only in the numeral.)*

**`3c` — the app rewire — is committed and pushed (`0a21b59`). 13 files, app-only,
no migration. The DB was already at `0150` and this touched nothing in it.**
Turki ran all ten browser checks against the deployed build and they passed.
Nothing about commission is outstanding. `0144` remains the only
committed-but-unapplied migration and it is unrelated (Operations glossary, §4).

**NEXT SESSION HAS NOTHING QUEUED — ASK TURKI.** With commission closed there is
no large feature in flight, §6 item 5 is still right that nothing big is
scheduled-but-undone, and **all three of 2b's leftovers are now closed too**
(`BreakdownReport` by 3c, the `getRate` conflation by `0bf75d6`, the
`lib/commission.ts` docstrings by `627dbae`). The board is genuinely empty.

**THE SESSION'S REAL LESSON IS ABOUT THIS FILE, NOT ABOUT COMMISSION.** Both
cleanup commits began by finding that the handoff entry describing the work was
WRONG, and in both cases the error had been written confidently by me:
- **`0bf75d6`** — its §6 entry described the `getRate` bug in two ways that were
  both false: it claimed the leak fired on undelivered cards (the value is read
  only in the delivered branch) and it praised the second call site as honest
  (it passed the customer rate into a commission label unconditionally — the
  worse of the two). Written from reading the expression instead of tracing
  where its value was CONSUMED.
- **`a248d40`** — the "36 PASS" count recorded against `bc92d18` was 35 all
  along. Re-counting before AND after the change is what proved the discrepancy
  was pre-existing rather than a regression I had just caused.

**So: an entry here tells you where to look. It is not evidence.** Re-derive
from the code before acting on it, and re-measure a number before quoting it —
including the numbers in this file. Both errors were caught only because the
fix started with a trace rather than with the description. Neither was caught
by review, and neither would have been caught by `tsc`.

**Then `b753a20` — the commission pill on the project board. Verified in-browser.**
Turki asked for a "Commission / trip" pill beside the existing "Rate / trip" pill
in each project card's header on the Trips board, emerald for the rate and amber
for the commission. Built with the codebase's existing tinted-pill tokens
(`bg-emerald-500/10 … ring-emerald-500/20`, same shape for amber) rather than new
shades, so it matches Maintenance, Fleet and FinanceTab. The rate pill's neutral
`border` became a tint in the same move: in a `muted` metadata row a bordered
pill reads as another grey chip, and pairing the two only works if the eye
separates them. Colour carries meaning here — emerald is money in (the customer
pays us), amber is money out (we pay the driver).

**This is the first real test of 3c's separation, and it is the pattern to copy.**
3c had kept `commissionNow` OUT of `ProjectsBoard` entirely, with a comment
saying the board "renders no commission figure, so it has no business receiving
the terms." This request falsified that premise — but NOT the rule underneath it.
The cheap fix would have been re-adding the three columns to `page.tsx`'s
`ProjectHeader` select. That was refused. `commissionNow` moved into
`ProjectsBoardProps` and reaches the card as its own prop, so the board displays
commission while `projects.commission_*` stays unreachable from the shape every
trips surface passes through.

**The rule, stated once so the next request does not re-litigate it: DISPLAYING a
commission figure is harmless. Making it SEEDABLE is the hazard.** A figure
carried on `ProjectHeader`/`ProjectLite` is one edit-form default away from being
written back stale. A figure that arrives as its own view-sourced prop is not.
"A screen needs to show commission" is never a reason to put the columns back in
that select — this is recorded in `page.tsx` at the select itself.

Two smaller calls worth keeping: a project with no row in the view renders NO
pill rather than `0 SAR` (a missing row means today's terms could not be
resolved; a zero would state a figure nobody set), and a scalable project's pill
carries the base plus its step, because the base alone reads as the whole story
when trip 6 of the day earns more than trip 1.

What 3c actually locked, and why each piece is not cosmetic:

- **`ProjectModal` is the one place a commission figure moves.** It pre-fills from
  `v_project_commission_now` — the terms in force TODAY — and the stale
  `projects.commission_*` columns were REMOVED from `ProjectHeader` and
  `ProjectLite` rather than left available to seed from. That is the whole
  defence: a pre-fill that becomes a save is how a stale value gets written back,
  and you cannot seed from a field that is no longer in the type.
- **`set_project_commission` fires only when the commission fields differ from
  their pre-fill OR a date was picked.** A rename must not stamp a today-dated
  change — that would republish superseded terms and silently supersede a change
  scheduled for next month. On a combined save `update_project_with_customer`
  runs FIRST and the commission writer LAST. They commute under `0150`; the order
  is kept anyway so the invariant survives a revert.
- **A partial failure says so.** If the lifecycle update lands and the commission
  write refuses, the error appends "The rest of the project was saved." The two
  writes are separate statements by design and nothing rolls back — a bare
  refusal would read as a full rollback while the renamed project sat on screen.
- **`/projects` lost money entirely** — it is now customer, name, dates, status.
  Its `updateProject` was the LAST direct-write path to the commission columns
  and `0150` did not touch it, so once a future-dated change could activate, a
  stale save there would have written it live. It also never carried
  `commission_bump_pct`, so every save zeroed the bump on a scalable project.
  Both bugs died with the fields. Creation is unchanged: the columns are
  `not null default` (0001) and `0147`'s INSERT trigger writes the opening row.
- **The Archive exception is deliberate and must survive future edits.** Every
  other surface answers "what are the terms today" from the view. Archive
  resolves `commission_config_at(project, archived_at)`, because "what terms did
  this dead project run on" is a question about its archive date — a change
  scheduled after it was archived is not part of its history. If Archive is ever
  "fixed" to agree with `/trips`, that is the regression.
- **`ArchiveCustomerTab` imports `getProjectCommissionAt` from `../trips/actions`,
  breaking its own leaf-module rule on purpose.** `commission_config_at` has
  exactly ONE app-side wrapper. Re-declaring it to keep the leaf rule intact
  would give the resolver two call sites to drift apart — the §6 "exactly two
  expressions" trap. The exception is recorded in the file's header.
- **`formatDayKey` (lib/utils)** parses the date parts instead of `new Date(key)`,
  which reads UTC midnight and shifts the day on a negative-offset machine.

**Before it: STEP 3's WRITE SIDE — `0148`, `0149` and `0150` are applied,
all self-asserts passed, every path rehearsed rolled back on live, and all three
are committed (`a0b2566`, `35391c7`).**
`set_project_commission(project, effective_from, mode, value, bump, note)` is now
the ONLY path by which a commission figure changes on an existing project. It
writes `project_commission_history` FIRST and UNCONDITIONALLY, then mirrors into
`projects.commission_*` ONLY when the change is dated today — so a future-dated
change never touches the live columns, and an edit can never be swallowed by a
no-op UPDATE once those columns have gone stale. `cancel_project_commission`
withdraws a STRICTLY future change and refuses everything else with a raise, never
a silent no-op. `v_project_commission_now` (`0149`) is the display source and
carries `projects_column_is_stale`. `0150` deleted the three commission columns
from `update_project_with_customer`'s SET list — its 24-param signature is
unchanged and those three params are now ignored.
**3c is no longer outstanding — see the top of this file.**

**Before it: STEP 2b IS SHIPPED (`bc92d18`) — the READ REWIRE, and the point of the
whole feature. `priceDelivery` and `recomputeDailyCommission` now take their
commission terms from `commission_config_at(project_id, trip_date)` — the config
in force on the day the trip is FOR — instead of re-reading the live
`projects.commission_*`. A no-row answer is a HARD ERROR that fails closed; it
never falls back. BOTH RULINGS ARE NOW SHIPPED. Proven a no-op before it landed:
new path equals old path on all 677 unpaid delivered trips.
**VERIFIED IN-BROWSER — Turki ran all nine checks in §6 item 3 against the deployed
build and they passed. Closed, not owed, not a blocker.**

**Before it: `0147` is applied, verified and committed (`7cb8847`) — step 2a, the
SYNC. `projects.commission_*` writes itself into `project_commission_history` by
trigger, so the table stops going stale. It moved NO commission figure on its
own; `bc92d18` is what made the history readable.**

**Before it: `0146` is applied, verified and committed (`6f7ad60`) — step 1, the
table + baselines + resolver. Still INERT on its own; `commission_config_at()`
has zero callers until 2b.**

**Before it: `0145` is applied and committed; `0144` is committed and deliberately
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

### This session (2026-08-22) — nine commits, oldest-first

Read off `git log 520c6a9..HEAD` at session end, not incremented from the block
below. **Four code commits, five documenting them** — the ratio is honest, not a
smell: three of the four were small by design and the doc commits carry two
corrections to this file that were worth more than the code they describe.

| hash | what |
|---|---|
| `0a21b59` | 3c — the commission UI. 13 files, +956/−163, app-only, no migration |
| `a094805` | Record 3c as shipped; correct the ledger line to 148/98/15 |
| `b753a20` | Commission pill on the project board. 3 files, +60/−17 |
| `037c40d` | Record the pill and the display-vs-seedable rule it tested |
| `577850a` | Close out item 3; promote 2b's leftovers to their own §6 item |
| `0bf75d6` | Delete the `getRate` prop chain — the badge reads `trip.commission_sar`. 1 file, +21/−8 |
| `38201ed` | Record `0bf75d6`; correct what this file had said about the bug |
| `627dbae` | `lib/commission.ts` docstrings + `priorThisMonth` → `priorSameDay`. 1 file, +30/−8 |
| `a248d40` | Close §6 item 4 entirely; correct the 36-vs-35 check count |

**This block cannot list the commit that carries it** — the one written after
`a248d40` is the session's tail and is a docs-only wrap. `git log` is the
authority on the count; this table is the authority on what each one was FOR.

`0a21b59` and `0bf75d6` were both verified in-browser before commit. `627dbae`
changes no behaviour — comments and one positional parameter name — and was
committed on `tsc --noEmit` plus the 35-check suite, with no browser step,
because there is nothing on screen for it to change.
`b753a20` was committed on `tsc --noEmit` alone at Turki's instruction and
verified in-browser immediately after — the order was inverted from §5's rule
deliberately and with his say-so, not by drift.

### The session before it (2026-08-21) — eighteen commits, oldest-first

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
| `7a4d3be` | Record `0145` as applied + committed; re-measure the ledger |
| `6217ef3` | Bump the §7 DB pointer to `0145` |
| `8a3605a` | Mark `0144` do-not-apply — it stopped being a no-op when `0145` landed |
| `6f7ad60` | `0146` — effective-dated commission config table + resolver (step 1 of 3) |
| `5e759a3` | Record `0146` as applied; write down the two step-2 rulings |
| `c3067a0` | Bump the §7 DB pointer to `0146` |
| `7cb8847` | `0147` — sync `projects.commission_*` into the history table by trigger (step 2a) |
| `fee8504` | Record `0147` as applied; mark ruling (b) shipped |
| `bc92d18` | Price from `commission_config_at(project, trip_date)`, hard-error on no terms (step 2b) |
| *(this file's commit)* | Record step 2b as shipped; the feature is code-complete |

**The count and the last two rows of this table were both wrong before `6f7ad60`.**
It read "Nine commits" and stopped at `bcb9ed6`, missing `6217ef3` and `8a3605a` —
two commits that had already been made by the session that wrote the line. Same
family as `2c13e0c`: **a list you are appending to is not a list you have
verified.** Re-read `git log` rather than incrementing what is there.

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

Re-measured at the end of the 2026-08-22 session, at `a248d40`:

```
$ git -C /Users/turkislimah/aquafleet-ksa status -sb
## main...origin/main

$ git diff --stat            (empty)
$ git diff --stat --cached   (empty)
$ npx tsc --noEmit           (clean, exit 0)
$ ls supabase/migrations | wc -l    148   (last: 0150)
```

**Working tree clean, nothing uncommitted.** `npx tsc --noEmit` clean at session
end. **Push state is NOT asserted here** — this file is written before the push
that carries it, so the claim could only ever be a guess. `git status -sb` is the
authority; §1's lesson is that the handoff's self-claim about push is the one
claim it cannot verify about itself.

**`git` needs `-C /Users/turkislimah/aquafleet-ksa` — ASSUME IT DOES, CHECK IF IT
MATTERS.** The Bash tool's cwd opened at `/Users/turkislimah`, which is NOT a
repo, and a bare `git push` died with `fatal: not a git repository`. It did NOT
stay that way: by the end of the session `pwd` reported the repo root and bare
`git commit` / `git push` worked. **So the cwd is not a constant and neither
answer is safe to carry** — `-C` costs nothing and is right either way; a bare
git command is a coin flip on which turn you are in. Re-confirm with
`git rev-parse --show-toplevel` before trusting a bare one.
**CONFIRMED AGAIN, same session, after the paragraph above was written:** a bare
`git status -sb` died with `fatal: not a git repository` on the very next turn,
having worked minutes earlier. The drift is real and it is per-turn. `cd
/Users/turkislimah/aquafleet-ksa && …` or `-C` on every git and every `npx`.
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

- **Highest migration APPLIED: `0150_update_project_stops_writing_commission.sql`
  — applied by the architect via MCP, all six of its own assertions passed,
  committed (`35391c7`).** 488 lines / 25,998 bytes. It replaces exactly one
  function, `update_project_with_customer`, and adds nothing: no table, no view,
  no trigger, no column. The whole change is the DELETION of three lines from
  that function's `update public.projects … set` list — `commission_mode`,
  `commission_value`, `commission_bump_pct`. **The 24-param signature is
  unchanged and the three params are still accepted and now ignored**, on
  purpose: dropping them would have meant a PGRST202 window on a live money RPC
  between the SQL-editor run and the app deploy, and DEFAULTs are impossible at
  positions 11–13 of 24. Dropping them is owed LATER, after 3c ships — and note
  the `customer_write_offs.payment_mode` precedent in CLAUDE.md §7 before doing
  it. The surgical claim is ASSERTED, not promised: the file captures
  `pg_get_functiondef` before the replace, computes the expected after-image by
  `replace()`-ing those three lines out, raises if the needle was not found, and
  raises again if the live definition differs from the expected one by a single
  byte. Post-apply the architect confirmed the definition matches the drafting
  pin exactly — **deflen 2701, md5 `6eefccefbe0b9d8d5f8630b4a0f5d4bc`** (down
  from 2858, the 157 chars being those three lines). Posture and ACL asserted
  byte-identical; `create_project_with_customer` untouched; the payment-mode
  guard still in the body. Rollback is re-running the captured before-definition
  — there is no DROP in either direction. Do not re-apply it.
  - **This is RULING 2 from §6 item 3, settled: ONE WRITER.**
    `set_project_commission` is now the only path in the database by which a
    commission figure changes. The alternative — letting the modal keep passing
    `update_project_with_customer` the in-force figures — was rejected on three
    grounds, all recorded in `0150`'s header: it makes the two RPCs
    non-commutative (last writer wins, and the loser silently reverts the edit in
    BOTH the column and the history via `0147`'s upsert, while the screen says
    saved); it makes a money invariant a property of one React component, when
    the RPC is `security invoker` granted to `authenticated` and any session can
    pass any figures; and a pre-fill is a SNAPSHOT while "in force" is
    time-varying, so a tab left open overnight would stamp a today-dated reversal
    of terms nobody touched.
- **Applied with it: `0148_set_project_commission.sql` (1,068 lines / 56,539
  bytes) and `0149_v_project_commission_now.sql` (350 lines / 18,855 bytes) —
  both applied by the architect via MCP, every self-assertion passed, both
  rehearsed rolled back on live, committed together (`a0b2566`).** This is step
  3's write side.
  - **`set_project_commission(project, mode, value, bump, effective_from, note)`
    — the sole writer.** Order inside it is load-bearing and must not be
    reordered: **history FIRST and UNCONDITIONAL, mirror into
    `projects.commission_*` SECOND and TODAY-ONLY.** A future-dated change writes
    history and leaves the columns alone; a today-dated one writes both.
    - **It closes the STALE-COLUMN TRAP, which is the whole reason the order is
      that way round.** `0147`'s trigger fires on a DIFFERENCE. Once a
      future-dated change has made `projects.commission_*` stale, an edit back to
      the stale value is a no-op UPDATE — the trigger never fires, no history row
      is ever written, and the edit is confirmed on screen having done nothing.
      Writing history first and unconditionally means the RPC never depends on
      the trigger firing.
    - Same-date edits UPSERT onto the existing row rather than adding a second.
    - Backdating is REFUSED. Archived projects are REFUSED.
  - **`cancel_project_commission(project, effective_from)` — withdraws a
    scheduled change, and only a STRICTLY FUTURE one.** A today-dated entry is
    already in force and may have priced trips delivered today, so it is REFUSED,
    not clamped onto some other row. A `is_baseline` row is NEVER cancellable at
    any date — every past trip resolves against it, and deleting it makes
    `commission_config_at` return zero rows, which is a hard error at delivery.
    The baseline guard is deliberately checked BEFORE the date guard, so a
    future-dated baseline cannot fall through. It touches `projects.commission_*`
    not at all — a future entry never wrote there. It DELETEs rather than
    soft-flagging, because `0146`'s resolver ignores unknown columns and a
    `cancelled_at` row would still win the ORDER BY and still price trips.
    **Archived projects ARE allowed here** — the asymmetry with
    `set_project_commission` is deliberate and defended in the header: refusing
    would strand a queued change that fires the moment the project is restored.
    Every refusal RAISES; nothing silently no-ops.
  - **`v_project_commission_now`** — the display view. Per project: the in-force
    mode/value/bump resolved through `commission_config_at(p.id, riyadh_today)`,
    the `next_*` columns from the earliest strictly-future history row, and
    `projects_column_is_stale`, a drift flag comparing the resolver against
    `projects.commission_*`. Its own assertions proved the flag reads 0 for every
    project at apply — **that is the no-op proof for the 3c display rewire.**
  - Dates are floored Riyadh-local, `(now() at time zone 'Asia/Riyadh')::date`.
    A UTC floor is YESTERDAY between 00:00 and 02:59 Riyadh.
  - None of the three moved a commission figure, and none touched
    `trips.commission_sar`. Do not re-apply any of them.
- **Highest migration APPLIED before them: `0147_project_commission_sync_trigger.sql`
  — applied by the architect via MCP, verified and committed (`7cb8847`).** 675
  lines. Additive: one new trigger function
  (`record_project_commission_change()`), two new triggers on `projects`
  (`projects_commission_history_ins` AFTER INSERT, `projects_commission_history_upd`
  AFTER UPDATE with a WHEN on all three commission columns), plus a catch-up
  backfill that matched ZERO rows. No view, no change to `projects`, no write to
  `trips`. All seven of its own assertions passed at apply, and the architect
  rehearsed **both trigger paths rolled back on the live triggers** — a config
  edit (baseline untouched, one today-dated non-baseline row, second same-day
  edit upserts rather than adding a third) and a new-project insert (exactly one
  floor-dated baseline row).
  - **It is ruling (b) from §6 item 3, shipped.** The history table no longer
    goes stale: every writer of `projects.commission_*` is caught by
    construction, including `app/projects/actions.ts`, which never reads
    `commission_bump_pct`.
  - **It moved no commission figure when it landed, and it still moves none** —
    it only writes history. The "zero callers" half of this bullet is DEAD:
    `commission_config_at()` was wired into `priceDelivery` and
    `recomputeDailyCommission` by step 2b (`bc92d18`), which is shipped and
    browser-verified.
  - `projects` now carries **three** triggers — the two above plus the
    pre-existing `projects_set_initials_trigger` (BEFORE INSERT). Order on an
    insert is set_initials → row written → baseline recorded.
  - Deliberate divergence from `record_salary_change()`, defended in the file's
    header: its INSERT branch writes a **floor-dated `is_baseline = true`** row,
    not a today-dated one, because a project can be entered with a backdated
    `start_date` and a today-dated baseline would strand every trip before it.
  - Do not re-apply it.
- **Highest migration APPLIED before that: `0146_project_commission_history.sql` —
  applied by the architect, verified and committed (`6f7ad60`).** 586 lines. Additive: one
  new table (`project_commission_history`), one new function
  (`commission_config_at(uuid, date)`), no view, no change to `projects`, no
  write to `trips`. All six of its own assertions passed at apply:
  - 7 baselines, exactly one per project, values COPIED from
    `projects.commission_*` and dated at each project's floor;
  - the resolver equals `projects.commission_*` for every project today —
    **0 mismatches, and this is the step-2 no-op proof**, so wiring it in cannot
    move a figure;
  - 818 trips and the **15,820.16 SAR** commission total untouched, checked by a
    fingerprint captured at the top of the transaction and re-computed at the
    foot (captured, never hardcoded, so the file survives a rebuild);
  - every project-bearing trip reachable from its baseline;
  - RLS on with exactly one `authenticated` policy — same posture as
    `salary_history`, and deliberately with no table-level `anon` revoke, because
    every base table in this schema is gated by RLS instead (§6's revoke rule is
    about VIEWS);
  - the resolver is `security invoker` + `stable`, `anon` EXECUTE revoked.
  **It was INERT when it landed — zero call sites, no trigger.** It is not inert
  now: `0147` gave its table two triggers, 2b (`bc92d18`) made the resolver the
  pricing path, and `0148`/`0149` made the table the thing that is written and
  read. Do not re-apply it.
- **Highest migration APPLIED before those: `0145_operations_metric_caveat.sql` —
  applied by Turki, live-verified and committed (`bcb9ed6`).** 9,015 bytes / 166 lines.
  Ledger row `operations_metric_caveat` @ `20260820214605`. Re-verified read-only
  2026-08-21: `operations.caveat` is 569 chars, carries both phrases its own
  assertion checks, `report_metrics` still holds 30 rows, `operations_by_driver`
  present exactly once. `0141`/`0142`/`0143` landed between this line's previous
  value (`0140`) and now; see §0, §0a, §0b.
- **Highest migration ON DISK: `0150` — the same file as the applied one. The
  only gap in `0001..0150` other than the closed `0135`/`0136` is `0144`, which
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
- **THE REMOTE LEDGER IS NOT A MIRROR OF DISK: 148 files against 98 rows in
  `supabase_migrations.schema_migrations` (disk counted 2026-08-22 after `0150`;
  the row count measured by the architect on live). Do not use it to audit what
  is applied — the DB itself is the authority.**
  - **These numbers are a SNAPSHOT, not a constant. Re-measure both sides before
    citing them.** The gap moved from 145/95 to 148/98 across `0148`–`0150`
    without anything being reconciled — the spread happens to have held at 50,
    which is coincidence and not a rule. This line has already been wrong once
    (the name-versioned count below), from being carried forward instead of
    counted.
  - It records `0036`, `0037`, `0058`, then nothing until `0060`, after which it
    runs near-continuous. `0001–0035` and most of `0038–0059` are simply absent:
    applied before history tracking, or through the SQL Editor, which writes no
    row. Absence from the ledger is NOT evidence a migration did not run.
  - **15 rows carry no number**, all MCP-applied under auto-timestamps, measured
    2026-08-22 by `name !~ '^[0-9]'`. The three added since the 2026-08-21 count
    are `0148`, `0149` and `0150`, which went in through MCP like the rest and so
    landed name-versioned too — the numbering on disk is ours, not the ledger's.
    The twelve before them: `v3_ledger_totals_and_hide_amount_due`,
    `invoice_payment_mode_snapshot`, `receipt_vote_approvals_and_lot_fix`,
    `retire_customers_payment_model`, `retire_water_stations_fill_cost`,
    `pay_commission_monthly`, `net_balance_returns` (0142),
    `restore_customer_reverse_write_off` (0141),
    `drop_write_off_payment_mode` (0143), `operations_metric_caveat` (0145),
    `project_commission_history` (0146, `20260821104801`),
    `project_commission_sync_trigger` (0147, `20260821112212`).
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
- **DB writes this session: `0143`, `0145`, `0146` and `0147` — none of them by
  Claude Code.** Every query Claude Code ran was read-only `execute_sql`,
  including the post-apply verification of `0145`, the live measurements `0146`
  was drafted against (the `projects` CHECK domain, the per-project floors, the
  trip fingerprint, and the sibling security posture it mirrors), and those
  `0147` was drafted against (the three commission columns' nullability, the
  pre-existing `projects` trigger, and `claim_project_initials`' body — which is
  pure reads plus a `pg_advisory_xact_lock`, so a rolled-back rehearsal project
  consumes no sequence and no counter).
- View posture **re-measured 2026-08-20: 47 views / 47 security_invoker / 0
  anon-readable.** §7 claimed 40 until `2c13e0c`. §6 carries the query — *the two
  counts matching is the check, not the number.*
- **Tables re-measured 2026-08-21: 77, all 77 RLS-enabled** (the §7 "73+" is
  deliberately open-ended; `0146`'s `project_commission_history` is the 77th).
  `anon` holds a table-level SELECT grant on all 77, but it is **inert**: 76
  tables carry a policy, every one names `authenticated` only, none names `anon`
  or `public`, so RLS denies anon by default. **The table posture rests on the
  policies, not on the grants — do not "tidy" a policy away.** Note 77 tables
  against 76 policied: **still exactly one** table has RLS on with no policy at
  all. That fails closed and is safe; whether it is intentional is unverified.
- **Migrations are DRAFTED to disk for Turki to run in the Supabase SQL Editor —
  never self-applied through the MCP.** Read-only `execute_sql` queries ARE allowed
  and are the standard proof mechanism; that is all this session used.
- **SOMEDAY, not now:** the `DRAFTED TO DISK. NOT APPLIED.` header line is stale on
  every applied migration in the repo (`0146` and `0147` included) — it records the
  state at drafting, never at applying, so it means nothing today; making it mean
  something is a set-wide convention change plus a backfill of every file, not a
  per-file edit, and nothing depends on it in the meantime.

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
**Do not touch `.next`.** Dev server: `next dev -p 3002` (NOT 3000),
next-server v14.2.5; `/login` 200, everything else 307 behind auth. The pid is
not stable across sessions — read it with `lsof -nP -iTCP:3002 -sTCP:LISTEN`.

**AMENDED 2026-08-22 — a HEADLESS PLAYWRIGHT CHANNEL DOES EXIST, and it is how
the CSS outage below was proved fixed.** Tiers 1 and 2 above still fail, but
`@playwright/test` is a devDependency and `chromium.launch()` works. **Run the
script FROM THE REPO ROOT** — an `.mjs` in `/tmp` cannot resolve
`@playwright/test` and dies with `ERR_MODULE_NOT_FOUND`; the Bash tool's cwd has
drifted to `$HOME` mid-session before, so `cd` explicitly rather than assuming.
It reaches `/login` only (everything else is 307 behind auth), which is enough to
assert the CSS pipeline: count `document.styleSheets` rules, read
`getComputedStyle(document.body)`, and listen for `/_next/` responses `>= 400`.
A healthy build reads 800 rules and `rgb(248, 250, 252)` — the `--bg` from
globals.css, NOT a browser default, which is what makes it an assertion rather
than a screenshot. It cannot verify anything behind auth; Turki still does that.

### `next build` AGAINST A LIVE DEV SERVER IS THE THIRD WAY TO BREAK `.next`

**It took the whole app down to unstyled HTML this session, and the symptom does
not point at the cause.** `next build` and `next dev` write the SAME `.next`
directory. Running the build while the dev server is up wipes the dev server's
compiled CSS chunk; the dev server keeps running on the wreckage and keeps
serving. Data loads, every route renders, and the browser gets no stylesheet.

**The tell is `.next/static/css/app/` being EMPTY** while production-only
artifacts (`BUILD_ID`, `export-marker.json`, `prerender-manifest.js`, `*.nft.json`)
sit alongside a hashed production CSS file the dev-mode HTML never references.

**Why it misdiagnoses:** "server healthy, queries fine, no styles" reads as a
Tailwind/PostCSS problem, and the session that caused it had just finished a
13-file UI change — so the obvious suspect is the uncommitted work. It was not.
`globals.css`, `tailwind.config.ts` and `postcss.config.js` were never touched;
`git status` proved it in one command. **Check `git status` for config/CSS files
BEFORE reaching for the diff of whatever you just wrote.**

Fix is `rm -rf .next` plus a dev restart. No reinstall, no regeneration, no code
change. **Standing rule: do not run `next build` while `next dev` is up.**
`npx tsc --noEmit` gives type safety without touching `.next`; if a real
production build is needed, stop the dev server first and expect to restart it.

**Restarting it detaches it.** A dev server started from the Bash tool is not in
Turki's terminal — check the parent chain (`ps -o pid,ppid,tty,command`) before
assuming who owns the running one, and do not kill a `-zsh`-parented pid on
`ttysNNN` to "restart" it. Computer-use grants terminals **click-only**: typing
is blocked, so an agent cannot start one in his terminal either. Ask him.

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
3. **EFFECTIVE-DATED DRIVER COMMISSION IS COMPLETE — NOTHING IS LEFT ON IT.**
   STEPS 1 (`0146`, `6f7ad60`), 2a (`0147`, `7cb8847`), 2b (`bc92d18`), STEP 3's
   WRITE SIDE (`0148`/`0149`, `a0b2566`; `0150`, `35391c7`) **and 3c, the app
   rewire (`0a21b59`)** are all shipped. Both rulings below are implemented, and
   so is ruling 2 (see §4's `0150` entry — one writer). The board's commission
   pill (`b753a20`) landed after the feature closed and is not part of it.
   **The section below is now HISTORY — kept because the rulings and the
   regression checklist are still load-bearing, not because anything is owed.
   The authority on what 3c actually shipped is the ITEM 4 IS DONE section at
   the top of this file; read that first and this only for the why.**

   **THE IN-BROWSER CHECKLIST — RUN AND PASSED, NOT OWED.** Turki ran all nine
   checks below against the deployed `bc92d18` build and every one passed. 2b is
   closed: it is not owed, and it is not a blocker on anything. **The re-run
   after 3c is also DONE** — Turki ran 3c's own ten-item checklist against the
   working build and every item passed, which is what `0a21b59` was committed
   on. The list stays here as the standing REGRESSION suite for anything that
   touches who writes the config these checks price against. Use a TEST project
   (`VVV Test 2`), not a live one:
   1. Note 3–4 delivered trips' figures on two different past days.
   2. Edit the project's `commission_value` (e.g. 10 → 25) and save. **No trip
      figure anywhere should change yet.**
   3. Create a trip dated TODAY and deliver it → expect the NEW base (25.00 at
      position 1); deliver a second today → expect the position-2 price on the
      new base.
   4. Re-check step 1's figures → **identical**.
   5. **The real leak test.** Push a PAST day's delivered trip back out of
      `delivered`, then deliver it again → it must return to its ORIGINAL figure
      on the OLD base, and the rest of that day must not move. Before `bc92d18`
      this repriced the whole day at 25.00.
   6. On a past day with 3+ delivered trips, push the MIDDLE one back → later
      trips reprice DOWN one position, still on the old base.
   7. The no-project trip (`2bf32c2d-6747-400b-bb8b-9e5db37c7317`) still reads
      0.00 and its stage churn still succeeds.
   8. **The hard error.** Give a trip on that project a `trip_date` before the
      project's floor (e.g. 2020-01-01) and try to deliver it → refused with
      "No commission terms are on record for this project on 2020-01-01…", trip
      stays undelivered. Then fix the date and confirm the correction is NOT
      blocked.
   9. Any trip with a `payout_id` never moves through any of the above.

   Reverting step 2's edit the same day upserts onto `0147`'s existing
   today-dated row rather than adding a third — expected, last edit of the day
   wins.

   **The gap the feature closes,** so step 2 is built against the real problem:
   commission config lives on `projects` as three mutable, undated columns, and
   `trips.commission_sar` is stamped at delivery from them as they read at that
   moment. Editing the project does NOT re-stamp — but `recomputeDailyCommission`
   (`app/trips/actions.ts:607-675`) re-reads the CURRENT config and reprices
   every UNPAID delivered trip in that driver+project+`trip_date` bucket, and it
   fires on ordinary stage churn. **`payout_id is not null` is the only true
   freeze.** So today the past can move.

   **RULING (a) — SHIPPED IN `bc92d18`. The resolver returning NOTHING is a HARD
   ERROR. It must NEVER fall back to `projects.commission_*`.**
   `commission_config_at()` returns ZERO
   ROWS when no config is in force on the date asked for; that is the designed
   signal and it is not the same thing as zero commission. Falling back to the
   live columns would silently reintroduce the exact defect the feature removes —
   pricing a past trip at today's rate — and it would do it on the one code path
   nobody watches. Raise. **A 0 SAR commission and "there is no config for this
   date" must not look alike in the money path.**
   - It cannot fire on today's data: `0146`'s assertion (4) proved every
     project-bearing trip is reachable from its baseline. The reachable way in is
     a trip BACKDATED before its project's floor — `trip_date` is free-entry and
     no constraint ties it to the project. **That is a data-entry error and it
     should stop, loudly, not be papered over.**
   - The one delivered trip with **no project at all**
     (`2bf32c2d-6747-400b-bb8b-9e5db37c7317`, 2026-07-15, stamped `0.00`) has no
     baseline by construction and never will. Step 2 must branch on
     `project_id is null` BEFORE calling the resolver, or it will hard-error on a
     row that is already correct.

   **RULING (b) — SHIPPED IN `0147`, NOT PENDING. Sync via an AFTER UPDATE
   TRIGGER on `projects`, mirroring `salary_history`.** Fires only when
   `commission_mode`, `commission_value` or `commission_bump_pct` actually
   change; upserts a row with
   `effective_from = (now() at time zone 'Asia/Riyadh')::date` onto the
   `(project_id, effective_from)` unique index. `0146` created that index as
   UNIQUE precisely so this upsert has a conflict target.
   - **`0147` shipped it as TWO triggers, not one, and added the INSERT half the
     ruling did not name.** `projects_commission_history_upd` is the ruling
     above verbatim. `projects_commission_history_ins` (AFTER INSERT) writes a
     `is_baseline = true` row at the new project's floor, because a project
     created after `0146` and before `0147` would otherwise have no history at
     all and ruling (a)'s hard error would then block delivering its trips.
     They cannot be one trigger: `OLD` is unavailable in an INSERT trigger's
     `WHEN` clause (the `0114` lesson). See §4's `0147` bullet.
   - **`0147` moved no commission figure.** It only writes history; both call
     sites still read `projects.commission_*` at the time it landed. 2b
     (`bc92d18`) has since moved both onto the resolver.
   - **A trigger, not app-side writes, because there are TWO edit surfaces.**
     `update_project_with_customer` (the RPC the project modal calls) and
     `app/projects/actions.ts` both overwrite the columns — and the second one
     **never even reads `commission_bump_pct`**. Anything written in app code
     would have to be written twice and would still miss a direct SQL edit. The
     trigger catches every writer by construction.
   - **A same-day edit CANNOT corrupt the past.** Baselines sit at the project
     floor (2026-06-27 … 2026-07-16, all in the past), the trigger writes
     today-dated rows, so an upsert can never land on a baseline. That is 0126's
     structural fix, and it is why `0146` refused a today-dated baseline.
   - Follow `record_salary_change()` for shape: `language plpgsql`,
     `security definer`, `set search_path = public`.

   **STEP 2b — SHIPPED (`bc92d18`, `app/trips/actions.ts` only, +124/−25).** The
   read side. `priceDelivery` and `recomputeDailyCommission` both re-read
   `projects.commission_*` independently before this; both now go through ONE new
   helper, `commissionConfigFor()`, which calls
   `commission_config_at(project_id, trip_date)` — keyed on `trip_date`, the day
   the trip is FOR, matching `dailyDriverProjectCommission`'s bucketing in
   `lib/commission.ts:107`. **One resolver, two callers, so they cannot drift.**
   `lib/commission.ts` is untouched and still pure; only the SOURCE of
   base/mode/bump moved.
   - **`priceDelivery` gained an error channel** — `Promise<number>` became
     `Promise<{commission, error}>`, and `setTripStage` refuses the whole stage
     move on an error, the same fail-closed posture as `0128`'s rate freeze
     directly below it. The old `if (!project) return 0` is GONE: silently paying
     0 for a project id that failed to read was a guess, and `trips.project_id`
     is FK'd anyway.
   - **The no-project branch runs FIRST**, before any resolver call — ruling (a)'s
     carve-out for `2bf32c2d-…`.
   - **Ordering call in `recomputeDailyCommission`, worth knowing:** the
     `rows.length === 0` early return sits ABOVE the resolver call, so an empty
     bucket returns clean instead of hard-erroring. The hard error must guard a
     WRITE, not an empty pass — the bucket empties on the push-back out of
     `delivered`, which is exactly the correction a mis-dated trip needs, and
     erroring there would block the fix for the data the error is complaining
     about. Every path that stamps a figure still resolves.
   - **The union narrows on `config`, not on `error`.** `error: string` includes
     `""`, so a truthiness check on it does not discriminate — that is six
     TS18047s. `if (!resolved.config)` is the working form.
   - **Numerics are coerced at the RPC boundary** with `Number()`. The resolver is
     a function, so its result is not covered by `lib/db-types`; a string would
     pass `commissionForNthTrip`'s `Number.isFinite(base)` guard as a silent 0.
   - **PROVEN A NO-OP BEFORE IT LANDED, read-only.** Over all **677** unpaid
     delivered driver+project trips: **new path vs old path = 0 differences**,
     and **resolver-returned-no-row = 0**, so ruling (a) cannot fire on today's
     data. `scripts/commission-check.ts` 36 PASS / 0 FAIL, `tsc --noEmit` clean,
     full `next build` clean.
     - **The suite emits 35 `[PASS]` lines, not 36 — corrected 2026-08-22.**
       Re-counted at `38201ed` (before `627dbae` touched the file) and again
       after: 35 both times, 0 FAIL. So the count above was already off when
       written and `627dbae` did not remove a check. Quoting it as 36 is how a
       later session would "discover" a regression that never happened. Count
       with `npx tsx scripts/commission-check.ts | grep -c '^\[PASS\]'` from the
       repo root rather than trusting either number.
     - **Six rows differ from the STORED `commission_sar` — and the OLD code
       disagrees with the same six identically.** Pre-existing drift, not caused
       or fixed by 2b: five on `VVV Test 2`, one on `King Salman Park`, all
       stamped when those bases were higher (15/14/19/10.30…) and never churned
       since. Today's code would rewrite them the moment anyone touches those
       days. **After 2b they can no longer be rewritten to today's terms**, which
       is the point.
     - The re-run query is worth keeping: partition `row_number()` over ALL
       delivered trips in the bucket and only THEN filter to unpaid. Filtering
       first gets `n` wrong, because a PAID trip still occupies a slot. The first
       pass got this wrong and reported the wrong six.
   - **It could not be a repo script.** The only credential on disk is the anon
     key; `anon` has EXECUTE revoked on the resolver and RLS blocks `trips`. It
     ran as read-only `execute_sql`, per §4.
   - Two stale docstrings NOT fixed, deliberately out of scope for a money commit:
     `lib/commission.ts:26` and `:46` still say "this month". The logic has been
     per-scheduled-day since the ramp moved to `trip_date`.
   - **`BreakdownReport` still reads `projects.commission_*` (`:104-106`) for
     DISPLAY**, so it narrates today's terms beside trips priced on historical
     ones. No money moves through it. Not touched — it was on the do-not-touch
     list — but it is now inconsistent and should be looked at.
   - Unrelated but adjacent, found during the read-only trace and NOT fixed:
     `ProjectsBoard:1060` does
     `getRate={(t) => t.commission_sar ?? project.rate_per_trip_sar}` — an
     undelivered card falls back to the **customer** rate in the DRIVER
     commission slot. Two different kinds of money in one expression.

   **STEP 3c — SHIPPED (`0a21b59`, app-side only, no migration).** What follows
   was the SPEC it was built to, kept verbatim because each bullet records a
   decision Turki made; every one of them was implemented as written. Do not
   read it as a to-do list. The as-built account is in ITEM 4 IS DONE at the top.
   - **Modal pre-fill moves onto `commission_config_at(project, today)`**
     (`CustomersTab:131-133` currently pre-fills from `projects.commission_*`,
     which `0148` can legitimately leave stale).
   - **`ProjectModal.tsx` gains the write surface.** Turki's placement, verbatim:
     "a date picker next to the 'Bump %' field, and below the 'Driver commission
     mode' section a re-editing card with its features. Shape, labels and layout
     are yours — I'm not speccing them." Design is Claude Code's, per §2.
   - **`/projects` LOSES commission and rate entirely** — form and
     `app/projects/actions.ts` — and becomes the lifecycle surface only
     (customer, name, dates, status). Turki: "No third write path, no
     `update_project_lifecycle` RPC. This kills the missing-bump bug by
     deletion." **Project CREATION stays exactly as it is.**
   - **Class B displays repoint at `v_project_commission_now`** (`0149`), whose
     drift flag was proved 0 everywhere at apply — that is the no-op proof.
     Archive stays on `commission_config_at(project, archived_date)`.
   - **CALL ORDER when the modal saves: `update_project_with_customer` FIRST,
     `set_project_commission` SECOND.** After `0150` the two commute, so this is
     defence in depth — the commission writer runs last and wins even if `0150`
     were ever reverted.
   - **Call `set_project_commission` ONLY when the commission form actually
     differs from its pre-fill, or a date was picked.** Firing it on every save
     stamps a today-dated "commission change" history row every time somebody
     renames a project.
4. **THE THREE LEFTOVERS 2b FLAGGED ARE ALL CLOSED. Nothing here is owed.**
   Found during 2b's read-only trace and deliberately left out of a money
   commit; re-checked at `037c40d`, then fixed in `0bf75d6` and `627dbae`. Kept
   as a record of what was wrong, not as a queue:
   - **CLOSED. `BreakdownReport` no longer reads `projects.commission_*`.** 3c
     repointed it at the `commissionNow` prop (`v_project_commission_now`), and
     its header comment now states the distinction outright: the header line is
     TERMS IN FORCE TODAY, while every commission NUMBER in the report body sums
     `trips.commission_sar`, frozen at delivery. Those two are allowed to
     disagree and the file says so. Nothing owed.
   - **CLOSED in `0bf75d6`. The `getRate` conflation — and it was BOTH call
     sites, not one.** Verified in-browser by Turki before commit.
     - **The description above this fix was wrong twice, so read the shape and
       not the old summary.** It said the leak was `:1091`'s
       `t.commission_sar ?? project.rate_per_trip_sar` firing on UNDELIVERED
       cards, and it praised `:1743`'s `t.rate_sar ?? 0` as "the honest thing
       for the customer-money column." Both claims were false.
       `ratePerTrip` was read in EXACTLY ONE place — the
       `stage === "delivered"` branch's "Commission paid" badge. So the
       fallback could never render on an undelivered card, and `:1743` was not
       a customer-money column at all: it passed the customer rate,
       unconditionally, into the same driver-commission label. The
       direct-customer board was the WORSE of the two.
     - **Measured, not reasoned: the bug was LATENT.** Live counts —
       delivered trips **757, of which 0 have a null `commission_sar`**; the 77
       undelivered rows are all null but never reach the badge. So the `??`
       never fired, and the single no-project delivered trip
       (`rate_sar` null, `commission_sar` 0) rendered the same `0.00` from the
       wrong source by coincidence. **No figure on screen was ever wrong.**
     - **The fix removes the seam, it does not correct the arguments.** The
       figure lives on the trip row, so `TripCard` now reads
       `trip.commission_sar` and the whole `getRate` / `ratePerTrip` prop chain
       is deleted from `StageColumn` and both mounts. There is no longer a
       parameter through which revenue can reach a commission label. Zero
       rendered change on current data — that was the acceptance test.
     - A null commission on a delivered row now reads **"Delivered — no
       commission recorded"** rather than a fabricated `+0.00 SAR`. Unreachable
       today; kept because "nothing was stamped" and "zero" must not look alike
       on a money surface, which is ruling (a)'s distinction carried into the UI.
     - **`commissionNow` was NOT the answer, though the old note assumed it
       would be.** Today's resolved terms are a forecast; the badge states what
       was actually paid. Putting the pill's live figure on a delivered card
       would have reintroduced exactly the stale-vs-frozen mixup 2b removed.
   - **CLOSED in `627dbae`. The "this month" docstrings — and a THIRD rot in the
     same file that this item never listed.** The code was correct and is
     unchanged; all **35** checks in `scripts/commission-check.ts` pass before
     and after, the month-window regression guard among them.
     - **It was not only a comment fix.** `commissionForDelivery`'s fourth
       parameter was literally named `priorThisMonth`. Renamed `priorSameDay`.
       The argument is positional so no caller could break — but a parameter
       naming the wrong window is an instruction to compute the wrong number,
       and the next caller is the one it would catch. Every existing caller was
       already per-day (`priceDelivery` computes a local `priorToday`).
     - **The third rot: the module header's model block named
       `projects.commission_value` / `_mode` / `_bump_pct` as the SOURCE of
       base/mode/bump.** Wrong since `bc92d18` moved both callers onto
       `commission_config_at(project_id, trip_date)`. Worse than the docstrings,
       because `lib/commission.ts` is PURE — it prices whatever base it is
       handed and must not name a source at all. Naming the stale mirror there
       is how a future caller talks itself into reading it. The block now says
       the three are arguments and says why it refuses to name an origin.
     - `monthKeyOf` was left alone and is still correct: it is for
       REPORTING/payroll-period grouping, not scaling position, and its own
       comment already says so at length.
5. **Nothing else is scheduled-but-undone.** `0139`'s Q5 is closed. The Deferred list
   in §7 carries nothing blocked-and-actionable — RBAC + the app-wide security pass,
   effective-dated customer rates, multi-project customers, Route Optimization /
   Predictive / IoT are all parked deliberately.
   - **"Effective-dated rates" in §7's Deferred list means the CUSTOMER rate
     (`projects.rate_per_trip_sar`, stamped onto `trips.rate_sar`). It is a
     DIFFERENT column and a different money path from the driver commission that
     item 3 is about.** Both are per-trip figures frozen at delivery off an
     undated project column, so the two problems rhyme and the customer side
     could reuse `0146`'s shape — but nothing has been built for it and it stays
     parked. Do not read item 3 as having closed it.
6. **Still owed from much earlier, unrelated and still true:** an end-to-end
   in-browser "Download PDF" check against the live PDFShift API — nobody has
   confirmed a real PDF came back since `PDF_API_KEY` landed in `.env.local`.
   **Blocked on the same missing browser channel as §5.**
