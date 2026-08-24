-- 0165_dashboard_action_items_respect_warning_days.sql
-- The dashboard action queue's `expiring_documents` count now honours each
-- archive document group's configured `warning_days` instead of a hardcoded 30.
--
-- DRAFTED TO DISK. NOT APPLIED. The architect applies via MCP.
--
-- ===========================================================================
-- WHAT WAS WRONG
-- ===========================================================================
-- `v_dashboard_action_items` builds `expiring_documents` from FIVE sources, and
-- every one of them used `r.today + 30`:
--   archive_documents.expiry_date, drivers.license_expiry, drivers.iqama_expiry,
--   staff.iqama_expiry, trucks.registration_expiry
--
-- Only the FIRST of those is an archive document, and archive documents have
-- carried a per-group lead time since 0084 — `archive_document_groups.warning_days`,
-- `not null default 30 check (warning_days > 0)`, which 0084's header records as
-- Turki's explicit ask ("a vehicle licence and a commercial registration do not
-- want the same warning"). The Archive page has always honoured it, through
-- `docStatus(expiry, g.warning_days, today)` in lib/archive.ts. The dashboard
-- did not, so a group configured to warn at 90 days still surfaced at 30 in the
-- action queue — the setting existed and one surface ignored it.
--
-- ===========================================================================
-- MEASURED IMPACT: NO CHANGE TODAY, AND THE FIRST DIVERGENCE IS DATED
-- ===========================================================================
-- Counted on live data before drafting, rather than assumed:
--
--     current (hardcoded 30)         2
--     with per-group warning_days    2      <- unchanged
--
-- It is inert TODAY, and the reason is worth recording because it is also the
-- proof the change is real. Six archive documents carry an expiry date:
--
--     CR                      group warns  30    9 days EXPIRED    counted either way
--     Insurance - MidGulf     group warns  45   51 days away       counted by NEITHER
--     4 others                warns 30/45      254-372 days away   far outside both
--
-- The Insurance document is the live case. At 51 days out with a 45-day warning
-- it sits outside both windows right now — but in SIX DAYS it enters its group's
-- window and starts counting, where the hardcoded 30 would have kept it hidden
-- for another fifteen. That is exactly what the setting is for, and it is why
-- "the count did not move" is a safe result rather than evidence of a no-op.
--
-- ===========================================================================
-- LEFT JOIN + COALESCE, NOT AN INNER JOIN
-- ===========================================================================
-- `archive_documents.group_id` is NOT NULL today, so an inner join would lose
-- nothing and read more simply. It is deliberately not used.
--
-- An inner join makes the count depend on the join succeeding. If `group_id`
-- ever becomes nullable — or a group row is ever removed out from under a
-- document — an inner join silently DROPS those documents from the queue, and a
-- MISSING item in an action queue is far worse than one counted on the wrong
-- window: a wrong window shows up early or late, a missing row never shows up at
-- all and nothing indicates it is absent. The COALESCE fallback of 30 also keeps
-- the pre-0165 behaviour as the floor for any document that cannot resolve a
-- group, so the failure mode is "behaves as it did before", not "disappears".
--
-- This mirrors `v_active_alerts`, which resolves the same value as
-- `coalesce(g.warning_days, <threshold>)` rather than requiring the join.
--
-- ===========================================================================
-- THE FOUR IDENTITY EXPIRIES ARE DELIBERATELY LEFT AT 30 — A SEPARATE DECISION
-- ===========================================================================
-- driver licence, driver iqama, staff iqama and truck registration are columns
-- on `drivers`/`staff`/`trucks`. They are NOT archive documents, they belong to
-- no group, and there is no `warning_days` for them to respect. Making them
-- configurable is a different change, and this migration does not make it.
--
-- FOR WHOEVER PICKS THAT UP: `v_active_alerts` already resolves those four from
-- `th.lead_days` — the per-viewer notification threshold (user override, then the
-- shared `notification_thresholds` singleton, then 30). Adopting that here would
-- work, but it would make a SHARED operations dashboard per-viewer: two people
-- looking at the same screen would see different counts. The notification bell is
-- personal by design and that is right for it; the dashboard is not, and nothing
-- else in this view varies by who is looking. If the lead time for those four
-- should be configurable, the shared singleton alone is probably the right source
-- — but that is Turki's call, not a detail to slip into a fix about warning_days.
--
-- ===========================================================================
-- WHAT IS UNCHANGED
-- ===========================================================================
-- The other TEN branches of this view (POs, receipts, consumption approvals,
-- unpaid invoices, overdue trips, open work orders, awaiting receipt, outsourced
-- overdue, permit returns, parts below reorder) are SEMANTICALLY unchanged. The
-- body started as `pg_get_viewdef` output and only the archive-documents region
-- was substituted — that substitution was 2 lines removed and 4 added, all
-- inside that region.
--
-- IT IS NOT BYTE-IDENTICAL TO THE LIVE DEFINITION, AND THAT IS EXPECTED. Two
-- differences, both pure whitespace, both located after the apply by diffing
-- per-line lengths against pg_get_viewdef:
--   1. Some leading indentation was lost while transcribing the original viewdef
--      into the tool that performed the substitution — about twenty
--      `UNION ALL` / `SELECT` lines sit 8 spaces left of where Postgres puts them.
--   2. The archive branch's WHERE is split over two lines here; Postgres renders
--      it as one.
-- SQL ignores both, and Postgres re-normalises the whole body on apply, so the
-- STORED view carries canonical formatting either way.
--
-- This FILE is the SOURCE that produces the view, not a transcript of it — which
-- is the opposite of 0160, where the file recorded an ALREADY-APPLIED change and
-- byte-identity was therefore the right test. Equivalence here was proven against
-- the applied view instead: same column list, 14 UNION ALL branches, 8 `riyadh r`
-- references, exactly 4 remaining hardcoded windows, 11 rows out, and
-- `expiring_documents` = 2.
--
-- The COLUMN LIST is unchanged — kind, severity, item_count, oldest_at — which
-- matters because `create or replace view` can only APPEND a column (42P16).
-- app/page.tsx selects `*` and app/DashboardClient.tsx renders these four; no app
-- change accompanies this migration.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------
-- The view. Body copied from pg_get_viewdef with one region substituted.
-- Security footer restated below per CLAUDE.md §6 — `create or replace view`
-- silently drops reloptions, every time, without exception.
-- ---------------------------------------------------------------------
create or replace view public.v_dashboard_action_items
with (security_invoker = true) as
 WITH riyadh AS (
         SELECT (now() AT TIME ZONE 'Asia/Riyadh'::text)::date AS today
        )
 SELECT kind,
    severity,
    item_count,
    oldest_at
   FROM ( SELECT 'po_pending_approval'::text AS kind,
            'high'::text AS severity,
            count(*)::integer AS item_count,
            min(po.created_at) AS oldest_at
           FROM purchase_orders po
          WHERE po.status = 'pending_approval'::text
        UNION ALL
         SELECT 'receipt_pending_approval'::text,
            'high'::text,
            count(*)::integer AS count,
            min(sr.created_at) AS min
           FROM stock_receipts sr
          WHERE sr.status = 'pending_approval'::text
        UNION ALL
         SELECT 'consumption_pending_approval'::text,
            'medium'::text,
            count(*)::integer AS count,
            min(ca.created_at) AS min
           FROM consumption_approvals ca
          WHERE ca.decided_at IS NULL
        UNION ALL
         SELECT 'invoice_unpaid'::text,
            'high'::text,
            count(*)::integer AS count,
            min(r.confirmed_at) AS min
           FROM v_receivables_open r
        UNION ALL
         SELECT 'trip_overdue'::text,
            'high'::text,
            count(*)::integer AS count,
            min(t.created_at) AS min
           FROM trips t,
            riyadh r
          WHERE (t.stage = ANY (ARRAY['scheduled'::text, 'loading'::text, 'in_transit'::text])) AND t.trip_date < r.today
        UNION ALL
         SELECT 'work_order_open'::text,
            'medium'::text,
            count(*)::integer AS count,
            min(w.opened_at) AS min
           FROM work_orders w
          WHERE w.status = ANY (ARRAY['open'::text, 'awaiting_parts'::text])
        UNION ALL
         SELECT 'po_awaiting_receipt'::text,
            'medium'::text,
            count(*)::integer AS count,
            min(po.issued_at) AS min
           FROM purchase_orders po
          WHERE po.status = 'issued'::text
        UNION ALL
         SELECT 'outsourced_overdue'::text,
            'medium'::text,
            count(*)::integer AS count,
            min(o.created_at) AS min
           FROM outsourced_jobs o,
            riyadh r
          WHERE o.status = 'in_progress'::text AND o.estimated_finish IS NOT NULL AND o.estimated_finish < r.today
        UNION ALL
         SELECT 'permit_return_overdue'::text,
            'medium'::text,
            count(*)::integer AS count,
            min(e.exited_at) AS min
           FROM exit_permits e,
            riyadh r
          WHERE e.status = 'exited'::text AND e.expected_return_on IS NOT NULL AND e.expected_return_on < r.today
        UNION ALL
         SELECT 'parts_below_reorder'::text,
            'low'::text,
            count(*)::integer AS count,
            NULL::timestamp with time zone AS timestamptz
           FROM parts p
          WHERE p.active AND p.reorder_level IS NOT NULL AND p.qty_on_hand <= p.reorder_level
        UNION ALL
         SELECT 'expiring_documents'::text,
            'medium'::text,
            count(*)::integer AS count,
            NULL::timestamp with time zone AS timestamptz
           FROM ( SELECT ad.expiry_date
                   FROM archive_documents ad
                     LEFT JOIN archive_document_groups g ON g.id = ad.group_id,
                    riyadh r
                  WHERE ad.expiry_date IS NOT NULL
                    AND ad.expiry_date < (r.today + COALESCE(g.warning_days, 30))
                UNION ALL
                 SELECT d.license_expiry
                   FROM drivers d,
                    riyadh r
                  WHERE d.terminated_at IS NULL AND d.license_expiry IS NOT NULL AND d.license_expiry < (r.today + 30)
                UNION ALL
                 SELECT d.iqama_expiry
                   FROM drivers d,
                    riyadh r
                  WHERE d.terminated_at IS NULL AND d.iqama_expiry IS NOT NULL AND d.iqama_expiry < (r.today + 30)
                UNION ALL
                 SELECT s.iqama_expiry
                   FROM staff s,
                    riyadh r
                  WHERE s.terminated_at IS NULL AND s.iqama_expiry IS NOT NULL AND s.iqama_expiry < (r.today + 30)
                UNION ALL
                 SELECT t.registration_expiry
                   FROM trucks t,
                    riyadh r
                  WHERE t.terminated_at IS NULL AND t.registration_expiry IS NOT NULL AND t.registration_expiry < (r.today + 30)) exp) k;

alter view public.v_dashboard_action_items set (security_invoker = true);
revoke all on public.v_dashboard_action_items from anon;
grant select on public.v_dashboard_action_items to authenticated;

-- ---------------------------------------------------------------------
-- Self-asserts. Any failure rolls the replacement back.
-- ---------------------------------------------------------------------
do $$
declare
  v_cols  text;
  v_hard  int;
begin
  -- The column list must be exactly what the dashboard reads.
  select string_agg(attname, ',' order by attnum) into v_cols
    from pg_attribute
   where attrelid = 'public.v_dashboard_action_items'::regclass
     and attnum > 0 and not attisdropped;

  if v_cols <> 'kind,severity,item_count,oldest_at' then
    raise exception 'column list changed: %', v_cols;
  end if;

  -- The archive-documents branch must no longer hardcode a lead time, and the
  -- four identity branches must STILL use 30 - this migration does not touch
  -- them, and a change there would mean the wrong region was substituted.
  select count(*) into v_hard
    from regexp_matches(pg_get_viewdef('public.v_dashboard_action_items'::regclass, true),
                        '\(r\.today \+ 30\)', 'g') m;

  if v_hard <> 4 then
    raise exception 'expected exactly 4 remaining hardcoded 30-day windows (the identity expiries), found %', v_hard;
  end if;

  if pg_get_viewdef('public.v_dashboard_action_items'::regclass, true)
       not like '%COALESCE(g.warning_days, 30)%' then
    raise exception 'archive-documents branch is not reading warning_days';
  end if;

  raise notice 'archive docs respect warning_days; % identity windows still at 30', v_hard;
end $$;

commit;

-- ===========================================================================
-- VERIFICATION — run these; do not assume.
-- ===========================================================================
--
-- A) THE COUNT. Expect it UNCHANGED at the time of applying (2 on the data this
--    was drafted against). A moved number is not automatically wrong - see the
--    header - but it should be explainable by a specific document.
--      select kind, item_count from public.v_dashboard_action_items
--       where kind = 'expiring_documents';
--
-- B) WHICH DOCUMENTS ARE IN OR OUT, AND WHY. This is the query that explains any
--    movement, and the one to re-run when the Insurance document crosses in.
--      with r as (select (now() at time zone 'Asia/Riyadh')::date as today)
--      select ad.title, g.title as grp, g.warning_days,
--             ad.expiry_date, (ad.expiry_date - r.today) as days_away,
--             (ad.expiry_date < r.today + 30)                          as old_counted,
--             (ad.expiry_date < r.today + coalesce(g.warning_days,30)) as new_counted
--        from public.archive_documents ad
--        left join public.archive_document_groups g on g.id = ad.group_id, r
--       where ad.expiry_date is not null
--       order by ad.expiry_date;
--      -- At drafting: 'Insurance - MidGulf' warns at 45 and sits 51 days out, so
--      -- old=false new=false. It flips to new=true six days later; old stays
--      -- false for another fifteen. That divergence IS the feature.
--
-- C) SECURITY FOOTER SURVIVED (CLAUDE.md §6 - the two counts matching is the
--    check, not the number).
--      select count(*) as views,
--             count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--             count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--        from pg_class c join pg_namespace n on n.oid = c.relnamespace
--       where c.relkind = 'v' and n.nspname = 'public';
--      -- expect 50 / 50 / 0 - replacing a view does not add one
--
-- D) THE OTHER TEN BRANCHES DID NOT MOVE.
--      select kind, item_count from public.v_dashboard_action_items order by kind;
--      -- compare against the same query captured before applying; only
--      -- expiring_documents may differ, and today it should not.
--
-- E) IN-BROWSER. Dashboard -> action queue -> the "Expiring" tile. It should read
--    the same number as before, and the Archive page's own per-group warnings
--    should now agree with it rather than contradict it.
--
-- ===========================================================================
-- ROLLBACK
-- ===========================================================================
-- Re-run 0165 with COALESCE(g.warning_days, 30) replaced by 30 and the LEFT JOIN
-- removed, then restate the security footer - it drops on every replacement.
-- Rolling back restores a dashboard that ignores a setting the Archive page
-- honours, so the two surfaces would disagree again.
-- ===========================================================================
