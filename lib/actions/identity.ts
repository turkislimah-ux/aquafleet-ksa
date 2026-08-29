"use server";

// Who is signed in, for the header's account control.
//
// The session only carries an EMAIL. A name and a job title already exist for
// every real user in `public.staff` (name / name_ar / role), and role labels
// already live in the `staff_roles` lookup that the Staff page renders from —
// so this reads those rather than inventing a second source. No migration:
// the data was there, the header just never asked for it.
//
// ==========================================================================
// 2.2c: THE ACCOUNT DISPLAY NAME NOW WINS OVER THE STAFF NAME
// ==========================================================================
// Settings → Profile lets a user set their own display name, stored in Supabase
// Auth's user_metadata. When they have set one it takes precedence here, because
// a name a person typed about themselves outranks a name someone else typed into
// an HR form. When they have NOT set one — which is every user until they open
// that section — this behaves exactly as it always did.
//
// AND IT CLEARS nameAr WHEN IT WINS. The header falls back from nameAr to name
// in Arabic (`arText` in lib/i18n.ts), so leaving a staff-sourced Arabic name in
// place would show the new name in English and the old one in Arabic. A
// self-chosen name applies in both languages or it is not a self-chosen name.
//
// THIS FILE STILL READS public.staff, AND THAT IS NOT A BOUNDARY BREACH.
// user_profiles (0159) must never link to an employee record, and it does not:
// nothing here joins the two, and this function does not touch user_profiles at
// all. The staff read predates the profile feature and serves a different
// question — "what is this person's ROLE" — which the profile deliberately
// cannot answer, because job_title there is a cosmetic label.
//
// RLS applies (request-scoped client), and the query is scoped to the
// caller's own email, so this cannot be used to enumerate colleagues.
//
// Everything is optional by design. A signed-in user with no `staff` row is a
// real state — Supabase Auth and `public.staff` are separate systems and
// nothing forces a row to exist (migration 0054 had to create one by hand for
// Turki's own login). In that case the header falls back to the email rather
// than inventing a name.

import { createClient } from "@/lib/supabase/server";

export type Viewer = {
  email: string;
  /** From public.staff. Null when the signed-in user has no staff row. */
  name: string | null;
  nameAr: string | null;
  /** Human label from staff_roles (e.g. "Fleet Manager"), not the raw key. */
  roleLabel: string | null;
  /**
   * Arabic name from staff_roles, or null. Null for a custom role — only the
   * seeded built-ins carry one — so the header must fall back to `roleLabel`
   * rather than blanking. Pair them with `arText`, never read alone.
   */
  roleLabelAr: string | null;
};

export async function getViewer(): Promise<Viewer | null> {
  const supabase = createClient();

  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) return null;

  // The self-chosen name, if there is one. Trimmed and emptiness-checked here so
  // that a metadata value of "" or "   " does NOT beat a real staff name — ""
  // is falsy but not nullish, and `meta.display_name ?? staffName` would have
  // handed the header a blank. The same trap the bell and the commission path
  // both hit this week.
  const meta = auth.user?.user_metadata as { display_name?: unknown } | null;
  const accountName =
    typeof meta?.display_name === "string" && meta.display_name.trim()
      ? meta.display_name.trim()
      : null;

  // `staff.email` is stored as typed, and Turki's own row was created with a
  // mixed-case address — so match case-insensitively rather than assuming the
  // session's casing matches what someone typed into the Staff form.
  const { data, error } = await supabase
    .from("staff")
    .select("name, name_ar, role")
    .ilike("email", email)
    .is("terminated_at", null)
    .maybeSingle();

  if (error || !data) {
    // Not an error state worth surfacing — just means no staff row. The account
    // name still applies: a user with no staff row who set a display name should
    // see it, not their email's local part.
    return { email, name: accountName, nameAr: null, roleLabel: null, roleLabelAr: null };
  }

  let roleLabel: string | null = null;
  let roleLabelAr: string | null = null;
  if (data.role) {
    const { data: roleRow } = await supabase
      .from("staff_roles")
      .select("label, label_ar")
      .eq("key", data.role)
      .maybeSingle();
    // Fall back to the raw key rather than showing nothing — a missing
    // lookup row should degrade to "fleet_manager", not to blank. The Arabic
    // half stays null in that case: there is no row to have read it from, and
    // `arText` then shows the key in both languages rather than inventing one.
    roleLabel = roleRow?.label ?? data.role;
    roleLabelAr = roleRow?.label_ar ?? null;
  }

  // The account name wins in BOTH languages when it is set — hence nameAr going
  // null rather than keeping the staff Arabic name beside a new English one.
  // The role label is untouched either way: the profile has no say over it.
  return {
    email,
    name: accountName ?? data.name ?? null,
    nameAr: accountName ? null : (data.name_ar ?? null),
    roleLabel,
    roleLabelAr,
  };
}
