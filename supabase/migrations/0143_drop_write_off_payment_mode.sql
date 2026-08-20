-- 0143_drop_write_off_payment_mode.sql
--
-- DROP customer_write_offs.payment_mode — a stored copy nothing reads.
--
-- WHAT IT WAS. 0139 added the column and archive_project_guarded has written it
-- ever since, lifting the mode straight off v_customer_amount_payable at the
-- moment of the forced archive. It was written for audit shape, by analogy with
-- invoices.payment_mode (0037). The analogy does not hold: the invoice snapshot
-- is READ — by pay_invoice's balance guard (0134) and by the effective-mode
-- coalesce in 0137/0139/0141 — whereas this one has never had a reader.
--
-- VERIFIED BEFORE DRAFTING, on the live DB:
--   * pg_depend lists exactly TWO entries against the column, and both are its
--     own customer_write_offs_payment_mode_check (deptype 'a' and 'n'). A
--     constraint that references only the dropped column is dropped with it, so
--     the bare DROP COLUMN below needs no CASCADE and takes nothing else.
--   * No view selects it. v_customer_amount_payable and v_invoice_outstanding_live
--     both mention a mode and both read customer_write_offs, but neither joins
--     the two — proven by the pg_depend result above, not by reading the bodies.
--   * No other routine references it. restore_customer_guarded touches
--     customer_write_offs and never names this column.
--   * No app reader: zero hits across app/ lib/ components/ scripts/ tests/.
--     The three repo hits for customer_write_offs are prose comments.
--   * 3 rows exist, all three with a non-null value. The data is discarded.
--
-- WHY THE FUNCTION MUST BE RECREATED IN THE SAME TRANSACTION. plpgsql bodies are
-- not dependency-tracked. A bare DROP COLUMN succeeds against a live writer and
-- says nothing; the failure surfaces later, as 42703 at the next FORCED archive
-- — the exact moment a manager is overriding a debt, the worst place to find it.
-- So the writer loses the column first, in the same transaction that drops it.
--
-- This whole file is one transaction. A failed assertion at the foot rolls back
-- the function AND the drop together.
-- ===========================================================================
begin;

-- ===========================================================================
-- 1. archive_project_guarded — same signature, same behaviour, one less column.
--
-- IDENTICAL to the 0141 version except that the write-off INSERT no longer
-- names the mode column, and the local that carried it is gone. Four removals,
-- nothing else:
--   * the `v_mode text;` declaration
--   * `ap.payment_mode` from the SELECT list
--   * `v_mode` from that statement's INTO list  (both, or the counts mismatch)
--   * the column from the INSERT column list, and `v_mode` from its VALUES
--
-- EVERYTHING ELSE IS HELD DELIBERATELY: the (uuid, text, text) signature, the
-- 'Project not found.' guard, the check_violation errcode on the owed-money
-- refusal, the two paired archived_at updates, and — most of all — the
-- `on conflict (customer_id) where reversed_at is null` target that 0141 exists
-- to install. Assertion (4) reads it back, because losing it here would
-- reintroduce the 42P10 that 0141 fixed.
--
-- `create or replace` is legal: the argument list does not change, so the 0038
-- one-signature rule is satisfied by construction. It preserves the existing
-- grant — restated below anyway, per 0141's note about invisible privileges.
-- ===========================================================================
create or replace function public.archive_project_guarded(
  p_project_id      uuid,
  p_override_reason text default null,
  p_actor           text default null
)
returns uuid
language plpgsql
as $function$
declare
  v_cust_id  uuid;
  v_blocked  boolean;
  v_owed     numeric(12,2);
  v_reason   text := nullif(btrim(coalesce(p_override_reason, '')), '');
begin
  select customer_id into v_cust_id from public.projects where id = p_project_id;
  if v_cust_id is null then raise exception 'Project not found.'; end if;

  select ap.archive_blocked, ap.owed_sar
    into v_blocked, v_owed
    from public.v_customer_amount_payable ap
   where ap.customer_id = v_cust_id;

  if v_blocked and v_reason is null then
    raise exception
      'This customer still owes % SAR. Archiving is blocked until it is settled, or overridden with a written reason.',
      to_char(v_owed, 'FM999,999,990.00')
      using errcode = 'check_violation';
  end if;

  if v_blocked then
    insert into public.customer_write_offs
      (customer_id, project_id, amount_sar, reason, written_off_by)
    values
      (v_cust_id, p_project_id, v_owed, v_reason, nullif(btrim(coalesce(p_actor, '')), ''))
    -- 0141: infers customer_write_offs_active_customer_idx (the PARTIAL unique
    -- index), not the dropped UNIQUE constraint. A reversed row no longer
    -- blocks a new decision.
    on conflict (customer_id) where reversed_at is null do nothing;
  end if;

  update public.projects  set archived_at = now() where id = p_project_id and archived_at is null;
  update public.customers set archived_at = now() where id = v_cust_id   and archived_at is null;

  return p_project_id;
end;
$function$;

grant execute on function public.archive_project_guarded(uuid, text, text) to authenticated;

-- Restated, with the one clause 0143 makes false corrected: the RPC no longer
-- reads a mode off v_customer_amount_payable. NOTE: this COMMENT is not part of
-- pg_get_functiondef, so naming the dropped column here does not trip
-- assertion (3) below. Do not name it inside the body.
comment on function public.archive_project_guarded(uuid, text, text) is
  'The ONLY archive path in this database (0139; 0019''s unguarded '
  'archive_project was dropped by 0140). Refuses to archive while the customer '
  'owes money unless given a written override reason, in which case the debt is '
  'recorded as a WRITE-OFF and the archive proceeds — all in one transaction. '
  'Reads archive_blocked / owed_sar from v_customer_amount_payable and computes '
  'no arithmetic of its own; if it ever grows any, that is the bug. '
  '0141 repointed its ON CONFLICT target at the partial unique index so a '
  'previously-reversed write-off cannot silently swallow a new one. '
  '0143 stopped it recording a payment_mode on the write-off row — the column '
  'was written but never read, and is gone.';

-- ===========================================================================
-- 2. The column itself.
--
-- No CASCADE on purpose. The only dependency is the column's own CHECK
-- (payment_mode is null or payment_mode in ('prepaid','postpaid')), which
-- Postgres drops automatically with the column. If anything else has attached
-- itself since this file was drafted, the bare form FAILS — and failing is the
-- point. A CASCADE here would silently take that unknown dependent with it.
-- ===========================================================================
alter table public.customer_write_offs
  drop column if exists payment_mode;

-- ===========================================================================
-- 3. AFTER APPLYING — assert the end state. Any failure rolls back BOTH the
--    function replacement and the drop, leaving 0141's world intact.
-- ===========================================================================
do $$
declare
  v_col_left    int;
  v_archive_fn  int;
  v_body_clean  boolean;
  v_conflict_ok boolean;
begin
  -- (1) the column is actually gone
  select count(*) into v_col_left
    from pg_attribute
   where attrelid = 'public.customer_write_offs'::regclass
     and attname  = 'payment_mode'
     and not attisdropped;

  if v_col_left <> 0 then
    raise exception
      'customer_write_offs.payment_mode still exists after the drop (found %). The whole point of this migration is that it should not.',
      v_col_left;
  end if;

  -- (2) exactly one signature (the 0038 rule)
  select count(*) into v_archive_fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'archive_project_guarded';

  if v_archive_fn <> 1 then
    raise exception
      'archive_project_guarded should be present exactly once, found %. Archiving is the only archive path there is - fix before continuing.',
      v_archive_fn;
  end if;

  -- (3) the live body no longer names the dropped column. If it does, the
  --     replacement did not take and the next forced archive raises 42703.
  select pg_get_functiondef(p.oid) not ilike '%payment_mode%'
    into v_body_clean
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'archive_project_guarded';

  if v_body_clean is not true then
    raise exception
      'archive_project_guarded is live but its body still references payment_mode, which no longer exists. The next forced archive would fail with 42703.';
  end if;

  -- (4) 0141's conflict target survived this rewrite. Not optional: a bare
  --     `on conflict (customer_id)` raises 42P10 on the next forced archive.
  select pg_get_functiondef(p.oid) ilike '%on conflict (customer_id) where reversed_at is null%'
    into v_conflict_ok
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'archive_project_guarded';

  if v_conflict_ok is not true then
    raise exception
      'archive_project_guarded lost its partial-index ON CONFLICT target in the 0143 rewrite. The next forced archive would fail with 42P10 - 0141 exists to prevent exactly this.';
  end if;
end;
$$;

commit;

-- ===========================================================================
-- REHEARSAL (run separately, rolled back — do NOT paste into the file above).
-- Confirms a forced archive still writes a write-off row and archives cleanly.
--
--   begin;
--     select public.archive_project_guarded(
--       '<project_id_of_a_customer_that_owes>'::uuid,
--       'rehearsal - rolled back',
--       'rehearsal@aquafleet'
--     );
--     select customer_id, amount_sar, reason, written_off_by, reversed_at
--       from public.customer_write_offs
--      where reason = 'rehearsal - rolled back';
--     select id, archived_at from public.projects  where id = '<project_id>'::uuid;
--     select id, archived_at from public.customers where id = '<customer_id>'::uuid;
--   rollback;
-- ===========================================================================
