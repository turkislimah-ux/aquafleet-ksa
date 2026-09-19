-- 0203_customer_ledger.sql
-- PREPAID REBUILD — STEP 2 (ADDITIVE ONLY).
--
-- One ledger per customer. Balance = sum of signed, VAT-inclusive rows.
-- Delivered trips never touch the balance; they are "Uninvoiced".
-- Readers: Balance, Uninvoiced, Available = Balance − Uninvoiced.
-- Draw happens at CONFIRM: min(Available, grand_total). Void reverses via
-- paired draw_reversal rows. Postpaid untouched.
--
-- DRAFTED TO DISK ONLY — architect reviews, Turki applies in the SQL Editor.
-- The drop migration (old prepaid views/tables, projects.payment_mode,
-- covered/unpaid invoice columns) is 0204, AFTER code has moved over.
-- This migration deliberately does NOT touch: v_customer_prepaid_balance,
-- v_customer_amount_payable, v_invoice_outstanding_live, receivables views,
-- return_customer_balance, customer_topups, customer_balance_returns.

begin;

-- =========================================================================
-- 1. customers.payment_mode — mode moves from project to customer.
-- =========================================================================

-- Abort early if any customer has projects in two different non-null modes.
-- (Measured 0 mixed customers; this guard makes the backfill provably safe.)
do $$
begin
  if exists (
    select 1 from public.projects
     where payment_mode is not null
     group by customer_id
    having count(distinct payment_mode) > 1
  ) then
    raise exception '0203: a customer has projects in two different payment modes — backfill is ambiguous, resolve before migrating.';
  end if;
end $$;

alter table public.customers add column if not exists payment_mode text;

-- Backfill: the customer's single project mode; customers with no mode at
-- all (incl. the null-mode archived project "King Salman Park" / "Turki 1",
-- ruled postpaid) fall back to 'postpaid'.
update public.customers c
   set payment_mode = coalesce(
         (select max(p.payment_mode)
            from public.projects p
           where p.customer_id = c.id
             and p.payment_mode is not null),
         'postpaid')
 where c.payment_mode is null;

alter table public.customers alter column payment_mode set not null;

alter table public.customers
  drop constraint if exists customers_payment_mode_check;
alter table public.customers
  add constraint customers_payment_mode_check
  check (payment_mode in ('prepaid', 'postpaid'));

-- =========================================================================
-- 2. Numbering — exact clones of 0034's invoice_number_counter mechanics.
--    Formats (built in the RPCs): RCT-YYYY-NNNNNN and CN-YYYY-NNNNNN.
-- =========================================================================

create table if not exists public.topup_receipt_counter (
  year        integer not null primary key,
  next_number integer not null default 1
);

create table if not exists public.credit_note_counter (
  year        integer not null primary key,
  next_number integer not null default 1
);

alter table public.topup_receipt_counter enable row level security;
alter table public.credit_note_counter   enable row level security;
revoke all on public.topup_receipt_counter from anon, authenticated;
revoke all on public.credit_note_counter   from anon, authenticated;

create or replace function public.next_topup_receipt_number(p_year integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
begin
  insert into public.topup_receipt_counter (year, next_number)
  values (p_year, 1)
  on conflict (year) do nothing;

  update public.topup_receipt_counter
     set next_number = next_number + 1
   where year = p_year
  returning next_number - 1 into v_number;

  return v_number;
end;
$$;

revoke execute on function public.next_topup_receipt_number(integer) from anon, public;
grant execute on function public.next_topup_receipt_number(integer) to authenticated, service_role;

create or replace function public.next_credit_note_number(p_year integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
begin
  insert into public.credit_note_counter (year, next_number)
  values (p_year, 1)
  on conflict (year) do nothing;

  update public.credit_note_counter
     set next_number = next_number + 1
   where year = p_year
  returning next_number - 1 into v_number;

  return v_number;
end;
$$;

revoke execute on function public.next_credit_note_number(integer) from anon, public;
grant execute on function public.next_credit_note_number(integer) to authenticated, service_role;

-- =========================================================================
-- 3. customer_ledger — append-only. All amounts SIGNED and VAT-INCLUSIVE.
-- =========================================================================

create table if not exists public.customer_ledger (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  entry_type  text not null,
  amount_sar  numeric not null,
  invoice_id  uuid references public.invoices(id),
  doc_number  text,
  reversal_of uuid unique references public.customer_ledger(id),
  method      text,
  reference   text,
  photo_path  text,
  note        text,
  created_by  text,
  created_at  timestamptz not null default now(),

  constraint customer_ledger_entry_type_check check (
    entry_type in ('topup','invoice_draw','balance_applied','refund','correction','draw_reversal')
  ),
  -- Per-type sign rule. Money in is positive, money out is negative,
  -- corrections are either but never zero.
  constraint customer_ledger_sign_check check (
    case entry_type
      when 'topup'           then amount_sar > 0
      when 'draw_reversal'   then amount_sar > 0
      when 'invoice_draw'    then amount_sar < 0
      when 'balance_applied' then amount_sar < 0
      when 'refund'          then amount_sar < 0
      when 'correction'      then amount_sar <> 0
      else false
    end
  ),
  -- invoice_id required for the three invoice-linked types, null otherwise.
  constraint customer_ledger_invoice_link_check check (
    (entry_type in ('invoice_draw','balance_applied','draw_reversal'))
      = (invoice_id is not null)
  ),
  -- Numbered documents: topup carries a receipt number, refund a credit note.
  constraint customer_ledger_doc_number_check check (
    (entry_type in ('topup','refund')) = (doc_number is not null)
  ),
  -- reversal_of set on draw_reversal rows only (UNIQUE above = one reversal
  -- per source row, ever).
  constraint customer_ledger_reversal_check check (
    (entry_type = 'draw_reversal') = (reversal_of is not null)
  )
);

create index if not exists customer_ledger_customer_idx
  on public.customer_ledger (customer_id, created_at);
create index if not exists customer_ledger_invoice_idx
  on public.customer_ledger (invoice_id) where invoice_id is not null;

-- Append-only, writes via SECURITY DEFINER RPCs only. Authenticated may read.
alter table public.customer_ledger enable row level security;
drop policy if exists customer_ledger_select on public.customer_ledger;
create policy customer_ledger_select on public.customer_ledger
  for select to authenticated using (true);
revoke all on public.customer_ledger from anon;
revoke insert, update, delete on public.customer_ledger from authenticated;
grant select on public.customer_ledger to authenticated;

-- =========================================================================
-- 4. Ledger corrections — two-vote model cloned from 0057/0058.
-- =========================================================================

create table if not exists public.ledger_corrections (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id),
  amount_sar      numeric not null check (amount_sar <> 0),
  reason          text not null,
  status          text not null default 'pending'
                    check (status in ('pending','approved','rejected')),
  proposed_by     text not null,
  ledger_entry_id uuid references public.customer_ledger(id),
  created_at      timestamptz not null default now(),
  decided_at      timestamptz
);

create table if not exists public.ledger_correction_votes (
  id            uuid primary key default gen_random_uuid(),
  correction_id uuid not null references public.ledger_corrections(id) on delete cascade,
  approver_email text not null,
  action        text not null check (action in ('approve','reject')),
  comment       text,
  voted_at      timestamptz not null default now(),
  unique (correction_id, approver_email)
);

create index if not exists ledger_corrections_customer_idx
  on public.ledger_corrections (customer_id);

alter table public.ledger_corrections enable row level security;
alter table public.ledger_correction_votes enable row level security;
drop policy if exists ledger_corrections_select on public.ledger_corrections;
create policy ledger_corrections_select on public.ledger_corrections
  for select to authenticated using (true);
drop policy if exists ledger_correction_votes_select on public.ledger_correction_votes;
create policy ledger_correction_votes_select on public.ledger_correction_votes
  for select to authenticated using (true);
revoke all on public.ledger_corrections from anon;
revoke all on public.ledger_correction_votes from anon;
revoke insert, update, delete on public.ledger_corrections from authenticated;
revoke insert, update, delete on public.ledger_correction_votes from authenticated;
grant select on public.ledger_corrections to authenticated;
grant select on public.ledger_correction_votes to authenticated;

-- =========================================================================
-- 5. invoice_payments — one row per payment; partial allowed.
--    Existing invoices.payment_* columns stay untouched (0204 decides).
-- =========================================================================

create table if not exists public.invoice_payments (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  amount_sar numeric not null check (amount_sar > 0),
  method     text not null check (method in ('cash','bank_transfer')),
  reference  text,
  proof_path text,
  paid_on    date,
  note       text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists invoice_payments_invoice_idx
  on public.invoice_payments (invoice_id);

alter table public.invoice_payments enable row level security;
drop policy if exists invoice_payments_select on public.invoice_payments;
create policy invoice_payments_select on public.invoice_payments
  for select to authenticated using (true);
revoke all on public.invoice_payments from anon;
revoke insert, update, delete on public.invoice_payments from authenticated;
grant select on public.invoice_payments to authenticated;

-- =========================================================================
-- 6. invoices — frozen-at-confirm prepaid figures. Nullable: legacy rows
--    and drafts stay null (no backfill — dummy data).
-- =========================================================================

alter table public.invoices add column if not exists prepaid_applied_sar numeric;
alter table public.invoices add column if not exists amount_payable_sar  numeric;

-- =========================================================================
-- 7. Reader views — Balance, Uninvoiced, Available, per-invoice settlement.
-- =========================================================================

create or replace view public.v_customer_ledger_balance as
select c.id   as customer_id,
       c.name as customer_name,
       round(coalesce(sum(cl.amount_sar), 0), 2) as balance_sar
  from public.customers c
  left join public.customer_ledger cl on cl.customer_id = c.id
 group by c.id, c.name;

alter view public.v_customer_ledger_balance set (security_invoker = true);
revoke all on public.v_customer_ledger_balance from anon;
grant select on public.v_customer_ledger_balance to authenticated;

-- Uninvoiced = value already delivered but not yet drawn from the balance.
-- Per-item rounding matches today's convention exactly:
--   trips:   round(frozen rate × (1 + vat_rate()), 2) per trip
--   charges: round(amount × (1 + vat_rate()), 2) per charge
-- Trips: delivered AND (invoice_id null OR the invoice is still
-- draft/review). Trips reserve invoice_id at DRAFT, before any money
-- freezes — a mere reservation must not hide delivered work from
-- Uninvoiced, or Available would be overstated (and refundable) in the
-- draft→confirm window. Charges: rows on draft/review invoices — a
-- confirmed invoice's charges were drawn at confirm; void excluded by
-- status. CONSISTENT WITH confirm_invoice: it flips status to
-- 'confirmed' BEFORE reading this view, so both arms (trip and charge)
-- drop this invoice's own items in the same instant — the draw sees them
-- exactly once (inside grand_total), never also here.
create or replace view public.v_customer_uninvoiced as
select c.id   as customer_id,
       c.name as customer_name,
       coalesce((select sum(round(coalesce(t.rate_sar, p.rate_per_trip_sar) * (1 + public.vat_rate()), 2))
                   from public.trips t
                   join public.projects p on p.id = t.project_id
                   left join public.invoices ti on ti.id = t.invoice_id
                  where p.customer_id = c.id
                    and t.delivered_at is not null
                    and (t.invoice_id is null or ti.status in ('draft', 'review'))), 0) as trip_uninvoiced_sar,
       coalesce((select sum(round(sc.amount_sar * (1 + public.vat_rate()), 2))
                   from public.invoice_special_charges sc
                   join public.invoices i on i.id = sc.invoice_id
                  where i.customer_id = c.id
                    and i.status in ('draft', 'review')), 0) as charge_uninvoiced_sar,
       coalesce((select sum(round(coalesce(t.rate_sar, p.rate_per_trip_sar) * (1 + public.vat_rate()), 2))
                   from public.trips t
                   join public.projects p on p.id = t.project_id
                   left join public.invoices ti on ti.id = t.invoice_id
                  where p.customer_id = c.id
                    and t.delivered_at is not null
                    and (t.invoice_id is null or ti.status in ('draft', 'review'))), 0)
     + coalesce((select sum(round(sc.amount_sar * (1 + public.vat_rate()), 2))
                   from public.invoice_special_charges sc
                   join public.invoices i on i.id = sc.invoice_id
                  where i.customer_id = c.id
                    and i.status in ('draft', 'review')), 0) as uninvoiced_sar
  from public.customers c;

alter view public.v_customer_uninvoiced set (security_invoker = true);
revoke all on public.v_customer_uninvoiced from anon;
grant select on public.v_customer_uninvoiced to authenticated;

create or replace view public.v_customer_available as
select b.customer_id,
       b.customer_name,
       b.balance_sar,
       u.uninvoiced_sar,
       round(b.balance_sar - u.uninvoiced_sar, 2) as available_sar
  from public.v_customer_ledger_balance b
  join public.v_customer_uninvoiced u on u.customer_id = b.customer_id;

alter view public.v_customer_available set (security_invoker = true);
revoke all on public.v_customer_available from anon;
grant select on public.v_customer_available to authenticated;

-- Per-invoice settlement on the FROZEN payable.
--   paid_sar        = sum of invoice_payments
--   applied_sar     = balance_applied rows not yet reversed
--   written_off_sar = remaining debt while the customer has an ACTIVE
--                     write-off (customer-level, 0139 semantics)
--   remainder_sar   = payable − paid − applied − written_off (never < 0);
--                     NULL where payable is NULL (drafts + legacy rows).
create or replace view public.v_invoice_settlement as
select i.id             as invoice_id,
       i.customer_id,
       i.invoice_number,
       i.status,
       i.amount_payable_sar as payable_sar,
       pay.paid_sar,
       app.applied_sar,
       wo.written_off_sar,
       case when i.amount_payable_sar is null then null::numeric
            else greatest(round(i.amount_payable_sar - pay.paid_sar - app.applied_sar - wo.written_off_sar, 2), 0)
       end as remainder_sar
  from public.invoices i
 cross join lateral (
   select coalesce(round(sum(ip.amount_sar), 2), 0) as paid_sar
     from public.invoice_payments ip
    where ip.invoice_id = i.id
 ) pay
 cross join lateral (
   select coalesce(round(-sum(x.amount_sar), 2), 0) as applied_sar
     from public.customer_ledger x
    where x.invoice_id = i.id
      and x.entry_type = 'balance_applied'
      and not exists (select 1 from public.customer_ledger r where r.reversal_of = x.id)
 ) app
 cross join lateral (
   select case
            when i.amount_payable_sar is not null
             and exists (select 1 from public.customer_write_offs w
                          where w.customer_id = i.customer_id
                            and w.reversed_at is null)
            then greatest(round(i.amount_payable_sar - pay.paid_sar - app.applied_sar, 2), 0)
            else 0::numeric
          end as written_off_sar
 ) wo;

alter view public.v_invoice_settlement set (security_invoker = true);
revoke all on public.v_invoice_settlement from anon;
grant select on public.v_invoice_settlement to authenticated;

-- =========================================================================
-- 8. Ledger RPCs.
-- =========================================================================

create or replace function public.record_topup(
  p_customer_id uuid,
  p_amount      numeric,
  p_method      text,
  p_reference   text default null,
  p_photo_path  text default null,
  p_actor       text default null,
  p_note        text default null
)
returns public.customer_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer;
  v_seq  integer;
  v_doc  text;
  v_row  public.customer_ledger;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Top-up amount must be greater than zero.';
  end if;
  if nullif(btrim(coalesce(p_method, '')), '') is null then
    raise exception 'Top-up method is required.';
  end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'Actor identity is required.';
  end if;

  -- Customer row is the ledger mutex.
  perform 1 from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'Customer not found.';
  end if;

  v_year := extract(year from (now() at time zone 'Asia/Riyadh')::date)::integer;
  v_seq  := public.next_topup_receipt_number(v_year);
  v_doc  := 'RCT-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');

  insert into public.customer_ledger
    (customer_id, entry_type, amount_sar, doc_number, method, reference, photo_path, note, created_by)
  values
    (p_customer_id, 'topup', round(p_amount, 2), v_doc, btrim(p_method),
     nullif(btrim(coalesce(p_reference, '')), ''), p_photo_path,
     nullif(btrim(coalesce(p_note, '')), ''), p_actor)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.record_topup(uuid, numeric, text, text, text, text, text) from anon, public;
grant execute on function public.record_topup(uuid, numeric, text, text, text, text, text) to authenticated, service_role;

create or replace function public.record_refund(
  p_customer_id uuid,
  p_amount      numeric,
  p_method      text,
  p_reference   text default null,
  p_actor       text default null,
  p_note        text default null
)
returns public.customer_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year      integer;
  v_seq       integer;
  v_doc       text;
  v_available numeric;
  v_row       public.customer_ledger;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Refund amount must be greater than zero.';
  end if;
  if nullif(btrim(coalesce(p_method, '')), '') is null then
    raise exception 'Refund method is required.';
  end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'Actor identity is required.';
  end if;

  perform 1 from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'Customer not found.';
  end if;

  select a.available_sar into v_available
    from public.v_customer_available a
   where a.customer_id = p_customer_id;

  if round(p_amount, 2) > coalesce(v_available, 0) then
    raise exception 'Refund of % SAR exceeds the customer''s Available balance of % SAR (Balance minus Uninvoiced).',
      to_char(round(p_amount, 2), 'FM999,999,990.00'),
      to_char(coalesce(v_available, 0), 'FM999,999,990.00');
  end if;

  v_year := extract(year from (now() at time zone 'Asia/Riyadh')::date)::integer;
  v_seq  := public.next_credit_note_number(v_year);
  v_doc  := 'CN-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');

  insert into public.customer_ledger
    (customer_id, entry_type, amount_sar, doc_number, method, reference, note, created_by)
  values
    (p_customer_id, 'refund', -round(p_amount, 2), v_doc, btrim(p_method),
     nullif(btrim(coalesce(p_reference, '')), ''),
     nullif(btrim(coalesce(p_note, '')), ''), p_actor)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.record_refund(uuid, numeric, text, text, text, text) from anon, public;
grant execute on function public.record_refund(uuid, numeric, text, text, text, text) to authenticated, service_role;

create or replace function public.apply_balance_to_invoice(
  p_invoice_id uuid,
  p_actor      text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv       public.invoices;
  v_mode      text;
  v_remainder numeric;
  v_available numeric;
  v_draw      numeric;
begin
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'Actor identity is required.';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.';
  end if;
  if v_inv.status <> 'confirmed' then
    raise exception 'Balance can only be applied to a confirmed invoice (current status: %).', v_inv.status;
  end if;
  if v_inv.amount_payable_sar is null then
    raise exception 'This invoice has no frozen amount payable (issued before the ledger model) — settle it with the legacy flow.';
  end if;

  select payment_mode into v_mode from public.customers where id = v_inv.customer_id for update;
  if v_mode is distinct from 'prepaid' then
    raise exception 'Balance can only be applied for a prepaid customer (mode: %).', coalesce(v_mode, 'unknown');
  end if;

  select s.remainder_sar into v_remainder
    from public.v_invoice_settlement s where s.invoice_id = p_invoice_id;
  select a.available_sar into v_available
    from public.v_customer_available a where a.customer_id = v_inv.customer_id;

  v_draw := round(least(coalesce(v_available, 0), coalesce(v_remainder, 0)), 2);
  if v_draw <= 0 then
    raise exception 'Nothing to apply — Available is % SAR and the invoice remainder is % SAR.',
      to_char(coalesce(v_available, 0), 'FM999,999,990.00'),
      to_char(coalesce(v_remainder, 0), 'FM999,999,990.00');
  end if;

  insert into public.customer_ledger
    (customer_id, entry_type, amount_sar, invoice_id, note, created_by)
  values
    (v_inv.customer_id, 'balance_applied', -v_draw, p_invoice_id,
     'Balance applied to invoice ' || coalesce(v_inv.invoice_number, p_invoice_id::text), p_actor);

  if round(coalesce(v_remainder, 0) - v_draw, 2) = 0 then
    update public.invoices
       set status = 'paid', paid_at = now()
     where id = p_invoice_id
    returning * into v_inv;

    update public.trips
       set invoice_id = p_invoice_id
     where id = any(coalesce(v_inv.covered_trip_ids, array[]::uuid[])
               || coalesce(v_inv.unpaid_trip_ids, array[]::uuid[]));
  else
    select * into v_inv from public.invoices where id = p_invoice_id;
  end if;

  return v_inv;
end;
$$;

revoke execute on function public.apply_balance_to_invoice(uuid, text) from anon, public;
grant execute on function public.apply_balance_to_invoice(uuid, text) to authenticated, service_role;

create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount     numeric,
  p_method     text,
  p_reference  text default null,
  p_proof_path text default null,
  p_paid_on    date default null,
  p_actor      text default null,
  p_note       text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv       public.invoices;
  v_remainder numeric;
begin
  if p_method not in ('cash', 'bank_transfer') then
    raise exception 'Invalid payment method: % (balance is applied via apply_balance_to_invoice).', p_method;
  end if;
  if p_method = 'bank_transfer' and p_proof_path is null then
    raise exception 'bank_transfer payment requires a proof-of-payment file.';
  end if;
  if p_method = 'bank_transfer' and p_reference is null then
    raise exception 'bank_transfer payment requires a payment reference.';
  end if;
  if p_method = 'bank_transfer' and p_paid_on is null then
    raise exception 'bank_transfer payment requires a payment date.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'Actor identity is required.';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.';
  end if;
  if v_inv.status <> 'confirmed' then
    raise exception 'Payments can only be recorded on a confirmed invoice (current status: %).', v_inv.status;
  end if;
  if v_inv.amount_payable_sar is null then
    raise exception 'This invoice has no frozen amount payable (issued before the ledger model) — settle it with the legacy flow.';
  end if;

  select s.remainder_sar into v_remainder
    from public.v_invoice_settlement s where s.invoice_id = p_invoice_id;

  if round(p_amount, 2) > coalesce(v_remainder, 0) then
    raise exception 'Payment of % SAR exceeds the invoice remainder of % SAR.',
      to_char(round(p_amount, 2), 'FM999,999,990.00'),
      to_char(coalesce(v_remainder, 0), 'FM999,999,990.00');
  end if;

  insert into public.invoice_payments
    (invoice_id, amount_sar, method, reference, proof_path, paid_on, note, created_by)
  values
    (p_invoice_id, round(p_amount, 2), p_method,
     nullif(btrim(coalesce(p_reference, '')), ''), p_proof_path, p_paid_on,
     nullif(btrim(coalesce(p_note, '')), ''), p_actor);

  if round(coalesce(v_remainder, 0) - round(p_amount, 2), 2) = 0 then
    update public.invoices
       set status = 'paid', paid_at = now()
     where id = p_invoice_id
    returning * into v_inv;

    update public.trips
       set invoice_id = p_invoice_id
     where id = any(coalesce(v_inv.covered_trip_ids, array[]::uuid[])
               || coalesce(v_inv.unpaid_trip_ids, array[]::uuid[]));
  end if;

  return v_inv;
end;
$$;

revoke execute on function public.record_invoice_payment(uuid, numeric, text, text, text, date, text, text) from anon, public;
grant execute on function public.record_invoice_payment(uuid, numeric, text, text, text, date, text, text) to authenticated, service_role;

-- =========================================================================
-- 9. Ledger corrections — two-vote RPCs (clone of 0057/0058 semantics).
-- =========================================================================

create or replace function public.propose_ledger_correction(
  p_customer_id uuid,
  p_amount      numeric,
  p_reason      text,
  p_actor       text default null
)
returns public.ledger_corrections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ledger_corrections;
begin
  if p_amount is null or p_amount = 0 then
    raise exception 'Correction amount must be non-zero (either sign).';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Correction reason is required.';
  end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'Proposer identity is required.';
  end if;
  perform 1 from public.customers where id = p_customer_id;
  if not found then
    raise exception 'Customer not found.';
  end if;

  insert into public.ledger_corrections (customer_id, amount_sar, reason, proposed_by)
  values (p_customer_id, round(p_amount, 2), btrim(p_reason), p_actor)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.propose_ledger_correction(uuid, numeric, text, text) from anon, public;
grant execute on function public.propose_ledger_correction(uuid, numeric, text, text) to authenticated, service_role;

-- Two-vote gate (0057/0058 clone) with one money-specific tightening:
-- THE PROPOSER CANNOT VOTE on their own correction. Approval takes two
-- matching votes from authorized staff OTHER than the proposer — three
-- distinct people touch every approved correction.
create or replace function public.vote_ledger_correction(
  p_correction_id uuid,
  p_action        text,
  p_comment       text default null,
  p_actor         text default null
)
returns public.ledger_corrections
language plpgsql
security definer
set search_path = public
as $$
declare
  v_corr       public.ledger_corrections;
  v_own_vote   public.ledger_correction_votes;
  v_other_vote public.ledger_correction_votes;
  v_entry      public.customer_ledger;
begin
  select * into v_corr from public.ledger_corrections where id = p_correction_id for update;
  if not found then
    raise exception 'Correction not found.';
  end if;

  -- DECIDED IS FINAL — enforced first, before any vote logic runs.
  if v_corr.status <> 'pending' then
    raise exception 'Only a pending correction can be voted on (current status: %).', v_corr.status;
  end if;

  if p_action is null or p_action not in ('approve', 'reject') then
    raise exception 'Vote action must be approve or reject.';
  end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'Approver identity is required.';
  end if;

  -- Proposer cannot vote on their own correction.
  if p_actor = v_corr.proposed_by then
    raise exception 'The proposer cannot vote on their own correction — two other approvers must decide.';
  end if;

  perform 1 from public.staff
   where email = p_actor and active = true and terminated_at is null
     and role in ('fleet_manager', 'ops_supervisor');
  if not found then
    raise exception 'Not authorized to vote on ledger corrections.';
  end if;

  select * into v_own_vote
    from public.ledger_correction_votes
   where correction_id = p_correction_id and approver_email = p_actor;

  if found then
    -- Sole voter (the only state reachable pre-finalization) freely
    -- changing their own vote. Nothing finalizes on a lone voter.
    update public.ledger_correction_votes
       set action = p_action, comment = nullif(btrim(coalesce(p_comment, '')), ''), voted_at = now()
     where correction_id = p_correction_id and approver_email = p_actor;
    return v_corr;
  end if;

  select * into v_other_vote
    from public.ledger_correction_votes
   where correction_id = p_correction_id
   limit 1;

  if not found then
    -- First vote — records the vote only. The ledger is never touched by a
    -- lone voter, regardless of action.
    insert into public.ledger_correction_votes (correction_id, approver_email, action, comment)
    values (p_correction_id, p_actor, p_action, nullif(btrim(coalesce(p_comment, '')), ''));
    return v_corr;
  end if;

  -- Second, distinct voter — must MATCH the first vote's action.
  if v_other_vote.action <> p_action then
    raise exception 'This correction already has a pending % vote (by %) — your action must match it, or ask them to change their vote first.',
      v_other_vote.action, v_other_vote.approver_email;
  end if;

  insert into public.ledger_correction_votes (correction_id, approver_email, action, comment)
  values (p_correction_id, p_actor, p_action, nullif(btrim(coalesce(p_comment, '')), ''));

  if p_action = 'approve' then
    -- MATCH on approve — the completing vote writes the ledger row
    -- atomically. Corrections MAY push the balance negative (ruled).
    perform 1 from public.customers where id = v_corr.customer_id for update;

    insert into public.customer_ledger
      (customer_id, entry_type, amount_sar, note, created_by)
    values
      (v_corr.customer_id, 'correction', v_corr.amount_sar,
       'Correction ' || v_corr.id::text || ' — ' || v_corr.reason, p_actor)
    returning * into v_entry;

    update public.ledger_corrections
       set status = 'approved', decided_at = now(), ledger_entry_id = v_entry.id
     where id = p_correction_id
    returning * into v_corr;
  else
    update public.ledger_corrections
       set status = 'rejected', decided_at = now()
     where id = p_correction_id
    returning * into v_corr;
  end if;

  return v_corr;
end;
$$;

revoke execute on function public.vote_ledger_correction(uuid, text, text, text) from anon, public;
grant execute on function public.vote_ledger_correction(uuid, text, text, text) to authenticated, service_role;

-- =========================================================================
-- 10. confirm_invoice — reworked. Every existing freeze and Tier A/B/C
--     assertion is kept verbatim; the prepaid draw is appended AFTER the
--     status flip. Adds p_actor (audit trail for the draw row), so the old
--     signature is dropped first (ONE-signature rule).
--     The FIFO covered/unpaid walk is NO LONGER meaningful but its columns
--     are still written verbatim, untouched (0204 drops them).
-- =========================================================================

drop function if exists public.confirm_invoice(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[],
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, text);

create function public.confirm_invoice(
  p_invoice_id uuid,
  p_seller_snapshot jsonb,
  p_buyer_snapshot jsonb,
  p_covered_lines jsonb,
  p_unpaid_lines jsonb,
  p_special_charges jsonb,
  p_covered_trip_ids uuid[],
  p_unpaid_trip_ids uuid[],
  p_covered_subtotal numeric,
  p_covered_vat numeric,
  p_covered_total numeric,
  p_due_subtotal numeric,
  p_due_vat numeric,
  p_due_total numeric,
  p_grand_subtotal numeric,
  p_grand_vat numeric,
  p_grand_total numeric,
  p_covered_ledger_subtotal numeric default null,
  p_covered_ledger_balance numeric default null,
  p_covered_ledger_remaining numeric default null,
  p_unpaid_ledger_subtotal numeric default null,
  p_unpaid_ledger_balance numeric default null,
  p_unpaid_ledger_remaining numeric default null,
  p_payment_mode text default null,
  p_actor text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq               integer;
  v_year              integer;
  v_number            text;
  v_row               public.invoices;
  v_undelivered_count integer;
  v_payload_count     integer;
  v_payload_distinct  integer;
  v_charge_divergence text;
  v_line_sum          numeric;
  v_cust_mode         text;
  v_balance           numeric;
  v_uninvoiced        numeric;
  v_available         numeric;
  v_draw              numeric;
  v_payable           numeric;
begin
  select count(*) into v_undelivered_count
    from public.trips t
    join public.invoices i on i.id = p_invoice_id
    join public.projects p on p.customer_id = i.customer_id
   where t.project_id = p.id
     and t.trip_date between i.period_start and i.period_end
     and t.delivered_at is null;

  if v_undelivered_count > 0 then
    raise exception 'Cannot confirm — % trip(s) in this invoice''s period are not yet delivered.', v_undelivered_count;
  end if;

  if p_special_charges is not null and jsonb_typeof(p_special_charges) <> 'array' then
    raise exception 'confirm_invoice: p_special_charges must be a JSON array, got %.',
      jsonb_typeof(p_special_charges);
  end if;

  select count(*), count(distinct (e->>'id'))
    into v_payload_count, v_payload_distinct
    from jsonb_array_elements(
           case when jsonb_typeof(p_special_charges) = 'array'
                then p_special_charges
                else '[]'::jsonb end
         ) e;

  if v_payload_count <> v_payload_distinct then
    raise exception 'confirm_invoice: p_special_charges contains duplicate charge ids (% entries, % distinct).',
      v_payload_count, v_payload_distinct;
  end if;

  select string_agg(d.msg, '; ' order by d.msg)
    into v_charge_divergence
    from (
      select case
               when s.id is null then
                 'payload carries charge ' || c.id::text || ' which is not on this invoice'
               when c.id is null then
                 'payload OMITS charge ' || s.id::text || ' (' || s.label || ', '
                   || s.amount_sar::text || ' net / '
                   || round(s.amount_sar * (1 + public.vat_rate()), 2)::text || ' gross SAR)'
               else
                 'charge ' || s.id::text || ' amount differs: table '
                   || s.amount_sar::text || ' vs payload ' || c.amount_sar::text
             end as msg
        from (
          select sc.id, sc.label, sc.amount_sar
            from public.invoice_special_charges sc
           where sc.invoice_id = p_invoice_id
        ) s
        full outer join (
          select (e->>'id')::uuid    as id,
                 (e->>'amount_sar')::numeric as amount_sar
            from jsonb_array_elements(
                   case when jsonb_typeof(p_special_charges) = 'array'
                        then p_special_charges
                        else '[]'::jsonb end
                 ) e
        ) c on c.id = s.id
       where s.id is null
          or c.id is null
          or s.amount_sar is distinct from c.amount_sar
    ) d;

  if v_charge_divergence is not null then
    raise exception 'Cannot confirm — the special charges sent do not match this invoice''s charges, which have already consumed the customer''s balance: %.', v_charge_divergence
      using hint = 'Reopen the invoice so the charge table reloads, then confirm again. Confirming now would freeze an invoice that understates money already deducted.';
  end if;

  -- =====================================================================
  -- TOTALS ASSERTIONS (0191) — kept verbatim.
  -- =====================================================================

  select round(coalesce(sum(l.amount_sar), 0), 2)
    into v_line_sum
    from (
      select distinct
             a.e->>'kind'                  as kind,
             a.e->>'id'                    as id,
             (a.e->>'amount_sar')::numeric as amount_sar
        from (
          select e from jsonb_array_elements(
                          case when jsonb_typeof(p_covered_lines) = 'array'
                               then p_covered_lines else '[]'::jsonb end) e
          union all
          select e from jsonb_array_elements(
                          case when jsonb_typeof(p_unpaid_lines) = 'array'
                               then p_unpaid_lines else '[]'::jsonb end) e
          union all
          select e from jsonb_array_elements(
                          case when jsonb_typeof(p_special_charges) = 'array'
                               then p_special_charges else '[]'::jsonb end) e
        ) a
    ) l;

  if p_covered_subtotal is null or p_covered_vat is null or p_covered_total is null
     or p_due_subtotal is null or p_due_vat is null or p_due_total is null
     or p_grand_subtotal is null or p_grand_vat is null or p_grand_total is null then
    raise exception 'confirm_invoice: a document total arrived NULL (covered % / % / %, due % / % / %, grand % / % / %) — an invoice cannot be frozen around a figure that is missing.',
      p_covered_subtotal, p_covered_vat, p_covered_total,
      p_due_subtotal, p_due_vat, p_due_total,
      p_grand_subtotal, p_grand_vat, p_grand_total
      using hint = 'Reopen the invoice so the totals recompute, then confirm again.';
  end if;

  -- TIER A — the document must add up to the lines it prints.
  if round(v_line_sum, 2) is distinct from round(p_grand_subtotal, 2) then
    raise exception 'confirm_invoice: the invoice lines sum to % but the Grand Total subtotal says % — the document does not add up to its own lines (short by %).',
      v_line_sum, p_grand_subtotal, round(v_line_sum - p_grand_subtotal, 2)
      using hint = 'Reopen the invoice so the totals recompute, then confirm again.';
  end if;

  -- TIER B — covered + amount due = grand, on all three components.
  if round(p_covered_subtotal + p_due_subtotal, 2) is distinct from round(p_grand_subtotal, 2)
     or round(p_covered_vat + p_due_vat, 2) is distinct from round(p_grand_vat, 2)
     or round(p_covered_total + p_due_total, 2) is distinct from round(p_grand_total, 2) then
    raise exception 'confirm_invoice: covered + amount due does not equal grand — subtotal % + % vs %; VAT % + % vs %; total % + % vs %.',
      p_covered_subtotal, p_due_subtotal, p_grand_subtotal,
      p_covered_vat, p_due_vat, p_grand_vat,
      p_covered_total, p_due_total, p_grand_total
      using hint = 'Reopen the invoice so the totals recompute, then confirm again.';
  end if;

  -- TIER C — the printed VAT is ONE document-level pass, rounded once.
  if round(p_grand_vat, 2) is distinct from round(p_grand_subtotal * public.vat_rate(), 2) then
    raise exception 'confirm_invoice: grand VAT is % — one document-level pass over the % subtotal at the KSA rate gives %.',
      p_grand_vat, p_grand_subtotal, round(p_grand_subtotal * public.vat_rate(), 2)
      using hint = 'Reopen the invoice so the totals recompute, then confirm again.';
  end if;

  -- =====================================================================
  -- End of 0191 assertions.
  -- =====================================================================

  v_year   := extract(year from (now() at time zone 'Asia/Riyadh')::date)::integer;
  v_seq    := public.next_invoice_number(v_year);
  v_number := lpad((v_year % 1000)::text, 3, '0') || '-' || lpad(v_seq::text, 6, '0');

  update public.invoices
     set status                    = 'confirmed',
         invoice_number            = v_number,
         confirmed_at              = now(),
         seller_snapshot           = p_seller_snapshot,
         buyer_snapshot            = p_buyer_snapshot,
         covered_lines             = p_covered_lines,
         unpaid_lines              = p_unpaid_lines,
         special_charges_snapshot  = p_special_charges,
         covered_trip_ids          = p_covered_trip_ids,
         unpaid_trip_ids           = p_unpaid_trip_ids,
         covered_subtotal_sar      = p_covered_subtotal,
         covered_vat_sar           = p_covered_vat,
         covered_total_sar         = p_covered_total,
         amount_due_subtotal_sar   = p_due_subtotal,
         amount_due_vat_sar        = p_due_vat,
         amount_due_sar            = p_due_total,
         grand_subtotal_sar        = p_grand_subtotal,
         grand_vat_sar             = p_grand_vat,
         grand_total_sar           = p_grand_total,
         covered_ledger_subtotal_sar  = p_covered_ledger_subtotal,
         covered_ledger_balance_sar   = p_covered_ledger_balance,
         covered_ledger_remaining_sar = p_covered_ledger_remaining,
         unpaid_ledger_subtotal_sar   = p_unpaid_ledger_subtotal,
         unpaid_ledger_balance_sar    = p_unpaid_ledger_balance,
         unpaid_ledger_remaining_sar  = p_unpaid_ledger_remaining,
         payment_mode                 = p_payment_mode
   where id = p_invoice_id
     and status = 'review'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Invoice is not in review status (or does not exist) — cannot confirm.';
  end if;

  -- =====================================================================
  -- 0203 PREPAID DRAW — the ledger draw happens at confirm, and ONLY here.
  -- Draft/review never draw. Available is read AFTER the status flip:
  -- v_customer_uninvoiced counts trips with invoice_id null OR a
  -- draft/review invoice, and charges on draft/review invoices. Once this
  -- invoice is 'confirmed', BOTH arms exclude its items in the same
  -- instant — the draw sees them exactly once (inside grand_total), never
  -- twice (also in Uninvoiced). The flip-then-read order and the view's
  -- draft/review filter are two halves of the same rule.
  -- =====================================================================

  select payment_mode into v_cust_mode
    from public.customers where id = v_row.customer_id for update;

  if v_cust_mode = 'prepaid' then
    select b.balance_sar into v_balance
      from public.v_customer_ledger_balance b where b.customer_id = v_row.customer_id;
    select u.uninvoiced_sar into v_uninvoiced
      from public.v_customer_uninvoiced u where u.customer_id = v_row.customer_id;

    v_available := round(coalesce(v_balance, 0) - coalesce(v_uninvoiced, 0), 2);
    v_draw      := round(least(greatest(v_available, 0), v_row.grand_total_sar), 2);
    v_payable   := round(v_row.grand_total_sar - v_draw, 2);

    if v_draw > 0 then
      insert into public.customer_ledger
        (customer_id, entry_type, amount_sar, invoice_id, note, created_by)
      values
        (v_row.customer_id, 'invoice_draw', -v_draw, p_invoice_id,
         'Draw at confirm — invoice ' || v_number, p_actor);
    end if;

    update public.invoices
       set prepaid_applied_sar = v_draw,
           amount_payable_sar  = v_payable
     where id = p_invoice_id;

    if v_payable = 0 then
      update public.invoices
         set status = 'paid', paid_at = now()
       where id = p_invoice_id;

      update public.trips
         set invoice_id = p_invoice_id
       where id = any(coalesce(v_row.covered_trip_ids, array[]::uuid[])
                 || coalesce(v_row.unpaid_trip_ids, array[]::uuid[]));
    end if;
  else
    update public.invoices
       set prepaid_applied_sar = 0,
           amount_payable_sar  = round(v_row.grand_total_sar, 2)
     where id = p_invoice_id;
  end if;

  select * into v_row from public.invoices where id = p_invoice_id;
  return v_row;
end;
$$;

revoke execute on function public.confirm_invoice(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[],
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, text, text) from anon, public;
grant execute on function public.confirm_invoice(
  uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], uuid[],
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, text, text) to authenticated, service_role;

-- =========================================================================
-- 11. void_invoice — reworked. Accepts status in ('confirmed','paid'):
--     a paid invoice voids the same way (number never reused, trips
--     released). Paired draw_reversal rows for every un-reversed
--     invoice_draw AND balance_applied row restore the ledger.
--     invoice_payments rows are NOT deleted (append-only) — a cash refund
--     of money actually received is recorded OUTSIDE this function.
--     Adds p_actor, so the old signature is dropped first.
-- =========================================================================

drop function if exists public.void_invoice(uuid, text);

create function public.void_invoice(
  p_invoice_id uuid,
  p_reason     text,
  p_actor      text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.invoices;
  v_entry public.customer_ledger;
begin
  update public.invoices
     set status      = 'void',
         voided_at   = now(),
         void_reason = p_reason
   where id = p_invoice_id
     and status in ('confirmed', 'paid')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Invoice is not in confirmed or paid status (or does not exist) — cannot void.';
  end if;

  -- Release: void frees every trip this invoice had reserved.
  update public.trips
     set invoice_id = null
   where invoice_id = p_invoice_id;

  -- Reverse the ledger: one paired row per un-reversed negative row. The
  -- draw stays on the books; the reversal restores the balance. Append-only.
  perform 1 from public.customers where id = v_row.customer_id for update;

  for v_entry in
    select * from public.customer_ledger cl
     where cl.invoice_id = p_invoice_id
       and cl.entry_type in ('invoice_draw', 'balance_applied')
       and not exists (select 1 from public.customer_ledger r where r.reversal_of = cl.id)
  loop
    insert into public.customer_ledger
      (customer_id, entry_type, amount_sar, invoice_id, reversal_of, note, created_by)
    values
      (v_entry.customer_id, 'draw_reversal', -v_entry.amount_sar, p_invoice_id, v_entry.id,
       'Void reversal of ' || v_entry.entry_type || ' — invoice '
         || coalesce(v_row.invoice_number, p_invoice_id::text), p_actor);
  end loop;

  return v_row;
end;
$$;

revoke execute on function public.void_invoice(uuid, text, text) from anon, public;
grant execute on function public.void_invoice(uuid, text, text) to authenticated, service_role;

-- =========================================================================
-- 12. unpay_invoice — same signature; new guard: an invoice settled through
--     the ledger or through recorded payments cannot be un-paid.
-- =========================================================================

create or replace function public.unpay_invoice(p_invoice_id uuid, p_reason text, p_by text)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.invoices;
begin
  if exists (select 1 from public.invoice_payments ip where ip.invoice_id = p_invoice_id) then
    raise exception 'This invoice has recorded payment rows — un-pay is not available. Void the invoice instead; payments stay on the books.';
  end if;
  if exists (select 1 from public.customer_ledger cl
              where cl.invoice_id = p_invoice_id and cl.entry_type = 'balance_applied') then
    raise exception 'This invoice was settled from the customer''s balance — un-pay is not available. Void the invoice instead; the void reverses the ledger.';
  end if;

  update public.invoices
     set status                = 'confirmed',
         paid_at               = null,
         payment_method        = null,
         proof_of_payment_path = null,
         payment_reference     = null,
         payment_date          = null,
         payment_note          = null,
         unpaid_at             = now(),
         unpaid_reason         = p_reason,
         unpaid_by             = p_by
   where id = p_invoice_id
     and status = 'paid'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Invoice is not in paid status (or does not exist) — cannot un-pay.';
  end if;

  -- NO trip release here (unchanged from 0030) — trips stay reserved to this
  -- invoice; only void/delete release. See 0030's header.

  return v_row;
end;
$$;

revoke execute on function public.unpay_invoice(uuid, text, text) from anon, public;
grant execute on function public.unpay_invoice(uuid, text, text) to authenticated, service_role;

-- =========================================================================
-- 13. can_switch_payment_mode — same signature, customer-level rule:
--     blocked while ledger Balance ≠ 0, or any confirmed invoice for the
--     customer still has a remainder > 0. p_current_balance is now ignored
--     (the server reads the ledger itself; param kept for call-site compat).
-- =========================================================================

create or replace function public.can_switch_payment_mode(
  p_project_id      uuid,
  p_new_mode        text,
  p_current_balance numeric default 0
)
returns table(blocked boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id  uuid;
  v_current_mode text;
  v_balance      numeric;
  v_open_count   integer;
  v_parts        text[] := '{}';
begin
  select p.customer_id, c.payment_mode
    into v_customer_id, v_current_mode
    from public.projects p
    join public.customers c on c.id = p.customer_id
   where p.id = p_project_id;

  if v_customer_id is null then
    raise exception 'Project not found.';
  end if;

  -- No-op resubmit of the current mode is never blocked.
  if v_current_mode = p_new_mode then
    return query select false, null::text;
    return;
  end if;

  -- Rule 1: the ledger balance must be exactly zero.
  select b.balance_sar into v_balance
    from public.v_customer_ledger_balance b
   where b.customer_id = v_customer_id;

  if coalesce(v_balance, 0) <> 0 then
    v_parts := v_parts || ('ledger balance ' || to_char(v_balance, 'FM999,999,990.00') || ' SAR');
  end if;

  -- Rule 2: no confirmed invoice for this customer with money still owed.
  select count(*) into v_open_count
    from public.v_invoice_settlement s
   where s.customer_id = v_customer_id
     and s.status = 'confirmed'
     and coalesce(s.remainder_sar, 0) > 0;

  if v_open_count > 0 then
    v_parts := v_parts || (v_open_count::text || ' confirmed invoice(s) with money still owed');
  end if;

  if array_length(v_parts, 1) is null then
    return query select false, null::text;
  else
    return query select true, ('Can''t switch: ' || array_to_string(v_parts, ', ') || ' — settle these first.');
  end if;
end;
$$;

revoke execute on function public.can_switch_payment_mode(uuid, text, numeric) from anon, public;
grant execute on function public.can_switch_payment_mode(uuid, text, numeric) to authenticated, service_role;

-- =========================================================================
-- 14. archive_project_guarded — same signature; new rule: blocked while
--     ledger Balance ≠ 0 OR Uninvoiced > 0. Override-with-reason mechanics
--     kept: a written reason still archives; a write-off row is recorded
--     only when the customer actually OWES (Uninvoiced − Balance > 0).
-- =========================================================================

create or replace function public.archive_project_guarded(
  p_project_id      uuid,
  p_override_reason text default null,
  p_actor           text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_cust_id    uuid;
  v_balance    numeric;
  v_uninvoiced numeric;
  v_owed       numeric;
  v_blocked    boolean;
  v_reason     text := nullif(btrim(coalesce(p_override_reason, '')), '');
begin
  select customer_id into v_cust_id from public.projects where id = p_project_id;
  if v_cust_id is null then raise exception 'Project not found.'; end if;

  select a.balance_sar, a.uninvoiced_sar
    into v_balance, v_uninvoiced
    from public.v_customer_available a
   where a.customer_id = v_cust_id;

  v_balance    := coalesce(v_balance, 0);
  v_uninvoiced := coalesce(v_uninvoiced, 0);
  v_owed       := round(v_uninvoiced - v_balance, 2);
  v_blocked    := (v_balance <> 0) or (v_uninvoiced > 0);

  if v_blocked and v_reason is null then
    if v_owed > 0 then
      raise exception
        'This customer still owes % SAR (uninvoiced work minus balance). Archiving is blocked until it is settled, or overridden with a written reason.',
        to_char(v_owed, 'FM999,999,990.00')
        using errcode = 'check_violation';
    else
      raise exception
        'This customer still holds a ledger balance of % SAR. Refund it before archiving, or override with a written reason.',
        to_char(v_balance, 'FM999,999,990.00')
        using errcode = 'check_violation';
    end if;
  end if;

  if v_blocked and v_owed > 0 then
    insert into public.customer_write_offs
      (customer_id, project_id, amount_sar, reason, written_off_by)
    values
      (v_cust_id, p_project_id, v_owed, v_reason, nullif(btrim(coalesce(p_actor, '')), ''))
    on conflict (customer_id) where reversed_at is null do nothing;
  end if;

  update public.projects  set archived_at = now() where id = p_project_id and archived_at is null;
  update public.customers set archived_at = now() where id = v_cust_id   and archived_at is null;

  return p_project_id;
end;
$$;

revoke execute on function public.archive_project_guarded(uuid, text, text) from anon, public;
grant execute on function public.archive_project_guarded(uuid, text, text) to authenticated, service_role;

-- =========================================================================
-- 15. v_active_alerts — full replacement (42P16: same columns, same order).
--     Only the two prepaid arms change: overdrawn reads the ledger Balance,
--     low-runway reads Available; prepaid customers now selected by
--     customers.payment_mode. Every other arm is verbatim.
-- =========================================================================

create or replace view public.v_active_alerts as
with th as (
  select coalesce(u.low_runway_trips, (select notification_thresholds.low_runway_trips
            from notification_thresholds limit 1), 10::numeric) as low_runway_trips,
         coalesce(u.doc_expiry_lead_days, (select notification_thresholds.doc_expiry_lead_days
            from notification_thresholds limit 1), 30) as lead_days,
         coalesce(u.maintenance_stuck_days, (select notification_thresholds.maintenance_stuck_days
            from notification_thresholds limit 1), 7) as stuck_days,
         coalesce(u.invoice_overdue_red_days, (select notification_thresholds.invoice_overdue_red_days
            from notification_thresholds limit 1), 30) as red_days
    from (select auth.uid() as uid) me
    left join notification_thresholds_user u on u.user_id = me.uid
), riyadh as (
  select (now() at time zone 'Asia/Riyadh')::date as today
), prepaid_cust as (
  select p.customer_id,
         max(p.rate_per_trip_sar) as top_rate,
         count(*)::integer as prepaid_projects
    from projects p
    join customers c on c.id = p.customer_id
   where p.archived_at is null and c.archived_at is null and c.payment_mode = 'prepaid'
   group by p.customer_id
), doc_effective as (
  select a.id,
         a.title,
         coalesce((select r.expiry_date
                     from archive_document_renewals r
                    where r.document_id = a.id and r.superseded_at is null
                    order by r.expiry_date desc nulls last
                    limit 1), a.expiry_date) as expiry_date,
         coalesce(g.warning_days, (select th.lead_days from th)) as lead_days
    from archive_documents a
    left join archive_document_groups g on g.id = a.group_id
)
select 'prepaid_overdrawn:customer:' || k.customer_id::text as alert_identity,
       'yellow'::text as severity,
       'finance'::text as category,
       'customer'::text as entity_type,
       k.customer_id as entity_id,
       b.customer_name as entity_label,
       b.balance_sar as value_num,
       null::date as value_date,
       jsonb_build_object('balance_sar', b.balance_sar, 'top_rate_per_trip_sar', k.top_rate,
                          'prepaid_projects', k.prepaid_projects) as payload
  from prepaid_cust k
  join v_customer_ledger_balance b on b.customer_id = k.customer_id
 where b.balance_sar < 0
union all
select 'prepaid_low_runway:customer:' || k.customer_id::text as alert_identity,
       'yellow'::text as severity,
       'finance'::text as category,
       'customer'::text as entity_type,
       k.customer_id as entity_id,
       a.customer_name as entity_label,
       a.available_sar as value_num,
       null::date as value_date,
       jsonb_build_object('balance_sar', a.balance_sar, 'available_sar', a.available_sar,
                          'top_rate_per_trip_sar', k.top_rate, 'low_runway_trips', th.low_runway_trips,
                          'trips_of_runway',
                          case when coalesce(k.top_rate, 0) > 0
                               then round(a.available_sar / k.top_rate, 1)
                               else null::numeric end,
                          'prepaid_projects', k.prepaid_projects) as payload
  from prepaid_cust k
  join v_customer_available a on a.customer_id = k.customer_id
  cross join th
 where a.balance_sar >= 0
   and a.available_sar < (th.low_runway_trips * coalesce(k.top_rate, 0))
union all
select ('doc_expiry:driver:' || d.id::text) || ':license' as alert_identity,
       'red'::text, 'compliance'::text, 'driver'::text, d.id, d.name,
       null::numeric, d.license_expiry,
       jsonb_build_object('field', 'license_expiry', 'expiry_date', d.license_expiry)
  from drivers d cross join riyadh r
 where d.terminated_at is null and d.license_expiry is not null and d.license_expiry < r.today
union all
select ('doc_expiry:driver:' || d.id::text) || ':iqama',
       'red'::text, 'compliance'::text, 'driver'::text, d.id, d.name,
       null::numeric, d.iqama_expiry,
       jsonb_build_object('field', 'iqama_expiry', 'expiry_date', d.iqama_expiry)
  from drivers d cross join riyadh r
 where d.terminated_at is null and d.iqama_expiry is not null and d.iqama_expiry < r.today
union all
select ('doc_expiry:staff:' || s.id::text) || ':iqama',
       'red'::text, 'compliance'::text, 'staff'::text, s.id, s.name,
       null::numeric, s.iqama_expiry,
       jsonb_build_object('field', 'iqama_expiry', 'expiry_date', s.iqama_expiry)
  from staff s cross join riyadh r
 where s.terminated_at is null and s.iqama_expiry is not null and s.iqama_expiry < r.today
union all
select ('doc_expiry:truck:' || t.id::text) || ':registration',
       'red'::text, 'compliance'::text, 'truck'::text, t.id, t.plate,
       null::numeric, t.registration_expiry,
       jsonb_build_object('field', 'registration_expiry', 'expiry_date', t.registration_expiry)
  from trucks t cross join riyadh r
 where t.terminated_at is null and t.registration_expiry is not null and t.registration_expiry < r.today
union all
select 'doc_expiry:document:' || de.id::text,
       'red'::text, 'compliance'::text, 'document'::text, de.id, de.title,
       null::numeric, de.expiry_date,
       jsonb_build_object('field', 'archive_document', 'expiry_date', de.expiry_date)
  from doc_effective de cross join riyadh r
 where de.expiry_date is not null and de.expiry_date < r.today
union all
select 'part_reorder:part:' || p.id::text,
       'red'::text, 'inventory'::text, 'part'::text, p.id, p.name,
       p.qty_on_hand, null::date,
       jsonb_build_object('sku', p.sku, 'qty_on_hand', p.qty_on_hand,
                          'reorder_level', p.reorder_level, 'unit', p.unit)
  from parts p
 where p.active and p.reorder_level is not null and p.qty_on_hand <= p.reorder_level
union all
select 'wo_stuck:work_order:' || w.id::text,
       'red'::text, 'maintenance'::text, 'work_order'::text, w.id,
       coalesce(w.wo_number, w.title),
       (r.today - w.opened_at::date)::numeric, w.opened_at::date,
       jsonb_build_object('wo_number', w.wo_number, 'truck_id', w.truck_id,
                          'status', w.status, 'days_open', r.today - w.opened_at::date)
  from work_orders w cross join riyadh r cross join th
 where (w.status = any (array['open'::text, 'in_progress'::text, 'awaiting_parts'::text]))
   and w.opened_at is not null and w.opened_at::date < (r.today - th.stuck_days)
union all
select 'invoice_overdue:invoice:' || ro.invoice_id::text,
       case when ro.days_outstanding > th.red_days then 'red'::text else 'yellow'::text end,
       'finance'::text, 'invoice'::text, ro.invoice_id, ro.invoice_number,
       ro.outstanding_sar, ro.period_end,
       jsonb_build_object('customer_name', ro.customer_name, 'outstanding_sar', ro.outstanding_sar,
                          'days_outstanding', ro.days_outstanding, 'aging_bucket', ro.aging_bucket)
  from v_receivables_open ro
  join v_invoice_outstanding_live o on o.invoice_id = ro.invoice_id
  cross join th
 where o.effective_payment_mode = 'postpaid'::text and ro.days_outstanding > 0
union all
select ('doc_expiry:driver:' || d.id::text) || ':license',
       'yellow'::text, 'compliance'::text, 'driver'::text, d.id, d.name,
       null::numeric, d.license_expiry,
       jsonb_build_object('field', 'license_expiry', 'expiry_date', d.license_expiry)
  from drivers d cross join riyadh r cross join th
 where d.terminated_at is null and d.license_expiry is not null
   and d.license_expiry >= r.today and d.license_expiry < (r.today + th.lead_days)
union all
select ('doc_expiry:driver:' || d.id::text) || ':iqama',
       'yellow'::text, 'compliance'::text, 'driver'::text, d.id, d.name,
       null::numeric, d.iqama_expiry,
       jsonb_build_object('field', 'iqama_expiry', 'expiry_date', d.iqama_expiry)
  from drivers d cross join riyadh r cross join th
 where d.terminated_at is null and d.iqama_expiry is not null
   and d.iqama_expiry >= r.today and d.iqama_expiry < (r.today + th.lead_days)
union all
select ('doc_expiry:staff:' || s.id::text) || ':iqama',
       'yellow'::text, 'compliance'::text, 'staff'::text, s.id, s.name,
       null::numeric, s.iqama_expiry,
       jsonb_build_object('field', 'iqama_expiry', 'expiry_date', s.iqama_expiry)
  from staff s cross join riyadh r cross join th
 where s.terminated_at is null and s.iqama_expiry is not null
   and s.iqama_expiry >= r.today and s.iqama_expiry < (r.today + th.lead_days)
union all
select ('doc_expiry:truck:' || t.id::text) || ':registration',
       'yellow'::text, 'compliance'::text, 'truck'::text, t.id, t.plate,
       null::numeric, t.registration_expiry,
       jsonb_build_object('field', 'registration_expiry', 'expiry_date', t.registration_expiry)
  from trucks t cross join riyadh r cross join th
 where t.terminated_at is null and t.registration_expiry is not null
   and t.registration_expiry >= r.today and t.registration_expiry < (r.today + th.lead_days)
union all
select 'doc_expiry:document:' || de.id::text,
       'yellow'::text, 'compliance'::text, 'document'::text, de.id, de.title,
       null::numeric, de.expiry_date,
       jsonb_build_object('field', 'archive_document', 'expiry_date', de.expiry_date,
                          'lead_days', de.lead_days)
  from doc_effective de cross join riyadh r
 where de.expiry_date is not null and de.expiry_date >= r.today
   and de.expiry_date < (r.today + de.lead_days)
union all
select (((('leave_return:' || case when l.driver_id is not null then 'driver'::text else 'staff'::text end)
        || ':') || coalesce(l.driver_id, l.staff_id)::text) || ':') || l.id::text,
       'yellow'::text, 'people'::text,
       case when l.driver_id is not null then 'driver'::text else 'staff'::text end,
       coalesce(l.driver_id, l.staff_id), coalesce(d.name, s.name),
       (l.end_date - r.today)::numeric, l.end_date,
       jsonb_build_object('leave_type', l.leave_type, 'end_date', l.end_date,
                          'days_until_return', l.end_date - r.today)
  from leave_periods l
  cross join riyadh r
  left join drivers d on d.id = l.driver_id
  left join staff s on s.id = l.staff_id
 where l.end_date is not null and l.end_date > r.today and l.end_date <= (r.today + 3)
   and coalesce(d.terminated_at, s.terminated_at) is null
union all
select 'permit_overdue:exit_permit:' || e.id::text,
       'yellow'::text, 'inventory'::text, 'exit_permit'::text, e.id, e.ep_number,
       (r.today - e.expected_return_on)::numeric, e.expected_return_on,
       jsonb_build_object('ep_number', e.ep_number, 'expected_return_on', e.expected_return_on,
                          'days_overdue', r.today - e.expected_return_on)
  from exit_permits e cross join riyadh r
 where e.status = 'exited'::text and e.expected_return_on is not null
   and e.expected_return_on < r.today
   and (exists (select 1 from exit_permit_lines el
                 where el.exit_permit_id = e.id
                   and (coalesce(el.qty_returned, 0) + coalesce(el.qty_written_off, 0)) < el.qty))
union all
select 'truck_in:work_order:' || w.id::text,
       'blue'::text, 'event'::text, 'truck'::text, w.truck_id,
       (coalesce(t.plate, '(no truck)') || ' · ') || coalesce(w.wo_number, w.title, '(no number)'),
       null::numeric, w.opened_at::date,
       jsonb_build_object('plate', t.plate, 'wo_number', w.wo_number, 'truck_id', w.truck_id)
  from work_orders w
  cross join riyadh r
  left join trucks t on t.id = w.truck_id
 where w.opened_at is not null and (w.opened_at at time zone 'Asia/Riyadh')::date = r.today
union all
select 'truck_out:work_order:' || w.id::text,
       'blue'::text, 'event'::text, 'truck'::text, w.truck_id,
       (coalesce(t.plate, '(no truck)') || ' · ') || coalesce(w.wo_number, w.title, '(no number)'),
       null::numeric, w.closed_at::date,
       jsonb_build_object('plate', t.plate, 'wo_number', w.wo_number, 'truck_id', w.truck_id)
  from work_orders w
  cross join riyadh r
  left join trucks t on t.id = w.truck_id
 where w.closed_at is not null and (w.closed_at at time zone 'Asia/Riyadh')::date = r.today
union all
select (((('employee_returned:' || case when l.driver_id is not null then 'driver'::text else 'staff'::text end)
        || ':') || coalesce(l.driver_id, l.staff_id)::text) || ':') || l.id::text,
       'blue'::text, 'event'::text,
       case when l.driver_id is not null then 'driver'::text else 'staff'::text end,
       coalesce(l.driver_id, l.staff_id), coalesce(d.name, s.name),
       null::numeric, l.end_date,
       jsonb_build_object('leave_type', l.leave_type, 'end_date', l.end_date)
  from leave_periods l
  cross join riyadh r
  left join drivers d on d.id = l.driver_id
  left join staff s on s.id = l.staff_id
 where l.end_date = r.today and coalesce(d.terminated_at, s.terminated_at) is null;

alter view public.v_active_alerts set (security_invoker = true);
revoke all on public.v_active_alerts from anon;
grant select on public.v_active_alerts to authenticated;

-- =========================================================================
-- 16. v_activity_feed — full replacement (42P16: same columns, same order).
--     Only the topup arm changes: it now reads customer_ledger topup rows
--     (with the recording actor). Every other arm is verbatim.
-- =========================================================================

create or replace view public.v_activity_feed as
select t.delivered_at as occurred_at,
       'trip_delivered'::text as kind,
       'trip'::text as entity,
       t.id as entity_id,
       coalesce(t.ref, 'Trip'::text) as title,
       t.water_station as subtitle,
       null::text as actor
  from trips t
  left join projects tp on tp.id = t.project_id
  left join customers tc on tc.id = tp.customer_id
 where t.delivered_at is not null
   and (tp.archived_at is null or t.delivered_at < tp.archived_at)
   and (tc.archived_at is null or t.delivered_at < tc.archived_at)
union all
select i.confirmed_at, 'invoice_confirmed'::text, 'invoice'::text, i.id,
       coalesce(i.invoice_number, 'Invoice'::text), c.name, null::text
  from invoices i
  left join customers c on c.id = i.customer_id
 where i.confirmed_at is not null and (c.archived_at is null or i.confirmed_at < c.archived_at)
union all
select i.paid_at, 'invoice_paid'::text, 'invoice'::text, i.id,
       coalesce(i.invoice_number, 'Invoice'::text), c.name, null::text
  from invoices i
  left join customers c on c.id = i.customer_id
 where i.paid_at is not null and (c.archived_at is null or i.paid_at < c.archived_at)
union all
select i.voided_at, 'invoice_voided'::text, 'invoice'::text, i.id,
       coalesce(i.invoice_number, 'Invoice'::text), c.name, i.unpaid_by
  from invoices i
  left join customers c on c.id = i.customer_id
 where i.voided_at is not null and (c.archived_at is null or i.voided_at < c.archived_at)
union all
select w.opened_at, 'work_order_opened'::text, 'work_order'::text, w.id,
       coalesce(w.wo_number, 'Work order'::text), tk.plate, w.created_by
  from work_orders w
  left join trucks tk on tk.id = w.truck_id
 where w.opened_at is not null
union all
select w.closed_at, 'work_order_completed'::text, 'work_order'::text, w.id,
       coalesce(w.wo_number, 'Work order'::text), tk.plate, w.completed_by
  from work_orders w
  left join trucks tk on tk.id = w.truck_id
 where w.closed_at is not null
union all
select o.created_at, 'outsourced_opened'::text, 'outsourced_job'::text, o.id,
       coalesce(o.os_number, 'Outsourced job'::text), tk.plate, o.created_by
  from outsourced_jobs o
  left join trucks tk on tk.id = o.truck_id
 where o.created_at is not null
union all
select o.closed_at, 'outsourced_completed'::text, 'outsourced_job'::text, o.id,
       coalesce(o.os_number, 'Outsourced job'::text), tk.plate, o.completed_by
  from outsourced_jobs o
  left join trucks tk on tk.id = o.truck_id
 where o.closed_at is not null
union all
select e.exited_at, 'permit_exited'::text, 'exit_permit'::text, e.id,
       coalesce(e.ep_number, 'Exit permit'::text), e.receiver_name, e.exited_by
  from exit_permits e
 where e.exited_at is not null
union all
select e.voided_at, 'permit_voided'::text, 'exit_permit'::text, e.id,
       coalesce(e.ep_number, 'Exit permit'::text), e.void_reason, e.voided_by
  from exit_permits e
 where e.voided_at is not null
union all
select ca.decided_at, 'consumption_decided'::text, 'consumption_approval'::text, ca.id,
       ca.decision, null::text, ca.decided_by
  from consumption_approvals ca
 where ca.decided_at is not null
union all
select po.issued_at, 'po_issued'::text, 'purchase_order'::text, po.id,
       coalesce(po.po_number, 'Purchase order'::text), su.name, po.requested_by
  from purchase_orders po
  left join suppliers su on su.id = po.supplier_id
 where po.issued_at is not null
union all
select po.rejected_at, 'po_rejected'::text, 'purchase_order'::text, po.id,
       coalesce(po.po_number, 'Purchase order'::text), po.rejection_reason, po.rejected_by
  from purchase_orders po
 where po.rejected_at is not null
union all
select pa.approved_at, 'po_approved'::text, 'purchase_order'::text, pa.purchase_order_id,
       coalesce(po.po_number, 'Purchase order'::text), null::text, pa.approver_email
  from purchase_order_approvals pa
  left join purchase_orders po on po.id = pa.purchase_order_id
 where pa.approved_at is not null
union all
select sr.created_at, 'stock_received'::text, 'stock_receipt'::text, sr.id,
       coalesce(su.name, 'Stock receipt'::text), wh.name, sr.received_by
  from stock_receipts sr
  left join suppliers su on su.id = sr.supplier_id
  left join warehouses wh on wh.id = sr.warehouse_id
 where sr.created_at is not null
union all
select cl.created_at, 'topup_added'::text, 'customer'::text, cl.customer_id,
       c.name, cl.reference, cl.created_by
  from customer_ledger cl
  left join customers c on c.id = cl.customer_id
 where cl.entry_type = 'topup'
   and cl.created_at is not null
   and (c.archived_at is null or cl.created_at < c.archived_at)
union all
select cp.paid_at, 'commission_paid'::text, 'driver'::text, cp.driver_id,
       d.name, cp.period_label, cp.approved_by
  from commission_payouts cp
  left join drivers d on d.id = cp.driver_id
 where cp.paid_at is not null
union all
select x.created_at, 'expense_recorded'::text, 'expense'::text, x.id,
       x.category, x.note, x.entered_by
  from expenses x
 where x.created_at is not null
union all
select ad.created_at, 'document_filed'::text, 'archive_document'::text, ad.id,
       ad.title, ad.issuing_entity, ad.created_by
  from archive_documents ad
 where ad.created_at is not null;

alter view public.v_activity_feed set (security_invoker = true);
revoke all on public.v_activity_feed from anon;
grant select on public.v_activity_feed to authenticated;

-- =========================================================================
-- 17. VERIFICATION — raise on failure only.
-- =========================================================================

do $$
declare
  v_cnt int;
  v_bad text;
begin
  -- Counters + numbering functions exist.
  if to_regclass('public.topup_receipt_counter') is null
     or to_regclass('public.credit_note_counter') is null then
    raise exception '0203 verification: a numbering counter table is missing.';
  end if;
  if to_regprocedure('public.next_topup_receipt_number(integer)') is null
     or to_regprocedure('public.next_credit_note_number(integer)') is null then
    raise exception '0203 verification: a numbering function is missing.';
  end if;

  -- Ledger integrity constraints present.
  select count(*) into v_cnt
    from pg_constraint
   where conrelid = 'public.customer_ledger'::regclass
     and conname in ('customer_ledger_entry_type_check',
                     'customer_ledger_sign_check',
                     'customer_ledger_invoice_link_check',
                     'customer_ledger_doc_number_check',
                     'customer_ledger_reversal_check');
  if v_cnt <> 5 then
    raise exception '0203 verification: customer_ledger has % of 5 integrity checks.', v_cnt;
  end if;

  -- Every new/replaced view: security_invoker and NOT anon-readable.
  select count(*) into v_cnt
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and c.relname in ('v_customer_ledger_balance','v_customer_uninvoiced',
                       'v_customer_available','v_invoice_settlement',
                       'v_active_alerts','v_activity_feed');
  if v_cnt <> 6 then
    raise exception '0203 verification: expected 6 views, found %.', v_cnt;
  end if;

  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and c.relname in ('v_customer_ledger_balance','v_customer_uninvoiced',
                       'v_customer_available','v_invoice_settlement',
                       'v_active_alerts','v_activity_feed')
     and ((c.reloptions @> array['security_invoker=true']) is not true
          or has_table_privilege('anon', c.oid, 'select'));
  if v_bad is not null then
    raise exception '0203 verification: view(s) missing security footer: %.', v_bad;
  end if;

  -- No new/recreated function may be executable by anon (catches direct
  -- anon grants AND grants to PUBLIC, which anon inherits).
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ') into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('next_topup_receipt_number','next_credit_note_number',
                       'record_topup','record_refund','apply_balance_to_invoice',
                       'record_invoice_payment','propose_ledger_correction',
                       'vote_ledger_correction','confirm_invoice','void_invoice',
                       'unpay_invoice','can_switch_payment_mode','archive_project_guarded')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception '0203 verification: function(s) executable by anon: %.', v_bad;
  end if;

  -- customers.payment_mode: NOT NULL, no nulls, valid values only.
  if exists (select 1 from public.customers where payment_mode is null) then
    raise exception '0203 verification: customers.payment_mode has NULLs after backfill.';
  end if;
  if exists (select 1 from public.customers where payment_mode not in ('prepaid','postpaid')) then
    raise exception '0203 verification: customers.payment_mode has an invalid value.';
  end if;

  -- Every customer with a prepaid project came out prepaid.
  if exists (select 1 from public.projects p
               join public.customers c on c.id = p.customer_id
              where p.payment_mode = 'prepaid' and c.payment_mode <> 'prepaid') then
    raise exception '0203 verification: a prepaid-project customer was not backfilled prepaid.';
  end if;
end $$;

commit;
