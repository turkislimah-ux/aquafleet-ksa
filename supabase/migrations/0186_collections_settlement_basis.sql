-- 0186 — THE DICTIONARY STOPS CALLING SETTLEMENT "CASH"
--
-- WHY
-- ---
-- `report_metrics` is the semantic layer (0098): one row per metric, holding
-- the meaning / formula / basis / caveat that MetricsGlossaryModal renders and
-- that the report builder groups by. Its `collections` row has said `basis =
-- 'cash'` since 0098, with meaning "Cash actually received against invoices in
-- the month."
--
-- That was true when it was written and is not true now. Since prepaid landed,
-- an invoice settled with payment_method='balance' moves NO money on the day it
-- is marked paid — the cash arrived earlier, at top-up, and is already counted
-- there by the `topups` metric. Re-measured 2026-09-08 against live:
--
--     2026-07   30,532.50 settled,        none from balance
--     2026-08  109,020.00 settled,  105,225.00 from balance
--     2026-09    9,740.50 settled,    9,740.50 from balance
--
-- So in August the dictionary called 105,225.00 "cash actually received" on a
-- day no riyal moved, and in September it says it of the entire figure.
--
-- WHAT THIS DOES *NOT* DO
-- -----------------------
-- Turki's ruling stands: the Collected KPI STAYS on settlement basis ("value of
-- invoices settled this month") and ITS NUMBER DOES NOT CHANGE. This file
-- changes no view, no query, and no figure — only the WORDS describing an
-- unchanged figure, plus the enum they are filed under. v_collections_monthly
-- is not referenced here at all.
--
-- The other three `cash` metrics are deliberately LEFT ALONE, because for them
-- the word is still correct: commissions_paid and purchasing_spend are money
-- going out, and `topups` is the very row that legitimately owns the prepaid
-- cash-in event this one was double-claiming.
--
-- SPLIT FROM 0185, AND ORDER-INDEPENDENT
-- --------------------------------------
-- 0185 appends settled_same_month_revenue_sar to v_revenue_monthly and
-- v_pnl_monthly. This file touches ONE TABLE, report_metrics, and shares no
-- object with it — not a view, not a column, not a row. Neither reads the
-- other's output. They may therefore run in either order, and either may run
-- alone; they are numbered 0185 → 0186 only because that is the order Turki
-- will paste them.
--
-- NO SECURITY FOOTER, AND THAT IS MEASURED, NOT ASSUMED
-- ----------------------------------------------------
-- CLAUDE.md §6's footer rule is about `create or replace view`, which silently
-- drops reloptions and grants. This file runs `alter table … constraint` and an
-- `update` — neither touches an ACL, a reloption or a row-security setting.
-- report_metrics is a pre-existing TABLE created by 0098 (relkind 'r'), whose
-- privileges were measured against the catalog on 2026-09-08:
--
--     relkind 'r' · relrowsecurity true
--     relacl {postgres=arwdDxtm/postgres, authenticated=arwdDxtm/postgres,
--             service_role=arwdDxtm/postgres}
--     has_table_privilege('anon', …, 'select') = false
--
-- anon holds NO entry at all, and RLS is on with 0098's authenticated-read
-- policy. Adding `revoke all … from anon` here would be a no-op dressed as a
-- safeguard. The precedent is 0145, which edited this same table's `caveat` and
-- correctly carried no footer either.
--
-- RE-RUNNABLE. `drop constraint if exists` precedes the add, and the update
-- sets fixed values by primary key, so a second run is a no-op.
--
-- ORDER WITHIN THIS FILE IS NOT COSMETIC: the CHECK must be widened BEFORE the
-- update, or the update violates the constraint still in force.
--
-- BARE STATEMENTS — no begin;/commit; (CLAUDE.md §5, 0173+). The SQL Editor
-- wraps each submission in its own transaction, which is also what makes the
-- assertion block below roll the update back if it fires.

-- ---------------------------------------------------------------------------
-- 1. Widen report_metrics_basis_check to admit 'settlement'
-- ---------------------------------------------------------------------------
-- Live definition before this runs (pg_constraint, measured 2026-09-08):
--   CHECK ((basis = ANY (ARRAY['accrual'::text, 'cash'::text, 'state'::text,
--                              'operational'::text])))
-- The four existing values are reproduced in their existing order and
-- 'settlement' is inserted after 'cash', matching the reading order
-- MetricsGlossaryModal's BASIS_ORDER uses: the two look alike and are not, so
-- they sit adjacent on purpose.
--
-- The constraint stays an explicit whitelist rather than becoming free text.
-- It is what stops a typo'd basis creating a silent sixth group in the
-- glossary, and verification C below proves it still rejects one.
alter table public.report_metrics
  drop constraint if exists report_metrics_basis_check;

alter table public.report_metrics
  add constraint report_metrics_basis_check
  check (basis = any (array['accrual'::text, 'cash'::text, 'settlement'::text,
                            'state'::text, 'operational'::text]));

-- ---------------------------------------------------------------------------
-- 2. Move ONLY the `collections` row onto settlement, and fix its copy
-- ---------------------------------------------------------------------------
-- Five columns change: basis, label, meaning, formula, caveat.
-- Three do NOT: unit ('SAR'), grain ('one month'), source_view
-- ('v_collections_monthly') — the measure is unchanged, so its pointer is too.
--
-- LABEL: "Collections" → "Invoices settled". The old word names a cash event.
-- This label is also the Reports card label and a builder picker row, so it is
-- written long enough to stand alone in a list rather than only under a card.
--
-- FORMULA keeps its first sentence verbatim — the arithmetic genuinely did not
-- change — and only re-justifies the VAT-inclusive part: "what was banked" was
-- the cash claim in miniature.
--
-- CAVEAT absorbs the old one's second sentence (revenue vs collections timing,
-- still true and still worth saying) and puts the balance-settlement warning in
-- front of it. Measured 409 chars, inside the 785 that
-- MetricsGlossaryModal's header cites as the live maximum, so that file's
-- layout reasoning stays true. Apostrophes are doubled, not avoided.
update public.report_metrics set
  basis   = 'settlement',
  label   = 'Invoices settled',
  meaning = 'Value of invoices settled in the month — marked paid, whatever settled them.',
  formula = 'Sum of grand_total_sar over invoices whose paid_at falls in the month. VAT-inclusive, because it is the value of the document that was settled.',
  caveat  = 'NOT cash, and not revenue. Since prepaid, an invoice settled with payment_method=''balance'' moves no money on the day it is marked paid — the cash arrived earlier, at top-up, and is counted there by `topups`. Measured 2026-08: 105,225.00 of 109,020.00 settled from balance. Deliberately never added to revenue either: an invoice earns revenue when confirmed and is settled when paid, often in different months.'
where metric_key = 'collections';

-- ---------------------------------------------------------------------------
-- 3. ASSERT THE END STATE (a real statement, not a comment)
-- ---------------------------------------------------------------------------
-- 0145's discipline, for the same reason: report_metrics is pure description,
-- so a mistyped WHERE or a `set` list that grew a stray column shows up as
-- wrong words in a popup — the kind of error nobody reports for months. A raise
-- here aborts the editor's transaction and rolls the update back.
do $$
declare
  v_collections int;
  v_cash_left   int;
  v_caveat_len  int;
  v_total       int;
begin
  -- (1) The row moved, and moved WHOLE — every column checked, including the
  --     three that must NOT have changed.
  select count(*) into v_collections
    from public.report_metrics
   where metric_key  = 'collections'
     and basis       = 'settlement'
     and label       = 'Invoices settled'
     and unit        = 'SAR'
     and grain       = 'one month'
     and source_view = 'v_collections_monthly'
     and meaning like 'Value of invoices settled in the month%'
     and caveat  like 'NOT cash, and not revenue.%';

  if v_collections <> 1 then
    raise exception
      'The collections row is not in 0186 shape (matched % rows). Either the update did not apply, or it moved a column it was not supposed to touch - unit, grain and source_view must all be unchanged.',
      v_collections;
  end if;

  -- (2) NOTHING ELSE MOVED OFF cash. This is the half that a careless WHERE
  --     breaks silently: commissions_paid and purchasing_spend are money going
  --     OUT and topups is the row that legitimately owns the prepaid cash-in
  --     event, so all three are still correctly called cash.
  select count(*) into v_cash_left
    from public.report_metrics
   where basis = 'cash'
     and metric_key in ('commissions_paid', 'purchasing_spend', 'topups');

  if v_cash_left <> 3 then
    raise exception
      'Expected exactly 3 metrics still on cash basis (commissions_paid, purchasing_spend, topups), found %. 0186 is supposed to move ONE row.',
      v_cash_left;
  end if;

  -- (3) Exactly one row is on settlement, so the widened enum did not become a
  --     dumping ground in the same breath it was created.
  if (select count(*) from public.report_metrics where basis = 'settlement') <> 1 then
    raise exception
      'More than one metric is on settlement basis. Only collections should be.';
  end if;

  -- (4) The caveat stays inside the length MetricsGlossaryModal's stacked
  --     layout was measured against (785 chars, per that file header).
  select length(caveat) into v_caveat_len
    from public.report_metrics where metric_key = 'collections';

  if v_caveat_len > 785 then
    raise exception
      'collections.caveat is % chars, past the 785 MetricsGlossaryModal states as the live maximum. Shorten it, or re-measure and update that comment - do not leave the two disagreeing.',
      v_caveat_len;
  end if;

  -- (5) No row was added or lost. 30 measured live 2026-09-08.
  select count(*) into v_total from public.report_metrics;
  if v_total <> 30 then
    raise exception
      'report_metrics holds % rows, expected 30. 0186 inserts and deletes nothing.',
      v_total;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- VERIFICATION (run after apply; read-only except C, which must ERROR)
--
-- NOTE: the block above already asserted the end state and would have rolled
-- the update back. These are for reading with your own eyes, per CLAUDE.md §5 —
-- a migration's own result grid is a claim, the catalog is the evidence.
-- ---------------------------------------------------------------------------
--
-- A. THE WIDENED CHECK, read from the catalog. Expect the definition to list
--    five values, with 'settlement' between 'cash' and 'state'.
-- select pg_get_constraintdef(oid) as def
--   from pg_constraint
--  where conrelid = 'public.report_metrics'::regclass
--    and conname  = 'report_metrics_basis_check';
--
-- B. THE DICTIONARY GROUPS. Expect exactly two rows:
--      cash        3   commissions_paid, purchasing_spend, topups
--      settlement  1   collections
-- select basis, count(*) as n, string_agg(metric_key, ', ' order by metric_key) as keys
--   from public.report_metrics
--  where basis in ('cash', 'settlement')
--  group by basis order by basis;
--
-- C. THE CHECK STILL REJECTS A TYPO. This statement MUST ERROR with
--    "violates check constraint report_metrics_basis_check". If it succeeds,
--    the constraint was dropped and never re-added — run section 1 again.
--    (Wrap it in begin;/rollback; in the editor if you would rather not rely
--    on the failure to undo it.)
-- update public.report_metrics set basis = 'settlment' where metric_key = 'collections';
--
-- D. THE COPY ITSELF, as the glossary will print it. Read the words, not the
--    row count: this migration exists to make them true.
-- select label, basis, unit, grain, source_view, meaning, formula, caveat
--   from public.report_metrics where metric_key = 'collections';
--
-- E. NO FIGURE MOVED. This file changes no view; the Collected KPI must read
--    exactly as before — 2026-06 = 0, 2026-07 = 30,532.50,
--    2026-08 = 109,020.00, 2026-09 = 9,740.50.
-- select month, collected_gross_sar, invoices_paid
--   from public.v_collections_monthly order by month;
--
-- IN-BROWSER AFTER APPLYING: open Reports, click the glossary in the header.
-- "Invoices settled" should now appear under its own SETTLEMENT heading,
-- directly after the Cash group, carrying the balance-settlement warning. The
-- Collected card's own number must be unchanged.
