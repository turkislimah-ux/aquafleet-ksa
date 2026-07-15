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
