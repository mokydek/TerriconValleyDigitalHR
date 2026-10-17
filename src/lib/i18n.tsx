import { createContext, Fragment, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import ru, { type Dict, type I18nKey } from '@/locales/ru'
import { LANGS, type Lang } from '@/locales/langs'

export type { Dict, I18nKey, Lang }
export { LANGS }

const STORAGE_KEY = 'janamen-lang'

// Русский встроен в сборку, остальные языки скачиваются отдельным файлом при выборе
const loaders: Record<Exclude<Lang, 'ru'>, () => Promise<{ default: Dict }>> = {
  kk: () => import('@/locales/kk'),
  en: () => import('@/locales/en'),
  ky: () => import('@/locales/ky'),
  uz: () => import('@/locales/uz'),
  tg: () => import('@/locales/tg'),
  mn: () => import('@/locales/mn'),
}
const dicts: Partial<Record<Lang, Dict>> = { ru }

let current: Lang = 'ru'
let active: Dict = ru

export function isLang(value: unknown): value is Lang {
  return LANGS.some((l) => l.code === value)
}

function savedLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return isLang(saved) ? saved : 'ru'
  } catch {
    return 'ru'
  }
}

async function loadLang(l: Lang): Promise<void> {
  if (l !== 'ru' && !dicts[l]) dicts[l] = (await loaders[l]()).default
}

function apply(l: Lang) {
  current = l
  active = dicts[l] ?? ru
  document.documentElement.lang = l
  document.title = t('app.title')
}

/** До первого рендера: подгружаем сохранённый язык; если файл не скачался, остаёмся на русском */
export function initLang(): Promise<void> {
  const l = savedLang()
  return loadLang(l).then(
    () => apply(l),
    () => apply('ru'),
  )
}

export function getLang(): Lang {
  return current
}

/** Локаль для чисел: разделители разрядов и дробной части */
export function numberLocale(): string {
  return LANGS.find((l) => l.code === current)?.numberLocale ?? 'ru-RU'
}

/** Индекс формы слова после числа: в русском одна, две-четыре, пять и больше; в английском одна или много */
function pluralIndex(n: number, forms: number): number {
  if (forms <= 1) return 0
  if (current === 'ru') {
    if (!Number.isInteger(n)) return Math.min(1, forms - 1)
    const abs = Math.abs(n) % 100
    const last = abs % 10
    if (abs > 10 && abs < 20) return Math.min(2, forms - 1)
    if (last === 1) return 0
    if (last > 1 && last < 5) return Math.min(1, forms - 1)
    return Math.min(2, forms - 1)
  }
  return Math.abs(n) === 1 ? 0 : forms - 1
}

type Vars = Record<string, string | number>
const TOKEN = /\{(\w+)((?:\|[^{}|]*)+)?\}/g

/** {name} подставляет значение, {name|форма|формы|форм} выбирает форму слова по числу name */
function fill(s: string, vars: Vars): string {
  return s.replace(TOKEN, (m, name: string, forms?: string) => {
    const v = vars[name]
    if (v === undefined) return m
    if (!forms) return String(v)
    const list = forms.slice(1).split('|')
    return list[pluralIndex(Number(v), list.length)]
  })
}

export function t(key: I18nKey, vars?: Vars): string {
  const s = active[key] ?? ru[key] ?? key
  return vars ? fill(s, vars) : s
}

/** Перевод со вставками-элементами: tr('key', { email: <b>{email}</b> }) */
export function tr(key: I18nKey, vars: Record<string, ReactNode>): ReactNode {
  const s = active[key] ?? ru[key] ?? key
  const parts: ReactNode[] = []
  let last = 0
  for (const m of s.matchAll(TOKEN)) {
    const [whole, name, forms] = m
    const idx = m.index ?? 0
    if (idx > last) parts.push(s.slice(last, idx))
    const v = vars[name]
    if (v === undefined) parts.push(whole)
    else if (forms && typeof v === 'number') parts.push(fill(whole, { [name]: v }))
    else parts.push(<Fragment key={idx}>{v}</Fragment>)
    last = idx + whole.length
  }
  if (last < s.length) parts.push(s.slice(last))
  return <>{parts}</>
}

interface I18nCtx {
  lang: Lang
  setLang: (l: Lang) => Promise<void>
  t: typeof t
}

const Ctx = createContext<I18nCtx>({ lang: current, setLang: async () => {}, t })

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current)
  const setLang = useCallback(async (l: Lang) => {
    try {
      await loadLang(l)
    } catch {
      toast.error(t('err.langLoad'))
      return
    }
    apply(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* приватный режим: язык не сохранится */
    }
    setLangState(l)
  }, [])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n() {
  return useContext(Ctx)
}
