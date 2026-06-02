"use client";

import { useApp } from "@/components/AppShell";
import { PageHeader, Card, Stat, StatusPill, Btn, Table, TH, TD } from "@/components/ui";
import { trips, findTruck, findDriver } from "@/lib/mock-data";
import { t } from "@/lib/i18n";
import { formatNum, formatSar, cn } from "@/lib/utils";
import { Plus, MapPin, Droplets, Calendar, ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";

const STATUS = ["all", "scheduled", "loading", "in_transit", "delivered", "cancelled"] as const;

export default function TripsPage() {
  const { lang } = useApp();
  const [status, setStatus] = useState<(typeof STATUS)[number]>("all");

  const list = useMemo(() => trips.filter(tr => status === "all" ? true : tr.status === status), [status]);

  const totalLiters = trips.filter(t => t.status === "delivered").reduce((s, t) => s + t.waterLiters, 0);
  const totalRevenue = trips.filter(t => t.status === "delivered").reduce((s, t) => s + t.revenueSar, 0);
  const totalCost = trips.filter(t => t.status === "delivered").reduce((s, t) => s + t.costSar, 0);
  const onTime = trips.filter(t => t.status === "delivered" && (t.actualDurationMin ?? 0) <= t.plannedDurationMin + 10).length;
  const totalDelivered = trips.filter(t => t.status === "delivered").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.trips", lang)}
        subtitle={lang === "en" ? `${trips.length} trips · last 14 days` : `${trips.length} رحلة · آخر 14 يوم`}
        actions={
          <>
            <Btn variant="outline"><Calendar className="h-4 w-4" />{lang === "en" ? "Schedule" : "الجدول"}</Btn>
            <Btn variant="primary"><Plus className="h-4 w-4" />{lang === "en" ? "New Trip" : "رحلة جديدة"}</Btn>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label={lang === "en" ? "Total Liters Delivered" : "إجمالي اللترات الموردة"} value={formatNum(totalLiters)} tone="info" />
        <Stat label={lang === "en" ? "Trips Delivered" : "رحلات مكتملة"} value={totalDelivered} tone="ok" />
        <Stat label={lang === "en" ? "On-Time" : "في الوقت"} value={`${Math.round((onTime / Math.max(1, totalDelivered)) * 100)}%`} tone="ok" />
        <Stat label={lang === "en" ? "Revenue" : "الإيرادات"} value={formatSar(totalRevenue)} tone="ok" />
        <Stat label={lang === "en" ? "Op Cost" : "تكلفة التشغيل"} value={formatSar(totalCost)} tone="warn" />
      </div>

      <Card className="!p-3">
        <div className="flex items-center gap-1 flex-wrap">
          {STATUS.map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className={cn("h-9 px-3 rounded-lg text-xs font-medium border",
                status === s ? "bg-brand-600 text-white border-brand-600" : "")}
              style={status !== s ? { borderColor: "rgb(var(--border))" } : undefined}>
              {s === "all" ? t("common.all", lang) : t(`status.${s}`, lang)}
              <span className="ms-1 muted">{s === "all" ? trips.length : trips.filter(tr => tr.status === s).length}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH>Ref</TH>
              <TH>{t("common.status", lang)}</TH>
              <TH>{lang === "en" ? "Customer" : "العميل"}</TH>
              <TH>{lang === "en" ? "Route" : "المسار"}</TH>
              <TH>{lang === "en" ? "Truck" : "الشاحنة"}</TH>
              <TH>{lang === "en" ? "Driver" : "السائق"}</TH>
              <TH>{lang === "en" ? "Liters" : "اللترات"}</TH>
              <TH>{lang === "en" ? "Distance" : "المسافة"}</TH>
              <TH>{lang === "en" ? "Schedule" : "الموعد"}</TH>
              <TH>{lang === "en" ? "Cost" : "التكلفة"}</TH>
              <TH>{lang === "en" ? "Revenue" : "الإيرادات"}</TH>
            </tr>
          </thead>
          <tbody>
            {list.map(tr => {
              const driver = findDriver(tr.driverId);
              const truck = findTruck(tr.truckId);
              const margin = tr.revenueSar - tr.costSar;
              return (
                <tr key={tr.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                  <TD>
                    <div className="font-medium">{tr.ref}</div>
                    <div className="text-[11px] muted">{tr.id}</div>
                  </TD>
                  <TD><StatusPill status={tr.status} label={t(`status.${tr.status}`, lang)} /></TD>
                  <TD>
                    <div className="font-medium">{lang === "ar" ? tr.customerAr : tr.customer}</div>
                    <div className="text-[11px] muted">{tr.waterType.replace("_", " ")}</div>
                  </TD>
                  <TD>
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="muted truncate max-w-[110px]">{lang === "ar" ? tr.origin.nameAr : tr.origin.name}</span>
                      <ArrowRight className="h-3 w-3 muted" />
                      <span className="font-medium truncate max-w-[110px]">{lang === "ar" ? tr.destination.nameAr : tr.destination.name}</span>
                    </div>
                  </TD>
                  <TD className="font-mono text-xs">{truck?.id} · {lang === "ar" ? truck?.plateAr : truck?.plate}</TD>
                  <TD>{driver ? (lang === "ar" ? driver.nameAr : driver.name) : "—"}</TD>
                  <TD className="tabular-nums"><Droplets className="h-3 w-3 inline text-brand-500 me-1" />{formatNum(tr.waterLiters)}</TD>
                  <TD className="tabular-nums">{tr.distanceKm} km</TD>
                  <TD className="text-xs">{new Date(tr.scheduledStart).toLocaleDateString()} · {new Date(tr.scheduledStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</TD>
                  <TD className="tabular-nums">{formatSar(tr.costSar)}</TD>
                  <TD className="tabular-nums">
                    <span>{formatSar(tr.revenueSar)}</span>
                    <span className={cn("ms-1 text-[11px]", margin > 0 ? "text-emerald-600" : "text-rose-600")}>
                      ({margin > 0 ? "+" : ""}{formatSar(margin)})
                    </span>
                  </TD>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
