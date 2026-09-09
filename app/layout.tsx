import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import AppShell from "@/components/AppShell";
import FatalScreen, { FatalDetail } from "@/components/FatalScreen";
import { getViewer } from "@/lib/actions/identity";
import { missingEnv } from "@/lib/env";
import { t, type Lang } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Bousla — Bin Slimah Group Operations",
  description: "Water transport & treatment operations for Bin Slimah Group",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // FIRST PAINT: language and theme come from cookies, not from localStorage.
  //
  // Both preferences are client state (AppShell), and they used to reach the
  // document only after mount — the server sent lang="en" with no dir and no
  // theme class, then an effect corrected it. That is two paints: an Arabic
  // user saw the whole layout render left-to-right and mirror, and a dark-mode
  // user saw a white flash. Since Batch B moved the app to logical properties,
  // the dir flip mirrors EVERYTHING, so the flash is the full page.
  //
  // localStorage cannot fix that: it is unreadable on the server, which is why
  // the usual workaround is a blocking inline <script>. A cookie is readable
  // here, so the server renders the right thing directly and there is no
  // script and no correcting pass. AppShell writes these cookies alongside its
  // localStorage writes, so the two always agree.
  //
  // Unrecognised or absent values fall back to the same defaults AppShell used
  // before this existed: English, LTR, light.
  const jar = cookies();
  const lang: Lang = jar.get("lang")?.value === "ar" ? "ar" : "en";
  const theme: "light" | "dark" = jar.get("theme")?.value === "dark" ? "dark" : "light";

  // ── IS THIS DEPLOYMENT CONFIGURED AT ALL? ────────────────────────────────
  //
  // Checked HERE, before `getViewer()`, because getViewer() builds a Supabase
  // client and a Supabase client built from an unset var throws — from inside a
  // dependency, during a Server Component render, in the ROOT LAYOUT.
  //
  // That last part is why this is a pre-check and not a boundary. Three
  // separate things make a boundary unable to do this job:
  //   1. `app/error.tsx` does not catch a throw from `app/layout.tsx` at all.
  //      Only `app/global-error.tsx` does, and it replaces the layout wholesale.
  //   2. Next REDACTS a Server Component's error message in production and
  //      passes the client a `digest` and nothing else — so even a hand-written
  //      "NEXT_PUBLIC_SUPABASE_URL is missing" would not survive the trip to
  //      the boundary that caught it. The operator would read a random hex id.
  //   3. A boundary renders an APOLOGY. This is not a fault; it is an unfinished
  //      deployment, and the fix is a list of names the reader can act on.
  //
  // So the missing names are collected on the server, where they are known, and
  // rendered directly. NAMES ONLY — lib/env.ts can only report vars that are
  // ABSENT, so there is no value in hand to leak. The log line is the same list.
  const missing = missingEnv();
  if (missing.length > 0) {
    console.error(`[config] Missing required environment variables: ${missing.join(", ")}`);
    return (
      <html
        lang={lang}
        dir={lang === "ar" ? "rtl" : "ltr"}
        className={theme === "dark" ? "dark" : undefined}
        suppressHydrationWarning
      >
        {/* NO AppShell. Its chrome is navigation into pages that cannot load,
            and it mounts effects that reach for a Supabase client. The screen
            below is the whole document, exactly as /login is. */}
        <body>
          <FatalScreen
            tone="warn"
            title={t("errors.config.title", lang)}
            description={t("errors.config.body", lang)}
            detail={
              <FatalDetail label={t("errors.config.detailLabel", lang)}>
                {missing.map((name) => (
                  <div key={name}>{name}</div>
                ))}
              </FatalDetail>
            }
          />
        </body>
      </html>
    );
  }

  // The header's account control shows who is signed in — name and job title,
  // not just an email. Read here because the session lives in httpOnly
  // cookies; see lib/actions/identity.ts for where the name comes from.
  //
  // BELOW THE CHECK ABOVE, and that ordering is the point: this is the call
  // that used to blank the page.
  const viewer = await getViewer();

  return (
    // suppressHydrationWarning is the standard Next/React pattern for <html>
    // when its attributes are also written imperatively — AppShell's effects
    // set dir/lang and toggle the `dark` class for runtime switching, and on a
    // cookie/localStorage disagreement the reconciliation pass rewrites them
    // post-hydration. It suppresses ONE level, this element's own attributes,
    // and nothing inside <body>.
    <html
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
      className={theme === "dark" ? "dark" : undefined}
      suppressHydrationWarning
    >
      <body>
        <AppShell viewer={viewer} initialLang={lang} initialTheme={theme}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
