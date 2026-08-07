# HANDOFF — AquaFleet KSA (Bousla / بوصلة)

**Read `CLAUDE.md` first.** That is the standing rulebook and §7 is the durable
record. This file is a *snapshot of where things stand right now*. If the two
disagree, `CLAUDE.md` §7 wins.

Written 2026-08-08 at the close of the Reports build. Every fact below was
verified live at write time — git, `supabase/migrations/`, and the Supabase MCP
— not recalled.

*(This file replaces a 2026-07-27 version written during the Inventory phase.
That one was stale by four whole modules and, more dangerously, still said both
HANDOFF.json files were unused scaffolding to leave unstaged — which is no
longer true. See §2.)*

---

## 1. App status

**Functionally complete. Every non-deferred page in the roadmap is built.**

Trips → Maintenance → Inventory → Archive → Consumption → Reports — all done.
Route Optimization, Predictive and IoT stay deliberately deferred.

**The next phase is POLISH, beginning with the Dashboard.**

Nothing is in flight. Nothing is half-finished on disk. Open items are deferred
by choice, not blocked — each is listed with its blocking reason in §6 and in
`CLAUDE.md` §7.

The Dashboard has barely been touched since early in the project and still
leans on `lib/mock-data`. Assume none of the app's later conventions were
applied to it; treat it as a fresh surface rather than a tidy-up.

---

## 2. Exact git state

```
HEAD          af14c5feb51fac8098d72625ed4de9043e5769e8
              af14c5f  HANDOFF.json: Reports complete, roadmap non-deferred
                       pages all built
branch        main
origin/main   0 ahead / 0 behind
```

Working tree is clean **apart from one expected file**:

```
 M preview/.planning/HANDOFF.json
```

**That permanent "modified" state is correct — do not fix it.** The two
HANDOFF.json files are governed differently, and this is the part the previous
handoff got wrong:

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

Recent history, for orientation:

```
af14c5f  HANDOFF.json: Reports complete
6546597  CLAUDE.md: record the Reports state
eaf7e2e  Reports cleanup: tighten module surface, correct stale comments
d24d8d8  Reports: driver tables put drivers down the left, measures across
e80e883  Reports: driver tables lead the Operations statement
07bf569  Reports Phases 2-3: statements, expenses, builder, driver transpose
c561d5c  Reports: migrations 0100 and 0101 (applied, reconciled to live)
52075c9  Reports Phase 1: semantic layer + Overview tab
```

---

## 3. Database state

**Highest migration: `0101_operations_by_driver.sql`, applied. Git matches
live.**

All four Reports migrations (`0098`–`0101`) are committed, and their files were
**reconciled to what actually ran**. `0099`, `0100` and `0101` were each applied
in a modified form; every file was rewritten to match live (verified against
`pg_get_viewdef`) with the differences recorded in its own header.
**Do not "fix" them back toward their drafts.**

Full diagnostic, run fresh at write time:

| Check | Result |
|---|---|
| Views in `public` | **24** |
| Views with `security_invoker = true` | **24 / 24** |
| Views readable by `anon` | **0** |
| `report_metrics` dictionary rows | **23** |
| FIFO invariant breaks (`qty_on_hand` vs lot sum) | **0** |
| Driver rows vs `v_operations_monthly` | **0 gaps** |
| `v_pnl_by_period` month grain vs `v_pnl_monthly` | **0 gaps** |
| Revenue total (confirmed-or-paid, not void, net VAT) | **70,650.00** |
| Q3 2026 operating margin (the sign-flip case) | **−38.7%** |

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
  see §5's process note, which is a repeat offence.
- **Explicit-path `git add`, never `git add .`** Stage in a single-line command,
  then `git status` to confirm the exact set before committing.
- **NEVER run `next build` while `next dev` is live.** It clobbers `.next` and
  every asset 404s, CSS and JS alike, which reads as "the whole app lost its
  styling". Stop dev first. **Dev runs on port 3002**, not 3000.
- Avoid `!` in commit messages (zsh history expansion). Quote paths with
  brackets — zsh globs `[id]` and silently drops the argument.
- **Verification convention:** throwaway `app/<name>-verify/page.tsx` +
  temporary `lib/supabase/middleware.ts` auth bypass + Playwright, then
  **delete the route and revert the bypass, confirming `git diff` is empty**
  before reporting done.

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
  - Ratios recompute from period totals, never averaged. Averaging monthly
    margins flips Q3 from −38.7% to **+20.5%**.
  - `trucks_active` and `people_missing_salary` are **not additive**.
    `trucks_active` currently sums to the right answer *by coincidence* —
    worse than a visible error, because a test can pass on it.
  - Purchases are never a P&L line; parts cost is FIFO consumption only.
  - Every new view needs `security_invoker = true`. A default view runs as
    OWNER and bypasses RLS on 68 RLS-enabled tables.
  - Money-core boundary: inventory cost must never flow into `lib/prepaid.ts` /
    `vat.ts` / `invoice.ts`.

### Dormant-by-design DB objects — do NOT delete in a cleanup pass

This is the single biggest risk of a polish phase. All verified live at write
time, exactly one signature each:

- **`receive_stock`** — superseded by the lot-based `receive_loose_parts`. Its
  app-code wrapper was already removed as genuine dead code; **the RPC stays.**
- **`approve_purchase_order` / `reject_purchase_order`** — superseded by the
  receipt-level vote model for user-facing approval, **but still called
  directly** via raw `supabase.rpc(...)` from `app/inventory/actions.ts` to
  mirror final status onto `purchase_orders`. Not dead.
- **`consume_from_lots`** — no longer dormant; Maintenance and exit permits
  both drive it now.

A grep for "unused" will mislead you on all three. Check `pg_proc` and the raw
`supabase.rpc(...)` call sites, not just typed wrappers.

---

## 6. Parked

Not blocked, not forgotten — each needs a decision or data we do not capture.

| Item | Why it is parked |
|---|---|
| **RBAC** | No role model beyond the approver-role check on POs. Needs a deliberate design pass, not an incremental patch. |
| **Effective-dated salaries** | `staff.monthly_salary_sar` / `drivers.salary_sar` are current-only, so a past period is costed at today's salary and a raise rewrites history. Reports discloses this on screen. Same mechanism the deferred commission-rate and project-rate histories need — likely one feature. |
| **Driver status-transition history** | `drivers.status` is current-only; there is no transition log, so a status-change report has nothing to count. Requested, and deliberately not faked. |
| **Standing test suite** | The Playwright specs (`tests/reports-*.spec.ts`, `tests/inventory-*.spec.ts`) depend on diagnostic routes deleted by convention. They document what was verified; they are **not** a regression suite and will fail if run as-is. Making them one means keeping those routes permanently — Turki's call, undecided. |
| **Docs refresh** | `CLAUDE.md` §7 is accurate but very long, and its Finance/Inventory sections predate conventions that later became global. Worth a consolidation pass; not urgent. |

Smaller, also open: idle-trucks and fleet-availability on the Operations
statement (need the fleet roster and distinct-trucks-under-maintenance — both
deliberately **not** estimated); the `0100` dictionary gap (ten P&L metric
entries still name only their monthly view, though each is available per
quarter and year); `projects.payment_mode` vs `customers.payment_model`
reconciliation; and switching the Consumption page's top-costly-trucks to read
`maintenance_parts_sar` from the view instead of its own TS derivation.

---

## 7. One process note, because it is a repeat

Reports Phases 2–3 plus three follow-up rounds landed as **one commit**, because
`lib/reports.ts`, `StatementsTab.tsx` and `StatementViews.tsx` each accumulated
code from every round and every commit must be tsc-clean — so no subset could
be staged on its own.

That is the **same trap already recorded under Inventory Phase 3** in
`CLAUDE.md` §7. Knowing the lesson did not prevent it; only committing each
round *as it verifies* does. Do that during polish.
