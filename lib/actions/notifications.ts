"use server";

// Notifications — the ONE read and the ONE write behind the bell.
//
// ==========================================================================
// SECURITY, stated because it is the whole design
// ==========================================================================
// `v_my_notifications` (0154) is SECURITY INVOKER, and both actions here use the
// request-scoped client from lib/supabase/server, which carries the caller's own
// auth cookies. So `auth.uid()` inside the view IS the logged-in user, and the
// per-user RLS on notification_prefs / notification_dismissals applies to the
// caller. This path cannot surface another user's dismiss state.
//
// Do NOT "optimise" either of these to a service-role client. The view's entire
// per-user behaviour — which severities you see, what you have dismissed —
// collapses to NULL under a service role, and the bell would show every user the
// same undismissable list. Same rule as lib/actions/search.ts.
//
// ==========================================================================
// THE VIEW OWNS THE FILTERING. THIS FILE JUST READS IT.
// ==========================================================================
// No severity filter, no dismissal join, no resurfacing arithmetic here. The
// view already applied the user's preferences and the dismiss-visibility rule
// (RED hides for the rest of the Riyadh day, YELLOW/BLUE for 7 days, then both
// come back). Re-deriving any of that in the app would give the product two
// definitions of "dismissed" that drift the first time either side changes.

import { createClient } from "@/lib/supabase/server";
import type { NotificationRow } from "@/lib/notification-format";

export type NotificationsResult =
  | { rows: NotificationRow[]; error: null }
  | { rows: null; error: string };

/**
 * Every notification currently visible to the caller.
 *
 * Ordering is done in the app rather than in the view: the view is a UNION of
 * nineteen branches and adding a global ORDER BY there would impose a sort on
 * every future consumer of it, including ones that want their own. The panel's
 * order is a presentation choice, so it lives with the presentation.
 *
 * FAILS LOUD, NOT EMPTY. A read error returns an error string, never `[]` —
 * an empty bell and a broken bell look identical to a user, and the whole point
 * of this feature is that silence means "nothing is wrong".
 */
export async function fetchMyNotifications(): Promise<NotificationsResult> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("v_my_notifications")
    .select(
      "alert_identity, severity, category, entity_type, entity_id, entity_label, value_num, value_date, payload, source, occurred_at, dismissed_at",
    );

  if (error) return { rows: null, error: error.message };
  return { rows: (data ?? []) as NotificationRow[], error: null };
}

/**
 * Dismiss one alert for the current user.
 *
 * UPSERT, not insert: dismissing something that was already dismissed and has
 * since resurfaced must MOVE the timestamp, not fail on the composite primary
 * key and not add a second row. `onConflict` names that key exactly.
 *
 * user_id is NOT a parameter and must never become one. It is filled from
 * auth.uid() so a caller cannot dismiss on someone else's behalf; the RLS
 * WITH CHECK on notification_dismissals enforces the same thing a second time,
 * which is the belt to this braces.
 *
 * alert_identity is passed through verbatim. It is the view's own stable key —
 * the app does not construct, parse or normalise it, because a client that
 * rebuilds the identity would eventually build a slightly different one and
 * write a dismissal that matches nothing.
 */
export async function dismissNotification(
  alertIdentity: string,
): Promise<{ error: string | null }> {
  const id = alertIdentity?.trim() ?? "";
  if (!id) return { error: "Missing alert identity." };

  const supabase = createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return { error: authErr.message };
  const userId = auth?.user?.id;
  if (!userId) return { error: "Not signed in." };

  const { error } = await supabase
    .from("notification_dismissals")
    .upsert(
      { user_id: userId, alert_identity: id, dismissed_at: new Date().toISOString() },
      { onConflict: "user_id,alert_identity" },
    );

  if (error) return { error: error.message };

  // NO revalidatePath. The bell lives in AppShell on every route, and the panel
  // refetches through fetchMyNotifications the moment this resolves — busting
  // the whole route's cache to update one dropdown would re-render every page
  // in the app to no visible benefit.
  return { error: null };
}
