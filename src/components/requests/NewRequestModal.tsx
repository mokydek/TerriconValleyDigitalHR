import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, differenceInCalendarDays, eachDayOfInterval, parseISO } from 'date-fns'
import { CalendarDays, Info } from '@/components/icons'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { LANGS, useI18n, type I18nKey } from '@/lib/i18n'
import { must, supabase } from '@/lib/supabase'
import { serverText } from '@/lib/serverText'
import { useCreateRequest, useVacationBalance } from '@/lib/api'
import { CERT_PURPOSES, DATA_FIELDS, REQUEST_TYPE_META, REQUEST_TYPES } from '@/lib/constants'
import { days, entitledText, fmtDate, isoDate, money, num } from '@/lib/format'
import type { HrRequest, RequestType } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button, Field, Modal } from '@/components/ui'
import { TypeIcon } from '@/components/requests/RequestParts'
import { TeamOverlap } from '@/components/requests/TeamOverlap'

/** Языки, на которых выдаётся справка (в заявку записывается код языка) */
const CERT_LANGS: readonly string[] = ['ru', 'kk', 'en']

function useHolidays() {
  return useQuery({
    queryKey: ['holidays'],
    staleTime: Infinity,
    queryFn: async () => {
      const rows = (await must(supabase.from('holidays').select('day,name'))) as { day: string; name: string }[]
      return new Map(rows.map((r) => [r.day, r.name]))
    },
  })
}

function useMySalary() {
  const { me } = useAuth()
  return useQuery({
    queryKey: ['my-salary', me?.id],
    enabled: Boolean(me),
    queryFn: async () => {
      const row = (await must(supabase.from('employee_private').select('salary').eq('employee_id', me!.id).maybeSingle())) as { salary: number | null } | null
      return row?.salary ?? null
    },
  })
}

export function NewRequestModal({
  open,
  onClose,
  initialType,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  initialType?: RequestType | null
  onCreated?: (r: HrRequest) => void
}) {
  const { t, lang } = useI18n()
  const { me } = useAuth()
  const create = useCreateRequest()
  const holidays = useHolidays()
  const balance = useVacationBalance()
  const salary = useMySalary()

  const [type, setType] = useState<RequestType | null>(initialType ?? null)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [amount, setAmount] = useState('')
  const [comment, setComment] = useState('')
  const [purpose, setPurpose] = useState(CERT_PURPOSES[0].value)
  const [language, setLanguage] = useState('ru')
  const [copies, setCopies] = useState(1)
  const [field, setField] = useState(DATA_FIELDS[0].value)
  const [newValue, setNewValue] = useState('')

  useEffect(() => {
    if (open) {
      setType(initialType ?? null)
      const s = addDays(new Date(), 21)
      setStart(isoDate(s))
      setEnd(isoDate(addDays(s, 13)))
      setAmount('')
      setComment('')
      setNewValue('')
    }
  }, [open, initialType])

  // Предпросмотр: календарные дни без праздников РК (окончательный расчёт делает сервер)
  const vacation = useMemo(() => {
    if (!start || !end) return null
    const s = parseISO(start)
    const e = parseISO(end)
    if (e < s) return { error: t('req.err.endBeforeStart') }
    const all = eachDayOfInterval({ start: s, end: e })
    const hol = all.filter((d) => holidays.data?.has(isoDate(d)))
    const count = all.length - hol.length
    const notice = differenceInCalendarDays(s, new Date())
    return { count, holidays: hol.map((d) => `${fmtDate(d, 'd MMM')}: ${serverText(holidays.data?.get(isoDate(d)))}`), notice }
  }, [start, end, holidays.data, t, lang])

  const maxAdvance = salary.data ? Math.round(salary.data * 0.5) : null

  const errors: string[] = []
  if (type === 'vacation' && vacation) {
    if ('error' in vacation && vacation.error) errors.push(vacation.error)
    if (start && parseISO(start) < parseISO(isoDate(new Date()))) errors.push(t('req.err.pastStart'))
    if ('count' in vacation && balance.data && (vacation.count ?? 0) > balance.data.available) {
      errors.push(t('req.err.notEnoughDays', { days: days(balance.data.available) }))
    }
  }
  if (type === 'advance') {
    const a = Number(amount)
    if (amount && (!Number.isFinite(a) || a <= 0)) errors.push(t('req.err.badAmount'))
    if (maxAdvance && a > maxAdvance) errors.push(t('req.err.advanceMax', { max: money(maxAdvance) }))
  }
  if (type === 'data_change' && !newValue.trim()) errors.push('')

  const canSubmit =
    type !== null &&
    errors.filter(Boolean).length === 0 &&
    (type !== 'advance' || Number(amount) > 0) &&
    (type !== 'vacation' || Boolean(start && end)) &&
    (type !== 'data_change' || newValue.trim().length > 0)

  const submit = async () => {
    if (!type) return
    try {
      const payload =
        type === 'vacation'
          ? { type, start_date: start, end_date: end, comment: comment || null }
          : type === 'advance'
            ? { type, amount: Number(amount), comment: comment || null }
            : type === 'certificate'
              ? { type, comment: comment || null, details: { purpose, language, copies } }
              : { type, comment: comment || null, details: { field, new_value: newValue.trim() } }
      const created = await create.mutateAsync(payload)
      const who = created.approver ? `${created.approver.first_name} ${created.approver.last_name}` : 'HR'
      toast.success(t('req.sent', { n: created.number }), { description: t('req.sentHint', { who }) })
      onCreated?.(created)
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={type ? t(`type.${type}` as I18nKey) : t('req.new')}
      subtitle={type ? REQUEST_TYPE_META[type].hint : t('req.chooseType')}
      footer={
        type && (
          <>
            {!initialType && (
              <Button variant="ghost" onClick={() => setType(null)}>
                {t('req.otherType')}
              </Button>
            )}
            <Button onClick={() => void submit()} loading={create.isPending} disabled={!canSubmit} data-testid="request-submit">
              {t('req.submit')}
            </Button>
          </>
        )
      }
    >
      {!type && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {REQUEST_TYPES.map((rt) => (
            <button
              key={rt}
              onClick={() => setType(rt)}
              className="flex items-start gap-3 rounded-2xl border border-line bg-white p-4 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
              data-testid={`type-${rt}`}
            >
              <TypeIcon type={rt} size="lg" />
              <span>
                <span className="block font-semibold">{t(`type.${rt}` as I18nKey)}</span>
                <span className="mt-0.5 block text-sm text-muted">{REQUEST_TYPE_META[rt].hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {type === 'vacation' && (
        <div className="space-y-4">
          {balance.data && (
            <div className="flex items-center justify-between rounded-2xl bg-brand-50 px-4 py-3">
              <div>
                <div className="text-sm text-brand-800">{t('req.availableFor', { year: balance.data.year })}</div>
                <div className="text-2xl font-bold text-brand-800">{days(balance.data.available)}</div>
              </div>
              <div className="text-right text-xs text-brand-800/80">
                {t('req.entitled', { days: entitledText(balance.data) })}
                <br />
                {t('req.usedReserved', { used: days(balance.data.used), reserved: days(balance.data.reserved) })}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('req.from')}>
              <input type="date" className="field" value={start} min={isoDate(new Date())} onChange={(e) => setStart(e.target.value)} data-testid="vac-start" />
            </Field>
            <Field label={t('req.to')}>
              <input type="date" className="field" value={end} min={start} onChange={(e) => setEnd(e.target.value)} data-testid="vac-end" />
            </Field>
          </div>
          {vacation && 'count' in vacation && (
            <div className="rounded-xl border border-line px-4 py-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-ink">
                <CalendarDays className="h-4 w-4 text-brand-600" /> {t('req.willDeduct', { days: days(vacation.count) })}
              </div>
              {vacation.holidays && vacation.holidays.length > 0 && (
                <div className="mt-1 text-muted">{t('req.holidaysExcluded', { list: vacation.holidays.join(', ') })}</div>
              )}
              {vacation.notice !== undefined && vacation.notice < 14 && vacation.notice >= 0 && (
                <div className="mt-1 text-amber-700">{t('req.noticeHint')}</div>
              )}
            </div>
          )}
          {vacation && 'count' in vacation && <TeamOverlap start={start} end={end} />}
          <Field label={t('req.comment')} hint={t('req.optional')}>
            <textarea className="field min-h-[72px]" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('req.vacCommentPh')} />
          </Field>
          <p className="flex items-start gap-2 text-xs text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t('req.vacRoute', { first: me?.manager ? t('req.routeManager', { name: `${me.manager.first_name} ${me.manager.last_name}` }) : 'HR' })}
          </p>
        </div>
      )}

      {type === 'advance' && (
        <div className="space-y-4">
          <Field label={`${t('req.amount')}, ₸`} hint={maxAdvance ? t('req.advanceHintMax', { max: money(maxAdvance) }) : t('req.advanceHint')}>
            <input type="number" inputMode="numeric" min={1} step={1000} className="field text-lg font-semibold" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={num(100_000)} data-testid="advance-amount" />
          </Field>
          {maxAdvance && (
            <div className="flex flex-wrap gap-2">
              {[0.2, 0.3, 0.5].map((k) => (
                <button key={k} type="button" onClick={() => setAmount(String(Math.round((salary.data ?? 0) * k)))} className="rounded-full border border-line px-3 py-1 text-sm hover:border-brand-300 hover:bg-brand-50">
                  {Math.round(k * 100)}% · {money(Math.round((salary.data ?? 0) * k))}
                </button>
              ))}
            </div>
          )}
          <Field label={t('req.comment')} hint={t('req.optional')}>
            <textarea className="field min-h-[72px]" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('req.advCommentPh')} />
          </Field>
          <p className="flex items-start gap-2 text-xs text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t('req.advanceInfo')}
          </p>
        </div>
      )}

      {type === 'certificate' && (
        <div className="space-y-4">
          <Field label={t('req.certPurpose')}>
            <select className="field" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              {CERT_PURPOSES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('req.language')}>
              <select className="field" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGS.filter((l) => CERT_LANGS.includes(l.code)).map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('req.copies')}>
              <select className="field" value={copies} onChange={(e) => setCopies(Number(e.target.value))}>
                {[1, 2, 3].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t('req.comment')} hint={t('req.optional')}>
            <textarea className="field min-h-[60px]" value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </div>
      )}

      {type === 'data_change' && (
        <div className="space-y-4">
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{t('req.dataInfo')}</div>
          <Field label={t('req.whatChange')}>
            <select className="field" value={field} onChange={(e) => setField(e.target.value)}>
              {DATA_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('req.newValue')}>
            <input className="field" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
          </Field>
          <Field label={t('req.comment')} hint={t('req.dataCommentHint')}>
            <textarea className="field min-h-[60px]" value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </div>
      )}

      {errors.filter(Boolean).length > 0 && (
        <div className={cn('mt-4 rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-700')}>{errors.filter(Boolean).join(' · ')}</div>
      )}
    </Modal>
  )
}
