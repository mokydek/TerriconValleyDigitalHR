import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Award, BookOpen, Clock, GraduationCap, Plus, Search, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { tr, useI18n } from '@/lib/i18n'
import { useAnalytics, useAssignCourse, useCourseLessonCounts, useCourses, useEmployeesLite, useMyAssignments } from '@/lib/api'
import { COURSE_CATEGORIES } from '@/lib/constants'
import { fmtDate, fullName, isoDate } from '@/lib/format'
import { serverText } from '@/lib/serverText'
import type { Assignment, Course } from '@/lib/types'
import { addDays } from 'date-fns'
import { cn } from '@/lib/utils'
import { Badge, Button, Card, CardHeader, Empty, Field, Modal, PageHeader, Progress, Skeleton, Tabs } from '@/components/ui'

type Tab = 'mine' | 'catalog' | 'manage'

function CourseCard({ course, assignment, lessons }: { course: Course; assignment?: Assignment; lessons?: number }) {
  const { t } = useI18n()
  const overdue = assignment && assignment.status !== 'completed' && assignment.due_date && new Date(assignment.due_date) < new Date(new Date().toDateString())
  const cta = !assignment || assignment.status === 'assigned' ? t('academy.start') : assignment.status === 'in_progress' ? t('academy.continue') : t('common.open')
  return (
    <Card className="flex flex-col overflow-hidden transition hover:border-brand-300" data-testid={`course-${course.slug}`}>
      <div className="flex items-start gap-3 p-5">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-50 text-2xl">{course.emoji}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1.5">
            <Badge className="bg-canvas text-ink-soft ring-line">{COURSE_CATEGORIES[course.category] ?? course.category}</Badge>
            {course.is_mandatory && <Badge className="bg-amber-50 text-amber-800 ring-amber-200">{t('academy.mandatory')}</Badge>}
            {assignment?.status === 'completed' && <Badge className="bg-brand-50 text-brand-700 ring-brand-200">✓ {t('academy.completed')}</Badge>}
            {overdue && <Badge className="bg-rose-50 text-rose-700 ring-rose-200">{t('academy.overdue')}</Badge>}
          </div>
          <h3 className="mt-2 font-semibold text-ink">{course.title}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted">{course.description}</p>
        </div>
      </div>
      <div className="mt-auto border-t border-line px-5 py-3.5">
        <div className="flex items-center justify-between gap-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> {t('academy.minutes', { n: course.duration_minutes })} · {lessons === undefined ? t('academy.lessonsTestNone') : t('academy.lessonsTest', { n: lessons })}
          </span>
          {assignment?.due_date && assignment.status !== 'completed' && (
            <span className={cn(overdue && 'font-medium text-rose-600')}>{t('academy.dueDate', { date: fmtDate(assignment.due_date, 'd MMM') })}</span>
          )}
          {assignment?.status === 'completed' && <span className="font-medium text-brand-700">{t('academy.testScore', { score: assignment.score ?? '–' })}</span>}
        </div>
        {assignment && assignment.status !== 'completed' && (
          <div className="mt-2 flex items-center gap-2">
            <Progress value={assignment.progress} className="h-1.5" tone={overdue ? 'rose' : 'brand'} />
            <span className="text-xs font-medium text-muted tabular-nums">{assignment.progress}%</span>
          </div>
        )}
        <Link to={`/academy/${course.slug}`} className="mt-3 block">
          <Button variant={assignment?.status === 'completed' ? 'outline' : 'primary'} size="sm" className="w-full">
            {cta}
          </Button>
        </Link>
      </div>
    </Card>
  )
}

export default function AcademyPage() {
  const { role } = useAuth()
  const { t } = useI18n()
  const courses = useCourses()
  const mine = useMyAssignments()
  const lessonCounts = useCourseLessonCounts()
  const [tab, setTab] = useState<Tab>('mine')
  const byCourse = useMemo(() => new Map((mine.data ?? []).map((a) => [a.course_id, a])), [mine.data])
  const assigned = (mine.data ?? []).filter((a) => a.course)
  const completed = assigned.filter((a) => a.status === 'completed').length

  return (
    <div>
      <PageHeader
        title="Jana Academy"
        subtitle={t('academy.subtitle')}
        actions={
          <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-2.5 ring-1 ring-line">
            <Award className="h-5 w-5 text-brand-600" />
            <div className="text-sm">
              <div className="font-semibold">{t('academy.doneOf', { done: completed, n: assigned.length })}</div>
              <div className="text-xs text-muted">{t('academy.doneCaption')}</div>
            </div>
          </div>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        className="mb-5"
        items={[
          { value: 'mine', label: t('academy.assigned'), count: assigned.filter((a) => a.status !== 'completed').length },
          { value: 'catalog', label: t('academy.catalog') },
          ...(role === 'hr' || role === 'manager' ? [{ value: 'manage' as Tab, label: role === 'hr' ? t('academy.tabManage') : t('academy.tabTeam') }] : []),
        ]}
      />

      {tab === 'mine' &&
        (mine.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-60" />
            ))}
          </div>
        ) : assigned.length === 0 ? (
          <Card>
            <Empty
              icon={<GraduationCap className="h-6 w-6" />}
              title={t('academy.emptyTitle')}
              text={t('academy.emptyText')}
              action={<Button onClick={() => setTab('catalog')}>{t('academy.toCatalog')}</Button>}
            />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[...assigned]
              .sort((a, b) => (a.status === 'completed' ? 1 : 0) - (b.status === 'completed' ? 1 : 0))
              .map((a) => (
                <CourseCard key={a.id} course={a.course!} assignment={a} lessons={lessonCounts.data?.[a.course_id]} />
              ))}
          </div>
        ))}

      {tab === 'catalog' && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(courses.data ?? []).map((c) => (
            <CourseCard key={c.id} course={c} assignment={byCourse.get(c.id)} lessons={lessonCounts.data?.[c.id]} />
          ))}
        </div>
      )}

      {tab === 'manage' && <ManageLearning courses={courses.data ?? []} />}
    </div>
  )
}

interface CourseStat {
  course: string
  assigned: number
  in_progress: number
  completed: number
  not_started: number
  avg_score: number | null
}

function ManageLearning({ courses }: { courses: Course[] }) {
  const { role } = useAuth()
  const { t } = useI18n()
  const funnel = useAnalytics<{ assigned: number; started: number; lessons_done: number; passed: number }>('learning_funnel')
  const stats = useAnalytics<{ learning_by_course?: CourseStat[] }>('hr_charts')
  const forecast = useAnalytics<{ total: number; completed: number; pct: number; rate_per_week: number; eta: string | null }>('learning_forecast')
  const [assignOpen, setAssignOpen] = useState(false)
  const byCourse = useAnalytics<{ rows: { department: string; course: string; assigned: number; completed: number; pct: number; overdue: number }[] }>(
    'analytics_query',
    { p_kind: 'course_by_department', p_params: {} },
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">{role === 'hr' ? t('academy.scopeCompany') : t('academy.scopeTeam')}</p>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAssignOpen(true)} data-testid="assign-course">
          {t('academy.assignCourse')}
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {funnel.data &&
          [
            { label: t('academy.assignedCount'), value: funnel.data.assigned },
            { label: t('academy.funnelStarted'), value: funnel.data.started },
            { label: t('academy.funnelStudied'), value: funnel.data.lessons_done },
            { label: t('academy.funnelPassed'), value: funnel.data.passed },
          ].map((s, i) => (
            <Card key={s.label} className="p-4">
              <div className="text-xs font-medium text-muted">
                {i + 1}. {s.label}
              </div>
              <div className="mt-1 text-2xl font-bold">{s.value}</div>
              <Progress value={funnel.data!.assigned ? (s.value / funnel.data!.assigned) * 100 : 0} className="mt-2 h-1.5" />
            </Card>
          ))}
      </div>
      {forecast.data && (
        <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            {tr('academy.forecastText', { pct: <b>{forecast.data.pct}%</b>, done: forecast.data.completed, total: forecast.data.total, n: forecast.data.rate_per_week })}
          </div>
          <Badge className="bg-violet-50 text-violet-700 ring-violet-200">
            {forecast.data.eta ? t('academy.eta', { date: fmtDate(forecast.data.eta) }) : t('academy.etaNone')}
          </Badge>
        </Card>
      )}
      <Card className="overflow-hidden">
        <CardHeader icon={<BookOpen className="h-[18px] w-[18px]" />} title={t('academy.coursesTitle')} subtitle={t('academy.coursesSubtitle')} />
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-y border-line bg-canvas/60 text-xs text-muted uppercase">
              <tr>
                <th className="px-5 py-2.5 font-medium">{t('academy.course')}</th>
                <th className="px-5 py-2.5 font-medium">{t('academy.assignedCount')}</th>
                <th className="px-5 py-2.5 font-medium">{t('academy.colNotStarted')}</th>
                <th className="px-5 py-2.5 font-medium">{t('academy.colInProgress')}</th>
                <th className="px-5 py-2.5 font-medium">{t('academy.completed')}</th>
                <th className="px-5 py-2.5 font-medium">{t('academy.colAvgScore')}</th>
              </tr>
            </thead>
            <tbody>
              {(stats.data?.learning_by_course ?? []).map((s) => (
                <tr key={s.course} className="border-b border-line/70 last:border-0">
                  <td className="px-5 py-3 font-medium">{s.course}</td>
                  <td className="px-5 py-3">{s.assigned}</td>
                  <td className="px-5 py-3">{s.not_started}</td>
                  <td className="px-5 py-3">{s.in_progress}</td>
                  <td className="px-5 py-3">
                    {s.completed} <span className="text-muted">({s.assigned ? Math.round((s.completed / s.assigned) * 100) : 0}%)</span>
                  </td>
                  <td className="px-5 py-3">{s.avg_score ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader icon={<Users className="h-[18px] w-[18px]" />} title={t('academy.byDeptTitle')} subtitle={t('academy.byDeptSubtitle')} />
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-y border-line bg-canvas/60 text-xs text-muted uppercase">
              <tr>
                <th className="px-5 py-2.5 font-medium">{t('academy.colDepartment')}</th>
                <th className="px-5 py-2.5 font-medium">{t('academy.course')}</th>
                <th className="px-5 py-2.5 font-medium">{t('academy.colDone')}</th>
                <th className="px-5 py-2.5 font-medium">{t('academy.colOverdue')}</th>
              </tr>
            </thead>
            <tbody>
              {(byCourse.data?.rows ?? []).slice(0, 14).map((r, i) => (
                <tr key={i} className="border-b border-line/70 last:border-0">
                  <td className="px-5 py-2.5">{serverText(r.department)}</td>
                  <td className="px-5 py-2.5 text-muted">{r.course}</td>
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2">
                      <Progress value={r.pct} className="h-1.5 w-24" tone={r.pct < 60 ? 'rose' : r.pct < 80 ? 'amber' : 'brand'} />
                      <span className="tabular-nums">{r.pct}%</span>
                    </div>
                  </td>
                  <td className={cn('px-5 py-2.5', r.overdue > 0 && 'font-semibold text-rose-600')}>{r.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <AssignCourseModal open={assignOpen} onClose={() => setAssignOpen(false)} courses={courses} />
    </div>
  )
}

export function AssignCourseModal({
  open,
  onClose,
  courses,
  presetEmployeeIds,
}: {
  open: boolean
  onClose: () => void
  courses: Course[]
  presetEmployeeIds?: string[]
}) {
  const { me, role } = useAuth()
  const { t } = useI18n()
  const people = useEmployeesLite()
  const assign = useAssignCourse()
  const [courseId, setCourseId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set(presetEmployeeIds ?? []))
  const [due, setDue] = useState(isoDate(addDays(new Date(), 14)))
  const [q, setQ] = useState('')
  const candidates = (people.data ?? []).filter((p) => p.id !== me?.id && (role === 'hr' || p.manager_id === me?.id))
  const visible = candidates.filter((p) => !q || fullName(p, true).toLowerCase().includes(q.toLowerCase()) || p.position.toLowerCase().includes(q.toLowerCase()))
  const courseList = courses.length ? courses : []
  const effectiveCourse = courseId || courseList[0]?.id || ''

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('academy.assignCourse')}
      subtitle={t('academy.assignHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={assign.isPending}
            disabled={!effectiveCourse || selected.size === 0}
            onClick={async () => {
              try {
                const n = await assign.mutateAsync({ courseId: effectiveCourse, employeeIds: [...selected], due })
                toast.success(n > 0 ? t('academy.assignedToast', { n }) : t('academy.alreadyAssigned'))
                onClose()
              } catch (e) {
                toast.error((e as Error).message)
              }
            }}
          >
            {selected.size > 0 ? t('academy.assignN', { n: selected.size }) : t('academy.assign')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('academy.course')}>
            <select className="field" value={effectiveCourse} onChange={(e) => setCourseId(e.target.value)}>
              {courseList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('academy.dueField')}>
            <input type="date" className="field" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="label mb-0">{t('academy.employees')}</span>
            <button className="text-sm font-medium text-brand-700" onClick={() => setSelected(new Set(visible.map((p) => p.id)))}>
              {t('academy.selectAll', { n: visible.length })}
            </button>
          </div>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
            <input className="field pl-9" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="scrollbar-thin max-h-64 overflow-y-auto rounded-xl border border-line">
            {visible.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-3 border-b border-line/70 px-3 py-2 last:border-0 hover:bg-canvas">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-600"
                  checked={selected.has(p.id)}
                  onChange={(e) => {
                    const next = new Set(selected)
                    if (e.target.checked) next.add(p.id)
                    else next.delete(p.id)
                    setSelected(next)
                  }}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{fullName(p, true)}</span>
                  <span className="block truncate text-xs text-muted">{p.position}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
