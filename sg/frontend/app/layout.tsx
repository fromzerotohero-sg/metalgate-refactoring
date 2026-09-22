import type { Metadata } from "next";
import { headers } from "next/headers";
import { Manrope } from "next/font/google";
import { I18nProvider } from "@/src/lib/i18n";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-app", display: "swap" });

export const metadata: Metadata = {
  title: "From Zero To Hero | Un solo accesso, tutto il tuo ecosistema",
  description: "Il punto di ingresso centrale per le piattaforme From Zero To Hero."
};

export const viewport = { themeColor: "#081232" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Touching request headers opts every route out of static prerendering, which is
  // what a nonce-based CSP needs: a page built once at build time would carry a
  // stale nonce and its own scripts would then be blocked. Next.js takes the nonce
  // from the `Content-Security-Policy` request header that `middleware.ts` sets, so
  // there is nothing to thread down to the components.
  //
  // The cost is that pages render per request instead of being served from the
  // CDN. For a gateway whose pages are almost all auth-gated, that is the right
  // trade for not having a policy that can be bypassed with an inline script.
  await headers();

  return (
    <html lang="it" className={manrope.variable}>
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
