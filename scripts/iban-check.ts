// Confidence harness for the DRIVER/STAFF IBAN field (0202, lib/iban.ts).
// No DB, no test framework. Same discipline as bank-accounts-check.ts. Run:
//
//   npx tsx scripts/iban-check.ts
//
// Exits 0 if every case passes, 1 otherwise.
//
// WHY THIS SCRIPT EXISTS
// ----------------------
// lib/iban.ts is the DB check constraint `iban ~ '^SA[0-9]{22}$'` said early,
// shared by the form (courtesy) and the server action (boundary). Two things
// here cannot be seen in tsc or a green page load:
//
//   1. NORMALISATION IS THE STORE'S ONE-SPELLING GUARANTEE. Spaces AND dashes
//      strip (Turki's 2026-09-17 ruling added the dashes — banks print
//      "SA03-8000-…" and that spelling MUST pass). Drop a separator from the
//      regex and the same account stores two ways; it shows up here first.
//   2. NO CHECKSUM, BY RULING (2026-09-17, mirroring the 2026-09-05 one on
//      lib/bankAccounts.ts — the COMPANY module, deliberately separate and
//      deliberately looser). The mod-97 tripwire below reads like a bug on
//      purpose: a transposed digit is shape-valid and must be ACCEPTED, so
//      re-adding a checksum fails HERE instead of quietly re-breaking the form.
//
// Several cases are NEGATIVE CONTROLS asserting the shape guard can actually
// fail — a green run means the guard ran, not that it was removed.

import { normalizeIban, isValidSaIban } from "../lib/iban";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `[${ok ? "PASS" : "FAIL"}] ${name}` +
      (ok ? "" : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`),
  );
}

// The one canonical spelling used throughout: SA + exactly 22 digits.
const IBAN = "SA0380000000608010167519";

// ---------------------------------------------------------------------------
// 1. NORMALISATION — every formatting a bank prints collapses to ONE spelling
// ---------------------------------------------------------------------------
check("canonical input is untouched (idempotent)", normalizeIban(IBAN), IBAN);
check("bank's spaced formatting strips", normalizeIban("SA03 8000 0000 6080 1016 7519"), IBAN);
// THE RULING'S OWN CASE — dashes strip too. Remove the dash from the regex
// and this goes red before an operator's paste bounces.
check("bank's DASHED formatting strips (2026-09-17 ruling)", normalizeIban("SA03-8000-0000-6080-1016-7519"), IBAN);
check("mixed spaces and dashes strip together", normalizeIban(" sa03-8000 0000-6080 1016-7519 "), IBAN);
check("lower case upcases", normalizeIban("sa0380000000608010167519"), IBAN);
check("all four spellings are ONE stored string", [
  normalizeIban("SA03 8000 0000 6080 1016 7519"),
  normalizeIban("SA03-8000-0000-6080-1016-7519"),
  normalizeIban("sa0380000000608010167519"),
], [IBAN, IBAN, IBAN]);
check("empty stays empty (blank means 'no IBAN', caller's call)", normalizeIban("  "), "");

// ---------------------------------------------------------------------------
// 2. SHAPE — literal SA + exactly 22 digits, the DB constraint said early
// ---------------------------------------------------------------------------
check("SA + 22 digits accepted", isValidSaIban(IBAN), true);
// The round trip the form and the action both take: normalise, THEN validate.
check("dashed paste passes the FULL round trip", isValidSaIban(normalizeIban("SA03-8000-0000-6080-1016-7519")), true);
check("spaced paste passes the FULL round trip", isValidSaIban(normalizeIban("sa03 8000 0000 6080 1016 7519")), true);

// ---- THE TRIPWIRE. These two READ LIKE BUGS. They are the ruling. ----
// No banking system sits behind this field, so mod-97 cannot confirm an
// account exists — it can only reject an operator copying a real number off
// the driver's own statement. Re-add a checksum and these go red.
check("TRANSPOSED digit ACCEPTED (no checksum — re-adding one fails HERE)", isValidSaIban("SA0380000000608010167591"), true);
check("altered digit ACCEPTED (no checksum)", isValidSaIban("SA0480000000608010167519"), true);

// ---- NEGATIVE CONTROLS — proof the shape guard still fires at all. ----
check("21 digits rejected (short)", isValidSaIban("SA038000000060801016751"), false);
check("23 digits rejected (long)", isValidSaIban(`${IBAN}9`), false);
check("letters after SA rejected (digits only)", isValidSaIban("SAAB80000000608010167519"), false);
// UNLIKE lib/bankAccounts.ts: this field is Saudi-only. The company module
// accepts DE…; the driver's salary account may not be foreign.
check("foreign IBAN rejected (SA-only, NOT the company-module rule)", isValidSaIban("DE89370400440532013000"), false);
check("empty rejected (caller decides what blank means first)", isValidSaIban(""), false);
check("bare SA rejected", isValidSaIban("SA"), false);
// The contract says NORMALISED input — un-normalised spellings fail, which is
// why every caller runs normalizeIban first (asserted by the round trips above).
check("un-normalised lower case rejected (validate expects normalised input)", isValidSaIban("sa0380000000608010167519"), false);
check("un-normalised dashed spelling rejected (normalise first)", isValidSaIban("SA03-8000-0000-6080-1016-7519"), false);

console.log("");
if (failures === 0) {
  console.log("All IBAN checks PASSED ✓");
  process.exit(0);
} else {
  console.log(`${failures} IBAN check(s) FAILED ✗`);
  process.exit(1);
}
