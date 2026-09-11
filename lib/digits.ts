// Latin-digit normalisation for IDENTIFIERS. Pure helpers, no React, no DB.
//
// WHAT THIS IS FOR, AND WHAT IT IS EMPHATICALLY NOT FOR
// -----------------------------------------------------------------------------
// An identifier — a vehicle registration, an Iqama number, a licence number, a
// VIN, a document reference — is a KEY, not prose. It is looked up, compared,
// deduped and pasted into other systems. Two identifiers that differ only in
// digit system are the same identifier to a human and two different strings to
// every index, `eq()` filter and unique constraint we own. So an identifier is
// stored in ONE digit system, and that system is Latin 0-9.
//
// THIS DOES NOT APPLY TO PROSE. `lib/i18n.ts` rules — at `:1296`, `:1303`
// ("RULED ON — do not re-raise"), `:1388`, `:1504` and `:1581` — that
// Arabic-Indic digits STAY in hand-written Arabic copy, and the same goes for
// Arabic free-text NAMES: `drivers.name_ar` holds «فهد ٣» and
// `warehouses.name` holds «مستودع منفوحه ٢» on live rows, both of which are
// correct and must not be touched. Never run a name, a note, a label or a
// dictionary string through this file. The test is not "does it contain
// digits" — it is "is this string a KEY someone will search or match on".
//
// Plate numbers are a third case again and are NOT handled here: `lib/plate.ts`
// owns them with a stricter filter (it rebuilds the value from 7 validated
// boxes rather than translating what it was given), and its own header states
// the same boundary principle this file follows.
//
// BOTH Arabic-Indic ranges are covered, not just the common one:
//   U+0660-0669  ARABIC-INDIC DIGIT ZERO..NINE            ٠١٢٣٤٥٦٧٨٩
//   U+06F0-06F9  EXTENDED ARABIC-INDIC DIGIT ZERO..NINE   ۰۱۲۳۴۵۶۷۸۹
// The extended range is Persian/Urdu and renders almost identically to the
// first in most fonts, so a value carrying it is INVISIBLY different from one
// that does not. Handling only U+0660 would leave exactly the failure this
// file exists to prevent, in the harder-to-see half.
//
// NOTE — `lib/search-match.ts` carries its own U+0660-only fold and KEEPS it.
// That function is a deliberate mirror of `public.search_norm()` (migration
// 0102) and is documented as such in its header; widening it here would make
// the TypeScript and the SQL disagree about what a query means. Two functions,
// two different jobs: that one FOLDS a query for ranking, this one NORMALISES a
// value before it is stored or displayed.

const AR_INDIC_START = 0x0660; // ٠
const AR_INDIC_EXT_START = 0x06f0; // ۰

/** Any Arabic-Indic digit, either range. */
const NON_LATIN_DIGIT = /[٠-٩۰-۹]/;
const NON_LATIN_DIGIT_G = /[٠-٩۰-۹]/g;

/**
 * Rewrite every Arabic-Indic digit as its Latin 0-9 counterpart. Everything
 * else — Latin digits, letters in any script, dashes, spaces — is returned
 * untouched, so this is safe to run on a value that is already clean and on a
 * value that is only partly numeric ("ABC-١٢٣" -> "ABC-123").
 *
 * Null/undefined in, null/undefined out: the callers are form readers and
 * table cells where an absent value must stay absent rather than become "".
 */
export function toLatinDigits(value: string): string;
export function toLatinDigits(value: string | null): string | null;
export function toLatinDigits(value: string | null | undefined): string | null | undefined;
export function toLatinDigits(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  if (!NON_LATIN_DIGIT.test(value)) return value;
  return value.replace(NON_LATIN_DIGIT_G, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= AR_INDIC_EXT_START ? AR_INDIC_EXT_START : AR_INDIC_START;
    return String.fromCharCode(code - base + 0x30);
  });
}

/**
 * True when the string carries at least one Arabic-Indic digit. Exists so a
 * caller can REPORT a value rather than silently rewrite it — used by the
 * data-audit script, never by a write path.
 */
export function hasNonLatinDigits(value: string | null | undefined): boolean {
  if (!value) return false;
  return NON_LATIN_DIGIT.test(value);
}

/**
 * Fold an UNCONTROLLED identifier input in place, as the value arrives.
 *
 * Wire it to `onInput`, never `onKeyDown`. `input` is the one event that fires
 * for EVERY way a value can change — keystroke, paste, drag-drop, autofill,
 * speech, an IME commit — and a keystroke-only guard catches the first of those
 * and misses the rest. That gap is how `١٢٥٨٤٧٢٧٥٢` reached
 * `trucks.vehicle_registration` on a live row.
 *
 * Rewrites the DOM node rather than routing through React state, so the
 * surrounding uncontrolled <form>, `defaultValue` and form reset all keep
 * working. The substitution is 1 character for 1 character, so the caret does
 * not move and typing mid-string is unaffected.
 *
 * THIS IS A COURTESY, NOT THE GUARANTEE. A form is never the only caller, so
 * the server actions normalise again at the write — see `idText()` in
 * app/fleet/actions.ts, app/drivers/actions.ts and app/customers/actions.ts.
 * Deleting one of those because "the input already handles it" reopens the bug.
 *
 * Typed on the minimal structural shape, not `HTMLInputElement`, so it also
 * takes a textarea and stays usable from a non-DOM test.
 */
export function foldDigitsInPlace(el: { value: string }): void {
  const next = toLatinDigits(el.value);
  if (next !== el.value) el.value = next;
}
