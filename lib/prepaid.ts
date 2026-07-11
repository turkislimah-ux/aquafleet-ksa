// Prepaid balance ledger — PURE math, no Supabase/Next/I-O. Mirrors
// lib/commission.ts's discipline (see scripts/prepaid-check.ts).
//
// Model (finance-invoice-spec.md v2, §2 / §4.2 / §5):
//   balance = sum(top-ups) - sum(consumed billable trip rates), BOTH PRE-VAT.
//   Never stored — always recomputed from current rows. A trip consumes
//   balance when it's DELIVERED (billable); reversing a delivery
//   (delivered_at -> null) automatically stops it consuming, since these
//   functions only ever see whatever delivered_at the caller's CURRENT trip
//   rows carry. Nothing is manually undone.
//
//   A trip locked into a PAID invoice still counts as consumed — it was
//   delivered and drew down balance; invoicing doesn't reverse that. The
//   functions below take no invoice/lock field at all, by design:
//   consumption depends ONLY on (trip_date, delivered_at, rate_sar), never
//   on invoice_id/payout_id.
//
//   Trip rate = its PROJECT's rate_per_trip_sar (spec §2: "already exists on
//   the project"; payment_mode also lives on the project, 1:1 with customer).
//   `trips.rate_sar` is a separate, manually-entered legacy override column
//   used only by the dashboard revenue KPI — NOT used here. Callers resolve
//   each trip's rate before building a ConsumingTrip (its `rate_sar` field is
//   the RESOLVED project rate, not that raw trips column).
//
//   Ordering/period key = trip_date (scheduled day), tiebreak delivered_at,
//   tiebreak id — same convention as the commission engine.
//
// consumingTrips() is the SINGLE SHARED "what consumes balance" function
// (spec §5 lock). derivedBalance() and buildStatement() (both below) call
// it, and Commit 3's covered/unpaid engine will too — so the displayed
// balance and the covered/unpaid split can never disagree on which trips
// count, their amounts, or their order.

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type ConsumingTrip = {
  id: string;
  trip_date: string;
  delivered_at: string | null;
  // RESOLVED pre-VAT rate for this trip (its project's rate_per_trip_sar at
  // call time) — see header note. NOT the raw trips.rate_sar column.
  rate_sar: number;
};

export type ConsumptionEntry = {
  id: string;
  trip_date: string;
  delivered_at: string;
  amount: number;
};

export type TopupLite = {
  id: string;
  amount_sar: number;
  topup_date: string;
};

/**
 * THE shared "what consumes balance" function (spec §5). Filters to billable
 * (delivered) trips, optionally capped to `asOfDate` (inclusive, by
 * trip_date), and returns them FIFO-ordered (trip_date asc, delivered_at
 * asc, id asc — deterministic tiebreak, matches lib/commission.ts). Commit
 * 3's covered/unpaid engine walks this exact list; derivedBalance() below
 * just sums it.
 */
export function consumingTrips(trips: ConsumingTrip[], asOfDate?: string): ConsumptionEntry[] {
  return trips
    .filter((t): t is ConsumingTrip & { delivered_at: string } => t.delivered_at != null)
    .filter((t) => asOfDate == null || t.trip_date <= asOfDate)
    .map((t) => ({ id: t.id, trip_date: t.trip_date, delivered_at: t.delivered_at, amount: round2(t.rate_sar) }))
    .sort((a, b) =>
      a.trip_date !== b.trip_date
        ? a.trip_date < b.trip_date ? -1 : 1
        : a.delivered_at !== b.delivered_at
        ? a.delivered_at < b.delivered_at ? -1 : 1
        : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
}

/**
 * Derived pre-VAT balance = sum(top-ups up to asOfDate) - sum(consumed trip
 * rates up to asOfDate, via consumingTrips). Pure; recomputed fresh every
 * call, so a reversed trip restores balance automatically next call.
 */
export function derivedBalance(topups: TopupLite[], trips: ConsumingTrip[], asOfDate?: string): number {
  const credits = round2(
    topups.filter((t) => asOfDate == null || t.topup_date <= asOfDate).reduce((s, t) => s + t.amount_sar, 0),
  );
  const debits = round2(consumingTrips(trips, asOfDate).reduce((s, e) => s + e.amount, 0));
  return round2(credits - debits);
}

export type StatementEntry = {
  kind: "topup" | "trip";
  id: string;
  date: string; // topup_date (credit) or trip_date (debit)
  amount: number; // positive for a top-up credit, negative for a trip debit
  runningBalance: number;
  note?: string | null;
  reference?: string | null;
};

export type TopupStatementInput = TopupLite & { note?: string | null; reference?: string | null };

/**
 * Bank-statement-style ledger (spec §10 drill-in): every top-up credit + every
 * trip debit, chronological (date asc; same-day tie: credit before debit,
 * then id asc), with a running balance. Pure/testable. The final entry's
 * runningBalance always equals derivedBalance(...) for the same asOfDate —
 * both derive from the same consumingTrips() core, so they can't disagree.
 */
export function buildStatement(
  topups: TopupStatementInput[],
  trips: ConsumingTrip[],
  asOfDate?: string,
): StatementEntry[] {
  const credits = topups
    .filter((t) => asOfDate == null || t.topup_date <= asOfDate)
    .map((t) => ({
      kind: "topup" as const,
      id: t.id,
      date: t.topup_date,
      amount: round2(t.amount_sar),
      note: t.note ?? null,
      reference: t.reference ?? null,
    }));
  const debits = consumingTrips(trips, asOfDate).map((e) => ({
    kind: "trip" as const,
    id: e.id,
    date: e.trip_date,
    amount: round2(-e.amount),
    note: null as string | null,
    reference: null as string | null,
  }));

  const merged = [...credits, ...debits].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "topup" ? -1 : 1; // same-day: credit before debit
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  let running = 0;
  return merged.map((e) => {
    running = round2(running + e.amount);
    return { ...e, runningBalance: running };
  });
}

// ---------------------------------------------------------------------------
// Covered / unpaid engine (spec §5, prepaid-only, HIGHEST-RISK LOGIC).
//
// TOTAL-BALANCE MODEL (locked): this is a PRESENTATION SPLIT of the single
// derived balance — sum(top-ups) − sum(consumed trip rates) — not a per-top-up
// allocation. It never tracks which top-up "pays" which trip. Top-ups form one
// pool (summed, order among themselves doesn't matter — same as derivedBalance's
// credit side); trips drain the pool FIFO via consumingTrips (THE shared
// "what consumes balance" function — split here, never recomputed).
//
// Whole-trip coverage: a trip is Covered only if its full rate fits in the
// remaining pool. The FIRST trip that doesn't fit, and every trip after it
// (in FIFO order), goes Unpaid — no trip splitting, no skip-and-try-next.
// Leftover that couldn't cover the next whole trip freezes in remainingBalance
// (never partially spent) and rolls forward to the next call automatically,
// since this is a pure function recomputed fresh from current rows every time
// — a later top-up (any topup_date) just enlarges the pool next call, which
// can flip a previously-unpaid trip back to covered with no special-case code.
//
// Invariant (enforced by the harness on every case): coveredTotal + unpaidTotal
// === sum of every consumingTrips() amount, and remainingBalance − unpaidTotal
// === derivedBalance(topups, trips, asOfDate) for the same inputs — proving
// this can never disagree with the displayed balance.
export type CoveredUnpaidResult = {
  covered: ConsumptionEntry[];
  unpaid: ConsumptionEntry[];
  coveredTotal: number;
  unpaidTotal: number;
  // Leftover pool after only-covered trips subtracted. Always >= 0 — never
  // driven negative (unlike derivedBalance, which subtracts every consumed
  // trip unconditionally and can go negative to show total over-balance).
  remainingBalance: number;
};

export function splitCoveredUnpaid(
  topups: TopupLite[],
  trips: ConsumingTrip[],
  asOfDate?: string,
): CoveredUnpaidResult {
  let pool = round2(
    topups.filter((t) => asOfDate == null || t.topup_date <= asOfDate).reduce((s, t) => s + t.amount_sar, 0),
  );

  const entries = consumingTrips(trips, asOfDate);
  const covered: ConsumptionEntry[] = [];
  const unpaid: ConsumptionEntry[] = [];
  let hitWall = false;

  for (const e of entries) {
    if (!hitWall && pool >= e.amount) {
      covered.push(e);
      pool = round2(pool - e.amount);
    } else {
      hitWall = true;
      unpaid.push(e);
    }
  }

  const coveredTotal = round2(covered.reduce((s, e) => s + e.amount, 0));
  const unpaidTotal = round2(unpaid.reduce((s, e) => s + e.amount, 0));

  return { covered, unpaid, coveredTotal, unpaidTotal, remainingBalance: pool };
}
