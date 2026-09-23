import type { ActivityPoint } from "@/src/lib/admin-api";

const WIDTH = 720;
const HEIGHT = 220;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;
const BAR_GAP = 3;

export default function ActivityChart({ data }: { data: ActivityPoint[] }) {
  if (!data.length) return <p className="admin-empty">Nessun dato di attività.</p>;

  const max = Math.max(1, ...data.map((d) => d.active_users));
  const chartHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const barWidth = (WIDTH - BAR_GAP * (data.length - 1)) / data.length;
  const labelEvery = Math.ceil(data.length / 6);

  return (
    <div className="admin-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Utenti attivi per giorno" preserveAspectRatio="none">
        <defs>
          <linearGradient id="adminBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
        </defs>
        <line x1="0" y1={HEIGHT - PAD_BOTTOM} x2={WIDTH} y2={HEIGHT - PAD_BOTTOM} stroke="#e3e9f4" strokeWidth="1" />
        {data.map((point, index) => {
          const barHeight = Math.max(2, (point.active_users / max) * chartHeight);
          const x = index * (barWidth + BAR_GAP);
          const y = HEIGHT - PAD_BOTTOM - barHeight;
          const day = point.date.slice(8, 10);
          const month = point.date.slice(5, 7);
          return (
            <g key={point.date}>
              <rect x={x} y={y} width={barWidth} height={barHeight} rx={3} fill="url(#adminBar)">
                <title>{`${day}/${month}: ${point.active_users} attivi`}</title>
              </rect>
              {index % labelEvery === 0 && (
                <text x={x + barWidth / 2} y={HEIGHT - 10} textAnchor="middle" className="admin-chart-label">
                  {`${day}/${month}`}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="admin-chart-legend">Picco: {max} utenti attivi in un giorno</p>
    </div>
  );
}
