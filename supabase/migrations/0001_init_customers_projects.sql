-- ============================================================================
-- Bousla — Phase 1 schema: customers + projects
-- Run this in the Supabase SQL editor.
-- ============================================================================

-- gen_random_uuid() lives in the pgcrypto extension. Supabase usually has it
-- enabled already; this is a safe no-op if so.
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- customers
-- A customer is the organization that orders water deliveries: construction
-- companies, government offices, or facility-management (FM) companies.
-- ----------------------------------------------------------------------------
create table if not exists public.customers (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  name_ar               text,
  contact_name          text,
  phone                 text,
  -- Restrict to the three real customer categories.
  customer_type         text not null
                          check (customer_type in ('construction', 'government_office', 'facility_management')),
  delivery_site_address text,
  delivery_lat          double precision,
  delivery_lng          double precision,
  -- How the customer settles: invoiced later vs. pay per delivery.
  payment_model         text not null default 'postpaid'
                          check (payment_model in ('postpaid', 'pay_as_you_go')),
  active                boolean not null default true,
  created_at            timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- projects
-- A project belongs to one customer and defines the per-trip rate and how
-- driver commission is calculated for trips on that project.
-- ----------------------------------------------------------------------------
create table if not exists public.projects (
  id                uuid primary key default gen_random_uuid(),
  -- FK to customers. Deleting a customer with projects is blocked (restrict).
  customer_id       uuid not null references public.customers(id) on delete restrict,
  name              text not null,
  rate_per_trip_sar numeric(12, 2) not null default 0,
  -- 'fixed'   = commission_value is paid per trip, unchanged.
  -- 'scalable'= commission grows per trip by commission_value (percent step).
  -- Driver-commission model. rate_per_trip_sar above is the CUSTOMER billing
  -- rate; the columns below are the DRIVER's commission, kept separate.
  --   'fixed'    = every delivered trip pays commission_value (flat).
  --   'scalable' = trip n pays commission_value * (1 + (n-1) * step%/100),
  --                where the step % lives in projects.commission_bump_pct
  --                (added in 0004) and n resets per driver/project/month.
  commission_mode   text not null default 'fixed'
                      check (commission_mode in ('fixed', 'scalable')),
  -- Driver BASE commission per trip (SAR). See commission_mode above.
  commission_value  numeric(12, 2) not null default 0,
  start_date        date,
  end_date          date,  -- nullable = open-ended project
  status            text not null default 'active'
                      check (status in ('active', 'paused', 'ended')),
  created_at        timestamptz not null default now()
);

-- Speeds up "projects for this customer" lookups.
create index if not exists projects_customer_id_idx on public.projects(customer_id);

-- ============================================================================
-- Row Level Security
-- RLS is OFF by default once enabled means: no row is readable/writable unless
-- a policy allows it. The policies below grant full read/write ONLY to the
-- 'authenticated' role (i.e. a logged-in Supabase Auth user). The 'anon' role
-- (a visitor with just the public anon key and no session) gets nothing.
-- ============================================================================
alter table public.customers enable row level security;
alter table public.projects  enable row level security;

-- customers: any logged-in user may read and write every row.
--   using       -> rows visible to SELECT/UPDATE/DELETE
--   with check  -> rows allowed on INSERT/UPDATE
drop policy if exists "authenticated_all_customers" on public.customers;
create policy "authenticated_all_customers"
  on public.customers
  for all
  to authenticated
  using (true)
  with check (true);

-- projects: same authenticated-only full access.
drop policy if exists "authenticated_all_projects" on public.projects;
create policy "authenticated_all_projects"
  on public.projects
  for all
  to authenticated
  using (true)
  with check (true);
