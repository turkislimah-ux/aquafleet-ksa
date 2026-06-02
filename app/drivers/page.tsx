"use client";

import { useApp } from "@/components/AppShell";
import { PageHeader, Card, Stat, StatusPill, Btn, Bar, Table, TH, TD, Section } from "@/components/ui";
import { drivers, people, findTruck } from "@/lib/mock-data";
import { t } from "@/lib/i18n";
import { Plus, Star, AlertTriangle, ShieldCheck, Phone } from "lucide-react";

export default function DriversPage() {
  const { lang } = useApp();
  const onDuty = drivers.filter(d => d.status === "on_duty").length;
  const expiring = drivers.filter(d => new Date(d.licenseExpiry) < new Date(2026, 11, 31)).length;
  const avgSafety = +(drivers.reduce((s, d) => s + d.safetyScore, 0) / drivers.length).toFixed(1);
  const incidents = drivers.reduce((s, d) => s + d.incidents12mo, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.drivers", lang)}
        subtitle={lang === "en" ? `${drivers.length} drivers · ${people.length} support staff` : `${drivers.length} سائق · ${people.length} موظف`}
        actions={<Btn variant="primary"><Plus className="h-4 w-4" />{lang === "en" ? "Add Person" : "إضافة موظف"}</Btn>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={lang === "en" ? "On Duty Now" : "في الخدمة الآن"} value={`${onDuty}/${drivers.length}`} tone="ok" />
        <Stat label={lang === "en" ? "Avg Safety Score" : "متوسط درجة السلامة"} value={avgSafety} tone={avgSafety > 80 ? "ok" : "warn"} />
        <Stat label={lang === "en" ? "Incidents (12mo)" : "حوادث (12 شهر)"} value={incidents} tone={incidents > 5 ? "warn" : "ok"} />
        <Stat label={lang === "en" ? "Licenses expiring 2026" : "رخص تنتهي 2026"} value={expiring} tone={expiring > 5 ? "warn" : "info"} />
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: "rgb(var(--border))" }}>
          <h3 className="font-semibold">{lang === "en" ? "Drivers" : "السائقون"}</h3>
        </div>
        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH>{t("common.driver", lang)}</TH>
              <TH>{lang === "en" ? "ID / Iqama" : "الإقامة"}</TH>
              <TH>{t("common.depot", lang)}</TH>
              <TH>{t("common.status", lang)}</TH>
              <TH>{lang === "en" ? "Truck" : "الشاحنة"}</TH>
              <TH>{lang === "en" ? "Safety" : "السلامة"}</TH>
              <TH>{lang === "en" ? "Trips 30d" : "رحلات 30 يوم"}</TH>
              <TH>{lang === "en" ? "Hrs/wk" : "ساعات/أسبوع"}</TH>
              <TH>{lang === "en" ? "Rating" : "التقييم"}</TH>
              <TH>{lang === "en" ? "License Exp" : "انتهاء الرخصة"}</TH>
              <TH>{lang === "en" ? "Incidents" : "الحوادث"}</TH>
            </tr>
          </thead>
          <tbody>
            {drivers.map(d => {
              const truck = d.assignedTruckId ? findTruck(d.assignedTruckId) : null;
              const expiringSoon = new Date(d.licenseExpiry) < new Date(2026, 11, 31);
              return (
                <tr key={d.id}>
                  <TD>
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-brand-700 text-white grid place-items-center text-xs font-semibold">
                        {d.name.split(" ").map(w => w[0]).slice(0, 2).join("")}
                      </div>
                      <div>
                        <div className="font-medium">{lang === "ar" ? d.nameAr : d.name}</div>
                        <div className="text-[11px] muted flex items-center gap-1"><Phone className="h-3 w-3" />{d.phone}</div>
                      </div>
                    </div>
                  </TD>
                  <TD className="font-mono text-xs">{d.iqama}</TD>
                  <TD>{d.homeDepot}</TD>
                  <TD><StatusPill status={d.status} label={t(`status.${d.status}`, lang)} /></TD>
                  <TD>{truck ? <span className="font-mono text-xs">{truck.id}</span> : <span className="muted">—</span>}</TD>
                  <TD>
                    <div className="w-24">
                      <div className="text-[11px] tabular-nums mb-0.5">{d.safetyScore}</div>
                      <Bar value={d.safetyScore} />
                    </div>
                  </TD>
                  <TD className="tabular-nums">{d.trips30d}</TD>
                  <TD className="tabular-nums">{d.hoursThisWeek}</TD>
                  <TD className="flex items-center gap-1"><Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" /> {d.rating}</TD>
                  <TD className={expiringSoon ? "text-amber-600 font-medium" : ""}>{d.licenseExpiry}</TD>
                  <TD>{d.incidents12mo > 0 ? <span className="text-rose-600 font-medium flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {d.incidents12mo}</span> : <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />}</TD>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Section title={lang === "en" ? "Management & Support Staff" : "الإدارة والموظفون"}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {people.map(p => (
            <div key={p.id} className="rounded-lg border p-3 flex items-center gap-3" style={{ borderColor: "rgb(var(--border))" }}>
              <div className="h-10 w-10 rounded-full bg-sand-500 text-white grid place-items-center text-sm font-semibold">
                {p.name.split(" ").map(w => w[0]).slice(0, 2).join("")}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{lang === "ar" ? p.nameAr : p.name}</div>
                <div className="text-xs muted truncate">{p.role.replace(/_/g, " ")} · {p.depot}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
