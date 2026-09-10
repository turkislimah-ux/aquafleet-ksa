"use client";

// IoT Monitoring — DEFERRED. Renders components/ComingSoon.tsx, nothing else.
//
// What stood here until 2026-09-10, all of it off lib/mock-data.ts:
//   · six telemetry KPIs — Trucks Online, Overheating, Low Oil Pressure, Tire
//     Issues, Low Battery, High Vibration — each counted off invented readings
//     against a real-looking threshold
//   · "Real-time sensor monitoring · 18 sensors per truck · 720 streams"
//   · a pulsing green dot captioned "streaming"
//   · a 16-card sensor grid: engine temp, oil pressure, battery volts,
//     vibration, tank and fuel level, per truck, tinted red past a threshold
//   · "Updated: 8s" — a hardcoded string, on every card, forever
//
// No SAR figure ever appeared here, which is exactly why it was the easiest of
// the three to overlook: a page can be entirely fabricated without printing a
// single riyal. Turki's ruling (Batch B4): stays in the nav as roadmap, shows
// the honest state.

import { useApp } from "@/components/AppShell";
import ComingSoon, { type ComingSoonLink } from "@/components/ComingSoon";
import { t } from "@/lib/i18n";
import { Activity, Truck, Wrench } from "lucide-react";

export default function IoTPage() {
  const { lang } = useApp();

  // Fleet first: a reading belongs to a truck, and the truck record is real
  // today — including the honest-empty Engine Component Health card that is
  // waiting on this exact feed. Maintenance second.
  const links: ComingSoonLink[] = [
    { href: "/fleet", icon: Truck, label: t("nav.fleet", lang), note: t("soon.go.fleet", lang) },
    { href: "/maintenance", icon: Wrench, label: t("nav.maintenance", lang), note: t("soon.go.maintenance", lang) },
  ];

  return (
    <ComingSoon
      icon={Activity}
      lang={lang}
      title={t("nav.iot", lang)}
      lede={t("soon.iot.lede", lang)}
      body={t("soon.iot.body", lang)}
      planned={[
        t("soon.iot.p1", lang),
        t("soon.iot.p2", lang),
        t("soon.iot.p3", lang),
      ]}
      links={links}
    />
  );
}
