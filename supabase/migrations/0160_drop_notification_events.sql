-- 0160_drop_notification_events.sql
-- Drop the dormant notification_events table and remove the always-empty events
-- branch from v_my_notifications.
--
-- ===========================================================================
-- THE DATABASE WAS CHANGED FIRST. THIS FILE IS THE RECORD, NOT THE SOURCE.
-- ===========================================================================
-- The architect applied all three statements via MCP and verified them live
-- BEFORE this file was written. That is the reverse of the usual order and it is
-- stated here so the next reader does not assume the file was applied from disk.
--
-- **EVERY STATEMENT IN THIS FILE IS ALREADY APPLIED. NOTHING HERE IS PENDING.**
-- The three, in the order they were run: the view rewrite, the view comment, the
-- table drop.
--
-- **DO NOT RE-RUN IT AGAINST THE LIVE DATABASE.** The table is already gone, so
-- `drop table` would fail — which is the correct and intended outcome of a second
-- apply, and the reason there is no `if exists`. The file exists so the repo
-- matches the DB and so a rebuild from migrations reproduces it.
--
-- NEITHER THE VIEW BODY NOR THE COMMENT WAS RETYPED. Both were pulled out of the
-- live database and checksum-matched against it:
--     select pg_get_viewdef('public.v_my_notifications'::regclass, true);
--     select obj_description('public.v_my_notifications'::regclass,'pg_class');
-- Reconstructing a view body from memory is how a "no-op" replacement quietly
-- changes behaviour, and the comment was written by the architect rather than by
-- the draft in this file's first revision — a reconstruction would have recorded
-- the wrong text as though it were what ran.
--
-- ===========================================================================
-- WHY IT IS DROPPED
-- ===========================================================================
-- `notification_events` was created by 0154 as the seam for BLUE alerts that
-- could not be derived — the place an event goes when no source column can
-- express it. 0155 then made all three blue facts DERIVED (from
-- `work_orders.opened_at` / `.closed_at` and `leave_periods.end_date`), so the
-- seam was never used.
--
-- Measured before the decision, not assumed: **0 rows, and 0 writers.** No
-- `insert into notification_events` in any migration, and no reference to the
-- table in any `.ts` or `.tsx` file in the repo. The entire notifications
-- feature — data layer, bell, panel, per-user preferences and per-user
-- thresholds — shipped and works without it.
--
-- 0155 deliberately KEPT it, on the reasoning that a dormant seam is cheap and
-- the shape would be needed the first time a blue fact had no column to derive
-- from. That reasoning was sound and is now simply resolved the other way: the
-- feature is complete, nothing has needed it, and an empty table with no writer
-- is a standing invitation to "wire it up" by inventing a writer for a fact that
-- is already derived correctly elsewhere. Two sources for one blue fact is the
-- thing 0155 was avoiding in the first place.
--
-- **IF A NON-DERIVABLE EVENT IS EVER NEEDED, RE-ADD IT DELIBERATELY.** 0154's
-- definition (columns, dedupe index, RLS policy) is preserved in that file and is
-- the starting point. Re-adding a table is cheap; a half-live table that some
-- code writes and nothing reads is not.
--
-- ===========================================================================
-- ORDER MATTERS: THE VIEW LOSES THE REFERENCE BEFORE THE TABLE GOES
-- ===========================================================================
-- `v_my_notifications` selected from `notification_events`, so the table cannot
-- be dropped while the view still names it — Postgres tracks the dependency and
-- would refuse (or, with CASCADE, would take the view with it). The view is
-- replaced first, then the table is dropped.
--
-- **NO CASCADE ON THE DROP, ON PURPOSE.** Same rule as 0143: a bare drop fails
-- loudly if an unexpected dependent exists, and an unexpected dependent is
-- exactly the thing worth finding out about. CASCADE would silently delete
-- whatever it found.
--
-- **NO `if exists` EITHER.** Re-running this against a database where the table
-- is already gone SHOULD fail rather than report success — a migration that
-- cheerfully no-ops tells you nothing about whether it ran.
--
-- ===========================================================================
-- WHAT CHANGED IN THE VIEW, AND WHAT DID NOT
-- ===========================================================================
-- The `merged` CTE was `<state branch> union all <events branch>`. With the
-- events branch removed there is only one branch left, so the UNION ALL is gone
-- entirely and `merged` is now a straight select over `v_active_alerts` with a
-- constant `'state'` source and a NULL `occurred_at`.
--
-- **THE COLUMN LIST IS UNCHANGED — all twelve, same names, same order, same
-- types.** That matters twice: `create or replace view` can only APPEND a column
-- (42P16), so any other change would have failed outright; and
-- `lib/actions/notifications.ts` selects those columns by name, so the bell needs
-- no change and gets none. `source` still exists and still reads `'state'` for
-- every row — it is now constant rather than discriminating between two branches,
-- and it is kept rather than dropped precisely because dropping a column from a
-- view is not something `create or replace` can do.
--
-- Behaviour is identical because the removed branch selected from a table with
-- zero rows: `X union all (empty)` is `X`. Verified live after the apply — the
-- view still returns 9 rows.
--
-- ===========================================================================
-- WHAT THIS FILE DOES NOT TOUCH
-- ===========================================================================
-- `v_active_alerts` (untouched — it never read the events table; its three blue
-- branches are derived), `notification_prefs`, `notification_dismissals`,
-- `notification_thresholds`, `notification_thresholds_user`, every money view,
-- every storage bucket, and all app code.
--
-- 0154 and 0155 are NOT edited. A migration file is a record of what ran at the
-- time, not a description of current state — editing them to remove mentions of
-- a table that existed when they ran would falsify the history. Their prose about
-- `notification_events` remaining "in place but dormant" was true when written and
-- is superseded by this file, which is how the sequence is supposed to work.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. The view, without the events branch.
--
-- Body copied verbatim from pg_get_viewdef on the live database.
--
-- The security footer is restated below even though `with (security_invoker =
-- true)` appears in the CREATE. CLAUDE.md §6 requires it on EVERY view
-- replacement because `create or replace view` silently drops `reloptions`, and
-- the cost of the redundant statement is nothing against the cost of a view
-- quietly reverting to security-definer semantics.
-- ---------------------------------------------------------------------
create or replace view public.v_my_notifications
with (security_invoker = true) as
 WITH riyadh AS (
         SELECT (now() AT TIME ZONE 'Asia/Riyadh'::text)::date AS today
        ), prefs AS (
         SELECT COALESCE(p.show_red, true) AS show_red,
            COALESCE(p.show_yellow, true) AS show_yellow,
            COALESCE(p.show_blue, true) AS show_blue
           FROM ( SELECT 1 AS "?column?") one
             LEFT JOIN notification_prefs p ON p.user_id = auth.uid()
        ), merged AS (
         SELECT a.alert_identity,
            a.severity,
            a.category,
            a.entity_type,
            a.entity_id,
            a.entity_label,
            a.value_num,
            a.value_date,
            a.payload,
            'state'::text AS source,
            NULL::timestamp with time zone AS occurred_at
           FROM v_active_alerts a
        )
 SELECT m.alert_identity,
    m.severity,
    m.category,
    m.entity_type,
    m.entity_id,
    m.entity_label,
    m.value_num,
    m.value_date,
    m.payload,
    m.source,
    m.occurred_at,
    d.dismissed_at
   FROM merged m
     CROSS JOIN prefs pr
     CROSS JOIN riyadh r
     LEFT JOIN notification_dismissals d ON d.user_id = auth.uid() AND d.alert_identity = m.alert_identity
  WHERE
        CASE m.severity
            WHEN 'red'::text THEN pr.show_red
            WHEN 'yellow'::text THEN pr.show_yellow
            WHEN 'blue'::text THEN pr.show_blue
            ELSE true
        END AND (d.alert_identity IS NULL OR m.severity = 'red'::text AND (d.dismissed_at AT TIME ZONE 'Asia/Riyadh'::text)::date <> r.today OR (m.severity = ANY (ARRAY['yellow'::text, 'blue'::text])) AND d.dismissed_at < (now() - '7 days'::interval));

-- CLAUDE.md §6 footer. Restated on every view replacement, without exception.
alter view public.v_my_notifications set (security_invoker = true);
revoke all on public.v_my_notifications from anon;
grant select on public.v_my_notifications to authenticated;

-- ---------------------------------------------------------------------
-- 2. The view comment.
--
-- SEPARATE STATEMENT BECAUSE A COMMENT SURVIVES `create or replace view`.
-- The comment belongs to the object and the OID does not change, so the old
-- text — which described "derived state alerts + stored events" — outlived the
-- branch and the table it named. A replaced view does NOT get a refreshed
-- comment for free; it has to be restated, exactly like the security footer
-- above, and for the same reason: what survives a replacement is not obvious.
--
-- Text below is byte-identical to what is live, pulled with
--     select obj_description('public.v_my_notifications'::regclass,'pg_class');
-- rather than re-typed. It still names notification_events, deliberately — as a
-- record of what was removed and when, not as a live reference.
-- ---------------------------------------------------------------------
comment on view public.v_my_notifications is
  'Per-user notification read layer (security_invoker): derived state alerts from v_active_alerts, with per-user show_red/yellow/blue prefs and the dismiss rule (red resurfaces next Riyadh day; yellow/blue stay dismissed 7 days) applied. Reads notification_prefs and notification_dismissals as the calling user. The notification_events branch was removed in 0160 (dormant, 0 rows/0 writers).';

-- ---------------------------------------------------------------------
-- 3. The table. Bare drop — no CASCADE, no `if exists`. See the header.
-- ---------------------------------------------------------------------
drop table public.notification_events;

commit;
--
-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) THE TABLE IS GONE.
--      select to_regclass('public.notification_events') as should_be_null;
--      -- expect NULL
--
-- B) THE VIEW STILL WORKS, STILL SECURITY_INVOKER, STILL ANON-LOCKED.
--      select count(*) as rows from public.v_my_notifications;
--      -- expect 9 under the shared defaults (viewer-dependent since 0158 —
--      -- auth.uid() is NULL in the SQL editor, so no per-user override applies)
--
--      select c.reloptions::text as reloptions,
--             has_table_privilege('anon', c.oid, 'select')          as anon_select,
--             has_table_privilege('authenticated', c.oid, 'select') as authd_select
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relname='v_my_notifications';
--      -- expect {security_invoker=true} / false / true
--
-- C) THE VIEW NO LONGER MENTIONS THE TABLE.
--      select pg_get_viewdef('public.v_my_notifications'::regclass, true)
--             ilike '%notification_events%' as should_be_false;
--      -- expect false
--
-- D) THE COLUMN LIST IS UNCHANGED — twelve columns, same names and order.
--      select attnum, attname, format_type(atttypid, atttypmod) as type
--        from pg_attribute
--       where attrelid='public.v_my_notifications'::regclass
--         and attnum > 0 and not attisdropped
--       order by attnum;
--      -- expect exactly: alert_identity, severity, category, entity_type,
--      -- entity_id, entity_label, value_num, value_date, payload, source,
--      -- occurred_at, dismissed_at
--      -- `source` must still be present — lib/actions/notifications.ts selects it.
--
-- E) NOTHING ELSE MOVED.
--      select count(*) as views,
--             count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind = 'v' and n.nspname = 'public';
--      -- expect 50 / 50 / 0 — UNCHANGED. This replaces a view, it does not add one.
--
--      select count(*) as tables, count(*) filter (where c.relrowsecurity) as rls
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind='r' and n.nspname='public';
--      -- expect 83 / 83  (was 84 / 84 before this file)
--
--      select count(*) as buckets from storage.buckets;
--      -- expect 12, unchanged
--
-- F) THE COMMENT NO LONGER DESCRIBES THE REMOVED BRANCH AS LIVE.
--      select obj_description('public.v_my_notifications'::regclass,'pg_class')
--             ilike '%stored events%' as should_be_false;
--      -- expect false
--
--    It DOES still contain the string "notification_events", and that is correct
--    — the sentence records that the branch was removed in 0160. Do not "fix"
--    that by grepping for the table name; check the claim, not the substring.
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
-- There is no clean automatic rollback, and that is worth stating plainly rather
-- than shipping a block that looks like one.
--
-- Restoring the TABLE is easy — re-run 0154's `create table public
-- .notification_events (...)` plus its dedupe index, occurred_at index, RLS
-- enable, policy and anon revoke. The definition is intact in that file.
--
-- Restoring the VIEW's events branch means re-running 0155's full
-- `create or replace view public.v_my_notifications`, which carries the
-- `union all` against the events table — and then restating the §6 security
-- footer, because that replacement drops reloptions too.
--
-- THE DATA IS NOT RECOVERABLE, because there was none: the table held 0 rows at
-- the moment it was dropped. That is the entire premise of the change, and it is
-- why no backup step appears here.
-- ===========================================================================
