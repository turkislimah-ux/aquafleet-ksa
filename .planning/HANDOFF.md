# SESSION HANDOFF — 2026-08-20

**Read `CLAUDE.md` first, then `CLAUDE.md` §7 (the durable record), then this file.**
This file is a POINTER to §7, never the record itself — §5's rule, and §7's
`amountPayable.ts` entry exists because a rule that lived only in the handoff went
stale and actively wrong for two commits.

**Naming note:** this file is `.planning/HANDOFF.md`. It is NOT gitignored (only
`.planning/HANDOFF.json` and `preview/.planning/HANDOFF.json` are — those belong to
the gsd plugin). But it sits one character away from the path that cost this repo
three blanked files. Our durable JSON snapshot remains
**`.planning/AQUAFLEET-HANDOFF.json`**. There is also an older
`.planning/SESSION-HANDOFF.md` (2026-08-17) — unrelated, not superseded by this.

---

## 1. RECENT COMMITS — this session

Four commits, all pushed. `e361597..f23ca2f  main -> main`.

| hash | what |
|---|---|
| `e42c233` | Migration 0140: drop 0019's unguarded `archive_project(uuid)` |
| `35d0946` | Update `archiveProject` comment now that 0140 dropped the back door |
| `44ba27c` | Record 0140 in CLAUDE.md §7 and close 0139's Q5 (+62/−12) |
| `f23ca2f` | Point handoff at 0140 — nothing is scheduled-but-undone now |

`e361597` and earlier belong to the previous session.

Each was its own logical unit, staged by explicit path, `tsc --noEmit` clean before
each. The `f23ca2f` diff GREW (7 insertions / 5 deletions) — expected, and reasoned
before committing: 3 changed scalar lines plus 2 array appends, each adding a comma
to the previous last element. §5's shrinking-diff-is-a-stop-signal did not fire.

## 2. CURRENT STATE

```
$ git status -sb
## main...origin/main

$ git diff --stat            (empty)
$ git diff --stat --cached   (empty)
```

**Working tree clean. Nothing uncommitted. Nothing unpushed. `main` level with
`origin/main`.** `npx tsc --noEmit` clean at session end.

## 3. INTERRUPTED WORK

**The task was Turki's verbatim request: "verify archiving still works in browser".**
Nothing else was in flight. (The commit message on this handoff says "item 3
interrupted" — that phrasing was supplied by the closing instruction and does NOT
map to any numbered item in this session. The interrupted work is the in-browser
archive verification described here. Disregard "item 3".)

### Done

- **Dev server confirmed up on :3002** (NOT 3000). `curl /login` → 200 on 3002, 000
  on 3000; `ps aux` shows `next dev -p 3002`, pid 4638, next-server v14.2.5.
  **Do not touch `.next`** — deleting or rebuilding it under a running dev server has
  taken this repo down twice (§7 records both).
- **DB-side proof complete, read-only.** The real post-DROP failure mode is a
  PostgREST call that can no longer resolve its function (PGRST202, "Could not find
  the function"), which would take archiving down entirely. It resolves:

  | check | result |
  |---|---|
  | `archive_project*` routines in `public` | exactly one — `archive_project_guarded(uuid,text,text)` |
  | argument shape | `p_project_id uuid, p_override_reason text DEFAULT null, p_actor text DEFAULT null` |
  | matches the call at `app/trips/actions.ts:998`? | yes |
  | `authenticated` EXECUTE | true |
  | bare `archive_project` | gone |
  | `prosecdef` (security definer) | **false** — runs as invoker |

  Query used:
  ```sql
  select p.oid::regprocedure::text as signature,
         pg_get_function_arguments(p.oid) as args,
         p.prosecdef as security_definer,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'archive_project%'
   order by 1;
  ```

### Left

**The in-browser click-through itself. Zero progress — it was never reachable.**

**Blocker: the Claude-in-Chrome MCP is not connected.** Four attempts across the
session, all returning `Claude in Chrome is not connected`.
**Computer-use cannot substitute** — browsers are tier "read" there, so clicks and
typing are blocked; it can only see what is already on screen. This was reported to
Turki plainly rather than silently falling through to a slower tier.

Unblock: Chrome open with the extension signed in, then retry
`mcp__Claude_in_Chrome__tabs_context_mcp`. Otherwise Turki clicks it himself.

### The verification plan, when the browser is available

**Exercise the debt-guard BLOCK, not a completed archive.** A block is a REFUSED
write — nothing changes — and it still proves the function resolved AND executed,
which is the whole question a DROP raises.

1. Open any project whose customer owes money (table below).
2. ProjectModal → danger zone → Archive.
3. Expect the `23514` block message carrying the figure **formatted by the RPC**
   (`to_char(v_owed, 'FM999,999,990.00')`). The app branches on
   `const CHECK_VIOLATION = "23514"` — **branch on the code, never the message text.**

**Live figures, re-measured this session** (§7's table is apply-time only and its own
note says these "move with every delivery and invoice" — re-measure again before use):

| project | customer | mode | owed SAR | blocked |
|---|---|---|---|---|
| The Royal Court of Saudi | Seder Facility mang. Co. | prepaid | 55,274.00 | yes |
| King Saud University | MMM construction Co. | prepaid | 48,290.00 | yes |
| VVV Test 2 | VVV CO. | postpaid | 46,460.00 | yes |
| King Salman Park | Turki Contraction Co. | postpaid | 38,295.00 | yes |
| RRR T | TEST 111 Co. | postpaid | 20,056.00 | yes |
| Airport facilities | Seder Facility Mang. Co. | prepaid | — (credit 11,895.00) | no |

### DO NOT, without asking Turki first

- **Complete an archive** — stamps `archived_at` on the project AND its customer.
- **Force-archive with an override reason** — additionally inserts a
  `customer_write_offs` row: one per customer, unique-indexed, amount frozen at
  insert and never recomputed, and **a written-off customer is permanently an
  archived one.**

Both are real, effectively irreversible state changes on live data.

## 4. DB STATE

- **Highest migration: `0140_drop_archive_project.sql` — applied clean and
  committed (`e42c233`).** 4,526 bytes / 93 lines.
- Nothing drafted-but-unapplied. Nothing applied-but-uncommitted. (The `0101`
  incident: **an applied-but-uncommitted migration is exactly what a db reset
  drops.**)
- View posture unchanged by this session: **47 views / 47 security_invoker / 0
  anon-readable** (last measured 2026-08-19). §6 carries the re-measure query —
  *the two counts matching is the check, not the number.*
- **Migrations are DRAFTED to disk for Turki to run in the Supabase SQL Editor —
  never self-applied through the MCP.** Read-only `execute_sql` queries ARE allowed
  and are the standard proof mechanism; that is all this session used.

## 5. DECISIONS / CONSTRAINTS DISCOVERED

### `anon` holds EXECUTE on `archive_project_guarded` — and it is INERT

Measured, not asserted. It does **not** come from `0139` (which granted
`authenticated` only) — it is **Postgres's default `PUBLIC` EXECUTE on every new
function.** Why it cannot be used:

- `prosecdef = false` → the function runs as the INVOKER, not the owner.
- `projects`, `customers` and `customer_write_offs` all have
  `relrowsecurity = true`, and every policy on them is `{authenticated}`-scoped
  (`cmd=ALL`, `qual=true`).
- The function's FIRST statement is
  `select customer_id into v_cust_id from public.projects where id = p_project_id`.
  Anon sees zero rows → `v_cust_id` is null → `raise exception 'Project not found.'`
  It dies before reading the view and before any write.

**Ruling: same shape as §7's standing, Turki-reviewed ruling on the cosmetic `anon`
table SELECT grants — over-broad grant, zero live exposure, deferred to the dedicated
app-wide security pass alongside RBAC. NO grant was revoked and none should be
outside that pass.** Note a function EXECUTE grant is a *different shape* from a
table grant, which is why it was measured separately rather than waved through under
the existing ruling.

### A migration that is already a no-op against production still gets written

`0140`'s premise was **wrong, not merely stale** — §7 and the handoff both said the
function "IS STILL IN PLACE"; live measurement showed it already absent, dropped
out-of-band, with no migration on disk removing it. **Third time a long-standing §7
note was wrong rather than out of date** (Kanban first, `payment_model` second).
**Re-measure the premise before executing on it.**

The drift is an argument FOR the file, never for waving it off: **migration history
on disk is the RESET PATH.** Replaying from scratch runs `0019`, which RECREATES the
back door. `if exists` makes `0140` a no-op today and a real drop on every replay.

### Verification method: prefer the refused write

Proving an RPC resolves does not require completing its side effect. The block path
executes the function end-to-end and changes nothing. Reach for that shape first when
the alternative writes irreversible data.

### Grep traps re-confirmed this session

- **`archive_project` MATCHES `archive_project_guarded`** — any sweep for the bare
  name must exclude the guarded one or it reports the replacement as the thing it was
  meant to find. Same shape as the recorded `fill_cost[^_]` trap.
- **zsh expands an unquoted `--include=*.ts`** and kills the command — the EMPTY
  output reads as a clean sweep.
- **`grep` is case-sensitive by default** — `drop function` alone cannot prove no
  `DROP FUNCTION` exists.
- **An empty grep from the wrong directory is indistinguishable from a real finding.**

**An empty result is only evidence once you know the command ran.**

## 6. NEXT

1. **Get Chrome connected and run the block verification above.** That is the one
   open item and it is the direct continuation of Turki's request.
2. **If it blocks with the figure → archiving is verified end-to-end.** Record it in
   §7's `0140` entry (one line — the entry already exists, it just has no in-browser
   confirmation on it yet) and in `.planning/AQUAFLEET-HANDOFF.json`. §7 is the
   durable record; the JSON points at it, never the reverse.
3. **If it errors with "Could not find the function" → the app half and the DB
   disagree.** That would be the PGRST202 case, and the DB-side proof above says it
   should not happen. Do not patch the app around it — re-measure the signature first.
4. **Nothing else is scheduled-but-undone.** `0139`'s Q5 is closed and the Deferred
   list in §7 carries nothing that is blocked-and-actionable. The named deferred items
   (RBAC + the app-wide security pass, effective-dated customer rates, multi-project
   customers, Route Optimization / Predictive / IoT) are all parked deliberately.
5. **Still owed from much earlier, unrelated and still true:** an end-to-end
   in-browser "Download PDF" check against the live PDFShift API — nobody has
   confirmed a real PDF came back since `PDF_API_KEY` landed in `.env.local`.
