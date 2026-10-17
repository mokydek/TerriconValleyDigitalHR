import { Link } from 'react-router-dom'
import { Ban, Check, Clock3, FileText, Loader2, X } from 'lucide-react'
import { useI18n, type I18nKey } from '@/lib/i18n'
import { REQUEST_TYPE_META, STATUS_STYLE } from '@/lib/constants'
import { days, duration, fmtDateTime, fmtRange, fullName, money } from '@/lib/format'
import type { HrRequest, RequestEvent, RequestStatus, RequestType } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui'

export function StatusBadge({ status }: { status: RequestStatus }) {
  const { t } = useI18n()
  return (
    <Badge className={STATUS_STYLE[status]} dot>
      {t(`status.${status}` as I18nKey)}
    </Badge>
  )
}

export function TypeLabel({ type, withHint = false }: { type: RequestType; withHint?: boolean }) {
  const { t } = useI18n()
  const meta = REQUEST_TYPE_META[type]
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-lg leading-none">{meta.emoji}</span>
      <span>
        <span className="font-medium text-ink">{t(`type.${type}` as I18nKey)}</span>
        {withHint && <span className="block text-xs text-muted">{meta.hint}</span>}
      </span>
    </span>
  )
}

/** Краткое описание сути заявки */
export function requestSummary(r: HrRequest): string {
  if (r.type === 'vacation') return `${fmtRange(r.start_date, r.end_date)} · ${days(r.days)}`
  if (r.type === 'advance') return money(r.amount)
  if (r.type === 'certificate') return `${r.details.purpose ?? 'По месту требования'} · ${String(r.details.language ?? 'ru').toUpperCase()}`
  return `${r.details.field ?? 'Данные'} → ${r.details.new_value ?? ''}`
}

type StepState = 'done' | 'current' | 'todo' | 'skipped' | 'failed'

export interface Stage {
  key: 'manager' | 'hr' | '1c' | 'done'
  labelKey: I18nKey
  state: StepState
  hint?: string
}

/** Этапы трека заявки: Руководитель → HR → 1С:ЗУП → Готово */
export function requestStages(r: HrRequest, events: RequestEvent[] = []): Stage[] {
  const has = (a: RequestEvent['action']) => events.some((e) => e.action === a)
  // Этап руководителя есть у отпуска и аванса, если у сотрудника есть руководитель в 1С:ЗУП
  const needsManager = (r.type === 'vacation' || r.type === 'advance') && Boolean(r.employee?.manager_id)
  const stages: Stage[] = [
    { key: 'manager', labelKey: 'req.stepManager', state: needsManager ? 'todo' : 'skipped' },
    { key: 'hr', labelKey: 'req.stepHr', state: 'todo' },
    { key: '1c', labelKey: 'req.step1c', state: 'todo' },
    { key: 'done', labelKey: 'req.stepDone', state: 'todo' },
  ]
  const [m, h, c, d] = stages
  switch (r.status) {
    case 'pending':
      if (needsManager) m.state = 'current'
      else h.state = 'current'
      break
    case 'approved':
      if (needsManager) m.state = 'done'
      h.state = 'current'
      break
    case 'processing':
      if (needsManager) m.state = 'done'
      h.state = 'done'
      c.state = 'current'
      break
    case 'done':
      if (needsManager) m.state = 'done'
      h.state = 'done'
      c.state = 'done'
      d.state = 'done'
      break
    case 'rejected':
      if (needsManager && !has('approved')) m.state = 'failed'
      else {
        if (needsManager) m.state = 'done'
        h.state = 'failed'
      }
      break
    case 'cancelled': {
      const target = needsManager && !has('approved') ? m : h
      if (needsManager && has('approved')) m.state = 'done'
      target.state = 'failed'
      break
    }
  }
  return stages
}

export function RequestStepper({ request, events }: { request: HrRequest; events?: RequestEvent[] }) {
  const { t } = useI18n()
  const stages = requestStages(request, events)
  return (
    <ol className="flex items-start">
      {stages.map((s, i) => (
        <li key={s.key} className="flex flex-1 flex-col items-center text-center">
          <div className="flex w-full items-center">
            <div className={cn('h-0.5 flex-1', i === 0 ? 'bg-transparent' : stages[i - 1].state === 'done' || stages[i - 1].state === 'skipped' ? 'bg-brand-400' : 'bg-line')} />
            <div
              className={cn(
                'grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-xs font-bold',
                s.state === 'done' && 'border-brand-500 bg-brand-500 text-white',
                s.state === 'current' && 'border-brand-500 bg-white text-brand-600 ring-4 ring-brand-100',
                s.state === 'todo' && 'border-line bg-white text-muted',
                s.state === 'skipped' && 'border-dashed border-line bg-canvas text-muted',
                s.state === 'failed' && 'border-rose-500 bg-rose-500 text-white',
              )}
            >
              {s.state === 'done' ? (
                <Check className="h-4 w-4" />
              ) : s.state === 'failed' ? (
                <X className="h-4 w-4" />
              ) : s.state === 'current' ? (
                s.key === '1c' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />
              ) : s.state === 'skipped' ? (
                '–'
              ) : (
                i + 1
              )}
            </div>
            <div className={cn('h-0.5 flex-1', i === stages.length - 1 ? 'bg-transparent' : s.state === 'done' || s.state === 'skipped' ? 'bg-brand-400' : 'bg-line')} />
          </div>
          <span className={cn('mt-1.5 text-[11.5px] font-medium', s.state === 'current' ? 'text-brand-700' : s.state === 'failed' ? 'text-rose-600' : 'text-muted')}>
            {t(s.labelKey)}
            {s.state === 'skipped' && <span className="block text-[10px] font-normal">не требуется</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

const EVENT_LABEL: Record<RequestEvent['action'], string> = {
  created: 'Заявка создана',
  approved: 'Согласовано руководителем',
  rejected: 'Отклонено',
  processed: 'HR оформил и передал во внешнюю систему',
  completed: 'Оформлено, документы готовы',
  cancelled: 'Заявка отозвана',
  integration: 'Ответ внешней системы',
  nudged: 'HR напомнил согласующему',
  comment: 'Комментарий',
}

const EVENT_ICON: Record<RequestEvent['action'], string> = {
  created: 'bg-sky-500',
  approved: 'bg-brand-500',
  rejected: 'bg-rose-500',
  processed: 'bg-indigo-500',
  completed: 'bg-brand-600',
  cancelled: 'bg-slate-400',
  integration: 'bg-violet-500',
  nudged: 'bg-amber-500',
  comment: 'bg-slate-400',
}

export function RequestTimeline({ events }: { events: RequestEvent[] }) {
  return (
    <ol className="relative ml-1.5 space-y-4 border-l border-line pl-5">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className={cn('absolute top-1.5 -left-[26px] h-3 w-3 rounded-full ring-4 ring-white', EVENT_ICON[e.action])} />
          <div className="text-sm font-medium text-ink">{EVENT_LABEL[e.action]}</div>
          <div className="text-xs text-muted">
            {fmtDateTime(e.created_at)}
            {e.actor && ` · ${fullName(e.actor)}`}
            {!e.actor && e.action === 'integration' && ' · интеграция'}
          </div>
          {e.comment && <div className="mt-1 rounded-lg bg-canvas px-3 py-2 text-sm text-ink-soft">{e.comment}</div>}
        </li>
      ))}
    </ol>
  )
}

export function IntegrationDocs({ request }: { request: HrRequest }) {
  const docs = [
    request.integration?.zup && { system: '1С:ЗУП', ...request.integration.zup },
    request.integration?.documentolog && { system: 'Documentolog', ...request.integration.documentolog },
  ].filter(Boolean) as { system: string; id: string; document: string }[]
  if (!docs.length) return null
  return (
    <div className="space-y-2">
      {docs.map((d) => (
        <Link
          key={d.id}
          to={`/documents/${request.id}?system=${d.system === '1С:ЗУП' ? 'zup' : 'documentolog'}`}
          className="flex items-center gap-3 rounded-xl border border-line bg-white p-3 transition hover:border-brand-300 hover:bg-brand-50/40"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{d.document}</div>
            <div className="text-xs text-muted">
              {d.system} · {d.id} · <span className="text-brand-700">открыть</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}

export function WaitingTimer({ since, warnHours = 24, alertHours = 48 }: { since: string; warnHours?: number; alertHours?: number }) {
  const hours = (Date.now() - new Date(since).getTime()) / 3600_000
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold tabular-nums',
        hours >= alertHours ? 'bg-rose-50 text-rose-700' : hours >= warnHours ? 'bg-amber-50 text-amber-700' : 'bg-canvas text-muted',
      )}
      title="Сколько заявка находится на текущем этапе"
    >
      <Clock3 className="h-3 w-3" />
      {duration(since)}
    </span>
  )
}

export function CancelledMark() {
  return <Ban className="h-4 w-4 text-slate-400" />
}
