-- 0137 — outstanding for a PREPAID customer reflects the CURRENT balance, not a
-- stale confirm-time snapshot. **APPLIED 2026-08-19, VERIFIED. VIEWS ONLY — no
-- table, no column, no RPC, no data row is touched.**
--
-- VERIFIED ON APPLY, all six blocks below green: 026-000009 frozen 4,243.50 ->
-- outstanding 0.00 on basis 'live_prepaid_balance' and gone from
-- v_receivables_open; ZERO cap violations; postpaid 026-000002 unchanged at
-- 3,795.00; ZERO double-count; v_receivables_open 2 rows / 8,038.50 -> 1 row /
-- 3,795.00; all three views security_invoker and anon-locked.
--
-- IT FAILED ITS FIRST APPLY, AND THE REASON IS WRITTEN AT THE CAST THAT FIXED
-- IT (see v_invoice_outstanding_live's outstanding_sar below). Short version:
-- **42P16 HAS TWO FACES.** The known one is append-only — create or replace
-- view cannot insert, reorder or rename a column (cost 0112 an apply cycle).
-- The second is that it cannot CHANGE A COLUMN'S TYPE either: this file
-- re-sourced outstanding_sar from a least()/greatest() CASE, whose arithmetic
-- drops the numeric(12,2) typmod that 0098 inherited from a bare
-- invoices.amount_due_sar reference. The draft's own header asserted the first
-- nine columns were byte-identical in NAME, ORDER and TYPE; name and order had
-- been checked, TYPE had not. Check all three.
--
-- ============================================================================
-- THIS IS THE MONEY-REPORTING FIX. Read the RULE section before the SQL.
-- Everything below is derived; nothing is stored, so applying it changes no
-- invoice, no balance, and no frozen document — only what the reports SAY.
-- ============================================================================
--
-- THE DEFECT, in one live row. Invoice 026-000009 (customer de4b1ffc) stores
-- amount_due_sar = 4,243.50, frozen when it was confirmed. That figure was TRUE
-- on the day: the customer's prepaid pool did not reach those trips. The
-- customer has since topped up and today holds +11,895.00 of credit — the same
-- trips are fully covered by the live FIFO walk. But v_receivables_open reads
-- i.amount_due_sar directly, so every outstanding-money surface in the app
-- reports 4,243.50 owed by a customer sitting on 11,895.00 of their own money.
-- The report lies, and it lies in the direction that invents a receivable.
--
-- WHY THE FROZEN FIGURE IS NOT ITSELF WRONG. A confirmed invoice is a document.
-- Its Amount Due is what was owed at issue, and it is never rewritten (0038 /
-- 0090 / 0109 precedent, and the whole frozen-snapshot model). This migration
-- does NOT touch invoices.amount_due_sar, the snapshot columns, or anything a
-- customer has already been handed. **The document stays frozen; the REPORT
-- becomes current.** Those are two different questions and this file keeps them
-- apart:
--
--   * "What did we bill on this document?"  -> invoices.amount_due_sar (frozen)
--   * "What is still owed to us TODAY?"     -> v_invoice_outstanding_live (new)
--
-- ---------------------------------------------------------------------------
-- THE RULE. OUTSTANDING IS A CAP ON THE FROZEN FIGURE, NEVER A RE-DERIVATION.
--
--   prepaid   : outstanding = least(frozen, greatest(0, shortfall - already_taken))
--   otherwise : outstanding = frozen                     (byte-unchanged)
--
-- where shortfall = greatest(0, -balance) — the amount by which the customer's
-- prepaid pool is overdrawn TODAY — and already_taken is the sum of frozen
-- Amount Due on this customer's OTHER confirmed-unpaid invoices that come
-- earlier in the allocation order.
--
-- **THE CAP IS THE SAFETY PROPERTY.** least(frozen, ...) means this view can
-- only ever REDUCE a receivable, never invent one. A customer whose pool is
-- deeply overdrawn keeps every riyal of every frozen figure and nothing moves.
--
-- WHY A CAP AND NOT A CLEAN RE-DERIVATION FROM THE SHORTFALL. That was drafted
-- and rejected on measured data: customer 8f119304 is overdrawn 49,440.00 while
-- its confirmed-unpaid invoice 026-000011 stores amount_due_sar = 0.00 (its own
-- document says nothing is due — the balance covered it at issue). A raw
-- shortfall would print 49,440.00 outstanding against a document that says
-- 0.00, i.e. it would CONTRADICT AN ISSUED DOCUMENT to fix a report. The cap
-- makes that structurally impossible: 026-000011 stays 0.00.
--
-- ALLOCATION IS NEWEST-FIRST, AND THAT IS NOT A COIN FLIP. The FIFO pool drains
-- OLDEST-first (lib/prepaid.ts), so a later top-up settles the oldest
-- outstanding work first and whatever shortfall survives belongs to the NEWEST
-- invoices. Allocating oldest-first would leave the oldest invoice unpaid and
-- clear the newest — backwards, and it would move money between two invoices
-- that are both real.
--
-- WHY THE BALANCE CAN BE COMPUTED IN SQL AT ALL. **The prepaid BALANCE is a
-- plain sum, not a FIFO walk** — topups minus the VAT-inclusive consumption of
-- every delivered trip and every charge on a non-void invoice. FIFO only
-- decides the covered/unpaid SPLIT, which this file does not need and does not
-- reimplement. That is the single fact that makes this a view instead of a
-- server round-trip.
-- ---------------------------------------------------------------------------
--
-- WHAT MUST NOT BE DONE INSTEAD, so it is not "helpfully" tried:
--   * DO NOT rewrite invoices.amount_due_sar for a confirmed invoice. That is
--     the document, and a settled-by-later-topup invoice is not a mis-issued
--     one.
--   * DO NOT add the prepaid balance to per-invoice amount_due anywhere. The
--     balance ALREADY has every trip and every charge deducted from it; adding
--     it to a figure derived from those same items double-counts. This file
--     derives prepaid outstanding from the balance ALONE and never mixes the
--     two bases.
--   * DO NOT touch v_revenue_invoices. It is in the P&L chain
--     (v_daily_operations, v_revenue_monthly, v_revenue_per_truck_monthly,
--     v_pnl_monthly). Its amount_due_sar column stays the frozen figure; the
--     two TypeScript readers of it join to the new view instead. See the APP
--     HALF section at the bottom.
--   * DO NOT mark a prepaid invoice paid_at just because the balance covers it.
--     Payment is an event someone records; coverage is a derived state.

begin;

-- ---------------------------------------------------------------------------
-- 1. v_customer_prepaid_balance — the SQL mirror of derivedBalanceItems.
--
-- **THIS IS A SECOND EXPRESSION OF A MONEY RULE AND IT IS DECLARED AS ONE.**
-- lib/prepaid.ts is the primary; this view exists because the receivables views
-- are SQL and cannot call it. The convention it copies, exactly:
--
--   * per-item VAT-inclusive, ROUNDED PER ITEM: round(amount * 1.15, 2), then
--     summed. NOT sum-then-round — that disagrees by riyals on a real pool.
--   * a trip consumes at DELIVERY (delivered_at is not null) and is priced at
--     coalesce(trips.rate_sar, projects.rate_per_trip_sar) — the frozen rate
--     first, the project rate only as the fallback (0128 / d0813b9). A trip
--     reaches its customer through projects.customer_id; trips.customer_id is
--     NULL on every row and must never be used here.
--   * a special charge consumes the instant it is on a NON-VOID invoice —
--     draft included, covered or not. Its parent's status only matters for
--     'void'.
--
-- IF ANY OF THOSE CHANGE IN lib/prepaid.ts, THEY CHANGE HERE IN THE SAME
-- COMMIT. Verification block D below is the drift check that catches it.
-- ---------------------------------------------------------------------------
create or replace view public.v_customer_prepaid_balance as
select
  c.id as customer_id,
  c.name as customer_name,
  coalesce((
    select sum(tp.amount_sar)
      from public.customer_topups tp
     where tp.customer_id = c.id
  ), 0)::numeric as topups_sar,
  coalesce((
    select sum(round(coalesce(t.rate_sar, p.rate_per_trip_sar) * 1.15, 2))
      from public.trips t
      join public.projects p on p.id = t.project_id
     where p.customer_id = c.id
       and t.delivered_at is not null
  ), 0)::numeric as trip_consumption_sar,
  coalesce((
    select sum(round(sc.amount_sar * 1.15, 2))
      from public.invoice_special_charges sc
      join public.invoices i on i.id = sc.invoice_id
     where i.customer_id = c.id
       and i.status <> 'void'
  ), 0)::numeric as charge_consumption_sar,
  (
    coalesce((
      select sum(tp.amount_sar)
        from public.customer_topups tp
       where tp.customer_id = c.id
    ), 0)
    - coalesce((
      select sum(round(coalesce(t.rate_sar, p.rate_per_trip_sar) * 1.15, 2))
        from public.trips t
        join public.projects p on p.id = t.project_id
       where p.customer_id = c.id
         and t.delivered_at is not null
    ), 0)
    - coalesce((
      select sum(round(sc.amount_sar * 1.15, 2))
        from public.invoice_special_charges sc
        join public.invoices i on i.id = sc.invoice_id
       where i.customer_id = c.id
         and i.status <> 'void'
    ), 0)
  )::numeric as balance_sar
from public.customers c;

alter view public.v_customer_prepaid_balance set (security_invoker = true);
revoke all on public.v_customer_prepaid_balance from anon;
grant select on public.v_customer_prepaid_balance to authenticated;

comment on view public.v_customer_prepaid_balance is
  'Prepaid balance per customer: topups minus VAT-inclusive consumption of '
  'delivered trips and of special charges on non-void invoices. A SQL mirror of '
  'lib/prepaid.ts derivedBalanceItems — safe because the BALANCE is a plain sum, '
  'not a FIFO walk (FIFO only decides the covered/unpaid split, which this view '
  'does not compute). Rounds PER ITEM at 1.15, as the engine does. Positive = '
  'credit held; negative = overdrawn. Applies to every customer; it is only '
  'MEANINGFUL for prepaid ones, and v_invoice_outstanding_live is what enforces '
  'that. Change this only in lockstep with lib/prepaid.ts (0137).';

-- ---------------------------------------------------------------------------
-- 2. v_invoice_outstanding_live — the rule, per confirmed-unpaid invoice.
--
-- MODE RESOLUTION IS A BYTE-COPY OF 0134's pay_invoice() GUARD: the frozen
-- snapshot (invoices.payment_mode, 0037) first, else the customer's projects
-- via count(distinct payment_mode) = 1 so a mixed OR absent set resolves to
-- NULL. **UNKNOWN IS NOT PREPAID AND THEREFORE KEEPS THE FROZEN FIGURE** —
-- failing closed here means never suppressing a receivable we cannot prove is
-- settled. A resolution that differed from the guard's would let the money path
-- and the reporting path disagree about the same customer.
--
-- outstanding_basis is the audit column: 'frozen' or 'live_prepaid_balance'. It
-- is what lets a reader see WHY a figure moved without re-deriving the rule.
-- ---------------------------------------------------------------------------
create or replace view public.v_invoice_outstanding_live as
with open_invoices as (
  select
    i.id            as invoice_id,
    i.invoice_number,
    i.customer_id,
    i.confirmed_at,
    i.period_end,
    i.amount_due_sar as frozen_amount_due_sar,
    coalesce(i.payment_mode, pm.resolved_mode) as effective_payment_mode
  from public.invoices i
  left join lateral (
    select case
             when count(distinct p.payment_mode) = 1 then min(p.payment_mode)
           end as resolved_mode
      from public.projects p
     where p.customer_id = i.customer_id
       and p.payment_mode is not null
  ) pm on true
  where i.confirmed_at is not null
    and i.paid_at is null
    and i.voided_at is null
), allocated as (
  select
    o.*,
    b.balance_sar,
    greatest(0, -b.balance_sar) as shortfall_sar,
    -- NEWEST-FIRST cumulative frozen Amount Due, this invoice included. The
    -- id tiebreak exists so two invoices confirmed in the same instant cannot
    -- swap places between two runs of the same query.
    sum(o.frozen_amount_due_sar) over (
      partition by o.customer_id
      order by o.confirmed_at desc, o.invoice_number desc, o.invoice_id desc
      rows between unbounded preceding and current row
    ) as cum_frozen_newest_first
  from open_invoices o
  join public.v_customer_prepaid_balance b on b.customer_id = o.customer_id
)
select
  a.invoice_id,
  a.invoice_number,
  a.customer_id,
  a.confirmed_at,
  a.period_end,
  a.frozen_amount_due_sar,
  a.effective_payment_mode,
  a.balance_sar,
  a.shortfall_sar,
  -- ::numeric(12,2) IS LOAD-BEARING, NOT COSMETIC. v_receivables_open.outstanding_sar
  -- is already numeric(12,2) live, because 0098 selected invoices.amount_due_sar --
  -- a bare column reference inherits the column's typmod. least()/greatest() do NOT
  -- propagate typmod, so an uncast CASE yields bare numeric and
  -- `create or replace view` refuses the replacement with 42P16: "cannot change data
  -- type of view column". That is the SECOND face of 42P16 -- the append-only rule
  -- (which cost 0112 an apply cycle) is the first. This cost 0137 one. The whole CASE
  -- is wrapped so BOTH branches are pinned, including the else that just re-selects
  -- the already-typed frozen column.
  (case
    when a.effective_payment_mode = 'prepaid'
      then least(
             a.frozen_amount_due_sar,
             greatest(0, a.shortfall_sar - (a.cum_frozen_newest_first - a.frozen_amount_due_sar))
           )
    else a.frozen_amount_due_sar
  end)::numeric(12,2) as outstanding_sar,
  case
    when a.effective_payment_mode = 'prepaid' then 'live_prepaid_balance'
    else 'frozen'
  end as outstanding_basis
from allocated a;

alter view public.v_invoice_outstanding_live set (security_invoker = true);
revoke all on public.v_invoice_outstanding_live from anon;
grant select on public.v_invoice_outstanding_live to authenticated;

comment on view public.v_invoice_outstanding_live is
  'Per confirmed-unpaid invoice: what is still owed TODAY, as opposed to what '
  'was frozen at confirm. Postpaid and unknown-mode invoices keep '
  'invoices.amount_due_sar byte-for-byte. A PREPAID invoice is capped at the '
  'customer''s live shortfall, allocated NEWEST-FIRST (the FIFO pool drains '
  'oldest-first, so a later top-up settles the oldest work and the surviving '
  'shortfall belongs to the newest invoices). The cap means this can only '
  'REDUCE a receivable, never invent one. Mode resolution is a byte-copy of '
  '0134''s pay_invoice() guard: snapshot first, else the customer''s projects '
  'via count(distinct)=1, so mixed or absent fails closed to the frozen figure. '
  'Never rewrites the document (0137).';

-- ---------------------------------------------------------------------------
-- 3. v_receivables_open — now composes on the rule instead of restating it.
--
-- **APPEND-ONLY.** create or replace view cannot insert, reorder or rename a
-- column (42P16, which cost 0112 an apply cycle). The first NINE columns below
-- are byte-identical in NAME, ORDER and TYPE to the applied 0098 definition;
-- frozen_amount_due_sar and outstanding_basis are APPENDED at the end.
--
-- outstanding_sar is the SAME COLUMN NAME in the SAME POSITION, now carrying
-- the live figure. Every existing consumer keeps working untouched:
--   * app/page.tsx and lib/actions/dashboard-widgets.ts select outstanding_sar
--   * app/reports/page.tsx selects * (the two new columns arrive harmlessly)
--   * v_receivables_aging LEFT JOINs it and names its columns explicitly
--   * v_dashboard_action_items composes on it and restates nothing
-- Both dependent views therefore inherit the fix and neither needs replacing —
-- which is the point of composing rather than copying the predicate (0103's
-- own lesson, where a "closely restated" predicate read 5 against Reports' 2).
--
-- THE WHERE CLAUSE NOW FILTERS ON THE LIVE FIGURE. An invoice whose live
-- outstanding falls to zero LEAVES this view, exactly as a paid one does. That
-- is the intended behaviour and it is what removes 026-000009's phantom
-- 4,243.50 from every receivables surface at once.
-- ---------------------------------------------------------------------------
create or replace view public.v_receivables_open as
select
  o.invoice_id,
  o.invoice_number,
  o.customer_id,
  c.name as customer_name,
  o.confirmed_at,
  o.period_end,
  -- Redundant today -- v_invoice_outstanding_live already pins this to numeric(12,2)
  -- above, so the cast is a no-op. It is written anyway so this file states the
  -- required type at the site the 42P16 error names, and cannot silently regress if
  -- the source view is ever re-drafted. The explicit alias is NOT optional dressing:
  -- this column's NAME is as load-bearing as its type (append-only rule), and relying
  -- on Postgres to name a cast expression is one assumption too many on a column that
  -- has already cost one apply cycle.
  o.outstanding_sar::numeric(12,2) as outstanding_sar,
  (current_date - o.confirmed_at::date) as days_outstanding,
  case
    when (current_date - o.confirmed_at::date) <= 30 then '0-30'
    when (current_date - o.confirmed_at::date) <= 60 then '31-60'
    when (current_date - o.confirmed_at::date) <= 90 then '61-90'
    else '90+'
  end as aging_bucket,
  o.frozen_amount_due_sar,
  o.outstanding_basis
from public.v_invoice_outstanding_live o
join public.customers c on c.id = o.customer_id
where o.outstanding_sar > 0::numeric;

alter view public.v_receivables_open set (security_invoker = true);
revoke all on public.v_receivables_open from anon;
grant select on public.v_receivables_open to authenticated;

comment on view public.v_receivables_open is
  'Open receivables — confirmed, unpaid, non-void invoices with something still '
  'owed TODAY. outstanding_sar is now the LIVE figure from '
  'v_invoice_outstanding_live, not invoices.amount_due_sar: a prepaid customer '
  'who topped up after confirm no longer shows a receivable their own balance '
  'already covers. frozen_amount_due_sar keeps the document''s own number beside '
  'it and outstanding_basis says which rule produced the figure. Columns 1-9 are '
  'byte-identical to 0098; the last two are appended (42P16 — replace can only '
  'append). v_receivables_aging and v_dashboard_action_items compose on this and '
  'inherit the fix (0137).';

commit;

-- ---------------------------------------------------------------------------
-- VERIFICATION (read-only, safe to re-run). Blocks A-C are Turki's own three
-- acceptance conditions, in order. Run A/B/C BEFORE the apply too — every
-- "before" figure below was measured live on 2026-08-19.
--
-- A. THE LYING 4,243.50 IS CORRECTED, AND THE ROW LEAVES THE VIEW.
--    Expect 026-000009: frozen_amount_due_sar 4,243.50, outstanding_sar 0.00,
--    outstanding_basis 'live_prepaid_balance', balance_sar 11,895.00.
-- select invoice_number, effective_payment_mode, balance_sar, shortfall_sar,
--        frozen_amount_due_sar, outstanding_sar, outstanding_basis
--   from public.v_invoice_outstanding_live
--  order by customer_id, confirmed_at;
--
--    And it must be GONE from the receivables view itself:
-- select count(*) from public.v_receivables_open
--  where invoice_number = '026-000009';   -- EXPECT 0
--
-- B. NO POSTPAID INVOICE MOVES. Every row whose basis is 'frozen' must have
--    outstanding_sar EXACTLY equal to its own invoices.amount_due_sar. Expect
--    ZERO rows out; 026-000002 (customer e958b840, snapshot NULL, project
--    postpaid) must still read 3,795.00.
-- select o.invoice_number, o.outstanding_basis, o.outstanding_sar, i.amount_due_sar
--   from public.v_invoice_outstanding_live o
--   join public.invoices i on i.id = o.invoice_id
--  where o.outstanding_basis = 'frozen'
--    and o.outstanding_sar is distinct from i.amount_due_sar;
--
--    The stronger form — NO row of ANY basis may EXCEED its frozen figure.
--    This is the cap itself, asserted. EXPECT ZERO ROWS, always.
-- select invoice_number, frozen_amount_due_sar, outstanding_sar
--   from public.v_invoice_outstanding_live
--  where outstanding_sar > frozen_amount_due_sar;
--
-- C. NO DOUBLE-COUNT AGAINST THE PREPAID BALANCE. Per prepaid customer, the
--    total live outstanding may never exceed the shortfall. Prepaid outstanding
--    derives from the balance ALONE and is never added to per-invoice
--    amount_due, so this must hold by construction — assert it anyway, because
--    a future edit to the allocation window is exactly what would break it.
--    EXPECT ZERO ROWS.
-- select customer_id, sum(outstanding_sar) as total_live, min(shortfall_sar) as shortfall
--   from public.v_invoice_outstanding_live
--  where effective_payment_mode = 'prepaid'
--  group by customer_id
-- having sum(outstanding_sar) > min(shortfall_sar) + 0.005;
--
-- D. DRIFT CHECK — the balance view agrees with lib/prepaid.ts. Run this and
--    compare against the Finance tab's RUNNING balance for the same customers
--    in the browser. Measured 2026-08-19: de4b1ffc topups 53,640.00, trips
--    40,077.50, charges 1,667.50, balance +11,895.00; 8f119304 topups
--    67,400.00, trips 68,540.00, charges 48,300.00, balance -49,440.00.
--    A DISAGREEMENT HERE IS A REAL DEFECT IN ONE OF THE TWO EXPRESSIONS —
--    do not "adjust" the view to match; find out which side is wrong.
-- select customer_name, topups_sar, trip_consumption_sar, charge_consumption_sar,
--        balance_sar
--   from public.v_customer_prepaid_balance
--  order by balance_sar;
--
-- E. PROPAGATION. Both dependent views compose and were NOT replaced; these
--    figures are the proof they picked the fix up.
--    v_receivables_open        BEFORE: 2 rows / 8,038.50  AFTER: 1 row / 3,795.00
-- select count(*) as rows, coalesce(sum(outstanding_sar),0) as total
--   from public.v_receivables_open;
--
--    v_receivables_aging '31-60' BEFORE: 8,038.50 / 2      AFTER: 3,795.00 / 1
--    (both open invoices are 32 and 35 days old on 2026-08-19, so they share a
--    bucket — re-read the bucket live if this is applied on a later date.)
-- select * from public.v_receivables_aging order by aging_bucket;
--
--    v_dashboard_action_items 'invoice_unpaid' count BEFORE: 2  AFTER: 1
-- select * from public.v_dashboard_action_items where item_type = 'invoice_unpaid';
--
-- F. SECURITY POSTURE. Every view replaced or created above must be
--    security_invoker and must not be anon-readable. create or replace view does
--    NOT preserve reloptions, so v_receivables_open would silently revert to
--    owner-run without the footer restated above. Live count to hold: 44 views /
--    44 security_invoker before this file; 46 / 46 after (two new views).
-- select c.relname,
--        coalesce((select option_value from pg_options_to_table(c.reloptions)
--                   where option_name = 'security_invoker'), 'false') as security_invoker,
--        has_table_privilege('anon', c.oid, 'SELECT') as anon_can_select
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public' and c.relkind = 'v'
--    and c.relname in ('v_customer_prepaid_balance','v_invoice_outstanding_live',
--                      'v_receivables_open','v_receivables_aging',
--                      'v_dashboard_action_items');
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- THE APP HALF — MIGRATION FIRST, THEN THE APP. **NOT ON DISK YET,
-- DELIBERATELY.** A PostgREST select naming a view that does not exist returns
-- 400, so the two edits below land only AFTER this file is applied. (0132/0133
-- were DROPs and ran the opposite way — app refs stripped first. Do not copy
-- that ordering here.)
--
-- THE VIEWS ALONE ALREADY FIX THE DASHBOARD, REPORTS' RECEIVABLES CARD AND THE
-- ACTION-ITEM QUEUE, because all three read v_receivables_open. What they do
-- NOT fix is the two places that read v_revenue_invoices.amount_due_sar
-- directly — that view is in the P&L chain and is deliberately untouched:
--
--   1. lib/report-builder.ts (~line 300), inside the customer-grouping branch:
--        if (!i.is_paid) e.b.outstanding += i.amount_due_sar;
--      -> join each invoice to v_invoice_outstanding_live by invoice_id and add
--         outstanding_sar; an invoice absent from that view has nothing
--         outstanding (it is paid, void or fully covered) and contributes 0.
--
--   2. app/reports/StatementViews.tsx (~line 118), in RevenueStatement:
--        if (i.is_paid) e.paid += i.revenue_sar;
--        else e.outstanding += i.amount_due_sar;
--      -> same join, same rule. Its existing comment ("an invoice can be partly
--         covered by a prepaid balance, so these are not two halves of one
--         number") stays TRUE and becomes more so.
--
-- ONE SQL DEFINITION, THREE CONSUMERS. Do not reimplement the cap in
-- TypeScript — a second expression of this rule is exactly the drift 0098's
-- semantic layer exists to prevent.
--
-- DELIBERATELY LEFT FROZEN: app/trips/InvoicesModal.tsx (~line 201) renders the
-- per-invoice amount_due_sar in the Finance list. That is THE DOCUMENT'S OWN
-- NUMBER on a per-document row and it must keep matching the printed invoice.
-- Receivables reporting is where "what is owed today" belongs.
-- ---------------------------------------------------------------------------
