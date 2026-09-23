"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  adminApi,
  clearAdminCredentials,
  loadStoredAdminCode,
  onAdminUnauthorized,
  storeAdminCode
} from "./admin-api";

type AdminStatus = "checking" | "anon" | "authed";

type AdminContextValue = {
  status: AdminStatus;
  login: (code: string) => Promise<void>;
  logout: () => void;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AdminStatus>("checking");

  useEffect(() => {
    // L'accesso è a fattore singolo (solo codice admin): se un codice è già in
    // sessionStorage si entra direttamente, così un ricaricamento non lo richiede di
    // nuovo. Non ci si fida del client — ogni endpoint ri-verifica il codice lato
    // server, e un rifiuto riporta qui al gate.
    setStatus(loadStoredAdminCode() ? "authed" : "anon");
    onAdminUnauthorized(() => {
      // Codice rifiutato (ruotato o revocato): si torna al gate per reinserirlo.
      setStatus("anon");
    });
  }, []);

  const login = useCallback(async (code: string) => {
    await adminApi.login(code);
    storeAdminCode(code);
    setStatus("authed");
  }, []);

  const logout = useCallback(() => {
    clearAdminCredentials();
    setStatus("anon");
  }, []);

  const value = useMemo(
    () => ({ status, login, logout }),
    [status, login, logout]
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const context = useContext(AdminContext);
  if (!context) throw new Error("useAdmin deve essere usato dentro AdminProvider");
  return context;
}
