# SESSION HANDOFF

## State

- **DB is at migration 0183.** 181 files on disk, max `0183`. Five applied,
  verified against the CATALOG and committed this session:
  - **`0179_rls_initplan_auth_uid_subselect.sql`** (`688b6e2`) wrapped the bare
    `auth.uid()` in five policy predicates as `(select auth.uid())`, so Postgres
    hoists it into an InitPlan and evaluates it once per query instead of once
    per row. Verified both directions: `pg_policies` shows all five wrapped
    (`issue_reports_insert_own` in `with_check`; `own_notification_dismissals`,
    `own_notification_prefs`, `own_notification_thresholds_user`,
    `own_user_profiles` in both `qual` and `with_check`), predicates otherwise
    unchanged, and the advisor returns **zero `auth_rls_initplan` entries**.
    **Earlier revisions of this file named it `0179_rls_initplan_fix.sql` —
    WRONG, and corrected here.** A filename taken from memory is exactly the
    §5 trap; the file on disk is the record.
  - **`0180_pin_function_search_path.sql`** (`9a2e6aa`) pinned
    `search_path = public, pg_temp` on the 8 functions the security advisor
    flagged `function_search_path_mutable`. `public` stays FIRST so every
    unqualified reference resolves as before — deliberately non-breaking.
    `ALTER FUNCTION … SET` touches only `proconfig`; bodies and ACLs are
    untouched, so §6's re-revoke rule does not apply. Verified: all 8 carry the
    setting; 7 are `anon_exec = f`, and `set_updated_at()` is `anon_exec = t`
    but `returns trigger` — §6's accepted class, unreachable via PostgREST, NOT
    a regression and not introduced by 0180.
  - **`0181_confirm_invoice_special_charges_guard.sql`** (in `2477946`) — the
    money fix, below.
  - **`0182_discard_draft_or_review_invoice.sql`** (in `46b0158`) — the discard
    capability, below.
  - **`0183_rename_delete_draft_invoice_to_discard_invoice.sql`** (`55e3ebe`) —
    the pure rename, below. One `alter function … rename to`, no footer.
- **Origin carries through `6af117d` plus this handoff commit; working tree
  clean.** **This is a pointer and it goes stale the moment anyone commits —
  measure `git status -sb` before quoting it.**
- **MONEY FIX — `confirm_invoice` IS NOW AN AUDITOR, NOT A SCRIBE (`2477946`).**
  A confirmed invoice could freeze with NO special charges while the customer's
  prepaid balance had already been consumed by those same charges. **Two sources
  of truth for one amount of money:** `lib/invoice.ts` period-filtered special
  charges by `charge_date`, while `v_customer_prepaid_balance` counts every
  charge on a non-void invoice with **no date filter at all**. Measured on
  `026-000015` — snapshot empty, grand total 540.50, balance consumed 2,530.00.
  - **Server (`0181`):** `confirm_invoice` derives the authoritative charge set
    from `invoice_special_charges` — the SAME rows the balance view consumes —
    and **RAISES unless the client payload matches by id AND amount**, before
    `next_invoice_number()` is claimed, so a rejected confirm burns no number.
  - **It AUDITS, it does NOT recompute.** The covered/uncovered split stays
    client-side: it comes from the FIFO walk in `lib/prepaid.ts` over the
    customer's full history, and the per-line `covered` boolean exists nowhere
    in the DB. Reimplementing that in plpgsql would fork the money math, which
    the money-core boundary forbids. **Do not "finish the job" by moving the
    split into SQL.**
  - **It compares BASE `amount_sar`, not gross** — both sides then use identical
    Postgres numeric arithmetic on identical 2dp inputs. Comparing gross would
    pit JS `round2(x * 1.15)` against PG `round(x * 1.15, 2)`, which diverge on
    exact-half halalas and would reject CORRECT invoices.
  - **Client:** `lib/invoice.ts` no longer period-filters special charges, in
    either arm. Charges are FK-bound to exactly one invoice at creation, so
    `notReservedElsewhere` already scopes them; the date filter only ever
    dropped money. Trip period filters are untouched, and `chargesForEngine`
    never had the filter — so the two halves of that function now agree.
- **`confirm_invoice`'s ACL — THE GRANT IN `0181`'s FOOTER IS NOT A LEAK.**
  `0181` is `drop` + `create`, which **wipes the explicit grants**. The live
  `proacl` is `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`
  — **no PUBLIC entry**; `authenticated` and `service_role` are explicit, not
  inherited. So the footer must `revoke execute … from public, anon` **AND**
  `grant execute … to authenticated, service_role`. Revoking alone leaves the
  function owner-only and **the app loses confirm entirely** — caught in review
  before it ran, not after. Read back with `has_function_privilege` on all
  three roles plus `anon`, identified by `oid::regprocedure` (§6).
- **Security posture: the anon boundary is CLEAN.** The ~49 remaining
  `authenticated`-definer advisor warnings are **by design** — this is a
  single-tenant internal app and every staff user is `authenticated`. Do not
  triage them as findings. **One real item is outstanding and it is not in the
  repo: leaked-password protection is still OFF and must be enabled in the
  Supabase dashboard.** No migration can do it.
- **Deploy target: Vercel Pro, function region `fra1`** — next to the
  `eu-central-1` database. Region choice is latency, not preference; moving
  functions away from the DB re-introduces a round-trip per query.
- **RULED, NOT OPEN — draft-stage charge consumption is RESERVE-AT-DRAFT, and it
  is CORRECT. Do not restrict it.** The investigation ran this session and
  closed. `v_customer_prepaid_balance` counts special charges on **any non-void
  invoice, including `draft` and `review`** — no date filter, `status <> 'void'`
  is the only status filter. That is not an oversight sitting next to a
  trips-only reservation model; **a charge reserves balance exactly as a draft
  invoice reserves trips**, and the user-visible number already behaves that way.
  - **Nothing in TypeScript reads the view.** `v_customer_prepaid_balance` has 7
    repo hits and **all 7 are comments**; `charge_consumption_sar` has **zero**
    hits repo-wide. Consumption reaches the app only DB-side, through three
    dependent views: `v_customer_amount_payable` (Archive),
    `v_invoice_outstanding_live` (Reports), and `v_active_alerts` (the bell, via
    `v_my_notifications`).
  - **Two money GATES depend on it transitively**, both through
    `v_customer_amount_payable`: `archive_project_guarded` (refuses to archive
    while the customer is negative) and `return_customer_balance` (gates a cash
    refund on `amount_payable_sar > 0`). Restricting the view silently moves both.
  - **`v_active_alerts` reads `balance_sar` directly** — `prepaid_overdrawn` on
    `balance_sar < 0`, `prepaid_low_runway` on
    `balance_sar >= 0 and balance_sar < low_runway_trips * top_rate`.
  - **The number the user sees ALREADY drops at draft, and it does NOT come from
    the view.** Finance's Running Balance is computed client-side in
    `FinanceTab.tsx` over raw `invoice_special_charges` rows fetched in
    `app/trips/page.tsx` scoped `status !== "void"` — the SAME scope the view
    uses, reached independently.
  - **THIS IS WHY IT MUST NOT BE "FIXED" IN ONE PLACE.** The identical
    `status <> 'void'` scope exists in FOUR sites — the view, the Trips-page
    fetch, `nonVoidInvoiceIds` in `invoiceActions.ts`, and the alert view. They
    agree by construction today. Narrowing the view alone would leave the SQL and
    the TS engine reporting different money for the same customer — **the exact
    two-sources-of-truth shape closed in `2477946`.** All four move together or
    none do, and none is the current ruling.
- **DISCARD SHIPPED — an unfinalised invoice now has a way out (`46b0158`).**
  Reserve-at-draft being correct is precisely what made the missing exit a real
  problem: a draft or review invoice HOLDS its reserved trips and its charges'
  balance, and `discard_invoice` — then still named `delete_draft_invoice` —
  rejected everything that was not `'draft'`, so a stale review invoice was
  unclearable and quietly kept both.
  - **`0182` widened the EXISTING function in place — it did not add a second
    one.** `0019` shipped `archive_project`, `0139` added
    `archive_project_guarded`, `0140` had to DROP the unguarded one because the
    second path was the back door around the first. One call site, one signature,
    nothing to keep in sync, and the migration needs no TypeScript to land with
    it. **Do not add a SECOND discard path alongside it.** The honest name was
    all that was ever owed, and `0183` paid it by renaming this same function —
    not by adding one next to it.
  - **Measured live after the fact, not read off the migration (§5):** the gate
    is `if v_status not in ('draft', 'review')`; `proacl` is
    `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` —
    **identical to the pre-migration ACL**, so the drop+create footer's revoke AND
    grant both did their job; `anon_exec` false, `auth`/`service_role` true; and
    the §6 invariant still measures **0 anon-executable non-trigger functions**.
  - **The release works through the FKs, measured from `pg_constraint`:**
    `invoice_special_charges.invoice_id -> c` (CASCADE — deleting the rows is what
    frees the held balance, on BOTH sides at once) and `trips.invoice_id -> n`
    (SET NULL). Nothing else references `invoices`, so the delete leaves no orphan.
  - **`confirmed` / `paid` / `void` are still rejected, and the errors name the
    right door** — an issued document keeps its number and leaves by
    `void_invoice`; `paid` goes through `unpay_invoice` first.
  - **THE RENAME IS DONE — `0183` / `55e3ebe`, and it is not open.** The old name
    claimed draft-only, which stopped being true at `0182`. Shipped as the pure
    unit it needed to be: migration + the single call site + five comments in ONE
    commit, so no window existed where the app and the database disagreed.
    - **`alter function public.delete_draft_invoice(uuid) rename to
      discard_invoice;`** — one statement, bare, **no ACL footer, deliberately.**
      A rename touches `pg_proc.proname` only: same OID, therefore the same row,
      therefore the same `proacl`, `prosecdef` and `proconfig`. §6's re-revoke
      rule applies to `create or replace` and `drop`+`create`, which reset the
      ACL — **this is why a rename was used instead of drop+create.** A footer
      here would have implied a repair that was never needed.
    - **Measured live after the fact, not read off the migration (§5):** ONE row
      for `proname in ('delete_draft_invoice','discard_invoice')` — `oid` still
      **21415**, `fn` now `discard_invoice(uuid)`, `prosecdef` true, `proconfig`
      `{search_path=public}`, `anon_exec` false, `auth`/`service_role` true.
      **Same OID under the new name is the proof** that nothing but the label
      moved. Turki then discarded a draft and a review invoice in dev: rows gone,
      trips freed, charges off the balance.
    - **`supabase.rpc()` IS UNTYPED IN THIS REPO — tsc CANNOT catch RPC-name
      drift.** `lib/db-types.ts` is hand-written row shapes with no generated
      `Functions` map, and both clients are built without a `<Database>` generic.
      Proven, not assumed: `tsc` exits **0** on
      `rpc("this_function_does_not_exist_anywhere")`. So the regression test for
      any future RPC rename is **grep + the catalog + a click**, never `tsc`.
      There is exactly one call site (`invoiceActions.ts`,
      `supabase.rpc("discard_invoice", …)`).
    - **`0030` and `0182` still say `delete_draft_invoice` and MUST stay that
      way.** They record what was true when they ran, and a fresh `db reset`
      replays 0030 creates → 0182 replaces the body → 0183 renames. "Fixing"
      them would falsify history and break the replay.
  - **`InvoiceDetailModal`'s gate WAS widened to match — DONE (`bcad04f`), do not
    re-raise it.** It was left at `status === "draft"` when `46b0158` shipped, so
    the sheet was briefly narrower than its own backend; it now reads a named
    `canDiscard`, mirroring `isUnfinalized` in `InvoicesModal`. Both screens and
    the RPC agree on which statuses are discardable. The sheet also stopped
    carrying its own copy for the act: it reads `trips.invoices.discard` /
    `guardDiscard` / `confirmDiscard`, and the three orphaned
    `trips.invoiceSheet` keys were deleted. **One irreversible act, one
    description** — the same reason `GuardBox` is exported rather than copied.
- **Invoice `026-000015` is frozen understated and is being LEFT that way.**
  540.50 stored against 2,530.00 consumed. It is dummy data, and the freeze law
  of `0027` means issued invoices render from frozen columns and do not
  recompute — so it will not self-correct and that is correct behaviour. Not a
  defect to chase; not evidence the fix failed.
- **The skeleton loading-state sweep SHIPPED — 12 `loading.tsx`, one per
  server-fetching route segment.** Commits `d9541f9`, `7b9f3af`, `1f40d42`,
  `a8c39c2`, `693ce46`. The `.skel*` primitives and four tokens
  (`--ease`, `--dur-3`, `--r-3`, `--r-4`) were ported from `preview/app.css`.
  **`loading.tsx` per segment ONLY — no `<Suspense>` restructuring and no fetch,
  query or server-action change anywhere in the sweep.** Every page awaits at the
  top level of the page component, so per-section Suspense would have meant
  rewriting the fetch; the segment file streams the shell without touching it.
  - **The primitives are preview's; the GRID CLASSES ARE EACH PAGE'S OWN.**
    Preview ships a fixed 4-up `.skel-grid` because its demo used one skeleton
    for every route. Reusing it would reflow Fleet's 5-up strip, Drivers' 6-col
    row, Inventory's 5-up and Reports' two dissimilar bands the moment data
    landed — the exact shift the skeleton exists to prevent.
  - **Spacing mechanism is per-page and must be COPIED, not assumed.** Drivers
    and Trips space their blocks with `mb-*` and carry `border-b mb-4` on the tab
    bar; Inventory, Consumption, Reports and Archive wrap in `space-y-5`, so
    their tab bars carry NO `mb-4` — adding one doubles the gap.
  - **`/iot`, `/predictive`, `/routes` and `/login` correctly have none.** All
    four import `supabase/server` zero times. `/login` does await, but inside its
    submit handler, so there is nothing to stream. **Their absence is measured,
    not an omission — do not "complete" the sweep by adding them.**
- **Two accepted trade-offs on record — both are rulings, not open defects.**
  1. **`/reports`' `BigStat` tile keeps a small residual shift.** Its delta, foot
     and note rows are conditional on the data, so the tile's final height is not
     knowable from a static skeleton. Reserving all three would hold a permanent
     gap the page usually does not fill; reserving none shifts more. Turki saw the
     residual and accepted it.
  2. **Every skeleton mirrors its page's DEFAULT tab only.** Non-default tabs are
     reached through `useTabParam` client state and mount *after* hydration, so
     they never see a `loading.tsx` at all. A skeleton drawn for them would be
     dead markup.
- **The traffic-violation notice photo shipped** — schema + bucket `7dcdaaf`,
  app layer `5ea0001`, verified in-browser before both. The durable rule (the
  storage key, the display-only boundary, the freeze/edit gate, the signed-URL
  read, and the `window.open`/`noopener` lock) is in the domain skill under
  **Traffic Violations → "The notice photo (0178)"** — do not restate it here.
- **A cleanup pass over the whole violations feature then landed (`178df21`) —
  audit first, fix second, no migration.** It found and closed a real race: all
  four violation mutators carried `.is("voided_at", null)` and none of them
  looked at whether the predicate had fired, so a fine voided in another tab
  between an action's read and its write returned `{ error: null }` having
  changed nothing. `removeDriverViolationImage` was the one with damage — it
  went on to delete the storage object while the row still pointed at it. All
  four now read back with `.select("id").maybeSingle()`.
- **`178df21`'s checklist HAS NOW BEEN RUN — 11 of 16 scenarios pass, 5 remain.**
  Passed at the row and the bucket: **1, 3, 4, 5, 6, 7, 8, 9, 15, 16**, plus the
  size half of **2**. The two that carry the commit are the two-tab races:
  **15** refused a pending amount edit against a fine voided in the other tab
  (message exact, `amount_sar` still `88.00` — not a silent success), and **16**
  refused the photo removal *and left the object in the bucket*, proving the
  null-row check runs above the storage delete. **9** rendered rose, not amber.
  **Still unrun: 10, 11, 12** (payslip preview on an unissued month — inline edit
  moves Deductions+Net, photo View/Replace/Remove, six-column print) — stopped
  for time, not for a problem. **13, 14 were declined on purpose** (see below).
  The `.txt` half of **2** was skipped for want of a file and closed in code
  instead: `validateViolationImage` runs server-side in `uploadDriverViolationImage`
  *before* `createClient()`, so a crafted request is refused — which is the only
  thing standing there, since the bucket itself has `file_size_limit: null` and
  `allowed_mime_types: null`.
- **THE DOCUMENTED VERIFICATION CONVENTION CANNOT REACH THIS FEATURE.** The repo's
  convention (`playwright.config.ts`) is a throwaway diagnostic route plus a
  temporary middleware auth bypass. `driver_violations`, `drivers` and
  `violation_types` are all `has_table_privilege('anon', …, 'select') = false`,
  so a bypassed session renders an EMPTY SCREEN, not the feature — measured, not
  assumed. What worked instead: **Turki clicks each scenario, Claude verifies the
  row and the storage object over MCP after every one**, holding
  `dangling`/`orphans` at 0/0 throughout as the instrument.
  **A SCREENSHOT CANNOT FALSIFY THE BUG THIS COMMIT FIXED** — a zero-row write
  looks identical to a successful one on screen. Only the read-back separates them.
  Scenario 7 proved the method earns its cost: it was reported working, but
  `updated_at` had not moved anywhere in the table, and since `applyPhotoChanges`
  runs *after* the row write that bumps it, the submit had never happened at all.
  A redo passed. **A green report is a claim about the screen, not about the row.**
- **The repo-wide sweep for that same zero-row shape RAN, and closed the three
  sites it found (`9e4ca3b`).** 203 files, 107 write chains: 13 guarded chains
  read back, 22 guarded ones do not, 72 carry no guard beyond a key. The 22 were
  triaged one by one and **none is a defect** — 11 filter on a UNIQUE column so
  the "guard" is really an identity lookup (`key` on all six lookup tables;
  `commission_periods_driver_month_idx` on the pair), 9 are bulk writes where
  zero rows is the correct outcome, 2 (`updateExitPermitLineQty` /
  `removeExitPermitLine`) run `assertDraft` first and only scope by parent id.
  **Do not re-triage them from the raw count.**
  The three that were real: `setSpecialStatus` and `setAdjustmentStatus`
  (`.is("payout_id", null)` is the payment freeze — a miss told a manager his
  deny landed on money already paid out) and `updateDraftInvoicePeriod`
  (`.eq("status","draft")`, and the only guarded invoice write in its file that
  did not read back).
- **`9e4ca3b`'S MANUAL VERIFICATION IS DROPPED — NOT PENDING. Do not carry it
  forward as "unverified" and do not re-raise it.** The fix itself shipped and
  stands; what was dropped is the hand-staged two-tab collision that would
  demonstrate it.
  - **Why dropped:** reaching the miss path means holding one tab mid-action
    while a second tab pays the payout or moves the invoice out of Draft — a
    setup that has to be built by hand for each of the three sites, against live
    money rows, and torn down after. **At 3–4 users the collision it guards is
    rare; the fixture costs more than the assertion.** Same call, same reasoning
    as `178df21` scenarios 13–14.
  - **What stands in its place, and it is not nothing:** the bails are proven
    *reachable* against live data (10 paid specials, 6 paid adjustments, 26
    non-draft invoices) and the error strings are proven to reach a screen
    (`run()` in `CommissionsTab.tsx`, `DenyModal`'s confirm in the same file,
    `InvoiceDetailModal`'s `setPeriodError`). The change is also a strict
    improvement by construction: before it, a filtered-out write returned
    `{ error: null }`; after it, the same write reports. **A read-back cannot
    make the success path worse** — it adds a `.select("id")` to a write that
    already ran.
  - **Reachable and wired is still not the same as seen** — that stays true, and
    it is the honest cost of this decision, not an argument against it. If a
    manager ever reports a deny that "worked" on a paid line, or a period edit
    that silently didn't take, run the two-tab setup then.
- **`CLAUDE.md` is at 14,901 bytes — 459 under the 15,360 (§7) tripwire.** The
  §5/§6 compression pass ran this session (`067635a`) and bought that room. Done
  as an audit, not a trim, per §5: it found two stale claims (below). Next pass,
  same method — re-verify every claim; all three so far found a stale fact.
- **NEVER RUN `npm run build` WHILE `next dev` IS UP — THEY SHARE `.next/`, AND
  THE BUILD WINS.** Cost a full debugging cycle this session. `next build` wipes
  and rewrites `.next/`, so the running dev server's in-memory manifests point at
  dev assets the production build deleted: `/_next/static/css/app/layout.css` and
  `/_next/static/chunks/main-app.js` both return **404 serving the HTML 404
  page**, and the app renders as raw unstyled HTML with all its data present and
  no hydration. **It looks exactly like a CSS/PostCSS compile error and it is
  not** — there is no error in the dev log, `tsc` is 0 and `globals.css` is
  untouched. Tell them apart by fetching the stylesheet directly; a hard refresh
  cannot help, the 404 is server-side. The fix is `pkill -f "next dev"`, then
  `rm -rf .next` **with nothing running**, then restart. Use
  `npx tsc --noEmit` + `npm run test:money` for verification while dev is up, and
  save the production build for a moment when it is not.
- **MCP-applied migrations write NO `schema_migrations` ledger row.** Neither do
  SQL Editor runs. The migration FILE is the record. The ledger's max version
  lags reality and always will — **the objects in the catalog are the truth, the
  ledger is not.** Do not "discover" a missing migration from a ledger query and
  do not re-apply one on that basis. Check `pg_proc` / `pg_index` first.
- **No open decisions, NO open investigations, no known defects.** O-1 and O-2
  were both ruled and closed; nothing was reopened. Draft-stage charge
  consumption — the single investigation this file used to carry — was **RULED
  this session** (above): reserve-at-draft is correct, do not restrict it.
  **ONE open VERIFICATION remains** — `178df21` scenarios 10–12. (13–14 are
  DECLINED and `9e4ca3b`'s two-tab run is DROPPED; neither is pending, both are
  above. An earlier revision of this line said "10–14", which contradicted the
  13–14 ruling two bullets down, and an earlier one still carried `9e4ca3b`.)
  Unverified is not the same as defective, and it is not the same as clean
  either. Not in that list, because each was verified in-browser before it was
  committed: the money fix (`2477946`); the discard unit (`46b0158`) — a review
  invoice holding trips and charges deleted, trips freed, charges off the
  balance, with confirmed/paid/void rows showing neither the wash nor the delete
  control; the rename (`55e3ebe`) — discard re-tested on both draft and review
  after `0183` applied; and the period default (`6af117d`).
- **13 and 14 ARE DECLINED, NOT PENDING — do not re-raise them as a gap.** They
  assert that an *issued* payslip shows no Pencil and no Ban but still shows the
  photo icon. No issued payslip exists for a driver with photographed fines, and
  the only way to make one is to issue a real gap-free numbered money document
  that cannot be cleanly un-issued. **The fixture costs more than the assertion.**
  Both branches were closed by reading `StatementViews.tsx` instead: `buildDocFines`
  takes the issued branch from `doc.snapshot.violations.items` with `locked: true`
  hard-coded, so the controls cannot render, and `imagePath` is the one field read
  live in both branches, so the icon must. If an issued payslip with a photographed
  fine ever appears in the normal course of business, run them then — do not
  manufacture one.
- **Two voided test fines remain on driver `13823f47`** (`123123123` @ 88.00 and
  `TEST-016` @ 55.00, both created and voided during the checklist run). Left
  voided rather than hard-deleted — §6 locks soft-delete for operational records,
  and `app/drivers/page.tsx` filters voided rows out of the list, so they are
  already invisible. TEST-016's photo is still in the bucket and still correctly
  pointed at; it is one of the 5 in the 5↔5 count below. **Not litter to clean up.**
- **The violations photo invariant measured 5 objects ↔ 5 rows, dangling 0,
  orphans 0** at the end of the run — same shape as the 4↔4 baseline taken before
  the first click. This is the standing check for the feature:
```sql
  with objs as (select name from storage.objects where bucket_id = 'violation-images'),
       rows_with_path as (select image_path from driver_violations where image_path is not null)
  select (select count(*) from objs) as objects,
         (select count(*) from rows_with_path) as rows_with_path,
         (select count(*) from rows_with_path r
            where not exists (select 1 from objs o where o.name = r.image_path)) as dangling,
         (select count(*) from objs o
            where not exists (select 1 from rows_with_path r where r.image_path = o.name)) as orphans;
```
  **`dangling` and `orphans` are different bugs** — a dangling row is a broken
  photo the user sees, an orphan is a file nobody points at and nobody will ever
  delete. Scenario 9 was staged by appending `.MISSING` to one `image_path` to
  force a dangling row, then restored from the value recorded before the edit;
  the 0/0 above is the post-restore reading.

---

## Closed this session

| # | Item | Commit |
|---|---|---|
| 1 | Notice photo: `image_path` + private `violation-images` bucket — `0178` | `7dcdaaf` |
| 2 | Notice photo app layer: staff upload/view/replace/remove; payslip view on issued + edit/void/photo on unissued; `noopener` pop-up fix | `5ea0001` |
| 3 | Notice photo recorded as a durable domain rule | `1bdc9d6` |
| 4 | Violations cleanup: photo state machine + save tail deduped into `usePhotoDraft`/`applyPhotoChanges`; zero-row read-back on all four mutators; rose-vs-amber split on the staff screen; 4 exports dropped, 2 dead i18n keys deleted, 3 stale `file:line` pointers made name-based | `178df21` |
| 5 | Handoff updated with that pass and the two traps it exposed | `36d6c66` |
| 6 | Repo-wide zero-row sweep, then its three findings closed: read-back on `setSpecialStatus`, `setAdjustmentStatus` (shared `ITEM_PAID_MSG`) and `updateDraftInvoicePeriod` | `9e4ca3b` |
| 7 | Sweep + the rotted `invoiceActions.ts:1035` pointer recorded; that pointer converted to a symbol grep | `2efd4bb` |
| 8 | The zero-row rule promoted into `SKILL.md` — including the three classes that are NOT findings | `97964b7` |
| 9 | `178df21` verified in-browser: 11 of 16 scenarios pass including both two-tab races; 10–12 left unrun, 13–14 declined with reason | (docs only) |
| 10 | RLS `auth.uid()` initplan fix on 5 policies — `0179`; applied live, advisor's 5 `auth_rls_initplan` WARNs cleared | `688b6e2` |
| 11 | Skeleton loading states, batch 1 — `.skel*` primitives + `--ease`/`--dur-3`/`--r-3`/`--r-4` ported from `preview/app.css`, first routes | `d9541f9` |
| 12 | Skeleton loading states, batch 2 | `7b9f3af` |
| 13 | Skeleton loading states, batch 3 — `/drivers`, `/trips` | `1f40d42` |
| 14 | Skeleton loading states, batch 4 — `/customers`, `/projects`, `/maintenance` | `a8c39c2` |
| 15 | Skeleton loading states, batch 5 — `/inventory`, `/consumption`, `/reports`, `/archive` | `693ce46` |
| 16 | **MONEY:** special charges must match the balance source or confirm is rejected — `0181` makes `confirm_invoice` an auditor; `lib/invoice.ts` stops period-filtering charges. Applied, 4 scenarios verified in-browser, `test:money` 10/10 | `2477946` |
| 17 | `search_path` pinned on 8 advisor-flagged functions — `0180`; applied and verified against `pg_proc` | `9a2e6aa` |
| 18 | Draft-stage charge consumption INVESTIGATED and ruled: reserve-at-draft is correct, the four `status <> 'void'` sites agree by construction, restricting one would fork the money | (docs only) |
| 19 | **Discard an unfinalised invoice** — `0182` widens `delete_draft_invoice` (renamed `discard_invoice` at `0183`, row 21) in place to draft OR review (trips SET NULL, charges CASCADE, confirmed/paid/void still rejected, ACL footer restated); UI adds the amber wash on draft/review rows and a per-row permanent delete behind the shared `GuardBox`; stale draft-only comment on `deleteDraftInvoice` corrected. Applied, ACL and gate re-measured against `pg_proc`, verified in-browser | `46b0158` |
| 20 | `InvoiceDetailModal`'s own delete gate widened to match — named `canDiscard`, Delete added to the Review action row, sheet repointed at the list's `discard`/`guardDiscard`/`confirmDiscard` strings and the 3 orphaned `trips.invoiceSheet` keys deleted. Verified in-browser | `bcad04f` |
| 21 | **`delete_draft_invoice` → `discard_invoice`** — `0183`, one `alter function … rename to`, no ACL footer (rename keeps the OID, so ACL/definer/`search_path` come through untouched). Migration + the one call site + 5 comments in ONE commit, so no window where app and DB disagreed. Applied; re-measured from `pg_proc`: same **OID 21415**, `anon_exec` false. Discard re-tested on draft and review in dev | `55e3ebe` |
| 22 | **New-invoice period default** — both bounds seeded to `todayKey()`, so the default range was a single day and assembled no trips (the period SELECTS the trips). Now month-to-date via a shared `defaultPeriod()` used by BOTH the `useState` initials and the open-effect re-seed; reuses `monthStartKey`. Inputs and the `start > end` check untouched. Verified in-browser | `6af117d` |
| 23 | `9e4ca3b`'s two-tab manual verification **DROPPED, not pending** — fixture costs more than the assertion at 3–4 users; the read-back fix itself stands and is reachable-and-wired against live data | (docs only) |

---

## Closed in the previous session

| # | Item | Commit |
|---|---|---|
| 1 | Prepaid balance/statement pool made lifetime-net (the O-2 ruling) | `dc29e26` |
| 2 | Violations model moved into the domain skill; frozen-split annotation | `90c5a9e` |
| 3 | `scripts/frozen-split-check.ts` + the duplicate-customer rule | `20b847c` |
| 4 | `npm run test:money` — all ten money harnesses, fail-fast | `46bccf3` |
| 5 | Handoff rewrite, then two corrections it did not survive (below) | `5847cc8`, `c30aaf0`, `c06f3e0` |
| 6 | `CLAUDE.md` §5: measure a justification before writing it down | `708e7da` |
| 7 | Session wrap; the customer count scoped to live rows | `773d2cb` |
| 8 | `CLAUDE.md` §5/§6 compression pass + the audit behind it | `067635a` |

---

## THERE IS NOW A MONEY-HARNESS SUITE — USE IT

```sh
npm run test:money
```

Ten harnesses in sequence, fail-fast (`|| exit 1`), exit 0 = all green:
`prepaid` · `covered-unpaid` · `amount-payable` · `invoice` · `vat` ·
`commission` · `commission-rows` · `payslip-deduction` · `daily-trips` ·
`frozen-split`.

- **`notification-format-check` is deliberately NOT in the list** — it is a
  presentation harness for the notification bell ("No DB, no React"), not money
  math; its `sar`/`invoice` tokens are notification *text*. Its absence is a
  decision, not an oversight. Do not "fix" it.
- **Not wired into `next build` or `safe-build.sh`, on purpose.** Money checks
  are run deliberately, not on every build. No test framework was added.
- Fail-fast was **proven, not assumed**: a `process.exit(1)` harness injected at
  position 3 of a mirror loop stopped the run there and exited 1.
- **Run it before any money commit.** That is why it exists.

---

## The frozen-split guard, and the number that changed

`scripts/frozen-split-check.ts` makes the "frozen vs re-derived split" ruling
self-verifying — it had been rebuilt from a throwaway script twice.

**It ASSERTS the freeze boundary: an invoice carries a frozen split if and only
if it is ISSUED (confirmed/paid/void).** Re-measured this session, exact both
ways — **24 issued (3 confirmed + 17 paid + 4 void) all frozen; 6 unfinalised
(3 draft + 3 review) none frozen.** Falsifiable both ways: issued-but-unfrozen
prints a zeroed document; frozen-but-draft means freeze-at-confirm fired where
it must not. A negative control drives the predicate with a row broken each way.
**An earlier revision of this line read "17 issued, the 1 review not" — those
counts are DATA and they drift** (the discard work alone deleted a review
invoice). It is the two-way agreement that is the invariant, never the number;
re-measure before quoting it (§5).

**It PRINTS, and never asserts, the count and SAR.** Those drift with the data;
hardcoding them would be a brittle test, not a guard.

**The invariant as first specified was WRONG, and the failing run found it.**
"Every divergence sits on an issued invoice" fails, because every draft/review
invoice has `covered_lines` NULL, `unpaid_lines` NULL and zero totals — there is
no stored split on it to diverge *from*. Comparing one is a category error, not a
finding. The population is scoped to frozen rows, and assertion 1 is what earns
that filter rather than assuming it.

**The harness prints 10 / 28,474.00 SAR; SKILL.md's dated annotation says
8 / 13,524.00. That is METHOD, not data — do NOT chase it.** The harness
re-derives void invoices too, and a void's lines were released back to the pool
and re-picked by later invoices, so it re-derives to nearly nothing and books its
whole stored `amount_due` as "moved". Invoices `1` (void, 11,500.00),
`026-000006` and `2` account for the 14,950.00 gap. Neither figure disturbs the
LEAVE ruling. Both are recorded in both places on purpose. **Read the per-invoice
lines, never the total alone.**

---

## Domain rules added to the skill this session

Both live in `.claude/skills/aquafleet-domain/SKILL.md` — their one home.

- **Duplicate customer info is ALLOWED.** Two customer records may legitimately
  share name, VAT and CR when they serve different projects; each holds its OWN
  prepaid pool and its own invoices. **Do NOT add a VAT/CR uniqueness constraint
  or a dedupe/merge guard** — it would block a valid case, and merging would pool
  two balances that must stay apart. **VAT/CR carries no identity signal:**
  re-measured 2026-08-31, `123456789012345` / `1234567890` is an unfilled
  placeholder on **5 of 7 LIVE** customers, so a uniqueness constraint would fail
  on five existing rows today. The two "Seder Facility mang./Mang. Co." records
  are separate by ruling, not because their identity fields match.
  **If you recount and get 5 of 8, you have counted the archived row** — the
  table holds 8 and `Turki 1` has `archived_at` set. Scope to
  `archived_at is null`. The figure is right; the bare `count(*)` is not.
- The traffic-violations money model (0175–0177) — moved out of this file last
  session so the two cannot drift. The notice photo (0178) went straight there
  for the same reason.

---

## Closed in earlier sessions (detail is in the commit messages)

| # | Item | Commit(s) |
|---|---|---|
| 1 | Fleet Health column removed (plus its dead i18n keys) | `4982c71` |
| 2 | Inventory approval-vote wedge fixed; 5 legacy POs backfilled — `0172` | `19f6466` |
| 3 | Prepaid balance is a **lifetime NET pool** — topups AND returns | `9c287d6` |
| 4 | Trip-ref **gap-fill allocator** — `0173` + `0174` | `3223df5`, `0869576` |
| 5 | **Prepaid Amount Payable redefined** = unpaid delivered work | `d4c3d3e` |
| 6 | Traffic Violations, three stages — `0175`–`0177` | `4fdf30a`, `5a7c0e6`, `ef899cd` |

---

## Still true, still load-bearing

- **The THREE prepaid numbers are deliberately different and two of them are
  allowed to disagree. Do NOT "reconcile" them.** Reasoning — including why
  `v_customer_amount_payable` stays balance-based (flipping it makes
  `return_customer_balance()` pay a debtor their own debt) — is in SKILL.md
  §"Amount Payable ≠ the prepaid BALANCE". Consequence to expect, not to fix:
  **the Archive tab shows a different number than the Trips tab for the same
  prepaid customer, by design.**
- **Frozen invoice splits diverging from a re-derivation is EXPECTED** — issued
  invoices render and print from frozen columns (0027), so no document drifts.
  One live item: `026-000009`, confirmed and unpaid at 4,243.50 SAR.
- `trips` has check constraint **`trips_project_or_customer`**: a trip needs
  `project_id` **OR** `customer_id`. A fully bare `(null, null)` trip is
  rejected, so the `WT-` fallback series is reached by **bare-CUSTOMER** trips —
  customer set, no project — not by empty trips.

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
- **A MIGRATION'S FILENAME IS NOT ITS OBJECT NAME.** This is now the *method*
  under `CLAUDE.md` §5's general rule ("measure Y before writing X because Y") —
  kept here, not duplicated there, because the procedure is what makes it
  actionable. Probing the catalog for a
  table named after the file reports a healthy migration as MISSING, and a false
  catastrophe reads exactly like a real one (§6). `0177_payslip_violation_
  deductions.sql` creates `driver_payslip_violations`, not
  `payslip_violation_deductions`. Read the `create table` line out of the file
  first, then query for THAT name.
- **A cleanup line placed after `exit 1` never runs.** Proving a guard can fail
  by injecting a temp failing script leaves that temp file behind, because the
  loop exits before the `rm`. Re-check the tree; do not trust the `rm` you wrote.
- **A CHECK WHOSE RANGE MATCHES NOTHING PRINTS A CLEAN PASS.** Sibling of §5's
  comment-epitaph trap and just as convincing. Caught live in `178df21`:
  `awk '/^      viol: \{/,/^      \},/'` over `lib/i18n.ts` used a six-space
  indent against a four-space block, matched zero lines, and reported both
  deleted keys as confirmed gone. The extractor had found nothing at all.
  **Every extract-then-grep needs a negative control on the EXTRACT step** — one
  count proving the range is non-empty (`grep -c` for anything at all in it)
  before the absence inside it means anything. Same run: a
  `grep -F 'viol.recent' lib/i18n.ts` is **vacuously 0 in every possible state**,
  because the dictionary nests and that dotted string never appears there. The
  load-bearing check was the dotted-key sweep across the whole tree.
- **A CODE SCANNER YOU WROTE THIS TURN NEEDS A KNOWN-ANSWER CONTROL BEFORE ANY
  OF ITS OUTPUT MEANS ANYTHING.** The zero-row sweep's scanner shipped two
  parser bugs, one after the other, and **both printed a clean, plausible,
  well-formatted report**. (1) A chain inside `Promise.all([…])` never reaches a
  `;` of its own, so the statement-walker overran and glued siblings together —
  it reported three `.select()` READS as one guarded write and hid a real chain.
  (2) Fixing that by ending on a depth-0 `,` moved the failure: prose inside
  mid-chain comments carries commas, which truncated a chain immediately before
  its `.select("id").maybeSingle()` and reported a read-back **added two commits
  earlier** as missing. Apostrophes in comments opened phantom string literals
  the same way. **Blank comments before scanning, never after** — and the only
  reason either bug was caught is that the file under test had a known answer
  (four `driver_violations` writes, all read back). Point every new scanner at
  something you already know the answer to, in both directions: a site it must
  find and a site it must not. Same failure family, seen again on the commit
  checks for `9e4ca3b`: `grep -Fc 'payout_id\", null'` inside single quotes
  greps for a literal backslash and returns a confident **0**, and a
  `grep -B6 … | grep -c` window undercounts multi-line chains. Both looked like
  results.
- **`file:line` POINTERS IN `SKILL.md` ROT SILENTLY, AND NOTHING GUARDS THEM.**
  Three were stale in one pass: `TrafficViolationsSection.tsx:134` (already
  wrong at HEAD by 10 lines), `actions.ts:1682` and `actions.ts:1592` (both
  correct at HEAD, both moved by that same pass). All three are now name-based —
  "grep for this symbol in this file" — so they stop rotting. **Do not add new
  `file:line` citations to a skill or a note; cite the symbol.** After any pass
  that shifts lines in a cited file, re-grep:
  `grep -rnE '\.tsx?:[0-9]+' --include='*.md' .claude/`
  **THE LAST SURVIVING CITATION HAS NOW ROTTED AND BEEN CONVERTED, ON SCHEDULE.**
  `SKILL.md`'s `invoiceActions.ts:1035` was re-measured correct one session ago
  and left standing with the note "convert it the next time anything edits that
  file". `9e4ca3b` edited that file — 19 lines added above it — and line 1035 is
  now `name_ar: seller?.legal_name_ar ?? null,` while `coveredLines` sits at
  1054. Caught by running the grep above as part of the handoff write, not by
  anything automatic. It is now name-based ("grep `coveredLines:
  inv.covered_lines`"), so **the grep above now returns NOTHING over `.claude/` —
  exit 1, zero hits.** The dead pointers quoted in this lock are the only ones
  left anywhere live, and they are in THIS file, as examples. The
  `.planning/review-*.md` docs
  hold six more, unconverted on purpose — historical records, not live guidance.
  **The lesson is the schedule, not the pointer:** "correct today, convert it
  later" survived exactly one commit, and the commit that broke it was ours.
- Locks promoted into `CLAUDE.md` and living there now, not here: **measure a
  justification before recording it** (§5, new this session — a count, a cause,
  a "matches/proves" is never written from memory or off a filename); the `grep -c`
  comment-epitaph trap with its fix (§5 — strip comment lines, use `grep -F` on
  patterns with parens); migrations are BARE STATEMENTS with no
  `begin;`/`commit;` **from 0173 on — 147 of the 175 files up to 0172 still
  carry them, and they are NOT broken; do not "fix" them** (§5); identify a
  function by `oid::regprocedure::text`,
  never `pg_get_function_identity_arguments()` which returns argument NAMES on
  PG15+ (§6); a migration's own result-grid is not proof it applied (§5).

---

## Rules carried forward

- `CLAUDE.md` is the rules file — read it, don't append to it.
- Domain rules in `.claude/skills/aquafleet-domain/SKILL.md`.
- Money gate: salary / rates / commission / invoice / balance → draft, STOP, the
  architect reviews. **And run `npm run test:money`.**
- Migration gate: Code drafts → STOPS → the architect reviews and applies.
- Explicit-path `git add`; inspect the staged blob with `git show :<path>`.
- **Re-measure any figure in this file before relying on it.** A number here is a
  pointer, not evidence.
- Session cap: 15 turns max. Compact once = wrap up.

## What's next

**No FEATURE is queued** — ask Turki for the next one rather than picking. **TWO
pieces of follow-through are outstanding — 1 and 5 below** — and neither is a
feature. (Items 2, 3 and 4 are kept struck through as records, not as work. Do
not resurrect a struck item because it still appears in this list.)

1. **Run `178df21` scenarios 10–12** (see State, above) — payslip preview on an
   unissued month: inline fine edit moves Deductions+Net, photo View/Replace/
   Remove in the edit panel (View opens a NEW TAB here, unlike the drivers
   screen), and the print preview still renders six columns with no controls.
   **This is the ONE outstanding verification.** `9e4ca3b`'s two-tab run was
   DROPPED, not deferred — see State; do not add it back here.
2. ~~Promote the PostgREST zero-row rule into `SKILL.md`~~ — **DONE (`97964b7`).**
   It lives under **"A GUARDED WRITE MUST READ BACK"**, next to RPC Conventions:
   the two honest read-back shapes, the bail-above-destroy ordering, the three
   classes that are NOT findings (UNIQUE-column identity lookups, bulk writes,
   scoping filters behind a prior check), and how to re-sweep. **Do not restate
   any of it here** — same reason the violations money model and the notice photo
   moved out of this file.
3. ~~Parked papercut: `InvoicesModal`'s period default~~ — **DONE (`6af117d`).**
   Both bounds seeded to `todayKey()`, which made the default range a single day
   and — since the period SELECTS the trips — assembled nothing on a normal day.
   Now month-to-date, seeded from one `defaultPeriod()` in both the `useState`
   initials and the open-effect. Closed row 22.
4. ~~Rename `delete_draft_invoice` → `discard_invoice`~~ — **DONE (`0183` /
   `55e3ebe`).** Shipped as the pure-rename unit it had to be, migration + call
   site in one commit. Closed row 21; the ACL reasoning is in State. (The other
   tidy-up this item used to carry — `InvoiceDetailModal`'s draft-only gate — was
   **DONE in `bcad04f`**.)
5. **Enable leaked-password protection in the Supabase dashboard.** Not a
   migration, not a code change — a console setting. It is the one open item on
   the security posture.

~~Investigate draft-stage charge consumption~~ — **RULED this session**, see
State. Reserve-at-draft is correct and the four `status <> 'void'` sites agree by
construction. **Do not reopen it as a task.**

~~Push the outstanding commits~~ — **DONE.** Origin carries through `6af117d`
plus this handoff commit, tree clean. **Re-measure with `git status -sb` before
quoting; this goes stale on the next commit.**

**NOTIFICATIONS + SETTINGS IS BUILT AND LIVE — do NOT plan it.** Earlier
revisions of this file listed it as the next feature with "`0154` pending,
renumber, that slot is long past". Wrong twice: `0154` is applied and on disk as
`0154_notifications_data_layer.sql`, and the slot is taken by **this very
feature**. Re-measured 2026-08-31:

- Migrations `0154` (data layer), `0155` (blue event branches), `0158` (per-user
  thresholds), `0160` (drop `notification_events`); settings via `0029`, `0042`,
  `0171`.
- Tables `notification_prefs`, `notification_thresholds`,
  `notification_thresholds_user`, `notification_dismissals`, `company_settings`,
  plus view `v_my_notifications`.
- `components/settings/{SettingsModal,NotificationsSection,CompanySettingsSection}.tsx`,
  `lib/actions/{notifications,notification-settings}.ts`,
  `lib/notification-{format,thresholds}.ts` — all mounted from
  `components/AppShell.tsx`. Settings is a MODAL, not a route; there is no
  `app/settings/`, and its absence is not a gap.
- Guarded by `scripts/notification-format-check.ts`, whose fixtures are real
  `v_my_notifications` rows.

**This is the "never re-raise an item because a note still lists it open" rule
(`CLAUDE.md` §5) catching a live case.** The contradicting evidence sat in the
harness header the whole time and was read without being noticed.

Read `.claude/skills/aquafleet-domain/SKILL.md` for domain constraints.
