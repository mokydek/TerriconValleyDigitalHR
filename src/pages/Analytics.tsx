import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Area } from 'recharts'
import { AlertTriangle, Bot, Download, GraduationCap, Inbox, Palmtree, Truck } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useAnalytics, useHrCharts, useHrDashboard, type HrCharts } from '@/lib/api'
import { CHART_COLORS } from '@/lib/constants'
import { exportXlsx } from '@/lib/excel'
import { fmtDate, num } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Badge, Button, Card, CardHeader, Empty, Kpi, PageHeader, Progress, Skeleton, Tabs } from '@/components/ui'
import { ForecastBadge, RequestsWeeklyChart, SimpleLine, VacationMonthlyChart } from '@/components/charts/HrCharts'

type Tab = 'vacations' | 'learning' | 'requests' | 'ai' | 'logistics'

const axis = { fontSize: 12, fill: '#6b776e' }
const tooltipStyle = { contentStyle: { borderRadius: 12, border: '1px solid #e3e9e4', fontSize: 13 } }

export default function AnalyticsPage() {
  const { isHr } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'vacations'
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true })
  const dash = useHrDashboard()

  return (
    <div>
      <PageHeader
        title="Аналитика и прогнозы"
        subtitle={`${isHr ? 'Вся компания' : 'Ваша команда'} · прогнозы помечены «прогноз»`}
      />
      {dash.data && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Численность" value={num(dash.data.headcount)} icon={<Palmtree className="h-4 w-4" />} hint={`в отпуске сегодня: ${dash.data.on_vacation_today}`} />
          <Kpi label="Использование отпусков" value={`${dash.data.vacation.usage_pct}%`} hint={`не использовано: ${num(dash.data.vacation.available)} дн.`} icon={<Palmtree className="h-4 w-4" />} tone="sky" />
          <Kpi label="Обязательное обучение" value={`${dash.data.learning.mandatory_pct}%`} hint={`ср. балл ${dash.data.learning.avg_score ?? '–'}%`} icon={<GraduationCap className="h-4 w-4" />} tone="violet" />
          <Kpi label="Согласование" value={dash.data.requests.approval_hours !== null ? `${num(dash.data.requests.approval_hours, 1)} ч` : '–'} hint="среднее у руководителя" icon={<Inbox className="h-4 w-4" />} tone="amber" />
        </div>
      )}
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        className="mb-5"
        items={[
          { value: 'vacations', label: '🌴 Отпуска' },
          { value: 'learning', label: '🎓 Обучение' },
          { value: 'requests', label: '📨 Заявки' },
          { value: 'ai', label: '🤖 AI Jana' },
          { value: 'logistics', label: '🚚 Логистика и нагрузка' },
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
  const heat = useAnalytics<Heatmap>('vacation_heatmap')
  const charts = useHrCharts()
  const currentMonth = new Date().getMonth()
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`Тепловая карта отпусков · ${heat.data?.year ?? ''}`}
          subtitle="% сотрудников отдела в отпуске в этом месяце (факт и план)"
          action={
            heat.data && (
              <Button
                size="sm"
                variant="outline"
                icon={<Download className="h-4 w-4" />}
                onClick={() =>
                  void exportXlsx('Отпуска по отделам', ['Подразделение', 'Человек', ...heat.data!.months.map((m) => `${m}, %`)], heat.data!.rows.map((r) => [r.department, r.headcount, ...r.values]))
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
                  <th className="w-48 text-left font-medium text-muted">Подразделение</th>
                  {heat.data.months.map((m, i) => (
                    <th key={m} className={cn('font-medium text-muted', i === currentMonth && 'text-brand-700')}>
                      {m}
                      {i > currentMonth && <span className="block text-[9px] text-violet-600">план</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heat.data.rows.map((r) => (
                  <tr key={r.department}>
                    <td className="truncate pr-2 text-left text-[12.5px] font-medium text-ink">
                      {r.department} <span className="text-muted">· {r.headcount}</span>
                    </td>
                    {r.values.map((v, i) => (
                      <td key={i} className={cn('h-9 rounded-md font-semibold tabular-nums', heatColor(v))} title={`${r.department}, ${heat.data!.months[i]}: ${v}% сотрудников, ${r.days[i]} дн.`}>
                        {v > 0 ? `${v}%` : '·'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>Шкала:</span>
            {[
              ['bg-brand-100', '< 15%'],
              ['bg-brand-300', '15–30%'],
              ['bg-amber-300', '30–50%'],
              ['bg-rose-400', '≥ 50%: риск для смены'],
            ].map(([c, l]) => (
              <span key={l} className="inline-flex items-center gap-1.5">
                <span className={cn('h-3 w-3 rounded', c)} /> {l}
              </span>
            ))}
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Дни отпуска по месяцам" subtitle={`Факт за 12 месяцев и прогноз на 3 месяца. Тренд год к году: ×${charts.data?.vacation_monthly.trend ?? '–'}`} action={<ForecastBadge />} />
        <div className="px-3 pb-4">{charts.data ? <VacationMonthlyChart data={charts.data.vacation_monthly} /> : <Skeleton className="h-60" />}</div>
        <p className="px-5 pb-5 text-xs text-muted">
          Метод: прогноз месяца = max(уже запланированные дни, дни того же месяца год назад × тренд последних 6 месяцев к тем же месяцам прошлого года). Это оценка на демо-данных, а не обещание.
        </p>
      </Card>
    </div>
  )
}

/* ---------- Обучение ---------- */

function LearningTab() {
  const funnel = useAnalytics<{ assigned: number; started: number; lessons_done: number; passed: number }>('learning_funnel')
  const forecast = useAnalytics<{ total: number; completed: number; pct: number; rate_per_week: number; eta: string | null; series: { day: string; actual: number | null; forecast: number | null }[] }>('learning_forecast')
  const charts = useHrCharts()
  const steps = funnel.data
    ? [
        { label: 'Назначено', value: funnel.data.assigned },
        { label: 'Начато', value: funnel.data.started },
        { label: 'Материал изучен', value: funnel.data.lessons_done },
        { label: 'Тест сдан', value: funnel.data.passed },
      ]
    : []
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Воронка обязательного обучения" subtitle="назначено → начато → завершено → тест сдан" />
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
          title="Прогноз даты 100%"
          subtitle={forecast.data ? `Сейчас ${forecast.data.pct}% · темп ${forecast.data.rate_per_week} завершений/нед.` : ''}
          action={<ForecastBadge />}
        />
        <div className="px-3 pb-3">
          {forecast.data ? (
            <SimpleLine
              data={forecast.data.series}
              x="day"
              unit="%"
              lines={[
                { key: 'actual', name: 'Факт, %', color: CHART_COLORS.brand },
                { key: 'forecast', name: 'Прогноз по тренду, %', color: CHART_COLORS.violet, dashed: true },
              ]}
            />
          ) : (
            <Skeleton className="h-60" />
          )}
        </div>
        {forecast.data && (
          <div className="mx-5 mb-5 rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-900">
            {forecast.data.eta ? (
              <>
                При текущем темпе 100% обязательного обучения будет достигнуто примерно <b>{fmtDate(forecast.data.eta)}</b> (прогноз). Ускорить можно напоминанием из «Зоны внимания».
              </>
            ) : (
              'Темп за 4 недели нулевой, прогноз невозможен. Напомните сотрудникам о курсах.'
            )}
          </div>
        )}
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader title="Прохождение по отделам" subtitle="% пройденных обязательных курсов" />
        <div className="px-3 pb-4">
          {charts.data ? (
            <ResponsiveContainer width="100%" height={Math.max(220, charts.data.learning_by_department.length * 34)}>
              <BarChart data={[...charts.data.learning_by_department].sort((a, b) => a.pct - b.pct)} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e3e9e4" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} unit="%" tick={axis} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="department" width={170} tick={axis} tickLine={false} axisLine={false} />
                <Tooltip {...tooltipStyle} formatter={(v, _n, item) => [`${v}% (${(item.payload as HrCharts['learning_by_department'][number]).completed}/${(item.payload as HrCharts['learning_by_department'][number]).assigned})`, 'Пройдено']} />
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

const STAGE_LABEL = { manager: 'У руководителя', hr: 'У HR', '1c': 'В 1С:ЗУП' }

function RequestsTab() {
  const times = useAnalytics<StageTimes>('request_stage_times')
  const charts = useHrCharts()
  const stages = times.data?.stages ?? []
  const bottleneck = stages.length ? stages.reduce((acc, s) => (s.avg_hours > acc.avg_hours ? s : acc)) : null
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Время на каждом этапе" subtitle="Среднее, часы · последние 120 дней" />
        <div className="space-y-4 px-5 pb-5">
          {!times.data && <Skeleton className="h-40" />}
          {stages.map((s) => {
            const max = Math.max(...stages.map((x) => x.avg_hours), 1)
            const isNeck = bottleneck?.stage === s.stage
            return (
              <div key={s.stage}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {STAGE_LABEL[s.stage]} {isNeck && <Badge className="ml-1 bg-rose-50 text-rose-700 ring-rose-200">узкое место</Badge>}
                  </span>
                  <span className="text-muted">
                    {num(s.avg_hours, 1)} ч · макс {num(s.max_hours, 0)} ч · {s.count} заявок
                  </span>
                </div>
                <div className="h-7 overflow-hidden rounded-lg bg-canvas">
                  <div className={cn('h-full rounded-lg', isNeck ? 'bg-rose-400' : 'bg-brand-500')} style={{ width: `${Math.max(3, (s.avg_hours / max) * 100)}%` }} />
                </div>
              </div>
            )
          })}
          {bottleneck && (
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Дольше всего заявки ждут на этапе «{STAGE_LABEL[bottleneck.stage]}»: в среднем {num(bottleneck.avg_hours, 1)} ч.
              {bottleneck.stage === 'manager' ? ' Используйте «Поторопить» в канбане заявок.' : ''}
            </div>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Скорость согласования по руководителям"
          subtitle="Среднее время до решения, часы"
          action={
            times.data?.by_manager && (
              <Button size="sm" variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => void exportXlsx('Согласование по руководителям', ['Руководитель', 'Заявок', 'Среднее время, ч'], times.data!.by_manager!.map((m) => [m.manager, m.count, m.avg_hours]))}>
                Excel
              </Button>
            )
          }
        />
        <ul className="divide-y divide-line border-t border-line">
          {(times.data?.by_manager ?? []).map((m) => (
            <li key={m.manager} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{m.manager}</span>
              <span className="text-muted">{m.count} заявок</span>
              <span className={cn('w-20 text-right font-semibold tabular-nums', m.avg_hours > 24 ? 'text-rose-600' : 'text-ink')}>{num(m.avg_hours, 1)} ч</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader title="Заявки по неделям" subtitle="Последние 12 недель по типам" />
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
  const { data } = useAnalytics<AiInsights>('ai_insights')
  if (!data) return <Skeleton className="h-80" />
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="grid grid-cols-2 gap-3 xl:col-span-2 xl:grid-cols-4">
        <Kpi label="Вопросов за 30 дней" value={num(data.total)} icon={<Bot className="h-4 w-4" />} />
        <Kpi label="Отвечено по базе" value={`${data.answered_pct}%`} icon={<Bot className="h-4 w-4" />} tone="brand" />
        <Kpi label="Без ответа" value={`${100 - data.answered_pct}%`} hint="эскалация в HR" icon={<AlertTriangle className="h-4 w-4" />} tone="amber" />
        <Kpi label="Открытых обращений" value={num(data.tickets_open)} icon={<Inbox className="h-4 w-4" />} tone="rose" to="/tickets" />
      </div>
      <Card>
        <CardHeader title="Топ вопросов" subtitle="Что чаще всего спрашивают сотрудники" />
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
        <CardHeader title="Какие положения дописать в базу знаний" subtitle="Вопросы, на которые у AI Jana не было надёжного ответа" />
        <ul className="space-y-2 px-5 pb-5">
          {data.unanswered.length === 0 && <Empty title="Пробелов нет" />}
          {data.unanswered.map((u) => (
            <li key={u.question} className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm">
              <div className="font-medium text-ink">«{u.question}»</div>
              <div className="mt-1 flex items-center justify-between gap-2 text-amber-900">
                <span>{u.suggestion}</span>
                <span className="shrink-0 text-xs">спросили {u.count}×</span>
              </div>
            </li>
          ))}
          <Link to="/tickets" className="inline-block pt-1 text-sm font-medium text-brand-700 hover:underline">
            Ответить в очереди обращений и добавить в базу →
          </Link>
        </ul>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader title="Самые используемые источники" subtitle="На какие статьи базы знаний AI Jana ссылается чаще" />
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
  summary: { peak_day: string; peak_volume: number; peak_required_staff: number; current_staff: number; usual_staff: number; available_staff: number; staff_gap: number; on_vacation_at_peak: number }
}

function LogisticsTab() {
  const { data, isLoading, error } = useAnalytics<Logistics>('logistics_overview', { p_days: 30, p_horizon: 45 })
  const combined = useMemo(() => {
    if (!data) return []
    const hist = (data.daily ?? []).slice(-30).map((d) => ({ day: d.day, fact: d.parcels_in, forecast: null as number | null, band: null as [number, number] | null }))
    const fc = (data.forecast ?? []).map((f) => ({ day: f.day, fact: null as number | null, forecast: f.forecast, band: [f.lower, f.upper] as [number, number] }))
    if (hist.length && fc.length) hist[hist.length - 1].forecast = hist[hist.length - 1].fact
    return [...hist, ...fc]
  }, [data])
  if (isLoading) return <Skeleton className="h-96" />
  if (error || !data) return <Card><Empty icon={<Truck className="h-6 w-6" />} title="Нет данных логистики" /></Card>
  const t = data.totals
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Посылок за 30 дней" value={num(t.parcels_in)} hint={`${t.parcels_change_pct >= 0 ? '+' : ''}${t.parcels_change_pct}% к пред. периоду`} icon={<Truck className="h-4 w-4" />} />
        <Kpi label="Доставлено в срок" value={`${t.on_time_pct}%`} hint={`было ${t.on_time_prev_pct}%`} tone="sky" />
        <Kpi label="Выполнение плана обработки" value={`${t.plan_pct}%`} hint={`ошибки сортировки ${t.error_rate_pct}%`} tone="violet" />
        <Kpi label="Персонал на смене" value={num(t.avg_staff)} hint={`${t.productivity} посылок/чел. в день`} tone="amber" />
      </div>
      <Card>
        <CardHeader title="Входящий поток посылок и прогноз на 45 дней" subtitle="Тренд 8 недель × индекс дня недели × сезонные пики (после 11.11, перед Новым годом)" action={<ForecastBadge />} />
        <div className="px-3 pb-4">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={combined} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3e9e4" vertical={false} />
              <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} minTickGap={20} />
              <YAxis tick={axis} tickLine={false} axisLine={false} />
              <Tooltip {...tooltipStyle} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Area dataKey="band" name="Интервал прогноза" fill={CHART_COLORS.violet} fillOpacity={0.12} stroke="none" />
              <Line dataKey="fact" name="Факт" stroke={CHART_COLORS.brand} strokeWidth={2.5} dot={false} />
              <Line dataKey="forecast" name="Прогноз" stroke={CHART_COLORS.violet} strokeWidth={2.5} strokeDasharray="6 5" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Потребность в персонале на смене" subtitle="Нужно по прогнозу против обычной смены этого дня недели за вычетом отпусков" action={<ForecastBadge />} />
          <div className="px-3 pb-4">
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={data.forecast} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e3e9e4" vertical={false} />
                <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} minTickGap={20} />
                <YAxis tick={axis} tickLine={false} axisLine={false} />
                <Tooltip {...tooltipStyle} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="available_staff" name="Доступно" fill={CHART_COLORS.brandSoft} radius={[4, 4, 0, 0]} />
                <Line dataKey="required_staff" name="Нужно (прогноз)" stroke={CHART_COLORS.rose} strokeWidth={2.5} strokeDasharray="6 5" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold">Вывод для HR</h3>
          <p className="mt-2 text-sm text-ink-soft">
            Пик ожидается <b>{data.summary.peak_day}</b>: ~{num(data.summary.peak_volume)} посылок в сутки. Нужно {data.summary.peak_required_staff} чел. на смене, а обычно в этот день недели выходит {data.summary.usual_staff}
            {data.summary.on_vacation_at_peak > 0 && <>, из них в отпуске {data.summary.on_vacation_at_peak}</>}.
          </p>
          <div className={cn('mt-4 rounded-xl px-4 py-3 text-sm', data.summary.staff_gap > 0 ? 'bg-rose-50 text-rose-900' : 'bg-brand-50 text-brand-900')}>
            {data.summary.staff_gap > 0 ? (
              <>
                Нехватка ~<b>{data.summary.staff_gap} чел.</b> на смене в пик (прогноз). Варианты: временный персонал, переработка по графику, перенос отпусков с пиковых дат.
              </>
            ) : (
              'Текущего штата хватает на прогнозный пик.'
            )}
          </div>
          <h4 className="mt-5 mb-2 text-sm font-semibold">По точкам (30 дней)</h4>
          <ul className="space-y-2 text-sm">
            {data.by_location.map((l) => (
              <li key={l.location} className="flex items-center justify-between gap-2">
                <span className="truncate">{l.location}</span>
                <span className="shrink-0 text-muted">
                  {num(l.parcels_in)} · в срок {l.on_time_pct}%
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}
