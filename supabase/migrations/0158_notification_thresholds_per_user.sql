-- 0158_notification_thresholds_per_user.sql
-- Phase 2.2b step 1 — per-user notification thresholds. DATA LAYER ONLY; the
-- editor UI is step 2.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect applies via MCP.
--
-- ===========================================================================
-- THE PROBLEM
-- ===========================================================================
-- notification_thresholds is a SINGLE SHARED ROW. Two people use this app, so
-- one of them widening the maintenance window to stop a nagging alert silently
-- widens it for the other, who never asked and is not told. A threshold is a
-- personal tolerance for noise, not a company policy.
--
-- ===========================================================================
-- THE SHAPE: THREE LAYERS, RESOLVED PER COLUMN
-- ===========================================================================
--   1. notification_thresholds_user.<col>   this user's override
--   2. notification_thresholds.<col>        the shared default (UNCHANGED)
--   3. a hardcoded constant                 the floor
--
-- ALL FOUR OVERRIDE COLUMNS ARE NULLABLE, AND THAT IS THE FEATURE. NULL in a
-- column means "use the shared default for THIS threshold", so a user can raise
-- their maintenance window and still inherit everyone else's document lead time.
-- No row at all means all four defaults. That is also what makes
-- reset-to-default a one-column UPDATE to NULL rather than a delete-and-hope.
--
-- THE SINGLETON KEEPS ITS JOB. notification_thresholds is not dropped, not
-- changed, and not deprecated — it becomes the shared default layer that user
-- overrides fall back to. Editing it still moves the needle for everyone who has
-- not overridden that particular column, which is the right behaviour for a
-- company-wide default.
--
-- ===========================================================================
-- WHY MAKING THE ALERT VIEW auth.uid()-AWARE IS SAFE
-- ===========================================================================
-- Confirmed with the architect: v_my_notifications is the ONLY reader of
-- v_active_alerts, and it is already security_invoker and already per-user (it
-- applies this user's severity preferences and dismissals). So v_active_alerts
-- was already only ever evaluated in one user's context — it simply did not use
-- that context for thresholds. This adds no new per-user surface; it uses the
-- one that was already there.
--
-- auth.uid() is NULL for a non-user caller (the SQL editor, a service role). The
-- LEFT JOIN then matches nothing and every threshold falls through to the shared
-- default, which is the correct answer to "no particular viewer" — not an error
-- and not an empty result.
--
-- ===========================================================================
-- THE ENTIRE VIEW CHANGE IS ONE CTE
-- ===========================================================================
-- create or replace view public.v_active_alerts, replacing ONLY the `th` CTE.
-- The new CTE keeps the SAME FOUR OUTPUT COLUMN NAMES — low_runway_trips,
-- lead_days, stuck_days, red_days — so not one of the nineteen branches
-- downstream needs touching, and none of them was.
--
-- The body below was extracted from 0156 programmatically and had exactly that
-- one CTE substituted; the build asserts that everything after it is
-- byte-identical (15,433 characters unchanged, 19 union branches preserved).
-- Editing a nineteen-branch view by retyping it is how a stray character becomes
-- a silent behaviour change.
--
-- Column list is unchanged at 9, so `create or replace` is legal. It DOES drop
-- reloptions, so the security footer is restated — CLAUDE.md section 6.
--
-- ===========================================================================
-- MEASURED BEFORE DRAFTING — the thresholds demonstrably drive the results
-- ===========================================================================
-- Probed read-only against live data, each threshold at its default vs an
-- override, to prove this is wiring something real rather than plumbing that
-- happens to compile:
--
--   doc_expiry_lead_days    30 -> 1 alert     5 -> 0 alerts    SENSITIVE
--   maintenance_stuck_days   7 -> 1 alert    30 -> 0 alerts    SENSITIVE
--   invoice_overdue_red_days 30 -> 1 red     60 -> 0 red       SENSITIVE (flips to yellow)
--   low_runway_trips        10 -> 1 alert    30 -> 1 alert     no change TODAY
--
-- The low-runway insensitivity is data, not a bug, and is worth knowing before
-- someone "fixes" it: of the three prepaid wallets, two are OVERDRAWN
-- (balance < 0) and therefore live in the overdrawn branch, which has no
-- threshold at all; the third holds exactly 0.00, and 0 is below every positive
-- threshold. So no value of low_runway_trips can change today's set. It will
-- start moving the moment a wallet holds a positive balance.
--
-- ===========================================================================
-- WHAT THIS FILE DOES NOT TOUCH
-- ===========================================================================
-- notification_thresholds (the singleton stays, as the default layer),
-- notification_prefs, notification_dismissals, notification_events,
-- v_my_notifications, every money view, company_settings, issue_reports.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. THE PER-USER OVERRIDE TABLE
--
-- One row per user, at most — user_id is the primary key, so "my thresholds"
-- cannot fork into two rows that disagree.
--
-- Every threshold column is NULLABLE and there is no default on any of them: a
-- default would mean a user who touches one threshold silently freezes the other
-- three at whatever the shared value was on the day they first opened the
-- editor, and would never see a company-wide default change again.
-- ---------------------------------------------------------------------
create table if not exists public.notification_thresholds_user (
  user_id                   uuid primary key references auth.users(id) on delete cascade,
  low_runway_trips          numeric(6,2),
  doc_expiry_lead_days      integer,
  maintenance_stuck_days    integer,
  invoice_overdue_red_days  integer,
  updated_at                timestamptz not null default now(),

  -- Same bounds as the singleton's sanity check, but every clause must tolerate
  -- NULL — NULL is the "inherit" signal and must never be rejected as
  -- out-of-range.
  constraint notification_thresholds_user_sane check (
        (low_runway_trips         is null or low_runway_trips >= 0)
    and (doc_expiry_lead_days     is null or doc_expiry_lead_days     between 0 and 365)
    and (maintenance_stuck_days   is null or maintenance_stuck_days   between 0 and 365)
    and (invoice_overdue_red_days is null or invoice_overdue_red_days between 0 and 365)
  )
);

-- The shared trigger from 0157, reused rather than redefined.
drop trigger if exists notification_thresholds_user_set_updated_at
  on public.notification_thresholds_user;
create trigger notification_thresholds_user_set_updated_at
  before update on public.notification_thresholds_user
  for each row
  when (old.* is distinct from new.*)
  execute function public.set_updated_at();

alter table public.notification_thresholds_user enable row level security;

drop policy if exists own_notification_thresholds_user on public.notification_thresholds_user;
create policy own_notification_thresholds_user
  on public.notification_thresholds_user for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.notification_thresholds_user from anon;

comment on table public.notification_thresholds_user is
  'Per-user notification threshold overrides (0158), RLS to auth.uid(). A NULL column means "fall back to the shared notification_thresholds default for THIS threshold" — resolution is per column, so a user can override one and inherit the rest. No row at all means all four defaults. Reset-to-default is therefore an UPDATE of the column to NULL, not a row delete. The singleton notification_thresholds is NOT deprecated by this: it remains the shared default layer that these overrides fall back to.';

-- ---------------------------------------------------------------------
-- 2. v_active_alerts — IDENTICAL TO 0156 EXCEPT THE `th` CTE.
--
-- Same four output column names, so all nineteen branches below are untouched.
-- ---------------------------------------------------------------------
create or replace view public.v_active_alerts as
with th as (
  -- 0158: THRESHOLDS NOW RESOLVE PER VIEWER. Three layers, in order:
  --   1. this user's override in notification_thresholds_user (NULL = skip)
  --   2. the shared notification_thresholds singleton
  --   3. a hardcoded constant
  --
  -- Resolved PER COLUMN, not per row, which is the whole point: a user can
  -- raise their maintenance window and still inherit everyone else's document
  -- lead time. A row-level "use mine or use theirs" would force all four to
  -- move together.
  --
  -- ALWAYS EXACTLY ONE ROW, even with no user row and an empty singleton. The
  -- `from (select auth.uid())` seed guarantees a row exists to LEFT JOIN onto,
  -- and each scalar subquery yields NULL rather than no-row. A CROSS JOIN to an
  -- empty singleton would return ZERO rows and silently switch every alert in
  -- the app off — the same trap 0154 called out, now with a second table that
  -- can be empty.
  --
  -- auth.uid() is NULL for a non-user caller (the SQL editor, a service role).
  -- The LEFT JOIN then matches nothing and every threshold falls through to the
  -- shared default, which is the correct answer for "no particular viewer".
  select
    coalesce(u.low_runway_trips,
             (select low_runway_trips from public.notification_thresholds limit 1),
             10)::numeric as low_runway_trips,
    coalesce(u.doc_expiry_lead_days,
             (select doc_expiry_lead_days from public.notification_thresholds limit 1),
             30)::int     as lead_days,
    coalesce(u.maintenance_stuck_days,
             (select maintenance_stuck_days from public.notification_thresholds limit 1),
             7)::int      as stuck_days,
    coalesce(u.invoice_overdue_red_days,
             (select invoice_overdue_red_days from public.notification_thresholds limit 1),
             30)::int     as red_days
    from (select auth.uid() as uid) me
    left join public.notification_thresholds_user u on u.user_id = me.uid
),
riyadh as (
  select (now() at time zone 'Asia/Riyadh')::date as today
),
-- ONE ROW PER PREPAID CUSTOMER WALLET, not per project. A customer with two
-- prepaid projects has ONE balance, so per-project keying would fire the same
-- wallet twice with two identities and require two dismissals for one fact.
--
-- top_rate is the HIGHEST current rate among their active unarchived prepaid
-- projects — the conservative choice, because runway should be measured against
-- the most expensive work the wallet might fund next.
prepaid_cust as (
  select p.customer_id,
         max(p.rate_per_trip_sar)  as top_rate,
         count(*)::int             as prepaid_projects
    from public.projects p
    join public.customers c on c.id = p.customer_id
   where p.archived_at is null
     and c.archived_at is null
     and p.payment_mode = 'prepaid'
   group by p.customer_id
),
-- Effective expiry for an archive document: the newest renewal that has not
-- been superseded, else the document's own date. Per-group warning_days wins
-- over the global lead days where the group sets one.
doc_effective as (
  select a.id,
         a.title,
         coalesce(
           (select r.expiry_date
              from public.archive_document_renewals r
             where r.document_id = a.id and r.superseded_at is null
             order by r.expiry_date desc nulls last
             limit 1),
           a.expiry_date
         ) as expiry_date,
         coalesce(g.warning_days, (select lead_days from th)) as lead_days
    from public.archive_documents a
    left join public.archive_document_groups g on g.id = a.group_id
)
-- ---- YELLOW: prepaid wallet OVERDRAWN -----------------------------------
-- balance_sar read straight from v_customer_prepaid_balance. No balance is
-- recomputed here — 0142 fixed the returns debit at exactly two expressions and
-- this file adds no third.
select 'prepaid_overdrawn:customer:' || k.customer_id::text  as alert_identity,
       'yellow'::text                                        as severity,
       'finance'::text                                       as category,
       'customer'::text                                      as entity_type,
       k.customer_id                                         as entity_id,
       b.customer_name                                       as entity_label,
       b.balance_sar                                         as value_num,
       null::date                                            as value_date,
       jsonb_build_object('balance_sar', b.balance_sar,
                          'top_rate_per_trip_sar', k.top_rate,
                          'prepaid_projects', k.prepaid_projects) as payload
  from prepaid_cust k
  join public.v_customer_prepaid_balance b on b.customer_id = k.customer_id
 where b.balance_sar < 0

-- ---- YELLOW: prepaid wallet LOW RUNWAY ----------------------------------
-- Mutually exclusive with OVERDRAWN by the balance predicate (>= 0 here, < 0
-- there), so one wallet can never emit both identities at once.
union all
select 'prepaid_low_runway:customer:' || k.customer_id::text, 'yellow', 'finance',
       'customer', k.customer_id, b.customer_name, b.balance_sar, null,
       jsonb_build_object('balance_sar', b.balance_sar,
                          'top_rate_per_trip_sar', k.top_rate,
                          'low_runway_trips', th.low_runway_trips,
                          'trips_of_runway',
                          case when coalesce(k.top_rate,0) > 0
                               then round(b.balance_sar / k.top_rate, 1)
                               else null end,
                          'prepaid_projects', k.prepaid_projects)
  from prepaid_cust k
  join public.v_customer_prepaid_balance b on b.customer_id = k.customer_id
  cross join th
 where b.balance_sar >= 0
   and b.balance_sar < th.low_runway_trips * coalesce(k.top_rate, 0)

-- ---- RED: expired documents (four entity fields + archive) --------------
union all
select 'doc_expiry:driver:' || d.id::text || ':license', 'red', 'compliance',
       'driver', d.id, d.name, null, d.license_expiry,
       jsonb_build_object('field','license_expiry','expiry_date',d.license_expiry)
  from public.drivers d cross join riyadh r
 where d.terminated_at is null and d.license_expiry is not null
   and d.license_expiry < r.today
union all
select 'doc_expiry:driver:' || d.id::text || ':iqama', 'red', 'compliance',
       'driver', d.id, d.name, null, d.iqama_expiry,
       jsonb_build_object('field','iqama_expiry','expiry_date',d.iqama_expiry)
  from public.drivers d cross join riyadh r
 where d.terminated_at is null and d.iqama_expiry is not null
   and d.iqama_expiry < r.today
union all
select 'doc_expiry:staff:' || s.id::text || ':iqama', 'red', 'compliance',
       'staff', s.id, s.name, null, s.iqama_expiry,
       jsonb_build_object('field','iqama_expiry','expiry_date',s.iqama_expiry)
  from public.staff s cross join riyadh r
 where s.terminated_at is null and s.iqama_expiry is not null
   and s.iqama_expiry < r.today
union all
select 'doc_expiry:truck:' || t.id::text || ':registration', 'red', 'compliance',
       'truck', t.id, t.plate, null, t.registration_expiry,
       jsonb_build_object('field','registration_expiry','expiry_date',t.registration_expiry)
  from public.trucks t cross join riyadh r
 where t.terminated_at is null and t.registration_expiry is not null
   and t.registration_expiry < r.today
union all
select 'doc_expiry:document:' || de.id::text, 'red', 'compliance',
       'document', de.id, de.title, null, de.expiry_date,
       jsonb_build_object('field','archive_document','expiry_date',de.expiry_date)
  from doc_effective de cross join riyadh r
 where de.expiry_date is not null and de.expiry_date < r.today

-- ---- RED: part at or below reorder level --------------------------------
union all
select 'part_reorder:part:' || p.id::text, 'red', 'inventory',
       'part', p.id, p.name, p.qty_on_hand, null,
       jsonb_build_object('sku',p.sku,'qty_on_hand',p.qty_on_hand,
                          'reorder_level',p.reorder_level,'unit',p.unit)
  from public.parts p
 where p.active and p.reorder_level is not null
   and p.qty_on_hand <= p.reorder_level

-- ---- RED: work order stuck ----------------------------------------------
-- 'in_progress' IS included; see OVERLAP note (c) at the head of this file.
union all
select 'wo_stuck:work_order:' || w.id::text, 'red', 'maintenance',
       'work_order', w.id, coalesce(w.wo_number, w.title),
       (r.today - w.opened_at::date)::numeric, w.opened_at::date,
       jsonb_build_object('wo_number',w.wo_number,'truck_id',w.truck_id,
                          'status',w.status,'days_open',(r.today - w.opened_at::date))
  from public.work_orders w cross join riyadh r cross join th
 where w.status in ('open','in_progress','awaiting_parts')
   and w.opened_at is not null
   and w.opened_at::date < r.today - th.stuck_days

-- ---- RED / YELLOW: postpaid invoice outstanding -------------------------
-- Reuses v_receivables_open wholesale. No aging and no money math is restated:
-- days_outstanding, outstanding_sar and aging_bucket all come from that view.
-- Past due beyond red_days is red, past due within it is yellow.
union all
select 'invoice_overdue:invoice:' || ro.invoice_id::text,
       case when ro.days_outstanding > th.red_days then 'red' else 'yellow' end,
       'finance', 'invoice', ro.invoice_id, ro.invoice_number,
       ro.outstanding_sar, ro.period_end,
       jsonb_build_object('customer_name',ro.customer_name,
                          'outstanding_sar',ro.outstanding_sar,
                          'days_outstanding',ro.days_outstanding,
                          'aging_bucket',ro.aging_bucket)
  from public.v_receivables_open ro
  join public.v_invoice_outstanding_live o on o.invoice_id = ro.invoice_id
  cross join th
 where o.effective_payment_mode = 'postpaid'
   and ro.days_outstanding > 0

-- ---- YELLOW: documents expiring within lead days ------------------------
union all
select 'doc_expiry:driver:' || d.id::text || ':license', 'yellow', 'compliance',
       'driver', d.id, d.name, null, d.license_expiry,
       jsonb_build_object('field','license_expiry','expiry_date',d.license_expiry)
  from public.drivers d cross join riyadh r cross join th
 where d.terminated_at is null and d.license_expiry is not null
   and d.license_expiry >= r.today
   and d.license_expiry < r.today + th.lead_days
union all
select 'doc_expiry:driver:' || d.id::text || ':iqama', 'yellow', 'compliance',
       'driver', d.id, d.name, null, d.iqama_expiry,
       jsonb_build_object('field','iqama_expiry','expiry_date',d.iqama_expiry)
  from public.drivers d cross join riyadh r cross join th
 where d.terminated_at is null and d.iqama_expiry is not null
   and d.iqama_expiry >= r.today
   and d.iqama_expiry < r.today + th.lead_days
union all
select 'doc_expiry:staff:' || s.id::text || ':iqama', 'yellow', 'compliance',
       'staff', s.id, s.name, null, s.iqama_expiry,
       jsonb_build_object('field','iqama_expiry','expiry_date',s.iqama_expiry)
  from public.staff s cross join riyadh r cross join th
 where s.terminated_at is null and s.iqama_expiry is not null
   and s.iqama_expiry >= r.today
   and s.iqama_expiry < r.today + th.lead_days
union all
select 'doc_expiry:truck:' || t.id::text || ':registration', 'yellow', 'compliance',
       'truck', t.id, t.plate, null, t.registration_expiry,
       jsonb_build_object('field','registration_expiry','expiry_date',t.registration_expiry)
  from public.trucks t cross join riyadh r cross join th
 where t.terminated_at is null and t.registration_expiry is not null
   and t.registration_expiry >= r.today
   and t.registration_expiry < r.today + th.lead_days
union all
select 'doc_expiry:document:' || de.id::text, 'yellow', 'compliance',
       'document', de.id, de.title, null, de.expiry_date,
       jsonb_build_object('field','archive_document','expiry_date',de.expiry_date,
                          'lead_days',de.lead_days)
  from doc_effective de cross join riyadh r
 where de.expiry_date is not null
   and de.expiry_date >= r.today
   and de.expiry_date < r.today + de.lead_days

-- ---- YELLOW: employee returning from leave within 3 days ----------------
-- 3 days is a fixed product rule, not a threshold: it means "prepare for their
-- return", which does not vary with how noisy the other windows are. Promote it
-- to notification_thresholds if that turns out wrong.
union all
select 'leave_return:' || case when l.driver_id is not null then 'driver' else 'staff' end
         || ':' || coalesce(l.driver_id, l.staff_id)::text || ':' || l.id::text,
       'yellow', 'people',
       case when l.driver_id is not null then 'driver' else 'staff' end,
       coalesce(l.driver_id, l.staff_id),
       coalesce(d.name, s.name),
       (l.end_date - r.today)::numeric, l.end_date,
       jsonb_build_object('leave_type',l.leave_type,'end_date',l.end_date,
                          'days_until_return',(l.end_date - r.today))
  from public.leave_periods l
  cross join riyadh r
  left join public.drivers d on d.id = l.driver_id
  left join public.staff  s on s.id = l.staff_id
 where l.end_date is not null
   -- 0156: was `>= r.today`, now `> r.today`. THIS IS THE ONLY CHANGE IN THIS
   -- MIGRATION. Yellow is upcoming returns only; the blue employee_returned
   -- branch owns end_date = today. Disjoint by construction.
   and l.end_date >  r.today
   and l.end_date <= r.today + 3
   and coalesce(d.terminated_at, s.terminated_at) is null

-- ---- YELLOW: exit permit past expected return, not fully returned -------
union all
select 'permit_overdue:exit_permit:' || e.id::text, 'yellow', 'inventory',
       'exit_permit', e.id, e.ep_number,
       (r.today - e.expected_return_on)::numeric, e.expected_return_on,
       jsonb_build_object('ep_number',e.ep_number,
                          'expected_return_on',e.expected_return_on,
                          'days_overdue',(r.today - e.expected_return_on))
  from public.exit_permits e cross join riyadh r
 where e.status = 'exited'
   and e.expected_return_on is not null
   and e.expected_return_on < r.today
   and exists (select 1 from public.exit_permit_lines el
                where el.exit_permit_id = e.id
                  and coalesce(el.qty_returned, 0) < el.qty)

-- ---- BLUE: truck entered maintenance (work order opened today) ----------
-- Derived from work_orders.opened_at — no stored event, no server action.
-- LEFT JOIN trucks: a work order's truck_id is the entity, and the plate is
-- only a label. If the truck row is missing the alert still fires, because the
-- work order opening is the fact and the plate is decoration.
union all
select 'truck_in:work_order:' || w.id::text, 'blue', 'event',
       'truck', w.truck_id,
       coalesce(t.plate, '(no truck)') || ' · ' || coalesce(w.wo_number, w.title, '(no number)'),
       null, w.opened_at::date,
       jsonb_build_object('plate', t.plate,
                          'wo_number', w.wo_number,
                          'truck_id', w.truck_id)
  from public.work_orders w
  cross join riyadh r
  left join public.trucks t on t.id = w.truck_id
 where w.opened_at is not null
   and (w.opened_at at time zone 'Asia/Riyadh')::date = r.today

-- ---- BLUE: truck back in service (work order closed today) --------------
-- Derived from work_orders.closed_at. A work order opened AND closed on the
-- same day correctly produces BOTH blue rows — two different facts about the
-- same job, with two different identities, on one day.
union all
select 'truck_out:work_order:' || w.id::text, 'blue', 'event',
       'truck', w.truck_id,
       coalesce(t.plate, '(no truck)') || ' · ' || coalesce(w.wo_number, w.title, '(no number)'),
       null, w.closed_at::date,
       jsonb_build_object('plate', t.plate,
                          'wo_number', w.wo_number,
                          'truck_id', w.truck_id)
  from public.work_orders w
  cross join riyadh r
  left join public.trucks t on t.id = w.truck_id
 where w.closed_at is not null
   and (w.closed_at at time zone 'Asia/Riyadh')::date = r.today

-- ---- BLUE: employee returned today (leave ended today) ------------------
-- Derived from leave_periods.end_date. Terminated people are excluded on the
-- same coalesce the yellow leave branch uses, so someone terminated while on
-- leave does not "return".
--
-- The leave id is in the identity because one person can have several leave
-- periods; keying on the person alone would merge two returns into one.
--
-- See the KNOWN OVERLAP note at the head of this file: on the return day this
-- fires alongside the existing yellow leave_return branch.
union all
select 'employee_returned:' || case when l.driver_id is not null then 'driver' else 'staff' end
         || ':' || coalesce(l.driver_id, l.staff_id)::text || ':' || l.id::text,
       'blue', 'event',
       case when l.driver_id is not null then 'driver' else 'staff' end,
       coalesce(l.driver_id, l.staff_id),
       coalesce(d.name, s.name),
       null, l.end_date,
       jsonb_build_object('leave_type', l.leave_type,
                          'end_date', l.end_date)
  from public.leave_periods l
  cross join riyadh r
  left join public.drivers d on d.id = l.driver_id
  left join public.staff  s on s.id = l.staff_id
 where l.end_date = r.today
   and coalesce(d.terminated_at, s.terminated_at) is null;

-- ---------------------------------------------------------------------
-- SECURITY FOOTER — RESTATED, NOT OPTIONAL.
--
-- `create or replace view` DROPS reloptions, so the view above lost
-- security_invoker the moment it was replaced. That matters more than usual
-- here: without security_invoker the view would run as its OWNER, auth.uid()
-- would stop being the caller, and every user would silently get the owner's
-- thresholds. The per-user feature would be quietly inert AND the view would be
-- anon-readable.
-- ---------------------------------------------------------------------
alter view public.v_active_alerts set (security_invoker = true);
revoke all on public.v_active_alerts from anon;
grant select on public.v_active_alerts to authenticated;

comment on view public.v_active_alerts is
  'Every STATE alert plus the three derived BLUE event branches, all computed live (0154 + 0155 + 0156 + 0158). Thresholds resolve PER VIEWER: notification_thresholds_user override, then the shared notification_thresholds singleton, then a hardcoded constant — resolved per column, so a user can override one threshold and inherit the rest. Never store these alerts: a stored state alert survives the restock/renewal/payment/top-up that resolved it. Each row carries a stable alert_identity built from ids and reason only.';

commit;

-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) THE SECURITY FOOTER SURVIVED THE REPLACE. Run this FIRST — if
--    security_invoker is missing, the per-user thresholds silently do nothing
--    AND the view is anon-readable.
--      select c.reloptions::text[] @> array['security_invoker=true'] as sec_inv,
--             has_table_privilege('anon', c.oid, 'select')           as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relname='v_active_alerts';
--      -- expect true / false
--
-- B) THE NEW TABLE: EXISTS, RLS ON, ANON LOCKED, ALL FOUR COLUMNS NULLABLE.
--      select c.relrowsecurity as rls,
--             has_table_privilege('anon', c.oid, 'select') as anon_select,
--             has_table_privilege('anon', c.oid, 'insert') as anon_insert
--        from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where n.nspname='public' and c.relname='notification_thresholds_user';
--      -- expect true / false / false
--
--      select attname, format_type(atttypid,atttypmod) as type, attnotnull
--        from pg_attribute
--       where attrelid='public.notification_thresholds_user'::regclass
--         and attnum>0 and not attisdropped order by attnum;
--      -- expect the four threshold columns with attnotnull = FALSE;
--      -- user_id and updated_at are the only NOT NULL columns.
--
--      select count(*) from pg_policies
--       where schemaname='public' and tablename='notification_thresholds_user';
--      -- expect 1 (FOR ALL, to authenticated, user_id = auth.uid())
--
--      select count(*) from pg_trigger
--       where tgrelid='public.notification_thresholds_user'::regclass and not tgisinternal;
--      -- expect 1 (the shared set_updated_at)
--
-- C) THE SANITY CHECK ACCEPTS NULL AND REJECTS OUT-OF-RANGE. All rolled back.
--      -- all-NULL row is VALID (it means "inherit everything")
--      begin;
--        insert into public.notification_thresholds_user (user_id) values (gen_random_uuid());
--      rollback;   -- expect 23503 (FK to auth.users), NOT 23514 — the CHECK passed
--
--      -- out of range -> 23514 notification_thresholds_user_sane
--      begin;
--        insert into public.notification_thresholds_user (user_id, doc_expiry_lead_days)
--        values (gen_random_uuid(), 400);
--      rollback;
--
--      begin;
--        insert into public.notification_thresholds_user (user_id, low_runway_trips)
--        values (gen_random_uuid(), -1);
--      rollback;
--
--    NOTE: an all-NULL insert fails on the FOREIGN KEY, not the check — that is
--    the point of the probe. A random uuid is not a real auth user; use a real
--    auth.users id to test the check clause positively.
--
-- D) THE VIEW STILL WORKS AND STILL HAS NO DUPLICATE IDENTITIES.
--      select count(*) as rows, count(distinct alert_identity) as identities
--        from public.v_active_alerts;
--      -- MUST BE EQUAL. In the SQL editor auth.uid() is NULL, so every
--      -- threshold falls through to the shared singleton (10 / 30 / 7 / 30) and
--      -- the result must be UNCHANGED from before this migration: 9 / 9.
--
--      select severity, category, count(*) from public.v_active_alerts
--       group by 1,2 order by 1,2;
--      -- expect the same distribution as before 0158: red/compliance 1,
--      -- red/finance 1, red/inventory 1, red/maintenance 1, yellow/compliance 1,
--      -- yellow/finance 3, yellow/inventory 1.
--
-- E) THE th CTE ACTUALLY RESOLVES IN THREE LAYERS. Exercise it directly rather
--    than trusting the coalesce by reading it.
--      -- with no user row, the singleton wins:
--      select
--        coalesce(u.low_runway_trips,        (select low_runway_trips        from public.notification_thresholds limit 1), 10)::numeric as low_runway_trips,
--        coalesce(u.doc_expiry_lead_days,    (select doc_expiry_lead_days    from public.notification_thresholds limit 1), 30)::int     as lead_days,
--        coalesce(u.maintenance_stuck_days,  (select maintenance_stuck_days  from public.notification_thresholds limit 1),  7)::int     as stuck_days,
--        coalesce(u.invoice_overdue_red_days,(select invoice_overdue_red_days from public.notification_thresholds limit 1), 30)::int    as red_days
--        from (select auth.uid() as uid) me
--        left join public.notification_thresholds_user u on u.user_id = me.uid;
--      -- expect exactly ONE row: 10.00 / 30 / 7 / 30
--
--      -- and it still returns one row when the singleton is empty:
--      begin;
--        delete from public.notification_thresholds;
--        select count(*) as must_be_one from (
--          select 1 from (select auth.uid() as uid) me
--          left join public.notification_thresholds_user u on u.user_id = me.uid
--        ) z;
--        -- expect 1, and v_active_alerts must still return rows (hardcoded floor)
--        select count(*) from public.v_active_alerts;
--      rollback;
--
-- F) PER-USER OVERRIDE CHANGES THE RESULT — the point of the whole migration.
--    Run signed in as a real user from the app, or substitute a real auth.users
--    id here. Three of the four thresholds visibly move today's alerts:
--      begin;
--        insert into public.notification_thresholds_user (user_id, maintenance_stuck_days)
--        values ('<a real auth.users id>', 30)
--        on conflict (user_id) do update set maintenance_stuck_days = 30;
--        -- as THAT user, the wo_stuck alert (22 days open) must disappear:
--        select count(*) from public.v_active_alerts where alert_identity like 'wo_stuck:%';
--        -- expect 0 for that viewer, 1 for the other
--      rollback;
--
--    Measured sensitivity at draft time, for reference:
--      doc_expiry_lead_days     30 -> 1 alert,  5 -> 0
--      maintenance_stuck_days    7 -> 1 alert, 30 -> 0
--      invoice_overdue_red_days 30 -> 1 red,   60 -> 0 red (becomes yellow)
--      low_runway_trips         10 -> 1 alert, 30 -> 1  (see the header note)
--
-- G) NOTHING ELSE MOVED.
--      select count(*) as views,
--             count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid,'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where c.relkind='v' and n.nspname='public';
--      -- expect 50 / 50 / 0 — UNCHANGED. This replaces a view, it adds none.
--
--      select count(*) as tables from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where c.relkind='r' and n.nspname='public';
--      -- expect 83 (was 82)
--
--      select count(*) as singleton_rows,
--             low_runway_trips, doc_expiry_lead_days, maintenance_stuck_days, invoice_overdue_red_days
--        from public.notification_thresholds group by 2,3,4,5;
--      -- expect 1 row, 10.00 / 30 / 7 / 30 — the singleton is UNTOUCHED.
--
--      select (select count(*) from public.notification_dismissals) as dismissals,
--             (select count(*) from public.notification_prefs) as prefs;
--      -- expect 2 / 0, unchanged.
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
--   begin;
--   -- 1. put the view back to its 0156 definition: re-run 0156's
--   --    `create or replace view public.v_active_alerts as ...` block verbatim,
--   --    followed by the same three security-footer lines.
--   -- 2. then drop the table:
--   drop table if exists public.notification_thresholds_user;  -- takes its trigger
--   commit;
--
-- ORDER MATTERS: drop the table first and the view breaks, because its th CTE
-- still references it. Restore the view, then drop the table.
--
-- Do NOT drop public.set_updated_at() — 0157's issue_reports uses it too.
-- ===========================================================================
