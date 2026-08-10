"use server";

// Who is signed in, for the header's account control.
//
// The session only carries an EMAIL. A name and a job title already exist for
// every real user in `public.staff` (name / name_ar / role), and role labels
// already live in the `staff_roles` lookup that the Staff page renders from —
// so this reads those rather than inventing a second source. No migration:
// the data was there, the header just never asked for it.
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
};

export async function getViewer(): Promise<Viewer | null> {
  const supabase = createClient();

  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) return null;

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
    // Not an error state worth surfacing — just means no staff row.
    return { email, name: null, nameAr: null, roleLabel: null };
  }

  let roleLabel: string | null = null;
  if (data.role) {
    const { data: roleRow } = await supabase
      .from("staff_roles")
      .select("label")
      .eq("key", data.role)
      .maybeSingle();
    // Fall back to the raw key rather than showing nothing — a missing
    // lookup row should degrade to "fleet_manager", not to blank.
    roleLabel = roleRow?.label ?? data.role;
  }

  return {
    email,
    name: data.name ?? null,
    nameAr: data.name_ar ?? null,
    roleLabel,
  };
}
