import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CHART_COLORS } from '@/lib/constants'
import type { HrCharts } from '@/lib/api'

const axis = { fontSize: 12, fill: '#6b776e' }
const grid = <CartesianGrid strokeDasharray="3 3" stroke="#e3e9e4" vertical={false} />
const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: '1px solid #e3e9e4', boxShadow: '0 10px 30px rgb(23 34 26 / 0.12)', fontSize: 13 },
  labelStyle: { fontWeight: 600, color: '#17221a' },
}

export function ForecastBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200">
      <svg width="16" height="4" aria-hidden>
        <line x1="0" y1="2" x2="16" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
      </svg>
      прогноз
    </span>
  )
}

export function RequestsWeeklyChart({ data }: { data: HrCharts['requests_weekly'] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        {grid}
        <XAxis dataKey="week" tick={axis} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip {...tooltipStyle} cursor={{ fill: '#eef8ee' }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="vacation" name="Отпуск" stackId="a" fill={CHART_COLORS.brand} radius={[0, 0, 0, 0]} />
        <Bar dataKey="advance" name="Аванс" stackId="a" fill={CHART_COLORS.sky} />
        <Bar dataKey="other" name="Справки и данные" stackId="a" fill={CHART_COLORS.violet} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function VacationMonthlyChart({ data }: { data: HrCharts['vacation_monthly'] }) {
  const rows = data.months.map((m) => ({
    label: m.label,
    actual: m.actual,
    planned: m.forecast !== null ? m.planned : null,
    forecast: m.forecast,
    lastYear: m.last_year,
  }))
  // соединяем прогноз с последней фактической точкой, чтобы пунктир продолжал линию
  const firstForecast = rows.findIndex((r) => r.forecast !== null)
  if (firstForecast > 0 && rows[firstForecast - 1].actual !== null) {
    rows[firstForecast - 1] = { ...rows[firstForecast - 1], forecast: rows[firstForecast - 1].actual }
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        {grid}
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={1} />
        <YAxis tick={axis} tickLine={false} axisLine={false} />
        <Tooltip
          {...tooltipStyle}
          formatter={(v, name) => [v === null || v === undefined ? '—' : `${v} дн.`, name]}
          cursor={{ fill: '#eef8ee' }}
        />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="actual" name="Факт, дней" fill={CHART_COLORS.brand} radius={[6, 6, 0, 0]} />
        <Bar dataKey="planned" name="Уже запланировано" fill={CHART_COLORS.brandSoft} radius={[6, 6, 0, 0]} />
        <Line dataKey="forecast" name="Прогноз" stroke={CHART_COLORS.violet} strokeWidth={2.5} strokeDasharray="6 5" dot={{ r: 3 }} connectNulls={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function LearningByDeptChart({ data }: { data: HrCharts['learning_by_department'] }) {
  const rows = [...data].sort((a, b) => a.pct - b.pct)
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 30 + 20)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e3e9e4" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={axis} tickLine={false} axisLine={false} unit="%" />
        <YAxis type="category" dataKey="department" width={150} tick={{ ...axis, fontSize: 11.5 }} tickLine={false} axisLine={false} />
        <Tooltip {...tooltipStyle} formatter={(v, _n, item) => [`${v}% (${item.payload.completed}/${item.payload.assigned})`, 'Пройдено обязательных']} cursor={{ fill: '#eef8ee' }} />
        <ReferenceLine x={80} stroke={CHART_COLORS.amber} strokeDasharray="4 4" label={{ value: 'цель 80%', fontSize: 11, fill: CHART_COLORS.amber, position: 'top' }} />
        <Bar dataKey="pct" radius={[0, 6, 6, 0]} barSize={16}>
          {rows.map((r) => (
            <Cell key={r.department} fill={r.pct < 60 ? CHART_COLORS.rose : r.pct < 80 ? CHART_COLORS.amber : CHART_COLORS.brand} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function HeadcountChart({ data }: { data: HrCharts['headcount_by_department'] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 40 }}>
        {grid}
        <XAxis dataKey="department" tick={{ ...axis, fontSize: 10.5 }} tickLine={false} axisLine={false} interval={0} angle={-30} textAnchor="end" />
        <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip {...tooltipStyle} formatter={(v) => [`${v} чел.`, 'Численность']} cursor={{ fill: '#eef8ee' }} />
        <Bar dataKey="count" fill={CHART_COLORS.brand} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function SimpleLine({
  data,
  x,
  lines,
  height = 240,
  unit,
}: {
  data: Record<string, unknown>[]
  x: string
  lines: { key: string; name: string; color: string; dashed?: boolean; area?: boolean }[]
  height?: number
  unit?: string
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        {grid}
        <XAxis dataKey={x} tick={axis} tickLine={false} axisLine={false} minTickGap={18} />
        <YAxis tick={axis} tickLine={false} axisLine={false} unit={unit} />
        <Tooltip {...tooltipStyle} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        {lines.map((l) => (
          <Line
            key={l.key}
            type="monotone"
            dataKey={l.key}
            name={l.name}
            stroke={l.color}
            strokeWidth={2.5}
            strokeDasharray={l.dashed ? '6 5' : undefined}
            dot={false}
            connectNulls={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export { Area }
