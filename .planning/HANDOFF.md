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
- **`178df21` WAS NOT VERIFIED IN-BROWSER — Turki directed the commit from the
  measured gates.** Unlike `7dcdaaf` and `5ea0001` above, which were. The
  in-browser checklist for it (16 scenarios: staff add/edit/view/replace/remove,
  payslip edit on unissued, issued read-only, rose-vs-amber, and the two-tab
  race) was written and is **UNRUN**. If violations behave oddly, that is the
  first place to look, and the checklist is in the `178df21` session transcript.
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
  closed; nothing was reopened. **One open VERIFICATION, though** — `178df21`'s
  checklist, above. Unverified is not the same as defective, and it is not the
  same as clean either.

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

**No FEATURE is queued** — ask Turki for the next one rather than picking. Two
pieces of follow-through are outstanding, and neither is a feature.

1. **Run the `178df21` in-browser checklist** (see State, above). It is the one
   outstanding verification, not a new feature.
2. **Promote the PostgREST zero-row rule into `SKILL.md` — the sweep that was
   blocking it is now DONE (`9e4ca3b`, see State).** The rule: **a PostgREST
   `UPDATE`/`DELETE` that matches no row is reported as SUCCESS**, so a write
   carrying a guard predicate (`.is("voided_at", null)`, `.is("payout_id", null)`,
   a status filter) must read back — `.select("id").maybeSingle()`, or
   `.select("id")` plus a `data.length` test — and treat the miss as the failure.
   Without it the guard is decoration. It now has seven fixed sites across four
   tables (`driver_violations` ×4, `commission_specials`, `commission_adjustments`,
   `invoices`), not one feature's worth. **Still absent from both files —
   re-measured at `9e4ca3b`:** `grep -nF -e maybeSingle -e 'zero-row' CLAUDE.md
   .claude/skills/aquafleet-domain/SKILL.md` exits 1, no hits.
   Three things the sweep taught that belong in the rule, not just the fix:
   - **`.select()` without `single` is a legitimate second shape** — it returns
     an array, so a miss IS detectable, but only if the caller tests `.length`.
     `updateExitPermitDraft` and `deleteExitPermitDraft` do; both are correct,
     and neither uses `maybeSingle`.
   - **A guard on a UNIQUE column is an identity lookup, not a guard.** That is
     11 of the 22 survivors. Check `pg_constraint` before calling one a finding.
   - **On a miss, the bail must sit above any destructive follow-on** — the
     `removeDriverViolationImage` lesson. Where the follow-on deliberately runs
     FIRST (`updateDraftInvoicePeriod`'s sync RPC, so a double-claim aborts with
     the period untouched), the read-back reports the residue instead of
     repairing it, and the comment has to say which.
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
