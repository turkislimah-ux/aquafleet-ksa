"use client";

// "Manage drivers" modal — assigns which drivers staff a project (the
// project_drivers join). Mirrors the demo: a scrollable driver list, click a
// row to toggle, live count, Save replaces the whole set via setProjectDrivers.
// Mounted from ProjectForm's per-row action.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Btn } from "@/components/ui";
import { cn } from "@/lib/utils";
import { DRIVER_STATUS_LABELS, type DriverStatus } from "@/lib/db-types";
import { setProjectDrivers } from "./actions";

export type DriverOption = { id: string; name: string; status: DriverStatus };

export default function ManageDriversModal({
  project,
  drivers,
  assigned,
  onClose,
}: {
  project: { id: string; name: string };
  drivers: DriverOption[];
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

        {drivers.length === 0 ? (
          <p className="text-sm muted">No drivers exist yet — add drivers first.</p>
        ) : (
          <div
            className="rounded-lg border divide-y max-h-[50vh] overflow-y-auto scrollbar-thin"
            style={{ borderColor: "rgb(var(--border))" }}
          >
            {drivers.map((d) => {
              const on = selected.has(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => toggle(d.id)}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2 text-sm text-start transition",
                    on ? "bg-emerald-500/10" : "hover:bg-black/5 dark:hover:bg-white/5"
                  )}
                  style={{ borderColor: "rgb(var(--border))" }}
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{d.name}</span>
                    <span className="text-xs muted">{DRIVER_STATUS_LABELS[d.status]}</span>
                  </span>
                  <span
                    className={cn(
                      "h-5 w-5 rounded-full grid place-items-center border transition",
                      on ? "bg-emerald-500 border-emerald-500 text-white" : "border-current muted"
                    )}
                  >
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                </button>
              );
            })}
          </div>
        )}

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
