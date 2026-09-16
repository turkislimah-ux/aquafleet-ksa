-- ===========================================================================
-- PROD LEDGER BACKUP — supabase_migrations.schema_migrations — 2026-09-16
-- DRAFTED, NOT APPLIED. Run in the Supabase SQL Editor, PROD, BEFORE the
-- ledger rewrite. This file IS the undo.
-- ===========================================================================
--
-- WHY THIS IS NOT A PLAIN "INSERT ... VALUES" DUMP OF ALL SIX COLUMNS
-- ---------------------------------------------------------------------------
-- The brief asked for INSERT statements that restore the table exactly. Measured
-- on prod 2026-09-16, that file would be ~1 MB of SQL:
--
--   rows                         133
--   statements total             931,927 characters  (933,627 bytes)
--   statements largest single row 83,097 characters  (20260915114720, 0200)
--   statements shape             text[], EXACTLY ONE element on all 133 rows
--   rollback                     NULL on all 133 rows
--   idempotency_key              NULL on all 133 rows
--   name                         NOT NULL on all 133 rows
--   created_by                   'turkislimah@gmail.com' on all 133 rows
--
-- So only FOUR of the six columns actually carry data, and one of them is 912 KB
-- of SQL text that would have to be read out of the database, pass through an
-- assistant's context, and be re-typed into this file. Every one of those hops
-- can silently corrupt a character, and a corrupted undo is worse than no undo
-- because it looks like one. A truncated dump presented as "the undo" would be
-- a lie, so it is not offered.
--
-- THE DESIGN INSTEAD IS TWO-PART, AND THE EXACT HALF NEVER LEAVES THE SERVER:
--
--   PART A  THE UNDO ITSELF. A server-side snapshot table. Byte-exact, all six
--           columns, zero transport, one statement. This is what you restore
--           from.
--   PART B  THE MANIFEST. 133 x (version, name, md5 of statements, length),
--           committed to git so the undo is auditable OFF the database. If the
--           snapshot table is ever dropped or doubted, this is what proves what
--           the ledger held on 2026-09-16.
--   PART C  ROUND-TRIP PROOF. Raises unless the snapshot reproduces all 133 rows
--           and the manifest agrees with them row for row, md5 for md5.
--
-- Part C is the answer to "verify it round-trips". It is a real gate: to see it
-- fail, change any single character in the manifest below and re-run.
--
-- IF YOU WANT THE LITERAL 1 MB FILE AS WELL (optional, belt and braces), run
-- PART D at the bottom. It generates the full six-column INSERT text ON THE
-- SERVER and returns it as one value for you to save yourself. It is not
-- committed here because a 1 MB generated blob in git that nobody diffs is
-- decoration, not safety.
--
-- ---------------------------------------------------------------------------
-- PROD LEDGER FINGERPRINT AT DRAFT TIME, 2026-09-16
--   md5 over all 133 rows of version|name|created_by|idempotency_key|md5(statements)
--   = 4bdf5ea896e269cc736f80f442f08111
-- Part C recomputes this. If it does not match when you run it, the ledger
-- CHANGED between drafting and running: STOP and re-draft. Do not rewrite.
-- ===========================================================================


-- ===========================================================================
-- PART A — THE UNDO. Run this first. Idempotent-safe: refuses to clobber.
-- ===========================================================================
begin;

do $snap$
begin
  if to_regclass('supabase_migrations.schema_migrations_backup_20260916') is not null then
    raise exception
      'Snapshot supabase_migrations.schema_migrations_backup_20260916 already exists. Refusing to overwrite an existing undo. Inspect it, then drop it deliberately if it is stale.';
  end if;
end $snap$;

create table supabase_migrations.schema_migrations_backup_20260916 as
  select * from supabase_migrations.schema_migrations;

comment on table supabase_migrations.schema_migrations_backup_20260916 is
  'Pre-rewrite snapshot of the migration ledger, taken 2026-09-16 before the version reconcile (timestamps -> 0001..0200). Restore procedure: see .planning/post-deploy/prod-ledger-backup-2026-09-16.sql PART A-RESTORE.';

-- The snapshot must have caught exactly what we measured, or it is not the undo.
do $check$
declare n int; fp text;
begin
  select count(*) into n from supabase_migrations.schema_migrations_backup_20260916;
  if n <> 133 then
    raise exception 'Snapshot holds % rows, expected 133. The ledger changed since drafting. STOP.', n;
  end if;
  select md5(string_agg(version||'|'||coalesce(name,'')||'|'||coalesce(created_by,'')||'|'||
                        coalesce(idempotency_key,'')||'|'||md5(array_to_string(statements, chr(10))),
                        chr(10) order by version))
    into fp from supabase_migrations.schema_migrations_backup_20260916;
  if fp <> '4bdf5ea896e269cc736f80f442f08111' then
    raise exception 'Snapshot fingerprint % <> drafted 4bdf5ea896e269cc736f80f442f08111. The ledger changed since drafting. STOP.', fp;
  end if;
  raise notice 'SNAPSHOT OK — 133 rows, fingerprint %', fp;
end $check$;

commit;


-- ===========================================================================
-- PART A-RESTORE — THE ACTUAL UNDO. Only run this to roll the rewrite back.
-- Restores all six columns byte-exact. Commented out on purpose.
-- ===========================================================================
-- begin;
--   delete from supabase_migrations.schema_migrations;
--   insert into supabase_migrations.schema_migrations
--     select * from supabase_migrations.schema_migrations_backup_20260916;
--   do $restore$
--   declare n int; fp text;
--   begin
--     select count(*) into n from supabase_migrations.schema_migrations;
--     select md5(string_agg(version||'|'||coalesce(name,'')||'|'||coalesce(created_by,'')||'|'||
--                           coalesce(idempotency_key,'')||'|'||md5(array_to_string(statements, chr(10))),
--                           chr(10) order by version))
--       into fp from supabase_migrations.schema_migrations;
--     if n <> 133 or fp <> '4bdf5ea896e269cc736f80f442f08111' then
--       raise exception 'RESTORE FAILED: % rows, fingerprint %. Expected 133 / 4bdf5ea896e269cc736f80f442f08111.', n, fp;
--     end if;
--     raise notice 'RESTORE OK — ledger is back to its 2026-09-16 pre-rewrite state.';
--   end $restore$;
-- commit;


-- ===========================================================================
-- PART B + C — THE MANIFEST, AND THE ROUND-TRIP PROOF. Read-only. Raises.
-- ===========================================================================
-- Nothing below writes. Safe to re-run at any time, including long after the
-- rewrite, to re-prove that the snapshot still holds what git says it held.
-- ===========================================================================
do $roundtrip$
declare
  v_missing  text;
  v_extra    text;
  v_md5bad   text;
  v_lenbad   text;
  v_n        int;
  v_fp       text;
begin
  create temp table _ledger_manifest (version text, name text, stmt_md5 text, stmt_len int)
    on commit drop;

  insert into _ledger_manifest (version, name, stmt_md5, stmt_len) values
  ('20260717090430', 'v3_ledger_totals_and_hide_amount_due', '8a28c339fb71e614327bec1fa116a53d', 6440),
  ('20260717091354', 'invoice_payment_mode_snapshot', '4fb4526e3132603158ba7712ec92e5c3', 3976),
  ('20260726235247', 'receipt_vote_approvals_and_lot_fix', 'd603670638d11728517a9194cb04d2c5', 16324),
  ('20260728122843', '0060_maintenance_schema_and_create_wo', '81ec97159d665531b64d9b8b3eba5c5a', 11106),
  ('20260728224430', '0061_maintenance_lifecycle', '84e448a1e63860edc21662a8ce9691ca', 6612),
  ('20260729190540', '0063_maintenance_labor_costing', '2e22483e9eba121d6f116cb4f5d62246', 5501),
  ('20260729190555', '0064_maintenance_task_completion_gate', '9e3f01c40dd8769e5626a8301d050a9b', 1582),
  ('20260729190830', '0063_maintenance_labor_costing', '2e22483e9eba121d6f116cb4f5d62246', 5501),
  ('20260729190843', '0064_maintenance_task_completion_gate', '9e3f01c40dd8769e5626a8301d050a9b', 1582),
  ('20260729192000', '0065_maintenance_edit_and_reversal', 'd7dc107d650b7680aafb8d2f118d632e', 15377),
  ('20260729203909', '0066_edit_work_order_legacy_consumption_guard', 'ad58f4dabd96108918ce1018714cc52c', 8530),
  ('20260729211217', '0067_maintenance_part_photos', 'bbd4704f0051a705ca2c1df6ec8a4541', 2003),
  ('20260730150050', '0068_outsourced_jobs_schema_and_create', 'f3c10ae712b92bfc5b08a8ec908b5e5d', 14352),
  ('20260730150746', '0069_outsourced_jobs_lifecycle', '5274e0da7a725999d808bd70a80d00b0', 6943),
  ('20260731020519', '0070_outsourced_job_number_year_reset', '3b84237f86f06a1d9b19bb9283414cb2', 4856),
  ('20260731020526', '0071_workshop_payment_discount', '74d9387eb7efd635d2f02de93f9136c1', 459),
  ('20260731020537', '0072_outsourced_notes_and_task_gate', '46b9d6aa5b0d7efffdab3786b5abf405', 2111),
  ('20260731122305', '0073_work_order_start_date', '2699ea8c79333a1299382da91ae827ad', 14148),
  ('20260731130300', '0074_wo_number_year_reset_and_backfill', '49f06a3480d03f715df978e6d933b0d1', 8411),
  ('20260801010653', '0075_auto_update_truck_last_service', 'dc1cf8aab36af6993326e30abfb7282a', 3751),
  ('20260801014205', '0076_auto_truck_status_driver_engine', '6a559269b91d9df1ebc245e0f2bdfcf4', 8941),
  ('20260801014744', '0077_drop_driver_before_maintenance_fk', '2c2cb2cc6f03fbe4d91fb25c0fdab56c', 403),
  ('20260801180436', '0078_work_order_task_gate_parity', 'ae0389cb6bd47e5950038d1655f24b94', 1161),
  ('20260802112852', '0079_work_order_parts_only_cost', '0c0ab59ed6573f782cf3b6dc93b5b026', 17268),
  ('20260802141653', '0080_staff_commissions', '5d392b43545586e5ceed3686b37d8e5f', 2017),
  ('20260802194627', '0081_delete_work_orders', '7281b6c37c39ca6cb2ec0f3666e760c0', 1985),
  ('20260802233739', '0082_drop_prior_truck_status', '9ff2aef76166a07958e90327b5735c1a', 437),
  ('20260802235043', '0083_anon_rpc_hardening', 'b3d481cfe09b91570380283bc6c2c317', 1219),
  ('20260803220033', '0084_archive_documents', 'fb1c5200c3c66da39d86f182d202f1db', 6196),
  ('20260804004146', '0085_archive_document_identity_fields', '5ae6ae88bab729f1eb66462f3f5ee24f', 2098),
  ('20260804091616', '0086_archive_group_subject_kind', '609359406b060208a77e8740ae72a768', 1420),
  ('20260804092309', '0087_archive_document_subject_guard', '8d1a4def5e3d9485586e85d41b72e3a0', 2671),
  ('20260804183542', '0088_person_id_numbers', '05c848593bc34ee01fbf176ef03b2d52', 1206),
  ('20260804203631', '0089_archive_group_type_and_linking', '9d4412681a9b26367f6e5127cf31896e', 3456),
  ('20260804204141', '0089_archive_group_type_and_linking', '731501becd05b6776eaadcd5c3d729d2', 3925),
  ('20260804204640', '0090_drop_duplicate_linking_design', 'c8fafdd98cbcfa6ae3095b4ee99e1f4d', 669),
  ('20260804232354', '0091_truck_registration_linking', '18908e20d046eeae0b6c6ec96bd86d41', 3606),
  ('20260805091124', '0092_linked_doc_stores_no_value', '44b58b462d85b172a6966d4dd24127ab', 3400),
  ('20260805143227', '0093_exit_permits', 'c57b56a7b1c33d34ba5e7100226f5163', 22746),
  ('20260805233315', '0094_consumption_approvals', '9a930dfd09bc5fa3bd6b023ddb9ee87c', 2056),
  ('20260806001210', '0095_consumption_approvals_two_person', 'f5e064b4c755972d07668bfaa2f40b3b', 1299),
  ('20260806020704', '0097_consumption_approvals_matching_votes', '4aeb4a58e466dd7b09450db2cf0c330b', 1628),
  ('20260806020709', '0097_consumption_approvals_matching_votes', '661bcd296b8b75c391b7ac3d32e50f35', 1748),
  ('20260807001616', '0096_approval_lock_30_days', 'b6c6db48c034812331fc17f3c19fb965', 2348),
  ('20260807024659', '0098_reports_semantic_layer', '2f1cb78a9b5e95ab5f74e97d9b57af30', 25919),
  ('20260807101510', '0099_maintenance_cost_per_truck_with_os', 'eb66146a15ed130349f486242adebf70', 3785),
  ('20260807105607', '0100_pnl_by_period', '0b315ded39377850db24a0333e817542', 4898),
  ('20260807175647', '0101_operations_by_driver', 'e32a40f3197b4eb3b9825d2be203abe3', 3132),
  ('20260807183041', '0101_operations_by_driver_reapply', 'd09ac3385f6699733c6472f7a4b70043', 2886),
  ('20260809184526', '0102_global_search', '1d3e8b8546258272f62fce40c0c985ff', 20245),
  ('20260810234649', '0103_dashboard_views', 'ea5f658af7b55dc4a2cfb738dd505317', 12375),
  ('20260811000538', '0103_dashboard_views_fix', 'cc656e699f6a6817f070479fe1ec19c7', 4456),
  ('20260811000604', '0103_restore_invoker_action_items', '4fc86409dab91317e99250b83811543b', 196),
  ('20260812115503', '0104_daily_operations', 'ca49204e8788dabb32fea1ec8ba5694a', 10695),
  ('20260812122935', '0105_delivery_output_daily', 'e765ffad6c786f3e9c468a055e076b07', 3291),
  ('20260813144040', '0106_projects_costmix_drivers', '885219644df01012857946b20db6d284', 11269),
  ('20260813215312', '0107_projects_month_drivers_truck', '36733fac1b7175a660be900f41846305', 6842),
  ('20260813231041', '0108_delivered_revenue_daily', '857edab83c12e47df15162a3b0c94e5e', 3857),
  ('20260813234253', '0109_delivered_revenue_by_trip_date', '548af78b939cd22ab16f7a7ebd25c4a2', 3823),
  ('20260814173825', '0110_station_type_pricing_and_trip_fill_snapshot', '5e6b22638165ea63cb00a2da782e97ed', 2772),
  ('20260814183422', '0111_backfill_trip_filling_cost', 'a578868f42b5f9486ce6f5ddd39a0b96', 613),
  ('20260814194039', '0112_filling_cost_into_pnl', 'ae7350b5976072223c1288ebbafe07db', 11911),
  ('20260814194928', '0113_pnl_by_period_filling_bucket', '654426bc866f89006dd84a17cee1ebae', 3342),
  ('20260815101249', '0114_trips_station_water_type_guard', '4a4b8ee180b30473fea069811840abf0', 2424),
  ('20260815160122', '0115_driver_payslips', '94036e5f1a20355575fc2e0554d34e2f', 13926),
  ('20260815192752', '0116_driver_commission_by_project', '8f6d09cb623a7c4a458381ed4a901138', 6567),
  ('20260815202453', '0117_payroll_null_hire_date', 'fd3f14e4611e4b041c4c0bebc6213fbf', 2137),
  ('20260815203550', '0118_payslip_basis_net', '20e090ee00f1d44dca8e186784a2831f', 10559),
  ('20260815220801', '0119_drop_demo_truck_condition_columns', 'b95e4ea9af74bc07304f483642e82944', 341),
  ('20260816002635', '0120_fleet_state_now_drop_truck_columns', 'a12d0c0187f1896e99b75ad58e118573', 1775),
  ('20260816145205', 'retire_customers_payment_model', '4ea4bface6e817c066c403991f3e02df', 65),
  ('20260816152232', 'retire_water_stations_fill_cost', '7e31b1b67484211b39de464a6b43baf9', 66),
  ('20260816164707', '0123_dictionary_period_pointers', 'bb2675ff9d08c9e4c936908086a0bee2', 2771),
  ('20260816170225', '0124_dictionary_filling_cost', 'b4a161e7e23a5430e14924738daa313d', 1589),
  ('20260816173425', '0125_salary_history', '1349d979c7094cf39f72b9526133d09a', 7340),
  ('20260816174643', '0126_salary_baseline_immutable', '26c183f604bfc04ef5b9bfd427e8a683', 2972),
  ('20260816181031', '0127_payslip_basis_effective_salary', '49d5214b05638b680aac84fb8c47dc34', 5284),
  ('20260816182025', '0128_backfill_trip_rate_snapshot', '58be53f226417591556c9fed0b4ca637', 152),
  ('20260816193505', '0129_delivered_revenue_frozen_rate', '477ac4fc35d5945f93be8c1c2b4f05f2', 1282),
  ('20260816223132', '0130_truck_utilization', '95593e7403efadb5e27c925d9a9923dd', 5217),
  ('20260817210619', 'pay_commission_monthly', '1f49044ad3db22f59478185488af7670', 9242),
  ('20260818112615', '0132_driver_health_insurance', '5e6c3de1ebb3c6639178d096ed4be6df', 387),
  ('20260818160714', '0133_drop_driver_incidents_12mo', '0facf5d343c1385910918d09f1a1563e', 79),
  ('20260818202107', '0134_payment_method_balance', 'd6c86e284d9e1eb04c6b732c74613eb2', 3315),
  ('20260818202229', '0134b_fix_balance_guard_customer_join', '1a6cd2bed5e0afafd38af25872b53f46', 3362),
  ('20260819104705', '0137_outstanding_reflects_live_prepaid_balance', 'cfaad163ac391cc485f80e6ba770eacc', 6780),
  ('20260819104740', '0138_delete_test_z_special_charge', 'd22729560c3f07d25d4a69243e58b363', 159),
  ('20260819131425', '0139_archive_debt_guard_balance_return_writeoff', 'a422a281c377d7f6e532f876784a23f4', 15466),
  ('20260819134614', '0140_drop_unguarded_archive_project', 'b9801a458cd59c4f038b76e1a6457973', 326),
  ('20260820121635', 'net_balance_returns', '1bc88248ebadac73d151ce66b7aa8394', 3865),
  ('20260820123504', 'restore_customer_reverse_write_off', '0e9ada08e5a678b32b8ce9744ba45d3f', 17965),
  ('20260820202551', 'drop_write_off_payment_mode', '0664743593dac101628a5c8f8f1b1a6f', 4482),
  ('20260820214605', 'operations_metric_caveat', 'e03c67842efa5aa7b1e5a6c037d3bf19', 2461),
  ('20260821104801', 'project_commission_history', '387ff112118fd9254395ac7e74f84129', 9203),
  ('20260821112212', 'project_commission_sync_trigger', '39681d8bf9e4278d961cfe66e2563593', 9485),
  ('20260821214457', 'set_project_commission', '2c4682152277a349c3009ea8339fdebb', 15664),
  ('20260821214804', 'v_project_commission_now', 'd739735ad44a669a6ee3e971e561c164', 5650),
  ('20260821220213', 'update_project_stops_writing_commission', '722f7990067dcb907dd38d11187b0efc', 9855),
  ('20260822182954', 'update_project_commission_params_defaulted', '1c50f6f7828f65ec45d8ecb87d4d911a', 13505),
  ('20260822201627', 'trip_commission_terms_freeze', '3d1aaad083c3d51a8e51d484d6360f14', 11806),
  ('20260822211740', 'update_project_drop_commission_params', 'a231aebdf41191095555b9c39af8a55a', 11546),
  ('20260823134748', 'notifications_data_layer', '46e1aa625ea1f63d41df81e7c20a91f8', 18758),
  ('20260823142124', 'notification_blue_event_branches', 'b920795cc1151a0395c3bc618f678e5f', 13050),
  ('20260823142811', 'leave_return_yellow_excludes_today', '93ff2ebc0e0844265053be53a88e3e2b', 13115),
  ('20260823163332', 'issue_reports', '040c3ecbc87562e277b72541de05c664', 4996),
  ('20260823174511', 'notification_thresholds_per_user', '37f0f7b9ee2522dc6b5e51b685cf0d6f', 15448),
  ('20260823200023', 'user_profiles', 'e10f1229943f5c41d62cb3dfd8935580', 5427),
  ('20260823220730', 'drop_notification_events', '1e48f20d8d9cb1a411183a781a8adcbf', 2110),
  ('20260823223252', 'revoke_anon_grants_public', 'ca29fe393b939b0a6e009fe8e31034e4', 681),
  ('20260823235411', 'revoke_anon_default_privileges', 'f88ff4efff001f022891fc319ce3f725', 459),
  ('20260824000504', 'cleanup_policy_fixes', '8a89dde9239ef27de48193f7a9e12c8f', 1076),
  ('20260824075431', 'revoke_public_execute_money_rpcs', '101acca638c125fdb0c3c0493b6054ad', 990),
  ('20260824084056', 'revoke_public_execute_guarded_rpcs', '282ce328c784645f9967796d6f2bae28', 735),
  ('20260824094501', 'dashboard_action_items_respect_warning_days', 'e55e191128bd111f76644806ca16d1b7', 4457),
  ('20260824111246', 'deferred_deliveries', 'b556f30659db2616782340eb9849777b', 3862),
  ('20260824231520', 'cost_views_ex_vat_and_archive_date_aware', 'a1d4a656b5e51e2ccb6e71b11e41f602', 35253),
  ('20260907234127', 'within_month_collection_rate', '3bcf944380c1674643a8ab475800289b', 4777),
  ('20260907234307', 'collections_settlement_basis', 'fc6f82fe31f59dc550fe0a620dda7734', 3105),
  ('20260908133816', 'report_metrics_balance_terms', 'cfa7d9554224933756327c4bf85d19f5', 5012),
  ('20260908222647', 'drop_drivers_active', '1d9c7673c4f4d7106b7c3380d0ef041f', 5238),
  ('20260909194055', 'riyadh_date_buckets', 'ee2105494749467bcd8e9330f4597a74', 28147),
  ('20260909212041', 'vat_rate_constant', 'f8664436ce1a5d68e6d69bf74f43a7b0', 27803),
  ('20260909212807', 'confirm_invoice_totals_assert', 'a561e8358ad72311c90ea80a7b6dcc3b', 16923),
  ('20260910134608', 'security_parity', 'ad59a96bb754cfa18886938ce04ab467', 5785),
  ('20260910140328', 'function_execute_lockdown', '0bd8e4610cc633ed6761eab0cc0d47b5', 4322),
  ('20260910144735', 'schema_convergence', 'eaf79a8fa1ade65afe031fb13a4cbc6c', 8028),
  ('20260910185429', 'drop_stale_create_purchase_order_overload', '11fb63ff2fbc3c87835a14ee1f0fe0c3', 1790),
  ('20260910185821', 'reconcile_0193_trigger_fn_text', 'e7ed767e305138ab4399e22e0a0243e2', 2454),
  ('20260914094631', 'payout_document_number', '8498742318ebbe589afe59e77c4afcd6', 12404),
  ('20260914193945', 'exit_permit_cost_recognition', 'b098b5284d8b7ca86ee0eac1283d74c9', 5007),
  ('20260914201656', 'notification_thresholds_read_only', 'b437f41fdfe63809121547eb49f045a7', 4372),
  ('20260914205423', 'views_read_only_for_authenticated', '6adc9557ebe694ec396446c6315dbac3', 4401),
  ('20260915114720', 'exit_permit_write_offs', '5510750185b92de858da8203478a74d6', 83097);

  -- 1. The manifest itself is the right size and has no duplicate keys.
  select count(*) into v_n from _ledger_manifest;
  if v_n <> 133 then
    raise exception 'MANIFEST FAIL: % rows in the committed manifest, expected 133.', v_n;
  end if;
  select count(*) into v_n from (select version from _ledger_manifest group by version having count(*) > 1) d;
  if v_n <> 0 then
    raise exception 'MANIFEST FAIL: % duplicate version(s) in the committed manifest.', v_n;
  end if;

  -- 2. Every manifest row exists in the snapshot, and vice versa.
  select string_agg(m.version||' '||m.name, ', ' order by m.version) into v_missing
    from _ledger_manifest m
   where not exists (select 1 from supabase_migrations.schema_migrations_backup_20260916 b
                      where b.version = m.version);
  if v_missing is not null then
    raise exception 'ROUND-TRIP FAIL: manifest rows absent from the snapshot: %', v_missing;
  end if;

  select string_agg(b.version||' '||coalesce(b.name,'<null>'), ', ' order by b.version) into v_extra
    from supabase_migrations.schema_migrations_backup_20260916 b
   where not exists (select 1 from _ledger_manifest m where m.version = b.version);
  if v_extra is not null then
    raise exception 'ROUND-TRIP FAIL: snapshot rows absent from the manifest: %', v_extra;
  end if;

  -- 3. Content agrees: name, md5 of the statements body, and its length.
  select string_agg(format('%s (manifest %s / snapshot %s)', m.version, m.stmt_md5,
                           md5(array_to_string(b.statements, chr(10)))), ', ' order by m.version)
    into v_md5bad
    from _ledger_manifest m
    join supabase_migrations.schema_migrations_backup_20260916 b on b.version = m.version
   where md5(array_to_string(b.statements, chr(10))) <> m.stmt_md5
      or coalesce(b.name, '') <> m.name;
  if v_md5bad is not null then
    raise exception 'ROUND-TRIP FAIL: statements md5 or name disagrees on: %', v_md5bad;
  end if;

  select string_agg(format('%s (manifest %s / snapshot %s)', m.version, m.stmt_len,
                           length(array_to_string(b.statements, chr(10)))), ', ' order by m.version)
    into v_lenbad
    from _ledger_manifest m
    join supabase_migrations.schema_migrations_backup_20260916 b on b.version = m.version
   where length(array_to_string(b.statements, chr(10))) <> m.stmt_len;
  if v_lenbad is not null then
    raise exception 'ROUND-TRIP FAIL: statements length disagrees on: %', v_lenbad;
  end if;

  -- 4. The whole-table fingerprint still matches what was drafted.
  select md5(string_agg(version||'|'||coalesce(name,'')||'|'||coalesce(created_by,'')||'|'||
                        coalesce(idempotency_key,'')||'|'||md5(array_to_string(statements, chr(10))),
                        chr(10) order by version))
    into v_fp from supabase_migrations.schema_migrations_backup_20260916;
  if v_fp <> '4bdf5ea896e269cc736f80f442f08111' then
    raise exception 'ROUND-TRIP FAIL: snapshot fingerprint % <> drafted 4bdf5ea896e269cc736f80f442f08111.', v_fp;
  end if;

  raise notice 'ROUND-TRIP PROVED — 133/133 rows, names, statements md5 and length all agree between the committed manifest and the server-side snapshot. Fingerprint %. The undo is real.', v_fp;
end $roundtrip$;


-- ===========================================================================
-- PART D — OPTIONAL. Generate the literal six-column INSERT dump server-side.
-- ===========================================================================
-- Returns ONE text value containing the whole ~1 MB restore script. Save it
-- yourself from the SQL Editor if you want an off-database copy of the bodies.
-- Not committed: see the header for why.
-- ---------------------------------------------------------------------------
-- select 'begin;' || chr(10)
--     || 'delete from supabase_migrations.schema_migrations;' || chr(10)
--     || string_agg(
--          format('insert into supabase_migrations.schema_migrations (version, name, statements, created_by, idempotency_key, rollback) values (%L, %L, %L::text[], %L, %L, %L::text[]);',
--                 version, name, statements, created_by, idempotency_key, rollback),
--          chr(10) order by version)
--     || chr(10) || 'commit;'
--   from supabase_migrations.schema_migrations_backup_20260916;
