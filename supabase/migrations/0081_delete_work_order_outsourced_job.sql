-- 0081_delete_work_order_outsourced_job.sql
-- Polish P2 item 1 — permanent delete of work orders, both tracks. Two
-- gated delete RPCs; nothing else in the schema changes.
--
-- APPLIED — this file was reconciled against pg_get_functiondef() on the
-- live DB after the architect applied its own rewritten draft (simpler
-- v_status-only variable, different error wording) instead of this file's
-- original draft. Below is a byte-for-byte match of what's actually live,
-- confirmed via the Supabase MCP, not the original draft's wording.
--
-- HARD SAFETY GATE, both RPCs: only a job that hasn't been started yet can
-- be deleted. Verified via a live FK query before drafting this (no
-- assumption): every child table CASCADEs off work_orders/outsourced_jobs,
-- confirmed exactly as follows —
--   work_orders          -> work_order_parts        (CASCADE)
--                         -> work_order_tasks        (CASCADE)
--   work_order_parts     -> work_order_part_photos       (CASCADE)
--                         -> work_order_part_consumptions (CASCADE)
--   outsourced_jobs       -> outsourced_job_repairers (CASCADE)
--                         -> outsourced_job_tasks      (CASCADE)
--                         -> workshop_payments         (CASCADE)
-- No triggers exist on either work_orders or outsourced_jobs (checked live)
-- — a plain DELETE is genuinely the whole operation, nothing else fires.
--
-- delete_work_order: gated to status='open'. An open WO is reserve-only —
-- create_work_order/edit_work_order never write to
-- work_order_part_consumptions or deduct real stock while status='open'
-- (that only happens at start_work_order via deduct_work_order_parts) — so
-- an open WO's own work_order_part_consumptions rows are always empty.
-- Deleting one therefore never touches stock/inventory_deducted_at/
-- price_lots at all.
--
-- delete_outsourced_job: gated to status='scheduled', PLUS an explicit
-- workshop_payments EXISTS check that RAISEs before the delete even though
-- the FK would happily CASCADE those rows away — a workshop_payment is a
-- real external AP money record (invoice/subtotal/VAT/discount/
-- grand_total), never something to silently lose to a cascade. The status
-- gate alone doesn't guarantee zero payments (nothing stops adding a
-- payment while a job is still 'scheduled'), so this is a separate,
-- explicit check.
--
-- Storage cleanup (in-house part photos, the "maintenance-photos" bucket)
-- is NOT done here — Postgres has no ability to reach into Supabase
-- Storage from SQL. The app-code caller (deleteWorkOrder() in
-- app/maintenance/actions.ts) reads every work_order_part_photos.
-- storage_path for this WO BEFORE calling this RPC, then removes those
-- objects from the bucket after the RPC succeeds — same "read pointers
-- first, delete bucket objects after the row is gone" order
-- removeWorkOrderPartPhoto() already uses. Outsourced jobs need no
-- equivalent step: the workshop_payments guard above means an outsourced
-- job can only ever be deleted with zero payments, and workshop_payment_
-- files (the only OS-side storage-pointer table) FKs to workshop_payments,
-- not outsourced_jobs directly — so there is structurally nothing to clean
-- up there.

begin;

-- ---------------------------------------------------------------------------
-- delete_work_order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_work_order(p_wo_id uuid, p_actor text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
begin
  select status into v_status from public.work_orders where id = p_wo_id for update;
  if v_status is null then
    raise exception 'Work order not found.';
  end if;
  if v_status <> 'open' then
    raise exception 'Only a scheduled (not-yet-started) work order can be deleted.';
  end if;

  delete from public.work_orders where id = p_wo_id;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.delete_work_order(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- delete_outsourced_job
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_outsourced_job(p_job_id uuid, p_actor text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
begin
  select status into v_status from public.outsourced_jobs where id = p_job_id for update;
  if v_status is null then
    raise exception 'Outsourced job not found.';
  end if;
  if v_status <> 'scheduled' then
    raise exception 'Only a scheduled (not-yet-dispatched) job can be deleted.';
  end if;
  if exists (select 1 from public.workshop_payments where outsourced_job_id = p_job_id) then
    raise exception 'Remove all workshop payments before deleting this job.';
  end if;

  delete from public.outsourced_jobs where id = p_job_id;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.delete_outsourced_job(uuid, text) TO authenticated;

commit;
