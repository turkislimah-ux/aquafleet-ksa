"use client";

// Maintenance — forward-looking Sun–Sat week strip. Mirrors preview/'s
// pages-2.js MT.calendar() (lines ~49-167): excludes completed/cancelled
// (history lives in the Historical tab, not here), tags each line
// overdue > active > planned, day-click selects/deselects a date that
// filters the table below.
//
// BOTH TRACKS BY start_date (OS adjustments batch): in-house work orders
// now place by start_date too, matching outsourced_jobs' own start_date —
// due_by is UNCHANGED and still drives in-house overdue, it just no longer
// decides which day cell a WO lands in. Existing pre-0073 rows have no
// start_date yet (nullable, no backfill) — they fall back to due_by so
// they don't vanish from the calendar entirely until edited.
//
// Real-date difference from preview/: preview pins "today" to a fixed demo
// date (new Date(2026,4,13)). This app has real data, so "today" is the
// real local clock (matches lib/utils.ts's todayKey() local-date
// convention elsewhere in this app), not a frozen constant.
//
// TRACK-SCOPED (Phase-5 fix) — the calendar now reflects ONLY the active
// tab's track, via the `track` prop: in-house tab shows only work orders,
// outsourced tab shows only outsourced jobs, never both overlapping in
// the same day cell. Was showing both tracks unconditionally regardless
// of which tab was open — a real bug, not a design choice.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn, todayKey as todayKeyUtil } from "@/lib/utils";
import type { Truck, WorkOrder, OutsourcedJob } from "@/lib/db-types";

// EXPORTED — MaintenanceClient's own day-filter (Phase-5 fix) must bucket
// a WO by the exact same key the calendar uses to place it, or clicking a
// day shows an empty/wrong list (today's actual bug: the table was still
// filtering by due_by while the calendar had already moved to start_date).
export function woCalendarKey(w: WorkOrder): string {
  return w.start_date ?? ymd(new Date(w.due_by));
}

export function ymd(d: Date): string {
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

function isOsOverdue(j: OutsourcedJob): boolean {
  return j.status !== "completed" && j.estimated_finish < todayKeyUtil();
}

type CalItem =
  | { kind: "wo"; wo: WorkOrder }
  | { kind: "os"; os: OutsourcedJob };

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_AR = ["أحد", "اثن", "ثلا", "أرب", "خمي", "جمع", "سبت"];

export default function MaintenanceCalendar({
  lang,
  track,
  workOrders,
  outsourcedJobs,
  trucks,
  truckFilter,
  selectedDate,
  onSelectDate,
  onOpenWorkOrder,
  onOpenOutsourcedJob,
}: {
  lang: "en" | "ar";
  track: "in_house" | "outsourced";
  workOrders: WorkOrder[];
  outsourcedJobs: OutsourcedJob[];
  trucks: Truck[];
  truckFilter: string; // "all" | truck id
  selectedDate: string | null;
  onSelectDate: (iso: string | null) => void;
  onOpenWorkOrder: (id: string) => void;
  onOpenOutsourcedJob: (id: string) => void;
}) {
  const [weekStart, setWeekStart] = useState<Date>(() => weekStartOf(new Date()));

  const trucksById = useMemo(() => {
    const m = new Map<string, Truck>();
    for (const tr of trucks) m.set(tr.id, tr);
    return m;
  }, [trucks]);

  const inHouse = useMemo(
    () =>
      track !== "in_house" ? [] : workOrders.filter((w) => {
        if (w.status === "completed" || w.status === "cancelled") return false;
        return truckFilter === "all" || w.truck_id === truckFilter;
      }),
    [track, workOrders, truckFilter],
  );

  const outsourced = useMemo(
    () =>
      track !== "outsourced" ? [] : outsourcedJobs.filter((j) => {
        if (j.status === "completed") return false;
        return truckFilter === "all" || j.truck_id === truckFilter;
      }),
    [track, outsourcedJobs, truckFilter],
  );

  const byDay = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    for (const w of inHouse) {
      const k = woCalendarKey(w);
      const arr = m.get(k) ?? [];
      arr.push({ kind: "wo", wo: w });
      m.set(k, arr);
    }
    for (const j of outsourced) {
      const k = j.start_date;
      const arr = m.get(k) ?? [];
      arr.push({ kind: "os", os: j });
      m.set(k, arr);
    }
    return m;
  }, [inHouse, outsourced]);

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
    for (const item of byDay.get(c.iso) ?? []) {
      if (item.kind === "wo") {
        const w = item.wo;
        if (isWoDelayed(w)) cDelayed++;
        else if (w.status === "in_progress" || w.status === "awaiting_parts") cActive++;
        else if (w.status === "open") cPlanned++;
      } else {
        const j = item.os;
        if (isOsOverdue(j)) cDelayed++;
        else if (j.status === "in_progress") cActive++;
        else cPlanned++;
      }
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
        {/* P2 item 2 — legend "bolder": preview's own .cal-pill (a small
            rounded-pill background behind the bullet, font-weight 600,
            not a bare dot) — mirrored here, colored with THIS app's own
            already-established tones (yellow=active, brand=planned,
            rose=delayed) rather than preview's own legend color, which
            is genuinely inconsistent with preview's own day-chip color
            for the same status (preview's legend "Active" swatch is
            amber/.cal-pill-in_progress, but preview's own day-chip for
            the same in_progress status is emerald/.week-active — a real
            mismatch in the demo itself, flagged rather than copied; kept
            this app's single already-consistent yellow-for-active
            convention instead, matching MtStatusPill's in_progress). */}
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center h-[0.95rem] px-1.5 rounded-full text-[10px] font-semibold bg-yellow-400/20 text-yellow-800 dark:text-yellow-300">●</span>
            {t("mt.weekActive", lang)}: <b className="tabular-nums">{cActive}</b>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center h-[0.95rem] px-1.5 rounded-full text-[10px] font-semibold bg-brand-500/20 text-brand-700 dark:text-brand-300">●</span>
            {t("mt.weekPlanned", lang)}: <b className="tabular-nums">{cPlanned}</b>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center h-[0.95rem] px-1.5 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-700 dark:text-rose-300">●</span>
            {t("mt.weekDelayed", lang)}: <b className="tabular-nums">{cDelayed}</b>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {cells.map((c) => {
          const items = byDay.get(c.iso) ?? [];
          const sel = c.iso === selectedDate;
          const today = c.iso === todayKey;
          return (
            <div
              key={c.iso}
              onClick={() => onSelectDate(sel ? null : c.iso)}
              // P2 item 2 — taller card (preview's own .week-day
              // min-height:11rem -> h-44 here, but FIXED not min, so a
              // busy day never stretches the row; overflow goes to the
              // scrollable jobs list below instead, per Turki's explicit
              // "never overflows/stretches the page" ask).
              className={cn(
                "rounded-lg border p-2.5 h-44 flex flex-col gap-1.5 cursor-pointer transition",
                today ? "ring-1 ring-brand-500" : "",
                sel ? "bg-brand-500/10" : "hover:bg-black/5 dark:hover:bg-white/5",
              )}
              style={{ borderColor: "rgb(var(--border))" }}
            >
              {/* Weekday + day-of-month on one baseline (day number bold,
                  bigger) — preview's own .week-day-head/.dow/.dnum shape,
                  this app previously split them justify-between on two
                  ends instead of side by side. "Today" now sits INLINE in
                  this same row, pushed to the end via ms-auto (preview's
                  own margin-inline-start:auto) — top-right of the card,
                  not a separate line underneath like before. */}
              <div className="flex items-baseline gap-1.5 shrink-0">
                <span className="text-[11px] muted uppercase tracking-wide font-semibold">{WEEK[c.dow]}</span>
                <span className="text-base font-bold tabular-nums">{c.date.getDate()}</span>
                {today && <span className="ms-auto text-[10px] font-bold text-brand-600">{lang === "en" ? "Today" : "اليوم"}</span>}
              </div>

              {/* Job list — scrolls internally, no truncate-to-3/"+N more"
                  anymore (that was preview's own workaround for a
                  fixed-height card; a real scroll area does the same job
                  better, per Turki's explicit ask). */}
              {/* Chip text — plate only. Was `{truck?.id ?? w.truck_id} ·
                  {truck?.plate ?? ""}`, a direct port of preview's own
                  markup: preview's MOCK trucks use short human-readable
                  ids like "TRK-001", so showing `.id` there made sense.
                  This app's real trucks table keys every row by UUID
                  (confirmed live) — `.id` was never meant to be shown to
                  a user, exactly the same "id for routing/keys only,
                  plate for display" convention FleetClient.tsx/
                  DriversClient.tsx already follow. Was rendering a raw
                  UUID for every truck, every time, looking like a broken
                  lookup when the truck was actually found correctly. */}
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-1">
                {items.length === 0 && <div className="text-[10px] muted">{t("mt.weekNoJobs", lang)}</div>}
                {items.map((item) => {
                  if (item.kind === "wo") {
                    const w = item.wo;
                    const truck = trucksById.get(w.truck_id);
                    const delayed = isWoDelayed(w);
                    // P2 item 2 — bold solid color segment before the ID
                    // (preview's own .week-line border-inline-start:3px
                    // solid <tone>), this app previously had a flat tint
                    // with no leading segment at all.
                    const tone = delayed ? "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-s-rose-500" :
                      (w.status === "in_progress" || w.status === "awaiting_parts") ? "bg-yellow-400/15 text-yellow-800 dark:text-yellow-300 border-s-yellow-400" :
                      "bg-brand-500/10 text-brand-700 dark:text-brand-300 border-s-brand-500";
                    return (
                      <div
                        key={`wo-${w.id}`}
                        onClick={(e) => { e.stopPropagation(); onOpenWorkOrder(w.id); }}
                        className={cn("text-[10px] rounded px-1.5 py-1 truncate cursor-pointer border-s-[3px]", tone)}
                        title={lang === "ar" ? w.title_ar : w.title}
                      >
                        {truck?.plate ?? w.truck_id}
                      </div>
                    );
                  }
                  const j = item.os;
                  const truck = trucksById.get(j.truck_id);
                  const overdue = isOsOverdue(j);
                  const tone = overdue ? "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-s-rose-500" :
                    j.status === "in_progress" ? "bg-yellow-400/15 text-yellow-800 dark:text-yellow-300 border-s-yellow-400" :
                    "bg-brand-500/10 text-brand-700 dark:text-brand-300 border-s-brand-500";
                  return (
                    <div
                      key={`os-${j.id}`}
                      onClick={(e) => { e.stopPropagation(); onOpenOutsourcedJob(j.id); }}
                      className={cn("text-[10px] rounded px-1.5 py-1 truncate cursor-pointer border-s-[3px]", tone)}
                      title={j.title}
                    >
                      {/* P2 item 2 (spotted, flagged) — preview's own
                          .os-badge is a small solid violet pill before the
                          truck info, not bare bold text like this app had. */}
                      <span className="inline-block align-middle text-[9px] font-bold bg-violet-600 text-white px-1 rounded-sm me-1">OS</span>
                      {truck?.plate ?? j.truck_id}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
