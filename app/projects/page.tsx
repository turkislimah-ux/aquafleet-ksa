import { createClient } from "@/lib/supabase/server";
import type { Project, DriverStatus, ProjectDriver } from "@/lib/db-types";
import type { LeavePeriod } from "@/lib/leave";
import { buildDriverStateMap, type DriverState } from "@/lib/driver-state";
import { todayKey } from "@/lib/utils";
import ProjectForm from "./ProjectForm";

export const dynamic = "force-dynamic";

// `name_ar` rides along so the Customer column and the customer dropdown can go
// through arText. It is the customer's Arabic name — `projects` itself has no
// name_ar column, so a PROJECT name is not an arText candidate anywhere here.
type JoinedProject = Project & { customer: { name: string; name_ar: string | null } | null };

export default async function ProjectsPage() {
  const supabase = createClient();
  const today = todayKey();

  const [projectsRes, customersRes, driversRes, trucksRes, assignmentsRes, leavePeriodsRes] =
    await Promise.all([
      supabase
        .from("projects")
        .select("*, customer:customers(name, name_ar)")
        .is("archived_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("customers")
        // ORDERED BY THE BASE NAME, still, in both languages. arText is display
        // only (see its header in lib/i18n.ts) — sorting on whichever column
        // happens to be shown would reshuffle this dropdown when the language
        // is toggled, for a list the user is picking from by position.
        .select("id, name, name_ar")
        .is("archived_at", null)
        .order("name", { ascending: true }),
      // Terminated drivers must never reach buildDriverStateMap or the
      // Manage-drivers picker — filtered at the fetch.
      supabase
        .from("drivers")
        .select("id, name, status, active")
        .is("terminated_at", null)
        .order("name", { ascending: true }),
      // Terminated trucks vanish from the roster pickers (0020); frees their
      // driver via the truckDriverIds set below (model A: no truck = off_duty).
      supabase
        .from("trucks")
        .select("id, plate, assigned_driver_id, last_service_date")
        .is("terminated_at", null)
        .order("plate", { ascending: true }),
      supabase.from("project_drivers").select("project_id, driver_id"),
      supabase
        .from("leave_periods")
        .select("driver_id, start_date, end_date")
        .lte("start_date", today)
        .gte("end_date", today),
    ]);

  const projects = ((projectsRes.data ?? []) as JoinedProject[]).map((p) => ({
    ...p,
    customerName: p.customer?.name ?? "—",
    // No customer -> null, so arText falls back to the em dash above rather
    // than to an empty cell.
    customerNameAr: p.customer?.name_ar ?? null,
  }));
  const customers = (customersRes.data ?? []) as { id: string; name: string; name_ar: string | null }[];
  const drivers = (driversRes.data ?? []) as {
    id: string;
    name: string;
    status: DriverStatus;
    active: boolean;
  }[];
  const trucks = (trucksRes.data ?? []) as {
    id: string;
    plate: string;
    assigned_driver_id: string | null;
    last_service_date: string | null;
  }[];

  // Map project_id -> [driver_id, …] for the Manage-drivers modal pre-check.
  const assignmentsByProject: Record<string, string[]> = {};
  for (const a of (assignmentsRes.data ?? []) as Pick<ProjectDriver, "project_id" | "driver_id">[]) {
    (assignmentsByProject[a.project_id] ??= []).push(a.driver_id);
  }

  // Derived driver-state facts (referenceDate = today).
  // projects are already filtered to non-archived, so every fetched project id is "active".
  const activeProjectIds = new Set(projects.map((p) => p.id));
  const truckDriverIds = new Set(
    trucks.map((t) => t.assigned_driver_id).filter((id): id is string => id != null)
  );
  const activeProjectDriverIds = new Set<string>();
  for (const a of (assignmentsRes.data ?? []) as Pick<ProjectDriver, "project_id" | "driver_id">[]) {
    if (activeProjectIds.has(a.project_id)) activeProjectDriverIds.add(a.driver_id);
  }
  const leavePeriods = (leavePeriodsRes.data ?? []) as LeavePeriod[];
  const driverStateById: Record<string, DriverState> = buildDriverStateMap(
    drivers,
    truckDriverIds,
    activeProjectDriverIds,
    leavePeriods,
    today
  );
  // Fail-safe: if leave data failed to load, roster selection must NOT fail-open.
  const leaveLoadFailed = !!leavePeriodsRes.error;

  const error =
    projectsRes.error ||
    customersRes.error ||
    driversRes.error ||
    trucksRes.error ||
    assignmentsRes.error ||
    leavePeriodsRes.error;

  // Title and error line moved into ProjectForm — same reason as the Customers
  // page: both are translated now and `lang` is client state. The message
  // itself stays English (Supabase text, out of scope for this MVP).
  return (
    <div>
      <ProjectForm
        projects={projects}
        customers={customers}
        drivers={drivers}
        trucks={trucks}
        assignmentsByProject={assignmentsByProject}
        driverStateById={driverStateById}
        leaveLoadFailed={leaveLoadFailed}
        error={error?.message ?? null}
      />
    </div>
  );
}
