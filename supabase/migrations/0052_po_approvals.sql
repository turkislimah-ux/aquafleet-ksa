-- 0052_po_approvals.sql
-- Inventory — Phase 6 of the full-demo build-out: PO Approvals (preview/'s
-- D().approvePO()/rejectPO(), MIN_APPROVALS=2, APPROVER_ROLES). Migration
-- only. No UI, no app-code wrapper — those land in a follow-up step, same
-- split every prior phase used.
--
-- SCOPE THIS MIGRATION:
--   public.purchase_order_approvals (one row per approval — a PO needs
--   MIN_APPROVALS=2 distinct approvers before it flips to 'approved'),
--   ALTER purchase_orders to add rejected_by/rejected_at/rejection_reason
--   (a rejection is a single event, no history needed — mirrors preview's
--   own po.rejection single-object model, not a table), and TWO new RPCs:
--   approve_purchase_order() and reject_purchase_order().
--
-- *** NO NEW ROLE TABLE — REUSES staff_roles EXACTLY (0011) ***
-- Preview's APPROVER_ROLES = ['fleet_manager', 'ops_supervisor',
-- 'inventory_clerk'] (data.js ~1490). This app already has a real,
-- non-hardcoded roles table — staff_roles (0011) — seeded with EXACTLY
-- those three keys plus 'mechanic'/'dispatcher'. No new table, no new
-- concept: "who can approve a PO" is "an active staff member whose role is
-- one of those three", checked directly against staff/staff_roles at
-- approval time. If Turki ever wants a DIFFERENT set of approver-eligible
-- roles, that's an application-level constant to change in the RPC below
-- (hardcoded array, same as preview's own MIN_APPROVALS/APPROVER_ROLES are
-- hardcoded, not config-table-driven) — not a schema change.
--
-- *** ACTOR IDENTITY — SAME "email is the identity" CONVENTION AS EVERY
-- OTHER RPC IN THIS APP ***
-- p_actor is the authenticated user's email (read server-side in
-- actions.ts, never a UI field — same as requested_by/issued_at/
-- received_by throughout Phases 4/5). Eligibility is checked by matching
-- p_actor against staff.email + staff.role, NOT a personId the way preview
-- does it (preview has no auth, just picks from a people[] array) — this
-- is the same email-as-identity substitution every other actor column in
-- this app already made for preview's personId concept.
--
-- *** ONE REJECTION, TERMINAL — NOT A TABLE ***
-- purchase_orders.rejected_by/rejected_at/rejection_reason, nullable,
-- populated once by reject_purchase_order(). A PO's status CHECK (0050)
-- already makes 'rejected' terminal — nothing in this app transitions a PO
-- out of 'rejected', so there is no "reject again" case to model, matching
-- preview's own po.rejection being a single object, never an array.
--
-- *** APPROVAL COUNT — READ LIVE, NEVER CACHED ***
-- No stored "approvals_count" column on purchase_orders. Both RPCs and any
-- future UI read count(*) from purchase_order_approvals directly — same
-- "derive, don't cache" principle this app has applied to every PO total
-- since Phase 4 (0050's header).
--
-- *** NO STOCK TOUCHED — APPROVAL IS PAPERWORK, NOT AN INVENTORY EVENT ***
-- Stock already moved at receiving (Phase 5, migration 0051). Neither RPC
-- here calls add_price_lot, writes price_lots, or touches
-- parts.qty_on_hand/unit_cost_sar. Approving/rejecting only ever changes
-- purchase_orders.status + the approvals ledger.
--
-- RPC DISCIPLINE: exact-signature `drop function if exists` immediately
-- before `create or replace function`, `security definer` +
-- `set search_path = public`, `grant execute ... to authenticated` — same
-- as 0044/0046/0047/0050/0051.
--
-- ON DELETE CHOICE: purchase_order_approvals.purchase_order_id -> CASCADE,
-- same precedent as purchase_order_lines.purchase_order_id (0050) — owned,
-- dependent rows of their PO header.
--
-- RLS: purchase_order_approvals gets the same "authenticated_all_<table>"
-- policy as every other table in this app. purchase_orders' existing
-- policy (0050) already covers the new rejected_* columns — table-level,
-- not column-level.

begin;

-- ----------------------------------------------------------------------------
-- purchase_order_approvals — one row per distinct approver who has signed
-- off on a PO. UNIQUE(purchase_order_id, approver_email) enforces "can't
-- approve the same PO twice" at the schema level, not just app logic —
-- mirrors preview's own `if (po.approvals.find(a => a.personId ===
-- personId)) return false;` guard, made a hard constraint instead of a
-- soft check.
-- ----------------------------------------------------------------------------
create table if not exists public.purchase_order_approvals (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  approver_email    text not null,
  comment           text,
  approved_at       timestamptz not null default now(),
  unique (purchase_order_id, approver_email)
);

create index if not exists purchase_order_approvals_po_id_idx
  on public.purchase_order_approvals (purchase_order_id);

alter table public.purchase_order_approvals enable row level security;
drop policy if exists "authenticated_all_purchase_order_approvals" on public.purchase_order_approvals;
create policy "authenticated_all_purchase_order_approvals"
  on public.purchase_order_approvals for all to authenticated using (true) with check (true);

alter table public.purchase_orders
  add column if not exists rejected_by text,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text;

-- ----------------------------------------------------------------------------
-- approve_purchase_order(p_po_id, p_comment, p_actor)
-- Requires status = 'pending_approval' and p_actor to be an active staff
-- member whose role is one of the approver-eligible roles (hardcoded here,
-- same as preview's own APPROVER_ROLES constant). Rejects a repeat
-- approval from the same actor with a clear message (the UNIQUE constraint
-- would also catch it, but this raises something readable instead of a
-- raw constraint-violation error). Once approvals reach MIN_APPROVALS (2,
-- hardcoded, same as preview's own constant), flips status to 'approved'.
-- Below threshold, the PO stays 'pending_approval' — this is expected, not
-- an error; the caller can tell how many more approvals are needed by
-- counting purchase_order_approvals itself (no stored counter to read).
-- ----------------------------------------------------------------------------
drop function if exists public.approve_purchase_order(uuid, text, text);

create or replace function public.approve_purchase_order(
  p_po_id   uuid,
  p_comment text default null,
  p_actor   text default null
) returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po             public.purchase_orders;
  v_approval_count integer;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'Purchase order not found.';
  end if;
  if v_po.status <> 'pending_approval' then
    raise exception 'Only a purchase order awaiting approval can be approved (current status: %).', v_po.status;
  end if;

  if p_actor is null then
    raise exception 'Approver identity is required.';
  end if;

  perform 1 from public.staff
   where email = p_actor
     and active = true
     and terminated_at is null
     and role in ('fleet_manager', 'ops_supervisor', 'inventory_clerk');
  if not found then
    raise exception 'Not authorized to approve purchase orders.';
  end if;

  perform 1 from public.purchase_order_approvals
   where purchase_order_id = p_po_id and approver_email = p_actor;
  if found then
    raise exception 'You have already approved this purchase order.';
  end if;

  insert into public.purchase_order_approvals (purchase_order_id, approver_email, comment)
  values (p_po_id, p_actor, nullif(trim(p_comment), ''));

  select count(*) into v_approval_count
    from public.purchase_order_approvals
   where purchase_order_id = p_po_id;

  if v_approval_count >= 2 then
    update public.purchase_orders
       set status = 'approved'
     where id = p_po_id
    returning * into v_po;
  end if;

  return v_po;
end;
$$;

grant execute on function public.approve_purchase_order(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- reject_purchase_order(p_po_id, p_reason, p_actor)
-- Requires status = 'pending_approval' and the same approver-eligibility
-- check as approve_purchase_order. Terminal: sets status = 'rejected' with
-- rejected_by/rejected_at/rejection_reason. One rejection is enough — no
-- approval count threshold, matching preview's own rejectPO() (a single
-- reject flips status immediately, unlike approve which needs
-- MIN_APPROVALS).
-- ----------------------------------------------------------------------------
drop function if exists public.reject_purchase_order(uuid, text, text);

create or replace function public.reject_purchase_order(
  p_po_id  uuid,
  p_reason text default null,
  p_actor  text default null
) returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then
    raise exception 'Purchase order not found.';
  end if;
  if v_po.status <> 'pending_approval' then
    raise exception 'Only a purchase order awaiting approval can be rejected (current status: %).', v_po.status;
  end if;

  if p_actor is null then
    raise exception 'Approver identity is required.';
  end if;

  perform 1 from public.staff
   where email = p_actor
     and active = true
     and terminated_at is null
     and role in ('fleet_manager', 'ops_supervisor', 'inventory_clerk');
  if not found then
    raise exception 'Not authorized to reject purchase orders.';
  end if;

  update public.purchase_orders
     set status = 'rejected',
         rejected_by = p_actor,
         rejected_at = now(),
         rejection_reason = nullif(trim(p_reason), '')
   where id = p_po_id
  returning * into v_po;

  return v_po;
end;
$$;

grant execute on function public.reject_purchase_order(uuid, text, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Post-run verification (run manually, not part of the migration):
--
--   select oid::regprocedure from pg_proc where proname = 'approve_purchase_order';
--   -- must return exactly ONE row: approve_purchase_order(uuid, text, text)
--
--   select oid::regprocedure from pg_proc where proname = 'reject_purchase_order';
--   -- must return exactly ONE row: reject_purchase_order(uuid, text, text)
--
--   -- Approver eligibility sanity check — confirm at least one active
--   -- staff row exists with an approver-eligible role and a usable email
--   -- (needed before any smoke test below can succeed):
--   select id, name, role, email, active, terminated_at
--     from public.staff
--    where role in ('fleet_manager', 'ops_supervisor', 'inventory_clerk')
--      and active = true and terminated_at is null;
--
--   -- No stock movement from either RPC — invariant unchanged:
--   select p.id, p.qty_on_hand, coalesce(sum(pl.qty_remaining), 0) as lots_total
--     from public.parts p
--     left join public.price_lots pl on pl.part_id = p.id
--    group by p.id, p.qty_on_hand
--   having p.qty_on_hand <> coalesce(sum(pl.qty_remaining), 0);
--   -- must return ZERO rows
--
--   -- Smoke test (needs a PO already in 'pending_approval' — i.e. one
--   -- that's been through receive_purchase_order, 0051 — and a real
--   -- approver-eligible staff email from the query above):
--   -- select * from public.approve_purchase_order('<po-uuid>', 'Looks correct.', 'approver1@example.com');
--   -- status should stay 'pending_approval' (1 of 2 approvals).
--   -- select * from public.approve_purchase_order('<po-uuid>', null, 'approver2@example.com');
--   -- status should now read 'approved' (2 of 2).
--   -- Re-approving with the same email a third time must raise "You have
--   -- already approved this purchase order."
-- ---------------------------------------------------------------------------
