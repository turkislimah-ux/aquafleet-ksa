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

/** A straight line in chart coordinates, mirrored as a pair of points. */
function line(f: Frame, x1: number, y1: number, x2: number, y2: number, attrs: string): string {
  return `<line x1="${num(f.x(x1))}" y1="${num(y1)}" x2="${num(f.x(x2))}" y2="${num(y2)}" ${attrs}/>`;
}

/** Nice round axis maximum and a tick step that lands on it. */
function niceScale(max: number, targetTicks: number): { max: number; step: number } {
  const rough = max / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { max: Math.ceil(max / step) * step, step };
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
  const sec = niceScale(Math.max(...data.map((d) => d.secondary)), 4);

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
    g += txt(f, L - 8, yPri(v) + s.labelSize * 0.35, (v / 1000).toFixed(0) + "k",
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
  const last = data.length - 1;
  g += txt(f, x(last) - 10, yPri(data[last].primary) - 9, opt.primaryLabel,
    { anchor: "end", fill: s.ink, weight: 600, size: s.labelSize * 0.95 });
  g += txt(f, x(last) - 10, ySec(data[last].secondary) + 15, opt.secondaryLabel,
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
  const sc = niceScale(Math.max(...data), 3);
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

/**
 * A proportional bar, deliberately NOT a donut.
 *
 * A donut of two slices spends most of its area on a hole, forces a leader line
 * to reach each label, and asks the reader to judge an ANGLE when the question
 * is a RATIO. A single bar answers it by length, labels in place, and costs a
 * fifth of the height.
 *
 * Works for any number of parts, but the labelling only reads for two or three:
 * beyond that the thin blocks have no room for a knocked-out figure and it
 * becomes a ranked table wearing a chart's clothes.
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
  let x = 0;
  for (const p of parts) {
    const pwid = (w * p.value) / total;
    const pct = (p.value / total) * 100;
    g += `<rect x="${num(f.rx(x, pwid))}" y="${num(top)}" width="${num(pwid)}" height="${barH}"` +
      ` fill="${p.hatch ? `url(#${hatchId("split")})` : s.ink}" stroke="${s.ink}" stroke-width="0.8"/>`;
    // Knock the label out of the solid block; set it BENEATH the hatched one,
    // where reversed type would break up against the 45 degree strokes.
    if (!p.hatch && pwid > 74) {
      g += txt(f, x + 9, top + barH / 2 + s.labelSize * 0.36, p.display,
        { fill: "#ffffff", weight: 700, size: s.labelSize * 1.25, mono: true });
      g += txt(f, x + 9 + 30, top + barH / 2 + s.labelSize * 0.36,
        `${p.label}  ${pct.toFixed(1)}%`,
        { fill: "#ffffff", size: s.labelSize * 0.95, caps: s.caps });
    } else {
      g += txt(f, x + pwid, top - 7, `${p.display}  ${p.label}  ${pct.toFixed(1)}%`,
        { anchor: "end", fill: s.ink, size: s.labelSize * 0.95, caps: s.caps });
    }
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
    g += `<rect x="${num(f.rx(0, bw))}" y="${num(yTop + 13)}" width="${num(bw)}" height="${barH}"` +
      ` fill="${b.hatch ? `url(#${hatchId("rank")})` : s.tint}" stroke="${s.ink}" stroke-width="0.7"/>`;
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
