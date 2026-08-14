"use client";

// Chart.js wrappers for the Dashboard. PieChart is still a 1:1 port of the
// demo's drawPie (preview/pages-1.js); ComboChart has no demo equivalent and
// was written for the daily charts. The demo loads chart.js@4.4.4 via CDN;
// here it is a dep, with the same Chart() configs for visual parity.
//
// THIS MODULE IS DASHBOARD-ONLY. Reports and Trips draw with recharts instead
// (app/reports/OverviewTab.tsx, app/trips/BreakdownReport.tsx) — same component
// NAMES, different library, so a grep for "BarChart" finds recharts hits that
// have nothing to do with this file.
//
// THREE PORTS WERE REMOVED when their last callers went, rather than left
// unreachable (CLAUDE.md's no-dead-code rule): AreaChart (drawAreaChart) with
// the Operating margin chart, BarChart (drawBars) with Receivables aging, and
// DualBarChart (drawDualBar) when ComboChart replaced the original
// Revenue-vs-cost pairing. preview/'s own drawAreaChart / drawBars /
// drawDualBar remain the spec if any of them is ever rebuilt.

import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

type PieItem = { label: string; value: number; color: string };

// Mirrors drawPie(): doughnut, cutout 60%, white 2px borders, no legend.
export function PieChart({ items, className }: { items: PieItem[]; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<"doughnut", number[], string> | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    chartRef.current?.destroy();
    chartRef.current = new Chart(el, {
      type: "doughnut",
      data: {
        labels: items.map((i) => i.label),
        datasets: [
          {
            data: items.map((i) => i.value),
            backgroundColor: items.map((i) => i.color),
            borderWidth: 2,
            borderColor: "#fff",
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        cutout: "60%",
        plugins: { legend: { display: false } },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [items]);

  return (
    <div className={className}>
      <canvas ref={canvasRef} />
    </div>
  );
}

// Bars + a line over the same categories. Not a demo port — the demo has no
// combo — but it keeps the demo's visual language (4px radius, slate grid,
// top-end legend, 11px slate ticks).
//
// WHY A COMBO AND NOT A SECOND BAR: both users of this chart plot ~31 DAILY
// points. Two grouped bar series over a month is 62 bars in a card and reads
// as noise; a bar for the volume measure and a line for the one that should
// be read as a trend separates them at a glance.
//
// The line can ride its own right-hand axis (`lineAxis: "y1"`) for the case
// where the two series are in different units — plotting m3 and a trip count
// on one scale would make the smaller series look flat and lie about it.
export function ComboChart({
  labels,
  bar,
  line,
  extraLine,
  lineAxis = "y",
  y1Label,
  className,
}: {
  labels: string[];
  /**
   * Optional. Omitted by the revenue chart, which became two lines when the
   * invoiced series was dropped — there is no volume measure left to sit
   * behind them, and an empty bar dataset would put a dead entry in the legend.
   */
  bar?: { label: string; data: number[]; color?: string };
  line: { label: string; data: number[]; color?: string };
  /**
   * An optional SECOND line on the left axis. Added for the revenue chart,
   * which plots two differently-timed revenue measures against one cost
   * series — the pair has to be comparable, so both ride the same scale.
   * Omitted everywhere else, so existing callers are unchanged.
   */
  extraLine?: { label: string; data: number[]; color?: string };
  lineAxis?: "y" | "y1";
  y1Label?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<"bar" | "line", number[], string> | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    chartRef.current?.destroy();
    chartRef.current = new Chart(el, {
      type: "bar",
      data: {
        labels,
        datasets: [
          ...(bar
            ? [{
                type: "bar" as const,
                label: bar.label,
                data: bar.data,
                backgroundColor: bar.color ?? "#0b7eea",
                borderRadius: 4,
                maxBarThickness: 22,
                order: 2,
                yAxisID: "y" as const,
              }]
            : []),
          {
            type: "line" as const,
            label: line.label,
            data: line.data,
            borderColor: line.color ?? "#f59e0b",
            backgroundColor: line.color ?? "#f59e0b",
            borderWidth: 2,
            // STRAIGHT SEGMENTS, NOT A SPLINE. The other charts here use
            // tension .35 because they plot smooth monthly trends. A daily
            // series is discrete measurements, and a curve through them
            // overshoots between points — drawing cost on a day that never
            // had that cost. Days 27 and 29 of a live month (24 SAR then
            // 4,874) make a spline invent a hump across day 28.
            tension: 0,
            // Each day is a real reading, so mark it. Without this a series
            // that sits near zero for most of a month renders as an axis line
            // and reads as "no data" instead of "small, measured values".
            pointRadius: 2,
            pointHoverRadius: 4,
            fill: false,
            order: 1,
            yAxisID: lineAxis,
          },
          ...(extraLine
            ? [{
                type: "line" as const,
                label: extraLine.label,
                data: extraLine.data,
                borderColor: extraLine.color ?? "#10b981",
                backgroundColor: extraLine.color ?? "#10b981",
                borderWidth: 2,
                tension: 0,
                pointRadius: 0,
                pointHoverRadius: 4,
                fill: false,
                order: 0,
                yAxisID: "y" as const,
              }]
            : []),
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", align: "end", labels: { font: { size: 11 }, boxWidth: 12 } },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10 }, color: "#64748b", maxRotation: 0, autoSkipPadding: 12 },
          },
          y: {
            position: "left",
            grid: { color: "#eef2f7" },
            ticks: { font: { size: 11 }, color: "#64748b" },
            beginAtZero: true,
          },
          // Only built when the line actually needs its own scale, so a
          // single-unit chart does not render an empty second axis.
          ...(lineAxis === "y1"
            ? {
                y1: {
                  position: "right" as const,
                  grid: { drawOnChartArea: false },
                  ticks: { font: { size: 11 }, color: "#64748b", precision: 0 },
                  beginAtZero: true,
                  title: y1Label
                    ? { display: true, text: y1Label, font: { size: 10 }, color: "#64748b" }
                    : undefined,
                },
              }
            : {}),
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [labels, bar, line, extraLine, lineAxis, y1Label]);

  // Chart.js paints the legend ONTO the canvas, so the series names exist
  // only as pixels — a screen reader gets nothing, and neither does any test
  // asserting the labelling rules these two charts are bound by. The text
  // alternative below is the only place those names exist as text.
  return (
    <div className={className}>
      <canvas ref={canvasRef} role="img"
        aria-label={[bar?.label, line.label, extraLine?.label].filter(Boolean).join(" — ")} />
    </div>
  );
}
