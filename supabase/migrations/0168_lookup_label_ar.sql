-- 0168_lookup_label_ar.sql
-- Optional Arabic display label for CUSTOM lookup rows (staff_roles, leave_types).
-- Built-in rows are translated BY KEY in lib/i18n.ts and do NOT use this column.
-- Additive, nullable, no backfill: existing custom rows keep showing `label` until an
-- Arabic value is entered. The column inherits table-level grants (authenticated full,
-- anon none) and the permissive authenticated RLS policy — no new grant or policy is
-- needed, and no table is created, so there is no anon-revoke footer to add.

alter table public.staff_roles add column if not exists label_ar text;
alter table public.leave_types add column if not exists label_ar text;
