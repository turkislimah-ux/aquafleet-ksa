# SESSION HANDOFF — 2026-08-20 (archive block verified)

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

## 1. RECENT COMMITS

Two commits pushed this session. `f23ca2f..e65d980`, then `e65d980..0adbab1`.

| hash | what |
|---|---|
| `e65d980` | Previous session's handoff — committed there, **pushed here** |
| `0adbab1` | Record the in-browser archive block verification in §7 + the JSON |

`e65d980` was already committed but **unpushed** when this session opened, while the
handoff's own §2 asserted "Nothing unpushed." `git status -sb` read
`## main...origin/main [ahead 1]`. **The handoff's self-claim about push state is the
one claim it cannot verify about itself — check `git status`, never the prose.**

`0adbab1` is docs-only: `CLAUDE.md` + `.planning/AQUAFLEET-HANDOFF.json`,
+27/−12, `tsc --noEmit` clean, staged by explicit path, staged blob inspected
(`git cat-file -s`, and the staged JSON re-parsed with `json.load` before commit).
The JSON diff GREW (9 insertions / 6 deletions) — reasoned before committing: 3
changed scalar lines plus 3 array appends, each append adding a comma to the previous
last element. §5's shrinking-diff-is-a-stop-signal did not fire.

## 2. CURRENT STATE

```
$ git -C /Users/turkislimah/aquafleet-ksa status -sb
## main...origin/main

$ git diff --stat            (empty)
$ git diff --stat --cached   (empty)
```

**Working tree clean. Nothing uncommitted. Nothing unpushed. `main` level with
`origin/main`.** `npx tsc --noEmit` clean at session end.

**`git` needs `-C /Users/turkislimah/aquafleet-ksa`.** The Bash tool's cwd is
`/Users/turkislimah`, which is NOT a repo — a bare `git push` died with
`fatal: not a git repository`. Shell cwd did not persist across turns this session.
Same family as the wrong-directory grep in §5: **a command that ran somewhere else
does not report that it ran somewhere else.**

## 3. THE ARCHIVE VERIFICATION — CLOSED

**Turki's verbatim request was "verify archiving still works in browser". IT IS
DONE.** He ran the click-through **himself** on 2026-08-20 and reported "Test
Completed, Verified and pass". Archiving blocked with the figure.

**What that proves, and it is the whole question a DROP raises:** the app resolved
AND executed `archive_project_guarded` through PostgREST after `0140` removed the
bare name. **PGRST202 ("Could not find the function") does not occur** — ruled out
from the APP side, not just the DB side. Recorded in §7 on both the `0139` and the
`0140` entries (`0adbab1`).

**A BLOCK is a REFUSED write.** Nothing changed, and it still exercised the function
end-to-end. **Prefer the refused write whenever the alternative writes irreversible
data** — §5 carries this as a standing method.

### DB-side proof, from the prior session — still valid, read-only

| check | result |
|---|---|
| `archive_project*` routines in `public` | exactly one — `archive_project_guarded(uuid,text,text)` |
| argument shape | `p_project_id uuid, p_override_reason text DEFAULT null, p_actor text DEFAULT null` |
| matches the call at `app/trips/actions.ts:998`? | yes |
| `authenticated` EXECUTE | true |
| bare `archive_project` | gone |
| `prosecdef` (security definer) | **false** — runs as invoker |

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

The app branches on `const CHECK_VIOLATION = "23514"` and the figure is formatted by
the RPC (`to_char(v_owed, 'FM999,999,990.00')`). **Branch on the code, never the
message text.**

### The two write paths — ALSO DONE, by Turki, same night

He ran both himself after saying "i will do the archives my self". Verified read-only
afterwards:

| path | project | evidence |
|---|---|---|
| force-archive w/ override | RRR T `fd408e6e…` | project `archived_at`, **customer** `archived_at` and the `customer_write_offs` row all on **one identical stamp** `2026-08-19 23:32:29.473557+00`; frozen `amount_sar` **20,056.00** = the measured owed exactly; `reason` and `written_off_by` populated |
| plain archive, no override | Airport facilities `42941279…` | archived clean at `2026-08-20 00:02:41.959339+00`, project + customer one stamp, **+11,895.00 CREDIT** — a positive payable does not block |
| override ABANDONED | VVV Test 2 `70dcb451…` | `archived_at` still null, `customer_write_offs` still at **exactly 1 row** — **a block and a walked-away override are both completely inert** |

**The override is ROLE-GATED — offered to MANAGERS.** Turki's words.

**After the write-off, TEST 111 Co. reads `0.00` / `archive_blocked = false`** in
`v_customer_amount_payable`, down from −20,056.00. The write-off flows through
`v_receivables_open`'s `written_off` basis and **zeroes the guard's own input.**

### Still never clicked

- **The Return Balance flow.** Now **REACHABLE** — the credit customer is archived —
  and `customer_balance_returns` is at **0 rows**.

### DO NOT, without asking Turki first

- **Complete an archive** — stamps `archived_at` on the project AND its customer, and
  **customers have NO Restore** (§7, deliberate — `0019` archives the customer as a
  side effect of the 1:1 project).
- **Force-archive with an override reason** — additionally inserts a
  `customer_write_offs` row: one per customer, unique-indexed, amount frozen at
  insert and never recomputed, and **a written-off customer is permanently an
  archived one.**

Both are real, effectively irreversible state changes on live data.

### Live figures, re-measured 2026-08-20 — RE-MEASURE AGAIN BEFORE USE

Unchanged from `0139`'s apply-time table, whose own note says these "move with every
delivery and invoice".

| project | project_id | customer | mode | owed SAR | blocked |
|---|---|---|---|---|---|
| The Royal Court of Saudi | `00243565-c998-4650-afb6-a87075747a11` | Seder Facility **m**ang. Co. | prepaid | 55,274.00 | yes |
| King Saud University | `dfab388f-db51-47ad-b144-f6b03b245a6a` | MMM construction Co. | prepaid | 48,290.00 | yes |
| VVV Test 2 | `70dcb451-dce0-4153-81af-182dc0a1d537` | VVV CO. | postpaid | 46,460.00 | yes |
| King Salman Park | `7a94e22e-83b3-45e8-a7d0-766da0855b8a` | Turki Contraction Co. | postpaid | 38,295.00 | yes |
| RRR T | `fd408e6e-5acf-4109-b474-28ae1b7e8e92` | TEST 111 Co. | postpaid | 20,056.00 | yes |
| *(no active project)* | — | Turki 1 | **null** | 1,035.00 | yes |
| Airport facilities | `42941279-747b-4fb8-b511-5d9c380766a6` | Seder Facility **M**ang. Co. | prepaid | — (credit 11,895.00) | no |

```sql
select p.name as project_name, p.id as project_id, v.customer_name,
       v.payment_mode, v.amount_payable_sar, v.owed_sar, v.archive_blocked
  from public.v_customer_amount_payable v
  left join public.projects p
    on p.customer_id = v.customer_id and p.archived_at is null
 order by v.amount_payable_sar asc;
```

**The `Turki 1` row is the SEVENTH and §7's apply-time table omits it** — no active
project, `payment_mode` NULL, still blocked. That is `0139`'s Q1 fail-closed rule
working: an unresolvable payment mode is treated as postpaid. **A customer with no
project still appears in this view.**

### NAME COLLISION — confirm by ID, never by the name on screen

Two DISTINCT customers, one letter apart, with two DISTINCT projects. Measured
read-only before anything irreversible was proposed:

| customer | customer_id | project | payable |
|---|---|---|---|
| Seder Facility **m**ang. Co. | `d59b9bfe-8a69-4b31-9d1d-a97ee2159341` | The Royal Court of Saudi | −55,274.00 |
| Seder Facility **M**ang. Co. | `de4b1ffc-fbc6-435b-a803-9dc116233003` | Airport facilities | **+11,895.00** |

`archived_at` null on both customers and both projects; both prepaid.
**Archiving one cannot touch the other.** This check had to clear first precisely
because an archive stamps the CUSTOMER and there is no customer restore.

## 4. DB STATE

- **Highest migration: `0140_drop_archive_project.sql` — applied clean and
  committed (`e42c233`).** 4,526 bytes / 93 lines.
- Nothing drafted-but-unapplied. Nothing applied-but-uncommitted. (The `0101`
  incident: **an applied-but-uncommitted migration is exactly what a db reset
  drops.**)
- **No DB writes this session.** Every query above was read-only.
- View posture unchanged: **47 views / 47 security_invoker / 0 anon-readable**
  (last measured 2026-08-19). §6 carries the re-measure query — *the two counts
  matching is the check, not the number.*
- **Migrations are DRAFTED to disk for Turki to run in the Supabase SQL Editor —
  never self-applied through the MCP.** Read-only `execute_sql` queries ARE allowed
  and are the standard proof mechanism; that is all this session used.

## 5. DECISIONS / CONSTRAINTS

### No browser channel exists for an agent here — all three tiers assessed

1. **Claude-in-Chrome MCP** — `Claude in Chrome is not connected`, every attempt.
2. **Computer-use** — browsers are granted at tier **"read"**: visible in
   screenshots, clicks and typing BLOCKED. It cannot substitute.
3. **`mcp__Claude_Preview__preview_*`** — `preview_list` returns `[]`. It cannot
   attach to the externally-started dev server; every other tool in that server needs
   a `serverId` only `preview_start` produces, and `.claude/launch.json` does not
   exist.

**`preview_start` is NOT the workaround.** A second server lands on `/login` with no
Supabase session, so it proves nothing about archiving, and it writes to the same
`.next` as the running pid — **the exact thing that took this repo down twice.**
**Do not touch `.next`.** Dev server: `next dev -p 3002` (NOT 3000), pid 4638,
next-server v14.2.5; `/login` 200, everything else 307 behind auth.

**Calling `archive_project_guarded` through the Supabase MCP is NOT the fallback.**
It is a WRITE through the MCP, which §5 forbids, AND it bypasses the
app → PostgREST → RPC path that is the actual thing under test. A green result there
would prove nothing about the app. **Report the blocker plainly instead of falling
through to a tier that answers a different question.**

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
the alternative writes irreversible data. **This is no longer theory — it is how the
`0140` question was actually answered.**

### Three traps measured live while verifying the archive feature

1. **`v_customer_amount_payable` INCLUDES ARCHIVED CUSTOMERS.** `Turki 1` (archived
   2026-06-28) and TEST 111 Co. (archived 2026-08-19) are both still in it. **A
   surface that lists this view and calls the rows "active customers" is wrong** —
   filter on `customers.archived_at`. **This corrected a §7 line written ONE COMMIT
   earlier** (`0adbab1` said a customer with *no project* appears in the view; `Turki
   1` HAS one — `King Salman Park` `1bbf496e…`, archived the same second). **Fourth §7
   note found wrong rather than stale, and it was 20 minutes old.**
2. **ARCHIVE IS `archived_at` AND NOTHING ELSE.** On all three archived projects
   `projects.status` is still `'active'` and `customers.active` is still `true`.
   **Neither column tracks archiving — filtering on either does NOT exclude archived
   rows.**
3. **NAME COLLISION, SECOND INSTANCE.** Two projects named `King Salman Park`:
   `7a94e22e…` (Turki Contraction Co., active, 38,295.00 owed) and `1bbf496e…`
   (Turki 1, archived June). Beside the two case-differing Seders. **Match by id.**

**MEASUREMENT AGES.** A read at `00:01:58` correctly showed `Airport facilities`
unarchived; the archive landed **43 seconds later** at `00:02:41`. The measurement was
not wrong — it went stale while being reported. **When a human is acting in parallel,
re-measure AFTER they say they are done.**

### Grep traps — and the ToolSearch one

- **`archive_project` MATCHES `archive_project_guarded`** — any sweep for the bare
  name must exclude the guarded one or it reports the replacement as the thing it was
  meant to find. Same shape as the recorded `fill_cost[^_]` trap.
- **zsh expands an unquoted `--include=*.ts`** and kills the command — the EMPTY
  output reads as a clean sweep.
- **`grep` is case-sensitive by default** — `drop function` alone cannot prove no
  `DROP FUNCTION` exists.
- **An empty grep from the wrong directory is indistinguishable from a real finding.**
- **`ToolSearch`'s `select:` needs the EXACT fully-qualified deferred-tool name.**
  `select:preview_list` returns "No matching deferred tools found", which reads like
  the tool does not exist. Use the keyword form, or the full
  `mcp__<server-id>__<tool>` name.

**An empty result is only evidence once you know the command ran.**

## 6. NEXT

1. **THE RETURN BALANCE FLOW — the one path left, and it is now reachable.** Turki's
   to click. `Seder Facility Mang. Co.` (`de4b1ffc-fbc6-435b-a803-9dc116233003`) is
   archived holding **+11,895.00** credit; `customer_balance_returns` is at 0 rows.
   The rehearsal is `0139`'s own block G: **`balance_sar` must be IDENTICAL before and
   after**, only `balance_returned` may change, and a **second** call must raise
   "already been returned". **RECORDING IS NOT DEDUCTING** — nothing in the balance
   chain reads `customer_balance_returns`, so a negative top-up written to "finish the
   job" double-counts against a balance that was already correct.
2. **Archiving needs no further verification.** All three paths are clicked and
   recorded in §7 (`0139` and `0140` entries) and in the JSON. Do not re-open it.
4. **Nothing else is scheduled-but-undone.** `0139`'s Q5 is closed. The Deferred list
   in §7 carries nothing blocked-and-actionable — RBAC + the app-wide security pass,
   effective-dated customer rates, multi-project customers, Route Optimization /
   Predictive / IoT are all parked deliberately.
5. **Still owed from much earlier, unrelated and still true:** an end-to-end
   in-browser "Download PDF" check against the live PDFShift API — nobody has
   confirmed a real PDF came back since `PDF_API_KEY` landed in `.env.local`.
   **Blocked on the same missing browser channel as §5.**
