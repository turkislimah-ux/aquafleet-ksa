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
  closed; nothing was reopened.

---

## Closed this session

| # | Item | Commit |
|---|---|---|
| 1 | Notice photo: `image_path` + private `violation-images` bucket — `0178` | `7dcdaaf` |
| 2 | Notice photo app layer: staff upload/view/replace/remove; payslip view on issued + edit/void/photo on unissued; `noopener` pop-up fix | `5ea0001` |

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

**Nothing is queued.** Ask Turki for the next item rather than picking one.

1. Parked papercut: `InvoicesModal`'s period default — both bounds default to
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
