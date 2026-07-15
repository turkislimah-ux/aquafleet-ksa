// PRESENTATION-ONLY grouping for the invoice line tables (Finance polish
// batch A). Takes the already-computed InvoiceLine[]/InvoiceLineSnapshot[]
// (money math already final — lib/invoice.ts) and groups trip lines into as
// few summary rows as correctness allows, for display. Never recomputes any
// amount/VAT/total — Amount here is always exactly Price * Quantity where
// Price is one real line's amount_sar (all trip lines in a table currently
// share the same resolved project rate — see lib/prepaid.ts header).
//
// Grouping key: water type is fixed per project (Finance polish batch B) —
// every trip line in a group shares one water_type, so no "Mixed" case can
// occur; typeLabel falls back to "—" only for pre-water_type-field invoice
// snapshots (frozen before the field existed, never retro-filled). Multiple
// DISTINCT rates would need separate rows (not built yet — deferred to a
// later batch since today every trip line in a table shares one rate; see
// finance-invoice-spec.md-referenced note in ProjectsBoard/invoiceActions).
// Charge lines are never grouped — one row each, unchanged.

import { WATER_TYPE_LABELS, type WaterType } from "./db-types";
import { tripRefRangeLabel } from "./trip-ref";

export type DisplayLine = {
  id: string;
  kind: "trip" | "charge";
  trip_date: string | null;
  description: string;
  amount_sar: number;
  ref?: string | null;
  water_type?: WaterType | null;
};

export type GroupedRow =
  | {
      type: "trip-group";
      key: string;
      periodLabel: string; // e.g. "12 Jun – 30 Jun 2026" or a single date
      refRangeLabel: string;
      firstTripId: string; // for the clickable range -> jumps to the first trip
      typeLabel: string; // water type label, or "—" for a pre-water_type frozen snapshot
      quantity: number;
      price: number; // per-trip rate
      amount: number; // price * quantity (== sum of the group's amount_sar, exact)
    }
  | {
      type: "charge";
      key: string;
      id: string;
      dateLabel: string;
      description: string;
      amount: number;
    };

function formatDateLabel(d: string | null): string {
  if (!d) return "—";
  return d; // ISO trip_date (YYYY-MM-DD) — kept as-is, no timezone conversion needed for a plain date key.
}

/**
 * Groups a table's lines into display rows. Trip lines with the SAME
 * per-trip rate (amount_sar) collapse into one row (one rate per project is
 * today's reality — see header). If a table somehow contains more than one
 * distinct trip rate, each distinct rate gets its own group (still correct,
 * just not the single-row common case) rather than silently averaging.
 */
export function groupInvoiceLines(lines: DisplayLine[], fallbackWaterType?: WaterType | null): GroupedRow[] {
  const tripLines = lines.filter((l) => l.kind === "trip");
  const chargeLines = lines.filter((l) => l.kind === "charge");

  // Group trip lines by their per-trip rate (amount_sar) — see header.
  const byRate = new Map<number, DisplayLine[]>();
  for (const l of tripLines) {
    const arr = byRate.get(l.amount_sar) ?? [];
    arr.push(l);
    byRate.set(l.amount_sar, arr);
  }

  const groups: GroupedRow[] = [];
  for (const [rate, groupLines] of byRate) {
    // Order by trip_date asc (falls back to input order for equal dates) so
    // the ref range and period label read first -> last chronologically.
    const ordered = [...groupLines].sort((a, b) => (a.trip_date ?? "").localeCompare(b.trip_date ?? ""));
    const dates = ordered.map((l) => l.trip_date).filter((d): d is string => !!d);
    const periodLabel =
      dates.length === 0
        ? "—"
        : dates[0] === dates[dates.length - 1]
        ? formatDateLabel(dates[0])
        : `${formatDateLabel(dates[0])} – ${formatDateLabel(dates[dates.length - 1])}`;

    // One water_type per project (never mixed) — undefined/null only for a
    // frozen invoice snapshot from before the water_type field existed. Falls
    // back to the project's CURRENT water_type for display only (Finance
    // polish batch C) — the frozen snapshot itself is never touched/rewritten,
    // this is a label substitution at render time.
    const resolvedType = ordered[0]?.water_type ?? fallbackWaterType ?? null;
    const typeLabel = resolvedType ? WATER_TYPE_LABELS[resolvedType] : "—";

    groups.push({
      type: "trip-group",
      key: `trip-${rate}`,
      periodLabel,
      refRangeLabel: tripRefRangeLabel(ordered.map((l) => l.ref)),
      firstTripId: ordered[0]?.id ?? "",
      typeLabel,
      quantity: ordered.length,
      price: rate,
      amount: rate * ordered.length,
    });
  }

  const charges: GroupedRow[] = chargeLines.map((l) => ({
    type: "charge",
    key: `charge-${l.id}`,
    id: l.id,
    dateLabel: formatDateLabel(l.trip_date),
    description: l.description,
    amount: l.amount_sar,
  }));

  return [...groups, ...charges];
}
