"use client";

import { useApp } from "@/components/AppShell";
import { PageHeader, Stat, Card, StatusPill, Section, Btn, Bar } from "@/components/ui";
import { fleetKpis, trucks, trips, predictiveAlerts, workOrders, drivers } from "@/lib/mock-data";
import { t } from "@/lib/i18n";
import { formatNum, formatSar } from "@/lib/utils";
import {
  AlertTriangle, Droplets, TrendingDown, TrendingUp, Wrench, Plus, Activity,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar as RBar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell, Legend,
} from "recharts";

const last14d = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(2026, 4, 10 - (13 - i));
  const day = `${d.getMonth() + 1}/${d.getDate()}`;
  return { day, liters: 90000 + ((i * 7919) % 60000), trips: 22 + ((i * 13) % 14), fuel: 1800 + ((i * 311) % 700) };
});

const fleetPie = (kpis: ReturnType<typeof fleetKpis>) => [
  { name: "Active", value: kpis.active, color: "#10b981" },
  { name: "Idle", value: kpis.idle, color: "#3b82f6" },
  { name: "Maintenance", value: kpis.maint, color: "#f59e0b" },
  { name: "Out of Service", value: kpis.oos, color: "#ef4444" },
];

const costBreakdown = [
  { name: "Fuel", value: 142000, color: "#0b7eea" },
  { name: "Maintenance", value: 58000, color: "#f59e0b" },
  { name: "Drivers", value: 96000, color: "#10b981" },
  { name: "Parts", value: 31000, color: "#8b5cf6" },
  { name: "Other", value: 18000, color: "#94a3b8" },
];

export default function DashboardPage() {
  const { lang } = useApp();
  const kpis = fleetKpis();
  const openWO = workOrders.filter(w => w.status !== "completed" && w.status !== "cancelled").length;
  const critical = predictiveAlerts.filter(a => a.severity === "critical").length;
  const onDuty = drivers.filter(d => d.status === "on_duty").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.dashboard", lang)}
        subtitle={lang === "en" ? "Operations overview · 40 trucks · 4 depots" : "نظرة عامة على العمليات · 40 شاحنة · 4 مستودعات"}
        actions={
          <>
            <Btn variant="outline"><Activity className="h-4 w-4" />{lang === "en" ? "Live IoT" : "البث المباشر"}</Btn>
            <Btn variant="primary"><Plus className="h-4 w-4" />{lang === "en" ? "New Trip" : "رحلة جديدة"}</Btn>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Stat label={t("kpi.activeTrucks", lang)} value={`${kpis.active}/${trucks.length}`} sub={`${kpis.maint} ${lang === "en" ? "in maintenance" : "في الصيانة"}`} tone="ok" />
        <Stat label={t("kpi.utilization", lang)} value={`${kpis.utilization}%`} sub={lang === "en" ? "30-day avg" : "متوسط 30 يوم"} tone="info" />
        <Stat label={t("kpi.avgHealth", lang)} value={`${kpis.avgHealth}`} sub={lang === "en" ? "out of 100" : "من 100"} tone={kpis.avgHealth > 75 ? "ok" : "warn"} />
        <Stat label={t("kpi.onTime", lang)} value={`${kpis.onTimePct}%`} sub={lang === "en" ? "deliveries on schedule" : "تسليم في الموعد"} tone="ok" />
        <Stat label={t("kpi.openWO", lang)} value={openWO} sub={lang === "en" ? "active work orders" : "أوامر عمل نشطة"} tone="warn" />
        <Stat label={t("kpi.criticalAlerts", lang)} value={critical} sub={lang === "en" ? "predictive AI" : "ذكاء تنبؤي"} tone="bad" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold">{t("kpi.litersDelivered", lang)}</h3>
              <p className="text-xs muted">{formatNum(kpis.litersDelivered30d)} {lang === "en" ? "liters · 30 days" : "لتر · 30 يوم"}</p>
            </div>
            <div className="text-emerald-600 text-xs flex items-center gap-1"><TrendingUp className="h-3 w-3" /> +12.4%</div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={last14d}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0b7eea" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#0b7eea" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
                <XAxis dataKey="day" stroke="rgb(var(--muted))" fontSize={11} />
                <YAxis stroke="rgb(var(--muted))" fontSize={11} />
                <Tooltip contentStyle={{ background: "rgb(var(--card))", border: "1px solid rgb(var(--border))", borderRadius: 8 }} />
                <Area type="monotone" dataKey="liters" stroke="#0b7eea" fill="url(#g1)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="font-semibold mb-3">{lang === "en" ? "Fleet Status" : "حالة الأسطول"}</h3>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={fleetPie(kpis)} dataKey="value" innerRadius={45} outerRadius={75} paddingAngle={2}>
                  {fleetPie(kpis).map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "rgb(var(--card))", border: "1px solid rgb(var(--border))", borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1.5 mt-2 text-xs">
            {fleetPie(kpis).map(e => (
              <div key={e.name} className="flex items-center justify-between">
                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: e.color }} />{e.name}</span>
                <span className="font-medium tabular-nums">{e.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">{lang === "en" ? "Daily Trips & Fuel" : "الرحلات والوقود اليومي"}</h3>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={last14d}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
                <XAxis dataKey="day" stroke="rgb(var(--muted))" fontSize={11} />
                <YAxis stroke="rgb(var(--muted))" fontSize={11} />
                <Tooltip contentStyle={{ background: "rgb(var(--card))", border: "1px solid rgb(var(--border))", borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <RBar dataKey="trips" fill="#0b7eea" name={lang === "en" ? "Trips" : "رحلات"} radius={[4, 4, 0, 0]} />
                <RBar dataKey="fuel" fill="#f59e0b" name={lang === "en" ? "Fuel (L)" : "وقود (لتر)"} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="font-semibold mb-3">{lang === "en" ? "Operating Cost (30d)" : "تكلفة التشغيل (30 يوم)"}</h3>
          <div className="text-2xl font-semibold tabular-nums">{formatSar(345000)}</div>
          <p className="text-xs muted mb-4 flex items-center gap-1"><TrendingDown className="h-3 w-3 text-emerald-500" /> -4.8% {lang === "en" ? "vs last period" : "مقابل الفترة السابقة"}</p>
          <div className="space-y-2">
            {costBreakdown.map(c => (
              <div key={c.name}>
                <div className="flex justify-between text-xs mb-1">
                  <span>{c.name}</span>
                  <span className="font-medium tabular-nums">{formatSar(c.value)}</span>
                </div>
                <Bar value={c.value} max={142000} tone="ok" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title={lang === "en" ? "Critical Predictive Alerts" : "تنبيهات تنبؤية حرجة"}
          action={<Btn variant="ghost"><span className="text-brand-600 dark:text-brand-300 text-xs font-medium">{lang === "en" ? "View all" : "عرض الكل"} →</span></Btn>}>
          <div className="space-y-2">
            {predictiveAlerts.slice(0, 5).map(a => (
              <div key={a.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${a.severity === "critical" ? "bg-rose-500/10 text-rose-600" : a.severity === "warning" ? "bg-amber-500/10 text-amber-600" : "bg-blue-500/10 text-blue-600"}`}>
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sm truncate">{a.truckId} · {a.component}</div>
                    <StatusPill status={a.severity} label={t(`status.${a.severity}`, lang)} />
                  </div>
                  <div className="text-xs muted truncate">{lang === "en" ? a.recommendedAction : a.recommendedActionAr}</div>
                  <div className="text-[11px] muted mt-0.5">
                    {t("common.failureIn", lang)} {a.predictedFailureInDays} {t("common.days", lang)} · {a.confidencePct}% {t("common.confidence", lang)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title={lang === "en" ? "Live Trips" : "الرحلات النشطة"}
          action={<Btn variant="ghost"><span className="text-brand-600 dark:text-brand-300 text-xs font-medium">{lang === "en" ? "View all" : "عرض الكل"} →</span></Btn>}>
          <div className="space-y-2">
            {trips.filter(t => t.status === "in_transit" || t.status === "loading").slice(0, 5).map(tr => (
              <div key={tr.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                <Droplets className="h-5 w-5 text-brand-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-sm truncate">{tr.ref}</div>
                    <StatusPill status={tr.status} label={t(`status.${tr.status}`, lang)} />
                  </div>
                  <div className="text-xs muted truncate">
                    {tr.truckId} → {lang === "en" ? tr.destination.name : tr.destination.nameAr}
                  </div>
                  <div className="text-[11px] muted">
                    {formatNum(tr.waterLiters)} L · {tr.distanceKm} km
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={t("kpi.todayTrips", lang)} value={kpis.todayTrips} sub={lang === "en" ? "scheduled today" : "مجدولة اليوم"} />
        <Stat label={lang === "en" ? "Drivers On Duty" : "السائقون في الخدمة"} value={`${onDuty}/${drivers.length}`} sub={lang === "en" ? "active right now" : "نشط الآن"} tone="ok" />
        <Stat label={t("kpi.fuelCost", lang)} value={formatSar(kpis.fuelCost30d)} sub={lang === "en" ? "30-day total" : "إجمالي 30 يوم"} tone="warn" />
        <Stat label={t("kpi.revenue", lang)} value={formatSar(kpis.revenue30d)} sub={lang === "en" ? "30-day total" : "إجمالي 30 يوم"} tone="ok" />
      </div>
    </div>
  );
}
