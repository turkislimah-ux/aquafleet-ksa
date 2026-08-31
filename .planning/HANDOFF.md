# SESSION HANDOFF

## State

- **DB is at migration 0178.** `0178_violation_notice_image.sql` added
  `driver_violations.image_path` and the private `violation-images` bucket.
  Working tree clean, 0 ahead / 0 behind.
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
- **`9e4ca3b` WAS ALSO NOT VERIFIED IN-BROWSER** — same as `178df21`, directed
  from the measured gates. The bails are proven *reachable* against live data
  (10 paid specials, 6 paid adjustments, 26 non-draft invoices) and the error
  strings are proven to reach a screen (`run()` in `CommissionsTab.tsx`,
  `DenyModal`'s confirm in the same file, `InvoiceDetailModal`'s
  `setPeriodError`). Reachable and wired is not the same as seen.
- **`CLAUDE.md` is at 14,901 bytes — 459 under the 15,360 (§7) tripwire.** The
  §5/§6 compression pass ran this session (`067635a`) and bought that room. Done
  as an audit, not a trim, per §5: it found two stale claims (below). Next pass,
  same method — re-verify every claim; all three so far found a stale fact.
- **MCP-applied migrations write NO `schema_migrations` ledger row.** Neither do
  SQL Editor runs. The migration FILE is the record. The ledger's max version
  lags reality and always will — **the objects in the catalog are the truth, the
  ledger is not.** Do not "discover" a missing migration from a ledger query and
  do not re-apply one on that basis. Check `pg_proc` / `pg_index` first.
- **No open decisions and no known defects.** O-1 and O-2 were both ruled and
  closed; nothing was reopened. **Two open VERIFICATIONS** — `178df21` scenarios
  10–14, and all of `9e4ca3b`. Unverified is not the same as defective, and it is
  not the same as clean either.
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
if it is ISSUED (confirmed/paid/void).** Live-measured exact — 17 issued all
frozen, the 1 review not. Falsifiable both ways: issued-but-unfrozen prints a
zeroed document; frozen-but-draft means freeze-at-confirm fired where it must
not. A negative control drives the predicate with a row broken each way.

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

**No FEATURE is queued** — ask Turki for the next one rather than picking. ONE
piece of follow-through is outstanding, and it is not a feature.

1. **Run the `178df21` in-browser checklist** (see State, above). It is the one
   outstanding verification. **`9e4ca3b` needs the same treatment** — its miss
   path is a two-tab race, so ordinary clicking will not reach it.
2. ~~Promote the PostgREST zero-row rule into `SKILL.md`~~ — **DONE (`97964b7`).**
   It lives under **"A GUARDED WRITE MUST READ BACK"**, next to RPC Conventions:
   the two honest read-back shapes, the bail-above-destroy ordering, the three
   classes that are NOT findings (UNIQUE-column identity lookups, bulk writes,
   scoping filters behind a prior check), and how to re-sweep. **Do not restate
   any of it here** — same reason the violations money model and the notice photo
   moved out of this file.
3. Parked papercut: `InvoicesModal`'s period default — both bounds default to
   today, so the default range is a single day. Pre-existing, untouched.

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
