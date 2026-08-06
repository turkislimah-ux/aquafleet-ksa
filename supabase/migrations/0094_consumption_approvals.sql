-- 0094_consumption_approvals.sql
-- Consumption page, Phase 2 — the APPROVALS tab.
--
-- ===========================================================================
-- WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
-- ===========================================================================
-- One table. Three nullable FKs, a CHECK that exactly one is set, a decision,
-- an approver, a timestamp, an optional reason, RLS. Nothing else.
--
-- NOT MONEY-TOUCHING, and that is a structural claim rather than a promise:
--   - NO function is created here, so there is no code path in this migration
--     that could call add_price_lot / consume_from_lots / return_to_lots or
--     any of 0093's permit helpers.
--   - NO trigger is created here, on this table or any other, so an insert
--     cannot fan out into a write somewhere else.
--   - NO existing table, column, constraint, index, policy, function or row
--     is altered. The three referenced tables are only pointed AT.
--   - The only writes this feature performs are an insert or an update on
--     THIS table. A decision changes nothing about the permit, the work order
--     or the outsourced job — not their status, not their stock, not their
--     cost. A rejection is informational: on an exited permit the parts have
--     already left, and un-leaving them is what void_exit_permit is for.
-- Every one of those is checkable after apply; the verification block at the
-- bottom does exactly that.
--
-- ===========================================================================
-- WHAT WAS READ BEFORE DRAFTING (live, not assumed)
-- ===========================================================================
-- purchase_order_approvals, the table this was asked to mirror:
--     id uuid pk, purchase_order_id uuid not null -> purchase_orders on
--     delete cascade, approver_email text not null, comment text,
--     approved_at timestamptz not null default now()
--     UNIQUE (purchase_order_id, approver_email)
--     RLS on, one policy: authenticated, FOR ALL, using(true) with check(true)
-- stock_receipt_approvals is the same shape plus action/outcome columns.
--
-- ONE DELIBERATE DIVERGENCE FROM THAT SHAPE, called out because it is the
-- constraint most worth reviewing. Both existing approval tables are UNIQUE
-- (event, approver_email) — a MULTI-APPROVER model, where a PO collects two
-- separate sign-offs. Turki's model here is ONE approval per event whose
-- decision can be changed later. So the unique key is the EVENT ALONE, not
-- (event, approver). Keeping the PO shape would have allowed two people to
-- record opposite decisions on the same permit with no way to say which one
-- stands. The approver column is still recorded — it says who decided, it is
-- just not part of the key.
--
-- ===========================================================================
-- THE THREE SUBJECTS — nullable FKs + CHECK, not a (type, id) pair
-- ===========================================================================
-- The archive's subject pattern (0084 decision 1), same as 0093's destination:
-- three nullable FKs with num_nonnulls(...) = 1. Real referential integrity
-- per target, and a deleted work order cannot leave an approval pointing at
-- nothing.
--
--   exit_permit_id     a permit — parts that left the warehouse
--   work_order_id      a COMPLETED in-house WO — the parts it consumed
--   outsourced_job_id  an OS job — its vendor payment
--
-- WHERE THE OS JOB'S MONEY ACTUALLY LIVES — worth stating, because the brief
-- said "outsourced jobs that have a vendor payment" and there is no payment
-- column on outsourced_jobs at all. It is public.workshop_payments
-- (outsourced_job_id -> outsourced_jobs on delete cascade, repairer_id,
-- invoice_number, invoice_date, subtotal_sar, vat_sar, discount_sar,
-- grand_total_sar). It is one-to-MANY and already is in practice: 7 payment
-- rows across 6 jobs, one job holding 2. So the approval attaches to the JOB
-- and covers its whole vendor spend, and the tab sums grand_total_sar per job
-- rather than showing one payment as if it were the only one. The approval
-- does NOT reference workshop_payments — approving a job then adding another
-- payment to it would otherwise leave a half-approved job with no way to see
-- it. The tab shows the payment count so a multi-payment job is visible.
--
-- 0077 EMBED HAZARD — CLEARED, and verified rather than assumed. The incident
-- was a SECOND FK between the SAME table pair (trucks had two to drivers),
-- which makes a PostgREST embed ambiguous. Here there are three FKs to three
-- DIFFERENT tables, and this table does not exist yet, so each is the first
-- and only FK for its pair. Confirmed live:
--     to_regclass('public.consumption_approvals') -> null (no such table)
--     FKs into the three targets today, none from any table twice:
--       work_orders     <- work_order_tasks, work_order_parts
--       outsourced_jobs <- outsourced_job_repairers, outsourced_job_tasks,
--                          workshop_payments
--       exit_permits    <- exit_permit_lines, exit_permit_returns,
--                          exit_permit_files
--
-- ON DELETE CASCADE on all three, matching purchase_order_approvals. An
-- approval is a statement ABOUT an event; with the event gone it is not
-- history, it is a dangling opinion. (RESTRICT would also mean an approval
-- could block deleting a draft-then-deleted permit, which is a worse trade.)
--
-- ===========================================================================
-- SECURITY (0083)
-- ===========================================================================
-- No functions are created, so there is nothing here to make SECURITY DEFINER,
-- nothing to pin a search_path on and nothing to revoke EXECUTE from. 0083 is
-- satisfied vacuously, not skipped.
--
-- RLS is enabled with ONE policy — authenticated, FOR ALL, using(true) with
-- check(true) — byte-identical in shape to the policies on
-- purchase_order_approvals and stock_receipt_approvals. anon gets nothing,
-- because anon is not granted by any policy on this table.
--
-- ===========================================================================
-- RECONCILED TO LIVE — applied and bite-tested by the architect
-- ===========================================================================
-- The architect applied his own variant rather than this file verbatim. The
-- DDL below is now the LIVE shape, read back from the catalog, not the draft.
-- Four differences from what was submitted, all kept:
--
--   1. approver_email text NOT NULL   ->  decided_by text NULL
--      His brief said "decided_by (the user, house pattern)", and NULL-able
--      matches the rest of the house's actor columns (issued_by, exited_by,
--      created_by are all nullable text) rather than purchase_order_approvals'
--      NOT NULL. The app still always writes it.
--   2. Added created_at timestamptz not null default now(), alongside
--      decided_at. They diverge once a decision is FLIPPED: created_at is when
--      the event was first ruled on, decided_at is when the current decision
--      was made. The draft had only the second and would have lost the first.
--   3. Constraint renamed: consumption_approvals_exactly_one_subject
--      -> consumption_approvals_one_subject. Same predicate.
--   4. Index names shortened (_permit_uniq / _wo_uniq / _os_uniq) and a
--      decision lookup index added: (decision, decided_at desc) — the same
--      shape as exit_permits_status_idx, for the tab's status filter.
--
-- VERIFIED AGAINST LIVE after apply:
--   constraints  consumption_approvals_one_subject
--                  CHECK (num_nonnulls(exit_permit_id, work_order_id,
--                                      outsourced_job_id) = 1)
--                consumption_approvals_decision_check
--                  CHECK (decision = ANY (ARRAY['approved','rejected']))
--                three FKs, each ON DELETE CASCADE, plus the PK
--   indexes      _permit_uniq / _wo_uniq / _os_uniq, each UNIQUE and PARTIAL
--                (WHERE ... IS NOT NULL), none mentioning the approver;
--                _decision_idx (decision, decided_at DESC); the PK
--   rls          relrowsecurity = true, exactly ONE policy:
--                authenticated_all_consumption_approvals, ALL,
--                {authenticated}, using true, with check true
--   inert        0 triggers on the table, 0 functions matching
--                '%consumption_approval%' anywhere in public
--
-- ===========================================================================
-- SAFETY / SCOPE
-- ===========================================================================
--  - One new table, one CHECK, three partial unique indexes, RLS + 1 policy.
--  - Nothing existing is touched. No data is written or migrated.
--  - Fully re-runnable: create table if not exists, create index if not
--    exists, drop policy if exists before create policy.
--  - The tab needs no backfill. It DERIVES its event list from the source
--    tables and LEFT JOINs this one, so every historical permit, work order
--    and outsourced job is retro-approvable from the moment this applies,
--    with no rows inserted here at all.

begin;

create table if not exists public.consumption_approvals (
  id                uuid primary key default gen_random_uuid(),

  -- Exactly one of these three is set. See the CHECK below.
  exit_permit_id    uuid references public.exit_permits(id)    on delete cascade,
  work_order_id     uuid references public.work_orders(id)     on delete cascade,
  outsourced_job_id uuid references public.outsourced_jobs(id) on delete cascade,

  decision          text not null check (decision in ('approved', 'rejected')),
  -- Optional on both decisions, per the model. The app asks for it on a
  -- rejection; the database does not refuse one without it, because a
  -- rejection someone could not phrase is still worth recording.
  reason            text,

  -- House pattern for an actor: the authenticated session's email, nullable
  -- like every other actor column in this schema (issued_by, exited_by,
  -- created_by). The app always writes it.
  decided_by        text,
  -- decided_at moves on every flip; created_at does not. Together they say
  -- "first ruled on then, currently says this since then".
  decided_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),

  constraint consumption_approvals_one_subject
    check (num_nonnulls(exit_permit_id, work_order_id, outsourced_job_id) = 1)
);

-- ONE APPROVAL PER EVENT. Partial unique indexes rather than a plain UNIQUE:
-- in Postgres NULLs are distinct, so a plain unique index on a mostly-NULL
-- column would happily hold thousands of NULL rows and index them for nothing.
-- These also serve as the lookup index for each FK, so no extra index is
-- needed. The decision itself stays changeable — the app UPDATEs the existing
-- row rather than inserting a second one.
create unique index if not exists consumption_approvals_permit_uniq
  on public.consumption_approvals (exit_permit_id)
  where exit_permit_id is not null;

create unique index if not exists consumption_approvals_wo_uniq
  on public.consumption_approvals (work_order_id)
  where work_order_id is not null;

create unique index if not exists consumption_approvals_os_uniq
  on public.consumption_approvals (outsourced_job_id)
  where outsourced_job_id is not null;

-- Status filter on the tab, same shape as exit_permits_status_idx.
create index if not exists consumption_approvals_decision_idx
  on public.consumption_approvals (decision, decided_at desc);

alter table public.consumption_approvals enable row level security;
drop policy if exists "authenticated_all_consumption_approvals" on public.consumption_approvals;
create policy "authenticated_all_consumption_approvals"
  on public.consumption_approvals for all to authenticated using (true) with check (true);

commit;

-- ===========================================================================
-- POST-APPLY VERIFICATION
-- ===========================================================================
-- 1) SHAPE — the table, the CHECK, the three FKs, all cascading:
--      select conname, pg_get_constraintdef(oid)
--        from pg_constraint
--       where conrelid = 'public.consumption_approvals'::regclass
--       order by contype;
--    Expect: the exactly-one CHECK using num_nonnulls(...) = 1, the decision
--    CHECK, three FOREIGN KEYs each ON DELETE CASCADE, one PRIMARY KEY.
--
-- 2) UNIQUE-PER-EVENT — three partial unique indexes, none mentioning
--    the approver:
--      select indexname, indexdef from pg_indexes
--       where schemaname = 'public' and tablename = 'consumption_approvals';
--
-- 3) RLS — enabled, exactly one policy, authenticated only:
--      select relrowsecurity from pg_class
--       where oid = 'public.consumption_approvals'::regclass;          -- true
--      select policyname, cmd, roles::text, qual, with_check
--        from pg_policies
--       where schemaname = 'public' and tablename = 'consumption_approvals';
--    Expect one row: authenticated_all_consumption_approvals, ALL,
--    {authenticated}, true, true.
--
-- 4) NOTHING WAS ADDED BEYOND THE TABLE — the claim at the top of this file:
--      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.proname like '%consumption_approval%';
--    Expect 0 — no function exists for this feature at all.
--      select tgname from pg_trigger
--       where tgrelid = 'public.consumption_approvals'::regclass
--         and not tgisinternal;
--    Expect 0 rows — no trigger on this table.
--
-- 5) THE CHECK BITES — each in its own transaction, rolled back:
--    a) all three FKs NULL                      -> must raise 23514
--    b) two FKs set at once                     -> must raise 23514
--    c) exactly one set, decision 'approved'    -> must SUCCEED
--    d) a SECOND row for the same event         -> must raise 23505
--    e) an UPDATE of that row's decision to
--       'rejected' with a reason                -> must SUCCEED
--       (proves a decision can be flipped without a second row)
--    f) decision = 'maybe'                      -> must raise 23514
--
-- 6) INERT ON INVENTORY — the test that matters most. In ONE transaction,
--    rolled back, around an insert AND an update for each of the three kinds:
--
--      -- before
--      create temp table _before_parts as
--        select id, qty_on_hand from public.parts order by id;
--      create temp table _before_lots as
--        select id, qty_remaining from public.price_lots order by id;
--      select count(*) as movements_before from public.stock_movements;
--      select id, status, ep_number from public.exit_permits order by id;
--      select id, status, actual_cost_sar from public.work_orders order by id;
--      select id, status from public.outsourced_jobs order by id;
--
--      -- act: approve one of each, then flip one to rejected
--      insert into public.consumption_approvals
--        (exit_permit_id, decision, decided_by)
--        select id, 'approved', 'probe@test' from public.exit_permits
--         where status = 'exited' limit 1;
--      insert into public.consumption_approvals
--        (work_order_id, decision, decided_by)
--        select id, 'approved', 'probe@test' from public.work_orders
--         where status = 'completed' limit 1;
--      insert into public.consumption_approvals
--        (outsourced_job_id, decision, decided_by)
--        select distinct outsourced_job_id, 'approved', 'probe@test'
--          from public.workshop_payments limit 1;
--      update public.consumption_approvals
--         set decision = 'rejected', reason = 'probe', decided_at = now()
--       where exit_permit_id is not null;
--
--      -- after: EVERY ONE of these must return ZERO rows / an unchanged count
--      select * from public.parts p join _before_parts b using (id)
--       where p.qty_on_hand is distinct from b.qty_on_hand;
--      select * from public.price_lots l join _before_lots b using (id)
--       where l.qty_remaining is distinct from b.qty_remaining;
--      select count(*) from public.stock_movements;   -- unchanged
--      -- source state untouched:
--      select id, status, ep_number from public.exit_permits order by id;
--      select id, status, actual_cost_sar from public.work_orders order by id;
--      select id, status from public.outsourced_jobs order by id;
--      -- and the FIFO invariant still holds:
--      select p.id, p.qty_on_hand, coalesce(sum(l.qty_remaining), 0) as lots
--        from public.parts p
--        left join public.price_lots l on l.part_id = p.id
--       group by p.id, p.qty_on_hand
--      having p.qty_on_hand is distinct from coalesce(sum(l.qty_remaining), 0);
--
--      rollback;
--
-- 7) anon cannot read it (0083's posture, via RLS rather than a grant):
--      set local role anon;
--      select count(*) from public.consumption_approvals;  -- expect 0 rows visible
--      reset role;
