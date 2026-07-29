"use client";

// Company settings form (Batch D — invoice header restructure). Was
// email-only (0028/0029); now edits every seller-identity field that flows
// into the invoice header's Seller section: legal_name ("CR Company Name"),
// vat_number ("VAT Registration Number"), cr_number, address, description,
// telephone (landline), phone (mobile), email. Singleton table (id = true),
// no picker needed. Labels relabel existing columns — no renamed DB fields
// (see lib/db-types.ts's CompanySettings comment).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Btn } from "@/components/ui";
import { getCompanySettings, updateCompanySettings, type CompanySettingsInput } from "./invoiceActions";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

const EMPTY: CompanySettingsInput = {
  legal_name: "",
  legal_name_ar: "",
  vat_number: "",
  cr_number: "",
  address: "",
  email: "",
  description: "",
  telephone: "",
  phone: "",
  standard_working_days_per_month: 26,
};

export default function CompanySettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState<CompanySettingsInput>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    getCompanySettings().then((r) => {
      if (r.data) {
        setForm({
          legal_name: r.data.legal_name ?? "",
          legal_name_ar: r.data.legal_name_ar ?? "",
          vat_number: r.data.vat_number ?? "",
          cr_number: r.data.cr_number ?? "",
          address: r.data.address ?? "",
          email: r.data.email ?? "",
          description: r.data.description ?? "",
          telephone: r.data.telephone ?? "",
          phone: r.data.phone ?? "",
          standard_working_days_per_month: r.data.standard_working_days_per_month ?? 26,
        });
      }
      if (r.error) setError(r.error);
      setLoading(false);
    });
  }, [open]);

  function set<K extends keyof CompanySettingsInput>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function close() {
    if (saving) return;
    onClose();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await updateCompanySettings(form);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onClose();
    router.refresh();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
      <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Company settings</h2>
          <button type="button" onClick={close} className="muted hover:text-[rgb(var(--fg))]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm muted mb-4">
          Seller identity — appears in the Seller section of every invoice header.
        </p>

        {loading ? (
          <div className="py-6 text-center muted text-sm">Loading…</div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">CR Company Name *</span>
              <input
                value={form.legal_name}
                onChange={(e) => set("legal_name", e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                required
                placeholder="e.g. Bin Slimah Group"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">Company name (Arabic)</span>
              <input
                value={form.legal_name_ar ?? ""}
                onChange={(e) => set("legal_name_ar", e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                dir="rtl"
                placeholder="مجموعة بن سليمة"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">Description</span>
              <input
                value={form.description ?? ""}
                onChange={(e) => set("description", e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                placeholder="e.g. Water transport & treatment"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">CR Number</span>
                <input
                  value={form.cr_number ?? ""}
                  onChange={(e) => set("cr_number", e.target.value)}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">VAT Registration Number</span>
                <input
                  value={form.vat_number ?? ""}
                  onChange={(e) => set("vat_number", e.target.value)}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">Address</span>
              <input
                value={form.address ?? ""}
                onChange={(e) => set("address", e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Telephone (landline)</span>
                <input
                  value={form.telephone ?? ""}
                  onChange={(e) => set("telephone", e.target.value)}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Phone (mobile)</span>
                <input
                  value={form.phone ?? ""}
                  onChange={(e) => set("phone", e.target.value)}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">Company email</span>
              <input
                value={form.email ?? ""}
                onChange={(e) => set("email", e.target.value)}
                type="email"
                className={INPUT}
                style={INPUT_STYLE}
                placeholder="e.g. info@binslimah.com"
              />
            </label>
            <div className="pt-2 border-t" style={{ borderColor: "rgb(var(--border))" }}>
              <p className="text-xs font-semibold uppercase muted mt-3 mb-2">Operations</p>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Working days per month</span>
                <input
                  value={form.standard_working_days_per_month}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, standard_working_days_per_month: Number(e.target.value) || 0 }))
                  }
                  type="number"
                  step="1"
                  min="1"
                  className={INPUT}
                  style={INPUT_STYLE}
                />
                <span className="text-[11px] muted">
                  Used to turn a mechanic's per-day duty hours into monthly hours for Maintenance labor costing.
                </span>
              </label>
            </div>
            {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Btn variant="outline" onClick={close}>Cancel</Btn>
              <Btn type="submit" variant="primary" className={saving ? "opacity-50 pointer-events-none" : ""}>
                {saving ? "Saving…" : "Save"}
              </Btn>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
