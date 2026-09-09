# SESSION HANDOFF

**Updated 2026-09-09 (SECOND session that day — deploy-prep; the parked-items
close-out earlier the same day is the section below it), every figure re-measured
this turn.** Rewritten fresh at `2318055` on 2026-09-08 from a 1301-line predecessor;
**nothing was lost, it is `e93baec:.planning/HANDOFF.md`, and every unit's
reasoning lives in its own commit message**, which is where `CLAUDE.md` §5 says
detail belongs. This file is STATE — what is true now, what is open, and what
comes next. Rules are in `CLAUDE.md`; domain law is in
`.claude/skills/aquafleet-domain/SKILL.md`.

**The parked list is now CLEAR.** All four numbered items ran to a commit this
session, and the six (a) DECISION entries are down to two, both of which are
Turki's to click rather than anyone's to code. See Open items.

**One of the four did not land cleanly.** Item 3's `drivers.active` drop missed a
seventh file and took the Archive page down with `42703` until a follow-up sweep
caught it (`32a515d`, `e4dbd3e`). **A commit closing a parked item is not
evidence the item is finished** — the sweep that found this ran only because it
was asked for, and `tsc` had been green the whole time.

**THE DEPLOY BLOCKER IS DATA, NOT CODE.** A read-only audit ran the whole gate —
types, a production build, both suites, the view footer, the function ACLs, RLS,
the env surface — and every code-side check is green. What is not ready is the
live database: it is a sandbox, and test rows are woven into records that are
already PAID. **Do not read "audit passed" as "ship it".** See Deploy readiness.

**Every number below is a POINTER, not evidence. Re-measure before quoting it.**
The commands are given inline so re-measuring is cheaper than trusting.

---

## Current state

### Git

- **`main` is at `ffef697`.** Measured with `git rev-parse HEAD`.
- **Level with origin, measured BOTH required ways**: the BRANCH line of
  `git status -sb` reads `## main...origin/main` with no ahead/behind marker,
  and `git rev-list --left-right --count origin/main...HEAD` returns `0	0`.
  **Never read sync off the TREE lines** — a dirty tree says nothing about
  ahead/behind, and a clean one does not mean pushed.
- **This bullet cannot name its own commit's hash and goes stale the moment
  anyone commits.** It has rotted five times by naming a hash late. Measure.

### Database

- **Files on disk run through `0188`; 186 `.sql` files** (`ls
  supabase/migrations/*.sql | wc -l`). The gap between 186 and 188 is historical
  numbering, not a missing file.
- **The two files AGREE again: `CLAUDE.md:251` now reads "DB at migration
  0188".** Re-measured with `grep -n "DB at migration" CLAUDE.md`, not carried
  from the note — the previous revision of this bullet said the stub was one
  behind at `0187`, and that had already been fixed by the time it was read. The
  bullet was the stale thing, not the stub. **This is the pairing rule working as
  intended: it was recorded openly, so the next reader checked it.**
- **`0185`–`0188` were applied through MCP or the SQL Editor, and NEITHER PATH
  WRITES A `schema_migrations` LEDGER ROW.** The ledger's max version lags
  permanently and always will — see `CLAUDE.md` §7. **Do not read the migration
  level out of `schema_migrations`.** The record is the files on disk plus the
  objects in the catalog. All four re-verified against the catalog this turn:
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
  - **Do not re-apply any of the four.**
- **View security footer holds: 50 views, 50 `security_invoker=true`, 0 readable
  by `anon`.** `CLAUDE.md` §6's counts MATCHING is the check, not the number.
- **`CLAUDE.md` §7's stub carries the migration number too, so the two files go
  stale together.** When the DB moves, change it in both places or leave the
  pair openly disagreeing — never silently.

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

**The largest UNVERIFIED risk is public signup.** With no role gate anywhere in
the app (see (c)3), an open signup would expose the 49 SECURITY DEFINER money
RPCs that are granted to `authenticated` on purpose. **It was not tested, because
testing it means creating an account.** Someone must check the Supabase Auth
console setting directly.

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

## Completed this session (2026-09-09, deploy-prep, `e4dbd3e` → `ffef697`)

**Two read-only investigations that produced NO commits, then six commits.** The
audit and the Edge-runtime trace were both explicitly measure-only; their findings
are in Deploy readiness above, and neither was allowed to turn into a fix in the
same pass.

| Hash | What |
| --- | --- |
| `61cc581` | Repointed the three dangling `"HANDOFF.md §N"` references — `next.config.js:9` and `scripts/safe-build.sh` twice. |
| `4e3eca0` | Pinned `engines.node` to `"24.x"`. There was no `engines` field at all, so Vercel would have taken whatever the project setting happened to be, invisibly from the repo. |
| `9b99a98` | Wired `scripts/notification-format-check.ts` into `test:copy`. It ran in no suite. |
| `58c1589` | Added the constructed `leave_return` fixture, closing that harness at 11 of 11 alert kinds. 22 assertions to 26. |
| `eaba090` | This file: recorded the session, and corrected three claims it measured as stale. |
| `ffef697` | Aligned `@types/node` to `24.13.3` with the `24.x` engines pin, and reconciled `package-lock.json`, which `4e3eca0` had left behind. |

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

**It is now as fresh as `58c1589` and no fresher.** The audit was READ-ONLY by
instruction, so it re-derived and classified but changed nothing — the four
commits that day came from a separate, explicitly scoped pass.

### (a) DECISION for Turki — do not "fix" these, they are choices

**Four of the original six closed in the parked-items session.** They are listed under "Closed
BY MEASUREMENT" below with their hashes, so they are not resurrected. Two remain,
and **neither is code** — both are Turki clicking something.

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
   a code change. **This is the only genuinely open item on the security
   posture**, and it is Turki's to click.

### (b) Doable FIX — EMPTY again

**The one entry filed on 2026-09-09 closed the same day as `ffef697`.**
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
    `app/trips/actions.ts:1444`, `app/archive/actions.ts:809` (*"With no role
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

### Closed BY MEASUREMENT during this scan — do not relist as open

**Closed 2026-09-09 — the four parked items. Each has a commit; do not reopen:**

- **The Arabic week-header comma** — `70725bc`. It was ruled a change, not left
  as a choice: `MaintenanceCalendar.tsx:176` now sets the separator from `lang`,
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
data woven into paid records, confirm whether public signup is open, and turn on
leaked-password protection. **Every code-side gate is already green**, so nothing
in items 1–3 blocks a deploy and none of them unblocks one either. Do not start
item 2 or 3 expecting it to move the deploy date.

### 0. DONE — the parked inventory is clear

**Nothing is parked.** The four items ran to commits on 2026-09-09, a follow-up
sweep closed the one that had leaked a live defect (`32a515d`, `e4dbd3e`), and
the two survivors in (a) are console clicks, not work. **Agenda 2 and 3 are now
unblocked** — the reason this section used to say "do not start on top of an
unresolved parked list" was to avoid another 1301-line handoff, and that risk is
spent.

**The deploy-prep pass opened one small (b) item and closed it the same day**
(`ffef697`, the `@types/node` / `engines` alignment). (b) is empty again.

**`/archive` has not been confirmed in-browser since `32a515d`.** The page is
auth-gated, so the fix was proven at the query layer — the corrected select runs
and returns 16 rows, 11 live and 5 terminated — but nobody has watched it render.
It was fully broken before, so the change can only improve it; **verify it once
before treating this line as closed.**

### 1. The two remaining (a) items — Turki only, no analysis owed

Whether the `.planning/review-*.md` convention becomes a written rule, and the
Supabase Auth leaked-password toggle. **Neither is code.** The `CLAUDE.md` chore
that used to sit beside them is DONE — `CLAUDE.md:251` reads `0188`, matching the
DB; re-measured, see Database above.

**The leaked-password toggle is now on the deploy path, not just the open list.**
It is one of two console settings a deploy waits on; the other is whether public
signup is open. See Deploy readiness.

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
  `#breakdown-print` (`app/trips/BreakdownReport.tsx:624`) and `#history-print`
  (`app/drivers/HistoryTab.tsx:307`).

**Before removing any id from the whitelist, check what its owner does with
Ctrl/Cmd+P** — a subtree that leaves the whitelist without an intercept prints a
blank sheet, and that failure reads like the printer's fault.

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
