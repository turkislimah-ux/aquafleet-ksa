-- 0060_maintenance_schema_and_create_wo.sql
-- Maintenance — Phase 1 of the full-demo build-out: scheduling core only.
-- Mirrors preview/'s pages-2.js `MT` module (window.MT.openNewJob/saveNewJob)
-- and the `workOrders` shape in data.js. Migration only — no UI in this file.
--
-- SCOPE THIS MIGRATION:
--   - repair_descriptions: shared lookup catalog (preview's chip picker —
--     "shared by in-house + out-sourced jobs", data.js's repairDescriptions).
--     Mirrors units' (0049) lookup-table-with-inline-add shape.
--   - work_orders, work_order_tasks, work_order_parts: the in-house
--     scheduling core. Status only ever reaches 'open' from this migration's
--     RPC — 'in_progress'/'completed' transitions land in Phase 2
--     (start_work_order/complete_work_order), 'cancelled' has no UI path in
--     preview either (confirmed: no button sets it) and stays dormant here
--     too, same "keep the enum value, no writer for it" precedent as this
--     app already has elsewhere (e.g. purchase_orders' 'received' status
--     before Phase 5 landed, 0050's own header).
--   - wo_number_counter + next_wo_number(): gap-free WO numbering.
--   - create_work_order(): inserts a WO in 'open' status + its tasks/parts
--     lines. Reserve-only — NO stock movement, no price_lots touch, no
--     parts.qty_on_hand change. Matches preview's own explicit UI copy:
--     "Inventory is reserved now and deducted when work starts."
--
-- NOT in this migration (later phases, separate migrations):
--   - start_work_order/complete_work_order (Phase 2) — the actual
--     consume_from_lots call, FIFO price capture, truck-status auto-link.
--   - work_order_part_photos + bucket (Phase 3).
--   - outsourced_jobs and everything under that track (Phase 4).
--   - Fleet Detail wiring (Phase 5, app-code only, no migration expected).
--
-- *** DATA RULE (Turki, explicit): a WO can never draw more than on-hand.
-- This is enforced HERE too, not just at consumption time (Phase 2's
-- start_work_order, which goes through consume_from_lots — the only stock
-- writer, untouched by this migration). create_work_order() below rejects
-- any line whose qty exceeds that part's CURRENT qty_on_hand at save time.
-- This is a best-effort check at reservation time (no reservation/hold
-- ledger exists anywhere in this app — same as every other flow here), not
-- a lock — qty_on_hand can still move between save and start if another WO
-- or receipt touches the same part first, in which case start_work_order's
-- own consume_from_lots call (Phase 2) is the final, authoritative,
-- non-bypassable guard. The corresponding UI requirement (an out-of-stock
-- part must not even be pickable in the New Work Order parts picker) is an
-- app-code concern for Phase 1's UI pass, not this migration — flagged here
-- so it isn't missed. *** consume_from_lots stays the ONLY stock writer. ***
--
-- MONEY: parts cost uses parts.unit_cost_sar (internal, VAT-exclusive, same
-- as every other Inventory cost path) + labor_hours * labor_rate_sar
-- (defaults 4 / 145, matching preview's hardcoded UI-creation values). NO
-- VAT anywhere in this migration or the Maintenance feature generally —
-- lib/prepaid.ts / lib/vat.ts / lib/invoice.ts are untouched and stay that
-- way, same boundary every Inventory migration has held.
--
-- TRUCK STATUS: work_orders.prior_truck_status is added NOW (schema only)
-- so Phase 2 doesn't need a follow-up ALTER. It stays NULL until Phase 2's
-- start_work_order populates it (captures the truck's status right before
-- forcing it to 'maintenance', so complete/cancel can restore the TRUE
-- prior value instead of hard-coding 'active' — Turki's explicit call).
-- Nothing in this migration writes trucks.status at all.
--
-- WO NUMBER FORMAT: plain sequential 'WO-0001', no year segment — matches
-- preview's own `WO-${i+1}` shape exactly (unlike PO/invoice/trip refs,
-- preview never resets or years its WO numbers, so neither does this).
-- Gap-free via the same atomic singleton-counter UPDATE...RETURNING
-- technique as po_number_counter (0050) / next_invoice_number (0034) —
-- not a client-side count(*)+1 toy.
--
-- BILINGUAL TITLE NOTE: preview auto-sets title/titleAr from the truck's
-- plate/plateAr. This app's trucks table (0001) has only `plate`, no
-- `plate_ar` column — so title_ar below reuses the same plate value in
-- both title and title_ar (a real, confirmed gap in trucks' own schema,
-- not something this migration should silently invent a fix for).
--
-- RPC DISCIPLINE: exact-signature `drop function if exists` immediately
-- before `create or replace function`, `security definer` +
-- `set search_path = public`, `grant execute ... to authenticated` — same
-- as every prior Inventory RPC.
--
-- RLS: "authenticated_all_<table>" on every new table, same house pattern.
--
-- ON DELETE CHOICES: work_orders.truck_id / .assigned_mechanic_id ->
-- RESTRICT (trucks/staff are soft-deleted via active/terminated_at, never
-- hard-deleted — a WO can never be orphaned by either disappearing, same
-- precedent as purchase_orders.supplier_id/warehouse_id, 0050).
-- work_order_tasks.work_order_id / work_order_parts.work_order_id ->
-- CASCADE (owned child rows of their WO, same as purchase_order_lines).
-- work_order_parts.part_id -> RESTRICT (parts are soft-deleted, never hard-
-- deleted; a historical WO line must never be orphaned).

create extension if not exists pgcrypto;

begin;

-- ----------------------------------------------------------------------------
-- repair_descriptions
-- Shared task/description chip catalog for both in-house tasks and
-- out-sourced job descriptions (preview: one catalog, two consumers).
-- ----------------------------------------------------------------------------
create table if not exists public.repair_descriptions (
  id         uuid primary key default gen_random_uuid(),
  en         text not null,
  ar         text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.repair_descriptions enable row level security;
drop policy if exists "authenticated_all_repair_descriptions" on public.repair_descriptions;
create policy "authenticated_all_repair_descriptions"
  on public.repair_descriptions for all to authenticated using (true) with check (true);

-- Seed — preview/'s data.js repairDescriptions catalog (RD-001..).
insert into public.repair_descriptions (en, ar) values
  ('Replace engine oil & filter',        'تغيير زيت المحرك والفلتر'),
  ('Replace air & fuel filters',         'استبدال فلتر الهواء والوقود'),
  ('Inspect and rotate tires',           'فحص وتدوير الإطارات'),
  ('Replace front brake pad set',        'استبدال طقم تيل الفرامل الأمامي'),
  ('Replace rear brake pad set',         'استبدال طقم تيل الفرامل الخلفي'),
  ('Resurface brake discs',              'تجليخ هوب الفرامل'),
  ('Bleed brake lines',                  'تنفيس خطوط الفرامل'),
  ('Pressure-test cooling system',       'اختبار ضغط نظام التبريد'),
  ('Replace water pump',                 'استبدال طلمبة الماء'),
  ('Flush coolant and refill',           'غسيل وإعادة تعبئة سائل التبريد'),
  ('Replace serpentine belt',            'استبدال سير المحرك'),
  ('Balance wheels',                     'ضبط توازن العجلات'),
  ('Pressure-test water tank',           'اختبار ضغط خزان المياه'),
  ('Verify gasket integrity',            'التحقق من سلامة الجوانات'),
  ('Diagnose charging system',           'تشخيص نظام الشحن'),
  ('Replace 12V battery',                'استبدال البطارية'),
  ('Verify alternator output',           'التحقق من خرج الدينمو'),
  ('Full safety inspection',             'فحص سلامة شامل'),
  ('Emissions test',                     'اختبار الانبعاثات'),
  ('Headlight alignment',                'ضبط الأضواء الأمامية')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- work_orders
-- ----------------------------------------------------------------------------
create table if not exists public.work_orders (
  id                     uuid primary key default gen_random_uuid(),
  wo_number              text not null unique,
  truck_id               uuid not null references public.trucks(id) on delete restrict,
  type                   text not null check (type in ('preventive', 'corrective', 'inspection', 'predictive')),
  priority               text not null check (priority in ('low', 'medium', 'high', 'critical')),
  -- 'awaiting_parts'/'cancelled' kept as valid enum values (preview parity —
  -- they exist in preview's own status set) but no RPC in this build ever
  -- writes them; only 'open'/'in_progress'/'completed' are reachable.
  status                 text not null default 'open'
                           check (status in ('open', 'in_progress', 'awaiting_parts', 'completed', 'cancelled')),
  title                  text not null,
  title_ar               text not null,
  opened_at              timestamptz not null default now(),
  due_by                 timestamptz not null,
  closed_at              timestamptz,
  assigned_mechanic_id   uuid not null references public.staff(id) on delete restrict,
  estimated_cost_sar     numeric(12, 2) not null default 0,
  -- NULL until completed (Phase 2) — recomputed server-side from the true
  -- consumed FIFO lot prices + labor, per Turki's explicit call (NOT a copy
  -- of estimated_cost_sar, unlike preview's own simplified UI path).
  actual_cost_sar        numeric(12, 2),
  labor_hours            numeric(6, 2) not null default 4,
  labor_rate_sar         numeric(12, 2) not null default 145,
  mechanic_notes         text,
  -- Idempotency marker for stock deduction — set once, by Phase 2's
  -- start_work_order, same role as preview's inventoryDeductedAt.
  inventory_deducted_at  timestamptz,
  odometer_at_service    int,
  -- Captured by Phase 2's start_work_order right before forcing
  -- trucks.status = 'maintenance'; restored on complete/cancel. NULL until
  -- a WO is actually started.
  prior_truck_status     text,
  -- Actor-email capture (house RPC convention) — set from create_work_order's
  -- p_actor, nullable since the param itself is optional. started_by/
  -- completed_by are Phase 2's job, added alongside start_work_order/
  -- complete_work_order, not here.
  created_by             text,
  created_at             timestamptz not null default now()
);

create index if not exists work_orders_truck_id_idx on public.work_orders (truck_id);
create index if not exists work_orders_status_idx on public.work_orders (status);
create index if not exists work_orders_due_by_idx on public.work_orders (due_by);

alter table public.work_orders enable row level security;
drop policy if exists "authenticated_all_work_orders" on public.work_orders;
create policy "authenticated_all_work_orders"
  on public.work_orders for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- work_order_tasks
-- Snapshot of en/ar text at creation time (from repair_descriptions), NOT a
-- live FK — same "snapshot, don't re-derive" convention as invoice
-- buyer/seller fields (0041/0042). Editing a repair_description later must
-- not retroactively change wording on an already-scheduled WO.
-- ----------------------------------------------------------------------------
create table if not exists public.work_order_tasks (
  id              uuid primary key default gen_random_uuid(),
  work_order_id   uuid not null references public.work_orders(id) on delete cascade,
  description_en  text not null,
  description_ar  text not null,
  done            boolean not null default false,
  ordinal         int not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists work_order_tasks_work_order_id_idx on public.work_order_tasks (work_order_id);

alter table public.work_order_tasks enable row level security;
drop policy if exists "authenticated_all_work_order_tasks" on public.work_order_tasks;
create policy "authenticated_all_work_order_tasks"
  on public.work_order_tasks for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- work_order_parts
-- unit_price_sar is a snapshot at creation time (= parts.unit_cost_sar at
-- save). Phase 2's start_work_order OVERWRITES it with the true FIFO
-- weighted price actually drawn via consume_from_lots — same "snapshot now,
-- true-up at consumption" behavior as preview's consumePartsForWO.
-- ----------------------------------------------------------------------------
create table if not exists public.work_order_parts (
  id              uuid primary key default gen_random_uuid(),
  work_order_id   uuid not null references public.work_orders(id) on delete cascade,
  part_id         uuid not null references public.parts(id) on delete restrict,
  qty             numeric(12, 2) not null check (qty > 0),
  unit_price_sar  numeric(12, 2) not null,
  created_at      timestamptz not null default now()
);

create index if not exists work_order_parts_work_order_id_idx on public.work_order_parts (work_order_id);
create index if not exists work_order_parts_part_id_idx on public.work_order_parts (part_id);

alter table public.work_order_parts enable row level security;
drop policy if exists "authenticated_all_work_order_parts" on public.work_order_parts;
create policy "authenticated_all_work_order_parts"
  on public.work_order_parts for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- wo_number_counter — singleton row, atomic UPDATE...RETURNING (same
-- gap-free technique as po_number_counter/next_invoice_number), no year
-- dimension (see header note).
-- ----------------------------------------------------------------------------
create table if not exists public.wo_number_counter (
  id           boolean primary key default true,
  next_number  int not null default 1,
  constraint wo_number_counter_singleton check (id)
);

insert into public.wo_number_counter (id, next_number)
values (true, 1)
on conflict (id) do nothing;

alter table public.wo_number_counter enable row level security;
drop policy if exists "authenticated_all_wo_number_counter" on public.wo_number_counter;
create policy "authenticated_all_wo_number_counter"
  on public.wo_number_counter for all to authenticated using (true) with check (true);

drop function if exists public.next_wo_number();
create or replace function public.next_wo_number()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number integer;
begin
  update public.wo_number_counter
     set next_number = next_number + 1
   where id = true
  returning next_number - 1 into v_number;

  return v_number;
end;
$$;

grant execute on function public.next_wo_number() to authenticated;

-- ----------------------------------------------------------------------------
-- create_work_order
-- Inserts a WO in 'open' status + its task/part lines. RESERVE-ONLY: no
-- stock movement, no price_lots touch, no parts.qty_on_hand change here.
--
-- p_lines shape: jsonb array of { "part_id": uuid, "qty": numeric }.
-- p_task_description_ids shape: jsonb array of repair_descriptions.id uuid.
-- ----------------------------------------------------------------------------
drop function if exists public.create_work_order(
  uuid, text, text, timestamptz, uuid, jsonb, jsonb, text
);
create or replace function public.create_work_order(
  p_truck_id             uuid,
  p_type                 text,
  p_priority              text,
  p_due_by               timestamptz,
  p_mechanic_staff_id    uuid,
  p_task_description_ids jsonb,
  p_lines                jsonb,
  p_actor                text default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo           public.work_orders;
  v_truck        public.trucks;
  v_number       integer;
  v_task         jsonb;
  v_desc_id      uuid;
  v_desc         record;
  v_ordinal      int := 0;
  v_line         jsonb;
  v_part_id      uuid;
  v_qty          numeric(12, 2);
  v_part         public.parts;
  v_unit_price   numeric(12, 2);
  v_parts_cost   numeric(12, 2) := 0;
  v_estimated    numeric(12, 2);
begin
  select * into v_truck from public.trucks where id = p_truck_id and active = true;
  if v_truck.id is null then
    raise exception 'Truck not found or inactive.';
  end if;

  perform 1 from public.staff
   where id = p_mechanic_staff_id
     and role = 'mechanic'
     and active = true
     and terminated_at is null;
  if not found then
    raise exception 'Mechanic not found, inactive, or not eligible.';
  end if;

  if p_due_by is null then
    raise exception 'Due date is required.';
  end if;

  v_number := public.next_wo_number();

  -- Title auto-derives from the truck's plate, same as preview. trucks has
  -- no plate_ar column (confirmed) — both title/title_ar reuse the one
  -- plate value.
  insert into public.work_orders (
    wo_number, truck_id, type, priority, status, title, title_ar,
    due_by, assigned_mechanic_id, odometer_at_service, created_by
  )
  values (
    'WO-' || lpad(v_number::text, 4, '0'),
    p_truck_id, p_type, p_priority, 'open',
    'Maintenance — ' || v_truck.plate,
    'صيانة — ' || v_truck.plate,
    p_due_by, p_mechanic_staff_id, v_truck.odometer_km, p_actor
  )
  returning * into v_wo;

  -- Tasks — snapshot en/ar from repair_descriptions at this moment.
  if p_task_description_ids is not null and jsonb_typeof(p_task_description_ids) = 'array' then
    for v_task in select * from jsonb_array_elements(p_task_description_ids)
    loop
      v_desc_id := nullif(trim(both '"' from v_task::text), '')::uuid;
      select * into v_desc from public.repair_descriptions where id = v_desc_id and active = true;
      if v_desc.id is null then
        raise exception 'Repair description % not found or inactive.', v_desc_id;
      end if;

      insert into public.work_order_tasks (work_order_id, description_en, description_ar, ordinal)
      values (v_wo.id, v_desc.en, v_desc.ar, v_ordinal);

      v_ordinal := v_ordinal + 1;
    end loop;
  end if;

  -- Parts — snapshot unit_price_sar = parts.unit_cost_sar now. HARD BLOCK
  -- if the requested qty exceeds current qty_on_hand (Turki's data rule: a
  -- WO can never draw more than on-hand — enforced here AND, authoritatively,
  -- by consume_from_lots at start time in Phase 2). The New Work Order UI
  -- must independently prevent selecting an out-of-stock part / a qty above
  -- on-hand in the picker itself — this is the server-side backstop, not a
  -- substitute for that.
  if p_lines is not null and jsonb_typeof(p_lines) = 'array' then
    for v_line in select * from jsonb_array_elements(p_lines)
    loop
      v_part_id := nullif(v_line->>'part_id', '')::uuid;
      v_qty     := nullif(v_line->>'qty', '')::numeric;

      if v_part_id is null then
        raise exception 'Line item is missing part_id.';
      end if;
      if v_qty is null or v_qty <= 0 then
        raise exception 'Line item quantity must be positive.';
      end if;

      select * into v_part from public.parts where id = v_part_id and active = true;
      if v_part.id is null then
        raise exception 'Part not found or inactive.';
      end if;

      if v_qty > v_part.qty_on_hand then
        raise exception 'Part % has only % on hand — cannot reserve % on a work order.',
          v_part.name, v_part.qty_on_hand, v_qty;
      end if;

      v_unit_price := coalesce(v_part.unit_cost_sar, 0);

      insert into public.work_order_parts (work_order_id, part_id, qty, unit_price_sar)
      values (v_wo.id, v_part_id, v_qty, v_unit_price);

      v_parts_cost := v_parts_cost + (v_qty * v_unit_price);
    end loop;
  end if;

  v_estimated := round(v_parts_cost + (v_wo.labor_hours * v_wo.labor_rate_sar), 2);

  update public.work_orders
     set estimated_cost_sar = v_estimated
   where id = v_wo.id
  returning * into v_wo;

  return v_wo;
end;
$$;

grant execute on function public.create_work_order(
  uuid, text, text, timestamptz, uuid, jsonb, jsonb, text
) to authenticated;

commit;
