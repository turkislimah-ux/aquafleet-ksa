"use client";

// A LINKED identity field — editable once, at creation.
//
// Lives in components/ rather than beside one page because BOTH the Staff
// page (driver iqama/licence) and the Fleet page (vehicle registration) need
// identical behaviour. A shared leaf imported one-way by both beats a
// cross-page import between two feature folders.
//
// WHY (0089's "store each fact once"): an Iqama/licence number and its expiry
// live on the person's row, and the Archive's linked documents read and WRITE
// those very columns. If this form kept editing them too, one fact would have
// two editors — and the moment someone used the one the other person wasn't
// watching, the two screens would disagree about a compliance date. So:
//
//   CREATE  -> a normal input. Someone has to seed the value, and this is
//              where a person is first entered.
//   EDIT    -> a real disabled box, not a removed field. The value stays
//              exactly where people already look for it, and carries a link
//              to the one place it IS edited, so "read-only" never reads as
//              "missing" or as a dead end.
//
// The disabled input deliberately has NO `name`, so it submits nothing. The
// server action reads `nullable(formData.get(...))`, and an absent key means
// the column is simply left out of the update — the existing value is not
// overwritten with null. (A `readOnly` input would still submit, so `disabled`
// is the correct choice here, not a cosmetic one.)

import Link from "next/link";
import { Lock } from "lucide-react";
import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";
import { foldDigitsInPlace, toLatinDigits } from "@/lib/digits";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full bg-transparent";
const INPUT_STYLE = { borderColor: "rgb(var(--border))" } as const;

export default function LinkedIdField({
  name,
  value,
  locked,
  archiveHref,
  type = "text",
}: {
  name: string;
  value: string;
  locked: boolean;
  // Where this value IS edited. Null hides the link (e.g. a subject that has
  // no archive row yet) rather than offering a dead end.
  archiveHref?: string | null;
  type?: "text" | "date";
}) {
  // Above the early return on purpose — a hook cannot sit after a conditional
  // return, and the unlocked branch below is exactly that.
  const { lang } = useApp();

  if (!locked) {
    return (
      <input
        name={name}
        type={type}
        defaultValue={value}
        // ARABIC-INDIC DIGITS ARE REWRITTEN AS THEY ARRIVE, whatever brought
        // them. The handler and the full reasoning live in lib/digits.ts —
        // shared rather than inlined because the bare <input> identifier fields
        // (VIN in fleet/TruckFormModal, phone on three forms, the archive
        // reference number) need the identical behaviour, and four copies of a
        // guard is four places for one of them to be dropped.
        //
        // A date input is skipped: its value is always ISO yyyy-mm-dd supplied
        // by the browser's own picker, never typed text.
        onInput={type === "text" ? (e) => foldDigitsInPlace(e.currentTarget) : undefined}
        className={INPUT}
        style={INPUT_STYLE}
      />
    );
  }

  return (
    <div>
      <div
        className="px-3 py-2 rounded-lg border text-sm opacity-60 cursor-not-allowed flex items-center gap-2 bg-black/[0.03] dark:bg-white/[0.03]"
        style={INPUT_STYLE}
      >
        <Lock className="h-3.5 w-3.5 shrink-0" />
        {/* Folded on DISPLAY as well as on entry. This branch renders a value
            that is already STORED, and rows written before the guard above
            existed still carry Arabic-Indic digits — folding only at entry
            would leave exactly those rows reading wrong. */}
        <span className="truncate">{toLatinDigits(value) || "—"}</span>
      </div>
      {archiveHref && (
        <Link
          href={archiveHref}
          className="text-[11px] text-brand-600 dark:text-brand-300 hover:underline mt-1 inline-block"
        >
          {t("shared.fields.editInArchive", lang)}
        </Link>
      )}
    </div>
  );
}
