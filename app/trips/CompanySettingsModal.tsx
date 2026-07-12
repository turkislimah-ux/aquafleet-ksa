"use client";

// Minimal company-settings form (Finance email templates, 0028/0029) — sets
// ONLY company_settings.email. NOT the full settings/profile screen (that's a
// later, separate build); this exists so the invoice mailto templates have a
// company contact address to reference in the signature. Singleton table
// (id = true), no picker needed.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Btn } from "@/components/ui";
import { getCompanyEmail, updateCompanyEmail } from "./invoiceActions";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export default function CompanySettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    getCompanyEmail().then((r) => {
      setEmail(r.data?.email ?? "");
      if (r.error) setError(r.error);
      setLoading(false);
    });
  }, [open]);

  function close() {
    if (saving) return;
    onClose();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await updateCompanyEmail(email);
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
      <div className="card p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Company settings</h2>
          <button type="button" onClick={close} className="muted hover:text-[rgb(var(--fg))]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm muted mb-4">
          Company email — referenced in invoice email templates as the formal contact address.
        </p>

        {loading ? (
          <div className="py-6 text-center muted text-sm">Loading…</div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">Company email</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                className={INPUT}
                style={INPUT_STYLE}
                placeholder="e.g. info@binslimah.com"
              />
            </label>
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
