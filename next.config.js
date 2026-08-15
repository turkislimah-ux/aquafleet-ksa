/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets a production build write somewhere OTHER than .next while `next dev`
  // keeps serving from it. Unset in every normal case, so the default is
  // unchanged — but without it, scripts/safe-build.sh's --dist-dir escape
  // hatch would silently build into .next anyway and clobber the running dev
  // server, which is the exact failure that script exists to prevent.
  // See HANDOFF.md section 4.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

module.exports = nextConfig;
