"use client";

// Client island for the Customers page: renders the table plus a New/Edit
// modal wired to the createCustomer / updateCustomer server actions.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Btn, Table, TH, TD, StatusPill, PageHeader } from "@/components/ui";
import {
  type Customer,
  type CustomerType,
  type PaymentMode,
  CUSTOMER_TYPE_LABELS,
} from "@/lib/db-types";
import { createCustomer, updateCustomer } from "./actions";
import ScrollLock from "@/components/ScrollLock";
import { useApp } from "@/components/AppShell";
import { t, arText, type TKey } from "@/lib/i18n";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// ENUM VALUE -> DICTIONARY KEY. The English text still lives in db-types.ts;
// these two maps only say which key renders it. Typed as a total Record, so a
// value added to either enum fails the build here instead of printing the raw
// enum name on screen.
const CUSTOMER_TYPE_TKEY: Record<CustomerType, TKey> = {
  construction: "labels.custConstruction",
  government_office: "labels.custGovernmentOffice",
  facility_management: "labels.custFacilityManagement",
};
const PAYMENT_MODE_TKEY: Record<PaymentMode, TKey> = {
  postpaid: "labels.postpaid",
  prepaid: "labels.prepaid",
};

export default function CustomerForm({
  customers,
  paymentModeByCustomer,
  error: loadError,
}: {
  customers: Customer[];
  // Resolved on the server from the customer's project (1:1). READ-ONLY here —
  // this page has no writable payment control any more; ProjectModal owns it.
  paymentModeByCustomer: Record<string, PaymentMode | null>;
  // Fetch failure from page.tsx. Supabase's own message, deliberately not
  // translated; only the sentence in front of it is.
  error: string | null;
}) {
  const router = useRouter();
  const { lang } = useApp();
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
      <PageHeader title={t("customers.title", lang)} subtitle={t("customers.subtitle", lang)} />
      {loadError && (
        <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">
          {t("customers.loadFailed", lang)} {loadError}
        </p>
      )}
      <div className="flex justify-end mb-4">
        <Btn variant="primary" onClick={openNew}>
          <Plus className="h-4 w-4" /> {t("customers.newCustomer", lang)}
        </Btn>
      </div>

      <div className="card p-0 overflow-hidden">
        <Table>
          <thead>
            <tr>
              <TH>{t("customers.thName", lang)}</TH>
              <TH>{t("common.type", lang)}</TH>
              <TH>{t("customers.thContact", lang)}</TH>
              <TH>{t("customers.thPhone", lang)}</TH>
              <TH>{t("customers.thPayment", lang)}</TH>
              <TH>{t("common.status", lang)}</TH>
              <TH className="text-end">{t("common.actions", lang)}</TH>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                  {t("customers.empty", lang)}
                </td>
              </tr>
            )}
            {customers.map((c) => (
              <tr key={c.id}>
                <TD className="font-medium">{arText(c.name, c.name_ar, lang)}</TD>
                <TD>{t(CUSTOMER_TYPE_TKEY[c.customer_type], lang)}</TD>
                <TD>{c.contact_name ?? "—"}</TD>
                <TD>{c.phone ?? "—"}</TD>
                {/* Derived from the customer's project, never stored on the
                    customer. Em dash when the project has no mode set yet, or
                    when the customer has no project — same "—" convention the
                    Archive customer tab already uses for this exact field. */}
                <TD>
                  {paymentModeByCustomer[c.id]
                    ? t(PAYMENT_MODE_TKEY[paymentModeByCustomer[c.id]!], lang)
                    : "—"}
                </TD>
                <TD>
                  <StatusPill
                    status={c.active ? "active" : "out_of_service"}
                    label={c.active ? t("status.active", lang) : t("customers.inactive", lang)}
                  />
                </TD>
                <TD className="text-end">
                  <Btn variant="outline" onClick={() => openEdit(c)}>
                    <Pencil className="h-3.5 w-3.5" /> {t("common.edit", lang)}
                  </Btn>
                </TD>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
          <ScrollLock />
          <div className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">
              {editing ? t("customers.editCustomer", lang) : t("customers.newCustomer", lang)}
            </h2>
            <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="muted">{t("customers.fName", lang)}</span>
                {/* The BASE column, never arText — this is the write side, and
                    pre-filling it with the Arabic name would save that name
                    over the English one on the next Save. */}
                <input name="name" required defaultValue={editing?.name ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="muted">{t("customers.fNameAr", lang)}</span>
                <input name="name_ar" defaultValue={editing?.name_ar ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("customers.fType", lang)}</span>
                <select name="customer_type" required defaultValue={editing?.customer_type ?? ""} className={INPUT} style={INPUT_STYLE}>
                  <option value="" disabled>{t("common.selectPlaceholder", lang)}</option>
                  {/* Iterating the LABEL MAP, not the key map, keeps db-types.ts
                      the source of enum order — the option order is unchanged. */}
                  {(Object.keys(CUSTOMER_TYPE_LABELS) as CustomerType[]).map((v) => (
                    <option key={v} value={v}>{t(CUSTOMER_TYPE_TKEY[v], lang)}</option>
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
                <span className="muted">{t("customers.fContactName", lang)}</span>
                <input name="contact_name" defaultValue={editing?.contact_name ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("customers.thPhone", lang)}</span>
                <input name="phone" defaultValue={editing?.phone ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="muted">{t("customers.fAddress", lang)}</span>
                <input name="delivery_site_address" defaultValue={editing?.delivery_site_address ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("customers.fLat", lang)}</span>
                <input name="delivery_lat" type="number" step="any" defaultValue={editing?.delivery_lat ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("customers.fLng", lang)}</span>
                <input name="delivery_lng" type="number" step="any" defaultValue={editing?.delivery_lng ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input name="active" type="checkbox" defaultChecked={editing ? editing.active : true} className="h-4 w-4" />
                <span>{t("status.active", lang)}</span>
              </label>

              {error && <p className="text-sm text-rose-600 dark:text-rose-400 sm:col-span-2">{error}</p>}

              <div className="flex justify-end gap-2 sm:col-span-2 mt-2">
                <Btn variant="outline" onClick={close}>{t("common.cancel", lang)}</Btn>
                <Btn type="submit" variant="primary">
                  {saving ? t("common.saving", lang) : t("common.save", lang)}
                </Btn>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
