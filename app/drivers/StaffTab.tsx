"use client";

// Management & Support Staff — the third Drivers & People tab. Deliberate
// deviations from the demo (the demo-faithful grid + Add Staff already shipped):
//   • "Branch of operation" label (column is still `station`).
//   • Roles come from the staff_roles lookup (built-in + custom); the dropdown
//     has an inline "Add custom role" that inserts a new role on the fly.
//   • Cards are clickable → a detail modal with view / Edit / Terminate
//     (soft delete: stamps terminated_at, keeps the row). A leave section is
//     stubbed for the future leave system.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Pencil, Ban, History, Wrench } from "lucide-react";
import { Btn, Stat } from "@/components/ui";
import { useApp } from "@/components/AppShell";
import { t, fill, plural, arText, type Lang } from "@/lib/i18n";
import { type Staff, type StaffRole, type OperationStation, type StaffCommission, type StaffCommissionType } from "@/lib/db-types";
import { onLeaveTodaySet, leaveDaysInYear, type LeavePeriod, type LeaveType } from "@/lib/leave";
import { addDaysToKey, formatDate, formatSar } from "@/lib/utils";
import { createStaff, updateStaff, terminateStaff, addStaffRole } from "./actions";
import LeaveSection from "./LeaveSection";
import SalaryHistoryModal from "./SalaryHistoryModal";
import MechanicCommissionsSection from "./MechanicCommissionsSection";
import OperationStationField from "@/components/OperationStationField";
import PersonIdLink from "./PersonIdLink";
import LookupSelect from "./LookupSelect";
import LinkedIdField from "@/components/LinkedIdField";
import { useRecordFocus } from "@/lib/useRecordFocus";
import ScrollLock from "@/components/ScrollLock";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// The five `staff_roles.is_default = true` keys (0011). A const tuple so that
// `drivers.role.${key}` types as five real TKeys rather than `string`.
const BUILTIN_ROLE_KEYS = ["fleet_manager", "ops_supervisor", "mechanic", "inventory_clerk", "dispatcher"] as const;
type BuiltinRoleKey = (typeof BUILTIN_ROLE_KEYS)[number];
const isBuiltinRole = (key: string): key is BuiltinRoleKey =>
  (BUILTIN_ROLE_KEYS as readonly string[]).includes(key);

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function StaffTab({
  staff,
  staffRoles,
  leavePeriods,
  leaveTypes,
  operationStations,
  today,
  staffCommissions,
  commissionTypes,
  openAddSignal,
  openWoByMechanic,
  truckCount,
}: {
  staff: Staff[];
  staffRoles: StaffRole[];
  leavePeriods: LeavePeriod[];
  leaveTypes: LeaveType[];
  operationStations: OperationStation[];
  today: string;
  // Polish item 4 — mechanic commissions (0080). Unfiltered fetch (same
  // "one fetch, split/filter client-side" convention as leavePeriods
  // above); MechanicCommissionsSection itself reads the mechanic's own
  // live active/terminated_at to decide whether to show anything.
  staffCommissions: StaffCommission[];
  commissionTypes: StaffCommissionType[];
  // Item 5 — a NONCE, not a boolean. The Add staff button lives in the page
  // header (DriversClient owns that slot for both tabs); the form and its state
  // live here. Every CHANGE of this number opens the form, so pressing the
  // button again after cancelling still works — a boolean would need the child
  // to reach back up and reset it.
  openAddSignal: number;
  // staff_id -> count of OPEN work orders assigned to that mechanic
  // (work_orders.assigned_mechanic_id, status open/in_progress/awaiting_parts).
  // Fetched by the page, not here — this component never queries.
  openWoByMechanic: Record<string, number>;
  // Total non-terminated trucks, for the mechanics-to-truck ratio.
  truckCount: number;
}) {
  const { lang } = useApp();
  const router = useRouter();
  const [detail, setDetail] = useState<Staff | null>(null);
  // Salary-history modal target. Same screen the driver detail opens — the modal
  // and its actions are subject-agnostic, so this is a button, not a feature.
  const [salaryHistoryFor, setSalaryHistoryFor] =
    useState<{ id: string; name: string; salary: number | null } | null>(null);

  // Global-search record focus (?focus=staff:<id>). Lives here rather than
  // in DriversClient because this component owns the staff detail modal —
  // and the href already carries ?tab=staff, so this tab is mounted.
  useRecordFocus(["staff"], (_e, id) => {
    const st = staff.find((x) => x.id === id);
    if (st) setDetail(st);
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // The five built-ins translate off their immutable `key` and NEVER consult
  // `label_ar` — their Arabic lives in the dictionary, and 0168 left the column
  // NULL on those rows. A custom role goes through `arText`: Arabic shows
  // `label_ar` when it has one and falls back to the English `label` when it
  // does not, and English mode always shows `label`. staff_roles holds only
  // active roles; an assigned role that was later deactivated still falls back
  // to showing its raw key.
  const roleName = (key: string) => {
    if (isBuiltinRole(key)) return t(`drivers.role.${key}`, lang);
    const row = staffRoles.find((r) => r.key === key);
    return row ? arText(row.label, row.label_ar, lang) : key;
  };
  // uuid -> name, built from ALL operation_stations rows (active + inactive) so
  // a staff member based at a since-deactivated station still resolves here.
  const stationNameById = useMemo(
    () => new Map(operationStations.map((s) => [s.id, s.name])),
    [operationStations],
  );
  const stationName = (id: string | null) => (id ? stationNameById.get(id) ?? null : null);

  // COMPUTED on-leave-today for staff. Staff carry no status enum, so on-leave is
  // derived purely from leave_periods (lib/leave) — never a stored flag.
  const onLeaveStaff = useMemo(() => onLeaveTodaySet(leavePeriods, today).staff, [leavePeriods, today]);
  const leaveByStaff = useMemo(() => {
    const m = new Map<string, LeavePeriod[]>();
    for (const p of leavePeriods) {
      if (!p.staff_id) continue;
      (m.get(p.staff_id) ?? m.set(p.staff_id, []).get(p.staff_id)!).push(p);
    }
    return m;
  }, [leavePeriods]);
  // Current-year leave-day total per staff member (card badge). Year comes
  // from `today` (Riyadh local date, passed in — never re-derived here).
  const currentYear = Number(today.slice(0, 4));
  const leaveDaysByStaff = useMemo(() => {
    const m = new Map<string, number>();
    for (const [staffId, periods] of leaveByStaff) m.set(staffId, leaveDaysInYear(periods, currentYear));
    return m;
  }, [leaveByStaff, currentYear]);

  // Polish item 4 — mechanic commissions grouped by staff, same pattern as
  // leaveByStaff above.
  const commissionsByStaff = useMemo(() => {
    const m = new Map<string, StaffCommission[]>();
    for (const c of staffCommissions) {
      (m.get(c.staff_id) ?? m.set(c.staff_id, []).get(c.staff_id)!).push(c);
    }
    return m;
  }, [staffCommissions]);

  // NOTE: there is no openNew() any more. Its only caller was the in-card Add
  // staff button, which moved to the page header (Item 5) — the openAddSignal
  // effect below does the same three writes inline rather than leaving a
  // one-caller helper behind. openEdit is unaffected; the detail modal still
  // uses it.
  function openEdit(s: Staff) {
    setEditing(s);
    setFormError(null);
    setFormOpen(true);
  }
  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  // Item 5 — the header button's nonce. 0 is the initial value DriversClient
  // mounts with and is deliberately ignored, so the form does not fly open on
  // first render; every later value is a real press.
  useEffect(() => {
    if (openAddSignal === 0) return;
    setEditing(null);
    setFormError(null);
    setFormOpen(true);
  }, [openAddSignal]);

  // ---- Item 6: staff-only KPIs -------------------------------------------
  // STAFF ONLY. Drivers have their own KPI row one level up and are a different
  // table entirely; nothing here counts a driver.
  const activeHeadcount = useMemo(
    () => staff.filter((s) => s.active && !s.terminated_at).length,
    [staff],
  );

  // Iqama expiring soon — 90 days, not 60. An iqama renewal is a
  // multi-week errand (medical, fees, employer paperwork), so a 60-day window
  // would surface a case that is already late. Computed off `today` (the Riyadh
  // date passed in) — never `new Date()` here.
  //
  // The shift goes through addDaysToKey rather than a local `new Date(...)` +
  // toISOString() round trip: that pair parses local and serializes UTC, which
  // in Riyadh made this a 89-day window while the comment above claimed 90.
  const iqamaSoon = useMemo(() => {
    const endKey = addDaysToKey(today, 90);
    // Already-expired dates count too: they are the most urgent version of the
    // same problem, and hiding them behind a "soon" window would make the
    // number shrink the day a renewal is missed.
    return staff.filter((s) => s.iqama_expiry != null && s.iqama_expiry <= endKey).length;
  }, [staff, today]);

  // Headcount per branch of operation. A staff member with no station gets a
  // real "Unassigned" row rather than being dropped — an unbased employee is
  // something to notice, not something to hide.
  //
  // The bucket carries NULL for that row, not the word: a display string
  // composed inside a memo keyed on data alone would keep the old language
  // after a lang flip. Grouping is still by resolved NAME (not by station id),
  // so an id that no longer resolves keeps merging into the same bucket as a
  // staff member with no station at all — one "Unassigned" row, as before.
  const byStation = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const s of staff) {
      const name = stationName(s.station);
      m.set(name, (m.get(name) ?? 0) + 1);
    }
    return Array.from(m, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    // stationName closes over stationNameById; that map is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff, stationNameById]);

  // Mechanics team — role === 'mechanic' ONLY. head_of_maintenance is
  // deliberately EXCLUDED: he supervises the team, he is not a spare pair of
  // hands on the ratio, and counting him would flatter every figure below.
  const mechanics = useMemo(() => staff.filter((s) => s.role === "mechanic" && !s.terminated_at), [staff]);
  const mechanicOpenWo = useMemo(
    () => mechanics.reduce((n, m) => n + (openWoByMechanic[m.id] ?? 0), 0),
    [mechanics, openWoByMechanic],
  );
  // "With duty hours set" — NOT a live clock-in state. staff.duty_hours is a
  // shift LENGTH (NOT NULL, DB default 10), so this says how many mechanics
  // have a shift on record, and nothing at all about who is at the workshop
  // right now. Labelled that way on screen for the same reason.
  const mechanicsWithDuty = useMemo(
    () => mechanics.filter((m) => m.duty_hours != null && m.duty_hours > 0).length,
    [mechanics],
  );
  const trucksPerMechanic = mechanics.length > 0 ? truckCount / mechanics.length : null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSaving(true);
    setFormError(null);
    const res = editing ? await updateStaff(editing.id, fd) : await createStaff(fd);
    setSaving(false);
    if (res.error) {
      setFormError(res.error);
      return;
    }
    closeForm();
    router.refresh();
  }

  async function onTerminate(s: Staff) {
    if (!confirm(fill(t("drivers.staff.confirmTerminate", lang), { name: arText(s.name, s.name_ar, lang) }))) return;
    const res = await terminateStaff(s.id);
    if (res.error) {
      alert(res.error);
      return;
    }
    setDetail(null);
    router.refresh();
  }

  return (
    <div>
      {/* Item 6 — staff-only KPIs. Two plain figures, then two cards that
          carry a LIST rather than a single number: a per-branch headcount and
          the mechanics cluster. Both are given two columns each because a
          breakdown squeezed into a quarter-width Stat card would be unreadable
          at exactly the moment it stops being one line long. */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
        <Stat label={t("drivers.staff.kpiActive", lang)} value={activeHeadcount} tone="ok" />
        <Stat
          label={t("drivers.staff.kpiIqama", lang)}
          value={iqamaSoon}
          tone={iqamaSoon > 0 ? "warn" : "ok"}
        />

        <div className="card p-4 col-span-2">
          <div className="text-xs muted mb-2">{t("drivers.staff.byBranch", lang)}</div>
          {byStation.length === 0 ? (
            <p className="muted text-sm">{t("drivers.staff.none", lang)}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {byStation.map((s) => (
                <div key={s.name ?? ""} className="flex items-baseline justify-between gap-3 text-sm">
                  {/* Station names are stored English — operation_stations has
                      no name_ar column. Only the no-branch bucket translates. */}
                  <span className="truncate">{s.name ?? t("drivers.staff.unassigned", lang)}</span>
                  <span className="font-semibold tabular-nums">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-4 col-span-2">
          <div className="flex items-center gap-1.5 text-xs muted mb-2">
            <Wrench className="h-3.5 w-3.5" /> {t("drivers.staff.mechTeam", lang)}
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl font-semibold tabular-nums">{mechanics.length}</span>
            <span className="text-xs muted">{t("drivers.staff.mechCount", lang)}</span>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="muted">{t("drivers.staff.openWo", lang)}</span>
              <span className="font-semibold tabular-nums">{mechanicOpenWo}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="muted">{t("drivers.staff.trucksPer", lang)}</span>
              {/* A ratio is Latin in both languages — isolated on the span it
                  is rendered in, never on the row. */}
              <span className="font-semibold tabular-nums" dir="ltr">
                {trucksPerMechanic == null ? "—" : `${trucksPerMechanic.toFixed(1)} : 1`}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              {/* Wording is load-bearing: duty_hours is a shift LENGTH, so this
                  is "has a shift on record", never "is clocked in now". */}
              <span className="muted">{t("drivers.staff.withDuty", lang)}</span>
              <span className="font-semibold tabular-nums" dir="ltr">
                {mechanicsWithDuty}/{mechanics.length}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3 gap-3">
          {/* Item 5 — the Add staff button that used to sit here now lives in
              the page header beside New driver, so both tabs offer their
              primary action from the same slot. The form itself still lives
              here, opened by the openAddSignal effect above. */}
          <h3 className="font-semibold text-sm">{t("drivers.staff.title", lang)}</h3>
        </div>

        {staff.length === 0 ? (
          <p className="muted text-sm py-6 text-center">{t("drivers.staff.none", lang)}</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {staff.map((p) => {
              const leaveDays = leaveDaysByStaff.get(p.id) ?? 0;
              return (
              <button
                key={p.id}
                type="button"
                onClick={() => setDetail(p)}
                className={
                  "w-full text-start rounded-lg border border-app p-3 flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/5 transition " +
                  (p.active ? "" : "opacity-60")
                }
              >
                <div className="h-10 w-10 rounded-full text-white grid place-items-center text-sm font-semibold shrink-0" style={{ background: "#bd8b3f" }}>
                  {initials(p.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate flex items-center gap-1.5">
                    <span className="truncate">{arText(p.name, p.name_ar, lang)}</span>
                    {onLeaveStaff.has(p.id) && (
                      <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
                        {t("drivers.staff.onLeavePill", lang)}
                      </span>
                    )}

                    {/* Item 4 — the year-to-date leave tally, BESIDE THE NAME.
                        It first hung off the corner as an absolutely-positioned
                        badge on a wrapper div (a notification dot stuck ON the
                        card rather than a fact ABOUT the person), then sat at the
                        card's right edge, where it was inside the card but read
                        as a separate column with nothing tying it to whose leave
                        it was. Beside the name, the person and their leave read
                        as one unit — which is the whole claim the number makes.

                        Sized to the "On leave" pill it sits next to, not to its
                        old right-edge treatment: this row sets the card's height,
                        so the previous text-sm/px-2 chip would have pushed every
                        card taller for a figure most of them do not carry.

                        THE BASIS IS ON SCREEN, not only in the tooltip: "since
                        Jan 1" is the whole meaning of the number. Without it the
                        reader has to guess between a rolling 12 months, an
                        entitlement balance and a calendar-year tally, and those
                        are three different conversations to have with an employee.

                        DERIVED LIVE from leave_periods every render
                        (leaveDaysInYear(periods, currentYear) above) — there is NO
                        scheduled reset anywhere and there must never be one. A
                        cron that zeroed a stored counter each January would
                        destroy the prior year's record to produce a number this
                        expression gets for free: on 1 January the year rolls, no
                        period falls inside it yet, and this reads 0 on its own.

                        Distinct from the "On leave" pill immediately before it,
                        which is a state TODAY — they sit together deliberately,
                        one saying where the person is now and the other how much
                        of the year they have taken. Zero renders nothing: a
                        person who took no leave has nothing to report, and a "0d"
                        chip on most of the grid would drown the ones that
                        matter. */}
                    {leaveDays > 0 && (
                      <span
                        className="shrink-0 inline-flex items-baseline gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        title={fill(t(`drivers.staff.leaveSince.${plural(leaveDays)}`, lang), {
                          n: leaveDays,
                          year: currentYear,
                        })}
                      >
                        {/* The "d" stays Latin in both languages: the two spans
                            are styled differently, so the count cannot be folded
                            into one whole-sentence key, and splicing an Arabic
                            unit onto a number here is exactly the fragment seam
                            ruling 6 forbids. The full sentence is in the tooltip. */}
                        <span className="font-semibold tabular-nums" dir="ltr">{leaveDays}d</span>
                        <span className="opacity-80">{t("drivers.staff.sinceJan1", lang)}</span>
                      </span>
                    )}
                  </div>
                  <div className="text-xs muted truncate">
                    {roleName(p.role)}{stationName(p.station) ? ` · ${stationName(p.station)}` : ""}
                  </div>
                  <div className="text-[11px] muted truncate">{p.phone ?? "—"}</div>
                  {p.email && <div className="text-[11px] muted truncate">{p.email}</div>}
                </div>
              </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail modal — view + Edit + Terminate. */}
      {detail && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={() => setDetail(null)}>
          <ScrollLock />
          <div className="card p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-semibold">{t("drivers.staff.detailTitle", lang)}</h2>
              <button type="button" onClick={() => setDetail(null)} className="muted hover:text-[rgb(var(--fg))]"><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-4">
              <div className="card p-3 flex items-center gap-3">
                <div className="h-12 w-12 rounded-full text-white grid place-items-center text-lg font-semibold shrink-0" style={{ background: "#bd8b3f" }}>
                  {initials(detail.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">
                    {detail.name}{detail.name_ar ? <span className="muted font-normal"> · {detail.name_ar}</span> : null}
                  </div>
                  <div className="text-xs muted">{roleName(detail.role)}</div>
                </div>
                <StatusBadge s={detail} onLeave={onLeaveStaff.has(detail.id)} lang={lang} />
              </div>

              <div className="card p-3 grid grid-cols-2 gap-2">
                <Cell label={t("drivers.staff.fRole", lang)}>{roleName(detail.role)}</Cell>
                <Cell label={t("drivers.staff.fBranch", lang)}>{stationName(detail.station) ?? <span className="muted">—</span>}</Cell>
                <Cell label={t("drivers.staff.fEmail", lang)}>{detail.email ?? <span className="muted">—</span>}</Cell>
                <Cell label={t("drivers.staff.fPhone", lang)}>{detail.phone ?? <span className="muted">—</span>}</Cell>
                {/* Deep-links to this staff member's own row in the archive's
                    Management Staff matrix. */}
                <Cell label={t("drivers.staff.fIqama", lang)}>
                  <PersonIdLink personId={detail.id} sub="management" value={detail.iqama_number} />
                </Cell>
                <Cell label={t("drivers.staff.fIqamaExp", lang)}>{detail.iqama_expiry ?? <span className="muted">—</span>}</Cell>
                {/* Every branch here tests DATA — `terminated_at`, the computed
                    on-leave set, `active` — never a rendered word. */}
                <Cell label={t("drivers.staff.fStatus", lang)}>
                  {detail.terminated_at
                    ? fill(t("drivers.staff.terminatedOn", lang), { d: formatDate(detail.terminated_at) })
                    : onLeaveStaff.has(detail.id)
                      ? t("drivers.staff.stOnLeaveToday", lang)
                      : detail.active ? t("drivers.staff.stActive", lang) : t("drivers.staff.stInactive", lang)}
                </Cell>
                {/* Staff salary had NO cell here at all — it was only editable
                    on the form and never shown. It is added alongside the
                    history link rather than separately, because a figure with
                    no timeline beside it is what let salary drift unnoticed in
                    the first place. Mirrors the driver detail exactly. */}
                <Cell label={t("drivers.salary.monthly", lang)}>
                  <span className="flex items-center gap-2">
                    {/* Money is `en-US`-formatted in both languages — isolated
                        on its own span, never on the cell. */}
                    <span className="font-semibold tabular-nums" dir="ltr">
                      {detail.monthly_salary_sar != null ? formatSar(detail.monthly_salary_sar) : "—"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSalaryHistoryFor({
                        id: detail.id, name: detail.name, salary: detail.monthly_salary_sar ?? null,
                      })}
                      className="text-brand-600 dark:text-brand-300 hover:underline text-xs inline-flex items-center gap-1"
                      title={t("drivers.salary.openTitle", lang)}
                    >
                      <History className="h-3.5 w-3.5" /> {t("drivers.salary.openBtn", lang)}
                    </button>
                  </span>
                </Cell>
              </div>

              <SalaryHistoryModal
                open={salaryHistoryFor !== null}
                onClose={() => setSalaryHistoryFor(null)}
                subject={salaryHistoryFor ? { staffId: salaryHistoryFor.id } : null}
                personName={salaryHistoryFor?.name ?? ""}
                currentSalary={salaryHistoryFor?.salary ?? null}
              />

              {/* Leave & absence — same reusable section as the driver detail. */}
              <LeaveSection
                kind="staff"
                personId={detail.id}
                periods={leaveByStaff.get(detail.id) ?? []}
                leaveTypes={leaveTypes}
                today={today}
              />

              {/* Polish item 4 — mechanic commissions, role='mechanic' ONLY. */}
              {detail.role === "mechanic" && (
                <MechanicCommissionsSection
                  mechanic={detail}
                  commissions={commissionsByStaff.get(detail.id) ?? []}
                  commissionTypes={commissionTypes}
                />
              )}
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <Btn variant="outline" onClick={() => setDetail(null)}>{t("drivers.close", lang)}</Btn>
              {!detail.terminated_at && (
                <button
                  type="button"
                  onClick={() => onTerminate(detail)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition"
                >
                  <Ban className="h-3.5 w-3.5" /> {t("drivers.staff.terminate", lang)}
                </button>
              )}
              <Btn variant="primary" onClick={() => { const s = detail; setDetail(null); openEdit(s); }}>
                <Pencil className="h-3.5 w-3.5" /> {t("common.edit", lang)}
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit form. */}
      {formOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={closeForm}>
          <ScrollLock />
          <div className="card p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">{editing ? t("drivers.staff.editTitle", lang) : t("drivers.staff.addTitle", lang)}</h2>
            <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={t("drivers.staff.fName", lang)}>
                <input name="name" required defaultValue={editing?.name ?? ""} placeholder={t("drivers.staff.phName", lang)} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label={t("drivers.staff.fNameAr", lang)}>
                <input name="name_ar" dir="rtl" defaultValue={editing?.name_ar ?? ""} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label={t("drivers.staff.fRole", lang)}>
                {/* LookupSelect IS the generalized RoleSelect — this page carried
                    both, line for line the same component, until the cleanup.
                    `addStaffRole` already matches its `onAdd` signature exactly,
                    so no adapter is needed; only the copy is passed in.
                    Options run through the same roleName() the rest of the tab
                    uses, so the five built-ins read the same in the dropdown as
                    they do on the card. */}
                <LookupSelect
                  name="role"
                  items={staffRoles.map((r) => ({ key: r.key, label: roleName(r.key) }))}
                  defaultKey={editing?.role ?? staffRoles[0]?.key ?? ""}
                  onAdd={addStaffRole}
                  // staff_roles has label_ar as of 0168, so the add form collects it.
                  withArabicName
                  addLabel={t("drivers.staff.addRole", lang)}
                  newPlaceholder={t("drivers.staff.phNewRole", lang)}
                />
              </Field>
              <Field label={t("drivers.staff.fDutyHours", lang)}>
                <input name="duty_hours" type="number" step="1" min="0" defaultValue={editing?.duty_hours ?? 10} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label={t("drivers.staff.fSalaryInput", lang)}>
                <input
                  name="monthly_salary_sar"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing?.monthly_salary_sar ?? ""}
                  placeholder={t("drivers.staff.phSalary", lang)}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </Field>
              <OperationStationField
                name="station"
                stations={operationStations}
                defaultValue={editing?.station ?? null}
                label={t("drivers.staff.fBranch", lang)}
              />
              <Field label={t("drivers.staff.fEmail", lang)}>
                <input name="email" type="email" defaultValue={editing?.email ?? ""} placeholder={t("drivers.staff.phEmail", lang)} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label={t("drivers.staff.fPhone", lang)}>
                <input name="phone" defaultValue={editing?.phone ?? ""} placeholder={t("drivers.staff.phPhone", lang)} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label={t("drivers.staff.fHireDate", lang)}>
                <input name="hire_date" type="date" defaultValue={editing?.hire_date ?? ""} className={INPUT} style={INPUT_STYLE} />
              </Field>
              {/* LINKED IDENTITY FIELDS (0088/0089) — seed at creation, then
                  read-only. The Archive is the single edit point; see the
                  matching block in DriversClient.tsx for the full reasoning. */}
              <Field label={t("drivers.staff.fIqama", lang)}>
                <LinkedIdField
                  name="iqama_number"
                  value={editing?.iqama_number ?? ""}
                  locked={!!editing}
                  archiveHref={editing?.id ? `/archive?tab=staff&sub=management&person=${editing.id}` : null}
                />
              </Field>
              <Field label={t("drivers.staff.fIqamaExp", lang)}>
                <LinkedIdField
                  name="iqama_expiry"
                  type="date"
                  value={editing?.iqama_expiry ?? ""}
                  locked={!!editing}
                  archiveHref={editing?.id ? `/archive?tab=staff&sub=management&person=${editing.id}` : null}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input name="active" type="checkbox" defaultChecked={editing ? editing.active : true} />
                <span>{t("drivers.staff.fActive", lang)}</span>
              </label>

              {formError && <p className="text-sm text-rose-600 dark:text-rose-400 sm:col-span-2">{formError}</p>}

              <div className="flex justify-end gap-2 sm:col-span-2 mt-2">
                <Btn variant="outline" onClick={closeForm}>{t("common.cancel", lang)}</Btn>
                <Btn type="submit" variant="primary">{saving ? t("common.saving", lang) : editing ? t("common.save", lang) : t("drivers.staff.addTitle", lang)}</Btn>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// `RoleSelect` used to sit here — a role dropdown with an inline "Add custom
// role", line for line the same component as ./LookupSelect, which was written
// later as its generalized form and already carries LookupSelect's own header
// saying so. The Role field mounts LookupSelect directly now; `addStaffRole`
// already matches its `onAdd` signature, so nothing adapts between them. Do not
// re-add a role-specific copy: the role wording that users actually see is
// passed in through `addLabel`/`newPlaceholder`.

// Staff carry their OWN four status words — this badge does not read
// DRIVER_STATE_LABELS and must not start to: a staff member has no derived
// driver state, and `Inactive` has no counterpart on the driver side at all.
function StatusBadge({ s, onLeave, lang }: { s: Staff; onLeave: boolean; lang: Lang }) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ";
  // Terminated wins; on-leave-today (computed) outranks plain active/inactive.
  // Every test is on data, never on the word the previous branch would render.
  if (s.terminated_at) return <span className={base + "bg-rose-500/10 text-rose-600 dark:text-rose-400"}>{t("drivers.staff.stTerminated", lang)}</span>;
  if (onLeave) return <span className={base + "bg-amber-500/10 text-amber-600 dark:text-amber-400"}>{t("drivers.staff.stOnLeave", lang)}</span>;
  return s.active
    ? <span className={base + "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}>{t("drivers.staff.stActive", lang)}</span>
    : <span className={base + "bg-slate-500/10 text-slate-600 dark:text-slate-400"}>{t("drivers.staff.stInactive", lang)}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="muted">{label}</span>
      {children}
    </label>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs muted">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
