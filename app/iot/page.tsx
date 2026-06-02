"use client";

import { useApp } from "@/components/AppShell";
import { PageHeader, Card, Stat, Section, Btn } from "@/components/ui";
import { trucks } from "@/lib/mock-data";
import { t } from "@/lib/i18n";
import { Activity, Wifi, Thermometer, Droplet, Gauge, Zap, Battery } from "lucide-react";
import Link from "next/link";

export default function IoTPage() {
  const { lang } = useApp();
  const online = trucks.filter(t => t.status !== "out_of_service").length;
  const overheating = trucks.filter(t => t.iot.engineTempC > 95).length;
  const lowPressure = trucks.filter(t => t.iot.oilPressureKpa < 350).length;
  const tireIssues = trucks.filter(t => Math.min(t.iot.tirePressureBarFL, t.iot.tirePressureBarFR, t.iot.tirePressureBarRL, t.iot.tirePressureBarRR) < 7.5).length;
  const lowBattery = trucks.filter(t => t.iot.batteryV < 12.5).length;
  const highVib = trucks.filter(t => t.iot.vibrationRms > 4.5).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.iot", lang)}
        subtitle={lang === "en" ? "Real-time sensor monitoring · 18 sensors per truck · 720 streams" : "مراقبة لحظية · 18 حساس لكل شاحنة · 720 بث"}
        actions={<Btn variant="primary"><Activity className="h-4 w-4" />{lang === "en" ? "Live View" : "مباشر"}</Btn>}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat label={lang === "en" ? "Trucks Online" : "شاحنات متصلة"} value={`${online}/${trucks.length}`} tone="ok" />
        <Stat label={lang === "en" ? "Overheating" : "حرارة عالية"} value={overheating} tone={overheating > 0 ? "bad" : "ok"} />
        <Stat label={lang === "en" ? "Low Oil Pressure" : "ضغط زيت منخفض"} value={lowPressure} tone={lowPressure > 0 ? "warn" : "ok"} />
        <Stat label={lang === "en" ? "Tire Issues" : "مشاكل إطارات"} value={tireIssues} tone={tireIssues > 0 ? "warn" : "ok"} />
        <Stat label={lang === "en" ? "Low Battery" : "بطارية منخفضة"} value={lowBattery} tone={lowBattery > 0 ? "warn" : "ok"} />
        <Stat label={lang === "en" ? "High Vibration" : "اهتزاز عالٍ"} value={highVib} tone={highVib > 0 ? "warn" : "ok"} />
      </div>

      <Section title={lang === "en" ? "Live Sensor Grid" : "شبكة المستشعرات"}
        action={<span className="text-xs muted flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-dot"></span> Streaming</span>}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {trucks.slice(0, 16).map(tr => {
            const tempBad = tr.iot.engineTempC > 95;
            const oilBad = tr.iot.oilPressureKpa < 350;
            const battBad = tr.iot.batteryV < 12.5;
            const vibBad = tr.iot.vibrationRms > 4.5;
            return (
              <Link key={tr.id} href={`/fleet/${tr.id}`}>
                <div className="rounded-xl border p-3 hover:shadow-soft transition cursor-pointer h-full" style={{ borderColor: "rgb(var(--border))" }}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="font-mono text-xs muted">{tr.id}</div>
                      <div className="font-semibold text-sm">{lang === "ar" ? tr.plateAr : tr.plate}</div>
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      <Wifi className={`h-3.5 w-3.5 ${tr.status === "out_of_service" ? "text-rose-500" : "text-emerald-500"}`} />
                      <span className="muted">{tr.iot.speedKph} km/h</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    <Sensor icon={Thermometer} label={`${tr.iot.engineTempC}°C`} bad={tempBad} />
                    <Sensor icon={Gauge} label={`${tr.iot.oilPressureKpa} kPa`} bad={oilBad} />
                    <Sensor icon={Battery} label={`${tr.iot.batteryV}V`} bad={battBad} />
                    <Sensor icon={Zap} label={`${tr.iot.vibrationRms} mm/s`} bad={vibBad} />
                    <Sensor icon={Droplet} label={`${tr.iot.tankLevelPct}% tank`} />
                    <Sensor icon={Droplet} label={`${tr.iot.fuelLevelPct}% fuel`} bad={tr.iot.fuelLevelPct < 25} />
                  </div>
                  <div className="mt-2 text-[10px] muted text-end">{lang === "en" ? "Updated" : "محدث"}: 8s</div>
                </div>
              </Link>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function Sensor({ icon: Icon, label, bad }: { icon: any; label: string; bad?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${bad ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-black/[0.03] dark:bg-white/[0.04]"}`}>
      <Icon className="h-3 w-3 shrink-0" />
      <span className="tabular-nums truncate">{label}</span>
    </div>
  );
}
