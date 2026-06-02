"use client";

import { useApp } from "@/components/AppShell";
import { PageHeader, Card, Stat, Section, Btn } from "@/components/ui";
import { trips, trucks, fleetKpis } from "@/lib/mock-data";
import { t } from "@/lib/i18n";
import { formatNum, formatSar } from "@/lib/utils";
import { Download, TrendingUp, TrendingDown } from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";

const monthly = [
  { m: "Dec", revenue: 320000, cost: 215000, liters: 3120000, trips: 412 },
  { m: "Jan", revenue: 358000, cost: 224000, liters: 3450000, trips: 438 },
  { m: "Feb", revenue: 345000, cost: 218000, liters: 3290000, trips: 421 },
  { m: "Mar", revenue: 392000, cost: 232000, liters: 3580000, trips: 467 },
  { m: "Apr", revenue: 412000, cost: 241000, liters: 3720000, trips: 489 },
  { m: "May", revenue: 428000, cost: 235000, liters: 3870000, trips: 502 },
];

const depotPerf = [
  { depot: "Riyadh", trips: 168, liters: 1240000, util: 78 },
  { depot: "Jeddah", trips: 142, liters: 1080000, util: 71 },
  { depot: "Dammam", trips: 118, liters: 920000, util: 68 },
  { depot: "Madinah", trips: 74, liters: 630000, util: 62 },
];

const costMix = [
  { name: "Fuel", value: 142000, color: "#0b7eea" },
  { name: "Maintenance", value: 58000, color: "#f59e0b" },
  { name: "Drivers", value: 96000, color: "#10b981" },
  { name: "Parts", value: 31000, color: "#8b5cf6" },
  { name: "Insurance", value: 14000, color: "#06b6d4" },
  { name: "Other", value: 18000, color: "#94a3b8" },
];

export default function ReportsPage() {
  const { lang } = useApp();
  const kpis = fleetKpis();
  const margin30 = kpis.revenue30d - kpis.opCost30d;
  const marginPct = +((margin30 / kpis.revenue30d) * 100).toFixed(1);
  const costPerLiter = +(kpis.opCost30d / Math.max(1, kpis.litersDelivered30d) * 1000).toFixed(2);
  const revPerKm = +(monthly[5].revenue / 24500).toFixed(2);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.reports", lang)}
        subtitle={lang === "en" ? "Cost, revenue, efficiency · last 6 months" : "التكلفة والإيرادات والكفاءة · 6 أشهر"}
        actions={<Btn variant="outline"><Download className="h-4 w-4" />{lang === "en" ? "Export PDF" : "تصدير PDF"}</Btn>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <Stat label={t("kpi.revenue", lang)} value={formatSar(kpis.revenue30d)} sub="+8.4%" tone="ok" />
        <Stat label={t("kpi.opCost", lang)} value={formatSar(kpis.opCost30d)} sub="-4.8%" tone="ok" />
        <Stat label={lang === "en" ? "Margin" : "الهامش"} value={formatSar(margin30)} sub={`${marginPct}%`} tone={marginPct > 25 ? "ok" : "warn"} />
        <Stat label={lang === "en" ? "Cost / 1000 L" : "تكلفة / 1000 لتر"} value={`${costPerLiter} SAR`} tone="info" />
        <Stat label={lang === "en" ? "Revenue / km" : "إيراد / كم"} value={`${revPerKm} SAR`} tone="info" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-4">
          <h3 className="font-semibold mb-3">{lang === "en" ? "Revenue vs Cost (6 months)" : "الإيرادات مقابل التكلفة (6 أشهر)"}</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthly}>
                <defs>
                  <linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.4}/><stop offset="100%" stopColor="#10b981" stopOpacity={0}/></linearGradient>
                  <linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f59e0b" stopOpacity={0.35}/><stop offset="100%" stopColor="#f59e0b" stopOpacity={0}/></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
                <XAxis dataKey="m" stroke="rgb(var(--muted))" fontSize={11} />
                <YAxis stroke="rgb(var(--muted))" fontSize={11} />
                <Tooltip contentStyle={{ background: "rgb(var(--card))", border: "1px solid rgb(var(--border))", borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" fill="url(#r)" strokeWidth={2} name={lang === "en" ? "Revenue" : "الإيرادات"} />
                <Area type="monotone" dataKey="cost" stroke="#f59e0b" fill="url(#c)" strokeWidth={2} name={lang === "en" ? "Cost" : "التكلفة"} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="font-semibold mb-3">{lang === "en" ? "Cost Mix (30d)" : "توزيع التكلفة (30 يوم)"}</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={costMix} dataKey="value" outerRadius={80} innerRadius={45} paddingAngle={2}>
                  {costMix.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "rgb(var(--card))", border: "1px solid rgb(var(--border))", borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1 mt-2 text-xs">
            {costMix.map(c => (
              <div key={c.name} className="flex justify-between">
                <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.name}</span>
                <span className="font-medium tabular-nums">{formatSar(c.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="font-semibold mb-3">{lang === "en" ? "Liters Delivered (6 months)" : "اللترات الموردة (6 أشهر)"}</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
                <XAxis dataKey="m" stroke="rgb(var(--muted))" fontSize={11} />
                <YAxis stroke="rgb(var(--muted))" fontSize={11} />
                <Tooltip contentStyle={{ background: "rgb(var(--card))", border: "1px solid rgb(var(--border))", borderRadius: 8 }} />
                <Line type="monotone" dataKey="liters" stroke="#0b7eea" strokeWidth={2.5} name={lang === "en" ? "Liters" : "لتر"} />
                <Line type="monotone" dataKey="trips" stroke="#8b5cf6" strokeWidth={2} name={lang === "en" ? "Trips" : "رحلات"} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="font-semibold mb-3">{lang === "en" ? "Performance by Depot" : "الأداء حسب المستودع"}</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={depotPerf}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
                <XAxis dataKey="depot" stroke="rgb(var(--muted))" fontSize={11} />
                <YAxis stroke="rgb(var(--muted))" fontSize={11} />
                <Tooltip contentStyle={{ background: "rgb(var(--card))", border: "1px solid rgb(var(--border))", borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="trips" fill="#0b7eea" name={lang === "en" ? "Trips" : "رحلات"} radius={[4, 4, 0, 0]} />
                <Bar dataKey="util" fill="#10b981" name={lang === "en" ? "Util %" : "% استخدام"} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <Section title={lang === "en" ? "Cost-Saving Opportunities" : "فرص تخفيض التكلفة"}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Opportunity
            title={lang === "en" ? "Route Optimization" : "تحسين المسارات"}
            saving={28000}
            desc={lang === "en" ? "Apply 2-opt routing across all 40 trucks — est. 12% fuel reduction." : "تطبيق خوارزمية 2-opt على 40 شاحنة — تقدير 12% خفض وقود."}
          />
          <Opportunity
            title={lang === "en" ? "Predictive Maintenance" : "الصيانة التنبؤية"}
            saving={42000}
            desc={lang === "en" ? "Address 14 active alerts before they become breakdowns." : "معالجة 14 تنبيهًا قبل تحوله إلى عطل."}
          />
          <Opportunity
            title={lang === "en" ? "Idle Truck Reallocation" : "إعادة توزيع الشاحنات المتوقفة"}
            saving={18000}
            desc={lang === "en" ? "8 idle trucks today — reassign to scheduled trips in Jeddah." : "8 شاحنات متوقفة اليوم — إعادة توزيعها على رحلات جدة."}
          />
        </div>
      </Section>
    </div>
  );
}

function Opportunity({ title, saving, desc }: { title: string; saving: number; desc: string }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: "rgb(var(--border))" }}>
      <div className="flex items-center gap-2 mb-1">
        <TrendingDown className="h-4 w-4 text-emerald-500" />
        <span className="font-medium text-sm">{title}</span>
      </div>
      <div className="text-2xl font-semibold tabular-nums text-emerald-600">{formatSar(saving)}</div>
      <p className="text-xs muted mt-1">{desc}</p>
    </div>
  );
}
