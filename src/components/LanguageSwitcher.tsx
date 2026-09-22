"use client";

import { useEffect, useRef, useState } from "react";
import { LOCALES, LOCALE_LABELS, useLocale, type Locale } from "@/src/lib/i18n";

function Flag({ locale }: { locale: Locale }) {
  if (locale === "it") {
    return (
      <svg className="flag-svg" viewBox="0 0 24 16" aria-hidden>
        <rect width="8" height="16" fill="#009246" /><rect x="8" width="8" height="16" fill="#ffffff" /><rect x="16" width="8" height="16" fill="#ce2b37" />
      </svg>
    );
  }
  if (locale === "en") {
    return (
      <svg className="flag-svg" viewBox="0 0 24 16" aria-hidden>
        <rect width="24" height="16" fill="#012169" />
        <path d="M0 0l24 16M24 0L0 16" stroke="#ffffff" strokeWidth="3.2" />
        <path d="M0 0l24 16M24 0L0 16" stroke="#c8102e" strokeWidth="1.2" />
        <path d="M12 0v16M0 8h24" stroke="#ffffff" strokeWidth="5.2" />
        <path d="M12 0v16M0 8h24" stroke="#c8102e" strokeWidth="3" />
      </svg>
    );
  }
  return (
    <svg className="flag-svg" viewBox="0 0 24 16" aria-hidden>
      <rect width="24" height="16" fill="#aa151b" /><rect y="4" width="24" height="8" fill="#f1bf00" />
    </svg>
  );
}

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
        <Flag locale={locale} />
        {LOCALE_LABELS[locale]}
        <span aria-hidden style={{ fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div className="lang-menu" role="listbox">
          {LOCALES.map((item: Locale) => (
            <button key={item} type="button" role="option" aria-selected={item === locale} className={item === locale ? "active" : ""} onClick={() => { setLocale(item); setOpen(false); }}>
              <Flag locale={item} />
              {LOCALE_LABELS[item]} — {item === "it" ? "Italiano" : item === "en" ? "English" : "Español"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
