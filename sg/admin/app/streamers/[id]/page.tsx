"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AdminApiError,
  adminApi,
  formatDate,
  formatEuro,
  formatNumber,
  type AdminTransaction,
  type AiStreamerUsage,
  type StreamerDetail,
  type StreamerNetworkUser,
  type StreamerSummary
} from "@/src/lib/admin-api";
import StatCard from "@/src/components/admin/StatCard";
import DataTable, { type ColumnDef } from "@/src/components/admin/data-table";
import Badge, { type BadgeTone } from "@/src/components/admin/badge";
import { useToast } from "@/src/components/admin/toast";

const TX_STATUS_TONES: Record<string, BadgeTone> = {
  completed: "ok",
  succeeded: "ok",
  paid: "ok",
  pending: "warn",
  failed: "danger",
  canceled: "danger",
  refunded: "info"
};

const SUB_COLUMNS: ColumnDef<StreamerSummary, unknown>[] = [
  {
    accessorKey: "id_code",
    header: "Codice",
    enableSorting: false,
    cell: ({ row }) => <span className="admin-user-name">{row.original.id_code || `#${row.original.id}`}</span>
  },
  {
    accessorKey: "referred_num",
    header: "Referral",
    meta: { numeric: true },
    cell: ({ row }) => formatNumber(row.original.referred_num)
  },
  {
    accessorKey: "total_earned",
    header: "Guadagni",
    meta: { numeric: true },
    cell: ({ row }) => formatEuro(row.original.total_earned)
  },
  {
    accessorKey: "balance_available",
    header: "Saldo",
    meta: { numeric: true },
    cell: ({ row }) => formatEuro(row.original.balance_available)
  },
  {
    accessorKey: "created_at",
    header: "Creato il",
    sortingFn: "datetime",
    cell: ({ row }) => formatDate(row.original.created_at)
  }
];

const USER_COLUMNS: ColumnDef<StreamerNetworkUser, unknown>[] = [
  {
    accessorKey: "username",
    header: "Utente",
    cell: ({ row }) => <span className="admin-user-name">{row.original.username || row.original.email || "—"}</span>
  },
  { accessorKey: "email", header: "Email", cell: ({ row }) => row.original.email || "—" },
  {
    accessorKey: "streamer_code",
    header: "Portato da",
    cell: ({ row }) => row.original.streamer_code || "—"
  },
  {
    accessorKey: "euros_spent",
    header: "Euro spesi",
    meta: { numeric: true },
    cell: ({ row }) => formatEuro(row.original.euros_spent)
  },
  {
    accessorKey: "credits_balance",
    header: "Saldo crediti",
    meta: { numeric: true },
    cell: ({ row }) => formatNumber(row.original.credits_balance)
  },
  {
    accessorKey: "last_active",
    header: "Ultima attività",
    sortingFn: "datetime",
    cell: ({ row }) => formatDate(row.original.last_active)
  }
];

const TX_COLUMNS: ColumnDef<AdminTransaction, unknown>[] = [
  {
    accessorKey: "timestamp",
    header: "Data",
    sortingFn: "datetime",
    cell: ({ row }) => formatDate(row.original.timestamp)
  },
  {
    accessorKey: "user",
    header: "Utente",
    enableSorting: false,
    cell: ({ row }) => row.original.users?.username || row.original.users?.email || "—"
  },
  { accessorKey: "type", header: "Tipo", cell: ({ row }) => row.original.type || "—" },
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
    cell: ({ row }) =>
      row.original.status ? <Badge tone={TX_STATUS_TONES[row.original.status] ?? "neutral"}>{row.original.status}</Badge> : "—"
  }
];

export default function StreamerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const id = params.id;

  const [detail, setDetail] = useState<StreamerDetail | null>(null);
  const [aiUsage, setAiUsage] = useState<AiStreamerUsage | null>(null);
  const [transactions, setTransactions] = useState<AdminTransaction[]>([]);
  const [txError, setTxError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [managerCode, setManagerCode] = useState("");
  const [managerBusy, setManagerBusy] = useState(false);

  const load = useCallback(() => {
    adminApi
      .streamerDetail(id, { users_per_page: 1000, subordinates_per_page: 1000 })
      .then(setDetail)
      .catch((err) => setError(err.message ?? "Errore nel caricamento"));
  }, [id]);

  useEffect(load, [load]);

  // Statistiche AI complessive dello streamer (endpoint aggregato separato).
  useEffect(() => {
    adminApi
      .aiByStreamer()
      .then((res) => setAiUsage(res.by_streamer.find((entry) => String(entry.streamer_id) === String(id)) ?? null))
      .catch(() => setAiUsage(null));
  }, [id]);

  // Transazioni recenti della rete: il ledger non è filtrabile per streamer,
  // quindi si filtrano le ultime transazioni sugli utenti del ramo.
  useEffect(() => {
    if (!detail) return;
    const branchUsers = new Set(detail.users.map((user) => String(user.id)));
    adminApi
      .transactions({ limit: 500, sort: "timestamp", order: "desc" })
      .then((res) => setTransactions(res.transactions.filter((tx) => tx.user_id && branchUsers.has(String(tx.user_id)))))
      .catch((err) => setTxError(err.message ?? "Errore nel caricamento delle transazioni"));
  }, [detail]);

  const assignManager = async (code: string) => {
    setManagerBusy(true);
    try {
      const res = await adminApi.assignManager(id, code);
      toast.success(res.manager_code ? `Manager assegnato: ${res.manager_code}` : "Manager rimosso.");
      setManagerCode("");
      load();
    } catch (err) {
      toast.error(err instanceof AdminApiError ? err.message : "Assegnazione manager fallita.");
    } finally {
      setManagerBusy(false);
    }
  };

  if (error) return <p className="admin-error">{error}</p>;
  if (!detail) return <p className="admin-loading">Caricamento streamer…</p>;

  const { streamer, subordinates, users, team_stats: team, total_users: totalUsers } = detail;

  return (
    <div className="admin-page">
      <Link href="/streamers" className="admin-back">
        ← Tutti gli streamer
      </Link>

      <div className="admin-user-head">
        <h1 className="admin-title">{streamer.id_code || `Streamer #${streamer.id}`}</h1>
        {streamer.is_manager ? <Badge tone="ok">Manager</Badge> : <Badge tone="info">Gestito</Badge>}
      </div>

      <div className="admin-stat-grid">
        <StatCard label="Saldo disponibile" value={formatEuro(streamer.balance_available)} />
        <StatCard label="Guadagni totali" value={formatEuro(streamer.total_earned)} />
        <StatCard label="Referral diretti" value={formatNumber(streamer.referred_num)} />
        <StatCard
          label="Rete"
          value={formatNumber(totalUsers)}
          hint={`${formatNumber(team.total_subordinates)} sub-streamer · ${formatEuro(detail.total_euros_spent)} spesi`}
        />
      </div>

      <section className="admin-card">
        <h2>Account</h2>
        <dl className="admin-facts">
          <div>
            <dt>ID streamer</dt>
            <dd>{streamer.id}</dd>
          </div>
          <div>
            <dt>Codice</dt>
            <dd>{streamer.id_code || "—"}</dd>
          </div>
          <div>
            <dt>Ruolo</dt>
            <dd>{streamer.is_manager ? "Manager" : "Streamer gestito"}</dd>
          </div>
          <div>
            <dt>Creato il</dt>
            <dd>{formatDate(streamer.created_at)}</dd>
          </div>
        </dl>
      </section>

      <section className="admin-card">
        <h2>Manager</h2>
        <form
          className="admin-grant-form"
          onSubmit={(event) => {
            event.preventDefault();
            const code = managerCode.trim();
            if (!code) {
              toast.error("Inserisci il codice del manager da assegnare.");
              return;
            }
            assignManager(code);
          }}
        >
          <div className="admin-grant-fields">
            <label className="field">
              <span className="field-label">Codice manager</span>
              <span className="field-input">
                <input
                  type="text"
                  value={managerCode}
                  onChange={(e) => setManagerCode(e.target.value)}
                  placeholder="Codice del manager da assegnare"
                />
              </span>
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={managerBusy}>
              {managerBusy ? "Salvataggio…" : "Assegna manager"}
            </button>
            {!streamer.is_manager && (
              <button
                type="button"
                className="btn btn-outline"
                disabled={managerBusy}
                onClick={() => assignManager("")}
              >
                Rimuovi manager
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="admin-card">
        <h2>Uso AI</h2>
        {aiUsage ? (
          <dl className="admin-facts">
            <div>
              <dt>Richieste</dt>
              <dd>{formatNumber(aiUsage.requests_count)}</dd>
            </div>
            <div>
              <dt>Token totali</dt>
              <dd>{formatNumber(aiUsage.total_tokens)}</dd>
            </div>
            <div>
              <dt>Costo stimato</dt>
              <dd>{formatEuro(aiUsage.total_cost)}</dd>
            </div>
            <div>
              <dt>Ultima richiesta</dt>
              <dd>{formatDate(aiUsage.last_request_at)}</dd>
            </div>
          </dl>
        ) : (
          <p className="admin-empty">Nessun uso AI registrato per questo streamer.</p>
        )}
      </section>

      <section className="admin-card">
        <h2>Sub-streamer ({subordinates.length})</h2>
        <DataTable
          mode="client"
          columns={SUB_COLUMNS}
          rows={subordinates}
          perPage={10}
          emptyMessage="Nessun sub-streamer nella rete."
          onRowClick={(sub) => router.push(`/streamers/${sub.id}`)}
        />
      </section>

      <section className="admin-card">
        <h2>Utenti della rete ({totalUsers})</h2>
        <DataTable
          mode="client"
          columns={USER_COLUMNS}
          rows={users}
          perPage={10}
          emptyMessage="Nessun utente referenziato dalla rete."
          onRowClick={(user) => router.push(`/utenti/${user.id}`)}
        />
      </section>

      <section className="admin-card">
        <h2>Transazioni della rete (recenti)</h2>
        {txError ? (
          <p className="admin-error">{txError}</p>
        ) : (
          <DataTable
            mode="client"
            columns={TX_COLUMNS}
            rows={transactions}
            perPage={10}
            emptyMessage="Nessuna transazione recente dagli utenti della rete."
          />
        )}
      </section>
    </div>
  );
}
