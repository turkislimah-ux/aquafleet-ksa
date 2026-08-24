// Notification PRESENTATION. Pure — no React, no Supabase, no I/O.
//
// Everything here turns one v_my_notifications row into the two strings and one
// tone a bell row needs. It is a separate module so the component stays markup
// and this stays checkable in isolation.
//
// ==========================================================================
// THE VIEW OWNS THE RULES. THIS FILE OWNS THE WORDS.
// ==========================================================================
// v_my_notifications already applied the user's severity preferences AND the
// dismiss-visibility rule (RED hides for the rest of the Riyadh day,
// YELLOW/BLUE for 7 days, then both resurface). Nothing here re-implements any
// of that, and nothing here decides whether a row should be visible — if the
// view returned it, it renders. Re-deriving that timing in the app would give
// the product two definitions of "dismissed" that drift the first time either
// side changes.
//
// ==========================================================================
// KIND COMES FROM THE IDENTITY PREFIX, NOT FROM SNIFFING THE PAYLOAD
// ==========================================================================
// `alert_identity` is '<kind>:<entity>:<id>[:<qualifier>]' and the kind prefix
// is guaranteed stable by the view — it is the same string that a dismissal is
// keyed on, so it cannot drift without breaking dismissals, which makes it the
// one field safe to switch on. Guessing the kind from which payload keys happen
// to be present would silently mislabel a row the day a payload gains a field.

import type { Lang } from "./i18n";
import { formatSar, formatNum, todayKey } from "./utils";
import { isSearchEntity, type SearchEntity } from "./search-routes";
import type { PillTone } from "@/components/ui";

export type Severity = "red" | "yellow" | "blue";

export type NotificationRow = {
  alert_identity: string;
  severity: Severity;
  category: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  value_num: number | string | null;
  value_date: string | null;
  payload: Record<string, unknown> | null;
  source: "state" | "event";
  occurred_at: string | null;
  dismissed_at: string | null;
};

// ==========================================================================
// SEVERITY -> THE APP'S EXISTING COLOUR LANGUAGE
// ==========================================================================
// NOT a new palette. red/yellow/blue map onto the tones components/ui.tsx
// already publishes, and PILL_TONE_CLS is exported precisely so a non-pill
// surface can paint the same colours (its own comment says so). A second
// hand-picked set of notification colours would drift from the pills the moment
// either side is touched.
//
// BLUE MAPS TO `info`, WHICH IS THE BRAND HUE — deliberately not a raw
// blue-500. `info` is the word this app already uses for "FYI, lowest", and
// introducing a literal blue would add a colour the rest of the UI does not
// speak.
export const SEVERITY_TONE: Record<Severity, PillTone> = {
  red: "bad",
  yellow: "warn",
  blue: "info",
};

// Sort order for the panel: act-today first, FYI last. Ties keep the view's
// own order, which is stable per branch.
export const SEVERITY_RANK: Record<Severity, number> = { red: 0, yellow: 1, blue: 2 };

/**
 * THE BADGE COUNTS ACTION, NOT NOISE.
 *
 * red + yellow only. Blue is excluded on purpose: a routine "truck went in for
 * service" must never make the bell look urgent, and a badge that is always lit
 * stops being read at all. This is the same reasoning the previous placeholder
 * used to justify having NO badge while nothing was wired — now that real rows
 * exist the badge is earned, but only for the rows that ask for action.
 */
export function actionableCount(rows: NotificationRow[]): number {
  return rows.filter((r) => r.severity === "red" || r.severity === "yellow").length;
}

/** The badge takes the colour of the MOST severe thing it is counting. */
export function badgeTone(rows: NotificationRow[]): PillTone | null {
  if (rows.some((r) => r.severity === "red")) return "bad";
  if (rows.some((r) => r.severity === "yellow")) return "warn";
  return null;
}

// ==========================================================================
// COPY. Feature-local rather than in lib/i18n.ts, because these strings are
// only meaningful next to the formatters below — splitting the words from the
// logic that chooses them is how a string ends up describing the wrong branch.
// ==========================================================================
const COPY = {
  title:        { en: "Notifications",              ar: "الإشعارات" },
  emptyTitle:   { en: "All clear",                  ar: "لا يوجد جديد" },
  emptyBody:    { en: "Nothing needs you right now.", ar: "لا شيء يتطلب انتباهك الآن." },
  loading:      { en: "Loading…",                   ar: "جارٍ التحميل…" },
  failed:       { en: "Could not load notifications.", ar: "تعذّر تحميل الإشعارات." },
  retry:        { en: "Try again",                  ar: "إعادة المحاولة" },
  dismiss:      { en: "Dismiss",                    ar: "إخفاء" },
  countAria:    { en: "notifications needing action", ar: "إشعارات تحتاج إجراء" },
  today:        { en: "today",                      ar: "اليوم" },
  overdrawn:    { en: "Wallet overdrawn",           ar: "الرصيد بالسالب" },
  runway:       { en: "of runway left",             ar: "متبقٍ من الرصيد" },
  trips:        { en: "trips",                      ar: "رحلة" },
  // "منتهية الصلاحية" ("validity expired") rather than a bare adjective: the
  // subject varies (الرخصة fem / المستند masc / الاستمارة fem), so any adjective
  // agreeing with it would be wrong for some rows. Attaching the agreement to
  // الصلاحية instead makes one string correct for every subject.
  expired:      { en: "expired",                    ar: "منتهية الصلاحية" },
  expiresIn:    { en: "expires in",                 ar: "تنتهي خلال" },
  // Arabic counts days by number: 1 يوم, 2 يومان, 3-10 أيام, 11+ يومًا.
  // English has one plural. See plural().
  days:         { en: "days",                       ar: "أيام" },
  day1:         { en: "day",                        ar: "يوم" },
  day2:         { en: "days",                       ar: "يومان" },
  dayMany:      { en: "days",                       ar: "يومًا" },
  left:         { en: "left",                       ar: "متبقٍ" },
  reorderAt:    { en: "reorder at",                 ar: "إعادة الطلب عند" },
  openDays:     { en: "open",                       ar: "مفتوح منذ" },
  overdue:      { en: "overdue",                    ar: "متأخر" },
  backIn:       { en: "back in",                    ar: "يعود خلال" },
  backToday:    { en: "back today",                 ar: "يعود اليوم" },
  wentIn:       { en: "Entered maintenance",        ar: "دخلت الصيانة" },
  backInService:{ en: "Back in service",            ar: "عادت للخدمة" },
  returned:     { en: "Returned today",             ar: "عاد اليوم" },
  notReturned:  { en: "not fully returned",         ar: "لم تُرجَع بالكامل" },
} as const;

export function nt(key: keyof typeof COPY, lang: Lang): string {
  return COPY[key][lang];
}

/**
 * Count-correct unit word.
 *
 * English pluralises on "not 1". ARABIC DOES NOT: it has four forms by count —
 * 1 يوم, 2 يومان, 3-10 أيام, 11+ يومًا — and picking one and using it everywhere
 * is the kind of error a native reader notices immediately. Only `days` is
 * declined today because it is the only counted noun in this file; a second
 * one gets its own function rather than a `key` parameter this had before and
 * never read.
 */
export function pluralDays(n: number, lang: Lang): string {
  const c = Math.abs(Math.round(n));
  if (lang === "en") return c === 1 ? COPY.day1.en : COPY.days.en;
  if (c === 1) return COPY.day1.ar;
  if (c === 2) return COPY.day2.ar;
  if (c >= 3 && c <= 10) return COPY.days.ar;
  return COPY.dayMany.ar;
}

// Field labels for the document alerts, which are the only ones whose subject
// varies by column rather than by kind.
const FIELD_LABEL: Record<string, { en: string; ar: string }> = {
  license_expiry:      { en: "Licence",       ar: "الرخصة" },
  iqama_expiry:        { en: "Iqama",         ar: "الإقامة" },
  registration_expiry: { en: "Registration",  ar: "الاستمارة" },
  archive_document:    { en: "Document",      ar: "المستند" },
};

/** Whole days from today (Riyadh-local, same clock as todayKey) to an ISO date. */
export function daysFromToday(iso: string | null): number | null {
  if (!iso) return null;
  const a = Date.parse(todayKey() + "T00:00:00Z");
  const b = Date.parse(iso.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The kind prefix — see the header note on why this is the safe discriminator. */
export function alertKind(identity: string): string {
  return identity.split(":")[0] ?? "";
}

/**
 * The secondary line: the ONE fact that tells you how bad this is.
 *
 * Deliberately not a sentence and deliberately not the whole payload. Each
 * branch surfaces the single number a person would ask for next — how far
 * overdrawn, how many days left, how many in stock — because a row that
 * restates its own title teaches nothing and a row that dumps five fields is
 * read as none.
 *
 * Returns null when there is nothing useful to add, and the row then shows the
 * label alone rather than an empty second line.
 */
export function detailLine(r: NotificationRow, lang: Lang): string | null {
  const p = r.payload ?? {};
  const kind = alertKind(r.alert_identity);
  // No `ar` flag here: every branch below passes `lang` straight to nt(), and
  // the one place that read a flag was `return ar ? null : null` — both arms
  // identical, so it selected nothing. Removed with that expression.

  switch (kind) {
    case "prepaid_overdrawn": {
      const bal = num(p.balance_sar) ?? num(r.value_num);
      return bal == null ? nt("overdrawn", lang) : `${nt("overdrawn", lang)} · ${formatSar(bal)}`;
    }
    case "prepaid_low_runway": {
      const t = num(p.trips_of_runway);
      const bal = num(p.balance_sar) ?? num(r.value_num);
      const runway = t == null ? null : `${formatNum(t, 1)} ${nt("trips", lang)} ${nt("runway", lang)}`;
      const money = bal == null ? null : formatSar(bal);
      return [runway, money].filter(Boolean).join(" · ") || null;
    }
    case "doc_expiry": {
      const field = String(p.field ?? "");
      const label = FIELD_LABEL[field]?.[lang] ?? FIELD_LABEL.archive_document[lang];
      const d = daysFromToday((p.expiry_date as string) ?? r.value_date);
      if (d == null) return label;
      if (d < 0) return `${label} · ${nt("expired", lang)} · ${Math.abs(d)} ${pluralDays(d, lang)}`;
      if (d === 0) return `${label} · ${nt("expired", lang)} ${nt("today", lang)}`;
      return `${label} · ${nt("expiresIn", lang)} ${d} ${pluralDays(d, lang)}`;
    }
    case "part_reorder": {
      const on = num(p.qty_on_hand);
      const at = num(p.reorder_level);
      const unit = typeof p.unit === "string" && p.unit ? ` ${p.unit}` : "";
      if (on == null) return null;
      const head = `${formatNum(on, 2)}${unit} ${nt("left", lang)}`;
      return at == null ? head : `${head} · ${nt("reorderAt", lang)} ${formatNum(at, 2)}`;
    }
    case "wo_stuck": {
      // wo_number is deliberately NOT repeated here — it is already the row's
      // entity_label, and "WO-26-0014 / open 22 days · WO-26-0014" reads as a
      // bug. The detail line adds the number the label does not have.
      const d = num(p.days_open);
      return d == null ? null : `${nt("openDays", lang)} ${d} ${pluralDays(d, lang)}`;
    }
    case "invoice_overdue": {
      const amt = num(p.outstanding_sar) ?? num(r.value_num);
      const d = num(p.days_outstanding);
      const money = amt == null ? null : formatSar(amt);
      const late = d == null ? null : `${d} ${pluralDays(d, lang)} ${nt("overdue", lang)}`;
      return [money, late].filter(Boolean).join(" · ") || null;
    }
    case "leave_return": {
      const d = num(p.days_until_return) ?? daysFromToday(r.value_date);
      if (d == null) return null;
      return d <= 0 ? nt("backToday", lang) : `${nt("backIn", lang)} ${d} ${pluralDays(d, lang)}`;
    }
    case "permit_overdue": {
      const d = num(p.days_overdue);
      const head = d == null ? null : `${d} ${pluralDays(d, lang)} ${nt("overdue", lang)}`;
      return [head, nt("notReturned", lang)].filter(Boolean).join(" · ");
    }
    // --- the three derived BLUE branches ---
    case "truck_in":
      return nt("wentIn", lang);
    case "truck_out":
      return nt("backInService", lang);
    case "employee_returned":
      return nt("returned", lang);
    default:
      // Any branch added later renders its label alone rather than a wrong
      // guess. This used to also cover stored events from notification_events —
      // that table and the view branch reading it were dropped in 0160, so the
      // only rows reaching here now are kinds this formatter has not learned.
      return null;
  }
}

/**
 * entity_type -> the route resolver's vocabulary.
 *
 * ONE rename: v_active_alerts emits 'document' for an archive document, while
 * lib/search-routes calls it 'archive_document'. Mapping here rather than
 * changing either side — the view's value is baked into live alert_identity
 * strings that dismissals are keyed on, and renaming it would orphan every
 * existing dismissal.
 *
 * Returns null for anything the router does not know, and the row then renders
 * as plain text instead of a link that goes nowhere.
 */
export function routeEntity(entityType: string): SearchEntity | null {
  const map: Record<string, SearchEntity> = {
    truck: "truck", driver: "driver", staff: "staff", customer: "customer",
    project: "project", invoice: "invoice", part: "part",
    work_order: "work_order", exit_permit: "exit_permit",
    document: "archive_document",
  };
  const mapped = map[entityType];
  // isSearchEntity is the router's OWN guard. Going through it means a typo in
  // the map above is a type error here rather than a dead link discovered in
  // production, and it stays correct if the router's vocabulary ever narrows.
  return mapped && isSearchEntity(mapped) ? mapped : null;
}
