-- 0184 — Company bank accounts (for invoice transfer details)
--
-- WHAT: one additive jsonb column on the existing single-row config table.
-- Up to 3 accounts, each flagged for whether it prints on the invoice. This
-- closes the payment-instruction gap flagged during the Aquaglass downloadable
-- build, where the design's [ IBAN ] slots were deliberately left OUT rather
-- than shipped as placeholders on a real customer document.
--
-- ---------------------------------------------------------------------------
-- SHAPE (array, order = display order):
--
--   [
--     {
--       "id":              "b3f1...",   -- text, app-generated, STABLE
--       "bank_name":       "Al Rajhi Bank",
--       "holder_name":     "Bin Slimah Group",
--       "iban":            "SA0380000000608010167519",
--       "show_on_invoice": true
--     }
--   ]
--
-- `id` is not decoration: the UI edits, reorders and deletes rows in place, and
-- an array index is not a stable identity under any of those. Keying React on
-- the index makes a delete re-label the surviving rows.
--
-- ---------------------------------------------------------------------------
-- WHY jsonb AND NOT A CHILD TABLE: this is single-row configuration with a
-- hard ceiling of 3, read on every invoice render alongside the other company
-- fields. jsonb keeps it one row, one read, one atomic write, with display
-- order intrinsic. A child table would buy real per-field constraints at the
-- cost of a join on a hot path and an ordering column to maintain. If the
-- ceiling ever lifts or accounts gain their own lifecycle, that trade flips.
--
-- ---------------------------------------------------------------------------
-- ARCHITECT: ONE OPEN DECISION — how far the CHECK should go.
--
-- Applied below: array-ness and the max-3 ceiling. Both are expressible inline
-- and both genuinely fail on a bad write.
--
-- NOT applied: per-element SHAPE validation (every element an object carrying
-- the five keys at the right types). It cannot be written inline — a CHECK
-- constraint may not contain a subquery, so `jsonb_array_elements` is
-- unavailable, and the only route is an IMMUTABLE helper function called from
-- the constraint. That is a documented Postgres anti-pattern: the function body
-- can later change without revalidating existing rows, and it adds a
-- dump/restore ordering dependency. It would also need its own
-- revoke-from-public-and-anon plus an explicit grant to `authenticated`, since
-- a CHECK is evaluated in the writer's own context.
--
-- So shape is enforced at the single write path (one server action, typed) and
-- the renderer treats every field as possibly-absent rather than trusting it.
-- Say the word if you want the function-based version instead.
--
-- ---------------------------------------------------------------------------
-- IBAN is NOT format-checked here. Per-element access needs a subquery (same
-- wall as above), and a hard `SA`-prefix rule would reject a legitimate foreign
-- account. Validated and normalised app-side. It is the COMPANY's own IBAN,
-- printed on customer invoices by design — public, not a secret. It is still
-- never logged.
--
-- ---------------------------------------------------------------------------
-- RLS / GRANTS: UNCHANGED, and verified before drafting — company_settings has
-- rowsecurity = true with 1 policy; anon holds neither select nor update,
-- authenticated holds both. Table-level grants cover every column, so adding
-- one grants nothing new. No per-table anon revoke is added: §6's rule is for
-- NEW tables, and re-revoking on this one would be a measured no-op.
--
-- The default backfills the single existing row in place (PG11+ stores the
-- default in the catalog — no table rewrite).
-- ---------------------------------------------------------------------------

alter table public.company_settings
  add column if not exists bank_accounts jsonb not null default '[]'::jsonb;

alter table public.company_settings
  drop constraint if exists company_settings_bank_accounts_shape;

alter table public.company_settings
  add constraint company_settings_bank_accounts_shape
  check (
    jsonb_typeof(bank_accounts) = 'array'
    and jsonb_array_length(bank_accounts) <= 3
  );

comment on column public.company_settings.bank_accounts is
  'Up to 3 company bank accounts for invoice transfer details. Array of '
  '{id, bank_name, holder_name, iban, show_on_invoice}. Array order is display '
  'order. Only elements with show_on_invoice = true are rendered on invoices. '
  'Ceiling and array-ness are enforced by '
  'company_settings_bank_accounts_shape; per-field shape is enforced at the '
  'single server-action write path (see migration header for why).';
