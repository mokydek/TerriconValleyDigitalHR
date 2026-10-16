import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays } from 'date-fns'
import { CalendarClock, ClipboardList, MessageSquare, Plus, Search, Send } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useI18n, type I18nKey } from '@/lib/i18n'
import { useAssignTasks, useEmployeesLite, useTasks, useUpdateTask } from '@/lib/api'
import { must, supabase } from '@/lib/supabase'
import { PRIORITY_META, TASK_CATEGORIES } from '@/lib/constants'
import { fmtDate, fmtDateTime, fullName, isoDate } from '@/lib/format'
import type { Task } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Avatar, Badge, Button, Card, Drawer, Empty, Field, Modal, PageHeader, Skeleton, Tabs } from '@/components/ui'

const STATUSES: Task['status'][] = ['todo', 'in_progress', 'review', 'done']
type Tab = 'mine' | 'created'

export default function TasksPage() {
  const { role } = useAuth()
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('mine')
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<Task | null>(null)
  const mine = useTasks('mine')
  const created = useTasks('created')
  const update = useUpdateTask()
  const [dragId, setDragId] = useState<string | null>(null)

  const move = async (task: Task, status: Task['status']) => {
    if (task.status === status) return
    try {
      await update.mutateAsync({ id: task.id, patch: { status } })
      if (status === 'done') toast.success(`Задача №${task.number} выполнена 🎉`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div>
      <PageHeader
        title={t('nav.tasks')}
        subtitle={role === 'employee' ? 'Задачи от руководителя и HR. Перетащите карточку, чтобы сменить статус.' : 'Ставьте задачи команде и следите за выполнением'}
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)} data-testid="new-task">
            Новая задача
          </Button>
        }
      />
      {role !== 'employee' && (
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          className="mb-4"
          items={[
            { value: 'mine', label: 'Мои задачи', count: (mine.data ?? []).filter((x) => x.status !== 'done').length },
            { value: 'created', label: 'Поставлены мной', count: (created.data ?? []).filter((x) => x.status !== 'done').length },
          ]}
        />
      )}

      {tab === 'mine' && (
        <div className="scrollbar-thin -mx-4 overflow-x-auto px-4 pb-2">
          <div className="grid min-w-[900px] grid-cols-4 gap-4">
            {STATUSES.map((s) => {
              const items = (mine.data ?? []).filter((x) => x.status === s)
              return (
                <div
                  key={s}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    const task = (mine.data ?? []).find((x) => x.id === dragId)
                    if (task) void move(task, s)
                    setDragId(null)
                  }}
                  className={cn('rounded-2xl bg-white/60 p-2 ring-1 ring-line', dragId && 'ring-brand-300')}
                >
                  <div className="flex items-center justify-between px-2 pt-1 pb-2.5">
                    <span className="font-semibold">{t(`tasks.${s}` as I18nKey)}</span>
                    <span className="rounded-full bg-canvas px-2 text-xs font-semibold text-muted">{items.length}</span>
                  </div>
                  <div className="min-h-[120px] space-y-2">
                    {mine.isLoading && <Skeleton className="h-24" />}
                    {items.map((task) => (
                      <TaskCard key={task.id} task={task} onOpen={() => setOpen(task)} onDragStart={() => setDragId(task.id)} onMove={(st) => void move(task, st)} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'created' && (
        <Card className="overflow-hidden">
          {(created.data ?? []).length === 0 ? (
            <Empty icon={<ClipboardList className="h-6 w-6" />} title="Вы ещё не ставили задач" action={<Button onClick={() => setCreating(true)}>Новая задача</Button>} />
          ) : (
            <ul className="divide-y divide-line">
              {(created.data ?? []).map((task) => (
                <li key={task.id}>
                  <button onClick={() => setOpen(task)} className="flex w-full flex-col gap-2 px-5 py-3.5 text-left hover:bg-canvas sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        <span className="text-muted">№{task.number}</span> {task.title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-sm text-muted">
                        <Avatar name={fullName(task.assignee)} size={20} /> {fullName(task.assignee)}
                        {task.due_date && <span>· до {fmtDate(task.due_date, 'd MMM')}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={PRIORITY_META[task.priority].style}>{PRIORITY_META[task.priority].label}</Badge>
                      <Badge className={task.status === 'done' ? 'bg-brand-50 text-brand-700 ring-brand-200' : 'bg-canvas text-ink-soft ring-line'}>{t(`tasks.${task.status}` as I18nKey)}</Badge>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <NewTaskModal open={creating} onClose={() => setCreating(false)} />
      <TaskDrawer task={open} onClose={() => setOpen(null)} onMove={(task, s) => void move(task, s)} />
    </div>
  )
}

function TaskCard({ task, onOpen, onDragStart, onMove }: { task: Task; onOpen: () => void; onDragStart: () => void; onMove: (s: Task['status']) => void }) {
  const overdue = task.status !== 'done' && task.due_date && new Date(task.due_date) < new Date(new Date().toDateString())
  const next: Partial<Record<Task['status'], { to: Task['status']; label: string }>> = {
    todo: { to: 'in_progress', label: 'Взять в работу' },
    in_progress: { to: 'review', label: 'На проверку' },
    review: { to: 'done', label: 'Готово' },
  }
  const n = next[task.status]
  return (
    <div draggable onDragStart={onDragStart} className="cursor-grab rounded-xl border border-line bg-white p-3 shadow-[var(--shadow-card)] transition hover:border-brand-300 active:cursor-grabbing">
      <button onClick={onOpen} className="w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <Badge className={PRIORITY_META[task.priority].style}>{PRIORITY_META[task.priority].label}</Badge>
          <span className="text-xs text-muted">№{task.number}</span>
        </div>
        <div className="mt-2 text-sm font-medium text-ink">{task.title}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span>{TASK_CATEGORIES[task.category] ?? task.category}</span>
          {task.due_date && (
            <span className={cn('inline-flex items-center gap-1', overdue && 'font-semibold text-rose-600')}>
              <CalendarClock className="h-3 w-3" /> {fmtDate(task.due_date, 'd MMM')}
            </span>
          )}
        </div>
        {task.creator && <div className="mt-1 text-xs text-muted">от {fullName(task.creator)}</div>}
      </button>
      {n && (
        <Button size="sm" variant="soft" className="mt-2.5 w-full" onClick={() => onMove(n.to)}>
          {n.label}
        </Button>
      )}
    </div>
  )
}

function TaskDrawer({ task, onClose, onMove }: { task: Task | null; onClose: () => void; onMove: (t: Task, s: Task['status']) => void }) {
  const { me } = useAuth()
  const { t } = useI18n()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const comments = useQuery({
    queryKey: ['task-comments', task?.id],
    enabled: Boolean(task),
    queryFn: () =>
      must(
        supabase.from('task_comments').select('*, author:employees!task_comments_author_fk(first_name,last_name)').eq('task_id', task!.id).order('created_at'),
      ) as Promise<{ id: string; body: string; created_at: string; author: { first_name: string; last_name: string } | null }[]>,
  })
  if (!task) return null
  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <span>
          <span className="text-muted">№{task.number}</span> {task.title}
        </span>
      }
      subtitle={`${TASK_CATEGORIES[task.category] ?? task.category} · поставлена ${fmtDateTime(task.created_at)}`}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => {
                onMove(task, s)
                onClose()
              }}
              className={cn('rounded-lg px-3 py-1.5 text-sm font-medium ring-1 transition', task.status === s ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-ink-soft ring-line hover:ring-brand-300')}
            >
              {t(`tasks.${s}` as I18nKey)}
            </button>
          ))}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted">Исполнитель</dt>
            <dd className="font-medium">{fullName(task.assignee)}</dd>
          </div>
          <div>
            <dt className="text-muted">Постановщик</dt>
            <dd className="font-medium">{fullName(task.creator)}</dd>
          </div>
          <div>
            <dt className="text-muted">Срок</dt>
            <dd className="font-medium">{task.due_date ? fmtDate(task.due_date) : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted">Приоритет</dt>
            <dd>
              <Badge className={PRIORITY_META[task.priority].style}>{PRIORITY_META[task.priority].label}</Badge>
            </dd>
          </div>
        </dl>
        {task.description && <p className="rounded-xl bg-canvas px-4 py-3 text-sm whitespace-pre-line text-ink-soft">{task.description}</p>}
        <div>
          <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="h-4 w-4" /> Комментарии
          </h4>
          <ul className="space-y-2">
            {(comments.data ?? []).map((c) => (
              <li key={c.id} className="rounded-xl border border-line px-3 py-2 text-sm">
                <div className="text-xs text-muted">
                  {fullName(c.author)} · {fmtDateTime(c.created_at)}
                </div>
                <div className="mt-0.5 text-ink">{c.body}</div>
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
            <input className="field" placeholder="Написать комментарий" value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="submit" size="icon" aria-label="Отправить">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </Drawer>
  )
}

function NewTaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, role } = useAuth()
  const people = useEmployeesLite()
  const assign = useAssignTasks()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [category, setCategory] = useState('general')
  const [due, setDue] = useState(isoDate(addDays(new Date(), 3)))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')

  const candidates = useMemo(() => {
    const list = (people.data ?? []).filter((p) => role === 'hr' || p.manager_id === me?.id || p.id === me?.id)
    return list.filter((p) => !q || fullName(p, true).toLowerCase().includes(q.toLowerCase()))
  }, [people.data, role, me, q])

  const effective = role === 'employee' ? new Set([me!.id]) : selected

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Новая задача"
      subtitle={role === 'employee' ? 'Личная задача — видите вы и ваш руководитель' : 'Исполнители получат уведомление'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button
            loading={assign.isPending}
            disabled={!title.trim() || effective.size === 0}
            onClick={async () => {
              try {
                const n = await assign.mutateAsync({ title, description, priority, category, due: due || null, assignees: [...effective] })
                toast.success(n > 1 ? `Задача поставлена ${n} сотрудникам` : 'Задача создана')
                setTitle('')
                setDescription('')
                setSelected(new Set())
                onClose()
              } catch (e) {
                toast.error((e as Error).message)
              }
            }}
            data-testid="task-submit"
          >
            Поставить задачу
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Что сделать">
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: инвентаризация зоны B-12" />
        </Field>
        <Field label="Описание" hint="Необязательно">
          <textarea className="field min-h-[72px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Приоритет">
            <select className="field" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {Object.entries(PRIORITY_META).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Категория">
            <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(TASK_CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Срок">
            <input type="date" className="field" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        {role !== 'employee' && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="label mb-0">Исполнители {selected.size > 0 && `(${selected.size})`}</span>
              <button className="text-sm font-medium text-brand-700" onClick={() => setSelected(new Set(candidates.filter((p) => p.id !== me?.id).map((p) => p.id)))}>
                Всей команде
              </button>
            </div>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
              <input className="field pl-9" placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
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
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {fullName(p, true)} {p.id === me?.id && <span className="text-muted">(я)</span>}
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
