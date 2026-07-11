"use client";

// Transaction-statement drill-in (Finance tab). Bank-statement-style
// chronological ledger for ONE prepaid customer: top-up credits + delivered-
// trip debits, running balance — built entirely from lib/prepaid.ts's
// buildStatement() (pure, already tested by scripts/prepaid-check.ts).
// Pre-VAT throughout (VAT is a later commit).

import { X } from "lucide-react";
import { Btn, Table, TH, TD } from "@/components/ui";
import { formatSar } from "@/lib/utils";
import { buildStatement, type ConsumingTrip, type TopupStatementInput } from "@/lib/prepaid";

export default function StatementModal({
  open,
  onClose,
  customerName,
  topups,
  trips,
}: {
  open: boolean;
  onClose: () => void;
  customerName: string;
  topups: TopupStatementInput[];
  trips: ConsumingTrip[];
}) {
  if (!open) return null;

  const entries = buildStatement(topups, trips);
  const balance = entries.length > 0 ? entries[entries.length - 1].runningBalance : 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">{customerName} — statement</h2>
          <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm muted mb-4">
          Pre-VAT ledger — top-up credits and delivered-trip debits, oldest first.
        </p>

        {entries.length === 0 ? (
          <div className="card p-10 text-center muted text-sm">No top-ups or delivered trips yet.</div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>Date</TH>
                  <TH>Type</TH>
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
                        <span className="muted">Trip</span>
                      )}
                    </TD>
                    <TD className="max-w-[14rem] truncate">
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
        )}

        <div className="flex items-center justify-between pt-4 mt-4 border-t border-app">
          <div className="text-sm">
            <span className="muted">Current balance: </span>
            <span className={"font-semibold tabular-nums " + (balance < 0 ? "text-rose-600 dark:text-rose-400" : "")}>
              {formatSar(balance)}
            </span>
          </div>
          <Btn variant="outline" onClick={onClose}>
            Close
          </Btn>
        </div>
      </div>
    </div>
  );
}
