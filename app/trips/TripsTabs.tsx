"use client";

// Trips page shell: Projects | Customers tabs. The page header (title +
// subtitle) swaps with the active tab. Tab state lives in the URL (?tab=…) so a
// refresh keeps the tab; default (no param) is Projects.
//
// Projects tab = the existing ProjectsBoard (KPIs + New Project button + project
// kanban boards). Customers tab is a placeholder for now — its KPIs + table land
// in a later commit. Tab visual style mirrors the Drivers & People sub-tabs.

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui";
import ProjectsBoard, { type ProjectsBoardProps } from "./ProjectsBoard";
import CustomersTab from "./CustomersTab";
import FinanceTab from "./FinanceTab";
import type { TopupRow, SpecialChargeRow, PaidInvoiceRow } from "./page";

type Tab = "projects" | "customers" | "finance";

const HEADER: Record<Tab, { title: string; subtitle: string }> = {
  projects: {
    title: "Project Operations",
    subtitle: "Each project runs its own Kanban — push trips through the board manually.",
  },
  customers: {
    title: "Manage Customers",
    subtitle: "View and manage every customer, their project, rate, and assigned drivers.",
  },
  finance: {
    title: "Finance",
    subtitle: "Prepaid balances, top-ups, and customer statements — pre-VAT.",
  },
};

export default function TripsTabs({
  error,
  topups,
  specialCharges,
  paidInvoices,
  ...boardProps
}: ProjectsBoardProps & {
  error: string | null;
  topups: TopupRow[];
  specialCharges: SpecialChargeRow[];
  paidInvoices: PaidInvoiceRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = tabParam === "customers" ? "customers" : tabParam === "finance" ? "finance" : "projects";

  function setTab(next: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "projects") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const head = HEADER[tab];

  return (
    <div>
      <PageHeader title={head.title} subtitle={head.subtitle} />

      {/* Tab bar — underline style mirrors the Drivers & People sub-tabs. */}
      <div
        className="flex items-center gap-1 border-b mb-4 flex-wrap"
        style={{ borderColor: "rgb(var(--border))" }}
      >
        <TabBtn active={tab === "projects"} onClick={() => setTab("projects")} label="Projects" />
        <TabBtn active={tab === "customers"} onClick={() => setTab("customers")} label="Customers" />
        <TabBtn active={tab === "finance"} onClick={() => setTab("finance")} label="Finance" />
      </div>

      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">Failed to load trips: {error}</p>
      )}

      {tab === "projects" && <ProjectsBoard {...boardProps} />}

      {tab === "customers" && (
        <CustomersTab
          customers={boardProps.customers}
          projects={boardProps.projects}
          assignmentsByProject={boardProps.assignmentsByProject}
          trips={boardProps.trips}
          drivers={boardProps.drivers}
          trucks={boardProps.trucks}
          stations={boardProps.stations}
          driverStateById={boardProps.driverStateById}
          leaveUnavailable={boardProps.leaveLoadFailed}
        />
      )}

      {tab === "finance" && (
        <FinanceTab
          customers={boardProps.customers}
          projects={boardProps.projects}
          trips={boardProps.trips}
          topups={topups}
          specialCharges={specialCharges}
          paidInvoices={paidInvoices}
        />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px inline-flex items-center gap-2 transition " +
        (active
          ? "border-brand-600 text-brand-600 dark:text-brand-300"
          : "border-transparent muted hover:text-[rgb(var(--fg))]")
      }
    >
      {label}
    </button>
  );
}
