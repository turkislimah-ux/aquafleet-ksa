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
import { type DriverState } from "@/lib/driver-state";
import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";

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
  const { lang } = useApp();
  // `tr` because `t` is this file's loop variable for a truck row — shadowing
  // the translator inside the map would be a silent capture, not a tsc error.
  const truckByDriver = useMemo(() => {
    const m = new Map<string, TruckLite>();
    for (const tr of trucks) if (tr.assigned_driver_id) m.set(tr.assigned_driver_id, tr);
    return m;
  }, [trucks]);

  if (drivers.length === 0) {
    return (
      <div className="rounded-lg border border-app px-3 py-4 text-center text-sm muted">
        {t("trips.driverTable.emptyDuty", lang)}
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
              <TH>{t("common.driver", lang)}</TH>
              {stateByDriver && <TH>{t("common.status", lang)}</TH>}
              <TH>{t("trips.driverTable.assignedTruck", lang)}</TH>
              <TH>{t("trips.driverTable.onDuty", lang)}</TH>
              <TH>{t("trips.driverTable.lastDelivered", lang)}</TH>
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
                  ? t("trips.driverTable.leaveUnavailable", lang)
                  : t("trips.driverTable.onLeave", lang)
                : noTruck
                  ? t("trips.driverTable.noTruck", lang)
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
                        <StatusPill
                          status={stateByDriver[d.id]}
                          label={t(`fleet.driverState.${stateByDriver[d.id]}`, lang)}
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </TD>
                  )}
                  <TD>
                    {truck ? (
                      <span className="tabular-nums">{truck.plate}</span>
                    ) : (
                      <span className="muted">{t("trips.driverTable.noTruckCell", lang)}</span>
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
