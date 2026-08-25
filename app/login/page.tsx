"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Btn } from "@/components/ui";
// From lib/routes rather than lib/nav: the login page has no sidebar and no
// need for twelve icon components in its bundle.
import { resolveLandingRoute } from "@/lib/routes";
import { useApp } from "@/components/AppShell";
import { t } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  // AppShell renders /login WITHOUT its chrome but WITH the context provider,
  // so this reads the same stored language every other page does. There is no
  // toggle on this screen — see the note at that early return in AppShell.
  const { lang } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // WHERE TO LAND — the user's own preference (0159), or the dashboard.
    //
    // The session exists by this point, so this select is RLS-scoped to the user
    // who just signed in. A missing row, a null column and a failed read all
    // resolve to "/" through resolveLandingRoute, which is total by construction
    // — nobody is left on the login screen because a preference could not be
    // read, and a route removed by a later release cannot 404 someone out of the
    // app at the one moment they have no way to reach Settings and fix it.
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("default_route")
      .maybeSingle();

    router.push(resolveLandingRoute(profile?.default_route ?? null));
    router.refresh();
  }

  return (
    <div className="min-h-screen grid place-items-center p-4" style={{ background: "rgb(var(--bg))" }}>
      <div className="w-full max-w-sm">
        {/* translate="no" on the WRAPPER — it inherits, and everything inside
            this block is brand: the "B" mark (a logo that happens to be a
            glyph, which a translation pass will transliterate) and the two
            name lines. Same treatment as the sidebar's header in
            components/AppShell.tsx; this is the same block, pre-login. */}
        <div translate="no" className="flex items-center gap-2 mb-6 justify-center">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 grid place-items-center text-white font-bold text-lg">B</div>
          <div>
            <div className="font-semibold text-lg leading-tight">Bousla</div>
            <div className="text-[11px] muted leading-tight">Bin Slimah Group · Operations</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 flex flex-col gap-4">
          <h1 className="text-lg font-semibold">{t("login.signIn", lang)}</h1>

          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">{t("login.email", lang)}</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
              style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">{t("login.password", lang)}</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
              style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
            />
          </label>

          {error && (
            <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
          )}

          <Btn type="submit" variant="primary" className="w-full justify-center" >
            {loading ? t("login.signingIn", lang) : t("login.signIn", lang)}
          </Btn>
        </form>
      </div>
    </div>
  );
}
