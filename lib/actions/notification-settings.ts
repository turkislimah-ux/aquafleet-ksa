"use server";

// Notification settings — the reads and the two writes behind the Settings
// popup's Notifications section (phase 2.2b).
//
// ==========================================================================
// EVERY EXPORT HERE IS AN ASYNC FUNCTION. THAT IS A HARD RULE.
// ==========================================================================
// A "use server" module turns each export into a callable server reference, so
// a plain const or object is not a legal export. This file previously exported
// a THRESHOLD_KEYS array and it stuck the Settings section on a permanent
// "Loading…" — `next build` did not flag it, but build and dev validate this
// differently, and the rule holds either way.
//
// The bounds, keys and validator now live in lib/notification-thresholds.ts, a
// plain module both this file and the editor import. If you need to expose a
// constant to the client, it does NOT go here.
//
// ==========================================================================
// SECURITY
// ==========================================================================
// Every call uses the request-scoped client from lib/supabase/server, so it
// carries the caller's cookies and auth.uid() is the logged-in user. Both
// per-user tables are RLS'd to `user_id = auth.uid()`, and none of these actions
// takes a user id as a parameter, so there is nothing to spoof.
//
// Do NOT move any of this to a service-role client. The whole feature is
// per-user; under a service role auth.uid() is NULL, the RLS predicates stop
// matching, and the editor would read and write nothing while appearing to work.
//
// ==========================================================================
// THE APP WRITES THE ROW. THE VIEW DOES THE REST.
// ==========================================================================
// Nothing here recomputes, filters or re-ranks an alert. v_active_alerts
// resolves thresholds per viewer (0158) and v_my_notifications applies the
// severity preferences and dismissals (0154) — both security_invoker, both
// already running as the caller. Saving a row changes what the bell shows on its
// next fetch because the VIEW reads the row.
//
// ==========================================================================
// NO ERROR IS EVER RETURNED EMPTY
// ==========================================================================
// Every failure path returns a NON-EMPTY message, and every action wraps its
// body so a thrown exception becomes a returned string instead of a rejected
// promise. A rejected promise from a server action leaves the caller's `await`
// unresolved into its error branch and the UI sits on its loading state
// forever — which is exactly the bug this file caused once already.
//
// An empty error string is also a real hazard for callers, because
// `if (res.error)` is false for "" — see the narrowing note in the editor.

import { createClient } from "@/lib/supabase/server";
import {
  THRESHOLD_KEYS, HARDCODED_DEFAULTS, validateThreshold,
  type ThresholdOverrides, type SharedDefaults,
} from "@/lib/notification-thresholds";

export type SeverityPrefs = { show_red: boolean; show_yellow: boolean; show_blue: boolean };

export type NotificationSettings = {
  prefs: SeverityPrefs;
  /** True when this user has no notification_prefs row — everything is shown. */
  prefsAreDefault: boolean;
  overrides: ThresholdOverrides;
  defaults: SharedDefaults;
};

function msg(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  try {
    const s = JSON.stringify(e);
    if (s && s !== "{}" && s !== "null") return s;
  } catch {
    /* fall through to the fallback */
  }
  return fallback;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Everything the Notifications section needs, in one round trip.
 *
 * "NO ROW" IS A VALID ANSWER, NOT AN ERROR. Both per-user tables legitimately
 * have zero rows for a user who has never opened this editor — that state means
 * "all defaults", and `maybeSingle()` reports it as data null with no error.
 * Treating it as a failure is how a first-time user gets an error screen.
 *
 * FAILS LOUD ON A REAL ERROR. A read failure returns a message rather than
 * defaults: rendering "all severities on, thresholds at default" when the read
 * actually failed invites saving that fiction over real settings.
 */
export async function fetchNotificationSettings(): Promise<
  { data: NotificationSettings; error: null } | { data: null; error: string }
> {
  try {
    const supabase = createClient();

    const [prefsRes, overridesRes, defaultsRes] = await Promise.all([
      supabase.from("notification_prefs").select("show_red, show_yellow, show_blue").maybeSingle(),
      supabase
        .from("notification_thresholds_user")
        .select("low_runway_trips, doc_expiry_lead_days, maintenance_stuck_days, invoice_overdue_red_days")
        .maybeSingle(),
      supabase
        .from("notification_thresholds")
        .select("low_runway_trips, doc_expiry_lead_days, maintenance_stuck_days, invoice_overdue_red_days")
        .maybeSingle(),
    ]);

    // Name WHICH read failed. With three in one Promise.all, a bare
    // "permission denied" does not say which table to look at.
    if (prefsRes.error) {
      console.error("[notification-settings] notification_prefs read failed", prefsRes.error);
      return { data: null, error: `Preferences: ${msg(prefsRes.error, "read failed")}` };
    }
    if (overridesRes.error) {
      console.error("[notification-settings] notification_thresholds_user read failed", overridesRes.error);
      return { data: null, error: `Your thresholds: ${msg(overridesRes.error, "read failed")}` };
    }
    if (defaultsRes.error) {
      console.error("[notification-settings] notification_thresholds read failed", defaultsRes.error);
      return { data: null, error: `Shared defaults: ${msg(defaultsRes.error, "read failed")}` };
    }

    // RLS already scoped both per-user selects to auth.uid(), so a null row
    // means "this user has no row", never "somebody else's row".
    const p = prefsRes.data;
    const o = overridesRes.data;
    const d = defaultsRes.data;

    return {
      data: {
        // Absent row = all three shown. MUST match v_my_notifications' coalesce
        // and notification_prefs' column defaults — three places, all true.
        prefs: {
          show_red: p?.show_red ?? true,
          show_yellow: p?.show_yellow ?? true,
          show_blue: p?.show_blue ?? true,
        },
        prefsAreDefault: p == null,
        overrides: {
          low_runway_trips: num(o?.low_runway_trips),
          doc_expiry_lead_days: num(o?.doc_expiry_lead_days),
          maintenance_stuck_days: num(o?.maintenance_stuck_days),
          invoice_overdue_red_days: num(o?.invoice_overdue_red_days),
        },
        defaults: {
          low_runway_trips: num(d?.low_runway_trips) ?? HARDCODED_DEFAULTS.low_runway_trips,
          doc_expiry_lead_days: num(d?.doc_expiry_lead_days) ?? HARDCODED_DEFAULTS.doc_expiry_lead_days,
          maintenance_stuck_days: num(d?.maintenance_stuck_days) ?? HARDCODED_DEFAULTS.maintenance_stuck_days,
          invoice_overdue_red_days: num(d?.invoice_overdue_red_days) ?? HARDCODED_DEFAULTS.invoice_overdue_red_days,
        },
      },
      error: null,
    };
  } catch (e) {
    console.error("[notification-settings] fetchNotificationSettings threw", e);
    return { data: null, error: msg(e, "Could not load notification settings.") };
  }
}

async function currentUserId(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase.auth.getUser();
  if (error) return { id: null as string | null, error: msg(error, "Could not read the session.") };
  const id = data?.user?.id ?? null;
  return { id, error: id ? null : "Not signed in." };
}

/**
 * Save the three severity toggles.
 *
 * UPSERT, because no row exists until the first save — v_my_notifications
 * coalesces a missing row to all-true, so "no row" and "all three on" are the
 * same state, and the first toggle-off is what creates the row.
 *
 * updated_at IS SET EXPLICITLY. notification_prefs predates the shared
 * set_updated_at() trigger (0154 vs 0157) and has none, unlike
 * notification_thresholds_user which does. Checked in the catalog rather than
 * assumed; without this the column would sit at its insert value forever.
 */
export async function saveSeverityPrefs(prefs: SeverityPrefs): Promise<{ error: string | null }> {
  try {
    const supabase = createClient();
    const { id, error: authErr } = await currentUserId(supabase);
    if (!id) return { error: authErr ?? "Not signed in." };

    const { error } = await supabase.from("notification_prefs").upsert(
      {
        user_id: id,
        show_red: !!prefs.show_red,
        show_yellow: !!prefs.show_yellow,
        show_blue: !!prefs.show_blue,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (error) {
      console.error("[notification-settings] saveSeverityPrefs failed", error);
      return { error: msg(error, "Could not save preferences.") };
    }
    return { error: null };
  } catch (e) {
    console.error("[notification-settings] saveSeverityPrefs threw", e);
    return { error: msg(e, "Could not save preferences.") };
  }
}

/**
 * Save the four threshold overrides.
 *
 * NULL IS A REAL VALUE HERE, not a missing one. A null field means "inherit the
 * shared default for this threshold", so reset-to-default is this write with
 * that column set to null — NOT a row delete, which would reset all four.
 *
 * Every field is written every time, including the nulls. A partial upsert would
 * leave a previously-overridden column untouched, so clearing a field in the UI
 * would appear to work and then silently revert on reload.
 *
 * Validated through the SAME validateThreshold the editor uses, so a value can
 * never pass the form and fail the database. The message names the field —
 * with four inputs, "violates check constraint" does not say which one.
 */
export async function saveThresholdOverrides(
  overrides: ThresholdOverrides,
): Promise<{ error: string | null }> {
  try {
    for (const key of THRESHOLD_KEYS) {
      const problem = validateThreshold(key, overrides[key] ?? null);
      if (problem) return { error: problem };
    }

    const supabase = createClient();
    const { id, error: authErr } = await currentUserId(supabase);
    if (!id) return { error: authErr ?? "Not signed in." };

    const { error } = await supabase.from("notification_thresholds_user").upsert(
      {
        user_id: id,
        low_runway_trips: overrides.low_runway_trips,
        doc_expiry_lead_days: overrides.doc_expiry_lead_days,
        maintenance_stuck_days: overrides.maintenance_stuck_days,
        invoice_overdue_red_days: overrides.invoice_overdue_red_days,
        // No updated_at: notification_thresholds_user carries the shared
        // set_updated_at() trigger from 0157, which stamps it on UPDATE, and the
        // column default covers INSERT.
      },
      { onConflict: "user_id" },
    );

    if (error) {
      console.error("[notification-settings] saveThresholdOverrides failed", error);
      return { error: msg(error, "Could not save thresholds.") };
    }
    return { error: null };
  } catch (e) {
    console.error("[notification-settings] saveThresholdOverrides threw", e);
    return { error: msg(e, "Could not save thresholds.") };
  }
}
