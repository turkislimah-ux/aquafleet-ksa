import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { getViewer } from "@/lib/actions/identity";

export const metadata: Metadata = {
  title: "Bousla — Bin Slimah Group Operations",
  description: "Water transport & treatment operations for Bin Slimah Group",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The header's account control shows who is signed in — name and job title,
  // not just an email. Read here because the session lives in httpOnly
  // cookies; see lib/actions/identity.ts for where the name comes from.
  const viewer = await getViewer();

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppShell viewer={viewer}>{children}</AppShell>
      </body>
    </html>
  );
}
