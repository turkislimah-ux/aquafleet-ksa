// OPERATIONS DOCUMENT RENDERER — the LOOK of the printed operations sheet, and
// only the look.
//
// The other half of lib/docvm/operations.ts. That file decides WHAT the sheet
// says; this one decides WHERE it sits:
//
//   DATA, GROUPING and WORDING come from the view-model. The LOOK is this
//   file's, and only the look.
//
// So there is NO string literal here that a reader will see, and no number is
// formatted here. The only literals are geometry.
//
// THE HANGING GUTTER, Turki's split for this sheet. Four named sections run down
// it — delivery, utilisation, period summary, by month — and the two driver
// tables carry one row per driver across a fleet of forty, so the run
// paginates. A stacked head scrolls away with the page it opened; a gutter head
// sits on the same vertical the whole run is built against, which is the rail a
// reader who turns to page two finds the heading on.
//
// THE TWO DRIVER TABLES STAY STACKED, EACH AT FULL MEASURE — not merged into one
// seven-column table, and not paired. Three reasons, in order of weight:
//
//   1. The screen stacks them, so stacked IS the mirror. Merging is a GROUPING
//      change, and this sheet's law forbids those as squarely as wrong numbers.
//   2. Each table carries its OWN note, and those two notes say different
//      things — one about how a completion rate is computed, one about what a
//      workload share measures. A merge strands both.
//   3. A `.pair` half is ~246px. The delivery table is five columns whose first
//      cell is two lines deep; it does not fit, and the utilisation table beside
//      it would be three columns holding two percentages.
//
// The cost sheet's two pairs are the opposite case and stay paired: there the
// SCREEN puts them side by side, so a pair is that sheet's mirror.
//
// THE CHART SITS INSIDE THE BY-MONTH SECTION, above the table it draws. It plots
// that table's first three columns and names no section of its own, so a heading
// over it would be a word on the paper nobody wrote — and inside the gutter grid
// it is authored at GUTTER_W, the measure it will actually occupy.

import {
  atlasDocShell,
  block,
  masthead,
  note,
  section,
  sheetFooter,
  statStrip,
  table,
  trendChart,
  trendLegend,
  type Cell,
} from "../atlas";
import type { OpsDocDriverCell, OpsDocVm } from "../docvm/operations";
import { GUTTER_W, chartStyle } from "./reportSheet";

export function buildOpsHtml(vm: OpsDocVm): string {
  const S = chartStyle(vm.rtl);
  const m = vm.masthead;

  // The leading cell of a driver row, identical in both tables because it is
  // identical on screen. The plate and the multi-truck note ride as the cell's
  // quieter second line — the view-model joined them; this decides only that
  // they are a sub-line rather than a column of their own.
  const driver = (d: OpsDocDriverCell): Cell => ({ v: d.name, cls: "name", sub: d.sub });

  // The driver column is declared `iso`, not `num`: it is set flush to the
  // reading edge beside a name, never ranged right beside the figures. iso()
  // isolates LTR runs ONLY, so an Arabic driver name passes through as plain
  // text while the Latin plate underneath it keeps its direction.
  const driverCol = { head: "", iso: true, gap: true };

  const body = [
    masthead({
      eyebrow: m.eyebrow,
      title: m.title,
      subtitle: m.subtitle,
      meta: m.meta,
      // SPREAD, not passed as undefined. The masthead figure is absent on a
      // period that scheduled nothing, and `Masthead.figure` is optional for
      // exactly that case.
      ...(m.figure ? { figure: m.figure } : {}),
    }),

    block(statStrip(vm.stats)),

    // THE EMPTY CASE DROPS BOTH TABLES AND BOTH THEIR HEADS for one sentence,
    // which is what the screen does. Passing `empty` to table() instead would
    // keep eight ruled column heads and two gutter headings over nothing.
    ...(vm.drivers.has
      ? [
          section({
            head: vm.drivers.delivery.head,
            body:
              table({
                cols: [
                  { ...driverCol, head: vm.drivers.delivery.cols.driver },
                  { head: vm.drivers.delivery.cols.scheduled, num: true },
                  { head: vm.drivers.delivery.cols.delivered, num: true },
                  { head: vm.drivers.delivery.cols.notDelivered, num: true },
                  { head: vm.drivers.delivery.cols.completion, num: true },
                ],
                rows: vm.drivers.delivery.rows.map((r) => ({
                  cells: [
                    driver(r.driver),
                    r.scheduled,
                    r.delivered,
                    r.notDelivered,
                    // The rate carries the weight the screen gives it: it is
                    // the reading of the three counts beside it, not a fourth
                    // count.
                    { v: r.completion, cls: "name" },
                  ],
                })),
                // NOT compact. Every row here is two lines deep, and across a
                // fleet-length run the row rules are what let the eye track a
                // driver from a name to a rate four columns away.
              }) + note(vm.drivers.delivery.note),
          }),

          section({
            head: vm.drivers.utilisation.head,
            body:
              table({
                cols: [
                  { ...driverCol, head: vm.drivers.utilisation.cols.driver },
                  { head: vm.drivers.utilisation.cols.shareScheduled, num: true },
                  { head: vm.drivers.utilisation.cols.shareDelivered, num: true },
                ],
                rows: vm.drivers.utilisation.rows.map((r) => ({
                  cells: [driver(r.driver), r.shareScheduled, r.shareDelivered],
                })),
              }) + note(vm.drivers.utilisation.note),
          }),
        ]
      : [block(note(vm.drivers.empty))]),

    section({
      head: vm.summary.head,
      body: table({
        cols: [{ head: vm.summary.cols.measure }, { head: vm.summary.cols.value, num: true }],
        rows: vm.summary.rows.map((r) => ({
          // `rule-above` + `.name` is the kit's exact equivalent of the screen's
          // ruled, semibold completion row: a rule across the measure and the
          // two cells set in the heavier face. WHICH row gets it is the
          // view-model's `emphasis`; this is only how it is drawn.
          ...(r.emphasis ? { cls: "rule-above" } : {}),
          cells: [
            { v: r.label, ...(r.emphasis ? { cls: "name" } : {}), ...(r.sub ? { sub: r.sub } : {}) },
            r.emphasis ? { v: r.value, cls: "name" } : r.value,
          ],
        })),
        // Eight short two-column rows. At this length the row rules would be the
        // loudest thing in the block; leading separates them.
        compact: true,
      }),
    }),

    ...(vm.byMonth.has
      ? [
          section({
            head: vm.byMonth.head,
            body:
              (vm.byMonth.chart.has
                ? // The wrapper is the CHART's, not the section's: `.chart`
                  // carries break-inside:avoid, and setting it as the section's
                  // bodyClass would weld the table below to the figure above it
                  // on a sheet that paginates. The legend goes INSIDE that same
                  // wrapper but is NOT wrapped again — trendLegend emits its own
                  // .legend, and nesting one stacks two margin-tops and two flex
                  // contexts. GUTTER_W is the width the chart above it was
                  // authored at; that is what letterboxes the two together.
                  `<div class="chart">` +
                  trendChart(S, vm.byMonth.chart.points, GUTTER_W, 212, {
                    primaryLabel: vm.byMonth.chart.primaryLabel,
                    secondaryLabel: vm.byMonth.chart.secondaryLabel,
                    aria: vm.byMonth.chart.aria,
                  }) +
                  trendLegend(
                    S,
                    vm.byMonth.chart.primaryLabel,
                    vm.byMonth.chart.secondaryLabel,
                    GUTTER_W,
                  ) +
                  `</div>`
                : "") +
              table({
                cols: [
                  // YYYY-MM is an identifier, a Latin run inside an Arabic
                  // column, so it is isolated without being ranged right beside
                  // the counts.
                  { head: vm.byMonth.cols.month, iso: true, gap: true },
                  { head: vm.byMonth.cols.trips, num: true },
                  { head: vm.byMonth.cols.delivered, num: true },
                  { head: vm.byMonth.cols.completion, num: true },
                  { head: vm.byMonth.cols.trucks, num: true },
                  { head: vm.byMonth.cols.workOrders, num: true },
                  { head: vm.byMonth.cols.osJobs, num: true },
                  { head: vm.byMonth.cols.permits, num: true },
                ],
                rows: vm.byMonth.rows.map((r) => ({
                  cells: [
                    { v: r.month, cls: "name" },
                    r.trips,
                    r.delivered,
                    r.completion,
                    r.trucks,
                    r.workOrders,
                    r.osJobs,
                    r.permits,
                  ],
                })),
                // Eight columns, so the rules are doing real work here.
              }),
          }),
        ]
      : []),

    // The two closing sentences, headless and at full measure — they qualify the
    // whole sheet rather than any one section, which is where the screen puts
    // them too.
    block(note(vm.notes.counts) + note(vm.notes.absent)),

    sheetFooter(vm.footer),
  ].join("\n");

  return atlasDocShell({
    lang: vm.lang,
    dir: vm.rtl ? "rtl" : "ltr",
    title: vm.docTitle,
    body,
  });
}
