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
