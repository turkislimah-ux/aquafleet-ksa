import { createBrowserClient } from "@supabase/ssr";
import { assertEnv } from "@/lib/env";

// Browser-side Supabase client. Uses the public anon key only.
// Safe to import in Client Components.
export function createClient() {
  // Same reasoning as lib/supabase/server.ts: `!` emits no runtime check, so an
  // unset var reached @supabase/ssr as `undefined` and surfaced as a message
  // that names no variable. Here the throw lands in the BROWSER console rather
  // than a server log — still the difference between "which var" and nothing,
  // and `app/error.tsx` catches it into a real screen instead of a dead page.
  //
  // On this side the check is doubly worth writing out: a NEXT_PUBLIC_ var is
  // inlined into the bundle at BUILD time, so a client failing here failed when
  // it was BUILT, not when it was deployed — restarting the server changes
  // nothing. See lib/env.ts on why every read is written out literally.
  assertEnv();
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
