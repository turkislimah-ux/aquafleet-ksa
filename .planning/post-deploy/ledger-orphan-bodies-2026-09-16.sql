-- ===========================================================================
-- ORPHANED MIGRATION BODIES — recovered from PROD before the snapshot is dropped
-- Recorded 2026-09-16. NOT MIGRATIONS. Nothing here is ever to be run.
--
-- The 2026-09-16 ledger reconcile rewrote prod's 133 timestamp-versioned
-- schema_migrations rows into the 198 file-versioned rows the repo carries. It
-- carried 124 of the old bodies forward; 9 rows were dropped. Two of the nine
-- were exact duplicate re-applies whose twin survives (md5-identical). The other
-- SEVEN are below, and this file is the only copy of them in existence:
--
--   * five were SQUASHED into later migration files during development, so no
--     tracked file ever carried them;
--   * two (0089, 0097) are the EARLIER half of a same-day re-apply pair whose
--     body genuinely differs from the later one — the file matches the later
--     body, so the earlier body was never recorded anywhere.
--
-- Verified 2026-09-16 against prod live and against every tracked file in the
-- repo: none of these seven bodies appears in either. prod-ledger-backup-
-- 2026-09-16.sql records their md5 and their length, but not their SQL. That
-- manifest proves what was there; it cannot reconstruct it. This file can.
--
-- These are historical intermediate states of a schema that has since been
-- proved byte-identical between prod and a clean from-files rebuild. Nothing
-- running depends on them. They are kept for archaeology — so that the drop of
-- supabase_migrations.schema_migrations_backup_20260916 costs nothing.
--
-- Bodies are byte-exact as stored in the snapshot's statements column. Each
-- block carries the md5 and character count the server measured, so the
-- recording round-trips: re-hash a block and it must match its banner.
-- ===========================================================================


-- ===================================================================
-- 20260804203631  0089_archive_group_type_and_linking
-- md5 9d4412681a9b26367f6e5127cf31896e   3456 characters
-- Retired by the 2026-09-16 ledger reconcile. Recorded here because
-- this is the only surviving copy. NOT a migration: do not run it.
-- ===================================================================
-- 0089_archive_group_type_and_linking.sql
-- Group carries a type (staff/truck), a linked-type marker maps (type, subject) -> the person's
-- column, and linked types are one-document-per-person (renewal replaces). The subject guard 0087
-- is NOT recreated here — this adds a SEPARATE trigger, so 0087 keeps its grants untouched. The new
-- function is hardened per 0083 (search_path pinned, EXECUTE revoked from PUBLIC/anon).
begin;

-- Linked-field mapping on the type lookup: which PERSON column a (type, subject) pair reads/writes.
alter table public.archive_document_types
  add column if not exists linked_driver_field text,
  add column if not exists linked_staff_field  text;

update public.archive_document_types
   set linked_driver_field = 'iqama_number', linked_staff_field = 'iqama_number'
 where key = 'iqama';
update public.archive_document_types
   set linked_driver_field = 'license_number', linked_staff_field = null
 where key = 'license';

-- Group carries a document type (staff/truck groups). Nullable (company groups leave it null).
alter table public.archive_document_groups
  add column if not exists type_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'archive_document_groups_type_key_fkey'
      and conrelid = 'public.archive_document_groups'::regclass
  ) then
    alter table public.archive_document_groups
      add constraint archive_document_groups_type_key_fkey
      foreign key (type_key) references public.archive_document_types(key)
      on delete restrict on update cascade;
  end if;
end $$;

-- One-document-per-person for LINKED types only. Non-linked/untyped groups stay multiple-allowed.
create or replace function public.archive_linked_one_per_person()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_type          text;
  v_linked_driver text;
  v_linked_staff  text;
begin
  select g.type_key into v_type
    from public.archive_document_groups g
   where g.id = new.group_id;

  if v_type is null then
    return new;
  end if;

  select linked_driver_field, linked_staff_field
    into v_linked_driver, v_linked_staff
    from public.archive_document_types
   where key = v_type;

  if new.driver_id is not null and v_linked_driver is not null then
    if exists (
      select 1 from public.archive_documents d
       where d.group_id = new.group_id and d.driver_id = new.driver_id and d.id <> new.id
    ) then
      raise exception 'This driver already has a "%" document in this group (linked types allow one per person; renew instead).', v_type
        using errcode = '23505';
    end if;
  end if;

  if new.staff_id is not null and v_linked_staff is not null then
    if exists (
      select 1 from public.archive_documents d
       where d.group_id = new.group_id and d.staff_id = new.staff_id and d.id <> new.id
    ) then
      raise exception 'This staff member already has a "%" document in this group (linked types allow one per person; renew instead).', v_type
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.archive_linked_one_per_person() from public, anon;

drop trigger if exists archive_linked_one_per_person_trg on public.archive_documents;
create trigger archive_linked_one_per_person_trg
  before insert or update on public.archive_documents
  for each row execute function public.archive_linked_one_per_person();

commit;


-- ===================================================================
-- 20260806020704  0097_consumption_approvals_matching_votes
-- md5 4aeb4a58e466dd7b09450db2cf0c330b   1628 characters
-- Retired by the 2026-09-16 ledger reconcile. Recorded here because
-- this is the only surviving copy. NOT a migration: do not run it.
-- ===================================================================
-- 0097_consumption_approvals_matching_votes.sql
-- Match the stock-receipt approval exactly: a second voter's decision MUST match the first's. A
-- vote (insert or update) whose decision differs from any existing vote on the same event is
-- REFUSED. The sole first voter can still change their own vote freely (no other vote to conflict
-- with). Two matching votes complete the event; no event can ever hold two different outcomes.
create or replace function public.consumption_approvals_match_guard()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_other text;
begin
  select c.decision into v_other
  from public.consumption_approvals c
  where c.id <> new.id
    and c.decision <> new.decision
    and (
      (new.exit_permit_id    is not null and c.exit_permit_id    = new.exit_permit_id) or
      (new.work_order_id     is not null and c.work_order_id     = new.work_order_id)  or
      (new.outsourced_job_id is not null and c.outsourced_job_id = new.outsourced_job_id)
    )
  limit 1;

  if v_other is not null then
    raise exception 'This item already has a "%" vote — the second voter must match it, not disagree.', v_other
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke execute on function public.consumption_approvals_match_guard() from public, anon;

drop trigger if exists consumption_approvals_match_trg on public.consumption_approvals;
create trigger consumption_approvals_match_trg
  before insert or update on public.consumption_approvals
  for each row execute function public.consumption_approvals_match_guard();


-- ===================================================================
-- 20260811000538  0103_dashboard_views_fix
-- md5 cc656e699f6a6817f070479fe1ec19c7   4456 characters
-- Retired by the 2026-09-16 ledger reconcile. Recorded here because
-- this is the only surviving copy. NOT a migration: do not run it.
-- ===================================================================
-- 0103 correction: invoice_unpaid now reads v_receivables_open directly; trip_overdue allowlist.
create or replace view public.v_dashboard_action_items as
with riyadh as (select (now() at time zone 'Asia/Riyadh')::date as today)
select * from (
  select 'po_pending_approval'::text        as kind,
         'high'::text                        as severity,
         count(*)::int                       as item_count,
         min(po.created_at)                  as oldest_at
  from public.purchase_orders po
  where po.status = 'pending_approval'
  union all
  select 'receipt_pending_approval', 'high',
         count(*)::int, min(sr.created_at)
  from public.stock_receipts sr
  where sr.status = 'pending_approval'
  union all
  select 'consumption_pending_approval', 'medium',
         count(*)::int, min(ca.created_at)
  from public.consumption_approvals ca
  where ca.decided_at is null
  union all
  -- Confirmed invoices with a real outstanding balance. Reads
  -- v_receivables_open directly rather than re-expressing its predicate,
  -- so the Dashboard and Reports can never diverge on this figure (and
  -- inherit its inner join to customers). v_receivables_open is
  -- security_invoker, so RLS still resolves at the base tables.
  -- (Prior branch counted confirmed_at not null / paid_at null /
  --  status <> 'void' = 5, which included 3 prepaid-settled invoices with
  --  amount_due_sar = 0 that Reports does not treat as receivable.)
  select 'invoice_unpaid', 'high',
         count(*)::int, min(r.confirmed_at)
  from public.v_receivables_open r
  union all
  -- Trips still in flight whose day has passed. Allowlist matches
  -- v_fleet_state_now.trips_in_flight so the two agree by construction.
  -- (Prior branch used stage <> 'delivered'; identical today at 49 since
  --  only these 4 stages exist, but the allowlist won't mis-flag a future
  --  stage.)
  select 'trip_overdue', 'high',
         count(*)::int, min(t.created_at)
  from public.trips t, riyadh r
  where t.stage in ('scheduled','loading','in_transit')
    and t.trip_date < r.today
  union all
  select 'work_order_open', 'medium',
         count(*)::int, min(w.opened_at)
  from public.work_orders w
  where w.status in ('open', 'awaiting_parts')
  union all
  select 'po_awaiting_receipt', 'medium',
         count(*)::int, min(po.issued_at)
  from public.purchase_orders po
  where po.status = 'issued'
  union all
  select 'outsourced_overdue', 'medium',
         count(*)::int, min(o.created_at)
  from public.outsourced_jobs o, riyadh r
  where o.status = 'in_progress'
    and o.estimated_finish is not null
    and o.estimated_finish < r.today
  union all
  select 'permit_return_overdue', 'medium',
         count(*)::int, min(e.exited_at)
  from public.exit_permits e, riyadh r
  where e.status = 'exited'
    and e.expected_return_on is not null
    and e.expected_return_on < r.today
  union all
  select 'parts_below_reorder', 'low',
         count(*)::int, null::timestamptz
  from public.parts p
  where p.active
    and p.reorder_level is not null
    and p.qty_on_hand <= p.reorder_level
  union all
  select 'expiring_documents', 'medium', count(*)::int, null::timestamptz
  from (
    select ad.expiry_date
      from public.archive_documents ad, riyadh r
     where ad.expiry_date is not null and ad.expiry_date < r.today + 30
    union all
    select d.license_expiry
      from public.drivers d, riyadh r
     where d.terminated_at is null and d.license_expiry is not null
       and d.license_expiry < r.today + 30
    union all
    select d.iqama_expiry
      from public.drivers d, riyadh r
     where d.terminated_at is null and d.iqama_expiry is not null
       and d.iqama_expiry < r.today + 30
    union all
    select s.iqama_expiry
      from public.staff s, riyadh r
     where s.terminated_at is null and s.iqama_expiry is not null
       and s.iqama_expiry < r.today + 30
    union all
    select t.registration_expiry
      from public.trucks t, riyadh r
     where t.terminated_at is null and t.registration_expiry is not null
       and t.registration_expiry < r.today + 30
  ) exp
) k;

comment on view public.v_dashboard_action_items is
  'Dashboard queue: one row per action kind, always present even at zero. '
  'Counts only; the page deep-links to the owning module for detail. '
  'invoice_unpaid reads v_receivables_open so it matches Reports exactly. '
  'All date comparisons are Asia/Riyadh, matching todayKey().';


-- ===================================================================
-- 20260811000604  0103_restore_invoker_action_items
-- md5 4fc86409dab91317e99250b83811543b   196 characters
-- Retired by the 2026-09-16 ledger reconcile. Recorded here because
-- this is the only surviving copy. NOT a migration: do not run it.
-- ===================================================================
alter view public.v_dashboard_action_items set (security_invoker = true);
revoke all on public.v_dashboard_action_items from anon;
grant select on public.v_dashboard_action_items to authenticated;


-- ===================================================================
-- 20260818202229  0134b_fix_balance_guard_customer_join
-- md5 1a6cd2bed5e0afafd38af25872b53f46   3362 characters
-- Retired by the 2026-09-16 ledger reconcile. Recorded here because
-- this is the only surviving copy. NOT a migration: do not run it.
-- ===================================================================
begin;

-- FIX: my first 0134 guard joined projects on i.project_id, which does NOT exist on invoices.
-- Invoices link by customer_id; a customer's projects are single-mode (verified: 0 mixed-mode
-- customers). Resolve the invoice's mode as: invoice snapshot, else the customer's project mode.
-- Everything else in the function is unchanged from the just-applied version.
create or replace function public.pay_invoice(
  p_invoice_id uuid,
  p_payment_method text,
  p_proof_path text,
  p_payment_reference text,
  p_payment_date date,
  p_payment_note text
) returns public.invoices
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_row public.invoices;
  v_mode text;
begin
  if p_payment_method not in ('cash', 'bank_transfer', 'balance') then
    raise exception 'Invalid payment method: %', p_payment_method;
  end if;
  if p_payment_method = 'bank_transfer' and p_proof_path is null then
    raise exception 'bank_transfer payment requires a proof-of-payment file.';
  end if;
  if p_payment_method = 'bank_transfer' and p_payment_reference is null then
    raise exception 'bank_transfer payment requires a payment reference.';
  end if;
  if p_payment_method = 'bank_transfer' and p_payment_date is null then
    raise exception 'bank_transfer payment requires a payment date.';
  end if;

  -- 'balance' may only settle an invoice that resolves to prepaid mode.
  -- Resolve mode: invoice snapshot first, else the customer's project mode.
  -- Invoices link by customer_id (there is no invoices.project_id); every customer
  -- is single-mode today (0 mixed-mode customers) so the distinct project mode is
  -- unambiguous. A NULL snapshot is NOT evidence of "not prepaid" — resolve through
  -- the customer's projects, do not treat null as non-prepaid.
  -- NOTE: if multi-project customers with MIXED modes are ever introduced (a deferred
  -- feature), this single-mode resolution must be revisited.
  if p_payment_method = 'balance' then
    select coalesce(
             i.payment_mode,
             (select case when count(distinct pr.payment_mode) = 1
                          then max(pr.payment_mode) else null end
                from public.projects pr where pr.customer_id = i.customer_id)
           )
      into v_mode
      from public.invoices i
     where i.id = p_invoice_id;
    if v_mode is distinct from 'prepaid' then
      raise exception 'balance payment is only valid for prepaid invoices (resolved mode: %).', coalesce(v_mode,'unknown');
    end if;
  end if;

  update public.invoices
     set status                 = 'paid',
         paid_at                = now(),
         payment_method         = p_payment_method,
         proof_of_payment_path  = p_proof_path,
         payment_reference      = p_payment_reference,
         payment_date           = p_payment_date,
         payment_note           = p_payment_note
   where id = p_invoice_id
     and status = 'confirmed'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Invoice is not in confirmed status (or does not exist) — cannot mark paid.';
  end if;

  update public.trips
     set invoice_id = p_invoice_id
   where id = any(coalesce(v_row.covered_trip_ids, array[]::uuid[])
             || coalesce(v_row.unpaid_trip_ids, array[]::uuid[]));

  return v_row;
end;
$function$;

commit;


-- ===================================================================
-- 20260823235411  revoke_anon_default_privileges
-- md5 f88ff4efff001f022891fc319ce3f725   459 characters
-- Retired by the 2026-09-16 ledger reconcile. Recorded here because
-- this is the only surviving copy. NOT a migration: do not run it.
-- ===================================================================
-- Standing rule: stop the schema's default privileges from granting anon anything on
-- FUTURE tables. Scoped to the current role (postgres) — all public tables are
-- postgres-owned and migrations run as postgres, so this governs what new tables get.
-- The per-migration `revoke all ... from anon` idiom stays mandatory for tables created
-- by migrations that ran before this line.
alter default privileges in schema public revoke all on tables from anon;


-- ===================================================================
-- 20260910185821  reconcile_0193_trigger_fn_text
-- md5 e7ed767e305138ab4399e22e0a0243e2   2454 characters
-- Retired by the 2026-09-16 ledger reconcile. Recorded here because
-- this is the only surviving copy. NOT a migration: do not run it.
-- ===================================================================
CREATE OR REPLACE FUNCTION public.revoke_anon_execute_on_new_functions()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
begin
  -- OUTER GUARD. Nothing below may propagate. See the header: a raise here
  -- blocks CREATE FUNCTION database-wide.
  begin
    for r in
      select c.object_identity, c.schema_name
        from pg_event_trigger_ddl_commands() c
       where c.classid = 'pg_proc'::regclass
         and c.schema_name = 'public'
    loop
      -- INNER GUARD, per object. One un-revokable function must not stop the
      -- rest of the batch, and a batch is normal: a single migration file
      -- creating twelve functions is one ddl_command_end per statement, but a
      -- DO block emitting several is one event with several commands.
      begin
        -- object_identity is already schema-qualified and correctly quoted by
        -- Postgres, e.g. public.issue_driver_payslip(uuid, date, text). Do NOT
        -- pass it through %I — that would double-quote the whole string,
        -- argument list and all, and the revoke would fail on every object.
        execute format('revoke execute on function %s from public, anon', r.object_identity);
      exception
        when others then
          raise notice
            '0193: could not revoke anon EXECUTE on % (% / %). Left as created - the schema-wide invariant assertion in a later migration will catch it if it matters.',
            r.object_identity, sqlstate, sqlerrm;
      end;
    end loop;
  exception
    when others then
      raise notice
        '0193: event-trigger body failed entirely (% / %). CREATE FUNCTION was allowed to proceed on purpose - blocking DDL is the worse failure.',
        sqlstate, sqlerrm;
  end;
end
$function$;

revoke execute on function public.revoke_anon_execute_on_new_functions() from public, anon;

do $$
declare v_bad int;
begin
  if has_function_privilege('anon','public.revoke_anon_execute_on_new_functions()','execute') then
    raise exception 'reconcile: trigger fn is anon-executable.';
  end if;
  select count(*) into v_bad from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prokind in ('f','p') and p.prorettype<>'trigger'::regtype
     and has_function_privilege('anon',p.oid,'execute');
  if v_bad <> 0 then raise exception 'reconcile: % non-trigger anon-executable.', v_bad; end if;
end $$;
