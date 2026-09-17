"use client";

// Bank-transfer pair (0202) — bank picker + IBAN input, used inside TWO forms
// (DriversClient's driver form, StaffTab's staff form). Built once here instead
// of copied twice, same reasoning as OperationStationField beside it.
//
// Renders TWO sibling grid children (one field each), so inside the enclosing
// `grid grid-cols-1 sm:grid-cols-2` form the pair sits on one row, matching the
// rhythm of every other field — deliberately NOT a full-width boxed section
// like the station picker: that box earns its frame with a manage action and a
// deactivation badge, and this pair has neither (bank_codes is seed-only in
// v1, no in-app add/rename).
//
// `bankCodes` must be ALL rows (active + retired): the options offered are the
// ACTIVE banks in sort_order, plus the current value's own bank if it has been
// retired since — so a person already on a retired bank keeps its name instead
// of rendering blank (the OperationStationField rule, restated).
//
// The IBAN input validates LIVE with the same lib/iban.ts functions the server
// action re-runs: the field is a courtesy, the action is the boundary. Arabic-
// Indic digits fold as they arrive (it is an IDENTIFIER, like phone/iqama) and
// `dir` is forced LTR so "SA03…" never reorders in Arabic mode. Note the live
// message cannot BLOCK submission from in here — each form's onSubmit runs the
// same check as a gate before calling its action.

import { useState } from "react";
import type { BankCode } from "@/lib/db-types";
import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";
import { toLatinDigits } from "@/lib/digits";
import { normalizeIban, isValidSaIban } from "@/lib/iban";
import { bankLabel } from "@/lib/bank-codes";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

export default function BankFields({
  bankCodes,
  defaultBankCodeId,
  defaultIban,
}: {
  bankCodes: BankCode[]; // ALL rows (active + retired)
  defaultBankCodeId: string | null;
  defaultIban: string | null;
}) {
  const { lang } = useApp();
  const [bankId, setBankId] = useState(defaultBankCodeId ?? "");
  const [iban, setIban] = useState(defaultIban ?? "");

  const active = bankCodes.filter((b) => b.active);
  const options =
    bankId && !active.some((b) => b.id === bankId)
      ? [...active, ...bankCodes.filter((b) => b.id === bankId)]
      : active;

  // Live verdict on the NORMALISED spelling — spaces and dashes the user
  // pastes from the bank's own formatting are not an error, stripped on save.
  const normalized = normalizeIban(iban);
  const ibanInvalid = normalized !== "" && !isValidSaIban(normalized);

  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        <span className="muted">{t("shared.bank.fBank", lang)}</span>
        <select
          name="bank_code_id"
          value={bankId}
          onChange={(e) => setBankId(e.target.value)}
          className={INPUT}
          style={INPUT_STYLE}
        >
          <option value="">—</option>
          {options.map((b) => (
            // bankLabel = "KEY · name" — the one spelling of a bank on every
            // surface (lib/bank-codes.ts). A native <select> shows the chosen
            // option's own text, so this covers the selected value too.
            <option key={b.id} value={b.id}>
              {bankLabel(b, lang)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="muted">{t("shared.bank.fIban", lang)}</span>
        <input
          name="iban"
          value={iban}
          placeholder="SA…"
          dir="ltr"
          // Folded THROUGH STATE, not foldDigitsInPlace: this input is
          // controlled (the live verdict below needs the value), and mutating
          // .value under a controlled input is overwritten on re-render.
          onChange={(e) => setIban(toLatinDigits(e.target.value))}
          className={INPUT}
          style={INPUT_STYLE}
        />
        {ibanInvalid && (
          <span className="text-xs text-rose-600 dark:text-rose-400">
            {t("shared.bank.ibanInvalid", lang)}
          </span>
        )}
      </label>
    </>
  );
}
