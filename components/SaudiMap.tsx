"use client";

import { t, type Lang } from "@/lib/i18n";

/**
 * Lightweight, dependency-free SVG map of Saudi Arabia.
 * Coordinates are projected with a simple linear transform inside the rough KSA bounding box:
 *   lat: 16..33  -> y: 100..0   (inverted)
 *   lng: 34..56  -> x: 0..100
 */

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  color?: string;
  size?: number;
};

export type MapRoute = {
  id: string;
  points: { lat: number; lng: number }[];
  color?: string;
  dashed?: boolean;
};

const LAT_MIN = 16, LAT_MAX = 33;
const LNG_MIN = 34, LNG_MAX = 56;

function project(lat: number, lng: number) {
  const x = ((lng - LNG_MIN) / (LNG_MAX - LNG_MIN)) * 100;
  const y = (1 - (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)) * 100;
  return { x, y };
}

// Hand-traced approximate KSA outline (kept simple so it draws cleanly at any size).
const KSA_PATH = "M 16 24 L 22 18 L 30 12 L 38 8 L 46 8 L 54 12 L 62 18 L 70 22 L 76 24 L 82 30 L 88 36 L 90 42 L 88 50 L 84 56 L 80 60 L 78 64 L 74 70 L 68 76 L 60 80 L 52 84 L 44 86 L 36 84 L 30 80 L 24 74 L 22 66 L 18 58 L 14 50 L 12 42 L 12 34 Z";

const CITIES = [
  { name: "Riyadh", lat: 24.7136, lng: 46.6753 },
  { name: "Jeddah", lat: 21.4858, lng: 39.1925 },
  { name: "Makkah", lat: 21.3891, lng: 39.8579 },
  { name: "Madinah", lat: 24.5247, lng: 39.5692 },
  { name: "Dammam", lat: 26.4207, lng: 50.0888 },
  { name: "Tabuk", lat: 28.3835, lng: 36.5662 },
  { name: "Abha", lat: 18.2164, lng: 42.5053 },
  { name: "Hail", lat: 27.5219, lng: 41.6907 },
  { name: "AlUla", lat: 26.6082, lng: 37.9220 },
  { name: "NEOM", lat: 27.9300, lng: 35.0900 },
];

// `lang` is REQUIRED while every other prop has a default: this component
// renders a caption, so the language is not information it can sensibly guess.
// A default of "en" would make an untranslated map the silent failure mode for
// any future caller that forgets it — which is the exact bug being fixed here.
export default function SaudiMap({
  points = [],
  routes = [],
  height = 480,
  showCities = true,
  className,
  lang,
}: {
  points?: MapPoint[];
  routes?: MapRoute[];
  height?: number;
  showCities?: boolean;
  className?: string;
  lang: Lang;
}) {
  return (
    <div className={`relative w-full rounded-xl overflow-hidden border ${className ?? ""}`}
      style={{ height, borderColor: "rgb(var(--border))", background: "linear-gradient(180deg,#f0f7ff 0%,#fbf6e8 100%)" }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
        {/* country shape */}
        <path d={KSA_PATH} fill="#e8d6a8" stroke="#a16f33" strokeWidth={0.3} opacity={0.65} />

        {/* graticule */}
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`g-h-${i}`} x1={0} x2={100} y1={(i + 1) * 10} y2={(i + 1) * 10} stroke="#fff" strokeOpacity={0.35} strokeWidth={0.1} />
        ))}
        {Array.from({ length: 9 }, (_, i) => (
          <line key={`g-v-${i}`} y1={0} y2={100} x1={(i + 1) * 10} x2={(i + 1) * 10} stroke="#fff" strokeOpacity={0.35} strokeWidth={0.1} />
        ))}

        {/* routes */}
        {routes.map(r => {
          const path = r.points.map((p, i) => {
            const { x, y } = project(p.lat, p.lng);
            return `${i === 0 ? "M" : "L"} ${x} ${y}`;
          }).join(" ");
          return (
            <g key={r.id}>
              <path d={path} fill="none" stroke={r.color ?? "#0b7eea"} strokeWidth={0.6}
                strokeDasharray={r.dashed ? "1.5 1" : undefined} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        })}

        {/* points */}
        {points.map(p => {
          const { x, y } = project(p.lat, p.lng);
          return (
            <g key={p.id}>
              <circle cx={x} cy={y} r={(p.size ?? 0.8)} fill={p.color ?? "#0b7eea"} stroke="#fff" strokeWidth={0.2}>
                <title>{p.label ?? p.id}</title>
              </circle>
            </g>
          );
        })}

        {/* city labels */}
        {showCities && CITIES.map(c => {
          const { x, y } = project(c.lat, c.lng);
          return (
            <g key={c.name}>
              <circle cx={x} cy={y} r={0.5} fill="#13497d" />
              <text x={x + 1} y={y + 0.5} fontSize={1.8} fill="#13497d" fontWeight={600}>{c.name}</text>
            </g>
          );
        })}
      </svg>
      <div className="absolute bottom-2 end-2 text-[10px] muted bg-white/70 dark:bg-black/40 backdrop-blur px-2 py-0.5 rounded">
        {t("shared.map.approximate", lang)}
      </div>
    </div>
  );
}
