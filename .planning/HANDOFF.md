# SESSION HANDOFF

**Rewritten fresh 2026-09-08 (evening close-out), every figure re-measured this
turn.** The previous revision had grown to 1301 lines of accumulated session
history. **Nothing was lost: it is `e93baec:.planning/HANDOFF.md`, and every
unit's reasoning lives in its own commit message**, which is where `CLAUDE.md`
§5 says detail belongs. This file is STATE — what is true now, what is open, and
what comes next. Rules are in `CLAUDE.md`; domain law is in
`.claude/skills/aquafleet-domain/SKILL.md`.

**Every number below is a POINTER, not evidence. Re-measure before quoting it.**
The commands are given inline so re-measuring is cheaper than trusting.

---

## Current state

### Git

- **`main` is at `e93baec`.** Measured with `git rev-parse HEAD`.
- **Level with origin, measured BOTH required ways**: the BRANCH line of
  `git status -sb` reads `## main...origin/main` with no ahead/behind marker,
  and `git rev-list --left-right --count origin/main...HEAD` returns `0	0`.
  **Never read sync off the TREE lines** — a dirty tree says nothing about
  ahead/behind, and a clean one does not mean pushed.
- **This bullet cannot name its own commit's hash and goes stale the moment
  anyone commits.** It has rotted five times by naming a hash late. Measure.

### Database

- **Files on disk run through `0187`; 185 `.sql` files** (`ls
  supabase/migrations/*.sql | wc -l`). The gap between 185 and 187 is historical
  numbering, not a missing file.
- **`0185`, `0186` and `0187` were applied through MCP or the SQL Editor, and
  NEITHER PATH WRITES A `schema_migrations` LEDGER ROW.** The ledger's max
  version lags permanently and always will — see `CLAUDE.md` §7. **Do not read
  the migration level out of `schema_migrations`.** The record is the files on
  disk plus the objects in the catalog. All three re-verified against the
  catalog this turn:
  - **`0185_within_month_collection_rate.sql`** — `settled_same_month_revenue_sar`
    is present on **both** `v_revenue_monthly` and `v_pnl_monthly`
    (`information_schema.columns`). Applied.
  - **`0186_collections_settlement_basis.sql`** — `report_metrics.basis` exists;
    **4 rows carry `basis = 'settlement'`**. Applied.
  - **`0187_report_metrics_balance_terms.sql`** — `report_metrics` holds **33
    rows**, **3** of them `paid_up_balance` / `running_balance` /
    `amount_payable`. Applied. **Do not re-apply any of the three.**
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
  this session's most transferable finding — see Completed, `5ffa9cb`.

### Harnesses

- **`npm run test:money` — GREEN, 14 harnesses, ~10.5s end to end.** It is a
  shell `for` loop, so counting `&&` returns 1 and is wrong. Read the list:
  ```sh
  node -e "console.log(require('./package.json').scripts['test:money'])"
  ```
- **`npm run test:copy` — GREEN, 3 checks**: `metric-copy-check`,
  `month-label-check`, `i18n-lookup-single-source-check`.
- **`scripts/code-grep.ts` is the tool that settles "is the identifier gone"**
  (`CLAUDE.md` §5). Directory arguments work since `8dea137`; exit 2 means the
  run produced no evidence and is never a pass.

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

## Completed this session (2026-09-08, `0c7adf9` → `e93baec`)

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

**A COMPLETE scan was run this turn** — `TODO`/`FIXME`/`HACK`/`XXX` across all
tracked `ts/tsx/sql/css/json` (**zero hits**), plus `deferred`, `parked`, `out of
scope`, `as-is`, `for now`, `not built yet`, `RBAC`, the previous handoff's open
section, and `SKILL.md`'s deferred list. **Every candidate below was re-verified
against live code or the live database. Candidates that measurement showed were
already CLOSED were dropped, not carried** — see the closing subsection for the
ones that died, so they are not resurrected.

### (a) DECISION for Turki — do not "fix" these, they are choices

1. **The Maintenance week-header separator is an ASCII comma in Arabic.**
   `app/maintenance/MaintenanceCalendar.tsx:175` builds
   `"Sep 4 – Sep 10, 2026"`, and the `,` is ASCII in BOTH languages where an
   Arabic reader would normally expect `،` (U+060C). The in-code comment at
   `:172-173` flags it. **This is a wording question, not a formatting bug** —
   changing it changes what an Arabic user reads.
2. **The Saudi map's city labels stay English.** `lib/i18n.ts:917-919` records
   why: they are `CITIES` **data**, not copy. Giving them Arabic names is a
   content decision. The map's corner disclaimer IS translated, deliberately —
   an Arabic reader must also be told the geometry is approximate.
3. **Four Inventory modal sizes are unresolved pending explicit sign-off.**
   `app/inventory/InventoryClient.tsx:124`: Create Warehouse, New supplier,
   Update market price, Adjust stock were never named in Turki's screenshots, so
   the preview-fidelity pass left them alone rather than guessing. A UI decision.
4. **`drivers.active` is a dead column and its deletion is deferred.**
   `app/drivers/actions.ts:77-80`. **Measured live: the column exists and NOT ONE
   row is anything other than `true`** — nothing reads it, nothing writes it,
   termination (`0020`, `terminated_at`) superseded it. Dropping it is a
   migration, therefore Turki's call, not cleanup.
5. **`.planning/` review artifacts are TRACKED, and no `.gitignore` rule was
   added — deliberately.** **Re-measured: 6 files named `review-*.md` are
   tracked** (an earlier revision said seven; it was counting
   `finance-invoice-spec.md` too). A pattern rule would fight the convention and
   would silently swallow the next artifact someone meant to commit. **The open
   question is whether that convention gets written down as a rule or stays
   custom.** The lesson the deleted `0187-arabic-copy-review.md` earned is about
   the HEADER, not the tracking: a review sheet states the state it was written
   in, and that state expires.
6. **Leaked-password protection is DISABLED in Supabase Auth.** Re-measured off
   the advisor today, not carried from the note. Console setting — not a
   migration, not a code change. **This is the only genuinely open item on the
   security posture**, and it is Turki's to click.

### (b) Doable FIX — cleanup, mechanical, but NOT part of this handoff commit

**Each is its own commit.** This session's scan was READ-ONLY by instruction.

7. **`app/inventory/actions.ts:358-362` is STALE and says the opposite of the
   truth.** It reads *"`consume_from_lots` … has no caller here — nothing in
   this app consumes parts yet (that's PO-receiving/work-order phases); it lights
   up when one of those lands."* **The work-order phase LANDED.** Proven end to
   end this turn: `app/maintenance/actions.ts:265` calls the `start_work_order`
   RPC → `0061:177` `perform deduct_work_order_parts` → `0065:228`
   `perform public.consume_from_lots(...)`. Parts are consumed in this app today.
8. **`app/inventory/InventoryClient.tsx:76-78` carries the same claim, worded
   more strongly** — *"NO caller anywhere in this app yet"*. Same proof, same
   fix. **Note the trap:** `code-grep 'consume_from_lots' app lib components`
   exits 0, because the app never names the function — it calls the RPC that
   calls it. **A clean code-grep here is evidence about the TS layer only; the
   call chain is in SQL.** Do not let the green exit re-confirm the stale
   comment.
9. **`app/inventory/InventoryClient.tsx:81-84`'s "NOT built (flagged…)" list is
   at least partly stale.** It names Purchase Orders, the Approvals tab, the
   Financial Analysis tab, AI-suggest-PO, receipt invoice-photo upload, the
   per-part Financial Report and two buttons as unbuilt. `PurchaseOrders.tsx`
   plainly exists, and `receive_loose_parts` hard-requires a non-empty `p_files`.
   **Re-measure the list ITEM BY ITEM before rewriting it — do not bulk-delete
   it.** Some entries are probably still true, and deleting a true "not built"
   note is how a gap becomes invisible.
10. **`lib/actions/search.ts:12` points at "HANDOFF.md §6", which does not
    exist** and never will — this file has no numbered sections. A dangling
    pointer. The thing it means is real (RBAC, item 11 below); only the address
    is wrong.

### (c) FORWARD-ONLY — nothing to do, no owner, not defects

11. **There is NO role gate anywhere in the app.** Three live sites say so:
    `app/trips/actions.ts:1444`, `app/archive/actions.ts:809` (*"With no role
    gate yet this is attribution, not authorisation"*), and
    `components/settings/ProfileSection.tsx:41` (leave-history display deferred
    to RBAC). `SKILL.md`'s locked decision 4 adds *"RBAC on add-a-type:
    deferred — any authenticated user can add one today."* **Every `actor` /
    `entered_by` / `created_by` column in this app is an AUDIT TRAIL, not a
    permission check.** Do not mistake one for the other.
12. **The Coming-Soon trio is fenced off on purpose**: `/routes`, `/predictive`,
    `/iot` (`lib/nav.ts:77-79`, rendered under a labelled `<nav>` in
    `components/AppShell.tsx:495`). `FleetDetailClient.tsx:511` and `:586` render
    two honest-empty cards against the same two. Route Optimization has a
    `preview/map.js` spec waiting.
13. **The payslip's commission-period caption stays English, and there is
    nothing to translate it FROM.** `app/reports/StatementViews.tsx:2819-2833`.
    `pay_commission` wrote the caption into `commission_payouts`, issuing the
    payslip copied it into `driver_payslips.snapshot`, and **the frozen entries
    carry no `monthKey`** — measured: `id, paid_at, period_label, base_sar,
    specials_sar, adjustments_sar, bonus_sar, total_sar`. Joining `id` back to
    the live table would both re-derive a frozen document from mutable data and,
    on this data, recover nothing. **Forward-only by DATA, not by preference.**

### Decided exceptions — recorded so they are not reopened as bugs

14. **`app/drivers/HistoryTab.tsx:322-334` — `period_label` stays English,
    DELIBERATELY.** Two independent sufficient reasons, both in-code: it is
    FROZEN TEXT written at pay time (the column stores words, not a key), and
    **it is not the month above it** — the line above is the month the run
    SETTLED, this is the payout RUN's caption, and the two legitimately come
    apart. Deriving it from `snap.monthKey` would print one fact twice and
    delete the one this line exists to show. **This is the one label the Arabic
    month sweep left alone on purpose. Do not reopen it.**

### Closed BY MEASUREMENT during this scan — do not relist as open

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

### 0. Clear the open-items inventory first — leave nothing parked

**This is the point of the list above.** Work items 1–10 to a ruling or a commit
before starting anything new. The (b) fixes are small and independent; the (a)
decisions need Turki and nothing else. **Do not start agenda item 2 or 3 on top
of an unresolved parked list** — that is how a 1301-line handoff happens.

### 1. The flagged items

The six (a) DECISION items. Each needs one answer from Turki, not analysis:
the Arabic comma, the map's city names, the four modal sizes, whether
`drivers.active` gets dropped, whether the review-artifact convention becomes a
written rule, and the Auth console toggle.

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
