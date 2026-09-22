/**
 * Security headers.
 *
 * The session cookie is scoped to `.fromzerotohero.io`, so it is sent to every
 * platform of the brand and a single script injected into ANY of them can act as
 * the user everywhere. On this origin that makes the Content-Security-Policy the
 * highest-value control in the deployment — which is also why the CSP itself is
 * NOT set here.
 *
 * A real CSP has to be built per request around a nonce, so it lives in
 * `middleware.ts`. Setting a second CSP in this file would not relax it: both
 * headers are enforced and the browser applies the intersection, so the site
 * would only ever get stricter than either one intends.
 *
 * If the nonce-based policy in `middleware.ts` ever misbehaves, delete that file
 * and add its `Policy` string to the `headers()` array below verbatim — the site
 * keeps working with a weaker (non-nonce) policy while you debug.
 */
const SECURITY_HEADERS = [
  // The API's own HSTS header covers only api.fromzerotohero.io. HSTS is
  // host-scoped, so the apex needs its own.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // `/verify-email` holds a single-use verification token in its query string, so
  // this origin must never leak its URL to another site in a Referer header.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Nothing here is meant to be embedded, and `frame-ancestors` in the CSP covers
  // modern browsers while X-Frame-Options covers the rest.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  // Do not advertise the framework version.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
