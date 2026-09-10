-- 0190_vat_rate_constant.sql
--
-- ONE NAMED VAT RATE IN SQL. Creates public.vat_rate() and routes the six
-- hardcoded VAT literals in the live catalog through it. TypeScript already has
-- exactly one source (lib/prepaid.ts's VAT_RATE, re-exported by lib/vat.ts,
-- lib/inventory-vat.ts and lib/outsourced-vat.ts); SQL had six copies.
--
-- SCOPE — TWO FAMILIES, DELIBERATELY NOT UNIFIED:
--   Family A, VAT-INCLUSIVE GROSS-UP (`* 1.15`) -> `* (1 + public.vat_rate())`
--     v_customer_prepaid_balance   4 sites
--     v_customer_amount_payable    2 sites
--   Family B, VAT AMOUNT (`* 0.15`) -> `* public.vat_rate()`
--     create_purchase_order        1 site
--     receive_loose_parts          1 site
--     receive_purchase_order       3 sites
--
--   Same 15%. DIFFERENT ROUNDING CONVENTIONS — Family A is the customer-facing
--   per-item VAT-inclusive consumption the prepaid engine mirrors; Family B is
--   internal inventory cost with no customer ledger and no ZATCA document
--   rounding. Sharing the RATE is safe. Sharing a ROUNDING HELPER would
--   silently merge two conventions that must stay apart, so this migration
--   creates a constant and nothing else. Do not add a `vat_gross()` helper.
--
-- NOT IN SCOPE: confirm_invoice. Its `1.15` is cosmetic error text and it is
-- redefined in 0191, which also adds the totals assertions. One object, one
-- migration.
--
-- WHY NO `SET search_path` ON vat_rate(): a function carrying a SET clause is
-- NOT INLINABLE. vat_rate() has a constant body referencing no object, so
-- search_path cannot affect it, and leaving the clause off lets the planner
-- inline and constant-fold it — the view plans stay byte-identical to today's.
-- Adding `SET search_path` here would be a plan regression dressed as hardening.
--
-- CLAUDE.md §5: BARE STATEMENTS. The SQL Editor wraps the submission; a nested
-- begin;/commit; would print grids and create nothing.
-- CLAUDE.md §6: every view replacement restates security_invoker + grants and
-- its comment (same OID, so neither survives); every redefined SECURITY DEFINER
-- function is EXECUTE-TO-PUBLIC again and re-revokes in the same transaction.
--
-- VERIFICATION RAISES, IT DOES NOT PRINT. §5: "a migration's own result-grid is
-- not proof it applied." Every check below aborts the transaction on failure,
-- so a clean run IS the evidence. The money check snapshots both views BEFORE
-- the replacement and asserts the after-image is numerically identical.


-- ---------------------------------------------------------------------------
-- 1. The constant.
-- ---------------------------------------------------------------------------

create or replace function public.vat_rate()
returns numeric
language sql
immutable
parallel safe
as $vat_rate$
  select 0.15::numeric
$vat_rate$;

comment on function public.vat_rate() is
  'KSA VAT rate, 15%. The single SQL source, mirroring lib/prepaid.ts VAT_RATE. Gross-up sites write (1 + public.vat_rate()); VAT-amount sites write public.vat_rate(). IMMUTABLE with NO SET clause on purpose so it inlines and constant-folds — adding SET search_path would block inlining. Rate changes are a migration that redefines this one body, never a search-and-replace.';

revoke execute on function public.vat_rate() from public, anon;
grant execute on function public.vat_rate() to authenticated, service_role;

-- The substitution is only safe if the constant is arithmetically inert.
-- Assert that BEFORE anything is rewritten.
do $$
begin
  if public.vat_rate() <> 0.15 then
    raise exception '0190: public.vat_rate() returned % — expected 0.15.', public.vat_rate();
  end if;
  if (1 + public.vat_rate()) <> 1.15 then
    raise exception '0190: 1 + public.vat_rate() = % but the literal being replaced is 1.15 — the view substitution below would MOVE MONEY.', (1 + public.vat_rate());
  end if;
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'vat_rate'
       and p.provolatile = 'i'
       and p.proconfig is null
  ) then
    raise exception '0190: public.vat_rate() is not IMMUTABLE-with-no-SET — it would not inline, and every view plan below would change.';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. Snapshot the money BEFORE the views are touched.
--    on commit drop — the SQL Editor's transaction cleans these up.
-- ---------------------------------------------------------------------------

create temp table _vat0190_prepaid_before on commit drop as
select customer_id, topups_sar, trip_consumption_sar, charge_consumption_sar, balance_sar, returns_sar
  from public.v_customer_prepaid_balance;

create temp table _vat0190_payable_before on commit drop as
select customer_id, prepaid_balance_sar, postpaid_unpaid_sar, amount_payable_sar, owed_sar, archive_blocked
  from public.v_customer_amount_payable;


-- ---------------------------------------------------------------------------
-- 3. Family A — the two views. Bodies are pg_get_viewdef VERBATIM; the only
--    edit is 1.15 -> (1 + public.vat_rate()). Column list unchanged, so no
--    42P16.
-- ---------------------------------------------------------------------------

create or replace view public.v_customer_prepaid_balance as
 SELECT id AS customer_id,
    name AS customer_name,
    COALESCE(( SELECT sum(tp.amount_sar) AS sum
           FROM customer_topups tp
          WHERE tp.customer_id = c.id), 0::numeric) AS topups_sar,
    COALESCE(( SELECT sum(round(COALESCE(t.rate_sar, p.rate_per_trip_sar) * (1 + public.vat_rate()), 2)) AS sum
           FROM trips t
             JOIN projects p ON p.id = t.project_id
          WHERE p.customer_id = c.id AND t.delivered_at IS NOT NULL), 0::numeric) AS trip_consumption_sar,
    COALESCE(( SELECT sum(round(sc.amount_sar * (1 + public.vat_rate()), 2)) AS sum
           FROM invoice_special_charges sc
             JOIN invoices i ON i.id = sc.invoice_id
          WHERE i.customer_id = c.id AND i.status <> 'void'::text), 0::numeric) AS charge_consumption_sar,
    COALESCE(( SELECT sum(tp.amount_sar) AS sum
           FROM customer_topups tp
          WHERE tp.customer_id = c.id), 0::numeric) - COALESCE(( SELECT sum(round(COALESCE(t.rate_sar, p.rate_per_trip_sar) * (1 + public.vat_rate()), 2)) AS sum
           FROM trips t
             JOIN projects p ON p.id = t.project_id
          WHERE p.customer_id = c.id AND t.delivered_at IS NOT NULL), 0::numeric) - COALESCE(( SELECT sum(round(sc.amount_sar * (1 + public.vat_rate()), 2)) AS sum
           FROM invoice_special_charges sc
             JOIN invoices i ON i.id = sc.invoice_id
          WHERE i.customer_id = c.id AND i.status <> 'void'::text), 0::numeric) - COALESCE(( SELECT sum(r.amount_sar) AS sum
           FROM customer_balance_returns r
          WHERE r.customer_id = c.id), 0::numeric) AS balance_sar,
    COALESCE(( SELECT sum(r.amount_sar) AS sum
           FROM customer_balance_returns r
          WHERE r.customer_id = c.id), 0::numeric) AS returns_sar
   FROM customers c;

alter view public.v_customer_prepaid_balance set (security_invoker = true);
revoke all on public.v_customer_prepaid_balance from anon;
grant select on public.v_customer_prepaid_balance to authenticated;

-- create or replace view does NOT refresh the comment (same OID). Restated,
-- with the rate no longer spelled as a literal.
comment on view public.v_customer_prepaid_balance is
  'Prepaid balance per customer: topups minus VAT-inclusive consumption of delivered trips and of special charges on non-void invoices. A SQL mirror of lib/prepaid.ts derivedBalanceItems — safe because the BALANCE is a plain sum, not a FIFO walk (FIFO only decides the covered/unpaid split, which this view does not compute). Rounds PER ITEM at (1 + public.vat_rate()), as the engine does — 0190 replaced the 1.15 literal with the named constant; the arithmetic is unchanged. Positive = credit held; negative = overdrawn. Applies to every customer; it is only MEANINGFUL for prepaid ones, and v_invoice_outstanding_live is what enforces that. Change this only in lockstep with lib/prepaid.ts (0137).';

create or replace view public.v_customer_amount_payable as
 WITH resolved_mode AS (
         SELECT c_1.id AS customer_id,
            ( SELECT
                        CASE
                            WHEN count(DISTINCT p.payment_mode) = 1 THEN min(p.payment_mode)
                            ELSE NULL::text
                        END AS "case"
                   FROM projects p
                  WHERE p.customer_id = c_1.id AND p.payment_mode IS NOT NULL) AS payment_mode
           FROM customers c_1
        ), postpaid_unpaid AS (
         SELECT c_1.id AS customer_id,
            COALESCE(( SELECT sum(round(COALESCE(t.rate_sar, p.rate_per_trip_sar) * (1 + public.vat_rate()), 2)) AS sum
                   FROM trips t
                     JOIN projects p ON p.id = t.project_id
                  WHERE p.customer_id = c_1.id AND t.delivered_at IS NOT NULL AND NOT (t.invoice_id IS NOT NULL AND (EXISTS ( SELECT 1
                           FROM invoices i
                          WHERE i.id = t.invoice_id AND i.status = 'paid'::text)))), 0::numeric) AS unpaid_trip_sar,
            COALESCE(( SELECT sum(round(sc.amount_sar * (1 + public.vat_rate()), 2)) AS sum
                   FROM invoice_special_charges sc
                     JOIN invoices i ON i.id = sc.invoice_id
                  WHERE i.customer_id = c_1.id AND (i.status <> ALL (ARRAY['void'::text, 'paid'::text]))), 0::numeric) AS unpaid_charge_sar
           FROM customers c_1
        )
 SELECT c.id AS customer_id,
    c.name AS customer_name,
    c.archived_at,
    rm.payment_mode,
    b.balance_sar AS prepaid_balance_sar,
    u.unpaid_trip_sar + u.unpaid_charge_sar AS postpaid_unpaid_sar,
    w.customer_id IS NOT NULL AS is_written_off,
    w.amount_sar AS written_off_sar,
    w.reason AS write_off_reason,
    w.written_off_by,
    w.created_at AS written_off_at,
    r.customer_id IS NOT NULL AS balance_returned,
    r.amount_sar AS returned_sar,
    r.method AS returned_method,
    r.returned_on,
        CASE
            WHEN w.customer_id IS NOT NULL THEN 0::numeric
            WHEN rm.payment_mode = 'prepaid'::text THEN b.balance_sar
            ELSE - (u.unpaid_trip_sar + u.unpaid_charge_sar)
        END AS amount_payable_sar,
    GREATEST(0::numeric, -
        CASE
            WHEN w.customer_id IS NOT NULL THEN 0::numeric
            WHEN rm.payment_mode = 'prepaid'::text THEN b.balance_sar
            ELSE - (u.unpaid_trip_sar + u.unpaid_charge_sar)
        END) AS owed_sar,
        CASE
            WHEN w.customer_id IS NOT NULL THEN false
            WHEN rm.payment_mode = 'prepaid'::text THEN b.balance_sar < 0::numeric
            ELSE (u.unpaid_trip_sar + u.unpaid_charge_sar) > 0::numeric
        END AS archive_blocked
   FROM customers c
     JOIN resolved_mode rm ON rm.customer_id = c.id
     JOIN postpaid_unpaid u ON u.customer_id = c.id
     JOIN v_customer_prepaid_balance b ON b.customer_id = c.id
     LEFT JOIN customer_write_offs w ON w.customer_id = c.id AND w.reversed_at IS NULL
     LEFT JOIN customer_balance_returns r ON r.customer_id = c.id;

alter view public.v_customer_amount_payable set (security_invoker = true);
revoke all on public.v_customer_amount_payable from anon;
grant select on public.v_customer_amount_payable to authenticated;

comment on view public.v_customer_amount_payable is
  'What each customer still owes us, net of what they have paid. SIGNED: negative = owed to us, 0 = settled, positive = credit we owe them. Prepaid composes on v_customer_prepaid_balance (0137) and is not restated; postpaid is delivered trips and non-void special charges not on a PAID invoice, VAT-inclusive rounded per item at (1 + public.vat_rate()) — 0190 replaced the 1.15 literal with the named constant; the arithmetic is unchanged. An ACTIVE customer_write_offs row (reversed_at is null) forces 0 WITHOUT rewriting any ledger row beneath; reversing it (restore_customer_guarded, 0141) returns the real figure by subtraction. Unknown payment mode falls to the postpaid arm on purpose. archive_blocked is the archive guard itself (0139, extended by 0141). NOTE this view INCLUDES ARCHIVED CUSTOMERS — filter on customers.archived_at if active-only is meant.';


-- ---------------------------------------------------------------------------
-- 4. Family B — the three inventory RPCs. Bodies are pg_get_functiondef
--    VERBATIM; the only edit is `* 0.15,` -> `* public.vat_rate(),`. The
--    post-0189 Riyadh date expressions are inside these bodies and are carried
--    through untouched — do not regress them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_purchase_order(p_supplier_id uuid, p_warehouse_id uuid, p_lines jsonb, p_expected_delivery date DEFAULT NULL::date, p_note text DEFAULT NULL::text, p_actor text DEFAULT NULL::text, p_ai_generated boolean DEFAULT false, p_ai_rationale text DEFAULT NULL::text, p_ai_rationale_ar text DEFAULT NULL::text)
 RETURNS purchase_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_po                public.purchase_orders;
  v_line              jsonb;
  v_part_id           uuid;
  v_qty               numeric(12, 2);
  v_price             numeric(12, 2);
  v_line_vat          numeric(12, 2);
  v_number            integer;
  v_part_warehouse_id uuid;
  v_subtotal          numeric(12, 2) := 0;
  v_vat_total         numeric(12, 2) := 0;
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

  v_number := public.next_po_number(extract(year from (now() at time zone 'Asia/Riyadh')::date)::integer);

  insert into public.purchase_orders (
    po_number, supplier_id, warehouse_id, expected_delivery, note, requested_by,
    ai_generated, ai_rationale, ai_rationale_ar
  )
  values (
    'PO-' || extract(year from (now() at time zone 'Asia/Riyadh')::date)::text || '-' || lpad(v_number::text, 4, '0'),
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

    v_line_vat := round(v_qty * v_price * public.vat_rate(), 2);

    insert into public.purchase_order_lines (purchase_order_id, part_id, qty, unit_price_sar, line_vat_sar)
    values (v_po.id, v_part_id, v_qty, v_price, v_line_vat);

    v_subtotal  := v_subtotal + (v_qty * v_price);
    v_vat_total := v_vat_total + v_line_vat;
  end loop;

  update public.purchase_orders
     set subtotal_sar = v_subtotal,
         vat_sar = v_vat_total,
         total_sar = v_subtotal + v_vat_total
   where id = v_po.id
  returning * into v_po;

  return v_po;
end;
$function$;

revoke execute on function public.create_purchase_order(uuid,uuid,jsonb,date,text,text,boolean,text,text) from public, anon;
grant execute on function public.create_purchase_order(uuid,uuid,jsonb,date,text,text,boolean,text,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.receive_loose_parts(p_supplier_id uuid, p_warehouse_id uuid, p_lines jsonb, p_files jsonb, p_note text DEFAULT NULL::text, p_actor text DEFAULT NULL::text)
 RETURNS stock_receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    v_line_vat := round(v_qty * v_price * public.vat_rate(), 2);
    v_lot_id := public.add_price_lot(v_part_id, v_price, v_qty, v_receipt.received_on, p_note, p_actor);
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
$function$;

revoke execute on function public.receive_loose_parts(uuid,uuid,jsonb,jsonb,text,text) from public, anon;
grant execute on function public.receive_loose_parts(uuid,uuid,jsonb,jsonb,text,text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.receive_purchase_order(p_po_id uuid, p_lines jsonb, p_files jsonb, p_note text DEFAULT NULL::text, p_actor text DEFAULT NULL::text)
 RETURNS stock_receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        'part_id', v_existing_part_id, 'qty', v_qty, 'unit_price_sar', v_price
      ));
    else
      if v_part_id = any(v_extra_part_ids) then
        raise exception 'Part % was submitted more than once as an extra line.', v_part_id;
      end if;

      select warehouse_id into v_extra_part_wh
        from public.parts where id = v_part_id and active = true;
      if v_extra_part_wh is null then
        raise exception 'Extra line part % not found or inactive.', v_part_id;
      end if;
      if v_extra_part_wh <> v_po.warehouse_id then
        raise exception 'Extra line part % belongs to a different warehouse than this purchase order.', v_part_id;
      end if;

      perform 1 from public.purchase_order_lines
       where purchase_order_id = p_po_id and part_id = v_part_id;
      if found then
        raise exception 'Part % is already a line on this purchase order.', v_part_id;
      end if;

      v_extra_part_ids := array_append(v_extra_part_ids, v_part_id);
      v_loose_lines := v_loose_lines || jsonb_build_array(jsonb_build_object(
        'part_id', v_part_id, 'qty', v_qty, 'unit_price_sar', v_price
      ));
    end if;
  end loop;

  if coalesce(array_length(v_line_ids, 1), 0) <> v_po_line_count then
    raise exception 'Received lines (%) must cover every line on this purchase order (%), no duplicates, none missing.',
      coalesce(array_length(v_line_ids, 1), 0), v_po_line_count;
  end if;

  v_receipt := public.receive_loose_parts(
    v_po.supplier_id, v_po.warehouse_id, v_loose_lines, p_files, p_note, p_actor
  );

  update public.stock_receipts
     set po_id = p_po_id, receipt_type = 'po'
   where id = v_receipt.id;

  update public.purchase_order_lines pol
     set received_qty = (elem->>'received_qty')::numeric,
         received_unit_price_sar = (elem->>'received_unit_price_sar')::numeric,
         received_line_vat_sar = round((elem->>'received_qty')::numeric * (elem->>'received_unit_price_sar')::numeric * public.vat_rate(), 2)
    from jsonb_array_elements(p_lines) elem
   where pol.id = (elem->>'line_id')::uuid
     and pol.purchase_order_id = p_po_id;

  insert into public.purchase_order_lines (
    purchase_order_id, part_id, qty, unit_price_sar, line_vat_sar,
    received_qty, received_unit_price_sar, received_line_vat_sar
  )
  select p_po_id, (elem->>'part_id')::uuid,
    (elem->>'received_qty')::numeric, (elem->>'received_unit_price_sar')::numeric,
    round((elem->>'received_qty')::numeric * (elem->>'received_unit_price_sar')::numeric * public.vat_rate(), 2),
    (elem->>'received_qty')::numeric, (elem->>'received_unit_price_sar')::numeric,
    round((elem->>'received_qty')::numeric * (elem->>'received_unit_price_sar')::numeric * public.vat_rate(), 2)
  from jsonb_array_elements(p_lines) elem
  where (elem->>'part_id') is not null;

  update public.purchase_orders po
     set status = 'pending_approval', received_by = p_actor, received_date = (now() at time zone 'Asia/Riyadh')::date,
         received_subtotal_sar = agg.sub, received_vat_sar = agg.vat, received_total_sar = agg.sub + agg.vat
    from (
      select coalesce(sum(pol.received_qty * pol.received_unit_price_sar), 0) as sub,
             coalesce(sum(pol.received_line_vat_sar), 0) as vat
      from public.purchase_order_lines pol
      where pol.purchase_order_id = p_po_id and pol.received_qty is not null
    ) agg
   where po.id = p_po_id;

  select * into v_receipt from public.stock_receipts where id = v_receipt.id;
  return v_receipt;
end;
$function$;

revoke execute on function public.receive_purchase_order(uuid,jsonb,jsonb,text,text) from public, anon;
grant execute on function public.receive_purchase_order(uuid,jsonb,jsonb,text,text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 5. VERIFICATION. Every block RAISES on failure and aborts the whole
--    submission. Nothing here prints a grid to be believed.
-- ---------------------------------------------------------------------------

-- 5a. The money. Before-image vs after-image, every numeric column of both
--     views. An EMPTY snapshot passes a diff test vacuously, so the empty case
--     is reported as SKIPPED — never as green.
--
--     REPLAY-CLEANLINESS EDIT, POST-HOC (2026-09-10). This block originally
--     RAISED on an empty snapshot. That is correct on a database with money in
--     it, and wrong on a from-scratch replay, where zero customers exist by
--     construction: the abort halts the whole migration chain over a condition
--     that is not a defect. What changed is the VERDICT on empty, not the
--     guard — the empty case still refuses to report green, it now says out
--     loud that it compared nothing. The row-count check and the per-column
--     diff are unchanged; they moved into the ELSE branch and were re-indented,
--     nothing else.
--
--     NO-OP ON PRODUCTION'S END STATE. Production is not re-applied — 0190 ran
--     there already — so no row and no figure moves. On the semantics, measured
--     against production 2026-09-10: 9 customers (8 active), 9 rows in
--     v_customer_prepaid_balance, 9 in v_customer_amount_payable. v_before = 9
--     at both guards, the ELSE branch is taken, and every check that ran before
--     runs identically. The guard is fully armed wherever there is money.
--
--     5b/5c/5d below are data-independent and are untouched: even on an empty
--     replay this file still PROVES the five rewritten objects reference
--     vat_rate() and carry no bare VAT literal, the four EXECUTE grants, and
--     the two view security footers.
do $$
declare
  v_before integer;
  v_after  integer;
  v_diff   integer;
begin
  select count(*) into v_before from _vat0190_prepaid_before;
  select count(*) into v_after  from public.v_customer_prepaid_balance;
  if v_before = 0 then
    raise notice '0190: the v_customer_prepaid_balance snapshot is EMPTY (0 rows) — there was no money to compare. The value diff is SKIPPED, NOT PASSED. On a populated database this branch is not taken.';
  else
    if v_before <> v_after then
      raise exception '0190: v_customer_prepaid_balance row count moved (% before, % after).', v_before, v_after;
    end if;

    select count(*) into v_diff from (
      ( select customer_id, topups_sar, trip_consumption_sar, charge_consumption_sar, balance_sar, returns_sar
          from _vat0190_prepaid_before
        except
        select customer_id, topups_sar, trip_consumption_sar, charge_consumption_sar, balance_sar, returns_sar
          from public.v_customer_prepaid_balance )
      union all
      ( select customer_id, topups_sar, trip_consumption_sar, charge_consumption_sar, balance_sar, returns_sar
          from public.v_customer_prepaid_balance
        except
        select customer_id, topups_sar, trip_consumption_sar, charge_consumption_sar, balance_sar, returns_sar
          from _vat0190_prepaid_before )
    ) d;
    if v_diff <> 0 then
      raise exception '0190: % row(s) of v_customer_prepaid_balance changed VALUE. The rate substitution was supposed to be arithmetically inert.', v_diff;
    end if;
  end if;

  select count(*) into v_before from _vat0190_payable_before;
  select count(*) into v_after  from public.v_customer_amount_payable;
  if v_before = 0 then
    raise notice '0190: the v_customer_amount_payable snapshot is EMPTY (0 rows) — there was nothing to compare. The value diff is SKIPPED, NOT PASSED. On a populated database this branch is not taken.';
  else
    if v_before <> v_after then
      raise exception '0190: v_customer_amount_payable row count moved (% before, % after).', v_before, v_after;
    end if;

    select count(*) into v_diff from (
      ( select customer_id, prepaid_balance_sar, postpaid_unpaid_sar, amount_payable_sar, owed_sar, archive_blocked
          from _vat0190_payable_before
        except
        select customer_id, prepaid_balance_sar, postpaid_unpaid_sar, amount_payable_sar, owed_sar, archive_blocked
          from public.v_customer_amount_payable )
      union all
      ( select customer_id, prepaid_balance_sar, postpaid_unpaid_sar, amount_payable_sar, owed_sar, archive_blocked
          from public.v_customer_amount_payable
        except
        select customer_id, prepaid_balance_sar, postpaid_unpaid_sar, amount_payable_sar, owed_sar, archive_blocked
          from _vat0190_payable_before )
    ) d;
    if v_diff <> 0 then
      raise exception '0190: % row(s) of v_customer_amount_payable changed VALUE — including the refund gate and the archive guard that read off it.', v_diff;
    end if;
  end if;
end $$;

-- 5b. The catalog. Every one of the five rewritten objects must now REFERENCE
--     vat_rate() and hold NO bare VAT literal. The row COUNT is asserted first:
--     a mistyped identifier returns no row, and an object that returns no row
--     reads as clean — the §6 inversion, in the checker rather than the schema.
do $$
declare
  v_n   integer;
  v_bad text;
begin
  with objs as (
    select 'view ' || c.relname as obj, pg_get_viewdef(c.oid, true) as src
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'v'
       and c.relname in ('v_customer_prepaid_balance', 'v_customer_amount_payable')
    union all
    select 'function ' || p.oid::regprocedure::text, pg_get_functiondef(p.oid)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.oid::regprocedure::text in (
             'create_purchase_order(uuid,uuid,jsonb,date,text,text,boolean,text,text)',
             'receive_loose_parts(uuid,uuid,jsonb,jsonb,text,text)',
             'receive_purchase_order(uuid,jsonb,jsonb,text,text)')
  )
  select count(*), string_agg(obj, ', ' order by obj) filter (
           where src not like '%vat_rate()%' or src like '%1.15%' or src like '%0.15%')
    into v_n, v_bad
    from objs;

  if v_n <> 5 then
    raise exception '0190: expected 5 rewritten objects in the catalog, found % — an identifier in this check is wrong, and a missing object reads as a clean one.', v_n;
  end if;
  if v_bad is not null then
    raise exception '0190: these objects still carry a bare VAT literal or do not reference vat_rate(): %.', v_bad;
  end if;
end $$;

-- 5c. §6 privileges, read back the RIGHT way: has_function_privilege, and
--     identified by regprocedure. Never proacl matching, never
--     pg_get_function_identity_arguments — both INVERT the answer.
do $$
declare
  v_n   integer;
  v_bad text;
begin
  select count(*), string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) filter (
           where has_function_privilege('anon', p.oid, 'execute')
              or not has_function_privilege('authenticated', p.oid, 'execute')
              or not has_function_privilege('service_role', p.oid, 'execute'))
    into v_n, v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.oid::regprocedure::text in (
           'vat_rate()',
           'create_purchase_order(uuid,uuid,jsonb,date,text,text,boolean,text,text)',
           'receive_loose_parts(uuid,uuid,jsonb,jsonb,text,text)',
           'receive_purchase_order(uuid,jsonb,jsonb,text,text)');

  if v_n <> 4 then
    raise exception '0190: expected 4 functions in the privilege check, found % — a signature here is wrong, and a function that returns no row reads as revoked.', v_n;
  end if;
  if v_bad is not null then
    raise exception '0190: wrong grants after redefinition (anon can execute, or authenticated/service_role cannot): %.', v_bad;
  end if;
end $$;

-- 5d. §6 view footers. The check is "views == security_invoker and
--     anon_readable == 0", never the absolute count.
do $$
declare
  v_views  integer;
  v_inv    integer;
  v_anon   integer;
begin
  select count(*),
         count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']),
         count(*) filter (where has_table_privilege('anon', c.oid, 'select'))
    into v_views, v_inv, v_anon
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'v' and n.nspname = 'public';

  if v_views <> v_inv then
    raise exception '0190: % of % public views are security_invoker — a replacement dropped its reloptions.', v_inv, v_views;
  end if;
  if v_anon <> 0 then
    raise exception '0190: % public view(s) are anon-readable.', v_anon;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- AFTERWARDS, in a SEPARATE run (§5: the migration's own output is a claim,
-- the catalog is the evidence):
--
--   select p.oid::regprocedure::text,
--          has_function_privilege('anon', p.oid, 'execute') as anon_x
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'vat_rate';
--
--   select pg_get_viewdef('public.v_customer_prepaid_balance'::regclass, true);
--
-- Then in-browser: Finance tab (Running Balance, Settled Balance, the
-- over-balance banner), the project Breakdown report, and Inventory -> create a
-- PO and receive it. Nothing above changes a figure; the point of looking is
-- that nothing changed.
-- ---------------------------------------------------------------------------
