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

import type { ArchiveDocument, ArchiveDocumentGroup, ArchiveDocumentType } from "./db-types";
import { t, fill, plural, type Lang } from "./i18n";

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


/**
 * Expiring-documents summary (top of the Archive page). Counts expired and
 * expiring-soon across whatever documents it's handed.
 *
 * Built to EXTEND (Phase 1 passes Company-only documents; Phases 2-3 will
 * pass every tab's): it takes a flat document list + a group lookup and has
 * no tab awareness of its own, so widening the input is the only change
 * needed later — no signature change, no second counter to keep in sync.
 *
 * `expiryOf` exists for LINKED documents (0089), which store no expiry of
 * their own — theirs lives on the person. Without it a linked document would
 * read as "no expiry" and silently vanish from these counts, which is the
 * worst possible failure for a COMPLIANCE summary: the expired licence you
 * most need to see would be the one missing from it. Optional so the Company
 * tab's own call is unchanged.
 */
export function expirySummary(
  docs: ArchiveDocument[],
  groupsById: Map<string, Pick<ArchiveDocumentGroup, "warning_days">>,
  today: string,
  expiryOf?: (doc: ArchiveDocument) => string | null,
): { expired: number; expiringSoon: number } {
  let expired = 0;
  let expiringSoon = 0;
  for (const d of docs) {
    const g = groupsById.get(d.group_id);
    if (!g) continue; // orphan guard; FK makes this unreachable in practice
    const s = docStatus(expiryOf ? expiryOf(d) : d.expiry_date, g.warning_days, today);
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

// Pill tone + pill TEXT per status. These live here, next to docStatus, for
// the same reason the status itself does: the table row and the document
// details popup both render this pill, and a second copy of the label logic
// is exactly how one of them ends up still saying "Valid" after the other
// starts saying "12d left".
export const ARCHIVE_STATUS_PILL: Record<ArchiveDocStatus, string> = {
  expired: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20",
  expiring_soon: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/25",
  valid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20",
  none: "bg-slate-500/10 text-slate-600 dark:text-slate-400 ring-slate-500/20",
};

// Turki's ask: a valid document shows the STATE AND the runway — "Valid ·
// 47d left". The word carries the verdict, the number carries the urgency;
// dropping either one makes the pill answer only half the question.
// Expiring-soon stays bare ("12d left") because its amber tone is already
// saying "not simply valid" and a second word would just crowd the pill.
//
// BILINGUAL (Phase 3). `lang` is a required parameter rather than a hook read,
// for the same reason `today` is: this is a pure function every caller reaches
// from a different render context, and a module that reached for the language
// itself would be a second source of truth for it. Every caller already has
// `lang` in hand from useApp(); a caller that memoises this output must carry
// `lang` in its dependency list, or the pill keeps the previous language's
// words after a switch.
//
// The day COUNTS stay Latin digits in both languages — app-formatted numbers
// are Latin throughout this app, so `12d left` and `متبقٍ 12 يومًا` quote the
// same glyphs.
export function archiveStatusLabel(
  s: ArchiveDocStatus,
  expiryIso: string | null,
  today: string,
  lang: Lang,
): string {
  if (s === "none") return t("archive.status.noExpiry", lang);
  const days = expiryIso ? daysUntil(expiryIso, today) : 0;
  if (s === "expired") {
    const ago = Math.abs(days);
    return fill(t(`archive.status.expiredAgo.${plural(ago)}`, lang), { n: ago });
  }
  if (days === 0) return t("archive.status.expiresToday", lang);
  if (s === "valid") {
    return fill(t(`archive.status.validLeft.${plural(days)}`, lang), { n: days });
  }
  return fill(t(`archive.status.daysLeft.${plural(days)}`, lang), { n: days });
}

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

// ---------------------------------------------------------------------------
// THE LINK — "store each fact once" (0088 + 0089).
//
// An Iqama number or a driving-licence number belongs to the PERSON, not to a
// piece of paper: renewing an Iqama extends the same number rather than
// issuing a new one, and the expiry that matters is the one on their record.
// So for a LINKED (type + subject) combination the number AND its expiry live
// only on the person's row. The archive document stores NEITHER — it reads
// them. One copy, nothing to sync, nothing to drift.
//
// WHAT MAKES A COMBINATION LINKED: archive_document_types carries
// linked_driver_field / linked_staff_field (0089). Non-null = linked, and
// that same test drives the purple "Link" pill. The value names the NUMBER
// column only; the matching EXPIRY column is resolved here, in code, from a
// closed union — never derived by string-munging the stored value. That is
// what keeps the write surface narrow: a row in that table can rename which
// of three known fields is used, but can never point a write at a column
// nobody wrote code for.
// ---------------------------------------------------------------------------

// The three real link targets. Each names both halves of the pair, because
// the number and the expiry always move together.
// Named PersonIdField for historical reasons — trucks joined in 0091 and a
// truck is not a person. Renaming would touch every call site for a wart; the
// labels and messages users actually read all say the right thing.
export type PersonIdField =
  | "driver_iqama"
  | "driver_license"
  | "staff_iqama"
  | "truck_registration";

// The three subject kinds that can carry a link. Trucks joined in 0091.
export type LinkSubjectKind = "driver" | "staff" | "truck";

// Just the linked_* columns — so a caller can pass a whole ArchiveDocumentType
// or any narrower object carrying them.
export type LinkedFieldSource = Pick<
  ArchiveDocumentType,
  "linked_driver_field" | "linked_staff_field" | "linked_truck_field"
>;

export type LinkTarget = {
  field: PersonIdField;
  table: "drivers" | "staff" | "trucks";
  numberColumn: "iqama_number" | "license_number" | "vehicle_registration";
  expiryColumn: "iqama_expiry" | "license_expiry" | "registration_expiry";
  label: string;
};

const LINK_TARGETS: Record<PersonIdField, LinkTarget> = {
  driver_iqama: {
    field: "driver_iqama", table: "drivers",
    numberColumn: "iqama_number", expiryColumn: "iqama_expiry", label: "Iqama ID",
  },
  driver_license: {
    field: "driver_license", table: "drivers",
    numberColumn: "license_number", expiryColumn: "license_expiry", label: "License ID",
  },
  staff_iqama: {
    field: "staff_iqama", table: "staff",
    numberColumn: "iqama_number", expiryColumn: "iqama_expiry", label: "Iqama ID",
  },
  truck_registration: {
    field: "truck_registration", table: "trucks",
    numberColumn: "vehicle_registration", expiryColumn: "registration_expiry",
    label: "Vehicle Registration",
  },
};

export function linkTarget(field: PersonIdField): LinkTarget {
  return LINK_TARGETS[field];
}

/**
 * Is this (type, subject) combination linked, and to which person field?
 *
 * Reads the TYPE's own linked_*_field, so the answer comes from the database
 * rather than from a hardcoded list of type keys — adding a link is a data
 * change plus (deliberately) a case below, because a new link also needs real
 * read/write code either way.
 *
 * Returns null for: no type, a subject kind with no link (trucks today), or a
 * type whose column for this subject is null (e.g. license on staff).
 */
export function linkedFieldFor(
  type: LinkedFieldSource | null | undefined,
  subjectKind: LinkSubjectKind | null | undefined,
): PersonIdField | null {
  if (!type || !subjectKind) return null;
  const column =
    subjectKind === "driver" ? type.linked_driver_field
    : subjectKind === "staff" ? type.linked_staff_field
    : type.linked_truck_field;
  if (!column) return null;
  if (subjectKind === "driver") {
    if (column === "iqama_number") return "driver_iqama";
    if (column === "license_number") return "driver_license";
    return null;
  }
  if (subjectKind === "staff") {
    if (column === "iqama_number") return "staff_iqama";
    return null;
  }
  if (column === "vehicle_registration") return "truck_registration";
  return null;
}

/**
 * Same question, resolved from the DOCUMENT'S OWN SUBJECT columns.
 *
 * Prefer this wherever a document row is in hand. `linkedFieldFor` above
 * depends on a `subjectKind` string passed down through props, and a string
 * that arrives wrong or missing silently degrades to "not linked" — which is
 * how an Iqama number ended up on a document's reference_no instead of on the
 * driver. Reading driver_id / staff_id off the row itself removes that whole
 * class of failure: the subject cannot disagree with itself.
 *
 * The both-set case is the one that actually bit: `iqama` is linked for
 * drivers AND staff (linked_driver_field and linked_staff_field are both
 * 'iqama_number'), while `license` is driver-only. Choosing by which columns
 * happen to be non-null is therefore ambiguous for iqama and unambiguous for
 * license — exactly matching the observed symptom. The SUBJECT decides, always.
 */
export function linkedFieldForDoc(
  type: LinkedFieldSource | null | undefined,
  doc: { driver_id?: string | null; staff_id?: string | null; truck_id?: string | null },
): PersonIdField | null {
  if (doc.driver_id) return linkedFieldFor(type, "driver");
  if (doc.staff_id) return linkedFieldFor(type, "staff");
  if (doc.truck_id) return linkedFieldFor(type, "truck");
  return null;
}

/**
 * Does this group's type link for this subject kind AT ALL?
 *
 * Used as a guard, not for display: if this says yes, the document MUST write
 * its number to the person. Anything that fails to resolve a concrete field
 * after this returns true is a bug, and must fail loudly rather than fall
 * back to storing the number on the document.
 */
export function groupExpectsLink(
  type: LinkedFieldSource | null | undefined,
  subjectKind: LinkSubjectKind | null | undefined,
): boolean {
  if (!type || !subjectKind) return false;
  return !!(
    subjectKind === "driver" ? type.linked_driver_field
    : subjectKind === "staff" ? type.linked_staff_field
    : type.linked_truck_field
  );
}

// THE label a user reads for a linked field. Keyed off PersonIdField, the
// closed union resolved by linkedFieldFor() — never off the linked_*_field
// COLUMN VALUES that union is resolved from ('iqama_number' and friends). Those
// are internal mapping keys; they name a database column and never reach a
// screen, so they are not translated and must not become a display source.
//
// Was a plain Record<PersonIdField, string> before Phase 3. It is a function
// now because the answer depends on `lang`, and a frozen object could only have
// held one language's copy.
export function personIdLabel(field: PersonIdField, lang: Lang): string {
  return t(`archive.personId.${field}`, lang);
}

// Same four labels, mid-sentence. A SEPARATE lookup rather than
// personIdLabel(...).toLowerCase(): Arabic has no letter case, so lowercasing
// the Arabic is a silent no-op, and case-folding a localized string is the
// "operate on the label instead of the value" mistake wearing a different hat.
// The English entries are pre-lowercased, so the rendered English is unchanged.
export function personIdLabelLower(field: PersonIdField, lang: Lang): string {
  return t(`archive.personIdLower.${field}`, lang);
}

// The person's own number + expiry for a linked field. ONE reader, so the
// matrix cell, the document popup and the status pill can never disagree
// about which of the person's columns this document is showing.
export function readPersonLink(
  field: PersonIdField,
  subject: {
    iqama_number?: string | null; iqama_expiry?: string | null;
    license_number?: string | null; license_expiry?: string | null;
    vehicle_registration?: string | null; registration_expiry?: string | null;
  } | null | undefined,
): { number: string | null; expiry: string | null } {
  if (!subject) return { number: null, expiry: null };
  if (field === "driver_license") {
    return { number: subject.license_number ?? null, expiry: subject.license_expiry ?? null };
  }
  if (field === "truck_registration") {
    return {
      number: subject.vehicle_registration ?? null,
      expiry: subject.registration_expiry ?? null,
    };
  }
  return { number: subject.iqama_number ?? null, expiry: subject.iqama_expiry ?? null };
}

// ---------------------------------------------------------------------------
// The STANDING SET of document types — seeded by 0085 (7) and 0088 ('iqama').
//
// These live HERE, not in app/archive/actions.ts, for a structural reason: a
// "use server" module may only export async functions, so a plain constant
// and a sync predicate cannot live there. (next build catches this; tsc does
// not — the error is "Only async functions are allowed to be exported in a
// 'use server' file".)
//
// Why they are protected from deletion: 'iqama', 'license' and 'registration'
// are the three keys the linked mapping is defined against, so deleting any
// of them would break linking outright. The remaining five are the base
// vocabulary every install starts with. Delete is therefore offered for
// USER-ADDED types only — and only when nothing references them. The FK is
// the real guarantee: archive_document_groups.type_key and
// archive_documents.type_key are both ON DELETE RESTRICT, so a type in use is
// refused by the database no matter what any screen offers.
export const STANDING_TYPE_KEYS = [
  "license", "permit", "insurance", "registration",
  "certificate", "contract", "other", "iqama",
] as const;

export function isStandingType(key: string): boolean {
  return (STANDING_TYPE_KEYS as readonly string[]).includes(key);
}
