"use client";

// Drivers & People client island. Three tabs mirror the demo:
//   • Drivers      — KPIs + slim roster table; row opens the Driver Detail modal.
//   • Commissions  — built in a later commit (transitional stub here).
//   • Staff        — built in a later commit (transitional stub here).
//
// Confirmed Riyadh deviations vs demo:
//   • "Depot" → "Station" (3 Riyadh stations).
//   • Driver status uses our enum (active/on_leave/inactive). "On Duty" KPI is
//     DERIVED from having an assigned truck, not a status value.
// Deliberate real-app additions (demo has neither): a "New driver" header action
// and an Edit button in the Driver Detail modal — drivers must be manageable.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Pencil, Eye, Star, X, Phone, Shield, Route as RouteIcon, Truck as TruckIcon } from "lucide-react";
import { Btn, Stat, StatusPill, Bar, Table, TH, TD } from "@/components/ui";
import { formatSar } from "@/lib/utils";
import {
  type Driver,
  type Staff,
  type StaffRole,
  DRIVER_STATUS_LABELS,
  TRUCK_STATUS_LABELS,
  STATION_OPTIONS,
  type TruckStatus,
} from "@/lib/db-types";
import { TRIP_STAGE_LABELS, type TripStage } from "@/lib/db-types";
import { createDriver, updateDriver } from "./actions";
import CommissionsTab, {
  buildCurrentRows,
  type CommTripRow,
  type CommCycle,
  type CommSpecialRow,
  type CommAdjustmentRow,
} from "./CommissionsTab";
import HistoryTab from "./HistoryTab";
import StaffTab from "./StaffTab";
import type { CommPayout } from "@/lib/commission-rows";

export type TruckLite = {
  id: string;
  plate: string;
  model: string | null;
  status: TruckStatus;
  home_station: string | null;
  assigned_driver_id: string | null;
};

export type RecentTrip = {
  ref: string | null;
  trip_date: string;
  stage: string;
  tank_size_m3: number | null;
  dest: string | null;
};

type Tab = "drivers" | "commissions" | "history" | "staff";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// License counts as "expiring" if it lapses on or before the end of this year —
// mirrors the demo's `< Dec 31 2026` check, generalized to the current year.
const YEAR_END = `${new Date().getFullYear()}-12-31`;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function driverPill(s: Driver["status"]) {
  return <StatusPill status={s} label={DRIVER_STATUS_LABELS[s]} />;
}

export default function DriversClient({
  drivers,
  trucks,
  trips30dByDriver,
  recentByDriver,
  commTrips,
  cycles,
  specials,
  adjustments,
  payouts,
  staff,
  staffRoles,
  projectsById,
  error,
}: {
  drivers: Driver[];
  trucks: TruckLite[];
  trips30dByDriver: Record<string, number>;
  recentByDriver: Record<string, RecentTrip[]>;
  commTrips: CommTripRow[];
  cycles: CommCycle[];
  specials: CommSpecialRow[];
  adjustments: CommAdjustmentRow[];
  payouts: CommPayout[];
  staff: Staff[];
  staffRoles: StaffRole[];
  projectsById: Record<string, string>;
  error: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("drivers");
  const [detail, setDetail] = useState<Driver | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Assignment is single-source-of-truth on the truck. Derive driver → truck.
  const truckByDriver = useMemo(() => {
    const m = new Map<string, TruckLite>();
    for (const t of trucks) if (t.assigned_driver_id) m.set(t.assigned_driver_id, t);
    return m;
  }, [trucks]);
  const driverNameById = useMemo(() => new Map(drivers.map((d) => [d.id, d.name])), [drivers]);

  // KPIs — honest: averages/sums skip null, "On Duty" derived from assignment.
  const total = drivers.length;
  const onDuty = drivers.filter((d) => truckByDriver.has(d.id)).length;
  const safetyVals = drivers.map((d) => d.safety_score).filter((n): n is number => n != null);
  const avgSafety = safetyVals.length ? +(safetyVals.reduce((s, n) => s + n, 0) / safetyVals.length).toFixed(1) : null;
  const incidents = drivers.reduce((s, d) => s + (d.incidents_12mo ?? 0), 0);
  const expiring = drivers.filter((d) => d.license_expiry != null && d.license_expiry <= YEAR_END).length;

  // Commissions tab badge = drivers whose current balance needs review (open
  // cycle still pending, with something to review/pay).
  const pendingPayouts = useMemo(
    () =>
      buildCurrentRows({
        drivers,
        trips: commTrips,
        cycles,
        specials,
        adjustments,
      }).filter((r) => r.payoutStatus === "pending" && r.hasActivity).length,
    [drivers, commTrips, cycles, specials, adjustments],
  );

  function openNew() {
    setEditing(null);
    setFormError(null);
    setFormOpen(true);
  }
  function openEdit(d: Driver) {
    setEditing(d);
    setFormError(null);
    setFormOpen(true);
  }
  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const truckId = String(fd.get("truck_id") ?? "");

    // Footgun guard: chosen truck already carries a different driver → moving it.
    if (truckId) {
      const target = trucks.find((tr) => tr.id === truckId);
      const occupant = target?.assigned_driver_id;
      if (occupant && occupant !== editing?.id) {
        const who = driverNameById.get(occupant) ?? "another driver";
        if (!confirm(`That truck is currently assigned to ${who}. Reassign it?`)) return;
      }
    }

    setSaving(true);
    setFormError(null);
    const res = editing ? await updateDriver(editing.id, fd) : await createDriver(fd);
    setSaving(false);
    if (res.error) {
      setFormError(res.error);
      return;
    }
    closeForm();
    router.refresh();
  }

  const currentTruckId = editing ? truckByDriver.get(editing.id)?.id ?? "" : "";

  return (
    <div>
      {/* Header — action is tab-aware (New driver on Drivers tab). */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Drivers</h1>
          <p className="muted text-sm mt-1">
            {total} drivers · {staff.length} support staff
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "drivers" && (
            <Btn variant="primary" onClick={openNew}>
              <Plus className="h-4 w-4" /> New driver
            </Btn>
          )}
        </div>
      </div>

      {/* Tab bar — underline style mirrors the demo. */}
      <div className="flex items-center gap-1 border-b mb-4 flex-wrap" style={{ borderColor: "rgb(var(--border))" }}>
        <TabBtn active={tab === "drivers"} onClick={() => setTab("drivers")} label="Drivers" badge={total} />
        <TabBtn active={tab === "commissions"} onClick={() => setTab("commissions")} label="Commissions" badge={pendingPayouts} />
        <TabBtn active={tab === "history"} onClick={() => setTab("history")} label="History" badge={payouts.length} />
        <TabBtn active={tab === "staff"} onClick={() => setTab("staff")} label="Management & Staff" badge={staff.length} />
      </div>

      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">Failed to load: {error}</p>
      )}

      {tab === "drivers" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Stat label="On Duty Now" value={`${onDuty}/${total}`} tone="ok" />
            <Stat label="Avg Safety" value={avgSafety ?? "—"} tone={avgSafety != null && avgSafety > 80 ? "ok" : "warn"} />
            <Stat label="Incidents (12mo)" value={incidents} tone={incidents > 5 ? "warn" : "ok"} />
            <Stat label="License Exp (this year)" value={expiring} tone={expiring > 5 ? "warn" : "info"} />
          </div>

          <div className="card p-0 overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <TH>Driver</TH>
                  <TH>Station</TH>
                  <TH>Status</TH>
                  <TH>Truck</TH>
                  <TH>Safety</TH>
                  <TH>Trips 30d</TH>
                  <TH>Rating</TH>
                  <TH>Salary</TH>
                  <TH>License Exp</TH>
                  <TH className="text-end" />
                </tr>
              </thead>
              <tbody>
                {drivers.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                      No drivers yet.
                    </td>
                  </tr>
                )}
                {drivers.map((d) => {
                  const truck = truckByDriver.get(d.id);
                  const expSoon = d.license_expiry != null && d.license_expiry <= YEAR_END;
                  return (
                    <tr key={d.id} className="cursor-pointer hover:bg-black/5 dark:hover:bg-white/5" onClick={() => setDetail(d)}>
                      <TD>
                        <div className="flex items-center gap-2">
                          <Avatar name={d.name} />
                          <div>
                            <div className="font-medium">{d.name}</div>
                            <div className="text-[11px] muted">{d.name_ar ?? ""}</div>
                          </div>
                        </div>
                      </TD>
                      <TD>{d.home_station ?? <span className="muted">—</span>}</TD>
                      <TD>{driverPill(d.status)}</TD>
                      <TD>{truck ? <span className="font-mono text-xs">{truck.plate}</span> : <span className="muted">—</span>}</TD>
                      <TD>
                        {d.safety_score != null ? (
                          <div className="w-24">
                            <div className="text-[11px] tabular-nums mb-0.5">{d.safety_score}</div>
                            <Bar value={d.safety_score} />
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </TD>
                      <TD className="tabular-nums">{trips30dByDriver[d.id] ?? 0}</TD>
                      <TD>
                        {d.rating != null ? (
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" /> {d.rating}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </TD>
                      <TD className="tabular-nums">
                        {d.salary_sar != null ? formatSar(d.salary_sar) : <span className="muted">—</span>}
                      </TD>
                      <TD className={expSoon ? "text-amber-600 dark:text-amber-400 font-medium" : ""}>
                        {d.license_expiry ?? <span className="muted">—</span>}
                      </TD>
                      <TD className="text-end">
                        <Btn variant="outline" onClick={() => setDetail(d)}>
                          <Eye className="h-3.5 w-3.5" /> View
                        </Btn>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </>
      )}

      {tab === "commissions" && (
        <CommissionsTab
          drivers={drivers}
          trips={commTrips}
          cycles={cycles}
          specials={specials}
          adjustments={adjustments}
          projectsById={projectsById}
        />
      )}

      {tab === "history" && <HistoryTab payouts={payouts} drivers={drivers} />}

      {tab === "staff" && <StaffTab staff={staff} staffRoles={staffRoles} />}

      {detail && (
        <DriverDetail
          driver={detail}
          truck={truckByDriver.get(detail.id) ?? null}
          trips30d={trips30dByDriver[detail.id] ?? 0}
          recent={recentByDriver[detail.id] ?? []}
          onClose={() => setDetail(null)}
          onEdit={() => {
            const d = detail;
            setDetail(null);
            openEdit(d);
          }}
        />
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={closeForm}>
          <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">{editing ? "Edit driver" : "New driver"}</h2>
            <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Name *">
                <input name="name" required defaultValue={editing?.name ?? ""} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Name (Arabic)">
                <input name="name_ar" defaultValue={editing?.name_ar ?? ""} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Phone">
                <input name="phone" defaultValue={editing?.phone ?? ""} placeholder="+966 5…" className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Iqama number">
                <input name="iqama_number" defaultValue={editing?.iqama_number ?? ""} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="License expiry">
                <input name="license_expiry" type="date" defaultValue={editing?.license_expiry ?? ""} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Hire date">
                <input name="hire_date" type="date" defaultValue={editing?.hire_date ?? ""} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Status">
                <select name="status" defaultValue={editing?.status ?? "active"} className={INPUT} style={INPUT_STYLE}>
                  {Object.entries(DRIVER_STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </Field>
              <Field label="Station">
                <select name="home_station" defaultValue={editing?.home_station ?? ""} className={INPUT} style={INPUT_STYLE}>
                  <option value="">—</option>
                  {STATION_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Current truck">
                <select name="truck_id" defaultValue={currentTruckId} className={INPUT} style={INPUT_STYLE}>
                  <option value="">Unassigned</option>
                  {trucks.map((tr) => (
                    <option key={tr.id} value={tr.id}>{tr.plate}</option>
                  ))}
                </select>
              </Field>
              <Field label="Safety score">
                <input name="safety_score" type="number" step="1" min="0" max="100" defaultValue={editing?.safety_score ?? ""} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Rating">
                <input name="rating" type="number" step="0.1" min="0" max="5" defaultValue={editing?.rating ?? ""} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Hours this week">
                <input name="hours_this_week" type="number" step="0.1" min="0" defaultValue={editing?.hours_this_week ?? ""} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Incidents (12mo)">
                <input name="incidents_12mo" type="number" step="1" min="0" defaultValue={editing?.incidents_12mo ?? ""} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Salary (SAR / month)">
                <input name="salary_sar" type="number" step="0.01" min="0" defaultValue={editing?.salary_sar ?? ""} placeholder="—" className={INPUT} style={INPUT_STYLE} />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input name="active" type="checkbox" defaultChecked={editing ? editing.active : true} />
                <span>Active</span>
              </label>

              {formError && <p className="text-sm text-rose-600 dark:text-rose-400 sm:col-span-2">{formError}</p>}

              <div className="flex justify-end gap-2 sm:col-span-2 mt-2">
                <Btn variant="outline" onClick={closeForm}>Cancel</Btn>
                <Btn type="submit" variant="primary">{saving ? "Saving…" : "Save"}</Btn>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, label, badge }: { active: boolean; onClick: () => void; label: string; badge?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px inline-flex items-center gap-2 transition " +
        (active ? "border-brand-600 text-brand-600 dark:text-brand-300" : "border-transparent muted hover:text-[rgb(var(--fg))]")
      }
    >
      {label}
      {badge != null && badge > 0 && (
        <span className={"rounded-full px-1.5 text-[11px] font-semibold " + (active ? "bg-brand-600 text-white" : "bg-black/10 dark:bg-white/10")}>
          {badge}
        </span>
      )}
    </button>
  );
}

function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  const dim = size === "lg" ? "h-12 w-12 text-lg" : "h-8 w-8 text-xs";
  return (
    <div className={`${dim} rounded-full text-white grid place-items-center font-semibold shrink-0`} style={{ background: "#0c66bf" }}>
      {initials(name)}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="muted">{label}</span>
      {children}
    </label>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs muted">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function DriverDetail({
  driver: d,
  truck,
  trips30d,
  recent,
  onClose,
  onEdit,
}: {
  driver: Driver;
  truck: TruckLite | null;
  trips30d: number;
  recent: RecentTrip[];
  onClose: () => void;
  onEdit: () => void;
}) {
  const expSoon = d.license_expiry != null && d.license_expiry <= YEAR_END;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold">Driver Details — {d.name}</h2>
          <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4">
          {/* Identity strip */}
          <div className="card p-3 flex items-center gap-3">
            <Avatar name={d.name} size="lg" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{d.name}{d.name_ar ? <span className="muted font-normal"> · {d.name_ar}</span> : null}</div>
              <div className="text-xs muted">{d.home_station ?? "—"}</div>
            </div>
            {driverPill(d.status)}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Contact & ID */}
            <div className="card p-3">
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><Phone className="h-4 w-4" /> Contact &amp; ID</h4>
              <div className="grid grid-cols-2 gap-2">
                <Cell label="Phone">{d.phone ?? <span className="muted">—</span>}</Cell>
                <Cell label="Iqama"><span className="font-mono text-xs">{d.iqama_number ?? "—"}</span></Cell>
                <Cell label="License expiry"><span className={expSoon ? "text-amber-600 dark:text-amber-400 font-medium" : ""}>{d.license_expiry ?? "—"}</span></Cell>
                <Cell label="Hire date">{d.hire_date ?? <span className="muted">—</span>}</Cell>
              </div>
            </div>

            {/* Employment */}
            <div className="card p-3">
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><Shield className="h-4 w-4" /> Employment</h4>
              <div className="grid grid-cols-2 gap-2">
                <Cell label="Safety score"><span className="font-semibold tabular-nums">{d.safety_score ?? "—"}</span></Cell>
                <Cell label="Rating">
                  {d.rating != null ? (
                    <span className="inline-flex items-center gap-1 font-semibold"><Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" /> {d.rating}</span>
                  ) : <span className="muted">—</span>}
                </Cell>
                <Cell label="Trips 30d"><span className="font-semibold tabular-nums">{trips30d}</span></Cell>
                <Cell label="Hours this week"><span className="font-semibold tabular-nums">{d.hours_this_week ?? "—"}</span></Cell>
                <Cell label="Incidents (12mo)">
                  <span className={d.incidents_12mo != null && d.incidents_12mo > 0 ? "text-rose-600 dark:text-rose-400 font-semibold" : "font-semibold"}>
                    {d.incidents_12mo ?? "—"}
                  </span>
                </Cell>
                <Cell label="Salary (monthly)">
                  <span className="font-semibold tabular-nums">{d.salary_sar != null ? formatSar(d.salary_sar) : "—"}</span>
                </Cell>
              </div>
            </div>
          </div>

          {/* Assignment */}
          <div className="card p-3">
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><TruckIcon className="h-4 w-4" /> Current Assignment</h4>
            {truck ? (
              <div className="flex items-center gap-3 text-sm">
                <div className="h-10 w-10 rounded-lg grid place-items-center" style={{ background: "rgba(11,126,234,.12)", color: "#0b7eea" }}>
                  <TruckIcon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    <Link href={`/fleet/${truck.id}`} className="text-brand-600 dark:text-brand-300 hover:underline font-mono">{truck.plate}</Link>
                  </div>
                  <div className="text-xs muted">{[truck.model, truck.home_station].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <StatusPill status={truck.status} label={TRUCK_STATUS_LABELS[truck.status]} />
              </div>
            ) : (
              <p className="muted text-sm">No truck assigned</p>
            )}
          </div>

          {/* Recent trips */}
          <div className="card p-3">
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><RouteIcon className="h-4 w-4" /> Recent Trips</h4>
            {recent.length === 0 ? (
              <p className="muted text-sm">No recent trips</p>
            ) : (
              recent.map((tr, i) => (
                <div key={i} className="py-2 border-t first:border-0" style={{ borderColor: "rgb(var(--border))" }}>
                  <div className="flex justify-between gap-2">
                    <div className="font-medium text-sm">
                      {tr.ref ?? "—"}{tr.dest ? <span className="muted font-normal"> → {tr.dest}</span> : null}
                    </div>
                    <StatusPill status={tr.stage} label={TRIP_STAGE_LABELS[tr.stage as TripStage] ?? tr.stage} />
                  </div>
                  <div className="text-xs muted">
                    {tr.tank_size_m3 != null ? `${tr.tank_size_m3} m³ · ` : ""}{tr.trip_date}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Btn variant="outline" onClick={onClose}>Close</Btn>
          <Btn variant="primary" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Edit</Btn>
        </div>
      </div>
    </div>
  );
}
