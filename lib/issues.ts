// Issue-report shapes, vocabularies and bounds. PLAIN MODULE — no "use server",
// no React. Imported by both the server action and the section.
//
// Same reason lib/profile.ts and lib/notification-thresholds.ts exist: a
// "use server" module turns every export into a callable server reference, so a
// plain const or type cannot live there. That mistake stuck the Notifications
// section on a permanent "Loading…" in 2.2b and `next build` did not flag it.
//
// ==========================================================================
// THE VOCABULARIES MIRROR 0157's CHECK CONSTRAINTS EXACTLY
// ==========================================================================
// Both arrays below are the database's own allowed values. They are not a
// superset "for flexibility" and not a subset "for now": a value the form can
// produce but the CHECK rejects is a 23514 the user cannot act on, and a value
// the CHECK allows but the form never offers is a status a ticket can get stuck
// in with no way out of it through the UI.

import { IMAGE_ACCEPT, validateImageFile } from "@/lib/utils";
import type { PillTone } from "@/components/ui";

export const ISSUE_CATEGORIES = [
  { key: "bug",      en: "Something is broken", ar: "شيء لا يعمل" },
  { key: "data",     en: "Wrong data",          ar: "بيانات خاطئة" },
  { key: "feature",  en: "Request",             ar: "طلب إضافة" },
  { key: "question", en: "Question",            ar: "سؤال" },
  { key: "other",    en: "Other",               ar: "أخرى" },
] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number]["key"];

/**
 * The four statuses, in the order a ticket normally travels.
 *
 * NO TRANSITION RULES, MATCHING THE DATABASE. 0157 deliberately declined to
 * constrain the moves: tickets reopen, and resolved -> open is a legitimate
 * edit, not a mistake to be blocked. Two people share this queue and the cost of
 * refusing a legitimate move is higher than the cost of a wrong status somebody
 * corrects in five seconds. The UI therefore offers all four at all times.
 */
export const ISSUE_STATUSES = [
  { key: "open",        en: "Open",        ar: "مفتوحة",       tone: "info"    as PillTone },
  { key: "in_progress", en: "In progress", ar: "قيد العمل",     tone: "warn"    as PillTone },
  { key: "needs_info",  en: "Needs info",  ar: "بحاجة لتوضيح",  tone: "yellow"  as PillTone },
  { key: "resolved",    en: "Resolved",    ar: "تم الحل",       tone: "ok"      as PillTone },
] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number]["key"];

export const RESOLVED: IssueStatus = "resolved";

export function isIssueCategory(v: string): v is IssueCategory {
  return ISSUE_CATEGORIES.some((c) => c.key === v);
}

export function isIssueStatus(v: string): v is IssueStatus {
  return ISSUE_STATUSES.some((s) => s.key === v);
}

export function categoryLabel(key: string, ar: boolean): string {
  const c = ISSUE_CATEGORIES.find((x) => x.key === key);
  // Falls back to the raw key rather than blank: an unknown value should read
  // as "other_thing", not vanish. Same rule the notification formatter follows.
  return c ? (ar ? c.ar : c.en) : key;
}

export function statusMeta(key: string): { en: string; ar: string; tone: PillTone } {
  const s = ISSUE_STATUSES.find((x) => x.key === key);
  return s ? { en: s.en, ar: s.ar, tone: s.tone } : { en: key, ar: key, tone: "neutral" };
}

/**
 * Sort rank. Resolved sinks; everything else stays in newest-first order.
 *
 * A FLAT SPLIT, NOT A FOUR-WAY RANKING. Ordering open above in_progress above
 * needs_info would imply a priority the team has not expressed, and it would
 * move a ticket up and down the list every time someone touched its status —
 * which is exactly when you want it to stay where you were looking. The only
 * distinction that matters is "still needs someone" versus "done".
 */
export function statusRank(status: string): number {
  return status === RESOLVED ? 1 : 0;
}

// --------------------------------------------------------------------------
// ATTACHMENT
// --------------------------------------------------------------------------
/**
 * 5 MB, against the avatar's 2 MB, and the difference is deliberate.
 *
 * The point of this attachment is a SCREENSHOT. A full-screen PNG from a modern
 * display routinely runs past 2 MB before anyone has done anything unusual, and
 * a reporter whose screenshot is refused will file the ticket without it — which
 * loses exactly the evidence the field exists to capture. An avatar has no such
 * excuse, so it keeps the tighter cap.
 *
 * The accepted TYPES are the shared allow-list in lib/utils.ts, not a second
 * copy — excluding image/svg+xml is a security decision.
 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export const ATTACHMENT_ACCEPT = IMAGE_ACCEPT;

export function validateAttachmentFile(file: { size: number; type: string }): string | null {
  return validateImageFile(file, MAX_ATTACHMENT_BYTES);
}

// --------------------------------------------------------------------------
// THE ROW
// --------------------------------------------------------------------------
/** Exactly the columns 0157 defines, as the app reads them. */
export type IssueRow = {
  id: string;
  reporter_id: string | null;
  category: string;
  title: string;
  description: string | null;
  page_route: string | null;
  attachment_path: string | null;
  status: string;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Title is the one required field. Everything else is optional by design.
 *
 * Mirrors 0157's issue_reports_title_nonblank, which rejects a title of pure
 * whitespace — so trimming here is not cosmetic, it is the same rule stated on
 * the near side of the round trip where the user can still fix it.
 */
export function validateIssueDraft(input: { category: string; title: string }): string | null {
  if (!isIssueCategory(input.category)) return "Choose what kind of problem this is.";
  if (!input.title.trim()) return "Give it a short title.";
  if (input.title.trim().length > 200) return "Title is too long — keep it under 200 characters.";
  return null;
}
