-- 0142 — A RECORDED BALANCE RETURN IS A DEBIT AGAINST THE PREPAID POOL.
--
-- THE HOLE THIS CLOSES. `customer_balance_returns` (0139) recorded that a
-- customer's leftover prepaid credit had been physically handed back — cash or
-- bank transfer, with proof — and then NOTHING SUBTRACTED IT. Not here, not in
-- v_customer_amount_payable, not in lib/prepaid.ts, and not in any trigger: a
-- repo-wide and database-wide trace found exactly two objects that mention the
-- table at all, the writer RPC `return_customer_balance` and the display view
-- `v_customer_amount_payable`, and neither moves a balance. The credit stayed
-- spendable after the money was gone. That is a double-spend: the customer
-- could take the refund and still have the same pool covering future trips.
--
-- WHY IT WAS SURVIVABLE UNTIL NOW, AND WHY IT STOPS BEING. The 0139 design
-- said "recording is not deducting" on purpose — a returned-balance customer
-- was archived, and an archived customer generates no trips, so a stale
-- spendable balance had nothing to spend on. That argument is load-bearing on
-- the customer staying archived forever. It is not a property of the money.
--
-- THE RULE (Turki's ruling): a recorded balance return REDUCES spendable
-- prepaid credit. It is a debit of the same class as consumption.
--
-- APPLIED IN BOTH EXPRESSIONS OF THE NUMBER, IN ONE CHANGE. The balance has
-- exactly two computations by design — the TypeScript engine (lib/prepaid.ts,
-- the authority) and this view (its declared mirror). A rule applied to one
-- and not the other does not half-fix the bug; it creates a second bug where
-- the two disagree. The TS side lands in the same commit as this file.
--
-- NOT VAT-BEARING. A refund of credit is a cash movement, not a taxable
-- supply, so it is netted at face value. Consumption is multiplied by 1.15
-- below because a delivered trip IS a supply; a returned riyal is not.
--
-- NOT A NEGATIVE TOP-UP. It would have been fewer characters to insert an
-- offsetting `customer_topups` row and change no view at all. That was
-- rejected: `topups_sar` is published as a column and read as "money this
-- customer has paid in", and a refund is not a payment in. Netting it into the
-- credits side would make that column lie to every reader in exchange for
-- saving one subtraction.
--
-- DEPENDENTS INHERIT THIS AND NEED NO EDIT.
--   * v_customer_amount_payable — its prepaid arm is literally `b.balance_sar`
--     from this view, so amount_payable_sar, owed_sar and archive_blocked all
--     reflect the netting the moment this runs. Confirmed against the live
--     definition, not assumed.
--   * v_invoice_outstanding_live — reads balance_sar for
--     `shortfall_sar = GREATEST(0, -balance_sar)`. A refunded customer with
--     open invoices will now correctly show a shortfall. On today's data the
--     one refunded customer nets to exactly 0 (not negative), so no
--     receivable moves; the behaviour is correct either way.
--
-- A SIDE EFFECT WORTH NAMING: `return_customer_balance` guards on
-- `amount_payable_sar > 0`. After this migration, a customer who has already
-- been refunded computes 0, so the guard itself now blocks a second refund —
-- on top of the pre-existing UNIQUE(customer_id) and the explicit exists-check
-- in the RPC. Three independent barriers where there were two. The RPC still
-- reads the correct pre-refund figure on a FIRST return, because with no rows
-- in customer_balance_returns the new term is 0 and the arithmetic is
-- unchanged. No RPC edit is needed and none is made.

-- ---------------------------------------------------------------------------
-- v_customer_prepaid_balance — net returns out of balance_sar.
-- ---------------------------------------------------------------------------
-- APPEND-ONLY. `create or replace view` cannot insert, reorder, rename or
-- retype a column (42P16), so `returns_sar` goes LAST even though it reads
-- more naturally beside the two consumption columns it belongs with. The six
-- existing columns keep their exact positions, names and types — all bare
-- `numeric`, verified with format_type() on pg_attribute rather than by
-- reading the view body, and the new subtraction is numeric-minus-numeric so
-- balance_sar does not retype either.
create or replace view public.v_customer_prepaid_balance as
select
  c.id   as customer_id,
  c.name as customer_name,
  coalesce((select sum(tp.amount_sar)
              from customer_topups tp
             where tp.customer_id = c.id), 0::numeric) as topups_sar,
  coalesce((select sum(round(coalesce(t.rate_sar, p.rate_per_trip_sar) * 1.15, 2))
              from trips t
              join projects p on p.id = t.project_id
             where p.customer_id = c.id
               and t.delivered_at is not null), 0::numeric) as trip_consumption_sar,
  coalesce((select sum(round(sc.amount_sar * 1.15, 2))
              from invoice_special_charges sc
              join invoices i on i.id = sc.invoice_id
             where i.customer_id = c.id
               and i.status <> 'void'), 0::numeric) as charge_consumption_sar,
  -- THE NETTED BALANCE. Credits, less VAT-inclusive consumption, LESS money
  -- already handed back. The three subquery bodies are byte-identical to the
  -- three columns above and to the pre-0142 definition; the only change to
  -- this expression is the fourth term.
  coalesce((select sum(tp.amount_sar)
              from customer_topups tp
             where tp.customer_id = c.id), 0::numeric)
  - coalesce((select sum(round(coalesce(t.rate_sar, p.rate_per_trip_sar) * 1.15, 2))
                from trips t
                join projects p on p.id = t.project_id
               where p.customer_id = c.id
                 and t.delivered_at is not null), 0::numeric)
  - coalesce((select sum(round(sc.amount_sar * 1.15, 2))
                from invoice_special_charges sc
                join invoices i on i.id = sc.invoice_id
               where i.customer_id = c.id
                 and i.status <> 'void'), 0::numeric)
  - coalesce((select sum(r.amount_sar)
                from customer_balance_returns r
               where r.customer_id = c.id), 0::numeric) as balance_sar,
  -- Published so the netting is AUDITABLE from the view itself: a reader can
  -- see the four terms and check that balance_sar is their difference, instead
  -- of having to know that a fourth subtraction exists. Aggregated with sum()
  -- rather than read as a scalar even though customer_balance_returns is
  -- UNIQUE(customer_id) today — an aggregate stays correct if that constraint
  -- is ever relaxed, where a bare subselect would start raising 21000.
  coalesce((select sum(r.amount_sar)
              from customer_balance_returns r
             where r.customer_id = c.id), 0::numeric) as returns_sar
from customers c;

-- CLAUDE.md §6 — `create or replace view` silently drops reloptions, so the
-- full security footer is restated, not assumed to have survived.
alter view public.v_customer_prepaid_balance set (security_invoker = true);
revoke all on public.v_customer_prepaid_balance from anon;
grant select on public.v_customer_prepaid_balance to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions — the migration verifies itself and aborts rather than half-land.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad int;
begin
  -- 1. The published columns must actually reconcile. If balance_sar ever
  --    stops being (topups - trips - charges - returns), the view has grown a
  --    second opinion about its own arithmetic.
  select count(*) into v_bad
    from public.v_customer_prepaid_balance b
   where b.balance_sar
         <> b.topups_sar - b.trip_consumption_sar - b.charge_consumption_sar - b.returns_sar;
  if v_bad > 0 then
    raise exception '0142: % row(s) where balance_sar does not equal its four published terms.', v_bad;
  end if;

  -- 2. NOTHING MOVES FOR A CUSTOMER WITH NO REFUND. The blast-radius check:
  --    for every customer with no row in customer_balance_returns, the new
  --    term must be 0 AND balance_sar must still equal the pre-0142 THREE-term
  --    formula, spelled out here rather than inferred from assertion 1. Every
  --    outer column is alias-qualified deliberately — an unqualified
  --    `customer_id` inside the correlated subquery would bind to the INNER
  --    table and silently degrade the test to "no refunds exist anywhere".
  select count(*) into v_bad
    from public.v_customer_prepaid_balance b
   where not exists (select 1 from public.customer_balance_returns r
                      where r.customer_id = b.customer_id)
     and (b.returns_sar <> 0
          or b.balance_sar <> b.topups_sar - b.trip_consumption_sar - b.charge_consumption_sar);
  if v_bad > 0 then
    raise exception '0142: % un-refunded customer(s) whose balance moved — this migration must change nothing for them.', v_bad;
  end if;

  -- 3. A FULLY REFUNDED CUSTOMER MUST READ EXACTLY NIL. return_customer_balance
  --    always refunds the WHOLE of amount_payable_sar (it reads v_amount from
  --    the view and inserts that figure), so netting it back out has to land on
  --    zero. A non-zero result here means the refund and the balance were
  --    computed over different inputs — the exact drift this migration exists
  --    to make impossible.
  select count(*) into v_bad
    from public.v_customer_prepaid_balance b
    join public.customer_balance_returns r on r.customer_id = b.customer_id
   where b.balance_sar <> 0;
  if v_bad > 0 then
    raise exception '0142: % refunded customer(s) do not net to 0 — refund and balance disagree.', v_bad;
  end if;

  -- 4. The mirror still holds: for a prepaid customer with no write-off,
  --    v_customer_amount_payable's payable IS this view's balance. That view
  --    is not replaced here, so this asserts the dependency still resolves the
  --    way the header claims rather than trusting the read.
  select count(*) into v_bad
    from public.v_customer_amount_payable ap
    join public.v_customer_prepaid_balance b on b.customer_id = ap.customer_id
   where ap.payment_mode = 'prepaid'
     and not ap.is_written_off
     and ap.amount_payable_sar <> b.balance_sar;
  if v_bad > 0 then
    raise exception '0142: % prepaid customer(s) where amount_payable_sar no longer mirrors balance_sar.', v_bad;
  end if;

  raise notice '0142: balance returns now net out of prepaid credit — all assertions passed.';
end $$;
