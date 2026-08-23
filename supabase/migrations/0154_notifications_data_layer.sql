-- 0154_notifications_data_layer.sql
-- Notifications DATA LAYER, phase 1.1. No UI, no event wiring, no app code.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect applies via MCP.
--
-- Six objects, nothing else:
--   notification_thresholds, notification_prefs, notification_dismissals,
--   notification_events, v_active_alerts, v_my_notifications.
--
-- issue_reports is NOT here — it moves to 0155 in the settings phase.
--
-- ===========================================================================
-- THE ONE RULE THIS FILE EXISTS TO ENFORCE
-- ===========================================================================
-- STATE alerts are DERIVED LIVE and never stored. A stored state alert goes
-- stale the moment the underlying fact changes — restock the part, renew the
-- iqama, pay the invoice, top up the wallet, and a stored row still says
-- otherwise until something remembers to delete it. Nothing remembers.
--
-- So v_active_alerts recomputes every STATE alert on every read. The only
-- STORED rows are point-in-time EVENTS, which are true forever because they
-- describe a moment, not a condition.
--
-- ===========================================================================
-- HOW "NOT ANNOYING" IS ENFORCED, mechanically
-- ===========================================================================
--   1. STABLE IDENTITY. Every alert emits `alert_identity` built from the
--      entity and the reason ONLY — never the computed value, never today's
--      date. `doc_expiry:driver:<uuid>:license` is the same string whether the
--      licence expires in 29 days or 3, so a dismissal sticks to the ITEM
--      rather than to a moment. An identity containing the day count would
--      make every dismissal evaporate at midnight.
--   2. ONE ALERT PER UNDERLYING FACT. Derived alerts cannot accumulate — they
--      are recomputed, not inserted. Stored events carry `dedupe_key` with a
--      UNIQUE index so a retried server action writes nothing the second time.
--      The prepaid alerts are keyed PER CUSTOMER WALLET, not per project, so a
--      customer with two prepaid projects cannot fire the same wallet twice.
--   3. EVERY THRESHOLD IS EDITABLE. Any window that turns out noisy is widened
--      in Settings, never in a migration.
--
-- ===========================================================================
-- STANDING GATES — restated because this file must satisfy them
-- ===========================================================================
--   * Every view: security_invoker = true, revoke all from anon, grant select
--     to authenticated. CLAUDE.md §6's three-count check must read
--     views / security_invoker / anon_readable with the first two equal and the
--     third 0. Baseline before this file: 48 / 48 / 0. Expected after: 50 / 50 / 0.
--   * Per-user tables (notification_prefs, notification_dismissals) RLS'd to
--     auth.uid(). App-wide tables RLS'd to authenticated.
--   * anon revoked explicitly on every object, on top of RLS.
--   * Reads money/invoice/rate views ONLY. Writes no money column anywhere.
--   * alert_identity globally unique across all branches — asserted in
--     verification block E, not assumed.
--
-- ===========================================================================
-- WHAT THIS FILE DELIBERATELY DOES NOT TOUCH
-- ===========================================================================
--   * v_customer_prepaid_balance, v_receivables_open, v_invoice_outstanding_live
--     — read only, never redefined. 0142's two-expression lock on the returns
--     debit stands: this file adds NO third expression of any balance.
--   * Pricing / commission / rates / invoicing logic.
--   * v_dashboard_action_items — the dashboard action queue. See OVERLAP below.
--   * company_settings.
--
-- ===========================================================================
-- OVERLAP WITH v_dashboard_action_items — READ BEFORE ASSUMING A DUPLICATE
-- ===========================================================================
-- That view already covers expiring documents, parts below reorder, open work
-- orders and overdue permits. It is NOT replaced and NOT edited: it returns
-- COUNTS ONLY — (kind, severity, item_count, oldest_at) — with no row per item
-- and therefore no identity to dismiss. v_active_alerts is per-item and
-- dismissible. Both stay.
--
-- THE COST, STATED PLAINLY: "expiring document" now has two definitions in the
-- database. They agree today. Three known differences, each deliberate:
--   (a) the action queue hardcodes 30 days; this view honours the per-group
--       archive_document_groups.warning_days where set (live values are
--       30/45/60/90/120 — the action queue is already ignoring real config),
--       falling back to doc_expiry_lead_days.
--   (b) the action queue reads archive_documents.expiry_date directly; this
--       view prefers the newest non-superseded archive_document_renewals row.
--       0 renewals are active today so the two agree exactly; they diverge only
--       once a document is renewed, which is what that table is for.
--   (c) the action queue treats ('open','awaiting_parts') as open, excluding
--       'in_progress'. A stuck-for-N-days alert must include 'in_progress' —
--       that is the exact state a job stalls in.
-- If one definition is wanted, the fix is to rebuild the action queue as counts
-- OVER this view. That is a protected object and is NOT touched here.
--
-- ===========================================================================
-- MEASURED AT DRAFT TIME (2026-08-23) — every branch dry-run before writing
-- ===========================================================================
--   yellow prepaid_overdrawn .. 2      red    doc_expired ....... 1
--   yellow prepaid_low_runway . 1      red    part_reorder ...... 1
--   yellow doc_expiring ....... 1      red    wo_stuck .......... 1
--   yellow permit_overdue ..... 1      red    invoice_overdue ... 1
--   yellow leave_return ....... 0      yellow invoice_due ....... 0
--   -> 9 active alerts on today's data at default thresholds (4 red, 5 yellow).
--
-- All three prepaid customers hold exactly ONE prepaid project each today, so
-- the per-customer keying changes no count right now. It is structural: the day
-- a customer gets a second prepaid project, per-project keying would fire the
-- same wallet twice.
--
-- These numbers WILL move as data changes. They are a shape check, not a
-- contract. Verification block E re-runs them against the built view.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- OBJECT 1 — THRESHOLDS. App-wide, single row, user-editable.
--
-- Singleton via `id boolean primary key check (id)`, the same trick
-- company_settings uses: one row can exist, and a second insert is a primary
-- key violation rather than a silent duplicate that halves the config.
--
-- SEPARATE FROM company_settings ON PURPOSE. Do not merge them — that table's
-- columns are snapshotted onto invoices, so widening it for UI tuning would put
-- notification settings inside frozen billing documents.
-- ---------------------------------------------------------------------
create table if not exists public.notification_thresholds (
  id                        boolean primary key default true,
  -- Prepaid LOW RUNWAY fires when a customer's wallet holds less than this many
  -- trips' worth of work, priced at the HIGHEST current rate among their active
  -- prepaid projects. 10 trips, not 5: at ~400 SAR/trip that is roughly a
  -- week of work for a busy project, which is enough notice to top up.
  low_runway_trips          numeric(6,2) not null default 10,
  -- Default lead time for "expiring soon". archive_document_groups.warning_days
  -- overrides this per group where set; this is the fallback, and it is the
  -- value used for the driver/staff/truck date fields, which have no group.
  doc_expiry_lead_days      integer      not null default 30,
  -- A work order open (or in progress, or awaiting parts) longer than this is
  -- stuck.
  maintenance_stuck_days    integer      not null default 7,
  -- Postpaid invoice outstanding longer than this escalates yellow -> red.
  invoice_overdue_red_days  integer      not null default 30,
  updated_at                timestamptz  not null default now(),
  updated_by                text,
  constraint notification_thresholds_singleton check (id),
  constraint notification_thresholds_sane check (
    low_runway_trips >= 0
    and doc_expiry_lead_days between 0 and 365
    and maintenance_stuck_days between 0 and 365
    and invoice_overdue_red_days between 0 and 365
  )
);

insert into public.notification_thresholds (id) values (true)
on conflict (id) do nothing;

alter table public.notification_thresholds enable row level security;
drop policy if exists authenticated_all_notification_thresholds on public.notification_thresholds;
create policy authenticated_all_notification_thresholds
  on public.notification_thresholds for all to authenticated
  using (true) with check (true);
revoke all on public.notification_thresholds from anon;

comment on table public.notification_thresholds is
  'Single-row, app-wide notification tuning (0154). Read by v_active_alerts. Editable from Settings so a noisy window is widened in the UI, never in a migration. NOT company_settings: that table is snapshotted onto invoices and must not carry UI config.';

-- ---------------------------------------------------------------------
-- OBJECT 2 — PER-USER PREFERENCES. Keyed to auth.uid(), owner-only.
--
-- NO ROW IS THE NORMAL STATE. A user who never opened Settings has no row and
-- must still see everything, so v_my_notifications LEFT JOINs this and
-- coalesces to the same defaults declared here. The defaults exist in exactly
-- two places and both are in this file — change one, change the other.
--
-- Blue is suppressed by show_blue alone. There is no separate mute flag: two
-- booleans meaning "hide blue" is one too many, and the redundant one is the
-- one that eventually disagrees with the other.
-- ---------------------------------------------------------------------
create table if not exists public.notification_prefs (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  show_red    boolean     not null default true,
  show_yellow boolean     not null default true,
  show_blue   boolean     not null default true,
  updated_at  timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;
drop policy if exists own_notification_prefs on public.notification_prefs;
create policy own_notification_prefs
  on public.notification_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.notification_prefs from anon;

comment on table public.notification_prefs is
  'Per-user notification preferences (0154), RLS to auth.uid(). Absent row = defaults (all three severities shown) — v_my_notifications coalesces to the same values this table defaults to. Blue is suppressed by show_blue alone.';

-- ---------------------------------------------------------------------
-- OBJECT 3 — PER-USER DISMISSALS.
--
-- One row per (user, alert_identity). Dismissing again UPDATES dismissed_at
-- rather than inserting a second row — the composite PK is what makes
-- "dismiss, resurface, dismiss again" bounded instead of unbounded.
--
-- alert_identity is intentionally NOT a foreign key. It names an alert that is
-- computed rather than stored, so there is nothing to reference; and a
-- dismissal must outlive the alert's disappearance (part restocked, then drops
-- below reorder again) so the row is still there when it returns.
-- ---------------------------------------------------------------------
create table if not exists public.notification_dismissals (
  user_id        uuid        not null references auth.users(id) on delete cascade,
  alert_identity text        not null,
  dismissed_at   timestamptz not null default now(),
  primary key (user_id, alert_identity)
);

create index if not exists notification_dismissals_user_idx
  on public.notification_dismissals (user_id, dismissed_at desc);

alter table public.notification_dismissals enable row level security;
drop policy if exists own_notification_dismissals on public.notification_dismissals;
create policy own_notification_dismissals
  on public.notification_dismissals for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.notification_dismissals from anon;

comment on table public.notification_dismissals is
  'Per-user dismiss state (0154), RLS to auth.uid(). Composite PK so re-dismissing updates the timestamp instead of accumulating rows. alert_identity is deliberately not an FK: derived alerts are not stored, and a dismissal must survive the alert vanishing and returning.';

-- ---------------------------------------------------------------------
-- OBJECT 4 — STORED EVENTS. Point-in-time facts only. No DDL change from the
-- previous draft.
--
-- A row here describes a MOMENT ("truck 12 entered maintenance at 14:02"),
-- which stays true forever. Nothing describing a CONDITION belongs in this
-- table — conditions go in v_active_alerts and are recomputed.
--
-- dedupe_key IS THE ANTI-DUPLICATE MECHANISM and is required. The writer builds
-- it from the fact, not the clock — e.g.
-- 'truck_maintenance_in:<truck_id>:<work_order_id>' — so a retried or
-- double-fired server action collides and does nothing the second time. It
-- doubles as the alert_identity (prefixed 'event:'), so a dismissal survives
-- the row being re-inserted.
--
-- PHASE 1.2, NOT NOW: the three events to wire are truck entered maintenance,
-- truck back in service, and employee returned today. ALL THREE ARE BLUE.
-- Nothing writes to this table yet; it ships empty on purpose.
-- ---------------------------------------------------------------------
create table if not exists public.notification_events (
  id          uuid        primary key default gen_random_uuid(),
  event_type  text        not null,
  entity_type text        not null,
  entity_id   uuid,
  occurred_at timestamptz not null default now(),
  severity    text        not null default 'blue',
  -- Label data for rendering (plate, driver name, wo number...). Denormalised
  -- ON PURPOSE: an event is a historical statement and must still render
  -- correctly after the entity is renamed, reassigned or terminated.
  payload     jsonb       not null default '{}'::jsonb,
  dedupe_key  text        not null,
  created_at  timestamptz not null default now(),
  constraint notification_events_severity_check
    check (severity in ('red','yellow','blue')),
  constraint notification_events_entity_type_check
    check (entity_type in ('truck','driver','staff','project','customer','part','invoice','work_order','exit_permit','document'))
);

create unique index if not exists notification_events_dedupe_idx
  on public.notification_events (dedupe_key);
create index if not exists notification_events_occurred_idx
  on public.notification_events (occurred_at desc);

alter table public.notification_events enable row level security;
drop policy if exists authenticated_all_notification_events on public.notification_events;
create policy authenticated_all_notification_events
  on public.notification_events for all to authenticated
  using (true) with check (true);
revoke all on public.notification_events from anon;

comment on table public.notification_events is
  'Stored point-in-time notification events (0154) — moments, never conditions. Conditions are derived in v_active_alerts because a stored condition goes stale on restock/renewal/payment/top-up. UNIQUE(dedupe_key) stops a retried server action writing the same fact twice. Writers ship in phase 1.2 (truck into maintenance, truck back in service, employee returned — all blue); this table starts empty.';

-- ---------------------------------------------------------------------
-- OBJECT 5 — v_active_alerts. Every STATE alert, derived live.
--
-- THRESHOLDS ARE READ THROUGH AGGREGATES, NOT A JOIN.
-- `select coalesce(max(x), default) from notification_thresholds` returns
-- exactly one row even when the table is empty. A CROSS JOIN to an empty
-- singleton returns ZERO rows and would silently switch every alert in the app
-- off. The seed above means it is never empty today — this is the guard for the
-- day someone truncates it.
--
-- Riyadh calendar day throughout, matching v_dashboard_action_items and
-- lib/utils todayKey(). The invoice branch is the one exception: it inherits
-- CURRENT_DATE from v_receivables_open, and that view is NOT edited here. The
-- inconsistency is flagged rather than silently mixed in.
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
                  and coalesce(el.qty_returned, 0) < el.qty);

alter view public.v_active_alerts set (security_invoker = true);
revoke all on public.v_active_alerts from anon;
grant select on public.v_active_alerts to authenticated;

comment on view public.v_active_alerts is
  'Every STATE alert, DERIVED LIVE (0154). Never store these: a stored state alert survives the restock/renewal/payment/top-up that resolved it. Each row carries a stable alert_identity built from entity + reason only — never the value, never the date — so a per-user dismissal sticks to the item rather than to a moment. Prepaid alerts are keyed per CUSTOMER WALLET, not per project. BLUE is absent by design: blue is event-sourced, from notification_events.';

-- ---------------------------------------------------------------------
-- OBJECT 6 — v_my_notifications. The read layer the UI consumes.
--
-- Merges derived alerts + stored events for the CURRENT auth.uid(), applies the
-- dismiss-visibility rule and the user's preferences.
--
-- THE DISMISS RULE, and why the halves differ:
--   RED           hidden only for the REST OF TODAY (Riyadh calendar day). Red
--                 is money or compliance; it returns tomorrow whatever was
--                 clicked.
--   YELLOW/BLUE   hidden for 7 days from the dismissal instant.
-- No dismissal always shows. Alerts RESURFACE rather than disappearing, which
-- is the difference between a reminder and a way to lose things.
--
-- security_invoker means auth.uid() resolves to the CALLER, and the owner-only
-- RLS on notification_dismissals/notification_prefs already restricts those, so
-- this view cannot leak one user's dismiss state to the other.
-- ---------------------------------------------------------------------
create or replace view public.v_my_notifications as
with riyadh as (
  select (now() at time zone 'Asia/Riyadh')::date as today
),
prefs as (
  -- Absent row = defaults. These MUST match notification_prefs' column defaults.
  select coalesce(p.show_red,    true) as show_red,
         coalesce(p.show_yellow, true) as show_yellow,
         coalesce(p.show_blue,   true) as show_blue
    from (select 1) one
    left join public.notification_prefs p on p.user_id = auth.uid()
),
merged as (
  select a.alert_identity, a.severity, a.category, a.entity_type, a.entity_id,
         a.entity_label, a.value_num, a.value_date, a.payload,
         'state'::text as source, null::timestamptz as occurred_at
    from public.v_active_alerts a
  union all
  select 'event:' || e.dedupe_key, e.severity, 'event', e.entity_type, e.entity_id,
         coalesce(e.payload->>'label', e.event_type),
         null::numeric, e.occurred_at::date, e.payload,
         'event', e.occurred_at
    from public.notification_events e
)
select m.alert_identity, m.severity, m.category, m.entity_type, m.entity_id,
       m.entity_label, m.value_num, m.value_date, m.payload, m.source,
       m.occurred_at,
       d.dismissed_at
  from merged m
  cross join prefs pr
  cross join riyadh r
  left join public.notification_dismissals d
         on d.user_id = auth.uid() and d.alert_identity = m.alert_identity
 where
   -- Severity preferences.
   case m.severity
     when 'red'    then pr.show_red
     when 'yellow' then pr.show_yellow
     when 'blue'   then pr.show_blue
     else true
   end
   -- Dismiss-visibility rule.
   and (
     d.alert_identity is null
     or (m.severity = 'red'
         and (d.dismissed_at at time zone 'Asia/Riyadh')::date <> r.today)
     or (m.severity in ('yellow','blue')
         and d.dismissed_at < now() - interval '7 days')
   );

alter view public.v_my_notifications set (security_invoker = true);
revoke all on public.v_my_notifications from anon;
grant select on public.v_my_notifications to authenticated;

comment on view public.v_my_notifications is
  'The notification read layer for the current auth.uid() (0154): derived state alerts + stored events, minus this user''s active dismissals, filtered by their severity preferences. Dismiss rule — RED hides for the rest of the Riyadh day, YELLOW/BLUE for 7 days, then both resurface. security_invoker, so auth.uid() is the caller and the owner-only RLS on prefs/dismissals applies.';

commit;

-- ===========================================================================
-- POSTGREST SCHEMA CACHE
-- ===========================================================================
-- New tables and views. PostgREST reloads on the DDL event; if a select 404s
-- with PGRST205 ("Could not find the table ... in the schema cache"), nudge it:
--     notify pgrst, 'reload schema';
--
-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) EVERY NEW OBJECT EXISTS WITH THE RIGHT POSTURE. Expect 4 tables with
--    rowsecurity = true, and 2 views with sec_inv = true.
--      select c.relname, c.relkind, c.relrowsecurity,
--             c.reloptions::text[] @> array['security_invoker=true'] as sec_inv
--        from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where n.nspname='public'
--         and c.relname in ('notification_thresholds','notification_prefs',
--                           'notification_dismissals','notification_events',
--                           'v_active_alerts','v_my_notifications')
--       order by c.relkind, c.relname;
--
-- B) ANON IS LOCKED OUT OF ALL SIX. Expect false / false on every row.
--      select c.relname,
--             has_table_privilege('anon', c.oid, 'select') as anon_select,
--             has_table_privilege('anon', c.oid, 'insert') as anon_insert
--        from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where n.nspname='public'
--         and c.relname in ('notification_thresholds','notification_prefs',
--                           'notification_dismissals','notification_events',
--                           'v_active_alerts','v_my_notifications')
--       order by 1;
--
-- C) CLAUDE.md §6 THREE-COUNT CHECK. The two new views must move the first two
--    counts TOGETHER and leave the third at 0.
--      select count(*) as views,
--             count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind = 'v' and n.nspname = 'public';
--      -- before this migration: 48 / 48 / 0
--      -- expect after:          50 / 50 / 0
--
-- D) THE SINGLETON IS SEEDED AND CANNOT DOUBLE.
--      select * from public.notification_thresholds;   -- expect exactly 1 row
--      begin;
--        insert into public.notification_thresholds (id) values (true);
--      rollback;                                        -- expect 23505
--
-- E) BRANCH REACHABILITY AND IDENTITY UNIQUENESS.
--      select severity, category, count(*)
--        from public.v_active_alerts group by 1,2 order by 1,2;
--      -- at draft time: red/compliance 1, red/finance 1, red/inventory 1,
--      --                red/maintenance 1, yellow/compliance 1,
--      --                yellow/finance 3, yellow/inventory 1   (9 total)
--
--      select count(*) as rows, count(distinct alert_identity) as identities
--        from public.v_active_alerts;
--      -- MUST BE EQUAL. A duplicate identity means two branches claim the same
--      -- fact and one dismissal would silence both.
--
--      -- No prepaid wallet may fire BOTH prepaid alerts. Expect 0 rows:
--      select entity_id, count(*)
--        from public.v_active_alerts
--       where alert_identity like 'prepaid_%'
--       group by 1 having count(*) > 1;
--
-- F) IDENTITIES ARE STABLE, NOT TIME-VARYING. Run twice a few seconds apart and
--    diff — the digest must be identical.
--      select md5(string_agg(alert_identity, ',' order by alert_identity))
--        from public.v_active_alerts;
--
-- G) THE READ LAYER. auth.uid() is NULL in the SQL editor, so
--    v_my_notifications returns the unfiltered set there — expected, not a
--    leak: the per-user tables' RLS still applies, there is simply no user to
--    match. Verify dismiss behaviour from the browser once the UI exists.
--
-- H) MONEY IS UNTOUCHED. This file writes no money column. Confirm the
--    commission fingerprints are unmoved:
--      select count(*), sum(commission_sar) from public.trips;
--      select count(*) from public.project_commission_history;
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
--   begin;
--   drop view  if exists public.v_my_notifications;
--   drop view  if exists public.v_active_alerts;
--   drop table if exists public.notification_events;
--   drop table if exists public.notification_dismissals;
--   drop table if exists public.notification_prefs;
--   drop table if exists public.notification_thresholds;
--   commit;
--
-- Clean: this migration creates only new objects and alters nothing existing,
-- so the rollback is a pure drop. It loses per-user dismiss state and the
-- threshold row — nothing else references them.
-- ===========================================================================
