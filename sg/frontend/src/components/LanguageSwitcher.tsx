"use client";

import { useEffect, useRef, useState } from "react";
import { LOCALES, LOCALE_LABELS, useLocale, type Locale } from "@/src/lib/i18n";
import { Icon } from "./Icon";

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);

  return (
    <div className="lang-switcher" ref={root}>
      <button type="button" className="lang-switcher-btn" onClick={() => setOpen((value) => !value)} aria-haspopup="listbox" aria-expanded={open}>
        <Icon name="globe" size={16} />
        {LOCALE_LABELS[locale]}
        <span aria-hidden style={{ fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div className="lang-menu" role="listbox">
          {LOCALES.map((item: Locale) => (
            <button key={item} type="button" role="option" aria-selected={item === locale} className={item === locale ? "active" : ""} onClick={() => { setLocale(item); setOpen(false); }}>
              {LOCALE_LABELS[item]} — {item === "it" ? "Italiano" : item === "en" ? "English" : "Español"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
