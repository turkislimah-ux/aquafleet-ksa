-- 0125_salary_history.sql
-- Effective-dated salary, FORWARD-ONLY. Baseline seeded at TODAY, so no past
-- month re-costs and no previously reported profit moves.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews and applies.
--
-- ===========================================================================
-- THE RULE THAT MAKES THIS SAFE, AND WHERE IT LIVES
-- ===========================================================================
-- Ruling: forward-only. Every month BEFORE today keeps costing at today's
-- salary, because that is the only salary ever recorded.
--
-- That is NOT achieved by the seed alone — it is achieved by the RESOLUTION
-- RULE in section 3:
--
--     the salary in effect for a month
--       = the latest history row with effective_from <= that month's END
--       = FALLING BACK TO THE EARLIEST ROW when the month predates all history
--
-- WITHOUT THE FALLBACK, June and July would resolve to NULL (their month-ends
-- precede the seed date), payroll would collapse to zero for both, and the P&L
-- would restate catastrophically. The fallback is the whole forward-only
-- guarantee. Do not "simplify" it away.
--
-- With one seeded row per person effective today:
--   June  month-end 2026-06-30  -> no row <= that date -> FALLBACK -> today's salary
--   July  month-end 2026-07-31  -> no row <= that date -> FALLBACK -> today's salary
--   Aug   month-end 2026-08-31  -> the seed row qualifies -> today's salary
-- All three months therefore read EXACTLY what they read now.
--
-- A future raise inserts a row with its own effective_from; from that date
-- forward the new figure applies and everything before it is untouched.
--
-- ===========================================================================
-- WHAT MUST NOT MOVE — the architect verifies these against live data
-- ===========================================================================
-- Captured before drafting:
--
--   month    staff      driver    missing  payroll    operating_cost  net_profit
--   2026-06  10,600.00  14,400.00      4   25,000.00      25,598.00   -25,598.00
--   2026-07  16,900.00  20,900.00      3   37,800.00      57,443.9700    206.0300
--   2026-08  16,900.00  14,400.00      3   31,300.00      59,900.0200 -59,900.0200
--
-- JUNE PAYROLL MUST STAY 25,000.00 — that is the 0117-corrected figure. If it
-- moves, the forward-only rule is broken and this migration must be reverted.
--
-- The two frozen payslips must also be byte-identical (they read their own
-- snapshot and this file does not touch driver_payslips at all):
--   PS-2026-000001  base 1,300.00  commission 204.00  net 1,504.00
--   PS-2026-000002  base 1,300.00  commission 217.02  net 1,517.02
--
-- ===========================================================================
-- WHY A TRIGGER, NOT AN APP WRITE
-- ===========================================================================
-- The app writes drivers.salary_sar / staff.monthly_salary_sar directly from
-- its edit forms. If only the seed wrote history, then the day someone is hired
-- or given a raise through the UI they would have NO history row — and the
-- resolution above would return NULL and DROP THEM FROM PAYROLL ENTIRELY. A
-- silent under-count of real wages is the worst failure this feature could have.
--
-- So the history is maintained by trigger: any insert or salary-changing update
-- writes a row effective TODAY. The app needs no change to stay correct, and it
-- cannot be forgotten by a future edit path.
--
-- TWO TRIGGERS, NOT ONE — the 0114 lesson. OLD cannot be referenced in an
-- INSERT trigger's WHEN clause, so a combined INSERT OR UPDATE would bury the
-- IS-DISTINCT-FROM test in the body and enter the function on every unrelated
-- update. Split, the UPDATE trigger's WHEN is evaluated without a call.
--
-- The base columns stay as they are: they remain what the forms read and write,
-- and they are the CURRENT salary. History is derived from them, never the
-- reverse — one writer, one direction.
--
-- ===========================================================================
-- WHAT THIS FILE DOES NOT TOUCH
-- ===========================================================================
-- · driver_payslips — frozen documents. Never re-read, never recomputed.
-- · The 0117 created_at floor on the employment window. It is carried over
--   VERBATIM in section 3; it answers "was this person employed that month",
--   which is a different question from "what were they paid".
-- · lib/prepaid.ts, lib/vat.ts, invoice math — no customer money here at all.
-- · commission_sar and every commission view — out of scope by ruling.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) The history table. Subject pattern: two nullable FKs + a CHECK that
--    exactly one is set — the same shape consumption_approvals and
--    archive_documents already use for "one of several subjects".
-- ---------------------------------------------------------------------
create table if not exists public.salary_history (
  id             uuid primary key default gen_random_uuid(),
  driver_id      uuid references public.drivers(id) on delete cascade,
  staff_id       uuid references public.staff(id)   on delete cascade,
  -- The date this salary STARTS applying. Forward-only: never backdated by
  -- this migration or by the triggers below.
  effective_from date not null,
  -- 0 is a legitimate salary (unpaid/owner); NULL is not allowed here, because
  -- "no salary recorded" is the ABSENCE of a row, not a row holding NULL.
  salary_sar     numeric(12, 2) not null,
  note           text,
  created_at     timestamptz not null default now(),
  constraint salary_history_one_subject check (
    (driver_id is not null)::int + (staff_id is not null)::int = 1
  ),
  constraint salary_history_nonneg check (salary_sar >= 0)
);

comment on table public.salary_history is
  'Effective-dated salary (0125). One row per person per change, forward-only. '
  'A month resolves to the latest row with effective_from <= that month end, '
  'falling back to the EARLIEST row when the month predates all history — that '
  'fallback is what keeps pre-0125 months costed exactly as before.';

-- One salary per person per date. Two partial indexes rather than one composite,
-- because exactly one subject column is non-null on any row.
create unique index if not exists salary_history_driver_date
  on public.salary_history (driver_id, effective_from) where driver_id is not null;
create unique index if not exists salary_history_staff_date
  on public.salary_history (staff_id, effective_from)  where staff_id  is not null;

-- Resolution reads by subject ordered on effective_from, in both directions.
create index if not exists salary_history_driver_lookup
  on public.salary_history (driver_id, effective_from desc) where driver_id is not null;
create index if not exists salary_history_staff_lookup
  on public.salary_history (staff_id, effective_from desc)  where staff_id  is not null;

alter table public.salary_history enable row level security;

drop policy if exists authenticated_all_salary_history on public.salary_history;
create policy authenticated_all_salary_history on public.salary_history
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- 2) SEED — every person's CURRENT salary, effective TODAY (Asia/Riyadh).
--    People with no salary recorded get NO row: absence is the honest
--    representation, and it keeps people_missing_salary meaning what it means.
-- ---------------------------------------------------------------------
insert into public.salary_history (driver_id, effective_from, salary_sar, note)
select d.id, (now() at time zone 'Asia/Riyadh')::date, d.salary_sar,
       'Baseline seeded by 0125 — the salary of record when history began.'
  from public.drivers d
 where d.salary_sar is not null
on conflict do nothing;

insert into public.salary_history (staff_id, effective_from, salary_sar, note)
select s.id, (now() at time zone 'Asia/Riyadh')::date, s.monthly_salary_sar,
       'Baseline seeded by 0125 — the salary of record when history began.'
  from public.staff s
 where s.monthly_salary_sar is not null
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3) v_payroll_monthly reads EFFECTIVE salary.
--
--    create-or-replace, so the column list is reproduced EXACTLY in order and
--    type (month, staff_salary_sar, driver_salary_sar, people_missing_salary,
--    salary_is_current_snapshot). Nothing is added or removed — 42P16.
--
--    The employment window is 0117's, carried over VERBATIM.
-- ---------------------------------------------------------------------
create or replace view public.v_payroll_monthly as
select
  m.month,
  coalesce((
    select sum(coalesce(
      -- effective salary: latest row on/before month end, else EARLIEST row.
      (select h.salary_sar from public.salary_history h
        where h.staff_id = s.id
          and h.effective_from <= (m.month + interval '1 mon' - interval '1 day')::date
        order by h.effective_from desc limit 1),
      (select h.salary_sar from public.salary_history h
        where h.staff_id = s.id
        order by h.effective_from asc limit 1),
      0::numeric))
      from public.staff s
     where coalesce(s.hire_date, (s.created_at at time zone 'Asia/Riyadh')::date)
             <= (m.month + interval '1 mon' - interval '1 day')::date
       and (s.terminated_at is null or s.terminated_at::date >= m.month)
  ), 0::numeric) as staff_salary_sar,
  coalesce((
    select sum(coalesce(
      (select h.salary_sar from public.salary_history h
        where h.driver_id = d.id
          and h.effective_from <= (m.month + interval '1 mon' - interval '1 day')::date
        order by h.effective_from desc limit 1),
      (select h.salary_sar from public.salary_history h
        where h.driver_id = d.id
        order by h.effective_from asc limit 1),
      0::numeric))
      from public.drivers d
     where coalesce(d.hire_date, (d.created_at at time zone 'Asia/Riyadh')::date)
             <= (m.month + interval '1 mon' - interval '1 day')::date
       and (d.terminated_at is null or d.terminated_at::date >= m.month)
  ), 0::numeric) as driver_salary_sar,
  -- "Missing" now means NO HISTORY ROW, which is the same set as a NULL base
  -- column immediately after the seed, and stays correct as people are added.
  ((select count(*) from public.staff s
     where not exists (select 1 from public.salary_history h where h.staff_id = s.id)
       and (s.terminated_at is null or s.terminated_at::date >= m.month))
  + (select count(*) from public.drivers d
      where not exists (select 1 from public.salary_history h where h.driver_id = d.id)
        and (d.terminated_at is null or d.terminated_at::date >= m.month)))
    as people_missing_salary,
  -- HONEST NOW, rather than a hardcoded true. It answers: did this month fall
  -- back to the baseline because no recorded history covers it? True = the
  -- figure is today's salary standing in for an unrecorded past. The flag was
  -- always a placeholder for this feature; it now reports rather than asserts.
  exists (
    select 1 from public.staff s
     where (s.terminated_at is null or s.terminated_at::date >= m.month)
       and exists (select 1 from public.salary_history h where h.staff_id = s.id)
       and not exists (
         select 1 from public.salary_history h
          where h.staff_id = s.id
            and h.effective_from <= (m.month + interval '1 mon' - interval '1 day')::date)
    union all
    select 1 from public.drivers d
     where (d.terminated_at is null or d.terminated_at::date >= m.month)
       and exists (select 1 from public.salary_history h where h.driver_id = d.id)
       and not exists (
         select 1 from public.salary_history h
          where h.driver_id = d.id
            and h.effective_from <= (m.month + interval '1 mon' - interval '1 day')::date)
  ) as salary_is_current_snapshot
from public.v_report_months m;

-- create-or-replace does NOT preserve reloptions (CLAUDE.md section 6).
alter view public.v_payroll_monthly set (security_invoker = true);
revoke all on public.v_payroll_monthly from anon;
grant select on public.v_payroll_monthly to authenticated;

-- ---------------------------------------------------------------------
-- 4) Keep history in step with the base columns. See the header for why this
--    is a trigger and not an app write.
-- ---------------------------------------------------------------------
create or replace function public.record_salary_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  if tg_table_name = 'drivers' then
    if new.salary_sar is not null then
      insert into public.salary_history (driver_id, effective_from, salary_sar, note)
      values (new.id, v_today, new.salary_sar, 'Recorded automatically on salary change.')
      on conflict (driver_id, effective_from) where driver_id is not null
      do update set salary_sar = excluded.salary_sar;
    end if;
  else
    if new.monthly_salary_sar is not null then
      insert into public.salary_history (staff_id, effective_from, salary_sar, note)
      values (new.id, v_today, new.monthly_salary_sar, 'Recorded automatically on salary change.')
      on conflict (staff_id, effective_from) where staff_id is not null
      do update set salary_sar = excluded.salary_sar;
    end if;
  end if;
  return null;
end;
$$;

-- AFTER triggers: the base row is already written, and this writes elsewhere.
-- Two per table (0114's lesson: OLD is unavailable in an INSERT WHEN clause).
drop trigger if exists drivers_salary_history_ins on public.drivers;
create trigger drivers_salary_history_ins
  after insert on public.drivers
  for each row execute function public.record_salary_change();

drop trigger if exists drivers_salary_history_upd on public.drivers;
create trigger drivers_salary_history_upd
  after update on public.drivers
  for each row when (old.salary_sar is distinct from new.salary_sar)
  execute function public.record_salary_change();

drop trigger if exists staff_salary_history_ins on public.staff;
create trigger staff_salary_history_ins
  after insert on public.staff
  for each row execute function public.record_salary_change();

drop trigger if exists staff_salary_history_upd on public.staff;
create trigger staff_salary_history_upd
  after update on public.staff
  for each row when (old.monthly_salary_sar is distinct from new.monthly_salary_sar)
  execute function public.record_salary_change();

commit;

-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) THE PROOF THAT MATTERS: NO PAST MONTH MOVED. Capture BEFORE applying and
--    compare after — it must be byte-identical:
--      select to_char(m.month,'YYYY-MM') as month,
--             p.staff_salary_sar, p.driver_salary_sar, p.people_missing_salary,
--             n.payroll_sar, n.operating_cost_sar, n.operating_profit_sar, n.net_profit_sar
--        from public.v_report_months m
--        join public.v_payroll_monthly p on p.month = m.month
--        join public.v_pnl_monthly n on n.month = m.month
--       order by 1;
--      -- 2026-06  10,600.00 / 14,400.00 / 4 / 25,000.00 / 25,598.00 / -25,598.00 / -25,598.00
--      -- 2026-07  16,900.00 / 20,900.00 / 3 / 37,800.00 / 57,443.9700 / 13,206.0300 / 206.0300
--      -- 2026-08  16,900.00 / 14,400.00 / 3 / 31,300.00 / 59,900.0200 / -59,900.0200 / -59,900.0200
--      -- JUNE PAYROLL MUST READ 25,000.00. Anything else means the fallback in
--      -- section 3 is wrong and the forward-only rule is broken — REVERT.
--
-- B) THE FROZEN PAYSLIPS DID NOT MOVE. Expect the same two hashes:
--      select payslip_number, base_salary_sar, commission_sar, net_sar,
--             md5(row(payslip_number, period_start, base_salary_sar, commission_sar,
--                     specials_sar, adjustments_sar, bonus_sar, deductions_sar, net_sar)::text) as row_hash
--        from public.driver_payslips order by payslip_number;
--      -- PS-2026-000001  1,300.00 / 204.00 / 1,504.00  4c98509b50f2599dc65c797760d26aaa
--      -- PS-2026-000002  1,300.00 / 217.02 / 1,517.02  e27bcb32b466660a4b5265878325e42c
--
-- C) THE SEED IS COMPLETE AND FORWARD-ONLY. Expect 17 rows, all dated today:
--      select count(*) as rows,
--             count(*) filter (where driver_id is not null) as driver_rows,
--             count(*) filter (where staff_id is not null)  as staff_rows,
--             count(distinct effective_from) as distinct_dates,
--             min(effective_from) as seeded_on
--        from public.salary_history;
--      -- expect 17 (11 drivers + 6 staff), 1 distinct date = today Riyadh.
--
--      -- and nobody with a salary was missed:
--      select count(*) as drivers_with_salary_but_no_row
--        from public.drivers d
--       where d.salary_sar is not null
--         and not exists (select 1 from public.salary_history h where h.driver_id = d.id);
--      -- expect 0. Same query for staff/monthly_salary_sar.
--
-- D) THE VIEW'S SHAPE IS UNCHANGED — create-or-replace forbids anything else,
--    but prove the end state:
--      select ordinal_position, column_name, data_type
--        from information_schema.columns
--       where table_schema='public' and table_name='v_payroll_monthly'
--       order by ordinal_position;
--      -- expect month, staff_salary_sar, driver_salary_sar,
--      -- people_missing_salary, salary_is_current_snapshot — same order, same types.
--
-- E) SECURITY FOOTER RESTATED (section 6's standing lock):
--      select c.relname, c.reloptions,
--             has_table_privilege('anon', c.oid,'select')          as anon_can_read,
--             has_table_privilege('authenticated', c.oid,'select') as auth_can_read
--        from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where n.nspname='public' and c.relname='v_payroll_monthly';
--      -- expect {security_invoker=true}, anon FALSE, authenticated TRUE.
--
--      select count(*) as views,
--             count(*) filter (where 'security_invoker=true' = any(c.reloptions)) as invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid,'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where n.nspname='public' and c.relkind='v';
--      -- expect 40 / 40 / 0 — this migration adds no view.
--
--      -- and the new TABLE is RLS-protected:
--      select relrowsecurity from pg_class where relname = 'salary_history';
--      -- expect true.
--
-- F) THE TRIGGER WORKS, AND IS FORWARD-ONLY. Run inside a transaction and ROLL
--    BACK — this writes real salary data:
--      begin;
--        update public.drivers set salary_sar = salary_sar + 1
--         where id = (select id from public.drivers where salary_sar is not null limit 1);
--        select count(*) from public.salary_history;          -- expect 17 still
--                                                             -- (same-day upsert, not a new row)
--        select to_char(month,'YYYY-MM'), staff_salary_sar + driver_salary_sar
--          from public.v_payroll_monthly order by 1;
--        -- June and July MUST be unchanged; only the CURRENT month may move,
--        -- because the new row is effective today.
--      rollback;
--      -- CONFIRM the rollback: select count(*) from public.salary_history; -> 17
--
-- G) A FUTURE-DATED CHANGE APPLIES FORWARD ONLY. Same discipline — roll back:
--      begin;
--        insert into public.salary_history (driver_id, effective_from, salary_sar, note)
--        select id, date '2026-09-01', 9999, 'verification only'
--          from public.drivers where salary_sar is not null limit 1;
--        select to_char(month,'YYYY-MM'), driver_salary_sar
--          from public.v_payroll_monthly order by 1;
--        -- Jun/Jul/Aug all UNCHANGED (September is beyond every month end).
--      rollback;
-- ===========================================================================
