-- 0141_restore_customer_reverse_write_off.sql
--
-- RESTORE A CUSTOMER FROM ARCHIVE — and, if the archive was forced through the
-- debt guard, REVERSE the write-off that forcing produced.
--
-- ===========================================================================
-- WHY CUSTOMERS HAD NO RESTORE, AND WHY THAT IS NOW SUPERSEDED
-- ===========================================================================
--
--   §7 has carried this line since the Archive page shipped:
--
--     "Customers have NO Restore, deliberately: 0019 archives a customer as a
--      side effect of archiving its 1:1 project, so a solo restore would leave
--      a half-restored state."
--
--   The REASONING was right and the CONCLUSION was the cheap way out. A solo
--   restore does leave a half-restored state — so this migration does not
--   build a solo restore. It builds ONE RPC that clears BOTH archived_at
--   stamps in ONE transaction on ONE timestamp, exactly mirroring
--   archive_project_guarded's own two-update pairing. Restoring a customer
--   restores its project with it, or nothing happens at all.
--
--   Drivers, staff and trucks already restore (app/archive/actions.ts —
--   restoreDriver / restoreStaff / restoreTruck). Those are single-table
--   clears with no money attached, which is why they were never RPCs and why
--   this one has to be.
--
-- ===========================================================================
-- THE SIGN CONVENTION, restated because everything below turns on it (0139)
-- ===========================================================================
--
--     amount_payable_sar  <  0   money owed TO US       -> archive BLOCKED
--     amount_payable_sar  =  0   settled                -> allowed
--     amount_payable_sar  >  0   credit we owe THEM     -> allowed, return offered
--     owed_sar = greatest(0, -amount_payable_sar)
--
-- ===========================================================================
-- THE FOUR RULES THIS FILE IS BUILT TO SATISFY
-- ===========================================================================
--
-- 1. ONE RPC, ONE STAMP. restore_customer_guarded clears customers.archived_at
--    AND the customer's project archived_at together, atomically. PostgREST
--    runs each statement in its own transaction, so an app-side pair could
--    half-apply and leave a restored customer whose project is still archived
--    (or the reverse) — the same reasoning 0139 gives for the archive side.
--
-- 2. THE WRITE-OFF IS REVERSED, NOT DELETED. A forced archive recorded a
--    DECISION in customer_write_offs, signed with a reason and an actor.
--    Undoing the archive undoes the decision, but the record of it having been
--    made — and of who unmade it — is the audit trail. So the row is MARKED
--    (reversed_at, reversed_by) and KEPT. Nothing in this file deletes a
--    customer_write_offs row, and nothing should.
--
-- 3. RESTORE WRITES NO MONEY. It clears two archived_at stamps and marks one
--    write-off row. It writes no balance, no top-up, no amount, no recomputed
--    figure. See the DO-NOT-FIX block below for what governs the credit a
--    restored customer comes back with, and why this file must not touch it.
--
-- 4. FAIL LOUD. Every guard raises rather than guessing, the two replaced
--    views restate their §6 security footer, the RPC signature is dropped
--    before it is created, and a do $$ block at the foot asserts the whole end
--    state in the same run.
--
-- ===========================================================================
-- (a) THE WRITE-OFF SUPPRESSION IS EXISTENCE-BASED, AND THAT IS THE HINGE
-- ===========================================================================
--
--   public.customer_write_offs is 8 columns today — id, customer_id,
--   project_id, amount_sar numeric(12,2), payment_mode, reason,
--   written_off_by, created_at. There is no reversal concept anywhere in it.
--
--   EXACTLY TWO VIEWS reference the table (verified by scanning every
--   pg_get_viewdef in public, not assumed), and BOTH suppress by asking
--   whether a row EXISTS:
--
--     v_customer_amount_payable    left join ... w  ->  (w.customer_id is not null)
--       drives amount_payable_sar -> 0, owed_sar -> 0, archive_blocked -> false
--
--     v_invoice_outstanding_live   left join ... w  ->  (w.customer_id is not null)
--       drives outstanding_sar -> 0.00, outstanding_basis -> 'written_off',
--       which drops the invoice out of v_receivables_open BY COMPOSITION
--       (that view filters `where outstanding_sar > 0` — 0139's free ride).
--
--   So the ENTIRE suppression is one predicate, twice. Narrowing that
--   predicate from "a row exists" to "an ACTIVE row exists" un-suppresses
--   everything at once, in both views, with no money math anywhere.
--
-- ===========================================================================
-- (d) HOW THE REAL OWED FIGURE COMES BACK — BY SUBTRACTION, NOT BY WRITING
-- ===========================================================================
--
--   Both joins gain `and w.reversed_at is null`. IN THE JOIN CONDITION, NEVER
--   IN A WHERE CLAUSE — a left join whose predicate moves to WHERE stops being
--   a left join, and every customer without a write-off would vanish from
--   v_customer_amount_payable entirely.
--
--   Once the row no longer matches, w.customer_id reads NULL, the CASE falls
--   through to the arm it would have taken had the write-off never existed,
--   and amount_payable_sar is recomputed from the SAME live inputs it always
--   read — the prepaid arm from v_customer_prepaid_balance, the postpaid arm
--   from delivered-unpaid trips and non-void special charges. NO STORED AMOUNT
--   IS READ BACK. customer_write_offs.amount_sar stays exactly where it is, as
--   the frozen record of what was written off, and is never used to restore a
--   figure.
--
--   Measured proof on live data before drafting: TEST 111 Co.
--   (104e158e-…, archived 2026-08-19 23:32:29.473557+00) carries
--   postpaid_unpaid_sar = 20056.00 and written_off_sar = 20056.00 — the same
--   figure from two directions. Reversing its write-off moves
--   amount_payable_sar 0 -> -20056.00 and owed_sar 0 -> 20056.00 with no write
--   of any kind. Verification block C at the foot of this file is that check.
--
-- ===========================================================================
-- DO NOT FIX: RESTORE NEVER TOUCHES A BALANCE, AND balance_returned IS WHY
-- ===========================================================================
--
--   Rule 3 asks that a restored customer's credit be governed entirely by the
--   balance_returned marker plus the live prepaid-balance view. It already is,
--   and the honest description of the mechanism is NOT "the view subtracts a
--   returned balance" — it does not:
--
--     * v_customer_prepaid_balance.balance_sar is top-ups minus VAT-inclusive
--       consumption. It has NEVER read customer_balance_returns. 0139's own
--       header states it: RECORDING IS NOT DEDUCTING. The figure is
--       deliberately unchanged by a return, and Turki's in-browser check on
--       2026-08-20 proved it on live data — Seder Facility Mang. Co. still
--       reads 11,895.00 after its return, with only balance_returned flipped.
--
--     * amount_payable_sar does not read balance_returned either. Its prepaid
--       arm is b.balance_sar regardless.
--
--     * balance_returned is itself derived from row EXISTENCE —
--       (r.customer_id is not null) off a left join to
--       customer_balance_returns — and lives on v_customer_amount_payable,
--       NOT on v_customer_prepaid_balance.
--
--   So the credit a restored customer shows is:
--
--     balance_returned = true   the money was already handed back. The figure
--                               still reads its historical amount, and the
--                               MARK is what says it is spent. BalanceWithMark
--                               (app/archive/ArchiveCustomerTab.tsx) is the one
--                               component that renders figure-plus-mark, and
--                               any surface showing this balance uses it. The
--                               customer is back with NO SPENDABLE CREDIT, and
--                               the mark is the only thing carrying that fact.
--                               A positive balance rendered BARE, with no mark,
--                               is a FALSE LIABILITY.
--
--     balance_returned = false  nothing was ever handed back. The credit is
--                               intact and comes back with the customer,
--                               untouched, because nothing touched it.
--
--   BOTH STATES ARE ACHIEVED BY THIS FILE DOING NOTHING. Restore must not
--   delete the customer_balance_returns row (that would resurrect a credit
--   already paid out in cash), must not write a negative top-up (0139: that
--   double-counts against a balance that was already correct), and must not
--   zero anything by hand. The RPC below ends with no balance write, and if a
--   future edit adds one, that edit is the bug.
--
--   The one restore that is NOT offered, deliberately: a returned balance
--   cannot be un-returned. customer_balance_returns_customer_id_key is a real
--   UNIQUE index and one return per customer is a database rule (0139 Q3).
--   Un-returning is a cash movement in the opposite direction and would be its
--   own feature with its own audit, not a side effect of un-archiving.
--
-- ===========================================================================
-- THE UNIQUE-CONSTRAINT COLLISION — the reason §2 exists at all
-- ===========================================================================
--
--   customer_write_offs today carries customer_write_offs_customer_id_key,
--   UNIQUE (customer_id), and archive_project_guarded inserts with
--   `on conflict (customer_id) do nothing`.
--
--   Keeping a reversed row under that constraint breaks re-archiving:
--
--     force-archive a debtor      -> write-off row inserted
--     restore                     -> row marked reversed, KEPT (rule 2)
--     force-archive again         -> the insert hits the surviving reversed row,
--                                    DOES NOTHING, and the archive stamp still
--                                    lands
--
--   The customer ends up archived, still owing, with no ACTIVE write-off — so
--   archive_blocked reads true on an archived customer and the debt is neither
--   collected nor written off. A silent inconsistent state, which rule 4
--   forbids outright.
--
--   Fix: the constraint becomes a PARTIAL unique index — at most one ACTIVE
--   write-off per customer, unlimited reversed history — and the RPC's
--   conflict target names the same predicate so it infers that index. 0139's
--   Q3 rule ("one write-off per customer") is preserved in the only reading
--   that still means anything: one LIVE decision at a time.
--
--   Verified safe before drafting: ZERO foreign keys reference
--   customer_write_offs, so dropping its unique constraint cannot cascade, and
--   no app code touches the table directly (it reads only
--   v_customer_amount_payable) — there is no .upsert(..., onConflict:
--   'customer_id') anywhere in app/ or lib/ to break.
--
-- ===========================================================================
-- (b) NEW COLUMNS  |  (c) NEW RPC SIGNATURE
-- ===========================================================================
--
--   (b)  public.customer_write_offs
--          + reversed_at  timestamptz   nullable, no default, no backfill
--          + reversed_by  text          nullable, no default, no backfill
--        NULL reversed_at means the write-off is STILL ACTIVE. Every existing
--        row therefore stays active with no backfill, which is correct: the
--        one live write-off belongs to a customer that is still archived.
--
--   (c)  public.restore_customer_guarded(p_customer_id uuid,
--                                        p_actor       text default null)
--          returns uuid
--
--        CUSTOMER-CENTRIC, not project-centric, unlike archive_project_guarded
--        — the surface it launches from is the archived-CUSTOMER tab, and the
--        rule is stated as "restoring a customer restores its project too".
--        projects_customer_id_unique (0015) makes that 1:1; the RPC asserts it
--        rather than assuming it, so the day 0015 is lifted this raises
--        instead of guessing which project to bring back.
--
--        No restore_* or unarchive_* function exists in the database today, so
--        the name is free. The drop below is defensive, and the assertion
--        block proves exactly one signature exists afterwards (the 0038 rule).
--
-- ===========================================================================
-- 42P16 — NEITHER VIEW CHANGES SHAPE
-- ===========================================================================
--
--   No column is added, removed, reordered or renamed in either view, and no
--   type moves: the ONLY edit is one extra predicate inside an existing left
--   join. Live column names, order and types were compared against 0139 on
--   disk with format_type(atttypid, atttypmod) on pg_attribute — NOT
--   pg_get_viewdef, which does not show a resolved type (§6) — and match
--   exactly: 18 columns on v_customer_amount_payable, 11 on
--   v_invoice_outstanding_live with outstanding_sar numeric(12,2) and
--   outstanding_basis text.
--
--   `create or replace view` does NOT preserve reloptions, so security_invoker
--   and both grants are restated after each create. Standing rule, every view,
--   no exceptions.
--
-- ===========================================================================
-- BEFORE APPLYING — the measured starting state
-- ===========================================================================
--
--   select count(*) from public.customer_write_offs;                  -- 1
--   select count(*) from public.customer_balance_returns;             -- 1
--   select count(*) from public.customers where archived_at is not null; -- 3
--   select conname from pg_constraint
--    where conrelid = 'public.customer_write_offs'::regclass and contype = 'u';
--     -- customer_write_offs_customer_id_key
--   select p.oid::regprocedure::text from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname like 'restore\_%';       -- 0 rows
--
--   The three archived customers this file was reasoned against, each with
--   exactly one project, project and customer stamped identically,
--   projects.status still 'active' and customers.active still true (archive is
--   archived_at and NOTHING else):
--
--     Turki 1                   109bfd73-…  2026-06-28  mode NULL
--                               payable -1035.00, blocked, NO write-off row
--                               — a PRE-GUARD archive. Restore has nothing to
--                                 reverse and must not invent one.
--     TEST 111 Co.              104e158e-…  2026-08-19 23:32:29.473557+00
--                               postpaid, written off 20056.00, payable 0
--                               — the reversal case.
--     Seder Facility Mang. Co.  de4b1ffc-…  2026-08-20 00:02:41.959339+00
--                               prepaid, balance_returned TRUE, returned
--                               11895.00, balance_sar 11895.00, payable
--                               +11895.00 — the balance_returned = true case.
--
-- AFTER APPLYING — the do $$ block at the foot asserts the end state and
-- raises rather than printing quietly. The commented verification blocks A–G
-- below it are for reading the result afterwards; they are NOT run by this
-- file.
--
-- This whole file is one transaction. A failed assertion rolls back the
-- columns, the index, both views and both functions together — there is no
-- half-applied state to clean up.
-- ===========================================================================

begin;

-- ===========================================================================
-- 1. The reversal columns.
--
-- Nullable, no default, no backfill — NULL reversed_at IS the "still active"
-- state, so every existing row keeps its meaning without being touched. Same
-- shape as 0132's health_insurance: a column whose NULL carries meaning must
-- never acquire a tidy default in a later migration.
--
-- reversed_by is text and nullable for the same reason written_off_by is —
-- this app has no role gate (0139 Q4, parked with the RBAC pass), so the actor
-- is whatever the caller passes and the ATTRIBUTION is the control, not an
-- enforced identity.
-- ===========================================================================
alter table public.customer_write_offs
  add column if not exists reversed_at timestamptz;

alter table public.customer_write_offs
  add column if not exists reversed_by text;

comment on column public.customer_write_offs.reversed_at is
  'When this write-off was reversed by restore_customer_guarded (0141). NULL '
  'means the write-off is STILL ACTIVE and is suppressing this customer''s '
  'payable. The row is MARKED, NEVER DELETED — the record that the decision '
  'was made, and by whom, is the audit trail and outlives the reversal.';

comment on column public.customer_write_offs.reversed_by is
  'Who reversed it (0141). Free text, same convention and same reason as '
  'written_off_by: no role gate exists in this app, so attribution is the '
  'control rather than enforced identity.';

-- ===========================================================================
-- 2. UNIQUE (customer_id) -> PARTIAL unique on the ACTIVE rows only.
--
-- See the collision note in this file's header for why this is required and
-- not merely tidy: under the old constraint, re-archiving a restored debtor
-- would silently insert nothing and archive the customer anyway, leaving
-- archive_blocked true on an archived row.
--
-- 0139's Q3 rule survives in the reading that still means something: ONE LIVE
-- DECISION AT A TIME. Reversed rows accumulate as history and are excluded
-- from the index, so they can never collide with a new one.
--
-- Safe to drop: zero foreign keys reference this table, and no app code reads
-- or writes it directly (it reads v_customer_amount_payable only).
-- ===========================================================================
alter table public.customer_write_offs
  drop constraint if exists customer_write_offs_customer_id_key;

create unique index if not exists customer_write_offs_active_customer_idx
  on public.customer_write_offs (customer_id)
  where reversed_at is null;

comment on index public.customer_write_offs_active_customer_idx is
  'At most ONE ACTIVE (reversed_at is null) write-off per customer; reversed '
  'history is unlimited. Replaces customer_write_offs_customer_id_key (0139), '
  'which would have made re-archiving a restored debtor a silent no-op. '
  'archive_project_guarded''s ON CONFLICT target names this same predicate so '
  'it infers this index (0141).';

-- ===========================================================================
-- 3. v_customer_amount_payable — ONE line changes.
--
-- Reproduced verbatim from 0139 except the customer_write_offs join, which
-- gains `and w.reversed_at is null`. IN THE JOIN CONDITION. Moving that
-- predicate to a WHERE clause would turn the left join into an inner join and
-- delete every customer without a write-off from this view.
--
-- 42P16: no column added, removed, reordered or renamed; no type moves.
-- ===========================================================================
create or replace view public.v_customer_amount_payable as
with resolved_mode as (
  -- BYTE-COPY of 0134's pay_invoice() guard and of 0137 §2's resolution:
  -- count(distinct payment_mode) = 1, so a mixed OR absent set resolves to
  -- NULL. Any other resolution would let the money path and this guard
  -- disagree about the same customer.
  select
    c.id as customer_id,
    (
      select case when count(distinct p.payment_mode) = 1 then min(p.payment_mode) end
        from public.projects p
       where p.customer_id = c.id
         and p.payment_mode is not null
    ) as payment_mode
  from public.customers c
),
postpaid_unpaid as (
  select
    c.id as customer_id,
    coalesce((
      select sum(round(coalesce(t.rate_sar, p.rate_per_trip_sar) * 1.15, 2))
        from public.trips t
        join public.projects p on p.id = t.project_id
       where p.customer_id = c.id
         and t.delivered_at is not null
         and not (
           t.invoice_id is not null
           and exists (
             select 1 from public.invoices i
              where i.id = t.invoice_id and i.status = 'paid'
           )
         )
    ), 0) as unpaid_trip_sar,
    coalesce((
      select sum(round(sc.amount_sar * 1.15, 2))
        from public.invoice_special_charges sc
        join public.invoices i on i.id = sc.invoice_id
       where i.customer_id = c.id
         and i.status not in ('void', 'paid')
    ), 0) as unpaid_charge_sar
  from public.customers c
)
select
  c.id                                as customer_id,
  c.name                              as customer_name,
  c.archived_at,
  rm.payment_mode,
  b.balance_sar                       as prepaid_balance_sar,
  (u.unpaid_trip_sar + u.unpaid_charge_sar)::numeric as postpaid_unpaid_sar,
  -- ACTIVE write-off only. A reversed row is history: it is kept for the audit
  -- trail and is deliberately invisible to every expression below (0141).
  (w.customer_id is not null)         as is_written_off,
  w.amount_sar                        as written_off_sar,
  w.reason                            as write_off_reason,
  w.written_off_by,
  w.created_at                        as written_off_at,
  (r.customer_id is not null)         as balance_returned,
  r.amount_sar                        as returned_sar,
  r.method                            as returned_method,
  r.returned_on,
  -- THE NUMBER. Signed, negative = owed to us, matching the Finance/Invoice
  -- tab's column exactly (see the sign-convention note in this file's header).
  --
  -- A written-off customer reports 0: the debt was a decision, and the
  -- decision is recorded in customer_write_offs rather than by rewriting any
  -- ledger row underneath.
  --
  -- REVERSING that decision (0141) removes the row from this join and the CASE
  -- falls through to the arm it would have taken had the write-off never
  -- existed — the real figure returns from the same live inputs, and NO STORED
  -- AMOUNT IS READ BACK. w.amount_sar is the frozen record of what was written
  -- off and must never be used to restore a payable.
  --
  -- Mode resolution, and why unknown lands where it does (Q1): a NULL mode
  -- falls to the postpaid arm, so unpaid delivered work still counts as owed.
  -- Failing closed here means never suppressing a debt we cannot classify.
  (case
     when w.customer_id is not null then 0
     when rm.payment_mode = 'prepaid' then b.balance_sar
     else -(u.unpaid_trip_sar + u.unpaid_charge_sar)
   end)::numeric as amount_payable_sar,
  -- Turki states owed as a positive quantity; published so nobody has to
  -- negate the signed column by hand and get it backwards once.
  greatest(0, -(case
     when w.customer_id is not null then 0
     when rm.payment_mode = 'prepaid' then b.balance_sar
     else -(u.unpaid_trip_sar + u.unpaid_charge_sar)
   end))::numeric as owed_sar,
  -- THE BLOCK ITSELF, published as a column so the RPC, the UI and any future
  -- reader all ask the same question of the same expression.
  (case
     when w.customer_id is not null then false
     when rm.payment_mode = 'prepaid' then b.balance_sar < 0
     else (u.unpaid_trip_sar + u.unpaid_charge_sar) > 0
   end) as archive_blocked
from public.customers c
join resolved_mode   rm on rm.customer_id = c.id
join postpaid_unpaid u  on u.customer_id  = c.id
join public.v_customer_prepaid_balance b on b.customer_id = c.id
left join public.customer_write_offs      w on w.customer_id = c.id
                                           and w.reversed_at is null
left join public.customer_balance_returns r on r.customer_id = c.id;

alter view public.v_customer_amount_payable set (security_invoker = true);
revoke all on public.v_customer_amount_payable from anon;
grant select on public.v_customer_amount_payable to authenticated;

comment on view public.v_customer_amount_payable is
  'What each customer still owes us, net of what they have paid. SIGNED: '
  'negative = owed to us, 0 = settled, positive = credit we owe them. Prepaid '
  'composes on v_customer_prepaid_balance (0137) and is not restated; postpaid '
  'is delivered trips and non-void special charges not on a PAID invoice, '
  'VAT-inclusive rounded per item — the SQL expression of what '
  'FinanceTab.tsx computes via derivedBalanceItems([], …). An ACTIVE '
  'customer_write_offs row (reversed_at is null) forces 0 WITHOUT rewriting any '
  'ledger row beneath; reversing it (restore_customer_guarded, 0141) returns the '
  'real figure by subtraction — the row leaves this join and the live inputs '
  'compute it again, with no stored amount read back. Unknown payment mode falls '
  'to the postpaid arm on purpose: never suppress a debt we cannot classify. '
  'archive_blocked is the archive guard itself, published so the RPC and the UI '
  'ask one expression (0139, extended by 0141). NOTE this view INCLUDES ARCHIVED '
  'CUSTOMERS — filter on customers.archived_at if active-only is meant.';

-- ===========================================================================
-- 4. v_invoice_outstanding_live — the second suppression site, ONE line.
--
-- Same edit, same reason, same rule about the join condition. A reversed
-- write-off stops zeroing the customer's confirmed-unpaid invoices, so they
-- re-enter v_receivables_open BY COMPOSITION — that view filters
-- `outstanding_sar > 0` and needs no edit of its own, exactly the free ride
-- 0137 and 0139 both took.
--
-- 42P16: no column added, removed, reordered or renamed; outstanding_sar keeps
-- its ::numeric(12,2) and outstanding_basis its explicit ::text.
-- ===========================================================================
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
    -- ACTIVE write-off only (0141). A reversed row is history and must not
    -- keep suppressing a receivable.
    (w.customer_id is not null) as is_written_off,
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
  left join public.customer_write_offs   w on w.customer_id = o.customer_id
                                          and w.reversed_at is null
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
  -- ::numeric(12,2) IS LOAD-BEARING, NOT COSMETIC — see 0137's note and 0139's
  -- §5 header. The written-off branch is FIRST because it outranks both: once a
  -- debt is written off there is nothing left to cap.
  (case
    when a.is_written_off then 0
    when a.effective_payment_mode = 'prepaid'
      then least(
             a.frozen_amount_due_sar,
             greatest(0, a.shortfall_sar - (a.cum_frozen_newest_first - a.frozen_amount_due_sar))
           )
    else a.frozen_amount_due_sar
  end)::numeric(12,2) as outstanding_sar,
  (case
    when a.is_written_off then 'written_off'
    when a.effective_payment_mode = 'prepaid' then 'live_prepaid_balance'
    else 'frozen'
  end)::text as outstanding_basis
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
  'A customer with an ACTIVE write-off (customer_write_offs with reversed_at is '
  'null, 0139/0141) reports 0.00 on basis ''written_off'' and therefore leaves '
  'v_receivables_open by composition — no phantom receivable survives a forced '
  'archive; reversing the write-off on restore brings the receivable back the '
  'same way, by composition. Never rewrites the document (0137, extended by '
  '0139 and 0141).';

-- ===========================================================================
-- 5. archive_project_guarded — the ON CONFLICT target follows the index.
--
-- IDENTICAL SIGNATURE AND IDENTICAL BODY except the conflict target, which now
-- names the partial index's predicate so it infers the new index rather than
-- the dropped constraint. Without this the insert raises 42P10 ("there is no
-- unique or exclusion constraint matching the ON CONFLICT specification") and
-- every forced archive fails outright.
--
-- `create or replace` is legal because the argument list does not change (the
-- 0038 one-signature rule is satisfied by construction), and it preserves the
-- existing grant — restated below anyway, because relying on an invisible
-- preserved privilege is how 0137's security footer lesson happened.
--
-- WHAT THE NEW TARGET ACTUALLY MEANS: retrying a forced archive while an
-- ACTIVE write-off already exists is still an idempotent no-op. But a customer
-- who was written off, restored, and is being force-archived AGAIN now gets a
-- genuinely NEW write-off row — which is correct: it is a new decision, with
-- its own reason, actor and frozen amount, sitting on top of the reversed
-- record of the first one.
-- ===========================================================================
create or replace function public.archive_project_guarded(
  p_project_id      uuid,
  p_override_reason text default null,
  p_actor           text default null
)
returns uuid
language plpgsql
as $function$
declare
  v_cust_id  uuid;
  v_blocked  boolean;
  v_owed     numeric(12,2);
  v_mode     text;
  v_reason   text := nullif(btrim(coalesce(p_override_reason, '')), '');
begin
  select customer_id into v_cust_id from public.projects where id = p_project_id;
  if v_cust_id is null then raise exception 'Project not found.'; end if;

  select ap.archive_blocked, ap.owed_sar, ap.payment_mode
    into v_blocked, v_owed, v_mode
    from public.v_customer_amount_payable ap
   where ap.customer_id = v_cust_id;

  if v_blocked and v_reason is null then
    raise exception
      'This customer still owes % SAR. Archiving is blocked until it is settled, or overridden with a written reason.',
      to_char(v_owed, 'FM999,999,990.00')
      using errcode = 'check_violation';
  end if;

  if v_blocked then
    insert into public.customer_write_offs
      (customer_id, project_id, amount_sar, payment_mode, reason, written_off_by)
    values
      (v_cust_id, p_project_id, v_owed, v_mode, v_reason, nullif(btrim(coalesce(p_actor, '')), ''))
    -- 0141: infers customer_write_offs_active_customer_idx (the PARTIAL unique
    -- index), not the dropped UNIQUE constraint. A reversed row no longer
    -- blocks a new decision.
    on conflict (customer_id) where reversed_at is null do nothing;
  end if;

  update public.projects  set archived_at = now() where id = p_project_id and archived_at is null;
  update public.customers set archived_at = now() where id = v_cust_id   and archived_at is null;

  return p_project_id;
end;
$function$;

grant execute on function public.archive_project_guarded(uuid, text, text) to authenticated;

comment on function public.archive_project_guarded(uuid, text, text) is
  'The ONLY archive path in this database (0139; 0019''s unguarded '
  'archive_project was dropped by 0140). Refuses to archive while the customer '
  'owes money unless given a written override reason, in which case the debt is '
  'recorded as a WRITE-OFF and the archive proceeds — all in one transaction. '
  'Reads archive_blocked / owed_sar / payment_mode from v_customer_amount_payable '
  'and computes no arithmetic of its own; if it ever grows any, that is the bug. '
  '0141 repointed its ON CONFLICT target at the partial unique index so a '
  'previously-reversed write-off cannot silently swallow a new one.';

-- ===========================================================================
-- 6. restore_customer_guarded — the whole feature, in one transaction.
--
-- WHY AN RPC: the same reasoning 0139 gives for the archive side. PostgREST
-- runs each statement in its own transaction, so an app-side sequence could
-- half-apply and leave a restored customer whose project is still archived, or
-- a reversed write-off against a customer that is still archived. Both are
-- states nothing in the app knows how to display or repair.
--
-- IT WRITES NO MONEY. Two archived_at clears and one reversal mark. No
-- balance, no top-up, no amount, no recomputed figure. The credit a restored
-- customer shows is governed entirely by the balance_returned marker plus the
-- live prepaid-balance view — see the DO-NOT-FIX block in this file's header
-- for both states and why neither needs a write.
--
-- ONE TIMESTAMP: v_now is captured once and used for the reversal mark, so the
-- audit row and the restore cannot disagree by microseconds. (now() is
-- transaction-time in Postgres, which is why archive_project_guarded's two
-- separate now() calls already produce byte-identical stamps — captured
-- explicitly here anyway, because relying on that is relying on a detail a
-- reader has to know.)
--
-- EVERY GUARD RAISES. The two a user can legitimately hit raise
-- check_violation (PostgREST 23514, the app's existing CHECK_VIOLATION branch
-- in app/trips/actions.ts); the structural-drift guards raise plain, because
-- they describe a database state that should be impossible and want a human,
-- not a friendly message.
-- ===========================================================================
drop function if exists public.restore_customer_guarded(uuid, text);

create function public.restore_customer_guarded(
  p_customer_id uuid,
  p_actor       text default null
)
returns uuid
language plpgsql
as $function$
declare
  v_archived_at   timestamptz;
  v_exists        boolean;
  v_proj_total    int;
  v_proj_archived int;
  v_active_wo     int;
  v_now           timestamptz := now();
  v_actor         text := nullif(btrim(coalesce(p_actor, '')), '');
begin
  -- ---- the customer must exist -------------------------------------------
  select true, c.archived_at
    into v_exists, v_archived_at
    from public.customers c
   where c.id = p_customer_id;

  if v_exists is not true then
    raise exception 'Customer not found.';
  end if;

  -- ---- and must actually be archived --------------------------------------
  -- Not a no-op on purpose. "Restore" arriving for a live customer means the
  -- caller is working from a stale list, and silently succeeding would let the
  -- UI report a restore that restored nothing.
  if v_archived_at is null then
    raise exception
      'This customer is not archived, so there is nothing to restore.'
      using errcode = 'check_violation';
  end if;

  -- ---- exactly one project, and it must be archived too --------------------
  -- projects_customer_id_unique (0015) makes this 1:1 today and 0 live
  -- customers have more than one project. Asserted rather than assumed: the
  -- day 0015 is lifted (multi-project customers with separate finance is a
  -- named deferred Finance item, so this is scheduled, not hypothetical) this
  -- raises instead of guessing which project to bring back.
  select count(*), count(*) filter (where p.archived_at is not null)
    into v_proj_total, v_proj_archived
    from public.projects p
   where p.customer_id = p_customer_id;

  if v_proj_total <> 1 then
    raise exception
      'Expected exactly 1 project for this customer, found %. Restore cannot decide which project to bring back - restore the project side by hand and revisit restore_customer_guarded (0141) before lifting projects_customer_id_unique.',
      v_proj_total;
  end if;

  if v_proj_archived <> 1 then
    raise exception
      'This customer is archived but its project is not. Archiving always stamps both in one transaction (0019/0139), so this is drift - investigate before restoring.';
  end if;

  -- ---- at most one ACTIVE write-off ----------------------------------------
  -- Guaranteed by customer_write_offs_active_customer_idx; asserted anyway,
  -- because reversing an unknown number of decisions under one actor and one
  -- timestamp would destroy the audit trail this whole design exists to keep.
  select count(*)
    into v_active_wo
    from public.customer_write_offs w
   where w.customer_id = p_customer_id
     and w.reversed_at is null;

  if v_active_wo > 1 then
    raise exception
      'Found % ACTIVE write-offs for this customer; at most 1 is possible. The partial unique index is missing or was bypassed - fix that before restoring.',
      v_active_wo;
  end if;

  -- ---- reverse the write-off (KEEP the row) --------------------------------
  -- No-op when there is none, which is the correct behaviour for a PRE-GUARD
  -- archive such as Turki 1 (archived 2026-06-28, no write-off row). Nothing
  -- is inserted to "balance" that case: an archive that never wrote off a debt
  -- has nothing to reverse.
  --
  -- THE ROW IS MARKED, NEVER DELETED. amount_sar, reason and written_off_by
  -- stay exactly as frozen — the reversal records that the decision was
  -- undone, not that it never happened.
  update public.customer_write_offs
     set reversed_at = v_now,
         reversed_by = v_actor
   where customer_id = p_customer_id
     and reversed_at is null;

  -- ---- clear both stamps, together -----------------------------------------
  update public.projects
     set archived_at = null
   where customer_id = p_customer_id
     and archived_at is not null;

  update public.customers
     set archived_at = null
   where id = p_customer_id
     and archived_at is not null;

  -- NO BALANCE IS WRITTEN HERE, AND NONE SHOULD EVER BE. See the DO-NOT-FIX
  -- block in this file's header: customer_balance_returns is left exactly as
  -- it is (deleting it would resurrect a credit already paid out in cash), and
  -- v_customer_prepaid_balance is untouched (writing a negative top-up would
  -- double-count against a balance that was already correct — 0139).
  return p_customer_id;
end;
$function$;

grant execute on function public.restore_customer_guarded(uuid, text) to authenticated;

comment on function public.restore_customer_guarded(uuid, text) is
  'Un-archives a customer AND its project in ONE transaction on ONE timestamp, '
  'and REVERSES that customer''s active write-off if one exists — marking the '
  'row (reversed_at, reversed_by) and KEEPING it, never deleting it (0141). '
  'The debt returns because v_customer_amount_payable stops joining the '
  'reversed row and recomputes from the same live inputs; no stored amount is '
  'read back and no money math is repeated. WRITES NO BALANCE OF ANY KIND: '
  'customer_balance_returns is untouched, so a customer whose balance was '
  'already returned comes back with balance_returned still true (the figure '
  'plus its mark, rendered by BalanceWithMark) and one whose balance was never '
  'returned comes back with the credit intact. Raises check_violation (23514) '
  'when the customer is not archived, and raises loudly on structural drift '
  'rather than guessing.';

-- ===========================================================================
-- 7. ASSERT THE END STATE IN THE SAME RUN.
--
-- A migration that half-applied — columns added but the index missing, or a
-- view replaced while its join edit silently did not take — would otherwise
-- look identical to a successful one. This block raises, which rolls back the
-- whole transaction. Modelled on 0140's.
-- ===========================================================================
do $$
declare
  v_cols        int;
  v_old_uniq    int;
  v_part_idx    int;
  v_archive_fn  int;
  v_restore_fn  int;
  v_conflict_ok boolean;
  v_payable_ok  boolean;
  v_outst_ok    boolean;
  v_views_bad   int;
begin
  -- (1) both reversal columns exist
  select count(*) into v_cols
    from pg_attribute
   where attrelid = 'public.customer_write_offs'::regclass
     and attname in ('reversed_at', 'reversed_by')
     and not attisdropped;

  if v_cols <> 2 then
    raise exception
      'Expected reversed_at AND reversed_by on customer_write_offs, found % of 2.',
      v_cols;
  end if;

  -- (2) the old table-wide UNIQUE is gone
  select count(*) into v_old_uniq
    from pg_constraint
   where conrelid = 'public.customer_write_offs'::regclass
     and contype = 'u';

  if v_old_uniq <> 0 then
    raise exception
      'customer_write_offs still carries % table-wide UNIQUE constraint(s). A reversed row would block re-archiving a restored debtor - the collision this migration exists to remove.',
      v_old_uniq;
  end if;

  -- (3) the partial unique index exists AND is actually partial
  select count(*) into v_part_idx
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where i.indrelid = 'public.customer_write_offs'::regclass
     and c.relname = 'customer_write_offs_active_customer_idx'
     and i.indisunique
     and i.indpred is not null;

  if v_part_idx <> 1 then
    raise exception
      'customer_write_offs_active_customer_idx must exist exactly once as a PARTIAL unique index, found %. Without the predicate it is the old constraint under a new name.',
      v_part_idx;
  end if;

  -- (4) exactly one signature each (the 0038 rule)
  select count(*) into v_archive_fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'archive_project_guarded';

  select count(*) into v_restore_fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'restore_customer_guarded';

  if v_archive_fn <> 1 then
    raise exception
      'archive_project_guarded should be present exactly once, found %. Archiving is the only archive path there is - fix before continuing.',
      v_archive_fn;
  end if;

  if v_restore_fn <> 1 then
    raise exception
      'restore_customer_guarded should be present exactly once, found %. A stray overload is an unguarded second restore path.',
      v_restore_fn;
  end if;

  -- (5) the archive RPC really did pick up the new conflict target. A body
  --     that still says a bare `on conflict (customer_id)` will raise 42P10 on
  --     the next forced archive, at the worst possible moment.
  select pg_get_functiondef(p.oid) ilike '%on conflict (customer_id) where reversed_at is null%'
    into v_conflict_ok
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'archive_project_guarded';

  if v_conflict_ok is not true then
    raise exception
      'archive_project_guarded is live but its ON CONFLICT target does not name the partial index predicate. The next forced archive would fail with 42P10.';
  end if;

  -- (6) both views really did narrow their join
  select pg_get_viewdef('public.v_customer_amount_payable'::regclass) ilike '%reversed_at%'
    into v_payable_ok;
  select pg_get_viewdef('public.v_invoice_outstanding_live'::regclass) ilike '%reversed_at%'
    into v_outst_ok;

  if v_payable_ok is not true or v_outst_ok is not true then
    raise exception
      'A view was replaced without its reversed_at predicate (payable ok: %, outstanding ok: %). A reversed write-off would keep suppressing the debt.',
      v_payable_ok, v_outst_ok;
  end if;

  -- (7) §6 security footer held on both replaced views
  select count(*) into v_views_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'v'
     and c.relname in ('v_customer_amount_payable', 'v_invoice_outstanding_live')
     and (
       not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false)
       or has_table_privilege('anon', c.oid, 'select')
     );

  if v_views_bad <> 0 then
    raise exception
      '% replaced view(s) lost security_invoker or are anon-readable. create or replace view does not preserve reloptions - the footer must be restated.',
      v_views_bad;
  end if;
end;
$$;

commit;

-- ===========================================================================
-- VERIFICATION — RUN THESE BY HAND AFTER APPLYING. NOT EXECUTED BY THIS FILE.
--
-- Blocks A and B read the new structure. C, D and E rehearse the three live
-- archived customers WITHOUT committing anything (each rolls back), so the
-- reversal can be proven on real data before anybody clicks a button. F and G
-- are the two claims rule 3 asks to be confirmed explicitly.
-- ===========================================================================
--
-- -- A. Structure. Expect: 2 columns; 0 table-wide UNIQUE; 1 partial unique
-- --    index whose predicate is (reversed_at IS NULL).
-- select attname, format_type(atttypid, atttypmod) as type, attnotnull
--   from pg_attribute
--  where attrelid = 'public.customer_write_offs'::regclass
--    and attnum > 0 and not attisdropped
--  order by attnum;
--
-- select c.relname, i.indisunique, pg_get_expr(i.indpred, i.indrelid) as predicate
--   from pg_index i join pg_class c on c.oid = i.indexrelid
--  where i.indrelid = 'public.customer_write_offs'::regclass;
--
-- -- B. Both RPCs, exactly one signature each.
-- select p.oid::regprocedure::text
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public'
--    and p.proname in ('archive_project_guarded', 'restore_customer_guarded')
--  order by 1;
--
-- -- C. THE REVERSAL CASE — TEST 111 Co. (104e158e-…), postpaid, written off
-- --    20,056.00, payable currently 0. Expect after restore:
-- --      archived_at        -> NULL on both customer and project
-- --      is_written_off     -> false
-- --      amount_payable_sar -> -20056.00
-- --      owed_sar           ->  20056.00
-- --      archive_blocked    -> true
-- --      write-off row      -> STILL THERE, reversed_at set, amount_sar
-- --                            unchanged at 20056.00
-- --    The figure returns because postpaid_unpaid_sar already reads 20056.00 —
-- --    the same number from the live inputs, not from w.amount_sar.
-- begin;
--   select customer_name, archived_at, is_written_off, written_off_sar,
--          postpaid_unpaid_sar, amount_payable_sar, owed_sar, archive_blocked
--     from public.v_customer_amount_payable
--    where customer_id::text like '104e158e%';
--
--   select public.restore_customer_guarded(
--            (select id from public.customers where id::text like '104e158e%'),
--            'verification block C');
--
--   select customer_name, archived_at, is_written_off, written_off_sar,
--          postpaid_unpaid_sar, amount_payable_sar, owed_sar, archive_blocked
--     from public.v_customer_amount_payable
--    where customer_id::text like '104e158e%';
--
--   select id, amount_sar, reason, written_off_by, created_at,
--          reversed_at, reversed_by
--     from public.customer_write_offs
--    where customer_id::text like '104e158e%';
--
--   select id, archived_at from public.projects
--    where customer_id::text like '104e158e%';
-- rollback;
--
-- -- D. THE RECEIVABLE COMES BACK BY COMPOSITION — same customer, no second
-- --    edit anywhere. Expect its confirmed-unpaid invoices to move off basis
-- --    'written_off' and re-enter v_receivables_open.
-- begin;
--   select invoice_number, outstanding_sar, outstanding_basis
--     from public.v_invoice_outstanding_live
--    where customer_id::text like '104e158e%'
--    order by invoice_number;
--   select count(*) as receivables_rows, coalesce(sum(outstanding_sar), 0) as total
--     from public.v_receivables_open;
--
--   select public.restore_customer_guarded(
--            (select id from public.customers where id::text like '104e158e%'),
--            'verification block D');
--
--   select invoice_number, outstanding_sar, outstanding_basis
--     from public.v_invoice_outstanding_live
--    where customer_id::text like '104e158e%'
--    order by invoice_number;
--   select count(*) as receivables_rows, coalesce(sum(outstanding_sar), 0) as total
--     from public.v_receivables_open;
-- rollback;
--
-- -- E. THE PRE-GUARD ARCHIVE — Turki 1 (109bfd73-…, archived 2026-06-28,
-- --    payment_mode NULL, payable -1035.00, NO write-off row). Expect a clean
-- --    restore, zero write-off rows before AND after, and the payable
-- --    unchanged at -1035.00 (it was never suppressed, so there is nothing to
-- --    un-suppress). Nothing must be inserted to "balance" this case.
-- begin;
--   select count(*) as wo_rows from public.customer_write_offs
--    where customer_id::text like '109bfd73%';
--
--   select public.restore_customer_guarded(
--            (select id from public.customers where id::text like '109bfd73%'),
--            'verification block E');
--
--   select customer_name, archived_at, is_written_off,
--          amount_payable_sar, owed_sar, archive_blocked
--     from public.v_customer_amount_payable
--    where customer_id::text like '109bfd73%';
--   select count(*) as wo_rows from public.customer_write_offs
--    where customer_id::text like '109bfd73%';
-- rollback;
--
-- -- F. balance_returned = TRUE — Seder Facility Mang. Co. (de4b1ffc-…,
-- --    prepaid, returned 11,895.00 on 2026-08-20, balance_sar 11,895.00).
-- --    Expect after restore: archived_at NULL, and EVERY money column
-- --    BYTE-IDENTICAL — prepaid_balance_sar 11895.00, amount_payable_sar
-- --    11895.00, balance_returned STILL TRUE, returned_sar 11895.00.
-- --    The customer is back with NO SPENDABLE CREDIT, and the MARK is the only
-- --    thing carrying that fact — which is why the figure must never be
-- --    rendered bare. Restore wrote nothing here; that is the point.
-- --    NAME TRAP: two customers differ only by the case of one letter
-- --    ("Seder Facility mang. Co." vs "Seder Facility Mang. Co."). Match by id.
-- begin;
--   select customer_name, archived_at, payment_mode, prepaid_balance_sar,
--          amount_payable_sar, balance_returned, returned_sar, returned_method
--     from public.v_customer_amount_payable
--    where customer_id::text like 'de4b1ffc%';
--
--   select public.restore_customer_guarded(
--            (select id from public.customers where id::text like 'de4b1ffc%'),
--            'verification block F');
--
--   select customer_name, archived_at, payment_mode, prepaid_balance_sar,
--          amount_payable_sar, balance_returned, returned_sar, returned_method
--     from public.v_customer_amount_payable
--    where customer_id::text like 'de4b1ffc%';
--
--   -- the return row must be untouched, not deleted
--   select customer_id, amount_sar, method, returned_on, returned_by
--     from public.customer_balance_returns
--    where customer_id::text like 'de4b1ffc%';
-- rollback;
--
-- -- G. balance_returned = FALSE — the credit comes back WITH the customer,
-- --    intact, because nothing touched it. No live customer is in this state
-- --    today (the only credit customer had its balance returned), so this is
-- --    the shape to check the first time one occurs: archive a customer in
-- --    credit WITHOUT returning the balance, restore, and expect
-- --    prepaid_balance_sar and amount_payable_sar unchanged and
-- --    balance_returned still false.
-- select customer_name, archived_at, payment_mode, prepaid_balance_sar,
--        amount_payable_sar, balance_returned
--   from public.v_customer_amount_payable
--  where amount_payable_sar > 0
--  order by amount_payable_sar desc;
--
-- -- H. THE COLLISION THAT §2 EXISTS TO PREVENT — restore, then force-archive
-- --    the SAME customer again. Expect a SECOND write-off row (new decision,
-- --    new reason, new actor) alongside the reversed first one, and the
-- --    customer archived. Under the old UNIQUE constraint the insert would
-- --    have done nothing and left archive_blocked true on an archived row.
-- begin;
--   select public.restore_customer_guarded(
--            (select id from public.customers where id::text like '104e158e%'),
--            'verification block H - restore');
--
--   select public.archive_project_guarded(
--            (select id from public.projects
--               where customer_id::text like '104e158e%'),
--            'verification block H - re-archive',
--            'verification');
--
--   select id, amount_sar, reason, written_off_by, created_at,
--          reversed_at, reversed_by
--     from public.customer_write_offs
--    where customer_id::text like '104e158e%'
--    order by created_at;
--
--   select customer_name, archived_at, is_written_off,
--          amount_payable_sar, archive_blocked
--     from public.v_customer_amount_payable
--    where customer_id::text like '104e158e%';
-- rollback;
--
-- -- I. §6 posture. The two counts matching IS the check, not the number.
-- --    Expect 47 / 47 / 0 — this migration adds NO view (both were
-- --    replacements), so the count must not move.
-- select count(*) as views,
--        count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--        count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where c.relkind = 'v' and n.nspname = 'public';
