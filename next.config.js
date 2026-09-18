/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets a production build write somewhere OTHER than .next while `next dev`
  // keeps serving from it. Unset in every normal case, so the default is
  // unchanged — but without it, scripts/safe-build.sh's --dist-dir escape
  // hatch would silently build into .next anyway and clobber the running dev
  // server, which is the exact failure that script exists to prevent.
  // The rule, and the failure it prevents, are stated in that script's header.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverActions: {
      // Default is 1 MB, which silently rejected invoice-photo uploads at the
      // framework layer before the server action ever ran. Client pre-gates
      // (lib/upload-image.ts) keep real batches well under this.
      bodySizeLimit: "15mb",
    },
  },
};

module.exports = nextConfig;
