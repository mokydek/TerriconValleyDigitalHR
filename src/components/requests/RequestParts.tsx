import { Link } from 'react-router-dom'
import { Ban, Check, Clock3, FileText, Palmtree, Pencil, Truck, Wallet, X } from '@/components/icons'
import { toast } from 'sonner'
import { t, useI18n, type I18nKey } from '@/lib/i18n'
import { CERT_PURPOSES, certPurposeLabel, dataFieldLabel, REQUEST_TYPE_META, STATUS_STYLE } from '@/lib/constants'
import { days, duration, fmtDateTime, fmtRange, fullName, money } from '@/lib/format'
import { serverText } from '@/lib/serverText'
import type { HrRequest, RequestEvent, RequestStatus, RequestType } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge, useMounted } from '@/components/ui'

export function StatusBadge({ status }: { status: RequestStatus }) {
  const { t } = useI18n()
  return (
    <Badge className={STATUS_STYLE[status]} dot>
      {t(`status.${status}` as I18nKey)}
    </Badge>
  )
}

const TYPE_ICON: Record<RequestType, typeof FileText> = { vacation: Palmtree, advance: Wallet, certificate: FileText, data_change: Pencil }

/** Значок типа заявки в фирменной зелёной плашке (вместо эмодзи) */
export function TypeIcon({ type, size = 'md' }: { type: RequestType; size?: 'md' | 'lg' }) {
  const Icon = TYPE_ICON[type]
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700', size === 'lg' ? 'h-11 w-11' : 'h-8 w-8')}>
      <Icon className={size === 'lg' ? 'h-5 w-5' : 'h-[18px] w-[18px]'} />
    </span>
  )
}

export function TypeLabel({ type, withHint = false }: { type: RequestType; withHint?: boolean }) {
  const { t } = useI18n()
  const meta = REQUEST_TYPE_META[type]
  return (
    <span className="inline-flex items-center gap-2">
      <TypeIcon type={type} />
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
  if (r.type === 'certificate') return `${certPurposeLabel(String(r.details.purpose ?? CERT_PURPOSES[0].value))} · ${String(r.details.language ?? 'ru').toUpperCase()}`
  return `${r.details.field == null ? t('req.summaryData') : dataFieldLabel(String(r.details.field))} → ${r.details.new_value ?? ''}`
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

/**
 * Трек заявки в стиле отслеживания посылки Jańa Post: трек-номер, дорога с этапами
 * и грузовичок, который «доезжает» до текущего этапа. Готово = доставлено.
 */
export function RequestStepper({ request, events }: { request: HrRequest; events?: RequestEvent[] }) {
  const { t } = useI18n()
  const mounted = useMounted()
  const stages = requestStages(request, events)
  const failed = stages.some((s) => s.state === 'failed')
  const finished = stages.every((s) => s.state === 'done' || s.state === 'skipped')
  const currentIdx = finished ? stages.length - 1 : Math.max(0, stages.findIndex((s) => s.state === 'current' || s.state === 'failed' || s.state === 'todo'))
  const pct = stages.length > 1 ? currentIdx / (stages.length - 1) : 1
  const current = stages[currentIdx]
  const moving = !finished && !failed
  const track = `JP-HR-${String(request.number).padStart(6, '0')}`
  return (
    <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-white p-4 ring-1 ring-brand-100" data-testid="parcel-track">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">{t('r2.trackNo')}</div>
          <button
            type="button"
            className="font-mono text-sm font-bold text-ink transition hover:text-brand-700 active:scale-95"
            title={t('r2.copy')}
            onClick={() => {
              void navigator.clipboard?.writeText(track)
              toast.success(t('r2.copied'))
            }}
          >
            {track}
          </button>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
            failed ? 'bg-rose-50 text-rose-700' : finished ? 'bg-brand-600 text-white' : 'bg-white text-brand-700 ring-1 ring-brand-200',
          )}
        >
          {failed ? <X className="h-3.5 w-3.5" /> : finished ? <Check className="h-3.5 w-3.5" /> : <Truck className="h-3.5 w-3.5" />}
          {failed ? t('r2.stopped') : finished ? t('r2.delivered') : t('r2.onTheWay', { stage: t(current.labelKey) })}
        </span>
      </div>

      {/* Дорога */}
      <div className="relative mx-4 mt-6 mb-1 h-9">
        <div className="absolute top-1/2 right-0 left-0 h-1 -translate-y-1/2 rounded-full bg-line" />
        <div
          className={cn('absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full transition-[width] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)]', failed ? 'bg-rose-400' : 'bg-brand-500')}
          style={{ width: `${(mounted ? pct : 0) * 100}%` }}
        />
        {moving && (
          <div
            className="absolute top-1/2 h-1 -translate-y-1/2 bg-[repeating-linear-gradient(90deg,var(--color-brand-300)_0_8px,transparent_8px_16px)] [animation:road_0.8s_linear_infinite]"
            style={{ left: `${pct * 100}%`, width: `${(1 - pct) * 100}%` }}
          />
        )}
        {stages.map((st, i) => (
          <span
            key={st.key}
            className={cn(
              'absolute top-1/2 grid h-4 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full ring-4 ring-white transition-colors duration-500',
              st.state === 'done' ? 'bg-brand-500' : st.state === 'failed' ? 'bg-rose-500' : st.state === 'skipped' ? 'bg-line' : 'bg-white ring-brand-100 outline-2 outline-line',
            )}
            style={{ left: `${(i / Math.max(1, stages.length - 1)) * 100}%` }}
          />
        ))}
        {/* Грузовичок */}
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-[85%] transition-[left] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ left: `${(mounted ? pct : 0) * 100}%` }}
        >
          <span className={cn('grid h-8 w-8 place-items-center rounded-xl text-white shadow-md', failed ? 'bg-rose-500' : 'bg-brand-600', moving && 'animate-[float_1.6s_ease-in-out_infinite]')}>
            {finished ? <Check className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
          </span>
        </div>
      </div>

      <ol className="mt-3 grid" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
        {stages.map((st) => (
          <li key={st.key} className="text-center">
            <span className={cn('block text-[11.5px] font-semibold', st.state === 'current' ? 'text-brand-700' : st.state === 'failed' ? 'text-rose-600' : st.state === 'done' ? 'text-ink' : 'text-muted')}>
              {t(st.labelKey)}
            </span>
            {st.state === 'skipped' && <span className="block text-[10px] text-muted">{t('req.stepSkipped')}</span>}
          </li>
        ))}
      </ol>
    </div>
  )
}

const EVENT_LABEL: Record<RequestEvent['action'], I18nKey> = {
  created: 'req.ev.created',
  approved: 'req.ev.approved',
  rejected: 'req.ev.rejected',
  processed: 'req.ev.processed',
  completed: 'req.ev.completed',
  cancelled: 'req.ev.cancelled',
  integration: 'req.ev.integration',
  nudged: 'req.ev.nudged',
  comment: 'req.comment',
}

// Комментарий к этим событиям пишет база (decide_request, complete_request_integration, nudge_approver);
// у остальных это текст, который ввёл человек, он показывается как есть
const SERVER_NOTES = new Set<RequestEvent['action']>(['processed', 'integration', 'nudged'])

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
  const { t } = useI18n()
  return (
    <ol className="relative ml-1.5 space-y-4 border-l border-line pl-5">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className={cn('absolute top-1.5 -left-[26px] h-3 w-3 rounded-full ring-4 ring-white', EVENT_ICON[e.action])} />
          <div className="text-sm font-medium text-ink">{t(EVENT_LABEL[e.action])}</div>
          <div className="text-xs text-muted">
            {fmtDateTime(e.created_at)}
            {e.actor && ` · ${fullName(e.actor)}`}
            {!e.actor && e.action === 'integration' && ` · ${t('req.integration')}`}
          </div>
          {e.comment && <div className="mt-1 rounded-lg bg-canvas px-3 py-2 text-sm text-ink-soft">{SERVER_NOTES.has(e.action) ? serverText(e.comment) : e.comment}</div>}
        </li>
      ))}
    </ol>
  )
}

export function IntegrationDocs({ request }: { request: HrRequest }) {
  const { t } = useI18n()
  const docs = [
    request.integration?.zup && { key: 'zup', system: t('req.zup'), ...request.integration.zup },
    request.integration?.documentolog && { key: 'documentolog', system: 'Documentolog', ...request.integration.documentolog },
  ].filter(Boolean) as { key: 'zup' | 'documentolog'; system: string; id: string; document: string }[]
  if (!docs.length) return null
  return (
    <div className="space-y-2">
      {docs.map((d) => (
        <Link
          key={d.id}
          to={`/documents/${request.id}?system=${d.key}`}
          className="flex items-center gap-3 rounded-xl border border-line bg-white p-3 transition hover:border-brand-300 hover:bg-brand-50/40"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{serverText(d.document)}</div>
            <div className="text-xs text-muted">
              {d.system} · {d.id} · <span className="text-brand-700">{t('req.open')}</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}

export function WaitingTimer({ since, warnHours = 24, alertHours = 48 }: { since: string; warnHours?: number; alertHours?: number }) {
  const { t } = useI18n()
  const hours = (Date.now() - new Date(since).getTime()) / 3600_000
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold tabular-nums',
        hours >= alertHours ? 'bg-rose-50 text-rose-700' : hours >= warnHours ? 'bg-amber-50 text-amber-700' : 'bg-canvas text-muted',
      )}
      title={t('req.waitingTitle')}
    >
      <Clock3 className="h-3 w-3" />
      {duration(since)}
    </span>
  )
}

export function CancelledMark() {
  return <Ban className="h-4 w-4 text-slate-400" />
}
