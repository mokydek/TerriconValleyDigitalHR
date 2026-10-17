import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Area } from 'recharts'
import { AlertTriangle, Bot, Download, GraduationCap, Inbox, Palmtree, Truck } from '@/components/icons'
import { useAuth } from '@/lib/auth'
import { useAnalytics, useHrCharts, useHrDashboard, type HrCharts } from '@/lib/api'
import { CHART_COLORS } from '@/lib/constants'
import { exportXlsx } from '@/lib/excel'
import { days, fmtDate, num } from '@/lib/format'
import { tr, useI18n } from '@/lib/i18n'
import { serverText } from '@/lib/serverText'
import { cn } from '@/lib/utils'
import { Badge, Button, Card, CardHeader, Empty, Kpi, PageHeader, Progress, Skeleton, Tabs } from '@/components/ui'
import { ForecastBadge, RequestsWeeklyChart, SimpleLine, VacationMonthlyChart } from '@/components/charts/HrCharts'

type Tab = 'vacations' | 'learning' | 'requests' | 'ai' | 'logistics'

const axis = { fontSize: 12, fill: '#6b776e' }
const tooltipStyle = { contentStyle: { borderRadius: 12, border: '1px solid #e3e9e4', fontSize: 13 } }

/** Даты из базы приходят строкой «17.10» или «17.10.2026»: показываем в порядке, принятом в языке */
function dayLabel(value: unknown): string {
  const s = String(value)
  const m = /^(\d{2})\.(\d{2})(?:\.(\d{4}))?$/.exec(s)
  if (!m) return s
  // без года берём високосный 2000-й, чтобы «29.02» не стало 1 марта
  return fmtDate(new Date(Number(m[3] ?? 2000), Number(m[2]) - 1, Number(m[1])), m[3] ? 'dd.MM.yyyy' : 'dd.MM')
}

export default function AnalyticsPage() {
  const { t } = useI18n()
  const { isHr } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'vacations'
  const setTab = (v: Tab) => setParams({ tab: v }, { replace: true })
  const dash = useHrDashboard()

  return (
    <div>
      <PageHeader
        title={t('nav.analytics')}
        subtitle={t(isHr ? 'analytics.subtitleCompany' : 'analytics.subtitleTeam')}
      />
      {dash.data && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label={t('analytics.kpi.headcount')} value={num(dash.data.headcount)} icon={<Palmtree className="h-4 w-4" />} hint={t('analytics.kpi.onVacationToday', { n: dash.data.on_vacation_today })} />
          <Kpi label={t('analytics.kpi.vacationUsage')} value={`${dash.data.vacation.usage_pct}%`} hint={t('analytics.kpi.unused', { days: days(Math.round(dash.data.vacation.available)) })} icon={<Palmtree className="h-4 w-4" />} tone="sky" />
          <Kpi label={t('analytics.kpi.mandatory')} value={`${dash.data.learning.mandatory_pct}%`} hint={t('analytics.kpi.avgScore', { score: dash.data.learning.avg_score ?? '–' })} icon={<GraduationCap className="h-4 w-4" />} tone="violet" />
          <Kpi label={t('analytics.kpi.approval')} value={dash.data.requests.approval_hours !== null ? t('analytics.hours', { n: num(dash.data.requests.approval_hours, 1) }) : '–'} hint={t('analytics.kpi.approvalHint')} icon={<Inbox className="h-4 w-4" />} tone="amber" />
        </div>
      )}
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        className="mb-5"
        items={[
          { value: 'vacations', label: t('analytics.tab.vacations') },
          { value: 'learning', label: t('analytics.tab.learning') },
          { value: 'requests', label: t('analytics.tab.requests') },
          { value: 'ai', label: 'AI Jana' },
          { value: 'logistics', label: t('analytics.tab.logistics') },
        ]}
      />
      {tab === 'vacations' && <VacationsTab />}
      {tab === 'learning' && <LearningTab />}
      {tab === 'requests' && <RequestsTab />}
      {tab === 'ai' && <AiTab />}
      {tab === 'logistics' && <LogisticsTab />}
    </div>
  )
}

/* ---------- Отпуска ---------- */

interface Heatmap {
  year: number
  months: string[]
  rows: { department: string; headcount: number; values: number[]; days: number[] }[]
}

function heatColor(v: number) {
  if (v <= 0) return 'bg-canvas text-muted/60'
  if (v < 15) return 'bg-brand-100 text-brand-900'
  if (v < 30) return 'bg-brand-300 text-brand-950'
  if (v < 50) return 'bg-amber-300 text-amber-950'
  return 'bg-rose-400 text-white'
}

function VacationsTab() {
  const { t } = useI18n()
  const heat = useAnalytics<Heatmap>('vacation_heatmap')
  const charts = useHrCharts()
  const currentMonth = new Date().getMonth()
  // подписи месяцев берём из словаря: готовые подписи из базы приходят по-русски
  const months = t('date.monthsNomShort')
    .split(',')
    .map((m) => m.charAt(0).toUpperCase() + m.slice(1))
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={t('analytics.heat.title', { year: heat.data?.year ?? '' })}
          subtitle={t('analytics.heat.subtitle')}
          action={
            heat.data && (
              <Button
                size="sm"
                variant="outline"
                icon={<Download className="h-4 w-4" />}
                onClick={() =>
                  void exportXlsx(t('analytics.heat.excelTitle'), [t('analytics.col.department'), t('analytics.col.people'), ...months.map((m) => `${m}, %`)], heat.data!.rows.map((r) => [serverText(r.department), r.headcount, ...r.values]))
                }
              >
                Excel
              </Button>
            )
          }
        />
        <div className="scrollbar-thin overflow-x-auto px-5 pb-5">
          {!heat.data ? (
            <Skeleton className="h-64" />
          ) : (
            <table className="w-full min-w-[820px] border-separate border-spacing-1 text-center text-xs">
              <thead>
                <tr>
                  <th className="w-48 text-left font-medium text-muted">{t('analytics.col.department')}</th>
                  {months.map((m, i) => (
                    <th key={m} className={cn('font-medium text-muted', i === currentMonth && 'text-brand-700')}>
                      {m}
                      {i > currentMonth && <span className="block text-[9px] text-violet-600">{t('analytics.heat.plan')}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heat.data.rows.map((r) => (
                  <tr key={r.department}>
                    <td className="truncate pr-2 text-left text-[12.5px] font-medium text-ink">
                      {serverText(r.department)} <span className="text-muted">· {r.headcount}</span>
                    </td>
                    {r.values.map((v, i) => (
                      <td key={i} className={cn('h-9 rounded-md font-semibold tabular-nums', heatColor(v))} title={t('analytics.heat.cell', { dept: serverText(r.department), month: months[i], pct: v, days: days(r.days[i]) })}>
                        {v > 0 ? `${v}%` : '·'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>{t('analytics.heat.scale')}</span>
            {[
              ['bg-brand-100', '< 15%'],
              ['bg-brand-300', '15–30%'],
              ['bg-amber-300', '30–50%'],
              ['bg-rose-400', t('analytics.heat.risk')],
            ].map(([c, l]) => (
              <span key={l} className="inline-flex items-center gap-1.5">
                <span className={cn('h-3 w-3 rounded', c)} /> {l}
              </span>
            ))}
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title={t('analytics.vacMonthly.title')} subtitle={t('analytics.vacMonthly.subtitle', { trend: num(charts.data?.vacation_monthly.trend, 2) })} action={<ForecastBadge />} />
        <div className="px-3 pb-4">{charts.data ? <VacationMonthlyChart data={charts.data.vacation_monthly} /> : <Skeleton className="h-60" />}</div>
        <p className="px-5 pb-5 text-xs text-muted">{t('analytics.vacMonthly.method')}</p>
      </Card>
    </div>
  )
}

/* ---------- Обучение ---------- */

function LearningTab() {
  const { t } = useI18n()
  const funnel = useAnalytics<{ assigned: number; started: number; lessons_done: number; passed: number }>('learning_funnel')
  const forecast = useAnalytics<{ total: number; completed: number; pct: number; rate_per_week: number; eta: string | null; series: { day: string; actual: number | null; forecast: number | null }[] }>('learning_forecast')
  const charts = useHrCharts()
  const steps = funnel.data
    ? [
        { label: t('analytics.funnel.assigned'), value: funnel.data.assigned },
        { label: t('analytics.funnel.started'), value: funnel.data.started },
        { label: t('analytics.funnel.lessonsDone'), value: funnel.data.lessons_done },
        { label: t('analytics.funnel.passed'), value: funnel.data.passed },
      ]
    : []
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title={t('analytics.funnel.title')} subtitle={t('analytics.funnel.subtitle')} />
        <div className="space-y-3 px-5 pb-5">
          {!funnel.data && <Skeleton className="h-40" />}
          {steps.map((s, i) => {
            const pct = funnel.data!.assigned ? Math.round((s.value / funnel.data!.assigned) * 100) : 0
            const drop = i > 0 && steps[i - 1].value ? Math.round(((steps[i - 1].value - s.value) / steps[i - 1].value) * 100) : 0
            return (
              <div key={s.label}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {i + 1}. {s.label}
                  </span>
                  <span className="text-muted">
                    {s.value} · {pct}% {i > 0 && drop > 0 && <span className="text-rose-600">(−{drop}%)</span>}
                  </span>
                </div>
                <div className="h-8 overflow-hidden rounded-lg bg-canvas">
                  <div className="h-full rounded-lg bg-gradient-to-r from-brand-500 to-brand-600 transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </Card>
      <Card>
        <CardHeader
          title={t('analytics.eta.title')}
          subtitle={forecast.data ? t('analytics.eta.subtitle', { pct: forecast.data.pct, rate: num(forecast.data.rate_per_week, 1) }) : ''}
          action={<ForecastBadge />}
        />
        <div className="px-3 pb-3">
          {forecast.data ? (
            <SimpleLine
              data={forecast.data.series.map((s) => ({ ...s, day: dayLabel(s.day) }))}
              x="day"
              unit="%"
              lines={[
                { key: 'actual', name: t('analytics.eta.actual'), color: CHART_COLORS.brand },
                { key: 'forecast', name: t('analytics.eta.forecast'), color: CHART_COLORS.violet, dashed: true },
              ]}
            />
          ) : (
            <Skeleton className="h-60" />
          )}
        </div>
        {forecast.data && (
          <div className="mx-5 mb-5 rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-900">
            {forecast.data.eta ? tr('analytics.eta.reach', { date: <b>{fmtDate(forecast.data.eta)}</b> }) : t('analytics.eta.zero')}
          </div>
        )}
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader title={t('analytics.byDept.title')} subtitle={t('analytics.byDept.subtitle')} />
        <div className="px-3 pb-4">
          {charts.data ? (
            <ResponsiveContainer width="100%" height={Math.max(220, charts.data.learning_by_department.length * 34)}>
              <BarChart data={[...charts.data.learning_by_department].sort((a, b) => a.pct - b.pct).map((r) => ({ ...r, department: serverText(r.department) }))} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e3e9e4" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} unit="%" tick={axis} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="department" width={170} tick={axis} tickLine={false} axisLine={false} />
                <Tooltip {...tooltipStyle} formatter={(v, _n, item) => [`${v}% (${(item.payload as HrCharts['learning_by_department'][number]).completed}/${(item.payload as HrCharts['learning_by_department'][number]).assigned})`, t('analytics.byDept.passed')]} />
                <Bar dataKey="pct" radius={[0, 6, 6, 0]} barSize={18}>
                  {charts.data.learning_by_department.map((r) => (
                    <Cell key={r.department} fill={r.pct < 60 ? CHART_COLORS.rose : r.pct < 80 ? CHART_COLORS.amber : CHART_COLORS.brand} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Skeleton className="h-60" />
          )}
        </div>
      </Card>
    </div>
  )
}

/* ---------- Заявки ---------- */

interface StageTimes {
  stages: { stage: 'manager' | 'hr' | '1c'; avg_hours: number; max_hours: number; count: number }[] | null
  by_manager: { manager: string; count: number; avg_hours: number }[] | null
}

const STAGE_LABEL = { manager: 'analytics.stage.manager', hr: 'analytics.stage.hr', '1c': 'analytics.stage.1c' } as const

function RequestsTab() {
  const { t } = useI18n()
  const times = useAnalytics<StageTimes>('request_stage_times')
  const charts = useHrCharts()
  const stages = times.data?.stages ?? []
  const bottleneck = stages.length ? stages.reduce((acc, s) => (s.avg_hours > acc.avg_hours ? s : acc)) : null
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title={t('analytics.stages.title')} subtitle={t('analytics.stages.subtitle')} />
        <div className="space-y-4 px-5 pb-5">
          {!times.data && <Skeleton className="h-40" />}
          {stages.map((s) => {
            const max = Math.max(...stages.map((x) => x.avg_hours), 1)
            const isNeck = bottleneck?.stage === s.stage
            return (
              <div key={s.stage}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {t(STAGE_LABEL[s.stage])} {isNeck && <Badge className="ml-1 bg-rose-50 text-rose-700 ring-rose-200">{t('analytics.stages.bottleneck')}</Badge>}
                  </span>
                  <span className="text-muted">{t('analytics.stages.row', { avg: num(s.avg_hours, 1), max: num(s.max_hours, 0), requests: t('analytics.nRequests', { n: s.count }) })}</span>
                </div>
                <div className="h-7 overflow-hidden rounded-lg bg-canvas">
                  <div className={cn('h-full rounded-lg', isNeck ? 'bg-rose-400' : 'bg-brand-500')} style={{ width: `${Math.max(3, (s.avg_hours / max) * 100)}%` }} />
                </div>
              </div>
            )
          })}
          {bottleneck && (
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {t('analytics.stages.neck', { stage: t(STAGE_LABEL[bottleneck.stage]), hours: num(bottleneck.avg_hours, 1) })}
              {bottleneck.stage === 'manager' ? ` ${t('analytics.stages.neckManager')}` : ''}
            </div>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader
          title={t('analytics.byManager.title')}
          subtitle={t('analytics.byManager.subtitle')}
          action={
            times.data?.by_manager && (
              <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => void exportXlsx(t('analytics.byManager.excelTitle'), [t('role.manager'), t('analytics.col.requests'), t('analytics.col.avgHours')], times.data!.by_manager!.map((m) => [m.manager, m.count, m.avg_hours]))}>
                Excel
              </Button>
            )
          }
        />
        <ul className="divide-y divide-line border-t border-line">
          {(times.data?.by_manager ?? []).map((m) => (
            <li key={m.manager} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{m.manager}</span>
              <span className="text-muted">{t('analytics.nRequests', { n: m.count })}</span>
              <span className={cn('w-20 text-right font-semibold tabular-nums', m.avg_hours > 24 ? 'text-rose-600' : 'text-ink')}>{t('analytics.hours', { n: num(m.avg_hours, 1) })}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader title={t('analytics.weekly.title')} subtitle={t('analytics.weekly.subtitle')} />
        <div className="px-3 pb-4">{charts.data ? <RequestsWeeklyChart data={charts.data.requests_weekly} /> : <Skeleton className="h-60" />}</div>
      </Card>
    </div>
  )
}

/* ---------- AI Jana ---------- */

interface AiInsights {
  total: number
  answered_pct: number
  top_questions: { question: string; count: number; status: string }[]
  unanswered: { question: string; count: number; suggestion: string }[]
  top_sources: { title: string; slug: string; count: number }[]
  tickets_open: number
}

function AiTab() {
  const { t } = useI18n()
  const { data } = useAnalytics<AiInsights>('ai_insights')
  if (!data) return <Skeleton className="h-80" />
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="grid grid-cols-2 gap-3 xl:col-span-2 xl:grid-cols-4">
        <Kpi label={t('analytics.ai.questions')} value={num(data.total)} icon={<Bot className="h-4 w-4" />} />
        <Kpi label={t('analytics.ai.answered')} value={`${data.answered_pct}%`} icon={<Bot className="h-4 w-4" />} tone="brand" />
        <Kpi label={t('analytics.ai.unanswered')} value={`${100 - data.answered_pct}%`} hint={t('analytics.ai.escalation')} icon={<AlertTriangle className="h-4 w-4" />} tone="amber" />
        <Kpi label={t('analytics.ai.openTickets')} value={num(data.tickets_open)} icon={<Inbox className="h-4 w-4" />} tone="rose" to="/tickets" />
      </div>
      <Card>
        <CardHeader title={t('analytics.ai.top')} subtitle={t('analytics.ai.topSubtitle')} />
        <ol className="divide-y divide-line border-t border-line">
          {data.top_questions.map((q, i) => (
            <li key={q.question} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <span className="w-5 text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1">{q.question}</span>
              <Badge className={q.status === 'no_answer' ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-brand-50 text-brand-700 ring-brand-200'}>{q.count}</Badge>
            </li>
          ))}
        </ol>
      </Card>
      <Card>
        <CardHeader title={t('analytics.ai.gaps')} subtitle={t('analytics.ai.gapsSubtitle')} />
        <ul className="space-y-2 px-5 pb-5">
          {data.unanswered.length === 0 && <Empty title={t('analytics.ai.noGaps')} />}
          {data.unanswered.map((u) => (
            <li key={u.question} className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm">
              <div className="font-medium text-ink">{t('analytics.quoted', { text: u.question })}</div>
              <div className="mt-1 flex items-center justify-between gap-2 text-amber-900">
                <span>{serverText(u.suggestion)}</span>
                <span className="shrink-0 text-xs">{t('analytics.ai.asked', { n: u.count })}</span>
              </div>
            </li>
          ))}
          <Link to="/tickets" className="inline-block pt-1 text-sm font-medium text-brand-700 hover:underline">
            {t('analytics.ai.answerLink')}
          </Link>
        </ul>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader title={t('analytics.ai.sources')} subtitle={t('analytics.ai.sourcesSubtitle')} />
        <ul className="space-y-3 px-5 pb-5">
          {data.top_sources.map((s) => (
            <li key={s.slug}>
              <div className="flex justify-between text-sm">
                <Link to={`/knowledge/${s.slug}`} className="font-medium hover:text-brand-700">
                  {s.title}
                </Link>
                <span className="text-muted">{s.count}</span>
              </div>
              <Progress value={(s.count / Math.max(...data.top_sources.map((x) => x.count), 1)) * 100} className="mt-1 h-1.5" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

/* ---------- Логистика ---------- */

interface Logistics {
  totals: { parcels_in: number; delivered: number; on_time_pct: number; error_rate_pct: number; plan_pct: number; parcels_change_pct: number; on_time_prev_pct: number; avg_staff: number; productivity: number }
  daily: { day: string; parcels_in: number; delivered: number; on_time_pct: number }[]
  by_location: { location: string; city: string; parcels_in: number; on_time_pct: number; error_rate_pct: number }[]
  forecast: { day: string; date: string; forecast: number; lower: number; upper: number; required_staff: number; usual_staff: number; available_staff: number; on_vacation: number }[]
  summary: { peak_day: string; peak_volume: number; peak_required_staff: number; current_staff: number; usual_staff?: number; available_staff?: number; staff_gap: number; on_vacation_at_peak: number }
}

function LogisticsTab() {
  const { t } = useI18n()
  const { data, isLoading, error } = useAnalytics<Logistics>('logistics_overview', { p_days: 30, p_horizon: 45 })
  const combined = useMemo(() => {
    if (!data) return []
    const hist = (data.daily ?? []).slice(-30).map((d) => ({ day: d.day, fact: d.parcels_in, forecast: null as number | null, band: null as [number, number] | null }))
    const fc = (data.forecast ?? []).map((f) => ({ day: f.day, fact: null as number | null, forecast: f.forecast, band: [f.lower, f.upper] as [number, number] }))
    if (hist.length && fc.length) hist[hist.length - 1].forecast = hist[hist.length - 1].fact
    return [...hist, ...fc]
  }, [data])
  if (isLoading) return <Skeleton className="h-96" />
  if (error || !data) return <Card><Empty icon={<Truck className="h-6 w-6" />} title={t('analytics.log.noData')} /></Card>
  const tot = data.totals
  const peak = data.summary
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t('analytics.log.parcels')} value={num(tot.parcels_in)} hint={t('analytics.log.vsPrev', { pct: `${tot.parcels_change_pct >= 0 ? '+' : ''}${num(tot.parcels_change_pct, 1)}` })} icon={<Truck className="h-4 w-4" />} />
        <Kpi label={t('analytics.log.onTime')} value={`${num(tot.on_time_pct, 1)}%`} hint={t('analytics.log.was', { pct: num(tot.on_time_prev_pct, 1) })} tone="sky" />
        <Kpi label={t('analytics.log.plan')} value={`${num(tot.plan_pct, 1)}%`} hint={t('analytics.log.errors', { pct: num(tot.error_rate_pct, 2) })} tone="violet" />
        <Kpi label={t('analytics.log.staff')} value={num(tot.avg_staff)} hint={t('analytics.log.productivity', { n: tot.productivity })} tone="amber" />
      </div>
      <Card>
        <CardHeader title={t('analytics.log.flowTitle')} subtitle={t('analytics.log.flowSubtitle')} action={<ForecastBadge />} />
        <div className="px-3 pb-4">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={combined} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3e9e4" vertical={false} />
              <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} minTickGap={20} tickFormatter={dayLabel} />
              <YAxis tick={axis} tickLine={false} axisLine={false} />
              <Tooltip {...tooltipStyle} labelFormatter={dayLabel} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Area dataKey="band" name={t('analytics.log.band')} fill={CHART_COLORS.violet} fillOpacity={0.12} stroke="none" />
              <Line dataKey="fact" name={t('analytics.log.fact')} stroke={CHART_COLORS.brand} strokeWidth={2.5} dot={false} />
              <Line dataKey="forecast" name={t('analytics.log.forecast')} stroke={CHART_COLORS.violet} strokeWidth={2.5} strokeDasharray="6 5" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title={t('analytics.staff.title')} subtitle={t('analytics.staff.subtitle')} action={<ForecastBadge />} />
          <div className="px-3 pb-4">
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={data.forecast} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e3e9e4" vertical={false} />
                <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} minTickGap={20} tickFormatter={dayLabel} />
                <YAxis tick={axis} tickLine={false} axisLine={false} />
                <Tooltip {...tooltipStyle} labelFormatter={dayLabel} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="available_staff" name={t('analytics.staff.available')} fill={CHART_COLORS.brandSoft} radius={[4, 4, 0, 0]} />
                <Line dataKey="required_staff" name={t('analytics.staff.required')} stroke={CHART_COLORS.rose} strokeWidth={2.5} strokeDasharray="6 5" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold">{t('analytics.staff.conclusion')}</h3>
          <p className="mt-2 text-sm text-ink-soft">
            {tr('analytics.staff.peak', { day: <b>{dayLabel(peak.peak_day)}</b>, volume: num(peak.peak_volume), n: peak.peak_volume })}{' '}
            {t(peak.on_vacation_at_peak > 0 ? 'analytics.staff.needVac' : 'analytics.staff.need', { need: peak.peak_required_staff, usual: peak.usual_staff ?? peak.current_staff, vac: peak.on_vacation_at_peak })}
          </p>
          <div className={cn('mt-4 rounded-xl px-4 py-3 text-sm', peak.staff_gap > 0 ? 'bg-rose-50 text-rose-900' : 'bg-brand-50 text-brand-900')}>
            {peak.staff_gap > 0 ? tr('analytics.staff.gap', { gap: <b>{t('analytics.persons', { n: peak.staff_gap })}</b> }) : t('analytics.staff.enough')}
          </div>
          <h4 className="mt-5 mb-2 text-sm font-semibold">{t('analytics.log.byLocation')}</h4>
          <ul className="space-y-2 text-sm">
            {data.by_location.map((l) => (
              <li key={l.location} className="flex items-center justify-between gap-2">
                <span className="truncate">{l.location}</span>
                <span className="shrink-0 text-muted">{t('analytics.log.locRow', { parcels: num(l.parcels_in), pct: num(l.on_time_pct, 1) })}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
