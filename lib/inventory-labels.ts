// INVENTORY ENUM/STATE → DISPLAY LABEL, in the active language.
//
// WHY THIS FILE EXISTS: the part-details PRINT SHEET has to say the same words
// the Item drawer says, and a view-model in lib/docvm/ may not import from
// app/ (no React, no fs, no Supabase — see lib/docvm/payout-history.ts's
// header). All three of these maps lived inside React modules:
//
//   MOVEMENT_LABEL / movementLabel  — app/inventory/InventoryClient.tsx
//   CATEGORY_LABEL / categoryLabel  — app/inventory/SharedCreateModals.tsx
//   the lot badge words             — inline in ViewPartModal's row map
//
// Same one-leaf-module answer lib/enum-labels.ts documents for the db enums,
// and the same one SharedCreateModals.tsx itself reached for when PartPicker
// needed stockTier from two screens at once: move the leaf DOWN, import it
// back UP, one-way edge. Copying the maps instead would be two sources of
// truth for one word, which is exactly the drift that let a movement type
// ship with no label.
//
// NOT in lib/i18n.ts: that module imports nothing, deliberately, and the
// byte-identity harness depends on it — and MOVEMENT_LABEL is keyed on a
// db-types union, so an import would run the wrong way.

import type { StockMovement } from "@/lib/db-types";

// Every movement_type the DB CHECK permits, verified live:
//   CHECK (movement_type = ANY (ARRAY['receive','adjust','receive_lot','consume','return']))
// Keyed on StockMovement["movement_type"], so once that union matches the
// CHECK the compiler REFUSES an incomplete map — which is what should have
// caught the missing 'return' before it reached the page.
const MOVEMENT_LABEL: Record<StockMovement["movement_type"], { en: string; ar: string }> = {
  receive: { en: "Received", ar: "استلام" },
  adjust: { en: "Adjusted", ar: "تعديل" },
  receive_lot: { en: "Price lot", ar: "دفعة سعر" },
  consume: { en: "Consumed", ar: "استهلاك" },
  // Written by the maintenance reversal path (return_to_lots) and by
  // exit-permit returns and voids (return_exit_permit_line, 0093).
  return: { en: "Return", ar: "إرجاع" },
};

// Never let an unlabeled movement type white-screen the page.
//
// The crash this replaces: MOVEMENT_LABEL[type].en on a type with no entry
// threw "Cannot read properties of undefined (reading 'en')" and took the
// whole Inventory page down — over a LABEL, while the ledger data itself was
// perfectly correct. The typed Record above is the real guard; this is the
// backstop for the case where the database gains a type before the app is
// rebuilt, which no amount of compile-time checking can prevent.
export function movementLabel(type: string, lang: "en" | "ar"): string {
  const entry = (MOVEMENT_LABEL as Record<string, { en: string; ar: string } | undefined>)[type];
  return entry?.[lang] ?? type;
}

const CATEGORY_LABEL: Record<string, { en: string; ar: string }> = {
  fluid: { en: "Fluid", ar: "سوائل" },
  filter: { en: "Filter", ar: "فلتر" },
  brake: { en: "Brake", ar: "فرامل" },
  tire: { en: "Tire", ar: "إطارات" },
  electrical: { en: "Electrical", ar: "كهرباء" },
  tank: { en: "Tank", ar: "خزان" },
  engine: { en: "Engine", ar: "محرك" },
  consumable: { en: "Consumable", ar: "مستهلكات" },
  equipment: { en: "Equipment", ar: "معدات" },
};

export function categoryLabel(cat: string | null, lang: "en" | "ar"): string {
  if (!cat) return "—";
  const found = CATEGORY_LABEL[cat];
  if (!found) return cat;
  return lang === "en" ? found.en : found.ar;
}

// A price lot is in exactly one of three states, and the order of the tests
// is load-bearing: the CURRENT lot can also be depleted (its last unit was
// consumed and nothing has been received since), and when it is, the drawer
// calls it Depleted. Depleted wins.
export function lotStatusLabel(
  opts: { depleted: boolean; isCurrent: boolean },
  lang: "en" | "ar",
): string {
  if (opts.depleted) return lang === "en" ? "Depleted" : "منتهية";
  if (opts.isCurrent) return lang === "en" ? "Current batch" : "الدفعة الحالية";
  return lang === "en" ? "Old batch" : "دفعة قديمة";
}
