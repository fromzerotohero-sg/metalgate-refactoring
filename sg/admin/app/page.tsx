"use client";

import { useEffect, useState } from "react";
import {
  adminApi,
  formatDate,
  formatEuro,
  formatNumber,
  type ActivityPoint,
  type AdminStats,
  type AdminTransaction
} from "@/src/lib/admin-api";
import StatCard from "@/src/components/admin/StatCard";
import ActivityChart from "@/src/components/admin/ActivityChart";

export default function PanoramicaPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [activity, setActivity] = useState<ActivityPoint[]>([]);
  const [transactions, setTransactions] = useState<AdminTransaction[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([adminApi.stats(), adminApi.activity(30), adminApi.transactions(10)])
      .then(([statsRes, activityRes, txRes]) => {
        setStats(statsRes);
        setActivity(activityRes.activity);
        setTransactions(txRes.transactions);
      })
      .catch((err) => setError(err.message ?? "Errore nel caricamento"));
  }, []);

  if (error) return <p className="admin-error">{error}</p>;
  if (!stats) return <p className="admin-loading">Caricamento dei dati…</p>;

  return (
    <div className="admin-page">
      <h1 className="admin-title">Panoramica</h1>

      <div className="admin-stat-grid">
        <StatCard label="Utenti totali" value={formatNumber(stats.total_users)} hint={`${formatNumber(stats.new_this_week)} nuovi questa settimana`} />
        <StatCard label="Attivi oggi" value={formatNumber(stats.active_today)} />
        <StatCard label="Non verificati" value={formatNumber(stats.unverified)} />
        <StatCard label="Crediti in circolo" value={formatNumber(stats.total_credits)} />
        <StatCard label="Crediti concessi" value={formatNumber(stats.total_hp_purchased)} />
        <StatCard label="Revenue stimato" value={formatEuro(stats.estimated_revenue)} />
      </div>

      <section className="admin-card">
        <h2>Utenti attivi — ultimi 30 giorni</h2>
        <ActivityChart data={activity} />
      </section>

      <section className="admin-card">
        <h2>Ultime transazioni</h2>
        {transactions.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Utente</th>
                  <th>Descrizione</th>
                  <th className="num">Importo</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>{tx.users?.username || tx.users?.email || "—"}</td>
                    <td>{tx.description || tx.type || "—"}</td>
                    <td className={`num ${tx.amount >= 0 ? "admin-pos" : "admin-neg"}`}>
                      {tx.amount >= 0 ? "+" : ""}
                      {formatNumber(tx.amount)}
                    </td>
                    <td>{formatDate(tx.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="admin-empty">Nessuna transazione recente.</p>
        )}
      </section>
    </div>
  );
}
