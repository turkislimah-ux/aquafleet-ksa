-- 0139 — YOU CANNOT ARCHIVE AWAY A DEBT.
--
-- **DRAFTED, NOT APPLIED.** Per CLAUDE.md §2/§5 this file is written by Claude
-- Code and applied by the architect after review. Nothing below has been run.
-- The verification block at the bottom is the acceptance test, and it is
-- written to be run BEFORE the app half exists — every check is pure SQL.
--
-- ============================================================================
-- WHAT THIS IS
--
-- Archiving a customer/project today is a soft-delete with no money opinion
-- (0019). That means an unpaid postpaid customer or an overdrawn prepaid one
-- can be archived and their debt simply stops being visible. This migration
-- makes that impossible, and gives the two legitimate exits a record:
--
--   1. THE BLOCK        — archiving is refused while money is owed TO US.
--   2. THE RETURN       — a prepaid customer in CREDIT is archivable, but that
--                         leftover is money WE owe THEM. Returning it is an
--                         outbound payment and is recorded as one.
--   3. THE WRITE-OFF    — a manager may force the archive with a REASON. That
--                         is not a bypass, it is a decision: the debt is
--                         written off, zeroed, and attributed.
--
-- NOTHING HERE INVENTS A NUMBER. The block reads the same Amount Payable the
-- Finance/Invoice tab shows; the credit it offers to return is the same
-- prepaid balance v_customer_prepaid_balance already publishes (0137). This
-- file adds ONE new derivation (v_customer_amount_payable) and it exists
-- because a data-integrity guard that only lives in TypeScript is not a guard.
-- ============================================================================
--
-- ---------------------------------------------------------------------------
-- THE RULE, IN THE ONE SIGN CONVENTION IT IS WRITTEN IN.
--
-- `amount_payable_sar` is SIGNED, and the sign is the meaning — identical to
-- the Finance/Invoice tab's Amount Payable column, deliberately, so the guard
-- and the screen can never mean different things by the same word:
--
--     amount_payable_sar < 0   money owed TO US        -> ARCHIVE BLOCKED
--     amount_payable_sar = 0   settled                 -> archive allowed
--     amount_payable_sar > 0   credit we owe THEM      -> archive allowed,
--                                                        return offered
--
-- **THE BLOCK IS EXACTLY "Amount Payable IS NEGATIVE", FOR BOTH MODES.** Turki
-- stated it as two rules — "postpaid Amount Payable > 0 OR prepaid balance
-- < 0" — because he states owed as a positive quantity. They are the same
-- rule once the sign convention is fixed, and collapsing them to one
-- expression is the point: two expressions of one rule is two things that can
-- drift. `owed_sar` (positive, = greatest(0, -amount_payable_sar)) is
-- published alongside for anyone who wants to read it Turki's way.
--
-- WHERE EACH SIDE COMES FROM, AND WHAT IS NOT RECOMPUTED:
--   prepaid  -> v_customer_prepaid_balance.balance_sar, COMPOSED, not
--               restated. That view is 0137's declared SQL mirror of
--               lib/prepaid.ts derivedBalanceItems. This file does not touch
--               it, does not copy it, and does not add a write-off concept to
--               it (see THE WRITE-OFF LAYER below).
--   postpaid -> delivered trips and non-void special charges that are not on
--               a PAID invoice. This has no SQL home yet — the Finance tab
--               computes it in TypeScript from derivedBalanceItems([], …) —
--               so it is expressed here for the first time, and that makes it
--               A SECOND EXPRESSION OF A MONEY RULE. It is declared as one
--               below, exactly as 0137 §1 declared itself.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- THE WRITE-OFF LAYER — WHY IT SITS ABOVE THE BALANCE AND NOT INSIDE IT.
--
-- A write-off must "zero what the customer owes". The obvious implementation
-- — subtract it inside v_customer_prepaid_balance — is WRONG, and rejected
-- here for a stated reason: that view is in lockstep with lib/prepaid.ts, and
-- lib/prepaid.ts has no write-off concept. Changing one without the other is
-- the exact drift 0137's own header forbids, and it would shift a balance
-- figure the whole app reads.
--
-- So the write-off is applied ONE LAYER UP: the raw ledger keeps telling the
-- truth about what was consumed, and the PAYABLE view reports 0 because a
-- write-off exists. Same shape as 0137's own separation:
--
--     "What did this customer actually consume?"  -> v_customer_prepaid_balance
--     "What do they still owe us?"                -> v_customer_amount_payable
--
-- A written-off customer is ALWAYS an archived one — the write-off row is
-- inserted in the same transaction as the archive stamp (archive_project_
-- guarded below), and nothing else can insert one. That is what structurally
-- guarantees Turki's verification point (4): no non-archived customer's
-- balance or Amount Payable can move, because no non-archived customer can
-- have a write-off row.
-- ---------------------------------------------------------------------------
--
-- ---------------------------------------------------------------------------
-- OPEN QUESTIONS FOR THE ARCHITECT — decided one way here, flagged because
-- each is a judgement call and reversing one is cheap NOW and expensive later.
--
-- (Q1) UNKNOWN PAYMENT MODE FAILS CLOSED — a customer whose projects resolve
--      to no single payment_mode is treated as POSTPAID for the block, i.e.
--      unpaid delivered work still blocks the archive. 0137 set the precedent
--      for the other direction (unknown keeps the FROZEN figure) and the
--      principle is the same one: never suppress a debt we cannot prove is
--      settled. The cost is that a legacy pre-0025 project with unpaid
--      delivered trips now needs an explicit write-off to archive.
--
-- (Q2) THE GUARD IS CUSTOMER-WIDE; THE FINANCE TAB'S COLUMN IS NOT. The tab
--      resolves ONE project per customer and reads page-filtered trips
--      (archived-project and terminated-driver rows are dropped for display).
--      This view sums every project of the customer, archived included,
--      because an archived project's unpaid delivered trip is still a debt.
--      Measured today: 3 such trips exist (1,035.00, customer "Turki 1",
--      already archived, payment_mode null) and 0 customers have more than one
--      active project, so the two agree on every live row. They can diverge
--      the day someone adds a second project. Deliberate: the guard should be
--      the conservative one.
--
-- (Q3) ONE RETURN AND ONE WRITE-OFF PER CUSTOMER, enforced by unique indexes.
--      A double-clicked "Return balance" must not produce two outbound
--      payments. Partial returns are NOT supported — nobody asked for them and
--      allowing them would mean the "returned" mark needs an amount
--      comparison rather than an existence check. If partials are ever wanted,
--      drop the unique index and the mark becomes sum-based.
--
-- (Q4) "MANAGER" IS NOT ENFORCED, BECAUSE THIS APP HAS NO ROLE GATE. There is
--      no RBAC layer (lib/actions/identity.ts reads a staff row for a display
--      label and nothing authorises against it), and Turki's own framing says
--      the feature is "not RBAC-gated". The override is therefore available to
--      any authenticated user AND IS FULLY ATTRIBUTED — reason is NOT NULL and
--      non-blank, actor and timestamp are recorded. The audit trail is the
--      control. If a real role gate lands later, it goes in the RPC below and
--      nowhere else.
--
-- (Q5) 0019's archive_project() IS LEFT IN PLACE. A function's argument list
--      cannot change under create-or-replace, so the guarded version is a NEW
--      function. The old one stays callable until the app half stops calling
--      it; dropping it is a LATER migration, in the DROP direction CLAUDE.md
--      requires (strip app references first, then drop). **Until that drop
--      lands, archive_project() is an unguarded back door** — that is the one
--      thing about this migration that is not self-contained, and it is why
--      the drop should be scheduled, not left to memory.
-- ---------------------------------------------------------------------------

begin;

-- ===========================================================================
-- 1. customer_write_offs — the forced-archive audit record.
--
-- amount_sar is FROZEN at write-off time, exactly like invoices.amount_due_sar
-- is frozen at confirm. It is what was owed when the decision was taken, and
-- it is never recomputed afterwards: re-deriving it later would silently
-- rewrite the size of a decision someone signed their name to.
--
-- customer_id is UNIQUE (Q3) and ON DELETE RESTRICT — an audit row must
-- outlive every attempt to tidy up around it.
-- ===========================================================================
create table if not exists public.customer_write_offs (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null unique references public.customers(id) on delete restrict,
  -- The project archived in the same transaction. Recorded because 0019
  -- archives a project and its 1:1 customer together, so "which archive was
  -- this" has a two-part answer and storing only half of it loses the trail.
  project_id    uuid references public.projects(id) on delete restrict,
  -- Positive. What was owed at the moment of the override, in the same
  -- VAT-inclusive basis the Amount Payable column shows.
  amount_sar    numeric(12,2) not null check (amount_sar > 0),
  -- The payment mode the customer resolved to when the debt was written off.
  -- Snapshot, not a join: the projects it was derived from may be edited or
  -- archived later, and this row must still say what it meant.
  payment_mode  text check (payment_mode is null or payment_mode in ('prepaid','postpaid')),
  -- NOT NULL AND NOT BLANK. "With a reason" is the whole difference between an
  -- override and a bypass, so the database refuses a blank one rather than
  -- trusting a form validator.
  reason        text not null check (btrim(reason) <> ''),
  -- Free text, matching customer_topups.entered_by / commission_payouts.
  -- approved_by — this app has no auth-user FK table to point at.
  written_off_by text,
  created_at    timestamptz not null default now()
);

create index if not exists customer_write_offs_customer_idx
  on public.customer_write_offs (customer_id);

alter table public.customer_write_offs enable row level security;
drop policy if exists "authenticated_all_customer_write_offs" on public.customer_write_offs;
create policy "authenticated_all_customer_write_offs"
  on public.customer_write_offs for all to authenticated using (true) with check (true);

comment on table public.customer_write_offs is
  'Forced-archive audit record: a manager overrode the archive block on a '
  'customer who still owed money, and that debt was written off. amount_sar is '
  'FROZEN at the moment of the decision and never recomputed. Existence of a '
  'row is what makes v_customer_amount_payable report 0 for this customer — '
  'the underlying ledger (v_customer_prepaid_balance, trips, invoices) is '
  'never rewritten. Only archive_project_guarded() inserts here, in the same '
  'transaction as the archive stamp, so a write-off can never exist for a '
  'non-archived customer (0139).';

-- ===========================================================================
-- 2. customer_balance_returns — the OUTBOUND payment.
--
-- **THIS IS NOT A TOP-UP AND MUST NEVER BE READ AS ONE.** Its shape mirrors
-- customer_topups (0025 + 0040) because it is the same event in the other
-- direction and the form is the same form — but nothing in the balance chain
-- reads this table. Specifically:
--
--   * v_customer_prepaid_balance does NOT subtract it.
--   * lib/prepaid.ts does NOT know it exists.
--   * the customer's balance figure is UNCHANGED by returning it.
--
-- That is Turki's rule verbatim: the return MARKS the balance as returned, it
-- does not move it. The reason it is right rather than merely instructed: the
-- balance is the derived record of what was topped up and consumed, and the
-- money going back out is a settlement of that record, not another line in it
-- — the same reason 0137's paid invoices are RECORD-ONLY rows on the prepaid
-- statement and do not deduct (lib/prepaid.ts SettlementStatementInput).
--
-- Because the figure does not move, THE MARK IS LOAD-BEARING. A positive
-- balance sitting next to no mark means "we still owe this"; the same figure
-- with a mark means "already paid back". The UI half must render them
-- adjacent — a returned balance shown bare is a false liability.
-- ===========================================================================
create table if not exists public.customer_balance_returns (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null unique references public.customers(id) on delete restrict,
  -- FROZEN at return time, taken from v_customer_amount_payable by the RPC —
  -- never supplied by the caller (see return_customer_balance below).
  amount_sar    numeric(12,2) not null check (amount_sar > 0),
  method        text not null check (method in ('cash','bank_transfer')),
  reference     text,
  photo_path    text,
  returned_on   date not null default current_date,
  note          text,
  returned_by   text,
  created_at    timestamptz not null default now(),
  -- Byte-equivalent to customer_topups_bank_transfer_proof_check (0040): a
  -- bank transfer carries a reference AND a photo of it. Same rule, same
  -- reason, and stated at the same layer so neither direction of money can be
  -- recorded to a weaker standard than the other.
  constraint customer_balance_returns_bank_transfer_proof_check check (
    method is distinct from 'bank_transfer'
    or (reference is not null and photo_path is not null)
  )
);

create index if not exists customer_balance_returns_customer_idx
  on public.customer_balance_returns (customer_id);

alter table public.customer_balance_returns enable row level security;
drop policy if exists "authenticated_all_customer_balance_returns" on public.customer_balance_returns;
create policy "authenticated_all_customer_balance_returns"
  on public.customer_balance_returns for all to authenticated using (true) with check (true);

comment on table public.customer_balance_returns is
  'Outbound return of an archived prepaid customer''s leftover credit. Mirrors '
  'customer_topups in shape (cash/bank_transfer, reference + photo proof for '
  'transfers) but is the OPPOSITE direction. NOTHING IN THE BALANCE CHAIN '
  'READS THIS TABLE: v_customer_prepaid_balance does not subtract it and '
  'lib/prepaid.ts does not know it exists. The balance figure is deliberately '
  'unchanged — this row is the MARK that says the figure has already been paid '
  'back, and a positive balance rendered without that mark is a false '
  'liability (0139).';

-- ===========================================================================
-- 3. Storage bucket for return proofs — PRIVATE.
--
-- A separate bucket rather than reusing topup-proofs, following the same
-- one-bucket-per-proof-type precedent as invoice-proofs (0027 §8),
-- special-charge-images (0032 §3) and topup-proofs (0040 §2). Keyed by
-- customer_id, app-generated path (`${customerId}/return-${Date.now()}.${ext}`),
-- never the raw uploaded filename.
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('balance-return-proofs', 'balance-return-proofs', false)
on conflict (id) do nothing;

drop policy if exists "authenticated_rw_balance_return_proofs" on storage.objects;
create policy "authenticated_rw_balance_return_proofs"
  on storage.objects for all to authenticated
  using (bucket_id = 'balance-return-proofs')
  with check (bucket_id = 'balance-return-proofs');

-- ===========================================================================
-- 4. v_customer_amount_payable — THE ONE DEFINITION OF THE RULE.
--
-- The guard RPC reads it, the archive tab reads it, and the Finance tab's
-- TypeScript column is its mirror. One derivation, three consumers — the same
-- discipline 0137 established.
--
-- **SECOND EXPRESSION OF A MONEY RULE, DECLARED AS ONE.** The postpaid half
-- below restates what app/trips/FinanceTab.tsx computes via
-- derivedBalanceItems([], unpaidTrips, unpaidCharges). The conventions it must
-- copy exactly, all of them inherited from lib/prepaid.ts:
--
--   * VAT-inclusive, ROUNDED PER ITEM: round(amount * 1.15, 2) then summed.
--     NOT sum-then-round — that disagrees by riyals on a real pool.
--   * a trip counts only once DELIVERED (delivered_at is not null), priced at
--     coalesce(trips.rate_sar, projects.rate_per_trip_sar) — frozen rate
--     first, project rate only as the fallback (0128).
--   * a trip reaches its customer through projects.customer_id.
--     trips.customer_id is NULL on every row and must never be used here.
--   * "not paid" means the trip's invoice is not status='paid'. A trip on a
--     DRAFT, REVIEW, CONFIRMED or VOID invoice still owes — drafting,
--     reviewing and confirming move no money. This is the app's `invoiceLocked`
--     flag (app/trips/page.tsx) restated in SQL.
--   * a special charge counts once it is on a non-void invoice and stops
--     counting when that invoice is paid — the app's `SpecialChargeRow.paid`.
--
-- IF ANY OF THOSE CHANGE IN lib/prepaid.ts OR IN FinanceTab.tsx, THEY CHANGE
-- HERE IN THE SAME COMMIT. Verification block D is the drift check.
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
  'FinanceTab.tsx computes via derivedBalanceItems([], …). An existing '
  'customer_write_offs row forces 0 WITHOUT rewriting any ledger row beneath. '
  'Unknown payment mode falls to the postpaid arm on purpose: never suppress a '
  'debt we cannot classify. archive_blocked is the archive guard itself, '
  'published so the RPC and the UI ask one expression (0139).';

-- ===========================================================================
-- 5. v_invoice_outstanding_live — a written-off customer stops being a
--    receivable.
--
-- "Do not leave a phantom receivable on the books after a forced archive."
-- This is where that is enforced, and it costs one CASE branch: a written-off
-- customer's confirmed-unpaid invoices report outstanding 0.00 on basis
-- 'written_off'. v_receivables_open filters `outstanding_sar > 0`, so it drops
-- them BY COMPOSITION — no second edit, the same free ride 0137 got.
--
-- **42P16 DISCIPLINE — READ BEFORE EDITING.** No column is added, removed,
-- reordered or renamed here, and both touched columns keep their exact live
-- types, verified with format_type(atttypid, atttypmod) on pg_attribute
-- (NOT pg_get_viewdef, which does not show a resolved type):
--     outstanding_sar    numeric(12,2)   -> whole CASE re-wrapped in the same
--                                           ::numeric(12,2) 0137 added
--     outstanding_basis  text            -> now cast ::text EXPLICITLY. It was
--                                           previously three bare literals
--                                           resolving to text by inference;
--                                           pinning it means a future branch
--                                           cannot quietly shift the column
--                                           type and cost another apply cycle.
-- Everything else in this view is byte-identical to 0137.
--
-- `create or replace view` does NOT preserve reloptions, so security_invoker
-- and the grants are restated below — the standing rule for every view.
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
  -- ::numeric(12,2) IS LOAD-BEARING, NOT COSMETIC — see 0137's note and this
  -- file's §5 header. The written-off branch is FIRST because it outranks
  -- both: once a debt is written off there is nothing left to cap.
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
  'A WRITTEN-OFF customer (customer_write_offs, 0139) reports 0.00 on basis '
  '''written_off'' and therefore leaves v_receivables_open by composition — no '
  'phantom receivable survives a forced archive. Never rewrites the document '
  '(0137, extended by 0139).';

-- ===========================================================================
-- 6. archive_project_guarded() — the block, the override, and the archive, in
--    ONE transaction.
--
-- WHY AN RPC AND NOT APP CODE: this is a data-integrity rule, not a UI
-- courtesy. A check in a server action is advisory — anything else that
-- updates archived_at bypasses it. And the write-off insert and the archive
-- stamp MUST be atomic: PostgREST runs each statement in its own transaction,
-- so an app-side pair could half-apply and leave either a debt archived with
-- no write-off, or a write-off against a customer that is still active. Same
-- reasoning 0019 gives for archiving the project and customer together.
--
-- A NEW FUNCTION, not a replacement: a function's argument list cannot change
-- under create-or-replace. 0019's archive_project() is left in place and
-- should be dropped once the app half stops calling it (Q5).
--
-- SECURITY INVOKER (no security clause) — RLS-respecting, same as 0019.
-- ===========================================================================
create or replace function public.archive_project_guarded(
  p_project_id      uuid,
  p_override_reason text default null,
  p_actor           text default null
)
returns uuid
language plpgsql
as $$
declare
  v_cust_id  uuid;
  v_blocked  boolean;
  v_owed     numeric(12,2);
  v_mode     text;
  v_reason   text := nullif(btrim(coalesce(p_override_reason, '')), '');
begin
  select customer_id into v_cust_id
    from public.projects
   where id = p_project_id;
  if v_cust_id is null then
    raise exception 'Project not found.';
  end if;

  -- ONE read of the ONE definition. Nothing is recomputed here — if this
  -- function ever grows its own arithmetic, that is the bug.
  select ap.archive_blocked, ap.owed_sar, ap.payment_mode
    into v_blocked, v_owed, v_mode
    from public.v_customer_amount_payable ap
   where ap.customer_id = v_cust_id;

  if v_blocked and v_reason is null then
    -- The message carries the figure because the caller needs to show it and
    -- re-deriving it app-side would be a second answer to the same question.
    raise exception
      'This customer still owes % SAR. Archiving is blocked until it is settled, or overridden with a written reason.',
      to_char(v_owed, 'FM999,999,990.00')
      using errcode = 'check_violation';
  end if;

  if v_blocked then
    -- OVERRIDE = WRITE-OFF. The debt does not quietly disappear with the
    -- customer; it is zeroed on the record, with an amount, a reason and a
    -- name against it.
    insert into public.customer_write_offs
      (customer_id, project_id, amount_sar, payment_mode, reason, written_off_by)
    values
      (v_cust_id, p_project_id, v_owed, v_mode, v_reason, nullif(btrim(coalesce(p_actor, '')), ''))
    -- Idempotent under the unique index (Q3): a retry of a half-seen call
    -- must not raise, and must not overwrite the original decision.
    on conflict (customer_id) do nothing;
  end if;

  -- Guarded exactly as 0019: only stamp rows still active, so a double-archive
  -- is a true no-op and the original timestamp survives.
  update public.projects
     set archived_at = now()
   where id = p_project_id and archived_at is null;

  update public.customers
     set archived_at = now()
   where id = v_cust_id and archived_at is null;

  -- trips are intentionally untouched (0019) — hidden via the project's
  -- archived_at at the query layer, never by a column on trips.

  return p_project_id;
end;
$$;

grant execute on function public.archive_project_guarded(uuid, text, text) to authenticated;

comment on function public.archive_project_guarded(uuid, text, text) is
  'Archive a project and its 1:1 customer (0019) — REFUSED while '
  'v_customer_amount_payable.archive_blocked is true, unless a non-blank '
  'override reason is supplied, in which case the outstanding amount is '
  'WRITTEN OFF (customer_write_offs) in the same transaction. Reads the block '
  'from the view and computes nothing of its own (0139).';

-- ===========================================================================
-- 7. return_customer_balance() — the outbound payment, recorded.
--
-- **THE CALLER DOES NOT GET TO NAME THE AMOUNT.** It is read from
-- v_customer_amount_payable inside this function and frozen into the row. A
-- client-supplied figure would be a second opinion about a number the database
-- already knows, and the only outcomes of a disagreement are paying back too
-- much or recording a return that does not match what was paid.
--
-- Preconditions, all enforced here rather than in a form:
--   * the customer must be ARCHIVED — a return is the closing act of an
--     archive, not a routine withdrawal. A live prepaid customer's credit is
--     theirs to consume.
--   * the credit must be strictly positive.
--   * one return per customer (Q3) — the unique index is the real guarantee;
--     this raises a readable error before hitting it.
-- ===========================================================================
create or replace function public.return_customer_balance(
  p_customer_id uuid,
  p_method      text,
  p_reference   text default null,
  p_photo_path  text default null,
  p_returned_on date default null,
  p_note        text default null,
  p_actor       text default null
)
returns uuid
language plpgsql
as $$
declare
  v_amount   numeric(12,2);
  v_archived timestamptz;
  v_id       uuid;
begin
  if p_method is null or p_method not in ('cash', 'bank_transfer') then
    raise exception 'Return method must be cash or bank_transfer.'
      using errcode = 'check_violation';
  end if;

  select ap.archived_at, ap.amount_payable_sar
    into v_archived, v_amount
    from public.v_customer_amount_payable ap
   where ap.customer_id = p_customer_id;

  if not found then
    raise exception 'Customer not found.';
  end if;

  if v_archived is null then
    raise exception 'Only an archived customer''s balance can be returned.'
      using errcode = 'check_violation';
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'This customer holds no balance to return.'
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.customer_balance_returns where customer_id = p_customer_id) then
    raise exception 'This customer''s balance has already been returned.'
      using errcode = 'unique_violation';
  end if;

  insert into public.customer_balance_returns
    (customer_id, amount_sar, method, reference, photo_path, returned_on, note, returned_by)
  values
    (p_customer_id,
     v_amount,
     p_method,
     nullif(btrim(coalesce(p_reference, '')), ''),
     nullif(btrim(coalesce(p_photo_path, '')), ''),
     coalesce(p_returned_on, current_date),
     nullif(btrim(coalesce(p_note, '')), ''),
     nullif(btrim(coalesce(p_actor, '')), ''))
  returning id into v_id;

  -- NO BALANCE IS WRITTEN. Deliberate, and the whole point of the table — see
  -- §2. If a future edit adds an update to customer_topups or to any balance
  -- source here, it is wrong.

  return v_id;
end;
$$;

grant execute on function public.return_customer_balance(uuid, text, text, text, date, text, text) to authenticated;

comment on function public.return_customer_balance(uuid, text, text, text, date, text, text) is
  'Record the outbound return of an archived prepaid customer''s leftover '
  'credit. The AMOUNT IS READ FROM v_customer_amount_payable, never supplied '
  'by the caller. Requires the customer to be archived and in credit, and '
  'allows one return per customer. Writes NO balance — the figure is unchanged '
  'and this row is the mark that it has been paid back (0139).';

commit;

-- ===========================================================================
-- VERIFICATION — run AFTER apply, before the app half exists. Every block is
-- pure SQL and read-only except F, which is explicitly a rehearsal on a
-- customer chosen by the architect.
--
-- Turki's four acceptance points map to blocks A/B, C, D/E and G.
-- ===========================================================================

-- A. THE BLOCK FIRES EXACTLY WHERE IT SHOULD, AND NOWHERE ELSE.
--    Expect: archive_blocked is true on precisely the rows where owed_sar > 0,
--    and false everywhere else. `mismatches` must be 0.
--
-- select count(*) as mismatches
--   from public.v_customer_amount_payable
--  where archive_blocked <> (owed_sar > 0);

-- B. THE FULL PICTURE, EYEBALLED. Compare against the Finance/Invoice tab's
--    Amount Payable column, which must agree row for row on ACTIVE customers.
--    Measured before this migration was drafted (all six active customers):
--      TEST 111 Co.              postpaid   -20,056.00
--      Turki Contraction Co.     postpaid   -38,295.00
--      VVV CO.                   postpaid   -46,460.00
--      MMM construction Co.      prepaid    -48,290.00
--      Seder Facility mang. Co.  prepaid    -55,274.00
--      Seder Facility Mang. Co.  prepaid    +11,895.00
--
-- select customer_name, payment_mode, archived_at is not null as archived,
--        round(amount_payable_sar, 2) as amount_payable_sar,
--        round(owed_sar, 2) as owed_sar,
--        archive_blocked, is_written_off, balance_returned
--   from public.v_customer_amount_payable
--  order by archive_blocked desc, amount_payable_sar;

-- C. NOTHING MOVED THAT SHOULD NOT HAVE. With no write-off rows yet, the new
--    view's prepaid arm must equal v_customer_prepaid_balance exactly, and
--    v_invoice_outstanding_live must be unchanged from its 0137 behaviour.
--    Both counts must be 0.
--
-- select
--   (select count(*) from public.v_customer_amount_payable ap
--      join public.v_customer_prepaid_balance b on b.customer_id = ap.customer_id
--     where ap.payment_mode = 'prepaid'
--       and not ap.is_written_off
--       and ap.amount_payable_sar is distinct from b.balance_sar) as prepaid_arm_drift,
--   (select count(*) from public.v_invoice_outstanding_live
--     where outstanding_basis = 'written_off') as premature_writeoffs;

-- D. DRIFT CHECK — the postpaid arm against a fully independent restatement.
--    This is the check that catches lib/prepaid.ts and this view diverging.
--    Must return 0 rows.
--
-- with independent as (
--   select c.id as customer_id,
--     coalesce((select sum(round(coalesce(t.rate_sar, p.rate_per_trip_sar) * 1.15, 2))
--                 from public.trips t join public.projects p on p.id = t.project_id
--                where p.customer_id = c.id and t.delivered_at is not null
--                  and not (t.invoice_id is not null and exists (
--                        select 1 from public.invoices i
--                         where i.id = t.invoice_id and i.status = 'paid'))), 0)
--   + coalesce((select sum(round(sc.amount_sar * 1.15, 2))
--                 from public.invoice_special_charges sc
--                 join public.invoices i on i.id = sc.invoice_id
--                where i.customer_id = c.id and i.status not in ('void','paid')), 0) as owed
--   from public.customers c
-- )
-- select ap.customer_name, ap.postpaid_unpaid_sar, ind.owed
--   from public.v_customer_amount_payable ap
--   join independent ind on ind.customer_id = ap.customer_id
--  where round(ap.postpaid_unpaid_sar, 2) is distinct from round(ind.owed, 2);

-- E. THE VIEW POSTURE. 46 -> 47 views (v_customer_amount_payable is the only
--    addition; the other two are replacements). The two counts matching is the
--    check, not the number.
--
-- select count(*) as views,
--        count(*) filter (where c.reloptions::text[] @> array['security_invoker=true']) as security_invoker,
--        count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where c.relkind = 'v' and n.nspname = 'public';

-- F. REHEARSAL, IN A TRANSACTION THAT IS ROLLED BACK. Pick a blocked
--    customer's project id. The first call must RAISE; the second must
--    succeed, insert exactly one write-off, and drop that customer's invoices
--    out of v_receivables_open.
--
-- begin;
--   -- expect: ERROR ... still owes ... SAR
--   select public.archive_project_guarded('<project-uuid>');
-- rollback;
--
-- begin;
--   select public.archive_project_guarded('<project-uuid>', 'Bad debt — company dissolved', 'Turki');
--   select amount_sar, reason, written_off_by from public.customer_write_offs;
--   select owed_sar, archive_blocked, is_written_off
--     from public.v_customer_amount_payable where customer_id = '<customer-uuid>';   -- expect 0, false, true
--   select count(*) from public.v_receivables_open where customer_id = '<customer-uuid>'; -- expect 0
-- rollback;

-- G. THE RETURN DOES NOT CORRUPT THE BALANCE. Run against the one prepaid
--    customer in credit, AFTER archiving them. balance_sar must be IDENTICAL
--    before and after, and only `balance_returned` may change.
--
-- begin;
--   select balance_sar from public.v_customer_prepaid_balance where customer_id = '<customer-uuid>';
--   select public.return_customer_balance('<customer-uuid>', 'cash', null, null, null, 'Closing account', 'Turki');
--   select balance_sar from public.v_customer_prepaid_balance where customer_id = '<customer-uuid>'; -- MUST be unchanged
--   select balance_returned, returned_sar, returned_method, returned_on
--     from public.v_customer_amount_payable where customer_id = '<customer-uuid>';
--   -- second call must RAISE 'already been returned'
--   select public.return_customer_balance('<customer-uuid>', 'cash');
-- rollback;
