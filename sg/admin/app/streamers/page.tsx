"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AdminApiError,
  adminApi,
  formatDate,
  formatEuro,
  formatNumber,
  type StreamerListItem
} from "@/src/lib/admin-api";
import DataTable, { type ColumnDef, type DataTableQuery, type SortOrder } from "@/src/components/admin/data-table";
import FilterBar, { type ActiveFilter } from "@/src/components/admin/filter-bar";
import Badge from "@/src/components/admin/badge";

const MANAGED_OPTIONS = [
  { value: "", label: "Tutti" },
  { value: "managers", label: "Manager" },
  { value: "managed", label: "Gestiti" }
];

// Ordinabili solo le colonne nella whitelist del backend
// (created_at, referred_num, total_earned, balance_available).
const COLUMNS: ColumnDef<StreamerListItem, unknown>[] = [
  {
    id: "id_code",
    accessorKey: "id_code",
    header: "Codice",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-2">
        <span className="admin-user-name">{row.original.id_code || "—"}</span>
        {row.original.is_managed ? (
          <Badge tone="info">Gestito</Badge>
        ) : (
          <Badge tone="ok">Manager</Badge>
        )}
      </span>
    )
  },
  {
    id: "manager",
    header: "Manager",
    enableSorting: false,
    cell: ({ row }) => row.original.manager_code || "—"
  },
  {
    id: "referred_num",
    accessorKey: "referred_num",
    header: "Referral diretti",
    meta: { numeric: true },
    cell: ({ row }) => formatNumber(row.original.referred_num)
  },
  {
    id: "network",
    header: "Rete",
    enableSorting: false,
    meta: { numeric: true },
    cell: ({ row }) => (
      <span>
        {formatNumber(row.original.subordinate_count)} sub-streamer
        <span className="admin-muted"> · {formatNumber(row.original.network_referred_num)} utenti</span>
      </span>
    )
  },
  {
    id: "total_earned",
    accessorKey: "total_earned",
    header: "Guadagni totali",
    meta: { numeric: true },
    cell: ({ row }) => formatEuro(row.original.total_earned)
  },
  {
    id: "balance_available",
    accessorKey: "balance_available",
    header: "Saldo disponibile",
    meta: { numeric: true },
    cell: ({ row }) => formatEuro(row.original.balance_available)
  },
  {
    id: "ai_usage",
    header: "Uso AI (30gg)",
    enableSorting: false,
    meta: { numeric: true },
    cell: ({ row }) => (
      <span>
        {formatNumber(row.original.ai_requests_30d)} req
        <span className="admin-muted"> · {formatEuro(row.original.ai_cost_30d)}</span>
      </span>
    )
  },
  {
    id: "created_at",
    accessorKey: "created_at",
    header: "Creato il",
    cell: ({ row }) => formatDate(row.original.created_at)
  }
];

function StreamersPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const perPage = Math.max(1, parseInt(searchParams.get("per_page") ?? "20", 10) || 20);
  const search = searchParams.get("search") ?? "";
  const managed = searchParams.get("managed") ?? "";
  const sort = searchParams.get("sort") ?? undefined;
  const order: SortOrder | undefined = searchParams.get("order") === "asc" ? "asc" : sort ? "desc" : undefined;

  const query: DataTableQuery = { page, perPage, sort, order };

  const [searchInput, setSearchInput] = useState(search);
  const [streamers, setStreamers] = useState<StreamerListItem[]>([]);
  const [total, setTotal] = useState(0);
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
      router.replace(`/streamers${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, searchParams]
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    const base = {
      search,
      only_managers: managed === "managers" || undefined,
      only_managed: managed === "managed" || undefined
    };
    adminApi
      .streamers({ ...base, sort, order })
      // Se il backend non riconosce ancora i parametri di ordinamento (400),
      // riprova con la query base: l'ordinamento di default resta valido.
      .catch((err) => {
        if (err instanceof AdminApiError && err.status === 400 && sort) {
          return adminApi.streamers(base);
        }
        throw err;
      })
      .then((res) => {
        setStreamers(res.streamers);
        setTotal(res.total);
      })
      .catch((err) => setError(err.message ?? "Errore nel caricamento"))
      .finally(() => setLoading(false));
  }, [search, managed, sort, order]);

  // L'endpoint restituisce la lista completa già ordinata/filtrata dal server:
  // la paginazione è una vista sulla lista caricata.
  const pageRows = useMemo(() => streamers.slice((page - 1) * perPage, page * perPage), [streamers, page, perPage]);

  const onSearchChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateQuery({ search: value, page: "" }), 400);
  };

  const managedLabel = MANAGED_OPTIONS.find((option) => option.value === managed)?.label ?? managed;

  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const filters: ActiveFilter[] = [];
    if (search) filters.push({ id: "search", label: `Ricerca: ${search}`, onClear: () => { setSearchInput(""); updateQuery({ search: "", page: "" }); } });
    if (managed) filters.push({ id: "managed", label: `Gestione: ${managedLabel}`, onClear: () => updateQuery({ managed: "", page: "" }) });
    return filters;
  }, [search, managed, managedLabel, updateQuery]);

  const clearAll = () => {
    setSearchInput("");
    updateQuery({ search: "", managed: "", page: "" });
  };

  return (
    <div className="admin-page">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="admin-title">Streamer</h1>
        <Link href="/streamers/nuovo" className="btn btn-primary">
          + Nuovo streamer
        </Link>
      </div>

      <FilterBar filters={activeFilters} onClearAll={activeFilters.length > 1 ? clearAll : undefined}>
        <span className="field-input admin-search">
          <input
            type="search"
            placeholder="Cerca per codice…"
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </span>
        <select className="admin-select" value={managed} onChange={(e) => updateQuery({ managed: e.target.value, page: "" })}>
          {MANAGED_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FilterBar>

      <DataTable
        columns={COLUMNS}
        rows={pageRows}
        total={total}
        query={query}
        loading={loading}
        error={error}
        emptyMessage="Nessuno streamer trovato con questi filtri."
        onRowClick={(streamer) => router.push(`/streamers/${streamer.streamer_id}`)}
      />
    </div>
  );
}

export default function StreamersPage() {
  return (
    <Suspense fallback={<p className="admin-loading">Caricamento…</p>}>
      <StreamersPageInner />
    </Suspense>
  );
}
