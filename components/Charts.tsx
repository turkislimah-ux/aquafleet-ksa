"use client";

// Chart.js wrappers ported 1:1 from the demo (preview/pages-1.js drawAreaChart /
// drawPie / drawDualBar). The demo loads chart.js@4.4.4 via CDN; here we import
// it as a dep and replicate the exact same Chart() configs for visual parity.
// recharts is deliberately NOT used (would not match the demo pixel-for-pixel).

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
