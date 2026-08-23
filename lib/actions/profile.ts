"use server";

// Settings → Profile (phase 2.2c step 2). Reads and writes for the account
// controls and the user_profiles row.
//
// ==========================================================================
// EVERY EXPORT HERE IS AN ASYNC FUNCTION. THAT IS A HARD RULE.
// ==========================================================================
// A "use server" module turns each export into a callable server reference, so
// a plain const, type alias or object is not a legal export. Breaking this is
// what stuck the Notifications section on a permanent "Loading…" in 2.2b, and
// `next build` did not flag it. Shapes and constants live in lib/profile.ts.
//
// ==========================================================================
// THE BOUNDARY — THIS FILE TOUCHES auth AND user_profiles. NOTHING ELSE.
// ==========================================================================
// No staff, no drivers, no leave_periods. No iqama, no salary, no leave, no
// employment data. 0159's header explains why at length; the short version is
// that there is currently NO path from "who is logged in" to "which employee
// record is this", and that absence is what stops any query here widening into
// payroll or identity documents. Do not add the join, however convenient.
//
// The one apparent exception is not one: lib/actions/identity.ts reads
// public.staff for the header's name, and has since long before this feature.
// This file does not call it, does not join to it, and does not read it.
//
// ==========================================================================
// SECURITY
// ==========================================================================
// Every call uses the request-scoped client from lib/supabase/server, so it
// carries the caller's cookies and auth.uid() is the logged-in user.
// user_profiles is RLS'd to `user_id = auth.uid()` for BOTH read and write, and
// no action here takes a user id as a parameter — there is nothing to spoof.
//
// Do NOT move any of this to a service-role client. Under a service role
// auth.uid() is NULL, the RLS predicate stops matching, and the editor would
// read and write nothing while appearing to work.
//
// ==========================================================================
// NO ERROR IS EVER RETURNED EMPTY, AND NOTHING THROWS PAST THE BOUNDARY
// ==========================================================================
// Every action wraps its body. A rejected promise from a server action lands in
// the caller's catch — or, if the caller has none, leaves the UI on its loading
// state forever. An empty error string is the same hazard one level down,
// because `if (res.error)` is false for "". Both are closed here.

import { createClient } from "@/lib/supabase/server";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { isNavRoute } from "@/lib/nav";
import {
  blankToNull, isLanguageValue, validateAvatarFile, validateNewPassword,
  type ProfileFields,
} from "@/lib/profile";

const AVATAR_BUCKET = "profile-images";

/** Signed-URL lifetime. 300s, matching every other private bucket read. */
const SIGNED_URL_TTL = 300;

function msg(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  try {
    const s = JSON.stringify(e);
    if (s && s !== "{}" && s !== "null") return s;
  } catch {
    /* fall through to the fallback */
  }
  return fallback;
}

export type ProfileData = {
  /** The login email, from auth. NOT stored in user_profiles — see below. */
  email: string;
  /** auth user_metadata.display_name. Drives the header. */
  accountDisplayName: string;
  fields: ProfileFields;
  /** Signed URL for the current avatar, or null. Expires; re-fetched on load. */
  avatarUrl: string | null;
  /** True when this user has no user_profiles row yet — the normal empty state. */
  isNewProfile: boolean;
};

const EMPTY_FIELDS: ProfileFields = {
  display_name: null,
  job_title: null,
  contact_number: null,
  personal_email: null,
  emergency_contact_name: null,
  emergency_contact_number: null,
  bio: null,
  preferred_language: null,
  default_route: null,
  avatar_path: null,
};

const SELECT_COLS =
  "display_name, job_title, contact_number, personal_email, emergency_contact_name, emergency_contact_number, bio, preferred_language, default_route, avatar_path";

/**
 * Everything the Profile section needs, in one round trip.
 *
 * "NO ROW" IS A VALID ANSWER, NOT AN ERROR. user_profiles legitimately has zero
 * rows for a user who has never opened this editor, and that state means "all
 * blank". `maybeSingle()` reports it as data null with no error. Treating it as
 * a failure is how a first-time user gets an error screen instead of a form —
 * the same rule notification_prefs already follows.
 *
 * THE LOGIN EMAIL IS READ FROM auth AND NEVER COPIED INTO THE TABLE. Storing it
 * would create a second copy that goes stale the moment the account email
 * changes, and personal_email is a DIFFERENT field the user fills in themselves.
 */
export async function fetchProfile(): Promise<
  { data: ProfileData; error: null } | { data: null; error: string }
> {
  try {
    const supabase = createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) {
      console.error("[profile] getUser failed", authErr);
      return { data: null, error: msg(authErr, "Could not read the session.") };
    }
    const user = auth?.user;
    if (!user) return { data: null, error: "Not signed in." };

    const { data: row, error } = await supabase
      .from("user_profiles")
      .select(SELECT_COLS)
      .maybeSingle();

    if (error) {
      console.error("[profile] user_profiles read failed", error);
      return { data: null, error: `Profile: ${msg(error, "read failed")}` };
    }

    // RLS already scoped the select to auth.uid(), so a null row means "this
    // user has no row", never "somebody else's row".
    const fields: ProfileFields = row
      ? {
          display_name: row.display_name ?? null,
          job_title: row.job_title ?? null,
          contact_number: row.contact_number ?? null,
          personal_email: row.personal_email ?? null,
          emergency_contact_name: row.emergency_contact_name ?? null,
          emergency_contact_number: row.emergency_contact_number ?? null,
          bio: row.bio ?? null,
          preferred_language: row.preferred_language ?? null,
          default_route: row.default_route ?? null,
          avatar_path: row.avatar_path ?? null,
        }
      : EMPTY_FIELDS;

    // A FAILED SIGNED URL IS NOT A FAILED LOAD. If the object was removed from
    // the bucket behind the app's back, the profile must still open — with no
    // photo — rather than showing an error over a form that is otherwise fine.
    let avatarUrl: string | null = null;
    if (fields.avatar_path) {
      const { data: signed, error: signErr } = await supabase.storage
        .from(AVATAR_BUCKET)
        .createSignedUrl(fields.avatar_path, SIGNED_URL_TTL);
      if (signErr) console.error("[profile] avatar signed URL failed", signErr);
      avatarUrl = signed?.signedUrl ?? null;
    }

    const meta = user.user_metadata as { display_name?: unknown } | null;
    const accountDisplayName =
      typeof meta?.display_name === "string" ? meta.display_name : "";

    return {
      data: {
        email: user.email ?? "",
        accountDisplayName,
        fields,
        avatarUrl,
        isNewProfile: row == null,
      },
      error: null,
    };
  } catch (e) {
    console.error("[profile] fetchProfile threw", e);
    return { data: null, error: msg(e, "Could not load your profile.") };
  }
}

/**
 * Save the account display name and the whole user_profiles row, together.
 *
 * ONE SAVE FOR TWO STORES, deliberately. The name lives in auth metadata
 * (because that is what the header reads) and the rest lives in user_profiles,
 * but to the person filling in the form it is one screen of facts about
 * themselves. Two Save buttons for adjacent fields would be an implementation
 * detail leaking into the UI.
 *
 * EVERY FIELD IS WRITTEN EVERY TIME, INCLUDING THE NULLS. A partial upsert would
 * leave a previously-set column untouched, so clearing a field would appear to
 * work and then silently revert on reload — the exact trap the notification
 * thresholds documented.
 *
 * ORDER MATTERS: the profile row is written FIRST, the auth metadata second.
 * If the row write fails the name is not yet changed, so the two cannot end up
 * disagreeing with the header already updated. The reverse order would leave the
 * header showing a name that was never saved.
 */
export async function saveProfile(input: {
  accountDisplayName: string;
  fields: Record<string, string | null>;
}): Promise<{ error: string | null }> {
  try {
    const supabase = createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return { error: msg(authErr, "Could not read the session.") };
    const userId = auth?.user?.id;
    if (!userId) return { error: "Not signed in." };

    // NORMALISE FIRST. blankToNull is the one rule, shared with the editor, and
    // it is what keeps 0159's nonblank CHECKs on avatar_path and default_route
    // from ever seeing "" — those constraints reject it with a 23514.
    const f = input.fields;
    const displayName = blankToNull(input.accountDisplayName);

    const preferredLanguage = blankToNull(f.preferred_language ?? null);
    if (!isLanguageValue(preferredLanguage)) {
      return { error: "Language must be English or Arabic." };
    }

    // VALIDATED AT WRITE TIME, against the same NAV the sidebar renders. The
    // read side falls back independently — see resolveLandingRoute. Both ends
    // are required and neither substitutes for the other.
    const defaultRoute = blankToNull(f.default_route ?? null);
    if (defaultRoute !== null && !isNavRoute(defaultRoute)) {
      return { error: "That landing page is not one of the sidebar pages." };
    }

    // NO FORMAT CHECK ON THE EMAIL OR THE PHONES. The database has none by
    // design (0159 measured zero such constraints across the whole schema), and
    // a regex here would eventually refuse a legitimate address or number with
    // no way for the user to argue. The editor may warn; nothing blocks a save.
    const { error: upsertErr } = await supabase.from("user_profiles").upsert(
      {
        user_id: userId,
        // display_name mirrors the account name so the row is self-contained
        // for a future colleague-facing view. 0159 allows exactly this.
        display_name: displayName,
        job_title: blankToNull(f.job_title ?? null),
        contact_number: blankToNull(f.contact_number ?? null),
        personal_email: blankToNull(f.personal_email ?? null),
        emergency_contact_name: blankToNull(f.emergency_contact_name ?? null),
        emergency_contact_number: blankToNull(f.emergency_contact_number ?? null),
        bio: blankToNull(f.bio ?? null),
        preferred_language: preferredLanguage,
        default_route: defaultRoute,
        // avatar_path is NOT written here. It is owned by uploadAvatar /
        // removeAvatar, which change it in the same operation that moves the
        // bytes. Including it in this payload would let a stale form value
        // detach a freshly uploaded photo.
      },
      { onConflict: "user_id" },
    );

    if (upsertErr) {
      console.error("[profile] upsert failed", upsertErr);
      return { error: msg(upsertErr, "Could not save your profile.") };
    }

    // THE HEADER READS THIS. See lib/actions/identity.ts — the account display
    // name takes precedence over the staff row, so this is what makes the name
    // in the top bar change.
    const { error: metaErr } = await supabase.auth.updateUser({
      data: { display_name: displayName },
    });
    if (metaErr) {
      console.error("[profile] updateUser(display_name) failed", metaErr);
      return { error: msg(metaErr, "Profile saved, but the display name did not update.") };
    }

    return { error: null };
  } catch (e) {
    console.error("[profile] saveProfile threw", e);
    return { error: msg(e, "Could not save your profile.") };
  }
}

/**
 * Change the account password.
 *
 * THE CURRENT PASSWORD IS REQUIRED, AND SUPABASE DOES NOT REQUIRE IT. This is a
 * deliberate addition. `auth.updateUser({ password })` will happily change the
 * password of whoever holds the session, which means an unlocked laptop is
 * enough to lock the real owner out of their own account. Two people share an
 * office here; re-authenticating costs one field and closes that.
 *
 * THE RE-AUTH USES A THROWAWAY CLIENT, and that detail is load-bearing.
 * signInWithPassword on the request-scoped client would issue a NEW session and
 * overwrite the caller's auth cookies mid-request. `persistSession: false` plus
 * `autoRefreshToken: false` means this client verifies the credentials and then
 * discards the tokens, leaving the real session untouched.
 *
 * FAILURES ARE RETURNED, NEVER SWALLOWED. Every branch below either returns a
 * non-empty message or returns success, and success means Supabase itself
 * confirmed the write — there is no path where this reports "saved" without the
 * API having accepted it.
 */
export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<{ error: string | null }> {
  try {
    // Shape-checked before anything is sent anywhere.
    const problem = validateNewPassword(input.newPassword, input.confirmPassword);
    if (problem) return { error: problem };
    if (!input.currentPassword) return { error: "Enter your current password." };
    if (input.currentPassword === input.newPassword) {
      return { error: "The new password is the same as the current one." };
    }

    const supabase = createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return { error: msg(authErr, "Could not read the session.") };
    const email = auth?.user?.email;
    if (!email) return { error: "Not signed in." };

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      console.error("[profile] Supabase env vars missing for re-auth");
      return { error: "Password change is unavailable — server is misconfigured." };
    }

    const probe = createPlainClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { error: reauthErr } = await probe.auth.signInWithPassword({
      email,
      password: input.currentPassword,
    });
    if (reauthErr) {
      // Deliberately not echoing Supabase's wording here. "Invalid login
      // credentials" is confusing when the user did not think they were logging
      // in, and the only credential in play is the one field they typed.
      return { error: "Current password is incorrect." };
    }

    const { error: updErr } = await supabase.auth.updateUser({ password: input.newPassword });
    if (updErr) {
      console.error("[profile] updateUser(password) failed", updErr);
      // Surfaced VERBATIM. If the Supabase project enforces a stronger policy
      // than this app's own minimum, that message is the only thing that tells
      // the user what it wants.
      return { error: msg(updErr, "Could not change the password.") };
    }

    return { error: null };
  } catch (e) {
    console.error("[profile] changePassword threw", e);
    return { error: msg(e, "Could not change the password.") };
  }
}

/**
 * Upload a new avatar, point the row at it, and remove the previous object.
 *
 * A UNIQUE PATH PER UPLOAD, not a stable one that overwrites. 0159 left the
 * choice open and granted both UPDATE and DELETE so either would work; this
 * picks unique because the read path is a SIGNED URL. Overwriting in place keeps
 * the same object key, so a cached signed URL — and the browser's own image
 * cache — keep serving the OLD photo until they expire. Every fix for that is a
 * cache-busting query parameter someone has to remember to add at every call
 * site. A new key each time makes the problem not exist.
 *
 * THE PRICE OF THAT CHOICE IS THE OLD OBJECT, so it is deleted here. Best
 * effort, AFTER the row is repointed: an orphaned file wastes bytes, but a row
 * pointing at a file that was deleted first shows a broken avatar.
 *
 * BYTES GO TO STORAGE FIRST, POINTER SECOND — the same order as every other
 * upload in this app, and if the row write fails the new object is cleaned up
 * rather than left orphaned.
 */
export async function uploadAvatar(
  formData: FormData,
): Promise<{ url: string; error: null } | { url: null; error: string }> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File)) return { url: null, error: "No image was selected." };

    // THE REAL GATE. The editor checks the same thing for immediate feedback,
    // but a client-side check is an affordance, not a control.
    const bad = validateAvatarFile(file);
    if (bad) return { url: null, error: bad };

    const supabase = createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return { url: null, error: msg(authErr, "Could not read the session.") };
    const userId = auth?.user?.id;
    if (!userId) return { url: null, error: "Not signed in." };

    const { data: existing } = await supabase
      .from("user_profiles")
      .select("avatar_path")
      .maybeSingle();
    const previousPath: string | null = existing?.avatar_path ?? null;

    // APP-GENERATED KEY, NEVER THE USER'S FILENAME — the same rule as every
    // other bucket here. A raw filename can collide, can carry path separators,
    // and can leak whatever the person happened to call the file.
    const extMatch = /\.([a-zA-Z0-9]{1,10})$/.exec(file.name);
    const ext = extMatch ? extMatch[1].toLowerCase() : "jpg";
    const path = `${userId}/avatar-${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (upErr) {
      console.error("[profile] avatar upload failed", upErr);
      return { url: null, error: `Upload failed: ${msg(upErr, "storage rejected the file")}` };
    }

    const { error: rowErr } = await supabase
      .from("user_profiles")
      .upsert({ user_id: userId, avatar_path: path }, { onConflict: "user_id" });
    if (rowErr) {
      // Do not leave bytes behind for a pointer that never landed.
      await supabase.storage.from(AVATAR_BUCKET).remove([path]);
      console.error("[profile] avatar row write failed", rowErr);
      return { url: null, error: msg(rowErr, "Could not save the new photo.") };
    }

    // Best effort, and only now that nothing points at it any more.
    if (previousPath && previousPath !== path) {
      const { error: rmErr } = await supabase.storage.from(AVATAR_BUCKET).remove([previousPath]);
      if (rmErr) console.error("[profile] old avatar cleanup failed", rmErr);
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL);
    if (signErr || !signed?.signedUrl) {
      // The upload SUCCEEDED; only the preview link failed. Say so, rather than
      // reporting a failure that would make the user upload it again.
      console.error("[profile] signed URL after upload failed", signErr);
      return { url: null, error: "Photo saved, but the preview could not load. Reopen Settings to see it." };
    }

    return { url: signed.signedUrl, error: null };
  } catch (e) {
    console.error("[profile] uploadAvatar threw", e);
    return { url: null, error: msg(e, "Could not upload the photo.") };
  }
}

/**
 * Remove the avatar: null the column, then delete the object.
 *
 * ROW FIRST, BYTES SECOND — the opposite order from upload, and for the same
 * reason. If the delete fails, the result is an orphaned file nobody can see. If
 * the row write failed after the bytes were gone, the result is a profile
 * pointing at nothing, which renders as a broken image.
 */
export async function removeAvatar(): Promise<{ error: string | null }> {
  try {
    const supabase = createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return { error: msg(authErr, "Could not read the session.") };
    const userId = auth?.user?.id;
    if (!userId) return { error: "Not signed in." };

    const { data: existing } = await supabase
      .from("user_profiles")
      .select("avatar_path")
      .maybeSingle();
    const path: string | null = existing?.avatar_path ?? null;
    if (!path) return { error: null }; // Already gone. Not a failure.

    const { error: rowErr } = await supabase
      .from("user_profiles")
      .upsert({ user_id: userId, avatar_path: null }, { onConflict: "user_id" });
    if (rowErr) {
      console.error("[profile] avatar clear failed", rowErr);
      return { error: msg(rowErr, "Could not remove the photo.") };
    }

    const { error: rmErr } = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    if (rmErr) console.error("[profile] avatar object delete failed", rmErr);

    return { error: null };
  } catch (e) {
    console.error("[profile] removeAvatar threw", e);
    return { error: msg(e, "Could not remove the photo.") };
  }
}

/**
 * The signed avatar URL alone, for the header.
 *
 * SEPARATE FROM fetchProfile ON PURPOSE. The header needs one string and runs on
 * every page; making it pull the whole profile would fetch nine fields it will
 * never render. Returns null for every failure — the header falls back to
 * initials, and a missing photo is not worth an error state in the top bar.
 */
export async function fetchMyAvatarUrl(): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data: row } = await supabase
      .from("user_profiles")
      .select("avatar_path")
      .maybeSingle();
    const path: string | null = row?.avatar_path ?? null;
    if (!path) return null;

    const { data: signed } = await supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL);
    return signed?.signedUrl ?? null;
  } catch (e) {
    console.error("[profile] fetchMyAvatarUrl threw", e);
    return null;
  }
}
