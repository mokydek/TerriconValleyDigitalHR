/**
 * Вход по вкладкам. Обычный клиент Supabase хранит одну сессию на весь браузер и рассылает вход
 * во все вкладки, поэтому вход под другой ролью в одной вкладке переключал и остальные.
 * Здесь каждая вкладка помнит свой аккаунт (sessionStorage), а сессии лежат в localStorage
 * по аккаунтам. Так в трёх вкладках можно держать работника, руководителя и HR одновременно.
 *
 * - Новая вкладка (или перезагрузка вкладки, где не выходили) начинает с аккаунта последнего входа,
 *   а если из него вышли — с предыдущего, который ещё открыт.
 * - Вход во вкладке закрепляет за ней этот аккаунт и не трогает другие вкладки.
 * - Выход: если аккаунт открыт в других вкладках, отвязывается только эта вкладка;
 *   если больше нигде, сессия завершается и удаляется.
 * - Вкладки одного аккаунта делят одну сессию, поэтому обновление токена в одной видно остальным.
 */

const BASE = 'janamen-auth'
const ACCOUNT_PREFIX = `${BASE}:acct:`
const accountKey = (uid: string) => ACCOUNT_PREFIX + uid
/** localStorage: аккаунты по свежести входа, новая вкладка начинает с первого живого */
const RECENT = `${BASE}:recent`
/** sessionStorage: аккаунт этой вкладки или NONE, если во вкладке вышли */
const TAB = `${BASE}:tab`
const NONE = '-'

/**
 * Ключ клиента Supabase уникален для каждой загрузки страницы: по нему клиент называет канал
 * рассылки между вкладками и блокировку. С уникальным ключом чужой вход не прилетает в эту вкладку.
 * Сами данные адаптер ниже кладёт по аккаунтам, так что ключ на них не влияет.
 */
export const AUTH_STORAGE_KEY = `${BASE}#${Math.random().toString(36).slice(2, 10)}`

function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback // хранилище недоступно (приватный режим, запрет cookies)
  }
}
const local = {
  get: (k: string) => attempt(() => localStorage.getItem(k), null),
  set: (k: string, v: string) => attempt(() => localStorage.setItem(k, v), undefined),
  del: (k: string) => attempt(() => localStorage.removeItem(k), undefined),
}
const tab = {
  get: () => attempt(() => sessionStorage.getItem(TAB), null),
  set: (v: string) => attempt(() => sessionStorage.setItem(TAB, v), undefined),
}

function recent(): string[] {
  try {
    const list = JSON.parse(local.get(RECENT) ?? '[]') as unknown
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function setRecent(list: string[]) {
  if (list.length) local.set(RECENT, JSON.stringify(list.slice(0, 10)))
  else local.del(RECENT)
}

function userIdOf(raw: string | null): string | null {
  if (!raw) return null
  try {
    return (JSON.parse(raw) as { user?: { id?: string } })?.user?.id ?? null
  } catch {
    return null
  }
}

/** Сессия из прежней версии (один ключ на браузер) переезжает в хранилище по аккаунтам */
function migrateLegacy() {
  const raw = local.get(BASE)
  if (!raw) return
  const uid = userIdOf(raw)
  if (uid) {
    if (!local.get(accountKey(uid))) local.set(accountKey(uid), raw)
    if (!recent().includes(uid)) setRecent([...recent(), uid])
  }
  local.del(BASE)
}

let bootstrapped = false

/** Аккаунт этой вкладки. Новая вкладка один раз при загрузке берёт аккаунт последнего входа */
export function tabAccount(): string | null {
  const own = tab.get()
  if (own) return own === NONE ? null : own
  if (bootstrapped) return null
  bootstrapped = true
  migrateLegacy()
  const alive = recent().filter((uid) => local.get(accountKey(uid)))
  setRecent(alive)
  if (alive[0]) tab.set(alive[0])
  return alive[0] ?? null
}

/** У вкладки есть живая сессия (её не завершили в другой вкладке) */
export function tabHasSession(): boolean {
  const uid = tabAccount()
  return Boolean(uid && local.get(accountKey(uid)))
}

/** Отвязать вкладку от аккаунта, не завершая сессию: ею пользуются другие вкладки */
export function detachTab() {
  tab.set(NONE)
}

/** Стереть все сохранённые входы (кнопка «Сбросить вход» на экране запуска) */
export function clearAllSessions() {
  attempt(() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith(BASE)) localStorage.removeItem(key)
  }, undefined)
  attempt(() => sessionStorage.removeItem(TAB), undefined)
}

/** Подписка на изменения сессий в других вкладках (выход, вход, обновление токена) */
export function onSessionsChanged(cb: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(ACCOUNT_PREFIX)) cb()
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

/** Хранилище для клиента Supabase: основной ключ раскладывается по аккаунтам, остальные идут как есть */
export const tabAuthStorage = {
  getItem(key: string): string | null {
    if (key !== AUTH_STORAGE_KEY) return local.get(baseKey(key))
    const uid = tabAccount()
    return uid ? local.get(accountKey(uid)) : null
  },
  setItem(key: string, value: string): void {
    if (key !== AUTH_STORAGE_KEY) return local.set(baseKey(key), value)
    const uid = userIdOf(value) ?? tabAccount()
    if (!uid) return
    local.set(accountKey(uid), value)
    if (recent()[0] !== uid) setRecent([uid, ...recent().filter((x) => x !== uid)])
    tab.set(uid)
  },
  removeItem(key: string): void {
    if (key !== AUTH_STORAGE_KEY) return local.del(baseKey(key))
    const uid = tabAccount()
    if (!uid) return // вкладка уже отвязана: чужие сессии не трогаем
    local.del(accountKey(uid))
    setRecent(recent().filter((x) => x !== uid))
    tab.set(NONE)
  },
}

/** Служебные ключи клиента (PKCE и т.п.) не зависят от уникального суффикса загрузки */
function baseKey(key: string) {
  return key.startsWith(AUTH_STORAGE_KEY) ? BASE + key.slice(AUTH_STORAGE_KEY.length) : key
}

/* ---------- Кто ещё работает под этим аккаунтом ---------- */

type TabMessage = { type: 'who'; uid: string; id: string } | { type: 'here'; id: string }

const channel: BroadcastChannel | null = attempt(() => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`${BASE}:tabs`)), null)

channel?.addEventListener('message', (e: MessageEvent<TabMessage>) => {
  const m = e.data
  if (m?.type === 'who' && tab.get() === m.uid && tabHasSession()) channel.postMessage({ type: 'here', id: m.id } satisfies TabMessage)
})

/** Открыт ли аккаунт в других вкладках: спрашиваем их и ждём ответа до четверти секунды */
export function accountOpenElsewhere(uid: string, timeout = 250): Promise<boolean> {
  if (!channel) return Promise.resolve(false)
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2)
    const finish = (value: boolean) => {
      window.clearTimeout(timer)
      channel.removeEventListener('message', listener)
      resolve(value)
    }
    const listener = (e: MessageEvent<TabMessage>) => {
      if (e.data?.type === 'here' && e.data.id === id) finish(true)
    }
    const timer = window.setTimeout(() => finish(false), timeout)
    channel.addEventListener('message', listener)
    channel.postMessage({ type: 'who', uid, id } satisfies TabMessage)
  })
}
