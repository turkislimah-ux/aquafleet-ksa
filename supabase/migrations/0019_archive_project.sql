-- 0019_archive_project.sql
-- Soft-archive for a project AND its 1:1 customer. Marker = archived_at
-- timestamptz (NULL = active), mirroring staff.terminated_at (0011). Archiving a
-- project hides it (and its customer) from active views WITHOUT deleting any
-- rows — trips, commissions, and history stay intact and auditable.
--
-- WHY an RPC: a project and its customer must flip together (1:1). Supabase JS
-- over PostgREST runs each statement as its own transaction, so an app-side pair
-- of updates could half-apply. This does both in ONE transaction. Mirrors
-- create/update_project_with_customer (0016/0017/0018): plpgsql, SECURITY
-- INVOKER (no security clause → RLS-respecting), explicit grant.
--
-- trips are NEVER written here. Archived-project trips are hidden at the QUERY
-- layer (filtering on the project's archived_at), not by a column on trips.

begin;

-- 1) archived_at markers. Nullable, no default (existing rows stay active). ----
alter table public.projects  add column if not exists archived_at timestamptz;
alter table public.customers add column if not exists archived_at timestamptz;

-- 2) Partial indexes for fast active-filtering (style mirrors staff_active_idx).
create index if not exists projects_active_idx
  on public.projects (created_at desc) where archived_at is null;
create index if not exists customers_active_idx
  on public.customers (created_at desc) where archived_at is null;

-- 3) Atomic archive: project + its derived customer, both or neither. ---------
create or replace function public.archive_project(p_project_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_cust_id uuid;
begin
  -- Derive the customer from the project (single source of truth — same pattern
  -- as update_project_with_customer).
  select customer_id into v_cust_id
    from public.projects
   where id = p_project_id;
  if v_cust_id is null then
    raise exception 'Project not found.';
  end if;

  -- Guarded: only stamp rows still active, so a double-archive is a true no-op
  -- and the original archive timestamp is preserved.
  update public.projects
     set archived_at = now()
   where id = p_project_id and archived_at is null;

  update public.customers
     set archived_at = now()
   where id = v_cust_id and archived_at is null;

  -- trips are intentionally untouched (hidden via the project's archived_at at
  -- the query layer, never by a trips column).

  return p_project_id;
end;
$$;

grant execute on function public.archive_project(uuid) to authenticated;

commit;
