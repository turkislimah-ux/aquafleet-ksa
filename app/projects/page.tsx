import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import type { Project } from "@/lib/db-types";
import ProjectForm from "./ProjectForm";

export const dynamic = "force-dynamic";

type JoinedProject = Project & { customer: { name: string } | null };

export default async function ProjectsPage() {
  const supabase = createClient();

  const [projectsRes, customersRes] = await Promise.all([
    supabase
      .from("projects")
      .select("*, customer:customers(name)")
      .order("created_at", { ascending: false }),
    supabase
      .from("customers")
      .select("id, name")
      .order("name", { ascending: true }),
  ]);

  const projects = ((projectsRes.data ?? []) as JoinedProject[]).map((p) => ({
    ...p,
    customerName: p.customer?.name ?? "—",
  }));
  const customers = (customersRes.data ?? []) as { id: string; name: string }[];
  const error = projectsRes.error || customersRes.error;

  return (
    <div>
      <PageHeader title="Projects" subtitle="Delivery contracts tied to a customer." />
      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">
          Failed to load projects: {error.message}
        </p>
      )}
      <ProjectForm projects={projects} customers={customers} />
    </div>
  );
}
