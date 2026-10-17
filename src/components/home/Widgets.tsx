import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Bell, CheckCircle2, ClipboardList, FileStack, GraduationCap, Megaphone, Palmtree, Pin } from '@/components/icons'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { useAnnouncements, useMarkNotificationRead, useMyAssignments, useMyRequests, useNotifications, useTasks, useVacationBalance } from '@/lib/api'
import { ANNOUNCEMENT_CATEGORIES } from '@/lib/constants'
import { days, entitledText, fmtDate, fullName, timeAgo } from '@/lib/format'
import { serverText } from '@/lib/serverText'
import { cn } from '@/lib/utils'
import { Avatar, Badge, Card, CardHeader, Empty, Progress, ProgressRing, Skeleton } from '@/components/ui'
import { requestSummary, StatusBadge, TypeLabel } from '@/components/requests/RequestParts'
import { DeadlineChip, PriorityStars } from '@/components/tasks/TaskParts'
import { CourseIcon } from '@/components/academy/CourseIcon'

export function ProfileCard() {
  const { me } = useAuth()
  const { t } = useI18n()
  const balance = useVacationBalance()
  if (!me) return null
  const b = balance.data
  const usedPct = b && b.entitled > 0 ? ((b.used + b.reserved) / b.entitled) * 100 : 0
  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-5 pt-5 pb-14 text-white">
        <div className="flex items-center gap-3">
          <Avatar id={me.id} name={fullName(me)} size={48} className="ring-2 ring-white/40" />
          <div className="min-w-0">
            <div className="truncate text-[17px] font-semibold">{fullName(me)}</div>
            <div className="truncate text-sm text-white/80">{me.position}</div>
          </div>
        </div>
      </div>
      <div className="-mt-10 px-5 pb-5">
        <div className="rounded-2xl border border-line bg-white p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-4">
            <ProgressRing value={100 - usedPct} size={68}>
              <Palmtree className="h-5 w-5 text-brand-600" />
            </ProgressRing>
            <div>
              <div className="text-sm text-muted">{t('vac.balance')}</div>
              {balance.isLoading ? <Skeleton className="mt-1 h-7 w-24" /> : <div className="text-2xl font-bold text-ink" data-testid="vacation-available">{days(b?.available)}</div>}
              {b && (
                <div className="text-xs text-muted">
                  {t('vac.entitled')}: {entitledText(b)} · {t('vac.reserved')}: {days(b.reserved)}
                </div>
              )}
            </div>
          </div>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t('profile.department')}</dt>
            <dd className="truncate text-right font-medium">{me.department?.name ?? '–'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t('profile.manager')}</dt>
            <dd className="truncate text-right font-medium">{me.manager ? fullName(me.manager) : '–'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t('profile.hireDate')}</dt>
            <dd className="font-medium">{fmtDate(me.hire_date)}</dd>
          </div>
        </dl>
        <Link to="/profile" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
          {t('nav.profile')} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </Card>
  )
}

export function MyRequestsCard({ onOpen }: { onOpen?: (id: string) => void }) {
  const { t } = useI18n()
  const { data, isLoading } = useMyRequests()
  const navigate = useNavigate()
  const list = (data ?? []).slice(0, 4)
  return (
    <Card>
      <CardHeader
        icon={<FileStack className="h-[18px] w-[18px]" />}
        title={t('home.myRequests')}
        action={
          <Link to="/requests" className="text-sm font-medium text-brand-700 hover:underline">
            {t('home.allRequests')}
          </Link>
        }
      />
      <div className="px-2 pb-3">
        {isLoading ? (
          <div className="space-y-2 px-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : list.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted">{t('home.noRequests')}</p>
        ) : (
          <ul>
            {list.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => (onOpen ? onOpen(r.id) : navigate('/requests'))}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-canvas"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <TypeLabel type={r.type} />
                      <span className="text-xs text-muted">{t('home.number', { n: r.number })}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-muted">{requestSummary(r)}</div>
                  </div>
                  <StatusBadge status={r.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

export function MyLearningCard() {
  const { t } = useI18n()
  const { data, isLoading } = useMyAssignments()
  const list = (data ?? []).sort((a, b) => (a.status === 'completed' ? 1 : 0) - (b.status === 'completed' ? 1 : 0)).slice(0, 4)
  return (
    <Card>
      <CardHeader
        icon={<GraduationCap className="h-[18px] w-[18px]" />}
        title={t('home.myLearning')}
        action={
          <Link to="/academy" className="text-sm font-medium text-brand-700 hover:underline">
            {t('home.allCourses')}
          </Link>
        }
      />
      <div className="space-y-3 px-5 pb-5">
        {isLoading && <Skeleton className="h-16" />}
        {!isLoading && list.length === 0 && <p className="py-4 text-center text-sm text-muted">{t('home.noCourses')}</p>}
        {list.map((a) => {
          const overdue = a.status !== 'completed' && a.due_date && new Date(a.due_date) < new Date()
          return (
            <Link key={a.id} to={`/academy/${a.course?.slug}`} className="block rounded-xl border border-line p-3 transition hover:border-brand-300">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <CourseIcon name={a.course?.icon} className="h-9 w-9" />
                  <span className="truncate text-sm font-medium">{a.course?.title}</span>
                </div>
                {a.status === 'completed' ? (
                  <Badge className="bg-brand-50 text-brand-700 ring-brand-200">
                    <CheckCircle2 className="mr-1 inline h-3 w-3" />
                    {a.score}%
                  </Badge>
                ) : overdue ? (
                  <Badge className="bg-rose-50 text-rose-700 ring-rose-200">{t('home.courseOverdue')}</Badge>
                ) : a.due_date ? (
                  <span className="shrink-0 text-xs text-muted">{t('home.dueBy', { date: fmtDate(a.due_date, 'd MMM') })}</span>
                ) : null}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Progress value={a.progress} className="h-1.5" tone={overdue ? 'rose' : 'brand'} />
                <span className="w-9 text-right text-xs font-medium text-muted tabular-nums">{a.progress}%</span>
              </div>
            </Link>
          )
        })}
      </div>
    </Card>
  )
}

export function MyTasksCard() {
  const { t } = useI18n()
  const { data, isLoading } = useTasks('mine')
  const open = (data ?? []).filter((x) => x.status !== 'done').slice(0, 5)
  return (
    <Card>
      <CardHeader
        icon={<ClipboardList className="h-[18px] w-[18px]" />}
        title={t('home.myTasks')}
        subtitle={open.length ? t('home.tasksOpenCount', { n: (data ?? []).filter((x) => x.status !== 'done').length }) : t('home.tasksAllDone')}
        action={
          <Link to="/tasks" className="text-sm font-medium text-brand-700 hover:underline">
            {t('home.allTasks')}
          </Link>
        }
      />
      <ul className="px-2 pb-3">
        {isLoading && <Skeleton className="mx-3 h-12" />}
        {!isLoading && open.length === 0 && <Empty title={t('home.noTasks')} text={t('home.noTasksText')} />}
        {open.map((task) => (
          <li key={task.id}>
            <Link
              to={task.kind === 'course' && task.course ? `/academy/${task.course.slug}` : `/tasks?open=${task.id}`}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-canvas active:scale-[0.99]"
            >
              <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', task.status === 'in_progress' ? 'bg-sky-500' : task.status === 'review' ? 'bg-violet-500' : 'bg-line')} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{task.title}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <DeadlineChip task={task} compact />
                  {task.creator && task.creator.id !== task.assignee_id && <span className="truncate">{t('home.taskFrom', { name: fullName(task.creator) })}</span>}
                </span>
              </span>
              <PriorityStars value={task.priority} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function NewsCard({ limit = 3 }: { limit?: number }) {
  const { t } = useI18n()
  const { data, isLoading } = useAnnouncements(10)
  const list = (data ?? []).slice(0, limit)
  return (
    <Card>
      <CardHeader
        icon={<Megaphone className="h-[18px] w-[18px]" />}
        title={t('home.news')}
        action={
          <Link to="/announcements" className="text-sm font-medium text-brand-700 hover:underline">
            {t('home.allNews')}
          </Link>
        }
      />
      <ul className="space-y-1 px-2 pb-3">
        {isLoading && <Skeleton className="mx-3 h-16" />}
        {list.map((a) => {
          const cat = ANNOUNCEMENT_CATEGORIES[a.category] ?? ANNOUNCEMENT_CATEGORIES.news
          return (
            <li key={a.id}>
              <Link to="/announcements" className="block rounded-xl px-3 py-2.5 transition hover:bg-canvas">
                <div className="flex items-center gap-2">
                  {a.pinned && <Pin className="h-3.5 w-3.5 text-brand-600" />}
                  <Badge className={cat.style}>
                    <cat.icon className="h-3 w-3" /> {cat.label}
                  </Badge>
                  {!a.read && <span className="h-2 w-2 rounded-full bg-brand-500" title={t('home.unread')} />}
                  <span className="ml-auto text-xs text-muted">{timeAgo(a.created_at)}</span>
                </div>
                <div className="mt-1.5 text-sm font-medium text-ink">{a.title}</div>
                <div className="mt-0.5 line-clamp-2 text-[13px] text-muted">{a.body}</div>
              </Link>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

export function NotificationsCard() {
  const { t } = useI18n()
  const { data } = useNotifications()
  const markRead = useMarkNotificationRead()
  const navigate = useNavigate()
  const list = (data ?? []).slice(0, 5)
  const unread = (data ?? []).filter((n) => !n.read_at).length
  return (
    <Card>
      <CardHeader
        icon={<Bell className="h-[18px] w-[18px]" />}
        title={t('home.notifications')}
        subtitle={unread ? t('home.notifNew', { n: unread }) : t('home.notifAllRead')}
        action={
          <Link to="/notifications" className="text-sm font-medium text-brand-700 hover:underline">
            {t('common.all')}
          </Link>
        }
      />
      <ul className="px-2 pb-3">
        {list.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted">{t('notif.empty')}</p>}
        {list.map((n) => (
          <li key={n.id}>
            <button
              onClick={() => {
                if (!n.read_at) markRead.mutate(n.id)
                if (n.link) navigate(n.link)
              }}
              className={cn('flex w-full gap-2.5 rounded-xl px-3 py-2 text-left transition hover:bg-canvas', !n.read_at && 'bg-brand-50/50')}
            >
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-line' : 'bg-brand-500')} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{serverText(n.title)}</span>
                <span className="block truncate text-xs text-muted">{serverText(n.body)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
