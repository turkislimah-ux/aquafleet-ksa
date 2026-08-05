"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Truck as TruckIcon, Users, Route, Wrench, Brain,
  Boxes, FileBarChart, Activity, Search, Bell, Sun, Moon, Globe, MapPin,
  Archive, LogOut, PackageMinus,
} from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/actions/auth";

type AppCtx = { lang: Lang; setLang: (l: Lang) => void; theme: "light" | "dark"; setTheme: (m: "light" | "dark") => void };
const Ctx = createContext<AppCtx>({ lang: "en", setLang: () => {}, theme: "light", setTheme: () => {} });
export const useApp = () => useContext(Ctx);

// Nav mirrors the demo's routes exactly (preview/app.js NAV). Fleet Detail
// (/fleet/:id) is a sub-route reached via "View", not a nav entry. `label` can
// override the i18n `key` lookup, but every key below exists in lib/i18n.ts.
const NAV = [
  { href: "/", key: "dashboard", icon: LayoutDashboard },
  { href: "/fleet", key: "fleet", icon: TruckIcon },
  { href: "/drivers", key: "drivers", icon: Users },
  { href: "/trips", key: "trips", icon: Route },
  { href: "/routes", key: "routes", icon: MapPin },
  { href: "/maintenance", key: "maintenance", icon: Wrench },
  { href: "/predictive", key: "predictive", icon: Brain },
  { href: "/iot", key: "iot", icon: Activity },
  { href: "/inventory", key: "inventory", icon: Boxes },
  { href: "/consumption", key: "consumption", icon: PackageMinus },
  { href: "/reports", key: "reports", icon: FileBarChart },
  { href: "/archive", key: "archive", icon: Archive },
] as { href: string; key?: string; label?: string; icon: typeof LayoutDashboard }[];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const pathname = usePathname();

  useEffect(() => {
    const savedLang = (typeof window !== "undefined" && localStorage.getItem("lang")) as Lang | null;
    const savedTheme = (typeof window !== "undefined" && localStorage.getItem("theme")) as "light" | "dark" | null;
    if (savedLang) setLangState(savedLang);
    if (savedTheme) setThemeState(savedTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    localStorage.setItem("lang", lang);
  }, [lang]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const setLang = (l: Lang) => setLangState(l);
  const setTheme = (m: "light" | "dark") => setThemeState(m);

  // /login renders standalone, without the app chrome.
  if (pathname === "/login") return <>{children}</>;

  return (
    <Ctx.Provider value={{ lang, setLang, theme, setTheme }}>
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className="w-64 shrink-0 border-app border-e p-4 hidden md:flex flex-col" style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}>
          <div className="flex items-center gap-2 mb-6 px-2">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 grid place-items-center text-white font-bold">B</div>
            <div>
              <div className="font-semibold leading-tight">Bousla</div>
              <div className="text-[11px] muted leading-tight">Bin Slimah Group · Operations</div>
            </div>
          </div>
          <nav className="flex flex-col gap-1">
            {NAV.map(item => {
              const Icon = item.icon;
              const active = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                    active ? "bg-brand-600 text-white shadow-soft" : "hover:bg-black/5 dark:hover:bg-white/5"
                  )}>
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label ?? t(`nav.${item.key}`, lang)}</span>
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto pt-4 text-[11px] muted px-2">
            <div>v0.1 · MVP</div>
            <div>© 2026 Bousla · Bin Slimah Group</div>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Topbar */}
          <header className="h-14 border-b flex items-center justify-between px-4 sticky top-0 z-10" style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--bg))" }}>
            <div className="flex items-center gap-3 flex-1 max-w-xl">
              <div className="relative w-full">
                <Search className="absolute top-1/2 -translate-y-1/2 h-4 w-4 muted start-3" />
                <input
                  placeholder={t("common.search", lang)}
                  className="w-full ps-9 pe-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
                  style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setLang(lang === "en" ? "ar" : "en")}
                className="h-9 px-3 rounded-lg border text-sm flex items-center gap-1.5 hover:bg-black/5 dark:hover:bg-white/5"
                style={{ borderColor: "rgb(var(--border))" }}>
                <Globe className="h-4 w-4" />
                <span className="font-medium">{lang === "en" ? "العربية" : "English"}</span>
              </button>
              <button onClick={() => setTheme(theme === "light" ? "dark" : "light")}
                className="h-9 w-9 rounded-lg border grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                style={{ borderColor: "rgb(var(--border))" }}>
                {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </button>
              <button className="h-9 w-9 rounded-lg border grid place-items-center hover:bg-black/5 dark:hover:bg-white/5 relative" style={{ borderColor: "rgb(var(--border))" }}>
                <Bell className="h-4 w-4" />
                <span className="absolute top-1.5 end-1.5 h-2 w-2 rounded-full bg-rose-500"></span>
              </button>
              <form action={signOut}>
                <button type="submit"
                  className="h-9 px-3 rounded-lg border text-sm flex items-center gap-1.5 hover:bg-black/5 dark:hover:bg-white/5"
                  style={{ borderColor: "rgb(var(--border))" }}>
                  <LogOut className="h-4 w-4" />
                  <span className="font-medium">Log out</span>
                </button>
              </form>
            </div>
          </header>

          <main className="p-4 md:p-6 flex-1 min-w-0">{children}</main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
