"use client";

import { useApp } from "@/components/AppShell";
import { PageHeader, Stat, StatusPill, Btn, Section, Bar } from "@/components/ui";
import { predictiveAlerts, findTruck, trucks } from "@/lib/mock-data";
import { t } from "@/lib/i18n";
import { cn, formatNum } from "@/lib/utils";
import { Brain, AlertTriangle, Sparkles, Cpu } from "lucide-react";
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function PredictivePage() {
  const { lang } = useApp();

  const critical = predictiveAlerts.filter(a => a.severity === "critical");
  const warning = predictiveAlerts.filter(a => a.severity === "warning");
  const info = predictiveAlerts.filter(a => a.severity === "info");

  // Health vs vibration scatter
  const scatter = trucks.map(tr => ({
    health: tr.healthScore,
    vibration: tr.iot.vibrationRms,
    truck: tr.id,
  }));

  const totalSavingsEst = critical.length * 12500 + warning.length * 5500 + info.length * 1200;
  const avgConfidence = +(predictiveAlerts.reduce((s, a) => s + a.confidencePct, 0) / Math.max(1, predictiveAlerts.length)).toFixed(1);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.predictive", lang)}
        subtitle={lang === "en" ? "AI predictions from IoT telemetry · 18 sensors per truck" : "تنبؤات ذكاء صناعي من المستشعرات · 18 حساس لكل شاحنة"}
        actions={
          <>
            <Btn variant="outline"><Cpu className="h-4 w-4" />{lang === "en" ? "Model v3.2" : "النموذج 3.2"}</Btn>
            <Btn variant="primary"><Sparkles className="h-4 w-4" />{lang === "en" ? "Re-run analysis" : "إعادة التحليل"}</Btn>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={lang === "en" ? "Critical Alerts" : "تنبيهات حرجة"} value={critical.length} tone="bad" />
        <Stat label={lang === "en" ? "Warnings" : "تحذيرات"} value={warning.length} tone="warn" />
        <Stat label={lang === "en" ? "Avg Confidence" : "متوسط الثقة"} value={`${avgConfidence}%`} tone="info" />
        <Stat label={lang === "en" ? "Estimated Savings" : "مدخرات تقديرية"} value={`${formatNum(totalSavingsEst)} SAR`} sub={lang === "en" ? "vs. reactive repair" : "مقابل الإصلاح التفاعلي"} tone="ok" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2"><Brain className="h-4 w-4 text-purple-500" />{lang === "en" ? "Active Predictive Alerts" : "التنبيهات التنبؤية النشطة"}</h3>
            <span className="text-xs muted">{predictiveAlerts.length} {lang === "en" ? "alerts" : "تنبيه"}</span>
          </div>
          <div className="space-y-2 max-h-[520px] overflow-auto scrollbar-thin pe-1">
            {predictiveAlerts.map(a => {
              const truck = findTruck(a.truckId);
              return (
                <div key={a.id} className={cn("rounded-lg border p-3", a.severity === "critical" ? "border-rose-300 dark:border-rose-700/50 bg-rose-500/5" : a.severity === "warning" ? "border-amber-300 dark:border-amber-700/50 bg-amber-500/5" : "")}
                  style={a.severity === "info" ? { borderColor: "rgb(var(--border))" } : undefined}>
                  <div className="flex items-start gap-3">
                    <div className={cn("h-9 w-9 rounded-lg grid place-items-center shrink-0",
                      a.severity === "critical" ? "bg-rose-500/10 text-rose-600" : a.severity === "warning" ? "bg-amber-500/10 text-amber-600" : "bg-blue-500/10 text-blue-600")}>
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="font-medium">
                          {a.truckId} · {a.component}
                          <span className="muted text-xs ms-2 font-normal">({truck?.model})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusPill status={a.severity} label={t(`status.${a.severity}`, lang)} />
                          <span className="text-xs font-medium tabular-nums">{a.confidencePct}% {t("common.confidence", lang)}</span>
                        </div>
                      </div>
                      <div className="text-xs muted mt-1">
                        <span className="font-medium muted">{lang === "en" ? "Signal" : "الإشارة"}:</span> {a.signal}
                      </div>
                      <div className="text-sm mt-2">
                        <span className="font-medium">{t("common.recommended", lang)}:</span>{" "}
                        {lang === "en" ? a.recommendedAction : a.recommendedActionAr}
                      </div>
                      <div className="flex items-center justify-between mt-2 text-xs">
                        <span className="muted">{t("common.failureIn", lang)}: <span className="font-semibold text-foreground tabular-nums">{a.predictedFailureInDays} {t("common.days", lang)}</span></span>
                        <div className="flex gap-2">
                          <Btn variant="outline">{lang === "en" ? "Dismiss" : "تجاهل"}</Btn>
                          <Btn variant="primary">{lang === "en" ? "Create WO" : "إنشاء أمر عمل"}</Btn>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <Section title={lang === "en" ? "Model Performance" : "أداء النموذج"}>
            <div className="space-y-3">
              <PerfRow label={lang === "en" ? "Precision" : "الدقة"} value={92.4} />
              <PerfRow label={lang === "en" ? "Recall" : "الاسترجاع"} value={88.7} />
              <PerfRow label={lang === "en" ? "F1 Score" : "F1"} value={90.5} />
              <PerfRow label={lang === "en" ? "Mean lead time" : "الوقت المتوسط للتنبؤ"} value={73} max={100} suffix="d" />
            </div>
            <div className="text-[11px] muted mt-3 leading-relaxed">
              {lang === "en"
                ? "Trained on 18 months of telemetry across the fleet. 6 component-level models — engine, brakes, tires, battery, cooling, tank — fused via gradient-boosted ensemble."
                : "تم التدريب على بيانات 18 شهرًا من المستشعرات. 6 نماذج لكل مكون رئيسي تُدمج عبر تجميع تعزيزي."}
            </div>
          </Section>

          <Section title={lang === "en" ? "Health vs Vibration" : "الحالة مقابل الاهتزاز"}>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
                  <XAxis dataKey="health" name="Health" stroke="rgb(var(--muted))" fontSize={10} />
                  <YAxis dataKey="vibration" name="Vibration" unit=" mm/s" stroke="rgb(var(--muted))" fontSize={10} />
                  <ZAxis range={[40, 40]} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ background: "rgb(var(--card))", border: "1px solid rgb(var(--border))", borderRadius: 8 }} />
                  <Scatter data={scatter} fill="#0b7eea" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[11px] muted mt-1">{lang === "en" ? "High vibration + low health = high failure risk." : "اهتزاز عالٍ مع حالة منخفضة = خطر عطل عالٍ."}</div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function PerfRow({ label, value, max = 100, suffix = "%" }: { label: string; value: number; max?: number; suffix?: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span>{label}</span>
        <span className="font-medium tabular-nums">{value}{suffix}</span>
      </div>
      <Bar value={value} max={max} tone="ok" />
    </div>
  );
}
