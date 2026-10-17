import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
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
import { days } from '@/lib/format'
import { useI18n } from '@/lib/i18n'
import { serverText } from '@/lib/serverText'

const axis = { fontSize: 12, fill: '#6b776e' }
const grid = <CartesianGrid strokeDasharray="3 3" stroke="#e3e9e4" vertical={false} />
const tooltipStyle = {
  contentStyle: { borderRadius: 12, border: '1px solid #e3e9e4', boxShadow: '0 10px 30px rgb(23 34 26 / 0.12)', fontSize: 13 },
  labelStyle: { fontWeight: 600, color: '#17221a' },
}

export function ForecastBadge() {
  const { t } = useI18n()
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-200">
      <svg width="16" height="4" aria-hidden>
        <line x1="0" y1="2" x2="16" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
      </svg>
      {t('hr.chart.forecastBadge')}
    </span>
  )
}

export function RequestsWeeklyChart({ data }: { data: HrCharts['requests_weekly'] }) {
  const { t } = useI18n()
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        {grid}
        <XAxis dataKey="week" tick={axis} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip {...tooltipStyle} cursor={{ fill: '#eef8ee' }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="vacation" name={t('type.vacation')} stackId="a" fill={CHART_COLORS.brand} radius={[0, 0, 0, 0]} />
        <Bar dataKey="advance" name={t('type.advance')} stackId="a" fill={CHART_COLORS.sky} />
        <Bar dataKey="other" name={t('hr.chart.other')} stackId="a" fill={CHART_COLORS.violet} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function VacationMonthlyChart({ data }: { data: HrCharts['vacation_monthly'] }) {
  const { t } = useI18n()
  const months = t('date.monthsNomShort').split(',')
  // подпись месяца строим из ключа «ГГГГ-ММ»: готовая подпись из базы приходит по-русски
  const monthLabel = (m: HrCharts['vacation_monthly']['months'][number]) => {
    const month = months[Number(m.key.slice(5, 7)) - 1]
    return month ? t('hr.chart.month', { month, yy: m.key.slice(2, 4) }) : m.label
  }
  const rows = data.months.map((m) => ({
    label: monthLabel(m),
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
          formatter={(v, name) => [v === null || v === undefined ? '–' : days(Number(v)), name]}
          cursor={{ fill: '#eef8ee' }}
        />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="actual" name={t('hr.chart.actual')} fill={CHART_COLORS.brand} radius={[6, 6, 0, 0]} />
        <Bar dataKey="planned" name={t('hr.chart.planned')} fill={CHART_COLORS.brandSoft} radius={[6, 6, 0, 0]} />
        <Line dataKey="forecast" name={t('hr.chart.forecast')} stroke={CHART_COLORS.violet} strokeWidth={2.5} strokeDasharray="6 5" dot={{ r: 3 }} connectNulls={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function LearningByDeptChart({ data }: { data: HrCharts['learning_by_department'] }) {
  const { t } = useI18n()
  // «Без подразделения» база присылает по-русски; названия отделов serverText оставляет как есть
  const rows = data.map((r) => ({ ...r, department: serverText(r.department) })).sort((a, b) => a.pct - b.pct)
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 30 + 36)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 20, right: 40, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e3e9e4" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={axis} tickLine={false} axisLine={false} unit="%" />
        <YAxis type="category" dataKey="department" width={150} tick={{ ...axis, fontSize: 11.5 }} tickLine={false} axisLine={false} />
        <Tooltip {...tooltipStyle} formatter={(v, _n, item) => [`${v}% (${item.payload.completed}/${item.payload.assigned})`, t('hr.chart.mandatoryDone')]} cursor={{ fill: '#eef8ee' }} />
        <ReferenceLine x={80} stroke={CHART_COLORS.amber} strokeDasharray="4 4" label={{ value: t('hr.chart.target', { n: 80 }), fontSize: 11, fill: CHART_COLORS.amber, position: 'top' }} />
        <Bar dataKey="pct" radius={[0, 6, 6, 0]} barSize={16} minPointSize={3}>
          {rows.map((r) => (
            <Cell key={r.department} fill={r.pct < 60 ? CHART_COLORS.rose : r.pct < 80 ? CHART_COLORS.amber : CHART_COLORS.brand} />
          ))}
          <LabelList dataKey="pct" position="right" formatter={(v) => `${v}%`} style={{ fontSize: 11, fill: '#5b6b60' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function HeadcountChart({ data }: { data: HrCharts['headcount_by_department'] }) {
  const { t } = useI18n()
  const rows = data.map((r) => ({ ...r, department: serverText(r.department) }))
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 28 + 24)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 32, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e3e9e4" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="department" width={150} tick={{ ...axis, fontSize: 11.5 }} tickLine={false} axisLine={false} />
        <Tooltip {...tooltipStyle} formatter={(v) => [t('hr.chart.people', { n: Number(v) }), t('hr.headcount')]} cursor={{ fill: '#eef8ee' }} />
        <Bar dataKey="count" fill={CHART_COLORS.brand} radius={[0, 6, 6, 0]} barSize={14} minPointSize={3}>
          <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: '#5b6b60' }} />
        </Bar>
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
