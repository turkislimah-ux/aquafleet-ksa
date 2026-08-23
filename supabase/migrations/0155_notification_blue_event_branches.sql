-- 0155_notification_blue_event_branches.sql
-- Notifications phase 1.2 — append the three BLUE branches to v_active_alerts.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect applies via MCP.
--
-- ===========================================================================
-- THE DECISION THAT CHANGED, AND WHY IT IS BETTER
-- ===========================================================================
-- The three blue notifications were originally going to be STORED events,
-- written by server actions into notification_events. They are DERIVED instead,
-- because the source tables already carry the timestamps:
--
--     truck entered maintenance   work_orders.opened_at
--     truck back in service       work_orders.closed_at
--     employee returned today     leave_periods.end_date
--
-- Deriving them is strictly better here. A stored event needs a writer on every
-- path that can cause the fact, and a fact with two write paths eventually has
-- one that forgets. Nothing to forget if the fact IS the column. It also means
-- no change to the maintenance or leave server actions, so this phase ships
-- with zero app code.
--
-- notification_events STAYS IN PLACE AND STAYS EMPTY. It is not dropped: the
-- moment a blue fact appears that has no column to derive from, that table is
-- where it goes. Dormant, not dead.
--
-- ===========================================================================
-- WHAT THIS FILE DOES, AND THE ONE CONSTRAINT ON DOING IT
-- ===========================================================================
-- ONE THING: create or replace v_active_alerts with three extra UNION ALL
-- branches appended. Every existing branch is BYTE-FOR-BYTE what 0154 applied —
-- the body below was extracted from that migration programmatically rather than
-- retyped, so the sixteen existing branches cannot drift by a stray character.
--
-- `create or replace view` CANNOT change the column list — it cannot insert,
-- reorder, rename or retype a column (42P16). Appending UNION branches does not
-- touch the column list, so this is legal. The nine output columns are
-- unchanged: alert_identity, severity, category, entity_type, entity_id,
-- entity_label, value_num, value_date, payload.
--
-- IT ALSO DROPS reloptions, WHICH IS THE TRAP. `create or replace view` silently
-- discards security_invoker, so the security footer is restated below and must
-- stay restated on every future replacement — CLAUDE.md section 6.
--
-- Touches nothing else: not notification_events, not any money view, not the
-- dashboard action queue, nothing outside v_active_alerts.
--
-- ===========================================================================
-- THE THREE NEW BRANCHES
-- ===========================================================================
-- All severity 'blue', category 'event', value_num null, Riyadh calendar day
-- via the existing riyadh CTE. Identities are built from row ids only — never
-- the date, never a computed value — so they are stable across the day and a
-- dismissal sticks to the item:
--
--     truck_in:work_order:<wo_id>            opened today
--     truck_out:work_order:<wo_id>           closed today
--     employee_returned:<kind>:<person>:<leave_id>   leave ended today
--
-- Distinct prefixes, so no new identity can collide with an existing one. That
-- is asserted in verification block C rather than trusted.
--
-- BLUE IS A ONE-DAY ALERT BY CONSTRUCTION. Each branch matches only today's
-- Riyadh date, so these rows appear and disappear on their own — no dismissal
-- needed for them to go away, and the 7-day yellow/blue dismissal window in
-- v_my_notifications will normally outlive the alert itself. That is intended:
-- dismissing one is "I have seen this", not "hide this for a week".
--
-- ===========================================================================
-- KNOWN OVERLAP, FLAGGED NOT FIXED — read before applying
-- ===========================================================================
-- The existing YELLOW branch `leave_return` matches
--     l.end_date >= today AND l.end_date <= today + 3
-- which INCLUDES today. The new BLUE `employee_returned` matches
--     l.end_date = today
-- So on the day someone actually returns, ONE leave period produces TWO
-- notifications: a yellow "returning in 0 days" and a blue "returned today".
--
-- The identities differ, so nothing collides and no dismissal is shared — this
-- is a duplication of MEANING, not of identity.
--
-- NOT FIXED HERE ON PURPOSE. The clean fix is narrowing the yellow branch to
-- `l.end_date > r.today`, which edits an existing branch, and this migration's
-- whole safety property is that existing branches are untouched. Worth a ruling
-- as its own change.
--
-- ===========================================================================
-- MEASURED AT DRAFT TIME (2026-08-23) — the three branches dry-run inline
-- ===========================================================================
--   blue truck_in ............ see verification block B, re-measure on apply
--   blue truck_out ........... see verification block B
--   blue employee_returned ... see verification block B
--
-- These count only TODAY's activity, so 0 is a normal and correct result on a
-- quiet day. Zero does not mean the branch is broken; block B distinguishes
-- "no rows today" from "never matches" by also counting the all-time
-- population each branch draws from.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- v_active_alerts — sixteen existing branches, byte-for-byte from 0154,
-- plus three appended BLUE branches.
-- ---------------------------------------------------------------------
create or replace view public.v_active_alerts as
with th as (
  select coalesce(max(low_runway_trips),        10)::numeric as low_runway_trips,
         coalesce(max(doc_expiry_lead_days),    30)::int     as lead_days,
         coalesce(max(maintenance_stuck_days),   7)::int     as stuck_days,
         coalesce(max(invoice_overdue_red_days),30)::int     as red_days
    from public.notification_thresholds
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
   and l.end_date >= r.today
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
-- security_invoker the moment it was replaced. Without these three lines the
-- view would run as its owner and be readable by anon — CLAUDE.md section 6.
-- Every future replacement of this view must restate them too.
-- ---------------------------------------------------------------------
alter view public.v_active_alerts set (security_invoker = true);
revoke all on public.v_active_alerts from anon;
grant select on public.v_active_alerts to authenticated;

comment on view public.v_active_alerts is
  'Every STATE alert plus the three derived BLUE event branches, all computed live (0154 + 0155). Never store these: a stored state alert survives the restock/renewal/payment/top-up that resolved it. Each row carries a stable alert_identity built from ids and reason only — never the value, never the date — so a per-user dismissal sticks to the item rather than to a moment. Prepaid alerts are keyed per CUSTOMER WALLET, not per project. The blue branches are derived from work_orders.opened_at / .closed_at and leave_periods.end_date, so they need no server action and no stored row; notification_events remains in place but dormant.';

commit;

-- ===========================================================================
-- POSTGREST SCHEMA CACHE
-- ===========================================================================
-- The view's column list is unchanged, so PostgREST needs nothing. If a select
-- misbehaves anyway:  notify pgrst, 'reload schema';
--
-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) THE SECURITY FOOTER SURVIVED THE REPLACE. This is the one that bites.
--      select c.relname,
--             c.reloptions::text[] @> array['security_invoker=true'] as sec_inv,
--             has_table_privilege('anon', c.oid, 'select')           as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where n.nspname='public' and c.relname='v_active_alerts';
--      -- expect true / false
--
--      -- And the site-wide three-count check, which must be UNCHANGED at
--      -- 50 / 50 / 0 — this migration adds no view, it replaces one.
--      select count(*) as views,
--             count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind = 'v' and n.nspname = 'public';
--      -- expect 50 / 50 / 0
--
-- B) THE THREE BLUE BRANCHES ARE REACHABLE. Each counts only TODAY, so 0 is a
--    normal result on a quiet day. The second column of each pair is the
--    all-time population the branch draws from — that is what distinguishes
--    "nothing happened today" from "this branch can never match".
--      select
--        (select count(*) from public.v_active_alerts where alert_identity like 'truck_in:%')          as truck_in_today,
--        (select count(*) from public.work_orders where opened_at is not null)                          as wo_with_opened_at,
--        (select count(*) from public.v_active_alerts where alert_identity like 'truck_out:%')         as truck_out_today,
--        (select count(*) from public.work_orders where closed_at is not null)                          as wo_with_closed_at,
--        (select count(*) from public.v_active_alerts where alert_identity like 'employee_returned:%') as returned_today,
--        (select count(*) from public.leave_periods where end_date is not null)                         as leave_with_end_date;
--
-- C) NO IDENTITY COLLIDES. The prefixes are distinct by construction; assert it
--    rather than trusting it, because one dismissal silencing two facts is the
--    failure this whole design is built to prevent.
--      select count(*) as rows, count(distinct alert_identity) as identities
--        from public.v_active_alerts;
--      -- MUST BE EQUAL.
--
--      select alert_identity, count(*)
--        from public.v_active_alerts group by 1 having count(*) > 1;
--      -- expect 0 rows.
--
-- D) THE EXISTING BRANCHES DID NOT MOVE. Non-blue rows must be exactly what
--    they were before this migration — capture BEFORE applying, compare after.
--      select severity, category, count(*)
--        from public.v_active_alerts where severity <> 'blue'
--       group by 1,2 order by 1,2;
--      -- before 0155: red/compliance 1, red/finance 1, red/inventory 1,
--      --              red/maintenance 1, yellow/compliance 1, yellow/finance 3,
--      --              yellow/inventory 1  (9 non-blue rows)
--
-- E) THE COLUMN LIST IS UNCHANGED. create or replace would have refused
--    otherwise, but read it back:
--      select attname, format_type(atttypid, atttypmod) as type, attnum
--        from pg_attribute
--       where attrelid = 'public.v_active_alerts'::regclass
--         and attnum > 0 and not attisdropped
--       order by attnum;
--      -- expect 9 columns: alert_identity text, severity text, category text,
--      -- entity_type text, entity_id uuid, entity_label text,
--      -- value_num numeric, value_date date, payload jsonb
--
-- F) MONEY IS UNTOUCHED. This file reads no money view it did not already read
--    and writes no money column:
--      select count(*), sum(commission_sar) from public.trips;
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
-- Re-run 0154's `create or replace view public.v_active_alerts as ...` block
-- verbatim, followed by the same three security-footer lines. The blue branches
-- are the only difference between the two definitions, and no data is stored
-- for them, so nothing is lost by reverting — the rows simply stop appearing.
-- ===========================================================================
