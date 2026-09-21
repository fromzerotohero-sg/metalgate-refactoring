import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "From Zero To Hero | Un solo accesso, tutto il tuo ecosistema",
  description: "Il punto di ingresso centrale per le piattaforme From Zero To Hero."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="it"><body>{children}</body></html>;
}
