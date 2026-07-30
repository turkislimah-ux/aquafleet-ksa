-- 0068_outsourced_jobs_schema_and_create.sql
-- Maintenance — Phase 4a: outsourced-jobs track schema + create_outsourced_job.
-- Turki's spec is the behavioral source of truth and OVERRIDES preview/ where
-- they differ; preview/'s pages-2.js outsourced-job code (OS_REPAIRERS/
-- OS_DESC_SAMPLES/status set) is the source for anything he didn't respecify.
--
-- *** ZERO STOCK/FIFO/MONEY-CORE COUPLING *** — nothing in this migration
-- references work_orders, work_order_parts, price_lots, consume_from_lots,
-- return_to_lots, work_order_part_consumptions, or any Inventory table.
-- The outside shop sources its own parts; this track never touches
-- consume_from_lots/return_to_lots at all, unlike the in-house track.
--
-- ENTITY SHAPE — separate from work_orders entirely (own id sequence, own
-- number format, own status set), not folded into it. Preview's own
-- outsourcedJobs was already a separate array/entity — this keeps that
-- shape, just with richer real tables behind it.
--
-- STATUS SET: scheduled -> in_progress -> completed. No 'cancelled'/
-- 'awaiting_parts' — preview's own OS status enum never had those either
-- (unlike in-house, which keeps them dormant for preview-parity). "Start"
-- is labelled "Dispatch" in the UI (app-code, Phase 4b) — the STORED value
-- stays 'in_progress', same "value stays, label changes" convention as
-- corrective -> "Repair" (0061-era precedent) — not a new status value.
--
-- REPAIRERS — a managed entity (name/name_ar/location/type/contact_name/
-- contact_number/description), inline-addable, MANY per job via a junction
-- table (outsourced_job_repairers) — not a single repairer_id column, since
-- not every shop does everything. `type` is its own small lookup
-- (repairer_types), not free text — preview's own OS_REPAIRERS seed has no
-- type field at all (just name+phone); this pick-list is Turki's own
-- addition on top of preview, seeded with a starter set for him to
-- prune/expand via the same inline-add pattern units/suppliers already use.
--
-- ONE responsible mechanic per job stays SINGULAR (internal, truck
-- custody) — a plain FK column on outsourced_jobs, separate from the
-- (multiple) external repairers. Same role eligibility as the in-house
-- assigned mechanic (staff.role='mechanic', active, not terminated) — an
-- assumption, flagged, since Turki didn't explicitly restate the role
-- check for this field.
--
-- DESCRIPTIONS — OS gets its OWN scoped catalog (outsourced_descriptions),
-- a SEPARATE TABLE from repair_descriptions (0060), not a shared table
-- with a context/discriminator column. Reasoning: this project already has
-- a direct precedent for exactly this call — CLAUDE.md's "water_stations
-- vs operation_stations are SEPARATE, do NOT unify" rule, for the same
-- "similar shape, genuinely distinct domain" situation. A context column
-- means every query everywhere must remember to filter by it — miss one
-- and an in-house chip leaks into OS or vice versa. A separate table makes
-- that structurally impossible instead of policy-enforced.
-- repair_descriptions (0060) is UNTOUCHED by this migration.
--
-- outsourced_job_tasks (not "descriptions") for the per-job checkable
-- instances — Turki wants Complete gated on all chips checked, same as
-- in-house, so these are genuinely tasks (done boolean), not preview's own
-- static description tags. Shape mirrors work_order_tasks exactly:
-- SNAPSHOT description_en/ar at creation time (no live FK back to the
-- catalog), same "don't retroactively reword history" convention.
--
-- MONEY — workshop_payments, NOT a single cost field on the job:
--   - NO estimated cost anywhere on outsourced_jobs (Turki: "NO estimated
--     cost on OS").
--   - Actual cost = SUM(workshop_payments.grand_total_sar) for the job —
--     DERIVED at display time (app code, Phase 4b/c), never stored on the
--     job row. Same "derived, not stored" convention already used for
--     delayed/out-of-part.
--   - MULTIPLE payments per job (1:many) since a job may have multiple
--     shops/multiple invoices.
--   - Each payment ties to a SPECIFIC repairer (repairer_id, so it's known
--     which shop billed what) and stores invoice_number, subtotal_sar
--     (pre-VAT), vat_sar, grand_total_sar as SEPARATE fields — total-level
--     (one figure per payment), not itemized (the uploaded invoice image
--     itself carries item detail, per Turki's explicit instruction).
--   - invoice_date (date) is my own addition, not explicitly requested —
--     a real vendor invoice needs a date for any future reporting; easy to
--     drop if unwanted.
--   - workshop_payments carries a table-level CHECK
--     (grand_total_sar = subtotal_sar + vat_sar), architect's explicit
--     add: the app computes VAT, but the stored money must be internally
--     consistent regardless — the rate itself can't be enforced in the DB
--     (no rate column to check against), but the sum invariant can and
--     must, since actual cost sums grand_total_sar directly.
--   - THIS MONEY IS EXTERNAL/VENDOR AP, VAT-INCLUSIVE. It must never mix
--     with Inventory's internal, VAT-exclusive parts cost in any shared
--     total. No FK, no shared view, no shared total anywhere touches both.
--     Standalone on the job for now (not wired to Finance) — the
--     subtotal/vat/grand split is stored precisely so Finance can consume
--     it later without a schema change.
--
-- VAT SOURCE: reuses the app's EXISTING configured VAT_RATE (canonically
-- defined in lib/prepaid.ts, 0.15) via a new lib/outsourced-vat.ts
-- (app-code, Phase 4b) that ONLY imports and re-exports that constant —
-- same "borrow the rate, never touch the file" pattern lib/inventory-vat.ts
-- already established for Inventory's own internal VAT. No fresh 15%
-- hardcoded anywhere. VAT is computed APP-SIDE before the insert (no
-- RPC/trigger derives it) — workshop_payments stores whatever the app
-- computed and submitted, same convention as invoice_special_charges'
-- amount_sar.
--
-- UPLOADS: workshop_payment_files (invoice image per payment) + a new
-- private `outsourced-invoices` Storage bucket — identical shape/policy
-- pattern to work_order_part_photos/maintenance-photos (0067) and
-- stock_receipt_files/stock-receipt-invoices (0047).
--
-- NO RPC for repairers/repairer_types/outsourced_descriptions inline-add,
-- or for workshop_payments/workshop_payment_files — plain inserts, no
-- invariant to protect, same reasoning add_repair_description (0060) and
-- work_order_part_photos (0067) already established. create_outsourced_job
-- below IS an RPC because it needs the same guarded-creation shape
-- create_work_order has (truck/mechanic validation, gap-free numbering,
-- multi-table insert in one transaction).
--
-- DATES: start_date + estimated_finish only (date, not timestamptz) — no
-- separate "due date" concept, per Turki. estimated_finish is a SOFT
-- target — red-in-view when exceeded, DERIVED at display time (app code),
-- never a stored "delayed" status, same convention as in-house's derived
-- delayed bucket.
--
-- RPC DISCIPLINE / RLS: identical house conventions — exact-signature
-- drop-then-create, SECURITY DEFINER, SET search_path = public, grant
-- execute to authenticated; "authenticated_all_<table>" RLS on every new
-- table; four-policy private-bucket pattern for Storage.

begin;

-- ----------------------------------------------------------------------------
-- repairer_types — small managed lookup, mirrors staff_roles/units shape.
-- ----------------------------------------------------------------------------
create table if not exists public.repairer_types (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  label_en   text not null,
  label_ar   text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.repairer_types enable row level security;
drop policy if exists "authenticated_all_repairer_types" on public.repairer_types;
create policy "authenticated_all_repairer_types"
  on public.repairer_types for all to authenticated using (true) with check (true);

insert into public.repairer_types (key, label_en, label_ar) values
  ('tire_shop',      'Tire Shop',        'محل إطارات'),
  ('body_shop',      'Body Shop',        'ورشة هياكل'),
  ('paint_shop',     'Paint Shop',       'ورشة دهان'),
  ('electrical',     'Electrical Shop',  'ورشة كهرباء'),
  ('glass_shop',     'Glass Shop',       'محل زجاج'),
  ('upholstery',     'Upholstery Shop',  'ورشة تنجيد'),
  ('welding',        'Welding Shop',     'ورشة لحام'),
  ('general_garage', 'General Garage',  'ورشة عامة')
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- repairers — managed entity, inline-addable, reusable across jobs.
-- ----------------------------------------------------------------------------
create table if not exists public.repairers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  name_ar        text,
  location       text,
  -- FK, not free text — Turki's explicit call. RESTRICT: a repairer_types
  -- row is soft-deleted (active=false), never hard-deleted, so a repairer
  -- can never be orphaned by its type disappearing.
  type           uuid references public.repairer_types(id) on delete restrict,
  contact_name   text,
  contact_number text,
  description    text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

alter table public.repairers enable row level security;
drop policy if exists "authenticated_all_repairers" on public.repairers;
create policy "authenticated_all_repairers"
  on public.repairers for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- outsourced_descriptions — OS's OWN scoped catalog, separate table from
-- repair_descriptions (0060). Seeded with a blend of preview's own
-- OS_DESC_SAMPLES + Turki's named examples (tires, bodywork).
-- ----------------------------------------------------------------------------
create table if not exists public.outsourced_descriptions (
  id         uuid primary key default gen_random_uuid(),
  en         text not null,
  ar         text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.outsourced_descriptions enable row level security;
drop policy if exists "authenticated_all_outsourced_descriptions" on public.outsourced_descriptions;
create policy "authenticated_all_outsourced_descriptions"
  on public.outsourced_descriptions for all to authenticated using (true) with check (true);

insert into public.outsourced_descriptions (en, ar) values
  ('Tire replacement',                        'استبدال الإطارات'),
  ('Tire repair / patching',                  'إصلاح الإطارات'),
  ('Bodywork / panel repair',                 'إصلاح هيكل السيارة'),
  ('Painting',                                'دهان'),
  ('Glass / windshield replacement',          'استبدال الزجاج الأمامي'),
  ('Upholstery repair',                       'إصلاح التنجيد'),
  ('Transmission overhaul',                   'صيانة شاملة لناقل الحركة'),
  ('Chassis welding & frame straightening',   'لحام الشاسيه وتعديل الإطار'),
  ('Hydraulic pump rebuild',                  'إعادة بناء طلمبة الهيدروليك'),
  ('AC compressor replacement',               'استبدال ضاغط المكيف'),
  ('Differential repair',                     'إصلاح الترس التفاضلي'),
  ('Turbocharger rebuild',                    'إعادة بناء التيربو'),
  ('Suspension repair',                       'إصلاح نظام التعليق'),
  ('Wheel alignment',                         'ضبط الزوايا')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- os_number_counter — singleton row, atomic UPDATE...RETURNING, identical
-- technique to wo_number_counter (0060). No year segment.
-- ----------------------------------------------------------------------------
create table if not exists public.os_number_counter (
  id           boolean primary key default true,
  next_number  int not null default 1,
  constraint os_number_counter_singleton check (id)
);

insert into public.os_number_counter (id, next_number)
values (true, 1)
on conflict (id) do nothing;

alter table public.os_number_counter enable row level security;
drop policy if exists "authenticated_all_os_number_counter" on public.os_number_counter;
create policy "authenticated_all_os_number_counter"
  on public.os_number_counter for all to authenticated using (true) with check (true);

drop function if exists public.next_os_number();
create or replace function public.next_os_number()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
begin
  update public.os_number_counter
     set next_number = next_number + 1
   where id = true
  returning next_number - 1 into v_number;

  return v_number;
end;
$$;

grant execute on function public.next_os_number() to authenticated;

-- ----------------------------------------------------------------------------
-- outsourced_jobs
-- ----------------------------------------------------------------------------
create table if not exists public.outsourced_jobs (
  id                      uuid primary key default gen_random_uuid(),
  os_number               text not null unique,
  truck_id                uuid not null references public.trucks(id) on delete restrict,
  -- Singular, internal, truck custody — separate from the (multiple)
  -- external repairers below. Same role-eligibility rule as in-house's
  -- assigned mechanic.
  responsible_mechanic_id uuid not null references public.staff(id) on delete restrict,
  -- Same enum as in-house work_orders.type — preview's own outsourced jobs
  -- reuse it, Turki didn't override it.
  type                    text not null check (type in ('preventive', 'corrective', 'inspection', 'predictive')),
  title                   text not null,
  title_ar                text not null,
  start_date              date not null,
  -- SOFT target — red-in-view when exceeded, derived at display time
  -- (app code). Never a stored "delayed" status.
  estimated_finish        date not null,
  -- No 'cancelled'/'awaiting_parts' — preview's own OS status set never
  -- had them either.
  status                  text not null default 'scheduled'
                            check (status in ('scheduled', 'in_progress', 'completed')),
  created_by              text,
  started_by              text,
  completed_by            text,
  closed_at               timestamptz,
  created_at              timestamptz not null default now()
);

create index if not exists outsourced_jobs_truck_id_idx on public.outsourced_jobs (truck_id);
create index if not exists outsourced_jobs_status_idx on public.outsourced_jobs (status);

alter table public.outsourced_jobs enable row level security;
drop policy if exists "authenticated_all_outsourced_jobs" on public.outsourced_jobs;
create policy "authenticated_all_outsourced_jobs"
  on public.outsourced_jobs for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- outsourced_job_repairers — junction, MANY repairers per job.
-- ----------------------------------------------------------------------------
create table if not exists public.outsourced_job_repairers (
  id                 uuid primary key default gen_random_uuid(),
  outsourced_job_id  uuid not null references public.outsourced_jobs(id) on delete cascade,
  repairer_id        uuid not null references public.repairers(id) on delete restrict,
  created_at         timestamptz not null default now(),
  unique (outsourced_job_id, repairer_id)
);

create index if not exists outsourced_job_repairers_job_id_idx
  on public.outsourced_job_repairers (outsourced_job_id);

alter table public.outsourced_job_repairers enable row level security;
drop policy if exists "authenticated_all_outsourced_job_repairers" on public.outsourced_job_repairers;
create policy "authenticated_all_outsourced_job_repairers"
  on public.outsourced_job_repairers for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- outsourced_job_tasks — checkable per-job instances (mirrors
-- work_order_tasks exactly: snapshot text, no live FK, done boolean).
-- ----------------------------------------------------------------------------
create table if not exists public.outsourced_job_tasks (
  id                 uuid primary key default gen_random_uuid(),
  outsourced_job_id  uuid not null references public.outsourced_jobs(id) on delete cascade,
  description_en     text not null,
  description_ar     text not null,
  done               boolean not null default false,
  ordinal            int not null default 0,
  created_at         timestamptz not null default now()
);

create index if not exists outsourced_job_tasks_job_id_idx
  on public.outsourced_job_tasks (outsourced_job_id);

alter table public.outsourced_job_tasks enable row level security;
drop policy if exists "authenticated_all_outsourced_job_tasks" on public.outsourced_job_tasks;
create policy "authenticated_all_outsourced_job_tasks"
  on public.outsourced_job_tasks for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- workshop_payments — the money table. VAT-inclusive vendor AP, computed
-- app-side, stored as separate subtotal/vat/grand_total fields.
-- ----------------------------------------------------------------------------
create table if not exists public.workshop_payments (
  id                 uuid primary key default gen_random_uuid(),
  outsourced_job_id  uuid not null references public.outsourced_jobs(id) on delete cascade,
  -- Which shop billed this specific payment — restrict, same soft-delete
  -- reasoning as every other repairer reference.
  repairer_id        uuid not null references public.repairers(id) on delete restrict,
  invoice_number     text,
  invoice_date       date,
  subtotal_sar       numeric(12, 2) not null check (subtotal_sar >= 0),
  vat_sar            numeric(12, 2) not null check (vat_sar >= 0),
  grand_total_sar    numeric(12, 2) not null check (grand_total_sar >= 0),
  note               text,
  created_by         text,
  created_at         timestamptz not null default now(),
  -- Architect's call: the app computes VAT, but the stored money must be
  -- internally consistent regardless of how it got here — the RATE itself
  -- can't be enforced in the DB (no rate column here to check against),
  -- but the SUM invariant can and must, since actual cost sums
  -- grand_total_sar directly. numeric(12,2) is exact decimal storage, so
  -- this equality check has no float-rounding false negatives.
  constraint workshop_payments_grand_total_check
    check (grand_total_sar = subtotal_sar + vat_sar)
);

create index if not exists workshop_payments_job_id_idx
  on public.workshop_payments (outsourced_job_id);

alter table public.workshop_payments enable row level security;
drop policy if exists "authenticated_all_workshop_payments" on public.workshop_payments;
create policy "authenticated_all_workshop_payments"
  on public.workshop_payments for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- workshop_payment_files — invoice image(s) per payment. Metadata only;
-- bytes live in the outsourced-invoices bucket below.
-- ----------------------------------------------------------------------------
create table if not exists public.workshop_payment_files (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid not null references public.workshop_payments(id) on delete cascade,
  storage_path  text not null,
  file_name     text not null,
  mime_type     text,
  uploaded_at   timestamptz not null default now()
);

create index if not exists workshop_payment_files_payment_id_idx
  on public.workshop_payment_files (payment_id);

alter table public.workshop_payment_files enable row level security;
drop policy if exists "authenticated_all_workshop_payment_files" on public.workshop_payment_files;
create policy "authenticated_all_workshop_payment_files"
  on public.workshop_payment_files for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- outsourced-invoices Storage bucket — PRIVATE, identical pattern to
-- maintenance-photos (0067) / stock-receipt-invoices (0047).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('outsourced-invoices', 'outsourced-invoices', false)
on conflict (id) do nothing;

drop policy if exists "outsourced_invoices_authenticated_select" on storage.objects;
create policy "outsourced_invoices_authenticated_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'outsourced-invoices');

drop policy if exists "outsourced_invoices_authenticated_insert" on storage.objects;
create policy "outsourced_invoices_authenticated_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'outsourced-invoices');

drop policy if exists "outsourced_invoices_authenticated_update" on storage.objects;
create policy "outsourced_invoices_authenticated_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'outsourced-invoices')
  with check (bucket_id = 'outsourced-invoices');

drop policy if exists "outsourced_invoices_authenticated_delete" on storage.objects;
create policy "outsourced_invoices_authenticated_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'outsourced-invoices');

-- ----------------------------------------------------------------------------
-- create_outsourced_job
-- p_repairer_ids: jsonb array of repairers.id uuid (at least one required).
-- p_task_description_ids: jsonb array of outsourced_descriptions.id uuid.
-- ----------------------------------------------------------------------------
drop function if exists public.create_outsourced_job(
  uuid, uuid, text, date, date, jsonb, jsonb, text
);
create or replace function public.create_outsourced_job(
  p_truck_id                uuid,
  p_responsible_mechanic_id uuid,
  p_type                    text,
  p_start_date              date,
  p_estimated_finish        date,
  p_repairer_ids            jsonb,
  p_task_description_ids    jsonb,
  p_actor                   text default null
)
returns public.outsourced_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job       public.outsourced_jobs;
  v_truck     public.trucks;
  v_mechanic  public.staff;
  v_number    integer;
  v_repairer  jsonb;
  v_repairer_id uuid;
  v_task      jsonb;
  v_desc_id   uuid;
  v_desc      record;
  v_ordinal   int := 0;
begin
  select * into v_truck from public.trucks where id = p_truck_id and active = true;
  if v_truck.id is null then
    raise exception 'Truck not found or inactive.';
  end if;

  select * into v_mechanic from public.staff
   where id = p_responsible_mechanic_id
     and role = 'mechanic'
     and active = true
     and terminated_at is null;
  if v_mechanic.id is null then
    raise exception 'Responsible mechanic not found, inactive, or not eligible.';
  end if;

  if p_start_date is null then
    raise exception 'Start date is required.';
  end if;
  if p_estimated_finish is null then
    raise exception 'Estimated finish date is required.';
  end if;

  if p_repairer_ids is null or jsonb_typeof(p_repairer_ids) <> 'array' or jsonb_array_length(p_repairer_ids) = 0 then
    raise exception 'At least one repairer is required.';
  end if;

  v_number := public.next_os_number();

  -- Title auto-derives from the truck's plate, same convention as
  -- create_work_order — trucks has no plate_ar column, so title_ar reuses
  -- the same plate value.
  insert into public.outsourced_jobs (
    os_number, truck_id, responsible_mechanic_id, type,
    title, title_ar, start_date, estimated_finish, status, created_by
  )
  values (
    'OS-' || lpad(v_number::text, 4, '0'),
    p_truck_id, p_responsible_mechanic_id, p_type,
    'Outsource — ' || v_truck.plate,
    'خارجي — ' || v_truck.plate,
    p_start_date, p_estimated_finish, 'scheduled', p_actor
  )
  returning * into v_job;

  for v_repairer in select * from jsonb_array_elements(p_repairer_ids)
  loop
    v_repairer_id := nullif(trim(both '"' from v_repairer::text), '')::uuid;
    perform 1 from public.repairers where id = v_repairer_id and active = true;
    if not found then
      raise exception 'Repairer % not found or inactive.', v_repairer_id;
    end if;

    insert into public.outsourced_job_repairers (outsourced_job_id, repairer_id)
    values (v_job.id, v_repairer_id)
    on conflict (outsourced_job_id, repairer_id) do nothing;
  end loop;

  if p_task_description_ids is not null and jsonb_typeof(p_task_description_ids) = 'array' then
    for v_task in select * from jsonb_array_elements(p_task_description_ids)
    loop
      v_desc_id := nullif(trim(both '"' from v_task::text), '')::uuid;
      select * into v_desc from public.outsourced_descriptions where id = v_desc_id and active = true;
      if v_desc.id is null then
        raise exception 'Outsourced description % not found or inactive.', v_desc_id;
      end if;

      insert into public.outsourced_job_tasks (outsourced_job_id, description_en, description_ar, ordinal)
      values (v_job.id, v_desc.en, v_desc.ar, v_ordinal);

      v_ordinal := v_ordinal + 1;
    end loop;
  end if;

  return v_job;
end;
$$;

grant execute on function public.create_outsourced_job(
  uuid, uuid, text, date, date, jsonb, jsonb, text
) to authenticated;

commit;
