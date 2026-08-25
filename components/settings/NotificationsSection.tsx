"use client";

// Settings → Notifications (phase 2.2b). Two per-user editors: the three
// severity toggles, and the four threshold overrides.
//
// ==========================================================================
// TWO SAVE MODELS, ON PURPOSE
// ==========================================================================
// The toggles save IMMEDIATELY. A switch that needs a Save button to take
// effect is a switch that lies about its own state — you flip it, it looks on,
// and it is not. That is the universal convention for switches and it is the
// right one here.
//
// The thresholds save on an explicit SAVE. They are four numbers that need
// validating together and any of them can be typed wrong halfway through; saving
// per-keystroke would write nonsense on the way to a valid number.
//
// The section makes the difference visible rather than hoping it is inferred:
// the toggles carry no button, the thresholds have one.
//
// ==========================================================================
// THE APP WRITES THE ROW. THE VIEW DECIDES WHAT SHOWS.
// ==========================================================================
// Nothing here filters or recomputes an alert. v_active_alerts already resolves
// thresholds per viewer and v_my_notifications already applies severity prefs —
// both security_invoker. Saving here changes the bell on its next fetch because
// the VIEW reads these rows.
//
// ==========================================================================
// BLANK MEANS INHERIT
// ==========================================================================
// A NULL threshold column means "use the shared default for THIS one", so the
// editor maps an EMPTY INPUT to null. That makes reset-to-default the same
// gesture as clearing a field, and it is why each row states the default it
// falls back to — a blank box with no stated default just looks unset.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, RotateCcw } from "lucide-react";
import { Btn, PILL_TONE_CLS } from "@/components/ui";
import { cn } from "@/lib/utils";
import { SEVERITY_TONE, type Severity } from "@/lib/notification-format";
import {
  fetchNotificationSettings, saveSeverityPrefs, saveThresholdOverrides,
  type NotificationSettings, type SeverityPrefs,
} from "@/lib/actions/notification-settings";
import {
  THRESHOLD_BOUNDS, validateThreshold,
  type ThresholdKey, type ThresholdOverrides,
} from "@/lib/notification-thresholds";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-28 tabular-nums";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// Copy carries the WORDS. The numeric bounds come from THRESHOLD_BOUNDS so the
// input attributes, the client validation, the server validation and the DB
// CHECK are one definition rather than four that drift.
const FIELDS: {
  key: ThresholdKey;
  label: string; labelAr: string;
  help: string; helpAr: string;
  step: string;
}[] = [
  {
    key: "low_runway_trips",
    label: "Low balance warning", labelAr: "تحذير قرب نفاد الرصيد",
    help: "Warn when a prepaid wallet holds fewer than this many trips' worth of work.",
    helpAr: "تنبيه عندما يقل رصيد العميل عن هذا العدد من الرحلات.",
    step: "0.5",
  },
  {
    key: "doc_expiry_lead_days",
    label: "Document expiry notice", labelAr: "مهلة انتهاء المستندات",
    help: "How many days before a licence, iqama or registration expires to start warning.",
    helpAr: "عدد الأيام قبل انتهاء الرخصة أو الإقامة أو الاستمارة لبدء التنبيه.",
    step: "1",
  },
  {
    key: "maintenance_stuck_days",
    label: "Work order stuck after", labelAr: "أمر الصيانة متعثر بعد",
    help: "An open work order older than this is flagged as stuck.",
    helpAr: "أمر صيانة مفتوح أطول من هذه المدة يُعتبر متعثرًا.",
    step: "1",
  },
  {
    key: "invoice_overdue_red_days",
    label: "Invoice turns red after", labelAr: "الفاتورة تصبح حمراء بعد",
    help: "Overdue longer than this escalates the invoice alert from yellow to red.",
    helpAr: "التأخر أكثر من هذه المدة يرفع تنبيه الفاتورة من الأصفر إلى الأحمر.",
    step: "1",
  },
];

const SEVERITIES: { key: Severity; prefKey: keyof SeverityPrefs; label: string; labelAr: string; hint: string; hintAr: string }[] = [
  { key: "red",    prefKey: "show_red",    label: "Act today",  labelAr: "عاجل",   hint: "Money and compliance",          hintAr: "المال والامتثال" },
  { key: "yellow", prefKey: "show_yellow", label: "This week",  labelAr: "هذا الأسبوع", hint: "Coming up, not urgent",   hintAr: "قادم وغير عاجل" },
  { key: "blue",   prefKey: "show_blue",   label: "For info",   labelAr: "للعلم",  hint: "Never counted in the badge",    hintAr: "لا تُحتسب في العداد" },
];

/** Empty string maps to null — "inherit the shared default for this field". */
function parseField(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN as unknown as number;
}

export default function NotificationsSection({ open, lang }: { open: boolean; lang: "en" | "ar" }) {
  const router = useRouter();
  const ar = lang === "ar";

  const [data, setData] = useState<NotificationSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Threshold inputs are held as STRINGS, not numbers. "" is a meaningful value
  // here (inherit) and a number-typed state cannot hold "" without conflating it
  // with 0 — which is a legal threshold meaning something completely different.
  const [draft, setDraft] = useState<Record<ThresholdKey, string>>({
    low_runway_trips: "", doc_expiry_lead_days: "",
    maintenance_stuck_days: "", invoice_overdue_red_days: "",
  });
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [savingThresholds, setSavingThresholds] = useState(false);
  const [thresholdError, setThresholdError] = useState<string | null>(null);
  const [thresholdsSaved, setThresholdsSaved] = useState(false);

  const load = useCallback(async () => {
    // WRAPPED so a rejected action becomes a visible error state. The action
    // already catches its own throws, but if it fails to load at all — the bug
    // that caused this section to hang — the rejection lands here instead of
    // leaving `data` null forever behind a spinner.
    let res: Awaited<ReturnType<typeof fetchNotificationSettings>>;
    try {
      res = await fetchNotificationSettings();
    } catch (e) {
      console.error("[NotificationsSection] load threw", e);
      setLoadError(e instanceof Error && e.message ? e.message : "Could not load notification settings.");
      return;
    }
    // NARROW ON `data`, NOT ON `error`. `error: string` includes "", which is
    // falsy, so `if (res.error)` does not discriminate the union — the same trap
    // lib/prepaid.ts's priceDelivery already documents. Checking `data` is what
    // actually proves which branch this is.
    if (!res.data) { setLoadError(res.error); return; }
    const next = res.data;
    setLoadError(null);
    setData(next);
    setDraft({
      low_runway_trips: next.overrides.low_runway_trips?.toString() ?? "",
      doc_expiry_lead_days: next.overrides.doc_expiry_lead_days?.toString() ?? "",
      maintenance_stuck_days: next.overrides.maintenance_stuck_days?.toString() ?? "",
      invoice_overdue_red_days: next.overrides.invoice_overdue_red_days?.toString() ?? "",
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    setThresholdError(null);
    setThresholdsSaved(false);
    void load();
  }, [open, load]);

  if (!open) return null;

  async function toggle(prefKey: keyof SeverityPrefs) {
    if (!data) return;
    const next: SeverityPrefs = { ...data.prefs, [prefKey]: !data.prefs[prefKey] };
    setTogglingKey(prefKey);
    // Optimistic: a switch must move under the finger. Reconciled by the reload
    // below, which is the authoritative read.
    setData({ ...data, prefs: next, prefsAreDefault: false });
    const res = await saveSeverityPrefs(next);
    if (res.error) setLoadError(res.error);
    await load();
    setTogglingKey(null);
    // The bell lives in AppShell and holds its own copy of the alert list;
    // refresh so a severity switched off disappears from it without a reload.
    router.refresh();
  }

  async function saveThresholds() {
    setThresholdError(null);
    setThresholdsSaved(false);

    const parsed: Partial<ThresholdOverrides> = {};
    for (const f of FIELDS) {
      const v = parseField(draft[f.key]);
      // ONE validator, shared with the server action, so a value can never
      // pass the form and then fail the database. Arabic gets the label; the
      // rule text stays English rather than inventing a second rule set.
      const b = THRESHOLD_BOUNDS[f.key];
      if (v !== null && Number.isNaN(v)) {
        setThresholdError(ar ? `${f.labelAr}: قيمة غير صالحة.` : `${b.label}: not a number.`);
        return;
      }
      const problem = validateThreshold(f.key, v);
      if (problem) {
        setThresholdError(ar ? `${f.labelAr}: ${problem.split(": ")[1] ?? problem}` : problem);
        return;
      }
      parsed[f.key] = v;
    }

    setSavingThresholds(true);
    const res = await saveThresholdOverrides(parsed as ThresholdOverrides);
    setSavingThresholds(false);
    if (res.error) { setThresholdError(res.error); return; }
    setThresholdsSaved(true);
    await load();
    router.refresh();
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">{ar ? "الإشعارات" : "Notifications"}</h2>
      <p className="mt-1 text-sm muted">
        {ar
          ? "تخصّك وحدك — لا تؤثر على المستخدم الآخر."
          : "Yours alone — these never change what the other user sees."}
      </p>

      {loadError && (
        <div className="mt-4 rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/20">
          {loadError}{" "}
          <button onClick={() => void load()} className="focus-ring underline underline-offset-2">
            {ar ? "إعادة المحاولة" : "Try again"}
          </button>
        </div>
      )}

      {data === null ? (
        <div className="py-8 text-center text-sm muted">{ar ? "جارٍ التحميل…" : "Loading…"}</div>
      ) : (
        <>
          {/* ---- A. SEVERITY TOGGLES — save on flip ---- */}
          <section className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">
              {ar ? "ما الذي يظهر" : "What shows"}
            </h3>
            <div className="mt-2 rounded-xl border divide-y divide-[rgb(var(--border))]" style={{ borderColor: "rgb(var(--border))" }}>
              {SEVERITIES.map((s) => {
                const on = data.prefs[s.prefKey];
                const tone = PILL_TONE_CLS[SEVERITY_TONE[s.key]];
                return (
                  <label
                    key={s.key}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2.5"
                    style={{ borderColor: "rgb(var(--border))" }}
                  >
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", tone.dot)} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">{ar ? s.labelAr : s.label}</span>
                      <span className="block text-xs muted">{ar ? s.hintAr : s.hint}</span>
                    </span>
                    {/* A real checkbox, not a div pretending: it is focusable,
                        space-toggleable and announced without any ARIA work. */}
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={togglingKey === s.prefKey}
                      onChange={() => void toggle(s.prefKey)}
                      className="focus-ring h-4 w-4 shrink-0 accent-brand-600 disabled:opacity-50"
                      aria-label={ar ? s.labelAr : s.label}
                    />
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-xs muted">
              {ar
                ? "يُحفظ فورًا. إخفاء مستوى لا يحذف التنبيهات — يخفيها عنك فقط."
                : "Saved instantly. Hiding a level does not delete those alerts — it only hides them from you."}
            </p>
          </section>

          {/* ---- B. THRESHOLDS — explicit save ---- */}
          <section className="mt-8">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">
              {ar ? "متى تظهر" : "When they fire"}
            </h3>

            <div className="mt-2 space-y-3">
              {FIELDS.map((f) => {
                const shared = data.defaults[f.key];
                const isOverridden = draft[f.key].trim() !== "";
                return (
                  <div
                    key={f.key}
                    className="rounded-xl border p-3"
                    style={{ borderColor: "rgb(var(--border))" }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{ar ? f.labelAr : f.label}</span>
                          {/* The state badge. "Default" vs "Custom" is the one
                              thing that is invisible from the number alone —
                              30 typed by hand and 30 inherited look identical. */}
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                              isOverridden
                                ? PILL_TONE_CLS.info.chip
                                : "bg-slate-500/10 text-slate-600 dark:text-slate-300 ring-slate-500/20",
                            )}
                          >
                            {isOverridden ? (ar ? "مخصّص" : "Custom") : (ar ? "افتراضي" : "Default")}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs muted">{ar ? f.helpAr : f.help}</p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={THRESHOLD_BOUNDS[f.key].min}
                          max={THRESHOLD_BOUNDS[f.key].max}
                          step={f.step}
                          value={draft[f.key]}
                          // Placeholder carries the inherited value, so a blank
                          // field still tells you what it will actually use.
                          placeholder={String(shared)}
                          onChange={(e) => {
                            setThresholdsSaved(false);
                            setThresholdError(null);
                            setDraft((d) => ({ ...d, [f.key]: e.target.value }));
                          }}
                          className={INPUT}
                          style={INPUT_STYLE}
                          aria-label={ar ? f.labelAr : f.label}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setThresholdsSaved(false);
                            setThresholdError(null);
                            setDraft((d) => ({ ...d, [f.key]: "" }));
                          }}
                          disabled={!isOverridden}
                          title={ar ? "استعادة الافتراضي" : "Reset to default"}
                          aria-label={`${ar ? "استعادة الافتراضي" : "Reset to default"} — ${ar ? f.labelAr : f.label}`}
                          className="focus-ring rounded-md p-1.5 muted transition hover:text-brand-600 disabled:opacity-30 disabled:hover:text-inherit"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    </div>

                    <p className="mt-1.5 text-[11px] muted">
                      {ar
                        ? `الافتراضي المشترك: ${shared} — اتركه فارغًا لاستخدامه.`
                        : `Shared default: ${shared} — leave blank to use it.`}
                    </p>
                  </div>
                );
              })}
            </div>

            {thresholdError && (
              <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{thresholdError}</p>
            )}

            <div className="mt-4 flex items-center justify-end gap-3">
              {thresholdsSaved && (
                <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                  <Check className="h-4 w-4" aria-hidden />
                  {ar ? "تم الحفظ" : "Saved"}
                </span>
              )}
              <Btn
                variant="primary"
                onClick={() => void saveThresholds()}
                className={savingThresholds ? "opacity-50 pointer-events-none" : ""}
              >
                {savingThresholds ? (ar ? "جارٍ الحفظ…" : "Saving…") : ar ? "حفظ" : "Save"}
              </Btn>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
