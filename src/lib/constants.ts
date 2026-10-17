import type { RequestStatus, RequestType, Task } from './types'

export const REQUEST_TYPES: RequestType[] = ['vacation', 'advance', 'certificate', 'data_change']

export const REQUEST_TYPE_META: Record<RequestType, { emoji: string; color: string; hint: string }> = {
  vacation: { emoji: '🌴', color: 'bg-emerald-50 text-emerald-700 ring-emerald-200', hint: 'Ежегодный оплачиваемый отпуск' },
  advance: { emoji: '💳', color: 'bg-sky-50 text-sky-700 ring-sky-200', hint: 'До 50% оклада, раз в месяц' },
  certificate: { emoji: '📄', color: 'bg-violet-50 text-violet-700 ring-violet-200', hint: 'Для банка, визы и т.д.' },
  data_change: { emoji: '✏️', color: 'bg-amber-50 text-amber-800 ring-amber-200', hint: 'Фамилия, адрес, телефон' },
}

export const STATUS_STYLE: Record<RequestStatus, string> = {
  pending: 'bg-amber-50 text-amber-800 ring-amber-200',
  approved: 'bg-sky-50 text-sky-700 ring-sky-200',
  processing: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  done: 'bg-brand-50 text-brand-700 ring-brand-200',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-200',
  cancelled: 'bg-slate-100 text-slate-600 ring-slate-200',
}

export const PRIORITY_META: Record<Task['priority'], { label: string; style: string }> = {
  low: { label: 'Не срочно', style: 'bg-slate-100 text-slate-600 ring-slate-200' },
  medium: { label: 'Обычная', style: 'bg-sky-50 text-sky-700 ring-sky-200' },
  high: { label: 'Важно', style: 'bg-amber-50 text-amber-800 ring-amber-200' },
  urgent: { label: 'Срочно', style: 'bg-rose-50 text-rose-700 ring-rose-200' },
}

export const TASK_CATEGORIES: Record<string, string> = {
  general: 'Общее',
  logistics: 'Логистика',
  warehouse: 'Склад',
  delivery: 'Доставка',
  client: 'Клиенты',
  hr: 'HR',
  it: 'IT',
  training: 'Обучение',
}

export const ANNOUNCEMENT_CATEGORIES: Record<string, { label: string; style: string; emoji: string }> = {
  news: { label: 'Новости', style: 'bg-sky-50 text-sky-700 ring-sky-200', emoji: '📰' },
  logistics: { label: 'Логистика', style: 'bg-brand-50 text-brand-700 ring-brand-200', emoji: '🚚' },
  hr: { label: 'HR', style: 'bg-violet-50 text-violet-700 ring-violet-200', emoji: '👥' },
  event: { label: 'События', style: 'bg-amber-50 text-amber-800 ring-amber-200', emoji: '🎉' },
  urgent: { label: 'Срочно', style: 'bg-rose-50 text-rose-700 ring-rose-200', emoji: '⚠️' },
}

export const COURSE_CATEGORIES: Record<string, string> = {
  onboarding: 'Адаптация',
  safety: 'Охрана труда',
  compliance: 'Комплаенс',
  skills: 'Навыки',
  general: 'Общее',
}

export const CERT_PURPOSES = ['По месту требования', 'В банк', 'Для посольства (виза)', 'В детский сад / школу', 'В госорган']

export const DATA_FIELDS = ['Фамилия', 'Адрес проживания', 'Личный телефон', 'Банковские реквизиты', 'Контакт для экстренной связи', 'Другое']

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
