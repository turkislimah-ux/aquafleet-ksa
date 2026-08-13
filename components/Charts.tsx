"use client";

// Chart.js wrappers ported 1:1 from the demo (preview/pages-1.js drawAreaChart /
// drawPie / drawDualBar). The demo loads chart.js@4.4.4 via CDN; here we import
// it as a dep and replicate the exact same Chart() configs for visual parity.
// recharts is deliberately NOT used (would not match the demo pixel-for-pixel).

import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import type { ScriptableContext } from "chart.js";

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

// Mirrors drawAreaChart(): line, filled, tension .35, no points, 2px stroke,
// vertical gradient fill (color70 → color00), no legend, slate gridlines.
export function AreaChart({
  labels,
  data,
  color = "#0b7eea",
  className,
}: {
  labels: string[];
  data: number[];
  color?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<"line", number[], string> | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    chartRef.current?.destroy();
    chartRef.current = new Chart(el, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            data,
            borderColor: color,
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 2,
            backgroundColor: (ctx: ScriptableContext<"line">) => {
              const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 280);
              g.addColorStop(0, color + "70");
              g.addColorStop(1, color + "00");
              return g;
            },
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: "#eef2f7" }, ticks: { font: { size: 11 }, color: "#64748b" } },
          y: { grid: { color: "#eef2f7" }, ticks: { font: { size: 11 }, color: "#64748b" } },
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [labels, data, color]);

  return (
    <div className={className}>
      <canvas ref={canvasRef} />
    </div>
  );
}

// Mirrors drawBars(): single bar dataset, per-bar colors, 4px radius, 36px max
// thickness, no legend, no x gridlines, slate y gridlines, beginAtZero. Used by
// the AI summary widgets (DASH._drawAll → drawBars branch).
export function BarChart({
  labels,
  data,
  colors,
  className,
  ariaLabel,
}: {
  labels: string[];
  data: number[];
  colors?: string[];
  className?: string;
  /**
   * Text alternative for the canvas. Optional and unset by default, so every
   * existing caller is unchanged — but a bar chart's category names are
   * painted pixels, invisible to a screen reader and to any test, so pass one
   * wherever the labels carry meaning on their own.
   */
  ariaLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<"bar", number[], string> | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    chartRef.current?.destroy();
    chartRef.current = new Chart(el, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { data, backgroundColor: colors ?? "#0b7eea", borderRadius: 4, maxBarThickness: 36 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 }, color: "#64748b" } },
          y: { grid: { color: "#eef2f7" }, ticks: { font: { size: 11 }, color: "#64748b" }, beginAtZero: true },
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [labels, data, colors]);

  return (
    <div className={className}>
      <canvas ref={canvasRef} {...(ariaLabel ? { role: "img", "aria-label": ariaLabel } : {})} />
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

// Mirrors drawDualBar(): two bar datasets, 4px radius, 14px max thickness,
// top-end legend, no x gridlines, slate y gridlines.
export function DualBarChart({
  labels,
  d1,
  d2,
  c1 = "#0b7eea",
  c2 = "#f59e0b",
  l1,
  l2,
  className,
}: {
  labels: string[];
  d1: number[];
  d2: number[];
  c1?: string;
  c2?: string;
  l1: string;
  l2: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<"bar", number[], string> | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    chartRef.current?.destroy();
    chartRef.current = new Chart(el, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: l1, data: d1, backgroundColor: c1, borderRadius: 4, maxBarThickness: 14 },
          { label: l2, data: d2, backgroundColor: c2, borderRadius: 4, maxBarThickness: 14 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: "top", align: "end", labels: { font: { size: 11 }, boxWidth: 12 } } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 }, color: "#64748b" } },
          y: { grid: { color: "#eef2f7" }, ticks: { font: { size: 11 }, color: "#64748b" } },
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [labels, d1, d2, c1, c2, l1, l2]);

  return (
    <div className={className}>
      <canvas ref={canvasRef} />
    </div>
  );
}
