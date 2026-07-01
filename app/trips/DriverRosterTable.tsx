"use client";

// Component A — the all-drivers multi-select roster used by the project form
// (ProjectModal, both create + edit). Purely presentational: the PARENT owns the
// selection (`selected` + `onToggle`); this just renders the table and reports
// clicks. Columns: Driver · Assigned Truck · Truck's Last Serviced · Project(s).
//
// Truck-by-driver + last-serviced are derived here from the flat `trucks` list
// (trucks.assigned_driver_id is a 0/1-per-driver link). Project memberships come
// pre-shaped from the parent as driverProjectNames[driver_id] = [project name…].

import { useMemo } from "react";
import { Check } from "lucide-react";
import { Table, TH, TD, StatusPill } from "@/components/ui";
import { DRIVER_STATE_LABELS, type DriverState } from "@/lib/driver-state";

type Driver = { id: string; name: string; status?: string };
type TruckLite = {
  id: string;
  plate: string;
  assigned_driver_id: string | null;
  last_service_date: string | null;
};

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// "YYYY-MM-DD" (Postgres date) → "DD Mon YYYY". Null/blank → null.
function fmtServiceDate(key: string | null): string | null {
  if (!key) return null;
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return null;
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}

export default function DriverRosterTable({
  drivers,
  trucks,
  driverProjectNames,
  selected,
  onToggle,
  stateByDriver,
}: {
  drivers: Driver[];
  trucks: TruckLite[];
  driverProjectNames: Record<string, string[]>;
  selected: string[];
  onToggle: (id: string) => void;
  // Derived driver-state map (display-only Status pill). Optional: omit to hide.
  stateByDriver?: Record<string, DriverState>;
}) {
  // driver_id → its truck (0/1 per driver via the unique partial index).
  const truckByDriver = useMemo(() => {
    const m = new Map<string, TruckLite>();
    for (const t of trucks) if (t.assigned_driver_id) m.set(t.assigned_driver_id, t);
    return m;
  }, [trucks]);

  if (drivers.length === 0) {
    return (
      <div className="rounded-lg border border-app px-3 py-4 text-center text-sm muted">
        No drivers available.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-app overflow-hidden">
      <div className="max-h-64 overflow-y-auto scrollbar-thin">
        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH></TH>
              <TH>Driver</TH>
              {stateByDriver && <TH>Status</TH>}
              <TH>Assigned truck</TH>
              <TH>Last serviced</TH>
              <TH>Project(s)</TH>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => {
              const on = selected.includes(d.id);
              const truck = truckByDriver.get(d.id) ?? null;
              const serviced = truck ? fmtServiceDate(truck.last_service_date) : null;
              const projNames = driverProjectNames[d.id] ?? [];
              return (
                <tr
                  key={d.id}
                  onClick={() => onToggle(d.id)}
                  className={
                    "cursor-pointer " +
                    (on ? "bg-brand-500/10" : "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]")
                  }
                >
                  <TD>
                    <span
                      className={
                        "grid place-items-center h-5 w-5 rounded-full border " +
                        (on ? "bg-brand-600 border-brand-600 text-white" : "border-app")
                      }
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                  </TD>
                  <TD className="font-medium">{d.name}</TD>
                  {stateByDriver && (
                    <TD>
                      {stateByDriver[d.id] ? (
                        <StatusPill status={stateByDriver[d.id]} label={DRIVER_STATE_LABELS[stateByDriver[d.id]]} />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </TD>
                  )}
                  <TD>
                    {truck ? (
                      <span className="tabular-nums">{truck.plate}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </TD>
                  <TD className="text-xs">
                    {serviced ?? <span className="muted">—</span>}
                  </TD>
                  <TD className="max-w-[14rem]">
                    {projNames.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {projNames.map((n) => (
                          <span
                            key={n}
                            className="inline-block rounded-full border border-app px-2 py-0.5 text-[11px] muted"
                          >
                            {n}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </TD>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
