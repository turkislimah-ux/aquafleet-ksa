"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Btn } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
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
    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-screen grid place-items-center p-4" style={{ background: "rgb(var(--bg))" }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6 justify-center">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 grid place-items-center text-white font-bold text-lg">B</div>
          <div>
            <div className="font-semibold text-lg leading-tight">Bousla</div>
            <div className="text-[11px] muted leading-tight">Bin Slimah Group · Operations</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 flex flex-col gap-4">
          <h1 className="text-lg font-semibold">Sign in</h1>

          <label className="flex flex-col gap-1 text-sm">
            <span className="muted">Email</span>
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
            <span className="muted">Password</span>
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
            {loading ? "Signing in…" : "Sign in"}
          </Btn>
        </form>
      </div>
    </div>
  );
}
