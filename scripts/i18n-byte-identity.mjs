// Batch 7 byte-identity prover.
//
// The claim under test: after the diff, the ENGLISH the app renders is
// byte-for-byte what it rendered before. Two independent halves:
//
//   A  NO-DRIFT   every dictionary key that existed before still carries a
//                 byte-identical `en`. Catches an edit that reworded an
//                 existing string while adding neighbours.
//   C  COVERAGE   every English string that USED to be hardcoded in the nine
//                 scope files now exists, byte-identically, as some `en` in
//                 the dictionary. Catches "translated it and improved the
//                 wording while I was in there".
//   D  RESIDUE    the post-edit files contain no hardcoded English beyond an
//                 explicit allowlist. Catches a missed site, and catches a
//                 NEW English string sneaking in.
//
// Reads the dictionary through the TypeScript AST, never by importing or by
// regex: the diff under test also rewrites comments, and a comment cannot
// leak into an AST walk.
//
// Usage:  node b7-prove.mjs [path-to-i18n.ts]
//   env NC=1  → run against a scratch copy with one `en` byte corrupted.
//               The prover MUST go red. A green it cannot turn red is worse
//               than no prover at all.
import ts from "/Users/turkislimah/aquafleet-ksa/node_modules/typescript/lib/typescript.js";
import fs from "node:fs";

const ROOT = "/Users/turkislimah/aquafleet-ksa";
const BASE_EN = "/tmp/b7-base-en.txt";
const CENSUS_BASE = "/tmp/b7-census-base.json";
const CENSUS_POST = "/tmp/b7-census-post.json";
const ALLOW = "/tmp/b7-allow.txt";
const FRAG = "/tmp/b7-frag.txt";

let I18N = process.argv[2] ?? `${ROOT}/lib/i18n.ts`;

// ---- negative control -------------------------------------------------------
// Corrupt one `en` value on a scratch copy and run the REAL prover against it.
// Same code path, poisoned input — not a mocked assertion.
let ncKey = null;
if (process.env.NC) {
  const src = fs.readFileSync(I18N, "utf8");
  // Two poisons, because A and C are reachable from disjoint places: the whole
  // `drivers` namespace is NEW this batch, so nothing a Batch-7 needle touches
  // can ever move a baseline value. One poison per check:
  //
  //   A  common.actions — a pre-existing key, so rewording it IS English drift.
  //   C  drivers.commTab.filingAgainst — hosts four declared fragments, so
  //      rewording it strands all four.
  //
  // Both replacements are COMPLETE `en: "…"` literals. Truncating one instead
  // would break the leaf's parse, the key would vanish, and C would fail with
  // NO SUCH KEY — red for the wrong reason, and A would never see the value at
  // all. A poisoned dictionary has to stay a valid dictionary.
  const poisons = [
    [/actions: \{ en: "Actions"/, 'actions: { en: "Actons"'],
    [/en: "Filing against[^\n]*",/, 'en: "Bonus month differs from the lens month.",'],
  ];
  let poisoned = src;
  for (const [re, rep] of poisons) {
    if (!re.test(poisoned)) {
      console.error(`NC SETUP FAILED: anchor ${re} not found in ${I18N}`);
      process.exit(2);
    }
    poisoned = poisoned.replace(re, rep);
  }
  ncKey = "common.actions + drivers.commTab.filingAgainst";
  I18N = "/tmp/b7-i18n-nc.ts";
  fs.writeFileSync(I18N, poisoned);
}

// ---- read the dictionary ----------------------------------------------------
const src = fs.readFileSync(I18N, "utf8");
const sf = ts.createSourceFile(I18N, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

let dictObj = null;
const findDict = (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(sf) === "dict" && node.initializer) {
    let init = node.initializer;
    while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
    if (ts.isObjectLiteralExpression(init)) dictObj = init;
  }
  ts.forEachChild(node, findDict);
};
findDict(sf);
if (!dictObj) { console.error("FATAL: `dict` object literal not found"); process.exit(2); }

const propName = (p) => {
  const n = p.name;
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
  return null;
};
const litText = (e) => {
  if (!e) return null;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  return null;
};

const cur = new Map();          // path -> en
const walk = (obj, prefix) => {
  const props = obj.properties.filter(ts.isPropertyAssignment);
  const byName = new Map();
  for (const p of props) { const n = propName(p); if (n) byName.set(n, p); }
  const en = byName.get("en"), ar = byName.get("ar");
  if (en && ar && litText(en.initializer) !== null && litText(ar.initializer) !== null) {
    cur.set(prefix, litText(en.initializer));
    return;
  }
  for (const p of props) {
    const n = propName(p);
    if (n == null) continue;
    let init = p.initializer;
    while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
    if (ts.isObjectLiteralExpression(init)) walk(init, prefix ? `${prefix}.${n}` : n);
  }
};
walk(dictObj, "");

// ---- A. NO-DRIFT ------------------------------------------------------------
const base = new Map();
for (const line of fs.readFileSync(BASE_EN, "utf8").split("\n")) {
  if (!line) continue;
  const i = line.indexOf("\t");
  base.set(line.slice(0, i), line.slice(i + 1));
}

const drift = [];
const missing = [];
for (const [k, en] of base) {
  if (!cur.has(k)) { missing.push(k); continue; }
  if (cur.get(k) !== en) drift.push([k, en, cur.get(k)]);
}

// ---- C / D. COVERAGE + RESIDUE ---------------------------------------------
// Compare on the census's own normalisation (whitespace collapsed, trimmed) so
// a JSX text node that wrapped across lines still matches its dictionary twin.
// JSXText nodes carry SOURCE bytes, so `project&apos;s` in the file is what the
// census recorded — but what the browser paints is `project's`, and that is the
// thing the dictionary has to reproduce. Decode before comparing, `&amp;` last
// so `&amp;apos;` cannot round-trip into an apostrophe.
const decode = (s) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const norm = (s) => decode(s).replace(/\s+/g, " ").trim();
const enSet = new Set([...cur.values()].map(norm));
// path -> normalised en, for naming whichever key absorbed a fragment.
const enByKey = [...cur.entries()].map(([k, v]) => [k, norm(v)]);

const allow = new Set();
if (fs.existsSync(ALLOW)) {
  for (const line of fs.readFileSync(ALLOW, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    allow.add(norm(JSON.parse(t.split("\t")[0])));
  }
}

// Ruling 6 forbids fragment-splicing a count sentence, so its English lives in
// the dictionary as ONE whole sentence and the census's fragments of it can
// never match whole-string. Same for a sentence split by an inline <strong>, and
// same for a template literal, whose SOURCE the census records verbatim (slots
// spelled `${x}`, which no dictionary value spells that way).
//
// Every such string must be DECLARED in b7-frag.txt TOGETHER WITH THE KEY that
// absorbed it. Naming the key is the whole point: an earlier version searched
// the entire dictionary for anything containing the fragment, and "approved"
// matched dashboard.feed.po_approved — a green that proved nothing. An
// undeclared string may not fall through to this tier at all.
const frag = new Map();  // normalised census string -> declared key
if (fs.existsSync(FRAG)) {
  for (const line of fs.readFileSync(FRAG, "utf8").split("\n")) {
    const tt = line.trim();
    if (!tt || tt.startsWith("#")) continue;
    const cols = tt.split("\t");
    if (cols.length < 2) { console.error(`FRAG SYNTAX: no key column: ${tt.slice(0, 60)}`); process.exit(2); }
    frag.set(norm(JSON.parse(cols[0])), cols[1].trim());
  }
}

const enByKeyMap = new Map(enByKey);

// A template literal's source, minus its slots. `Pay ${a} for ${b}?` -> the
// literal chunks ["Pay ", " for ", "?"]. A dictionary value's {placeholder}
// slots split the same way, so equal chunk lists means the FIXED WORDS are
// byte-identical and only the slot syntax changed.
const isTemplateSrc = (s) => s.startsWith("`") && s.endsWith("`");
const tplChunks = (s) => s.slice(1, -1).split(/\$\{[^]*?\}/).map(norm);
const dictChunks = (s) => s.split(/\{\w+\}/).map(norm);
// Leading/trailing punctuation on a JSX fragment ("projects)", "Reason:") is the
// surrounding markup's, not the sentence's — the WORDS are what must survive.
const sepTrim = (s) => s.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "");

const censusBase = JSON.parse(fs.readFileSync(CENSUS_BASE, "utf8"));
const uncovered = [];
const absorbed = [];       // [census string, key, tier]
const declaredButLoose = [];
for (const s of Object.keys(censusBase)) {
  const n = norm(s);
  if (enSet.has(n)) continue;
  if (allow.has(n)) continue;
  if (frag.has(n)) {
    const key = frag.get(n);
    const host = enByKeyMap.get(key);
    if (host === undefined) { declaredButLoose.push([s, [`NO SUCH KEY: ${key}`]]); continue; }
    if (isTemplateSrc(s)) {
      const a = tplChunks(s), b = dictChunks(host);
      if (a.length === b.length && a.every((c, i) => c === b[i])) { absorbed.push([s, key, "TEMPLATE"]); continue; }
      // A fragment OF a template (" by ${who}") — fall to containment.
      const parts = a.filter((c) => sepTrim(c));
      if (parts.length && parts.every((c) => host.includes(sepTrim(c)))) { absorbed.push([s, key, "TEMPLATE-PART"]); continue; }
      declaredButLoose.push([s, [`chunks not in ${key}`]]);
      continue;
    }
    const w = sepTrim(n);
    if (w && host.includes(w)) { absorbed.push([s, key, "FRAGMENT"]); continue; }
    declaredButLoose.push([s, [`not inside ${key}`]]);
    continue;
  }
  uncovered.push([s, censusBase[s]]);
}

// A declared fragment whose census string no longer exists is dead weight that
// would quietly stop guarding anything — fail on it rather than let it rot.
const staleFrag = [...frag.keys()].filter((n) => !Object.keys(censusBase).some((s) => norm(s) === n));

let residue = [];
if (fs.existsSync(CENSUS_POST)) {
  const censusPost = JSON.parse(fs.readFileSync(CENSUS_POST, "utf8"));
  for (const s of Object.keys(censusPost)) {
    const n = norm(s);
    if (allow.has(n)) continue;
    residue.push([s, censusPost[s]]);
  }
}

// ---- verdict ----------------------------------------------------------------
const show = (rows, n = 25) => {
  for (const r of rows.slice(0, n)) console.log("    " + JSON.stringify(r[0]) + "   " + (Array.isArray(r[1]) ? `[${r[1].slice(0, 3).join(", ")}]` : ""));
  if (rows.length > n) console.log(`    … and ${rows.length - n} more`);
};

console.log(`dictionary: ${I18N}`);
console.log(`baseline keys: ${base.size}   current keys: ${cur.size}   new: ${cur.size - base.size}`);
if (ncKey) console.log(`NEGATIVE CONTROL ACTIVE — corrupted ${ncKey}`);
console.log("");

let red = false;

if (drift.length === 0 && missing.length === 0) {
  console.log(`A NO-DRIFT   PASS   all ${base.size} pre-existing English values byte-identical`);
} else {
  red = true;
  console.log(`A NO-DRIFT   FAIL   ${drift.length} drifted, ${missing.length} deleted`);
  for (const [k, was, now] of drift.slice(0, 10)) {
    console.log(`    ${k}`);
    console.log(`      was: ${JSON.stringify(was)}`);
    console.log(`      now: ${JSON.stringify(now)}`);
  }
  for (const k of missing.slice(0, 10)) console.log(`    DELETED ${k}`);
}

if (uncovered.length === 0 && declaredButLoose.length === 0 && staleFrag.length === 0) {
  const byTier = {};
  for (const [, , tier] of absorbed) byTier[tier] = (byTier[tier] ?? 0) + 1;
  const tiers = Object.entries(byTier).map(([k, v]) => `${v} ${k}`).join(", ");
  console.log(`C COVERAGE   PASS   all ${Object.keys(censusBase).length} pre-edit strings accounted for (${Object.keys(censusBase).length - absorbed.length - [...allow].filter((a) => Object.keys(censusBase).some((s) => norm(s) === a)).length} byte-identical, ${tiers})`);
} else {
  red = true;
  if (uncovered.length) {
    console.log(`C COVERAGE   FAIL   ${uncovered.length} of ${Object.keys(censusBase).length} pre-edit strings have no byte-identical dictionary twin and are not declared`);
    show(uncovered);
  }
  if (declaredButLoose.length) {
    console.log(`C COVERAGE   FAIL   ${declaredButLoose.length} declared fragments are not inside the key they name`);
    show(declaredButLoose);
  }
  if (staleFrag.length) {
    console.log(`C COVERAGE   FAIL   ${staleFrag.length} declared fragments no longer appear in the baseline census (dead declarations)`);
    for (const n of staleFrag.slice(0, 10)) console.log(`    ${JSON.stringify(n)}`);
  }
}
if (process.env.SHOW_FRAG && absorbed.length) {
  console.log(`  declared strings and the key that absorbed each:`);
  for (const [s, k, tier] of absorbed) console.log(`    [${tier}] ${JSON.stringify(s.slice(0, 70))}  ->  ${k}`);
}

if (!fs.existsSync(CENSUS_POST)) {
  console.log("D RESIDUE    SKIP   no post-edit census yet");
} else if (residue.length === 0) {
  console.log("D RESIDUE    PASS   no hardcoded English left in scope outside the allowlist");
} else {
  red = true;
  console.log(`D RESIDUE    FAIL   ${residue.length} hardcoded English strings remain outside the allowlist`);
  show(residue);
}

// ---- E. PLURALS -------------------------------------------------------------
// Ruling 6's mechanical half: `plural()` returns one of four buckets, so a count
// sentence that is missing a bucket renders `undefined` at 1, or 2, or 11. Every
// `.one` in the dictionary must have all three siblings, and every `plural()`
// call in scope must sit inside a `t(\`…${plural(…)}\`)` template — a `plural()`
// whose result reaches anything else is picking a fragment by hand.
const buckets = ["one", "two", "few", "many"];
const gaps = [];
for (const k of cur.keys()) {
  if (!k.endsWith(".one")) continue;
  const stem = k.slice(0, -3);   // keep the separating dot
  const missingB = buckets.filter((b) => !cur.has(stem + b));
  if (missingB.length) gaps.push(`${stem}* missing ${missingB.join(", ")}`);
}
const SCOPE = [
  "app/drivers/CommissionsTab.tsx", "app/drivers/DriversClient.tsx", "app/drivers/HistoryTab.tsx",
  "app/drivers/LeaveSection.tsx", "app/drivers/LookupSelect.tsx", "app/drivers/MechanicCommissionsSection.tsx",
  "app/drivers/PersonIdLink.tsx", "app/drivers/SalaryHistoryModal.tsx", "app/drivers/StaffTab.tsx",
  "app/drivers/page.tsx", "lib/commission-rows.ts",
];
const loosePlural = [];
for (const rel of SCOPE) {
  const text = fs.readFileSync(`${ROOT}/${rel}`, "utf8");
  text.split("\n").forEach((ln, i) => {
    // Ignore the import and the helper's own signature.
    if (/^\s*import\b/.test(ln)) return;
    for (const m of ln.matchAll(/plural\(/g)) {
      const before = ln.slice(0, m.index);
      if (/t\(`[^`]*\$\{$/.test(before)) continue;   // t(`…${plural(n)}…`, lang)
      loosePlural.push(`${rel}:${i + 1}  ${ln.trim().slice(0, 100)}`);
    }
  });
}

if (gaps.length === 0 && loosePlural.length === 0) {
  const stems = [...cur.keys()].filter((k) => k.endsWith(".one")).length;
  console.log(`E PLURALS    PASS   all ${stems} count stems carry four buckets; every plural() in scope keys a t() template`);
} else {
  red = true;
  if (gaps.length) {
    console.log(`E PLURALS    FAIL   ${gaps.length} count stems are missing a bucket`);
    for (const g of gaps.slice(0, 15)) console.log(`    ${g}`);
  }
  if (loosePlural.length) {
    console.log(`E PLURALS    FAIL   ${loosePlural.length} plural() calls do not key a t() template`);
    for (const g of loosePlural.slice(0, 15)) console.log(`    ${g}`);
  }
}

// ---- F: lookup built-ins match the seeded DB label -------------------------
// A built-in staff role / leave type used to render its `label` STRAIGHT FROM
// THE ROW. Translating it moves the English into the dictionary, so from now on
// two places spell the same string and nothing else compares them: check A only
// guards keys that already existed, and these are new. A typo here ("Paid" for
// "Paid leave") is invisible in English until someone reads the seed.
//
// Parsed from the seed migrations, not from a hand-copied list — a list I typed
// would just be a third place to get it wrong.
const seedGroups = [
  ["drivers.role", "supabase/migrations/0011_staff_roles_termination.sql", "staff_roles"],
  ["drivers.leaveType", "supabase/migrations/0012_leave.sql", "leave_types"],
];
const seedMismatch = [];
let seedChecked = 0;
for (const [prefix, file, table] of seedGroups) {
  const sql = fs.readFileSync(`${ROOT}/${file}`, "utf8");
  const block = sql.match(new RegExp(`insert into public\\.${table}[^;]*;`, "i"));
  if (!block) { seedMismatch.push(`${table}: no seed INSERT found in ${file}`); continue; }
  // ('key', 'Label', true) — built-ins only; is_default = false is a custom row
  // and deliberately NOT translated this batch.
  const rows = [...block[0].matchAll(/\(\s*'([a-z0-9_]+)'\s*,\s*'([^']*)'\s*,\s*true\s*\)/gi)];
  if (!rows.length) { seedMismatch.push(`${table}: seed INSERT parsed to zero built-in rows`); continue; }
  for (const [, key, label] of rows) {
    seedChecked++;
    const dv = cur.get(`${prefix}.${key}`);
    if (dv === undefined) seedMismatch.push(`${prefix}.${key} — seeded '${label}' but no dictionary key`);
    else if (dv !== label) seedMismatch.push(`${prefix}.${key} — seed '${label}' vs dict '${dv}'`);
  }
}
if (seedMismatch.length === 0) {
  console.log(`F LOOKUP SEED PASS   all ${seedChecked} built-in lookup labels match their seeded DB label byte-for-byte`);
} else {
  red = true;
  console.log(`F LOOKUP SEED FAIL   ${seedMismatch.length} built-in label(s) disagree with the seed`);
  for (const m of seedMismatch) console.log(`    ${m}`);
}

console.log("");
if (process.env.NC) {
  if (red) { console.log("NC VERDICT: prover went RED on poisoned input — it is capable of failing."); process.exit(0); }
  console.log("NC VERDICT: prover stayed GREEN on poisoned input — THE PROVER IS BROKEN.");
  process.exit(1);
}
console.log(red ? "VERDICT: RED" : "VERDICT: GREEN");
process.exit(red ? 1 : 0);
