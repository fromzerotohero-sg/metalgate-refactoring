"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { adminApi, type AdminUsersPage } from "@/src/lib/admin-api";
import UsersTable from "@/src/components/admin/UsersTable";
import Pagination from "@/src/components/admin/Pagination";

const STATUS_OPTIONS = [
  { value: "", label: "Tutti" },
  { value: "verified", label: "Verificati" },
  { value: "unverified", label: "Non verificati" },
  { value: "active", label: "Attivi (7gg)" },
  { value: "inactive", label: "Inattivi (30+ gg)" }
];

function UsersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const status = searchParams.get("status") ?? "";
  const search = searchParams.get("search") ?? "";

  const [searchInput, setSearchInput] = useState(search);
  const [data, setData] = useState<AdminUsersPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateQuery = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.replace(`/utenti${qs ? `?${qs}` : ""}`);
    },
    [router, searchParams]
  );

  useEffect(() => {
    setLoading(true);
    adminApi
      .users({ page, per_page: 20, search, status })
      .then(setData)
      .catch((err) => setError(err.message ?? "Errore nel caricamento"))
      .finally(() => setLoading(false));
  }, [page, search, status]);

  const onSearchChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateQuery({ search: value, page: "" }), 400);
  };

  return (
    <div className="admin-page">
      <h1 className="admin-title">Utenti</h1>

      <div className="admin-toolbar">
        <span className="field-input admin-search">
          <input
            type="search"
            placeholder="Cerca per username o email…"
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </span>
        <select className="admin-select" value={status} onChange={(e) => updateQuery({ status: e.target.value, page: "" })}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="admin-error">{error}</p>}
      {loading ? (
        <p className="admin-loading">Caricamento utenti…</p>
      ) : data ? (
        <>
          <UsersTable users={data.users} />
          <Pagination page={data.page} totalPages={data.total_pages} total={data.total} onChange={(p) => updateQuery({ page: String(p) })} />
        </>
      ) : null}
    </div>
  );
}

export default function UtentiPage() {
  return (
    <Suspense fallback={<p className="admin-loading">Caricamento…</p>}>
      <UsersPageInner />
    </Suspense>
  );
}
