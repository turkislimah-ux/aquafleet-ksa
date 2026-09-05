// COMPANY BANK ACCOUNTS — parse, normalise, validate, format.
//
// Migration 0184 stores these as a jsonb ARRAY on company_settings. The CHECK
// constraint there enforces exactly two things — that the value is an array,
// and that it holds at most 3 elements. It deliberately does NOT enforce the
// shape of an element: a CHECK may not contain a subquery, so
// `jsonb_array_elements` is unavailable, and the only route to per-element
// validation is an IMMUTABLE helper function called from the constraint — a
// documented anti-pattern (see that migration's header for the full argument).
//
// THIS FILE IS THE OTHER HALF OF THAT BARGAIN. Because the database will accept
// a malformed element, nothing downstream may assume a well-formed one:
//
//   - Every READ goes through `parseBankAccounts`, which returns only elements
//     it can fully account for and silently drops the rest. `CompanySettings.
//     bank_accounts` is typed `unknown` precisely so tsc refuses to let anyone
//     skip this step.
//   - Every WRITE goes through `validateBankAccounts` in the single server
//     action. That is where shape is actually enforced.
//
// Purity: no React, no Supabase, no `process`. Imported by the server action,
// the settings form, and the invoice view-model alike.
//
// IBANs here are the COMPANY's OWN, printed on customer invoices by design —
// public information, not a secret, and not customer data. They are still never
// logged: an IBAN in a log line is an IBAN in a place nobody audits.

/** Hard ceiling, mirrored by `company_settings_bank_accounts_shape` (0184). */
export const MAX_BANK_ACCOUNTS = 3;

export type CompanyBankAccount = {
  /**
   * App-generated and STABLE. Not decoration: the settings UI edits, reorders
   * and deletes rows in place, and an array index is identity under none of
   * those — key React on the index and deleting the first row silently
   * re-labels every survivor.
   */
  id: string;
  bank_name: string;
  holder_name: string;
  /** Normalised: no spaces, upper case. Format for display, never for storage. */
  iban: string;
  show_on_invoice: boolean;
};

/** `crypto.randomUUID` where it exists, with a plain fallback for old runtimes. */
export function newBankAccountId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `ba_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Strips every separator a human might paste (spaces, hyphens, non-breaking
 * spaces) and upper-cases. Storage form. `SA03 8000 0000 6080 1016 7519`,
 * `sa03-8000-...` and `SA0380000000608010167519` all normalise to one string,
 * so the same account cannot be stored two ways and compare unequal.
 */
export function normalizeIban(raw: string): string {
  return raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/**
 * Storage form with a country code SUPPLIED WHEN ONE IS MISSING. `SA` is a
 * DEFAULT, not a requirement — foreign accounts are allowed (Turki, 2026-09-05)
 * and keep whatever code they were typed with.
 *
 * The test is POSITIONAL, never a whitelist. A value beginning with a DIGIT
 * carries no country code at all, and the operator who typed it meant the Saudi
 * account, so `SA` goes on rather than sending a human back to retype two
 * letters. A value beginning with LETTERS already carries its code and is left
 * exactly as typed — prepending would manufacture `SADE89…`, a number that is
 * not any account anywhere, silently, on a payment instruction.
 */
export function ensureSaPrefix(raw: string): string {
  const v = normalizeIban(raw);
  if (!v) return v;
  return /^[0-9]/.test(v) ? `SA${v}` : v;
}

/**
 * Two letters, then at least one more letter or digit. That is the WHOLE rule,
 * and it is deliberately weak — weak enough that the only entries it can reject
 * are an empty field and a value with no country code that `ensureSaPrefix`
 * could not supply one for.
 *
 * NO COUNTRY WHITELIST. `SA` is what a bare number DEFAULTS to, not what an
 * account must be; `DE89…` and `MT84…` are accepted as typed.
 *
 * THIS USED TO RUN THE ISO 13616 MOD-97 CHECKSUM AND A LENGTH TEST. Both are
 * gone by Turki's ruling (2026-09-05), and the reasoning is worth keeping
 * because it will look like a missing feature to whoever reads this next:
 *
 *   We are not connected to any banking system. The checksum does not ask a
 *   bank whether an account exists — it only asserts that a string obeys a
 *   formula. So it can never confirm a correct IBAN, it can only reject an
 *   entry the operator is looking at on a bank statement in front of him. In
 *   practice that is what it did: the field became almost impossible to fill,
 *   and the failure was opaque — the operator got "invalid" with no way to tell
 *   what was wrong, because nothing on his screen WAS wrong.
 *
 * A wrong IBAN is now caught where it was always actually caught: by the person
 * reading the invoice, and by the bank refusing the transfer. Neither of those
 * was ever replaced by the checksum.
 *
 * What is kept is what serves the operator rather than policing him: the
 * separator-stripping in `normalizeIban`, the groups-of-4 in `formatIban`, and
 * the defaulted `SA` in `ensureSaPrefix`.
 *
 * `scripts/bank-accounts-check.ts` asserts the LOOSENING directly — a
 * transposed digit and a foreign IBAN must both be ACCEPTED. Re-adding a
 * checksum, a length rule or a country test fails there loudly instead of
 * quietly re-breaking the field.
 */
export function isAcceptableIban(value: string): boolean {
  return /^[A-Z]{2}[0-9A-Z]+$/.test(ensureSaPrefix(value));
}

/**
 * Display form — groups of 4, the way an IBAN is printed on every bank's own
 * statement. One expression, so the settings screen, the invoice popup and the
 * downloadable PDF cannot each invent their own spacing.
 */
export function formatIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})/g, "$1 ").trim();
}

/** Narrow an unknown jsonb element to a usable account, or reject it. */
function toAccount(value: unknown): CompanyBankAccount | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const bank_name = typeof o.bank_name === "string" ? o.bank_name : "";
  const holder_name = typeof o.holder_name === "string" ? o.holder_name : "";
  const iban = typeof o.iban === "string" ? normalizeIban(o.iban) : "";
  // An element with no id cannot be edited or deleted safely, and one with no
  // bank name and no IBAN has nothing to say on an invoice. Either way it is
  // not renderable, so it is dropped rather than shown half-empty.
  if (!id || (!bank_name && !iban)) return null;
  return {
    id,
    bank_name,
    holder_name,
    iban,
    // Anything other than an explicit `true` is not shown. A malformed or
    // missing flag must fail CLOSED — the cost of wrongly hiding an account is
    // an operator ticking a box; the cost of wrongly showing one is a customer
    // wiring money to an account we did not intend to publish.
    show_on_invoice: o.show_on_invoice === true,
  };
}

/**
 * The ONLY read path. Tolerates every state the column can legally be in —
 * absent (pre-0184 snapshot), null, not an array, or an array with junk in it —
 * and never throws.
 */
export function parseBankAccounts(value: unknown): CompanyBankAccount[] {
  if (!Array.isArray(value)) return [];
  const out: CompanyBankAccount[] = [];
  for (const el of value) {
    const acc = toAccount(el);
    if (acc) out.push(acc);
  }
  // Trimmed rather than rejected: the ceiling is the DB's to enforce on WRITE.
  // On read, a row that somehow exceeded it should still render its first three
  // accounts instead of rendering nothing at all.
  return out.slice(0, MAX_BANK_ACCOUNTS);
}

/** The accounts that print on a customer document, in stored (display) order. */
export function visibleBankAccounts(value: unknown): CompanyBankAccount[] {
  return parseBankAccounts(value).filter((a) => a.show_on_invoice);
}

export type BankAccountValidationError =
  | { code: "too_many" }
  | { code: "bank_name_required"; index: number }
  | { code: "holder_name_required"; index: number }
  | { code: "iban_invalid"; index: number };

/**
 * The WRITE gate. Returns the cleaned array to store, or the first problem.
 *
 * Deliberately returns a CODE and an index rather than a sentence: the server
 * action and the settings form both call this, and they render errors in
 * different places and different languages. A message baked in here would be
 * English on an Arabic screen.
 */
export function validateBankAccounts(
  accounts: CompanyBankAccount[],
): { ok: true; accounts: CompanyBankAccount[] } | { ok: false; error: BankAccountValidationError } {
  if (accounts.length > MAX_BANK_ACCOUNTS) return { ok: false, error: { code: "too_many" } };
  const cleaned: CompanyBankAccount[] = [];
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    const bank_name = a.bank_name.trim();
    const holder_name = a.holder_name.trim();
    // Prefix FIRST, then test — so a bare-digit entry is repaired rather than
    // rejected, and what gets tested is what will actually be stored.
    const iban = ensureSaPrefix(a.iban ?? "");
    if (!bank_name) return { ok: false, error: { code: "bank_name_required", index: i } };
    if (!holder_name) return { ok: false, error: { code: "holder_name_required", index: i } };
    if (!isAcceptableIban(iban)) return { ok: false, error: { code: "iban_invalid", index: i } };
    cleaned.push({
      id: a.id || newBankAccountId(),
      bank_name,
      holder_name,
      iban,
      show_on_invoice: a.show_on_invoice === true,
    });
  }
  return { ok: true, accounts: cleaned };
}
