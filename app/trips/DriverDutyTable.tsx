"use client";

// Component B — the project-drivers OPERATIONAL table used by Add Trip
// (CreateTripForm). Single-select (radio-style: one driver per trip). Purely
// presentational: the PARENT owns the selection (`selected` + `onSelect`) and
// supplies the per-driver duty figures. Columns: Driver · Assigned Truck ·
// Current Trips on Duty · Last Delivered.
//
// Duty + last-delivered are ALL-TRIPS per driver (their total live workload /
// most recent delivery anywhere), computed in the parent from the full trip set.
// Truck-by-driver is derived here from the flat `trucks` list (0/1 per driver).

import { useMemo } from "react";
import { Table, TH, TD } from "@/components/ui";

type Driver = { id: string; name: string; status?: string };
type TruckLite = { id: string; plate: string; assigned_driver_id: string | null };
type Duty = { onDuty: number; lastDelivered: string | null };

export default function DriverDutyTable({
  drivers,
  trucks,
  dutyByDriver,
  selected,
  onSelect,
}: {
  drivers: Driver[];
  trucks: TruckLite[];
  dutyByDriver: Record<string, Duty>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const truckByDriver = useMemo(() => {
    const m = new Map<string, TruckLite>();
    for (const t of trucks) if (t.assigned_driver_id) m.set(t.assigned_driver_id, t);
    return m;
  }, [trucks]);

  if (drivers.length === 0) {
    return (
      <div className="rounded-lg border border-app px-3 py-4 text-center text-sm muted">
        No drivers available — assign drivers to this project first.
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
              <TH>Assigned truck</TH>
              <TH>On duty</TH>
              <TH>Last delivered</TH>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => {
              const on = selected === d.id;
              const truck = truckByDriver.get(d.id) ?? null;
              // No truck → can't dispatch: row is fogged + not selectable. (Truck is
              // auto-derived from the driver, so a pickable driver always has one.)
              const disabled = !truck;
              const duty = dutyByDriver[d.id] ?? { onDuty: 0, lastDelivered: null };
              return (
                <tr
                  key={d.id}
                  onClick={disabled ? undefined : () => onSelect(d.id)}
                  className={
                    disabled
                      ? "opacity-50 cursor-not-allowed"
                      : "cursor-pointer " +
                        (on ? "bg-brand-500/10" : "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]")
                  }
                >
                  <TD>
                    <span
                      className={
                        "grid place-items-center h-4 w-4 rounded-full border " +
                        (on ? "border-brand-600" : "border-app")
                      }
                    >
                      {on && <span className="h-2 w-2 rounded-full bg-brand-600" />}
                    </span>
                  </TD>
                  <TD className="font-medium">{d.name}</TD>
                  <TD>
                    {truck ? (
                      <span className="tabular-nums">{truck.plate}</span>
                    ) : (
                      <span className="muted">— no truck</span>
                    )}
                  </TD>
                  <TD className="tabular-nums">
                    {duty.onDuty > 0 ? (
                      duty.onDuty
                    ) : (
                      <span className="muted">0</span>
                    )}
                  </TD>
                  <TD className="text-xs">
                    {duty.lastDelivered ?? <span className="muted">—</span>}
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
