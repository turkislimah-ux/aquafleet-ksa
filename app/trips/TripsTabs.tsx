"use client";

// Trips page shell: Projects | Customers | Finance/Invoice tabs. The page
// header (title + subtitle) swaps with the active tab. Tab state lives in the
// URL (?tab=…) so a refresh keeps the tab; default (no param) is Projects.
//
// This shell also OWNS the two page-level actions — "New Project" and "Manage
// stations" — in the header's top-right slot. They used to sit inside
// ProjectsBoard under its KPIs, which made them Projects-tab-only and moved
// them down the page; they are page-wide concerns, so they are mounted here,
// above the tab bar, and rendered on every tab.
//
// Projects tab = ProjectsBoard (day calendar + KPIs + per-project kanban).
// Tab visual style mirrors the Drivers & People sub-tabs.

import { useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Droplet } from "lucide-react";
import { Btn, PageHeader } from "@/components/ui";
import ProjectsBoard, { buildDriverProjectNames, type ProjectsBoardProps } from "./ProjectsBoard";
import CustomersTab from "./CustomersTab";
import FinanceTab from "./FinanceTab";
import NewProjectModal from "./NewProjectModal";
import WaterStationsModal from "./WaterStationsModal";
import type { TopupRow, BalanceReturnRow, SpecialChargeRow, PaidInvoiceRow } from "./page";

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
  balanceReturns,
  specialCharges,
  paidInvoices,
  ...boardProps
}: ProjectsBoardProps & {
  error: string | null;
  topups: TopupRow[];
  balanceReturns: BalanceReturnRow[];
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

  // Water station management popup (false = closed). Lives HERE, not in
  // ProjectsBoard, so the trigger survives a tab switch.
  const [managingStations, setManagingStations] = useState(false);

  // Driver roster for the create-project form. Same helper ProjectsBoard uses
  // for its EDIT-mode ProjectModal — one inversion, two mount points.
  const driverProjectNames = useMemo(
    () => buildDriverProjectNames(boardProps.projects, boardProps.assignmentsByProject),
    [boardProps.projects, boardProps.assignmentsByProject],
  );

  return (
    <div>
      {/* THE TWO PAGE-LEVEL ACTIONS LIVE IN THE HEADER, NOT IN A TAB.
          Both act on the page as a whole — a new project and the station list
          are not facts about Projects-vs-Customers-vs-Finance — so they are
          mounted ABOVE the tab bar and rendered UNCONDITIONALLY. Switching
          tabs must not move them or take them away, which is exactly what
          happened while they sat inside ProjectsBoard below its KPIs.
          PageHeader's `actions` slot is already top-right aligned; no
          positioning of our own, so the header keeps wrapping on narrow
          screens instead of overlapping the title. */}
      <PageHeader
        title={head.title}
        subtitle={head.subtitle}
        actions={
          <>
            <Btn variant="outline" onClick={() => setManagingStations(true)}>
              <Droplet className="h-4 w-4" /> Manage stations
            </Btn>
            <NewProjectModal
              drivers={boardProps.drivers}
              trucks={boardProps.trucks}
              driverProjectNames={driverProjectNames}
              stations={boardProps.stations}
              driverStateById={boardProps.driverStateById}
              leaveUnavailable={boardProps.leaveLoadFailed}
            />
          </>
        }
      />
      {managingStations && (
        <WaterStationsModal
          open={managingStations}
          onClose={() => setManagingStations(false)}
          stations={boardProps.allStations}
        />
      )}

      {/* Tab bar — underline style mirrors the Drivers & People sub-tabs. */}
      <div
        className="flex items-center gap-1 border-b mb-4 flex-wrap"
        style={{ borderColor: "rgb(var(--border))" }}
      >
        <TabBtn active={tab === "projects"} onClick={() => setTab("projects")} label="Projects" />
        <TabBtn active={tab === "customers"} onClick={() => setTab("customers")} label="Customers" />
        <TabBtn active={tab === "finance"} onClick={() => setTab("finance")} label="Finance/Invoice" />
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
          topups={topups}
          balanceReturns={balanceReturns}
          specialCharges={specialCharges}
          paidInvoices={paidInvoices}
        />
      )}

      {tab === "finance" && (
        <FinanceTab
          customers={boardProps.customers}
          projects={boardProps.projects}
          trips={boardProps.trips}
          topups={topups}
          balanceReturns={balanceReturns}
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
