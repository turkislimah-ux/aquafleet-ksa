import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { getViewer } from "@/lib/actions/identity";
import type { Lang } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Bousla — Bin Slimah Group Operations",
  description: "Water transport & treatment operations for Bin Slimah Group",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The header's account control shows who is signed in — name and job title,
  // not just an email. Read here because the session lives in httpOnly
  // cookies; see lib/actions/identity.ts for where the name comes from.
  const viewer = await getViewer();

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
