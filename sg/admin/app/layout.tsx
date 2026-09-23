import type { Metadata } from "next";
import { headers } from "next/headers";
import { Manrope } from "next/font/google";
import AdminShell from "@/src/components/admin/AdminShell";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-app", display: "swap" });

export const metadata: Metadata = {
  title: "Pannello di controllo",
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: "/logo.webp", type: "image/webp" }],
    shortcut: [{ url: "/logo.webp", type: "image/webp" }],
    apple: [{ url: "/logo.webp", type: "image/webp" }]
  }
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Reading request headers makes the page dynamic, which lets Next attach the
  // per-request CSP nonce generated in middleware to its bootstrap scripts. A
  // prerendered page would carry no nonce, and `'strict-dynamic'` would then block
  // every script — the shell would render but never hydrate.
  await headers();

  return (
    <html lang="it" className={manrope.variable}>
      <body>
        <AdminShell>{children}</AdminShell>
      </body>
    </html>
  );
}
