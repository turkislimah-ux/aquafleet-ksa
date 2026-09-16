-- ===========================================================================
-- LEDGER REWRITE — supabase_migrations.schema_migrations — PROD — 2026-09-16
-- DRAFTED, NOT APPLIED. Run in the Supabase SQL Editor. One transaction.
-- ===========================================================================
--
-- WHAT THIS DOES
--   Replaces prod's 133 timestamp-keyed ledger rows with 198 rows keyed to the
--   repo's migration filenames: 0001..0200 with the known 0135/0136 gaps. After
--   it, every file in supabase/migrations/ has exactly one ledger row, and every
--   ledger row has exactly one file.
--
-- WHY IT IS SAFE TO DO AT ALL
--   Phase 1 proved a clean from-files rebuild byte-matches prod: 15 of 15
--   populated catalog categories identical, all 80 functions token-identical
--   including security definer / volatility / search_path / return type, all 50
--   views identical including their security_invoker footer, all 6 squashed-fix
--   rows confirmed present in the files. The FILES ARE the schema that is
--   running. Renaming the ledger keys to match the files therefore records a
--   fact, it does not assert a hope.
--
-- WHAT IT DOES NOT DO
--   It runs NO DDL. It touches NO application table. It changes NOTHING about
--   the schema, the data, or the money logic. It rewrites bookkeeping rows in
--   supabase_migrations only.
--
-- PREREQUISITE, ENFORCED BELOW
--   .planning/post-deploy/prod-ledger-backup-2026-09-16.sql PART A must have
--   been run first. This script REFUSES to start without that snapshot.
--
-- HOW THE 133 OLD ROWS MAP ONTO 198 NEW ONES
--   124 files inherit their `statements` body from the prod row that applied
--        them, carried across server-side from the snapshot. No text is retyped.
--    74 files get a marker body: they were applied before this ledger existed
--        (everything below 0060) or under a name the ledger never recorded. The
--        real SQL is in the repo; the marker says so.
--     9 prod rows are consumed by nothing and are dropped:
--         4 duplicate re-applies  — 0063, 0064, 0089, 0097 were each stamped
--                                   twice; the later stamp wins.
--         5 superseded (c2)       — 0103_dashboard_views_fix,
--                                   0103_restore_invoker_action_items,
--                                   0134b_fix_balance_guard_customer_join,
--                                   revoke_anon_default_privileges,
--                                   reconcile_0193_trigger_fn_text.
--                                   Each was a follow-up fix that has since been
--                                   folded into its base file. Phase 1 confirmed
--                                   all six (c2) rows byte-level against live, so
--                                   collapsing them loses no applied change.
--     4 (c1) name-drift rows keep their body but move under the file's name:
--         0081_delete_work_orders            -> 0081_delete_work_order_outsourced_job
--         0083_anon_rpc_hardening            -> 0083_revoke_public_execute
--         0140_drop_unguarded_archive_project-> 0140_drop_archive_project
--         0101_operations_by_driver_reapply  -> 0144_reconcile_operations_by_driver_metric
--     1 (c2) row is kept as a base body rather than dropped, because its file
--       has no same-name row of its own:
--         revoke_anon_grants_public          -> 0161_revoke_anon_grants
--   124 + 9 = 133. The arithmetic is asserted below, not assumed.
--
-- THE EMBEDDED FILE LIST IS PROVABLY THE REPO
--   The 198 tuples below were generated from supabase/migrations/ on 2026-09-16.
--   To prove the list has not drifted from the repo, run this in the repo root
--   and check it prints the same md5 the script asserts:
--
--     ls supabase/migrations/*.sql | xargs -n1 basename | sort | md5
--     expected: 008c69fe3c3aa3362479645912352ea5
--
--   Postgres cannot read your filesystem, so that one check is yours to run. It
--   is the only link in the chain the script cannot close by itself. Run it.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- GUARD 0 — the undo must exist before anything is destroyed.
-- ---------------------------------------------------------------------------
do $guard$
declare n int; fp text;
begin
  if to_regclass('supabase_migrations.schema_migrations_backup_20260916') is null then
    raise exception
      'NO SNAPSHOT. Run .planning/post-deploy/prod-ledger-backup-2026-09-16.sql PART A first. Refusing to rewrite a ledger that cannot be put back.';
  end if;
  select count(*) into n from supabase_migrations.schema_migrations_backup_20260916;
  if n <> 133 then
    raise exception 'Snapshot holds % rows, expected 133. Do not proceed.', n;
  end if;

-- ---------------------------------------------------------------------------
-- GUARD 1 — the LIVE ledger must still be exactly what this script was drafted
-- against. If someone ran a migration since 2026-09-16, the mapping above is
-- stale and this script must be re-drafted, not forced.
-- ---------------------------------------------------------------------------
  select count(*) into n from supabase_migrations.schema_migrations;
  if n <> 133 then
    raise exception 'LIVE ledger holds % rows, expected 133. It changed since drafting. STOP and re-draft.', n;
  end if;
  select md5(string_agg(version||'|'||coalesce(name,'')||'|'||coalesce(created_by,'')||'|'||
                        coalesce(idempotency_key,'')||'|'||md5(array_to_string(statements, chr(10))),
                        chr(10) order by version))
    into fp from supabase_migrations.schema_migrations;
  if fp <> '4bdf5ea896e269cc736f80f442f08111' then
    raise exception 'LIVE ledger fingerprint % <> drafted 4bdf5ea896e269cc736f80f442f08111. It changed since drafting. STOP and re-draft.', fp;
  end if;
  raise notice 'GUARDS PASSED — snapshot present, live ledger unchanged since drafting.';
end $guard$;


-- ---------------------------------------------------------------------------
-- THE TARGET — one row per migration file, in filename order.
--   version  = the filename's 4-digit prefix (what the Supabase CLI keys on)
--   name     = the rest of the filename, minus .sql (what the CLI displays)
--   src      = the prod ledger version whose statements body carries over,
--              or null for files applied before this ledger existed
-- ---------------------------------------------------------------------------
create temp table _target (version text, name text, src text) on commit drop;

insert into _target (version, name, src) values
  ('0001', 'init_customers_projects', null),
  ('0002', 'init_trucks_drivers', null),
  ('0003', 'init_trips', null),
  ('0004', 'init_project_drivers_commission', null),
  ('0005', 'fleet_detail_fields', null),
  ('0006', 'drivers_people_fields', null),
  ('0007', 'commission_extras', null),
  ('0008', 'commission_item_status', null),
  ('0009', 'commission_rolling_history', null),
  ('0010', 'staff', null),
  ('0011', 'staff_roles_termination', null),
  ('0012', 'leave', null),
  ('0013', 'slug_normalization', null),
  ('0014', 'water_stations', null),
  ('0015', 'one_project_per_customer', null),
  ('0016', 'create_project_with_customer', null),
  ('0017', 'update_project_with_customer', null),
  ('0018', 'project_water_type', null),
  ('0019', 'archive_project', null),
  ('0020', 'driver_truck_termination', null),
  ('0021', 'water_stations_management_fields', null),
  ('0022', 'operation_stations', null),
  ('0023', 'driver_staff_fields', null),
  ('0024', 'driver_incidents', null),
  ('0025', 'finance_invoicing_data_model', null),
  ('0026', 'project_payment_mode_rpc', null),
  ('0027', 'invoice_lifecycle', null),
  ('0028', 'customer_email_rpc', null),
  ('0029', 'company_settings_email', null),
  ('0030', 'reserve_at_draft', null),
  ('0031', 'invoice_pdfs_bucket', null),
  ('0032', 'special_charges_detail_and_confirm_guard', null),
  ('0033', 'trip_ref_per_project', null),
  ('0034', 'invoice_number_yearly_drop_vat_ref', null),
  ('0035', 'payment_mode_switch_guard', null),
  ('0036', 'v3_ledger_totals_and_hide_amount_due', '20260717090430'),
  ('0037', 'invoice_payment_mode_snapshot', '20260717091354'),
  ('0038', 'confirm_invoice_drop_stale_overloads', null),
  ('0039', 'postpaid_payment_fields', null),
  ('0040', 'topup_method_and_photo', null),
  ('0041', 'invoice_header_fields', null),
  ('0042', 'company_settings_arabic_name', null),
  ('0043', 'inventory_schema_foundation', null),
  ('0044', 'stock_movements', null),
  ('0045', 'suppliers', null),
  ('0046', 'price_lots', null),
  ('0047', 'stock_receipts', null),
  ('0048', 'suppliers_name_ar', null),
  ('0049', 'units', null),
  ('0050', 'purchase_orders', null),
  ('0051', 'po_receiving', null),
  ('0052', 'po_approvals', null),
  ('0053', 'po_ai_suggest', null),
  ('0054', 'grant_po_approval_access', null),
  ('0055', 'po_receive_extra_lines', null),
  ('0056', 'inventory_vat', null),
  ('0057', 'receipt_approval_direct_invoices', null),
  ('0058', 'receipt_vote_approvals_and_lot_fix', '20260726235247'),
  ('0059', 'add_price_lot_returns_uuid_and_backfill', null),
  ('0060', 'maintenance_schema_and_create_wo', '20260728122843'),
  ('0061', 'maintenance_lifecycle', '20260728224430'),
  ('0062', 'lock_down_deduct_work_order_parts', null),
  ('0063', 'maintenance_labor_costing', '20260729190830'),
  ('0064', 'maintenance_task_completion_gate', '20260729190843'),
  ('0065', 'maintenance_edit_and_reversal', '20260729192000'),
  ('0066', 'edit_work_order_legacy_consumption_guard', '20260729203909'),
  ('0067', 'maintenance_part_photos', '20260729211217'),
  ('0068', 'outsourced_jobs_schema_and_create', '20260730150050'),
  ('0069', 'outsourced_jobs_lifecycle', '20260730150746'),
  ('0070', 'outsourced_job_number_year_reset', '20260731020519'),
  ('0071', 'workshop_payment_discount', '20260731020526'),
  ('0072', 'outsourced_notes_and_task_gate', '20260731020537'),
  ('0073', 'work_order_start_date', '20260731122305'),
  ('0074', 'wo_number_year_reset_and_backfill', '20260731130300'),
  ('0075', 'auto_update_truck_last_service', '20260801010653'),
  ('0076', 'auto_truck_status_driver_engine', '20260801014205'),
  ('0077', 'drop_driver_before_maintenance_fk', '20260801014744'),
  ('0078', 'work_order_task_gate_parity', '20260801180436'),
  ('0079', 'work_order_parts_only_cost', '20260802112852'),
  ('0080', 'staff_commissions', '20260802141653'),
  ('0081', 'delete_work_order_outsourced_job', '20260802194627'),
  ('0082', 'drop_prior_truck_status', '20260802233739'),
  ('0083', 'revoke_public_execute', '20260802235043'),
  ('0084', 'archive_documents', '20260803220033'),
  ('0085', 'archive_document_identity_fields', '20260804004146'),
  ('0086', 'archive_group_subject_kind', '20260804091616'),
  ('0087', 'archive_document_subject_guard', '20260804092309'),
  ('0088', 'person_id_numbers', '20260804183542'),
  ('0089', 'archive_group_type_and_linking', '20260804204141'),
  ('0090', 'drop_duplicate_linking_design', '20260804204640'),
  ('0091', 'truck_registration_linking', '20260804232354'),
  ('0092', 'linked_doc_stores_no_value', '20260805091124'),
  ('0093', 'exit_permits', '20260805143227'),
  ('0094', 'consumption_approvals', '20260805233315'),
  ('0095', 'consumption_approvals_two_person', '20260806001210'),
  ('0096', 'approval_lock_30_days', '20260807001616'),
  ('0097', 'consumption_approvals_matching_votes', '20260806020709'),
  ('0098', 'reports_semantic_layer', '20260807024659'),
  ('0099', 'maintenance_cost_per_truck_with_os', '20260807101510'),
  ('0100', 'pnl_by_period', '20260807105607'),
  ('0101', 'operations_by_driver', '20260807175647'),
  ('0102', 'global_search', '20260809184526'),
  ('0103', 'dashboard_views', '20260810234649'),
  ('0104', 'daily_operations', '20260812115503'),
  ('0105', 'delivery_output_daily', '20260812122935'),
  ('0106', 'projects_costmix_drivers', '20260813144040'),
  ('0107', 'projects_month_drivers_truck', '20260813215312'),
  ('0108', 'delivered_revenue_daily', '20260813231041'),
  ('0109', 'delivered_revenue_by_trip_date', '20260813234253'),
  ('0110', 'station_type_pricing_and_trip_fill_snapshot', '20260814173825'),
  ('0111', 'backfill_trip_filling_cost', '20260814183422'),
  ('0112', 'filling_cost_into_pnl', '20260814194039'),
  ('0113', 'pnl_by_period_filling_bucket', '20260814194928'),
  ('0114', 'trips_station_water_type_guard', '20260815101249'),
  ('0115', 'driver_payslips', '20260815160122'),
  ('0116', 'driver_commission_by_project', '20260815192752'),
  ('0117', 'payroll_null_hire_date', '20260815202453'),
  ('0118', 'payslip_basis_net', '20260815203550'),
  ('0119', 'drop_demo_truck_condition_columns', '20260815220801'),
  ('0120', 'fleet_state_now_drop_truck_columns', '20260816002635'),
  ('0121', 'retire_customers_payment_model', '20260816145205'),
  ('0122', 'retire_water_stations_fill_cost', '20260816152232'),
  ('0123', 'dictionary_period_pointers', '20260816164707'),
  ('0124', 'dictionary_filling_cost', '20260816170225'),
  ('0125', 'salary_history', '20260816173425'),
  ('0126', 'salary_baseline_immutable', '20260816174643'),
  ('0127', 'payslip_basis_effective_salary', '20260816181031'),
  ('0128', 'backfill_trip_rate_snapshot', '20260816182025'),
  ('0129', 'delivered_revenue_frozen_rate', '20260816193505'),
  ('0130', 'truck_utilization', '20260816223132'),
  ('0131', 'pay_commission_monthly', '20260817210619'),
  ('0132', 'driver_health_insurance', '20260818112615'),
  ('0133', 'drop_driver_incidents_12mo', '20260818160714'),
  ('0134', 'payment_method_balance', '20260818202107'),
  ('0137', 'outstanding_reflects_live_prepaid_balance', '20260819104705'),
  ('0138', 'delete_test_z_special_charge', '20260819104740'),
  ('0139', 'archive_debt_guard_balance_return_writeoff', '20260819131425'),
  ('0140', 'drop_archive_project', '20260819134614'),
  ('0141', 'restore_customer_reverse_write_off', '20260820123504'),
  ('0142', 'net_balance_returns', '20260820121635'),
  ('0143', 'drop_write_off_payment_mode', '20260820202551'),
  ('0144', 'reconcile_operations_by_driver_metric', '20260807183041'),
  ('0145', 'operations_metric_caveat', '20260820214605'),
  ('0146', 'project_commission_history', '20260821104801'),
  ('0147', 'project_commission_sync_trigger', '20260821112212'),
  ('0148', 'set_project_commission', '20260821214457'),
  ('0149', 'v_project_commission_now', '20260821214804'),
  ('0150', 'update_project_stops_writing_commission', '20260821220213'),
  ('0151', 'update_project_commission_params_defaulted', '20260822182954'),
  ('0152', 'trip_commission_terms_freeze', '20260822201627'),
  ('0153', 'update_project_drop_commission_params', '20260822211740'),
  ('0154', 'notifications_data_layer', '20260823134748'),
  ('0155', 'notification_blue_event_branches', '20260823142124'),
  ('0156', 'leave_return_yellow_excludes_today', '20260823142811'),
  ('0157', 'issue_reports', '20260823163332'),
  ('0158', 'notification_thresholds_per_user', '20260823174511'),
  ('0159', 'user_profiles', '20260823200023'),
  ('0160', 'drop_notification_events', '20260823220730'),
  ('0161', 'revoke_anon_grants', '20260823223252'),
  ('0162', 'cleanup_policy_fixes', '20260824000504'),
  ('0163', 'revoke_public_execute_money_rpcs', '20260824075431'),
  ('0164', 'revoke_public_execute_guarded_rpcs', '20260824084056'),
  ('0165', 'dashboard_action_items_respect_warning_days', '20260824094501'),
  ('0166', 'deferred_deliveries', '20260824111246'),
  ('0167', 'cost_views_ex_vat_and_archive_date_aware', '20260824231520'),
  ('0168', 'lookup_label_ar', null),
  ('0169', 'builtin_role_labels_bilingual', null),
  ('0170', 'builtin_leave_type_labels_bilingual', null),
  ('0171', 'preferred_language_login_only', null),
  ('0172', 'backfill_po_status_from_receipt', null),
  ('0173', 'trips_ref_unique_per_project', null),
  ('0174', 'trip_ref_gap_fill', null),
  ('0175', 'violation_types', null),
  ('0176', 'driver_violations', null),
  ('0177', 'payslip_violation_deductions', null),
  ('0178', 'violation_notice_image', null),
  ('0179', 'rls_initplan_auth_uid_subselect', null),
  ('0180', 'pin_function_search_path', null),
  ('0181', 'confirm_invoice_special_charges_guard', null),
  ('0182', 'discard_draft_or_review_invoice', null),
  ('0183', 'rename_delete_draft_invoice_to_discard_invoice', null),
  ('0184', 'company_bank_accounts', null),
  ('0185', 'within_month_collection_rate', '20260907234127'),
  ('0186', 'collections_settlement_basis', '20260907234307'),
  ('0187', 'report_metrics_balance_terms', '20260908133816'),
  ('0188', 'drop_drivers_active', '20260908222647'),
  ('0189', 'riyadh_date_buckets', '20260909194055'),
  ('0190', 'vat_rate_constant', '20260909212041'),
  ('0191', 'confirm_invoice_totals_assert', '20260909212807'),
  ('0192', 'security_parity', '20260910134608'),
  ('0193', 'function_execute_lockdown', '20260910140328'),
  ('0194', 'schema_convergence', '20260910144735'),
  ('0195', 'drop_stale_create_purchase_order_overload', '20260910185429'),
  ('0196', 'payout_document_number', '20260914094631'),
  ('0197', 'exit_permit_cost_recognition', '20260914193945'),
  ('0198', 'notification_thresholds_read_only', '20260914201656'),
  ('0199', 'views_read_only_for_authenticated', '20260914205423'),
  ('0200', 'exit_permit_write_offs', '20260915114720');


-- ---------------------------------------------------------------------------
-- PRE-FLIGHT — the target must be well formed BEFORE the delete.
-- ---------------------------------------------------------------------------
do $preflight$
declare n int; bad text;
begin
  select count(*) into n from _target;
  if n <> 198 then raise exception 'PRE-FLIGHT FAIL: target has % rows, expected 198.', n; end if;

  select count(*) into n from (select version from _target group by version having count(*) > 1) d;
  if n <> 0 then raise exception 'PRE-FLIGHT FAIL: % duplicate version(s) in the target.', n; end if;

  select string_agg(version, ', ' order by version) into bad
    from _target where version !~ '^[0-9]{4}$';
  if bad is not null then raise exception 'PRE-FLIGHT FAIL: non-4-digit version(s): %', bad; end if;

  select count(*) into n from _target where src is not null;
  if n <> 124 then raise exception 'PRE-FLIGHT FAIL: % rows inherit statements, expected 124.', n; end if;

  -- Every src must actually exist in the snapshot, or a body silently vanishes.
  select string_agg(t.version||' -> '||t.src, ', ' order by t.version) into bad
    from _target t
   where t.src is not null
     and not exists (select 1 from supabase_migrations.schema_migrations_backup_20260916 b
                      where b.version = t.src);
  if bad is not null then raise exception 'PRE-FLIGHT FAIL: src rows missing from the snapshot: %', bad; end if;

  -- No prod body may be claimed by two files.
  select count(*) into n from (select src from _target where src is not null group by src having count(*) > 1) d;
  if n <> 0 then raise exception 'PRE-FLIGHT FAIL: % prod row(s) claimed by more than one file.', n; end if;

  -- 124 consumed + 9 deliberately dropped = 133. Asserted, not assumed.
  select count(*) into n from supabase_migrations.schema_migrations_backup_20260916 b
   where not exists (select 1 from _target t where t.src = b.version);
  if n <> 9 then raise exception 'PRE-FLIGHT FAIL: % prod rows would be dropped, expected exactly 9.', n; end if;

  raise notice 'PRE-FLIGHT PASSED — 198 target rows, 124 inherit a body, 9 prod rows deliberately dropped.';
end $preflight$;


-- ---------------------------------------------------------------------------
-- THE REWRITE. Bodies come from the SNAPSHOT, never retyped.
-- Column shape matches prod exactly: created_by uniform, idempotency_key and
-- rollback left NULL as they are on all 133 existing rows.
-- ---------------------------------------------------------------------------
delete from supabase_migrations.schema_migrations;

insert into supabase_migrations.schema_migrations
  (version, name, statements, created_by, idempotency_key, rollback)
select
  t.version,
  t.name,
  coalesce(
    b.statements,
    array[format(
      '-- Applied before this ledger recorded it. Reconciled 2026-09-16.'||chr(10)||
      '-- The applied SQL is supabase/migrations/%s_%s.sql in the repo, and Phase 1'||chr(10)||
      '-- proved a clean replay of that file set byte-matches this database.',
      t.version, t.name)]
  ),
  'turkislimah@gmail.com',
  null,
  null
from _target t
left join supabase_migrations.schema_migrations_backup_20260916 b on b.version = t.src;


-- ---------------------------------------------------------------------------
-- VERIFICATION — RAISES ON ANY FAILURE. This is the gate, not a report.
-- To see it fail on purpose: delete one tuple from _target above and re-run.
-- ---------------------------------------------------------------------------
do $verify$
declare
  n        int;
  orphan   text;
  missing  text;
  mismatch text;
begin
  -- 1. EXACTLY 198 ROWS.
  select count(*) into n from supabase_migrations.schema_migrations;
  if n <> 198 then
    raise exception 'FAIL 1: ledger holds % rows after the rewrite, expected 198.', n;
  end if;

  -- 2. EVERY LOCAL FILE HAS EXACTLY ONE LEDGER ROW.
  select string_agg(t.version||'_'||t.name, ', ' order by t.version) into missing
    from _target t
   where (select count(*) from supabase_migrations.schema_migrations m where m.version = t.version) <> 1;
  if missing is not null then
    raise exception 'FAIL 2: file(s) without exactly one ledger row: %', missing;
  end if;

  -- 3. NO ORPHAN ROWS — nothing in the ledger that is not a file.
  select string_agg(m.version||'_'||coalesce(m.name, '<null>'), ', ' order by m.version) into orphan
    from supabase_migrations.schema_migrations m
   where not exists (select 1 from _target t where t.version = m.version);
  if orphan is not null then
    raise exception 'FAIL 3: orphan ledger row(s) with no matching file: %', orphan;
  end if;

  -- 4. NO DUPLICATES. (The primary key makes this structural; assert it anyway,
  --    because a check that cannot fail is not evidence.)
  select count(*) into n
    from (select version from supabase_migrations.schema_migrations group by version having count(*) > 1) d;
  if n <> 0 then
    raise exception 'FAIL 4: % duplicate version(s) in the ledger.', n;
  end if;

  -- 5. NAMES MATCH THE FILENAMES, not just the versions.
  select string_agg(format('%s: ledger %L vs file %L', t.version, m.name, t.name), ', ' order by t.version)
    into mismatch
    from _target t join supabase_migrations.schema_migrations m on m.version = t.version
   where coalesce(m.name, '') <> t.name;
  if mismatch is not null then
    raise exception 'FAIL 5: name drift between ledger and file: %', mismatch;
  end if;

  -- 6. EVERY VERSION IS A 4-DIGIT FILENAME PREFIX. No timestamp survived.
  select string_agg(version, ', ' order by version) into mismatch
    from supabase_migrations.schema_migrations where version !~ '^[0-9]{4}$';
  if mismatch is not null then
    raise exception 'FAIL 6: non-filename version(s) still in the ledger: %', mismatch;
  end if;

  -- 7. THE EXPECTED SHAPE: 0001..0200 with 0135 and 0136 absent, nothing else.
  select string_agg(g::text, ', ' order by g) into missing
    from generate_series(1, 200) g
   where g not in (135, 136)
     and not exists (select 1 from supabase_migrations.schema_migrations m
                      where m.version = lpad(g::text, 4, '0'));
  if missing is not null then
    raise exception 'FAIL 7: expected version(s) absent from the ledger: %', missing;
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version in ('0135', '0136')) then
    raise exception 'FAIL 7: 0135/0136 are repo gaps and must not appear in the ledger.';
  end if;

  -- 8. NOTHING LOST SILENTLY — every body we meant to carry over is present.
  select count(*) into n
    from _target t
    join supabase_migrations.schema_migrations m on m.version = t.version
    join supabase_migrations.schema_migrations_backup_20260916 b on b.version = t.src
   where md5(array_to_string(m.statements, chr(10))) = md5(array_to_string(b.statements, chr(10)));
  if n <> 124 then
    raise exception 'FAIL 8: only % of 124 inherited bodies survived the carry-over.', n;
  end if;

  raise notice 'LEDGER REWRITE VERIFIED — 198 rows, 1:1 with the 198 migration files, 0135/0136 absent, no orphans, no duplicates, names match filenames, 124/124 bodies carried across intact. Undo: supabase_migrations.schema_migrations_backup_20260916.';
end $verify$;

commit;


-- ===========================================================================
-- AFTER — read-only, run these to see the result.
-- ===========================================================================
-- select count(*) as rows,
--        min(version) as first, max(version) as last,
--        count(*) filter (where version !~ '^[0-9]{4}$') as non_filename_versions
--   from supabase_migrations.schema_migrations;
--
-- select version, name from supabase_migrations.schema_migrations order by version limit 5;
-- select version, name from supabase_migrations.schema_migrations order by version desc limit 5;
--
-- ===========================================================================
-- DO NOT run `supabase db push` after this without reading the note below.
-- ===========================================================================
-- The repo is NOT LINKED (no supabase/config.toml, no .temp/project-ref), so
-- there is no accidental-push path today. Once the ledger matches the files,
-- linking becomes safe for the FIRST time: the CLI will see 198 applied rows
-- matching 198 files and find nothing to push. Before this rewrite it would
-- have seen zero matching rows and tried to replay all 198 files — including
-- the 51 that carry top-level DML, several of them money-core. That is the
-- actual risk this rewrite retires.
