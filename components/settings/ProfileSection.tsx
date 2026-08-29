"use client";

// Settings → Profile (phase 2.2c step 2).
//
// ==========================================================================
// THREE SAVE MODELS, AND THE SPLIT IS THE DESIGN
// ==========================================================================
// The AVATAR saves the moment a file is picked. Choosing a photo IS the
// instruction; a picker that then needs a Save button leaves a preview on screen
// that is not yet real, and the user cannot tell the difference.
//
// The PROFILE FORM saves on one explicit Save. Ten fields that are edited
// together and mean nothing individually — saving per-keystroke would write a
// half-typed phone number on the way to a whole one.
//
// The PASSWORD has its OWN button and its own card, and this is the important
// one. It is the only control here that can lock someone out of the app. Folding
// it into the form's Save would mean the button that saves a bio is also the
// button that changes a password — so a user who edited their job title and hit
// Save could not be sure what else just happened. It is separated, placed last,
// and gated behind the current password.
//
// ==========================================================================
// ONE NAME FIELD, NOT TWO
// ==========================================================================
// A display name exists in two places: auth user_metadata (which the header
// reads) and user_profiles.display_name (which 0159 says "may mirror" it). The
// obvious build is two inputs, one per store — and it is wrong. Two inputs both
// labelled "Display name" on one screen is a puzzle, not a form, and nothing in
// the app reads the second one today.
//
// So there is ONE input. saveProfile writes it to BOTH: auth metadata so the
// header updates, and the row so it is self-contained for the colleague-facing
// view 0159 anticipates. They cannot drift because nothing can write them apart.
//
// ==========================================================================
// WHAT THIS SECTION DOES NOT SHOW
// ==========================================================================
// No iqama, no salary, no leave, no employment data, and no read of staff /
// drivers / leave_periods. Everything here is auth plus the user's own
// user_profiles row. The leave-history display is deferred to RBAC. 0159's
// header explains why the missing link is the point.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, Upload, UserRound, KeyRound } from "lucide-react";
import { Btn } from "@/components/ui";
import { cn } from "@/lib/utils";
import { NAV } from "@/lib/nav";
import { t } from "@/lib/i18n";
import {
  fetchProfile, saveProfile, changePassword, uploadAvatar, removeAvatar,
  type ProfileData,
} from "@/lib/actions/profile";
import {
  EMPTY_DRAFT, AVATAR_ACCEPT, MIN_PASSWORD_LENGTH,
  validateAvatarFile, validateNewPassword,
  type ProfileTextKey,
} from "@/lib/profile";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;
const CARD = "rounded-xl border p-4";
const CARD_STYLE = { borderColor: "rgb(var(--border))" } as const;

/** Section heading. Same visual grammar as the Notifications section. */
function GroupHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide muted">{children}</h3>;
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] muted">{hint}</span>}
    </label>
  );
}

/**
 * Looks-like-an-email, for a WARNING only.
 *
 * Deliberately loose, and deliberately non-blocking. 0159 measured that this
 * schema has zero email-format constraints and explains why: a regex eventually
 * refuses a legitimate address and the user has no way to argue with it. This
 * catches the honest typo — a missing @ — and says so without stopping the save.
 */
function looksLikeEmail(v: string): boolean {
  const t2 = v.trim();
  return t2 === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t2);
}

export default function ProfileSection({ open, lang }: { open: boolean; lang: "en" | "ar" }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState<ProfileData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [accountName, setAccountName] = useState("");
  const [draft, setDraft] = useState<Record<ProfileTextKey, string>>({ ...EMPTY_DRAFT });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwDone, setPwDone] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // WRAPPED. The action catches its own throws, but if the module itself
    // fails to load the rejection lands here instead of leaving `data` null
    // forever behind a spinner — the 2.2b bug, closed by construction.
    let res: Awaited<ReturnType<typeof fetchProfile>>;
    try {
      res = await fetchProfile();
    } catch (e) {
      console.error("[ProfileSection] load threw", e);
      setLoadError(e instanceof Error && e.message ? e.message : "Could not load your profile.");
      return;
    }
    // NARROW ON `data`, NOT ON `error`. `error: string` includes "", which is
    // falsy, so `if (res.error)` does not discriminate this union.
    if (!res.data) { setLoadError(res.error); return; }
    const d = res.data;
    setLoadError(null);
    setData(d);
    // The account name falls back to the row's copy: a user who has a profile
    // row from before this field existed should see their name, not a blank.
    setAccountName(d.accountDisplayName || d.fields.display_name || "");
    setAvatarUrl(d.avatarUrl);
    setDraft({
      display_name: d.fields.display_name ?? "",
      job_title: d.fields.job_title ?? "",
      contact_number: d.fields.contact_number ?? "",
      personal_email: d.fields.personal_email ?? "",
      emergency_contact_name: d.fields.emergency_contact_name ?? "",
      emergency_contact_number: d.fields.emergency_contact_number ?? "",
      bio: d.fields.bio ?? "",
      preferred_language: d.fields.preferred_language ?? "",
      default_route: d.fields.default_route ?? "",
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    setSaved(false);
    setSaveError(null);
    setAvatarError(null);
    setPwError(null);
    setPwDone(false);
    setPw({ current: "", next: "", confirm: "" });
    void load();
  }, [open, load]);

  if (!open) return null;

  function set(key: ProfileTextKey, value: string) {
    setSaved(false);
    setSaveError(null);
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    const res = await saveProfile({ accountDisplayName: accountName, fields: draft });
    setSaving(false);
    if (res.error) { setSaveError(res.error); return; }
    setSaved(true);
    await load();
    // The header's name comes from the server (app/layout.tsx -> getViewer), so
    // the top bar only picks up a new display name once the tree re-renders.
    router.refresh();
  }

  async function onPickAvatar(file: File) {
    setAvatarError(null);
    // Checked here for instant feedback; the server checks the same thing again,
    // because a client-side check is an affordance and not a control.
    const bad = validateAvatarFile(file);
    if (bad) { setAvatarError(bad); return; }

    setAvatarBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await uploadAvatar(fd);
    setAvatarBusy(false);
    // Narrow on `url`, not on `error`.
    if (!res.url) { setAvatarError(res.error); return; }
    setAvatarUrl(res.url);
    router.refresh();
  }

  async function onRemoveAvatar() {
    setAvatarError(null);
    setAvatarBusy(true);
    const res = await removeAvatar();
    setAvatarBusy(false);
    if (res.error) { setAvatarError(res.error); return; }
    setAvatarUrl(null);
    router.refresh();
  }

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwDone(false);
    // Same validator the server runs, so the form cannot accept something the
    // API then refuses.
    const problem = validateNewPassword(pw.next, pw.confirm);
    if (problem) { setPwError(problem); return; }

    setPwSaving(true);
    const res = await changePassword({
      currentPassword: pw.current,
      newPassword: pw.next,
      confirmPassword: pw.confirm,
    });
    setPwSaving(false);
    if (res.error) { setPwError(res.error); return; }
    setPwDone(true);
    // Cleared on success so the new password is not left sitting in three
    // inputs behind an open dialog.
    setPw({ current: "", next: "", confirm: "" });
  }

  const emailWarn = !looksLikeEmail(draft.personal_email);
  const initials =
    (accountName.trim() || data?.email || "?")
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";

  return (
    <div>
      <h2 className="text-lg font-semibold">{t("settings.profile.title", lang)}</h2>
      <p className="mt-1 text-sm muted">{t("settings.profile.subtitle", lang)}</p>

      {loadError && (
        <div className="mt-4 rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/20">
          {loadError}{" "}
          <button onClick={() => void load()} className="focus-ring underline underline-offset-2">
            {t("common.tryAgain", lang)}
          </button>
        </div>
      )}

      {data === null ? (
        <div className="py-8 text-center text-sm muted">{t("common.loading", lang)}</div>
      ) : (
        <>
          {/* ---- AVATAR — saves on pick ---- */}
          <section className={cn("mt-6 flex items-center gap-4", CARD)} style={CARD_STYLE}>
            {/* A plain <img>, not next/image. The source is a SIGNED URL with a
                query string and a 5-minute life, on a host that would need a
                remotePatterns entry — and the optimiser cannot cache something
                that expires anyway. This is the app's only rendered image. */}
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt={t("settings.profile.photoAlt", lang)}
                className="h-20 w-20 shrink-0 rounded-full object-cover ring-1 ring-inset"
                style={{ borderColor: "rgb(var(--border))" }}
              />
            ) : (
              <span
                aria-hidden
                className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-brand-600 text-xl font-semibold text-white"
              >
                {initials}
              </span>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept={AVATAR_ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    // Reset immediately so re-picking the SAME file still fires
                    // a change event — otherwise a failed upload cannot be
                    // retried with the same photo.
                    e.target.value = "";
                    if (f) void onPickAvatar(f);
                  }}
                />
                <Btn
                  onClick={() => fileRef.current?.click()}
                  className={avatarBusy ? "opacity-50 pointer-events-none" : ""}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Upload className="h-3.5 w-3.5" aria-hidden />
                    {avatarBusy
                      ? t("settings.profile.uploading", lang)
                      : avatarUrl
                        ? t("settings.profile.changePhoto", lang)
                        : t("settings.profile.addPhoto", lang)}
                  </span>
                </Btn>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => void onRemoveAvatar()}
                    disabled={avatarBusy}
                    className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm muted transition hover:text-rose-600 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    {t("settings.profile.removePhoto", lang)}
                  </button>
                )}
              </div>
              <p className="mt-1.5 text-[11px] muted">
                {t("settings.profile.photoHint", lang)}
              </p>
              {avatarError && (
                <p className="mt-1 text-sm text-rose-600 dark:text-rose-400">{avatarError}</p>
              )}
            </div>
          </section>

          <form onSubmit={onSave}>
            {/* ---- ACCOUNT ---- */}
            <section className="mt-8">
              <GroupHeading>{t("settings.profile.gAccount", lang)}</GroupHeading>
              <div className={cn("mt-2 space-y-3", CARD)} style={CARD_STYLE}>
                <Field
                  label={t("settings.profile.fDisplayName", lang)}
                  hint={t("settings.profile.hDisplayName", lang)}
                >
                  <input
                    value={accountName}
                    onChange={(e) => { setSaved(false); setSaveError(null); setAccountName(e.target.value); }}
                    className={INPUT}
                    style={INPUT_STYLE}
                    placeholder={t("settings.profile.phDisplayName", lang)}
                  />
                </Field>

                {/* READ-ONLY, and not a disabled input pretending to be
                    editable. The login email is changed through Supabase Auth's
                    own confirm-by-email flow, which this popup does not
                    implement — offering a greyed-out box would imply it does. */}
                <Field
                  label={t("settings.profile.fLoginEmail", lang)}
                  hint={t("settings.profile.hLoginEmail", lang)}
                >
                  <p className="rounded-lg border px-3 py-2 text-sm muted" style={INPUT_STYLE}>
                    {data.email || "—"}
                  </p>
                </Field>
              </div>
            </section>

            {/* ---- PERSONAL INFO ---- */}
            <section className="mt-6">
              <GroupHeading>{t("settings.profile.gPersonal", lang)}</GroupHeading>
              <div className={cn("mt-2 space-y-3", CARD)} style={CARD_STYLE}>
                <Field
                  label={t("settings.profile.fJobTitle", lang)}
                  hint={t("settings.profile.hJobTitle", lang)}
                >
                  <input
                    value={draft.job_title}
                    onChange={(e) => set("job_title", e.target.value)}
                    className={INPUT}
                    style={INPUT_STYLE}
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("settings.profile.fContactNumber", lang)}>
                    <input
                      value={draft.contact_number}
                      onChange={(e) => set("contact_number", e.target.value)}
                      className={INPUT}
                      style={INPUT_STYLE}
                      inputMode="tel"
                      dir="ltr"
                    />
                  </Field>
                  <Field
                    label={t("settings.profile.fPersonalEmail", lang)}
                    hint={
                      // A WARNING, never a block. The save goes through either
                      // way; the database has no format rule and neither does
                      // this. It only catches the honest typo.
                      emailWarn ? t("settings.profile.hEmailWarn", lang) : undefined
                    }
                  >
                    <input
                      value={draft.personal_email}
                      onChange={(e) => set("personal_email", e.target.value)}
                      className={cn(INPUT, emailWarn && "ring-1 ring-amber-500/40")}
                      style={INPUT_STYLE}
                      inputMode="email"
                      dir="ltr"
                    />
                  </Field>
                </div>

                <div>
                  <p className="mb-1.5 text-[11px] uppercase tracking-wide muted">
                    {t("settings.profile.gEmergency", lang)}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t("settings.profile.fEmergencyName", lang)}>
                      <input
                        value={draft.emergency_contact_name}
                        onChange={(e) => set("emergency_contact_name", e.target.value)}
                        className={INPUT}
                        style={INPUT_STYLE}
                      />
                    </Field>
                    <Field label={t("settings.profile.fEmergencyNumber", lang)}>
                      <input
                        value={draft.emergency_contact_number}
                        onChange={(e) => set("emergency_contact_number", e.target.value)}
                        className={INPUT}
                        style={INPUT_STYLE}
                        inputMode="tel"
                        dir="ltr"
                      />
                    </Field>
                  </div>
                  <p className="mt-1.5 text-[11px] muted">
                    {t("settings.profile.emergencyHint", lang)}
                  </p>
                </div>

                <Field label={t("settings.profile.fAbout", lang)}>
                  <textarea
                    value={draft.bio}
                    onChange={(e) => set("bio", e.target.value)}
                    rows={3}
                    className={cn(INPUT, "resize-y")}
                    style={INPUT_STYLE}
                  />
                </Field>
              </div>
            </section>

            {/* ---- PREFERENCES ---- */}
            <section className="mt-6">
              <GroupHeading>{t("settings.profile.gPreferences", lang)}</GroupHeading>
              <div className={cn("mt-2 space-y-3", CARD)} style={CARD_STYLE}>
                <Field
                  label={t("settings.profile.fLandingPage", lang)}
                  hint={t("settings.profile.hLandingPage", lang)}
                >
                  <select
                    value={draft.default_route}
                    onChange={(e) => set("default_route", e.target.value)}
                    className={INPUT}
                    style={INPUT_STYLE}
                  >
                    <option value="">{t("settings.profile.noPreference", lang)}</option>
                    {/* Built from the SAME NAV the sidebar renders, so the list
                        cannot offer a page that does not exist. */}
                    {NAV.map((n) => (
                      <option key={n.href} value={n.href}>
                        {n.label ?? (n.key ? t(`nav.${n.key}`, lang) : n.href)}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label={t("settings.profile.fPreferredLanguage", lang)}
                  // Two controls, two lifetimes, and the hint says which is
                  // which: this is the ACCOUNT language, applied at login on
                  // any device (0171), while the header toggle is the SESSION
                  // switch and never writes back here.
                  hint={t("settings.profile.hPreferredLanguage", lang)}
                >
                  <select
                    value={draft.preferred_language}
                    onChange={(e) => set("preferred_language", e.target.value)}
                    className={INPUT}
                    style={INPUT_STYLE}
                  >
                    <option value="">{t("settings.profile.noPreference", lang)}</option>
                    {/* NOT translated, and not an oversight: a language picker
                        names each language IN that language, so both options read
                        the same whichever way the interface is set. */}
                    <option value="en">English</option>
                    <option value="ar">العربية</option>
                  </select>
                </Field>
              </div>
            </section>

            {saveError && (
              <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{saveError}</p>
            )}

            <div className="mt-4 flex items-center justify-end gap-3">
              {saved && (
                <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                  <Check className="h-4 w-4" aria-hidden />
                  {t("common.saved", lang)}
                </span>
              )}
              <Btn
                type="submit"
                variant="primary"
                className={saving ? "opacity-50 pointer-events-none" : ""}
              >
                {saving ? t("common.saving", lang) : t("common.save", lang)}
              </Btn>
            </div>
          </form>

          {/* ---- PASSWORD — its own form, its own button, deliberately last ----
              Separated by a rule so it cannot be mistaken for part of the form
              above. A nested <form> would be invalid HTML, which is the other
              reason the profile form is closed before this opens. */}
          <hr className="mt-8" style={{ borderColor: "rgb(var(--border))" }} />

          <section className="mt-6">
            <GroupHeading>{t("settings.profile.gPassword", lang)}</GroupHeading>
            <form onSubmit={onChangePassword} className={cn("mt-2 space-y-3", CARD)} style={CARD_STYLE}>
              <Field
                label={t("settings.profile.fCurrentPassword", lang)}
                hint={t("settings.profile.hCurrentPassword", lang)}
              >
                <input
                  type="password"
                  autoComplete="current-password"
                  value={pw.current}
                  onChange={(e) => { setPwDone(false); setPwError(null); setPw((p) => ({ ...p, current: e.target.value })); }}
                  className={INPUT}
                  style={INPUT_STYLE}
                  dir="ltr"
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={t("settings.profile.fNewPassword", lang)}
                  // `{n}` through a replacer FUNCTION, like every other token
                  // substitution in this batch. MIN_PASSWORD_LENGTH is a number
                  // and cannot carry a `$&`, but the rule is uniform so no future
                  // edit has to work out which sites were the safe ones.
                  hint={t("settings.profile.hNewPassword", lang)
                    .replace("{n}", () => String(MIN_PASSWORD_LENGTH))}
                >
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={pw.next}
                    onChange={(e) => { setPwDone(false); setPwError(null); setPw((p) => ({ ...p, next: e.target.value })); }}
                    className={INPUT}
                    style={INPUT_STYLE}
                    dir="ltr"
                  />
                </Field>
                <Field label={t("settings.profile.fConfirmPassword", lang)}>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={pw.confirm}
                    onChange={(e) => { setPwDone(false); setPwError(null); setPw((p) => ({ ...p, confirm: e.target.value })); }}
                    className={INPUT}
                    style={INPUT_STYLE}
                    dir="ltr"
                  />
                </Field>
              </div>

              {pwError && <p className="text-sm text-rose-600 dark:text-rose-400">{pwError}</p>}

              <div className="flex items-center justify-end gap-3">
                {pwDone && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                    <Check className="h-4 w-4" aria-hidden />
                    {t("settings.profile.passwordChanged", lang)}
                  </span>
                )}
                <Btn
                  type="submit"
                  className={pwSaving ? "opacity-50 pointer-events-none" : ""}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" aria-hidden />
                    {pwSaving
                      ? t("settings.profile.changing", lang)
                      : t("settings.profile.changePassword", lang)}
                  </span>
                </Btn>
              </div>
            </form>
          </section>

          {/* The boundary, said out loud where the person affected can read it.
              Someone looking for their leave balance should learn here that it
              is not coming, rather than concluding the page is broken. */}
          <p className="mt-6 flex items-start gap-2 text-[11px] muted">
            <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{t("settings.profile.boundaryNote", lang)}</span>
          </p>
        </>
      )}
    </div>
  );
}
