import Link from "next/link";

export default function StatCard({
  label,
  value,
  hint,
  href
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="admin-stat-label">{label}</span>
      <span className="admin-stat-value">{value}</span>
      {hint && <span className="admin-stat-hint">{hint}</span>}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="admin-stat-card no-underline transition-colors hover:border-brand/60 focus-visible:border-brand"
      >
        {body}
      </Link>
    );
  }
  return <div className="admin-stat-card">{body}</div>;
}
