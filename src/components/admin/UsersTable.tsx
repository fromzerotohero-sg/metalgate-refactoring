"use client";

import { useRouter } from "next/navigation";
import { availableCredits, formatDate, formatNumber, type AdminUser } from "@/src/lib/admin-api";

export default function UsersTable({ users }: { users: AdminUser[] }) {
  const router = useRouter();

  if (!users.length) return <p className="admin-empty">Nessun utente trovato con questi filtri.</p>;

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Utente</th>
            <th>Email</th>
            <th className="num">Crediti</th>
            <th className="num">Comprati</th>
            <th className="num">Spesi</th>
            <th>Ultimo login</th>
            <th>Registrato</th>
            <th>Stato</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} onClick={() => router.push(`/pannello/utenti/${user.id}`)}>
              <td>
                <span className="admin-user-name">{user.username || "—"}</span>
                {user.tag && <span className="admin-user-tag">#{user.tag}</span>}
              </td>
              <td>{user.email}</td>
              <td className="num">{formatNumber(availableCredits(user))}</td>
              <td className="num">{formatNumber(user.credits_bought)}</td>
              <td className="num">{formatNumber(user.credits_spent)}</td>
              <td>{formatDate(user.last_login)}</td>
              <td>{formatDate(user.created_at)}</td>
              <td>
                {user.email_verified ? (
                  <span className="admin-badge ok">Verificato</span>
                ) : (
                  <span className="admin-badge warn">Non verificato</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
