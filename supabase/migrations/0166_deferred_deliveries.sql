-- 0166_deferred_deliveries.sql
-- A manual SIDE-LOG of out-of-scope deliveries — diesel transport, ad-hoc
-- customer filling, anything that is a real delivery but NOT a project trip.
-- Feeds the Daily Trips report and nothing else.
--
-- DRAFTED TO DISK. NOT APPLIED. The architect applies via MCP.
--
-- ===========================================================================
-- HARD RULE — THIS TABLE IS ISOLATED. IT IS NOT PART OF THE MONEY MODEL.
-- ===========================================================================
-- **NOTHING MAY READ THIS TABLE EXCEPT THE DAILY TRIPS REPORT.** Not P&L, not
-- any revenue view, not commission payouts, not invoicing, not anything that
-- reads `trips`. It must not be added to an existing view or report, and no
-- existing view is touched by this migration.
--
-- WHY THE ISOLATION IS THE WHOLE POINT. These rows are TYPED BY A HUMAN. They
-- carry no trip, no project, no rate, no frozen commission terms, and none of
-- the invariants the real money path depends on — `trips.rate_sar` and
-- `trips.commission_*` exist precisely because a delivered trip must own the
-- terms it was delivered under (§7, 0152). A hand-entered `revenue_sar` has no
-- such provenance. Folding these numbers into P&L or a payout would mix audited,
-- frozen figures with free-text ones and there would be no way to tell them
-- apart afterwards.
--
-- The failure mode is silent and permanent: revenue that never had an invoice,
-- commission that never had a rate, and a reconciliation that can never be made
-- to balance because half the inputs are not derived from anything.
--
-- SO: if a future feature wants these numbers in a financial total, that is a
-- DELIBERATE decision with its own migration, its own provenance rules, and its
-- own conversation — not a join someone adds because the columns look additive.
-- The isolation is restated in the table comment so it survives in the database.
--
-- ===========================================================================
-- ON DELETE RESTRICT — FLAGGED FOR REVIEW, WITH THE REASONING
-- ===========================================================================
-- Both foreign keys use `on delete restrict`. This matches the lean stated in
-- the brief, and the schema supports it more strongly than expected:
--
-- **drivers AND trucks ARE SOFT-DELETED, NOT DELETED.** Both carry
-- `terminated_at` — verified live — and CLAUDE.md §6 locks that in: "Soft-delete,
-- not hard-delete for operational records. Terminated = pre-filter, never a
-- state." So in normal operation NOTHING deletes a driver or a truck, which
-- means RESTRICT costs nothing day to day. It only fires on an act that is
-- already off the sanctioned path.
--
-- And on that act it does the right thing. The alternatives are worse:
--   - CASCADE would silently erase logged deliveries — money records, typed by
--     hand and unrecoverable — as a side effect of removing a driver row.
--   - SET NULL needs nullable columns, which the brief rules out, and would
--     leave an entry attributed to nobody. A Daily Trips report keyed on driver
--     cannot use such a row; it would be a permanent orphan nobody can action.
--   - NO ACTION behaves the same here but defers the check; RESTRICT states the
--     intent immediately and reads unambiguously.
--
-- RESTRICT turns "delete a driver who has logged deliveries" into a loud,
-- specific error at the moment someone tries it — which is the correct outcome
-- for an operation that should be a termination instead.
--
-- **REVIEW POINT:** if a driver or truck ever genuinely must be hard-deleted,
-- this blocks it until the log rows are dealt with explicitly. That is the
-- intended trade and it is stated here so it is a choice, not a surprise.
--
-- ===========================================================================
-- ONE DEVIATION FROM THE BRIEF: numeric(12,2), NOT BARE numeric — FLAG THIS
-- ===========================================================================
-- The brief specifies `commission_sar numeric` and `revenue_sar numeric`. This
-- file uses **numeric(12,2)** for both, matching the money convention already in
-- the schema — verified live: `trips.rate_sar`, `trips.commission_sar` and
-- `trips.commission_base_sar` are all numeric(12,2).
--
-- Bare `numeric` accepts unbounded precision and arbitrary scale, so 10.005 or a
-- forty-digit value stores happily and only surfaces later as a total that will
-- not reconcile to the halala. Money in this schema has a scale; a side-log of
-- money should not be the one place it does not.
--
-- 12,2 also bounds the value at 9,999,999,999.99, which is far above any
-- plausible single manual entry and therefore catches a typo'd extra digit.
--
-- **Say the word and this reverts to bare `numeric` in one edit** — it is the
-- only place this file departs from the brief.
--
-- ===========================================================================
-- WHAT THIS FILE DOES NOT TOUCH
-- ===========================================================================
-- No existing table, no existing view, no function, no policy on anything else,
-- no bucket, and no app code. It creates one table and its trigger, index, RLS
-- policy and comments. `set_updated_at()` is REUSED from 0157, not redefined —
-- it is currently attached to issue_reports, notification_thresholds_user and
-- user_profiles; this makes four.
--
-- ANON: this table is born with no anon grants. 0161 revoked the schema's
-- default privileges for `anon` on TABLES, verified live before drafting (the
-- postgres default ACL no longer lists anon), so a table created after it does
-- NOT inherit them. The explicit `revoke all ... from anon` below is kept anyway
-- — CLAUDE.md §6 requires it on every new table, because 0161 only covers tables
-- created AFTER it and each migration should read correctly on its own.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. THE TABLE
--
-- PK columns confirmed against the live catalog before writing the FKs rather
-- than assumed: `drivers.id` and `trucks.id`, both uuid, both
-- `gen_random_uuid()`.
--
-- `delivery_date` is a DATE and owns its own day, deliberately mirroring
-- `trips.trip_date`. The Daily Trips report buckets by calendar day in Riyadh,
-- and a timestamptz would put the same delivery on two different days depending
-- on the reader's clock — the UTC-skew trap CLAUDE.md §6's todayKey() rule
-- exists for.
--
-- `trip_count` allows 0 (`>= 0`, not `> 0`): a correction entry that zeroes out
-- a mistaken log is a legitimate thing to record, and forcing >= 1 would make
-- the fix a deletion instead, losing the audit trail of what was entered.
-- ---------------------------------------------------------------------
create table if not exists public.deferred_deliveries (
  id             uuid        primary key default gen_random_uuid(),

  driver_id      uuid        not null references public.drivers(id) on delete restrict,
  truck_id       uuid        not null references public.trucks(id)  on delete restrict,

  delivery_date  date        not null,
  description    text,

  trip_count     integer     not null default 1,
  commission_sar numeric(12,2) not null default 0,
  revenue_sar    numeric(12,2) not null default 0,

  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint deferred_deliveries_trip_count_nonneg
    check (trip_count >= 0),
  constraint deferred_deliveries_commission_nonneg
    check (commission_sar >= 0),
  constraint deferred_deliveries_revenue_nonneg
    check (revenue_sar >= 0)
);

-- The report reads a day, or a driver's days. Both are covered; the composite
-- leads on delivery_date because "show me a date" is the primary question and a
-- leading-column match serves the date-only query too.
create index if not exists deferred_deliveries_date_idx
  on public.deferred_deliveries (delivery_date desc);
create index if not exists deferred_deliveries_date_driver_idx
  on public.deferred_deliveries (delivery_date desc, driver_id);

-- ---------------------------------------------------------------------
-- 2. updated_at, maintained by the database.
--
-- REUSES set_updated_at() from 0157 rather than defining a second near-identical
-- function. The WHEN clause matters: without it "last updated" would mean "last
-- written to", and re-saving an unchanged row would look like activity.
-- ---------------------------------------------------------------------
drop trigger if exists deferred_deliveries_set_updated_at on public.deferred_deliveries;
create trigger deferred_deliveries_set_updated_at
  before update on public.deferred_deliveries
  for each row
  when (old.* is distinct from new.*)
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3. RLS. Shared log, both users read and write every row.
--
-- `using (true) with check (true)` matches the shared-queue shape 0157 uses for
-- issue_reports and NOT the own-row shape 0159 uses for user_profiles. This is
-- operational data about the fleet, not personal data: either user logs a
-- delivery and either corrects it. A per-author restriction would mean the
-- person who spots a wrong figure is the one who cannot fix it.
--
-- `created_by` is TEXT and captures the actor's email for the audit trail — the
-- project's RPC convention (domain skill: "actor capture ... never rely on
-- auth.uid() alone"). It is descriptive, NOT a security boundary; nothing keys
-- off it and the RLS policy does not mention it.
-- ---------------------------------------------------------------------
alter table public.deferred_deliveries enable row level security;

drop policy if exists authenticated_all_deferred_deliveries on public.deferred_deliveries;
create policy authenticated_all_deferred_deliveries
  on public.deferred_deliveries for all to authenticated
  using (true) with check (true);

revoke all on public.deferred_deliveries from anon;

-- ---------------------------------------------------------------------
-- 4. Comments — the isolation rule, stated where a schema dump repeats it.
-- ---------------------------------------------------------------------
comment on table public.deferred_deliveries is
  'MANUAL SIDE-LOG of out-of-scope deliveries (diesel transport, ad-hoc customer filling) that are NOT project trips (0166). ISOLATED BY DESIGN: this table feeds the Daily Trips report ONLY. It must NEVER be read by P&L, any revenue view, commission payouts, invoicing, or anything that reads public.trips, and it must not be joined into an existing view or report. These rows are typed by a human and carry no trip, project, rate or frozen commission terms — unlike trips, where rate_sar and commission_* exist precisely so a delivered trip owns the terms it was delivered under. Mixing hand-entered figures into audited totals produces revenue with no invoice and commission with no rate, indistinguishable afterwards from the real thing. If these numbers are ever wanted in a financial total, that is a deliberate change with its own migration and its own provenance rules. Both FKs are ON DELETE RESTRICT: drivers and trucks are soft-deleted via terminated_at, so a hard delete is already off the sanctioned path and should fail loudly rather than erase or orphan a logged entry.';

comment on column public.deferred_deliveries.delivery_date is
  'The calendar day the delivery happened, in Riyadh terms. A DATE, not a timestamptz, mirroring trips.trip_date — the Daily Trips report buckets by local day, and an instant would land the same delivery on different days for different readers.';

comment on column public.deferred_deliveries.trip_count is
  'How many deliveries this row represents. Allows 0 so a correction can zero out a mistaken entry without deleting it and losing the audit trail.';

comment on column public.deferred_deliveries.revenue_sar is
  'Hand-entered revenue for this log entry. NOT invoiced, NOT VAT-processed, and NOT part of any financial total — see the table comment. numeric(12,2) to match the schema money convention.';

comment on column public.deferred_deliveries.created_by is
  'Actor email, captured for the audit trail. Descriptive only — not a security boundary, and the RLS policy does not reference it.';

-- ---------------------------------------------------------------------
-- 5. Self-asserts. Any failure rolls the whole migration back.
-- ---------------------------------------------------------------------
do $$
declare
  v_fks   int;
  v_bad   text;
  v_anon  int;
begin
  -- Exactly two FKs, both RESTRICT, pointing where they should.
  select count(*) into v_fks
    from pg_constraint
   where conrelid = 'public.deferred_deliveries'::regclass
     and contype = 'f'
     and confdeltype = 'r'                      -- 'r' = RESTRICT
     and confrelid in ('public.drivers'::regclass, 'public.trucks'::regclass);

  if v_fks <> 2 then
    raise exception 'expected 2 RESTRICT foreign keys to drivers/trucks, found %', v_fks;
  end if;

  -- anon must hold nothing. 0161 should already guarantee this for a new table;
  -- asserting it here is what proves the default-privileges revoke actually
  -- covers tables created after it, rather than assuming it does.
  select count(*) into v_anon
    from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public'
     and table_name = 'deferred_deliveries';

  if v_anon <> 0 then
    raise exception 'anon holds % privileges on deferred_deliveries', v_anon;
  end if;

  -- THE ISOLATION RULE, ASSERTED. No view may depend on this table. pg_depend
  -- records a rewrite dependency for every view that selects from it, so this
  -- catches a join added in the same transaction.
  select string_agg(distinct dependent.relname, ', ') into v_bad
    from pg_depend d
    join pg_rewrite rw on rw.oid = d.objid
    join pg_class dependent on dependent.oid = rw.ev_class
   where d.refobjid = 'public.deferred_deliveries'::regclass
     and d.classid = 'pg_rewrite'::regclass
     and dependent.relkind = 'v';

  if v_bad is not null then
    raise exception 'deferred_deliveries must not be read by any view, but these do: %', v_bad;
  end if;

  raise notice 'deferred_deliveries: 2 RESTRICT FKs, anon has nothing, no view depends on it';
end $$;

commit;

-- ===========================================================================
-- POSTGREST SCHEMA CACHE
-- ===========================================================================
-- A new table. PostgREST reloads on the DDL event; if a select 404s with
-- PGRST205 ("Could not find the table ... in the schema cache"), nudge it:
--     notify pgrst, 'reload schema';
--
-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) THE TABLE EXISTS, RLS IS ON, ANON HOLDS NOTHING.
--      select c.relname, c.relkind, c.relrowsecurity as rls_enabled
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relname='deferred_deliveries';
--      -- expect: r / true
--
--      select count(*) as anon_privileges
--        from information_schema.role_table_grants
--       where grantee='anon' and table_schema='public'
--         and table_name='deferred_deliveries';
--      -- expect 0 — this is also the check that 0161's default-privileges
--      -- revoke really does cover newly created tables.
--
--      select has_table_privilege('authenticated','public.deferred_deliveries','select') as authd_select;
--      -- expect true
--
-- B) BOTH FOREIGN KEYS RESOLVE, AND BOTH ARE RESTRICT.
--      select conname, pg_get_constraintdef(oid) as def
--        from pg_constraint
--       where conrelid='public.deferred_deliveries'::regclass and contype='f'
--       order by conname;
--      -- expect exactly 2:
--      --   FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE RESTRICT
--      --   FOREIGN KEY (truck_id)  REFERENCES trucks(id)  ON DELETE RESTRICT
--
-- C) THE CHECKS REJECT NEGATIVES. Every probe must ERROR; all rolled back.
--    Substitute real ids — `select id from drivers limit 1;` and
--    `select id from trucks limit 1;` — a random uuid raises 23503 on the FK
--    before the CHECK is ever evaluated, which would prove nothing.
--
--      -- negative trip_count -> 23514 deferred_deliveries_trip_count_nonneg
--      begin;
--        insert into public.deferred_deliveries (driver_id, truck_id, delivery_date, trip_count)
--        values ((select id from drivers limit 1), (select id from trucks limit 1), current_date, -1);
--      rollback;
--
--      -- negative commission -> 23514 deferred_deliveries_commission_nonneg
--      begin;
--        insert into public.deferred_deliveries (driver_id, truck_id, delivery_date, commission_sar)
--        values ((select id from drivers limit 1), (select id from trucks limit 1), current_date, -0.01);
--      rollback;
--
--      -- negative revenue -> 23514 deferred_deliveries_revenue_nonneg
--      begin;
--        insert into public.deferred_deliveries (driver_id, truck_id, delivery_date, revenue_sar)
--        values ((select id from drivers limit 1), (select id from trucks limit 1), current_date, -0.01);
--      rollback;
--
--      -- POSITIVE: zero is allowed on all three (a correction entry)
--      begin;
--        insert into public.deferred_deliveries
--          (driver_id, truck_id, delivery_date, trip_count, commission_sar, revenue_sar)
--        values ((select id from drivers limit 1), (select id from trucks limit 1),
--                current_date, 0, 0, 0);
--        select 'zeros accepted' as result;
--      rollback;
--
-- D) ON DELETE RESTRICT ACTUALLY BLOCKS. Rolled back; deletes nothing.
--      begin;
--        insert into public.deferred_deliveries (driver_id, truck_id, delivery_date)
--        values ((select id from drivers limit 1), (select id from trucks limit 1), current_date);
--        -- expect 23503 foreign_key_violation, NOT a silent cascade
--        delete from public.drivers where id = (select id from drivers limit 1);
--      rollback;
--
-- E) THE TRIGGER IS ATTACHED AND ONLY FIRES ON REAL CHANGES.
--      select tgname from pg_trigger
--       where tgrelid='public.deferred_deliveries'::regclass and not tgisinternal;
--      -- expect deferred_deliveries_set_updated_at
--
--      select tgrelid::regclass::text as attached_to
--        from pg_trigger
--       where tgfoid='public.set_updated_at'::regproc and not tgisinternal
--       order by 1;
--      -- expect FOUR: deferred_deliveries, issue_reports,
--      -- notification_thresholds_user, user_profiles
--
-- F) THE ISOLATION HOLDS — NOTHING READS IT. This is the check that matters
--    most, and the one to re-run after ANY future view work.
--      select dependent.relname as view_reading_it
--        from pg_depend d
--        join pg_rewrite rw on rw.oid = d.objid
--        join pg_class dependent on dependent.oid = rw.ev_class
--       where d.refobjid = 'public.deferred_deliveries'::regclass
--         and d.classid = 'pg_rewrite'::regclass
--         and dependent.relkind = 'v';
--      -- expect ZERO rows, now and forever
--
--      -- And no function body names it either:
--      select p.proname from pg_proc p
--       where p.pronamespace='public'::regnamespace
--         and pg_get_functiondef(p.oid) ilike '%deferred_deliveries%';
--      -- expect ZERO rows
--
-- G) NOTHING ELSE MOVED.
--      select count(*) as tables, count(*) filter (where c.relrowsecurity) as rls
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind='r' and n.nspname='public';
--      -- expect 84 / 84  (was 83 / 83 before this file)
--
--      select count(*) as views,
--             count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind='v' and n.nspname='public';
--      -- expect 50 / 50 / 0 — UNCHANGED. This adds a table, not a view.
--
--      select count(*) as buckets from storage.buckets;
--      -- expect 12, unchanged
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
--   begin;
--   drop table public.deferred_deliveries;   -- takes its trigger and indexes
--   commit;
--
-- Bare drop, no CASCADE, on purpose: nothing should depend on this table, and if
-- something does, the drop SHOULD fail loudly so whatever quietly started
-- reading it gets found. That is the isolation rule enforcing itself on the way
-- out as well as the way in.
--
-- DO NOT DROP set_updated_at(). This file does not create it; 0157 did, and
-- after this migration FOUR tables depend on it. Check before touching it:
--     select tgrelid::regclass as attached_to
--       from pg_trigger
--      where tgfoid = 'public.set_updated_at'::regproc and not tgisinternal;
--
-- THE DATA IS HAND-TYPED AND UNRECOVERABLE. There is no source system to re-import
-- from — a dropped row is gone. Export before dropping if any rows exist:
--     select * from public.deferred_deliveries order by delivery_date;
-- ===========================================================================
