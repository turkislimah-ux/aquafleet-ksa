-- 0047_stock_receipts.sql
-- Inventory — Phase 3 of the full-demo build-out: the loose "Add Parts"
-- receive path (preview/'s INV.openReceive / INV.confirmReceipt / manual
-- mode / D().receiveLooseParts). Purchase Orders (the "po" mode of the same
-- preview modal) are a SEPARATE, later phase — not built here. Migration
-- only. No UI, no app-code wrappers — those land in the next step.
--
-- WHAT THIS TOUCHES: adds public.stock_receipts, public.stock_receipt_lines,
-- public.stock_receipt_files, the private `stock-receipt-invoices` Storage
-- bucket, and one RPC (receive_loose_parts). Does NOT touch 0043's
-- warehouses/parts, 0044's receive_stock/adjust_stock, 0045's suppliers, or
-- 0046's price_lots/add_price_lot/consume_from_lots — all of those stay
-- exactly as they are. Does NOT touch lib/prepaid.ts, lib/vat.ts,
-- lib/invoice.ts, or any customer-facing money — same internal-parts-cost-
-- only boundary as every prior Inventory migration.
--
-- SHAPE — mirrors preview/'s partReceipts record (data.js
-- receiveLooseParts): one receipt header (supplier, warehouse, date, note,
-- total) + N line items (part, qty, unit price) + N uploaded invoice files
-- (mandatory — preview's confirmReceipt refuses to save with zero invoices).
-- Split into three tables instead of one JSON blob for the same reason
-- price_lots (0046) is a real table instead of a JSON array on parts: the
-- lines/files need their own FKs, indexes, and RLS, and a later phase (PO
-- receiving) will want to query "which receipts touched this part" without
-- unpacking JSON.
--
-- *** THE INVARIANT, PRESERVED, NOT REIMPLEMENTED ***
-- receive_loose_parts does NOT insert into price_lots or touch
-- parts.qty_on_hand/unit_cost_sar itself. For every line it calls
-- public.add_price_lot(...) — the exact same 0046 RPC the Phase 2 UI calls —
-- so a loose receipt and a manual "Add new price" batch are, from the lot
-- ledger's point of view, indistinguishable in mechanism (both go through
-- the one function that inserts the lot, bumps qty_on_hand, syncs
-- unit_cost_sar, and logs a 'receive_lot' stock_movement). This is what
-- keeps sum(price_lots.qty_remaining) = parts.qty_on_hand holding after a
-- receipt with zero duplicated logic — one writer, two entry points.
-- add_price_lot's own row-locking (FOR UPDATE on parts) already serializes
-- concurrent calls on the same part; calling it once per line inside this
-- RPC's transaction is safe for the same reason a plain loop calling any
-- other security-definer RPC is safe — each call is its own fully-guarded
-- unit of work.
--
-- RPC DISCIPLINE: exact-signature `drop function if exists` immediately
-- before `create or replace function`, `security definer` +
-- `set search_path = public`, `grant execute ... to authenticated` — same
-- as 0044/0046.
--
-- RLS: same "authenticated_all_<table>" pattern as every other table.
--
-- ON DELETE CHOICES (no cascading stock away):
--   stock_receipts.supplier_id / .warehouse_id -> RESTRICT. Suppliers and
--     warehouses are soft-deleted (active flag) in this app, never hard-
--     deleted (0043/0045) — RESTRICT just makes that existing convention a
--     hard guarantee: a historical receipt can never be orphaned by a
--     supplier/warehouse row disappearing. Same choice 0046 made for
--     price_lots.part_id.
--   stock_receipt_lines.receipt_id / stock_receipt_files.receipt_id ->
--     CASCADE. Lines and files are owned, dependent rows of their receipt
--     header — if a receipt is ever deleted (no delete path exists yet;
--     this is forward-looking), its lines/files should go with it. Deleting
--     a receipt or its lines/files, now or later, must NEVER reach back
--     into price_lots or parts.qty_on_hand to "undo" the stock effect —
--     there is deliberately no ON DELETE trigger here that touches lots.
--     Reversing a receipt's stock impact is a future, explicit operation
--     (its own RPC, symmetrical to consume_from_lots), not a side effect of
--     deleting a receipt row.
--   stock_receipt_lines.part_id -> RESTRICT, same reasoning/precedent as
--     price_lots.part_id (0046).
--   stock_receipt_lines.price_lot_id -> SET NULL. Best-effort traceability
--     link ("which lot did this receipt line create") — not load-bearing
--     for the qty invariant (add_price_lot already guarantees that on its
--     own), so losing the pointer if a lot row were ever removed must not
--     take the receipt line down with it.

begin;

-- ----------------------------------------------------------------------------
-- stock_receipts — one row per "Add Parts" receipt event (loose/manual path
-- only in this phase; a PO-linked mode is a later addition, not a column
-- stubbed in now).
-- ----------------------------------------------------------------------------
create table if not exists public.stock_receipts (
  id              uuid primary key default gen_random_uuid(),
  supplier_id     uuid not null references public.suppliers(id) on delete restrict,
  warehouse_id    uuid not null references public.warehouses(id) on delete restrict,
  received_on     date not null default current_date,
  -- Actor convention — same as stock_movements.created_by / price_lots'
  -- p_actor: the authenticated user's email, read server-side, never a UI
  -- text field.
  received_by     text,
  note            text,
  -- Denormalized cache of sum(line.qty * line.unit_price_sar) — same
  -- "structured ledger + convenient cache" split as parts.qty_on_hand.
  -- Written once by receive_loose_parts, never edited directly.
  total_cost_sar  numeric(12, 2) not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists stock_receipts_supplier_id_idx
  on public.stock_receipts (supplier_id);
create index if not exists stock_receipts_warehouse_id_idx
  on public.stock_receipts (warehouse_id);
create index if not exists stock_receipts_received_on_idx
  on public.stock_receipts (received_on desc);

alter table public.stock_receipts enable row level security;
drop policy if exists "authenticated_all_stock_receipts" on public.stock_receipts;
create policy "authenticated_all_stock_receipts"
  on public.stock_receipts for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- stock_receipt_lines — one row per part received on a given receipt.
-- price_lot_id traces back to the exact price_lots row add_price_lot
-- created for this line (nullable — traceability only, see header note).
-- ----------------------------------------------------------------------------
create table if not exists public.stock_receipt_lines (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.stock_receipts(id) on delete cascade,
  part_id         uuid not null references public.parts(id) on delete restrict,
  price_lot_id    uuid references public.price_lots(id) on delete set null,
  qty             numeric(12, 2) not null check (qty > 0),
  unit_price_sar  numeric(12, 2) not null check (unit_price_sar >= 0),
  created_at      timestamptz not null default now()
);

create index if not exists stock_receipt_lines_receipt_id_idx
  on public.stock_receipt_lines (receipt_id);
create index if not exists stock_receipt_lines_part_id_idx
  on public.stock_receipt_lines (part_id);

alter table public.stock_receipt_lines enable row level security;
drop policy if exists "authenticated_all_stock_receipt_lines" on public.stock_receipt_lines;
create policy "authenticated_all_stock_receipt_lines"
  on public.stock_receipt_lines for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- stock_receipt_files — metadata for the mandatory invoice upload(s)
-- (preview: d.invoices[], canSave requires at least one). Actual bytes live
-- in the stock-receipt-invoices Storage bucket below; this table is just
-- the pointer + display name, same split as customer_topups.photo_path /
-- topup-proofs (0040) and invoices.pdf_path / invoice-pdfs (0031).
-- ----------------------------------------------------------------------------
create table if not exists public.stock_receipt_files (
  id            uuid primary key default gen_random_uuid(),
  receipt_id    uuid not null references public.stock_receipts(id) on delete cascade,
  storage_path  text not null,
  file_name     text not null,
  mime_type     text,
  uploaded_at   timestamptz not null default now()
);

create index if not exists stock_receipt_files_receipt_id_idx
  on public.stock_receipt_files (receipt_id);

alter table public.stock_receipt_files enable row level security;
drop policy if exists "authenticated_all_stock_receipt_files" on public.stock_receipt_files;
create policy "authenticated_all_stock_receipt_files"
  on public.stock_receipt_files for all to authenticated using (true) with check (true);

-- ----------------------------------------------------------------------------
-- stock-receipt-invoices Storage bucket — PRIVATE, identical pattern to
-- topup-proofs (0040) / invoice-pdfs (0031) / special-charge-images (0032):
-- public=false, four policies (select/insert/update/delete), all scoped to
-- `to authenticated` with no per-row narrowing (same as every other bucket
-- in this app — access control here is "logged in or not", matching the
-- authenticated_all_<table> convention on the SQL side). App-generated
-- storage key (expected shape: `${receiptId}/invoice-${Date.now()}.${ext}`),
-- never the raw uploaded filename — same convention as topup-proofs.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('stock-receipt-invoices', 'stock-receipt-invoices', false)
on conflict (id) do nothing;

drop policy if exists "stock_receipt_invoices_authenticated_select" on storage.objects;
create policy "stock_receipt_invoices_authenticated_select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'stock-receipt-invoices');

drop policy if exists "stock_receipt_invoices_authenticated_insert" on storage.objects;
create policy "stock_receipt_invoices_authenticated_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'stock-receipt-invoices');

drop policy if exists "stock_receipt_invoices_authenticated_update" on storage.objects;
create policy "stock_receipt_invoices_authenticated_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'stock-receipt-invoices')
  with check (bucket_id = 'stock-receipt-invoices');

drop policy if exists "stock_receipt_invoices_authenticated_delete" on storage.objects;
create policy "stock_receipt_invoices_authenticated_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'stock-receipt-invoices');

-- ----------------------------------------------------------------------------
-- receive_loose_parts(p_supplier_id, p_warehouse_id, p_lines, p_files,
--                      p_note, p_actor)
-- p_lines: jsonb array of {"part_id": uuid, "qty": numeric,
--          "unit_price_sar": numeric} — one per part received.
-- p_files: jsonb array of {"storage_path": text, "file_name": text,
--          "mime_type": text} — the already-uploaded invoice file(s);
--          mandatory, mirrors preview's invoiceRequired guard.
--
-- Inserts the stock_receipts header, then for each line calls
-- public.add_price_lot() (0046) — NOT a fresh insert into price_lots — so
-- the FIFO invariant is enforced by the exact same code path Phase 2 uses,
-- never duplicated here. Each line's resulting lot id is looked up right
-- after (most recent lot for that part) purely to stamp
-- stock_receipt_lines.price_lot_id for traceability. Files are inserted as
-- plain metadata rows pointing at objects the caller already uploaded to
-- the stock-receipt-invoices bucket. Whole thing is one transaction: if any
-- line or file fails, the entire receipt (and every lot/movement it would
-- have created) rolls back — no partial receipts.
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
  v_total     numeric(12, 2) := 0;
  v_lot_id    uuid;
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

  insert into public.stock_receipts (supplier_id, warehouse_id, note, received_by)
  values (p_supplier_id, p_warehouse_id, nullif(trim(p_note), ''), p_actor)
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

    -- Same mechanism as Phase 2's "Add new price" — inserts the lot, bumps
    -- parts.qty_on_hand, syncs parts.unit_cost_sar, logs the 'receive_lot'
    -- movement. Nothing in this function touches price_lots/parts directly.
    perform public.add_price_lot(v_part_id, v_price, v_qty, v_receipt.received_on, p_note, p_actor);

    select id into v_lot_id
      from public.price_lots
     where part_id = v_part_id
     order by created_at desc
     limit 1;

    insert into public.stock_receipt_lines (receipt_id, part_id, price_lot_id, qty, unit_price_sar)
    values (v_receipt.id, v_part_id, v_lot_id, v_qty, v_price);

    v_total := v_total + (v_qty * v_price);
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
     set total_cost_sar = v_total
   where id = v_receipt.id
  returning * into v_receipt;

  return v_receipt;
end;
$$;

grant execute on function public.receive_loose_parts(uuid, uuid, jsonb, jsonb, text, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Post-run verification (run manually, not part of the migration):
--
--   select oid::regprocedure from pg_proc where proname = 'receive_loose_parts';
--   -- must return exactly ONE row:
--   -- receive_loose_parts(uuid, uuid, jsonb, jsonb, text, text)
--
--   select id, public from storage.buckets where id = 'stock-receipt-invoices';
--   -- must return ONE row, public = false
--
--   -- Invariant still holds after any receive_loose_parts call — same
--   -- check 0046 shipped with:
--   select p.id, p.qty_on_hand, coalesce(sum(pl.qty_remaining), 0) as lots_total
--     from public.parts p
--     left join public.price_lots pl on pl.part_id = p.id
--    group by p.id, p.qty_on_hand
--   having p.qty_on_hand <> coalesce(sum(pl.qty_remaining), 0);
--   -- must return ZERO rows
--
--   -- Smoke test (uses a real supplier_id/warehouse_id/part_id from your
--   -- data; replace the placeholders before running):
--   -- select * from public.receive_loose_parts(
--   --   '<supplier-uuid>', '<warehouse-uuid>',
--   --   '[{"part_id":"<part-uuid>","qty":5,"unit_price_sar":12.50}]'::jsonb,
--   --   '[{"storage_path":"test/invoice-1.pdf","file_name":"invoice-1.pdf","mime_type":"application/pdf"}]'::jsonb,
--   --   'Smoke test', 'you@example.com'
--   -- );
-- ---------------------------------------------------------------------------
