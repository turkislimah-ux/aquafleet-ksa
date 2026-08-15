-- 0115_driver_payslips.sql
-- Driver payslips: a numbered, frozen settlement document per driver per month.
--
-- DRAFTED TO DISK. NOT APPLIED. Architect reviews and runs this.
--
-- ===========================================================================
-- READ THIS FIRST — ONE MONEY DECISION NEEDS YOUR RULING AT REVIEW
-- ===========================================================================
-- The go-ahead said: "where a commission_payout exists for the driver+period,
-- the payslip's commission block IS that payout". Live data says that sentence
-- has no single obvious meaning, because a payout's period is NOT the period of
-- the work it pays for. Measured, not assumed — all six live payouts:
--
--   payout    label      base    trips  trip dates            months spanned
--   b0569442  Jul 2026   178.00     16  2026-06-27..06-30     1  (JUNE work)
--   25d339da  Jul 2026   300.00      9  2026-06-29..07-09     2  (SPANS Jun+Jul)
--   d05280b9  Jul 2026    26.00      2  2026-07-01            1
--   9b493894  Jul 2026   240.00      4  2026-07-03            1
--   07259e3c  Jun 2026     0.00      0  (none)                0  (specials only)
--   7dbbf494  Jun 2026     0.00      0  (none)                0  (specials only)
--
-- So, live and already true today:
--   · a payout labelled "Jul 2026" can pay for work done entirely in JUNE;
--   · a payout can span TWO calendar months;
--   · one driver+label can have MORE THAN ONE payout (d4f3fed1, Jul 2026 x2);
--   · a payout can lock ZERO trips (pure specials/adjustments/bonus).
--
-- Attributing a payout to a month by its TRIPS would split a single paid total
-- across two payslips — restating a payout that was paid once, as one amount.
-- Attributing it by parsing `period_label` puts June's work on a July slip
-- anyway, and does it by parsing free text.
--
-- THIS DRAFT ATTRIBUTES A PAYOUT TO THE CALENDAR MONTH OF ITS `paid_at`
-- (Asia/Riyadh). Reasons: a payslip is a SETTLEMENT document — it reports what
-- was settled in the period, the same way a real payslip carries last month's
-- overtime; `paid_at` is typed, so nothing can misparse; and it keeps a payout
-- whole, never split. It agrees with `period_label` on 6/6 live rows today, so
-- it changes no existing figure — it just cannot break the way parsing would.
--
-- THE CONSEQUENCE, WHICH MUST BE ACCEPTED DELIBERATELY: the work month and the
-- settlement month differ. A driver's June trips settled in July appear on the
-- JULY payslip. That is ordinary payroll behaviour, and the document says so —
-- but it is a money decision, not a technical one, so it is yours.
--
-- If you rule otherwise, only the RPC's predicate and the view's `paid_month`
-- expression change; the tables below are unaffected.
--
-- ===========================================================================
-- REQUIREMENT 1 — THE MATCHING PREDICATE, STATED PRECISELY
-- ===========================================================================
-- For a payslip covering driver D and month M (M = first day of the month):
--
--   MATCHED PAYOUTS := every row in commission_payouts where
--                        driver_id = D
--                    AND paid_at IS NOT NULL
--                    AND (paid_at AT TIME ZONE 'Asia/Riyadh')::date
--                          BETWEEN M AND (M + 1 month - 1 day)
--
-- · NO payout matched  -> basis = 'earned'. The commission block is the ACCRUAL
--   for that month, and counts ONLY trips not already locked to a payout
--   (`payout_id IS NULL`). That exclusion is what makes a trip's commission
--   appear on AT MOST ONE payslip ever — see the invariant in the verification
--   block. Specials/adjustments/bonus use the same predicates
--   `v_commissions_monthly` already uses (status/bonus_status = 'approved',
--   month_key = to_char(M,'YYYY-MM')), so a payslip cannot disagree with the
--   P&L about what those words mean.
--
-- · EXACTLY ONE payout matched -> basis = 'paid'. The block IS that payout:
--   its own base/specials/adjustments/bonus/total columns, referenced by id.
--   Nothing is recomputed and nothing is added on top — a payout ALREADY
--   contains specials, adjustments and bonus, so adding the month's approved
--   rows again would double-count them.
--
-- · MORE THAN ONE payout matched -> basis = 'paid', and the block is the SUM of
--   them, every id recorded in driver_payslip_payouts. This is NOT a
--   hypothetical: driver d4f3fed1 has two payouts settled in Jul 2026 (178.00
--   and 26.00), four minutes apart, locking different trips. Both are real cash
--   events for the same driver in the same month; taking only the latest would
--   silently drop 26.00, and taking the first would drop 178.00. Summing is the
--   only reading that pays the driver what he was actually paid.
--
-- · PAYOUT WHOSE WORK PERIOD DOES NOT ALIGN TO THE MONTH -> it still belongs to
--   the month it was SETTLED in, whole. The payslip does not attempt to split
--   it, and the snapshot records the trip date range it covered so the document
--   can say "includes work from 27 Jun – 9 Jul" rather than implying the work
--   happened in the settlement month.
--
-- · PAYOUT WITH paid_at IS NULL -> not settled, so not matched, and it does not
--   suppress the accrual basis. (No such row exists today; all six are paid.)
--
-- ===========================================================================
-- REQUIREMENT 2 — ISSUED ON ACCRUAL, THEN A PAYOUT ARRIVES LATER
-- ===========================================================================
-- ACCEPTED, NOT PREVENTED — and made evident on the document.
--
-- A payslip issued for August on the 'earned' basis freezes an accrual figure.
-- If those trips are later settled by a September payout, September's payslip
-- reports them on the 'paid' basis. The same riyals therefore appear as EARNED
-- on one document and as PAID on another.
--
-- That is not double payment and must not be presented as a correction:
-- earning and being paid are two different events, and a payslip is a record of
-- one period. Preventing it would mean either withholding earned commission
-- from the document (the driver's slip would read 0 for a month he worked) or
-- retroactively rewriting an issued document (which defeats the freeze).
--
-- So the document carries its basis explicitly:
--   · basis 'earned'  -> labelled as EARNED, NOT YET PAID, with the sentence
--     that it will appear again as PAID on the payslip for the period in which
--     it is settled. `commission_settled` is FALSE.
--   · basis 'paid'    -> labelled as PAID, listing the payout number/date, with
--     the covered work-date range from the snapshot.
--
-- `commission_settled` is stored, not derived, so a reader of an old slip sees
-- what was true when it was issued. A future feature that wants to reconcile
-- the two can join driver_payslip_payouts and the snapshot's trip ids; nothing
-- here blocks that, and nothing here does it silently.
--
-- ===========================================================================
-- REQUIREMENT 3 (ADDED AT REVIEW) — DRIVERS WITH NO HIRE DATE
-- ===========================================================================
-- THE FIRST DRAFT OF THIS FILE CARRIED A FALSE FACT, and it is recorded here
-- rather than quietly corrected, because the mistake was in the METHOD.
--
-- It claimed: "all 11 live drivers have a real hire_date (verified), so no
-- 1900-01-01 fallback is needed or wanted." That 11 came from a query filtered
-- to `terminated_at is null`, and was then written up as if it described every
-- driver. The view does not filter that way. THE REAL FIGURES:
--
--   drivers total                          16
--   terminated                              5
--   hire_date IS NULL                       5   <- the same five
--   hire_date IS NULL and still active      0
--   salary_sar IS NULL                      0
--
-- All five carry salary 1,300.00 and were terminated 3-4 Jul 2026, so the
-- termination clause admits them for BOTH June and July. With the old
-- `coalesce(hire_date, m.month)` reading them as employed, a user could have
-- issued TEN permanent, numbered 1,300 SAR settlement documents to drivers who
-- had left. Verification blocks A-J all missed it because every one of them
-- reasoned about the 11 active drivers the header had assumed — the checks
-- inherited the wrong premise from the prose above them.
--
-- THE RULE (ruled by Turki): a driver with hire_date IS NULL is SHOWN on the
-- payslips surface but CANNOT be issued a payslip until a hire date is set.
--   · NOT excluded — a terminated driver must not silently vanish from history.
--   · NOT defaulted — no 1900 fallback, no fabricated date. A start date we do
--     not have is not a start date we may invent.
--
-- HOW IT IS IMPLEMENTED, in three places that must agree:
--   1. The WHERE clause admits `hire_date is null` EXPLICITLY. Removing the
--      coalesce alone would have DROPPED these rows (`NULL <= date` is NULL,
--      not true), which breaks the "shown" half of the ruling as surely as the
--      coalesce broke the "not issuable" half.
--   2. The view exposes `hire_date_missing` as a REAL COLUMN, mirroring
--      `salary_missing` — never re-derived at a call site.
--   3. `issue_driver_payslip` RAISES 23514 on it, before a number is consumed.
--      The flag is for the UI; the raise is the enforcement. A rule deciding
--      whether a numbered money document exists cannot live in a disabled
--      button.
--
-- ===========================================================================
-- WHAT THIS MIGRATION DOES NOT DO
-- ===========================================================================
-- · No customer money. lib/prepaid.ts, lib/vat.ts and invoice math are not
--   involved and must never be — driver pay is not customer money, and there is
--   no VAT on a payslip.
-- · No commission math. Every commission figure is READ from an existing
--   source (commission_payouts columns, or the same accrual predicates
--   v_commissions_monthly already uses). Nothing here re-derives a rate.
-- · No salary history. Ruled: snapshot-at-issue. An UNISSUED past month
--   computes at today's salary and the UI says so; issuing freezes it.
--   Effective-dated salary stays deferred.
-- · No deductions source. `deductions_sar` ships as a real column defaulting to
--   0 so the document's arithmetic is complete and adding a deductions feature
--   later changes no issued slip.
-- · No approval step. Ruled: issue is a single action. Approval stays deferred
--   with RBAC.
-- · Deletes nothing. The 3 commission_periods rows with NULL month_key are
--   EXCLUDED BY PREDICATE (`month_key IS NOT NULL`), never removed.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. GAP-FREE PAYSLIP NUMBERS — the counter-table pattern (0034/0050).
--    A payslip is a numbered document handed to a person, so a gap looks like a
--    missing payment. NEVER generate this client-side: count+1 is a race.
-- ---------------------------------------------------------------------------
create table if not exists public.payslip_number_counter (
  year        integer primary key,
  last_number integer not null default 0
);

alter table public.payslip_number_counter enable row level security;

create or replace function public.next_payslip_number(p_year integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  -- Lock the year's row FOR UPDATE, then increment. Rolls back with the
  -- transaction, so the sequence is truly gap-free rather than merely unique.
  insert into public.payslip_number_counter (year, last_number)
  values (p_year, 0)
  on conflict (year) do nothing;

  select last_number + 1 into v_next
    from public.payslip_number_counter
   where year = p_year
     for update;

  update public.payslip_number_counter
     set last_number = v_next
   where year = p_year;

  -- PS-2026-000001
  return 'PS-' || p_year::text || '-' || lpad(v_next::text, 6, '0');
end;
$$;

comment on function public.next_payslip_number(integer) is
  'Gap-free per-year payslip number (PS-YYYY-NNNNNN). Locks the counter row '
  'FOR UPDATE; rolls back with the transaction. Same pattern as '
  'next_invoice_number (0034) and next_po_number (0050).';

-- ---------------------------------------------------------------------------
-- 2. THE FROZEN DOCUMENT.
--    Only ISSUED payslips exist as rows. An unissued month is computed live
--    from the view below — there is no draft state, because issue is a single
--    action and a draft nobody can approve is a state with no transition.
-- ---------------------------------------------------------------------------
create table if not exists public.driver_payslips (
  id                uuid primary key default gen_random_uuid(),
  payslip_number    text        not null unique,
  driver_id         uuid        not null references public.drivers(id) on delete restrict,
  period_start      date        not null,

  issued_at         timestamptz not null default now(),
  issued_by         text        not null,

  -- WHICH BASIS THE COMMISSION BLOCK USED, stored not derived, so an old slip
  -- reads as it did on the day it was issued. See REQUIREMENT 2.
  commission_basis  text        not null
                    check (commission_basis in ('paid','earned','none')),
  commission_settled boolean    not null,

  -- FROZEN MONEY. Every figure is what it was at issue.
  base_salary_sar   numeric(12,2) not null,
  commission_sar    numeric(12,2) not null,   -- base/trip commission component
  specials_sar      numeric(12,2) not null default 0,
  adjustments_sar   numeric(12,2) not null default 0,
  bonus_sar         numeric(12,2) not null default 0,
  deductions_sar    numeric(12,2) not null default 0,
  net_sar           numeric(12,2) not null,

  -- Driver name, salary at issue, the covered trip ids and work-date range,
  -- payout numbers/dates — everything the printed document needs without
  -- re-reading tables that will have moved on.
  snapshot          jsonb       not null,
  created_at        timestamptz not null default now(),

  -- ONE payslip per driver per month. The document is the settlement record for
  -- that period; a second one would mean two records of the same settlement.
  constraint driver_payslips_one_per_driver_month unique (driver_id, period_start),
  -- period_start must be the first day of a month.
  constraint driver_payslips_period_is_month_start
    check (period_start = date_trunc('month', period_start)::date),
  -- ADJUSTMENTS AND PAYOUT TOTALS CAN BE NEGATIVE (live: one payout totals
  -- -140.00), so net is NOT constrained to be positive. Only the components
  -- that cannot meaningfully be negative are guarded.
  constraint driver_payslips_nonneg_inputs
    check (base_salary_sar >= 0 and deductions_sar >= 0)
);

alter table public.driver_payslips enable row level security;

create policy authenticated_all_driver_payslips on public.driver_payslips
  for all to authenticated using (true) with check (true);

create index if not exists driver_payslips_driver_period_idx
  on public.driver_payslips (driver_id, period_start desc);
create index if not exists driver_payslips_period_idx
  on public.driver_payslips (period_start desc);

comment on table public.driver_payslips is
  'A frozen, numbered settlement document per driver per month. Only ISSUED '
  'slips are rows; an unissued month is computed live from '
  'v_driver_payslip_basis. Salary is snapshot-at-issue (effective-dated salary '
  'is deferred), so an issued slip never changes when a salary changes. '
  'net_sar may be negative because commission adjustments may be.';

-- ---------------------------------------------------------------------------
-- 3. WHICH PAYOUTS A SLIP SETTLED. A real FK, not a jsonb list, because this is
--    the link that proves the payslip did not invent its commission figure.
--    Many-to-one: a month can settle several payouts (live: it already does).
-- ---------------------------------------------------------------------------
create table if not exists public.driver_payslip_payouts (
  payslip_id uuid not null references public.driver_payslips(id) on delete cascade,
  payout_id  uuid not null references public.commission_payouts(id) on delete restrict,
  primary key (payslip_id, payout_id)
);

alter table public.driver_payslip_payouts enable row level security;

create policy authenticated_all_driver_payslip_payouts on public.driver_payslip_payouts
  for all to authenticated using (true) with check (true);

comment on table public.driver_payslip_payouts is
  'Join: which commission_payouts a payslip settled. ON DELETE RESTRICT on the '
  'payout — an issued payslip references it as evidence, so the payout cannot '
  'vanish underneath a document that was handed to someone.';

-- ---------------------------------------------------------------------------
-- 4. THE SEMANTIC LAYER (0098): the basis for a payslip, DEFINED ONCE IN SQL.
--    The page reads this and never re-derives it; the RPC freezes from the same
--    view, so a preview and the document it becomes cannot disagree.
--
--    Grain: one row per LIVE driver per report month.
-- ---------------------------------------------------------------------------
create or replace view public.v_driver_payslip_basis
with (security_invoker = true) as
with months as (
  select month from public.v_report_months
),
live_drivers as (
  -- Employment window is historical even though salary is not: a driver is on
  -- the payroll for a month only if hired by its end and not terminated before
  -- its start.
  --
  -- THIS VIEW SEES ALL 16 DRIVERS, NOT THE 11 ACTIVE ONES. An earlier draft of
  -- this file claimed "all 11 live drivers have a real hire_date" — that figure
  -- came from a query filtered to `terminated_at is null` and was then written
  -- up as if it described every driver. Live: 16 drivers, 5 terminated, and
  -- 5 with hire_date IS NULL — the SAME five. No active driver is missing one.
  --
  -- Those five carry salary 1,300.00 each and were terminated 3-4 Jul 2026, so
  -- the termination clause admits them for BOTH Jun and Jul. Under the old
  -- `coalesce(hire_date, m.month)` they read as "employed as of the start of
  -- every month", which would have let a user issue ten permanent, numbered
  -- 1,300 SAR settlement documents to drivers who had left.
  select d.id, d.name, d.salary_sar, d.hire_date, d.terminated_at
    from public.drivers d
),
matched_payouts as (
  -- THE MATCHING PREDICATE (see REQUIREMENT 1). Settlement month, Riyadh.
  select p.driver_id,
         date_trunc('month', (p.paid_at at time zone 'Asia/Riyadh'))::date as month,
         count(*)                     as payout_count,
         sum(p.base_sar)              as base_sar,
         sum(p.specials_sar)          as specials_sar,
         sum(p.adjustments_sar)       as adjustments_sar,
         sum(p.bonus_sar)             as bonus_sar,
         sum(p.total_sar)             as total_sar
    from public.commission_payouts p
   where p.paid_at is not null
   group by 1, 2
)
select
  m.month                                        as period_start,
  d.id                                           as driver_id,
  d.name                                         as driver_name,

  -- SALARY. Current value — snapshot-at-issue means the FREEZE happens when the
  -- slip is issued, not here. A month before hire or after termination is 0.
  --
  -- NO COALESCE ON hire_date. A NULL hire date falls through to the driver's
  -- salary rather than to 0: the figure IS their salary, and suppressing it
  -- would misrepresent the row as "worked, earned nothing" instead of "start
  -- date unknown". The row cannot become a document — hire_date_missing below
  -- blocks it in the UI and issue_driver_payslip refuses it outright — so a
  -- shown figure here can never turn into a false settlement.
  case
    when d.hire_date is not null
     and d.hire_date > (m.month + interval '1 month' - interval '1 day')::date
      then 0::numeric
    when d.terminated_at is not null and (d.terminated_at at time zone 'Asia/Riyadh')::date < m.month
      then 0::numeric
    else coalesce(d.salary_sar, 0)
  end                                            as base_salary_sar,
  (d.salary_sar is null)                         as salary_missing,

  -- NOT ISSUABLE: hire_date is unknown, so the employment window cannot be
  -- established and no settlement document may be created. A real column,
  -- mirroring salary_missing — never re-derived at a call site, because a rule
  -- that decides whether money can be printed must have exactly one definition.
  (d.hire_date is null)                          as hire_date_missing,

  -- BASIS.
  case when mp.driver_id is not null then 'paid' else 'earned' end as commission_basis,
  (mp.driver_id is not null)                     as commission_settled,
  coalesce(mp.payout_count, 0)                   as payout_count,

  -- COMMISSION COMPONENTS.
  -- PAID: read straight off the payouts, which already contain specials,
  -- adjustments and bonus — nothing is added on top or the same money counts
  -- twice. EARNED: the accrual, using v_commissions_monthly's own predicates so
  -- the two cannot mean different things by the same word.
  case when mp.driver_id is not null then mp.base_sar else coalesce((
    select sum(t.commission_sar) from public.trips t
     where t.driver_id = d.id
       and t.stage = 'delivered'
       and t.payout_id is null           -- NEVER an already-settled trip
       and date_trunc('month', t.trip_date)::date = m.month
  ), 0) end                                      as commission_sar,

  case when mp.driver_id is not null then mp.specials_sar else coalesce((
    select sum(cs.amount_sar) from public.commission_specials cs
     where cs.driver_id = d.id
       and cs.status = 'approved'
       and cs.payout_id is null
       and cs.month_key = to_char(m.month, 'YYYY-MM')
  ), 0) end                                      as specials_sar,

  case when mp.driver_id is not null then mp.adjustments_sar else coalesce((
    select sum(ca.amount_sar) from public.commission_adjustments ca
     where ca.driver_id = d.id
       and ca.status = 'approved'
       and ca.payout_id is null
       and ca.month_key = to_char(m.month, 'YYYY-MM')
  ), 0) end                                      as adjustments_sar,

  case when mp.driver_id is not null then mp.bonus_sar else coalesce((
    select sum(cp.bonus_sar) from public.commission_periods cp
     where cp.driver_id = d.id
       and cp.bonus_status = 'approved'
       and cp.month_key is not null      -- RULED: exclude the 3 NULL rows,
       and cp.month_key = to_char(m.month, 'YYYY-MM')  -- never delete them
  ), 0) end                                      as bonus_sar,

  -- Already-issued slip for this driver+month, if any. Lets the UI show the
  -- frozen document instead of a live recomputation without a second query.
  ps.id                                          as issued_payslip_id,
  ps.payslip_number                              as issued_payslip_number
from months m
cross join live_drivers d
left join matched_payouts mp
       on mp.driver_id = d.id and mp.month = m.month
left join public.driver_payslips ps
       on ps.driver_id = d.id and ps.period_start = m.month
-- Off the payroll entirely for this month: hired later, or terminated earlier.
--
-- THE NULL hire_date BRANCH IS DELIBERATE AND IS NOT A COALESCE IN DISGUISE.
-- Ruling: a driver with no hire date is SHOWN but CANNOT be issued a payslip.
-- Dropping the coalesce alone would have dropped those rows from the view
-- entirely — `NULL <= date` is NULL, not true, so the WHERE would reject them
-- and a terminated driver would silently vanish from history, which the ruling
-- forbids just as firmly as fabricating a date does.
--
-- So the NULL case is admitted EXPLICITLY. The difference from the old
-- coalesce is not cosmetic: `coalesce(hire_date, m.month)` ASSERTED an
-- employment fact ("hired by the start of this month") from no data, while
-- `hire_date is null or ...` ADMITS THE UNKNOWN — it says only that this month
-- cannot be ruled out, and the row carries hire_date_missing = true so nothing
-- downstream can read it as verified employment.
--
-- CONSEQUENCE, STATED RATHER THAN HIDDEN: with hire_date unknown the window has
-- NO LOWER BOUND. Only terminated_at closes it from above, so those five
-- drivers appear for every report month up to their termination month (Jun and
-- Jul today). That is the honest shape of the data — we do not know when they
-- started — and it is harmless because issue refuses them.
where (d.hire_date is null
       or d.hire_date <= (m.month + interval '1 month' - interval '1 day')::date)
  and (d.terminated_at is null
       or (d.terminated_at at time zone 'Asia/Riyadh')::date >= m.month);

comment on view public.v_driver_payslip_basis is
  'One row per live driver per report month: the salary and commission a '
  'payslip would carry. THE PAGE READS THIS AND NEVER RE-DERIVES IT (0098), and '
  'issue_driver_payslip freezes from this same view so a preview and the '
  'document it becomes cannot disagree. commission_basis is paid when a payout '
  'was SETTLED in the month (by paid_at, Asia/Riyadh) and earned otherwise; on '
  'the earned basis only trips with payout_id IS NULL are counted, which is '
  'what stops a trip appearing on two payslips. Covers ALL drivers including '
  'terminated ones, so history does not vanish. A driver with hire_date IS NULL '
  'is SHOWN with hire_date_missing = true and CANNOT be issued a payslip — '
  'issue_driver_payslip refuses it; the flag is the UI''s copy of that rule, '
  'not the rule itself.';

alter view public.v_driver_payslip_basis set (security_invoker = true);
revoke all on public.v_driver_payslip_basis from anon;
grant select on public.v_driver_payslip_basis to authenticated;

-- ---------------------------------------------------------------------------
-- 5. ISSUE — the single action. Freezes the document and assigns its number.
--    Exactly one signature; SECURITY DEFINER; search_path pinned.
-- ---------------------------------------------------------------------------
drop function if exists public.issue_driver_payslip(uuid, date, text);

create or replace function public.issue_driver_payslip(
  p_driver_id    uuid,
  p_period_start date,
  p_actor        text
)
returns public.driver_payslips
language plpgsql
security definer
set search_path = public
as $$
declare
  v_basis   record;
  v_row     public.driver_payslips;
  v_number  text;
  v_snap    jsonb;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'An actor is required to issue a payslip.' using errcode = '23514';
  end if;
  if p_period_start <> date_trunc('month', p_period_start)::date then
    raise exception 'A payslip period must start on the first day of a month.'
      using errcode = '23514';
  end if;
  -- A month still running has not finished accruing. Issuing it would freeze a
  -- partial figure into a document that claims to be the month's settlement.
  if p_period_start >= date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date then
    raise exception 'That month has not finished yet — a payslip can only be issued for a completed month.'
      using errcode = '23514';
  end if;

  -- Lock the driver row so two concurrent issues cannot both pass the
  -- not-yet-issued check below (the unique constraint is the backstop; this
  -- makes the friendly error the normal path rather than a constraint string).
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

  -- NO HIRE DATE, NO DOCUMENT. The employment window cannot be established, so
  -- there is no defensible period for a settlement to cover. Live, all five
  -- drivers in this state are TERMINATED and carry a 1,300.00 salary, and the
  -- earlier draft would have let a user issue them ten permanent, numbered
  -- payslips for months after they had left.
  --
  -- ENFORCED HERE, NOT ONLY IN THE UI. The view's hire_date_missing flag lets
  -- the page disable the button, but a server action, a psql session or a future
  -- caller reaches this function directly — and a rule that decides whether a
  -- numbered money document exists cannot live only in a button's disabled
  -- state. Checked BEFORE next_payslip_number so a refused issue never consumes
  -- a number.
  if v_basis.hire_date_missing then
    raise exception 'This driver has no hire date, so a payslip period cannot be established. Set the hire date first.'
      using errcode = '23514';
  end if;

  v_number := public.next_payslip_number(extract(year from p_period_start)::int);

  -- The snapshot carries what the printed document needs, so it never has to
  -- re-read tables that will have moved on: who, at what salary, which payouts
  -- (with their own numbers and dates), and which trips the commission covered
  -- including their real work-date range — that range is how a 'paid' slip can
  -- say "includes work from 27 Jun" instead of implying the work happened in
  -- the settlement month.
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
    'issued_from', 'v_driver_payslip_basis'
  ) into v_snap;

  insert into public.driver_payslips (
    payslip_number, driver_id, period_start, issued_by,
    commission_basis, commission_settled,
    base_salary_sar, commission_sar, specials_sar, adjustments_sar, bonus_sar,
    deductions_sar, net_sar, snapshot
  ) values (
    v_number, p_driver_id, p_period_start, p_actor,
    v_basis.commission_basis, v_basis.commission_settled,
    v_basis.base_salary_sar, v_basis.commission_sar, v_basis.specials_sar,
    v_basis.adjustments_sar, v_basis.bonus_sar,
    0,
    -- NET. deductions_sar is 0 until a deductions source exists; it is in the
    -- arithmetic now so adding one later changes no issued slip.
    v_basis.base_salary_sar + v_basis.commission_sar + v_basis.specials_sar
      + v_basis.adjustments_sar + v_basis.bonus_sar - 0,
    v_snap
  ) returning * into v_row;

  -- Record the evidence link for every payout this slip settled.
  insert into public.driver_payslip_payouts (payslip_id, payout_id)
  select v_row.id, p.id
    from public.commission_payouts p
   where p.driver_id = p_driver_id
     and p.paid_at is not null
     and date_trunc('month', (p.paid_at at time zone 'Asia/Riyadh'))::date = p_period_start;

  return v_row;
end;
$$;

comment on function public.issue_driver_payslip(uuid, date, text) is
  'Issues (freezes) a driver payslip for a completed month and assigns its '
  'gap-free number. Reads v_driver_payslip_basis — the same view the preview '
  'reads — so the document equals what was on screen. Refuses a running month, '
  'a duplicate, and a driver not on the payroll that month. Writes no '
  'commission math: every figure is read from an existing source.';

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) OBJECTS AND SECURITY.
--      select c.relname, c.relrowsecurity,
--             has_table_privilege('anon','public.'||c.relname,'select') as anon
--        from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where n.nspname='public'
--         and c.relname in ('driver_payslips','driver_payslip_payouts','payslip_number_counter');
--      -- expect relrowsecurity = true on all three, anon = false.
--
--      select c.relname, c.reloptions,
--             has_table_privilege('anon','public.v_driver_payslip_basis','select') as anon
--        from pg_class c join pg_namespace n on n.oid=c.relnamespace
--       where n.nspname='public' and c.relname='v_driver_payslip_basis';
--      -- expect {security_invoker=true} and anon = false.
--
--      select p.proname, p.prosecdef, p.proconfig, count(*) over (partition by p.proname) as signatures
--        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--       where n.nspname='public' and p.proname in ('issue_driver_payslip','next_payslip_number');
--      -- expect prosecdef true, proconfig {search_path=public}, ONE signature each.
--
--    THE DRIVER SET THIS VIEW COVERS IS 16, NOT 11. Every block below is
--    premised on the full table — the first draft's blocks were premised on the
--    11 active drivers and that is exactly why none of them caught the
--    terminated-driver defect. Confirm the premise before trusting the checks:
--      select count(*) total,
--             count(*) filter (where terminated_at is not null) terminated,
--             count(*) filter (where hire_date is null) null_hire
--        from public.drivers;
--      -- expect 16 / 5 / 5.
--
-- B) THE VIEW AGREES WITH THE LIVE PAYOUTS. Expect 0 rows:
--      select b.period_start, b.driver_name, b.payout_count, b.commission_basis
--        from public.v_driver_payslip_basis b
--       where (b.payout_count > 0) <> (b.commission_basis = 'paid');
--
--    And the view must cover terminated drivers too, not just the active 11:
--      select count(distinct driver_id) as drivers_visible
--        from public.v_driver_payslip_basis;
--      -- expect MORE than 11 (today 16 appear in at least one month), because
--      -- a terminated driver's history must not vanish. If this reads 11, the
--      -- employment-window filter has started dropping them again.
--
-- C) THE MULTI-PAYOUT CASE IS SUMMED, NOT DROPPED. Driver d4f3fed1 has two
--    payouts settled in Jul 2026 (178.00 + 26.00 base):
--      select driver_name, period_start, payout_count, commission_sar, specials_sar,
--             adjustments_sar, bonus_sar
--        from public.v_driver_payslip_basis
--       where driver_id = 'd4f3fed1-7175-440b-aded-d0d79f7fc0c9'
--         and period_start = date '2026-07-01';
--      -- expect payout_count = 2 and commission_sar = 204.00 (178 + 26).
--      -- 178.00 or 26.00 alone means one real payment was dropped.
--
-- D) THE JUNE PAYOUTS THAT LOCKED NO TRIPS still produce a paid basis, because
--    a specials/adjustments/bonus payout is still a settlement:
--      select driver_name, period_start, commission_basis, commission_sar,
--             specials_sar, adjustments_sar, bonus_sar
--        from public.v_driver_payslip_basis
--       where period_start = date '2026-06-01' and payout_count > 0;
--      -- expect commission_basis 'paid', commission_sar 0.00, and the
--      -- specials/adjustments/bonus carrying the money (one totals -140.00).
--
-- E) THE INVARIANT THAT MATTERS MOST — a trip's commission can never reach two
--    payslips. Nothing to check until slips exist; after issuing some, expect
--    0 rows:
--      select t.id, count(*) as on_n_payslips
--        from public.trips t
--        join public.driver_payslips ps
--          on ps.snapshot -> 'covered_trips' -> 'ids' @> to_jsonb(t.id)
--       group by t.id having count(*) > 1;
--
-- F) THE 3 MALFORMED commission_periods ROWS ARE EXCLUDED, NOT DELETED:
--      select count(*) as still_present from public.commission_periods where month_key is null;
--      -- expect 3 — they must survive this migration untouched.
--      select count(*) as leaked from public.v_driver_payslip_basis where bonus_sar is null;
--      -- expect 0 — a NULL month_key can never match a month, and coalesce
--      -- keeps the column non-null regardless.
--
-- G) NUMBERING IS GAP-FREE AND LOCKED. In a transaction you roll back:
--      begin;
--        select public.next_payslip_number(2026);  -- PS-2026-000001
--        select public.next_payslip_number(2026);  -- PS-2026-000002
--      rollback;
--      select * from public.payslip_number_counter;
--      -- expect NO row for 2026 (or last_number unchanged) — the counter must
--      -- roll back with the transaction, which is what makes it gap-free
--      -- rather than merely unique.
--
-- H) ISSUE REFUSES A RUNNING MONTH:
--      begin;
--        select public.issue_driver_payslip(
--          (select id from public.drivers where terminated_at is null limit 1),
--          date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date,
--          'verify@aquafleet');
--      rollback;
--      -- expect: ERROR ... 'That month has not finished yet' (23514).
--
-- I) A REAL ISSUE, ROLLED BACK — proves the freeze equals the preview:
--      begin;
--        select b.commission_basis, b.base_salary_sar, b.commission_sar
--          from public.v_driver_payslip_basis b
--         where b.driver_id = 'd4f3fed1-7175-440b-aded-d0d79f7fc0c9'
--           and b.period_start = date '2026-07-01';
--        select payslip_number, commission_basis, base_salary_sar, commission_sar,
--               specials_sar, adjustments_sar, bonus_sar, net_sar
--          from public.issue_driver_payslip(
--                 'd4f3fed1-7175-440b-aded-d0d79f7fc0c9', date '2026-07-01',
--                 'verify@aquafleet');
--        select count(*) as payout_links from public.driver_payslip_payouts;
--      rollback;
--      -- expect the frozen figures to equal the view's, payslip_number
--      -- PS-2026-000001, and payout_links = 2 (both July payouts recorded).
--
-- K) THE DEFECT THIS REVIEW CAUGHT — shown, but refused. Both halves matter;
--    checking only one of them is how the first draft passed its own review.
--
--    K1 — SHOWN. The five NULL-hire (all terminated) drivers must appear, with
--    the flag set, for the months up to their termination:
--      select b.driver_name, b.period_start, b.base_salary_sar,
--             b.hire_date_missing, b.commission_basis
--        from public.v_driver_payslip_basis b
--        join public.drivers d on d.id = b.driver_id
--       where d.hire_date is null
--       order by b.driver_name, b.period_start;
--      -- expect 10 rows (5 drivers x Jun + Jul), every one hire_date_missing
--      -- = true, salary 1,300.00, and NONE for Aug (all terminated 3-4 Jul).
--      -- ZERO rows here means the WHERE clause is dropping them and the
--      -- "shown" half of the ruling is broken.
--
--    K2 — REFUSED. The same driver cannot be issued a document:
--      begin;
--        select public.issue_driver_payslip(
--          (select id from public.drivers where hire_date is null limit 1),
--          date '2026-06-01',
--          'verify@aquafleet');
--      rollback;
--      -- expect: ERROR ... 'This driver has no hire date, so a payslip period
--      -- cannot be established. Set the hire date first.'  SQLSTATE 23514.
--      -- A returned payslip row here is the original defect, live.
--
--    K3 — THE REFUSAL CONSUMES NO NUMBER. The guard sits before
--    next_payslip_number precisely so a blocked issue cannot burn one:
--      select coalesce(max(last_number), 0) from public.payslip_number_counter
--       where year = 2026;
--      -- run before K2 and after it; the two must be EQUAL. A gap-free counter
--      -- that advances on a refusal is no longer gap-free.
--
--    K4 — A DRIVER WITH A HIRE DATE IS UNAFFECTED. The guard must block only
--    the missing-date case, not tighten issue generally:
--      select count(*) as issuable_rows
--        from public.v_driver_payslip_basis
--       where not hire_date_missing and period_start = date '2026-07-01';
--      -- expect 11 (the active drivers, all of whom have hire dates).
--
-- J) NOTHING ELSE MOVED. This migration adds objects; it writes to no existing
--    table:
--      select count(*) from public.commission_payouts;      -- expect 6
--      select count(*) from public.commission_periods;      -- expect 3
--      select to_char(month,'YYYY-MM'), filling_cost_sar, operating_cost_sar
--        from public.v_pnl_monthly order by month;
--      -- expect identical to the pre-apply figures. The P&L does not know
--      -- payslips exist, and must not: payroll is already in it via
--      -- v_payroll_monthly, and a payslip is a document, not a second cost.
-- ===========================================================================
