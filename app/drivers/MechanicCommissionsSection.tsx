"use client";

// Polish item 4 — mechanic commissions (migration 0080). Staff-page ONLY,
// rendered by StaffTab's detail popup for role='mechanic' staff only (the
// role gate lives in the caller, same convention as LeaveSection being
// mounted for both "driver"/"staff" kinds without a role check of its own).
//
// STANDALONE money: amount_sar is a bare typed number — no formula, no
// derivation, and this component never sums it into anything outside its
// own table's own total-of-this-list caption. Deliberately named
// "Mechanic Commissions" everywhere (component, actions, types) to stay
// unmistakably separate from app/drivers' existing driver trip-commission/
// payout system (CommissionsTab.tsx) — a completely different feature.
//
// "Naturally disappear if the mechanic is deactivated" — this component
// reads `mechanic.active`/`mechanic.terminated_at` (the same two columns
// every other "is this staff member currently eligible" check in this app
// already tests, e.g. Maintenance's own mechanic picker) and renders
// nothing at all once either is false/set, rather than an empty list that
// could be mistaken for "no commissions yet."
//
// Same "add/edit inline form + list below" shape as LeaveSection.tsx, but
// a real <table> for the list (Turki's explicit ask this time, vs.
// LeaveSection's card-list).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Pencil, Trash2 } from "lucide-react";
import { Btn, Table, TH, TD } from "@/components/ui";
import { formatSar } from "@/lib/utils";
import type { Staff, StaffCommission, StaffCommissionType } from "@/lib/db-types";
import { addStaffCommission, updateStaffCommission, deleteStaffCommission, addStaffCommissionType } from "./actions";
import LookupSelect from "./LookupSelect";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString();
}

export default function MechanicCommissionsSection({
  mechanic,
  commissions,
  commissionTypes,
}: {
  mechanic: Staff;
  commissions: StaffCommission[];
  commissionTypes: StaffCommissionType[];
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StaffCommission | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read-time eligibility, same two columns every other "active mechanic"
  // check in this app already tests. Not shown at all once either flips —
  // "disappear," not an empty list.
  const eligible = mechanic.active && !mechanic.terminated_at;
  if (!eligible) return null;

  const typeLabel = (key: string) => commissionTypes.find((c) => c.key === key)?.label_en ?? key;
  const defaultType = commissionTypes[0]?.key ?? "";

  // Newest first.
  const sorted = [...commissions].sort((a, b) => (a.commission_date < b.commission_date ? 1 : -1));

  function openNew() {
    setEditing(null);
    setError(null);
    setFormOpen(true);
  }
  function openEdit(c: StaffCommission) {
    setEditing(c);
    setError(null);
    setFormOpen(true);
  }
  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Client mirror of the server validation (server is the real gate).
    const amount = Number(fd.get("amount_sar"));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter an amount greater than 0.");
      return;
    }
    if (!fd.get("commission_date")) {
      setError("Pick a date.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = editing ? await updateStaffCommission(editing.id, fd) : await addStaffCommission(fd);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    closeForm();
    router.refresh();
  }

  async function onDelete(c: StaffCommission) {
    if (!confirm(`Delete this ${typeLabel(c.commission_type)} commission?`)) return;
    const res = await deleteStaffCommission(c.id);
    if (res.error) {
      alert(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h4 className="font-semibold text-sm">Commissions</h4>
        {!formOpen && (
          <Btn variant="outline" onClick={openNew}>
            <Plus className="h-3.5 w-3.5" /> Add commission
          </Btn>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="muted text-xs py-2">No commissions recorded.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <TH>Type</TH>
              <TH>Amount</TH>
              <TH>Date</TH>
              <TH>Note</TH>
              <TH></TH>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr key={c.id}>
                <TD>{typeLabel(c.commission_type)}</TD>
                <TD className="tabular-nums">{formatSar(c.amount_sar)}</TD>
                <TD className="text-xs">{fmtDate(c.commission_date)}</TD>
                <TD className="text-xs muted truncate max-w-[200px]">{c.note || "—"}</TD>
                <TD>
                  <div className="flex items-center gap-1 justify-end">
                    <button
                      type="button"
                      onClick={() => openEdit(c)}
                      className="p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 muted"
                      aria-label="Edit commission"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(c)}
                      className="p-1.5 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                      aria-label="Delete commission"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </TD>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {formOpen && (
        <form onSubmit={onSubmit} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-app pt-3">
          <input type="hidden" name="staff_id" value={mechanic.id} />
          <div className="flex items-center justify-between sm:col-span-2">
            <span className="text-sm font-medium">{editing ? "Edit commission" : "Add commission"}</span>
            <button type="button" onClick={closeForm} className="muted hover:text-[rgb(var(--fg))]">
              <X className="h-4 w-4" />
            </button>
          </div>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="muted">Commission type</span>
            <LookupSelect
              name="commission_type"
              items={commissionTypes.map((c) => ({ key: c.key, label: c.label_en }))}
              defaultKey={editing?.commission_type ?? defaultType}
              onAdd={addStaffCommissionType}
              addLabel="+ Add custom type…"
              newPlaceholder="New commission type"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">Amount (SAR)</span>
            <input
              name="amount_sar"
              type="number"
              min="0.01"
              step="0.01"
              required
              defaultValue={editing?.amount_sar ?? ""}
              className={INPUT}
              style={INPUT_STYLE}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">Date</span>
            <input
              name="commission_date"
              type="date"
              required
              defaultValue={editing?.commission_date ?? ""}
              className={INPUT}
              style={INPUT_STYLE}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="muted">Note (optional)</span>
            <input name="note" defaultValue={editing?.note ?? ""} placeholder="e.g. reason or context" className={INPUT} style={INPUT_STYLE} />
          </label>

          {error && <p className="text-xs text-rose-600 dark:text-rose-400 sm:col-span-2">{error}</p>}

          <div className="flex justify-end gap-2 sm:col-span-2">
            <Btn variant="outline" onClick={closeForm}>Cancel</Btn>
            <Btn type="submit" variant="primary">{saving ? "Saving…" : editing ? "Save" : "Add commission"}</Btn>
          </div>
        </form>
      )}
    </div>
  );
}
