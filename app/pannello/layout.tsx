import type { Metadata } from "next";
import AdminShell from "@/src/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Pannello di controllo",
  robots: { index: false, follow: false }
};

export default function PannelloLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AdminShell>{children}</AdminShell>;
}
