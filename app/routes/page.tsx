"use client";

// Route Optimization — DEFERRED. Renders components/ComingSoon.tsx, nothing else.
//
// What stood here until 2026-09-10, all of it off lib/mock-data.ts:
//   · "Fuel Saved (est)" with a SAR sub-line, and "Cost saved" in SAR — both
//     the same invented chain: totalKm × 0.08 → litres, × 2.18 → riyals,
//     printed through formatSar, the same formatter Finance uses for real money
//   · "Time Saved (est)", totalKm × 0.012
//   · "Avg detour  -7.2%", a hardcoded literal
//   · "Algorithm: nearest-neighbor + 2-opt … refreshed every 15 min"
//   · a SaudiMap plotting invented GPS for 40 trucks, with a Direct/Optimized
//     toggle that switched between two sets of invented waypoints
//   · "Re-cluster trips" and "Run Optimizer" buttons that ran nothing
//
// Turki's ruling (Batch B4): stays in the nav as roadmap, shows the honest
// state. The map returns with real positions or not at all.

import { useApp } from "@/components/AppShell";
import ComingSoon, { type ComingSoonLink } from "@/components/ComingSoon";
import { t } from "@/lib/i18n";
import { MapPin, Route as RouteIcon, FileBarChart } from "lucide-react";

export default function RoutesPage() {
  const { lang } = useApp();

  // Trips first: this page would plan them, and they are real today. Reports
  // second — it already answers the distance question this page estimated.
  const links: ComingSoonLink[] = [
    { href: "/trips", icon: RouteIcon, label: t("nav.trips", lang), note: t("soon.go.trips", lang) },
    { href: "/reports", icon: FileBarChart, label: t("nav.reports", lang), note: t("soon.go.reports", lang) },
  ];

  return (
    <ComingSoon
      icon={MapPin}
      lang={lang}
      title={t("nav.routes", lang)}
      lede={t("soon.routes.lede", lang)}
      body={t("soon.routes.body", lang)}
      planned={[
        t("soon.routes.p1", lang),
        t("soon.routes.p2", lang),
        t("soon.routes.p3", lang),
      ]}
      links={links}
    />
  );
}
