-- 0013_slug_normalization.sql
-- Lock the slug format for lookup keys at the DB layer. Prevents duplicate
-- "Night_Dispatcher" / "night_dispatcher" rows that look the same to humans
-- but are different rows to the database. Defense-in-depth: the app form
-- also normalizes on submit, but this is the hard floor.
--
-- Pattern: ^[a-z][a-z0-9_]*$
--   - starts with lowercase letter (not digit, not underscore)
--   - then lowercase letters, digits, or underscores only
--   - no spaces, no dashes, no capitals, no special chars
--
-- PRE-FLIGHT (confirmed before writing this migration): zero existing rows
-- in staff_roles or leave_types violate the pattern. Constraint will apply
-- cleanly to existing data.
--
-- Run in the Supabase SQL editor (after 0012).

begin;

-- Re-verify at migration time (cheap, catches drift between when we checked
-- and when we run this). If any bad row exists, raise with the offenders.
do $$
declare bad text;
begin
  select string_agg(t.table_name || ':' || t.key, ', ')
    into bad
  from (
    select 'staff_roles' as table_name, key from public.staff_roles
      where key !~ '^[a-z][a-z0-9_]*$'
    union all
    select 'leave_types' as table_name, key from public.leave_types
      where key !~ '^[a-z][a-z0-9_]*$'
  ) t;

  if bad is not null then
    raise exception
      'Cannot add slug CHECK: non-slug keys exist: %. Normalize them first.', bad;
  end if;
end $$;

-- staff_roles.key slug format
alter table public.staff_roles
  drop constraint if exists staff_roles_key_slug;
alter table public.staff_roles
  add constraint staff_roles_key_slug
  check (key ~ '^[a-z][a-z0-9_]*$');

-- leave_types.key slug format
alter table public.leave_types
  drop constraint if exists leave_types_key_slug;
alter table public.leave_types
  add constraint leave_types_key_slug
  check (key ~ '^[a-z][a-z0-9_]*$');

commit;
