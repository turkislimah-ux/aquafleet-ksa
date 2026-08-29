# SESSION HANDOFF — Arabic Phase 3: EVERY ROUTE IS WIRED, AND THE LOOKUP TABLES NOW OWN THEIR OWN NAMES

**HEAD `2952549` · branch `main` · 0 ahead / 0 behind · DB head `0170` · tree
clean except ONE untracked file, `.claude/settings.json` — never stage it (§9).**

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

---

## 2. CURRENT STATE

```
$ git status --porcelain
?? .claude/settings.json          ← untracked, NOT ignored, never staged
$ git rev-list --left-right --count origin/main...HEAD
0	0
```

**The one dirty entry is `.claude/settings.json`.** It is untracked and NOT in
`.gitignore`, so it will keep showing up in every `git status` until someone
decides whether it belongs in the repo (§9). It has been excluded by name from
every commit this session.

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
live in the repo. The COMMITTED guard is `scripts/i18n-seed-label-check.mjs`,
**and it is RED — see §6.**

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
The rest select from a BILINGUAL DATA PAIR (§8 item 3). `app/iot` and `app/routes`
are the deferred IoT and Route-Optimization pages.

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

## 4. DB STATE — MOVED. 0168 → 0170.

**Highest migration `0170_builtin_leave_type_labels_bilingual.sql`. 168 `.sql`
files.** `0168`, `0169` and `0170` are all applied and verified live.

| Migration | What it does |
|---|---|
| `0168_lookup_label_ar.sql` | adds nullable `label_ar` to `staff_roles` and `leave_types` |
| `0169_builtin_role_labels_bilingual.sql` | seeds Arabic for the **5 built-in roles** |
| `0170_builtin_leave_type_labels_bilingual.sql` | seeds Arabic for the **4 built-in leave types** |

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

**RTL: `text-align: start` resolves against the ELEMENT'S OWN direction.** Put
`dir` on an inner `<span>` that fixes only glyph order; let the outer element
inherit page direction and own alignment. And **`dir` does not reach a
`viewBox`** — SVG geometry must be mirrored in the coordinates.

---

## 6. GUARDS

### ⚠ `scripts/i18n-seed-label-check.mjs` — the STANDING guard, and it is **RED**

```
$ node scripts/i18n-seed-label-check.mjs
lookup groups: 2   built-in labels checked: 9

SEED LABEL FAIL   9 built-in label(s) disagree with the seed
    drivers.role.fleet_manager — seeded 'Fleet Manager' but no dictionary key
    …8 more, one per built-in role and leave type
exit=1
```

**This is not a defect it found — it is the guard's PREMISE being deleted.** Its
invariant was *"every BUILT-IN row's dictionary `en` must equal the label seeded
into the DB, byte for byte."* `524539f` removed the dictionary side of that
comparison on purpose, so all 9 lookups now miss and it fails by construction.
Nothing is wrong with the app. **It was left RED and not touched, because
silently rewriting a committed guard inside a documentation commit is exactly the
wrong way to retire an invariant.** It needs a call — §9 item 1.

The guard is otherwise sound and worth keeping the machinery of: it reads the
dictionary through the TypeScript AST (never by regex — `i18n.ts` is full of
Arabic prose in comments), parses the seed migrations rather than hand-copying a
list, and derives its root from `git rev-parse --show-toplevel` with a
`process.cwd()` fallback so it runs from a tarball checkout.

**⚠ ITS `SEED_GROUPS` LIST IS HAND-MAINTAINED AND SILENT BY OMISSION.** A missing
entry passes green while the table drifts — an omission is indistinguishable from
a pass. That failure mode survives whatever is decided about the invariant.

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

## 7. NEXT — no route batches remain

Every route in the app is wired. What is left is smaller and mostly listed in §8
and §9. In rough priority:

1. **Decide the guard's fate (§9 item 1).** It is red in `main` right now. That is
   the only thing here that makes a clean checkout look broken.
2. **The Sales-Returns wording tail** (§8 item 1) — the last unambiguous
   wording drift with a settled ruling behind it.
3. **A full Arabic-mode read-through with fresh eyes.** Ten batches plus five
   sweeps have landed; nobody has walked the whole app in Arabic since Trips
   shipped. Cheaper than any further static analysis at this point.

**~~The Trips `InvoiceDetailModal` RTL defect~~ — FIXED, struck.** The
`dir="rtl"` moved off the block onto an inner `<span>`
(`app/trips/InvoiceDetailModal.tsx:1378`), with the reasoning recorded at `:1365`.

**Archive's lookup table needed NO translation work** and got none —
`archive_document_types` is Pattern B and was already bilingual in the DB.

---

## 8. PARKED — a wording-consistency pass at the very end

All re-verified at this refresh. **Three items struck as DONE.**

1. **The Reports Sales-Returns tail.** Still live: `lib/i18n.ts:4084` and `:4090`
   say مردودات while the table says المرتجع, and `:4943` still opens عُكس.
   `:4084` mixes both inside one string. Highest-confidence item remaining.
2. ~~`تصاريح` → `أذونات` in three Reports sites~~ — **DONE. Struck.** No
   `تصاريح` remains in `lib/i18n.ts` except at `:2655`, inside the comment that
   RECORDS the ruling, which must stay.
3. **The bilingual-data-pair sites do not fall back.** They read
   `lang === "ar" ? x.ar : x.en` directly; `arText()` exists precisely to return
   the base when the Arabic is blank. Not a bug today, but it is the fourth
   drifted pattern `8b7ab8d` set out to kill, surviving in a handful of places
   (§3's ternary list). Audit before touching — several may be static constants
   where fallback is meaningless.
4. ~~The Dashboard "Idle" words~~ — **DONE. Struck.** See §5.
5. ~~`MaintenanceCalendar` keeps `MONTHS_AR` / `WEEKDAYS_AR` as component-local
   arrays~~ — **DONE. Struck.** `d6c91b4` and `287336e` moved both into the
   dictionary; `287336e` settled the weekday wording in `common`.
6. **⚠ DO NOT BLANKET-REPLACE تصريح IN THE DATABASE.**
   `supabase/migrations/0085` seeds `archive_document_types` with
   `('permit','Permit','تصريح')`. That is a DOCUMENT TYPE, a different domain from
   the consumption exit-permit the إذن ruling covers, and it is DB data rather
   than dictionary copy. It may well be correct as-is. **Turki's call; flagged,
   not changed.**

---

## 9. OPEN — needs a human call

1. **⚠ `scripts/i18n-seed-label-check.mjs` IS RED IN `main`.** Its invariant was
   deleted deliberately by `524539f` (§6). Three options, none taken:
   **(a) delete it** — the drift it guarded is now structurally impossible,
   because the dictionary no longer holds a second copy of these names;
   **(b) invert it** — assert that NO `drivers.role.*` / `drivers.leaveType.*`
   key exists, which turns it into a guard against the dictionary re-growing a
   second source; **(c) repoint it** at the 0169/0170 seeds and compare the
   migration files against the LIVE rows instead of against the dictionary.
   **(b) preserves the original intent most closely** and keeps the AST
   machinery earning its keep. Not decided.
2. **Two ORPHAN tracked handoff files.** `HANDOFF.md` at the repo root and
   `.planning/SESSION-HANDOFF.md`. Both predate the entire Arabic effort, both
   describe state that has moved a long way, and **`CLAUDE.md` §5 names only
   `.planning/HANDOFF.md` as ours.** A fresh session told to "read the handoff"
   could open the root one and act on badly stale state. Options: delete, or add
   one line to each pointing here. Still not touched. **This is the second
   refresh in a row to carry it forward untouched** — either do it or drop it.
   (`.planning/gsd-handoff-clobber-note.md` is also tracked and is a deliberate
   warning note, not an orphan.)
3. **`.claude/settings.json` is untracked and NOT gitignored.** It shows in every
   `git status` and has been excluded by name from each commit. Decide: commit it,
   or add it to `.gitignore`. Leaving it is how a `git add .` accident happens —
   and `CLAUDE.md` §5 forbids `git add .` precisely because of files like this.
