"use client";

// New Project trigger (Trips page, Projects tab — below the KPIs). Thin wrapper:
// the "New Project" button + open state, delegating the whole form to the shared
// ProjectModal in create mode. Edit ("Manage project") reuses the same modal from
// CustomersTab. One submit creates a customer + linked project + driver
// assignments atomically via createProjectWithCustomer (RPC, migration 0016).

import { useState } from "react";
import { Plus } from "lucide-react";
import { Btn } from "@/components/ui";
import { type DriverState } from "@/lib/driver-state";
import ProjectModal from "./ProjectModal";
import { type SelectableStation } from "@/lib/station-pricing";
import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";

type Driver = { id: string; name: string; status?: string };
type TruckLite = {
  id: string;
  plate: string;
  assigned_driver_id: string | null;
  last_service_date: string | null;
};
// Imported, not re-declared: this was a bare { key, name, is_default? } that
// dropped the price columns the station gate reads. See SelectableStation.
type Station = SelectableStation;

export default function NewProjectModal({
  drivers,
  trucks,
  driverProjectNames,
  stations,
  driverStateById,
  leaveUnavailable,
}: {
  drivers: Driver[];
  trucks: TruckLite[];
  driverProjectNames: Record<string, string[]>;
  stations: Station[];
  driverStateById?: Record<string, DriverState>;
  // Fail-safe: leave data failed to load — block NEW roster selections.
  leaveUnavailable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { lang } = useApp();

  return (
    <>
      <Btn variant="primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> {t("trips.shell.newProject", lang)}
      </Btn>
      <ProjectModal
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        drivers={drivers}
        trucks={trucks}
        driverProjectNames={driverProjectNames}
        stations={stations}
        driverStateById={driverStateById}
        leaveUnavailable={leaveUnavailable}
      />
    </>
  );
}
