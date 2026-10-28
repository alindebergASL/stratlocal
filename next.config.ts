import type { NextConfig } from "next";
import { localOnly } from "./lib/localMode";

// Security headers live in deploy/Caddyfile, not here: they belong to the
// deployment, and Dasher's review found that keeping them beside the proxy
// config is what stops them from silently regressing on a redeploy.
const config: NextConfig = {
  // One self-contained server.js for the Docker image. Dasher avoided this
  // only because of its pnpm monorepo, which does not apply to a single app.
  output: "standalone",
  reactStrictMode: true,
  // The app uses no next/image, so the Image Optimization endpoint is off
  // rather than left serving a surface nobody needs (DECISIONS #81).
  images: { unoptimized: true },
  // Native / DOM-emulating packages must be required at runtime, not bundled.
  serverExternalPackages: ["better-sqlite3", "linkedom", "unpdf", "mammoth", "pptxgenjs"],
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
      // Behind a proxy, Next compares the request's Origin against its Host.
      // If Caddy forwards a Host that does not match the public name, every
      // form submit 403s while every page still renders — a first-deploy
      // failure that looks like nothing at all. APP_HOSTNAME is the name in
      // the Caddyfile; unset (local development) the list stays empty and
      // Next's own same-origin check applies unchanged.
      allowedOrigins: process.env.APP_HOSTNAME ? [process.env.APP_HOSTNAME] : [],
    },
  },
  // The one exception to "headers live in the Caddyfile", and it is not a
  // deployment concern: /s/<token> is the only page in this app that is not
  // behind a login, and it carries a customer's pipeline. Caddy already sends
  // X-Robots-Tag for every route; this is about caches. A shared link is
  // meant for one reader, and no-store is what keeps it out of an
  // intermediary's copy — and out of a browser's back-forward cache after the
  // link is revoked. Set here rather than in the proxy so it holds in local
  // development too, where the page is just as real.
  // Old addresses of places that moved (DECISIONS #105). Temporary while
  // the new places settle; each lands where its work now is.
  async redirects() {
    return [
      { source: "/plans", destination: "/inbox?kind=plan", permanent: false },
      { source: "/promises", destination: "/inbox?kind=promise", permanent: false },
      { source: "/close", destination: "/?view=close", permanent: false },
      { source: "/accounts/:id/review", destination: "/inbox?kind=changes&account=:id", permanent: false },
    ];
  },
  async headers() {
    return [
      ...(localOnly() ? [{
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      }] : []),
      {
        source: "/s/:token",
        headers: [
          { key: "Cache-Control", value: "no-store, private" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, noimageindex" },
          // Nothing on the page links out, but a print stylesheet reveals
          // source URLs and a click from there should not name where it came
          // from.
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default config;
