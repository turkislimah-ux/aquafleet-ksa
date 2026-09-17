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
// SHAPE HARD, CHECKSUM WARNS — Turki's ruling (2026-09-17, an explicit
// choice made after the checksum question was put to him). The SHAPE rule
// (SA + 22 digits) BLOCKS, because the DB constraint enforces the same one
// and a row that fails it cannot be stored anyway. The ISO 7064 mod-97
// checksum (`ibanChecksumOk`) is a WARNING that never blocks: no banking
// system sits behind this field, so mod-97 cannot confirm an account exists —
// but a shape-valid number that fails it usually carries a typo, and the
// operator should hear that BEFORE a salary transfer bounces. The form shows
// the warning and still saves; the server action never calls it
// (scripts/iban-check.ts asserts both halves).
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
 * round-trip. SHAPE ONLY — the checksum is a separate verdict
 * (`ibanChecksumOk`) that warns and never blocks, by ruling (see the header).
 *
 * Expects NORMALISED input (see normalizeIban). Empty string is NOT valid —
 * the caller decides whether blank means "no IBAN" before asking.
 */
export function isValidSaIban(iban: string): boolean {
  return /^SA[0-9]{22}$/.test(iban);
}

/**
 * ISO 7064 mod-97 — do the printed check digits agree with the rest of the
 * number? A WARNING verdict only, never a gate (the ruling in the header):
 * the form shows it and saves anyway; the server action does not call this.
 *
 * Expects NORMALISED input, and is only meaningful AFTER isValidSaIban has
 * passed — ask shape first, then this. Pure: string in, boolean out.
 *
 * The algorithm is the standard one: move the first four characters to the
 * end, expand letters to two-digit numbers (A=10 … Z=35), and the whole
 * number mod 97 must equal 1. Computed digit-by-digit because the expanded
 * number overflows a JS float.
 */
export function ibanChecksumOk(iban: string): boolean {
  if (!/^[A-Z]{2}[0-9]{2}[0-9A-Z]*$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const expanded = ch >= "0" && ch <= "9" ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of expanded) rem = (rem * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}
