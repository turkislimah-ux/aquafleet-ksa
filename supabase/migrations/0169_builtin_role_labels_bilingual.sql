-- 0169_builtin_role_labels_bilingual.sql
-- Give the five BUILT-IN staff roles a stored Arabic name, so that the row —
-- not the dictionary — is the single source of what a role is called.
--
-- APPLIED AND VERIFIED (Turki, 2026-08-29). Committed after apply, per the
-- reset incident in CLAUDE.md section 7.
--
-- *** THIS FILE WAS REWRITTEN AFTER IT WAS APPLIED. READ THIS BEFORE REPLAYING. ***
-- The version that actually ran MERGED both languages into `label`
-- ("Fleet Manager — مدير الأسطول") and left `label_ar` NULL, because the app
-- was briefly moving to a single as-typed name for every role. That model was
-- reversed the same day: Turki split the two halves back apart directly on the
-- live database (English in `label`, Arabic in `label_ar`), and the app now
-- resolves the pair through `arText` — Arabic name in Arabic mode, English
-- otherwise. Those MCP corrections touch the database and never the repo, so
-- nothing in git would have signalled that this file had gone stale.
--
-- The statements below were rewritten to produce that corrected end state
-- rather than the merged one. Replaying them on a fresh `db reset` therefore
-- lands where the live database already is; re-running them against the live
-- database is a no-op. The merged form is NOT recoverable from this file, and
-- deliberately so — it is not a state anything should return to.
--
-- Verified against the live table after the correction, re-measured rather than
-- reported: 8 rows. The five built-ins carry plain-English `label` + Arabic
-- `label_ar` exactly as written below; the three custom roles (finance,
-- head_of_maintenance, night_dispatcher) keep plain-English labels with
-- `label_ar` NULL.
--
-- DATA ONLY. NO SCHEMA CHANGE — and none is needed. `staff_roles.label` is
-- `text not null` (0011) and `label_ar` is nullable text (0168).
--
-- *** THE THREE CUSTOM ROLES ARE NOT TOUCHED ***
-- Not by omission — by construction. Every statement below carries
-- `and is_default = true`, so a custom role cannot be hit even if it somehow
-- held one of these five keys. A custom role has NO Arabic name and is not
-- meant to: the create form takes one field, and `arText` falls back to the
-- typed label in both languages.
--
-- *** `key` IS NOT TOUCHED, AND MUST NOT BE ***
-- Four RPCs hardcode the built-in role keys as a PERMISSION GATE:
--   approve_purchase_order, reject_purchase_order,
--   approve_stock_receipt,  reject_stock_receipt
-- each with `and role in ('fleet_manager', 'ops_supervisor', 'inventory_clerk')`
-- (0052 lines 146 and 216, mirrored by the receipt pair). `staff.role` is a FK
-- to `staff_roles.key`, so the key is an identity, not a caption. Renaming a
-- key here would silently revoke a live approver's ability to approve a PO.
-- Only the display columns move. Verified against the live catalog, not from
-- notes: ZERO functions in `public` reference staff_roles or leave_types at
-- all, and ZERO views reference staff_roles, leave_types, or a `role` column.
-- Nothing in the database reads a role's display string.
--
-- *** THE ARABIC BELOW IS THE LIVE STRING, NOT THE OLD DICTIONARY'S ***
-- `drivers.role.*` in lib/i18n.ts spelled three of these differently
-- ("فني ميكانيكي", "أمين المستودع", "منسّق الحركة"). Turki wrote the shorter
-- forms when he split the data, and his spelling is the one in the table and
-- the one on screen. Do NOT "restore" the dictionary's wording.
--
-- Nothing here creates a table, view or function, so there is no anon-revoke
-- footer and no security_invoker footer to restate.
--
-- Run in the Supabase SQL editor (after 0168).

begin;

-- 1) The five built-ins, matched on the immutable `key`, each guarded by
--    `is_default = true` so the statement can never reach a custom role.
--    `label` is restated alongside `label_ar` so that a replay from a fresh
--    seed lands on the split form even if the seed wrote something else.
--    Idempotent — re-running writes the same five pairs.
update public.staff_roles set label = 'Fleet Manager',  label_ar = 'مدير الأسطول'  where key = 'fleet_manager'   and is_default = true;
update public.staff_roles set label = 'Ops Supervisor', label_ar = 'مشرف العمليات' where key = 'ops_supervisor'  and is_default = true;
update public.staff_roles set label = 'Mechanic',       label_ar = 'ميكانيكي'      where key = 'mechanic'        and is_default = true;
update public.staff_roles set label = 'Inventory Clerk',label_ar = 'أمين مستودع'   where key = 'inventory_clerk' and is_default = true;
update public.staff_roles set label = 'Dispatcher',     label_ar = 'منسّق حركة'     where key = 'dispatcher'      and is_default = true;

-- 2) VERIFY, in the same transaction, that all five landed EXACTLY. This is a
--    byte comparison on BOTH columns against the expected strings, not a
--    "looks bilingual" check, so a mistyped Arabic half fails here instead of
--    reaching a screen. If a key was ever renamed or a row deleted, the LEFT
--    JOIN misses and the row is reported as missing. Any failure raises and
--    rolls back all five updates together.
do $$
declare bad text;
begin
  select string_agg(
           v.k || ': ' || coalesce(quote_literal(r.label), '<row missing>')
                || ' / ' || coalesce(quote_literal(r.label_ar), 'NULL'),
           '; ' order by v.k)
    into bad
  from (values
    ('fleet_manager',   'Fleet Manager',   'مدير الأسطول'),
    ('ops_supervisor',  'Ops Supervisor',  'مشرف العمليات'),
    ('mechanic',        'Mechanic',        'ميكانيكي'),
    ('inventory_clerk', 'Inventory Clerk', 'أمين مستودع'),
    ('dispatcher',      'Dispatcher',      'منسّق حركة')
  ) as v(k, expected_en, expected_ar)
  left join public.staff_roles r on r.key = v.k and r.is_default = true
  where r.label is distinct from v.expected_en
     or r.label_ar is distinct from v.expected_ar;

  if bad is not null then
    raise exception 'built-in role label(s) wrong or missing: %', bad;
  end if;
end $$;

commit;

-- Read back (run separately, after commit). Expect the 5 built-ins split into
-- English label + Arabic label_ar, and the 3 custom rows plain English with
-- label_ar NULL:
--   select key, label, label_ar, is_default
--   from public.staff_roles
--   order by is_default desc, key;
