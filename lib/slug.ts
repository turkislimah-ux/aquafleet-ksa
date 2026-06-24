// Canonical slug helpers for lookup-table keys (staff_roles.key, leave_types.key).
// Shared by the server actions (addStaffRole/addLeaveType) AND the client forms
// (RoleSelect/LookupSelect) so the live "Will be saved as" preview matches what
// the DB stores. The DB CHECK constraint (migration 0013) is the hard floor:
//   staff_roles.key / leave_types.key  ~  ^[a-z][a-z0-9_]*$

/**
 * Convert a human label to a DB-safe slug candidate.
 * Matches DB CHECK constraint shape: ^[a-z][a-z0-9_]*$
 *   - lowercase only
 *   - letters, digits, underscores
 *
 * Does NOT strip leading non-letters. If the result starts with a
 * non-letter (digit or underscore), it's an invalid slug and
 * isValidSlug() will return false — the form must reject it loudly
 * with "Label must start with a letter."
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
