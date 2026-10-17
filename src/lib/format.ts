import { differenceInCalendarDays, differenceInMinutes, format, parseISO } from 'date-fns'
import { numberLocale, t, type I18nKey } from './i18n'

export function toDate(value: string | Date): Date {
  return typeof value === 'string' ? parseISO(value) : value
}

// Привычные шаблоны вызовов; для каждого языка в словаре свой порядок и написание
const PATTERNS: Record<string, I18nKey> = {
  'd MMM': 'date.p.dMMM',
  'd MMM yyyy': 'date.p.dMMMyyyy',
  'd MMMM': 'date.p.dMMMM',
  'd MMMM yyyy': 'date.p.dMMMMyyyy',
  'EEEE, d MMMM': 'date.p.EEEEdMMMM',
  'd MMM yyyy, HH:mm': 'date.p.dMMMyyyyHHmm',
  'd MMM, HH:mm': 'date.p.dMMMHHmm',
  'LLLL yyyy': 'date.p.LLLLyyyy',
  'dd.MM': 'date.p.ddMM',
  'dd.MM.yyyy': 'date.p.ddMMyyyy',
}

const names = (key: I18nKey) => t(key).split(',')
const pad = (n: number) => String(n).padStart(2, '0')

function render(d: Date, pattern: string): string {
  return pattern.replace(/'([^']*)'|yyyy|LLLL|LLL|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|mm/g, (token, literal?: string) => {
    if (literal !== undefined) return literal
    switch (token) {
      case 'yyyy':
        return String(d.getFullYear())
      case 'LLLL':
        return names('date.monthsNom')[d.getMonth()]
      case 'LLL':
        return names('date.monthsNomShort')[d.getMonth()]
      case 'MMMM':
        return names('date.months')[d.getMonth()]
      case 'MMM':
        return names('date.monthsShort')[d.getMonth()]
      case 'MM':
        return pad(d.getMonth() + 1)
      case 'M':
        return String(d.getMonth() + 1)
      case 'dd':
        return pad(d.getDate())
      case 'd':
        return String(d.getDate())
      case 'EEEE':
        return names('date.weekdays')[d.getDay()]
      case 'EEE':
        return names('date.weekdaysShort')[d.getDay()]
      case 'HH':
        return pad(d.getHours())
      default:
        return pad(d.getMinutes())
    }
  })
}

/** Дата по шаблону: d, dd, M, MM, MMM, MMMM, LLL, LLLL, yyyy, EEE, EEEE, HH, mm; 'текст' как есть */
export function fmtDate(value: string | Date | null | undefined, pattern = 'd MMM yyyy'): string {
  if (!value) return '–'
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return '–'
  const key = PATTERNS[pattern]
  return render(d, key ? t(key) : pattern)
}

/** «Пятница, 16 октября»: с заглавной буквы */
export function todayLabel(): string {
  const s = fmtDate(new Date(), 'EEEE, d MMMM')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function fmtDateShort(value: string | Date | null | undefined): string {
  return fmtDate(value, 'd MMM')
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  return fmtDate(value, 'd MMM yyyy, HH:mm')
}

/** Время 24 часа: «14:05» */
export function fmtTime(value: string | Date | null | undefined): string {
  return fmtDate(value, 'HH:mm')
}

export function fmtRange(start: string | null, end: string | null): string {
  if (!start) return '–'
  if (!end || start === end) return fmtDate(start)
  const s = toDate(start)
  const e = toDate(end)
  if (s.getFullYear() !== e.getFullYear()) return `${fmtDate(s)} – ${fmtDate(e)}`
  const head = render(s, t(s.getMonth() === e.getMonth() ? 'date.p.rangeStartSameMonth' : 'date.p.rangeStartSameYear'))
  return `${head} – ${render(e, t('date.p.rangeEnd'))}`
}

/** «5 минут назад», «через 2 дня» */
export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return '–'
  const diff = Date.now() - toDate(value).getTime()
  if (Number.isNaN(diff)) return '–'
  const sec = Math.abs(diff) / 1000
  if (sec < 45) return t('time.justNow')
  const [unit, n] =
    sec < 3600
      ? (['m', Math.max(1, Math.round(sec / 60))] as const)
      : sec < 86_400
        ? (['h', Math.round(sec / 3600)] as const)
        : sec < 86_400 * 30
          ? (['d', Math.round(sec / 86_400)] as const)
          : sec < 86_400 * 365
            ? (['mo', Math.round(sec / (86_400 * 30))] as const)
            : (['y', Math.round(sec / (86_400 * 365))] as const)
  return t(`time.${diff < 0 ? 'in' : 'ago'}.${unit}` as I18nKey, { n })
}

/** «2 д 5 ч», «3 ч 10 мин»: сколько висит заявка */
export function duration(from: string | Date, to: Date = new Date()): string {
  const minutes = Math.max(0, differenceInMinutes(to, toDate(from)))
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return t('time.dur.dh', { d, h })
  if (h > 0) return t('time.dur.hm', { h, m })
  return t('time.dur.m', { m })
}

export function hoursSince(from: string | Date): number {
  return differenceInMinutes(new Date(), toDate(from)) / 60
}

export function daysUntil(value: string | Date): number {
  return differenceInCalendarDays(toDate(value), new Date())
}

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return '–'
  return `${num(Math.round(value))} ₸`
}

export function num(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '–'
  return Number(value).toLocaleString(numberLocale(), { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

/** «24 дня», «1,5 дня», «24 days», «24 күн» */
export function days(n: number | null | undefined): string {
  if (n === null || n === undefined) return '–'
  const c = Math.round(Number(n) * 10) / 10
  return t('fmt.days', { v: num(c, 1), c })
}

/** «24 дня + 7 перенос»: положено за год с учётом переноса с прошлого года */
export function entitledText(b: { entitled: number; carryover?: number | null }): string {
  const c = Number(b.carryover ?? 0)
  if (c <= 0) return days(b.entitled)
  return t('fmt.carryover', { base: days(b.entitled - c), c: num(c, 1) })
}

export function fullName(e?: { first_name?: string; last_name?: string } | null, lastFirst = false): string {
  if (!e) return '–'
  return lastFirst ? `${e.last_name ?? ''} ${e.first_name ?? ''}`.trim() : `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim()
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}

export function isoDate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}
