import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { assertEnv } from "@/lib/env";

// Server-side Supabase client for Server Components, Route Handlers, and
// Server Actions. Reads/writes the auth session from request cookies.
export function createClient() {
  // WAS `process.env.X!` ON BOTH ARGUMENTS. The `!` is a TYPE assertion and
  // emits no check, so an unset var arrived here as `undefined` and
  // @supabase/ssr threw its own `Your project's URL and Key are required to
  // create a Supabase client!` — a message that names neither variable nor
  // file, raised from inside a dependency, during a Server Component render,
  // where Next redacts it in production. The operator got a blank page.
  //
  // This throws first, names the absent vars in the server log, and leaves the
  // `!` below honest: past this line both vars are known to be non-empty.
  // The screen the user sees does not come from here — `app/layout.tsx` checks
  // the same list and renders the configuration screen before any page renders.
  assertEnv();
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Called from a Server Component render in some flows, where setting
          // cookies is not allowed. Middleware refreshes the session, so we can
          // safely ignore the error here.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            /* ignore: session refresh handled by middleware */
          }
        },
      },
    },
  );
}
