# SESSION HANDOFF — read this before anything else

**For:** a fresh Claude Code session with no memory of this project.
**Written:** 2026-08-17, at commit `de8e086`, tree clean and pushed.
**Then read:** `CLAUDE.md` (workflow + §7, the durable record) and the review
packs in `.planning/`. This file is the orientation; those are the depth.

---

## 1. What the project is

**AquaFleet KSA**, internal name **Bousla / بوصلة** — a fleet-management web app
for Bin Slimah Group, a 50+ year-old family water-transport and treatment
business in Riyadh. Roughly **40 trucks, 3 stations**, real operational data in
the database today.

- **Stack:** Next.js (App Router) + TypeScript + Tailwind, Supabase (Postgres).
- **Repo:** `~/aquafleet-ksa`, GitHub `turkislimah-ux/aquafleet-ksa`, branch `main`.
- **Supabase project_id:** `ceqzmztewbborwgxnrqh`. Connected over MCP — use it to
  read schema and query live data.
- **Local dev only. There is no Vercel deploy and no CI.** Nothing runs your code
  but you and Turki's browser. Dev server on **port 3002**. That means: no
  pipeline will catch what you miss, and a red build is not a safety net you have.
- **Migrations run in the Supabase SQL Editor, in a browser, by someone else.**
  See §2.

This app manages trucks, drivers, staff, trips, projects, commissions, leave,
stations, inventory, maintenance, archive, consumption, finance/invoicing,
reports and a dashboard. Every page in the roadmap that is not deferred is built.
The work now is **cleanup and polish on pages that already ship**, not new pages.

---

## 2. How we work — the two-Claude setup

There are two Claudes and one human, and the boundaries are not suggestions.

**YOU — Claude Code (this session).**
You own **every file edit** and **every design decision**: layout, styling,
spacing, component structure, interaction. Nobody overrules you on design, and
when the architect has reached into design the result has been worse — that is on
the record, not a courtesy. You also own testing and the commit discipline.

**Claude the architect (a separate chat).**
Reviews SQL and migrations against the live database, **applies them**, and holds
money safety. Specifies behaviour, data, logic, constraints and content mapping —
never visuals.

**Turki (non-technical, the founder).**
Relays between the two Claudes, verifies in the browser, and decides. He is not a
programmer: give him **tappable options with a recommendation**, not a menu of
tradeoffs he has to adjudicate. Nothing commits unverified by him except pure
internal work with a passing test.

### The migration gate — the one hard sequence

```
you draft the .sql to disk  →  STOP and report  →  architect reviews + applies
                            →  you COMMIT the file  →  confirm pushed
```

**Never self-apply a migration through the Supabase MCP.** That happened once
(`0036`/`0037`) and left stray function overloads that took a third migration
(`0038`) to clean up.

**"Applied" is not "committed", and that distinction has cost us three times.**
A migration that is applied but not committed is exactly what a database reset
drops — `v_operations_by_driver_monthly` vanished that way. **Commit the file the
moment it is confirmed applied.** Do not batch migration commits behind app work.

Migrations are numbered sequentially, `00NN_name.sql`. Check
`ls supabase/migrations/ | tail -3` before drafting. **Highest applied: `0130`.**

---

## 3. The cadence — batch cleanup work

For **cleanup and polish**, work in **batch mode**:

> survey the whole page → fix everything in one pass → test → commit → push →
> **ONE report**

Not step-by-step. Not "here's finding 1, shall I proceed?". Turki has been worn
down by micro-stepping and asked for this explicitly. Respect it.

**Stop mid-batch only for:**
- anything touching money (§4 — this one is absolute),
- a real decision with two defensible answers,
- genuine ambiguity in the brief,
- a premise in the brief that turns out to be false (say so; do not silently
  absorb it — see §5).

Everything else: keep going, report once at the end.

**What a report should contain:** what changed and why, the decisions you made
that could have gone the other way, what you tested and how, anything you found
that contradicts the brief, and what is still open. Dense is fine. Turki reads
carefully.

---

## 4. The money gate — never batch past this

**STOP and hand to the architect** before touching any of:

- **Salary** — `staff.monthly_salary_sar`, `drivers.salary_sar`,
  `salary_history`, the salary-history screen, `v_payroll_monthly`,
  `v_driver_payslip_basis`.
- **Rates** — `trips.rate_sar`, `projects.rate_per_trip_sar`, anything that
  prices delivered work.
- **Prepaid / VAT / invoice math** — `lib/prepaid.ts`, `lib/vat.ts`,
  `lib/invoice.ts`, `lib/inventory-vat.ts`. **This is the money core and it is
  off limits without an explicit ruling.**
- **Commission** — `trips.commission_sar`, `commission_payouts`, the payout
  ramp logic.

Draft the change, explain it, **STOP**. A cleanup pass does not get to move a
number that appears on a customer's invoice or a driver's payslip.

Reading these files is fine. Rendering their output differently is a design
change and is yours. Changing what they compute is not.

---

## 5. Standing rules — each one is a bug we already shipped

**0098 — a metric is defined ONCE, in SQL.** The Reports semantic layer defines
every metric in a view; the page reads views and never re-derives a number. If a
figure is missing, **the fix is a migration, not a join added to the page**. The
Dashboard was rebuilt precisely because it summed `trips.rate_sar` in TypeScript
and rendered 0 where Reports rendered 70,650.

**`create or replace view` silently drops the security footer.** Reloptions are
not preserved, so a replaced view reverts to running as OWNER and bypasses RLS on
68 RLS-enabled tables. Every view create/replace must be followed by:

```sql
alter view public.X set (security_invoker = true);
revoke all on public.X from anon;
grant select on public.X to authenticated;
```

Live count to check against: **40 views, 40 security_invoker, 0 anon-readable.**
Related: `create or replace view` can only **append** a column — it cannot insert,
reorder or rename one (error `42P16`). A new column goes at the end even if it
belongs in the middle.

**NULL is not 0 on money and price columns.** A station price of `0` means "we
fill this type, free"; `NULL` means "we do not fill this type at all". `?? 0`,
`Number(x) || 0` and truthiness checks all destroy that distinction. Same shape
elsewhere: a metric with no caveat renders **nothing**, never "N/A" and never an
em dash — both read as missing data. A figure we do not have gets no colour and
no confident zero.

**Lying comments are a recurring bug — this has bitten four times.** A comment
saying "this reconciles to X riyal-for-riyal" became false the moment X's basis
changed, with the code still asserting agreement. A comment claiming the metrics
dictionary was displayed stood for a year while nothing displayed it. **A comment
that names WHY two numbers agree survives a change; one that merely asserts they
agree goes false silently.** When you touch code, read the comment above it and
fix it if it is now wrong. That is part of the change, not a nicety.

**One source of truth — never two copies that "agree today".** Driver state has
exactly two permitted expressions (`lib/driver-state.ts` and
`v_driver_state_now`) with a drift guard comparing them on every Dashboard load;
a third was refused. Cost-slice colours were hardcoded twice and the palettes
diverged so that amber meant payroll on one page and outsourced work on another —
looked consistent, meant opposite things. When you find a shape declared twice,
give it one leaf module both sides import one-way.

**Derive expected counts from the code's own predicate.** This has slipped three
times. A verification block predicted 17 rows because the count came from live
drivers while the seed correctly included terminated ones. Another claimed "all 11
drivers have a hire date" from a query filtered to `terminated_at is null` — there
are 16, and the 5 without hire dates were exactly the terminated ones. **Count the
set your claim is about, not the set your last query happened to return.**

**UTC versus Asia/Riyadh.** Date logic uses `todayKey()` and the local-date
helpers. A view bucketing on a timestamp in UTC disagrees with the module pages
for three hours every night. Related and worse: `delivered_at` records **when the
stage button was pressed**, not when the water was delivered — this fleet advances
trips in bulk, so five weeks of work once collapsed onto three afternoons.
`trips.trip_date` is the operational day. Pick the column that means what you are
measuring.

**A failed read must never claim an empty result.** "Nothing there" and "could not
read it" are different statements and the UI distinguishes them everywhere. A page
that renders "every queue is clear" over a failed fetch is a shipped bug we
already fixed once.

**Diagnostic routes are torn down before you finish.** The pattern for verifying
something that needs auth: build a throwaway route under `app/<name>-check/`, add
a temporary bypass in `lib/supabase/middleware.ts`, run Playwright against it,
then **delete the route, revert the bypass, confirm `git diff` is empty on the
middleware, and re-check `/login` 200 + a real page 307**. The spec that drove it
stops passing at that moment — that is expected; those specs document what was
verified, they are not a standing regression suite.

**Never run `next build` or `rm -rf .next` while the dev server is live.** Doing
so served HTML 200 with every `/_next/static/*` 404 and got misdiagnosed as a UI
regression. Use `./scripts/safe-build.sh`, which exits non-zero if dev is running.
Also: `next build` **rewrites `tsconfig.json`** — `git checkout -- tsconfig.json`
afterwards.

**Commit discipline.** One logical unit per commit, each tsc-clean
(`noUnusedLocals` and `noUnusedParameters` are ON — a parameter required by a
signature gets an `_` prefix, never deletion). **Explicit-path `git add`, never
`git add .`** Quote dynamic-route paths (`git add 'app/fleet/[id]/page.tsx'` —
zsh eats `[id]`). Avoid `!` in commit messages. **Inspect the STAGED blob**
(`git show :<path>`), not the working tree — a file can be correct on disk and
blank in the index. **A shrinking diff is a stop signal.** And `git checkout --
<path>` restores from the INDEX, so recovery is `git checkout HEAD -- <path>`.

**The handoff file is `.planning/AQUAFLEET-HANDOFF.json` and it IS committed.**
The unprefixed `.planning/HANDOFF.json` belongs to the gsd plugin, is gitignored,
and is rewritten with an empty skeleton constantly — **never read it for state and
never stage it.** Empty is its correct condition here.

**The bash cwd can reset to `/Users/turkislimah` between calls.** Verify with
`pwd` or prefix with `cd /Users/turkislimah/aquafleet-ksa &&`.

---

## 6. Where we are now

**DB at migration `0130`. Working tree clean. Everything pushed. HEAD `de8e086`.**

Recently finished, newest first — pull the full detail from `CLAUDE.md` §7 and the
review packs named below:

**Metrics glossary** (`0da456b` built, `e0a5289` relocated, `102251e` recorded).
Six `report_metrics` description columns were fetched on every `/reports` load and
rendered nowhere. Now a page-level popup launched from a "Metrics dictionary"
button in the header, right of the period picker, Overview tab only. Read-only —
no view, RPC, measure or fence touched. **Three of thirty rows have a NULL caveat
and render no block at all.**

**PDFShift auth fix** (`f7ad606`). `lib/pdf.ts` sent v2-style Basic auth
(`${apiKey}:`); the v3 endpoint answers that with a flat 401. Verified against the
live API. PDF export could never have worked with a real key. `PDF_API_KEY` is
documented in `.env.local.example`, deliberately empty.

**Truck utilization** (`247f03b` = migration 0130, `903c6bc` = three surfaces).
Four views; Fleet, Dashboard and truck detail read them and **compute no
percentage themselves**. `lib/utilization.ts` holds the band thresholds and
`formatUtilization()`, the only place "N/A" appears. **N/A is not 0%** — two
trucks are out of service all month (0 available days, question has no answer)
while seven are genuinely available and idle, which is the alarm the metric
exists to raise.

**Fleet row interaction** (`0d74213` whole-row click, `9b14e77` keyboard reach,
`01ce3f2` Dashboard card placement). No `role` override on the `<tr>` —
`role="link"` would take the row out of the table's accessibility tree and cost a
screen-reader user column context on all thirteen cells.

**Effective-dated rates — the big one** (`0125`–`0129`).
- Salary history is **forward-only**, baselines dated at the employment floor
  (`COALESCE(hire_date, created_at::date)`). `0125` shipped a defect — baselines
  seeded at *today* plus a fallback to the earliest row, so a raise silently
  rewrote reported months — and `0126` fixed it forward by removing the fallback
  entirely rather than policing the collision.
- History is **trigger-maintained**. Without the triggers a new hire has no row
  and vanishes from payroll, which is a silent under-count of real wages.
- `trips.rate_sar` is a **frozen snapshot** stamped at delivery (`0128` backfilled
  816 trips; the one project-less orphan keeps its NULL — do not invent a rate).
- **Four surfaces price delivered work and all four read `trips.rate_sar`:**
  prepaid consumption, invoice lines (both `d0813b9`),
  `v_delivered_revenue_daily`, and CustomersTab's Revenue KPI (both `0129`,
  `e622b32`). **Anything reaching for `projects.rate_per_trip_sar` to price
  DELIVERED work has reintroduced the defect.** The project rate is what NEW work
  will cost, not what past work did.
- **`lib/prepaid.ts` itself was not switched — its callers were.** The module
  never fetches. The brief said to switch it; it should not be, and §7 records
  why so the instruction is not followed literally next time.
- The whole batch was proven a **no-op on existing data** before landing (737
  trips / 237,120.00 identical on both bases). Land a basis change while
  before/after is provably identical.

**StationPricing consolidation** (`1287de8`, and `aae45dd` earlier). The row shape
carrying the two price columns was hand-declared in four files; three were merged
into `WaterStationRow`. The write shape stays separate on purpose — it carries no
`key`, the immutable FK target.

**Three frozen money figures now live on a trip and they freeze at different
moments for different reasons — do not unify them:** `commission_sar` (at
delivery, gated on `payout_id`), `filling_cost_sar` (at creation, re-taken on a
station change), `rate_sar` (at delivery, ungated, never nulled).

**Review packs in `.planning/`** — `review-effective-dated-salary-0125-0126.md`,
`review-prepaid-frozen-rate.md`, `review-dictionary-0123-0124.md`,
`review-fill-cost-0122.md`, `review-payment-mode-0121.md`,
`review-monthkey-and-basis.md`, plus `finance-invoice-spec.md` (the Finance PRD)
and `gsd-handoff-clobber-note.md`.

---

## 7. Immediate next

### 7a. Staff page cleanup — do this first

Full survey of the Staff page, then fix in **one batch** (§3). Same shape as the
Fleet pass: read the whole page, list what is wrong, fix it all, test, commit,
push, one report.

**The money gate applies.** Staff carries `monthly_salary_sar` and now the
salary-history screen (`app/drivers/SalaryHistoryModal.tsx`, mounted on both the
driver and staff detail panels). Presentation of a salary is yours. **Anything
that changes what a salary figure IS, or how history resolves, stops for the
architect.** Note that the staff detail never showed salary at all until
recently — the cell and its timeline went in together deliberately, because a
salary with no history beside it is exactly the arrangement that let the value
drift unnoticed until `0125`.

### 7b. Trips page cleanup — after Staff

The most complex page in the app. Kanban board, day-scoped, week-calendar strip,
project cards, station management, trip stage transitions. **Three of the app's
freeze points fire inside `setTripStage`** (see §6) — read that action carefully
before touching anything in its path, and treat it as money.

Two specific jobs ride along with this pass:

**(i) Redesign the invoice and report VISUALS.** Turki is wiring a Canvas
connector for this. **Presentation only.** It must not change a single number, a
VAT figure, a rounding rule, or which rows appear. `lib/vat.ts` rounds at the
document level for customer invoices, quoting ZATCA's own invoice-XML rule;
`lib/inventory-vat.ts` rounds per line for parts. **Those are two separately
correct conventions for two different documents — do not "unify" them.**

**(ii) Delete two dead specs:**
- `tests/station-type-pricing.spec.ts` — targets `http://localhost:3002/trips`
  directly and depends on a `VERIFY_BYPASS` auth bypass that was reverted. With
  the gate live it redirects to `/login`; it cannot pass in any configuration.
- `tests/reports-glossary.spec.ts` — targets `/reports-glossary-check`, a
  diagnostic route deleted at teardown.

**Flag, do not silently expand:** the same condition applies to a wider set —
`dashboard-0106`, `dashboard-0107`, `dashboard-daily`,
`dashboard-delivered-revenue`, `dashboard-rebuild`, `inventory-batch`,
`inventory-polish`, `inventory-vat`, `inventory-vat-fixes` and the six
`reports-*` specs all reference routes that no longer exist. Turki named two.
Delete those two, then **ask** whether the rest should go the same way or whether
some diagnostic routes should be made permanent so the suites become real. That
question has been flagged before and never decided.

Specs that do **not** rot, for contrast: `tests/trip-station-gate.spec.ts` and
`tests/cost-colors.spec.ts` drive pure functions, need no route and no bypass.
That is the shape to prefer when you write a new one.

---

## 8. Dropped — do not chase these

- **Fleet "minor additions"** — surveyed, nothing there. Closed.
- **Missing hire dates** (5 drivers, 1 staff) — this is dummy data that gets
  replaced at real launch. `0117`'s `COALESCE(hire_date, created_at::date)`
  fallback holds correctly in the meantime. **Not a bug, not a task.** It appears
  in older handoff notes as pending; it is not.

---

## 9. Open and deferred

Parked deliberately. None is in flight. Full context for each is in `CLAUDE.md`
§7 under its own feature heading.

**Blocked on a decision or a mechanism:**
- **RBAC** — nothing beyond the per-RPC role checks that already exist. The
  payslip approval step is parked with it.
- **`0118` — driver-payslip `net_sar` in the basis view. DRAFTED, NOT APPLIED.**
  Net pay is expressed twice today (the RPC's INSERT and `payslipPreviewNet` in
  TypeScript). **Do not delete `payslipPreviewNet` until `0118` is applied**, or
  the unissued-month preview breaks.
- **Effective-dated commission config — RULED OUT OF SCOPE, do not build it.**
  Commission is already frozen (`trips.commission_sar` stamped on every delivered
  trip), so effective-dating its config would protect an already-stamped number.
  Older notes describe this as one mechanism with three consumers; that framing
  was measured and found wrong.
- **Mixed-rate invoice row splitting** and **multi-project customers with separate
  finance** (blocked by `projects_customer_id_unique` and invoices keying off
  `customer_id` only).
- **Send-from-domain email** (today is mailto-only) and a **full Settings screen**.
- **A deductions data source** for payslips (`deductions_sar` ships at 0 so the
  arithmetic is complete).
- **A daily payroll source** — would let the Dashboard's `direct_cost` become real
  cost. Today payroll has no daily grain and the view refuses to fake one.
- **Per-trip measured volume** (`trips.tank_size_m3` is empty on every trip, so
  Delivery Output uses dispatched capacity as a stated proxy).
- **Driver status-change report** — `drivers.status` is current-only, there is no
  transition history to count.
- **Idle trucks / fleet availability** on the Operations statement — need the
  fleet roster and a distinct trucks-under-maintenance count. Deliberately not
  estimated.
- **No supported clear-the-station path** — `trips.water_station` is NOT NULL with
  an FK and the slug CHECK forbids `""`, so the code's empty/NULL guards are
  currently unreachable.

**Whole features deferred:** Route Optimization (`preview/map.js` is the spec),
Predictive, IoT. Also a stored-status column cleanup migration, and the
Consumption-page schema questions (customer archive documents; an optional UNIQUE
on `drivers.iqama_number` / `staff.iqama_number` / `trucks.vehicle_registration`,
discussed and deliberately not added).

**Investigations left open:**
- **The `0101` db-reset mystery.** A reset dropped `v_operations_by_driver_monthly`
  on the theory that it was applied but uncommitted — except `0101` **was**
  committed in `c561d5c` before the drop. So the replay source may not be this
  repo's `supabase/migrations/`. **Worth pinning down before the next reset.**
- **The gsd plugin is stale** (3.4.4, current is 4.5.5). Updating crosses a major
  version; read the changelog first. The HANDOFF clobber it caused is already
  fixed at the root by moving our file, so nothing depends on this.
- **Four stale deferred-tail entries in §7** were offered for a refresh pass and
  not approved. Two long-standing §7 notes have already turned out to be **wrong
  rather than merely stale** (the Kanban entry and the `payment_model` merge).
  **Re-measure a deferred item's premise before executing on it.**

---

## Start here

1. Read `CLAUDE.md` — all of it, then §7 for the feature you are touching.
2. `git log --oneline -20` and `ls supabase/migrations/ | tail -5`.
3. Confirm the dev server is on **3002** and do not build under it.
4. Ask Turki for the Staff-page brief, survey the whole page, then batch it.
