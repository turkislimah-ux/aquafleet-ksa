-- ============================================================================
-- 0208_ledger_entry_date.sql — THE DATE A TOP-UP HAPPENED
-- ============================================================================
-- Rulings (Turki):
--   * A top-up is recorded ON THE DATE HE PICKS. Any date is allowed,
--     including a future one — this is a record of when money changed hands,
--     not a scheduling mechanism.
--   * BALANCE AND AVAILABLE MUST NOT CHANGE AT ALL. They keep summing every
--     ledger row regardless of date, exactly as they do today. The date is a
--     RECORD AND DISPLAY fact and nothing else.
--
-- WHAT THAT SECOND RULING MEANS IN PRACTICE, because it is the whole risk
-- here: a dated ledger invites a dated balance ("as of"), and the moment one
-- exists the app has two balances that disagree on any day a back-dated row
-- sits on. v_customer_ledger_balance and v_customer_available are NOT touched
-- by this migration, carry no date predicate, and §4 asserts their definitions
-- never mention entry_date. A back-dated or future-dated top-up moves Balance
-- and Available the instant it is written, by exactly its amount.
--
-- THE APPEND-ONLY QUESTION, ANSWERED BEFORE THE BACKFILL WAS WRITTEN.
-- customer_ledger has NO trigger and NO rule — measured, not assumed:
--   select ... from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where c.relname = 'customer_ledger' and not t.tgisinternal;   -> 0 rows
-- Its immutability is a GRANT fact. `authenticated` holds SELECT only
-- (REFERENCES/TRIGGER/TRUNCATE aside); INSERT, UPDATE and DELETE are held by
-- postgres and service_role alone, which is why every write goes through a
-- SECURITY DEFINER RPC. A migration runs as the owner, so the backfill UPDATE
-- below needs no guard lifted, no trigger disabled and no grant widened —
-- nothing is weakened here, permanently or temporarily. RLS is enabled with a
-- single SELECT policy and is bypassed by the owner as usual.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. customer_ledger.entry_date — the day the money moved
-- ----------------------------------------------------------------------------
-- Added nullable, backfilled, then constrained: a NOT NULL column with a
-- default would have back-filled every existing row with TODAY, dating 23 real
-- rows to the migration instead of to when they happened.
--
-- THE BACKFILL IS THE ROW'S OWN created_at, read in Riyadh terms — the same
-- conversion every other date surface in this app uses (todayKey(), the
-- monthly views, the statement's date column). Before this column existed,
-- created_at WAS the date every screen displayed, so this preserves exactly
-- what the app has been showing rather than inventing a new history.

alter table public.customer_ledger add column entry_date date;

update public.customer_ledger
   set entry_date = (created_at at time zone 'Asia/Riyadh')::date
 where entry_date is null;

alter table public.customer_ledger
  alter column entry_date set not null,
  alter column entry_date set default (now() at time zone 'Asia/Riyadh')::date;

comment on column public.customer_ledger.entry_date is
  'The day the money moved, as recorded by the operator (0208). Any date is '
  'allowed, including a future one. DISPLAY AND ORDERING ONLY — no balance '
  'reads it: v_customer_ledger_balance and v_customer_available sum every row '
  'regardless of date, so a back-dated row moves them immediately and in full.';

-- ----------------------------------------------------------------------------
-- 2. record_topup — one new trailing parameter, everything else verbatim
-- ----------------------------------------------------------------------------
-- p_entry_date is LAST and defaults to null, so a caller that has not been
-- updated behaves exactly as before: null resolves to today in Riyadh, which
-- is what the column default would have given it anyway.
--
-- NO VALIDATION ON THE DATE, deliberately. A future date is legal (Turki's
-- ruling) and a very old one is a correction of an old record; refusing either
-- would be this function inventing a policy nobody asked for. The column type
-- rejects anything that is not a date, which is the only check that belongs
-- here.
--
-- THE OTHER LEDGER WRITERS ARE NOT TOUCHED (record_refund,
-- apply_balance_to_invoice, vote_ledger_correction, void_invoice). They take
-- the column default — today — which is exactly right: a refund, a draw and a
-- reversal happen when the RPC runs, not on a day somebody types in.

drop function if exists public.record_topup(uuid, numeric, text, text, text, text, text);

create function public.record_topup(
  p_customer_id uuid,
  p_amount      numeric,
  p_method      text,
  p_reference   text default null,
  p_photo_path  text default null,
  p_actor       text default null,
  p_note        text default null,
  p_entry_date  date default null
)
returns public.customer_ledger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_year      integer;
  v_seq       integer;
  v_doc       text;
  v_method    text;
  v_reference text;
  v_photo     text;
  v_row       public.customer_ledger;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Top-up amount must be greater than zero.';
  end if;

  v_method    := lower(nullif(btrim(coalesce(p_method, '')), ''));
  v_reference := nullif(btrim(coalesce(p_reference, '')), '');
  v_photo     := nullif(btrim(coalesce(p_photo_path, '')), '');

  if v_method is null then
    raise exception 'Top-up method is required.';
  end if;
  if v_method not in ('cash', 'bank_transfer') then
    raise exception 'Invalid top-up method: % (expected cash or bank_transfer).', p_method;
  end if;
  if v_method = 'bank_transfer' and v_photo is null and v_reference is null then
    raise exception 'A bank transfer top-up requires a photo of the transfer AND a transfer reference — both are missing.';
  end if;
  if v_method = 'bank_transfer' and v_photo is null then
    raise exception 'A bank transfer top-up requires a photo of the transfer.';
  end if;
  if v_method = 'bank_transfer' and v_reference is null then
    raise exception 'A bank transfer top-up requires a transfer reference.';
  end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'Actor identity is required.';
  end if;

  -- Customer row is the ledger mutex.
  perform 1 from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'Customer not found.';
  end if;

  -- THE RECEIPT NUMBER STAYS ON TODAY'S YEAR, not the entry date's. It is a
  -- gap-free sequence issued by this office in the order receipts were
  -- written; back-dating one into last year's run would either collide with an
  -- issued number or open a gap in it. The document shows both dates.
  v_year := extract(year from (now() at time zone 'Asia/Riyadh')::date)::integer;
  v_seq  := public.next_topup_receipt_number(v_year);
  v_doc  := 'RCT-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');

  insert into public.customer_ledger
    (customer_id, entry_type, amount_sar, doc_number, method, reference, photo_path, note, created_by, entry_date)
  values
    (p_customer_id, 'topup', round(p_amount, 2), v_doc, v_method,
     v_reference, v_photo,
     nullif(btrim(coalesce(p_note, '')), ''), p_actor,
     coalesce(p_entry_date, (now() at time zone 'Asia/Riyadh')::date))
  returning * into v_row;

  return v_row;
end;
$function$;

revoke execute on function public.record_topup(uuid, numeric, text, text, text, text, text, date) from anon, public;
grant execute on function public.record_topup(uuid, numeric, text, text, text, text, text, date) to authenticated, service_role;

comment on function public.record_topup(uuid, numeric, text, text, text, text, text, date) is
  'Records money onto a customer''s ledger (0203, dated 0208). p_entry_date is '
  'the day the money moved — any date, future included; null means today in '
  'Riyadh. The receipt number is always issued on today''s year.';

-- ----------------------------------------------------------------------------
-- 3. v_topups_monthly — bucketed by the date the money moved
-- ----------------------------------------------------------------------------
-- Same three columns, same order, same types (42P16: month date, topups_sar
-- numeric, topup_count bigint). Only the bucketing key changes: a top-up now
-- lands in the month it HAPPENED rather than the month it was typed in, which
-- is the whole point of the column.
--
-- entry_date IS ALREADY A LOCAL CALENDAR DATE, so it needs no `at time zone`
-- conversion — that conversion existed to turn an instant into a Riyadh day,
-- and the work is now done at write time.
--
-- THE ARCHIVED FILTER STAYS ON created_at, deliberately. It asks "was this row
-- written before the customer was archived" — an audit comparison between two
-- instants, and the only instant a row has is created_at. Moving it to
-- entry_date would compare a back-dated day against an archive timestamp and
-- silently drop rows that were legitimately recorded after an archive.

create or replace view public.v_topups_monthly as
select m.month,
       coalesce(sum(t.amount_sar), 0::numeric) as topups_sar,
       coalesce(count(t.id), 0)                as topup_count
  from public.v_report_months m
  left join (
    select cl.id, cl.amount_sar, cl.entry_date, cl.created_at
      from public.customer_ledger cl
      left join public.customers c on c.id = cl.customer_id
     where cl.entry_type = 'topup'
       and (c.archived_at is null or cl.created_at < c.archived_at)
  ) t
    on date_trunc('month', t.entry_date)::date = m.month
 group by m.month;

alter view public.v_topups_monthly set (security_invoker = true);
revoke all on public.v_topups_monthly from anon;
grant select on public.v_topups_monthly to authenticated;

comment on view public.v_topups_monthly is
  'Monthly balance additions (0206, re-keyed 0208): customer_ledger top-ups '
  'bucketed by entry_date — the day the money moved. The archived-customer '
  'filter stays on created_at, which is an audit comparison between instants.';

-- ----------------------------------------------------------------------------
-- 4. Verification — the transaction refuses to commit on any failure
-- ----------------------------------------------------------------------------

do $verify$
declare
  v_n   int;
  v_def text;
begin
  -- 4a. The column exists, is NOT NULL, has the Riyadh default, and no row
  --     was left behind by the backfill.
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'customer_ledger'
     and column_name = 'entry_date' and data_type = 'date' and is_nullable = 'NO';
  if v_n <> 1 then
    raise exception '0208 VERIFY: customer_ledger.entry_date is missing or nullable.';
  end if;
  select count(*) into v_n from public.customer_ledger where entry_date is null;
  if v_n <> 0 then
    raise exception '0208 VERIFY: % ledger row(s) have a null entry_date.', v_n;
  end if;

  -- 4b. THE BACKFILL SAID WHAT THE APP WAS ALREADY SHOWING. Every row at this
  --     instant must date to its own created_at in Riyadh terms — nothing was
  --     stamped with the migration's own day. (A later back-dated top-up will
  --     break this equality, which is why it is asserted HERE and not kept.)
  select count(*) into v_n from public.customer_ledger
   where entry_date is distinct from (created_at at time zone 'Asia/Riyadh')::date;
  if v_n <> 0 then
    raise exception '0208 VERIFY: % row(s) were not dated from their own created_at.', v_n;
  end if;

  -- 4c. record_topup: exactly one overload, eight arguments, no anon.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_topup';
  if v_n <> 1 then
    raise exception '0208 VERIFY: expected 1 record_topup, found % — a stray overload makes named-argument calls ambiguous.', v_n;
  end if;
  select pronargs into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_topup';
  if v_n <> 8 then
    raise exception '0208 VERIFY: record_topup has % arguments, expected 8.', v_n;
  end if;
  if has_function_privilege('anon',
       'public.record_topup(uuid, numeric, text, text, text, text, text, date)'::regprocedure, 'execute') then
    raise exception '0208 VERIFY: anon can execute record_topup.';
  end if;

  -- 4d. THE RULING, ASSERTED AGAINST THE DEFINITIONS THEMSELVES: no balance
  --     view learned about the date. If either ever gains a date predicate,
  --     the app has two balances that disagree on any back-dated row.
  select pg_get_viewdef('public.v_customer_ledger_balance'::regclass) into v_def;
  if v_def like '%entry_date%' then
    raise exception '0208 VERIFY: v_customer_ledger_balance reads entry_date — Balance must not be dated.';
  end if;
  select pg_get_viewdef('public.v_customer_available'::regclass) into v_def;
  if v_def like '%entry_date%' then
    raise exception '0208 VERIFY: v_customer_available reads entry_date — Available must not be dated.';
  end if;
  select pg_get_viewdef('public.v_invoice_settlement'::regclass) into v_def;
  if v_def like '%entry_date%' then
    raise exception '0208 VERIFY: v_invoice_settlement reads entry_date — settlement must not be dated.';
  end if;

  -- 4e. THE POSITIVE CONTROL. Three "does not contain" checks are green on a
  --     database where the column was never added at all, so prove the scan
  --     can see the string where it IS supposed to be.
  select pg_get_viewdef('public.v_topups_monthly'::regclass) into v_def;
  if v_def not like '%entry_date%' then
    raise exception '0208 VERIFY: v_topups_monthly does NOT read entry_date — the 4d scans prove nothing.';
  end if;
  if v_def not like '%created_at%' then
    raise exception '0208 VERIFY: v_topups_monthly lost its created_at archive filter.';
  end if;

  -- 4f. Column parity on the replaced view (42P16 also enforces this, but a
  --     failed apply is a clearer message than a rejected statement).
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'v_topups_monthly'
     and column_name in ('month', 'topups_sar', 'topup_count');
  if v_n <> 3 then
    raise exception '0208 VERIFY: v_topups_monthly no longer publishes its three columns.';
  end if;

  raise notice '0208 VERIFY: entry_date added to % ledger row(s); Balance and Available unchanged.',
    (select count(*) from public.customer_ledger);
end;
$verify$;

commit;
