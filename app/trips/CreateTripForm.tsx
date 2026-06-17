"use client";

// Client island: the "New trip" button + modal, wired to createTrip. The modal
// links each trip to EITHER a project or a bare customer; picking a project
// pre-fills water type + station (both still overridable). Count stamps out a
// batch of identical trips in one insert. The board itself lives in TripBoard.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Btn } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  type WaterType,
  WATER_TYPE_LABELS,
  STATION_OPTIONS,
  MAX_BATCH_TRIPS,
} from "@/lib/db-types";
import { createTrip } from "./actions";

type ProjectOption = {
  id: string;
  name: string;
  water_type: WaterType | null;
  default_station: string | null;
};
type CustomerOption = { id: string; name: string; default_station: string | null };
type TruckOption = { id: string; plate: string };
type DriverOption = { id: string; name: string };

type Kind = "project" | "customer";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export default function CreateTripForm({
  projects,
  customers,
  trucks,
  drivers,
  openForProject,
  onCloseControlled,
}: {
  projects: ProjectOption[];
  customers: CustomerOption[];
  trucks: TruckOption[];
  drivers: DriverOption[];
  // When set (from a project card's "Add trip"), open the modal pre-scoped to
  // that project. Full per-project rework (assigned-driver picker, tank/time)
  // lands in Cluster 5; this just preselects + locks the project.
  openForProject?: string | null;
  onCloseControlled?: () => void;
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
  const [station, setStation] = useState<string>(STATION_OPTIONS[0]);

  const canCreate = projects.length > 0 || customers.length > 0;

  function openNew() {
    setError(null);
    setKind(projects.length > 0 ? "project" : "customer");
    setProjectId("");
    setCustomerId("");
    setWaterType("potable");
    setStation(STATION_OPTIONS[0]);
    setOpen(true);
  }
  function close() {
    setOpen(false);
    onCloseControlled?.();
  }

  function onPickProject(id: string) {
    setProjectId(id);
    const p = projects.find((x) => x.id === id);
    if (p?.water_type) setWaterType(p.water_type);
    if (p?.default_station) setStation(p.default_station);
  }
  function onPickCustomer(id: string) {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    if (c?.default_station) setStation(c.default_station);
  }

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
      <div className="flex justify-end mb-4">
        <Btn
          variant="primary"
          onClick={openNew}
          className={canCreate ? "" : "opacity-50 pointer-events-none"}
        >
          <Plus className="h-4 w-4" /> New trip
        </Btn>
      </div>
      {!canCreate && (
        <p className="text-sm muted mb-4">
          Create a customer or project first — a trip must link to one.
        </p>
      )}

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
                  onClick={() => setKind("project")}
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
                  onClick={() => setKind("customer")}
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
                  {STATION_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
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

              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Truck</span>
                <select name="truck_id" defaultValue="" className={INPUT} style={INPUT_STYLE}>
                  <option value="">Unassigned</option>
                  {trucks.map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.plate}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Driver</span>
                <select name="driver_id" defaultValue="" className={INPUT} style={INPUT_STYLE}>
                  <option value="">Unassigned</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Rate (SAR)</span>
                <input
                  name="rate_sar"
                  type="number"
                  step="any"
                  min="0"
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Trip date</span>
                <input name="trip_date" type="date" className={INPUT} style={INPUT_STYLE} />
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
