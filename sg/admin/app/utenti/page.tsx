"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminApiError, adminApi, availableCredits, formatDate, formatNumber, type AdminStats, type AdminUser, type AdminUsersPage } from "@/src/lib/admin-api";
import DataTable, { type ColumnDef, type DataTableQuery, type SortOrder } from "@/src/components/admin/data-table";
import FilterBar, { type ActiveFilter } from "@/src/components/admin/filter-bar";
import { VerifiedBadge } from "@/src/components/admin/badge";
import { formatRelativeTime } from "@/src/components/admin/chat/time";

const QUICK_FILTERS: { value: string; label: string; dot: string | null }[] = [
  { value: "", label: "Tutti", dot: null },
  { value: "today", label: "Attivi oggi", dot: "bg-green-500" },
  { value: "active", label: "Attivi 7gg", dot: "bg-amber-500" },
  { value: "inactive", label: "Inattivi", dot: "bg-slate-400" },
  { value: "unverified", label: "Non verificati", dot: "bg-red-500" }
];

const DAY_MS = 24 * 60 * 60 * 1000;

function LastSeenCell({ value }: { value?: string | null }) {
  if (!value) return <span className="text-muted">—</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span className="text-muted">—</span>;
  const age = Date.now() - date.getTime();
  const dotClass =
    age < DAY_MS ? "bg-green-500 animate-pulse" : age < 7 * DAY_MS ? "bg-amber-500" : "bg-slate-300";
  const dotLabel = age < DAY_MS ? "Attivo oggi" : age < 7 * DAY_MS ? "Attivo negli ultimi 7 giorni" : "Inattivo";
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={formatDate(value)}>
      <span className={`h-2 w-2 flex-none rounded-full ${dotClass}`} role="img" aria-label={dotLabel} />
      {formatRelativeTime(value)}
    </span>
  );
}

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
    cell: ({ row }) => <LastSeenCell value={row.original.last_login} />
  },
  {
    id: "last_activity_at",
    accessorKey: "last_activity_at",
    header: "Ultima attività",
    cell: ({ row }) => <LastSeenCell value={row.original.last_activity_at} />
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [data, setData] = useState<AdminUsersPage | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
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

  // Riepilogo "attivi oggi / totali" sopra la tabella: facoltativo, se /stats
  // fallisce la riga semplicemente non compare.
  useEffect(() => {
    adminApi
      .stats()
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  const onSearchChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateQuery({ search: value, page: "" }), 400);
  };

  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const filters: ActiveFilter[] = [];
    if (search) filters.push({ id: "search", label: `Ricerca: ${search}`, onClear: () => { setSearchInput(""); updateQuery({ search: "", page: "" }); } });
    if (createdFrom) filters.push({ id: "created_from", label: `Dal: ${createdFrom}`, onClear: () => updateQuery({ created_from: "", page: "" }) });
    if (createdTo) filters.push({ id: "created_to", label: `Al: ${createdTo}`, onClear: () => updateQuery({ created_to: "", page: "" }) });
    return filters;
  }, [search, createdFrom, createdTo, updateQuery]);

  const clearAll = () => {
    setSearchInput("");
    updateQuery({ search: "", status: "", created_from: "", created_to: "", page: "" });
  };

  const advancedCount = (createdFrom ? 1 : 0) + (createdTo ? 1 : 0);

  return (
    <div className="admin-page">
      <h1 className="admin-title">Utenti</h1>

      {stats && (
        <p className="text-sm font-semibold text-muted">
          <span className="text-green-600">{formatNumber(stats.active_today)} attivi oggi</span>
          {" · "}
          {formatNumber(stats.total_users)} totali
        </p>
      )}

      <div className="card p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="field-input h-10 w-full flex-none sm:w-72">
            <svg
              className="h-4 w-4 flex-none text-muted"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="9" cy="9" r="6" />
              <path d="m13.5 13.5 3.5 3.5" />
            </svg>
            <input
              type="search"
              placeholder="Cerca per username o email…"
              value={searchInput}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </span>

          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtro per stato">
            {QUICK_FILTERS.map((filter) => {
              const selected = status === filter.value;
              return (
                <button
                  key={filter.value || "all"}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => updateQuery({ status: filter.value, page: "" })}
                  className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ${
                    selected
                      ? "border-brand bg-brand text-white shadow-sm"
                      : "border-line-strong bg-white text-ink hover:border-brand/50"
                  }`}
                >
                  {filter.dot && (
                    <span
                      className={`h-2 w-2 rounded-full ${selected ? "bg-white" : filter.dot}`}
                      aria-hidden="true"
                    />
                  )}
                  {filter.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
            className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-white px-4 text-sm font-medium text-ink transition-colors hover:border-brand/50"
          >
            Filtri avanzati
            {advancedCount > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-bold text-white">
                {advancedCount}
              </span>
            )}
            <svg
              className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m5 8 5 5 5-5" />
            </svg>
          </button>
        </div>

        {advancedOpen && (
          <div className="mt-3 border-t border-line pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="field">
                <span className="field-label">Registrato dal</span>
                <span className="field-input">
                  <input
                    type="date"
                    value={createdFrom}
                    onChange={(e) => updateQuery({ created_from: e.target.value, page: "" })}
                  />
                </span>
              </label>
              <label className="field">
                <span className="field-label">Registrato al</span>
                <span className="field-input">
                  <input
                    type="date"
                    value={createdTo}
                    onChange={(e) => updateQuery({ created_to: e.target.value, page: "" })}
                  />
                </span>
              </label>
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={clearAll}
                className="text-sm font-semibold text-muted underline hover:text-brand"
              >
                Azzera filtri
              </button>
            </div>
          </div>
        )}
      </div>

      {activeFilters.length > 0 && (
        <FilterBar filters={activeFilters} onClearAll={activeFilters.length > 1 ? clearAll : undefined} />
      )}

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
