"use client";

// New Project trigger (Trips page, Projects tab — below the KPIs). Thin wrapper:
// the "New Project" button + open state, delegating the whole form to the shared
// ProjectModal in create mode. Edit ("Manage project") reuses the same modal from
// CustomersTab. One submit creates a customer + linked project + driver
// assignments atomically via createProjectWithCustomer (RPC, migration 0016).

import { useState } from "react";
import { Plus } from "lucide-react";
import { Btn } from "@/components/ui";
import ProjectModal from "./ProjectModal";

type Driver = { id: string; name: string; status?: string };
type Station = { key: string; name: string; is_default?: boolean };

export default function NewProjectModal({
  drivers,
  stations,
}: {
  drivers: Driver[];
  stations: Station[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Btn variant="primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New Project
      </Btn>
      <ProjectModal
        mode="create"
        open={open}
        onClose={() => setOpen(false)}
        drivers={drivers}
        stations={stations}
      />
    </>
  );
}
