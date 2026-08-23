// Profile shapes, bounds and normalisation. PLAIN MODULE — no "use server",
// no React. Imported by both the server action and the editor.
//
// ==========================================================================
// WHY THIS FILE EXISTS AT ALL
// ==========================================================================
// The same reason lib/notification-thresholds.ts does. A "use server" module
// turns every export into a callable server reference, so a plain const or type
// cannot live there. Exporting one from lib/actions/notification-settings.ts is
// what stuck the Notifications section on a permanent "Loading…" in 2.2b, and
// `next build` did not flag it.
//
// It is also the one place the normalisation rule lives, so the editor and the
// action cannot disagree about what an empty field means.

import { IMAGE_ACCEPT, validateImageFile } from "@/lib/utils";

/** The user_profiles columns this editor owns. Account email is NOT here. */
export type ProfileFields = {
  display_name: string | null;
  job_title: string | null;
  contact_number: string | null;
  personal_email: string | null;
  emergency_contact_name: string | null;
  emergency_contact_number: string | null;
  bio: string | null;
  preferred_language: string | null;
  default_route: string | null;
  avatar_path: string | null;
};

/**
 * The keys the form edits as strings, where "" is the blank state.
 *
 * avatar_path is absent on purpose: it is not typed into a box, it is set by
 * uploadAvatar in the same operation that moves the bytes. Letting the form hold
 * a copy would let a stale value detach a photo that was just uploaded.
 */
export const PROFILE_TEXT_KEYS = [
  "display_name",
  "job_title",
  "contact_number",
  "personal_email",
  "emergency_contact_name",
  "emergency_contact_number",
  "bio",
  "preferred_language",
  "default_route",
] as const;

export type ProfileTextKey = (typeof PROFILE_TEXT_KEYS)[number];

export const EMPTY_DRAFT: Record<ProfileTextKey, string> = {
  display_name: "",
  job_title: "",
  contact_number: "",
  personal_email: "",
  emergency_contact_name: "",
  emergency_contact_number: "",
  bio: "",
  preferred_language: "",
  default_route: "",
};

// blankToNull lived here until the issue reporter (2.2d) became its second
// consumer. It is now in lib/utils.ts, on the same promote-on-second-consumer
// precedent that file already documents for daysAgoKey and currentMonthKey —
// it was never profile logic, it is what every optional text field does on the
// way to the database. Import it from there.

/** The two languages lib/i18n.ts can actually render. Matches 0159's CHECK. */
export const LANGUAGE_VALUES = ["en", "ar"] as const;

export function isLanguageValue(v: string | null): boolean {
  return v === null || (LANGUAGE_VALUES as readonly string[]).includes(v);
}

// --------------------------------------------------------------------------
// AVATAR
// --------------------------------------------------------------------------
// 2 MB matches the maintenance-photos cap (app/maintenance/actions.ts), which
// is the app's existing image budget — a second, different number would be a
// second rule nobody could explain.
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

// The accepted image types are ALLOWED_IMAGE_MIME in lib/utils.ts — one list,
// shared with the issue-report attachment, because excluding image/svg+xml is a
// security decision and two copies of it is how SVG comes back.
export const AVATAR_ACCEPT = IMAGE_ACCEPT;

/**
 * Null when the file is acceptable, else the reason. Shared client + server.
 *
 * Same list and same 2 MB cap as before it was promoted; only the location of
 * the rule changed. Avatars keep their own, tighter budget — a head-and-
 * shoulders photo has no business being screenshot-sized.
 */
export function validateAvatarFile(file: { size: number; type: string }): string | null {
  return validateImageFile(file, MAX_AVATAR_BYTES);
}

// --------------------------------------------------------------------------
// PASSWORD
// --------------------------------------------------------------------------
// STRICTER THAN THE SERVER, ON PURPOSE, AND THAT DIRECTION MATTERS. Supabase's
// default minimum is 6. Requiring 8 here means anything the form accepts is
// already acceptable to Supabase, so the form cannot promise something the API
// then refuses. The reverse — a looser client than server — is the arrangement
// that produces "it said it saved" bugs.
//
// If the Supabase project is ever configured with a HIGHER minimum than this,
// the API rejects it and that error is surfaced verbatim rather than swallowed;
// see changePassword.
export const MIN_PASSWORD_LENGTH = 8;

export function validateNewPassword(next: string, confirm: string): string | null {
  if (!next) return "Enter a new password.";
  if (next.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  // Compared BEFORE any trimming, and never trimmed anywhere: a leading or
  // trailing space is a legitimate password character, and silently stripping it
  // would set a password the user could not then type.
  if (next !== confirm) return "The two passwords do not match.";
  return null;
}
