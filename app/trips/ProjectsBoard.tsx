"use client";

// Project-stacked Trips board (Path B, Cluster 2). DAY-SCOPED: a weekly calendar
// strip at the top selects a single day; the KPIs and every project Kanban are
// filtered to that day. Layout, top to bottom:
//   - week calendar strip (Sun→Sat day cards, ‹ › week nav, today highlight,
//     per-day project pills) — selects the active day
//   - KPI row, scoped to the selected day (distinct projects today / pending /
//     running / commission earned on the day)
//   - "New Project" button (CreateTripForm's per-project "Add trip" pre-fills the
//     selected day as the trip date)
//   - one self-contained card per ACTIVE project: header + 4-column Kanban,
//     showing only that day's trips
//   - a fallback "Direct customer trips" card for trips with no project
// The single day-filter point is `dayTrips` (trip_date === selectedDay), which
// feeds both the KPIs and the per-project grouping. Stage columns and ProjectCard
// internals are unchanged — they just receive fewer trips. Stage changes funnel
// through setTripStage (Start trip -> Mark in transit -> Mark delivered).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MapPin, Plus, Users, Play, ArrowRight, Check, Droplet, ChevronLeft, ChevronRight, Calendar, History,
} from "lucide-react";
import { Btn, Stat, StatusPill, Table, TH, TD } from "@/components/ui";
import { cn, formatSar } from "@/lib/utils";
import {
  type Trip,
  type TripStage,
  type WaterType,
  type CommissionMode,
  type ProjectStatus,
  type DriverStatus,
  STAGE_ORDER,
  STAGE_STYLES,
  TRIP_STAGE_LABELS,
  DRIVER_STATUS_LABELS,
} from "@/lib/db-types";
import { setTripStage } from "./actions";
import CreateTripForm from "./CreateTripForm";
import NewProjectModal from "./NewProjectModal";
import ManageDriversModal from "../projects/ManageDriversModal";

type TripRow = Trip & {
  linkedName: string;
  truckPlate: string | null;
  truckCapacityM3: number | null;
  driverName: string | null;
};

type ProjectHeader = {
  id: string;
  name: string;
  customer_id: string;
  rate_per_trip_sar: number;
  commission_mode: CommissionMode;
  commission_value: number;
  commission_bump_pct: number;
  status: ProjectStatus;
  water_type: WaterType | null;
  default_station: string | null;
  default_water_station: string;
  location: string | null;
  location_lat: number | null;
  location_lng: number | null;
  description: string | null;
};

// Anchored-to-today delivery counts per project (Today / 7 / 30 / 90 windows).
// Revenue is derived in the card (count × the project's rate), so only counts
// travel as a prop.
type ProjectReport = { dayN: number; weekN: number; monthN: number; quarterN: number };
const EMPTY_REPORT: ProjectReport = { dayN: 0, weekN: 0, monthN: 0, quarterN: 0 };

// One row of the per-project driver summary. trips/commission are DAY-SCOPED
// (selectedDay); lastTripDate is all-time (most recent trip_date on the project).
type DriverRow = {
  id: string;
  name: string;
  status: DriverStatus;
  truckPlate: string | null;
  tripsDay: number;
  commissionDay: number;
  lastTripDate: string | null;
};

type CustomerOption = {
  id: string;
  name: string;
  default_station: string | null;
  delivery_site_address: string | null;
  customer_type: string;
  contact_name: string | null;
  phone: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
};
type TruckOption = { id: string; plate: string; capacity_m3: number | null; assigned_driver_id: string | null; last_service_date: string | null };
type DriverOption = { id: string; name: string; status: DriverStatus };

function projectDot(status: ProjectStatus) {
  return status === "active" ? "bg-emerald-500" : status === "paused" ? "bg-amber-500" : "bg-slate-400";
}

// Compact phase stamp "25 Jun · 14:32" (mirrors the demo's fmtPhaseStamp). "—" when
// the timestamp is absent. Full timestamptz values render exact; the date-only
// trip_date fallback (a never-stamped scheduled trip) shows a midnight-ish time.
function fmtPhaseStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} · ${time}`;
}

// --- Day-calendar helpers. All keys are local "YYYY-MM-DD" (matches the trips
// trip_date date column, which is TZ-free). Using local components (not
// toISOString, which is UTC) keeps "today" aligned with the user's clock. -------
const WEEKDAY_LBL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d); // local midnight, not UTC
}
function addDays(key: string, n: number): string {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
function weekStartOf(key: string): string {
  const d = parseKey(key);
  d.setDate(d.getDate() - d.getDay()); // back to Sunday
  return dayKey(d);
}

// Deterministic decorative pill color per project id (hash → fixed palette).
// Same id => same color forever. No status meaning, no legend.
const PILL_PALETTE = [
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  "bg-lime-500/15 text-lime-700 dark:text-lime-300",
  "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
  "bg-teal-500/15 text-teal-700 dark:text-teal-300",
];
function pillColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PILL_PALETTE[h % PILL_PALETTE.length];
}

// Driver-avatar initials (first + last word). Mirrors the demo's initials().
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
// "30 Jun 2026" from a local YYYY-MM-DD key (parseKey keeps it local, no TZ shift).
function fmtDayKey(key: string): string {
  const d = parseKey(key);
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

const ACTION_BTN =
  "w-full mt-2 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition disabled:opacity-60";

function TripCard({
  trip,
  ratePerTrip,
  stationName,
  busy,
  onAdvance,
}: {
  trip: TripRow;
  ratePerTrip: number;
  stationName: string | null;
  busy: boolean;
  onAdvance: (to: TripStage) => void;
}) {
  const s = STAGE_STYLES[trip.stage];
  // Demo: t.tankSizeM3 || truck.capacityM3. Trip's own tank size wins; truck capacity is the fallback.
  const tankSize = trip.tank_size_m3 ?? trip.truckCapacityM3 ?? null;

  // Phase-timestamp rows — status-specific, mirrors the demo's phaseRows. Loading
  // additionally shows the fill station (resolved key -> name upstream).
  let phaseRows: React.ReactNode = null;
  if (trip.stage === "scheduled") {
    phaseRows = (
      <div className="text-xs mt-1">
        <span className="muted">Scheduled:</span>{" "}
        <span className="tabular-nums">{fmtPhaseStamp(trip.scheduled_at ?? trip.trip_date)}</span>
      </div>
    );
  } else if (trip.stage === "loading") {
    phaseRows = (
      <>
        <div className="text-xs mt-1">
          <span className="muted">Loading since:</span>{" "}
          <span className="tabular-nums">
            {fmtPhaseStamp(trip.loading_at ?? trip.scheduled_at ?? trip.trip_date)}
          </span>
        </div>
        {stationName && (
          <div className="text-xs mt-1 flex items-center gap-1">
            <Droplet className="h-3 w-3 text-brand-500 shrink-0" />
            Fill at: <b className="truncate">{stationName}</b>
          </div>
        )}
      </>
    );
  } else if (trip.stage === "in_transit") {
    phaseRows = (
      <div className="text-xs mt-1">
        <span className="muted">In transit since:</span>{" "}
        <span className="tabular-nums">
          {fmtPhaseStamp(trip.in_transit_at ?? trip.loading_at ?? trip.trip_date)}
        </span>
      </div>
    );
  } else if (trip.stage === "delivered") {
    phaseRows = (
      <div className="text-xs mt-1">
        <span className="muted">Delivered:</span>{" "}
        <span className="tabular-nums">{fmtPhaseStamp(trip.delivered_at ?? trip.trip_date)}</span>
      </div>
    );
  }

  // Contextual action — ONE sequential step, mirrors the demo's action(). Delivered
  // is a static "Commission paid +<rate/trip>" badge (no action), matching the demo.
  let action: React.ReactNode = null;
  if (trip.stage === "scheduled") {
    action = (
      <button
        type="button"
        disabled={busy}
        onClick={() => onAdvance("loading")}
        className={cn(ACTION_BTN, "bg-brand-600 hover:bg-brand-700 text-white")}
      >
        <Play className="h-3.5 w-3.5" /> {busy ? "…" : "Start trip"}
      </button>
    );
  } else if (trip.stage === "loading") {
    action = (
      <button
        type="button"
        disabled={busy}
        onClick={() => onAdvance("in_transit")}
        className={cn(ACTION_BTN, "border hover:bg-black/5 dark:hover:bg-white/5")}
        style={{ borderColor: "rgb(var(--border))" }}
      >
        <ArrowRight className="h-3.5 w-3.5" /> {busy ? "…" : "Mark in transit"}
      </button>
    );
  } else if (trip.stage === "in_transit") {
    action = (
      <button
        type="button"
        disabled={busy}
        onClick={() => onAdvance("delivered")}
        className={cn(ACTION_BTN, "bg-emerald-600 hover:bg-emerald-700 text-white")}
      >
        <Check className="h-3.5 w-3.5" /> {busy ? "…" : "Mark delivered"}
      </button>
    );
  } else if (trip.stage === "delivered") {
    action = (
      <span className={cn(ACTION_BTN, "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 cursor-default")}>
        <Check className="h-3.5 w-3.5" /> Commission paid +{formatSar(ratePerTrip)}
      </span>
    );
  }

  return (
    <div
      className={cn(
        "card p-3 text-sm w-full text-start",
        s.card,
        trip.stage === "delivered" && "opacity-[0.85]"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold">
          {trip.ref ?? <span className="muted font-sans">No ref</span>}
        </span>
        <span className="font-mono text-xs muted truncate">
          {trip.truckPlate ?? "—"}
          {tankSize ? ` · ${tankSize}m³` : ""}
        </span>
      </div>
      <div className="text-xs mt-1">
        {trip.driverName ?? <span className="muted">—</span>}
      </div>
      {phaseRows}
      {action}
    </div>
  );
}

function ProjectCard({
  project,
  trips,
  report,
  driverRows,
  assignedCount,
  stationsByKey,
  advancingId,
  onAdvance,
  onManage,
  onAdd,
}: {
  project: ProjectHeader;
  trips: TripRow[];
  report: ProjectReport;
  driverRows: DriverRow[];
  assignedCount: number;
  stationsByKey: Record<string, string>;
  advancingId: string | null;
  onAdvance: (tripId: string, to: TripStage) => void;
  onManage: (p: ProjectHeader) => void;
  onAdd: (projectId: string) => void;
}) {
  // Deliveries report tiles — count primary, revenue (count × rate) secondary.
  // Counts are anchored to today (computed in the parent), NOT the selected day.
  const rate = project.rate_per_trip_sar;
  const reportTiles: { label: string; count: number }[] = [
    { label: "Today", count: report.dayN },
    { label: "Last 7 days", count: report.weekN },
    { label: "Last 30 days", count: report.monthN },
    { label: "Last 90 days", count: report.quarterN },
  ];
  return (
    <div className="card p-4">
      {/* Header (block A) */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", projectDot(project.status))} />
            <h3 className="text-base font-semibold truncate">{project.name}</h3>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs muted flex-wrap">
            <span className="font-mono">#{project.id.slice(0, 8)}</span>
            {project.location && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {project.location}
                </span>
              </>
            )}
            <span>·</span>
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
              style={{ borderColor: "rgb(var(--border))" }}
            >
              Rate / trip <b>{formatSar(project.rate_per_trip_sar)}</b>
            </span>
            <span>·</span>
            <span>{assignedCount} {assignedCount === 1 ? "driver" : "drivers"}</span>
          </div>
        </div>
        <div className="inline-flex gap-2 shrink-0">
          <Btn variant="outline" onClick={() => onManage(project)}>
            <Users className="h-3.5 w-3.5" /> Manage drivers
          </Btn>
          <Btn variant="primary" onClick={() => onAdd(project.id)}>
            <Plus className="h-3.5 w-3.5" /> Add trip
          </Btn>
        </div>
      </div>
      {project.description && <p className="text-sm muted mt-2">{project.description}</p>}

      {/* Deliveries report strip (block B) — all 4 windows at once, anchored to
          today (independent of the selected calendar day). Mirrors the demo's
          reportingStrip; our addition = a revenue line under each count. */}
      <div
        className="mt-4 rounded-lg border grid grid-cols-2 md:grid-cols-[auto_repeat(4,minmax(0,1fr))] items-center gap-y-2 px-3 py-2"
        style={{ borderColor: "rgb(var(--border))", background: "rgba(11,126,234,0.03)" }}
      >
        <div className="col-span-2 md:col-span-1 inline-flex items-center gap-1.5 pe-3 text-xs font-semibold muted">
          <History className="h-4 w-4 text-brand-600 dark:text-brand-400 shrink-0" />
          Deliveries report
        </div>
        {reportTiles.map((t) => (
          <div
            key={t.label}
            className="flex flex-col items-start gap-0.5 px-3 border-s"
            style={{ borderColor: "rgb(var(--border))" }}
          >
            <span className="text-[10px] uppercase tracking-wide font-semibold muted">{t.label}</span>
            <span className="text-lg font-bold tabular-nums leading-none">{t.count}</span>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 tabular-nums">
              {formatSar(t.count * rate)}
            </span>
          </div>
        ))}
      </div>

      {/* Kanban (block C) */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {STAGE_ORDER.map((stage) => {
          let cards = trips.filter((t) => t.stage === stage);
          if (stage === "delivered") {
            cards = [...cards]
              .sort((a, b) => (b.delivered_at ?? "").localeCompare(a.delivered_at ?? ""))
              .slice(0, 6);
          }
          const s = STAGE_STYLES[stage];
          return (
            <div key={stage} className="rounded-lg p-2" style={{ background: "rgb(var(--bg))" }}>
              <div
                className={cn(
                  "flex items-center justify-between rounded-md px-2 py-1 text-xs font-medium mb-2 ring-1 ring-inset",
                  s.chip
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
                  {TRIP_STAGE_LABELS[stage]}
                </span>
                <span className="rounded-full bg-black/5 dark:bg-white/10 px-1.5">{cards.length}</span>
              </div>
              <div className="space-y-2 max-h-[22rem] overflow-y-auto scrollbar-thin">
                {cards.length === 0 ? (
                  <div className="text-center muted text-xs py-4">—</div>
                ) : (
                  cards.map((t) => (
                    <TripCard
                      key={t.id}
                      trip={t}
                      ratePerTrip={t.commission_sar ?? project.rate_per_trip_sar}
                      stationName={stationsByKey[t.water_station] ?? t.water_station}
                      busy={advancingId === t.id}
                      onAdvance={(to) => onAdvance(t.id, to)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Driver summary (block D) — assigned drivers; trips + commission scoped to
          the SELECTED day (moves with the calendar); last trip is all-time.
          Mirrors the demo's driverSummaryTable. */}
      <div className="mt-4 rounded-lg border overflow-hidden" style={{ borderColor: "rgb(var(--border))" }}>
        <div
          className="flex items-center gap-2 px-3 py-2 border-b"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="font-semibold text-sm">Drivers operating this project</span>
          <span className="muted text-xs ms-auto">
            {driverRows.length} {driverRows.length === 1 ? "driver" : "drivers"}
          </span>
        </div>
        {driverRows.length === 0 ? (
          <p className="muted text-sm p-3 text-center">No drivers assigned.</p>
        ) : (
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>Driver</TH>
                <TH>Truck</TH>
                <TH>Duty status</TH>
                <TH>Trips (day)</TH>
                <TH>Commission (day)</TH>
                <TH>Last trip</TH>
              </tr>
            </thead>
            <tbody>
              {driverRows.map((r) => (
                <tr key={r.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                  <TD>
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full bg-brand-600 text-white grid place-items-center text-[11px] font-semibold shrink-0">
                        {initials(r.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{r.name}</div>
                        <div className="text-[11px] muted font-mono truncate">#{r.id.slice(0, 8)}</div>
                      </div>
                    </div>
                  </TD>
                  <TD className="font-mono text-xs">
                    {r.truckPlate ?? <span className="muted">—</span>}
                  </TD>
                  <TD>
                    <StatusPill status={r.status} label={DRIVER_STATUS_LABELS[r.status]} />
                  </TD>
                  <TD className="tabular-nums font-medium">{r.tripsDay}</TD>
                  <TD className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatSar(r.commissionDay)}
                  </TD>
                  <TD className="text-xs">
                    {r.lastTripDate ? fmtDayKey(r.lastTripDate) : <span className="muted">—</span>}
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
}

export type ProjectsBoardProps = {
  trips: TripRow[];
  projects: ProjectHeader[];
  customers: CustomerOption[];
  trucks: TruckOption[];
  drivers: DriverOption[];
  assignmentsByProject: Record<string, string[]>;
  stationsByKey: Record<string, string>;
  stations: { key: string; name: string }[];
};

export default function ProjectsBoard({
  trips,
  projects,
  customers,
  trucks,
  drivers,
  assignmentsByProject,
  stationsByKey,
  stations,
}: ProjectsBoardProps) {
  const router = useRouter();
  const [advancingId, setAdvancingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<ProjectHeader | null>(null);
  const [addTripProjectId, setAddTripProjectId] = useState<string | null>(null);

  // Calendar state — selected day + the visible week (Sunday key). Default today.
  const todayKey = dayKey(new Date());
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [weekStart, setWeekStart] = useState(() => weekStartOf(todayKey));

  // THE single day-filter point — everything below scopes to this.
  const dayTrips = useMemo(() => trips.filter((t) => t.trip_date === selectedDay), [trips, selectedDay]);

  // KPI row — all scoped to the selected day. Commission is the ONE asymmetry:
  // it counts trips DELIVERED that day (delivered_at's local date), not trip_date.
  const activeProjects = useMemo(
    () => new Set(dayTrips.filter((t) => t.project_id).map((t) => t.project_id)).size,
    [dayTrips]
  );
  const pendingPushes = dayTrips.filter((t) => t.stage === "scheduled").length;
  const running = dayTrips.filter((t) => t.stage === "loading" || t.stage === "in_transit").length;
  const commissionDay = useMemo(
    () =>
      trips.reduce(
        (sum, t) =>
          t.delivered_at && dayKey(new Date(t.delivered_at)) === selectedDay
            ? sum + (t.commission_sar ?? 0)
            : sum,
        0
      ),
    [trips, selectedDay]
  );

  // Deliveries report per project — Today / 7 / 30 / 90 windows, anchored to
  // TODAY (delivered_at's local date), independent of selectedDay. Counts only;
  // revenue is derived in the card. Window bounds are local YYYY-MM-DD keys, so
  // lexicographic string compare == chronological compare.
  const reportByProject = useMemo(() => {
    const w7 = addDays(todayKey, -6);
    const w30 = addDays(todayKey, -29);
    const w90 = addDays(todayKey, -89);
    const m = new Map<string, ProjectReport>();
    for (const t of trips) {
      if (!t.project_id || !t.delivered_at) continue;
      const dk = dayKey(new Date(t.delivered_at));
      if (dk > todayKey) continue; // future-dated delivery (shouldn't happen) — ignore
      const cur = m.get(t.project_id) ?? { dayN: 0, weekN: 0, monthN: 0, quarterN: 0 };
      if (dk === todayKey) cur.dayN += 1;
      if (dk >= w7) cur.weekN += 1;
      if (dk >= w30) cur.monthN += 1;
      if (dk >= w90) cur.quarterN += 1;
      m.set(t.project_id, cur);
    }
    return m;
  }, [trips, todayKey]);

  // Driver summary rows per project. trips/commission are scoped to selectedDay
  // (so the table moves with the calendar); lastTripDate is all-time. Assigned
  // drivers always appear, even with zero trips that day.
  const driverRowsByProject = useMemo(() => {
    const truckByDriver = new Map<string, string>();
    for (const tr of trucks) if (tr.assigned_driver_id) truckByDriver.set(tr.assigned_driver_id, tr.plate);
    const driverById = new Map(drivers.map((d) => [d.id, d] as const));

    // Aggregate per project|driver from the FULL trip set in one pass.
    type Agg = { tripsDay: number; commissionDay: number; lastTripDate: string | null };
    const agg = new Map<string, Agg>();
    for (const t of trips) {
      if (!t.project_id || !t.driver_id) continue;
      const key = `${t.project_id}|${t.driver_id}`;
      let a = agg.get(key);
      if (!a) {
        a = { tripsDay: 0, commissionDay: 0, lastTripDate: null };
        agg.set(key, a);
      }
      if (t.trip_date === selectedDay) {
        a.tripsDay += 1;
        a.commissionDay += t.commission_sar ?? 0;
      }
      if (t.trip_date && (a.lastTripDate === null || t.trip_date > a.lastTripDate)) {
        a.lastTripDate = t.trip_date;
      }
    }

    const m = new Map<string, DriverRow[]>();
    for (const p of projects) {
      const ids = assignmentsByProject[p.id] ?? [];
      const rows: DriverRow[] = [];
      for (const id of ids) {
        const d = driverById.get(id);
        if (!d) continue; // mirror demo's filter(Boolean) on missing drivers
        const a = agg.get(`${p.id}|${id}`);
        rows.push({
          id,
          name: d.name,
          status: d.status,
          truckPlate: truckByDriver.get(id) ?? null,
          tripsDay: a?.tripsDay ?? 0,
          commissionDay: a?.commissionDay ?? 0,
          lastTripDate: a?.lastTripDate ?? null,
        });
      }
      m.set(p.id, rows);
    }
    return m;
  }, [trips, selectedDay, drivers, trucks, assignmentsByProject, projects]);

  // driver_id -> [project name…] for the project form's driver roster (which
  // projects each driver already serves). Inverts assignmentsByProject + names.
  const driverProjectNames = useMemo(() => {
    const nameById = new Map(projects.map((p) => [p.id, p.name] as const));
    const m: Record<string, string[]> = {};
    for (const [pid, ids] of Object.entries(assignmentsByProject)) {
      const name = nameById.get(pid);
      if (!name) continue;
      for (const did of ids) (m[did] ??= []).push(name);
    }
    return m;
  }, [projects, assignmentsByProject]);

  // Per-day distinct project pills for the calendar strip (across ALL trips, not
  // just the selected day). Keyed by trip_date; only projects present in `projects`.
  const projectsByDay = useMemo(() => {
    const nameById = new Map(projects.map((p) => [p.id, p.name] as const));
    const seen = new Map<string, Set<string>>();
    const m = new Map<string, { id: string; name: string }[]>();
    for (const t of trips) {
      if (!t.project_id || !t.trip_date) continue;
      const name = nameById.get(t.project_id);
      if (!name) continue;
      let set = seen.get(t.trip_date);
      if (!set) {
        set = new Set();
        seen.set(t.trip_date, set);
      }
      if (set.has(t.project_id)) continue;
      set.add(t.project_id);
      const arr = m.get(t.trip_date) ?? [];
      arr.push({ id: t.project_id, name });
      m.set(t.trip_date, arr);
    }
    return m;
  }, [trips, projects]);

  // Right-header label: selected day relative to TODAY. Real date math via
  // addDays (parseKey → Date.setDate), so month/year boundaries roll correctly.
  const selectedDayLabel = useMemo(() => {
    if (selectedDay === todayKey) return "Today";
    if (selectedDay === addDays(todayKey, -1)) return "Yesterday";
    if (selectedDay === addDays(todayKey, 1)) return "Tomorrow";
    const d = parseKey(selectedDay);
    return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
  }, [selectedDay, todayKey]);

  // The 7 visible day cells (Sun→Sat) for the current week.
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const key = addDays(weekStart, i);
      const d = parseKey(key);
      return { key, dow: d.getDay(), dayNum: d.getDate(), month: d.getMonth() };
    });
  }, [weekStart]);

  // "22 – 28 Jun 2026" style range label for the week header.
  const weekRangeLabel = useMemo(() => {
    const first = weekDays[0];
    const last = weekDays[6];
    const y = parseKey(last.key).getFullYear();
    const span =
      first.month === last.month
        ? `${first.dayNum} – ${last.dayNum} ${MONTH_SHORT[last.month]}`
        : `${first.dayNum} ${MONTH_SHORT[first.month]} – ${last.dayNum} ${MONTH_SHORT[last.month]}`;
    return `${span} ${y}`;
  }, [weekDays]);

  // Day-scoped: split THIS DAY's trips into per-project buckets + a direct bucket.
  const { byProject, directCustomer } = useMemo(() => {
    const m = new Map<string, TripRow[]>();
    const direct: TripRow[] = [];
    for (const t of dayTrips) {
      if (t.project_id) {
        const arr = m.get(t.project_id) ?? [];
        arr.push(t);
        m.set(t.project_id, arr);
      } else {
        direct.push(t);
      }
    }
    return { byProject: m, directCustomer: direct };
  }, [dayTrips]);

  const activeList = projects.filter((p) => p.status === "active");

  // Sequential, one-step advance (Start trip / Mark in transit / Mark delivered).
  // Funnels through setTripStage, which stamps the *_at column and commission on delivered.
  async function advance(tripId: string, to: TripStage) {
    setAdvancingId(tripId);
    setError(null);
    const res = await setTripStage(tripId, to);
    setAdvancingId(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {/* Week calendar strip — Sun→Sat day cards; selects the active day. */}
      <div className="card p-4 mb-4">
        {/* Three-part header: title (left) · week-of pill (center) · nav (right) */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <Calendar className="h-4 w-4 text-brand-600 dark:text-brand-400 shrink-0" />
            <span className="text-sm font-semibold truncate">Project Calendar</span>
          </div>
          <div className="flex-1 flex items-center justify-center gap-1.5">
            <Btn variant="outline" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">
              <ChevronLeft className="h-4 w-4" />
            </Btn>
            <span
              className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium tabular-nums"
              style={{ borderColor: "rgb(var(--border))" }}
            >
              <span className="muted me-1">Week of</span>
              {weekRangeLabel}
            </span>
            <Btn variant="outline" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">
              <ChevronRight className="h-4 w-4" />
            </Btn>
          </div>
          <span className="text-sm font-medium muted shrink-0 tabular-nums">{selectedDayLabel}</span>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map((d) => {
            const isToday = d.key === todayKey;
            const isSelected = d.key === selectedDay;
            const pills = projectsByDay.get(d.key) ?? [];
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => setSelectedDay(d.key)}
                className={cn(
                  "rounded-lg border p-2.5 text-start transition min-h-[9rem] flex flex-col",
                  isSelected
                    ? "border-brand-500 ring-1 ring-brand-500 bg-brand-500/5"
                    : "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                )}
                style={!isSelected ? { borderColor: "rgb(var(--border))" } : undefined}
              >
                {/* Inline day header: "SUN 9" + Today tag */}
                <div className="flex items-baseline justify-between gap-1">
                  <span className="inline-flex items-baseline gap-1.5 min-w-0">
                    <span className="text-[10px] font-semibold uppercase tracking-wide muted">
                      {WEEKDAY_LBL[d.dow]}
                    </span>
                    <span className="text-lg font-semibold tabular-nums leading-none">{d.dayNum}</span>
                  </span>
                  {isToday && (
                    <span className="text-[10px] font-medium text-brand-600 dark:text-brand-400 shrink-0">
                      Today
                    </span>
                  )}
                </div>
                {/* Pills stacked vertically, each full-width on its own row */}
                <div className="mt-2 flex flex-col gap-1">
                  {pills.slice(0, 3).map((p) => (
                    <span
                      key={p.id}
                      title={p.name}
                      className={cn(
                        "block w-full rounded px-1.5 py-0.5 text-[9px] font-medium truncate",
                        pillColor(p.id)
                      )}
                    >
                      {p.name}
                    </span>
                  ))}
                  {pills.length > 3 && (
                    <span className="block w-full text-[9px] muted px-1.5 py-0.5">+{pills.length - 3} more</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* KPI row — scoped to the selected day. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Active projects (day)" value={activeProjects} tone="info" />
        <Stat label="Pending pushes (day)" value={pendingPushes} tone={pendingPushes > 0 ? "warn" : "ok"} />
        <Stat label="Running trips (day)" value={running} tone="ok" />
        <Stat label="Commission (day)" value={formatSar(commissionDay)} tone="ok" />
      </div>

      {/* New Project — Projects tab only, below the KPIs (relocated from the page header). */}
      <div className="flex justify-end mb-4">
        <NewProjectModal
          drivers={drivers}
          trucks={trucks}
          driverProjectNames={driverProjectNames}
          stations={stations}
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* New-trip modal: own button = global; openForProject = per-project "Add trip". */}
      <CreateTripForm
        projects={projects}
        customers={customers}
        trucks={trucks}
        drivers={drivers}
        stations={stations}
        openForProject={addTripProjectId}
        onCloseControlled={() => setAddTripProjectId(null)}
        defaultDate={selectedDay}
      />

      {/* Project-stacked board */}
      {activeList.length === 0 && directCustomer.length === 0 ? (
        <div className="card p-6 text-center muted text-sm">No active projects yet.</div>
      ) : (
        <div className="space-y-5">
          {activeList.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              trips={byProject.get(p.id) ?? []}
              report={reportByProject.get(p.id) ?? EMPTY_REPORT}
              driverRows={driverRowsByProject.get(p.id) ?? []}
              assignedCount={(assignmentsByProject[p.id] ?? []).length}
              stationsByKey={stationsByKey}
              advancingId={advancingId}
              onAdvance={advance}
              onManage={setManaging}
              onAdd={setAddTripProjectId}
            />
          ))}

          {directCustomer.length > 0 && (
            <div className="card p-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-400 shrink-0" />
                <h3 className="text-base font-semibold">Direct customer trips</h3>
              </div>
              <p className="text-xs muted mt-1">Trips not tied to a project.</p>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {STAGE_ORDER.map((stage) => {
                  let cards = directCustomer.filter((t) => t.stage === stage);
                  if (stage === "delivered") {
                    cards = [...cards]
                      .sort((a, b) => (b.delivered_at ?? "").localeCompare(a.delivered_at ?? ""))
                      .slice(0, 6);
                  }
                  const s = STAGE_STYLES[stage];
                  return (
                    <div key={stage} className="rounded-lg p-2" style={{ background: "rgb(var(--bg))" }}>
                      <div
                        className={cn(
                          "flex items-center justify-between rounded-md px-2 py-1 text-xs font-medium mb-2 ring-1 ring-inset",
                          s.chip
                        )}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
                          {TRIP_STAGE_LABELS[stage]}
                        </span>
                        <span className="rounded-full bg-black/5 dark:bg-white/10 px-1.5">{cards.length}</span>
                      </div>
                      <div className="space-y-2 max-h-[22rem] overflow-y-auto scrollbar-thin">
                        {cards.length === 0 ? (
                          <div className="text-center muted text-xs py-4">—</div>
                        ) : (
                          cards.map((t) => (
                            <TripCard
                              key={t.id}
                              trip={t}
                              ratePerTrip={t.rate_sar ?? 0}
                              stationName={stationsByKey[t.water_station] ?? t.water_station}
                              busy={advancingId === t.id}
                              onAdvance={(to) => advance(t.id, to)}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manage-drivers modal (project_drivers assignment) */}
      {managing && (
        <ManageDriversModal
          project={{ id: managing.id, name: managing.name }}
          drivers={drivers}
          assigned={assignmentsByProject[managing.id] ?? []}
          onClose={() => setManaging(null)}
        />
      )}
    </div>
  );
}
