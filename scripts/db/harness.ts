// Shared plumbing for the scripts/db/* LIVE DATABASE harnesses.
//
// WHY THIS IS A MODULE AND NOT COPY-PASTE: the target guard below is a safety
// device. Two copies of a safety device drift, and the copy that drifts is the
// one nobody re-reads. Every harness in this directory imports this one.
//
// Nothing here opens a socket. It loads and validates the target, counts
// assertions, and holds the ONE seed precondition all three harnesses share as
// SQL TEXT for them to run on their own connection. The harnesses own the rest
// of their SQL.

import { readFileSync } from "node:fs";

export const TEST_REF = "vlyxazfinmlanjdttavg";
export const PROD_REF = "ceqzmztewbborwgxnrqh";
const ENV_FILE_DEFAULT = ".env.test.local";

export function die(msg: string): never {
  console.error("\nABORT — " + msg + "\n");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// HARD GUARD. Runs before anything opens a socket.
//
// The environment file is loaded, not trusted. Three independent strings name
// the project — the REST URL, the Postgres URI and the service-role JWT's `ref`
// claim — and this asserts all three are the TEST project and that the
// production ref appears nowhere in the file at all. A guard that checks the
// REST URL and then connects via the Postgres URI checks the wrong string.
// ---------------------------------------------------------------------------

export function loadTestEnv(envFile: string = ENV_FILE_DEFAULT): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(envFile, "utf8");
  } catch {
    return die(
      `${envFile} not found. This harness talks to the aquafleet-test project and ` +
        `will not guess a connection.`,
    );
  }

  // 0. The whole file, before parsing: the production ref must not be in it.
  if (raw.includes(PROD_REF)) {
    return die(
      `${envFile} contains the PRODUCTION project ref ${PROD_REF}. These harnesses ` +
        `write rows and allocate invoice numbers. They will not run against production.`,
    );
  }

  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }

  for (const k of ["TEST_DB_URL", "TEST_SUPABASE_URL", "TEST_SERVICE_ROLE_KEY"]) {
    if (!env[k]) return die(`${envFile} is missing ${k}.`);
  }

  // 1. The REST URL's ref.
  const urlRef = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/.exec(env.TEST_SUPABASE_URL)?.[1];
  if (urlRef !== TEST_REF) {
    return die(
      `TEST_SUPABASE_URL points at project ref "${urlRef ?? "(unparseable)"}", not the ` +
        `test project ${TEST_REF}.`,
    );
  }

  // 2. The Postgres URI's host — the string a harness actually CONNECTS to.
  //    Checking only the REST URL would leave the connection unguarded.
  let dbHost: string;
  try {
    dbHost = new URL(env.TEST_DB_URL).hostname;
  } catch {
    return die("TEST_DB_URL is not a parseable URI.");
  }
  if (!dbHost.includes(TEST_REF)) {
    return die(`TEST_DB_URL host "${dbHost}" does not name the test project ${TEST_REF}.`);
  }

  // 3. The service-role JWT's own `ref` claim. A key pasted from the wrong
  //    project is the failure mode the two URL checks cannot see.
  let jwtRef: string | undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(env.TEST_SERVICE_ROLE_KEY.split(".")[1], "base64").toString("utf8"),
    );
    jwtRef = payload.ref;
    if (payload.role !== "service_role") {
      return die(`TEST_SERVICE_ROLE_KEY carries role "${payload.role}", not service_role.`);
    }
  } catch {
    return die("TEST_SERVICE_ROLE_KEY is not a decodable JWT.");
  }
  if (jwtRef !== TEST_REF) {
    return die(`TEST_SERVICE_ROLE_KEY belongs to project ref "${jwtRef}", not ${TEST_REF}.`);
  }

  console.log(`Target guard PASSED — project ref ${TEST_REF} (aquafleet-test), host ${dbHost}.`);
  return env;
}

export function connOptions(env: Record<string, string>) {
  return { connectionString: env.TEST_DB_URL, ssl: { rejectUnauthorized: false } };
}

// ---------------------------------------------------------------------------
// SEED PRECONDITIONS — the harnesses provision their own, they do not inherit.
//
// WHY THIS EXISTS. Every harness here seeds a delivered POTABLE trip at
// manfuhah_station, because a delivered trip is the cheapest real dependency an
// invoice can hang off. 0114 put a guard on that insert: a station that prices
// one water type and not the other REFUSES the type it does not price. It has
// an escape hatch — a station with BOTH prices null is "not configured yet" and
// accepts anything — and the test project used to sit in exactly that state, so
// the harnesses passed without ever naming the precondition they relied on.
//
// Then the test project's stations gained a non-potable price and kept a null
// potable one. The hatch closed, and all three harnesses died on the seed with
// "Manfuhah Station does not fill potable water" — nothing to do with money, and
// nothing proven. Production was never affected: its Manfuhah prices potable.
//
// THE FIX IS NOT TO RE-SEED THE TEST PROJECT. That is the same bet again: it
// holds until someone edits a station in Manage stations. A harness that needs a
// precondition should CREATE it, inside the transaction it already rolls back,
// so the row it depends on is one it wrote itself and no ambient edit can move.
//
// Zero, not a real price. The guard only asks whether the figure is NOT NULL, so
// zero satisfies it while contributing nothing to any cost arithmetic — and no
// assertion in any harness reads a fill cost. Both types are set because the
// cost of covering the other one is nothing, and a harness that later seeds
// non-potable should not have to rediscover this comment.
//
// The SQL lives here rather than in three files for the reason at the top of
// this module, and it is a STRING because this module still opens no sockets:
// the harnesses run it on the connection they already have, inside their own
// begin/rollback. It must be run AFTER `begin` — run outside one it would be a
// persistent edit to the test project, which is the thing this replaces.
// ---------------------------------------------------------------------------

/** The station and water type every harness seeds with. Passed to
 *  PROVISION_STATION_SQL so the row provisioned is the row seeded. */
export const SEED_STATION = "manfuhah_station";
export const SEED_WATER_TYPE = "potable";

/** $1 = station key. Returns the row so the caller can assert the precondition
 *  actually holds — an UPDATE that matched nothing reports success otherwise. */
export const PROVISION_STATION_SQL = `
  update public.water_stations
     set fill_cost_potable_sar     = coalesce(fill_cost_potable_sar, 0),
         fill_cost_non_potable_sar = coalesce(fill_cost_non_potable_sar, 0)
   where key = $1
  returning key, fill_cost_potable_sar, fill_cost_non_potable_sar`;

// ---------------------------------------------------------------------------
// Assertion plumbing. One process per harness, so a module-level counter is
// the whole state.
// ---------------------------------------------------------------------------

let failures = 0;

export function check(label: string, actual: unknown, expected: unknown): void {
  const good = JSON.stringify(actual) === JSON.stringify(expected);
  if (!good) failures++;
  console.log(
    `${good ? "  ok  " : "  FAIL"}  ${label}` +
      (good ? "" : `\n          expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`),
  );
}

export function ok(label: string, cond: boolean): void {
  check(label, cond, true);
}

export function fail(label: string, detail: string): void {
  failures++;
  console.log(`  FAIL  ${label}\n          ${detail}`);
}

export function failureCount(): number {
  return failures;
}

// Money comes back from pg as a string. Compare at 2dp or a trailing zero
// turns an equal figure into a failed assertion.
export function money(v: unknown): number {
  return Math.round(Number(v) * 100) / 100;
}
