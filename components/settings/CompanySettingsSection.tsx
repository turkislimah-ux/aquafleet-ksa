"use client";

// Company settings form (Batch D — invoice header restructure). Was
// email-only (0028/0029); now edits every seller-identity field that flows
// into the invoice header's Seller section: legal_name ("CR Company Name"),
// vat_number ("VAT Registration Number"), cr_number, address, description,
// telephone (landline), phone (mobile), email. Singleton table (id = true),
// no picker needed. Labels relabel existing columns — no renamed DB fields
// (see lib/db-types.ts's CompanySettings comment).
//
// ==========================================================================
// RELOCATED IN 2.2a — MOVED, NOT REBUILT
// ==========================================================================
// This was app/trips/CompanySettingsModal.tsx, opened by a button on the
// Finance tab. It now lives inside the Settings popup as one section, moved
// with `git mv` so its history follows it.
//
// WHAT CHANGED: the outer chrome only. It used to render its own
// `fixed inset-0 bg-black/40` overlay with its own title and X — inside the
// Settings popup that would be a modal on top of a modal, two overlays and two
// close buttons deep. The popup supplies the frame; this supplies the form.
//
// WHAT DID NOT CHANGE, deliberately: every field, the load, the save action,
// the validation and the payload. company_settings is SNAPSHOTTED ONTO
// INVOICES, so its write behaviour is not something a relocation gets to
// touch. Same getCompanySettings / updateCompanySettings pair, same
// CompanySettingsInput, same required and optional fields.
//
// THE ONE UNAVOIDABLE DELTA: it used to close the modal on a successful save.
// There is no modal of its own to close now, and closing the whole Settings
// popup out from under someone who saved one section would be worse than
// staying put — so it stays open and confirms inline. The write is identical.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Btn } from "@/components/ui";
import { getCompanySettings, updateCompanySettings, type CompanySettingsInput } from "@/app/trips/invoiceActions";
import { t } from "@/lib/i18n";

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

// `lang` is a PROP, not `useApp()`, and that is not a style choice: AppShell
// imports SettingsModal which imports this file, so reaching back into
// AppShell's context here would close a real import cycle — the failure
// GlobalSearch's header documents, which tsc and next build both miss and
// which blanks the page at request time. The other four sections in this
// folder already take `lang` the same way.
export default function CompanySettingsSection({
  open,
  lang,
}: {
  open: boolean;
  lang: "en" | "ar";
}) {
  const router = useRouter();
  const [form, setForm] = useState<CompanySettingsInput>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Replaces the old "close the modal on success" signal. Cleared whenever the
  // form is edited again, so it reports THIS save rather than lingering as a
  // stale tick over unsaved changes.
  const [saved, setSaved] = useState(false);

  // `open` is still the load trigger: the section mounts inside the popup but
  // must not fetch until it is actually the visible section, and must refetch
  // when reopened so it never shows a value someone changed elsewhere.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaved(false);
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
    // Any edit invalidates the "Saved" confirmation — otherwise a tick sits
    // above changes that have not been written.
    setSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
  }

  // IDENTICAL WRITE PATH. Same action, same payload, same validation, same
  // router.refresh() so the invoice header picks the new seller identity up.
  // Only the post-success signal changed: confirm inline instead of closing a
  // modal that no longer exists.
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await updateCompanySettings(form);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  if (!open) return null;

  return (
    <div>
      <div>
        <h2 className="text-lg font-semibold">{t("shared.company.title", lang)}</h2>
        <p className="mt-1 text-sm muted mb-4">
          {t("shared.company.subtitle", lang)}
        </p>

        {loading ? (
          <div className="py-6 text-center muted text-sm">{t("common.loading", lang)}</div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{t("shared.company.fLegalName", lang)}</span>
              <input
                value={form.legal_name}
                onChange={(e) => set("legal_name", e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                required
                placeholder={t("shared.company.phLegalName", lang)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{t("shared.company.fLegalNameAr", lang)}</span>
              <input
                value={form.legal_name_ar ?? ""}
                onChange={(e) => set("legal_name_ar", e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                dir="rtl"
                // NOT keyed, deliberately: this is a sample VALUE for an
                // Arabic-only column, not UI copy. It must stay Arabic while
                // the interface is in English — that is the whole point of the
                // field.
                placeholder="مجموعة بن سليمة"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{t("shared.company.fDescription", lang)}</span>
              <input
                value={form.description ?? ""}
                onChange={(e) => set("description", e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                placeholder={t("shared.company.phDescription", lang)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("shared.company.fCrNumber", lang)}</span>
                <input
                  value={form.cr_number ?? ""}
                  onChange={(e) => set("cr_number", e.target.value)}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("shared.company.fVatNumber", lang)}</span>
                <input
                  value={form.vat_number ?? ""}
                  onChange={(e) => set("vat_number", e.target.value)}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{t("shared.company.fAddress", lang)}</span>
              <input
                value={form.address ?? ""}
                onChange={(e) => set("address", e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("shared.company.fTelephone", lang)}</span>
                <input
                  value={form.telephone ?? ""}
                  onChange={(e) => set("telephone", e.target.value)}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("shared.company.fPhone", lang)}</span>
                <input
                  value={form.phone ?? ""}
                  onChange={(e) => set("phone", e.target.value)}
                  className={INPUT}
                  style={INPUT_STYLE}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{t("shared.company.fEmail", lang)}</span>
              <input
                value={form.email ?? ""}
                onChange={(e) => set("email", e.target.value)}
                type="email"
                className={INPUT}
                style={INPUT_STYLE}
                placeholder={t("shared.company.phEmail", lang)}
              />
            </label>
            <div className="pt-2 border-t" style={{ borderColor: "rgb(var(--border))" }}>
              <p className="text-xs font-semibold uppercase muted mt-3 mb-2">{t("shared.company.operations", lang)}</p>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("shared.company.fWorkingDays", lang)}</span>
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
                  {t("shared.company.workingDaysHint", lang)}
                </span>
              </label>
            </div>
            {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
            {/* Cancel is gone with the modal it used to dismiss. Inside a
                sectioned popup its job belongs to the popup's own close, and a
                "Cancel" that shuts the whole Settings window from one section
                would be a worse surprise than no Cancel at all. */}
            <div className="flex items-center justify-end gap-3 pt-2">
              {saved && (
                <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                  <Check className="h-4 w-4" aria-hidden />
                  {t("common.saved", lang)}
                </span>
              )}
              <Btn type="submit" variant="primary" className={saving ? "opacity-50 pointer-events-none" : ""}>
                {saving ? t("common.saving", lang) : t("common.save", lang)}
              </Btn>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
