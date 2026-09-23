export type ChartPoint = { date: string; value: number };

const WIDTH = 720;
const HEIGHT = 220;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;
const BAR_GAP = 3;

export default function ActivityChart({
  data,
  emptyMessage = "Nessun dato disponibile.",
  ariaLabel = "Valori per giorno",
  formatValue = (value: number) => String(value),
  legendUnit = "in un giorno"
}: {
  data: ChartPoint[];
  emptyMessage?: string;
  ariaLabel?: string;
  formatValue?: (value: number) => string;
  legendUnit?: string;
}) {
  if (!data.length) return <p className="admin-empty">{emptyMessage}</p>;

  const max = Math.max(1, ...data.map((d) => d.value));
  const chartHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const barWidth = (WIDTH - BAR_GAP * (data.length - 1)) / data.length;
  const labelEvery = Math.ceil(data.length / 6);

  return (
    <div className="admin-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none">
        <defs>
          <linearGradient id="adminBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
        </defs>
        <line x1="0" y1={HEIGHT - PAD_BOTTOM} x2={WIDTH} y2={HEIGHT - PAD_BOTTOM} stroke="#e3e9f4" strokeWidth="1" />
        {data.map((point, index) => {
          const barHeight = Math.max(2, (point.value / max) * chartHeight);
          const x = index * (barWidth + BAR_GAP);
          const y = HEIGHT - PAD_BOTTOM - barHeight;
          const day = point.date.slice(8, 10);
          const month = point.date.slice(5, 7);
          return (
            <g key={point.date}>
              <rect x={x} y={y} width={barWidth} height={barHeight} rx={3} fill="url(#adminBar)">
                <title>{`${day}/${month}: ${formatValue(point.value)}`}</title>
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
      <p className="admin-chart-legend">
        Picco: {formatValue(max)} {legendUnit}
      </p>
    </div>
  );
}
