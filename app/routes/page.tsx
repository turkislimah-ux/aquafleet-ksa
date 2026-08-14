"use client";

import { useApp } from "@/components/AppShell";
import { PageHeader, Stat, Section, Btn, StatusPill } from "@/components/ui";
import SaudiMap, { type MapPoint, type MapRoute } from "@/components/SaudiMap";
import { trips, trucks } from "@/lib/mock-data";
import { t } from "@/lib/i18n";
import { formatNum, formatSar } from "@/lib/utils";
import { Sparkles, Route as RouteIcon, Fuel, Clock, TrendingDown } from "lucide-react";
import { useMemo, useState } from "react";

export default function RoutesPage() {
  const { lang } = useApp();
  const [optimized, setOptimized] = useState(true);

  // Active + scheduled trips for map
  const active = trips.filter(tr => tr.status === "in_transit" || tr.status === "loading" || tr.status === "scheduled").slice(0, 18);

  const points: MapPoint[] = useMemo(() => {
    const arr: MapPoint[] = [];
    trucks.forEach(tr => {
      if (tr.status === "active" || tr.status === "idle") {
        arr.push({ id: tr.id, lat: tr.iot.gps.lat, lng: tr.iot.gps.lng,
          color: tr.status === "active" ? "#10b981" : "#3b82f6", size: 0.9, label: `${tr.id} · ${tr.plate}` });
      }
    });
    active.forEach(tr => {
      arr.push({ id: `dest-${tr.id}`, lat: tr.destination.lat, lng: tr.destination.lng,
        color: "#ef4444", size: 1.1, label: tr.destination.name });
    });
    return arr;
  }, [active]);

  const routes: MapRoute[] = useMemo(() =>
    active.map(tr => ({
      id: tr.id,
      points: optimized ? tr.routeWaypoints : [tr.routeWaypoints[0], tr.routeWaypoints[tr.routeWaypoints.length - 1]],
      color: optimized ? "#0b7eea" : "#94a3b8",
      dashed: !optimized,
    })),
    [active, optimized]
  );

  // Optimization KPIs (delta when optimized)
  const totalKm = active.reduce((s, t) => s + t.distanceKm, 0);
  const fuelSavedL = +(totalKm * 0.08).toFixed(0);
  const timeSavedHrs = +(totalKm * 0.012).toFixed(1);
  const costSaved = +(fuelSavedL * 2.18).toFixed(0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.routes", lang)}
        subtitle={lang === "en" ? "AI-driven route planning across 4 depots" : "تخطيط مسارات ذكي عبر 4 مستودعات"}
        actions={
          <>
            <Btn variant="outline">{lang === "en" ? "Re-cluster trips" : "إعادة تجميع الرحلات"}</Btn>
            <Btn variant="primary"><Sparkles className="h-4 w-4" />{lang === "en" ? "Run Optimizer" : "تشغيل المحسّن"}</Btn>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={lang === "en" ? "Active Routes" : "مسارات نشطة"} value={active.length} tone="info" />
        <Stat label={lang === "en" ? "Total Distance" : "إجمالي المسافة"} value={`${formatNum(totalKm)} km`} />
        <Stat label={lang === "en" ? "Fuel Saved (est)" : "وقود موفر (تقدير)"} value={`${fuelSavedL} L`} sub={`= ${formatSar(costSaved)}`} tone="ok" />
        <Stat label={lang === "en" ? "Time Saved (est)" : "وقت موفر (تقدير)"} value={`${timeSavedHrs} h`} tone="ok" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-semibold">{lang === "en" ? "Live Fleet & Routes" : "الأسطول والمسارات"}</h3>
            <div className="inline-flex rounded-lg border overflow-hidden text-xs" style={{ borderColor: "rgb(var(--border))" }}>
              <button onClick={() => setOptimized(false)}
                className={`px-3 py-1.5 ${!optimized ? "bg-brand-600 text-white" : "muted"}`}>
                {lang === "en" ? "Direct" : "مباشر"}
              </button>
              <button onClick={() => setOptimized(true)}
                className={`px-3 py-1.5 ${optimized ? "bg-brand-600 text-white" : "muted"}`}>
                {lang === "en" ? "Optimized" : "محسّن"}
              </button>
            </div>
          </div>
          <SaudiMap points={points} routes={routes} height={520} />
          <div className="flex items-center gap-4 mt-3 text-xs muted flex-wrap">
            <Legend color="#10b981" label={lang === "en" ? "Active truck" : "شاحنة نشطة"} />
            <Legend color="#3b82f6" label={lang === "en" ? "Idle truck" : "شاحنة متوقفة"} />
            <Legend color="#ef4444" label={lang === "en" ? "Destination" : "الوجهة"} />
            <Legend color="#0b7eea" label={lang === "en" ? "Optimized route" : "مسار محسّن"} />
          </div>
        </div>

        <div className="space-y-4">
          <Section title={lang === "en" ? "Optimization Result" : "نتيجة التحسين"}>
            <div className="space-y-3">
              <Row icon={Fuel} label={lang === "en" ? "Fuel reduction" : "تقليل الوقود"} value={`-${fuelSavedL} L`} tone="ok" />
              <Row icon={Clock} label={lang === "en" ? "Time reduction" : "تقليل الوقت"} value={`-${timeSavedHrs} h`} tone="ok" />
              <Row icon={TrendingDown} label={lang === "en" ? "Cost saved" : "تكلفة موفرة"} value={`-${formatSar(costSaved)}`} tone="ok" />
              <Row icon={RouteIcon} label={lang === "en" ? "Avg detour" : "متوسط الانحراف"} value="-7.2%" tone="ok" />
            </div>
            <div className="mt-3 text-[11px] muted">
              {lang === "en"
                ? "Algorithm: nearest-neighbor + 2-opt with traffic & desert-corridor weights, refreshed every 15 min."
                : "الخوارزمية: الجار الأقرب + 2-opt مع أوزان للحركة وممرات الصحراء، تحديث كل 15 دقيقة."}
            </div>
          </Section>

          <Section title={lang === "en" ? "Active Trips" : "الرحلات النشطة"}>
            <div className="space-y-2">
              {active.slice(0, 8).map(tr => (
                <div key={tr.id} className="flex items-center gap-2 text-sm">
                  <StatusPill status={tr.status} label={t(`status.${tr.status}`, lang)} />
                  <span className="font-mono text-xs">{tr.truckId}</span>
                  <span className="muted text-xs truncate flex-1">{lang === "ar" ? tr.destination.nameAr : tr.destination.name}</span>
                  <span className="tabular-nums text-xs">{tr.distanceKm} km</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}</span>;
}

function Row({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const c = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "bad" ? "text-rose-600" : "";
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4 muted" />{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${c}`}>{value}</span>
    </div>
  );
}
