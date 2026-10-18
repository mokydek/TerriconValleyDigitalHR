import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Bell, CheckCircle2, ClipboardList, GraduationCap, Megaphone, Palmtree, Sun, Timer } from '@/components/icons'
import { useAuth } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { useAnnouncements, useMarkNotificationRead, useMyAssignments, useMyRequests, useNotifications, useTasks } from '@/lib/api'
import { daysUntil, fmtDate } from '@/lib/format'
import { serverText } from '@/lib/serverText'
import { cn } from '@/lib/utils'
import { Card, Skeleton } from '@/components/ui'
import { deadlineState, taskDeadline, useDeadlineText } from '@/components/tasks/TaskParts'
import type { Task } from '@/lib/types'

type Item = {
  id: string
  weight: number
  tone: 'rose' | 'amber' | 'brand' | 'ink'
  icon: React.ReactNode
  title: string
  meta: React.ReactNode
  action: string
  to: string
  onClick?: () => void
}

const TONE: Record<Item['tone'], string> = {
  rose: 'bg-rose-50 text-rose-600',
  amber: 'bg-amber-50 text-amber-700',
  brand: 'bg-brand-50 text-brand-700',
  ink: 'bg-canvas text-ink-soft',
}

function TaskMeta({ task }: { task: Task }) {
  const { when, left } = useDeadlineText(task)
  return (
    <>
      {when}
      {left && <> · {left}</>}
    </>
  )
}

/**
 * «Мой день»: одна очередь действий из всех разделов платформы, отсортированная по срочности.
 * Просроченные и сегодняшние задачи, курс с близким сроком, новости по заявкам, важные объявления,
 * отсчёт до отпуска. У каждого пункта одна кнопка, которая ведёт ровно туда, где действие делается.
 */
export function MyDay() {
  const { t } = useI18n()
  const { me } = useAuth()
  const navigate = useNavigate()
  const tasks = useTasks('mine')
  const learning = useMyAssignments()
  const notifications = useNotifications()
  const news = useAnnouncements(10)
  const requests = useMyRequests()
  const markRead = useMarkNotificationRead()
  const loading = tasks.isLoading || learning.isLoading || notifications.isLoading

  const items = useMemo(() => {
    const out: Item[] = []
    const now = Date.now()
    for (const task of tasks.data ?? []) {
      if (task.status === 'done' || task.status === 'review') continue
      const state = deadlineState(task, now)
      const d = taskDeadline(task)
      const within2d = d && d.getTime() - now < 2 * 86_400_000
      if (state === 'overdue' || state === 'soon' || state === 'today' || within2d) {
        out.push({
          id: `t-${task.id}`,
          weight: state === 'overdue' ? 100 : state === 'soon' || state === 'today' ? 80 : 60,
          tone: state === 'overdue' ? 'rose' : state === 'later' ? 'brand' : 'amber',
          icon: <Timer className="h-4 w-4" />,
          title: task.title,
          meta: <TaskMeta task={task} />,
          action: task.kind === 'course' ? t('t2.goCourse') : t('common.open'),
          to: task.kind === 'course' && task.course ? `/academy/${task.course.slug}` : `/tasks?open=${task.id}`,
        })
      }
    }
    for (const a of learning.data ?? []) {
      if (a.status === 'completed' || !a.due_date || !a.course) continue
      const left = daysUntil(a.due_date)
      if (left > 7) continue
      // если по курсу уже есть задача в списке, второй раз не показываем
      if (out.some((x) => x.to === `/academy/${a.course!.slug}`)) continue
      out.push({
        id: `c-${a.id}`,
        weight: left < 0 ? 90 : 55,
        tone: left < 0 ? 'rose' : 'amber',
        icon: <GraduationCap className="h-4 w-4" />,
        title: a.course.title,
        meta: left < 0 ? t('d2.courseOverdue', { date: fmtDate(a.due_date, 'd MMM') }) : t('d2.courseDue', { date: fmtDate(a.due_date, 'd MMM'), p: a.progress }),
        action: a.status === 'assigned' ? t('academy.start') : t('academy.continue'),
        to: `/academy/${a.course.slug}`,
      })
    }
    for (const n of (notifications.data ?? []).filter((x) => !x.read_at && (x.kind === 'success' || x.kind === 'request' || x.kind === 'warning')).slice(0, 3)) {
      out.push({
        id: `n-${n.id}`,
        weight: n.kind === 'warning' ? 70 : 50,
        tone: n.kind === 'warning' ? 'amber' : 'brand',
        icon: <Bell className="h-4 w-4" />,
        title: serverText(n.title),
        meta: n.body ? serverText(n.body) : '',
        action: t('common.open'),
        to: n.link ?? '/notifications',
        onClick: () => markRead.mutate(n.id),
      })
    }
    for (const a of (news.data ?? []).filter((x) => !x.read && (x.pinned || x.category === 'urgent')).slice(0, 2)) {
      out.push({
        id: `a-${a.id}`,
        weight: a.category === 'urgent' ? 75 : 40,
        tone: a.category === 'urgent' ? 'rose' : 'ink',
        icon: <Megaphone className="h-4 w-4" />,
        title: a.title,
        meta: a.summary ?? '',
        action: t('a2.readFull'),
        to: `/announcements?open=${a.id}`,
      })
    }
    const vacation = (requests.data ?? [])
      .filter((r) => r.type === 'vacation' && r.status === 'done' && r.start_date && daysUntil(r.start_date) >= 0)
      .sort((a, b) => (a.start_date! < b.start_date! ? -1 : 1))[0]
    if (vacation?.start_date) {
      const left = daysUntil(vacation.start_date)
      out.push({
        id: `v-${vacation.id}`,
        weight: 10,
        tone: 'brand',
        icon: <Palmtree className="h-4 w-4" />,
        title: left === 0 ? t('d2.vacationToday') : t('d2.vacationIn', { n: left }),
        meta: `${fmtDate(vacation.start_date, 'd MMM')} – ${fmtDate(vacation.end_date, 'd MMM')}`,
        action: t('common.open'),
        to: '/requests',
      })
    }
    return out.sort((a, b) => b.weight - a.weight).slice(0, 6)
  }, [tasks.data, learning.data, notifications.data, news.data, requests.data, t, markRead])

  const urgent = items.filter((i) => i.tone === 'rose').length
  const openTasks = (tasks.data ?? []).filter((x) => x.status !== 'done').length

  return (
    <Card className="relative overflow-hidden" data-testid="my-day">
      <div className="pointer-events-none absolute -top-16 -right-10 h-48 w-48 rounded-full bg-brand-50" aria-hidden />
      <div className="relative flex flex-wrap items-center gap-3 px-5 pt-5">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600">
          <Sun className="h-5 w-5 animate-[spin_24s_linear_infinite]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">{t('d2.title')}</h2>
          <p className="text-sm text-muted">
            {loading ? t('common.loading') : items.length === 0 ? t('d2.calm') : urgent > 0 ? t('d2.summaryUrgent', { n: items.length, u: urgent }) : t('d2.summary', { n: items.length })}
          </p>
        </div>
        <Link to="/tasks" className="hidden items-center gap-1.5 rounded-full bg-canvas px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-brand-50 hover:text-brand-700 sm:inline-flex">
          <ClipboardList className="h-4 w-4" /> {t('d2.openTasks', { n: openTasks })}
        </Link>
      </div>

      <ul className="stagger relative mt-3 space-y-1 px-2 pb-3">
        {loading && <Skeleton className="mx-3 h-14" />}
        {!loading && items.length === 0 && (
          <li className="flex flex-col items-center gap-2 px-6 py-6 text-center">
            <span className="grid h-12 w-12 animate-float place-items-center rounded-2xl bg-brand-50 text-brand-600">
              <CheckCircle2 className="h-6 w-6" />
            </span>
            <span className="text-sm text-muted">{t('d2.calmText', { name: me?.first_name ?? '' })}</span>
          </li>
        )}
        {items.map((it, i) => (
          <li key={it.id} style={{ ['--i' as string]: i }}>
            <button
              onClick={() => {
                it.onClick?.()
                navigate(it.to)
              }}
              className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-canvas active:scale-[0.99]"
              data-testid="my-day-item"
            >
              <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', TONE[it.tone])}>{it.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{it.title}</span>
                {it.meta && <span className={cn('block truncate text-xs', it.tone === 'rose' ? 'font-medium text-rose-600' : 'text-muted')}>{it.meta}</span>}
              </span>
              <span className="hidden shrink-0 items-center gap-1 text-sm font-medium text-brand-700 sm:inline-flex">
                {it.action} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
