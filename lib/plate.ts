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
//
// THIS IS THE BOUNDARY WHERE DISPLAY STATE BECOMES A STORED VALUE, so it filters
// rather than trusts its caller. The Arabic forms above are PREVIEW ONLY — they
// exist so a user can check the plate against the physical one — and an
// Arabic-Indic digit reaching `trucks.plate` would be invisible in the UI
// (it renders as a plate either way) while silently missing every lookup,
// including the case-insensitive unique index the header describes.
//
// Today's input handlers in components/PlateInput.tsx already reject anything
// outside 0-9 and PLATE_LETTERS, so this filter changes NO current output — it
// is here so that a future caller assembling boxes from somewhere other than
// those handlers cannot reintroduce the leak. Cheap, and the failure it
// prevents is a silent data defect rather than a visible one.
export function assemblePlate(boxes: PlateBoxes): string {
  const letters = boxes.letters.filter((l) => isPlateLetter(l)).join("").toUpperCase();
  const digits = boxes.digits.filter((d) => d >= "0" && d <= "9").join("");
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

// NOTE: an `arabicPlatePreview(boxes)` helper used to sit here, joining the two
// maps above into a display string. It was exported and never once called —
// components/PlateInput.tsx builds the same preview inline from AR_LETTER_MAP /
// AR_DIGIT_MAP, and did so from the same commit that introduced both. Deleted
// rather than left dormant: it emitted exactly the Arabic-Indic digits this
// app has now finished eliminating everywhere else, so leaving it exported was
// a loaded gun aimed at a future caller. The maps stay — PlateInput needs them,
// and a plate preview is the ONE place Arabic numerals are wanted.
