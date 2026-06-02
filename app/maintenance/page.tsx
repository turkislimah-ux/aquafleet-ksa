"use client";

import { useApp } from "@/components/AppShell";
import { PageHeader, Card, Stat, StatusPill, Btn, Table, TH, TD, Section } from "@/components/ui";
import { workOrders, parts, findTruck, findPerson, trucks } from "@/lib/mock-data";
import { t } from "@/lib/i18n";
import { formatSar, cn } from "@/lib/utils";
import { Plus, Wrench, Calendar, AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";

export default function MaintenancePage() {
  const { lang } = useApp();
  const [filter, setFilter] = useState<"all" | "open" | "in_progress" | "awaiting_parts" | "completed">("all");

  const list = useMemo(() => workOrders.filter(w => filter === "all" ? true : w.status === filter), [filter]);

  const open = workOrders.filter(w => w.status !== "completed" && w.status !== "cancelled").length;
  const overdue = workOrders.filter(w => w.status !== "completed" && new Date(w.dueBy) < new Date(2026, 4, 10)).length;
  const totalEstCost = workOrders.filter(w => w.status !== "completed").reduce((s, w) => s + w.estimatedCostSar, 0);
  const completedCost = workOrders.filter(w => w.status === "completed").reduce((s, w) => s + (w.actualCostSar ?? 0), 0);

  const upcoming = trucks
    .map(tr => ({ truck: tr, kmTo: tr.nextServiceKm - tr.odometerKm }))
    .filter(x => x.kmTo > 0 && x.kmTo < 3000)
    .sort((a, b) => a.kmTo - b.kmTo)
    .slice(0, 8);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.maintenance", lang)}
        subtitle={lang === "en" ? "Work orders, preventive schedules, and history" : "أوامر العمل والصيانة الوقائية والسجل"}
        actions={
          <>
            <Btn variant="outline"><Calendar className="h-4 w-4" />{lang === "en" ? "Schedule PM" : "جدولة وقائية"}</Btn>
            <Btn variant="primary"><Plus className="h-4 w-4" />{lang === "en" ? "New Work Order" : "أمر عمل جديد"}</Btn>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={lang === "en" ? "Open Work Orders" : "أوامر مفتوحة"} value={open} tone={open > 12 ? "warn" : "ok"} />
        <Stat label={lang === "en" ? "Overdue" : "متأخرة"} value={overdue} tone={overdue > 0 ? "bad" : "ok"} />
        <Stat label={lang === "en" ? "Est. Cost (open)" : "تكلفة تقديرية"} value={formatSar(totalEstCost)} tone="warn" />
        <Stat label={lang === "en" ? "Completed Cost (30d)" : "تكلفة مكتملة (30 يوم)"} value={formatSar(completedCost)} />
      </div>

      <Card className="!p-3">
        <div className="flex items-center gap-1 flex-wrap">
          {(["all", "open", "in_progress", "awaiting_parts", "completed"] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={cn("h-9 px-3 rounded-lg text-xs font-medium border",
                filter === s ? "bg-brand-600 text-white border-brand-600" : "")}
              style={filter !== s ? { borderColor: "rgb(var(--border))" } : undefined}>
              {s === "all" ? t("common.all", lang) : t(`status.${s}`, lang)}
              <span className="ms-1 muted">{s === "all" ? workOrders.length : workOrders.filter(w => w.status === s).length}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH>WO</TH>
              <TH>{lang === "en" ? "Title" : "العنوان"}</TH>
              <TH>{lang === "en" ? "Truck" : "الشاحنة"}</TH>
              <TH>{lang === "en" ? "Type" : "النوع"}</TH>
              <TH>{lang === "en" ? "Priority" : "الأولوية"}</TH>
              <TH>{t("common.status", lang)}</TH>
              <TH>{lang === "en" ? "Mechanic" : "الفني"}</TH>
              <TH>{lang === "en" ? "Opened" : "تاريخ الفتح"}</TH>
              <TH>{lang === "en" ? "Due" : "تاريخ الاستحقاق"}</TH>
              <TH>{lang === "en" ? "Est. Cost" : "تكلفة تقديرية"}</TH>
              <TH>{lang === "en" ? "Hrs" : "ساعات"}</TH>
            </tr>
          </thead>
          <tbody>
            {list.map(w => {
              const truck = findTruck(w.truckId);
              const mech = w.assignedMechanicId ? findPerson(w.assignedMechanicId) : null;
              const overdue = w.status !== "completed" && new Date(w.dueBy) < new Date(2026, 4, 10);
              const priorityCls = {
                low: "text-slate-500",
                medium: "text-blue-600",
                high: "text-amber-600",
                critical: "text-rose-600 font-semibold",
              }[w.priority];
              return (
                <tr key={w.id}>
                  <TD className="font-mono text-xs">{w.id}</TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      {w.type === "predictive" && <span className="text-[10px] bg-purple-500/10 text-purple-700 dark:text-purple-300 rounded px-1.5 py-0.5 font-medium">AI</span>}
                      <span className="font-medium">{lang === "ar" ? w.titleAr : w.title}</span>
                    </div>
                    {w.predictiveSignal && <div className="text-[11px] muted">{w.predictiveSignal}</div>}
                  </TD>
                  <TD className="font-mono text-xs">{truck?.id} · {lang === "ar" ? truck?.plateAr : truck?.plate}</TD>
                  <TD className="capitalize">{w.type}</TD>
                  <TD className={priorityCls}>{w.priority}</TD>
                  <TD><StatusPill status={w.status} label={t(`status.${w.status}`, lang)} /></TD>
                  <TD>{mech ? (lang === "ar" ? mech.nameAr : mech.name) : "—"}</TD>
                  <TD className="text-xs">{new Date(w.openedAt).toLocaleDateString()}</TD>
                  <TD className={cn("text-xs", overdue ? "text-rose-600 font-medium" : "")}>
                    {overdue && <AlertTriangle className="inline h-3 w-3 me-1" />}
                    {new Date(w.dueBy).toLocaleDateString()}
                  </TD>
                  <TD className="tabular-nums">{formatSar(w.estimatedCostSar)}</TD>
                  <TD className="tabular-nums">{w.laborHours}</TD>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Section title={lang === "en" ? "Upcoming Preventive Maintenance" : "الصيانة الوقائية القادمة"}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {upcoming.map(({ truck, kmTo }) => (
            <div key={truck.id} className="rounded-lg border p-3" style={{ borderColor: "rgb(var(--border))" }}>
              <div className="flex items-center gap-2 mb-1">
                <Wrench className="h-4 w-4 text-amber-500" />
                <span className="font-mono text-xs">{truck.id}</span>
              </div>
              <div className="text-sm font-medium truncate">{truck.model}</div>
              <div className="text-[11px] muted">{lang === "ar" ? truck.plateAr : truck.plate} · {truck.homeDepot}</div>
              <div className="text-xs mt-2">
                <span className="muted">{lang === "en" ? "Next service in" : "الصيانة بعد"}:</span>{" "}
                <span className={cn("font-semibold tabular-nums", kmTo < 1000 ? "text-rose-600" : kmTo < 2000 ? "text-amber-600" : "text-emerald-600")}>
                  {kmTo} km
                </span>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
