"use client";

export default function Pagination({
  page,
  totalPages,
  total,
  onChange
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="admin-pagination">
      <button type="button" className="btn btn-outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← Precedente
      </button>
      <span>
        Pagina {page} di {totalPages} · {total} utenti
      </span>
      <button type="button" className="btn btn-outline" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Successiva →
      </button>
    </div>
  );
}
