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
import { type DriverState } from "@/lib/driver-state";
import { useApp } from "@/components/AppShell";
import { t, type Lang } from "@/lib/i18n";

type Driver = { id: string; name: string; status?: string };
type TruckLite = {
  id: string;
  plate: string;
  assigned_driver_id: string | null;
  last_service_date: string | null;
};

// The twelve abbreviations were a module-level `const MONTH_SHORT`, frozen at
// import — one of three identical copies in this route. They now come from
// `common.monthShort`, which is why this takes `lang`.
//
// "YYYY-MM-DD" (Postgres date) → "DD Mon YYYY". Null/blank → null.
// ONLY the month NAME is translated. The day and the year stay Latin digits in
// both languages, because they are app-formatted numbers, not labels.
const MONTH_KEYS = ["1","2","3","4","5","6","7","8","9","10","11","12"] as const;
function fmtServiceDate(key: string | null, lang: Lang): string | null {
  if (!key) return null;
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return null;
  const mk = MONTH_KEYS[m - 1];
  if (!mk) return null;
  return `${d} ${t(`common.monthShort.${mk}`, lang)} ${y}`;
}

export default function DriverRosterTable({
  drivers,
  trucks,
  driverProjectNames,
  selected,
  onToggle,
  stateByDriver,
  leaveUnavailable,
}: {
  drivers: Driver[];
  trucks: TruckLite[];
  driverProjectNames: Record<string, string[]>;
  selected: string[];
  onToggle: (id: string) => void;
  // Derived driver-state map (display-only Status pill). Optional: omit to hide.
  // Also drives roster gating: on_leave (today) is BLOCKED here (off_duty /
  // no-truck drivers stay rosterable).
  stateByDriver?: Record<string, DriverState>;
  // Fail-safe: leave data failed to load — block NEW selections (don't fail-open).
  // Already-selected drivers are preserved (locked, not dropped).
  leaveUnavailable?: boolean;
}) {
  const { lang } = useApp();
  // `tr`, not `t` — see DriverDutyTable: the translator must not be shadowed.
  // driver_id → its truck (0/1 per driver via the unique partial index).
  const truckByDriver = useMemo(() => {
    const m = new Map<string, TruckLite>();
    for (const tr of trucks) if (tr.assigned_driver_id) m.set(tr.assigned_driver_id, tr);
    return m;
  }, [trucks]);

  if (drivers.length === 0) {
    return (
      <div className="rounded-lg border border-app px-3 py-4 text-center text-sm muted">
        {t("trips.driverTable.emptyRoster", lang)}
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
              <TH>{t("trips.driverTable.lastServiced", lang)}</TH>
              <TH>{t("trips.driverTable.projectsCol", lang)}</TH>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => {
              const on = selected.includes(d.id);
              const truck = truckByDriver.get(d.id) ?? null;
              const serviced = truck ? fmtServiceDate(truck.last_service_date, lang) : null;
              const projNames = driverProjectNames[d.id] ?? [];
              // Roster gating: on_leave (today) is BLOCKED. off_duty (no truck)
              // stays selectable. On leave-load failure, block everything.
              // LOCK blocked rows (no toggle) — this both prevents NEW selection and
              // preserves an ALREADY-selected driver who just became blocked (their
              // assignment is never silently dropped).
              const state = stateByDriver?.[d.id];
              const blockedByState = state === "on_leave";
              const locked = !!leaveUnavailable || blockedByState;
              const reason =
                state === "on_leave"
                  ? t("trips.driverTable.onLeave", lang)
                  : leaveUnavailable
                    ? t("trips.driverTable.leaveUnavailable", lang)
                    : null;
              return (
                <tr
                  key={d.id}
                  onClick={locked ? undefined : () => onToggle(d.id)}
                  className={
                    locked
                      ? "cursor-not-allowed " + (on ? "opacity-70 bg-brand-500/5" : "opacity-50")
                      : "cursor-pointer " +
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
                  <TD className="font-medium">
                    {d.name}
                    {locked && reason && (
                      <div className="text-[11px] font-normal text-amber-600 dark:text-amber-400">
                        {reason}
                        {on ? t("trips.driverTable.kept", lang) : ""}
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
