import { AlertTriangle, Newspaper, PartyPopper, Truck, Users } from '@/components/icons'
import { t } from './i18n'
import type { RequestStatus, RequestType, Task } from './types'

// Подписи вычисляются при обращении (get label), поэтому всегда на текущем языке интерфейса

export const REQUEST_TYPES: RequestType[] = ['vacation', 'advance', 'certificate', 'data_change']

export const REQUEST_TYPE_META: Record<RequestType, { color: string; readonly hint: string }> = {
  vacation: {
    color: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    get hint() {
      return t('typeHint.vacation')
    },
  },
  advance: {
    color: 'bg-sky-50 text-sky-700 ring-sky-200',
    get hint() {
      return t('typeHint.advance')
    },
  },
  certificate: {
    color: 'bg-violet-50 text-violet-700 ring-violet-200',
    get hint() {
      return t('typeHint.certificate')
    },
  },
  data_change: {
    color: 'bg-amber-50 text-amber-800 ring-amber-200',
    get hint() {
      return t('typeHint.data_change')
    },
  },
}

export const STATUS_STYLE: Record<RequestStatus, string> = {
  pending: 'bg-amber-50 text-amber-800 ring-amber-200',
  approved: 'bg-sky-50 text-sky-700 ring-sky-200',
  processing: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  done: 'bg-brand-50 text-brand-700 ring-brand-200',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-200',
  cancelled: 'bg-slate-100 text-slate-600 ring-slate-200',
}

const PRIORITY_STYLE: Record<Task['priority'], string> = {
  low: 'bg-slate-100 text-slate-600 ring-slate-200',
  medium: 'bg-sky-50 text-sky-700 ring-sky-200',
  high: 'bg-amber-50 text-amber-800 ring-amber-200',
  urgent: 'bg-rose-50 text-rose-700 ring-rose-200',
}

export const PRIORITY_META = Object.fromEntries(
  (Object.keys(PRIORITY_STYLE) as Task['priority'][]).map((p) => [
    p,
    {
      style: PRIORITY_STYLE[p],
      get label() {
        return t(`prio.${p}`)
      },
    },
  ]),
) as Record<Task['priority'], { readonly label: string; style: string }>

/** Объект «код → подпись», подписи переводятся при чтении */
function labels<K extends string>(codes: readonly K[], key: (code: K) => Parameters<typeof t>[0]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const code of codes) Object.defineProperty(out, code, { enumerable: true, get: () => t(key(code)) })
  return out
}

export const TASK_CATEGORIES = labels(
  ['general', 'logistics', 'warehouse', 'delivery', 'client', 'hr', 'it', 'training'] as const,
  (c) => `taskCat.${c}`,
)

const ANNOUNCEMENT_STYLE = {
  news: { style: 'bg-brand-50 text-brand-700 ring-brand-200', icon: Newspaper },
  logistics: { style: 'bg-brand-50 text-brand-700 ring-brand-200', icon: Truck },
  hr: { style: 'bg-brand-50 text-brand-700 ring-brand-200', icon: Users },
  event: { style: 'bg-amber-50 text-amber-800 ring-amber-200', icon: PartyPopper },
  urgent: { style: 'bg-rose-50 text-rose-700 ring-rose-200', icon: AlertTriangle },
} as const

export const ANNOUNCEMENT_CATEGORIES = Object.fromEntries(
  (Object.keys(ANNOUNCEMENT_STYLE) as (keyof typeof ANNOUNCEMENT_STYLE)[]).map((c) => [
    c,
    {
      ...ANNOUNCEMENT_STYLE[c],
      get label() {
        return t(`annCat.${c}`)
      },
    },
  ]),
) as Record<string, { readonly label: string; style: string; icon: typeof Newspaper }>

export const COURSE_CATEGORIES = labels(['onboarding', 'safety', 'compliance', 'skills', 'general'] as const, (c) => `courseCat.${c}`)

/**
 * Цели справки и поля для изменения данных: в заявку записывается русское значение
 * (его читают HR и 1С), а на экране показывается перевод.
 */
export const CERT_PURPOSES: { value: string; readonly label: string }[] = (
  [
    ['По месту требования', 'cert.any'], // i18n-ignore
    ['В банк', 'cert.bank'], // i18n-ignore
    ['Для посольства (виза)', 'cert.embassy'], // i18n-ignore
    ['В детский сад / школу', 'cert.school'], // i18n-ignore
    ['В госорган', 'cert.gov'], // i18n-ignore
  ] as const
).map(([value, key]) => ({
  value,
  get label() {
    return t(key)
  },
}))

export const DATA_FIELDS: { value: string; readonly label: string }[] = (
  [
    ['Фамилия', 'field.lastName'], // i18n-ignore
    ['Адрес проживания', 'field.address'], // i18n-ignore
    ['Личный телефон', 'field.phone'], // i18n-ignore
    ['Банковские реквизиты', 'field.bank'], // i18n-ignore
    ['Контакт для экстренной связи', 'field.emergency'], // i18n-ignore
    ['Другое', 'field.other'], // i18n-ignore
  ] as const
).map(([value, key]) => ({
  value,
  get label() {
    return t(key)
  },
}))

/** Подпись для значения из заявки; незнакомое значение (введено вручную) показываем как есть */
export const certPurposeLabel = (value: string | null | undefined) => CERT_PURPOSES.find((p) => p.value === value)?.label ?? value ?? ''
export const dataFieldLabel = (value: string | null | undefined) => DATA_FIELDS.find((f) => f.value === value)?.label ?? value ?? ''

export const CHART_COLORS = {
  brand: '#168f12',
  brandSoft: '#7dcc79',
  sky: '#0284c7',
  violet: '#7c3aed',
  amber: '#d97706',
  rose: '#e11d48',
  slate: '#94a3b8',
  ink: '#17221a',
}
