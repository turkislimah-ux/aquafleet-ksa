-- 0025_finance_invoicing_data_model.sql
-- Finance/Invoice feature — Commit 1: data model only (see
-- .planning/finance-invoice-spec.md v2). No app code depends on this yet.
--
-- Conflict note (see recon report delivered alongside this file): the PRD's
-- §4.1 "payment_mode" is modeled here as a NEW, ADDITIVE column on
-- `projects` — NOT as a change to the existing `customers.payment_model`
-- column (postpaid|pay_as_you_go, NOT NULL, default 'postpaid', live in
-- app/customers/actions.ts + CustomerForm.tsx + lib/db-types.ts). That
-- column is untouched here; touching it would be a BREAKING change to an
-- actively-used NOT NULL/defaulted/CHECK-constrained column, which per
-- CLAUDE.md's code-then-migrate rule must be sequenced with app code, not
-- done blind in a data-model-only commit. All 5 live customers are
-- currently 'postpaid' (pay_as_you_go unused) — reconciling/renaming that
-- field is deferred to whichever commit next touches customer app code.
--
-- Invoice numbering: gap-free + concurrency-safe via a dedicated singleton
-- counter table incremented by a single atomic UPDATE...RETURNING (see
-- next_invoice_number() below) — NOT a SERIAL/sequence, which advances on
-- rollback and would leave gaps. The raw integer is the canonical sequence
-- value; display formatting (prefix/padding) is deferred to app code per
-- PRD §14 (open item).
--
-- Customer-invoice lock (trips.invoice_id) is a SEPARATE nullable FK from
-- the existing commission lock (trips.payout_id) — mirrors that column's
-- exact pattern (nullable FK, "locked" is a derived condition checked in
-- app code, no DB trigger). The two locks reference different tables
-- (invoices vs commission_payouts) and are set independently by different
-- flows, so a trip can be commission-locked, invoice-locked, both, or
-- neither, with no coupling in the schema.

create extension if not exists pgcrypto;

begin;

-- ---------------------------------------------------------------------------
-- 1. payment_mode — additive, nullable, no default (per-project; see
--    conflict note above for why this is NOT on customers).
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists payment_mode text;

alter table public.projects
  drop constraint if exists projects_payment_mode_check;

alter table public.projects
  add constraint projects_payment_mode_check
  check (payment_mode is null or payment_mode in ('postpaid', 'prepaid'));

-- ---------------------------------------------------------------------------
-- 2. Buyer tax identity fields (nullable/optional) — for invoice buyer
--    snapshots and ZATCA-style invoice content.
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists vat_number text,
  add column if not exists cr_number text,
  add column if not exists billing_address text;

-- ---------------------------------------------------------------------------
-- 3. Company (seller) settings — single-row config. Singleton pattern:
--    boolean PK with a CHECK forcing it to `true` means only one row can
--    ever exist (a second row would need id = false, which the CHECK
--    rejects, or id = true again, which the PK rejects). No existing
--    precedent for this in the codebase; seeded with one placeholder row so
--    app code can always assume exactly one row exists.
-- ---------------------------------------------------------------------------
create table if not exists public.company_settings (
  id          boolean primary key default true,
  legal_name  text not null,
  vat_number  text,
  cr_number   text,
  address     text,
  updated_at  timestamptz not null default now(),
  constraint company_settings_singleton check (id)
);

insert into public.company_settings (id, legal_name)
values (true, 'Bin Slimah Group')
on conflict (id) do nothing;

alter table public.company_settings enable row level security;
drop policy if exists "authenticated_all_company_settings" on public.company_settings;
create policy "authenticated_all_company_settings"
  on public.company_settings for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4. Top-ups (prepaid credit ledger). Amounts are pre-VAT SAR (locked
--    decision, spec v2). topup_date is a plain date (trip_date convention),
--    not a timestamptz — this is the day the credit is FOR, not click-time.
-- ---------------------------------------------------------------------------
create table if not exists public.customer_topups (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  amount_sar  numeric(12, 2) not null check (amount_sar > 0),
  topup_date  date not null,
  note        text,
  reference   text,
  entered_by  text, -- free text, matches commission_payouts.approved_by precedent (no auth-user FK table)
  created_at  timestamptz not null default now()
);

create index if not exists customer_topups_customer_idx
  on public.customer_topups (customer_id);

alter table public.customer_topups enable row level security;
drop policy if exists "authenticated_all_customer_topups" on public.customer_topups;
create policy "authenticated_all_customer_topups"
  on public.customer_topups for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 5. Gap-free, concurrency-safe invoice numbering.
--
--    Why not SERIAL/nextval(): sequences are NOT transactional — a rolled-
--    back transaction still burns the number it drew, leaving a gap.
--    ZATCA-style sequential numbering must never gap.
--
--    Why this is gap-free: the counter only advances via a plain UPDATE,
--    which IS transactional — if the invoice-issuing transaction rolls
--    back, the UPDATE rolls back with it and the number is reused, not
--    burned.
--
--    Why this is concurrency-safe: UPDATE takes a row lock on the single
--    counter row for the duration of the transaction. A second concurrent
--    caller's UPDATE blocks until the first transaction commits or rolls
--    back, then sees the post-commit value — no explicit SELECT ... FOR
--    UPDATE needed, and no two callers can ever read/claim the same number.
--
--    Caller contract: next_invoice_number() MUST be called in the SAME
--    transaction as the write that stamps invoices.invoice_number and
--    flips status to 'issued' (app code, Commit 2+) — that's what makes
--    "number claimed" and "invoice issued" atomic together.
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_number_counter (
  id          boolean primary key default true,
  next_number integer not null default 1,
  constraint invoice_number_counter_singleton check (id)
);

insert into public.invoice_number_counter (id, next_number)
values (true, 1)
on conflict (id) do nothing;

create or replace function public.next_invoice_number()
returns integer
language sql
security definer
set search_path = public
as $$
  update public.invoice_number_counter
  set next_number = next_number + 1
  where id = true
  returning next_number - 1;
$$;

alter table public.invoice_number_counter enable row level security;
drop policy if exists "authenticated_all_invoice_number_counter" on public.invoice_number_counter;
create policy "authenticated_all_invoice_number_counter"
  on public.invoice_number_counter for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 6. Invoices. Full-period-only (locked decision, spec v2): no partial
--    payment structures, no payments table, no partially_paid status.
--    Seller/buyer snapshots are jsonb, mirroring commission_payouts.snapshot
--    — captured at issue time so later edits to company_settings/customers
--    never retroactively change an already-issued invoice. invoice_number
--    is nullable (draft invoices have none yet) and unique once assigned —
--    a unique index allows unlimited NULLs but at most one of each non-null
--    value, so multiple concurrent drafts never collide.
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id) on delete restrict,
  period_start    date not null,
  period_end      date not null,
  status          text not null default 'draft' check (status in ('draft', 'issued', 'paid')),
  invoice_number  integer,

  seller_snapshot jsonb, -- {legal_name, vat_number, cr_number, address} captured at issue time
  buyer_snapshot  jsonb, -- {name, vat_number, cr_number, billing_address} captured at issue time

  payment_method       text check (payment_method is null or payment_method in ('cash', 'bank_transfer')),
  proof_of_payment_path text, -- single storage-file reference; one proof per invoice (locked decision)

  subtotal_sar numeric(12, 2) not null default 0,
  vat_sar      numeric(12, 2) not null default 0,
  total_sar    numeric(12, 2) not null default 0,

  created_at timestamptz not null default now(),
  issued_at  timestamptz,
  paid_at    timestamptz,

  check (period_end >= period_start)
);

create unique index if not exists invoices_invoice_number_unique
  on public.invoices (invoice_number)
  where invoice_number is not null;

create index if not exists invoices_customer_idx
  on public.invoices (customer_id);

create index if not exists invoices_status_idx
  on public.invoices (status);

alter table public.invoices enable row level security;
drop policy if exists "authenticated_all_invoices" on public.invoices;
create policy "authenticated_all_invoices"
  on public.invoices for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 7. Special charges — per-invoice free-text label + pre-VAT amount
--    (locked decision, spec v2). Belong to exactly one invoice; deleted
--    with it (on delete cascade — a charge has no meaning detached from
--    its invoice).
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_special_charges (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  label      text not null,
  amount_sar numeric(12, 2) not null check (amount_sar > 0),
  created_at timestamptz not null default now()
);

create index if not exists invoice_special_charges_invoice_idx
  on public.invoice_special_charges (invoice_id);

alter table public.invoice_special_charges enable row level security;
drop policy if exists "authenticated_all_invoice_special_charges" on public.invoice_special_charges;
create policy "authenticated_all_invoice_special_charges"
  on public.invoice_special_charges for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 8. Trip <-> invoice linkage + customer-invoice lock. Nullable FK, same
--    shape as the existing trips.payout_id commission lock — deliberately
--    NOT merged with it (see header note). "Locked by invoice" is a
--    DERIVED condition (invoice_id is set AND that invoice's status =
--    'paid'), enforced in app code, not a DB trigger — matches how
--    payout_id locking already works (checked in setTripStage/
--    recomputeDailyCommission, not the DB).
-- ---------------------------------------------------------------------------
alter table public.trips
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null;

create index if not exists trips_invoice_idx
  on public.trips (invoice_id)
  where invoice_id is not null;

commit;
