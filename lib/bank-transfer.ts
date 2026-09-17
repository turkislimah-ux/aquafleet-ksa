// BANK-TRANSFER FILE (0202) — the salary batch the bank's portal uploads.
//
// This module is the CONTRACT: the eleven headers and the one row-math
// function. The Arabic header line is the bank's own template transcribed
// byte-for-byte — it is NOT UI copy, does not live in lib/i18n.ts, and must
// never be "fixed" for tone or consistency with the app's dictionary. The
// portal matches columns by header text; a synonym is a rejected file.
// scripts/bank-transfer-check.ts asserts the line byte-exact.
//
// FROZEN MONEY, LIVE ROUTING. Every amount comes from driver_payslips — the
// issued document's frozen figures, same rule as every surface pricing
// delivered work. The bank and IBAN come LIVE from the drivers row, the one
// deliberate exception (a driver changes banks; the money he was owed does
// not change with it). resolvePayslipBank is the pair rule's single
// implementation — bank without IBAN, IBAN without bank, or a dangling id
// all resolve to null and BOTH routing cells go out blank. The row still
// exports: the clerk fills the two cells at the bank, the driver still gets
// paid, and a missing row would hide that he was owed anything.
//
// THE COLUMN ARITHMETIC is the bank's shape, not ours, so the mapping is
// stated once here and proven in the check script:
//
//   Basic      = base + commission + specials   (what the month's work earned)
//   Housing    = 0                              (not tracked; the column must
//                                                exist because the template
//                                                has it, and 0 is the truth)
//   Other      = bonus
//   Deductions = deductions − adjustments       (adjustments are SIGNED
//                                                corrections in the slip's
//                                                own math; the bank template
//                                                has no signed column, so
//                                                they net against deductions)
//   Total      = Basic + Housing + Other − Deductions
//              = base + commission + specials + bonus − deductions + adjustments
//              = net_sar                        (the slip's own identity, 0118)
//
// Total is written FROM net_sar, not recomputed — if the identity ever breaks
// the check script goes red rather than this file papering over it.
//
// NUMBERS are plain Latin digits with exactly two decimals and no thousands
// separator ("4350.00") — portal parser, not a human reader. Names are the
// one localized cell: the Arabic UI exports name_ar, the English UI name,
// because the clerk cross-checks the file against the screen in front of them.
//
// Purity: rows in, strings out. No React, no Supabase, no Date.

import { arText, type Lang } from "./i18n";
import { toLatinDigits } from "./digits";
import type { IssuedPayslipRow, PayslipDriverRow } from "./reports";
import { resolvePayslipBank } from "./docvm/payslip";

/**
 * The bank template's own header line, EXACT — see module comment. Order is
 * the column order; bankTransferRow returns its cells in this order.
 */
export const BANK_TRANSFER_HEADERS_AR: readonly string[] = [
  "البنك",
  "رقم الحساب",
  "إجمالي الراتب",
  "ملاحظات",
  "اسم الموظف",
  "رقم الهوية أو الإقامة",
  "عنوان الموظف",
  "الراتب الأساسي",
  "بدل سكن",
  "بدلات أخرى",
  "خصومات",
];

/** Same columns, English UI. Translation of the contract, not a second one. */
export const BANK_TRANSFER_HEADERS_EN: readonly string[] = [
  "Bank",
  "Account Number",
  "Total Salary",
  "Notes",
  "Employee Name",
  "ID or Iqama Number",
  "Employee Address",
  "Basic Salary",
  "Housing Allowance",
  "Other Allowances",
  "Deductions",
];

export function bankTransferHeaders(lang: Lang): readonly string[] {
  return lang === "ar" ? BANK_TRANSFER_HEADERS_AR : BANK_TRANSFER_HEADERS_EN;
}

/** Portal number spelling: Latin digits, two decimals, no separators. */
function amount(n: number): string {
  return n.toFixed(2);
}

/**
 * All addresses are the company's own city — the bank wants a non-empty cell,
 * driver addresses are not tracked, and inventing per-driver strings would be
 * fiction the clerk then has to defend.
 */
const EMPLOYEE_ADDRESS = "RIYADH";

/**
 * THE one row function — eleven cells for one issued payslip, in header order.
 * Money from the frozen document; identity, routing and name from the LIVE
 * driver row (`undefined` when the driver was hard-missing from the roster
 * query: routing, name and iqama all blank, amounts still export).
 */
export function bankTransferRow(
  doc: IssuedPayslipRow,
  driver: PayslipDriverRow | undefined,
  bankCodes: readonly { id: string; key: string; label: string; label_ar: string }[],
  lang: Lang,
): string[] {
  // Pair rule, the ONE implementation (lib/docvm/payslip.ts): half a pair
  // resolves to null and both cells blank TOGETHER. A key with no account —
  // or an account with no bank — is a cell the clerk would wire money with.
  const bank = resolvePayslipBank(driver, bankCodes);
  // arText's own fallback: an Arabic UI with no Arabic name exports the
  // English one rather than a blank cell — same rule as every screen label.
  const name = driver ? arText(driver.name, driver.name_ar, lang) : "";
  const cells = [
    bank ? bank.key : "",
    bank ? bank.iban : "",
    amount(doc.net_sar),
    "",
    name,
    driver?.iqama_number ?? "",
    EMPLOYEE_ADDRESS,
    amount(doc.base_salary_sar + doc.commission_sar + doc.specials_sar),
    amount(0),
    amount(doc.bonus_sar),
    amount(doc.deductions_sar - doc.adjustments_sar),
  ];
  // DIGIT FOLD AT THE EXPORT BOUNDARY. Windows-1256 — the encoding this file
  // is delivered in (lib/cp1256.ts) — has no Arabic-Indic digits, so «سائق ١»
  // would encode its ١ as "?" and the clerk would wire money against a
  // mangled name. Fold BOTH ranges (U+0660-0669, U+06F0-06F9) to ASCII 0-9
  // via lib/digits.ts's one helper — no second fold implementation.
  //
  // This does NOT violate digits.ts's "never run a name through this" rule:
  // that rule protects STORED values (`drivers.name_ar` keeps «فهد ٣» — ruled
  // on, do not re-raise). This fold happens at serialization only, because the
  // target byte set cannot represent the original. Screen and DB are
  // untouched. Applied to every cell rather than the name alone: iqama and
  // IBAN are already Latin by their own write-path folds, and amount() emits
  // Latin by construction, so for those this is an identity pass — and the
  // encoder's "?" stays the last resort for anything genuinely unmappable.
  return cells.map((c) => toLatinDigits(c));
}
