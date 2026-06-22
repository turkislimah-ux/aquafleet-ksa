"use client";

// Management & Support Staff — the third Drivers & People tab. Mirrors the demo:
// a people grid (gold-avatar cards: name, "Role · Station", phone) plus an
// Add Staff modal. Drivers live in the Drivers tab; this is everyone else.
// Reality match: the demo's "depot" is our "station".

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Btn } from "@/components/ui";
import {
  type Staff,
  STAFF_ROLE_LABELS,
  STAFF_ROLE_OPTIONS,
  STATION_OPTIONS,
} from "@/lib/db-types";
import { createStaff } from "./actions";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function StaffTab({ staff }: { staff: Staff[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSaving(true);
    setFormError(null);
    const res = await createStaff(fd);
    setSaving(false);
    if (res.error) {
      setFormError(res.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <div>
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3 gap-3">
          <h3 className="font-semibold text-sm">Management &amp; Support Staff</h3>
          <Btn variant="primary" onClick={() => { setFormError(null); setOpen(true); }}>
            <Plus className="h-4 w-4" /> Add staff
          </Btn>
        </div>

        {staff.length === 0 ? (
          <p className="muted text-sm py-6 text-center">No staff yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {staff.map((p) => (
              <div key={p.id} className="rounded-lg border border-app p-3 flex items-center gap-3">
                <div className="h-10 w-10 rounded-full text-white grid place-items-center text-sm font-semibold shrink-0" style={{ background: "#bd8b3f" }}>
                  {initials(p.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-xs muted truncate">
                    {STAFF_ROLE_LABELS[p.role]}{p.station ? ` · ${p.station}` : ""}
                  </div>
                  <div className="text-[11px] muted truncate">{p.phone ?? "—"}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={() => setOpen(false)}>
          <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">Add Staff Member</h2>
            <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Name *">
                <input name="name" required placeholder="e.g. Omar Al-Qahtani" className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Name (Arabic)">
                <input name="name_ar" dir="rtl" className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Role">
                <select name="role" defaultValue={STAFF_ROLE_OPTIONS[0]} className={INPUT} style={INPUT_STYLE}>
                  {STAFF_ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{STAFF_ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Station">
                <select name="station" defaultValue="" className={INPUT} style={INPUT_STYLE}>
                  <option value="">—</option>
                  {STATION_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Email">
                <input name="email" type="email" placeholder="name@aquafleet.sa" className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Phone">
                <input name="phone" placeholder="+966 5…" className={INPUT} style={INPUT_STYLE} />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input name="active" type="checkbox" defaultChecked />
                <span>Active</span>
              </label>

              {formError && <p className="text-sm text-rose-600 dark:text-rose-400 sm:col-span-2">{formError}</p>}

              <div className="flex justify-end gap-2 sm:col-span-2 mt-2">
                <Btn variant="outline" onClick={() => setOpen(false)}>Cancel</Btn>
                <Btn type="submit" variant="primary">{saving ? "Saving…" : "Add Staff Member"}</Btn>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="muted">{label}</span>
      {children}
    </label>
  );
}
