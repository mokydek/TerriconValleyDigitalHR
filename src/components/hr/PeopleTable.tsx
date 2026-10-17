import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Search, Users } from 'lucide-react'
import { usePeople } from '@/lib/api'
import { days } from '@/lib/format'
import { useI18n, type I18nKey } from '@/lib/i18n'
import type { PersonRow } from '@/lib/types'
import { exportXlsx } from '@/lib/excel'
import { cn } from '@/lib/utils'
import { Avatar, Badge, Button, Card, Empty, ErrorBox, Skeleton } from '@/components/ui'
import { FollowStar } from './HrBlocks'

// label: ключ перевода, переводится при показе
const STATE: Record<PersonRow['state'], { label: I18nKey; cls: string }> = {
  active: { label: 'hr.state.active', cls: 'bg-brand-50 text-brand-700 ring-brand-200' },
  vacation: { label: 'hr.state.vacation', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  newbie: { label: 'hr.state.newbie', cls: 'bg-violet-50 text-violet-700 ring-violet-200' },
}

export function PeopleTable({ canFollow }: { canFollow: boolean }) {
  const { t } = useI18n()
  const { data, isLoading, error, refetch } = usePeople()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('all')
  const [state, setState] = useState<'all' | PersonRow['state']>('all')
  const [onlyFollowed, setOnlyFollowed] = useState(false)

  const departments = useMemo(() => [...new Set((data ?? []).map((p) => p.department).filter(Boolean))].sort() as string[], [data])
  const rows = useMemo(
    () =>
      (data ?? []).filter(
        (p) =>
          (dept === 'all' || p.department === dept) &&
          (state === 'all' || p.state === state) &&
          (!onlyFollowed || p.followed) &&
          (!q || `${p.full_name} ${p.job_title}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [data, dept, state, onlyFollowed, q],
  )

  const exportExcel = () =>
    exportXlsx(
      t('hr.export.title'),
      [
        t('hr.col.name'),
        t('hr.col.position'),
        t('hr.col.department'),
        t('hr.col.city'),
        t('hr.col.status'),
        t('hr.col.vacation'),
        t('hr.col.coursesAssigned'),
        t('hr.col.coursesCompleted'),
        t('hr.col.coursesOverdue'),
        t('hr.col.avgScore'),
        t('hr.col.openTasks'),
        t('hr.col.overdueTasks'),
        t('hr.col.requestsInWork'),
      ],
      rows.map((p) => [
        p.full_name,
        p.job_title,
        p.department ?? '',
        p.location ?? '',
        t(STATE[p.state].label),
        Number(p.vacation_available),
        p.courses_assigned,
        p.courses_completed,
        p.courses_overdue,
        p.avg_score ?? '',
        p.open_tasks,
        p.overdue_tasks,
        p.requests_in_work,
      ]),
    )

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1 lg:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="field pl-9" placeholder={t('hr.search')} value={q} onChange={(e) => setQ(e.target.value)} data-testid="people-search" />
        </div>
        <select className="field lg:w-64" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="all">{t('hr.allDepartments')}</option>
          {departments.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <div className="inline-flex rounded-xl bg-white p-1 ring-1 ring-line">
          {(['all', 'active', 'vacation', 'newbie'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setState(s)}
              className={cn('rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap', state === s ? 'bg-brand-600 text-white' : 'text-ink-soft hover:bg-canvas')}
            >
              {s === 'all' ? t('common.all') : t(STATE[s].label)}
            </button>
          ))}
        </div>
        {canFollow && (
          <label className="flex items-center gap-2 text-sm whitespace-nowrap">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={onlyFollowed} onChange={(e) => setOnlyFollowed(e.target.checked)} />
            {t('hr.onlyWatched')}
          </label>
        )}
        <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => void exportExcel()} className="lg:ml-auto">
          Excel
        </Button>
      </div>
      {error && <ErrorBox error={error} onRetry={() => void refetch()} />}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty icon={<Users className="h-6 w-6" />} title={t('hr.peopleEmpty')} text={t('hr.peopleEmptyText')} />
        ) : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b border-line bg-canvas/60 text-xs tracking-wide text-muted uppercase">
                <tr>
                  {canFollow && <th className="w-10 px-3 py-3" />}
                  <th className="px-4 py-3 font-medium">{t('hr.th.employee')}</th>
                  <th className="px-4 py-3 font-medium">{t('hr.col.department')}</th>
                  <th className="px-4 py-3 font-medium">{t('hr.col.status')}</th>
                  <th className="px-4 py-3 font-medium">{t('hr.th.vacation')}</th>
                  <th className="px-4 py-3 font-medium">{t('hr.th.learning')}</th>
                  <th className="px-4 py-3 font-medium">{t('hr.th.tasks')}</th>
                  <th className="px-4 py-3 font-medium">{t('hr.th.requests')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.employee_id} onClick={() => navigate(`/employees/${p.employee_id}`)} className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-brand-50/30" data-testid="people-row">
                    {canFollow && (
                      <td className="px-3 py-2.5">
                        <FollowStar person={p} size="sm" />
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <Avatar id={p.employee_id} name={p.full_name} size={34} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink">{p.full_name}</div>
                          <div className="truncate text-xs text-muted">{p.job_title}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-ink-soft">
                      {p.department}
                      <div className="text-xs text-muted">{p.location}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge className={STATE[p.state].cls}>{t(STATE[p.state].label)}</Badge>
                    </td>
                    <td className={cn('px-4 py-2.5 tabular-nums', Number(p.vacation_available) > 30 && 'font-semibold text-amber-700')}>{days(p.vacation_available)}</td>
                    <td className="px-4 py-2.5">
                      {p.courses_completed}/{p.courses_assigned}
                      {p.courses_overdue > 0 && <span className="ml-1.5 text-xs font-semibold text-rose-600">{t('hr.overdueShort', { n: p.courses_overdue })}</span>}
                      {p.avg_score !== null && <div className="text-xs text-muted">{t('hr.avgScoreShort', { n: p.avg_score })}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      {p.open_tasks}
                      {p.overdue_tasks > 0 && <span className="ml-1.5 text-xs font-semibold text-rose-600">{t('hr.afterDueShort', { n: p.overdue_tasks })}</span>}
                    </td>
                    <td className="px-4 py-2.5">{p.requests_in_work > 0 ? <Badge className="bg-sky-50 text-sky-700 ring-sky-200">{t('hr.inWorkShort', { n: p.requests_in_work })}</Badge> : <span className="text-muted">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-2 text-xs text-muted">{t('hr.shown', { n: rows.length, total: data?.length ?? 0 })}</p>
    </div>
  )
}
