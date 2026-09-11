// Canonical slug helpers for lookup-table keys (staff_roles.key, leave_types.key).
// Shared by the server actions (addStaffRole/addLeaveType) AND the client forms
// (RoleSelect/LookupSelect) so the live "Will be saved as" preview matches what
// the DB stores. The DB CHECK constraint (migration 0013) is the hard floor:
//   staff_roles.key / leave_types.key  ~  ^[a-z][a-z0-9_]*$
//
// THE KEY IS NOT THE NAME. That sentence is the whole point of `lookupKey`
// below, and forgetting it is what made an Arabic role name unaddable: the key
// is an internal, immutable, ASCII handle ("Immutable keys on lookup tables" —
// CLAUDE.md §6), while the LABEL is what a human reads and may be written in
// any script. Deriving the first from the second is a CONVENIENCE that happens
// to work for Latin input; it was never a requirement, and treating it as one
// means the DB's ASCII constraint silently becomes a constraint on what
// language the user is allowed to type.

/**
 * Convert a human label to a DB-safe slug candidate.
 * Matches DB CHECK constraint shape: ^[a-z][a-z0-9_]*$
 *   - lowercase only
 *   - letters, digits, underscores
 *
 * Does NOT strip leading non-letters. If the result starts with a
 * non-letter (digit or underscore), it's an invalid slug and
 * isValidSlug() will return false.
 *
 * A label with NO Latin letters or digits at all — any pure-Arabic name —
 * collapses to "". That is correct for what this function is (a transliterator
 * it is not), and is exactly why callers must go through `lookupKey` rather
 * than treating "" as "the user typed something unusable".
 */
export function slugifyKey(input: string): string {
  const lowered = input.toLowerCase().trim();
  // Replace any run of non-[a-z0-9] with a single underscore
  const replaced = lowered.replace(/[^a-z0-9]+/g, '_');
  // Strip trailing underscore only
  return replaced.replace(/_+$/, '');
}

/**
 * Returns true if a string is a valid slug per the DB CHECK constraint.
 * Mirrors: ^[a-z][a-z0-9_]*$
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(slug);
}

// FNV-1a, 32-bit, over UTF-16 code units. Two seeds, concatenated, so the key
// carries 64 bits.
//
// NOT for security — for COLLISION AVOIDANCE. A collision here does not
// produce a duplicate row, it produces something worse: the add path looks up
// the existing row by key and REACTIVATES it, so two unrelated Arabic names
// would silently become one lookup entry. 32 bits over a few dozen rows is
// already safe by birthday bound, but 64 costs one extra loop and removes the
// argument entirely.
function fnv1a(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const hex8 = (n: number) => n.toString(16).padStart(8, "0");

/**
 * Fold a label to the form the hash is taken over.
 *
 * Case, surrounding space and internal whitespace runs are all flattened so
 * that "صيانة  ليلية " and "صيانة ليلية" are the SAME key — matching the
 * reactivate-don't-duplicate behaviour the Latin path already had via
 * `slugifyKey` ("Night Dispatcher" and "night dispatcher" share a key).
 *
 * NFC matters and is not decoration: Arabic text arrives decomposed from some
 * keyboards and composed from others, and the two forms are different strings
 * with identical glyphs. Without this, the same name typed on two devices would
 * make two rows.
 */
function foldForHash(label: string): string {
  return label.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * THE key for a lookup row, given the name a human typed — in ANY script.
 *
 * Two branches, and the first is the OLD behaviour verbatim:
 *
 *   readable: true   The label yields a valid slug, so the slug IS the key.
 *                    Every key already in the database took this branch, so
 *                    nothing existing changes and no backfill is implied.
 *   readable: false  The label has no usable Latin run — a pure-Arabic name, or
 *                    one starting with a digit. The key becomes an opaque but
 *                    DETERMINISTIC handle: "k" + 16 hex chars, which satisfies
 *                    ^[a-z][a-z0-9_]*$ by construction.
 *
 * Determinism is load-bearing, not a nicety. The add actions look the key up
 * first and reactivate a retired row rather than inserting a second one; a
 * random key would defeat that and let the same Arabic name accumulate rows.
 *
 * THE HASH IS FROZEN. These keys are stored and are immutable by §6. Changing
 * the seeds, the fold, or the prefix would orphan every row created under the
 * old scheme — the label would still render, but re-adding that same name would
 * mint a second row beside it. If a different scheme is ever wanted it needs a
 * migration that rewrites the stored keys and every FK that points at them.
 *
 * `readable` is returned so the UI can decide whether the key is worth SHOWING.
 * "Saved as: night_shift" is useful; "Saved as: k3f9a1c0d5e2b7a84" is noise a
 * non-technical user should never have to look at.
 */
export function lookupKey(label: string): { key: string; readable: boolean } {
  const folded = foldForHash(label);
  if (!folded) return { key: "", readable: false };

  const slug = slugifyKey(label);
  if (isValidSlug(slug)) return { key: slug, readable: true };

  return {
    key: `k${hex8(fnv1a(folded, 0x811c9dc5))}${hex8(fnv1a(folded, 0xdaec38a0))}`,
    readable: false,
  };
}
