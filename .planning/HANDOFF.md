# SESSION HANDOFF

**Updated 2026-09-11 (migration-set convergence close-out — `0195`, the pristine
rebuild proof, and `CLAUDE.md` compression pass 6; Batch K, Batch H and the three
2026-09-09 sessions are the sections below it), every figure re-measured this
turn.** Rewritten fresh at
`2318055` on 2026-09-08 from a 1301-line predecessor; **nothing was lost, it is
`e93baec:.planning/HANDOFF.md`, and every unit's reasoning lives in its own commit
message**, which is where `CLAUDE.md` §5 says detail belongs. This file is
STATE — what is true now, what is open, and what comes next. Rules are in
`CLAUDE.md`; domain law is in `.claude/skills/aquafleet-domain/SKILL.md`.

**THE DATABASE'S OWN MONEY LOGIC IS NOW UNDER TEST — 293 ASSERTIONS AGAINST A
LIVE POSTGRES, NOT A MOCK.** `test:money` has always tested the TypeScript half;
until Batch K nothing exercised the RPCs, and the RPCs are where the money
actually moves. Three harnesses in `scripts/db/`, chained into `npm run
test:db`. **They connect to `aquafleet-test` and to nothing else** — a four-string
target guard in `scripts/db/harness.ts` refuses to open a socket otherwise. See
Harnesses and Completed this session.

**A GREEN HARNESS IS A CLAIM UNTIL YOU HAVE SEEN IT GO RED.** Every assertion in
all three was proven able to fail: mutate to simulate the real regression, watch
it turn red, restore, confirm byte-identical with `git hash-object`. **Do not add
an assertion to these files without doing
the same** — the failure mode they exist to prevent is a suite that pins what the
code DID rather than what it must ADD UP TO, and that suite reads green forever.

**THE VAT RATE IS ONE OBJECT, AND `confirm_invoice` NOW REFUSES TOTALS THAT DO
NOT ADD UP.** `0190` put `public.vat_rate()` behind the five money objects that
carried a bare `1.15` or `0.15`, and `0191` gave the confirm RPC three tiers of
arithmetic assert. **The two VAT families stay SEPARATE — sharing the RATE is
safe, sharing a ROUNDING HELPER would silently merge two conventions.** Do not
add a `vat_gross()`. See Completed this session.

**AND AN ASSERT IS NOT A CONSTRAINT, DELIBERATELY.** `0191` asserts inside the
RPC rather than as a table `CHECK` because **8 of 36 existing invoices already
violate the identity** and are frozen by `0027` — a CHECK would take
`pay_invoice` / `unpay_invoice` / `void_invoice` down on rows nobody is allowed
to repair. New confirms are held to the rule; issued history is not rewritten.

**THE APP AND THE DATABASE NOW AGREE ON WHAT DAY IT IS.** Both halves landed the
previous session: `0189` moved every day/month/year bucket in the DB off bare
`current_date` (which is UTC here), and `00cfb9e` moved the app's formatters off
the host clock. **Neither half was sufficient alone** — the DB is authoritative
for stored dates, the app for displayed ones, and before this they could name
different days for the same instant. See Completed this session.

**The parked list is still CLEAR** — nothing was parked this session either.

**A COMMIT CLOSING AN ITEM IS NOT EVIDENCE THE ITEM IS FINISHED.** Standing lesson
from the `drivers.active` drop two sessions ago: it missed a seventh file and took
the Archive page down with `42703` until a follow-up sweep caught it (`32a515d`,
`e4dbd3e`), with `tsc` green the whole time.

**NO DEPLOY BLOCKER IS CODE — BOTH ARE THINGS TURKI DOES.** A read-only audit ran
the whole gate — types, a production build, both suites, the view footer, the
function ACLs, RLS, the env surface — and every code-side check is green. Two
things are not ready. **The live database is a sandbox**, with test rows woven
into records that are already PAID. **And public signup is OPEN — RE-MEASURED
THIS SESSION, still `"disable_signup": false`**: with no role gate anywhere in
the app, anyone who registers gets everything. **Do not read "audit passed" as
"ship it".** See Deploy readiness.

**Every number below is a POINTER, not evidence. Re-measure before quoting it.**
The commands are given inline so re-measuring is cheaper than trusting.

---

## Current state

### Git

- **`main` was at `410de67` when this line was written, and the commit carrying
  this file is its child.** Measured with `git rev-parse HEAD`.
- **Level with origin, measured BOTH required ways**: the BRANCH line of
  `git status -sb` reads `## main...origin/main` with no ahead/behind marker,
  and `git rev-list --left-right --count origin/main...HEAD` returns `0	0`.
  **Never read sync off the TREE lines** — a dirty tree says nothing about
  ahead/behind, and a clean one does not mean pushed.
- **This bullet cannot name its own commit's hash and goes stale the moment
  anyone commits.** It has rotted five times by naming a hash late. Measure.

### Database

- **Files on disk run through `0195`; 193 `.sql` files** (`ls
  supabase/migrations/*.sql | wc -l`, re-measured this turn). The gap between 193
  and 195 is historical numbering, not a missing file, and it has held its shape
  across seven levels. **`0192`, `0193`, `0194` and `0195` are ALL applied to
  production and catalog-verified — do NOT re-apply any of them.** See the
  three-layer section, the `0194` section below, and item (b)1 for `0195`.
- **THE STUB DISAGREEMENT IS CLOSED. `CLAUDE.md`'s stub and the DB both read
  `0195`.** It has now been allowed to disagree in writing TWICE, both times by
  the same rule and both times closed the same way. The first was one commit pair
  at `0194` — the security commit scoped to `0192`/`0193` alone and its docs
  commit to this file alone. The second was `0195`: the stub read `0194` through
  `5ba4db2` (the migration) and `604cdf7` (the proof), then bumped in `0fa3969`,
  the first commit that had reason to touch `CLAUDE.md` at all. **Twice is the
  rule working as designed, not a lapse that keeps recurring** — the alternative
  is a `CLAUDE.md` edit riding inside a migration commit, which breaks
  one-logical-unit. **Find that line by grep, never by address** — it has moved
  four times (`:251` → `:239` → `:236`, and it will move again):
  `npx tsx scripts/code-grep.ts 'DB at migration' CLAUDE.md --worktree`.
- **THE RULE THAT GAP TAUGHT, kept because the gap will recur.** `0189` was
  applied through MCP, which touches the database and leaves NOTHING in git — so
  no diff, no failing check and no review signals that the stub just aged. **§7
  does not say what to do when the pair splits** (checked: its only rule under
  that line is "do not read this number out of `schema_migrations`"), so the
  handling is stated HERE: **a stub either moves with the DB or disagrees in
  writing.** Silence is the failure mode, because the stub is what the next
  session reads first and it reads as current.
- **`0185`–`0191` were applied through MCP or the SQL Editor, and NEITHER PATH
  WRITES A `schema_migrations` LEDGER ROW.** The ledger's max version lags
  permanently and always will — see `CLAUDE.md` §7. **Do not read the migration
  level out of `schema_migrations`.** The record is the files on disk plus the
  objects in the catalog. All seven re-verified against the catalog this turn:
  - **`0185_within_month_collection_rate.sql`** — `settled_same_month_revenue_sar`
    is present on **both** `v_revenue_monthly` and `v_pnl_monthly`
    (`information_schema.columns`). Applied.
  - **`0186_collections_settlement_basis.sql`** — `report_metrics.basis` exists;
    **4 rows carry `basis = 'settlement'`**. Applied.
  - **`0187_report_metrics_balance_terms.sql`** — `report_metrics` holds **33
    rows**, **3** of them `paid_up_balance` / `running_balance` /
    `amount_payable`. Applied.
  - **`0188_drop_drivers_active.sql`** — `drivers.active` is GONE from
    `pg_attribute`, and the two RPCs it redefined read
    `authenticated=true, service_role=true, anon=false, PUBLIC=false` on
    `has_function_privilege`. Applied. **Its grant block restates BOTH
    `authenticated` and `service_role`** — `create or replace` had reset the ACL,
    and granting only `authenticated` would have silently revoked service_role.
  - **`0188` WAS NOT A CLEAN DROP — it needed a follow-up, and the gap was live
    in production for a day.** The migration and its TS half (`7c45ac8`) updated
    six files and **missed a seventh, `app/archive/page.tsx`**, whose narrow
    driver select still named `active`. PostgREST answers a dropped column with
    **`42703: column "active" does not exist`**, and because that page folds
    every query error into one page-level `error`, **the whole Archive page was
    down**, not merely its Staff tab. Fixed in **`32a515d`**; the comments left
    behind were corrected in **`e4dbd3e`**. Treat "0188 applied cleanly" as
    false: the DDL was fine, the code sweep was not.
  - **`0189_riyadh_date_buckets.sql`** — applied and catalog-verified by the
    architect, then committed as `e147373`. **The file is the record of a change
    already in place.** Re-measured this turn: **8 of 8** redefined functions
    carry no bare `current_date` anywhere in `pg_get_functiondef`, DO contain the
    Riyadh expression, and are NOT anon-executable; **0** column defaults in
    `public` still name `current_date` and **6** now name `Asia/Riyadh`; the month
    spine reaches the current Riyadh month (`true`). **Verification reads
    `pg_get_functiondef`, NOT `prosrc`** — `prosrc` omits PARAMETER DEFAULTS, and
    `add_price_lot` and `record_exit_permit_return` each carry the date in their
    signature as well as their body, so a `prosrc` check calls them clean while
    half the object is still on UTC. **"8" IS THE SET `0189` REDEFINED, NOT A
    TOTAL — a broad count of plpgsql/sql functions naming `Asia/Riyadh` returns
    `13`, and that is not a contradiction.** The other five —
    `set_project_commission`, `cancel_project_commission`,
    `record_project_commission_change`, `record_salary_change`,
    `issue_driver_payslip` — **already named Riyadh before `0189`, which is
    exactly why it did not touch them**; the first four hold
    `v_today date := (now() at time zone 'Asia/Riyadh')::date`, the payslip holds
    four `date_trunc('month', … at time zone 'Asia/Riyadh')` sites. Listed by
    name because a bare `8` vs `13` reads like drift. **Do not "reconcile" them.**
  - **`0190_vat_rate_constant.sql`** — applied and catalog-verified by the
    architect, then committed as `087e456`. Re-measured this turn: the five
    redefined objects (2 views, 3 functions) are **5 present, 5 referencing
    `public.vat_rate()`, 0 carrying a bare literal** — the count is asserted
    FIRST, so a typo'd name cannot read as "0 violations" on an empty set.
    `vat_rate()` is `provolatile='i'` with `proconfig is null`, which is the
    check that matters: **a function carrying a `SET` clause is NOT inlinable**,
    so leaving `SET search_path` off is what lets the planner constant-fold it
    and keeps the view plans identical. ACL correct (anon false, authenticated
    and service_role true).
  - **`0190`'s three FUNCTIONS applied byte-identical to the file** — live
    `pg_get_functiondef` md5s `431c9a42…`, `569d44bb…`, `96151700…`, exactly the
    three the pre-apply transcription proof recorded. **Its two VIEWS cannot be
    checked that way and their hashes DIFFER — that is not drift.** Postgres
    stores a view as a PARSE TREE and `pg_get_viewdef` re-renders the text, so a
    byte compare against drafted view SQL is meaningless by construction. The
    semantic checks are the right ones: money values identical across the
    before/after snapshots, `security_invoker` restated, `anon` revoked.
  - **`0191_confirm_invoice_totals_assert.sql`** — applied and catalog-verified,
    committed in the same `087e456`. Live `confirm_invoice` carries Tier A, B and
    C, references `vat_rate()`, holds NO bare literal, names the Riyadh year and
    NOT the old `extract(year from now())`, and reads anon false / authenticated
    true / service_role true. **The invoice-number year fix is FOLDED INTO this
    file**, not shipped separately — the architect's call, against the drafting
    recommendation; look for it inside `confirm_invoice`, not under its own number.
  - **THE APPLIED `confirm_invoice` IS NOT BYTE-IDENTICAL TO THE COMMITTED FILE,
    AND EVERY EXECUTABLE LINE IS.** Live `prosrc` is **950 chars / 12 lines
    SHORTER** than the file's body (210 lines vs 222); the first divergence is at
    line index 85, **inside the `TOTALS ASSERTIONS (0191)` header COMMENT** —
    the applied copy carries that comment block differently wrapped. Proof it is
    prose only: strip blank lines and full-line `--` comments from both sides and
    both give **159 lines / 8,259 chars / `a0750ba5c2aec1cda607efcfe110bda3`**.
    **DO NOT redefine a money RPC to reflow a comment** — `lib/invoice.ts`'s "fix
    forward, never rewrite applied history" applies, and `0191`'s own verification
    (TIER markers, Riyadh year, absence of the old year, absence of bare
    literals) passes on the applied object.
  - **Do not re-apply any of the seven.**
- **View security footer holds: 50 views, 50 `security_invoker=true`, 0 readable
  by `anon`.** `CLAUDE.md` §6's counts MATCHING is the check, not the number.
  **Re-measured AFTER `0190` replaced two more of those views**
  (`v_customer_prepaid_balance`, `v_customer_amount_payable`), and before that
  after `0189` replaced three (`v_report_months`, `v_receivables_open`,
  `v_truck_day_state`) — which is the case the rule exists for, since
  `create or replace view` silently drops `reloptions`. The companion function
  check is green too: **0 non-trigger functions anon-executable**, after twelve
  `create or replace function` statements across `0189`–`0191` reset twelve ACLs
  to EXECUTE-TO-PUBLIC and each migration's footer took them back.
- **`CLAUDE.md` §7's stub carries the migration number too, so the two files go
  stale together.** When the DB moves, change it in both places or leave the
  pair openly disagreeing — never silently.

### `0194_schema_convergence.sql` — APPLIED AND CATALOG-VERIFIED. Do not re-apply.

Closed the four NON-security drifts between the migration files and production,
measured 2026-09-10 against prod `ceqzmztewbborwgxnrqh` and test
`vlyxazfinmlanjdttavg`. Committed in `acc2123`, 477 lines / 23,278 bytes.

**DIRECTION IS THE THING TO CARRY FORWARD, not the diff.** "Convergence" is two
opposite operations wearing one word: **files ← prod** CODIFIES (applying it
changes nothing, and the no-op is provable), **prod ← files** is a REAL
production change. Mixing them up is how a parity migration becomes an outage.

1. **`start_work_order(uuid,text)` / `dispatch_outsourced_job(uuid,text)` —
   files ← prod, CODIFY.** Production had carried a post-`0076` revision no
   migration contained. **It is a BEHAVIOUR-PRESERVING REFACTOR, which is why
   codifying it was safe:** the null-guard is hoisted out of the UPDATE's WHERE
   into the IF over an already-locked row, the aliases differ (`wo`/`oj` vs
   `wo2`/`oj2`), and the self-exclusion reads the parameter rather than the row —
   identical values, since the row was selected BY that parameter. The bodies
   were lifted byte-exact from `pg_get_functiondef`, never retyped, and the file
   asserts their md5s (`4214e90c…`, `6b501351…`) so the no-op claim is CHECKED
   rather than stated. **Post-apply both md5s are unchanged** — proof the section
   was the no-op it claimed. Grants read anon-none / authenticated+service_role,
   2 of 2.
2. **`commission_types.label_ar` → NOT NULL — prod ← files.** `0080` declared it;
   production never had it. 0 nulls pre-verified, and the file re-checks in place
   so a failure names the column and the remedy instead of raising a bare 23502.
   `attnotnull` now true.
3. **`staff_commissions_commission_type_fkey` → `ON UPDATE CASCADE ON DELETE
   RESTRICT` — prod ← files.** Now `confupdtype='c'`, `confdeltype='r'`.
   Constraint actions only; no rows rewritten. **Worth knowing so nobody later
   reads it as a bug that was biting:** `commission_types.key` is an IMMUTABLE
   KEY under `CLAUDE.md` §6, so the CASCADE half describes an event the
   architecture forbids. RESTRICT is the half that does work, and it differs from
   NO ACTION only in deferrability. This bought parity of TEXT.
4. **Indexes — THREE distinct, NOT four.** The original plan was "both sides
   carry all four" and it was wrong: the composite
   `staff_commissions_staff_idx (staff_id, commission_date DESC)` **subsumes**
   `staff_commissions_staff_id_idx (staff_id)` by leading-column prefix scan, so
   carrying both leaves a permanently redundant index on every database. The
   subsumed one had **0 scans in ~16 weeks** (`pg_stat_user_indexes`, stats since
   `2026-05-22`), against 302 and 72 for the two prod-only indexes that were
   codified. Composite created FIRST, subsumed dropped LAST, so no window opened
   without a `staff_id` path. **Prod `public` index count 238 → 238** — create
   one, drop one, net zero, which corroborates it independently.

**Its verification block RAISES rather than prints** (§5: a result grid is not
proof). Two assertions there are worth reusing: **1b checks the composite's
DEFINITION**, because `create index if not exists` matches only the NAME and
will silently accept an index of the right name and the wrong columns; and **8
restates `0192`'s invariant predicate character for character**. A draft of 8
also excluded `prorettype = event_trigger`, which `0192` does not — that would
have exempted `revoke_anon_execute_on_new_functions`, the one function whose job
is enforcing the invariant. **Two spellings of one invariant is how a guard
quietly stops guarding.** If `0192`'s predicate changes, change `0194`'s with it.

### ACCEPTED RESIDUAL: prod and the files differ by COMMENTS ONLY on 24 functions, and that is FINAL

**Architect's ruling. Do NOT re-raise this, and do NOT draft a migration to
"finish" convergence.** It is not an open item; it is a closed one with a
recorded reason.

**What differs.** 76 functions per side, no prod-only and no test-only. **28
differ by raw hash — not the 3 an earlier inventory claimed**, which is the
"re-measure before quoting" rule paying out. Of those, **24 differ by COMMENTS
ONLY**, every one with a comment-stripped length delta of exactly **0**:

`archive_project_guarded`, `cancel_project_commission`, `confirm_invoice`,
`consume_from_lots`, `consume_work_order_line`, `consumption_approvals_lock_guard`,
`consumption_event_completed_at`, `create_outsourced_job`, `discard_invoice`,
`edit_outsourced_job`, `next_payslip_number`, `next_trip_ref_number`,
`pay_commission`, `pay_invoice`, `receive_stock`, `record_project_commission_change`,
`reject_stock_receipt`, `restore_customer_guarded`, `return_to_lots`,
`search_everything`, `search_norm`, `set_project_commission`, `trips_set_ref`,
`trips_station_offers_water_type`

Prod is the SHORTER side in all 24, and 19 of them carry no comment syntax at
all on prod. **One cause, not 24** — prod's copies went in through a path that
stripped comments. The remaining 4 of the 28 were `0194`'s two (now codified),
`issue_driver_payslip` (intra-expression spacing, `( 'id',` vs `('id',`, which
whitespace COLLAPSE does not equalise) and `0193`'s trigger function.

**`0193`'s trigger function WAS a THREE-WAY split. RECONCILED 2026-09-10 — it is
no longer in this residual.** File, prod and test each carried different `raise
notice` text at `0193:202` and `0193:209`, so `49ece93` had put a `0193` into
history matching neither database — the prod copy was comment-light from the
initial MCP apply. **Production's `revoke_anon_execute_on_new_functions` was
re-stated to the COMMITTED `0193` file text and now byte-matches it**, and the
event-trigger canary was re-run afterwards and still shows enforcement. **Do NOT
re-apply `0193`** — it is done, and a second application is exactly the
transcription risk the paragraph below refuses to take.

**HOW "COMMENTS ONLY" WAS PROVEN, because the obvious method does not work.**
Comment-stripping cannot see inside a string literal: a `--` in a message would
be stripped as if it were a comment, hiding a real difference. `0193`'s case
proves that class exists. So the question was settled directly — **is there any
string literal, in any of the 24, on either catalog, containing `--`, `/*` or
`*/`?**

- A regex over quoted literals **FAILED, and said so**: it returned 10 hits, all
  false, every one starting at an apostrophe INSIDE a comment (`month's`,
  `receipt's`, `caller's`, `customer's`), which desyncs literal tokenization.
  **Do not answer this question with a regex.**
- A proper **state-machine lexer** (4 states: code / literal / line comment /
  block comment, with `''` escape handling) was run over raw `prosrc` on both
  catalogs — 70,743 chars on prod, 85,533 on test, 24 of 24 functions each,
  0 dollar-quoted regions.
- **It was guarded before being trusted** (the "prove a guard can fail" rule):
  a positive canary `select 'has -- inside' ; -- real comment` **fired**, a
  negative canary `select 'clean' ; -- the month's end` stayed **silent** —
  proving it detects the thing AND handles the exact class that broke the regex —
  and the final-state desync check was zero on every function.
- **Result: ZERO literals containing comment syntax, both catalogs.** The
  comment-only verdict is proven, not assumed. Behavioural identity also holds
  against the 293 `npm run test:db` assertions.

**WHY THEY ARE NOT BEING RE-APPLIED.** Re-transcribing 24 working functions to
converge COMMENTS trades real transcription risk for zero behavioural gain. Each
`create or replace` is a chance to introduce the one difference that matters, on
money RPCs (`pay_invoice`, `pay_commission`, `confirm_invoice`, `receive_stock`)
that are working correctly today. **This is `0191`'s ruling generalised** — see
"DO NOT redefine a money RPC to reflow a comment" above, which decided exactly
this for `confirm_invoice` and has held since.

**What a from-scratch rebuild produces:** the FILE versions — richer-commented,
behaviourally identical. That is the better artifact, and it arrives for free.

**CONSEQUENCE FOR THE PRISTINE-REPLAY DIFF: a comment-only FUNCTION diff is
EXPECTED OUTPUT, not a finding.** The replay should flag LOGIC diffs and stay
quiet about these. A future session re-running that diff will see 24-plus
function hashes disagree; **that is this note, not a regression.** Re-verify the
classification with the lexer before treating any of them as new.

**THIS IS NOW THE FINAL ACCEPTED RESIDUAL — the ONE documented difference
between the file set and production, and it is proven cosmetic.** After the
2026-09-10 rebuild and the `0193` reconcile above, the combined 14-category
schema fingerprint matches on both sides (see "Where this stands"), so what
remains is **function COMMENTS and nothing else**: the 24 bucket-B functions
listed above carry lighter comments on production than in the files, and a
rebuild produces the richer FILE versions. **Nothing behavioural, nothing
security-relevant, nothing structural.** Three independent proofs, all recorded
above — the state-machine lexer (zero literals containing comment syntax on
either catalog, with a guard proven able to fail), aggressive normalisation, and
293 `test:db` assertions green against the from-scratch schema. **Do not reopen
this as a defect and do not draft a convergence migration for it.**

**`CLAUDE.md` §6 said "no default-privileges equivalent exists for functions —
nothing makes this stick." That is now half-true, and the half that changed is
the important half.** `0192` and `0193` are both applied to production and
catalog-verified. The invariant — **zero NON-TRIGGER functions in `public`
anon-executable** — is now enforced by the database rather than by every future
author remembering a footer.

The three layers, weakest in the middle:

1. **`CLAUDE.md` §6's per-function footer.** Every `create or replace function`
   ends with `revoke execute on function … from public, anon`. Unchanged, still
   mandatory, still the thing a reviewer checks for. It is a discipline, so it
   fails the way disciplines fail — `0118` forgot it and left a SECURITY DEFINER
   money RPC open until `0163`.
2. **`0192`'s default-privilege revoke — DEFENCE IN DEPTH ON ONE GRANTOR.**
   `alter default privileges in schema public revoke execute on functions from
   anon`, implicit `FOR ROLE postgres`. Real narrowing, worth keeping, **and it
   did NOT close the footgun.**
3. **`0193`'s event trigger — THE ACTUAL ENFORCEMENT.**
   `zz_revoke_anon_execute_on_new_functions`, a SECURITY DEFINER
   `event_trigger` on **`ddl_command_end`** for tag **`CREATE FUNCTION`**,
   revoking `public, anon` on every function it sees in schema `public`.

**`0192` ALONE WAS FALSIFIED BY ITS OWN CANARY, AND THAT IS THE LESSON HERE, NOT
A FOOTNOTE.** The file was drafted claiming section 1 "closes" the footgun. The
post-apply canary — create a throwaway function, read `has_function_privilege`
back — returned **TRUE** on production after `0192` applied. The
`(postgres, public, FUNCTIONS)` row genuinely stopped granting anon, and `0192`'s
own assertion (1b) proves that much; a function created afterwards was still born
anon-executable anyway. **The read-back written into the migration is what caught
the migration's own overclaim.** The prose in `0192` was corrected to "DEFENCE IN
DEPTH, NOT A FIX" before the file entered history — the committed blob says so at
its header, at section 1, in its success notice and at canary B. Assertion (1b)
was left exactly as drafted, because it asserts something true.

**`0193` is what closes it, proven by production canary on BOTH paths** — a fresh
`create function` and a `create or replace` of an existing one, each read back
`has_function_privilege('anon', …, 'execute') = false`, with the schema-wide
invariant holding at **0** non-trigger anon-executable functions. `CREATE OR
REPLACE FUNCTION` reports the command tag `CREATE FUNCTION`; there is no separate
replace tag, which is why one tag covers the redefine-reopen hole that burned
`0118`.

Three properties of `0193` that are load-bearing, not style:

- **It can NEVER raise.** Each per-object revoke sits in its own exception
  handler and the whole loop sits in another. **A raising event trigger on
  `CREATE FUNCTION` would block every future migration** — that is the one
  catastrophic mode, and the design makes it impossible by failing toward
  availability and leaving a `notice`. Escape hatch if it ever misbehaves:
  `alter event trigger zz_revoke_anon_execute_on_new_functions disable`.
- **It is scoped to `schema_name = 'public'`.** Event triggers fire for ALL
  roles, so an unscoped version would revoke on objects Supabase Storage and
  GraphQL create during a platform upgrade. **Do not widen the scope.**
- **The `zz_` prefix is ordering, not naming taste.** Event triggers on the same
  event fire in ALPHABETICAL ORDER BY NAME, and this one must run last.

**Revoking anon on a TRIGGER function is harmless** — EXECUTE is checked at
`CREATE TRIGGER` time, not at fire time — so the trigger needs no carve-out for
them and does not have one.

**TWO OPEN ITEMS, both carried in `0193`'s header:**

- **The exact re-grant mechanism is NOT positively identified.** Something
  outside the postgres default-ACL row grants anon at create time. The leading
  candidate is the `(supabase_admin, public, FUNCTIONS)` row, which carries the
  same anon grant and is unreachable — `pg_has_role('postgres',
  'supabase_admin', 'member')` is **false**, measured. All six event triggers
  were enumerated and none grants. **The fix works regardless**, because it
  revokes AFTER any grant, at `ddl_command_end`. What it would NOT beat is a
  re-grant that happens later than that, which is the reason to keep looking.
- **`CREATE PROCEDURE` is not covered.** Zero procedures in `public` today, so it
  costs nothing now. Covering it needs BOTH `tag in ('CREATE FUNCTION', 'CREATE
  PROCEDURE')` AND `revoke execute on ROUTINE %s` — one without the other silently
  does nothing.

**Do not read a `false` from the canary as `0192` working.** Today's `false` is
layer 3 doing it. To attribute correctly, check `pg_event_trigger` for
`zz_revoke_anon_execute_on_new_functions` first.

`0192` also carried two non-footgun parity items, both proven no-ops on
production and both there so a from-scratch rebuild is not LESS secure than
production: **`stock_receipt_approvals`** RLS + its `authenticated`-only policy
(on production, created by NO migration — `0057:96` makes the table with no RLS,
no policy, no revoke), and the **`projects_set_initials()`** anon revoke (revoked
on production, granted on a rebuild, out of band either way).

### The security advisor is not clean, and that is EXPECTED — read this before reacting

Re-run today. Three findings, and **only one of them is work**:

1. **`auth_leaked_password_protection` — DISABLED.** Genuinely open. It is a
   console setting, not a migration. See Open items.
2. **`anon_security_definer_function_executable` — count 3.**
   `record_project_commission_change()`, `record_salary_change()` and
   `trips_station_offers_water_type()`. **ALL THREE RETURN `trigger`**, measured
   with `pg_get_function_result(p.oid)`, not inferred from their names. Trigger
   functions are unreachable through PostgREST — `CLAUDE.md` §6's accepted
   class. **`CLAUDE.md` §6's invariant HOLDS: zero NON-TRIGGER functions are
   anon-executable.** Verified by ordering the query so a non-trigger function
   would sort FIRST; the only four anon-executable functions in `public` are
   those three plus `set_updated_at()`, and all four return `trigger`.
   ```sql
   select p.oid::regprocedure::text as fn, pg_get_function_result(p.oid) as returns
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute')
   order by (pg_get_function_result(p.oid) = 'trigger'), fn;
   ```
   **A future session WILL open the advisor, see three red SECURITY DEFINER
   entries and read them as the 0115/0118 regression returning. They are not.**
   That is why this paragraph exists.
3. **`authenticated_security_definer_function_executable` — count 49.** This is
   the app's own RPC surface, granted to `authenticated` on purpose. Not a
   finding, and revoking any of it breaks the app.

### Copy and formatting

- **The metrics dictionary is bilingual.** The 33 × 5 display strings live in
  `lib/i18n.ts` under **`reports.metricDef`** (`:3786`), joined on `metric_key`;
  they are no longer DB columns. **The old in-code ruling `EVERY METRIC ROW
  STAYS ENGLISH` is GONE, correctly — do not go looking for it.** `0187` only
  registers the three Finance balance terms as ROWS; their prose is in i18n like
  everything else.
- **Arabic months, Latin digits, Gregorian calendar — and `"Sep"`, never en-GB's
  `"Sept"`.** `ar-SA` is refused outright (Hijri by default, Arabic-Indic
  numerals). The digit ruling in `lib/reports.ts` is separate and still stands:
  `en-US` at the `sar()` `Intl.NumberFormat` is CORRECT and governs NUMBERS.
- **`lib/utils.ts` owns month formatting**: `monthName(month1Based, lang)` and
  `monthLabel(monthKey, lang)` both read `common.monthShort`;
  `formatDayKeyLang` is an **en-GB Intl formatter** and renders September as
  `"Sept"`. **The two agree on eleven months out of twelve.** That near-miss is
  the 2026-09-08 session's most transferable finding — see Completed, `5ffa9cb`.
- **`00cfb9e` rewrote this file and did NOT disturb either ruling — re-measured
  after the fact, not assumed:** `formatDayKeyLang` still passes `"en-GB"`
  (`lib/utils.ts:574`) and `sar()` still builds its `Intl.NumberFormat` on
  `"en-US"` (`lib/reports.ts:895`). What it ADDED is the third axis: **`RIYADH_TZ`
  and `withRiyadh()`, so LOCALE and TIME ZONE are now set independently.** A
  formatter here names its zone; it does not read the host's. **Its spread order
  is `{ timeZone: RIYADH_TZ, ...opts }` — CALLER-WINS, zone included**
  (`lib/utils.ts:165-167`), so Riyadh is the DEFAULT, not a lock. **That override
  is USED, and flipping the spread to force the zone would break both users:**
  `DAY_KEY_OPTS` (`:551-556`) and `lib/parts-usage.ts:293` both pass
  `timeZone: "UTC"` on purpose — **a calendar KEY is a date with no instant in
  it, so placing it in a zone is what MOVES it a day.** The formatters that take
  an INSTANT get Riyadh; the ones that take a KEY must not. Measured this turn:
  those two are the only `timeZone` overrides in `app`/`lib`/`components`.

### Harnesses

- **`npm run test:money` — GREEN, 14 harnesses, ~10.5s end to end.** It is a
  shell `for` loop, so counting `&&` returns 1 and is wrong. Read the list:
  ```sh
  node -e "console.log(require('./package.json').scripts['test:money'])"
  ```
- **`npm run test:copy` — GREEN, 4 checks**: `metric-copy-check`,
  `month-label-check`, `i18n-lookup-single-source-check`, and — new on
  2026-09-09 — **`notification-format-check`**, which ran in NO suite until
  `9b99a98` wired it in. **A harness nothing executes is not a harness.** It now
  carries **26 assertions** (was 22 before `58c1589` added the `leave_return`
  fixture); read the count, do not trust this number:
  ```sh
  npx tsx scripts/notification-format-check.ts | grep -cE '^\[(PASS|FAIL)\]'
  ```
- **`scripts/notification-format-check.ts` covers all ELEVEN alert kinds
  `v_active_alerts` emits.** Its fixtures are real rows captured 2026-08-23,
  plus four CONSTRUCTED rows for branches that were not firing then — the three
  blue ones and `leave_return`, which only fires while `end_date` sits inside
  `(today, today + 3]`. **It holds no DB connection by design, so it cannot
  notice the view growing a TWELFTH branch**; that degrades to a label-only row
  in the browser via `detailLine`'s default arm, not to a red test.
- **`npm run test:db` — GREEN, 3 harnesses, 293 assertions, ~66s.** It is the
  only suite that opens a socket, which is why it is slow and why it is `&&`
  chained rather than looped — a connection failure must stop the run, not be
  counted as a pass. Per-harness counts, and how to re-measure them:
  ```sh
  npm run test:db | awk '/DB checks/{print $0, n; n=0} /^  ok  /{n++}'
  ```
  `confirm-invoice-check` **30** · `invoice-lifecycle-check` **110** ·
  `inventory-money-check` **153**.
- **It runs against `aquafleet-test` (`vlyxazfinmlanjdttavg`) and CANNOT reach
  production.** `scripts/db/harness.ts` holds ONE copy of a four-string target
  guard — the whole env file scanned for the prod ref, the `TEST_SUPABASE_URL`
  ref, the `TEST_DB_URL` host, and the service-role JWT's `ref` and `role`
  claims. **One copy on purpose: two copies of a safety device drift, and the
  copy that drifts is the one nobody re-reads.** The guard was re-proven in its
  new home with three poisoned env files when it moved there.
- **Nothing is committed to the test database.** One transaction per harness,
  a savepoint per case, `rollback` in a `finally`. Each ends by re-taking a
  row census **on a FRESH connection**, so it cannot read its own uncommitted
  work, and asserts it is identical to the census it opened with.
- **Every assertion in all three has been proven able to fail** — 5 negative
  controls on the lifecycle harness, 6 on the inventory one, plus the guard's
  own three. **Restoration was verified with `git hash-object`, not by eye.**
- **These test the DATABASE, so a passing run says nothing about the app.** The
  TS money engine is `test:money`'s job; the two suites overlap nowhere and
  neither substitutes for the other.
- **`scripts/code-grep.ts` is the tool that settles "is the identifier gone"**
  (`CLAUDE.md` §5). Directory arguments work since `8dea137`; exit 2 means the
  run produced no evidence and is never a pass.

### Deploy readiness — code side GREEN, data side NOT

A read-only audit ran 2026-09-09 and measured, not assumed, every gate:
`tsc --noEmit` clean; a real **production** build clean; `test:money` 14
harnesses green; `test:copy` green; **50 views / 50 `security_invoker` / 0
anon-readable**; **0 non-trigger functions anon-executable**; RLS on every table
holding data; no `service_role` key in client code; no hardcoded secrets.

**What is NOT ready is the DATA.** The live database is a sandbox. Test rows are
woven into records that are already PAID, so they cannot simply be deleted — the
understated dummy invoices and the "testing 111" charge are the known examples.
**This is the deploy blocker and it is Turki's call, not a code fix.**

**PUBLIC SIGNUP IS OPEN. MEASURED 2026-09-09, NOT ASSUMED.** The earlier audit
filed this as the largest UNVERIFIED risk and said testing it meant creating an
account. **It does not.** GoTrue exposes a public, read-only settings endpoint
that answers it outright — no account, no write, no secret printed (the anon key
already ships in the client bundle):

```sh
set -a && . ./.env.local && set +a
curl -s "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/settings" -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

Returned `"disable_signup": false`, `"external": {"email": true}`,
`"mailer_autoconfirm": false`. **Anyone can register.** Email confirmation is a
speed bump, not a gate — any working mailbox clears it.

**What that JWT reaches, re-measured the same turn against the catalog:**

| Measure | Value |
|---|---|
| public tables | 87 |
| RLS enabled | **87 of 87** |
| policies total | 89 |
| policies that are blanket `qual = true` for `authenticated` | **84** |
| non-trigger functions executable by `authenticated` | 58 |
| …of which SECURITY DEFINER | **45** |

**RLS being on everywhere gates almost nothing.** It separates `anon` from
logged-in, not staff from stranger. The only 5 policies that reference the
caller are personalization — `notification_prefs`, `notification_dismissals`,
`notification_thresholds_user`, `user_profiles` (all `user_id = auth.uid()`,
cmd ALL), and `issue_reports_insert_own` (INSERT, `qual` null, `with_check` on
`reporter_id`). **84 + 5 = 89 — the blanket row and this list are one
measurement read from both ends, so they MUST add up.** They did not: the row
said 85 next to a list of 5, wrong in the very commit that measured it
(`7629086`, today) and carried through 10 commits unflagged, because a table
cell and a sentence are not checked against each other unless the arithmetic is
written down. Now it is. Re-measured and corrected 2026-09-09. No
role column, no staff check, no authorization tier anywhere in the app. So the
audit's worst case is CONFIRMED REAL, not theoretical: open signup + no role
gate + 45 reachable definer money RPCs = full fleet and finance access to
anyone who registers.

**45 here and 49 in (c)3 are BOTH RIGHT — do not "fix" either to match.** The
advisor's 49 counts every definer function `authenticated` may execute; 4 of
them return `trigger` and are unreachable through PostgREST. 45 + 4 = 49,
measured, not reasoned:

```sql
select count(*) filter (where pg_get_function_result(p.oid) <> 'trigger') as reachable,
       count(*) filter (where pg_get_function_result(p.oid)  = 'trigger') as trigger_only
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.prosecdef
  and has_function_privilege('authenticated', p.oid, 'execute');
```

**The fix is Turki's, not code.** Supabase console → Authentication → Sign In /
Providers → Email → turn OFF "Allow new users to sign up", then invite the real
users under Authentication → Users. Re-run the curl above; it must read
`"disable_signup": true`.

**Closing signup is a tourniquet, not the cure.** The missing role gate survives
it — every authenticated user still sees everything. That is a design decision
Turki has not been asked for yet, and it is not on the deploy path today only
because shutting signup makes the user set a closed one.

**THE EDGE-RUNTIME WARNING IS SETTLED — DO NOT RE-RAISE IT.** The build warns
that `@supabase/supabase-js` touches `process.version`, traced through
`lib/supabase/middleware.ts`, and a middleware that throws on Edge would be a
total login lockout. **It does not throw.** The reference is at
`@supabase/supabase-js/dist/index.mjs:27`, module-level, so it IS reachable at
import time — but it is double-guarded (`typeof process !== "undefined"` plus an
optional chain on `.version`) and it feeds one cosmetic thing, the
`X-Client-Info` header.

**Proven by execution, not by reading the guards.** The exact minified expression
was pulled out of the built edge bundle (`.next-verify/server/middleware.js`, one
occurrence) and run inside Next's own `EdgeRuntime` VM
(`next/dist/compiled/edge-runtime`, the same one
`next/dist/server/web/sandbox/context.js` constructs) — bare, and again with
Next's injected `process.env` shim. Neither throws. Corroborated live: dev serves
middleware through that same sandbox and answers `/archive` and `/` with 307 to
`/login`, and `/login` with 200. **Only consequence is a mislabelled header
(`runtime=node`, no version).** Nothing to fix.

**Building to check this did not disturb dev**, because it went through
`./scripts/safe-build.sh --dist-dir .next-verify`. Read that script's header
before running any build while dev is up.

### Printing — two models, and which surfaces are on which

- **The DOCUMENT model** (own stylesheet, hidden same-origin iframe, no app CSS
  reaches inside): **invoice** (`lib/invoicePrintTemplate.ts`) and **statement**
  (`lib/statementPdfTemplate.ts`), both off `lib/plainDocStyles.ts`'s
  `plainDocShell`, both sharing their download path's view-model.
- **The SCREEN-DOM model** (`app/globals.css`, `body * { visibility: hidden }`
  plus an un-hide whitelist): everything else. **Measured today the whitelist
  carries 13 ids**, not the 12 an earlier revision claimed: `history`,
  `breakdown`, `permit`, `pnl`, `revenue`, `receivables`, `cost`, `ops`,
  `narrative`, `payslips`, `commission-review`, `custom`, `daily-trips`. Two
  portal/marker pairs remain, `#breakdown-print` and `#po-print`.
- **A subtree that leaves the whitelist without an intercept prints a BLANK
  SHEET**, which reads like the printer's fault. That is why `StatementModal`
  intercepts Ctrl/Cmd+P. Do not delete a whitelist entry without checking what
  its owner does with the shortcut.

---

## Completed this session (2026-09-11, migration-set convergence close-out — `08b96a1` → `1adf8a3`)

**This session spans midnight — do not read the dates as two sessions.**
`5ba4db2` is stamped 2026-09-10 22:02, the other three 2026-09-11 01:24–01:41.
Four commits, one theme: **the migration set that could not rebuild itself now
does, and the file that explains why was audited for explaining it wrongly.**

| Hash | What |
| --- | --- |
| `5ba4db2` | **Migration `0195` — drops the stale 6-arg `create_purchase_order`.** The LAST of the six self-rebuild instances and the only one of the six that needed a NEW file rather than an edit to an existing one. 238 insertions, nearly all of them reasoning plus three raised assertions in ONE rollback-scoped block. Applied on BOTH sides: a **no-op on production**, which already carried exactly one overload (the 6-arg was dropped there BY HAND and no migration records it), and a real drop on the pristine replay, where a from-scratch run resurrects it. |
| `604cdf7` | **HANDOFF — the pristine rebuild proof; open item (b)1 CLOSED.** `0001` → `0195` replayed UNATTENDED onto a wiped project: 192 files, exit 0, **zero manual patches at any point**, `test:db` 293/293, and a combined 14-category schema fingerprint of **`035be37ba5aedeadfcbab76b393cc640` matching production**. Also reconciled `0193` (its applied text now byte-matches the committed file — **do NOT re-apply it**) and named the final accepted residual: function COMMENTS only, 24 bucket-B functions. 83 insertions / 33 deletions. |
| `0fa3969` | **`CLAUDE.md` compression pass 6 — §6's function-ACL MECHANISM corrected.** 102 insertions / 103 deletions; **14,796 → 14,671 bytes**, back under §7's 15 KB trigger. |
| `1adf8a3` | **HANDOFF — open item (b)2 CLOSED**, with what pass 6 found written down. Section (b) is effectively empty again. 59 insertions / 24 deletions. |

Re-measure rather than quote either column:
```sh
git log --oneline --stat 08b96a1..HEAD
wc -c CLAUDE.md
```

**WHAT `0195` TEACHES IS NOT ABOUT PURCHASE ORDERS. ADDING A PARAMETER DOES NOT
EDIT A FUNCTION — IT CREATES A SECOND ONE.** `create or replace function` matches
on the FULL argument-type list, so a widened signature is a NEW object: the old
one keeps existing, keeps its own body, and keeps its own grants. `0053` knew
that, said so in its own header, and dropped the 6-arg explicitly in the same
migration that widened it — which is the correct discipline. Then `0056` was
authored against `0050`'s shape, wrote **"UNCHANGED signature (0050/0053)"** —
**the comment WRAPS mid-phrase at `0056:304-305`, so grepping the joined string
finds nothing; grep `UNCHANGED signature`** — then issued a drop for a signature
`0053` had already removed (so it dropped nothing),
and its create added a SECOND overload beside the 9-arg. Nine migrations later
the twin was still there, frozen at `0056` semantics: bare `0.15` VAT literal, no
Riyadh date buckets.

**Two failure modes follow, and both bit here:**

- a LATER migration that edits "the function" from an OUT-OF-DATE signature
  revives the dead one instead of editing the live one — `0056`;
- an assertion pinned to ONE `regprocedure` reports the live object healthy while
  the stale twin sits beside it, unmeasured. `0190`'s no-bare-VAT-literal guard
  scopes itself by exact signature (`0190:665` names the 9-arg), so a DIFFERENT
  signature of the same name is outside its five named objects **by
  construction**. That is not a hole in `0190` — **a guard pinned to a signature
  cannot see an overload.**

**The rule: count the overloads BY NAME, never assume there is one.** `0195`'s
first assertion does exactly that, and only then checks which one survived.

**IT WAS DEAD BY CALLER HABIT, NOT BY STRUCTURE — which is why it never surfaced
as a bug.** `app/inventory/actions.ts:548` sends all nine named parameters, so
PostgREST resolves the 9-arg and the 6-arg never ran. Any caller omitting
`p_ai_generated` / `p_ai_rationale` / `p_ai_rationale_ar` would have landed on the
stale VAT path silently. The drop makes that unreachable structurally rather than
by convention.

**A RULE RIGHT IN ITS INSTRUCTION AND WRONG IN ITS REASON IS ONE SOMEBODY
EVENTUALLY ARGUES THEIR WAY OUT OF.** That is why pass 6 CORRECTED §6 instead of
weakening it. §6 had claimed both redefinition forms strip a function's ACL. They
do not: **`create or replace function` PRESERVES `proacl`** — same OID — and only
`drop`+`create` resets it to `acldefault()`, which always includes `EXECUTE TO
PUBLIC`. Measured, not reasoned: `0150` replaces that way and asserts its
before-ACL against its after (`is distinct from`, `0150:329`), and production
passed.

**And the incident §6 cited could never have demonstrated what it was cited for.**
`0118:208` is itself `drop function if exists public.issue_driver_payslip(uuid,
date, text);` followed by a create — the one form that DOES reset — and
`grep -ciE 'revoke +execute|revoke +all +on +function'` over `0115` and `0118`
returns **0**, so neither file ever carried a function revoke at all. The breach
was **"never revoked"**, not "a redefinition stripped it". **The instruction did
not change**: every SECURITY DEFINER function and every money or guarded RPC still
ends with a `revoke execute` naming BOTH `public` and `anon`, because the two
forms sit one line apart in a diff and re-revoking is free.

**PASS 5 FOUND NOTHING AND WAS READ AS CONVERGENCE. PASS 6 FOUND THREE.** Besides
the ACL mechanism: §7's State line was stale at `0194`, and §5's `divide-` example
named the wrong grep — the plain pattern now returns **9 live, correctly-coloured**
sites, and only the BUG pattern (`divide-y`/`divide-x` lacking
`divide-[rgb(var(--border))]`) returns the single comment hit the rule is actually
about. Everything else was re-measured and HELD. **Read "converged" as a
measurement of ONE pass, never as licence to skip the next audit** — the pass that
finds nothing is indistinguishable beforehand from the one that finds the bug.

**THE NEXT REDUCTION IS A ROUTING DECISION, NOT A TRIM — and it is not Code's to
make.** `CLAUDE.md` sits at 14,671 bytes against a 15 KB trigger and the wording
fat is gone; three trim rounds were needed just to land under it, because the
first edit round made the file BIGGER (15,080). Getting materially smaller now
means MOVING a rule to `.claude/skills/aquafleet-domain/SKILL.md`, which is
Turki's/the architect's call. **Do not buy headroom by cutting a REASON** — that
is exactly the failure the §6 correction above is an instance of.

**WHAT IS OPEN AFTER THIS SESSION.** Open item **(b) is empty** — both entries
closed, kept only for their mechanism. **(a) is decisions-for-Turki only.** The
only carried code item is the unconsumed `shared` → `map` → `approximate` entry
at `lib/i18n.ts:996`, and **re-measuring it this turn changed what it is.**

**IT IS NOT DEAD COPY — IT IS COPY WAITING ON A DEFERRED PAGE, AND DELETING IT
WOULD BE THE MISTAKE.** Measured: nothing consumes it, and **`SaudiMap` does not
exist as a component at all** — the name appears only in `lib/i18n.ts` and in a
comment at `app/routes/page.tsx:12` describing what `/routes` will show. So the
key is orphaned because its consumer is DEFERRED, not because someone forgot to
remove it, and the Forward agenda already rules the disclaimer stays translated
(see "The map's English city labels"). **Leave it.** Two traps if this is
re-raised: the key is NESTED, so `code-grep 'shared.map.approximate'` exits 0 and
reads as already-removed — grep the leaf; and the tree's other `approximate` hits
are unrelated (`GlobalSearch.tsx`'s own local, two comments in `lib/invoice.ts`).

Next work comes from the Forward agenda.

## Completed the previous session (2026-09-10, Batch K — live-DB harnesses, `0b20721` → `41904c3`)

| Hash | What |
| --- | --- |
| `158fd7b` | **Pass 1 — `scripts/db/confirm-invoice-check.ts`**, 482 lines as committed. Pins `0191`'s three assert tiers at the confirm/freeze point. **30 assertions.** Also added `pg` + `@types/pg` + the supabase CLI, created the `test:db` script, and ignored `supabase/.temp/`. **It did NOT add the env ignore** — `.env*.local` was already `.gitignore` line 3 from the Next.js default, which is what keeps `.env.test.local` out of history (`git log --all -- .env.test.local` is empty; verified this turn). |
| `4052871` | **Pass 2 — `scripts/db/invoice-lifecycle-check.ts`**, plus the **shared-guard refactor**: `scripts/db/harness.ts` extracted from pass 1, which now imports it and shrank to 374 lines. Pins `pay_invoice` / `unpay_invoice` / `void_invoice`. **110 assertions**, 6 cases and 12 message-matched refusals. |
| `41904c3` | **Pass 3 — `scripts/db/inventory-money-check.ts`**. Pins FIFO lot consumption, `add_price_lot` and the `return_customer_balance` refund gate. **153 assertions**, 5 cases and 20 refusals. |

Sizes at `41904c3`, re-measure rather than quote: `harness.ts` 142 lines,
`confirm-invoice-check.ts` 374, `invoice-lifecycle-check.ts` 719,
`inventory-money-check.ts` 839.
```sh
for f in scripts/db/*.ts; do printf "%-40s " "$f"; git show HEAD:"$f" | wc -l; done
```

**THE FIFO FIXTURE IS BUILT TO DISCRIMINATE, AND THAT IS THE WHOLE VALUE OF
PASS 3.** Three lots whose `received_on` order, `created_at` order and price
order **all disagree on the first lot**, so consuming nine has three
right-looking answers — **420.00** by `received_on` (correct), 370.00 by
`created_at`, 320.00 cheapest-first — and the harness asserts the three
orderings genuinely differ BEFORE it asserts the outcome. **A fixture where they
coincide passes under all three rules and proves nothing.** It asserts the
per-lot UNIT COST, not the quantity alone: a quantity-only check goes green on a
walk that took the right amounts from the wrong lots.

**IT ENTERS FROM THE TOP, THROUGH `start_work_order`.** The TS layer never names
`deduct_work_order_parts`, `consume_work_order_line` or `consume_from_lots`, so a
harness calling the inner function directly would prove the walk orders correctly
and prove nothing about the figure that reaches the work order. One case calls
`consume_from_lots` directly ON TOP of that, because it carries its own copy of
the `ORDER BY` and the two drifting apart is exactly the bug the wrapper hides.

**THREE THINGS THE ERROR TEXT DOES NOT ADMIT, measured and asserted as behavior
rather than as they ought to read.** Each is pinned separately, so a change that
alters one leaves the other failing:

- **The drift guard exists TWICE with two different messages, and the OUTER one
  fires first.** `consume_work_order_line` walks the lots to record the split
  before `consume_from_lots` walks them to decrement, so the work-order path
  raises `for work order %` and the part-level `short by % for part %` is
  reachable only by calling the inner function directly.
- **On the work-order path an OVER-REQUEST is reported as DRIFT.** Ask for more
  than exists and the recording loop runs out of lots first, so the operator is
  told the ledger has drifted when the stock is simply absent;
  `'Not enough stock on hand'` never fires there. **Recorded, not endorsed** —
  changing the message is separate work.
- **`return_customer_balance`'s already-refunded guard does NOT fire on an
  ordinary double refund.** It sits behind the amount-is-positive guard, and the
  first refund is itself subtracted from the balance, so the second call is
  turned away by `'holds no balance to return'`. The already-refunded guard is
  reachable in exactly ONE shape — refunded, then **funded again** — which is
  also the only shape where it stops a second cash payout. Both are asserted;
  neither alone proves the double payout is closed. **Found by the harness going
  red on its first run**, which is the only reason it is written down.

**THE DEBTOR-REFUND GATE IS THE ONE THAT WOULD COST REAL MONEY.**
`v_customer_amount_payable` returns the prepaid RUNNING BALANCE, negative when
the customer OWES us (domain skill, "Amount Payable ≠ the prepaid BALANCE").
Flip that comparison and the RPC pays a debtor their own debt, in cash, and
freezes the figure into `customer_balance_returns` where nothing re-derives it.
Pinned with an archived debtor at −115.00 and an archived postpaid customer,
both refused by message.

**FOURTEEN NEGATIVE CONTROLS ARE ON THE RECORD, each restored byte-clean** — five
on pass 2, six on pass 3, and the target guard re-proven with three poisoned env
files when it moved into `harness.ts`. **That is the count this file can source,
not necessarily the count that was run**: pass 1's controls predate the batch
being written up, so do not read fourteen as pass 1 having had none. **The
strongest was `grant execute … to anon` inside the transaction** — the exact
`CLAUDE.md` §6 regression — which
turned the anon check red and rolled back clean: all six functions read back
denied afterwards via `has_function_privilege`, and the schema-wide count of
non-trigger anon-executable functions is still **0**.

**Pay moving the pool by 0.00 is CORRECT, not a missing assertion.** Model A
deducts at DELIVERY; `v_customer_prepaid_balance` has no `paid` term. Pass 2
asserts the zero deliberately — an assertion that the pool does NOT move is the
one that catches a well-meaning "fix" adding a second deduction at payment.

**THIS PARAGRAPH SAID THE TEST DATABASE "MUST NOT BE WIPED". IT WAS WIPED, AND
ALL THREE OF ITS CLAIMS ARE NOW FALSE. CORRECTED 2026-09-11.** As written it
said: `aquafleet-test` carries 1 customer / 1 project / 1 trip / 1 top-up / 1
commission-history row from the earlier `0190` unblock, removing them re-blocks a
migration replay, and the harnesses' censuses are written against that baseline
rather than against zero. Each fails on its own evidence:

- **The replay no longer needs a single row.** `410de67` made `0190`'s
  value-preservation guards data-AWARE — an empty snapshot is reported **SKIPPED**,
  never green and never fatal (grep `REPLAY-CLEANLINESS EDIT` in `0190`). The
  row-count check and the per-column diff are unchanged; they moved into the ELSE
  branch. The guard is still fully armed wherever there is money.
- **The wipe happened and the replay ran clean through it.** `db reset` against
  `aquafleet-test`, `0001` → `0195`, exit 0, unattended, zero manual patches — see
  open item (b)1 for the full measurement and the fingerprint.
- **The census is a DELTA, not an absolute.** All three harnesses take it on a
  fresh connection before AND after, then assert every key unchanged between the
  two (grep `zero-leak` in `scripts/db/`), so it holds at zero exactly as it held
  at one. `test:db` returned **293/293** on the freshly replayed schema.

**The live baseline is now whatever the pristine replay produced**, which is a
BETTER target than the old one: `aquafleet-test` used to be a patched-by-hand
descendant of an older replay, so a green suite there proved less than it looked
like. It now proves the committed files. **It REMAINS the `test:db` target.**

## Completed earlier the same day (2026-09-10, Batch H — VAT constant + totals assert, `876bc0b` → `0b20721`)

| Hash | What |
| --- | --- |
| `087e456` | **Migrations `0190` + `0191`** — `public.vat_rate()` behind the five money objects, and Tier A/B/C totals asserts plus the folded Riyadh year fix in `confirm_invoice`. Applied and catalog-verified BEFORE the commit; the files are the record. 2 files, 34,696 + 23,700 bytes. |
| `0b20721` | **The payment-mode guard** — `app/trips/invoiceActions.ts` converts the ONE input `assembleInvoice` throws on into an `ActionResult` error. 18 insertions. |

**`0190` IS TWO VAT FAMILIES SHARING A RATE, NOT TWO FAMILIES BEING UNIFIED, and
that distinction is the whole design.** Family A is the VAT-INCLUSIVE gross-up
(`* 1.15`, customer-facing, per-item) and Family B is the VAT AMOUNT (`* 0.15`,
internal inventory cost, no ZATCA document rounding). They are deliberately not
one thing: **sharing the RATE is safe, sharing a ROUNDING HELPER would silently
merge two conventions** that round at different levels. **Do not add a
`vat_gross()` helper** — it would read like tidying and would be a money bug.

**THE `SET search_path` OMISSION ON `vat_rate()` IS LOAD-BEARING, NOT AN
OVERSIGHT.** A function carrying a `SET` clause is **not inlinable**, so adding
one would leave every money view calling a real function per row instead of
constant-folding to a literal — different plans on the two hottest finance views.
The migration asserts `provolatile='i' and proconfig is null` precisely so a
later "harden it" pass fails loudly instead of quietly costing plans. The body is
schema-qualified nowhere because it references nothing.

**`0191` IS AN RPC ASSERT AND MUST STAY ONE, and the live data is why.**
Re-measured 2026-09-10 against `invoices`: **36 rows, 23 issued non-void, and 8
fail Tier A** — the stored `grand_subtotal_sar` does not equal the sum of the
document's own distinct lines. **All 8 are issued** (6 paid, 2 confirmed), so all
8 are frozen under `0027`. A table `CHECK` would therefore fire on `pay_invoice`,
`unpay_invoice` and `void_invoice` — every one of which `UPDATE`s `invoices` —
and take working money paths down on rows the freeze law forbids repairing.
Asserting at confirm holds NEW documents to the rule and leaves issued history
alone. **Tier C fails on ZERO rows**: no stored `grand_vat_sar` disagrees with
`subtotal × 0.15`, so the whole live violation set is Tier A.

**THOSE DELTAS RUN BOTH WAYS — "the frozen totals are understated" IS THE WRONG
ONE-LINE SUMMARY.** Per invoice (subtotal delta, lines minus stored):
`026-000007` **+410.00**, `026-000008` −1,000.00, `026-000009` **+3,690.00**,
`026-000012` **−40,000.00**, `026-000013` −1,000.00, `026-000014` **+28,560.00**,
`026-000016` −500.00, `026-000018` −500.00. Net −11,891.00 gross. **Do not quote
the net** — it hides a 40,000.00 overstatement against a 28,560.00
understatement. This is a DIFFERENT measurement from the domain skill's
"41,756.50 SAR understated across five invoices": that one re-derives through the
invoice engine, this one compares stored totals against the invoice's OWN stored
jsonb. Both are dated pointers. **Neither is cash** — `pay_invoice` and the
balance engine sum the lines, so `grand_total_sar` is display-and-reports only.

**The Tier split exists so the error NAMES the broken thing.** Tier A compares
the summed line set against `p_grand_subtotal` (over `select distinct` on
kind+id, so a line appearing in two arrays counts once), Tier B checks the three
component sums, Tier C checks `p_grand_vat` against `subtotal * vat_rate()`. Each
raises with the same hint — reopen the invoice so the totals recompute, then
confirm again — because in every case the client sent stale arithmetic and there
is nothing the user can fix on the confirm screen itself. An explicit nine-way
NULL guard runs first: `distinct from` on a NULL total would otherwise pass.

**THE YEAR FIX WAS FOLDED IN ON THE ARCHITECT'S CALL, AGAINST THE DRAFTING
RECOMMENDATION.** `confirm_invoice` drew the invoice-number year from
`extract(year from now())` — session time zone, UTC on this project — the last
survivor of the class `0189` swept. It now reads
`extract(year from (now() at time zone 'Asia/Riyadh')::date)`, the same shape
`0189` gave the PO number and the trip ref. It is inside `0191`, not under its
own number: **grep the body, do not look for a `0192`.**

**`0b20721` MAKES THE ONE KNOWN CALLER POLITE AND LEAVES THE ENGINE STRICT.**
`assembleInvoice` THROWS on a null payment mode (`lib/invoice.ts:429`), which
escapes the `ActionResult` convention the rest of `invoiceActions.ts` follows and
reaches the client as an unhandled server-action rejection — **a blank screen
where "pick a payment mode" belongs.** The guard converts it at the only call
site that can hit it with unvalidated data. **The throw stays.** It is the
money-core's own invariant — an invoice has no meaning until prepaid or postpaid
is chosen — and must keep failing loudly for any caller that has NOT checked.

**THE MD5 REVERSE-TRANSFORM PROOF IS HOW THE `confirm_invoice` REDEFINITION WAS
TRUSTED, and it is worth reusing.** Rather than eyeballing a 24-argument
`create or replace` against the live object, the drafted block was transformed
BACKWARDS — remove the added declare, the assert block, the year token, the rate
literal — and md5'd. Four reversals, each firing exactly once, produced
`781dcd98f0430466406afa695d2503d7`, byte-identical to the live definition.
**That also proved `0190` had not disturbed `confirm_invoice`**, so the verbatim
base was current rather than remembered. **Functions can be byte-compared
(`prosrc` is stored verbatim); VIEWS cannot** — see the Database section.

---

## Completed the previous session (2026-09-09, timezone + error boundaries, `e2a0c01` → `876bc0b`)

| Hash | What |
| --- | --- |
| `7629086` | This file: recorded that public signup is measured OPEN, not assumed. |
| `4e64204` | Re-verified every `CLAUDE.md` claim and corrected three that were false. |
| `9add0d6` | Moved §6's verbatim SQL out of `CLAUDE.md` into the domain skill, leaving the RULES behind. |
| `7eed1f7` | Routed session-end state to this file rather than `CLAUDE.md` §7. |
| `6433572` | This file: recorded RBAC options as an owed task, fixed a drifted archive reference. |
| `eb655c5` | Error boundaries (`app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`) plus a missing-env configuration screen — 10 files, 626 insertions. |
| `e147373` | **Migration `0189`** — every day/month/year bucket in the DB off bare `current_date`. Applied and catalog-verified BEFORE the commit; the file is the record. |
| `00cfb9e` | **The app half** — `lib/utils.ts` and 7 callers name `Asia/Riyadh` in the formatter instead of reading the host clock. 8 files, 239/72. |
| `876bc0b` | **The stub the first two left stale** — `CLAUDE.md` §7 `0188` → `0189`, catalog re-measured before the one-character edit. |

**`e147373` IS THE ONE TO READ, and the lesson is that THE FILES ARE NOT THE FIX
SET.** A first enumeration built from migration files listed ~10 `current_date`
sites and named `0053` as the PO-numbering site. `scripts/code-grep.ts` measured
**53** hits, and the LIVE `create_purchase_order` turned out to carry `0056`'s
nine-argument signature — `0053` had been superseded. The file-derived list was
discarded whole and the fix set rebuilt from `pg_proc` / `pg_attrdef` /
`pg_class`. **A migration file is a record of an INTENTION that may since have
been replaced; the catalog is what is running** (`CLAUDE.md` §5). The files were
used afterwards for one narrow purpose only: recovering house formatting for view
bodies already verified against `pg_get_viewdef`.

**THE SIX `greatest(current_date, riyadh)` SITES WERE LEFT ALONE, AND NOT
EDITING THEM WAS THE HARDER CALL.** A sweep would have "fixed" all six. They are
inert: `pg_timezone_names` gives `Asia/Riyadh` a fixed `03:00:00` offset with
`is_dst false`, so the Riyadh date is **never behind** the UTC one and `GREATEST`
already returns Riyadh. Proven, not argued — a frozen-clock probe on the live DB
returned `greatest_of_both` = `2026-10-01` and `2027-01-01` on the two edge
instants, with a control row at `20:59+00` agreeing on both to show the probe
isolates the three-hour window. **Editing a correct expression so a grep reads
cleanly is not a fix**, and `v_truck_day_state` deliberately keeps one such site,
which is why `0189`'s view verification asserts occurrence COUNTS rather than
zero.

**What the probe made concrete, and why this was not cosmetic:** at
`2026-12-31 22:00:00+00` the UTC year is **2026** and the Riyadh year is **2027**.
A purchase order raised in that window drew the previous year's counter and
printed `PO-2026-NNNN` — a gap-free numbering key AND a printed document, neither
quietly renumberable afterwards. The `last_service_date` case is worse than wrong:
`greatest()` **absorbs** a UTC-yesterday stamp, so the column keeps its old value
and the service silently never registers.

**`00cfb9e` carries the `ar-SA` trap, which is `CLAUDE.md` §5's comment rule
firing on a real commit.** The staged `lib/utils.ts` blob greps **5** hits for
`ar-SA` — the exact regression the change exists to prevent. All five are
COMMENTS explaining why it is never passed; `npx tsx scripts/code-grep.ts 'ar-SA'
lib/utils.ts` exits 0. **The prose documenting a prohibition matches a grep for
the thing prohibited.** Locale stays `en-US`/`en-GB` and only `timeZone` is
added, via a `{ timeZone: RIYADH_TZ, ...opts }` spread whose CALLER-WINS order is
what preserves `lib/parts-usage.ts`'s deliberate UTC subsystem untouched.

**An ENOENT on `/inventory` mid-session was environment, and was proven so rather
than assumed.** `.next/server/middleware-manifest.json` was missing because a
`TZ=UTC` verification build and earlier cleanups had partially removed the build
dir out from under a running dev server. Stopping it, `rm -rf .next .next-verify`
and restarting gave `Ready in 1301ms` with no ENOENT — **but then an
`Invalid hook call … Cannot read properties of null (reading 'useState')` fired
at `AppShell`, which looks exactly like a real regression.** It was not: the log
order shows a clean `GET /inventory 200` first, then a **500** on
`_next/static/webpack/<hash>.hot-update.json` — a chunk belonging to the DELETED
build — then the hook errors, then Fast Refresh's full reload. `AppShell.tsx` has
`"use client"` on line 1, is not one of the 8 changed files, and React resolves to
a single `18.3.1`. **Control: six requests with no browser attached reproduced
nothing.** A stale client bundle in an open tab desyncs from a fresh server and
nulls the React dispatcher. **A hook error is not always a hook bug — check
whether the client and server are running the same build before reading the
stack.**

---

## Completed earlier the same day (2026-09-09, deploy-prep, `e4dbd3e` → `e2a0c01`)

**Three read-only investigations that produced NO code commits, then seven
commits.** The audit, the Edge-runtime trace and the signup check were all
measure-only; their findings are in Deploy readiness above, and none was allowed
to turn into a fix in the same pass. **The signup check is the one that changed a
verdict** — it converted the audit's largest UNVERIFIED risk into a measured
fact, and it did so without the account creation the audit had assumed was
required. **When something is filed unverified because verifying it looks
prohibited, look for the read-only endpoint before accepting that.**

| Hash | What |
| --- | --- |
| `61cc581` | Repointed the three dangling `"HANDOFF.md §N"` references — `next.config.js:9` and `scripts/safe-build.sh` twice. |
| `4e3eca0` | Pinned `engines.node` to `"24.x"`. There was no `engines` field at all, so Vercel would have taken whatever the project setting happened to be, invisibly from the repo. |
| `9b99a98` | Wired `scripts/notification-format-check.ts` into `test:copy`. It ran in no suite. |
| `58c1589` | Added the constructed `leave_return` fixture, closing that harness at 11 of 11 alert kinds. 22 assertions to 26. |
| `eaba090` | This file: recorded the session, and corrected three claims it measured as stale. |
| `ffef697` | Aligned `@types/node` to `24.13.3` with the `24.x` engines pin, and reconciled `package-lock.json`, which `4e3eca0` had left behind. |
| `e2a0c01` | This file: closed the `@types/node` item that `eaba090` had described in the present tense one commit before it stopped being true. |

**`61cc581` IS THE ONE TO READ, because the pointers were not mis-numbered — they
addressed content that HAS NEVER EXISTED.** The instinct on a bad `§N` is to
work out which section was meant. Grepping this file for every term in the rule
they cited (`safe-build`, `dist-dir`, `clobber`, `404`, `next build`, `dev
server`) returned **nothing**: the build-clobbers-dev-server rule was never
written here, it lives in `scripts/safe-build.sh`'s own header. **A dangling
cross-reference is a claim that some other file says something — check that it
does before renumbering it.** Each reference now DESCRIBES the thing instead of
citing an address, so it cannot dangle again.
`supabase/migrations/0102_global_search.sql:17` keeps its `§6` deliberately: it
is applied history, not a live pointer.

**`4e3eca0`'s reasoning was measured against Vercel's docs, not recalled.**
Vercel currently offers **24.x (its default), 22.x and 20.x**, and **20.x is
deprecated on 2026-10-01** — picking it would have shipped a version with three
weeks left. `24.x` was chosen because three independent things converge on it:
it matches the local major (`v24.15.0`), it is Vercel's default and an active
LTS, and it is the version this session's passing production build actually ran
under. Next 14.2.5 declares `>=18.17.0` with no upper bound. **It left
`@types/node` at `20.14.10` on purpose, to keep the engines pin one logical
unit** — filed as a (b) item and closed later the same day in `ffef697`.

**`9b99a98` and `58c1589` are one lesson applied twice: A GUARD WAS PROVEN ABLE
TO FAIL BEFORE ITS GREEN WAS BELIEVED** (`CLAUDE.md` §5's rule, and the same
discipline `4172e4e` used on `noUnusedLocals`). For `9b99a98`, inverting one
expected value made `npm run test:copy` exit 1 and name the failing case, which
proved the `&&` chain propagates rather than swallowing a non-zero exit. For
`58c1589` the break was stronger and deliberately so: **the BEHAVIOUR was
disabled, not an expected value edited** — renaming `case "leave_return"` in
`lib/notification-format.ts` turned four assertions red, which is what proves the
new assertions guard that branch and not merely themselves. Both breaks were
restored and both files verified byte-identical to `HEAD` with `git diff --stat`
before staging.

**Why the `leave_return` row is CONSTRUCTED and that is not a shortcut.** The
kind fires only while `end_date` sits inside `(today, today + 3]`; nothing was in
that window on the 2026-08-23 capture day or on 2026-09-09, so no live row
existed to copy. It was transcribed from `v_active_alerts`' own `SELECT` list
read out of `pg_views` — identity shape, `yellow`, category `people`, `value_num`
as `end_date - today`, payload of `leave_type` / `end_date` /
`days_until_return`. **It is date-stable by construction**: `days_until_return`
is present and `detailLine` prefers it over `daysFromToday(value_date)`, so no
assertion there can redden because a date rolled. The rendered TEXT is never
asserted, only that it is non-null — and since `detailLine`'s default arm returns
`null` for unlearned kinds, **non-null IS the proof the branch ran.**

---

## Completed earlier the same day (2026-09-09, parked-items close-out, `2318055` → `e4dbd3e`)

**The four parked items, one commit each, then a cleanup sweep that caught what
item 3 had missed.** Each was measured against the live database or current code
first; **no claim below was carried over from a prior note.**

| Hash | Item | What |
| --- | --- | --- |
| `c17b7f8` | 2 | Corrected four stale comments. `consume_from_lots` is NOT callerless — four RPCs reach it inside the DB; the "NOT built" list was deleted after every entry proved built; `search.ts`'s dangling "HANDOFF.md §6" pointer now states the fact it meant; the map-cities note now reads as the ruling it received. |
| `7c45ac8` | 3 | Dropped `drivers.active` — migration `0188`, a four-case SQL harness, and six of the SEVEN TS readers. **It missed `app/archive/page.tsx`; see `32a515d`.** |
| `3519f3a` | 4 | Widened the New Supplier modal to `preview/app.css`'s 880px. The other three modals in the same note were measured and correctly left alone. |
| `70725bc` | 1 | The Arabic maintenance week header now uses `،` (U+060C) before the year; English byte-identical. |
| `32a515d` | — | **The seventh reader.** `app/archive/page.tsx` still selected the dropped `active`, so `/archive` answered `42703` and rendered its error state. Select corrected, `ArchiveDriverRow.active` removed, two `ArchiveStaffTab` filters reduced to `terminated_at`. |
| `e4dbd3e` | — | Four comments that outlived the column: `restoreDriver` no longer claims to set `active = true`, `drivers/actions.ts` no longer claims `driver-state.ts` reads the column (it is pure and reads none) or that deletion is "deferred", and `driver-assignment.ts` no longer offers it as a live gate. |

**`70725bc` IS THE ONE TO READ, and the lesson is about VERIFICATION, not
Arabic.** The fix was correct on disk from the first attempt, yet it was reported
as still broken twice. Reasoning about what the code *produces* settled nothing
both times. What settled it was a chain of bytes: `hexdump` of the file on disk
(`d8 8c`), then the same bytes inside the compiled chunk, then **the same bytes
in the chunk fetched over HTTP from the port the browser was actually on**, then
the codepoint read out of the live DOM. **A rendering complaint is a claim about
four artifacts — source, bundle, transport, DOM — and only the last one is what
the user sees.** Two stale `next dev` servers were found and stopped along the
way; neither turned out to be the cause, but neither could be ruled out by
argument. **When a fix "does not take", stop explaining and start dumping bytes
at each hop.**

`7c45ac8` carries the security companion: **`create or replace function` resets
the ACL, so the redefinition must restate the WHOLE measured grant set.** The
first draft granted `authenticated` only. That reads like a faithful restoration
and is in fact a silent revoke of `service_role`. Measure `proacl` before
drafting, and read the result back through `has_function_privilege` — **never
through `aclexplode`, which reports "no PUBLIC entry" for a NULL `proacl`, i.e.
exactly the state where PUBLIC *has* execute.**

**`32a515d` is the one that should not have been necessary, and its lesson is
that TSC CANNOT SEE A DROPPED COLUMN.** A Supabase select is a plain STRING and
its result is a CAST — `.select("… active …")` then `as ArchiveDriverRow[]`.
Nothing in the type system connects the two, so `tsc --noEmit` stayed green with
a page that could not load. The row type was the accomplice: it still declared
`active: boolean`, which is what let the two consumers compile against a field
the row would never carry. **When a column is dropped, the sweep is a grep of
every `.from("<table>")` select STRING, not a typecheck** — and the row type must
lose the field in the same commit, so the compiler starts flagging the readers
instead of blessing them. Fifteen `.from("drivers")` sites existed; fourteen were
already right, and the type system had no opinion about the fifteenth.

---

## Completed the previous session (2026-09-08, `0c7adf9` → `e93baec`)

Seven work commits and one handoff commit. One line each; **the reasoning is in
the commit messages, and they are the record.**

| Hash | What |
| --- | --- |
| `0c7adf9` | Moved the Metrics Dictionary's display copy out of `report_metrics` and into `lib/i18n.ts`; `0187` registers the three balance terms as rows. |
| `f42690d` | Gregorian month names in Arabic with Latin digits throughout — thirteen implementations across the app, not the three the parked item predicted. |
| `04b2c4e` | Docs: scoped and attributed the invoice v3 §9 residual figures correctly. |
| `8dea137` | `scripts/code-grep.ts` now resolves path arguments before reading, so a directory can no longer report a false green. |
| `32d7c08` | Cleanup sweep: corrected one stale call-site figure, deleted the superseded review artifact. |
| `4172e4e` | Made three zero-reference report types file-internal (`MetricTextField`, `IndicativeZakat`, `PayslipSnapshot`). |
| `5ffa9cb` | Consolidated seven hand-built month labels onto `lib/utils`' `monthName`, byte-identical in both languages. |
| `e93baec` | Handoff rows for the last three of the above. |

**`5ffa9cb` IS THE ONE TO READ, because the lesson generalises past this
change.** The obvious canonical helper was `formatDayKeyLang`. Using it would
have been wrong: **two helpers can render the same SHAPE from different SOURCES
and agree on eleven months out of twelve.** `common.monthShort` says `"Sep"`;
en-GB says `"Sept"`. Routing six user-facing screens through the "canonical"
helper would have silently restyled one month, and no test run outside September
would have caught it. **A consolidation onto a shared helper is a WORDING change
until the output is compared character-for-character across the whole input
domain** — here 264 comparisons, 12 months × 2 languages × padded and unpadded
days, plus an inverted control asserting that `formatDayKeyLang` DOES differ. It
did, on September alone. **Pick the helper that matches the SOURCE, not the one
that matches the name.**

`4172e4e` carries the smaller companion lesson: `noUnusedLocals` was proven able
to flag an unused type alias (a throwaway `type __GuardProbe` producing
`TS6196`) BEFORE its green was trusted. **A guard must be shown capable of
failing before its pass means anything.**

---

## Open items

**This list was first derived 2026-09-08 and RE-DERIVED 2026-09-09 by the
deploy-prep audit** — `TODO`/`FIXME`/`HACK`/`XXX` across all tracked
`ts/tsx/sql/css/json` (**zero hits**), plus `deferred`, `parked`, `out of scope`,
`as-is`, `for now`, `not built yet`, `RBAC`, this file's own open section, and
`SKILL.md`'s deferred list, each survivor re-measured against live code and the
live DB rather than carried forward. **An earlier revision of this paragraph
warned that the list's completeness was a day old; that caveat is spent.**

**The SWEEP is as fresh as `58c1589` and no fresher — 11 commits have landed
since.** The audit was READ-ONLY by instruction, so it re-derived and classified
but changed nothing; the four commits that day came from a separate, explicitly
scoped pass. **The entries BELOW are individually newer than the sweep** — (b)1
was opened 2026-09-10 by a migration replay onto an empty project, an exercise
nobody had run when the sweep went out. **A re-derivation is a floor on this
list's completeness, not a timestamp on its contents.**

### (a) DECISION for Turki — do not "fix" these, they are choices

**Four of the original six closed in the parked-items session.** They are listed under "Closed
BY MEASUREMENT" below with their hashes, so they are not resurrected. Three
remain, and **none is code.** Two are Turki clicking a console setting; the third
is whether a convention gets written down. **An earlier revision said "all three
are Turki clicking something" — item 1 is not a click, and reading it as one is
how it stays unanswered.**

1. **`.planning/` review artifacts are TRACKED, and no `.gitignore` rule was
   added — deliberately.** **Re-measured: 6 files named `review-*.md` are
   tracked** (an earlier revision said seven; it was counting
   `finance-invoice-spec.md` too). A pattern rule would fight the convention and
   would silently swallow the next artifact someone meant to commit. **The open
   question is whether that convention gets written down as a rule or stays
   custom.** The lesson the deleted `0187-arabic-copy-review.md` earned is about
   the HEADER, not the tracking: a review sheet states the state it was written
   in, and that state expires.
2. **Leaked-password protection is DISABLED in Supabase Auth.** Re-measured off
   the advisor, not carried from the note. Console setting — not a migration, not
   a code change, and Turki's to click.
3. **PUBLIC SIGNUP IS OPEN — the more serious of the two auth settings, and the
   one that actually gates a deploy.** Measured 2026-09-09:
   `"disable_signup": false`. Anyone who registers gets an `authenticated` JWT,
   and 84 of 89 RLS policies are blanket `qual = true` for that role, so the JWT
   is the whole authorization model. Full measurement, the exact read-only curl,
   and the console path to close it are in Deploy readiness. **Item 2 used to
   claim it was the only open security item; it was not, it was the only one
   anybody had measured.**

### (b) Doable FIX — TWO entries, both opened 2026-09-10, BOTH NOW CLOSED

**This section read "EMPTY again" from 2026-09-09 until entry 1 opened it, and
it is effectively EMPTY again as of 2026-09-11.** Entry 1 closed 2026-09-10 on
the pristine replay; entry 2 closed 2026-09-11 as `0fa3969`. Both are kept below
for their mechanism and their lesson, **not as work** — do not reopen either.

1. **CLOSED 2026-09-10 — POST-DEPLOY: THE MIGRATION SET WAS NOT SELF-REBUILDABLE.
   SIX instances, every one measured 2026-09-10, ALL SIX NOW RESOLVED.** Four
   were file edits (`410de67`), two needed applied migrations (`0192`, `0195`).
   The proof is a pristine unattended replay onto a wiped project, RUN on
   2026-09-10: `0001` → `0195`, exit 0, zero manual patches, `test:db` 293/293,
   and a combined 14-category schema fingerprint of
   **`035be37ba5aedeadfcbab76b393cc640` matching production**. **This entry is
   kept for the mechanism and the lesson, not as work.** See "Where this stands"
   at the end of it for the full measurement. Originally measured by replaying
   `0001..0191` onto the throwaway
   `aquafleet-test` project (ref `vlyxazfinmlanjdttavg`). **Production was never
   touched** — every command was host-guarded on
   `db.vlyxazfinmlanjdttavg.supabase.co` with the production ref asserted absent.

   **That first run DID reach 189/189, and THAT was the finding, not a
   reassurance:** it only got there because the ENVIRONMENT was patched four
   times underneath it, and a rebuild nobody is babysitting stopped at the first
   of these. **The 2026-09-10 re-run needed no patch at all** — that is the
   difference the edits bought, and it is what "PROVEN" means in the table.

   | # | Site | What it depends on that the set never creates | Edit |
   |---|---|---|---|
   | 1 | `0111` | operator-entered station prices — `validate constraint water_stations_offers_at_least_one_type` | EDITED `410de67` · PROVEN |
   | 2 | `0150` | asserts 0 anon-executable, but a fresh routine is EXECUTE-to-PUBLIC from Postgres's hardwired `acldefault()`, and `anon` inherits PUBLIC | EDITED `410de67`, in `0083` · PROVEN |
   | 3 | `0152` | hardcoded production row counts: `trips=836 delivered=759 stampable=757 no_project=1 no_driver=1` | EDITED `410de67` · PROVEN |
   | 4 | `0190` | value-preservation guards that refuse a vacuous diff, so they need rows a fresh DB has none of | EDITED `410de67` · PROVEN |
   | 5 | `stock_receipt_approvals` | RLS + policy that exist on production but in NO migration | CLOSED by `0192` · PROVEN |
   | 6 | `create_purchase_order` | a stale 6-arg overload the set creates and never drops | CLOSED by `0195` · PROVEN |

   **The `0111:83` address in an earlier revision of this table is spent** — the
   edit added an UPDATE above the validate, which now sits at `:130`. Grep
   `validate constraint`, never the address (§5).

   **1 — `0111`.** `0110` adds the constraint `not valid`, its own comment saying
   a later migration validates it *"once the UI has been used"*, so `0111`
   depends on prices an operator typed between the two. **Correction to this
   note's first revision, which said "3 of 3 stations NULL":** by the time the
   push resumed, all 3 (`manfuhah_station`, `olaya_filling_point`,
   `umm_al_hamam_station`) read `5.00 / 5.00`, patched out-of-band on the test
   project to unblock it. The ledger proves no migration wrote them. **The
   mechanism is unchanged and the defect stands** — a clean rebuild still has
   NULL-price seed stations and still raises `SQLSTATE 23514`.

   **EDITED `410de67`, in `0111`, and THIS IS THE ONE THAT SEEDS DATA.** The
   ranked principle for this pass was: a data-AWARE guard beats seeding
   placeholder rows, and seed only where no data-aware form exists. There is
   none here — a constraint cannot be validated around rows that violate it.
   So, immediately before the validate: `update public.water_stations set
   fill_cost_non_potable_sar = 0.00 where fill_cost_potable_sar is null and
   fill_cost_non_potable_sar is null;`. Non-potable because it is the type every
   live station actually prices and it makes the SMALLER claim, one type rather
   than both, which is exactly what `0110` was protecting; `0.00` because it is
   a REAL price in this model, not a placeholder — `0110` records that
   company-owned stations fill free and production's `furaian` is genuinely
   `0.00 / 0.00`.
   **The file choice was forced, not preferred.** Seeding in `0014` is not
   executable: the price columns do not exist for another 96 files, `0110` adds
   them. And `0110` must not seed them either — its stated thesis is that
   filling both types from the old flat `fill_cost` would make the database
   assert every station offers both, "which is exactly the thing nobody knows
   yet." That leaves `0111`, which is also the file at fault: it validates a
   constraint whose precondition it neither establishes nor checks.
   **`0111`'s own "0.00 claims the fill was FREE" argument does not bite** —
   that is about TRIPS, and a rebuild has none. The operator corrects prices in
   the stations UI before the first trip; the snapshot freeze does the rest.
   **No-op on production, measured 2026-09-10:** 5 stations — `furaian`
   0.00/0.00, `manfuhah` 5.00/0.00, `olaya` NULL/80.00, `shas` 80.00/50.00,
   `umm_al_hamam` NULL/10.00 — and ZERO with both prices NULL, so the UPDATE
   matches no row there. The constraint is already `convalidated = true`.

   **2 — `0150`, and this is the one that generalises.** Supabase's fresh-project
   bootstrap carries `alter default privileges in schema public grant execute on
   functions to anon`; **the set never revokes it.** So every function the replay
   creates arrives anon-executable — 49 of them — and `0150`'s posture assert
   rolls the migration back. Cleared on test by revoking the default plus the 49
   NON-TRIGGER functions; blanket-revoking would have made trigger functions
   diverge from production and corrupted the very diff this project exists for.

   **EDITED `410de67` — in `0083`, NOT in `0150`.** `0150`'s assertion is
   correct and reports the posture accurately; weakening it to accommodate a
   broken upstream revoke would be the hack. The file whose logic is wrong is
   `0083`, whose loop ran `revoke execute on function %s from public` and whose
   header claims the result is that "anon can no longer call any RPC in this app
   at all". **THAT CLAIM WAS FALSE ON A FRESH PROJECT, AND HAD BEEN SINCE THE
   FILE WAS WRITTEN.** It held on PRODUCTION, which is the only place it was
   ever measured — the file's own header says it was written after the fact
   against the live DB. Two distinct grants make a function anon-executable and
   `0083` removed one: the implicit PUBLIC entry (empty grantee, `=X/postgres`),
   and an EXPLICIT `anon=X/postgres` entry handed out by default privileges at
   CREATE time. `revoke ... from public` does not touch the second.
   **Sharper than this note's first revision, which said the bootstrap "carries
   `alter default privileges ... grant execute on functions to anon`".** The
   mechanism is a default ACL keyed on the CREATING role. Measured on BOTH
   projects 2026-09-10, `pg_default_acl` still shows the fingerprint:
   `postgres`/`public`/`S` STILL grants anon, `postgres`/`public`/`r` no longer
   does (`0161` stripped it), `postgres`/`public`/`f` no longer does (`0192`
   stripped it) — a fresh project granting anon on tables, sequences AND
   functions, stripped file by file since. A separate `supabase_admin`-grantor
   entry for `public`/functions still grants anon on both projects; `0192`
   explicitly could not alter it ("not a member").
   The edit is one word plus a predicate: `from public, anon`, scoped with
   `and p.prorettype <> 'trigger'::regtype`. **Trigger-scoped deliberately** —
   it restates `0192`'s predicate character for character and preserves
   production's END STATE exactly. Measured 2026-09-10: production has precisely
   4 anon-executable functions and all 4 are triggers —
   `record_project_commission_change()`, `record_salary_change()`,
   `set_updated_at()`, `trips_station_offers_water_type()`. Blanket-revoking
   would strip those on a rebuild, the same divergence the manual test-project
   fix already avoided. **No-op on production:** 0 anon-executable NON-TRIGGER
   functions there already, and the revoke is idempotent per the file's own
   comment.

   **3 — `0152`.** Anchors pin production's shape against a fresh DB's zeros.
   Cleared by zeroing the `_0152_anchor` block, pushing, and reverting the file
   in the same turn — blob hash `9673b02e…` identical either side. **It is the
   only remaining file of that shape**; `0153`–`0194` carry none (re-verified
   this turn — `0192`, `0193` and `0194` hold no `_anchor` block and no
   `begin;`/`commit;`).

   **EDITED `410de67`, in `0152`: block (c2) demoted from `raise exception` to
   `raise notice`, counts still printed, drafted figures still named. The
   `_0152_anchor` temp table and blocks (c3), (c4), (f1), (f2) are untouched.**
   Those five numbers were never an invariant — they are a DRAFTING-TIME
   STALENESS TRIPWIRE, and the error text said so itself ("this is DRIFT, NOT A
   DEFECT"). **They were already stale against PRODUCTION, before replay was
   ever a concern:** measured 2026-09-10, prod stands at
   `981 / 904 / 902 / 1 / 1` against the `836 / 759 / 757 / 1 / 1` drafted.
   **NOT replaced with `stampable <= delivered <= total`, and that decision is
   the point of the entry.** All three counts come from one
   `count(*) filter (...)` pass over nested-superset predicates, so the ordering
   holds on `981/904/902`, on `0/0/0` and on a corrupted table alike — it cannot
   fail, which makes it a dead guard rather than a cure for one. Per the user
   memory rule, prove a guard CAN fail before trusting it green. The failable
   guards here are (c3) and (c4), plus (f1) and (f2) in the verification
   section; all four are already scale-free and all four still raise.
   **No-op on production:** the block writes nothing, it is pure assertion, so
   demoting it moves no row. Prod re-measured green on every guard that
   remains — 902 stamped, 0 missed, 0 delivered-with-NULL-commission,
   0 undelivered-with-non-NULL, `sum(commission_sar) = 18,322.84`.

   **4 — `0190`.** Its guards refuse to compare an empty snapshot, correctly:
   *"a zero-row diff would report green"*. Cleared by seeding one customer,
   project, delivered trip and top-up — **a real rate, not a placeholder**, so
   `trip_consumption_sar = 115.00` and the `* 1.15` path `0190` rewrites is
   actually exercised. A customer with no work would have satisfied the guard
   while comparing nothing, which is passing the letter and failing the point.
   **Those rows are still on the test project**; wiping them re-blocks a replay.

   **EDITED `410de67`, in `0190`: both empty-snapshot guards now `raise notice`
   and SKIP the value diff instead of aborting.** What changed is the VERDICT on
   empty, not the guard — the empty case still refuses to report green, it now
   says out loud that it compared nothing. The row-count check and the
   per-column diff are unchanged and moved into the `else` branch; proven by
   normalising whitespace on both sides of the diff, **45 statement lines
   identical**, indentation the only difference.
   **No-op on production, measured 2026-09-10:** 9 customers (8 active), 9 rows
   in `v_customer_prepaid_balance` and 9 in `v_customer_amount_payable`, so
   `v_before = 9` at both guards, the `else` branch is taken, and the guard is
   fully armed wherever there is money.
   **Blocks 5b/5c/5d were never affected and are untouched** — they are
   data-independent, so even on an empty replay `0190` still PROVES the five
   rewritten objects reference `vat_rate()` and carry no bare VAT literal, the
   four EXECUTE grants, and the two view security footers. **That is why the
   seeded test-project rows are no longer load-bearing for the replay** — they
   remain useful for exercising the `* 1.15` path deliberately, which the notice
   branch by definition does not.

   **5 — `stock_receipt_approvals`. NOT hygiene — a SECURITY control that no
   rebuild reproduces.** Production has RLS ON with
   `authenticated_all_stock_receipt_approvals` [ALL, `authenticated`,
   `using(true) check(true)`] (architect-measured). **Five migrations touch the
   table — `0057`, `0058`, `0094`, `0096`, `0172` — and not one enables RLS or
   creates a policy.** The replay lands it with RLS OFF and zero policies, which
   is what the count deltas were: 86 of 87 RLS, 88 policies against production's
   87 and 89. Production is protected by a manual toggle; **a rebuilt environment
   ships that table unprotected.**

   **6 — `create_purchase_order`.** The set creates a 6-arg overload
   `(uuid,uuid,jsonb,date,text,text)` and never drops it. Production carries only
   the 9-arg, the 6-arg having been dropped by hand, so **a replay resurrects an
   orphan overload** that production does not have.

   **What the replay could and could not find, stated so the count is not
   over-read:** 1–4 are where it STOPPED, so they were unavoidable. 5 and 6 came
   from DIFFING the finished result against production — a class the replay
   cannot surface by running, because nothing raises. **An earlier revision here
   warned "the replay stops at the FIRST one, so it cannot have found the later
   ones." That is now spent for 1–4 and still live for 5–6:** six is what two
   methods found, not a proof there is no seventh.

   **NOT a deploy or wipe blocker.** Production's schema is built, and a data wipe
   deletes ROWS while keeping the schema, so nothing re-runs any of these. What
   it costs is **disaster recovery, any new environment, and — for #5 — the
   security posture of the rebuilt one.**

   **WHERE THIS STANDS — READ THIS BEFORE QUOTING ANY OF THE ABOVE AS CLOSED.**

   **Four files edited and committed as `410de67`** (`0083`, `0111`, `0152`,
   `0190`), each ruled on individually by the architect before it was touched,
   each carrying its own in-file record of what changed, that it is a post-hoc
   replay-cleanliness fix, and the measured no-op-on-production proof. Nothing
   was applied to any database; production is not re-run.

   **CLOSED 2026-09-10. THE MIGRATION SET IS SELF-REBUILDING AND BYTE-FAITHFUL TO
   PRODUCTION, PROVEN BY A PRISTINE UNATTENDED REPLAY PLUS A SCHEMA FINGERPRINT
   MATCH.** An earlier revision here said "NONE OF IT IS PROVEN … an edit that
   reasons correctly and a replay that reaches `0194` by itself are different
   claims" — both claims are now measured, not reasoned.

   `npx supabase@latest db reset --db-url "$TEST_DB_URL" --yes` against
   aquafleet-test (ref `vlyxazfinmlanjdttavg`, host gate asserted before the
   destructive command). **192 files applied, `0001` → `0194`, exit 0, UNATTENDED
   — no station-price patch, no anon-revoke, no anchor-zeroing, nothing by
   hand**, and `0195` then applied on top, taking the replay to **`0001` → `0195`
   with ZERO manual patches at any point**. The log holds 197 lines, 192 of them
   `Applying migration`, and zero matching
   `error|fail|fatal|denied|violates|exception|abort`. Ledger read back with
   `migration list`: **192 rows, every one `local == remote`, zero remote-only
   rows**, and the only gaps in `0001–0194` are `0135`/`0136`, which are absent
   from disk by design. The pre-reset ledger's stray remote-only row
   `20260910140204` is gone with the wipe.

   **THE FINGERPRINT — this is the part that makes "byte-faithful" a measurement
   rather than an impression.** A combined 14-category schema fingerprint reads
   **`035be37ba5aedeadfcbab76b393cc640` on BOTH production and the freshly
   replayed aquafleet-test.** The categories: tables · columns · constraints ·
   RLS · policies · indexes · triggers · event triggers · sequences · extensions
   · views · function behaviour · function grants · table grants. **A replay is
   no longer "reaches the end without raising" — it reproduces production.**

   `0195` was applied to production as well, where it is a **no-op** (prod
   already carried exactly one `create_purchase_order`), and to the replay, where
   it dropped the resurrected 6-arg. Both verified.

   **`0164` — the tripwire the gap map said was the ONLY one that could fire —
   applied clean**, which is the specific thing the `0083` edit had to buy.

   **Behaviourally sound, not merely present: `npm run test:db` → 293 assertions,
   0 failures** (confirm-invoice 30, invoice-lifecycle 110, inventory-money 153),
   each harness's row census IDENTICAL before and after, so nothing leaked into a
   schema that was minutes old. `confirm_invoice` case 5 and lifecycle R10/R11/R12
   all confirm **anon is REFUSED** with `permission denied for function …` — the
   §6 invariant holding on a from-scratch build, which is exactly what the `0083`
   edit was for.

   **ONE FINDING, AND IT IS NOT A MIGRATION DEFECT — the harnesses need OPERATOR
   CONFIG that no migration supplies BY DESIGN.** All three hard-code
   `'manfuhah_station', 'potable'`, and on a pristine replay every station comes
   out potable-`NULL` / non-potable-`0.00`, so `0114`'s
   `trips_station_offers_water_type` refuses the fixture with `23514` —
   `Manfuhah Station does not fill potable water.` **That is `0111`'s edit working
   as its own header states**, not failing: `0110` deliberately refuses to price
   the stations because "nobody knows yet" which type each offers, `0111` claims
   only the smaller non-potable `0.00`, and the operator enters real prices in the
   stations UI before the first trip. Confirmed by running `test:db` with
   `manfuhah.fill_cost_potable_sar = 5.00` (production's own value) — 293/293 — 
   then restoring the column to `NULL` and re-reading the census, so the project
   the architect diffs is byte-for-byte the pristine replay. **The fix, if one is
   wanted, is in the HARNESS fixtures or a test-only setup step, never in the
   migration chain.**

   **INSTANCES 5 AND 6 ARE ALSO CLOSED, and by different files than this
   paragraph once predicted.** 5 (`stock_receipt_approvals` RLS + policy) was
   gated by `0192` — grep its notice, `stock_receipt_approvals gated`. 6 (the
   orphan 6-arg `create_purchase_order`) is closed by **`0195`**, which is the
   only one of the six that needed a NEW migration in the end. The fingerprint
   match above is what proves both, since a missing policy or an extra overload
   would move the policies and function-behaviour categories.

   **SO ALL SIX INSTANCES ARE RESOLVED:** `0111` / `0150`-via-`0083` / `0152` /
   `0190` as file edits in `410de67`, then `0192`, `0193`, `0194` and `0195` as
   applied migrations. **Nothing in this entry is open. Do not re-raise it.**

   **`aquafleet-test` is now a CLEAN FROM-SCRATCH SCHEMA built entirely by the
   committed files, and it REMAINS the `test:db` target.** That is a better
   target than it was: it used to be a patched-by-hand descendant of an older
   replay, so a green suite there proved less than it appeared to. It now proves
   the files.

   **A FIFTH BLOCKER OF THE SAME FAMILY, FOUND 2026-09-10 WHILE MAKING THE
   `0083` EDIT. RULED 2026-09-10: (d) NOTHING FURTHER — `410de67` ALREADY CLOSES
   IT, and the clean replay above is the proof.** The description below is kept
   because the MECHANISM is worth knowing and the sub-decision it names is real;
   read it as closed, not as pending work. Two corrections to it are recorded
   after it — the per-file count it quotes is wrong, and so is the cause.
   The `0083` edit
   closes instance 2 for functions that exist AT `0083`. It does NOT revoke the
   fresh-project DEFAULT PRIVILEGES, so every function created AFTER it still
   arrives with an explicit `anon=X/postgres` grant. **`0164` then fails**: it
   carries a SCHEMA-WIDE invariant, not a scoped one — grep
   `non-trigger functions still anon-executable`, which lists every non-trigger
   function in `public` that anon can execute. Measured this turn on the files:
   between `0084` and `0163`, **24 files define functions and only 7 carry a
   live anon revoke** (`0087`, `0089`, `0091`, `0092`, `0093`, `0096`, `0097`);
   `0163` covers three more by name. That leaves fifteen-plus non-trigger
   functions — `0102`'s search set, `0134`, `0139`, `0141`, `0143`, `0146`,
   `0148`, `0150`, `0151`, `0153`, `0157` — anon-executable when `0164` runs.
   **This is why the earlier manual test-project patch revoked THE DEFAULT and
   not merely the 49 functions**, and it is invisible to the replay-stops-first
   method: the replay never reached `0164` unattended.
   **The in-set fix is to move a default-privileges revoke EARLY**, alongside
   the `0083` edit — `alter default privileges in schema public revoke execute
   on functions from anon`, which is exactly what `0192` does at the far end of
   the set. **It carries a live sub-decision and that is why it was left
   alone:** all four of production's legitimately anon-executable TRIGGER
   functions are created after `0083` — `trips_station_offers_water_type`
   (`0114`), `record_salary_change` (`0125`),
   `record_project_commission_change` (`0147`), and `set_updated_at` is
   re-stated from `0157` onward. Revoking the default early denies them the
   anon grant they hold on production, so the rebuild would diverge from prod's
   end state on four trigger functions. Harmless in security terms, visible in
   a diff.

   **TWO CORRECTIONS TO THE PARAGRAPH ABOVE, both measured 2026-09-10.**

   1. **"24 files define functions and only 7 carry a live anon revoke" is a
      per-FILE presence count and it UNDERCOUNTS BADLY. Do not quote it.**
      Per-FUNCTION, every non-trigger function created in the `0084`–`0192`
      window IS individually revoked — `0102` carries `from public, anon` on all
      three `search_*` functions, and the rest follow. A static replay of all 307
      create/drop/revoke events across the 192 files, with the `0083` edit in
      place, puts **3** functions anon-executable at `0164` and all three are
      revoked by `0164` itself, then **0** at `0192` and **0** at `0194`, ending
      on exactly production's four trigger functions BY NAME. The live replay
      then confirmed it: `0164` applied without raising.
   2. **The CAUSE stated in `0193`'s header and repeated above — "`supabase_admin`'s
      default privileges re-grant anon" — is WRONG, though the conclusion it
      supports is right.** Canary on aquafleet-test: after
      `alter default privileges in schema public revoke execute on functions from
      anon`, a fresh routine still came back anon-executable with
      `acl={=X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`.
      The offender is the **`=X/postgres` EMPTY-grantee entry, i.e. PUBLIC**,
      handed out by Postgres's hardwired `acldefault()` for functions, which
      always includes `EXECUTE TO PUBLIC`. `supabase_admin` cannot be the source:
      `pg_default_acl` keys on the OWNER role and does not expand role
      membership, and all of production's functions are owned by `postgres`.

   **A `0195` WAS AVAILABLE AND WAS DECLINED — do not draft it.** The hardening
   is `alter default privileges in schema public revoke execute on functions from
   PUBLIC` (note **PUBLIC**, not `anon` — `0192` already did `anon`, and per
   correction 2 that is the wrong grantee for this class). Declined by the
   architect 2026-09-10 on two grounds: it is a **real production change** for a
   class `0193`'s event trigger already handles at **0** non-trigger
   anon-executable functions, and the replay proof above shows the chain needs
   nothing further to reach `0194`. **Recorded as available-but-declined future
   hardening only.** If it is ever revived: it is untested, it would deny the
   four legitimate TRIGGER functions the anon grant they hold on production, and
   `0150`/`0151`/`0153` pin exact `proacl` strings that an early default-revoke
   would break — the same objection that killed the "early event trigger" option.

   **Instances 5 and 6 are CLOSED — an earlier revision here called them
   "untouched" and that is spent.** 5, the RLS + policy on
   `stock_receipt_approvals`, was gated by `0192`. 6, the orphan 6-arg
   `create_purchase_order`, was dropped by `0195` — the one instance of the six
   that ended up needing a NEW migration. Both are covered by the fingerprint
   match recorded above. **"Deferred by Turki 2026-09-10" no longer applies to
   either.**

2. **`CLAUDE.md` §6 CORRECTION — CLOSED 2026-09-11 as `0fa3969`, compression
   pass 6. Opened 2026-09-10. The RULE was right, the MECHANISM it stated was
   wrong, and it turned out to be wrong TWICE.**

   §6 said **"A REDEFINED FUNCTION IS EXECUTE-TO-PUBLIC AGAIN"** and gave the
   mechanism as `create or replace function` **and** `drop`+`create` both
   resetting the ACL to the Postgres default. **`create or replace function`
   does NOT reset `proacl`. It preserves it.** `drop`+`create` does reset,
   because that is a new object with a new OID — the two halves of that sentence
   do not behave the same way and the rule stated them as one. The bullet now
   reads **"EVERY FUNCTION DEFINITION CARRIES ITS OWN REVOKE — AND ONLY ONE FORM
   STRIPS THE ACL."**

   **Measured, not reasoned.** `0150` replaces `update_project_with_customer`
   with `create or replace function` and its assertion (3) compares the ACL
   captured BEFORE the replacement against the ACL after, with
   `is distinct from`. **Production passed that assertion**, and its ACL there
   reads `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`
   — non-null, no PUBLIC entry, no anon. An ACL that had been reset to the
   default would have been null-or-PUBLIC and the assertion would have raised.
   **THE SECOND ERROR, found only when the edit was actually made 2026-09-11:
   `0118` is not a replacement at all.** `0118:208` is
   `drop function if exists public.issue_driver_payslip(uuid, date, text);`
   followed by a create — a `drop`+`create`, the one form that DOES reset. So
   the cited incident could not demonstrate the claim it was cited for either
   way. And it did not need to: `grep -ciE 'revoke +execute|revoke +all +on
   +function'` over `0115` and `0118` returns **0**. Neither file ever carried a
   function revoke. `0115` created `issue_driver_payslip` AFTER `0083`'s sweep,
   so nothing ever gave it one, and `0118` added none — the RPC was
   anon-executable because it was never revoked, not because a redefinition
   stripped it.

   **DO NOT weaken the rule on the strength of this.** Re-revoking is
   safe-directional and free, naming both `public` and `anon` is still correct
   and still required, and the security footers plus `0193`'s event trigger hold
   the invariant regardless of which mechanism is true. **What was wrong is the
   stated REASON, and a rule whose reason is wrong is one someone eventually
   argues their way out of.** That was the whole cost — an incident it never
   was. The rewritten bullet keeps every instruction it had, including the
   `revoke execute` naming **both `public` and `anon`**, and swaps only the why.

   **TWO FURTHER FINDINGS FROM THE SAME PASS, both landed in `0fa3969`.**

   1. **§7's State line was stale at `0194`; it now reads `0195`.** Cite it by
      grep, never by address: `npx tsx scripts/code-grep.ts 'DB at migration'
      CLAUDE.md --worktree`.
   2. **§5's `divide-` example was imprecise and would have read as a
      regression.** It claimed the `divide-` grep "has exactly one hit and it is
      a comment". Measured 2026-09-11: the plain grep returns **9 hits, all live
      code, all correctly carrying `divide-[rgb(var(--border))]`**. It is the
      BUG pattern — `divide-y`/`divide-x` on a line lacking that colour — that
      has exactly one hit, and that hit is still the comment in
      `components/settings/WarehousesSection.tsx` documenting the fix. Reworded
      to name the bug pattern, so the next session greps for the right thing.

   **SIZE: 14,796 → 14,671 bytes** against §7's 15 KB trigger; 102 insertions,
   103 deletions. The corrected rule COST about 250 bytes, paid for by
   tightening wording across the header, sections 1–4 and nine bullets — **no
   rule and no reason was removed**, which is the §5 requirement. Headroom is
   now thin, so **the next real reduction means MOVING a rule to the domain
   skill, not trimming**; that is a routing decision for Turki or the architect.

   **Everything else in `CLAUDE.md` was re-measured and HELD**, including 147 of
   the 170 files up to `0172` carrying `begin;`/`commit;` and **zero** files
   from `0173` on, the 11-file `preview/` list, `selfTest()` running at import in
   `scripts/code-grep.ts` with exactly two `test:money` checks importing it, and
   `0161`'s default privileges being tables-only.

   **Pass 5 (2026-09-09) found zero stale claims and concluded the file had
   converged. Pass 6 found three. Read "converged" as a measurement of one
   pass, never as licence to skip the next audit** — that sentence is now in
   `CLAUDE.md` §5 itself.

**Both 2026-09-09 entries are CLOSED. Kept below so they are not reopened.**

**The `CLAUDE.md` stub entry opened and closed the same day.** `0189` was applied
through MCP and committed as `e147373`, leaving §7 reading `0188`; the pair was
left disagreeing **in writing** while the ask was scoped to HANDOFF, then bumped
in **`876bc0b`** — catalog re-measured first, not taken off this note. The
durable half is in Database above: an MCP-applied migration leaves nothing in git
to signal the stub aged, so the split has to be written down or it is invisible.
**Cite that line by grep, never by address** — it has moved twice (`:251` →
`:239`): `npx tsx scripts/code-grep.ts 'DB at migration' CLAUDE.md --worktree`.

**The OTHER entry, filed earlier the same day, closed as `ffef697`.**
`@types/node` was pinned at `20.14.10` while `engines` pinned Node `24.x`, so the
code typechecked against a Node 20 surface and ran on 24. Now `24.13.3`, exact,
matching how `typescript` and the react types are already pinned. **Not the
absolute latest, `26.5.0`** — that types Node 26 and would recreate the same
mismatch pointing the other way. **The types major tracks the RUNTIME major, not
npm's `latest` tag.** `package-lock.json` picked up the `engines` block in the
same commit: `4e3eca0` had edited `package.json` without regenerating the lock,
so the two had been out of step in between.

**A types bump can break the compiler that consumes it, so it was verified, not
assumed:** `tsc --noEmit` clean under the existing `typescript` `5.5.3`, both
suites exit 0, and a real production build exits 0 — run through
`./scripts/safe-build.sh --dist-dir` because `next dev` was live on 3002, with
`tsconfig.json` restored by the script's trap and `git diff` on it empty.

**The four ORIGINAL entries closed in the parked-items session as `c17b7f8`.**
For the record, what they were and what measurement showed:

- **Two comments called `consume_from_lots` callerless.** Both were wrong. **Four
  RPCs reach it inside the database** — `start_work_order` and
  `complete_work_order` via `deduct_work_order_parts`, `edit_work_order` via
  `consume_work_order_line`, `confirm_exit_permit` via `consume_exit_permit_line`.
  **The trap that let the claim survive:** `code-grep 'consume_from_lots' app lib
  components` exits 0, because the TS layer never names the function — it calls
  an RPC that calls it. **A clean code-grep there is evidence about the TS layer
  only; the call chain is in SQL.** Both comments now name the chain and say so.
- **The "NOT built (flagged…)" list was DELETED, not rewritten.** Checked entry
  by entry as the note demanded: every feature on it — Purchase Orders, the
  Approvals tab, Financial Analysis, AI-suggest-PO, receipt photo upload, the
  per-part Financial Report — is built and live. **Deleting a TRUE "not built"
  note is how a gap goes invisible, so the item-by-item check was the whole
  job**; it just happened to come back all-built.
- **`lib/actions/search.ts:12` pointed at "HANDOFF.md §6", which does not exist**
  and never will — this file has no numbered sections. It now states the fact it
  meant: no role gate exists, so RLS alone scopes the result set.

### (c) FORWARD-ONLY — nothing to do, no owner, not defects

3. **There is NO role gate anywhere in the app.** Three live sites say so:
    `app/trips/actions.ts:1444`, `app/archive/actions.ts:815` (*"With no role
    gate yet this is attribution, not authorisation"*), and
    `components/settings/ProfileSection.tsx:41` (leave-history display deferred
    to RBAC). `SKILL.md`'s locked decision 4 adds *"RBAC on add-a-type:
    deferred — any authenticated user can add one today."* **Every `actor` /
    `entered_by` / `created_by` column in this app is an AUDIT TRAIL, not a
    permission check.** Do not mistake one for the other.
4. **The Coming-Soon trio is fenced off on purpose**: `/routes`, `/predictive`,
    `/iot` (`lib/nav.ts:77-79`, rendered under a labelled `<nav>` in
    `components/AppShell.tsx:495`). `FleetDetailClient.tsx:511` and `:586` render
    two honest-empty cards against the same two. Route Optimization has a
    `preview/map.js` spec waiting.
5. **The payslip's commission-period caption stays English, and there is
    nothing to translate it FROM.** `app/reports/StatementViews.tsx:2819-2833`.
    `pay_commission` wrote the caption into `commission_payouts`, issuing the
    payslip copied it into `driver_payslips.snapshot`, and **the frozen entries
    carry no `monthKey`** — measured: `id, paid_at, period_label, base_sar,
    specials_sar, adjustments_sar, bonus_sar, total_sar`. Joining `id` back to
    the live table would both re-derive a frozen document from mutable data and,
    on this data, recover nothing. **Forward-only by DATA, not by preference.**

### Decided exceptions — recorded so they are not reopened as bugs

6. **`app/drivers/HistoryTab.tsx:322-334` — `period_label` stays English,
    DELIBERATELY.** Two independent sufficient reasons, both in-code: it is
    FROZEN TEXT written at pay time (the column stores words, not a key), and
    **it is not the month above it** — the line above is the month the run
    SETTLED, this is the payout RUN's caption, and the two legitimately come
    apart. Deriving it from `snap.monthKey` would print one fact twice and
    delete the one this line exists to show. **This is the one label the Arabic
    month sweep left alone on purpose. Do not reopen it.**

7. **The applied `confirm_invoice` carries a differently-wrapped COMMENT block
    than `0191` on disk, and it is STAYING that way.** 950 chars / 12 lines of
    prose inside the `TOTALS ASSERTIONS (0191)` header, nothing else — the
    comment-stripped bodies are byte-identical (`159 lines / 8,259 chars /
    a0750ba5c2aec1cda607efcfe110bda3`). **Redefining a money RPC to reflow a
    comment is not a fix**; `create or replace function` would also reset the ACL
    (`CLAUDE.md` §6), so the change with zero behavioural upside carries the
    session's only real security footgun. Full working in Database above. **Do
    not open this as "the migration file does not match the database".**

### Closed BY MEASUREMENT during this scan — do not relist as open

**Closed 2026-09-09 — the four parked items. Each has a commit; do not reopen:**

- **The Arabic week-header comma** — `70725bc`. It was ruled a change, not left
  as a choice: `MaintenanceCalendar.tsx:195` now sets the separator from `lang`,
  `،` (U+060C) in Arabic and `,` in English. **English is byte-identical.**
- **The four Inventory modal sizes** — `3519f3a`, and only ONE of the four was a
  real divergence. New Supplier went `max-w-md` → `max-w-[880px]`, the literal
  pulled from `preview/app.css`'s `.modal-shell`. **The other three were not
  skipped, they were measured and found not to exist as divergences:** Create
  Warehouse is not here at all (that form is Settings' `WarehousesSection`),
  there is no update-market-price surface in this app, and Adjust Stock has no
  `preview/` counterpart to match. **A parked note can name surfaces that do not
  exist — check the surface before checking its width.**
- **`drivers.active` dropped** — `7c45ac8` + migration `0188`, **completed by
  `32a515d` and `e4dbd3e`.** All 16 rows were `active = true`, so **no live row
  could distinguish `active` from `terminated_at`** — which is exactly why the
  harness (`scripts/drivers-active-restore-check.sql`) carries two NEGATIVE
  CONTROLS asserting a terminated driver is still refused restore. Without them a
  green run proves the block executed, not that it still discriminates.
  **Closed, but NOT clean:** the TS sweep missed `app/archive/page.tsx`, so
  `/archive` returned `42703` and rendered its error state until `32a515d`. The
  harness was green throughout and was right to be — it tests the RPC restore
  guard, which never broke. **A passing harness scopes to what it exercises; it
  said nothing about the read path, and nothing about it should have been read as
  saying the drop was complete.**
- **The four stale comments** — `c17b7f8`. See the (b) record above.
- **The map's English city labels** — ruled, not pending. `lib/i18n.ts` now reads
  as the ruling rather than as an open question. They are `CITIES` **data**, not
  copy. The corner disclaimer stays translated, deliberately.

**Closed earlier:**

- **The statement's migration onto `lib/plainDocStyles.ts` is DONE.** The
  previous handoff carried it as a forward pointer ("THE STATEMENT INHERITS
  `lib/plainDocStyles.ts` NEXT") and claimed `app/globals.css` still held
  `#statement-print`. **Both are false today**: `lib/statementPdfTemplate.ts:35`
  imports `plainDocShell`, and `app/globals.css:612-637` is a comment recording
  the removal of `#statement-print` / `body.printing-statement` /
  `.statement-print-portal`. Only `#breakdown-print` and `#po-print` remain on
  the portal pattern.
- **The three anon-executable SECURITY DEFINER advisor warnings** — all trigger
  functions, invariant holds. See Current state.
- **`scripts/code-grep.ts`'s directory false-pass** — fixed in `8dea137`.
- **The understated-docs / debit-note item** — Turki ruled it test data.
- **The cleanup sweep's two held-back items** — both ruled and shipped the same
  session as `4172e4e` and `5ffa9cb`. **No browser pass is owed on either.**

---

## Forward agenda, in order

**DEPLOY GATES OUTRANK EVERYTHING NUMBERED BELOW, and they are not code.** The
ordered MUST list lives in Deploy readiness: decide what happens to the sandbox
data woven into paid records, **CLOSE PUBLIC SIGNUP — measured open 2026-09-09,
no longer a question**, and turn on leaked-password protection. **Every code-side gate is already green**, so nothing
in items 1–4 blocks a deploy and none of them unblocks one either. Do not start
item 2, 3 or 4 expecting it to move the deploy date.

### 0. DONE — the parked inventory is clear

**Nothing is parked.** The four items ran to commits on 2026-09-09, a follow-up
sweep closed the one that had leaked a live defect (`32a515d`, `e4dbd3e`), and of
the three survivors in (a), two are console clicks and the third is a convention
to write down or not — none is work. **Agenda 2 and 3 are now unblocked** — the
reason this section used to say "do not start on top of an unresolved parked
list" was to avoid another 1301-line handoff, and that risk is spent.

**THE DB-HARNESS BATCH IS CLOSED AT THREE PASSES, AND THE COVERAGE IS 10 OF 65.**
Re-measured this turn: `public` holds **65 non-trigger functions**, and the three
harnesses drive **ten** of them — `confirm_invoice`, `pay_invoice`,
`unpay_invoice`, `void_invoice`, `start_work_order`, `deduct_work_order_parts`,
`consume_work_order_line`, `consume_from_lots`, `add_price_lot`,
`return_customer_balance`. **Read 293 assertions as deep, not broad.** The ones
worth a pass 4, in the order they would earn it: **`issue_driver_payslip`** (the
definer money RPC that was anon-callable until `0163`), the **reverse stock
path** — `return_to_lots`, `receive_purchase_order`, `reject_stock_receipt` —
which puts cost back and is the mirror of everything pass 3 proved, and the
**reserve-at-draft chain** `create_draft_invoice` / `sync_draft_reservation` /
`discard_invoice`. **None is started and none is owed** — this is a menu, not a
backlog. The pattern to copy is in `scripts/db/harness.ts`; do not write a fourth
copy of the target guard.

**THE TIMEZONE WORK IS DONE IN ALL THREE PARTS, and none is on this list any
more.** `e147373` applied+verified `0189` in the DB, `00cfb9e` moved the app off
the host clock, `876bc0b` bumped the `CLAUDE.md` stub the first two left stale.
**Nothing about dates is owed.**

**Both 2026-09-09 (b) entries opened and closed the same day** — `ffef697` (the
`@types/node` / `engines` alignment) and `876bc0b` (the stub). **(b) is empty
again**, and this time the sentence is measured rather than inherited.

**`/archive` has not been confirmed in-browser since `32a515d`.** The page is
auth-gated, so the fix was proven at the query layer — the corrected select runs
and returns 16 rows, 11 live and 5 terminated — but nobody has watched it render.
It was fully broken before, so the change can only improve it; **verify it once
before treating this line as closed.**

### 1. The three remaining (a) items — Turki only, no analysis owed

Whether the `.planning/review-*.md` convention becomes a written rule, the
Supabase Auth leaked-password toggle, and **closing public signup**. **None is
code.** The `CLAUDE.md` stub chore that used to sit beside them **reopened when
`0189` landed and closed the same day as `876bc0b`** — it never belonged here
anyway, since nobody had to decide anything; see (b). Do not count it as a fourth
(a) item, and do not re-open it from a note that predates the bump.

**The leaked-password toggle is now on the deploy path, not just the open list.**
It is one of two console settings a deploy waits on; the other is public signup,
**which was measured OPEN on 2026-09-09 and must be closed**. See Deploy
readiness.

### 2. Analysis — Paid-up Balance vs Amount Payable

**Now that the Invoice tab has been improved, the two balance figures beside
each other need explaining, and possibly improving.** This is ANALYSIS FIRST,
not a change. **Ground it in the two files that already own this math and do NOT
reinvent either:**

- **`app/trips/amountPayable.ts`** (190 lines). `computeAmountPayable` at `:163`
  returns `derivedBalanceItems([], unsettledTrips, unsettledCharges)` — the
  **credits side is EMPTY by construction**, which is what makes "adding balance
  does not reduce it" true structurally rather than by discipline. `:145-146`
  hold the single settled predicate (`isUnsettledTrip` / `isUnsettledCharge`);
  **never restate that predicate anywhere else.** `:180-187` explain why there
  is no returns term: a refund moves the POOL, not the WORK, so netting it here
  would shrink a debt because we handed money back.
- **`lib/prepaid.ts`** (804 lines). `paidUpCore` is `round2(credits − debits −
  returned)` over topups, settled items and balance returns; `paidUpBalance`
  (`:534`) is the LIVE figure that draft/review/confirmed-unpaid invoices show,
  and `paidUpBalanceAsOf` (`:552`) is the FROZEN one a paid or void invoice
  shows. **The undated input type is the enforcement mechanism** — a caller that
  cannot say when each item settled is structurally unable to ask the as-of
  question, so it cannot produce a half-gated figure.

**READ `SKILL.md`'s "Amount Payable ≠ the prepaid BALANCE — and the view ≠ the
column" BEFORE touching anything.** Three numbers here look like one and two are
deliberately allowed to disagree. In particular
`v_customer_amount_payable.amount_payable_sar` is the **running balance** for
prepaid, NOT the column's rule, and **that divergence is load-bearing**:
`return_customer_balance()` gates a real cash refund on it. Flip the view to the
column's rule and the RPC pays a customer their own debt. **The analysis may
recommend changes to the COLUMN or the UI; it must not "reconcile" the view.**
Changing either rule means changing `scripts/amount-payable-check.ts` first.

### 3. Printable-report quality for everything still pending

**Invoices and statements are DONE** — both print as their own documents through
`lib/plainDocStyles.ts`, off the same view-model their download path uses.
**Everything else still prints the live React DOM through
`app/globals.css`'s visibility whitelist**, which inherits screen styling and is
where the clipped-column and blank-sheet failures came from. The pending set,
measured today:

- **Every Reports-page report** — `revenue`, `receivables`, `cost`, `ops`,
  `narrative`, `custom`, `payslips`, `commission-review` (all in
  `app/reports/StatementViews.tsx`), `pnl` (`StatementsTab.tsx:634`, the one
  print id that wraps TWO cards) and `daily-trips` (`DailyTripsTab.tsx:331`).
- **Inventory Purchase Orders** — `#po-print` (`PurchaseOrders.tsx:1335`), still
  on the portal/marker pattern with its own independent id/class/marker set.
- **Consumption Exit Permits** — `#permit-print`
  (`app/consumption/ExitPermitModals.tsx:1214`).
- **Part details — a NEW clean print, mirroring its view.** There is no print
  surface for it at all today: `app/inventory/` contains no `*-print` id outside
  `PurchaseOrders.tsx`. This one is a build, not a migration.
- Also still on the old model, not named in the request but adjacent:
  `#breakdown-print` (`app/trips/BreakdownReport.tsx:632`) and `#history-print`
  (`app/drivers/HistoryTab.tsx:307`).

**Two line numbers in this section and one below it MOVED on 2026-09-09** —
`00cfb9e` edited `BreakdownReport.tsx`, so `#breakdown-print` went `:624` → `:632`
(re-measured this turn). **A commit that touches none of the print surfaces still
invalidates every line number in a file it touches.** Grep the id, not the
address.

**Before removing any id from the whitelist, check what its owner does with
Ctrl/Cmd+P** — a subtree that leaves the whitelist without an intercept prints a
blank sheet, and that failure reads like the printer's fault.

### 4. RBAC / role-gate OPTIONS — requested, and nothing exists to review

**Turki asked (2026-09-09) for role-gate options to be worked up after the
deploy-prep and data work.** Producing them IS the task: **no design exists —
nothing proposed, nothing compared, nothing chosen, and nothing on disk.**
`grep -rl "RBAC\|role gate" .planning/` returns this file only, and what it
holds is (c)3's record of the ABSENCE, not a candidate scheme. Deliver options
to choose between, not a built gate; the choice is Turki's. Read (c)3 first for
the state being designed against, and do not restate it here.

---

## Standing rules — pointers only, do not restate them here

- **`CLAUDE.md`** is the rules file. Read it first, every session. Do not append
  to it; if a state-looking line appears there, it is a bug.
- **`.claude/skills/aquafleet-domain/SKILL.md`** holds the domain law: the
  money-core boundary, Amount Payable vs the balance vs the view, `asOfDate`
  scopes consumption never the pool, the FIFO invariant, the guarded-write
  read-back rule, counter-table numbering, bank accounts, violations.
  **Read it before any migration, RPC or server-action work.**
- **Money gate:** salary / rates / commission / invoice / balance → draft, STOP,
  the architect reviews. And run `npm run test:money`.
- **Migration gate:** Code drafts → STOPS → the architect reviews and applies.
- **Explicit-path `git add`; inspect the STAGED blob with `git show :<path>`.**
- **Turki verifies in-browser before every commit.**
- **No feature is queued. Ask Turki for the next one rather than picking.**
