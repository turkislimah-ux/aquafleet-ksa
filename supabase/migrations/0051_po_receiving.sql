-- 0051_po_receiving.sql
-- Inventory — Phase 5 of the full-demo build-out: PO receiving (preview/'s
-- D().receivePO(), driven through the SAME receive draft confirmReceipt()
-- uses in loose mode — see the "NO SEPARATE, INVOICE-FREE PATH" note
-- below, added after review caught that the first draft of this migration
-- invented one). Migration only. No UI, no app-code wrapper — those land in
-- a follow-up step, same split every prior phase used.
--
-- SCOPE THIS MIGRATION:
--   ALTER purchase_order_lines to add received_qty/received_unit_price_sar
--   (0050's own header flagged these as deferred, not stubbed, until this
--   phase), ALTER purchase_orders to add received_by/received_date, ALTER
--   stock_receipts to add po_id (nullable — loose receipts have none), and
--   ONE new RPC: receive_purchase_order(). Approvals (Phase 6) are still
--   NOT built here; this phase only gets a PO INTO 'pending_approval', it
--   does not move it back out.
--
-- *** REVISION (review round 2) — three defects fixed, none cosmetic ***
-- The first draft of this migration was reviewed and NOT run. Three real
-- defects, all fixed below:
--
-- 1. DUPLICATE line_id. The old guard only compared jsonb_array_length(p_lines)
--    to the PO's line count — sending the same line_id twice (and omitting
--    a different one) passed that check, silently double-received one
--    part (double lot, double spend) while another line was never
--    received at all, and the PO still flipped to pending_approval as if
--    everything had been received. Fixed: the per-line loop now tracks
--    every line_id seen so far in v_line_ids (uuid[]) and raises the
--    moment a repeat shows up, BEFORE any add_price_lot call — no
--    partial damage from a bad request. The completeness check (line
--    count) still runs too, but now on top of the no-duplicates
--    guarantee, not instead of it.
--
-- 2. NO SEPARATE, INVOICE-FREE PATH — preview does NOT have a distinct
--    "receive a PO, no invoice" mechanism, and this migration's first draft
--    was wrong to invent one. Re-checked preview's actual receive flow
--    (pages-2.js confirmReceipt(), ~2725-2765): the invoice-required gate
--    (`if (d.invoices.length === 0) { toast; return; }`) runs UNCONDITIONALLY,
--    before the `if (d.mode === "po" && d.poId)` branch even executes — a
--    PO receipt in preview is the SAME receive draft as a loose receipt
--    (INV.openReceive(prefillPOId) just prefills supplier/warehouse/lines
--    from the PO), it is never allowed to skip the invoice. Fixed:
--    receive_purchase_order() below does NOT reimplement receiving — it
--    calls public.receive_loose_parts() (0047) directly, passing the PO's
--    own supplier_id/warehouse_id, so the mandatory-invoice check and the
--    stock_receipts/_lines/_files writes are the EXACT same code path a
--    loose receipt uses, not a parallel one that could drift or (as here)
--    ship with a hole in it. stock_receipts gains a nullable `po_id` column
--    so the resulting receipt can be traced back to the PO that generated
--    it (was previously impossible — 0047 had no such column).
--
-- 3. LOCKING COST — flagged, NOT addressed here. add_price_lot (0046) takes
--    a FOR UPDATE lock per part row and runs several statements per call;
--    calling it once per line inside receive_loose_parts, itself called
--    once per PO receipt, holds those locks (plus this function's own
--    FOR UPDATE on the purchase_orders row) for the whole transaction.
--    This is INHERITED, unchanged, from receive_loose_parts' own already-
--    live behavior (0047) — Phase 5 doesn't introduce a new locking
--    pattern, it reuses the existing one. Fine at today's volume; would
--    need a real redesign (e.g. batching add_price_lot or relaxing the
--    per-part lock) for large/concurrent POs, which is a Phase 2/3-level
--    change, not something to improvise inside a Phase 5 migration. Recorded
--    here for a future pass, not fixed now.
--
-- *** STATUS TRANSITION — MATCHES PREVIEW EXACTLY, NOT THE LIFECYCLE
-- COMMENT'S OWN "received" STEP ***
-- 0050's CHECK constraint carries a `received` value because preview's own
-- code COMMENT describes the lifecycle as "draft -> issued -> received ->
-- pending_approval -> approved/rejected". But preview's ACTUAL receivePO()
-- (data.js ~1851-1880) never assigns `po.status = "received"` anywhere — it
-- sets `po.status = "pending_approval"` directly, in the same call that
-- records the receipt. `received` is dead-on-arrival in preview's own
-- implementation, not just unused here yet. receive_purchase_order() below
-- mirrors preview's ACTUAL behavior (issued -> pending_approval, one step)
-- rather than the comment's aspirational one. The `received` CHECK value
-- stays in the constraint (harmless) but nothing in this app will ever
-- assign it.
--
-- *** DELIBERATE DEVIATION FROM PREVIEW: ISSUED-ONLY, NOT DRAFT-OR-ISSUED ***
-- Preview's own UI shows a "Receive" action for a PO in EITHER draft or
-- issued status (openPO's footer: `po.status === "issued" || po.status ===
-- "draft"`) — i.e. preview lets you receive stock against a PO that was
-- never actually sent to a supplier. That's a data-integrity gap, not
-- something to carry forward silently: `issue_purchase_order` (0050) is
-- this app's own explicit "this was actually sent" commitment step, so
-- receive_purchase_order() below REQUIRES status = 'issued'. Flagged as an
-- intentional, reasoned deviation (Turki: say the word if you want
-- draft-receiving allowed too — one extra value in the status check below).
--
-- *** NO STOCK PATH BYPASSED — SAME INVARIANT AS receive_loose_parts, NOW
-- LITERALLY THE SAME CODE PATH, NOT A PARALLEL ONE ***
-- receive_purchase_order() does not insert into price_lots, stock_receipts,
-- stock_receipt_lines, or stock_receipt_files itself, and does not touch
-- parts.qty_on_hand/unit_cost_sar — it calls public.receive_loose_parts()
-- (0047), which is the only thing that does any of that, exactly as it
-- already does for loose receipts. This keeps sum(price_lots.qty_remaining)
-- = parts.qty_on_hand holding with zero duplicated logic.
--
-- *** ONE-SHOT, FULL RECEIPT ONLY — NO PARTIAL-SHIPMENT TRACKING ***
-- Mirrors preview's own receivePO(): every line on the PO gets a
-- received_qty/received_unit_price_sar in the SAME call (the caller
-- pre-fills each line's actual qty/price, defaulting to the ordered amount
-- if unchanged — that default is the UI's job, not this RPC's). There is no
-- concept here of "receive half the lines now, the rest later" — a PO
-- transitions to pending_approval exactly once, fully. Splitting a PO
-- across multiple partial shipments is a real feature gap but out of scope
-- for this phase (not in preview either); flagged, not built.
--
-- RPC DISCIPLINE: exact-signature `drop function if exists` immediately
-- before `create or replace function`, `security definer` +
-- `set search_path = public`, `grant execute ... to authenticated` — same
-- as 0044/0046/0047/0050.
--
-- ON DELETE CHOICE: stock_receipts.po_id -> RESTRICT, same reasoning as
-- every other historical-record FK in this app (0045/0046/0047/0050) —
-- purchase_orders is never hard-deleted, so this is a hard guarantee, not
-- a real-world constraint that will ever bind.
--
-- NO NEW TABLES beyond the po_id column, NO RLS CHANGES — purchase_orders/
-- purchase_order_lines/stock_receipts' existing "authenticated_all_<table>"
-- policies already cover the new columns; policies are table-level, not
-- column-level, in this app's convention.

begin;

alter table public.purchase_order_lines
  add column if not exists received_qty numeric(12, 2),
  add column if not exists received_unit_price_sar numeric(12, 2);

alter table public.purchase_orders
  add column if not exists received_by text,
  add column if not exists received_date date;

alter table public.stock_receipts
  add column if not exists po_id uuid references public.purchase_orders(id) on delete restrict;

create index if not exists stock_receipts_po_id_idx
  on public.stock_receipts (po_id);

-- ----------------------------------------------------------------------------
-- receive_purchase_order(p_po_id, p_lines, p_files, p_note, p_actor)
-- p_lines: jsonb array of {"line_id": uuid, "received_qty": numeric,
--          "received_unit_price_sar": numeric} — MUST cover every existing
--          line on this PO exactly once (no duplicates, none missing;
--          line_id must belong to p_po_id — can't spoof another PO's line).
-- p_files: same shape/requirement as receive_loose_parts' own p_files —
--          mandatory (enforced by receive_loose_parts itself, not
--          reimplemented here).
--
-- Requires status = 'issued' (see header's deliberate-deviation note).
-- Locks the PO row (FOR UPDATE) so two concurrent receive calls on the same
-- PO can't both succeed. Validates + transforms the PO-shaped lines into
-- receive_loose_parts' own {part_id, qty, unit_price_sar} shape, then calls
-- that RPC directly — it does the mandatory-invoice check, creates the
-- stock_receipts/_lines/_files rows, and calls add_price_lot() per line
-- (0046) exactly as it does for a loose receipt. This function then stamps
-- the resulting receipt's po_id, records each PO line's actual
-- received_qty/received_unit_price_sar, and flips the PO to
-- 'pending_approval'. Whole thing is one transaction: any failure
-- (including receive_loose_parts' own "no invoice" refusal) rolls back
-- everything — no partial receipts, no PO left half-updated.
-- ----------------------------------------------------------------------------
drop function if exists public.receive_purchase_order(uuid, jsonb, jsonb, text, text);

create or replace function public.receive_purchase_order(
  p_po_id  uuid,
  p_lines  jsonb,
  p_files  jsonb,
  p_note   text default null,
  p_actor  text default null
) returns public.stock_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po             public.purchase_orders;
  v_receipt        public.stock_receipts;
  v_line           jsonb;
  v_line_id        uuid;
  v_qty            numeric(12, 2);
  v_price          numeric(12, 2);
  v_part_id        uuid;
  v_line_ids       uuid[] := array[]::uuid[];
  v_loose_lines    jsonb := '[]'::jsonb;
  v_po_line_count  integer;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'Purchase order not found.';
  end if;
  if v_po.status <> 'issued' then
    raise exception 'Only an issued purchase order can be received (current status: %).', v_po.status;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one line item is required.';
  end if;

  select count(*) into v_po_line_count
    from public.purchase_order_lines
   where purchase_order_id = p_po_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_line_id := nullif(v_line->>'line_id', '')::uuid;
    v_qty     := nullif(v_line->>'received_qty', '')::numeric;
    v_price   := nullif(v_line->>'received_unit_price_sar', '')::numeric;

    if v_line_id is null then
      raise exception 'Line item is missing line_id.';
    end if;
    -- Defect 1 fix: reject a repeated line_id immediately, before any
    -- add_price_lot call happens for ANY line in this batch.
    if v_line_id = any(v_line_ids) then
      raise exception 'Line % was submitted more than once — each line must be received exactly once.', v_line_id;
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Received quantity must be positive.';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Received unit price cannot be negative.';
    end if;

    select part_id into v_part_id
      from public.purchase_order_lines
     where id = v_line_id and purchase_order_id = p_po_id;
    if not found then
      raise exception 'Line % does not belong to this purchase order.', v_line_id;
    end if;

    v_line_ids := array_append(v_line_ids, v_line_id);
    v_loose_lines := v_loose_lines || jsonb_build_array(jsonb_build_object(
      'part_id', v_part_id,
      'qty', v_qty,
      'unit_price_sar', v_price
    ));
  end loop;

  -- Completeness check runs AFTER the no-duplicates loop above, so a
  -- request that both duplicates one line and omits another is caught by
  -- the duplicate check first (clearer error) rather than slipping through
  -- on a count that happens to still match.
  if array_length(v_line_ids, 1) <> v_po_line_count then
    raise exception 'Received lines (%) must cover every line on this purchase order (%), no duplicates, none missing.',
      array_length(v_line_ids, 1), v_po_line_count;
  end if;

  -- Defect 2 fix: reuse receive_loose_parts (0047) verbatim — same
  -- mandatory-invoice gate, same stock_receipts/_lines/_files writes, same
  -- add_price_lot call per line. Nothing here duplicates any of that.
  v_receipt := public.receive_loose_parts(
    v_po.supplier_id, v_po.warehouse_id, v_loose_lines, p_files, p_note, p_actor
  );

  update public.stock_receipts
     set po_id = p_po_id
   where id = v_receipt.id;

  update public.purchase_order_lines pol
     set received_qty = (elem->>'received_qty')::numeric,
         received_unit_price_sar = (elem->>'received_unit_price_sar')::numeric
    from jsonb_array_elements(p_lines) elem
   where pol.id = (elem->>'line_id')::uuid
     and pol.purchase_order_id = p_po_id;

  update public.purchase_orders
     set status = 'pending_approval',
         received_by = p_actor,
         received_date = current_date
   where id = p_po_id;

  select * into v_receipt from public.stock_receipts where id = v_receipt.id;

  return v_receipt;
end;
$$;

grant execute on function public.receive_purchase_order(uuid, jsonb, jsonb, text, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Post-run verification (run manually, not part of the migration):
--
--   select oid::regprocedure from pg_proc where proname = 'receive_purchase_order';
--   -- must return exactly ONE row:
--   -- receive_purchase_order(uuid, jsonb, jsonb, text, text)
--
--   -- FIFO invariant still holds after any receive_purchase_order call —
--   -- same check every prior receiving-path migration shipped with:
--   select p.id, p.qty_on_hand, coalesce(sum(pl.qty_remaining), 0) as lots_total
--     from public.parts p
--     left join public.price_lots pl on pl.part_id = p.id
--    group by p.id, p.qty_on_hand
--   having p.qty_on_hand <> coalesce(sum(pl.qty_remaining), 0);
--   -- must return ZERO rows
--
--   -- Every PO-linked receipt traces back correctly:
--   select sr.id, sr.po_id, po.po_number
--     from public.stock_receipts sr
--     join public.purchase_orders po on po.id = sr.po_id;
--   -- (empty until the first receive_purchase_order call — expected)
--
--   -- Duplicate-line_id rejection (defect 1) — this MUST raise, not
--   -- silently double-receive (replace placeholders with a real issued
--   -- PO that has at least 2 lines):
--   -- select * from public.receive_purchase_order(
--   --   '<po-uuid>',
--   --   '[{"line_id":"<line-1-uuid>","received_qty":5,"received_unit_price_sar":10},
--   --     {"line_id":"<line-1-uuid>","received_qty":5,"received_unit_price_sar":10}]'::jsonb,
--   --   '[{"storage_path":"test/invoice-1.pdf","file_name":"invoice-1.pdf","mime_type":"application/pdf"}]'::jsonb,
--   --   'Smoke test', 'you@example.com'
--   -- );
--   -- expected: raises "Line ... was submitted more than once", nothing written.
--
--   -- No-invoice rejection (defect 2) — this MUST raise (empty p_files),
--   -- proving the invoice gate really is inherited from receive_loose_parts:
--   -- select * from public.receive_purchase_order(
--   --   '<po-uuid>', '[{"line_id":"<line-uuid>","received_qty":5,"received_unit_price_sar":10}]'::jsonb,
--   --   '[]'::jsonb, null, 'you@example.com'
--   -- );
--   -- expected: raises "At least one invoice file is required."
--
--   -- Happy path (replace placeholders with a real issued single-line PO):
--   -- select * from public.receive_purchase_order(
--   --   '<po-uuid>',
--   --   '[{"line_id":"<line-uuid>","received_qty":10,"received_unit_price_sar":12.50}]'::jsonb,
--   --   '[{"storage_path":"test/invoice-1.pdf","file_name":"invoice-1.pdf","mime_type":"application/pdf"}]'::jsonb,
--   --   'Smoke test', 'you@example.com'
--   -- );
--   -- status should read 'pending_approval', received_by/received_date set,
--   -- stock_receipts row created with po_id populated.
-- ---------------------------------------------------------------------------
