// Shared trip-ref display helper. ALL trip-ref rendering (Kanban cards,
// invoice tables, statements) must go through this file — a later batch
// changes the ref format, and that change should only need to happen here.

/** Single trip's ref, or a muted fallback label if not yet backfilled. */
export function formatTripRef(ref: string | null | undefined): string {
  return ref ?? "No ref";
}

/**
 * Range label for a group of trip refs, e.g. "WT-2026-0001 – WT-2026-0012".
 * Order is caller-supplied (typically trip_date ascending) — this just takes
 * first/last, it does not sort. Falls back gracefully when refs are missing
 * or there's only one trip.
 */
export function tripRefRangeLabel(refs: (string | null | undefined)[]): string {
  const clean = refs.filter((r): r is string => !!r);
  if (clean.length === 0) return "No ref";
  if (clean.length === 1) return clean[0];
  const first = clean[0];
  const last = clean[clean.length - 1];
  if (first === last) return first;
  return `${first} – ${last}`;
}

/**
 * Illustrative sample of a project's trip-ref FORMAT, e.g. "K1-026-0001" —
 * NOT a real trip's ref (no counter lookup, no DB round-trip). Demonstrates
 * the scheme new trips for this project will follow (0033):
 * <initials>-<yyy>-NNNN, where initials = projects.initials, yyy = last 3
 * digits of the year, NNNN = a per-project/per-year counter (always shown
 * as 0001 here — this is a demonstration, not a count). Returns null when
 * the project has no initials yet (e.g. legacy/pre-0033 data).
 */
export function sampleTripRef(
  initials: string | null | undefined,
  year: number = new Date().getFullYear()
): string | null {
  if (!initials) return null;
  const yyy = String(year % 1000).padStart(3, "0");
  return `${initials}-${yyy}-0001`;
}
