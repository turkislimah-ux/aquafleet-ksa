-- 0042_company_settings_arabic_name.sql
-- Batch D follow-up #1 — Arabic company name for OUR company (seller side).
--
-- RECON: customers already has name_ar (0001/0025), wired into the buyer
-- snapshot in 0041. company_settings (seller) had NO equivalent Arabic-name
-- column — checked all prior migrations touching company_settings (0025,
-- 0029, 0041): only legal_name (English) exists. So this is a genuinely new,
-- additive, nullable column — not a rename/reuse.
--
-- No RPC change needed: company_settings has no create/update RPC (plain
-- table update from app code, see invoiceActions.ts's updateCompanySettings).
-- Seller snapshot is still captured via `select("*")` in
-- assembleForCustomerPeriod — this column flows into invoices.seller_snapshot
-- automatically at confirm, same as description/telephone/phone in 0041.
--
-- Nullable, no backfill — required going forward is a form-layer nicety only,
-- same precedent as every other frozen-snapshot-gap column in this project.

begin;

alter table public.company_settings
  add column if not exists legal_name_ar text;

commit;
