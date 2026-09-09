"use client";

import { useEffect } from "react";
// IMPORTED HERE TOO, NOT ONLY IN app/layout.tsx. This file REPLACES the root
// layout when it renders — layout.tsx does not run, so its `import
// "./globals.css"` does not run either, and without this line the last-resort
// screen is the one screen in the app with no stylesheet. Duplicate global CSS
// imports are legal in the App Router (they are not in the Pages Router).
import "./globals.css";
import FatalScreen, { FatalDetail, FatalLink } from "@/components/FatalScreen";
import { t, type Lang } from "@/lib/i18n";

/**
 * THE LAST RESORT. The only boundary that catches a throw from the ROOT LAYOUT,
 * and the only one that has to render a whole HTML document, because when it
 * renders there is no layout above it to have rendered one.
 *
 * That makes it a genuinely hostile place to write a screen, and three things
 * follow from it rather than from taste:
 *
 *  1. NO AppShell, SO NO LANGUAGE CONTEXT. `useApp()` here does not throw — the
 *     context carries a default — it silently returns English. For an Arabic
 *     operator, on the one screen that must be understood, that is worse than an
 *     error. The language is read from the `lang` cookie directly, the same
 *     cookie AppShell writes and app/layout.tsx reads.
 *
 *  2. NO `next/link`, NO ROUTER. See FatalLink.
 *
 *  3. IT IS RARELY THE SCREEN YOU GET, AND THAT IS THE DESIGN WORKING. The
 *     realistic root-layout failure is a missing env var, and app/layout.tsx
 *     pre-checks that and renders a configuration screen with the variable names
 *     on it. This file catches what is left: an unforeseen throw, where the only
 *     honest offer is "reload, and here is the reference".
 */
export default function GlobalError({
  error,
  reset: _reset,
}: {
  error: Error & { digest?: string };
  // Next passes a reset(), but it re-renders the ROOT — the thing that just
  // failed — while reusing the same broken client runtime. A hard reload is
  // strictly the stronger recovery and there is no case where reset() succeeds
  // and it does not, so the button below reloads. Named with `_` because
  // noUnusedParameters is enforced and the signature shape has to stay (§5).
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error.digest ?? "(no digest)", error.message);
  }, [error]);

  // READ AT RENDER, NOT IN AN EFFECT, and the tradeoff is deliberate. Reading in
  // an effect would guarantee an English first paint that flips to Arabic one
  // frame later — a visible flash on every occurrence. Reading here is correct
  // immediately in the case that actually happens: a client-side throw after
  // hydration, where this component renders in the browser only and there is no
  // server HTML for it to disagree with. The remaining case — the root layout
  // failing during SSR — falls back to English for one paint, and <html> carries
  // suppressHydrationWarning exactly as app/layout.tsx's does.
  const lang: Lang = readCookie("lang") === "ar" ? "ar" : "en";
  const dark = readCookie("theme") === "dark";

  return (
    <html
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
      className={dark ? "dark" : undefined}
      suppressHydrationWarning
    >
      {/* The inline background/colour is not a duplicate of FatalScreen's — it
          is on <body>, and it is the fallback for the case this file exists to
          survive: a failure early enough that the stylesheet above never
          attached. Unstyled but legible beats a white page with black text on a
          dark-mode machine. */}
      <body style={{ background: "rgb(var(--bg))", color: "rgb(var(--fg))" }}>
        <FatalScreen
          tone="bad"
          title={t("errors.fatal.title", lang)}
          description={t("errors.fatal.body", lang)}
          detail={
            error.digest ? (
              <FatalDetail label={t("errors.referenceLabel", lang)}>{error.digest}</FatalDetail>
            ) : undefined
          }
          actions={
            <>
              {/* A native <button>, not components/ui.tsx's Btn: this screen
                  renders when the app is broken, and Btn sits behind an import
                  chain (lib/utils → clsx/tailwind-merge) that a root failure may
                  be the reason for. Classes copied from Btn variant="primary" —
                  same pairing note as FatalLink. */}
              <button
                type="button"
                autoFocus
                onClick={() => window.location.reload()}
                className="h-9 px-3 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition bg-brand-600 hover:bg-brand-700 text-white"
              >
                {t("errors.fatal.reload", lang)}
              </button>
              <FatalLink href="/">{t("errors.backToDashboard", lang)}</FatalLink>
            </>
          }
        />
      </body>
    </html>
  );
}

/**
 * The `lang`/`theme` cookies, read without `next/headers` — which is a SERVER
 * API and unavailable in a client component.
 *
 * Returns null rather than a default so both call sites keep their own fallback
 * (`"ar"` vs `"dark"` are different questions), and guards `document` because
 * this component can also render during SSR of a failed root layout.
 */
function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
