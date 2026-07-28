"use client";

// Maintenance — forward-looking Sun–Sat week strip. Mirrors preview/'s
// pages-2.js MT.calendar() (lines ~49-167): buckets in-house work orders by
// due_by, excludes completed/cancelled (history lives in the Historical
// tab, not here), tags each line delayed > active > planned, day-click
// selects/deselects a date that filters the table below.
//
// Real-date difference from preview/: preview pins "today" to a fixed demo
// date (new Date(2026,4,13)). This app has real data, so "today" is the
// real local clock (matches lib/utils.ts's todayKey() local-date
// convention elsewhere in this app), not a frozen constant.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Truck, WorkOrder } from "@/lib/db-types";

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekStartOf(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function isWoDelayed(w: WorkOrder): boolean {
  return w.status !== "completed" && w.status !== "cancelled" && new Date(w.due_by).getTime() < Date.now();
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_AR = ["أحد", "اثن", "ثلا", "أرب", "خمي", "جمع", "سبت"];

export default function MaintenanceCalendar({
  lang,
  workOrders,
  trucks,
  truckFilter,
  selectedDate,
  onSelectDate,
  onOpenWorkOrder,
}: {
  lang: "en" | "ar";
  workOrders: WorkOrder[];
  trucks: Truck[];
  truckFilter: string; // "all" | truck id
  selectedDate: string | null;
  onSelectDate: (iso: string | null) => void;
  onOpenWorkOrder: (id: string) => void;
}) {
  const [weekStart, setWeekStart] = useState<Date>(() => weekStartOf(new Date()));

  const trucksById = useMemo(() => {
    const m = new Map<string, Truck>();
    for (const tr of trucks) m.set(tr.id, tr);
    return m;
  }, [trucks]);

  const inHouse = useMemo(
    () =>
      workOrders.filter((w) => {
        if (w.status === "completed" || w.status === "cancelled") return false;
        return truckFilter === "all" || w.truck_id === truckFilter;
      }),
    [workOrders, truckFilter],
  );

  const byDay = useMemo(() => {
    const m = new Map<string, WorkOrder[]>();
    for (const w of inHouse) {
      const k = ymd(new Date(w.due_by));
      const arr = m.get(k) ?? [];
      arr.push(w);
      m.set(k, arr);
    }
    return m;
  }, [inHouse]);

  const cells = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart.getTime());
      d.setDate(weekStart.getDate() + i);
      return { date: d, iso: ymd(d), dow: i };
    });
  }, [weekStart]);

  const todayKey = ymd(new Date());
  const WEEK = lang === "ar" ? WEEKDAYS_AR : WEEKDAYS_EN;
  const MONTHS = lang === "ar" ? MONTHS_AR : MONTHS_EN;
  const monthFmt = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  const weekHeader = `${monthFmt(cells[0].date)} – ${monthFmt(cells[6].date)}, ${cells[0].date.getFullYear()}`;

  let cActive = 0, cPlanned = 0, cDelayed = 0;
  for (const c of cells) {
    for (const w of byDay.get(c.iso) ?? []) {
      if (isWoDelayed(w)) cDelayed++;
      else if (w.status === "in_progress" || w.status === "awaiting_parts") cActive++;
      else if (w.status === "open") cPlanned++;
    }
  }

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-brand-600"><CalendarIcon className="h-4 w-4" /></span>
          <h3 className="font-semibold">{t("mt.calendar", lang)}</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="h-8 w-8 rounded-lg border grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
            style={{ borderColor: "rgb(var(--border))" }}
            onClick={() => setWeekStart((d) => { const n = new Date(d.getTime()); n.setDate(n.getDate() - 7); return n; })}
            title={t("mt.prevWeek", lang)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="px-3 py-1.5 rounded-lg border text-sm font-medium min-w-[180px] text-center" style={{ borderColor: "rgb(var(--border))" }}>
            {t("mt.weekOf", lang)} {weekHeader}
          </div>
          <button
            className="h-8 w-8 rounded-lg border grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
            style={{ borderColor: "rgb(var(--border))" }}
            onClick={() => setWeekStart((d) => { const n = new Date(d.getTime()); n.setDate(n.getDate() + 7); return n; })}
            title={t("mt.nextWeek", lang)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" />{t("mt.weekActive", lang)}: <b className="tabular-nums">{cActive}</b></span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-brand-500 inline-block" />{t("mt.weekPlanned", lang)}: <b className="tabular-nums">{cPlanned}</b></span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-rose-500 inline-block" />{t("mt.weekDelayed", lang)}: <b className="tabular-nums">{cDelayed}</b></span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {cells.map((c) => {
          const items = byDay.get(c.iso) ?? [];
          const sel = c.iso === selectedDate;
          const today = c.iso === todayKey;
          const shown = items.slice(0, 3);
          const more = items.length - shown.length;
          return (
            <div
              key={c.iso}
              onClick={() => onSelectDate(sel ? null : c.iso)}
              className={cn(
                "rounded-lg border p-2 min-h-[110px] cursor-pointer transition",
                today ? "ring-1 ring-brand-500" : "",
                sel ? "bg-brand-500/10" : "hover:bg-black/5 dark:hover:bg-white/5",
              )}
              style={{ borderColor: "rgb(var(--border))" }}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] muted uppercase">{WEEK[c.dow]}</span>
                <span className="text-xs font-semibold tabular-nums">{c.date.getDate()}</span>
              </div>
              {today && <div className="text-[9px] text-brand-600 font-medium mb-1">{lang === "en" ? "Today" : "اليوم"}</div>}
              <div className="space-y-1">
                {shown.map((w) => {
                  const truck = trucksById.get(w.truck_id);
                  const delayed = isWoDelayed(w);
                  const tone = delayed ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" :
                    (w.status === "in_progress" || w.status === "awaiting_parts") ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" :
                    "bg-brand-500/15 text-brand-700 dark:text-brand-300";
                  return (
                    <div
                      key={w.id}
                      onClick={(e) => { e.stopPropagation(); onOpenWorkOrder(w.id); }}
                      className={cn("text-[10px] rounded px-1.5 py-0.5 truncate cursor-pointer", tone)}
                      title={lang === "ar" ? w.title_ar : w.title}
                    >
                      {truck?.id ?? w.truck_id} · {truck?.plate ?? ""}
                    </div>
                  );
                })}
                {items.length === 0 && <div className="text-[10px] muted">{t("mt.weekNoJobs", lang)}</div>}
                {more > 0 && <div className="text-[10px] muted">+{more} {t("mt.moreCount", lang)}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
