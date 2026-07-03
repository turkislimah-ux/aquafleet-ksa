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
import { Table, TH, TD, StatusPill } from "@/components/ui";
import { DRIVER_STATE_LABELS, type DriverState } from "@/lib/driver-state";

type Driver = { id: string; name: string; status?: string };
type TruckLite = { id: string; plate: string; assigned_driver_id: string | null };
type Duty = { onDuty: number; lastDelivered: string | null };

export default function DriverDutyTable({
  drivers,
  trucks,
  dutyByDriver,
  selected,
  onSelect,
  stateByDriver,
  leaveBlockedIds,
  leaveUnavailable,
}: {
  drivers: Driver[];
  trucks: TruckLite[];
  dutyByDriver: Record<string, Duty>;
  selected: string | null;
  onSelect: (id: string) => void;
  // Derived driver-state map (display-only Status pill). Optional: omit to hide.
  stateByDriver?: Record<string, DriverState>;
  // driver_ids on leave for the SELECTED trip day (parent resolves via
  // resolveOnLeave). A blocked driver can't take a trip that day.
  leaveBlockedIds?: Set<string>;
  // Fail-safe: leave data failed to load — block EVERYONE (don't fail-open into
  // "nobody on leave"). Shows a distinct reason.
  leaveUnavailable?: boolean;
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
              {stateByDriver && <TH>Status</TH>}
              <TH>Assigned truck</TH>
              <TH>On duty</TH>
              <TH>Last delivered</TH>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => {
              const on = selected === d.id;
              const truck = truckByDriver.get(d.id) ?? null;
              // BLOCKED (fogged + not selectable) if ANY: on leave for the selected
              // trip day, or no truck (can't dispatch). Leave is resolved for the
              // selected day by the parent. Reason priority: leave > no-truck.
              const onLeaveSel = !!leaveUnavailable || !!leaveBlockedIds?.has(d.id);
              const noTruck = !truck;
              const disabled = onLeaveSel || noTruck;
              const reason = onLeaveSel
                ? leaveUnavailable
                  ? "Leave unavailable"
                  : "On leave"
                : noTruck
                  ? "No truck"
                  : null;
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
                  <TD className="font-medium">
                    {d.name}
                    {disabled && reason && (
                      <div className="text-[11px] font-normal text-amber-600 dark:text-amber-400">
                        {reason}
                      </div>
                    )}
                  </TD>
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
