"use client";

export type ActiveFilter = {
  id: string;
  label: string;
  onClear: () => void;
};

export default function FilterBar({
  children,
  filters = [],
  onClearAll
}: {
  children: React.ReactNode;
  filters?: ActiveFilter[];
  onClearAll?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="admin-toolbar">{children}</div>
      {filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted">Filtri attivi</span>
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={filter.onClear}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
            >
              {filter.label}
              <span aria-hidden="true">✕</span>
            </button>
          ))}
          {onClearAll && (
            <button type="button" onClick={onClearAll} className="text-xs font-semibold text-muted underline hover:text-brand">
              Azzera tutto
            </button>
          )}
        </div>
      )}
    </div>
  );
}
