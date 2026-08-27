# SESSION HANDOFF — Arabic Phase 3: TEN AREAS TRANSLATED, TWO LEFT, AND THE EFFORT HAS NOW TOUCHED SQL

**HEAD `d368293` · branch `main` · 0 ahead / 0 behind · tree CLEAN · DB head `0168`.**

**Read `CLAUDE.md` first** — it is the rulebook and §7 is the durable money/schema
record. This file is a POINTER to §7, never the record itself. It holds CURRENT
STATE only.

**Everything below was re-measured while writing it** — git, the migration number,
the adoption counts, the dictionary size, the lookup rows, the residual ternaries.
Nothing is copied forward from the previous refresh and nothing is quoted from a
commit message. Per `CLAUDE.md` §5. The database facts were read from the LIVE DB
through MCP, not from the migration files: the DB outranks the notes.

**THE ONE SENTENCE TO STOP CARRYING FORWARD:** *"the Arabic effort has touched no
SQL."* It was true for fourteen commits and every prior refresh asserted it.
`0168` is applied and live. §4 has the replacement.

**THIS FILE WAS TRIMMED AT THIS REFRESH.** The previous version was 4,849 lines —
a live section plus a verbatim archive of every earlier handoff. The archive was
removed. **Nothing is lost: it is one command away, forever.**

```
git show d368293:.planning/HANDOFF.md      ← the full pre-trim document
```

---

## 1. COMMITS — this session, in order

| Hash | What it did |
|---|---|
| `aa517eb` | **Batch 7 — Arabic for the Drivers route**, plus the built-in leave-type labels |
| `fedbafc` | chore — tracked the Batch 7 byte-identity prover; **superseded, see below** |
| `b56f0bd` | chore — reduced that prover to a self-contained seed-label check, untracked `preview/.planning/HANDOFF.json` |
| `d368293` | **feat — migration 0168: optional Arabic for CUSTOM staff roles and leave types** |

**`fedbafc` and `b56f0bd` are ONE unit, not two.** `fedbafc` committed the prover
as it stood: an absolute `ROOT`, five `/tmp/b7-*` inputs that exist on no other
machine, and five checks of which four could never run from a clean checkout.
`b56f0bd` reduced it to the one check that is a genuine standing invariant and
renamed it to match (`i18n-byte-identity.mjs` → `i18n-seed-label-check.mjs`,
`git mv`; similarity is 3%, so only `-M1%` shows the rename link).

### Phase 3 to date

| | Route / area | Commit |
|---|---|---|
| Batch 1 | customers, projects, login | `f4cd71f` |
| Batch 2a | shared chrome + shared field components | `a727a8b` |
| Batch 2b | the five Settings panels | `8b21143` |
| Batch 3 | Dashboard | `6e3cad2` |
| Batch 4 | Fleet | `f1f66c9`, wording corrected in `0dffbc0` |
| Batch 5 | Consumption (the تصريح→إذن sweep folded IN) | `a4bf764` |
| Batch 6 | Reports (Sales-Returns wording + Daily-Trips RTL fix folded IN) | `c736ff1` |
| **Batch 7** | **Drivers** | **`aa517eb`** |

Phase 1 is `1e5ab78` (Cairo self-hosted, Arabic only, scoped by `unicode-range`
so English is byte-identical as a property of the CSS). Phase 2 is `9e60b8f`,
`6fc9917`, `8b7ab8d`, `79a12db` — digit safety ×2, `arText()`, and type-safe `t()`.

**Follow-ups that are NOT their own commits and should not be looked for:** the
consumption إذن sweep is inside `a4bf764`; the Reports wording and RTL fixes are
inside `c736ff1`. Both folded on Turki's instruction after he re-verified in the
browser. Fleet is the one area that needed a second commit, because its review
came after `f1f66c9` had already shipped.

---

## 2. CURRENT STATE

```
$ git status --porcelain
                              ← EMPTY
$ git rev-list --left-right --count origin/main...HEAD
0	0
```

**THE TREE IS FULLY CLEAN — a first for this document.** Every previous refresh
recorded exactly one dirty file, `preview/.planning/HANDOFF.json`, and warned
never to stage it. `b56f0bd` untracked it, so it no longer appears at all.

**Both `HANDOFF.json`s are now out of the way and neither is ever staged:**
`.planning/HANDOFF.json` and `preview/.planning/HANDOFF.json` are both gitignored
(`.gitignore:21-22`) and both untracked. They are gsd's, rewritten from an empty
template after tool calls. **The standing instruction to *step around* a dirty
file is obsolete — a dirty tree here now means something real.**

`HANDOFF-for-review.md` is a gitignored root-level DRAFT (`.gitignore:27`). It is
scratch and is never committed. **This file — `.planning/HANDOFF.md` — is the
deliverable.**

**The per-batch byte-identity harness stays SCRATCH in `/tmp`, rebuilt each
batch, never committed.** Batch 7's was `/tmp/b7-*`; 0168's was
`/tmp/b8-nodrift.mjs`. It diffs the working dictionary against
`git show HEAD:lib/i18n.ts` through the same AST walk, so its baseline can never
be a hand-copied list — and it imports `typescript` by absolute path, which is
precisely why it cannot live in the repo. The COMMITTED guard is
`scripts/i18n-seed-label-check.mjs`; see §6.

**Staging gate that held and should keep holding:** the 0168 commit staged nine
explicit paths, one `git add` each, confirmed `git diff --cached --name-only |
wc -l` = 9, then read the staged BLOBS back with `git show :<path>` — not the
working tree. Per `CLAUDE.md` §5, a file can be correct on disk and blank in the
index.

---

## 3. THE ARABIC EFFORT — scope, state, rules

### SCOPE — Option 1, set by Turki at the Phase 1 boundary, not reopened

Translate user-facing **SCREEN** text. Explicitly OUT for this MVP:

- **Server-action `error:` strings.** ~334 sites across the `actions.ts` files,
  all with zero i18n imports. **The boundary held through Batch 7 and through
  0168, verified:** `app/drivers/actions.ts` still measures **52** `error: "…"`
  sites and still imports i18n **zero** times, even though 0168 rewrote two of
  its functions. Breaking the boundary in one route is worse than the boundary.
- **DB `raise` messages.** Ruling settled, count unverified — the old ~236 figure
  was never re-derived and a naive grep across all migrations returns 679, which
  is a different measurement. Out of scope either way.
- **The language cookie — DEFERRED.** Language is app state, not a persisted
  preference. Nothing in Phase 3 depends on changing that.

### DONE — 10 areas

shared chrome · settings · customers · projects · login · dashboard · fleet ·
consumption · reports · **drivers**

Adoption measured recursively (tsx importing `@/lib/i18n` / total tsx):

```
  app/drivers      9/10       app/reports      8/9
  app/maintenance  9/11       app/consumption  4/5
  app/inventory    3/4        app/fleet        3/5
  app/projects     2/3        app/customers    1/2
  app/login        1/1
```

Denominators are not all reached because server components and pure-layout files
carry no strings. **Drivers' one gap is `app/drivers/page.tsx`** — confirmed by
`comm` against the import list. It is the server fetch and holds 0 strings, so
9/10 is complete, not partial.

Dictionary **2088 leaves**, `lib/i18n.ts` **5597 lines** (was 1726 / 4844 at the
Batch 6 refresh). The leaf count is the AST walk's — nodes carrying BOTH an `en`
and an `ar` string literal, the same definition the byte-identity prover uses.

### REMAINING — 2 routes, both at zero wiring

```
  app/archive      0/9    ← next
  app/trips        0/17
```

**Archive is NOT a clean slate.** `ArchiveClient.tsx:95` imports
`../drivers/HistoryTab` and renders it at `:703`, and Batch 7 translated that
component. The Historical section inside Archive is Arabic today while everything
around it is English. That was accepted deliberately when Batch 7 shipped — warn
Turki if he opens Archive before its batch.

### BATCH 7 SPECIFICS — what shipped in the Drivers route

11 files, 1507 insertions, 517 deletions: all nine `app/drivers/*.tsx` that carry
strings, plus `lib/commission-rows.ts` and `lib/i18n.ts` (+748 dictionary lines).
Census was **345 user-facing strings, 242 distinct across 9 tsx files**.

**All four tabs translated** — Drivers, Commissions, Historical, Management &
Staff. `HistoryTab` is shared with Archive; `LeaveSection`, `SalaryHistoryModal`,
`PersonIdLink` and `LookupSelect` each mount in BOTH the driver and staff detail
modals, so translating one moved two tabs.

**Built-in staff roles and leave types are translated BY KEY** off the stable
lookup `key`, never off a label. **CUSTOM rows carry Arabic via `label_ar`
(0168), captured at CREATION ONLY** — no edit and no deactivate UI exists.

**The existing custom rows stay English, and this is CLOSED, not open.** Turki's
call: they are dummy data and will be replaced at launch. Do not build an edit
path for them, and do not re-raise it.

### RESIDUAL INLINE TERNARIES — 22, and NONE is untranslated UI copy

Measured `grep -rnE 'lang *=== *"ar"'` across `app`, `lib`, `components`. Down
from 542 at the Batch-5 refresh. **The number is now small enough that a future
refresh will read 22 as 22 missing strings and go hunting, so here is what it
actually is.** All 22 were read:

| Kind | n | Where |
|---|---|---|
| Comments / prose, not code | 4 | `lib/i18n.ts:5541,5542,5577`, `lib/utils.ts:118` |
| Legitimate mechanism | 3 | `AppShell.tsx:229` sets `document.dir`; `lib/dashboard.ts:158` picks the `Intl` locale; `PartsUsageTab.tsx:835` mirrors an **SVG x-coordinate** — the `viewBox` trap, which is the correct fix, not a leftover |
| Selecting from a BILINGUAL DATA PAIR | 13 | `DashboardClient` ×3, `IssuesSection` ×3, `NewWorkOrderModal` ×2, `NewOutsourcedJobModal` ×2, `GlobalSearch:224`, `InventoryClient:1216`, `NotificationsSection:194`, plus `iot/page.tsx:50` and `routes/page.tsx:115` on the two DEFERRED-feature pages |
| Static copy arrays — the one real residue | 2 | `MaintenanceCalendar.tsx:147-148`, arrays at `:68,:70` |

`app/iot` and `app/routes` are the deferred IoT and Route-Optimization pages and
are **not** in the remaining-routes list on purpose.

### PROCESS GATE — mandatory, no exceptions

**code-complete → machine checks → STOP → report → wait for Turki's IN-BROWSER
go-ahead → THEN commit + push.**

Never commit before his OK. This has held for every Phase 3 batch and it is what
caught the Fleet wording, the consumption إذن reversal and the Sales-Returns
wording. The report he reads must group FINANCIAL / ACCOUNTING terms separately
from plain UI chrome — that grouping is his reading pass, and it is why the
census split exists.

---

## 4. DB STATE — MOVED. 0167 → 0168.

**Highest migration `0168_lookup_label_ar.sql`. 166 `.sql` files.** Applied and
verified live.

Phases 1 and 2 and Batches 1–7 touched no SQL at all. `d368293` is the single
exception and it is deliberately narrow:

```sql
alter table public.staff_roles add column if not exists label_ar text;
alter table public.leave_types add column if not exists label_ar text;
```

Read back from the LIVE DB, not from the file:

| table | column | type | not null | anon select |
|---|---|---|---|---|
| `staff_roles` | `label_ar` | `text` | false | **false** |
| `leave_types` | `label_ar` | `text` | false | **false** |

Additive, nullable, no backfill, no new grant, no new policy — the column
inherits table-level grants and the existing permissive `authenticated` RLS
policy, and no table is created, so `CLAUDE.md` §6's anon-revoke footer does not
apply. **That was the migration header's claim; the `anon select` column above is
it measured rather than asserted.**

### Live lookup rows — 14 total, 9 built-in, 5 custom, ALL `label_ar` NULL

| table | built-in (`is_default`) | custom | `label_ar` set |
|---|---|---|---|
| `staff_roles` | 5 — `fleet_manager`, `ops_supervisor`, `mechanic`, `inventory_clerk`, `dispatcher` | 3 — `finance`, `head_of_maintenance`, `night_dispatcher` | 0 |
| `leave_types` | 4 — `paid`, `sick`, `unpaid`, `off_duty` | 2 — `travel_meeting`, `night_off` | 0 |

The five custom rows are the dummy data Turki is replacing at launch.

### ⚠ `label_ar` EXISTS ON SIX TABLES BUT THERE ARE **TWO DIFFERENT PATTERNS**

This is the correction that matters most in this refresh. A `grep` for `label_ar`
finds six tables and invites the conclusion that Archive and Maintenance inherit
0168's pattern. **They do not.** Measured column lists:

| Pattern | Tables | Columns | Where the Arabic lives |
|---|---|---|---|
| **A — dictionary by key, `label_ar` for CUSTOM rows only** (0168) | `staff_roles`, `leave_types` | `key`, **`label`**, `label_ar`, `is_default`, `active` | Built-ins in `lib/i18n.ts`; custom rows in `label_ar` |
| **B — bilingual in the DB from birth** (0049, 0068, 0080, 0085) | `units`, `repairer_types`, `commission_types`, `archive_document_types` | `key`\*, **`label_en`**, `label_ar`, `active` — **no `label`, no `is_default`** | Both languages seeded as DATA. No dictionary involvement. |

\* `units` keys on `code`, not `key`.

Pattern B predates 0168 by roughly eighty migrations. Its rows were seeded with
both languages — e.g. `0085` inserts
`('license','License','رخصة')`, `('insurance','Insurance','تأمين')`. **A Pattern-B
table needs no translation work and no dictionary keys at all.**

---

## 5. RULINGS IN FORCE

**Numbers, dates and money that the APP formats stay LATIN in both languages.**
Turki reversed toward Arabic-Indic once mid-session and then reverted; the final
answer is Latin and both digit commits are pinned to it. **Do not reopen.**
Arabic-Indic is fine in static copy and user-typed content — the rule binds
app-formatted output only. Date format is month-first, parked, not settled.

**Entity names go through `arText(base, ar, lang)`** — one rule, replacing four
drifted patterns (`8b7ab8d`). Verified at `lib/i18n.ts:5555-5559`:

```ts
export function arText(base: string, ar: string | null | undefined, lang: Lang): string {
  if (lang !== "ar") return base;
  const trimmed = ar?.trim();
  return trimmed ? trimmed : base;
}
```

**It returns `base` VERBATIM when `lang !== "ar"`, which is why English is
byte-identical BY CONSTRUCTION, not by observation.** The custom-row display arm
reduces exactly to the previous `row.label` in English. The prover confirmed it
empirically too — 2087 → 2088 leaves, one added, every pre-existing `en`
byte-identical, with the negative control confirmed FIRING red first.

**Built-ins by key; customs via `label_ar ?? label`; built-ins are NEVER routed
through `label_ar`.** The built-in arm does not consult the fetched rows at all —
it goes `key → dictionary` directly, so a built-in still reads correctly if its
row were ever deactivated out of the list the page passes down.

**`label_ar` is written on INSERT ONLY, never on the reactivate branch.**
Re-adding an existing name updates `active` and nothing else; a blank Arabic box
on a re-add would otherwise null out Arabic somebody typed.

**Editing an INSERT payload is DATA, not a boundary breach.** 0168 changed what
`addStaffRole` / `addLeaveType` write. It added, removed and reworded **zero**
`error:` strings. The server-action translation boundary is about USER-FACING
MESSAGES, not about never touching the file.

**Plural = FOUR buckets, whole sentences per bucket, never fragment-spliced.**
Verified at `lib/i18n.ts:5590-5597`: `one` / `two` / `few` (3–10) / `many` (11+),
chosen on `% 100`, **zero folds into `few`**. English invariant
`EN[two] === EN[few] === EN[many]`, with `EN[one]` free. Arabic inflects the noun
on the number, so the count is never spliced into a fragment.

**Never compose a display string inside a `useMemo` keyed only on data** — the
memo will not re-run on a language change. Caught three times in Batch 6 and
avoided by name in 0168 (`LookupSelect.tsx:63,66` puts `lang` in the dep list).
**Never discriminate on a LABEL where the value is React state** — use the data.

**The fleet state maps are LEFT UNTOUCHED and are translated by keying off the
enum.** `DRIVER_STATE_LABELS` (`lib/driver-state.ts:43`) and
`TRUCK_OPS_STATE_LABELS` (`lib/truck-status.ts:47`) are plain-English maps **read
by the untranslated Trips route** at `DriverDutyTable.tsx:123`,
`DriverRosterTable.tsx:142` and `ProjectsBoard.tsx:1193`. Editing either map
would silently change three Trips surfaces. Fleet and Drivers both key off the
same enums into `fleet.driverState.*` instead — verified that Batch 7 coined
nothing new (`DriversClient.tsx:129,213,219`).

**`dashboard.driverState` vs `fleet.driverState` is a KNOWN, PARKED mismatch.**
Two vocabularies on one enum, and exactly two — not three:

| | `dashboard.driverState` (`:1126`) | `fleet.driverState` (`:1441`) |
|---|---|---|
| `idle` | خامل | **متاح** |
| `off_duty` | خارج الدوام | **غير مكلف** |

Fleet's wording is Turki's and is the better one: خارج الدوام reads "outside
working hours", but `off_duty` has nothing to do with the clock. Reasoning is in
the dictionary at `lib/i18n.ts:1427-1440`.

**Wording rulings that are settled and must not be re-litigated:** the exit-permit
noun is **«إذن» / «أذونات»**, not «تصريح» — and «إذن خروج» is the GATE PASS while
«إذن صرف» is the ISSUE NOTE, a different document in a Saudi warehouse, which may
never appear on that route. Termination keeps the شطب family. Total loss carries
**تالف** (button, standalone) and **تالفة** (inside `…على أنها ___`, feminine
agreement) on purpose — do not unify them. Reversed invoicing is **المرتجع**, but
the Dashboard feed verb `invoice_voided` was deliberately LEFT as مرتجع مبيعات.

**RTL: `text-align: start` resolves against the ELEMENT'S OWN direction.** Put
`dir` on an inner `<span>` that fixes only glyph order; let the outer element
inherit page direction and own alignment. And **`dir` does not reach a
`viewBox`** — SVG geometry must be mirrored in the coordinates.

---

## 6. GUARDS

### `scripts/i18n-seed-label-check.mjs` — the STANDING guard. Runs green today.

**The invariant: every BUILT-IN row's dictionary `en` must equal the label seeded
into the DB, byte for byte.** It re-parses the seed migrations and compares
against the dictionary through an AST walk. 9 labels checked — 5 `staff_roles`
from `0011`, 4 `leave_types` from `0012`. Exit 0 on pass, 1 on fail, 2 on fatal.

Self-contained by design: no `/tmp` inputs, and it derives its own root from
`git rev-parse --show-toplevel` with a `process.cwd()` fallback, so it runs from
any directory and from a tarball checkout with no `.git`.

**⚠ ITS `SEED_GROUPS` LIST IS HAND-MAINTAINED AND SILENT BY OMISSION.** A new
by-key lookup table added without a list entry passes green while it drifts — an
omission is indistinguishable from a pass. That is the failure mode to watch.

**⚠ BUT `archive_document_types` MUST NOT BE ADDED TO IT.** This corrects a
premise that was carried into this refresh. That table is **Pattern B** (§4): it
has `label_en`/`label_ar` and **no `is_default` and no `label` column**, its
Arabic was seeded as data in `0085`, and it is not translated by key at all.
Adding it would also break the guard mechanically — the row parser is

```js
/\(\s*'([a-z0-9_]+)'\s*,\s*'([^']*)'\s*,\s*true\s*\)/gi
```

whose trailing `true` **is** the `is_default` flag. Against a Pattern-B seed it
matches nothing and the guard reports *"seed INSERT parsed to zero built-in
rows"*. **The rule to carry forward is narrower than "any new lookup table": add
a table to `SEED_GROUPS` only if it is Pattern A — English-only seed, `is_default`
flag, Arabic in the dictionary.**

---

## 7. NEXT — Batch 8 is ARCHIVE, then Trips

**Archive first** — 9 files to Trips' 17, and Batch 7 already made part of it
Arabic, so finishing it closes an inconsistency that is visible on screen today.

**Census it before starting.** No census exists for this route. The last two
batches both used one to drive the chrome-vs-accounting split Turki reads; that
split is his review pass, not paperwork, and Archive is likely accounting-heavy.

**Archive's lookup table needs NO translation work** — `archive_document_types`
is Pattern B and already bilingual in the DB (§4, §6). Render it through
`arText(label_en, label_ar, lang)` and add nothing to the dictionary and nothing
to `SEED_GROUPS`.

**Batch 9 — Trips, 0/17, the largest remaining surface.** One defect is already
logged against it from Batch 6's RTL lesson:
`app/trips/InvoiceDetailModal.tsx:1300` has
`<div className="font-medium" dir="rtl">{nameAr}</div>` — the alignment bug
mirrored, where an Arabic customer name right-aligns while its label left-aligns
in the English UI. Fix it inside the batch. Trips also owns the three
`DRIVER_STATE_LABELS` read sites listed in §5.

---

## 8. PARKED — a wording-consistency pass at the very end

All re-verified at this refresh. Nothing struck.

1. **`تصاريح` → `أذونات` in three Reports sites.** Still live at
   `lib/i18n.ts:3106` (`reports.th.permits`), `:3808` (`reports.ops.exitPermits`),
   `:3814` (the ops narrative). The ruling is settled; the drift is `c736ff1`'s —
   it was written after the ruling. Highest-confidence item here. The fourth grep
   hit at `:2173` is inside the comment that RECORDS the reversal and must stay.
2. **The Reports Sales-Returns tail** — `reports.revenue.note` (`:3589`) and
   `reports.narrative.salesReturns` (`:4442`) still say مردودات / عُكس while the
   table now says المرتجع.
3. **The Dashboard "Idle" words** — see the two-vocabulary table in §5.
4. ~~Dashboard تصريح leftovers~~ — **CHECKED, none. Struck.**
5. **The 13 bilingual-data-pair sites in §3 do not fall back.** They read
   `lang === "ar" ? x.ar : x.en` directly; `arText()` exists precisely to return
   the base when the Arabic is blank. Not a bug today, but it is the fourth
   drifted pattern `8b7ab8d` set out to kill, surviving in 13 places. Audit
   before touching — several may be static constants where fallback is
   meaningless.
6. **`MaintenanceCalendar.tsx:68,70`** keeps `MONTHS_AR` / `WEEKDAYS_AR` as
   component-local arrays rather than dictionary leaves.
7. **⚠ DO NOT BLANKET-REPLACE تصريح IN THE DATABASE.**
   `supabase/migrations/0085` seeds `archive_document_types` with
   `('permit','Permit','تصريح')`. That is a DOCUMENT TYPE, a different domain from
   the consumption exit-permit the إذن ruling covers, and it is DB data rather
   than dictionary copy. It may well be correct as-is. **Turki's call; flagged,
   not changed.**

---

## 9. OPEN — needs a human call

1. **Two ORPHAN tracked handoff files.** `HANDOFF.md` at the repo root (329
   lines, last touched `078bf0e`, 2026-08-15) and `.planning/SESSION-HANDOFF.md`
   (424 lines, `a8cdc45`, 2026-08-17). Both predate the entire Arabic effort,
   both describe state that has moved a long way, and **`CLAUDE.md` §5 names only
   `.planning/HANDOFF.md` as ours.** A fresh session told to "read the handoff"
   could easily open the root one and act on nine-month-stale state. Options:
   delete, or add one line to each pointing here. Not touched this session.
2. **`HANDOFF-for-review.md` contained no new material.** It was offered as raw
   material for this refresh; it is **byte-identical to the committed
   `.planning/HANDOFF.md` at `d368293`** (`diff -q` → identical). It is a copy of
   the stale file, not a draft ahead of it. Everything in this refresh was
   measured from the repo and the live DB instead.
3. **The archive trim.** 4,400 lines of retained prior handoffs were removed from
   this file per the "focused current-state handoff, not a multi-thousand-line
   archive" instruction. Recover with
   `git show d368293:.planning/HANDOFF.md`. **If any of it was load-bearing, say
   so before this commits** — the durable rules it carried on reporting scope,
   VAT-inclusive vs ex-VAT cost views, and the security posture are all in
   `CLAUDE.md` §6 and §7, which is why they were judged safe to drop from here.
