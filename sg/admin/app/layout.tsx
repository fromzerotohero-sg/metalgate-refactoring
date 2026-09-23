import type { Metadata } from "next";
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it" className={manrope.variable}>
      <body>
        <AdminShell>{children}</AdminShell>
      </body>
    </html>
  );
}
