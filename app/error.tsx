"use client";

import { useEffect } from "react";
import FatalScreen, { FatalDetail, FatalLink } from "@/components/FatalScreen";
import { Btn } from "@/components/ui";
import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";

/**
 * ROUTE-LEVEL BOUNDARY. Catches a throw from any page under `app/` — the 16
 * page.tsx files and everything they render — and replaces THAT SUBTREE only.
 *
 * WHAT IT DOES NOT CATCH, because the distinction decides whether a screen ever
 * appears: a throw from `app/layout.tsx` itself. The layout is this boundary's
 * PARENT, so a failure there takes the boundary down with it and only
 * `app/global-error.tsx` is left. That is the whole reason the missing-env check
 * is a pre-check inside the layout rather than a throw caught here.
 *
 * IT LIVES AT app/ AND NOT PER-ROUTE ON PURPOSE. One file covers all 16 routes
 * by inheritance; a per-route copy would be sixteen chances to word the same
 * failure sixteen ways. A route that later needs its own recovery — one that can
 * retry a specific fetch rather than re-render — adds its own error.tsx beside
 * its page, and Next prefers the nearer one automatically.
 *
 * AppShell IS STILL MOUNTED HERE. The layout rendered, so the sidebar, the
 * header and the language context are all present and this screen appears inside
 * the app's chrome — which is why it can read `useApp()` and why "back to
 * dashboard" is a reasonable offer rather than a guess.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { lang } = useApp();

  // Next logs this server-side already; this puts the digest in the BROWSER
  // console, which is where a support conversation actually starts ("open the
  // console and read me the reference"). `error.message` is the real message for
  // a client-side throw and a redacted placeholder for a server one — printing
  // it either way is honest, and neither is a secret the client does not have.
  useEffect(() => {
    console.error("[route-error]", error.digest ?? "(no digest)", error.message);
  }, [error]);

  return (
    <FatalScreen
      tone="bad"
      title={t("errors.route.title", lang)}
      description={t("errors.route.body", lang)}
      detail={
        // ONLY WHEN THERE IS ONE. An empty "Reference:" box is a dead end
        // dressed as a lead — the reader copies nothing and asks anyway. A
        // client-side throw has no digest at all, and that case is common.
        error.digest ? (
          <FatalDetail label={t("errors.referenceLabel", lang)}>{error.digest}</FatalDetail>
        ) : undefined
      }
      actions={
        <>
          <Btn variant="primary" onClick={reset} autoFocus>
            {t("common.tryAgain", lang)}
          </Btn>
          {/* An anchor, not next/link and not a Btn inside an anchor — see
              FatalLink's header for both reasons. A full document load is the
              point: it rebuilds the client runtime that just failed, where a
              client-side navigation would reuse it. */}
          <FatalLink href="/">{t("errors.backToDashboard", lang)}</FatalLink>
        </>
      }
    />
  );
}
