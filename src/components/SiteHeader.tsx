"use client";

import { useEffect, useState } from "react";
import { api, type SessionUser } from "@/src/lib/api";
import { isLocalPreview, previewUser, previewHref } from "@/src/lib/preview";
import { useT } from "@/src/lib/i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Icon } from "./Icon";

function initials(user: SessionUser | null) {
  return (user?.username || user?.email || "U").slice(0, 2).toUpperCase();
}

export function SiteHeader() {
  const t = useT();
  const preview = isLocalPreview();
  const [user, setUser] = useState<SessionUser | null>(preview ? previewUser : null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (preview) return;
    let active = true;
    api.session().then((session) => { if (active) setUser(session); }).catch(() => {});
    return () => { active = false; };
  }, [preview]);

  const href = (path: string) => (preview ? previewHref(path) : path);
  const navLinks = (
    <>
      <a href={href("/platforms")} onClick={() => setMenuOpen(false)}>{t("nav.platforms")}</a>
      <a href={preview ? previewHref("/") + "&scroll=how" : "/#how"} onClick={() => setMenuOpen(false)}>{t("nav.how")}</a>
      <a href={href("/pricing")} onClick={() => setMenuOpen(false)}>{t("nav.pricing")}</a>
    </>
  );

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <button type="button" className="menu-toggle" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
          <Icon name={menuOpen ? "close" : "menu"} size={22} />
        </button>
        <a className="brand" href={href("/")} aria-label="From Zero To Hero">
          <img src="/logo.webp" alt="From Zero To Hero" />
          <span className="brand-name">From Zero To Hero</span>
        </a>
        <nav className="site-nav" aria-label="Main">
          {navLinks}
        </nav>
        <div className="header-actions">
          <LanguageSwitcher />
          {user ? (
            <a className="user-chip" href={href("/account")}>
              <span className="avatar">{initials(user)}</span>
              <span className="user-chip-name">{user.username || user.email}</span>
            </a>
          ) : (
            <>
              <a className="header-login" href={href("/login")}>{t("nav.login")}</a>
              <a className="btn btn-primary header-cta" href={href("/register")}>{t("nav.start")} <span className="arrow" aria-hidden>→</span></a>
            </>
          )}
        </div>
      </div>
      {menuOpen && (
        <nav className="mobile-menu" aria-label="Mobile">
          {navLinks}
          {!user && <a href={href("/login")} onClick={() => setMenuOpen(false)}>{t("nav.login")}</a>}
        </nav>
      )}
    </header>
  );
}
