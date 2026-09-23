import { NextRequest, NextResponse } from "next/server";

/**
 * Per-request Content-Security-Policy.
 *
 * Why a nonce and not just `'unsafe-inline'`: this origin shares its session
 * cookie with every platform of the brand, so an injected inline script here is
 * not "an XSS on one site", it is the user's SilverGate session. A policy that
 * allows inline scripts does not stop that; a nonce does, because injected markup
 * cannot know the value.
 *
 * `script-src` uses `'strict-dynamic'`, which is what lets a nonce'd bootstrap
 * script load Next.js's own chunks without listing every one of them.
 *
 * `style-src` keeps `'unsafe-inline'`: Next injects critical styles inline and
 * `next/font` emits an inline `@font-face`. Style injection cannot read a session
 * cookie or make an authenticated request, so relaxing it costs far less than
 * breaking every page's layout.
 *
 * Next.js reads the nonce out of the `Content-Security-Policy` **request** header and
 * stamps it onto its own script tags (that is why the header is set on the forwarded
 * request and not only on the response). `app/layout.tsx` then only has to touch
 * request headers, which opts every route out of static prerendering — correct for a
 * gateway whose pages are mostly auth-gated, and necessary because a page rendered
 * once at build time would carry a stale nonce and have its own scripts blocked.
 */

const API_URL_GLOBAL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://v2.fromzerotohero.io/api";

/**
 * The extra origin `connect-src` has to allow.
 *
 * A relative `NEXT_PUBLIC_API_URL` means the API is reached through this origin
 * (see the proxy in `next.config.mjs`), and `'self'` already covers it — so there
 * is no second origin to add. Deriving one by stripping `/api` off a path would
 * leave an empty string that falls back to the brand origin, silently widening the
 * policy to an origin this deployment never talks to.
 */
const API_ORIGIN = API_URL_GLOBAL.startsWith("/")
  ? ""
  : API_URL_GLOBAL.replace(/\/api\/?$/, "").replace(/\/$/, "");

/**
 * Where Metricool's site tag (see `app/layout.tsx`) reports to.
 *
 * Its own `be.js` is pulled in without a host entry: the tag that loads it carries
 * the nonce, and `'strict-dynamic'` trusts whatever a trusted script appends. What
 * does need naming is the beacon and the fallback tracking pixel, which leave this
 * origin. Wildcarded because Metricool shards across subdomains and the tag is
 * theirs to change.
 */
const METRICOOL_ORIGIN = "https://*.metricool.com";

/**
 * Where Google Tag Manager and the tags it fires report to.
 *
 * The container snippet and the `gtm.js` it appends need no `script-src` entry: the
 * snippet carries the nonce and `'strict-dynamic'` trusts what a trusted script
 * appends. What is *not* on that script graph has to be named — the `<noscript>`
 * fallback is an iframe (`frame-src`), and the container's tags report with
 * `fetch`/`sendBeacon` plus a pixel fallback (`connect-src`, `img-src`).
 *
 * The analytics host is wildcarded because GA4 shards collection across
 * `region1.`…`regionN.` subdomains. A non-Google tag added to the container later
 * needs its own host here — which is the point of writing these down.
 */
const GTM_ORIGIN = "https://www.googletagmanager.com";
const GA_ORIGIN = "https://*.google-analytics.com";

function buildPolicy(nonce: string, isDev: boolean) {
  return [
    "default-src 'self'",
    // `'unsafe-eval'` is required by the dev server's source maps and React
    // Refresh, and is never included in a production build.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // `data:` and `blob:` for inline SVG/canvas; the platform card images are
    // same-origin files under /public. Metricool may fall back to a tracking pixel,
    // and GTM's tags reach for one too when `sendBeacon` is unavailable.
    `img-src 'self' data: blob: ${METRICOOL_ORIGIN} ${GA_ORIGIN} ${GTM_ORIGIN}`,
    "font-src 'self' data:",
    // This app's own API — plus, when the API is served from this origin, nothing at
    // all — and the beacons the tags in `app/layout.tsx` write to.
    `connect-src 'self'${API_ORIGIN ? ` ${API_ORIGIN}` : ""} ${METRICOOL_ORIGIN} ${GTM_ORIGIN} ${GA_ORIGIN}`,
    // GTM's <noscript> fallback is an iframe on its own host. Declaring `frame-src`
    // drops the `default-src` fallback, so `'self'` has to be restated.
    `frame-src 'self' ${GTM_ORIGIN}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
    // Production only: this rewrites every http:// subresource to https://, which
    // in dev would rewrite requests to a plain-http API on localhost and break them.
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const isDev = process.env.NODE_ENV !== "production";
  const policy = buildPolicy(nonce, isDev);

  // Forwarded on the request so a server component can read it back.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  // Skip Next's own static assets and the favicon: they are immutable files with
  // no inline script, and running the middleware for them just adds latency.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|webp|svg|ico)$).*)"],
};
