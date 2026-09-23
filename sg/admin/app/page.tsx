"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  adminApi,
  formatEuro,
  formatNumber,
  type ActivityPoint,
  type AdminStats,
  type RevenuePoint,
  type StreamerListItem
} from "@/src/lib/admin-api";
import StatCard from "@/src/components/admin/StatCard";
import ActivityChart, { type ChartPoint } from "@/src/components/admin/ActivityChart";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

type AttentionItem = {
  href: string;
  label: string;
  count: number;
  dotClass: string;
};

function toChartPoints(activity: ActivityPoint[]): ChartPoint[] {
  return activity.map((point) => ({ date: point.date, value: point.active_users }));
}

function toRevenuePoints(revenue: RevenuePoint[]): ChartPoint[] {
  return revenue.map((point) => ({ date: point.date, value: point.revenue }));
}

export default function PanoramicaPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [activity, setActivity] = useState<ActivityPoint[]>([]);
  const [revenue, setRevenue] = useState<RevenuePoint[] | null>(null);
  const [streamers, setStreamers] = useState<{ total: number; recent: number; zeroReferrals: number } | null>(null);
  const [unverifiedOld, setUnverifiedOld] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([adminApi.stats(), adminApi.activity(30)])
      .then(([statsRes, activityRes]) => {
        setStats(statsRes);
        setActivity(activityRes.activity);
      })
      .catch((err) => setError(err.message ?? "Errore nel caricamento"));

    // Endpoint nuovi o dati additivi: un errore qui non deve bloccare la pagina.
    adminApi
      .revenue(30)
      .then((res) => setRevenue(res.revenue))
      .catch(() => setRevenue(null));

    adminApi
      .streamers()
      .then((res) => {
        const cutoff = Date.now() - THIRTY_DAYS_MS;
        const recent = res.streamers.filter((s: StreamerListItem) => {
          const created = s.created_at ? new Date(s.created_at).getTime() : NaN;
          return !Number.isNaN(created) && created >= cutoff;
        }).length;
        const zeroReferrals = res.streamers.filter((s) => (s.referred_num ?? 0) <= 0).length;
        setStreamers({ total: res.total, recent, zeroReferrals });
      })
      .catch(() => setStreamers(null));

    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString().slice(0, 10);
    adminApi
      .users({ status: "unverified", created_to: cutoff, per_page: 1 })
      .then((res) => setUnverifiedOld(res.total))
      .catch(() => setUnverifiedOld(null));
  }, []);

  if (error) return <p className="admin-error">{error}</p>;
  if (!stats) return <p className="admin-loading">Caricamento dei dati…</p>;

  const subs = stats.subscriptions;
  const attention: AttentionItem[] = [];
  if ((stats.unread_messages ?? 0) > 0) {
    attention.push({
      href: "/chat",
      label: "Messaggi chat non letti",
      count: stats.unread_messages!,
      dotClass: "bg-cyan-500"
    });
  }
  if ((subs?.past_due ?? 0) > 0) {
    attention.push({
      href: "/utenti",
      label: "Abbonamenti con pagamento fallito",
      count: subs!.past_due!,
      dotClass: "bg-red-500"
    });
  }
  if ((unverifiedOld ?? 0) > 0) {
    attention.push({
      href: "/utenti?status=unverified",
      label: "Registrati da oltre 7 giorni ancora non verificati",
      count: unverifiedOld!,
      dotClass: "bg-amber-500"
    });
  }
  if ((streamers?.zeroReferrals ?? 0) > 0) {
    attention.push({
      href: "/streamers",
      label: "Streamer senza referral",
      count: streamers!.zeroReferrals,
      dotClass: "bg-blue-500"
    });
  }

  return (
    <div className="admin-page">
      <h1 className="admin-title">Panoramica</h1>

      <div className="admin-stat-grid">
        <StatCard label="Utenti totali" value={formatNumber(stats.total_users)} hint={`${formatNumber(stats.new_this_week)} nuovi negli ultimi 7 giorni`} />
        <StatCard
          label="Login oggi"
          value={stats.logged_today != null ? formatNumber(stats.logged_today) : formatNumber(stats.active_today)}
          hint={stats.logged_today != null ? undefined : "Ultime 24 ore"}
          href="/utenti?status=today"
        />
        <StatCard
          label="Hanno speso crediti oggi"
          value={stats.users_spent_today != null ? formatNumber(stats.users_spent_today) : "—"}
          href="/transazioni"
        />
        <StatCard
          label="Abbonati attivi"
          value={subs?.total != null ? formatNumber(subs.total) : "—"}
          hint={subs ? `Lite ${formatNumber(subs.lite)} · Pro ${formatNumber(subs.pro)} · Ultra ${formatNumber(subs.ultra)}` : undefined}
        />
        <StatCard
          label="Attivazioni (30gg)"
          value={subs?.new_30d != null ? formatNumber(subs.new_30d) : "—"}
        />
        <StatCard
          label="Disdette (30gg)"
          value={subs?.canceled_30d != null ? formatNumber(subs.canceled_30d) : "—"}
        />
        <StatCard label="MRR stimato" value={stats.mrr != null ? formatEuro(stats.mrr) : "—"} />
        <StatCard label="Revenue 30 giorni" value={stats.revenue_30d != null ? formatEuro(stats.revenue_30d) : "—"} />
        <StatCard
          label="Crediti in circolo"
          value={formatNumber(stats.total_credits)}
          hint={stats.credits_spent_30d != null ? `Spesi negli ultimi 30gg: ${formatNumber(stats.credits_spent_30d)}` : undefined}
        />
        <StatCard
          label="Chat aperte"
          value={stats.open_conversations != null ? formatNumber(stats.open_conversations) : "—"}
          hint={stats.unread_messages != null ? `${formatNumber(stats.unread_messages)} messaggi non letti` : undefined}
        />
      </div>

      {streamers && (
        <div className="admin-stat-grid">
          <StatCard label="Streamer totali" value={formatNumber(streamers.total)} />
          <StatCard label="Nuovi streamer (30gg)" value={formatNumber(streamers.recent)} />
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <section className="admin-card">
          <h2>Utenti attivi — ultimi 30 giorni</h2>
          <ActivityChart
            data={toChartPoints(activity)}
            emptyMessage="Nessun dato di attività."
            ariaLabel="Utenti attivi per giorno"
            formatValue={(value) => `${formatNumber(value)} attivi`}
            legendUnit="utenti attivi in un giorno"
          />
        </section>
        <section className="admin-card">
          <h2>Revenue — ultimi 30 giorni</h2>
          {revenue ? (
            <ActivityChart
              data={toRevenuePoints(revenue)}
              emptyMessage="Nessuna revenue nel periodo."
              ariaLabel="Revenue per giorno"
              formatValue={formatEuro}
              legendUnit="di revenue in un giorno"
            />
          ) : (
            <p className="admin-empty">Dati revenue non ancora disponibili.</p>
          )}
        </section>
      </div>

      {attention.length > 0 && (
        <section className="admin-card">
          <h2>Richiede attenzione</h2>
          <ul className="flex flex-col">
            {attention.map((item) => (
              <li key={item.href + item.label}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-surface"
                >
                  <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.dotClass}`} />
                  <span className="flex-1 text-sm font-semibold text-ink">{item.label}</span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600">
                    {formatNumber(item.count)}
                  </span>
                  <span aria-hidden="true" className="text-muted">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
