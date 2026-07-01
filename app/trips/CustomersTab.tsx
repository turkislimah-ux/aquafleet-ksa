"use client";

// Customers tab (Trips page). One row per customer (1:1 with its project, enforced
// by the projects_customer_id_unique constraint). KPIs are a current-calendar-month
// snapshot. "Manage project" opens the shared ProjectModal in edit mode (atomic
// update via RPC 0017). "View breakdown" opens the per-project monthly report.

import { useMemo, useState } from "react";
import { Btn, Stat, Table, TH, TD } from "@/components/ui";
import { formatSar } from "@/lib/utils";
import { monthKeyOf } from "@/lib/commission";
import type { CommissionMode, WaterType } from "@/lib/db-types";
import { type DriverState } from "@/lib/driver-state";
import ProjectModal, { type ProjectInitial } from "./ProjectModal";
import BreakdownReport from "./BreakdownReport";

// Minimal shapes — the page passes wider objects (assignable to these). These
// carry every field the edit form pre-fills.
type CustomerLite = {
  id: string;
  name: string;
  customer_type: string;
  contact_name: string | null;
  phone: string | null;
  delivery_site_address: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
};
type ProjectLite = {
  id: string;
  name: string;
  customer_id: string;
  rate_per_trip_sar: number;
  commission_value: number;
  commission_mode: CommissionMode;
  commission_bump_pct: number;
  default_water_station: string;
  water_type: WaterType | null;
  description: string | null;
};
// Wider than the KPI math needs — the extra fields (driver_id, commission_sar,
// water_station, water_type, stage) feed the BreakdownReport, which the page
// already passes at runtime.
type TripLite = {
  project_id: string | null;
  trip_date: string | null;
  delivered_at: string | null;
  driver_id: string | null;
  commission_sar: number | null;
  water_station: string;
  water_type: string;
  stage: string;
};
type Driver = { id: string; name: string; status?: string };
type TruckLite = {
  id: string;
  plate: string;
  assigned_driver_id: string | null;
  last_service_date: string | null;
};
type Station = { key: string; name: string; is_default?: boolean };

export type CustomersTabProps = {
  customers: CustomerLite[];
  projects: ProjectLite[];
  assignmentsByProject: Record<string, string[]>;
  trips: TripLite[];
  drivers: Driver[];
  trucks: TruckLite[];
  stations: Station[];
  driverStateById: Record<string, DriverState>;
};

// Build the edit-form pre-fill from a customer + its project + assigned drivers.
function toInitial(c: CustomerLite, p: ProjectLite, driverIds: string[]): ProjectInitial {
  return {
    project_id: p.id,
    cust_name: c.name,
    cust_type: c.customer_type,
    contact_name: c.contact_name ?? "",
    phone: c.phone ?? "",
    delivery_address: c.delivery_site_address ?? "",
    delivery_lat: c.delivery_lat == null ? "" : String(c.delivery_lat),
    delivery_lng: c.delivery_lng == null ? "" : String(c.delivery_lng),
    proj_name: p.name,
    rate: String(p.rate_per_trip_sar),
    commission_value: String(p.commission_value),
    commission_mode: p.commission_mode,
    commission_bump: String(p.commission_bump_pct),
    default_water_station: p.default_water_station,
    water_type: p.water_type ?? "",
    description: p.description ?? "",
    driver_ids: driverIds,
  };
}

export default function CustomersTab({
  customers,
  projects,
  assignmentsByProject,
  trips,
  drivers,
  trucks,
  stations,
  driverStateById,
}: CustomersTabProps) {
  // Edit modal pre-fill (null = closed).
  const [editing, setEditing] = useState<ProjectInitial | null>(null);
  // Breakdown report (null = closed). Carries the clicked project + customer
  // identity (name/contact/phone) for the report header.
  const [breakdown, setBreakdown] = useState<{
    project: ProjectLite;
    customerName: string;
    contactName: string | null;
    phone: string | null;
  } | null>(null);

  const monthKey = monthKeyOf(new Date().toISOString());

  // project lookup by customer (1:1) for the rows + by project_id for revenue.
  const projectByCustomer = useMemo(() => {
    const m = new Map<string, ProjectLite>();
    for (const p of projects) m.set(p.customer_id, p);
    return m;
  }, [projects]);
  const projectById = useMemo(() => {
    const m = new Map<string, ProjectLite>();
    for (const p of projects) m.set(p.id, p);
    return m;
  }, [projects]);

  // driver_id -> [project name…] for the edit modal's driver roster.
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

  // Per-project DELIVERED trip count for THIS calendar month (keyed by
  // delivered_at — same basis as the Revenue KPI, so the two reconcile).
  const deliveredThisMonthByProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trips) {
      if (!t.project_id || !t.delivered_at) continue;
      if (monthKeyOf(t.delivered_at) !== monthKey) continue;
      m.set(t.project_id, (m.get(t.project_id) ?? 0) + 1);
    }
    return m;
  }, [trips, monthKey]);

  // --- KPIs (current-month snapshot) ---------------------------------------
  const totalCustomers = customers.length;

  // Distinct drivers across ALL projects (a driver assigned to two projects counts once).
  const driversDeployed = useMemo(() => {
    const set = new Set<string>();
    for (const ids of Object.values(assignmentsByProject)) {
      for (const id of ids) set.add(id);
    }
    return set.size;
  }, [assignmentsByProject]);

  // All trips (any stage) scheduled this month, by trip_date.
  const tripsThisMonth = useMemo(
    () => trips.filter((t) => t.trip_date && monthKeyOf(t.trip_date) === monthKey).length,
    [trips, monthKey]
  );

  // Revenue = Σ rate_per_trip_sar for trips DELIVERED this month (by delivered_at).
  const revenueThisMonth = useMemo(() => {
    let sum = 0;
    for (const t of trips) {
      if (!t.project_id || !t.delivered_at) continue;
      if (monthKeyOf(t.delivered_at) !== monthKey) continue;
      sum += projectById.get(t.project_id)?.rate_per_trip_sar ?? 0;
    }
    return sum;
  }, [trips, monthKey, projectById]);

  return (
    <div>
      {/* KPI row — current calendar month snapshot. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Total customers" value={totalCustomers} tone="info" />
        <Stat label="Drivers deployed" value={driversDeployed} tone="ok" />
        <Stat label="Trips · month" value={tripsThisMonth} tone="ok" />
        <Stat label="Revenue · month" value={formatSar(revenueThisMonth)} tone="ok" />
      </div>

      {customers.length === 0 ? (
        <div className="card p-10 text-center muted text-sm">
          No customers yet — create a project to add one.
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>Customer</TH>
                <TH>Project</TH>
                <TH>Rate</TH>
                <TH>Commission</TH>
                <TH>Location</TH>
                <TH>Drivers</TH>
                <TH>
                  <span className="flex flex-col leading-tight">
                    <span>Delivered</span>
                    <span className="text-[11px] font-normal normal-case muted">(this month)</span>
                  </span>
                </TH>
                <TH></TH>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const project = projectByCustomer.get(c.id) ?? null;
                const driverCount = project ? (assignmentsByProject[project.id] ?? []).length : 0;
                const deliveredThisMonth = project ? deliveredThisMonthByProject.get(project.id) ?? 0 : 0;
                return (
                  <tr key={c.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                    <TD className="font-medium">{c.name}</TD>
                    <TD>{project?.name ?? <span className="muted">—</span>}</TD>
                    <TD className="tabular-nums">
                      {project ? formatSar(project.rate_per_trip_sar) : <span className="muted">—</span>}
                    </TD>
                    <TD>
                      {project ? (
                        <span>
                          <span className="tabular-nums">{formatSar(project.commission_value)}</span>{" "}
                          <span className="text-xs text-emerald-600 dark:text-emerald-400">
                            ·{" "}
                            {project.commission_mode === "scalable"
                              ? `Scalable +${project.commission_bump_pct}%`
                              : "Fixed"}
                          </span>
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </TD>
                    <TD className="max-w-[16rem] truncate">
                      {c.delivery_site_address ?? <span className="muted">—</span>}
                    </TD>
                    <TD className="tabular-nums">{driverCount}</TD>
                    <TD className="tabular-nums">{deliveredThisMonth}</TD>
                    <TD>
                      <div className="inline-flex gap-2">
                        <Btn
                          variant="outline"
                          onClick={() =>
                            project &&
                            setEditing(toInitial(c, project, assignmentsByProject[project.id] ?? []))
                          }
                        >
                          Manage project
                        </Btn>
                        <Btn
                          variant="outline"
                          onClick={() =>
                            project &&
                            setBreakdown({
                              project,
                              customerName: c.name,
                              contactName: c.contact_name,
                              phone: c.phone,
                            })
                          }
                        >
                          View breakdown
                        </Btn>
                      </div>
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}

      {/* Shared form in EDIT mode — pre-filled from the clicked row. */}
      <ProjectModal
        mode="edit"
        open={editing !== null}
        initial={editing}
        onClose={() => setEditing(null)}
        drivers={drivers}
        trucks={trucks}
        driverProjectNames={driverProjectNames}
        stations={stations}
        driverStateById={driverStateById}
      />

      {/* Per-project monthly Breakdown report (numbers + tables + print). */}
      <BreakdownReport
        open={breakdown !== null}
        onClose={() => setBreakdown(null)}
        project={breakdown?.project ?? null}
        customerName={breakdown?.customerName ?? ""}
        contactName={breakdown?.contactName ?? null}
        phone={breakdown?.phone ?? null}
        trips={trips}
        drivers={drivers}
        stations={stations}
      />
    </div>
  );
}
