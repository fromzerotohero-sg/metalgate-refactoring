"use client";

import { useEffect, useState } from "react";

/**
 * Changes while the tab is open so a page can refetch.
 * The first value is 0 (the mount effect already loads). Later bumps happen
 * when the operator comes back to the tab, and once a minute while it stays visible.
 */
export function useLiveTick(intervalMs = 60_000) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((value) => value + 1);
    const onVisible = () => {
      if (document.visibilityState === "visible") bump();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") bump();
    }, intervalMs);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, [intervalMs]);

  return tick;
}
