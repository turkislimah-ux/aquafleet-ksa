-- 0009_commission_rolling_history.sql
-- Rolling-balance commission redesign + frozen history snapshots.
-- WHY: payouts move from per-calendar-month to a per-driver ROLLING cycle.
-- "Current" commission = a driver's UNPAID delivered trips + UNPAID specials/
-- adjustments + the open cycle's bonus. On PAY we freeze a snapshot into
-- commission_payouts, tag the contributing rows with payout_id (so they leave the
-- current balance without being deleted), and reset the open cycle to zero.
-- Per-item review gains a 'pending' state (pending+approved count; denied excluded).
--
-- Run in the Supabase SQL editor (after 0008).

begin;

-- 1) HISTORY snapshot table (frozen at pay time). ----------------------------
create table if not exists public.commission_payouts (
  id              uuid primary key default gen_random_uuid(),
  driver_id       uuid not null references public.drivers(id) on delete cascade,
  paid_at         timestamptz not null default now(),
  approved_by     text,
  period_label    text not null,                      -- e.g. "Jun 2026" / date range
  base_sar        numeric(12,2) not null default 0,
  specials_sar    numeric(12,2) not null default 0,   -- approved only
  adjustments_sar numeric(12,2) not null default 0,   -- approved only
  bonus_sar       numeric(12,2) not null default 0,   -- if approved
  total_sar       numeric(12,2) not null default 0,
  snapshot        jsonb not null,                     -- full frozen breakdown
  created_at      timestamptz not null default now()
);
create index if not exists commission_payouts_driver_idx
  on public.commission_payouts (driver_id, paid_at desc);

alter table public.commission_payouts enable row level security;
drop policy if exists "authenticated_all_commission_payouts" on public.commission_payouts;
create policy "authenticated_all_commission_payouts"
  on public.commission_payouts for all to authenticated using (true) with check (true);

-- 2) payout_id tags on the live rows (NULL = current/unpaid). -----------------
alter table public.trips
  add column if not exists payout_id uuid references public.commission_payouts(id) on delete set null;
alter table public.commission_specials
  add column if not exists payout_id uuid references public.commission_payouts(id) on delete set null;
alter table public.commission_adjustments
  add column if not exists payout_id uuid references public.commission_payouts(id) on delete set null;
create index if not exists trips_unpaid_driver_idx on public.trips (driver_id) where payout_id is null;

-- 3) Per-item review state: 'active'->'pending'; allow pending/approved/denied. -
--    The old CHECK must be GONE before the UPDATE to 'pending' runs, or the
--    still-live (active|denied) constraint rejects it (error 23514). A named
--    `drop constraint if exists` only works if the name matches exactly; an
--    inline `add column ... check(...)` may have produced a different
--    auto-generated name. So drop by DISCOVERY: remove every CHECK constraint
--    that references the status column on these two tables, whatever its name.
do $$
declare r record;
begin
  for r in
    select rel.relname as tbl, con.conname as name
    from pg_constraint con
    join pg_class rel       on rel.oid = con.conrelid
    join pg_namespace nsp   on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname in ('commission_specials', 'commission_adjustments')
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.%I drop constraint %I', r.tbl, r.name);
  end loop;
end $$;

update public.commission_specials    set status = 'pending' where status = 'active';
update public.commission_adjustments set status = 'pending' where status = 'active';

alter table public.commission_specials
  alter column status set default 'pending',
  add constraint commission_specials_status_check check (status in ('pending','approved','denied'));
alter table public.commission_adjustments
  alter column status set default 'pending',
  add constraint commission_adjustments_status_check check (status in ('pending','approved','denied'));

-- 4) Repurpose commission_periods as the per-driver OPEN cycle. ---------------
--    Bonus becomes reviewable; ONE open row per driver (drop month uniqueness).
--    Legacy per-month rows (demo) are dropped FIRST so the new payout_status
--    CHECK can't trip on an old 'paid' value before the rows are gone.
delete from public.commission_periods;

alter table public.commission_periods
  add column if not exists bonus_status text not null default 'pending',
  add column if not exists bonus_deny_reason text;
alter table public.commission_periods drop constraint if exists commission_periods_bonus_status_check;
alter table public.commission_periods
  add constraint commission_periods_bonus_status_check check (bonus_status in ('pending','approved','denied'));

alter table public.commission_periods drop constraint if exists commission_periods_payout_status_check;
alter table public.commission_periods
  add constraint commission_periods_payout_status_check check (payout_status in ('pending','approved','denied'));

-- ONE open cycle row per driver: drop the (driver_id, month_key) uniqueness,
-- make month_key optional (label only), add a per-driver unique index.
alter table public.commission_periods drop constraint if exists commission_periods_driver_id_month_key_key;
alter table public.commission_periods alter column month_key drop not null;
create unique index if not exists commission_periods_one_open_per_driver
  on public.commission_periods (driver_id);

-- 5) Atomic PAY: snapshot + tag rows + reset the open cycle. ------------------
create or replace function public.pay_commission(
  p_driver_id    uuid,
  p_period_label text,
  p_base         numeric,
  p_specials     numeric,
  p_adjustments  numeric,
  p_bonus        numeric,
  p_total        numeric,
  p_snapshot     jsonb,
  p_approved_by  text default null
) returns uuid
language plpgsql
as $$
declare
  v_status text;
  v_id uuid;
begin
  -- STRICT pay: only from an approved open cycle.
  select payout_status into v_status from public.commission_periods where driver_id = p_driver_id;
  if v_status is distinct from 'approved' then
    raise exception 'Payout must be approved before paying (got %).', coalesce(v_status, 'none');
  end if;

  insert into public.commission_payouts
    (driver_id, approved_by, period_label, base_sar, specials_sar, adjustments_sar, bonus_sar, total_sar, snapshot)
  values
    (p_driver_id, p_approved_by, p_period_label, p_base, p_specials, p_adjustments, p_bonus, p_total, p_snapshot)
  returning id into v_id;

  update public.trips
     set payout_id = v_id
   where driver_id = p_driver_id and delivered_at is not null and payout_id is null;

  update public.commission_specials
     set payout_id = v_id, status = case when status = 'denied' then 'denied' else 'approved' end
   where driver_id = p_driver_id and payout_id is null;

  update public.commission_adjustments
     set payout_id = v_id, status = case when status = 'denied' then 'denied' else 'approved' end
   where driver_id = p_driver_id and payout_id is null;

  -- Reset the open cycle to a fresh empty state.
  update public.commission_periods
     set bonus_sar = 0, bonus_status = 'pending', bonus_deny_reason = null,
         payout_status = 'pending', approved_by = null, month_key = null
   where driver_id = p_driver_id;

  return v_id;
end;
$$;

grant execute on function public.pay_commission(uuid, text, numeric, numeric, numeric, numeric, numeric, jsonb, text) to authenticated;

commit;
