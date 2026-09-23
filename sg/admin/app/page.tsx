"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  adminApi,
  formatDate,
  formatEuro,
  formatNumber,
  type ActivityPoint,
  type AdminStats,
  type AdminTransaction,
  type StreamerListItem
} from "@/src/lib/admin-api";
import StatCard from "@/src/components/admin/StatCard";
import ActivityChart from "@/src/components/admin/ActivityChart";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default function PanoramicaPage() {
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [activity, setActivity] = useState<ActivityPoint[]>([]);
  const [transactions, setTransactions] = useState<AdminTransaction[]>([]);
  const [streamers, setStreamers] = useState<{ total: number; recent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([adminApi.stats(), adminApi.activity(30), adminApi.transactions({ limit: 10 })])
      .then(([statsRes, activityRes, txRes]) => {
        setStats(statsRes);
        setActivity(activityRes.activity);
        setTransactions(txRes.transactions);
      })
      .catch((err) => setError(err.message ?? "Errore nel caricamento"));

    // Le card streamer sono additive: un errore qui non deve bloccare la pagina.
    adminApi
      .streamers()
      .then((res) => {
        const cutoff = Date.now() - THIRTY_DAYS_MS;
        const recent = res.streamers.filter((s: StreamerListItem) => {
          const created = s.created_at ? new Date(s.created_at).getTime() : NaN;
          return !Number.isNaN(created) && created >= cutoff;
        }).length;
        setStreamers({ total: res.total, recent });
      })
      .catch(() => setStreamers(null));
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

      {streamers && (
        <div className="admin-stat-grid">
          <StatCard label="Streamer totali" value={formatNumber(streamers.total)} />
          <StatCard label="Nuovi streamer (30gg)" value={formatNumber(streamers.recent)} />
        </div>
      )}

      <section className="admin-card">
        <h2>Utenti attivi — ultimi 30 giorni</h2>
        <ActivityChart data={activity} />
      </section>

      <section className="admin-card">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="!mb-0">Attività recente</h2>
          <Link href="/transazioni" className="admin-back">
            Tutte le transazioni →
          </Link>
        </div>
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
                  <tr key={tx.id} onClick={tx.user_id ? () => router.push(`/utenti/${tx.user_id}`) : undefined}>
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
          <p className="admin-empty">Nessuna attività recente.</p>
        )}
      </section>
    </div>
  );
}
