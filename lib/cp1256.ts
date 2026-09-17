// WINDOWS-1256 ENCODER (0202) — bytes for the bank-transfer CSV, nothing else.
//
// The bank's salary-upload portal parses Windows-1256 ("Arabic (Windows)"), the
// legacy single-byte codepage — NOT UTF-8, and a UTF-8 BOM makes it reject the
// file outright. TextEncoder only emits UTF-8 (the WHATWG spec removed every
// legacy encoder on purpose: the web should stop PRODUCING these files), so an
// app that must produce one carries its own table. This is that table.
//
// SCOPE. lib/csv.ts remains the one CSV mechanism and UTF-8+BOM remains the
// spelling of every HUMAN export (Excel needs the BOM — see the comment there).
// This encoder exists for exactly one machine reader and is called from exactly
// one place, the bank variant branch in lib/csv.ts. Do not reach for it to "fix"
// mojibake anywhere else — the fix for a human-facing file is the BOM, not 1256.
//
// THE TABLE is the byte→codepoint column of unicode.org's WINDOWS/CP1256.TXT,
// all 128 high bytes, transcribed in order (0x80 € … 0xFF ے). Indexed by
// (byte − 0x80); the encoder inverts it into a Map at module load. ASCII
// 0x00–0x7F is identity and is not tabulated.
//
// UNMAPPABLE CODE POINTS BECOME "?" (0x3F). For THIS file that is the right
// failure: a salary row must upload even if a name carries a character the
// codepage never had (Persian گ maps, but e.g. CJK does not), and "?" in a name
// the clerk can read past beats a rejected batch. The check script asserts both
// directions — the whole Arabic header line survives WITHOUT a "?" and a
// genuinely unmappable character produces one.
//
// Purity: string in, bytes out. No React, no Supabase, no Date.

/** Code points for bytes 0x80–0xFF, in byte order. Source: CP1256.TXT. */
const HIGH_CODEPOINTS: readonly number[] = [
  // 0x80–0x8F
  0x20ac, 0x067e, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0679, 0x2039, 0x0152, 0x0686, 0x0698, 0x0688,
  // 0x90–0x9F
  0x06af, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x06a9, 0x2122, 0x0691, 0x203a, 0x0153, 0x200c, 0x200d, 0x06ba,
  // 0xA0–0xAF
  0x00a0, 0x060c, 0x00a2, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a7,
  0x00a8, 0x00a9, 0x06be, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x00af,
  // 0xB0–0xBF
  0x00b0, 0x00b1, 0x00b2, 0x00b3, 0x00b4, 0x00b5, 0x00b6, 0x00b7,
  0x00b8, 0x00b9, 0x061b, 0x00bb, 0x00bc, 0x00bd, 0x00be, 0x061f,
  // 0xC0–0xCF
  0x06c1, 0x0621, 0x0622, 0x0623, 0x0624, 0x0625, 0x0626, 0x0627,
  0x0628, 0x0629, 0x062a, 0x062b, 0x062c, 0x062d, 0x062e, 0x062f,
  // 0xD0–0xDF
  0x0630, 0x0631, 0x0632, 0x0633, 0x0634, 0x0635, 0x0636, 0x00d7,
  0x0637, 0x0638, 0x0639, 0x063a, 0x0640, 0x0641, 0x0642, 0x0643,
  // 0xE0–0xEF
  0x00e0, 0x0644, 0x00e2, 0x0645, 0x0646, 0x0647, 0x0648, 0x00e7,
  0x00e8, 0x00e9, 0x00ea, 0x00eb, 0x0649, 0x064a, 0x00ee, 0x00ef,
  // 0xF0–0xFF
  0x064b, 0x064c, 0x064d, 0x064e, 0x00f4, 0x064f, 0x0650, 0x00f7,
  0x0651, 0x00f9, 0x0652, 0x00fb, 0x00fc, 0x200e, 0x200f, 0x06d2,
];

/** codepoint → byte, inverted once at load. */
const TO_BYTE: ReadonlyMap<number, number> = new Map(
  HIGH_CODEPOINTS.map((cp, i) => [cp, 0x80 + i]),
);

const QUESTION_MARK = 0x3f;

/**
 * Encode a string to Windows-1256 bytes. ASCII passes through, the 128 high
 * codepage rows map through the table, everything else becomes "?" (0x3F).
 */
export function encodeCp1256(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    out[n++] = cp <= 0x7f ? cp : TO_BYTE.get(cp) ?? QUESTION_MARK;
  }
  // `for...of` walks code points, so an astral pair is ONE "?" — but it also
  // means `n` can undershoot s.length. Return the filled prefix only.
  return out.subarray(0, n);
}
