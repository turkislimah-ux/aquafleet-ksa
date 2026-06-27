"use client";

// Project-stacked Trips board (Path B, Cluster 2). Replaces the old flat by-day
// board. Layout, top to bottom:
//   - global KPI row (active projects / pending pushes / running / commission pool)
//   - date picker (defaults today) + day trip count
//   - global "New trip" button (CreateTripForm)
//   - one self-contained card per ACTIVE project: header + 4-column Kanban
//   - a fallback "Direct customer trips" card for trips with no project
// Stage changes funnel through setTripStage, driven by ONE sequential action
// button per card (Start trip -> Mark in transit -> Mark delivered), mirroring the
// demo kanbanCard. Delivered cards show a static "Commission paid" badge. The old
// Move-trip menu is gone. Route-focus click + reporting strip + driver table land
// in later commits.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Plus, Users, Play, ArrowRight, Check, Droplet } from "lucide-react";
import { Btn, Stat } from "@/components/ui";
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

type CustomerOption = { id: string; name: string; default_station: string | null };
type TruckOption = { id: string; plate: string; capacity_m3: number | null; assigned_driver_id: string | null };
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
  assignedCount,
  stationsByKey,
  advancingId,
  onAdvance,
  onManage,
  onAdd,
}: {
  project: ProjectHeader;
  trips: TripRow[];
  assignedCount: number;
  stationsByKey: Record<string, string>;
  advancingId: string | null;
  onAdvance: (tripId: string, to: TripStage) => void;
  onManage: (p: ProjectHeader) => void;
  onAdd: (projectId: string) => void;
}) {
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

  // KPI row — GLOBAL across all projects and all dates (demo behavior).
  const activeProjects = projects.filter((p) => p.status === "active").length;
  const pendingPushes = trips.filter((t) => t.stage === "scheduled").length;
  const running = trips.filter((t) => t.stage === "loading" || t.stage === "in_transit").length;
  const monthKey = new Date().toISOString().slice(0, 7);
  const commissionPool = trips.reduce(
    (sum, t) => (t.delivered_at && t.delivered_at.slice(0, 7) === monthKey ? sum + (t.commission_sar ?? 0) : sum),
    0
  );

  // All trips, split into per-project buckets + a direct-customer bucket.
  // No date filter — the board shows every trip per project (demo behavior).
  const { byProject, directCustomer } = useMemo(() => {
    const m = new Map<string, TripRow[]>();
    const direct: TripRow[] = [];
    for (const t of trips) {
      if (t.project_id) {
        const arr = m.get(t.project_id) ?? [];
        arr.push(t);
        m.set(t.project_id, arr);
      } else {
        direct.push(t);
      }
    }
    return { byProject: m, directCustomer: direct };
  }, [trips]);

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
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Active projects" value={activeProjects} tone="info" />
        <Stat label="Pending pushes" value={pendingPushes} tone={pendingPushes > 0 ? "warn" : "ok"} />
        <Stat label="Running trips" value={running} tone="ok" />
        <Stat label="Commission pool · month" value={formatSar(commissionPool)} tone="ok" />
      </div>

      {/* New Project — Projects tab only, below the KPIs (relocated from the page header). */}
      <div className="flex justify-end mb-4">
        <NewProjectModal drivers={drivers} stations={stations} />
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
