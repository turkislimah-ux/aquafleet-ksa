"use client";

import { useApp } from "@/components/AppShell";
import { PageHeader, Card, Stat, StatusPill, Section, Btn, Bar } from "@/components/ui";
import { trucks, findDriver, workOrders, predictiveAlerts, trips } from "@/lib/mock-data";
import { t } from "@/lib/i18n";
import { formatNum } from "@/lib/utils";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Gauge, Thermometer, Droplet, Battery, Wind, Zap, MapPin, AlertTriangle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const tempHistory = Array.from({ length: 24 }, (_, i) => ({
  h: `${String(i).padStart(2, "0")}:00`,
  temp: 84 + Math.sin(i / 3) * 4 + (i > 14 ? 4 : 0) + (i % 5),
  oil: 380 + Math.cos(i / 4) * 30 - (i > 18 ? 25 : 0),
  vib: 2.5 + Math.abs(Math.sin(i / 2)) * 1.2,
}));

export default function TruckDetailPage() {
  const { lang } = useApp();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const truck = trucks.find(t => t.id === id);
  if (!truck) return <div>Not found</div>;
  const driver = truck.driverId ? findDriver(truck.driverId) : null;
  const truckWO = workOrders.filter(w => w.truckId === truck.id);
  const truckAlerts = predictiveAlerts.filter(a => a.truckId === truck.id);
  const truckTrips = trips.filter(tr => tr.truckId === truck.id).slice(0, 5);

  const kmToService = truck.nextServiceKm - truck.odometerKm;

  return (
    <div className="space-y-5">
      <Btn variant="ghost" onClick={() => router.back()}><ArrowLeft className="h-4 w-4" />{lang === "en" ? "Back" : "رجوع"}</Btn>

      <PageHeader
        title={`${truck.id} · ${lang === "ar" ? truck.plateAr : truck.plate}`}
        subtitle={`${truck.model} · ${truck.year} · ${formatNum(truck.capacityLiters)} L · ${truck.homeDepot}`}
        actions={
          <>
            <StatusPill status={truck.status} label={t(`status.${truck.status}`, lang)} />
            <Btn variant="outline">{lang === "en" ? "Schedule Service" : "جدولة صيانة"}</Btn>
            <Btn variant="primary">{lang === "en" ? "Assign Trip" : "إسناد رحلة"}</Btn>
          </>
        }
      />

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Stat label={t("common.health", lang)} value={truck.healthScore} tone={truck.healthScore > 75 ? "ok" : truck.healthScore > 55 ? "warn" : "bad"} />
        <Stat label={lang === "en" ? "Utilization" : "الاستخدام"} value={`${truck.utilizationPct}%`} tone="info" />
        <Stat label={lang === "en" ? "Fuel Eff." : "كفاءة الوقود"} value={`${truck.fuelEfficiencyKmPerL} km/L`} />
        <Stat label={t("common.odometer", lang)} value={`${formatNum(truck.odometerKm)} km`} />
        <Stat label={lang === "en" ? "Engine Hours" : "ساعات المحرك"} value={formatNum(truck.engineHours)} />
        <Stat label={t("common.nextService", lang)} value={kmToService < 0 ? (lang === "en" ? "Overdue" : "متأخرة") : `${formatNum(kmToService)} km`} tone={kmToService < 1500 ? "warn" : "ok"} />
      </div>

      {/* IoT live */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse-dot"></span>
              {lang === "en" ? "Live IoT Telemetry" : "بث المستشعرات المباشر"}
            </h3>
            <span className="text-xs muted">{lang === "en" ? "Last update" : "آخر تحديث"}: 12s ago</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <IotTile icon={Thermometer} label={lang === "en" ? "Engine Temp" : "حرارة المحرك"} value={`${truck.iot.engineTempC}°C`} tone={truck.iot.engineTempC > 95 ? "warn" : "ok"} />
            <IotTile icon={Gauge} label={lang === "en" ? "Oil Pressure" : "ضغط الزيت"} value={`${truck.iot.oilPressureKpa} kPa`} tone={truck.iot.oilPressureKpa < 350 ? "warn" : "ok"} />
            <IotTile icon={Droplet} label={lang === "en" ? "Coolant" : "سائل التبريد"} value={`${truck.iot.coolantLevelPct}%`} tone={truck.iot.coolantLevelPct < 80 ? "warn" : "ok"} />
            <IotTile icon={Battery} label={lang === "en" ? "Battery" : "البطارية"} value={`${truck.iot.batteryV} V`} tone={truck.iot.batteryV < 12.4 ? "warn" : "ok"} />
            <IotTile icon={Wind} label={lang === "en" ? "Tire FL" : "إطار أمامي يسار"} value={`${truck.iot.tirePressureBarFL} bar`} />
            <IotTile icon={Wind} label={lang === "en" ? "Tire FR" : "إطار أمامي يمين"} value={`${truck.iot.tirePressureBarFR} bar`} />
            <IotTile icon={Wind} label={lang === "en" ? "Tire RL" : "إطار خلفي يسار"} value={`${truck.iot.tirePressureBarRL} bar`} />
            <IotTile icon={Wind} label={lang === "en" ? "Tire RR" : "إطار خلفي يمين"} value={`${truck.iot.tirePressureBarRR} bar`} />
            <IotTile icon={Zap} label={lang === "en" ? "Vibration RMS" : "اهتزاز"} value={`${truck.iot.vibrationRms} mm/s`} tone={truck.iot.vibrationRms > 4.5 ? "warn" : "ok"} />
            <IotTile icon={Droplet} label={lang === "en" ? "Tank Level" : "مستوى الخزان"} value={`${truck.iot.tankLevelPct}%`} />
            <IotTile icon={Gauge} label={lang === "en" ? "Speed" : "السرعة"} value={`${truck.iot.speedKph} km/h`} />
            <IotTile icon={MapPin} label="GPS" value={`${truck.iot.gps.lat}, ${truck.iot.gps.lng}`} />
          </div>

          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={tempHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
                <XAxis dataKey="h" stroke="rgb(var(--muted))" fontSize={11} />
                <YAxis stroke="rgb(var(--muted))" fontSize={11} />
                <Tooltip contentStyle={{ background: "rgb(var(--card))", border: "1px solid rgb(var(--border))", borderRadius: 8 }} />
                <Line type="monotone" dataKey="temp" stroke="#ef4444" strokeWidth={2} dot={false} name="Engine °C" />
                <Line type="monotone" dataKey="vib" stroke="#f59e0b" strokeWidth={2} dot={false} name="Vibration" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-4">
          <Section title={lang === "en" ? "Driver" : "السائق"}>
            {driver ? (
              <div>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-brand-700 text-white grid place-items-center font-semibold">{driver.name.split(" ").map(w => w[0]).slice(0, 2).join("")}</div>
                  <div>
                    <div className="font-medium">{lang === "ar" ? driver.nameAr : driver.name}</div>
                    <div className="text-xs muted">{driver.id} · {driver.phone}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                  <div><span className="muted">{lang === "en" ? "Safety Score" : "درجة السلامة"}:</span> <span className="font-medium">{driver.safetyScore}</span></div>
                  <div><span className="muted">{lang === "en" ? "Trips 30d" : "رحلات 30 يوم"}:</span> <span className="font-medium">{driver.trips30d}</span></div>
                  <div><span className="muted">{lang === "en" ? "Rating" : "التقييم"}:</span> <span className="font-medium">{driver.rating} / 5</span></div>
                  <div><span className="muted">{lang === "en" ? "Status" : "الحالة"}:</span> <StatusPill status={driver.status} label={t(`status.${driver.status}`, lang)} /></div>
                </div>
              </div>
            ) : <p className="text-sm muted">{lang === "en" ? "No driver assigned" : "لا يوجد سائق معين"}</p>}
          </Section>

          <Section title={lang === "en" ? "Predictive Alerts" : "تنبيهات تنبؤية"}>
            {truckAlerts.length === 0 ? (
              <p className="text-sm muted">{lang === "en" ? "No active alerts" : "لا توجد تنبيهات"}</p>
            ) : truckAlerts.map(a => (
              <div key={a.id} className="flex items-start gap-2 py-2 border-t first:border-0" style={{ borderColor: "rgb(var(--border))" }}>
                <AlertTriangle className={`h-4 w-4 mt-0.5 ${a.severity === "critical" ? "text-rose-500" : a.severity === "warning" ? "text-amber-500" : "text-blue-500"}`} />
                <div className="flex-1">
                  <div className="text-sm font-medium">{a.component}</div>
                  <div className="text-xs muted">{lang === "en" ? a.recommendedAction : a.recommendedActionAr}</div>
                  <div className="text-[11px] muted">{a.predictedFailureInDays}d · {a.confidencePct}% conf</div>
                </div>
              </div>
            ))}
          </Section>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title={lang === "en" ? "Recent Work Orders" : "أوامر العمل الأخيرة"}>
          {truckWO.length === 0 ? <p className="text-sm muted">{lang === "en" ? "No work orders" : "لا توجد"}</p> :
            truckWO.map(w => (
              <div key={w.id} className="py-2 border-t first:border-0" style={{ borderColor: "rgb(var(--border))" }}>
                <div className="flex justify-between gap-2">
                  <div className="font-medium text-sm">{lang === "ar" ? w.titleAr : w.title}</div>
                  <StatusPill status={w.status} label={t(`status.${w.status}`, lang)} />
                </div>
                <div className="text-xs muted">{w.id} · {w.type} · {new Date(w.openedAt).toDateString()}</div>
              </div>
            ))}
        </Section>

        <Section title={lang === "en" ? "Recent Trips" : "الرحلات الأخيرة"}>
          {truckTrips.length === 0 ? <p className="text-sm muted">{lang === "en" ? "No trips" : "لا توجد"}</p> :
            truckTrips.map(tr => (
              <div key={tr.id} className="py-2 border-t first:border-0" style={{ borderColor: "rgb(var(--border))" }}>
                <div className="flex justify-between gap-2">
                  <div className="font-medium text-sm">{tr.ref} → {lang === "ar" ? tr.destination.nameAr : tr.destination.name}</div>
                  <StatusPill status={tr.status} label={t(`status.${tr.status}`, lang)} />
                </div>
                <div className="text-xs muted">{formatNum(tr.waterLiters)} L · {tr.distanceKm} km</div>
              </div>
            ))}
        </Section>
      </div>
    </div>
  );
}

function IotTile({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const c = tone === "warn" ? "text-amber-600 dark:text-amber-400" : tone === "bad" ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400";
  return (
    <div className="rounded-lg border p-2.5" style={{ borderColor: "rgb(var(--border))" }}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`h-3.5 w-3.5 ${tone ? c : "muted"}`} />
        <span className="text-[11px] muted truncate">{label}</span>
      </div>
      <div className={`text-sm font-semibold tabular-nums ${tone ? c : ""}`}>{value}</div>
    </div>
  );
}
