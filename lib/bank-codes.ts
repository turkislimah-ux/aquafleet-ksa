// BANK DISPLAY LABEL (0202) — the ONE spelling of a bank on every surface.
//
// Turki's rule: a bank shows as its 4-letter code WITH its name, in that
// pairing, name per locale — "RJHI · Al Rajhi Bank" / "RJHI · مصرف الراجحي".
// The code is bank_codes.key, seeded once and never typed anywhere in the app;
// the names are the row's own label/label_ar, resolved per reader (the 0201
// lookup rule — bank names live on rows, never in lib/i18n.ts).
//
// FOUR SURFACES call this — the picker options, the picker's selected value
// (a native <select> shows the chosen option's own text, so those two are one
// call site), the payslip screen header, and the printed sheet's masthead.
// None of them composes key + name itself: one helper, or the four drift.
//
// The middot is the same separator the payslip header already uses between
// name and month. No forced direction on the pair: in Arabic the bidi
// algorithm places the Latin code at the reading start of the RTL line, which
// is exactly the "code first" pairing the rule asks for.
//
// Purity: no React, no Supabase, no Date — row in, string out.

import { arText, type Lang } from "./i18n";

export function bankLabel(
  b: { key: string; label: string; label_ar: string },
  lang: Lang,
): string {
  return `${b.key} · ${arText(b.label, b.label_ar, lang)}`;
}
