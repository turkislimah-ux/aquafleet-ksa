// BREAKDOWN DOCUMENT RENDERER — the LOOK of the printed project breakdown, and
// only the look.
//
// The other half of lib/docvm/breakdown.ts. That file decides WHAT the sheet
// says; this one decides WHERE it sits. The boundary is the kit's own
// (lib/atlas/blocks.ts):
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// So there is NO string literal in this file that a reader will see, and no
// number is formatted here. The only literals are geometry (two widths and the
// chart heights), the chart register, and one empty label — an empty label is
// not a word, it is the absence of one, and the masthead's phone pair has no
// label by design (the view-model has no key for it).
//
// THIS IS A PORT OF .next-report-concepts/src/atlas-proof.ts, section for
// section, in its order. That file is the approved ATLAS breakdown rebuilt from
// nothing but the kit, diffed against the signed-off rasters; keeping the same
// assembly here is what makes "real data through the kit" a plumbing change
// rather than a redesign. Four of its assembly decisions are not obvious and
// each was a defect before it was a comment — they are restated at their call
// sites below, not collected here, so the next reader meets them where they bite.
//
// ONE ADDITION the proof does not have: sheetFooter(). The proof emitted none,
// because its sample view-model carried no generated-on stamp; the on-screen
// report DOES print one, and the mirror law makes it mandatory here.

import {
  atlasDocShell,
  callout,
  defList,
  dailyChart,
  masthead,
  note,
  pair,
  section,
  sheetFooter,
  splitBar,
  statStrip,
  table,
  trendChart,
  trendLegend,
  windows,
  type ChartStyle,
  type MetaPair,
  type Row,
} from "../atlas";
import type { BreakdownDocVm, DocDriverTable } from "../docvm/breakdown";

/** 174mm content measure at 96dpi, minus the hanging gutter and its gap. The
 *  charts are authored at this width and scaled by the shell, so it is a
 *  DESIGN constant and not a measurement of the paper — changing the @page
 *  margins does not change it. */
const W = 657;
const CHART_W = W - 130;

/** The ATLAS chart register. `rtl` is the ONLY field that differs between the
 *  two languages: an SVG has no logical properties, so the mirroring the shell
 *  gets from `dir` has to be threaded into the charts by hand. */
const style = (rtl: boolean): ChartStyle => ({
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

/** One half of the By-driver pair. The kit supplies the table, the view-model
 *  supplies the rows and the words. `unassigned` is the one thing a driver row
 *  carries that is purely visual: a bucket is not a person, so it is set quiet
 *  rather than named. */
function driverTable(t: DocDriverTable): string {
  const rows: Row[] = t.rows.map((r) => ({
    cells: [{ v: r.name, cls: r.unassigned ? "quiet" : "name" }, r.delivered, r.amount],
  }));
  return table({
    cols: [
      { head: t.cols.driver },
      { head: t.cols.delivered, num: true },
      { head: t.cols.amount, num: true },
    ],
    rows,
    foot: [t.footLabel, t.footDelivered, t.footAmount],
    compact: true,
    // Passed EXPLICITLY: table()'s own default is an English literal, which
    // would print English prose on the Arabic sheet.
    empty: t.empty,
  });
}

export function buildBreakdownHtml(vm: BreakdownDocVm): string {
  const S = style(vm.rtl);
  const m = vm.masthead;

  // The meta block, one array per printed LINE. Every pair is conditional,
  // because real data is allowed to be missing where the proof's sample never
  // was: a project with no contact, no phone, no payment mode, or no commission
  // terms in force. An absent fact drops its pair rather than printing a label
  // with nothing after it.
  const contactLine: MetaPair[] = [];
  if (m.contact) contactLine.push({ label: m.contactLabel, value: m.contact });
  // No label on the phone: the view-model has no key for one, and the renderer
  // does not get to invent wording to fill a gap.
  if (m.phone) contactLine.push({ label: "", value: m.phone, num: true });

  const termsLine: MetaPair[] = [];
  if (m.terms) termsLine.push({ label: m.termsLabel, value: m.terms });
  termsLine.push({ label: m.issuedLabel, value: m.issued, num: true });

  const meta: MetaPair[][] = [
    ...(contactLine.length ? [contactLine] : []),
    [
      { label: m.rateLabel, value: m.rate, num: true, tail: m.ratePer },
      {
        label: m.commissionLabel,
        value: m.commission,
        num: true,
        // Leading punctuation lives in the tail string itself, and the kit
        // joins it without a space when it starts with a comma — the Arabic
        // comma is a different CHARACTER, so that decision cannot be CSS's.
        ...(m.commissionTail ? { tail: m.commissionTail } : {}),
      },
    ],
    // A pending terms change is a whole sentence, so it takes its own line
    // rather than crowding a third pair onto the one above it.
    ...(m.changes ? [[{ label: "", value: m.changes }]] : []),
    termsLine,
  ];

  const body = [
    masthead({
      eyebrow: m.eyebrow,
      eyebrowEnd: { label: m.referenceLabel, value: m.reference, num: true },
      title: m.title,
      subtitleLead: m.customer,
      subtitle: m.month,
      meta,
      figure: { caption: m.figureCaption, value: m.figure, unit: m.figureUnit },
    }),

    section({
      head: vm.financial.head,
      sub: vm.financial.sub,
      body: statStrip(vm.financial.stats) + note(vm.financial.note),
    }),

    section({
      head: vm.payments.head,
      sub: vm.payments.sub,
      body: table({
        cols: [
          { head: vm.payments.cols.date, gap: true, iso: true },
          { head: vm.payments.cols.invoice, gap: true, iso: true },
          { head: vm.payments.cols.method, gap: true },
          { head: vm.payments.cols.reference, gap: true, iso: true },
          { head: vm.payments.cols.amount, num: true },
        ],
        rows: vm.payments.rows.map((p) => ({
          cells: [p.date, { v: p.invoice, cls: "name" }, p.method, p.reference, p.amount],
        })),
        // The label spans the four descriptive columns so the total lands under
        // the figures it totals. table() walks the colSpan to pick each foot
        // cell's column spec; dropping the span puts the total 53px out of line.
        foot: [{ v: vm.payments.footLabel, colSpan: 4 }, vm.payments.footTotal],
        empty: vm.payments.empty,
      }),
    }),

    section({
      head: vm.payable.head,
      sub: vm.payable.sub,
      body: callout({ value: vm.payable.value, unit: vm.payable.unit, note: vm.payable.note }),
    }),

    section({
      head: vm.trend.head,
      sub: vm.trend.sub,
      bodyClass: "chart",
      body:
        trendChart(S, vm.trend.points, CHART_W, 212, {
          primaryLabel: vm.trend.seriesRevenue,
          secondaryLabel: vm.trend.seriesTrips,
          aria: vm.trend.aria,
        }) +
        // NO wrapper: trendLegend emits its own .legend. Nesting one stacks two
        // margin-tops and two flex contexts. CHART_W is the same number the
        // chart above was authored at — that is what letterboxes the two.
        trendLegend(S, vm.trend.seriesRevenue, vm.trend.seriesTrips, CHART_W) +
        note(vm.trend.note),
    }),

    section({
      head: vm.operational.head,
      sub: vm.operational.sub,
      body:
        statStrip(vm.operational.stats) +
        // hasBar is not a tidiness check: splitBar divides by the sum of its
        // parts, so a month with nothing scheduled is a division by zero, not an
        // empty chart. The view-model carries the sentence to print instead —
        // the same one the screen prints in place of its donut.
        (vm.operational.hasBar
          ? `<div class="chart" style="margin-top:22px">` +
            splitBar(S, vm.operational.parts, CHART_W, 74, {
              total: vm.operational.barTotal,
              footnote: vm.operational.barFootnote,
              aria: vm.operational.barAria,
            }) +
            `</div>`
          : note(vm.operational.barEmpty)),
    }),

    section({
      head: vm.deliveries.head,
      sub: vm.deliveries.sub,
      body: windows(vm.deliveries.windows) + note(vm.deliveries.note),
    }),

    section({
      head: vm.daily.head,
      sub: vm.daily.sub,
      bodyClass: "chart",
      body: dailyChart(S, vm.daily.counts, CHART_W, 150, vm.daily.aria),
    }),

    section({
      head: vm.sources.head,
      sub: vm.sources.sub,
      body: defList(vm.sources.items),
    }),

    section({
      head: vm.byDriver.head,
      sub: vm.byDriver.sub,
      // NO bodyClass here: pair() emits its own .pair grid. Setting one as well
      // nests a 2-column grid inside one cell of another and the right-hand
      // table collapses to half measure.
      body: pair(
        { label: vm.byDriver.commission.label, body: driverTable(vm.byDriver.commission) },
        { label: vm.byDriver.revenue.label, body: driverTable(vm.byDriver.revenue) },
      ),
    }),

    sheetFooter(vm.footer),
  ].join("\n");

  return atlasDocShell({
    lang: vm.lang,
    dir: vm.rtl ? "rtl" : "ltr",
    title: vm.docTitle,
    body,
  });
}
