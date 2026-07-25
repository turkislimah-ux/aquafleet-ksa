-- 0055_po_receive_extra_lines.sql
-- Inventory — "risky batch" Stage 2: unified receive with extra ad-hoc
-- lines. Turki's own words: on a PO receipt, allow receiving parts that
-- were NOT on the original PO (extra items the supplier delivered anyway),
-- received through the exact same add_price_lot path as everything else
-- (FIFO invariant holds, invoice still mandatory), and have the PO itself
-- end up reflecting what was actually received — not just what was
-- ordered. Migration only. No UI, no app-code wrapper — those land in a
-- follow-up step, same split every prior phase used. DRAFTED TO DISK ONLY,
-- NOT APPLIED — Turki runs migrations, not Claude.
--
-- *** WHAT PREVIEW ACTUALLY DOES (checked before designing, not assumed) ***
-- preview's own receive draft already supports adding extra ad-hoc lines
-- inside a PO-mode receipt — rcvAddLine()'s own comment says so explicitly
-- ("Add a fresh empty part-line in manual mode (and in PO mode if extra
-- parts are received alongside the PO)", pages-2.js ~2500-2502) — and its
-- render distinguishes PO-derived lines (`plannedQty != null`, shown with a
-- Match/Variance pill, no delete button) from ad-hoc ones (`plannedQty ==
-- null`, shown with a delete button) in the exact same line table
-- (pages-2.js ~2571-2593). BUT preview's confirmReceipt() (~2725-2750) only
-- mirrors receivedQty/receivedUnitPriceSar onto lines that already exist on
-- `po.lines` (`po.lines.forEach(l => { const draftLine = d.lines.find(x =>
-- x.partId === l.partId); if (draftLine) {...} })`) — any draft line with
-- no matching po.lines entry (i.e. every ad-hoc extra) is received into
-- stock via receivePO()'s own D().receiveLooseParts()-equivalent effect,
-- but is NEVER pushed onto po.lines. Preview's own demo silently drops the
-- reconciliation for exactly the case Turki is asking for here — this
-- migration deliberately goes beyond preview's own (incomplete) behavior,
-- per his explicit requirement ("the PO is updated to include the added
-- lines, so the PO ends up matching what was actually received").
--
-- *** THE THIRD REQUIREMENT — "DETACH THE PO LINK" — NEEDS NO NEW SQL AT
-- ALL, RECORDED HERE SO THE FUTURE UI PASS KNOWS WHY ***
-- "Detach/cancel the PO link from within the receive flow" means: don't
-- reconcile this receiving event against the PO at all — the goods still
-- get received (stock arrives, invoice still mandatory, price lots still
-- created), but as a plain loose receipt with no po_id, and the PO itself
-- is left completely untouched (still 'issued', not moved to
-- 'pending_approval', none of its lines touched). That is EXACTLY what
-- calling public.receive_loose_parts() (0047) directly already does — it
-- has no notion of a PO to begin with. "Detach" is a UI-level routing
-- decision (call receive_loose_parts instead of receive_purchase_order,
-- using the same supplier_id/warehouse_id/lines the draft already has,
-- which happen to have been prefilled from the PO but are just plain data
-- to that RPC), not a new code path here. receive_purchase_order() below
-- is unchanged in this respect — it is still the ONLY function that
-- touches purchase_orders/purchase_order_lines during a receipt, and it is
-- simply not the function the UI will call when the user detaches.
--
-- *** THE REWORK, PRECISELY ***
-- receive_purchase_order(p_po_id, p_lines, p_files, p_note, p_actor) keeps
-- its exact 5-arg signature (uuid, jsonb, jsonb, text, text) — nothing
-- about the SQL parameter list changes, only the CONTENT contract of
-- p_lines's array elements, which now come in two shapes instead of one:
--
--   Existing PO line (unchanged shape/behavior from 0051):
--     {"line_id": uuid, "received_qty": numeric, "received_unit_price_sar": numeric}
--   Extra / ad-hoc line — NEW, not on the original PO:
--     {"part_id": uuid, "received_qty": numeric, "received_unit_price_sar": numeric}
--
-- An element must specify EXACTLY ONE of line_id / part_id (both or
-- neither is rejected — ambiguous). Every existing-PO-line requirement
-- from 0051 is kept byte-for-byte: every line already on the PO must be
-- covered exactly once via its line_id (no partial receiving of ordered
-- lines — that is still out of scope, same as 0051), duplicate line_id is
-- still rejected before any add_price_lot call runs. Extra lines get their
-- own, parallel set of the SAME safety properties:
--   - duplicate part_id among the extra lines in one call -> rejected
--     (same "duplicate-line rejection" property 0051 already has for
--     line_id, extended to the new shape rather than left as a gap in it)
--   - a part_id that ALREADY has a line on this PO cannot also be
--     submitted as an "extra" line in the same call -> rejected (adjust
--     the existing line via its line_id instead of adding a second, when
--     the same physical part_id is being handled twice in one JSON payload)
--   - the part must exist, be active, and belong to the PO's OWN
--     warehouse_id -> rejected otherwise. This is the SAME one-SKU-one-
--     warehouse rule create_purchase_order (0050) already enforces for
--     ordinary lines — explicitly NOT weakened for extras, per Turki's own
--     instruction. A supplier delivering a part that lives in a different
--     warehouse is not "an extra line on this PO," it is a receipt for a
--     different warehouse entirely and does not belong in this call.
--
-- Both shapes feed the SAME v_loose_lines array that gets passed to
-- receive_loose_parts() (0047) UNCHANGED — the mandatory-invoice gate, the
-- add_price_lot() call per line (0046), the stock_receipts/_lines/_files
-- writes, and therefore the FIFO invariant
-- (sum(price_lots.qty_remaining) == parts.qty_on_hand) are exactly the
-- same code path for an extra line as for an ordered one. Nothing about
-- receive_loose_parts or add_price_lot changes in this migration — extra
-- lines are indistinguishable from ordered ones by the time they reach
-- that function, which is the whole point (one receiving mechanism, no
-- parallel one that could drift).
--
-- After receive_loose_parts returns, reconciliation happens in two steps
-- instead of one:
--   1. (unchanged from 0051) UPDATE the existing purchase_order_lines rows
--      referenced by line_id with their received_qty/received_unit_price_sar.
--   2. (NEW) INSERT a brand-new purchase_order_lines row for every extra
--      line, with BOTH the ordered pair (qty, unit_price_sar) AND the
--      received pair (received_qty, received_unit_price_sar) set to the
--      SAME received values. There is no "ordered" quantity/price for
--      something that was never on the PO — setting ordered = received for
--      these rows is the only honest choice, and it is also what makes
--      "the PO ends up matching what was actually received" literally true
--      for these lines (the app's existing ordered-vs-received variance
--      display, `received_qty != qty`, already reads as "no variance" for
--      a row where the two are equal — no UI change needed for that to
--      render correctly once built).
--
-- One transaction, unchanged: any failure anywhere (missing invoice, bad
-- extra-line warehouse, duplicate line, receive_loose_parts' own checks)
-- rolls back everything — the PO, its lines, and the receipt all stay
-- exactly as they were before the call. Same FOR UPDATE lock on the PO row,
-- same 'issued'-only status gate, same locking-cost caveat already
-- recorded in 0051 (inherited from add_price_lot, not addressed here,
-- unchanged).
--
-- RPC DISCIPLINE: exact-signature `drop function if exists` immediately
-- before `create or replace function` — signature is unchanged from 0051
-- (uuid, jsonb, jsonb, text, text), so this is defensive/consistent with
-- this app's own convention (every RPC creation in this app does this,
-- not only ones that change signature), not because an old overload could
-- otherwise linger.
--
-- NO NEW TABLES, NO NEW COLUMNS, NO RLS CHANGES. purchase_order_lines'
-- existing "authenticated_all_purchase_order_lines" policy already covers
-- the newly-inserted rows (table-level, not row-level, in this app's
-- convention). No new UNIQUE constraint added on
-- (purchase_order_id, part_id) — create_purchase_order (0050) itself has
-- never enforced one-line-per-part-per-PO at the schema level, only this
-- RPC's own runtime check guards it for the receiving path; adding a
-- schema-level constraint now would be tightening a rule beyond what was
-- asked, not reworking receive_purchase_order — flagged, not done.

begin;

-- ----------------------------------------------------------------------------
-- receive_purchase_order(p_po_id, p_lines, p_files, p_note, p_actor)
-- p_lines: jsonb array, each element EITHER
--   {"line_id": uuid, "received_qty": numeric, "received_unit_price_sar": numeric}
--     — reconciles an existing PO line, MUST cover every existing line on
--     this PO exactly once (no duplicates, none missing; line_id must
--     belong to p_po_id), OR
--   {"part_id": uuid, "received_qty": numeric, "received_unit_price_sar": numeric}
--     — an extra item not on the original PO; part must be active and
--     belong to the PO's own warehouse_id; no duplicate part_id among the
--     extras in one call; a part_id already present as an existing PO line
--     cannot also be submitted this way.
-- An element specifying both line_id and part_id, or neither, is rejected.
-- p_files: same shape/requirement as receive_loose_parts' own p_files —
--          mandatory (enforced by receive_loose_parts itself).
--
-- Requires status = 'issued'. Locks the PO row (FOR UPDATE). Builds one
-- combined {part_id, qty, unit_price_sar} array from BOTH line shapes and
-- calls receive_loose_parts() (0047) exactly once — same mandatory-invoice
-- check, same stock_receipts/_lines/_files writes, same add_price_lot()
-- per line, for ordered and extra lines alike. Then reconciles: updates
-- existing lines' received_qty/received_unit_price_sar, INSERTS a new
-- purchase_order_lines row per extra line (ordered pair = received pair,
-- since it was never actually ordered), stamps the receipt's po_id, and
-- flips the PO to 'pending_approval'. One transaction: any failure rolls
-- back everything.
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
  v_po                  public.purchase_orders;
  v_receipt             public.stock_receipts;
  v_line                jsonb;
  v_line_id             uuid;
  v_part_id             uuid;
  v_qty                 numeric(12, 2);
  v_price               numeric(12, 2);
  v_existing_part_id    uuid;
  v_extra_part_wh       uuid;
  v_line_ids            uuid[] := array[]::uuid[];
  v_extra_part_ids      uuid[] := array[]::uuid[];
  v_loose_lines         jsonb := '[]'::jsonb;
  v_po_line_count       integer;
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
    v_part_id := nullif(v_line->>'part_id', '')::uuid;
    v_qty     := nullif(v_line->>'received_qty', '')::numeric;
    v_price   := nullif(v_line->>'received_unit_price_sar', '')::numeric;

    if v_line_id is not null and v_part_id is not null then
      raise exception 'Line item cannot specify both line_id and part_id.';
    end if;
    if v_line_id is null and v_part_id is null then
      raise exception 'Line item must specify either line_id (an existing PO line) or part_id (an extra item).';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Received quantity must be positive.';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Received unit price cannot be negative.';
    end if;

    if v_line_id is not null then
      -- Existing PO line — unchanged from 0051.
      if v_line_id = any(v_line_ids) then
        raise exception 'Line % was submitted more than once — each line must be received exactly once.', v_line_id;
      end if;

      select part_id into v_existing_part_id
        from public.purchase_order_lines
       where id = v_line_id and purchase_order_id = p_po_id;
      if not found then
        raise exception 'Line % does not belong to this purchase order.', v_line_id;
      end if;

      v_line_ids := array_append(v_line_ids, v_line_id);
      v_loose_lines := v_loose_lines || jsonb_build_array(jsonb_build_object(
        'part_id', v_existing_part_id,
        'qty', v_qty,
        'unit_price_sar', v_price
      ));
    else
      -- Extra / ad-hoc line — NEW in this migration.
      if v_part_id = any(v_extra_part_ids) then
        raise exception 'Part % was submitted more than once as an extra line — each extra part must appear exactly once.', v_part_id;
      end if;

      select warehouse_id into v_extra_part_wh
        from public.parts
       where id = v_part_id and active = true;
      if v_extra_part_wh is null then
        raise exception 'Extra line part % not found or inactive.', v_part_id;
      end if;
      if v_extra_part_wh <> v_po.warehouse_id then
        raise exception 'Extra line part % belongs to a different warehouse than this purchase order.', v_part_id;
      end if;

      perform 1 from public.purchase_order_lines
       where purchase_order_id = p_po_id and part_id = v_part_id;
      if found then
        raise exception 'Part % is already a line on this purchase order — adjust its existing line (by line_id) instead of adding it again as an extra.', v_part_id;
      end if;

      v_extra_part_ids := array_append(v_extra_part_ids, v_part_id);
      v_loose_lines := v_loose_lines || jsonb_build_array(jsonb_build_object(
        'part_id', v_part_id,
        'qty', v_qty,
        'unit_price_sar', v_price
      ));
    end if;
  end loop;

  -- Completeness check for existing PO lines — unchanged property: every
  -- line already on the PO must be covered exactly once. Extra lines never
  -- count toward or against this; coalesce guards the case where a caller
  -- submits ONLY extra lines and zero line_id entries (array_length would
  -- otherwise be NULL, not 0, against a non-zero v_po_line_count — still
  -- correctly rejected either way, coalesce just makes the error message's
  -- own number honest).
  if coalesce(array_length(v_line_ids, 1), 0) <> v_po_line_count then
    raise exception 'Received lines (%) must cover every line on this purchase order (%), no duplicates, none missing.',
      coalesce(array_length(v_line_ids, 1), 0), v_po_line_count;
  end if;

  -- Same mandatory-invoice gate, same stock_receipts/_lines/_files writes,
  -- same add_price_lot() per line — for ordered AND extra lines alike.
  -- Nothing here duplicates any of receive_loose_parts' own logic.
  v_receipt := public.receive_loose_parts(
    v_po.supplier_id, v_po.warehouse_id, v_loose_lines, p_files, p_note, p_actor
  );

  update public.stock_receipts
     set po_id = p_po_id
   where id = v_receipt.id;

  -- Reconcile existing lines — unchanged from 0051. Elements with no
  -- line_id (the extras) simply never match any pol.id here (NULL <> any
  -- uuid), so this UPDATE...FROM only ever touches existing-line rows.
  update public.purchase_order_lines pol
     set received_qty = (elem->>'received_qty')::numeric,
         received_unit_price_sar = (elem->>'received_unit_price_sar')::numeric
    from jsonb_array_elements(p_lines) elem
   where pol.id = (elem->>'line_id')::uuid
     and pol.purchase_order_id = p_po_id;

  -- NEW: the PO now includes the extra lines too, so it ends up matching
  -- what was actually received. Ordered pair = received pair — there is no
  -- separate "ordered" figure for something that was never on the PO.
  insert into public.purchase_order_lines (
    purchase_order_id, part_id, qty, unit_price_sar, received_qty, received_unit_price_sar
  )
  select
    p_po_id,
    (elem->>'part_id')::uuid,
    (elem->>'received_qty')::numeric,
    (elem->>'received_unit_price_sar')::numeric,
    (elem->>'received_qty')::numeric,
    (elem->>'received_unit_price_sar')::numeric
  from jsonb_array_elements(p_lines) elem
  where (elem->>'part_id') is not null;

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
--   -- must return exactly ONE row (signature unchanged):
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
--   -- Extra-line happy path (replace placeholders with a real issued PO
--   -- that has exactly one line, and a second, different part_id that
--   -- lives in the SAME warehouse as that PO):
--   -- select * from public.receive_purchase_order(
--   --   '<po-uuid>',
--   --   '[{"line_id":"<line-1-uuid>","received_qty":10,"received_unit_price_sar":12.50},
--   --     {"part_id":"<other-part-in-same-warehouse-uuid>","received_qty":3,"received_unit_price_sar":40}]'::jsonb,
--   --   '[{"storage_path":"test/invoice-1.pdf","file_name":"invoice-1.pdf","mime_type":"application/pdf"}]'::jsonb,
--   --   'Smoke test — extra line', 'you@example.com'
--   -- );
--   -- expected: PO flips to pending_approval; purchase_order_lines now has
--   -- 2 rows for this PO (the original, reconciled, plus a NEW one for the
--   -- extra part with qty = unit_price_sar = received_qty/received_unit_price_sar);
--   -- stock_receipt_lines has 2 rows; both parts' price_lots/qty_on_hand
--   -- updated; a NEW price_lot exists for the extra part too.
--
--   -- Extra-line wrong-warehouse rejection — MUST raise, not silently
--   -- receive into the wrong warehouse (replace with a real part_id that
--   -- belongs to a DIFFERENT warehouse than the PO's):
--   -- select * from public.receive_purchase_order(
--   --   '<po-uuid>',
--   --   '[{"line_id":"<line-1-uuid>","received_qty":10,"received_unit_price_sar":12.50},
--   --     {"part_id":"<part-in-different-warehouse-uuid>","received_qty":1,"received_unit_price_sar":5}]'::jsonb,
--   --   '[{"storage_path":"test/invoice-1.pdf","file_name":"invoice-1.pdf","mime_type":"application/pdf"}]'::jsonb,
--   --   null, 'you@example.com'
--   -- );
--   -- expected: raises "Extra line part ... belongs to a different warehouse...", nothing written.
--
--   -- Extra-line duplicate-part rejection — MUST raise:
--   -- select * from public.receive_purchase_order(
--   --   '<po-uuid>',
--   --   '[{"line_id":"<line-1-uuid>","received_qty":10,"received_unit_price_sar":12.50},
--   --     {"part_id":"<extra-part-uuid>","received_qty":1,"received_unit_price_sar":5},
--   --     {"part_id":"<extra-part-uuid>","received_qty":2,"received_unit_price_sar":5}]'::jsonb,
--   --   '[{"storage_path":"test/invoice-1.pdf","file_name":"invoice-1.pdf","mime_type":"application/pdf"}]'::jsonb,
--   --   null, 'you@example.com'
--   -- );
--   -- expected: raises "Part ... was submitted more than once as an extra line...", nothing written.
--
--   -- Extra-line "already a real line" rejection — MUST raise (use the
--   -- SAME part_id as an existing line on this PO, submitted a second time
--   -- as an "extra"):
--   -- select * from public.receive_purchase_order(
--   --   '<po-uuid>',
--   --   '[{"line_id":"<line-1-uuid>","received_qty":10,"received_unit_price_sar":12.50},
--   --     {"part_id":"<same-part-as-line-1-uuid>","received_qty":1,"received_unit_price_sar":5}]'::jsonb,
--   --   '[{"storage_path":"test/invoice-1.pdf","file_name":"invoice-1.pdf","mime_type":"application/pdf"}]'::jsonb,
--   --   null, 'you@example.com'
--   -- );
--   -- expected: raises "Part ... is already a line on this purchase order...", nothing written.
--
--   -- Existing-line duplicate/no-invoice/etc. regression checks — same as
--   -- 0051's own verification block, still must behave identically:
--   -- (duplicate line_id, no invoice, non-'issued' status, wrong-PO line_id)
-- ---------------------------------------------------------------------------
