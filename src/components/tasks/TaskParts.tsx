import { useEffect, useState } from 'react'
import { ClipboardList, FileText, GraduationCap, ListChecks, Star, Timer } from '@/components/icons'
import { useI18n, type I18nKey } from '@/lib/i18n'
import { fmtDate } from '@/lib/format'
import type { Task, TaskKind } from '@/lib/types'
import { cn } from '@/lib/utils'

/* ---------- Приоритет звёздами: 1 низкий … 4 срочно ---------- */

const PRIO: Task['priority'][] = ['low', 'medium', 'high', 'urgent']
export const prioStars = (p: Task['priority']) => PRIO.indexOf(p) + 1
export const starsPrio = (n: number) => PRIO[Math.min(4, Math.max(1, n)) - 1]

export function PriorityStars({
  value,
  onChange,
  size = 'sm',
}: {
  value: Task['priority']
  onChange?: (p: Task['priority']) => void
  size?: 'sm' | 'md'
}) {
  const { t } = useI18n()
  const [hover, setHover] = useState<number | null>(null)
  const n = prioStars(value)
  const shown = hover ?? n
  const label = t(`t2.stars.${hover ?? n}` as I18nKey)
  const px = size === 'md' ? 'h-6 w-6' : 'h-3.5 w-3.5'
  return (
    <span
      className={cn('inline-flex items-center', size === 'md' ? 'gap-1' : 'gap-0.5')}
      title={t('t2.starsAria', { label })}
      aria-label={t('t2.starsAria', { label })}
      onMouseLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4].map((i) => {
        const on = i <= shown
        const star = (
          <Star
            key={on ? `on-${i}-${n}` : `off-${i}`}
            className={cn(px, 'transition-colors', on ? (shown === 4 ? 'fill-rose-500 text-rose-500' : 'fill-amber-400 text-amber-400') : 'text-line', on && onChange && 'animate-star')}
          />
        )
        if (!onChange) return star
        return (
          <button
            key={i}
            type="button"
            onMouseEnter={() => setHover(i)}
            onClick={(e) => {
              e.stopPropagation()
              onChange(starsPrio(i))
            }}
            className="rounded p-0.5 transition-transform hover:scale-110 active:scale-90"
            aria-label={t(`t2.stars.${i}` as I18nKey)}
            data-testid={`star-${i}`}
          >
            {star}
          </button>
        )
      })}
      {size === 'md' && <span className={cn('ml-2 text-sm font-medium', shown === 4 ? 'text-rose-600' : 'text-ink-soft')}>{label}</span>}
    </span>
  )
}

/* ---------- Дедлайн: дата, время и живой обратный отсчёт ---------- */

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export type DeadlineState = 'overdue' | 'soon' | 'today' | 'later' | 'done' | 'none'

export function taskDeadline(task: Pick<Task, 'due_at' | 'due_date' | 'status'>): Date | null {
  if (task.due_at) return new Date(task.due_at)
  if (task.due_date) return new Date(`${task.due_date}T18:00:00`)
  return null
}

export function deadlineState(task: Pick<Task, 'due_at' | 'due_date' | 'status'>, now = Date.now()): DeadlineState {
  const d = taskDeadline(task)
  if (!d) return 'none'
  if (task.status === 'done') return 'done'
  const diff = d.getTime() - now
  if (diff < 0) return 'overdue'
  if (diff < 6 * 3600_000) return 'soon'
  if (new Date(now).toDateString() === d.toDateString()) return 'today'
  return 'later'
}

function spanText(ms: number, t: ReturnType<typeof useI18n>['t']) {
  const m = Math.max(1, Math.round(Math.abs(ms) / 60_000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return t('t2.span.days', { d, h })
  if (h > 0) return t('t2.span.hours', { h, m: m % 60 })
  return t('t2.span.minutes', { m })
}

export function useDeadlineText(task: Pick<Task, 'due_at' | 'due_date' | 'status'>) {
  const { t } = useI18n()
  const now = useNow()
  const d = taskDeadline(task)
  const state = deadlineState(task, now)
  if (!d) return { state, when: t('t2.noDeadline'), left: '' }
  const time = fmtDate(d, 'HH:mm')
  const today = new Date(now)
  const tomorrow = new Date(now + 86_400_000)
  const when =
    d.toDateString() === today.toDateString()
      ? t('t2.dueToday', { time })
      : d.toDateString() === tomorrow.toDateString()
        ? t('t2.dueTomorrow', { time })
        : t('t2.dueOn', { date: fmtDate(d, 'd MMM'), time })
  const diff = d.getTime() - now
  const left = state === 'done' ? '' : diff < 0 ? t('t2.overdueBy', { span: spanText(diff, t) }) : t('t2.leftFor', { span: spanText(diff, t) })
  return { state, when, left }
}

const DEADLINE_STYLE: Record<DeadlineState, string> = {
  overdue: 'bg-rose-50 text-rose-700 ring-rose-200',
  soon: 'bg-amber-50 text-amber-800 ring-amber-200',
  today: 'bg-amber-50 text-amber-800 ring-amber-200',
  later: 'bg-canvas text-ink-soft ring-line',
  done: 'bg-brand-50 text-brand-700 ring-brand-200',
  none: 'bg-canvas text-muted ring-line',
}

/** Компактный дедлайн для карточки: «завтра до 18:00 · осталось 1 д 3 ч» */
export function DeadlineChip({ task, compact = false }: { task: Pick<Task, 'due_at' | 'due_date' | 'status'>; compact?: boolean }) {
  const { state, when, left } = useDeadlineText(task)
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset', DEADLINE_STYLE[state])}
      data-deadline={state}
    >
      <Timer className={cn('h-3 w-3', state === 'overdue' && 'animate-wiggle')} />
      {when}
      {!compact && left && <span className="opacity-80">· {left}</span>}
    </span>
  )
}

/** Крупный дедлайн для карточки задачи */
export function DeadlineBlock({ task }: { task: Pick<Task, 'due_at' | 'due_date' | 'status'> }) {
  const { t } = useI18n()
  const { state, when, left } = useDeadlineText(task)
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl px-4 py-3 ring-1 ring-inset', DEADLINE_STYLE[state])}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/70">
        <Timer className={cn('h-5 w-5', state === 'overdue' && 'animate-wiggle')} />
      </span>
      <div className="min-w-0">
        <div className="text-xs font-semibold tracking-wide uppercase opacity-80">{t('t2.deadline')}</div>
        <div className="font-semibold">{when}</div>
        {left && <div className="text-sm opacity-90">{left}</div>}
      </div>
    </div>
  )
}

/* ---------- Тип задачи ---------- */

export const KIND_ICON: Record<TaskKind, typeof ClipboardList> = {
  simple: ClipboardList,
  course: GraduationCap,
  report: FileText,
  checklist: ListChecks,
}

export function KindChip({ kind }: { kind: TaskKind }) {
  const { t } = useI18n()
  const Icon = KIND_ICON[kind]
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11.5px] font-medium text-brand-700">
      <Icon className="h-3 w-3" /> {t(`t2.kind.${kind}` as I18nKey)}
    </span>
  )
}

export function checklistProgress(task: Pick<Task, 'checklist'>) {
  const total = task.checklist?.length ?? 0
  const done = (task.checklist ?? []).filter((s) => s.done).length
  return { total, done, pct: total ? Math.round((100 * done) / total) : 0 }
}

/** Анимированная галочка для чек-листа */
export function CheckBox({ checked, onChange, disabled }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded-lg border-2 transition-all duration-200 active:scale-90 disabled:cursor-default',
        checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white hover:border-brand-400',
      )}
    >
      {checked && (
        <svg viewBox="0 0 24 24" className="check-draw h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.2 4.2L19 7" />
        </svg>
      )}
    </button>
  )
}

/** Вспышка частиц: ставится внутрь relative-контейнера, живёт 0,7 с */
export function Burst({ trigger }: { trigger: number }) {
  if (!trigger) return null
  return (
    <span key={trigger} className="burst" aria-hidden>
      {Array.from({ length: 14 }, (_, i) => (
        <i key={i} style={{ ['--a' as string]: `${(360 / 14) * i}deg`, ['--d' as string]: `${36 + (i % 3) * 12}px` }} />
      ))}
    </span>
  )
}
