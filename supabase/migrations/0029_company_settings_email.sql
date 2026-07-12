-- 0029_company_settings_email.sql
-- Add company_settings.email — needed so invoice mailto templates can put a
-- formal company contact address in the signature. mailto cannot set the
-- actual From address (that's the user's own mail client); this column is
-- purely for reference text in the email body.
--
-- Additive only: nullable, no default, no RLS change (existing
-- authenticated_all_company_settings policy already covers all columns on
-- this singleton table).

begin;

alter table public.company_settings
  add column if not exists email text;

commit;
