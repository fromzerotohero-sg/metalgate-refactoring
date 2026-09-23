"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminProvider, useAdmin } from "@/src/lib/admin-auth";
import LoginGate from "./LoginGate";

const NAV_ITEMS = [
  { href: "/pannello", label: "Panoramica" },
  { href: "/pannello/utenti", label: "Utenti" }
];

function Shell({ children }: { children: React.ReactNode }) {
  const { status, logout } = useAdmin();
  const pathname = usePathname();

  if (status === "checking") {
    return (
      <div className="admin-gate-wrap">
        <p className="admin-loading">Caricamento…</p>
      </div>
    );
  }

  if (status === "anon") return <LoginGate />;

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <Link href="/pannello" className="admin-brand">
          <img src="/logo.webp" alt="" width={28} height={28} />
          Pannello
        </Link>
        <nav className="admin-nav">
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/pannello" ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={`admin-nav-tab${active ? " active" : ""}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button type="button" className="admin-exit" onClick={logout}>
          Esci
        </button>
      </header>
      <main className="admin-main">{children}</main>
    </div>
  );
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <AdminProvider>
      <Shell>{children}</Shell>
    </AdminProvider>
  );
}
