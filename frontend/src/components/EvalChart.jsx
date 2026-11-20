import { Area, AreaChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CLASSES } from '../lib/review'

const MARKED = new Set(['brilliant', 'great', 'inaccuracy', 'mistake', 'blunder'])

function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="chart-tip">
      <strong>{d.label}</strong>
      <span>{d.evalText}</span>
    </div>
  )
}

/** White-advantage area chart (win probability), click to jump to a move. */
export default function EvalChart({ points, total, activeIndex, onSelect }) {
  if (points.length === 0) {
    return <div className="chart-empty">The evaluation graph appears as moves are analyzed.</div>
  }
  return (
    <div className="eval-chart">
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart
          data={points}
          margin={{ top: 6, right: 0, left: 0, bottom: 0 }}
          onClick={e => {
            const idx = e?.activeTooltipIndex
            if (idx != null && points[idx]) onSelect(points[idx].index)
          }}
        >
          <XAxis dataKey="index" type="number" domain={[0, Math.max(1, total - 1)]} hide />
          <YAxis domain={[0, 100]} hide />
          <Tooltip content={<ChartTip />} cursor={{ stroke: 'var(--muted)', strokeWidth: 1 }} />
          <ReferenceLine y={50} stroke="var(--border-strong)" strokeDasharray="3 3" />
          <Area
            type="monotone"
            dataKey="wp"
            stroke="#d4d4d8"
            strokeWidth={1.5}
            fill="#f4f4f5"
            fillOpacity={0.9}
            baseValue={0}
            isAnimationActive={false}
          />
          {activeIndex >= 0 && <ReferenceLine x={activeIndex} stroke="var(--accent)" strokeWidth={2} />}
          {points.filter(p => MARKED.has(p.cls)).map(p => (
            <ReferenceDot key={p.index} x={p.index} y={p.wp} r={3.5} fill={CLASSES[p.cls].color} stroke="#18181b" strokeWidth={1} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
