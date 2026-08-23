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
 * Validate one threshold value. NULL is always valid — it is the inherit signal.
 * Returns an error string, or null when the value is acceptable.
 *
 * Shared by the server action and the editor so a value can never pass the form
 * and then fail the database.
 */
export function validateThreshold(key: ThresholdKey, value: number | null): string | null {
  if (value === null) return null;
  const b = THRESHOLD_BOUNDS[key];
  if (!Number.isFinite(value)) return `${b.label}: not a number.`;
  if (b.integer && !Number.isInteger(value)) return `${b.label}: must be a whole number.`;
  if (value < b.min || value > b.max) return `${b.label}: must be between ${b.min} and ${b.max}.`;
  return null;
}
