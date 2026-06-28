"use client";

// Customers tab (Trips page). View-only overview: one row per customer (1:1 with
// its project, enforced by the projects_customer_id_unique constraint). KPIs are a
// current-calendar-month snapshot. The two row actions ("Manage project", "View
// breakdown") are placeholders for now — the edit modal + per-customer breakdown
// land in later commits.

import { useMemo, useState } from "react";
import { Btn, Stat, Table, TH, TD } from "@/components/ui";
import { formatSar } from "@/lib/utils";
import { monthKeyOf } from "@/lib/commission";
import type { CommissionMode } from "@/lib/db-types";

// Minimal shapes — the page passes wider objects (assignable to these).
type CustomerLite = { id: string; name: string; delivery_site_address: string | null };
type ProjectLite = {
  id: string;
  name: string;
  customer_id: string;
  rate_per_trip_sar: number;
  commission_value: number;
  commission_mode: CommissionMode;
  commission_bump_pct: number;
};
type TripLite = { project_id: string | null; trip_date: string | null; delivered_at: string | null };

export type CustomersTabProps = {
  customers: CustomerLite[];
  projects: ProjectLite[];
  assignmentsByProject: Record<string, string[]>;
  trips: TripLite[];
};

export default function CustomersTab({
  customers,
  projects,
  assignmentsByProject,
  trips,
}: CustomersTabProps) {
  // Placeholder notice for the not-yet-built row actions.
  const [notice, setNotice] = useState<string | null>(null);

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

      {notice && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-sm text-brand-700 dark:text-brand-300">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-xs underline">
            Dismiss
          </button>
        </div>
      )}

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
                <TH>Delivered (this month)</TH>
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
                          <span className="text-xs muted">
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
                        <Btn variant="outline" onClick={() => setNotice("Manage project — coming next.")}>
                          Manage project
                        </Btn>
                        <Btn variant="outline" onClick={() => setNotice("View breakdown — coming next.")}>
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
    </div>
  );
}
