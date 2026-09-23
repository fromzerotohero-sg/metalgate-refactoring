export default function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="admin-stat-card">
      <span className="admin-stat-label">{label}</span>
      <span className="admin-stat-value">{value}</span>
      {hint && <span className="admin-stat-hint">{hint}</span>}
    </div>
  );
}
