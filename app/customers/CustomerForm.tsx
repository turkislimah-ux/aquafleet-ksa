"use client";

// Client island for the Customers page: renders the table plus a New/Edit
// modal wired to the createCustomer / updateCustomer server actions.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Btn, Table, TH, TD, StatusPill } from "@/components/ui";
import {
  type Customer,
  type PaymentMode,
  CUSTOMER_TYPE_LABELS,
  PAYMENT_MODE_LABELS,
} from "@/lib/db-types";
import { createCustomer, updateCustomer } from "./actions";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export default function CustomerForm({
  customers,
  paymentModeByCustomer,
}: {
  customers: Customer[];
  // Resolved on the server from the customer's project (1:1). READ-ONLY here —
  // this page has no writable payment control any more; ProjectModal owns it.
  paymentModeByCustomer: Record<string, PaymentMode | null>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Customer | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function openNew() {
    setEditing(null);
    setError(null);
    setOpen(true);
  }
  function openEdit(c: Customer) {
    setEditing(c);
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
      ? await updateCustomer(editing.id, formData)
      : await createCustomer(formData);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    close();
    router.refresh();
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <Btn variant="primary" onClick={openNew}>
          <Plus className="h-4 w-4" /> New customer
        </Btn>
      </div>

      <div className="card p-0 overflow-hidden">
        <Table>
          <thead>
            <tr>
              <TH>Name</TH>
              <TH>Type</TH>
              <TH>Contact</TH>
              <TH>Phone</TH>
              <TH>Payment</TH>
              <TH>Status</TH>
              <TH className="text-end">Actions</TH>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                  No customers yet. Create the first one.
                </td>
              </tr>
            )}
            {customers.map((c) => (
              <tr key={c.id}>
                <TD className="font-medium">{c.name}</TD>
                <TD>{CUSTOMER_TYPE_LABELS[c.customer_type]}</TD>
                <TD>{c.contact_name ?? "—"}</TD>
                <TD>{c.phone ?? "—"}</TD>
                {/* Derived from the customer's project, never stored on the
                    customer. Em dash when the project has no mode set yet, or
                    when the customer has no project — same "—" convention the
                    Archive customer tab already uses for this exact field. */}
                <TD>
                  {paymentModeByCustomer[c.id]
                    ? PAYMENT_MODE_LABELS[paymentModeByCustomer[c.id]!]
                    : "—"}
                </TD>
                <TD>
                  <StatusPill status={c.active ? "active" : "out_of_service"} label={c.active ? "Active" : "Inactive"} />
                </TD>
                <TD className="text-end">
                  <Btn variant="outline" onClick={() => openEdit(c)}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Btn>
                </TD>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
          <div className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">{editing ? "Edit customer" : "New customer"}</h2>
            <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="muted">Name *</span>
                <input name="name" required defaultValue={editing?.name ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="muted">Name (Arabic)</span>
                <input name="name_ar" defaultValue={editing?.name_ar ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Customer type *</span>
                <select name="customer_type" required defaultValue={editing?.customer_type ?? ""} className={INPUT} style={INPUT_STYLE}>
                  <option value="" disabled>Select…</option>
                  {Object.entries(CUSTOMER_TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
              {/* THE "Payment model" SELECT USED TO BE HERE AND IS GONE ON
                  PURPOSE. It wrote customers.payment_model, which no finance code
                  ever read — so choosing "Pay as you go" here changed nothing
                  while the project quietly stayed postpaid, or vice versa. The
                  real control is the Payment & Rate section of ProjectModal
                  (Trips -> Customers -> Manage project), where the switch is
                  guarded by can_switch_payment_mode (0035): it refuses a change
                  until every invoice is settled. Do not re-add a payment control
                  to this form. */}
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Contact name</span>
                <input name="contact_name" defaultValue={editing?.contact_name ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Phone</span>
                <input name="phone" defaultValue={editing?.phone ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="muted">Delivery site address</span>
                <input name="delivery_site_address" defaultValue={editing?.delivery_site_address ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Delivery latitude</span>
                <input name="delivery_lat" type="number" step="any" defaultValue={editing?.delivery_lat ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Delivery longitude</span>
                <input name="delivery_lng" type="number" step="any" defaultValue={editing?.delivery_lng ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input name="active" type="checkbox" defaultChecked={editing ? editing.active : true} className="h-4 w-4" />
                <span>Active</span>
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
    </>
  );
}
