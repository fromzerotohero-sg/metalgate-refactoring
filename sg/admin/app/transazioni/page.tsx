"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AdminApiError,
  adminApi,
  formatDate,
  formatNumber,
  type AdminTransaction
} from "@/src/lib/admin-api";
import DataTable, { type ColumnDef, type DataTableQuery, type SortOrder } from "@/src/components/admin/data-table";
import FilterBar, { type ActiveFilter } from "@/src/components/admin/filter-bar";
import Badge, { type BadgeTone } from "@/src/components/admin/badge";

// Il backend non espone un conteggio totale né un offset: l'endpoint accetta
// solo `limit` (max 500). Si caricano fino a page*perPage righe già ordinate e
// filtrate dal server e si mostra la finestra della pagina corrente.
const MAX_FETCH = 500;

const TYPE_OPTIONS = [
  { value: "", label: "Tutti i tipi" },
  { value: "purchase", label: "Acquisto" },
  { value: "subscription_grant", label: "Abbonamento" },
  { value: "bonus", label: "Bonus" },
  { value: "deduction", label: "Addebito" },
  { value: "usage", label: "Uso" }
];

const STATUS_OPTIONS = [
  { value: "", label: "Tutti gli stati" },
  { value: "completed", label: "Completata" },
  { value: "pending", label: "In attesa" },
  { value: "failed", label: "Fallita" },
  { value: "canceled", label: "Annullata" },
  { value: "refunded", label: "Rimborsata" }
];

const STATUS_TONES: Record<string, BadgeTone> = {
  completed: "ok",
  succeeded: "ok",
  paid: "ok",
  pending: "warn",
  failed: "danger",
  canceled: "danger",
  refunded: "info"
};

const COLUMNS: ColumnDef<AdminTransaction, unknown>[] = [
  {
    id: "timestamp",
    accessorKey: "timestamp",
    header: "Data",
    cell: ({ row }) => formatDate(row.original.timestamp)
  },
  {
    id: "user",
    header: "Utente",
    enableSorting: false,
    cell: ({ row }) => row.original.users?.username || row.original.users?.email || "—"
  },
  {
    id: "type",
    accessorKey: "type",
    header: "Tipo",
    cell: ({ row }) => row.original.type || "—"
  },
  {
    id: "description",
    accessorKey: "description",
    header: "Descrizione",
    enableSorting: false,
    cell: ({ row }) => row.original.description || "—"
  },
  {
    id: "amount",
    accessorKey: "amount",
    header: "Importo",
    meta: { numeric: true },
    cell: ({ row }) => (
      <span className={row.original.amount >= 0 ? "admin-pos" : "admin-neg"}>
        {row.original.amount >= 0 ? "+" : ""}
        {formatNumber(row.original.amount)}
      </span>
    )
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Stato",
    cell: ({ row }) =>
      row.original.status ? <Badge tone={STATUS_TONES[row.original.status] ?? "neutral"}>{row.original.status}</Badge> : "—"
  }
];

function TransazioniPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const perPage = Math.max(1, parseInt(searchParams.get("per_page") ?? "20", 10) || 20);
  const type = searchParams.get("type") ?? "";
  const status = searchParams.get("status") ?? "";
  const dateFrom = searchParams.get("from") ?? "";
  const dateTo = searchParams.get("to") ?? "";
  const sort = searchParams.get("sort") ?? undefined;
  const order: SortOrder | undefined = searchParams.get("order") === "asc" ? "asc" : sort ? "desc" : undefined;

  const query: DataTableQuery = { page, perPage, sort, order };

  const [fetched, setFetched] = useState<AdminTransaction[]>([]);
  const [fetchLimit, setFetchLimit] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const updateQuery = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.replace(`/transazioni${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, searchParams]
  );

  const limit = Math.min(MAX_FETCH, page * perPage);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const base = { limit };
    adminApi
      .transactions({ ...base, sort, order, type, status, from: dateFrom, to: dateTo })
      // Se il backend non riconosce ancora ordinamento/filtri (400), riprova
      // con la query base: l'ordinamento di default resta valido.
      .catch((err) => {
        if (err instanceof AdminApiError && err.status === 400 && (sort || type || status || dateFrom || dateTo)) {
          return adminApi.transactions(base);
        }
        throw err;
      })
      .then((res) => {
        setFetched(res.transactions);
        setFetchLimit(limit);
      })
      .catch((err) => setError(err.message ?? "Errore nel caricamento"))
      .finally(() => setLoading(false));
  }, [limit, sort, order, type, status, dateFrom, dateTo]);

  const rows = useMemo(() => fetched.slice((page - 1) * perPage, page * perPage), [fetched, page, perPage]);

  // Totale: esatto quando il server ha restituito meno del limit richiesto
  // (non c'è altro da leggere) o quando la finestra corrente non è piena;
  // altrimenti si assume che esista almeno un'altra pagina. Al tetto di fetch
  // (MAX_FETCH) non si può avanzare oltre.
  const capped = fetchLimit >= MAX_FETCH && fetched.length >= MAX_FETCH;
  const total =
    fetched.length < fetchLimit
      ? fetched.length
      : capped || rows.length < perPage
        ? (page - 1) * perPage + rows.length
        : page * perPage + 1;

  const typeLabel = TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
  const statusLabel = STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;

  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const filters: ActiveFilter[] = [];
    if (type) filters.push({ id: "type", label: `Tipo: ${typeLabel}`, onClear: () => updateQuery({ type: "", page: "" }) });
    if (status) filters.push({ id: "status", label: `Stato: ${statusLabel}`, onClear: () => updateQuery({ status: "", page: "" }) });
    if (dateFrom) filters.push({ id: "from", label: `Dal: ${dateFrom}`, onClear: () => updateQuery({ from: "", page: "" }) });
    if (dateTo) filters.push({ id: "to", label: `Al: ${dateTo}`, onClear: () => updateQuery({ to: "", page: "" }) });
    return filters;
  }, [type, typeLabel, status, statusLabel, dateFrom, dateTo, updateQuery]);

  const clearAll = () => updateQuery({ type: "", status: "", from: "", to: "", page: "" });

  return (
    <div className="admin-page">
      <h1 className="admin-title">Transazioni</h1>

      <div className="card p-3 sm:p-4">
        <FilterBar filters={activeFilters} onClearAll={activeFilters.length > 1 ? clearAll : undefined}>
          <select className="admin-select" value={type} onChange={(e) => updateQuery({ type: e.target.value, page: "" })}>
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
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
            aria-label="Dal"
            value={dateFrom}
            onChange={(e) => updateQuery({ from: e.target.value, page: "" })}
          />
          <input
            type="date"
            className="admin-select"
            aria-label="Al"
            value={dateTo}
            onChange={(e) => updateQuery({ to: e.target.value, page: "" })}
          />
        </FilterBar>
      </div>

      <DataTable
        columns={COLUMNS}
        rows={rows}
        total={total}
        query={query}
        loading={loading}
        error={error}
        emptyMessage="Nessuna transazione trovata con questi filtri."
        onRowClick={(tx) => tx.user_id && router.push(`/utenti/${tx.user_id}`)}
      />

      {capped && (
        <p className="admin-muted">
          Mostrate al massimo le ultime {MAX_FETCH} transazioni: affina i filtri per vedere le più vecchie.
        </p>
      )}
    </div>
  );
}

export default function TransazioniPage() {
  return (
    <Suspense fallback={<p className="admin-loading">Caricamento…</p>}>
      <TransazioniPageInner />
    </Suspense>
  );
}
