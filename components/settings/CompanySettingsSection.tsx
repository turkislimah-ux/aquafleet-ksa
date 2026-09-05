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
import { Check, Plus, Trash2 } from "lucide-react";
import { Btn } from "@/components/ui";
import {
  getCompanySettings,
  updateCompanySettings,
  getCompanyBankAccounts,
  updateCompanyBankAccounts,
  type CompanySettingsInput,
} from "@/app/trips/invoiceActions";
import {
  MAX_BANK_ACCOUNTS,
  ensureSaPrefix,
  formatIban,
  newBankAccountId,
  validateBankAccounts,
  type BankAccountValidationError,
  type CompanyBankAccount,
} from "@/lib/bankAccounts";
import { fill, t } from "@/lib/i18n";

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

        {/* Bank accounts — a SIBLING form, not a section of the one above, and
            not nested (nested forms are invalid HTML anyway).

            Its own action and its own Save on purpose: the two write different
            columns through different validation, so a mistyped IBAN must not
            block saving a phone number, and a blank legal_name must not throw
            away three accounts the operator just entered. One button each, one
            atomic whole-array write each. */}
        {!loading && <BankAccountsForm lang={lang} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bank accounts (migration 0184)
// ---------------------------------------------------------------------------
// Up to 3 accounts, each with a show-on-invoice tick that decides whether it
// prints in the invoice's Transfer Details block.
//
// THE WHOLE ARRAY IS ONE VALUE. There is no per-row save, no per-row delete
// action and no row id in the database — `bank_accounts` is a single jsonb
// column, so every edit here is a local mutation of one array and Save writes
// that array whole. That is also why it is safe: a half-applied reorder cannot
// exist.
//
// IBANs are the COMPANY's OWN, printed on customer invoices by design. They are
// never logged and never echoed back inside an error message.
function BankAccountsForm({ lang }: { lang: "en" | "ar" }) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<CompanyBankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The row the error belongs to, so the message and the ring point at the same
  // card. `null` for a form-level failure (the ceiling, or a database error).
  const [badRow, setBadRow] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getCompanyBankAccounts().then((r) => {
      if (r.error) setError(r.error);
      // Already parsed server-side through lib/bankAccounts — whatever junk the
      // column legally holds has been dropped before it reaches this state.
      if (r.data) setAccounts(r.data.map((a) => ({ ...a, iban: formatIban(a.iban) })));
      setLoading(false);
    });
  }, []);

  // Every mutation clears the tick AND the error: a "Saved" over edited rows is
  // a lie, and an error ring left on a row the user has since fixed is worse
  // than no ring at all.
  function mutate(next: CompanyBankAccount[]) {
    setSaved(false);
    setError(null);
    setBadRow(null);
    setAccounts(next);
  }

  function setField<K extends keyof CompanyBankAccount>(id: string, key: K, value: CompanyBankAccount[K]) {
    mutate(accounts.map((a) => (a.id === id ? { ...a, [key]: value } : a)));
  }

  function addAccount() {
    if (accounts.length >= MAX_BANK_ACCOUNTS) return;
    mutate([
      ...accounts,
      // App-generated id, stable for the row's whole life. React keys on it, so
      // deleting the first row cannot silently re-label the survivors — which
      // is exactly what keying on the array index would do.
      //
      // Ticked by default: an operator adding a bank account to an invoicing
      // system is adding it TO the invoice. Making them tick a second control
      // to get the thing they just asked for is a step that only ever gets
      // forgotten. Unticking is one click and visible in place.
      { id: newBankAccountId(), bank_name: "", holder_name: "", iban: "", show_on_invoice: true },
    ]);
  }

  /** Codes → the operator's language. The action returns English for its own log. */
  function message(e: BankAccountValidationError): string {
    if (e.code === "too_many") return t("shared.company.errBankMax", lang);
    const key =
      e.code === "bank_name_required"
        ? "shared.company.errBankName"
        : e.code === "holder_name_required"
          ? "shared.company.errAccountName"
          : "shared.company.errIban";
    return fill(t(key, lang), { n: e.index + 1 });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBadRow(null);
    setSaved(false);

    // Validated HERE as well as in the action, and neither is redundant. This
    // one names the row in the operator's language while she is still looking
    // at it; the action's is the gate that actually protects the column, since
    // a client check protects nothing.
    const checked = validateBankAccounts(accounts);
    if (!checked.ok) {
      setError(message(checked.error));
      setBadRow(checked.error.code === "too_many" ? null : checked.error.index);
      return;
    }

    setSaving(true);
    const res = await updateCompanyBankAccounts(checked.accounts);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    // Show back the cleaned array the server stored — trimmed, normalised, and
    // with ids filled in — so the screen matches the column rather than the
    // keystrokes that produced it.
    setAccounts(checked.accounts.map((a) => ({ ...a, iban: formatIban(a.iban) })));
    setSaved(true);
    // The invoice popup reads these off company_settings on its next load;
    // refresh so a Draft opened right after this shows the accounts it will
    // freeze.
    router.refresh();
  }

  const full = accounts.length >= MAX_BANK_ACCOUNTS;

  return (
    <form onSubmit={onSubmit} className="pt-4 mt-4 border-t" style={{ borderColor: "rgb(var(--border))" }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-xs font-semibold uppercase muted">{t("shared.company.bankTitle", lang)}</p>
          <p className="text-[11px] muted mt-1 max-w-md">{t("shared.company.bankHint", lang)}</p>
        </div>
        {/* Disabled rather than hidden at the ceiling: a control that vanishes
            reads as a bug, while a dimmed one says "three is the limit". */}
        <Btn onClick={addAccount} disabled={full} className="shrink-0">
          <Plus className="h-4 w-4" aria-hidden />
          {t("shared.company.addBankAccount", lang)}
        </Btn>
      </div>

      {loading ? (
        <div className="py-4 text-center muted text-sm">{t("common.loading", lang)}</div>
      ) : accounts.length === 0 ? (
        <p className="text-sm muted py-3">{t("shared.company.bankNone", lang)}</p>
      ) : (
        <div className="space-y-3">
          {accounts.map((a, i) => (
            <div
              key={a.id}
              className="rounded-lg border p-3 space-y-3"
              style={{
                borderColor: badRow === i ? "rgb(225 29 72 / 0.55)" : "rgb(var(--border))",
                background: "rgb(var(--card))",
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="muted">{t("shared.company.fBankName", lang)}</span>
                  <input
                    value={a.bank_name}
                    onChange={(e) => setField(a.id, "bank_name", e.target.value)}
                    className={INPUT}
                    style={INPUT_STYLE}
                    placeholder={t("shared.company.phBankName", lang)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="muted">{t("shared.company.fAccountName", lang)}</span>
                  <input
                    value={a.holder_name}
                    onChange={(e) => setField(a.id, "holder_name", e.target.value)}
                    className={INPUT}
                    style={INPUT_STYLE}
                  />
                </label>
              </div>

              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("shared.company.fIban", lang)}</span>
                {/* Typed text is kept VERBATIM while the field has focus — a
                    field that re-groups under the cursor fights the person
                    pasting into it. Tidying happens on blur, and
                    `validateBankAccounts` redoes it server-side anyway, so what
                    is stored never depends on how it was typed.

                    Blur does TWO things and the order matters: supply `SA` if
                    the operator typed the digits alone, THEN group by 4. Group
                    first and the country code lands mid-group, so the spacing
                    would sit a character off from every other account on the
                    invoice. A foreign IBAN keeps its own code untouched.

                    There is NO validation here. The field takes any country
                    code and any letters or digits after it — see
                    `isAcceptableIban` for why a checksum was the wrong tool on
                    a screen with no bank behind it.

                    Explicit LTR + tabular figures: an IBAN is a Latin string
                    inside a form that may be laid out RTL. */}
                <input
                  value={a.iban}
                  onChange={(e) => setField(a.id, "iban", e.target.value)}
                  onBlur={(e) => setField(a.id, "iban", formatIban(ensureSaPrefix(e.target.value)))}
                  className={`${INPUT} tabular-nums tracking-wide`}
                  style={INPUT_STYLE}
                  dir="ltr"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={t("shared.company.phIban", lang)}
                />
              </label>

              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={a.show_on_invoice}
                    onChange={(e) => setField(a.id, "show_on_invoice", e.target.checked)}
                    className="h-4 w-4 rounded accent-brand-600"
                  />
                  <span>{t("shared.company.showOnInvoice", lang)}</span>
                </label>
                <Btn
                  variant="ghost"
                  onClick={() => mutate(accounts.filter((x) => x.id !== a.id))}
                  className="text-rose-600 dark:text-rose-400"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  {t("shared.company.removeBankAccount", lang)}
                </Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{error}</p>}
      <div className="flex items-center justify-end gap-3 pt-3">
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
  );
}
