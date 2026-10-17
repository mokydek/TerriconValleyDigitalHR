import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ClipboardList, GraduationCap, Lock, Mail, Phone, Plus, RefreshCw } from '@/components/icons'
import { useAuth } from '@/lib/auth'
import { tr, useI18n } from '@/lib/i18n'
import { useCourses, useEmployee, useEmployeeRequests, useMyAssignments, usePeople, useRequestEvents, useTasks, useVacationBalance } from '@/lib/api'
import { PRIORITY_META } from '@/lib/constants'
import { days, fmtDate, fmtDateTime, fullName, money } from '@/lib/format'
import type { HrRequest } from '@/lib/types'
import { Avatar, Badge, Button, Card, CardHeader, Empty, ErrorBox, PageLoader, Progress } from '@/components/ui'
import { RequestDrawer } from '@/components/requests/RequestDrawer'
import { requestSummary, RequestStepper, StatusBadge, TypeLabel } from '@/components/requests/RequestParts'
import { FollowStar } from '@/components/hr/HrBlocks'
import { WriteButton } from '@/components/chat/WriteButton'
import { AssignCourseModal } from './Academy'

function RequestTrack({ r, onOpen }: { r: HrRequest; onOpen: () => void }) {
  const events = useRequestEvents(r.id)
  return (
    <button onClick={onOpen} className="w-full rounded-xl border border-line p-3 text-left transition hover:border-brand-300">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <TypeLabel type={r.type} />
          <span className="text-xs text-muted">
            №{r.number} · {requestSummary(r)}
          </span>
        </div>
        <StatusBadge status={r.status} />
      </div>
      <div className="mt-3">
        <RequestStepper request={r} events={events.data} />
      </div>
    </button>
  )
}

export default function EmployeeCardPage() {
  const { id } = useParams()
  const { isHr, me } = useAuth()
  const { t } = useI18n()
  const emp = useEmployee(id)
  const requests = useEmployeeRequests(id)
  const assignments = useMyAssignments(id)
  const tasks = useTasks('employee', id)
  const balance = useVacationBalance(id)
  const people = usePeople()
  const courses = useCourses()
  const [open, setOpen] = useState<HrRequest | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const person = (people.data ?? []).find((p) => p.employee_id === id)

  if (emp.isLoading) return <PageLoader />
  if (emp.error || !emp.data) return <ErrorBox error={emp.error ?? t('emp.notFound')} />
  const e = emp.data.emp
  const priv = emp.data.priv
  const canSeeTeamData = Boolean(person) // people_overview отдаёт только разрешённых (HR — всех, руководителю — команду)

  return (
    <div>
      <Link to={isHr ? '/employees' : '/team'} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-brand-700">
        ← {isHr ? t('nav.employees') : t('nav.team')}
      </Link>
      <Card className="mb-5 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <Avatar id={e.id} name={fullName(e)} size={72} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{[e.last_name, e.first_name, e.middle_name].filter(Boolean).join(' ')}</h1>
              {isHr && person && <FollowStar person={person} />}
            </div>
            <p className="text-muted">
              {e.position} · {e.department?.name} · {e.location?.city}
            </p>
            <div className="mt-2 flex flex-wrap gap-3 text-sm text-ink-soft">
              <span className="inline-flex items-center gap-1.5">
                <Mail className="h-4 w-4 text-muted" /> {e.email}
              </span>
              {e.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="h-4 w-4 text-muted" /> {e.phone}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {e.id !== me?.id && <WriteButton employeeId={e.id} />}
            {canSeeTeamData && (
              <>
                <Button variant="outline" icon={<GraduationCap className="h-4 w-4" />} onClick={() => setAssignOpen(true)}>
                  {t('emp.assignCourse')}
                </Button>
                <Link to="/tasks">
                  <Button variant="outline" icon={<Plus className="h-4 w-4" />}>
                    {t('emp.addTask')}
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </Card>

      {!canSeeTeamData && (
        <Card className="mb-5 flex items-start gap-3 p-5 text-sm text-muted">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
          {t('emp.notYours')}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              icon={<Lock className="h-[18px] w-[18px]" />}
              title={t('emp.zupProfile')}
              subtitle={
                <span className="inline-flex items-center gap-1">
                  {t('common.readOnly')} {e.synced_at && <><RefreshCw className="h-3 w-3" /> {fmtDateTime(e.synced_at)}</>}
                </span>
              }
            />
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 pb-5 text-sm">
              <div>
                <dt className="text-muted">{t('profile.company')}</dt>
                <dd className="font-medium">{e.company}</dd>
              </div>
              <div>
                <dt className="text-muted">{t('profile.tabNo')}</dt>
                <dd className="font-medium">{e.zup_id}</dd>
              </div>
              <div>
                <dt className="text-muted">{t('profile.manager')}</dt>
                <dd className="font-medium">{e.manager ? fullName(e.manager) : '–'}</dd>
              </div>
              <div>
                <dt className="text-muted">{t('profile.hireDate')}</dt>
                <dd className="font-medium">{fmtDate(e.hire_date)}</dd>
              </div>
              {canSeeTeamData && balance.data && (
                <div className="col-span-2 rounded-xl bg-brand-50 px-3.5 py-2.5">
                  <dt className="text-brand-800">{t('vac.balance')}</dt>
                  <dd className="text-lg font-bold text-brand-800">
                    {tr('emp.balanceOf', {
                      available: days(balance.data.available),
                      ofTotal: <span className="text-sm font-normal">{t('emp.ofTotal', { total: days(balance.data.entitled) })}</span>,
                    })}
                  </dd>
                </div>
              )}
              {isHr && priv && (
                <>
                  <div>
                    <dt className="text-muted">{t('emp.salary')}</dt>
                    <dd className="font-medium">{money(priv.salary)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t('profile.birthDate')}</dt>
                    <dd className="font-medium">{fmtDate(priv.birth_date)}</dd>
                  </div>
                </>
              )}
            </dl>
            {isHr && <div className="mx-5 mb-5 rounded-lg bg-canvas px-3 py-2 text-xs text-muted">{t('emp.salaryNote')}</div>}
          </Card>

          {canSeeTeamData && (
            <Card>
              <CardHeader icon={<GraduationCap className="h-[18px] w-[18px]" />} title={t('emp.courses')} />
              <ul className="space-y-3 px-5 pb-5">
                {(assignments.data ?? []).length === 0 && <li className="text-sm text-muted">{t('emp.noCourses')}</li>}
                {(assignments.data ?? []).map((a) => {
                  const overdue = a.status !== 'completed' && a.due_date && new Date(a.due_date) < new Date()
                  return (
                    <li key={a.id}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate font-medium">
                          {a.course?.emoji} {a.course?.title}
                        </span>
                        {a.status === 'completed' ? (
                          <Badge className="bg-brand-50 text-brand-700 ring-brand-200">{a.score}%</Badge>
                        ) : overdue ? (
                          <Badge className="bg-rose-50 text-rose-700 ring-rose-200">{t('emp.overdue')}</Badge>
                        ) : (
                          <span className="text-xs text-muted">{t('emp.until', { date: fmtDate(a.due_date, 'd MMM') })}</span>
                        )}
                      </div>
                      <Progress value={a.progress} className="mt-1.5 h-1.5" tone={overdue ? 'rose' : 'brand'} />
                      {a.attempts > 1 && <div className="mt-1 text-xs text-muted">{t('emp.attempts', { n: a.attempts })}</div>}
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}
        </div>

        {canSeeTeamData && (
          <div className="space-y-4">
            <Card>
              <CardHeader title={t('emp.requestTrack')} subtitle={t('emp.trackSteps')} />
              <div className="space-y-2.5 px-5 pb-5">
                {(requests.data ?? []).length === 0 && <Empty title={t('emp.noRequests')} />}
                {(requests.data ?? []).slice(0, 8).map((r) => (
                  <RequestTrack key={r.id} r={r} onOpen={() => setOpen(r)} />
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader icon={<ClipboardList className="h-[18px] w-[18px]" />} title={t('nav.tasks')} />
              <ul className="divide-y divide-line border-t border-line">
                {(tasks.data ?? []).length === 0 && <li className="px-5 py-4 text-sm text-muted">{t('emp.noTasks')}</li>}
                {(tasks.data ?? []).map((task) => {
                  const overdue = task.status !== 'done' && task.due_date && new Date(task.due_date) < new Date(new Date().toDateString())
                  return (
                    <li key={task.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{task.title}</span>
                        <span className={overdue ? 'text-xs font-medium text-rose-600' : 'text-xs text-muted'}>{task.due_date ? t('emp.until', { date: fmtDate(task.due_date, 'd MMM') }) : t('emp.noDue')}</span>
                      </span>
                      <Badge className={PRIORITY_META[task.priority].style}>{PRIORITY_META[task.priority].label}</Badge>
                      <Badge className={task.status === 'done' ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'bg-canvas text-ink-soft ring-line'}>{t(`tasks.${task.status}`)}</Badge>
                    </li>
                  )
                })}
              </ul>
            </Card>
          </div>
        )}
      </div>
      <RequestDrawer request={open} onClose={() => setOpen(null)} />
      {assignOpen && <AssignCourseModal open onClose={() => setAssignOpen(false)} courses={courses.data ?? []} presetEmployeeIds={[e.id]} />}
    </div>
  )
}
