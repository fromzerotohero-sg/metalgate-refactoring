"use client";

import { useEffect } from "react";
import { rememberReferral } from "@/src/lib/referral";

/**
 * Persists a `?ref=` code from whatever page the user landed on.
 *
 * Renders nothing. It exists because the register form is not the only way in: a
 * link that points at the home page or the pricing page would otherwise be lost
 * the moment the user navigated, and the referral would go unattributed with no
 * visible error.
 */
export function ReferralCapture() {
  useEffect(() => {
    rememberReferral();
  }, []);

  return null;
}
