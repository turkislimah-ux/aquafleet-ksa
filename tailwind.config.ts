import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
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
