import { Link } from 'react-router-dom'
import { AlarmClock, BellRing, Eye, GraduationCap, Palmtree, Star, UserPlus } from '@/components/icons'
import { toast } from 'sonner'
import { useAttentionAction, useAttentionZone, usePeople, useToggleFollow } from '@/lib/api'
import { days, timeAgo } from '@/lib/format'
import { useI18n, type I18nKey } from '@/lib/i18n'
import { serverText } from '@/lib/serverText'
import type { AttentionItem, PersonRow } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Avatar, Badge, Button, Card, CardHeader, Empty, Skeleton } from '@/components/ui'

const KIND_ICON: Record<AttentionItem['kind'], React.ReactNode> = {
  vacation: <Palmtree className="h-4 w-4" />,
  course: <GraduationCap className="h-4 w-4" />,
  request: <AlarmClock className="h-4 w-4" />,
  onboarding: <UserPlus className="h-4 w-4" />,
}

const ACTION_LABEL: Record<AttentionItem['action'], I18nKey> = {
  remind_vacation: 'hr.remind',
  remind_course: 'hr.remind',
  nudge: 'hr.nudge',
  assign_course: 'hr.assignCourse',
}

export function AttentionZone({ limit }: { limit?: number }) {
  const { t } = useI18n()
  const { data, isLoading } = useAttentionZone()
  const action = useAttentionAction()
  const items = limit ? (data ?? []).slice(0, limit) : data ?? []
  const counts = (data ?? []).reduce<Record<string, number>>((acc, i) => ((acc[i.kind] = (acc[i.kind] ?? 0) + 1), acc), {})

  return (
    <Card>
      <CardHeader
        icon={<BellRing className="h-[18px] w-[18px]" />}
        title={t('hr.attention')}
        action={<Badge className="bg-rose-50 text-rose-700 ring-rose-200">{data?.length ?? 0}</Badge>}
      />
      {data && data.length > 0 && (
        <div className="flex flex-wrap gap-2 px-5 pb-3 text-xs">
          {counts.vacation ? <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">{t('hr.badgeVacation', { n: counts.vacation })}</Badge> : null}
          {counts.course ? <Badge className="bg-amber-50 text-amber-800 ring-amber-200">{t('hr.badgeCourse', { n: counts.course })}</Badge> : null}
          {counts.request ? <Badge className="bg-rose-50 text-rose-700 ring-rose-200">{t('hr.badgeRequest', { n: counts.request })}</Badge> : null}
          {counts.onboarding ? <Badge className="bg-sky-50 text-sky-700 ring-sky-200">{t('hr.badgeOnboarding', { n: counts.onboarding })}</Badge> : null}
        </div>
      )}
      <ul className="divide-y divide-line border-t border-line">
        {isLoading && (
          <li className="p-5">
            <Skeleton className="h-12" />
          </li>
        )}
        {!isLoading && items.length === 0 && (
          <li>
            <Empty title={t('hr.attentionEmpty')} text={t('hr.attentionEmptyText')} />
          </li>
        )}
        {items.map((it) => {
          const key = `${it.action}-${it.employee_id}-${it.ref_id}`
          const reminded = it.last_reminded_at && Date.now() - new Date(it.last_reminded_at).getTime() < 24 * 3600_000
          return (
            <li key={key} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center" data-testid="attention-item">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div
                  className={cn(
                    'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                    it.severity === 'high' ? 'bg-rose-50 text-rose-600' : it.severity === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700',
                  )}
                >
                  {KIND_ICON[it.kind]}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">{serverText(it.title)}</div>
                  <div className="text-[13px] text-muted">
                    <Link to={`/employees/${it.employee_id}`} className="font-medium text-ink-soft hover:text-brand-700 hover:underline">
                      {it.full_name}
                    </Link>
                    {it.department && ` · ${it.department}`} · {serverText(it.details)}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 sm:justify-end">
                {reminded && <span className="text-xs text-muted">✓ {timeAgo(it.last_reminded_at)}</span>}
                <Button
                  size="sm"
                  variant={reminded ? 'outline' : it.action === 'assign_course' ? 'primary' : 'soft'}
                  loading={action.isPending && action.variables?.employeeId === it.employee_id && action.variables?.action === it.action}
                  onClick={async () => {
                    try {
                      const msg = await action.mutateAsync({ action: it.action, employeeId: it.employee_id, refId: it.ref_id })
                      toast.success(serverText(msg), { description: it.full_name })
                    } catch (e) {
                      toast.error((e as Error).message)
                    }
                  }}
                >
                  {t(ACTION_LABEL[it.action])}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      {limit && (data?.length ?? 0) > limit && (
        <div className="border-t border-line px-5 py-3 text-center text-sm text-muted">{t('hr.attentionMore', { n: limit, total: data?.length ?? 0 })}</div>
      )}
    </Card>
  )
}

export function FollowStar({ person, size = 'md' }: { person: Pick<PersonRow, 'employee_id' | 'followed' | 'full_name'>; size?: 'sm' | 'md' }) {
  const { t } = useI18n()
  const toggle = useToggleFollow()
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation()
        e.preventDefault()
        try {
          await toggle.mutateAsync({ employeeId: person.employee_id, follow: !person.followed })
          toast.success(person.followed ? t('hr.followOff', { name: person.full_name }) : t('hr.followOn', { name: person.full_name }), {
            description: person.followed ? undefined : t('hr.followOnText'),
          })
        } catch (err) {
          toast.error((err as Error).message)
        }
      }}
      className={cn('rounded-lg p-1.5 transition', person.followed ? 'text-amber-500 hover:bg-amber-50' : 'text-muted/50 hover:bg-canvas hover:text-amber-500')}
      title={person.followed ? t('hr.unfollow') : t('hr.follow')}
      aria-pressed={person.followed}
      data-testid={`follow-${person.employee_id}`}
    >
      <Star className={cn(size === 'sm' ? 'h-4 w-4' : 'h-5 w-5', person.followed && 'fill-current')} />
    </button>
  )
}

export function WatchlistCard() {
  const { t } = useI18n()
  const { data, isLoading } = usePeople()
  const followed = (data ?? []).filter((p) => p.followed)
  return (
    <Card>
      <CardHeader
        icon={<Eye className="h-[18px] w-[18px]" />}
        title={t('hr.watchlist')}
        action={
          <Link to="/employees" className="text-sm font-medium text-brand-700 hover:underline">
            {t('hr.add')}
          </Link>
        }
      />
      <ul className="divide-y divide-line border-t border-line">
        {isLoading && (
          <li className="p-5">
            <Skeleton className="h-12" />
          </li>
        )}
        {!isLoading && followed.length === 0 && (
          <li>
            <Empty title={t('hr.watchEmpty')} text={t('hr.watchEmptyText')} />
          </li>
        )}
        {followed.map((p) => (
          <li key={p.employee_id}>
            <Link to={`/employees/${p.employee_id}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-canvas">
              <Avatar id={p.employee_id} name={p.full_name} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{p.full_name}</div>
                <div className="truncate text-xs text-muted">
                  {p.job_title} · {p.department}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {p.requests_in_work > 0 && <Badge className="bg-sky-50 text-sky-700 ring-sky-200">{t('hr.badgeRequests', { n: p.requests_in_work })}</Badge>}
                  {p.courses_overdue > 0 && <Badge className="bg-rose-50 text-rose-700 ring-rose-200">{t('hr.badgeCoursesOverdue', { n: p.courses_overdue })}</Badge>}
                  {p.overdue_tasks > 0 && <Badge className="bg-amber-50 text-amber-800 ring-amber-200">{t('hr.badgeTasksOverdue', { n: p.overdue_tasks })}</Badge>}
                  <Badge className="bg-canvas text-ink-soft ring-line">{t('hr.badgeVacationLeft', { days: days(p.vacation_available) })}</Badge>
                </div>
              </div>
              <FollowStar person={p} size="sm" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
