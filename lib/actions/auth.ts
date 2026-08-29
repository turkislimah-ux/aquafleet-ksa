"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();

  // SHARED TERMINAL: the display preferences leave with the session.
  //
  // app/layout.tsx renders <html lang dir class> from these two cookies, so a
  // stale one would hand the next person at this machine the previous user's
  // Arabic and dark mode on first paint. They hold the SESSION's preferences,
  // and signing out is the only moment we know the device changed hands.
  //
  // Clearing them is what makes the account language work rather than what
  // fights it: preferred_language (0159, wired at login by 0171) is re-read on
  // the next sign-in, so the incoming user's own language is applied from a
  // clean jar instead of inheriting the outgoing user's.
  //
  // Deleted here rather than only on the client so it holds without JS and
  // cannot lose a race with the redirect. AppShell clears the matching
  // localStorage keys on the same click — the cookie is what the SERVER reads,
  // localStorage is what the client reconciles from, and a survivor in either
  // one would restore the old preference.
  const jar = cookies();
  jar.delete("lang");
  jar.delete("theme");

  redirect("/login");
}
