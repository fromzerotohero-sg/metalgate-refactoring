"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type RowData,
  type SortingState,
  type Table
} from "@tanstack/react-table";
import clsx from "clsx";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    numeric?: boolean;
  }
}

export type SortOrder = "asc" | "desc";

export type DataTableQuery = {
  page: number;
  perPage: number;
  sort?: string;
  order?: SortOrder;
};

type CommonProps<T> = {
  columns: ColumnDef<T, unknown>[];
  rows: T[];
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
};

export type ServerDataTableProps<T> = CommonProps<T> & {
  mode?: "server";
  query: DataTableQuery;
  total: number;
  pageSizeOptions?: number[];
};

export type ClientDataTableProps<T> = CommonProps<T> & {
  mode: "client";
  perPage?: number;
};

export default function DataTable<T>(props: ServerDataTableProps<T> | ClientDataTableProps<T>) {
  if (props.mode === "client") return <ClientDataTable {...props} />;
  return <ServerDataTable {...props} />;
}

function SortIndicator({ state }: { state: false | SortOrder }) {
  if (state === "asc") return <span aria-hidden="true">↑</span>;
  if (state === "desc") return <span aria-hidden="true">↓</span>;
  return <span aria-hidden="true" className="opacity-0 transition-opacity group-hover:opacity-40">↕</span>;
}

function TableView<T>({
  table,
  columnsCount,
  loading,
  error,
  emptyMessage,
  onRowClick
}: {
  table: Table<T>;
  columnsCount: number;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
}) {
  if (error) return <p className="admin-error">{error}</p>;

  const rows = table.getRowModel().rows;

  return (
    <div className={clsx("admin-table-wrap rounded-[14px] border border-line bg-white shadow-card", loading && "opacity-60")}>
      <table className="admin-table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    className={clsx(header.column.columnDef.meta?.numeric && "num")}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                  >
                    {canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="group inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <SortIndicator state={sorted} />
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columnsCount} className="!py-8 text-center text-muted">
                {loading ? "Caricamento…" : (emptyMessage ?? "Nessun risultato.")}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.id}
                className={clsx(onRowClick && "cursor-pointer")}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className={clsx(cell.column.columnDef.meta?.numeric && "num")}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function PaginationBar({
  page,
  totalPages,
  total,
  perPage,
  pageSizeOptions,
  onPageChange,
  onPerPageChange
}: {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  pageSizeOptions: number[];
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
}) {
  return (
    <div className="admin-pagination">
      <label className="inline-flex items-center gap-2">
        Righe per pagina
        <select
          className="admin-select !h-9"
          value={perPage}
          onChange={(e) => onPerPageChange(Number(e.target.value))}
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3">
        <button type="button" className="btn btn-outline !px-4 !py-2" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          ← Precedente
        </button>
        <span>
          Pagina {page} di {Math.max(totalPages, 1)} · {total} risultati
        </span>
        <button
          type="button"
          className="btn btn-outline !px-4 !py-2"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Successiva →
        </button>
      </div>
    </div>
  );
}

function ServerDataTable<T>({
  columns,
  rows,
  query,
  total,
  pageSizeOptions = [10, 20, 50],
  loading,
  error,
  emptyMessage,
  onRowClick
}: ServerDataTableProps<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(total / query.perPage));

  const updateUrl = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  const table = useReactTable({
    data: rows,
    columns,
    manualSorting: true,
    manualPagination: true,
    pageCount: totalPages,
    state: {
      sorting: query.sort ? [{ id: query.sort, desc: query.order !== "asc" }] : []
    },
    onSortingChange: (updater) => {
      const current: SortingState = query.sort ? [{ id: query.sort, desc: query.order !== "asc" }] : [];
      const next = typeof updater === "function" ? updater(current) : updater;
      const first = next[0];
      // Tri-stato: asc → desc → nessun ordinamento (rimuove i parametri dall'URL).
      if (!first) updateUrl({ sort: "", order: "", page: "" });
      else updateUrl({ sort: first.id, order: first.desc ? "desc" : "asc", page: "" });
    },
    getCoreRowModel: getCoreRowModel()
  });

  return (
    <div className="flex flex-col gap-4">
      <TableView
        table={table}
        columnsCount={columns.length}
        loading={loading}
        error={error}
        emptyMessage={emptyMessage}
        onRowClick={onRowClick}
      />
      <PaginationBar
        page={query.page}
        totalPages={totalPages}
        total={total}
        perPage={query.perPage}
        pageSizeOptions={pageSizeOptions}
        onPageChange={(page) => updateUrl({ page: String(page) })}
        onPerPageChange={(perPage) => updateUrl({ per_page: String(perPage), page: "" })}
      />
    </div>
  );
}

function ClientDataTable<T>({
  columns,
  rows,
  perPage = 10,
  loading,
  error,
  emptyMessage,
  onRowClick
}: ClientDataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: perPage } }
  });

  const { pageIndex, pageSize } = table.getState().pagination;

  return (
    <div className="flex flex-col gap-4">
      <TableView
        table={table}
        columnsCount={columns.length}
        loading={loading}
        error={error}
        emptyMessage={emptyMessage}
        onRowClick={onRowClick}
      />
      {rows.length > perPage && (
        <PaginationBar
          page={pageIndex + 1}
          totalPages={table.getPageCount()}
          total={rows.length}
          perPage={pageSize}
          pageSizeOptions={[10, 20, 50]}
          onPageChange={(page) => table.setPageIndex(page - 1)}
          onPerPageChange={(size) => table.setPageSize(size)}
        />
      )}
    </div>
  );
}

export type { ColumnDef, Row };
