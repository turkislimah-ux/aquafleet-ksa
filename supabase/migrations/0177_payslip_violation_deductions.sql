-- 0177_payslip_violation_deductions.sql
-- TRAFFIC VIOLATIONS → PAYSLIP DEDUCTIONS. Requires 0175 and 0176.
--
-- MONEY-CORE. This file changes what a driver is paid. DRAFTED, NOT APPLIED —
-- per CLAUDE.md §5 the architect applies it, runs the money gate, and Turki
-- verifies the numbers before anything reaches a document.
--
-- ONE FILE ON PURPOSE. The view and the RPC MUST change together. The view's
-- net_sar becomes net-OF-deduction; the RPC today writes
-- `v_basis.net_sar - v_deductions`. Ship only the view and every payslip issued
-- in the gap is correct. Ship only the RPC and nothing changes. Ship the view
-- without fixing the RPC's subtraction and every payslip DOUBLE-SUBTRACTS the
-- fine. There is no safe split.
--
-- ===========================================================================
-- THE MODEL (locked by Turki)
--
--   month_fines   = sum of that driver's LIVE violations (voided_at is null)
--                   dated inside the payslip month. ALL of them, whatever
--                   payment_status says. A PURE FUNCTION of (driver, month):
--                   no prior-month state, no carry, no remainder chain.
--   gross         = base + commission + specials + adjustments + bonus
--                   (exactly today's net_sar expression, unchanged).
--   deductions    = LEAST(month_fines, GREATEST(gross, 0))  -- what pay absorbed
--   net           = gross - deductions                 -- clamps at 0 for gross >= 0
--   unabsorbed    = month_fines - deductions           -- >= 0
--
-- GREATEST(gross, 0) matters only for a NEGATIVE gross month (a big negative
-- commission_adjustment on an unpaid month). There deductions are 0 — pay that
-- does not exist cannot absorb a fine — and net stays the negative gross, which
-- driver_payslips_net_nonneg rejects at issue time. The preview shows the
-- negative pay honestly instead of a nonsense negative deduction.
--
-- unabsorbed_sar is a RECORD, NOT A CARRY. Next month never reads it. It exists
-- so the document can say "SAR 900 of fines, SAR 1500 pay, SAR 900 taken, SAR 0
-- left over" — or, when the fine is bigger than the pay, "SAR 2000 of fines,
-- SAR 1500 pay, SAR 1500 taken, SAR 500 NOT recovered". What happens to that
-- 500 is a human decision outside this system. The number is written down so
-- the decision can be made from a fact.
--
-- WYSIWYG. The deduction is computed in the VIEW, so the preview a manager
-- reads and the document he issues are the same arithmetic on the same row.
-- The RPC does not recompute anything — it freezes what the view said.
--
-- ===========================================================================
-- MEASURED BEFORE DRAFTING (live catalog ceqzmztewbborwgxnrqh, 2026-08-30)
--
--   driver_violations                  0 rows. Nothing to deduct yet.
--   driver_payslips                    2 rows, both 2026-07-01, both
--                                      deductions_sar 0.00, nets 1504.00 and
--                                      1517.02, both already net_sar >= 0.
--   v_driver_payslip_basis             43 rows, sum(net_sar) 65340.56,
--                                      fingerprint 4132683b7f5ae7a845f48552d19d014d.
--   Same 43 rows through THIS FILE's   sum 65340.56, fingerprint
--   arithmetic, simulated read-only:   4132683b7f5ae7a845f48552d19d014d.
--                                      IDENTICAL. With no violations on file,
--                                      LEAST(0, gross) = 0 and the whole change
--                                      is a no-op on every existing number.
--
-- ===========================================================================
-- 42P16: `create or replace view` is APPEND-ONLY
--
-- Columns cannot be inserted, reordered, renamed or retyped. An existing
-- column's EXPRESSION can change in place. So:
--   - net_sar STAYS at position 18 and its expression is rewritten there.
--   - the three new columns can only be appended at 19, 20, 21.
--   - net_sar is bare `numeric` today. Every operand below is bare numeric
--     (sum() drops the typmod, LEAST of two numerics is numeric), so the
--     rewrite cannot retype it. Do not "tidy" this by adding numeric(12,2)
--     anywhere in the outer SELECT — that is a 42P16 failure.
--
-- The month subquery is computed ONCE, in the basis CTE, and referenced three
-- times downstream. CTE columns are not part of the view's frozen output list,
-- so the two extra CTE levels (gross, absorbed) are free.
--
-- ===========================================================================
-- WHAT THIS FILE DOES NOT DO
--
-- No UI. app/reports/StatementViews.tsx:1854 still hardcodes `deductions: 0`
-- for an UNISSUED row while reading that row's net_sar — after this migration
-- that net is net-of-deduction, so the preview will show a reduced net beside
-- a deduction of zero until the UI stage lands. Flagged to the architect, not
-- fixed here. lib/reports.ts:934 also documents the old
-- `net_sar - deductions_sar` freeze and is now stale prose.

-- ===========================================================================
-- 1. driver_payslips — two new frozen figures, and the clamp as an invariant
-- ===========================================================================

-- deductions_sar ALREADY EXISTS (column 14, numeric(12,2) not null default 0,
-- added when the table was created). It is REUSED, not re-added. It changes
-- meaning, not shape: it was always 0 because there was no data source; now it
-- carries what pay actually absorbed.

-- Metadata-only in PG 11+ (a non-volatile default does not rewrite the table).
alter table public.driver_payslips
  add column if not exists violation_deduction_sar numeric(12,2) not null default 0;

alter table public.driver_payslips
  add column if not exists unabsorbed_sar numeric(12,2) not null default 0;

comment on column public.driver_payslips.violation_deduction_sar is
  'What the month''s live violations came to, BEFORE the clamp. The gross claim against this payslip. deductions_sar is what pay could cover; the difference is unabsorbed_sar.';

comment on column public.driver_payslips.deductions_sar is
  'What this payslip actually took off the driver: LEAST(violation_deduction_sar, gross pay). Never more than he earned, so net never goes negative. Frozen at issue.';

comment on column public.driver_payslips.unabsorbed_sar is
  'Fines this month''s pay could NOT cover: violation_deduction_sar - deductions_sar. A RECORD, NOT A CARRY — no later payslip reads it. Recovering it is a human decision made outside this system.';

-- The clamp, promoted from computed behaviour to an enforced invariant. The
-- two existing rows are 1504.00 and 1517.02 — both pass; verified live before
-- drafting. NOTE this is genuinely new enforcement: before today a fine larger
-- than pay would have written a NEGATIVE net and nothing would have stopped it.
alter table public.driver_payslips
  add constraint driver_payslips_net_nonneg check (net_sar >= 0);

alter table public.driver_payslips
  add constraint driver_payslips_violation_deduction_nonneg check (violation_deduction_sar >= 0);

alter table public.driver_payslips
  add constraint driver_payslips_unabsorbed_nonneg check (unabsorbed_sar >= 0);

-- Deductions never exceed the month's fines. No exceptions: a payslip that
-- deducts money no fine accounts for is a bug, including — especially — in a
-- month with no fines at all. Both existing rows pass (0 <= 0). The view
-- satisfies this structurally, since deductions_sar is a LEAST() whose first
-- argument IS violation_sum_sar; the constraint is here to catch a future
-- writer that does not go through the view.
alter table public.driver_payslips
  add constraint driver_payslips_deduction_within_violations
  check (deductions_sar <= violation_deduction_sar);

-- ===========================================================================
-- 2. driver_payslip_violations — the freeze table
-- ===========================================================================
--
-- Templated on driver_payslip_payouts (payslip_id + child_id, cascade on the
-- parent, restrict on the child, RLS + authenticated_all_* + anon revoke), WITH
-- ONE DELIBERATE STRENGTHENING.
--
-- driver_payslip_payouts has only a composite PK, so nothing structurally stops
-- one payout being claimed by two payslips. It survives on determinism: the
-- selection predicate is a pure function of (driver, month) and
-- UNIQUE (driver_id, period_start) allows one payslip per driver-month, so the
-- same payout can never be selected twice. The same reasoning covers violations
-- today. It is not written down anywhere, and it stops holding the moment
-- anyone adds carry-forward.
--
-- UNIQUE (violation_id) writes it down. One violation, at most one payslip,
-- enforced by the index rather than by an argument.

create table if not exists public.driver_payslip_violations (
  payslip_id   uuid not null references public.driver_payslips(id)   on delete cascade,
  violation_id uuid not null references public.driver_violations(id) on delete restrict,
  constraint driver_payslip_violations_pkey primary key (payslip_id, violation_id),
  constraint driver_payslip_violations_violation_unique unique (violation_id)
);

comment on table public.driver_payslip_violations is
  'Which violation rows a given payslip consumed. Written once, at issue, and never updated — this is what makes "Deducted" provable per-payslip instead of recomputed from a table that may since have changed.';

comment on column public.driver_payslip_violations.payslip_id is
  'The payslip that consumed the violation. Cascades: deleting a payslip drops its freeze rows, exactly as driver_payslip_payouts does.';

comment on column public.driver_payslip_violations.violation_id is
  'The consumed violation. RESTRICT — a violation that a payslip has deducted cannot be deleted out from under the document that charged for it. Void it instead (0176 voided_at); voiding does not retract an already-issued payslip.';

comment on constraint driver_payslip_violations_violation_unique on public.driver_payslip_violations is
  'A violation is consumed by AT MOST ONE payslip. The driver is never charged twice for the same ticket. Stronger than the payouts precedent, which relies on the selection being deterministic rather than on an index.';

alter table public.driver_payslip_violations enable row level security;

drop policy if exists authenticated_all_driver_payslip_violations on public.driver_payslip_violations;
create policy authenticated_all_driver_payslip_violations
  on public.driver_payslip_violations
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.driver_payslip_violations from anon;

-- ===========================================================================
-- 3. v_driver_payslip_basis — the deduction, computed where the preview reads it
-- ===========================================================================
--
-- Everything above the `violation_sum_sar` line is the DEPLOYED body,
-- transcribed from pg_get_viewdef. Do not treat the copy on disk as the
-- source — it had drifted from live before this file was written.

create or replace view public.v_driver_payslip_basis as
with months as (
  select v_report_months.month
    from public.v_report_months
),
live_drivers as (
  select d.id,
         d.name,
         d.salary_sar,
         d.hire_date,
         d.terminated_at
    from public.drivers d
),
matched_payouts as (
  select p.driver_id,
         date_trunc('month', (p.paid_at at time zone 'Asia/Riyadh'))::date as month,
         count(*)               as payout_count,
         sum(p.base_sar)        as base_sar,
         sum(p.specials_sar)    as specials_sar,
         sum(p.adjustments_sar) as adjustments_sar,
         sum(p.bonus_sar)       as bonus_sar,
         sum(p.total_sar)       as total_sar
    from public.commission_payouts p
   where p.paid_at is not null
   group by p.driver_id, (date_trunc('month', (p.paid_at at time zone 'Asia/Riyadh'))::date)
),
basis as (
  select m.month as period_start,
         d.id    as driver_id,
         d.name  as driver_name,
         case
           when d.hire_date is not null
                and d.hire_date > (m.month + interval '1 mon' - interval '1 day')::date
             then 0::numeric
           when d.terminated_at is not null
                and (d.terminated_at at time zone 'Asia/Riyadh')::date < m.month
             then 0::numeric
           else coalesce((
                  select h.salary_sar
                    from public.salary_history h
                   where h.driver_id = d.id
                     and h.effective_from <= (m.month + interval '1 mon' - interval '1 day')::date
                   order by h.effective_from desc
                   limit 1), 0::numeric)
         end as base_salary_sar,
         d.salary_sar is null as salary_missing,
         d.hire_date  is null as hire_date_missing,
         case when mp.driver_id is not null then 'paid' else 'earned' end as commission_basis,
         mp.driver_id is not null as commission_settled,
         coalesce(mp.payout_count, 0::bigint) as payout_count,
         case
           when mp.driver_id is not null then mp.base_sar
           else coalesce((
                  select sum(t.commission_sar)
                    from public.trips t
                   where t.driver_id = d.id
                     and t.stage = 'delivered'
                     and t.payout_id is null
                     and date_trunc('month', t.trip_date::timestamptz)::date = m.month), 0::numeric)
         end as commission_sar,
         case
           when mp.driver_id is not null then mp.specials_sar
           else coalesce((
                  select sum(cs.amount_sar)
                    from public.commission_specials cs
                   where cs.driver_id = d.id
                     and cs.status = 'approved'
                     and cs.payout_id is null
                     and cs.month_key = to_char(m.month::timestamptz, 'YYYY-MM')), 0::numeric)
         end as specials_sar,
         case
           when mp.driver_id is not null then mp.adjustments_sar
           else coalesce((
                  select sum(ca.amount_sar)
                    from public.commission_adjustments ca
                   where ca.driver_id = d.id
                     and ca.status = 'approved'
                     and ca.payout_id is null
                     and ca.month_key = to_char(m.month::timestamptz, 'YYYY-MM')), 0::numeric)
         end as adjustments_sar,
         case
           when mp.driver_id is not null then mp.bonus_sar
           else coalesce((
                  select sum(cp.bonus_sar)
                    from public.commission_periods cp
                   where cp.driver_id = d.id
                     and cp.bonus_status = 'approved'
                     and cp.month_key is not null
                     and cp.month_key = to_char(m.month::timestamptz, 'YYYY-MM')), 0::numeric)
         end as bonus_sar,
         ps.id             as issued_payslip_id,
         ps.payslip_number as issued_payslip_number,
         d.terminated_at is not null as terminated,
         (d.terminated_at at time zone 'Asia/Riyadh')::date as termination_date,

         -- NEW. The month's live fines for this driver, computed ONCE.
         --
         -- violation_date is a plain `date`, so the month is a plain half-open
         -- date range. NO `at time zone` term — that form belongs to the
         -- timestamptz columns above (paid_at, terminated_at); applying it to a
         -- date casts through timestamp and shifts the bucket.
         --
         -- >= m.month and < m.month + 1 month rather than
         -- date_trunc(...) = m.month so the partial index stays usable.
         --
         -- voided_at is null is the ONLY live-filter (0176's soft-delete, the
         -- same predicate as driver_violations_driver_ref_live_unique).
         -- payment_status is deliberately NOT filtered: it records whether the
         -- FINE was settled with the authority, which is a separate question
         -- from whether the DRIVER was charged for it.
         coalesce((
           select sum(dv.amount_sar)
             from public.driver_violations dv
            where dv.driver_id = d.id
              and dv.voided_at is null
              and dv.violation_date >= m.month
              and dv.violation_date <  (m.month + interval '1 month')::date), 0::numeric)
           as violation_sum_sar
    from months m
         cross join live_drivers d
         left join matched_payouts mp on mp.driver_id = d.id and mp.month = m.month
         left join public.driver_payslips ps on ps.driver_id = d.id and ps.period_start = m.month
   where (d.hire_date is null
          or d.hire_date <= (m.month + interval '1 mon' - interval '1 day')::date)
     and (d.terminated_at is null
          or (d.terminated_at at time zone 'Asia/Riyadh')::date >= m.month)
),
-- Gross is today's net_sar expression, named. Split out so it is written once
-- and referenced three times instead of pasted into three output columns.
gross as (
  select b.*,
         b.base_salary_sar + b.commission_sar + b.specials_sar
           + b.adjustments_sar + b.bonus_sar as gross_sar
    from basis b
),
absorbed as (
  select g.*,
         -- greatest(gross, 0) so a NEGATIVE gross month absorbs 0 rather than a
         -- negative amount. Reachable: commission_adjustments.amount_sar has no
         -- non-negative check and 7 negative rows exist live, though 0 of the 43
         -- current basis rows are negative — so this changes nothing today. Left
         -- unclamped it would emit a negative deductions_sar into the preview and
         -- abort at issue time on driver_payslips_deduction_nonneg. Now net_sar =
         -- gross - 0 = the negative gross, which driver_payslips_net_nonneg still
         -- rejects at issue time on the FROZEN row; the preview just no longer
         -- reports a negative deduction on its way there. Both arguments are bare
         -- numeric, so greatest() stays bare numeric — no typmod, no 42P16.
         least(g.violation_sum_sar, greatest(g.gross_sar, 0::numeric)) as absorbed_sar
    from gross g
)
select period_start,
       driver_id,
       driver_name,
       base_salary_sar,
       salary_missing,
       hire_date_missing,
       commission_basis,
       commission_settled,
       payout_count,
       commission_sar,
       specials_sar,
       adjustments_sar,
       bonus_sar,
       issued_payslip_id,
       issued_payslip_number,
       terminated,
       termination_date,
       -- COLUMN 18, EXPRESSION REWRITTEN IN PLACE. Was
       -- `base + commission + specials + adjustments + bonus`; now that same
       -- sum minus what it absorbed. The subtraction cannot MAKE it negative:
       -- absorbed_sar is LEAST(fines, GREATEST(gross, 0)), so the most it can
       -- take is all of a non-negative gross, and it takes nothing from a
       -- negative one. A gross that is ALREADY negative stays negative here and
       -- is rejected at issue time by driver_payslips_net_nonneg.
       -- Still bare numeric — see the 42P16 note in the header.
       gross_sar - absorbed_sar         as net_sar,
       -- COLUMNS 19-21, APPENDED. Order is forced, not chosen.
       violation_sum_sar                as violation_deduction_sar,
       absorbed_sar                     as deductions_sar,
       violation_sum_sar - absorbed_sar as unabsorbed_sar
  from absorbed a;

comment on view public.v_driver_payslip_basis is
  'One row per driver per reportable month: what he would be paid if a payslip were issued now. net_sar is NET OF VIOLATION DEDUCTIONS as of 0177 — the preview and the issued document are the same arithmetic, so they cannot disagree. issue_driver_payslip freezes these figures verbatim and does not recompute them.';

-- §6 FOOTER. `create or replace view` keeps the OID but DROPS reloptions, and
-- the grants have to be restated for the same reason. All three were live
-- before this file ran; all three are restored here.
alter view public.v_driver_payslip_basis set (security_invoker = true);
revoke all    on public.v_driver_payslip_basis from anon;
grant  select on public.v_driver_payslip_basis to authenticated;

-- ===========================================================================
-- 4. issue_driver_payslip — freeze the view's figures, and stop double-subtracting
-- ===========================================================================
--
-- Every guard, the snapshot's existing keys, the payout freeze, SECURITY
-- DEFINER and `set search_path` are carried over from the deployed body
-- unchanged. Four things change:
--
--   a. v_deductions stops being a hardcoded 0 and takes the view's figure.
--   b. violation_deduction_sar and unabsorbed_sar join the INSERT.
--   c. THE DOUBLE-SUBTRACT IS FIXED. The old body wrote
--        v_basis.net_sar - v_deductions
--      which was correct only while the view's net_sar was gross. It is now
--      net-of-deduction, so the value written is v_basis.net_sar ALONE.
--      Leaving the old expression would charge every driver his fine twice.
--   d. the snapshot gains a 'violations' key, and the consumed rows are frozen
--      into driver_payslip_violations.

create or replace function public.issue_driver_payslip(
  p_driver_id    uuid,
  p_period_start date,
  p_actor        text
) returns public.driver_payslips
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_basis      record;
  v_row        public.driver_payslips;
  v_number     text;
  v_snap       jsonb;
  v_deductions numeric(12,2) := 0;
  v_frozen_sum numeric(12,2) := 0;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'An actor is required to issue a payslip.' using errcode = '23514';
  end if;
  if p_period_start <> date_trunc('month', p_period_start)::date then
    raise exception 'A payslip period must start on the first day of a month.'
      using errcode = '23514';
  end if;
  if p_period_start >= date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date then
    raise exception 'That month has not finished yet — a payslip can only be issued for a completed month.'
      using errcode = '23514';
  end if;

  perform 1 from public.drivers where id = p_driver_id for update;

  if exists (select 1 from public.driver_payslips
              where driver_id = p_driver_id and period_start = p_period_start) then
    raise exception 'This driver already has a payslip issued for that month.'
      using errcode = '23505';
  end if;

  select * into v_basis
    from public.v_driver_payslip_basis
   where driver_id = p_driver_id and period_start = p_period_start;

  if not found then
    raise exception 'That driver was not on the payroll for that month.'
      using errcode = '23514';
  end if;

  if v_basis.hire_date_missing then
    raise exception 'This driver has no hire date, so a payslip period cannot be established. Set the hire date first.'
      using errcode = '23514';
  end if;

  -- READ, DO NOT RECOMPUTE. The view already applied LEAST(fines, gross); the
  -- whole point of computing it there is that the manager's preview and this
  -- document run the same arithmetic on the same row.
  v_deductions := v_basis.deductions_sar;

  v_number := public.next_payslip_number(extract(year from p_period_start)::int);

  select jsonb_build_object(
    'driver_name',        v_basis.driver_name,
    'salary_at_issue',    v_basis.base_salary_sar,
    'salary_missing',     v_basis.salary_missing,
    'commission_basis',   v_basis.commission_basis,
    'payout_count',       v_basis.payout_count,
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'period_label', p.period_label, 'paid_at', p.paid_at,
               'base_sar', p.base_sar, 'specials_sar', p.specials_sar,
               'adjustments_sar', p.adjustments_sar, 'bonus_sar', p.bonus_sar,
               'total_sar', p.total_sar) order by p.paid_at)
        from public.commission_payouts p
       where p.driver_id = p_driver_id
         and p.paid_at is not null
         and date_trunc('month', (p.paid_at at time zone 'Asia/Riyadh'))::date = p_period_start
    ), '[]'::jsonb),
    'covered_trips', coalesce((
      select jsonb_build_object(
               'count', count(*), 'first_trip', min(t.trip_date), 'last_trip', max(t.trip_date),
               'ids', jsonb_agg(t.id order by t.trip_date))
        from public.trips t
       where t.driver_id = p_driver_id
         and (
           case when v_basis.commission_basis = 'paid'
                then t.payout_id in (
                       select p.id from public.commission_payouts p
                        where p.driver_id = p_driver_id and p.paid_at is not null
                          and date_trunc('month', (p.paid_at at time zone 'Asia/Riyadh'))::date = p_period_start)
                else t.stage = 'delivered' and t.payout_id is null
                     and date_trunc('month', t.trip_date)::date = p_period_start
           end)
    ), jsonb_build_object('count', 0)),
    -- NEW. The document has to be readable years from now without joining back
    -- to tables that may have been voided, re-labelled or re-priced since.
    'violations', jsonb_build_object(
      'month_total_sar', v_basis.violation_deduction_sar,
      'absorbed_sar',    v_basis.deductions_sar,
      'unabsorbed_sar',  v_basis.unabsorbed_sar,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id',              dv.id,
                 'ref_no',          dv.ref_no,
                 'type_key',        vt.key,
                 'type_label',      vt.label,
                 'type_label_ar',   vt.label_ar,
                 'amount_sar',      dv.amount_sar,
                 'violation_date',  dv.violation_date,
                 'payment_status',  dv.payment_status)
               order by dv.violation_date, dv.ref_no)
          from public.driver_violations dv
          join public.violation_types  vt on vt.id = dv.violation_type_id
         where dv.driver_id = p_driver_id
           and dv.voided_at is null
           and dv.violation_date >= p_period_start
           and dv.violation_date <  (p_period_start + interval '1 month')::date
      ), '[]'::jsonb)
    ),
    'issued_from', 'v_driver_payslip_basis'
  ) into v_snap;

  insert into public.driver_payslips (
    payslip_number, driver_id, period_start, issued_by,
    commission_basis, commission_settled,
    base_salary_sar, commission_sar, specials_sar, adjustments_sar, bonus_sar,
    violation_deduction_sar, deductions_sar, unabsorbed_sar, net_sar, snapshot
  ) values (
    v_number, p_driver_id, p_period_start, p_actor,
    v_basis.commission_basis, v_basis.commission_settled,
    v_basis.base_salary_sar, v_basis.commission_sar, v_basis.specials_sar,
    v_basis.adjustments_sar, v_basis.bonus_sar,
    v_basis.violation_deduction_sar,
    v_deductions,
    v_basis.unabsorbed_sar,
    -- NOT `v_basis.net_sar - v_deductions`. The view already subtracted.
    v_basis.net_sar,
    v_snap
  ) returning * into v_row;

  insert into public.driver_payslip_payouts (payslip_id, payout_id)
  select v_row.id, p.id
    from public.commission_payouts p
   where p.driver_id = p_driver_id
     and p.paid_at is not null
     and date_trunc('month', (p.paid_at at time zone 'Asia/Riyadh'))::date = p_period_start;

  -- FREEZE the consumed violations. Same predicate the view summed with, so
  -- the itemised list and the total are the same set by construction.
  insert into public.driver_payslip_violations (payslip_id, violation_id)
  select v_row.id, dv.id
    from public.driver_violations dv
   where dv.driver_id = p_driver_id
     and dv.voided_at is null
     and dv.violation_date >= p_period_start
     and dv.violation_date <  (p_period_start + interval '1 month')::date;

  -- BEYOND THE LITERAL SPEC — flagged to the architect, easy to delete.
  --
  -- The view's sum and the freeze above are two reads at two snapshots. The
  -- `for update` on drivers serialises two concurrent issues of the same
  -- driver; it does NOT stop someone inserting a violation between those two
  -- reads. That would produce a document whose stated total does not match the
  -- rows it itemises — silently. Assert they agree and abort if not; 40001
  -- tells the client this is a retry, not a bad request.
  select coalesce(sum(dv.amount_sar), 0)
    into v_frozen_sum
    from public.driver_payslip_violations pv
    join public.driver_violations dv on dv.id = pv.violation_id
   where pv.payslip_id = v_row.id;

  if v_frozen_sum <> v_basis.violation_deduction_sar then
    raise exception 'Violations for this driver changed while the payslip was being issued (basis %, frozen %). Nothing was saved — try again.',
      v_basis.violation_deduction_sar, v_frozen_sum
      using errcode = '40001';
  end if;

  return v_row;
end;
$function$;

-- §6 FOOTER. `create or replace function` RESETS THE ACL TO `EXECUTE TO PUBLIC`,
-- which would hand this RPC to anon. The revoke and both grants must be in this
-- same file — the deployed ACL before this ran was
-- {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}, i.e.
-- no PUBLIC entry, and that is what these three lines restore.
revoke execute on function public.issue_driver_payslip(uuid, date, text) from public, anon;
grant  execute on function public.issue_driver_payslip(uuid, date, text) to authenticated;
grant  execute on function public.issue_driver_payslip(uuid, date, text) to service_role;

-- ===========================================================================
-- VERIFY AFTER APPLY — the catalog, not this file's result grid (CLAUDE.md §5).
-- ===========================================================================
--
--   -- 1. THE MONEY GATE. The two frozen payslips must be byte-identical.
--   --    Expect exactly: PS-2026-000001 net 1504.00, PS-2026-000002 net
--   --    1517.02, both deductions 0.00, and both new columns 0.00.
--   select payslip_number, period_start, deductions_sar,
--          violation_deduction_sar, unabsorbed_sar, net_sar
--     from public.driver_payslips
--    order by payslip_number;
--
--   -- 2. THE PREVIEW GATE. Must still be 43 rows / 65340.56 /
--   --    4132683b7f5ae7a845f48552d19d014d — the pre-apply fingerprint.
--   select count(*) as basis_rows, sum(net_sar) as sum_net_sar,
--          md5(string_agg(driver_id::text||'|'||period_start::text||'|'||net_sar::text,
--                         ',' order by driver_id, period_start)) as fingerprint
--     from public.v_driver_payslip_basis;
--
--   -- 3. net_sar KEPT ITS TYPE (bare numeric) and sits at position 18, with
--   --    the three new columns at 19, 20, 21 and nothing reordered.
--   select a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) as typ
--     from pg_attribute a
--    where a.attrelid = 'public.v_driver_payslip_basis'::regclass
--      and a.attnum > 0 and not a.attisdropped
--    order by a.attnum;
--
--   -- 4. View footer survived the replace: security_invoker on, anon out.
--   select c.reloptions,
--          has_table_privilege('anon','public.v_driver_payslip_basis','select')          as anon_select,
--          has_table_privilege('authenticated','public.v_driver_payslip_basis','select') as auth_select
--     from pg_class c where c.oid = 'public.v_driver_payslip_basis'::regclass;
--
--   -- 5. Function ACL survived the replace. anon_exec MUST be false.
--   select has_function_privilege('anon',          'public.issue_driver_payslip(uuid,date,text)', 'execute') as anon_exec,
--          has_function_privilege('authenticated', 'public.issue_driver_payslip(uuid,date,text)', 'execute') as auth_exec,
--          has_function_privilege('service_role',  'public.issue_driver_payslip(uuid,date,text)', 'execute') as svc_exec;
--
--   -- 6. THE DOUBLE-SUBTRACT IS GONE. First must be 0, second must be 1.
--   select (select count(*) from pg_proc p
--            where p.oid = 'public.issue_driver_payslip(uuid,date,text)'::regprocedure
--              and pg_get_functiondef(p.oid) like '%v_basis.net_sar - v_deductions%') as double_subtract_present,
--          (select count(*) from pg_proc p
--            where p.oid = 'public.issue_driver_payslip(uuid,date,text)'::regprocedure
--              and pg_get_functiondef(p.oid) like '%driver_payslip_violations%')      as freeze_wired;
--
--   -- 7. Freeze table: RLS on, anon out, one policy, and the uniqueness rule.
--   select c.relrowsecurity as rls,
--          has_table_privilege('anon', c.oid, 'select') as anon_select,
--          (select count(*) from pg_policy where polrelid = c.oid) as policies,
--          (select count(*) from pg_constraint
--            where conrelid = c.oid and contype = 'u') as unique_constraints
--     from pg_class c where c.oid = 'public.driver_payslip_violations'::regclass;
--
--   -- 8. All five new constraints landed on driver_payslips.
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.driver_payslips'::regclass and contype = 'c'
--    order by conname;
--
--   -- 9. END-TO-END, IN A TRANSACTION YOU ROLL BACK. Nothing above proves the
--   --    arithmetic, because driver_violations is empty. Run this by hand in
--   --    the SQL editor, read the three rows, then ROLLBACK — do not commit.
--   --
--   --      begin;
--   --      -- fines < pay: 1300 salary + 204 commission = 1504 gross, 300 fine
--   --      insert into public.driver_violations
--   --        (driver_id, violation_type_id, ref_no, amount_sar, violation_date, created_by)
--   --      select 'd4f3fed1-7175-440b-aded-d0d79f7fc0c9', vt.id, 'GATE-TEST-1', 300.00,
--   --             date '2026-06-15', 'gate'
--   --        from public.violation_types vt order by vt.key limit 1;
--   --
--   --      select net_sar, violation_deduction_sar, deductions_sar, unabsorbed_sar
--   --        from public.v_driver_payslip_basis
--   --       where driver_id = 'd4f3fed1-7175-440b-aded-d0d79f7fc0c9'
--   --         and period_start = date '2026-06-01';
--   --      -- EXPECT gross-300, 300.00, 300.00, 0.00
--   --
--   --      update public.driver_violations set amount_sar = 99999.00
--   --       where ref_no = 'GATE-TEST-1';
--   --      select net_sar, violation_deduction_sar, deductions_sar, unabsorbed_sar
--   --        from public.v_driver_payslip_basis
--   --       where driver_id = 'd4f3fed1-7175-440b-aded-d0d79f7fc0c9'
--   --         and period_start = date '2026-06-01';
--   --      -- EXPECT 0.00, 99999.00, gross, 99999-gross   <- the clamp
--   --
--   --      update public.driver_violations set voided_at = now()
--   --       where ref_no = 'GATE-TEST-1';
--   --      select net_sar, violation_deduction_sar, deductions_sar, unabsorbed_sar
--   --        from public.v_driver_payslip_basis
--   --       where driver_id = 'd4f3fed1-7175-440b-aded-d0d79f7fc0c9'
--   --         and period_start = date '2026-06-01';
--   --      -- EXPECT the ORIGINAL gross, 0.00, 0.00, 0.00   <- void excluded
--   --      rollback;
