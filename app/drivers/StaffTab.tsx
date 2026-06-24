"use client";

// Management & Support Staff — the third Drivers & People tab. Deliberate
// deviations from the demo (the demo-faithful grid + Add Staff already shipped):
//   • "Branch of operation" label (column is still `station`).
//   • Roles come from the staff_roles lookup (built-in + custom); the dropdown
//     has an inline "Add custom role" that inserts a new role on the fly.
//   • Cards are clickable → a detail modal with view / Edit / Terminate
//     (soft delete: stamps terminated_at, keeps the row). A leave section is
//     stubbed for the future leave system.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Pencil, Ban } from "lucide-react";
import { Btn } from "@/components/ui";
import { type Staff, type StaffRole, STATION_OPTIONS } from "@/lib/db-types";
import { onLeaveTodaySet, type LeavePeriod, type LeaveType } from "@/lib/leave";
import { slugifyKey, isValidSlug } from "@/lib/slug";
import { cn } from "@/lib/utils";
import { createStaff, updateStaff, terminateStaff, addStaffRole } from "./actions";
import LeaveSection from "./LeaveSection";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

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
  today,
}: {
  staff: Staff[];
  staffRoles: StaffRole[];
  leavePeriods: LeavePeriod[];
  leaveTypes: LeaveType[];
  today: string;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<Staff | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // staff_roles holds only active roles; an assigned role that was later
  // deactivated falls back to showing its raw key.
  const roleName = (key: string) => staffRoles.find((r) => r.key === key)?.label ?? key;

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

  function openNew() {
    setEditing(null);
    setFormError(null);
    setFormOpen(true);
  }
  function openEdit(s: Staff) {
    setEditing(s);
    setFormError(null);
    setFormOpen(true);
  }
  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

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
    if (!confirm(`Terminate ${s.name}? The record is kept but removed from the active list.`)) return;
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
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3 gap-3">
          <h3 className="font-semibold text-sm">Management &amp; Support Staff</h3>
          <Btn variant="primary" onClick={openNew}>
            <Plus className="h-4 w-4" /> Add staff
          </Btn>
        </div>

        {staff.length === 0 ? (
          <p className="muted text-sm py-6 text-center">No staff yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {staff.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setDetail(p)}
                className={
                  "text-start rounded-lg border border-app p-3 flex items-center gap-3 hover:bg-black/5 dark:hover:bg-white/5 transition " +
                  (p.active ? "" : "opacity-60")
                }
              >
                <div className="h-10 w-10 rounded-full text-white grid place-items-center text-sm font-semibold shrink-0" style={{ background: "#bd8b3f" }}>
                  {initials(p.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate flex items-center gap-1.5">
                    <span className="truncate">{p.name}</span>
                    {onLeaveStaff.has(p.id) && (
                      <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
                        On leave
                      </span>
                    )}
                  </div>
                  <div className="text-xs muted truncate">
                    {roleName(p.role)}{p.station ? ` · ${p.station}` : ""}
                  </div>
                  <div className="text-[11px] muted truncate">{p.phone ?? "—"}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail modal — view + Edit + Terminate. */}
      {detail && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={() => setDetail(null)}>
          <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-semibold">Staff Member</h2>
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
                <StatusBadge s={detail} onLeave={onLeaveStaff.has(detail.id)} />
              </div>

              <div className="card p-3 grid grid-cols-2 gap-2">
                <Cell label="Role">{roleName(detail.role)}</Cell>
                <Cell label="Branch of operation">{detail.station ?? <span className="muted">—</span>}</Cell>
                <Cell label="Email">{detail.email ?? <span className="muted">—</span>}</Cell>
                <Cell label="Phone">{detail.phone ?? <span className="muted">—</span>}</Cell>
                <Cell label="Status">
                  {detail.terminated_at
                    ? `Terminated · ${new Date(detail.terminated_at).toLocaleDateString()}`
                    : onLeaveStaff.has(detail.id)
                      ? "On leave today"
                      : detail.active ? "Active" : "Inactive"}
                </Cell>
              </div>

              {/* Leave & absence — same reusable section as the driver detail. */}
              <LeaveSection
                kind="staff"
                personId={detail.id}
                periods={leaveByStaff.get(detail.id) ?? []}
                leaveTypes={leaveTypes}
                today={today}
              />
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <Btn variant="outline" onClick={() => setDetail(null)}>Close</Btn>
              {!detail.terminated_at && (
                <button
                  type="button"
                  onClick={() => onTerminate(detail)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition"
                >
                  <Ban className="h-3.5 w-3.5" /> Terminate
                </button>
              )}
              <Btn variant="primary" onClick={() => { const s = detail; setDetail(null); openEdit(s); }}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit form. */}
      {formOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={closeForm}>
          <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">{editing ? "Edit staff member" : "Add Staff Member"}</h2>
            <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Name *">
                <input name="name" required defaultValue={editing?.name ?? ""} placeholder="e.g. Omar Al-Qahtani" className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Name (Arabic)">
                <input name="name_ar" dir="rtl" defaultValue={editing?.name_ar ?? ""} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Role">
                <RoleSelect roles={staffRoles} defaultKey={editing?.role ?? staffRoles[0]?.key ?? ""} />
              </Field>
              <Field label="Branch of operation">
                <select name="station" defaultValue={editing?.station ?? ""} className={INPUT} style={INPUT_STYLE}>
                  <option value="">—</option>
                  {STATION_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Email">
                <input name="email" type="email" defaultValue={editing?.email ?? ""} placeholder="name@aquafleet.sa" className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Phone">
                <input name="phone" defaultValue={editing?.phone ?? ""} placeholder="+966 5…" className={INPUT} style={INPUT_STYLE} />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input name="active" type="checkbox" defaultChecked={editing ? editing.active : true} />
                <span>Active</span>
              </label>

              {formError && <p className="text-sm text-rose-600 dark:text-rose-400 sm:col-span-2">{formError}</p>}

              <div className="flex justify-end gap-2 sm:col-span-2 mt-2">
                <Btn variant="outline" onClick={closeForm}>Cancel</Btn>
                <Btn type="submit" variant="primary">{saving ? "Saving…" : editing ? "Save" : "Add Staff Member"}</Btn>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Role dropdown fed by staff_roles, with an inline "Add custom role" that inserts
// a new role and selects it immediately. A hidden input carries the chosen key
// into the surrounding form submit.
function RoleSelect({ roles, defaultKey }: { roles: StaffRole[]; defaultKey: string }) {
  const router = useRouter();
  const [extra, setExtra] = useState<{ key: string; label: string }[]>([]);
  const [value, setValue] = useState(defaultKey);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Merge fetched roles + locally-added + the current value (covers an inactive
  // role on edit that the fetch omitted). Dedup by key.
  const options = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of roles) map.set(r.key, r.label);
    for (const e of extra) if (!map.has(e.key)) map.set(e.key, e.label);
    if (value && !map.has(value)) map.set(value, value);
    return Array.from(map, ([key, lbl]) => ({ key, label: lbl }));
  }, [roles, extra, value]);

  // Live slug preview/gate (mirrors the DB CHECK via lib/slug). Empty label →
  // no preview, submit disabled. Invalid slug (starts with digit/_) → loud error.
  const slug = slugifyKey(label);
  const validSlug = isValidSlug(slug);
  const canAdd = slug !== "" && validSlug;

  async function onAdd() {
    const clean = label.trim();
    if (!clean) {
      setErr("Role name is required.");
      return;
    }
    if (!canAdd) {
      setErr("Label must start with a letter.");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await addStaffRole(clean);
    setBusy(false);
    if (res.error || !res.key) {
      setErr(res.error ?? "Could not add role.");
      return;
    }
    setExtra((x) => [...x, { key: res.key!, label: clean }]);
    setValue(res.key);
    setLabel("");
    setAdding(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {!adding ? (
        <select
          value={value}
          onChange={(e) => {
            if (e.target.value === "__add__") {
              setAdding(true);
              setErr(null);
            } else {
              setValue(e.target.value);
            }
          }}
          className={INPUT}
          style={INPUT_STYLE}
        >
          {options.length === 0 && <option value="">—</option>}
          {options.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
          <option value="__add__">+ Add custom role…</option>
        </select>
      ) : (
        <div className="flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="New role name"
            className={INPUT}
            style={INPUT_STYLE}
            autoFocus
          />
          <Btn
            type="button"
            variant="primary"
            onClick={onAdd}
            className={cn(!canAdd && "opacity-50 pointer-events-none")}
          >
            {busy ? "…" : "Add"}
          </Btn>
          <Btn type="button" variant="outline" onClick={() => { setAdding(false); setErr(null); }}>Cancel</Btn>
        </div>
      )}
      {adding && label.trim() !== "" && slug !== "" && (
        validSlug
          ? <p className="text-xs muted">Will be saved as: {slug}</p>
          : <p className="text-xs text-rose-600 dark:text-rose-400">Label must start with a letter.</p>
      )}
      {err && <p className="text-xs text-rose-600 dark:text-rose-400">{err}</p>}
      <input type="hidden" name="role" value={value} />
    </div>
  );
}

function StatusBadge({ s, onLeave }: { s: Staff; onLeave: boolean }) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ";
  // Terminated wins; on-leave-today (computed) outranks plain active/inactive.
  if (s.terminated_at) return <span className={base + "bg-rose-500/10 text-rose-600 dark:text-rose-400"}>Terminated</span>;
  if (onLeave) return <span className={base + "bg-amber-500/10 text-amber-600 dark:text-amber-400"}>On leave</span>;
  return s.active
    ? <span className={base + "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}>Active</span>
    : <span className={base + "bg-slate-500/10 text-slate-600 dark:text-slate-400"}>Inactive</span>;
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
