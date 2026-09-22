"use client";

import { useState } from "react";
import { useT } from "@/src/lib/i18n";
import { Icon } from "./Icon";

export function StoreBadges() {
  const t = useT();
  const [toast, setToast] = useState(false);

  function soon(event: React.MouseEvent) {
    event.preventDefault();
    setToast(true);
    window.setTimeout(() => setToast(false), 2400);
  }

  return (
    <>
      <div className="store-badges">
        <a href="#" className="store-badge" onClick={soon} aria-disabled="true" title={t("store.soon")}>
          <Icon name="apple" size={20} />
          <span><small>{t("store.soon")}</small><strong>App Store</strong></span>
        </a>
        <a href="#" className="store-badge" onClick={soon} aria-disabled="true" title={t("store.soon")}>
          <Icon name="playStore" size={19} />
          <span><small>{t("store.soon")}</small><strong>Google Play</strong></span>
        </a>
      </div>
      {toast && <div className="toast" role="status">{t("store.soon")}</div>}
    </>
  );
}
