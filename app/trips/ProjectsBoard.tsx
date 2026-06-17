"use client";

// Project-stacked Trips board (Path B, Cluster 2). Replaces the old flat by-day
// board. Layout, top to bottom:
//   - global KPI row (active projects / pending pushes / running / commission pool)
//   - date picker (defaults today) + day trip count
//   - global "New trip" button (CreateTripForm)
//   - one self-contained card per ACTIVE project: header + 4-column Kanban
//   - a fallback "Direct customer trips" card for trips with no project
// Stage changes still funnel through setTripStage (card click -> move menu).
// Header buttons (Manage drivers / Add trip) land in Cluster 2 commit 2; the
// report strip + driver table land in Cluster 4; card detail + commission stamp
// land in Cluster 3.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
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
  WATER_TYPE_LABELS,
} from "@/lib/db-types";
import { setTripStage } from "./actions";
import CreateTripForm from "./CreateTripForm";

type TripRow = Trip & {
  linkedName: string;
  truckPlate: string | null;
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
  location: string | null;
  location_lat: number | null;
  location_lng: number | null;
  description: string | null;
};

type CustomerOption = { id: string; name: string; default_station: string | null };
type TruckOption = { id: string; plate: string; capacity_m3: number | null; assigned_driver_id: string | null };
type DriverOption = { id: string; name: string; status: DriverStatus };

// Local YYYY-MM-DD (trip_date is a bare date, so compare in local time).
function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function projectDot(status: ProjectStatus) {
  return status === "active" ? "bg-emerald-500" : status === "paused" ? "bg-amber-500" : "bg-slate-400";
}

function TripCard({ trip, onClick }: { trip: TripRow; onClick: () => void }) {
  const s = STAGE_STYLES[trip.stage];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "card p-3 text-sm w-full text-start transition hover:shadow-soft hover:-translate-y-px",
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
        </span>
      </div>
      <div className="text-xs mt-1">
        {trip.driverName ?? <span className="muted">Unassigned driver</span>}
      </div>
      <div className="text-xs muted mt-1">
        {trip.water_station} · {WATER_TYPE_LABELS[trip.water_type]}
      </div>
    </button>
  );
}

function ProjectCard({
  project,
  trips,
  assignedCount,
  onCardClick,
}: {
  project: ProjectHeader;
  trips: TripRow[];
  assignedCount: number;
  onCardClick: (t: TripRow) => void;
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
        {/* Right-side buttons (Manage drivers / Add trip) land in commit 2. */}
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
                  cards.map((t) => <TripCard key={t.id} trip={t} onClick={() => onCardClick(t)} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ProjectsBoard({
  trips,
  projects,
  customers,
  trucks,
  drivers,
  assignmentsByProject,
}: {
  trips: TripRow[];
  projects: ProjectHeader[];
  customers: CustomerOption[];
  trucks: TruckOption[];
  drivers: DriverOption[];
  assignmentsByProject: Record<string, string[]>;
}) {
  const router = useRouter();
  const [date, setDate] = useState<string>(todayISO());
  const [menuTrip, setMenuTrip] = useState<TripRow | null>(null);
  const [saving, setSaving] = useState<TripStage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // KPI row — GLOBAL across all projects and all dates (demo behavior).
  const activeProjects = projects.filter((p) => p.status === "active").length;
  const pendingPushes = trips.filter((t) => t.stage === "scheduled").length;
  const running = trips.filter((t) => t.stage === "loading" || t.stage === "in_transit").length;
  const monthKey = new Date().toISOString().slice(0, 7);
  const commissionPool = trips.reduce(
    (sum, t) => (t.delivered_at && t.delivered_at.slice(0, 7) === monthKey ? sum + (t.commission_sar ?? 0) : sum),
    0
  );

  // Selected-day trips, split into per-project buckets + a direct-customer bucket.
  const { byProject, directCustomer, dayCount } = useMemo(() => {
    const dayTrips = trips.filter((t) => t.trip_date === date);
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
    return { byProject: m, directCustomer: direct, dayCount: dayTrips.length };
  }, [trips, date]);

  const activeList = projects.filter((p) => p.status === "active");

  function openMenu(trip: TripRow) {
    setError(null);
    setMenuTrip(trip);
  }
  function closeMenu() {
    setMenuTrip(null);
    setSaving(null);
  }

  async function pickStage(stage: TripStage) {
    if (!menuTrip || stage === menuTrip.stage) return;
    setSaving(stage);
    setError(null);
    const res = await setTripStage(menuTrip.id, stage);
    setSaving(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    closeMenu();
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

      {/* Date navigation */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value || todayISO())}
          className="px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
          style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
        />
        <span className="text-sm muted">
          {dayCount} {dayCount === 1 ? "trip" : "trips"} on this day
        </span>
      </div>

      {/* Global new-trip button (per-project Add trip lands in commit 2). */}
      <CreateTripForm projects={projects} customers={customers} trucks={trucks} drivers={drivers} />

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
              onCardClick={openMenu}
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
                          cards.map((t) => <TripCard key={t.id} trip={t} onClick={() => openMenu(t)} />)
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

      {/* Move-trip menu (stage change funnel) */}
      {menuTrip && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={closeMenu}>
          <div className="card p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Move trip</h2>
            <p className="text-sm muted mt-1 mb-4">
              {menuTrip.ref ?? menuTrip.linkedName} · {menuTrip.water_station}
            </p>

            <div className="space-y-2">
              {STAGE_ORDER.map((stage) => {
                const s = STAGE_STYLES[stage];
                const current = stage === menuTrip.stage;
                return (
                  <button
                    key={stage}
                    type="button"
                    disabled={current || saving !== null}
                    onClick={() => pickStage(stage)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-sm flex items-center justify-between transition",
                      current ? "opacity-60 cursor-default" : "hover:bg-black/5 dark:hover:bg-white/5"
                    )}
                    style={{ borderColor: "rgb(var(--border))" }}
                  >
                    <span className="inline-flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", s.dot)} />
                      {TRIP_STAGE_LABELS[stage]}
                    </span>
                    {current ? (
                      <span className="text-xs muted">Current</span>
                    ) : saving === stage ? (
                      <span className="text-xs muted">Saving…</span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {error && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{error}</p>}

            <div className="flex justify-end mt-4">
              <Btn variant="outline" onClick={closeMenu}>
                Cancel
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
