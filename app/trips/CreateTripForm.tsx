"use client";

// Client island: the "New trip" button + modal, wired to createTrip. The modal
// links each trip to EITHER a project or a bare customer; picking a project
// pre-fills water type + station (both still overridable). Count stamps out a
// batch of identical trips in one insert. The board itself lives in TripBoard.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Btn } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  type WaterType,
  WATER_TYPE_LABELS,
  MAX_BATCH_TRIPS,
} from "@/lib/db-types";
import { createTrip } from "./actions";
import { type DriverState, resolveOnLeave } from "@/lib/driver-state";
import { type LeavePeriod } from "@/lib/leave";
import DriverDutyTable from "./DriverDutyTable";

type ProjectOption = {
  id: string;
  name: string;
  water_type: WaterType | null;
  default_water_station: string;
};
type CustomerOption = { id: string; name: string; default_station: string | null };
type StationOption = { key: string; name: string };
type TruckOption = { id: string; plate: string; assigned_driver_id: string | null };
type DriverOption = { id: string; name: string };
// Trip rows needed for the per-driver duty figures. on-duty is day-scoped
// (trip_date), last-delivered is all-time (delivered_at).
type TripLite = {
  driver_id: string | null;
  stage: string;
  trip_date: string | null;
  delivered_at: string | null;
};

type Kind = "project" | "customer";

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ISO timestamp → "DD Mon YYYY" in LOCAL time (matches the app's delivered-day basis).
function fmtDeliveredLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export default function CreateTripForm({
  projects,
  customers,
  trucks,
  drivers,
  trips,
  assignmentsByProject,
  selectedDay,
  stations,
  openForProject,
  onCloseControlled,
  defaultDate,
  driverStateById,
  leavePeriods,
  leaveLoadFailed,
}: {
  projects: ProjectOption[];
  customers: CustomerOption[];
  trucks: TruckOption[];
  drivers: DriverOption[];
  trips: TripLite[];
  assignmentsByProject: Record<string, string[]>;
  // The board's selected calendar day — scopes the duty table's On-Duty count.
  selectedDay: string;
  stations: StationOption[];
  // Derived driver-state map for the duty table's Status pill (display only).
  driverStateById: Record<string, DriverState>;
  // FULL leave periods (any date) — used to gate drivers on leave for the trip day.
  leavePeriods: LeavePeriod[];
  // Fail-safe: leave data failed to load → block everyone in the duty table.
  leaveLoadFailed: boolean;
  // When set (from a project card's "Add trip"), open the modal pre-scoped to
  // that project. Full per-project rework (assigned-driver picker, tank/time)
  // lands in Cluster 5; this just preselects + locks the project.
  openForProject?: string | null;
  onCloseControlled?: () => void;
  // Pre-fill the trip date (the board's selected calendar day). Still editable.
  defaultDate?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Controlled fields needed for project/customer inheritance.
  const [kind, setKind] = useState<Kind>("project");
  const [projectId, setProjectId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [waterType, setWaterType] = useState<WaterType>("potable");
  const [station, setStation] = useState<string>(stations[0]?.key ?? "");
  // Single-select operational driver (null = unassigned). Truck is DERIVED from
  // this driver (one truck per driver) — there is no separate truck selector.
  const [driverId, setDriverId] = useState<string | null>(null);
  // Controlled trip date — seeded from the board's selected day, reseeded when it
  // changes. Free to edit; the manager can still pick any date in the form.
  const [tripDate, setTripDate] = useState<string>(defaultDate ?? "");

  function close() {
    setOpen(false);
    onCloseControlled?.();
  }

  function onPickProject(id: string) {
    setProjectId(id);
    // The visible driver set changes with the project — drop any stale pick.
    setDriverId(null);
    const p = projects.find((x) => x.id === id);
    if (p?.water_type) setWaterType(p.water_type);
    // Trip inherits the project's default water station (a valid lookup key);
    // the driver can still change it in the form.
    if (p?.default_water_station) setStation(p.default_water_station);
  }
  function onPickCustomer(id: string) {
    // Direct-customer trips have no project default; the customer's old
    // free-text default_station is the wrong concept (a depot name, not a
    // water_stations key), so it is NOT used here — keep the chosen lookup key.
    setCustomerId(id);
  }

  // Switch link kind — reset the driver pick (project mode shows assigned drivers,
  // customer mode shows all; a pick from one set may be invalid in the other).
  function pickKind(next: Kind) {
    setKind(next);
    setDriverId(null);
  }

  // Per-driver duty figures. On-duty = undelivered trips on the SELECTED day
  // (trip_date === selectedDay && stage ≠ delivered), across all projects — so the
  // column moves with the calendar. Last-delivered = most recent delivery anywhere
  // (all-time, a historical figure). Keyed by driver_id.
  const dutyByDriver = useMemo(() => {
    const m: Record<string, { onDuty: number; lastDeliveredAt: string | null }> = {};
    for (const t of trips) {
      if (!t.driver_id) continue;
      const cur = (m[t.driver_id] ??= { onDuty: 0, lastDeliveredAt: null });
      if (t.trip_date === selectedDay && t.stage !== "delivered") cur.onDuty += 1;
      if (t.delivered_at && (cur.lastDeliveredAt === null || t.delivered_at > cur.lastDeliveredAt)) {
        cur.lastDeliveredAt = t.delivered_at;
      }
    }
    // Format the delivered timestamp once, here, so the table stays presentational.
    const out: Record<string, { onDuty: number; lastDelivered: string | null }> = {};
    for (const [id, v] of Object.entries(m)) {
      out[id] = {
        onDuty: v.onDuty,
        lastDelivered: v.lastDeliveredAt ? fmtDeliveredLocal(v.lastDeliveredAt) : null,
      };
    }
    return out;
  }, [trips, selectedDay]);

  // driver_ids on leave for the SELECTED trip day (trip_date the manager picked).
  // Resolved from the FULL leave periods via the canonical range check. A driver
  // on leave that day can't take the trip. Recomputed when the day changes.
  const leaveBlockedIds = useMemo(() => {
    const s = new Set<string>();
    const day = tripDate || selectedDay;
    for (const d of drivers) if (resolveOnLeave(leavePeriods, d.id, day)) s.add(d.id);
    return s;
  }, [drivers, leavePeriods, tripDate, selectedDay]);

  // Drivers shown in the duty table: a project's assigned drivers in project mode,
  // or ALL drivers in customer/no-project mode.
  const visibleDrivers = useMemo(() => {
    if (kind === "project") {
      if (!projectId) return [];
      const ids = new Set(assignmentsByProject[projectId] ?? []);
      return drivers.filter((d) => ids.has(d.id));
    }
    return drivers;
  }, [kind, projectId, assignmentsByProject, drivers]);

  // Truck is implied by the driver (one truck per driver) — derive its id for the
  // hidden truck_id input. No truck → "" → action's nullable() stores NULL.
  const derivedTruckId = useMemo(() => {
    if (!driverId) return "";
    return trucks.find((t) => t.assigned_driver_id === driverId)?.id ?? "";
  }, [driverId, trucks]);

  // Toggle-select: re-clicking the chosen driver clears it (driver is optional).
  function onSelectDriver(id: string) {
    setDriverId((prev) => (prev === id ? null : id));
  }

  // Reseed the date when the board's selected day changes.
  useEffect(() => {
    setTripDate(defaultDate ?? "");
  }, [defaultDate]);

  // A project card's "Add trip" opens the modal pre-scoped to that project.
  useEffect(() => {
    if (openForProject) {
      setError(null);
      setKind("project");
      onPickProject(openForProject);
      setOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openForProject]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    const res = await createTrip(formData);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    close();
    router.refresh();
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40"
          onClick={close}
        >
          <div
            className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-4">New trip</h2>
            <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Link kind toggle */}
              <div className="sm:col-span-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => pickKind("project")}
                  disabled={projects.length === 0}
                  className={cn(
                    "h-9 px-3 rounded-lg text-sm font-medium border flex-1",
                    kind === "project" ? "bg-brand-600 text-white border-brand-600" : "",
                    projects.length === 0 ? "opacity-50 pointer-events-none" : ""
                  )}
                  style={kind !== "project" ? { borderColor: "rgb(var(--border))" } : undefined}
                >
                  Project trip
                </button>
                <button
                  type="button"
                  onClick={() => pickKind("customer")}
                  disabled={customers.length === 0}
                  className={cn(
                    "h-9 px-3 rounded-lg text-sm font-medium border flex-1",
                    kind === "customer" ? "bg-brand-600 text-white border-brand-600" : "",
                    customers.length === 0 ? "opacity-50 pointer-events-none" : ""
                  )}
                  style={kind !== "customer" ? { borderColor: "rgb(var(--border))" } : undefined}
                >
                  Customer trip
                </button>
              </div>

              {kind === "project" ? (
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  <span className="muted">Project *</span>
                  <select
                    name="project_id"
                    required
                    value={projectId}
                    onChange={(e) => onPickProject(e.target.value)}
                    className={INPUT}
                    style={INPUT_STYLE}
                  >
                    <option value="" disabled>
                      Select…
                    </option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  <span className="muted">Customer *</span>
                  <select
                    name="customer_id"
                    required
                    value={customerId}
                    onChange={(e) => onPickCustomer(e.target.value)}
                    className={INPUT}
                    style={INPUT_STYLE}
                  >
                    <option value="" disabled>
                      Select…
                    </option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Water station *</span>
                <select
                  name="water_station"
                  value={station}
                  onChange={(e) => setStation(e.target.value)}
                  className={INPUT}
                  style={INPUT_STYLE}
                >
                  {stations.length === 0 && (
                    <option value="" disabled>
                      No stations
                    </option>
                  )}
                  {stations.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Water type *</span>
                <select
                  name="water_type"
                  value={waterType}
                  onChange={(e) => setWaterType(e.target.value as WaterType)}
                  className={INPUT}
                  style={INPUT_STYLE}
                >
                  {Object.entries(WATER_TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>

              {/* Driver + truck — one operational pick. The driver's assigned truck
                  is implied, so there is no separate truck selector; truck_id is
                  derived from the chosen driver and submitted via a hidden input. */}
              <div className="sm:col-span-2 flex flex-col gap-1 text-sm">
                <span className="muted">Driver {driverId ? "" : "· unassigned"}</span>
                <DriverDutyTable
                  drivers={visibleDrivers}
                  trucks={trucks}
                  dutyByDriver={dutyByDriver}
                  selected={driverId}
                  onSelect={onSelectDriver}
                  stateByDriver={driverStateById}
                  leaveBlockedIds={leaveBlockedIds}
                  leaveUnavailable={leaveLoadFailed}
                />
                <input type="hidden" name="driver_id" value={driverId ?? ""} />
                <input type="hidden" name="truck_id" value={derivedTruckId} />
              </div>

              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Trip date</span>
                <input
                  name="trip_date"
                  type="date"
                  value={tripDate}
                  onChange={(e) => setTripDate(e.target.value)}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">How many (batch)</span>
                <input
                  name="count"
                  type="number"
                  step="1"
                  min="1"
                  max={MAX_BATCH_TRIPS}
                  defaultValue={1}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>

              {error && (
                <p className="text-sm text-rose-600 dark:text-rose-400 sm:col-span-2">{error}</p>
              )}

              <div className="flex justify-end gap-2 sm:col-span-2 mt-2">
                <Btn variant="outline" onClick={close}>
                  Cancel
                </Btn>
                <Btn type="submit" variant="primary">
                  {saving ? "Saving…" : "Create"}
                </Btn>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
