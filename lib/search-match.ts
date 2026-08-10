// Client-side matcher — for PAGES AND NAV DESTINATIONS ONLY.
//
// READ THIS BEFORE REUSING IT: record search (trucks, drivers, invoices,
// parts, …) does NOT come through here. Records are matched in SQL by
// `public.search_everything` (migration 0102), which runs SECURITY INVOKER
// so RLS decides what the user may see. Scoring records in TypeScript would
// mean shipping rows to the browser to rank them, which is the opposite of
// that guarantee. This file exists only because pages are a static,
// non-sensitive list with no database rows behind them.
//
// The normalisation and the score tiers below deliberately MIRROR
// search_norm() / search_score() in 0102, so a query behaves the same way
// against a page name as against a record. They are two implementations of
// one rule, which is a drift risk — the mitigation is that this one only
// ever sees a hardcoded ~15-item list, so if the two disagree the visible
// symptom is a nav entry ranking oddly, never a wrong or missing record.

/** Arabic + Latin folding. Mirrors public.search_norm(text) in 0102. */
export function searchNorm(input: string): string {
  if (!input) return "";
  let s = input.toLowerCase();

  // Alef variants, alef maksura, teh marbuta, hamza carriers.
  s = s
    .replace(/[أإآٱ]/g, "ا") // أ إ آ ٱ -> ا
    .replace(/ى/g, "ي")                     // ى -> ي
    .replace(/ة/g, "ه")                     // ة -> ه
    .replace(/ؤ/g, "و")                     // ؤ -> و
    .replace(/ئ/g, "ي");                    // ئ -> ي

  // Tashkeel (harakat) and tatweel.
  s = s.replace(/[ً-ْٰـ]/g, "");

  // Arabic-Indic digits ٠-٩ -> 0-9.
  s = s.replace(/[٠-٩]/g, (d) =>
    String.fromCharCode(d.charCodeAt(0) - 0x0660 + 0x30)
  );

  return s.replace(/\s+/g, " ").trim();
}

/**
 * Score one field against an already-normalised query.
 * Tiers mirror public.search_score: exact 1.0 > prefix 0.9 > substring 0.75
 * > similarity. The similarity tier here is a cheap bigram Dice coefficient
 * rather than Postgres trigram similarity — close enough to rank a short
 * static list, and never used for records.
 */
export function searchScore(field: string | null | undefined, normQuery: string): number {
  if (!field || !normQuery) return 0;
  const f = searchNorm(field);
  if (!f) return 0;
  if (f === normQuery) return 1;
  const at = f.indexOf(normQuery);
  if (at === 0) return 0.9;
  if (at > 0) return 0.75;
  return dice(f, normQuery);
}

function bigrams(s: string): string[] {
  const padded = ` ${s} `;
  const out: string[] = [];
  for (let i = 0; i < padded.length - 1; i++) out.push(padded.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice over bigrams. 0..1, order-insensitive, typo-tolerant. */
function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  const pool = new Map<string, number>();
  for (const g of A) pool.set(g, (pool.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of B) {
    const n = pool.get(g) ?? 0;
    if (n > 0) {
      pool.set(g, n - 1);
      hits++;
    }
  }
  return (2 * hits) / (A.length + B.length);
}

/** Shared floor. Below this a match is noise; 0102 uses the same 0.3. */
export const SEARCH_SCORE_FLOOR = 0.3;

/** Shared minimum query length. 0102 returns nothing below this too. */
export const SEARCH_MIN_CHARS = 2;
