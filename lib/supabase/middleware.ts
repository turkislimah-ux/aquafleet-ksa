import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
// FROM lib/routes, NOT lib/nav — and that is not interchangeable even though
// nav re-exports this function. nav.ts imports lucide-react for the sidebar
// icons, and NAV holds live references to them, so importing through it pulls
// the icon library into the EDGE bundle. Measured, not assumed: routing this
// import through nav.ts put lucide in middleware.js.
import { resolveLandingRoute } from "@/lib/routes";

// Refreshes the auth session on every request and gates access:
//  - not logged in + not on /login  -> redirect to /login
//  - logged in + on /login          -> redirect to / (dashboard)
// Returns the response carrying any refreshed Supabase auth cookies.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() validates the token with Supabase Auth on every request.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isLogin = path === "/login";

  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isLogin) {
    // The user's own landing preference (0159), same as app/login/page.tsx.
    //
    // THE QUERY IS INSIDE THIS BRANCH ON PURPOSE. This middleware runs on EVERY
    // request; a signed-in user arriving at /login is the rare case. Hoisting
    // the read above the `if` would add a database round trip to every page load
    // in the app to serve a redirect that almost never fires.
    //
    // A failed read is not a failure: resolveLandingRoute is total, so this
    // falls through to "/" rather than trapping someone on /login — which, given
    // this branch exists precisely because they are ALREADY signed in, would be
    // a redirect loop.
    let stored: string | null = null;
    let language: string | null = null;
    try {
      const { data } = await supabase
        .from("user_profiles")
        .select("default_route, preferred_language")
        .maybeSingle();
      stored = data?.default_route ?? null;
      language = data?.preferred_language ?? null;
    } catch {
      /* fall through to the dashboard */
    }

    const url = request.nextUrl.clone();
    url.pathname = resolveLandingRoute(stored);
    const redirect = NextResponse.redirect(url);

    // SEED ONLY WHEN THERE IS NOTHING TO OVERRIDE (0171).
    //
    // The account language is a LOGIN-time value, and this branch is not login —
    // it is an already-signed-in user who asked for /login, which normally means
    // a bookmark or the back button mid-session. Writing the cookie
    // unconditionally here would re-assert the account language over a header
    // toggle the user made minutes ago, which is exactly the per-account-fights-
    // per-device behaviour 0159 refused to allow.
    //
    // So it fires only when this device carries no `lang` cookie at all: a
    // cleared jar with a surviving session, where there is no device preference
    // to contradict. AppShell writes the cookie and localStorage together, so
    // the absent cookie is also the closest signal available here that the
    // client half is empty — the server cannot read localStorage to be sure, and
    // if one did survive alone, the reconciliation pass still wins as it always
    // has. A narrow seed, not a second writer.
    if (!request.cookies.has("lang") && (language === "en" || language === "ar")) {
      redirect.cookies.set("lang", language, {
        path: "/",
        maxAge: 31536000,
        sameSite: "lax",
      });
    }

    return redirect;
  }

  return supabaseResponse;
}
