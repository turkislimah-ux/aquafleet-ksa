// ATLAS CHARTS — print-safe grayscale SVG, hand-built.
//
// NOT RECHARTS, AND NOT BY PREFERENCE.
// -----------------------------------------------------------------------------
// Recharts needs a live viewport to size itself: ResponsiveContainer resolves a
// percentage height against one, so in a headless print pass it collapses to
// zero height and the chart silently disappears from the sheet. These functions
// emit fixed geometry that is already correct before a browser ever sees it.
//
// GRAYSCALE IS THE ONLY INK, so a series can NEVER be identified by hue. Every
// chart here separates its series on FOUR independent channels at once:
//   1. stroke dash pattern
//   2. marker shape (filled disc against hollow square)
//   3. fill (solid tint against diagonal hatch)
//   4. a DIRECT label on the series itself
// Any one of the four alone survives a fax, a photocopier or a tired reader.
// The legend is a fifth affordance, not the primary one, and it draws the REAL
// dash pattern and the REAL marker rather than a generic chip: a legend that
// does not show what is actually on the page is decoration.
//
// SIZING
// -----------------------------------------------------------------------------
// viewBox units are meaningful only relative to the box the SVG lands in. The
// same 760-unit chart is half the apparent type size in a half-measure column,
// which is how a chart ends up with 4px axis labels nobody chose. So every
// function takes an explicit pixel width EQUAL TO ITS CONTAINER'S and the
// caller never rescales the result.
//
// MIRRORING
// -----------------------------------------------------------------------------
// An RTL sheet reads its charts right to left: the primary axis moves to the
// trailing edge, the time series runs from the right, the day ticks reverse and
// the direct labels flip with them.
//
// It is done by MAPPING COORDINATES, never by transform: scale(-1,1) on the
// group. A mirror transform flips the glyphs too, and a chart full of
// backwards numerals is not a subtle failure, but it is one that a quick
// look at a thumbnail will miss.
//
// TWO THINGS DELIBERATELY DO NOT FLIP:
//   - The HATCH ANGLE. It is a texture standing for "did not happen", not a
//     direction. Mirroring it makes an Arabic sheet and an English sheet
//     disagree about what the same fill means.
//   - The glyph run inside any <text>. Each one is emitted with an explicit
//     direction of ltr plus unicode-bidi: plaintext, so text-anchor stays
//     GEOMETRIC (start is the left edge, always) while each individual string
//     still picks its own base direction from its own first strong character.
//     That is what lets an Arabic series label and a Latin axis number sit in
//     one chart, each ordered correctly, without a second flip fighting the
//     coordinate mapping.

export type ChartStyle = {
  /** Near-black. Never #000000: pure black prints as a flat hole and reads
   *  cheaper than a rich off-black on every press and every laser printer. */
  ink: string;
  /** A real mid-grey, around 45 to 55 per cent. Axis labels and the secondary
   *  series live here. */
  mid: string;
  /** Hairline grey. Visible, not washed out: the failure mode this engine
   *  exists to avoid is a near-white rule that reads as an unfinished page. */
  hair: string;
  /** Area and bar tint. Intentional, not light-grey-by-default. */
  tint: string;
  /** Face for labels. */
  font: string;
  /** Face for numerals. Must have tabular figures or the axis ticks wobble. */
  figFont: string;
  /** Label size in px at the container's own scale. */
  labelSize: number;
  /** Series stroke weight. */
  stroke: number;
  /** Axis rule weight. */
  axis: number;
  /** true = plot sits in a full keyline box (technical-drawing register).
   *  false = open L-shaped axis pair. */
  boxed: boolean;
  /** Uppercase and tracking on axis and legend labels. Set false for an Arabic
   *  sheet: Arabic has no case, and letter-spacing prises its joins apart. */
  caps: boolean;
  /** Mirror the plot for a right-to-left sheet. */
  rtl: boolean;
};

type Anchor = "start" | "middle" | "end";

const num = (n: number) => (Math.round(n * 100) / 100).toString();

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The coordinate frame for one chart.
 *
 * Every chart below is written in LTR coordinates and passes each x through
 * `f.x`. That keeps the geometry readable (an axis at L is at L) and confines
 * the whole of RTL support to three small functions rather than to an if inside
 * every draw call.
 */
type Frame = {
  s: ChartStyle;
  w: number;
  /** Map a POINT. */
  x: (v: number) => number;
  /** Map a RECT ORIGIN. A rect is positioned by its leading edge, so mirroring
   *  its x alone would place its trailing edge there instead and the bar would
   *  hang off the wrong side of its slot. */
  rx: (v: number, rw: number) => number;
  /** Flip a text anchor. */
  a: (a: Anchor) => Anchor;
};

function frame(s: ChartStyle, w: number): Frame {
  return {
    s,
    w,
    x: (v) => (s.rtl ? w - v : v),
    rx: (v, rw) => (s.rtl ? w - v - rw : v),
    a: (a) => (!s.rtl || a === "middle" ? a : a === "start" ? "end" : "start"),
  };
}

function txt(
  f: Frame,
  x: number,
  y: number,
  content: string,
  opt: {
    size?: number; anchor?: Anchor; fill?: string;
    weight?: number; mono?: boolean; caps?: boolean; track?: number;
  } = {},
): string {
  const s = f.s;
  const size = opt.size ?? s.labelSize;
  const caps = opt.caps ?? false;
  const track = opt.track ?? (caps ? 0.09 : 0);
  const family = opt.mono ? s.figFont : s.font;
  return (
    `<text x="${num(f.x(x))}" y="${num(y)}" font-family="${family}" font-size="${num(size)}"` +
    ` fill="${opt.fill ?? s.mid}" text-anchor="${f.a(opt.anchor ?? "start")}"` +
    ` font-weight="${opt.weight ?? 400}"` +
    (track ? ` letter-spacing="${num(track * size)}"` : "") +
    ` style="direction:ltr;unicode-bidi:plaintext;` +
    `font-variant-numeric:tabular-nums;font-feature-settings:'tnum' 1"` +
    `>${esc(caps ? content.toUpperCase() : content)}</text>`
  );
}

type Run = {
  text: string;
  size?: number; fill?: string; weight?: number; mono?: boolean; caps?: boolean; track?: number;
};

/**
 * ONE <text> holding SEVERAL differently-styled runs, laid out by the BROWSER.
 *
 * This exists because the alternative is measuring type in Node, and we cannot.
 * Two <text> elements set side by side require the caller to know how wide the
 * first one renders, and the only way to "know" that without a font engine is to
 * guess a glyph width — which is the exact mistake `trendLegend` below records
 * having already been burned by once. It was made a second time in `splitBar`:
 * the value was drawn at x+9 and its label at a hard-coded x+9+30, which holds
 * for a three-digit trip count and fails outright for a money string. A
 * nine-character figure at 12.5px measures about 44px, so "70,650.00" printed
 * straight through "PAID 100.0%" — in BOTH languages, since the offset mirrors.
 *
 * A <tspan> with no x of its own continues from wherever the previous run ENDED.
 * The browser does the measuring, so the answer is right for Latin figures,
 * Arabic labels, tracked capitals and any face the sheet is set in.
 *
 * The gap between runs is an EN SPACE (U+2002), not a coordinate. CSS
 * white-space collapsing only eats U+0020/U+0009/U+000A, so it survives, and
 * being part of the text it lands on the correct side under either direction.
 *
 * BIDI: the outer element keeps the file header's `direction:ltr` +
 * `unicode-bidi:plaintext` pair, so text-anchor stays GEOMETRIC while the runs
 * order themselves from the first strong character in the whole string. On an
 * Arabic sheet that character is in the LABEL, so the paragraph goes RTL and the
 * figure sits to the RIGHT of its label — which is the order an Arabic reader
 * wants, and the order the two-element version was hand-mirroring to produce.
 */
function txtRuns(
  f: Frame, x: number, y: number, runs: readonly Run[], opt: { anchor?: Anchor } = {},
): string {
  const s = f.s;
  const body = runs
    .map((r) => {
      const size = r.size ?? s.labelSize;
      const caps = r.caps ?? false;
      const track = r.track ?? (caps ? 0.09 : 0);
      return (
        `<tspan font-family="${r.mono ? s.figFont : s.font}" font-size="${num(size)}"` +
        ` fill="${r.fill ?? s.mid}" font-weight="${r.weight ?? 400}"` +
        (track ? ` letter-spacing="${num(track * size)}"` : "") +
        `>${esc(caps ? r.text.toUpperCase() : r.text)}</tspan>`
      );
    })
    .join("");
  return (
    `<text x="${num(f.x(x))}" y="${num(y)}" text-anchor="${f.a(opt.anchor ?? "start")}"` +
    ` style="direction:ltr;unicode-bidi:plaintext;` +
    `font-variant-numeric:tabular-nums;font-feature-settings:'tnum' 1"` +
    `>${body}</text>`
  );
}

/** A straight line in chart coordinates, mirrored as a pair of points. */
function line(f: Frame, x1: number, y1: number, x2: number, y2: number, attrs: string): string {
  return `<line x1="${num(f.x(x1))}" y1="${num(y1)}" x2="${num(f.x(x2))}" y2="${num(y2)}" ${attrs}/>`;
}

/** Nice round axis maximum and a tick step that lands on it.
 *
 *  `whole` is for the axes that carry a COUNT. Trips are indivisible, so a
 *  quarter-trip gridline is not a rounding preference, it is a measurement that
 *  cannot exist. The bare arithmetic produces one: niceScale(1, 4) gives a
 *  0.25 step — ticks at 0.25, 0.5, 0.75 — which is what a project with a single
 *  trip in its busiest month of the window would print. That is one trip away
 *  from live data, not a hypothetical; the sample never reaches it because its
 *  counts run to 200 a month, where the step is already 100. Clamping to a
 *  whole step therefore moves no approved raster. */
function niceScale(max: number, targetTicks: number, whole = false): { max: number; step: number } {
  // A ZERO OR ABSENT MAXIMUM POISONS EVERY COORDINATE BELOW. Math.log10(0) is
  // -Infinity, so mag is 0, norm is NaN and step is 0 — then the returned max is
  // NaN and every y() the caller computes is NaN, which Chromium draws as no
  // geometry at all. Math.max(...[]) is -Infinity and lands in the same place.
  // A one-unit axis is the honest answer: the series is flat at zero, so the
  // chart should show a baseline, not vanish.
  // This CANNOT fire on the approved sample data — every proof month has revenue
  // and trips — so it changes no signed-off raster. It fires on REAL data: a
  // project month with nothing delivered, which is a legitimate month.
  if (!(max > 0)) return { max: 1, step: 1 };
  const rough = max / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const raw = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  // Rounded UP, never to nearest: a 1.5 step rounding down to 1 would add ticks
  // rather than remove the fraction, and 2.5 -> 2 would no longer land on the
  // maximum the line below computes from it.
  const step = whole ? Math.max(1, Math.ceil(raw)) : raw;
  return { max: Math.ceil(max / step) * step, step };
}

/** A money tick, in thousands ONLY WHEN THAT IS STILL THE SAME NUMBER.
 *
 *  The axis used to read `(v / 1000).toFixed(0) + "k"` unconditionally, which
 *  is exact for the approved sample (its steps are 5,000 and 20,000) and WRONG
 *  the moment a real project is small: at a 500 step the ticks 500 / 1,000 /
 *  1,500 all round to "1k", "1k", "2k" — two gridlines carrying one label, and
 *  a line labelled 1k that is really 500. The empty month is worse still: the
 *  zero-max guard above hands back a one-unit axis, and BOTH its ticks print
 *  "0k". A tick that misstates its own gridline is a false figure on a finance
 *  sheet, not a typographic nit.
 *
 *  So the unit is chosen from the STEP, once per axis, and never per tick —
 *  mixed units down one axis would be its own lie. `k` survives only where it
 *  loses nothing; otherwise the value is spelt out, grouped like every other
 *  figure on the sheet. Steps under 1,000 cap the axis at a few thousand, so
 *  the spelt-out form cannot outgrow the 44px the label well affords.
 *
 *  Sample data is untouched: both proof steps are whole thousands, so they take
 *  the same branch they always did and no signed-off raster moves. */
function moneyTick(v: number, step: number): string {
  if (step % 1000 === 0) return (v / 1000).toFixed(0) + "k";
  const [int, frac] = Math.abs(v).toFixed(2).split(".");
  const dec = frac.replace(/0+$/, "");
  // Grouping by hand rather than toLocaleString: the kit renders one document
  // in one language, and a locale-aware separator would put Arabic-Indic digits
  // on the Arabic sheet, where every other chart figure is Latin.
  return (v < 0 ? "-" : "") + int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (dec ? "." + dec : "");
}

const hatchId = (k: string) => `atlas-hatch-${k}`;

/**
 * Diagonal hatch: the only honest way to hold a second fill apart from a solid
 * one without colour. 45 degrees, spaced so it does not moire at 200 DPI.
 *
 * The angle does NOT mirror on an RTL sheet. See the file header.
 */
export function hatchDef(k: string, s: ChartStyle): string {
  return (
    `<pattern id="${hatchId(k)}" width="5" height="5" patternUnits="userSpaceOnUse"` +
    ` patternTransform="rotate(45)">` +
    `<rect width="5" height="5" fill="#ffffff"/>` +
    `<line x1="0" y1="0" x2="0" y2="5" stroke="${s.mid}" stroke-width="1.5"/>` +
    `</pattern>`
  );
}

/** Every chart root. direction:ltr so text-anchor stays geometric under the
 *  coordinate mapping above; the strings inside still order themselves. */
function svg(w: number, h: number, label: string, body: string): string {
  return (
    `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img"` +
    ` style="direction:ltr" aria-label="${esc(label)}">${body}</svg>`
  );
}

/* ------------------------------------------------------------------ */
/* 1. Two-series trend: a money series on the primary axis, a count on  */
/*    the secondary.                                                    */
/* ------------------------------------------------------------------ */

export type TrendPoint = { label: string; primary: number; secondary: number };

export function trendChart(
  s: ChartStyle,
  data: readonly TrendPoint[],
  w: number,
  h: number,
  opt: {
    primaryLabel: string;
    secondaryLabel: string;
    /** Title for the aria-label. The kit never invents wording. */
    aria: string;
  },
): string {
  const f = frame(s, w);
  // L is wide because the primary axis carries thousands labels; R is narrower
  // because the secondary carries bare counts. Under mirroring L lands on the
  // trailing edge, which is where the primary axis belongs on an RTL sheet.
  const L = 52, R = 40, T = 26, B = 34;
  const pw = w - L - R, ph = h - T - B;

  const pri = niceScale(Math.max(...data.map((d) => d.primary)), 4);
  // The secondary series is a TRIP COUNT, so its axis is whole (niceScale).
  const sec = niceScale(Math.max(...data.map((d) => d.secondary)), 4, true);

  const x = (i: number) => L + (pw * i) / (data.length - 1);
  const yPri = (v: number) => T + ph - (ph * v) / pri.max;
  const ySec = (v: number) => T + ph - (ph * v) / sec.max;

  let g = "";

  // Horizontal reference lines, keyed to the PRIMARY axis only. Two scales
  // sharing one grid is a lie; the secondary axis gets ticks on its own rule.
  for (let v = pri.step; v <= pri.max + 0.001; v += pri.step) {
    g += line(f, L, yPri(v), L + pw, yPri(v),
      `stroke="${s.hair}" stroke-width="0.6"${s.boxed ? "" : ` stroke-dasharray="1 3"`}`);
  }

  if (s.boxed) {
    g += `<rect x="${num(f.rx(L, pw))}" y="${num(T)}" width="${num(pw)}" height="${num(ph)}"` +
      ` fill="none" stroke="${s.ink}" stroke-width="${num(s.axis)}"/>`;
  } else {
    g += line(f, L, T + ph, L + pw, T + ph, `stroke="${s.ink}" stroke-width="${num(s.axis)}"`);
    g += line(f, L, T, L, T + ph, `stroke="${s.ink}" stroke-width="${num(s.axis)}"`);
    g += line(f, L + pw, T, L + pw, T + ph, `stroke="${s.mid}" stroke-width="${num(s.axis * 0.7)}"`);
  }

  // Primary axis in thousands. Spelling out 22,310 six times down the side
  // buries the shape of the line under its own labels.
  for (let v = 0; v <= pri.max + 0.001; v += pri.step) {
    g += line(f, L - 4, yPri(v), L, yPri(v), `stroke="${s.ink}" stroke-width="${num(s.axis)}"`);
    g += txt(f, L - 8, yPri(v) + s.labelSize * 0.35, moneyTick(v, pri.step),
      { anchor: "end", mono: true });
  }
  for (let v = 0; v <= sec.max + 0.001; v += sec.step) {
    g += line(f, L + pw, ySec(v), L + pw + 4, ySec(v), `stroke="${s.mid}" stroke-width="${num(s.axis)}"`);
    g += txt(f, L + pw + 8, ySec(v) + s.labelSize * 0.35, v.toString(), { mono: true });
  }

  for (let i = 0; i < data.length; i++) {
    g += txt(f, x(i), T + ph + 16, data[i].label, { anchor: "middle", caps: s.caps, fill: s.ink });
  }

  // Secondary first, so the primary series sits on top where they cross.
  const secPath = data.map((d, i) => `${i ? "L" : "M"}${num(f.x(x(i)))} ${num(ySec(d.secondary))}`).join(" ");
  g += `<path d="${secPath}" fill="none" stroke="${s.mid}" stroke-width="${num(s.stroke)}"` +
    ` stroke-dasharray="${num(s.stroke * 2.6)} ${num(s.stroke * 1.9)}" stroke-linecap="round"/>`;
  for (const [i, d] of data.entries()) {
    const r = s.stroke * 2.1;
    g += `<rect x="${num(f.rx(x(i) - r, r * 2))}" y="${num(ySec(d.secondary) - r)}" width="${num(r * 2)}"` +
      ` height="${num(r * 2)}" fill="#ffffff" stroke="${s.mid}" stroke-width="${num(s.stroke * 0.85)}"/>`;
  }

  const priPath = data.map((d, i) => `${i ? "L" : "M"}${num(f.x(x(i)))} ${num(yPri(d.primary))}`).join(" ");
  g += `<path d="${priPath}" fill="none" stroke="${s.ink}" stroke-width="${num(s.stroke * 1.25)}"` +
    ` stroke-linejoin="round" stroke-linecap="round"/>`;
  for (const [i, d] of data.entries()) {
    g += `<circle cx="${num(f.x(x(i)))}" cy="${num(yPri(d.primary))}" r="${num(s.stroke * 1.55)}"` +
      ` fill="${s.ink}"/>`;
  }

  // DIRECT labels on the final point of each series. The reader should not have
  // to travel to a legend to learn which line is which.
  //
  // THE SECONDARY LABEL SITS BELOW ITS POINT, AND BELOW RUNS OUT. The month
  // ticks are drawn at T + ph + 16, so a series ending ON the baseline puts its
  // label at T + ph + 15 — one pixel clear of a row of month names, which is to
  // say printed straight through them. Real data ends at zero routinely: an
  // empty month ends both series there, and a project's last month often has no
  // trips yet. So when below would land in the tick band the label flips ABOVE
  // its own point, and takes a second row only when the primary label is
  // already occupying the first. The proof's series both end high, so neither
  // branch fires on the approved rasters.
  //
  // THE PRIMARY LABEL SITS ABOVE ITS POINT, AND ABOVE IS EXACTLY WHERE THE LINE
  // COMES FROM WHEN THE SERIES IS FALLING. It is set at `x(last) - 10` with the
  // text anchored at its end, so it occupies the wedge up-and-left of the final
  // point — which is the wedge the final SEGMENT occupies too when the series
  // descends into that point. On a rising series the segment arrives from
  // below-left and the wedge is empty, which is why this went unseen: the
  // approved breakdown raster rises into its last month, and so does every
  // fixture drawn before now.
  //
  // A FALLING SERIES IS NOT AN EDGE CASE. Operations' Q3 2026 falls from 658
  // trips to 124, and the label printed with the line struck clean through it —
  // the word was there and could not be read. Any period whose last month is
  // quiet does this, and a quiet last month is the normal shape of a period that
  // is still in progress.
  //
  // So when the series falls, the label flips BELOW its own point, where the
  // departing wedge is empty. `below` has the same floor the secondary label
  // has and for the same reason — past it lies the row of month names — and when
  // that floor is hit the label stays above, because a struck-through word is
  // still legible more often than one printed over a date.
  const last = data.length - 1;
  const py = yPri(data[last].primary);
  const sy = ySec(data[last].secondary);
  const floor = T + ph + 2;
  const priFalls = data.length > 1 && data[last - 1].primary > data[last].primary;
  const priY = priFalls && py + 15 <= floor ? py + 15 : py - 9;
  const priBelow = priY > py;
  g += txt(f, x(last) - 10, priY, opt.primaryLabel,
    { anchor: "end", fill: s.ink, weight: 600, size: s.labelSize * 0.95 });
  const below = sy + 15;
  let secY = below > floor
    ? sy - 9 - (Math.abs(sy - py) < s.labelSize * 1.8 ? s.labelSize * 1.4 : 0)
    : below;
  // MOVING THE PRIMARY DOWN PUTS IT IN THE SECONDARY'S LANE. Both labels sit
  // below their own points now, and two points at the same RELATIVE height on
  // their own axes — 400 of 800 trips beside 50 of 100 per cent — put both words
  // on one row. The primary keeps its place, being the heavier of the two; the
  // secondary steps a row clear, upward, since downward is the month names.
  //
  // GATED ON THE FLIP HAVING HAPPENED, not on the two labels being close. The
  // approved breakdown raster ends with its labels 9.9px apart against a
  // threshold of 11.2, so an ungated version of this test would fire there and
  // move a raster that has already been signed off for a collision it does not
  // have.
  if (priBelow && Math.abs(secY - priY) < s.labelSize * 1.4) {
    secY = priY - s.labelSize * 1.4;
  }
  g += txt(f, x(last) - 10, secY, opt.secondaryLabel,
    { anchor: "end", fill: s.mid, size: s.labelSize * 0.95 });

  return svg(w, h, opt.aria, g);
}

/* ------------------------------------------------------------------ */
/* 2. A count per day across a month.                                   */
/* ------------------------------------------------------------------ */

export function dailyChart(
  s: ChartStyle, data: readonly number[], w: number, h: number, aria: string,
): string {
  const f = frame(s, w);
  const L = 30, R = 6, T = 14, B = 26;
  const pw = w - L - R, ph = h - T - B;
  // Every bar here is a count of trips on one day — a whole axis, same reason.
  const sc = niceScale(Math.max(...data), 3, true);
  // Gridlines stay on the round values niceScale picked, but the bars are
  // mapped against a slightly taller ceiling so a peak day stops short of the
  // plot's top edge. A bar welded to the frame reads as a clipped chart.
  const ceil = sc.max * 1.08;
  const slot = pw / data.length;
  const bw = Math.min(slot * 0.62, 9);
  const y = (v: number) => T + ph - (ph * v) / ceil;

  let g = "";
  for (let v = sc.step; v <= sc.max + 0.001; v += sc.step) {
    g += line(f, L, y(v), L + pw, y(v),
      `stroke="${s.hair}" stroke-width="0.6"${s.boxed ? "" : ` stroke-dasharray="1 3"`}`);
    g += txt(f, L - 7, y(v) + s.labelSize * 0.35, v.toString(), { anchor: "end", mono: true });
  }
  if (s.boxed) {
    g += `<rect x="${num(f.rx(L, pw))}" y="${num(T)}" width="${num(pw)}" height="${num(ph)}"` +
      ` fill="none" stroke="${s.ink}" stroke-width="${num(s.axis)}"/>`;
  }
  g += line(f, L, T + ph, L + pw, T + ph, `stroke="${s.ink}" stroke-width="${num(s.axis)}"`);

  // Label the 1st, then every fifth, then the last. A label under all 31 bars
  // is unreadable and a label under none is undatable. Where the last day
  // crowds the fifth-day tick before it (31 against 30), the TICK yields: the
  // last day is the one carrying information, since it states the month length.
  const n = data.length;
  const prevTick = Math.floor(n / 5) * 5;
  const yielded = n % 5 !== 0 && n - prevTick <= 2 ? prevTick : -1;

  for (const [i, v] of data.entries()) {
    const cx = L + slot * (i + 0.5);
    if (v > 0) {
      g += `<rect x="${num(f.rx(cx - bw / 2, bw))}" y="${num(y(v))}" width="${num(bw)}"` +
        ` height="${num(T + ph - y(v))}" fill="${s.tint}" stroke="${s.ink}" stroke-width="0.7"/>`;
    }
    const d = i + 1;
    if ((d === 1 || d % 5 === 0 || d === n) && d !== yielded) {
      g += txt(f, cx, T + ph + 13, d.toString().padStart(2, "0"),
        { anchor: "middle", mono: true, size: s.labelSize * 0.92 });
    }
  }
  return svg(w, h, aria, g);
}

/* ------------------------------------------------------------------ */
/* 3. Proportional split.                                               */
/* ------------------------------------------------------------------ */

export type SplitPart = {
  label: string;
  value: number;
  /** Printed inside or beside the block. The kit does not format it. */
  display: string;
  /** Hatch rather than fill: the part that did NOT happen. */
  hatch?: boolean;
};

/** How far inside its own block a knocked-out run starts. */
const SPLIT_INSET = 9;

/**
 * WHAT A BLOCK MUST HOLD BEFORE ANYTHING IS KNOCKED OUT OF IT: the figure and
 * the share. Not the band name — that one is allowed to go to the clip.
 *
 * These two ems are the ONLY guessed glyph widths in this file, and `txtRuns`
 * above records why guessing is normally forbidden. They are affordable here
 * for one reason: both runs are LATIN DIGITS AND PUNCTUATION IN EITHER
 * LANGUAGE, because `lib/utils.ts` pins every figure in the app to en-US Latin
 * digits. There is no Arabic arm to keep in step and no dictionary word whose
 * length is the reader's to choose.
 *
 * MEASURED 2026-09-13 off the live sheets with getComputedTextLength, and
 * ROUNDED UP: the failure direction is not symmetric. Over-estimating sets a
 * label above the bar that would just have fitted inside it; under-estimating
 * clips a digit off a number, which is the defect these exist to stop.
 *
 *   figure  0.486 - 0.500 em (bold tabular, Helvetica Neue and Cairo alike)
 *   share   0.536 em in Cairo, 0.629 in Helvetica Neue - the LATIN, wider
 *           figure is used for both, so Arabic errs toward the safe side too.
 */
const SPLIT_FIG_EM = 0.5;
const SPLIT_PCT_EM = 0.64;

/**
 * The block width at which a label stops fitting INSIDE its own block. Pulled
 * out of the drawing loop because the answer is needed for every block before
 * the first one is drawn — see `floats` in `splitBar`.
 */
function splitNeeds(display: string, pct: number, labelSize: number): number {
  // The share as it will be set: the EN SPACE and the % are two of its
  // characters, so the estimate counts the string it actually prints.
  const share = splitShare(pct);
  return (
    SPLIT_INSET +
    [...display].length * SPLIT_FIG_EM * labelSize * 1.25 +
    [...share].length * SPLIT_PCT_EM * labelSize * 0.95
  );
}

/** The share, set as one run. U+2002 EN SPACE, never U+0020 - see `txtRuns`. */
function splitShare(pct: number): string {
  return `\u2002${pct.toFixed(1)}%`;
}

/**
 * A proportional bar, deliberately NOT a donut.
 *
 * A donut of two slices spends most of its area on a hole, forces a leader line
 * to reach each label, and asks the reader to judge an ANGLE when the question
 * is a RATIO. A single bar answers it by length, labels in place, and costs a
 * fifth of the height.
 *
 * TWO PARTS. THREE AT A PUSH. FOUR IS OUT OF RANGE — and that is a limit of the
 * device, not of this implementation, so do not send a fourth part here
 * expecting a smaller version of the same chart.
 *
 * MEASURED at SHEET_W, 2026-09-13, on a four-band aging profile before the
 * caller was withdrawn. Two live-shaped runs:
 *
 *   14.4 / 27.3 / 17.8 / 40.5%  ->  94 / 179 / 117 / 266px. All four hold
 *     their figure and share; bands 1 and 3 lose the tail of their band NAME.
 *   5.0 / 11.8 / 18.6 / 64.7%   ->  33 / 78 / 122 / 425px. Bands 1 and 2
 *     cannot hold figure-plus-share, and cannot float above the bar either
 *     without printing over each other, so they go UNLABELLED; band 3 loses
 *     its name tail.
 *
 * Every one of those is a DEGRADED bar rather than a wrong figure — the clip
 * ordering and the float rule below see to that. But the bar carries ONE ink, so
 * four blocks have no boundary between them and a clipped name butts straight
 * into the next block's figure; and the labels that survive are the large bands,
 * which are the ones a reader could already see.
 *
 * TURKI'S RULING, 2026-09-13: receivables drops its bar rather than keep a
 * degraded one beside an aging table that states all four bands exactly. Four
 * blocks in one ink would need four distinguishable FILLS before their labels
 * were worth anything, and that is a different chart, not a label fix.
 *
 * The two remaining callers are both two-part and both read: revenue's
 * paid/outstanding, and the breakdown's delivered/scheduled.
 */
export function splitBar(
  s: ChartStyle,
  parts: readonly SplitPart[],
  w: number,
  h: number,
  opt: { total: string; footnote: string; aria: string },
): string {
  const f = frame(s, w);
  const total = parts.reduce((a, p) => a + p.value, 0);
  const barH = 26;
  const top = h - barH - 20;
  let g = `<defs>${hatchDef("split", s)}</defs>`;
  // HOW MANY BLOCKS WANT THE STRIP OF PAPER ABOVE THE BAR — settled for every
  // block BEFORE the first one is drawn, because whether a floating label can be
  // placed at all depends on what else is up there, and the loop finds that out
  // one block too late.
  //
  // A float is anchored on a block edge and runs OUTWARD, across its neighbours'
  // ground. One of them is fine: breakdown's hatched tail has the whole trailing
  // margin to itself. Two ADJACENT ones are not. A four-band aging profile put
  // two 33px and 77px blocks side by side, so both floated, both anchored within
  // 33px of each other, and their runs printed straight through one another —
  // the 2026-09-13 proof reads "30,675.07(2)51(7)5%00-30.B%YS1-60 DAYS". That is
  // TWO figures destroyed where the clip would have cost one band name.
  //
  // THAT FOUR-BAND CALLER IS GONE — receivables draws no bar now (see
  // lib/docvm/receivables.ts) and the two remaining callers are both two-part.
  // The rule STAYS, because it is what makes this function safe to hand a third
  // part to, and the measurement above is why it is the rule it is.
  //
  // No glyph estimate can settle it. A float's width is dominated by its
  // category NAME, a dictionary word in two languages, and measuring those is
  // what `txtRuns` above forbids. So the rule is the one needing no measurement:
  // A SOLID BLOCK FLOATS ONLY WHEN IT IS THE LONE FLOAT ON THE BAR. Otherwise it
  // prints no label. Absent type is recoverable from the table the chart sits
  // under; overlapped type is recoverable from nothing, and it takes its
  // neighbour down with it.
  //
  // A HATCHED block floats REGARDLESS, collision or not. It cannot knock its
  // label out — reversed type breaks up against the 45 degree strokes — so the
  // float is the only place its category is named, and suppressing it would drop
  // the category from the chart rather than merely from its labels.
  //
  // A ZERO part is not counted: it draws nothing and labels nothing, so letting
  // it occupy the one float would silence a block that has something to say.
  const floats = parts.filter(
    (p) =>
      p.value > 0 &&
      (p.hatch ||
        (w * p.value) / total < splitNeeds(p.display, (p.value / total) * 100, s.labelSize)),
  ).length;

  let x = 0;
  for (const p of parts) {
    // A ZERO PART IS NOT DRAWN AND NOT LABELLED. Turki's ruling 2026-09-13, on
    // the revenue sheet: a period with nothing outstanding printed
    // "0.00  0.0%  OUTSTANDING" floating over the trailing edge of a bar that is
    // 100% paid — a caption for a block with no width, which reads as a missing
    // segment rather than an absent one. The 100.0% on the block beside it
    // already says everything the zero part could.
    //
    // The RECT goes with the label, not just the text. A zero-width rect still
    // carries a 0.8px stroke, so leaving it drawn would print a stray vertical
    // hairline at the bar's end — a tick mark meaning nothing.
    //
    // Skipping costs no geometry: the part contributes 0 to `total`, so every
    // other block sits exactly where it did.
    if (p.value <= 0) continue;

    const pwid = (w * p.value) / total;
    const pct = (p.value / total) * 100;
    const share = splitShare(pct);
    g += `<rect x="${num(f.rx(x, pwid))}" y="${num(top)}" width="${num(pwid)}" height="${barH}"` +
      ` fill="${p.hatch ? `url(#${hatchId("split")})` : s.ink}" stroke="${s.ink}" stroke-width="0.8"/>`;

    // Knock the label out of the solid block; set it BENEATH the hatched one,
    // where reversed type would break up against the 45 degree strokes.
    if (!p.hatch && pwid >= splitNeeds(p.display, pct, s.labelSize)) {
      // CLIPPED TO ITS OWN BLOCK. Loose, the reversed type walks off the ink
      // onto white paper and vanishes MID-FIGURE, which is a silently wrong
      // number. Clipped, it stops at the block edge — so what the clip takes is
      // whatever is LAST in the run, and the run is ordered to make that a word
      // rather than a number.
      //
      // The `splitNeeds` test above is what keeps that ordering worth anything.
      // It was a bare `pwid > 74` until 2026-09-13 — a threshold by its own
      // admission, not a measurement — and an 11.8% band arrives at 77.5px, wide
      // enough to pass it and too narrow to hold the figure and the share, so
      // the share was clipped to "11.8" with the % gone. A number may lose
      // nothing. The block either holds both or holds neither.
      //
      // The id is derived from the geometry it clips, so two charts that collide
      // on it are two charts whose clip rects are identical anyway.
      const clip = `atlas-split-${num(w)}x${num(h)}-${num(x)}-${num(pwid)}`;
      g += `<clipPath id="${clip}"><rect x="${num(f.rx(x, pwid))}" y="${num(top)}"` +
        ` width="${num(pwid)}" height="${barH}"/></clipPath>`;
      g += `<g clip-path="url(#${clip})">` +
        txtRuns(f, x + SPLIT_INSET, top + barH / 2 + s.labelSize * 0.36, [
          { text: p.display, fill: "#ffffff", weight: 700, size: s.labelSize * 1.25, mono: true },
          // THE SHARE RIDES WITH THE FIGURE, NOT WITH THE LABEL. Both are
          // quantities and the clip above can only ever eat the run that ends
          // last, so the two of them go first and the NAME goes last. Set the
          // other way round — which is how this read until 2026-09-13 — the
          // share sits behind the label and is the first thing the clip
          // reaches: a 17.8% band printed "17.8", a number silently wrong by a
          // factor of a hundred, and its neighbour lost its share outright. A
          // truncated category name is recoverable from the table a chart sits
          // under; a truncated share is not recoverable from anything, because
          // nothing on the sheet says it was cut.
          //
          // Each gap opens with an EN SPACE (U+2002), not a plain one. CSS
          // white-space collapsing eats U+0020 at a run boundary, which would
          // weld the runs together; U+2002 is not collapsible. These are also
          // the only gaps in this run that are NOT coordinates.
          { text: share, fill: "#ffffff", size: s.labelSize * 0.95, caps: s.caps },
          { text: `\u2002${p.label}`, fill: "#ffffff",
            size: s.labelSize * 0.95, caps: s.caps },
        ]) +
        `</g>`;
    } else if (p.hatch || floats === 1) {
      // ABOVE THE BAR, ON WHICHEVER EDGE OF THE BLOCK HAS THE ROOM.
      //
      // The trailing edge is the natural one — it is where the block ENDS, and
      // for the hatched tail of a two-part bar, which is what this branch was
      // written for, it sets the label just outside the block's own ink. But a
      // block near the LEADING edge has nothing outside it to use: a 5.0% band
      // is 33px wide at x=0, and a 110px run anchored on its trailing edge
      // starts at -77, so the figure and most of the share printed off the paper
      // entirely. That is worse than any clip — a clip at least leaves the
      // number's own start on the page.
      //
      // WHICH EDGE HAS THE ROOM IS THE WHOLE TEST, and it needs no glyph width
      // to answer: compare what lies outside the trailing edge against what
      // lies outside the leading one, and anchor into the larger. The hatched
      // tail keeps the trailing edge it always had (nothing is beyond it), the
      // leading band takes the leading one (everything is beyond it), and both
      // mirror through the frame rather than through a second case here.
      const lead = w - x > x + pwid;
      g += txt(f, lead ? x : x + pwid, top - 7, `${p.display}  ${share.trim()}  ${p.label}`,
        { anchor: lead ? "start" : "end", fill: s.ink,
          size: s.labelSize * 0.95, caps: s.caps });
    }
    // No third branch: a solid block that neither holds its label nor owns the
    // paper above it prints none. See `floats` above for why that is the least
    // lossy of the three things that could happen to it.
    x += pwid;
  }
  g += line(f, 0, top + barH + 7, w, top + barH + 7, `stroke="${s.hair}" stroke-width="0.6"`);
  g += txt(f, 0, top + barH + 19, opt.total, { size: s.labelSize * 0.92 });
  g += txt(f, w, top + barH + 19, opt.footnote, { anchor: "end", size: s.labelSize * 0.92 });
  return svg(w, h, opt.aria, g);
}

/* ------------------------------------------------------------------ */
/* 4. Ranked bars.                                                      */
/* ------------------------------------------------------------------ */

export type RankedBar = { label: string; value: number; display: string; hatch?: boolean };

/**
 * Horizontal ranked bars with the label INSIDE the row rather than in a
 * gutter column, so the label length cannot steal width from the bars.
 *
 * Horizontal rather than vertical because the labels are category NAMES
 * (a cost bucket, a part, a truck) and names read along a line. Vertical bars
 * with names underneath means either rotated type or truncation, and both are
 * ways of hiding what the chart is about.
 *
 * ZERO DRAWS NOTHING, AND THAT IS NOT THE SAME RULE AS THE 0.5 FLOOR.
 * The floor exists for a value that is REAL but tiny: 0.01 SAR against a
 * 25,000.00 maximum is 0.0002px of bar, so without a minimum the row would
 * claim the bucket is empty when it is not. That is a rounding rescue and it
 * stays.
 *
 * An EXACTLY zero value is the opposite problem. The floor gave it a 0.5px
 * rect with a 0.7 stroke around it — a ~1.2px mark, visibly the same object as
 * the small-but-real bars two rows above, sitting beside a number reading
 * "0.00 SAR". Caught on Jun 2026, whose Parts and Outsourced buckets are both
 * genuinely zero while Station fill (210.00) is not: three marks of nearly the
 * same size, one of which meant something different from the other two. The
 * graphic contradicted the figure printed next to it, and the figure was right.
 *
 * So the rect is gated on a positive value. Nothing else about the row changes
 * — the label and the amount still print, and the row still occupies its slot,
 * so the ranking stays legible and the bucket is not hidden. An all-zero period
 * now prints five labelled rows against the baseline with no bars at all, which
 * is a truer picture of a period that cost nothing than five equal hairlines
 * were. `lib/docs/cost.ts` used to cite those hairlines as its reason for not
 * gating the chart; the reason is now the division guard alone.
 */
export function rankedBars(
  s: ChartStyle,
  bars: readonly RankedBar[],
  w: number,
  opt: { aria: string },
): string {
  const rowH = 25, padTop = 4;
  const h = padTop + bars.length * rowH + 4;
  const f = frame(s, w);
  const max = Math.max(...bars.map((b) => b.value), 1);
  const barH = 9;
  let g = `<defs>${hatchDef("rank", s)}</defs>`;

  for (const [i, b] of bars.entries()) {
    const yTop = padTop + i * rowH;
    const bw = Math.max((w * b.value) / max, 0.5);
    g += txt(f, 0, yTop + 8, b.label, { fill: s.ink, size: s.labelSize * 0.98, weight: 500 });
    g += txt(f, w, yTop + 8, b.display, { anchor: "end", fill: s.ink, mono: true, size: s.labelSize });
    if (b.value > 0) {
      g += `<rect x="${num(f.rx(0, bw))}" y="${num(yTop + 13)}" width="${num(bw)}" height="${barH}"` +
        ` fill="${b.hatch ? `url(#${hatchId("rank")})` : s.tint}" stroke="${s.ink}" stroke-width="0.7"/>`;
    }
  }
  // One baseline under the whole stack, so the bars are read against a common
  // origin rather than each floating on its own.
  g += line(f, 0, padTop + bars.length * rowH + 1, w, padTop + bars.length * rowH + 1,
    `stroke="${s.ink}" stroke-width="${num(s.axis)}"`);
  return svg(w, h, opt.aria, g);
}

/* ------------------------------------------------------------------ */
/* Legend                                                               */
/* ------------------------------------------------------------------ */

/**
 * The two-series legend, as HTML with SVG swatches.
 *
 * The swatches are SVG because they must draw the REAL dash pattern and the
 * REAL marker. The LABELS are HTML because the browser has to measure them.
 * The previous version laid the whole legend out in SVG and positioned the
 * second item by multiplying the first label's CHARACTER COUNT by a guessed
 * average glyph width. That guess is wrong for Arabic by roughly a third,
 * since Arabic letters join and there are no capitals, so an Arabic legend
 * would have overlapped itself or left a hole. Flex also mirrors for free.
 *
 * `w` is the AUTHORED width of the chart this legend labels - the same number
 * passed to trendChart - and it is load-bearing, not decoration.
 *
 * A chart is emitted as <svg viewBox="0 0 w H" width="100%" height="H">. In
 * print the column is NOT w: Chromium lays the page out in units of ~0.937 CSS
 * px, so a 174mm column measures 572 of them while the charts are authored at
 * 527. The height attribute is fixed, so preserveAspectRatio's default `meet`
 * cannot scale up to fill; it keeps scale 1 and CENTRES, parking the chart
 * (572-527)/2 = 22.5 units in from the column edge. Read straight out of the
 * PDF's own content stream: clip box 572 wide, group transform translated
 * 22.499.
 *
 * The legend is HTML, so it does not letterbox - it sits flush - and it ended
 * up ~21px to the LEFT of the chart it belongs to. Constraining it to the same
 * authored width and letting auto margins centre it reproduces the chart's
 * offset by the SAME arithmetic on the SAME box, rather than by hard-coding
 * 22.5, which would be silently wrong on any other paper size or margin. When
 * the charts are eventually made to fill their column, this follows on its own.
 *
 * margin-inline (not margin-left/right) so it is direction-agnostic; centring
 * is symmetric anyway, but the logical property keeps the RTL rule honest.
 */
export function trendLegend(
  s: ChartStyle,
  primaryLabel: string,
  secondaryLabel: string,
  w: number,
): string {
  // Swatch geometry matches the approved render exactly: a 22-long rule in a
  // 16-tall band. The band is taller than the rule needs because that height is
  // what sets the gap down to the note beneath - shrink it and the legend
  // drifts into the footnote.
  const wSwatch = 22, hSwatch = 16, mid = hSwatch / 2;
  const solid =
    `<svg width="${wSwatch}" height="${hSwatch}" viewBox="0 0 ${wSwatch} ${hSwatch}" aria-hidden="true">` +
    `<line x1="0" y1="${mid}" x2="${wSwatch}" y2="${mid}" stroke="${s.ink}"` +
    ` stroke-width="${num(s.stroke * 1.25)}" stroke-linecap="round"/>` +
    `<circle cx="${wSwatch / 2}" cy="${mid}" r="${num(s.stroke * 1.55)}" fill="${s.ink}"/></svg>`;
  const r = s.stroke * 2.1;
  const dashed =
    `<svg width="${wSwatch}" height="${hSwatch}" viewBox="0 0 ${wSwatch} ${hSwatch}" aria-hidden="true">` +
    `<line x1="0" y1="${mid}" x2="${wSwatch}" y2="${mid}" stroke="${s.mid}"` +
    ` stroke-width="${num(s.stroke)}" stroke-dasharray="${num(s.stroke * 2.6)} ${num(s.stroke * 1.9)}"` +
    ` stroke-linecap="round"/>` +
    `<rect x="${num(wSwatch / 2 - r)}" y="${num(mid - r)}" width="${num(r * 2)}" height="${num(r * 2)}"` +
    ` fill="#ffffff" stroke="${s.mid}" stroke-width="${num(s.stroke * 0.85)}"/></svg>`;
  return (
    `<div class="legend" style="max-width:${num(w)}px">` +
    `<span>${solid}<span class="k k1">${esc(primaryLabel)}</span></span>` +
    `<span>${dashed}<span class="k k2">${esc(secondaryLabel)}</span></span>` +
    `</div>`
  );
}
