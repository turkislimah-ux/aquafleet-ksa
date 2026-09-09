"use client";

import FatalScreen, { FatalLink } from "@/components/FatalScreen";
import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";

/**
 * 404. Rendered for any address that matches no route, and for any explicit
 * `notFound()` call from a page — the detail pages that resolve an id are the
 * realistic source of the second kind.
 *
 * NOT AN ERROR SCREEN, AND IT IS TONED THAT WAY ON PURPOSE. Nothing failed: a
 * link is stale or an address was mistyped. `tone="neutral"` gives it the brand
 * rule rather than the rose one, so a wrong URL does not read as an outage — the
 * distinction is the only thing this screen has to communicate.
 *
 * No "try again": retrying an address that does not exist produces this page
 * again, and offering it would be the interface lying about what it can do. The
 * one control leads somewhere real.
 *
 * Renders inside `app/layout.tsx`, so AppShell and its language context are
 * mounted and `useApp()` is the same read every other page makes.
 */
export default function NotFound() {
  const { lang } = useApp();

  return (
    <FatalScreen
      tone="neutral"
      title={t("errors.notFound.title", lang)}
      description={t("errors.notFound.body", lang)}
      actions={<FatalLink href="/">{t("errors.backToDashboard", lang)}</FatalLink>}
    />
  );
}
