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

// sampleTripRef() stood here and is GONE. It built an illustrative sample of
// a project's ref FORMAT — "K1-026-0001", always counter 0001, no lookup and
// no DB round-trip — to show the scheme 0033 gives new trips. Its only caller
// was the statement header's "Ref." line, which Turki replaced with the
// statement PERIOD (c487a50), leaving the helper exported with nothing calling
// it. A format demonstration is not a ref, and this file is for rendering real
// ones; keeping it invited a future caller to print a fabricated number beside
// genuine ones. If a screen ever needs to TEACH the format, it should say so in
// words from lib/i18n.ts rather than mint a plausible-looking ref.
//
// The FORMAT itself is not documented only here: 0033 owns it, and the two
// helpers above render the refs the database actually issues.
