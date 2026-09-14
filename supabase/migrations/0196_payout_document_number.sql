-- 0196_payout_document_number.sql
--
-- DRAFT — NOT APPLIED. Money-adjacent. Bare statements (0173+ carry no
-- begin;/commit;). REVISION 2, per the architect's ruling on revision 1.
--
-- WHAT AND WHY
-- ---------------------------------------------------------------------------
-- The driver payout voucher is becoming a printed document handed to a person
-- who signs for it ("received by"). A document a human signs needs a number, and
-- a payment document's number must be GAP-FREE: a gap in a series of payment
-- vouchers reads as a missing payment, not as a skipped counter.
--
-- THE NUMBER IS MINTED BY A BEFORE INSERT TRIGGER, NOT BY AN RPC-CALLED MINTER,
-- AND NOT AT PRINT.
--
--   * NOT AT PRINT, because the voucher is reprintable. If print minted it,
--     every reprint would be a new document number for the same payment — the
--     exact failure the number exists to make visible.
--   * NOT BY AN RPC-CALLED MINTER, because pay_commission is SECURITY INVOKER.
--     A minter it calls would execute as the CALLING role, so `authenticated`
--     would need EXECUTE on it, so any signed-in user could call the minter over
--     PostgREST and BURN a number — leaving a gap in the one series whose whole
--     purpose is to have none. Revision 1 of this file proposed exactly that and
--     flagged it; the flag is now closed by design rather than accepted.
--   * A TRIGGER FUNCTION CANNOT BE CALLED. `returns trigger` is refused by
--     Postgres itself ("trigger functions can only be called as triggers",
--     SQLSTATE 0A000) and by PostgREST, for every role, with or without a
--     grant. The closure is in the TYPE, not in the ACL — which is why it holds
--     even if someone later re-grants execute by habit.
--
-- Because the trigger function is SECURITY DEFINER and owned by the table owner,
-- it reaches the counter as the owner. So `authenticated` needs NO grant on the
-- counter table and NO execute on any minter, anywhere. The counter logic is
-- INLINED into the trigger function rather than split into a helper, so there is
-- no callable minter surface to secure in the first place.
--
-- pay_commission IS NOT TOUCHED BY THIS MIGRATION. It already inserts into
-- commission_payouts; the trigger fills the number in. It stays byte-identical
-- to what is running, 0131 + 0180 keep reproducing it on replay, and there is no
-- drift to manage. §6 of revision 1 (a full restatement of the RPC) is gone.
-- The verification block still ASSERTS its live shape — confirming a function
-- this file deliberately leaves alone is cheap, and catches the day someone
-- decides to mint in the RPC after all.
--
-- MEASURED AGAINST THE LIVE DATABASE 2026-09-14 (project ceqzmztewbborwgxnrqh):
--   * commission_payouts    = 16 rows, paid_at non-null on all 16, Riyadh-year
--     2026 on all 16. (The brief said 14 and 0115's comment said 6. The DB
--     outranks both; the backfill below numbers whatever is there.)
--   * payout_number column  — does not exist. payout_number_counter — does not
--     exist. commission_payouts carries no triggers today.
--   * pay_commission(uuid,text,numeric,numeric,numeric,numeric,numeric,jsonb,text)
--     — prosecdef = FALSE (INVOKER), proconfig = {"search_path=public, pg_temp"}
--     from 0180, anon execute = false, authenticated execute = true. It is the
--     ONLY insert path into commission_payouts (pg_proc.prosrc scan + code-grep
--     over app/, whose two hits are SELECTs). That is what makes `not null
--     unique` safe to add.
--   * database TimeZone = 'UTC', so a bare extract(year from now()) would be the
--     UTC year. Every year below is cast to Asia/Riyadh (0189's convention).
--
-- YEAR = THE RIYADH YEAR OF paid_at, NOT OF THE PERIOD PAID.
-- 0115 takes a payslip's year from p_period_start because a payslip IS its
-- period. A payout voucher records a PAYMENT, so its year is the year the
-- payment happened — which also matches "backfill in paid_at order". The trigger
-- fires BEFORE INSERT, so it cannot read the final paid_at when the caller left
-- it to DEFAULT; it reads now() instead. Those are the same value — `now()` is
-- the transaction timestamp and `paid_at DEFAULT now()` evaluates to it — and
-- when a caller passes paid_at explicitly the trigger prefers NEW.paid_at. The
-- resulting identity (number year == Riyadh year of paid_at) is ASSERTED in §6
-- across every row, not assumed.
--
-- COUNTER SHAPE: 0115's `last_number` (default 0, "last handed out"), NOT the
-- older `next_number` (default 1, "next to hand out") of 0025/0027/0033/0034/
-- 0050/0093. The two are one apart, and mixing them is how a series starts at
-- 0002.
--
-- FOLLOW-UP OUTSIDE THIS FILE (recorded so it is not lost): app/drivers/page.tsx
-- selects commission_payouts with an EXPLICIT column list, so payout_number is
-- invisible to the app until that list gains it. HistoryTab.tsx passes
-- payoutNo: null today, with a comment marking the spot.
--
-- ===========================================================================
-- TWO DELIBERATE POSTURES, BOTH TIGHTER THAN THE NEAREST PRECEDENT
-- ===========================================================================
--
-- POSTURE A — the counter table gets NO POLICY, unlike payslip_number_counter.
--   payslip_number_counter carries a permissive policy
--   (authenticated_all_payslip_number_counter: ALL, {authenticated}, true/true).
--   This one does not: RLS enabled, ZERO policies, and anon AND authenticated
--   revoked at the table level. No client role can read or write it through
--   PostgREST at all. Nothing is lost — the only thing that touches a counter is
--   its SECURITY DEFINER writer, which runs as the table owner and bypasses both
--   the grant and the policy. 0162 already documents that the payslip counter
--   "is only ever touched by next_payslip_number(integer)"; this one is
--   structurally incapable of being touched by anything else.
--
-- POSTURE B — the trigger function is revoked from authenticated too, where
--   trips_set_ref() (0189, the closest precedent: a BEFORE INSERT definer
--   trigger that mints a numbered reference) GRANTS it.
--   MEASURED 2026-09-14: this database has ZERO trigger functions revoked from
--   authenticated, so there is no local evidence that firing survives the
--   revoke. Postgres checks EXECUTE on a trigger function at CREATE TRIGGER,
--   not at fire time — but "the manual says so" is not the standard this repo
--   holds itself to for a money path.
--   SO §6 DOES NOT ASSUME IT. The negative control inserts a real row with a
--   null payout_number while running AS THE authenticated ROLE, checks the
--   trigger minted a number, then rolls that subtransaction back and checks the
--   counter went back with it. If the revoke broke firing, this migration ABORTS
--   at apply time instead of shipping a dead insert path. That is the measurement
--   the precedent could not supply.

-- ---------------------------------------------------------------------------
-- 1. THE COUNTER
-- ---------------------------------------------------------------------------
create table if not exists public.payout_number_counter (
  year        integer primary key,
  last_number integer not null default 0
);

alter table public.payout_number_counter enable row level security;

-- POSTURE A. The explicit revokes stand even though 0161 revoked anon
-- everywhere: default privileges only reach tables created AFTER them, and on a
-- fresh db reset every earlier migration runs first, so the per-table line is
-- what makes this migration correct on its own.
revoke all on public.payout_number_counter from anon;
revoke all on public.payout_number_counter from authenticated;

comment on table public.payout_number_counter is
  'Gap-free per-year driver-payout document numbers (DP-YYYY-NNNN). Written '
  'ONLY by the SECURITY DEFINER trigger commission_payouts_set_payout_number, '
  'which reaches it as owner. RLS is enabled with no policy and both client '
  'roles are revoked, on purpose (0196 POSTURE A).';

-- ---------------------------------------------------------------------------
-- 2. THE COLUMN — added NULLABLE so the backfill has somewhere to land
-- ---------------------------------------------------------------------------
alter table public.commission_payouts
  add column if not exists payout_number text;

comment on column public.commission_payouts.payout_number is
  'DP-YYYY-NNNN. Minted by a BEFORE INSERT trigger, inside the inserting '
  'transaction. Immutable once written; a reprint reuses it.';

-- ---------------------------------------------------------------------------
-- 3. BACKFILL — count-agnostic, per Riyadh year, in paid_at order
-- ---------------------------------------------------------------------------
-- OFFSET-AWARE on purpose. A naive row_number() restarts at 1, so a re-run
-- against a PARTIALLY numbered table would mint DP-2026-0001 a second time and
-- the unique constraint in §5 would fail with a constraint error instead of a
-- legible one. `taken` reads the highest number already present per year and the
-- backfill continues from it; on a fully numbered table nothing is null, so this
-- updates zero rows and is a no-op.
with taken as (
  select extract(year from (paid_at at time zone 'Asia/Riyadh'))::int as y,
         max(split_part(payout_number, '-', 3)::int)                 as hi
    from public.commission_payouts
   where payout_number is not null
   group by 1
),
ordered as (
  select p.id,
         extract(year from (p.paid_at at time zone 'Asia/Riyadh'))::int as y,
         row_number() over (
           partition by extract(year from (p.paid_at at time zone 'Asia/Riyadh'))::int
           order by p.paid_at, p.id
         ) as n
    from public.commission_payouts p
   where p.payout_number is null
)
update public.commission_payouts p
   set payout_number = 'DP-' || o.y::text || '-'
                    || lpad((coalesce(t.hi, 0) + o.n)::text, 4, '0')
  from ordered o
  left join taken t on t.y = o.y
 where p.id = o.id;

-- Seed the counter from what the backfill actually wrote, so the next live
-- payment continues the series instead of colliding with it. `greatest` on
-- conflict follows 0074 — a counter may advance, never go backwards.
insert into public.payout_number_counter (year, last_number)
select extract(year from (paid_at at time zone 'Asia/Riyadh'))::int,
       max(split_part(payout_number, '-', 3)::int)
  from public.commission_payouts
 group by 1
on conflict (year) do update
  set last_number = greatest(public.payout_number_counter.last_number,
                             excluded.last_number);

-- ---------------------------------------------------------------------------
-- 4. THE CONSTRAINTS — only now that every row has a value
-- ---------------------------------------------------------------------------
alter table public.commission_payouts
  alter column payout_number set not null;

-- Postgres has no `add constraint if not exists`; the guard is what makes a
-- second run survivable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.commission_payouts'::regclass
       and conname  = 'commission_payouts_payout_number_key'
  ) then
    alter table public.commission_payouts
      add constraint commission_payouts_payout_number_key unique (payout_number);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. THE MINT — one trigger function, counter logic inlined, no callable surface
-- ---------------------------------------------------------------------------
-- Shape follows trips_set_ref() (0189): BEFORE INSERT, SECURITY DEFINER, pinned
-- search_path, and an early return when the caller already supplied a value.
-- It differs in inlining the counter instead of calling a helper — 0189 calls
-- next_trip_ref_number, and every such helper is a function somebody has to
-- remember to revoke. There is nothing here to revoke.
create or replace function public.commission_payouts_set_payout_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer;
  v_next integer;
begin
  -- IDEMPOTENT BY DESIGN. A caller that supplies a number keeps it — which is
  -- what makes a restore, a copy, or a corrective insert able to preserve a
  -- document number that is already printed and signed for. Nothing in the app
  -- supplies one today; every live insert arrives with NULL and is minted here.
  if new.payout_number is not null then
    return new;
  end if;

  -- paid_at is `timestamptz not null default now()`, so when the caller omits it
  -- NEW.paid_at is still null at BEFORE INSERT and the default has not been
  -- applied yet. now() IS that default's value — both are the transaction
  -- timestamp — so the two branches cannot disagree. Cast to Riyadh because the
  -- database runs on UTC and 0189 fixed the local day everywhere else.
  v_year := extract(year from
    (coalesce(new.paid_at, now()) at time zone 'Asia/Riyadh'))::integer;

  -- Lock the year's row FOR UPDATE, then increment. Rolls back with the
  -- transaction, so the series is truly GAP-FREE rather than merely unique: a
  -- payment that raises after this point returns its number to the counter.
  insert into public.payout_number_counter (year, last_number)
  values (v_year, 0)
  on conflict (year) do nothing;

  select last_number + 1 into v_next
    from public.payout_number_counter
   where year = v_year
     for update;

  update public.payout_number_counter
     set last_number = v_next
   where year = v_year;

  -- DP-2026-0001. lpad WIDENS and never truncates, so the 10000th payout of a
  -- year is DP-2026-10000 — longer than its siblings, still unique, still in
  -- order. The width is a floor, not a ceiling.
  new.payout_number := 'DP-' || v_year::text || '-' || lpad(v_next::text, 4, '0');

  return new;
end;
$$;

comment on function public.commission_payouts_set_payout_number() is
  'BEFORE INSERT on commission_payouts: mints a gap-free DP-YYYY-NNNN when the '
  'row arrives without one. Counter logic is inlined so no callable minter '
  'exists for any role (0196). Locks the counter row FOR UPDATE and rolls back '
  'with the transaction.';

-- POSTURE B. Not a security boundary — `returns trigger` already makes this
-- uncallable for every role — but it removes the last thing an audit could
-- mistake for a callable minter. The negative control in §6 proves firing
-- survives it, running as `authenticated` rather than as the migration role.
revoke execute on function public.commission_payouts_set_payout_number() from public, anon, authenticated;

drop trigger if exists commission_payouts_set_payout_number_trigger
  on public.commission_payouts;

create trigger commission_payouts_set_payout_number_trigger
before insert on public.commission_payouts
for each row
execute function public.commission_payouts_set_payout_number();

-- ---------------------------------------------------------------------------
-- 6. VERIFICATION — RAISES. A result grid is a claim; this is the evidence.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad    bigint;
  v_rows   bigint;
  v_txt    text;
  v_probe  boolean := false;
  v_role   text;
  v_year   integer;
  v_before integer;
  v_after  integer;
  v_num    text;
  v_driver uuid;
begin
  -- ========================= the counter table ==============================
  if to_regclass('public.payout_number_counter') is null then
    raise exception '0196: payout_number_counter was not created.';
  end if;

  if not (select relrowsecurity from pg_class
           where oid = 'public.payout_number_counter'::regclass) then
    raise exception '0196: RLS is not enabled on payout_number_counter.';
  end if;

  -- POSTURE A is an intentional state, so it is asserted. A policy appearing
  -- here later should have to be a decision that edits this line.
  select count(*) into v_bad from pg_policies
   where schemaname = 'public' and tablename = 'payout_number_counter';
  if v_bad <> 0 then
    raise exception '0196: payout_number_counter has % polic(ies); POSTURE A '
      'specifies none. If that is wanted, change the migration, not the table.',
      v_bad;
  end if;

  if has_table_privilege('anon',          'public.payout_number_counter', 'select')
  or has_table_privilege('anon',          'public.payout_number_counter', 'insert')
  or has_table_privilege('anon',          'public.payout_number_counter', 'update')
  or has_table_privilege('authenticated', 'public.payout_number_counter', 'select')
  or has_table_privilege('authenticated', 'public.payout_number_counter', 'insert')
  or has_table_privilege('authenticated', 'public.payout_number_counter', 'update') then
    raise exception '0196: a client role still holds a table privilege on '
                    'payout_number_counter (POSTURE A).';
  end if;

  -- ============ (a) NO MINTER IS CALLABLE BY ANY CLIENT ROLE ================
  -- The point of the whole revision. Deliberately written as a SWEEP, not as a
  -- check on one known name: it catches a helper someone adds later, and it
  -- catches an authenticated-callable RPC that starts writing the counter
  -- itself. Identified by oid, never by pg_get_function_identity_arguments;
  -- read back with has_function_privilege, never by matching proacl.
  -- `public` is not a real role and cannot be passed to has_function_privilege,
  -- but anon inherits every PUBLIC grant, so anon = false proves PUBLIC = false.
  select count(*) into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like '%payout_number%'
       or p.prosrc  like '%payout_number_counter%')
     and (has_function_privilege('anon',          p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_bad <> 0 then
    select string_agg(p.oid::regprocedure::text, ', ') into v_txt
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like '%payout_number%'
         or p.prosrc  like '%payout_number_counter%')
       and (has_function_privilege('anon',          p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute'));
    raise exception '0196: % function(s) that touch the payout counter are '
      'executable by a client role — a signed-in user could burn a document '
      'number and open a gap. Offenders: %', v_bad, v_txt;
  end if;

  -- ================= (b) the trigger exists and is enabled ==================
  -- tgtype bits: 1 = FOR EACH ROW, 2 = BEFORE, 4 = INSERT. 7 is exactly
  -- "BEFORE INSERT FOR EACH ROW" and nothing else — an AFTER trigger could not
  -- change NEW, and a statement-level one would never see a row.
  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_proc  p on p.oid = t.tgfoid
     where c.oid = 'public.commission_payouts'::regclass
       and not t.tgisinternal
       and t.tgname  = 'commission_payouts_set_payout_number_trigger'
       and p.proname = 'commission_payouts_set_payout_number'
       and t.tgtype  = 7
       and t.tgenabled = 'O'
  ) then
    raise exception '0196: the BEFORE INSERT FOR EACH ROW trigger on '
                    'commission_payouts is missing, disabled, or the wrong kind.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'commission_payouts_set_payout_number'
       and p.prosecdef
       and p.proconfig @> array['search_path=public, pg_temp']
  ) then
    raise exception '0196: the mint trigger function is not SECURITY DEFINER '
                    'with a pinned search_path — it could not reach the counter '
                    'past RLS, or could be hijacked by a shadowed schema.';
  end if;

  -- ====== (c) pay_commission is UNCHANGED — this file does not touch it =====
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.oid::regprocedure::text like 'pay_commission(%'
       and p.prosecdef
  ) then
    raise exception '0196: pay_commission is SECURITY DEFINER. It updates four '
                    'RLS-protected tables and must stay INVOKER.';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.oid::regprocedure::text like 'pay_commission(%'
       and p.proconfig @> array['search_path=public, pg_temp']
  ) then
    select coalesce(array_to_string(p.proconfig, ' | '), '<none>') into v_txt
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.oid::regprocedure::text like 'pay_commission(%';
    raise exception '0196: pay_commission lost 0180''s pinned search_path (now: %).',
      coalesce(v_txt, '<function missing>');
  end if;

  if has_function_privilege('anon',
       'public.pay_commission(uuid, text, numeric, numeric, numeric, numeric, numeric, jsonb, text)',
       'execute') then
    raise exception '0196: anon can execute pay_commission.';
  end if;

  -- The mint must NOT have migrated into the RPC. If it ever does, the sweep in
  -- (a) fires too — pay_commission is authenticated-executable — but this says
  -- why in one line instead of leaving the architect to work it out.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.oid::regprocedure::text like 'pay_commission(%'
       and p.prosrc like '%payout_number%'
  ) then
    raise exception '0196: pay_commission now references payout_number. The '
                    'trigger is meant to be the only mint path; an INVOKER RPC '
                    'that mints puts the counter back in reach of the caller.';
  end if;

  -- ============== (d) the rows: format, year, gap-free, counter =============
  select count(*) into v_rows from public.commission_payouts;

  select count(*) into v_bad from public.commission_payouts
   where payout_number is null or payout_number !~ '^DP-[0-9]{4}-[0-9]{4,}$';
  if v_bad <> 0 then
    raise exception '0196: % of % payout rows have a missing or malformed '
                    'payout_number.', v_bad, v_rows;
  end if;

  -- The number's year IS the Riyadh year of paid_at. This is what makes the
  -- backfill and the trigger one rule rather than two that happen to agree.
  select count(*) into v_bad from public.commission_payouts
   where split_part(payout_number, '-', 2)::int
         <> extract(year from (paid_at at time zone 'Asia/Riyadh'))::int;
  if v_bad <> 0 then
    raise exception '0196: % payout rows carry a number whose year differs from '
                    'the Riyadh year of paid_at.', v_bad;
  end if;

  select count(*) into v_bad from (
    select extract(year from (paid_at at time zone 'Asia/Riyadh'))::int as y,
           count(*)                                             as n_rows,
           count(distinct split_part(payout_number,'-',3)::int)  as n_distinct,
           min(split_part(payout_number,'-',3)::int)             as lo,
           max(split_part(payout_number,'-',3)::int)             as hi
      from public.commission_payouts
     group by 1
  ) s
  where s.lo <> 1 or s.hi <> s.n_rows or s.n_distinct <> s.n_rows;
  if v_bad <> 0 then
    raise exception '0196: % year(s) have a gap or a duplicate in the payout '
                    'number series.', v_bad;
  end if;

  select count(*) into v_bad
    from (select extract(year from (paid_at at time zone 'Asia/Riyadh'))::int as y,
                 max(split_part(payout_number,'-',3)::int) as hi
            from public.commission_payouts group by 1) s
    full join public.payout_number_counter c on c.year = s.y
   where c.year is null or s.y is null or c.last_number <> s.hi;
  if v_bad <> 0 then
    raise exception '0196: the counter does not match the numbers on disk for % '
                    'year(s) — the next payment would collide.', v_bad;
  end if;

  -- ===================== (e) THE NEGATIVE CONTROL ===========================
  -- Everything above reads the catalog. This one makes the mechanism WORK, as
  -- the role that will actually work it, and then puts everything back.
  --
  -- It matters because POSTURE B revokes EXECUTE on the trigger function from
  -- authenticated, and this database contains no other trigger function in that
  -- state — so nothing here proves by precedent that firing survives it. This
  -- does, by measurement. It also proves the rollback half of "gap-free": the
  -- counter must come back down when the inserting subtransaction is undone.
  -- Borrow a driver that already has payouts, so the probe row is the shape a
  -- real one takes. On an empty table (fresh db reset) fall back to any driver.
  select driver_id into v_driver from public.commission_payouts order by paid_at limit 1;
  if v_driver is null then
    select id into v_driver from public.drivers limit 1;
  end if;

  if v_driver is null then
    raise warning '0196: no driver row exists, so the mint negative control was '
                  'SKIPPED. Re-run it by hand before trusting the first payout.';
  else
    v_year := extract(year from (now() at time zone 'Asia/Riyadh'))::integer;
    select last_number into v_before from public.payout_number_counter where year = v_year;

    -- Run the probe as the role the app inserts with. If this role cannot be
    -- assumed, fall back rather than abort — but say so loudly, because the
    -- fallback measures a weaker thing.
    begin
      set local role authenticated;
      v_role := 'authenticated';
    exception when insufficient_privilege then
      v_role := current_user;
      raise warning '0196: could not SET ROLE authenticated; the mint control '
                    'ran as % instead, so POSTURE B is unproven for the role '
                    'that matters. Verify by hand.', current_user;
    end;

    -- A plpgsql block with an EXCEPTION clause is a subtransaction, so the
    -- deliberate raise below undoes the insert AND the counter increment.
    begin
      insert into public.commission_payouts (driver_id, period_label, snapshot)
      values (v_driver, '0196 mint control', '{}'::jsonb)
      returning payout_number into v_num;

      if v_num is null or v_num !~ '^DP-[0-9]{4}-[0-9]{4,}$' then
        raise exception '0196 MINT CONTROL FAILED: a row inserted as % with a '
          'null payout_number came back as %. The BEFORE INSERT trigger did not '
          'mint — most likely POSTURE B''s revoke broke firing.',
          v_role, coalesce(v_num, '<null>');
      end if;

      v_probe := true;
      raise exception '0196_ROLLBACK_PROBE';
    exception
      when others then
        if sqlerrm <> '0196_ROLLBACK_PROBE' then
          raise;
        end if;
    end;

    reset role;

    if not v_probe then
      raise exception '0196: the mint control did not complete.';
    end if;

    select last_number into v_after from public.payout_number_counter where year = v_year;
    if v_after is distinct from v_before then
      raise exception '0196: the counter did not roll back with the undone '
        'insert (% -> %). The series would develop gaps whenever a payment '
        'fails after minting.', coalesce(v_before::text,'<none>'),
        coalesce(v_after::text,'<none>');
    end if;

    if exists (select 1 from public.commission_payouts
                where period_label = '0196 mint control') then
      raise exception '0196: the mint control left a row behind in '
                      'commission_payouts. Delete it before proceeding.';
    end if;

    raise notice '0196 mint control OK (as %): trigger minted %, and both the '
                 'row and the counter rolled back.', v_role, v_num;
  end if;

  raise notice '0196 OK: % payout rows numbered, series gap-free, counter '
               'seeded, no client-callable minter exists, pay_commission '
               'untouched and still SECURITY INVOKER with search_path pinned.',
               v_rows;
end;
$$;
