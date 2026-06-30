import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import type { Project, DriverStatus, ProjectDriver } from "@/lib/db-types";
import ProjectForm from "./ProjectForm";

export const dynamic = "force-dynamic";

type JoinedProject = Project & { customer: { name: string } | null };

export default async function ProjectsPage() {
  const supabase = createClient();

  const [projectsRes, customersRes, driversRes, trucksRes, assignmentsRes] = await Promise.all([
    supabase
      .from("projects")
      .select("*, customer:customers(name)")
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("customers")
      .select("id, name")
      .is("archived_at", null)
      .order("name", { ascending: true }),
    supabase
      .from("drivers")
      .select("id, name, status")
      .order("name", { ascending: true }),
    supabase
      .from("trucks")
      .select("id, plate, assigned_driver_id, last_service_date")
      .order("plate", { ascending: true }),
    supabase.from("project_drivers").select("project_id, driver_id"),
  ]);

  const projects = ((projectsRes.data ?? []) as JoinedProject[]).map((p) => ({
    ...p,
    customerName: p.customer?.name ?? "—",
  }));
  const customers = (customersRes.data ?? []) as { id: string; name: string }[];
  const drivers = (driversRes.data ?? []) as { id: string; name: string; status: DriverStatus }[];
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

  const error =
    projectsRes.error || customersRes.error || driversRes.error || trucksRes.error || assignmentsRes.error;

  return (
    <div>
      <PageHeader title="Projects" subtitle="Delivery contracts tied to a customer." />
      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">
          Failed to load projects: {error.message}
        </p>
      )}
      <ProjectForm
        projects={projects}
        customers={customers}
        drivers={drivers}
        trucks={trucks}
        assignmentsByProject={assignmentsByProject}
      />
    </div>
  );
}
