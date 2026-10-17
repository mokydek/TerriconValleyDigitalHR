import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addDays, differenceInCalendarDays, eachDayOfInterval, parseISO } from 'date-fns'
import { CalendarDays, Info } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import { useI18n, type I18nKey } from '@/lib/i18n'
import { must, supabase } from '@/lib/supabase'
import { useCreateRequest, useVacationBalance } from '@/lib/api'
import { CERT_PURPOSES, DATA_FIELDS, REQUEST_TYPE_META, REQUEST_TYPES } from '@/lib/constants'
import { days, entitledText, fmtDate, isoDate, money } from '@/lib/format'
import type { HrRequest, RequestType } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button, Field, Modal } from '@/components/ui'

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
  const { t } = useI18n()
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
  const [purpose, setPurpose] = useState(CERT_PURPOSES[0])
  const [language, setLanguage] = useState('ru')
  const [copies, setCopies] = useState(1)
  const [field, setField] = useState(DATA_FIELDS[0])
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
    if (e < s) return { error: 'Дата окончания раньше даты начала' }
    const all = eachDayOfInterval({ start: s, end: e })
    const hol = all.filter((d) => holidays.data?.has(isoDate(d)))
    const count = all.length - hol.length
    const notice = differenceInCalendarDays(s, new Date())
    return { count, holidays: hol.map((d) => `${fmtDate(d, 'd MMM')}: ${holidays.data?.get(isoDate(d))}`), notice }
  }, [start, end, holidays.data])

  const maxAdvance = salary.data ? Math.round(salary.data * 0.5) : null

  const errors: string[] = []
  if (type === 'vacation' && vacation) {
    if ('error' in vacation && vacation.error) errors.push(vacation.error)
    if (start && parseISO(start) < parseISO(isoDate(new Date()))) errors.push('Нельзя оформить отпуск задним числом')
    if ('count' in vacation && balance.data && (vacation.count ?? 0) > balance.data.available) {
      errors.push(`Недостаточно дней: доступно ${days(balance.data.available)}`)
    }
  }
  if (type === 'advance') {
    const a = Number(amount)
    if (amount && (!Number.isFinite(a) || a <= 0)) errors.push('Укажите корректную сумму')
    if (maxAdvance && a > maxAdvance) errors.push(`Не более 50% оклада, максимум ${money(maxAdvance)}`)
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
      toast.success(`Заявка №${created.number} отправлена`, { description: `Сейчас у: ${who}. О решении придёт уведомление.` })
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
                ← Другой тип
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
        <div className="grid gap-3 sm:grid-cols-2">
          {REQUEST_TYPES.map((rt) => (
            <button
              key={rt}
              onClick={() => setType(rt)}
              className="flex items-start gap-3 rounded-2xl border border-line bg-white p-4 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
              data-testid={`type-${rt}`}
            >
              <span className="text-2xl">{REQUEST_TYPE_META[rt].emoji}</span>
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
                <div className="text-sm text-brand-800">Доступно на {balance.data.year} год</div>
                <div className="text-2xl font-bold text-brand-800">{days(balance.data.available)}</div>
              </div>
              <div className="text-right text-xs text-brand-800/80">
                положено {entitledText(balance.data)}
                <br />
                оформлено {days(balance.data.used)} · в работе {days(balance.data.reserved)}
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
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
                <CalendarDays className="h-4 w-4 text-brand-600" /> Будет списано: {days(vacation.count)}
              </div>
              {vacation.holidays && vacation.holidays.length > 0 && (
                <div className="mt-1 text-muted">Праздники не учитываются: {vacation.holidays.join(', ')}</div>
              )}
              {vacation.notice !== undefined && vacation.notice < 14 && vacation.notice >= 0 && (
                <div className="mt-1 text-amber-700">Лучше подавать заявку минимум за 14 дней, чтобы руководитель спланировал смены.</div>
              )}
            </div>
          )}
          <Field label={t('req.comment')} hint="Необязательно">
            <textarea className="field min-h-[72px]" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: семейная поездка" />
          </Field>
          <p className="flex items-start gap-2 text-xs text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Маршрут: {me?.manager ? `руководитель (${me.manager.first_name} ${me.manager.last_name})` : 'HR'} → HR → приказ в 1С:ЗУП → ознакомление в Documentolog.
          </p>
        </div>
      )}

      {type === 'advance' && (
        <div className="space-y-4">
          <Field label={`${t('req.amount')}, ₸`} hint={maxAdvance ? `Не более 50% оклада: до ${money(maxAdvance)}, один раз в месяц` : 'Не более 50% оклада, один раз в месяц'}>
            <input type="number" inputMode="numeric" min={1} step={1000} className="field text-lg font-semibold" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100 000" data-testid="advance-amount" />
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
          <Field label={t('req.comment')} hint="Необязательно">
            <textarea className="field min-h-[72px]" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: непредвиденные расходы" />
          </Field>
          <p className="flex items-start gap-2 text-xs text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> После оформления HR передаёт заявку в 1С:ЗУП (ведомость на выплату). Деньги поступят на карту в течение 3 рабочих дней.
          </p>
        </div>
      )}

      {type === 'certificate' && (
        <div className="space-y-4">
          <Field label="Для чего нужна справка">
            <select className="field" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              {CERT_PURPOSES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Язык">
              <select className="field" value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="ru">Русский</option>
                <option value="kk">Қазақша</option>
                <option value="en">English</option>
              </select>
            </Field>
            <Field label="Экземпляров">
              <select className="field" value={copies} onChange={(e) => setCopies(Number(e.target.value))}>
                {[1, 2, 3].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t('req.comment')} hint="Необязательно">
            <textarea className="field min-h-[60px]" value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </div>
      )}

      {type === 'data_change' && (
        <div className="space-y-4">
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Официальные кадровые данные ведутся в 1С:ЗУП и в JanaMen доступны только для чтения. HR внесёт изменение в 1С:ЗУП, и оно появится в профиле после синхронизации.
          </div>
          <Field label="Что изменить">
            <select className="field" value={field} onChange={(e) => setField(e.target.value)}>
              {DATA_FIELDS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </Field>
          <Field label="Новое значение">
            <input className="field" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
          </Field>
          <Field label={t('req.comment')} hint="Например, какой документ подтверждает изменение">
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
