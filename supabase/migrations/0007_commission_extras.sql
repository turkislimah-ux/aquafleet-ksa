-- ============================================================================
-- Bousla — Phase 6 schema (2/3): Commission extras
-- Run this in the Supabase SQL editor (after 0006).
--
-- IMPORTANT: base commission lines are NOT stored. They are live-derived from
-- trips.commission_sar (stamped on Delivered by lib/commission.ts), grouped by
-- project per driver per month. These three tables hold ONLY the extras layered
-- on top of that base:
--   • commission_periods     — payout status + manager bonus, one row per
--                              driver per month (created on first action).
--   • commission_specials    — ad-hoc special-trip payments (positive).
--   • commission_adjustments — manual corrections (positive or negative).
--
-- month_key is "YYYY-MM" (same shape lib/commission.ts monthKeyOf produces).
-- All money is SAR numeric(12,2). All tables get authenticated-all RLS.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- commission_periods — payout state machine + discretionary bonus.
-- One row per (driver, month). payout_status: pending → approved → paid.
-- approved_by is free text for now (staff table arrives in 0008); paid_at is
-- stamped when the row is marked paid.
-- ----------------------------------------------------------------------------
create table if not exists public.commission_periods (
  id            uuid primary key default gen_random_uuid(),
  driver_id     uuid not null references public.drivers(id) on delete cascade,
  month_key     text not null check (month_key ~ '^\d{4}-\d{2}$'),
  payout_status text not null default 'pending'
                  check (payout_status in ('pending', 'approved', 'paid')),
  bonus_sar     numeric(12, 2) not null default 0,
  approved_by   text,
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (driver_id, month_key)
);

-- ----------------------------------------------------------------------------
-- commission_specials — special-trip / one-off bonus payments (added on top).
-- ----------------------------------------------------------------------------
create table if not exists public.commission_specials (
  id              uuid primary key default gen_random_uuid(),
  driver_id       uuid not null references public.drivers(id) on delete cascade,
  month_key       text not null check (month_key ~ '^\d{4}-\d{2}$'),
  label           text not null,
  amount_sar      numeric(12, 2) not null,
  date            date,
  note            text,
  is_special_trip boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- commission_adjustments — manual corrections; amount may be negative.
-- ----------------------------------------------------------------------------
create table if not exists public.commission_adjustments (
  id          uuid primary key default gen_random_uuid(),
  driver_id   uuid not null references public.drivers(id) on delete cascade,
  month_key   text not null check (month_key ~ '^\d{4}-\d{2}$'),
  label       text not null,
  amount_sar  numeric(12, 2) not null,
  date        date,
  note        text,
  created_at  timestamptz not null default now()
);

-- Speed up the per-month lookups the Commissions tab runs.
create index if not exists commission_specials_driver_month_idx
  on public.commission_specials (driver_id, month_key);
create index if not exists commission_adjustments_driver_month_idx
  on public.commission_adjustments (driver_id, month_key);

-- ============================================================================
-- Row Level Security — full read/write for authenticated users; anon gets none.
-- ============================================================================
alter table public.commission_periods     enable row level security;
alter table public.commission_specials    enable row level security;
alter table public.commission_adjustments enable row level security;

drop policy if exists "authenticated_all_commission_periods" on public.commission_periods;
create policy "authenticated_all_commission_periods"
  on public.commission_periods for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all_commission_specials" on public.commission_specials;
create policy "authenticated_all_commission_specials"
  on public.commission_specials for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_all_commission_adjustments" on public.commission_adjustments;
create policy "authenticated_all_commission_adjustments"
  on public.commission_adjustments for all to authenticated using (true) with check (true);
