-- 0176_driver_violations.sql
-- TRAFFIC VIOLATIONS, STAGE 2 of 2 — the child table. Requires 0175.
--
-- SCHEMA ONLY, AND THAT BOUNDARY IS DELIBERATE. This file creates a table and
-- nothing else. No view is touched, no RPC is written or replaced, no UI reads
-- it, and NOTHING here wires a violation into payslip deductions. That wiring
-- is a separate stage with its own migration, because it changes money.
--
-- DRAFTED, NOT APPLIED. Per CLAUDE.md §5 the architect runs it.
--
-- ===========================================================================
-- TEMPLATED ON 0166_deferred_deliveries, WITH ONE EXPLICIT EXCEPTION
--
-- 0166 is the current-era child-of-drivers pattern: FK on delete restrict, a
-- per-driver index with a stated reason, RLS enable + drop-then-create
-- authenticated_all_* policy, an explicit `revoke all ... from anon`, and
-- per-column comments. All of that is copied.
--
-- ITS TRANSACTION WRAPPER IS NOT. 0166 carries `begin;` at :100 and `commit;`
-- at :258; it was written before the 0173-v1 incident, where a nested begin;
-- was ignored with a warning and the file's trailing commit; closed the SQL
-- EDITOR's own transaction — every result grid printed clean and not one object
-- was created. CLAUDE.md §5 now requires BARE STATEMENTS. This file has none.
--
-- 0024_driver_incidents is the other child-of-drivers table and is NOT the
-- template: it wraps itself in a transaction and has no anon revoke at all,
-- because it predates 0161.
--
-- ===========================================================================
-- FK #1 — driver_id, ON DELETE RESTRICT
--
-- 0024 chose cascade and its own header says that under soft-delete it never
-- fires. 0166 and 0115 (driver_payslips) both chose RESTRICT, and 0166 states
-- the reasoning this file inherits: drivers are soft-deleted via terminated_at,
-- so a hard delete is already off the sanctioned path and should fail loudly
-- rather than erase a logged entry. A violation carries SAR and, once stage 3
-- exists, will feed a frozen payslip figure. Money-bearing child → RESTRICT.
--
-- FK #2 — violation_type_id, ON DELETE RESTRICT
--
-- Same rule from the other side. 0175's retire path is `active = false`; a
-- DELETE on a type that history points at must fail rather than take the
-- history's meaning with it.
--
-- ===========================================================================
-- SOFT DELETE — THE COLUMN IS `voided_at`. HERE IS WHY, MEASURED.
--
-- The live catalog holds exactly three soft-delete markers and NO `deleted_at`
-- anywhere in `public`:
--
--   archived_at     customers, projects          — an entity you stop dealing with
--   terminated_at   drivers, staff, trucks       — a person or asset that leaves
--   voided_at       invoices, exit_permits       — a REF-AND-MONEY RECORD cancelled
--
-- A violation is not an entity and not a person, so the first two are the wrong
-- shape. It is a record that carries an external reference number and an amount
-- — structurally the same thing as an invoice or an exit permit. `voided_at` it
-- is. Introducing a fourth name (`deleted_at`) for the same idea would be the
-- only one of its kind in the schema.
--
-- voided_by AND void_reason ARE INCLUDED, AND THAT IS BEYOND THE LITERAL SPEC.
-- Flagging rather than burying it: the brief asked for a nullable timestamp and
-- this adds two more columns. Grounds — invoices carry (voided_at, void_reason)
-- and exit_permits carry (voided_at, voided_by, void_reason); both precedents
-- record WHY, and one records WHO. A voided violation with no reason is a row
-- someone will have to guess about, and there is no delete path to fall back on.
-- Both are nullable and nothing keys off them: delete these three lines and the
-- two matching comments to drop the idea entirely.
--
-- ===========================================================================
-- THE UNIQUE INDEX IS PARTIAL: `where voided_at is null`. RECOMMENDED CHOICE.
--
-- Turki's G1 rule is that a government ref is unique PER DRIVER. Two ways to
-- express it, and they differ only on voided rows:
--
--   A. `unique (driver_id, ref_no)` as a table constraint — covers every row
--      ever written, including voided ones.
--   B. a partial unique INDEX `where voided_at is null` — covers only live rows.
--
-- B is implemented, because A burns a real government reference on the first
-- typo. The correction path for a wrong entry is: void the bad row, re-enter it
-- correctly. Under A the re-entry collides with the row that was just voided,
-- with no delete path to escape through — soft-delete is the lock (CLAUDE.md
-- §6), so the ref would be permanently unusable for that driver. Under B the
-- void releases the ref and the corrected row goes in.
--
-- What B gives up: two VOIDED rows may share a ref for one driver. That is the
-- correct reading — a voided row is history, not a live claim, and the rule
-- being enforced is "one live violation per ref per driver".
--
-- MECHANICAL CONSEQUENCE: Postgres constraints cannot be partial, so this is a
-- standalone `create unique index`, NOT a `constraint ... unique (...)` inside
-- the table body. It will not appear in pg_constraint; verify it in pg_index.
-- The pattern is established, not novel — 26 partial indexes already exist live.
--
-- ===========================================================================
-- WHAT IS DELIBERATELY ABSENT
--
-- · No counter table and no next_violation_number(). Every counter in this
--   schema (7 of them) exists to mint a gap-free number WE own. `ref_no` comes
--   printed on a government notice; we transcribe it, we do not issue it. The
--   right guard for an external identifier is a uniqueness rule, which is the
--   index above — 0173 does the same thing for trips.ref.
--
-- · No index on payment_status. Two values, no selectivity, on a table that
--   will hold hundreds of rows and not millions. Add it if a plan ever asks.
--
-- · No composite (driver_id, violation_date) index. The query that would want
--   it — the payslip month-bucket read — DOES NOT EXIST YET. Picking a column
--   order for a query nobody has written is guessing; the two single-column
--   indexes below cover the reads that do exist today, and the composite is a
--   one-line addition in the stage that introduces the query.
--
-- · No deductions wiring of any kind. v_driver_payslip_basis is untouched and
--   issue_driver_payslip is untouched. See the closing note.
-- ===========================================================================

-- ---------------------------------------------------------------------
-- 1. THE TABLE
--
-- FK targets confirmed against the live catalog before writing, not assumed:
-- `drivers.id` is uuid default gen_random_uuid(); `violation_types.id` is the
-- same, created by 0175 immediately above.
--
-- `violation_date` is a DATE, not a timestamptz, deliberately — the same call
-- 0166 makes for delivery_date and 0115 makes for period_start. The date on a
-- violation notice is a calendar day, and the payslip period it will eventually
-- be bucketed into is a calendar month in Riyadh terms. A timestamptz would put
-- the same violation in two different months for two different readers, which
-- is the UTC-skew trap CLAUDE.md §6's todayKey() rule exists for. Trip dates
-- (trips.trip_date) and incident dates (driver_incidents.incident_date) are
-- both plain DATE for this reason, and bucket with no timezone term.
--
-- `amount_sar` allows 0 (`>= 0`, not `> 0`): a violation can be waived or
-- reduced to nothing while still being a thing that happened to this driver,
-- and forcing > 0 would make recording that a deletion. Same reasoning 0166
-- gives for trip_count >= 0. It matches driver_payslips.deductions_sar >= 0,
-- which is the column this figure will one day feed.
--
-- `payment_status` is a two-value text CHECK rather than an enum, matching
-- driver_payslips.commission_basis and every other status column here. A CHECK
-- can be widened by one migration; a Postgres enum cannot have a value removed
-- at all. It records whether the FINE has been settled with the authority — it
-- is NOT a payroll state and says nothing about whether the driver was charged.
-- ---------------------------------------------------------------------
create table if not exists public.driver_violations (
  id                uuid          primary key default gen_random_uuid(),

  driver_id         uuid          not null references public.drivers(id)         on delete restrict,
  violation_type_id uuid          not null references public.violation_types(id) on delete restrict,

  ref_no            text          not null,
  amount_sar        numeric(12,2) not null,
  violation_date    date          not null,

  payment_status    text          not null default 'not_paid',

  note              text,

  -- SOFT DELETE. NULL = live. See the header for why the name is voided_at and
  -- why voided_by / void_reason are here at all.
  voided_at         timestamptz,
  voided_by         text,
  void_reason       text,

  created_by        text,
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now(),

  constraint driver_violations_amount_nonneg
    check (amount_sar >= 0),

  constraint driver_violations_payment_status_valid
    check (payment_status in ('paid', 'not_paid')),

  -- NOT NULL lets an empty string through, and a blank government ref is
  -- indistinguishable from a missing one once it is in the table.
  constraint driver_violations_ref_no_not_blank
    check (btrim(ref_no) <> '')
);

-- ---------------------------------------------------------------------
-- 2. INDEXES
--
-- The unique one carries the business rule, so it is first. Partial — a
-- CONSTRAINT cannot be, which is why this is a standalone index. Read it in
-- pg_index, not pg_constraint.
-- ---------------------------------------------------------------------
create unique index if not exists driver_violations_driver_ref_live_unique
  on public.driver_violations (driver_id, ref_no)
  where voided_at is null;

-- Always queried per-driver — the Staff page column and the driver detail
-- section both ask "this driver's violations". Unlike the tiny lookup table in
-- 0175 this one grows with the fleet. Same reasoning as 0024:22.
--
-- NOT redundant with the unique index above, despite the shared leading column:
-- that one is partial, so the planner can only use it for reads that imply
-- `voided_at is null`. A view that shows voided rows too gets nothing from it.
create index if not exists driver_violations_driver_idx
  on public.driver_violations (driver_id);

-- Supports the month-bucket filter. The payslip surface filters a period the
-- way StatementViews.tsx:1574 does — a closed range on a date column — and this
-- is the index that read will want. desc because every date-ordered surface in
-- this app shows newest first.
create index if not exists driver_violations_date_idx
  on public.driver_violations (violation_date desc);

-- ---------------------------------------------------------------------
-- 3. updated_at, maintained by the database.
--
-- REUSES public.set_updated_at() — created by 0157, confirmed present in the
-- live catalog before this was written. It is NOT defined here and MUST NOT be
-- dropped by any rollback of this file; 0157 and 0166 both depend on it.
--
-- BEYOND THE LITERAL SPEC, FLAGGED: the brief listed created_at and created_by
-- but not updated_at. It is included because these rows are hand-typed and
-- correctable — 0157's reasoning for issue_reports applies unchanged, and 0166,
-- the mandated template, carries it. Drop this block and the column together if
-- it is not wanted.
--
-- The WHEN clause matters: without it "last updated" would mean "last written
-- to", and re-saving an unchanged row would look like activity.
-- ---------------------------------------------------------------------
drop trigger if exists driver_violations_set_updated_at on public.driver_violations;
create trigger driver_violations_set_updated_at
  before update on public.driver_violations
  for each row
  when (old.* is distinct from new.*)
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 4. RLS + the anon revoke.
--
-- `using (true) with check (true)` — the shared-queue shape 0157 and 0166 use,
-- NOT the own-row shape of user_profiles. This is operational data about the
-- fleet, not personal data about the logged-in user: either user records a
-- violation and either corrects it. A per-author restriction would mean the
-- person who spots a wrong amount is the one who cannot fix it.
--
-- `created_by` is TEXT and captures the actor's email for the audit trail — the
-- project's actor-capture convention. It is descriptive, NOT a security
-- boundary; nothing keys off it and the policy does not mention it.
--
-- The revoke is kept even though 0161 already covers newly created tables, so
-- this migration reads correctly on its own after a fresh db reset (CLAUDE.md §6).
-- ---------------------------------------------------------------------
alter table public.driver_violations enable row level security;

drop policy if exists authenticated_all_driver_violations on public.driver_violations;
create policy authenticated_all_driver_violations
  on public.driver_violations for all to authenticated
  using (true) with check (true);

revoke all on public.driver_violations from anon;

-- ---------------------------------------------------------------------
-- 5. Comments.
-- ---------------------------------------------------------------------
comment on table public.driver_violations is
  'TRAFFIC VIOLATIONS logged against a driver (0176). Hand-entered from a government notice: ref_no is transcribed, never issued by us, which is why this table has no counter unlike the seven number_counter tables. NOT YET WIRED TO PAYROLL — driver_payslips.deductions_sar is still frozen at 0 by issue_driver_payslip, and connecting the two is a separate migration that changes money and must go through the money gate. Both FKs are ON DELETE RESTRICT: drivers are soft-deleted via terminated_at and violation types are retired via active = false, so a hard delete of either is already off the sanctioned path and should fail loudly rather than orphan or erase a logged violation. Rows are voided, never deleted.';

comment on column public.driver_violations.ref_no is
  'The reference number printed on the government violation notice. Transcribed by hand, not generated. Unique PER DRIVER among LIVE rows only — enforced by the partial index driver_violations_driver_ref_live_unique, which excludes voided rows so that voiding a mistaken entry releases the ref for a corrected one. Two voided rows may legitimately share a ref for the same driver.';

comment on column public.driver_violations.amount_sar is
  'The fine as stated on the notice, in SAR. Allows 0 so a waived or cancelled fine can still be recorded as an event rather than deleted. This is the figure a future payslip deduction would draw on; it is not read by anything today.';

comment on column public.driver_violations.violation_date is
  'The calendar day of the violation, in Riyadh terms. A DATE, not a timestamptz, mirroring trips.trip_date and driver_incidents.incident_date — a payslip period is a calendar month and an instant would land the same violation in different months for different readers.';

comment on column public.driver_violations.payment_status is
  'Whether the FINE has been settled with the authority. paid | not_paid. This says nothing about payroll: it is not a deduction state and must not be read as one. When deductions are wired, whether an unpaid fine, a paid one, or either is deductible is a separate decision with its own column or rule.';

comment on column public.driver_violations.voided_at is
  'SOFT DELETE marker. NULL = live. Named voided_at to match invoices and exit_permits, the other two records in this schema that carry an external-ish reference and an amount; archived_at and terminated_at mark entities and people, which this is not, and deleted_at exists nowhere in public. Voiding is the ONLY removal path (CLAUDE.md section 6) and it also releases ref_no for re-entry.';

comment on column public.driver_violations.void_reason is
  'Why the row was voided, in free text. Both void precedents in this schema record a reason (invoices, exit_permits) because a cancelled money record with no explanation is one someone later has to guess about. Nullable and descriptive; nothing keys off it.';

comment on column public.driver_violations.created_by is
  'The actor email captured at insert, for the audit trail. Descriptive, NOT a security boundary — the RLS policy does not mention it and nothing keys off it.';

-- ===========================================================================
-- VERIFY AFTER APPLY — the catalog, not this file's result grid (CLAUDE.md §5).
--
--   -- 1. Table, RLS, anon locked out, one policy.
--   select c.relname, c.relrowsecurity as rls,
--          has_table_privilege('anon', c.oid, 'select') as anon_select,
--          has_table_privilege('authenticated', c.oid, 'select') as auth_select,
--          (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public'
--      and c.relname in ('violation_types', 'driver_violations')
--    order by c.relname;
--   -- expect BOTH: t / false / true / 1
--
--   -- 2. THE PARTIAL UNIQUE INDEX. It is NOT in pg_constraint — look here.
--   select indexname, indexdef
--     from pg_indexes
--    where schemaname = 'public' and tablename = 'driver_violations'
--    order by indexname;
--   -- expect 4 rows: pkey, driver_ref_live_unique (with WHERE voided_at IS
--   -- NULL in the definition), driver_idx, date_idx.
--
--   -- 3. BOTH FKs are RESTRICT, not cascade. pg_constraint.confdeltype codes:
--   --    'r' = restrict, 'c' = CASCADE, 'a' = no action, 'n' = set null.
--   --    Do not read 'c' as "correct" — 'c' is the one we do NOT want here.
--   select con.conname, con.confdeltype
--     from pg_constraint con
--     join pg_class cl on cl.oid = con.conrelid
--     join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
--    where cl.relname = 'driver_violations' and con.contype = 'f';
--   -- expect both confdeltype = 'r'
--
--   -- 4. The updated_at trigger is attached and points at the SHARED function.
--   select tgname from pg_trigger
--    where tgrelid = 'public.driver_violations'::regclass and not tgisinternal;
--   -- expect driver_violations_set_updated_at
--
--   -- 5. NOTHING IN PAYROLL MOVED. This is the assertion that proves stage 1
--   --    stayed inside its boundary.
--   select position('v_deductions' in pg_get_functiondef(p.oid)) > 0 as seam_intact,
--          position('violation'    in pg_get_functiondef(p.oid)) > 0 as wired_to_violations
--     from pg_proc p
--    where p.oid::regprocedure::text = 'issue_driver_payslip(uuid,date,text)';
--   -- expect: true / FALSE. If wired_to_violations is true, something applied
--   -- that was not in these two files.
--
--   -- 6. BEHAVIOURAL PROOF OF THE PARTIAL INDEX, if you want it. Insert a row,
--   --    re-insert the same (driver_id, ref_no) — expect 23505. Void the first,
--   --    re-insert again — expect success. Then delete both test rows.
-- ===========================================================================
