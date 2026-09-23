"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  adminApi,
  availableCredits,
  formatDate,
  formatEuro,
  formatNumber,
  type AdminUserDetail
} from "@/src/lib/admin-api";
import StatCard from "@/src/components/admin/StatCard";
import GrantCreditsForm from "@/src/components/admin/GrantCreditsForm";
import DataTable, { type ColumnDef } from "@/src/components/admin/data-table";
import Badge, { VerifiedBadge, type BadgeTone } from "@/src/components/admin/badge";
import type { AdminTransaction } from "@/src/lib/admin-api";

const TX_STATUS_TONES: Record<string, BadgeTone> = {
  completed: "ok",
  succeeded: "ok",
  paid: "ok",
  pending: "warn",
  failed: "danger",
  canceled: "danger",
  refunded: "info"
};

function txStatusBadge(status?: string) {
  if (!status) return "—";
  return <Badge tone={TX_STATUS_TONES[status] ?? "neutral"}>{status}</Badge>;
}

const TX_COLUMNS: ColumnDef<AdminTransaction, unknown>[] = [
  {
    accessorKey: "timestamp",
    header: "Data",
    sortingFn: "datetime",
    cell: ({ row }) => formatDate(row.original.timestamp)
  },
  { accessorKey: "type", header: "Tipo", cell: ({ row }) => row.original.type || "—" },
  {
    accessorKey: "description",
    header: "Descrizione",
    enableSorting: false,
    cell: ({ row }) => row.original.description || "—"
  },
  {
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
    accessorKey: "status",
    header: "Stato",
    cell: ({ row }) => txStatusBadge(row.original.status)
  }
];

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    adminApi
      .userDetail(id)
      .then(setDetail)
      .catch((err) => setError(err.message ?? "Errore nel caricamento"));
  }, [id]);

  useEffect(load, [load]);

  if (error) return <p className="admin-error">{error}</p>;
  if (!detail) return <p className="admin-loading">Caricamento utente…</p>;

  const { user, transactions, stats, referred_users: referred } = detail;

  return (
    <div className="admin-page">
      <Link href="/utenti" className="admin-back">
        ← Tutti gli utenti
      </Link>

      <div className="admin-user-head">
        <h1 className="admin-title">{user.username || user.email}</h1>
        {user.tag && <span className="admin-user-tag">#{user.tag}</span>}
        <VerifiedBadge verified={user.email_verified} />
      </div>

      <div className="admin-stat-grid">
        <StatCard label="Crediti disponibili" value={formatNumber(availableCredits(user))} />
        <StatCard label="Crediti comprati" value={formatNumber(stats.total_bought)} />
        <StatCard label="Crediti spesi" value={formatNumber(stats.total_spent)} />
        <StatCard label="Revenue" value={formatEuro(stats.total_revenue)} hint={`${formatNumber(stats.transaction_count)} transazioni`} />
      </div>

      <section className="admin-card">
        <h2>Profilo</h2>
        <dl className="admin-facts">
          <div>
            <dt>Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt>Registrato</dt>
            <dd>{formatDate(user.created_at)}</dd>
          </div>
          <div>
            <dt>Ultimo login</dt>
            <dd>{formatDate(user.last_login)}</dd>
          </div>
          <div>
            <dt>Ultima attività</dt>
            <dd>{formatDate(user.last_activity_at)}</dd>
          </div>
          <div>
            <dt>Codice referral</dt>
            <dd>{user.referral_code || "—"}</dd>
          </div>
          <div>
            <dt>Cliente Stripe</dt>
            <dd>{user.stripe_customer_id || "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="admin-card">
        <h2>Accredita crediti</h2>
        <GrantCreditsForm userId={user.id} onGranted={load} />
      </section>

      <section className="admin-card">
        <h2>Transazioni</h2>
        <DataTable mode="client" columns={TX_COLUMNS} rows={transactions} perPage={10} emptyMessage="Nessuna transazione." />
      </section>

      <section className="admin-card">
        <h2>Utenti referenziati ({referred.length})</h2>
        {referred.length ? (
          <ul className="admin-referred">
            {referred.map((ref) => (
              <li key={ref.id}>
                <Link href={`/utenti/${ref.id}`}>{ref.username || ref.email}</Link>
                {ref.username && <span className="admin-muted"> {ref.email}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-empty">Nessun utente referenziato.</p>
        )}
      </section>
    </div>
  );
}
