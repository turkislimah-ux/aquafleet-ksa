-- 0080_staff_commissions.sql
-- Polish item 4 — mechanic commissions. Staff-page feature (Management &
-- Staff tab), NOT Maintenance. Two new tables, same "managed pick-list +
-- 1:many record" shape leave_periods/leave_types (0012) and
-- repairer_types/workshop_payments (0068) already established.
--
-- commission_types : extensible bilingual lookup, same pattern as
--   repairer_types (0068) — key/label_en/label_ar/active, seeded with a
--   starter set, "add custom type" inline later (no RPC needed — plain
--   insert, same reasoning add_repair_description (0060) already used for
--   an equivalent lookup).
-- staff_commissions: one row = one commission entry for one mechanic.
--   staff_id/commission type/amount/date/note/created_by/created_at. Plain
--   CRUD (insert/update/delete) from app code, no RPC — no invariant to
--   protect (same "no calculation, no auto-derivation" reasoning
--   workshop_payments/leave_periods already use for a plain money/date
--   record with a note).
--
-- SOFT-DELETE TIE (Turki asked to review this specifically): FK
-- `staff_id references staff(id) on delete cascade`, no mirrored
-- active/deleted flag on staff_commissions itself. "Not shown once the
-- mechanic is deactivated" is enforced the SAME way every other
-- staff-owned record in this app already reads staff's own current state
-- at query time (leave_periods, work orders' assigned_mechanic_id,
-- outsourced jobs' responsible_mechanic_id — none of those mirror a flag
-- either) — the app's staff-commissions query joins staff and filters
-- `active = true and terminated_at is null`, same two columns every other
-- "who's an eligible/active mechanic" check in this app already tests. A
-- mirrored flag would risk drifting out of sync if a staff member is ever
-- reactivated; reading the parent's live state can't drift. `on delete
-- cascade` only matters for a genuine hard delete of a staff row (doesn't
-- happen in normal soft-delete use — staff termination just flips
-- active/terminated_at) — same safety-net convention leave_periods' own
-- staff_id FK already uses.
--
-- ROLE SCOPING — an ASSUMPTION, flagged: staff_id is NOT constrained at
-- the DB level to role='mechanic' rows (no trigger/check). "Lives in the
-- staff popup for role='mechanic' staff ONLY" is read as a UI-display
-- instruction (same as leave_periods having no role gate either — it's
-- open to any staff/driver, the UI decides what shows where). If a hard
-- DB-level mechanic-only constraint is wanted instead, flag it back —
-- happy to add a trigger.
--
-- MONEY BOUNDARY (Turki will enforce on review): amount_sar is a bare
-- typed number — no formula, no join, no RPC touches it. This migration
-- creates ONLY these two tables; nothing in work_orders/outsourced_jobs/
-- purchase_orders/any cost RPC references commission_types or
-- staff_commissions, and this migration doesn't ALTER any of those tables
-- either. `_sar` suffix is this app's plain SAR-money naming convention
-- (unit_cost_sar, monthly_salary_sar, rate_per_trip_sar, ...) — naming
-- only, not a wiring into any of those figures.
--
-- Run in the Supabase SQL editor (Turki — after reviewing table shapes,
-- role scoping, and the soft-delete tie above).

create extension if not exists pgcrypto;

begin;

-- 1) Commission type lookup. key = stable FK target (unique); label_en/
--    label_ar = bilingual display text, same shape as repairer_types.
create table if not exists public.commission_types (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  label_en   text not null,
  label_ar   text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.commission_types enable row level security;
drop policy if exists "authenticated_all_commission_types" on public.commission_types;
create policy "authenticated_all_commission_types"
  on public.commission_types for all to authenticated using (true) with check (true);

insert into public.commission_types (key, label_en, label_ar) values
  ('overtime',          'Overtime',          'عمل إضافي'),
  ('extra_service',     'Extra Service',     'خدمة إضافية'),
  ('emergency_fix',     'Emergency Fix',     'إصلاح طارئ'),
  ('holiday_work',      'Holiday Work',      'عمل في العطلة'),
  ('performance_bonus', 'Performance Bonus', 'مكافأة أداء')
on conflict (key) do nothing;

-- 2) One row per commission entry. commission_type FK to commission_types
--    (key) — restrict delete (a type in use can't be deleted), cascade on
--    rename (key change propagates). amount_sar is a plain typed number,
--    no formula anywhere — Turki's explicit "no calculation, no
--    auto-derivation." commission_date named (not bare `date`) matching
--    this app's own start_date/due_by/invoice_date convention.
create table if not exists public.staff_commissions (
  id               uuid primary key default gen_random_uuid(),
  staff_id         uuid not null references public.staff(id) on delete cascade,
  commission_type  text not null references public.commission_types(key) on delete restrict on update cascade,
  amount_sar       numeric(12, 2) not null check (amount_sar > 0),
  commission_date  date not null,
  note             text,
  created_by       text,
  created_at       timestamptz not null default now()
);

create index if not exists staff_commissions_staff_idx
  on public.staff_commissions (staff_id, commission_date desc);

alter table public.staff_commissions enable row level security;
drop policy if exists "authenticated_all_staff_commissions" on public.staff_commissions;
create policy "authenticated_all_staff_commissions"
  on public.staff_commissions for all to authenticated using (true) with check (true);

commit;
