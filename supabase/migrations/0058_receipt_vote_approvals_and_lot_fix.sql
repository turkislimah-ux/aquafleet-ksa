-- 0058_receipt_vote_approvals_and_lot_fix.sql
-- Fixes two confirmed defects in 0057 (applied, LIVE) and changes the
-- approval model to a matching-vote system. Drafted to disk only — NOT
-- applied. Turki runs this in the Supabase SQL Editor.
--
-- *** DEFECT 1 — reject_stock_receipt referenced a column that doesn't
-- exist ***
-- 0057's reject_stock_receipt (both void_cost and remove_stock branches,
-- plus the consumed-check) reads `price_lots.stock_receipt_id`. Verified
-- directly against the live catalog before writing this: price_lots has
-- 8 columns (id, part_id, price_sar, qty_purchased, qty_remaining,
-- received_on, note, created_at) — no such column, never added by any
-- migration. This function could not have run successfully on either
-- branch; it would raise "column pl.stock_receipt_id does not exist" the
-- first time actually called. Postgres doesn't validate a plpgsql
-- function's embedded SQL against real schema at CREATE time, only at
-- execution, which is how this shipped without erroring at apply time.
-- The REAL link from a receipt to its lots already exists and was simply
-- unused: stock_receipts -> stock_receipt_lines (has both receipt_id and
-- price_lot_id) -> price_lots. Fixed by traversing that path everywhere
-- "this receipt's lots" is needed — no column added to price_lots.
--
-- *** DEFECT 2 — receive_loose_parts never populates
-- stock_receipt_lines.price_lot_id ***
-- Verified live: 18 stock_receipt_lines rows total, only 13 have
-- price_lot_id set (from some earlier version of this function that no
-- longer matches what's deployed — moot now, fixed going forward).
-- Without this, defect 1's fix has nothing reliable to traverse for any
-- NEW receipt. Fixed by looking up the lot add_price_lot just created
-- (most-recent lot for that part, right after the call) and including it
-- in the stock_receipt_lines insert. add_price_lot itself is NOT
-- changed — no new parameter, exact same 6-arg signature it's always
-- had; only receive_loose_parts's own insert changes.
-- KNOWN, ACCEPTED EDGE CASE (flagged, not solved here, same category as
-- 0051's own "locking cost" precedent): if a single receive_loose_parts
-- call includes two lines for the SAME part_id, the "most recent lot for
-- this part" lookup after the second add_price_lot call could, in a
-- pathological same-transaction-timestamp tie, attribute either line's
-- lot to the wrong price_lot_id. Low practical risk (nothing in the app
-- UI submits duplicate-part lines in one receipt today), not fixed here
-- since doing so properly would mean changing add_price_lot's return
-- shape (bigger surgery than this fix's scope).
-- The 5 existing rows with price_lot_id already null are NOT backfilled —
-- no reliable way to retroactively match them to a specific lot, same
-- "don't fabricate a fact" precedent as every other frozen-snapshot gap in
-- this feature. They will correctly hard-block reject (either outcome,
-- see below) via the new traceability guard if anyone ever tries to
-- reject one of those old receipts — an honest limitation, not a silent
-- wrong answer.
--
-- *** ALL-OR-NOTHING TRACEABILITY GUARD, BOTH OUTCOMES ***
-- Previously only remove_stock implicitly needed traceable lots. Now BOTH
-- void_cost and remove_stock require EVERY line on the receipt to have a
-- non-null price_lot_id, or the whole reject is blocked (clear message
-- naming the part, nothing mutated). Reasoning: repricing only some lines
-- while silently skipping an untraceable one would leave a "voided"
-- receipt with real leftover cost sitting on an unreachable lot — worse
-- than refusing outright. Same all-or-nothing shape remove_stock's
-- consumed-check already had.
--
-- *** APPROVAL MODEL CHANGE — matching vote, not immediate one-sided
-- action *** (locked with Turki)
-- Both approvers must take the SAME action. Two approves -> approved. Two
-- MATCHING rejects (same outcome; reason can differ) -> rejected. The
-- FIRST vote sets the direction — the SECOND can only match it (mismatch
-- raises a clear error, nothing written). Before a second, matching vote
-- lands, the sole (first) voter can change their own vote freely
-- (approve<->reject, or switch reject outcome) — pre-finalization, nothing
-- is locked. Once the second matching vote lands, it's final: approve
-- flips stock_receipts.status immediately (unchanged — approve never
-- touched stock); reject now ALSO only runs its stock effect (void_cost
-- repricing, or remove_stock's consumed-check + reversal) at THIS moment
-- — a lone/first reject vote touches ZERO stock. Approved-is-final stays
-- the very first guard in both functions, checked before any vote logic
-- runs at all.
--
-- Storage: stock_receipt_approvals (0057's table) gains `action`
-- ('approve'|'reject') and `outcome` ('void_cost'|'remove_stock', only
-- when action='reject'). The existing UNIQUE(stock_receipt_id,
-- approver_email) becomes the natural upsert key for "one voter's current
-- vote" — this is a deliberate, explicit exception to this feature's
-- usual append-only-ledger convention (price_lots/stock_movements stay
-- untouched by this — this table specifically holds a PROVISIONAL vote
-- until the second matching one arrives, which is a genuinely different
-- shape than an audit ledger of already-committed facts). Once a
-- receipt's status leaves 'pending_approval', the approved-is-final guard
-- makes every row for it immutable in practice — no explicit "locked"
-- flag needed. `comment` (0057) is reused for either action's free text
-- (an approve comment or a reject reason) — not renamed physically.
-- `approved_at` stays physically named but now means "last voted at"
-- since a row can be updated pre-finalization.
--
-- Because a match only requires 2 distinct approvers to have voted while
-- status is still 'pending_approval', and finalizing a match always flips
-- status away from 'pending_approval' in the SAME transaction as the
-- second insert, at most ONE vote row can ever exist for a receipt still
-- reading 'pending_approval' — so every function body below only ever
-- has to handle "0 rows" / "1 row, mine" / "1 row, someone else's".
--
-- *** RPCs CHANGED — same signatures, bodies rewritten ***
-- approve_stock_receipt(p_receipt_id, p_comment, p_actor) — unchanged args.
-- reject_stock_receipt(p_receipt_id, p_mode, p_reason, p_actor) — unchanged args.
-- receive_loose_parts(p_supplier_id, p_warehouse_id, p_lines, p_files,
--   p_note, p_actor) — unchanged args, only the price_lot_id insert changes.
-- add_price_lot, receive_purchase_order, approve_purchase_order,
-- reject_purchase_order — NOT touched. The vote model is scoped to
-- receipt-level approval only, per Turki's explicit instruction; the
-- old PO-native approve/reject stay exactly as they are (0052).
-- lib/prepaid.ts / vat.ts / invoice.ts — not touched, as always.
--
-- *** LOCKING — matches every other stock RPC ***
-- stock_receipts row locked FOR UPDATE first in both functions — this
-- single lock serializes every vote/finalize attempt for the same
-- receipt (concurrent calls queue behind it), so no separate lock is
-- needed on stock_receipt_approvals itself. The specific price_lots rows
-- a completing reject is about to touch are ALSO locked FOR UPDATE right
-- before the consumed-check/mutation, defensively — consume_from_lots has
-- no app-code caller anywhere yet (still true), so this is forward-looking
-- protection, not exercisable today, same category as every other
-- "flagged, not fully closed" locking note in this feature (0051's own
-- precedent).
--
-- FIFO invariant (sum(price_lots.qty_remaining) == parts.qty_on_hand per
-- part) holds after a completing remove_stock reject by construction,
-- same as before: the consumed-check already guarantees qty_remaining ==
-- qty_purchased for every lot this receipt's lines point at, so reducing
-- qty_on_hand by exactly that same summed amount and deleting exactly
-- those lots keeps both sides moving by an identical, guard-verified
-- number — just correctly scoped to the receipt's OWN lots now (via
-- stock_receipt_lines.price_lot_id) instead of a query against a column
-- that never existed.

begin;

-- ----------------------------------------------------------------------------
-- stock_receipt_approvals — vote columns.
-- ----------------------------------------------------------------------------
alter table public.stock_receipt_approvals
  add column if not exists action text not null default 'approve'
    check (action in ('approve', 'reject')),
  add column if not exists outcome text
    check (outcome is null or outcome in ('void_cost', 'remove_stock'));

alter table public.stock_receipt_approvals
  drop constraint if exists stock_receipt_approvals_action_outcome_check;
alter table public.stock_receipt_approvals
  add constraint stock_receipt_approvals_action_outcome_check
  check ((action = 'reject' and outcome is not null) or (action = 'approve' and outcome is null));

-- ----------------------------------------------------------------------------
-- receive_loose_parts — ONLY change: populates stock_receipt_lines.
-- price_lot_id by looking up the lot add_price_lot just created. Signature
-- unchanged (still 6 args). add_price_lot itself untouched.
-- ----------------------------------------------------------------------------
drop function if exists public.receive_loose_parts(uuid, uuid, jsonb, jsonb, text, text);

create or replace function public.receive_loose_parts(
  p_supplier_id  uuid,
  p_warehouse_id uuid,
  p_lines        jsonb,
  p_files        jsonb,
  p_note         text default null,
  p_actor        text default null
) returns public.stock_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt   public.stock_receipts;
  v_line      jsonb;
  v_file      jsonb;
  v_part_id   uuid;
  v_qty       numeric(12, 2);
  v_price     numeric(12, 2);
  v_lot_id    uuid;
  v_line_vat  numeric(12, 2);
  v_total     numeric(12, 2) := 0;
  v_vat_total numeric(12, 2) := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one line item is required.';
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then
    raise exception 'At least one invoice file is required.';
  end if;

  perform 1 from public.suppliers where id = p_supplier_id and active = true;
  if not found then
    raise exception 'Supplier not found or inactive.';
  end if;

  perform 1 from public.warehouses where id = p_warehouse_id and active = true;
  if not found then
    raise exception 'Warehouse not found or inactive.';
  end if;

  insert into public.stock_receipts (supplier_id, warehouse_id, note, received_by, receipt_type)
  values (p_supplier_id, p_warehouse_id, nullif(trim(p_note), ''), p_actor, 'direct')
  returning * into v_receipt;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_part_id := nullif(v_line->>'part_id', '')::uuid;
    v_qty     := nullif(v_line->>'qty', '')::numeric;
    v_price   := nullif(v_line->>'unit_price_sar', '')::numeric;

    if v_part_id is null then
      raise exception 'Line item is missing part_id.';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Line item quantity must be positive.';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Line item price cannot be negative.';
    end if;

    v_line_vat := round(v_qty * v_price * 0.15, 2);

    perform public.add_price_lot(v_part_id, v_price, v_qty, v_receipt.received_on, p_note, p_actor);

    -- Fix: trace this line back to the lot add_price_lot just created for
    -- it, so reject_stock_receipt can find it later (see this migration's
    -- own header for the known same-part-twice-in-one-receipt edge case).
    select id into v_lot_id
      from public.price_lots
     where part_id = v_part_id
     order by created_at desc
     limit 1;

    insert into public.stock_receipt_lines (receipt_id, part_id, price_lot_id, qty, unit_price_sar, line_vat_sar)
    values (v_receipt.id, v_part_id, v_lot_id, v_qty, v_price, v_line_vat);

    v_total     := v_total + (v_qty * v_price);
    v_vat_total := v_vat_total + v_line_vat;
  end loop;

  for v_file in select * from jsonb_array_elements(p_files)
  loop
    if coalesce(v_file->>'storage_path', '') = '' or coalesce(v_file->>'file_name', '') = '' then
      raise exception 'Invoice file entry is missing storage_path or file_name.';
    end if;

    insert into public.stock_receipt_files (receipt_id, storage_path, file_name, mime_type)
    values (v_receipt.id, v_file->>'storage_path', v_file->>'file_name', nullif(v_file->>'mime_type', ''));
  end loop;

  update public.stock_receipts
     set total_cost_sar = v_total,
         vat_sar = v_vat_total,
         grand_total_sar = v_total + v_vat_total
   where id = v_receipt.id
  returning * into v_receipt;

  return v_receipt;
end;
$$;

grant execute on function public.receive_loose_parts(uuid, uuid, jsonb, jsonb, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- approve_stock_receipt — vote model. Same 3-arg signature.
-- ----------------------------------------------------------------------------
drop function if exists public.approve_stock_receipt(uuid, text, text);

create or replace function public.approve_stock_receipt(
  p_receipt_id uuid,
  p_comment    text default null,
  p_actor      text default null
) returns public.stock_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt    public.stock_receipts;
  v_own_vote   public.stock_receipt_approvals;
  v_other_vote public.stock_receipt_approvals;
begin
  select * into v_receipt from public.stock_receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'Receipt not found.';
  end if;

  -- APPROVED IS FINAL — enforced first, before any vote logic runs.
  if v_receipt.status <> 'pending_approval' then
    raise exception 'Only a receipt awaiting approval can be approved (current status: %).', v_receipt.status;
  end if;

  if p_actor is null then
    raise exception 'Approver identity is required.';
  end if;

  perform 1 from public.staff
   where email = p_actor and active = true and terminated_at is null
     and role in ('fleet_manager', 'ops_supervisor', 'inventory_clerk');
  if not found then
    raise exception 'Not authorized to approve receipts.';
  end if;

  select * into v_own_vote
    from public.stock_receipt_approvals
   where stock_receipt_id = p_receipt_id and approver_email = p_actor;

  if found then
    -- Sole voter (the only state reachable pre-finalization) freely
    -- changing their own vote — approve<->reject, or re-affirming approve.
    update public.stock_receipt_approvals
       set action = 'approve', outcome = null, comment = nullif(trim(p_comment), ''), approved_at = now()
     where stock_receipt_id = p_receipt_id and approver_email = p_actor;
    return v_receipt;
  end if;

  select * into v_other_vote
    from public.stock_receipt_approvals
   where stock_receipt_id = p_receipt_id
   limit 1;

  if not found then
    -- First vote on this receipt — records the vote only. Approve never
    -- touched stock anyway; the new part is that it also doesn't finalize
    -- the receipt's status alone anymore.
    insert into public.stock_receipt_approvals (stock_receipt_id, approver_email, action, outcome, comment)
    values (p_receipt_id, p_actor, 'approve', null, nullif(trim(p_comment), ''));
    return v_receipt;
  end if;

  -- Second, distinct voter — must MATCH the first vote's action.
  if v_other_vote.action <> 'approve' then
    raise exception 'This receipt already has a pending reject vote (by %) — your action must match it, or ask them to change their vote first.', v_other_vote.approver_email;
  end if;

  -- Match — finalize.
  insert into public.stock_receipt_approvals (stock_receipt_id, approver_email, action, outcome, comment)
  values (p_receipt_id, p_actor, 'approve', null, nullif(trim(p_comment), ''));

  update public.stock_receipts set status = 'approved' where id = p_receipt_id
  returning * into v_receipt;

  return v_receipt;
end;
$$;

grant execute on function public.approve_stock_receipt(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- reject_stock_receipt — vote model + corrected lot traversal + all-or-
-- nothing traceability guard on BOTH outcomes. Same 4-arg signature.
-- ----------------------------------------------------------------------------
drop function if exists public.reject_stock_receipt(uuid, text, text, text);

create or replace function public.reject_stock_receipt(
  p_receipt_id uuid,
  p_mode       text,
  p_reason     text default null,
  p_actor      text default null
) returns public.stock_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt    public.stock_receipts;
  v_own_vote   public.stock_receipt_approvals;
  v_other_vote public.stock_receipt_approvals;
  v_consumed   boolean;
  v_line       record;
begin
  select * into v_receipt from public.stock_receipts where id = p_receipt_id for update;
  if not found then
    raise exception 'Receipt not found.';
  end if;

  -- APPROVED IS FINAL — enforced first, before any vote logic runs.
  if v_receipt.status <> 'pending_approval' then
    raise exception 'Only a receipt awaiting approval can be rejected (current status: %).', v_receipt.status;
  end if;

  if p_mode is null or p_mode not in ('void_cost', 'remove_stock') then
    raise exception 'Rejection mode must be void_cost or remove_stock.';
  end if;

  if p_actor is null then
    raise exception 'Approver identity is required.';
  end if;

  perform 1 from public.staff
   where email = p_actor and active = true and terminated_at is null
     and role in ('fleet_manager', 'ops_supervisor', 'inventory_clerk');
  if not found then
    raise exception 'Not authorized to reject receipts.';
  end if;

  select * into v_own_vote
    from public.stock_receipt_approvals
   where stock_receipt_id = p_receipt_id and approver_email = p_actor;

  if found then
    -- Sole voter changing their own vote freely — NO stock touched,
    -- since nothing finalizes on a lone voter.
    update public.stock_receipt_approvals
       set action = 'reject', outcome = p_mode, comment = nullif(trim(p_reason), ''), approved_at = now()
     where stock_receipt_id = p_receipt_id and approver_email = p_actor;
    return v_receipt;
  end if;

  select * into v_other_vote
    from public.stock_receipt_approvals
   where stock_receipt_id = p_receipt_id
   limit 1;

  if not found then
    -- First vote — records the vote only. NO stock effect at all: the
    -- entire point of the vote model is that a lone reject never touches
    -- stock, regardless of which outcome was chosen.
    insert into public.stock_receipt_approvals (stock_receipt_id, approver_email, action, outcome, comment)
    values (p_receipt_id, p_actor, 'reject', p_mode, nullif(trim(p_reason), ''));
    return v_receipt;
  end if;

  -- Second, distinct voter — must match action AND (since rejecting)
  -- outcome exactly. Reason is free-text per voter and never compared.
  if v_other_vote.action <> 'reject' then
    raise exception 'This receipt already has a pending approve vote (by %) — your action must match it, or ask them to change their vote first.', v_other_vote.approver_email;
  end if;
  if v_other_vote.outcome <> p_mode then
    raise exception 'This receipt already has a pending reject vote with outcome % (by %) — the second reject must match that outcome exactly.', v_other_vote.outcome, v_other_vote.approver_email;
  end if;

  -- MATCH — this is the completing vote. Run the actual stock effect now.
  -- Lots belonging to this receipt are found via
  -- stock_receipt_lines.price_lot_id -> price_lots — NEVER
  -- price_lots.stock_receipt_id, which does not exist (see this
  -- migration's own header on why the prior version was broken).

  -- ALL-OR-NOTHING traceability guard, BOTH outcomes: every line on this
  -- receipt must have a real price_lot_id, or the whole reject is
  -- blocked — no partial application either way.
  for v_line in
    select srl.part_id, srl.price_lot_id
      from public.stock_receipt_lines srl
     where srl.receipt_id = p_receipt_id
  loop
    if v_line.price_lot_id is null then
      raise exception 'Part % on this receipt has no traceable price lot — cannot safely reject (either outcome). This receipt predates reliable lot tracking.', v_line.part_id;
    end if;
  end loop;

  -- Defensive lock on exactly the lots this receipt's lines point at,
  -- before reading/mutating them (flagged in this migration's own header
  -- — forward-looking, consume_from_lots has no caller yet today).
  perform 1 from public.price_lots
   where id in (select srl.price_lot_id from public.stock_receipt_lines srl where srl.receipt_id = p_receipt_id)
   for update;

  if p_mode = 'remove_stock' then
    -- Block if ANY of this receipt's own lots has been drained, or if a
    -- 'consume' movement exists for an affected part since this receipt
    -- was booked.
    select exists (
      select 1
        from public.stock_receipt_lines srl
        join public.price_lots pl on pl.id = srl.price_lot_id
       where srl.receipt_id = p_receipt_id
         and pl.qty_remaining < pl.qty_purchased
    ) or exists (
      select 1 from public.stock_movements sm
       where sm.movement_type = 'consume'
         and sm.part_id in (
           select srl.part_id from public.stock_receipt_lines srl where srl.receipt_id = p_receipt_id
         )
         and sm.created_at >= v_receipt.created_at
    ) into v_consumed;

    if v_consumed then
      raise exception 'Cannot remove this receipt''s stock — some of it has already been consumed. Use void-cost instead.';
    end if;

    -- Reverse: for each part, reduce qty_on_hand by exactly THIS
    -- receipt's own lots' remaining qty, then delete exactly those lots
    -- (not every lot for the part — only the ones this receipt created).
    for v_line in
      select srl.part_id, sum(pl.qty_remaining) as qty
        from public.stock_receipt_lines srl
        join public.price_lots pl on pl.id = srl.price_lot_id
       where srl.receipt_id = p_receipt_id
       group by srl.part_id
    loop
      update public.parts set qty_on_hand = qty_on_hand - v_line.qty where id = v_line.part_id;
      insert into public.stock_movements (part_id, movement_type, qty_delta, qty_after, note, created_by)
      select v_line.part_id, 'adjust', -v_line.qty, qty_on_hand, 'Receipt rejected — stock removed', p_actor
        from public.parts where id = v_line.part_id;
    end loop;

    delete from public.price_lots
     where id in (
       select srl.price_lot_id from public.stock_receipt_lines srl where srl.receipt_id = p_receipt_id
     );

    update public.parts p
       set unit_cost_sar = coalesce((
         select pl.price_sar from public.price_lots pl
          where pl.part_id = p.id and pl.qty_remaining > 0
          order by pl.received_on desc, pl.created_at desc limit 1
       ), 0)
     where p.id in (
       select distinct part_id from public.stock_receipt_lines where receipt_id = p_receipt_id
     );

  else -- void_cost
    update public.price_lots
       set price_sar = 0
     where id in (
       select srl.price_lot_id from public.stock_receipt_lines srl where srl.receipt_id = p_receipt_id
     );

    update public.parts p
       set unit_cost_sar = coalesce((
         select pl.price_sar from public.price_lots pl
          where pl.part_id = p.id and pl.qty_remaining > 0
          order by pl.received_on desc, pl.created_at desc limit 1
       ), 0)
     where p.id in (
       select distinct part_id from public.stock_receipt_lines where receipt_id = p_receipt_id
     );
  end if;

  insert into public.stock_receipt_approvals (stock_receipt_id, approver_email, action, outcome, comment)
  values (p_receipt_id, p_actor, 'reject', p_mode, nullif(trim(p_reason), ''));

  update public.stock_receipts
     set status = 'rejected', rejected_by = p_actor, rejected_at = now(),
         rejection_reason = nullif(trim(p_reason), ''), rejection_mode = p_mode
   where id = p_receipt_id
  returning * into v_receipt;

  return v_receipt;
end;
$$;

grant execute on function public.reject_stock_receipt(uuid, text, text, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Post-run verification (run manually, not part of the migration):
--
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='stock_receipt_approvals'
--      and column_name in ('action','outcome');
--   -- both present.
--
--   select oid::regprocedure from pg_proc where proname = 'receive_loose_parts';
--   -- exactly one row: receive_loose_parts(uuid, uuid, jsonb, jsonb, text, text)
--   select oid::regprocedure from pg_proc where proname = 'approve_stock_receipt';
--   -- exactly one row: approve_stock_receipt(uuid, text, text)
--   select oid::regprocedure from pg_proc where proname = 'reject_stock_receipt';
--   -- exactly one row: reject_stock_receipt(uuid, text, text, text)
--
--   -- price_lot_id now populated on new receives (smoke test after a real
--   -- receive through the app):
--   -- select count(*), count(price_lot_id) from public.stock_receipt_lines
--   --  where created_at > now() - interval '1 hour';
--   -- both counts must match for anything received after this migration.
--
--   -- Vote model smoke test (needs a real pending_approval direct receipt
--   -- and two real approver-eligible staff emails):
--   -- select * from public.reject_stock_receipt('<receipt-uuid>', 'void_cost', 'reason A', 'approver1@example.com');
--   -- status must STAY 'pending_approval' — first vote, no stock touched.
--   -- select * from public.approve_stock_receipt('<receipt-uuid>', null, 'approver2@example.com');
--   -- MUST raise: "This receipt already has a pending reject vote (by
--   -- approver1@example.com) — your action must match it..."
--   -- select * from public.reject_stock_receipt('<receipt-uuid>', 'remove_stock', 'reason B', 'approver2@example.com');
--   -- MUST raise: "...pending reject vote with outcome void_cost..." (mode mismatch).
--   -- select * from public.reject_stock_receipt('<receipt-uuid>', 'void_cost', 'reason B', 'approver2@example.com');
--   -- MUST succeed — matching outcome, completes: status -> 'rejected',
--   -- rejection_mode='void_cost', that receipt's own lots repriced to 0.
--   -- select * from public.reject_stock_receipt('<receipt-uuid>', 'void_cost', null, 'approver1@example.com');
--   -- MUST raise "already rejected" (approved-is-final-style guard) —
--   -- status no longer 'pending_approval'.
--
--   -- FIFO invariant, unaffected by this migration's own DDL, must hold
--   -- after any completing reject exercised above:
--   select p.id, p.qty_on_hand, coalesce(sum(pl.qty_remaining), 0) as lots_total
--     from public.parts p
--     left join public.price_lots pl on pl.part_id = p.id
--    group by p.id, p.qty_on_hand
--   having p.qty_on_hand <> coalesce(sum(pl.qty_remaining), 0);
--   -- must return zero rows.
-- ---------------------------------------------------------------------------
