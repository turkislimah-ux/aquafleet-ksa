-- 0082_drop_prior_truck_status.sql
-- Maintenance page cleanup — DB-usage report turned up work_orders.
-- prior_truck_status as fully orphaned: verified live (pg_proc scan) that
-- zero functions reference it (not create_work_order, not
-- complete_work_order, nothing), and app code never reads it either
-- (only ever appeared in the maintenance fetch's own SELECT string,
-- already removed from that select in app code before this migration).
-- A leftover from an earlier truck-status design, superseded by
-- lib/truck-status.ts's own live-derived computation.
--
-- APPLIED — this file documents what the architect already ran directly;
-- included on disk so migration history matches reality.

alter table public.work_orders drop column if exists prior_truck_status;
