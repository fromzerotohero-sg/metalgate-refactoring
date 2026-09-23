"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminProvider, useAdmin } from "@/src/lib/admin-auth";
import { adminChatApi } from "@/src/lib/admin-chat-api";
import LoginGate from "./LoginGate";
import { ToastProvider } from "./toast";

const NAV_ITEMS = [
  { href: "/", label: "Panoramica" },
  { href: "/utenti", label: "Utenti" },
  { href: "/streamers", label: "Streamer" },
  { href: "/transazioni", label: "Transazioni" },
  { href: "/chat", label: "Chat" },
  { href: "/email", label: "Email" }
];

function ChatUnreadBadge() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (document.hidden) return;
      adminChatApi
        .unreadCount()
        .then((data) => {
          if (!stopped) setUnread(data.unread);
        })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  if (unread <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-bold leading-none text-navy-900">
      {unread > 99 ? "99+" : unread}
    </span>
  );
}

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
        <Link href="/" className="admin-brand">
          <img src="/logo.webp" alt="" width={28} height={28} />
          Pannello
        </Link>
        <nav className="admin-nav">
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/" ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={`admin-nav-tab${active ? " active" : ""}`}>
                {item.label}
                {item.href === "/chat" && <ChatUnreadBadge />}
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
      <ToastProvider>
        <Shell>{children}</Shell>
      </ToastProvider>
    </AdminProvider>
  );
}
