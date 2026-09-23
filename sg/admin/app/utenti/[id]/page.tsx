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
        {user.email_verified ? <span className="admin-badge ok">Verificato</span> : <span className="admin-badge warn">Non verificato</span>}
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
        <h2>Ultime transazioni</h2>
        {transactions.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Tipo</th>
                  <th>Descrizione</th>
                  <th className="num">Importo</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>{formatDate(tx.timestamp)}</td>
                    <td>{tx.type || "—"}</td>
                    <td>{tx.description || "—"}</td>
                    <td className={`num ${tx.amount >= 0 ? "admin-pos" : "admin-neg"}`}>
                      {tx.amount >= 0 ? "+" : ""}
                      {formatNumber(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="admin-empty">Nessuna transazione.</p>
        )}
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
