"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  adminApi,
  availableCredits,
  formatDate,
  formatEuro,
  formatNumber,
  type AdminUserDetail,
  type UserEvent
} from "@/src/lib/admin-api";
import StatCard from "@/src/components/admin/StatCard";
import GrantCreditsForm from "@/src/components/admin/GrantCreditsForm";
import DataTable, { type ColumnDef } from "@/src/components/admin/data-table";
import Badge, { VerifiedBadge, type BadgeTone } from "@/src/components/admin/badge";
import { formatRelativeTime } from "@/src/components/admin/chat/time";
import { eventLabel, platformColor, platformLabel, serviceLabel, typeLabel } from "@/src/lib/labels";
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
  { accessorKey: "type", header: "Tipo", cell: ({ row }) => typeLabel(row.original.type) },
  {
    accessorKey: "description",
    header: "Descrizione",
    enableSorting: false,
    cell: ({ row }) => (
      <>
        {row.original.description || "—"}
        {row.original.service && <span className="admin-muted"> · {serviceLabel(row.original.service)}</span>}
      </>
    )
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

function formatMetaValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// Meta di un evento in una riga sola: "chiave: valore · chiave: valore".
function metaLine(meta?: Record<string, unknown> | null): string | null {
  if (!meta) return null;
  const parts = Object.entries(meta).map(([key, value]) => `${key}: ${formatMetaValue(value)}`);
  return parts.length ? parts.join(" · ") : null;
}

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<UserEvent[]>([]);
  // `null` = caricamento in corso; `false` = endpoint/migration 009 assenti
  // (stato vuoto muted, mai un errore).
  const [eventsAvailable, setEventsAvailable] = useState<boolean | null>(null);

  const load = useCallback(() => {
    adminApi
      .userDetail(id)
      .then(setDetail)
      .catch((err) => setError(err.message ?? "Errore nel caricamento"));
  }, [id]);

  useEffect(load, [load]);

  useEffect(() => {
    adminApi
      .userEvents(id)
      .then((res) => {
        setEvents(res.events ?? []);
        setEventsAvailable(res.events_available !== false);
      })
      .catch(() => setEventsAvailable(false));
  }, [id]);

  const transactions = useMemo(() => detail?.transactions ?? [], [detail]);

  // Spese per servizio: solo crediti in uscita (amount < 0) con un servizio
  // valorizzato. Se nessuna transazione ha `service`, la card non si mostra.
  const serviceBreakdown = useMemo(() => {
    const byService = new Map<string, { credits: number; count: number }>();
    for (const tx of transactions) {
      if (!tx.service || tx.amount >= 0) continue;
      const entry = byService.get(tx.service) ?? { credits: 0, count: 0 };
      entry.credits += Math.abs(tx.amount);
      entry.count += 1;
      byService.set(tx.service, entry);
    }
    return [...byService.entries()]
      .map(([service, data]) => ({ service, ...data }))
      .sort((a, b) => b.credits - a.credits);
  }, [transactions]);

  if (error) return <p className="admin-error">{error}</p>;
  if (!detail) return <p className="admin-loading">Caricamento utente…</p>;

  const { user, stats, referred_users: referred } = detail;

  return (
    <div className="admin-page">
      <Link href="/utenti" className="admin-back">
        ← Tutti gli utenti
      </Link>

      <div className="admin-user-head">
        <h1 className="admin-title">{user.username || user.email}</h1>
        {user.tag && <span className="admin-user-tag">#{user.tag}</span>}
        <VerifiedBadge verified={user.email_verified} />
        {user.email && (
          <Link href={`/email?to=${encodeURIComponent(user.email)}`} className="btn btn-outline !px-4 !py-2 ml-auto">
            Invia email
          </Link>
        )}
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
        <h2>Cosa fa nelle app</h2>
        {eventsAvailable === null ? (
          <p className="admin-empty">Caricamento attività…</p>
        ) : eventsAvailable === false ? (
          <p className="admin-empty">La cronologia attività sarà disponibile a breve.</p>
        ) : events.length === 0 ? (
          <p className="admin-empty">
            Nessuna attività registrata dalle app — gli eventi appariranno qui quando le piattaforme li invieranno.
          </p>
        ) : (
          <ul className="admin-timeline">
            {events.map((event) => {
              const meta = metaLine(event.meta);
              return (
                <li key={event.id} className="admin-timeline-item">
                  <span
                    className="admin-timeline-dot"
                    style={{ background: platformColor(event.platform) }}
                    title={platformLabel(event.platform)}
                    aria-hidden
                  />
                  <div className="admin-timeline-body">
                    <div className="admin-timeline-row">
                      <span className="admin-timeline-label">{event.label ?? eventLabel(event.event_type)}</span>
                      <span className="admin-timeline-time">{formatRelativeTime(event.created_at)}</span>
                    </div>
                    <span className="admin-muted">{platformLabel(event.platform)}</span>
                    {meta && <p className="admin-timeline-meta">{meta}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {serviceBreakdown.length > 0 && (
        <section className="admin-card">
          <h2>Crediti per servizio</h2>
          <ul className="admin-service-rows">
            {serviceBreakdown.map((row) => (
              <li key={row.service}>
                <span className="admin-service-name">{serviceLabel(row.service)}</span>
                <span className="admin-muted">
                  — {formatNumber(row.credits)} crediti · {formatNumber(row.count)} operazioni
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
