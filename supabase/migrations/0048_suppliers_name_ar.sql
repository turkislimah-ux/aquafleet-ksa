-- 0048_suppliers_name_ar.sql
-- Inventory — adds an Arabic name column to suppliers, so the New Supplier
-- modal (inside the Add Parts/receive flow, migration 0047) can capture a
-- bilingual name. This is Turki's own extension, NOT something preview/'s
-- openNewSupplier() has (preview's supplier form is name/phone/email/
-- contact_person only, no name_ar) — flagged and deferred in the prior
-- field-by-field fidelity pass pending this migration.
--
-- SHAPE: nullable text, same convention as parts.name_ar (0043) — "app is
-- bilingual, this field isn't required to be." No backfill needed (existing
-- suppliers simply have no Arabic name until edited/re-entered — there is
-- no update-supplier UI yet either way, matching parts' own precedent of
-- no edit flow).
--
-- SCOPE: column only. Does NOT touch RLS (suppliers' existing
-- "authenticated_all_suppliers" policy, 0045, already covers all columns)
-- and does NOT wire the UI field — that lands in a follow-up app-code pass
-- once this migration has run.

begin;

alter table public.suppliers
  add column if not exists name_ar text;

commit;
