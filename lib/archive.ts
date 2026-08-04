// Archive — derived document status + expiry math (migration 0084).
//
// CORE RULE: a document's status is NEVER stored. It is computed here from
// (expiry_date, the document's own group's warning_days) every time it's
// read. A stored status silently goes stale the moment a date passes with
// no write to the row — same reasoning as lib/driver-state.ts (derived
// driver state) and lib/truck-status.ts (derived truck status), both of
// which are computed per-render and never persisted.
//
// `today` is always passed in as an ISO date string (YYYY-MM-DD) so callers
// control the clock (server "now" via todayKey(), Riyadh-local) and tests
// stay deterministic — identical convention to lib/leave.ts.

import type { ArchiveDocument, ArchiveDocumentGroup } from "./db-types";

// Matches preview/'s own archive vocabulary (archive.js: "expired" /
// "expiring_soon" / "valid"), plus "none" for a document with no expiry
// date at all — a permanent record (a CR extract) is not "valid until
// forever", it simply has no expiry to track.
export type ArchiveDocStatus = "expired" | "expiring_soon" | "valid" | "none";

// Whole days from `today` to `expiryIso`. Negative = already past.
// Date.UTC is used purely for integer day-difference arithmetic on two
// already-fixed calendar dates (never for "what is today") — this sidesteps
// local-timezone DST shifts that could otherwise off-by-one a plain
// `new Date(iso)` subtraction. Same technique/caveat as lib/leave.ts's own
// daysBetweenInclusive.
export function daysUntil(expiryIso: string, today: string): number {
  const [ey, em, ed] = expiryIso.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const expUtc = Date.UTC(ey, em - 1, ed);
  const todayUtc = Date.UTC(ty, tm - 1, td);
  return Math.round((expUtc - todayUtc) / 86400000);
}

/**
 * The one place expiry status is decided. Everything on the page (row tint,
 * pill, the top-of-page summary counts) reads THIS — so a document can never
 * be counted "expiring" in the summary while rendering as "valid" in its row.
 *
 * Boundaries, stated explicitly because they're the easy thing to get wrong:
 *  - days <  0  -> expired      (expiry date is in the past)
 *  - days == 0  -> expiring_soon (expires TODAY — not yet expired)
 *  - days <= warningDays -> expiring_soon
 *  - otherwise  -> valid
 */
export function docStatus(
  expiryIso: string | null,
  warningDays: number,
  today: string,
): ArchiveDocStatus {
  if (!expiryIso) return "none";
  const days = daysUntil(expiryIso, today);
  if (days < 0) return "expired";
  if (days <= warningDays) return "expiring_soon";
  return "valid";
}

// Convenience wrapper for the common "document + its group" pair.
export function documentStatus(
  doc: Pick<ArchiveDocument, "expiry_date">,
  group: Pick<ArchiveDocumentGroup, "warning_days">,
  today: string,
): ArchiveDocStatus {
  return docStatus(doc.expiry_date, group.warning_days, today);
}

/**
 * Expiring-documents summary (top of the Archive page). Counts expired and
 * expiring-soon across whatever documents it's handed.
 *
 * Built to EXTEND (Phase 1 passes Company-only documents; Phases 2-3 will
 * pass every tab's): it takes a flat document list + a group lookup and has
 * no tab awareness of its own, so widening the input is the only change
 * needed later — no signature change, no second counter to keep in sync.
 */
export function expirySummary(
  docs: ArchiveDocument[],
  groupsById: Map<string, Pick<ArchiveDocumentGroup, "warning_days">>,
  today: string,
): { expired: number; expiringSoon: number } {
  let expired = 0;
  let expiringSoon = 0;
  for (const d of docs) {
    const g = groupsById.get(d.group_id);
    if (!g) continue; // orphan guard; FK makes this unreachable in practice
    const s = docStatus(d.expiry_date, g.warning_days, today);
    if (s === "expired") expired++;
    else if (s === "expiring_soon") expiringSoon++;
  }
  return { expired, expiringSoon };
}

// Row/pill styling per status. Turki's spec: expired = RED, inside the
// warning window = YELLOW. Tones mirror preview/'s own .exp-bad / .exp-warn
// / .exp-ok (app.css ~1142-1149) translated to this app's Tailwind
// convention, same approach MtStatusPill already uses on Maintenance.
export const ARCHIVE_STATUS_ROW_TONE: Record<ArchiveDocStatus, string> = {
  expired: "bg-rose-500/10",
  expiring_soon: "bg-yellow-400/15",
  valid: "",
  none: "",
};

// Colors a group can be tagged with (the "coloring option" at group create).
// Free text in the DB (like parts.category) so extending the palette never
// needs a migration — this list is just what the picker offers today.
export const ARCHIVE_GROUP_COLORS = [
  { key: "slate", dot: "bg-slate-400", accent: "border-s-slate-400" },
  { key: "brand", dot: "bg-brand-500", accent: "border-s-brand-500" },
  { key: "emerald", dot: "bg-emerald-500", accent: "border-s-emerald-500" },
  { key: "amber", dot: "bg-amber-500", accent: "border-s-amber-500" },
  { key: "violet", dot: "bg-violet-500", accent: "border-s-violet-500" },
  { key: "rose", dot: "bg-rose-500", accent: "border-s-rose-500" },
] as const;

export function groupAccent(color: string | null): string {
  return ARCHIVE_GROUP_COLORS.find((c) => c.key === color)?.accent ?? "border-s-slate-300";
}
export function groupDot(color: string | null): string {
  return ARCHIVE_GROUP_COLORS.find((c) => c.key === color)?.dot ?? "bg-slate-300";
}
