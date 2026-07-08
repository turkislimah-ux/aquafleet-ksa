// KSA plate model — pure helpers. A Saudi plate is 3 Latin letters + 4 digits.
// Storage stays ONE canonical string, no schema change: "ABC-1234" (letters,
// dash, digits, always uppercase, no spaces). This is the format createTruck /
// updateTruck (app/fleet/actions.ts) insert verbatim and the DB's
// trucks_plate_lower_unique index (0005) dedups case-insensitively — an
// uppercase-only canonical form is stable against that index either way.
//
// Only these 17 Latin letters are valid on a real KSA plate (the rest have no
// Arabic-plate counterpart). Digits are plain 0-9. Both maps below are FIXED —
// never invent substitutes.
export const PLATE_LETTERS = [
  "A", "B", "D", "E", "G", "H", "J", "K", "L", "N", "R", "S", "T", "U", "V", "X", "Z",
] as const;
export type PlateLetter = (typeof PLATE_LETTERS)[number];

const PLATE_LETTER_SET = new Set<string>(PLATE_LETTERS);

export function isPlateLetter(ch: string): ch is PlateLetter {
  return PLATE_LETTER_SET.has(ch.toUpperCase());
}

// Fixed Latin -> Arabic letter map (authoritative, do not alter).
export const AR_LETTER_MAP: Record<PlateLetter, string> = {
  A: "أ", B: "ب", D: "د", E: "ع", G: "ق", H: "ح", J: "ط", K: "ك", L: "ل",
  N: "ن", R: "ر", S: "س", T: "ط", U: "ع", V: "ف", X: "ص", Z: "ز",
};

// Fixed Latin digit -> Arabic-Indic digit map (authoritative, do not alter).
export const AR_DIGIT_MAP: Record<string, string> = {
  "0": "٠", "1": "١", "2": "٢", "3": "٣", "4": "٤",
  "5": "٥", "6": "٦", "7": "٧", "8": "٨", "9": "٩",
};

// The 7 boxes: 3 letters then 4 digits, each "" when empty/unparsed.
export type PlateBoxes = { letters: [string, string, string]; digits: [string, string, string, string] };

export function emptyPlateBoxes(): PlateBoxes {
  return { letters: ["", "", ""], digits: ["", "", "", ""] };
}

// Assemble the canonical stored string from box state. Only fully-filled
// boxes produce a "clean" ABC-1234 string; a partially-filled set still
// assembles whatever is present (no dash) so the required-field check on the
// surrounding form still sees a non-empty value while the user is mid-typing.
export function assemblePlate(boxes: PlateBoxes): string {
  const letters = boxes.letters.join("");
  const digits = boxes.digits.join("");
  if (letters.length === 3 && digits.length === 4) return `${letters}-${digits}`;
  return `${letters}${digits}`;
}

// Best-effort parse of ANY stored plate string back into the 7 boxes. Existing
// data may not conform to the new 3-letter+4-digit format (e.g. legacy demo
// rows are stored "1111 BBB" — digits first, then letters, space-separated).
// Strategy: scan the raw string left-to-right, uppercase each char; the first
// 3 characters that are valid plate letters fill the letter boxes (in the
// order encountered), the first 4 digit characters fill the digit boxes (in
// the order encountered) — independent of each other's position, so digit-
// first legacy strings parse correctly. Anything else (dashes, spaces,
// invalid letters, extra digits) is ignored. Never throws; unmatched boxes
// stay "".
export function parsePlate(stored: string): PlateBoxes {
  const boxes = emptyPlateBoxes();
  if (!stored) return boxes;
  let li = 0;
  let di = 0;
  for (const raw of stored) {
    const ch = raw.toUpperCase();
    if (li < 3 && isPlateLetter(ch)) {
      boxes.letters[li] = ch;
      li++;
      continue;
    }
    if (di < 4 && ch >= "0" && ch <= "9") {
      boxes.digits[di] = ch;
      di++;
    }
  }
  return boxes;
}

// Live Arabic preview for whatever boxes are currently filled. Empty boxes
// render as "" (display-only — never required, user never types Arabic).
export function arabicPlatePreview(boxes: PlateBoxes): string {
  const letters = boxes.letters.map((l) => (l && isPlateLetter(l) ? AR_LETTER_MAP[l as PlateLetter] : "")).join("");
  const digits = boxes.digits.map((d) => AR_DIGIT_MAP[d] ?? "").join("");
  if (!letters && !digits) return "";
  return `${letters} ${digits}`.trim();
}
