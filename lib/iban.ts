// IBAN — normalisation and validation for DRIVER/STAFF Saudi account numbers
// (0202).
//
// ONE definition, TWO callers: the driver/staff form (courtesy — catch the typo
// before the round-trip) and the server action (boundary — what the DB check
// constraint `iban ~ '^SA[0-9]{22}$'` sees is always the normalised form).
// The form and the action MUST agree on what "valid" means, so both import
// from here; neither re-states the rule.
//
// NOT lib/bankAccounts.ts, AND NOT A MISSED REUSE. That module holds the
// COMPANY's own accounts — foreign IBANs allowed, no length rule (Turki's
// 2026-09-05 ruling; scripts/bank-accounts-check.ts defends the loosening).
// THIS field is Saudi-only and shape-pinned, because the DB constraint on
// drivers/staff already says `^SA[0-9]{22}$` and this module is that
// constraint said early. Two fields, two rules, deliberately two modules.
//
// NO CHECKSUM HERE EITHER — Turki's ruling (2026-09-17), same reasoning as
// the 2026-09-05 one on the company module: we are connected to no banking
// system, so ISO 7064 mod-97 cannot confirm an account exists — it can only
// reject an operator copying a number off the driver's own bank statement.
// This file briefly ran the checksum during the 0202 build and it was removed
// before ever shipping. Do not re-add it; the SHAPE rule below is the whole
// rule, and it stays because the DATABASE enforces the same one.
//
// Purity: no React, no Supabase, no Date — string in, verdict out.

/**
 * Strip every space AND dash, then upcase. Banks print both formattings —
 * "sa03 8000 0000 6080 1016 7519" and "SA03-8000-0000-6080-1016-7519" are the
 * same account as "SA0380000000608010167519"; the DB stores ONE spelling.
 * Applied in the server action BEFORE write, and in the form BEFORE validate,
 * so the user may paste the bank's own formatting freely (Turki's 2026-09-17
 * ruling added the dashes: the dashed spelling MUST pass).
 */
export function normalizeIban(raw: string): string {
  return raw.replace(/[\s-]+/g, "").toUpperCase();
}

/**
 * A Saudi IBAN as this schema accepts it: literal "SA" + exactly 22 digits —
 * the DB check constraint, restated so the form can say it before the
 * round-trip. SHAPE ONLY, no checksum, by ruling (see the header).
 *
 * Expects NORMALISED input (see normalizeIban). Empty string is NOT valid —
 * the caller decides whether blank means "no IBAN" before asking.
 */
export function isValidSaIban(iban: string): boolean {
  return /^SA[0-9]{22}$/.test(iban);
}
