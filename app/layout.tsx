import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { I18nProvider } from "@/src/lib/i18n";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-app", display: "swap" });

export const metadata: Metadata = {
  title: "From Zero To Hero | Un solo accesso, tutto il tuo ecosistema",
  description: "Il punto di ingresso centrale per le piattaforme From Zero To Hero."
};

export const viewport = { themeColor: "#081232" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it" className={manrope.variable}>
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
