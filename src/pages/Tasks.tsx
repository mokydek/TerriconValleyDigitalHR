import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import { addDays } from 'date-fns'
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  CornerUpLeft,
  FileText,
  ImageIcon,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
  X,
} from '@/components/icons'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useI18n, type I18nKey } from '@/lib/i18n'
import {
  fetchAttachmentData,
  useAddAttachment,
  useAssignTasks,
  useCourses,
  useDeleteAttachment,
  useEmployeesLite,
  useReviewTask,
  useTask,
  useTaskAttachments,
  useTasks,
  useUpdateTask,
} from '@/lib/api'
import { must, supabase } from '@/lib/supabase'
import { TASK_CATEGORIES } from '@/lib/constants'
import { fmtDateTime, fullName, isoDate } from '@/lib/format'
import { fileSize, openDataUrl, prepareFile } from '@/lib/files'
import type { Task, TaskKind } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Avatar, Button, Card, Drawer, Empty, Field, Modal, PageHeader, Progress, Segmented, Skeleton, Tabs } from '@/components/ui'
import { WriteButton } from '@/components/chat/WriteButton'
import { CourseIcon } from '@/components/academy/CourseIcon'
import {
  Burst,
  CheckBox,
  checklistProgress,
  DeadlineBlock,
  DeadlineChip,
  deadlineState,
  KIND_ICON,
  KindChip,
  prioStars,
  PriorityStars,
  taskDeadline,
} from '@/components/tasks/TaskParts'

const STATUSES: Task['status'][] = ['todo', 'in_progress', 'review', 'done']
type Tab = 'mine' | 'created'
type Sort = 'priority' | 'deadline'

function sortTasks(list: Task[], sort: Sort) {
  const dl = (t: Task) => taskDeadline(t)?.getTime() ?? Number.MAX_SAFE_INTEGER
  return [...list].sort((a, b) =>
    sort === 'priority' ? prioStars(b.priority) - prioStars(a.priority) || dl(a) - dl(b) : dl(a) - dl(b) || prioStars(b.priority) - prioStars(a.priority),
  )
}

/** Можно ли исполнителю самому перевести задачу в этот статус (сервер проверяет то же самое) */
function canMove(task: Task, to: Task['status'], meId?: string) {
  if (task.status === to) return false
  const personal = task.created_by === meId
  if (task.kind === 'course') return false
  if (task.kind === 'report' && to === 'done' && !personal) return false
  if (task.kind === 'report' && to === 'review' && !task.result_note) return false
  if (task.kind === 'checklist' && to === 'done' && checklistProgress(task).pct < 100) return false
  return true
}

export default function TasksPage() {
  const { role, me } = useAuth()
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>('mine')
  const [sort, setSort] = useState<Sort>('priority')
  // ?new=1 открывает форму сразу (быстрые действия на главной HR и руководителя)
  const [creating, setCreating] = useState(() => params.get('new') === '1')
  const openId = params.get('open')
  const mine = useTasks('mine')
  const created = useTasks('created')
  const update = useUpdateTask()
  const [dragId, setDragId] = useState<string | null>(null)

  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('open', id)
    else next.delete('open')
    setParams(next, { replace: true })
  }

  const move = async (task: Task, status: Task['status']) => {
    if (!canMove(task, status, me?.id)) {
      if (task.kind === 'course') toast.info(t('t2.courseAuto'))
      else if (task.kind === 'report' || task.kind === 'checklist') setOpen(task.id)
      return
    }
    try {
      await update.mutateAsync({ id: task.id, patch: { status } })
      if (status === 'done') toast.success(t('tasks.doneToast', { n: task.number }))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const reviewQueue = (created.data ?? []).filter((x) => x.status === 'review' && x.assignee_id !== me?.id)

  return (
    <div>
      <PageHeader
        title={t('nav.tasks')}
        subtitle={role === 'employee' ? t('t2.subtitleEmployee') : t('t2.subtitleLead')}
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} data-testid="new-task">
            {role === 'employee' ? t('t2.newPersonal') : t('tasks.new')}
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {role !== 'employee' ? (
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            items={[
              { value: 'mine', label: t('tasks.tabMine'), count: (mine.data ?? []).filter((x) => x.status !== 'done').length },
              { value: 'created', label: t('tasks.tabCreated'), count: reviewQueue.length || undefined },
            ]}
          />
        ) : (
          <span />
        )}
        <Segmented<Sort>
          value={sort}
          onChange={setSort}
          options={[
            { value: 'priority', label: t('t2.sortPriority') },
            { value: 'deadline', label: t('t2.sortDeadline') },
          ]}
        />
      </div>

      {tab === 'mine' && (
        <div className="scrollbar-thin -mx-4 overflow-x-auto px-4 pb-2">
          <div className="grid min-w-[980px] grid-cols-4 gap-4">
            {STATUSES.map((s) => {
              const items = sortTasks(
                (mine.data ?? []).filter((x) => x.status === s),
                sort,
              )
              const dragTask = (mine.data ?? []).find((x) => x.id === dragId)
              const droppable = dragTask ? canMove(dragTask, s, me?.id) : false
              return (
                <div
                  key={s}
                  onDragOver={(e) => droppable && e.preventDefault()}
                  onDrop={() => {
                    if (dragTask) void move(dragTask, s)
                    setDragId(null)
                  }}
                  className={cn(
                    'rounded-2xl bg-white/60 p-2 ring-1 ring-line transition',
                    dragId && droppable && 'bg-brand-50/60 ring-2 ring-brand-300',
                    dragId && !droppable && dragTask?.status !== s && 'opacity-60',
                  )}
                  data-column={s}
                >
                  <div className="flex items-center justify-between px-2 pt-1 pb-2.5">
                    <span className="font-semibold">{t(`tasks.${s}` as I18nKey)}</span>
                    <span key={items.length} className="animate-bump rounded-full bg-canvas px-2 text-xs font-semibold text-muted">
                      {items.length}
                    </span>
                  </div>
                  <div className="stagger min-h-[140px] space-y-2">
                    {mine.isLoading && <Skeleton className="h-28" />}
                    {items.map((task, i) => (
                      <div key={task.id} style={{ ['--i' as string]: i }}>
                        <TaskCard task={task} onOpen={() => setOpen(task.id)} onDragStart={() => setDragId(task.id)} onDragEnd={() => setDragId(null)} onMove={(st) => void move(task, st)} />
                      </div>
                    ))}
                    {!mine.isLoading && items.length === 0 && <div className="px-2 py-6 text-center text-xs text-muted">{t(`t2.empty.${s}` as I18nKey)}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'created' && <CreatedList tasks={sortTasks(created.data ?? [], sort)} reviewQueue={reviewQueue} onOpen={setOpen} onNew={() => setCreating(true)} />}

      <NewTaskModal
        open={creating}
        onClose={() => {
          setCreating(false)
          if (params.get('new')) {
            const next = new URLSearchParams(params)
            next.delete('new')
            setParams(next, { replace: true })
          }
        }}
      />
      {openId && <TaskDrawer id={openId} onClose={() => setOpen(null)} onMove={(task, s) => void move(task, s)} />}
    </div>
  )
}

/* ---------- Карточка на доске ---------- */

function TaskCard({
  task,
  onOpen,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  task: Task
  onOpen: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (s: Task['status']) => void
}) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { me } = useAuth()
  const cl = checklistProgress(task)
  const state = deadlineState(task)
  const personal = task.created_by === me?.id

  let action: { label: string; onClick: () => void; variant?: 'soft' | 'primary' } | null = null
  if (task.status !== 'done') {
    if (task.kind === 'course' && task.course)
      action = { label: t('t2.goCourse'), onClick: () => navigate(`/academy/${task.course!.slug}`), variant: 'primary' }
    else if (task.kind === 'checklist') action = { label: t('t2.openChecklist', { done: cl.done, total: cl.total }), onClick: onOpen }
    else if (task.kind === 'report')
      action =
        task.status === 'todo'
          ? { label: t('t2.start'), onClick: () => onMove('in_progress') }
          : task.status === 'in_progress'
            ? { label: t('t2.submitResult'), onClick: onOpen, variant: 'primary' }
            : null
    else action = task.status === 'todo' ? { label: t('t2.start'), onClick: () => onMove('in_progress') } : { label: t('t2.markDone'), onClick: () => onMove('done'), variant: 'primary' }
  }

  return (
    <div
      draggable={task.kind !== 'course'}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'lift group relative cursor-pointer rounded-xl border bg-white p-3 shadow-[var(--shadow-card)]',
        state === 'overdue' ? 'border-rose-200' : 'border-line hover:border-brand-300',
        task.status === 'done' && 'opacity-75',
      )}
      onClick={onOpen}
      data-testid={`task-card-${task.number}`}
    >
      <div className="flex items-center justify-between gap-2">
        <PriorityStars value={task.priority} />
        <span className="text-xs text-muted">{t('tasks.num', { n: task.number })}</span>
      </div>
      <div className={cn('mt-2 text-sm leading-snug font-medium text-ink', task.status === 'done' && 'line-through decoration-brand-400/60')}>{task.title}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <KindChip kind={task.kind} />
        {(task.due_at || task.due_date) && <DeadlineChip task={task} compact />}
      </div>
      {task.kind === 'checklist' && cl.total > 0 && <Progress value={cl.pct} className="mt-2.5 h-1.5" />}
      {task.status === 'review' && <div className="mt-2 text-xs font-medium text-amber-700">{t('t2.waitReview')}</div>}
      {task.review_comment && task.status === 'in_progress' && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          <CornerUpLeft className="mt-0.5 h-3 w-3 shrink-0" /> {task.review_comment}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
        {personal ? (
          t('t2.personal')
        ) : (
          <>
            <Avatar id={task.creator?.id} name={fullName(task.creator)} size={18} /> {t('tasks.from', { name: fullName(task.creator) })}
          </>
        )}
      </div>
      {action && (
        <Button
          size="sm"
          variant={action.variant ?? 'soft'}
          className="mt-2.5 w-full"
          icon={task.kind === 'course' ? <ArrowRight className="h-3.5 w-3.5" /> : undefined}
          onClick={(e) => {
            e.stopPropagation()
            action!.onClick()
          }}
          data-testid={`task-action-${task.number}`}
        >
          {action.label}
        </Button>
      )}
    </div>
  )
}

/* ---------- Поставленные мной ---------- */

function CreatedList({ tasks, reviewQueue, onOpen, onNew }: { tasks: Task[]; reviewQueue: Task[]; onOpen: (id: string) => void; onNew: () => void }) {
  const { t } = useI18n()
  if (tasks.length === 0)
    return (
      <Card>
        <Empty icon={<ClipboardList className="h-6 w-6" />} title={t('tasks.emptyCreated')} action={<Button onClick={onNew}>{t('tasks.new')}</Button>} />
      </Card>
    )
  const row = (task: Task, i: number) => {
    const cl = checklistProgress(task)
    const Icon = KIND_ICON[task.kind]
    return (
      <li key={task.id} style={{ ['--i' as string]: i }}>
        <button onClick={() => onOpen(task.id)} className="flex w-full flex-col gap-2 px-5 py-3.5 text-left transition hover:bg-canvas sm:flex-row sm:items-center">
          <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 sm:grid">
            <Icon className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              <span className="text-muted">{t('tasks.num', { n: task.number })}</span> {task.title}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <Avatar id={task.assignee?.id} name={fullName(task.assignee)} size={20} /> {fullName(task.assignee)}
              <DeadlineChip task={task} compact />
              {task.kind === 'checklist' && <span className="text-xs">{t('t2.stepsDone', { done: cl.done, total: cl.total })}</span>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <PriorityStars value={task.priority} />
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                task.status === 'done'
                  ? 'bg-brand-50 text-brand-700 ring-brand-200'
                  : task.status === 'review'
                    ? 'bg-amber-50 text-amber-800 ring-amber-200'
                    : 'bg-canvas text-ink-soft ring-line',
              )}
            >
              {t(`tasks.${task.status}` as I18nKey)}
            </span>
          </div>
        </button>
      </li>
    )
  }
  return (
    <div className="space-y-4">
      {reviewQueue.length > 0 && (
        <Card className="overflow-hidden border-amber-200">
          <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50/60 px-5 py-3 text-sm font-semibold text-amber-900">
            <CheckCircle2 className="h-4 w-4" /> {t('t2.needReview', { n: reviewQueue.length })}
          </div>
          <ul className="stagger divide-y divide-line">{reviewQueue.map(row)}</ul>
        </Card>
      )}
      <Card className="overflow-hidden">
        <ul className="stagger divide-y divide-line">{tasks.filter((x) => !reviewQueue.includes(x)).map(row)}</ul>
      </Card>
    </div>
  )
}

/* ---------- Карточка задачи ---------- */

function TaskDrawer({ id, onClose, onMove }: { id: string; onClose: () => void; onMove: (t: Task, s: Task['status']) => void }) {
  const { me } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: task, isLoading } = useTask(id)
  const update = useUpdateTask()
  const review = useReviewTask()
  const [text, setText] = useState('')
  const [burst, setBurst] = useState(0)
  const comments = useQuery({
    queryKey: ['task-comments', id],
    queryFn: () =>
      must(
        supabase.from('task_comments').select('*, author:employees!task_comments_author_fk(id,first_name,last_name)').eq('task_id', id).order('created_at'),
      ) as Promise<{ id: string; body: string; created_at: string; author: { id: string; first_name: string; last_name: string } | null }[]>,
  })

  if (isLoading || !task)
    return (
      <Drawer open onClose={onClose} title={<Skeleton className="h-6 w-60" />}>
        <Skeleton className="h-40" />
      </Drawer>
    )

  const isAssignee = task.assignee_id === me?.id
  const isCreator = task.created_by === me?.id
  const personal = isAssignee && isCreator
  const cl = checklistProgress(task)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['task', id] })
    void qc.invalidateQueries({ queryKey: ['tasks'] })
  }
  const patch = async (p: Partial<Task>, okText?: string) => {
    try {
      await update.mutateAsync({ id: task.id, patch: p })
      refresh()
      if (okText) toast.success(okText)
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    }
  }

  const KindIcon = KIND_ICON[task.kind]

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-2xl"
      title={
        <span className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <KindIcon className="h-5 w-5" />
          </span>
          <span>
            <span className="text-muted">{t('tasks.num', { n: task.number })}</span> {task.title}
          </span>
        </span>
      }
      subtitle={t('tasks.drawerSubtitle', { category: TASK_CATEGORIES[task.category] ?? task.category, date: fmtDateTime(task.created_at) })}
    >
      <div className="space-y-6" data-testid="task-drawer">
        <div className="grid gap-3 sm:grid-cols-2">
          <DeadlineBlock task={task} />
          <div className="flex flex-col justify-center gap-1.5 rounded-2xl px-4 py-3 ring-1 ring-line ring-inset">
            <span className="text-xs font-semibold tracking-wide text-muted uppercase">{t('tasks.priority')}</span>
            <PriorityStars size="md" value={task.priority} onChange={isCreator || !isAssignee ? (p) => void patch({ priority: p }) : undefined} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <KindChip kind={task.kind} />
          <span className="text-sm text-muted">{t(`t2.kindHint.${task.kind}` as I18nKey)}</span>
        </div>

        {task.description && (
          <section>
            <h4 className="mb-2 text-sm font-semibold">{t('t2.what')}</h4>
            <div className="prose-jana rounded-2xl bg-canvas px-4 py-3">
              <ReactMarkdown>{task.description}</ReactMarkdown>
            </div>
          </section>
        )}

        {task.kind === 'course' && task.course && (
          <section className="flex flex-col gap-3 rounded-2xl border border-brand-200 bg-brand-50/50 p-4 sm:flex-row sm:items-center">
            <CourseIcon name={task.course.icon} className="h-12 w-12" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{task.course.title}</div>
              <div className="text-sm text-muted">{t('t2.courseMeta', { m: task.course.duration_minutes })}</div>
            </div>
            {task.status !== 'done' ? (
              <Button icon={<ArrowRight className="h-4 w-4" />} onClick={() => navigate(`/academy/${task.course!.slug}`)} data-testid="task-go-course">
                {t('t2.goCourse')}
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
                <CheckCircle2 className="h-4 w-4" /> {t('tasks.done')}
              </span>
            )}
          </section>
        )}

        {task.kind === 'checklist' && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold">{t('t2.steps')}</h4>
              <span className="text-sm font-medium text-brand-700">{t('t2.stepsDone', { done: cl.done, total: cl.total })}</span>
            </div>
            <Progress value={cl.pct} className="mb-3" />
            <ul className="space-y-1.5">
              {task.checklist.map((step, i) => (
                <li key={i} className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-line transition', step.done && 'bg-brand-50/50 ring-brand-100')}>
                  <CheckBox
                    checked={step.done}
                    disabled={!(isAssignee || isCreator) || task.status === 'done'}
                    onChange={(v) => void patch({ checklist: task.checklist.map((s, j) => (j === i ? { ...s, done: v } : s)) })}
                  />
                  <span className={cn('text-sm transition', step.done ? 'text-muted line-through' : 'text-ink')}>{step.text}</span>
                </li>
              ))}
            </ul>
            {isAssignee && task.status !== 'done' && (
              <div className="relative mt-3">
                <Burst trigger={burst} />
                <Button
                  className="w-full"
                  disabled={cl.pct < 100}
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  onClick={async () => {
                    if (await patch({ status: 'done' }, t('tasks.doneToast', { n: task.number }))) setBurst(Date.now())
                  }}
                  data-testid="checklist-done"
                >
                  {cl.pct < 100 ? t('t2.checklistLeft', { n: cl.total - cl.done }) : t('t2.markDone')}
                </Button>
              </div>
            )}
          </section>
        )}

        {task.kind === 'report' && (
          <ReportSection task={task} isAssignee={isAssignee} onPatch={patch} onReviewed={() => setBurst(Date.now())} burst={burst} canReview={!isAssignee || personal} review={review} />
        )}

        {task.kind === 'simple' && isAssignee && task.status !== 'done' && (
          <div className="relative flex gap-2">
            <Burst trigger={burst} />
            {task.status === 'todo' && (
              <Button variant="outline" className="flex-1" onClick={() => void patch({ status: 'in_progress' })}>
                {t('t2.start')}
              </Button>
            )}
            <Button
              className="flex-1"
              icon={<CheckCircle2 className="h-4 w-4" />}
              onClick={async () => {
                if (await patch({ status: 'done' }, t('tasks.doneToast', { n: task.number }))) setBurst(Date.now())
              }}
              data-testid="simple-done"
            >
              {t('t2.markDone')}
            </Button>
          </div>
        )}
        {task.kind === 'simple' && !isAssignee && <div className="text-sm text-muted">{t('t2.statusNow', { status: t(`tasks.${task.status}` as I18nKey) })}</div>}

        <section className="grid gap-3 sm:grid-cols-2">
          {[
            { label: t('tasks.creator'), person: task.creator, show: !personal, write: !isCreator },
            { label: t('tasks.assignee'), person: task.assignee, show: true, write: !isAssignee },
          ]
            .filter((x) => x.show && x.person)
            .map((x) => (
              <div key={x.label} className="flex items-center gap-3 rounded-2xl p-3 ring-1 ring-line ring-inset">
                <Avatar id={x.person!.id} name={fullName(x.person)} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted">{x.label}</div>
                  <div className="truncate font-medium">{fullName(x.person)}</div>
                  <div className="truncate text-xs text-muted">{x.person!.position}</div>
                </div>
                {x.write && <WriteButton employeeId={x.person!.id} size="sm" />}
              </div>
            ))}
        </section>

        <Timeline task={task} />

        <section>
          <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="h-4 w-4" /> {t('tasks.comments')}
          </h4>
          <ul className="stagger space-y-2">
            {(comments.data ?? []).map((c, i) => (
              <li key={c.id} style={{ ['--i' as string]: i }} className="flex gap-2.5 rounded-xl border border-line px-3 py-2 text-sm">
                <Avatar id={c.author?.id} name={fullName(c.author)} size={26} />
                <div>
                  <div className="text-xs text-muted">
                    {fullName(c.author)} · {fmtDateTime(c.created_at)}
                  </div>
                  <div className="mt-0.5 whitespace-pre-line text-ink">{c.body}</div>
                </div>
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!text.trim()) return
              try {
                await must(supabase.from('task_comments').insert({ task_id: task.id, author_id: me!.id, body: text.trim() }))
                setText('')
                await qc.invalidateQueries({ queryKey: ['task-comments', task.id] })
              } catch (err) {
                toast.error((err as Error).message)
              }
            }}
          >
            <input className="field" placeholder={t('tasks.commentPlaceholder')} value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="submit" size="icon" aria-label={t('common.send')}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </section>

        {(isCreator || !isAssignee) && task.kind !== 'course' && (
          <section>
            <h4 className="mb-2 text-sm font-semibold">{t('t2.statusManual')}</h4>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => onMove(task, s)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition active:scale-95',
                    task.status === s ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-ink-soft ring-line hover:ring-brand-300',
                  )}
                >
                  {t(`tasks.${s}` as I18nKey)}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </Drawer>
  )
}

/* ---------- Результат для задачи-отчёта ---------- */

function ReportSection({
  task,
  isAssignee,
  canReview,
  onPatch,
  onReviewed,
  burst,
  review,
}: {
  task: Task
  isAssignee: boolean
  canReview: boolean
  onPatch: (p: Partial<Task>, ok?: string) => Promise<boolean>
  onReviewed: () => void
  burst: number
  review: ReturnType<typeof useReviewTask>
}) {
  const { t } = useI18n()
  const { me } = useAuth()
  const files = useTaskAttachments(task.id)
  const add = useAddAttachment()
  const del = useDeleteAttachment()
  const [note, setNote] = useState(task.result_note ?? '')
  const [comment, setComment] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  useEffect(() => setNote(task.result_note ?? ''), [task.result_note])

  const editable = isAssignee && (task.status === 'todo' || task.status === 'in_progress')
  const upload = async (list: FileList | null) => {
    for (const f of Array.from(list ?? [])) {
      try {
        const prepared = await prepareFile(f)
        await add.mutateAsync({ taskId: task.id, ...prepared })
      } catch (e) {
        toast.error((e as Error).message === 'too-big' ? t('t2.fileTooBig') : (e as Error).message)
      }
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-line p-4" data-testid="report-section">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <FileText className="h-4 w-4 text-brand-600" /> {t('t2.result')}
      </h4>

      {task.review_comment && task.status !== 'done' && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <CornerUpLeft className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">{t('t2.returnedTitle')}</div>
            {task.review_comment}
          </div>
        </div>
      )}

      {editable ? (
        <textarea className="field min-h-[96px]" placeholder={t('t2.resultPlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} data-testid="result-note" />
      ) : (
        <div className="rounded-xl bg-canvas px-3 py-2.5 text-sm whitespace-pre-line text-ink-soft">{task.result_note || t('t2.noResultYet')}</div>
      )}

      <ul className="space-y-1.5">
        {(files.data ?? []).map((f) => (
          <li key={f.id} className="flex animate-rise items-center gap-3 rounded-xl px-3 py-2 ring-1 ring-line">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-700">
              {f.mime.startsWith('image/') ? <ImageIcon className="h-4 w-4" /> : <Paperclip className="h-4 w-4" />}
            </span>
            <button className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-brand-700" onClick={async () => openDataUrl(await fetchAttachmentData(f.id), f.name)}>
              {f.name}
            </button>
            <span className="text-xs text-muted">{fileSize(f.size)}</span>
            {editable && f.author_id === me?.id && (
              <button onClick={() => del.mutate({ id: f.id, taskId: task.id })} className="rounded-lg p-1 text-muted hover:bg-rose-50 hover:text-rose-600" aria-label={t('common.delete')}>
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {editable && (
        <>
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              void upload(e.dataTransfer.files)
            }}
            className={cn(
              'flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-4 text-sm transition',
              drag ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line text-muted hover:border-brand-300 hover:text-ink',
            )}
          >
            <Upload className={cn('h-5 w-5', add.isPending && 'animate-bounce')} />
            <span className="font-medium">{t('t2.attach')}</span>
            <span className="text-xs">{t('t2.attachHint')}</span>
          </button>
          <input ref={input} type="file" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" multiple hidden onChange={(e) => void upload(e.target.files)} data-testid="result-file" />
          <Button
            className="w-full"
            icon={<Send className="h-4 w-4" />}
            disabled={!note.trim() && (files.data ?? []).length === 0}
            onClick={() => void onPatch({ result_note: note.trim() || null, status: 'review' }, t('t2.sentReview'))}
            data-testid="send-review"
          >
            {t('t2.sendReview')}
          </Button>
        </>
      )}

      {task.status === 'review' && isAssignee && !canReview && <div className="text-sm font-medium text-amber-700">{t('t2.waitReview')}</div>}

      {task.status === 'review' && canReview && (
        <div className="relative space-y-2 rounded-xl bg-canvas p-3">
          <Burst trigger={burst} />
          <textarea className="field min-h-[60px]" placeholder={t('t2.returnPlaceholder')} value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button
              className="flex-1"
              icon={<CheckCircle2 className="h-4 w-4" />}
              loading={review.isPending}
              onClick={() =>
                review.mutate(
                  { id: task.id, accept: true, comment },
                  {
                    onSuccess: () => {
                      toast.success(t('t2.accepted'))
                      onReviewed()
                    },
                    onError: (e) => toast.error((e as Error).message),
                  },
                )
              }
              data-testid="review-accept"
            >
              {t('t2.accept')}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              icon={<CornerUpLeft className="h-4 w-4" />}
              disabled={!comment.trim()}
              onClick={() =>
                review.mutate({ id: task.id, accept: false, comment }, { onSuccess: () => toast.success(t('t2.returned')), onError: (e) => toast.error((e as Error).message) })
              }
              data-testid="review-return"
            >
              {t('t2.return')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

/* ---------- Ход выполнения ---------- */

function Timeline({ task }: { task: Task }) {
  const { t } = useI18n()
  const steps = [
    { key: 'created', at: task.created_at },
    { key: 'started', at: task.started_at },
    ...(task.kind === 'report' ? [{ key: 'submitted', at: task.submitted_at }] : []),
    { key: 'done', at: task.completed_at },
  ]
  return (
    <section>
      <h4 className="mb-3 text-sm font-semibold">{t('t2.history')}</h4>
      <ol className="flex items-start">
        {steps.map((s, i) => (
          <li key={s.key} className="relative flex flex-1 flex-col items-center text-center">
            {i > 0 && <span className={cn('absolute top-3 right-1/2 h-0.5 w-full', s.at ? 'bg-brand-400' : 'bg-line')} />}
            <span className={cn('relative z-10 grid h-6 w-6 place-items-center rounded-full ring-4 ring-white transition', s.at ? 'bg-brand-600 text-white' : 'bg-line text-muted')}>
              {s.at ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            </span>
            <span className={cn('mt-1.5 text-xs font-medium', s.at ? 'text-ink' : 'text-muted')}>{t(`t2.timeline.${s.key}` as I18nKey)}</span>
            {s.at && <span className="text-[11px] text-muted">{fmtDateTime(s.at)}</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}

/* ---------- Новая задача ---------- */

const KINDS: TaskKind[] = ['simple', 'checklist', 'report', 'course']

function NewTaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, role } = useAuth()
  const { t } = useI18n()
  const people = useEmployeesLite()
  const courses = useCourses()
  const assign = useAssignTasks()
  const [kind, setKind] = useState<TaskKind>('simple')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Task['priority']>('medium')
  const [category, setCategory] = useState('general')
  const [dueDay, setDueDay] = useState(isoDate(addDays(new Date(), 3)))
  const [dueTime, setDueTime] = useState('18:00')
  const [courseId, setCourseId] = useState<string>('')
  const [steps, setSteps] = useState<string[]>([''])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')

  const candidates = useMemo(() => {
    const list = (people.data ?? []).filter((p) => role === 'hr' || p.manager_id === me?.id || p.id === me?.id)
    return list.filter((p) => !q || fullName(p, true).toLowerCase().includes(q.toLowerCase()))
  }, [people.data, role, me, q])

  const kinds = role === 'employee' ? KINDS.filter((k) => k === 'simple' || k === 'checklist') : KINDS
  const effective = role === 'employee' ? new Set([me!.id]) : selected
  const course = (courses.data ?? []).find((c) => c.id === courseId)
  const cleanSteps = steps.map((s) => s.trim()).filter(Boolean)
  const ready = (kind === 'course' ? Boolean(courseId) : title.trim().length > 0) && effective.size > 0 && (kind !== 'checklist' || cleanSteps.length > 0)

  const reset = () => {
    setTitle('')
    setDescription('')
    setSelected(new Set())
    setSteps([''])
    setCourseId('')
    setKind('simple')
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={role === 'employee' ? t('t2.newPersonal') : t('tasks.new')}
      subtitle={role === 'employee' ? t('tasks.personalHint') : t('tasks.notifyHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={assign.isPending}
            disabled={!ready}
            onClick={async () => {
              try {
                const dueAt = dueDay ? new Date(`${dueDay}T${dueTime || '18:00'}:00`).toISOString() : null
                const n = await assign.mutateAsync({
                  title: kind === 'course' && course ? t('t2.courseTaskTitle', { title: course.title }) : title,
                  description,
                  priority,
                  category: kind === 'course' ? 'training' : category,
                  dueAt,
                  assignees: [...effective],
                  kind,
                  courseId: kind === 'course' ? courseId : null,
                  checklist: kind === 'checklist' ? cleanSteps.map((text) => ({ text, done: false })) : [],
                })
                toast.success(n > 1 ? t('tasks.assignedToast', { n }) : t('tasks.createdToast'))
                reset()
                onClose()
              } catch (e) {
                toast.error((e as Error).message)
              }
            }}
            data-testid="task-submit"
          >
            {t('tasks.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <span className="label">{t('t2.typeLabel')}</span>
          <div className={cn('grid gap-2', kinds.length > 2 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2')}>
            {kinds.map((k) => {
              const Icon = KIND_ICON[k]
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    'flex flex-col items-start gap-1.5 rounded-xl p-3 text-left ring-1 transition active:scale-[0.98]',
                    kind === k ? 'bg-brand-50 ring-2 ring-brand-500' : 'bg-white ring-line hover:ring-brand-300',
                  )}
                  data-testid={`kind-${k}`}
                >
                  <Icon className={cn('h-5 w-5', kind === k ? 'text-brand-700' : 'text-muted')} />
                  <span className="text-sm font-semibold">{t(`t2.kind.${k}` as I18nKey)}</span>
                  <span className="text-[11.5px] leading-snug text-muted">{t(`t2.kindHint.${k}` as I18nKey)}</span>
                </button>
              )
            })}
          </div>
        </div>

        {kind === 'course' ? (
          <Field label={t('t2.courseSelect')}>
            <select className="field" value={courseId} onChange={(e) => setCourseId(e.target.value)} data-testid="task-course">
              <option value="">{t('t2.courseChoose')}</option>
              {(courses.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} · {t('t2.minutes', { m: c.duration_minutes })}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label={t('tasks.titleLabel')}>
            <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('tasks.titlePlaceholder')} data-testid="task-title" />
          </Field>
        )}
        <Field label={t('tasks.description')} hint={t('t2.descriptionHint')}>
          <textarea className="field min-h-[88px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('t2.descriptionPlaceholder')} />
        </Field>

        {kind === 'checklist' && (
          <div>
            <span className="label">{t('t2.steps')}</span>
            <ul className="space-y-2">
              {steps.map((s, i) => (
                <li key={i} className="flex animate-rise items-center gap-2">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-canvas text-xs font-semibold text-muted">{i + 1}</span>
                  <input
                    className="field"
                    value={s}
                    placeholder={t('t2.stepPlaceholder')}
                    onChange={(e) => setSteps(steps.map((x, j) => (j === i ? e.target.value : x)))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        setSteps([...steps, ''])
                      }
                    }}
                    data-testid={`step-${i}`}
                  />
                  {steps.length > 1 && (
                    <button type="button" onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-muted hover:bg-canvas" aria-label={t('common.delete')}>
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <Button variant="ghost" size="sm" className="mt-2" icon={<Plus className="h-4 w-4" />} onClick={() => setSteps([...steps, ''])}>
              {t('t2.addStep')}
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.3fr_1fr_0.8fr]">
          <div>
            <span className="label">{t('tasks.priority')}</span>
            <div className="flex h-[46px] items-center">
              <PriorityStars value={priority} onChange={setPriority} size="md" />
            </div>
          </div>
          <Field label={t('t2.deadlineDate')}>
            <input type="date" className="field" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
          </Field>
          <Field label={t('t2.deadlineTime')}>
            <input type="time" className="field" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          </Field>
        </div>
        {kind !== 'course' && (
          <Field label={t('tasks.category')}>
            <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(TASK_CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        )}

        {role !== 'employee' && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="label mb-0">{selected.size > 0 ? t('tasks.assigneesN', { n: selected.size }) : t('tasks.assignees')}</span>
              <button className="text-sm font-medium text-brand-700" onClick={() => setSelected(new Set(candidates.filter((p) => p.id !== me?.id).map((p) => p.id)))}>
                {t('tasks.wholeTeam')}
              </button>
            </div>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
              <input className="field pl-9" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="scrollbar-thin max-h-56 overflow-y-auto rounded-xl border border-line">
              {candidates.map((p) => (
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
                    data-testid={`assignee-${p.id}`}
                  />
                  <Avatar id={p.id} name={fullName(p)} size={28} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {fullName(p, true)} {p.id === me?.id && <span className="text-muted">{t('tasks.me')}</span>}
                    </span>
                    <span className="block truncate text-xs text-muted">{p.position}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
