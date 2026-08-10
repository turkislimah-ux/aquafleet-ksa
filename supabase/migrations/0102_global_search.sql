-- 0102_global_search.sql
-- =====================================================================
-- GLOBAL SEARCH — one SQL entry point for the header search box.
--
-- DRAFTED FOR THE ARCHITECT TO APPLY. Not self-applied (CLAUDE.md §5).
-- No app code depends on this until it is confirmed applied.
--
-- WHY A FUNCTION OVER THE BASE TABLES, AND NOT A SEARCH-INDEX TABLE
-- ------------------------------------------------------------------
-- The obvious "fast" design is a denormalised `search_index` table kept
-- current by triggers. It is REJECTED here on one hard ground: RLS.
-- Every one of the 70 tables in this schema has RLS enabled. A copy
-- table cannot reproduce 70 different source policies, so search would
-- read from a surface the user's own policies never gate — i.e. it
-- could surface a row the user could not otherwise see. Today every
-- policy is `ALL to authenticated using (true)`, so the leak would be
-- invisible; the moment RBAC lands (parked in HANDOFF.md §6) it becomes
-- real, silently. So: this function reads the BASE TABLES, and is
-- SECURITY INVOKER, so each source table's own policies apply exactly
-- as they would to a normal SELECT. Stated explicitly below rather than
-- left to the language default.
--
-- Same reasoning as the Reports semantic layer's `security_invoker =
-- true` rule (0098): "a default view runs as OWNER and bypasses RLS on
-- 68 RLS-enabled tables, so this is a security gate, not a style
-- choice." This is that rule applied to a function.
--
-- WHAT THIS ADDS
--   1. pg_trgm (extension, into the `extensions` schema) — typo tolerance.
--   2. public.search_norm(text)   — EN+AR normaliser, IMMUTABLE.
--   3. public.search_score(text,text) — one ranking rule, IMMUTABLE.
--   4. public.search_everything(text,int) — the entry point, INVOKER.
--   5. GIN trigram indexes on the normalised title/number columns.
--
-- WHAT THIS DOES NOT ADD
--   No tables. No columns. No triggers. No data is copied or cached.
--   Nothing here is AI-related (decision A: AI is a later phase).
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;


-- ---------------------------------------------------------------------
-- 1. search_norm — fold a string to its comparable form.
--
-- Latin: lowercase, whitespace collapsed.
-- Arabic: the four standard IR foldings, because real rows in this
--   database need every one of them —
--     alef variants   أ إ آ ٱ  -> ا
--     alef maksura    ى        -> ي
--     teh marbuta     ة        -> ه
--     hamza carriers  ؤ ئ      -> و ي
--   plus tashkeel (harakat) and tatweel stripped entirely.
-- Arabic-Indic digits ٠-٩ -> 0-9. This one is not theoretical: live
--   driver rows read "محمد ٢" / "خالد ٣", and Saudi plates are shown in
--   Arabic-Indic form all over this app while `trucks.plate` stores the
--   Latin canonical "ABC-1234" (lib/plate.ts). Folding the digits means
--   typing ١١١٥ finds BBB-1115.
--
-- Implemented with translate(), not regexp: translate() deletes any
-- `from` character with no positional counterpart in `to`, which gets
-- the diacritic-stripping for free, and PostgreSQL's regex flavour has
-- no \u{...} escape to write those code points portably anyway.
--
-- IMMUTABLE is required — these expressions are indexed below.
-- ---------------------------------------------------------------------
create or replace function public.search_norm(p_text text)
returns text
language sql
immutable
parallel safe
returns null on null input
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        translate(
          lower(p_text),
          -- from: 8 letter foldings, 10 digits, then 10 marks to delete
          'أإآٱىةؤئ' || '٠١٢٣٤٥٦٧٨٩' || 'ًٌٍَُِّْٰـ',
          -- to:   8 letters,          10 digits    (marks have no
          --       counterpart, so translate drops them)
          'اااايهوي' || '0123456789'
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$$;

comment on function public.search_norm(text) is
  'Global search: fold a string for comparison. Lowercases, collapses '
  'whitespace, normalises Arabic alef/alef-maksura/teh-marbuta/hamza '
  'carriers, strips tashkeel and tatweel, and folds Arabic-Indic digits '
  'to Latin. IMMUTABLE because the trigram indexes are built on it.';


-- ---------------------------------------------------------------------
-- 2. search_score — ONE ranking rule, defined once.
--
-- Tiers, highest first:
--   1.00  exact match on the normalised field
--   0.90  the field starts with the query
--   0.75  the field contains the query
--   else  trigram similarity (the typo-tolerant tier)
--
-- strpos() rather than LIKE deliberately: a query containing % or _ is
-- a literal here, and strpos needs no escaping to make that true.
-- Callers gate on `>= 0.3`; the trigram tier is the only one that can
-- land below that.
-- ---------------------------------------------------------------------
create or replace function public.search_score(p_field text, p_norm_query text)
returns real
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_field is null or p_norm_query is null then 0::real
    when public.search_norm(p_field) is null then 0::real
    when public.search_norm(p_field) = p_norm_query then 1.00::real
    when strpos(public.search_norm(p_field), p_norm_query) = 1 then 0.90::real
    when strpos(public.search_norm(p_field), p_norm_query) > 1 then 0.75::real
    else extensions.similarity(public.search_norm(p_field), p_norm_query)
  end;
$$;

comment on function public.search_score(text, text) is
  'Global search: rank one field against an already-normalised query. '
  'exact 1.0 > prefix 0.9 > substring 0.75 > trigram similarity.';


-- ---------------------------------------------------------------------
-- 3. search_everything — the single entry point.
--
-- SECURITY INVOKER (stated, not implied): every SELECT below runs under
-- the caller's own RLS policies. This function can never return a row
-- the caller could not already read.
--
-- STABLE, not VOLATILE: reads only.
--
-- Contract:
--   p_q         raw user input, normalised here (callers do not pre-fold)
--   p_limit     max hits PER ENTITY (not overall)
--   returns     entity / entity_id / title / subtitle / badge / score /
--               matched (which field won)
--
-- Deliberately NOT returned: a URL. Route shapes belong to the app
-- (lib/search-routes.ts), not the database — the DB should not need a
-- migration when a page's query-param convention changes.
--
-- Soft-deleted rows (terminated drivers/trucks, archived projects and
-- customers) ARE returned, carrying their state in `badge`. Hiding them
-- would make search assert "no such record" about a record that exists;
-- every page still pre-filters them per CLAUDE.md §6. Flagged for
-- Turki — if he wants them out, it is a WHERE clause per block, not a
-- redesign.
--
-- Queries shorter than 2 characters return nothing: at 1 character the
-- trigram tier matches nearly everything and the result is noise.
-- ---------------------------------------------------------------------
create or replace function public.search_everything(
  p_q     text,
  p_limit int default 5
)
returns table (
  entity    text,
  entity_id uuid,
  title     text,
  subtitle  text,
  badge     text,
  score     real,
  matched   text
)
language sql
stable
security invoker
parallel safe
set search_path = ''
as $$
with q as (
  -- One place decides whether the query is usable at all. Under two
  -- characters nq is NULL, search_score() then returns 0 for every
  -- field, and no block clears the 0.3 floor — so the short-query guard
  -- needs no separate WHERE downstream.
  select case
           when length(public.search_norm(p_q)) >= 2 then public.search_norm(p_q)
           else null
         end as nq
),
best (entity, entity_id, title, subtitle, badge, score, matched) as (
  -- Each block: score every searchable field, keep the winning field
  -- and its score, drop anything under the 0.3 floor, cap at p_limit.

  -- trucks --------------------------------------------------------------
  (select 'truck'::text, t.id,
          t.plate,
          nullif(concat_ws(' · ', t.model, t.year::text), ''),
          case when t.terminated_at is not null then 'terminated' else t.status end,
          greatest(
            public.search_score(t.plate, q.nq),
            public.search_score(t.model, q.nq),
            public.search_score(t.vin, q.nq),
            public.search_score(t.vehicle_registration, q.nq)
          ),
          'plate'::text
   from public.trucks t, q
   where greatest(
           public.search_score(t.plate, q.nq),
           public.search_score(t.model, q.nq),
           public.search_score(t.vin, q.nq),
           public.search_score(t.vehicle_registration, q.nq)
         ) >= 0.3
   order by 6 desc, t.plate limit p_limit)

  -- drivers -------------------------------------------------------------
  union all
  (select 'driver'::text, d.id,
          d.name,
          nullif(concat_ws(' · ', d.name_ar, d.phone), ''),
          case when d.terminated_at is not null then 'terminated' else d.status end,
          greatest(
            public.search_score(d.name, q.nq),
            public.search_score(d.name_ar, q.nq),
            public.search_score(d.phone, q.nq),
            public.search_score(d.iqama_number, q.nq),
            public.search_score(d.license_number, q.nq)
          ),
          'name'::text
   from public.drivers d, q
   where greatest(
           public.search_score(d.name, q.nq),
           public.search_score(d.name_ar, q.nq),
           public.search_score(d.phone, q.nq),
           public.search_score(d.iqama_number, q.nq),
           public.search_score(d.license_number, q.nq)
         ) >= 0.3
   order by 6 desc, d.name limit p_limit)

  -- staff ---------------------------------------------------------------
  union all
  (select 'staff'::text, s.id,
          s.name,
          nullif(concat_ws(' · ', s.name_ar, s.role, s.email), ''),
          case when s.terminated_at is not null then 'terminated'
               when s.active then 'active' else 'inactive' end,
          greatest(
            public.search_score(s.name, q.nq),
            public.search_score(s.name_ar, q.nq),
            public.search_score(s.email, q.nq),
            public.search_score(s.phone, q.nq),
            public.search_score(s.iqama_number, q.nq)
          ),
          'name'::text
   from public.staff s, q
   where greatest(
           public.search_score(s.name, q.nq),
           public.search_score(s.name_ar, q.nq),
           public.search_score(s.email, q.nq),
           public.search_score(s.phone, q.nq),
           public.search_score(s.iqama_number, q.nq)
         ) >= 0.3
   order by 6 desc, s.name limit p_limit)

  -- customers -----------------------------------------------------------
  union all
  (select 'customer'::text, c.id,
          c.name,
          nullif(concat_ws(' · ', c.name_ar, c.contact_name, c.phone), ''),
          case when c.archived_at is not null then 'archived' else c.customer_type end,
          greatest(
            public.search_score(c.name, q.nq),
            public.search_score(c.name_ar, q.nq),
            public.search_score(c.contact_name, q.nq),
            public.search_score(c.phone, q.nq),
            public.search_score(c.email, q.nq),
            public.search_score(c.vat_number, q.nq),
            public.search_score(c.cr_number, q.nq)
          ),
          'name'::text
   from public.customers c, q
   where greatest(
           public.search_score(c.name, q.nq),
           public.search_score(c.name_ar, q.nq),
           public.search_score(c.contact_name, q.nq),
           public.search_score(c.phone, q.nq),
           public.search_score(c.email, q.nq),
           public.search_score(c.vat_number, q.nq),
           public.search_score(c.cr_number, q.nq)
         ) >= 0.3
   order by 6 desc, c.name limit p_limit)

  -- projects ------------------------------------------------------------
  union all
  (select 'project'::text, p.id,
          p.name,
          nullif(concat_ws(' · ', p.initials, p.location), ''),
          case when p.archived_at is not null then 'archived' else p.status end,
          greatest(
            public.search_score(p.name, q.nq),
            public.search_score(p.initials, q.nq),
            public.search_score(p.location, q.nq),
            public.search_score(p.description, q.nq)
          ),
          'name'::text
   from public.projects p, q
   where greatest(
           public.search_score(p.name, q.nq),
           public.search_score(p.initials, q.nq),
           public.search_score(p.location, q.nq),
           public.search_score(p.description, q.nq)
         ) >= 0.3
   order by 6 desc, p.name limit p_limit)

  -- invoices ------------------------------------------------------------
  -- The join to customers is itself RLS-gated, so an invoice whose
  -- customer the caller cannot read simply shows a null subtitle rather
  -- than leaking the name.
  union all
  (select 'invoice'::text, i.id,
          i.invoice_number,
          nullif(concat_ws(' · ', cu.name, i.period_start::text), ''),
          i.status,
          greatest(
            public.search_score(i.invoice_number, q.nq),
            public.search_score(i.payment_reference, q.nq)
          ),
          'invoice_number'::text
   from public.invoices i
   left join public.customers cu on cu.id = i.customer_id
   cross join q
   where greatest(
           public.search_score(i.invoice_number, q.nq),
           public.search_score(i.payment_reference, q.nq)
         ) >= 0.3
   order by 6 desc, i.invoice_number limit p_limit)

  -- trips ---------------------------------------------------------------
  union all
  (select 'trip'::text, tr.id,
          tr.ref,
          nullif(concat_ws(' · ', tr.trip_date::text, tr.water_station), ''),
          tr.stage,
          greatest(
            public.search_score(tr.ref, q.nq),
            public.search_score(tr.water_station, q.nq)
          ),
          'ref'::text
   from public.trips tr, q
   where greatest(
           public.search_score(tr.ref, q.nq),
           public.search_score(tr.water_station, q.nq)
         ) >= 0.3
   order by 6 desc, tr.trip_date desc limit p_limit)

  -- parts ---------------------------------------------------------------
  union all
  (select 'part'::text, pa.id,
          pa.name,
          nullif(concat_ws(' · ', pa.sku, pa.name_ar, pa.category), ''),
          case when pa.active then null else 'inactive' end,
          greatest(
            public.search_score(pa.name, q.nq),
            public.search_score(pa.name_ar, q.nq),
            public.search_score(pa.sku, q.nq),
            public.search_score(pa.category, q.nq),
            public.search_score(pa.supplier, q.nq)
          ),
          'name'::text
   from public.parts pa, q
   where greatest(
           public.search_score(pa.name, q.nq),
           public.search_score(pa.name_ar, q.nq),
           public.search_score(pa.sku, q.nq),
           public.search_score(pa.category, q.nq),
           public.search_score(pa.supplier, q.nq)
         ) >= 0.3
   order by 6 desc, pa.name limit p_limit)

  -- work orders ---------------------------------------------------------
  union all
  (select 'work_order'::text, w.id,
          w.wo_number,
          nullif(concat_ws(' · ', w.title, tk.plate), ''),
          w.status,
          greatest(
            public.search_score(w.wo_number, q.nq),
            public.search_score(w.title, q.nq),
            public.search_score(w.title_ar, q.nq)
          ),
          'wo_number'::text
   from public.work_orders w
   left join public.trucks tk on tk.id = w.truck_id
   cross join q
   where greatest(
           public.search_score(w.wo_number, q.nq),
           public.search_score(w.title, q.nq),
           public.search_score(w.title_ar, q.nq)
         ) >= 0.3
   order by 6 desc, w.wo_number limit p_limit)

  -- outsourced jobs -----------------------------------------------------
  union all
  (select 'outsourced_job'::text, o.id,
          o.os_number,
          nullif(concat_ws(' · ', o.title, tk.plate), ''),
          o.status,
          greatest(
            public.search_score(o.os_number, q.nq),
            public.search_score(o.title, q.nq),
            public.search_score(o.title_ar, q.nq)
          ),
          'os_number'::text
   from public.outsourced_jobs o
   left join public.trucks tk on tk.id = o.truck_id
   cross join q
   where greatest(
           public.search_score(o.os_number, q.nq),
           public.search_score(o.title, q.nq),
           public.search_score(o.title_ar, q.nq)
         ) >= 0.3
   order by 6 desc, o.os_number limit p_limit)

  -- exit permits --------------------------------------------------------
  union all
  (select 'exit_permit'::text, e.id,
          e.ep_number,
          nullif(concat_ws(' · ', e.receiver_name, e.carrier_name), ''),
          e.status,
          greatest(
            public.search_score(e.ep_number, q.nq),
            public.search_score(e.receiver_name, q.nq),
            public.search_score(e.carrier_name, q.nq),
            public.search_score(e.note, q.nq)
          ),
          'ep_number'::text
   from public.exit_permits e, q
   where greatest(
           public.search_score(e.ep_number, q.nq),
           public.search_score(e.receiver_name, q.nq),
           public.search_score(e.carrier_name, q.nq),
           public.search_score(e.note, q.nq)
         ) >= 0.3
   order by 6 desc, e.ep_number limit p_limit)

  -- purchase orders -----------------------------------------------------
  union all
  (select 'purchase_order'::text, po.id,
          po.po_number,
          nullif(concat_ws(' · ', su.name, po.request_date::text), ''),
          po.status,
          greatest(
            public.search_score(po.po_number, q.nq),
            public.search_score(po.note, q.nq)
          ),
          'po_number'::text
   from public.purchase_orders po
   left join public.suppliers su on su.id = po.supplier_id
   cross join q
   where greatest(
           public.search_score(po.po_number, q.nq),
           public.search_score(po.note, q.nq)
         ) >= 0.3
   order by 6 desc, po.po_number limit p_limit)

  -- archive documents ---------------------------------------------------
  union all
  (select 'archive_document'::text, a.id,
          a.title,
          nullif(concat_ws(' · ', a.reference_no, a.holder_name, a.issuing_entity), ''),
          a.type_key,
          greatest(
            public.search_score(a.title, q.nq),
            public.search_score(a.reference_no, q.nq),
            public.search_score(a.holder_name, q.nq),
            public.search_score(a.issuing_entity, q.nq),
            public.search_score(a.note, q.nq)
          ),
          'title'::text
   from public.archive_documents a, q
   where greatest(
           public.search_score(a.title, q.nq),
           public.search_score(a.reference_no, q.nq),
           public.search_score(a.holder_name, q.nq),
           public.search_score(a.issuing_entity, q.nq),
           public.search_score(a.note, q.nq)
         ) >= 0.3
   order by 6 desc, a.title limit p_limit)

  -- expenses ------------------------------------------------------------
  union all
  (select 'expense'::text, x.id,
          coalesce(x.note, x.category),
          nullif(concat_ws(' · ', x.category, x.expense_date::text), ''),
          null::text,
          greatest(
            public.search_score(x.category, q.nq),
            public.search_score(x.note, q.nq),
            public.search_score(x.entered_by, q.nq)
          ),
          'note'::text
   from public.expenses x, q
   where greatest(
           public.search_score(x.category, q.nq),
           public.search_score(x.note, q.nq),
           public.search_score(x.entered_by, q.nq)
         ) >= 0.3
   order by 6 desc, x.expense_date desc limit p_limit)

  -- suppliers -----------------------------------------------------------
  -- Not named in the brief's list, but it has a name, and a supplier is
  -- reachable from Inventory. Flagged for Turki: drop this block and the
  -- three below if he wants search held to the named list exactly.
  union all
  (select 'supplier'::text, su.id,
          su.name,
          nullif(concat_ws(' · ', su.name_ar, su.contact_person, su.phone), ''),
          case when su.active then null else 'inactive' end,
          greatest(
            public.search_score(su.name, q.nq),
            public.search_score(su.name_ar, q.nq),
            public.search_score(su.contact_person, q.nq),
            public.search_score(su.phone, q.nq),
            public.search_score(su.email, q.nq)
          ),
          'name'::text
   from public.suppliers su, q
   where greatest(
           public.search_score(su.name, q.nq),
           public.search_score(su.name_ar, q.nq),
           public.search_score(su.contact_person, q.nq),
           public.search_score(su.phone, q.nq),
           public.search_score(su.email, q.nq)
         ) >= 0.3
   order by 6 desc, su.name limit p_limit)

  -- warehouses ----------------------------------------------------------
  union all
  (select 'warehouse'::text, wh.id,
          wh.name,
          nullif(concat_ws(' · ', wh.location, wh.type), ''),
          case when wh.active then null else 'inactive' end,
          greatest(
            public.search_score(wh.name, q.nq),
            public.search_score(wh.location, q.nq)
          ),
          'name'::text
   from public.warehouses wh, q
   where greatest(
           public.search_score(wh.name, q.nq),
           public.search_score(wh.location, q.nq)
         ) >= 0.3
   order by 6 desc, wh.name limit p_limit)

  -- repairers -----------------------------------------------------------
  union all
  (select 'repairer'::text, r.id,
          r.name,
          nullif(concat_ws(' · ', r.name_ar, r.location, r.contact_name), ''),
          case when r.active then null else 'inactive' end,
          greatest(
            public.search_score(r.name, q.nq),
            public.search_score(r.name_ar, q.nq),
            public.search_score(r.location, q.nq),
            public.search_score(r.contact_name, q.nq),
            public.search_score(r.contact_number, q.nq)
          ),
          'name'::text
   from public.repairers r, q
   where greatest(
           public.search_score(r.name, q.nq),
           public.search_score(r.name_ar, q.nq),
           public.search_score(r.location, q.nq),
           public.search_score(r.contact_name, q.nq),
           public.search_score(r.contact_number, q.nq)
         ) >= 0.3
   order by 6 desc, r.name limit p_limit)
)
select b.entity, b.entity_id, b.title, b.subtitle, b.badge, b.score, b.matched
from best b
order by b.score desc, b.title;
$$;

comment on function public.search_everything(text, int) is
  'Global header search. SECURITY INVOKER on purpose: every block reads '
  'a base table under the caller''s own RLS, so this can never surface a '
  'row the caller could not already SELECT. Returns at most p_limit hits '
  'per entity. Soft-deleted rows are returned with their state in badge, '
  'not hidden. Route/href mapping lives in the app, not here.';

revoke all on function public.search_everything(text, int) from public, anon;
grant execute on function public.search_everything(text, int) to authenticated;

revoke all on function public.search_norm(text) from public, anon;
grant execute on function public.search_norm(text) to authenticated;

revoke all on function public.search_score(text, text) from public, anon;
grant execute on function public.search_score(text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. Trigram indexes on the normalised primary match columns.
--
-- HONEST NOTE ON WHY THESE ARE HERE: at today's row counts (203 trips,
-- 21 invoices, 16 drivers, 15 trucks, 10 parts) a sequential scan wins
-- and these indexes will not be chosen by the planner. They are for
-- growth — a real fleet's trips table reaches six figures — and they
-- cost nothing meaningful at this size. They are built on
-- search_norm(col) so the index matches what the function compares.
--
-- Only the primary title/number column per entity is indexed. Secondary
-- fields (phone, note, vin, ...) are left unindexed on purpose: they are
-- low-selectivity, and 25 more indexes on a 70-table schema is a write
-- cost paid on every insert for a read path that is already fast.
-- ---------------------------------------------------------------------
create index if not exists trucks_plate_search_trgm
  on public.trucks using gin (public.search_norm(plate) extensions.gin_trgm_ops);

create index if not exists drivers_name_search_trgm
  on public.drivers using gin (public.search_norm(name) extensions.gin_trgm_ops);
create index if not exists drivers_name_ar_search_trgm
  on public.drivers using gin (public.search_norm(name_ar) extensions.gin_trgm_ops);

create index if not exists staff_name_search_trgm
  on public.staff using gin (public.search_norm(name) extensions.gin_trgm_ops);
create index if not exists staff_name_ar_search_trgm
  on public.staff using gin (public.search_norm(name_ar) extensions.gin_trgm_ops);

create index if not exists customers_name_search_trgm
  on public.customers using gin (public.search_norm(name) extensions.gin_trgm_ops);
create index if not exists customers_name_ar_search_trgm
  on public.customers using gin (public.search_norm(name_ar) extensions.gin_trgm_ops);

create index if not exists projects_name_search_trgm
  on public.projects using gin (public.search_norm(name) extensions.gin_trgm_ops);

create index if not exists invoices_number_search_trgm
  on public.invoices using gin (public.search_norm(invoice_number) extensions.gin_trgm_ops);

create index if not exists trips_ref_search_trgm
  on public.trips using gin (public.search_norm(ref) extensions.gin_trgm_ops);

create index if not exists parts_name_search_trgm
  on public.parts using gin (public.search_norm(name) extensions.gin_trgm_ops);
create index if not exists parts_sku_search_trgm
  on public.parts using gin (public.search_norm(sku) extensions.gin_trgm_ops);

create index if not exists work_orders_number_search_trgm
  on public.work_orders using gin (public.search_norm(wo_number) extensions.gin_trgm_ops);

create index if not exists outsourced_jobs_number_search_trgm
  on public.outsourced_jobs using gin (public.search_norm(os_number) extensions.gin_trgm_ops);

create index if not exists exit_permits_number_search_trgm
  on public.exit_permits using gin (public.search_norm(ep_number) extensions.gin_trgm_ops);

create index if not exists purchase_orders_number_search_trgm
  on public.purchase_orders using gin (public.search_norm(po_number) extensions.gin_trgm_ops);

create index if not exists archive_documents_title_search_trgm
  on public.archive_documents using gin (public.search_norm(title) extensions.gin_trgm_ops);

create index if not exists suppliers_name_search_trgm
  on public.suppliers using gin (public.search_norm(name) extensions.gin_trgm_ops);

create index if not exists repairers_name_search_trgm
  on public.repairers using gin (public.search_norm(name) extensions.gin_trgm_ops);


-- ---------------------------------------------------------------------
-- POST-APPLY VERIFICATION (run these; do not assume)
--
--   -- exactly one signature each, and INVOKER not DEFINER:
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args,
--          p.prosecdef as is_security_definer
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('search_norm','search_score','search_everything');
--   -- expect 3 rows, is_security_definer = false on all three.
--
--   -- Arabic folding actually folds:
--   select public.search_norm('مُحَمَّد ٢');          -- expect 'محمد 2'
--   select public.search_norm('إبراهيم') = public.search_norm('ابراهيم'); -- t
--
--   -- typo tolerance:
--   select * from public.search_everything('mohamed', 5);
--   select * from public.search_everything('محمد', 5);
--   select * from public.search_everything('1115', 5);   -- expect BBB-1115
--   select * from public.search_everything('١١١٥', 5);   -- same truck
--   select * from public.search_everything('PO-2026', 5);
--
--   -- anon must not be able to execute:
--   select has_function_privilege('anon',
--     'public.search_everything(text,int)', 'execute');  -- expect false
-- ---------------------------------------------------------------------
