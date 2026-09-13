// THE GEOMETRY AND THE INK THE FOUR STATEMENT SHEETS SHARE.
//
// Pure LOOK, which is why it sits in lib/docs/ and not beside a view-model:
// there is not one word in this file, and nothing here can change what a sheet
// SAYS. Charts are SVG, and an SVG has no logical properties and no CSS cascade
// reaching into it, so the two things the shell gives every other block for free
// — its measure and its direction — have to be handed to a chart by hand. That
// is all this file is.
//
// TWO MEASURES, AND WHICH ONE A SHEET USES IS DECIDED BY ITS LAYOUT.
// `section({layout:"top"})` stacks its head above its content, so the content
// spans the whole measure: a chart there is authored at FULL. The default gutter
// layout puts the head in its own 104px column with a 26px gap, leaving the
// content 130px narrower — and a chart authored at FULL inside it is scaled down
// by the shell, which shrinks its type below the 8px register everything else on
// the page is set in. Author at the measure the chart will actually occupy.
//
// lib/docs/breakdown.ts CARRIES ITS OWN COPY of both the register and the
// gutter measure, with identical values. Known, and deliberately left: that
// sheet is signed off and rendering in production, and folding it onto this
// module is a refactor of a verified printable — same bytes if done right, a
// silent redesign if done wrong. It is its own change, not a rider on this one.

import type { ChartStyle } from "../atlas";

/** 174mm content measure at 96dpi. A DESIGN constant, not a measurement of the
 *  paper — changing the @page margins does not change it. */
export const SHEET_W = 657;

/** The same measure minus the hanging gutter (104px) and its gap (26px). What a
 *  chart inside a default-layout section actually gets. */
export const GUTTER_W = SHEET_W - 130;

/**
 * The ATLAS chart register.
 *
 * Ink and greys only, by construction: these sheets are specified to survive a
 * fax, a mono laser and a photocopier, so hierarchy is carried by size, weight
 * and tracking. Byte-for-byte the register lib/docs/breakdown.ts was approved
 * with — a second palette would be a second look.
 *
 * `rtl` is the ONLY field that differs between the two languages.
 */
export const chartStyle = (rtl: boolean): ChartStyle => ({
  ink: "#141414",
  mid: "#6e6e6e",
  hair: "#a8a8a8",
  tint: "#d8d8d8",
  font: "'Helvetica Neue', 'Inter', Helvetica, sans-serif",
  figFont: "'Helvetica Neue', 'Inter', Helvetica, sans-serif",
  labelSize: 8,
  stroke: 1.6,
  axis: 1,
  boxed: false,
  caps: true,
  rtl,
});
