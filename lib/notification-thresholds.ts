// Threshold bounds and keys. PLAIN MODULE — no "use server", no React.
//
// ==========================================================================
// WHY THIS FILE EXISTS AT ALL
// ==========================================================================
// These constants used to live in lib/actions/notification-settings.ts, which
// carries "use server". A "use server" module may export ONLY async functions:
// every export becomes a callable server reference, so a plain const is not a
// legal thing for it to expose. `next build` did not flag it, but that check
// differs between build and dev, and the rule holds either way — so the
// constants moved here rather than being left as a latent trap.
//
// It also removes a duplication that was already flagged: the bounds were
// written twice, once in the action for validation and once in the component
// for the input min/max. Now both import this, so the DB CHECK, the server
// validation and the input attributes cannot drift apart.
//
// ==========================================================================
// THESE MIRROR THE DATABASE CHECKS. KEEP THEM IN STEP.
// ==========================================================================
// 0154's notification_thresholds_sane and 0158's null-tolerant copy on
// notification_thresholds_user. If either changes, change this in the same
// commit.
//
// The upper bound on low_runway_trips is NOT from a CHECK — it comes from the
// COLUMN TYPE, numeric(6,2), which overflows at 10000 with a 22003 that reads
// worse than a check violation. Bounding it here is the difference between
// "must be between 0 and 9999.99" and "numeric field overflow".

// `label` is ENGLISH ONLY and is read by exactly one caller — describeThresholdProblem
// below, the server's last-resort sentence. The EDITOR does not read it: it
// labels every field from `settings.notifications.f_<key>`, which is the same
// four strings with an Arabic half. Keep the two in step.
export const THRESHOLD_BOUNDS = {
  low_runway_trips:         { min: 0, max: 9999.99, integer: false, label: "Low balance warning" },
  doc_expiry_lead_days:     { min: 0, max: 365,     integer: true,  label: "Document expiry notice" },
  maintenance_stuck_days:   { min: 0, max: 365,     integer: true,  label: "Work order stuck after" },
  invoice_overdue_red_days: { min: 0, max: 365,     integer: true,  label: "Invoice turns red after" },
} as const;

export type ThresholdKey = keyof typeof THRESHOLD_BOUNDS;

export const THRESHOLD_KEYS = Object.keys(THRESHOLD_BOUNDS) as ThresholdKey[];

/** NULL in any field means "inherit the shared default for THAT field". */
export type ThresholdOverrides = Record<ThresholdKey, number | null>;

export type SharedDefaults = Record<ThresholdKey, number>;

// The values the VIEW falls back to when the singleton is missing entirely —
// 0158's th CTE third layer. Duplicated from SQL on purpose: if the singleton is
// ever empty, the editor must display the same number the alerts are actually
// computed with, not a blank.
export const HARDCODED_DEFAULTS: SharedDefaults = {
  low_runway_trips: 10,
  doc_expiry_lead_days: 30,
  maintenance_stuck_days: 7,
  invoice_overdue_red_days: 30,
};

/**
 * WHICH RULE A VALUE BROKE — not a sentence about it.
 *
 * This used to be a `string`, and the string was English. The editor rendered it
 * in both languages, so an Arabic user saw their own field label followed by
 * "must be between 0 and 365." — the field name translated, the rule beside it
 * not. The component even split the sentence on ": " to salvage the half it
 * could replace, which is the shape of a fix working around a payload that
 * should never have carried words.
 *
 * A shared validator has NO language: it is imported by a "use server" action
 * and by a client component at once, and it cannot read useApp(). So it reports
 * the FAULT and each caller says it — the server in English (below), the editor
 * from the dictionary. One rule set still, exactly as before; two renderings.
 *
 * `outOfRange` carries the bounds rather than letting the caller re-read
 * THRESHOLD_BOUNDS, so the numbers in the message are the same two the
 * comparison actually used.
 */
export type ThresholdProblem =
  | { kind: "notANumber" }
  | { kind: "notInteger" }
  | { kind: "outOfRange"; min: number; max: number };

/**
 * Validate one threshold value. NULL is always valid — it is the inherit signal.
 * Returns the broken rule, or null when the value is acceptable.
 *
 * Shared by the server action and the editor so a value can never pass the form
 * and then fail the database.
 */
export function validateThreshold(key: ThresholdKey, value: number | null): ThresholdProblem | null {
  if (value === null) return null;
  const b = THRESHOLD_BOUNDS[key];
  if (!Number.isFinite(value)) return { kind: "notANumber" };
  if (b.integer && !Number.isInteger(value)) return { kind: "notInteger" };
  if (value < b.min || value > b.max) return { kind: "outOfRange", min: b.min, max: b.max };
  return null;
}

/**
 * The SERVER's English rendering of a problem — byte-identical to what
 * validateThreshold used to return, so the action's behaviour is unchanged.
 *
 * English is correct here and is not a leak: the editor validates with the same
 * function BEFORE it calls the action, so these sentences are reachable only
 * when something bypasses the form. That is a developer-facing path, and a
 * server action has no language to render it in anyway.
 */
export function describeThresholdProblem(key: ThresholdKey, problem: ThresholdProblem): string {
  const label = THRESHOLD_BOUNDS[key].label;
  if (problem.kind === "notANumber") return `${label}: not a number.`;
  if (problem.kind === "notInteger") return `${label}: must be a whole number.`;
  return `${label}: must be between ${problem.min} and ${problem.max}.`;
}
