"use client";

// KSA structured plate input — 3 letter boxes + 4 digit boxes with a dash
// between the groups, rendered inside a plain FormData-based form (e.g.
// TruckFormModal). Follows the OperationStationField pattern: local state
// drives the boxes, then a single `<input type="hidden" name={name}>` carries
// the assembled canonical string into the surrounding <form>'s FormData — the
// form's own submit handler and app/fleet/actions.ts need no changes.
//
// Letters: auto-uppercased, restricted to the 17 valid KSA plate letters
// (lib/plate.ts PLATE_LETTERS) — any other letter is silently rejected (box
// stays as-is). Digits: 0-9 only.
//
// Ref indexing: a single CONTIGUOUS flat index 0..6 (letters 0-2, digits 3-6
// — no gap). Earlier version left a gap at index 3 "for the dash" even though
// the dash isn't focusable, and the advance/backspace math didn't match that
// gap (last-letter advance pointed at the unused slot 3; digit advance
// pointed at the box's OWN index instead of the next one) — auto-advance
// silently did nothing. Contiguous indexing makes every rule uniform: advance
// = focusBox(flat + 1), backspace-on-empty = focusBox(flat - 1).
//
// Arabic form is DISPLAY-ONLY, rendered as its own row directly BELOW the
// Latin boxes, character-aligned column-for-column (incl. a mirrored dash).
// Each Arabic character sits in its OWN <span> — cursive joining only occurs
// between adjacent codepoints in the same text run, so one character per
// element guarantees every letter renders in its isolated form (never
// connected to a neighbor), with no ZWNJ needed.

import { useMemo, useRef, useState } from "react";
import {
  AR_DIGIT_MAP,
  AR_LETTER_MAP,
  assemblePlate,
  emptyPlateBoxes,
  isPlateLetter,
  parsePlate,
  type PlateBoxes,
  type PlateLetter,
} from "@/lib/plate";
import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";

const BOX = "h-9 w-8 rounded-lg border text-center text-sm font-mono font-semibold uppercase outline-none focus:ring-2 focus:ring-brand-500/30";
const BOX_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;
const AR_CELL = "h-7 w-8 grid place-items-center text-xl leading-none font-semibold";

export default function PlateInput({
  name,
  defaultValue,
  label,
}: {
  name: string;
  defaultValue: string | null;
  // Default moved OUT of the destructuring pattern and into the body below: a
  // parameter default is evaluated before the component body, so it cannot
  // call a hook, and the fallback text now comes from the dictionary.
  // Callers that pass their own label still win — theirs is route copy and
  // stays English until that route's own batch.
  label?: string;
}) {
  const { lang } = useApp();
  const [boxes, setBoxes] = useState<PlateBoxes>(() => (defaultValue ? parsePlate(defaultValue) : emptyPlateBoxes()));
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  const canonical = useMemo(() => assemblePlate(boxes), [boxes]);

  // Per-column Arabic characters, isolated one-per-element (see header note).
  const arLetters = useMemo(
    () => boxes.letters.map((l) => (l && isPlateLetter(l) ? AR_LETTER_MAP[l as PlateLetter] : "")),
    [boxes.letters],
  );
  const arDigits = useMemo(() => boxes.digits.map((d) => AR_DIGIT_MAP[d] ?? ""), [boxes.digits]);

  const DIGITS_START = 3;
  const DIGITS_END = 6; // last digit flat index

  const setRef = (flat: number) => (el: HTMLInputElement | null) => {
    refs.current[flat] = el;
  };
  const focusBox = (flat: number) => refs.current[flat]?.focus();

  function onLetterInput(i: number, raw: string) {
    const flat = i;
    const ch = raw.slice(-1).toUpperCase();
    if (ch && !isPlateLetter(ch)) return; // reject invalid letter, box unchanged
    setBoxes((prev) => {
      const letters = [...prev.letters] as PlateBoxes["letters"];
      letters[i] = ch;
      return { ...prev, letters };
    });
    if (ch) focusBox(flat + 1); // i=2 (last letter) -> flat 3 = first digit box
  }

  function onDigitInput(i: number, raw: string) {
    const flat = DIGITS_START + i;
    const ch = raw.slice(-1);
    if (ch && !(ch >= "0" && ch <= "9")) return; // reject non-digit
    setBoxes((prev) => {
      const digits = [...prev.digits] as PlateBoxes["digits"];
      digits[i] = ch;
      return { ...prev, digits };
    });
    if (ch && flat < DIGITS_END) focusBox(flat + 1);
  }

  function onLetterKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    const flat = i;
    if (e.key === "Backspace" && !boxes.letters[i] && flat > 0) focusBox(flat - 1);
  }
  function onDigitKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    const flat = DIGITS_START + i;
    // flat - 1 for digit i=0 lands on flat 2 = last letter box — same uniform rule.
    if (e.key === "Backspace" && !boxes.digits[i] && flat > 0) focusBox(flat - 1);
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm muted">{label ?? t("common.plate", lang)} *</span>
      <div className="flex items-start gap-1.5">
        {[0, 1, 2].map((i) => (
          <div key={`lc${i}`} className="flex flex-col items-center gap-1">
            <input
              ref={setRef(i)}
              value={boxes.letters[i]}
              onChange={(e) => onLetterInput(i, e.target.value)}
              onKeyDown={(e) => onLetterKeyDown(i, e)}
              maxLength={1}
              aria-label={t("shared.fields.plateLetterAria", lang).replace("{n}", () => String(i + 1))}
              className={BOX}
              style={BOX_STYLE}
            />
            <span lang="ar" dir="rtl" className={AR_CELL}>{arLetters[i]}</span>
          </div>
        ))}
        <div className="flex flex-col items-center gap-1">
          <span className="muted px-0.5 h-9 grid place-items-center">—</span>
          <span className="muted px-0.5 h-7 grid place-items-center">—</span>
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={`dc${i}`} className="flex flex-col items-center gap-1">
            <input
              ref={setRef(DIGITS_START + i)}
              value={boxes.digits[i]}
              onChange={(e) => onDigitInput(i, e.target.value)}
              onKeyDown={(e) => onDigitKeyDown(i, e)}
              maxLength={1}
              inputMode="numeric"
              aria-label={t("shared.fields.plateDigitAria", lang).replace("{n}", () => String(i + 1))}
              className={BOX}
              style={BOX_STYLE}
            />
            <span lang="ar" dir="rtl" className={AR_CELL}>{arDigits[i]}</span>
          </div>
        ))}
      </div>
      <input type="hidden" name={name} value={canonical} />
    </div>
  );
}
