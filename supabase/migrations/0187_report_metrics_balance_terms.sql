-- 0187 — register the three BALANCE TERMS in report_metrics.
--
-- WHAT THIS FILE DOES: adds three rows to the metric REGISTRY —
-- paid_up_balance, running_balance, amount_payable — so the Metrics Dictionary
-- lists the three customer-balance numbers the Finance tab shows. Nothing else.
-- No new columns, no schema change, no view, no function.
--
-- WHAT AN EARLIER DRAFT OF THIS NUMBER DID, AND WHY IT WAS REPLACED. That draft
-- added five nullable Arabic columns — label_ar, meaning_ar, formula_ar,
-- grain_ar, caveat_ar — and translated all 30 existing rows into them, 640
-- lines. It was dropped whole on Turki's ruling: the app's words live in
-- lib/i18n.ts with every other translated string, and the Arabic it authored
-- moved there verbatim under `reports.metricDef.<metric_key>`. A translation
-- split across a dictionary and five database columns has two edit paths, two
-- review paths and no compiler — `tsc` stops a missing key, nothing stops a
-- missing column value — and it made the Arabic un-reviewable in a diff.
--
-- SO THE DIVISION OF LABOUR IS: this table says WHICH METRICS EXIST and what
-- SHAPE each one is (metric_key, basis, unit, grain-as-a-machine-value,
-- source_view); lib/i18n says what each one is CALLED and what it MEANS, in
-- both languages. metric_key is the join between the two.
--
-- WHY THE ENGLISH PROSE COLUMNS ARE STILL POPULATED HERE, when the popup reads
-- its words from i18n. Two independent reasons, either sufficient:
--   1. label, meaning, formula and grain are NOT NULL on this table (only
--      caveat is nullable — measured on the live catalog 2026-09-08, not read
--      off an older migration). An insert cannot omit them.
--   2. metricText() in lib/reports falls through reader's-language → English
--      key → THE ROW'S OWN COLUMN. That last step is what makes a metric
--      registered before its copy is keyed render English rather than a blank,
--      which is the same promise basisLabel() already makes. caveat is included
--      for that reason rather than because a constraint demands it.
-- The 30 existing rows' English columns are NOT dropped in this pass, for the
-- same reason: they are that fall-through, not dead weight.
--
-- THE ENGLISH BELOW IS BYTE-IDENTICAL TO THE `en` SIDE OF THE MATCHING i18n
-- KEYS. That is not decoration — it is what makes the fall-through invisible
-- when it fires. Asserted by scripts/metric-copy-check.ts.
--
-- ALL THREE ARE `settlement` BASIS (0185/0186's fifth value) AND NONE IS A
-- VIEW. Their source_view cites a TypeScript function and says so in the value
-- itself, because a reader who takes "lib/prepaid.ts" for a relation name will
-- go looking in the catalog for something that is not there. There IS a view
-- called v_customer_amount_payable (0139) and the amount_payable row
-- deliberately does not cite it: for a prepaid customer that view returns the
-- RUNNING BALANCE, not this column, and that divergence is load-bearing —
-- return_customer_balance() gates a real cash refund on it. Citing it here
-- would teach the wrong lookup.
--
-- THE IDENTITY paid-up = running - payable IS STATED IN ALL THREE CAVEATS on
-- purpose: whichever row a reader lands on first, they learn the other two
-- exist and how they relate.
--
-- NO SECURITY FOOTER, AND THAT IS FROM THE CATALOG, NOT FROM PRECEDENT. Read
-- 2026-09-08: report_metrics is relkind 'r' — a TABLE, so CLAUDE.md §6's
-- `create or replace view` footer rule does not apply, and this file replaces
-- no function either. RLS is on with one policy; relacl carries no anon entry
-- and has_table_privilege('anon', 'public.report_metrics', 'select') is false,
-- so a `revoke all ... from anon` line would be a verified no-op on an existing
-- table. §6's per-table revoke is for NEW tables; this creates none.
--
-- ON CONFLICT DO UPDATE makes the file re-runnable, and makes a second run
-- correct a hand-edited row back to this text — which is the point of keeping
-- the registry in a migration rather than typing it into the table.
--
-- BARE STATEMENTS — no begin/commit (CLAUDE.md §5, the 0173 boundary). The SQL
-- Editor runs the whole submission in one transaction, which is also what makes
-- the assertion at the bottom able to roll this file back.

insert into public.report_metrics
  (metric_key, label, meaning, formula, unit, grain, source_view, basis, caveat)
values
  ('paid_up_balance',
   'Paid-up balance',
   'A prepaid customer''s deposits minus what PAID invoices have settled, minus refunds. Not the spendable pool.',
   'paidUpCore in lib/prepaid.ts: sum of customer_topups, minus the consumption settled by invoices whose status is paid, minus customer_balance_returns. Deducts at PAYMENT, not at delivery.',
   'SAR',
   'one customer, at an instant',
   'lib/prepaid.ts: paidUpBalance() · paidUpBalanceAsOf() — a FUNCTION, not a database view',
   'settlement',
   'Not a period measure and not a view: it is computed in the app, per customer, for the instant you are looking at. paid-up = running - payable, so this is the running balance with the not-yet-settled work added back. A customer can hold pool credit and still owe on Amount Payable at the same time; that is the model, not a discrepancy. Prepaid only — a postpaid customer has no pool. Never place it in a period column or on a monthly trend line.'),

  ('running_balance',
   'Running Balance',
   'The spendable pool: a prepaid customer''s deposits minus every delivered trip and charge, minus refunds.',
   'derivedBalanceItems in lib/prepaid.ts: credits (all top-ups) minus debits (delivered trips and non-void special charges, VAT-inclusive at the project rate) minus balance returns. Model A — deducted at DELIVERY, not at invoice and not at payment. The credit side carries no date gate; asOfDate scopes consumption only.',
   'SAR',
   'one customer, at an instant',
   'lib/prepaid.ts: derivedBalanceItems() · buildStatementItems() — a FUNCTION, not a database view',
   'settlement',
   'Not a period measure and not a view: it is computed in the app, per customer, for the instant you are looking at. paid-up = running - payable. It moves the moment a trip is DELIVERED, before any invoice exists, so it can and does differ from what the invoice documents say. A customer can hold pool credit here and still owe on Amount Payable at the same time. Prepaid only — a postpaid customer has no pool. The pool is a lifetime net: no date gate is ever applied to top-ups or returns.'),

  ('amount_payable',
   'Amount Payable',
   'What the customer still owes for work already provided: delivered trips and special charges not yet on a PAID invoice.',
   'computeAmountPayable in app/trips/amountPayable.ts: derivedBalanceItems run with an EMPTY credits side over the delivered trips and non-void special charges that are not on a paid invoice, VAT-inclusive at the project rate. Negative means owed to us, zero means settled; <= 0 by construction.',
   'SAR',
   'one customer, at an instant',
   'app/trips/amountPayable.ts: computeAmountPayable() — a FUNCTION, not a database view',
   'settlement',
   'One rule for BOTH payment modes. Only marking an invoice PAID reduces it — a prepaid top-up does not, because a deposit funds the work rather than settling it. That is true by construction: the credits side is passed empty. paid-up = running - payable, so a customer can hold pool credit and owe here at the same time; that is the model, not a discrepancy. DO NOT read this from v_customer_amount_payable: for a prepaid customer that view returns the RUNNING BALANCE, not this column, and the divergence is deliberate because return_customer_balance() gates a real cash refund on it. Not a period measure and not a view.')
on conflict (metric_key) do update set
  label       = excluded.label,
  meaning     = excluded.meaning,
  formula     = excluded.formula,
  unit        = excluded.unit,
  grain       = excluded.grain,
  source_view = excluded.source_view,
  basis       = excluded.basis,
  caveat      = excluded.caveat;

-- ---------------------------------------------------------------------------
-- ASSERT THE END STATE (a real statement, not a comment)
-- ---------------------------------------------------------------------------
-- 0145's and 0186's discipline, for the same reason: report_metrics is pure
-- description, so a mistyped key or a VALUES row that lost a column shows up as
-- wrong words in a popup — the kind of error nobody reports for months. A raise
-- here aborts the editor's transaction and rolls the whole file back.
--
-- THE CAVEAT COUNT IS ASSERTED, NOT PRINTED. Exactly two rows carry no caveat
-- (operating_profit, os_cost) and this file adds none to that set. That number
-- is the one the dictionary's i18n block mirrors — 31 caveat keys for 33
-- metrics — so if it moves here and not there, one side is lying about which
-- metrics carry a warning. scripts/metric-copy-check.ts holds the other half.
do $$
declare
  v_total    int;
  v_added    int;
  v_no_cav   int;
  v_settle   int;
begin
  select count(*) into v_total from public.report_metrics;

  select count(*) into v_added
  from public.report_metrics
  where metric_key in ('paid_up_balance', 'running_balance', 'amount_payable');

  select count(*) into v_no_cav
  from public.report_metrics where caveat is null;

  select count(*) into v_settle
  from public.report_metrics where basis = 'settlement';

  if v_added <> 3 then
    raise exception '0187: expected 3 balance-term rows, found %', v_added;
  end if;

  if v_total <> 33 then
    raise exception '0187: expected 33 metrics after insert, found %', v_total;
  end if;

  -- operating_profit and os_cost, and nothing else. Named rather than counted,
  -- because "2" would also be satisfied by two DIFFERENT rows losing theirs.
  if v_no_cav <> 2
     or exists (select 1 from public.report_metrics
                where caveat is null
                  and metric_key not in ('operating_profit', 'os_cost')) then
    raise exception '0187: caveat must be null on exactly operating_profit and os_cost, found % null', v_no_cav;
  end if;

  -- MEASURED, NOT ASSUMED (2026-09-08): `settlement` currently holds exactly
  -- ONE row — `collections`, moved there by 0186 — so these three make four.
  -- The whole basis census today is accrual 21, cash 3, operational 3,
  -- settlement 1, state 2. A drift here means one of the new rows took the
  -- wrong basis and would render under the wrong heading in the dictionary.
  if v_settle <> 4 then
    raise exception '0187: expected 4 settlement-basis metrics, found %', v_settle;
  end if;

  raise notice '0187 ok: % metrics, 3 balance terms, % settlement-basis, caveat null on 2', v_total, v_settle;
end $$;
