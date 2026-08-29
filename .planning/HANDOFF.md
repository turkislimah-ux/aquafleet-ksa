# SESSION HANDOFF — ARABIC PHASE 3 IS CLOSED. Feature #3 shipped. Feature #4 closed with NO WORK.

**HEAD `e57d696` · branch `main` · 0 ahead / 0 behind · highest migration FILE
`0171` · tree CLEAN.**

**§10 IS THE NEWEST SECTION AND HOLDS THE ONLY OPEN ITEM.** Two commits landed
after this file was last refreshed at `0c48aa9`. A live-DB read while writing §10
found that the `user_profiles` TABLE comment still carries the retired claim that
`preferred_language` is *"a display label only"*. That is now false. It is the one
actionable thing in this document; everything else is a record.

**READ THIS FILE'S §7 BEFORE PLANNING ANY ARABIC WORK — there is none left.**
(`CLAUDE.md` has its own §7, the money/schema rules, one paragraph down. The two
are unrelated and both get cited here.) Turki walked the whole app in Arabic on
2026-08-29 and found nothing. Everything below this line is the RECORD of how
that was reached, kept because several of its conclusions look like unfinished
work and are not.

**Read `CLAUDE.md` first** — it is the rulebook and §7 is the durable money/schema
record. This file is a POINTER to §7, never the record itself. It holds CURRENT
STATE only.

**Everything below was re-measured while writing it** — git, the migration count
and head, the adoption counts, the dictionary size, the live lookup rows, the
residual ternaries, and every PARKED item. Nothing is copied forward from the
previous refresh and nothing is quoted from a commit message. Per `CLAUDE.md` §5.
The database facts were read from the LIVE DB through MCP, not from the migration
files: the DB outranks the notes.

**THE SENTENCE TO STOP CARRYING FORWARD — it is now INVERTED, not merely stale:**
*"Built-in staff roles and leave types are translated BY KEY off the stable lookup
`key`; built-ins are NEVER routed through `label_ar`."* Every previous refresh
asserted it and §5 made it a ruling. **`524539f` reversed it.** Built-ins are now
routed through `label_ar` and their names are GONE from the dictionary. §3 and §5
carry the replacement.

**THE PREVIOUS REFRESH WAS 18 COMMITS STALE.** It was written at `974dd04` and
described state at `d368293`; Archive, Trips, the invoice email, four wording
sweeps and this batch all landed after it. It still said Archive and Trips were
*"both at zero wiring."* Both are done. §1 lists what it missed.

The pre-trim document (every earlier handoff, verbatim) remains one command away:

```
git show d368293:.planning/HANDOFF.md
```

---

## 1. COMMITS SINCE THE LAST REFRESH — 18, oldest first

`974dd04` was the last refresh itself. Everything below landed after it and none
of it is described in the version of this file it replaced.

| Hash | Date | What it did |
|---|---|---|
| `41fa5c7` | 08-28 | **Batch 8 — Arabic for the Archive route** |
| `1b9b439` | 08-28 | chore — stale/racing launch entries |
| `662162e` | 08-28 | **Batch 9 — Arabic for the Trips route** |
| `f4196e4` | 08-28 | bump-percentage label reads تراكمية, matching its mode |
| `cee27a9` | 08-28 | Arabic for the on-screen invoice popup |
| `d315c03` | 08-28 | every invoice EMAIL bilingual, Arabic block above English |
| `91a3e11` | 08-29 | **Batch A** — strings that still rendered English in Arabic mode |
| `4e6923f` | 08-29 | RTL layout: logical properties, mirrored directional icons |
| `7bfdb47` | 08-29 | unified Arabic terminology across app, PDF, inventory |
| `35b085c` | 08-29 | the tax word in Arabic prose; dropped the last معلّق |
| `84c2714` | 08-29 | finished the pending sweep; Pending Review got its word back |
| `98798f0` | 08-29 | lang / dir / theme rendered from COOKIES so first paint is correct |
| `3da0a9d` | 08-29 | last inline maintenance copy into the dictionary |
| `8c98640` | 08-29 | inventory screens' inline Arabic into the dictionary |
| `d6c91b4` | 08-29 | maintenance calendar month names from the dictionary |
| `287336e` | 08-29 | weekday Arabic settled on one wording, in `common` |
| **`524539f`** | **08-29** | **role + leave-type names resolve from the ROW, not the dictionary** |
| **`2952549`** | **08-29** | **header account subtitle switches with the app language** |

The last two are THIS batch and §3 documents them. The sixteen before them were
not executed in this session and are reported from measurement and their subjects,
not from having built them — treat their internals as unverified here.

**The language cookie is no longer deferred.** `98798f0` shipped it. The previous
refresh listed it under out-of-scope; that line is struck.

### Phase 3 route batches — complete

| | Route / area | Commit |
|---|---|---|
| Batch 1 | customers, projects, login | `f4cd71f` |
| Batch 2a | shared chrome + shared field components | `a727a8b` |
| Batch 2b | the five Settings panels | `8b21143` |
| Batch 3 | Dashboard | `6e3cad2` |
| Batch 4 | Fleet | `f1f66c9`, wording corrected in `0dffbc0` |
| Batch 5 | Consumption (the تصريح→إذن sweep folded IN) | `a4bf764` |
| Batch 6 | Reports (Sales-Returns wording + Daily-Trips RTL fix folded IN) | `c736ff1` |
| Batch 7 | Drivers | `aa517eb` |
| **Batch 8** | **Archive** | **`41fa5c7`** |
| **Batch 9** | **Trips** | **`662162e`** |

Phase 1 is `1e5ab78` (Cairo self-hosted, Arabic only, scoped by `unicode-range`
so English is byte-identical as a property of the CSS). Phase 2 is `9e60b8f`,
`6fc9917`, `8b7ab8d`, `79a12db` — digit safety ×2, `arText()`, type-safe `t()`.

**Follow-ups that are NOT their own commits and should not be looked for:** the
consumption إذن sweep is inside `a4bf764`; the Reports wording and RTL fixes are
inside `c736ff1`.

### Landed AFTER this refresh was first written — housekeeping, same session

Kept out of the table above so "since the last refresh" keeps meaning what it
says. This file is the refresh; these four followed it.

| Hash | Date | What it did |
|---|---|---|
| `3b84df1` | 08-29 | this refresh itself, plus the guard recorded RED |
| `96f4b2a` | 08-29 | the guard INVERTED and renamed — §6 |
| `6b3c0c2` | 08-29 | `.claude/settings.json` ignored — §9 item 2 |
| `f56457d` | 08-29 | `.planning/SESSION-HANDOFF.md` deleted, §9 item 1 corrected |

---

## 2. CURRENT STATE

```
$ git status --porcelain
                              ← EMPTY
$ git rev-list --left-right --count origin/main...HEAD
0	0
```

**THE TREE IS FULLY CLEAN.** `.claude/settings.json` was the last stray and is now
ignored (§9 item 2). **A dirty tree here means something real** — there is no
standing "step around this one file" exception left to remember.

**Both `HANDOFF.json`s stay out of the way and neither is ever staged:**
`.planning/HANDOFF.json` and `preview/.planning/HANDOFF.json` are gitignored
(`.gitignore:21-22`) and untracked. They are gsd's, rewritten from an empty
template after tool calls. `HANDOFF-for-review.md` is a gitignored root-level
DRAFT (`.gitignore:27`), scratch, never committed. **This file —
`.planning/HANDOFF.md` — is the deliverable.**

**The per-batch byte-identity harness stays SCRATCH in `/tmp`, rebuilt each
batch, never committed.** This batch used `/tmp/f-verify.mjs` and then
`/tmp/subtitle-verify.mjs`. It diffs the working dictionary against
`git show HEAD:lib/i18n.ts`, so its baseline can never be a hand-copied list —
and it imports `typescript` by absolute path, which is precisely why it cannot
live in the repo. The COMMITTED guard is
`scripts/i18n-lookup-single-source-check.mjs` — green, and §6 says what it now
asserts.

**A SCRATCH HARNESS GOES STALE THE MOMENT YOU COMMIT.** `/tmp/f-verify.mjs`
compared against `HEAD`, so once `524539f` landed, `HEAD` became the very commit
it was grading and it reported zero removals as a failure. It was RETIRED and
replaced rather than patched: a check whose premise has moved is not a check.

**Staging gate that held and should keep holding:** stage by explicit path, one
`git add` per file, `git status` to confirm the set, then read the staged BLOBS
back with `git show :<path>` — not the working tree. Per `CLAUDE.md` §5, a file
can be correct on disk and blank in the index.

---

## 3. THE ARABIC EFFORT — scope, state, rules

### SCOPE — Option 1, set by Turki at the Phase 1 boundary, not reopened

Translate user-facing **SCREEN** text. Explicitly OUT for this MVP:

- **Server-action `error:` strings.** ~334 sites across the `actions.ts` files,
  all with zero i18n imports. Breaking the boundary in one route is worse than
  the boundary. It held through this batch: `524539f` edited
  `app/drivers/actions.ts` and added, removed and reworded **zero** `error:`
  strings.
- **DB `raise` messages.** Ruling settled, count unverified — the old ~236 figure
  was never re-derived and a naive grep across all migrations returns a different
  measurement. Out of scope either way.
- ~~The language cookie~~ — **SHIPPED in `98798f0`.** Lang, dir and theme now
  render from cookies so the first paint is correct. Struck from this list.

### DONE — every route is wired

Adoption measured recursively (tsx importing `@/lib/i18n` / total tsx):

```
  app/drivers      9/10       app/reports      8/9
  app/maintenance  9/11       app/consumption  4/5
  app/inventory    3/4        app/fleet        3/5
  app/projects     2/3        app/customers    1/2
  app/login        1/1        app/archive      7/9
  app/trips       16/17
```

**No denominator is a gap.** Every unwired file was opened. They are server
fetches (`page.tsx` in archive, trips, maintenance, fleet ×2) or presentational
components whose only capital-letter strings are COMMENTS —
`app/archive/SubTabPicker.tsx` and `app/maintenance/MtStatusPill.tsx`. A future
refresh will read `7/9` as two missing files; it is not.

Dictionary **3401 leaves**, `lib/i18n.ts` **9584 lines**. The leaf count is the
AST walk's — nodes carrying BOTH an `en` and an `ar` string literal, the same
definition the guard and the byte-identity prover use. It is DOWN 10 from the
3411 at `HEAD~2`, which is this batch: the ten built-in role and leave-type names
were deleted, not added.

### THIS BATCH — the row is the source of a lookup's name

**`524539f` — 10 files, +365 / −156.** The `drivers.role.*` and
`drivers.leaveType.*` dictionary blocks are DELETED. A role or leave type is now
named by its own row:

```ts
const roleName = (key: string) => {
  const row = staffRoles.find((r) => r.key === key);
  return row ? arText(row.label, row.label_ar, lang) : key;
};
```

`StaffTab.tsx:111` is the ONE place a role is named and feeds all four render
sites (staff row `:423`, detail header `:454`, detail cell `:460`, role dropdown
`:579`). `LeaveSection.tsx:78` is its exact counterpart for leave types
(`:129`, `:185`, `:242`). `label_ar` was re-added to `StaffRole`
(`lib/db-types.ts:321`) and `LeaveType` (`lib/leave.ts:21`) and to both lookup
`select`s in `app/drivers/page.tsx:111,123`.

**`2952549` — 2 files, +21 / −4.** The header account subtitle was the last role
render that did not follow the app language. `lib/actions/identity.ts` now
selects `label, label_ar` and `Viewer` carries `roleLabelAr: string | null`;
`components/AppShell.tsx:956` resolves it through the same `arText`. Note the
deliberate `??` → `||`: an empty subtitle must fall through to the email.

**THE MODEL IS ASYMMETRIC ON PURPOSE, AND THE ASYMMETRY IS THE WHOLE DESIGN.**
`label_ar` is on the READ path only. The create form takes **ONE** field and
writes `label` alone — Batch F built it that way and this batch did not touch it.
So only the SEEDED built-ins carry Arabic; every custom row falls back to its
typed label in both languages, which is correct, because a custom label is what a
human typed and there is no second thing to show. Do not "finish" this by adding
an Arabic box to the form.

**THE ACCEPTED REGRESSION, stated so nobody rediscovers it as a bug.** The old
by-key arm never consulted the fetched rows, so a built-in still read correctly
if its row were ever deactivated out of the list the page passes down. The new
arm does consult them, so a deactivated built-in falls back to its raw `key`.
Traded knowingly for a single source of truth. The comment in `LeaveSection`
records it.

**The existing custom rows stay English, and this is CLOSED, not open.** Turki's
call: they are dummy data and will be replaced at launch. Do not build an edit
path for them, and do not re-raise it.

### TWO AMBIGUOUS DICTIONARY LEAVES — a trap that has already caught one pass

Both survive at other keys and a count-based or grep-based check will misread
them. **Disambiguate by the ARABIC, never by the English and never by counting:**

| English | Arabic | What it is | Status |
|---|---|---|---|
| `Mechanic` | `فني ميكانيكي` | the deleted ROLE leaf | **removed** |
| `Mechanic` | `الفني` | `common.mechanic`, a work-order field label | **survives** |
| `Off duty` | `خارج الخدمة` | the deleted LEAVE TYPE leaf | **removed** |
| `Off duty` | `غير مكلف` | driver state, ×3 | **survives** |

A file-wide grep for `off_duty` returns the driver-state string FIRST. Seeding a
migration from it puts the wrong Arabic in `leave_types`. `0170`'s header carries
the same warning.

### RESIDUAL INLINE TERNARIES — 21, and NONE is untranslated UI copy

Measured `grep -rnE 'lang *=== *"ar"'` across `app`, `lib`, `components`. Down
from 542 at the Batch-5 refresh and 22 at the last one. **The number is now small
enough that a future refresh will read 21 as 21 missing strings and go hunting,
so here is what it actually is.** By file:

```
  lib/i18n.ts 3 (comments)          app/DashboardClient.tsx 3
  NewWorkOrderModal 2               NewOutsourcedJobModal 2
  lib/utils.ts 1 (comment)          lib/dashboard.ts 1 (Intl locale)
  NotificationsSection 1            IssuesSection 1
  GlobalSearch 1                    AppShell.tsx 1 (sets document.dir)
  InventoryClient 1                 PartsUsageTab 1 (SVG x-coord, the viewBox trap)
  app/layout.tsx 1                  app/routes/page.tsx 1   app/iot/page.tsx 1
```

Four are prose comments. Four are legitimate mechanism — `AppShell` sets
`document.dir`, `layout.tsx` is `98798f0`'s cookie-driven first paint,
`lib/dashboard.ts` picks the `Intl` locale, and `PartsUsageTab` mirrors an SVG
x-coordinate, which is the CORRECT fix for the `viewBox` trap, not a leftover.
The rest — 13 — select from a BILINGUAL DATA PAIR, and **every one was opened and
cleared: §8 item 3 is CLOSED, not pending.** Read it before treating any number
here as a defect count. `app/iot` and `app/routes` are the deferred IoT and
Route-Optimization pages.

**`MaintenanceCalendar` is no longer on this list** — `d6c91b4` and `287336e`
moved its month and weekday arrays into the dictionary.

### PROCESS GATE — mandatory, no exceptions

**code-complete → machine checks → STOP → report → wait for Turki's IN-BROWSER
go-ahead → THEN commit + push.**

Never commit before his OK. It held for both commits in this batch. It is what
caught the Fleet wording, the consumption إذن reversal and the Sales-Returns
wording. The report he reads must group FINANCIAL / ACCOUNTING terms separately
from plain UI chrome — that grouping is his reading pass.

---

## 4. DB STATE — MOVED. 0168 → 0171.

**Highest migration FILE `0171_preferred_language_login_only.sql`. 169 `.sql`
files.** `0168`, `0169` and `0170` are all applied and verified live. **`0171` is
applied only IN PART — see §10, which is the one open item in this file.**

**Do NOT read `supabase_migrations.schema_migrations` to answer "what is the DB
head".** It stops at `20260824231520` and contains ZERO `017x` rows, because our
migrations are run by hand in the SQL Editor (`CLAUDE.md` §1) and never register
there. That table will always look stale and is not evidence of anything. Verify
a migration by reading the OBJECT it changed — that is how §10's finding surfaced.

| Migration | What it does |
|---|---|
| `0168_lookup_label_ar.sql` | adds nullable `label_ar` to `staff_roles` and `leave_types` |
| `0169_builtin_role_labels_bilingual.sql` | seeds Arabic for the **5 built-in roles** |
| `0170_builtin_leave_type_labels_bilingual.sql` | seeds Arabic for the **4 built-in leave types** |
| `0171_preferred_language_login_only.sql` | comment-only. Retires 0159's "do not wire" ban on `preferred_language`. **Half-applied — §10.** |

0169 and 0170 are DATA ONLY — no schema change, no table created, so
`CLAUDE.md` §6's anon-revoke footer does not apply. Both are idempotent, both
guard every statement with `and is_default = true` so the custom rows cannot be
hit, and both end with a `do $$` block that byte-compares BOTH columns inside the
transaction and rolls back all of them on any mismatch.

### Live lookup rows — 14 total, 9 built-in, 5 custom. Read from the LIVE DB.

| table | built-in — ALL now carry `label_ar` | custom — `label_ar` NULL, by design |
|---|---|---|
| `staff_roles` | `fleet_manager` مدير الأسطول · `ops_supervisor` مشرف العمليات · `mechanic` ميكانيكي · `inventory_clerk` أمين مستودع · `dispatcher` منسّق حركة | `finance`, `head_of_maintenance`, `night_dispatcher` |
| `leave_types` | `paid` إجازة مدفوعة · `sick` إجازة مرضية · `unpaid` إجازة غير مدفوعة · `off_duty` خارج الخدمة | `night_off`, `travel_meeting` |

**The previous refresh's "ALL `label_ar` NULL" is dead.** All 9 built-ins are
populated; all 5 customs are null and stay null.

### ⚠ FOUR OF THOSE NINE ARABIC STRINGS ARE NOT THE DICTIONARY'S

**The live rows won over the file, per `CLAUDE.md` §5, and the migrations were
CORRECTED AFTER THE FACT to match what Turki actually applied.** Re-running the
dictionary's wording would silently overwrite his.

| key | applied and live | what the deleted dictionary said |
|---|---|---|
| `mechanic` | ميكانيكي | فني ميكانيكي |
| `inventory_clerk` | أمين مستودع | أمين المستودع |
| `dispatcher` | منسّق حركة | منسّق الحركة |
| `unpaid` | إجازة غير مدفوعة | إجازة بدون راتب |

Left alone, each file's own `do $$` byte-check would have RAISED on the next
replay. This was caught only by re-measuring against the live DB after Turki said
the migration was applied — exactly the §5 discipline, and it is the reason to
keep doing it.

**Both files were REWRITTEN IN PLACE, which was legitimate only because
`git ls-files` proved both were untracked at the time.** An applied-then-rewritten
tracked migration would be history rewriting. 0169 additionally superseded an
applied draft that MERGED both languages into `label`; its header records that,
because a fresh `db reset` replaying the merged form would have produced a state
with nothing to un-merge.

### ⚠ `label_ar` EXISTS ON SIX TABLES BUT THERE ARE **TWO DIFFERENT PATTERNS**

A `grep` for `label_ar` finds six tables and invites the conclusion that Archive
and Maintenance share this batch's model. **They do not.** Measured column lists:

| Pattern | Tables | Columns | Where the Arabic lives |
|---|---|---|---|
| **A — the ROW is the source, Arabic on BUILT-INS only** (0168–0170) | `staff_roles`, `leave_types` | `key`, **`label`**, `label_ar`, `is_default`, `active` | `arText(label, label_ar, lang)`. Built-ins seeded bilingual; customs English-only. **No dictionary involvement at all.** |
| **B — bilingual in the DB from birth** (0049, 0068, 0080, 0085) | `units`, `repairer_types`, `commission_types`, `archive_document_types` | `key`\*, **`label_en`**, `label_ar`, `active` — **no `label`, no `is_default`** | Both languages seeded as DATA. No dictionary involvement. |

\* `units` keys on `code`, not `key`.

**The two patterns have now CONVERGED on behaviour and differ only in column
names.** Both resolve through `arText` and neither consults the dictionary. That
is new as of this batch — the old Pattern A split its rows between the dictionary
and the table, which is precisely what `524539f` removed.

---

## 5. RULINGS IN FORCE

**Numbers, dates and money that the APP formats stay LATIN in both languages.**
Turki reversed toward Arabic-Indic once and then reverted; the final answer is
Latin and both digit commits are pinned to it. **Do not reopen.** Arabic-Indic is
fine in static copy and user-typed content — the rule binds app-formatted output
only. Date format is month-first, parked, not settled.

**Entity names go through `arText(base, ar, lang)`** — one rule, replacing four
drifted patterns (`8b7ab8d`):

```ts
export function arText(base: string, ar: string | null | undefined, lang: Lang): string {
  if (lang !== "ar") return base;
  const trimmed = ar?.trim();
  return trimmed ? trimmed : base;
}
```

**It returns `base` VERBATIM when `lang !== "ar"`, which is why English is
byte-identical BY CONSTRUCTION, not by observation.** This batch also proved it
empirically: the English leaf multiset in `lib/i18n.ts` was compared against
`git show HEAD:lib/i18n.ts` and the only differences were the ten intended
deletions; for `2952549` the multiset was required to be COMPLETELY unchanged,
and was.

**~~Built-ins by key; built-ins are NEVER routed through `label_ar`.~~ REVERSED
by `524539f`.** The replacement ruling: **a lookup row NAMES ITSELF. Resolve
every role and every leave type through `arText(row.label, row.label_ar, lang)`
and never through the dictionary.** There is exactly one resolver per table —
`roleName` in `StaffTab.tsx` and `typeLabel` in `LeaveSection.tsx` — plus the
header's, which reads the same two columns off `Viewer`. **Do not add a fourth
place that names a role.**

**`label_ar` is written on INSERT ONLY, never on the reactivate branch.**
Re-adding an existing name updates `active` and nothing else.

**Editing an INSERT payload is DATA, not a boundary breach.** The server-action
translation boundary is about USER-FACING MESSAGES, not about never touching the
file.

**Plural = FOUR buckets, whole sentences per bucket, never fragment-spliced.**
`one` / `two` / `few` (3–10) / `many` (11+), chosen on `% 100`, **zero folds into
`few`**. English invariant `EN[two] === EN[few] === EN[many]`, with `EN[one]`
free. Arabic inflects the noun on the number, so the count is never spliced into
a fragment.

**Never compose a display string inside a `useMemo` keyed only on data** — the
memo will not re-run on a language change. Caught three times in Batch 6.
**Never discriminate on a LABEL where the value is React state** — use the data.

**A NULLISH COALESCE ON A DISPLAY STRING IS A BUG WAITING.** `?? ` passes `""`
through, so a blank value beats a real fallback. This trap hit the bell, the
commission path and the header subtitle in one week. `identity.ts` trims and
emptiness-checks the account display name for the same reason; `AppShell.tsx:956`
uses `||`, deliberately.

**The fleet state maps are LEFT UNTOUCHED and are translated by keying off the
enum.** `DRIVER_STATE_LABELS` (`lib/driver-state.ts:43`) and
`TRUCK_OPS_STATE_LABELS` (`lib/truck-status.ts:47`) are plain-English maps read
by `DriverDutyTable.tsx:123`, `DriverRosterTable.tsx:142` and
`ProjectsBoard.tsx:1193`. Editing either map would silently change three Trips
surfaces. Fleet and Drivers both key off the same enums into `fleet.driverState.*`.

**~~`dashboard.driverState` vs `fleet.driverState` mismatch~~ — SETTLED, struck.**
Both now read متاح / غير مكلف (`lib/i18n.ts:1455-1456` and `:1506-1507`), and the
reasoning is recorded in the dictionary at `:1450-1452` and `:1771-1773`. The
Dashboard's old خامل / خارج الدوام are gone. Do not re-raise.

**Wording rulings that are settled and must not be re-litigated:** the exit-permit
noun is **«إذن» / «أذونات»**, not «تصريح» — and «إذن خروج» is the GATE PASS while
«إذن صرف» is the ISSUE NOTE, a different document in a Saudi warehouse.
Termination keeps the شطب family. Total loss carries **تالف** (button,
standalone) and **تالفة** (inside `…على أنها ___`, feminine agreement) on purpose
— do not unify them. Reversed invoicing is **المرتجع**, but the Dashboard feed
verb `invoice_voided` was deliberately LEFT as مرتجع مبيعات.
**مردودات is RETIRED and must not come back:** the noun is مرتجع / مرتجعات and
the verb is تحويل … إلى, both settled by census rather than by taste — twelve
sites already said it that way and three did not. The regression test is
`grep -rn 'مردود' lib app components` returning nothing — **scoped to code on
purpose**, since this file necessarily spells the retired word out to retire it.

**RTL: `text-align: start` resolves against the ELEMENT'S OWN direction.** Put
`dir` on an inner `<span>` that fixes only glyph order; let the outer element
inherit page direction and own alignment. And **`dir` does not reach a
`viewBox`** — SVG geometry must be mirrored in the coordinates.

---

## 6. GUARDS

### `scripts/i18n-lookup-single-source-check.mjs` — the STANDING guard. GREEN.

```
$ node scripts/i18n-lookup-single-source-check.mjs
lookup tables: 2   built-in keys enumerated: 9

SINGLE SOURCE PASS   no dictionary name exists for any of the 9 built-in lookup rows
exit=0
```

**THE INVARIANT IS THE INVERSE OF WHAT IT USED TO BE, AND THE FILE WAS RENAMED SO
NOBODY READS THE OLD ONE OFF THE NAME.** It was `i18n-seed-label-check.mjs`
(`git mv`, so `-M` shows the link) and it asserted *"every BUILT-IN row's
dictionary `en` equals the label seeded into the DB, byte for byte"* — a
comparison of two copies. `524539f` deleted one of the copies on purpose, so that
check failed by construction, on all 9 lookups, with nothing wrong in the app.

**Having only ONE copy is now the invariant.** The guard asserts that NO
dictionary leaf exists for any built-in lookup row, and that nothing at all lives
under the retired `drivers.role` / `drivers.leaveType` namespaces. The failure it
prevents is a future session re-adding `drivers.role.fleet_manager` from habit or
from an old handoff — a second name, authoritative on some screens, diverging
from the row on the rest, and invisible in English.

**IT WAS PROVEN TO FIRE, NOT JUST TO PASS.** An absence check passes trivially
when it is checking nothing, so the guard takes an optional dictionary path
purely so the negative control can run against a doctored copy. Both arms were
made to fail before the green was trusted:

```
$ node scripts/i18n-lookup-single-source-check.mjs /tmp/negctl.ts
SINGLE SOURCE FAIL   2 lookup name(s) have a second copy in the dictionary
    drivers.role.fleet_manager — dictionary says 'Fleet Manager' …
    drivers.role.made_up — namespace 'drivers.role' is retired …
```

**Run the negative control again after any edit to this file.** A guard that
cannot be made to fail is not a guard, and this one's whole job is to be absent.

Machinery kept from the old version, all of it still load-bearing: it reads the
dictionary through the TypeScript AST (never by regex — `i18n.ts` is full of
Arabic prose in comments), parses the built-in keys out of the seed migrations
rather than hand-copying a list, treats a zero-row parse as a FAILURE rather than
a pass, and derives its root from `git rev-parse --show-toplevel` with a
`process.cwd()` fallback so it runs from a tarball checkout.

**⚠ ITS `SEED_GROUPS` LIST IS HAND-MAINTAINED AND SILENT BY OMISSION.** A new
self-naming lookup table added without an entry passes green while a second name
creeps back — an omission is indistinguishable from a pass. That failure mode
survived the inversion unchanged; it is the one thing to watch.

**⚠ AND `archive_document_types` MUST NOT BE ADDED TO IT.** That table is
**Pattern B** (§4): `label_en`/`label_ar`, no `is_default`, no `label` column,
Arabic seeded as data in `0085`. Adding it would also break the guard
mechanically — the row parser is

```js
/\(\s*'([a-z0-9_]+)'\s*,\s*'([^']*)'\s*,\s*true\s*\)/gi
```

whose trailing `true` **is** the `is_default` flag. Against a Pattern-B seed it
matches nothing and the guard reports *"seed INSERT parsed to zero built-in rows."*

---

## 7. NOTHING IS NEXT — the Arabic effort is CLOSED

**Turki walked the whole app in Arabic on 2026-08-29 and reported no defects.**
That was the last open item anywhere in this file: every route is wired, §9 is
closed, and all six of §8's items are resolved — 1 and 3 by work, 6 by his ruling
that `تصريح` in the `archive_document_types` seed is correct and stays.

**THE CORRECT ANSWER TO "WHAT ARABIC WORK IS LEFT" IS: NONE. Do not manufacture
a sweep.** The read-through was the only remaining way to find a defect, because
static analysis had already run out: §8 item 3 was opened expecting thirteen
missing fallbacks and found zero, and item 1 was settled by counting usages that
were already correct rather than by discovering anything new. A session that
opens this file looking for a batch to run should say there isn't one.

What that read-through is NOT evidence of: it was a human pass over rendered
screens, so it covers wording and layout in the states he happened to visit. It
does not certify empty states, error paths, or any string behind a condition he
did not trigger. **If one of those turns up later it is a new finding, not a
reason to distrust the pass or re-run the whole effort.**

**~~The Trips `InvoiceDetailModal` RTL defect~~ — FIXED, struck.** The
`dir="rtl"` moved off the block onto an inner `<span>`
(`app/trips/InvoiceDetailModal.tsx:1378`), with the reasoning recorded at `:1365`.

**Archive's lookup table needed NO translation work** and got none —
`archive_document_types` is Pattern B and was already bilingual in the DB.

---

## 8. WAS PARKED — ALL SIX RESOLVED. Kept for the reasoning, not as a queue.

This was the end-of-effort wording pass. **There is nothing left in it.** Three
items were struck at the refresh, 1 and 3 closed by work afterwards, and 6 by
Turki's ruling. **Items 3 and 6 are the two to read before doing anything here:**
one is a defect that turned out not to exist, the other is a correct string that
looks like a missed sweep. Both invite a future session to "fix" something that
is already right.

1. ~~**The Reports Sales-Returns tail.**~~ — **DONE. Struck.** Three `ar:` values
   changed, English untouched: `lib/i18n.ts:4084`, `:4090`, `:4943`.
   **What settled it was a census, not a preference.** The house term for a
   reversed invoice is **مرتجع مبيعات** at twelve sites — the PDF, the void
   dialog, the email subject and body, the Dashboard feed, Global Search. Only
   these three said **مردودات المبيعات**, so they were the outliers and the
   twelve were the standard; `grep -rn 'مردود'` now returns nothing across
   `lib`, `app`, `components`.
   - `:4084` also had **broken definite agreement** — `فواتير المرتجعة`, an
     indefinite noun carrying a definite adjective. Now `الفواتير المرتجعة`.
     This was a grammar defect sitting inside the wording defect and neither
     the ruling nor the previous note mentioned it; it was visible only on
     reading the string.
   - `:4943` opened with **عُكس**, a verb used nowhere else. The house
     construction is `تحويل … إلى` (`:7727`, `:7918`, `:7920`), so it now reads
     `حُوِّل {v} … إلى مرتجعات مبيعات`.
   - **`:1368` `invoice_voided` was NOT touched** and must stay مرتجع مبيعات —
     §5 records that as deliberate. It is one line away from the strings that
     did change.
2. ~~`تصاريح` → `أذونات` in three Reports sites~~ — **DONE. Struck.** No
   `تصاريح` remains in `lib/i18n.ts` except at `:2655`, inside the comment that
   RECORDS the ruling, which must stay.
3. ~~**The bilingual-data-pair sites do not fall back.**~~ — **CLOSED, and it was
   never a defect. No code changed.** The audit this item asked for was done and
   it disproved the item. **Do not re-open it from the ternary count alone** —
   that count is what made this look like a bug for three refreshes.

   All 13 non-comment, non-mechanism ternaries were opened. Every one is safe,
   for one of four reasons:
   - **Static bilingual constants**, where a fallback has nothing to fall back
     from: `UTILIZATION_BAND` and the summary/widget registries
     (`DashboardClient.tsx:1130`, `:1763`, `:1809`), `NAV_DESTINATIONS`
     (`GlobalSearch.tsx:224`), and `lib/issues.ts`'s category/status pairs
     (`IssuesSection.tsx:92`) — the last deliberately kept beside the CHECK
     constraint that defines them, with the reasoning already in the file.
   - **Not a name at all:** `NotificationsSection.tsx:95` picks the language of
     one error message.
   - **Deferred routes:** `app/routes/page.tsx:115`, `app/iot/page.tsx:50`.
   - **DB-backed but blank-proof BY WRITE PATH** — the only case that needed
     real checking. `repair_descriptions` and `outsourced_descriptions` have
     `en` and `ar` both `not null` (0060:98, 0068:182), every seeded row is
     bilingual, and the sole inline-add path writes **`ar: arTrim || enTrim`**
     (`app/maintenance/actions.ts:231`, `osActions.ts:391`). An empty Arabic
     name cannot reach the table, so `NewWorkOrderModal.tsx:198`/`:543` and
     `NewOutsourcedJobModal.tsx:158`/`:450` have nothing to fall back from.
     **NOT NULL alone would not have been enough** — `''` satisfies it; the
     coalesce in the writer is what makes this true.
   - `InventoryClient.tsx:1224` is the opposite of the bug: it already uses
     `arText` for the primary name and derives the secondary from the RESOLVED
     primary, precisely so a part with no Arabic name does not print the same
     English string twice. The reasoning is in the file at `:1216`.
4. ~~The Dashboard "Idle" words~~ — **DONE. Struck.** See §5.
5. ~~`MaintenanceCalendar` keeps `MONTHS_AR` / `WEEKDAYS_AR` as component-local
   arrays~~ — **DONE. Struck.** `d6c91b4` and `287336e` moved both into the
   dictionary; `287336e` settled the weekday wording in `common`.
6. ~~**⚠ DO NOT BLANKET-REPLACE تصريح IN THE DATABASE.**~~ — **SETTLED by Turki
   on 2026-08-29: تصريح is CORRECT here and stays. Do not re-raise, and do not
   "finish" the إذن sweep by touching it.**
   `supabase/migrations/0085_archive_document_identity_fields.sql:86` seeds
   `archive_document_types` with `('permit', 'Permit', 'تصريح')`. That is an
   ARCHIVED DOCUMENT TYPE — a government or municipal permit that exists as a
   piece of paper — and the إذن ruling covers the consumption EXIT PERMIT, a
   warehouse gate pass. **Same English word, two different real-world documents,
   so the Arabic diverging is the point rather than a drift.**

   The trap this leaves behind: a future session greps `تصريح`, finds one hit
   outside the dictionary, and "completes" the sweep. **Measured — the word
   survives at exactly three places and all three are correct:**
   `0085:86` (this seed row), and `lib/i18n.ts:2645` and `:2654`, both inside the
   comment that records the إذن ruling and argues from the old word. Item 2 above
   is about the PLURAL `تصاريح`, which survives only at `:2655` in that same
   comment — a different string, so do not treat the two greps as one.

---

## 9. CLOSED — both items settled this session, kept for the reasoning

1. ~~Two ORPHAN tracked handoff files~~ — **SETTLED. Struck, and the description
   was wrong.** They were never a pile of stale state needing a decision: `974dd04`
   had already reduced both to 25-line SUPERSEDED redirect stubs holding no state
   at all. Two refreshes described them from their pre-`974dd04` size and this one
   repeated it without opening them — **a `CLAUDE.md` §5 miss on our own file, and
   the only item in this refresh that was inherited rather than measured.**
   `.planning/SESSION-HANDOFF.md` is now DELETED: nothing points at that name, so
   the stub guarded against a collision that cannot happen.
   **`HANDOFF.md` at the repo root is KEPT ON PURPOSE and must not be "cleaned
   up".** It is the highest-collision filename in the repo — a fresh session or a
   human told to "read the handoff" opens it first — and its whole job is to say
   SUPERSEDED and point here. It holds no state, so it cannot go stale.
   (`.planning/gsd-handoff-clobber-note.md` is also tracked and is a deliberate
   warning note, not an orphan.)
2. ~~`.claude/settings.json` is untracked and NOT gitignored~~ — **DONE. Struck.**
   Ignored at `.gitignore:29-32`. **The entry is deliberately narrow and must not
   be widened to `.claude/`:** `launch.json` and `skills/aquafleet-domain/SKILL.md`
   are both tracked, and that SKILL.md is the domain rulebook `CLAUDE.md` §4 tells
   every session to read before any migration or RPC work.

---

## 10. AFTER THE ARABIC WORK — FEATURE #3 SHIPPED, FEATURE #4 CLOSED UNBUILT

Two commits landed after `0c48aa9`, the state §§1-9 describe:

| Hash | Date | What it did |
|---|---|---|
| `7005dca` | 08-29 | Arabic Phase 3 is closed — the read-through passed and nothing is left |
| `e57d696` | 08-29 | **Apply the account language at login, on any device (0171)** |

### FEATURE #3 — account language at login. SHIPPED, verified in-browser.

`user_profiles.preferred_language` (0159) is now wired, at **sign-in only**. The
login select that already fetched `default_route` carries the column too; a
non-NULL value seeds the session — `lang` COOKIE and `localStorage` written
together — so the user lands in their own language on any device. **NULL changes
nothing**: no preference means the device keeps what it was showing. The header
toggle stays device-local and writes NOTHING back, so a mid-session switch holds
until the next login re-asserts the account value.

Touched: `app/login/page.tsx`, `components/AppShell.tsx` (`seedLangFromAccount`),
`lib/supabase/middleware.ts`, `lib/i18n.ts` (`hPreferredLanguage`, EN+AR),
`supabase/migrations/0171_*.sql`, plus comment corrections in `0159`,
`components/settings/ProfileSection.tsx` and `lib/actions/auth.ts`.

**THIS IS NOT A VIOLATION OF 0159'S BAN AND MUST NOT BE "CORRECTED" BACK.** 0159
forbade a *continuous two-way sync* and named the sanctioned alternative in the
same breath — a change that REPLACES localStorage rather than writing beside it.
That is exactly what shipped. The cookie is written SYNCHRONOUSLY in the login
handler, not from an effect: `router.refresh()` fires its RSC request before React
flushes passive effects, so an effect-written cookie arrives after the layout has
already rendered `<html lang>`.

### ⚠ OPEN — THE ONE ACTIONABLE ITEM IN THIS FILE

**`0171` IS HALF-APPLIED. The live `user_profiles` TABLE comment still says:**

> *"preferred_language is a display label only — the real UI language is
> localStorage[\"lang\"] and the two are allowed to disagree."*

Both clauses are now false, and the second was already false before feature #3 —
`98798f0` moved first paint to cookies, so localStorage has not been "the real UI
language" for some time. Read live from the DB, not from the file.

The COLUMN comment WAS updated and is correct in substance (login-only, toggle
does not write back, `en | ar | null`). Only the table comment was missed.

**A related divergence to know before touching either.** The live column comment
is a short hand-written paraphrase, **not the text in
`supabase/migrations/0171_*.sql`** — the file's version is several times longer
and carries the "do NOT turn this into a two-way sync" ruling and the CHECK note.
The two AGREE on behaviour and disagree on wording. Do not blind-copy one over the
other; decide which text is wanted, then apply it as a numbered migration so the
file and the database stop drifting. This is `CLAUDE.md` §6's stale-comment trap
caught in the act, and §5's "the DB outranks the notes" is why it was found at all.

### FEATURE #4 — invoice drafts. CLOSED. NO WORK NEEDED. DO NOT REOPEN.

Scoped four times as "move invoice drafts from browser storage to a server table,
per user, across devices". **Every premise it rested on was measured false.** The
feature already exists and has since `0025`.

| Claimed | Measured |
|---|---|
| drafts live in a `bousla-draft-invoice-v2` localStorage key | **no such key.** `draft-invoice` = ZERO hits repo-wide. The only four keys are `lang`, `theme`, `bousla.dashboardWidgets`, `bousla.recentSearches`. No `sessionStorage` anywhere |
| one shared key, so starting customer B destroys A's draft | **no.** `create_draft_invoice` (0030) is ONE INSERT; the trip claim is guarded `and invoice_id is null` and RAISES on a trip held elsewhere, rolling back. A's draft is untouched |
| only one draft can exist at a time | **unlimited, deliberately.** `0025`'s partial unique index on `invoice_number` allows unlimited NULLs "so multiple concurrent drafts never collide" — including several per customer |
| pricing is effective-dated by trip date (`trip_rate_snapshots`) | **no such table, no `rate_at()` resolver.** `trips.rate_sar` freezes at the DELIVERY moment. Effective-dated CUSTOMER rates remain DEFERRED in `CLAUDE.md` §7 |
| no invoice or draft is ever hard-deleted | **false.** `delete_draft_invoice()` (0030) runs `delete from public.invoices` behind a draft-only status gate. Confirmed invoices are voided, never deleted |

**What a draft actually is:** a row in `public.invoices` with `status = 'draft'`
(0025), visible to every authenticated user (`authenticated_all_invoices`,
`using (true)`), reserving its trips exclusively under 0030. Server-side,
per-customer, cross-device, concurrent — the whole feature, already built. The
only client-only state in the create flow is TWO DATE INPUTS
(`app/trips/InvoicesModal.tsx`, `periodStart` / `periodEnd`, defaulting to
`todayKey()`), because trip assembly happens server-side inside
`createDraftInvoice`.

**The `invoice_drafts` episode, recorded so it is not repeated.** A table by that
name was drafted as `0172`, applied by hand, then dropped once the premises were
disproved; the migration file has been DELETED and never reached a commit. It
would have been a SECOND, PRIVATE draft store beside the real one, reserving
nothing — two users could have assembled overlapping trip selections with no
collision detected until confirm. Verified after the drop:
`to_regclass('public.invoice_drafts')` is NULL, its trigger function is gone, and
the SHARED `set_updated_at()` survived intact, still serving four triggers
(`deferred_deliveries`, `issue_reports`, `notification_thresholds_user`,
`user_profiles`) — a `drop … cascade` reaching that function would have silently
stopped `updated_at` on all four.

**If a future session is asked to "move invoice drafts server-side": the answer is
that they are already there.** Ask what was actually observed before building.
