-- 0103_dashboard_views.sql
-- =====================================================================
-- DASHBOARD REBUILD (polish batch 2) — three read-only views.
--
-- DRAFTED FOR THE ARCHITECT TO APPLY. Not self-applied (CLAUDE.md §5).
-- No app code reads any of this until it is confirmed applied.
--
-- NO NEW TABLES. NO TRIGGERS. NO WRITES. Three views over existing data.
-- The money core (lib/prepaid.ts, lib/vat.ts, the FIFO ledgers and every
-- RPC) is untouched — nothing here is referenced by any write path.
--
-- WHY THESE EXIST AT ALL
-- The Dashboard is the catch-up page: what needs action, what happened,
-- what is true right now. The existing 24 views (0098-0101) are almost
-- entirely MONTHLY grain — only `receivables_outstanding` is "current
-- state". A monthly view cannot answer "what is waiting for me now", so
-- the state and queue questions needed their own definitions rather than
-- the page inventing them in TypeScript.
--
-- EVERY VIEW IS security_invoker = true. These read 20+ RLS-enabled base
-- tables; a default view runs as OWNER and would bypass RLS on all of
-- them. Same gate 0098 established for the semantic layer, restated here
-- because it is a security control, not a style choice.
--
-- ------------------------------------------------------------------
-- DATE HANDLING: every "today" in this file is Asia/Riyadh, never the
-- server's date. `current_date` resolves in the DATABASE timezone (UTC
-- here), which in Riyadh (UTC+3) is the PREVIOUS day between 00:00 and
-- 03:00 local. The app already avoids this with todayKey() (CLAUDE.md
-- §6); these views must agree with it or the Dashboard would disagree
-- with every module page for three hours a night.
-- ------------------------------------------------------------------
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. v_dashboard_action_items — "what needs someone's action"
--
-- One row per KIND, always present even at zero, so the page renders a
-- stable queue and can say "all clear" for a kind rather than silently
-- dropping it. `oldest_at` powers "waiting since"; NULL when the kind
-- has no rows or its source carries no usable timestamp.
--
-- Every count below was checked against live data before being written;
-- none of these kinds is hypothetical.
--
-- DELIBERATELY EXCLUDED, so the omissions are on the record:
--   · driver/truck status changes — drivers.status is current-only, there
--     is nothing to count (same gap already parked under Reports).
--   · "unapproved" anything that has no approval workflow in this schema.
-- ---------------------------------------------------------------------
create or replace view public.v_dashboard_action_items as
with riyadh as (select (now() at time zone 'Asia/Riyadh')::date as today)
select * from (
  -- Purchase orders waiting for a second approval vote.
  select 'po_pending_approval'::text        as kind,
         'high'::text                        as severity,
         count(*)::int                       as item_count,
         min(po.created_at)                  as oldest_at
  from public.purchase_orders po
  where po.status = 'pending_approval'

  union all
  -- Stock receipts waiting on the receipt-level vote.
  select 'receipt_pending_approval', 'high',
         count(*)::int, min(sr.created_at)
  from public.stock_receipts sr
  where sr.status = 'pending_approval'

  union all
  -- Consumption approvals with no decision yet (overlay, never a gate —
  -- see 0094; counting them changes nothing about stock).
  select 'consumption_pending_approval', 'medium',
         count(*)::int, min(ca.created_at)
  from public.consumption_approvals ca
  where ca.decided_at is null

  union all
  -- Invoices with money actually outstanding.
  --
  -- CORRECTED AFTER REVIEW — this branch disagreed with Reports. It used
  -- to re-express the predicate as (confirmed_at not null, paid_at null,
  -- status <> 'void') and counted 5, while v_receivables_open — the
  -- definition Reports uses — counted 2. The 3-row gap was
  -- confirmed-unpaid invoices with amount_due_sar = 0: settled out of a
  -- prepaid balance, nothing owed. Two definitions of "unpaid", one
  -- figure, exactly the contradiction the semantic layer exists to stop.
  --
  -- The fix READS v_receivables_open rather than restating its WHERE.
  -- That was a deliberate choice over copying the corrected predicate:
  -- a copy is only ever identical until someone edits one of them, and
  -- the applied definition turned out to carry an INNER JOIN to
  -- customers as well as its four conditions — a copy that mirrored only
  -- the WHERE would have been coincidentally equal today (both give 2,
  -- checked) and wrong the moment an invoice had no readable customer.
  -- Composing means there is exactly one definition of "outstanding".
  --
  -- Safe to compose: v_receivables_open is itself security_invoker=true
  -- (verified), so RLS still resolves at the base tables under the
  -- caller — the gate is inherited, not bypassed.
  select 'invoice_unpaid', 'high',
         count(*)::int, min(r.confirmed_at)
  from public.v_receivables_open r

  union all
  -- Trips whose day has passed but which are still in flight.
  --
  -- ALLOWLIST, not a denylist. This was `stage <> 'delivered'`, which
  -- silently opts every FUTURE stage into the overdue queue — add a
  -- 'cancelled' or 'archived' stage later and cancelled trips start
  -- demanding action. Naming the three in-flight stages means a new
  -- stage has to be considered rather than inherited. Same allowlist
  -- v_fleet_state_now's trips_in_flight uses, so the two agree by
  -- construction. No count change today (49 either way, checked) —
  -- only the four current stages exist.
  select 'trip_overdue', 'high',
         count(*)::int, min(t.created_at)
  from public.trips t, riyadh r
  where t.stage in ('scheduled', 'loading', 'in_transit')
    and t.trip_date < r.today

  union all
  -- Work orders not yet being worked. awaiting_parts is included: it is
  -- blocked ON someone, which is exactly what this queue is for.
  select 'work_order_open', 'medium',
         count(*)::int, min(w.opened_at)
  from public.work_orders w
  where w.status in ('open', 'awaiting_parts')

  union all
  -- Issued POs with stock not yet received.
  select 'po_awaiting_receipt', 'medium',
         count(*)::int, min(po.issued_at)
  from public.purchase_orders po
  where po.status = 'issued'

  union all
  -- Outsourced jobs still running past their own estimated finish.
  select 'outsourced_overdue', 'medium',
         count(*)::int, min(o.created_at)
  from public.outsourced_jobs o, riyadh r
  where o.status = 'in_progress'
    and o.estimated_finish is not null
    and o.estimated_finish < r.today

  union all
  -- Parts that left on a permit and are past their expected return.
  select 'permit_return_overdue', 'medium',
         count(*)::int, min(e.exited_at)
  from public.exit_permits e, riyadh r
  where e.status = 'exited'
    and e.expected_return_on is not null
    and e.expected_return_on < r.today

  union all
  -- Stock at or below its reorder level.
  select 'parts_below_reorder', 'low',
         count(*)::int, null::timestamptz
  from public.parts p
  where p.active
    and p.reorder_level is not null
    and p.qty_on_hand <= p.reorder_level

  union all
  -- Anything with an expiry inside 30 days (or already past). Four
  -- sources in one kind, because to the user it is one errand: renew the
  -- paperwork. Identity expiries live on the SUBJECT, not on the archive
  -- document (0092's rule), which is why drivers/staff/trucks are read
  -- directly rather than through archive_documents.
  select 'expiring_documents', 'medium', count(*)::int, null::timestamptz
  from (
    select ad.expiry_date
      from public.archive_documents ad, riyadh r
     where ad.expiry_date is not null and ad.expiry_date < r.today + 30
    union all
    select d.license_expiry
      from public.drivers d, riyadh r
     where d.terminated_at is null and d.license_expiry is not null
       and d.license_expiry < r.today + 30
    union all
    select d.iqama_expiry
      from public.drivers d, riyadh r
     where d.terminated_at is null and d.iqama_expiry is not null
       and d.iqama_expiry < r.today + 30
    union all
    select s.iqama_expiry
      from public.staff s, riyadh r
     where s.terminated_at is null and s.iqama_expiry is not null
       and s.iqama_expiry < r.today + 30
    union all
    select t.registration_expiry
      from public.trucks t, riyadh r
     where t.terminated_at is null and t.registration_expiry is not null
       and t.registration_expiry < r.today + 30
  ) exp
) k;

comment on view public.v_dashboard_action_items is
  'Dashboard queue: one row per action kind, always present even at zero. '
  'Counts only; the page deep-links to the owning module for detail. '
  'All date comparisons are Asia/Riyadh, matching todayKey().';


-- ---------------------------------------------------------------------
-- 2. v_activity_feed — "what happened since I last looked"
--
-- RECONSTRUCTED FROM EXISTING TIMESTAMPS. No event-log table, no
-- triggers — per the brief, and because the coverage turned out to be
-- complete enough not to need one.
--
-- COVERAGE WAS MEASURED BEFORE THIS WAS WRITTEN, not assumed. The test
-- that matters is not "does the column exist" but "is it ever missing on
-- a row that reached that state". Live result, every one of them zero:
--   invoices status=paid missing paid_at ............ 0
--   invoices status=void missing voided_at .......... 0
--   invoices confirmed-or-later missing confirmed_at  0
--   trips stage=delivered missing delivered_at ...... 0
--   work_orders completed missing closed_at ......... 0
--   outsourced_jobs completed missing closed_at ..... 0
--   exit_permits exited missing exited_at ........... 0
--   exit_permits voided missing voided_at ........... 0
--   purchase_orders issued-or-later missing issued_at 0
-- So no row in this view carries an invented time. A state with no
-- timestamp simply produces no event.
--
-- HONESTLY EXCLUDED — stated rather than faked:
--   · edits and views: never stamped anywhere in this schema.
--   · driver/truck status changes: drivers.status is current-only, so
--     there is no transition to report (the same limitation Reports
--     records for its own deferred status-change report).
--   · trip stage changes other than delivery: loading_at/in_transit_at
--     ARE stamped, but 203 trips x 3 stages would drown every other
--     event. Delivery is the completion; the rest is available if
--     wanted.
--
-- `actor` is whatever the row itself recorded. Many tables store an
-- email in *_by; where a table records no actor the column is NULL and
-- the UI says nothing rather than guessing.
-- ---------------------------------------------------------------------
create or replace view public.v_activity_feed as

-- trips ---------------------------------------------------------------
select t.delivered_at                     as occurred_at,
       'trip_delivered'::text             as kind,
       'trip'::text                       as entity,
       t.id                               as entity_id,
       coalesce(t.ref, 'Trip')::text      as title,
       t.water_station::text              as subtitle,
       null::text                         as actor
from public.trips t
where t.delivered_at is not null

-- invoices ------------------------------------------------------------
union all
select i.confirmed_at, 'invoice_confirmed', 'invoice', i.id,
       coalesce(i.invoice_number, 'Invoice'), c.name, null::text
from public.invoices i
left join public.customers c on c.id = i.customer_id
where i.confirmed_at is not null

union all
select i.paid_at, 'invoice_paid', 'invoice', i.id,
       coalesce(i.invoice_number, 'Invoice'), c.name, null::text
from public.invoices i
left join public.customers c on c.id = i.customer_id
where i.paid_at is not null

union all
select i.voided_at, 'invoice_voided', 'invoice', i.id,
       coalesce(i.invoice_number, 'Invoice'), c.name, i.unpaid_by
from public.invoices i
left join public.customers c on c.id = i.customer_id
where i.voided_at is not null

-- maintenance ---------------------------------------------------------
union all
select w.opened_at, 'work_order_opened', 'work_order', w.id,
       coalesce(w.wo_number, 'Work order'), tk.plate, w.created_by
from public.work_orders w
left join public.trucks tk on tk.id = w.truck_id
where w.opened_at is not null

union all
select w.closed_at, 'work_order_completed', 'work_order', w.id,
       coalesce(w.wo_number, 'Work order'), tk.plate, w.completed_by
from public.work_orders w
left join public.trucks tk on tk.id = w.truck_id
where w.closed_at is not null

union all
select o.created_at, 'outsourced_opened', 'outsourced_job', o.id,
       coalesce(o.os_number, 'Outsourced job'), tk.plate, o.created_by
from public.outsourced_jobs o
left join public.trucks tk on tk.id = o.truck_id
where o.created_at is not null

union all
select o.closed_at, 'outsourced_completed', 'outsourced_job', o.id,
       coalesce(o.os_number, 'Outsourced job'), tk.plate, o.completed_by
from public.outsourced_jobs o
left join public.trucks tk on tk.id = o.truck_id
where o.closed_at is not null

-- consumption ---------------------------------------------------------
union all
select e.exited_at, 'permit_exited', 'exit_permit', e.id,
       coalesce(e.ep_number, 'Exit permit'), e.receiver_name, e.exited_by
from public.exit_permits e
where e.exited_at is not null

union all
select e.voided_at, 'permit_voided', 'exit_permit', e.id,
       coalesce(e.ep_number, 'Exit permit'), e.void_reason, e.voided_by
from public.exit_permits e
where e.voided_at is not null

union all
select ca.decided_at, 'consumption_decided', 'consumption_approval', ca.id,
       ca.decision, null::text, ca.decided_by
from public.consumption_approvals ca
where ca.decided_at is not null

-- procurement ---------------------------------------------------------
union all
select po.issued_at, 'po_issued', 'purchase_order', po.id,
       coalesce(po.po_number, 'Purchase order'), su.name, po.requested_by
from public.purchase_orders po
left join public.suppliers su on su.id = po.supplier_id
where po.issued_at is not null

union all
select po.rejected_at, 'po_rejected', 'purchase_order', po.id,
       coalesce(po.po_number, 'Purchase order'), po.rejection_reason, po.rejected_by
from public.purchase_orders po
where po.rejected_at is not null

union all
select pa.approved_at, 'po_approved', 'purchase_order', pa.purchase_order_id,
       coalesce(po.po_number, 'Purchase order'), null::text, pa.approver_email
from public.purchase_order_approvals pa
left join public.purchase_orders po on po.id = pa.purchase_order_id
where pa.approved_at is not null

union all
select sr.created_at, 'stock_received', 'stock_receipt', sr.id,
       coalesce(su.name, 'Stock receipt'), wh.name, sr.received_by
from public.stock_receipts sr
left join public.suppliers su on su.id = sr.supplier_id
left join public.warehouses wh on wh.id = sr.warehouse_id
where sr.created_at is not null

-- money ---------------------------------------------------------------
union all
select tu.created_at, 'topup_added', 'customer', tu.customer_id,
       c.name, tu.reference, null::text
from public.customer_topups tu
left join public.customers c on c.id = tu.customer_id
where tu.created_at is not null

union all
select cp.paid_at, 'commission_paid', 'driver', cp.driver_id,
       d.name, cp.period_label, cp.approved_by
from public.commission_payouts cp
left join public.drivers d on d.id = cp.driver_id
where cp.paid_at is not null

union all
select x.created_at, 'expense_recorded', 'expense', x.id,
       x.category, x.note, x.entered_by
from public.expenses x
where x.created_at is not null

-- archive -------------------------------------------------------------
union all
select ad.created_at, 'document_filed', 'archive_document', ad.id,
       ad.title, ad.issuing_entity, ad.created_by
from public.archive_documents ad
where ad.created_at is not null;

comment on view public.v_activity_feed is
  'Dashboard activity feed, reconstructed from existing lifecycle '
  'timestamps across modules. No event-log table and no triggers. A '
  'state with no stored timestamp produces no event rather than an '
  'invented one. Callers apply their own ORDER BY / LIMIT.';


-- ---------------------------------------------------------------------
-- 3. v_fleet_state_now — "what is true right now"
--
-- MIRRORS lib/truck-status.ts AND lib/driver-state.ts EXACTLY. Both are
-- documented architecture locks (CLAUDE.md §6) whose precedence rules
-- were read from the source before this was written, not recalled:
--
--   TRUCK (3 states, first match wins)
--     hasActiveJob                -> maintenance
--     hasDriver                   -> active
--     otherwise                   -> idle
--     hasActiveJob = any work_orders OR outsourced_jobs row for this
--                    truck with status = 'in_progress' (BOTH tracks)
--     hasDriver    = trucks.assigned_driver_id is not null
--
--   DRIVER (4 states, first match wins)
--     onLeave                     -> on_leave
--     not hasTruck                -> off_duty
--     hasTruck, no active project -> idle
--     otherwise                   -> active
--     onLeave          = a leave_periods row where
--                        start_date <= today <= end_date (inclusive both
--                        ends, matching periodCoversToday)
--     hasActiveProject = project_drivers joined to a NON-archived project
--
-- Terminated trucks and drivers are excluded entirely — termination is a
-- pre-filter, never a state (CLAUDE.md §6).
--
-- KNOWN DUPLICATION, ACCEPTED WITH A GUARD: this is a second expression
-- of a rule that already exists in TypeScript. That is a real drift risk
-- and it is why the app-side work ships with a test asserting the view
-- and the TS helper return the same buckets for the same live data. The
-- alternative — the Dashboard re-deriving state in TS — was rejected
-- because it breaks the "every number reads the semantic layer" rule.
-- ---------------------------------------------------------------------
create or replace view public.v_fleet_state_now as
with riyadh as (select (now() at time zone 'Asia/Riyadh')::date as today),
busy_trucks as (
  select truck_id from public.work_orders     where status = 'in_progress' and truck_id is not null
  union
  select truck_id from public.outsourced_jobs where status = 'in_progress' and truck_id is not null
),
truck_state as (
  select case
           when t.id in (select truck_id from busy_trucks) then 'maintenance'
           when t.assigned_driver_id is not null           then 'active'
           else 'idle'
         end as state
  from public.trucks t
  where t.terminated_at is null
),
on_leave_drivers as (
  select lp.driver_id
  from public.leave_periods lp, riyadh r
  where lp.driver_id is not null
    and lp.start_date <= r.today
    and r.today <= lp.end_date
),
project_drivers_active as (
  select distinct pd.driver_id
  from public.project_drivers pd
  join public.projects p on p.id = pd.project_id
  where p.archived_at is null
),
driver_state as (
  select case
           when d.id in (select driver_id from on_leave_drivers)        then 'on_leave'
           when not exists (
             select 1 from public.trucks tk
             where tk.assigned_driver_id = d.id and tk.terminated_at is null
           )                                                            then 'off_duty'
           when d.id not in (select driver_id from project_drivers_active) then 'idle'
           else 'active'
         end as state
  from public.drivers d
  where d.terminated_at is null
)
select
  (select count(*) from truck_state)                                   as trucks_total,
  (select count(*) from truck_state where state = 'active')::int       as trucks_active,
  (select count(*) from truck_state where state = 'idle')::int         as trucks_idle,
  (select count(*) from truck_state where state = 'maintenance')::int  as trucks_maintenance,
  (select count(*) from driver_state)                                  as drivers_total,
  (select count(*) from driver_state where state = 'active')::int      as drivers_active,
  (select count(*) from driver_state where state = 'idle')::int        as drivers_idle,
  (select count(*) from driver_state where state = 'off_duty')::int    as drivers_off_duty,
  (select count(*) from driver_state where state = 'on_leave')::int    as drivers_on_leave,
  -- No date predicate here on purpose: "in flight" is a stage, not a day.
  (select count(*) from public.trips t
    where t.stage in ('scheduled','loading','in_transit'))::int        as trips_in_flight,
  (select count(*) from public.trips t, riyadh r
    where t.trip_date = r.today)::int                                  as trips_today,
  (select count(*) from public.work_orders
    where status = 'in_progress')::int                                 as work_orders_running,
  (select count(*) from public.outsourced_jobs
    where status = 'in_progress')::int                                 as outsourced_running;

comment on view public.v_fleet_state_now is
  'Dashboard current-state counts. Truck and driver states mirror '
  'lib/truck-status.ts and lib/driver-state.ts exactly, including '
  'precedence order and the terminated-is-a-pre-filter rule. Dates are '
  'Asia/Riyadh. A test asserts this view and the TS helpers agree.';


-- ---------------------------------------------------------------------
-- Security: same treatment as all 24 existing views (0098).
-- ---------------------------------------------------------------------
alter view public.v_dashboard_action_items set (security_invoker = true);
alter view public.v_activity_feed          set (security_invoker = true);
alter view public.v_fleet_state_now        set (security_invoker = true);

revoke all on public.v_dashboard_action_items from anon;
revoke all on public.v_activity_feed          from anon;
revoke all on public.v_fleet_state_now        from anon;

grant select on public.v_dashboard_action_items to authenticated;
grant select on public.v_activity_feed          to authenticated;
grant select on public.v_fleet_state_now        to authenticated;


-- ---------------------------------------------------------------------
-- POST-APPLY VERIFICATION (run these; do not assume)
--
--   -- all three exist, all three are INVOKER:
--   select c.relname, c.reloptions
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname='public' and c.relkind='v'
--     and c.relname in ('v_dashboard_action_items','v_activity_feed',
--                       'v_fleet_state_now');
--   -- expect security_invoker=true in reloptions on each.
--
--   -- anon must not read them:
--   select has_table_privilege('anon','public.v_activity_feed','select');
--   -- expect false (x3).
--
--   -- the queue matches the counts measured before this was drafted:
--   select * from public.v_dashboard_action_items order by kind;
--   -- expect po_pending_approval=7, receipt_pending_approval=5,
--   --        trip_overdue=49, invoice_unpaid=2, work_order_open=3,
--   --        po_awaiting_receipt=2, outsourced_overdue=2,
--   --        permit_return_overdue=2, parts_below_reorder=1,
--   --        expiring_documents=2, consumption_pending_approval=0
--
--   -- THE CORRECTION THIS RE-APPLY EXISTS FOR. invoice_unpaid must equal
--   -- v_receivables_open exactly, not approximately. It read 5 before and
--   -- must read 2 now:
--   select
--     (select item_count from public.v_dashboard_action_items
--       where kind = 'invoice_unpaid')        as dashboard_says,
--     (select count(*) from public.v_receivables_open) as reports_says;
--   -- expect 2 and 2. If these ever diverge, the Dashboard is lying.
--
--   -- feed returns real rows, newest first, no NULL timestamps:
--   select count(*) from public.v_activity_feed;
--   select count(*) from public.v_activity_feed where occurred_at is null;  -- expect 0
--   select occurred_at, kind, title from public.v_activity_feed
--    order by occurred_at desc limit 10;
--
--   -- current state agrees with the app's own derived helpers:
--   select * from public.v_fleet_state_now;
--   -- expect trucks_total=13, trips_in_flight=49
-- ---------------------------------------------------------------------
