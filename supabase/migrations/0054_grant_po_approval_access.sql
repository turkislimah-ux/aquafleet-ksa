-- 0054_grant_po_approval_access.sql
-- Data-only fix (no schema change) — Turki's manual test of PO Approvals
-- (test 10 of the e9a03d5 gap-closing pass) failed with "Not authorized to
-- approve purchase orders." approve_purchase_order (migration 0052) checks:
--
--   perform 1 from public.staff
--    where email = p_actor
--      and active = true
--      and terminated_at is null
--      and role in ('fleet_manager', 'ops_supervisor', 'inventory_clerk');
--
-- p_actor is the authenticated session's email (actorEmail(), actions.ts).
-- Checked live: no public.staff row exists for turkias.co@hotmail.com at
-- all, so every approval attempt fails at that check, before it even gets
-- to the purchase_order_approvals insert. Nothing wrong with the RPC —
-- there was just no staff row for this login to match against.
--
-- Turki's own words: "always give all access for ever thing because i want
-- full authority. for testing and managing." — this grants that ONE
-- session (his real login) 'fleet_manager', the top of the three eligible
-- roles, permanently (active=true, terminated_at=null). It does NOT loosen
-- approve_purchase_order's role check for anyone else — that stays a real,
-- role-gated business rule for every other login, matching preview's own
-- APPROVER_ROLES model. If "full authority" should also cover things
-- outside Purchase-Order-Approvals (Maintenance sign-off, staff management,
-- etc. once those exist), that's a separate, likely broader, decision —
-- this migration only fixes the one access gap the test actually hit.
--
-- Idempotent — safe to re-run. Updates the row if one already exists for
-- this email (e.g. someone re-added it with a different role/inactive
-- since), inserts one if not. `name` is a placeholder ("Turki") — edit it
-- from the Drivers & People > Management & Staff tab afterward if a
-- different display name is wanted; it's cosmetic only, the RPC checks
-- email/role/active/terminated_at, never name.

begin;

update public.staff
   set role = 'fleet_manager',
       active = true,
       terminated_at = null
 where email = 'turkias.co@hotmail.com';

insert into public.staff (name, role, email, active)
select 'Turki', 'fleet_manager', 'turkias.co@hotmail.com', true
where not exists (
  select 1 from public.staff where email = 'turkias.co@hotmail.com'
);

commit;

-- ---------------------------------------------------------------------------
-- Post-run verification (run manually, not part of the migration):
--
--   select name, role, email, active, terminated_at
--     from public.staff
--    where email = 'turkias.co@hotmail.com';
--   -- one row: role='fleet_manager', active=true, terminated_at=null.
--
-- Then in the app: Inventory > Approvals tab > Approve on any
-- pending_approval PO should succeed (no more "Not authorized...").
-- ---------------------------------------------------------------------------
