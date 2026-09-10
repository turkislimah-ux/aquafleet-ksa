"use client";

// Predictive AI — DEFERRED. Renders components/ComingSoon.tsx and nothing else.
//
// What stood here until 2026-09-10 was a finished-looking product with not one
// real row behind it, all of it off lib/mock-data.ts:
//   · "Estimated Savings … SAR", from critical×12500 + warning×5500 + info×1200
//   · "Avg Confidence", averaged over invented confidencePct values
//   · Critical / Warning counts off mock alerts
//   · a Model Performance card — precision, recall, F1, mean lead time
//   · "Model v3.2", "18 sensors per truck", "Trained on 18 months of telemetry"
//   · a health-vs-vibration scatter of 40 invented trucks
//   · per-alert cards with Dismiss and Create-WO buttons that did nothing
//
// None of it was labelled as unreal, and the page was one click from the
// sidebar. Turki's ruling (Batch B4): the page stays in the nav as roadmap,
// and shows the honest state.

import { useApp } from "@/components/AppShell";
import ComingSoon, { type ComingSoonLink } from "@/components/ComingSoon";
import { t } from "@/lib/i18n";
import { Brain, Wrench, Truck } from "lucide-react";

export default function PredictivePage() {
  const { lang } = useApp();

  // Maintenance first: an alert this page would raise becomes a work order,
  // and work orders are real today. Fleet second — the truck record is where
  // condition would eventually land.
  const links: ComingSoonLink[] = [
    { href: "/maintenance", icon: Wrench, label: t("nav.maintenance", lang), note: t("soon.go.maintenance", lang) },
    { href: "/fleet", icon: Truck, label: t("nav.fleet", lang), note: t("soon.go.fleet", lang) },
  ];

  return (
    <ComingSoon
      icon={Brain}
      lang={lang}
      title={t("nav.predictive", lang)}
      lede={t("soon.predictive.lede", lang)}
      body={t("soon.predictive.body", lang)}
      planned={[
        t("soon.predictive.p1", lang),
        t("soon.predictive.p2", lang),
        t("soon.predictive.p3", lang),
      ]}
      links={links}
    />
  );
}
