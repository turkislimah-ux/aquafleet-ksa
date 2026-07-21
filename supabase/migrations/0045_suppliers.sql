-- 0045_suppliers.sql
-- Inventory — Phase 1 of the full-demo build-out: suppliers as a first-class
-- entity (was deferred explicitly in 0043's header: "purchase_orders /
-- approvals / suppliers-as-entity — PO phase").
--
-- SCOPE: ONE table, no RPCs, no FK from parts/anything else yet. This
-- migration only creates the entity; wiring it into receive/PO flows is
-- later phases (Phase 3+ of the approved plan). `parts.supplier` (0043,
-- free text) is UNTOUCHED by this migration and stays free text — it is a
-- denormalized snapshot of the supplier name at receipt time, same
-- convention as this app's other frozen-snapshot columns (e.g. invoice
-- buyer/seller fields), not an FK. `suppliers` here is the structured
-- source that later phases' pickers/inline-create modals read from and
-- copy a name out of — the two are deliberately different mechanisms for
-- different jobs, not a duplication.
--
-- SHAPE: mirrors preview/'s SUPPLIERS record exactly (data.js) —
-- name/phone/email/contact_person. Adds `active` + `created_at` for
-- consistency with every other entity table in this app (soft-delete,
-- never hard-delete — same as warehouses/parts, 0043).
--
-- DEDUPE: preview/'s addSupplier() does a case-insensitive name lookup
-- before inserting (returns the existing record instead of creating a
-- duplicate) — that's an APP-LEVEL check, not a DB constraint. warehouses
-- (0043) has the identical precedent (no unique constraint on name,
-- dedup logic lives in app code) — suppliers follows the same shape for
-- consistency. Not adding a unique constraint here that warehouses itself
-- doesn't have.
--
-- RLS: same "authenticated_all_<table>" pattern as every other table in
-- this app (0002, 0014, 0043, 0044) — full read/write for any logged-in
-- user, anon gets nothing.
--
-- NO RPCs — plain table, same as warehouses/parts (0043). App-level
-- create action will be a plain insert, wired in the Phase 1 UI step
-- (not part of this migration).

begin;

-- ----------------------------------------------------------------------------
-- suppliers
-- Structured vendor entity — mirrors preview/'s SUPPLIERS array. Used by
-- later phases' supplier pickers (Purchase Orders, Add Parts/receive flow)
-- and their inline "New supplier" modals.
-- ----------------------------------------------------------------------------
create table if not exists public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  phone          text,
  email          text,
  contact_person text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

alter table public.suppliers enable row level security;
drop policy if exists "authenticated_all_suppliers" on public.suppliers;
create policy "authenticated_all_suppliers"
  on public.suppliers for all to authenticated using (true) with check (true);

commit;
