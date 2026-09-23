import type { Metadata } from "next";
import { headers } from "next/headers";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-app", display: "swap" });

export const metadata: Metadata = {
  title: "Portale Streamer | From Zero To Hero",
  description: "Dashboard partner From Zero To Hero.",
};

export const viewport = { themeColor: "#081232" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Reading request headers makes the page dynamic, which lets Next attach the
  // per-request CSP nonce generated in middleware to its bootstrap scripts.
  await headers();

  return (
    <html lang="it" className={manrope.variable}>
      <body>{children}</body>
    </html>
  );
}
