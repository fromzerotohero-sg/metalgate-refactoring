"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  adminApi,
  clearAdminCredentials,
  loadStoredAdminCode,
  onAdminUnauthorized,
  setAdminTotp,
  storeAdminCode
} from "./admin-api";

type AdminStatus = "checking" | "anon" | "authed";

type AdminContextValue = {
  status: AdminStatus;
  hasStoredCode: boolean;
  login: (code: string, totp: string) => Promise<void>;
  logout: () => void;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AdminStatus>("checking");
  const [hasStoredCode, setHasStoredCode] = useState(false);

  useEffect(() => {
    // Il TOTP non è persistibile (scade in 30s): ad ogni caricamento serve almeno
    // il codice authenticator. Se il codice admin è in sessionStorage il gate
    // chiede solo quello.
    setHasStoredCode(Boolean(loadStoredAdminCode()));
    setStatus("anon");
    onAdminUnauthorized(() => {
      // TOTP scaduto o rifiutato: si torna al gate mantenendo il codice admin.
      setAdminTotp(null);
      setStatus("anon");
    });
  }, []);

  const login = useCallback(async (code: string, totp: string) => {
    await adminApi.login(code, totp);
    storeAdminCode(code);
    setAdminTotp(totp || null);
    setHasStoredCode(true);
    setStatus("authed");
  }, []);

  const logout = useCallback(() => {
    clearAdminCredentials();
    setHasStoredCode(false);
    setStatus("anon");
  }, []);

  const value = useMemo(
    () => ({ status, hasStoredCode, login, logout }),
    [status, hasStoredCode, login, logout]
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const context = useContext(AdminContext);
  if (!context) throw new Error("useAdmin deve essere usato dentro AdminProvider");
  return context;
}
