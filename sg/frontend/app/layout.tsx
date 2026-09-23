import type { Metadata } from "next";
import { headers } from "next/headers";
import { Manrope } from "next/font/google";
import Script from "next/script";
import { I18nProvider } from "@/src/lib/i18n";
import { ReferralCapture } from "@/src/components/ReferralCapture";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-app", display: "swap" });

export const metadata: Metadata = {
  title: "From Zero To Hero | Un solo accesso, tutto il tuo ecosistema",
  description: "Il punto di ingresso centrale per le piattaforme From Zero To Hero.",
  icons: {
    icon: [{ url: "/logo.webp", type: "image/webp" }],
    shortcut: [{ url: "/logo.webp", type: "image/webp" }],
    apple: [{ url: "/logo.webp", type: "image/webp" }]
  }
};

export const viewport = { themeColor: "#081232" };

// Metricool site tag, verbatim from their dashboard (their copy percent-encodes the
// braces; this is the decoded form). It defines `loadScript`, appends their `be.js`,
// then calls `beTracker.t` once that file has loaded.
const METRICOOL_SNIPPET =
  'function loadScript(a){var b=document.getElementsByTagName("head")[0],c=document.createElement("script");c.type="text/javascript",c.src="https://tracker.metricool.com/resources/be.js",c.onreadystatechange=a,c.onload=a,b.appendChild(c)}loadScript(function(){beTracker.t({hash:"3757d452d916a0773a028d35515abf97"})});';

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Touching request headers opts every route out of static prerendering, which is
  // what a nonce-based CSP needs: a page built once at build time would carry a
  // stale nonce and its own scripts would then be blocked. Next.js takes the nonce
  // from the `Content-Security-Policy` request header that `middleware.ts` sets and
  // stamps it onto its own scripts.
  //
  // The cost is that pages render per request instead of being served from the
  // CDN. For a gateway whose pages are almost all auth-gated, that is the right
  // trade for not having a policy that can be bypassed with an inline script.
  //
  // `x-nonce` is the value `middleware.ts` put in the policy. Next stamps it onto
  // its own scripts; the tag below has to be handed it explicitly.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="it" className={manrope.variable}>
      <body>
        <I18nProvider>
          {children}
          {/*
            * Mounted here, not on /register, so that a referral link to ANY page
            * is captured before the user navigates away from it.
            */}
          <ReferralCapture />
        </I18nProvider>
        {/*
          * Metricool's site tag, on every page. It must carry this request's nonce:
          * `script-src` is `'nonce-…' 'strict-dynamic'`, so an un-nonced inline tag is
          * blocked outright, and a prerendered one would carry a stale nonce. The nonce
          * is also what lets the tag pull in `be.js` — `'strict-dynamic'` trusts what a
          * trusted script appends, so `tracker.metricool.com` never needs listing as a
          * host (and would be ignored if it were).
          */}
        <Script id="metricool" nonce={nonce} strategy="afterInteractive">
          {METRICOOL_SNIPPET}
        </Script>
      </body>
    </html>
  );
}
