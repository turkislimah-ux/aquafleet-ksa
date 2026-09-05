// Confidence harness for the COMPANY BANK ACCOUNTS layer (migration 0184 +
// lib/bankAccounts.ts + the shared Transfer Details vm block). No DB, no test
// framework. Same discipline as vat-check.ts. Run:
//
//   npx tsx scripts/bank-accounts-check.ts
//
// Exits 0 if every case passes, 1 otherwise.
//
// WHY THIS SCRIPT EXISTS
// ----------------------
// 0184's CHECK constraint enforces exactly two things — that the value is an
// array and that it holds at most 3 elements. It cannot enforce the shape of an
// element (a CHECK may not contain a subquery, so `jsonb_array_elements` is
// unavailable). The app is therefore the ONLY thing standing between a
// malformed jsonb element and a payment instruction printed on a customer
// invoice, and the two failure modes it guards against are both SILENT:
//
//   1. `show_on_invoice` FAILS CLOSED. Anything other than an explicit `true`
//      is not shown. Loosen that to a truthy test and a malformed element
//      starts publishing an account we did not intend to publish — with no
//      error, on a document already in the customer's hands.
//   2. THE IBAN FIELD MUST STAY PERMISSIVE. It once ran the ISO 13616 mod-97
//      checksum and a length test; both were removed by ruling (2026-09-05)
//      because this screen has no banking system behind it — a checksum cannot
//      confirm an account exists, it can only reject an operator copying a
//      number off a statement, which is exactly what it did. Section 4 below
//      therefore asserts the LOOSENING: a transposed digit must be ACCEPTED.
//      Those cases read like bugs on purpose. They are the tripwire that makes
//      re-adding a checksum fail here instead of quietly re-breaking the field.
//
// Neither shows up in tsc, in a render, or in a green page load. Both show up
// here. Several cases below are NEGATIVE CONTROLS that assert a guard can
// actually fail, so a green run means the guard ran — not that it was removed.

import {
  MAX_BANK_ACCOUNTS,
  ensureSaPrefix,
  formatIban,
  isAcceptableIban,
  normalizeIban,
  parseBankAccounts,
  validateBankAccounts,
  visibleBankAccounts,
  type CompanyBankAccount,
} from "../lib/bankAccounts";
import { buildBankBlock } from "../lib/invoiceViewModel";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `[${ok ? "PASS" : "FAIL"}] ${name}` +
      (ok ? "" : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`),
  );
}

// A real, checksum-valid Saudi IBAN shape used throughout.
const IBAN = "SA0380000000608010167519";
const acc = (over: Partial<CompanyBankAccount> = {}): CompanyBankAccount => ({
  id: "a1",
  bank_name: "Al Rajhi Bank",
  holder_name: "Bin Slimah Group",
  iban: IBAN,
  show_on_invoice: true,
  ...over,
});

// ---------------------------------------------------------------------------
// 1. READ PATH — every state the column can legally be in, none of them throwing
// ---------------------------------------------------------------------------
// The column is `not null default '[]'` TODAY, but a pre-0184 snapshot frozen
// into an old invoice's seller_snapshot has no such key at all. Both arrive
// here as `unknown` and both must degrade to "nothing to print".

check("null never throws", parseBankAccounts(null), []);
check("undefined (pre-0184 snapshot) never throws", parseBankAccounts(undefined), []);
check("a non-array never throws", parseBankAccounts({ iban: IBAN }), []);
check("a string never throws", parseBankAccounts("[]"), []);
check("empty array", parseBankAccounts([]), []);

// ---------------------------------------------------------------------------
// 2. ELEMENT NARROWING — what the database is allowed to hold and we are not
// ---------------------------------------------------------------------------
{
  const junk = parseBankAccounts([
    null,
    "nonsense",
    42,
    [],
    { bank_name: "no id", iban: IBAN, show_on_invoice: true }, // unidentifiable
    { id: "blank", bank_name: "", iban: "", show_on_invoice: true }, // nothing to say
    acc({ id: "keeper" }),
  ]);
  check("junk elements are dropped, the usable one survives", junk.map((a) => a.id), ["keeper"]);
}

// FAIL-CLOSED. The cost of wrongly hiding an account is an operator ticking a
// box; the cost of wrongly showing one is a customer wiring money to an account
// we did not intend to publish. These four are the guard, and the last two are
// its negative controls — a truthy test would pass them.
check("explicit true shows", visibleBankAccounts([acc({ show_on_invoice: true })]).length, 1);
check("explicit false hides", visibleBankAccounts([acc({ show_on_invoice: false })]).length, 0);
check(
  "MISSING flag hides (fails closed)",
  visibleBankAccounts([{ id: "x", bank_name: "B", iban: IBAN }]).length,
  0,
);
check(
  "TRUTHY-BUT-NOT-TRUE flag hides (negative control: a truthy test would show it)",
  visibleBankAccounts([{ id: "x", bank_name: "B", iban: IBAN, show_on_invoice: "yes" }]).length,
  0,
);
check(
  "flag 1 hides (negative control)",
  visibleBankAccounts([{ id: "x", bank_name: "B", iban: IBAN, show_on_invoice: 1 }]).length,
  0,
);

// ---------------------------------------------------------------------------
// 3. THE CEILING — trimmed on READ, rejected on WRITE, and those differ
// ---------------------------------------------------------------------------
// A row that somehow exceeded the ceiling should still render its first three
// accounts rather than rendering nothing; the ceiling is the DB's to enforce on
// write, and validateBankAccounts is where the app enforces it.
{
  const four = Array.from({ length: 4 }, (_, i) => acc({ id: `x${i}` }));
  check("MAX is 3, mirroring 0184's CHECK", MAX_BANK_ACCOUNTS, 3);
  check("read TRIMS past the ceiling", parseBankAccounts(four).length, 3);
  check("write REJECTS past the ceiling", validateBankAccounts(four), {
    ok: false,
    error: { code: "too_many" },
  });
}

// ---------------------------------------------------------------------------
// 4. IBAN — normalisation, display, the DEFAULTED country code, and the
//    ABSENCE of a checksum, a length rule and a country whitelist
// ---------------------------------------------------------------------------
// The spacing half is unchanged, and it is the half that earns its keep: it is
// what makes the same account impossible to store two ways.
check("normalize strips every separator a human pastes", normalizeIban(" sa03-8000 6080 "), "SA0380006080");
check("format groups by 4", formatIban(IBAN), "SA03 8000 0000 6080 1016 7519");
check("format is idempotent (a re-formatted value never drifts)", formatIban(formatIban(IBAN)), "SA03 8000 0000 6080 1016 7519");
check("a spaced paste and a bare paste normalise to ONE stored string", normalizeIban("SA03 8000 0000 6080 1016 7519"), normalizeIban(IBAN));

// The prefix is DEFAULTED, not demanded. An operator who types the digits alone
// means the Saudi account; bouncing him back to retype two letters is friction
// with nothing on the other side of it. A value that already carries a country
// code keeps it, whatever it is.
check("bare digits get SA put back", ensureSaPrefix("380000000608010167519"), "SA380000000608010167519");
check("an SA value is left alone", ensureSaPrefix(IBAN), IBAN);
check("a lower-case sa is still SA", ensureSaPrefix("sa03 8000 0000"), "SA0380000000");
check("empty stays empty (no bare 'SA' is invented)", ensureSaPrefix("  "), "");
// NOT prefixed: SADE89... is not any account anywhere. Better that validation
// says so than that we manufacture a number a customer would wire to.
check("a foreign code is NOT prefixed into nonsense", ensureSaPrefix("DE89370400440532013000"), "DE89370400440532013000");
// Blur order in the settings form is prefix, THEN group. Reversed, the SA lands
// mid-group and the spacing sits a character off from every other account.
check("blur order — prefix then group", formatIban(ensureSaPrefix("380000000608010167519")), "SA38 0000 0006 0801 0167 519");

check("ordinary Saudi IBAN accepted", isAcceptableIban(IBAN), true);
check("accepted with display spacing", isAcceptableIban("SA03 8000 0000 6080 1016 7519"), true);
check("accepted as bare digits (the prefix is repaired first)", isAcceptableIban("380000000608010167519"), true);
check("lower case accepted", isAcceptableIban("sa0380000000608010167519"), true);
// ---- THE LOOSENING. These SEVEN READ LIKE BUGS. They are the ruling. ----
// A checksum cannot confirm an account EXISTS — it only asserts that a string
// obeys a formula — so with no banking system behind this screen, all it ever
// did was reject an operator copying a real number off a real statement.
// Re-add a checksum, a length rule or a country whitelist and these go red.
check("TRANSPOSED digit ACCEPTED (no checksum — re-adding one fails HERE)", isAcceptableIban("SA0380000000608010167591"), true);
check("altered digit ACCEPTED (no checksum)", isAcceptableIban("SA0480000000608010167519"), true);
check("LETTERS after the country code accepted (no digits-only rule)", isAcceptableIban("SAAA80000000608010167519"), true);
check("SHORT value accepted (no length rule)", isAcceptableIban("SA0380"), true);
check("LONG value accepted (no length rule)", isAcceptableIban(`${IBAN}00000000000000`), true);
// FOREIGN ACCOUNTS ARE ALLOWED. This reverses the line above these two that
// stood for one turn on 2026-09-05 — SA-only was asked for, then amended the
// same day to SA-as-default. Kept INVERTED rather than deleted so the reversal
// is on the record and a re-added whitelist fails here.
check("a foreign IBAN ACCEPTED (SA is a default, not a whitelist)", isAcceptableIban("DE89370400440532013000"), true);
check("a long foreign IBAN ACCEPTED", isAcceptableIban("MT84MALT011000012345MTLCAST001S"), true);

// ---- What can still fail is only this: an entry with no country code. ----
check("empty rejected", isAcceptableIban(""), false);
check("separators alone rejected", isAcceptableIban("  -  "), false);
check("a bare country code with nothing after it rejected", isAcceptableIban("SA"), false);
check("ONE letter then digits rejected (that is not a country code)", isAcceptableIban("S1234567890"), false);

// ---------------------------------------------------------------------------
// 5. WRITE GATE — the cleaned array, or the first problem WITH ITS ROW
// ---------------------------------------------------------------------------
{
  const r = validateBankAccounts([
    { id: "", bank_name: "  Al Rajhi  ", holder_name: " Bin Slimah ", iban: "sa03 8000 0000 6080 1016 7519", show_on_invoice: true },
  ]);
  check("write accepts a messy but valid row", r.ok, true);
  if (r.ok) {
    check("write trims the names", [r.accounts[0].bank_name, r.accounts[0].holder_name], ["Al Rajhi", "Bin Slimah"]);
    check("write stores the NORMALISED iban, never the typed spacing", r.accounts[0].iban, IBAN);
    check("write fills a missing id (a row must stay addressable)", r.accounts[0].id.length > 0, true);
    check("write normalises the flag to a real boolean", r.accounts[0].show_on_invoice, true);
  }
}
// The index is what lets a form ring the offending card instead of the form.
check("write names the offending ROW, not the form", validateBankAccounts([acc({ id: "1" }), acc({ id: "2", holder_name: "  " })]), {
  ok: false,
  error: { code: "holder_name_required", index: 1 },
});
check("blank bank name rejected", validateBankAccounts([acc({ bank_name: " " })]), {
  ok: false,
  error: { code: "bank_name_required", index: 0 },
});
// The write gate loosened with the field. A transposed digit now SAVES — the
// mirror of section 4's ruling, asserted here because this is the path the
// settings form actually takes.
{
  const r = validateBankAccounts([acc({ iban: "SA0380000000608010167591" })]);
  check("write ACCEPTS a transposed digit (no checksum on the write path either)", r.ok, true);
}
// Bare digits are repaired on the way in, so an operator who omits SA still
// stores a complete number rather than being sent back to the form.
{
  const r = validateBankAccounts([acc({ iban: "380000000608010167519" })]);
  check("write puts SA back on a bare-digit entry", r.ok && r.accounts[0].iban, "SA380000000608010167519");
}
// A foreign account is stored EXACTLY as typed — no SA grafted onto it.
{
  const r = validateBankAccounts([acc({ iban: "de89 3704 0044 0532 0130 00" })]);
  check("write accepts a foreign iban and keeps its own country code", r.ok && r.accounts[0].iban, "DE89370400440532013000");
}
check("write still rejects an empty iban", validateBankAccounts([acc({ iban: "  " })]), {
  ok: false,
  error: { code: "iban_invalid", index: 0 },
});
// An IBAN must never reach a log line or an error string. The error carries a
// CODE and an INDEX and nothing else — this asserts the shape that makes that
// true, so adding the offending value to it fails here.
// An EMPTY iban, not a malformed one — with the checksum gone, "nope" now
// normalises to "NOPE" and reads as country code NO, so it is accepted and
// there is no error object to inspect. Emptiness is the last failing case left.
check("the error object carries NO iban", Object.keys((validateBankAccounts([acc({ iban: "" })]) as { error: object }).error).sort(), ["code", "index"]);

// ---------------------------------------------------------------------------
// 6. THE SHARED VM BLOCK — one expression behind the popup AND the download
// ---------------------------------------------------------------------------
// buildBankBlock is what makes "0% deviation" structural rather than a matter
// of discipline: both surfaces call it, so neither can filter, order or space
// the accounts differently from the other.

check("no accounts -> NO block (not an empty heading)", buildBankBlock([]), null);
check("nothing ticked -> NO block", buildBankBlock([acc({ show_on_invoice: false })]), null);
check("pre-0184 snapshot -> NO block", buildBankBlock(undefined), null);
{
  const b = buildBankBlock([
    acc({ id: "one" }),
    acc({ id: "two", show_on_invoice: false }),
    acc({ id: "three", bank_name: "Riyad Bank", holder_name: "Bin Slimah", iban: "sa03-8000-0000-6080-1016-7519" }),
  ]);
  check("block renders ONLY ticked accounts", b?.accounts.map((a) => a.id), ["one", "three"]);
  check("block preserves STORED order (the settings screen's order)", b?.accounts[0].id, "one");
  check("block pre-groups the iban for both surfaces", b?.accounts[1].ibanDisplay, "SA03 8000 0000 6080 1016 7519");
  check("heading is bilingual, from the dictionary", [b?.heading.en, b?.heading.ar], ["Transfer Details", "تفاصيل التحويل"]);
  check("iban label is bilingual, from the dictionary", [b?.ibanLabel.en, b?.ibanLabel.ar], ["IBAN", "رقم الآيبان"]);
  check("a ticked account keeps its id (React keys on it, never the index)", b?.accounts[1].id, "three");
}

console.log("");
if (failures === 0) {
  console.log("All bank-account checks PASSED ✓");
  process.exit(0);
} else {
  console.log(`${failures} bank-account check(s) FAILED ✗`);
  process.exit(1);
}
