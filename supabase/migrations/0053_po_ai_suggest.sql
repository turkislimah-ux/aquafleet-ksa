-- 0053_po_ai_suggest.sql
-- Inventory — Phase 7 of the full-demo build-out: AI-Suggest-PO persistence
-- (preview's po.aiGenerated/po.aiRationale, data.js ~1535-1536). Turki's
-- explicit call: persist the flag + rationale (the demo's own behavior),
-- not a prefill-only version. Migration only. No UI, no app-code wrapper —
-- those land in a follow-up step, same split every prior phase used.
--
-- SCOPE THIS MIGRATION:
--   ALTER purchase_orders to add ai_generated/ai_rationale/ai_rationale_ar,
--   and DROP+RECREATE create_purchase_order() (0050) with three new
--   trailing optional params to set them at draft-creation time — the same
--   moment preview's own openNewPO/savePO sets aiGenerated/aiRationale on
--   the draft, before anything is issued/received/approved. No other RPC
--   needs to touch these columns (issue/receive/approve/reject never
--   change them once set).
--
-- *** BILINGUAL PAIR, NOT A SINGLE LANG-BAKED SNAPSHOT ***
-- Preview's aiRationale is a {en, ar} object (one of 4 canned
-- AI_RATIONALES entries, data.js ~1494-1503) — picked once at draft time
-- and shown verbatim later regardless of viewer language. Two nullable
-- text columns (ai_rationale / ai_rationale_ar) instead of one column
-- holding whichever language was active at creation — same convention this
-- app already uses everywhere for a bilingual pair on one row (parts.name/
-- name_ar, suppliers.name/name_ar, customers.name/name_ar), so the badge
-- reads correctly in EITHER language later, not just the one active when
-- the AI suggestion was generated.
--
-- *** ai_generated DEFAULTS FALSE, NOT NULLABLE ***
-- Every PO created before this migration (and every ordinary, non-AI
-- draft created after it) is unambiguously "not AI-generated" — a boolean
-- with a hard default, not a nullable tri-state, matches every other
-- plain boolean flag in this schema (parts.active, warehouses.active,
-- etc.).
--
-- *** WHERE THE "AI" ACTUALLY COMES FROM — NOT A REAL MODEL CALL ***
-- Same as preview: no LLM/inference service anywhere in this feature.
-- "AI-Suggest" is a client-side heuristic (parts at/below reorder level,
-- not already on an open PO) paired with one of a handful of canned
-- rationale strings — this migration only adds somewhere to PERSIST that
-- canned text once chosen, it doesn't change what generates it.
--
-- RPC DISCIPLINE: exact-signature `drop function if exists` for the OLD
-- 6-arg signature immediately before recreating the 9-arg version —
-- same pattern this app used for pay_invoice/confirm_invoice's own
-- signature evolutions (see CLAUDE.md §5's process-lesson note).
--
-- NO RLS CHANGES — purchase_orders' existing "authenticated_all_
-- purchase_orders" policy (0050) already covers the three new columns
-- (table-level, not column-level, in this app's convention).

begin;

alter table public.purchase_orders
  add column if not exists ai_generated boolean not null default false,
  add column if not exists ai_rationale text,
  add column if not exists ai_rationale_ar text;

-- Drop the OLD 6-arg signature (0050) — being replaced by the 9-arg
-- version below, not overloaded alongside it.
drop function if exists public.create_purchase_order(uuid, uuid, jsonb, date, text, text);

create or replace function public.create_purchase_order(
  p_supplier_id       uuid,
  p_warehouse_id      uuid,
  p_lines             jsonb,
  p_expected_delivery date default null,
  p_note              text default null,
  p_actor             text default null,
  p_ai_generated      boolean default false,
  p_ai_rationale      text default null,
  p_ai_rationale_ar   text default null
) returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po                public.purchase_orders;
  v_line              jsonb;
  v_part_id           uuid;
  v_qty               numeric(12, 2);
  v_price             numeric(12, 2);
  v_number            integer;
  v_part_warehouse_id uuid;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one line item is required.';
  end if;

  perform 1 from public.suppliers where id = p_supplier_id and active = true;
  if not found then
    raise exception 'Supplier not found or inactive.';
  end if;

  perform 1 from public.warehouses where id = p_warehouse_id and active = true;
  if not found then
    raise exception 'Warehouse not found or inactive.';
  end if;

  v_number := public.next_po_number(extract(year from current_date)::integer);

  insert into public.purchase_orders (
    po_number, supplier_id, warehouse_id, expected_delivery, note, requested_by,
    ai_generated, ai_rationale, ai_rationale_ar
  )
  values (
    'PO-' || extract(year from current_date)::text || '-' || lpad(v_number::text, 4, '0'),
    p_supplier_id, p_warehouse_id, p_expected_delivery, nullif(trim(p_note), ''), p_actor,
    coalesce(p_ai_generated, false), nullif(trim(p_ai_rationale), ''), nullif(trim(p_ai_rationale_ar), '')
  )
  returning * into v_po;

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

    select warehouse_id into v_part_warehouse_id
      from public.parts
     where id = v_part_id and active = true;

    if v_part_warehouse_id is null then
      raise exception 'Part not found or inactive.';
    end if;

    if v_part_warehouse_id <> p_warehouse_id then
      raise exception 'Part % belongs to a different warehouse than this purchase order.', v_part_id;
    end if;

    insert into public.purchase_order_lines (purchase_order_id, part_id, qty, unit_price_sar)
    values (v_po.id, v_part_id, v_qty, v_price);
  end loop;

  return v_po;
end;
$$;

grant execute on function public.create_purchase_order(uuid, uuid, jsonb, date, text, text, boolean, text, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Post-run verification (run manually, not part of the migration):
--
--   select oid::regprocedure from pg_proc where proname = 'create_purchase_order';
--   -- must return exactly ONE row (the new 9-arg signature):
--   -- create_purchase_order(uuid, uuid, jsonb, date, text, text, boolean, text, text)
--
--   -- Existing app code (before the follow-up app-code pass lands) still
--   -- works unchanged — the three new params are all optional/trailing,
--   -- so a 6-arg call resolves to this same function with ai_generated
--   -- defaulting false:
--   -- select * from public.create_purchase_order(
--   --   '<supplier-uuid>', '<warehouse-uuid>',
--   --   '[{"part_id":"<part-uuid>","qty":5,"unit_price_sar":10}]'::jsonb,
--   --   null, 'plain PO, no AI args', 'you@example.com'
--   -- );
--   -- ai_generated should read false, ai_rationale/ai_rationale_ar null.
--
--   -- AI-flagged smoke test:
--   -- select * from public.create_purchase_order(
--   --   '<supplier-uuid>', '<warehouse-uuid>',
--   --   '[{"part_id":"<part-uuid>","qty":5,"unit_price_sar":10}]'::jsonb,
--   --   null, null, 'you@example.com', true,
--   --   'Stock at 18%% of reorder level.', 'المخزون عند 18%% من حد إعادة الطلب.'
--   -- );
--   -- ai_generated should read true, both rationale columns populated.
-- ---------------------------------------------------------------------------
