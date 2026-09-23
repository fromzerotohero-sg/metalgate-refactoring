"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminApiError, adminApi, availableCredits, formatDate, formatNumber, type AdminUser, type AdminUsersPage } from "@/src/lib/admin-api";
import DataTable, { type ColumnDef, type DataTableQuery, type SortOrder } from "@/src/components/admin/data-table";
import FilterBar, { type ActiveFilter } from "@/src/components/admin/filter-bar";
import { VerifiedBadge } from "@/src/components/admin/badge";

const STATUS_OPTIONS = [
  { value: "", label: "Tutti" },
  { value: "verified", label: "Verificati" },
  { value: "unverified", label: "Non verificati" },
  { value: "active", label: "Attivi (7gg)" },
  { value: "inactive", label: "Inattivi (30+ gg)" }
];

const COLUMNS: ColumnDef<AdminUser, unknown>[] = [
  {
    id: "username",
    accessorKey: "username",
    header: "Utente",
    cell: ({ row }) => (
      <>
        <span className="admin-user-name">{row.original.username || "—"}</span>
        {row.original.tag && <span className="admin-user-tag">#{row.original.tag}</span>}
      </>
    )
  },
  { id: "email", accessorKey: "email", header: "Email" },
  {
    id: "credits_balance",
    accessorKey: "credits_balance",
    header: "Crediti",
    meta: { numeric: true },
    cell: ({ row }) => formatNumber(availableCredits(row.original))
  },
  {
    id: "status",
    header: "Stato",
    enableSorting: false,
    cell: ({ row }) => <VerifiedBadge verified={row.original.email_verified} />
  },
  {
    id: "created_at",
    accessorKey: "created_at",
    header: "Registrato il",
    cell: ({ row }) => formatDate(row.original.created_at)
  },
  {
    id: "last_login",
    accessorKey: "last_login",
    header: "Ultimo accesso",
    cell: ({ row }) => formatDate(row.original.last_login)
  }
];

function UsersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const perPage = Math.max(1, parseInt(searchParams.get("per_page") ?? "20", 10) || 20);
  const status = searchParams.get("status") ?? "";
  const search = searchParams.get("search") ?? "";
  const createdFrom = searchParams.get("created_from") ?? "";
  const createdTo = searchParams.get("created_to") ?? "";
  const sort = searchParams.get("sort") ?? undefined;
  const order: SortOrder | undefined = searchParams.get("order") === "asc" ? "asc" : sort ? "desc" : undefined;

  const query: DataTableQuery = { page, perPage, sort, order };

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
      router.replace(`/utenti${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, searchParams]
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    adminApi
      .users({ page, per_page: perPage, search, status, sort, order, created_from: createdFrom, created_to: createdTo })
      // Se il backend non riconosce ancora i parametri di ordinamento/filtro data
      // (400), riprova con la query base: l'ordinamento di default resta valido.
      .catch((err) => {
        if (err instanceof AdminApiError && err.status === 400 && (sort || createdFrom || createdTo)) {
          return adminApi.users({ page, per_page: perPage, search, status });
        }
        throw err;
      })
      .then(setData)
      .catch((err) => setError(err.message ?? "Errore nel caricamento"))
      .finally(() => setLoading(false));
  }, [page, perPage, search, status, sort, order, createdFrom, createdTo]);

  const onSearchChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateQuery({ search: value, page: "" }), 400);
  };

  const statusLabel = STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;

  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const filters: ActiveFilter[] = [];
    if (search) filters.push({ id: "search", label: `Ricerca: ${search}`, onClear: () => { setSearchInput(""); updateQuery({ search: "", page: "" }); } });
    if (status) filters.push({ id: "status", label: `Stato: ${statusLabel}`, onClear: () => updateQuery({ status: "", page: "" }) });
    if (createdFrom) filters.push({ id: "created_from", label: `Dal: ${createdFrom}`, onClear: () => updateQuery({ created_from: "", page: "" }) });
    if (createdTo) filters.push({ id: "created_to", label: `Al: ${createdTo}`, onClear: () => updateQuery({ created_to: "", page: "" }) });
    return filters;
  }, [search, status, statusLabel, createdFrom, createdTo, updateQuery]);

  const clearAll = () => {
    setSearchInput("");
    updateQuery({ search: "", status: "", created_from: "", created_to: "", page: "" });
  };

  return (
    <div className="admin-page">
      <h1 className="admin-title">Utenti</h1>

      <FilterBar filters={activeFilters} onClearAll={activeFilters.length > 1 ? clearAll : undefined}>
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
        <input
          type="date"
          className="admin-select"
          aria-label="Registrati dal"
          value={createdFrom}
          onChange={(e) => updateQuery({ created_from: e.target.value, page: "" })}
        />
        <input
          type="date"
          className="admin-select"
          aria-label="Registrati al"
          value={createdTo}
          onChange={(e) => updateQuery({ created_to: e.target.value, page: "" })}
        />
      </FilterBar>

      <DataTable
        columns={COLUMNS}
        rows={data?.users ?? []}
        total={data?.total ?? 0}
        query={query}
        loading={loading}
        error={error}
        emptyMessage="Nessun utente trovato con questi filtri."
        onRowClick={(user) => router.push(`/utenti/${user.id}`)}
      />
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
