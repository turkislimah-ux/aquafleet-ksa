import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    // lib/ holds shared literal-string Tailwind class tokens (e.g.
    // STAGE_STYLES in lib/db-types.ts, PILL_PALETTE in lib/project-colors.ts)
    // — without this glob, JIT never scans those files and silently drops
    // every class that doesn't ALSO happen to appear verbatim somewhere
    // under app/**/components/** (root cause of the Kanban phase colors not
    // rendering — diagnosed 2026-07-08).
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // Belt-and-suspenders for the exact Kanban STAGE_STYLES tokens (lib/db-types.ts)
  // — guarantees these specific classes are always generated even if a future
  // edit to lib/ somehow falls outside the content glob's scan. Updated for the
  // demo-pixel-match pass: column top-accent + header label (per stage), the
  // three action-button treatments, and the delivered paid chip/station chip.
  safelist: [
    "border-t-[3px]",
    "border-t-blue-500", "text-blue-700", "dark:text-blue-400", "bg-blue-500",
    "border-t-amber-500", "text-amber-700", "dark:text-amber-400", "bg-amber-500",
    "border-t-orange-600", "text-orange-900", "dark:text-orange-400", "bg-orange-600",
    "border-t-emerald-500", "text-emerald-700", "dark:text-emerald-400", "bg-emerald-500",
    "bg-emerald-500/10", "dark:text-emerald-300",
    "bg-brand-600", "hover:bg-brand-700",
    "border-amber-500", "hover:bg-amber-500/10",
    "hover:bg-emerald-600",
    "bg-brand-500/10", "border-brand-600", "dark:text-brand-300",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef9ff",
          100: "#d9f1ff",
          200: "#bae6ff",
          300: "#88d6ff",
          400: "#4ebcff",
          500: "#229dff",
          600: "#0b7eea",
          700: "#0c66bf",
          800: "#11569a",
          900: "#13497d",
          950: "#0d2c4f",
        },
        sand: {
          50: "#fbf8f1",
          100: "#f4ecd7",
          200: "#e8d6a8",
          300: "#dbbb78",
          400: "#cea255",
          500: "#bd8b3f",
          600: "#a16f33",
          700: "#83552c",
          800: "#6c4528",
          900: "#5a3a25",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      boxShadow: {
        soft: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
