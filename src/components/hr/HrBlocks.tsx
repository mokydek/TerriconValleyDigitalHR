import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlarmClock, BellRing, CheckCheck, Eye, GraduationCap, Palmtree, Send, Star, UserPlus } from '@/components/icons'
import { toast } from 'sonner'
import { useAttentionAction, useAttentionBulk, useAttentionZone, useDepartments, useEmployeesLite, usePeople, useSendReminder, useToggleFollow } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fullName } from '@/lib/format'
import { CheckBox } from '@/components/tasks/TaskParts'
import { days, timeAgo } from '@/lib/format'
import { useI18n, type I18nKey } from '@/lib/i18n'
import { serverText } from '@/lib/serverText'
import type { AttentionItem, PersonRow } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Avatar, Badge, Button, Card, CardHeader, Empty, Field, Modal, Skeleton } from '@/components/ui'

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

const KIND_ORDER: AttentionItem['kind'][] = ['course', 'request', 'onboarding', 'vacation']

export function AttentionZone({ limit }: { limit?: number }) {
  const { t } = useI18n()
  const { data, isLoading } = useAttentionZone()
  const action = useAttentionAction()
  const bulk = useAttentionBulk()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [kind, setKind] = useState<AttentionItem['kind'] | 'all'>('all')
  const [custom, setCustom] = useState(false)
  const all = data ?? []
  const filtered = kind === 'all' ? all : all.filter((i) => i.kind === kind)
  const items = limit ? filtered.slice(0, limit) : filtered
  const counts = all.reduce<Record<string, number>>((acc, i) => ((acc[i.kind] = (acc[i.kind] ?? 0) + 1), acc), {})
  const keyOf = (it: AttentionItem) => `${it.action}-${it.employee_id}-${it.ref_id}`
  const chosen = all.filter((i) => selected.has(keyOf(i)))
  const allVisibleChosen = items.length > 0 && items.every((i) => selected.has(keyOf(i)))

  const runBulk = async (list: AttentionItem[]) => {
    if (!list.length) return
    try {
      const n = await bulk.mutateAsync(list.map((i) => ({ action: i.action, employee_id: i.employee_id, ref_id: i.ref_id })))
      toast.success(t('h2.bulkDone', { n }))
      setSelected(new Set())
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Card className="relative">
      <CardHeader
        icon={<BellRing className="h-[18px] w-[18px]" />}
        title={t('hr.attention')}
        subtitle={t('h2.attentionSub')}
        action={
          <Button size="sm" variant="outline" icon={<Send className="h-4 w-4" />} onClick={() => setCustom(true)} data-testid="custom-reminder">
            {t('h2.custom')}
          </Button>
        }
      />
      {all.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
          <button
            onClick={() => setKind('all')}
            className={cn('rounded-full px-3 py-1 text-xs font-semibold ring-1 transition active:scale-95', kind === 'all' ? 'bg-ink text-white ring-ink' : 'bg-white text-ink-soft ring-line')}
          >
            {t('common.all')} · {all.length}
          </button>
          {KIND_ORDER.filter((k) => counts[k]).map((k) => (
            <span key={k} className={cn('inline-flex items-center overflow-hidden rounded-full text-xs font-semibold ring-1', kind === k ? 'ring-brand-500' : 'ring-line')}>
              <button onClick={() => setKind(k)} className={cn('inline-flex items-center gap-1.5 px-3 py-1 transition', kind === k ? 'bg-brand-50 text-brand-800' : 'bg-white text-ink-soft hover:bg-canvas')}>
                {KIND_ICON[k]} {t(`h2.kind.${k}` as I18nKey)} · {counts[k]}
              </button>
              {/* одной кнопкой: напомнить всем из группы */}
              <button
                onClick={() => void runBulk(all.filter((i) => i.kind === k))}
                disabled={bulk.isPending}
                className="border-l border-line bg-white px-2.5 py-1 text-brand-700 transition hover:bg-brand-50 active:scale-95 disabled:opacity-50"
                title={t('h2.groupAll', { label: t(ACTION_LABEL[all.find((i) => i.kind === k)!.action]) })}
                data-testid={`bulk-${k}`}
              >
                {t(k === 'onboarding' ? 'h2.assignAll' : k === 'request' ? 'h2.nudgeAll' : 'h2.remindAll')}
              </button>
            </span>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <label className="flex cursor-pointer items-center gap-3 border-t border-line bg-canvas/50 px-5 py-2 text-xs font-medium text-muted">
          <CheckBox
            checked={allVisibleChosen}
            onChange={(v) => {
              const next = new Set(selected)
              for (const i of items) v ? next.add(keyOf(i)) : next.delete(keyOf(i))
              setSelected(next)
            }}
          />
          {t('h2.selectAll', { n: items.length })}
        </label>
      )}

      <ul className="stagger divide-y divide-line border-t border-line">
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
        {items.map((it, idx) => {
          const key = keyOf(it)
          const reminded = it.last_reminded_at && Date.now() - new Date(it.last_reminded_at).getTime() < 24 * 3600_000
          const isSel = selected.has(key)
          return (
            <li key={key} style={{ ['--i' as string]: idx }} className={cn('flex flex-col gap-3 px-5 py-3.5 transition sm:flex-row sm:items-center', isSel && 'bg-brand-50/50')} data-testid="attention-item">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <CheckBox
                  checked={isSel}
                  onChange={(v) => {
                    const next = new Set(selected)
                    if (v) next.add(key)
                    else next.delete(key)
                    setSelected(next)
                  }}
                />
                <div
                  className={cn(
                    'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                    it.severity === 'high' ? 'bg-rose-50 text-rose-600' : it.severity === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-brand-50 text-brand-700',
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
              <div className="flex shrink-0 items-center gap-2 pl-9 sm:justify-end sm:pl-0">
                {reminded && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted">
                    <CheckCheck className="h-3.5 w-3.5 text-brand-600" /> {timeAgo(it.last_reminded_at)}
                  </span>
                )}
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
      {limit && filtered.length > limit && (
        <div className="border-t border-line px-5 py-3 text-center text-sm text-muted">{t('hr.attentionMore', { n: limit, total: filtered.length })}</div>
      )}

      {/* Панель массового действия: появляется, когда что-то выбрано */}
      {chosen.length > 0 && (
        <div className="sticky bottom-20 z-10 mx-3 mb-3 flex animate-rise flex-wrap items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-white shadow-[var(--shadow-pop)] lg:bottom-4" data-testid="bulk-bar">
          <span className="text-sm font-semibold">{t('h2.selected', { n: chosen.length })}</span>
          <span className="text-xs text-white/70">{t('h2.selectedHint')}</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setSelected(new Set())}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" loading={bulk.isPending} icon={<Send className="h-4 w-4" />} onClick={() => void runBulk(chosen)} data-testid="bulk-run">
              {t('h2.runSelected', { n: chosen.length })}
            </Button>
          </div>
        </div>
      )}
      <CustomReminderModal open={custom} onClose={() => setCustom(false)} />
    </Card>
  )
}

/* ---------- Своё напоминание группе ---------- */

const TEMPLATES = [
  { key: 'course', link: '/academy' },
  { key: 'vacation', link: '/requests?new=vacation' },
  { key: 'reports', link: '/tasks' },
  { key: 'profile', link: '/profile' },
] as const

export function CustomReminderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const { me, role } = useAuth()
  const people = useEmployeesLite()
  const departments = useDepartments()
  const send = useSendReminder()
  const [dept, setDept] = useState<string>('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [link, setLink] = useState('/')
  const [q, setQ] = useState('')

  const scope = (people.data ?? []).filter((p) => p.id !== me?.id && (role === 'hr' || p.manager_id === me?.id))
  const inDept = scope.filter((p) => dept === 'all' || p.department_id === dept)
  const shown = inDept.filter((p) => !q || fullName(p, true).toLowerCase().includes(q.toLowerCase()))

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('h2.custom')}
      subtitle={t('h2.customSub')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            icon={<Send className="h-4 w-4" />}
            loading={send.isPending}
            disabled={!title.trim() || picked.size === 0}
            onClick={async () => {
              try {
                const n = await send.mutateAsync({ employees: [...picked], title, body, link })
                toast.success(t('h2.customSent', { n }))
                setPicked(new Set())
                setTitle('')
                setBody('')
                onClose()
              } catch (e) {
                toast.error((e as Error).message)
              }
            }}
            data-testid="custom-send"
          >
            {t('h2.sendTo', { n: picked.size })}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="label">{t('h2.template')}</span>
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((tp) => (
              <button
                key={tp.key}
                type="button"
                onClick={() => {
                  setTitle(t(`h2.tpl.${tp.key}.title` as I18nKey))
                  setBody(t(`h2.tpl.${tp.key}.body` as I18nKey))
                  setLink(tp.link)
                }}
                className="rounded-full bg-canvas px-3 py-1.5 text-sm font-medium text-ink-soft ring-1 ring-line transition hover:bg-brand-50 hover:text-brand-700 active:scale-95"
              >
                {t(`h2.tpl.${tp.key}.title` as I18nKey)}
              </button>
            ))}
          </div>
        </div>
        <Field label={t('h2.rTitle')}>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="custom-title" />
        </Field>
        <Field label={t('h2.rBody')}>
          <textarea className="field min-h-[72px]" value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="label mb-0">{t('h2.recipients', { n: picked.size })}</span>
            <div className="flex items-center gap-2">
              {role === 'hr' && (
                <select className="field h-9 w-auto py-1 text-sm" value={dept} onChange={(e) => setDept(e.target.value)}>
                  <option value="all">{t('ann.wholeCompany')}</option>
                  {(departments.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              )}
              <Button size="sm" variant="soft" onClick={() => setPicked(new Set(inDept.map((p) => p.id)))} data-testid="custom-all">
                {t('h2.pickAll', { n: inDept.length })}
              </Button>
            </div>
          </div>
          <input className="field mb-2" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="scrollbar-thin max-h-52 overflow-y-auto rounded-xl border border-line">
            {shown.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-3 border-b border-line/70 px-3 py-2 last:border-0 hover:bg-canvas">
                <CheckBox
                  checked={picked.has(p.id)}
                  onChange={(v) => {
                    const next = new Set(picked)
                    if (v) next.add(p.id)
                    else next.delete(p.id)
                    setPicked(next)
                  }}
                />
                <Avatar id={p.id} name={fullName(p)} size={26} />
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
