-- 0170_builtin_leave_type_labels_bilingual.sql
-- Give the four BUILT-IN leave types a stored Arabic name, so that the row —
-- not the dictionary — is the single source of what a leave type is called.
-- The exact counterpart of 0169 for the other lookup table; the two lookups
-- are one model.
--
-- APPLIED AND VERIFIED (Turki, 2026-08-29). Committed after apply, per the
-- reset incident in CLAUDE.md section 7.
--
-- Re-measured against the live table after apply, not reported: 6 rows. The
-- four built-ins carry English `label` + Arabic `label_ar` exactly as written
-- below; night_off and travel_meeting keep plain-English labels with
-- `label_ar` NULL.
--
-- *** THIS FILE REPLACES AN EARLIER, NEVER-APPLIED DRAFT UNDER THE SAME NAME ***
-- That draft MERGED both languages into `label` ("Paid leave — إجازة مدفوعة"),
-- matching the single as-typed name the app was briefly moving to. That model
-- was reversed before this ever ran, so the number was never burned and is
-- reused here for the corrected form. Nothing needs un-merging: measured live,
-- all 6 rows of `leave_types` still have `label_ar` NULL and plain-English
-- labels. Do not apply the merged form.
--
-- *** THIS MIGRATION IS THE MISSING HALF, AND THE APP IS ALREADY WAITING ON IT ***
-- LeaveSection resolves a leave type through `arText(label, label_ar, lang)`,
-- exactly as StaffTab does for roles. The dictionary block it used to read
-- (`drivers.leaveType.*` in lib/i18n.ts) is GONE. Until this runs, `label_ar`
-- is NULL on every row and `arText` falls back to `label` — so an Arabic
-- reader sees the four built-ins in ENGLISH ("Paid leave", "Sick leave",
-- "Unpaid leave", "Off duty"). That is a visible Arabic-mode regression, not a
-- cosmetic gap, and this migration is what closes it. Roles are unaffected:
-- their data was split by hand and is already correct.
--
-- *** THE ARABIC COMES FROM THE DELETED DICTIONARY — WITH ONE DELIBERATE EDIT ***
-- Three of the four are carried byte-for-byte from the `drivers.leaveType.*`
-- block at the commit before it was removed, so nothing an Arabic reader sees
-- changes. Recover and diff it with:
--   git show HEAD:lib/i18n.ts   (the `leaveType:` block)
-- `unpaid` is the exception: the dictionary said "إجازة بدون راتب" and Turki
-- applied "إجازة غير مدفوعة", which is what is in the table and on screen. The
-- statement below was corrected to match the live row AFTER the fact — the
-- database outranks the file (CLAUDE.md section 5), and re-running the
-- dictionary's wording would silently overwrite his. Same call as 0169, where
-- three role names use his shorter spellings rather than the dictionary's.
-- ONE TRAP, and it has already caught one pass: `off_duty` appears FOUR times
-- in that file. The DRIVER STATE spells it "غير مكلف" (lines 1456 and 1785);
-- the LEAVE TYPE spells it "خارج الخدمة". A file-wide grep for `off_duty`
-- returns the driver-state string first and would seed the wrong Arabic here.
-- The string below is the leave-type one, taken from inside the block.
--
-- DATA ONLY. NO SCHEMA CHANGE — `leave_types.label` is `text not null` (0012)
-- and `label_ar` is nullable text (0168).
--
-- *** THE TWO CUSTOM TYPES ARE NOT TOUCHED ***
-- By construction, not omission: every statement carries `and is_default =
-- true`, so night_off and travel_meeting cannot be hit. They have no Arabic
-- name and are not meant to — the create form takes one field, and `arText`
-- falls back to the typed label in both languages.
--
-- *** `key` IS NOT TOUCHED ***
-- `leave_periods.leave_type` is a FK to `leave_types.key`, so the key is an
-- identity, not a caption. Only the display column moves. Verified against the
-- live catalog: ZERO functions and ZERO views in `public` reference
-- leave_types at all.
--
-- Nothing here creates a table, view or function, so there is no anon-revoke
-- footer and no security_invoker footer to restate.
--
-- Run in the Supabase SQL editor (after 0169).

begin;

-- 1) The four built-ins, matched on the immutable `key`, each guarded by
--    `is_default = true`. `label` is restated alongside `label_ar` so a replay
--    from a fresh seed lands on the split form regardless of what the seed
--    wrote. Idempotent — re-running writes the same four pairs.
update public.leave_types set label = 'Paid leave',   label_ar = 'إجازة مدفوعة'    where key = 'paid'     and is_default = true;
update public.leave_types set label = 'Sick leave',   label_ar = 'إجازة مرضية'     where key = 'sick'     and is_default = true;
update public.leave_types set label = 'Unpaid leave', label_ar = 'إجازة غير مدفوعة' where key = 'unpaid'   and is_default = true;
update public.leave_types set label = 'Off duty',     label_ar = 'خارج الخدمة'     where key = 'off_duty' and is_default = true;

-- 2) VERIFY, in the same transaction, that all four landed EXACTLY — a byte
--    comparison on BOTH columns, so a mistyped Arabic half (or the driver-state
--    "غير مكلف" slipping into off_duty) fails here instead of reaching a screen.
--    If a key was ever renamed or a row deleted, the LEFT JOIN misses and the
--    row is reported as missing. Any failure raises and rolls back all four.
do $$
declare bad text;
begin
  select string_agg(
           v.k || ': ' || coalesce(quote_literal(r.label), '<row missing>')
                || ' / ' || coalesce(quote_literal(r.label_ar), 'NULL'),
           '; ' order by v.k)
    into bad
  from (values
    ('paid',     'Paid leave',   'إجازة مدفوعة'),
    ('sick',     'Sick leave',   'إجازة مرضية'),
    ('unpaid',   'Unpaid leave', 'إجازة غير مدفوعة'),
    ('off_duty', 'Off duty',     'خارج الخدمة')
  ) as v(k, expected_en, expected_ar)
  left join public.leave_types r on r.key = v.k and r.is_default = true
  where r.label is distinct from v.expected_en
     or r.label_ar is distinct from v.expected_ar;

  if bad is not null then
    raise exception 'built-in leave type label(s) wrong or missing: %', bad;
  end if;
end $$;

commit;

-- Read back (run separately, after commit). Expect the 4 built-ins split into
-- English label + Arabic label_ar, and night_off / travel_meeting plain
-- English with label_ar NULL:
--   select key, label, label_ar, is_default
--   from public.leave_types
--   order by is_default desc, key;
