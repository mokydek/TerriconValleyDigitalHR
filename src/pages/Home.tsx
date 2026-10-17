import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  BellRing,
  Bot,
  CalendarDays,
  ClipboardList,
  Clock3,
  Eye,
  FileText,
  GraduationCap,
  HeartPulse,
  Inbox,
  LayoutGrid,
  LineChart,
  Megaphone,
  MessageCircleQuestion,
  Palmtree,
  Sparkles,
  Users,
  Wallet,
} from '@/components/icons'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import {
  useAnnouncements,
  useAttentionZone,
  useDecideRequest,
  useHrCharts,
  useHrDashboard,
  useMyAssignments,
  useMyRequests,
  useNotifications,
  usePeople,
  useRefreshWatchAlerts,
  useTasks,
  useTickets,
  useWorkRequests,
} from '@/lib/api'
import { fmtDate, fullName, num, todayLabel } from '@/lib/format'
import { useQuery } from '@tanstack/react-query'
import { must, supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { Avatar, Button, Card, CardHeader, Empty, ErrorBox, Kpi, Skeleton, Tabs } from '@/components/ui'
import { MyLearningCard, MyRequestsCard, MyTasksCard, NewsCard, NotificationsCard, ProfileCard } from '@/components/home/Widgets'
import { RequestDrawer } from '@/components/requests/RequestDrawer'
import { requestSummary, TypeLabel, WaitingTimer } from '@/components/requests/RequestParts'
import { AttentionZone, WatchlistCard } from '@/components/hr/HrBlocks'
import { ForecastBadge, HeadcountChart, LearningByDeptChart, RequestsWeeklyChart, VacationMonthlyChart } from '@/components/charts/HrCharts'
import type { HrRequest } from '@/lib/types'
import { TabLabel, useTabParam } from '@/lib/tabs'

function greeting(t: ReturnType<typeof useI18n>['t'], name: string) {
  const h = new Date().getHours()
  return h < 12 ? t('home.morning', { name }) : h < 18 ? t('home.day', { name }) : t('home.evening', { name })
}

function QuickServices() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const items = [
    { label: t('home.qVacation'), icon: <Palmtree className="h-5 w-5" />, to: '/requests?new=vacation', tone: 'bg-brand-50 text-brand-700' },
    { label: t('home.qAdvance'), icon: <Wallet className="h-5 w-5" />, to: '/requests?new=advance', tone: 'bg-brand-50 text-brand-700' },
    { label: t('home.qCertificate'), icon: <FileText className="h-5 w-5" />, to: '/requests?new=certificate', tone: 'bg-brand-50 text-brand-700' },
    { label: t('home.qAsk'), icon: <Sparkles className="h-5 w-5" />, to: '/assistant', tone: 'bg-brand-50 text-brand-700' },
  ]
  return (
    // на телефоне — одна компактная строка из четырёх кнопок, чтобы главная помещалась без прокрутки
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
      {items.map((it) => (
        <button
          key={it.label}
          onClick={() => navigate(it.to)}
          className="card group flex min-w-0 flex-col items-center gap-1.5 px-1 py-3 text-center transition hover:-translate-y-0.5 hover:border-brand-300 sm:flex-row sm:gap-3 sm:p-4 sm:text-left"
          data-testid={`quick-${it.to.split('=')[1] ?? 'ai'}`}
        >
          <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl sm:h-11 sm:w-11', it.tone)}>{it.icon}</span>
          <span className="text-[12px] leading-tight font-semibold text-ink sm:text-[14.5px]">{it.label}</span>
        </button>
      ))}
    </div>
  )
}

function WelcomeBanner() {
  const { me } = useAuth()
  const { t } = useI18n()
  const { data } = useMyAssignments()
  const welcome = (data ?? []).find((a) => a.course?.slug === 'welcome' && a.status !== 'completed')
  if (!me || !welcome) return null
  return (
    <div className="mb-6 flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-brand-600 to-brand-800 p-5 text-white sm:flex-row sm:items-center">
      <div className="text-4xl">👋</div>
      <div className="flex-1">
        <div className="text-lg font-semibold">{t('home.welcomeTitle', { name: me.first_name })}</div>
        <div className="text-sm text-white/85">{t('home.welcomeText')}</div>
      </div>
      <Link to="/academy/welcome" className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50">
        {t('home.welcomeStart')} <ArrowRight className="h-4 w-4" />
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
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-[28px]">{title ?? greeting(t, me?.first_name ?? '')}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
    </div>
  )
}

/* ================= Руководитель: согласования команды ================= */

function TeamApprovals() {
  const { me } = useAuth()
  const { t } = useI18n()
  const { data, isLoading } = useWorkRequests(0)
  const decide = useDecideRequest()
  const [open, setOpen] = useState<HrRequest | null>(null)
  const mine = (data ?? []).filter((r) => r.status === 'pending' && r.approver_id === me?.id)
  return (
    <Card>
      <CardHeader
        icon={<Inbox className="h-[18px] w-[18px]" />}
        title={t('home.approvalsTitle')}
        action={
          <Link to="/approvals" className="text-sm font-medium text-brand-700 hover:underline">
            {t('home.allApprovals')}
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
            <Empty icon={<BadgeCheck className="h-6 w-6" />} title={t('home.approvalsEmpty')} />
          </li>
        )}
        {mine.map((r) => (
          <li key={r.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
            <button onClick={() => setOpen(r)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <Avatar id={r.employee?.id} name={fullName(r.employee)} size={36} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{fullName(r.employee)}</div>
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
                  <TypeLabel type={r.type} /> · {requestSummary(r)} <WaitingTimer since={r.created_at} />
                </div>
              </div>
            </button>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpen(r)}>
                {t('common.more')}
              </Button>
              <Button
                size="sm"
                loading={decide.isPending && decide.variables?.id === r.id}
                onClick={async () => {
                  try {
                    await decide.mutateAsync({ id: r.id, action: 'approve' })
                    toast.success(t('home.approvedToast', { n: r.number }), { description: t('home.approvedToastText') })
                  } catch (e) {
                    toast.error((e as Error).message)
                  }
                }}
                data-testid={`approve-${r.number}`}
              >
                {t('home.approve')}
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
  const { t } = useI18n()
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
      <CardHeader icon={<CalendarDays className="h-[18px] w-[18px]" />} title={t('home.teamVacations')} subtitle={t('home.next30Days')} />
      <ul className="space-y-1 px-2 pb-3">
        {isLoading && <Skeleton className="mx-3 h-10" />}
        {!isLoading && list.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted">{t('home.teamNoVacations')}</p>}
        {list.map((x) => {
          const now = new Date().toISOString().slice(0, 10)
          const active = x.start_date <= now && x.end_date >= now
          return (
            <li key={x.request_id} className="flex items-center gap-3 rounded-xl px-3 py-2">
              <Avatar id={x.employee_id} name={x.full_name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{x.full_name}</div>
                <div className="text-xs text-muted">
                  {fmtDate(x.start_date, 'd MMM')} – {fmtDate(x.end_date, 'd MMM')}
                  {x.status !== 'done' && x.status !== 'processing' && ` · ${t('home.notProcessed')}`}
                </div>
              </div>
              {active && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{t('home.onVacation')}</span>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function TeamKpis() {
  const { t } = useI18n()
  const { data } = useHrDashboard()
  if (!data) return <Skeleton className="h-24" />
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi label={t('home.kpi.team')} value={num(data.headcount)} hint={t('home.kpi.teamHint', { n: data.on_vacation_today })} icon={<Users className="h-4 w-4" />} to="/team" />
      <Kpi label={t('home.kpi.waiting')} value={num(data.requests.at_manager)} hint={t('home.kpi.waitingHint')} icon={<Inbox className="h-4 w-4" />} tone="amber" to="/approvals" />
      <Kpi label={t('home.kpi.mandatory')} value={`${data.learning.mandatory_pct}%`} hint={t('home.kpi.overdue', { n: data.learning.overdue })} icon={<GraduationCap className="h-4 w-4" />} tone="violet" to="/analytics" />
      <Kpi label={t('home.kpi.tasksOverdue')} value={num(data.tasks.overdue)} hint={t('home.kpi.tasksOpen', { n: data.tasks.open })} icon={<Clock3 className="h-4 w-4" />} tone="rose" to="/tasks" />
    </div>
  )
}

/* ================= HR: «Пульс компании» ================= */

const PULSE_TABS = ['attention', 'watchlist', 'charts'] as const
type PulseTab = (typeof PULSE_TABS)[number]

function PulseCharts() {
  const { t } = useI18n()
  const charts = useHrCharts()
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title={t('home.chart.weekly')} subtitle={t('home.chart.weeklySub')} />
        <div className="px-3 pb-4">{charts.data ? <RequestsWeeklyChart data={charts.data.requests_weekly} /> : <Skeleton className="mx-2 h-[240px]" />}</div>
      </Card>
      <Card>
        <CardHeader title={t('home.chart.vacations')} subtitle={t('home.chart.vacationsSub')} action={<ForecastBadge />} />
        <div className="px-3 pb-4">{charts.data ? <VacationMonthlyChart data={charts.data.vacation_monthly} /> : <Skeleton className="mx-2 h-[240px]" />}</div>
      </Card>
      <Card>
        <CardHeader title={t('home.chart.learning')} subtitle={t('home.chart.learningSub')} />
        <div className="px-3 pb-4">{charts.data ? <LearningByDeptChart data={charts.data.learning_by_department} /> : <Skeleton className="mx-2 h-[240px]" />}</div>
      </Card>
      <Card>
        <CardHeader title={t('home.chart.headcount')} subtitle={t('home.chart.headcountSub')} />
        <div className="px-3 pb-4">{charts.data ? <HeadcountChart data={charts.data.headcount_by_department} /> : <Skeleton className="mx-2 h-[240px]" />}</div>
      </Card>
    </div>
  )
}

function HrPulse() {
  const { t } = useI18n()
  const dash = useHrDashboard()
  const tickets = useTickets('all')
  const work = useWorkRequests(0)
  const attention = useAttentionZone()
  const people = usePeople()
  const [tab, setTab] = useTabParam<PulseTab>(PULSE_TABS, 'attention')
  useRefreshWatchAlerts(true)
  const openTickets = (tickets.data ?? []).filter((x) => x.status === 'open').length
  const atHr = (work.data ?? []).filter((r) => r.status === 'approved' || (r.status === 'pending' && r.approver?.role === 'hr')).length
  const d = dash.data

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-muted">{todayLabel()}</p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-[28px]">
            <HeartPulse className="h-7 w-7 text-brand-600" /> {t('nav.pulse')}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/approvals">
            <Button variant={atHr ? 'primary' : 'outline'} icon={<Inbox className="h-4 w-4" />}>
              {t('home.processRequests')} {atHr > 0 && <span className="rounded-full bg-white/25 px-1.5 text-xs">{atHr}</span>}
            </Button>
          </Link>
          <Link to="/tickets">
            <Button variant="outline" icon={<MessageCircleQuestion className="h-4 w-4" />}>
              {t('home.tickets')} {openTickets > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-xs text-white">{openTickets}</span>}
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
            <Kpi label={t('hr.headcount')} value={num(d.headcount)} hint={t('home.kpi.headcountHint', { n: d.newcomers_90d })} icon={<Users className="h-4 w-4" />} to="/employees" />
            <Kpi label={t('home.kpi.inWork')} value={num(d.requests.in_work)} hint={t('home.kpi.inWorkHint', { mgr: d.requests.at_manager, hr: d.requests.at_hr, erp: d.requests.in_1c })} icon={<Inbox className="h-4 w-4" />} tone="sky" to="/approvals" />
            <Kpi label={t('home.kpi.approvalTime')} value={d.requests.approval_hours !== null ? t('home.kpi.hours', { v: num(d.requests.approval_hours, 1) }) : '–'} hint={t('home.kpi.approvalTimeHint')} icon={<Clock3 className="h-4 w-4" />} tone="amber" to="/analytics?tab=requests" />
            <Kpi label={t('home.kpi.mandatory')} value={`${d.learning.mandatory_pct}%`} hint={t('home.kpi.overdue', { n: d.learning.overdue })} icon={<GraduationCap className="h-4 w-4" />} tone="violet" to="/analytics?tab=learning" />
            <Kpi label={t('home.kpi.vacationUsage')} value={`${d.vacation.usage_pct}%`} hint={t('home.kpi.vacationUsageHint', { n: d.vacation.over_30 })} icon={<Palmtree className="h-4 w-4" />} tone="brand" to="/analytics?tab=vacations" />
            <Kpi label={t('home.kpi.aiNoAnswer')} value={`${d.ai.no_answer_pct}%`} hint={t('home.kpi.aiNoAnswerHint', { n: d.ai.queries_30d })} icon={<Bot className="h-4 w-4" />} tone="rose" to="/analytics?tab=ai" />
          </>
        )}
      </div>

      <Tabs<PulseTab>
        value={tab}
        onChange={setTab}
        className="mt-6 mb-4"
        items={[
          { value: 'attention', label: <TabLabel icon={<BellRing className="h-4 w-4" />}>{t('hr.attention')}</TabLabel>, count: attention.data?.length },
          { value: 'watchlist', label: <TabLabel icon={<Eye className="h-4 w-4" />}>{t('hr.watchlist')}</TabLabel>, count: (people.data ?? []).filter((p) => p.followed).length },
          { value: 'charts', label: <TabLabel icon={<LineChart className="h-4 w-4" />}>{t('home.tabCharts')}</TabLabel> },
        ]}
      />
      {tab === 'attention' && <AttentionZone />}
      {tab === 'watchlist' && (
        <div className="max-w-3xl">
          <WatchlistCard />
        </div>
      )}
      {tab === 'charts' && <PulseCharts />}
    </div>
  )
}

/* ================= Работник и руководитель ================= */

const WORK_TABS = ['team', 'overview', 'tasks', 'learning', 'news', 'notifications'] as const
type WorkTab = (typeof WORK_TABS)[number]

function WorkerHome({ manager, teamPending = 0 }: { manager?: boolean; teamPending?: number }) {
  const { t } = useI18n()
  const [openRequest, setOpenRequest] = useState<string | null>(null)
  const [tab, setTab] = useTabParam<WorkTab>(manager ? WORK_TABS : WORK_TABS.slice(1), manager ? 'team' : 'overview')
  // те же запросы, что у карточек вкладок, — данные берутся из общего кэша
  const requests = useMyRequests()
  const tasks = useTasks('mine')
  const learning = useMyAssignments()
  const news = useAnnouncements(10)
  const notifications = useNotifications()
  const icon = 'h-4 w-4'

  const items: { value: WorkTab; label: ReactNode; count?: number }[] = [
    ...(manager ? [{ value: 'team' as const, label: <TabLabel icon={<Users className={icon} />}>{t('home.tabTeam')}</TabLabel>, count: teamPending }] : []),
    {
      value: 'overview',
      label: <TabLabel icon={<LayoutGrid className={icon} />}>{t('home.tabOverview')}</TabLabel>,
      count: (requests.data ?? []).filter((r) => r.status === 'pending' || r.status === 'approved' || r.status === 'processing').length,
    },
    { value: 'tasks', label: <TabLabel icon={<ClipboardList className={icon} />}>{t('home.tabTasks')}</TabLabel>, count: (tasks.data ?? []).filter((x) => x.status !== 'done').length },
    { value: 'learning', label: <TabLabel icon={<GraduationCap className={icon} />}>{t('home.tabLearning')}</TabLabel>, count: (learning.data ?? []).filter((a) => a.status !== 'completed').length },
    { value: 'news', label: <TabLabel icon={<Megaphone className={icon} />}>{t('home.tabNews')}</TabLabel>, count: (news.data ?? []).filter((a) => !a.read).length },
    { value: 'notifications', label: <TabLabel icon={<Bell className={icon} />}>{t('home.tabNotifications')}</TabLabel>, count: (notifications.data ?? []).filter((n) => !n.read_at).length },
  ]

  return (
    <div>
      <Greeting />
      <WelcomeBanner />
      <QuickServices />

      <Tabs<WorkTab> value={tab} onChange={setTab} items={items} className="mt-6 mb-4" />

      {tab === 'team' && (
        <div className="space-y-4">
          <TeamKpis />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
            <TeamApprovals />
            <TeamToday />
          </div>
        </div>
      )}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
          {/* на телефоне сначала профиль и остаток отпуска */}
          <div className="min-w-0 lg:order-2">
            <ProfileCard />
          </div>
          <div className="min-w-0 lg:order-1">
            <MyRequestsCard onOpen={setOpenRequest} />
          </div>
        </div>
      )}
      <div className="max-w-3xl">
        {tab === 'tasks' && <MyTasksCard />}
        {tab === 'learning' && <MyLearningCard />}
        {tab === 'news' && <NewsCard limit={6} />}
        {tab === 'notifications' && <NotificationsCard />}
      </div>
      <MyRequestDrawer id={openRequest} onClose={() => setOpenRequest(null)} />
    </div>
  )
}

function ManagerHome() {
  const { me } = useAuth()
  const work = useWorkRequests(0)
  const pending = (work.data ?? []).filter((r) => r.status === 'pending' && r.approver_id === me?.id).length
  return <WorkerHome manager teamPending={pending} />
}

/* ================= Страница ================= */

export default function HomePage() {
  const { role } = useAuth()
  if (role === 'hr') return <HrPulse />
  if (role === 'manager') return <ManagerHome />
  return <WorkerHome />
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
