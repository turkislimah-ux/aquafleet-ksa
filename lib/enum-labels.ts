// DB ENUM → DISPLAY LABEL, in the active language.
//
// WHY THIS FILE EXISTS AT ALL, rather than the obvious two alternatives:
//
//   NOT in lib/i18n.ts. That module imports NOTHING, deliberately, and the
//   byte-identity harness depends on it: it transpiles the dictionary on its
//   own and evaluates it to compare every `en` value against the literal it
//   replaced. One `import type` from db-types would end that.
//
//   NOT in lib/db-types.ts. That file is read by server actions and by RPC
//   wrappers; making the shape of a Postgres row depend on the UI language
//   module is the wrong direction of dependency, and `_LABELS` maps there are
//   still the English source of truth that this file's `en` values were copied
//   from byte for byte.
//
// So: one leaf module that imports the enum TYPES from one side and `t` from
// the other, and is imported by the screens.
//
// TRANSLATED BY KEY, NEVER BY LABEL. Each function switches on the ENUM VALUE
// — the thing Postgres stores and the thing every filter, sort and comparison
// in the app already discriminates on. None of these columns is a bilingual
// lookup (no `label_ar` in the row), and none of the label maps in db-types.ts
// was edited: they remain the enum's English text and its iteration order, so
// adding a member there without adding it here is a tsc error rather than a
// silent English leak.
//
// NULL RENDERS BLANK. Every function accepts null/undefined and returns "" —
// a nullable enum column is genuinely empty, and the one thing it must never
// do is print the word "null" into a table cell.

import { t, type Lang } from "@/lib/i18n";
import type {
  CustomerType,
  InvoicePaymentMethod,
  InvoiceStatus,
  PaymentMode,
  ProjectStatus,
  TripStage,
  WaterType,
} from "@/lib/db-types";

/** TRIP_STAGE_LABELS. Note "In transit" — lowercase t, and NOT `status.in_transit`. */
export function tripStageLabel(v: TripStage | null | undefined, lang: Lang): string {
  switch (v) {
    case "scheduled": return t("labels.stageScheduled", lang);
    case "loading": return t("labels.stageLoading", lang);
    case "in_transit": return t("labels.stageInTransit", lang);
    case "delivered": return t("labels.stageDelivered", lang);
    default: return "";
  }
}

/** INVOICE_STATUS_LABELS. `void` reads "Sales Return", not "Void". */
export function invoiceStatusLabel(v: InvoiceStatus | null | undefined, lang: Lang): string {
  switch (v) {
    case "draft": return t("labels.invDraft", lang);
    case "review": return t("labels.invReview", lang);
    case "confirmed": return t("labels.invConfirmed", lang);
    case "paid": return t("labels.invPaid", lang);
    case "void": return t("labels.invVoid", lang);
    default: return "";
  }
}

/** PAYMENT_METHOD_LABELS — how an invoice was SETTLED. */
export function paymentMethodLabel(v: InvoicePaymentMethod | null | undefined, lang: Lang): string {
  switch (v) {
    case "cash": return t("labels.payCash", lang);
    case "bank_transfer": return t("labels.payBankTransfer", lang);
    case "balance": return t("labels.payBalance", lang);
    default: return "";
  }
}

/** PAYMENT_MODE_LABELS — the mode a PROJECT runs under. Not the same column. */
export function paymentModeLabel(v: PaymentMode | null | undefined, lang: Lang): string {
  switch (v) {
    case "postpaid": return t("labels.postpaid", lang);
    case "prepaid": return t("labels.prepaid", lang);
    default: return "";
  }
}

/** WATER_TYPE_LABELS. */
export function waterTypeLabel(v: WaterType | null | undefined, lang: Lang): string {
  switch (v) {
    case "potable": return t("labels.waterPotable", lang);
    case "non_potable": return t("labels.waterNonPotable", lang);
    default: return "";
  }
}

/** PROJECT_STATUS_LABELS. The Arabic already existed — Batch 8 added it. */
export function projectStatusLabel(v: ProjectStatus | null | undefined, lang: Lang): string {
  switch (v) {
    case "active": return t("labels.projActive", lang);
    case "paused": return t("labels.projPaused", lang);
    case "ended": return t("labels.projEnded", lang);
    default: return "";
  }
}

/**
 * CUSTOMER_TYPE_LABELS. The map in db-types.ts is read by the already-converted
 * Customers route and is NOT edited; this keys off the same enum values.
 */
export function customerTypeLabel(v: CustomerType | null | undefined, lang: Lang): string {
  switch (v) {
    case "construction": return t("labels.custConstruction", lang);
    case "government_office": return t("labels.custGovernmentOffice", lang);
    case "facility_management": return t("labels.custFacilityManagement", lang);
    default: return "";
  }
}
