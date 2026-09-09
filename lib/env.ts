/**
 * THE VARS THE APP CANNOT RUN WITHOUT — and the one place that decides so.
 *
 * WHY THIS EXISTS. `process.env.X!` is a TYPE assertion, not a runtime one: it
 * compiles to a bare `process.env.X`, so an unset var reaches @supabase/ssr as
 * `undefined` and comes back out as `Your project's URL and Key are required to
 * create a Supabase client!` thrown from inside a dependency. That throw happens
 * during a Server Component render, where Next strips the message in production
 * and ships the browser a bare digest — the operator sees a blank document and
 * the one fact that would fix it, the var's NAME, never reaches them.
 *
 * NAMES ONLY, NEVER VALUES. What this module returns is rendered on a screen and
 * written to a server log. A required var's name is already public — it is in
 * `.env.local.example`, and it is in the list below. Its value is a credential.
 * `missingEnv()` can only ever name vars that are ABSENT, so by construction
 * there is no value present to leak; nothing here may be widened to report a var
 * that IS set, and nothing here may interpolate, truncate, or fingerprint a
 * value. Not "we remembered not to" — the shape of the return makes it so.
 *
 * EVERY READ IS WRITTEN OUT LITERALLY, AND THAT IS NOT STYLE. Next inlines
 * `process.env.NEXT_PUBLIC_*` into the client bundle by STATIC TEXT
 * SUBSTITUTION at build time. A computed read — `process.env[name]` over the
 * list — is not a literal, so it is never substituted, and it evaluates to
 * `undefined` in the browser even when the var is set. Looping over
 * `REQUIRED_ENV` here would report a correctly configured deployment as broken.
 * The list is for DISPLAY; the checks are hand-written.
 */

/** Public, safe to render. Order is the order the config screen lists them in. */
export const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

export type RequiredEnvName = (typeof REQUIRED_ENV)[number];

// Blank counts as missing. `.env.local.example` ships `PDF_API_KEY=` empty on
// purpose, so an empty string is a shape this project actually produces — and a
// Supabase client built from `""` fails exactly as one built from `undefined`
// does, just later and with a worse message.
const present = (v: string | undefined): boolean => typeof v === "string" && v.trim() !== "";

/**
 * Names of the required vars that are absent or blank.
 * Empty array means configured. Never returns a name whose var has a value.
 */
export function missingEnv(): RequiredEnvName[] {
  const out: RequiredEnvName[] = [];
  if (!present(process.env.NEXT_PUBLIC_SUPABASE_URL)) out.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!present(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) out.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return out;
}

/** True when every required var is set. */
export function isConfigured(): boolean {
  return missingEnv().length === 0;
}

/**
 * The named failure, for the paths the layout pre-check cannot cover.
 *
 * `app/layout.tsx` short-circuits to the configuration screen before any page
 * renders, so in practice nothing downstream gets the chance to fail — but
 * "in practice" is not a guarantee, and the thing this replaces was a message
 * from inside @supabase/ssr that names no variable and points at no file. This
 * one names the absent vars in the SERVER log, where the operator is looking.
 *
 * `missing` is a field, not just prose in the message, because Next redacts
 * `error.message` on a Server Component throw in production. The field survives
 * for anything reading the error server-side; the message serves the log.
 */
export class MissingEnvError extends Error {
  readonly missing: readonly RequiredEnvName[];
  constructor(missing: RequiredEnvName[]) {
    super(`Missing required environment variable(s): ${missing.join(", ")}`);
    this.name = "MissingEnvError";
    this.missing = missing;
  }
}

/** Throws `MissingEnvError` naming the absent vars. Never names a var that is set. */
export function assertEnv(): void {
  const missing = missingEnv();
  if (missing.length > 0) throw new MissingEnvError(missing);
}
