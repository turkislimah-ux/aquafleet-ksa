"use client";

// "Manage drivers" modal — assigns which drivers staff a project (the
// project_drivers join). Mirrors the demo: a scrollable driver list, click a
// row to toggle, live count, Save replaces the whole set via setProjectDrivers.
// Mounted from ProjectForm's per-row action.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Btn } from "@/components/ui";
import { type DriverStatus } from "@/lib/db-types";
import DriverRosterTable from "../trips/DriverRosterTable";
import { setProjectDrivers } from "./actions";

export type DriverOption = { id: string; name: string; status: DriverStatus };
type TruckLite = {
  id: string;
  plate: string;
  assigned_driver_id: string | null;
  last_service_date: string | null;
};

export default function ManageDriversModal({
  project,
  drivers,
  trucks,
  driverProjectNames,
  assigned,
  onClose,
}: {
  project: { id: string; name: string };
  drivers: DriverOption[];
  trucks: TruckLite[];
  driverProjectNames: Record<string, string[]>;
  assigned: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(assigned));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await setProjectDrivers(project.id, Array.from(selected));
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Manage drivers</h2>
        <p className="text-sm muted mt-1 mb-4">
          {project.name} · {selected.size} selected
        </p>

        <DriverRosterTable
          drivers={drivers}
          trucks={trucks}
          driverProjectNames={driverProjectNames}
          selected={Array.from(selected)}
          onToggle={toggle}
        />

        {error && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <Btn variant="outline" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={save} className={saving ? "opacity-60 pointer-events-none" : ""}>
            {saving ? "Saving…" : "Save"}
          </Btn>
        </div>
      </div>
    </div>
  );
}
