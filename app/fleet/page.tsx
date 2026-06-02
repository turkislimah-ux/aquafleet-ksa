"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useApp } from "@/components/AppShell";
import { PageHeader, Card, StatusPill, Btn, Bar, Table, TH, TD } from "@/components/ui";
import { trucks, findDriver } from "@/lib/mock-data";
import { t } from "@/lib/i18n";
import { cn, formatNum } from "@/lib/utils";
import { Plus, Filter, Truck, Eye } from "lucide-react";

const STATUS_OPTIONS = ["all", "active", "idle", "maintenance", "out_of_service"] as const;

export default function FleetPage() {
  const { lang } = useApp();
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("all");
  const [depot, setDepot] = useState<string>("all");
  const [q, setQ] = useState("");

  const list = useMemo(() => trucks.filter(tr => {
    if (status !== "all" && tr.status !== status) return false;
    if (depot !== "all" && tr.homeDepot !== depot) return false;
    if (q) {
      const s = q.toLowerCase();
      if (!(tr.id.toLowerCase().includes(s) || tr.plate.toLowerCase().includes(s) || tr.model.toLowerCase().includes(s))) return false;
    }
    return true;
  }), [status, depot, q]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.fleet", lang)}
        subtitle={lang === "en" ? `${trucks.length} trucks across 4 depots` : `${trucks.length} شاحنة في 4 مستودعات`}
        actions={<Btn variant="primary"><Plus className="h-4 w-4" />{lang === "en" ? "Add Truck" : "إضافة شاحنة"}</Btn>}
      />

      {/* Filters */}
      <Card className="!p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 muted ms-1" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder={lang === "en" ? "Search plate, model, ID…" : "بحث برقم اللوحة، الموديل…"}
            className="h-9 px-3 rounded-lg border text-sm flex-1 min-w-[200px]"
            style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
          />
          <div className="flex items-center gap-1 flex-wrap">
            {STATUS_OPTIONS.map(s => (
              <button key={s} onClick={() => setStatus(s)}
                className={cn("h-9 px-3 rounded-lg text-xs font-medium border",
                  status === s ? "bg-brand-600 text-white border-brand-600" : "")}
                style={status !== s ? { borderColor: "rgb(var(--border))" } : undefined}>
                {s === "all" ? t("common.all", lang) : t(`status.${s}`, lang)}
              </button>
            ))}
          </div>
          <select value={depot} onChange={e => setDepot(e.target.value)}
            className="h-9 px-3 rounded-lg border text-sm"
            style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}>
            <option value="all">{lang === "en" ? "All Depots" : "كل المستودعات"}</option>
            {["Riyadh", "Jeddah", "Dammam", "Madinah"].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <span className="muted text-xs ms-auto">{list.length} {lang === "en" ? "results" : "نتيجة"}</span>
        </div>
      </Card>

      {/* Table */}
      <Card className="!p-0 overflow-hidden">
        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH>{t("common.truck", lang)}</TH>
              <TH>{t("common.plate", lang)}</TH>
              <TH>{lang === "en" ? "Model" : "الموديل"}</TH>
              <TH>{t("common.depot", lang)}</TH>
              <TH>{t("common.status", lang)}</TH>
              <TH>{t("common.driver", lang)}</TH>
              <TH>{t("common.health", lang)}</TH>
              <TH>{t("common.capacity", lang)}</TH>
              <TH>{t("common.odometer", lang)}</TH>
              <TH>{t("common.nextService", lang)}</TH>
              <TH></TH>
            </tr>
          </thead>
          <tbody>
            {list.map(tr => {
              const driver = tr.driverId ? findDriver(tr.driverId) : null;
              const kmToService = tr.nextServiceKm - tr.odometerKm;
              return (
                <tr key={tr.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                  <TD>
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-brand-500/10 text-brand-600 grid place-items-center"><Truck className="h-4 w-4" /></div>
                      <div className="font-medium">{tr.id}</div>
                    </div>
                  </TD>
                  <TD className="font-mono text-xs">{lang === "ar" ? tr.plateAr : tr.plate}</TD>
                  <TD>{tr.model} <span className="muted">· {tr.year}</span></TD>
                  <TD>{lang === "ar" ? ({Riyadh: "الرياض", Jeddah: "جدة", Dammam: "الدمام", Madinah: "المدينة"} as any)[tr.homeDepot] : tr.homeDepot}</TD>
                  <TD><StatusPill status={tr.status} label={t(`status.${tr.status}`, lang)} /></TD>
                  <TD>{driver ? (lang === "ar" ? driver.nameAr : driver.name) : <span className="muted">—</span>}</TD>
                  <TD>
                    <div className="w-28">
                      <div className="flex justify-between text-[11px] mb-0.5">
                        <span className="tabular-nums">{tr.healthScore}</span>
                      </div>
                      <Bar value={tr.healthScore} />
                    </div>
                  </TD>
                  <TD className="tabular-nums">{formatNum(tr.capacityLiters)} L</TD>
                  <TD className="tabular-nums">{formatNum(tr.odometerKm)} km</TD>
                  <TD className={cn("tabular-nums", kmToService < 1500 ? "text-amber-600 font-medium" : "")}>
                    {kmToService < 0
                      ? <span className="text-rose-600">{lang === "en" ? "Overdue" : "متأخرة"}</span>
                      : `${formatNum(kmToService)} km`}
                  </TD>
                  <TD>
                    <Link href={`/fleet/${tr.id}`}>
                      <Btn variant="outline"><Eye className="h-3.5 w-3.5" /> {t("common.view", lang)}</Btn>
                    </Link>
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
