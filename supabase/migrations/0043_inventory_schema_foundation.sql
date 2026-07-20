-- 0043_inventory_schema_foundation.sql
-- Inventory page — Slice 1: schema foundation only.
--
-- SCOPE (v1 — deliberately narrow, later slices build on this):
--   - warehouses: user-created storage locations. English only (no name_ar —
--     unlike customers/company_settings, warehouses are internal-only, never
--     shown to a customer, so no bilingual need per Turki's design call).
--   - parts: part definition + stock in ONE row. Mirrors the preview/ demo's
--     modeling with ONE deliberate simplification: preview/ v2 (see recon,
--     data.js's PART_DEFS/priceTiers) has FIFO cost lots, purchase orders,
--     approvals, and a first-class supplier entity. NONE of that lands here.
--     This migration is the "one SKU, one row, one warehouse, one current
--     cost" v1 model — closer to preview/'s earlier prototype shape
--     (lib/types.ts's Part interface) than the full v2 demo.
--
-- EXPLICITLY DEFERRED (do not add speculatively — later phases, separate
-- migrations, per the Inventory build-in-slices plan):
--   - stock_movements (receive/adjust/consume audit trail) — lands with the
--     receive/adjust-quantity phase.
--   - FIFO price-lot history (priceTiers in the demo) — replaced here by a
--     single unit_cost_sar current value.
--   - purchase_orders / approvals / suppliers-as-entity — PO phase.
--   - Maintenance consumption (partsUsed on work orders) — no work_orders
--     table exists in this app yet; that link is out of scope until
--     Maintenance itself is built (CLAUDE.md §7 roadmap: Trips done ->
--     Maintenance next).
--
-- LOCATION MODEL NOTE (CLAUDE.md §6's "do NOT unify" rule, extended): this
-- app already has TWO separate location concepts — water_stations (fill
-- points, Trips) and operation_stations (truck/driver/staff home base,
-- 0022). `warehouses` here is a THIRD, deliberately distinct concept
-- (physical parts storage) — mirrors preview/'s WAREHOUSES (Riyadh/Jeddah/
-- Dammam depots), which is never referenced by water_stations or
-- operation_stations in the demo either. Do not FK parts to either existing
-- station table.
--
-- MONEY NOTE: unit_cost_sar is INTERNAL parts cost (what we pay suppliers),
-- never customer-facing money — it does NOT flow into invoices/prepaid/VAT
-- (lib/invoice.ts, lib/prepaid.ts, lib/vat.ts are untouched by this
-- migration and must stay that way). Same numeric(12,2) SAR convention as
-- every existing money column (rate_per_trip_sar 0001, amount_sar/
-- subtotal_sar/vat_sar/total_sar 0025, price_sar 0032, fill_cost 0021) —
-- not a new convention.
--
-- SOFT-DELETE: both tables get `active boolean not null default true`, same
-- convention as drivers/trucks/water_stations/projects — nothing here is
-- ever hard-deleted. warehouses.active is the one that matters most:
-- parts.warehouse_id is ON DELETE RESTRICT (never cascade parts away when a
-- warehouse is retired — retire it via `active = false` instead, same
-- pre-filter-not-a-state precedent as terminated drivers/trucks).
--
-- CATEGORY: free text, not an enum/CHECK — per instruction, new categories
-- must be addable without a migration (unlike e.g. trucks.status or
-- customers.customer_type, which ARE enums because their value sets are
-- fixed business rules; parts categories are open-ended operational
-- taxonomy, closer to how projects.default_water_station's *label* can grow
-- without a migration even though the FK itself is controlled).
--
-- RLS: mirrors the simple "authenticated_all_<table>" pattern used by every
-- other lookup/operational table in this app (drivers/trucks 0002,
-- water_stations 0014) — full read/write for any logged-in user, anon gets
-- nothing. No row-level ownership model exists anywhere else in this app;
-- introducing one here would be a new, ungoverned pattern. Not doing that.
--
-- NO RPCs in this migration (per instruction) — app-level create/update
-- actions will be plain table inserts/updates, wired in a later slice.

create extension if not exists pgcrypto;

begin;

-- ----------------------------------------------------------------------------
-- warehouses
-- User-created storage locations (mirrors preview/'s WAREHOUSES concept —
-- Riyadh/Jeddah/Dammam in the demo — but here it's user-managed, not seeded,
-- since this app has no fixed depot list of its own). English only.
-- ----------------------------------------------------------------------------
create table if not exists public.warehouses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  location   text,
  -- Free text (not an enum) — entered manually, matches parts.category's
  -- "addable without a migration" requirement.
  type       text,
  note       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.warehouses enable row level security;
drop policy if exists "authenticated_all_warehouses" on public.warehouses;
create policy "authenticated_all_warehouses"
  on public.warehouses for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- parts
-- Part definition + stock in ONE row (v1 — no separate stock table, no FIFO
-- cost lots). One SKU lives in exactly one warehouse.
-- ----------------------------------------------------------------------------
create table if not exists public.parts (
  id              uuid primary key default gen_random_uuid(),
  sku             text not null unique,
  name            text not null,
  name_ar         text, -- nullable — app is bilingual, this part isn't required to be
  -- Free text (not an enum) — categories must be addable without a
  -- migration (unlike e.g. trucks.status, which IS a fixed CHECK).
  category        text,
  unit            text, -- e.g. 'L', 'ea', 'set'
  -- Internal parts cost only (what we pay suppliers) — SAME numeric(12,2)
  -- SAR convention as every other money column in this app. Never flows
  -- into the customer-facing money core (invoices/prepaid/VAT).
  unit_cost_sar   numeric(12, 2),
  qty_on_hand     numeric(12, 2) not null default 0,
  reorder_level   numeric(12, 2),
  reorder_qty     numeric(12, 2),
  lead_time_days  int,
  -- TEXT for v1 — suppliers become a first-class entity in the PO phase
  -- (mirrors preview/'s SUPPLIERS table), not here.
  supplier        text,
  -- Every part lives in exactly one warehouse (the demo model — no
  -- multi-warehouse split per SKU in v1). RESTRICT: warehouses are
  -- soft-deleted via `active`, never hard-deleted, so a part can never be
  -- orphaned by a warehouse disappearing out from under it.
  warehouse_id    uuid not null references public.warehouses(id) on delete restrict,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- Speeds up the warehouse-scoped list view (filter/group by warehouse, same
-- access pattern as the preview/ demo's Inventory table).
create index if not exists parts_warehouse_id_idx
  on public.parts (warehouse_id);

alter table public.parts enable row level security;
drop policy if exists "authenticated_all_parts" on public.parts;
create policy "authenticated_all_parts"
  on public.parts for all to authenticated using (true) with check (true);

commit;
