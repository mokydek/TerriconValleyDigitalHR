import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  CalendarDays,
  Clock3,
  FileText,
  GraduationCap,
  HeartPulse,
  Inbox,
  MessageCircleQuestion,
  Palmtree,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { useDecideRequest, useHrCharts, useHrDashboard, useMyAssignments, useRefreshWatchAlerts, useTickets, useWorkRequests } from '@/lib/api'
import { fmtDate, fullName, num, todayLabel } from '@/lib/format'
import { useQuery } from '@tanstack/react-query'
import { must, supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { Avatar, Button, Card, CardHeader, Empty, ErrorBox, Kpi, Skeleton } from '@/components/ui'
import { MyLearningCard, MyRequestsCard, MyTasksCard, NewsCard, NotificationsCard, ProfileCard } from '@/components/home/Widgets'
import { RequestDrawer } from '@/components/requests/RequestDrawer'
import { requestSummary, TypeLabel, WaitingTimer } from '@/components/requests/RequestParts'
import { AttentionZone, WatchlistCard } from '@/components/hr/HrBlocks'
import { ForecastBadge, HeadcountChart, LearningByDeptChart, RequestsWeeklyChart, VacationMonthlyChart } from '@/components/charts/HrCharts'
import type { HrRequest } from '@/lib/types'

function greeting(t: ReturnType<typeof useI18n>['t']) {
  const h = new Date().getHours()
  return h < 12 ? t('home.morning') : h < 18 ? t('home.day') : t('home.evening')
}

function QuickServices() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const items = [
    { label: t('home.qVacation'), icon: <Palmtree className="h-5 w-5" />, to: '/requests?new=vacation', tone: 'bg-emerald-50 text-emerald-700' },
    { label: t('home.qAdvance'), icon: <Wallet className="h-5 w-5" />, to: '/requests?new=advance', tone: 'bg-sky-50 text-sky-700' },
    { label: t('home.qCertificate'), icon: <FileText className="h-5 w-5" />, to: '/requests?new=certificate', tone: 'bg-violet-50 text-violet-700' },
    { label: t('home.qAsk'), icon: <Sparkles className="h-5 w-5" />, to: '/assistant', tone: 'bg-amber-50 text-amber-700' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((it) => (
        <button
          key={it.label}
          onClick={() => navigate(it.to)}
          className="card group flex items-center gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:border-brand-300"
          data-testid={`quick-${it.to.split('=')[1] ?? 'ai'}`}
        >
          <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', it.tone)}>{it.icon}</span>
          <span className="text-[14.5px] leading-tight font-semibold text-ink">{it.label}</span>
        </button>
      ))}
    </div>
  )
}

function WelcomeBanner() {
  const { me } = useAuth()
  const { data } = useMyAssignments()
  const welcome = (data ?? []).find((a) => a.course?.slug === 'welcome' && a.status !== 'completed')
  if (!me || !welcome) return null
  return (
    <div className="mb-6 flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-brand-600 to-brand-800 p-5 text-white sm:flex-row sm:items-center">
      <div className="text-4xl">👋</div>
      <div className="flex-1">
        <div className="text-lg font-semibold">Добро пожаловать в Jana Post, {me.first_name}!</div>
        <div className="text-sm text-white/85">Начните с адаптационного курса — 25 минут о компании, ценностях и о том, как работает JanaМен.</div>
      </div>
      <Link to="/academy/welcome" className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50">
        Начать курс <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  )
}

function Greeting({ title, subtitle }: { title?: string; subtitle?: string }) {
  const { me } = useAuth()
  const { t } = useI18n()
  return (
    <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-medium text-muted">{todayLabel()}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-[28px]">{title ?? `${greeting(t)}, ${me?.first_name}!`}</h1>
        <p className="mt-1 text-[15px] text-muted">{subtitle ?? t('home.subtitle')}</p>
      </div>
    </div>
  )
}

/* ================= Руководитель: согласования команды ================= */

function TeamApprovals() {
  const { me } = useAuth()
  const { data, isLoading } = useWorkRequests(0)
  const decide = useDecideRequest()
  const [open, setOpen] = useState<HrRequest | null>(null)
  const mine = (data ?? []).filter((r) => r.status === 'pending' && r.approver_id === me?.id)
  return (
    <Card>
      <CardHeader
        icon={<Inbox className="h-[18px] w-[18px]" />}
        title="Ждут вашего решения"
        subtitle="Заявки вашей команды — видите только своих сотрудников"
        action={
          <Link to="/approvals" className="text-sm font-medium text-brand-700 hover:underline">
            Все согласования
          </Link>
        }
      />
      <ul className="divide-y divide-line border-t border-line">
        {isLoading && (
          <li className="p-5">
            <Skeleton className="h-12" />
          </li>
        )}
        {!isLoading && mine.length === 0 && (
          <li>
            <Empty icon={<BadgeCheck className="h-6 w-6" />} title="Все заявки рассмотрены" />
          </li>
        )}
        {mine.map((r) => (
          <li key={r.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
            <button onClick={() => setOpen(r)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <Avatar name={fullName(r.employee)} size={36} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{fullName(r.employee)}</div>
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
                  <TypeLabel type={r.type} /> · {requestSummary(r)} <WaitingTimer since={r.created_at} />
                </div>
              </div>
            </button>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpen(r)}>
                Подробнее
              </Button>
              <Button
                size="sm"
                loading={decide.isPending && decide.variables?.id === r.id}
                onClick={async () => {
                  try {
                    await decide.mutateAsync({ id: r.id, action: 'approve' })
                    toast.success(`Заявка №${r.number} согласована`, { description: 'Передана в HR на оформление' })
                  } catch (e) {
                    toast.error((e as Error).message)
                  }
                }}
                data-testid={`approve-${r.number}`}
              >
                Согласовать
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <RequestDrawer request={open} onClose={() => setOpen(null)} />
    </Card>
  )
}

function TeamToday() {
  const { data, isLoading } = useQuery({
    queryKey: ['team-absences-30d'],
    queryFn: async () => {
      const from = new Date()
      const to = new Date(Date.now() + 30 * 86400_000)
      return (await must(
        supabase.rpc('team_absences', { p_from: from.toISOString().slice(0, 10), p_to: to.toISOString().slice(0, 10) }),
      )) as { request_id: string; employee_id: string; full_name: string; job_title: string; start_date: string; end_date: string; status: string }[]
    },
  })
  const { me } = useAuth()
  const list = (data ?? []).filter((x) => x.employee_id !== me?.id)
  return (
    <Card>
      <CardHeader icon={<CalendarDays className="h-[18px] w-[18px]" />} title="Отпуска команды" subtitle="Ближайшие 30 дней" />
      <ul className="space-y-1 px-2 pb-3">
        {isLoading && <Skeleton className="mx-3 h-10" />}
        {!isLoading && list.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted">Никто не уходит в отпуск</p>}
        {list.map((x) => {
          const now = new Date().toISOString().slice(0, 10)
          const active = x.start_date <= now && x.end_date >= now
          return (
            <li key={x.request_id} className="flex items-center gap-3 rounded-xl px-3 py-2">
              <Avatar name={x.full_name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{x.full_name}</div>
                <div className="text-xs text-muted">
                  {fmtDate(x.start_date, 'd MMM')} — {fmtDate(x.end_date, 'd MMM')}
                  {x.status !== 'done' && x.status !== 'processing' && ' · ещё не оформлено'}
                </div>
              </div>
              {active && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">в отпуске</span>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function TeamKpis() {
  const { data } = useHrDashboard()
  if (!data) return <Skeleton className="h-24" />
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi label="В команде" value={num(data.headcount)} hint={`в отпуске сегодня: ${data.on_vacation_today}`} icon={<Users className="h-4 w-4" />} to="/team" />
      <Kpi label="Ждут решения" value={num(data.requests.at_manager)} hint="у руководителей команды" icon={<Inbox className="h-4 w-4" />} tone="amber" to="/approvals" />
      <Kpi label="Обязательное обучение" value={`${data.learning.mandatory_pct}%`} hint={`просрочено: ${data.learning.overdue}`} icon={<GraduationCap className="h-4 w-4" />} tone="violet" to="/analytics" />
      <Kpi label="Задачи после срока" value={num(data.tasks.overdue)} hint={`открыто: ${data.tasks.open}`} icon={<Clock3 className="h-4 w-4" />} tone="rose" to="/tasks" />
    </div>
  )
}

/* ================= HR: «Пульс компании» ================= */

function HrPulse() {
  const dash = useHrDashboard()
  const charts = useHrCharts()
  const tickets = useTickets('all')
  const work = useWorkRequests(0)
  useRefreshWatchAlerts(true)
  const openTickets = (tickets.data ?? []).filter((t) => t.status === 'open').length
  const atHr = (work.data ?? []).filter((r) => r.status === 'approved' || (r.status === 'pending' && r.approver?.role === 'hr')).length
  const d = dash.data

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-muted">{todayLabel()}</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-[28px]">
            <HeartPulse className="h-7 w-7 text-brand-600" /> Пульс компании
          </h1>
          <p className="mt-1 text-[15px] text-muted">Тот же JanaМен, но с обзором на всю компанию</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/approvals">
            <Button variant={atHr ? 'primary' : 'outline'} icon={<Inbox className="h-4 w-4" />}>
              Оформить заявки {atHr > 0 && <span className="rounded-full bg-white/25 px-1.5 text-xs">{atHr}</span>}
            </Button>
          </Link>
          <Link to="/tickets">
            <Button variant="outline" icon={<MessageCircleQuestion className="h-4 w-4" />}>
              Обращения {openTickets > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-xs text-white">{openTickets}</span>}
            </Button>
          </Link>
        </div>
      </div>

      {dash.error && <ErrorBox error={dash.error} onRetry={() => void dash.refetch()} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {!d ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[110px]" />)
        ) : (
          <>
            <Kpi label="Численность" value={num(d.headcount)} hint={`новичков за 90 дн.: ${d.newcomers_90d}`} icon={<Users className="h-4 w-4" />} to="/employees" />
            <Kpi label="Заявки в работе" value={num(d.requests.in_work)} hint={`у рук.: ${d.requests.at_manager} · у HR: ${d.requests.at_hr} · в 1С: ${d.requests.in_1c}`} icon={<Inbox className="h-4 w-4" />} tone="sky" to="/approvals" />
            <Kpi label="Среднее согласование" value={d.requests.approval_hours !== null ? `${num(d.requests.approval_hours, 1)} ч` : '—'} hint="от подачи до решения руководителя" icon={<Clock3 className="h-4 w-4" />} tone="amber" to="/analytics?tab=requests" />
            <Kpi label="Обязательное обучение" value={`${d.learning.mandatory_pct}%`} hint={`просрочено: ${d.learning.overdue}`} icon={<GraduationCap className="h-4 w-4" />} tone="violet" to="/analytics?tab=learning" />
            <Kpi label="Использование отпусков" value={`${d.vacation.usage_pct}%`} hint={`> 30 дн. накоплено: ${d.vacation.over_30} чел.`} icon={<Palmtree className="h-4 w-4" />} tone="brand" to="/analytics?tab=vacations" />
            <Kpi label="AI Jana не ответила" value={`${d.ai.no_answer_pct}%`} hint={`вопросов за 30 дн.: ${d.ai.queries_30d}`} icon={<Bot className="h-4 w-4" />} tone="rose" to="/analytics?tab=ai" />
          </>
        )}
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Заявки по неделям" subtitle="Последние 12 недель" />
          <div className="px-3 pb-4">{charts.data ? <RequestsWeeklyChart data={charts.data.requests_weekly} /> : <Skeleton className="mx-2 h-[240px]" />}</div>
        </Card>
        <Card>
          <CardHeader title="Отпуска по месяцам" subtitle="Дни отпуска: факт за год и прогноз на 3 месяца (тренд × сезонность)" action={<ForecastBadge />} />
          <div className="px-3 pb-4">{charts.data ? <VacationMonthlyChart data={charts.data.vacation_monthly} /> : <Skeleton className="mx-2 h-[240px]" />}</div>
        </Card>
        <Card>
          <CardHeader title="Обучение по отделам" subtitle="% пройденных обязательных курсов" />
          <div className="px-3 pb-4">{charts.data ? <LearningByDeptChart data={charts.data.learning_by_department} /> : <Skeleton className="mx-2 h-[240px]" />}</div>
        </Card>
        <Card>
          <CardHeader title="Численность по подразделениям" subtitle="Данные 1С:ЗУП" />
          <div className="px-3 pb-4">{charts.data ? <HeadcountChart data={charts.data.headcount_by_department} /> : <Skeleton className="mx-2 h-[240px]" />}</div>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <AttentionZone />
        <WatchlistCard />
      </div>
    </div>
  )
}

/* ================= Страница ================= */

export default function HomePage() {
  const { role } = useAuth()
  const [openRequest, setOpenRequest] = useState<string | null>(null)
  if (role === 'hr') return <HrPulse />

  return (
    <div>
      <Greeting />
      <WelcomeBanner />
      <QuickServices />

      {role === 'manager' && (
        <div className="mt-6 space-y-4">
          <TeamKpis />
          <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
            <TeamApprovals />
            <TeamToday />
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <MyRequestsCard onOpen={setOpenRequest} />
          <MyTasksCard />
          <NewsCard />
        </div>
        <div className="space-y-4">
          <ProfileCard />
          <MyLearningCard />
          <NotificationsCard />
        </div>
      </div>
      <MyRequestDrawer id={openRequest} onClose={() => setOpenRequest(null)} />
    </div>
  )
}

function MyRequestDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['requests', 'one', id],
    enabled: Boolean(id),
    queryFn: async () =>
      (await must(
        supabase
          .from('requests')
          .select(
            '*, employee:employees!requests_employee_fk(id,first_name,last_name,position,manager_id,department_id), approver:employees!requests_approver_fk(id,first_name,last_name,role)',
          )
          .eq('id', id!)
          .single(),
      )) as HrRequest,
  })
  if (!id || !data) return null
  return <RequestDrawer request={data} onClose={onClose} />
}
