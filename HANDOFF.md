# HANDOFF — AquaFleet KSA (Bousla / بوصلة)

**Read `CLAUDE.md` first.** That is the standing rulebook and §7 is the durable
record. This file is a *snapshot of where things stand right now*. If the two
disagree, `CLAUDE.md` §7 wins.

Rewritten 2026-08-15 at the close of the driver-payslips feature and its
cleanup pass. Every fact
below was verified live at write time — git, `supabase/migrations/`, and the
Supabase MCP — not recalled.

*(This replaces the version written hours earlier at the close of Water Station
Cost — refreshed at the close of the NEXT feature, which is the cadence this
file needs. The version before that was stale by two whole features — it still
pointed at the Dashboard as "the next phase" after the Dashboard had been
rebuilt, and named `0101` as the highest migration when `0114` was applied — and
its own predecessor was retired for the same reason. **A handoff that is not
rewritten at the close of each feature becomes actively misleading; it does not
merely age.**)*

---

## 1. App status

**Functionally complete. Every non-deferred page in the roadmap is built.**

Trips → Maintenance → Inventory → Archive → Consumption → Reports — all done.
Route Optimization, Predictive and IoT stay deliberately deferred.

Three features have landed recently, all complete and verified in-browser by
Turki:

- **Dashboard rebuilt as the CATCH-UP page** — migrations `0103`–`0109`, 13
  views. It was the last mock-data placeholder in the app; it now reads views
  for every figure and re-derives nothing in TypeScript. See `CLAUDE.md` §7 for
  the full entry, including why `0109` re-bucketed delivered revenue onto
  `trip_date`.
- **Water Station Cost** — migrations `0110`–`0114`. Per-water-type station
  pricing, a frozen per-trip cost snapshot, backfill, entry into the P&L as a
  daily-sourced direct cost, and a station/water-type gate enforced in BOTH the
  app and the database. Also verified in-browser end to end.

**Driver payslips** — migrations `0115`–`0118`. A numbered, frozen settlement
document per driver per month, on the Reports statement pack
(`?statement=payslips`), plus a commission review table beside it showing the
WORK month against the register's SETTLEMENT month. Browser-verified; two real
payslips issued (`PS-2026-000001`, `PS-2026-000002` — **keep both**).
`0117` fixed the same fabricated-hire-date defect live in the P&L: June payroll
36,000 → 25,000.

**The phase is POLISH — delivering the final MVP.** The Dashboard is no longer
the polish target; it was rebuilt rather than tidied.

No app code is half-finished. Open items are deferred by choice, not blocked —
each is listed with its blocking reason in §6 and in `CLAUDE.md` §7.

**Nothing is in flight and nothing is half-finished on disk.** `0118` — the last
outstanding item — is applied, verified and committed, and the TypeScript sum it
superseded has been deleted, so net pay now has exactly one definition (in
`v_driver_payslip_basis`, read by both the preview and the freeze).

---

## 2. Exact git state

```
HEAD          eea57ec
              eea57ec  Delete the TypeScript net sum - the drift is closed,
                       not just superseded
branch        main
origin/main   0 ahead / 0 behind
```

Working tree is clean **apart from one expected file**:

```
 M .planning/HANDOFF.json
```

**That permanent "modified" state is correct — do not fix it.** The two
HANDOFF.json files are governed differently:

- **`.planning/HANDOFF.json` — IS committed**, as a deliberate snapshot
  (Turki's call, 2026-08-07). It is owned by an auto-tool
  (`"source": "auto-postool"`) that rewrites it back to an empty template after
  tool calls. So: write it and `git add` it **in the same command**, then
  commit. The gap between writing and staging is exactly where it gets blanked.
  Confirm `git diff --cached` shows the rich version before committing —
  otherwise you commit the empty template over real content and lose it
  silently. Afterwards `git checkout -- .planning/HANDOFF.json` so the tree
  matches HEAD. It will drift again on the next tool run; that is expected.
- **`preview/.planning/HANDOFF.json` — NEVER staged.** It lives inside the
  read-only `preview/` tree and carries stale auto-tool content.

`.claude/skills/aquafleet-domain` used to contradict this — it said to keep
*both* files unstaged. Ruled and corrected (Turki via the architect,
2026-08-15): `CLAUDE.md` §5 stands, and the skill now states the split rule
explicitly rather than a single rule covering both files.

Recent history, for orientation:

```
eea57ec  Delete the TypeScript net sum - drift closed, not superseded
a7cf066  Migration 0118 - one definition of net pay, in the view
54cd342  HANDOFF.json: point at the payslips head
9136526  HANDOFF.md: refresh to the payslips head
b378c35  CLAUDE.md: payslips + the view-security standing lock
5476b24  Sweep: Note was an export with no reader
be33162  Migration 0117 - payroll stops billing for months before existing
e67b2d1  Terminated label priority, and the commission review table
3209f4b  Migration 0116 - commission review grain + terminated flag
```

---

## 3. Database state

**Highest migration: `0118_payslip_basis_net.sql`, applied. Git matches live —
nothing uncommitted and nothing undrafted in `supabase/migrations/`.**

Full diagnostic, run fresh at write time:

| Check | Result |
|---|---|
| Views in `public` | **40** |
| Views with `security_invoker = true` | **40 / 40** |
| Views readable by `anon` | **0** |
| `report_metrics` dictionary rows | **29** |
| FIFO invariant breaks (`qty_on_hand` vs lot sum) | **0** |
| Driver rows vs `v_operations_monthly` | **0 gaps** |
| `v_pnl_by_period` month grain vs `v_pnl_monthly` | **0 gaps** |
| Revenue total (confirmed-or-paid, not void, net VAT) | **70,650.00** |
| Q3 2026 operating margin, recomputed | **−66.1%** |
| Q3 2026 if monthly margins were averaged | **+18.7%** |
| Payslips issued (`driver_payslips`) | **2**, counter at 2 |
| Net pay definitions (was 2: SQL + TypeScript) | **1**, in the view |
| Review table vs `v_commissions_monthly` | **0 diff** at every month |

The two Q3 margin rows are the non-averaging rule, re-measured on today's data.
It still flips the sign — and the gap has widened since an earlier handoff
recorded it as −38.7% vs +20.5%.

### OPEN ITEM — pin this down before running another reset

A db reset / migration replay **dropped `v_operations_by_driver_monthly`**,
while every other view and the entire money core survived. The working theory
was "0101 was applied but not committed, so the replay didn't know about it."

**That theory does not hold.** `0101` *was* committed in `c561d5c` before the
drop. So either the replay ran against a snapshot predating that commit, or
**the replay source is not this repo's `supabase/migrations/`.**

Until that is established, "commit the migration immediately" is necessary but
possibly not sufficient. **Find out what the reset actually replays from before
running another one.** The view has been re-applied and verified since.

**Status: still unresolved, and now formally parked — no resets are planned or
permitted until the replay source is established.**

---

## 4. Working rhythm

**Turki is non-technical.** He directs the work and verifies every change
in-browser before it is committed. Write for him accordingly: plain language,
and say what a change *means*, not what it does mechanically.

- **Label every instruction to him** `[Claude Code]` (this agent acts) or
  `[Terminal]` (he runs it). He should never have to work out who is acting.
- **Migrations: this agent DRAFTS to disk and stops. The architect applies them
  via MCP.** Never self-apply. That rule exists because self-applying `0036`/
  `0037` produced stray `confirm_invoice` overloads instead of clean
  replacements (fixed in `0038`). Draft the file, confirm it exists on disk,
  hand it over.
- **No dependent app code until a migration is confirmed applied.**
- **Commit + push after each tested change.** Do not let rounds accumulate —
  see §7. The Water Station Cost feature followed this and produced fifteen
  clean, separable commits; it is the first phase where the lesson actually
  held.
- **Explicit-path `git add`, never `git add .`** Stage in a single-line command,
  then `git status` to confirm the exact set before committing.
- **USE `./scripts/safe-build.sh`.** It refuses, with a non-zero exit, if
  anything is listening on the dev port. It exists because a guard that merely
  WARNED let a build run under a live dev server anyway — a warning that does
  not stop the command is worse than no guard, since the transcript reads as
  protected. `--dist-dir X` builds elsewhere and leaves dev alone (next.config.js
  honours `NEXT_DIST_DIR` for exactly this).
- **NEVER run `next build` while `next dev` is live.** It clobbers `.next` and
  every asset 404s, CSS and JS alike, which reads as "the whole app lost its
  styling". This has already cost one session to misdiagnosis. Stop dev first.
  **Dev runs on port 3002**, not 3000. If a production build must be verified
  while dev keeps running, point `distDir` elsewhere — and note that
  `next build` **rewrites `tsconfig.json`** (reformats it and injects the dist
  path into `include`), so revert it afterwards.
- Avoid `!` in commit messages (zsh history expansion). Quote paths with
  brackets — zsh globs `[id]` and silently drops the argument.
- **Verification convention:** throwaway `app/<name>-verify/page.tsx` +
  temporary `lib/supabase/middleware.ts` auth bypass + Playwright, then
  **delete the route and revert the bypass, confirming `git diff` is empty**
  before reporting done.
- **`tsc` is stricter than it used to be.** `noUnusedLocals` and
  `noUnusedParameters` are on, so an unused import, local or parameter fails the
  build. A parameter genuinely required by a signature gets an `_` prefix —
  never delete it, that changes the shape the caller depends on.

---

## 5. Money discipline — still live during polish

Polish is cosmetic. **These are not.** A "tidy-up" that touches any of them is
not a polish change and needs the same rigour as the original build.

- **FIFO core.** Stock arrives only via `add_price_lot`; leaves only via
  `consume_from_lots` / `consume_exit_permit_line`; reverses only via
  `return_to_lots` / `return_exit_permit_line`. `adjust_stock` is the manual
  exception. `stock_movements` is append-only. After anything touching lots,
  verify `SUM(price_lots.qty_remaining) == parts.qty_on_hand` per part — zero
  rows, or stop and fix.
- **Two-person approvals.** First voter votes either way; the **second must
  match**; a differing vote raises. Two matching votes from distinct people is
  the *only* completion definition, shared by the guard, the trigger and the
  Ledger. Consumption approvals are an **overlay, never a gate** — approving
  moves no stock and changes no source status, and the database has no
  mechanism to. Keep it that way.
- **The Reports semantic layer.** Every metric is defined **once, in SQL**. The
  page **reads views and never re-derives a number.** If a figure is missing,
  the fix is a migration — *not* a join added to the page. Corollaries that
  have already bitten and are now guarded by tests:
  - Ratios recompute from period totals, never averaged. See §3 — averaging
    still flips the sign of a real quarter.
  - `trucks_active` and `people_missing_salary` are **not additive**.
    `trucks_active` currently sums to the right answer *by coincidence* —
    worse than a visible error, because a test can pass on it.
  - Purchases are never a P&L line; parts cost is FIFO consumption only.
  - Every new view needs `security_invoker = true`. A default view runs as
    OWNER and bypasses RLS on 68 RLS-enabled tables.
  - Money-core boundary: inventory cost must never flow into `lib/prepaid.ts` /
    `vat.ts` / `invoice.ts`.
- **Frozen snapshots are frozen against the right thing.** `trips.filling_cost_sar`
  is frozen so a later price edit cannot reprice history — but a trip whose
  STATION changes is re-snapshotted, because the old figure came from a station
  it never visited. The cost is held only when the trip is closed history, which
  means **delivered at both ends of the write**. Reading that as "the target
  stage is delivered" shipped a real bug (`c76e731`). The same shape will apply
  to payslips: issue freezes, and nothing re-derives an issued document.

### Dormant-by-design DB objects — do NOT delete in a cleanup pass

This is the single biggest risk of a polish phase. All verified live, exactly
one signature each:

- **`receive_stock`** — superseded by the lot-based `receive_loose_parts`. Its
  app-code wrapper was already removed as genuine dead code; **the RPC stays.**
- **`approve_purchase_order` / `reject_purchase_order`** — superseded by the
  receipt-level vote model for user-facing approval, **but still called
  directly** via raw `supabase.rpc(...)` from `app/inventory/actions.ts` to
  mirror final status onto `purchase_orders`. Not dead.
- **`consume_from_lots`** — no longer dormant; Maintenance and exit permits
  both drive it now.

A grep for "unused" will mislead you on all three. Check `pg_proc` and the raw
`supabase.rpc(...)` call sites, not just typed wrappers. The same lesson has a
second form: an exported function in a `"use server"` file is a live endpoint
whether or not any component calls it — **"unused" is not "unreachable"**
(this is why `updateTrip` was deleted rather than left in place).

---

## 6. Parked

Not blocked, not forgotten — each needs a decision or data we do not capture.

| Item | Why it is parked |
|---|---|
| **DB reset replay source** | See §3. No resets until established. |
| **RBAC** | No role model beyond the approver-role check on POs. Needs a deliberate design pass, not an incremental patch. |
| **Effective-dated salaries** | `staff.monthly_salary_sar` / `drivers.salary_sar` are current-only, so a past period is costed at today's salary and a raise rewrites history. Reports discloses this on screen. Same mechanism the deferred commission-rate and project-rate histories need — likely one feature. **Payslips deliberately do NOT solve this**: they freeze a snapshot at issue instead, which is the right model for a document but leaves the reporting problem untouched. |
| **Driver status-transition history** | `drivers.status` is current-only; there is no transition log, so a status-change report has nothing to count. Requested, and deliberately not faked. |
| **Standing test suite** | Improving. 29 spec files exist; **23 still depend on the dev server and, in most cases, diagnostic routes deleted by convention** — they document what was verified and will fail if run as-is. Two are genuinely standing because they drive pure functions and need no route, no bypass and no browser: `tests/trip-station-gate.spec.ts` (10) and `tests/cost-colors.spec.ts` (3). **That is the shape to copy** — logic extracted to a pure module can be tested permanently; logic reachable only through a page cannot. Whether to make the rest permanent by keeping their routes is still Turki's call. |
| **Payslip deductions** | `driver_payslips.deductions_sar` exists and is always 0 — there is no data source for absences, advances or fines. The column ships so the document's arithmetic is complete and adding a source later changes no issued slip. |
| **Payslip approval step** | Issue is a single action by ruling. An approve-before-issue flow is parked with RBAC, not designed. |
| **Docs refresh** | `CLAUDE.md` §7 is accurate but very long, and its Finance/Inventory sections predate conventions that later became global. Worth a consolidation pass; not urgent. |
| **3 malformed `commission_periods` rows** | `month_key` is NULL on all three (created Jun–Jul, all `pending`, bonus 0.00). Any month-grained grouping of that table has to handle them. Flagged, never deleted — test data is not deleted without Turki's explicit approval. |

Smaller, also open: idle-trucks and fleet-availability on the Operations
statement (need the fleet roster and distinct-trucks-under-maintenance — both
deliberately **not** estimated); the `0100` dictionary gap (ten P&L metric
entries still name only their monthly view, though each is available per
quarter and year); `projects.payment_mode` vs `customers.payment_model`
reconciliation; switching the Consumption page's top-costly-trucks to read
`maintenance_parts_sar` from the view instead of its own TS derivation; and
retiring the deprecated flat `water_stations.fill_cost` column, which app code
already ignores.

---

## 7. Process notes, because they are repeats

**Commit each round as it verifies.** Reports Phases 2–3 plus three follow-up
rounds landed as **one commit**, because `lib/reports.ts`, `StatementsTab.tsx`
and `StatementViews.tsx` each accumulated code from every round and every commit
must be tsc-clean — so no subset could be staged on its own. That was the same
trap already recorded under Inventory Phase 3. **Knowing the lesson did not
prevent it twice; only doing it does.** Water Station Cost finally did, across
fifteen commits — keep that going.

**Sums agreeing does not mean the figures are right.** The filling-cost bug that
shipped reconciled perfectly at every grain — the statement faithfully reported
a stored snapshot that was simply wrong. It was caught by a human who knew what
one station charged, not by a total that failed to foot. Reconciliation proves
consistency, not correctness.

**Reconcile against a view's own predicate, never a raw table sum.**
`v_filling_cost_monthly` only counts trips at `loading` or later, because a
scheduled trip has not filled yet. Summing `trips.filling_cost_sar` raw
therefore exceeds the statement and looks like the view is understating. It is
not.
