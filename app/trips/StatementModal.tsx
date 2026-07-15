"use client";

// Transaction-statement drill-in (Finance tab). ITEMIZED per-trip detail —
// every trip, distinct from the invoice's grouped summary ranges (see
// lib/invoiceDisplay.ts). Two modes:
//   - prepaid: bank-statement-style chronological ledger — top-up credits +
//     delivered-trip debits, running balance. Built from lib/prepaid.ts's
//     buildStatement() (pure, tested by scripts/prepaid-check.ts).
//   - postpaid: itemized delivered trips only — no balance/ledger concept
//     (spec §8/§10: postpaid has no prepaid balance). Built from
//     consumingTrips() directly, the same pure/shared "what counts" function.
// Pre-VAT throughout (VAT is invoice-level, not shown here).
//
// Print reuses the existing portal pattern (InvoiceDetailModal/BreakdownReport):
// createPortal + mounted guard + a `printing-statement` body class toggled
// around window.print(), paired with #statement-print / .statement-print-portal
// CSS in app/globals.css.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Printer } from "lucide-react";
import { Btn, Table, TH, TD } from "@/components/ui";
import { formatSar } from "@/lib/utils";
import { buildStatement, consumingTrips, type ConsumingTrip, type TopupStatementInput } from "@/lib/prepaid";
import { WATER_TYPE_LABELS, type WaterType } from "@/lib/db-types";
import { formatTripRef } from "@/lib/trip-ref";
import TripRefLink from "@/components/TripRefLink";

export default function StatementModal({
  open,
  onClose,
  customerName,
  mode,
  topups,
  trips,
  projectWaterType,
}: {
  open: boolean;
  onClose: () => void;
  customerName: string;
  mode: "prepaid" | "postpaid";
  topups: TopupStatementInput[];
  trips: ConsumingTrip[];
  // Display-only fallback (Finance polish batch C) — project's CURRENT
  // water_type, used when an entry/trip's own water_type is null (pre-
  // water_type-field data). Never mutates any stored record.
  projectWaterType?: WaterType | null;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!open || !mounted) return null;

  function handlePrint() {
    document.body.classList.add("printing-statement");
    const cleanup = () => {
      document.body.classList.remove("printing-statement");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  const entries = mode === "prepaid" ? buildStatement(topups, trips) : [];
  const balance = entries.length > 0 ? entries[entries.length - 1].runningBalance : 0;
  const postpaidTrips = mode === "postpaid" ? consumingTrips(trips) : [];

  return createPortal(
    <div className="statement-print-portal fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div
        id="statement-print"
        className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">{customerName} — statement</h2>
          <div className="no-print flex items-center gap-3">
            <Btn variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4" /> Print
            </Btn>
            <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <p className="text-sm muted mb-4">
          {mode === "prepaid"
            ? "Pre-VAT ledger — top-up credits and delivered-trip debits, oldest first."
            : "Delivered trips, oldest first. Postpaid — no prepaid balance to track."}
        </p>

        {mode === "prepaid" ? (
          entries.length === 0 ? (
            <div className="card p-10 text-center muted text-sm">No top-ups or delivered trips yet.</div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <Table>
                <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                  <tr>
                    <TH>Date</TH>
                    <TH>Type</TH>
                    <TH>Ref</TH>
                    <TH>Note</TH>
                    <TH>Amount</TH>
                    <TH>Balance</TH>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={`${e.kind}-${e.id}`}>
                      <TD className="tabular-nums">{e.date}</TD>
                      <TD>
                        {e.kind === "topup" ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">Top-up</span>
                        ) : (
                          <span className="muted">
                            Trip{(e.water_type ?? projectWaterType) ? ` · ${WATER_TYPE_LABELS[(e.water_type ?? projectWaterType) as WaterType]}` : ""}
                          </span>
                        )}
                      </TD>
                      <TD>
                        {e.kind === "trip" ? (
                          <TripRefLink tripId={e.id} label={formatTripRef(e.ref)} />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </TD>
                      <TD className="max-w-[10rem] truncate">
                        {e.note || e.reference || <span className="muted">—</span>}
                      </TD>
                      <TD className="tabular-nums">
                        <span className={e.kind === "topup" ? "text-emerald-600 dark:text-emerald-400" : ""}>
                          {e.kind === "topup" ? "+" : "−"}
                          {formatSar(Math.abs(e.amount))}
                        </span>
                      </TD>
                      <TD className="tabular-nums font-medium">
                        <span className={e.runningBalance < 0 ? "text-rose-600 dark:text-rose-400" : ""}>
                          {formatSar(e.runningBalance)}
                        </span>
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )
        ) : postpaidTrips.length === 0 ? (
          <div className="card p-10 text-center muted text-sm">No delivered trips yet.</div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>Date</TH>
                  <TH>Ref</TH>
                  <TH>Type</TH>
                  <TH>Amount</TH>
                </tr>
              </thead>
              <tbody>
                {postpaidTrips.map((t) => (
                  <tr key={t.id}>
                    <TD className="tabular-nums">{t.trip_date}</TD>
                    <TD>
                      <TripRefLink tripId={t.id} label={formatTripRef(t.ref)} />
                    </TD>
                    <TD className="muted">
                      {(t.water_type ?? projectWaterType) ? WATER_TYPE_LABELS[(t.water_type ?? projectWaterType) as WaterType] : "—"}
                    </TD>
                    <TD className="tabular-nums">{formatSar(t.amount)}</TD>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 mt-4 border-t border-app">
          {mode === "prepaid" ? (
            <div className="text-sm">
              <span className="muted">Current balance: </span>
              <span className={"font-semibold tabular-nums " + (balance < 0 ? "text-rose-600 dark:text-rose-400" : "")}>
                {formatSar(balance)}
              </span>
            </div>
          ) : (
            <div className="text-sm muted">Postpaid — no balance to track.</div>
          )}
          <Btn variant="outline" onClick={onClose} className="no-print">
            Close
          </Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}
