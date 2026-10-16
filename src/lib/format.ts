import { differenceInCalendarDays, differenceInMinutes, format, formatDistanceToNowStrict, parseISO } from 'date-fns'
import { kk, ru } from 'date-fns/locale'
import { getLang } from './i18n'

const locale = () => (getLang() === 'kk' ? kk : ru)

export function toDate(value: string | Date): Date {
  return typeof value === 'string' ? parseISO(value) : value
}

export function fmtDate(value: string | Date | null | undefined, pattern = 'd MMM yyyy'): string {
  if (!value) return '—'
  return format(toDate(value), pattern, { locale: locale() })
}

/** «Пятница, 16 октября» — день недели с заглавной, месяц как есть */
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

export function fmtRange(start: string | null, end: string | null): string {
  if (!start) return '—'
  if (!end || start === end) return fmtDate(start)
  const s = toDate(start)
  const e = toDate(end)
  if (s.getFullYear() === e.getFullYear()) {
    return `${format(s, s.getMonth() === e.getMonth() ? 'd' : 'd MMM', { locale: locale() })} – ${format(e, 'd MMM yyyy', { locale: locale() })}`
  }
  return `${fmtDate(s)} – ${fmtDate(e)}`
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return formatDistanceToNowStrict(toDate(value), { addSuffix: true, locale: locale() })
}

/** «2 д 5 ч», «3 ч 10 мин» — сколько висит заявка */
export function duration(from: string | Date, to: Date = new Date()): string {
  const minutes = Math.max(0, differenceInMinutes(to, toDate(from)))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days} д ${hours} ч`
  if (hours > 0) return `${hours} ч ${mins} мин`
  return `${mins} мин`
}

export function hoursSince(from: string | Date): number {
  return differenceInMinutes(new Date(), toDate(from)) / 60
}

export function daysUntil(value: string | Date): number {
  return differenceInCalendarDays(toDate(value), new Date())
}

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${Math.round(value).toLocaleString('ru-RU').replace(/,/g, ' ')} ₸`
}

export function num(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

/** Склонение: plural(5, ['день','дня','дней']) */
export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return forms[2]
  if (last > 1 && last < 5) return forms[1]
  if (last === 1) return forms[0]
  return forms[2]
}

export function days(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  const v = Math.round(Number(n) * 10) / 10
  if (getLang() === 'kk') return `${num(v, 1)} күн`
  return `${num(v, 1)} ${plural(Math.floor(v), ['день', 'дня', 'дней'])}`
}

/** «24 дня + 7 перенос»: положено за год с учётом переноса с прошлого года */
export function entitledText(b: { entitled: number; carryover?: number | null }): string {
  const c = Number(b.carryover ?? 0)
  if (c <= 0) return days(b.entitled)
  return `${days(b.entitled - c)} + ${num(c, 1)} ${getLang() === 'kk' ? 'ауыстырылған' : 'перенос'}`
}

export function fullName(e?: { first_name?: string; last_name?: string } | null, lastFirst = false): string {
  if (!e) return '—'
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
