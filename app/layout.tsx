import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Bousla — Bin Slimah Group Operations",
  description: "Water transport & treatment operations for Bin Slimah Group",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The header's account menu shows which login you are actually on. Read
  // here rather than in the client shell because the session lives in
  // httpOnly cookies. getUser() (not getSession()) so the token is verified
  // against the auth server rather than trusted from the cookie.
  const supabase = createClient();
  const { data } = await supabase.auth.getUser();

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppShell userEmail={data.user?.email ?? null}>{children}</AppShell>
      </body>
    </html>
  );
}
