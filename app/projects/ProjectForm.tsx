"use client";

// Client island for the Projects page: table plus New/Edit modal wired to the
// createProject / updateProject server actions. Needs the customer list for
// the customer dropdown.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Users } from "lucide-react";
import { Btn, Table, TH, TD, StatusPill } from "@/components/ui";
import { formatSar } from "@/lib/utils";
import {
  type Project,
  COMMISSION_MODE_LABELS,
  PROJECT_STATUS_LABELS,
} from "@/lib/db-types";
import { createProject, updateProject } from "./actions";
import ManageDriversModal, { type DriverOption } from "./ManageDriversModal";

type CustomerOption = { id: string; name: string };
type ProjectRow = Project & { customerName: string };

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export default function ProjectForm({
  projects,
  customers,
  drivers,
  assignmentsByProject,
}: {
  projects: ProjectRow[];
  customers: CustomerOption[];
  drivers: DriverOption[];
  assignmentsByProject: Record<string, string[]>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [managing, setManaging] = useState<ProjectRow | null>(null);

  function openNew() {
    setEditing(null);
    setError(null);
    setOpen(true);
  }
  function openEdit(p: ProjectRow) {
    setEditing(p);
    setError(null);
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setEditing(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    const res = editing
      ? await updateProject(editing.id, formData)
      : await createProject(formData);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    close();
    router.refresh();
  }

  const noCustomers = customers.length === 0;

  return (
    <>
      <div className="flex justify-end mb-4">
        <Btn variant="primary" onClick={openNew} className={noCustomers ? "opacity-50 pointer-events-none" : ""}>
          <Plus className="h-4 w-4" /> New project
        </Btn>
      </div>
      {noCustomers && (
        <p className="text-sm muted mb-4">Create a customer first — projects must belong to a customer.</p>
      )}

      <div className="card p-0 overflow-hidden">
        <Table>
          <thead>
            <tr>
              <TH>Project</TH>
              <TH>Customer</TH>
              <TH>Rate / trip</TH>
              <TH>Commission</TH>
              <TH>Dates</TH>
              <TH>Status</TH>
              <TH className="text-end">Actions</TH>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                  No projects yet.
                </td>
              </tr>
            )}
            {projects.map((p) => (
              <tr key={p.id}>
                <TD className="font-medium">{p.name}</TD>
                <TD>{p.customerName}</TD>
                <TD className="tabular-nums">{formatSar(p.rate_per_trip_sar)}</TD>
                <TD>{COMMISSION_MODE_LABELS[p.commission_mode]} · {p.commission_value}</TD>
                <TD>{p.start_date ?? "—"} → {p.end_date ?? "open"}</TD>
                <TD><StatusPill status={p.status === "active" ? "active" : p.status === "paused" ? "warning" : "out_of_service"} label={PROJECT_STATUS_LABELS[p.status]} /></TD>
                <TD className="text-end">
                  <div className="inline-flex gap-2">
                    <Btn variant="outline" onClick={() => setManaging(p)}>
                      <Users className="h-3.5 w-3.5" /> Drivers
                      <span className="muted">({(assignmentsByProject[p.id] ?? []).length})</span>
                    </Btn>
                    <Btn variant="outline" onClick={() => openEdit(p)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Btn>
                  </div>
                </TD>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
          <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">{editing ? "Edit project" : "New project"}</h2>
            <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="muted">Name *</span>
                <input name="name" required defaultValue={editing?.name ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="muted">Customer *</span>
                <select name="customer_id" required defaultValue={editing?.customer_id ?? ""} className={INPUT} style={INPUT_STYLE}>
                  <option value="" disabled>Select…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Rate per trip (SAR)</span>
                <input name="rate_per_trip_sar" type="number" step="any" min="0" defaultValue={editing?.rate_per_trip_sar ?? 0} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Status</span>
                <select name="status" defaultValue={editing?.status ?? "active"} className={INPUT} style={INPUT_STYLE}>
                  {Object.entries(PROJECT_STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Commission mode</span>
                <select name="commission_mode" defaultValue={editing?.commission_mode ?? "fixed"} className={INPUT} style={INPUT_STYLE}>
                  {Object.entries(COMMISSION_MODE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Commission value</span>
                <input name="commission_value" type="number" step="any" min="0" defaultValue={editing?.commission_value ?? 0} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Start date</span>
                <input name="start_date" type="date" defaultValue={editing?.start_date ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">End date (blank = open-ended)</span>
                <input name="end_date" type="date" defaultValue={editing?.end_date ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>

              {error && <p className="text-sm text-rose-600 dark:text-rose-400 sm:col-span-2">{error}</p>}

              <div className="flex justify-end gap-2 sm:col-span-2 mt-2">
                <Btn variant="outline" onClick={close}>Cancel</Btn>
                <Btn type="submit" variant="primary">{saving ? "Saving…" : "Save"}</Btn>
              </div>
            </form>
          </div>
        </div>
      )}

      {managing && (
        <ManageDriversModal
          project={{ id: managing.id, name: managing.name }}
          drivers={drivers}
          assigned={assignmentsByProject[managing.id] ?? []}
          onClose={() => setManaging(null)}
        />
      )}
    </>
  );
}
